package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** نفس حالات packages/core/test/policy.test.js، مع اختبارات قرار الشاشة الخاصة بأندرويد. */
class PolicyTest {
    private val woman = Person(Gender.FEMALE, 0.9, true, 0.2)
    private val man = Person(Gender.MALE, 0.9, true, 0.2)
    private val girl = Person(Gender.FEMALE, 0.9, false, 0.2)
    private val niqabi = woman.copy(covered = true)
    private fun img(people: List<Person>, nudity: Double = 0.0, sexual: Double = 0.0) = ImageAnalysis(true, nudity, sexual, people)
    private val male = PolicySettings.defaults(Viewer.MALE)
    private val female = PolicySettings.defaults(Viewer.FEMALE)

    @Test
    fun unanalyzedIsBlurred() {
        assertEquals(Action.BLUR, Policy.decide(ImageAnalysis(false), female).action)
        assertEquals(Action.BLUR, Policy.decide(null, male).action)
    }

    @Test
    fun awrahCoveredForEveryone() {
        for (s in listOf(male, female)) for (l in Level.values()) {
            assertEquals(Action.COVER, Policy.decide(img(emptyList(), nudity = 0.9), s.copy(level = l)).action)
            assertEquals(Action.COVER, Policy.decide(img(emptyList(), sexual = 0.9), s.copy(level = l)).action)
        }
    }

    @Test
    fun maleViewer() {
        assertEquals(Action.BLUR, Policy.decide(img(listOf(woman)), male).action)
        assertEquals(Action.SHOW, Policy.decide(img(listOf(girl)), male).action)
        assertEquals(Action.SHOW, Policy.decide(img(listOf(man)), male).action)
    }

    @Test
    fun femaleViewer() {
        assertEquals(Action.SHOW, Policy.decide(img(listOf(woman)), female).action)
        assertEquals(Action.SHOW, Policy.decide(img(listOf(man)), female).action)
        assertEquals(Action.COVER, Policy.decide(img(listOf(woman), nudity = 0.8), female).action)
    }

    @Test
    fun niqab() {
        assertEquals(Action.SHOW, Policy.decide(img(listOf(niqabi)), male).action)
        assertEquals(Action.BLUR, Policy.decide(img(listOf(niqabi)), male.copy(level = Level.STRICT)).action)
    }

    @Test
    fun levels() {
        assertEquals(Action.SHOW, Policy.decide(img(listOf(woman)), male.copy(level = Level.LIGHT)).action)
        assertEquals(Action.SHOW, Policy.decide(img(listOf(man)), male.copy(level = Level.STRICT)).action)
    }

    @Test
    fun lowConfidence() {
        assertEquals(Action.SHOW, Policy.decide(img(listOf(man.copy(genderScore = 0.14))), male).action)
        assertEquals(Action.BLUR, Policy.decide(img(listOf(woman.copy(genderScore = 0.04))), male).action)
    }

    @Test
    fun unknownGender() {
        val unsure = Person(Gender.UNKNOWN, 0.3, true, 0.2)
        assertEquals(Action.BLUR, Policy.decide(img(listOf(unsure)), male).action)
        assertEquals(Action.SHOW, Policy.decide(img(listOf(unsure)), female).action)
    }

    @Test
    fun lock() {
        val locked = male.copy(lockEnabled = true)
        assertEquals("never", Policy.canReveal("nudity", locked))
        assertEquals("pin", Policy.canReveal("woman", locked))
        assertEquals("tap", Policy.canReveal("woman", male))
    }

    private fun frame(people: List<Person>, dets: List<NudeDetection> = emptyList()) =
        FrameResult(540, 1200, dets, people, emptyList(), emptyList())

    @Test
    fun screenCoversOnlyTheWoman() {
        val w = woman.copy(box = Box(10f, 100f, 200f, 300f), area = 0.09)
        val m = man.copy(box = Box(300f, 100f, 200f, 300f), area = 0.09)
        val v = ScreenPolicy.decide(frame(listOf(w, m)), male)
        assertEquals(1, v.covers.size)
        assertTrue(v.covers[0].box.contains(110f, 250f))
        assertFalse(v.covers[0].box.contains(400f, 250f))
        assertFalse(v.fullScreen)
        assertTrue(ScreenPolicy.decide(frame(listOf(w, m)), female).covers.isEmpty())
    }

    @Test
    fun screenSmallThumbnailStillCovered() {
        // صورة مصغرة 60×60 في شاشة 540×1200 (0.55%): أصغر من حد الصفحات لكنها تُغطّى على الشاشة
        val w = woman.copy(box = Box(10f, 10f, 60f, 60f), area = 3600.0 / (540 * 1200))
        assertEquals(1, ScreenPolicy.decide(frame(listOf(w)), male).covers.size)
    }

    @Test
    fun screenSexualCoversEverything() {
        val d = NudeDetection("FEMALE_GENITALIA_EXPOSED", 0.8f, Box(100f, 500f, 50f, 50f))
        val v = ScreenPolicy.decide(frame(emptyList(), listOf(d)), female)
        assertTrue(v.fullScreen)
        assertEquals("sexual", v.reason)
        val belly = NudeDetection("BELLY_EXPOSED", 0.5f, Box(100f, 500f, 50f, 50f))
        val bra = NudeDetection("FEMALE_BREAST_COVERED", 0.6f, Box(100f, 430f, 60f, 50f))
        val v2 = ScreenPolicy.decide(frame(emptyList(), listOf(belly, bra)), female)
        assertFalse(v2.fullScreen)
        assertEquals("لباس فاضح يُغطّى للمستخدمة أيضًا", 1, v2.covers.size)
    }
}
