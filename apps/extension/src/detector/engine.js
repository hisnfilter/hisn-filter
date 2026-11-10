// محرك الكشف: يشغّل نموذجين على الجهاز ويُرجع تحليلًا واحدًا للصورة.
//  1) NudeNet 320n عبر onnxruntime-web: يحدد أماكن العورات المكشوفة ووجوه النساء والرجال.
//  2) Human عبر TensorFlow.js: الوجوه (الجنس والعمر) والأجسام (حتى لو لم يظهر الوجه).
// كل النماذج داخل الإضافة؛ لا شيء يُحمَّل من الإنترنت ولا تُرسل أي صورة.
import * as ort from "onnxruntime-web/webgpu";
import Human from "@vladmandic/human";
import { letterbox, rgbaToTensor, postprocess, summarizeNudity, fusePeople, thighExposure, thighFromFace, drawnRegion, summarizeAudio, NUDENET_SIZE, YAMNET_WINDOW, sceneFrom, SCENE_SIZE } from "@hisn/core";
import { api } from "../shared/settings.js";

let nudeSession = null;

/** خيوط متعددة للمعالج حين تكون الصفحة معزولة (صفحات التطبيق وتنظيف الفيديو)، وإلا خيط واحد. */
function wasmThreads() {
    return globalThis.crossOriginIsolated ? Math.max(1, Math.min(4, globalThis.navigator?.hardwareConcurrency ?? 1)) : 1;
}
let human = null;
let ready = null;
let backendInfo = "";

const humanConfig = () => ({
    modelBasePath: api.runtime.getURL("models/human/"),
    backend: "humangl",
    warmup: "none",
    cacheSensitivity: 0, // لا نعيد استخدام نتائج سابقة: كل صورة تُفحص كاملة
    async: true,
    filter: { enabled: false },
    face: {
        enabled: true,
        // حتى 20 وجهًا: في الصور الجماعية كانت 10 تُسقط وجوهًا (كل وجه يُفحص جنسه)
        detector: { modelPath: "blazeface.json", maxDetected: 20, minConfidence: 0.3, rotation: false, return: false },
        mesh: { enabled: false },
        iris: { enabled: false },
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
        // ثقة الجنس في faceres = 2×|p−0.5| (من 0 إلى 1). جرّبنا GEAR فكان أسوأ في صور النساء.
        description: { enabled: true, modelPath: "faceres.json", minConfidence: 0 },
    },
    body: { enabled: true, modelPath: "movenet-multipose.json", maxDetected: 6, minConfidence: 0.25 },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
    segmentation: { enabled: false },
});

async function createNudeSession() {
    ort.env.wasm.wasmPaths = api.runtime.getURL("ort/");
    ort.env.wasm.numThreads = wasmThreads();
    ort.env.wasm.proxy = false;
    const model = api.runtime.getURL("models/nudenet/320n.onnx");
    const providers = [];
    if (globalThis.navigator?.gpu && !globalThis.__hisnNoWebGPU) providers.push("webgpu");
    providers.push("wasm");
    for (const p of providers) {
        try {
            const s = await ort.InferenceSession.create(model, { executionProviders: [p], graphOptimizationLevel: "all" });
            backendInfo = `nudenet:${p}`;
            return s;
        } catch (e) {
            console.warn("Hisn: تعذّر تشغيل NudeNet على", p, e);
        }
    }
    throw new Error("NudeNet unavailable");
}

/** حالة النماذج لمؤشر الصحة: loading | ready | failed. */
export const health = { images: "loading", audio: "idle", error: "" };
let lastFail = 0;

export function init() {
    // بعد فشل: نعيد المحاولة عند الطلب التالي (بعد 10 ثوانٍ على الأقل)، لا نبقى معطلين للأبد
    if (!ready && Date.now() - lastFail < 10_000) return Promise.reject(new Error("init retry later"));
    ready ??= (async () => {
        health.images = "loading";
        const [s, h] = await Promise.all([
            createNudeSession(),
            (async () => {
                const hm = new Human(humanConfig());
                await hm.load();
                return hm;
            })(),
        ]);
        nudeSession = s;
        human = h;
        backendInfo += ` human:${human.tf.getBackend()}`;
        health.images = "ready";
        return true;
    })().catch((e) => {
        ready = null;
        lastFail = Date.now();
        health.images = "failed";
        health.error = String(e).slice(0, 200);
        throw e;
    });
    return ready;
}

