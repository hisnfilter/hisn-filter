package org.hisnfilter.core

/**
 * قرارات الصوت — منقولة من packages/core/src/audio.js (نفس الفئات والعتبات).
 * النموذج: YAMNet (Google، Apache-2.0)، نافذة 15600 عينة بتردد 16kHz → 521 درجة.
 */
data class AudioSummary(val speech: Float, val vocal: Float, val music: Float, val instrument: Float, val genre: Float)

object AudioPolicy {
    const val RATE = 16000
    const val WINDOW = 15600

    private val SPEECH = (0..3).toList()
    private val VOCAL = (24..32).toList() + listOf(249, 250)
    private val MUSIC = listOf(132)
    private val INSTRUMENT = (133..194).toList() + (203..208).toList() + listOf(210)
    private val GENRE = (211..276).filter { it != 249 && it != 250 }

    fun summarize(scores: FloatArray): AudioSummary {
        fun max(ids: List<Int>) = ids.maxOf { scores.getOrElse(it) { 0f } }
        return AudioSummary(max(SPEECH), max(VOCAL), max(MUSIC), max(INSTRUMENT), max(GENRE))
    }

    /** يسمع النموذج غناءً لا كلامًا؟ (مثل hearsSinging في الإضافة): شرط لكتم المغني. */
    fun hearsSinging(a: AudioSummary): Boolean = !(a.speech >= 0.4f && a.vocal < a.speech * 0.5f)

    /** موسيقى تُكتم؟ الصوت البشري بلا آلات (إنشاد، تلاوة مجودة) لا يُكتم إذا سمح المستخدم (الافتراضي). */
    fun isMusic(a: AudioSummary, allowVocal: Boolean = true): Boolean {
        val instrumental = a.instrument >= 0.25f || a.genre >= 0.3f
        val vocalOnly = a.vocal >= 0.2f && a.instrument < 0.12f && a.genre < 0.2f
        if (vocalOnly && allowVocal) return false
        if (instrumental) return true
        val speechOverFaint = a.speech >= 0.5f && a.music < 0.5f && a.instrument < 0.12f
        return a.music >= 0.35f && !speechOverFaint
    }
}

/** تكتم من أول نافذة موسيقية، ولا تفتح إلا بعد نافذتين سليمتين متتاليتين. */
class MusicGate(private val openAfter: Int = 2) {
    var muted = false
        private set
    private var clean = 0

    fun push(isMusic: Boolean): Boolean {
        if (isMusic) {
            muted = true; clean = 0
        } else if (muted && ++clean >= openAfter) {
            muted = false; clean = 0
        }
        return muted
    }

    fun reset() { muted = false; clean = 0 }
}

/**
 * قرار الصوت المباشر في أندرويد كل 40ms — منفصل عن الأجهزة حتى يُختبر على الحاسوب.
 *
 * - بلا موسيقى: الصوت الأصلي كما هو.
 * - موسيقى + المحرك جاهز: يُكتم الأصل ويُشغَّل الصوت النظيف (الموسيقى محذوفة والكلام باقٍ)،
 *   وإن ظهر أنه غناء يُكتم النظيف أيضًا حتى تنتهي الموسيقى.
 * - موسيقى والمحرك غير متاح: كتم الأصل أثناء الموسيقى (الطريقة القديمة) كاحتياط.
 *
 * احتياط مهم: بعض الأجهزة قد تُسكت الصوت الملتقط حين يُكتم الأصل. إن صمت الالتقاط ونحن كاتمون
 * نعيد الصوت فورًا (لا نترك الجهاز صامتًا)، وإن تكرر ذلك مع عودة الموسيقى مباشرة نعدّ الجهاز
 * غير داعم للتنظيف ونرجع للكتم وحده.
 */
class LiveAudioController(
    private val tickMs: Int = 40,
    openAfter: Int = 2,
    /** تعلّمنا سابقًا أن هذا الجهاز يُسكت الالتقاط مع الكتم (يُحفظ في الإعدادات). */
    captureFollowsMute: Boolean = false,
) {
    enum class Mode { ORIGINAL, CLEAN, MUTED }
    data class Out(val mode: Mode, val muteOriginal: Boolean, val sendToEngine: Boolean, val cleanGain: Float)

    private val gate = MusicGate(openAfter)
    var cleanSupported = !captureFollowsMute
        private set
    var singerHeld = false
        private set
    /** اكتشفنا الآن أن الجهاز يُسكت الالتقاط مع الكتم (يُحفظ حتى لا يتكرر الاختبار). */
    var learnedCaptureFollowsMute = false
        private set
    private var silentTicks = 0
    private var strikes = 0
    private var releasedForSilence = false
    private var tailTicks = 0

    /**
     * نتيجة YAMNet (كل نصف ثانية). silent: الالتقاط صامت — ونحن كاتمون لا يُعدّ نهاية للموسيقى
     * (قد يكون الكتم نفسه أسكت الالتقاط)؛ تتولاه قاعدة الصمت في tick.
     */
    fun onClassified(isMusic: Boolean, silent: Boolean = false) {
        if (silent && gate.muted) return
        if (releasedForSilence && isMusic) {
            // عادت الموسيقى فور إعادة الصوت: الالتقاط كان صامتًا بسبب الكتم نفسه
            if (++strikes >= STRIKES) { cleanSupported = false; learnedCaptureFollowsMute = true }
        }
        if (releasedForSilence) releasedForSilence = false
        gate.push(isMusic)
        if (!gate.muted) singerHeld = false
    }

    /** المحرك أخبر أن الصوت الباقي غناء: يُكتم حتى تنتهي الموسيقى. */
    fun onSinging(singing: Boolean) {
        if (singing && gate.muted) singerHeld = true
    }

    /** لا يدعم الجهاز التنظيف (لا مسار صوت مستقل، أو فشل المحرك). */
    fun disableClean() { cleanSupported = false }

    fun tick(engineReady: Boolean, removeMusic: Boolean, muteSinger: Boolean, capturedPeak: Float): Out {
        val music = gate.muted && removeMusic
        if (!music) {
            silentTicks = 0
            // نستمر في إرسال ثانية بعد الموسيقى حتى لا تُقطع آخر كلمة في المحرك
            val send = tailTicks > 0 && cleanSupported && engineReady
            if (tailTicks > 0) tailTicks--
            return Out(Mode.ORIGINAL, muteOriginal = false, sendToEngine = send, cleanGain = 0f)
        }
        // صمت الالتقاط ونحن كاتمون: نعيد الصوت (قد يكون الكتم أسكت الالتقاط، أو توقف الفيديو)
        silentTicks = if (capturedPeak < SILENT_PEAK) silentTicks + 1 else 0
        if (silentTicks * tickMs >= SILENT_MS) {
            silentTicks = 0
            gate.reset()
            singerHeld = false
            releasedForSilence = true
            return Out(Mode.ORIGINAL, muteOriginal = false, sendToEngine = false, cleanGain = 0f)
        }
        if (cleanSupported && engineReady) {
            tailTicks = 1000 / tickMs
            val gain = if (muteSinger && singerHeld) 0f else 1f
            return Out(Mode.CLEAN, muteOriginal = true, sendToEngine = true, cleanGain = gain)
        }
        return Out(Mode.MUTED, muteOriginal = true, sendToEngine = false, cleanGain = 0f)
    }

    companion object {
        const val SILENT_PEAK = 1e-4f
        const val SILENT_MS = 3000
        const val STRIKES = 2
    }
}
