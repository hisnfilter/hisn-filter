// يعمل داخل سياق الصوت في الصفحة (AudioWorklet). يرسل الصوت كتلًا (10ms) إلى محرك التنظيف في إطار الإضافة،
// ويعيد الصوت النظيف، مع مزج سلس بين الأصلي والنظيف، وكتم سلس (للمغني أو للفظ).
const BLOCK = 480; // 10ms بتردد 48kHz (حجم إطار DeepFilterNet)
const MAX_PENDING = 40; // إن تأخر المحرك أكثر من 400ms: نمرر الكتل التالية كما هي بدل أن يتراكم التأخير
const MAX_READY = 100;

class HisnRelay extends AudioWorkletProcessor {
    constructor() {
        super();
        this.engine = null;
        this.acc = new Float32Array(BLOCK);
        this.accL = new Float32Array(BLOCK);
        this.accR = new Float32Array(BLOCK);
        this.accLen = 0;
        this.pending = []; // الأصلي بانتظار نسخته النظيفة
        this.ready = []; // { clean, L, R }
        this.cur = null;
        this.pos = 0;
        this.started = false;
        this.mix = 0; // 0 أصلي، 1 نظيف
        this.targetMix = 0;
        this.gain = 1;
        this.targetGain = 1;
        this.underruns = 0;
        this.cleaned = 0;
        this.ticks = 0;
        this.port.onmessage = (e) => {
            const m = e.data;
            if (m.type === "engine") {
                this.engine = m.port;
                this.engine.onmessage = (ev) => {
                    this.flushBypass();
                    const o = this.pending.shift();
                    if (o) this.ready.push({ clean: ev.data, L: o.L, R: o.R });
                    this.cleaned++;
                    this.flushBypass();
                };
            } else if (m.type === "mix") this.targetMix = m.value;
            else if (m.type === "gain") this.targetGain = m.value;
        };
    }

    /** الكتل التي مُرّرت دون تنظيف (أثناء تأخر المحرك) تخرج بترتيبها. */
    flushBypass() {
        while (this.pending[0]?.bypass) {
            const o = this.pending.shift();
            this.ready.push({ clean: o.mono, L: o.L, R: o.R });
        }
        while (this.ready.length > MAX_READY) this.ready.shift();
    }

    // خطوة تنعيم لكل عينة: نحو 20ms للوصول
    step(cur, target) {
        return cur + (target - cur) * 0.0011;
    }

    process(inputs, outputs) {
        // إحصاء كل ثانية تقريبًا (للتشخيص والاختبار)
        if (++this.ticks % 375 === 0) this.port.postMessage({ type: "stats", cleaned: this.cleaned, underruns: this.underruns, mix: +this.mix.toFixed(2) });
        const input = inputs[0] ?? [];
        const out = outputs[0];
        const n = out[0].length;
        const L = input[0], R = input[1] ?? input[0];
        if (!this.engine) {
            for (let i = 0; i < n; i++) {
                this.gain = this.step(this.gain, this.targetGain);
                const l = L ? L[i] : 0, r = R ? R[i] : 0;
                out[0][i] = l * this.gain;
                if (out[1]) out[1][i] = r * this.gain;
            }
            return true;
        }
        // 1) نجمع الأصلي كتلًا ونرسلها للتنظيف
        for (let i = 0; i < n; i++) {
            const l = L ? L[i] : 0, r = R ? R[i] : 0;
            this.acc[this.accLen] = (l + r) * 0.5;
            this.accL[this.accLen] = l;
            this.accR[this.accLen] = r;
            if (++this.accLen === BLOCK) {
                const x = this.acc.slice();
                if (this.pending.filter((p) => !p.bypass).length < MAX_PENDING) {
                    this.engine.postMessage(x, [x.buffer]);
                    this.pending.push({ L: this.accL.slice(), R: this.accR.slice() });
                } else {
                    this.pending.push({ bypass: true, mono: x, L: this.accL.slice(), R: this.accR.slice() });
                }
                this.accLen = 0;
            }
        }
        this.flushBypass();
        // 2) نخرج من الكتل الجاهزة بعد مخزون صغير (20ms) حتى لا يتقطع الصوت
        if (!this.started) this.started = this.ready.length >= 3; // مخزون 30ms
        for (let i = 0; i < n; i++) {
            if (!this.started) { out[0][i] = 0; if (out[1]) out[1][i] = 0; continue; }
            if (!this.cur || this.pos >= BLOCK) {
                this.cur = this.ready.shift() ?? null;
                this.pos = 0;
                if (!this.cur) { this.underruns++; this.started = false; out[0][i] = 0; if (out[1]) out[1][i] = 0; continue; }
            }
            this.mix = this.step(this.mix, this.targetMix);
            this.gain = this.step(this.gain, this.targetGain);
            const c = this.cur.clean[this.pos];
            const l = this.cur.L[this.pos], r = this.cur.R[this.pos];
            out[0][i] = ((1 - this.mix) * l + this.mix * c) * this.gain;
            if (out[1]) out[1][i] = ((1 - this.mix) * r + this.mix * c) * this.gain;
            this.pos++;
        }
        return true;
    }
}

registerProcessor("hisn-relay", HisnRelay);
