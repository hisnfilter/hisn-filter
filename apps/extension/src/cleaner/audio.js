// صوت الفيديو: إزالة الموسيقى مع إبقاء الكلام، وكتم المغني، وكتم الألفاظ (حين تتوفر فتراتها).
// يعمل على الملف كاملًا قبل المشاهدة، فيرى ما قبل اللحظة وما بعدها (أدق من المعالجة المباشرة).
// يعمل على دفعات (لا يُحمَّل الصوت كله في الذاكرة)، فيصلح للفيديو الطويل على الجوال:
//   المرور 1: نسخة 16kHz أحادية خفيفة ← أين الموسيقى (YAMNet كل نصف ثانية)
//   المرور 2: مقاطع الموسيقى فقط ← نموذج الفصل يقدّر الموسيقى وحدها، وهل الباقي غناء
//   المرور 3: الصوت الأصلي ناقص الموسيقى المقدّرة ← الترميز مباشرة (الكلام هو المسجّل نفسه)
import { classifyMusic, hearsSinging, SingingDetector, YAMNET_WINDOW } from "@hisn/core";
import { toChunk } from "./demux.js";
import { ambientPair } from "./ambient.js";
import { MDX_RATE, polishHighBand } from "./separate.js";

const HOP = 8000; // نصف ثانية بتردد 16kHz
const CONTEXT = 1; // ثانية سياق قبل كل مقطع وبعده (النموذج يرى ما حول الحدود)
const FADE = 0.05;

// ===================== أدوات =====================

/** إعادة تشكيل خطية متصلة عبر الدفعات. */
export class Resampler {
    constructor(from, to) {
        this.ratio = from / to;
        this.same = from === to;
        this.t = 0; // موضع العينة الناتجة التالية بوحدات الدخل
        this.base = 0; // رقم أول عينة في الدفعة الحالية
        this.last = null;
    }

    push(x) {
        if (this.same) return x;
        const off = this.last === null ? 0 : 1;
        const buf = off ? new Float32Array(x.length + 1) : x;
        if (off) { buf[0] = this.last; buf.set(x, 1); }
        const out = new Float32Array(Math.ceil((x.length + 1) / this.ratio) + 1);
        let n = 0;
        for (;;) {
            const p = this.t - this.base + off;
            const k = Math.floor(p);
            if (k + 1 >= buf.length) break;
            const f = p - k;
            out[n++] = buf[k] * (1 - f) + buf[k + 1] * f;
            this.t += this.ratio;
        }
        this.base += x.length;
        if (x.length) this.last = x[x.length - 1];
        return out.subarray(0, n);
    }
}

export function resample(x, from, to) {
    if (from === to) return x;
    return new Resampler(from, to).push(x);
}

function mono(chans) {
    if (chans.length === 1) return chans[0];
    const y = new Float32Array(chans[0].length);
    for (const c of chans) for (let i = 0; i < y.length; i++) y[i] += c[i] / chans.length;
    return y;
}

/** مصفوفة تكبر تدريجيًا (للنسخة الخفيفة 16kHz). */
class Grow {
    constructor(n = 16000 * 60) { this.a = new Float32Array(n); this.n = 0; }
    push(x) {
        if (this.n + x.length > this.a.length) {
            const b = new Float32Array(Math.max(this.a.length * 2, this.n + x.length));
            b.set(this.a.subarray(0, this.n));
            this.a = b;
        }
        this.a.set(x, this.n);
        this.n += x.length;
    }
    get value() { return this.a.subarray(0, this.n); }
}

// ===================== فك التشفير على دفعات =====================

/**
 * يمر على صوت الملف بالترتيب ويستدعي onBlock(channels, sampleRate) لكل دفعة — بعد تطبيق قائمة التحرير
 * (حذف عينات التهيئة في البداية، أو صمت قبلها إن كان الصوت متأخرًا).
 */
