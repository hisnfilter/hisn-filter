// محرك فلترة النصوص: إخفاء الألفاظ الفاحشة، وكشف الفقرات الإباحية.
// يعمل على أي نص، ويُرجع مواضع الكلمات في النص الأصلي حتى تُخفى في مكانها.

import { normalize, normalizeTerm, deLeet, collapseSpacedLetters } from "./normalize.js";

const AR_LETTER = "\\u0621-\\u064A";
const AR_PREFIX = "(?:وال|فال|بال|لل|ال|يا|و|ف)";
const AR_SUFFIX = "(?:ها|هم|هن|كم|كن|ات|ين|ون|وا|نا|ني|ه|ك)";
const EN_SUFFIX = "(?:s|es|ed|ing|er|ers|y)";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** يحوّل كلمات القاموس إلى أنماط بحث. */
function compileArabic(terms) {
    const parts = terms.map((raw) => {
        const wild = raw.endsWith("*");
        const term = escape(normalizeTerm(wild ? raw.slice(0, -1) : raw));
        // الكلمات القصيرة (حرفان) لا تقبل سوابق ولا لواحق، حتى لا تطابق كلمات سليمة
        const short = term.length <= 2;
        const prefix = short ? "" : `${AR_PREFIX}?`;
        const suffix = wild ? `${AR_SUFFIX}?` : "";
        return `${prefix}${term}${suffix}`;
    });
    return new RegExp(`(?<![${AR_LETTER}])(?:${parts.join("|")})(?![${AR_LETTER}])`, "g");
}

function compileArabicPhrases(phrases) {
    const parts = phrases.map((p) =>
        normalizeTerm(p).split(/\s+/).map(escape).join("\\s+")
    );
    return new RegExp(`(?<![${AR_LETTER}])(?:${parts.join("|")})(?![${AR_LETTER}])`, "g");
}

function compileLatin(terms, { leet }) {
    const parts = terms.map((raw) => {
        const wild = raw.endsWith("*");
        const term = (wild ? raw.slice(0, -1) : raw).toLowerCase();
        const body = term.split(/\s+/).map(escape).join("\\s+");
        return wild ? `${body}[a-z]*` : `${body}${leet ? `${EN_SUFFIX}?` : ""}`;
    });
    const boundary = leet ? "a-z" : "a-z0-9";
    return new RegExp(`(?<![${boundary}])(?:${parts.join("|")})(?![${boundary}])`, "g");
}

function compileWeighted(dict, letters, prefix = "") {
    const entries = Object.entries(dict).filter(([k]) => !k.startsWith("_"));
    const terms = entries.map(([k, w]) => ({ term: normalizeTerm(k), weight: w }));
    const byTerm = new Map(terms.map((t) => [t.term, t.weight]));
    const alt = terms
        .sort((a, b) => b.term.length - a.term.length)
        .map((t) => t.term.split(/\s+/).map(escape).join("\\s+"))
        .join("|");
    const pre = prefix ? `${prefix}?` : "";
    return { re: new RegExp(`(?<![${letters}])${pre}(${alt})(?![${letters}])`, "g"), byTerm };
}

export class TextFilter {
    /** @param {object} lexicon محتوى data/lexicon.json */
    constructor(lexicon) {
        const { mask, explicit } = lexicon;
        this.reArabic = compileArabic(mask.ar);
        this.reArabicPhrases = compileArabicPhrases(mask.ar_phrases);
        this.reFranco = compileLatin(mask.franco, { leet: false });
        this.reEnglish = compileLatin(mask.en, { leet: true });
        // كلمات سليمة تبدأ بلفظ (مثل shitake): تُستثنى إذا كانت الكلمة كاملة منها
        this.enAllow = new Set((mask.en_allow ?? []).map((w) => w.toLowerCase()));
        // للكلمات المكتوبة حرفًا حرفًا: نطابق الكلمة كاملة
        this.spacedTerms = new Set(
            [...mask.ar, ...mask.en]
                .map((t) => t.replace(/\*$/, ""))
                .map((t) => deLeet(normalizeTerm(t)).replace(/\s+/g, ""))
                .filter((t) => t.length >= 3)
        );
        // الشتائم العامة: لا تُخفى إلا عند تشغيلها (وضع الطفل)
        this.insults = false;
        const ins = lexicon.insults;
        this.reInsultAr = ins?.ar_phrases?.length ? compileArabicPhrases(ins.ar_phrases) : null;
        this.reInsultEn = ins?.en?.length ? compileLatin(ins.en, { leet: true }) : null;
        this.explicitAr = compileWeighted(explicit.ar, AR_LETTER, AR_PREFIX);
        this.explicitEn = compileWeighted(explicit.en, "a-z");
    }

