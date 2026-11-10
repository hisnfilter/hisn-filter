// الخلفية: الإعدادات، والقفل، وقواعد الشبكة، وتشغيل محرك الكشف.
import {
    api,
    loadSettings,
    saveSettings,
    publicSettings,
    hashPin,
    verifyPin,
    siteOf,
    extensionDefaults,
    onSettingsChanged,
} from "../shared/settings.js";
import { onlyStrengthens, validPatch, pinBackoff } from "./lock.js";
import { importSettings } from "@hisn/core";
import { MSG } from "../shared/messages.js";
import { applyNetworkRules, networkStatus } from "./dnr.js";

const UNLOCK_MINUTES = 5;
// يُعرّف وقت البناء: "chrome" أو "firefox"
// eslint-disable-next-line no-undef
const TARGET = typeof __TARGET__ !== "undefined" ? __TARGET__ : "chrome";

// ===== جلسة فتح القفل =====
async function unlockedUntil() {
    const s = await api.storage.session?.get?.("unlockedUntil");
    return s?.unlockedUntil ?? 0;
}
async function setUnlocked() {
    await api.storage.session?.set?.({ unlockedUntil: Date.now() + UNLOCK_MINUTES * 60_000 });
}
async function isUnlocked(settings) {
    if (!settings.pinHash) return true;
    return (await unlockedUntil()) > Date.now();
}
/**
 * يتحقق من الرمز، مع تأخير متصاعد بعد 3 أخطاء متتالية (30 ثانية ثم يتضاعف حتى 15 دقيقة).
 * يُرجع true، أو false، أو { wait: ثوانٍ } أثناء فترة الانتظار.
 */
async function checkPin(settings, pin) {
    if (await isUnlocked(settings)) return true;
    const st = (await api.storage.local.get(["pinFails", "pinWaitUntil"])) ?? {};
    const wait = (st.pinWaitUntil ?? 0) - Date.now();
    if (wait > 0) return { wait: Math.ceil(wait / 1000) };
    if (!pin) return false;
    if (await verifyPin(String(pin), settings)) {
        await api.storage.local.set({ pinFails: 0, pinWaitUntil: 0 });
        await setUnlocked();
        return true;
    }
    const fails = (st.pinFails ?? 0) + 1;
    await api.storage.local.set({ pinFails: fails, pinWaitUntil: Date.now() + pinBackoff(fails) });
    return false;
}
/** فحص واحد للرمز يُحسب مرة واحدة: { ok: true } أو رفض موحّد يذكر مدة الانتظار إن وُجدت. */
async function tryPin(settings, pin) {
    const r = await checkPin(settings, pin);
    if (r === true) return { ok: true };
    return r?.wait ? { ok: false, error: "wait", wait: r.wait } : { ok: false, error: "pin" };
}

const isSiteName = (v) => typeof v === "string" && v.length > 0 && v.length <= 253 && /^[a-z0-9.-]+$/.test(v);

// ===== محرك الكشف =====
async function ensureDetector() {
    if (TARGET !== "chrome" || !api.offscreen) return;
    try {
        if (await api.offscreen.hasDocument?.()) return;
        await api.offscreen.createDocument({
            url: "offscreen.html",
            reasons: ["DOM_PARSER", "WORKERS"],
            justification: "فحص الصور والفيديو على الجهاز لحجب المحتوى المخالف",
        });
    } catch (e) {
        // قد يكون أُنشئ للتو من استدعاء متزامن
        if (!String(e).includes("Only a single offscreen")) console.warn("Hisn offscreen", e);
    }
}

async function refresh() {
    const s = await loadSettings();
    await applyNetworkRules(s).catch((e) => console.error("Hisn DNR", e));
    if (s.enabled) await ensureDetector();
}

api.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
        await api.storage.local.set({ "hisn-settings": extensionDefaults("male") });
        api.tabs.create({ url: api.runtime.getURL("pages/onboarding.html") });
    }
    await refresh();
    api.contextMenus?.removeAll?.(() => {
        api.contextMenus.create({ id: "hisn-hide-image", title: "حصن: إخفاء هذه الصورة", contexts: ["image", "video"] });
    });
});
api.runtime.onStartup?.addListener(refresh);

api.contextMenus?.onClicked?.addListener((info, tab) => {
    if (info.menuItemId === "hisn-hide-image" && tab?.id != null) {
        api.tabs.sendMessage(tab.id, { type: "hisn:hide-src", src: info.srcUrl }, { frameId: info.frameId });
    }
});

