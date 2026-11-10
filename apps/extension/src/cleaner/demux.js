// قراءة ملف MP4/MOV (فيديو الجوال) دون تحميله كله في الذاكرة: نقرأ فهرس الملف (moov) فقط،
// ثم نقرأ كل عينة من القرص عند الحاجة. هكذا يعمل حتى مع فيديو طويل بحجم جيجابايت على الجوال.
import MP4Box from "mp4box";

const PROBE = 1 << 20; // نقرأ الفهرس على دفعات 1MB
const WINDOW = 8 << 20; // نافذة القراءة للعينات

/** إعداد فك التشفير (avcC/hvcC/vpcC/av1C أو إعدادات الصوت) من صندوق الملف. */
function boxBytes(box) {
    const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8); // بلا رأس الصندوق
}

function videoDescription(file, track) {
    const trak = file.getTrackById(track.id);
    for (const e of trak.mdia.minf.stbl.stsd.entries) {
        const box = e.avcC || e.hvcC || e.vpcC || e.av1C;
        if (box) return boxBytes(box);
    }
    return undefined;
}

/** Opus في MP4 (صندوق dOps، أرقامه big-endian) ← ترويسة OpusHead التي يطلبها WebCodecs (little-endian). */
export function opusHeadFromDops(d) {
    const head = new Uint8Array(19 + (d[10] ? 2 + d[1] : 0));
    head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // "OpusHead"
    head[8] = 1;
    head[9] = d[1]; // عدد القنوات
    head[10] = d[3]; head[11] = d[2]; // PreSkip
    head[12] = d[7]; head[13] = d[6]; head[14] = d[5]; head[15] = d[4]; // InputSampleRate
    head[16] = d[9]; head[17] = d[8]; // OutputGain
    head[18] = d[10]; // ChannelMappingFamily
    if (d[10]) head.set(d.subarray(11, 13 + d[1]), 19);
    return head;
}

function audioDescription(file, track) {
    const trak = file.getTrackById(track.id);
    for (const e of trak.mdia.minf.stbl.stsd.entries) {
        // AAC: AudioSpecificConfig داخل esds
        const asc = e.esds?.esd?.descs?.[0]?.descs?.[0]?.data;
        if (asc) return new Uint8Array(asc);
        if (e.dOps) return opusHeadFromDops(boxBytes(e.dOps));
    }
    return undefined;
}

/**
 * قائمة التحرير (edts/elst): كم يُتخطى من بداية المسار (ترميز AAC/Opus يبدأ بعينات تهيئة، والفيديو بإطارات B)،
 * وكم يتأخر ظهوره. يُرجع إزاحة بالثواني تُضاف لأوقات العينات حتى تتطابق الصورة والصوت كما في المشغلات.
 */
function shiftOf(track, movieTimescale) {
    let delay = 0;
    for (const e of track.edits ?? []) {
        if (e.media_time === -1) { delay += e.segment_duration / movieTimescale; continue; }
        return delay - e.media_time / track.timescale;
    }
    return delay;
}

/** زاوية التدوير من مصفوفة المسار (فيديو الجوال العمودي غالبًا 90). */
function rotationOf(track) {
    const m = track.matrix;
    if (!m) return 0;
    const a = m[0] / 65536, b = m[1] / 65536;
    const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
    return ((deg % 360) + 360) % 360;
}

/** يقرأ بيانات العينات من الملف عبر نافذة 8MB (العينات متجاورة غالبًا، فالقراءات قليلة). */
export class SampleReader {
    constructor(file) {
        this.file = file;
        this.start = 0;
        this.bytes = new Uint8Array(0);
    }

    async read(s) {
        const a = s.offset, b = s.offset + s.size;
        if (a < this.start || b > this.start + this.bytes.length) {
            const end = Math.min(this.file.size, Math.max(b, a + WINDOW));
            this.bytes = new Uint8Array(await this.file.slice(a, end).arrayBuffer());
            this.start = a;
            if (this.bytes.length < s.size) throw new Error("الملف ناقص أو تالف");
        }
        return this.bytes.subarray(a - this.start, b - this.start);
    }
}

/**
 * @param {Blob} file
 * @returns {Promise<{ duration:number, video?:object, audio?:object }>} لكل مسار: codec، description، والعينات (بلا بيانات)
 */
export async function demux(file) {
    const mp4 = MP4Box.createFile();
    let info = null, error = null;
    mp4.onError = (e) => { error = e; };
    mp4.onReady = (i) => { info = i; };
    // نقرأ من البداية، ونقفز فوق بيانات الصورة والصوت (mdat) إلى الفهرس حيث كان
    let pos = 0;
    for (let guard = 0; !info && !error && pos < file.size && guard < 100000; guard++) {
        const end = Math.min(file.size, pos + PROBE);
        const buf = await file.slice(pos, end).arrayBuffer();
        buf.fileStart = pos;
        const next = mp4.appendBuffer(buf, end >= file.size);
        pos = next > pos ? next : end;
    }
    if (error || !info) throw new Error("ملف غير مدعوم" + (error ? ": " + error : ""));
    const samplesOf = (t) => (mp4.getTrackSamplesInfo(t.id) ?? []).map((s) => ({
        offset: s.offset, size: s.size, cts: s.cts, dts: s.dts, duration: s.duration, is_sync: s.is_sync, timescale: s.timescale,
    }));
    const v = info.videoTracks[0];
    const a = info.audioTracks[0];
    const out = { duration: info.duration / info.timescale };
    if (v) {
        out.video = {
            codec: v.codec, width: v.video.width, height: v.video.height, timescale: v.timescale,
            rotation: rotationOf(v), description: videoDescription(mp4, v), nb: v.nb_samples, shift: shiftOf(v, info.timescale),
            fps: v.nb_samples / (((v.samples_duration || v.duration) / v.timescale) || 1),
            samples: samplesOf(v),
        };
    }
    if (a) {
        out.audio = {
            codec: a.codec, sampleRate: a.audio.sample_rate, channels: a.audio.channel_count,
            timescale: a.timescale, description: audioDescription(mp4, a), nb: a.nb_samples, shift: shiftOf(a, info.timescale),
            hasEdits: (a.edits ?? []).some((e) => e.media_time !== -1),
            samples: samplesOf(a),
        };
    }
    // لا نحتاج المحلل بعد الآن (نحرر ما قرأه)
    mp4.stream?.cleanBuffers?.();
    return out;
}

/**
 * @param data بيانات العينة (من SampleReader)
 * @param shift إزاحة قائمة التحرير بالثواني
 */
export function toChunk(s, data, Kind, shift = 0) {
    return new Kind({
        type: s.is_sync ? "key" : "delta",
        timestamp: Math.round(1e6 * (s.cts / s.timescale + shift)),
        duration: Math.round((1e6 * s.duration) / s.timescale),
        data,
    });
}
