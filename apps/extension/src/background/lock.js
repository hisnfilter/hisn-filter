// القفل: ما يُقبل من تغييرات، ومتى يحتاج التغيير رمز القفل (ما يقلل الحماية فقط).
// كل مفتاح له نوع وقيم مقبولة؛ ما سوى ذلك يُرفض كاملًا (لا حفظ جزئي).

import { effectiveSettings } from "@hisn/core";

const LEVELS = ["light", "medium", "strict"]; // الأعلى أشد
const AGES = ["under9", "9to12", "13to15"]; // الأصغر أشد

/** خيارات حماية: تشغيلها يشدد. */
const PROTECTIVE = new Set([
    "enabled", "filterImages", "filterVideos", "filterText", "foldExplicitText", "blockAdultSites", "blockGambling",
    "safeSearch", "youtubeRestricted", "autoSkipShortVideos", "blurMen", "blurAdultWomen", "blurCoveredWomen",
    "blurCartoonWomen", "blurGirls", "removeMusic", "muteSpokenProfanity", "muteSingerAfterMusicRemoval",
    "childMode", "blockScaryTopics", "youtubeStrict", "maskInsults", "hideSuggestive", "muteSongClips", "blockUnfilterableStreaming", "hideAds", "hideSuggested", "removeFlaggedCards", "hideShortsAndComments", "allowedChannelsOnly",
]);
/** خيارات تشغيلها يخفف (يُظهر أكثر). */
const RELAXING = new Set(["allowNasheedsWithoutInstruments", "partialBlur", "fastReveal"]);

const isSite = (v) => typeof v === "string" && v.length <= 253 && /^[a-z0-9.-]+$/.test(v);
const isAccount = (a) => a && typeof a === "object" && isSite(a.site) && typeof a.handle === "string" && a.handle.length <= 100;
const isVerdicts = (o) => o && typeof o === "object" && !Array.isArray(o) &&
    Object.entries(o).length <= 6000 && Object.entries(o).every(([k, v]) => /^[0-9a-f]{8,64}$/.test(k) && (v === "safe" || v === "unsafe"));

