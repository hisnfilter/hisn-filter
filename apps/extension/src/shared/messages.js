// أنواع الرسائل بين أجزاء الإضافة.
export const MSG = {
    GET_SETTINGS: "hisn:get-settings",
    UPDATE_SETTINGS: "hisn:update-settings", // { patch, pin? }
    SET_PIN: "hisn:set-pin", // { pin, oldPin? }
    CHECK_PIN: "hisn:check-pin", // { pin }
    UNLOCK_STATUS: "hisn:unlock-status",
    LOCK_NOW: "hisn:lock-now",
    PICK_HIDE: "hisn:pick-hide", // للصفحة: الضغطة التالية على صورة أو فيديو تخفيه
    SETTINGS_CHANGED: "hisn:settings-changed", // من الخلفية للصفحات: { settings } (بلا بصمة الرمز)
    ALLOW_SITE: "hisn:allow-site", // { site, pin? }
    DETECT_IMAGE: "hisn:detect-image", // { src | dataUrl, kind }
    DETECT_FRAME: "hisn:detect-frame", // { dataUrl, videoId, t }
    MEDIA_CORS: "hisn:media-cors", // { url } إذن CORS لملفات الفيديو من موقع آخر
    DETECT_AUDIO: "hisn:detect-audio", // { pcm: base64 Int16 بتردد 16kHz، 15600 عينة }
    DETECTOR_READY: "hisn:detector-ready",
    DETECTOR_HEALTH: "hisn:detector-health", // للمحرك: حالة النماذج
    GET_HEALTH: "hisn:get-health", // للخلفية: حالة كل طبقة حماية
    REPORT_VERDICT: "hisn:report-verdict", // { key, verdict }
    HIDE_ACCOUNT: "hisn:hide-account", // { site, handle }
    IMPORT_SETTINGS: "hisn:import-settings", // { code, pin? } رمز نقل من جهاز آخر
    REQUEST_REVIEW: "hisn:request-review", // { key, host, label, page } وضع الطفل في التطبيق: طلب مراجعة ولي الأمر
};

/** يرسل رسالة ويُرجع Promise، ويعيد null بدل الخطأ إذا لم يرد أحد. */
export async function send(api, message) {
    try {
        // في Chrome (MV3) و Firefox تُرجع sendMessage وعدًا (Promise) عند عدم تمرير دالة رد.
        const resp = await api.runtime.sendMessage(message);
        return resp ?? null;
    } catch {
        return null;
    }
}
