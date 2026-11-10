// إخفاء محتوى السحر والجن والرعب والهالوين (وضع الطفل): بطاقات المقاطع في يوتيوب وتيك توك وألعاب روبلوكس،
// والمقطع المفتوح نفسه في يوتيوب (يتوقف ويظهر تنبيه، والقصير يُتخطّى).
import { scaryTopic, suggestiveTopic, kidsTopic, customTopic } from "@hisn/core";
import { skipShortVideo } from "./adapters.js";
import { bump, noteSearch } from "./activity.js";

const SITES = [
    {
        host: /(^|\.)youtube\.com$/,
        cards: [
            "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer", "ytd-grid-video-renderer",
            "ytd-reel-item-renderer", "ytd-playlist-renderer", "ytd-radio-renderer", "ytd-channel-renderer",
            "yt-lockup-view-model", "ytm-shorts-lockup-view-model", "ytm-shorts-lockup-view-model-v2",
            "ytm-video-with-context-renderer", "ytm-compact-video-renderer", "ytm-reel-item-renderer",
            "ytm-rich-item-renderer", "ytm-playlist-renderer", "ytm-radio-renderer",
            // يوتيوب الجوال (m.youtube.com): نتائج البحث والصفحة الرئيسية والمقترحات
            "ytm-media-item", "ytm-video-card-renderer", "ytm-compact-autoplay-renderer", "ytm-reel-shelf-renderer ytm-shorts-lockup-view-model",
            "ytm-compact-channel-renderer", "ytm-channel-renderer", "ytm-compact-playlist-renderer", "ytm-horizontal-card-list-renderer",
            // يوتيوب الحاسوب: رفوف المنتجات والقوائم والشورتس
            "ytd-reel-video-renderer", "ytd-product-shelf-renderer", "ytd-merch-shelf-item-renderer", "yt-product-lockup-view-model",
            "ytd-shopping-product-renderer", "ytd-product-card-renderer", "ytd-video-card-renderer", "ytd-movie-renderer", "ytd-show-renderer",
            // إعلانات المنتجات في نتائج البحث (أزياء هالوين مثلًا)
            "ytd-display-ad-renderer", "ytd-ad-slot-renderer", "ytd-carousel-ad-renderer", "ytd-promoted-video-renderer", "ytd-in-feed-ad-layout-renderer",
        ].join(","),
        watch: /^\/(watch|shorts\/)/,
        suffix: / - YouTube$/,
    },
    {
        host: /(^|\.)tiktok\.com$/,
        cards: '[data-e2e="recommend-list-item-container"],[data-e2e="user-post-item"],[data-e2e="search_top-item"],[data-e2e="search-card-item"]',
    },
    {
        host: /(^|\.)roblox\.com$/,
        cards: '.game-card-container,.game-tile,[data-testid="game-tile"],.list-item.game-card,.game-card',
    },
];

let enabled = false;
let scary = false;
let suggestive = false;
let kids = false;
let words = [];
let rule = null;
let timer = null;
let lastPage = "";

export function configureTopics(s) {
    scary = Boolean(s.blockScaryTopics);
    suggestive = Boolean(s.hideSuggestive);
    // دون 13: قاموس «لا يناسب الصغار» فوق الرعب والإيحاء
    kids = Boolean(s.childMode && s.childAge !== "13to15");
    // كلمات ولي الأمر: تعمل في كل الأوضاع (ليست خاصة بالطفل)
    words = Array.isArray(s.blockedWords) ? s.blockedWords.filter((w) => typeof w === "string" && w.trim()) : [];
    enabled = scary || suggestive || kids || words.length > 0;
    // تغيّرت القائمة: يُعاد فحص البطاقات
    for (const el of document.querySelectorAll("[data-hisn-topic-text]")) delete el.dataset.hisnTopicText;
    rule = SITES.find((r) => r.host.test(location.hostname)) ?? null;
    clearInterval(timer);
    timer = null;
    if (enabled && rule?.watch) timer = setInterval(checkOpenVideo, 1000);
    if (!enabled) for (const el of document.querySelectorAll("[data-hisn-topic]")) el.removeAttribute("data-hisn-topic");
}

