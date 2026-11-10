import SwiftUI

@main
struct HisnFilterApp: App {
    @AppStorage("lang", store: AppGroup.defaults) private var lang = "ar"

    init() {
        #if DEBUG
        _ = DebugHarness.runIfRequested() // اختبار آلي على المحاكي فقط
        #endif
    }

    var body: some Scene {
        // اتجاه عناصر UIKit (القوائم) مع اللغة المختارة؛ بدونه تنعكس النصوص الإنجليزية في جوال عربي
        UIView.appearance().semanticContentAttribute = lang == "en" ? .forceLeftToRight : .forceRightToLeft
        return WindowGroup {
            RootView()
                // تغيير اللغة يعيد رسم الواجهة كلها باتجاهها
                .id(lang)
                .environment(\.layoutDirection, lang == "en" ? .leftToRight : .rightToLeft)
                .environment(\.locale, Locale(identifier: lang == "en" ? "en" : "ar"))
                .tint(Color.brand)
                // تنظيف أوقفه النظام (الجوال قُفل): يكمل من حيث وقف عند فتح التطبيق
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                    NativeMusicJob.shared.resumeIfNeeded()
                    NativeMusicJob.clearNotifications()
                }
        }
    }
}

extension Color {
    /// بنفسجي حصن (نفس هوية الإضافة)
    static let brand = Color(red: 0x6D / 255, green: 0x28 / 255, blue: 0xD9 / 255)
}

struct RootView: View {
    @State private var onboarded = HisnSettings.onboarded
    @State private var toured = HisnSettings.toured

    init() {
        // اختبار آلي (المحاكي): -hisnOnboarded يتخطى الإعداد الأول والجولة
        if ProcessInfo.processInfo.arguments.contains("-hisnOnboarded") {
            HisnSettings.onboarded = true; HisnSettings.toured = true; HisnSettings.safariSetupSeen = true
            _onboarded = State(initialValue: true); _toured = State(initialValue: true)
        }
    }

    var body: some View {
        if !onboarded {
            OnboardingView { onboarded = true }
        } else if !toured {
            // جولة قصيرة مرة واحدة بعد الإعداد الأول
            TourView { toured = true }
        } else {
            HomeView()
        }
    }
}

/// الإعداد الأول: من يستخدم الجهاز، ومستوى الحماية.
struct OnboardingView: View {
    var done: () -> Void
    @State private var viewer: Viewer = .male
    @State private var level: Level = .medium
    @State private var child = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(tr("حماية مجانية لوجه الله. كل الفحص على جهازك، ولا يُرسل عنك شيء لأحد.",
                            "Free protection for the sake of Allah. Everything is checked on your device; nothing about you is sent to anyone."))
                        .foregroundStyle(.secondary)
                }
                Section(tr("من يستخدم هذا الجهاز؟", "Who uses this device?")) {
                    Picker(tr("المستخدم", "User"), selection: $viewer) {
                        ForEach(Viewer.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Text(viewer == .male
                         ? tr("تُغطّى النساء البالغات والعورات. الطفلات والرجال يظهرون.", "Adult women and nudity are covered. Girls and men are shown.")
                         : tr("تظهر النساء، وتُغطّى العورات فقط.", "Women are shown; only nudity is covered."))
                        .font(.footnote).foregroundStyle(.secondary)
                    Toggle(tr("هذا جوال طفل", "This is a child's phone"), isOn: $child)
                }
                Section(tr("مستوى الحماية", "Protection level")) {
                    Picker(tr("المستوى", "Level"), selection: $level) {
                        ForEach(Level.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Text(levelHint(level)).font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Button(tr("ابدأ", "Start")) {
                        HisnSettings.viewer = viewer
                        HisnSettings.level = level
                        if child { HisnSettings.applyChildPreset(age: "9to12") }
                        HisnSettings.onboarded = true
                        done()
                    }
                    .frame(maxWidth: .infinity)
                    .bold()
                }
            }
            .navigationTitle(tr("فلتر حصن", "Hisn Filter"))
            .toolbar { ToolbarItem(placement: .topBarLeading) { LanguageButton() } }
        }
    }
}

func levelHint(_ l: Level) -> String {
    switch l {
    case .light: return tr("العورات والمواقع الإباحية فقط.", "Nudity and adult sites only.")
    case .medium: return tr("الموصى به: العورات، والنساء للرجل، والألفاظ، والمواقع، والموسيقى. المقطع يظهر بسرعة إذا كان غلافه سليمًا، ويستمر فحصه ويُغطّى فور ظهور مشهد مخالف (قد يمر جزء من الثانية).", "Recommended: nudity, women (for men), bad words, sites, and music. A clip shows quickly if its cover is clean; checking continues and covers it on the first bad frame (a split second may pass).")
    case .strict: return tr("الصورة أو المقطع كاملًا إذا فيه امرأة، وكشف عري أشد، والوجوه البعيدة تُحسب. كل مقطع يبقى مغبّشًا حتى تُفحص إطاراته (أبطأ قليلًا وأضمن).", "The whole image or clip if a woman is in it, stricter nudity checks, distant faces count. Every clip stays blurred until its frames are checked (a bit slower, safer).")
    }
}
