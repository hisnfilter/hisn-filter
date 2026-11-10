// يوتيوب العادي لطفل (وضع الطفل): طبقة فوق الفلتر العام.
// 1) removeFlaggedCards: بطاقة صورتها المصغّرة حكم عليها الفاحص بالحجب تُحذف كلها (العنوان والصورة)، لا تُغبَّش فقط،
//    من الرئيسية والبحث والمقترحات — الطفل لا يرى أن هناك شيئًا أصلًا.
// 2) hideShortsAndComments (دون 13): لا Shorts (تبويب ورفوف)، ولا تعليقات، وإيقاف التشغيل التلقائي للمقطع التالي.
// كل ذلك بالـDOM داخل الصفحة؛ لا شيء يُرسل.

import { bump } from "./activity.js";
const YT_HOST = /(^|\.)youtube\.com$/;
const CARDS = [
    "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer", "ytd-grid-video-renderer", "yt-lockup-view-model",
    "ytm-video-with-context-renderer", "ytm-compact-video-renderer", "ytm-rich-item-renderer", "ytm-media-item", "ytm-video-card-renderer",
    "ytm-compact-autoplay-renderer", "ytm-shorts-lockup-view-model", "ytm-shorts-lockup-view-model-v2", "ytd-reel-item-renderer",
].join(",");
const SHORTS = [
    "ytm-reel-shelf-renderer", "ytd-reel-shelf-renderer", "ytd-rich-shelf-renderer[is-shorts]", "ytm-rich-section-renderer:has(ytm-reel-shelf-renderer)",
    'ytm-pivot-bar-item-renderer:has([href="/shorts"])', 'ytm-pivot-bar-item-renderer:has(a[href^="/shorts"])', 'ytd-guide-entry-renderer:has(a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer[aria-label="Shorts"]', 'a[href="/shorts"]', 'a[href^="/shorts/"]:not([data-hisn-keep])',
    "ytm-shorts-lockup-view-model", "ytm-shorts-lockup-view-model-v2", "ytd-reel-item-renderer",
].join(",");
const COMMENTS = [
    "ytm-comment-section-renderer", "ytm-comments-entry-point-header-renderer", "ytm-comments-section-renderer", "#comments", "ytd-comments",
    "ytm-item-section-renderer[section-identifier='comments-entry-point']", "ytm-comments-entry-point-teaser-renderer",
].join(",");

let flagged = false;
let young = false;
let timer = null;
let removed = 0;

export function configureKidsYouTube(s) {
    const on = Boolean(s.enabled && s.childMode && YT_HOST.test(location.hostname));
    flagged = on && s.removeFlaggedCards !== false;
    young = on && (s.hideShortsAndComments === true || (s.hideShortsAndComments !== false && s.childAge !== "13to15"));
    clearInterval(timer);
    timer = null;
    document.documentElement.toggleAttribute("data-hisn-kids-yt", young);
    if (on) diag(`kidsyt: flagged=${flagged} young=${young} age=${s.childAge} hsc=${s.hideShortsAndComments}`);
    if (!flagged && !young) return;
    timer = setInterval(tick, 900);
    tick();
}

function tick() {
    try {
        if (flagged) removeFlagged();
        if (young) { autoplayOff(); shortsRedirect(); hideShortsTab(); }
        emptyState();
    } catch { /* صفحة بلا DOM مستقر */ }
}

