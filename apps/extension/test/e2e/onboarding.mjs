// F08: التهيئة لا تعلن النجاح إلا بعد تحقق الحفظ، وتعرض حالة كل طبقة. التشغيل: node test/e2e/onboarding.mjs
import { mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
const here = dirname(new URL(import.meta.url).pathname);
const ext = join(here, "../../dist/chrome");
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? "/opt/npm-tools/node_modules/playwright", "package.json"))("playwright");
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "ob-")), { headless: true, channel: "chromium", args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"] });
let sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker");
const id = new URL(sw.url()).host;
const res = []; const ok = (n, c, d = "") => { res.push(c); console.log(`${c ? "✓" : "✗"} ${n} ${d}`); };
const open = async () => { const p = await ctx.newPage(); await p.goto(`chrome-extension://${id}/pages/onboarding.html`); return p; };
const visibleStep = (p) => p.evaluate(() => [...document.querySelectorAll(".step")].find((s) => !s.hidden)?.dataset.step);

// 1) رفض حفظ الإعدادات: لا تظهر شاشة النجاح
let p = await open();
await p.click("[data-viewer=male]"); await p.click("[data-next]");
await p.evaluate(() => { const orig = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = (m) => m.type === "hisn:update-settings" ? Promise.resolve({ ok: false }) : orig(m); });
await p.click("#skipPin"); await p.waitForTimeout(500);
ok("F08: رفض الحفظ يبقي المستخدم ويعرض خطأ", (await visibleStep(p)) === "3" && (await p.textContent("#err")).includes("تعذّر"), await p.textContent("#err"));
await p.close();

// 2) الخلفية لا ترد: لا نجاح
p = await open();
await p.click("[data-viewer=male]"); await p.click("[data-next]");
await p.evaluate(() => { chrome.runtime.sendMessage = () => Promise.reject(new Error("no receiver")); });
await p.click("#skipPin"); await p.waitForTimeout(500);
ok("F08: فشل الخلفية لا يعلن النجاح", (await visibleStep(p)) === "3");
await p.close();

// 3) المسار الطبيعي: نجاح + حالة لكل طبقة
p = await open();
await p.click("[data-child]");
ok("UX03: سؤال العمر يظهر في وضع الطفل", await p.isVisible("#childAge"));
await p.selectOption("#childAge", "under9");
await p.click("#skipPin");
await p.waitForTimeout(1500);
const layers = await p.$$eval("#layers li", (l) => l.map((x) => x.textContent));
ok("F08: شاشة النجاح تعرض حالة الطبقات", (await visibleStep(p)) === "4" && layers.some((t) => /فحص الصور: /.test(t)), layers.join(" | "));
const saved = await p.evaluate(() => chrome.runtime.sendMessage({ type: "hisn:get-settings" }));
ok("UX03: العمر المختار محفوظ", saved.childAge === "under9" && saved.childMode === true, saved.childAge);
console.log(`${res.filter(Boolean).length}/${res.length}`);
await ctx.close(); process.exit(res.every(Boolean) ? 0 : 1);
