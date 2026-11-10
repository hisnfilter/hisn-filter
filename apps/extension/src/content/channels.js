// «القنوات المسموحة» في يوتيوب (وضع الطفل): قائمة بيضاء يختارها ولي الأمر؛ مع تفعيلها لا يظهر في الرئيسية والبحث
// والمقترحات إلا مقاطع هذه القنوات (البطاقة تُحذف كاملة)، والمقطع المفتوح من قناة أخرى يُوقَف برسالة.
// التعرّف على القناة: رابط القناة في البطاقة (/@handle أو /channel/ID) ثم اسمها المكتوب. لا شيء يُرسل.
import { MSG, send } from "../shared/messages.js";
import { api } from "../shared/settings.js";
import { askPin } from "./ui.js";
import { bump } from "./activity.js";

const YT_HOST = /(^|\.)youtube\.com$/;
const CARDS = [
    "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer", "ytd-grid-video-renderer", "yt-lockup-view-model",
    "ytm-video-with-context-renderer", "ytm-compact-video-renderer", "ytm-rich-item-renderer", "ytm-media-item", "ytm-video-card-renderer",
    "ytm-compact-autoplay-renderer", "ytm-shorts-lockup-view-model", "ytm-shorts-lockup-view-model-v2", "ytd-reel-item-renderer",
    "ytm-compact-channel-renderer", "ytm-channel-renderer", "ytd-channel-renderer", "ytm-compact-playlist-renderer", "ytd-playlist-renderer",
    "ytm-lockup-view-model", "ytm-video-card-view-model", "ytm-item-section-renderer > div > ytm-video-with-context-renderer",
].join(",");
const BYLINE = [
    'a[href^="/@"]', 'a[href^="/channel/"]', 'a[href*="/@"]', "ytm-badge-and-byline-renderer", ".ytm-badge-and-byline-renderer",
    "ytd-channel-name", "#channel-name", ".ytd-channel-name", "yt-content-metadata-view-model .yt-core-attributed-string", ".media-item-metadata .yt-core-attributed-string",
    "ytm-channel-name", ".ytm-video-with-context-renderer .subhead",
].join(",");

let enabled = false;
let only = false;
let list = [];
let timer = null;
let hiddenCount = 0;
let lastWatch = "";

export function configureChannels(s) {
    list = Array.isArray(s.allowedChannels) ? s.allowedChannels.filter((c) => c && (c.handle || c.name)).map(norm) : [];
    only = Boolean(s.enabled && s.childMode && s.allowedChannelsOnly && list.length > 0 && YT_HOST.test(location.hostname));
    enabled = Boolean(s.enabled && s.childMode && YT_HOST.test(location.hostname));
    clearInterval(timer);
    timer = null;
    if (!only) { document.querySelector(".hisn-channels-chip")?.remove(); hideNotice(); }
    for (const el of document.querySelectorAll('[data-hisn-channel-seen]')) delete el.dataset.hisnChannelSeen;
    if (!enabled) return;
    timer = setInterval(tick, 900);
    tick();
}

function norm(c) {
    return { name: String(c.name || "").trim().toLowerCase(), handle: String(c.handle || "").trim().toLowerCase().replace(/^@/, "") };
}

