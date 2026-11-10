// اختبار انحدار لإصلاحات مراجعة ChatGPT (F01: الإظهار مربوط بالمصدر، F02: الإيقاف الشامل).
// يعمل في Chromium حقيقي بوحدات الصفحة نفسها (بلا نماذج). التشغيل: node test/e2e/review-fixes.mjs
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const here = dirname(new URL(import.meta.url).pathname);
const pwRoot = process.env.PLAYWRIGHT_DIR ?? "/opt/npm-tools/node_modules/playwright";
const { chromium } = createRequire(join(pwRoot, "package.json"))("playwright");
const bundle = (await build({ entryPoints: [join(here, "review/entry.js")], bundle: true, format: "iife", write: false, loader: { ".json": "json" }, logLevel: "error" })).outputFiles[0].text;
const shim = readFileSync(join(here, "review/shim.js"), "utf8");
const video = readFileSync(join(here, "site/test-video.webm"));
const srv = createServer((rq, rs) => {
    if (rq.url.startsWith("/v.webm")) { rs.writeHead(200, { "content-type": "video/webm" }); return rs.end(video); }
    if (rq.url.startsWith("/img")) { rs.writeHead(200, { "content-type": "image/jpeg" }); return rs.end(readFileSync(join(here, "site/landscape.jpg"))); }
    rs.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    rs.end(`<!doctype html><html><head><script>${shim}</script><script>${bundle}</script></head><body><img id="i" src="/img?a" width="300" height="300"><video id="v" src="/v.webm" width="320" height="240" muted playsinline></video></body></html>`);
}).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const b = await chromium.launch({ args: ["--no-sandbox", "--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage();
const res = []; const ok = (n, c, d = "") => { res.push(c); console.log(`${c ? "✓" : "✗"} ${n} ${d}`); };
await p.goto(base + "/");
await p.waitForTimeout(500);

// ===== F01 =====
let r = await p.evaluate(async () => {
    const img = document.getElementById("i");
    T.setMediaState(img, "blur", "woman");
    T.markRevealed(img);
    const same = (T.mediaSourceChanged(img), img.getAttribute(T.ATTR));
    img.src = "/img?b";
    await new Promise((r) => img.addEventListener("load", r, { once: true }));
    T.mediaSourceChanged(img);
    return { same, after: img.getAttribute(T.ATTR), valid: T.revealStillValid(img) };
});
ok("F01: الإظهار يبقى للمصدر نفسه", r.same === "revealed", r.same);
ok("F01: مصدر جديد في العنصر نفسه لا يرث الإظهار", r.after !== "revealed" && !r.valid, r.after);

// ===== F02 =====
r = await p.evaluate(() => {
    const v = document.getElementById("v");
    v.muted = false;
    v.dataset.hisnSong = "1"; v.dataset.hisnSongWas = ""; v.muted = true;
    T.configureSongs({ enabled: false });
    const songReleased = !v.muted && !v.dataset.hisnSong;
    // كتمه المستخدم قبلنا: يبقى مكتومًا
    v.muted = true; v.dataset.hisnSong = "1"; v.dataset.hisnSongWas = "muted";
    T.configureSongs({ enabled: false });
    return { songReleased, userMuteKept: v.muted };
});
ok("F02: إيقاف الحماية يعيد صوت مقطع كتمناه (أغنية)", r.songReleased);
ok("F02: لا يُلغى كتم وضعه المستخدم", r.userMuteKept);

r = await p.evaluate(() => {
    const v = document.getElementById("v");
    v.muted = false;
    T.configureAudio({ enabled: true, removeMusic: true, muteSpokenProfanity: false, level: "medium" });
    T.watchAudio(v);
    const g = [...T._audioTest.guards].find((x) => x.el === v);
    g.mute.set("music", true);
    const mutedByUs = v.muted;
    T.suspendAudio();
    const afterSuspend = { muted: v.muted, mark: v.dataset.hisnMute ?? null };
    v.dispatchEvent(new Event("loadedmetadata")); // مقطع جديد بعد الإيقاف: لا يعاد الكتم
    return { mutedByUs, afterSuspend, reMuted: v.muted, mode: v.dataset.hisnAudioMode };
});
ok("F02: suspendAudio يرفع كتم الموسيقى الذي وضعناه", r.mutedByUs && !r.afterSuspend.muted && !r.afterSuspend.mark, JSON.stringify(r.afterSuspend));
ok("F02: لا يعود الكتم بعد الإيقاف عند تغيّر المقطع", !r.reMuted && r.mode === "original", r.mode);

r = await p.evaluate(async () => {
    const v = document.getElementById("v");
    T.watchVideo(v, { enabled: true, filterVideos: true, viewer: "male", level: "medium" });
    T.stopVideoMonitors();
    T.setMediaState(v, "ok");
    v.dispatchEvent(new Event("emptied"));
    await new Promise((r) => setTimeout(r, 300));
    const st = v.getAttribute(T.ATTR);
    T.setPartial(v, [{ box: [0.1, 0.1, 0.3, 0.3] }]);
    const boxes = document.querySelectorAll(".hisn-cover-box").length;
    T.clearAllVideoOverlays();
    return { st, boxes, after: document.querySelectorAll(".hisn-cover-box").length };
});
ok("F02: مراقب الإطارات المتوقف لا يغيّر حالة المقطع", r.st === "ok", r.st);
ok("F02: صناديق التغطية الجزئية تُزال عند الإيقاف", r.boxes === 1 && r.after === 0, `${r.boxes}→${r.after}`);

console.log(`${res.filter(Boolean).length}/${res.length}`);
await b.close(); srv.close(); process.exit(res.every(Boolean) ? 0 : 1);
