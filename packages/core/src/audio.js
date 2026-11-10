// قرارات الصوت: كتم الموسيقى (من نموذج YAMNet)، وكتم الألفاظ المنطوقة (من الترجمة المصاحبة).
// الدوال هنا لا تعتمد على المتصفح، فتُستخدم في الإضافة وتُختبر في Node.

/** طول نافذة YAMNet: 0.975 ثانية بتردد 16 كيلوهرتز. */
export const YAMNET_RATE = 16000;
export const YAMNET_WINDOW = 15600;

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// فئات AudioSet في YAMNet (521 فئة). الأرقام من yamnet_label_list.txt.
export const AUDIO_GROUPS = {
    speech: [0, 1, 2, 3],
    // الغناء والإنشاد والتلاوة المجودة تتشابه صوتيًا، ولا نفرّق بينها إلا بوجود الآلات
    vocal: [...range(24, 32), 249, 250],
    music: [132],
    // الآلات (بلا الأجراس والمنبهات: جرس الكنيسة وجرس الدراجة ليسا موسيقى)
    instrument: [...range(133, 194), ...range(203, 208), 210],
    // أنواع الموسيقى (بلا "موسيقى صوتية" و"أكابيلا" فهي غناء بلا آلات)
    genre: range(211, 276).filter((i) => i !== 249 && i !== 250),
};

/** يلخص درجات النموذج (521) إلى ما تحتاجه سياسة الصوت. */
export function summarizeAudio(scores) {
    const max = (ids) => ids.reduce((m, i) => Math.max(m, scores[i] ?? 0), 0);
    return {
        speech: max(AUDIO_GROUPS.speech),
        vocal: max(AUDIO_GROUPS.vocal),
        music: max(AUDIO_GROUPS.music),
        instrument: max(AUDIO_GROUPS.instrument),
        genre: max(AUDIO_GROUPS.genre),
    };
}

/**
 * هل يمكن أن يكون هذا غناءً؟ كاشف النغمة وحده يخلط بين الغناء والكلام المنغّم (أصوات الرسوم المتحركة)،
 * فلا نكتم «المغني» حين يسمع النموذج كلامًا واضحًا لا غناء فيه.
 */
export function hearsSinging(a) {
    return !!a && !(a.speech >= 0.4 && a.vocal < a.speech * 0.5);
}

/**
 * هل هذه النافذة موسيقى تُكتم؟
 * - الآلات أو أنواع الموسيقى أو "موسيقى" بثقة كافية ← موسيقى.
 * - صوت بشري (غناء/إنشاد/تلاوة) بلا آلات تقريبًا ← لا يُكتم إذا سمح المستخدم بالأناشيد (الافتراضي)،
 *   لأن تلاوة القرآن المجودة قد تُصنَّف "غناء" أو "ترتيل" ولا يجوز أن نكتمها.
 * @returns {{ music: boolean, reason: string }}
 */
export function classifyMusic(a, settings = {}) {
    const allowVocal = settings.allowNasheedsWithoutInstruments !== false;
    const instrumental = a.instrument >= 0.25 || a.genre >= 0.3;
    const vocalOnly = a.vocal >= 0.2 && a.instrument < 0.12 && a.genre < 0.2;
    if (vocalOnly && allowVocal) return { music: false, reason: "vocal" };
    if (instrumental) return { music: true, reason: "instrument" };
    // كلام واضح مع دلالة موسيقى ضعيفة (بلا آلات) لا يُكتم؛ الموسيقى الواضحة تُكتم ولو معها كلام
    const speechOverFaint = a.speech >= 0.5 && a.music < 0.5 && a.instrument < 0.12;
    if (a.music >= 0.35 && !speechOverFaint) return { music: true, reason: "music" };
    return { music: false, reason: a.speech >= 0.5 ? "speech" : "other" };
}

/**
 * بوابة الكتم: تكتم من أول نافذة موسيقية، ولا تفتح إلا بعد نافذتين سليمتين متتاليتين،
 * حتى لا يتقطع الصوت مع كل نغمة.
 */
export class MusicGate {
    constructor({ openAfter = 2 } = {}) {
        this.openAfter = openAfter;
        this.muted = false;
        this.clean = 0;
    }

