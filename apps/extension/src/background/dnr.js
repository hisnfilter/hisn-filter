// قواعد الشبكة: حجب المواقع، والبحث الآمن، والوضع المقيّد في يوتيوب.
// كلها قواعد declarativeNetRequest يطبّقها المتصفح نفسه، فلا نرى أي طلب ولا نسجّله.
import { api } from "../shared/settings.js";

const CHUNK = 2000; // عدد النطاقات في القاعدة الواحدة

// نطاقات معرّفات القواعد، حتى نستبدل كل مجموعة دون المساس بغيرها
const ID = {
    ALLOW: 1, // 1..999: المواقع التي سمح بها المستخدم
    SAFE_SEARCH: 1000, // 1000..1099
    YT: 1100,
    ADULT_REDIRECT: 2000, // 2000..2999
    ADULT_BLOCK: 3000, // 3000..3999: حجب صور وفيديو المواقع الإباحية داخل المواقع الأخرى
    GAMBLING: 4000, // 4000..4999
    STREAMING: 5000, // 5000..5099: خدمات بث مشفّرة لا يمكن فحصها (نتفلكس وأخواتها)
};

const loadDomains = async (name) => {
    const res = await fetch(api.runtime.getURL(`rules/${name}-domains.json`));
    return (await res.json()).domains;
};

const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
};

function redirectRules(domains, baseId, reason, except = []) {
    const blocked = api.runtime.getURL("pages/blocked.html");
    return chunk(domains, CHUNK).map((requestDomains, i) => ({
        id: baseId + i,
        priority: 10,
        action: {
            type: "redirect",
            redirect: { regexSubstitution: `${blocked}?r=${reason}&u=\\0` },
        },
        condition: {
            regexFilter: "^https?://.*$",
            requestDomains,
            ...(except.length ? { excludedRequestDomains: except } : {}),
            resourceTypes: ["main_frame", "sub_frame"],
        },
    }));
}

function blockMediaRules(domains, baseId, except = []) {
    return chunk(domains, CHUNK).map((requestDomains, i) => ({
        id: baseId + i,
        priority: 10,
        action: { type: "block" },
        condition: {
            requestDomains,
            ...(except.length ? { excludedRequestDomains: except } : {}),
            resourceTypes: ["image", "media", "object", "xmlhttprequest", "script", "websocket"],
        },
    }));
}

function safeSearchRules() {
    const param = (key, value) => ({ addOrReplaceParams: [{ key, value }] });
    const redirect = (id, regexFilter, key, value) => ({
        id,
        priority: 5,
        action: { type: "redirect", redirect: { transform: { queryTransform: param(key, value) } } },
        condition: { regexFilter, resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"] },
    });
    return [
        // قوقل: البحث والصور والفيديو
        redirect(ID.SAFE_SEARCH + 0, "^https://(www\\.)?google\\.[a-z.]+/(search|images)", "safe", "active"),
        // بنج
        redirect(ID.SAFE_SEARCH + 1, "^https://(www\\.)?bing\\.com/(search|images|videos)", "adlt", "strict"),
        // DuckDuckGo
        redirect(ID.SAFE_SEARCH + 2, "^https://(www\\.|html\\.)?duckduckgo\\.com/", "kp", "1"),
        // ياندكس
        redirect(ID.SAFE_SEARCH + 3, "^https://(www\\.)?yandex\\.[a-z.]+/(search|images)", "family", "yes"),
    ];
}

function youtubeRule(strict = false) {
    // ترويسة رسمية من يوتيوب لفرض الوضع المقيّد
    return {
        id: ID.YT,
        priority: 5,
        action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "YouTube-Restrict", operation: "set", value: strict ? "Strict" : "Moderate" }],
        },
        condition: {
            requestDomains: ["youtube.com", "m.youtube.com", "youtubei.googleapis.com", "youtube-nocookie.com"],
            resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"],
        },
    };
}


let cache = null;

