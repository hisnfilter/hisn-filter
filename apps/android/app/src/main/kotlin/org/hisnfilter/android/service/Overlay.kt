package org.hisnfilter.android.service

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * طبقتان فوق التطبيقات (من نوع طبقة خدمة الوصول، فلا تحتاج إذن "الظهور فوق التطبيقات"):
 *  1) طبقة أغطية لا تستقبل اللمس: يبقى التطبيق تحتها قابلًا للتمرير والاستخدام.
 *  2) لوحة تستقبل اللمس عند الحاجة: صفحة الموقع المحجوب، وطلب رمز القفل.
 */
class Overlay(private val svc: AccessibilityService) {
    private val wm = svc.getSystemService(WindowManager::class.java)
    private val covers = CoverView(svc)
    private var coversAdded = false
    private var panel: View? = null
    var panelTag: String? = null
        private set

    private fun params(touchable: Boolean) = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            (if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE),
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        title = "HisnOverlay"
    }

    private fun ensureCovers() {
        if (!coversAdded) {
            wm.addView(covers, params(touchable = false))
            coversAdded = true
        }
    }

    /** أغطية الصور (إحداثيات الشاشة). full = غطاء الشاشة كلها برسالة. */
    fun setImageCovers(rects: List<RectF>, full: String?) {
        ensureCovers()
        covers.images = rects
        covers.full = full
        covers.invalidate()
    }

    fun setTextCovers(rects: List<RectF>) {
        ensureCovers()
        covers.texts = rects
        covers.invalidate()
    }

    /** يحرك أغطية الصور مع التمرير حتى تبقى فوق المحتوى نفسه. */
    fun shiftImageCovers(dx: Float, dy: Float) {
        if (covers.images.isEmpty()) return
        covers.images = covers.images.map { RectF(it.left - dx, it.top - dy, it.right - dx, it.bottom - dy) }
        covers.invalidate()
    }

    val imageCovers get() = covers.images
    val fullCover get() = covers.full

    fun clearAll() {
        setImageCovers(emptyList(), null)
        setTextCovers(emptyList())
    }

    fun showPanel(tag: String, view: View) {
        if (panelTag == tag) return
        hidePanel()
        panel = view
        panelTag = tag
        wm.addView(view, params(touchable = true))
    }

    fun hidePanel() {
        panel?.let { runCatching { wm.removeView(it) } }
        panel = null
        panelTag = null
    }

    fun destroy() {
        hidePanel()
        if (coversAdded) runCatching { wm.removeView(covers) }
        coversAdded = false
    }

    /** لوحة برسالة وأزرار (صفحة الحجب). */
    fun messagePanel(title: String, body: String, vararg buttons: Pair<String, () -> Unit>): View =
        Ui.panel(svc, title, body).apply {
            for ((label, action) in buttons) addView(Ui.button(svc, label) { action() })
        }
}

/** يرسم الأغطية: مستطيلات معتمة بزوايا دائرية وشعار صغير، ولا شيء خلافها (شفاف). */
@SuppressLint("ViewConstructor")
class CoverView(ctx: Context) : View(ctx) {
    var images: List<RectF> = emptyList()
    var texts: List<RectF> = emptyList()
    var full: String? = null

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(0x1F, 0x2A, 0x28) }
    private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(0x1F, 0x6F, 0x5C); style = Paint.Style.STROKE; strokeWidth = 3f }
    private val textFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(0x5B, 0x66, 0x63) }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD
    }
    private val loc = IntArray(2)
    private val spPx get() = android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, 1f, resources.displayMetrics)

    override fun onDraw(canvas: Canvas) {
        getLocationOnScreen(loc)
        canvas.translate(-loc[0].toFloat(), -loc[1].toFloat())
        val r = 18f * resources.displayMetrics.density / 2
        full?.let { msg ->
            canvas.drawColor(fill.color)
            label.textSize = 18f * spPx
            canvas.drawText("حصن", width / 2f + loc[0], height / 2f + loc[1] - label.textSize, label)
            label.textSize = 14f * spPx
            canvas.drawText(msg, width / 2f + loc[0], height / 2f + loc[1] + label.textSize, label)
            return
        }
        for (b in images) {
            canvas.drawRoundRect(b, r, r, fill)
            canvas.drawRoundRect(b, r, r, edge)
            if (b.width() > 120 && b.height() > 60) {
                label.textSize = minOf(16f * spPx, b.height() / 4)
                canvas.drawText("حصن", b.centerX(), b.centerY() + label.textSize / 3, label)
            }
        }
        for (b in texts) canvas.drawRoundRect(b, 6f, 6f, textFill)
    }
}

