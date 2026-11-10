package org.hisnfilter.android.service

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Log
import org.hisnfilter.core.ModelRunner
import java.nio.FloatBuffer
import java.nio.IntBuffer

/**
 * تشغيل النماذج الأربعة على الجهاز عبر ONNX Runtime. كل النماذج داخل التطبيق (assets)،
 * ولا يُحمّل شيء من الإنترنت ولا تُرسل أي صورة.
 */
class OrtRunner(ctx: Context) : ModelRunner, AutoCloseable {
    private val env = OrtEnvironment.getEnvironment()
    private val nude = open(ctx, "320n.onnx")
    private val blaze = open(ctx, "blazeface.onnx")
    private val faceres = open(ctx, "faceres.onnx")
    private val movenet = open(ctx, "movenet-multipose.onnx")
    // نموذج المشهد اختياري: إن غاب أو فشل يبقى الفحص يعمل بالنماذج الأخرى ويُعلن أنه ناقص
    private val clip: OrtSession? = runCatching { open(ctx, "clip-s0.onnx") }.onFailure { Log.w(TAG, "clip-s0 غير متاح: ${it.message}") }.getOrNull()

    private fun open(ctx: Context, name: String): OrtSession {
        val opts = OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            setIntraOpNumThreads(2)
            try {
                addXnnpack(mapOf("intra_op_num_threads" to "2"))
            } catch (e: Exception) {
                Log.i(TAG, "XNNPACK غير متاح، نستخدم المعالج العادي")
            }
        }
        val bytes = ctx.assets.open(name).use { it.readBytes() }
        return env.createSession(bytes, opts)
    }

    private fun floats(t: OnnxTensor): FloatArray {
        val b = t.floatBuffer
        return FloatArray(b.remaining()).also { b.get(it) }
    }

    private fun runFloat(s: OrtSession, input: FloatArray, shape: LongArray): List<Pair<String, FloatArray>> =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(input), shape).use { t ->
            s.run(mapOf(s.inputNames.first() to t)).use { r -> r.map { it.key to floats(it.value as OnnxTensor) } }
        }

    override fun nudenet(input: FloatArray) = runFloat(nude, input, longArrayOf(1, 3, 320, 320)).first().second

    override fun blazeface(input: FloatArray) = runFloat(blaze, input, longArrayOf(1, 256, 256, 3)).map { it.second }

    override fun faceres(input: FloatArray): Pair<Float, FloatArray> {
        val out = runFloat(faceres, input, longArrayOf(1, 224, 224, 3))
        val gender = out.first { it.first.contains("gender") }.second[0]
        val ages = out.first { it.first.contains("age") }.second
        return gender to ages
    }

    override fun movenet(input: IntArray): FloatArray =
        OnnxTensor.createTensor(env, IntBuffer.wrap(input), longArrayOf(1, 256, 256, 3)).use { t ->
            movenet.run(mapOf(movenet.inputNames.first() to t)).use { r -> floats(r[0] as OnnxTensor) }
        }

    override fun clip(input: FloatArray): FloatArray? {
        val c = clip ?: return null
        return runFloat(c, input, longArrayOf(1, 3, 256, 256)).first { it.second.size == 512 }.second
    }

    override fun close() {
        listOf(nude, blaze, faceres, movenet, clip).forEach { s -> s?.let { runCatching { it.close() } } }
    }

    companion object {
        private const val TAG = "HisnOrt"
    }
}
