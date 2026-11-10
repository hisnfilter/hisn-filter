// واجهة الحجب داخل الصفحة: ورقة الأنماط، ونافذة "إظهار"، وطلب رمز القفل.
// كل عناصرنا داخل Shadow DOM حتى لا تتأثر بتصميم الموقع ولا تؤثر فيه.
import { api } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";
import { kidsYtCss } from "./kidsyt.js";
import { xredditCss } from "./xreddit.js";

const ATTR = "data-hisn"; // pending | ok | blur | cover | error
const FOLD = "data-hisn-fold";
let styleEl = null;
let host = null;
let shadow = null;
let currentSettings = null;

const REASON_TEXT = {
    "not-analyzed": "لم يُفحص بعد",
    "error": "تعذّر فحصه",
    sexual: "محتوى غير لائق",
    nudity: "عورة مكشوفة",
    woman: "صورة امرأة",
    scary: "مشهد مخيف",
    man: "صورة رجل",
    person: "صورة شخص",
    "uncertain-person": "صورة شخص",
    manual: "أخفيتَه بنفسك",
};

/** تُحقن فور بدء الصفحة: كل صورة وفيديو مضبّب حتى يثبت أنه سليم (مغلق عند الشك). */
export function baseCss() {
    return styleEl?.textContent ?? "";
}

