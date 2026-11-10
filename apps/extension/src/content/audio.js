// الصوت: إزالة الموسيقى مع إبقاء الكلام، وكتم المغني، وكتم الألفاظ المنطوقة.
//  - الموسيقى: يمر صوت الفيديو عبر محرك تنظيف (DeepFilterNet3) يعمل في إطار خفي من الإضافة،
//    فتُزال الآلات ويبقى الكلام صافيًا. نموذج YAMNet يكتشف وجود الموسيقى، فلا نغيّر الصوت حين لا موسيقى
//    (وفي المستوى الصارم ينظَّف الصوت دائمًا). إن بقي بعد الإزالة صوت غناء كُتم (خيار في الإعدادات).
//    الأناشيد والتلاوة بلا آلات لا تُمس (افتراضيًا).
//  - الفيديو من موقع آخر (ملف مباشر): نطلب له إذن CORS من قواعد الإضافة، فيصير صوته قابلًا للمعالجة.
//  - الألفاظ: من الترجمة المصاحبة للفيديو، نكتم لحظة نطق اللفظ فقط.
// لا يُسجّل شيء ولا يُرسل خارج الجهاز.
import {
    effectiveSettings, TextFilter, classifyMusic, hearsSinging, MusicGate, muteIntervals, parseYouTubeJson3,
    inIntervals, mergeIntervals, resampleTo16k, encodePcm16, YAMNET_WINDOW, YAMNET_RATE,
} from "@hisn/core";
import lexicon from "@hisn/core/lexicon.json";
import { api } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";

const HOP = YAMNET_RATE / 4; // نافذة جديدة كل ربع ثانية (أسرع اكتشافًا لبداية الموسيقى)
const guards = new Set();
const seen = new WeakSet();
let settings = null;
let filter = null;

// ===== محرك التنظيف: إطار خفي واحد لكل صفحة =====
let engineFrame = null;
function engineWindow() {
    if (engineFrame?.isConnected) return engineFrame.ready;
    const f = document.createElement("iframe");
    f.src = api.runtime.getURL("pages/audio-engine.html");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    f.style.cssText = "display:none !important";
    const ready = new Promise((res, rej) => {
        f.addEventListener("load", () => res(f.contentWindow), { once: true });
        setTimeout(() => rej(new Error("engine timeout")), 15000);
    });
    (document.body ?? document.documentElement).appendChild(f);
    engineFrame = f;
    f.ready = ready;
    return ready;
}

/** يجمع أسباب الكتم ويطبّقها: عبر مسار الصوت إن كان يمر بنا، وإلا بكتم العنصر نفسه. */
class MuteControl {
    constructor(el) {
        this.el = el;
        this.reasons = new Set();
        this.node = null;
        this.weMuted = false;
    }

    set(reason, on) {
        const had = this.reasons.has(reason);
        if (on === had) return;
        if (on) this.reasons.add(reason);
        else this.reasons.delete(reason);
        this.apply();
    }

    apply() {
        const want = this.reasons.size > 0;
        if (this.node) {
            this.node.port.postMessage({ type: "gain", value: want ? 0 : 1 });
        } else if (want && !this.el.muted) {
            this.el.muted = true;
            this.weMuted = true;
        } else if (!want && this.weMuted) {
            this.el.muted = false;
            this.weMuted = false;
        }
        if (want) this.el.dataset.hisnMute = [...this.reasons].join(",");
        else delete this.el.dataset.hisnMute;
    }
}

