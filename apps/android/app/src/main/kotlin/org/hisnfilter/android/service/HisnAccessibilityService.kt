package org.hisnfilter.android.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.hisnfilter.android.HisnApp
import org.hisnfilter.android.R
import org.hisnfilter.core.Apps
import org.hisnfilter.core.FramePipeline
import org.hisnfilter.core.Pin
import org.hisnfilter.core.SceneText
import org.hisnfilter.core.ScreenPolicy
import java.util.concurrent.Executor

/**
 * قلب تطبيق أندرويد: خدمة وصول ترى الشاشة وتحللها على الجهاز، ثم تغطي ما يخالف الإعدادات.
 *  - الصور والفيديو: لقطة للتطبيق المفتوح كل نصف ثانية تقريبًا (حين تتغير الشاشة، أو باستمرار في تطبيقات الفيديو)،
 *    تُحلَّل بنماذج NudeNet والوجوه والأجسام، وتُغطّى المواضع المخالفة فقط.
 *  - النصوص: الألفاظ الفاحشة تُغطّى في موضعها، والفقرة الإباحية تُغطّى كاملة.
 *  - المقاطع القصيرة: المقطع المخالف يُتخطّى بسحبة تلقائية.
 *  - المتصفحات: الموقع المحجوب يُغطّى بصفحة حجب حتى لو تجاوز المتصفح حجب DNS.
 *  - القفل: شاشات إعدادات النظام التي تخص التطبيق (التعطيل والحذف) تطلب الرمز.
 * لا يُحفظ شيء ولا يُرسل شيء.
 */
class HisnAccessibilityService : AccessibilityService() {
    private lateinit var app: HisnApp
    private lateinit var overlay: Overlay
    private val main = Handler(Looper.getMainLooper())
    private val mainExecutor = Executor { main.post(it) }
    private val visionThread = HandlerThread("hisn-vision").apply { start() }
    private val vision = Handler(visionThread.looper)
    private var runner: OrtRunner? = null
    private var pipeline: FramePipeline? = null

    @Volatile private var busy = false
    private var foreground: String? = null
    private var lastChange = 0L
    private var lastScrollWithoutDelta = 0L
    private var lastSkip = 0L
    private var coversPlacedAt = 0L
    private var preCoverUntil = 0L
    private var preCoverSetAt = 0L
    // مجموع التمرير منذ البداية: يُطرح منه ما كان وقت اللقطة، فتوضع الأغطية حيث صار المحتوى
    private var scrollX = 0f
    private var scrollY = 0f
    private var textScanPending = false
    private var running = false

    override fun onServiceConnected() {
        app = HisnApp.of(this)
        overlay = Overlay(this)
        running = true
        connected = true
        main.post(tick)
        Log.i(TAG, "الخدمة تعمل")
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        running = false
        connected = false
        main.removeCallbacksAndMessages(null)
        if (::overlay.isInitialized) overlay.destroy()
        vision.post { runner?.close(); runner = null }
        visionThread.quitSafely()
        super.onDestroy()
    }

