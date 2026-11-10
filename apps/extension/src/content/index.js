// نقطة بدء الإضافة في كل صفحة وكل إطار داخلي.
import { api, extensionDefaults, listHasSite } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";
import { installBaseStyle, removeBaseStyle, installClickGuard, baseCss, installTamperGuard, clearAllVideoOverlays } from "./ui.js";
import { setPartial as debugSetPartial } from "./ui.js";
import { installCleanup } from "./cleanup.js";
installCleanup();
// للتجربة الآلية من الماك فقط (داخل التطبيق): فرض تغطية جزئية على أول مقطع للتحقق من رسمها
// شاشة «حالة الحماية في هذه الصفحة» في التطبيق: أعداد بلا محتوى، وإعادة فحص ما تعذّر
if (globalThis.webkit?.messageHandlers?.hisn) {
    globalThis.__hisnStatus = () => {
        const q = (sel) => document.querySelectorAll(sel).length;
        return JSON.stringify({
            active,
            hidden: q('[data-hisn="cover"], [data-hisn="blur"], [data-hisn-bg="cover"], [data-hisn-bg="blur"]'),
            partial: q('[data-hisn="partial"]'),
            error: q('[data-hisn="error"], [data-hisn-bg="error"]'),
            pending: q('[data-hisn="pending"], [data-hisn-bg="pending"]'),
            folded: q("[data-hisn-ad=folded], [data-hisn-xr=folded], [data-hisn-xr=hidden], [data-hisn-fold]:not([data-hisn-fold=revealed])"),
            songMuted: q("video[data-hisn-song]"),
            earMuted: q("video[data-hisn-ear]"),
            revealed: q('[data-hisn="revealed"], [data-hisn-bg="revealed"]'),
        });
    };
    globalThis.__hisnRetryErrors = () => retryAllErrors();
}
if (globalThis.webkit?.messageHandlers?.hisn) globalThis.__hisnDebugPartial = (boxes) => { const v = document.querySelector("video"); if (v) { v.dataset.hisnDebugHold = "1"; debugSetPartial(v, boxes.map((b) => ({ box: b, reason: "woman" }))); } return Boolean(v); };
import { configureText, processTextTree, processTextNode, applyHiddenAccounts } from "./text.js";
import { configureMedia, observeMedia, mediaSourceChanged, onHiddenMediaClick, hideBySrc, startPickHide, retryAllErrors } from "./media.js";
import { updateVideoSettings, stopVideoMonitors } from "./video.js";
import { configureAudio, watchAudio, watchLiveCaptions, suspendAudio } from "./audio.js";
import { configureTopics, scanTopics } from "./topics.js";
import { configureSongs } from "./songs.js";
import { configureAudioTracks } from "./audiotracks.js";
import { configureAds } from "./ads.js";
import { configureEar } from "./ear.js";
import { configureKidsYouTube } from "./kidsyt.js";
import { configureChannels } from "./channels.js";
import { configureActivity } from "./activity.js";
import { configureXReddit } from "./xreddit.js";

// 1) قبل أي شيء: نضبّب الوسائط فورًا بالإعدادات الافتراضية، حتى لا يظهر شيء قبل وصول الإعدادات
installBaseStyle(extensionDefaults("male"));

let settings = null;
let active = false;
let observer = null;
let guardInstalled = false;
const shadowRoots = new WeakSet();

let resumeTimer = null;
function siteDisabled(s) {
    clearTimeout(resumeTimer);
    // إيقاف مؤقت لهذا الموقع: تعود الحماية تلقائيًا عند انتهائه
    const host = location.hostname.replace(/^www\./, "");
    const until = Object.entries(s.pausedSites ?? {}).find(([site]) => host === site || host.endsWith("." + site))?.[1] ?? 0;
    if (until > Date.now()) resumeTimer = setTimeout(() => apply(settings), until - Date.now() + 50);
    return !s.enabled || listHasSite(s.disabledSites ?? [], location.hostname) || until > Date.now();
}

function apply(s) {
    settings = s;
    if (siteDisabled(s)) {
        active = false;
        configureSongs({});
        configureAudioTracks({});
        configureAds({});
        configureEar({});
        configureKidsYouTube({});
        configureChannels({});
        configureActivity({});
        configureXReddit({});
        // إيقاف شامل (لا تبقى مراقبة إطارات أو كتم أو صناديق تغطية بعد التعطيل)
        stopVideoMonitors();
        suspendAudio();
        clearAllVideoOverlays();
        removeBaseStyle();
        observer?.disconnect();
        observer = null;
        return;
    }
    active = true;
    installBaseStyle(s);
    configureText(s);
    configureMedia(s);
    updateVideoSettings(s);
    configureAudio(s);
    configureTopics(s);
    configureSongs(s);
    configureAudioTracks(s);
    configureAds(s);
    configureEar(s);
    configureKidsYouTube(s);
    configureChannels(s);
    configureActivity(s);
    configureXReddit(s);
    start();
}

