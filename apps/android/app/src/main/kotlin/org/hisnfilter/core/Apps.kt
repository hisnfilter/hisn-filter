package org.hisnfilter.core

/** معرفة بالتطبيقات الشائعة: تطبيقات المقاطع القصيرة، والمتصفحات وشريط العنوان فيها، والإعدادات. */
object Apps {
    /** تطبيقات تعرض فيديو بملء الشاشة يُقلَب بالسحب: نفحصها باستمرار، ونتخطى المقطع المخالف. */
    val SHORT_VIDEO = setOf(
        "com.zhiliaoapp.musically", "com.ss.android.ugc.trill", "com.ss.android.ugc.aweme", // تيك توك
        "com.instagram.android", "com.instagram.lite", "com.instagram.barcelona",
        "com.google.android.youtube", "com.snapchat.android",
        "com.facebook.katana", "com.facebook.lite", "com.likee.video", "video.like",
    )

    /** تطبيقات فيها فيديو كثير حتى لو لم تكن قصيرة: نفحصها باستمرار أيضًا. */
    val VIDEO_HEAVY = SHORT_VIDEO + setOf(
        "com.twitter.android", "com.netflix.mediaclient", "com.amazon.avod.thirdpartyclient",
        "tv.twitch.android.app", "com.vimeo.android.videoapp", "com.reddit.frontpage",
    )

    /** معرّفات شريط العنوان في المتصفحات (لقراءة الموقع المفتوح حتى لو تجاوز المتصفح DNS). */
    val URL_BAR_IDS = mapOf(
        "com.android.chrome" to listOf("com.android.chrome:id/url_bar"),
        "com.chrome.beta" to listOf("com.chrome.beta:id/url_bar"),
        "com.brave.browser" to listOf("com.brave.browser:id/url_bar"),
        "com.microsoft.emmx" to listOf("com.microsoft.emmx:id/url_bar"),
        "com.opera.browser" to listOf("com.opera.browser:id/url_field"),
        "com.opera.mini.native" to listOf("com.opera.mini.native:id/url_field"),
        "com.sec.android.app.sbrowser" to listOf("com.sec.android.app.sbrowser:id/location_bar_edit_text"),
        "org.mozilla.firefox" to listOf("org.mozilla.firefox:id/mozac_browser_toolbar_url_view"),
        "com.duckduckgo.mobile.android" to listOf("com.duckduckgo.mobile.android:id/omnibarTextInput"),
        "com.vivaldi.browser" to listOf("com.vivaldi.browser:id/url_bar"),
        "com.kiwibrowser.browser" to listOf("com.kiwibrowser.browser:id/url_bar"),
        "com.mi.globalbrowser" to listOf("com.mi.globalbrowser:id/url"),
    )

    /** شاشات النظام التي قد تُستخدم لتعطيل الفلتر أو حذفه (تُحمى برمز القفل). */
    val SYSTEM_SETTINGS = setOf(
        "com.android.settings", "com.samsung.android.settings", "com.miui.securitycenter",
        "com.google.android.packageinstaller", "com.android.packageinstaller",
        "com.google.android.permissioncontroller", "com.samsung.accessibility",
        "com.google.android.accessibility.suite",
        "com.android.vending", // صفحة التطبيق في Play فيها زر "إلغاء التثبيت"
        "com.android.vpndialogs", // نافذة قطع الشبكة الافتراضية
    )

    /** لا نفحصها: واجهة النظام، ولوحات المفاتيح. */
    val IGNORE = setOf("com.android.systemui")

    /** يستخرج اسم الموقع من نص شريط العنوان ("https://www.x.com/a" أو "x.com"). */
    fun hostFromUrlBar(text: String): String? {
        var t = text.trim().lowercase()
        if (t.isEmpty() || t.contains(' ')) return null
        t = t.substringAfter("://")
        t = t.substringBefore('/').substringBefore('?').substringBefore('#').substringBefore(':')
        if (!t.contains('.') || t.any { !(it.isLetterOrDigit() || it == '.' || it == '-') }) return null
        return t
    }
}
