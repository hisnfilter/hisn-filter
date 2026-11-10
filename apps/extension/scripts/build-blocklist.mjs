// يبني قوائم المواقع المحجوبة من مصادر مفتوحة مرخصة MIT، ويحفظها في static/rules.
// التشغيل: npm run blocklist  (يحتاج اتصالًا بالإنترنت، ويُشغَّل عند تحديث القوائم فقط)
import { writeFileSync, mkdirSync } from "node:fs";

const SOURCES = {
    adult: [
        // Sinfonietta (MIT) — https://github.com/Sinfonietta/hostfiles
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/extensions/porn/sinfonietta/hosts",
        // Clefspeare13 pornhosts (MIT) — https://github.com/Clefspeare13/pornhosts
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/extensions/porn/clefspeare13/hosts",
    ],
    gambling: [
        // Sinfonietta (MIT) و BigDargon (MIT)
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/extensions/gambling/sinfonietta/hosts",
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/extensions/gambling/bigdargon/hosts",
    ],
};

// مواقع عامة لا تُحجب أبدًا حتى لو ظهرت في قائمة بالخطأ (نحجب المحتوى داخلها لا الموقع كله).
const NEVER_BLOCK = new Set([
    "google.com", "youtube.com", "twitter.com", "x.com", "reddit.com", "instagram.com",
    "facebook.com", "tiktok.com", "snapchat.com", "whatsapp.com", "telegram.org", "t.me",
    "wikipedia.org", "bing.com", "duckduckgo.com", "imgur.com", "tumblr.com", "pinterest.com",
    "amazon.com", "apple.com", "microsoft.com", "github.com", "githubusercontent.com",
    "googleusercontent.com", "googlevideo.com", "ytimg.com", "fbcdn.net", "cdninstagram.com",
    "twimg.com", "redd.it", "redditmedia.com", "cloudflare.com", "cloudfront.net", "akamaihd.net",
]);

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function parseHosts(text) {
    const out = [];
    for (let line of text.split(/\r?\n/)) {
        line = line.replace(/#.*/, "").trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        const d = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
        if (DOMAIN_RE.test(d) && d !== "localhost") out.push(d);
    }
    return out;
}

/** يحذف النطاقات الفرعية إذا كان النطاق الأب موجودًا، لأن قواعد المتصفح تشمل الفرعية تلقائيًا. */
function collapse(domains) {
    const set = new Set(domains);
    const result = [];
    for (const d of set) {
        if (NEVER_BLOCK.has(d) || [...NEVER_BLOCK].some((n) => d.endsWith("." + n))) continue;
        const parts = d.split(".");
        let covered = false;
        for (let i = 1; i < parts.length - 1; i++) {
            if (set.has(parts.slice(i).join("."))) { covered = true; break; }
        }
        if (!covered) result.push(d);
    }
    return result.sort();
}

mkdirSync(new URL("../static/rules/", import.meta.url), { recursive: true });
for (const [name, urls] of Object.entries(SOURCES)) {
    const all = [];
    for (const url of urls) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`فشل تحميل ${url}: ${res.status}`);
        all.push(...parseHosts(await res.text()));
    }
    const domains = collapse(all);
    writeFileSync(
        new URL(`../static/rules/${name}-domains.json`, import.meta.url),
        JSON.stringify({ generated: new Date().toISOString().slice(0, 10), sources: urls, domains })
    );
    console.log(`${name}: ${all.length} مدخل → ${domains.length} نطاق`);
}
