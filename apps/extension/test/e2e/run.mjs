// اختبار الإضافة في متصفح Chromium حقيقي.
// المتصفح المتاح هنا لا يدعم تحميل الإضافات، فنشغّل كود الإضافة نفسه (dist/chrome)
// داخل صفحات عادية مع محاكاة لواجهة الإضافات (shim.js): سكربت الصفحة، والخلفية، ومحرك الكشف بالنماذج الحقيقية.
// التشغيل: node test/e2e/run.mjs <مجلد فيه puppeteer-core و @sparticuz/chromium>
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// مغطّى: تضبيب كامل، أو وميض الانتظار، أو تغطية جزئية للمرأة (المستوى المتوسط)
const hid = (x) => !!x && (/blur|contrast\(0\)/.test(x.f ?? "") || x.st === "partial");

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, "../../dist/chrome");
const req = createRequire(join(process.argv[2], "package.json"));
const puppeteer = (await import(pathToFileURL(req.resolve("puppeteer-core")).href)).default;
const chromium = (await import(pathToFileURL(req.resolve("@sparticuz/chromium")).href)).default;

const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
    ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".wasm": "application/wasm",
    ".css": "text/css", ".onnx": "application/octet-stream", ".bin": "application/octet-stream",
    ".webm": "video/webm", ".vtt": "text/vtt; charset=utf-8",
};
const server = createServer((rq, rs) => {
    const url = new URL(rq.url, "http://x");
    let p;
    if (url.pathname === "/shim.js") p = join(here, "shim.js");
    else if (url.pathname.startsWith("/ext/")) p = join(ext, url.pathname.slice(5));
    else p = join(here, "site", decodeURIComponent(url.pathname));
    if (!existsSync(p) || statSync(p).isDirectory()) { rs.writeHead(404); return rs.end(); }
    let body = readFileSync(p);
    if (extname(p) === ".html" && !url.pathname.startsWith("/ext/")) {
        // نحقن كود الإضافة كما يفعل المتصفح: سكربت الصفحة أولًا، ثم الخلفية والمحرك
        body = body.toString()
            .replace("<head>", '<head><script src="/shim.js"></script><script src="/ext/content.js"></script>')
            .replace("</body>", '<script type="module" src="/ext/background.js"></script><script type="module" src="/ext/offscreen.js"></script></body>');
    }
    rs.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    rs.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const results = [];
const check = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    headless: true,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function openTest(query) {
    const page = await browser.newPage();
    page.on("console", (m) => {
        const t = m.text();
        if (m.type() === "error" || t.startsWith("Hisn")) console.log("   [page]", t.slice(0, 200));
    });
    page.on("pageerror", (e) => console.log("   [pageerror]", String(e).slice(0, 300)));
    await page.goto(`${base}/index.html?${query}`, { waitUntil: "domcontentloaded" });
    return page;
}

async function waitStates(page, ids, timeoutMs = 120000) {
    const t0 = Date.now();
    let st;
    while (Date.now() - t0 < timeoutMs) {
        st = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
            const el = document.getElementById(id);
            return [id, el ? `${el.getAttribute("data-hisn")}${el.dataset.hisnReason ? ":" + el.dataset.hisnReason : ""}` : "missing"];
        })), ids);
        if (Object.values(st).every((v) => !v.startsWith("pending") && !v.startsWith("null"))) break;
        await sleep(1000);
    }
    return { st, ms: Date.now() - t0 };
}

