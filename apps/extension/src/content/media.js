// فحص الصور والخلفيات داخل الصفحة.
// القاعدة: كل وسيط يبدأ مضبّبًا (عبر ورقة الأنماط)، ولا يظهر إلا بعد قرار "سليم".
import { decideImage, partialImage, explicitTopic } from "@hisn/core";
import { api } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";
import { setMediaState, setPartial, ATTR, reasonText, showPopover, askPin, markRevealed, revealStillValid } from "./ui.js";
import { watchVideo } from "./video.js";

const MIN_SIZE = 48; // الأيقونات الصغيرة لا تُفحص
const verdictCache = new Map(); // src → تحليل (الأحدث في النهاية)
const VERDICT_CACHE_MAX = 1500;
function cacheVerdict(src, analysis) {
    verdictCache.delete(src);
    verdictCache.set(src, analysis);
    if (verdictCache.size > VERDICT_CACHE_MAX) verdictCache.delete(verdictCache.keys().next().value);
}
const inflight = new Map(); // src → Promise
let settings = null;

export function configureMedia(s) {
    settings = s;
    // تغيّر الإعدادات يعيد تطبيق القرار على كل ما فُحص دون إعادة الفحص
    for (const el of document.querySelectorAll(`img[${ATTR}], [data-hisn-bg]`)) {
        const key = el.dataset.hisnKey;
        if (key && verdictCache.has(key)) applyDecision(el, verdictCache.get(key), { isBg: el.hasAttribute("data-hisn-bg") && el.tagName !== "IMG" });
    }
}

