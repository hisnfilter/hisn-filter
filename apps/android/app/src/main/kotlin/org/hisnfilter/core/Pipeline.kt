package org.hisnfilter.core

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * تجهيز مدخلات النماذج من بكسلات ARGB (كما تُرجعها Bitmap.getPixels) — كود Kotlin خالص
 * حتى يُختبر على الحاسوب. لا نكبّر الصورة الكاملة، بل نأخذ عينات لبكسلات المخرج فقط (سريع).
 */
object ImageOps {
    private inline fun sample(px: IntArray, w: Int, h: Int, sx: Float, sy: Float, out: (Float, Float, Float) -> Unit) {
        val x = sx.coerceIn(0f, (w - 1).toFloat()); val y = sy.coerceIn(0f, (h - 1).toFloat())
        val x0 = floor(x).toInt(); val y0 = floor(y).toInt()
        val x1 = min(x0 + 1, w - 1); val y1 = min(y0 + 1, h - 1)
        val ax = x - x0; val ay = y - y0
        val p00 = px[y0 * w + x0]; val p01 = px[y0 * w + x1]; val p10 = px[y1 * w + x0]; val p11 = px[y1 * w + x1]
        out(mix(p00, p01, p10, p11, ax, ay, 16), mix(p00, p01, p10, p11, ax, ay, 8), mix(p00, p01, p10, p11, ax, ay, 0))
    }

    private fun ch(p: Int, s: Int) = ((p shr s) and 0xFF).toFloat()

    private fun mix(p00: Int, p01: Int, p10: Int, p11: Int, ax: Float, ay: Float, s: Int): Float {
        val top = ch(p00, s) + (ch(p01, s) - ch(p00, s)) * ax
        val bot = ch(p10, s) + (ch(p11, s) - ch(p10, s)) * ax
        return top + (bot - top) * ay
    }

    /** NudeNet: الصورة أعلى اليسار في مربع أسود ضلعه max(w,h)، يُصغَّر إلى 320 (cv2: half-pixel). CHW، 0..1. */
    fun nudeNetInput(px: IntArray, w: Int, h: Int): FloatArray {
        val n = NudeNet.SIZE
        val plane = n * n
        val out = FloatArray(3 * plane)
        val scale = max(w, h).toFloat() / n
        for (oy in 0 until n) for (ox in 0 until n) {
            val sx = (ox + 0.5f) * scale - 0.5f; val sy = (oy + 0.5f) * scale - 0.5f
            if (sx > w - 0.5f || sy > h - 0.5f) continue // خارج الصورة: أسود
            val i = oy * n + ox
            sample(px, w, h, sx, sy) { r, g, b -> out[i] = r / 255f; out[plane + i] = g / 255f; out[2 * plane + i] = b / 255f }
        }
        return out
    }

    /** BlazeFace: الصورة كاملة تُمدّ إلى 256×256 (TF resizeBilinear)، والقيم من −1 إلى 1. NHWC. */
    fun blazeInput(px: IntArray, w: Int, h: Int): FloatArray {
        val n = BlazeFace.SIZE
        val out = FloatArray(n * n * 3)
        val fx = w.toFloat() / n; val fy = h.toFloat() / n
        for (oy in 0 until n) for (ox in 0 until n) {
            val i = (oy * n + ox) * 3
            sample(px, w, h, ox * fx, oy * fy) { r, g, b -> out[i] = r / 127.5f - 1; out[i + 1] = g / 127.5f - 1; out[i + 2] = b / 127.5f - 1 }
        }
        return out
    }

