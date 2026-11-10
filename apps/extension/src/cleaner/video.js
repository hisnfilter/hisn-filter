// صورة الفيديو: فحص إطارات (نحو إطارين في الثانية) ثم تغطية المنطقة المخالفة وحدها في كل الإطارات،
// وإعادة الترميز. لأن الملف كله أمامنا، تُغطّى المنطقة قبل ظهور المخالفة بلحظة وبعدها بلحظة (لا يفوت شيء).
import { decideRegions } from "@hisn/core";
import { toChunk } from "./demux.js";
import { displaySize, drawRotated, unrotateBox } from "./geometry.js";

const SAMPLE_EVERY = 0.5; // ثانية بين كل فحصين
const HOLD = 0.6; // نغطي من قبل الفحص بـ 0.6 ثانية إلى بعده بـ 0.6 ثانية

function decoderConfig(track) {
    return { codec: track.codec, codedWidth: track.width, codedHeight: track.height, description: track.description };
}

/** يمر على الإطارات بالترتيب ويستدعي fn لكل إطار (يُغلق الإطار بعدها). العينات تُقرأ من الملف عند الحاجة. */
async function forEachFrame(track, reader, fn) {
    const queue = [];
    let error = null;
    const dec = new VideoDecoder({ output: (f) => queue.push(f), error: (e) => { error = e; } });
    dec.configure(decoderConfig(track));
    const drain = async () => {
        while (queue.length) {
            const f = queue.shift();
            try { await fn(f); } finally { f.close(); }
        }
    };
    for (const s of track.samples) {
        if (error) throw error;
        dec.decode(toChunk(s, await reader.read(s), EncodedVideoChunk, track.shift ?? 0));
        if (dec.decodeQueueSize > 8 || queue.length > 4) {
            await new Promise((r) => setTimeout(r, 0));
            await drain();
        }
    }
    await dec.flush();
    await drain();
    dec.close();
    if (error) throw error;
}

/**
 * المرحلة 1: فحص إطارات متباعدة. يُرجع لكل فحص: الوقت (ثانية) والمناطق (نسبية 0..1) وهل يُغطّى الإطار كله.
 * @param {(bitmap: ImageBitmap) => Promise<object>} analyzeRegions
 */
export async function scanVideo(track, reader, settings, analyzeRegions, onProgress) {
    const marks = [];
    let next = 0, count = 0;
    await forEachFrame(track, reader, async (frame) => {
        const t = frame.timestamp / 1e6;
        count++;
        if (t < -1e-3) return; // قبل بداية العرض (تقطعه قائمة التحرير)
        onProgress?.(Math.min(1, count / track.nb));
        if (t + 1e-3 < next) return;
        next = t + SAMPLE_EVERY;
        // نفحص الصورة كما تُعرض (فيديو الجوال العمودي مخزَّن مائلًا)، مصغّرة إلى 640 بكسل
        const rot = track.rotation || 0;
        const scale = Math.min(1, 640 / Math.max(track.width, track.height));
        const sw = Math.max(1, Math.round(track.width * scale)), sh = Math.max(1, Math.round(track.height * scale));
        const [dw, dh] = displaySize(sw, sh, rot);
        const canvas = new OffscreenCanvas(dw, dh);
        drawRotated(canvas.getContext("2d"), frame, sw, sh, rot);
        const bmp = canvas.transferToImageBitmap();
        try {
            const r = await analyzeRegions(bmp);
            const v = decideRegions(r, settings);
            marks.push({
                t,
                full: v.full,
                covers: v.covers.map((c) => ({
                    reason: c.reason,
                    box: unrotateBox([c.box[0] / r.width, c.box[1] / r.height, c.box[2] / r.width, c.box[3] / r.height], rot),
                })),
            });
        } finally {
            bmp.close();
        }
    });
    return marks;
}

/** المناطق التي تُغطّى عند الوقت t: كل فحص يقع ضمن ±HOLD (اتحادها، الأحوط). */
export function coversAt(marks, t) {
    const near = marks.filter((m) => Math.abs(m.t - t) <= HOLD);
    return { full: near.some((m) => m.full), covers: near.flatMap((m) => m.covers) };
}

/** يرسم غطاء المنطقة: تكسير شديد (بكسلات كبيرة) مع تعتيم، فلا يُعرف ما تحته. */
function drawCover(ctx, x, y, w, h) {
    if (w < 2 || h < 2) return;
    const cells = 6;
    const sw = Math.max(1, Math.round(cells)), sh = Math.max(1, Math.round((cells * h) / w));
    const tmp = new OffscreenCanvas(sw, sh);
    const t = tmp.getContext("2d");
    t.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
    ctx.fillStyle = "rgba(20, 30, 28, 0.55)";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
}