// ===== المسح =====
const MEDIA_SELECTOR = "img, video, [style*='background']";

function scan(root) {
    if (!active || !root) return;
    if (root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11) {
        if (root.matches?.(MEDIA_SELECTOR)) observeMedia(root);
        for (const el of root.querySelectorAll?.(MEDIA_SELECTOR) ?? []) observeMedia(el);
        if (root.matches?.("video, audio")) watchAudio(root);
        for (const el of root.querySelectorAll?.("video, audio") ?? []) watchAudio(el);
        if (root.nodeType === 1) watchLiveCaptions(root);
        processTextTree(root);
        applyHiddenAccounts(root, location.hostname);
        scanTopics(root);
        scanShadows(root);
    } else if (root.nodeType === 3) {
        processTextNode(root);
        scanTopics(root);
        if (root.parentElement) watchLiveCaptions(root.parentElement);
    }
}

/** الصفحات الحديثة (مثل ريديت) تخفي محتواها داخل Shadow DOM، فنراقبه أيضًا. */
function scanShadows(root) {
    const all = root.querySelectorAll?.("*") ?? [];
    for (const el of all) {
        const sr = el.shadowRoot;
        if (sr && !shadowRoots.has(sr)) {
            shadowRoots.add(sr);
            const style = document.createElement("style");
            style.className = "hisn-shadow-style";
            style.textContent = baseCss();
            sr.appendChild(style);
            observer.observe(sr, OBS_OPTIONS);
            scan(sr);
        }
    }
}

// نجمع التغييرات ونعالجها دفعات صغيرة (≤ 8 مللي ثانية ثم نترك الصفحة ترسم)، حتى لا نثقل التمرير.
// التأجيل آمن: الصور والمقاطع الجديدة مخفية بالأنماط الأساسية حتى تُفحص.
let pending = new Set();
let scheduled = false;
const BUDGET_MS = 8;
const defer = (fn) => (globalThis.requestIdleCallback ? requestIdleCallback(fn, { timeout: 150 }) : setTimeout(fn, 0));
// تكلفة كود حصن في الصفحة (للقياس): مجموع المللي ثانية وعدد الدفعات، تُكتب على <html> ليقرأها المسبار
const cost = { ms: 0, flushes: 0, maxFlush: 0 };
function queue(node) {
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    defer(flush);
}
function flush() {
    scheduled = false;
    const t0 = performance.now();
    const rest = new Set();
    for (const n of pending) {
        if (performance.now() - t0 > BUDGET_MS) { rest.add(n); continue; }
        if (n.isConnected) scan(n);
    }
    pending = rest;
    const dt = performance.now() - t0;
    cost.ms += dt; cost.flushes++; cost.maxFlush = Math.max(cost.maxFlush, dt);
    if (pending.size) { scheduled = true; defer(flush); }
}
setInterval(() => { try { document.documentElement.dataset.hisnCost = `${Math.round(cost.ms)}ms/${cost.flushes}/${Math.round(cost.maxFlush)}`; } catch { /* لا DOM */ } }, 2000);

const OBS_OPTIONS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "style", "poster"],
};

function onMutations(mutations) {
    for (const m of mutations) {
        if (m.type === "childList") {
            for (const n of m.addedNodes) {
                if (n.nodeType === 1 && n.classList?.contains("hisn-ui")) continue;
                queue(n);
            }
        } else if (m.type === "characterData") {
            queue(m.target);
        } else if (m.type === "attributes") {
            const el = m.target;
            if (el.tagName === "IMG" || el.tagName === "VIDEO") {
                if (m.attributeName === "src" || m.attributeName === "srcset") mediaSourceChanged(el);
            } else if (m.attributeName === "style") {
                delete el.dataset.hisnBgChecked;
                observeMedia(el);
            }
        }
    }
}

function start() {
    if (observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document, OBS_OPTIONS);
    const initial = () => scan(document);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initial, { once: true });
    else initial();
    if (!guardInstalled) {
        guardInstalled = true;
        installClickGuard(onHiddenMediaClick);
        installTamperGuard();
    }
}

// ===== الإعدادات =====
send(api, { type: MSG.GET_SETTINGS }).then((s) => {
    // إذا تعذّر الوصول للخلفية نبقى بالإعدادات الافتراضية (الأكثر حماية)
    apply(s ?? extensionDefaults("male"));
});

api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "hisn:hide-src") hideBySrc(msg.src);
    if (msg?.type === MSG.PICK_HIDE && window === window.top) startPickHide();
    // الإعدادات تصل من الخلفية (لا نقرأ التخزين من الصفحة)
    if (msg?.type === MSG.SETTINGS_CHANGED && msg.settings) {
        const wasActive = active;
        apply(msg.settings);
        if (active && !wasActive) scan(document);
    }
});
