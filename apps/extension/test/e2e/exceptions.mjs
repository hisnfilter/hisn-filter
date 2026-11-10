// «تعذّر الفحص» مميَّز بإعادة فحص، وطلب مراجعة الطفل، وإخفاء «سليمة دائمًا» في وضع الطفل. التشغيل: node test/e2e/exceptions.mjs
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const here = dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? "/opt/npm-tools/node_modules/playwright", "package.json"))("playwright");
const bundle = (await build({ entryPoints: [join(here, "review/entry.js")], bundle: true, format: "iife", write: false, loader: { ".json": "json" }, logLevel: "error" })).outputFiles[0].text;
const shim = readFileSync(join(here, "review/shim.js"), "utf8");
const img = readFileSync(join(here, "site/landscape.jpg"));
const srv = createServer((rq, rs) => {
    if (rq.url.startsWith("/img")) { rs.writeHead(200, { "content-type": "image/jpeg" }); return rs.end(img); }
    rs.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    rs.end(`<!doctype html><html><head><script>${shim}</script><script>${bundle}</script></head><body><div style="position:relative;width:320px"><img id="i" alt="صورة شاطئ" src="/img?a" width="320" height="320"></div></body></html>`);
}).listen(0);
const b = await chromium.launch({ args: ["--no-sandbox", "--no-proxy-server"] });
const p = await b.newPage();
const res = []; const ok = (n, c, d = "") => { res.push(c); console.log(`${c ? "✓" : "✗"} ${n} ${d}`); };
await p.goto(`http://127.0.0.1:${srv.address().port}/`);
await p.waitForTimeout(300);
const popover = () => p.evaluate(() => { const l = T._popTest.last; return l ? { title: l.title, reason: l.reason, buttons: l.actions.map((a) => a.label) } : null; });

await p.evaluate(() => {
    T.configureMedia({ enabled: true, filterImages: true, level: "medium", viewer: "male", imageVerdicts: {} });
    T.installClickGuard(T.onHiddenMediaClick);
    const i = document.getElementById("i");
    i.dataset.hisnUserKey = "abcdef0123456789";
    T.setMediaState(i, "error", "error");
});
await p.waitForTimeout(1300);
ok("شارة «تعذّر الفحص» مختلفة", await p.evaluate(() => /تعذّر الفحص/.test(document.querySelector(".hisn-cover-badge")?.textContent || "")));
await p.evaluate(() => T.onHiddenMediaClick(document.getElementById("i"), 50, 50));
let pop = await popover();
ok("نافذة تعذّر الفحص: عنوان مميّز وليس «محتوى مخفي»", pop?.title === "تعذّر فحص هذا المحتوى", pop?.title);
ok("الخيار الأول «أعد الفحص»", pop?.buttons[0] === "أعد الفحص", pop?.buttons.join("|"));
ok("لا «سليمة دائمًا» لما تعذّر فحصه", !pop?.buttons.some((x) => x.includes("سليمة")));
await p.evaluate(() => T.retryAllErrors());
ok("إعادة الفحص تعيده «قيد الفحص»", (await p.evaluate(() => document.getElementById("i").getAttribute("data-hisn"))) === "pending");

// وضع الطفل في تطبيق الآيفون: طلب مراجعة بدل «سليمة دائمًا»
await p.evaluate(() => {
    globalThis.webkit = { messageHandlers: { hisn: { postMessage: async () => null } } };
    window.sent = null;
    chrome.runtime.sendMessage = async (m) => { if (m.type === "hisn:request-review") { window.sent = m; return { ok: true }; } return null; };
    T.configureMedia({ enabled: true, filterImages: true, level: "medium", viewer: "male", childMode: true, imageVerdicts: {} });
    T.setMediaState(document.getElementById("i"), "blur", "woman");
    T.onHiddenMediaClick(document.getElementById("i"), 50, 50);
});
pop = await popover();
ok("وضع الطفل: زر «اطلب من ولي الأمر مراجعتها»", pop?.buttons.includes("اطلب من ولي الأمر مراجعتها"), pop?.buttons.join("|"));
ok("وضع الطفل: لا «سليمة دائمًا»", !pop?.buttons.some((x) => x.includes("سليمة")));
await p.evaluate(() => T._popTest.last.actions.find((a) => a.label.includes("اطلب")).run());
await p.waitForTimeout(300);
const sent = await p.evaluate(() => window.sent);
ok("الطلب يحمل البصمة والوصف والموقع (لا رابط الصورة)", /^[0-9a-f]{16,}$/.test(sent?.key || "") && sent?.label === "صورة شاطئ" && sent?.host === "127.0.0.1" && !JSON.stringify(sent).includes("/img"), JSON.stringify(sent));
pop = await popover();
ok("تأكيد للطفل أن الطلب أُرسل", pop?.title?.includes("أُرسل"), pop?.title);
console.log(`${res.filter(Boolean).length}/${res.length}`);
await b.close(); srv.close(); process.exit(res.every(Boolean) ? 0 : 1);