class AudioGuard {
    constructor(el) {
        this.el = el;
        this.mute = new MuteControl(el);
        this.gate = new MusicGate({ openAfter: 8 }); // لا نعيد الصوت الأصلي إلا بعد ثانيتين بلا موسيقى
        this.unknown = true; // قبل أول حكم على المقطع: ننظّف احتياطًا
        this.ring = new Float32Array(YAMNET_WINDOW);
        this.filled = 0;
        this.fresh = 0;
        this.busy = false;
        this.graph = null;
        this.failed = false;
        this.engine = "none"; // none | loading | ready | failed
        this.music = false;
        this.singing = false;
        this.corsTried = false;
        this.trackIntervals = [];
        this.ytIntervals = [];
        this.timer = null;
        this.onPlay = () => { this.graph?.ctx.resume().catch(() => {}); this.tryAttach(); this.startTimer(); };
        this.onStop = () => this.stopTimer();
        this.onSource = () => {
            this.gate.reset();
            this.music = false;
            this.unknown = true;
            this.singing = false;
            this.mute.set("profanity", false);
            this.trackIntervals = [];
            this.ytIntervals = []; // يوتيوب يعيد استخدام نفس العنصر للمقطع التالي والإعلانات
            this.applyMode();
            this.loadTracks();
            this.prepareSource();
        };
        el.addEventListener("play", this.onPlay);
        el.addEventListener("playing", this.onPlay);
        el.addEventListener("volumechange", () => this.tryAttach());
        el.addEventListener("pause", () => { this.onStop(); this.graph?.ctx.suspend().catch(() => {}); });
        el.addEventListener("ended", this.onStop);
        el.addEventListener("emptied", this.onSource);
        el.addEventListener("loadedmetadata", this.onSource);
        el.textTracks?.addEventListener?.("addtrack", () => this.loadTracks());
        this.configure();
        this.prepareSource();
        if (!el.paused) this.onPlay();
    }

    get s() {
        return settings;
    }

    configure() {
        if (!this.s?.removeMusic) {
            this.gate.reset();
            this.music = false;
        }
        this.applyMode();
        if (this.s?.muteSpokenProfanity) this.loadTracks();
        else {
            this.trackIntervals = [];
            this.mute.set("profanity", false);
        }
        if (!this.el.paused) this.onPlay();
    }

    // ===== مصدر الصوت =====

    /** هل يمكن أن يمر صوت هذا المقطع عبرنا دون أن يصمت؟ */
    canRoute() {
        const src = this.el.currentSrc || this.el.src;
        if (!src) return false;
        if (src.startsWith("blob:") || src.startsWith("data:")) return true;
        try {
            const u = new URL(src, location.href);
            return u.origin === location.origin || (this.el.crossOrigin != null && this.corsTried);
        } catch {
            return false;
        }
    }

    /**
     * فيديو بملف مباشر من موقع آخر: المتصفح يمنع قراءة صوته. نطلب من قواعد الإضافة إضافة إذن CORS
     * لهذا الموقع، ثم نعيد تحميل المقطع بنفس الموضع. إن فشل التحميل بهذه الطريقة نعيده كما كان.
     */
    async prepareSource() {
        if (this.corsTried || this.graph || !(this.s?.removeMusic || this.s?.muteSpokenProfanity)) return;
        const src = this.el.currentSrc || this.el.src;
        if (!src || this.canRoute() || !/^https?:/.test(src) || this.el.crossOrigin != null) return;
        this.corsTried = true;
        const r = await send(api, { type: MSG.MEDIA_CORS, url: src });
        if (!r?.ok) return;
        const t = this.el.currentTime, wasPaused = this.el.paused;
        const revert = () => {
            this.el.removeAttribute("crossorigin");
            this.el.load();
            this.el.currentTime = t;
            if (!wasPaused) this.el.play().catch(() => {});
            this.failed = true;
        };
        this.el.addEventListener("error", revert, { once: true });
        this.el.addEventListener("canplay", () => this.el.removeEventListener("error", revert), { once: true });
        this.el.crossOrigin = "anonymous";
        this.el.load();
        if (t) this.el.currentTime = t;
        if (!wasPaused) this.el.play().catch(() => {});
    }

