// فحص الفيديو باستمرار: كل فيديو له مراقب مستقل.
// يبدأ الفيديو مضبّبًا، ويظهر بعد لقطات سليمة متتالية، ويُضبَّب فورًا عند أول لقطة مخالفة.
import { decideImage, partialImage } from "@hisn/core";
import { api } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";
import { setMediaState, setPartial, ATTR, markRevealed } from "./ui.js";
import { wasRevealed, rememberBlockedVideo, wasBlocked } from "./media.js";
import { skipShortVideo } from "./adapters.js";

const CLEAR_FRAMES_TO_SHOW = 2; // لقطات سليمة متتالية قبل الإظهار (الثانية بعد 150ms فقط)
const CONFIRM_AFTER = 150;
const BASE_INTERVAL = 450; // فحص كامل كل 450 مللي ثانية تقريبًا
const SCENE_CHECK = 120; // فحص سريع لتغيّر المشهد
const SCENE_THRESHOLD = 22; // متوسط فرق البكسل (0..255) الذي يُعد مشهدًا جديدًا
const FRAME_SIDE = 416;
/** إن لم يصل حكم جديد خلال هذه المدة والفيديو يعمل، نعود للتضبيب حتى يُفحص (لا نبقي حكمًا قديمًا). */
const VERDICT_TTL = 4000;
/** مشهد امرأة في الفيديو (أقل من عتبة الصورة الواحدة 0.75)، وأقل بعد لقطة قريبة فيها امرأة. */
const VIDEO_SCENE_WOMAN = 0.55;
const VIDEO_SCENE_WOMAN_RECENT = 0.35;
const WOMAN_MEMORY = 3000;
/**
 * مقطع ظهر بعد تأكيد ثم جاءت لقطة واحدة مخالفة بدرجة متوسطة: نطلب لقطة ثانية تؤكدها قبل التغطية،
 * حتى لا «يقطع ويظلم» المقطع كل لحظة بسبب لقطة عابرة (وجهان قريبان، حركة، لقطة مشوّشة).
 * العري أو المحتوى الجنسي الواضح (فوق STRONG) يُغطّى من أول لقطة كما كان.
 */
const STRONG = 0.85;
const SUSPECT_WINDOW = 1500;

const monitors = new WeakMap();

class VideoMonitor {
    constructor(video, settings) {
        this.v = video;
        this.settings = settings;
        this.clear = 0;
        this.busy = false;
        this.lastFull = 0;
        this.lastSceneCheck = 0;
        this.prevThumb = null;
        this.errors = 0;
        this.lastVerdict = 0;
        this.suspectAt = 0;
        this.thermal = 0;
        this.srcSeen = video.currentSrc;
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
        this.thumb = document.createElement("canvas");
        this.thumb.width = this.thumb.height = 16;
        this.tctx = this.thumb.getContext("2d", { willReadFrequently: true });
        this.stopped = false;
        this.reset();
        this.loop = this.loop.bind(this);
        this.schedule();
        this.prefetch();
        video.addEventListener("emptied", () => this.reset());
        video.addEventListener("loadeddata", () => this.reset());
        // قفزة زمنية كبيرة: المشهد قد يتغير كليًا، فلا نثق بالحكم السابق حتى نفحص
        video.addEventListener("seeking", () => { if (Math.abs(video.currentTime - (this.lastSeenTime ?? video.currentTime)) > 2) this.invalidate(); });
        video.addEventListener("seeked", () => this.forceCheck());
        // بعد إيقاف مؤقت: مهلة جديدة للحكم مع فحص فوري (حتى لا يتضبّب كل استئناف)
        video.addEventListener("play", () => { if (this.lastVerdict) this.lastVerdict = performance.now(); this.forceCheck(); });
    }

