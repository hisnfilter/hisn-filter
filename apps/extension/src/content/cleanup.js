// «تنظيف الحساب» (في التطبيق فقط): يضغط أزرار الموقع نيابةً عن المستخدم في حسابه هو — إلغاء إعجابات
// وإزالة إعادات نشر — بدفعات مع استراحة حتى لا يوقفه الموقع مؤقتًا. لا كلمات سر، ولا شيء يُرسل خارج الجهاز.
// الأزرار تُعرف بنصوصها (عدة لغات) لا بأسمائها الداخلية التي تتغير. أي زر لم يُعثر عليه → توقف ورسالة واضحة.
// التشغيل من التطبيق: __hisnCleanup({platform, kind, batch, dryRun}) ، والإيقاف: __hisnCleanupStop().

const T = {
    select: ["Select", "تحديد", "Sélectionner", "Seleccionar", "Auswählen"],
    unlike: ["Unlike", "إلغاء الإعجاب", "إلغاء الإعجابات", "Je n’aime plus", "Ya no me gusta"],
    cancel: ["Cancel", "إلغاء", "Annuler"],
    remove: ["Remove", "Remove from profile", "Remove repost", "Delete", "إزالة", "إزالة من الملف الشخصي", "إزالة إعادة النشر", "حذف"],
    repost: ["Repost", "إعادة نشر", "إعادة النشر"],
    more: ["More options", "More", "المزيد من الخيارات", "المزيد", "Options", "خيارات"],
    checkbox: ["Toggle checkbox", "تبديل مربع الاختيار"],
};

let running = false, stop = false;
let state = { done: 0, batchDone: 0, kind: "", platform: "" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => sleep(ms + Math.random() * ms * 0.5);

function post(type, extra = {}) {
    try { globalThis.webkit?.messageHandlers?.hisn?.postMessage({ type: "hisn:cleanup-progress", state: type, done: state.done, batchDone: state.batchDone, kind: state.kind, platform: state.platform, ...extra })?.catch?.(() => {}); } catch { /* */ }
}
const visible = (el) => el && el.isConnected && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
/** زر بنصه (أو aria-label) من قائمة بدائل بعدة لغات */
function findButton(names, root = document) {
    const want = names.map(norm);
    const els = [...root.querySelectorAll('button, [role="button"], a[role="link"], div[role="menuitem"], [role="dialog"] button')];
    return els.find((b) => visible(b) && (want.includes(norm(b.textContent)) || want.includes(norm(b.getAttribute("aria-label"))))) || null;
}
function findAll(names, root = document) {
    const want = names.map(norm);
    return [...root.querySelectorAll('button, [role="button"], [role="checkbox"], input[type="checkbox"]')].filter((b) => visible(b) && (want.includes(norm(b.getAttribute("aria-label"))) || want.includes(norm(b.textContent))));
}
/** ضغطة كأنها إصبع: لمس + مؤشر + فأرة على العنصر الواقع تحت نقطة منتصف الزر (الموقع يستمع أحيانًا على عنصر أب) */
function click(el) {
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let tgt = document.elementFromPoint(cx, cy) || el;
    // طبقة شفافة فوق الزر (فيسبوك: loading-overlay): نضغط الزر نفسه
    if (tgt !== el && !el.contains(tgt) && !tgt.contains(el)) tgt = el;
    const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true };
    try {
        const tc = new Touch({ identifier: 1, target: tgt, clientX: cx, clientY: cy, pageX: cx + scrollX, pageY: cy + scrollY });
        for (const t of ["touchstart", "touchend"]) tgt.dispatchEvent(new TouchEvent(t, { bubbles: true, cancelable: true, touches: t === "touchstart" ? [tc] : [], changedTouches: [tc] }));
    } catch { /* بلا لمس */ }
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) tgt.dispatchEvent(t.startsWith("pointer") ? new PointerEvent(t, o) : new MouseEvent(t, o));
}
/** عدد المحدد كما يعرضه زر «Unlike (n)» */
function selectedCount() {
    const want = T.unlike.map(norm);
    let best = 0;
    for (const b of document.querySelectorAll('button, [role="button"]')) {
        if (!visible(b)) continue;
        const t = norm(b.textContent); const m = t.match(/\((\d+)\)/);
        if (m && want.some((w) => t.startsWith(w))) best = Math.max(best, parseInt(m[1], 10));
    }
    return best;
}
const confirmOpen = () => /are you sure|هل أنت متأكد|هل تريد بالتأكيد/i.test(document.body?.innerText || "");
async function waitFor(fn, ms = 8000, step = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; if (stop) return null; await sleep(step); }
    return null;
}
function fail(what) { post("error", { note: what }); running = false; }

