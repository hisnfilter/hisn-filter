// يطبع تحليل المحرك الخام لصور الاختبار (للتشخيص)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, "../../dist/chrome");
const req = createRequire(join(process.argv[2], "package.json"));
const puppeteer = (await import(pathToFileURL(req.resolve("puppeteer-core")).href)).default;
const chromium = { executablePath: async () => process.env.CHROME_PATH || "/opt/pw-browsers/chromium" };
const T = {".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".json":"application/json",".jpg":"image/jpeg",".png":"image/png",".wasm":"application/wasm"};
const server = createServer((rq, rs) => {
  const u = new URL(rq.url,"http://x"); let p;
  if (u.pathname==="/shim.js") p=join(here,"shim.js"); else if (u.pathname.startsWith("/ext/")) p=join(ext,u.pathname.slice(5)); else p=join(here,"site",u.pathname);
  if (!existsSync(p)||statSync(p).isDirectory()){rs.writeHead(404);return rs.end();}
  let b=readFileSync(p);
  if (u.pathname==="/blank.html") b='<!doctype html><html><head><script src="/shim.js"></script></head><body><script type="module" src="/ext/offscreen.js"></script></body></html>';
  rs.writeHead(200,{"content-type":T[extname(p)]??"application/octet-stream"}); rs.end(b);
}).listen(0);
const base=`http://localhost:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), headless: true, args:["--no-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const page = await browser.newPage();
await page.goto(`${base}/blank.html`);
for (const img of (process.argv[3]??"man.jpg,woman.jpg,belly.jpg").split(",")) {
  const r = await page.evaluate(async (src) => chrome.runtime.sendMessage({ type: "hisn:detect-image", src }), `${base}/${img}`);
  console.log(img, JSON.stringify(r));
}
await browser.close(); server.close();
