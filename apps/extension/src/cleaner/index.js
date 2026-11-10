// تنظيف فيديو من الاستوديو: يخرج نسخة نظيفة MP4 — النساء والعورات مغطاة حسب الإعدادات،
// والموسيقى محذوفة مع بقاء الكلام، والمغني مكتوم، والألفاظ مكتومة (إن عُرفت مواضعها).
// كله على الجهاز: لا يُرفع شيء. يعمل على دفعات من القرص، فيصلح للفيديو الطويل على الجوال.
import { Muxer, StreamTarget } from "mp4-muxer";
import { demux, SampleReader, toChunk } from "./demux.js";
import { planAudio, renderAudio, audioEncoder, wavWriter, pickAudioCodec, measureEncoderDelay } from "./audio.js";
import { scanVideo, renderVideo, pickVideoCodec } from "./video.js";
import { MemorySink } from "./sink.js";

/**
 * @param {Blob} file
 * @param {object} settings إعدادات المستخدم (المستوى، ومن يستخدم الجهاز، والموسيقى…)
 * @param {{ analyzeRegions: Function, analyzeAudio: Function, separate: { create(): Promise<{ music: Function, backend: string }> }, muteIntervals?: number[][],
 *           sink?: MemorySink|import("./sink.js").HostSink, onProgress?: (stage: string, p: number) => void }} deps
 * @returns {Promise<{ blob: Blob|null, wav: Blob|null, report: object }>} wav: الصوت النظيف منفصلًا حين لا يوجد
 *          مرمّز صوت (الفيديو حينها بلا صوت، ويدمجهما التطبيق بأدوات النظام). blob = null عند الكتابة في التطبيق.
 */
/** هل يمكن نسخ صوت الملف كما هو؟ (AAC أو Opus، ومعه إعداداته) */
function copyableAudio(a) {
    if (!a?.description) return null;
    if (a.codec.startsWith("mp4a.40")) return "aac";
    if (a.codec === "opus" || a.codec === "Opus") return "opus";
    return null;
}

/**
 * ينسخ عينات الصوت المشفرة كما هي. بداية الصوت فيها عينات تهيئة (كانت قائمة التحرير تخفيها)، فنؤخّر الصورة
 * بنفس القدر بدلًا من ذلك: يبقى التزامن بين الصوت والصورة كما في الأصل تمامًا.
 */
async function copyAudio(a, reader, muxer) {
    const decoderConfig = { codec: a.codec.startsWith("mp4a") ? a.codec : "opus", sampleRate: a.sampleRate, numberOfChannels: a.channels, description: a.description };
    let first = true;
    for (const s of a.samples) {
        const chunk = toChunk(s, await reader.read(s), EncodedAudioChunk);
        muxer.addAudioChunk(chunk, first ? { decoderConfig } : undefined);
        first = false;
    }
}

// الجوال يوقف الصفحة حين يخرج المستخدم من التطبيق، فيُغلق مفكك الفيديو ("Decoder failure").
// نعيد المرحلة نفسها عند الرجوع بدل الفشل.
const doc = typeof document !== "undefined" ? document : null;
let hiddenSince = 0;
doc?.addEventListener("visibilitychange", () => { if (doc.hidden) hiddenSince = Date.now(); });
const untilVisible = () => !doc?.hidden ? Promise.resolve() : new Promise((resolve) => {
    const f = () => { if (!doc.hidden) { doc.removeEventListener("visibilitychange", f); resolve(); } };
    doc.addEventListener("visibilitychange", f);
});
async function resilient(fn, onPause) {
    for (let attempt = 0; ; attempt++) {
        const started = Date.now();
        try {
            return await fn();
        } catch (e) {
            const wentAway = doc?.hidden || hiddenSince >= started;
            if (!wentAway || attempt >= 3) throw e;
            onPause?.();
            await untilVisible();
        }
    }
}

