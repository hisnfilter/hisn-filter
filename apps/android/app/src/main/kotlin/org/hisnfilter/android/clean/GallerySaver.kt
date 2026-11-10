package org.hisnfilter.android.clean

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * يستقبل الفيديو النظيف من الصفحة على دفعات ويحفظه في الاستوديو (مجلد Movies/Hisn).
 * لا يحتاج إذن تخزين (أندرويد 10+ يسمح للتطبيق بإضافة ملفاته إلى المعرض).
 * إن وصل الصوت منفصلًا (WAV — حين لا يتوفر مرمّز صوت في WebView) يُرمَّز AAC ويُدمج مع الفيديو هنا.
 */
class GallerySaver(private val ctx: Context) {
    private val dir = File(ctx.cacheDir, "clean").apply { mkdirs() }
    private val outs = HashMap<String, RandomAccessFile>()

    fun part(name: String) = File(dir, "part-$name")

    /** يبدأ ملفًا جديدًا (ويحذف ناتج المرة السابقة). */
    @Synchronized
    fun begin(name: String) {
        require(name == "video" || name == "audio") { "جزء غير معروف" }
        if (name == "video") { outs.values.forEach { runCatching { it.close() } }; outs.clear(); dir.listFiles()?.forEach { it.delete() } }
        outs.remove(name)?.close()
        outs[name] = RandomAccessFile(part(name), "rw").apply { setLength(0) }
    }

    /** كتابة في موضع (ملف MP4 تُصحَّح ترويسته في النهاية). */
    @Synchronized
    fun write(name: String, position: Long, base64: String) {
        val out = outs[name] ?: error("لم يبدأ الملف")
        out.seek(position)
        out.write(Base64.decode(base64, Base64.DEFAULT))
    }

    /** الناتج الحالي (للعرض في الصفحة قبل الحفظ). */
    fun current(name: String): File? {
        synchronized(this) { outs[name]?.let { runCatching { it.fd.sync() } } }
        return part(name).takeIf { it.exists() && it.length() > 0 }
    }

    /** يُغلق الأجزاء ويحفظ في المعرض. يُستدعى خارج الخيط الرئيسي. يُرجع عنوان الملف في المعرض. */
    fun finish(displayName: String): Uri {
        synchronized(this) { outs.values.forEach { runCatching { it.close() } }; outs.clear() }
        try {
            val video = part("video")
            check(video.length() > 0) { "الملف فارغ" }
            val audio = part("audio")
            val final = if (audio.exists() && audio.length() > 44) File(dir, "merged.mp4").also { mergeWav(video, audio, it) } else video
            return insert(final, safeName(displayName))
        } finally {
            dir.listFiles()?.forEach { it.delete() }
        }
    }

    private fun safeName(n: String): String {
        val base = n.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").take(120).ifBlank { "hisn-clean" }
        return if (base.endsWith(".mp4", ignoreCase = true)) base else "$base.mp4"
    }