export function info() {
    return backendInfo;
}

const canvas = new OffscreenCanvas(NUDENET_SIZE, NUDENET_SIZE);
const ctx = canvas.getContext("2d", { willReadFrequently: true });

async function runNudeNet(bitmap) {
    const { width, height } = bitmap;
    const { side } = letterbox(width, height);
    // الصورة في الزاوية العلوية اليسرى، والفراغ أسود يمين وأسفل (مثل الكود الأصلي)
    const scale = NUDENET_SIZE / side;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, NUDENET_SIZE, NUDENET_SIZE);
    ctx.drawImage(bitmap, 0, 0, width * scale, height * scale);
    const { data } = ctx.getImageData(0, 0, NUDENET_SIZE, NUDENET_SIZE);
    const input = new ort.Tensor("float32", rgbaToTensor(data), [1, 3, NUDENET_SIZE, NUDENET_SIZE]);
    const out = await nudeSession.run({ [nudeSession.inputNames[0]]: input });
    const t = out[nudeSession.outputNames[0]];
    return postprocess(t.data, t.dims, width, height);
}

/**
 * نظرة ثانية مقرّبة: امرأة صغيرة في صورة واسعة (بجانب رجل مثلًا) تصغر عند NudeNet فلا يرى البطن أو الصدر.
 * نقص حولها ونفحص القطعة وحدها، ثم نعيد المواضع لإحداثيات الصورة. حد أقصى شخصان.
 */
async function zoomNudeNet(bitmap, people) {
    const W = bitmap.width, H = bitmap.height;
    const picks = people
        .filter((p) => p.gender !== "male" && p.area < 0.7 && p.box[2] >= 40 && p.box[3] >= 60)
        .sort((a, b) => b.area - a.area)
        .slice(0, 2);
    const out = [];
    for (const p of picks) {
        let [x, y, w, h] = p.box;
        // قطعتان: الشخص كاملًا، والنصف العلوي منه (الصدر والبطن أكبر فيظهران بوضوح)
        const full = [Math.max(0, x - w * 0.2), Math.max(0, y - h * 0.08)];
        full.push(Math.min(W - full[0], w * 1.4), Math.min(H - full[1], h * 1.16));
        const upper = [full[0], full[1], full[2], Math.min(H - full[1], h * 0.66)];
        for (const [cx, cy, cw, ch] of [full, upper]) {
            if (cw < 32 || ch < 32) continue;
            const crop = await createImageBitmap(bitmap, Math.round(cx), Math.round(cy), Math.round(cw), Math.round(ch));
            try {
                for (const d of await runNudeNet(crop)) out.push({ ...d, box: [d.box[0] + cx, d.box[1] + cy, d.box[2], d.box[3]], zoom: true });
            } finally {
                crop.close();
            }
        }
    }
    return out;
}

/** بكسلات الصورة مصغّرة (لقياس لون البشرة على الفخذ). */
function smallPixels(bitmap, max = 512) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    return { rgba: ctx.getImageData(0, 0, w, h).data, w, h, scale };
}

const LEG_PARTS = ["leftHip", "rightHip", "leftKnee", "rightKnee"];
const FEMALE_PARTS = ["FACE_FEMALE", "FEMALE_BREAST_COVERED", "FEMALE_BREAST_EXPOSED", "BUTTOCKS_COVERED", "BUTTOCKS_EXPOSED", "FEMALE_GENITALIA_COVERED", "BELLY_EXPOSED"];

/** نسبة البشرة بين الورك والركبة لجسم واحد (null إن لم تظهر الساقان بوضوح). */
function thighOf(body, px) {
    const kp = {};
    for (const k of body.keypoints ?? []) {
        if (LEG_PARTS.includes(k.part)) kp[k.part] = [k.position[0] * px.scale, k.position[1] * px.scale, k.score ?? 0];
    }
    const r = thighExposure(kp, px.rgba, px.w, px.h);
    return r && { score: r.score, box: r.box.map((v) => v / px.scale) };
}