export async function decodeStream(track, reader, file, onBlock) {
    // Opus: بعض المتصفحات تحذف «عينات التخطي» داخل الفك، وبعضها لا، وقائمة التحرير تحذفها أيضًا (فتُحذف مرتين).
    // نوحّد: الفك لا يحذف شيئًا (preskip = 0)، ونحذف نحن مرة واحدة: حسب قائمة التحرير، وإلا حسب preskip.
    const preskip = opusPreskip(track.description);
    const cfg = { codec: track.codec, sampleRate: track.sampleRate, numberOfChannels: track.channels, description: preskip ? zeroPreskip(track.description) : track.description };
    const ok = typeof AudioDecoder !== "undefined" && (await AudioDecoder.isConfigSupported(cfg).catch(() => null))?.supported;
    if (!ok) {
        // بديل (مثل Safari قبل iOS 26): يفك المتصفح صوت الملف كله ويطبق التحرير بنفسه
        if (!file) throw new Error("لا يمكن فك صوت هذا الملف على هذا الجهاز");
        const ctx = new OfflineAudioContext(Math.max(1, track.channels), 1, track.sampleRate);
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
        const step = buf.sampleRate * 2;
        for (let i = 0; i < buf.length; i += step) await onBlock(chans.map((c) => c.subarray(i, i + step)), buf.sampleRate);
        return;
    }
    const queue = [];
    let failure = null;
    const dec = new AudioDecoder({ output: (d) => queue.push(d), error: (e) => { failure = e; } });
    dec.configure(cfg);
    const shift = preskip && !track.hasEdits ? -preskip / 48000 : track.shift ?? 0;
    let skip = shift < 0 ? Math.round(-shift * track.sampleRate) : 0;
    let leadDone = shift <= 0;
    const drain = async () => {
        while (queue.length) {
            const d = queue.shift();
            const rate = d.sampleRate;
            const chans = [];
            for (let c = 0; c < d.numberOfChannels; c++) {
                const a = new Float32Array(d.numberOfFrames);
                d.copyTo(a, { planeIndex: c, format: "f32-planar" });
                chans.push(a);
            }
            d.close();
            if (!leadDone) {
                leadDone = true;
                const n = Math.round(shift * rate);
                if (n > 0) await onBlock(chans.map(() => new Float32Array(n)), rate);
            }
            if (skip >= chans[0].length) { skip -= chans[0].length; continue; }
            const block = skip ? chans.map((c) => c.subarray(skip)) : chans;
            skip = 0;
            await onBlock(block, rate);
        }
    };
    for (const s of track.samples) {
        if (failure) throw failure;
        dec.decode(toChunk(s, await reader.read(s), EncodedAudioChunk));
        if (dec.decodeQueueSize > 16 || queue.length > 8) {
            await new Promise((r) => setTimeout(r, 0));
            await drain();
        }
    }
    await dec.flush();
    await drain();
    dec.close();
    if (failure) throw failure;
}

// ===================== تحليل =====================

/**
 * يقرر لكل نصف ثانية: موسيقى أم لا، ثم يوسّع الفترات قليلًا (حتى لا تُسمع أول نغمة أو آخرها).
 * @param {(win: Float32Array) => Promise<object>} analyzeAudio نموذج YAMNet
 */
async function musicMask(x16, settings, analyzeAudio, onProgress) {
    const n = Math.max(1, Math.ceil(x16.length / HOP));
    const raw = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
        const win = new Float32Array(YAMNET_WINDOW);
        win.set(x16.subarray(i * HOP, i * HOP + YAMNET_WINDOW));
        let peak = 0;
        for (let k = 0; k < win.length; k += 16) peak = Math.max(peak, Math.abs(win[k]));
        if (peak >= 1e-3) raw[i] = classifyMusic(await analyzeAudio(win), settings).music;
        onProgress?.(i / n);
    }
    // توسيع: نصف ثانية قبل وثانية بعد، وسد الفجوات القصيرة (أقل من ثانيتين) داخل المقطع الموسيقي
    const mask = raw.slice();
    for (let i = 0; i < n; i++) if (raw[i]) { if (i > 0) mask[i - 1] = true; if (i + 1 < n) mask[i + 1] = true; if (i + 2 < n) mask[i + 2] = true; }
    let last = -1;
    for (let i = 0; i < n; i++) {
        if (mask[i]) {
            if (last >= 0 && i - last > 1 && i - last <= 4) for (let k = last + 1; k < i; k++) mask[k] = true;
            last = i;
        }
    }
    return mask;
}

