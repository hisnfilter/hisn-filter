// كتم الموسيقى «بالسماع» (في التطبيق فقط): بدل الاعتماد على اسم الصوت المكتوب، يطلب من التطبيق أن يسمع
// أول ثوانٍ من المقطع (يقرأ صوته من رابطه مباشرة ويمرّره على YAMNet في الجهاز) فإن سمع آلات أو موسيقى
// واضحة كُتم المقطع كله. إنشاد أو تلاوة أو كلام بلا آلات لا يُكتم. حكم كل مقطع يُحفظ فلا يُعاد تحليله.
// خفيف على البطارية: مقطع ظاهر ويعمل فقط، وطلب واحد لكل مقطع.
import { isOnScreen } from "./adapters.js";
import { songHint } from "@hisn/core";

const HOSTS = /(^|\.)(instagram|tiktok|facebook|youtube)\.com$/;
let on = false;
let timer = null;
const verdicts = new Map(); // src → true (موسيقى) | false | "pending"
const allowed = new Set(); // المستخدم ضغط «ليست موسيقى»
let logged = 0;
// يوتيوب: المقطع يصل بصيغة blob (لا رابط مباشر)، فنأخذ من مشغّل يوتيوب تصنيف المقطع ورابط مساره الصوتي (yt-main.js)
const YT = /(^|\.)youtube\.com$/.test(location.hostname);
let yt = { videoId: "", category: "", audioUrl: "" };
if (YT) {
    window.addEventListener("message", (e) => {
        if (e.source !== window || e.data?.source !== "hisn-yt-music") return;
        yt = { videoId: String(e.data.videoId || ""), category: String(e.data.category || ""), audioUrl: String(e.data.audioUrl || ""), title: String(e.data.title || ""), author: String(e.data.author || ""), keywords: Array.isArray(e.data.keywords) ? e.data.keywords : [] };
    });
}

export function configureEar(s) {
    on = Boolean(s.enabled && s.muteMusicByEar === true && globalThis.webkit?.messageHandlers?.hisn && HOSTS.test(location.hostname));
    clearInterval(timer);
    timer = null;
    if (!on) {
        for (const v of document.querySelectorAll("video[data-hisn-ear]")) release(v);
        return;
    }
    timer = setInterval(tick, 700);
}

function keyOf(v) {
    if (YT) return yt.videoId && v.closest("#movie_player, #player") ? "yt:" + yt.videoId : null;
    const src = v.currentSrc || v.src || "";
    if (!/^https?:/.test(src)) return null;
    // رابط إنستغرام فيه معاملات تتغير؛ المسار يكفي مفتاحًا
    try { const u = new URL(src); return u.origin + u.pathname; } catch { return src; }
}

function tick() {
    for (const v of document.querySelectorAll("video")) {
        const key = keyOf(v);
        if (!key) continue;
        const verdict = verdicts.get(key);
        if (verdict === true) {
            // موسيقى: يبقى مكتومًا ما لم يسمح المستخدم (المنصة قد تعيد الصوت عند التمرير)
            if (allowed.has(key)) { release(v); continue; }
            if (!v.dataset.hisnEar) v.dataset.hisnEarWas = v.muted ? "muted" : "";
            if (!v.muted) v.muted = true;
            if (!v.dataset.hisnEar) { v.dataset.hisnEar = "1"; badge(v, key); }
            continue;
        }
        if (verdict !== undefined) continue;
        // مشغّل يوتيوب صغير (ثلث الشاشة): يكفي أن يكون ظاهرًا
        const visible = YT ? (() => { const b = v.getBoundingClientRect(); return b.height > 80 && b.bottom > 0 && b.top < innerHeight; })() : isOnScreen(v);
        if (v.paused || !visible) continue;
        // يوتيوب: لا رابط ملف يمكن سماعه (بث مشفّر المعاملات)، فنكتفي بتصنيف يوتيوب نفسه للمقطع: «Music» ← كتم
        // يوتيوب: لا يمكن سماع الصوت على الآيفون، فنحكم بتصنيف يوتيوب «Music» أو بدلالة العنوان/الكلمات المفتاحية (أغنية، كليب، lyrics…)
        if (YT) {
            const hint = songHint(yt);
            if (yt.category === "Music" || hint.hit) { verdicts.set(key, true); if (logged++ < 30) diag(`ear: youtube ${yt.category === "Music" ? "category Music" : "song hint " + hint.why}`); }
            else verdicts.set(key, false);
            continue;
        }
        verdicts.set(key, "pending");
        listen(v, key);
    }
}

async function listen(v, key, override) {
    let r = null;
    try {
        r = await globalThis.webkit.messageHandlers.hisn.postMessage({ type: "hisn:listen-video", src: override ? "" : (v.currentSrc || v.src), data: override?.data, key: override?.key, page: location.href });
        if (typeof r === "string") r = JSON.parse(r);
    } catch { /* التطبيق لم يرد */ }
    // تعذّر (لا مسار صوتي، أو مهلة): لا نعيد المحاولة لهذا المقطع — يبقى على الكتم بالاسم المكتوب
    if (!on) return; // الحماية أُوقفت أثناء الاستماع: نتيجة قديمة لا تُطبّق
    if (!r || r.error) { verdicts.set(key, false); if (logged++ < 5) diag(`ear: no verdict (${r?.error || "none"})`); return; }
    verdicts.set(key, Boolean(r.music));
    if (verdicts.size > 300) verdicts.delete(verdicts.keys().next().value);
    if (logged++ < 30) diag(`ear: ${r.music ? "music" : "clean"} ${r.reason || ""} windows=${r.windows ?? "?"} in ${r.ms ?? "?"}ms`);
    if (r.music && !allowed.has(key) && v.isConnected && keyOf(v) === key) { if (!v.dataset.hisnEar) v.dataset.hisnEarWas = v.muted ? "muted" : ""; v.muted = true; v.dataset.hisnEar = "1"; badge(v, key); }
}

function release(v) {
    if (!v.dataset.hisnEar) return;
    delete v.dataset.hisnEar;
    if (v.dataset.hisnEarWas !== "muted" && !v.dataset.hisnSong) v.muted = false;
    delete v.dataset.hisnEarWas;
    v.parentElement?.querySelector(":scope > .hisn-ear-badge")?.remove();
}

/** شارة فوق المقطع: الكتم مقصود. الضغط = «ليست موسيقى»: يعيد الصوت ويتذكر المقطع. */
function badge(v, key) {
    const host = v.parentElement;
    if (!host || host.querySelector(":scope > .hisn-ear-badge")) return;
    const b = document.createElement("button");
    b.className = "hisn-ui hisn-ear-badge";
    b.textContent = "🔇 كُتمت الموسيقى · ليست موسيقى؟";
    b.setAttribute("style", "position:absolute;top:12px;inset-inline-start:12px;z-index:2147483646;background:rgba(109,40,217,.9);color:#fff;border:0;font:600 12px/1.6 system-ui,-apple-system,sans-serif;padding:4px 12px;border-radius:999px;cursor:pointer");
    b.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        allowed.add(key);
        release(v);
        diag("ear: user marked not-music");
    };
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(b);
}

function diag(text) {
    globalThis.webkit?.messageHandlers?.hisn?.postMessage({ type: "hisn:log", text })?.catch?.(() => {});
}

export const _test = { keyOf, verdicts };
