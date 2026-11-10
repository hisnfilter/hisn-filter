// محرك تنظيف الصوت: يعمل في إطار خفي من الإضافة نفسها (لا تمنعه سياسات أمان المواقع).
// DeepFilterNet3 يزيل الموسيقى ويبقي الكلام، ومكتشف الغناء يخبر الصفحة إن كان الصوت الباقي غناءً.
import { DeepFilter } from "@lofcz/deepfilternet-web";
import { SingingDetector } from "@hisn/core";

const api = globalThis.chrome ?? globalThis.browser;
const wasmUrl = api.runtime.getURL("audio/df_bg.wasm");
let ready = null;
const MAX_SESSIONS = 8; // حد للجلسات في الصفحة الواحدة (كل فيديو فيه موسيقى جلسة)
let sessions = 0;

window.addEventListener("message", async (e) => {
    // من الصفحة الأم فقط، وبالشكل المتوقع
    if (e.source !== window.parent || e.data?.type !== "hisn-engine" || e.ports.length !== 2) return;
    const [audio, control] = e.ports;
    if (sessions >= MAX_SESSIONS) {
        control.postMessage({ type: "error", message: "busy" });
        return;
    }
    sessions++;
    let open = true;
    const end = () => { if (open) { open = false; sessions--; } };
    try {
        ready ??= DeepFilter.create({ wasmUrl, attenuationLimit: 100 }).then((d) => { d.destroy(); return true; });
        await ready;
        const df = await DeepFilter.create({ wasmUrl, attenuationLimit: 100 });
        const singing = new SingingDetector();
        const dec = new Float32Array(160);
        let frames = 0;
        audio.onmessage = (m) => {
            const x = m.data;
            if (!(x instanceof Float32Array) || x.length !== 480) return; // إطار 10ms بتردد 48kHz فقط
            const y = df.process(x);
            // نسخة 16kHz للكشف عن الغناء
            for (let i = 0; i < 160; i++) dec[i] = (y[3 * i] + y[3 * i + 1] + y[3 * i + 2]) / 3;
            singing.push(dec);
            if (++frames % 50 === 0) control.postMessage({ type: "singing", value: singing.isSinging(), frames });
            audio.postMessage(y, [y.buffer]);
        };
        control.onmessage = (m) => { if (m.data?.type === "close") { df.destroy(); audio.close(); control.close(); end(); } };
        control.postMessage({ type: "ready" });
    } catch (err) {
        end();
        control.postMessage({ type: "error", message: String(err) });
    }
});
