package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** نفس اختبارات packages/core/test/skin.test.js. */
class SkinTest {
    private fun argb(c: IntArray) = (255 shl 24) or (c[0] shl 16) or (c[1] shl 8) or c[2]

    /** جدار رمادي فاتح، وفخذان (60..140 × 100..200) بلون معيّن. */
    private fun image(color: IntArray, w: Int = 200, h: Int = 300): IntArray {
        val px = IntArray(w * h) { argb(intArrayOf(200, 205, 210)) }
        for (y in 100 until 200) for (x in 60 until 140) px[y * w + x] = argb(color)
        return px
    }

    private val legs = floatArrayOf(80f, 100f, 0.9f, 120f, 100f, 0.9f, 80f, 200f, 0.9f, 120f, 200f, 0.9f)

    @Test fun skinColors() {
        for (c in listOf(intArrayOf(224, 172, 140), intArrayOf(198, 134, 100), intArrayOf(141, 85, 60), intArrayOf(95, 60, 45))) assertTrue(Skin.isSkin(c[0], c[1], c[2]))
        for (c in listOf(intArrayOf(40, 60, 120), intArrayOf(20, 20, 20), intArrayOf(230, 230, 230), intArrayOf(60, 110, 60))) assertTrue(!Skin.isSkin(c[0], c[1], c[2]))
    }

    @Test fun exposedThighDetected() {
        assertTrue(Skin.thighExposure(legs, image(intArrayOf(224, 172, 140)), 200, 300)!! >= Skin.THIGH_SKIN)
        assertTrue(Skin.thighExposure(legs, image(intArrayOf(40, 60, 120)), 200, 300)!! < Skin.THIGH_SKIN)
        val weak = legs.copyOf().also { it[8] = 0.1f; it[11] = 0.1f }
        assertNull(Skin.thighExposure(weak, image(intArrayOf(224, 172, 140)), 200, 300))
    }

    @Test fun policyCoversWomanNotChildOrMan() {
        val s = PolicySettings.defaults(Viewer.FEMALE)
        fun d(p: Person) = Policy.decide(ImageAnalysis(true, people = listOf(p)), s)
        val woman = Person(Gender.FEMALE, 0.9, true, 0.2, thighSkin = 0.8)
        assertEquals(Decision(Action.COVER, "nudity"), d(woman))
        assertEquals(Action.SHOW, d(woman.copy(thighSkin = 0.1)).action)
        assertEquals(Action.SHOW, d(woman.copy(adult = false)).action)
        assertEquals(Action.SHOW, d(woman.copy(gender = Gender.MALE, genderScore = 0.3)).action)
    }
}