// ===== إنستغرام: الإعجابات (صفحة «نشاطك» → الإعجابات: تحديد → مربعات → إلغاء الإعجاب) =====
async function igLikes({ batch, dryRun }) {
    const PAGE = "/your_activity/interactions/likes/";
    if (!location.pathname.startsWith(PAGE)) { location.href = "https://www.instagram.com" + PAGE; return "navigating"; }
    while (running && !stop && state.batchDone < batch) {
        // 1) وضع التحديد
        let sel = findButton(T.select);
        if (!sel) {
            // ربما نحن في وضع التحديد أصلًا، أو لا إعجابات
            if (!findAll(T.checkbox).length) {
                const empty = await waitFor(() => findButton(T.select) || findAll(T.checkbox).length, 6000);
                if (!empty) { post("finished", { note: "no-more" }); running = false; return "done"; }
                sel = findButton(T.select);
            }
        }
        if (sel) { click(sel); await waitFor(() => findAll(T.checkbox).length, 6000); }
        // 2) تحديد المربعات الظاهرة (حتى 100 — حد إنستغرام في المرة)
        let boxes = findAll(T.checkbox);
        if (!boxes.length) { fail("no-checkboxes"); return "error"; }
        // تحميل المزيد بالتمرير حتى 100 أو حتى يتوقف العدد
        for (let i = 0; i < 6 && boxes.length < 100; i++) {
            window.scrollTo(0, document.documentElement.scrollHeight);
            await jitter(900);
            const n = findAll(T.checkbox).length;
            if (n === boxes.length) break;
            boxes = findAll(T.checkbox);
        }
        window.scrollTo(0, 0);
        boxes = findAll(T.checkbox).slice(0, Math.min(100, batch - state.batchDone));
        let n = 0;
        for (const b of boxes) {
            if (stop) break;
            click(b); n++;
            await sleep(90);
        }
        await jitter(700);
        // التحقق: الزر يعرض «Unlike (n)» — إن لم يعرض فالتحديد لم يعمل
        const selected = selectedCount();
        if (!selected) { fail("select-failed"); return "error"; }
        n = selected;
        // 3) إلغاء الإعجاب (+ تأكيد إن ظهر)
        if (dryRun) {
            const c = findButton(T.cancel); if (c) click(c);
            state.done += n; state.batchDone += n; post("progress", { note: "dry-run" });
            await jitter(800);
            continue;
        }
        const un = findButton(T.unlike);
        if (!un) { fail("no-unlike-button"); return "error"; }
        click(un);
        // تأكيد «Unlike this post(s)?» → الزر Unlike داخل الحوار
        // الحوار قد لا يحمل role=dialog: نأخذ آخر زر «Unlike» ظاهر غير زر الشريط (بلا عدّاد بين قوسين)
        const confirm = await waitFor(() => {
            const want = T.unlike.map(norm);
            const btns = [...document.querySelectorAll('button, [role="button"]')].filter((b) => b !== un && visible(b) && want.includes(norm(b.textContent)) && !/\(\d+\)/.test(b.textContent || ""));
            return btns.length ? btns[btns.length - 1] : null;
        }, 6000);
        if (!confirm) { fail("no-confirm-dialog"); return "error"; }
        click(confirm);
        // تمّ حين يختفي عدّاد «Unlike (n)» (يخرج من وضع التحديد أو يصفر)
        const ok = await waitFor(() => selectedCount() === 0 && !confirmOpen(), 20000, 400);
        if (!ok) { fail("unlike-not-applied"); return "error"; }
        state.done += n; state.batchDone += n; post("progress");
        await jitter(2500);
    }
    if (stop) { post("stopped"); running = false; return "stopped"; }
    post("paused", { note: "batch" }); running = false; return "paused";
}

