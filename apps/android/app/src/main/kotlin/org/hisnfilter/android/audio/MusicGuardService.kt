package org.hisnfilter.android.audio

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.IBinder
import android.util.Log
import org.hisnfilter.android.HisnApp
import org.hisnfilter.android.ui.MainActivity
import org.hisnfilter.android.service.HisnAccessibilityService
import org.hisnfilter.core.AudioPolicy
import org.hisnfilter.core.Level
import org.hisnfilter.core.LiveAudioController
import java.nio.FloatBuffer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * إزالة الموسيقى من صوت التطبيقات (تيك توك، يوتيوب، إنستقرام…) مع إبقاء الكلام:
 * 1) يلتقط صوت التطبيقات عبر AudioPlaybackCapture، ويصنّف كل نصف ثانية بنموذج YAMNet على الجهاز.
 * 2) عند الموسيقى: يُكتم الصوت الأصلي، ويمر الصوت الملتقط بمحرك DeepFilterNet3 (نفس محرك الإضافة)
 *    فيُشغَّل الكلام وحده على مسار صوت «إمكانية الوصول» المستقل. وإن كان الباقي غناءً كُتم حتى تنتهي الأغنية.
 * 3) إن لم يتوفر المحرك أو المسار المستقل (حماية الشاشة غير مفعلة): يُكتم الصوت أثناء الموسيقى فقط.
 * الأناشيد والتلاوة بلا آلات لا تُمس. لا يُسجّل شيء ولا يُحفظ ولا يُرسل.
 *
 * يحتاج موافقة "تسجيل الشاشة/الصوت" من النظام مرة بعد كل تشغيل للجهاز (شرط أندرويد لا يمكن تجاوزه)،
 * وإذن الميكروفون (شرط تقني لالتقاط صوت التطبيقات، ولا نستخدم الميكروفون نفسه).
 */
