// موضوعات غير مناسبة للأطفال حتى لو خلت من العري: السحر والشعوذة والشرك، والجن والأرواح،
// والرعب والتخويف والهالوين، وألعاب الرعب المشهورة. نكشفها من العناوين والأوصاف (عربي وإنجليزي).
import { normalize } from "./normalize.js";
import LEX from "../data/topics.json" with { type: "json" };

const n = (s) => normalize(s).text;

// كلمات عربية تُطابق كلمة كاملة (مع السوابق: و، ف، ب، ل، ك، ثم ال أو لل)، وعبارات تُطابق كما هي
function compile(lex) {
    return {
        arWords: (lex.arWords ?? []).map(n),
        arPhrases: (lex.arPhrases ?? []).map(n),
        // إنجليزي: حدود كلمة (و«18+» تنتهي برمز فلا حد بعدها)
        // كلمات مميزة تُطابق حتى داخل كلمة أخرى (وسم مثل @spirithalloween)
        enAny: lex.enAny?.length ? new RegExp(`(${lex.enAny.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i") : null,
        en: lex.en?.length ? new RegExp(`(?<![a-z0-9])(${lex.en.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]*")).join("|")})(?![a-z0-9])`, "i") : null,
    };
}
const SCARY = compile(LEX);
const SUGGESTIVE = compile(LEX.suggestive ?? {});
const EXPLICIT = compile(LEX.explicit ?? {});
const KIDS = compile(LEX.kids ?? {});
// سياق ديني محمود (سورة الجن، الرقية، الأذكار) لا يُحجب، إلا إن كان معه رعب صريح
const RELIGIOUS = LEX.religious.map(n);
const STRONG = LEX.strong.map(n);

function arabicTokens(text) {
    return text.split(/[^ء-ي]+/).filter(Boolean);
}

/** صيغ الكلمة بعد حذف السوابق المحتملة (و، ف، ب، ل، ك — حتى حرفين — ثم ال أو لل). */
function variants(tok) {
    const out = [tok];
    for (let i = 0; i <= 2; i++) {
        if (i > 0 && !"وفبلك".includes(tok[i - 1])) break;
        const rest = tok.slice(i);
        if (i > 0) out.push(rest);
        for (const al of ["ال", "لل"]) if (rest.startsWith(al)) out.push(rest.slice(al.length));
    }
    return out.filter((v) => v.length >= 2);
}

function match(m, t, toks, bare) {
    const terms = [];
    for (const w of m.arWords) if (toks.includes(w) || bare.has(w)) terms.push(w);
    for (const p of m.arPhrases) if (t.includes(p)) terms.push(p);
    const en = (m.en ? t.match(m.en) : null) ?? (m.enAny ? t.match(m.enAny) : null);
    if (en) terms.push(en[1]);
    return { terms, en };
}

/**
 * @param {string} text عنوان أو وصف
 * @returns {{ hit: boolean, terms: string[] }}
 */
export function scaryTopic(text) {
    if (!text) return { hit: false, terms: [] };
    const t = n(text);
    const toks = arabicTokens(t);
    const bare = new Set(toks.flatMap(variants));
    const { terms, en } = match(SCARY, t, toks, bare);
    if (!terms.length) return { hit: false, terms };
    const religious = RELIGIOUS.some((w) => toks.includes(w) || bare.has(w));
    if (religious && !terms.some((x) => STRONG.includes(x)) && !en) return { hit: false, terms: [] };
    return { hit: true, terms: [...new Set(terms)] };
}

/** عنوان إيحائي (بكيني، ملابس داخلية، try-on haul…). */
export function suggestiveTopic(text) {
    if (!text) return { hit: false, terms: [] };
    const t = n(text);
    const toks = arabicTokens(t);
    const { terms } = match(SUGGESTIVE, t, toks, new Set(toks.flatMap(variants)));
    return { hit: terms.length > 0, terms: [...new Set(terms)] };
}

/** عنوان لا يناسب الصغار (كرتون للكبار، تحدّيات مؤذية، رعب الألعاب، تدخين…): يُحجب في وضع الطفل دون 13. */
export function kidsTopic(text) {
    if (!text) return { hit: false, terms: [] };
    const t = n(text);
    const toks = arabicTokens(t);
    const bare = new Set(toks.flatMap(variants));
    // الكلمة العربية: الكلمة نفسها أو بدايتها (مرعب ← مرعبة) بعد حذف السوابق، لا داخل كلمة أخرى (جن ≠ سجن)
    const terms = [];
    for (const w of KIDS.arWords) if ([...bare].some((v) => v === w || (w.length >= 3 && v.startsWith(w)))) terms.push(w);
    for (const p of KIDS.arPhrases) if (t.includes(p)) terms.push(p);
    let en = null;
    if (KIDS.en) { const mm = t.match(KIDS.en); if (mm) { terms.push(mm[1]); en = mm[1]; } }
    if (!terms.length) return { hit: false, terms };
    // سياق ديني (سورة الجن، الرقية، قصص الأنبياء): لا يُحجب بكلمة عربية وحدها
    const religious = RELIGIOUS.some((w) => toks.includes(w) || bare.has(w));
    if (religious && !en) return { hit: false, terms: [] };
    return { hit: true, terms: [...new Set(terms)] };
}

/** كلمات أضافها ولي الأمر (قائمة «كلمات محجوبة»): أي عنوان فيه واحدة منها (كلمة عربية بسوابقها، أو عبارة، أو كلمة إنجليزية) يُحجب. */
const customCache = new Map();
export function customTopic(text, words) {
    if (!text || !Array.isArray(words) || !words.length) return { hit: false, terms: [] };
    const key = words.join("\u0001");
    let m = customCache.get(key);
    if (!m) {
        const ar = words.map(n).filter((w) => /[ء-ي]/.test(w));
        const en = words.map((w) => w.trim().toLowerCase()).filter((w) => w && !/[ء-ي]/.test(w));
        m = compile({ arWords: ar.filter((w) => !w.includes(" ")), arPhrases: ar.filter((w) => w.includes(" ")), en });
        customCache.clear();
        customCache.set(key, m);
    }
    const t = n(text);
    const toks = arabicTokens(t);
    const bare = new Set(toks.flatMap(variants));
    const terms = [];
    // كلمة عربية: تطابق بداية الكلمة (مرعب ← مرعبة، المرعبين) بعد حذف السوابق؛ العبارة: احتواء؛ الإنجليزية: حدود كلمة
    for (const w of m.arWords) if ([...bare].some((v) => v === w || (w.length >= 3 && v.startsWith(w)))) terms.push(w);
    for (const p of m.arPhrases) if (t.includes(p)) terms.push(p);
    if (m.en) { const mm = t.match(m.en); if (mm) terms.push(mm[1]); }
    return { hit: terms.length > 0, terms: [...new Set(terms)] };
}

/** عنوان صريح (sex، إباحي، 18+…): يُغطّى ما يرتبط به من صور لكل المستخدمين. */
export function explicitTopic(text) {
    if (!text) return { hit: false, terms: [] };
    const t = n(text);
    const toks = arabicTokens(t);
    const { terms } = match(EXPLICIT, t, toks, new Set(toks.flatMap(variants)));
    return { hit: terms.length > 0, terms: [...new Set(terms)] };
}

/** الأعمار في وضع الطفل (الأصغر أشد). */
export const CHILD_AGES = ["under9", "9to12", "13to15"];

/**
 * إعدادات «وضع الطفل»: زر واحد يشغّل كل الحمايات المناسبة لعمره.
 * يُطبَّق فوق الإعدادات الحالية (لا يغيّر جنس المستخدم).
 */
export function childPreset(age = "9to12") {
    const young = age !== "13to15";
    return {
        childMode: true,
        childAge: CHILD_AGES.includes(age) ? age : "9to12",
        level: "medium",
        blockScaryTopics: true,
        hideSuggestive: true,
        maskInsults: true,
        filterImages: true,
        filterVideos: true,
        filterText: true,
        foldExplicitText: true,
        blockAdultSites: true,
        blockGambling: true,
        safeSearch: true,
        youtubeRestricted: true,
        youtubeStrict: young, // الوضع المقيّد الشديد لمن دون 13
        removeFlaggedCards: true, // بطاقة صورتها المصغّرة مخالفة تُحذف كلها (لا تُغبَّش فقط)
        hideShortsAndComments: young, // دون 13: لا Shorts ولا تعليقات ولا تشغيل تلقائي في يوتيوب
        autoSkipShortVideos: true,
        removeMusic: true,
        muteSingerAfterMusicRemoval: true,
        muteSpokenProfanity: true,
        blurCartoonWomen: true,
    };
}

// ===== تلميح «أغنية» من عنوان المقطع وقناته وكلماته المفتاحية (يوتيوب حيث لا يمكن سماع الصوت) =====
const SONG_EN = /\b(official (music |lyric )?video|official audio|lyrics?|lyric video|music video|song|songs|remix|mashup|karaoke|instrumental|cover song|acoustic cover|feat\.?|ft\.|prod\.|mv|album|single|dj|rap|hip ?hop|trap|r&b|music|concert|live performance|visualizer|slowed( \+ )?reverb|8d audio|bass boosted|nightcore)\b/i;
const SONG_AR = /أغنية|اغنية|أغاني|اغاني|كليب|ريمكس|غناء|مغني|مغنية|مطرب|مطربة|طرب|موسيقى|موسيقي|كلمات الأغنية|حفلة غنائية|كونسرت|ديجي|راب|شيلة|شيلات|مهرجان|مهرجانات|دبكة|دي جي/;
// ما لا يُعدّ أغنية وإن حوى الكلمات أعلاه: إنشاد وقرآن وأذان ونقد الأغاني
const SONG_EXCLUDE = /نشيد|أنشودة|انشودة|أناشيد|اناشيد|قرآن|قران|تلاوة|سورة|أذان|اذان|رقية|محاضرة|خطبة|حكم الأغاني|حكم الموسيقى|nasheed|anasheed|quran|qur'an|recitation|surah|adhan|ruqyah|lecture|khutbah|no music|without music|music[- ]free|vocals only|a ?cappella/i;
const SONG_CHANNEL = /\b(music|records|vevo|official|entertainment|productions|beats|sound|audio|fm|tv)\b|موسيقى|للإنتاج|ميوزك|ريكوردز|تي في/i;

/**
 * هل يبدو هذا المقطع أغنية من بياناته (عنوان، قناة، كلمات مفتاحية)؟
 * قوي: العنوان أو الكلمات المفتاحية تدل على أغنية. ضعيف: اسم القناة فقط (لا يكفي وحده).
 * @returns {{ hit: boolean, why: string }}
 */
export function songHint({ title = "", author = "", keywords = [] } = {}) {
    const t = String(title || "");
    const kw = (Array.isArray(keywords) ? keywords : []).join(" | ");
    const all = t + " | " + kw + " | " + String(author || "");
    if (SONG_EXCLUDE.test(all)) return { hit: false, why: "excluded" };
    if (SONG_EN.test(t) || SONG_AR.test(t)) return { hit: true, why: "title" };
    const kwHits = (kw.match(SONG_EN) || []).length + (kw.match(SONG_AR) || []).length;
    if (kwHits >= 2) return { hit: true, why: "keywords" };
    if (kwHits >= 1 && SONG_CHANNEL.test(String(author || ""))) return { hit: true, why: "keywords+channel" };
    return { hit: false, why: "" };
}