function segmentsOf(mask, strict) {
    const segs = [];
    for (let i = 0; i < mask.length; ) {
        if (!mask[i] && !strict) { i++; continue; }
        let j = i;
        while (j + 1 < mask.length && (mask[j + 1] || strict)) j++;
        segs.push({ a: (i * HOP) / 16000, b: ((j + 1) * HOP) / 16000, w0: i, w1: j + 1 });
        i = j + 1;
    }
    return segs;
}

/**
 * @returns {Promise<{ sampleRate:number, channels:number, segs:object[], report:object, muteIntervals:number[][] }>}
 *          خطة الصوت (ما يُستبدل في كل مقطع موسيقي)، ثم renderAudio يطبقها أثناء الترميز.
 */
export async function planAudio(track, reader, file, settings, { analyzeAudio, separate, muteIntervals = [], onProgress }) {
    const report = { musicSeconds: 0, singerSeconds: 0, profanityMutes: muteIntervals.length };
    let rate = track.sampleRate, channels = track.channels;
    if (!settings.removeMusic) return { sampleRate: rate, channels, segs: [], report, muteIntervals };

    // المرور 1: نسخة 16kHz أحادية
    const x16g = new Grow();
    let to16 = null;
    await decodeStream(track, reader, file, (chans, r) => {
        rate = r; channels = chans.length;
        to16 ??= new Resampler(r, 16000);
        x16g.push(to16.push(mono(chans)));
    });
    const x16 = x16g.value;
    const mask = await musicMask(x16, settings, analyzeAudio, (p) => onProgress?.("music", p));
    const segs = segmentsOf(mask, settings.level === "strict");
    for (const s of segs) s.b = Math.min(s.b, x16.length / 16000);
    if (!segs.length) return { sampleRate: rate, channels, segs, report, muteIntervals };

    // المرور 2: جمع مقاطع الموسيقى فقط (بالتردد والقنوات الأصلية) مع ثانية سياق قبل كل مقطع وبعده
    const dur = x16.length / 16000;
    for (const s of segs) {
        s.p0 = Math.max(0, s.a - CONTEXT);
        s.p1 = Math.min(dur, s.b + CONTEXT);
        const n = Math.ceil((s.p1 - s.p0) * rate) + 1;
        s.buf = [new Float32Array(n), new Float32Array(n)];
        s.n = 0;
    }
    let pos = 0;
    await decodeStream(track, reader, file, (chans) => {
        const len = chans[0].length, t0 = pos, t1 = pos + len;
        for (const s of segs) {
            const a = Math.round(s.p0 * rate), b = Math.min(a + s.buf[0].length, Math.round(s.p1 * rate));
            const from = Math.max(a, t0), to = Math.min(b, t1);
            if (to <= from) continue;
            for (let c = 0; c < 2; c++) s.buf[c].set((chans[c] ?? chans[0]).subarray(from - t0, to - t0), from - a);
            s.n = Math.max(s.n, to - a);
        }
        pos = t1;
    });

    // الفصل: نقدّر الموسيقى وحدها في كل مقطع، ونحفظها لتُطرح من الأصل عند الكتابة.
    // صوت المتكلم لا يُعاد توليده: يبقى هو المسجّل نفسه.
    const separator = await separate.create();
    try {
        return await separateSegments(separator, segs, mask, x16, rate, channels, settings, report, muteIntervals, analyzeAudio, onProgress);
    } finally {
        separator.release?.(); // يحرر ذاكرة النموذج قبل فحص الصور
    }
}

