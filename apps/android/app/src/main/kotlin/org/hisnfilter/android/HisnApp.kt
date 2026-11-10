package org.hisnfilter.android

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import org.hisnfilter.core.DomainSet
import org.hisnfilter.core.Level
import org.hisnfilter.core.PolicySettings
import org.hisnfilter.core.TextFilter
import org.hisnfilter.core.Topics
import org.hisnfilter.core.Viewer

/** يحمل ما يُشارك بين الخدمتين والواجهة: الإعدادات، والقاموس، وقوائم المواقع (تُحمّل عند أول حاجة). */
class HisnApp : Application() {
    val prefs by lazy { Prefs(getSharedPreferences("hisn", Context.MODE_PRIVATE)) }
    val textFilter by lazy { TextFilter.fromJson(asset("lexicon.json")) }
    val adultSites by lazy { DomainSet.fromJson(asset("adult-domains.json")) }
    val gamblingSites by lazy { DomainSet.fromJson(asset("gambling-domains.json")) }
    /** خدمات بث مشفّرة لا يمكن فحص محتواها (نتفلكس…): تُحجب كاملًا */
    val streamingSites by lazy { DomainSet.fromJson(asset("streaming-domains.json")) }
    val topics by lazy { Topics.fromJson(asset("topics.json")) }

    override fun onCreate() {
        super.onCreate()
        // بدء العملية من جديد يعني أن خدمة كتم الموسيقى ليست تعمل (لا تنجو من موت العملية)
        prefs.musicGuardRunning = false
    }

    private fun asset(name: String) = assets.open(name).bufferedReader().use { it.readText() }

    /** هل الموقع محجوب حسب الإعدادات الحالية؟ */
    fun isBlockedSite(host: String): String? = when {
        prefs.blockAdultSites && adultSites.matches(host) -> "adult"
        prefs.blockGambling && gamblingSites.matches(host) -> "gambling"
        prefs.blockUnfilterableStreaming && streamingSites.matches(host) -> "streaming"
        else -> null
    }

    companion object {
        fun of(ctx: Context) = ctx.applicationContext as HisnApp
    }
}

/**
 * الإعدادات المحفوظة على الجهاز فقط (لا نسخ احتياطي سحابي). الأسماء نفسها في الإضافة.
 * القيم الافتراضية: المستوى المتوسط، والمستخدم رجل حتى يختار في الإعداد الأول.
 */
class Prefs(private val sp: SharedPreferences) {
    private fun b(k: String, d: Boolean) = sp.getBoolean(k, d)
    private fun put(k: String, v: Any?) = sp.edit().apply {
        when (v) {
            is Boolean -> putBoolean(k, v)
            is String -> putString(k, v)
            is Long -> putLong(k, v)
            null -> remove(k)
        }
    }.apply()

    var onboarded get() = b("onboarded", false); set(v) = put("onboarded", v)
    var disclosureAccepted get() = b("disclosureAccepted", false); set(v) = put("disclosureAccepted", v)
    var enabled get() = b("enabled", true); set(v) = put("enabled", v)
    var viewer: Viewer
        get() = if (sp.getString("viewer", "male") == "female") Viewer.FEMALE else Viewer.MALE
        set(v) = put("viewer", if (v == Viewer.FEMALE) "female" else "male")
    var level: Level get() = Level.of(sp.getString("level", "medium")); set(v) = put("level", v.key)
    var filterImages get() = b("filterImages", true); set(v) = put("filterImages", v)
    var filterText get() = b("filterText", true); set(v) = put("filterText", v)
    var blockAdultSites get() = b("blockAdultSites", true); set(v) = put("blockAdultSites", v)
    var blockGambling get() = b("blockGambling", true); set(v) = put("blockGambling", v)
    var blockUnfilterableStreaming get() = b("blockUnfilterableStreaming", true); set(v) = put("blockUnfilterableStreaming", v)
    var safeSearch get() = b("safeSearch", true); set(v) = put("safeSearch", v)
    var youtubeRestricted get() = b("youtubeRestricted", level != Level.LIGHT); set(v) = put("youtubeRestricted", v)
    var autoSkipShortVideos get() = b("autoSkipShortVideos", true); set(v) = put("autoSkipShortVideos", v)
    /** تغطية المقطع القصير فور الانتقال إليه حتى يُفحص (أندرويد 14 فأحدث). */
    var preCoverShortVideos get() = b("preCoverShortVideos", level == Level.STRICT); set(v) = put("preCoverShortVideos", v)
    var vpnWanted get() = b("vpnWanted", false); set(v) = put("vpnWanted", v)
    /** حذف الموسيقى مع إبقاء الكلام (في تنظيف الفيديو وفي الحماية المباشرة). */
    var removeMusic get() = b("removeMusic", true); set(v) = put("removeMusic", v)
    /** كتم صوت المغني بعد حذف الموسيقى (الأغاني). */
    var muteSinger get() = b("muteSinger", true); set(v) = put("muteSinger", v)
    /** هذا الجهاز يُسكت صوت التطبيقات الملتقط حين يُكتم (نادر): نكتفي بالكتم أثناء الموسيقى. */
    var captureFollowsMute get() = b("captureFollowsMute", false); set(v) = put("captureFollowsMute", v)
    var musicGuardRunning get() = b("musicGuardRunning", false); set(v) = put("musicGuardRunning", v)