    /**
     * FaceRes مثل Human: قص الصندوق المربع إلى 256×256 (TF cropAndResize، وما خرج عن الصورة أسود)
     * ثم تحجيمه إلى 224 (TF resizeBilinear)، والقيم 0..255. NHWC.
     */
    fun faceresInput(px: IntArray, w: Int, h: Int, box: Box): FloatArray {
        val c = BlazeFace.SIZE
        val crop = FloatArray(c * c * 3)
        // cropAndResize: الإحداثيات النسبية y1=top/h ... ثم in = y1*(H−1) + i*(y2−y1)*(H−1)/(c−1)
        val y1 = box.y / h; val y2 = box.bottom / h; val x1 = box.x / w; val x2 = box.right / w
        for (oy in 0 until c) {
            val sy = y1 * (h - 1) + oy * (y2 - y1) * (h - 1) / (c - 1)
            if (sy < 0 || sy > h - 1) continue
            for (ox in 0 until c) {
                val sx = x1 * (w - 1) + ox * (x2 - x1) * (w - 1) / (c - 1)
                if (sx < 0 || sx > w - 1) continue
                val i = (oy * c + ox) * 3
                sample(px, w, h, sx, sy) { r, g, b -> crop[i] = r; crop[i + 1] = g; crop[i + 2] = b }
            }
        }
        val n = FaceRes.SIZE
        val out = FloatArray(n * n * 3)
        val f = c.toFloat() / n
        for (oy in 0 until n) {
            val sy = oy * f; val y0 = sy.toInt(); val y1i = min(y0 + 1, c - 1); val ay = sy - y0
            for (ox in 0 until n) {
                val sx = ox * f; val x0 = sx.toInt(); val x1i = min(x0 + 1, c - 1); val ax = sx - x0
                for (k in 0 until 3) {
                    val top = crop[(y0 * c + x0) * 3 + k] + (crop[(y0 * c + x1i) * 3 + k] - crop[(y0 * c + x0) * 3 + k]) * ax
                    val bot = crop[(y1i * c + x0) * 3 + k] + (crop[(y1i * c + x1i) * 3 + k] - crop[(y1i * c + x0) * 3 + k]) * ax
                    out[(oy * n + ox) * 3 + k] = top + (bot - top) * ay
                }
            }
        }
        return out
    }

    data class Padded(val input: IntArray, val side: Int, val padX: Int, val padY: Int)

    /** MoveNet: الصورة في وسط مربع أسود ثم 256×256 (TF resizeBilinear) كأعداد صحيحة. NHWC. */
    fun movenetInput(px: IntArray, w: Int, h: Int): Padded {
        val n = MoveNet.SIZE
        val side = max(w, h)
        val padX = (side - w) / 2; val padY = (side - h) / 2
        val out = IntArray(n * n * 3)
        val f = side.toFloat() / n
        for (oy in 0 until n) for (ox in 0 until n) {
            val sx = ox * f - padX; val sy = oy * f - padY
            if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue
            val i = (oy * n + ox) * 3
            sample(px, w, h, sx, sy) { r, g, b -> out[i] = r.toInt(); out[i + 1] = g.toInt(); out[i + 2] = b.toInt() }
        }
        return Padded(out, side, padX, padY)
    }

    /** يقتطع جزءًا من الصورة (للتقسيم إلى مربعات). */
    fun crop(px: IntArray, w: Int, x: Int, y: Int, cw: Int, ch: Int): IntArray {
        val out = IntArray(cw * ch)
        for (r in 0 until ch) System.arraycopy(px, (y + r) * w + x, out, r * cw, cw)
        return out
    }
}

/** واجهة تشغيل النماذج: على أندرويد ONNX Runtime، وفي الاختبارات مخرجات محفوظة. */
interface ModelRunner {
    /** المدخل [1,3,320,320] والمخرج [1,22,rows] مسطّحًا. */
    fun nudenet(input: FloatArray): FloatArray
    /** المدخل [1,256,256,3]، والمخرجات الأربعة بأي ترتيب. */
    fun blazeface(input: FloatArray): List<FloatArray>
    /** المدخل [1,224,224,3]، والمخرج (احتمال الذكر، توزيع العمر 100). */
    fun faceres(input: FloatArray): Pair<Float, FloatArray>
    /** المدخل [1,256,256,3] أعداد صحيحة، والمخرج [1,6,56]. */
    fun movenet(input: IntArray): FloatArray
    /** نموذج المشهد (MobileCLIP): المدخل [1,3,256,256] والمخرج متجه 512. null إن لم يتوفر النموذج. */
    fun clip(input: FloatArray): FloatArray? = null
}

data class FrameResult(
    val width: Int,
    val height: Int,
    val detections: List<NudeDetection>,
    val people: List<Person>,
    val faces: List<Face>,
    val bodies: List<Body>,
    /** نموذج المشهد للإطار كله (null = لم يعمل) */
    val scene: SceneScores? = null,
    /** مشهد كل مربع عند تحليل الشاشة: (المربع، النتيجة) */
    val tileScenes: List<Pair<Box, SceneScores>> = emptyList(),
) {
    fun toAnalysis(): ImageAnalysis {
        val s = NudeNet.summarize(detections)
        return ImageAnalysis(true, s.nudity, s.sexual, people, scene?.woman ?: 0.0, scene?.sexual ?: 0.0, scene?.covered ?: 0.0, sceneScary = scene?.scary ?: 0.0, hasScene = scene != null, partial = scene == null && sceneWanted)
    }
    /** هل كان يُفترض أن يعمل نموذج المشهد؟ (للإعلان عن الفحص الناقص) */
    var sceneWanted: Boolean = false
}

