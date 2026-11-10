// محاكاة محرك الصوت في تطبيق أندرويد: الصفحة audio-engine-app.html في متصفح، والتطبيق يرسل منفذ رسائل
// ثم دفعات صوت 100ms (int16 base64) كما يفعل MusicGuardService، ونقيس: حذف الموسيقى، وبقاء الكلام،
// وكشف الغناء، وسرعة المعالجة مقارنة بالزمن الحقيقي.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "../../dist/web");
const site = join(here, "site");
const require = createRequire(process.env.PLAYWRIGHT_DIR ?? "/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm" };
const server = createServer((rq, rs) => {
    const file = join(web, decodeURIComponent(new URL(rq.url, "http://x").pathname));
    if (!file.startsWith(web) || !existsSync(file) || statSync(file).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    rs.end(readFileSync(file));
}).listen(0);
const ORIGIN = `http://localhost:${server.address().port}`;

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const pcm48 = (file) => {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
    return Buffer.from(raw);
};
const rms = (i16, a, b) => {
    let s = 0, n = 0;
    for (let i = Math.floor(a * 48000); i < Math.min(i16.length, b * 48000); i++) { s += (i16[i] / 32768) ** 2; n++; }
    return Math.sqrt(s / Math.max(1, n));
};
const db = (x) => (20 * Math.log10(x + 1e-9)).toFixed(1);

const browser = await chromium.launch({ channel: "chromium" });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${ORIGIN}/pages/audio-engine-app.html`);
    // جانب «التطبيق» داخل الصفحة: قناة رسائل كما يصنعها WebView.createWebMessageChannel
    await page.evaluate(() => {
        const ch = new MessageChannel();
        window.__app = { port: ch.port1, out: [], singing: [], ready: false, error: null };
        ch.port1.onmessage = (m) => {
            const d = m.data;
            if (d === "R") window.__app.ready = true;
            else if (d[0] === "E") window.__app.error = d.slice(1);
            else if (d[0] === "S") window.__app.singing.push(d === "S1");
            else if (d[0] === "D") window.__app.out.push(d.slice(1));
        };
        window.postMessage("hisn-engine", "*", [ch.port2]);
    });
    await page.waitForFunction(() => window.__app.ready || window.__app.error, null, { timeout: 60000 });
    const err = await page.evaluate(() => window.__app.error);
    check("المحرك يبدأ", !err, err ?? "");

    async function feed(file) {
        const buf = pcm48(file);
        await page.evaluate(() => { window.__app.out = []; window.__app.singing = []; });
        const BATCH = 4800 * 2; // 100ms
        const t0 = Date.now();
        for (let i = 0; i < buf.length; i += BATCH) {
            await page.evaluate((b64) => window.__app.port.postMessage("D" + b64), buf.subarray(i, i + BATCH).toString("base64"));
        }
        const want = Math.floor(buf.length / 2 / 480) * 480;
        await page.waitForFunction((w) => window.__app.out.reduce((n, s) => n + (s.length * 3) / 8, 0) >= w - 480, want, { timeout: 120000 });
        const secs = (Date.now() - t0) / 1000;
        const out = await page.evaluate(() => ({ out: window.__app.out, singing: window.__app.singing }));
        const bytes = Buffer.concat(out.out.map((s) => Buffer.from(s, "base64")));
        const a = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
        const b = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
        return { a, b, secs, dur: a.length / 48000, singing: out.singing };
    }

    // كلام (0–3.2) ثم موسيقى (3.2–7.2) ثم كلام
    const g = await feed(join(site, "gallery-test.mp4"));
    check("طول الناتج يساوي المُرسَل", Math.abs(g.b.length - g.a.length) < 480, `${g.b.length} / ${g.a.length}`);
    check("أسرع من الزمن الحقيقي (مع نقل الرسائل)", g.secs < g.dur, `${g.secs.toFixed(1)}ث لمقطع ${g.dur.toFixed(1)}ث`);
    const mb = rms(g.a, 4.2, 6.8), ma = rms(g.b, 4.25, 6.85);
    const sb = rms(g.a, 8, 10), sa = rms(g.b, 8.03, 10.03);
    check("الموسيقى تنخفض كثيرًا", ma < mb / 5.6, `${db(mb)} ← ${db(ma)} dB`);
    check("الكلام يبقى", sa > sb / 3, `${db(sb)} ← ${db(sa)} dB`);
    check("الكلام فوق الموسيقى ليس غناءً", !g.singing.some(Boolean), g.singing.map(Number).join(""));

    // أغنية: يجب أن يُكشف الغناء في الصوت الباقي
    const s = await feed(join(site, "song-test.webm"));
    // متى يبدأ الصوت البشري في الأغنية؟ (طاقة الناتج النظيف لكل ثانية: قبل الغناء تكون شبه صفر)
    const perSec = Array.from({ length: Math.floor(s.b.length / 48000) }, (_, k) => rms(s.b, k, k + 1));
    const voiceStart = perSec.findIndex((x) => x > 0.05); // أعلى من -26dB: صوت المغني لا بقايا الآلات
    console.log("    طاقة الصوت الباقي لكل ثانية (dB):", perSec.map((x) => db(x)).join(" "));
    // التطبيق يُبقي المغني مكتومًا من أول كشف حتى تنتهي الموسيقى (مثل الإضافة)، فالمهم سرعة أول كشف
    const first = s.singing.indexOf(true);
    check("الأغنية: يُكشف صوت المغني خلال 6 ثوانٍ من بدء الغناء (فيُكتم حتى نهاية الأغنية)", first >= 0 && first * 0.5 - Math.max(0, voiceStart) <= 6, `يبدأ الغناء عند ${voiceStart}ث، ويُكشف ${first >= 0 ? `عند ${(first * 0.5 + 0.5).toFixed(1)}ث` : "— لم يُكشف"} · ${s.singing.map(Number).join("")}`);

    check("لا أخطاء في الصفحة", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
    check("خطأ غير متوقع", false, String(e?.stack ?? e).slice(0, 500));
} finally {
    await browser.close();
    server.close();
    const failed = results.filter((x) => !x).length;
    console.log(`\n${results.length - failed}/${results.length} ناجح`);
    process.exit(failed ? 1 : 0);
}
