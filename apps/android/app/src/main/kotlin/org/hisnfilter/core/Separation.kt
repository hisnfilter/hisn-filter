package org.hisnfilter.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/**
 * فصل الموسيقى (MDX-Net، نموذج UVR-MDX-NET-Inst_HQ_4) — نفس apps/extension/src/cleaner/separate.js
 * لكن يعمل بالمعالج الأصلي للجوال (أسرع بكثير من المتصفح). النموذج يقدّر الموسيقى وحدها، ثم تُطرح من الأصل
 * فيبقى صوت المتكلم هو المسجّل نفسه.
 */
class Fft(val n: Int) {
    private val factors = ArrayList<Int>()
    private val cosT = DoubleArray(n) { cos(2 * PI * it / n) }
    private val sinT = DoubleArray(n) { -sin(2 * PI * it / n) }
    private val tr = DoubleArray(n)
    private val ti = DoubleArray(n)

    init {
        var m = n
        for (p in intArrayOf(4, 2, 3, 5)) while (m % p == 0) { factors += p; m /= p }
        require(m == 1) { "طول FFT غير مدعوم: $n" }
    }

    /** تحويل في المكان (inverse: بلا قسمة على n). */
    fun transform(re: DoubleArray, im: DoubleArray, inverse: Boolean = false) {
        rec(re, im, 0, 1, 0, n, 0, if (inverse) -1.0 else 1.0)
        System.arraycopy(tr, 0, re, 0, n)
        System.arraycopy(ti, 0, im, 0, n)
    }

    private fun rec(re: DoubleArray, im: DoubleArray, inOff: Int, stride: Int, outOff: Int, len: Int, depth: Int, sgn: Double) {
        if (len == 1) { tr[outOff] = re[inOff]; ti[outOff] = im[inOff]; return }
        val p = factors[depth]
        val m = len / p
        for (q in 0 until p) rec(re, im, inOff + q * stride, stride * p, outOff + q * m, m, depth + 1, sgn)
        val step = n / len
        val yr = DoubleArray(p)
        val yi = DoubleArray(p)
        for (k in 0 until m) {
            for (q in 0 until p) {
                val a = tr[outOff + q * m + k]
                val b = ti[outOff + q * m + k]
                val t = (q.toLong() * k * step % n).toInt()
                val c = cosT[t]
                val s = sgn * sinT[t]
                yr[q] = a * c - b * s; yi[q] = a * s + b * c
            }
            for (r in 0 until p) {
                var sr = 0.0
                var si = 0.0
                for (q in 0 until p) {
                    val t = ((q * r) % p) * (n / p)
                    val c = cosT[t]
                    val s = sgn * sinT[t]
                    sr += yr[q] * c - yi[q] * s; si += yr[q] * s + yi[q] * c
                }
                tr[outOff + r * m + k] = sr; ti[outOff + r * m + k] = si
            }
        }
    }
}

/** طيف قناتين: لكل قناة الحقيقي والتخيلي [bins × frames]. */
class Spectrum(val frames: Int, val bins: Int) {
    val re = Array(2) { FloatArray(bins * frames) }
    val im = Array(2) { FloatArray(bins * frames) }
}

object Stft {
    fun hann(n: Int) = DoubleArray(n) { 0.5 - 0.5 * cos(2 * PI * it / n) }

    /** مثل torch.stft(center=True، انعكاس عند الحواف)، قناتان بتحويل واحد. */
    fun forward(x0: FloatArray, x1: FloatArray, from: Int, len: Int, nFft: Int, hop: Int, fft: Fft, win: DoubleArray): Spectrum {
        val pad = nFft / 2
        val frames = 1 + len / hop
        val bins = nFft / 2 + 1
        val s = Spectrum(frames, bins)
        val re = DoubleArray(nFft)
        val im = DoubleArray(nFft)
        for (f in 0 until frames) {
            val start = f * hop - pad
            for (i in 0 until nFft) {
                var j = start + i
                if (j < 0) j = -j
                if (j >= len) j = 2 * (len - 1) - j
                re[i] = x0[from + j] * win[i]; im[i] = x1[from + j] * win[i]
            }
            fft.transform(re, im)
            for (k in 0 until bins) {
                val kk = (nFft - k) % nFft
                val ar = re[k]; val ai = im[k]; val br = re[kk]; val bi = -im[kk]
                s.re[0][k * frames + f] = ((ar + br) / 2).toFloat(); s.im[0][k * frames + f] = ((ai + bi) / 2).toFloat()
                s.re[1][k * frames + f] = ((ai - bi) / 2).toFloat(); s.im[1][k * frames + f] = (-(ar - br) / 2).toFloat()
            }
        }
        return s
    }