function faceThigh(box, px) {
    const r = thighFromFace(box.map((v) => v * px.scale), px.rgba, px.w, px.h);
    return r && { score: r.score, box: r.box.map((v) => v / px.scale) };
}

async function runHuman(bitmap) {
    const res = await human.detect(bitmap);
    const found = (res.body ?? []).filter((b) => b.score >= 0.25);
    const px = smallPixels(bitmap);
    const drawn = (box) => drawnRegion(box.map((v) => v * px.scale), px.rgba, px.w, px.h);
    const faces = (res.face ?? []).map((f) => ({
        thigh: faceThigh(f.box, px),
        look: drawn(f.box),
        box: f.box,
        score: f.score,
        gender: f.gender ?? "unknown",
        genderScore: f.genderScore ?? 0,
        age: f.age,
    }));
    const bodies = found.map((b) => ({ box: b.box, score: b.score, thigh: thighOf(b, px), look: drawn(b.box) }));
    return { faces, bodies, lookOf: drawn };
}

/**
 * يحلل صورة (ImageBitmap) ويُرجع ما تحتاجه سياسة المحتوى:
 * { analyzed, nudity, sexual, people[], detections[] }
 */
export async function analyzeBitmap(bitmap) {
    await init();
    const [first, { faces, bodies, lookOf }] = await Promise.all([runNudeNet(bitmap), runHuman(bitmap)]);
    const nnFaces = summarizeNudity(first).faces;
    const people = fusePeople({ faces, bodies, nnFaces, width: bitmap.width, height: bitmap.height, lookOf });
    const detections = [...first, ...(await zoomNudeNet(bitmap, people))];
    const { nudity, sexual } = summarizeNudity(detections);
    // نموذج المشهد دائمًا: يمسك ما تفوّته النماذج الأخرى (امرأة من الخلف، ساقان، رسم) والمحتوى الإيحائي حتى مع وجود امرأة (للمرأة)
    const scene = await runScene(bitmap).catch(() => null);
    return {
        analyzed: true,
        // فحص ناقص (نموذج المشهد لم يعمل): السياسة تعامله بحذر في الصارم، ومؤشر الصحة يعلنه
        partial: scene === null && sceneFailed,
        nudity,
        sexual,
        scene,
        // الصندوق نسبي (0..1) لتغطية الشخص وحده في الصورة؛ صندوق الفخذ للتشخيص فقط فلا يُرسل
        people: people.map(({ box, thighBox, ...p }) => ({ ...p, box: [box[0] / bitmap.width, box[1] / bitmap.height, box[2] / bitmap.width, box[3] / bitmap.height] })),
        detections: detections.map((d) => d.class),
        // أجزاء امرأة بمواضعها (نسبية) — للتأكد أن التغطية الجزئية لم تُفلت أحدًا
        parts: detections
            .filter((d) => FEMALE_PARTS.includes(d.class) && d.score >= 0.35)
            .map((d) => ({ class: d.class, score: +d.score.toFixed(2), box: [d.box[0] / bitmap.width, d.box[1] / bitmap.height, d.box[2] / bitmap.width, d.box[3] / bitmap.height] })),
        // للتشخيص فقط: آراء النماذج قبل الدمج (أرقام بلا صور)
        raw: {
            faces: faces.map((f) => [f.gender, +f.genderScore.toFixed(2), Math.round(f.age ?? 0)]),
            nnFaces: nnFaces.map((f) => [f.gender, +f.score.toFixed(2)]),
            bodies: bodies.length,
            thighs: bodies.map((b) => (b.thigh ? +b.thigh.score.toFixed(2) : null)),
            faceThighs: faces.map((f) => (f.thigh ? +f.thigh.score.toFixed(2) : null)),
            looks: [...faces, ...bodies].map((x) => x.look && [x.look.drawn ? 1 : 0, +x.look.skin.toFixed(2), +x.look.flat.toFixed(2), +x.look.texture.toFixed(1), +x.look.sat.toFixed(2)]),
        },
    };
}

