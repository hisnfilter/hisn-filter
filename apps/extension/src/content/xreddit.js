// حماية إكس وريديت (خيارا protectX و protectReddit، مفعّلان افتراضيًا): المنصتان تعلّمان المحتوى الإباحي بنفسيهما،
// فنخفيه من مصدره قبل الفاحص — المنشور الموسوم «حساس»/NSFW يُطوى كاملًا (لا زر «إظهار»)، والحساب أو المجتمع
// الموسوم يُحجب، والردود المزعجة («شوف البايو» 🔞) تُطوى، وتبويبات الخوارزمية (لك/استكشف/الشائع) تُخفى.
// كل شيء في الصفحة؛ لا شيء يُرسل.

const X_HOST = /(^|\.)(x|twitter)\.com$/;
const R_HOST = /(^|\.)reddit\.com$/;
const ATTR = "data-hisn-xr";

// عبارات حسابات الإغراء في الردود (إنجليزي/عربي/رموز)
const SPAM = /check (my|the) bio|link in (my )?bio|see my (bio|profile)|🔞|onlyfans|only fans|nsfw|سناب(ي)? (في|ب)? ?البايو|شوف(وا)? البايو|الرابط في البايو|حسابي الثاني|تعال خاص|😈🍑|🍑💦|💦🍆/i;

let on = { x: false, r: false };
let child = false;
let allowedSubs = [];
let timer = null;
let notice = null;