    fun inverse(s: Spectrum, nFft: Int, hop: Int, length: Int, fft: Fft, win: DoubleArray): Array<FloatArray> {
        val pad = nFft / 2
        val frames = s.frames
        val bins = s.bins
        val total = nFft + hop * (frames - 1)
        val y0 = DoubleArray(total); val y1 = DoubleArray(total); val norm = DoubleArray(total)
        val re = DoubleArray(nFft); val im = DoubleArray(nFft)
        for (f in 0 until frames) {
            for (k in 0 until nFft) {
                val x0r: Double; val x0i: Double; val x1r: Double; val x1i: Double
                if (k < bins) {
                    x0r = s.re[0][k * frames + f].toDouble(); x0i = s.im[0][k * frames + f].toDouble()
                    x1r = s.re[1][k * frames + f].toDouble(); x1i = s.im[1][k * frames + f].toDouble()
                } else {
                    val kk = nFft - k
                    x0r = s.re[0][kk * frames + f].toDouble(); x0i = -s.im[0][kk * frames + f].toDouble()
                    x1r = s.re[1][kk * frames + f].toDouble(); x1i = -s.im[1][kk * frames + f].toDouble()
                }
                re[k] = x0r - x1i; im[k] = x0i + x1r
            }
            fft.transform(re, im, inverse = true)
            val o = f * hop
            for (i in 0 until nFft) {
                val w = win[i]
                y0[o + i] += re[i] / nFft * w; y1[o + i] += im[i] / nFft * w; norm[o + i] += w * w
            }
        }
        val r0 = FloatArray(length); val r1 = FloatArray(length)
        for (i in 0 until length) {
            val nn = max(norm[pad + i], 1e-8)
            r0[i] = (y0[pad + i] / nn).toFloat(); r1[i] = (y1[pad + i] / nn).toFloat()
        }
        return arrayOf(r0, r1)
    }
}

/**
 * @param model يأخذ مدخل النموذج [4 × dimF × dimT] ويُرجع مخرجه بنفس الشكل (الموسيقى في الطيف).
 */
class MdxSeparator(
    private val model: (FloatArray) -> FloatArray,
    val nFft: Int = 5120,
    val hop: Int = 1024,
    val dimF: Int = 2560,
    /** 64 إطارًا: ربع الذاكرة بجودة شبه مطابقة (انظر separate.js). */
    val dimT: Int = 64,
) {
    private val fft = Fft(nFft)
    private val win = Stft.hann(nFft)

    /** الموسيقى المقدّرة لقناتين بتردد 44.1kHz (نفس الطول). */
    fun music(left: FloatArray, right: FloatArray, progress: (Float) -> Unit = {}): Array<FloatArray> {
        val trim = nFft / 2
        val chunk = hop * (dimT - 1)
        val gen = chunk - 2 * trim
        val n = left.size
        val pad = gen - n % gen
        val total = trim + n + pad + trim
        val p0 = FloatArray(total); val p1 = FloatArray(total)
        System.arraycopy(left, 0, p0, trim, n); System.arraycopy(right, 0, p1, trim, n)
        val o0 = FloatArray(n + pad); val o1 = FloatArray(n + pad)
        val input = FloatArray(4 * dimF * dimT)
        val steps = (n + pad + gen - 1) / gen
        var i = 0
        var step = 0
        while (i < n + pad) {
            val spec = Stft.forward(p0, p1, i, chunk, nFft, hop, fft, win)
            val frames = spec.frames
            for (c in 0 until 2) for (k in 0 until dimF) {
                System.arraycopy(spec.re[c], k * frames, input, ((2 * c) * dimF + k) * dimT, dimT)
                System.arraycopy(spec.im[c], k * frames, input, ((2 * c + 1) * dimF + k) * dimT, dimT)
            }
            val y = model(input)
            val out = Spectrum(frames, nFft / 2 + 1)
            for (c in 0 until 2) for (k in 0 until dimF) {
                System.arraycopy(y, ((2 * c) * dimF + k) * dimT, out.re[c], k * frames, dimT)
                System.arraycopy(y, ((2 * c + 1) * dimF + k) * dimT, out.im[c], k * frames, dimT)
            }
            val r = Stft.inverse(out, nFft, hop, chunk, fft, win)
            System.arraycopy(r[0], trim, o0, i, gen); System.arraycopy(r[1], trim, o1, i, gen)
            i += gen
            step++
            progress(step.toFloat() / steps)
        }
        return arrayOf(o0.copyOf(n), o1.copyOf(n))
    }
}
