// تشغيل صفحات حصن داخل تطبيق الجوال (WebView في أندرويد، وWKWebView في آيفون) بدل الإضافة.
// التطبيق يقدّم كائن HisnHost (أندرويد: addJavascriptInterface، آيفون: نص يُحقن عند التحميل) فيه:
//   settings(): نص JSON لإعدادات المستخدم
//   begin(part, mime) / write(part, position, base64): الناتج يُكتب مباشرة في ملف مؤقت عند التطبيق
//   finish(name): حفظه في معرض الصور، ثم يستدعي التطبيق window.__hisnSaved(ok, message)
//   sharedName() / sharedSize(): الفيديو المُشارك من تطبيق آخر (يُقرأ من /shared/video بطلبات Range)
//   والناتج يُعرض من /output/video
// الملفات (النماذج وغيرها) تُخدم من عنوان التطبيق نفسه، بجانب الصفحات.
import { defaultSettings } from "@hisn/core";

const host = globalThis.HisnHost;
const root = new URL("../", location.href);

globalThis.chrome = {
    runtime: {
        id: "hisn-app",
        getURL: (p) => new URL(p, root).href,
        async sendMessage(m) {
            if (m?.type === "hisn:get-settings") {
                // التطبيق يرسل ما يخزّنه (من يستخدم الجهاز، والمستوى، والموسيقى…) ونكمل الباقي بالافتراضي
                let s = {};
                try { s = JSON.parse(host?.settings?.() ?? "{}") ?? {}; } catch { /* افتراضي */ }
                return { ...defaultSettings(s.viewer === "female" ? "female" : "male"), ...s };
            }
            return null;
        },
        onMessage: { addListener() {} },
    },
    storage: { local: { async get() { return {}; }, async set() {} }, onChanged: { addListener() {} } },
};