// ===== إنستغرام: إعادات النشر (ملفي → Reposts: فتح أول عنصر → زر Repost في شريط الإجراءات → «Delete» إن ظهرت ورقة) =====
// التحقق الحقيقي: بعد العودة وإعادة التحميل، أول عنصر في الشبكة يجب أن يتغيّر؛ وإلا نتوقف بدل العبث.
const KEY_LAST = "hisnCleanupLastRepost";
async function igReposts({ batch, dryRun, username }) {
    const PAGE = `/${username}/reposts/`;
    if (!username) { fail("no-username"); return "error"; }
    if (!location.pathname.startsWith(PAGE)) { location.href = "https://www.instagram.com" + PAGE; return "navigating"; }
    const firstItem = () => [...document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]')].find(visible) || null;
    const first = await waitFor(firstItem, 8000);
    if (!first) { sessionStorage.removeItem(KEY_LAST); post("finished", { note: "no-more" }); running = false; return "done"; }
    const href = first.getAttribute("href") || "";
    // عنصر الدورة السابقة ما زال أولًا؟ إذن الإزالة لم تنجح
    const last = sessionStorage.getItem(KEY_LAST);
    if (last && !dryRun) {
        sessionStorage.removeItem(KEY_LAST);
        if (last === href) { fail("repost-not-removed"); return "error"; }
        state.done++; state.batchDone++; post("progress");
        if (state.batchDone >= batch) { post("paused", { note: "batch" }); running = false; return "paused"; }
        if (stop) { post("stopped"); running = false; return "stopped"; }
        await jitter(2000);
    }
    click(first);
    const likeNames = ["Like", "إعجاب", "أعجبني"].map(norm);
    const pickRepost = () => {
        const cands = findAll(T.repost);
        const inBar = cands.find((b) => { let e = b; for (let i = 0; i < 4 && e; i++, e = e.parentElement) { if ([...e.querySelectorAll('button, [role="button"]')].some((x) => likeNames.includes(norm(x.textContent)) || likeNames.includes(norm(x.getAttribute("aria-label"))))) return true; } return false; });
        return inBar || cands[cands.length - 1] || null;
    };
    const rp = await waitFor(pickRepost, 8000);
    if (!rp) { fail("no-repost-button"); return "error"; }
    if (dryRun) { state.done++; state.batchDone++; post("progress", { note: "dry-run" }); if (state.batchDone >= batch) { post("paused", { note: "batch" }); running = false; return "paused"; } location.href = "https://www.instagram.com" + PAGE; return "navigating"; }
    click(rp);
    // ورقة فيها «Delete»؟ نضغطها (وتأكيدًا ثانيًا إن ظهر)؛ وإلا فالزر بدّل الحالة مباشرة
    const del = await waitFor(() => findButton(T.remove), 2500);
    if (del) {
        click(del); await sleep(800);
        const again = [...document.querySelectorAll('button, [role="button"]')].filter((b) => b !== del && visible(b) && T.remove.map(norm).includes(norm(b.textContent)));
        if (again.length) click(again[again.length - 1]);
        await waitFor(() => !findButton(T.remove), 6000, 300);
    }
    await jitter(1500);
    sessionStorage.setItem(KEY_LAST, href);
    location.href = "https://www.instagram.com" + PAGE;
    return "navigating";
}

