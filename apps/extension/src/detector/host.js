// يستقبل طلبات الفحص من الصفحات ويرد بالتحليل.
// يعمل في صفحة خلفية خفية (Chrome) أو في الخلفية نفسها (Firefox).
import { api } from "../shared/settings.js";
import { MSG } from "../shared/messages.js";
import { init, analyzeBitmap, analyzeAudio, health } from "./engine.js";
import { decodePcm16 } from "@hisn/core";

const CACHE_MAX = 600;
const cache = new Map(); // src → analysis (الأحدث في النهاية)

function remember(key, value) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function toBitmap({ src, dataUrl }) {
    // الإضافة تملك صلاحية الجلب من كل المواقع، فلا تعيقها قيود CORS
    const res = await fetch(dataUrl ?? src, { credentials: "omit", cache: "force-cache" });
    if (!res.ok) throw Object.assign(new Error("fetch"), { code: "fetch" });
    const blob = await res.blob();
    if (blob.type.includes("svg")) throw Object.assign(new Error("svg"), { code: "fetch" });
    return createImageBitmap(blob);
}

// ثلاثة طوابير: الصوت، ثم لقطات الفيديو، ثم الصور
const frames = [];
const audio = [];
const images = [];
let running = false;
let sinceImage = 0;
const IMAGES_MAX = 150; // الأقدم يُترك (الصفحة تعيد طلبه إن بقي ظاهرًا)

function pump() {
    if (running) return;
    // الصوت أولًا: نافذته صغيرة (عشرات المللي ثانية) ولا تحتمل الانتظار خلف لقطات الفيديو.
    // ومع فيديو يعمل باستمرار لا تُحرم الصور: صورة بعد كل 4 مهام صوت أو فيديو
    const job = (images.length && sinceImage >= 4 ? images.shift() : null) ?? audio.shift() ?? frames.shift() ?? images.shift();
    sinceImage = job?.kind === "image" ? 0 : sinceImage + 1;
    if (!job) return;
    running = true;
    // لقطة فيديو قديمة لم تعد تفيد: نتخطاها
    if ((job.kind === "frame" || job.kind === "audio") && performance.now() - job.at > 1500) {
        job.resolve({ stale: true });
        running = false;
        return pump();
    }
    job.run().then(job.resolve, (e) => job.resolve({ error: e.code === "fetch" ? "fetch" : "analyze", message: String(e) }))
        .finally(() => { running = false; pump(); });
}

function enqueue(kind, run) {
    return new Promise((resolve) => {
        const job = { kind, run, resolve, at: performance.now() };
        if (kind === "frame") {
            // نحتفظ بآخر لقطتين فقط من الفيديو
            while (frames.length >= 2) frames.shift().resolve({ stale: true });
            frames.push(job);
        } else if (kind === "audio") {
            while (audio.length >= 3) audio.shift().resolve({ stale: true });
            audio.push(job);
        } else {
            while (images.length >= IMAGES_MAX) images.shift().resolve({ stale: true });
            images.push(job);
        }
        pump();
    });
}

async function handle(msg) {
    if (msg.type === MSG.DETECT_IMAGE) {
        const key = msg.src ?? null;
        if (key && cache.has(key)) return { analysis: cache.get(key) };
        return enqueue("image", async () => {
            const bmp = await toBitmap(msg);
            try {
                const analysis = await analyzeBitmap(bmp);
                if (key) remember(key, analysis);
                return { analysis };
            } finally {
                bmp.close?.();
            }
        });
    }
    if (msg.type === MSG.DETECT_FRAME) {
        return enqueue("frame", async () => {
            const bmp = await toBitmap(msg);
            try {
                return { analysis: await analyzeBitmap(bmp) };
            } finally {
                bmp.close?.();
            }
        });
    }
    if (msg.type === MSG.DETECTOR_HEALTH) {
        if (health.images === "failed") init().catch(() => {}); // محاولة جديدة
        return { ...health, queue: images.length };
    }
    if (msg.type === MSG.DETECT_AUDIO) {
        return enqueue("audio", async () => ({ audio: await analyzeAudio(decodePcm16(msg.pcm)) }));
    }
    return null;
}

const HANDLED = new Set([MSG.DETECT_IMAGE, MSG.DETECT_FRAME, MSG.DETECT_AUDIO, MSG.DETECTOR_HEALTH]);

export function startDetectorHost() {
    // في Firefox يعمل المحرك داخل الخلفية نفسها: تقرأ حالته مباشرة
    globalThis.__hisnDetectorHealth = () => ({ ...health, queue: images.length });
    api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!HANDLED.has(msg?.type)) return false;
        handle(msg).then(sendResponse, (e) => sendResponse({ error: "analyze", message: String(e) }));
        return true;
    });
    // نحمّل النماذج مبكرًا حتى تكون جاهزة عند أول صورة
    // نموذج الصوت صغير: نحمّله أولًا ومستقلًا عن نماذج الصور، حتى لا تُسمع أول موسيقى أثناء التحميل
    analyzeAudio(new Float32Array(15600)).catch((e) => console.error("Hisn audio init failed", e));
    init().catch((e) => console.error("Hisn detector init failed", e));
}