/** عناصر واجهة بسيطة تُبنى بالكود (بلا مكتبات) وتُستخدم في الطبقات والشاشات. */
object Ui {
    val BRAND = Color.rgb(0x1F, 0x6F, 0x5C)

    fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    fun panel(ctx: Context, title: String, body: String) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.rgb(0x13, 0x1C, 0x1A))
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        val p = dp(ctx, 28)
        setPadding(p, p, p, p)
        addView(TextView(ctx).apply {
            text = "🛡️ $title"; textSize = 22f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
        })
        addView(TextView(ctx).apply {
            text = body; textSize = 16f; setTextColor(Color.rgb(0xD6, 0xE4, 0xE0)); gravity = Gravity.CENTER
            setPadding(0, dp(ctx, 12), 0, dp(ctx, 20))
        })
    }

    fun button(ctx: Context, label: String, primary: Boolean = true, onClick: () -> Unit) = Button(ctx).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        setTextColor(Color.WHITE)
        setBackgroundColor(if (primary) BRAND else Color.rgb(0x3A, 0x45, 0x42))
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(ctx, 10)
        }
    }

    /** لوحة أرقام لإدخال رمز القفل (بلا لوحة مفاتيح النظام، فتعمل داخل الطبقة). */
    fun pinPad(ctx: Context, title: String, body: String, onSubmit: (String, (Boolean) -> Unit) -> Unit, onCancel: () -> Unit): View {
        val root = panel(ctx, title, body)
        val entered = StringBuilder()
        val dots = TextView(ctx).apply { textSize = 28f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; text = "—" }
        val status = TextView(ctx).apply { textSize = 14f; setTextColor(Color.rgb(0xFF, 0xB4, 0xA8)); gravity = Gravity.CENTER }
        root.addView(dots)
        root.addView(status)
        fun refresh() { dots.text = if (entered.isEmpty()) "—" else "●".repeat(entered.length) }
        val grid = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_LTR }
        val keys = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("⌫", "0", "✓"))
        for (row in keys) {
            val line = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
            for (k in row) {
                line.addView(Button(ctx).apply {
                    text = k; textSize = 22f; setTextColor(Color.WHITE); setBackgroundColor(Color.rgb(0x26, 0x33, 0x30))
                    layoutParams = LinearLayout.LayoutParams(0, dp(ctx, 64), 1f).apply { setMargins(dp(ctx, 4), dp(ctx, 4), dp(ctx, 4), dp(ctx, 4)) }
                    setOnClickListener {
                        when (k) {
                            "⌫" -> if (entered.isNotEmpty()) entered.deleteCharAt(entered.length - 1)
                            "✓" -> if (entered.length >= 4) {
                                status.text = "جارٍ التحقق…"
                                onSubmit(entered.toString()) { ok ->
                                    if (!ok) { status.text = "رمز غير صحيح"; entered.clear(); refresh() }
                                }
                            }
                            else -> if (entered.length < 8) entered.append(k)
                        }
                        refresh()
                    }
                })
            }
            grid.addView(line)
        }
        root.addView(grid)
        root.addView(button(ctx, "رجوع", primary = false) { onCancel() })
        return root
    }
}