/** القناة المكتوبة على البطاقة: {handle, name} — المعرّف من رابط القناة، والاسم من سطر البايلاين (قبل •) لا من العنوان */
const BYLINE_EL = "ytm-badge-and-byline-renderer, .ytm-badge-and-byline-renderer, ytd-channel-name #text, #channel-name, .ytm-channel-name, ytm-channel-name, yt-content-metadata-view-model";
function channelOf(card) {
    let handle = "", name = "";
    for (const a of card.querySelectorAll('a[href]')) {
        const m = (a.getAttribute("href") || "").match(/\/(@[^/?#]+|channel\/[^/?#]+)/);
        if (m) { handle = m[1].replace(/^@/, "").toLowerCase(); break; }
    }
    const by = card.querySelector(BYLINE_EL);
    if (by) name = (by.textContent || "").split(/[•·]/)[0].replace(/\s+/g, " ").trim().toLowerCase();
    if (!name) {
        const t = (card.textContent || "").replace(/\s+/g, " ");
        const m = t.match(/([^•·|]{2,40})\s*[•·]\s*[\d.,]+\s*[KMB]?\s*(views|مشاهد)/i);
        if (m) name = m[1].trim().toLowerCase();
    }
    if (name.length > 60) name = "";
    return { handle, name };
}

function allowed(ch) {
    if (!ch.handle && !ch.name) return null; // لا تُعرف قناتها (رف، إعلان): لا نحكم
    const key = (x) => x.replace(/^@/, "").replace(/[\s_.\-]+/g, "").toLowerCase();
    // المعرّف قاطع إن وُجد في الطرفين؛ وإلا تطابق الاسم تمامًا (لا «يبدأ بـ» حتى لا يمرّ عنوان فيه اسم القناة)
    return list.some((c) => (c.handle && ch.handle) ? key(c.handle) === key(ch.handle) : (c.name && ch.name && (key(c.name) === key(ch.name) || (c.handle && key(c.handle) === key(ch.name)) || (ch.handle && key(c.name) === key(ch.handle)))));
}

/** بطاقة مقطع (فيها رابط /watch أو /shorts) لا تُعرف قناتها: في وضع «المسموحة فقط» تُخفى احتياطًا */
function isVideoCard(card) {
    return Boolean(card.querySelector('a[href*="/watch"], a[href^="/shorts/"], a[href*="watch?v="]'));
}

function tick() {
    if (!only) return;
    try { sweep(); } catch (e) { diag("channels: sweep error " + (e?.message || e)); }
    try { chip(); } catch (e) { diag("channels: chip error " + (e?.message || e)); }
    try { checkWatch(); } catch (e) { diag("channels: watch error " + (e?.message || e)); }
}
let diagCount = 0;
function diag(text) {
    if (diagCount++ > 40) return;
    globalThis.webkit?.messageHandlers?.hisn?.postMessage({ type: "hisn:log", text })?.catch?.(() => {});
}

function sweep() {
    for (const card of document.querySelectorAll(CARDS)) {
        if (card.parentElement?.closest(CARDS)) continue; // البطاقة الخارجية فقط
        if (card.getAttribute("data-hisn-topic") === "hidden") continue;
        const sig = (card.textContent || "").replace(/\s+/g, " ").slice(0, 80);
        if (card.dataset.hisnChannelSeen === String(sig)) continue;
        card.dataset.hisnChannelSeen = String(sig);
        const ch = channelOf(card);
        const ok = allowed(ch);
        if (ok === false || (ok === null && isVideoCard(card))) { card.setAttribute("data-hisn-topic", "hidden"); card.dataset.hisnFlagged = ok === null ? "channel?" : "channel"; hiddenCount++; bump("hidden"); }
        else diag(`channels: kept ${card.tagName} h=${ch.handle} n=${ch.name.slice(0, 30)} ok=${ok} video=${isVideoCard(card)}`);
    }
}

/** شريط صغير أعلى الصفحة: ليعرف الطفل والأم أن القائمة تعمل */
function chip() {
    let c = document.querySelector(".hisn-channels-chip");
    const text = `القنوات المسموحة فقط · ${list.length} ${list.length === 1 ? "قناة" : list.length <= 10 ? "قنوات" : "قناة"} · أُخفي ${hiddenCount}`;
    if (c) { if (c.textContent !== text) c.textContent = text; return; }
    c = document.createElement("div");
    c.className = "hisn-channels-chip";
    c.setAttribute("dir", "rtl");
    c.textContent = text;
    c.setAttribute("style", "position:fixed;top:8px;inset-inline-start:50%;transform:translateX(50%);z-index:2147483645;background:rgba(109,40,217,.92);color:#fff;font:600 12px/1.6 system-ui,-apple-system,sans-serif;padding:4px 12px;border-radius:999px;pointer-events:none");
    document.documentElement.appendChild(c);
}

/** المقطع المفتوح: قناته من الصفحة؛ غير مسموحة ← إيقاف ورسالة، مع زر لولي الأمر يسمح بها بالرمز */
function checkWatch() {
    if (!/^\/(watch|shorts\/)/.test(location.pathname)) { hideNotice(); lastWatch = ""; return; }
    const ch = watchChannel();
    const key = location.href + "|" + ch.handle + "|" + ch.name;
    if (!ch.handle && !ch.name) return; // لم تُحمّل بعد
    if (key === lastWatch) return;
    lastWatch = key;
    diag(`channels: watch owner handle=${ch.handle} allowed=${allowed(ch)}`);
    if (allowed(ch) !== false) { hideNotice(); return; }
    for (const v of document.querySelectorAll("video")) { try { v.pause(); } catch { /* */ } }
    bump("stopped");
    showNotice(ch);
}

function watchChannel() {
    // صاحب المقطع: رابط القناة في منطقة المالك (لا في المقترحات أسفل الصفحة)
    const owner = document.querySelector("ytm-slim-owner-renderer, #owner, ytd-video-owner-renderer, ytm-slim-video-metadata-section-renderer, ytm-slim-video-metadata-renderer");
    const a = (owner || document).querySelector('a[href^="/@"], a[href^="/channel/"], a[href*="youtube.com/@"], a[href*="/channel/"]');
    const href = a?.getAttribute?.("href") || "";
    const m = href.match(/\/(@[^/?#]+|channel\/[^/?#]+)/);
    let handle = m ? m[1].replace(/^@/, "").toLowerCase() : "";
    let name = (document.querySelector("ytm-slim-owner-renderer .slim-owner-channel-name, ytm-slim-owner-renderer h3, #owner #channel-name, ytd-channel-name #text, ytm-slim-owner-renderer .yt-core-attributed-string")?.textContent || "").trim().toLowerCase();
    if (!handle) {
        // يوتيوب الجوال الجديد يكتب @المعرّف نصًا تحت المقطع (أعلى الصفحة)
        for (const el of document.querySelectorAll("span, a, div, h3")) {
            if (el.children.length) continue;
            const t = (el.textContent || "").trim();
            if (/^@[A-Za-z0-9._-]{2,40}$/.test(t) && el.getBoundingClientRect().top < innerHeight * 1.5) { handle = t.slice(1).toLowerCase(); break; }
        }
    }
    if (!name && handle) name = handle;
    return { handle, name };
}

let notice = null;
function showNotice(ch) {
    if (notice?.isConnected) return;
    notice = document.createElement("div");
    notice.className = "hisn-ui hisn-channel-notice";
    notice.setAttribute("dir", "rtl");
    notice.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:#2e164f;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font:16px system-ui,-apple-system,sans-serif;text-align:center;padding:28px";
    const title = document.createElement("div");
    title.style.cssText = "font-size:21px;font-weight:700";
    title.textContent = "هذه القناة ليست في القنوات المسموحة";
    const msg = document.createElement("div");
    msg.style.cssText = "color:#d9d2ec;line-height:1.7;max-width:320px";
    msg.textContent = `«${ch.name || "@" + ch.handle}» ليست من القنوات التي اختارها ولي الأمر. لو كان المقطع مناسبًا، اطلب من ماما أو بابا السماح بالقناة.`;
    const back = document.createElement("button");
    back.textContent = "رجوع";
    back.style.cssText = "font:inherit;font-weight:600;padding:12px 32px;border-radius:12px;border:0;background:#6d28d9;color:#fff;cursor:pointer;min-height:48px";
    back.onclick = () => { hideNotice(); history.length > 1 ? history.back() : (location.href = "/"); };
    const allow = document.createElement("button");
    allow.textContent = "ولي الأمر: السماح بهذه القناة (بالرمز)";
    allow.style.cssText = "font:inherit;padding:12px 20px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;cursor:pointer;min-height:48px";
    allow.onclick = async () => {
        if (!(await askPin(innerWidth / 2, innerHeight / 2))) return;
        const r = await allowChannel(ch);
        if (r) { hideNotice(); lastWatch = ""; for (const v of document.querySelectorAll("video")) { try { v.play(); } catch { /* */ } } }
        else { msg.textContent = "تعذّر الحفظ. أضيفي القناة من إعدادات حصن ← القنوات المسموحة."; }
    };
    notice.append(title, msg, back, allow);
    document.documentElement.appendChild(notice);
    notice._t = setInterval(() => { if (notice?.isConnected) for (const v of document.querySelectorAll("video")) if (!v.paused) v.pause(); }, 500);
}
function hideNotice() { if (!notice) return; clearInterval(notice._t); notice.remove(); notice = null; }

/** حفظ القناة في الإعدادات: في التطبيق عبر رسالة خاصة، وفي الإضافة عبر تحديث الإعدادات (كلاهما بعد الرمز) */
async function allowChannel(ch) {
    const entry = { name: ch.name || ch.handle, handle: ch.handle };
    if (globalThis.webkit?.messageHandlers?.hisn) {
        const r = await send(api, { type: "hisn:allow-channel", ...entry });
        if (r?.ok) { list.push(norm(entry)); return true; }
        return false;
    }
    const cur = await send(api, { type: MSG.GET_SETTINGS });
    const next = [...(cur?.allowedChannels ?? []), entry];
    const r = await send(api, { type: MSG.UPDATE_SETTINGS, patch: { allowedChannels: next } });
    if (r?.ok) { list.push(norm(entry)); return true; }
    return false;
}

export const _test = { channelOf, allowed: (ch, l) => { list = l.map(norm); return allowed(ch); } };
