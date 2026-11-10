// زر الرجوع فوق/قبل وسيط محجوب لا يفتح نافذة «محتوى مخفي» (يوتيوب، تيك توك…). التشغيل: node test/e2e/back-button.mjs
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const here = dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? "/opt/npm-tools/node_modules/playwright", "package.json"))("playwright");
const bundle = (await build({ entryPoints: [join(here, "review/entry.js")], bundle: true, format: "iife", write: false, loader: { ".json": "json" }, logLevel: "error" })).outputFiles[0].text;
const shim = readFileSync(join(here, "review/shim.js"), "utf8");
const page = `<!doctype html><html><head><meta name=viewport content="width=390"><script>${shim}</script><script>${bundle}</script>
<style>body{margin:0} #hdr{position:fixed;top:0;left:0;right:0;height:48px;z-index:5} #back{width:44px;height:44px} img{display:block;width:390px;height:600px;background:#888}</style></head>
<body><div id="hdr"><button id="back" aria-label="Back"><svg width="24" height="24"><path d="M2 12 L20 2 L20 22 Z"/></svg></button></div>
<div id="content"><div style="height:60px"></div><p>comments page</p></div>
<script>
window.actions = 0; window.backs = 0;
T.installClickGuard(() => { window.actions++; });
const feed = () => { document.getElementById("content").innerHTML = '<img id="m" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'; T.setMediaState(document.getElementById("m"), "blur", "woman"); };
// مثل يوتيوب/تيك توك: الرجوع ينفّذ عند بداية اللمس (قبل رفع الإصبع) فتظهر الخلاصة تحت الإصبع
document.getElementById("back").addEventListener("pointerdown", () => { window.backs++; history.pushState({}, "", "/feed"); feed(); document.getElementById("hdr").style.display = "none"; });
</script></body></html>`;
const srv = createServer((rq, rs) => { rs.writeHead(200, { "content-type": "text/html; charset=utf-8" }); rs.end(page); }).listen(0);
const b = await chromium.launch({ args: ["--no-sandbox", "--no-proxy-server"] });
const ctx = await b.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
const p = await ctx.newPage();
const res = []; const ok = (n, c, d = "") => { res.push(c); console.log(`${c ? "✓" : "✗"} ${n} ${d}`); };
await p.goto(`http://127.0.0.1:${srv.address().port}/comments`);
await p.touchscreen.tap(22, 22);
await p.waitForTimeout(400);
let r = await p.evaluate(() => ({ actions, backs, under: !!document.getElementById("m") }));
ok("زر الرجوع يعمل", r.backs === 1 && r.under);
ok("لا نافذة «محتوى مخفي» بعد الرجوع", r.actions === 0, `actions=${r.actions}`);
// زر صغير فوق وسيط محجوب دون تنقل
await p.evaluate(() => { const btn = document.createElement("button"); btn.id = "x"; btn.textContent = "×"; btn.style.cssText = "position:fixed;top:300px;left:300px;width:40px;height:40px;z-index:9"; document.body.append(btn); });
await p.touchscreen.tap(320, 320);
await p.waitForTimeout(400);
ok("زر فوق مقطع محجوب: الضغطة للزر", (await p.evaluate(() => actions)) === 0);
await p.waitForTimeout(1000);
// لمس الوسيط المحجوب نفسه: تفتح الخيارات
await p.touchscreen.tap(100, 400);
await p.waitForTimeout(400);
ok("لمس الوسيط المحجوب يفتح الخيارات", (await p.evaluate(() => actions)) === 1, `actions=${await p.evaluate(() => actions)}`);
console.log(`${res.filter(Boolean).length}/${res.length}`);
await b.close(); srv.close(); process.exit(res.every(Boolean) ? 0 : 1);