    async tryAttach() {
        if (this.graph || this.failed || this.attaching || !this.s?.removeMusic) return;
        // بلا تفاعل من المستخدم يبقى سياق الصوت معلقًا فيصمت المقطع؛ ننتظر أول ضغطة
        if (!navigator.userActivation?.hasBeenActive || this.el.paused || this.el.muted) return;
        if (!this.canRoute()) return;
        this.attaching = true;
        try {
            const ctx = new AudioContext({ sampleRate: 48000 }); // تردد محرك التنظيف
            await ctx.audioWorklet.addModule(api.runtime.getURL("audio/relay-worklet.js"));
            const src = ctx.createMediaElementSource(this.el);
            const node = new AudioWorkletNode(ctx, "hisn-relay", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
            src.connect(node).connect(ctx.destination);
            // فرع للسماع فقط (لكشف الموسيقى بالأصلي): لا يصل للسماعة
            const proc = ctx.createScriptProcessor(4096, 1, 1);
            const silent = ctx.createGain();
            silent.gain.value = 0;
            src.connect(proc);
            proc.connect(silent).connect(ctx.destination);
            proc.onaudioprocess = (e) => this.onSamples(e.inputBuffer.getChannelData(0), ctx.sampleRate);
            ctx.resume().catch(() => {});
            node.port.onmessage = (m) => {
                if (m.data?.type === "stats") this.el.dataset.hisnAudioStats = `${m.data.cleaned}/${m.data.underruns}/${m.data.mix}`;
            };
            this.graph = { ctx, src, node, proc };
            this.mute.node = node;
            this.mute.apply();
            this.el.dataset.hisnAudioPath = "routed";
            // نحمّل المحرك من أول تشغيل، فيكون جاهزًا لحظة ظهور الموسيقى
            this.startEngine();
            this.applyMode();
        } catch (e) {
            // الصفحة نفسها تمرر الصوت عبر Web Audio، أو المتصفح لا يسمح: نكتفي بكتم العنصر عند الحاجة
            this.failed = true;
            this.el.dataset.hisnAudioPath = "failed";
        } finally {
            this.attaching = false;
        }
    }

    /** يشغّل محرك التنظيف لهذا المقطع (أول مرة تُكتشف فيها موسيقى، أو فورًا في الصارم). */
    async startEngine() {
        if (this.engine !== "none" || !this.graph) return;
        this.engine = "loading";
        this.applyMode();
        try {
            const win = await engineWindow();
            const audio = new MessageChannel();
            const control = new MessageChannel();
            const ok = new Promise((res, rej) => {
                control.port1.onmessage = (m) => {
                    const d = m.data;
                    if (d.type === "ready") res();
                    else if (d.type === "error") rej(new Error(d.message));
                    else if (d.type === "singing") {
                        // إذا ظهر الغناء مرة في مقطع موسيقي نبقيه مكتومًا حتى تنتهي الموسيقى (لا يعود مع كل نَفَس)
                        // ويلزم أن يسمع نموذج الصوت غناءً (لا كلامًا منغّمًا كأصوات الرسوم المتحركة)
                        if (d.value && this.music && Date.now() - (this.sungAt ?? 0) < 3000) this.singing = true;
                        this.applyMode();
                    }
                };
                setTimeout(() => rej(new Error("engine timeout")), 20000);
            });
            win.postMessage({ type: "hisn-engine" }, "*", [audio.port2, control.port2]);
            await ok;
            this.graph.node.port.postMessage({ type: "engine", port: audio.port1 }, [audio.port1]);
            this.engine = "ready";
        } catch (e) {
            this.engine = "failed";
        }
        this.applyMode();
    }

    /** يطبّق الحالة: صوت أصلي، أو نظيف، أو مكتوم (إن لم يجهز المحرك بعد، أو بقي غناء). */
    applyMode() {
        const s = this.s;
        const wantClean = Boolean(s?.removeMusic) && (s.level === "strict" || this.music || this.unknown);
        const node = this.graph?.node;
        if (wantClean && this.engine === "none") this.startEngine();
        const clean = wantClean && this.engine === "ready";
        node?.port.postMessage({ type: "mix", value: clean ? 1 : 0 });
        // حتى يجهز المحرك (أو إن تعذّر) نكتم أثناء الموسيقى بدل أن تُسمع — لا قبل أول حكم (حتى لا يصمت كل فيديو لحظة بدايته)
        this.mute.set("music", wantClean && !clean && (this.music || this.engine === "failed"));
        this.mute.set("singer", clean && this.music && this.singing && s?.muteSingerAfterMusicRemoval !== false);
        this.el.dataset.hisnAudioMode = !wantClean ? "original"
            : clean ? (this.mute.reasons.has("singer") ? "singer-muted" : "clean")
            : this.mute.reasons.has("music") ? "muted" : "loading";
    }

    onSamples(data, rate) {
        if (!this.s?.removeMusic || this.el.paused) return;
        const chunk = resampleTo16k(data, rate);
        // حلقة: نحتفظ بآخر 15600 عينة
        if (chunk.length >= YAMNET_WINDOW) {
            this.ring.set(chunk.subarray(chunk.length - YAMNET_WINDOW));
        } else {
            this.ring.copyWithin(0, chunk.length);
            this.ring.set(chunk, YAMNET_WINDOW - chunk.length);
        }
        this.filled = Math.min(YAMNET_WINDOW, this.filled + chunk.length);
        this.fresh += chunk.length;
        if (this.fresh >= HOP && this.filled >= YAMNET_WINDOW && !this.busy) {
            this.fresh = 0;
            this.classify(this.ring.slice());
        }
    }

    async classify(win) {
        let peak = 0;
        for (let i = 0; i < win.length; i += 8) peak = Math.max(peak, Math.abs(win[i]));
        if (peak < 1e-3) {
            this.music = this.gate.push(false);
            if (!this.music) this.singing = false;
            this.applyMode();
            return;
        }
        this.busy = true;
        const r = await send(api, { type: MSG.DETECT_AUDIO, pcm: encodePcm16(win) });
        this.busy = false;
        if (!r?.audio || !this.s?.removeMusic) return;
        if (hearsSinging(r.audio)) this.sungAt = Date.now();
        const c = classifyMusic(r.audio, this.s);
        this.el.dataset.hisnAudio = c.reason;
        this.unknown = false;
        this.music = this.gate.push(c.music);
        if (!this.music) this.singing = false;
        this.applyMode();
    }

    // ===== الألفاظ المنطوقة =====

    loadTracks() {
        if (!this.s?.muteSpokenProfanity || !filter) return;
        const tracks = [...(this.el.textTracks ?? [])].filter((t) => t.kind === "subtitles" || t.kind === "captions");
        for (const t of tracks) {
            // "مخفي" يحمّل النص دون عرضه، فلا نغيّر ما يراه المستخدم
            if (t.mode === "disabled") t.mode = "hidden";
            if (!t.hisnListening) {
                t.hisnListening = true;
                t.addEventListener("cuechange", () => this.collectCues());
            }
        }
        for (const el of this.el.querySelectorAll?.("track") ?? []) el.addEventListener("load", () => this.collectCues(), { once: true });
        this.collectCues();
    }

    collectCues() {
        const cues = [];
        for (const t of this.el.textTracks ?? []) {
            if (t.kind !== "subtitles" && t.kind !== "captions") continue;
            for (const c of t.cues ?? []) cues.push({ start: c.startTime, end: c.endTime, text: (c.text ?? "").replace(/<[^>]+>/g, "") });
        }
        this.trackIntervals = muteIntervals(cues, filter);
        if (this.trackIntervals.length && !this.el.paused) this.startTimer();
    }

    startTimer() {
        if (this.timer || (!this.trackIntervals.length && !this.ytIntervals.length)) return;
        this.timer = setInterval(() => {
            const t = this.el.currentTime;
            this.mute.set("profanity", inIntervals(t, this.trackIntervals) || inIntervals(t, this.ytIntervals));
        }, 60);
    }

    stopTimer() {
        clearInterval(this.timer);
        this.timer = null;
    }

    setYouTubeIntervals(iv) {
        this.ytIntervals = iv;
        this.stopTimer();
        if (!this.el.paused) this.startTimer();
    }
}

/** يبدأ مراقبة صوت عنصر فيديو أو صوت (مرة واحدة لكل عنصر). */
export function watchAudio(el) {
    if (seen.has(el) || !settings) return;
    if (!settings.removeMusic && !settings.muteSpokenProfanity) return;
    seen.add(el);
    guards.add(new AudioGuard(el));
}

/** إيقاف الحماية: يعود الصوت كما كان (لا نلغي كتمًا وضعه المستخدم بنفسه)، وتتوقف المؤقتات والتنظيف */
export function suspendAudio() {
    settings = {}; // لا شيء مفعّل: أحداث العنصر اللاحقة (مقطع جديد/تشغيل) لا تعيد الكتم
    for (const g of guards) {
        g.stopTimer();
        g.trackIntervals = [];
        g.ytIntervals = [];
        g.music = false;
        g.unknown = true;
        g.graph?.node?.port.postMessage({ type: "mix", value: 0 });
        g.mute.reasons.clear();
        g.mute.apply();
        if (g.el.dataset) g.el.dataset.hisnAudioMode = "original";
    }
}

export function configureAudio(s) {
    settings = effectiveSettings(s);
    filter ??= new TextFilter(lexicon);
    filter.setInsults(s.maskInsults);
    for (const g of guards) {
        if (!g.el.isConnected) guards.delete(g);
        else g.configure();
    }
}

// ===== يوتيوب: الترجمة (حتى المخفية) من سكربت صغير يعمل في سياق الصفحة (yt-main.js) =====
let ytVideo = null;
window.addEventListener("message", async (e) => {
    if (e.source !== window || e.data?.source !== "hisn-yt" || !settings?.muteSpokenProfanity) return;
    const { videoId, tracks } = e.data;
    if (!videoId || videoId === ytVideo) return;
    ytVideo = videoId;
    const video0 = document.querySelector("#movie_player video, video.html5-main-video");
    for (const g of guards) if (g.el === video0) g.setYouTubeIntervals([]); // مقطع جديد: لا نحمل فترات المقطع السابق
    if (!Array.isArray(tracks) || !tracks.length) return;
    // الترجمة الآلية فيها توقيت لكل كلمة، فنكتم الكلمة وحدها
    const track = tracks.find((t) => t.kind === "asr") ?? tracks[0];
    if (!/^https:\/\/www\.youtube\.com\/api\/timedtext\?/.test(track.baseUrl ?? "")) return;
    try {
        const res = await fetch(track.baseUrl + "&fmt=json3", { credentials: "include" });
        const json = await res.json();
        const iv = mergeIntervals(muteIntervals(parseYouTubeJson3(json), filter));
        const video = document.querySelector("#movie_player video, video.html5-main-video");
        if (!video) return;
        watchAudio(video);
        for (const g of guards) if (g.el === video) g.setYouTubeIntervals(iv);
    } catch {
        // يوتيوب يغيّر واجهة الترجمة أحيانًا؛ نكتفي بالكشف من النص الظاهر (أدناه)
        ytVideo = null;
    }
});

// احتياط: إذا كانت الترجمة ظاهرة على الشاشة نكتم لحظة ظهور اللفظ فيها
let liveTimer = null;
export function watchLiveCaptions(root) {
    if (!settings?.muteSpokenProfanity || !filter) return;
    const seg = root.closest?.(".ytp-caption-segment, .captions-text, .vjs-text-track-display");
    if (!seg || !filter.findProfanity(seg.textContent ?? "").length) return;
    const video = seg.closest("#movie_player, .video-js, [data-testid='videoPlayer']")?.querySelector("video") ?? document.querySelector("video");
    const g = [...guards].find((x) => x.el === video);
    if (!g) return;
    g.mute.set("live", true);
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => g.mute.set("live", false), 1500);
}
export const _audioTest = { guards };