async function separateSegments(separator, segs, mask, x16, rate, channels, settings, report, muteIntervals, analyzeAudio, onProgress) {
    const muteSinger = settings.muteSingerAfterMusicRemoval !== false;
    const total = Math.max(1, segs.reduce((n, s) => n + s.n, 0));
    let done = 0;
    for (const s of segs) {
        const L = resample(s.buf[0].subarray(0, s.n), rate, MDX_RATE), R = resample(s.buf[1].subarray(0, s.n), rate, MDX_RATE);
        const [m0, m1] = await separator.music(L, R, (p) => onProgress?.("clean", (done + p * s.n) / total));
        done += s.n;
        // الموسيقى المقدّرة بتردد الملف، للجزء [a, b] فقط
        const off = Math.round((s.a - s.p0) * rate), len = Math.max(0, Math.round((s.b - s.a) * rate));
        const back = [resample(m0, MDX_RATE, rate), resample(m1, MDX_RATE, rate)];
        // تحسين الترددات العالية (بقايا الصنج والإيقاع خلف الكلام)، ثم حفظ الموسيقى كأعداد 16 بت
        const xs = [0, 1].map((c) => s.buf[c].subarray(off, off + len));
        const ms = back.map((m) => { const r = new Float32Array(len); r.set(m.subarray(off, off + len)); return r; });
        const polished = polishHighBand(xs, ms, rate);
        s.music = polished.map((m) => {
            const q = new Int16Array(len);
            for (let i = 0; i < len; i++) q[i] = Math.max(-32768, Math.min(32767, Math.round((m[i] ?? 0) * 32767)));
            return q;
        });
        // المغني: ما يبقى بعد حذف الموسيقى، إن كان غناءً كُتم المقطع كله (حسب الإعداد)
        // ما بقي بعد الطرح: الكلام (يبقى كما هو)، وأحيانًا موسيقى لم يفصلها النموذج (أصوات تشبه الصوت البشري)
        const rest = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const x = ((s.buf[0][off + i] ?? 0) + (s.buf[1][off + i] ?? 0)) / 2;
            rest[i] = x - (s.music[0][i] + s.music[1][i]) / 65534;
        }
        const r16 = resample(rest, rate, 16000);
        // بقايا موسيقى: نافذة بلا أي كلام ← تُصمت. أي أثر كلام (ولو خافت) أو ملاصقة لكلام ← لا تُمس أبدًا.
        const nWin = s.w1 - s.w0;
        const leftover = new Array(nWin).fill(false), speechy = new Array(nWin).fill(false), sung = new Array(nWin).fill(false);
        for (let w = 0; w < nWin; w++) {
            const win = new Float32Array(YAMNET_WINDOW);
            win.set(r16.subarray(w * HOP, w * HOP + YAMNET_WINDOW));
            let peak = 0;
            for (let k = 0; k < win.length; k += 16) peak = Math.max(peak, Math.abs(win[k]));
            if (peak < 1e-3) continue;
            const a = await analyzeAudio(win);
            speechy[w] = a.speech >= 0.2;
            sung[w] = hearsSinging(a);
            // داخل مقطع موسيقي: ما ليس كلامًا مما بقي هو بقايا الموسيقى (أو غناء يتولاه كاتم المغني)
            leftover[w] = !speechy[w];
        }
        s.leftover = leftover.map((v, w) => v && !speechy[w - 1] && !speechy[w + 1]);
        // المغني: يُكتم موضع الغناء وحده (لا المقطع كله)، ويلزم أن يتفق كاشف النغمة ونموذج الصوت
        const singerWin = new Array(nWin).fill(false);
        if (muteSinger) {
            const det = new SingingDetector();
            const singSec = [];
            for (let t = 0; t < r16.length; t += 16000) {
                det.push(r16.subarray(t, t + 16000));
                singSec.push(det.isSinging());
            }
            // الكاشف ينظر لآخر 3 ثوانٍ: الغناء المكتشف عند ثانية t قد بدأ قبلها بثانيتين
            const singAt = (sec) => singSec.slice(Math.max(0, sec), sec + 3).some(Boolean);
            for (let w = 0; w < nWin; w++) singerWin[w] = sung[w] && singAt(Math.floor((w * HOP) / 16000));
            // لا نكتم نافذة منفردة (نَفَس أو مدّ في الكلام)
            for (let w = 0; w < nWin; w++) if (singerWin[w] && !singerWin[w - 1] && !singerWin[w + 1] && !sung[w - 1] && !sung[w + 1]) singerWin[w] = false;
        }
        Object.assign(s, guardMutes(s.leftover, singerWin, speechy, sung));
        s.singer = false;
        s.buf = null;
        report.musicSeconds += s.b - s.a;
        report.singerSeconds += s.singerWin.filter(Boolean).length * (HOP / 16000);
        if (s.guarded) report.keptVoice = true;
    }
    report.separator = separator.backend;
    report.bed = settings.musicBed && settings.musicBed !== "none" ? settings.musicBed : undefined;
    report.windows = mask.map((m, i) => {
        const s = segs.find((q) => i >= q.w0 && i < q.w1);
        return s ? (s.singerWin[i - s.w0] ? "S" : s.leftover[i - s.w0] ? "m" : "M") : ".";
    }).join("");
    return { sampleRate: rate, channels, segs, report, muteIntervals };
}