    /** تشغيل إخفاء الشتائم العامة (وضع الطفل). */
    setInsults(on) {
        this.insults = Boolean(on);
    }

    /**
     * يُرجع مواضع الألفاظ الفاحشة في النص الأصلي: [{ start, end, match }]
     * end غير شاملة. المواضع المتداخلة تُدمج.
     */
    findProfanity(text) {
        const norm = normalize(text);
        const ranges = [];
        const wordAt = (s, a, b) => {
            while (a > 0 && /[a-z]/.test(s[a - 1])) a--;
            while (b < s.length && /[a-z]/.test(s[b])) b++;
            return s.slice(a, b);
        };
        const collect = (re, haystack) => {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(haystack))) {
                if (!m[0]) { re.lastIndex++; continue; }
                if (this.enAllow.size && this.enAllow.has(wordAt(haystack, m.index, m.index + m[0].length))) continue;
                const s = norm.map[m.index];
                const e = norm.map[m.index + m[0].length - 1] + 1;
                ranges.push({ start: s, end: e });
            }
        };
        collect(this.reArabicPhrases, norm.text);
        collect(this.reArabic, norm.text);
        collect(this.reFranco, norm.text);
        collect(this.reEnglish, deLeet(norm.text)); // نفس الطول، فالخريطة صالحة
        if (this.insults) {
            if (this.reInsultAr) collect(this.reInsultAr, norm.text);
            if (this.reInsultEn) collect(this.reInsultEn, deLeet(norm.text));
        }

        for (const seg of collapseSpacedLetters(norm)) {
            const joined = deLeet(seg.text);
            for (const term of this.spacedTerms) {
                const idx = joined.indexOf(term);
                if (idx !== -1 && (joined.length - term.length) <= 2) {
                    ranges.push({ start: seg.map[0], end: seg.map[seg.map.length - 1] + 1 });
                    break;
                }
            }
        }
        return mergeRanges(ranges).map((r) => ({ ...r, match: text.slice(r.start, r.end) }));
    }

    /** يستبدل الألفاظ الفاحشة بنجوم، ويحافظ على المسافات وطول النص. */
    censor(text, maskChar = "*") {
        const ranges = this.findProfanity(text);
        if (!ranges.length) return text;
        // المواضع محسوبة بوحدات UTF-16، فنقسّم النص بها مباشرة
        let out = "";
        let cursor = 0;
        for (const r of ranges) {
            out += text.slice(cursor, r.start);
            out += text.slice(r.start, r.end).replace(/\S/g, maskChar);
            cursor = r.end;
        }
        out += text.slice(cursor);
        return out;
    }

    /**
     * يقيس مدى صراحة الفقرة جنسيًا.
     * يُرجع { score, distinct, terms } حيث score مجموع الأوزان لكل 100 كلمة.
     */
    explicitScore(text) {
        const norm = normalize(text).text;
        const words = norm.split(/\s+/).filter(Boolean).length || 1;
        const found = new Map();
        const counts = new Map();
        for (const { re, byTerm } of [this.explicitAr, this.explicitEn]) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(norm))) {
                const key = m[1].replace(/\s+/g, " ");
                // تكرار الكلمة نفسها لا يرفع الدرجة بلا حد (نص فقهي يكرر "الزنا" ليس قصة إباحية)
                const c = (counts.get(key) ?? 0) + 1;
                counts.set(key, c);
                if (c <= 2) found.set(key, (found.get(key) ?? 0) + (byTerm.get(key) ?? 1));
            }
        }
        // الألفاظ الفاحشة الصريحة ترفع الدرجة أيضًا
        const profane = this.findProfanity(text).length;
        let total = profane * 4;
        for (const v of found.values()) total += v;
        return {
            score: (total / words) * 100,
            total,
            distinct: found.size + (profane ? 1 : 0),
            terms: [...found.keys()],
        };
    }

    /**
     * هل الفقرة إباحية؟ strictness: "light" | "medium" | "strict"
     * نشترط مجموعًا أدنى وتنوعًا في الكلمات، حتى لا تُطوى فقرة طبية فيها كلمة واحدة.
     */
    isExplicit(text, strictness = "medium") {
        const t = { light: [12, 14, 3], medium: [8, 9, 2], strict: [5, 6, 2] }[strictness];
        const [minTotal, minDensity, minDistinct] = t;
        const r = this.explicitScore(text);
        return r.total >= minTotal && r.score >= minDensity && r.distinct >= minDistinct;
    }
}

function mergeRanges(ranges) {
    if (!ranges.length) return [];
    ranges.sort((a, b) => a.start - b.start);
    const out = [{ ...ranges[0] }];
    for (const r of ranges.slice(1)) {
        const last = out[out.length - 1];
        if (r.start <= last.end) last.end = Math.max(last.end, r.end);
        else out.push({ ...r });
    }
    return out;
}