export function installBaseStyle(settings) {
    currentSettings = settings;
    const blur = settings.blurStyle === "opaque" ? "blur(30px) brightness(0)" : "blur(28px)";
    const gray = settings.blurStyle === "gray" ? " grayscale(1)" : "";
    const media = [
        settings.filterImages ? `img:not([${ATTR}="ok"])` : null,
        settings.filterVideos ? `video:not([${ATTR}="ok"])` : null,
        settings.filterImages ? `[data-hisn-bg]:not([data-hisn-bg="ok"])` : null,
    ].filter(Boolean);
    const css = `
${media.join(",\n")} {
  filter: ${blur}${gray} !important;
  /* الضباب يبقى داخل حدود الصورة: لا يسيح على ما حولها من نصوص وصور */
  clip-path: inset(0) !important;
  transition: filter .15s ease !important;
}
/* قيد الفحص: لوحة رمادية فاتحة تومض كتحميل الصور العادي (لا يظهر من الصورة شيء: التباين صفر) */
${settings.filterImages ? `img:not([${ATTR}]), img[${ATTR}="pending"]` : "img.hisn-none"}${settings.filterVideos ? `, video:not([${ATTR}]), video[${ATTR}="pending"]` : ""} {
  filter: contrast(0) brightness(1.75)${gray} !important;
  animation: hisn-wait 1.1s ease-in-out infinite alternate !important;
}
@keyframes hisn-wait { from { opacity: .55; } to { opacity: .9; } }
img[${ATTR}="cover"], video[${ATTR}="cover"], [data-hisn-bg="cover"][data-hisn-bg] {
  filter: blur(40px) brightness(0.25)${gray} !important;
}
/* تغطية جزئية: مرشح SVG خاص بكل صورة يضبّب ويعتّم مناطق الأشخاص المخفيين فقط */
img[${ATTR}="partial"] {
  filter: var(--hisn-partial) !important;
}
video[${ATTR}="partial"] { filter: none !important; }
img[${ATTR}="revealed"], video[${ATTR}="revealed"], [data-hisn-bg="revealed"][data-hisn-bg] {
  filter: none !important;
  clip-path: none;
}
[data-hisn-topic="hidden"] { display: none !important; }
[data-hisn-ad="hidden"] { display: none !important; }
[data-hisn-ad="dimmed"] { filter: blur(24px) brightness(0.25) !important; }
[data-hisn-ad="dimmed"] video { visibility: hidden !important; }
${kidsYtCss}
${xredditCss}
/* إعلان يوتيوب داخل المشغّل: مغبّش ومعتم حتى يُتخطّى */
#movie_player[data-hisn-ad="playing"] video { filter: blur(40px) brightness(0.2) !important; }
/* منشور إعلاني/مقترح في الخلاصة: يُفرَّغ مع إبقاء ارتفاعه كما هو — تغيير الارتفاع كان يربك قائمة إنستغرام الافتراضية فتنطّ الخلاصة أو تفرغ */
[data-hisn-ad="folded"] { position: relative !important; }
[data-hisn-ad="folded"] > * { visibility: hidden !important; }
[data-hisn-ad="folded"]::before { content: attr(data-hisn-ad-label); position: absolute; inset: 0; z-index: 2; cursor: pointer; display: flex; align-items: center; justify-content: center; background: #f4f2fa; color: #9a94b5; font: 13px/1.4 -apple-system, system-ui, sans-serif; direction: rtl; }
@media (prefers-color-scheme: dark) { [data-hisn-ad="folded"]::before { background: #15121f; color: #6f6a86; } }
[${FOLD}] {
  filter: blur(7px) !important;
  user-select: none !important;
  cursor: pointer !important;
}
[${FOLD}="revealed"] { filter: none !important; user-select: auto !important; cursor: auto !important; }
`;
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "hisn-style";
        (document.head ?? document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
}

export function removeBaseStyle() {
    styleEl?.remove();
    styleEl = null;
}

/** الحكم الحقيقي لكل عنصر: نحفظه عندنا لا في الصفحة، فسمة الصفحة ليست تفويضًا. */
const truth = new WeakMap();

export function setMediaState(el, state, reason) {
    if (state !== "partial") clearPartial(el);
    truth.set(el, state);
    el.setAttribute(ATTR, state);
    if (reason) el.dataset.hisnReason = reason;
    else delete el.dataset.hisnReason;
    // شارة «محجوب» تُزال فورًا مع الإظهار (لا تنتظر الدورة التالية)
    if ((el.tagName === "VIDEO" || el.tagName === "IMG") && (state === "ok" || state === "revealed")) for (const b of el.parentElement?.querySelectorAll(":scope > .hisn-cover-badge") ?? []) if (b._hisnFor === el) b.remove();
}

/** إظهار بقرار المستخدم (بعد الرمز إن وُجد): يُسجَّل عندنا حتى لا يُلغيه الحارس. */
export function markRevealed(el, attr = ATTR, state = "revealed") {
    if (attr === ATTR) truth.set(el, state);
    // الإظهار يخص هذا المصدر وحده: إن أعاد الموقع استخدام العنصر لصورة أخرى تُفحص من جديد
    el.dataset.hisnRevealedFor = currentSrcOf(el);
    el.setAttribute(attr, state);
    if (el.tagName === "VIDEO" || el.tagName === "IMG") for (const b of el.parentElement?.querySelectorAll(":scope > .hisn-cover-badge") ?? []) if (b._hisnFor === el) b.remove();
}

/** المصدر الحالي للعنصر (صورة/فيديو/خلفية) لربط قرار الإظهار به. */
export function currentSrcOf(el) {
    if (el.tagName === "IMG" || el.tagName === "VIDEO") return el.currentSrc || el.src || "";
    return el.dataset.hisnKey || "";
}
/** هل الإظهار الحالي ما زال يخص المصدر نفسه؟ */
export function revealStillValid(el) {
    return el.dataset.hisnRevealedFor !== undefined && el.dataset.hisnRevealedFor === currentSrcOf(el);
}

/** الصفحة عدّلت سمتنا أو حذفت أنماطنا: نعيد الحكم الحقيقي. (طبقة مساعدة، لا حماية كاملة ضد موقع عدائي) */
let guardInstalled = false;
export function installTamperGuard() {
    if (guardInstalled) return;
    guardInstalled = true;
    const mo = new MutationObserver((muts) => {
        for (const m of muts) {
            if (m.type === "attributes") {
                const el = m.target, want = truth.get(el);
                if (want && el.getAttribute(ATTR) !== want) el.setAttribute(ATTR, want);
            } else if (m.type === "childList" && styleEl && !styleEl.isConnected && currentSettings) {
                styleEl = null;
                installBaseStyle(currentSettings);
            }
        }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR], subtree: true, childList: true });
}

// ===== التغطية الجزئية =====
const SVG_NS = "http://www.w3.org/2000/svg";
let partialDefs = null;
let partialCount = 0;
const partialSizes = new ResizeObserver((entries) => {
    for (const e of entries) if (e.target.getAttribute(ATTR) === "partial") drawPartial(e.target);
});

function defs() {
    if (partialDefs?.isConnected) return partialDefs;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important";
    partialDefs = document.createElementNS(SVG_NS, "defs");
    svg.appendChild(partialDefs);
    document.documentElement.appendChild(svg);
    return partialDefs;
}