class FramePipeline(private val runner: ModelRunner, private val maxGenderFaces: Int = 12, private val sceneText: SceneText? = null) {
    private fun scene(px: IntArray, w: Int, h: Int): SceneScores? {
        val st = sceneText ?: return null
        val e = runCatching { runner.clip(SceneInput.of(px, w, h, st.size)) }.getOrNull() ?: return null
        return st.scores(e)
    }

    /** تحليل صورة واحدة (أو مربع من الشاشة). */
    fun analyze(px: IntArray, w: Int, h: Int): FrameResult {
        val nn = runner.nudenet(ImageOps.nudeNetInput(px, w, h))
        val detections = NudeNet.postprocess(nn, nn.size / 22, w, h)
        val batch = BlazeFace.merge(runner.blazeface(ImageOps.blazeInput(px, w, h)))
        val faces = BlazeFace.decode(batch, w, h).mapIndexed { idx, (sq, score) ->
            if (idx >= maxGenderFaces) return@mapIndexed Face(sq.clip(w, h), score)
            val (p, ages) = runner.faceres(ImageOps.faceresInput(px, w, h, sq))
            val (g, gs, age) = FaceRes.parse(p, ages)
            Face(sq.clip(w, h), score, g, gs, age)
        }.map { it.copy(thigh = Skin.thighFromFace(it.box, px, w, h)) }
        val pad = ImageOps.movenetInput(px, w, h)
        val bodies = MoveNet.parse(runner.movenet(pad.input), pad.side, pad.padX, pad.padY, w, h)
            .map { it.copy(thigh = Skin.thighExposure(it.legs, px, w, h)) }
        val nnFaces = NudeNet.summarize(detections).faces
        val people = People.fuse(faces, bodies, nnFaces, w, h)
        val sc = scene(px, w, h)
        return FrameResult(w, h, detections, people, faces, bodies, sc).also { it.sceneWanted = sceneText != null }
    }

    /**
     * تحليل لقطة شاشة طويلة: نقسمها إلى مربعات متداخلة حتى لا تصغر الصور الصغيرة في الشاشة
     * إلى حد يفوت النموذج. الإحداثيات ترجع لإحداثيات الشاشة، والمساحة نسبة من الشاشة كلها.
     */
    fun analyzeScreen(px: IntArray, w: Int, h: Int): FrameResult {
        val tiles = Tiles.plan(w, h)
        if (tiles.size == 1) return analyze(px, w, h)
        val dets = ArrayList<NudeDetection>(); val people = ArrayList<Person>()
        val faces = ArrayList<Face>(); val bodies = ArrayList<Body>()
        val scenes = ArrayList<Pair<Box, SceneScores>>()
        val screenArea = (w * h).toDouble()
        for (t in tiles) {
            val r = analyze(ImageOps.crop(px, w, t.x.toInt(), t.y.toInt(), t.w.toInt(), t.h.toInt()), t.w.toInt(), t.h.toInt())
            r.scene?.let { scenes.add(t to it) }
            r.detections.forEach { dets.add(it.copy(box = it.box.offset(t.x, t.y))) }
            r.people.forEach { people.add(it.copy(box = it.box.offset(t.x, t.y), area = it.box.area / screenArea)) }
            r.faces.forEach { faces.add(it.copy(box = it.box.offset(t.x, t.y))) }
            r.bodies.forEach { bodies.add(it.copy(box = it.box.offset(t.x, t.y))) }
        }
        // شخص "غير معروف" في مربع هو غالبًا جزء من شخص قُطع عند حافة المربع وعُرف جنسه في مربع آخر
        val known = people.filter { it.gender != Gender.UNKNOWN }
        val merged = people.filter { p -> p.gender != Gender.UNKNOWN || known.none { it.box.overlapOfSmaller(p.box) > 0.3f } }
        return FrameResult(w, h, dets, merged, faces, bodies, null, scenes).also { it.sceneWanted = sceneText != null }
    }
}

object Tiles {
    /** مربعات بطول الضلع الأقصر، متداخلة بربع على الأقل، تغطي الصورة كلها. */
    fun plan(w: Int, h: Int): List<Box> {
        val side = min(w, h)
        val long = max(w, h)
        if (long <= side * 1.3) return listOf(Box(0f, 0f, w.toFloat(), h.toFloat()))
        val n = ceil((long - side) / (side * 0.75)).toInt() + 1
        val step = (long - side).toFloat() / (n - 1)
        return (0 until n).map { i ->
            val o = (i * step).toInt().toFloat()
            if (h >= w) Box(0f, o, side.toFloat(), side.toFloat()) else Box(o, 0f, side.toFloat(), side.toFloat())
        }
    }
}

