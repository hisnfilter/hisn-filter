// فصل الموسيقى عن الصوت بنموذج MDX-Net (UVR-MDX-NET-Inst_HQ_4): يقدّر الموسيقى وحدها،
// ثم نطرحها من الأصل. هكذا يبقى صوت المتكلم هو المسجّل نفسه (لا يُعاد توليده)، ولا يُحذف إلا ما هو موسيقى.
// في المقياس (كلام حقيقي + موسيقى حقيقية): الكلام النظيف لا يتغير تقريبًا (35dB)، والموسيقى وحدها تنخفض ~33dB.

/** FFT مركّب بأطوال من عوامل 2 و3 و4 و5 (مثل 5120 = 4⁵×5). */
export class FFT {
    constructor(n) {
        this.n = n;
        this.factors = [];
        let m = n;
        for (const p of [4, 2, 3, 5]) while (m % p === 0) { this.factors.push(p); m /= p; }
        if (m !== 1) throw new Error("طول FFT غير مدعوم: " + n);
        this.cos = new Float64Array(n);
        this.sin = new Float64Array(n);
        for (let i = 0; i < n; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = -Math.sin((2 * Math.PI * i) / n); }
        this.tr = new Float64Array(n); this.ti = new Float64Array(n);
    }

    /** تحويل أمامي في المكان (inverse=true: عكسي بلا قسمة على n). */
    transform(re, im, inverse = false) {
        const { n, tr, ti } = this;
        this.rec(re, im, 0, 1, tr, ti, 0, n, 0, inverse);
        re.set(tr); im.set(ti);
    }

    rec(re, im, inOff, stride, outRe, outIm, outOff, n, depth, inverse) {
        if (n === 1) { outRe[outOff] = re[inOff]; outIm[outOff] = im[inOff]; return; }
        const p = this.factors[depth], m = n / p;
        for (let q = 0; q < p; q++) this.rec(re, im, inOff + q * stride, stride * p, outRe, outIm, outOff + q * m, m, depth + 1, inverse);
        const N = this.n, step = N / n, sgn = inverse ? -1 : 1;
        const yr = new Float64Array(p), yi = new Float64Array(p);
        for (let k = 0; k < m; k++) {
            // Y_q[k] × W_n^{qk}
            for (let q = 0; q < p; q++) {
                const a = outRe[outOff + q * m + k], b = outIm[outOff + q * m + k];
                const t = (q * k * step) % N;
                const c = this.cos[t], s = sgn * this.sin[t];
                yr[q] = a * c - b * s; yi[q] = a * s + b * c;
            }
            for (let r = 0; r < p; r++) {
                let sr = 0, si = 0;
                for (let q = 0; q < p; q++) {
                    const t = (((q * r) % p) * (N / p)) % N;
                    const c = this.cos[t], s = sgn * this.sin[t];
                    sr += yr[q] * c - yi[q] * s; si += yr[q] * s + yi[q] * c;
                }
                outRe[outOff + r * m + k] = sr; outIm[outOff + r * m + k] = si;
            }
        }
    }
}

function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    return w;
}

/**
 * طيف قناتين معًا بتحويل واحد (x0 + i·x1)، مثل torch.stft(center=True) بنافذة hann دورية.
 * يُرجع لكل قناة: الحقيقي والتخيلي [bins × frames].
 */
export function stft2(x0, x1, nFft, hop, fft, win) {
    const pad = nFft / 2, len = x0.length;
    const frames = 1 + Math.floor(len / hop);
    const bins = nFft / 2 + 1;
    const out = [0, 1].map(() => ({ re: new Float32Array(bins * frames), im: new Float32Array(bins * frames) }));
    const re = new Float64Array(nFft), im = new Float64Array(nFft);
    const refl = (i) => { // انعكاس عند الحواف (reflect)
        if (i < 0) i = -i;
        if (i >= len) i = 2 * (len - 1) - i;
        return i;
    };
    for (let f = 0; f < frames; f++) {
        const start = f * hop - pad;
        for (let i = 0; i < nFft; i++) {
            const j = refl(start + i);
            re[i] = x0[j] * win[i]; im[i] = x1[j] * win[i];
        }
        fft.transform(re, im);
        for (let k = 0; k < bins; k++) {
            const kk = (nFft - k) % nFft;
            // X0 = (Z[k] + conj Z[n-k]) / 2 ، X1 = (Z[k] − conj Z[n-k]) / 2i
            const ar = re[k], ai = im[k], br = re[kk], bi = -im[kk];
            out[0].re[k * frames + f] = (ar + br) / 2; out[0].im[k * frames + f] = (ai + bi) / 2;
            out[1].re[k * frames + f] = (ai - bi) / 2; out[1].im[k * frames + f] = -(ar - br) / 2;
        }
    }
    return { out, frames, bins };
}

