package org.hisnfilter.core

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** صندوق بإحداثيات [x, y, عرض, ارتفاع]. */
data class Box(val x: Float, val y: Float, val w: Float, val h: Float) {
    val area get() = max(0f, w) * max(0f, h)
    val cx get() = x + w / 2
    val cy get() = y + h / 2
    val right get() = x + w
    val bottom get() = y + h

    fun iou(o: Box): Float {
        val x1 = max(x, o.x); val y1 = max(y, o.y)
        val x2 = min(right, o.right); val y2 = min(bottom, o.bottom)
        val inter = max(0f, x2 - x1) * max(0f, y2 - y1)
        val u = area + o.area - inter
        return if (u > 0) inter / u else 0f
    }

    /** التقاطع نسبةً إلى أصغر الصندوقين (1 = أحدهما داخل الآخر). */
    fun overlapOfSmaller(o: Box): Float {
        val iw = max(0f, min(right, o.right) - max(x, o.x)); val ih = max(0f, min(bottom, o.bottom) - max(y, o.y))
        val m = min(area, o.area)
        return if (m > 0) iw * ih / m else 0f
    }

    fun contains(px: Float, py: Float, margin: Float = 0f): Boolean {
        val mx = w * margin; val my = h * margin
        return px >= x - mx && px <= right + mx && py >= y - my && py <= bottom + my
    }

    fun clip(width: Int, height: Int): Box {
        val x1 = x.coerceIn(0f, width.toFloat()); val y1 = y.coerceIn(0f, height.toFloat())
        val x2 = right.coerceIn(0f, width.toFloat()); val y2 = bottom.coerceIn(0f, height.toFloat())
        return Box(x1, y1, max(0f, x2 - x1), max(0f, y2 - y1))
    }

    fun expand(f: Float) = Box(x - w * f / 2, y - h * f / 2, w * (1 + f), h * (1 + f))
    fun offset(dx: Float, dy: Float) = Box(x + dx, y + dy, w, h)
    fun scale(s: Float) = Box(x * s, y * s, w * s, h * s)
}

/** NMS بسيط: ترتيب تنازلي بالثقة وحذف المتداخل فوق العتبة. */
fun nms(boxes: List<Box>, scores: FloatArray, scoreThreshold: Float, iouThreshold: Float, maxOut: Int = Int.MAX_VALUE, strictScore: Boolean = false): List<Int> {
    val order = scores.indices
        .filter { if (strictScore) scores[it] > scoreThreshold else scores[it] >= scoreThreshold }
        .sortedByDescending { scores[it] }
    val keep = ArrayList<Int>()
    for (i in order) {
        if (keep.all { boxes[i].iou(boxes[it]) <= iouThreshold }) {
            keep.add(i)
            if (keep.size >= maxOut) break
        }
    }
    return keep
}

// ===================== NudeNet 320n =====================

data class NudeDetection(val label: String, val score: Float, val box: Box)

object NudeNet {
    const val SIZE = 320
    val LABELS = listOf(
        "FEMALE_GENITALIA_COVERED", "FACE_FEMALE", "BUTTOCKS_EXPOSED", "FEMALE_BREAST_EXPOSED",
        "FEMALE_GENITALIA_EXPOSED", "MALE_BREAST_EXPOSED", "ANUS_EXPOSED", "FEET_EXPOSED",
        "BELLY_COVERED", "FEET_COVERED", "ARMPITS_COVERED", "ARMPITS_EXPOSED", "FACE_MALE",
        "BELLY_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_COVERED", "FEMALE_BREAST_COVERED", "BUTTOCKS_COVERED",
    )
    val SEXUAL = setOf("FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_EXPOSED")
    val AWRAH = setOf("FEMALE_BREAST_EXPOSED", "BUTTOCKS_EXPOSED")

