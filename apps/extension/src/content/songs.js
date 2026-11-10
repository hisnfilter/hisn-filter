// كتم المقاطع التي صوتها أغنية (تيك توك وإنستغرام وShorts وفيسبوك) بلا تحليل صوت ولا إبطاء:
// كل مقطع مكتوب عليه اسم صوته — «الصوت الأصلي» أو اسم أغنية. الأغنية تُكتم، والصوت الأصلي يبقى.
// يُستخدم حيث لا تتوفر إزالة الموسيقى المباشرة (المتصفح المحمي في الآيفون).

const HOSTS = /(^|\.)(tiktok|instagram|youtube|facebook)\.com$/;
const LABELS = [
    '[data-e2e="video-music"]', '[data-e2e="browse-music"]', '[data-e2e="music-name"]', '[data-e2e="video-music-title"]',
    'a[href*="/music/"]', 'a[href*="/reels/audio/"]', 'a[href*="/audio/"]',
    "ytm-reel-sound-metadata-renderer", '[class*="SoundMetadata"]', '[class*="sound-metadata"]',
    '[class*="MusicInfo"]', '[class*="music-info"]', '[class*="MusicText"]',
    // أسماء العناصر تتغير بين النسخ: أي عنصر وسمه أو صنفه فيه music أو sound أو audio
    '[data-e2e*="music"]', '[data-e2e*="sound"]', '[data-e2e*="audio"]', '[class*="Music"]', '[class*="music"]',
    '[class*="SoundTitle"]', '[class*="soundTitle"]', '[class*="AudioTitle"]', '[aria-label*="sound"]', '[aria-label*="music"]',
].join(",");
const ORIGINAL = /original\s*(sound|audio)|الصوت الأصلي|صوت أصلي|الصوت الاصلي|son original|sonido original|orijinal ses|audio original/i;
/** أصوات ليست أغاني وإن حملت اسمًا: قرآن وتلاوة وأناشيد وأدعية وأذكار ورقية ومحاضرات وأصوات طبيعية */
const NOT_SONG = /قر[آا]ن|تلاوة|تلاوه|سورة|سوره|آية|ايات|آيات|القارئ|الشيخ|نشيد|أنشودة|انشودة|أناشيد|اناشيد|دعاء|أدعية|ادعية|أذكار|اذكار|ذكر|رقية|رقيه|تكبيرات|تلبية|خطبة|محاضرة|درس|موعظة|حديث|صلاة|أذان|اذان|قران|quran|qur'?an|koran|surah|sura|ayah|recit|tilawa|nasheed|nashid|anasheed|dua|adhkar|azkar|ruqya|takbir|khutba|lecture|sermon|hadith|adhan|azan|nature|rain|waves|birds|wind|white noise|asmr|podcast|بودكاست|مطر|أمواج|طيور|طبيعة|muatherat|مؤثرات|الله|اللهم|ربي|ربك|يا رب|سبح|سبحان|الحمد|استغفر|لا إله|لا اله|محمد|رسول|النبي|صلوا|صل على|الجنة|إسلام|اسلام|إيمان|ايمان|توبة|مكة|المدينة|الكعبة|عمرة|حج|رمضان|عيد|allah|muhammad|prophet|nabi|rasul|salam alayk|salawat|islam|deen|jannah|subhan|alhamdulillah|astaghfir|la ilaha|ramadan|eid|makkah|madinah|kaaba|umrah|hajj/i;
/** أسماء أصوات قال المستخدم إنها ليست أغاني (تُحفظ على هذا الجهاز) */
const ALLOW_KEY = "hisnNotSongs";
let allowed = null;
function allowedSet() {
    if (allowed) return allowed;
    try { allowed = new Set(JSON.parse(localStorage.getItem(ALLOW_KEY) || "[]")); } catch { allowed = new Set(); }
    return allowed;
}
function remember(label) {
    allowedSet().add(label);
    try { localStorage.setItem(ALLOW_KEY, JSON.stringify([...allowed].slice(-500))); } catch { /* التخزين معطل */ }
}
export function isSongLabel(label) {
    if (!label) return false;
    if (ORIGINAL.test(label) || NOT_SONG.test(label)) return false;
    if (allowedSet().has(label)) return false;
    return true;
}
/** وسوم تُطابق أزرار التحكم لا اسم الصوت (كتم/تشغيل/مستوى الصوت): لا تُعدّ أغنية أبدًا */
const CONTROL = /^(toggle|mute|unmute|volume|audio is|sound (on|off)|كتم|إلغاء الكتم|الصوت)\b|^(toggle audio|audio)$/i;
/** وسم اسم الصوت الحقيقي (رابط الصوت أو وسم مخصص): وحده يكفي للكتم. الوسوم العامة (class فيها music…) تُستعمل لإثبات «الصوت الأصلي» فقط */
const STRONG = /^a\[href|^\[data-e2e=|^ytm-reel|SoundMetadata|sound-metadata|MusicInfo|music-info|MusicText/;

/** الوسوم «القوية» من القائمة أعلاه: رابط الصوت أو وسم مخصص لاسم الصوت */
const STRONG_SEL = LABELS.split(",").filter((q) => STRONG.test(q)).join(",");

let timer = null;
let autoUnmute = false;
// المستخدم كتم بنفسه (ضغط زر السماعة): لا نعيد الصوت حتى يعيده هو
let userMuted = false;
let lastTap = 0;

export function configureSongs(s) {
    clearInterval(timer);
    timer = null;
    // إنستغرام يشغّل مقاطع الخلاصة مكتومة افتراضيًا (سياسة المتصفحات)؛ مع الخيار نعيد الصوت لما لم نكتمه نحن
    autoUnmute = Boolean(s.autoUnmute !== false && /(^|\.)instagram\.com$/.test(location.hostname));
    if (autoUnmute && !configureSongs.listening) {
        configureSongs.listening = true;
        document.addEventListener("pointerdown", () => { lastTap = performance.now(); }, true);
        document.addEventListener("volumechange", (e) => {
            const v = e.target;
            if (!(v instanceof HTMLMediaElement) || v.dataset.hisnSong || v.dataset.hisnAdMuted || v.dataset.hisnEar) return;
            // تغيّر خلال نصف ثانية من ضغطة: قرار المستخدم
            if (performance.now() - lastTap < 500) userMuted = v.muted;
        }, true);
    }
    // الخيار أُطفئ أو الحماية متوقفة: ما كتمناه نحن يعود صوته (لا يُمس كتم المستخدم)
    if (!s.enabled || !s.muteSongClips) {
        for (const v of document.querySelectorAll("video[data-hisn-song]")) {
            delete v.dataset.hisnSong;
            if (!v.dataset.hisnEar && v.dataset.hisnSongWas !== "muted") v.muted = false;
            delete v.dataset.hisnSongWas;
            badge(v, false);
        }
    }
    if (!s.enabled) return;
    if (!s.muteSongClips && !autoUnmute) return;
    if (!HOSTS.test(location.hostname)) return;
    timer = setInterval(tick, 700);
}

/** اسم الصوت المكتوب قرب الفيديو: أقرب حاوية فيها وسم صوت، وإلا أقرب وسم ظاهر في الصفحة إلى الفيديو. */
function soundLabel(video) {
    const textOf = (tag) => (tag.textContent || tag.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 160);
    // لا نعتبر النص اسم صوت إن كان زر تحكم، ولا نكتم بناءً على وسم عام إلا إن كان يثبت «الصوت الأصلي»
    const usable = (tag, text) => text && text.length >= 3 && !CONTROL.test(text) && (ORIGINAL.test(text) || tag.matches(STRONG_SEL));
    let el = video.parentElement;
    for (let i = 0; el && el !== document.body && el !== document.documentElement && i < 10; i++, el = el.parentElement) {
        for (const tag of el.querySelectorAll?.(LABELS) ?? []) {
            const text = textOf(tag);
            if (usable(tag, text)) return text;
        }
    }
    // تيك توك الجوال: اسم الصوت في طبقة فوق الفيديو لا داخل حاويته
    const vr = video.getBoundingClientRect();
    if (!vr.width) return null;
    let best = null, bestD = Infinity;
    for (const tag of document.querySelectorAll(LABELS)) {
        if (!tag.offsetParent && getComputedStyle(tag).position !== "fixed") continue;
        const text = textOf(tag);
        if (!usable(tag, text)) continue;
        const r = tag.getBoundingClientRect();
        if (!r.width || r.bottom < vr.top - 80 || r.top > vr.bottom + 80) continue;
        const d = Math.abs((r.top + r.bottom) / 2 - (vr.top + vr.bottom) / 2);
        if (d < bestD) { bestD = d; best = text; }
    }
    if (!best && !loggedNone) { loggedNone = true; diag(`songs: no sound label (${location.hostname}) videos=${document.querySelectorAll("video").length}`); }
    return best;
}

let loggedNone = false, lastLogged = null;
function diag(text) {
    globalThis.webkit?.messageHandlers?.hisn?.postMessage({ type: "hisn:log", text })?.catch?.(() => {});
}

function tick() {
    for (const v of document.querySelectorAll("video")) {
        if (v.paused) continue;
        // إعادة الصوت لمقطع كتمه الموقع افتراضيًا (لا نحن، ولا المستخدم)، بعد أول لمسة للصفحة
        if (autoUnmute && v.muted && !v.dataset.hisnSong && !v.dataset.hisnAdMuted && !v.dataset.hisnEar && !userMuted && navigator.userActivation?.hasBeenActive && !v.dataset.hisnUnmuted) {
            v.dataset.hisnUnmuted = "1";
            v.muted = false;
        }
        const label = soundLabel(v);
        const song = isSongLabel(label);
        if (label && label !== lastLogged) { lastLogged = label; diag(`songs: label "${label.slice(0, 60)}" song=${Boolean(song)}`); }
        if (song) {
            if (!v.dataset.hisnSong) v.dataset.hisnSongWas = v.muted ? "muted" : "";
            if (!v.muted) v.muted = true;
            v.dataset.hisnSong = "1";
            badge(v, true, label);
            if (!v.dataset.hisnSongLogged) { v.dataset.hisnSongLogged = "1"; diag(`songs: muted song clip, badge=${Boolean(v.parentElement?.querySelector(".hisn-song-badge"))}`); }
        } else if (v.dataset.hisnSong) {
            // انتقل لمقطع صوته أصلي: نعيد الصوت الذي كتمناه نحن فقط (إلا إن كان كاتم السماع قد كتمه)
            delete v.dataset.hisnSong;
            if (!v.dataset.hisnEar && v.dataset.hisnSongWas !== "muted") v.muted = false;
            delete v.dataset.hisnSongWas;
            badge(v, false);
        }
    }
}

/** شارة صغيرة فوق المقطع: الكتم مقصود (أغنية)، لا عطل. الضغط عليها = «ليست أغنية»: يعيد الصوت ويتذكر الاسم. */
function badge(v, on, label) {
    const host = v.parentElement;
    if (!host) return;
    let b = host.querySelector(":scope > .hisn-song-badge");
    if (!on) { b?.remove(); return; }
    if (b) return;
    b = document.createElement("button");
    b.className = "hisn-song-badge";
    b.textContent = "🔇 كُتمت الأغنية · ليست أغنية؟";
    b.setAttribute("style", "position:absolute;top:12px;inset-inline-start:12px;z-index:2147483646;background:rgba(109,40,217,.9);color:#fff;border:0;font:600 12px/1.6 system-ui,-apple-system,sans-serif;padding:4px 12px;border-radius:999px;cursor:pointer");
    b.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (label) remember(label);
        delete v.dataset.hisnSong;
        v.muted = false;
        b.remove();
        diag(`songs: user marked not-a-song "${(label || "").slice(0, 60)}"`);
    };
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(b);
}

export const _test = { soundLabel, ORIGINAL, isSongLabel };
