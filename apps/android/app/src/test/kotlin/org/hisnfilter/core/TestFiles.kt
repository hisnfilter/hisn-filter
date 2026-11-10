package org.hisnfilter.core

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** يجد ملفات المستودع (القاموس، وقوائم المواقع، ومخرجات النماذج المرجعية) من أي مجلد تشغيل. */
object TestFiles {
    val root: File by lazy {
        var d: File? = File(System.getProperty("user.dir")).absoluteFile
        while (d != null && !File(d, "packages/core/data/lexicon.json").exists()) d = d.parentFile
        d ?: error("لم أجد جذر المستودع")
    }

    fun file(rel: String) = File(root, rel)
    fun text(rel: String) = file(rel).readText()

    fun floats(rel: String): FloatArray {
        val b = ByteBuffer.wrap(file(rel).readBytes()).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        return FloatArray(b.remaining()).also { b.get(it) }
    }

    val lexicon by lazy { MiniJson.parse(text("packages/core/data/lexicon.json")).obj() }
    const val FIXTURES = "apps/android/app/src/test/resources/fixtures"
    const val NUDENET_FIXTURES = "packages/core/test/fixtures/nudenet"
    val IMAGES = listOf("woman", "man", "man2", "woman2", "group", "men-group", "belly", "landscape")
}

fun Any?.num() = (this as Number).toDouble()