/** ما يُغطّى على الشاشة: مستطيلات، أو الشاشة كلها عند المحتوى الجنسي الصريح. */
data class Cover(val box: Box, val reason: String)

data class ScreenVerdict(val covers: List<Cover>, val fullScreen: Boolean, val reason: String?)

object ScreenPolicy {
    /** أصغر شخص يُحسب على الشاشة: نحو 0.2% منها (صورة مصغرة ≈ 50×50 في شاشة 540 عرضًا). */
    const val MIN_AREA = 0.002

    fun decide(frame: FrameResult, settings: PolicySettings): ScreenVerdict {
        val s = settings.effective()
        val t = s.level.threshold
        val covers = ArrayList<Cover>()
        var full = false
        var fullReason: String? = null
        fun personAt(b: Box) = frame.people.filter { it.box.contains(b.cx, b.cy) }.maxByOrNull { it.box.area }
        fun coverAround(b: Box, reason: String) {
            val p = personAt(b)
            covers.add(Cover((p?.box ?: b.expand(1f)).expand(0.08f).clip(frame.width, frame.height), reason))
        }
        for (d in frame.detections) {
            val eff = when (d.label) {
                in NudeNet.SEXUAL, in NudeNet.AWRAH -> d.score.toDouble()
                "BELLY_EXPOSED" -> NudeNet.bellyWeight(d.score.toDouble(), personAt(d.box)?.gender == Gender.FEMALE || frame.detections.any { it.label == "FACE_FEMALE" && it.score >= 0.4f && it.box.iou(d.box.expand(3f)) > 0f })
                else -> 0.0
            }
            if (eff >= t) {
                val sexual = d.label in NudeNet.SEXUAL
                coverAround(d.box, if (sexual) "sexual" else "nudity")
                if (sexual) { full = true; fullReason = "sexual" }
            }
        }
        // لباس فاضح: بطن مكشوف مع صدر أو أرداف مغطاة بشيء ضيق، في نفس الشخص
        for (belly in frame.detections.filter { it.label == "BELLY_EXPOSED" }) {
            val p = personAt(belly.box)
            val tight = frame.detections.filter {
                (it.label == "FEMALE_BREAST_COVERED" || it.label == "BUTTOCKS_COVERED") &&
                    (p?.box?.contains(it.box.cx, it.box.cy) ?: (it.box.iou(belly.box.expand(2f)) > 0f))
            }.maxOfOrNull { it.score } ?: 0f
            val revealing = min(tight, belly.score).toDouble()
            if (revealing > 0.3 && min(1.0, revealing + 0.25) >= t) coverAround(belly.box, "nudity")
        }
        for (p in frame.people) {
            if (Policy.exposedThigh(p, s, MIN_AREA)) covers.add(Cover(p.box.expand(0.08f).clip(frame.width, frame.height), "nudity"))
            val d = Policy.personDecision(p, s, MIN_AREA) ?: continue
            covers.add(Cover(p.box.expand(0.08f).clip(frame.width, frame.height), d.reason))
        }
        // نموذج المشهد لكل مربع من الشاشة: يكمل ما فاته الكاشف (امرأة من الخلف، ساقان، رسم).
        // مربع الشاشة كبير، فلا يُغطّى لوجود امرأة إلا إن لم يُكتشف فيه شخص أصلًا (وإلا كفى حكم الشخص)
        val tiles = if (frame.tileScenes.isNotEmpty()) frame.tileScenes else frame.scene?.let { listOf(Box(0f, 0f, frame.width.toFloat(), frame.height.toFloat()) to it) } ?: emptyList()
        for ((box, sc) in tiles) {
            if (s.level == Level.LIGHT) break
            if (sc.sexual >= SceneText.SCENE_SEXUAL) { covers.add(Cover(box, "scene-sexual")); continue }
            val anyPerson = frame.people.any { it.box.iou(box) > 0f || box.contains(it.box.cx, it.box.cy) }
            if (s.blurAdultWomen && !anyPerson && sc.woman >= SceneText.SCENE_WOMAN) covers.add(Cover(box, "scene-woman"))
            else if (s.blurAdultWomen && s.blurCoveredWomen && !anyPerson && sc.covered >= SceneText.SCENE_WOMAN) covers.add(Cover(box, "woman"))
        }
        return ScreenVerdict(covers, full, fullReason ?: covers.firstOrNull()?.reason)
    }
}
