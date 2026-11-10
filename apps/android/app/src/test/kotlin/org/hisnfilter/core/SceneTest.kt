package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** نموذج المشهد: الحساب نفسه في scene.js و NativeDetector.sceneScores، وقرار السياسة منه. */
class SceneTest {
    private val st = SceneText(TestFiles.text("packages/core/data/scene.json"))
    private val male = PolicySettings.defaults(Viewer.MALE)
    private val female = PolicySettings.defaults(Viewer.FEMALE)

    private fun embOf(idx: Int): FloatArray {
        // متجه الصورة = متجه النص نفسه → يجب أن يفوز ذلك النص
        val m = MiniJson.parse(TestFiles.text("packages/core/data/scene.json")) as Map<*, *>
        val row = (m["emb"] as List<*>)[idx] as List<*>
        return row.map { (it as Number).toFloat() * 7f }.toFloatArray()
    }

    @Test
    fun womanAndSexualPromptsScoreHigh() {
        val w = st.scores(embOf(7)); val s = st.scores(embOf(5))
        assertTrue("woman=${w.woman}", w.woman > 0.75)
        assertTrue("sexual=${s.sexual}", s.sexual > 0.75)
        assertTrue(w.sexual < 0.2)
    }

    @Test
    fun sceneInputShape() {
        val px = IntArray(10 * 20) { 0xFF8040 }
        val out = SceneInput.of(px, 20, 10, 4)
        assertEquals(3 * 16, out.size)
        assertEquals(1f, out[0], 1e-6f); assertEquals(0.5f, out[16], 0.01f); assertEquals(0.25f, out[32], 0.01f)
    }

    @Test
    fun policyUsesScene() {
        val woman = ImageAnalysis(true, sceneWoman = 0.9)
        assertEquals("scene-woman", Policy.decide(woman, male).reason)
        assertEquals(Action.SHOW, Policy.decide(woman, female).action)
        assertEquals(Action.SHOW, Policy.decide(woman, male.copy(level = Level.LIGHT)).action)
        assertEquals("scene-sexual", Policy.decide(ImageAnalysis(true, sceneSexual = 0.9), female).reason)
        assertEquals(Action.BLUR, Policy.decide(ImageAnalysis(true, partial = true), male.copy(level = Level.STRICT)).action)
        assertEquals(Action.SHOW, Policy.decide(ImageAnalysis(true, partial = true), male.copy(level = Level.MEDIUM)).action)
    }
}
