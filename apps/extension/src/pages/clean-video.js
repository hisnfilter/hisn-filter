// صفحة تنظيف فيديو: تعمل كاملة داخل الإضافة (النماذج نفسها التي تفحص الصفحات).
import { api } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";
import { effectiveSettings } from "@hisn/core";
import { init, analyzeRegions, analyzeAudio } from "../detector/engine.js";
import { cleanVideo } from "../cleaner/index.js";
import { HostSink } from "../cleaner/sink.js";
import { SEPARATION_FRAMES } from "../cleaner/separate.js";

function pcmToB64(x, from, to) {
    const b = new Uint8Array((to - from) * 2);
    for (let i = from, o = 0; i < to; i++, o += 2) {
        const v = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))) & 0xffff;
        b[o] = v & 0xff; b[o + 1] = v >> 8;
    }
    let s = "";
    for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode(...b.subarray(k, k + 0x8000));
    return btoa(s);
}

function b64ToPcm(s, out, offset) {
    const bin = atob(s);
    for (let i = 0, n = bin.length >> 1; i < n && offset + i < out.length; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        out[offset + i] = v / 32768;
    }
}

/** الفصل في التطبيق نفسه (أندرويد): المعالج الأصلي بعدة أنوية، أسرع بكثير من المتصفح. */
class HostSeparator {
    constructor(h) { this.host = h; this.backend = "native"; this.jobs = new Map(); }
    music(left, right, onProgress) {
        const id = "s" + Math.random().toString(36).slice(2);
        const n = left.length;
        const out = [new Float32Array(n), new Float32Array(n)];
        return new Promise((resolve, reject) => {
            this.jobs.set(id, { out, resolve, reject, onProgress });
            this.host.sepBegin(id, n);
            const STEP = 44100;
            for (let o = 0; o < n; o += STEP) this.host.sepPush(id, o, pcmToB64(left, o, Math.min(n, o + STEP)), pcmToB64(right, o, Math.min(n, o + STEP)));
            this.host.sepRun(id);
        });
    }
    message(id, kind, a, b, c) {
        const job = this.jobs.get(id);
        if (!job) return;
        if (kind === "p") job.onProgress?.(a);
        else if (kind === "d") { b64ToPcm(b, job.out[0], a); b64ToPcm(c, job.out[1], a); }
        else if (kind === "end") { this.jobs.delete(id); job.resolve(job.out); }
        else if (kind === "err") { this.jobs.delete(id); job.reject(new Error(a)); }
    }
}

/**
 * في المتصفح: الفصل في عامل مستقل (كرت الشاشة إن وُجد، وإلا المعالج بعدة أنوية).
 * يُغلق العامل بعد كل فيديو فتُحرَّر ذاكرة النموذج كلها.
 */
class WorkerSeparator {
    constructor() {
        this.backend = "…";
        this.jobs = new Map();
        this.cfg = {
            modelUrl: api.runtime.getURL("models/uvr/inst-hq4-w8.onnx"),
            wasmPaths: api.runtime.getURL("ort/"),
            threads: globalThis.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1,
            dimT: SEPARATION_FRAMES,
        };
        this.worker = new Worker(api.runtime.getURL("cleaner/separate-worker.js"));
        this.ready = new Promise((resolve, reject) => {
            this.worker.onmessage = (e) => {
                const m = e.data;
                if (m.type === "ready") { this.backend = m.backend; resolve(); return; }
                const job = this.jobs.get(m.id);
                if (m.type === "error" && !job) { reject(new Error(m.message)); return; }
                if (!job) return;
                if (m.type === "progress") job.onProgress?.(m.p);
                else if (m.type === "done") { this.jobs.delete(m.id); job.resolve([m.m0, m.m1]); }
                else if (m.type === "error") { this.jobs.delete(m.id); job.reject(new Error(m.message)); }
            };
            this.worker.onerror = (e) => reject(new Error(e.message || "worker"));
        });
        this.worker.postMessage({ type: "init", cfg: this.cfg });
    }
    async music(left, right, onProgress) {
        await this.ready;
        const id = "w" + Math.random().toString(36).slice(2);
        return new Promise((resolve, reject) => {
            this.jobs.set(id, { resolve, reject, onProgress });
            const l = Float32Array.from(left), r = Float32Array.from(right);
            this.worker.postMessage({ type: "music", id, left: l, right: r, cfg: this.cfg }, [l.buffer, r.buffer]);
        });
    }
    release() { this.worker.terminate(); }
}