/**
 * أمان: لا يخرج فيديو صامت من فيديو فيه كلام. إذا كان الكتم سيغطي معظم المقطع وفيه كلام مسموع،
 * فالأرجح أن الكشف أخطأ (كلام منغّم كأصوات الرسوم المتحركة): نكتفي بحذف الموسيقى ونُبقي الصوت.
 * @returns {{ leftover: boolean[], singerWin: boolean[], guarded: boolean }} leftover يشمل نوافذ المغني (تُكتم بتلاشٍ)
 */
export function guardMutes(leftover, singerWin, speechy, sung) {
    const n = leftover.length;
    if (!n) return { leftover, singerWin, guarded: false };
    const count = (f) => { let k = 0; for (let w = 0; w < n; w++) if (f(w)) k++; return k / n; };
    const talk = count((w) => speechy[w] && !sung[w]);
    let guarded = false;
    if (count((w) => leftover[w] || singerWin[w]) > 0.6 && talk >= 0.15) {
        singerWin = singerWin.map(() => false);
        guarded = true; // بقايا الموسيقى (نوافذ بلا كلام) تبقى مكتومة: كتمها لا يمس الكلام
    }
    return { leftover: leftover.map((v, w) => v || singerWin[w]), singerWin, guarded };
}

// ===================== الكتابة =====================

/**
 * المرور 3: الصوت الأصلي دفعةً دفعة، تُستبدل مقاطع الموسيقى بالنظيف (مع تلاشٍ 50ms عند الحدود)
 * وتُكتم فترات الألفاظ، ثم تُسلَّم الدفعة لـ write(channels, sampleRate).
 */
export async function renderAudio(track, reader, file, plan, write) {
    let pos = 0;
    let bed = undefined; // خلفية هادئة بدل الموسيقى (اختيارية)، تُنشأ بتردد الملف
    await decodeStream(track, reader, file, async (chans, rate) => {
        const n = chans[0].length;
        const out = chans.map((c) => Float32Array.from(c));
        if (bed === undefined) bed = ambientPair(plan.bed, rate);
        const bedFade = 0.8 * rate;
        for (const s of plan.segs) {
            const s0 = Math.floor(s.a * rate), s1 = Math.floor(s.b * rate);
            const from = Math.max(s0, pos), to = Math.min(s1, pos + n);
            if (to <= from) continue;
            const fade = Math.floor(FADE * rate);
            for (let i = from; i < to; i++) {
                const w = Math.min(1, (i - s0) / fade, (s1 - i) / fade);
                // الخلفية الهادئة مكان الموسيقى: تدخل وتخرج بتدرّج (0.8ث)
                let b0 = 0, b1 = 0;
                if (bed) {
                    const g = Math.max(0, Math.min(1, (i - s0) / bedFade, (s1 - i) / bedFade));
                    b0 = bed[0].next() * g; b1 = bed[1].next() * g;
                }
                // بقايا موسيقى في هذه النصف ثانية: نصمتها بتلاشٍ ناعم (لا كلام فيها)
                const slot = Math.floor((i - s0) / rate / 0.5);
                const quiet = s.leftover[slot] ? Math.min(1, fadeIn(s, slot, (i - s0) / rate)) : 0;
                for (let c = 0; c < out.length; c++) {
                    const add = out.length === 1 ? (b0 + b1) / 2 : c === 0 ? b0 : b1;
                    if (s.singer) { out[c][i - pos] = out[c][i - pos] * (1 - w) + add; continue; }
                    // الأصل ناقص الموسيقى المقدّرة (القناة الأحادية: متوسط القناتين)
                    const m = out.length === 1 ? ((s.music[0][i - s0] ?? 0) + (s.music[1][i - s0] ?? 0)) / 65534 : (s.music[c][i - s0] ?? 0) / 32767;
                    out[c][i - pos] -= w * m;
                    if (quiet) out[c][i - pos] *= 1 - w * quiet;
                    out[c][i - pos] += add;
                }
            }
        }
        for (const [a, b] of plan.muteIntervals) {
            const from = Math.max(pos, Math.floor(a * rate)), to = Math.min(pos + n, Math.ceil(b * rate));
            for (const c of out) if (to > from) c.fill(0, from - pos, to - pos);
        }
        await write(out, rate);
        pos += n;
    });
}