/** مفتاح قصير لتصحيحات المستخدم (لا نحفظ الروابط نفسها). */
async function keyOf(src) {
    const data = new TextEncoder().encode(src.split("#")[0]);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(hash).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** النص الذي يصف الصورة: البديل أو العنوان، وإلا نص البطاقة القصير المحيط بها. */
function labelOf(el) {
    const own = [el.getAttribute("alt"), el.getAttribute("title"), el.getAttribute("aria-label")].filter(Boolean).join(" ");
    if (own.trim()) return own;
    const card = el.closest("a,[aria-label],[role=dialog],article,li");
    const label = card?.getAttribute("aria-label");
    if (label) return label;
    const t = card?.textContent ?? "";
    return t.length <= 300 ? t : "";
}

function applyDecision(el, analysis, { isBg = false } = {}) {
    const attr = isBg ? "data-hisn-bg" : ATTR;
    if (el.getAttribute(attr) === "revealed" && revealStillValid(el)) return;
    delete el.dataset.hisnRevealedFor;
    const userVerdict = settings.imageVerdicts?.[el.dataset.hisnUserKey];
    if (userVerdict === "unsafe") return markHidden(el, attr, "cover", "manual");
    let decision = userVerdict === "safe" ? { action: "show" } : decideImage(analysis, settings);
    // عنوان صريح مرتبط بالصورة (Sex/Life، 18+، إباحي…): تُغطّى لكل المستخدمين ولو لم تكشف النماذج شيئًا
    if (decision.action === "show" && userVerdict !== "safe" && settings.level !== "light" && explicitTopic(labelOf(el)).hit) {
        decision = { action: "blur", reason: "title" };
    }
    // تشخيص (يقرأه مسبار الاختبار): درجات المشهد على العنصر
    if (analysis?.scene) { const sc = analysis.scene; el.dataset.hisnScene = `w${Math.round((sc.woman || 0) * 100)}/s${Math.round((sc.sexual || 0) * 100)}/k${Math.round((sc.scary || 0) * 100)}`; }
    // الصورة نفسها (لا الخلفيات): نغطي النساء وحدهن حين يكون الكشف واثقًا
    const partial = !isBg && decision.action !== "show" && el.tagName === "IMG" ? partialImage(analysis, settings) : null;
    if (partial) return setPartial(el, partial);
    if (decision.action === "show") {
        if (isBg) el.setAttribute(attr, "ok");
        else setMediaState(el, "ok");
    } else {
        markHidden(el, attr, decision.action, decision.reason);
    }
}

function markHidden(el, attr, action, reason) {
    if (attr === ATTR) setMediaState(el, action, reason);
    else {
        el.setAttribute(attr, action);
        el.dataset.hisnReason = reason;
    }
}

/** يستخرج الصورة كنص JPEG صغير من داخل الصفحة (للصور من نفس الموقع أو blob:). */
// 1024 لا 640: وجوه الصور الجماعية الصغيرة يُعرف جنسها بثقة أعلى بكثير (اختبرنا: 0.4 ← 0.8)
function extractFromElement(el, maxSide = 1024) {
    const w = el.naturalWidth || el.videoWidth || el.width;
    const h = el.naturalHeight || el.videoHeight || el.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    ctx.drawImage(el, 0, 0, c.width, c.height);
    try {
        return c.toDataURL("image/jpeg", 0.85); // يفشل إذا كانت الصورة من موقع آخر بلا CORS
    } catch {
        return null;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** يرسل الصورة لمحرك الكشف، مع إعادة المحاولة إذا لم يكن المحرك جاهزًا بعد. */
async function analyze(src, el) {
    if (verdictCache.has(src)) return verdictCache.get(src);
    if (inflight.has(src)) return inflight.get(src);
    const job = (async () => {
        const local = src.startsWith("blob:") || src.startsWith("data:") || isSameOrigin(src);
        let payload = local && el ? { dataUrl: extractFromElement(el) } : { src };
        if (local && !payload.dataUrl) payload = { src };
        for (let attempt = 0; attempt < 6; attempt++) {
            const r = await send(api, { type: MSG.DETECT_IMAGE, ...payload });
            if (r?.analysis) {
                cacheVerdict(src, r.analysis);
                return r.analysis;
            }
            if (r?.error === "fetch" && el && !payload.dataUrl) {
                // المحرك لم يستطع جلب الصورة: نجرب استخراجها من الصفحة
                const dataUrl = extractFromElement(el);
                if (dataUrl) { payload = { dataUrl }; continue; }
                return { analyzed: false, error: true };
            }
            await sleep(300 * (attempt + 1)); // المحرك يُحمَّل
        }
        return { analyzed: false, error: true };
    })();
    inflight.set(src, job);
    try { return await job; } finally { inflight.delete(src); }
}

function isSameOrigin(src) {
    try { return new URL(src, location.href).origin === location.origin; } catch { return false; }
}

/** صغيرة فعلًا: بأبعادها الأصلية وبحجم عرضها معًا (صورة صغيرة تُعرض مكبّرة ليست أيقونة). */
function isTiny(img) {
    const w = img.naturalWidth || img.width || img.clientWidth;
    const h = img.naturalHeight || img.height || img.clientHeight;
    if (!(w > 0 && h > 0 && (w < MIN_SIZE || h < MIN_SIZE))) return false;
    const r = img.getBoundingClientRect?.();
    return !r || (r.width < MIN_SIZE * 2 && r.height < MIN_SIZE * 2);
}

/** أيقونة SVG صغيرة العرض؛ الكبيرة تُرسم على لوحة وتُفحص كصورة. */
function isIcon(src, img) {
    if (!(/\.svg(\?|#|$)/i.test(src) || src.startsWith("data:image/svg"))) return false;
    const r = img?.getBoundingClientRect?.();
    return !r || (r.width < 160 && r.height < 160);
}

/** يرسم عنصر الصورة على لوحة (SVG مثلًا) ليُفحص؛ null إن منع المتصفح القراءة. */
function rasterize(img) {
    try {
        const r = img.getBoundingClientRect();
        const w = Math.min(640, Math.max(64, Math.round(r.width))), h = Math.min(640, Math.max(64, Math.round(r.height)));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        return c.toDataURL("image/jpeg", 0.8);
    } catch { return null; }
}

async function processImage(img) {
    const src = img.currentSrc || img.src;
    if (!src) return; // لا مصدر بعد: يبقى مضبّبًا وننتظر تغيّر المصدر
    if (img.dataset.hisnSrc === src && img.getAttribute(ATTR) !== "pending") return;
    img.dataset.hisnSrc = src;
    img.dataset.hisnKey = src;
    if (!img.hasAttribute(ATTR)) setMediaState(img, "pending");
    if (!img.complete || !img.naturalWidth) {
        await new Promise((res) => {
            img.addEventListener("load", res, { once: true });
            img.addEventListener("error", res, { once: true });
        });
        if ((img.currentSrc || img.src) !== src) return; // تغيّر المصدر أثناء الانتظار
    }
    if (!img.naturalWidth) return; // صورة لم تُحمَّل: تبقى مضبّبة
    if (isTiny(img) || isIcon(src, img)) return setMediaState(img, "ok");
    img.dataset.hisnUserKey = await keyOf(src);
    const svg = /\.svg(\?|#|$)/i.test(src) || src.startsWith("data:image/svg");
    const analysis = svg ? await analyzeDataUrl(src, rasterize(img)) : await analyze(src, img);
    if ((img.currentSrc || img.src) !== src) return;
    if (analysis.error) {
        // تبقى مغطاة، ونعيد المحاولة لاحقًا (المحرك قد يكون مشغولًا أو أُعيد تشغيله)
        setMediaState(img, "error", "error");
        return retryLater(img, () => { img.dataset.hisnSrc = ""; processImage(img); });
    }
    applyDecision(img, analysis);
}

/** صورة مرسومة محليًا (SVG كبير): تُفحص من اللوحة؛ إن تعذّر رسمها تبقى مغطاة (لا نفترض السلامة). */
async function analyzeDataUrl(src, dataUrl) {
    if (!dataUrl) return { analyzed: false, error: true };
    if (verdictCache.has(src)) return verdictCache.get(src);
    const r = await send(api, { type: MSG.DETECT_IMAGE, dataUrl });
    if (r?.analysis) { cacheVerdict(src, r.analysis); return r.analysis; }
    return { analyzed: false, error: true };
}

const RETRY_DELAYS = [3000, 8000, 20000];
function retryLater(el, again) {
    const n = Number(el.dataset.hisnRetry ?? 0);
    if (n >= RETRY_DELAYS.length) return;
    el.dataset.hisnRetry = String(n + 1);
    setTimeout(() => { if (el.isConnected) again(); }, RETRY_DELAYS[n]);
}

const BG_URL = /url\((['"]?)(.*?)\1\)/;

async function processBackground(el) {
    if (el.dataset.hisnBgChecked) return;
    const bg = el.style.backgroundImage || getComputedStyle(el).backgroundImage;
    const m = bg && bg !== "none" ? bg.match(BG_URL) : null;
    if (!m || el.offsetWidth < 120 || el.offsetHeight < 120 || isIcon(m[2], el)) return;
    el.dataset.hisnBgChecked = "1";
    const src = new URL(m[2], location.href).href;
    if (el.dataset.hisnKey && el.dataset.hisnKey !== src) delete el.dataset.hisnRevealedFor;
    el.dataset.hisnKey = src;
    el.setAttribute("data-hisn-bg", "pending");
    el.dataset.hisnUserKey = await keyOf(src);
    const analysis = await analyze(src, null);
    if (analysis.error) {
        el.setAttribute("data-hisn-bg", "error");
        el.dataset.hisnReason = "error";
        return retryLater(el, () => { delete el.dataset.hisnBgChecked; processBackground(el); });
    }
    applyDecision(el, analysis, { isBg: true });
}

// نفحص فقط ما اقترب من الشاشة، لتوفير الجهد
const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        dispatch(e.target);
    }
}, { rootMargin: "1200px 0px" });

function dispatch(el) {
    if (el.tagName === "IMG") processImage(el);
    else if (el.tagName === "VIDEO") watchVideo(el, settings);
    else processBackground(el);
}

/** يسجّل عنصرًا للفحص عند اقترابه من الشاشة. */
export function observeMedia(el) {
    if (!settings) return;
    if (el.tagName === "IMG" && settings.filterImages) io.observe(el);
    else if (el.tagName === "VIDEO" && settings.filterVideos) io.observe(el);
    else if (settings.filterImages && el.nodeType === 1 && el.style?.backgroundImage?.includes("url(")) io.observe(el);
}

/** عند تغيّر مصدر صورة موجودة (srcset أو src). */
export function mediaSourceChanged(el) {
    if (el.tagName === "IMG") {
        // إظهار سابق لا يمتد إلى صورة جديدة في العنصر نفسه
        if (el.getAttribute(ATTR) !== "revealed" || !revealStillValid(el)) { delete el.dataset.hisnRevealedFor; setMediaState(el, "pending"); }
        processImage(el);
    } else if (el.tagName === "VIDEO") {
        watchVideo(el, settings);
    }
}

/** المقاطع التي أظهرها المستخدم في هذه الصفحة: المواقع تعيد بناء عنصر الفيديو (الريلز تدور، تغيّر الجودة)،
 * فنتذكر المقطع بمفتاح مصدره ونعيد قرار الإظهار للعنصر الجديد بدل أن يعود مغبّشًا. */
const revealedVideos = new Set();
const pathOf = (src) => { if (!src) return ""; try { const u = new URL(src); return u.origin + u.pathname; } catch { return src.slice(0, 200); } };
/** مفاتيح المقطع: مصدره، وغلافه (الغلاف ثابت حين يبدّل الموقع جودة المقطع فيتغيّر مصدره) */
export function videoKeys(v) {
    const keys = [pathOf(v.currentSrc || v.src || ""), pathOf(v.poster || "")];
    try {
        const vr = v.getBoundingClientRect();
        let host = v.parentElement;
        for (let i = 0; host && i < 3; i++, host = host.parentElement) {
            for (const img of host.querySelectorAll("img")) {
                const r = img.getBoundingClientRect();
                const ox = Math.max(0, Math.min(r.right, vr.right) - Math.max(r.left, vr.left));
                const oy = Math.max(0, Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top));
                if (vr.width && ox * oy >= vr.width * vr.height * 0.6 && img.currentSrc) keys.push("img:" + pathOf(img.currentSrc));
            }
        }
    } catch { /* عنصر خارج الصفحة */ }
    return keys.filter(Boolean);
}
export function rememberRevealedVideo(v) { for (const k of videoKeys(v)) revealedVideos.add(k); }
/** مقاطع حكمت لقطاتها بالحجب في هذه الصفحة: لا «ظهور سريع» لها بعد إعادة بناء العنصر */
const blockedVideos = new Set();
export function rememberBlockedVideo(v) { for (const k of videoKeys(v)) blockedVideos.add(k); }
export function wasBlocked(v) { return videoKeys(v).some((k) => blockedVideos.has(k)); }
export function wasRevealed(v) { return videoKeys(v).some((k) => revealedVideos.has(k)); }

/** إعادة فحص عنصر تعذّر فحصه (أو لم يُفحص): يعود «قيد الفحص» ثم يُحكم عليه من جديد. */
export function retryMedia(el) {
    delete el.dataset.hisnRetry;
    if (el.hasAttribute("data-hisn-bg") && el.tagName !== "IMG" && el.tagName !== "VIDEO") {
        delete el.dataset.hisnBgChecked;
        el.setAttribute("data-hisn-bg", "pending");
        return processBackground(el);
    }
    if (el.tagName === "IMG") {
        if (el.dataset.hisnKey) verdictCache.delete(el.dataset.hisnKey);
        el.dataset.hisnSrc = "";
        setMediaState(el, "pending");
        return processImage(el);
    }
    if (el.tagName === "VIDEO") { setMediaState(el, "pending"); watchVideo(el, settings); }
}
/** إعادة فحص كل ما تعذّر فحصه في الصفحة (من شاشة «حالة الحماية» في التطبيق). */
export function retryAllErrors() {
    let n = 0;
    for (const el of document.querySelectorAll(`[${ATTR}="error"], [data-hisn-bg="error"]`)) { retryMedia(el); n++; }
    return n;
}

/** وصف قصير للصورة لشاشة الاستثناءات وطلبات المراجعة (نص البديل أو البطاقة؛ لا رابط الصورة). */
function shortLabel(el) { return (labelOf(el) || "").replace(/\s+/g, " ").trim().slice(0, 80); }

/** ما يحدث عند الضغط على صورة محجوبة. */
export async function onHiddenMediaClick(el, x, y) {
    const reason = el.dataset.hisnReason;
    const isAwrah = reason === "nudity" || reason === "sexual";
    // تعذّر الفحص ليس حكمًا بالمخالفة: يبقى مغطى احتياطًا، والخيار الأول إعادة المحاولة
    const failed = reason === "error" || reason === "not-analyzed";
    const attr = el.hasAttribute("data-hisn-bg") ? "data-hisn-bg" : ATTR;
    const key = el.dataset.hisnUserKey;
    const meta = { host: location.hostname.replace(/^www\./, ""), label: shortLabel(el) };
    const reveal = async () => {
        if (settings.lockEnabled && !(await askPin(x, y))) return;
        if (isAwrah && !confirm("هذا المحتوى صُنّف عورة أو محتوى غير لائق. هل تريد إظهاره؟")) return;
        markRevealed(el, attr);
        if (el.tagName === "VIDEO") { el.dataset.hisnRevealed = "1"; rememberRevealedVideo(el); }
    };
    const markSafe = async () => {
        let r = await send(api, { type: MSG.REPORT_VERDICT, key, verdict: "safe", ...meta });
        // مع القفل: لا يُعدّ سليمًا ولا يظهر إلا بعد الرمز الصحيح
        if (!r?.ok && (await askPin(x, y))) {
            r = await send(api, { type: MSG.REPORT_VERDICT, key, verdict: "safe", ...meta });
        }
        if (r?.ok) markRevealed(el, attr, "ok");
        else showPopover(x, y, "لم يُحفظ التصحيح", "تعذّر حفظه الآن. يمكنك إظهارها مرة واحدة بدلًا من ذلك.", [{ label: "حسنًا", run: () => {} }]);
    };
    const requestReview = async () => {
        const r = await send(api, { type: MSG.REQUEST_REVIEW, key: key || "", ...meta, page: location.href.slice(0, 500) });
        showPopover(x, y, r?.ok ? "أُرسل الطلب ✅" : "لم يُرسل الطلب", r?.ok ? "سيراجعه ولي الأمر في حصن ويقرر. يبقى مخفيًا حتى ذلك." : "حاول مرة أخرى لاحقًا.", [{ label: "حسنًا", run: () => {} }]);
    };
    const actions = [];
    if (failed) actions.push({ label: "أعد الفحص", primary: true, run: () => retryMedia(el) });
    // مع القفل: العورة لا تُكشف أبدًا
    if (!(isAwrah && settings.lockEnabled)) actions.push({ label: el.tagName === "VIDEO" ? "إظهار هذا المقطع الآن" : "إظهار هذه الصورة مرة", primary: !failed, run: reveal });
    if (!isAwrah && !failed && key && !settings.childMode) actions.push({ label: "سليمة دائمًا (على هذا الجهاز)", run: markSafe });
    // وضع الطفل في تطبيق الآيفون: طلب مراجعة يُحفظ على الجهاز، دون فتح المحتوى
    if (settings.childMode && !isAwrah && globalThis.webkit?.messageHandlers?.hisn) actions.push({ label: "اطلب من ولي الأمر مراجعتها", run: requestReview });
    actions.push({ label: "إبقاؤه مخفيًا", run: () => {} });
    showPopover(x, y, failed ? "تعذّر فحص هذا المحتوى" : "محتوى مُغطّى",
        failed ? "لم يُحكم بأنه مخالف؛ بقي مغطى احتياطًا لأن الفحص لم يكتمل." : reasonText(reason), actions);
}

/** "إخفاء هذه الصورة" من القائمة: تصحيح المستخدم بأنها مخالفة. */
export async function hideBySrc(src) {
    for (const el of document.querySelectorAll("img, video")) {
        if ((el.currentSrc || el.src) === src) {
            const key = el.dataset.hisnUserKey || (await keyOf(src));
            await send(api, { type: MSG.REPORT_VERDICT, key, verdict: "unsafe" });
            setMediaState(el, "cover", "manual");
        }
    }
}

/**
 * «شيء غير مناسب ظهر»: شريط أعلى الصفحة، والضغطة التالية على صورة أو فيديو أو خلفية تخفيه
 * (ويُحفظ أنه غير آمن). Esc أو «إلغاء» ينهي الوضع.
 */
export function startPickHide() {
    if (document.querySelector(".hisn-pick-bar")) return;
    const bar = document.createElement("div");
    bar.className = "hisn-ui hisn-pick-bar";
    bar.setAttribute("dir", "rtl");
    bar.style.cssText = "position:fixed;top:0;inset-inline:0;z-index:2147483646;background:#6d28d9;color:#fff;font:15px system-ui,sans-serif;padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;box-shadow:0 2px 8px #0003";
    const msg = document.createElement("span");
    msg.textContent = "اضغط على الصورة أو الفيديو غير المناسب لإخفائه";
    const cancel = document.createElement("button");
    cancel.textContent = "إلغاء";
    cancel.style.cssText = "font:inherit;border:1px solid #fff;background:none;color:#fff;border-radius:8px;padding:4px 14px;cursor:pointer";
    bar.append(msg, cancel);
    document.documentElement.appendChild(bar);
    const done = () => {
        bar.remove();
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
    };
    const pick = (t) => {
        for (let el = t; el && el !== document.documentElement; el = el.parentElement) {
            if (el.tagName === "IMG" || el.tagName === "VIDEO" || el.hasAttribute?.("data-hisn-bg")) return el;
            const inner = el.querySelector?.("img, video");
            if (inner && el.offsetWidth <= inner.offsetWidth * 1.5) return inner;
        }
        return null;
    };
    const onClick = async (e) => {
        if (e.composedPath().includes(bar)) { if (e.target === cancel) done(); return; }
        const el = pick(e.target);
        if (!el) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        done();
        const src = el.currentSrc || el.src || el.dataset.hisnKey || "";
        const key = el.dataset.hisnUserKey || (src ? await keyOf(src) : null);
        if (el.hasAttribute("data-hisn-bg")) { el.setAttribute("data-hisn-bg", "cover"); el.dataset.hisnReason = "manual"; }
        else setMediaState(el, "cover", "manual");
        if (key) await send(api, { type: MSG.REPORT_VERDICT, key, verdict: "unsafe" });
    };
    const onKey = (e) => { if (e.key === "Escape") done(); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
}
