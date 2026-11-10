// محرك تنظيف الصوت لتطبيق أندرويد: نفس محرك الإضافة (DeepFilterNet3 + مكتشف الغناء) في WebView خفي.
// التطبيق يرسل منفذ رسائل (WebMessagePort)، ثم دفعات صوت 48kHz أحادي (int16، base64) كل 100ms تقريبًا:
//   "D<base64>" ← صوت ملتقط        → "D<base64>" صوت نظيف بنفس الطول
//   "S1"/"S0"   → هل الصوت الباقي غناء (كل نصف ثانية)
//   "R" جاهز، "E<رسالة>" خطأ، "X" إغلاق
import "./host.js";
import { DeepFilter } from "@lofcz/deepfilternet-web";
import { SingingDetector } from "@hisn/core";

const FRAME = 480;

export function b64ToFloat(s) {
    const bin = atob(s);
    const n = bin.length >> 1;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        out[i] = v / 32768;
    }
    return out;
}

export function floatToB64(x) {
    let s = "";
    for (let i = 0; i < x.length; i++) {
        const v = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))) & 0xffff;
        s += String.fromCharCode(v & 0xff, v >> 8);
    }
    return btoa(s);
}

async function serve(port) {
    let df;
    try {
        df = await DeepFilter.create({ wasmUrl: chrome.runtime.getURL("audio/df_bg.wasm"), attenuationLimit: 100 });
    } catch (e) {
        port.postMessage("E" + String(e?.message ?? e));
        return;
    }
    const singing = new SingingDetector();
    const dec = new Float32Array(FRAME / 3);
    const frame = new Float32Array(FRAME);
    let pending = new Float32Array(0);
    let frames = 0;
    port.onmessage = (m) => {
        const data = typeof m.data === "string" ? m.data : "";
        if (data === "X") { df.destroy(); port.close(); return; }
        if (data[0] !== "D") return;
        const x = b64ToFloat(data.slice(1));
        // نعالج إطارات 480 كاملة، ونحتفظ بالباقي للدفعة التالية
        const all = new Float32Array(pending.length + x.length);
        all.set(pending); all.set(x, pending.length);
        const whole = all.length - (all.length % FRAME);
        const out = new Float32Array(whole);
        for (let i = 0; i < whole; i += FRAME) {
            frame.set(all.subarray(i, i + FRAME));
            const y = df.process(frame);
            out.set(y, i);
            for (let k = 0; k < dec.length; k++) dec[k] = (y[3 * k] + y[3 * k + 1] + y[3 * k + 2]) / 3;
            singing.push(dec);
            if (++frames % 50 === 0) {
                const s = singing.isSinging();
                port.postMessage(s ? "S1" : "S0");
            }
        }
        pending = all.slice(whole);
        if (whole) port.postMessage("D" + floatToB64(out));
    };
    port.postMessage("R");
}

window.addEventListener("message", (e) => {
    if (e.data === "hisn-engine" && e.ports?.[0]) serve(e.ports[0]);
});
