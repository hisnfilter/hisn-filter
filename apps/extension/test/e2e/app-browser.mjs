// محاكاة «المتصفح المحمي» في تطبيق الآيفون: موقع عادي بلا إضافة، يُحقن فيه content-app.js مع جسر WebKit مزيّف،
// والتطبيق (هنا Node) يجلب الصور ويرسلها لصفحة المحرك المخفية (detector-app) ويعيد النتيجة — كما يفعل Swift.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "../../dist/web");
const models = join(here, "../../static/models");
const site = join(here, "site");
const require = createRequire(process.env.PLAYWRIGHT_DIR ?? "/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png" };

const app = createServer((rq, rs) => {
    const path = decodeURIComponent(new URL(rq.url, "http://x").pathname);
    const file = path.startsWith("/models/nudenet/") || path.startsWith("/models/yamnet/") ? join(models, path.slice(8)) : join(web, path);
    if (!existsSync(file) || statSync(file).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "same-origin" });
    rs.end(readFileSync(file));
}).listen(0);
const pages = createServer((rq, rs) => {
    const path = decodeURIComponent(new URL(rq.url, "http://x").pathname);
    const file = join(site, path === "/" ? "index.html" : path);
    if (!existsSync(file) || statSync(file).isDirectory()) { rs.writeHead(404); return rs.end(); }
    rs.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    rs.end(readFileSync(file));
}).listen(0);
const APP = `http://localhost:${app.address().port}`, SITE = `http://127.0.0.1:${pages.address().port}`;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--no-proxy-server", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    // صفحة المحرك المخفية
    const engine = await ctx.newPage();
    await engine.goto(`${APP}/pages/detector-app.html`);
    const settings = JSON.parse(process.env.SETTINGS ?? '{"viewer":"male","level":"medium","childMode":true,"blockScaryTopics":true,"maskInsults":true}');

    // «التطبيق»: يرد على رسائل سكربت الصفحة
    const site = await ctx.newPage();
    const errors = [];
    site.on("pageerror", (e) => errors.push(String(e)));
    await site.exposeBinding("__hisnNative", async (_src, msg) => {
        if (msg?.type === "hisn:get-settings") return JSON.stringify(settings);
        if (msg?.type === "hisn:detect-image" || msg?.type === "hisn:detect-frame" || msg?.type === "hisn:detect-audio") {
            const m = { ...msg };
            if (m.src && !m.dataUrl) {
                // التطبيق يجلب الصورة بنفسه (لا قيود CORS عليه)
                const r = await fetch(m.src).catch(() => null);
                if (!r?.ok) return JSON.stringify({ error: "fetch" });
                const type = r.headers.get("content-type") ?? "image/jpeg";
                m.dataUrl = `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
                delete m.src;
            }
            return JSON.stringify(await engine.evaluate((x) => globalThis.__hisnDetect(x), m));
        }
        if (msg?.type === "hisn:get-health") return JSON.stringify({ overall: "ok", layers: {} });
        return JSON.stringify({ ok: true });
    });
    await site.addInitScript(() => {
        window.webkit = { messageHandlers: { hisn: { postMessage: (m) => window.__hisnNative(m) } } };
    });
    await site.addInitScript({ content: readFileSync(join(web, "content-app.js"), "utf8") });
    await site.goto(`${SITE}/index.html`);
    let st = {};
    for (let i = 0; i < 150; i++) {
        st = await site.evaluate(() => Object.fromEntries([...document.images].map((im) => [im.id, im.getAttribute("data-hisn")])));
        if (Object.values(st).every((v) => v && v !== "pending")) break;
        await sleep(1000);
    }
    console.log("   ", JSON.stringify(st));
    // وضع الطفل في المتوسط مثل وضع المرأة
    const female = settings.viewer === "female" || (settings.childMode && settings.level !== "strict");
    if (female) check("المستخدمة امرأة: المرأة تظهر", st.woman === "ok", st.woman);
    else check("المتصفح المحمي: المرأة مضبّبة", /^(blur|partial)/.test(st.woman ?? ""), st.woman);
    check("المتصفح المحمي: العورة مغطاة", /^cover/.test(st.belly ?? ""), st.belly);
    check("المتصفح المحمي: الطبيعة والرجل يظهران", st.land === "ok" && st.man === "ok", `${st.land} ${st.man}`);
    // «فحص الحماية» في الإعدادات: نفس الدالة التي يستدعيها التطبيق
    const self = await engine.evaluate(() => globalThis.__hisnSelfTest());
    check("فحص الحماية: كل صور الاختبار صحيحة", self.ready?.ok && self.cases.length === 4 && self.cases.every((c) => c.ok), JSON.stringify(self.cases.map((c) => [c.file, c.male, c.female, c.error].filter(Boolean))));
    const txt = await site.evaluate(() => document.getElementById("profane").textContent);
    check("المتصفح المحمي: الألفاظ أُخفيت", !txt.includes("شرموطة") && txt.includes("*"), txt);
    check("المتصفح المحمي: لا أخطاء", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
    check("خطأ غير متوقع", false, String(e?.stack ?? e).slice(0, 500));
} finally {
    await browser.close();
    app.close(); pages.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} ناجح`);
    process.exit(failed.length ? 1 : 0);
}