/** فصل الموسيقى: في التطبيق بالمعالج الأصلي، وفي المتصفح بعامل جديد لكل فيديو (يُغلق بعده). */
let hostSeparator = null;
const separate = {
    async create() {
        if (host?.sepRun) {
            if (!hostSeparator) {
                hostSeparator = new HostSeparator(host);
                window.__hisnSep = (...args) => hostSeparator.message(...args);
            }
            return hostSeparator;
        }
        return new WorkerSeparator();
    },
};

const $ = (s) => document.querySelector(s);
const STAGES = ["read", "music", "clean", "scan", "render", "done"];
const STAGE_NAMES = { read: "قراءة الملف", music: "اكتشاف الموسيقى", clean: "حذف الموسيقى وإبقاء الكلام", scan: "فحص الصور", render: "حفظ الفيديو", done: "جاهز" };
// وزن كل مرحلة في النسبة الكلية (تقريبي من أزمنة القياس)
const WEIGHTS = { read: 0.03, music: 0.1, clean: 0.4, scan: 0.25, render: 0.22 };
let busy = false;
let lastResult = null;
let mode = "full";
// داخل تطبيق الجوال: الحفظ في معرض الصور عبر التطبيق (روابط التنزيل لا تعمل في WebView)
const host = globalThis.HisnHost;

const stageTimes = {};
let lastStage = null, lastAt = 0;
function overall(stage, p) {
    const active = STAGES.filter((x) => x !== "done" && !(mode === "music" && x === "scan"));
    const total = active.reduce((a, x) => a + WEIGHTS[x], 0);
    let sum = 0;
    for (const x of active) {
        if (x === stage) { sum += WEIGHTS[x] * p; break; }
        sum += WEIGHTS[x];
    }
    return stage === "done" ? 1 : Math.min(0.99, sum / total);
}
function mark(stage, p) {
    if (stage === "paused") {
        $("#now").textContent = "توقّف لأن التطبيق أُغلق أو خرجتَ منه — يكمل تلقائيًا الآن";
        return;
    }
    // أزمنة المراحل (للتشخيص وتحسين السرعة)
    if (stage !== lastStage) {
        const now = performance.now();
        if (lastStage) stageTimes[lastStage] = (stageTimes[lastStage] ?? 0) + (now - lastAt) / 1000;
        lastStage = stage; lastAt = now;
        document.body.dataset.stages = JSON.stringify(stageTimes);
    }
    const idx = STAGES.indexOf(stage);
    for (const li of document.querySelectorAll("#stages li")) {
        const i = STAGES.indexOf(li.dataset.s);
        li.classList.toggle("done", idx > i || stage === "done");
        li.classList.toggle("on", i === idx && stage !== "done");
        li.lastElementChild.textContent = i === idx && stage !== "done" ? `${Math.round(p * 100)}٪` : "";
    }
    const all = overall(stage, p);
    $("#bar").value = p;
    $("#pct").textContent = `${Math.round(all * 100)}٪`;
    $("#arc").style.strokeDashoffset = String(326.7 * (1 - all));
    $("#now").textContent = stage === "done" ? "" : STAGE_NAMES[stage] ?? "";
}

/** المراحل الظاهرة حسب الاختيار: «أزل الموسيقى» لا يفحص الصور ولا يغطي شيئًا. */
function layoutStages(native) {
    const music = mode === "music";
    for (const li of document.querySelectorAll("#stages li")) {
        const st = li.dataset.s;
        li.classList.toggle("skip", (music && st === "scan") || (native && st === "music"));
        if (st === "render") li.querySelector(".lbl").textContent = music ? "حفظ الفيديو" : "تغطية ما لا يناسب وحفظ الفيديو";
    }
}

/** الخلفية المختارة مكان الموسيقى، وتُحفظ للمرة القادمة. */
function currentBed() {
    return document.querySelector('input[name="bed"]:checked')?.value ?? "none";
}
{
    let saved = null;
    try { saved = host?.settings ? JSON.parse(host.settings() || "{}").musicBed : null; } catch {}
    try { saved ??= localStorage.getItem("hisn.musicBed"); } catch {}
    const el = saved && document.querySelector(`input[name="bed"][value="${CSS.escape(saved)}"]`);
    if (el) el.checked = true;
    for (const r of document.querySelectorAll('input[name="bed"]')) {
        r.addEventListener("change", () => {
            try { localStorage.setItem("hisn.musicBed", r.value); } catch {}
            host?.setPref?.("musicBed", r.value);
        });
    }
}

