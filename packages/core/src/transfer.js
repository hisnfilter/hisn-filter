// نقل الإعدادات بين الأجهزة بلا خادم: رمز نصي قصير (أو QR فيه رابط يفتح التطبيق مباشرة).
// يحمل الإعدادات المهمة فقط. رمز القفل لا يُنقل (ولا بصمته: رمز من 4 أرقام يُكسر من بصمته بسهولة،
// والطفل قد يرى رمز QR)، بل يُطلب وضعه على الجهاز الجديد بعد النقل.
import { LEVELS } from "./policy.js";
import { CHILD_AGES } from "./topics.js";

const PREFIX = "HISN1.";
/** رابط يفتح تطبيق حصن على الجوال عند مسح الرمز بالكاميرا. */
export const TRANSFER_LINK = "hisnfilter://import#";

const BOOL = [
    "childMode", "blockScaryTopics", "youtubeStrict", "youtubeRestricted", "safeSearch", "blockAdultSites", "blockGambling",
    "filterImages", "filterVideos", "filterText", "foldExplicitText", "removeMusic", "muteSingerAfterMusicRemoval",
    "muteSpokenProfanity", "blurMen", "blurAdultWomen", "blurCoveredWomen", "blurCartoonWomen", "blurGirls", "partialBlur",
    "autoSkipShortVideos", "allowNasheedsWithoutInstruments", "maskInsults",
];
const CHOICES = { viewer: ["male", "female"], level: LEVELS, childAge: CHILD_AGES };

/** يأخذ القيم الصالحة فقط (لا يُقبل من الرمز أي مفتاح آخر). */
function pick(o) {
    const out = {};
    for (const k of BOOL) if (typeof o?.[k] === "boolean") out[k] = o[k];
    for (const [k, ok] of Object.entries(CHOICES)) if (ok.includes(o?.[k])) out[k] = o[k];
    return out;
}

/**
 * رمز النقل لإعدادات جهاز، مضغوط ليصغر رمز QR:
 * HISN1.<المستخدم><المستوى><العمر>.<أي الخيارات موجود>.<قيمها>
 */
export function exportSettings(settings) {
    const o = pick(settings);
    const idx = (k) => (k in o ? CHOICES[k].indexOf(o[k]) : 9);
    let has = 0n, on = 0n;
    BOOL.forEach((k, i) => {
        if (k in o) { has |= 1n << BigInt(i); if (o[k]) on |= 1n << BigInt(i); }
    });
    return PREFIX + [`${idx("viewer")}${idx("level")}${idx("childAge")}`, has.toString(36), on.toString(36)].join(".");
}

/** الرابط الذي يُوضع في QR. */
export function transferLink(settings) {
    return TRANSFER_LINK + exportSettings(settings);
}

/** يقرأ رمزًا أو رابطًا (منسوخًا أو من QR). يُرجع الإعدادات، أو null إن لم يكن رمزًا صالحًا. */
export function importSettings(text) {
    const i = (text ?? "").indexOf(PREFIX);
    if (i < 0) return null;
    const m = text.slice(i + PREFIX.length).match(/^(\d{3})\.([0-9a-z]+)\.([0-9a-z]+)/);
    if (!m) return null;
    const raw = {};
    ["viewer", "level", "childAge"].forEach((k, j) => { raw[k] = CHOICES[k][Number(m[1][j])]; });
    const big36 = (t) => [...t].reduce((acc, c) => acc * 36n + BigInt(parseInt(c, 36)), 0n);
    const has = big36(m[2]), on = big36(m[3]);
    BOOL.forEach((k, j) => { if ((has >> BigInt(j)) & 1n) raw[k] = Boolean((on >> BigInt(j)) & 1n); });
    const out = pick(raw);
    return Object.keys(out).length ? out : null;
}