    /**
     * مخرج النموذج [1, 22, rows] → كشوفات بإحداثيات الصورة الأصلية (مطابق للكود الرسمي nudenet 3.4.2).
     * الصورة في الزاوية العلوية اليسرى من مربع ضلعه max(w,h).
     */
    fun postprocess(output: FloatArray, rows: Int, width: Int, height: Int, minScore: Float = 0.2f, nmsScore: Float = 0.25f, nmsIou: Float = 0.45f): List<NudeDetection> {
        val nClasses = output.size / rows - 4
        val side = max(width, height).toFloat()
        val sx = side / SIZE; val sy = side / SIZE
        val boxes = ArrayList<Box>(); val scores = ArrayList<Float>(); val ids = ArrayList<Int>()
        for (r in 0 until rows) {
            var best = -1; var bestScore = Float.NEGATIVE_INFINITY
            for (c in 0 until nClasses) {
                val v = output[(4 + c) * rows + r]
                if (v > bestScore) { bestScore = v; best = c }
            }
            if (bestScore < minScore) continue
            val cx = output[r]; val cy = output[rows + r]; val w0 = output[2 * rows + r]; val h0 = output[3 * rows + r]
            var x = (cx - w0 / 2) * sx; var y = (cy - h0 / 2) * sy
            var w = w0 * sx; var h = h0 * sy
            x = x.coerceIn(0f, width.toFloat()); y = y.coerceIn(0f, height.toFloat())
            w = min(w, width - x); h = min(h, height - y)
            boxes.add(Box(x, y, w, h)); scores.add(bestScore); ids.add(best)
        }
        return nms(boxes, scores.toFloatArray(), nmsScore, nmsIou).map { i ->
            val b = boxes[i]
            NudeDetection(LABELS[ids[i]], scores[i], Box(b.x.toInt().toFloat(), b.y.toInt().toFloat(), b.w.toInt().toFloat(), b.h.toInt().toFloat()))
        }
    }

    data class Summary(val sexual: Double, val nudity: Double, val faces: List<NudeDetection>)

    /** وزن البطن المكشوف (مثل bellyWeight في nudenet.js): للمرأة أعلى من ثقة النموذج، وللرجل أقل. */
    fun bellyWeight(score: Double, female: Boolean): Double =
        if (score <= 0) 0.0 else if (female) min(1.0, score * 1.15 + 0.05) else 0.8 * score

    fun summarize(dets: List<NudeDetection>): Summary {
        fun best(label: String) = dets.filter { it.label == label }.maxOfOrNull { it.score.toDouble() }?.coerceAtLeast(0.0) ?: 0.0
        val sexual = SEXUAL.maxOf { best(it) }
        // البطن المكشوف: عورة كاملة إذا كانت الصورة لامرأة، وأخف وزنًا للرجال
        val female = best("FACE_FEMALE") >= 0.4 || best("FEMALE_BREAST_COVERED") >= 0.3
        var nudity = maxOf(sexual, AWRAH.maxOf { best(it) }, bellyWeight(best("BELLY_EXPOSED"), female))
        val revealing = min(max(best("FEMALE_BREAST_COVERED"), best("BUTTOCKS_COVERED")), best("BELLY_EXPOSED"))
        nudity = max(nudity, if (revealing > 0.3) min(1.0, revealing + 0.25) else 0.0)
        return Summary(sexual, nudity, dets.filter { it.label == "FACE_FEMALE" || it.label == "FACE_MALE" })
    }
}

// ===================== Human: blazeface + faceres + movenet =====================

data class Face(val box: Box, val score: Float, val gender: Gender = Gender.UNKNOWN, val genderScore: Double = 0.0, val age: Double = 0.0, val thigh: Double? = null)

object BlazeFace {
    const val SIZE = 256

    /** نقاط الارتكاز كما في Human: خطوة 16 (مرساتان) ثم خطوة 32 (6 مراسٍ) = 896. */
    val anchors: FloatArray by lazy {
        val out = ArrayList<Float>()
        for ((stride, n) in listOf(SIZE / 16 to 2, SIZE / 8 to 6)) {
            val rows = (SIZE + stride - 1) / stride
            for (gy in 0 until rows) for (gx in 0 until rows) repeat(n) {
                out.add(stride * (gx + 0.5f)); out.add(stride * (gy + 0.5f))
            }
        }
        out.toFloatArray()
    }