// ===== عام: عنصر واحد في كل دورة، والتحقق بتغيّر أول عنصر بعد إعادة التحميل (مثل إعادات نشر إنستغرام) =====
const KEY_ONE = "hisnCleanupLastOne";
async function oneByOne({ batch, dryRun, page, firstSel, act, inPage = false }) {
    if (location.href.split("?")[0].replace(/\/$/, "") !== page.split("?")[0].replace(/\/$/, "") && !location.href.startsWith(page)) { location.href = page; return "navigating"; }
    const first = await waitFor(() => [...document.querySelectorAll(firstSel)].find(visible) || null, 9000);
    if (!first) { sessionStorage.removeItem(KEY_ONE); post("finished", { note: "no-more" }); running = false; return "done"; }
    // معرّف العنصر: الرابط، وإلا وصفه مع ما حوله (فيسبوك: الأوصاف تتكرر، فنضيف نص البطاقة)
    const card = first.closest("[data-tracking-duration-id], article, li, [role=article]") || first.parentElement?.parentElement;
    const id = first.getAttribute("href") || ((first.getAttribute("aria-label") || "") + "|" + (card?.textContent || first.textContent || "").trim().slice(0, 160));
    const last = sessionStorage.getItem(KEY_ONE);
    if (last && !dryRun) {
        sessionStorage.removeItem(KEY_ONE);
        if (last === id) { fail("not-removed"); return "error"; }
        state.done++; state.batchDone++; post("progress");
        if (state.batchDone >= batch) { post("paused", { note: "batch" }); running = false; return "paused"; }
        if (stop) { post("stopped"); running = false; return "stopped"; }
        await jitter(1800);
    }
    const r = await act(first, dryRun);
    if (r !== true) { fail(r || "action-failed"); return "error"; }
    // تحقق داخل الصفحة (فيسبوك: العناصر تتشابه أوصافها، فالتحقق باختفاء العنصر نفسه بعد الإجراء)
    if (inPage && !dryRun) {
        state.done++; state.batchDone++; post("progress");
        if (state.batchDone >= batch) { post("paused", { note: "batch" }); running = false; return "paused"; }
        if (stop) { post("stopped"); running = false; return "stopped"; }
        await jitter(1500);
        location.href = page;
        return "navigating";
    }
    if (dryRun) { state.done++; state.batchDone++; post("progress", { note: "dry-run" }); if (state.batchDone >= batch) { post("paused", { note: "batch" }); running = false; return "paused"; } }
    else sessionStorage.setItem(KEY_ONE, id);
    await jitter(1500);
    location.href = page;
    return "navigating";
}

