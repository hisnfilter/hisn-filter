import FamilyControls
import ManagedSettings
import SwiftUI

/// لعبة في قائمة «الألعاب»: ما نتحكم فيه من تطبيقنا (القفل والوقت)، وما يُضبط داخل اللعبة نفسها (بخطوات).
struct GameEntry: Identifiable, Hashable {
    let id: String
    let name: String
    let site: String?          // لأيقونة اللعبة قبل ربطها
    let parentURL: String?     // صفحة إعدادات الوالدين الرسمية
    let minAge: Int?           // التصنيف الرسمي التقريبي
    let steps: (_ under13: Bool) -> [String]

    static func == (a: GameEntry, b: GameEntry) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    /// ألعاب أضافها الوالدان بأنفسهم («لعبة أخرى»)
    static func custom(_ id: String) -> GameEntry {
        GameEntry(id: id, name: tr("لعبة", "Game"), site: nil, parentURL: nil, minAge: nil) { _ in [] }
    }

    static let askToBuy = tr("الشراء بإذن: إعدادات الآيفون ← العائلة ← اسم الطفل ← «اطلب الشراء».",
                             "Purchases need approval: iPhone Settings → Family → child → Ask to Buy.")

    static let catalog: [GameEntry] = [
        GameEntry(id: "roblox", name: "Roblox", site: "https://www.roblox.com", parentURL: "https://www.roblox.com/my/account#!/parental-controls", minAge: nil) { u13 in [
            tr("اربطي حسابك بحساب طفلك: روبلوكس ← الإعدادات ← الرقابة الأبوية ← إضافة والد.", "Link your account to your child's: Roblox → Settings → Parental Controls → Add parent."),
            u13 ? tr("مستوى المحتوى: Minimal.", "Content maturity: Minimal.") : tr("مستوى المحتوى: Mild.", "Content maturity: Mild."),
            u13 ? tr("الدردشة: إيقاف.", "Chat: off.") : tr("الدردشة: الأصدقاء فقط.", "Chat: friends only."),
            tr("حد شهري للشراء، أو صفر.", "A monthly spending limit, or zero."),
            tr("احظري الألعاب المرعبة بالأسفل: انسخي الاسم ← «الألعاب المحظورة» في إعدادات الوالدين.", "Block the horror games below: copy a name → Blocked experiences in parental controls."),
        ] },
        GameEntry(id: "minecraft", name: "Minecraft", site: "https://www.minecraft.net", parentURL: "https://family.microsoft.com", minAge: nil) { _ in [
            tr("أنشئي حساب الطفل في Microsoft Family واربطيه بحسابك.", "Add the child's account to Microsoft Family."),
            tr("أوقفي اللعب مع الغرباء والدردشة من إعدادات Xbox للطفل.", "Turn off playing and chatting with strangers in the child's Xbox settings."),
            askToBuy,
        ] },
        GameEntry(id: "fortnite", name: "Fortnite", site: "https://www.fortnite.com", parentURL: "https://www.epicgames.com/account/parental-controls", minAge: 12) { _ in [
            tr("داخل اللعبة: الإعدادات ← الرقابة الأبوية ← ضعي رمزًا.", "In the game: Settings → Parental Controls → set a PIN."),
            tr("الدردشة الصوتية والنصية: إيقاف أو الأصدقاء فقط.", "Voice and text chat: off or friends only."),
            tr("تصفية الألفاظ: تشغيل.", "Mature language filter: on."),
            askToBuy,
        ] },
        GameEntry(id: "brawlstars", name: "Brawl Stars", site: "https://supercell.com", parentURL: nil, minAge: nil) { _ in [askToBuy] },
        GameEntry(id: "amongus", name: "Among Us", site: "https://www.innersloth.com", parentURL: nil, minAge: nil) { _ in [
            tr("حساب الطفل أقل من 13: الدردشة السريعة فقط (جمل جاهزة).", "Under-13 account: Quick Chat only (preset phrases)."),
            askToBuy,
        ] },
        GameEntry(id: "pubg", name: "PUBG Mobile", site: "https://www.pubgmobile.com", parentURL: nil, minAge: 16) { _ in [
            tr("لعبة قتال لأكبر من 16 تقريبًا: ننصح بقفلها للأطفال.", "A shooter for about 16+: we suggest locking it for children."),
        ] },
    ]