export function configureXReddit(s) {
    const host = location.hostname;
    on = {
        x: Boolean(s.enabled && s.protectX !== false && X_HOST.test(host)),
        r: Boolean(s.enabled && s.protectReddit !== false && R_HOST.test(host)),
    };
    child = Boolean(s.childMode);
    allowedSubs = (s.redditAllowed || []).map((x) => String(x).toLowerCase().replace(/^r\//, "").trim()).filter(Boolean);
    clearInterval(timer);
    timer = null;
    if (!on.x && !on.r) {
        for (const el of document.querySelectorAll(`[${ATTR}]`)) el.removeAttribute(ATTR);
        notice?.remove(); notice = null;
        return;
    }
    timer = setInterval(tick, 600);
    tick();
}

function tick() {
    try {
        if (child) { block("إكس وريديت لا يناسبان وضع الطفل."); return; }
        if (on.x) x();
        if (on.r) reddit();
    } catch { /* صفحة بلا DOM مستقر */ }
}

/** طيّ مع إبقاء الارتفاع (القوائم الافتراضية تعتمد على ارتفاعات العناصر) — بلا زر إظهار */
function fold(el, label) {
    if (!el || el.getAttribute(ATTR) === "folded") return;
    el.setAttribute(ATTR, "folded");
    el.setAttribute("data-hisn-xr-label", label);
    for (const v of el.querySelectorAll("video")) { try { v.muted = true; v.pause(); } catch { /* */ } }
}
function hide(el) { if (el && el.getAttribute(ATTR) !== "hidden") el.setAttribute(ATTR, "hidden"); }

/** صفحة محجوبة كاملة: رسالة فوق الصفحة وزر رجوع */
function block(text) {
    if (notice?.isConnected) return;
    notice = document.createElement("div");
    notice.className = "hisn-ui hisn-xr-block";
    notice.setAttribute("dir", "rtl");
    notice.setAttribute("style", "position:fixed;inset:0;z-index:2147483600;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#f4f2fa;color:#2e164f;font:16px/1.7 system-ui,-apple-system,sans-serif;text-align:center;padding:24px");
    notice.innerHTML = '<div style="font-size:40px">🛡️</div><div style="font-weight:700;font-size:18px">حجبه حصن</div><div style="color:#4c1d95;max-width:320px"></div>';
    notice.children[2].textContent = text;
    const back = document.createElement("button");
    back.textContent = "رجوع";
    back.setAttribute("style", "margin-top:8px;padding:10px 28px;border:0;border-radius:12px;background:#6d28d9;color:#fff;font:600 15px system-ui");
    back.onclick = () => { notice?.remove(); notice = null; history.length > 1 ? history.back() : (location.href = "/"); };
    notice.appendChild(back);
    document.documentElement.appendChild(notice);
}
function unblock() { notice?.remove(); notice = null; }

// ===== إكس =====
let xForYouDone = "";
function x() {
    const path = location.pathname;
    // استكشف والترندات: لا تُفتح
    if (/^\/explore(\/|$)|^\/i\/trends/.test(path)) { location.replace("/home"); return; }
    // تبويب «الوسائط» في البحث → «الأحدث»
    if (path === "/search" && /[?&]f=media/.test(location.search)) { location.replace(location.href.replace(/([?&]f=)media/, "$1live")); return; }
    for (const a of document.querySelectorAll('a[href="/explore"], a[href^="/explore/"], [data-testid="AppTabBar_Explore_Link"], [aria-label="Search and explore"], [aria-label="Timeline: Trending now"], [data-testid="trend"]')) hide(a.closest('[data-testid="trend"]') || a);
    // الرئيسية: «المتابَعون» بدل «لك» (مرة لكل تحميل)، ويُخفى تبويب «لك»
    if (path === "/home") {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const forYou = tabs.find((t) => /^(for you|لك|لأجلك)$/i.test((t.textContent || "").trim()));
        const following = tabs.find((t) => /^(following|المتابَعون|المتابعون|متابَعون)$/i.test((t.textContent || "").trim()));
        if (forYou && following) {
            if (forYou.getAttribute("aria-selected") === "true" && xForYouDone !== location.href) { xForYouDone = location.href; following.click(); }
            hide(forYou.closest('[role="presentation"]') || forYou);
        }
    }
    // حساب موسوم «حساس»
    const body = document.body?.innerText || "";
    if (/This profile may include potentially sensitive content|قد يحتوي هذا الملف الشخصي على محتوى حساس|Caution: This profile/i.test(body.slice(0, 4000))) {
        block("هذا الحساب موسوم من إكس بأنه قد يحتوي محتوى حساسًا.");
        return;
    }
    unblock();
    const detail = /\/status\/\d+/.test(path);
    let firstTweetSeen = false;
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
        const cell = art.closest('[data-testid="cellInnerDiv"]') || art;
        const txt = art.innerText || "";
        // وسم «محتوى حساس» من إكس نفسه
        if (art.querySelector('[data-testid="sensitiveMediaWarning"]') || /Content warning|potentially sensitive content|The following media includes|تحذير بشأن المحتوى|محتوى قد يكون حساسًا/i.test(txt)) { fold(cell, "منشور موسوم «حساس» · أخفاه حصن"); continue; }
        // صفحة منشور: الأول هو المنشور نفسه، وما بعده ردود — ردود الإغراء تُطوى
        if (detail) {
            if (!firstTweetSeen) { firstTweetSeen = true; continue; }
            if (SPAM.test(txt)) { fold(cell, "رد مزعج · أخفاه حصن"); continue; }
        } else if (SPAM.test(txt)) { fold(cell, "منشور مزعج · أخفاه حصن"); }
    }
}

// ===== ريديت =====
function reddit() {
    const path = location.pathname.toLowerCase();
    if (/^\/r\/(popular|all)(\/|$)/.test(path)) { location.replace("/"); return; }
    for (const a of document.querySelectorAll('a[href="/r/popular/"], a[href="/r/popular"], a[href="/r/all/"], a[href="/r/all"], a[href^="/r/popular"], faceplate-tracker[noun="popular"]')) hide(a.closest("li") || a);
    // مجتمع +18 (صفحة التحذير، أو رأس المجتمع موسوم)
    const sub = (path.match(/^\/r\/([^/]+)/) || [])[1] || "";
    const body = document.body?.innerText || "";
    const nsfwSub = document.querySelector('shreddit-subreddit-header[nsfw], shreddit-async-loader[bundlename*="nsfw"], [data-testid="nsfw-interstitial"], shreddit-subreddit-header[is-nsfw]')
        || /You must be 18\+ to view this community|Mature Content|this community contains mature content|هذا المجتمع يحتوي/i.test(body.slice(0, 3000));
    if (sub && nsfwSub) { block("هذا المجتمع موسوم من ريديت بأنه للبالغين (NSFW)."); return; }
    if (sub && allowedSubs.length && !allowedSubs.includes(sub)) { block(`مجتمع r/${sub} ليس في «المجتمعات المسموحة».`); return; }
    unblock();
    // منشورات NSFW (التصميم الجديد والقديم والجوال)
    for (const p of document.querySelectorAll('shreddit-post[nsfw], shreddit-post[is-nsfw], shreddit-post[over18], article:has(shreddit-post[nsfw]), [data-testid="post-container"]:has([data-testid="nsfw-tag"]), .thing.over18')) hide(p.closest("article") || p);
    for (const tag of document.querySelectorAll('span, faceplate-tracker, shreddit-post-flair')) {
        if (tag.children.length > 2) continue;
        const t = (tag.textContent || "").trim();
        if (t === "NSFW" || t === "nsfw" || t === "18+") { const post = tag.closest("shreddit-post, article, [data-testid='post-container'], .thing"); if (post) hide(post.closest("article") || post); }
    }
    // المجتمعات المسموحة فقط: منشورات من غيرها تُخفى في الرئيسية والبحث
    if (allowedSubs.length) {
        for (const p of document.querySelectorAll("shreddit-post[subreddit-prefixed-name]")) {
            const s = (p.getAttribute("subreddit-prefixed-name") || "").toLowerCase().replace(/^r\//, "");
            if (s && !allowedSubs.includes(s)) hide(p.closest("article") || p);
        }
    }
}

export const xredditCss = `
[${ATTR}="hidden"] { display: none !important; }
[${ATTR}="folded"] { position: relative !important; pointer-events: none !important; }
[${ATTR}="folded"] > * { visibility: hidden !important; }
[${ATTR}="folded"]::before { content: attr(data-hisn-xr-label); position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; background: #f4f2fa; color: #9a94b5; font: 13px/1.4 -apple-system, system-ui, sans-serif; direction: rtl; }
@media (prefers-color-scheme: dark) { [${ATTR}="folded"]::before { background: #15121f; color: #6f6a86; } }
`;
export const _test = { SPAM };
