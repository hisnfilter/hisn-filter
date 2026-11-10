import FamilyControls
import ReplayKit
import SafariServices
import SwiftUI

/// الشاشة الرئيسية: الحالة، والتصفح المحمي، ووضع الطفل، وتنظيف الفيديو. الباقي في «الإعدادات».
struct HomeView: View {
    @State private var authorized = ProtectionSetup.authorized
    @State private var appsSelection = Shields.selection(Shields.appsKey)
    @State private var pickApps = false
    @State private var pinRequest: PinRequest?
    @State private var message: String?
    @State private var lockEnabled = HisnSettings.lockEnabled
    @State private var showClean = SharedVideo.pending
    @State private var childMode = HisnSettings.childMode
    @State private var viewer = HisnSettings.viewer
    @State private var childAge = HisnSettings.childAge
    @State private var childStrict = HisnSettings.level == .strict
    @State private var childSex = HisnSettings.childSex
    @State private var platform: Platform?
    @State private var addingSite = false
    @State private var allowedOnly = HisnSettings.allowedSitesOnly
    @State private var ytRegular = HisnSettings.youtubeChildRegular
    @State private var safariHelp = false
    @State private var gridVersion = 0
    @State private var clipboardHasLink = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if hSize == .regular { padLayout } else { phoneLayout }
        }
    }

    // ===== الآيفون: نموذج واحد يمرّ عموديًا =====
    private var phoneLayout: some View {
        NavigationStack {
            // المنصات أولًا (سبب فتح التطبيق)، ثم إعداد الحماية والأدوات تحتها
            Form {
                gridSection
                statusSection
                cleanSection
                childSection
            }
            .navigationTitle(tr("فلتر حصن", "Hisn Filter"))
            // الرجوع من الإعدادات: الأيقونة تعكس آخر اختيار
            .onAppear { viewer = HisnSettings.viewer; childMode = HisnSettings.childMode }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { LanguageButton() }
                ToolbarItem(placement: .topBarTrailing) { modeMenu }
                if childMode && ProtectionSetup.available {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink { GamesView() } label: {
                            Image(systemName: "gamecontroller").accessibilityLabel(tr("الألعاب", "Games"))
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { SettingsView() } label: {
                        Image(systemName: "gearshape").accessibilityLabel(tr("الإعدادات", "Settings"))
                    }
                }
            }
            .navigationDestination(item: $platform) { ProtectedBrowserView(platform: $0) }
            // آخر منصة فتحها المستخدم تُهيّأ مسبقًا في الخلفية حتى يكون فتحها فوريًا
            .task {
                // محرك الفحص يُحمَّل في الخلفية من لحظة التشغيل (لا عند أول صفحة)، ثم آخر منصة تُهيّأ مسبقًا
                NativeDetector.prepareInBackground()
                try? await Task.sleep(nanoseconds: 250_000_000)
                if let id = HisnSettings.lastPlatform, let p = Platform.visible.first(where: { $0.id == id }) { BrowserSessions.shared.warm(p) }
            }
            .onChange(of: platform) { _, p in if p == nil { BrowserSessions.shared.pushSettings() } }
            .debugOpen($platform)
            .navigationDestination(isPresented: $showClean) { CleanVideoView() }
            .familyActivityPicker(isPresented: $pickApps, selection: $appsSelection)
            .sheet(isPresented: $addingSite) { AddSiteSheet { gridVersion += 1 } }
            .sheet(isPresented: $safariHelp) { SafariHelpSheet() }
            // فيديو وصل من «مشاركة» في الصور: نفتح التنظيف مباشرة
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    if SharedVideo.pending { showClean = true }
                    openSharedLink()
                    checkClipboard()
                    authorized = ProtectionSetup.authorized
                    lockEnabled = HisnSettings.lockEnabled
                    viewer = HisnSettings.viewer
                    childMode = HisnSettings.childMode
                }
            }
            // «مشاركة» ← «فلتر حصن» أو فتح التطبيق من الرابط hisnfilter://open
            .onOpenURL { _ in openSharedLink() }
            .onAppear { openSharedLink(); checkClipboard() }
            // رابط منسوخ (واتساب مثلًا): زر واحد يفتحه بالحماية، بلا قراءة الحافظة إلا عند الضغط
            .safeAreaInset(edge: .bottom) {
                if clipboardHasLink {
                    Button {
                        if let s = UIPasteboard.general.string, let u = SharedLink.extract(s) { open(link: u) }
                        clipboardHasLink = false
                    } label: {
                        Label(tr("فتح الرابط المنسوخ بالحماية", "Open the copied link protected"), systemImage: "link")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent).padding(.horizontal, 16).padding(.bottom, 4)
                }
            }
            .onChange(of: appsSelection) { _, s in Shields.save(s, Shields.appsKey); Shields.applyApps() }
            .sheet(item: $pinRequest) { req in
                PinSheet(request: req) { ok in
                    pinRequest = nil
                    lockEnabled = HisnSettings.lockEnabled
                    // ننتظر إغلاق نافذة الرمز قبل فتح نافذة أخرى (مثل اختيار التطبيقات)
                    if ok, case let .verify(action) = req { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() } }
                }
            }
            .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button(tr("حسنًا", "OK"), role: .cancel) {}
            }
        }
    }


    // ===== الآيباد (عرض واسع): شريط جانبي ثابت وقائمة التطبيقات تملأ الصفحة =====
    @Environment(\.horizontalSizeClass) private var hSize
    private enum PadPane: Hashable { case apps, child, clean, games, settings, help }
    @State private var pane: PadPane? = .apps

    private var padLayout: some View {
        NavigationSplitView {
            List(selection: $pane) {
                Section {
                    Label(tr("قائمة التطبيقات", "Apps list"), systemImage: "square.grid.2x2.fill").tag(PadPane.apps)
                    Label(tr("وضع الطفل", "Child mode"), systemImage: "figure.and.child.holdinghands").tag(PadPane.child)
                    Label(tr("تنظيف فيديو", "Clean a video"), systemImage: "video.badge.checkmark").tag(PadPane.clean)
                    if childMode { Label(tr("الألعاب", "Games"), systemImage: "gamecontroller.fill").tag(PadPane.games) }
                    Label(tr("الإعدادات", "Settings"), systemImage: "gearshape").tag(PadPane.settings)
                    Label(tr("المساعدة", "Help"), systemImage: "questionmark.circle").tag(PadPane.help)
                }
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(tr("الوضعية الآن", "Current mode")).font(.footnote).foregroundStyle(.secondary)
                        Text(childMode ? tr("طفل", "Child") + " · " + (HisnSettings.under13 ? tr("أقل من 13", "Under 13") : tr("13 إلى 15", "13 to 15")) : (viewer == .female ? tr("امرأة", "Woman") : tr("رجل", "Man")))
                            .font(.headline)
                        if childMode {
                            Text(tr("قنوات مسموحة", "Allowed channels") + ": \(HisnSettings.allowedChannels.count) · " + tr("كلمات محجوبة", "Blocked words") + ": \(HisnSettings.blockedWords.count)")
                                .font(.footnote).foregroundStyle(.secondary)
                            let t = Activity.totals()
                            Text(tr("آخر 7 أيام: أُخفي \(t.hidden) · أُوقف \(t.stopped + t.blocked)", "Last 7 days: hidden \(t.hidden) · stopped \(t.stopped + t.blocked)"))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle(tr("فلتر حصن", "Hisn Filter"))
            .toolbar { ToolbarItem(placement: .topBarLeading) { LanguageButton() }; ToolbarItem(placement: .topBarTrailing) { modeMenu } }
        } detail: {
            NavigationStack {
                Group {
                    switch pane ?? .apps {
                    case .apps:
                        Form {
                            if (!authorized && ProtectionSetup.available) || !HisnSettings.safariSetupSeen { statusSection }
                            gridSection
                        }
                        .navigationTitle(tr("قائمة التطبيقات", "Apps list"))
                    case .child:
                        Form { childSection }.navigationTitle(tr("وضع الطفل", "Child mode"))
                    case .clean: CleanVideoView()
                    case .games: GamesView()
                    case .settings: SettingsView()
                    case .help: HelpView()
                    }
                }
            }
            .onAppear { viewer = HisnSettings.viewer; childMode = HisnSettings.childMode }
            // المتصفح المحمي على الآيباد يملأ الشاشة كلها (لا داخل عمود التفاصيل)
            .fullScreenCover(item: $platform) { p in NavigationStack { ProtectedBrowserView(platform: p) } }
            .onChange(of: platform) { _, p in if p == nil { BrowserSessions.shared.pushSettings() } }
            .debugOpen($platform)
            .familyActivityPicker(isPresented: $pickApps, selection: $appsSelection)
            .sheet(isPresented: $addingSite) { AddSiteSheet { gridVersion += 1 } }
            .sheet(isPresented: $safariHelp) { SafariHelpSheet() }
            .sheet(item: $pinRequest) { req in
                PinSheet(request: req) { ok in
                    pinRequest = nil
                    lockEnabled = HisnSettings.lockEnabled
                    if ok, case let .verify(action) = req { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() } }
                }
            }
            .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) { Button(tr("حسنًا", "OK"), role: .cancel) {} }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    if SharedVideo.pending { pane = .clean }
                    openSharedLink(); checkClipboard()
                    authorized = ProtectionSetup.authorized
                    lockEnabled = HisnSettings.lockEnabled; viewer = HisnSettings.viewer; childMode = HisnSettings.childMode
                }
            }
            .onOpenURL { _ in openSharedLink() }
        }
    }

    // ===== أقسام مشتركة بين التخطيطين =====
    @ViewBuilder private var statusSection: some View {
                // ===== الحالة: تظهر حتى يكتمل الإعداد (الحماية + سفاري)، ثم تنتقل إلى الإعدادات =====
                if (!authorized && ProtectionSetup.available) || !HisnSettings.safariSetupSeen {
                Section {
                    if authorized {
                        Label(tr("الحماية تعمل", "Protection is on"), systemImage: "checkmark.seal.fill")
                            .font(.headline).foregroundStyle(Color.brand)
                    } else if ProtectionSetup.available {
                        Button { Task { await authorize() } } label: {
                            Label(tr("فعّل الحماية", "Turn on protection"), systemImage: "shield.lefthalf.filled")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    } else {
                        NavigationLink { ScreenTimeGuideView() } label: {
                            Label(tr("احجبي المواقع الإباحية في الجوال كله", "Block adult sites phone-wide"), systemImage: "shield.lefthalf.filled")
                        }
                    }
                    Button { HisnSettings.safariSetupSeen = true; gridVersion += 1; openSafariSettings() } label: {
                        Label(tr("الحماية في Safari", "Protection in Safari"), systemImage: "safari")
                    }
                    if authorized || !ProtectionSetup.available {
                        Button(tr("إخفاء هذا القسم (يبقى في الإعدادات)", "Hide this section (stays in Settings)")) { HisnSettings.safariSetupSeen = true; gridVersion += 1 }
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } footer: {
                    Text(authorized
                         ? tr("المواقع الإباحية محجوبة في الجوال كله.", "Adult sites are blocked on the whole phone.")
                         : !ProtectionSetup.available ? tr("خطوة واحدة من إعدادات الآيفون نفسه، مجانية.", "One step in the iPhone's own settings, free.")
                         : tr("يحجب المواقع الإباحية في الجوال كله. يطلب الآيفون موافقتك مرة واحدة.", "Blocks adult sites on the whole phone. iPhone asks for your permission once."))
                }
                }

    }

    @ViewBuilder private var cleanSection: some View {
                // ===== تنظيف فيديو: بطاقة بارزة =====
                Section {
                    NavigationLink { CleanVideoView() } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "video.badge.checkmark")
                                .font(.title2).foregroundStyle(.white)
                                .frame(width: 52, height: 52)
                                .background(Color.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 14))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(tr("تنظيف فيديو", "Clean a video")).font(.headline).foregroundStyle(.white)
                                Text(tr("أزل الموسيقى أو نقِّ الفيديو كاملًا", "Remove music or fully clean a video"))
                                    .font(.footnote).foregroundStyle(.white.opacity(0.85))
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 6)
                    }
                    .listRowBackground(LinearGradient(colors: [Color.brand, Color.brand.opacity(0.8)], startPoint: .leading, endPoint: .trailing))
                    #if !HISN_NO_CLEANUP
                    // ليست في نسخة المتجر الأولى (تُضاف علنًا في تحديث لاحق بعد القبول)
                    NavigationLink { CleanupView() } label: {
                        Label(tr("تنظيف الحساب: إلغاء الإعجابات وإعادات النشر القديمة", "Account cleanup: remove old likes and reposts"), systemImage: "sparkles")
                    }
                    #endif
                }

    }

    @ViewBuilder private var gridSection: some View {
                // ===== التصفح المحمي =====
                Section {
                    // الحذف يضيّق القائمة فلا يحتاج رمزًا؛ الاستعادة توسّعها فتطلبه مع القفل
                    PlatformGrid(open: $platform, add: { guarded { addingSite = true } }, remove: { p in
                        let doRemove = {
                            if p.custom { HisnSettings.customSites.removeAll { $0["url"] == p.url.absoluteString } }
                            else { HisnSettings.hiddenPlatforms.append(p.id) }
                            gridVersion += 1
                        }
                        // في وضع الطفل القائمة هي ما سمح به ولي الأمر: تغييرها (حذفًا أو إضافة) يطلب الرمز
                        if HisnSettings.childMode { guarded(doRemove) } else { doRemove() }
                    }, restore: {
                        guarded { HisnSettings.hiddenPlatforms = []; gridVersion += 1 }
                    })
                    .id(gridVersion)
                } header: {
                    Text(tr("قائمة التطبيقات", "Apps list"))
                } footer: {
                    Text(tr("تفتح داخل حصن بكل الحماية. اضغط مطولًا على تطبيق فيظهر زر × لحذفه.", "Opens inside Hisn with full protection. Long-press an app to remove it from the list."))
                }

    }

    @ViewBuilder private var childSection: some View {
                // ===== وضع الطفل =====
                Section {
                    Toggle(tr("وضع الطفل", "Child mode"), isOn: Binding(get: { childMode }, set: { on in
                        if on {
                            // للرجل: وضع الطفل يُظهر النساء المحتشمات، فهو تخفيف يطلب الرمز
                            guardedIfRelaxing {
                                HisnSettings.applyChildPreset(age: childAge)
                                childMode = true
                                if authorized { Shields.applySystem(true) }
                                gridVersion += 1
                            }
                        } else {
                            guarded { HisnSettings.childMode = false; childMode = false; gridVersion += 1 }
                        }
                    }))
                    if childMode && !authorized {
                        NavigationLink { ScreenTimeGuideView() } label: {
                            Label(tr("خطوة مهمة: قيود المحتوى في الآيفون", "Important: iPhone content restrictions"), systemImage: "exclamationmark.shield")
                                .foregroundStyle(.orange)
                        }
                    }
                    if childMode {
                        Picker(tr("العمر", "Age"), selection: Binding(get: { childAge }, set: { age in
                            let apply = { HisnSettings.applyChildPreset(age: age); childAge = age; gridVersion += 1 }
                            // الأصغر أشد فلا يحتاج رمزًا
                            if age == "9to12" { apply() } else { guarded(apply) }
                        })) {
                            Text(tr("أقل من 13", "Under 13")).tag("9to12")
                            Text(tr("13 إلى 15", "13 to 15")).tag("13to15")
                        }
                        .pickerStyle(.segmented)
                        Text(childAge == "9to12"
                             ? tr("أشد تقييد. المنصات التي لا تسمح بأقل من 13 مخفية.", "Strictest. Platforms that don't allow under-13s are hidden.")
                             : tr("كل المنصات، مع الفلترة.", "All platforms, filtered."))
                            .font(.footnote).foregroundStyle(.secondary)
                        // نفس «مستوى الحماية» في الإعدادات: متوسط أو صارم
                        Picker(tr("المستوى", "Level"), selection: Binding(get: { childStrict }, set: { on in
                            let apply = { HisnSettings.level = on ? .strict : .medium; childStrict = on }
                            if on { apply() } else { guarded(apply) }
                        })) {
                            Text(Level.medium.title).tag(false)
                            Text(Level.strict.title).tag(true)
                        }
                        .pickerStyle(.segmented)
                        if childStrict {
                            Picker(tr("الطفل", "Child"), selection: Binding(get: { childSex }, set: { v in
                                let apply = { HisnSettings.childSex = v; childSex = v }
                                if v == "boy" { apply() } else { guarded(apply) }
                            })) {
                                Text(tr("ولد", "Boy")).tag("boy")
                                Text(tr("بنت", "Girl")).tag("girl")
                            }
                            .pickerStyle(.segmented)
                            Text(childSex == "boy"
                                 ? tr("تُغطّى صور النساء، ويظهر الرجال.", "Women are covered; men are shown.")
                                 : tr("تظهر النساء المحتشمات، وتُغطّى العورات.", "Modestly dressed women are shown; nudity is covered."))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if childAge == "9to12" {
                            Picker(tr("يوتيوب", "YouTube"), selection: Binding(get: { ytRegular }, set: { v in
                                let apply = { HisnSettings.youtubeChildRegular = v; ytRegular = v; gridVersion += 1 }
                                // العادي أوسع من كيدز: يطلب الرمز
                                if v { guarded(apply) } else { apply() }
                            })) {
                                Text(tr("يوتيوب كيدز", "YouTube Kids")).tag(false)
                                Text(tr("العادي بتقييد الصغار", "Regular, kid-restricted")).tag(true)
                            }
                            .pickerStyle(.segmented)
                            Text(ytRegular
                                 ? tr("يوتيوب العادي: تُحذف بطاقات الرعب والسحر والكرتون غير اللائق كاملةً من الرئيسية والبحث والمقترحات، ولا Shorts ولا تعليقات ولا تشغيل تلقائي، مع الوضع المقيّد. اقفل تطبيق يوتيوب الأصلي من «التطبيقات المقفلة».",
                                        "Regular YouTube: horror, magic and inappropriate-cartoon cards are removed entirely from Home, Search and suggestions; no Shorts, comments or autoplay; Restricted Mode on. Lock the native YouTube app under “Locked apps”.")
                                 : tr("يوتيوب كيدز: محتوى منتقى للأطفال من يوتيوب نفسه.", "YouTube Kids: content curated for children by YouTube itself."))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Toggle(tr("المواقع المسموحة فقط", "Allowed sites only"), isOn: Binding(get: { allowedOnly }, set: { on in
                            let apply = { HisnSettings.allowedSitesOnly = on; allowedOnly = on }
                            if on { apply() } else { guarded(apply) }
                        }))
                        Text(tr("لا يُفتح إلا ما في «قائمة التطبيقات» أعلاه؛ أي رابط آخر يُحجب. تعديل القائمة يطلب الرمز.",
                                "Only what is in the “Apps list” above opens; any other link is blocked. Editing the list asks for the code."))
                            .font(.footnote).foregroundStyle(.secondary)
                        NavigationLink { ActivityView() } label: {
                            let t = Activity.totals()
                            Label(tr("آخر 7 أيام: أُخفي \(t.hidden) · أُوقف \(t.stopped + t.blocked)", "Last 7 days: hidden \(t.hidden) · stopped \(t.stopped + t.blocked)"), systemImage: "chart.bar")
                        }
                        NavigationLink { ExceptionsView() } label: {
                            let n = ReviewRequests.count
                            Label(tr("الاستثناءات وطلبات المراجعة", "Exceptions & review requests") + (n > 0 ? tr(" · \(n) طلب جديد", " · \(n) new") : ""), systemImage: n > 0 ? "bell.badge" : "checklist")
                        }
                        NavigationLink { AllowedChannelsView() } label: {
                            Label(tr("القنوات المسموحة في يوتيوب", "Allowed YouTube channels") + " (\(HisnSettings.allowedChannels.count))", systemImage: "checkmark.rectangle.stack")
                        }
                        NavigationLink { BlockedWordsView() } label: {
                            Label(tr("كلمات محجوبة", "Blocked words") + " (\(HisnSettings.blockedWords.count))", systemImage: "text.badge.xmark")
                        }
                        NavigationLink { GamesView() } label: {
                            Label(ProtectionSetup.available ? tr("الألعاب: قفل ووقت وأمان", "Games: lock, time and safety") : tr("الألعاب: الأمان", "Games: safety"), systemImage: "gamecontroller.fill")
                        }
                        if authorized {
                            Button(tr("قفل التطبيقات الأصلية", "Lock the original apps") + " (\(appsSelection.applicationTokens.count))") { guarded { pickApps = true } }
                        }
                        if !lockEnabled {
                            Button(tr("ضع رمز قفل (موصى به)", "Set a lock code (recommended)")) { pinRequest = .create }
                        }
                    }
                } header: {
                    Text(tr("وضع الطفل", "Child mode"))
                } footer: {
                    Text(tr("مفتاح واحد يشغّل كل حمايات الطفل معًا: حماية العقيدة (السحر والجن والرعب والهالوين)، وإخفاء الشتائم، ويوتيوب المقيّد (ويوتيوب كيدز تحت ١٣)، والبحث الآمن. النساء المحتشمات يظهرن، والعورات تُغطّى.",
                            "One switch: hides magic, jinn, horror and Halloween; masks insults; restricted YouTube; safe search. Modestly dressed women are shown and nudity is covered."))
                }

    }

    /// زر واحد: موافقة «مدة استخدام الجهاز» ثم حجب المواقع الإباحية في الجوال كله.
    private func authorize() async {
        if let err = await ProtectionSetup.authorize() { message = err }
        authorized = ProtectionSetup.authorized
    }

    static func authMessage(_ error: Error) -> String {
        let text = error.localizedDescription.lowercased()
        if text.contains("one application") || text.contains("only one") {
            return tr("تطبيق آخر على هذا الجوال يستخدم أدوات «مدة استخدام الجهاز» (مثل تطبيق رقابة أبوية). Apple تسمح بتطبيق واحد فقط. أوقفيه أو احذفيه، ثم اضغطي «فعّل الحماية» مرة أخرى.",
                      "Another app on this phone is using Screen Time tools (like a parental-control app). Apple allows only one. Turn it off or delete it, then tap “Turn on protection” again.")
        }
        return tr("لم تتم الموافقة. حاولي مرة أخرى.", "Permission wasn't given. Please try again.")
    }

    /// يفتح مكان تفعيل إضافة Safari مباشرة إن سمح النظام، وإلا يعرض خطوتين قصيرتين.
    private func openSafariSettings() {
        ProtectionSetup.openSafariSettings { safariHelp = true }
    }

    /// أيقونة صغيرة أعلى الشاشة: من يستخدم الجهاز (رجل / امرأة / طفل) — التغيير بلمسة.
    private var modeMenu: some View {
        let icon = childMode ? "figure.and.child.holdinghands" : viewer == .female ? "figure.stand.dress" : "figure.stand"
        let title = childMode ? tr("طفل", "Child") : viewer.title
        return Menu {
            Picker(tr("المستخدم", "User"), selection: Binding(get: { childMode ? "child" : viewer.rawValue }, set: { pick in
                if pick == "child" {
                    guardedIfRelaxing {
                        HisnSettings.applyChildPreset(age: childAge)
                        childMode = true
                        if authorized { Shields.applySystem(true) }
                        gridVersion += 1
                    }
                } else if let v = Viewer(rawValue: pick) {
                    guarded {
                        HisnSettings.viewer = v; viewer = v
                        if childMode { HisnSettings.childMode = false; childMode = false }
                        gridVersion += 1
                    }
                }
            })) {
                Label(tr("رجل", "Man"), systemImage: "figure.stand").tag("male")
                Label(tr("امرأة", "Woman"), systemImage: "figure.stand.dress").tag("female")
                Label(tr("طفل", "Child"), systemImage: "figure.and.child.holdinghands").tag("child")
            }
        } label: {
            Label(title, systemImage: icon).labelStyle(.titleAndIcon).font(.subheadline)
        }
        .accessibilityLabel(tr("المستخدم: \(title)", "User: \(title)"))
    }

    /// ينفذ التعديل مباشرة بلا قفل، أو بعد إدخال الرمز (ثم يبقى مفتوحًا 5 دقائق).
    /// رابط وصل من امتداد المشاركة: يُفتح في المتصفح المحمي كموقع مخصص (نفس حماية المنصات).
    private func openSharedLink() {
        guard let u = SharedLink.pending else { return }
        SharedLink.pending = nil
        open(link: u)
    }

    private func open(link u: URL) {
        let host = (u.host ?? "").replacingOccurrences(of: "www.", with: "")
        // إن كان الرابط لمنصة معروفة نفتحه باسمها وأيقونتها
        let known = Platform.builtIn.first { p in u.host.map { h in h.hasSuffix(p.url.host ?? "-") || (p.url.host ?? "").hasSuffix(h.replacingOccurrences(of: "www.", with: "")) } ?? false }
        // وضع الطفل دون 13: لا تُفتح إلا منصات مسموحة له (الرابط الحر باب خلفي)
        if HisnSettings.under13 && (known?.teen ?? true) {
            message = tr("هذا الرابط غير متاح في وضع الطفل.", "This link isn't available in child mode.")
            return
        }
        platform = Platform(id: "link:" + u.absoluteString, ar: known?.ar ?? host, en: known?.en ?? host, url: u, icon: known?.icon ?? "globe", teen: known?.teen ?? true, custom: true)
    }

    /// لا نقرأ الحافظة (يظهر تنبيه النظام)، بل نسأل النظام إن كان فيها رابط فقط
    private func checkClipboard() {
        guard UIPasteboard.general.hasURLs || UIPasteboard.general.hasStrings else { clipboardHasLink = false; return }
        // detectPatterns لا يقرأ الحافظة (فلا يظهر تنبيه اللصق)، بل يقول هل فيها رابط فقط
        UIPasteboard.general.detectPatterns(for: [\.probableWebURL]) { (r: Result<Set<PartialKeyPath<UIPasteboard.DetectedValues>>, Error>) in
            let has = (try? r.get().contains(\.probableWebURL)) ?? false
            DispatchQueue.main.async { clipboardHasLink = has }
        }
    }

    /// وضع الطفل من حساب رجل يلغي تغطية النساء (المتوسط): يطلب الرمز؛ من حساب امرأة لا يخفف شيئًا.
    private func guardedIfRelaxing(_ action: @escaping () -> Void) {
        if HisnSettings.viewer == .male { guarded(action) } else { action() }
    }
    private func guarded(_ action: @escaping () -> Void) {
        if HisnSettings.unlocked { action() } else { pinRequest = .verify(action) }
    }
}

/// 🌐 العربية / English
struct LanguageButton: View {
    @AppStorage("lang", store: AppGroup.defaults) private var lang = "ar"
    var body: some View {
        Menu {
            Button("العربية") { lang = "ar" }
            Button("English") { lang = "en" }
        } label: {
            Label(lang == "en" ? "English" : "العربية", systemImage: "globe").labelStyle(.titleAndIcon).font(.subheadline)
        }
    }
}

/// إضافة موقع إلى «تصفح محمي».
/// موقع معروف يُقترح بالاسم (لا يلزم المستخدم أن يعرف الرابط)
struct KnownSite: Identifiable, Hashable {
    let id: String        // معرّف منصة مدمجة، أو النطاق لموقع إضافي
    let ar: String, en: String
    let url: String
    let aliases: [String]
    var builtIn: Bool { Platform.builtIn.contains { $0.id == id } }

    static func norm(_ s: String) -> String {
        s.lowercased().replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "ـ", with: "")
            .replacingOccurrences(of: "أ", with: "ا").replacingOccurrences(of: "إ", with: "ا").replacingOccurrences(of: "ة", with: "ه")
    }
    func matches(_ q: String) -> Bool {
        let n = Self.norm(q)
        guard n.count >= 2 else { return false }
        return ([ar, en, url] + aliases).contains { Self.norm($0).contains(n) }
    }

    /// المنصات المدمجة + مواقع شائعة مفيدة (لا خدمات البث المشفّرة ولا الموسيقى)
    static let catalog: [KnownSite] = {
        let extraAliases: [String: [String]] = [
            "tiktok": ["تيكتوك", "تك توك", "tik tok"], "x": ["تويتر", "twitter", "اكس"], "facebook": ["فيس بوك", "فيس", "fb"],
            "instagram": ["انستقرام", "انستا", "insta"], "snapchat": ["سناب", "snap"], "youtube": ["يوتوب"], "google": ["جوجل", "غوغل"],
            "reddit": ["ردت"], "pinterest": ["بنتريست"], "threads": ["ثريد"], "chatgpt": ["شات جي بي تي", "تشات"], "gemini": ["جميناي", "جيميني"],
        ]
        let builtIns = Platform.builtIn.filter { !["safari", "chrome", "firefox"].contains($0.id) && $0.ar != "يوتيوب كيدز" }.map {
            KnownSite(id: $0.id, ar: $0.ar, en: $0.en, url: $0.url.host ?? $0.url.absoluteString, aliases: extraAliases[$0.id] ?? [])
        }
        let extras: [KnownSite] = [
            .init(id: "linkedin.com", ar: "لينكدإن", en: "LinkedIn", url: "linkedin.com", aliases: ["لينكد ان", "لنكدان"]),
            .init(id: "web.whatsapp.com", ar: "واتساب ويب", en: "WhatsApp Web", url: "web.whatsapp.com", aliases: ["واتس", "whatsapp"]),
            .init(id: "web.telegram.org", ar: "تيليجرام", en: "Telegram", url: "web.telegram.org", aliases: ["تلقرام", "تلجرام"]),
            .init(id: "wikipedia.org", ar: "ويكيبيديا", en: "Wikipedia", url: "ar.wikipedia.org", aliases: ["ويكي"]),
            .init(id: "amazon.sa", ar: "أمازون", en: "Amazon", url: "amazon.sa", aliases: ["امزون"]),
            .init(id: "noon.com", ar: "نون", en: "Noon", url: "noon.com", aliases: []),
            .init(id: "maps.google.com", ar: "خرائط قوقل", en: "Google Maps", url: "maps.google.com", aliases: ["خرائط", "maps"]),
            .init(id: "khanacademy.org", ar: "أكاديمية خان", en: "Khan Academy", url: "khanacademy.org", aliases: ["خان"]),
            .init(id: "duolingo.com", ar: "دولينجو", en: "Duolingo", url: "duolingo.com", aliases: ["دولينقو"]),
            .init(id: "coursera.org", ar: "كورسيرا", en: "Coursera", url: "coursera.org", aliases: []),
            .init(id: "udemy.com", ar: "يوديمي", en: "Udemy", url: "udemy.com", aliases: []),
            .init(id: "canva.com", ar: "كانفا", en: "Canva", url: "canva.com", aliases: []),
            .init(id: "quora.com", ar: "كورا", en: "Quora", url: "quora.com", aliases: []),
            .init(id: "medium.com", ar: "ميديوم", en: "Medium", url: "medium.com", aliases: []),
            .init(id: "vimeo.com", ar: "فيميو", en: "Vimeo", url: "vimeo.com", aliases: []),
            .init(id: "twitch.tv", ar: "تويتش", en: "Twitch", url: "twitch.tv", aliases: []),
            .init(id: "discord.com", ar: "ديسكورد", en: "Discord", url: "discord.com/app", aliases: ["دسكورد"]),
            .init(id: "news.google.com", ar: "أخبار قوقل", en: "Google News", url: "news.google.com", aliases: ["اخبار"]),
        ]
        return builtIns + extras
    }()
}

