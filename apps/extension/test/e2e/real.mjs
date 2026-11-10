// اختبار الإضافة الحقيقية (dist/chrome) محمّلة في Chromium كامل عبر Playwright — كما يستخدمها الناس:
// الخلفية الحقيقية، والصفحة الخفية للكشف، وقواعد الشبكة، وصفحات الإعدادات، وسياسات أمان المواقع، والإطارات.
// أسماء المواقع الحقيقية (قوقل، يوتيوب، موقع إباحي، موقع قمار) تُوجَّه إلى خادم محلي حتى نتحقق من قواعد الشبكة.
// التشغيل: node test/e2e/real.mjs   (يحتاج Playwright وChromium الكامل)
import { createServer } from "node:http";
import { createServer as createHttps } from "node:https";
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
// مغطّى: تضبيب كامل، أو وميض الانتظار، أو تغطية جزئية للمرأة (المستوى المتوسط)
const hid = (x) => !!x && (/blur|contrast\(0\)/.test(x.f ?? "") || x.st === "partial");

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, "../../dist/chrome");
const site = join(here, "site");
const require = createRequire(process.env.PLAYWRIGHT_DIR ?? "/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const ONLY = process.env.ONLY ?? "";
const want = (name) => !ONLY || ONLY.split(",").includes(name);

const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg",
    ".png": "image/png", ".webm": "video/webm", ".vtt": "text/vtt; charset=utf-8", ".mp4": "video/mp4",
};
function serveSite(rq, rs) {
    const url = new URL(rq.url, "http://x");
    const p = join(site, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!existsSync(p) || statSync(p).isDirectory()) { rs.writeHead(404); return rs.end(); }
    const headers = { "content-type": TYPES[extname(p)] ?? "application/octet-stream", "access-control-allow-origin": "*" };
    if (url.pathname === "/csp.html") headers["content-security-policy"] = "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self'";
    if (url.pathname.endsWith(".webm") || url.pathname.endsWith(".mp4")) {
        // دعم الطلبات الجزئية مثل خوادم الفيديو
        const buf = readFileSync(p);
        const m = /bytes=(\d+)-(\d*)/.exec(rq.headers.range ?? "");
        if (m) {
            const a = +m[1], b = m[2] ? +m[2] : buf.length - 1;
            rs.writeHead(206, { ...headers, "content-range": `bytes ${a}-${b}/${buf.length}`, "accept-ranges": "bytes", "content-length": b - a + 1 });
            return rs.end(buf.subarray(a, b + 1));
        }
        headers["accept-ranges"] = "bytes";
    }
    rs.writeHead(200, headers);
    rs.end(readFileSync(p));
}
const a = createServer(serveSite).listen(0);
const b = createServer(serveSite).listen(0); // موقع آخر (أصل مختلف) للإطارات والفيديو المباشر
const A = `http://localhost:${a.address().port}`;
const B = `http://127.0.0.1:${b.address().port}`;

// خادم HTTPS يعيد الرابط والترويسات كما وصلته
const tmp = mkdtempSync(join(tmpdir(), "hisn-e2e-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=hisn-test", "-days", "2",
    "-keyout", join(tmp, "k.pem"), "-out", join(tmp, "c.pem")], { stdio: "ignore" });
const echo = createHttps({ key: readFileSync(join(tmp, "k.pem")), cert: readFileSync(join(tmp, "c.pem")) }, (rq, rs) => {
    rs.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    rs.end(`<!doctype html><meta charset="utf-8"><pre id="echo">${JSON.stringify({ url: rq.url, host: rq.headers.host, headers: rq.headers })}</pre>`);
}).listen(443);

const adultDomains = JSON.parse(readFileSync(join(here, "../../static/rules/adult-domains.json"))).domains;
const gamblingDomains = JSON.parse(readFileSync(join(here, "../../static/rules/gambling-domains.json"))).domains;
const ADULT = adultDomains.find((d) => d.split(".").length === 2 && /^[a-z]+\.com$/.test(d));
const GAMBLING = gamblingDomains.find((d) => d.split(".").length === 2 && /^[a-z]+\.com$/.test(d));
const mapped = ["www.google.com", "www.youtube.com", ADULT, `www.${ADULT}`, GAMBLING, "www.bing.com", "duckduckgo.com"];

const results = [];
const check = (name, ok, detail = "") => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail !== "" ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "hisn-profile-"));
const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    ignoreHTTPSErrors: true,
    args: [
        `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox",
        `--host-resolver-rules=${mapped.map((h) => `MAP ${h} 127.0.0.1`).join(", ")}`,
        "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", "--no-proxy-server",
        "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    ],
});
const errors = [];
ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e}`)));

async function waitStates(page, ids, root = null, timeoutMs = 150000) {
    const t0 = Date.now();
    let st;
    while (Date.now() - t0 < timeoutMs) {
        st = await page.evaluate(({ ids, root }) => {
            const doc = root ? document.querySelector(root)?.shadowRoot : document;
            return Object.fromEntries(ids.map((id) => {
                const el = doc?.getElementById(id);
                return [id, el ? `${el.getAttribute("data-hisn") ?? el.getAttribute("data-hisn-bg")}${el.dataset.hisnReason ? ":" + el.dataset.hisnReason : ""}` : "missing"];
            }));
        }, { ids, root });
        if (Object.values(st).every((v) => !v.startsWith("pending") && !v.startsWith("null"))) break;
        await sleep(1000);
    }
    return st;
}
const blocked = (v) => /^(blur|cover|partial)/.test(v ?? "");

