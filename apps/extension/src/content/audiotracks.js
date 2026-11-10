// مسارات الصوت البديلة في يوتيوب: بعض أصحاب القنوات يرفعون مع المقطع مسار صوت ثانيًا (يظهر باسم لغة أخرى
// مثل «Spanish») فيه الكلام نفسه بلا موسيقى. يوتيوب يخفي الخيار في قوائم عميقة؛ حصن يعرضه زرًا واحدًا فوق
// المقطع، ويتذكر اختيار المستخدم لكل قناة فيطبّقه تلقائيًا في مقاطعها التالية.
// القراءة والتبديل يجريان في سياق الصفحة (yt-main.js) عبر رسائل؛ هنا الواجهة والذاكرة فقط.

const KEY = "hisnAudioTrackByChannel";
/** اسم مسار يصرّح أنه بلا موسيقى: يُختار تلقائيًا من أول مقطع (الأسماء الأخرى مثل «Spanish» قد تكون دبلجة حقيقية) */
const CLEAN_NAME = /no\s*music|without\s*music|music\s*free|clean|nasheed|بدون\s*موسيقى|بلا\s*موسيقى|نشيد|أناشيد|اناشيد|بدون\s*معازف/i;
let enabled = false;
let memory = null;
let state = { videoId: "", tracks: [], current: "" };
let appliedFor = "";

export function configureAudioTracks(s) {
    enabled = Boolean(s.enabled) && /(^|\.)youtube\.com$/.test(location.hostname);
    if (!enabled) { document.querySelector(".hisn-track-chip")?.remove(); return; }
    if (!configureAudioTracks.listening) {
        configureAudioTracks.listening = true;
        window.addEventListener("message", onMessage);
    }
}

function onMessage(e) {
    if (!enabled || e.source !== window || e.data?.source !== "hisn-yt-audio") return;
    state = { videoId: e.data.videoId, tracks: e.data.tracks || [], current: e.data.current || "" };
    if (state.tracks.length < 2) { document.querySelector(".hisn-track-chip")?.remove(); return; }
    const ch = channelId();
    const mem = loadMemory();
    // مقطع جديد: طبّق اختيار القناة المحفوظ مرة واحدة، أو مسارًا اسمه صريح أنه بلا موسيقى
    if (state.videoId !== appliedFor) {
        appliedFor = state.videoId;
        const wanted = (ch && mem[ch]) || state.tracks.find((t) => CLEAN_NAME.test(t));
        if (wanted && wanted !== state.current && state.tracks.includes(wanted)) setTrack(wanted);
    }
    renderChip(ch);
}

function setTrack(name) { window.postMessage({ source: "hisn-set-audio-track", name }, location.origin); }

function channelId() {
    // رابط القناة (/@name أو /channel/ID) ثم meta القناة؛ لا نستعمل itemprop=identifier لأنه معرّف المقطع
    const href = document.querySelector('ytd-channel-name a[href], ytm-slim-owner-renderer a[href], #owner a[href^="/@"], a[href^="/channel/"]')?.getAttribute("href") || "";
    const fromHref = (href.match(/\/(@[^/?]+|channel\/[^/?]+)/) || [])[1];
    return fromHref || document.querySelector('meta[itemprop="channelId"]')?.content || "";
}

function loadMemory() {
    if (memory) return memory;
    try { memory = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { memory = {}; }
    return memory;
}
function saveMemory() { try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* التخزين معطل */ } }

function renderChip(ch) {
    const host = document.getElementById("movie_player") || document.querySelector("video")?.parentElement;
    if (!host) return;
    const label = `🎙 الصوت: ${state.current || "الأصلي"}`;
    let chip = document.querySelector(".hisn-track-chip");
    if (chip && chip.parentElement === host) {
        if (chip.dataset.label !== label) { chip.dataset.label = label; chip.querySelector("button").textContent = label + " ▾"; rebuildMenu(chip, ch); }
        return;
    }
    chip?.remove();
    chip = document.createElement("div");
    chip.className = "hisn-track-chip";
    chip.dataset.label = label;
    chip.setAttribute("style", "position:absolute;top:12px;inset-inline-end:12px;z-index:2147483646;font:600 12px/1.6 system-ui,-apple-system,sans-serif;direction:rtl");
    const btn = document.createElement("button");
    btn.textContent = label + " ▾";
    btn.setAttribute("style", "background:rgba(109,40,217,.92);color:#fff;border:0;border-radius:999px;padding:4px 12px;font:inherit;cursor:pointer");
    const menu = document.createElement("div");
    menu.className = "hisn-track-menu";
    menu.setAttribute("style", "display:none;margin-top:6px;background:#fff;color:#1f1235;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:6px;min-width:200px;max-height:260px;overflow:auto;text-align:start");
    btn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); menu.style.display = menu.style.display === "none" ? "block" : "none"; };
    chip.append(btn, menu);
    rebuildMenu(chip, ch);
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(chip);
}

function rebuildMenu(chip, ch) {
    const menu = chip.querySelector(".hisn-track-menu");
    menu.replaceChildren();
    const hint = document.createElement("div");
    hint.textContent = "بعض القنوات ترفع مسارًا بلا موسيقى باسم لغة أخرى. اختيارك يُحفظ لهذه القناة.";
    hint.setAttribute("style", "font-weight:400;font-size:11px;color:#667085;padding:4px 8px 6px");
    menu.appendChild(hint);
    for (const name of state.tracks) {
        const item = document.createElement("button");
        item.textContent = (name === state.current ? "✓ " : "") + name;
        item.setAttribute("style", "display:block;width:100%;text-align:start;background:none;border:0;padding:8px 10px;border-radius:8px;font:inherit;cursor:pointer;color:inherit");
        item.onclick = (e) => {
            e.stopPropagation(); e.preventDefault();
            setTrack(name);
            if (ch) { loadMemory()[ch] = name; saveMemory(); }
            menu.style.display = "none";
        };
        menu.appendChild(item);
    }
}

