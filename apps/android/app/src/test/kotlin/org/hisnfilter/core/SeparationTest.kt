package org.hisnfilter.core

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sin

/** نفس اختبارات separate.test.js: الحساب صحيح، والطيف ثم العكس لا يغيّر الصوت. */
class SeparationTest {
    @Test
    fun fftMatchesDirectTransform() {
        val rnd = java.util.Random(1)
        for (n in intArrayOf(8, 12, 20, 60, 80, 320)) for (inv in listOf(false, true)) {
            val re = DoubleArray(n) { rnd.nextDouble() - 0.5 }
            val im = DoubleArray(n) { rnd.nextDouble() - 0.5 }
            val s = if (inv) 1.0 else -1.0
            val a = re.copyOf(); val b = im.copyOf()
            Fft(n).transform(a, b, inv)
            for (k in 0 until n) {
                var r = 0.0; var i = 0.0
                for (t in 0 until n) { val ang = s * 2 * PI * k * t / n; r += re[t] * cos(ang) - im[t] * sin(ang); i += re[t] * sin(ang) + im[t] * cos(ang) }
                assertTrue("n=$n k=$k", abs(a[k] - r) < 1e-9 && abs(b[k] - i) < 1e-9)
            }
        }
    }

    @Test
    fun spectrumRoundTripKeepsAudio() {
        val nFft = 5120; val hop = 1024; val len = hop * 255
        val x0 = FloatArray(len) { (sin(it / 7.0) * 0.3).toFloat() }
        val x1 = FloatArray(len) { (cos(it / 13.0) * 0.2).toFloat() }
        val fft = Fft(nFft); val win = Stft.hann(nFft)
        val s = Stft.forward(x0, x1, 0, len, nFft, hop, fft, win)
        val y = Stft.inverse(s, nFft, hop, len, fft, win)
        var e = 0.0
        for (i in 0 until len) e = maxOf(e, abs((y[0][i] - x0[i]).toDouble()), abs((y[1][i] - x1[i]).toDouble()))
        assertTrue("أكبر فرق $e", e < 1e-5)
    }

    /** نموذج وهمي «كل شيء موسيقى»: الناتج يساوي الدخل (عدا أعلى تردد خارج نطاق النموذج). */
    @Test
    fun chunkingAndOverlapAreSeamless() {
        val n = 44100 * 13 + 777
        val l = FloatArray(n) { (sin(it * 0.031) * 0.4 + sin(it * 0.0071) * 0.2).toFloat() }
        val r = FloatArray(n) { (cos(it * 0.017) * 0.3).toFloat() }
        val sep = MdxSeparator({ it.copyOf() })
        val m = sep.music(l, r)
        var e = 0.0; var p = 0.0
        for (i in 0 until n) { e += (m[0][i] - l[i]).let { it * it } + (m[1][i] - r[i]).let { it * it }; p += l[i] * l[i] + r[i] * r[i] }
        val db = 10 * log10(e / p)
        assertTrue("فرق $db dB", db < -60)
    }
}
