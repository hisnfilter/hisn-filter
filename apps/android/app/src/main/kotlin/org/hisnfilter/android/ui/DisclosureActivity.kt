package org.hisnfilter.android.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.hisnfilter.android.HisnApp
import org.hisnfilter.android.service.Ui

/**
 * الإفصاح الواضح قبل طلب خدمة الوصول — تشترطه سياسة Google Play:
 * ماذا نقرأ، ولماذا، وأنه لا يُحفظ ولا يُرسل شيء، مع موافقة صريحة.
 */
class DisclosureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            val pad = Ui.dp(this@DisclosureActivity, 22)
            setPadding(pad, pad, pad, pad)
        }
        fun text(t: String, size: Float = 15f, bold: Boolean = false) = box.addView(TextView(this).apply {
            text = t; textSize = size; setPadding(0, 8, 0, 8)
            if (bold) setTypeface(typeface, Typeface.BOLD)
        })
        text("استخدام خدمة الوصول", 22f, bold = true)
        text("يحتاج فلتر حصن إذن «خدمة الوصول» ليؤدي عمله الأساسي: حمايتك من المحتوى المخالف في كل التطبيقات.")
        text("ماذا يقرأ؟", 17f, bold = true)
        text("• صورة ما يظهر على الشاشة، ليكتشف الصور المخالفة ويغطيها.\n• النصوص الظاهرة على الشاشة، ليخفي الألفاظ الفاحشة.\n• عنوان الموقع في المتصفح، ليحجب المواقع الإباحية.")
        text("ماذا يفعل؟", 17f, bold = true)
        text("• يغطي الصور والنصوص المخالفة.\n• يتخطى المقطع القصير المخالف بسحبة تلقائية.\n• يطلب رمز القفل عند محاولة تعطيله (إن وضعت رمزًا).")
        text("خصوصيتك", 17f, bold = true)
        text("كل التحليل يتم على جهازك فقط. لا تُحفظ أي صورة أو نص، ولا يُرسل أي شيء لأي جهة، ولا توجد خوادم ولا حسابات ولا إعلانات. لا نستخدم هذا الإذن لأي غرض آخر.")
        box.addView(Ui.button(this, "موافق، افتح الإعدادات") {
            HisnApp.of(this).prefs.disclosureAccepted = true
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            finish()
        })
        box.addView(Ui.button(this, "لا أوافق", primary = false) { finish() })
        text("في الإعدادات: اختر «فلتر حصن — حماية الشاشة» ثم فعّله.", 13f)
        val scroll = ScrollView(this).apply { addView(box) }
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(scroll)
    }
}