/** يفحص البطاقات داخل العقدة أو حولها. */
export function scanTopics(root) {
    if (!enabled || !rule) return;
    const el = root.nodeType === 3 ? root.parentElement : root;
    if (!el || el.nodeType !== 1 && el.nodeType !== 9 && el.nodeType !== 11) return;
    const cards = new Set();
    const up = el.closest?.(rule.cards);
    if (up) cards.add(up);
    for (const c of el.querySelectorAll?.(rule.cards) ?? []) cards.add(c);
    for (const c of cards) checkCard(outermost(c));
}

function outermost(card) {
    let c = card;
    for (let p = c.parentElement?.closest(rule.cards); p; p = p.parentElement?.closest(rule.cards)) c = p;
    return c;
}

function checkCard(card) {
    const text = (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400)
        + " " + [...card.querySelectorAll("[title],[aria-label]")].slice(0, 6).map((e) => e.getAttribute("title") || e.getAttribute("aria-label")).join(" ");
    if (card.dataset.hisnTopicText === text) return;
    card.dataset.hisnTopicText = text;
    if (hits(text)) { if (card.getAttribute("data-hisn-topic") !== "hidden") bump("hidden"); card.setAttribute("data-hisn-topic", "hidden"); }
    else card.removeAttribute("data-hisn-topic");
}

/** المقطع المفتوح في يوتيوب: من عنوان الصفحة. */
function checkOpenVideo() {
    if (/^\/results\/?$/.test(location.pathname)) { const q = new URLSearchParams(location.search).get("search_query"); if (q) noteSearch(q); }
    if (!rule.watch.test(location.pathname)) return hideNotice();
    const title = document.title.replace(rule.suffix, "");
    const page = location.href + "|" + title;
    if (page === lastPage) return;
    lastPage = page;
    if (!hits(title)) return hideNotice();
    noticeText = scary && scaryTopic(title).hit ? "أوقفته «حماية العقيدة»: المقطع فيه سحر أو رعب أو ما شابه."
        : words.length && customTopic(title, words).hit ? "أوقفه حصن: عنوان المقطع فيه كلمة من «الكلمات المحجوبة»."
        : kids && kidsTopic(title).hit ? "أوقفه حصن: هذا المقطع لا يناسب الصغار." : "أوقفه حصن: عنوان المقطع غير لائق.";
    bump("stopped");
    const video = document.querySelector("video");
    if (location.pathname.startsWith("/shorts/") && video) {
        skipShortVideo(video);
        return;
    }
    try { video?.pause(); } catch { /* */ }
    showNotice();
}

let notice = null;
let noticeText = "";

function hits(text) {
    return (scary && scaryTopic(text).hit) || (suggestive && suggestiveTopic(text).hit) || (kids && kidsTopic(text).hit) || (words.length > 0 && customTopic(text, words).hit);
}
function showNotice() {
    if (notice?.isConnected) return;
    notice = document.createElement("div");
    notice.className = "hisn-ui hisn-topic-notice";
    notice.setAttribute("dir", "rtl");
    notice.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:#2e164f;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font:16px system-ui,sans-serif;text-align:center;padding:24px";
    const msg = document.createElement("div");
    msg.textContent = noticeText;
    const back = document.createElement("button");
    back.textContent = "رجوع";
    back.style.cssText = "font:inherit;padding:10px 28px;border-radius:10px;border:0;background:#6d28d9;color:#fff;cursor:pointer";
    back.addEventListener("click", () => { hideNotice(); history.length > 1 ? history.back() : (location.href = "/"); });
    notice.append(msg, back);
    document.documentElement.appendChild(notice);
    // يوتيوب قد يعيد تشغيل المقطع: نبقيه متوقفًا ما دام التنبيه ظاهرًا
    const keepPaused = () => { if (notice?.isConnected) for (const v of document.querySelectorAll("video")) if (!v.paused) v.pause(); };
    notice._t = setInterval(keepPaused, 500);
}

function hideNotice() {
    if (!notice) return;
    clearInterval(notice._t);
    notice.remove();
    notice = null;
}

export const _test = { SITES };