/** تلاشٍ 50ms عند حدود نافذة البقايا المصمتة (إن كانت جارتها غير مصمتة). */
function fadeIn(s, slot, t) {
    const into = t - slot * 0.5, left = (slot + 1) * 0.5 - t;
    const a = s.leftover[slot - 1] ? 1 : into / FADE;
    const b = s.leftover[slot + 1] ? 1 : left / FADE;
    return Math.max(0, Math.min(1, a, b));
}

/** مرمّز صوت يكتب في الملف مباشرة، مع إعادة التشكيل إن احتاج المرمّز ترددًا آخر. */
export function audioEncoder(muxer, codecInfo, channels, delay = 0) {
    let failure = null;
    // تعويض تأخير المرمّز (عينات التهيئة): حتى يبقى الصوت في وقته تمامًا كما في الأصل
    let skip = Math.max(0, delay), lead = Math.max(0, -delay);
    const enc = new AudioEncoder({
        output: (chunk, meta) => {
            // Opus: نصفّر preskip لأن التأخير عُوّض في الصوت نفسه
            if (meta?.decoderConfig?.description) meta = { ...meta, decoderConfig: { ...meta.decoderConfig, description: zeroPreskip(meta.decoderConfig.description) } };
            muxer.addAudioChunk(chunk, meta);
        },
        error: (e) => { failure = e; },
    });
    enc.configure({ codec: codecInfo.webcodecs, sampleRate: codecInfo.sampleRate, numberOfChannels: channels, bitrate: 192000 });
    let rs = null; // يُنشأ مع أول دفعة (تردد الفك الحقيقي، مثل HE-AAC الذي يُفك بضعف تردده المعلن)
    let written = 0;
    return {
        async write(chans, rate) {
            if (failure) throw failure;
            rs ??= Array.from({ length: channels }, () => new Resampler(rate, codecInfo.sampleRate));
            let cs = Array.from({ length: channels }, (_, k) => rs[k].push(chans[k] ?? chans[0]));
            if (lead) { cs = cs.map((c) => { const y = new Float32Array(c.length + lead); y.set(c, lead); return y; }); lead = 0; }
            if (skip) { const k = Math.min(skip, cs[0].length); cs = cs.map((c) => c.subarray(k)); skip -= k; }
            const n = Math.min(...cs.map((c) => c.length));
            if (!n) return;
            const data = new Float32Array(n * channels);
            cs.forEach((c, k) => data.set(c.subarray(0, n), k * n));
            const ad = new AudioData({ format: "f32-planar", sampleRate: codecInfo.sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((written / codecInfo.sampleRate) * 1e6), data });
            enc.encode(ad);
            ad.close();
            written += n;
            while (enc.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 5));
        },
        async close() {
            await enc.flush();
            enc.close();
            if (failure) throw failure;
        },
    };
}

/** عينات التخطي في ترويسة Opus (بتردد 48kHz)، أو 0. */
function opusPreskip(description) {
    if (!description) return 0;
    const b = description instanceof ArrayBuffer ? new Uint8Array(description) : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
    if (b.length < 12 || String.fromCharCode(...b.subarray(0, 8)) !== "OpusHead") return 0;
    return b[10] | (b[11] << 8);
}

/** ترويسة Opus بلا «عينات تخطٍّ» (preskip = 0): نعوّض التأخير بأنفسنا فتتفق كل المشغلات. */
function zeroPreskip(description) {
    if (!description) return description;
    const b = new Uint8Array(description instanceof ArrayBuffer ? description.slice(0) : description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength));
    if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 8)) === "OpusHead") { b[10] = 0; b[11] = 0; }
    return b;
}