/**
 * يحوّل صندوقًا نسبيًا من الصورة الأصلية إلى نسبة من صندوق العنصر، مع مراعاة object-fit
 * (الصورة قد تُقص أو تُصغّر داخل عنصرها) والحشو والإطار.
 */
function toElementBox(el, [bx, by, bw, bh]) {
    const W = el.offsetWidth || el.clientWidth, H = el.offsetHeight || el.clientHeight;
    const isVideo = el.tagName === "VIDEO";
    const nw = isVideo ? el.videoWidth : el.naturalWidth, nh = isVideo ? el.videoHeight : el.naturalHeight;
    if (!W || !H || !nw || !nh) return [bx, by, bw, bh];
    const cs = getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    const left = px(cs.paddingLeft) + px(cs.borderLeftWidth), top = px(cs.paddingTop) + px(cs.borderTopWidth);
    const cw = W - left - px(cs.paddingRight) - px(cs.borderRightWidth), ch = H - top - px(cs.paddingBottom) - px(cs.borderBottomWidth);
    let sx = cw / nw, sy = ch / nh; // fill
    // الفيديو يُعرض كاملًا داخل مساحته (مثل contain) حتى لو كانت القيمة fill
    const fit = isVideo && cs.objectFit === "fill" ? "contain" : cs.objectFit;
    if (fit === "contain" || fit === "cover" || fit === "scale-down" || fit === "none") {
        let k = fit === "cover" ? Math.max(sx, sy) : fit === "none" ? 1 : Math.min(sx, sy);
        if (fit === "scale-down") k = Math.min(1, k);
        sx = sy = k;
    }
    const [opx, opy] = (cs.objectPosition || "50% 50%").split(" ").map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : 0.5));
    const ox = left + (cw - nw * sx) * (opx ?? 0.5), oy = top + (ch - nh * sy) * (opy ?? 0.5);
    return [(ox + bx * nw * sx) / W, (oy + by * nh * sy) / H, (bw * nw * sx) / W, (bh * nh * sy) / H];
}

function drawPartial(el) {
    const f = el._hisnFilter;
    if (!f) return;
    const n = (v) => String(Math.round(v * 10000) / 10000);
    const flood = (b, i) => {
        const [x, y, w, h] = toElementBox(el, b);
        return `<feFlood flood-color="#fff" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" result="m${i}"/>`;
    };
    const boxes = el._hisnBoxes;
    f.innerHTML = `
<feGaussianBlur in="SourceGraphic" stdDeviation="0.045" result="b"/>
<feColorMatrix in="b" type="matrix" values="0.3 0 0 0 0  0 0.3 0 0 0  0 0 0.3 0 0  0 0 0 1 0" result="d"/>
${boxes.map(flood).join("")}
<feMerge result="mask">${boxes.map((_, i) => `<feMergeNode in="m${i}"/>`).join("")}</feMerge>
<feComposite in="d" in2="mask" operator="in" result="cov"/>
<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="cov"/></feMerge>`;
}

// ===== تغطية جزئية للمقاطع: صناديق فوق الفيديو (لا مرشح SVG) =====
// WebKit على الآيفون لا يطبّق مرشح SVG على فيديو يعمل بتسريع العتاد، فتظهر الشارة «تغطية جزئية» والمقطع مكشوف.
// الصناديق مثبّتة على الشاشة وتتبع موضع الفيديو كل بضع عشرات من المللي ثانية؛ لا تغيّر تخطيط الصفحة.
const videoOverlays = new Map(); // video → [div]
let overlayTimer = null;
function ensureOverlayLoop() {
    if (overlayTimer) return;
    overlayTimer = setInterval(() => {
        for (const [v, divs] of videoOverlays) {
            if (!v.isConnected || v.getAttribute(ATTR) !== "partial") { removeVideoOverlays(v); continue; }
            const r = v.getBoundingClientRect();
            const visible = r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
            divs.forEach((d, i) => {
                const b = v._hisnBoxes?.[i];
                if (!b || !visible) { d.style.display = "none"; return; }
                const [x, y, w, h] = toElementBox(v, b);
                d.style.display = "block";
                d.style.transform = `translate(${Math.round(r.left + x * r.width)}px, ${Math.round(r.top + y * r.height)}px)`;
                d.style.width = Math.max(1, Math.round(w * r.width)) + "px";
                d.style.height = Math.max(1, Math.round(h * r.height)) + "px";
            });
        }
        if (!videoOverlays.size) { clearInterval(overlayTimer); overlayTimer = null; }
    }, 60);
}
function setVideoOverlays(v, n) {
    let divs = videoOverlays.get(v) || [];
    while (divs.length < n) {
        const d = document.createElement("div");
        d.className = "hisn-ui hisn-cover-box";
        d.setAttribute("style", "position:fixed;top:0;left:0;display:none;pointer-events:none;z-index:2147483000;border-radius:8px;background:rgba(10,10,14,.72);-webkit-backdrop-filter:blur(28px);backdrop-filter:blur(28px);will-change:transform");
        document.documentElement.appendChild(d);
        divs.push(d);
    }
    while (divs.length > n) divs.pop().remove();
    videoOverlays.set(v, divs);
    ensureOverlayLoop();
}
/** إيقاف الحماية: تُزال كل صناديق التغطية الجزئية ويتوقف تتبعها */
export function clearAllVideoOverlays() {
    for (const v of [...videoOverlays.keys()]) removeVideoOverlays(v);
    clearInterval(overlayTimer); overlayTimer = null;
}
function removeVideoOverlays(v) {
    for (const d of videoOverlays.get(v) || []) d.remove();
    videoOverlays.delete(v);
}