    /** @returns {boolean} هل يُكتم الآن */
    push(isMusic) {
        if (isMusic) {
            this.muted = true;
            this.clean = 0;
        } else if (this.muted && ++this.clean >= this.openAfter) {
            this.muted = false;
            this.clean = 0;
        }
        return this.muted;
    }

    reset() {
        this.muted = false;
        this.clean = 0;
    }
}

// ===== الألفاظ المنطوقة =====

/**
 * يقرأ ترجمة يوتيوب بصيغة json3: أحداث فيها بداية ومدة، وأحيانًا توقيت لكل كلمة (الترجمة الآلية).
 * @returns {{ start: number, end: number, text: string, words: { start: number, text: string }[] }[]} بالثواني
 */
export function parseYouTubeJson3(json) {
    const out = [];
    for (const ev of json?.events ?? []) {
        if (!ev.segs) continue;
        const start = (ev.tStartMs ?? 0) / 1000;
        const end = start + (ev.dDurationMs ?? 0) / 1000;
        const words = ev.segs
            .filter((s) => s.utf8 && s.utf8 !== "\n")
            .map((s) => ({ start: start + (s.tOffsetMs ?? 0) / 1000, text: s.utf8 }));
        const text = words.map((w) => w.text).join("").trim();
        if (text) out.push({ start, end, text, words });
    }
    return out;
}

/**
 * يحوّل جمل الترجمة إلى فترات كتم: إن كان للكلمات توقيت نكتم الكلمة وحدها (من بدايتها حتى الكلمة التالية)،
 * وإلا نكتم الجملة كلها. مع هامش صغير قبل وبعد.
 * @param {{ start: number, end: number, text: string, words?: { start: number, text: string }[] }[]} cues
 * @param {import("./textFilter.js").TextFilter} filter
 */
export function muteIntervals(cues, filter, { pad = 0.15 } = {}) {
    const out = [];
    for (const cue of cues) {
        const ranges = filter.findProfanity(cue.text);
        if (!ranges.length) continue;
        const words = cue.words ?? [];
        const timed = words.length > 1 && words.some((w) => w.start > cue.start);
        if (!timed) {
            out.push([Math.max(0, cue.start - pad), cue.end + pad]);
            continue;
        }
        // موضع كل كلمة داخل نص الجملة، لنعرف أي الكلمات فيها اللفظ
        let pos = 0;
        const leading = words.length ? words.map((w) => w.text).join("").length - words.map((w) => w.text).join("").trimStart().length : 0;
        words.forEach((w, i) => {
            const from = pos - leading;
            const to = from + w.text.length;
            pos += w.text.length;
            if (ranges.some((r) => r.start < to && r.end > from)) {
                const end = i + 1 < words.length ? words[i + 1].start : cue.end;
                out.push([Math.max(0, w.start - pad), end + pad]);
            }
        });
    }
    return mergeIntervals(out);
}

export function mergeIntervals(list) {
    const s = [...list].sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [a, b] of s) {
        const last = out[out.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
    }
    return out;
}

export function inIntervals(t, intervals) {
    return intervals.some(([a, b]) => t >= a && t < b);
}

// ===== تجهيز الصوت =====

/** يحوّل عينات من أي تردد إلى 16 كيلوهرتز (متوسط بسيط ثم استيفاء خطي). */
export function resampleTo16k(input, rate) {
    if (rate === YAMNET_RATE) return Float32Array.from(input);
    const ratio = rate / YAMNET_RATE;
    const n = Math.floor(input.length / ratio);
    const out = new Float32Array(n);
    const half = Math.max(0, Math.floor(ratio / 2));
    for (let i = 0; i < n; i++) {
        const c = i * ratio;
        const a = Math.max(0, Math.floor(c) - half);
        const b = Math.min(input.length - 1, Math.floor(c) + half);
        let sum = 0;
        for (let k = a; k <= b; k++) sum += input[k];
        out[i] = sum / (b - a + 1);
    }
    return out;
}

/** Float32 (−1..1) ← → Int16 بنص base64، لإرسال الصوت بين أجزاء الإضافة بحجم صغير. */
export function encodePcm16(samples) {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) {
        const v = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(i * 2, Math.round(v * 32767), true);
    }
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