/**
 * عينات التهيئة في بداية ناتج المرمّز (تأخير خام بلا أي تخطٍّ): نرمّز نبضة ونفكها ونقيس موضعها.
 * نحذف هذا القدر من بداية الصوت قبل الترميز، فيبدأ الصوت في وقته تمامًا في كل المشغلات.
 */
export async function measureEncoderDelay(codecInfo, channels) {
    const sr = codecInfo.sampleRate, n = Math.round(sr * 0.8), at = Math.round(sr * 0.3);
    const burst = new Float32Array(n);
    let seed = 7;
    const L = Math.round(sr * 0.02);
    for (let i = 0; i < L; i++) { seed = (seed * 16807) % 2147483647; burst[at + i] = ((seed / 2147483647) * 2 - 1) * 0.5; }
    const chunks = [];
    let config = null;
    const enc = new AudioEncoder({ output: (c, meta) => { chunks.push(c); if (meta?.decoderConfig) config = meta.decoderConfig; }, error: () => {} });
    enc.configure({ codec: codecInfo.webcodecs, sampleRate: sr, numberOfChannels: channels, bitrate: 192000 });
    const data = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) data.set(burst, c * n);
    enc.encode(new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: channels, timestamp: 0, data }));
    await enc.flush();
    enc.close();
    const parts = [];
    const dec = new AudioDecoder({ output: (d) => { const a = new Float32Array(d.numberOfFrames); d.copyTo(a, { planeIndex: 0, format: "f32-planar" }); parts.push(a); d.close(); }, error: () => {} });
    dec.configure({ ...(config ?? { codec: codecInfo.webcodecs, sampleRate: sr, numberOfChannels: channels }), description: zeroPreskip(config?.description) });
    for (const c of chunks) dec.decode(c);
    await dec.flush();
    dec.close();
    const y = new Float32Array(parts.reduce((k, p) => k + p.length, 0));
    let o = 0;
    for (const p of parts) { y.set(p, o); o += p.length; }
    let best = 0, bestC = -Infinity;
    for (let lag = -1024; lag <= 4096; lag++) {
        let c = 0;
        for (let i = 0; i < L; i++) c += burst[at + i] * (y[at + i + lag] ?? 0);
        if (c > bestC) { bestC = c; best = lag; }
    }
    return best;
}

/** صوت WAV (حين لا يتوفر مرمّز صوت): يُكتب على دفعات، وتُصحح الترويسة في النهاية. */
export function wavWriter(out, channels, sampleRate) {
    let bytes = 0;
    let rate = sampleRate;
    const header = (dataBytes) => {
        const b = new ArrayBuffer(44), v = new DataView(b);
        const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        str(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); str(8, "WAVE"); str(12, "fmt ");
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
        v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
        str(36, "data"); v.setUint32(40, dataBytes, true);
        return new Uint8Array(b);
    };
    let ready = Promise.resolve(out.write(0, header(0)));
    return {
        async write(chans, r) {
            await ready;
            if (r) rate = r;
            const n = chans[0].length;
            const pcm = new Int16Array(n * channels);
            for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) pcm[i * channels + c] = Math.max(-1, Math.min(1, (chans[c] ?? chans[0])[i])) * 32767;
            await out.write(44 + bytes, new Uint8Array(pcm.buffer));
            bytes += pcm.byteLength;
        },
        async close() { await ready; await out.write(0, header(bytes)); },
    };
}

/** ترميز الصوت: AAC إن كان مدعومًا (الأنسب للجوال)، وإلا Opus. */
export async function pickAudioCodec(sampleRate, channels) {
    if (typeof AudioEncoder === "undefined") return null;
    for (const [webcodecs, mux] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) {
        const sr = mux === "opus" ? 48000 : sampleRate;
        const ok = await AudioEncoder.isConfigSupported({ codec: webcodecs, sampleRate: sr, numberOfChannels: channels, bitrate: 128000 }).catch(() => null);
        if (ok?.supported) return { webcodecs, mux, sampleRate: sr };
    }
    return null;
}
