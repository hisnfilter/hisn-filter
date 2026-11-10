// تطبيع النص العربي واللاتيني قبل المقارنة بالقاموس.
// كل دالة تُرجع النص المطبَّع مع خريطة تربط كل حرف فيه بموضعه في النص الأصلي،
// حتى نستطيع إخفاء الكلمة في مكانها الصحيح دون تخريب باقي النص.

// التشكيل، والشدة، والسكون، والتنوين، والألف الخنجرية، وعلامات قرآنية صغيرة.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/;
const TATWEEL = "ـ";
// محارف خفية تُستخدم للتحايل: مسافات صفرية، وعلامات اتجاه.
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿­]/;

const ARABIC_MAP = {
    "آ": "ا", // آ → ا
    "أ": "ا", // أ → ا
    "إ": "ا", // إ → ا
    "ٱ": "ا", // ٱ → ا
    "ى": "ي", // ى → ي
    "ة": "ه", // ة → ه
    "ؤ": "و", // ؤ → و
    "ئ": "ي", // ئ → ي
    "ک": "ك", // ک (فارسية) → ك
    "ی": "ي", // ی (فارسية) → ي
    "گ": "ق", // گ → ق (في العراق والخليج تُكتب بها القاف: گحبة = قحبة)
    "چ": "ج", // چ → ج
    "ڤ": "ف", // ڤ → ف
    "پ": "ب", // پ → ب
};

// الأرقام الهندية تُحوَّل لأرقام لاتينية حتى يعمل كشف التحايل بالأرقام.
const DIGIT_MAP = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

// أرقام ورموز تُكتب بدل الحروف اللاتينية (leetspeak).
const LEET_MAP = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
    "7": "t", "@": "a", "$": "s", "!": "i", "|": "i",
};

/**
 * يطبّع النص ويُرجع { text, map } حيث map[i] = موضع الحرف i في النص الأصلي.
 * - يحذف التشكيل والتطويل والمحارف الخفية.
 * - يوحّد أشكال الألف والياء والتاء المربوطة والهمزات.
 * - يحوّل الحروف اللاتينية لأحرف صغيرة والأرقام الهندية للاتينية.
 * - يختصر تكرار الحرف نفسه 3 مرات أو أكثر (كلمممة → كلمة).
 */
export function normalize(input) {
    const chars = [];
    const map = [];
    for (let i = 0; i < input.length; i++) {
        let ch = input[i];
        if (ch === TATWEEL || DIACRITICS.test(ch) || INVISIBLE.test(ch)) continue;
        ch = ARABIC_MAP[ch] ?? DIGIT_MAP[ch] ?? ch;
        chars.push(ch.toLowerCase());
        map.push(i);
    }
    // تكرار الحرف نفسه 3 مرات أو أكثر يُختصر لحرف واحد (كلمممة → كلمة، fuuuck → fuck).
    // التكرار مرتين يبقى كما هو، لأن كلمات سليمة كثيرة فيها حرفان متتاليان.
    const out = [];
    const outMap = [];
    for (let i = 0; i < chars.length; ) {
        let j = i;
        while (j < chars.length && chars[j] === chars[i]) j++;
        const run = j - i;
        const keep = run >= 3 ? 1 : run;
        for (let k = 0; k < keep; k++) {
            out.push(chars[i]);
            outMap.push(map[i + k]);
        }
        i = j;
    }
    return { text: out.join(""), map: outMap };
}

/** نسخة لاتينية تحوّل الأرقام والرموز إلى حروف، لكشف fvck و sh1t وما شابه. */
export function deLeet(text) {
    let r = "";
    for (const ch of text) r += LEET_MAP[ch] ?? ch;
    return r;
}

/** يطبّع كلمة واحدة من القاموس بنفس قواعد النص. */
export function normalizeTerm(term) {
    return normalize(term).text.trim();
}

const SEPARATORS = /[\s.\-_*+~|/\\·•،,؛:'"`^=()[\]{}<>]/;

/**
 * يكشف الكلمات المكتوبة حرفًا حرفًا مع فواصل للتحايل، مثل "ك.ل.م.ة" أو "f u c k".
 * يُرجع مقاطع { text, map } مضمومة الحروف ليُبحث فيها عن كلمات القاموس.
 * لا يضم إلا تسلسلات من 3 حروف مفردة أو أكثر، حتى لا يدمج كلمات عادية.
 */
export function collapseSpacedLetters(norm) {
    const { text, map } = norm;
    // نقسّم النص إلى رموز (tokens) بين الفواصل، مع موضع كل رمز
    const tokens = [];
    let start = -1;
    for (let i = 0; i <= text.length; i++) {
        const isSep = i === text.length || SEPARATORS.test(text[i]);
        if (!isSep && start === -1) start = i;
        if (isSep && start !== -1) {
            tokens.push({ start, end: i });
            start = -1;
        }
    }
    // نجمع الرموز المتتالية المكوّنة من حرف واحد
    const segments = [];
    let run = [];
    const flush = () => {
        if (run.length >= 3) {
            segments.push({
                text: run.map((t) => text[t.start]).join(""),
                map: run.map((t) => map[t.start]),
            });
        }
        run = [];
    };
    for (const t of tokens) {
        if (t.end - t.start === 1) run.push(t);
        else flush();
    }
    flush();
    return segments;
}
