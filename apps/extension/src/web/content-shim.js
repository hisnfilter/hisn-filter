// جسر سكربت الصفحة داخل «المتصفح المحمي» في تطبيق الآيفون: بدل واجهة الإضافة (chrome.*)
// نرسل للتطبيق عبر WebKit، والتطبيق يرد (WKScriptMessageHandlerWithReply). يُحقن في عالم معزول عن الموقع.
import { defaultSettings } from "@hisn/core";

const handler = globalThis.webkit?.messageHandlers?.hisn;
const listeners = [];

/** إعدادات الإضافة الكاملة: ما يرسله التطبيق فوق القيم الافتراضية. */
function full(s) {
    return {
        ...defaultSettings(s?.viewer === "female" ? "female" : "male"),
        enabled: true, onboarded: true, filterImages: true, filterVideos: true, filterText: true, foldExplicitText: true,
        blockAdultSites: true, safeSearch: true, autoSkipShortVideos: true,
        // إزالة الموسيقى المباشرة تحتاج محرك الصوت في إطار من التطبيق، ولم تُدعم بعد في المتصفح المحمي
        removeMusic: false,
        allowlist: [], disabledSites: [], hiddenAccounts: [], imageVerdicts: {}, pausedSites: {},
        ...s,
    };
}

globalThis.chrome = {
    runtime: {
        id: "hisn-app",
        getURL: (p) => `hisn://app/${p}`,
        async sendMessage(m) {
            if (!handler) return null;
            try {
                const r = await handler.postMessage(m);
                const v = typeof r === "string" ? JSON.parse(r) : r ?? null;
                if (m?.type === "hisn:get-settings") return full(v ?? {});
                return v;
            } catch {
                return null;
            }
        },
        onMessage: { addListener: (fn) => listeners.push(fn) },
    },
};

// التطبيق يرسل تحديث الإعدادات بهذه الدالة
globalThis.__hisnPush = (json) => {
    let m;
    try { m = JSON.parse(json); } catch { return; }
    if (m?.type === "hisn:settings-changed") m.settings = full(m.settings);
    for (const f of listeners) f(m, {}, () => {});
};