    /**
     * يرتب مخرجات النموذج الأربعة كما في Human: [512 صف ثم 384]، كل صف = ثقة + 16 رقمًا.
     * @param outs مصفوفات المخرجات بأي ترتيب (أحجامها 384، 512، 6144، 8192)
     */
    fun merge(outs: List<FloatArray>): FloatArray {
        val s = outs.sortedBy { it.size }
        val (c384, c512, d384, d512) = s
        val out = FloatArray(896 * 17)
        fun put(row: Int, conf: FloatArray, data: FloatArray, i: Int) {
            out[row * 17] = conf[i]
            System.arraycopy(data, i * 16, out, row * 17 + 1, 16)
        }
        for (i in 0 until 512) put(i, c512, d512, i)
        for (i in 0 until 384) put(512 + i, c384, d384, i)
        return out
    }

    /**
     * يفك الصناديق ويطبق NMS ثم يكبّر الصندوق 1.4 ويربّعه (مثل Human) — بإحداثيات الصورة.
     * يُرجع صناديق مربعة (قد تتجاوز حدود الصورة؛ يُقص منها الوجه لنموذج faceres).
     */
    fun decode(batch: FloatArray, imgW: Int, imgH: Int, maxFaces: Int = 20, minConf: Float = 0.3f, iou: Float = 0.1f, scale: Float = 1.4f): List<Pair<Box, Float>> {
        val n = batch.size / 17
        val a = anchors
        val boxes = ArrayList<Box>(n)
        val scores = FloatArray(n)
        for (i in 0 until n) {
            val o = i * 17
            val cx = batch[o + 1] + a[2 * i]; val cy = batch[o + 2] + a[2 * i + 1]
            val w = batch[o + 3]; val h = batch[o + 4]
            boxes.add(Box(cx - w / 2, cy - h / 2, w, h))
            scores[i] = (1.0 / (1.0 + exp(-batch[o].toDouble()))).toFloat()
        }
        val fx = imgW.toFloat() / SIZE; val fy = imgH.toFloat() / SIZE
        return nms(boxes, scores, minConf, iou, maxFaces, strictScore = true).map { i ->
            val b = boxes[i]
            val x1 = b.x * fx; val y1 = b.y * fy; val x2 = b.right * fx; val y2 = b.bottom * fy
            val cx = (x1 + x2) / 2; val cy = (y1 + y2) / 2
            val half = max((x2 - x1) * scale, (y2 - y1) * scale) / 2
            val sx1 = jsRound(cx - half); val sy1 = jsRound(cy - half)
            val sx2 = jsRound(cx + half); val sy2 = jsRound(cy + half)
            Box(sx1.toFloat(), sy1.toFloat(), (sx2 - sx1).toFloat(), (sy2 - sy1).toFloat()) to scores[i]
        }
    }

    /** Math.round في جافاسكربت (و round في بايثون للأعداد غير المنتصفة). */
    private fun jsRound(v: Float) = kotlin.math.floor(v + 0.5f).toInt()
}

object FaceRes {
    const val SIZE = 224

    /** ثقة الجنس = 2×|p−0.5| مقطوعة لمنزلتين، والعمر من توزيع 100 فئة (مثل Human). */
    fun parse(genderP: Float, ages: FloatArray): Triple<Gender, Double, Double> {
        val conf = (200 * abs(genderP - 0.5)).toInt() / 100.0
        var gender = Gender.UNKNOWN
        var score = 0.0
        if (conf > 0) {
            gender = if (genderP <= 0.5f) Gender.FEMALE else Gender.MALE
            score = min(0.99, conf)
        }
        var i = 0
        for (k in ages.indices) if (ages[k] > ages[i]) i = k
        val lo = if (i > 0) ages[i - 1] else 0f
        val hi = if (i + 1 < ages.size) ages[i + 1] else 0f
        val age = (if (lo > hi) 10.0 * i - 100.0 * lo else 10.0 * i + 100.0 * hi).roundToInt() / 10.0
        return Triple(gender, score, age)
    }
}

/** legs: نقاط الورك والركبة (x, y, ثقة) × 4 بإحداثيات الصورة. thigh: نسبة البشرة على الفخذ. */
data class Body(val box: Box, val score: Float, val legs: FloatArray? = null, val thigh: Double? = null)

object MoveNet {
    const val SIZE = 256