/** نسخة من الإطار في ذاكرة عادية (لا ترتبط بذاكرة فك التشفير ولا بالرسم). */
async function copyFrame(frame, timestamp) {
    // نسخ المنطقة الظاهرة فقط (فيديو الجوال قد يُخزَّن 1088 سطرًا ويظهر منه 1080)
    const rect = frame.visibleRect ?? { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight };
    const buf = new Uint8Array(frame.allocationSize({ rect }));
    const layout = await frame.copyTo(buf, { rect });
    return new VideoFrame(buf, {
        format: frame.format, codedWidth: rect.width, codedHeight: rect.height,
        displayWidth: frame.displayWidth, displayHeight: frame.displayHeight,
        layout, timestamp, duration: frame.duration ?? undefined, colorSpace: frame.colorSpace,
    });
}

/**
 * يرسم الإطار في اللوحة عبر نسخة بايتات RGBA (putImageData). الرسم المباشر من إطار الفك
 * (drawImage أو createImageBitmap) يُراكم ذاكرة المتصفح مع آلاف الإطارات.
 */
// Safari/WebKit: لا نعتمد على تحويل الصيغة أصلًا (مقيس على الآيفون: يُخرج صورة مكسّرة)
const ua = globalThis.navigator?.userAgent ?? "";
let rgbaCopyWorks = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua) ? false : null;
async function paintFrame(ctx, frame, w, h) {
    const rect = frame.visibleRect ?? { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight };
    if (rgbaCopyWorks !== false && rect.width === w && rect.height === h) {
        try {
            // Safari (الآيفون) يتجاهل طلب التحويل إلى RGBA بصمت وينسخ بايتات YUV كما هي، فتخرج الصورة
            // مكررة أربع مرات بالرمادي وألوان غريبة. نتأكد أن النسخ RGBA فعلًا (مستوى واحد بحجم w×h×4).
            if (frame.allocationSize({ rect, format: "RGBA" }) !== w * h * 4) throw new Error("no RGBA");
            const rgba = new Uint8ClampedArray(w * h * 4);
            const layout = await frame.copyTo(rgba, { rect, format: "RGBA", colorSpace: "srgb" });
            if (layout?.length !== 1 || (layout[0].stride ?? w * 4) !== w * 4) throw new Error("no RGBA");
            rgbaCopyWorks = true;
            ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
            return;
        } catch {
            // لا يحوّل الصيغة: نرسم مباشرة (ونتذكر ذلك لبقية الفيديو)
            rgbaCopyWorks = false;
        }
    }
    ctx.drawImage(frame, 0, 0, w, h);
}

/** المرحلة 2: إعادة رسم كل إطار مع الأغطية وترميزه. */
export async function renderVideo(track, reader, marks, muxer, codec, onProgress, delay = 0) {
    const w = track.width, h = track.height;
    let encError = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encError = e; } });
    enc.configure({ codec: codec.webcodecs, width: w, height: h, bitrate: codec.bitrate, framerate: Math.round(track.fps) || 30 });
    let i = 0;
    const gop = Math.max(1, Math.round((track.fps || 30) * 2));
    const shift = Math.round(delay * 1e6);
    let canvas = null;
    await forEachFrame(track, reader, async (frame) => {
        if (encError) throw encError;
        const t = frame.timestamp / 1e6;
        if (t < -1e-3) return; // لا يُعرض في الأصل
        const { full, covers } = globalThis.__hisnCoverAll ? { full: true, covers: [] } : coversAt(marks, t);
        let out;
        if (!full && !covers.length) {
            // إطار سليم: نسخة بايتات (I420) تُرمَّز كما هي — بلا رسم، فلا يتراكم شيء في ذاكرة المتصفح
            out = await copyFrame(frame, frame.timestamp + shift);
        } else {
            // صورة مستقلة تُغلق فورًا (رسم إطار الفك مباشرة يُراكم ذاكرة المتصفح مع آلاف الإطارات)
            canvas ??= new OffscreenCanvas(w, h);
            const ctx = canvas.getContext("2d");
            await paintFrame(ctx, frame, w, h);
            if (full) drawCover(ctx, 0, 0, w, h);
            else for (const c of covers) drawCover(ctx, c.box[0] * w, c.box[1] * h, c.box[2] * w, c.box[3] * h);
            out = new VideoFrame(canvas, { timestamp: frame.timestamp + shift, duration: frame.duration ?? undefined });
        }
        enc.encode(out, { keyFrame: i % gop === 0 });
        out.close();
        i++;
        onProgress?.(i / track.nb);
        while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
    });
    await enc.flush();
    enc.close();
    if (encError) throw encError;
}

/** ترميز الصورة: H.264 (الأوسع دعمًا في الجوالات) ثم VP9. */
export async function pickVideoCodec(track) {
    const pixels = track.width * track.height;
    const bitrate = Math.round(Math.min(12e6, Math.max(1.5e6, pixels * (track.fps || 30) * 0.12)));
    const candidates = [
        ["avc1.640033", "avc"], ["avc1.4d0033", "avc"], ["avc1.42003e", "avc"],
        ["vp09.00.40.08", "vp9"], ["vp09.00.10.08", "vp9"],
    ];
    for (const [webcodecs, mux] of candidates) {
        const ok = await VideoEncoder.isConfigSupported({ codec: webcodecs, width: track.width, height: track.height, bitrate }).catch(() => null);
        if (ok?.supported) return { webcodecs, mux, bitrate };
    }
    return null;
}