export function decodePcm16(b64) {
    const bin = atob(b64);
    const out = new Float32Array(bin.length / 2);
    for (let i = 0; i < out.length; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        out[i] = v / 32767;
    }
    return out;
}

// ===== المغني بعد إزالة الموسيقى =====

/**
 * يميّز الغناء من الكلام في الصوت البشري الذي بقي بعد إزالة الآلات:
 * الغناء نغمات تثبت على درجة واحدة 0.3 ثانية فأكثر، والكلام تتغير درجته باستمرار.
 * يعمل على 16kHz: إطار 40ms كل 10ms، ويحكم على آخر 3 ثوانٍ.
 * (جُرّب على أغنية بعد إزالة موسيقاها: 0.21–0.38، وعلى كلام فوق موسيقى: 0.)
 */
export class SingingDetector {
    constructor({ rate = 16000, minRun = 30, tolSemitones = 0.6, threshold = 0.15, minVoiced = 80 } = {}) {
        this.rate = rate;
        this.win = Math.round(rate * 0.04);
        this.hop = Math.round(rate * 0.01);
        this.minLag = Math.floor(rate / 800);
        this.maxLag = Math.ceil(rate / 80);
        this.minRun = minRun;
        this.tol = tolSemitones;
        this.threshold = threshold;
        this.minVoiced = minVoiced;
        this.buf = new Float32Array(this.win + this.maxLag + rate); // يتسع لثانية من العينات الجديدة
        this.len = 0;
        this.f0 = []; // آخر 300 إطار
    }

    /** يضيف عينات (16kHz) ويحسب درجة الصوت لكل إطار مكتمل. */
    push(samples) {
        const need = this.win + this.maxLag;
        if (this.len + samples.length > this.buf.length) {
            const keep = Math.min(this.len, need);
            this.buf.copyWithin(0, this.len - keep, this.len);
            this.len = keep;
            if (samples.length > this.buf.length - this.len) samples = samples.subarray(samples.length - (this.buf.length - this.len));
        }
        this.buf.set(samples, this.len);
        this.len += samples.length;
        let pos = 0;
        while (pos + need <= this.len) {
            this.f0.push(this.pitch(pos));
            pos += this.hop;
        }
        this.buf.copyWithin(0, pos, this.len);
        this.len -= pos;
        if (this.f0.length > 300) this.f0.splice(0, this.f0.length - 300);
    }

    pitch(p) {
        const b = this.buf, w = this.win;
        let e = 0;
        for (let i = 0; i < w; i++) e += b[p + i] * b[p + i];
        if (e < 1e-4 * w) return 0;
        let best = 0, bestLag = 0;
        for (let lag = this.minLag; lag < this.maxLag; lag++) {
            let c = 0, e2 = 0;
            for (let i = 0; i < w; i++) {
                const v = b[p + lag + i];
                c += b[p + i] * v;
                e2 += v * v;
            }
            const r = c / Math.sqrt(e * e2 + 1e-12);
            if (r > best) { best = r; bestLag = lag; }
        }
        return best > 0.75 ? this.rate / bestLag : 0;
    }

    /** نسبة الإطارات الصوتية الواقعة في نغمات ثابتة، وعدد الإطارات الصوتية، في آخر 3 ثوانٍ. */
    measure() {
        const f = this.f0;
        const voiced = f.filter((x) => x > 0).length;
        if (voiced < 40) return { ratio: 0, voiced };
        let sus = 0;
        for (let i = 0; i < f.length; ) {
            if (f[i] <= 0) { i++; continue; }
            let j = i;
            const ref = f[i];
            while (j + 1 < f.length && f[j + 1] > 0 && Math.abs(Math.log2(f[j + 1] / ref)) * 12 < this.tol) j++;
            if (j - i + 1 >= this.minRun) sus += j - i + 1;
            i = j + 1;
        }
        return { ratio: sus / voiced, voiced };
    }

    isSinging() {
        const m = this.measure();
        return m.voiced >= this.minVoiced && m.ratio >= this.threshold;
    }
}