    // ===== وضع الطفل =====
    var childMode get() = b("childMode", false); set(v) = put("childMode", v)
    /** "under9" | "9to12" | "13to15" */
    var childAge: String get() = sp.getString("childAge", "9to12") ?: "9to12"; set(v) = put("childAge", v)
    /** إخفاء السحر والجن والرعب والهالوين من الشاشة. */
    var blockScaryTopics get() = b("blockScaryTopics", childMode); set(v) = put("blockScaryTopics", v)
    /** إخفاء الشتائم العامة مثل «يا حمار». */
    var maskInsults get() = b("maskInsults", childMode); set(v) = put("maskInsults", v)
    /** يوتيوب المقيّد الشديد (لمن دون 13). */
    var youtubeStrict get() = b("youtubeStrict", false); set(v) = put("youtubeStrict", v)

    /** زر واحد: كل الحمايات المناسبة لعمر الطفل (مثل childPreset في packages/core/src/topics.js). */
    fun applyChildPreset(age: String) {
        childMode = true; childAge = age
        if (level == Level.LIGHT) level = Level.MEDIUM
        blockScaryTopics = true; maskInsults = true; filterImages = true; filterText = true
        blockAdultSites = true; blockGambling = true; safeSearch = true
        youtubeRestricted = true; youtubeStrict = age != "13to15"
        autoSkipShortVideos = true; removeMusic = true; muteSinger = true
    }

    // ===== القفل =====
    val lockEnabled get() = !sp.getString("pinHash", null).isNullOrEmpty()
    val pinHash: String? get() = sp.getString("pinHash", null)
    val pinSalt: String? get() = sp.getString("pinSalt", null)
    fun setPin(hash: String?, salt: String?) { put("pinHash", hash); put("pinSalt", salt) }
    fun unlock(minutes: Int = 5) = put("unlockedUntil", System.currentTimeMillis() + minutes * 60_000L)
    fun relock() = put("unlockedUntil", 0L)
    val unlocked get() = !lockEnabled || System.currentTimeMillis() < sp.getLong("unlockedUntil", 0L)

    /** إيقاف مؤقت (بعد إدخال الرمز إن وُجد قفل). */
    fun pauseFor(minutes: Int) = put("pausedUntil", System.currentTimeMillis() + minutes * 60_000L)
    fun resume() = put("pausedUntil", 0L)
    val paused get() = System.currentTimeMillis() < sp.getLong("pausedUntil", 0L)
    val active get() = enabled && !paused

    /** "boy" | "girl": يفرق في الصارم فقط. */
    var childSex: String get() = if (sp.getString("childSex", "girl") == "boy") "boy" else "girl"; set(v) = put("childSex", v)

    // وضع الطفل: المتوسط مثل وضع المرأة؛ والصارم حسب الطفل (الولد تُغطّى عنه النساء) ولا يغطّي كل الأشخاص
    fun policy(): PolicySettings {
        if (!childMode) return PolicySettings.defaults(viewer).copy(level = level, lockEnabled = lockEnabled)
        val boyStrict = level == Level.STRICT && childSex == "boy"
        return PolicySettings.defaults(if (boyStrict) Viewer.MALE else Viewer.FEMALE).copy(level = Level.MEDIUM, lockEnabled = lockEnabled, childMode = true, blockScaryTopics = blockScaryTopics)
    }

    fun listen(l: SharedPreferences.OnSharedPreferenceChangeListener) = sp.registerOnSharedPreferenceChangeListener(l)
    fun unlisten(l: SharedPreferences.OnSharedPreferenceChangeListener) = sp.unregisterOnSharedPreferenceChangeListener(l)
}
