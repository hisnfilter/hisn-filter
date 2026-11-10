// بديل صغير لـ JUnit 4 لتشغيل اختبارات Kotlin على الحاسوب بلا Gradle ولا إنترنت.
// في Android Studio تُستخدم مكتبة JUnit الحقيقية بنفس الأسماء، فلا يتغير كود الاختبارات.
package org.junit

@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class Test

object Assert {
    @JvmStatic fun fail(msg: String): Nothing = throw AssertionError(msg)
    @JvmStatic fun assertEquals(expected: Any?, actual: Any?) = assertEquals(null, expected, actual)
    @JvmStatic fun assertEquals(msg: String?, expected: Any?, actual: Any?) {
        if (expected != actual) fail("${msg ?: ""} متوقع <$expected> والناتج <$actual>")
    }
    @JvmStatic fun assertEquals(expected: Float, actual: Float) { if (expected != actual) fail("متوقع <$expected> والناتج <$actual>") }
    @JvmStatic fun assertTrue(cond: Boolean) = assertTrue(null, cond)
    @JvmStatic fun assertTrue(msg: String?, cond: Boolean) { if (!cond) fail(msg ?: "متوقع صحيح") }
    @JvmStatic fun assertFalse(cond: Boolean) = assertFalse(null, cond)
    @JvmStatic fun assertFalse(msg: String?, cond: Boolean) { if (cond) fail(msg ?: "متوقع خطأ") }
    @JvmStatic fun assertNotNull(v: Any?) { if (v == null) fail("متوقع قيمة") }
    @JvmStatic fun assertNull(v: Any?) = assertNull(null, v)
    @JvmStatic fun assertNull(msg: String?, v: Any?) { if (v != null) fail("${msg ?: ""} متوقع لا شيء والناتج <$v>") }
}