    // ===================== الأحداث =====================

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        val pkg = e.packageName?.toString() ?: return
        if (pkg == packageName && e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val now = SystemClock.uptimeMillis()
        lastChange = now
        when (e.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                if (pkg != foreground && pkg !in Apps.IGNORE) {
                    foreground = pkg
                    // تطبيق جديد: الأغطية القديمة لا تخصه
                    overlay.setImageCovers(emptyList(), null)
                }
            }
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> onScrolled(e, pkg, now)
        }
        scheduleTextScan()
    }

    private fun onScrolled(e: AccessibilityEvent, pkg: String, now: Long) {
        val dx = e.scrollDeltaX; val dy = e.scrollDeltaY
        if (dy != -1 && (dx != 0 || dy != 0)) {
            scrollX += dx; scrollY += dy
            overlay.shiftImageCovers(dx.toFloat(), dy.toFloat())
        } else {
            lastScrollWithoutDelta = now
        }
        // انتقال لمقطع قصير جديد: نغطيه حتى يُفحص (اختياري، ويحتاج أندرويد 14 لأن اللقطة لا ترى غطاءنا)
        if (pkg in Apps.SHORT_VIDEO && app.prefs.active && app.prefs.filterImages && app.prefs.preCoverShortVideos &&
            Build.VERSION.SDK_INT >= 34
        ) {
            preCoverUntil = now + 1500
            preCoverSetAt = now
            overlay.setImageCovers(emptyList(), "جارٍ الفحص…")
        }
    }

    // ===================== فحص الصور =====================

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            try {
                maybeCapture()
            } catch (t: Throwable) {
                Log.w(TAG, "تعذّر الفحص", t)
                busy = false
            }
            main.postDelayed(this, if (foreground in Apps.VIDEO_HEAVY) 400 else 500)
        }
    }

    private fun maybeCapture() {
        val p = app.prefs
        if (!p.active || !p.filterImages) {
            if (overlay.imageCovers.isNotEmpty() || overlay.fullCover != null) overlay.setImageCovers(emptyList(), null)
            return
        }
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isInteractive || busy) return
        val now = SystemClock.uptimeMillis()
        if (preCoverUntil != 0L && now > preCoverUntil) {
            preCoverUntil = 0
            overlay.setImageCovers(overlay.imageCovers, null)
        }
        val pkg = foreground
        if (pkg == packageName || pkg in Apps.IGNORE) return
        // الشاشة الساكنة لا تُفحص مرارًا؛ تطبيقات الفيديو تُفحص باستمرار
        if (now - lastChange > 2500 && pkg !in Apps.VIDEO_HEAVY && now - coversPlacedAt > 3000) return
        busy = true
        val sx = scrollX; val sy = scrollY
        capture { bmp, bounds, capturedAt ->
            if (bmp == null) {
                busy = false
                return@capture
            }
            vision.post { analyze(bmp, bounds, capturedAt, sx, sy) }
        }
    }

    /**
     * لقطة للتطبيق المفتوح. في أندرويد 14 فأحدث نلتقط نافذة التطبيق وحدها (لا تظهر فيها أغطيتنا)،
     * وفيما قبله نلتقط الشاشة كلها. bounds = موضع النافذة على الشاشة (null = الشاشة كلها).
     */
    private fun capture(done: (Bitmap?, Rect?, Long) -> Unit) {
        val at = SystemClock.uptimeMillis()
        fun callback(bounds: Rect?) = object : TakeScreenshotCallback {
            override fun onSuccess(r: ScreenshotResult) {
                val hb = r.hardwareBuffer
                val bmp = try {
                    Bitmap.wrapHardwareBuffer(hb, r.colorSpace)?.let { hw ->
                        hw.copy(Bitmap.Config.ARGB_8888, false).also { hw.recycle() }
                    }
                } catch (t: Throwable) {
                    null
                } finally {
                    hb.close()
                }
                done(bmp, bounds, at)
            }

            override fun onFailure(code: Int) = done(null, null, at)
        }
        if (Build.VERSION.SDK_INT >= 34) {
            val win = windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isActive }
                ?: windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            if (win != null) {
                val r = Rect()
                win.getBoundsInScreen(r)
                takeScreenshotOfWindow(win.id, mainExecutor, callback(r))
                return
            }
        }
        takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, callback(null))
    }

    private fun analyze(full: Bitmap, offset: Rect?, capturedAt: Long, sx: Float, sy: Float) {
        try {
            val p = runner ?: OrtRunner(this).also { runner = it }
            val pipe = pipeline ?: FramePipeline(p, sceneText = runCatching { SceneText(assets.open("scene.json").bufferedReader().use { it.readText() }) }.getOrNull()).also { pipeline = it }
            // نصغّر اللقطة إلى عرض 540: كافٍ للكشف، وأسرع بكثير
            val scale = minOf(1f, 540f / full.width)
            val bmp = if (scale < 1f) Bitmap.createScaledBitmap(full, (full.width * scale).toInt(), (full.height * scale).toInt(), true) else full
            val w = bmp.width; val h = bmp.height
            val px = IntArray(w * h)
            bmp.getPixels(px, 0, w, 0, 0, w, h)
            if (bmp !== full) bmp.recycle()
            full.recycle()
            val frame = pipe.analyzeScreen(px, w, h)
            val verdict = ScreenPolicy.decide(frame, app.prefs.policy())
            val ox = offset?.left?.toFloat() ?: 0f; val oy = offset?.top?.toFloat() ?: 0f
            val rects = verdict.covers.map {
                RectF(it.box.x / scale + ox, it.box.y / scale + oy, it.box.right / scale + ox, it.box.bottom / scale + oy)
            }
            main.post {
                // تمرير حدث أثناء التحليل: نزيح النتائج بمقداره
                val dx = scrollX - sx; val dy = scrollY - sy
                apply(rects.map { RectF(it.left - dx, it.top - dy, it.right - dx, it.bottom - dy) }, if (verdict.fullScreen) "محتوى مخالف" else null, capturedAt)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "فشل التحليل", t)
            main.post { busy = false }
        }
    }

    private var emptyStreak = 0

    private fun apply(rects: List<RectF>, full: String?, capturedAt: Long) {
        busy = false
        if (!app.prefs.active || !app.prefs.filterImages) return
        val now = SystemClock.uptimeMillis()
        val moved = lastScrollWithoutDelta > coversPlacedAt || lastScrollWithoutDelta > capturedAt
        var shown = rects
        var keptFull: String? = null
        if (Build.VERSION.SDK_INT < 34) {
            // اللقطة ترى أغطيتنا، فما تحتها لا يُرى: نبقي الأغطية القديمة (وغطاء الشاشة الكاملة) ما لم تتحرك الشاشة
            if (!moved) {
                shown = merge(overlay.imageCovers, rects)
                keptFull = overlay.fullCover
            }
        } else if (rects.isEmpty() && full == null && !moved && emptyStreak == 0 && overlay.imageCovers.isNotEmpty()) {
            // تجنب الوميض: لا نزيل الغطاء إلا بعد فحصين نظيفين متتاليين
            shown = overlay.imageCovers
        }
        emptyStreak = if (rects.isEmpty() && full == null) emptyStreak + 1 else 0
        // لقطة أُخذت قبل الانتقال للمقطع الجديد لا تكفي لرفع غطاء "جارٍ الفحص"
        val keepPre = preCoverUntil > now && capturedAt < preCoverSetAt
        val fullMsg = full ?: keptFull ?: when {
            keepPre -> "جارٍ الفحص…"
            preCoverUntil > now && coverRatio(rects) > 0.35f -> "محتوى مخالف"
            else -> null
        }
        if (!keepPre) preCoverUntil = 0
        overlay.setImageCovers(shown, fullMsg)
        if (rects.isNotEmpty() || full != null) coversPlacedAt = now
        maybeAutoSkip(rects, full != null)
    }

    private fun merge(a: List<RectF>, b: List<RectF>): List<RectF> =
        (a + b).distinctBy { listOf(it.left.toInt() / 8, it.top.toInt() / 8, it.right.toInt() / 8, it.bottom.toInt() / 8) }

    private fun coverRatio(rects: List<RectF>): Float {
        val dm = resources.displayMetrics
        val screen = dm.widthPixels.toFloat() * dm.heightPixels
        return rects.sumOf { (it.width() * it.height()).toDouble() }.toFloat() / screen
    }

    /** في المقاطع القصيرة: المقطع المخالف (يغطي جزءًا كبيرًا من الشاشة) يُتخطّى بسحبة للأعلى. */
    private fun maybeAutoSkip(rects: List<RectF>, full: Boolean) {
        val pkg = foreground ?: return
        if (pkg !in Apps.SHORT_VIDEO || !app.prefs.autoSkipShortVideos) return
        if (!full && coverRatio(rects) < 0.35f) return
        val now = SystemClock.uptimeMillis()
        if (now - lastSkip < 1800) return
        lastSkip = now
        val dm = resources.displayMetrics
        val path = Path().apply {
            moveTo(dm.widthPixels / 2f, dm.heightPixels * 0.78f)
            lineTo(dm.widthPixels / 2f, dm.heightPixels * 0.22f)
        }
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 220)).build(), null, null)
    }

    // ===================== النصوص، والمتصفحات، والقفل =====================

    private fun scheduleTextScan() {
        if (textScanPending) return
        textScanPending = true
        main.postDelayed({
            textScanPending = false
            try {
                scanWindow()
            } catch (t: Throwable) {
                Log.w(TAG, "تعذّر فحص النص", t)
            }
        }, 300)
    }

    private fun scanWindow() {
        val root = rootInActiveWindow ?: return
        val pkg = root.packageName?.toString()
        if (pkg == null || pkg == packageName) { overlay.setTextCovers(emptyList()); return }
        if (pkg !in Apps.IGNORE) foreground = pkg
        val p = app.prefs

        // القفل: صفحات النظام التي تخص فلتر حصن (تعطيل خدمة الوصول، أو الشبكة، أو الحذف) تطلب الرمز
        if (p.lockEnabled && !p.unlocked && pkg in Apps.SYSTEM_SETTINGS && mentionsUs(root)) {
            showPinGate()
            return
        }
        if (overlay.panelTag == "pin" && (pkg !in Apps.SYSTEM_SETTINGS || p.unlocked)) overlay.hidePanel()

        if (!p.active) {
            overlay.setTextCovers(emptyList())
            if (overlay.panelTag == "site") overlay.hidePanel()
            return
        }

        // المتصفحات: الموقع المفتوح من شريط العنوان
        Apps.URL_BAR_IDS[pkg]?.let { ids ->
            val host = ids.asSequence().flatMap { root.findAccessibilityNodeInfosByViewId(it).asSequence() }
                .mapNotNull { it.text?.toString() }.firstOrNull()?.let { Apps.hostFromUrlBar(it) }
            val blocked = host?.let { app.isBlockedSite(it) }
            if (blocked != null) showSiteBlock(host, blocked) else if (overlay.panelTag == "site" && host != null) overlay.hidePanel()
        }

        val scary = p.blockScaryTopics
        if (!p.filterText && !scary) { overlay.setTextCovers(emptyList()); return }
        app.textFilter.insults = p.maskInsults
        val covers = ArrayList<RectF>()
        val screen = resources.displayMetrics.let { it.widthPixels.toFloat() * it.heightPixels }
        val level = p.level.key
        var visited = 0
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty() && visited < 900) {
            val n = queue.removeFirst()
            visited++
            for (i in 0 until n.childCount) n.getChild(i)?.let { queue.add(it) }
            if (n.isEditable || !n.isVisibleToUser) continue
            // السحر والجن والرعب: نغطي البطاقة كلها (العنوان والصورة المصغّرة) لا الكلمة
            if (scary && app.topics.isScary((n.text ?: n.contentDescription)?.toString())) {
                val card = cardBounds(n, screen)
                if (card != null) { covers.add(card); continue }
            }
            if (!p.filterText) continue
            val text = n.text?.toString() ?: continue
            if (text.length < 2) continue
            if (text.length >= 60 && app.textFilter.isExplicit(text, level)) {
                val r = Rect(); n.getBoundsInScreen(r); covers.add(RectF(r))
                continue
            }
            val ranges = app.textFilter.findProfanity(text)
            if (ranges.isEmpty()) continue
            covers.addAll(wordBounds(n, ranges.take(12).map { it.start to it.end }))
        }
        overlay.setTextCovers(covers)
    }

    /** أقرب عنصر قابل للضغط يحتوي العقدة (بطاقة المقطع)، ما لم يكن بحجم الشاشة تقريبًا. */
    private fun cardBounds(n: AccessibilityNodeInfo, screen: Float): RectF? {
        var c: AccessibilityNodeInfo? = n
        var best: Rect? = null
        for (i in 0 until 6) {
            val node = c ?: break
            val r = Rect(); node.getBoundsInScreen(r)
            if (r.width().toFloat() * r.height() > screen * 0.6f) break
            best = r
            if (node.isClickable) break
            c = node.parent
        }
        return best?.takeIf { !it.isEmpty }?.let { RectF(it) }
    }

    /** مواضع الكلمات داخل النص (من أندرويد 8)؛ وإن لم يدعمها التطبيق نغطي النص كله. */
    private fun wordBounds(n: AccessibilityNodeInfo, ranges: List<Pair<Int, Int>>): List<RectF> {
        val out = ArrayList<RectF>()
        val key = AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY
        val supported = n.availableExtraData?.contains(key) == true
        if (supported) {
            for ((s, e) in ranges) {
                val args = Bundle().apply {
                    putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_START_INDEX, s)
                    putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_LENGTH, e - s)
                }
                if (!n.refreshWithExtraData(key, args)) continue
                @Suppress("DEPRECATION")
                val boxes = n.extras.getParcelableArray(key)?.mapNotNull { it as? RectF } ?: continue
                val visible = boxes.filter { it.width() > 0 && it.height() > 0 }
                if (visible.isNotEmpty()) {
                    out.add(RectF(visible.minOf { it.left } - 2, visible.minOf { it.top } - 2, visible.maxOf { it.right } + 2, visible.maxOf { it.bottom } + 2))
                }
            }
        }
        if (out.isEmpty()) {
            val r = Rect(); n.getBoundsInScreen(r); out.add(RectF(r))
        }
        return out
    }

    private fun mentionsUs(root: AccessibilityNodeInfo): Boolean {
        val names = listOf(getString(R.string.app_name), getString(R.string.a11y_label), "Hisn Filter", "فلتر حصن")
        return names.any { root.findAccessibilityNodeInfosByText(it).isNotEmpty() }
    }

    private fun showSiteBlock(host: String, reason: String) {
        if (overlay.panelTag == "site") return
        val why = if (reason == "gambling") "موقع قمار" else "موقع إباحي"
        overlay.showPanel(
            "site",
            overlay.messagePanel(
                "هذا الموقع محجوب", "$host\n$why\n\n«قُل لِّلْمُؤْمِنِينَ يَغُضُّوا مِنْ أَبْصَارِهِمْ»",
                "رجوع" to {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    overlay.hidePanel()
                },
            ),
        )
    }

    private fun showPinGate() {
        if (overlay.panelTag == "pin") return
        val p = app.prefs
        val view = Ui.pinPad(
            this, "إعدادات محمية", "أدخل رمز القفل لتعديل فلتر حصن",
            onSubmit = { pin, result ->
                vision.post {
                    val ok = Pin.verify(pin, p.pinHash, p.pinSalt)
                    main.post {
                        if (ok) { p.unlock(); overlay.hidePanel() }
                        result(ok)
                    }
                }
            },
            onCancel = {
                performGlobalAction(GLOBAL_ACTION_HOME)
                overlay.hidePanel()
            },
        )
        overlay.showPanel("pin", view)
    }

    companion object {
        private const val TAG = "Hisn"
        /** الخدمة تعمل؛ ومعها صوت «إمكانية الوصول» مستقل (يُشغَّل عليه الصوت النظيف). */
        @Volatile var connected = false
            private set
    }
}