/** يغطي مناطق من الصورة وحدها (النساء مثلًا) ويُظهر الباقي. */
export function setPartial(el, covers) {
    if (el.tagName === "VIDEO") {
        el._hisnBoxes = covers.map((c) => c.box);
        setVideoOverlays(el, el._hisnBoxes.length);
        truth.set(el, "partial");
        el.setAttribute(ATTR, "partial");
        el.dataset.hisnReason = covers.some((c) => c.reason === "nudity") ? "nudity" : covers[0].reason;
        return;
    }
    let f = el._hisnFilter;
    if (!f?.isConnected) {
        f = document.createElementNS(SVG_NS, "filter");
        f.id = `hisn-partial-${++partialCount}`;
        for (const [k, v] of [["x", "0"], ["y", "0"], ["width", "1"], ["height", "1"],
            ["primitiveUnits", "objectBoundingBox"], ["color-interpolation-filters", "sRGB"]]) f.setAttribute(k, v);
        defs().appendChild(f);
        el._hisnFilter = f;
    }
    el._hisnBoxes = covers.map((c) => c.box);
    drawPartial(el);
    el.style.setProperty("--hisn-partial", `url(#${f.id})`);
    partialSizes.observe(el);
    truth.set(el, "partial");
    el.setAttribute(ATTR, "partial");
    el.dataset.hisnReason = covers.some((c) => c.reason === "nudity") ? "nudity" : covers[0].reason;
}

function clearPartial(el) {
    if (el.tagName === "VIDEO") removeVideoOverlays(el);
    if (!el._hisnFilter) return;
    partialSizes.unobserve(el);
    el._hisnFilter.remove();
    el._hisnFilter = null;
    el.style.removeProperty("--hisn-partial");
}

export function foldElement(el, label) {
    if (el.hasAttribute(FOLD)) return;
    el.setAttribute(FOLD, label);
}

// ===== النافذة المنبثقة =====
function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement("hisn-ui");
    host.className = "hisn-ui";
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; inset: auto;";
    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