/** صفحة بحث أو رئيسية خلت من البطاقات بعد الإخفاء: رسالة لطيفة بدل الفراغ حتى لا يُظن أن التطبيق معطل */
function emptyState() {
    const results = location.pathname === "/results" || location.pathname === "/";
    let note = document.querySelector(".hisn-kids-empty");
    if (!results) { note?.remove(); return; }
    const cards = [...document.querySelectorAll(CARDS)].filter((c) => !c.parentElement?.closest(CARDS));
    const hidden = cards.filter((c) => c.getAttribute("data-hisn-topic") === "hidden").length;
    const visible = cards.length - hidden;
    if (!(cards.length >= 3 && visible === 0)) { note?.remove(); return; }
    if (note) return;
    note = document.createElement("div");
    note.className = "hisn-ui hisn-kids-empty";
    note.setAttribute("dir", "rtl");
    note.style.cssText = "margin:24px 16px;padding:20px;border-radius:16px;background:#ede9fb;color:#2e164f;font:15px/1.7 system-ui,-apple-system,sans-serif;text-align:center";
    note.innerHTML = '<div style="font-size:34px;margin-bottom:6px">🛡️</div><div style="font-weight:700;font-size:17px">لا نتائج مناسبة للصغار</div><div style="color:#4c1d95;margin-top:4px">' + (location.pathname === "/results" ? "كل نتائج هذا البحث أُخفيت. جرّب كلمة أخرى، أو اطلب من ماما أو بابا." : "أُخفيت كل المقاطع هنا. جرّب البحث عن شيء تحبه.") + "</div>";
    const anchor = cards[0]?.parentElement || document.querySelector("ytm-section-list-renderer, #contents, ytd-section-list-renderer") || document.body;
    anchor.insertBefore(note, anchor.firstChild);
}

/** بطاقة فيها صورة مصغّرة محجوبة (blur/cover/partial) أو مقطع معاينة محجوب: تُخفى كلها. */
function removeFlagged() {
    for (const media of document.querySelectorAll('img[data-hisn="blur"], img[data-hisn="cover"], img[data-hisn="partial"], video[data-hisn="blur"], video[data-hisn="cover"], video[data-hisn="partial"]')) {
        const card = media.closest(CARDS);
        if (!card || card.getAttribute("data-hisn-topic") === "hidden") continue;
        // لا نحذف مشغّل المقطع المفتوح نفسه (ذاك يُغبَّش ويُعامل في video.js)
        if (card.closest("#player, #movie_player, ytm-watch, #player-container")) continue;
        card.setAttribute("data-hisn-topic", "hidden");
        card.dataset.hisnFlagged = (media.dataset.hisnReason || "image") + (media.dataset.hisnScene ? " " + media.dataset.hisnScene : "");
        removed++;
        bump("hidden");
    }
}

/** تبويب Shorts في شريط التنقل (لا رابط فيه في بعض النسخ): يُعرف بنصه */
function hideShortsTab() {
    for (const el of document.querySelectorAll("ytm-pivot-bar-item-renderer, ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, yt-tab-shape, tp-yt-paper-tab")) {
        if (el.getAttribute("data-hisn-topic") === "hidden") continue;
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (/^(shorts|مقاطع قصيرة|القصيرة)$/i.test(t)) el.setAttribute("data-hisn-topic", "hidden");
    }
}

/** التشغيل التلقائي للمقطع التالي: إن كان مفعّلًا نطفئه (زر Autoplay في المشغّل أو في القائمة). */
function autoplayOff() {
    const btn = document.querySelector('button[aria-label*="utoplay"][aria-pressed="true"], .ytp-autonav-toggle-button[aria-checked="true"], ytm-autonav-toggle-button-renderer button[aria-pressed="true"]');
    if (btn) btn.click();
}

/** رابط Shorts مباشر (من رسالة أو مشاركة): نعود للرئيسية بدل عرضه. */
function shortsRedirect() {
    if (/^\/shorts\//.test(location.pathname)) { diag("kidsyt: shorts link → home"); location.replace("/"); }
}

function diag(text) {
    globalThis.webkit?.messageHandlers?.hisn?.postMessage({ type: "hisn:log", text })?.catch?.(() => {});
}

export const kidsYtCss = `
html[data-hisn-kids-yt] :is(${SHORTS}) { display: none !important; }
html[data-hisn-kids-yt] :is(${COMMENTS}) { display: none !important; }
`;
export const _test = { removedCount: () => removed, CARDS, SHORTS };
