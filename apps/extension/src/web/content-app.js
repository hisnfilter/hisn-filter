// سكربت الصفحة في «المتصفح المحمي» داخل تطبيق الآيفون: نفس سكربت الإضافة، مع جسر التطبيق قبله.
// يبدأ حين يوجد عنصر الصفحة الجذر (الحقن في أول التحميل قد يسبقه).
import "./content-shim.js";

const start = () => import("../content/index.js");
if (document.documentElement) start();
else {
    new MutationObserver((_, obs) => {
        if (document.documentElement) { obs.disconnect(); start(); }
    }).observe(document, { childList: true });
}