// ===== الرسائل =====
const corsRules = new Map(); // "تبويب|موقع" ← رقم القاعدة
// إغلاق التبويب يزيل أذوناته
api.tabs.onRemoved?.addListener((tabId) => {
    const ids = [];
    for (const [k, id] of corsRules) if (k.startsWith(`${tabId}|`)) { ids.push(id); corsRules.delete(k); }
    if (ids.length) api.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }).catch(() => {});
});

const handlers = {
    /** ملف فيديو مباشر من موقع آخر: نضيف إذن CORS لردوده (الوسائط فقط) حتى يمكن تنظيف صوته. */
    /**
     * إذن CORS لملفات الصوت والفيديو من موقع آخر (لنقرأ صوتها ونزيل الموسيقى): لهذا التبويب فقط،
     * ولنوع «وسائط» فقط، ويُزال عند إغلاق التبويب.
     */
    async [MSG.MEDIA_CORS]({ url }, sender) {
        const tabId = sender?.tab?.id;
        let host;
        try {
            host = new URL(url).hostname;
        } catch {
            return { ok: false };
        }
        if (typeof tabId !== "number" || tabId < 0 || !host) return { ok: false };
        const key = `${tabId}|${host}`;
        if (corsRules.has(key)) return { ok: true };
        if (corsRules.size >= 300) return { ok: false };
        let id = 8000;
        const used = new Set(corsRules.values());
        while (used.has(id)) id++;
        corsRules.set(key, id);
        await api.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [id],
            addRules: [{
                id,
                priority: 1,
                action: {
                    type: "modifyHeaders",
                    responseHeaders: [{ header: "Access-Control-Allow-Origin", operation: "set", value: "*" }],
                },
                condition: { requestDomains: [host], resourceTypes: ["media"], tabIds: [tabId] },
            }],
        });
        return { ok: true };
    },

    /** حالة كل طبقة: ok | loading | partial | failed | off. «الحماية تعمل» لا تظهر إلا إذا عملت كلها. */
    async [MSG.GET_HEALTH]() {
        const s = await loadSettings();
        if (!s.enabled) return { overall: "off", layers: {} };
        let det = globalThis.__hisnDetectorHealth?.() ?? null;
        if (!det) {
            await ensureDetector();
            det = await Promise.race([
                api.runtime.sendMessage({ type: MSG.DETECTOR_HEALTH }).catch(() => null),
                new Promise((r) => setTimeout(() => r(null), 2500)),
            ]);
        }
        const model = (v) => (v === "ready" ? "ok" : v === "loading" ? "loading" : v === "idle" ? "ok" : "failed");
        const net = networkStatus.state === "unknown" ? "loading" : networkStatus.state;
        const layers = {
            sites: s.blockAdultSites || s.blockGambling || s.safeSearch ? net : "off",
            images: s.filterImages ? model(det?.images) : "off",
            video: s.filterVideos ? model(det?.images) : "off",
            audio: s.removeMusic ? model(det?.audio) : "off",
            text: s.filterText ? "ok" : "off",
        };
        const vals = Object.values(layers).filter((v) => v !== "off");
        const overall = vals.some((v) => v === "failed" || v === "partial") ? "partial" : vals.some((v) => v === "loading") ? "loading" : "ok";
        return { overall, layers, error: det?.error ?? "" };
    },

    async [MSG.GET_SETTINGS]() {
        const s = await loadSettings();
        return { ...publicSettings(s), unlocked: await isUnlocked(s) };
    },

    async [MSG.UPDATE_SETTINGS]({ patch, pin }) {
        // مفاتيح وقيم معروفة فقط (لا يُغيَّر الرمز ولا غيره من هنا)
        if (!validPatch(patch)) return { ok: false, error: "invalid" };
        const s = await loadSettings();
        if (!onlyStrengthens(patch, s)) { const auth = await tryPin(s, pin); if (!auth.ok) return auth; }
        const next = await saveSettings(patch);
        await refresh();
        return { ok: true, settings: publicSettings(next) };
    },

    /** إعدادات من جهاز آخر (رمز نصي أو QR). ما يقلل الحماية يحتاج رمز هذا الجهاز. */
    async [MSG.IMPORT_SETTINGS]({ code, pin }) {
        const imported = importSettings(code);
        if (!imported) return { ok: false, error: "code" };
        const s = await loadSettings();
        const patch = Object.fromEntries(Object.entries(imported).filter(([k, v]) => s[k] !== v));
        if (!onlyStrengthens(patch, s)) { const auth = await tryPin(s, pin); if (!auth.ok) return auth; }
        const next = await saveSettings({ ...patch, onboarded: true });
        await refresh();
        return { ok: true, changed: Object.keys(patch).length, settings: publicSettings(next) };
    },

    async [MSG.SET_PIN]({ pin, oldPin }) {
        const s = await loadSettings();
        { const auth = await tryPin(s, oldPin); if (!auth.ok) return auth; }
        if (!pin) {
            await saveSettings({ pinHash: null, pinSalt: null, lockEnabled: false });
            return { ok: true };
        }
        if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: "format" };
        const { hash, salt } = await hashPin(pin);
        await saveSettings({ pinHash: hash, pinSalt: salt, lockEnabled: true });
        return { ok: true };
    },

    async [MSG.CHECK_PIN]({ pin }) {
        const s = await loadSettings();
        return tryPin(s, pin);
    },

    /** إنهاء فترة الفتح المؤقت فورًا. */
    async [MSG.LOCK_NOW]() {
        await api.storage.session?.set?.({ unlockedUntil: 0 });
        return { ok: true };
    },

    async [MSG.UNLOCK_STATUS]() {
        const s = await loadSettings();
        return { locked: Boolean(s.pinHash), unlocked: await isUnlocked(s), until: s.pinHash ? await unlockedUntil() : 0 };
    },

    async [MSG.ALLOW_SITE]({ site, pin }) {
        const s = await loadSettings();
        if (!isSiteName(siteOf(site))) return { ok: false, error: "invalid" };
        { const auth = await tryPin(s, pin); if (!auth.ok) return auth; }
        const allowlist = [...new Set([...(s.allowlist ?? []), siteOf(site)])];
        await saveSettings({ allowlist });
        await refresh();
        return { ok: true };
    },

    async [MSG.HIDE_ACCOUNT]({ site, handle }) {
        if (!isSiteName(siteOf(site)) || typeof handle !== "string" || !handle.trim() || handle.length > 100) return { ok: false, error: "invalid" };
        const s = await loadSettings();
        const hiddenAccounts = [...(s.hiddenAccounts ?? []), { site: siteOf(site), handle }];
        await saveSettings({ hiddenAccounts });
        return { ok: true };
    },

    async [MSG.REPORT_VERDICT]({ key, verdict, pin }) {
        if (!/^[0-9a-f]{8,64}$/.test(key ?? "") || (verdict !== "safe" && verdict !== "unsafe")) return { ok: false, error: "invalid" };
        const s = await loadSettings();
        if (verdict === "safe") { const auth = await tryPin(s, pin); if (!auth.ok) return auth; }
        const imageVerdicts = { ...(s.imageVerdicts ?? {}), [key]: verdict };
        // نحتفظ بآخر 5000 تصحيح فقط
        const keys = Object.keys(imageVerdicts);
        for (const k of keys.slice(0, Math.max(0, keys.length - 5000))) delete imageVerdicts[k];
        await saveSettings({ imageVerdicts });
        return { ok: true };
    },
};

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const h = handlers[msg?.type];
    if (h) {
        h(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
        return true;
    }
    // رسائل الكشف: نتأكد أن المحرك يعمل، ولا نرد عليها هنا (يرد المحرك نفسه)
    if (msg?.type === MSG.DETECT_IMAGE || msg?.type === MSG.DETECT_FRAME || msg?.type === MSG.DETECT_AUDIO) {
        ensureDetector();
    }
    return false;
});

// التخزين للخلفية وصفحات الإضافة فقط: سكربتات الصفحات لا تقرأه (ومنه بصمة الرمز)
api.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch?.(() => {});

// كل تغيير في الإعدادات يُرسل لكل التبويبات (بلا بصمة الرمز)
onSettingsChanged(async (s) => {
    const settings = publicSettings(s);
    const tabs = await api.tabs.query({}).catch(() => []);
    for (const t of tabs) api.tabs.sendMessage(t.id, { type: MSG.SETTINGS_CHANGED, settings })?.catch?.(() => {});
});

refresh();
