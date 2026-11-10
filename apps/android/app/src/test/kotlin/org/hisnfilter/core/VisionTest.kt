package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * يقارن معالجة مخرجات النماذج في Kotlin بالمرجع:
 *  - NudeNet: مخرجات الكود الرسمي (packages/core/test/fixtures/nudenet).
 *  - blazeface/faceres/movenet: مخرجات tools/reference_pipeline.py على النماذج المحوّلة.
 */
class VisionTest {
    private fun near(a: Double, b: Double, tol: Double) = abs(a - b) <= tol

    @Test
    fun nudenetMatchesOfficial() {
        for (name in TestFiles.IMAGES) {
            val meta = MiniJson.parse(TestFiles.text("${TestFiles.NUDENET_FIXTURES}/$name.json")).obj()
            val out = TestFiles.floats("${TestFiles.NUDENET_FIXTURES}/$name.out.bin")
            val dims = meta["dims"].list().map { it.num().toInt() }
            val got = NudeNet.postprocess(out, dims[2], meta["width"].num().toInt(), meta["height"].num().toInt())
            val want = meta["detections"].list().map { it.obj() }
            assertEquals("$name: عدد الكشوفات", want.size, got.size)
            for ((g, w) in got.zip(want)) {
                assertEquals(name, w["class"], g.label)
                assertTrue("$name ${g.label} الثقة", near(g.score.toDouble(), w["score"].num(), 1e-5))
                val wb = w["box"].list().map { it.num().toFloat() }
                assertEquals("$name ${g.label} الصندوق", wb, listOf(g.box.x, g.box.y, g.box.w, g.box.h))
            }
        }
    }

    @Test
    fun anchorsLikeHuman() {
        val a = BlazeFace.anchors
        assertEquals(896 * 2, a.size)
        assertEquals(8f, a[0]); assertEquals(8f, a[1]) // أول مرساة: منتصف الخلية الأولى بخطوة 16
        assertEquals(16f, a[512 * 2]); assertEquals(16f, a[512 * 2 + 1]) // أول مرساة بخطوة 32
    }

    @Test
    fun blazefaceFaceresMovenetMatchReference() {
        for (name in TestFiles.IMAGES) {
            val exp = MiniJson.parse(TestFiles.text("${TestFiles.FIXTURES}/$name.expected.json")).obj()
            val w = exp["width"].num().toInt(); val h = exp["height"].num().toInt()
            val faces = BlazeFace.decode(TestFiles.floats("${TestFiles.FIXTURES}/$name.blaze.bin"), w, h)
            val wantFaces = exp["faces"].list().map { it.obj() }
            assertEquals("$name: عدد الوجوه", wantFaces.size, faces.size)
            for ((g, wf) in faces.zip(wantFaces)) {
                val sq = wf["square"].list().map { it.num().toFloat() }
                assertEquals("$name مربع الوجه", sq, listOf(g.first.x, g.first.y, g.first.right, g.first.bottom))
                assertTrue("$name ثقة الوجه", near(g.second.toDouble(), wf["score"].num(), 1e-4))
            }
            for (fr in exp["faceres"].list().map { it.obj() }) {
                val ages = fr["ages"].list().map { it.num().toFloat() }.toFloatArray()
                val (g, gs, age) = FaceRes.parse(fr["genderP"].num().toFloat(), ages)
                assertEquals("$name الجنس", fr["gender"], g.name.lowercase())
                assertTrue("$name ثقة الجنس", near(gs, fr["genderScore"].num(), 1e-9))
                assertTrue("$name العمر $age", near(age, fr["age"].num(), 1e-9))
            }
            val bodies = MoveNet.parse(
                TestFiles.floats("${TestFiles.FIXTURES}/$name.movenet.bin"),
                exp["side"].num().toInt(), exp["padx"].num().toInt(), exp["pady"].num().toInt(), w, h,
            )
            val wantBodies = exp["bodies"].list().map { it.obj() }
            assertEquals("$name: عدد الأجسام", wantBodies.size, bodies.size)
            for ((g, wb) in bodies.zip(wantBodies)) {
                val b = wb["box"].list().map { it.num() }
                val gb = listOf(g.box.x, g.box.y, g.box.w, g.box.h).map { it.toDouble() }
                assertTrue("$name صندوق الجسم $gb ≠ $b", gb.zip(b).all { (x, y) -> near(x, y, 0.5) })
            }
        }
    }