// يوتيوب: «الفيديوهات التي أعجبتني» — قائمة ⋮ لكل فيديو ← «إزالة من الفيديوهات التي أعجبتني»
const YT_T = {
    menu: ["Action menu", "More actions", "قائمة الإجراءات", "مزيد من الإجراءات", "المزيد من الإجراءات"],
    removeLiked: ["Remove from Liked videos", "إزالة من الفيديوهات التي أعجبتني", "إزالة من «الفيديوهات التي أعجبتني»", "Remove from playlist", "إزالة من قائمة التشغيل"],
    subscribed: ["Subscribed", "مشترك", "تم الاشتراك", "مشترَك"],
    unsubscribe: ["Unsubscribe", "إلغاء الاشتراك"],
};
async function ytLikes(o) {
    return oneByOne({ ...o, page: "https://m.youtube.com/playlist?list=LL", firstSel: "ytm-playlist-video-renderer a[href*='/watch'], ytd-playlist-video-renderer a[href*='/watch']",
        act: async (first, dry) => {
            const card = first.closest("ytm-playlist-video-renderer, ytd-playlist-video-renderer") || first.parentElement;
            const menu = findAll(YT_T.menu, card)[0] || card.querySelector("ytm-menu-renderer button, button[aria-haspopup]");
            if (!menu) return "no-menu";
            if (dry) return true;
            click(menu);
            const rm = await waitFor(() => findButton(YT_T.removeLiked) || [...document.querySelectorAll("ytm-menu-service-item-renderer, ytm-menu-item, [role=menuitem], tp-yt-paper-item")].find((e) => visible(e) && /remove|إزالة/i.test(e.textContent || "")), 6000);
            if (!rm) return "no-remove-item";
            click(rm); await sleep(1200);
            return true;
        } });
}
// يوتيوب: الاشتراكات — قائمة القنوات ← صفحة القناة ← «مشترك» ← «إلغاء الاشتراك» ← تأكيد
async function ytSubs(o) {
    return oneByOne({ ...o, page: "https://m.youtube.com/feed/channels", firstSel: "ytm-channel-list-item-renderer a, a[href^='/@'], a[href^='/channel/']",
        act: async (first, dry) => {
            click(first);
            const sub = await waitFor(() => findButton(YT_T.subscribed) || [...document.querySelectorAll("ytm-subscribe-button-renderer button, yt-subscribe-button-view-model button")].find(visible), 9000);
            if (!sub) return "no-subscribed-button";
            if (dry) return true;
            click(sub);
            const un = await waitFor(() => findButton(YT_T.unsubscribe) || [...document.querySelectorAll("ytm-menu-service-item-renderer, [role=menuitem], yt-list-item-view-model")].find((e) => visible(e) && /unsubscribe|إلغاء الاشتراك/i.test(e.textContent || "")), 6000);
            if (!un) return "no-unsubscribe";
            click(un); await sleep(800);
            const confirm = [...document.querySelectorAll("button, [role=button]")].filter((b) => visible(b) && /^(unsubscribe|إلغاء الاشتراك)$/i.test(norm(b.textContent))).pop();
            if (confirm) click(confirm);
            const ok = await waitFor(() => !findButton(YT_T.subscribed), 6000, 300);
            return ok ? true : "still-subscribed";
        } });
}
// تيك توك: الإعجابات وإعادات النشر — من ملفي: تبويب «Liked»/«Reposts» ← فتح أول مقطع ← زر الإعجاب/إعادة النشر لإلغائه
const TT_T = { liked: ["Liked", "الإعجابات", "أعجبني"], reposts: ["Reposts", "إعادات النشر", "إعادة النشر"], removeRepost: ["Remove repost", "إزالة إعادة النشر", "Remove", "إزالة"] };
async function ttTab(o, tabNames, onVideo) {
    const user = (o.username || "").replace(/^@/, "");
    if (!user) { fail("no-username"); return "error"; }
    const page = `https://www.tiktok.com/@${user}`;
    if (!location.href.startsWith(page)) { location.href = page; return "navigating"; }
    const tab = await waitFor(() => [...document.querySelectorAll("p, span, div[role=tab], button")].find((e) => visible(e) && tabNames.map(norm).includes(norm(e.textContent))), 9000);
    if (!tab) { fail("no-tab"); return "error"; }
    click(tab); await sleep(1500);
    return oneByOne({ ...o, page: location.href, firstSel: "[data-e2e='user-liked-item'] a, [data-e2e='user-repost-item'] a, [data-e2e*='item-list'] a[href*='/video/']",
        act: async (first, dry) => { click(first); await sleep(1500); return onVideo(dry); } });
}
async function ttLikes(o) {
    return ttTab(o, TT_T.liked, async (dry) => {
        const like = await waitFor(() => [...document.querySelectorAll("[data-e2e='like-icon'], [data-e2e='browse-like-icon'], button[aria-label*='Like' i], button[aria-label*='إعجاب']")].find(visible), 8000);
        if (!like) return "no-like-button";
        if (dry) return true;
        click(like); await sleep(900);
        return true;
    });
}
async function ttReposts(o) {
    return ttTab(o, TT_T.reposts, async (dry) => {
        const share = await waitFor(() => [...document.querySelectorAll("[data-e2e='share-icon'], [data-e2e='browse-share-icon'], button[aria-label*='Share' i], button[aria-label*='مشاركة']")].find(visible), 8000);
        if (!share) return "no-share-button";
        if (dry) return true;
        click(share);
        const rm = await waitFor(() => findButton(TT_T.removeRepost), 6000);
        if (!rm) return "no-remove-repost";
        click(rm); await sleep(900);
        return true;
    });
}

