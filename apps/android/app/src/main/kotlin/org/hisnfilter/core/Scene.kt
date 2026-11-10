package org.hisnfilter.core

import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sqrt

/**
 * فهم الصورة كاملة (MobileCLIP-S0): يقارن متجه الصورة بنصوص محسوبة مسبقًا (packages/core/data/scene.json)
 * ويُرجع احتمال وجود امرأة، واحتمال أن الصورة إيحائية. نفس الحساب في scene.js وفي NativeDetector.sceneScores.
 * يمسك ما تفوّته النماذج الأخرى: امرأة من الخلف، ساقان، وجه مقنّع، رسم.
 */
data class SceneScores(val woman: Double, val sexual: Double, val covered: Double = 0.0, val scary: Double = 0.0)

class SceneText(json: String) {
    val size: Int
    val scale: Double
    private val emb: List<FloatArray>
    private val womanIds: List<Int>
    private val sexualIds: List<Int>
    /** منقبة/برقع: صنف مستقل (ليس «امرأة») */
    private val coveredIds: List<Int>
    private val scaryIds: List<Int>

    init {
        val m = MiniJson.parse(json) as Map<*, *>
        size = (m["size"] as Number).toInt()
        scale = (m["scale"] as Number).toDouble()
        emb = (m["emb"] as List<*>).map { row -> (row as List<*>).map { (it as Number).toFloat() }.toFloatArray() }
        womanIds = (m["woman"] as List<*>).map { (it as Number).toInt() }
        sexualIds = (m["sexual"] as List<*>).map { (it as Number).toInt() }
        coveredIds = (m["covered"] as? List<*>)?.map { (it as Number).toInt() } ?: emptyList()
        scaryIds = (m["scary"] as? List<*>)?.map { (it as Number).toInt() } ?: emptyList()
    }

    /** @param e متجه الصورة (512) قبل التطبيع */
    fun scores(e: FloatArray): SceneScores {
        var norm = 0.0
        for (v in e) norm += v.toDouble() * v
        norm = max(1e-6, sqrt(norm))
        val sims = emb.map { t -> var d = 0.0; for (i in t.indices) d += t[i].toDouble() * e[i]; d / norm * scale }
        val mx = sims.maxOrNull() ?: 0.0
        val ex = sims.map { exp(it - mx) }
        val sum = ex.sum()
        fun pick(ids: List<Int>) = ids.sumOf { ex[it] } / sum
        return SceneScores(pick(womanIds), pick(sexualIds), pick(coveredIds), pick(scaryIds))
    }

    companion object {
        const val SCENE_WOMAN = 0.75
        const val SCENE_SEXUAL = 0.75
        /** مشهد مخيف (وضع الطفل) */
        const val SCENE_SCARY = 0.65
        /** تحت هذا الحد يُعدّ المشهد خاليًا من النساء */
        const val SCENE_NO_WOMAN = 0.15
    }
}

object SceneInput {
    /** أقصر ضلع = size ثم قص الوسط، بقيم 0..1 بلا تطبيع، بترتيب CHW (مثل معالج النموذج). */
    fun of(px: IntArray, w: Int, h: Int, size: Int): FloatArray {
        val plane = size * size
        val out = FloatArray(3 * plane)
        val k = size.toFloat() / minOf(w, h)
        val sw = w * k; val sh = h * k
        val ox = (size - sw) / 2f; val oy = (size - sh) / 2f
        for (y in 0 until size) for (x in 0 until size) {
            val sx = (x - ox) / k; val sy = (y - oy) / k
            val xi = sx.toInt().coerceIn(0, w - 1); val yi = sy.toInt().coerceIn(0, h - 1)
            val p = px[yi * w + xi]
            val i = y * size + x
            out[i] = ((p shr 16) and 0xFF) / 255f
            out[plane + i] = ((p shr 8) and 0xFF) / 255f
            out[2 * plane + i] = (p and 0xFF) / 255f
        }
        return out
    }
}