    /** يشغّل خط الكشف كاملًا بمشغّل وهمي يعيد المخرجات المحفوظة، ويتحقق من الحكم النهائي. */
    @Test
    fun fullPipelineVerdicts() {
        val verdicts = mutableMapOf<String, Action>()
        for (name in TestFiles.IMAGES) {
            val exp = MiniJson.parse(TestFiles.text("${TestFiles.FIXTURES}/$name.expected.json")).obj()
            val w = exp["width"].num().toInt(); val h = exp["height"].num().toInt()
            val runner = FixtureRunner(name, exp)
            val r = FramePipeline(runner).analyze(IntArray(w * h), w, h)
            verdicts[name] = Policy.decide(r.toAnalysis(), PolicySettings.defaults(Viewer.MALE)).action
            if (name == "woman") {
                assertEquals(Action.SHOW, Policy.decide(r.toAnalysis(), PolicySettings.defaults(Viewer.FEMALE)).action)
            }
        }
        val blocked = { a: Action? -> a == Action.BLUR || a == Action.COVER }
        assertTrue("$verdicts", blocked(verdicts["woman"]) && blocked(verdicts["woman2"]) && blocked(verdicts["belly"]) && blocked(verdicts["group"]))
        assertEquals("$verdicts", Action.SHOW, verdicts["man"])
        assertEquals("$verdicts", Action.SHOW, verdicts["man2"])
        assertEquals("$verdicts", Action.SHOW, verdicts["men-group"])
        assertEquals("$verdicts", Action.SHOW, verdicts["landscape"])
    }

    @Test
    fun imageOps() {
        // صورة 2×1: أحمر ثم أزرق. مدخل NudeNet: الصورة أعلى اليسار والباقي أسود
        val px = intArrayOf(0xFFFF0000.toInt(), 0xFF0000FF.toInt())
        val t = ImageOps.nudeNetInput(px, 2, 1)
        val plane = 320 * 320
        assertEquals(1f, t[0]) // أحمر في الزاوية
        assertEquals(1f, t[2 * plane + 319]) // أزرق في آخر الصف الأول
        assertEquals(0f, t[2 * plane + 200 * 320 + 10]) // أسفل الصورة أسود
        val m = ImageOps.movenetInput(px, 2, 1)
        assertEquals(2, m.side); assertEquals(0, m.padX); assertEquals(0, m.padY)
        assertEquals(255, m.input[0]) // الصف الأول أحمر
        val tiles = Tiles.plan(540, 1200)
        assertEquals(3, tiles.size)
        assertEquals(1200f, tiles.last().bottom)
        assertEquals(1, Tiles.plan(500, 600).size)
    }

    private class FixtureRunner(name: String, exp: Map<String, Any?>) : ModelRunner {
        private val nn = TestFiles.floats("${TestFiles.NUDENET_FIXTURES}/$name.out.bin")
        private val batch = TestFiles.floats("${TestFiles.FIXTURES}/$name.blaze.bin")
        private val mv = TestFiles.floats("${TestFiles.FIXTURES}/$name.movenet.bin")
        private val fr = exp["faceres"].list().map { it.obj() }.iterator()
        override fun nudenet(input: FloatArray) = nn
        override fun blazeface(input: FloatArray): List<FloatArray> {
            // عكس الدمج: نعيد المخرجات الأربعة كما يخرجها النموذج
            val c512 = FloatArray(512); val d512 = FloatArray(512 * 16); val c384 = FloatArray(384); val d384 = FloatArray(384 * 16)
            for (i in 0 until 512) { c512[i] = batch[i * 17]; System.arraycopy(batch, i * 17 + 1, d512, i * 16, 16) }
            for (i in 0 until 384) { val r = (512 + i) * 17; c384[i] = batch[r]; System.arraycopy(batch, r + 1, d384, i * 16, 16) }
            return listOf(d384, c512, c384, d512)
        }
        override fun faceres(input: FloatArray): Pair<Float, FloatArray> {
            val f = fr.next()
            return f["genderP"].num().toFloat() to f["ages"].list().map { it.num().toFloat() }.toFloatArray()
        }
        override fun movenet(input: IntArray) = mv
    }
}