/** العكس لقناتين معًا (طيفان هرميتيان ← تحويل مركب واحد)، ثم جمع متداخل وحذف الحشو. */
export function istft2(spec, frames, nFft, hop, length, fft, win) {
    const pad = nFft / 2, bins = nFft / 2 + 1;
    const total = nFft + hop * (frames - 1);
    const y0 = new Float64Array(total), y1 = new Float64Array(total), norm = new Float64Array(total);
    const re = new Float64Array(nFft), im = new Float64Array(nFft);
    const [a, b] = spec;
    for (let f = 0; f < frames; f++) {
        // Z = X0 + i·X1 لكل التردد (مع النصف المرآة)
        for (let k = 0; k < nFft; k++) {
            let x0r, x0i, x1r, x1i;
            if (k < bins) { x0r = a.re[k * frames + f]; x0i = a.im[k * frames + f]; x1r = b.re[k * frames + f]; x1i = b.im[k * frames + f]; }
            else { const kk = nFft - k; x0r = a.re[kk * frames + f]; x0i = -a.im[kk * frames + f]; x1r = b.re[kk * frames + f]; x1i = -b.im[kk * frames + f]; }
            re[k] = x0r - x1i; im[k] = x0i + x1r;
        }
        fft.transform(re, im, true);
        const o = f * hop;
        for (let i = 0; i < nFft; i++) {
            const w = win[i];
            y0[o + i] += (re[i] / nFft) * w; y1[o + i] += (im[i] / nFft) * w; norm[o + i] += w * w;
        }
    }
    const r0 = new Float32Array(length), r1 = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        const n = Math.max(norm[pad + i], 1e-8);
        r0[i] = y0[pad + i] / n; r1[i] = y1[pad + i] / n;
    }
    return [r0, r1];
}

export const MDX_RATE = 44100;
/**
 * طول نافذة الفصل بالإطارات (كل إطار 1024 عينة ≈ 23ms). النموذج الأصلي 256 (نحو 1GB ذاكرة أثناء العمل)؛
 * 64 تقلل الذاكرة إلى الربع تقريبًا بفرق جودة صغير جدًا في المقياس (15.7 مقابل 15.8dB، وأمانة 32 مقابل 34dB).
 */
export const SEPARATION_FRAMES = 64;

/**
 * نموذج MDX-Net: يقدّر الموسيقى في صوت ستيريو 44.1kHz.
 * @param session جلسة onnxruntime للنموذج، و Tensor من نفس المكتبة
 */
export class MusicSeparator {
    constructor(session, Tensor, { nFft = 5120, hop = 1024, dimF = 2560, dimT = SEPARATION_FRAMES } = {}) {
        Object.assign(this, { session, Tensor, nFft, hop, dimF, dimT });
        this.fft = new FFT(nFft);
        this.win = hann(nFft);
    }

    /** الموسيقى المقدّرة لقناتين (نفس الطول). onProgress(0..1) */
    async music(left, right, onProgress) {
        const { nFft, hop, dimF, dimT } = this;
        const trim = nFft / 2, chunk = hop * (dimT - 1), gen = chunk - 2 * trim;
        const N = left.length;
        const pad = gen - (N % gen);
        const total = trim + N + pad + trim;
        const p0 = new Float32Array(total), p1 = new Float32Array(total);
        p0.set(left, trim); p1.set(right, trim);
        const o0 = new Float32Array(N + pad), o1 = new Float32Array(N + pad);
        const input = new Float32Array(4 * dimF * dimT);
        const steps = Math.ceil((N + pad) / gen);
        for (let s = 0, i = 0; i < N + pad; i += gen, s++) {
            const x0 = p0.subarray(i, i + chunk), x1 = p1.subarray(i, i + chunk);
            const { out, frames } = stft2(x0, x1, nFft, hop, this.fft, this.win);
            // [4, dimF, dimT]: حقيقي وتخيلي القناة الأولى ثم الثانية
            for (let c = 0; c < 2; c++) {
                for (let k = 0; k < dimF; k++) {
                    input.set(out[c].re.subarray(k * frames, k * frames + dimT), ((2 * c) * dimF + k) * dimT);
                    input.set(out[c].im.subarray(k * frames, k * frames + dimT), ((2 * c + 1) * dimF + k) * dimT);
                }
            }
            const res = await this.session.run({ [this.session.inputNames[0]]: new this.Tensor("float32", input, [1, 4, dimF, dimT]) });
            const y = res[this.session.outputNames[0]].data;
            const bins = nFft / 2 + 1;
            const spec = [0, 1].map(() => ({ re: new Float32Array(bins * frames), im: new Float32Array(bins * frames) }));
            for (let c = 0; c < 2; c++) {
                for (let k = 0; k < dimF; k++) {
                    spec[c].re.set(y.subarray(((2 * c) * dimF + k) * dimT, ((2 * c) * dimF + k + 1) * dimT), k * frames);
                    spec[c].im.set(y.subarray(((2 * c + 1) * dimF + k) * dimT, ((2 * c + 1) * dimF + k + 1) * dimT), k * frames);
                }
            }
            const [r0, r1] = istft2(spec, frames, nFft, hop, chunk, this.fft, this.win);
            o0.set(r0.subarray(trim, chunk - trim), i); o1.set(r1.subarray(trim, chunk - trim), i);
            onProgress?.((s + 1) / steps);
            await new Promise((r) => setTimeout(r));
        }
        return [o0.subarray(0, N), o1.subarray(0, N)];
    }
}

