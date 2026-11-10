import SwiftUI

/// شرح تفعيل «قيود المحتوى والخصوصية» في الآيفون نفسه — بديل مجاني حين لا تتوفر أدوات القفل داخل حصن
/// (نسخة المتجر قبل موافقة أبل على صلاحية Family Controls)، ومفيد دائمًا لجهاز الطفل.
struct ScreenTimeGuideView: View {
    private let steps: [(String, String, String)] = [
        ("person.2.fill", tr("اجعلي جهاز الطفل ضمن «المشاركة العائلية»", "Add the child's device to Family Sharing"),
         tr("الإعدادات ← اسمك ← العائلة. ومن هناك فعّلي «اطلب الشراء» ليصلك طلب قبل أي تحميل.", "Settings → your name → Family. Turn on “Ask to Buy” so you approve every download.")),
        ("hourglass", tr("افتحي «مدة استخدام الجهاز» للطفل", "Open Screen Time for the child"),
         tr("الإعدادات ← مدة استخدام الجهاز ← اختاري اسم الطفل (أو على جهازه مباشرة) ← «قيود المحتوى والخصوصية» وفعّليها.", "Settings → Screen Time → the child's name (or on their device) → Content & Privacy Restrictions, and turn it on.")),
        ("app.badge.checkmark", tr("حدّدي التطبيقات حسب العمر", "Limit apps by age"),
         tr("قيود المحتوى ← قيود متجر التطبيقات ← التطبيقات: اختاري عمر الطفل. فلا تُحمَّل إنستغرام وتيك توك ونحوها لمن هو دونها.", "Content Restrictions → App Store → Apps: choose the child's age. Instagram, TikTok and similar can't be installed below their age.")),
        ("safari", tr("احجبي المواقع الإباحية في الجوال كله", "Block adult sites phone-wide"),
         tr("قيود المحتوى ← محتوى الويب ← «تحديد مواقع البالغين».", "Content Restrictions → Web Content → “Limit Adult Websites”.")),
        ("gamecontroller.fill", tr("حدّدي وقت الألعاب", "Set game time limits"),
         tr("مدة استخدام الجهاز ← حدود التطبيقات ← أضيفي اللعبة (روبلوكس مثلًا) ووقتها اليومي.", "Screen Time → App Limits → add the game (e.g. Roblox) and its daily time.")),
        ("lock.fill", tr("ضعي رمزًا لمدة استخدام الجهاز", "Set a Screen Time passcode"),
         tr("رمز مختلف عن رمز فتح الجوال، حتى لا يغيّر الطفل القيود.", "Different from the phone passcode, so the child can't change the limits.")),
    ]

    var body: some View {
        List {
            Section {
                Text(tr("أدوات مجانية موجودة أصلًا في الآيفون، تكمل حصن: حصن يفلتر ما يُفتح فيه، وهذه تمنع تحميل التطبيقات غير المناسبة وتحجب المواقع الإباحية خارج حصن.",
                        "Free tools already in the iPhone that complete Hisn: Hisn filters what opens inside it; these stop unsuitable apps from being installed and block adult sites outside Hisn."))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: s.0).foregroundStyle(Color.brand).frame(width: 26)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(i + 1). \(s.1)").font(.subheadline.weight(.semibold))
                        Text(s.2).font(.footnote).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 4)
            }
            Section {
                Button(tr("افتحي الإعدادات", "Open Settings")) {
                    if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
                }
            } footer: {
                Text(tr("يفتح إعدادات حصن؛ ارجعي خطوة للخلف لتصلي إلى «مدة استخدام الجهاز».", "Opens Hisn's settings; go back one step to reach Screen Time."))
            }
        }
        .navigationTitle(tr("قيود المحتوى في الآيفون", "iPhone content restrictions"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
