// فحص الأخطاء على نصوص لا يجوز أن يُخفى منها شيء: القرآن كاملًا (6348 آية)، وصحيحا البخاري ومسلم (14736 حديثًا)
// بالعربية والإنجليزية. يجب أن تكون النتيجة صفرًا في المستويين المخفف والمتوسط.
// التشغيل: node packages/core/scripts/scan-religious-texts.mjs   (يحمّل النصوص من GitHub أول مرة)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextFilter } from "../src/index.js";

const cache = join(tmpdir(), "hisn-corpus");
mkdirSync(cache, { recursive: true });
async function get(name, url) {
    const p = join(cache, name);
    if (!existsSync(p)) writeFileSync(p, Buffer.from(await (await fetch(url)).arrayBuffer()));
    return JSON.parse(readFileSync(p, "utf8"));
}
const f = new TextFilter(JSON.parse(readFileSync(new URL("../data/lexicon.json", import.meta.url))));
const report = (name, texts) => {
    const hits = texts.filter((t) => f.findProfanity(t).length);
    const ex = Object.fromEntries(["light", "medium", "strict"].map((l) => [l, texts.filter((t) => f.isExplicit(t, l)).length]));
    console.log(`${name}: ${texts.length} نص، ألفاظ: ${hits.length}، طيّ: ${JSON.stringify(ex)}`);
    for (const h of hits.slice(0, 10)) console.log("   ", h.slice(0, 120), "←", f.findProfanity(h).map((r) => h.slice(r.start, r.end)).join(" | "));
    return hits.length + ex.light + ex.medium;
};
const verses = [];
for (let i = 1; i <= 114; i++) {
    const s = await get(`s_${i}.json`, `https://raw.githubusercontent.com/semarketir/quranjson/master/source/surah/surah_${i}.json`);
    verses.push(...Object.values(s.verse));
}
let bad = report("القرآن", verses);
for (const b of ["bukhari", "muslim"]) {
    const d = await get(`${b}.json`, `https://raw.githubusercontent.com/AhmedBaset/hadith-json/main/db/by_book/the_9_books/${b}.json`);
    bad += report(`${b} (عربي)`, d.hadiths.map((h) => h.arabic ?? "").filter(Boolean));
    bad += report(`${b} (إنجليزي)`, d.hadiths.map((h) => (typeof h.english === "object" ? Object.values(h.english).join(" ") : h.english ?? "")).filter(Boolean));
}
process.exit(bad ? 1 : 0);