try {
    // ===== التثبيت =====
    let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 30000 }));
    const extId = new URL(sw.url()).host;
    const extUrl = (p) => `chrome-extension://${extId}/${p}`;
    await sleep(1500);
    const onboarding = ctx.pages().find((p) => p.url().includes("onboarding.html"));
    check("صفحة الإعداد الأول تفتح عند التثبيت", onboarding, onboarding?.url() ?? "");

    // الإعداد الأول بالضغط كما يفعل المستخدم: رجل ← متوسط ← بلا رمز
    if (onboarding) {
        await onboarding.click("[data-viewer=male]");
        await onboarding.click("[data-level=medium]");
        await onboarding.click("[data-next]");
        await onboarding.click("#skipPin");
        await onboarding.waitForSelector('[data-step="4"]:not([hidden])', { timeout: 10000 });
        await onboarding.close();
    }
    const getSettings = async () => (await sw.evaluate(() => chrome.storage.local.get(null)));
    const s0 = await getSettings();
    const stored = Object.values(s0).find((v) => v && typeof v === "object" && "viewer" in v) ?? s0;
    check("الإعداد الأول حُفظ (رجل، متوسط)", stored.viewer === "male" && stored.level === "medium" && stored.onboarded, `${stored.viewer}/${stored.level}`);

    // ===== قواعد الشبكة =====
    if (want("net")) {
        const p = await ctx.newPage();
        await p.goto(`https://${ADULT}/videos?id=1`).catch(() => {});
        await sleep(800);
        check("الموقع الإباحي يُحوَّل لصفحة الحجب", p.url().startsWith(extUrl("pages/blocked.html")), `${ADULT} → ${p.url().slice(0, 70)}`);
        const reason = await p.locator("body").innerText().catch(() => "");
        check("صفحة الحجب تعرض السبب والآية", /أبصارهم|ابصارهم/.test(reason.replace(/[\u064B-\u065F\u0670]/g, "")), reason.slice(0, 60).replace(/\n/g, " "));
        await p.goto(`https://www.${ADULT}/`).catch(() => {});
        await sleep(500);
        check("النطاق الفرعي للموقع الإباحي يُحجب أيضًا", p.url().startsWith(extUrl("pages/blocked.html")));
        await p.goto(`https://${GAMBLING}/`).catch(() => {});
        await sleep(500);
        check("موقع القمار يُحجب", p.url().includes("blocked.html") && p.url().includes("gambling"), GAMBLING);

        await p.goto("https://www.google.com/search?q=test");
        const g = JSON.parse(await p.locator("#echo").innerText());
        check("قوقل: البحث الآمن مفروض (safe=active)", /[?&]safe=active/.test(g.url), g.url);
        await p.goto("https://www.bing.com/search?q=test");
        const bi = JSON.parse(await p.locator("#echo").innerText());
        check("بنج: البحث الآمن مفروض (adlt=strict)", /adlt=strict/.test(bi.url), bi.url);
        await p.goto("https://www.youtube.com/watch?v=abc");
        const y = JSON.parse(await p.locator("#echo").innerText());
        check("يوتيوب: ترويسة الوضع المقيّد تصل للخادم", y.headers["youtube-restrict"] === "Moderate", y.headers["youtube-restrict"] ?? "مفقودة");
        await p.goto("https://www.google.com/maps");
        const gm = JSON.parse(await p.locator("#echo").innerText());
        check("قوقل خرائط لا تتأثر", !gm.url.includes("safe="), gm.url);
        await p.close();
    }

    // ===== الصور والنصوص في صفحة عادية =====
    if (want("page")) {
        const p = await ctx.newPage();
        await p.goto(`${A}/index.html`);
        const early = await p.evaluate(() => getComputedStyle(document.getElementById("land")).filter);
        check("الصورة مضبّبة فور التحميل (قبل الفحص)", /blur|contrast\(0\)/.test(early), early);
        const st = await waitStates(p, ["land", "woman", "man", "man2", "woman2", "belly", "group", "mengroup", "icon", "mw"]);
        console.log("   ", JSON.stringify(st));
        check("المرأة مضبّبة للرجل", blocked(st.woman), st.woman);
        check("وجه امرأة ثانٍ مضبّب", blocked(st.woman2), st.woman2);
        check("بطن مكشوف محجوب", blocked(st.belly), st.belly);
        check("جماعة فيها امرأة مضبّبة", blocked(st.group), st.group);
        check("الرجل يظهر", st.man === "ok" && st.man2 === "ok" && st.mengroup === "ok", `${st.man} ${st.man2} ${st.mengroup}`);
        check("الطبيعة تظهر", st.land === "ok", st.land);
        // رجل وامرأة: تُغطّى المرأة وحدها ويظهر الرجل (نقارن تباين البكسلات في نصفي الصورة)
        check("رجل وامرأة: تغطية جزئية", st.mw?.startsWith("partial"), st.mw);
        const shot = await p.locator("#mw").screenshot();
        const detail = await p.evaluate(async (b64) => {
            const img = new Image();
            img.src = "data:image/png;base64," + b64;
            await img.decode();
            const c = new OffscreenCanvas(img.width, img.height);
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            // متوسط الفرق بين البكسلات المتجاورة: عالٍ في الجزء الظاهر، منخفض في المغطّى
            const edge = (x0, x1) => {
                const { data, width } = ctx.getImageData(x0, 0, x1 - x0, img.height);
                let s = 0, n = 0;
                for (let i = 4; i < data.length; i += 4) if ((i / 4) % width) { s += Math.abs(data[i] - data[i - 4]); n++; }
                return s / n;
            };
            const w = img.width;
            return { man: +edge(Math.round(w * 0.3), Math.round(w * 0.5)).toFixed(1), woman: +edge(Math.round(w * 0.75), Math.round(w * 0.85)).toFixed(1) };
        }, shot.toString("base64"));
        check("رجل وامرأة: الرجل واضح والمرأة مغطّاة", detail.man > 3 * detail.woman, JSON.stringify(detail));
        const txt = await p.evaluate(() => document.getElementById("profane").textContent);
        check("الألفاظ أُخفيت في الصفحة", !txt.includes("شرموطة") && txt.includes("*"), txt);
        await p.close();
    }

    // ===== صفحة بسياسة أمان صارمة (CSP) =====
    if (want("csp")) {
        const p = await ctx.newPage();
        await p.goto(`${A}/csp.html`);
        const st = await waitStates(p, ["woman", "land"]);
        check("CSP صارمة: المرأة مضبّبة", blocked(st.woman), st.woman);
        check("CSP صارمة: الطبيعة تظهر", st.land === "ok", st.land);
        const t = await p.evaluate(() => document.getElementById("t").textContent);
        check("CSP صارمة: اللفظ أُخفي", !t.includes("شرموطة"), t);
        await p.close();
    }

    // ===== Shadow DOM =====
    if (want("shadow")) {
        const p = await ctx.newPage();
        await p.goto(`${A}/shadow.html`);
        const st = await waitStates(p, ["woman", "land"], "#card");
        check("Shadow DOM: المرأة مضبّبة", blocked(st.woman), st.woman);
        check("Shadow DOM: الطبيعة تظهر", st.land === "ok", st.land);
        const t = await p.evaluate(() => document.querySelector("#card").shadowRoot.getElementById("t").textContent);
        check("Shadow DOM: اللفظ أُخفي", !t.includes("منيوك"), t);
        await p.close();
    }

    // ===== إطار من موقع آخر =====
    if (want("frame")) {
        const p = await ctx.newPage();
        await p.goto(`${A}/frame-parent.html?${B}`);
        await sleep(1500);
        const f = p.frames().find((x) => x.url().includes("framed.html"));
        let st = {};
        for (let i = 0; i < 150 && f; i++) {
            st = await f.evaluate(() => ({ woman: document.getElementById("woman")?.getAttribute("data-hisn"), land: document.getElementById("land")?.getAttribute("data-hisn"), t: document.getElementById("t")?.textContent }));
            if (st.woman && st.woman !== "pending" && st.land && st.land !== "pending") break;
            await sleep(1000);
        }
        check("إطار من موقع آخر: المرأة مضبّبة", blocked(st.woman), st.woman);
        check("إطار من موقع آخر: الطبيعة تظهر", st.land === "ok", st.land);
        check("إطار من موقع آخر: اللفظ أُخفي", st.t && !st.t.includes("fuck"), st.t);
        await p.close();
    }

    // ===== تحميل متأخر، picture، خلفيات CSS، وتبديل الصورة =====
    if (want("lazy")) {
        const p = await ctx.newPage();
        await p.goto(`${A}/lazy.html`);
        const st = await waitStates(p, ["lazy", "pic", "bg", "bgland"]);
        console.log("   ", JSON.stringify(st));
        check("صورة تُحمَّل لاحقًا (data-src) تُفحص وتُضبَّب", blocked(st.lazy), st.lazy);
        check("picture/srcset: المصدر الفعلي (امرأة) يُضبَّب", blocked(st.pic), st.pic);
        check("خلفية CSS فيها امرأة تُضبَّب", blocked(st.bg), st.bg);
        check("خلفية CSS طبيعة تظهر", st.bgland === "ok", st.bgland);
        await sleep(16000);
        const swapped = await waitStates(p, ["swap"]);
        check("صورة سليمة تتبدّل لامرأة بعد ظهورها: تُضبَّب", blocked(swapped.swap), swapped.swap);
        await p.close();
    }

    // ===== المستخدمة امرأة: من صفحة الإعدادات =====
    if (want("settings")) {
        const sp = await ctx.newPage();
        await sp.goto(extUrl("pages/settings.html"));
        await sp.waitForTimeout(800);
        const r = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:update-settings", patch: { viewer: "female", blurAdultWomen: false, blurCartoonWomen: false } }));
        check("تغيير المستخدم إلى امرأة بلا قفل", r?.ok, JSON.stringify(r).slice(0, 80));
        const p = await ctx.newPage();
        await p.goto(`${A}/index.html?female`);
        const st = await waitStates(p, ["woman", "belly", "land"]);
        check("امرأة: صورة المرأة تظهر", st.woman === "ok", st.woman);
        check("امرأة: البطن المكشوف يبقى محجوبًا", blocked(st.belly), st.belly);
        await p.close();

        // القفل: وضع رمز، ثم محاولة تخفيف الإعدادات بلا رمز ثم بالرمز
        const pin = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:set-pin", pin: "4826" }));
        check("وضع رمز القفل", pin?.ok, JSON.stringify(pin));
        const noPin = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:update-settings", patch: { blockAdultSites: false } }));
        check("مع القفل: إطفاء الحجب بلا رمز مرفوض", noPin?.ok === false, JSON.stringify(noPin));
        const wrong = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:update-settings", patch: { blockAdultSites: false }, pin: "1111" }));
        check("مع القفل: رمز خاطئ مرفوض", wrong?.ok === false);
        // "هذا الموقع سليم" من صفحة الحجب يطلب الرمز (قبل إدخال الرمز الصحيح الذي يفتح القفل 5 دقائق)
        const allowNoPin = await sp.evaluate(async (d) => chrome.runtime.sendMessage({ type: "hisn:allow-site", site: d }), ADULT);
        check("مع القفل: السماح بموقع محجوب بلا رمز مرفوض", allowNoPin?.ok === false, JSON.stringify(allowNoPin));
        const strengthen = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:hide-account", site: "x.com", handle: "bad" }));
        check("مع القفل: التشديد (إخفاء حساب) يُقبل بلا رمز", strengthen?.ok !== false, JSON.stringify(strengthen).slice(0, 60));
        const ok = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:update-settings", patch: { viewer: "male", blurAdultWomen: true, blurCartoonWomen: true }, pin: "4826" }));
        check("مع القفل: الرمز الصحيح يقبل التغيير", ok?.ok, JSON.stringify(ok).slice(0, 60));
        const blk = await ctx.newPage();
        await blk.goto(`https://${ADULT}/`).catch(() => {});
        await sleep(600);
        check("مع القفل: الحجب ما زال يعمل", blk.url().includes("blocked.html"));
        await blk.close();
        await sp.close();
    }

    // ===== الفيديو =====
    if (want("video")) {
        const p = await ctx.newPage();
        await p.goto(`${A}/video.html`);
        const tl = [];
        for (let i = 0; i < 70; i++) {
            const s = await p.evaluate(() => { const v = document.getElementById("v"); return { t: +v.currentTime.toFixed(1), st: v.getAttribute("data-hisn"), f: getComputedStyle(v).filter }; });
            tl.push(s);
            if (s.t > 45 && s.st === "ok") break;
            await sleep(1000);
        }
        console.log("    الفيديو:", tl.filter((_, i) => i % 6 === 0).map((x) => `${x.t}:${x.st}`).join(" "));
        check("الفيديو مضبّب منذ البداية", hid(tl[0]));
        check("الفيديو مضبّب طوال مقطع المرأة", tl.filter((x) => x.t > 4 && x.t < 24).every(hid));
        // أثناء الحجب: شارة ظاهرة فوق المقطع، ولمسة إصبع (لا click: الريلز تمنعه) تفتح نافذة الخيارات
        const q = await ctx.newPage();
        await q.goto(`${A}/video.html`);
        await q.waitForFunction(() => /^(cover|blur|partial)$/.test(document.getElementById("v").getAttribute("data-hisn") || ""), null, { timeout: 60000 }).catch(() => {});
        await q.waitForTimeout(1500);
        const badge = await q.evaluate(() => document.querySelector(".hisn-cover-badge")?.textContent || "");
        check("شارة «محجوب» تظهر فوق المقطع المحجوب", badge.includes("محجوب"), badge);
        const tapped = await q.evaluate(() => {
            const v = document.getElementById("v"), r = v.getBoundingClientRect();
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            const mk = (type) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchstart" ? [new Touch({ identifier: 1, target: v, clientX: x, clientY: y })] : [], changedTouches: [new Touch({ identifier: 1, target: v, clientX: x, clientY: y })] });
            v.dispatchEvent(mk("touchstart"));
            v.dispatchEvent(mk("touchend"));
            return true;
        });
        await q.waitForTimeout(500);
        const cdpV = await ctx.newCDPSession(q);
        const { nodes: vn } = await cdpV.send("Accessibility.getFullAXTree");
        const vBtns = vn.filter((n) => n.role?.value === "button" && !n.ignored).map((n) => n.name?.value);
        check("لمسة على المقطع المحجوب تفتح الخيارات (إظهار)", tapped && vBtns.includes("إظهار"), vBtns.filter(Boolean).join("، "));
        await q.close();
        check("الفيديو يظهر بعد تحوله لمنظر طبيعي", tl.some((x) => x.t > 30 && x.st === "ok"));
        await p.close();
    }

    // ===== واجهة المستخدم مع القفل: صفحة الإعدادات، والضغط على صورة محجوبة =====
    if (want("ui")) {
        const sp = await ctx.newPage();
        await sp.goto(extUrl("pages/settings.html"));
        await sp.waitForSelector("#toggles .row", { state: "attached" });
        await sp.evaluate(() => document.querySelector('[data-tab="protect"]').click()); // قسم «الحماية» فيه المفاتيح
        await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:set-pin", pin: "4826" }));
        await sp.evaluate(async () => {
            // نبدأ مقفلين: ننهي فترة الفتح المؤقت إن وُجدت
            await chrome.storage.session?.set?.({ unlockedUntil: 0 });
        });
        await sp.reload();
        await sp.waitForSelector("#toggles .row", { state: "attached" });
        await sp.evaluate(() => document.querySelector('[data-tab="protect"]').click()); // قسم «الحماية» فيه المفاتيح
        const row = sp.locator("#toggles .row", { hasText: "المواقع الإباحية" });
        await row.locator("label.switch").click();
        await sp.waitForTimeout(800);
        const dlgOpen = await sp.locator("#pinDialog[open]").count();
        check("إطفاء خيار حماية يطلب الرمز في الواجهة", dlgOpen === 1);
        await sp.keyboard.press("Escape");
        await sp.waitForTimeout(400);
        const still = await row.locator("input").isChecked();
        const st1 = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:get-settings" }));
        check("الإلغاء يعيد المفتاح ولا يغيّر الإعداد", still && st1.blockAdultSites === true);
        await sp.click('[data-level="strict"]');
        await sp.waitForTimeout(500);
        const st2 = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:get-settings" }));
        check("رفع المستوى إلى صارم بلا رمز", st2.level === "strict" && (await sp.locator("#pinDialog[open]").count()) === 0, st2.level);
        await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:update-settings", patch: { level: "medium" }, pin: "4826" }));
        await sp.evaluate(async () => chrome.storage.session?.set?.({ unlockedUntil: 0 }));

        const p = await ctx.newPage();
        await p.goto(`${A}/index.html?ui`);
        const st = await waitStates(p, ["woman", "belly"]);
        // نافذة الخيارات داخل Shadow DOM مغلق (حتى لا تعبث بها الصفحة)، فنقرؤها من شجرة الوصول كما يراها قارئ الشاشة
        const cdp = await ctx.newCDPSession(p);
        const popButtons = async () => {
            const { nodes } = await cdp.send("Accessibility.getFullAXTree");
            return nodes.filter((n) => n.role?.value === "button" && !n.ignored).map((n) => n.name?.value).filter((x) => x && x !== "تشغيل");
        };
        const clickButton = async (label) => {
            const { nodes } = await cdp.send("Accessibility.getFullAXTree");
            const n = nodes.find((x) => x.role?.value === "button" && x.name?.value === label);
            if (!n) return false;
            const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: n.backendDOMNodeId });
            const [x1, y1, x2, , , y3] = model.content;
            await p.mouse.click((x1 + x2) / 2, (y1 + y3) / 2);
            return true;
        };
        await p.click("#belly", { force: true });
        await p.waitForTimeout(400);
        const bellyBtns = await popButtons();
        check("مع القفل: العورة بلا زر إظهار", !bellyBtns.includes("إظهار") && bellyBtns.length > 0, `${st.belly} ← ${bellyBtns.join("، ")}`);
        await p.keyboard.press("Escape");
        await p.mouse.click(5, 5);
        await p.click("#woman", { force: true });
        await p.waitForTimeout(400);
        const womanBtns = await popButtons();
        check("صورة امرأة: الخيارات تظهر عند الضغط", womanBtns.includes("إظهار"), womanBtns.join("، "));
        const safeBtn = womanBtns.indexOf("هذا سليم دائمًا");
        if (safeBtn >= 0) {
            await clickButton("هذا سليم دائمًا");
            await p.waitForTimeout(800);
            // نافذة الرمز: نلغيها
            await clickButton("إلغاء");
            await p.waitForTimeout(800);
            const after = await p.evaluate(() => document.getElementById("woman").getAttribute("data-hisn"));
            check("مع القفل: «سليم دائمًا» بلا رمز لا يُظهر الصورة", after !== "ok" && after !== "revealed", after);
        }
        await p.close();
        await sp.close();
    }

    // ===== الصوت: إزالة الموسيقى مع إبقاء الكلام، وكتم المغني، وكتم الألفاظ =====
    async function playAndWatch(url, seconds, warm = 2500) {
        const p = await ctx.newPage();
        await p.goto(url);
        await sleep(warm);
        await p.click("#play");
        const tl = [];
        const t0 = Date.now();
        while (Date.now() - t0 < seconds * 1000 + 8000) {
            const s = await p.evaluate(() => {
                const v = document.getElementById("v");
                return { t: +v.currentTime.toFixed(2), mode: v.dataset.hisnAudioMode ?? "", mute: v.dataset.hisnMute ?? "", stats: v.dataset.hisnAudioStats ?? "",
                    path: v.dataset.hisnAudioPath ?? "", cls: v.dataset.hisnAudio ?? "", co: v.getAttribute("crossorigin"), ended: v.ended };
            });
            tl.push(s);
            if (s.ended || s.t >= seconds) break;
            await sleep(250);
        }
        await p.close();
        return tl;
    }
    const during = (tl, a, b) => tl.filter((x) => x.t >= a && x.t <= b);
    const show = (tl) => tl.filter((_, i) => i % 3 === 0).map((x) => `${x.t}:${x.mode || "-"}${x.mute ? "/" + x.mute : ""}(${x.cls || "-"})`).join(" ");
    if (want("audio")) {
        // أغنية: بعد إزالة الآلات يبقى صوت المغني ← يُكتم
        // أولًا (تحمّل النماذج، وهذه البيئة بلا معالج رسوميات فالتحميل بطيء)
        const tl3 = await playAndWatch(`${A}/audio2.html?blob=song-test.webm`, 28, 20000);
        console.log("    ", show(tl3));
        check("أغنية: صوت المغني بعد إزالة الموسيقى يُكتم", tl3.some((x) => x.mode === "singer-muted"), [...new Set(tl3.map((x) => x.mode))].join(","));
        // كلام (0–2.7) ثم موسيقى (3.2–7.2) ثم كلام (7.2–12.6) فيه لفظ في الترجمة (10.4–11.4)
        // أول صفحة: ننتظر تحميل النماذج (هذه البيئة بلا معالج رسوميات وبطيئة جدًا في التحميل)
        const tl = await playAndWatch(`${A}/audio2.html?blob=audio-only.webm`, 12.6);
        console.log("    ", show(tl));
        console.log("     إحصاء المحرك (نُظّف/انقطاع):", tl.at(-1)?.stats);
        check("الصوت يمر بمحرك التنظيف", tl.some((x) => x.path === "routed"), tl.at(-1)?.path);
        check("الكلام وحده لا يُغيَّر (بعد أول حكم)", during(tl, 1.5, 2.6).every((x) => x.mode === "original"), during(tl, 0, 2.6).map((x) => x.mode).join(","));
        const m = during(tl, 5.0, 7.0);
        check("أثناء الموسيقى: يُنظَّف الصوت (تُزال الموسيقى ويبقى الكلام)", m.length && m.every((x) => x.mode === "clean"), m.map((x) => x.mode).join(","));
        const [cleaned, under] = (tl.at(-1)?.stats ?? "0/0").split("/").map(Number);
        check("المحرك يعالج بلا انقطاع يُذكر", cleaned > 300 && under <= 6, `${cleaned} كتلة، ${under} انقطاع`);
        check("بعد الموسيقى يعود الصوت الأصلي", during(tl, 9.8, 10.3).every((x) => x.mode === "original"));
        const w = during(tl, 10.6, 11.2);
        check("اللفظ المنطوق يُكتم لحظة نطقه", w.length && w.every((x) => x.mute.includes("profanity")), w.map((x) => x.mute).join(","));

        // ملف مباشر من موقع آخر (كان مستثنى): يُطلب له إذن CORS فيُعالج
        const tl2 = await playAndWatch(`${A}/audio2.html?src=${encodeURIComponent(B + "/audio-only.webm")}`, 8);
        console.log("    ", show(tl2));
        check("ملف من موقع آخر: يُعاد تحميله بإذن CORS ويمر بالمحرك", tl2.some((x) => x.co === "anonymous") && tl2.some((x) => x.path === "routed"), `${tl2.at(-1)?.co} ${tl2.at(-1)?.path}`);
        const m2 = during(tl2, 5.2, 7.0);
        check("ملف من موقع آخر: الموسيقى تُنظَّف", m2.length && m2.every((x) => x.mode === "clean"), m2.map((x) => x.mode).join(","));

    }

    // ===== تنظيف فيديو من الجهاز =====
    if (want("cleaner")) {
        const p = await ctx.newPage();
        await p.goto(extUrl("pages/clean-video.html"));
        // الملف: امرأة (0–5ث) ثم منظر طبيعي، والصوت: كلام ثم موسيقى (3.2–7.2) ثم كلام
        await p.setInputFiles("#file", join(site, "gallery-test.mp4"));
        await p.waitForFunction(() => document.body.dataset.state, null, { timeout: 900000 });
        const state = await p.evaluate(() => document.body.dataset.state);
        check("تنظيف فيديو: يكتمل بلا خطأ", state === "done", state === "done" ? "" : await p.evaluate(() => document.body.dataset.error?.slice(0, 400)));
        if (state === "done") {
            const report = JSON.parse(await p.evaluate(() => document.body.dataset.report));
            console.log("    التقرير:", JSON.stringify(report));
            const b64 = await p.evaluate(async () => {
                const buf = new Uint8Array(await (await fetch(document.getElementById("out").src)).arrayBuffer());
                let s = "";
                for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                return btoa(s);
            });
            const outPath = process.env.KEEP_CLEAN ?? join(tmp, "clean.mp4");
            (await import("node:fs")).writeFileSync(outPath, Buffer.from(b64, "base64"));
            const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", outPath]).toString();
            const info = JSON.parse(probe);
            const types = info.streams.map((x) => x.codec_type).sort().join(",");
            check("الملف الناتج فيه صورة وصوت بنفس المدة تقريبًا", types === "audio,video" && Math.abs(+info.format.duration - 12.6) < 0.6, `${types} ${info.format.duration}ث`);
            // مقارنة الإطارات بالأصل: منطقة المرأة تغيرت كثيرًا، والمنظر الطبيعي لم يتغير
            const frameAt = (file, t) => execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=96:72", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
            const diff = (t) => {
                const a = frameAt(join(site, "gallery-test.mp4"), t), b = frameAt(outPath, t);
                let d = 0;
                for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
                return d / a.length;
            };
            const dWoman = diff(2), dLand = diff(9);
            check("تنظيف فيديو: المرأة مغطاة في الإطارات", dWoman > 20, `فرق ${dWoman.toFixed(1)}`);
            check("تنظيف فيديو: المنظر الطبيعي كما هو", dLand < 6, `فرق ${dLand.toFixed(1)}`);
            check("تنظيف فيديو: حُذفت الموسيقى", report.musicSeconds >= 3, `${report.musicSeconds}ث`);
            // الصوت: نقيس طاقة مقطع الموسيقى (لا كلام فيه) قبل وبعد
            const pcm = (file, a, d) => {
                const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(a), "-t", String(d), "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
                const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
                return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
            };
            // الموسيقى وحدها (4–6ث). ما بعدها حتى بداية الكلام محميّ عمدًا: لا يُصمت ما يجاور الكلام
            const before = pcm(join(site, "gallery-test.mp4"), 4.0, 2.0), after = pcm(outPath, 4.0, 2.0);
            const speechBefore = pcm(join(site, "gallery-test.mp4"), 8, 2), speechAfter = pcm(outPath, 8, 2);
            const db = (x) => (20 * Math.log10(x + 1e-9)).toFixed(1);
            check("تنظيف فيديو: مقطع الموسيقى انخفض 30dB على الأقل", after < before / 31.6, `${db(before)} ← ${db(after)} dB`);
            check("تنظيف فيديو: الكلام باقٍ", speechAfter > speechBefore / 3, `${db(speechBefore)} ← ${db(speechAfter)} dB`);
        }
        await p.close();

        // خلفية هادئة مكان الموسيقى: يُسمع المطر خافتًا حيث كانت الموسيقى، والكلام كما هو
        {
            const q = await ctx.newPage();
            await q.goto(extUrl("pages/clean-video.html"));
            await q.check('input[name="mode"][value="music"]');
            await q.check('input[name="bed"][value="rain"]');
            await q.setInputFiles("#file", join(site, "gallery-test.mp4"));
            await q.waitForFunction(() => document.body.dataset.state, null, { timeout: 900000 });
            const st = await q.evaluate(() => document.body.dataset.state);
            check("خلفية مطر: التنظيف يكتمل", st === "done", st === "done" ? "" : await q.evaluate(() => document.body.dataset.error?.slice(0, 300)));
            if (st === "done") {
                const b64 = await q.evaluate(async () => {
                    const buf = new Uint8Array(await (await fetch(document.getElementById("out").src)).arrayBuffer());
                    let s = "";
                    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                    return btoa(s);
                });
                const outPath = join(tmp, "bed-clean.mp4");
                (await import("node:fs")).writeFileSync(outPath, Buffer.from(b64, "base64"));
                const rms = (file, a, d) => {
                    const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(a), "-t", String(d), "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
                    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
                    return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
                };
                const db = (x) => 20 * Math.log10(x + 1e-9);
                const bed = db(rms(outPath, 4.2, 1.6)), music = db(rms(join(site, "gallery-test.mp4"), 4.2, 1.6));
                check("خلفية مطر: خافتة مكان الموسيقى", bed > -45 && bed < -24 && bed < music - 6, `الموسيقى ${music.toFixed(1)} ← الخلفية ${bed.toFixed(1)} dB`);
                const sp0 = db(rms(join(site, "gallery-test.mp4"), 8, 2)), sp1 = db(rms(outPath, 8, 2));
                check("خلفية مطر: الكلام كما هو", Math.abs(sp1 - sp0) < 3, `${sp0.toFixed(1)} ← ${sp1.toFixed(1)} dB`);
            }
            await q.close();
        }

        // رسوم متحركة: كلام بطبقة عالية متمايلة فوق موسيقى متواصلة — يجب ألا يخرج صامتًا (كان يُكتم كله «غناءً»)
        {
            const q = await ctx.newPage();
            await q.goto(extUrl("pages/clean-video.html"));
            await q.setInputFiles("#file", join(site, "cartoon-test.mp4"));
            await q.waitForFunction(() => document.body.dataset.state, null, { timeout: 900000 });
            const st = await q.evaluate(() => document.body.dataset.state);
            check("رسوم متحركة: التنظيف يكتمل", st === "done", st === "done" ? "" : await q.evaluate(() => document.body.dataset.error?.slice(0, 300)));
            if (st === "done") {
                const rep = JSON.parse(await q.evaluate(() => document.body.dataset.report));
                const b64 = await q.evaluate(async () => {
                    const buf = new Uint8Array(await (await fetch(document.getElementById("out").src)).arrayBuffer());
                    let s = "";
                    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                    return btoa(s);
                });
                const outPath = join(tmp, "cartoon-clean.mp4");
                (await import("node:fs")).writeFileSync(outPath, Buffer.from(b64, "base64"));
                const rms = (file, a, d) => {
                    const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(a), "-t", String(d), "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
                    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
                    return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
                };
                // الكلام وحده (المرجع) مقابل الناتج، على 2–18ث
                const voice = rms(join(site, "cartoon-voice.wav"), 2, 16), out = rms(outPath, 2, 16);
                const db = (x) => (20 * Math.log10(x + 1e-9)).toFixed(1);
                check("رسوم متحركة: الكلام باقٍ (لا فيديو صامت)", out > voice / 3, `الكلام ${db(voice)} dB ← الناتج ${db(out)} dB · غناء مكتوم ${rep.singerSeconds}ث · ${rep.windows ?? ""}`);
            }
            await q.close();
        }

        // فيديو جوال عمودي (مخزَّن مائلًا ويُعرض معتدلًا): يُفحص كما يُعرض، والغطاء في مكانه، والاتجاه محفوظ
        const q = await ctx.newPage();
        await q.goto(extUrl("pages/clean-video.html"));
        await q.setInputFiles("#file", join(site, "gallery-rotated.mp4"));
        await q.waitForFunction(() => document.body.dataset.state, null, { timeout: 900000 });
        const st2 = await q.evaluate(() => document.body.dataset.state);
        check("فيديو عمودي: يكتمل بلا خطأ", st2 === "done", st2 === "done" ? "" : await q.evaluate(() => document.body.dataset.error?.slice(0, 400)));
        if (st2 === "done") {
            const b64 = await q.evaluate(async () => {
                const buf = new Uint8Array(await (await fetch(document.getElementById("out").src)).arrayBuffer());
                let s = "";
                for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                return btoa(s);
            });
            const out2 = join(tmp, "clean-rot.mp4");
            (await import("node:fs")).writeFileSync(out2, Buffer.from(b64, "base64"));
            const rot = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream_side_data=rotation", "-of", "csv=p=0", out2]).toString().trim();
            check("فيديو عمودي: الاتجاه محفوظ", rot.includes("-90"), rot);
            const frameAt = (file, t) => execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=72:96", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
            const diff = (t) => {
                const a = frameAt(join(site, "gallery-rotated.mp4"), t), b = frameAt(out2, t);
                let d = 0;
                for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
                return d / a.length;
            };
            const dW = diff(2), dL = diff(9);
            check("فيديو عمودي: المرأة مغطاة", dW > 20, `فرق ${dW.toFixed(1)}`);
            check("فيديو عمودي: المنظر الطبيعي كما هو", dL < 6, `فرق ${dL.toFixed(1)}`);
        }
        await q.close();
    }

    // ===== مؤشر الصحة: «الحماية تعمل» فقط حين تعمل كل طبقة =====
    if (want("health")) {
        const sp = await ctx.newPage();
        await sp.goto(extUrl("pages/settings.html"));
        let h = null;
        for (let i = 0; i < 60; i++) {
            h = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:get-health" }));
            if (h?.overall === "ok") break;
            await sleep(1000);
        }
        check("مؤشر الصحة: كل الطبقات تعمل", h?.overall === "ok", JSON.stringify(h));
        const txt = await sp.locator("#statusText").innerText();
        check("الصفحة تقول «الحماية تعمل» بعد التحقق", txt === "الحماية تعمل", txt);
        await sp.close();
    }

    // ===== اختبار الحماية الذاتي، وقسم الاستثناءات =====
    if (want("selftest")) {
        const p = await ctx.newPage();
        await p.goto(extUrl("pages/selftest.html"));
        let sum = "";
        for (let i = 0; i < 90 && (!sum || sum.includes("جارٍ")); i++) { await sleep(500); sum = await p.locator("#summary").innerText(); }
        check("اختبار الحماية: كل الطبقات المفعّلة تعمل", sum.includes("كل الحماية المفعّلة تعمل"), sum + " | " + (await p.locator("#list").innerText()).replace(/\n/g, " "));
        // استثناء موقع ثم إزالته من قسم «الاستثناءات» (الإزالة تشدد فلا تحتاج رمزًا)
        await p.goto(extUrl("pages/settings.html#except"));
        await p.evaluate(async () => {
            await chrome.runtime.sendMessage({ type: "hisn:allow-site", site: "example-ok.com", pin: "4826" });
            await chrome.runtime.sendMessage({ type: "hisn:lock-now" }); // لا نترك القفل مفتوحًا للاختبارات التالية
        });
        await p.reload();
        await p.waitForTimeout(800);
        const row = p.locator(".ex", { hasText: "example-ok.com" });
        const had = await row.count();
        await row.locator("button").click();
        await p.waitForTimeout(800);
        const st = await p.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:get-settings" }));
        check("قسم الاستثناءات: يعرض الموقع المستثنى ويعيد حجبه", had === 1 && !st.allowlist.includes("example-ok.com"), JSON.stringify(st.allowlist));
        await p.close();
    }

    // ===== النافذة السريعة: الحالة، وتنظيف فيديو، و«عندي مشكلة» =====
    if (want("popup")) {
        const site = await ctx.newPage();
        await site.goto(`${A}/index.html`);
        await waitStates(site, ["land"]);
        const sp = await ctx.newPage();
        await sp.goto(extUrl("pages/settings.html"));
        const tabId = await sp.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes("/index.html"))?.id);
        const p = await ctx.newPage();
        await p.goto(extUrl(`pages/popup.html?tab=${tabId}`));
        let title = "";
        for (let i = 0; i < 40 && title !== "الحماية تعمل"; i++) { await sleep(500); title = await p.locator("#title").innerText(); }
        check("النافذة: «الحماية تعمل» ومفعّلة على الموقع", title === "الحماية تعمل" && (await p.locator("#siteText").innerText()) === "مفعّلة على هذا الموقع", title);
        const [cv] = await Promise.all([ctx.waitForEvent("page"), p.click("#clean")]);
        await cv.waitForLoadState();
        check("زر «تنظيف فيديو» يفتح صفحة التنظيف", cv.url().includes("clean-video.html"), cv.url());
        await cv.close();
        // «شيء غير مناسب ظهر»: الضغطة التالية على صورة تخفيها
        await sp.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: "hisn:pick-hide" }), tabId);
        await sleep(300);
        await site.click("#land");
        await sleep(500);
        check("«شيء غير مناسب ظهر» يخفي الصورة المختارة", (await site.getAttribute("#land", "data-hisn")) === "cover", await site.getAttribute("#land", "data-hisn"));
        await site.close(); await sp.close();
        if (!p.isClosed()) await p.close();
    }

    // ===== وضع الطفل: السحر والجن والرعب، ويوتيوب المقيّد الشديد =====
    if (want("child")) {
        const sp = await ctx.newPage();
        await sp.goto(extUrl("pages/settings.html"));
        await sp.waitForTimeout(800);
        await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:set-pin", pin: "4826" }));
        // نفس ما يرسله زر «وضع الطفل» (عمر أقل من 9)
        const preset = await sp.evaluate(async () => {
            const { childPreset } = await import(chrome.runtime.getURL("pages/settings.js")).catch(() => ({}));
            return childPreset ? childPreset("under9") : null;
        }).catch(() => null);
        const patch = preset ?? { childMode: true, childAge: "under9", blockScaryTopics: true, youtubeRestricted: true, youtubeStrict: true, safeSearch: true };
        const r = await sp.evaluate(async (patch) => chrome.runtime.sendMessage({ type: "hisn:update-settings", patch, pin: "4826" }), patch);
        check("وضع الطفل يُفعّل", r?.ok && r.settings?.childMode && r.settings?.blockScaryTopics, JSON.stringify(r).slice(0, 80));
        // تشغيل وضع الطفل من حساب رجل يطلب الرمز (يخفف تغطية النساء)، والرمز الصحيح يفتح 5 دقائق: نقفل أولًا
        await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:lock-now" }));
        const off = await sp.evaluate(async () => chrome.runtime.sendMessage({ type: "hisn:update-settings", patch: { childMode: false } }));
        check("إطفاء وضع الطفل يحتاج الرمز (مع القفل)", !off?.ok, JSON.stringify(off).slice(0, 60));
        await sleep(800);

        const p = await ctx.newPage();
        await p.goto("https://www.youtube.com/watch?v=hdr");
        const y = JSON.parse(await p.locator("#echo").innerText());
        check("يوتيوب: الوضع المقيّد الشديد للطفل", y.headers["youtube-restrict"] === "Strict", y.headers["youtube-restrict"] ?? "مفقودة");

        const card = (t) => `<ytd-rich-item-renderer><a id="video-title" href="/watch?v=1">${t}</a><span>قناة</span></ytd-rich-item-renderer>`;
        await p.route("https://www.youtube.com/feed-test", (rt) => rt.fulfill({ contentType: "text/html; charset=utf-8", body:
            `<!doctype html><meta charset="utf-8"><title>YouTube</title><div id="grid">${card("قصة رعب حقيقية في بيت مسكون")}${card("تعلم الحروف العربية للأطفال")}${card("Poppy Playtime chapter 3")}${card("سورة الجن - تلاوة خاشعة")}</div>
            <script>setTimeout(()=>{document.getElementById('grid').insertAdjacentHTML('beforeend', ${JSON.stringify(card("أزياء الهالوين المخيفة"))} + ${JSON.stringify(card("طبخ سهل"))})}, 700)</script>` }));
        await p.goto("https://www.youtube.com/feed-test");
        await sleep(2500);
        const shown = await p.evaluate(() => [...document.querySelectorAll("ytd-rich-item-renderer")].map((c) => [c.querySelector("a").textContent, getComputedStyle(c).display !== "none"]));
        const vis = Object.fromEntries(shown);
        check("بطاقات الرعب والسحر والهالوين مخفية", !vis["قصة رعب حقيقية في بيت مسكون"] && !vis["Poppy Playtime chapter 3"] && !vis["أزياء الهالوين المخيفة"], JSON.stringify(shown));
        check("البطاقات السليمة وسورة الجن ظاهرة", vis["تعلم الحروف العربية للأطفال"] && vis["سورة الجن - تلاوة خاشعة"] && vis["طبخ سهل"], JSON.stringify(shown));

        await p.route("https://www.youtube.com/watch?v=scary", (rt) => rt.fulfill({ contentType: "text/html; charset=utf-8", body:
            `<!doctype html><meta charset="utf-8"><title>Scary ghost story at 3am - YouTube</title><video src="${A}/test-video.webm" autoplay muted loop></video>` }));
        await p.goto("https://www.youtube.com/watch?v=scary");
        await sleep(3000);
        const st = await p.evaluate(() => ({ notice: Boolean(document.querySelector(".hisn-topic-notice")), paused: document.querySelector("video").paused }));
        check("مقطع رعب مفتوح: يتوقف ويظهر تنبيه", st.notice && st.paused, JSON.stringify(st));
        await p.close();
        await sp.close();
    }

    check("لا أخطاء في الصفحات", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
    check("خطأ غير متوقع", false, String(e?.stack ?? e).slice(0, 600));
} finally {
    await ctx.close();
    a.close(); b.close(); echo.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} ناجح`);
    process.exit(failed.length ? 1 : 0);
}
