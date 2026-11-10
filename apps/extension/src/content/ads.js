// إخفاء الإعلانات (خيار hideAds): منشورات «ممول/Sponsored/Ad» في إنستغرام وتيك توك، والبطاقات المروّجة في
// يوتيوب، وتخطّي إعلانات ما قبل المقطع في يوتيوب حين يظهر زر التخطي. لا شيء يُرسل ولا يُحجب على مستوى الشبكة.
// حدود صريحة: إعلان يوتيوب داخل المشغّل نفسه (قبل المقطع) لا يُزال، بل يُتخطّى عند توفر الزر ويُكتم حتى ذلك.

const AD_LABEL = /^(sponsored|ad|paid partnership|ممول|مموّل|إعلان|مدعوم|برعاية|شراكة مدفوعة)$/i;
/** منشورات حسابات لا يتابعها المستخدم (خيار hideSuggested): «مقترح لك» في خلاصة إنستغرام الرئيسية */
const SUGGESTED_LABEL = /^(suggested for you|suggested post|suggested posts|مقترح لك|مقترحة لك|منشور مقترح|منشورات مقترحة)$/i;
const IG_HOST = /(^|\.)(instagram|tiktok)\.com$/;
const YT_HOST = /(^|\.)youtube\.com$/;
const YT_AD_CARDS = [
    "ytd-display-ad-renderer", "ytd-ad-slot-renderer", "ytd-carousel-ad-renderer", "ytd-promoted-video-renderer",
    "ytd-in-feed-ad-layout-renderer", "ytd-promoted-sparkles-web-renderer", "ytd-banner-promo-renderer", "ytd-statement-banner-renderer",
    "ytm-promoted-video-renderer", "ytm-promoted-sparkles-web-renderer", "ytm-companion-ad-renderer", "ytm-in-feed-ad-layout-renderer",
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)", "ytm-rich-item-renderer:has(ytm-promoted-video-renderer)",
    "#masthead-ad", "#player-ads", ".ytd-mealbar-promo-renderer", "ytd-mealbar-promo-renderer",
].join(",");
const YT_SKIP = ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .videoAdUiSkipButton, button.ytp-ad-skip-button-container";

let enabled = false;
let suggested = false;
let timer = null;
let hidden = 0;
let revealable = false;
let tapInstalled = false;

export function configureAds(s) {
    enabled = Boolean(s.enabled && s.hideAds !== false);
    suggested = Boolean(s.enabled && s.hideSuggested !== false);
    // اللمس على المساحة الفارغة يعرض المنشور (ليس في وضع الطفل)
    revealable = !s.childMode;
    clearInterval(timer);
    timer = null;
    // خيار أُطفئ: ما أُخفي بذلك الخيار يعود للظهور (نوع كل عنصر محفوظ في data-hisn-ad-kind)
    for (const el of document.querySelectorAll('[data-hisn-ad="folded"]')) {
        const k = el.getAttribute("data-hisn-ad-kind");
        if ((k === "ad" && !enabled) || (k === "suggested" && !suggested)) unfold(el);
    }
    if (!enabled) for (const el of document.querySelectorAll('[data-hisn-ad="hidden"],[data-hisn-ad="dimmed"]')) el.removeAttribute("data-hisn-ad");
    if (!tapInstalled) {
        tapInstalled = true;
        document.addEventListener("click", (e) => {
            if (!revealable) return;
            const card = e.target?.closest?.('[data-hisn-ad="folded"]');
            if (card) { e.preventDefault(); e.stopPropagation(); unfold(card); card.setAttribute("data-hisn-ad-seen-by-user", "1"); }
        }, true);
    }
    if (!enabled && !suggested) return;
    timer = setInterval(tick, 800);
    tick();
}

function tick() {
    if (!enabled && !suggested) return;
    try {
        if (enabled && IG_HOST.test(location.hostname)) hideLabeledPosts();
        if (enabled && YT_HOST.test(location.hostname)) youtube();
        if (suggested && /(^|\.)instagram\.com$/.test(location.hostname) && location.pathname === "/") hideSuggestedPosts();
    } catch { /* صفحة بلا DOM مستقر */ }
}