try {
    if (process.env.ONLY !== "audio") {
    // ===== المستخدم رجل، المستوى المتوسط =====
    const page = await openTest("viewer=male&level=medium");
    const early = await page.evaluate(() => getComputedStyle(document.getElementById("land")).filter);
    check("الصورة مضبّبة فور تحميل الصفحة (مغلق عند الشك)", /blur|contrast\(0\)/.test(early), early);

    await sleep(2500);
    const text = await page.evaluate(() => ({
        clean: document.getElementById("clean").textContent,
        profane: document.getElementById("profane").textContent,
        fold: document.getElementById("explicit").getAttribute("data-hisn-fold"),
        ta: document.getElementById("ta").value,
        dyn: document.getElementById("dyn")?.textContent ?? "",
    }));
    check("النص السليم لم يتغير", text.clean.includes("عرصات يوم القيامة") && text.clean.includes("زبدة"));
    check("اللفظ الفاحش العربي أُخفي", !text.profane.includes("شرموطة") && text.profane.includes("*"), text.profane);
    check("اللفظ المتحايل عليه أُخفي (f.u.c.k)", !text.profane.includes("f.u.c.k"));
    check("الفقرة الإباحية طُويت", Boolean(text.fold), text.fold ?? "");
    check("خانة الكتابة لم تُلمس", text.ta.includes("شرموطة"));
    check("النص المضاف لاحقًا فُلتر", Boolean(text.dyn) && !text.dyn.includes("كسمك"), text.dyn);

    const ids = ["land", "land2", "icon", "woman", "man", "belly", "group", "man2", "woman2", "mengroup"];
    const { st, ms } = await waitStates(page, ids);
    console.log("   حالات الصور (رجل):", JSON.stringify(st), `${(ms / 1000).toFixed(1)}ث`);
    check("الأيقونة الصغيرة ظهرت دون فحص", st.icon === "ok");
    check("صورة الطبيعة ظهرت بعد الفحص", st.land === "ok", st.land);
    check("الصورة المضافة لاحقًا فُحصت", st.land2 === "ok", st.land2);
    check("صورة المرأة ضُبّبت للرجل", st.woman.startsWith("blur"), st.woman);
    check("صورة الرجل ظهرت", st.man === "ok", st.man);
    check("صورة وجه رجل واضحة ظهرت", st.man2 === "ok", st.man2);
    check("صورة وجه امرأة واضحة ضُبّبت", st.woman2.startsWith("blur"), st.woman2);
    check("صورة جماعة رجال ظهرت", st.mengroup === "ok", st.mengroup);
    check("صورة امرأة ببطن مكشوف حُجبت", st.belly.startsWith("blur") || st.belly.startsWith("cover"), st.belly);
    check("صورة الجماعة (نساء) ضُبّبت للرجل", st.group.startsWith("blur") || st.group.startsWith("cover"), st.group);
    const after = await page.evaluate(() => getComputedStyle(document.getElementById("land")).filter);
    check("لا تضبيب على الصورة السليمة بعد الفحص", after === "none", after);

    // الضغط على صورة محجوبة يعرض الخيارات ولا يكشفها مباشرة
    const box = await (await page.$("#woman")).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(400);
    const popup = await page.evaluate(() => Boolean(document.querySelector("hisn-ui")));
    check("الضغط على الصورة المحجوبة يعرض نافذة الخيارات", popup);
    const stillHidden = await page.evaluate(() => document.getElementById("woman").getAttribute("data-hisn"));
    check("الصورة لم تُكشف بمجرد الضغط", stillHidden !== "revealed" && stillHidden !== "ok");

    // قواعد الشبكة التي ثبّتتها الخلفية
    const rules = await page.evaluate(() => window.__hisnTest.getRules());
    check("الخلفية ثبّتت قواعد الحجب والبحث الآمن", rules.length > 20, `${rules.length} قاعدة`);
    check("قاعدة الوضع المقيّد في يوتيوب موجودة", rules.some((r) => r.action.type === "modifyHeaders"));
    await page.close();

    // ===== المستخدمة امرأة =====
    const p2 = await openTest("viewer=female&level=medium");
    const r2 = await waitStates(p2, ["woman", "man", "group", "land"]);
    console.log("   حالات الصور (امرأة):", JSON.stringify(r2.st));
    check("صورة المرأة ظهرت للمستخدمة", r2.st.woman === "ok", r2.st.woman);
    check("صورة الجماعة ظهرت للمستخدمة (بلا عورة)", r2.st.group === "ok", r2.st.group);
    await p2.close();

    // ===== المستوى الصارم =====
    const p3 = await openTest("viewer=male&level=strict");
    const r3 = await waitStates(p3, ["man", "land"]);
    check("الصارم: صورة الرجل تُضبَّب أيضًا", r3.st.man.startsWith("blur"), r3.st.man);
    check("الصارم: صورة الطبيعة تظهر", r3.st.land === "ok", r3.st.land);
    await p3.close();

    // ===== الفيديو: امرأة 25 ثانية ثم منظر طبيعي =====
    const pv = await browser.newPage();
    pv.on("pageerror", (e) => console.log("   [pageerror]", String(e).slice(0, 300)));
    await pv.goto(`${base}/video.html?viewer=male&level=medium`, { waitUntil: "domcontentloaded" });
    const timeline = [];
    for (let i = 0; i < 80; i++) {
        const s = await pv.evaluate(() => {
            const v = document.getElementById("v");
            return { t: +v.currentTime.toFixed(1), st: v.getAttribute("data-hisn"), r: v.dataset.hisnReason ?? "", f: getComputedStyle(v).filter };
        });
        timeline.push(s);
        if (s.t > 50 && s.st === "ok") break;
        await sleep(1000);
    }
    const inWoman = timeline.filter((x) => x.t > 4 && x.t < 24);
    const afterLand = timeline.filter((x) => x.t > 40);
    console.log("   خط زمني للفيديو:", timeline.filter((_, i) => i % 5 === 0).map((x) => `${x.t}ث:${x.st}`).join(" "));
    check("الفيديو مضبّب منذ البداية", hid(timeline[0]), timeline[0]?.f);
    check("الفيديو مضبّب طوال مقطع المرأة", inWoman.length > 0 && inWoman.every(hid), `${inWoman.length} قراءة`);
    check("الفيديو ظهر بعد تحوله إلى منظر طبيعي", afterLand.some((x) => x.st === "ok"), afterLand.at(-1)?.st);
    await pv.close();
    }

    // الصوت يُختبر في real.mjs (يحتاج الإضافة الحقيقية: إطار محرك التنظيف)
} catch (e) {
    check("خطأ غير متوقع", false, String(e?.stack ?? e).slice(0, 500));
} finally {
    await browser.close();
    server.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} ناجح`);
    process.exit(failed.length ? 1 : 0);
}