const fmt = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)} د ${Math.round(sec % 60)} ث` : `${Math.round(sec)} ث`);

async function run(file) {
    if (busy) return;
    busy = true;
    mode = document.querySelector('input[name="mode"]:checked')?.value ?? "full";
    $("#err").textContent = "";
    $("#result").hidden = true;
    $("#start").hidden = true;
    $("#fileCard").hidden = false;
    $("#work").hidden = false;
    $("#cancel").hidden = false;
    $("#workTitle").textContent = "جارٍ تنظيف الفيديو";
    $("#fname").textContent = file.name;
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "mp4").toUpperCase();
    $("#fmeta").textContent = `\u2068${ext}\u2069 • \u2068${(file.size / 1e6).toFixed(1)} ميجابايت\u2069`;
    layoutStages(false);
    mark("read", 0);
    try {
        const s = effectiveSettings((await send(api, { type: MSG.GET_SETTINGS })) ?? {});
        // الاختيار في الصفحة: «أزل الموسيقى» فقط، أو «منقّى كاملًا» (الموسيقى والصور)
        s.removeMusic = true;
        s.cleanImages = mode !== "music";
        s.musicBed = currentBed();
        await init();
        const t0 = performance.now();
        const name = file.name.replace(/\.[^.]+$/, "") + "-نظيف.mp4";
        const { blob, report, external } = await cleanVideo(file, s, {
            analyzeRegions,
            analyzeAudio,
            separate,
            // داخل التطبيق: الناتج يُكتب مباشرة في ملف عند التطبيق (لا يبقى في ذاكرة الصفحة)
            sink: host ? new HostSink(host) : undefined,
            hostAudio: !!host?.merge,
            onProgress: (stage, p) => mark(stage === "encode-audio" ? "render" : stage, p),
        });
        if (host && external) {
            // الصوت النظيف منفصل: يدمجه التطبيق مع الصورة أولًا، فتُسمع المعاينة كما سيُحفظ
            mark("render", 1);
            $("#now").textContent = "دمج الصوت مع الصورة";
            await new Promise((resolve, reject) => {
                window.__hisnMerged = (ok, message) => (ok ? resolve() : reject(new Error(message || "تعذّر دمج الصوت")));
                host.merge();
            });
        }
        if (host) {
            $("#out").src = new URL("../output/video", location.href).href + "?t=" + Date.now();
        } else {
            const url = URL.createObjectURL(blob);
            $("#out").src = url;
            $("#save").href = url;
            $("#save").download = name;
        }
        lastResult = { name };
        const lines = [
            `مدة الفيديو: ${fmt(report.duration)}، والمعالجة أخذت ${fmt((performance.now() - t0) / 1000)}.`,
            report.coveredSeconds ? `غُطّيت مناطق مخالفة في نحو ${fmt(report.coveredSeconds)}${report.fullSeconds ? `، منها ${fmt(report.fullSeconds)} غُطّي فيها الإطار كله` : ""}.` : "لا صور مخالفة.",
            report.musicSeconds ? `حُذفت الموسيقى من ${fmt(report.musicSeconds)} وبقي الكلام.` : "لا موسيقى.",
            report.singerSeconds ? `كُتم صوت الغناء في ${fmt(report.singerSeconds)}.` : "",
            report.bed ? `وُضعت خلفية «${{ rain: "مطر خفيف", breeze: "نسيم", waves: "أمواج" }[report.bed] ?? ""}» مكان الموسيقى.` : "",
            report.keptVoice ? "أُبقي الكلام كاملًا (الصوت يشبه الغناء لكنه كلام)." : "",
        ].filter(Boolean);
        $("#report").innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
        $("#result").hidden = false;
        $("#work").hidden = true;
        document.body.dataset.state = "done";
        document.body.dataset.report = JSON.stringify(report);
    } catch (e) {
        $("#err").textContent = "تعذّر تنظيف هذا الفيديو: " + (e?.message ?? e);
        $("#workTitle").textContent = "لم يكتمل التنظيف";
        $("#cancel").textContent = "المحاولة بفيديو آخر";
        document.body.dataset.state = "error";
        document.body.dataset.error = String(e?.stack ?? e);
    } finally {
        busy = false;
    }
}

/** الملف جاهز عند التطبيق: يحفظه في الاستوديو. */
function saveToHost() {
    if (!lastResult) return;
    const btn = $("#save");
    btn.setAttribute("aria-disabled", "true");
    btn.textContent = "جارٍ الحفظ…";
    host.finish(lastResult.name);
}
/** يستدعيه التطبيق بعد الحفظ. */
window.__hisnSaved = (ok, message) => {
    const btn = $("#save");
    btn.removeAttribute("aria-disabled");
    btn.textContent = ok ? "حُفظ في الاستوديو ✓" : "حفظ الفيديو";
    if (!ok) $("#err").textContent = "تعذّر الحفظ: " + (message ?? "");
    document.body.dataset.saved = ok ? "1" : "0";
};
if (host) {
    $("#save").removeAttribute("download");
    $("#save").addEventListener("click", (e) => { e.preventDefault(); saveToHost(); });
}

$("#file").onchange = (e) => e.target.files[0] && run(e.target.files[0]);

// الآيفون: «أزل الموسيقى» يعمل بكود الجوال نفسه فيكمل حتى لو خرج المستخدم من التطبيق، ثم يحفظ في الصور ويرسل إشعارًا
if (host?.nativeMusic) {
    $("#drop").addEventListener("click", (e) => {
        if (document.querySelector('input[name="mode"]:checked')?.value !== "music") return;
        e.preventDefault();
        host.nativeMusic(currentBed());
    });
    window.__hisnNativeStart = (name, sizeMb) => {
        mode = "music";
        $("#start").hidden = true;
        $("#fileCard").hidden = false;
        $("#work").hidden = false;
        $("#cancel").hidden = true;
        $("#err").textContent = "";
        $("#fname").textContent = name;
        $("#fmeta").textContent = sizeMb ? `\u2068${Number(sizeMb).toFixed(1)} ميجابايت\u2069` : "";
        $("#workTitle").textContent = "جارٍ إزالة الموسيقى";
        $("#stay").textContent = "يمكنك الخروج من التطبيق: يكمل العمل ويصلك إشعار عند الانتهاء";
        layoutStages(true);
        mark("read", 0);
    };
    window.__hisnNativeProgress = (p, stage) => {
        const st = p < 0.08 ? "read" : p < 0.88 ? "clean" : "render";
        const local = st === "read" ? p / 0.08 : st === "clean" ? (p - 0.08) / 0.8 : (p - 0.88) / 0.12;
        mark(st, Math.max(0, Math.min(1, local)));
        $("#pct").textContent = `${Math.round(p * 100)}٪`;
        $("#arc").style.strokeDashoffset = String(326.7 * (1 - p));
        if (stage) $("#now").textContent = stage;
    };
    window.__hisnNativeDone = (ok, message) => {
        if (ok) {
            mark("done", 1);
            $("#workTitle").textContent = message;
            $("#now").textContent = "";
            document.body.dataset.state = "done";
        } else {
            $("#workTitle").textContent = "لم يكتمل التنظيف";
            $("#err").textContent = message;
            document.body.dataset.state = "error";
        }
        $("#cancel").hidden = false;
        $("#cancel").textContent = "تنظيف فيديو آخر";
    };
}
// الإلغاء وإعادة البدء: نعيد تحميل الصفحة فيتوقف كل شيء وتُحرَّر الذاكرة
$("#cancel").onclick = () => location.replace(location.pathname);
$("#again").onclick = () => location.replace(location.pathname);
const drop = $("#drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) run(f); };
/**
 * فيديو مُشارك من تطبيق آخر (زر «مشاركة» ← فلتر حصن): يقدّمه التطبيق على عنوان ثابت ويُقرأ على أجزاء
 * (طلبات Range) فلا يُحمَّل كله في الذاكرة.
 */
class RangeFile {
    constructor(url, size, name, type = "video/mp4") { Object.assign(this, { url, size, name, type }); }
    slice(a, b) {
        const url = this.url, end = Math.min(this.size, b ?? this.size);
        return {
            size: end - a,
            arrayBuffer: async () => {
                if (end <= a) return new ArrayBuffer(0);
                const r = await fetch(url, { headers: { Range: `bytes=${a}-${end - 1}` } });
                if (!r.ok) throw new Error("تعذّر قراءة الفيديو المُشارك (" + r.status + ")");
                return r.arrayBuffer();
            },
        };
    }
    arrayBuffer() { return this.slice(0, this.size).arrayBuffer(); }
}
if (host && location.hash === "#shared") {
    const size = Number(host.sharedSize?.() ?? 0);
    const url = new URL("../shared/video", location.href).href;
    if (size > 0) run(new RangeFile(url, size, decodeURIComponent(host.sharedName?.() ?? "video.mp4")));
    else $("#err").textContent = "تعذّر فتح الفيديو المُشارك.";
}
// للاختبار الآلي
window.__hisnClean = run;