// فيسبوك: «سجل النشاط» — زر «More options for …» لكل عنصر ← إلغاء الإعجاب / حذف / نقل إلى المهملات ← تأكيد
const FB_CAT = { likes: "likedposts", comments: "commentscluster", posts: "statuscluster" };
const FB_ACT = {
    likes: /^(unlike|remove reaction|remove like|unreact|delete|إلغاء الإعجاب|إزالة التفاعل|إزالة الإعجاب|حذف)$/i,
    comments: /^(delete|حذف)$/i,
    posts: /^(move to trash|move to recycle bin|delete|نقل إلى سلة المهملات|نقل إلى المهملات|حذف)$/i,
};
const FB_CONFIRM = /^(delete|move|move to trash|remove|unlike|حذف|نقل|إزالة|إلغاء الإعجاب)$/i;
// فيسبوك يضع أيقونات بخط خاص (محارف «الاستخدام الخاص») قبل النص: نزيلها قبل المطابقة
const fbText = (e) => norm(e.textContent).replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{10FFFF}]/gu, "").trim();
async function fbActivity(o, kind) {
    const page = "https://m.facebook.com/allactivity/?category_key=" + FB_CAT[kind];
    if (!location.href.includes("/allactivity")) { location.href = page; return "navigating"; }
    return oneByOne({ ...o, page, firstSel: '[aria-label^="More options for"], [aria-label^="خيارات إضافية"], [aria-label^="المزيد من الخيارات"]',
        act: async (first, dry) => {
            click(first);
            const items = () => [...document.querySelectorAll('[role="button"], [role="menuitem"], button, div[tabindex]')].filter((e) => visible(e) && e.textContent.trim().length < 40);
            const item = await waitFor(() => items().find((e) => FB_ACT[kind].test(fbText(e))), 6000);
            if (dry) {
                diagMenu(items().map(fbText).filter(Boolean).slice(-8).join(" | "));
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                return item ? true : "no-action-in-menu";
            }
            if (!item) { diagMenu("FAIL " + (first.getAttribute("aria-label") || "").slice(17, 90) + " :: " + items().map(fbText).filter(Boolean).slice(-8).join(" | ")); return "no-action-in-menu"; }
            const row = first.closest("[data-tracking-duration-id], [data-mcomponent], div[data-type]") || first.parentElement;
            click(item); await sleep(900);
            const conf = items().filter((e) => e !== item && FB_CONFIRM.test(fbText(e))).pop();
            if (conf) { click(conf); await sleep(800); }
            // تمّ حين يختفي العنصر (زره أو صفّه) من الصفحة
            const gone = await waitFor(() => !first.isConnected || !row.isConnected || !visible(first), 8000, 300);
            return gone ? true : "not-removed";
        }, inPage: true });
}
function diagMenu(t) { try { globalThis.webkit?.messageHandlers?.hisn?.postMessage({ type: "hisn:log", text: "cleanup menu: " + t.slice(0, 180) })?.catch?.(() => {}); } catch { /* */ } }

export function installCleanup() {
    if (!globalThis.webkit?.messageHandlers?.hisn) return;
    globalThis.__hisnCleanup = async (opts = {}) => {
        if (running) return "busy";
        running = true; stop = false;
        state = { done: opts.done || 0, batchDone: opts.batchDone || 0, kind: opts.kind || "likes", platform: opts.platform || "instagram" };
        const batch = Math.max(1, Math.min(500, opts.batch || 200));
        post("started");
        try {
            if (state.platform === "instagram" && state.kind === "likes") return await igLikes({ batch, dryRun: !!opts.dryRun });
            if (state.platform === "instagram" && state.kind === "reposts") return await igReposts({ batch, dryRun: !!opts.dryRun, username: opts.username });
            const o = { batch, dryRun: !!opts.dryRun, username: opts.username };
            if (state.platform === "youtube" && state.kind === "likes") return await ytLikes(o);
            if (state.platform === "youtube" && state.kind === "subs") return await ytSubs(o);
            if (state.platform === "facebook" && FB_CAT[state.kind]) return await fbActivity(o, state.kind);
            if (state.platform === "tiktok" && state.kind === "likes") return await ttLikes(o);
            if (state.platform === "tiktok" && state.kind === "reposts") return await ttReposts(o);
            fail("unsupported"); return "error";
        } catch (e) { fail("exception: " + String(e?.message || e).slice(0, 80)); return "error"; }
    };
    globalThis.__hisnCleanupStop = () => { stop = true; return true; };
    globalThis.__hisnCleanupState = () => ({ running, ...state });
}