    /// ألعاب رعب داخل روبلوكس (من ملف الموضوعات نفسه الذي يخفي مقاطعها في يوتيوب وتيك توك)
    static let robloxHorror: [String] = {
        guard let url = Bundle.main.url(forResource: "topics", withExtension: "json", subdirectory: "web"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let games = json["games"] as? [String: Any], let list = games["roblox"] as? [String] else { return [] }
        return list
    }()
}

/// «الألعاب»: يدخلها الأب أو الأم، يختار لعبة، ويتحكم فيها بلمسة.
struct GamesView: View {
    @State private var customIDs: [String] = AppGroup.defaults.stringArray(forKey: "games.custom") ?? []
    @State private var version = 0
    @ObservedObject private var icons = SiteIcons.shared

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 12)], spacing: 12) {
                ForEach(GameEntry.catalog + customIDs.map(GameEntry.custom)) { g in
                    // رابط مباشر (لا بالقيمة): الصفحة نفسها فُتحت برابط مباشر، والخلط بينهما يعلّق الفتح
                    NavigationLink {
                        GameDetailView(game: g) { version += 1 } onRemove: {
                            customIDs.removeAll { $0 == g.id }
                            AppGroup.defaults.set(customIDs, forKey: "games.custom")
                        }
                    } label: { tile(g) }.buttonStyle(.plain)
                }
                Button(action: addCustom) {
                    VStack(spacing: 8) {
                        Image(systemName: "plus").font(.title2.bold()).frame(width: 52, height: 52)
                            .background(Color.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                        Text(tr("لعبة أخرى", "Another game")).font(.footnote)
                    }
                    .frame(maxWidth: .infinity, minHeight: 110)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
            }
            .padding(16)
            .id(version)
            Text(tr("مقاطع الألعاب المرعبة تُخفى تلقائيًا في يوتيوب وتيك توك داخل فلتر حصن.", "Videos of horror games are hidden automatically on YouTube and TikTok inside Hisn Filter."))
                .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(tr("الألعاب", "Games"))
    }

    @ViewBuilder private func tile(_ g: GameEntry) -> some View {
        let sel = Games.selection(g.id)
        VStack(spacing: 8) {
            if let token = sel.applicationTokens.first {
                // بعد الربط: أيقونة التطبيق واسمه الحقيقيان من النظام
                Label(token).labelStyle(.iconOnly).scaleEffect(1.6).frame(width: 52, height: 52)
            } else if let s = g.site, let u = URL(string: s), let img = icons.image(for: u) {
                Image(uiImage: img).resizable().scaledToFit().frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                Image(systemName: "gamecontroller.fill").font(.title).foregroundStyle(Color.brand).frame(width: 52, height: 52)
                    .background(Color.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            }
            if let token = sel.applicationTokens.first, g.site == nil {
                Label(token).labelStyle(.titleOnly).font(.footnote).lineLimit(1)
            } else {
                Text(g.name).font(.footnote).lineLimit(1)
            }
            Text(status(g)).font(.caption2).foregroundStyle(Games.locked(g.id) ? .red : .secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 110)
        .padding(.vertical, 6)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func status(_ g: GameEntry) -> String {
        if !ProtectionSetup.available { return tr("نصائح الأمان", "Safety tips") }
        if !Games.isLinked(g.id) { return tr("غير مربوطة", "Not linked") }
        if Games.locked(g.id) { return tr("مقفلة", "Locked") }
        let m = Games.limit(g.id)
        return m > 0 ? tr("\(m) دقيقة يوميًا", "\(m) min a day") : tr("مفتوحة", "Open")
    }

    private func addCustom() {
        let id = "custom\(Int(Date().timeIntervalSince1970))"
        customIDs.append(id)
        AppGroup.defaults.set(customIDs, forKey: "games.custom")
    }
}

/// لعبة واحدة: قفل، وحد يومي، وخطوات الأمان داخل اللعبة.
struct GameDetailView: View {
    let game: GameEntry
    var changed: () -> Void
    var onRemove: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selection = FamilyActivitySelection()
    @State private var picking = false
    @State private var locked = false
    @State private var limit = 0
    @State private var authorized = ProtectionSetup.authorized
    @State private var pinRequest: PinRequest?
    @State private var message: String?
    @State private var copied: String?
    @State private var loaded = false
    @State private var blockedDone: Set<String> = Set(AppGroup.defaults.stringArray(forKey: "roblox.blockedDone") ?? [])
    private var u13: Bool { HisnSettings.under13 || !HisnSettings.childMode }

    var body: some View {
        Form {
            if !loaded {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            } else {
            Section {
                if !ProtectionSetup.available {
                    Text(tr("لقفل اللعبة أو تحديد وقتها: «مدة استخدام الجهاز ← حدود التطبيقات» في إعدادات الآيفون.", "To lock the game or limit its time: Screen Time → App Limits in iPhone Settings."))
                        .font(.footnote).foregroundStyle(.secondary)
                    NavigationLink(tr("الشرح خطوة بخطوة", "Step-by-step guide")) { ScreenTimeGuideView() }
                } else if !authorized {
                    Button(tr("فعّل التحكم بالتطبيقات", "Turn on app control")) {
                        Task {
                            try? await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                            authorized = ProtectionSetup.authorized
                        }
                    }
                } else if selection.applicationTokens.isEmpty {
                    Text(tr("عشان نقدر نقفل \(game.site == nil ? "اللعبة" : game.name) أو نحدد وقتها من هنا، اختاري تطبيقها من قائمة آبل مرة وحدة بس. (آبل ما تسمح لأي تطبيق يعرف التطبيقات إلا بهالطريقة.)",
                            "To lock \(game.site == nil ? "the game" : game.name) or limit its time from here, pick its app once from Apple's list. (Apple only lets apps know other apps this way.)"))
                        .font(.footnote).foregroundStyle(.secondary)
                    Button { picking = true } label: {
                        Label(tr("اختاري تطبيق \(game.site == nil ? "اللعبة" : game.name) من جوالك", "Pick the \(game.site == nil ? "game" : game.name) app on this phone"), systemImage: "hand.tap")
                    }
                    Text(tr("في القائمة: افتحي «الألعاب» أو ابحثي بالاسم، علّمي عليه، ثم «تم».", "In the list: open Games or search by name, tick it, then Done.")).font(.footnote).foregroundStyle(.secondary)
                } else {
                    if let token = selection.applicationTokens.first { Label(token) }
                    Toggle(tr("مقفلة", "Locked"), isOn: Binding(get: { locked }, set: { on in
                        let apply = { Games.setLocked(game.id, on); locked = on; changed() }
                        if on { apply() } else { guarded(apply) } // القفل لا يحتاج رمزًا، والفتح يحتاجه
                    }))
                    Picker(tr("الحد اليومي", "Daily limit"), selection: Binding(get: { limit }, set: { m in
                        let apply = {
                            do { try Games.setLimit(game.id, minutes: m); limit = m; changed() }
                            catch { message = error.localizedDescription }
                        }
                        // تقليل الوقت تشديد بلا رمز، وزيادته أو إلغاؤه يحتاج الرمز
                        if m != 0 && (limit == 0 || m < limit) { apply() } else { guarded(apply) }
                    })) {
                        Text(tr("بلا حد", "No limit")).tag(0)
                        ForEach([15, 30, 45, 60, 90, 120], id: \.self) { Text(tr("\($0) دقيقة", "\($0) min")).tag($0) }
                    }
                    Button(tr("تغيير الربط", "Change link")) { guarded { picking = true } }.font(.footnote)
                }
                if let message { Text(message).font(.footnote).foregroundStyle(.red) }
            } header: {
                Text(tr("من فلتر حصن", "From Hisn Filter"))
            } footer: {
                if let a = game.minAge { Text(tr("التصنيف: لأكبر من \(a) تقريبًا.", "Rated about \(a)+.")) }
                else { Text(tr("عند انتهاء الوقت تُقفل اللعبة حتى الغد، حتى لو كان فلتر حصن مغلقًا.", "When time is up the game locks until tomorrow, even if Hisn Filter is closed.")) }
            }

            let steps = game.steps(u13)
            if !steps.isEmpty {
                Section {
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(i + 1)").font(.footnote.bold()).frame(width: 22, height: 22).background(Color.brand.opacity(0.15), in: Circle())
                            Text(s).font(.subheadline)
                        }
                    }
                    if let u = game.parentURL.flatMap(URL.init(string:)) {
                        Link(destination: u) { Label(tr("افتح إعدادات الوالدين", "Open parental controls"), systemImage: "arrow.up.forward.app") }
                    }
                } header: {
                    Text(tr("داخل اللعبة (مرة واحدة)", "Inside the game (once)"))
                }
            }

            if game.id == "roblox", !GameEntry.robloxHorror.isEmpty {
                Section {
                    Button { copy(GameEntry.robloxHorror.joined(separator: "\n")) } label: {
                        Label(tr("نسخ القائمة كاملة", "Copy the whole list"), systemImage: "doc.on.doc.fill")
                    }
                    ForEach(GameEntry.robloxHorror, id: \.self) { name in
                        HStack(spacing: 12) {
                            // علامة «حُظرت» تُحفظ هنا لتعرفي ما بقي
                            Button { toggleDone(name) } label: {
                                Image(systemName: blockedDone.contains(name) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3).foregroundStyle(blockedDone.contains(name) ? Color.green : Color.secondary)
                            }.buttonStyle(.plain)
                            Text(name).strikethrough(blockedDone.contains(name)).foregroundStyle(blockedDone.contains(name) ? .secondary : .primary)
                            Spacer()
                            Button { copy(name) } label: {
                                Image(systemName: copied == name ? "checkmark" : "doc.on.doc").foregroundStyle(Color.brand)
                            }.buttonStyle(.plain)
                        }
                    }
                } header: {
                    Text(tr("ألعاب مرعبة للحظر", "Horror games to block"))
                } footer: {
                    Text(tr("روبلوكس ما يسمح لأي تطبيق يحظر ألعابه بدل الوالدين، فالحظر يكون من إعداداته: انسخي الاسم ← الصقيه في «الألعاب المحظورة» ← احظري، ثم علّمي ✓ هنا عشان تعرفين وش بقي (%d من %d).".replacingOccurrences(of: "%d من %d", with: "\(blockedDone.count) من \(GameEntry.robloxHorror.count)"),
                            "Roblox doesn't let apps block games for parents, so blocking is done in its settings: copy a name → paste it in Blocked experiences → block, then tick ✓ here to track what's left (\(blockedDone.count) of \(GameEntry.robloxHorror.count))."))
                }
            }

            if game.site == nil {
                Section { Button(tr("إزالة من القائمة", "Remove from list"), role: .destructive) {
                    guarded {
                        Games.setLocked(game.id, false)
                        try? Games.setLimit(game.id, minutes: 0)
                        Games.link(game.id, FamilyActivitySelection())
                        onRemove(); dismiss()
                    }
                } }
            }
        }
        }
        .navigationTitle(game.site == nil ? tr("لعبة", "Game") : game.name)
        .task {
            // يظهر مؤشر التحميل فورًا، ثم المحتوى
            let id = game.id
            let (sel, lk, lim) = await Task.detached(priority: .userInitiated) { (Games.selection(id), Games.locked(id), Games.limit(id)) }.value
            _ = GameEntry.robloxHorror
            selection = sel; locked = lk; limit = lim
            loaded = true
        }
        .familyActivityPicker(isPresented: $picking, selection: $selection)
        .onChange(of: selection) { _, s in
            Games.link(game.id, s)
            if limit > 0 { try? Games.schedule(game.id) }
            changed()
        }
        .sheet(item: $pinRequest) { req in
            PinSheet(request: req) { ok in
                pinRequest = nil
                if ok, case let .verify(action) = req { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() } }
            }
        }
    }

    private func toggleDone(_ name: String) {
        if blockedDone.contains(name) { blockedDone.remove(name) } else { blockedDone.insert(name) }
        AppGroup.defaults.set(Array(blockedDone), forKey: "roblox.blockedDone")
    }

    private func copy(_ s: String) {
        UIPasteboard.general.string = s
        copied = s
    }

    private func guarded(_ action: @escaping () -> Void) {
        if HisnSettings.unlocked { action() } else { pinRequest = .verify(action) }
    }
}