    reset() {
        if (this.stopped) return;
        // مصدر جديد أو مقطع جديد: نعود للتضبيب حتى نفحص
        if (this.v.dataset.hisnRevealed && this.v.currentSrc === this.srcSeen) return;
        delete this.v.dataset.hisnRevealed;
        this.srcSeen = this.v.currentSrc;
        // المستخدم أظهر هذا المقطع من قبل (عنصر جديد لنفس المصدر): نعيد قراره بلا تغبيش
        if (wasRevealed(this.v)) {
            this.v.dataset.hisnRevealed = "1";
            markRevealed(this.v);
            this.gen = (this.gen || 0) + 1;
            return;
        }
        this.prefetch();
        // جيل جديد: أي نتيجة فحص بدأت قبل هذا التغيير تُهمل (قد تخص مقطعًا آخر)
        this.gen = (this.gen || 0) + 1;
        this.clear = 0;
        this.prevThumb = null;
        this.lastFull = 0;
        this.pendingSince = performance.now();
        this.logged = false;
        if (this.v.getAttribute(ATTR) !== "pending") setMediaState(this.v, "pending");
        this.confirmed = false;
        this.quickPoster();
    }

    /** الظهور السريع (المتوسط للبالغين): غلاف المقطع يُفحص في ~0.1 ثانية؛ إن سلم يظهر المقطع فورًا بينما يستمر
     * فحص الإطارات خلفه ويغطّيه عند أول إطار مخالف. في الصارم ووضع الطفل: لا ظهور قبل فحص الإطارات. */
    async quickPoster() {
        const s = this.settings;
        if (!s || s.level !== "medium" || s.childMode || s.fastReveal === false) return;
        const gen = this.gen;
        const t0 = performance.now();
        // مقطع سبق أن حجبته لقطاته في هذه الصفحة (إنستغرام يعيد بناء العنصر عند التمرير): لا ظهور سريع، ننتظر اللقطات
        if (wasBlocked(this.v)) return;
        const reveal = (how) => {
            if (gen !== this.gen || this.v.getAttribute(ATTR) !== "pending" || wasBlocked(this.v)) return;
            setMediaState(this.v, "ok");
            // أول لقطة من المقطع نفسه فورًا، لا بعد الدورة كاملة: الغلاف قد لا يمثّل المقطع
            this.lastFull = performance.now() - BASE_INTERVAL + CONFIRM_AFTER;
            if (!this.logged && this.pendingSince) { this.logged = true; diag(`video shown after ${Math.round(performance.now() - this.pendingSince)}ms (${how} ${Math.round(performance.now() - t0)}ms)`); }
        };
        // إنستغرام وتيك توك يضعان الغلاف صورةً فوق المقطع، وفاحص الصور يفحصها أصلًا: نستعمل حكمه بلا فحص إضافي
        const vr = this.v.getBoundingClientRect();
        let overlay = null;
        if (vr.width) {
            let host = this.v.parentElement;
            for (let i = 0; host && i < 3 && !overlay; i++, host = host.parentElement) {
                for (const img of host.querySelectorAll("img")) {
                    const r = img.getBoundingClientRect();
                    const ox = Math.max(0, Math.min(r.right, vr.right) - Math.max(r.left, vr.left));
                    const oy = Math.max(0, Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top));
                    // غلاف حقيقي فقط: صورة بحجم كافٍ (لا عنصر نائب شفاف أو مصغّرة مموّهة تمرّ من الفحص «سليمة»)
                    if (ox * oy >= vr.width * vr.height * 0.6 && img.currentSrc && img.naturalWidth >= 200 && img.naturalHeight >= 200) { overlay = img; break; }
                }
            }
        }
        if (overlay) {
            if (overlay.getAttribute(ATTR) === "ok") return reveal("poster-cached");
            // الغلاف قيد الفحص: ننتظر حكمه (لا نكرر الفحص)
            await new Promise((resolve) => {
                const mo = new MutationObserver(() => { const st = overlay.getAttribute(ATTR); if (st && st !== "pending") { mo.disconnect(); resolve(); } });
                mo.observe(overlay, { attributes: true, attributeFilter: [ATTR] });
                setTimeout(() => { mo.disconnect(); resolve(); }, 2500);
            });
            if (overlay.getAttribute(ATTR) === "ok") reveal("poster");
            return;
        }
        // لا غلاف في الصفحة: نفحص poster المقطع إن وُجد
        const src = this.v.poster || "";
        if (!/^https?:/.test(src)) return;
        const r = await send(api, { type: MSG.DETECT_IMAGE, src });
        if (!r?.analysis) return;
        if (decideImage(r.analysis, s).action === "show") reveal("poster-fetch");
    }

    forceCheck() {
        this.lastFull = 0;
    }

    /** مقطع من موقع آخر لم يبدأ بعد: التطبيق يحمّل رأس ملفه وأول لقطة الآن، فيكون الفحص الأول سريعًا عند التشغيل. */
    prefetch() {
        const src = this.v.currentSrc || this.v.src;
        if (!src || this.prefetched === src || !/^https?:/.test(src) || !globalThis.webkit?.messageHandlers?.hisn) return;
        try { if (new URL(src, location.href).origin === location.origin) return; } catch { return; }
        this.prefetched = src;
        send(api, { type: "hisn:prefetch-video", src, page: location.href }).catch?.(() => {});
    }

    /** الحكم الحالي لم يعد يُعتمد عليه (قفزة أو مصدر جديد): نُظلّل حتى يصل حكم جديد. */
    invalidate() {
        if (this.stopped) return;
        this.gen = (this.gen || 0) + 1;
        this.clear = 0;
        this.lastFull = 0;
        if (this.v.getAttribute(ATTR) === "ok" || this.v.getAttribute(ATTR) === "partial") setMediaState(this.v, "pending");
    }

    schedule() {
        if (this.stopped) return;
        if (this.v.requestVideoFrameCallback) this.v.requestVideoFrameCallback(this.loop);
        else requestAnimationFrame(this.loop);
    }

    sceneChanged() {
        try {
            this.tctx.drawImage(this.v, 0, 0, 16, 16);
            const d = this.tctx.getImageData(0, 0, 16, 16).data;
            const prev = this.prevThumb;
            this.prevThumb = d;
            if (!prev) return true;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) {
                sum += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]);
            }
            return sum / (256 * 3) > SCENE_THRESHOLD;
        } catch {
            return false; // فيديو من موقع آخر لا يمكن قراءته
        }
    }

    grabFrame() {
        const w = this.v.videoWidth, h = this.v.videoHeight;
        if (!w || !h) return null;
        const scale = Math.min(1, FRAME_SIDE / Math.max(w, h));
        this.canvas.width = Math.round(w * scale);
        this.canvas.height = Math.round(h * scale);
        this.ctx.drawImage(this.v, 0, 0, this.canvas.width, this.canvas.height);
        try {
            return this.canvas.toDataURL("image/jpeg", 0.75);
        } catch {
            return null;
        }
    }

    async loop() {
        if (this.stopped) return;
        if (!this.v.isConnected) { this.stopped = true; return; }
        if (this.v.dataset.hisnDebugHold) { setTimeout(() => this.loop(), 500); return; } // تجربة آلية: لا تُغيّر الحالة المفروضة
        const now = performance.now();
        const playing = !this.v.paused && !this.v.ended && this.v.readyState >= 2;
        if (this.v.currentSrc !== this.srcSeen) this.reset();
        // حكم «سليم» قديم والفيديو يعمل: لا نعتمد عليه
        const st = this.v.getAttribute(ATTR);
        if (playing && (st === "ok" || st === "partial") && this.lastVerdict && now - this.lastVerdict > VERDICT_TTL) {
            this.clear = 0;
            setMediaState(this.v, "pending");
        }
        if (!this.busy && (playing || this.clear === 0) && this.v.readyState >= 2) {
            // مقطع مؤكد السلامة بلا شبهة: فحص أقل تكرارًا (يخفف الحمل على الجهاز ويُبقي الصفحة سلسة)؛ تغيّر المشهد يفحص فورًا
            // جهاز حار (التطبيق يخبرنا): نبطئ الفحص أكثر — المقطع الجديد يبقى مضبّبًا حتى يُفحص، فالأمان لا يتأثر
            // جهاز من جيل أقدم (iPhone 12 وما قبله): وتيرة أبطأ بمرة ونصف — الحماية نفسها، فقط حكم أول اللقطة يتأخر جزءًا من ثانية
            const hot = (this.thermal >= 2 ? 2 : 1) * (this.settings.perfTier === "low" ? 1.5 : 1);
            const interval = (st === "ok" && !this.suspectAt ? BASE_INTERVAL * 2 : BASE_INTERVAL) * hot;
            let due = now - this.lastFull > interval;
            if (!due && now - this.lastSceneCheck > SCENE_CHECK) {
                this.lastSceneCheck = now;
                if (this.sceneChanged()) due = true; // مشهد جديد: فحص فوري
            }
            if (due) this.check(now);
        }
        // الفيديو المتوقف لا يحتاج requestVideoFrameCallback، فنستعمل مؤقتًا
        if (this.v.paused) setTimeout(() => this.schedule(), 300);
        else this.schedule();
    }

    /** حكم لا يحتمل التأجيل: عري أو محتوى جنسي واضح، أو امرأة بوجه واثق للرجل في الصارم. */
    strongVerdict(a, decision) {
        if ((a.nudity ?? 0) >= STRONG || (a.sexual ?? 0) >= STRONG) return true;
        if (decision.reason === "nudity" || decision.reason === "sexual") return (a.nudity ?? 0) >= 0.7 || (a.sexual ?? 0) >= 0.7;
        if (decision.reason === "woman") return (a.people || []).some((p) => p.gender === "female" && (p.genderScore ?? 0) >= 0.8);
        return false;
    }

    async check(now) {
        this.busy = true;
        this.lastFull = now;
        const gen = this.gen || 0;
        this.lastSeenTime = this.v.currentTime;
        const dataUrl = this.grabFrame();
        let r;
        if (!dataUrl) {
            // فيديو من موقع آخر لا تُقرأ صورته في الصفحة: التطبيق يقرأ اللقطة من رابط الفيديو نفسه
            const src = this.v.currentSrc;
            const t0 = performance.now();
            // مقطع مؤكد السلامة: لقطة واحدة تكفي لإعادة الفحص (نصف الحمل والحرارة)؛ أول فحص بلقطتين
            const single = this.v.getAttribute(ATTR) === "ok";
            r = /^https?:/.test(src) && globalThis.webkit?.messageHandlers?.hisn
                ? await send(api, { type: MSG.DETECT_FRAME, videoSrc: src, time: this.v.currentTime, page: location.href, single })
                : null;
            if (!r?.analysis) {
                this.errors++;
                if (this.errors === 1) diag(`video frame unreadable (${location.hostname.replace(/^www\./, "")} ${src.split(":")[0]}${r?.error ? " " + r.error : ""})`);
                if (this.v.getAttribute(ATTR) !== "revealed") setMediaState(this.v, "error", "error");
                this.busy = false;
                return;
            }
            if (!this.nativeLogged) { this.nativeLogged = true; diag(`video frame read by app (${location.hostname.replace(/^www\./, "")}) in ${Math.round(performance.now() - t0)}ms`); }
        } else {
            r = await send(api, { type: MSG.DETECT_FRAME, dataUrl });
        }
        this.busy = false;
        if (typeof r?.thermal === "number") this.thermal = r.thermal;
        if (!r?.analysis) return;
        if (gen !== (this.gen || 0)) return; // نتيجة لمقطع/موضع سابق: تُهمل
        // من التطبيق: لقطتان (الآن وبعد نصف ثانية). نأخذ الأسوأ، وإن سلمتا معًا فهو تأكيد كامل
        let both = false;
        if (r.analysis2) {
            const d1 = decideImage(r.analysis, this.settings), d2 = decideImage(r.analysis2, this.settings);
            const stateNow = this.v.getAttribute(ATTR);
            // مقطع مؤكد السلامة ولقطة واحدة من الاثنتين مخالفة بدرجة متوسطة (لا عري واضح): لقطة عابرة على الأغلب
            // (يد، حركة، لقطة مشوّشة) — لا نعود للتغطية بها حتى لا «يومض» المقطع تغطيةً وإظهارًا
            const oneOff = stateNow === "ok" && this.confirmed && (d1.action === "show") !== (d2.action === "show")
                && !this.strongVerdict(d1.action === "show" ? r.analysis2 : r.analysis, d1.action === "show" ? d2 : d1);
            if (oneOff) { this.flickers = (this.flickers || 0) + 1; if (this.flickers <= 3) diag(`video one-off ${d1.action === "show" ? d2.reason : d1.reason} ignored t=${Math.round(this.v.currentTime)}`); r = { analysis: d1.action === "show" ? r.analysis : r.analysis2 }; both = false; }
            else if (d2.action !== "show") r = { analysis: r.analysis2 };
            else both = d1.action === "show";
        } // المحرك لم يجهز أو اللقطة تأخرت: لا حكم جديد (ينتهي القديم بعد VERDICT_TTL)
        this.lastVerdict = performance.now();
        let decision = decideImage(r.analysis, this.settings);
        // في الفيديو المرأة تبقى في المشهد حتى لو غاب وجهها لحظة (يد، ظهر، لقطة بعيدة): حكم أقل من
        // حكم الصورة الواحدة يكفي، ولا نُظهر المقطع مباشرة بعد لقطة فيها امرأة إلا بلقطة خالية تمامًا
        const nowT = performance.now();
        const sw = r.analysis.scene?.woman ?? 0;
        if (decision.action !== "show" && (decision.reason === "woman" || decision.reason === "scene-woman")) this.womanAt = nowT;
        if (decision.action === "show" && this.settings.blurAdultWomen && this.settings.level !== "light") {
            const recent = nowT - (this.womanAt || 0) < WOMAN_MEMORY;
            const unsure = (r.analysis.people || []).some((p) => p.gender === "unknown");
            if (sw >= VIDEO_SCENE_WOMAN || (recent && (sw >= VIDEO_SCENE_WOMAN_RECENT || unsure))) decision = { action: "blur", reason: "scene-woman" };
            else if (this.settings.blurCoveredWomen && (r.analysis.scene?.covered ?? 0) >= VIDEO_SCENE_WOMAN) decision = { action: "blur", reason: "woman" };
        }
        const state = this.v.getAttribute(ATTR);
        // لقطة مخالفة واحدة على مقطع مؤكد السلامة: نؤجل التغطية إلى لقطة ثانية تؤكدها (إلا الواضح)
        if (decision.action !== "show" && state === "ok" && this.confirmed && !this.strongVerdict(r.analysis, decision)) {
            const suspect = this.suspectAt && nowT - this.suspectAt < SUSPECT_WINDOW;
            if (!suspect) {
                this.suspectAt = nowT;
                this.lastFull = nowT - BASE_INTERVAL + CONFIRM_AFTER; // لقطة ثانية سريعة
                diag(`video suspect ${decision.action}/${decision.reason} t=${Math.round(this.v.currentTime)} (waiting for a second frame)`);
                return;
            }
        }
        if (decision.action === "show") this.suspectAt = 0;
        // تشخيص (في التطبيق فقط): ماذا رأى الكاشف عند تغيّر الحكم
        const sig = decision.action + "/" + (decision.reason || "");
        if (sig !== this.lastSig) {
            this.lastSig = sig;
            const a = r.analysis, people = (a.people || []).map((p) => `${p.gender || "?"}${p.adult === false ? "-child" : ""}:${Math.round((p.genderScore ?? 0) * 100)}`).join(",");
            const sc = a.scene ? `w${Math.round((a.scene.woman || 0) * 100)}/s${Math.round((a.scene.sexual || 0) * 100)}/c${Math.round((a.scene.covered || 0) * 100)}/k${Math.round((a.scene.scary || 0) * 100)}` : "-";
            diag(`video verdict ${sig} t=${Math.round(this.v.currentTime)} people=[${people}] scene=${sc} nud=${Math.round((a.nudity || 0) * 100)}`);
        }
        if (decision.action !== "show") {
            this.clear = 0;
            // نتذكر أن لقطات هذا المقطع مخالفة: لا ظهور سريع له بعد إعادة بناء العنصر
            if (decision.reason !== "not-analyzed" && decision.reason !== "error") rememberBlockedVideo(this.v);
            if (state === "revealed") return; // المستخدم اختار الإظهار لهذا المقطع
            // المتوسط: المرأة وحدها تُغطّى ويستمر المقطع؛ والصناديق أوسع لأن الناس يتحركون بين فحص وآخر
            const covers = decision.action === "blur" ? partialImage(r.analysis, this.settings) : null;
            if (covers) {
                const grow = ([x, y, w, h]) => [Math.max(0, x - w * 0.15), Math.max(0, y - h * 0.08), Math.min(1, w * 1.3), Math.min(1, h * 1.16)];
                setPartial(this.v, covers.map((c) => ({ ...c, box: grow(c.box) })));
                return;
            }
            setMediaState(this.v, decision.action, decision.reason);
            if (this.settings.autoSkipShortVideos && (decision.reason === "nudity" || decision.reason === "sexual" || decision.action === "blur")) {
                skipShortVideo(this.v);
            }
        } else {
            this.clear += both ? CLEAR_FRAMES_TO_SHOW : 1;
            if (this.clear >= CLEAR_FRAMES_TO_SHOW && state !== "revealed") {
                this.confirmed = true;
                setMediaState(this.v, "ok");
                if (!this.logged && this.pendingSince) { this.logged = true; diag(`video shown after ${Math.round(performance.now() - this.pendingSince)}ms`); }
            } else {
                // تأكيد سريع بلقطة ثانية بدل انتظار الدورة كاملة
                this.lastFull = performance.now() - BASE_INTERVAL + CONFIRM_AFTER;
            }
        }
    }
}

/** تشخيص خفيف إلى سجل الجهاز (في التطبيق فقط؛ لا شيء في الإضافة). */
let diagCount = 0;
function diag(text) {
    if (!globalThis.webkit?.messageHandlers?.hisn || diagCount++ > 40) return;
    globalThis.webkit.messageHandlers.hisn.postMessage({ type: "hisn:log", text }).catch?.(() => {});
}

export function watchVideo(video, settings) {
    const m = monitors.get(video);
    if (m) {
        m.settings = settings;
        m.reset();
        return;
    }
    monitors.set(video, new VideoMonitor(video, settings));
}

/** إيقاف الحماية: تتوقف كل مراقبات الإطارات (لا فحص ولا تغيير حالة بعدها)؛ تُنشأ من جديد عند التفعيل */
export function stopVideoMonitors() {
    for (const v of document.querySelectorAll("video")) {
        const m = monitors.get(v);
        if (m) { m.stopped = true; m.gen = (m.gen || 0) + 1; monitors.delete(v); }
    }
}

export function updateVideoSettings(settings) {
    for (const v of document.querySelectorAll("video")) {
        const m = monitors.get(v);
        if (m) m.settings = settings;
    }
}