export async function cleanVideo(file, settings, deps) {
    const progress = deps.onProgress ?? (() => {});
    const paused = () => progress("paused", 0);
    const sink = deps.sink ?? new MemorySink();
    progress("read", 0);
    const src = await demux(file);
    if (!src.video && !src.audio) throw new Error("لا يوجد في الملف صورة ولا صوت");
    const reader = new SampleReader(file);
    const report = { duration: src.duration, coveredSeconds: 0, fullSeconds: 0, musicSeconds: 0, singerSeconds: 0 };

    let plan = null, audioCodec = null, passthrough = null;
    if (src.audio) {
        plan = await resilient(() => planAudio(src.audio, reader, file, settings, { ...deps, onProgress: (s, p) => progress(s, p) }), paused);
        Object.assign(report, plan.report);
        plan.bed = settings.musicBed; // خلفية هادئة مكان الموسيقى (إن اختيرت)
        // لا موسيقى ولا ألفاظ: الصوت يُنسخ كما هو بايتًا بايتًا (لا إعادة ترميز = لا أي تغيير في الصوت)
        passthrough = !plan.segs.length && !plan.muteIntervals.length ? copyableAudio(src.audio) : null;
        // داخل التطبيق: الصوت النظيف يُسلَّم خامًا (WAV) ويرمّزه نظام الجوال نفسه — مرمّز المتصفح في الجوال
        // قد يُخرج صوتًا لا يُشغَّل (مثل Opus داخل MP4 في الآيفون) فيبدو الفيديو صامتًا
        if (!passthrough) audioCodec = deps.hostAudio ? null : await pickAudioCodec(plan.sampleRate, plan.channels);
    }

    let videoCodec = null, marks = [];
    if (src.video) {
        videoCodec = await pickVideoCodec(src.video);
        if (!videoCodec) throw new Error("هذا الجهاز لا يدعم ترميز الفيديو");
        // «أزل الموسيقى» فقط: لا فحص للصور (الصورة تبقى كما هي)
        marks = settings.cleanImages === false ? [] : await resilient(() => scanVideo(src.video, reader, settings, deps.analyzeRegions, (p) => progress("scan", p)), paused);
        const step = 0.5;
        report.coveredSeconds = marks.filter((m) => m.covers.length || m.full).length * step;
        report.fullSeconds = marks.filter((m) => m.full).length * step;
    }

    // الكتابة كلها مرحلة واحدة تُعاد من أولها إن توقفت (الملف يُفتح من جديد)
    let wavOut = null;
    await resilient(async () => {
        const out = sink.open("video", "video/mp4");
        const muxer = new Muxer({
            target: new StreamTarget({ onData: (data, position) => out.write(position, data), chunked: true, chunkSize: 4 << 20 }),
            fastStart: false,
            // أول عينة في الصورة أو الصوت تبدأ من الصفر، مع حفظ الفرق بينهما (تزامن الشفاه)
            firstTimestampBehavior: "cross-track-offset",
            ...(src.video ? { video: { codec: videoCodec.mux, width: src.video.width, height: src.video.height, rotation: src.video.rotation } } : {}),
            ...(passthrough ? { audio: { codec: passthrough, sampleRate: src.audio.sampleRate, numberOfChannels: src.audio.channels } }
                : plan && audioCodec ? { audio: { codec: audioCodec.mux, sampleRate: audioCodec.sampleRate, numberOfChannels: plan.channels } } : {}),
        });
        const videoDelay = passthrough ? Math.max(0, -(src.audio.shift ?? 0)) : 0;
        if (src.video) await renderVideo(src.video, reader, marks, muxer, videoCodec, (p) => progress("render", p), videoDelay);
        wavOut = null;
        if (passthrough) {
            progress("encode-audio", 0);
            report.audioCopied = true;
            await copyAudio(src.audio, reader, muxer);
        } else if (plan) {
            progress("encode-audio", 0);
            let w;
            if (audioCodec) {
                report.audioDelay = await measureEncoderDelay(audioCodec, plan.channels).catch(() => 0);
                w = audioEncoder(muxer, audioCodec, plan.channels, report.audioDelay);
            }
            else { wavOut = sink.open("audio", "audio/wav"); w = wavWriter(wavOut, plan.channels, plan.sampleRate); }
            await renderAudio(src.audio, reader, file, plan, (chans, rate) => w.write(chans, rate));
            await w.close();
            wavOut?.close();
        }
        muxer.finalize();
        out.close();
    }, paused);
    progress("done", 1);
    return { blob: sink.blob("video"), wav: sink.blob("audio"), report, external: !!wavOut };
}
