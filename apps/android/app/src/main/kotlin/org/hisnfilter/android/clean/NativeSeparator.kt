package org.hisnfilter.android.clean

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Log
import org.hisnfilter.core.MdxSeparator
import java.nio.FloatBuffer

/**
 * فصل الموسيقى بالمعالج الأصلي للجوال (onnxruntime، عدة أنوية): نفس نموذج الصفحة ونفس الحساب
 * (MdxSeparator مطابق لـ separate.js)، لكنه أسرع بكثير من تشغيله داخل المتصفح.
 */
class NativeSeparator(ctx: Context) : AutoCloseable {
    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val inputName: String

    init {
        val threads = Runtime.getRuntime().availableProcessors().coerceIn(1, 4)
        val opts = OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            setIntraOpNumThreads(threads)
            // الأوزان int8 تُفك إلى float مرة واحدة عند التحميل (نفس سرعة النموذج الكامل وربع حجمه)
            addConfigEntry("session.disable_quant_qdq", "1")
            try {
                addXnnpack(mapOf("intra_op_num_threads" to threads.toString()))
            } catch (e: Exception) {
                Log.i("HisnSep", "XNNPACK غير متاح، نكمل بالمعالج العادي")
            }
        }
        session = env.createSession(ctx.assets.open(MODEL).use { it.readBytes() }, opts)
        inputName = session.inputNames.first()
    }

    private val mdx: MdxSeparator = MdxSeparator({ input ->
        OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(1, 4, 2560, (input.size / (4 * 2560)).toLong())).use { t ->
            session.run(mapOf(inputName to t)).use { r ->
                val b = (r[0] as OnnxTensor).floatBuffer
                FloatArray(b.remaining()).also { b.get(it) }
            }
        }
    })

    /** الموسيقى المقدّرة (44.1kHz ستيريو). */
    fun music(left: FloatArray, right: FloatArray, progress: (Float) -> Unit) = mdx.music(left, right, progress)

    override fun close() = session.close()

    companion object {
        const val MODEL = "models/uvr/inst-hq4-w8.onnx"
    }
}