    private fun insert(file: File, name: String): Uri {
        val resolver = ctx.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, name)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Hisn")
            put(MediaStore.Video.Media.IS_PENDING, 1)
        }
        val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values) ?: error("تعذّر إنشاء الملف في المعرض")
        try {
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out, 1 shl 16) } }
                ?: error("تعذّر الكتابة في المعرض")
            resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
            return uri
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    // ===== دمج WAV مع الفيديو (بديل نادر) =====

    private class Wav(val rate: Int, val channels: Int, val dataStart: Long, val dataBytes: Long)

    private fun readWavHeader(f: File): Wav = RandomAccessFile(f, "r").use { r ->
        val h = ByteArray(44).also { r.readFully(it) }
        val b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN)
        check(String(h, 0, 4) == "RIFF" && String(h, 8, 4) == "WAVE") { "صوت غير صالح" }
        check(b.getShort(20).toInt() == 1 && b.getShort(34).toInt() == 16) { "صيغة صوت غير متوقعة" }
        Wav(rate = b.getInt(24), channels = b.getShort(22).toInt(), dataStart = 44, dataBytes = minOf(b.getInt(40).toLong() and 0xffffffffL, f.length() - 44))
    }

    private fun mergeWav(videoFile: File, wavFile: File, out: File) {
        val wav = readWavHeader(wavFile)
        val ex = MediaExtractor().apply { setDataSource(videoFile.path) }
        val muxer = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        try {
            val vIndex = (0 until ex.trackCount).first { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("video/") }
            val vFormat = ex.getTrackFormat(vIndex)
            if (vFormat.containsKey(MediaFormat.KEY_ROTATION)) muxer.setOrientationHint(vFormat.getInteger(MediaFormat.KEY_ROTATION))
            val vTrack = muxer.addTrack(vFormat)

            val aFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, wav.rate, wav.channels).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
            }
            val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            enc.configure(aFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            enc.start()

            // نرمّز الصوت أولًا (نحتاج صيغته الناتجة قبل بدء الملف)، ونحفظ دفعاته في الذاكرة المؤقتة على القرص
            val aac = File(dir, "aac.bin")
            val samples = ArrayList<Triple<Long, Int, Int>>() // (الوقت، الحجم، الأعلام)
            var outFormat: MediaFormat? = null
            RandomAccessFile(wavFile, "r").use { pcm ->
                FileOutputStream(aac).use { sink ->
                    pcm.seek(wav.dataStart)
                    val frameBytes = 2 * wav.channels
                    var fed = 0L
                    var inputDone = false
                    val info = MediaCodec.BufferInfo()
                    val tmp = ByteArray(16384)
                    while (true) {
                        if (!inputDone) {
                            val i = enc.dequeueInputBuffer(10_000)
                            if (i >= 0) {
                                val buf = enc.getInputBuffer(i)!!
                                val want = minOf(buf.capacity().toLong(), tmp.size.toLong(), wav.dataBytes - fed).toInt() / frameBytes * frameBytes
                                val pts = fed / frameBytes * 1_000_000L / wav.rate
                                if (want <= 0) {
                                    enc.queueInputBuffer(i, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                    inputDone = true
                                } else {
                                    pcm.readFully(tmp, 0, want)
                                    buf.clear(); buf.put(tmp, 0, want)
                                    enc.queueInputBuffer(i, 0, want, pts, 0)
                                    fed += want
                                }
                            }
                        }
                        val o = enc.dequeueOutputBuffer(info, 10_000)
                        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) outFormat = enc.outputFormat
                        else if (o >= 0) {
                            if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                                val buf = enc.getOutputBuffer(o)!!
                                val bytes = ByteArray(info.size)
                                buf.position(info.offset); buf.get(bytes)
                                sink.write(bytes)
                                samples += Triple(info.presentationTimeUs, info.size, info.flags)
                            }
                            enc.releaseOutputBuffer(o, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                        }
                    }
                }
            }
            enc.stop(); enc.release()
            val aTrack = muxer.addTrack(outFormat ?: error("لم يُرمَّز الصوت"))
            muxer.start()

            // الفيديو كما هو
            ex.selectTrack(vIndex)
            val buf = ByteBuffer.allocate(maxOf(vFormat.getIntOrZero(MediaFormat.KEY_MAX_INPUT_SIZE), 4 shl 20))
            val info = MediaCodec.BufferInfo()
            while (true) {
                val n = ex.readSampleData(buf, 0)
                if (n < 0) break
                info.set(0, n, ex.sampleTime, if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                muxer.writeSampleData(vTrack, buf, info)
                ex.advance()
            }
            // الصوت المرمَّز
            RandomAccessFile(aac, "r").use { r ->
                for ((pts, size, flags) in samples) {
                    val bytes = ByteArray(size).also { r.readFully(it) }
                    info.set(0, size, pts, flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM.inv())
                    muxer.writeSampleData(aTrack, ByteBuffer.wrap(bytes), info)
                }
            }
            muxer.stop()
        } finally {
            runCatching { muxer.release() }
            ex.release()
        }
    }

    private fun MediaFormat.getIntOrZero(key: String) = if (containsKey(key)) getInteger(key) else 0
}