struct AddSiteSheet: View {
    var added: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var streamingRefused = false
    @State private var name = ""
    @State private var address = ""
    @State private var showAddress = false

    private var suggestions: [KnownSite] {
        let q = name.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return [] }
        let visible = Set(Platform.visible.map(\.id))
        // أقل من 13: منصات المراهقين لا تُقترح (ولا تُعرض لو أُضيفت)
        let teen = Set(Platform.builtIn.filter(\.teen).map(\.id))
        return KnownSite.catalog.filter { $0.matches(q) && !visible.contains($0.id) && !(HisnSettings.under13 && teen.contains($0.id)) }.prefix(5).map { $0 }
    }
    /// الاسم وحده يكفي: إن كتبت شيئًا مثل «tiktok» أو رابطًا نستعمله، وإلا نقترح الاسم.com
    private var guessedURL: URL? {
        if !address.trimmingCharacters(in: .whitespaces).isEmpty { return Platform.url(from: address) }
        let q = name.trimmingCharacters(in: .whitespaces).lowercased()
        if q.contains(".") { return Platform.url(from: q) }
        let slug = q.replacingOccurrences(of: " ", with: "")
        guard !slug.isEmpty, slug.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else { return nil }
        return Platform.url(from: slug + ".com")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(tr("اسم التطبيق أو الموقع (مثل: تيك توك)", "App or site name (e.g. TikTok)"), text: $name)
                        .autocorrectionDisabled()
                } footer: {
                    Text(tr("اكتبي الاسم فقط واختاري من القائمة — لا يلزم معرفة الرابط.", "Just type the name and pick it — no need to know the address."))
                }
                if !suggestions.isEmpty {
                    Section(tr("اختاري", "Pick one")) {
                        ForEach(suggestions) { s in
                            Button { add(s) } label: {
                                HStack {
                                    Image(systemName: "plus.circle.fill").foregroundStyle(Color.brand)
                                    Text(tr(s.ar, s.en)).foregroundStyle(.primary)
                                    Spacer()
                                    Text(s.url).font(.caption).foregroundStyle(.secondary).environment(\.layoutDirection, .leftToRight)
                                }
                            }
                        }
                    }
                } else if name.trimmingCharacters(in: .whitespaces).count >= 2 {
                    Section {
                        if showAddress || guessedURL == nil {
                            TextField(tr("الرابط (مثل example.com)", "Address (like example.com)"), text: $address)
                                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .environment(\.layoutDirection, .leftToRight)
                        } else if let u = guessedURL {
                            HStack {
                                Text(tr("سيُفتح:", "Will open:")).foregroundStyle(.secondary)
                                Text(u.host ?? u.absoluteString).environment(\.layoutDirection, .leftToRight)
                                Spacer()
                                Button(tr("تعديل", "Edit")) { address = u.host ?? ""; showAddress = true }.font(.footnote)
                            }
                        }
                    } footer: {
                        Text(tr("يُفتح بالحماية نفسها، والمواقع الإباحية محجوبة دائمًا.", "Opens with the same protection. Adult sites stay blocked."))
                    }
                }
            }
            .alert(tr("لا يُفتح من حصن", "Doesn't open from Hisn"), isPresented: $streamingRefused) { Button(tr("حسنًا", "OK"), role: .cancel) {} } message: {
                Text(tr("خدمة بث مشفّرة (نتفلكس وأخواتها): الجهاز يمنع قراءة الفيديو فلا يستطيع حصن فحصه.",
                        "Encrypted streaming service: the device prevents reading its video, so Hisn cannot check it."))
            }
            .navigationTitle(tr("أضف موقعًا", "Add a site"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(tr("إلغاء", "Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(tr("أضف", "Add")) {
                        if let s = suggestions.first, KnownSite.norm(s.ar) == KnownSite.norm(name) || KnownSite.norm(s.en) == KnownSite.norm(name) { add(s); return }
                        guard let url = guessedURL else { return }
                        addCustom(name: name, url: url)
                    }
                    .disabled(guessedURL == nil && suggestions.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func add(_ s: KnownSite) {
        if s.builtIn {
            // منصة مدمجة (تيك توك…): تُعرض بجلستها وإعداداتها الخاصة بدل موقع عام
            HisnSettings.hiddenPlatforms.removeAll { $0 == s.id }
            if !HisnSettings.addedPlatforms.contains(s.id) { HisnSettings.addedPlatforms.append(s.id) }
            added(); dismiss()
        } else if let url = Platform.url(from: s.url) {
            addCustom(name: tr(s.ar, s.en), url: url)
        }
    }
    private func addCustom(name: String, url: URL) {
        // خدمات البث المشفّرة لا تُفتح من حصن أصلًا: لا نضيفها
        if let h = url.host?.lowercased(), Blocklist.shared.isStreaming(h) { streamingRefused = true; return }
        let title = name.trimmingCharacters(in: .whitespaces).isEmpty ? (url.host ?? "") : name
        HisnSettings.customSites.append(["name": title, "url": url.absoluteString])
        added(); dismiss()
    }
}

/// عند تعذّر فتح الإعداد مباشرة: خطوتان فقط.
struct SafariHelpSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(tr("١. الإعدادات ← التطبيقات ← Safari ← الإضافات ← فلتر حصن: شغّليه.", "1. Settings → Apps → Safari → Extensions → Hisn Filter: turn it on."))
                    Text(tr("٢. «جميع مواقع الويب» ← «السماح».", "2. “All Websites” → “Allow”."))
                } footer: {
                    Text(tr("مرة واحدة فقط. بعدها تُحمى المواقع في Safari كما في حصن.", "Only once. After that, sites in Safari are protected like in Hisn."))
                }
                Section {
                    Button(tr("افتح الإعدادات", "Open Settings")) {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                }
            }
            .navigationTitle(tr("الحماية في Safari", "Protection in Safari"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(tr("تم", "Done")) { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}

/// زر النظام لبدء بث الشاشة إلى امتداد الفحص.
struct BroadcastButton: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let v = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        v.preferredExtension = (Bundle.main.bundleIdentifier ?? "") + ".Broadcast"
        v.showsMicrophoneButton = false
        return v
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}

extension View {
    /// تجربة آلية من الماك: -hisnViewer male|female -hisnOpen <منصة>
    func debugOpen(_ platform: Binding<Platform?>) -> some View {
        #if DEBUG
        return task { await DebugOpen.run(platform) }
        #else
        return self
        #endif
    }
}

#if DEBUG
enum DebugOpen {
    static var ran = false
    @MainActor
    static func run(_ platform: Binding<Platform?>) async {
        // مرة واحدة عند التشغيل فقط، وإلا أعاد فتح المنصة كلما رجع المستخدم للواجهة
        if ran { return }
        ran = true
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-hisnViewer"), i + 1 < args.count, let v = Viewer(rawValue: args[i + 1]) { HisnSettings.viewer = v }
        // وضع الطفل: -hisnChild off | 9to12 | 13to15
        if let i = args.firstIndex(of: "-hisnChild"), i + 1 < args.count {
            if args[i + 1] == "off" { HisnSettings.childMode = false } else { HisnSettings.applyChildPreset(age: args[i + 1]) }
        } else if args.contains("-hisnViewer") {
            HisnSettings.childMode = false // تشغيل بلا -hisnChild: لا يرث وضع الطفل من تشغيل سابق
        }
        if let i = args.firstIndex(of: "-hisnLang"), i + 1 < args.count { AppGroup.defaults.set(args[i + 1], forKey: "lang") }
        // كلمات محجوبة للاختبار: -hisnWords "كلمة,كلمة" (فارغة = مسح)
        if let i = args.firstIndex(of: "-hisnWords"), i + 1 < args.count {
            HisnSettings.blockedWords = args[i + 1].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
        // قنوات مسموحة للاختبار: -hisnChannels "name|handle,name|handle" (فارغة = مسح)
        if let i = args.firstIndex(of: "-hisnChannels"), i + 1 < args.count {
            HisnSettings.allowedChannels = args[i + 1].split(separator: ",").compactMap { part in
                let kv = part.split(separator: "|", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                return kv.isEmpty || kv[0].isEmpty ? nil : ["name": kv[0], "handle": kv.count > 1 ? kv[1] : ""]
            }
        }
        // أداة تنظيف الحساب للاختبار: -hisnCleanup "likes|dry" أو "reposts|dry|username" (dry = تحديد بلا إلغاء)
        if let i = args.firstIndex(of: "-hisnCleanup"), i + 1 < args.count {
            // الصيغة: kind|dry|batch|username|platform
            let p = args[i + 1].split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            CleanupState.shared.start(.init(platform: p.count > 4 && !p[4].isEmpty ? p[4] : "instagram", kind: p.first ?? "likes", batch: p.count > 2 ? Int(p[2]) ?? 20 : 20, username: p.count > 3 && !p[3].isEmpty ? p[3] : HisnSettings.igUsername, dryRun: p.count > 1 && p[1] == "dry"))
        }
        // مفاتيح منطقية عامة: -hisnSet key=on|off (للاختبار: youtubeChildRegular، allowedSitesOnly، hisnOff…)
        AppGroup.defaults.set(false, forKey: "hisnOff")
        for (i, a) in args.enumerated() where a == "-hisnSet" && i + 1 < args.count {
            let kv = args[i + 1].split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { AppGroup.defaults.set(kv[1] == "on", forKey: kv[0]) }
        }
        // لقطات لشاشات التطبيق نفسها (بلا متصفح): تُحفظ PNG في Documents/shots ثم تُسحب للماك
        if let i = args.firstIndex(of: "-hisnShots"), i + 1 < args.count { await DebugShots.run(tag: args[i + 1]) }
        // لقطات الشاشة الحقيقية (مع المتصفح) بعد ثوانٍ محددة: -hisnSnap "8,14,20"
        if let i = args.firstIndex(of: "-hisnSnap"), i + 1 < args.count {
            let times = args[i + 1].split(separator: ",").compactMap { Double($0) }
            Task.detached { @MainActor in
                let dir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents/shots", isDirectory: true)
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                var last = 0.0
                for t in times {
                    try? await Task.sleep(nanoseconds: UInt64((t - last) * 1_000_000_000)); last = t
                    guard let w = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { continue }
                    let fmt = UIGraphicsImageRendererFormat(); fmt.scale = w.screen.scale
                    let img = UIGraphicsImageRenderer(bounds: w.bounds, format: fmt).image { _ in w.drawHierarchy(in: w.bounds, afterScreenUpdates: true) }
                    if let png = img.pngData() { try? png.write(to: dir.appendingPathComponent("snap-\(Int(t)).png")); HisnLog.write("snap: \(Int(t)) \(png.count)B") }
                }
            }
        }
        HisnLog.write("harness settings scary=\(HisnSettings.blockScaryTopics) child=\(HisnSettings.childMode) level=\(HisnSettings.level.rawValue)")
        guard let i = args.firstIndex(of: "-hisnOpen"), i + 1 < args.count else { return }
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        let id = args[i + 1]
        let p = id.hasPrefix("http") ? URL(string: id).map { Platform(id: "c:test", ar: "تجربة", en: "Test", url: $0, icon: "globe", teen: false, custom: true) }
            : Platform.visible.first { $0.id == id } ?? Platform.builtIn.first { $0.id == id }
        platform.wrappedValue = p
        HisnLog.write("harness open \(args[i + 1]) viewer=\(HisnSettings.viewer.rawValue) found=\(p != nil)")
        // -hisnReopen: بعد 20 ثانية يرجع للرئيسية ثم يعيد فتح المنصة نفسها (اختبار الجلسات الحيّة وزمن الفتح الثاني)
        if args.contains("-hisnReopen"), let p {
            // مهمة مستقلة: مهمة العرض تُلغى عند تغيّر الشاشة فلا يصح الانتظار فيها
            Task.detached { @MainActor in
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                platform.wrappedValue = nil
                HisnLog.write("harness closed \(p.id)")
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                let t0 = CFAbsoluteTimeGetCurrent()
                platform.wrappedValue = p
                HisnLog.write("harness reopened \(p.id) in \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))ms")
            }
        }
    }
}
#endif

#if DEBUG
/// يرسم شاشات التطبيق (الرئيسية والإعدادات والألعاب وروبلوكس) إلى صور للمراجعة من الماك.
enum DebugShots {
    @MainActor
    static func run(tag: String) async {
        let dir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents/shots", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let lang = AppGroup.defaults.string(forKey: "lang") ?? "ar"
        // ImageRenderer لا يرسم القوائم (Form/NavigationStack)، فنعرض الشاشة في نافذة حقيقية ثم نلتقطها
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { HisnLog.write("shots: no scene"); return }
        func shot(_ name: String, _ view: some View) async {
            let host = UIHostingController(rootView: AnyView(view
                .environment(\.layoutDirection, lang == "en" ? .leftToRight : .rightToLeft)
                .environment(\.locale, Locale(identifier: lang == "en" ? "en" : "ar"))
                .tint(Color.brand)))
            let w = UIWindow(windowScene: scene)
            w.frame = scene.screen.bounds
            w.rootViewController = host
            w.windowLevel = .alert + 1
            w.makeKeyAndVisible()
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            let img = UIGraphicsImageRenderer(bounds: w.bounds).image { _ in w.drawHierarchy(in: w.bounds, afterScreenUpdates: true) }
            w.isHidden = true
            if let png = img.pngData() {
                try? png.write(to: dir.appendingPathComponent("\(tag)-\(name).png"))
                HisnLog.write("shots: \(tag)-\(name) \(png.count)B")
            }
        }
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        await shot("home", HomeView())
        await shot("tour", TourView { })
        await shot("platforms", ScrollView { PlatformGrid(open: .constant(nil), add: {}, remove: { _ in }).padding() })
        await shot("settings", NavigationStack { SettingsView() })
        await shot("games", NavigationStack { GamesView() })
        await shot("exceptions", NavigationStack { ExceptionsView() })
        await shot("screentime", NavigationStack { ScreenTimeGuideView() })
        await shot("status", ProtectionStatusView(web: nil, host: "youtube.com"))
        if let roblox = GameEntry.catalog.first(where: { $0.id == "roblox" }) {
            await shot("roblox", NavigationStack { GameDetailView(game: roblox, changed: {}, onRemove: {}) })
        }
        HisnLog.write("shots: done \(tag)")
    }
}
#endif


/// إعداد الحماية خارج حصن (مشترك بين الجولة والرئيسية والإعدادات): صلاحية «مدة استخدام الجهاز» وإضافة سفاري.
enum ProtectionSetup {
    /// أدوات «مدة استخدام الجهاز» (قفل التطبيقات، الألعاب، فحص الشاشة، فلتر أبل للمواقع) متاحة في هذه النسخة؟
    /// نسخة المتجر قبل موافقة أبل على صلاحية Family Controls تُبنى بـ HISN_NO_FC فتُخفى كلها ويظهر شرح البديل المجاني.
    #if HISN_NO_FC
    static let available = false
    #else
    static let available = true
    #endif
    static var authorized: Bool { available && AuthorizationCenter.shared.authorizationStatus == .approved }

    /// يطلب الصلاحية ويفعّل حجب المواقع في الجوال كله. يُرجع رسالة خطأ إن فشل.
    static func authorize() async -> String? {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            if authorized {
                HisnSettings.systemFilter = true
                Shields.applySystem(true)
            }
            return nil
        } catch {
            return HomeView.authMessage(error)
        }
    }

    /// يفتح مكان تفعيل إضافة Safari مباشرة إن سمح النظام، وإلا يستدعي fallback (خطوتان قصيرتان).
    static func openSafariSettings(fallback: @escaping () -> Void) {
        let id = (Bundle.main.bundleIdentifier ?? "") + ".SafariExtension"
        #if compiler(>=6.2)
        if #available(iOS 26.2, *) {
            Task {
                do { try await SFSafariSettings.openExtensionsSettings(forIdentifiers: [id]) }
                catch { fallback() }
            }
            return
        }
        #endif
        _ = id
        fallback()
    }
}


/// كلمات محجوبة: يضيفها ولي الأمر (كلمة أو عبارة، عربي أو إنجليزي). أي بطاقة مقطع عنوانها فيها واحدة منها تُحذف كاملة
/// من الرئيسية والبحث والمقترحات في يوتيوب وتيك توك وألعاب روبلوكس، والمقطع المفتوح يُوقَف. الإضافة حرة، والحذف يطلب الرمز.
struct BlockedWordsView: View {
    @State private var words = HisnSettings.blockedWords
    @State private var text = ""
    @State private var pinRequest: PinRequest?

    var body: some View {
        List {
            Section {
                HStack {
                    TextField(tr("كلمة أو عبارة، مثل: مرعب، gacha، لعبة الحبار", "Word or phrase, e.g. scary, gacha, squid game"), text: $text)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onSubmit(add)
                    Button(tr("إضافة", "Add"), action: add).disabled(text.trimmingCharacters(in: .whitespaces).count < 2)
                }
            } footer: {
                Text(tr("الكلمة العربية تُطابق كل اشتقاقاتها (مرعب ← مرعبة، المرعبين)، والعبارة تُطابق كما هي، والإنجليزية ككلمة كاملة. تعمل فورًا في المتصفح المحمي، في كل الأوضاع.",
                        "An Arabic word matches its derived forms; a phrase matches as written; English matches as a whole word. Works immediately in the protected browser, in every mode."))
            }
            Section(tr("القائمة", "List")) {
                if words.isEmpty { Text(tr("لا كلمات بعد.", "No words yet.")).foregroundStyle(.secondary) }
                ForEach(words, id: \.self) { w in Text(w) }
                    .onDelete { idx in
                        // الحذف تخفيف: يطلب الرمز مع القفل
                        let remove = { words.remove(atOffsets: idx); save() }
                        if HisnSettings.unlocked { remove() } else { pinRequest = .verify(remove) }
                    }
            }
        }
        .navigationTitle(tr("كلمات محجوبة", "Blocked words"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { EditButton() }
        .sheet(item: $pinRequest) { req in
            PinSheet(request: req) { ok in
                pinRequest = nil
                if ok, case let .verify(action) = req { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() } }
            }
        }
    }

    private func add() {
        let w = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard w.count >= 2, w.count <= 60, !words.contains(w) else { return }
        words.append(w); text = ""; save()
    }
    private func save() {
        HisnSettings.blockedWords = words
        BrowserSessions.shared.pushSettings()
    }
}


/// القنوات المسموحة في يوتيوب (وضع الطفل): قائمة بيضاء. مع تفعيل «القنوات المسموحة فقط» لا يظهر في الرئيسية والبحث
/// والمقترحات إلا مقاطع هذه القنوات، والمقطع من قناة أخرى يُوقَف. الإضافة توسّع فتطلب الرمز، والحذف يضيّق فلا يطلبه.
struct AllowedChannelsView: View {
    @State private var channels = HisnSettings.allowedChannels
    @State private var only = HisnSettings.allowedChannelsOnly
    @State private var text = ""
    @State private var pinRequest: PinRequest?

    var body: some View {
        List {
            Section {
                Toggle(tr("القنوات المسموحة فقط", "Allowed channels only"), isOn: Binding(get: { only }, set: { v in
                    let apply = { only = v; HisnSettings.allowedChannelsOnly = v; BrowserSessions.shared.pushSettings() }
                    if v { apply() } else { guarded(apply) }
                }))
            } footer: {
                Text(channels.isEmpty
                     ? tr("أضيفي قناة واحدة على الأقل ليعمل الخيار. بدون القائمة يعمل الفلتر العام وحده.", "Add at least one channel for this to take effect. Without the list, only the general filter runs.")
                     : tr("لا يظهر في يوتيوب داخل حصن إلا مقاطع هذه القنوات؛ أي مقطع آخر يختفي، ولو فُتح برابط يتوقف مع رسالة للطفل وزر لك للسماح بالقناة بالرمز.",
                          "Only these channels' videos appear on YouTube inside Hisn; anything else disappears, and a direct link stops with a message for the child and a button for you to allow the channel with the code."))
            }
            Section {
                HStack {
                    TextField(tr("اسم القناة أو @المعرّف أو رابطها", "Channel name, @handle or link"), text: $text)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onSubmit { guarded(add) }
                    Button(tr("إضافة", "Add")) { guarded(add) }.disabled(text.trimmingCharacters(in: .whitespaces).count < 2)
                }
            } footer: {
                Text(tr("الأدق: @المعرّف من رابط القناة (مثل @spacetoon). الاسم وحده يكفي غالبًا. وأسرع طريق: افتحي أي مقطع من القناة داخل حصن واضغطي «السماح بهذه القناة».",
                        "Most precise: the @handle from the channel link (e.g. @spacetoon). The name alone usually works. Fastest: open any video of the channel inside Hisn and tap “Allow this channel”."))
            }
            Section(tr("القائمة", "List") + " (\(channels.count))") {
                if channels.isEmpty { Text(tr("لا قنوات بعد.", "No channels yet.")).foregroundStyle(.secondary) }
                ForEach(Array(channels.enumerated()), id: \.offset) { _, c in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c["name"] ?? "")
                        if let h = c["handle"], !h.isEmpty { Text("@" + h).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                .onDelete { idx in channels.remove(atOffsets: idx); save() }
            }
        }
        .navigationTitle(tr("القنوات المسموحة", "Allowed channels"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { EditButton() }
        .onAppear { channels = HisnSettings.allowedChannels; only = HisnSettings.allowedChannelsOnly }
        .sheet(item: $pinRequest) { req in
            PinSheet(request: req) { ok in
                pinRequest = nil
                if ok, case let .verify(action) = req { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() } }
            }
        }
    }

    private func guarded(_ action: @escaping () -> Void) {
        if HisnSettings.unlocked { action() } else { pinRequest = .verify(action) }
    }
    private func add() {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard raw.count >= 2 else { return }
        var name = raw, handle = ""
        if let r = raw.range(of: "@") {
            let h = raw[r.upperBound...].split(whereSeparator: { "/?# ".contains($0) }).first.map(String.init) ?? ""
            if !h.isEmpty { handle = h; name = h }
        } else if let u = URL(string: raw), let host = u.host, host.contains("youtube"), u.pathComponents.count >= 3, u.pathComponents[1] == "channel" {
            handle = u.pathComponents[2]; name = handle
        }
        guard !channels.contains(where: { $0["name"] == name && $0["handle"] == handle }) else { text = ""; return }
        channels.append(["name": String(name.prefix(80)), "handle": String(handle.prefix(80))])
        text = ""
        save()
    }
    private func save() {
        HisnSettings.allowedChannels = channels
        BrowserSessions.shared.pushSettings()
    }
}


/// ملخص النشاط: أعداد لكل يوم (ما أُخفي، ما أُوقف، ما حُجب من مواقع) وعناوين البحث في يوتيوب. أرقام على الجهاز، لا صور ولا روابط.
struct ActivityView: View {
    @State private var days = Activity.all
    @State private var confirmClear = false
    @State private var logSearches = HisnSettings.logSearches

    var body: some View {
        List {
            let t = Activity.totals()
            Section {
                HStack {
                    stat(t.hidden, tr("بطاقة أُخفيت", "cards hidden"))
                    Divider()
                    stat(t.stopped, tr("مقطع أُوقف", "videos stopped"))
                    Divider()
                    stat(t.blocked, tr("موقع حُجب", "sites blocked"))
                }
            } header: { Text(tr("آخر 7 أيام", "Last 7 days")) } footer: {
                Text(tr("يُحفظ على هذا الجهاز فقط ويُحذف تلقائيًا بعد ١٤ يومًا: أعداد، وفي وضع الطفل عبارات بحث يوتيوب (حتى ٤٠ عبارة يوميًا) إن كان الخيار أدناه مفعّلًا. لا يُرسل شيء. «أُخفي» = بطاقات اختفت قبل أن تظهر. «أُوقف» = مقطع فُتح ثم أُوقف برسالة.",
                        "Kept only on this device and deleted automatically after 14 days: counts, and in child mode YouTube search phrases (up to 40 a day) if the option below is on. Nothing is sent. “Hidden” = cards removed before showing. “Stopped” = a video that opened and was stopped."))
            }
            Section {
                Toggle(tr("حفظ عبارات بحث يوتيوب (وضع الطفل)", "Save YouTube searches (child mode)"), isOn: $logSearches)
                    .onChange(of: logSearches) { _, v in HisnSettings.logSearches = v; days = Activity.all }
            } footer: {
                Text(tr("إطفاؤه يحذف العبارات المحفوظة ويوقف حفظها، وتبقى الأعداد.", "Turning it off deletes saved phrases and stops saving them; counts stay."))
            }
            ForEach(days.keys.sorted().reversed(), id: \.self) { d in
                let day = days[d] ?? [:]
                Section(d) {
                    Text(tr("أُخفي \((day["hidden"] as? Int) ?? 0) · أُوقف \((day["stopped"] as? Int) ?? 0) · حُجب \((day["blocked"] as? Int) ?? 0)",
                            "Hidden \((day["hidden"] as? Int) ?? 0) · stopped \((day["stopped"] as? Int) ?? 0) · blocked \((day["blocked"] as? Int) ?? 0)"))
                    if let q = day["searches"] as? [String], !q.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(tr("بحث يوتيوب:", "YouTube searches:")).font(.footnote).foregroundStyle(.secondary)
                            Text(q.joined(separator: " · ")).font(.footnote)
                        }
                    }
                }
            }
            if days.isEmpty { Text(tr("لا نشاط مسجّل بعد.", "No activity recorded yet.")).foregroundStyle(.secondary) }
            Section {
                Button(tr("مسح السجل", "Clear log"), role: .destructive) { confirmClear = true }
            }
        }
        .navigationTitle(tr("ملخص النشاط", "Activity summary"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { Activity.prune(); days = Activity.all }
        .confirmationDialog(tr("مسح السجل؟", "Clear the log?"), isPresented: $confirmClear, titleVisibility: .visible) {
            Button(tr("مسح", "Clear"), role: .destructive) { Activity.clear(); days = [:] }
            Button(tr("إلغاء", "Cancel"), role: .cancel) {}
        }
    }

    private func stat(_ n: Int, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text("\(n)").font(.title2.bold()).foregroundStyle(Color.brand)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
