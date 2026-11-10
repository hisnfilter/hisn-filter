package org.hisnfilter.android.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.net.VpnService
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import org.hisnfilter.android.HisnApp
import org.hisnfilter.android.audio.MusicGuardService
import org.hisnfilter.android.service.HisnAccessibilityService
import org.hisnfilter.android.service.Ui
import org.hisnfilter.android.vpn.HisnVpnService
import org.hisnfilter.core.Level
import org.hisnfilter.core.Pin
import org.hisnfilter.core.Viewer

/**
 * الشاشة الرئيسية: حالة الحماية، والإعدادات، والقفل.
 * مع القفل: أي تعديل يطلب الرمز، ثم يبقى مفتوحًا 5 دقائق.
 */
class MainActivity : Activity() {
    private val app get() = HisnApp.of(this)
    private val p get() = app.prefs
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            val pad = Ui.dp(this@MainActivity, 18)
            setPadding(pad, pad, pad, pad)
        }
        val scroll = ScrollView(this).apply { addView(content) }
        // أندرويد 15+: المحتوى يمتد تحت أشرطة النظام، فنضيف هامشًا بقدرها
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    // ===================== البناء =====================

    private var advanced = false
    private var setupStep = 0

    private fun render() {
        content.removeAllViews()
        if (!p.onboarded) return renderSetup()
        title("🛡️ فلتر حصن", 26f)

        // ===== الحالة: خطوة واحدة واضحة إن بقي شيء =====
        val a11y = accessibilityOn()
        val vpn = p.vpnWanted && VpnService.prepare(this) == null
        val music = p.musicGuardRunning
        val steps = listOfNotNull(
            if (!a11y) Triple("حماية الشاشة", "تغطية الصور والألفاظ المخالفة في كل التطبيقات.") { enableAccessibility() } else null,
            if (!vpn) Triple("حجب المواقع", "المواقع الإباحية والقمار، والبحث الآمن، في كل المتصفحات.") { enableVpn() } else null,
            if (!music && p.removeMusic) Triple("إزالة الموسيقى", "تُحذف الموسيقى ويبقى الكلام. يطلب أندرويد موافقة مرة بعد كل تشغيل للجوال.") { enableMusicGuard() } else null,
        )
        if (steps.isEmpty()) {
            card("✅ الحماية مكتملة", "كل شيء يعمل. لا تحتاج لفعل شيء.")
        } else {
            val (name, why, act) = steps.first()
            card(if (steps.size == 1) "باقي خطوة واحدة" else "باقي ${steps.size} خطوات", "التالية: $name — $why")
            button("تفعيل $name", onClick = act)
            if (name == "حماية الشاشة") note("إن ظهر أن الإعداد «مقيّد»: معلومات التطبيق ← (⋮) ← «السماح بالإعدادات المقيدة».", action = "معلومات التطبيق") {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        }
        if (p.paused) warn("الحماية متوقفة مؤقتًا.", "استئناف") { p.resume(); render() }
        if (privateDnsHostname()) warn("«DNS الخاص» مضبوط على خادم آخر فيتجاوز حجب المواقع. اجعله «تلقائي».", "الإعدادات") {
            startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS))
        }

        // ===== تنظيف فيديو =====
        section("تنظيف فيديو من الاستوديو")
        note("نسخة نظيفة تُحفظ في الاستوديو. أو من الاستوديو: مشاركة ← «تنظيف بفلتر حصن».")
        button("اختيار فيديو") { startActivity(Intent(this, org.hisnfilter.android.clean.CleanVideoActivity::class.java)) }

        // ===== وضع الطفل: زر واحد =====
        section("وضع الطفل")
        content.addView(Switch(this).apply {
            text = "تشغيل وضع الطفل"; textSize = 15f; isChecked = p.childMode
            setOnCheckedChangeListener { b, checked ->
                if (checked) { p.applyChildPreset(p.childAge); render() }
                else { b.isChecked = true; guarded { p.childMode = false; render() } } // الإطفاء يحتاج الرمز
            }
        })
        if (p.childMode) {
            radio(listOf("أقل من 9" to "under9", "9 إلى 12" to "9to12", "13 إلى 15" to "13to15"), p.childAge) { age ->
                // الأصغر أشد فلا يحتاج رمزًا، والأكبر يخفف فيحتاجه
                val ages = listOf("under9", "9to12", "13to15")
                if (ages.indexOf(age) <= ages.indexOf(p.childAge)) { p.applyChildPreset(age); render() }
                else guarded { p.applyChildPreset(age); render() }
            }
            note("يعمل الآن: إخفاء السحر والجن والرعب والهالوين من الشاشة، ويوتيوب المقيّد، والبحث الآمن، وحجب المواقع، وإزالة الموسيقى، وتغطية العورات." +
                if (p.lockEnabled) "" else " ننصح بوضع رمز قفل من الخيارات المتقدمة.")
        } else note("زر واحد يشغّل كل الحمايات المناسبة لعمر الطفل.")

        // ===== الإعدادان الأساسيان =====
        section("من يستخدم الجهاز؟")
        radio(listOf("رجل" to Viewer.MALE, "امرأة" to Viewer.FEMALE), p.viewer) { v -> guarded { p.viewer = v; render() } }
        section("مستوى الحماية")
        radio(listOf("مخفف" to Level.LIGHT, "متوسط" to Level.MEDIUM, "صارم" to Level.STRICT), p.level) { v -> guarded { p.level = v; render() } }
        note(levelHint())

        // ===== خيارات متقدمة (مطوية) =====
        content.addView(Ui.button(this, if (advanced) "إخفاء الخيارات المتقدمة ▴" else "خيارات متقدمة ▾", false) { advanced = !advanced; render() })
        if (advanced) renderAdvanced(a11y, vpn, music)
    }

    private fun levelHint() = when (p.level) {
        Level.LIGHT -> "العورات والمواقع الإباحية فقط."
        Level.MEDIUM -> "الموصى به: العورات، والنساء للرجل، والألفاظ، والمواقع، والموسيقى."
        Level.STRICT -> "يُغطّى المقطع أو الصورة كاملًا إذا فيه امرأة، ويُغطّى المقطع القصير حتى يُفحص."
    }

    private fun renderAdvanced(a11y: Boolean, vpn: Boolean, music: Boolean) {
        section("ما يعمل الآن")
        statusRow("حماية الشاشة", a11y, "تفعيل") { enableAccessibility() }
        statusRow("حجب المواقع", vpn, if (vpn) "إيقاف" else "تفعيل") {
            if (vpn) guarded { p.vpnWanted = false; HisnVpnService.stop(this); render() } else enableVpn()
        }
        statusRow("إزالة الموسيقى في كل التطبيقات", music, if (music) "إيقاف" else "تفعيل") {
            if (music) guarded { MusicGuardService.stop(this); p.musicGuardRunning = false; render() } else enableMusicGuard()
        }
        if (music && !a11y) note("لتُحذف الموسيقى ويبقى الكلام فعّل «حماية الشاشة»؛ بدونها يُكتم الصوت أثناء الموسيقى فقط.")
        else if (music && p.captureFollowsMute) note("هذا الجهاز لا يسمح بسماع صوت التطبيقات وهو مكتوم، فيُكتم الصوت أثناء الموسيقى فقط.")
        if (vpn) note("لحماية أقوى: إعدادات VPN ← فلتر حصن ← «شبكة VPN الدائمة» و«حظر الاتصالات بدون VPN».", action = "إعدادات VPN") {
            startActivity(Intent(Settings.ACTION_VPN_SETTINGS))
        }

        section("ما يُفلتر")
        toggle("تغطية الصور والفيديو", p.filterImages) { p.filterImages = it }
        toggle("إخفاء الألفاظ الفاحشة والقصص الإباحية", p.filterText) { p.filterText = it }
        toggle("تخطي المقاطع القصيرة المخالفة تلقائيًا", p.autoSkipShortVideos) { p.autoSkipShortVideos = it }
        toggle("تغطية المقطع القصير حتى يُفحص (أندرويد 14+)", p.preCoverShortVideos) { p.preCoverShortVideos = it }
        toggle("حجب المواقع الإباحية", p.blockAdultSites) { p.blockAdultSites = it }
        toggle("حجب مواقع القمار", p.blockGambling) { p.blockGambling = it }
        toggle("البحث الآمن (قوقل، بنج، DuckDuckGo)", p.safeSearch) { p.safeSearch = it }
        toggle("يوتيوب: الوضع المقيّد", p.youtubeRestricted) { p.youtubeRestricted = it }
        toggle("حماية العقيدة: إخفاء السحر والجن والرعب والهالوين", p.blockScaryTopics) { p.blockScaryTopics = it }
        toggle("إخفاء الشتائم (مثل «يا حمار»)", p.maskInsults) { p.maskInsults = it }
        toggle("حذف الموسيقى مع إبقاء الكلام", p.removeMusic) { p.removeMusic = it }
        toggle("كتم صوت المغني بعد حذف الموسيقى", p.muteSinger) { p.muteSinger = it }

        section("القفل")
        if (p.lockEnabled) {
            note(if (p.unlocked) "مفتوح الآن مؤقتًا." else "الإعدادات محمية برمز، وتعطيل الحماية أو حذف التطبيق يطلبه أيضًا.")
            button("تغيير الرمز") { guarded { askNewPin() } }
            button("إزالة القفل", primary = false) { guarded { p.setPin(null, null); render() } }
            if (p.unlocked) button("قفل الآن", primary = false) { p.relock(); render() }
        } else {
            note("ضع رمزًا (4 إلى 8 أرقام) حتى لا تُغيَّر الإعدادات أو تُعطَّل الحماية إلا به.")
            button("وضع رمز قفل") { askNewPin() }
        }
        button("إيقاف مؤقت 15 دقيقة", primary = false) { guarded { p.pauseFor(15); render() } }

        section("عن التطبيق")
        note("مجاني لوجه الله، مفتوح المصدر (AGPL-3.0)، مبني على HaramBlur ومطوَّر عنه. النماذج: NudeNet، وHuman، وYAMNet، وDeepFilterNet، وفصل الموسيقى من Ultimate Vocal Remover (UVR). لا خوادم، ولا حسابات، ولا إعلانات، ولا يُرسل شيء.")
    }

    /** الإعداد أول مرة: ثلاثة أسئلة فقط، ثم الشاشة الرئيسية ترشد لما بقي. */
    private fun renderSetup() {
        title("🛡️ فلتر حصن", 26f)
        note("حماية مجانية لوجه الله. كل الفحص على جهازك، ولا يُحفظ ولا يُرسل شيء.")
        when (setupStep) {
            0 -> {
                section("من يستخدم هذا الجهاز؟")
                button("رجل") { p.viewer = Viewer.MALE; setupStep = 1; render() }
                button("امرأة") { p.viewer = Viewer.FEMALE; setupStep = 1; render() }
                note("للرجل: تُغطّى النساء البالغات والعورات. للمرأة: تظهر النساء وتُغطّى العورات فقط.")
            }
            1 -> {
                section("مستوى الحماية")
                button("متوسط (الموصى به)") { p.level = Level.MEDIUM; setupStep = 2; render() }
                button("صارم", primary = false) { p.level = Level.STRICT; setupStep = 2; render() }
                button("مخفف", primary = false) { p.level = Level.LIGHT; setupStep = 2; render() }
                note("يمكن تغييره لاحقًا.")
            }
            else -> {
                section("رمز قفل؟")
                note("مع الرمز لا تُغيَّر الإعدادات ولا تُعطَّل الحماية إلا به (مفيد للأهل).")
                button("وضع رمز") { p.onboarded = true; askNewPin() }
                button("لاحقًا", primary = false) { p.onboarded = true; render() }
            }
        }
    }

    private fun card(head: String, body: String) {
        content.addView(TextView(this).apply {
            text = head; textSize = 20f; setTypeface(typeface, Typeface.BOLD)
            setPadding(0, Ui.dp(this@MainActivity, 16), 0, Ui.dp(this@MainActivity, 2))
        })
        note(body)
    }

    // ===================== الإجراءات =====================

    private fun accessibilityOn(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val me = ComponentName(this, HisnAccessibilityService::class.java).flattenToString()
        return enabled.split(':').any { it.equals(me, ignoreCase = true) }
    }

    private fun enableAccessibility() {
        if (!p.disclosureAccepted) startActivity(Intent(this, DisclosureActivity::class.java))
        else startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private fun enableMusicGuard() {
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.POST_NOTIFICATIONS), REQ_AUDIO_PERM)
            return
        }
        val mpm = getSystemService(android.media.projection.MediaProjectionManager::class.java)
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_MUSIC)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_AUDIO_PERM && grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED) enableMusicGuard()
    }

    private fun enableVpn() {
        val intent = VpnService.prepare(this)
        if (intent != null) startActivityForResult(intent, REQ_VPN) else onActivityResult(REQ_VPN, RESULT_OK, null)
    }

    @Deprecated("Activity API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_MUSIC && resultCode == RESULT_OK && data != null) {
            MusicGuardService.start(this, resultCode, data)
            render()
        }
        if (requestCode == REQ_VPN && resultCode == RESULT_OK) {
            p.vpnWanted = true
            HisnVpnService.start(this)
            render()
        }
    }

    private fun privateDnsHostname() =
        runCatching { Settings.Global.getString(contentResolver, "private_dns_mode") == "hostname" }.getOrDefault(false)

    /** ينفذ التعديل مباشرة بلا قفل، أو بعد إدخال الرمز. */
    private fun guarded(action: () -> Unit) {
        if (p.unlocked) { action(); render(); return }
        askPin("أدخل رمز القفل") { ok -> if (ok) { p.unlock(); action(); render() } }
    }

    private fun askPin(title: String, done: (Boolean) -> Unit) {
        val input = pinField()
        AlertDialog.Builder(this).setTitle(title).setView(input)
            .setPositiveButton("تأكيد") { _, _ ->
                val pin = input.text.toString()
                Thread {
                    val ok = Pin.verify(pin, p.pinHash, p.pinSalt)
                    runOnUiThread {
                        if (!ok) toastNote("رمز غير صحيح")
                        done(ok)
                    }
                }.start()
            }
            .setNegativeButton("إلغاء") { _, _ -> render() }.show()
    }

    private fun askNewPin() {
        val input = pinField()
        AlertDialog.Builder(this).setTitle("الرمز الجديد (4 إلى 8 أرقام)").setView(input)
            .setPositiveButton("حفظ") { _, _ ->
                val pin = input.text.toString()
                if (!Pin.VALID.matches(pin)) { toastNote("الرمز يجب أن يكون من 4 إلى 8 أرقام"); return@setPositiveButton }
                Thread {
                    val h = Pin.hash(pin)
                    runOnUiThread { p.setPin(h.hash, h.salt); p.relock(); render() }
                }.start()
            }
            .setNegativeButton("إلغاء") { _, _ -> render() }.show()
    }

    private fun pinField() = EditText(this).apply {
        inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        gravity = Gravity.CENTER
        textSize = 24f
    }

    private fun toastNote(msg: String) = android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()

    // ===================== عناصر الواجهة =====================

    private fun title(t: String, size: Float) = content.addView(TextView(this).apply {
        text = t; textSize = size; setTypeface(typeface, Typeface.BOLD); setTextColor(Ui.BRAND)
    })

    private fun section(t: String) = content.addView(TextView(this).apply {
        text = t; textSize = 18f; setTypeface(typeface, Typeface.BOLD)
        setPadding(0, Ui.dp(this@MainActivity, 22), 0, Ui.dp(this@MainActivity, 6))
    })

    private fun note(t: String, action: String? = null, onClick: (() -> Unit)? = null) {
        content.addView(TextView(this).apply { text = t; textSize = 14f; alpha = 0.8f; setPadding(0, 4, 0, 4) })
        if (action != null && onClick != null) button(action, primary = false, onClick = onClick)
    }

    private fun warn(t: String, action: String, onClick: () -> Unit) {
        content.addView(TextView(this).apply {
            text = "⚠️ $t"; textSize = 14f; setTextColor(Color.rgb(0xB4, 0x5A, 0x00)); setPadding(0, 8, 0, 4)
        })
        button(action, primary = false, onClick = onClick)
    }

    private fun button(t: String, primary: Boolean = true, onClick: () -> Unit) =
        content.addView(Ui.button(this, t, primary, onClick))

    private fun statusRow(label: String, on: Boolean, action: String, onClick: () -> Unit) {
        content.addView(TextView(this).apply {
            text = (if (on) "✅ " else "⭕ ") + label + (if (on) " — يعمل" else " — غير مفعّل")
            textSize = 15f; setPadding(0, 10, 0, 2)
        })
        if (!on || action == "إيقاف") button(action, primary = !on, onClick = onClick)
    }

    private fun toggle(label: String, value: Boolean, set: (Boolean) -> Unit) {
        content.addView(Switch(this).apply {
            text = label; textSize = 15f; isChecked = value
            setPadding(0, Ui.dp(this@MainActivity, 6), 0, Ui.dp(this@MainActivity, 6))
            setOnCheckedChangeListener { b, checked ->
                if (checked == value) return@setOnCheckedChangeListener
                b.isChecked = value // لا يتغير حتى يُتحقق من القفل
                guarded { set(checked) }
            }
        })
    }

    private fun <T> radio(options: List<Pair<String, T>>, current: T, choose: (T) -> Unit) {
        val group = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        for ((label, v) in options) {
            group.addView(RadioButton(this).apply {
                text = label; textSize = 15f; isChecked = v == current
                setOnClickListener { if (v != current) { isChecked = false; choose(v) } }
            })
        }
        content.addView(group)
    }

    companion object {
        private const val REQ_VPN = 7
        private const val REQ_MUSIC = 8
        private const val REQ_AUDIO_PERM = 9
    }
}