/** نوع كل مفتاح يمكن تغييره من الصفحات. */
const SCHEMA = {
    ...Object.fromEntries([...PROTECTIVE, ...RELAXING, "onboarded"].map((k) => [k, (v) => typeof v === "boolean"])),
    level: (v) => LEVELS.includes(v),
    viewer: (v) => v === "male" || v === "female",
    childAge: (v) => AGES.includes(v),
    childSex: (v) => v === "boy" || v === "girl",
    blurStyle: (v) => ["blur", "opaque", "gray"].includes(v),
    allowlist: (v) => Array.isArray(v) && v.length <= 900 && v.every(isSite),
    disabledSites: (v) => Array.isArray(v) && v.length <= 900 && v.every(isSite),
    hiddenAccounts: (v) => Array.isArray(v) && v.length <= 2000 && v.every(isAccount),
    blockedWords: (v) => Array.isArray(v) && v.length <= 500 && v.every((w) => typeof w === "string" && w.trim().length >= 2 && w.length <= 60),
    allowedChannels: (v) => Array.isArray(v) && v.length <= 300 && v.every((c) => c && typeof c === "object" && typeof (c.name ?? "") === "string" && typeof (c.handle ?? "") === "string" && (c.name || c.handle) && (c.name ?? "").length <= 80 && (c.handle ?? "").length <= 80),
    imageVerdicts: isVerdicts,
    // إيقاف مؤقت لموقع: { موقع: وقت العودة } لمدة أقصاها يوم
    pausedSites: (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length <= 200 &&
        Object.entries(v).every(([k, t]) => isSite(k) && Number.isFinite(t) && t <= Date.now() + 86_400_000),
};

/** هل كل المفاتيح معروفة وقيمها صالحة؟ */
export function validPatch(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
    return Object.entries(patch).every(([k, v]) => SCHEMA[k]?.(v) === true);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const accountKey = (a) => `${a.site}|${a.handle.toLowerCase().replace(/^@/, "")}`;

/** تغييرات تزيد الحماية أو لا تغيّرها: مسموحة بلا رمز. أي قيمة غير صالحة ← لا. */
export function onlyStrengthens(patch, current) {
    if (!validPatch(patch)) return false;
    if (!keysStrengthen(patch, current)) return false;
    // المفاتيح وحدها لا تكفي: وضع الطفل مثلًا «حماية» لكنه يلغي تغطية النساء للرجل.
    // نقارن السياسة الفعلية قبل وبعد: أي حماية كانت مفعّلة يجب أن تبقى مفعّلة.
    const before = effectiveSettings({ ...current }), after = effectiveSettings({ ...current, ...patch });
    for (const k of PROTECTIVE) if (before[k] === true && after[k] !== true) return false;
    for (const k of RELAXING) if (before[k] === false && after[k] === true) return false;
    return true;
}

function keysStrengthen(patch, current) {
    return Object.entries(patch).every(([k, v]) => {
        const cur = current[k];
        if (same(v, cur)) return true;
        if (PROTECTIVE.has(k)) return v === true;
        if (RELAXING.has(k)) return v === false;
        if (k === "onboarded") return v === true;
        if (k === "level") return LEVELS.indexOf(v) >= LEVELS.indexOf(cur ?? "medium");
        if (k === "childAge") return AGES.indexOf(v) <= AGES.indexOf(AGES.includes(cur) ? cur : "13to15");
        if (k === "viewer") return v === "male"; // المستخدم رجل يضبّب أكثر
        if (k === "childSex") return v === "boy"; // الولد في الصارم تُغطّى عنه النساء
        if (k === "blurStyle") return v === "opaque";
        // القوائم: الاستثناءات تنقص فقط، والحسابات المخفية تزيد فقط (بالمحتوى لا بالعدد)
        if (k === "allowlist" || k === "disabledSites") return v.every((x) => (cur ?? []).includes(x));
        if (k === "blockedWords") return (cur ?? []).every((w) => v.includes(w)); // تزيد فقط بلا رمز
        // القنوات المسموحة: الحذف يضيّق فلا رمز؛ الإضافة توسّع فتطلبه
        if (k === "allowedChannels") { const now = new Set((cur ?? []).map((c) => `${c.name}|${c.handle}`)); return v.every((c) => now.has(`${c.name}|${c.handle}`)); }
        if (k === "hiddenAccounts") {
            const now = new Set(v.map(accountKey));
            return (cur ?? []).every((a) => now.has(accountKey(a)));
        }
        if (k === "pausedSites") {
            // إنهاء إيقاف أو تقصيره يشدد؛ إضافة إيقاف أو تمديده يخفف
            const now = Date.now();
            const old = cur ?? {};
            return Object.entries(v).every(([site, t]) => t <= now || t <= (old[site] ?? 0));
        }
        if (k === "imageVerdicts") {
            const old = cur ?? {};
            // «غير آمن» لا يُحذف ولا يُغيَّر، وما يُضاف أو يتغير يجب أن يكون «غير آمن»
            const keepsUnsafe = Object.entries(old).every(([key, x]) => x !== "unsafe" || v[key] === "unsafe");
            const addsOnlyUnsafe = Object.entries(v).every(([key, x]) => old[key] === x || x === "unsafe");
            return keepsUnsafe && addsOnlyUnsafe;
        }
        return false;
    });
}

// ===== محاولات الرمز: تأخير متصاعد بعد 3 أخطاء =====
export const PIN_FREE_TRIES = 3;
/** مدة الانتظار (ملي ثانية) بعد عدد معيّن من الأخطاء المتتالية: 30 ثانية ثم تتضاعف حتى 15 دقيقة. */
export function pinBackoff(fails) {
    if (fails < PIN_FREE_TRIES) return 0;
    return Math.min(15 * 60_000, 30_000 * 2 ** (fails - PIN_FREE_TRIES));
}
