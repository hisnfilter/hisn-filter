import FamilyControls
import SensitiveContentAnalysis
import SwiftUI

/// الإعدادات: من يستخدم الجهاز، والمستوى، والقفل، والخيارات المتقدمة، و«عن حصن».
struct SettingsView: View {
    @State private var authorized = ProtectionSetup.authorized
    @State private var safariHelp = false
    @State private var viewer = HisnSettings.viewer
    @State private var level = HisnSettings.level
    @State private var systemFilter = HisnSettings.systemFilter
    @State private var appsSelection = Shields.selection(Shields.appsKey)
    @State private var scanSelection = Shields.selection(Shields.scanKey)
    @State private var pickApps = false
    @State private var pickScan = false
    @State private var pinRequest: PinRequest?
    @State private var message: String?
    @State private var lockEnabled = HisnSettings.lockEnabled
    @State private var muteSinger = HisnSettings.muteSinger
    @State private var scary = HisnSettings.blockScaryTopics
    @State private var hideAds = HisnSettings.hideAds
    @State private var protectX = HisnSettings.protectX
    @State private var protectReddit = HisnSettings.protectReddit
    @State private var redditSubs = HisnSettings.redditAllowed.joined(separator: ", ")
    @State private var earMute = HisnSettings.muteMusicByEar
    @State private var hideSuggested = HisnSettings.hideSuggested
    private let scaPolicy = SCSensitivityAnalyzer().analysisPolicy