    /**
     * مخرج [1, 6, 56]: 17 نقطة × (y, x, ثقة) ثم صندوق (ymin, xmin, ymax, xmax, ثقة).
     * الإحداثيات نسبية للمربع المبطَّن (side) والصورة في وسطه.
     * الصندوق يُحسب من النقاط الواضحة بعد إعادتها لإحداثيات الصورة (مثل Human).
     */
    fun parse(res: FloatArray, side: Int, padX: Int, padY: Int, w: Int, h: Int, minConf: Float = 0.25f, maxDet: Int = 6): List<Body> {
        val bodies = ArrayList<Body>()
        for (d in 0 until res.size / 56) {
            val o = d * 56
            val score = (100 * res[o + 55]).roundToInt() / 100f
            if (score <= minConf) continue
            var x1 = Float.MAX_VALUE; var y1 = Float.MAX_VALUE; var x2 = -Float.MAX_VALUE; var y2 = -Float.MAX_VALUE
            var count = 0
            for (k in 0 until 17) {
                if (res[o + 3 * k + 2] > minConf) {
                    val px = res[o + 3 * k + 1] * side - padX
                    val py = res[o + 3 * k] * side - padY
                    x1 = min(x1, px); y1 = min(y1, py); x2 = max(x2, px); y2 = max(y2, py)
                    count++
                }
            }
            if (count == 0) continue
            // الورك والركبة (ترتيب MoveNet: 11، 12 ثم 13، 14)
            val legs = FloatArray(12)
            for ((j, k) in intArrayOf(11, 12, 13, 14).withIndex()) {
                legs[3 * j] = res[o + 3 * k + 1] * side - padX
                legs[3 * j + 1] = res[o + 3 * k] * side - padY
                legs[3 * j + 2] = res[o + 3 * k + 2]
            }
            x1 = max(0f, x1); y1 = max(0f, y1); x2 = min(w.toFloat(), x2); y2 = min(h.toFloat(), y2)
            bodies.add(Body(Box(x1, y1, x2 - x1, y2 - y1), score, legs))
        }
        bodies.sortByDescending { it.score }
        return bodies.take(maxDet)
    }
}

// ===================== دمج الوجوه والأجسام =====================

object People {
    private const val CHILD_AGE = 12.0

    /** منقول من packages/core/src/people.js. الجنس من نموذج الوجوه فقط. */
    fun fuse(faces: List<Face>, bodies: List<Body>, nnFaces: List<NudeDetection>, width: Int, height: Int): List<Person> {
        val area = max(1, width * height).toDouble()
        val all = faces.toMutableList()
        for (nf in nnFaces) {
            // نفس الوجه بصندوقين مختلفي الحجم: يكفي أن يقع مركز أحدهما داخل الآخر
            val match = all.any { it.box.iou(nf.box) > 0.3f || it.box.contains(nf.box.cx, nf.box.cy) || nf.box.contains(it.box.cx, it.box.cy) }
            if (!match && nf.score >= 0.4f) all.add(Face(nf.box, nf.score))
        }
        val people = ArrayList<Person>()
        val used = HashSet<Int>()
        for (b in bodies) {
            val fi = all.indices.firstOrNull { it !in used && b.box.contains(all[it].box.cx, all[it].box.cy, 0.15f) }
            if (fi != null) used.add(fi)
            people.add(toPerson(fi?.let { all[it] }, b.box, area, width, height, b.thigh))
        }
        for (i in all.indices) if (i !in used) {
            val f = all[i].box
            val box = Box(f.x - f.w, f.y, f.w * 3, min(height - f.y, f.h * 6))
            people.add(toPerson(all[i], box, area, width, height))
        }
        return people
    }

    private fun toPerson(face: Face?, raw: Box, area: Double, width: Int, height: Int, bodyThigh: Double? = null): Person {
        val box = raw.clip(width, height)
        val gender = face?.gender ?: Gender.UNKNOWN
        val adult = face?.age?.takeIf { it > 0 }?.let { it > CHILD_AGE }
        return Person(
            gender = gender,
            genderScore = if (gender == Gender.UNKNOWN) 0.0 else face!!.genderScore,
            adult = adult,
            area = box.area / area,
            box = box,
            // نسبة البشرة على الفخذ: من نقاط الجسم، وإلا تقديرًا من الوجه
            thighSkin = bodyThigh ?: face?.thigh,
        )
    }
}
