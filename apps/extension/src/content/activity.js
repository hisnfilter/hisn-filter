// ملخص النشاط (وضع الطفل): أعداد — كم بطاقة أُخفيت، كم مقطعًا أُوقف — وعبارات بحث يوتيوب، تُمرَّر للتطبيق
// كل بضع ثوانٍ ليحفظها على الجهاز ١٤ يومًا (التطبيق يتجاهل العبارات إن أطفأ الوالد خيارها). لا صور ولا روابط،
// ولا شيء يُرسل خارج الجهاز. في الإضافة لا يُستعمل.
let counts = { hidden: 0, stopped: 0 };
let searches = [];
let lastSearch = "";
let timer = null;
let on = false;

export function configureActivity(s) {
    on = Boolean(s.enabled && s.childMode && globalThis.webkit?.messageHandlers?.hisn);
    clearInterval(timer);
    timer = null;
    if (!on) return;
    timer = setInterval(flush, 8000);
}

/** حدث: "hidden" بطاقة أُخفيت (من العنوان أو الصورة أو القناة)، "stopped" مقطع أُوقف */
export function bump(kind, n = 1) {
    if (!on) return;
    counts[kind] = (counts[kind] || 0) + n;
}

/** عنوان بحث (يوتيوب): يُسجَّل مرة لكل بحث */
export function noteSearch(q) {
    if (!q || q === lastSearch) return;
    lastSearch = q;
    // يُسجَّل حتى لو جاء قبل وصول الإعدادات؛ flush يرسله حين يُفعَّل
    searches.push(q.slice(0, 60));
    try { globalThis.webkit?.messageHandlers?.hisn?.postMessage({ type: "hisn:log", text: `activity: search noted (${searches.length}) on=${on}` })?.catch?.(() => {}); } catch { /* */ }
}

function flush() {
    if (!on) return;
    if (!counts.hidden && !counts.stopped && !searches.length) return;
    const payload = { type: "hisn:activity", hidden: counts.hidden, stopped: counts.stopped, searches, host: location.hostname.replace(/^www\./, "") };
    counts = { hidden: 0, stopped: 0 };
    searches = [];
    try { globalThis.webkit?.messageHandlers?.hisn?.postMessage(payload)?.catch?.(() => {}); } catch { /* */ }
}
