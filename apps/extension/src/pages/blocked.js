import { api, siteOf } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";

const $ = (s) => document.querySelector(s);
// الرابط الأصلي يأتي بعد u= كما هو (قد يحتوي & فلا نستخدم URLSearchParams له)
const raw = location.search.slice(1);
const reason = (raw.match(/(?:^|&)r=([a-z]+)/) ?? [])[1] ?? "adult";
const original = raw.includes("u=") ? raw.slice(raw.indexOf("u=") + 2) : "";
let host = "";
try { host = siteOf(new URL(original).hostname); } catch { /* رابط غير صالح */ }

$("#why").textContent = reason === "gambling" ? "مصنّف ضمن مواقع القمار."
    : reason === "streaming" ? "خدمة بث مشفّرة: الجهاز يمنع قراءة الفيديو فلا يستطيع حصن فحص محتواها، لذلك لا تُفتح من حصن."
    : "مصنّف ضمن المواقع الإباحية.";
if (reason === "streaming") $("#allow")?.remove();
$("#site").textContent = host;

$("#back").onclick = () => (history.length > 2 ? history.go(-2) : window.close());

function askPin() {
    return new Promise((resolve) => {
        const dlg = $("#pinDialog");
        $("#pinInput").value = "";
        dlg.showModal();
        dlg.onclose = () => resolve(dlg.returnValue === "ok" ? $("#pinInput").value : null);
    });
}

$("#allow").onclick = async () => {
    if (!host) return;
    const ok = confirm(`هل أنت متأكد أن ${host} موقع سليم؟ سيُرفع عنه الحجب على هذا الجهاز.`);
    if (!ok) return;
    let r = await send(api, { type: MSG.ALLOW_SITE, site: host });
    if (r?.error === "pin") {
        const pin = await askPin();
        if (pin == null) return;
        r = await send(api, { type: MSG.ALLOW_SITE, site: host, pin });
    }
    if (r?.ok) location.replace(original);
    else $("#err").textContent = r?.error === "wait" ? `محاولات كثيرة. انتظر ${r.wait} ثانية.` : "الرمز غير صحيح";
};
