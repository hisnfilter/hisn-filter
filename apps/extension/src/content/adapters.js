// ملاءمات خاصة بالمنصات: الانتقال للمقطع التالي في المقاطع القصيرة.
// تيك توك، وريلز إنستغرام وفيسبوك، وشورتس يوتيوب.

const SHORT_SITES = [
    { host: /(^|\.)tiktok\.com$/, next: ['[data-e2e="arrow-right"]', 'button[aria-label*="next" i]', '[data-e2e="feed-video-next"]'] },
    { host: /(^|\.)youtube\.com$/, path: /^\/shorts\//, next: ["#navigation-button-down button", 'button[aria-label*="Next video" i]'] },
    { host: /(^|\.)instagram\.com$/, path: /^\/reels?\//, next: [] },
    { host: /(^|\.)facebook\.com$/, path: /^\/reel\//, next: ['[aria-label="Next card"]', '[aria-label*="next" i]'] },
];

let lastSkip = 0;

function siteRule() {
    const h = location.hostname;
    return SHORT_SITES.find((s) => s.host.test(h) && (!s.path || s.path.test(location.pathname)));
}

export function isShortVideoPage() {
    return Boolean(siteRule());
}


/** هل هذا المقطع هو الظاهر الآن أمام المستخدم (يغطي منتصف الشاشة)؟ المنصات تحمّل مقاطع تالية خارج الشاشة. */
export function isOnScreen(video) {
    const b = video.getBoundingClientRect();
    if (!b.height || !b.width) return false;
    const my = innerHeight / 2;
    return b.top < my && b.bottom > my && b.height > innerHeight * 0.35;
}

/**
 * ينقل المستخدم للمقطع التالي، مرة واحدة لكل مقطع — فقط للمقطع الظاهر الآن، وفقط عبر زر «التالي» في المنصة.
 * لا تمرير قسري أبدًا: في ريلز إنستغرام (لا زر تالي) كان التمرير يصطدم بالتثبيت التلقائي للصفحة فتنطّ
 * الصفحة وترتدّ، خصوصًا حين يُحكم على مقطع تالٍ لم يظهر بعد. المقطع المحجوب يبقى مغبّشًا وموقوفًا وهذا يكفي.
 */
export function skipShortVideo(video) {
    const rule = siteRule();
    // المنصات تعيد استخدام نفس عنصر الفيديو، فنتذكر المصدر لا العنصر
    if (!rule || video.dataset.hisnSkipped === video.currentSrc) return false;
    if (!isOnScreen(video)) return false;
    const now = Date.now();
    if (now - lastSkip < 1200) return false;
    lastSkip = now;
    video.dataset.hisnSkipped = video.currentSrc;
    try { video.pause(); } catch { /* بعض المشغلات تمنع الإيقاف */ }

    for (const sel of rule.next) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
            btn.click();
            return true;
        }
    }
    return false;
}