    var body: some View {
        Form {
            Section(tr("من يستخدم الجهاز؟", "Who uses this device?")) {
                Picker(tr("المستخدم", "User"), selection: Binding(get: { viewer }, set: { v in guarded { viewer = v; HisnSettings.viewer = v } })) {
                    ForEach(Viewer.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }

            Section(tr("مستوى الحماية", "Protection level")) {
                Picker(tr("المستوى", "Level"), selection: Binding(get: { level }, set: { v in guarded { level = v; HisnSettings.level = v } })) {
                    ForEach(Level.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                Text(levelHint(level)).font(.footnote).foregroundStyle(.secondary)
            }

            Section {
                Toggle(tr("حماية العقيدة", "Protect beliefs"), isOn: Binding(
                    get: { scary },
                    set: { v in
                        if v { scary = true; HisnSettings.blockScaryTopics = true }
                        else { guarded { scary = false; HisnSettings.blockScaryTopics = false } }
                    }))
            } footer: {
                Text(tr("تخفي مقاطع وصور السحر والجن والرعب والهالوين وألعاب الرعب في المنصات والبحث.",
                        "Hides magic, jinn, horror, Halloween and horror-game videos and images on platforms and in search."))
            }

            Section {
                Toggle(tr("كتم الموسيقى بالسماع", "Mute music by listening"), isOn: Binding(
                    get: { earMute },
                    set: { v in if v { earMute = true; HisnSettings.muteMusicByEar = true } else { guarded { earMute = false; HisnSettings.muteMusicByEar = false } } }))
            } header: {
                Text(tr("الصوت", "Audio"))
            } footer: {
                MoreFooter(tr("يُكتم المقطع إن سُمعت فيه موسيقى آلات. الإنشاد والتلاوة لا يُكتمان.", "Clips with instrumental music are muted. Nasheed and recitation aren't."),
                           tr("يسمع التطبيق أول ثوانٍ من كل مقطع على الجهاز نفسه. يظهر فوق المقطع المكتوم زر «ليست موسيقى؟» لإعادة الصوت. الدف يُحسب آلة.", "The app listens to the first seconds of each clip on-device. A muted clip shows a “not music?” button to bring the sound back. A daf counts as an instrument."))
            }

            Section {
                Toggle(tr("حماية إكس", "Protect X"), isOn: Binding(
                    get: { protectX },
                    set: { v in if v { protectX = true; HisnSettings.protectX = true } else { guarded { protectX = false; HisnSettings.protectX = false } } }))
                Toggle(tr("حماية ريديت", "Protect Reddit"), isOn: Binding(
                    get: { protectReddit },
                    set: { v in if v { protectReddit = true; HisnSettings.protectReddit = true } else { guarded { protectReddit = false; HisnSettings.protectReddit = false } } }))
                TextField(tr("مجتمعات ريديت المسموحة فقط (اختياري): cooking, programming", "Allowed subreddits only (optional): cooking, programming"), text: $redditSubs)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onSubmit {
                        let list = redditSubs.split(whereSeparator: { $0 == "," || $0 == "،" || $0 == " " }).map { $0.lowercased().replacingOccurrences(of: "r/", with: "") }.filter { !$0.isEmpty }
                        // التوسيع (إفراغ القائمة أو إضافة مجتمع) يطلب الرمز؛ التضييق لا
                        let widens = list.isEmpty && !HisnSettings.redditAllowed.isEmpty || Set(list).subtracting(HisnSettings.redditAllowed).count > 0 && !HisnSettings.redditAllowed.isEmpty
                        if widens { guarded { HisnSettings.redditAllowed = list } } else { HisnSettings.redditAllowed = list }
                    }
            } header: {
                Text(tr("إكس وريديت", "X and Reddit"))
            } footer: {
                MoreFooter(tr("يُخفى ما تَسِمه المنصة «حساسًا»، وتُحجب حسابات ومجتمعات البالغين.", "Content the platform marks sensitive is hidden; adult accounts and communities are blocked."),
                           tr("وتُطوى ردود الإغراء («شوف البايو» 🔞)، وتفتح إكس على «المتابَعين» بلا «لك» ولا «استكشف»، وريديت بلا «الشائع». لا يظهران في وضع الطفل.", "Bait replies are folded, X opens on Following without For You or Explore, Reddit without Popular. Not available in child mode."))
            }

            Section {
                Toggle(tr("إخفاء الإعلانات", "Hide ads"), isOn: Binding(
                    get: { hideAds },
                    set: { v in if v { hideAds = true; HisnSettings.hideAds = true } else { guarded { hideAds = false; HisnSettings.hideAds = false } } }))
                Toggle(tr("إخفاء منشورات الحسابات غير المتابَعة", "Hide posts from accounts you don't follow"), isOn: Binding(
                    get: { hideSuggested },
                    set: { v in if v { hideSuggested = true; HisnSettings.hideSuggested = true } else { guarded { hideSuggested = false; HisnSettings.hideSuggested = false } } }))
            } header: {
                Text(tr("الخلاصة", "Feed"))
            } footer: {
                Text(tr("المنشور المخفي يبقى مكانه مطويًّا، واللمس عليه يعرضه.", "A hidden post stays folded in place; tap it to show it."))
            }

            Section {
                if lockEnabled {
                    Button(tr("تغيير رمز القفل", "Change lock code")) { guarded { pinRequest = .create } }
                    Button(tr("إزالة القفل", "Remove lock"), role: .destructive) {
                        guarded { HisnSettings.pinHash = nil; HisnSettings.pinSalt = nil; lockEnabled = false }
                    }
                } else {
                    Button(tr("وضع رمز قفل", "Set a lock code")) { pinRequest = .create }
                }
            } header: {
                Text(tr("القفل", "Lock"))
            } footer: {
                Text(tr("مع القفل: تخفيف الحماية يطلب الرمز.", "With a lock, relaxing protection asks for the code."))
            }

            Section(tr("الحماية خارج حصن", "Protection outside Hisn")) {
                if authorized {
                    Label(tr("الحماية تعمل في الجوال كله", "Protection is on for the whole phone"), systemImage: "checkmark.seal.fill").foregroundStyle(Color.brand)
                } else if !ProtectionSetup.available {
                    NavigationLink { ScreenTimeGuideView() } label: {
                        Label(tr("قيود المحتوى في الآيفون (حجب المواقع والتطبيقات)", "iPhone content restrictions (sites & apps)"), systemImage: "shield.lefthalf.filled")
                    }
                } else {
                    Button { Task { if let e = await ProtectionSetup.authorize() { message = e }; authorized = ProtectionSetup.authorized } } label: {
                        Label(tr("فعّل الحماية (حجب المواقع في الجوال كله)", "Turn on protection (block sites phone-wide)"), systemImage: "shield.lefthalf.filled")
                    }
                }
                Button { HisnSettings.safariSetupSeen = true; ProtectionSetup.openSafariSettings { safariHelp = true } } label: {
                    Label(tr("الحماية في Safari", "Protection in Safari"), systemImage: "safari")
                }
            }

            if authorized {
                Section(tr("التطبيقات", "Apps")) {
                    Toggle(tr("حجب المواقع الإباحية في الجوال كله", "Block adult sites on the whole phone"), isOn: Binding(
                        get: { systemFilter },
                        set: { v in guarded { systemFilter = v; HisnSettings.systemFilter = v; Shields.applySystem(v) } }
                    ))
                    Button(tr("التطبيقات المقفلة", "Locked apps") + " (\(appsSelection.applicationTokens.count))") { guarded { pickApps = true } }
                    if !appsSelection.applicationTokens.isEmpty {
                        Button(tr("السماح بها 15 دقيقة", "Allow them for 15 minutes")) {
                            guarded {
                                do { try Shields.allowAppsTemporarily(); message = tr("سُمح بها 15 دقيقة، ثم تُقفل تلقائيًا.", "Allowed for 15 minutes, then locked again.") }
                                catch { message = tr("تعذّر السماح.", "Couldn't allow them.") }
                            }
                        }
                    }
                }
            }

            Section {
                DisclosureGroup(tr("متقدم", "Advanced")) {
                    Toggle(tr("كتم صوت المغني بعد حذف الموسيقى", "Mute the singer after removing music"),
                           isOn: Binding(get: { muteSinger }, set: { v in guarded { muteSinger = v; HisnSettings.muteSinger = v } }))
                    if authorized {
                        // فحص الشاشة: تجريبي، يعمل فقط أثناء «تسجيل الشاشة»
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(tr("فحص الشاشة (تجريبي)", "Screen check (beta)"))
                                Spacer()
                                BroadcastButton().frame(width: 44, height: 44)
                            }
                            Text(tr("يفحص ما يظهر على الشاشة في التطبيقات المختارة، ويغطيها إن ظهر شيء مخالف. اضغط الزر ثم «بدء البث».",
                                    "Checks what appears on screen in chosen apps and covers them if something unsuitable shows. Tap the button, then “Start Broadcast”."))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Button(tr("التطبيقات التي تُفحص", "Apps to check") + " (\(scanSelection.applicationTokens.count))") { guarded { pickScan = true } }
                        if scaPolicy == .disabled {
                            Text(tr("لكشف العري يحتاج «تحذير المحتوى الحساس»: الإعدادات ← الخصوصية والأمن.",
                                    "Nudity detection needs “Sensitive Content Warning”: Settings → Privacy & Security."))
                                .font(.footnote).foregroundStyle(.orange)
                        }
                    }
                }
            }

            Section {
                NavigationLink { ExceptionsView() } label: { Label(tr("الاستثناءات وطلبات المراجعة", "Exceptions & review requests"), systemImage: "checklist") }
                NavigationLink { SelfTestView() } label: { Label(tr("فحص الحماية", "Protection check"), systemImage: "stethoscope") }
                NavigationLink { HelpView() } label: { Label(tr("الأسئلة الشائعة والأمان والسياسات", "FAQ, security & policies"), systemImage: "questionmark.circle") }
            }
        }
        .onDisappear { BrowserSessions.shared.pushSettings() }
        .navigationTitle(tr("الإعدادات", "Settings"))
        .navigationBarTitleDisplayMode(.inline)
        .familyActivityPicker(isPresented: $pickApps, selection: $appsSelection)
        .familyActivityPicker(isPresented: $pickScan, selection: $scanSelection)
        .onChange(of: appsSelection) { _, s in Shields.save(s, Shields.appsKey); Shields.applyApps() }
        .onChange(of: scanSelection) { _, s in Shields.save(s, Shields.scanKey) }
        .sheet(isPresented: $safariHelp) { SafariHelpSheet() }
        .sheet(item: $pinRequest) { req in
            PinSheet(request: req) { ok in
                pinRequest = nil
                lockEnabled = HisnSettings.lockEnabled
                if ok, case let .verify(action) = req { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() } }
            }
        }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button(tr("حسنًا", "OK"), role: .cancel) {}
        }
    }

    private func guarded(_ action: @escaping () -> Void) {
        if HisnSettings.unlocked { action() } else { pinRequest = .verify(action) }
    }
}

/// عن حصن: الخصوصية، والحقوق، والرخص.
struct AboutView: View {
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    var body: some View {
        List {
            Section(tr("الخصوصية", "Privacy")) {
                Text(tr("كل الفحص على جهازك. لا خوادم، ولا حسابات، ولا إعلانات، ولا يُرسل شيء.", "Everything is checked on your device. No servers, no accounts, no ads, nothing is sent."))
                Text(tr("يُحفظ على الجهاز فقط: إعداداتك، وبصمة رمز القفل (لا الرمز نفسه).", "Stored on this device only: your settings and a hash of the lock code (not the code)."))
                Text(tr("الاتصالات الوحيدة: المواقع التي تفتحها أنت، وجلب أيقونات المواقع، وصور المواقع لفحصها على جهازك. ويُحفظ سجل تقني صغير بلا محتوى (أخطاء النماذج فقط) يُحذف بعد أسبوع.",
                        "The only connections: the sites you open, their icons, and their images fetched for on-device checking. A small technical log with no content (model errors only) is kept and deleted after a week."))
            }
            Section(tr("المصدر والحقوق", "Source & credits")) {
                Text(tr("مجاني لوجه الله، ومفتوح المصدر برخصة AGPL-3.0.", "Free for the sake of Allah, open source under AGPL-3.0."))
                Text(tr("مبني على HaramBlur لمحمد الجنزوري ومطوَّر عنه.", "Built on and developed from HaramBlur by Mohamed Alganzory."))
                Text(tr("فصل الموسيقى بنموذج Ultimate Vocal Remover (UVR) ومطوريه.", "Music separation uses the Ultimate Vocal Remover (UVR) model, credit to its developers."))
                Text(tr("كشف الصور: NudeNet ومكتبة Human.", "Image detection: NudeNet and the Human library."))
            }
            Section {
                Text(tr("الإصدار", "Version") + " " + version).foregroundStyle(.secondary)
            }
        }
        .navigationTitle(tr("عن حصن", "About Hisn"))
        .navigationBarTitleDisplayMode(.inline)
    }
}


/// تذييل قصير بجملة واحدة، والتفاصيل خلف «اعرف أكثر» (الشروح الطويلة لا تُقرأ)
struct MoreFooter: View {
    let short: String
    let more: String
    @State private var open = false
    init(_ short: String, _ more: String) { self.short = short; self.more = more }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(short)
            if open { Text(more) }
            else { Button(tr("اعرف أكثر", "Learn more")) { open = true }.font(.footnote) }
        }
    }
}
