package org.hisnfilter.core

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * الفخذ المكشوف (لباس قصير) — منقول من packages/core/src/skin.js.
 * نموذج كشف العري لا يعرفه، فنقيسه من نقاط الورك والركبة ولون البشرة على امتداد الفخذ.
 * البكسلات بصيغة ARGB (مثل Bitmap.getPixels).
 */
object Skin {
    const val THIGH_SKIN = 0.55
    private const val MIN_POINT = 0.3f

    fun isSkin(r: Int, g: Int, b: Int): Boolean {
        val y = 0.299 * r + 0.587 * g + 0.114 * b
        val cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
        val cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
        return y > 45 && cr in 135.0..180.0 && cb in 80.0..135.0 && r > g && r > b && r - minOf(g, b) > 12
    }

    private fun skinAt(px: IntArray, w: Int, h: Int, x: Int, y: Int): Boolean? {
        if (x < 0 || y < 0 || x >= w || y >= h) return null
        val c = px[y * w + x]
        return isSkin((c shr 16) and 255, (c shr 8) and 255, c and 255)
    }

    /** نسبة البشرة على شريط بين الورك والركبة (25%–85% من طوله). */
    fun legSkin(hx: Float, hy: Float, kx: Float, ky: Float, px: IntArray, w: Int, h: Int): Double? {
        val dx = kx - hx; val dy = ky - hy
        val len = hypot(dx, dy)
        if (len < 10) return null
        val nx = -dy / len; val ny = dx / len; val half = 0.18f * len
        var skin = 0; var total = 0
        for (ti in 0..12) for (si in 0..8) {
            val t = 0.25f + 0.05f * ti; val s = -1f + 0.25f * si
            val r = skinAt(px, w, h, (hx + dx * t + nx * half * s).roundToInt(), (hy + dy * t + ny * half * s).roundToInt()) ?: continue
            total++
            if (r) skin++
        }
        return if (total >= 20) skin.toDouble() / total else null
    }

    /** @param legs 12 رقمًا: (x, y, ثقة) للورك الأيسر، الأيمن، الركبة اليسرى، اليمنى. */
    fun thighExposure(legs: FloatArray?, px: IntArray, w: Int, h: Int): Double? {
        if (legs == null) return null
        var best: Double? = null
        for (side in 0..1) {
            val hip = side * 3; val knee = (2 + side) * 3
            if (legs[hip + 2] < MIN_POINT || legs[knee + 2] < MIN_POINT) continue
            val f = legSkin(legs[hip], legs[hip + 1], legs[knee], legs[knee + 1], px, w, h) ?: continue
            best = max(best ?: 0.0, f)
        }
        return best
    }

    /** بديل حين لا يُكتشف الجسم: موضع الفخذين تقديرًا من الوجه (3.7–5.3 من طوله تحت أعلاه). */
    fun thighFromFace(face: Box, px: IntArray, w: Int, h: Int): Double? {
        if (face.h < 8) return null
        val cx = face.x + face.w / 2
        val x1 = cx - 0.75f * face.w; val x2 = cx + 0.75f * face.w
        val y1 = face.y + 3.7f * face.h; val y2 = face.y + 5.3f * face.h
        if (y2 > h + 0.3f * face.h) return null
        var skin = 0; var total = 0
        for (yi in 0..10) for (xi in 0..8) {
            val r = skinAt(px, w, h, (x1 + (x2 - x1) * xi / 8).roundToInt(), (y1 + (y2 - y1) * yi / 10).roundToInt()) ?: continue
            total++
            if (r) skin++
        }
        return if (total >= 40) skin.toDouble() / total else null
    }
}
