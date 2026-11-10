import SwiftUI

/// «الاستثناءات وطلبات المراجعة»: كل ما خُفّف أو صُحّح يدويًا في مكان واحد ظاهر، يمكن مراجعته وإلغاؤه —
/// بدل أن تتراكم الاستثناءات دون أن يراها أحد. ما يقلل الحماية يطلب الرمز.
struct ExceptionsView: View {
    @State private var requests = ReviewRequests.all
    @State private var safe = Exceptions.items("safe")
    @State private var unsafe = Exceptions.items("unsafe")
    @State private var pinRequest: PinRequest?
    @State private var open: Platform?
    @State private var confirmClearSafe = false

    var body: some View {
        List {
            if HisnSettings.childMode || !requests.isEmpty {
                Section {
                    if requests.isEmpty { Text(tr("لا طلبات.", "No requests.")).foregroundStyle(.secondary) }
                    ForEach(requests) { r in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(r.label.isEmpty ? tr("صورة في \(r.host)", "An image on \(r.host)") : r.label).lineLimit(2)
                            Text("\(r.host) · \(r.date)").font(.caption).foregroundStyle(.secondary)
                            HStack {
                                if !r.key.isEmpty {
                                    Button(tr("اسمح بها", "Allow it")) { guarded { approve(r) } }.buttonStyle(.borderedProminent).tint(Color.brand)
                                }
                                if let u = URL(string: r.page), u.scheme == "https" {
                                    Button(tr("افتحي الصفحة", "Open page")) {
                                        guarded { open = Platform(id: "review-\(r.id)", ar: r.host, en: r.host, url: u, icon: "eye", custom: true) }
                                    }.buttonStyle(.bordered)
                                }
                                Spacer()
                                Button(tr("ارفض", "Decline"), role: .destructive) { ReviewRequests.remove(r.id); reload() }.buttonStyle(.bordered)
                            }.font(.footnote)
                        }.padding(.vertical, 2)
                    }
                } header: { Text(tr("طلبات مراجعة من الطفل", "Review requests from the child") + " (\(requests.count))") } footer: {
                    Text(tr("يطلبها الطفل من نافذة المحتوى المخفي. «اسمح بها» يُظهر تلك الصورة وحدها دائمًا (لا الحساب ولا الموقع). الطلبات محفوظة على هذا الجهاز فقط وتُحذف بعد ١٤ يومًا. «افتحي الصفحة» يفتحها مغطاة كما هي، ويمكنك إظهارها بالرمز.",
                            "The child sends these from the hidden-content popup. “Allow it” always shows that one image only (not the account or site). Requests stay on this device and are deleted after 14 days. “Open page” opens it still covered; you can reveal with the code."))
                }
            }

            Section {
                if safe.isEmpty { Text(tr("لا شيء.", "Nothing.")).foregroundStyle(.secondary) }
                ForEach(safe) { item($0) }
                    .onDelete { idx in let keys = idx.map { safe[$0].id }; Exceptions.remove(keys); changed() }
                if !safe.isEmpty {
                    Button(tr("إلغاء كل الاستثناءات", "Remove all exceptions"), role: .destructive) { confirmClearSafe = true }
                }
            } header: { Text(tr("صور عُلّمت «سليمة دائمًا»", "Images marked “always safe”") + " (\(safe.count))") } footer: {
                Text(tr("كل تصحيح يخص صورة واحدة بعينها. حذفه يعيد فحصها كالمعتاد (لا يحتاج رمزًا لأنه يزيد الحماية).",
                        "Each correction covers one specific image. Deleting it brings back normal checking (no code needed, it adds protection)."))
            }

            Section {
                if unsafe.isEmpty { Text(tr("لا شيء.", "Nothing.")).foregroundStyle(.secondary) }
                ForEach(unsafe) { item($0) }
                    .onDelete { idx in let keys = idx.map { unsafe[$0].id }; guarded { Exceptions.remove(keys); changed() } }
            } header: { Text(tr("صور أخفيتِها بنفسك", "Images you hid yourself") + " (\(unsafe.count))") }

            Section {
                NavigationLink { AllowedChannelsView() } label: {
                    Label(tr("القنوات المسموحة في يوتيوب", "Allowed YouTube channels") + " (\(HisnSettings.allowedChannels.count))", systemImage: "checkmark.rectangle.stack")
                }
                if !HisnSettings.redditAllowed.isEmpty {
                    Label(tr("مجتمعات ريديت المسموحة: ", "Allowed Reddit communities: ") + HisnSettings.redditAllowed.joined(separator: "، "), systemImage: "bubble.left.and.bubble.right")
                        .font(.footnote)
                }
            } header: { Text(tr("استثناءات أخرى", "Other exceptions")) } footer: {
                Text(tr("«إظهار مرة» لا يُحفظ: يخص تلك الصورة في تلك الصفحة فقط ويزول بإغلاقها.",
                        "“Show once” isn't saved: it applies to that image on that page only and goes away when you leave."))
            }
        }
        .navigationTitle(tr("الاستثناءات والطلبات", "Exceptions & requests"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { reload() }
        .confirmationDialog(tr("إلغاء كل الاستثناءات؟ تعود هذه الصور تُفحص كالمعتاد.", "Remove all exceptions? These images will be checked normally again."), isPresented: $confirmClearSafe, titleVisibility: .visible) {
            Button(tr("إلغاء الكل", "Remove all"), role: .destructive) { Exceptions.remove(safe.map(\.id)); changed() }
        }
        .sheet(item: $pinRequest) { req in
            PinSheet(request: req) { ok in
                pinRequest = nil
                if ok, case let .verify(action) = req { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() } }
            }
        }
        .navigationDestination(item: $open) { ProtectedBrowserView(platform: $0) }
    }

    private func item(_ e: Exceptions.Item) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(e.label.isEmpty ? tr("صورة بلا وصف", "Image without a description") : e.label).lineLimit(2)
            Text([e.host, e.date].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func approve(_ r: ReviewRequests.Item) {
        Exceptions.set(r.key, "safe", host: r.host, label: r.label)
        ReviewRequests.remove(r.id)
        HisnLog.write("child: review approved")
        changed()
    }
    private func changed() { BrowserSessions.shared.pushSettings(); reload() }
    private func reload() {
        requests = ReviewRequests.all
        safe = Exceptions.items("safe")
        unsafe = Exceptions.items("unsafe")
    }
    private func guarded(_ action: @escaping () -> Void) {
        if HisnSettings.unlocked { action() } else { pinRequest = .verify(action) }
    }
}