<style>
  :host { all: initial; }
  .pop { position: fixed; direction: rtl; font: 14px/1.5 system-ui, "Segoe UI", Tahoma, sans-serif;
    background: #fff; color: #1b2430; border: 1px solid #d9dde3; border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 12px; min-width: 220px; max-width: 280px; }
  .t { font-weight: 700; margin-bottom: 4px; padding-inline-end: 28px; }
  .x { position: absolute; top: 6px; inset-inline-end: 6px; width: 30px; height: 30px; min-height: 0; padding: 0;
    border-radius: 50%; border: 0; background: transparent; font-size: 20px; line-height: 30px; color: #5a6573; }
  .r { color: #5a6573; margin-bottom: 10px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  button { font: inherit; border-radius: 8px; border: 1px solid #c9ced6; background: #f5f6f8;
    padding: 6px 12px; cursor: pointer; color: #1b2430; min-height: 36px; }
  button.p { background: #1f6f5c; border-color: #1f6f5c; color: #fff; }
  input { font: inherit; width: 100%; box-sizing: border-box; padding: 8px; border-radius: 8px;
    border: 1px solid #c9ced6; margin: 6px 0 10px; text-align: center; letter-spacing: 4px; }
  .err { color: #b3261e; font-size: 13px; min-height: 18px; }
  @media (prefers-color-scheme: dark) {
    .pop { background: #1d232b; color: #e8ebef; border-color: #39424d; }
    .r { color: #a9b2bd; } .x { color: #a9b2bd; background: transparent; } button { background: #2a313a; color: #e8ebef; border-color: #47515d; }
    input { background: #11161c; color: #e8ebef; border-color: #47515d; }
  }
</style>
<div class="pop" hidden></div>`;
    document.documentElement.appendChild(host);
    document.addEventListener("click", (e) => {
        if (!e.composedPath().includes(host)) hidePopover();
    }, true);
}

function hidePopover() {
    const pop = shadow?.querySelector(".pop");
    if (pop) pop.hidden = true;
}

function place(pop, x, y) {
    pop.hidden = false;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(x - w / 2, innerWidth - w - 8)) + "px";
    pop.style.top = Math.max(8, Math.min(y + 12, innerHeight - h - 8)) + "px";
}

/** يطلب رمز القفل ويتحقق منه في الخلفية. يُرجع true إذا صح أو لم يكن هناك قفل. */
/** نص خطأ الرمز: خطأ عادي، أو انتظار بعد محاولات كثيرة. */
export function pinError(r) {
    return r?.error === "wait" ? `محاولات كثيرة. انتظر ${r.wait} ثانية.` : "الرمز غير صحيح";
}

export function askPin(x, y) {
    return new Promise(async (resolve) => {
        const status = await send(api, { type: MSG.UNLOCK_STATUS });
        if (!status?.locked || status.unlocked) return resolve(true);
        ensureHost();
        const pop = shadow.querySelector(".pop");
        pop.innerHTML = `<div class="t">أدخل رمز القفل</div>
          <input type="password" inputmode="numeric" maxlength="8" autocomplete="off" aria-label="رمز القفل">
          <div class="err" aria-live="polite"></div>
          <div class="row"><button class="p" data-a="ok">تأكيد</button><button data-a="no">إلغاء</button></div>`;
        place(pop, x, y);
        const input = pop.querySelector("input");
        input.focus();
        const submit = async () => {
            const r = await send(api, { type: MSG.CHECK_PIN, pin: input.value });
            if (r?.ok) { hidePopover(); resolve(true); }
            else { pop.querySelector(".err").textContent = pinError(r); input.select(); }
        };
        pop.querySelector('[data-a="ok"]').onclick = submit;
        input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
        pop.querySelector('[data-a="no"]').onclick = () => { hidePopover(); resolve(false); };
    });
}

/**
 * يعرض نافذة صغيرة عند الضغط على محتوى محجوب.
 * actions: [{ label, primary, run }]
 */
/** آخر نافذة خيارات (للاختبارات الآلية؛ الظل مغلق) */
export const _popTest = { last: null };
export function showPopover(x, y, title, reason, actions) {
    _popTest.last = { title, reason, actions };
    ensureHost();
    const pop = shadow.querySelector(".pop");
    pop.innerHTML = `<button class="x" aria-label="إغلاق">×</button><div class="t"></div><div class="r"></div><div class="row"></div>`;
    pop.querySelector(".x").onclick = (e) => { e.stopPropagation(); hidePopover(); };
    pop.querySelector(".t").textContent = title;
    pop.querySelector(".r").textContent = reason ?? "";
    const row = pop.querySelector(".row");
    for (const a of actions) {
        const b = document.createElement("button");
        b.textContent = a.label;
        if (a.primary) b.className = "p";
        b.onclick = (e) => { e.stopPropagation(); hidePopover(); a.run(); };
        row.appendChild(b);
    }
    place(pop, x, y);
}

/** يعترض الضغط على المحتوى المحجوب: لا يفتح الرابط، بل يعرض خيارات الإظهار. */
export function installClickGuard(onMediaAction) {
    let lastTouchHandled = 0;
    const handle = async (e, t, x, y) => {
        const folded = t.closest?.(`[${FOLD}]:not([${FOLD}="revealed"])`);
        if (folded) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const canShow = !currentSettings?.lockEnabled || (await askPin(x, y));
            showPopover(x, y, "منشور مطوي", folded.getAttribute(FOLD), [
                ...(canShow ? [{ label: "إظهار", primary: true, run: () => folded.setAttribute(FOLD, "revealed") }] : []),
                { label: "إبقاؤه مخفيًا", run: () => {} },
            ]);
            return true;
        }
        const media = findHiddenMedia(t);
        if (media) {
            e.preventDefault();
            e.stopImmediatePropagation();
            onMediaAction(media, x, y);
            return true;
        }
        return false;
    };
    // لمسة بدأت على زر/رابط حقيقي (رجوع، إغلاق، تبويب): ليست للوسيط المحجوب ولو تغيّرت الصفحة تحت الإصبع
    // (زر الرجوع في يوتيوب وتيك توك ينقل الصفحة قبل رفع الإصبع، فيصير تحته مقطع محجوب من الصفحة السابقة)
    let lastControlTouch = 0;
    const CONTROL = "button, a, [role=button], [role=link], [role=tab], [role=menuitem], input, textarea, select, label, svg";
    const small = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height < innerWidth * innerHeight * 0.25; };
    /** من الأعلى للأسفل تحت النقطة: أول وسيط محجوب، أو أول عنصر تحكم صغير (فاللمسة له) */
    const pick = (x, y) => {
        for (const el of document.elementsFromPoint?.(x, y) ?? []) {
            if (el.closest?.(".hisn-ui")) return { control: true };
            const m = findHiddenMedia(el);
            if (m) return { media: m };
            const c = el.closest?.(CONTROL);
            if (c && small(c) && !findHiddenMedia(c)) return { control: true };
        }
        return {};
    };
    document.addEventListener("click", (e) => {
        if (e.composedPath().includes(host)) return;
        if (performance.now() - lastControlTouch < 900) return; // ضغطة زر حقيقي: للموقع
        // لمسة عولجت قبل قليل عبر touchend: لا نعرض النافذة مرتين
        if (performance.now() - lastTouchHandled < 700) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        handle(e, e.target, e.clientX, e.clientY);
    }, true);
    // الهاتف: الريلز وتيك توك يلتقطون اللمسة بأنفسهم (نقرة = إيقاف/تشغيل، نقرتان = إعجاب) ويمنعون حدث click،
    // فلا تصل الضغطة على المقطع المحجوب إلى الحارس أعلاه. نعالج اللمسة نفسها: نقرة قصيرة بلا سحب.
    let touch = null;
    document.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) { touch = null; return; }
        const t = e.touches[0];
        // ما تحت الإصبع لحظة النزول (pointerdown يسبق touchstart، والموقع قد ينتقل عنده)
        const d = down && performance.now() - down.at < 300 ? down : { ...pick(t.clientX, t.clientY), href: location.href };
        touch = { x: t.clientX, y: t.clientY, at: performance.now(), href: d.href, control: Boolean(d.control) };
        if (d.control) lastControlTouch = performance.now();
    }, { capture: true, passive: true });
    let down = null;
    // على window ومرحلة الالتقاط: قبل مستمعي الموقع (التي قد تنقل الصفحة فورًا)
    window.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse") { down = null; return; }
        const p = pick(e.clientX, e.clientY);
        down = { at: performance.now(), href: location.href, control: Boolean(p.control) };
        if (p.control) lastControlTouch = performance.now();
    }, { capture: true, passive: true });
    document.addEventListener("touchend", (e) => {
        if (!touch || e.composedPath().includes(host)) return;
        const t = e.changedTouches[0];
        const moved = Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 12;
        const long = performance.now() - touch.at > 600;
        const startedOnControl = touch.control, navigated = touch.href !== location.href;
        touch = null;
        if (moved || long || !t || startedOnControl || navigated) return;
        // الهدف الحقيقي تحت الإصبع (قد يكون المقطع تحت طبقة شفافة)
        const target = document.elementFromPoint(t.clientX, t.clientY) || e.target;
        // الصورة قد تكون تحت طبقة شفافة لا تحتويها (إنستغرام): نفحص كل ما تحت الإصبع
        const stack = document.elementsFromPoint?.(t.clientX, t.clientY) ?? [];
        let media = findHiddenMedia(target) || findHiddenMedia(e.target);
        if (!media) {
            // من الأعلى للأسفل: زر أو رابط حقيقي (صغير — لا طبقة تغطي الشاشة كطبقة اللمس في الريلز) فوق الوسيط
            // يعني أن اللمسة له لا للوسيط المغطى خلفه (زر الرجوع فوق خلاصة فيها صورة محجوبة)
            for (const el of stack) {
                const m = findHiddenMedia(el);
                if (m) { media = m; break; }
                if (el.matches?.("button, a, [role=button], [role=link], input, textarea, select, svg") && small(el)) break;
            }
        }
        const folded = target.closest?.(`[${FOLD}]:not([${FOLD}="revealed"])`);
        if (!media && !folded) return;
        if (handle(e, media || target, t.clientX, t.clientY)) lastTouchHandled = performance.now();
    }, true);
    setInterval(syncVideoBadges.bind(null, onMediaAction), 1000);
}

/** شارة ظاهرة فوق كل مقطع محجوب: تبيّن أن الحجب مقصود وأن الضغط يفتح الخيارات (في وضع الطفل أو مع القفل: بيان فقط). */
function syncVideoBadges(onMediaAction) {
    const restricted = Boolean(currentSettings?.lockEnabled || currentSettings?.childMode);
    for (const b of document.querySelectorAll(".hisn-cover-badge")) {
        const v = b._hisnFor;
        const st = v?.getAttribute(ATTR);
        if (!v || !v.isConnected || !(st === "cover" || st === "blur" || st === "partial" || st === "error") || b._hisnState !== st) b.remove();
    }
    // المقاطع والصور الكبيرة معًا (الصور الصغيرة: الضغط عليها يكفي)
    for (const v of document.querySelectorAll(`video[${ATTR}="cover"], video[${ATTR}="blur"], video[${ATTR}="partial"], video[${ATTR}="error"], img[${ATTR}="cover"], img[${ATTR}="blur"], img[${ATTR}="partial"], img[${ATTR}="error"]`)) {
        const h = v.parentElement;
        if (!h || [...h.querySelectorAll(":scope > .hisn-cover-badge")].some((b) => b._hisnFor === v)) continue;
        const r = v.getBoundingClientRect();
        if (r.width < (v.tagName === "IMG" ? 200 : 120) || r.height < (v.tagName === "IMG" ? 200 : 120)) continue;
        // لا نغيّر position الحاوية (الريلز تحسب التمرير على تخطيطها): الشارة تُوضع فقط إن كانت الحاوية موضَّعة أصلًا
        if (getComputedStyle(h).position === "static") continue;
        const b = document.createElement("button");
        b.className = "hisn-cover-badge";
        const partial = v.getAttribute(ATTR) === "partial";
        b._hisnState = v.getAttribute(ATTR);
        // تعذّر الفحص: شارة مختلفة (ليس حكمًا بالمخالفة)
        if (b._hisnState === "error") b.textContent = "⚠️ تعذّر الفحص · اضغط لإعادة المحاولة";
        else b.textContent = restricted ? (partial ? "🔒 تغطية جزئية" : "🔒 محتوى محجوب") : (partial ? "🔒 تغطية جزئية · اضغط للخيارات" : "🔒 محجوب · اضغط للخيارات");
        b.setAttribute("style", "position:absolute;bottom:14px;inset-inline-start:12px;z-index:2147483646;background:rgba(31,18,53,.88);color:#fff;border:0;font:600 12px/1.6 system-ui,-apple-system,sans-serif;padding:4px 12px;border-radius:999px;cursor:pointer;pointer-events:auto");
        const open = (e) => { e.preventDefault(); e.stopPropagation(); const rr = b.getBoundingClientRect(); onMediaAction(v, rr.left + rr.width / 2, rr.top); };
        b.addEventListener("click", open, true);
        b.addEventListener("touchend", open, true);
        b._hisnFor = v;
        h.appendChild(b);
    }
}

function findHiddenMedia(t) {
    // الصورة قد تكون تحت عنصر شفاف (شائع في إنستغرام)، فنبحث في النقطة نفسها
    const isHidden = (el) => {
        const st = el?.getAttribute?.(ATTR) ?? el?.getAttribute?.("data-hisn-bg");
        return st && st !== "ok" && st !== "revealed";
    };
    if (isHidden(t)) return t;
    const inner = t.querySelector?.(`img[${ATTR}], video[${ATTR}]`);
    if (inner && isHidden(inner) && t.offsetWidth < inner.offsetWidth * 1.5) return inner;
    return null;
}

export function reasonText(reason) {
    return REASON_TEXT[reason] ?? "محتوى محجوب";
}

export { ATTR, FOLD };
