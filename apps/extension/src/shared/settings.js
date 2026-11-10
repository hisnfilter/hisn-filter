// الإعدادات: تُحفظ على الجهاز فقط (storage.local)، ولا تُزامن مع أي حساب.
import { defaultSettings } from "@hisn/core";

export const STORAGE_KEY = "hisn-settings";

// نفضّل chrome لأن Firefox يدعمه أيضًا، وواجهته موحدة بين المتصفحين.
export const api = globalThis.chrome ?? globalThis.browser;

/** الإعدادات الكاملة للإضافة: إعدادات السياسة + إعدادات الإضافة نفسها. */
export function extensionDefaults(viewer = "male") {
    return {
        ...defaultSettings(viewer),
        onboarded: false,
        enabled: true,
        filterImages: true,
        filterVideos: true,
        filterText: true,
        foldExplicitText: true,
        blockAdultSites: true,
        safeSearch: true,
        autoSkipShortVideos: true,
        protectX: true,
        protectReddit: true,
        redditAllowed: [],
        allowlist: [], // مواقع رفع عنها المستخدم الحجب ("هذا الموقع سليم")
        disabledSites: [], // مواقع أوقف فيها الفلترة كاملة
        pausedSites: {}, // إيقاف مؤقت: { موقع: وقت العودة }
        hiddenAccounts: [], // { site, handle }
        imageVerdicts: {}, // تصحيحات المستخدم: { [hash]: "safe" | "unsafe" }
        pinHash: null,
        pinSalt: null,
        version: 1,
    };
}

export async function loadSettings() {
    const stored = (await api.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    const base = extensionDefaults(stored?.viewer ?? "male");
    return { ...base, ...(stored ?? {}) };
}

// الحفظ واحدًا بعد واحد: حتى لا يكتب تعديلان متزامنان أحدهما فوق الآخر
let saving = Promise.resolve();
export function saveSettings(patch) {
    const run = saving.then(async () => {
        const current = await loadSettings();
        const next = { ...current, ...patch };
        await api.storage.local.set({ [STORAGE_KEY]: next });
        return next;
    });
    saving = run.catch(() => {});
    return run;
}

/** للخلفية فقط: الصفحات تتلقى الإعدادات برسالة (SETTINGS_CHANGED) لا من التخزين مباشرة. */
export function onSettingsChanged(cb) {
    api.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[STORAGE_KEY]) cb(changes[STORAGE_KEY].newValue);
    });
}

/** الإعدادات التي يمكن عرضها في الصفحات: بدون بصمة الرمز. */
export function publicSettings(s) {
    const { pinHash, pinSalt, ...rest } = s;
    return { ...rest, hasPin: Boolean(pinHash) };
}

// ===== رمز القفل =====
// يُحفظ كبصمة PBKDF2 مع ملح عشوائي، ولا يُحفظ الرمز نفسه أبدًا.

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

export async function hashPin(pin, saltHex) {
    const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: 150000 },
        key,
        256
    );
    return { hash: toHex(bits), salt: toHex(salt) };
}

export async function verifyPin(pin, settings) {
    if (!settings.pinHash) return true;
    const { hash } = await hashPin(pin, settings.pinSalt);
    // مقارنة بزمن ثابت
    if (hash.length !== settings.pinHash.length) return false;
    let diff = 0;
    for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ settings.pinHash.charCodeAt(i);
    return diff === 0;
}

/** يحوّل اسم الموقع إلى شكل موحّد للمقارنة (بدون www). */
export function siteOf(hostname) {
    return (hostname || "").toLowerCase().replace(/^www\./, "");
}

export function listHasSite(list, hostname) {
    const h = siteOf(hostname);
    return list.some((s) => h === s || h.endsWith("." + s));
}