/** يعيد بناء القواعد الديناميكية كاملة حسب الإعدادات. */
/** بديل التحويل لصفحة الحجب: حجب مباشر (لمتصفحات لا تدعم regexSubstitution، مثل بعض إصدارات Safari). */
function blockPageRules(domains, baseId, except = []) {
    return chunk(domains, CHUNK).map((requestDomains, i) => ({
        id: baseId + i,
        priority: 10,
        action: { type: "block" },
        condition: { requestDomains, ...(except.length ? { excludedRequestDomains: except } : {}), resourceTypes: ["main_frame", "sub_frame"] },
    }));
}

export async function applyNetworkRules(settings) {
    cache ??= { adult: await loadDomains("adult"), gambling: await loadDomains("gambling"), streaming: await loadDomains("streaming") };
    const on = settings.enabled;
    // مجموعات مستقلة: إذا رفض المتصفح نوعًا من القواعد لا تضيع البقية، ولبعضها بديل أبسط
    const groups = [];
    // «هذا الموقع سليم» يستثنيه من حجب المواقع فقط؛ البحث الآمن والوضع المقيّد وفحص المحتوى تبقى تعمل فيه
    const except = (settings.allowlist ?? []).slice(0, 900);
    if (on && settings.blockAdultSites) {
        groups.push({
            rules: redirectRules(cache.adult, ID.ADULT_REDIRECT, "adult", except),
            fallback: () => blockPageRules(cache.adult, ID.ADULT_REDIRECT, except),
        });
        groups.push({ rules: blockMediaRules(cache.adult, ID.ADULT_BLOCK, except) });
    }
    if (on && settings.blockGambling) {
        groups.push({
            rules: redirectRules(cache.gambling, ID.GAMBLING, "gambling", except),
            fallback: () => blockPageRules(cache.gambling, ID.GAMBLING, except),
        });
    }
    // بث مشفّر (DRM): الفيديو لا يُقرأ فلا يُفحص — يُحجب كاملًا بدل فتح باب لمحتوى غير مفحوص
    if (on && settings.blockUnfilterableStreaming !== false) {
        groups.push({
            rules: redirectRules(cache.streaming, ID.STREAMING, "streaming", except),
            fallback: () => blockPageRules(cache.streaming, ID.STREAMING, except),
        });
    }
    if (on && settings.safeSearch) groups.push({ rules: safeSearchRules() });
    if (on && settings.youtubeRestricted && settings.level !== "light") groups.push({ rules: [youtubeRule(Boolean(settings.childMode && settings.youtubeStrict))] });

    const dnr = api.declarativeNetRequest;
    // كل محاولة ذرّية (حذف القديم وإضافة الجديد معًا): إن فشلت تبقى آخر قواعد صالحة كما هي.
    // 1) كل المجموعات  2) البدائل الأبسط حيث وُجدت  3) إسقاط المجموعات المرفوضة واحدة واحدة
    const attempts = [
        { groups: groups.map((g) => g.rules), partial: false },
        { groups: groups.map((g) => g.fallback?.() ?? g.rules), partial: true },
    ];
    for (const a of attempts) {
        if (await replaceAll(dnr, a.groups.flat())) return setStatus(a.partial ? "partial" : "ok", groups.length, groups.length);
    }
    const kept = [];
    for (const g of groups) {
        const candidate = [...kept, g.fallback?.() ?? g.rules];
        if (await replaceAll(dnr, candidate.flat())) kept.push(candidate.at(-1));
        else console.warn("Hisn: مجموعة قواعد مرفوضة", g.rules[0]?.action?.type);
    }
    // لم تُقبل أي مجموعة: لا نحذف القواعد الموجودة (آخر حالة صالحة)
    return setStatus(kept.length === groups.length ? "partial" : kept.length ? "partial" : "failed", kept.length, groups.length);
}

async function replaceAll(dnr, rules) {
    try {
        const existing = await dnr.getDynamicRules();
        await dnr.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
        return true;
    } catch {
        return false;
    }
}

/** آخر نتيجة لتطبيق قواعد الشبكة (لمؤشر الصحة). */
export const networkStatus = { state: "unknown", applied: 0, wanted: 0, at: 0 };
function setStatus(state, applied, wanted) {
    Object.assign(networkStatus, { state, applied, wanted, at: Date.now() });
    return applied;
}

export const _test = { blockPageRules, redirectRules, blockMediaRules, safeSearchRules, youtubeRule, chunk };