/**
 * تنظيف إضافي للترددات العالية (فوق 6 كيلوهرتز): نموذج الفصل يترك فيها أثرًا خفيفًا من الصنج والإيقاع
 * يُسمع همسًا خلف الكلام. هنا قناع ناعم (Wiener) يعتمد على تقدير الموسيقى نفسه، ولا يمس ما تحت 6 كيلوهرتز
 * (حيث معظم الصوت البشري). يُرجع تقدير الموسيقى بعد التحسين: الأصل ناقص الكلام المنقّى.
 * @param {Float32Array[]} x الأصل (قناتان)  @param {Float32Array[]} m الموسيقى المقدّرة (قناتان، نفس الطول)
 */
export function polishHighBand(x, m, rate, { beta = 16, from = 6000, to = 8000 } = {}) {
    const N = 4096, H = 1024, half = N / 2, bins = half + 1, len = x[0].length;
    const fft = new FFT(N);
    const win = new Float64Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const weight = new Float64Array(bins);
    for (let k = 0; k < bins; k++) weight[k] = Math.max(0, Math.min(1, ((k * rate) / N - from) / (to - from)));
    const k0 = weight.findIndex((w) => w > 0);
    const out = [new Float64Array(len + N), new Float64Array(len + N)], norm = new Float64Array(len + N);
    const zr = new Float64Array(N), zi = new Float64Array(N), wr = new Float64Array(N), wi = new Float64Array(N);
    const g0 = new Float64Array(bins), g1 = new Float64Array(bins);
    for (let start = -half; start < len; start += H) {
        for (let i = 0; i < N; i++) {
            const j = start + i;
            const inside = j >= 0 && j < len;
            const y0 = inside ? x[0][j] - m[0][j] : 0, y1 = inside ? x[1][j] - m[1][j] : 0;
            zr[i] = y0 * win[i]; zi[i] = y1 * win[i];
            wr[i] = inside ? m[0][j] * win[i] : 0; wi[i] = inside ? m[1][j] * win[i] : 0;
        }
        fft.transform(zr, zi);
        fft.transform(wr, wi);
        g0.fill(1); g1.fill(1);
        if (k0 > 0) {
            for (let k = k0; k < bins; k++) {
                const kk = (N - k) % N;
                // فصل القناتين من التحويل المركب الواحد
                const y0r = (zr[k] + zr[kk]) / 2, y0i = (zi[k] - zi[kk]) / 2, y1r = (zi[k] + zi[kk]) / 2, y1i = -(zr[k] - zr[kk]) / 2;
                const m0r = (wr[k] + wr[kk]) / 2, m0i = (wi[k] - wi[kk]) / 2, m1r = (wi[k] + wi[kk]) / 2, m1i = -(wr[k] - wr[kk]) / 2;
                const py0 = y0r * y0r + y0i * y0i, py1 = y1r * y1r + y1i * y1i;
                const pm0 = m0r * m0r + m0i * m0i, pm1 = m1r * m1r + m1i * m1i;
                const w = weight[k];
                g0[k] = 1 - w + (w * py0) / (py0 + beta * pm0 + 1e-20);
                g1[k] = 1 - w + (w * py1) / (py1 + beta * pm1 + 1e-20);
            }
        }
        // Z' = G0·Y0 + i·G1·Y1 لكل التردد (والنصف المرآة)
        for (let k = 0; k < N; k++) {
            const kb = k < bins ? k : N - k;
            const kk = (N - k) % N;
            const y0r = (zr[k] + zr[kk]) / 2, y0i = (zi[k] - zi[kk]) / 2, y1r = (zi[k] + zi[kk]) / 2, y1i = -(zr[k] - zr[kk]) / 2;
            const a0 = g0[kb], a1 = g1[kb];
            wr[k] = a0 * y0r - a1 * y1i;
            wi[k] = a0 * y0i + a1 * y1r;
        }
        fft.transform(wr, wi, true);
        for (let i = 0; i < N; i++) {
            const j = start + i + half;
            if (j < 0 || j >= len + N) continue;
            out[0][j] += (wr[i] / N) * win[i];
            out[1][j] += (wi[i] / N) * win[i];
            norm[j] += win[i] * win[i];
        }
    }
    return [0, 1].map((c) => {
        const r = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const nn = norm[i + half];
            const y = nn > 1e-6 ? out[c][i + half] / nn : x[c][i] - m[c][i];
            r[i] = x[c][i] - y;
        }
        return r;
    });
}