class MusicGuardService : Service() {
    private var projection: MediaProjection? = null
    private var record: AudioRecord? = null
    private var worker: Thread? = null
    @Volatile private var running = false
    private var weMuted = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            // مع القفل لا يُوقف من الإشعار؛ الإيقاف من التطبيق بعد الرمز
            val p = HisnApp.of(this).prefs
            if (p.lockEnabled && !p.unlocked && intent.getBooleanExtra(EXTRA_FROM_NOTIFICATION, false)) return START_NOT_STICKY
            stopSelf()
            return START_NOT_STICKY
        }
        @Suppress("DEPRECATION")
        val data: Intent = (if (android.os.Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java) else intent?.getParcelableExtra(EXTRA_DATA))
            ?: run { stopSelf(); return START_NOT_STICKY }
        val code = intent?.getIntExtra(EXTRA_CODE, Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        val mpm = getSystemService(MediaProjectionManager::class.java)
        projection = mpm.getMediaProjection(code, data)?.also {
            it.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() = stopSelf()
            }, null)
        }
        if (projection == null || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopSelf()
            return START_NOT_STICKY
        }
        start()
        return START_NOT_STICKY
    }

    private fun start() {
        val config = AudioPlaybackCaptureConfiguration.Builder(projection!!)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build()
        val rec = try {
            AudioRecord.Builder().setAudioFormat(format).setAudioPlaybackCaptureConfig(config)
                .setBufferSizeInBytes(TICK * 4 * 10).build() // 400ms: يتسع لوقت تصنيف YAMNet
        } catch (e: SecurityException) {
            Log.w(TAG, "لا إذن لالتقاط الصوت", e); stopSelf(); return
        }
        record = rec
        running = true
        worker = Thread({ loop(rec) }, "hisn-music").apply { start() }
    }

    private fun loop(rec: AudioRecord) {
        val audio = getSystemService(AudioManager::class.java)
        try {
            listen(rec, audio)
        } catch (t: Throwable) {
            // أي خطأ هنا (نموذج تالف، تسجيل لم يبدأ…) لا يجوز أن يُسقط التطبيق كله أو يترك الجهاز صامتًا
            Log.w(TAG, "توقف حارس الموسيقى", t)
            setMuted(audio, false)
            android.os.Handler(mainLooper).post { stopSelf() }
        }
    }

    // ===== الصوت النظيف =====
    private var engine: CleanEngine? = null
    private var track: AudioTrack? = null
    private var writer: Thread? = null
    private val cleanQueue = LinkedBlockingQueue<ShortArray>(64)
    @Volatile private var singingFlag = false
    @Volatile private var playing = false

    /** مسار صوت مستقل لا يُكتم مع الوسائط ولا يُلتقط مرة أخرى. */
    private fun cleanTrack(): AudioTrack = track ?: AudioTrack.Builder()
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build(),
        )
        .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
        .setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT), TICK * 2 * 3))
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build().also { t ->
            track = t
            writer = Thread({
                while (running) {
                    val pcm = cleanQueue.poll(200, TimeUnit.MILLISECONDS) ?: continue
                    if (playing) t.write(pcm, 0, pcm.size, AudioTrack.WRITE_BLOCKING)
                }
            }, "hisn-clean-out").apply { start() }
        }

    private fun startEngineIfPossible() {
        if (engine != null) return
        engine = CleanEngine(
            this,
            onAudio = { pcm -> if (playing && !cleanQueue.offer(pcm)) { cleanQueue.poll(); cleanQueue.offer(pcm) } },
            onSinging = { singingFlag = it },
        )
    }

    /** يجهّز مسار الصوت النظيف قبل كتم الأصل: صوت «إمكانية الوصول» بنفس مستوى صوت الوسائط. */
    private fun enterClean(audio: AudioManager, musicIndex: Int, controller: LiveAudioController) {
        val t = runCatching { cleanTrack() }.getOrElse { controller.disableClean(); return }
        matchVolume(audio, musicIndex)
        cleanQueue.clear()
        playing = true
        t.play()
    }

    private fun matchVolume(audio: AudioManager, musicIndex: Int) {
        val maxMusic = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val maxA11y = audio.getStreamMaxVolume(AudioManager.STREAM_ACCESSIBILITY).coerceAtLeast(1)
        val target = ((musicIndex.toFloat() / maxMusic) * maxA11y).roundToInt().coerceIn(1, maxA11y)
        runCatching { audio.setStreamVolume(AudioManager.STREAM_ACCESSIBILITY, target, 0) }
    }

    private fun leaveClean() {
        if (!playing) return
        playing = false
        cleanQueue.clear()
        track?.let { runCatching { it.pause(); it.flush() } }
    }

    private fun listen(rec: AudioRecord, audio: AudioManager) {
        val env = OrtEnvironment.getEnvironment()
        val session = env.createSession(assets.open("yamnet.onnx").use { it.readBytes() }, OrtSession.SessionOptions())
        val prefs = HisnApp.of(this).prefs
        val controller = LiveAudioController(tickMs = TICK * 1000 / RATE, captureFollowsMute = prefs.captureFollowsMute)
        // الصوت النظيف يحتاج مسار «إمكانية الوصول» المستقل، وهو يتوفر حين تعمل حماية الشاشة
        if (prefs.removeMusic && HisnAccessibilityService.connected && !prefs.captureFollowsMute) startEngineIfPossible() else controller.disableClean()
        val window = FloatArray(AudioPolicy.WINDOW)
        val buf = FloatArray(TICK)
        val pcm = ShortArray(TICK)
        val small = FloatArray(TICK / 3)
        var ticks = 0
        var musicIndex = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        rec.startRecording()
        try {
            while (running) {
                var got = 0
                while (got < buf.size && running) {
                    val n = rec.read(buf, got, buf.size - got, AudioRecord.READ_BLOCKING)
                    if (n <= 0) break
                    got += n
                }
                if (got < buf.size) continue
                var peak = 0f
                for (i in buf.indices) {
                    val v = buf[i]
                    peak = maxOf(peak, abs(v))
                    pcm[i] = (v.coerceIn(-1f, 1f) * 32767f).toInt().toShort()
                }
                // نافذة YAMNet (16kHz): متوسط كل 3 عينات
                for (i in small.indices) small[i] = (buf[3 * i] + buf[3 * i + 1] + buf[3 * i + 2]) / 3f
                System.arraycopy(window, small.size, window, 0, window.size - small.size)
                System.arraycopy(small, 0, window, window.size - small.size, small.size)

                val active = prefs.active && prefs.level != Level.LIGHT && prefs.removeMusic
                if (++ticks % CLASSIFY_EVERY == 0) {
                    val wPeak = window.maxOf { abs(it) }
                    val silent = wPeak < 1e-3f
                    val summary = if (active && !silent) AudioPolicy.summarize(yamnet(env, session, window)) else null
                    val isMusic = summary != null && AudioPolicy.isMusic(summary, allowVocal = true)
                    controller.onClassified(isMusic, silent)
                    // كاشف النغمة وحده يخلط الكلام المنغّم (الرسوم المتحركة) بالغناء: يلزم أن يسمع النموذج غناءً
                    controller.onSinging(singingFlag && summary != null && AudioPolicy.hearsSinging(summary))
                }
                val e = engine
                if (e?.failed != null) { controller.disableClean(); engine = null; e.close() }
                val out = controller.tick(engineReady = e?.ready == true, removeMusic = active, muteSinger = prefs.muteSinger, capturedPeak = peak)
                if (controller.learnedCaptureFollowsMute && !prefs.captureFollowsMute) prefs.captureFollowsMute = true

                if (!weMuted) musicIndex = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
                if (out.mode == LiveAudioController.Mode.CLEAN && !playing) enterClean(audio, musicIndex, controller)
                if (out.mode != LiveAudioController.Mode.CLEAN) leaveClean()
                track?.setVolume(out.cleanGain)
                if (out.sendToEngine) e?.process(pcm)
                if (out.muteOriginal && weMuted && !audio.isStreamMute(AudioManager.STREAM_MUSIC)) {
                    // المستخدم ضغط أزرار الصوت (فأُلغي الكتم): نطبق مستواه الجديد على الصوت النظيف ونعيد الكتم
                    musicIndex = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
                    if (playing) matchVolume(audio, musicIndex)
                    audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0)
                }
                setMuted(audio, out.muteOriginal)
                // تحقق: إن كان صوت «إمكانية الوصول» يتبع صوت الوسائط في هذا الجهاز فكتمه يُسكت النظيف أيضًا
                if (playing && weMuted && audio.getStreamVolume(AudioManager.STREAM_ACCESSIBILITY) == 0) {
                    controller.disableClean()
                    leaveClean()
                }
            }
        } finally {
            leaveClean()
            setMuted(audio, false)
            runCatching { rec.stop() }
            session.close()
        }
    }

    private fun yamnet(env: OrtEnvironment, session: OrtSession, window: FloatArray): FloatArray =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(window), longArrayOf(AudioPolicy.WINDOW.toLong())).use { t ->
            session.run(mapOf(session.inputNames.first() to t)).use { r ->
                val b = (r[0] as OnnxTensor).floatBuffer
                FloatArray(b.remaining()).also { b.get(it) }
            }
        }

    private fun setMuted(audio: AudioManager, mute: Boolean) {
        if (mute == weMuted) return
        weMuted = mute
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, if (mute) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE, 0)
    }

    override fun onDestroy() {
        running = false
        worker?.join(1500)
        writer?.join(500)
        runCatching { record?.release() }
        runCatching { track?.release() }
        engine?.close()
        projection?.stop()
        projection = null
        HisnApp.of(this).prefs.musicGuardRunning = false
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        // أقل ظهور ممكن: بلا صوت ولا أيقونة في شريط الحالة (أندرويد يفرض وجود الإشعار نفسه)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "إزالة الموسيقى", NotificationManager.IMPORTANCE_MIN))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, MusicGuardService::class.java).setAction(ACTION_STOP).putExtra(EXTRA_FROM_NOTIFICATION, true),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val locked = HisnApp.of(this).prefs.lockEnabled
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode)
            .setContentTitle("فلتر حصن: إزالة الموسيقى تعمل")
            .setContentText("تُحذف الموسيقى ويبقى الكلام. التحليل على جهازك فقط.")
            .setContentIntent(open)
            .apply { if (!locked) addAction(Notification.Action.Builder(null, "إيقاف", stop).build()) }
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "HisnMusic"
        private const val CHANNEL = "music-guard"
        private const val NOTIFICATION_ID = 41
        private const val RATE = 48000
        /** 40ms: أقل تأخير مع رسائل قليلة للمحرك */
        private const val TICK = 1920
        /** تصنيف كل 12 نافذة (≈ نصف ثانية) */
        private const val CLASSIFY_EVERY = 12
        const val ACTION_STOP = "org.hisnfilter.android.audio.STOP"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        const val EXTRA_FROM_NOTIFICATION = "fromNotification"

        fun start(ctx: Context, code: Int, data: Intent) {
            HisnApp.of(ctx).prefs.musicGuardRunning = true
            ctx.startForegroundService(Intent(ctx, MusicGuardService::class.java).putExtra(EXTRA_CODE, code).putExtra(EXTRA_DATA, data))
        }

        fun stop(ctx: Context) = ctx.startService(Intent(ctx, MusicGuardService::class.java).setAction(ACTION_STOP))
    }
}
