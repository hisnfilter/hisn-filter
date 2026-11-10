package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** نفس حالات packages/core/test/audio.test.js على درجات YAMNet الحقيقية. */
class AudioTest {
    private val scores = MiniJson.parse(TestFiles.text("packages/core/test/fixtures/audio/yamnet-scores.json")).obj()
    private fun music(name: String) = AudioPolicy.isMusic(AudioPolicy.summarize(scores[name].list().map { it.num().toFloat() }.toFloatArray()))

    @Test
    fun musicIsMuted() {
        for (n in listOf("congas", "drama", "soft-music", "speech-over-music")) assertTrue(n, music(n))
    }

    @Test
    fun otherSoundsAreNot() {
        for (n in listOf("speech", "applause", "nature", "train")) assertFalse(n, music(n))
    }

    @Test
    fun vocalOnlyAllowedByDefault() {
        val vocal = AudioSummary(0.1f, 0.7f, 0.6f, 0.05f, 0.1f)
        assertFalse(AudioPolicy.isMusic(vocal))
        assertTrue(AudioPolicy.isMusic(vocal, allowVocal = false))
        assertTrue(AudioPolicy.isMusic(vocal.copy(instrument = 0.5f)))
    }

    @Test
    fun gate() {
        val g = MusicGate()
        assertEquals(listOf(false, true, true, false, false), listOf(false, true, false, false, false).map { g.push(it) })
        assertEquals(listOf(true, true, true, true, false), listOf(true, false, true, false, false).map { g.push(it) })
    }
}

/** محاكاة الصوت المباشر في أندرويد نافذة نافذة (كل 40ms، وتصنيف كل نصف ثانية). */
class LiveAudioTest {
    private class Sim(val c: LiveAudioController = LiveAudioController()) {
        val log = ArrayList<LiveAudioController.Out>()
        /** ثوانٍ من الصوت: هل هي موسيقى؟ وما ذروة الالتقاط؟ */
        fun run(seconds: Double, music: Boolean, peak: Float = 0.2f, ready: Boolean = true, singing: Boolean = false, muteSinger: Boolean = true) {
            val ticks = (seconds * 25).toInt()
            repeat(ticks) { i ->
                if ((log.size + 1) % 12 == 0) c.onClassified(music && peak >= 1e-3f, silent = peak < 1e-3f)
                if (singing && (log.size + 1) % 12 == 0) c.onSinging(true)
                log += c.tick(ready, removeMusic = true, muteSinger = muteSinger, capturedPeak = peak)
            }
        }
        fun last() = log.last()
    }

    @Test
    fun speechStaysOriginal() {
        val s = Sim()
        s.run(5.0, music = false)
        assertTrue(s.log.all { it.mode == LiveAudioController.Mode.ORIGINAL && !it.muteOriginal && !it.sendToEngine })
    }

    @Test
    fun musicIsCleanedThenReturnsToOriginal() {
        val s = Sim()
        s.run(2.0, music = false)
        s.run(6.0, music = true)
        val m = s.last()
        assertEquals(LiveAudioController.Mode.CLEAN, m.mode)
        assertTrue(m.muteOriginal && m.sendToEngine && m.cleanGain == 1f)
        s.run(3.0, music = false)
        assertEquals(LiveAudioController.Mode.ORIGINAL, s.last().mode)
        assertFalse(s.last().muteOriginal)
    }

    @Test
    fun firstMusicWindowEngagesWithinHalfSecond() {
        val s = Sim()
        s.run(0.6, music = true)
        assertTrue(s.log.any { it.mode == LiveAudioController.Mode.CLEAN })
    }

    @Test
    fun singerMutedUntilMusicEnds() {
        val s = Sim()
        s.run(4.0, music = true, singing = true)
        assertEquals(0f, s.last().cleanGain)
        s.run(2.0, music = true, singing = false) // ما زالت الأغنية: يبقى مكتومًا
        assertEquals(0f, s.last().cleanGain)
        s.run(3.0, music = false)
        s.run(3.0, music = true) // موسيقى جديدة بلا غناء: الكلام مسموع
        assertEquals(1f, s.last().cleanGain)
    }

    @Test
    fun singerHeardWhenUserDisablesMuting() {
        val s = Sim()
        s.run(4.0, music = true, singing = true, muteSinger = false)
        assertEquals(1f, s.last().cleanGain)
    }

    @Test
    fun engineNotReadyFallsBackToMuting() {
        val s = Sim()
        s.run(3.0, music = true, ready = false)
        assertEquals(LiveAudioController.Mode.MUTED, s.last().mode)
        assertTrue(s.last().muteOriginal)
    }

    @Test
    fun neverLeavesDeviceSilentWhenCaptureDies() {
        val s = Sim()
        s.run(2.0, music = true)
        s.run(3.5, music = true, peak = 0f) // الالتقاط صمت تمامًا ونحن كاتمون
        assertFalse(s.last().muteOriginal)
    }

    @Test
    fun deviceWhoseCaptureFollowsMuteDropsToMuting() {
        // جهاز يُسكت الالتقاط مع الكتم: كتم ← صمت 3ث ← إعادة الصوت ← موسيقى فورًا… مرتين
        val s = Sim()
        repeat(3) {
            s.run(1.0, music = true)
            s.run(3.2, music = true, peak = 0f)
            s.run(0.6, music = true)
        }
        assertFalse(s.c.cleanSupported)
        assertTrue(s.c.learnedCaptureFollowsMute)
        s.run(2.0, music = true)
        assertEquals(LiveAudioController.Mode.MUTED, s.last().mode)
    }

    @Test
    fun pausedVideoDoesNotDisableCleaning() {
        // المستخدم أوقف الفيديو أثناء الموسيقى ثم عاد بعد مدة بكلام: لا يُعدّ الجهاز غير داعم
        val s = Sim()
        s.run(2.0, music = true)
        s.run(5.0, music = false, peak = 0f)
        s.run(2.0, music = false)
        s.run(2.0, music = true)
        assertTrue(s.c.cleanSupported)
        assertFalse(s.c.learnedCaptureFollowsMute)
        assertEquals(LiveAudioController.Mode.CLEAN, s.last().mode)
    }
}