// ===== فهم الصورة كاملة: MobileCLIP-S0 (Apple) =====
// يُشغَّل على كل صورة؛ فشله يُعلن (partial) ولا يُفسَّر سلامةً.
// يُحمَّل عند أول حاجة، وإن تعذّر (جهاز ضعيف) نكمل بدونه.
let sceneSession = null, sceneFailed = false;
const sceneCanvas = new OffscreenCanvas(SCENE_SIZE, SCENE_SIZE);
const sceneCtx = sceneCanvas.getContext("2d", { willReadFrequently: true });

async function runScene(bitmap) {
    if (sceneFailed) return null;
    try {
        sceneSession ??= await ort.InferenceSession.create(api.runtime.getURL("models/clip/mobileclip-s0.onnx"), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    } catch (e) {
        sceneFailed = true;
        console.warn("Hisn: تعذّر تشغيل نموذج المشهد", e);
        return null;
    }
    // أقصر ضلع = 256 ثم قص الوسط، بقيم 0..1
    const { width: w, height: h } = bitmap, k = SCENE_SIZE / Math.min(w, h);
    sceneCtx.fillStyle = "#000";
    sceneCtx.fillRect(0, 0, SCENE_SIZE, SCENE_SIZE);
    sceneCtx.drawImage(bitmap, (SCENE_SIZE - w * k) / 2, (SCENE_SIZE - h * k) / 2, w * k, h * k);
    const px = sceneCtx.getImageData(0, 0, SCENE_SIZE, SCENE_SIZE).data, n = SCENE_SIZE * SCENE_SIZE;
    const x = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { x[i] = px[i * 4] / 255; x[n + i] = px[i * 4 + 1] / 255; x[2 * n + i] = px[i * 4 + 2] / 255; }
    const out = await sceneSession.run({ [sceneSession.inputNames[0]]: new ort.Tensor("float32", x, [1, 3, SCENE_SIZE, SCENE_SIZE]) });
    return sceneFrom(out[sceneSession.outputNames[0]].data);
}

// ===== الصوت: YAMNet (Google، Apache-2.0) لتمييز الموسيقى من الكلام =====
// يُحمَّل عند أول طلب فقط (حين يفعّل المستخدم إزالة الموسيقى)، ويعمل على المعالج (WASM).
let audioSession = null;

async function createAudioSession() {
    ort.env.wasm.wasmPaths = api.runtime.getURL("ort/");
    ort.env.wasm.numThreads = wasmThreads();
    return ort.InferenceSession.create(api.runtime.getURL("models/yamnet/yamnet.onnx"), {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
    });
}

/**
 * يحلل نافذة صوت (15600 عينة بتردد 16kHz) ويُرجع ملخصًا: كلام، وغناء، وموسيقى، وآلات، وأنواع موسيقى.
 * @param {Float32Array} samples
 */
export async function analyzeAudio(samples) {
    if (!audioSession) {
        health.audio = "loading";
        try {
            audioSession = await createAudioSession();
            health.audio = "ready";
        } catch (e) {
            health.audio = "failed";
            throw e;
        }
    }
    const input = new Float32Array(YAMNET_WINDOW);
    input.set(samples.subarray(0, YAMNET_WINDOW));
    const out = await audioSession.run({ [audioSession.inputNames[0]]: new ort.Tensor("float32", input, [YAMNET_WINDOW]) });
    return summarizeAudio(out[audioSession.outputNames[0]].data);
}

/**
 * مثل analyzeBitmap لكن يُرجع المواضع أيضًا (صناديق العورات والأشخاص بإحداثيات الصورة)،
 * لتغطية المنطقة المخالفة وحدها في تنظيف الفيديو.
 */
export async function analyzeRegions(bitmap) {
    await init();
    const [first, { faces, bodies, lookOf }] = await Promise.all([runNudeNet(bitmap), runHuman(bitmap)]);
    const people = fusePeople({ faces, bodies, nnFaces: summarizeNudity(first).faces, width: bitmap.width, height: bitmap.height, lookOf });
    const detections = [...first, ...(await zoomNudeNet(bitmap, people))];
    return { width: bitmap.width, height: bitmap.height, detections, people };
}