/** منشور في الخلاصة عليه وسم «ممول/Sponsored/Ad» تحت اسم الحساب: يُخفى كاملًا. */
function hideLabeledPosts() {
    for (const el of document.querySelectorAll("span, a, div")) {
        if (el.children.length > 1 || el.hasAttribute("data-hisn-ad-seen")) continue;
        const t = (el.textContent || "").trim();
        if (t.length > 20 || !AD_LABEL.test(t)) continue;
        el.setAttribute("data-hisn-ad-seen", "1");
        // البطاقة: article في الخلاصة، أو أقرب حاوية كبيرة في الريلز/تيك توك
        const card = el.closest("article") || bigAncestor(el);
        const reels = /\/reels?\//.test(location.pathname) || location.hostname.includes("tiktok");
        if (card && !card.hasAttribute("data-hisn-ad")) {
            hidden++;
            if (reels) {
                // الريلز بتمرير «التصاق» على ارتفاع الشاشة: طيّ الإعلان يغيّر مواضع الالتصاق فتقفز الخلاصة.
                // لذلك لا يُطوى ولا يُمرَّر عنه قسرًا (التمرير البرمجي يصطدم بالالتصاق فتنطّ الصفحة)؛ يُعتَّم فقط
                card.setAttribute("data-hisn-ad", "dimmed");
            } else {
                // الخلاصة: تفريغ لا طيّ: الارتفاع يبقى كما هو (قائمة إنستغرام الافتراضية تعتمد على ارتفاعات المنشورات)
                fold(card, "ad", "إعلان · أخفاه حصن");
            }
        }
    }
}

/** الخلاصة الرئيسية في إنستغرام: منشور عليه «مقترح لك» (حساب لا يتابعه المستخدم) يُطوى كالإعلان. */
function hideSuggestedPosts() {
    for (const el of document.querySelectorAll("span, div")) {
        if (el.children.length > 1 || el.hasAttribute("data-hisn-sug-seen")) continue;
        const t = (el.textContent || "").trim();
        if (t.length > 24 || !SUGGESTED_LABEL.test(t)) continue;
        el.setAttribute("data-hisn-sug-seen", "1");
        const card = el.closest("article");
        if (card && !card.hasAttribute("data-hisn-ad")) { fold(card, "suggested", "منشور مقترح من حساب غير متابَع · أخفاه حصن"); hidden++; }
    }
}

/** تفريغ منشور في الخلاصة مع إبقاء ارتفاعه (لا تغيير في التخطيط) وإيقاف أي مقطع فيه */
function fold(card, kind, label) {
    if (card.hasAttribute("data-hisn-ad-seen-by-user")) return;
    card.setAttribute("data-hisn-ad-kind", kind);
    card.setAttribute("data-hisn-ad-label", label + (revealable ? " · المس للعرض" : ""));
    card.setAttribute("data-hisn-ad", "folded");
    for (const v of card.querySelectorAll("video")) { try { v.muted = true; v.pause(); } catch { /* */ } }
}

function unfold(card) {
    card.removeAttribute("data-hisn-ad");
    card.removeAttribute("data-hisn-ad-label");
}

function bigAncestor(el) {
    for (let e = el.parentElement, i = 0; e && i < 12; e = e.parentElement, i++) {
        const r = e.getBoundingClientRect();
        if (r.width >= innerWidth * 0.8 && r.height >= innerHeight * 0.5) return e;
    }
    return null;
}


function youtube() {
    for (const el of document.querySelectorAll(YT_AD_CARDS)) {
        if (!el.hasAttribute("data-hisn-ad")) { el.setAttribute("data-hisn-ad", "hidden"); hidden++; }
    }
    // إعلان داخل المشغّل: كتم حتى يظهر زر التخطي ثم الضغط عليه
    const player = document.getElementById("movie_player");
    const adShowing = player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting");
    const video = player?.querySelector("video");
    if (adShowing && video) {
        // أثناء الإعلان: كتم + تغبيش (قد يكون بذيئًا) + القفز لنهايته ليُتخطّى فورًا، وزر التخطي إن ظهر
        if (!video.dataset.hisnAdMuted) { video.dataset.hisnAdMuted = video.muted ? "was" : "1"; video.muted = true; }
        player.setAttribute("data-hisn-ad", "playing");
        if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.5) {
            try { video.currentTime = video.duration; } catch { /* قد يرفض */ }
        }
        const skip = document.querySelector(YT_SKIP);
        if (skip) skip.click();
    } else if (video?.dataset.hisnAdMuted || player?.getAttribute("data-hisn-ad") === "playing") {
        if (video?.dataset.hisnAdMuted === "1") video.muted = false;
        if (video) delete video.dataset.hisnAdMuted;
        player?.removeAttribute("data-hisn-ad");
    }
}

export const adsCss = `[data-hisn-ad="hidden"] { display: none !important; } [data-hisn-ad="folded"] { position: relative !important; } [data-hisn-ad="folded"] > * { visibility: hidden !important; } [data-hisn-ad="folded"]::before { content: attr(data-hisn-ad-label); position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #f4f2fa; color: #9a94b5; font: 13px system-ui, sans-serif; direction: rtl; }`;
export const _test = { AD_LABEL, hiddenCount: () => hidden };
