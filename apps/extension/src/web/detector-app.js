// محرك الكشف داخل تطبيق الآيفون (صفحة مخفية): يفحص ما ترسله «المتصفح المحمي» من صور ولقطات وصوت.
// التطبيق يستدعي window.__hisnDetect(رسالة) ويأخذ النتيجة نصًا (JSON).
import "./host.js";
import { analyzeBitmap, analyzeAudio, init, health, info } from "../detector/engine.js";
import { decodePcm16, decideImage, defaultSettings } from "@hisn/core";

// على الجوال: المعالج (WASM) لا WebGPU. نتائج WebGPU داخل WKWebView لم تُختبر على الأجهزة،
// والخطأ فيها صامت (أرقام خاطئة لا رسالة خطأ)، فالأحوط الطريق المختبَر.
globalThis.__hisnNoWebGPU = true;

const MAX_SIDE = 1024;

/** يفك الصورة مصغّرة مباشرة (أقل ذاكرة بكثير من فك الصورة كاملة ثم تصغيرها). */
async function bitmapOf(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const probe = await createImageBitmap(blob);
    const { width: w, height: h } = probe;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    if (scale === 1) return probe;
    probe.close?.();
    return createImageBitmap(blob, { resizeWidth: Math.round(w * scale), resizeHeight: Math.round(h * scale), resizeQuality: "high" });
}

// صورة واحدة في كل مرة: الفحص المتوازي على الجوال يستهلك الذاكرة فيُغلق النظام الصفحة
let chain = Promise.resolve();
function serial(job) {
    const run = chain.then(job, job);
    chain = run.catch(() => {});
    return run;
}

globalThis.__hisnDetect = async (msg) => {
    try {
        if (msg?.type === "hisn:detect-image" || msg?.type === "hisn:detect-frame") {
            if (!msg.dataUrl) return { error: "fetch" };
            return await serial(async () => {
                const bmp = await bitmapOf(msg.dataUrl);
                try {
                    return { analysis: await analyzeBitmap(bmp) };
                } finally {
                    bmp.close?.();
                }
            });
        }
        if (msg?.type === "hisn:detect-audio") return { audio: await analyzeAudio(decodePcm16(msg.pcm)) };
        if (msg?.type === "hisn:detector-health") return { ...health, backend: info() };
    } catch (e) {
        return { error: "analyze", message: String(e?.message ?? e).slice(0, 300) };
    }
    return null;
};

/** جاهزية المحرك (يستدعيه التطبيق قبل أول فحص). */
globalThis.__hisnReady = async () => {
    try {
        await init();
        return { ok: true, backend: info() };
    } catch (e) {
        return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
    }
};

/**
 * فحص الحماية على هذا الجوال: صور اختبار معروفة، والنتيجة المتوقعة لكل منها.
 * يُعرض في «الإعدادات ← فحص الحماية» ليتأكد المستخدم (ونتأكد) أن الكشف يعمل فعلًا على جهازه.
 */
globalThis.__hisnSelfTest = async () => {
    const t0 = performance.now();
    const ready = await globalThis.__hisnReady();
    const out = { ready, loadMs: Math.round(performance.now() - t0), cases: [], memory: performance?.memory?.usedJSHeapSize ?? null };
    if (!ready.ok) return out;
    const cases = [
        { file: "woman.jpg", male: "blur", female: "show" },
        { file: "man.jpg", male: "show", female: "show" },
        { file: "landscape.jpg", male: "show", female: "show" },
        { file: "belly.jpg", male: "cover", female: "cover" },
    ];
    for (const c of cases) {
        const t = performance.now();
        try {
            const res = await fetch(new URL(`selftest/${c.file}`, location.href));
            const dataUrl = await new Promise((resolve) => {
                res.blob().then((b) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(b); });
            });
            const r = await globalThis.__hisnDetect({ type: "hisn:detect-image", dataUrl });
            if (!r?.analysis) { out.cases.push({ file: c.file, ok: false, error: r?.message ?? r?.error ?? "?" }); continue; }
            const a = r.analysis;
            const male = decideImage(a, defaultSettings("male")).action;
            const female = decideImage(a, defaultSettings("female")).action;
            const okMale = male === c.male || (c.male === "blur" && male === "cover");
            out.cases.push({ file: c.file, ok: okMale && female === c.female, male, female, expect: [c.male, c.female], ms: Math.round(performance.now() - t), nudity: +a.nudity.toFixed(2), people: a.people.map((p) => p.gender) });
        } catch (e) {
            out.cases.push({ file: c.file, ok: false, error: String(e?.message ?? e).slice(0, 200) });
        }
    }
    out.backend = info();
    out.totalMs = Math.round(performance.now() - t0);
    return out;
};

/** قرار السياسة على تحليل جاهز (لفحص المحرك الأصلي في التطبيق). */
globalThis.__hisnDecide = (analysis, viewer) => decideImage(analysis, defaultSettings(viewer === "female" ? "female" : "male")).action;

// نحمّل النماذج مبكرًا
init().catch(() => {});
