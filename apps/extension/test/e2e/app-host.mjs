// محاكاة تطبيق الجوال: صفحة التنظيف (dist/web) داخل متصفح بلا إضافة، مع جسر HisnHost كما يقدّمه
// أندرويد (addJavascriptInterface) وآيفون (WKScriptMessageHandler)، وبنفس تخطيط العناوين:
//   /pages /audio /ort /models/human ← dist/web
//   /models/nudenet/320n.onnx و /models/yamnet/yamnet.onnx ← ملفات التطبيق (هي نفسها نماذج الفحص المباشر)
//   /shared/video ← الفيديو المُشارك من تطبيق آخر
// الحالات: اختيار من الاستوديو + حفظ على دفعات، فيديو مُشارك، ومتصفح بلا مرمّز صوت (آيفون قبل 26).
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "../../dist/web");
const models = join(here, "../../static/models");
const site = join(here, "site");
const require = createRequire(process.env.PLAYWRIGHT_DIR ?? "/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const SHARED = join(site, "gallery-rotated.mp4");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".mp4": "video/mp4" };
const server = createServer((rq, rs) => {
    const path = decodeURIComponent(new URL(rq.url, "http://x").pathname);
    let file = null;
    if (path === "/shared/video") {
        // مثل التطبيق: طلبات Range للفيديو المُشارك
        const buf = readFileSync(SHARED);
        const m = /bytes=(\d+)-(\d*)/.exec(rq.headers.range ?? "");
        if (m) {
            const a = +m[1], b = m[2] ? +m[2] : buf.length - 1;
            rs.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes ${a}-${b}/${buf.length}`, "content-length": b - a + 1 });
            return rs.end(buf.subarray(a, b + 1));
        }
        rs.writeHead(200, { "content-type": "video/mp4" });
        return rs.end(buf);
    }
    else if (path.startsWith("/models/nudenet/") || path.startsWith("/models/yamnet/")) file = join(models, path.slice("/models/".length));
    else file = join(web, path);
    if (!file.startsWith(web) && !file.startsWith(models) && file !== SHARED) { rs.writeHead(403); return rs.end(); }
    if (!existsSync(file) || statSync(file).isDirectory()) { rs.writeHead(404); return rs.end(); }
    // مثل التطبيق: صفحات معزولة (خيوط متعددة للمعالج)
    rs.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "same-origin" });
    rs.end(readFileSync(file));
}).listen(0);
const ORIGIN = `http://localhost:${server.address().port}`;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const tmp = mkdtempSync(join(tmpdir(), "hisn-app-"));
const browser = await chromium.launch({ channel: "chromium", args: ["--autoplay-policy=no-user-gesture-required", ...(process.env.WEBGPU ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--disable-vulkan-surface"] : [])] });

/** جسر التطبيق: يجمع الدفعات كما يكتبها التطبيق في ملف، ثم يستدعي __hisnSaved. */
const HOST = (settings, noAudioEncoder, nativeSep = false) => `
${nativeSep ? `
// محاكاة الفصل الأصلي في أندرويد: «الموسيقى» = نصف الصوت (لاختبار الجسر نفسه: التقسيم والترميز والردود)
window.__sep = {}; window.__k = ${process.env.SEPK ?? 0.5};
const __dec = (s) => { const b = atob(s), o = new Float32Array(b.length >> 1); for (let i = 0; i < o.length; i++) { let v = b.charCodeAt(2*i) | (b.charCodeAt(2*i+1) << 8); if (v >= 0x8000) v -= 0x10000; o[i] = v / 32768; } return o; };
const __enc = (x) => { let s = ""; for (let i = 0; i < x.length; i++) { const v = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))) & 0xffff; s += String.fromCharCode(v & 0xff, v >> 8); } return btoa(s); };
` : ""}
${noAudioEncoder ? "delete window.AudioEncoder; delete window.AudioDecoder;" : ""}
window.__parts = {}; window.__saved = null;
window.HisnHost = {
  settings: () => ${JSON.stringify(JSON.stringify(settings))},
  sharedName: () => "shared-clip.mp4",
  sharedSize: () => ${statSync(SHARED).size},
  begin: (part, mime) => { window.__parts[part] = []; },
  write: (part, pos, b64) => { window.__parts[part].push([pos, b64]); },
  finish: (name) => { window.__saved = name; setTimeout(() => window.__hisnSaved(true), 10); },
  ${nativeSep ? `
  sepBegin: (id, n) => { window.__sep[id] = [new Float32Array(n), new Float32Array(n)]; },
  sepPush: (id, o, l, r) => { window.__sep[id][0].set(__dec(l), o); window.__sep[id][1].set(__dec(r), o); },
  sepRun: (id) => setTimeout(() => {
    const [L, R] = window.__sep[id]; window.__sepRuns = (window.__sepRuns || 0) + 1;
    window.__hisnSep(id, "p", 0.5);
    for (let o = 0; o < L.length; o += 44100) window.__hisnSep(id, "d", o, __enc(L.subarray(o, o + 44100).map((v) => v * (window.__k ?? 0.5))), __enc(R.subarray(o, o + 44100).map((v) => v * (window.__k ?? 0.5))));
    window.__hisnSep(id, "end");
  }, 5),` : ""}
};`;

async function runCase(label, { settings, noAudioEncoder = false, shared = false, nativeSep = false, file = join(site, "gallery-test.mp4") }) {
    if (process.env.ONLY && !label.includes(process.env.ONLY)) return null;
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(HOST(settings, noAudioEncoder, nativeSep));
    await page.goto(`${ORIGIN}/pages/clean-video.html${shared ? "#shared" : ""}`);
    if (!shared) await page.setInputFiles("#file", file);
    await page.waitForFunction(() => document.body.dataset.state, null, { timeout: 900000 });
    const state = await page.evaluate(() => document.body.dataset.state);
    if (process.env.SHOW_REPORT) console.log("   ", label, await page.evaluate(() => document.body.dataset.report), "المراحل:", await page.evaluate(() => document.body.dataset.stages));
    check(`${label}: يكتمل بلا خطأ`, state === "done", state === "done" ? "" : await page.evaluate(() => document.body.dataset.error?.slice(0, 500)));
    if (state !== "done") { await page.close(); return null; }
    await page.click("#save");
    await page.waitForFunction(() => document.body.dataset.saved, null, { timeout: 120000 });
    const saved = await page.evaluate(() => ({ name: window.__saved, ok: document.body.dataset.saved, label: document.getElementById("save").textContent, parts: Object.fromEntries(Object.entries(window.__parts).map(([k, v]) => [k, v])) }));
    check(`${label}: الحفظ عبر التطبيق`, saved.ok === "1" && /نظيف\.mp4$/.test(saved.name) && saved.label.includes("✓"), `${saved.name} · ${saved.label}`);
    const out = {};
    for (const [part, chunks] of Object.entries(saved.parts)) {
        const p = join(tmp, `${label.replace(/\s+/g, "-")}-${part}.${part === "audio" ? "wav" : "mp4"}`);
        // مثل RandomAccessFile في التطبيق: كل كتابة في موضعها
        const pieces = chunks.map(([pos, b64]) => [pos, Buffer.from(b64, "base64")]);
        const size = Math.max(...pieces.map(([pos, b]) => pos + b.length));
        const buf = Buffer.alloc(size);
        for (const [pos, b] of pieces) b.copy(buf, pos);
        writeFileSync(p, buf);
        out[part] = p;
        if (process.env.KEEP_OUT) (await import("node:fs")).copyFileSync(p, join(process.env.KEEP_OUT, p.split("/").pop()));
    }
    check(`${label}: لا أخطاء في الصفحة`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
    return out;
}

const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,sample_rate:format=duration", "-of", "json", f]).toString());
const rms = (file, a, d) => {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(a), "-t", String(d), "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
};
const frameDiff = (a0, b0, t) => {
    const frame = (f) => execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", "scale=96:72", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    const a = frame(a0), b = frame(b0);
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length;
};
const db = (x) => (20 * Math.log10(x + 1e-9)).toFixed(1);
const ORIG = join(site, "gallery-test.mp4");

try {
    const male = { viewer: "male", level: "medium", removeMusic: true };

    // 1) من الاستوديو، مع الحفظ على دفعات
    // للعرض: تنظيف ملف معيّن (DEMO=مسار ONLY=عرض KEEP_OUT=مجلد)
    if (process.env.DEMO) await runCase("عرض", { settings: male, file: process.env.DEMO });
    const r1 = await runCase("من الاستوديو", { settings: male });
    if (r1) {
        const info = probe(r1.video);
        const types = info.streams.map((s) => s.codec_type).sort().join(",");
        check("من الاستوديو: الملف المحفوظ سليم (صورة وصوت)", types === "audio,video" && Math.abs(+info.format.duration - 12.6) < 0.6, `${types} ${info.format.duration}`);
        const before = rms(ORIG, 4.0, 2.0), after = rms(r1.video, 4.0, 2.0);
        const dw = frameDiff(ORIG, r1.video, 2);
        check("من الاستوديو: المرأة مغطاة (إعدادات التطبيق مكتملة بالافتراضي)", dw > 20, `فرق ${dw.toFixed(1)}`);
        check("من الاستوديو: الموسيقى حُذفت في الملف المحفوظ (30dB على الأقل)", after < before / 31.6, `${db(before)} ← ${db(after)} dB`);
    }

    // 2) فيديو مُشارك من تطبيق آخر (عمودي)
    const r2 = await runCase("فيديو مُشارك", { settings: male, shared: true });
    if (r2) check("فيديو مُشارك: الملف المحفوظ فيه صورة", probe(r2.video).streams.some((s) => s.codec_type === "video"));

    // 3) متصفح بلا مرمّز صوت ولا فاك صوت (Safari قبل iOS 26): الصوت يُفك بالمتصفح ويُسلَّم WAV ليدمجه التطبيق
    const r3 = await runCase("بلا مرمّز صوت", { settings: male, noAudioEncoder: true });
    if (r3) {
        const v = probe(r3.video), w = r3.audio && probe(r3.audio);
        check("بلا مرمّز صوت: فيديو بلا صوت + ملف WAV منفصل", !v.streams.some((s) => s.codec_type === "audio") && w?.streams?.[0]?.codec_name === "pcm_s16le", w ? `${w.streams[0].codec_name} ${w.format.duration}ث` : "لا WAV");
        if (w) {
            const before = rms(ORIG, 4.0, 2.0), after = rms(r3.audio, 4.0, 2.0);
            const sb = rms(ORIG, 8, 2), sa = rms(r3.audio, 8, 2);
            check("بلا مرمّز صوت: الموسيقى حُذفت (25dB على الأقل) والكلام باقٍ في WAV", after < before / 17.8 && sa > sb / 3, `موسيقى ${db(before)} ← ${db(after)}، كلام ${db(sb)} ← ${db(sa)}`);
        }
    }

    // 5) كلام فوق موسيقى (الأكثر شيوعًا): الكلام يبقى واضحًا والموسيقى تُحذف من تحته
    const r5 = await runCase("كلام فوق موسيقى", { settings: male, file: join(site, "talk-over-music.mp4") });
    if (r5) {
        const pcm = (f, args) => {
            const raw = execFileSync("ffmpeg", ["-v", "error", ...args, "-i", f, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 });
            return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
        };
        const ref = pcm(ORIG, ["-ss", "7.2", "-t", "5.4"]); // الكلام وحده (المصدر الذي خُلط)
        const mix = pcm(join(site, "talk-over-music.mp4"), []);
        const out = pcm(r5.video, []);
        // نسبة الكلام إلى كل ما سواه (مع أفضل محاذاة وكسب)
        const sdr = (y) => {
            let best = -Infinity;
            for (let lag = -800; lag <= 800; lag += 8) {
                let rr = 0, ry = 0;
                for (let i = 1600; i < ref.length - 1600; i++) { const v = y[i + lag] ?? 0; rr += ref[i] * ref[i]; ry += ref[i] * v; }
                const g = ry / rr;
                let e = 0;
                for (let i = 1600; i < ref.length - 1600; i++) { const d = (y[i + lag] ?? 0) - g * ref[i]; e += d * d; }
                best = Math.max(best, 10 * Math.log10((g * g * rr) / Math.max(1e-12, e)));
            }
            return best;
        };
        const before = sdr(mix), after = sdr(out);
        check("كلام فوق موسيقى: الكلام أوضح بكثير بعد التنظيف", after - before >= 6, `نسبة الكلام ${before.toFixed(1)} ← ${after.toFixed(1)} dB`);
        const lvl = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
        check("كلام فوق موسيقى: الكلام لم يُكتم", lvl(out) > lvl(ref) / 2, `${db(lvl(ref))} ← ${db(lvl(out))} dB`);
    }

    // 6) فيديو طويل (LONG=1): 3 دقائق — الذاكرة لا تكبر مع طول الفيديو (القراءة والكتابة على دفعات)
    if (process.env.LONG) {
        const long = join(tmp, "long.mp4");
        execFileSync("ffmpeg", ["-v", "error", "-stream_loop", String(Number(process.env.LONG) > 1 ? Number(process.env.LONG) - 1 : 14), "-i", ORIG, "-c", "copy", long]);
        const page = await browser.newPage();
        await page.addInitScript(HOST(process.env.NOSCAN ? { ...male, removeMusic: false } : male, false));
        if (process.env.NOSCAN) await page.addInitScript("globalThis.__noscan = true");
        if (process.env.COVERALL) await page.addInitScript("globalThis.__hisnCoverAll = true");
        await page.goto(`${ORIGIN}/pages/clean-video.html`);
        const t0 = Date.now();
        await page.setInputFiles("#file", long);
        let peak = 0;
        while (!(await page.evaluate(() => document.body.dataset.state))) {
            // ذاكرة عملية الصفحة الفعلية (تشمل النماذج وبيانات الصوت والصورة، لا كائنات JS وحدها)
            const rss = execFileSync("ps", ["-C", "chrome", "-o", "rss=,args="]).toString().split("\n")
                .filter((l) => l.includes("--type=renderer")).map((l) => parseInt(l) * 1024);
            peak = Math.max(peak, ...rss, 0);
            if (process.env.TRACE) {
                const cdp0 = page.__cdp ??= await page.context().newCDPSession(page);
                if (!page.__perf) { await cdp0.send("Performance.enable"); page.__perf = true; }
                const mm = (await cdp0.send("Performance.getMetrics")).metrics;
                process.stdout.write("      heap " + ((mm.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0) / 1e6).toFixed(0) + "MB");
            }
            if (process.env.TRACE) console.log("     ", (Math.max(...rss, 0) / 1e6).toFixed(0) + "MB", await page.evaluate(() => [...document.querySelectorAll("#stages li.on")].map((l) => l.dataset.s + " " + l.lastElementChild.textContent).join()));
            // الناتج يذهب للتطبيق: لا نحتفظ به في الصفحة (نفرّغه هنا كما يكتبه التطبيق في ملف)
            await page.evaluate(() => { for (const k in window.__parts) window.__parts[k].length = 0; });
            await new Promise((r) => setTimeout(r, process.env.TRACE ? 250 : 1000));
        }
        const st = await page.evaluate(() => document.body.dataset.state);
        const secs = (Date.now() - t0) / 1000;
        if (process.env.TRACE) {
            const cdp = await page.context().newCDPSession(page);
            const rssNow = () => Math.max(0, ...execFileSync("ps", ["-C", "chrome", "-o", "rss=,args="]).toString().split("\n").filter((l) => l.includes("--type=renderer")).map((l) => parseInt(l) * 1024));
            console.log("     بعد الانتهاء:", (rssNow() / 1e6).toFixed(0) + "MB");
            await cdp.send("HeapProfiler.collectGarbage");
            await new Promise((r) => setTimeout(r, 2000));
            console.log("     بعد جمع المهملات:", (rssNow() / 1e6).toFixed(0) + "MB");
        }
        if (process.env.TRACE) {
            const cdp = await page.context().newCDPSession(page);
            const rssNow = () => Math.max(0, ...execFileSync("ps", ["-C", "chrome", "-o", "rss=,args="]).toString().split("\n").filter((l) => l.includes("--type=renderer")).map((l) => parseInt(l) * 1024));
            console.log("     بعد الانتهاء:", (rssNow() / 1e6).toFixed(0) + "MB");
            await cdp.send("HeapProfiler.collectGarbage");
            await new Promise((r) => setTimeout(r, 2000));
            console.log("     بعد جمع المهملات:", (rssNow() / 1e6).toFixed(0) + "MB");
        }
        console.log("    أزمنة المراحل:", await page.evaluate(() => document.body.dataset.stages));
        check("فيديو طويل: يكتمل", st === "done", `${secs.toFixed(0)}ث`);
        check("فيديو طويل: ذاكرة الصفحة محدودة (أقل من 900MB مع النماذج)", peak < 900e6, `أعلى استخدام ${(peak / 1e6).toFixed(0)}MB`);
        await page.close();
    }

    // 7) الفصل بالمعالج الأصلي (أندرويد): الجسر ينقل الصوت ويعيد «الموسيقى» كاملة وبالترتيب
    // كلام فقط بالمستوى الصارم (يمر كله بالفصل): «الموسيقى» الوهمية نصف الصوت ← الباقي نصف الكلام
    const r7 = await runCase("فصل في التطبيق", { settings: { ...male, level: "strict" }, nativeSep: true, file: join(site, "speech-only.mp4") });
    if (r7) {
        const pcm = (f) => { const raw = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 }); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)); };
        const a = pcm(join(site, "speech-only.mp4")), b = pcm(r7.video);
        // «الموسيقى» = نصف الصوت ← الناتج نصف الأصل في المقطع كله (بعيدًا عن حواف التلاشي)
        let num = 0, den = 0;
        for (let i = 16000; i < Math.min(a.length, b.length) - 16000; i++) { num += a[i] * b[i]; den += a[i] * a[i]; }
        const g = num / den;
        // التأخير بين الأصل والناتج (يجب أن يكون صفرًا)
        let best = [0, -Infinity];
        for (let lag = -400; lag <= 400; lag++) { let c = 0; for (let i = 16000; i < 60000; i++) c += a[i] * (b[i + lag] ?? 0); if (c > best[1]) best = [lag, c]; }
        check("فصل في التطبيق: لا تأخير بين صوت الأصل والناتج", Math.abs(best[0]) <= 1, `التأخير ${best[0]} عينة (16kHz)`);
        check("فصل في التطبيق: الجسر يعيد الموسيقى المقدّرة كاملة وتُطرح", Math.abs(g - 0.5) < 0.08, `نسبة الناتج للأصل ${g.toFixed(2)} (المتوقع 0.50)`);
    }

    // 8) كلام بلا موسيقى: الصوت يخرج كما هو تمامًا (نسخ بلا إعادة ترميز) وفي وقته
    const r8 = await runCase("كلام فقط", { settings: male, file: join(site, "speech-only.mp4") });
    if (r8) {
        const pcm = (f) => { const raw = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 }); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)); };
        const a = pcm(join(site, "speech-only.mp4")), b = pcm(r8.video);
        let e = 0, p = 0;
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) { e += (a[i] - b[i]) ** 2; p += a[i] * a[i]; }
        const snr = 10 * Math.log10(p / Math.max(e, 1e-20));
        check("كلام فقط: الصوت مطابق للأصل تمامًا وفي وقته", snr > 60 && Math.abs(a.length - b.length) < 480, `التطابق ${snr.toFixed(0)} dB، الطول ${a.length} / ${b.length}`);
    }

    // 9) أمانة الصوت: كلام بلا موسيقى يمر كله بالفصل الحقيقي (المستوى الصارم) ← يخرج كما هو تقريبًا
    const r9 = await runCase("أمانة الصوت", { settings: { ...male, level: "strict" }, file: join(site, "speech-only.mp4") });
    if (r9) {
        const pcm = (f) => { const raw = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 }); return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)); };
        const a = pcm(join(site, "speech-only.mp4")), b = pcm(r9.video);
        let e = 0, p = 0;
        for (let i = 4800; i < Math.min(a.length, b.length) - 4800; i++) { e += (a[i] - b[i]) ** 2; p += a[i] * a[i]; }
        const snr = 10 * Math.log10(p / e);
        check("أمانة الصوت: صوت المتكلم بعد الفصل مطابق للأصل (فوق 20dB)", snr > 20, `التطابق ${snr.toFixed(1)} dB`);
    }

    // 4) مستخدمة امرأة: لا تُغطّى المرأة المحتشمة
    const r4 = await runCase("المستخدمة امرأة", { settings: { viewer: "female", level: "medium", removeMusic: false } });
    if (r4) {
        const d = frameDiff(ORIG, r4.video, 2);
        check("المستخدمة امرأة: المرأة المحتشمة لا تُغطّى", d < 6, `فرق ${d.toFixed(1)}`);
    }
} catch (e) {
    check("خطأ غير متوقع", false, String(e?.stack ?? e).slice(0, 600));
} finally {
    await browser.close();
    server.close();
    rmSync(tmp, { recursive: true, force: true });
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} ناجح`);
    process.exit(failed.length ? 1 : 0);
}
