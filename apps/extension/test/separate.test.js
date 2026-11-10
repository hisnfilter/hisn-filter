import { test } from "node:test";
import assert from "node:assert/strict";
import { FFT, stft2, istft2 } from "../src/cleaner/separate.js";

function naive(re, im, inv = false) {
    const n = re.length, R = new Float64Array(n), I = new Float64Array(n), s = inv ? 1 : -1;
    for (let k = 0; k < n; k++) for (let t = 0; t < n; t++) {
        const a = (s * 2 * Math.PI * k * t) / n;
        R[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a); I[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
    return [R, I];
}

test("FFT بأطوال مركبة يطابق التحويل المباشر", () => {
    for (const n of [8, 12, 20, 60, 80, 320]) {
        const re = Float64Array.from({ length: n }, () => Math.random() - 0.5), im = Float64Array.from({ length: n }, () => Math.random() - 0.5);
        for (const inv of [false, true]) {
            const [R, I] = naive(re, im, inv);
            const a = Float64Array.from(re), b = Float64Array.from(im);
            new FFT(n).transform(a, b, inv);
            for (let k = 0; k < n; k++) { assert.ok(Math.abs(a[k] - R[k]) < 1e-9 && Math.abs(b[k] - I[k]) < 1e-9, `n=${n} k=${k}`); }
        }
    }
});

test("الطيف ثم العكس يعيد القناتين كما هما (لا تغيير في الصوت)", () => {
    const nFft = 5120, hop = 1024, len = hop * 255;
    const x0 = Float32Array.from({ length: len }, (_, i) => Math.sin(i / 7) * 0.3 + (Math.random() - 0.5) * 0.1);
    const x1 = Float32Array.from({ length: len }, (_, i) => Math.cos(i / 13) * 0.2);
    const fft = new FFT(nFft);
    const win = Float64Array.from({ length: nFft }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft));
    const { out, frames } = stft2(x0, x1, nFft, hop, fft, win);
    assert.equal(frames, 256);
    const [y0, y1] = istft2(out, frames, nFft, hop, len, fft, win);
    let e = 0;
    for (let i = 0; i < len; i++) e = Math.max(e, Math.abs(y0[i] - x0[i]), Math.abs(y1[i] - x1[i]));
    assert.ok(e < 1e-5, `أكبر فرق ${e}`);
});

test("تحسين الترددات العالية: يزيل بقايا الموسيقى فوق 6 كيلوهرتز ولا يمس ما تحتها", async () => {
    const { polishHighBand } = await import("../src/cleaner/separate.js");
    const rate = 44100, n = rate;
    const sin = (f, a) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));
    const speech = sin(1000, 0.3), hiss = sin(10000, 0.05), low = sin(300, 0.2);
    const x = [0, 1].map(() => speech.map((v, i) => v + hiss[i] + low[i]));
    const m = [0, 1].map(() => low.map((v, i) => v + hiss[i] / 2));
    const m2 = polishHighBand(x, m, rate);
    const proj = (y, f) => { let a = 0, b = 0; for (let i = 4096; i < n - 4096; i++) { const c = Math.sin((2 * Math.PI * f * i) / rate); a += y[i] * c; b += c * c; } return a / b; };
    const y = x[0].map((v, i) => v - m2[0][i]);
    assert.ok(Math.abs(proj(y, 1000) - 0.3) < 0.003, "الكلام كما هو");
    assert.ok(Math.abs(proj(y, 10000)) < 0.005, "بقايا 10 كيلوهرتز أُزيلت");
});
