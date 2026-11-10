// فصل الموسيقى في عامل مستقل (Worker): ذاكرة النموذج (نحو 0.5–1GB أثناء العمل) تُحرَّر كاملة
// حين يُغلق العامل بعد الانتهاء، فلا تبقى محجوزة أثناء فحص الصور وإعادة الترميز. والواجهة لا تتجمد.
import * as ort from "onnxruntime-web/webgpu";
import { MusicSeparator } from "./separate.js";

let sep = null;

async function create(cfg, only) {
    ort.env.wasm.wasmPaths = cfg.wasmPaths;
    ort.env.wasm.numThreads = cfg.threads;
    const providers = only ?? [...(self.navigator?.gpu ? ["webgpu"] : []), "wasm"];
    let last = null;
    for (const p of providers) {
        try {
            const session = await ort.InferenceSession.create(cfg.modelUrl, {
                executionProviders: [p],
                graphOptimizationLevel: "all",
                extra: { session: { disable_quant_qdq: "1" } },
            });
            const s = new MusicSeparator(session, ort.Tensor, { dimT: cfg.dimT });
            s.backend = p;
            return s;
        } catch (e) {
            last = e;
        }
    }
    throw last ?? new Error("separator unavailable");
}

/** الموسيقى المقدّرة لا تكون أعلى كثيرًا من الأصل، ولا أرقامًا غير صالحة. */
function sane([m0, m1], l, r) {
    let em = 0, ex = 0;
    for (let i = 0; i < m0.length; i += 7) {
        if (!Number.isFinite(m0[i]) || !Number.isFinite(m1[i])) return false;
        em += m0[i] * m0[i] + m1[i] * m1[i]; ex += l[i] * l[i] + r[i] * r[i];
    }
    return em <= ex * 4 + 1e-6;
}

self.onmessage = async (e) => {
    const m = e.data;
    try {
        if (m.type === "init") {
            sep = await create(m.cfg);
            self.postMessage({ type: "ready", backend: sep.backend });
        } else if (m.type === "music") {
            const progress = (p) => self.postMessage({ type: "progress", id: m.id, p });
            let out;
            try {
                out = await sep.music(m.left, m.right, progress);
                if (!sane(out, m.left, m.right)) throw new Error("ناتج غير سليم من " + sep.backend);
            } catch (err) {
                // كرت الشاشة فشل أو أعطى ناتجًا غير سليم: نرجع للمعالج
                if (sep.backend === "wasm") throw err;
                sep = await create(m.cfg, ["wasm"]);
                self.postMessage({ type: "ready", backend: sep.backend });
                out = await sep.music(m.left, m.right, progress);
            }
            const [a, b] = [Float32Array.from(out[0]), Float32Array.from(out[1])];
            self.postMessage({ type: "done", id: m.id, m0: a, m1: b }, [a.buffer, b.buffer]);
        }
    } catch (err) {
        self.postMessage({ type: "error", id: m.id, message: String(err?.message ?? err) });
    }
};
