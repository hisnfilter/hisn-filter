import AVFoundation
import CryptoKit
import ImageIO
import SwiftUI
import WebKit

/// منصة تُفتح داخل «المتصفح المحمي».
struct Platform: Identifiable, Hashable {
    let id: String
    let ar: String
    let en: String
    let url: URL
    let icon: String
    /// المنصة نفسها لا تسمح بأقل من 13 سنة: تُخفى في وضع الطفل لمن دون 13.
    var teen = true
    var custom = false
    /// متصفح حر بشريط عنوان (سفاري/كروم/فايرفوكس): نفس متصفحنا المحمي، والاسم والأيقونة لما يعرفه المستخدم
    var free = false
    /// موقع تُؤخذ منه الأيقونة إن اختلف عن موقع البداية
    var iconURL: URL? = nil
    /// رمز النظام فقط بلا أيقونة من الشبكة
    var symbolOnly = false
    /// الموقع لا يقدّم نسخة للجوال (سناب شات يعرض «حمّل التطبيق» فقط): نعرّف أنفسنا كمتصفح حاسوب
    var desktop = false
    /// يظهر في قائمة التطبيقات المقترحة. منصات لا ندعو إليها (تيك توك، فيسبوك) تبقى معروفة للتطبيق (لأداة
    /// تنظيف الحساب وروابط تُفتح فيه) لكنها لا تُعرض؛ من يريدها يضيفها بنفسه من «أضف موقعًا».
    var suggested = true
    var iconSource: URL? { symbolOnly ? nil : (iconURL ?? url) }

    var name: String { tr(ar, en) }

    static let builtIn: [Platform] = [
        Platform(id: "youtube", ar: "يوتيوب", en: "YouTube", url: URL(string: "https://m.youtube.com")!, icon: "play.rectangle.fill", teen: false),
        Platform(id: "google", ar: "قوقل", en: "Google", url: URL(string: "https://www.google.com")!, icon: "magnifyingglass", teen: false),
        Platform(id: "instagram", ar: "إنستغرام", en: "Instagram", url: URL(string: "https://www.instagram.com")!, icon: "camera.fill"),
        Platform(id: "tiktok", ar: "تيك توك", en: "TikTok", url: URL(string: "https://www.tiktok.com")!, icon: "music.note", suggested: false),
        // سناب شات على الجوال يعرض صفحة «حمّل التطبيق» فقط؛ نسخة الحاسوب (Snapchat for Web) فيها الدخول والمحادثات
        Platform(id: "snapchat", ar: "سناب شات", en: "Snapchat", url: URL(string: "https://accounts.snapchat.com/accounts/login?continue=https%3A%2F%2Fwww.snapchat.com%2Fweb")!, icon: "bolt.fill", iconURL: URL(string: "https://www.snapchat.com"), desktop: true),
        Platform(id: "x", ar: "إكس", en: "X", url: URL(string: "https://x.com")!, icon: "bubble.left.fill", suggested: false),
        Platform(id: "facebook", ar: "فيسبوك", en: "Facebook", url: URL(string: "https://m.facebook.com")!, icon: "person.2.fill", suggested: false),
        Platform(id: "threads", ar: "ثريدز", en: "Threads", url: URL(string: "https://www.threads.net")!, icon: "at"),
        Platform(id: "pinterest", ar: "بنترست", en: "Pinterest", url: URL(string: "https://www.pinterest.com")!, icon: "pin.fill"),
        Platform(id: "reddit", ar: "ريديت", en: "Reddit", url: URL(string: "https://www.reddit.com")!, icon: "text.bubble.fill", suggested: false),
        Platform(id: "chatgpt", ar: "ChatGPT", en: "ChatGPT", url: URL(string: "https://chatgpt.com")!, icon: "sparkles"),
        Platform(id: "gemini", ar: "جيمني", en: "Gemini", url: URL(string: "https://gemini.google.com")!, icon: "sparkle"),
        // تصفح حر بشريط عنوان داخل الحماية نفسها، بأسماء المتصفحات التي يعرفها الناس (كلها متصفحنا المحمي)
        Platform(id: "safari", ar: "سفاري", en: "Safari", url: URL(string: "https://www.google.com")!, icon: "safari", free: true, symbolOnly: true),
        Platform(id: "chrome", ar: "كروم", en: "Chrome", url: URL(string: "https://www.google.com")!, icon: "globe", free: true, iconURL: URL(string: "https://developer.chrome.com/")),
        Platform(id: "firefox", ar: "فايرفوكس", en: "Firefox", url: URL(string: "https://www.google.com")!, icon: "flame", free: true, iconURL: URL(string: "https://www.firefox.com/")),
    ]

    /// ما يظهر الآن: المنصات المناسبة للعمر، ثم ما أضافه المستخدم.
    static var visible: [Platform] {
        let custom = HisnSettings.customSites.compactMap { d -> Platform? in
            guard let name = d["name"], let raw = d["url"], let url = URL(string: raw) else { return nil }
            // خدمات البث المشفّرة (نتفلكس…) محجوبة أصلًا: لا تُعرض بطاقتها
            if let h = url.host?.lowercased(), Blocklist.shared.isStreaming(h) { return nil }
            return Platform(id: "c:" + raw, ar: name, en: name, url: url, icon: "globe", teen: false, custom: true)
        }
        // أقل من 13: يوتيوب يُفتح على «يوتيوب كيدز» (محتوى مُنتقى للأطفال) بدل يوتيوب العام — طبقة قاطعة فوق الفلتر
        let hidden = Set(HisnSettings.hiddenPlatforms)
        let added = Set(HisnSettings.addedPlatforms)
        return builtIn.filter { ($0.suggested || added.contains($0.id)) && !(HisnSettings.under13 && $0.teen) && !hidden.contains($0.id) }.map { p -> Platform in
            guard HisnSettings.youtubeToKids, p.id == "youtube" else { return p }
            // موقع يوتيوب كيدز لا يعمل بهوية جوال (يحوّل لصفحة دعائية)، ويعمل بهوية حاسوب
            return Platform(id: "youtube", ar: "يوتيوب كيدز", en: "YouTube Kids", url: URL(string: "https://www.youtubekids.com")!, icon: p.icon, teen: false, iconURL: URL(string: "https://www.youtubekids.com"), desktop: true)
        } + custom
    }

    /// نطاقات ترافق كل منصة (تسجيل الدخول وصفحاتها الفرعية): تُسمح معها في «المواقع المسموحة فقط»
    static let companions: [String: [String]] = [
        "youtube": ["youtube.com", "youtu.be", "youtubekids.com", "accounts.google.com", "myaccount.google.com"],
        "instagram": ["instagram.com", "facebook.com"],
        "threads": ["threads.net", "threads.com", "instagram.com"],
        "snapchat": ["snapchat.com"],
        "tiktok": ["tiktok.com"],
        "gemini": ["gemini.google.com", "accounts.google.com"],
        "x": ["x.com", "twitter.com"],
    ]

    /// هل يُسمح بهذا المضيف في وضع «المواقع المسموحة فقط»؟ (أي موقع في القائمة الظاهرة، أو من نطاقاته المرافقة)
    static func isAllowedHost(_ host: String) -> Bool {
        let h = host.lowercased()
        let matches = { (d: String) -> Bool in h == d || h.hasSuffix("." + d) }
        for p in visible {
            if let ph = p.url.host?.lowercased() {
                let bare = ph.hasPrefix("www.") ? String(ph.dropFirst(4)) : ph
                if matches(bare) { return true }
            }
            if (companions[p.id] ?? []).contains(where: matches) { return true }
        }
        return false
    }

    /// يحوّل ما كتبه المستخدم إلى رابط صالح (يضيف https:// إن نقص).
    static func url(from text: String) -> URL? {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !t.contains(" ") else { return nil }
        if !t.lowercased().hasPrefix("http://") && !t.lowercased().hasPrefix("https://") { t = "https://" + t }
        guard let u = URL(string: t), let host = u.host, host.contains(".") else { return nil }
        return u
    }
}

/// أيقونة الموقع الحقيقية (من الموقع نفسه، كما يفعل Safari في المفضلة)، تُحفظ على الجهاز.
@MainActor
final class SiteIcons: ObservableObject {
    static let shared = SiteIcons()
    @Published private(set) var images: [String: UIImage] = [:]
    private var loading = Set<String>()
    private let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("site-icons", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    func image(for url: URL) -> UIImage? {
        guard let host = url.host else { return nil }
        if let img = images[host] { return img }
        let file = dir.appendingPathComponent(host + ".png")
        if let data = try? Data(contentsOf: file), let img = UIImage(data: data) {
            // لا نغيّر حالة منشورة أثناء رسم الواجهة
            DispatchQueue.main.async { self.images[host] = img }
            return img
        }
        DispatchQueue.main.async { self.load(url, host: host, file: file) }
        return nil
    }

    private func load(_ url: URL, host: String, file: URL) {
        guard !loading.contains(host) else { return }
        loading.insert(host)
        Task {
            if let img = await Self.fetch(url), let png = img.pngData() {
                try? png.write(to: file)
                images[host] = img
            }
        }
    }

    /// يقرأ صفحة الموقع ويبحث عن أيقونته (apple-touch-icon)، وإلا الأيقونة المعتادة.
    nonisolated static func fetch(_ page: URL) async -> UIImage? {
        var candidates: [URL] = []
        var req = URLRequest(url: page, timeoutInterval: 10)
        req.setValue(ProtectedWeb.userAgent, forHTTPHeaderField: "User-Agent")
        if let (data, resp) = try? await URLSession.shared.data(for: req), let html = String(data: data.prefix(400_000), encoding: .utf8) {
            let base = resp.url ?? page
            let pattern = #"<link[^>]+rel=["'](?:apple-touch-icon(?:-precomposed)?|icon|shortcut icon)["'][^>]*>"#
            if let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                let tags = re.matches(in: html, range: NSRange(html.startIndex..., in: html)).compactMap { Range($0.range, in: html).map { String(html[$0]) } }
                // الأكبر أولًا: أيقونة الجوال، ثم الباقي
                for tag in tags.sorted(by: { a, b in a.contains("apple-touch") && !b.contains("apple-touch") }) {
                    if let h = tag.range(of: #"href=["']([^"']+)["']"#, options: .regularExpression) {
                        let href = String(tag[h]).dropFirst(6).dropLast()
                        if let u = URL(string: String(href).replacingOccurrences(of: "&amp;", with: "&"), relativeTo: base)?.absoluteURL { candidates.append(u) }
                    }
                }
            }
            candidates.append(contentsOf: ["/apple-touch-icon.png", "/favicon.ico"].compactMap { URL(string: $0, relativeTo: base)?.absoluteURL })
        }
        for u in candidates.prefix(6) {
            guard let (data, resp) = try? await URLSession.shared.data(from: u),
                  (resp as? HTTPURLResponse)?.statusCode ?? 0 < 400,
                  let img = UIImage(data: data), img.size.width >= 16 else { continue }
            return img
        }
        return nil
    }
}

/// شبكة أزرار المنصات في الشاشة الرئيسية، وآخرها «أضف».
struct PlatformGrid: View {
    @Binding var open: Platform?
    var add: () -> Void
    var remove: (Platform) -> Void
    var restore: () -> Void = {}
    @ObservedObject private var icons = SiteIcons.shared
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var toRemove: Platform?
    /// وضع التعديل (ضغطة مطوّلة): يظهر زر × على كل بطاقة، مثل شاشة الآيفون الرئيسية
    @State private var editing = false

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: hSize == .regular ? 140 : 92), spacing: 12)], spacing: 12) {
            ForEach(Platform.visible) { p in
                Button { if editing { toRemove = p } else { open = p } } label: {
                    tile {
                        if let src = p.iconSource, let img = icons.image(for: src) {
                            Image(uiImage: img).resizable().scaledToFit().frame(width: 34, height: 34).clipShape(RoundedRectangle(cornerRadius: 8))
                        } else {
                            Image(systemName: p.icon).font(.title2).frame(width: 34, height: 34)
                        }
                        Text(p.name).font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .overlay(alignment: .topLeading) {
                        if editing {
                            Image(systemName: "xmark.circle.fill")
                                .font(.title2)
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .red)
                                .padding(4)
                                .transition(.scale)
                        }
                    }
                }
                .buttonStyle(.plain)
                .simultaneousGesture(LongPressGesture(minimumDuration: 0.6).onEnded { _ in
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    withAnimation(.spring(duration: 0.25)) { editing = true }
                })
                .contextMenu {
                    Button(tr("حذف من القائمة", "Remove from list"), role: .destructive) { toRemove = p }
                }
            }
            if editing {
                Button { withAnimation { editing = false } } label: {
                    tile {
                        Image(systemName: "checkmark").font(.title2).frame(width: 34, height: 34)
                        Text(tr("تم", "Done")).font(.footnote.weight(.semibold))
                    }
                }
                .buttonStyle(.plain)
            }
            Button(action: add) {
                tile {
                    Image(systemName: "plus").font(.title2).frame(width: 34, height: 34)
                    Text(tr("أضف موقعًا", "Add site")).font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                }
            }
            .buttonStyle(.plain)
            if !HisnSettings.hiddenPlatforms.isEmpty {
                Button(action: restore) {
                    tile {
                        Image(systemName: "arrow.uturn.backward").font(.title2).frame(width: 34, height: 34)
                        Text(tr("استعادة المحذوف", "Restore removed")).font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
        .confirmationDialog(tr("حذف «\(toRemove?.name ?? "")» من القائمة؟", "Remove “\(toRemove?.name ?? "")” from the list?"),
                            isPresented: Binding(get: { toRemove != nil }, set: { if !$0 { toRemove = nil } }), titleVisibility: .visible) {
            Button(tr("حذف", "Remove"), role: .destructive) { if let p = toRemove { remove(p) }; toRemove = nil; editing = false }
            Button(tr("إلغاء", "Cancel"), role: .cancel) { toRemove = nil }
        } message: {
            Text(tr("يمكن استعادته لاحقًا من زر «استعادة المحذوف».", "You can restore it later with “Restore removed”."))
        }
    }

    private func tile<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(spacing: 6, content: content)
            .frame(maxWidth: .infinity, minHeight: hSize == .regular ? 110 : 78)
            .background(Color.brand.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(Color.brand)
    }
}

/// المنصة داخل حصن: نفس حماية الإضافة (تغطية النساء والعورات، والألفاظ، وحماية العقيدة) لأن Apple
/// لا تسمح لأي تطبيق بتغطية المحتوى داخل تطبيق إنستغرام أو تيك توك الأصلي.
/// مصدر واحد لإلغاء كل التفويضات المؤقتة (فتح التطبيق بالرمز، وتفويض الصفحة لإضافة القنوات): القفل الآن،
/// وتغيير الرمز، كلاهما يلغي الاثنين معًا.
enum Unlocks {
    static func revokeAll() {
        HisnSettings.unlockedUntil = .distantPast
        ProtectedWeb.Coordinator.pageUnlockedUntil = .distantPast
    }
}

struct ProtectedBrowserView: View {
    let platform: Platform
    @ObservedObject private var nav: BrowserNav

    init(platform: Platform) {
        self.platform = platform
        // المنصات الثابتة لها جلسة حيّة تُعاد؛ المتصفح الحر والمواقع المضافة تُبنى كل مرة
        let key = platform.free || platform.custom ? nil : platform.id
        self.nav = key.map { BrowserSessions.shared.nav(for: $0) } ?? BrowserNav()
    }
    private var sessionKey: String? { platform.free || platform.custom ? nil : platform.id }
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @FocusState private var editing: Bool

    private var freeBrowser: Bool { platform.free }
    @State private var showStatus = false
    @State private var showLoginHint = false
    @State private var engineState = "ready"

    /// شريط معلومة قصيرة فوق شريط الأدوات (لا يغطي الصفحة)
    private func infoBar(_ icon: String, _ text: String, _ dismiss: (() -> Void)?) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundStyle(Color.brand)
            Text(text).font(.footnote).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let dismiss { Button(tr("فهمت", "Got it"), action: dismiss).font(.footnote.weight(.semibold)) }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.regularMaterial)
    }
    @State private var pageErrors = 0
    private var needsAttention: Bool { pageErrors > 0 || NativeDetector.state == "failed" }
    @ObservedObject private var cleanup = CleanupState.shared

    /// شريط أداة تنظيف الحساب: العدّاد والحالة وزر الإيقاف
    private var cleanupBar: some View {
        HStack(spacing: 10) {
            Image(systemName: cleanup.phase == "paused" ? "pause.circle.fill" : cleanup.phase == "error" ? "exclamationmark.triangle.fill" : "sparkles")
                .foregroundStyle(cleanup.phase == "error" ? Color.red : Color.brand)
            VStack(alignment: .leading, spacing: 1) {
                Text(cleanupTitle).font(.footnote.weight(.semibold))
                Text(cleanupSub).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            if cleanup.phase == "paused" {
                Button(tr("متابعة الآن", "Continue now")) { cleanup.resumeAfterBreak(nav.web) }.font(.caption).buttonStyle(.borderedProminent).tint(Color.brand)
            }
            Button(tr("إيقاف", "Stop"), role: .destructive) { cleanup.stop(nav.web) }.font(.caption)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.regularMaterial)
    }
    private var cleanupTitle: String {
        let what = cleanup.task?.kind == "likes" ? tr("إعجاب", "likes") : cleanup.task?.kind == "subs" ? tr("اشتراك", "subscriptions") : cleanup.task?.kind == "comments" ? tr("تعليق", "comments") : cleanup.task?.kind == "posts" ? tr("منشور", "posts") : tr("إعادة نشر", "reposts")
        switch cleanup.phase {
        case "paused": return tr("استراحة ربع ساعة — أُلغي \(cleanup.done) \(what)", "15-min break — \(cleanup.done) \(what) removed")
        case "finished": return tr("انتهى ✅ أُلغي \(cleanup.done) \(what)", "Done ✅ \(cleanup.done) \(what) removed")
        case "error": return tr("توقف: \(cleanup.note)", "Stopped: \(cleanup.note)")
        default: return tr("تنظيف الحساب: أُلغي \(cleanup.done) \(what)", "Cleanup: \(cleanup.done) \(what) removed")
        }
    }
    private var cleanupSub: String {
        switch cleanup.phase {
        case "paused": return tr("سنذكّرك بإشعار؛ أو تابعي الآن", "We'll remind you; or continue now")
        case "error": return tr("ربما تغيّرت الصفحة — أبلغينا", "The page may have changed — tell us")
        case "finished": return tr("لم يبقَ شيء في هذه القائمة", "Nothing left in this list")
        default: return tr("أبقي الصفحة مفتوحة", "Keep the page open")
        }
    }

    var body: some View {
        // الموقع فوق، وشريطنا تحته في مساحته الخاصة: لا يغطي أزرار الموقع السفلية (تيك توك وإنستغرام)
        VStack(spacing: 0) {
            ProtectedWeb(start: platform.url, nav: nav, desktop: platform.desktop, sessionKey: sessionKey)
                .onAppear { HisnSettings.lastPlatform = platform.id }
            if cleanup.task != nil && platform.id == cleanup.task?.platform { cleanupBar }
            // أول تحميل للمحرك (ثوانٍ على الأجهزة الأقدم): نطمئن بدل أن يبدو التغبيش عطلًا
            if engineState == "loading" { infoBar("hourglass", tr("حصن يجهّز الحماية… المحتوى مغبّش حتى يجهز (ثوانٍ).", "Hisn is getting protection ready… content stays blurred for a few seconds."), nil) }
            // أول فتح لكل منصة: تسجيل الدخول داخل حصن مرة واحدة
            if showLoginHint {
                infoBar("person.badge.key", tr("سجّلي دخولك مرة واحدة داخل حصن بحسابك نفسه — كلمة السر تذهب للموقع مباشرة ولا يراها حصن، ويبقى الدخول محفوظًا.", "Sign in once inside Hisn with your usual account — your password goes straight to the site, Hisn never sees it, and you stay signed in."), {
                    HisnSettings.loginHintSeen = HisnSettings.loginHintSeen + [platform.id]
                    showLoginHint = false
                })
            }
            bottomBar
        }
        .onAppear {
            showLoginHint = !platform.free && !platform.custom && !HisnSettings.loginHintSeen.contains(platform.id)
            engineState = NativeDetector.state
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            if engineState != NativeDetector.state { engineState = NativeDetector.state }
        }
        // أداة تنظيف الحساب: كل 3 ثوانٍ نتأكد أن السكربت يعمل (بعد تنقّل الصفحة يُعاد تشغيله)
        .onReceive(Timer.publish(every: 3, on: .main, in: .common).autoconnect()) { _ in
            guard cleanup.active, cleanup.phase != "paused", platform.id == cleanup.task?.platform, let web = nav.web else { return }
            web.evaluateJavaScript("globalThis.__hisnCleanupState ? globalThis.__hisnCleanupState().running : null", in: nil, in: .defaultClient) { r in
                if case .success(let v) = r, let running = v as? Bool, !running { cleanup.kick(web) }
            }
        }
        // لوحة المفاتيح: الموقع نفسه يتعامل معها (WKWebView)، ولو تركنا SwiftUI يقلّص الصفحة لها قد لا
        // تعود لحجمها بعد إغلاقها فيبقى نصف الشاشة فارغًا
        .ignoresSafeArea(.keyboard, edges: .bottom)
        // سجل تقني بلا محتوى: حالة حرارة الجهاز كل دقيقة أثناء التصفح (لقياس أثر الفحص)
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            let t = ["nominal", "fair", "serious", "critical"][min(3, ProcessInfo.processInfo.thermalState.rawValue)]
            HisnLog.write("thermal=\(t) platform=\(platform.id)")
        }
        .navigationTitle(platform.name)
        .navigationBarTitleDisplayMode(.inline)
        // المنصات تأخذ الشاشة كلها مثل تطبيقها الأصلي (لا شريط عنوان فوق)؛ المتصفح الحر يبقي شريط العنوان
        .toolbar(freeBrowser ? .visible : .hidden, for: .navigationBar)
        .toolbar {
            if freeBrowser {
                ToolbarItem(placement: .principal) { addressField }
            }
        }
        .onReceive(nav.$url) { u in if !editing, let u { address = Self.display(u) } }
        .sheet(isPresented: $showStatus) {
            ProtectionStatusView(web: nav.web, host: nav.url?.host?.replacingOccurrences(of: "www.", with: "") ?? "")
                .presentationDetents([.medium, .large])
        }
        // عدد ما تعذّر فحصه في الصفحة (لتلوين الزر فقط)
        .onReceive(Timer.publish(every: 4, on: .main, in: .common).autoconnect()) { _ in
            PageStatus.fetch(nav.web) { p in if let p, p.error != pageErrors { pageErrors = p.error } }
        }
    }

    private var addressField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).font(.footnote)
            TextField(tr("ابحث أو اكتب رابطًا", "Search or enter a link"), text: $address)
                .focused($editing)
                .keyboardType(.webSearch)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit(go)
                .environment(\.layoutDirection, .leftToRight)
                .multilineTextAlignment(.leading)
        }
        .padding(.horizontal, 10).frame(height: 34).frame(minWidth: 220)
        .background(.quaternary.opacity(0.5), in: Capsule())
    }

    private func go() {
        let t = address.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        let url = Platform.url(from: t)
            ?? URL(string: "https://www.google.com/search?q=" + (t.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? t))!
        nav.web?.load(URLRequest(url: url))
        editing = false
    }

    static func display(_ u: URL) -> String {
        guard let host = u.host else { return u.absoluteString }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    private var bottomBar: some View {
        HStack {
            barButton(tr("رجوع", "Back"), "chevron.backward") { nav.web?.goBack() }.disabled(!nav.canGoBack)
            Spacer()
            // يرجع لواجهة فلتر حصن (لا لرئيسية الموقع)
            barButton(tr("واجهة التطبيق", "App home"), "house") { dismiss() }
            Spacer()
            // حالة الحماية في هذه الصفحة: تنبيه برتقالي فقط حين يلزم إجراء (تعذّر فحص شيء، أو المحرك متعذّر)
            Button { showStatus = true } label: {
                HStack(spacing: 4) {
                    Image(systemName: needsAttention ? "exclamationmark.shield.fill" : "checkmark.shield.fill")
                    Text(needsAttention ? tr("تنبيه", "Check") : tr("محمي", "Protected")).font(.footnote.weight(.semibold))
                }
                .foregroundStyle(needsAttention ? Color.orange : Color.brand)
                .padding(.horizontal, 14).frame(height: 44)
                .background(.regularMaterial, in: Capsule())
            }
            .accessibilityLabel(tr("حالة الحماية هنا", "Protection here"))
            Spacer()
            barButton(tr("تحديث", "Reload"), "arrow.clockwise") { nav.web?.reload() }
        }
        .padding(.horizontal, 16).padding(.top, 6)
        .background(Color(uiColor: .systemBackground))
    }

    private func barButton(_ label: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.body.weight(.semibold))
                .frame(width: 44, height: 44)
                .background(.regularMaterial, in: Circle())
                .accessibilityLabel(label)
        }
    }
}

final class BrowserNav: ObservableObject {
    weak var web: WKWebView?
    @Published var canGoBack = false
    @Published var url: URL?
}

/// جلسات المتصفح المحمي الحيّة: صفحة المنصة تبقى في الذاكرة بعد الخروج منها (آخر منصتين)، فالرجوع إليها
/// فوري مثل التطبيق الأصلي بدل بناء المتصفح وتحميل الموقع من الصفر. تُهيّأ آخر منصة مسبقًا عند فتح التطبيق.
/// تغيّر الإعدادات يُدفع للصفحات الحيّة (__hisnPush)، وتغيّر المستخدم/وضع الطفل يُسقط الجلسات كلها.
final class BrowserSessions {
    static let shared = BrowserSessions()
    final class Session {
        let container: UIView
        let coordinator: ProtectedWeb.Coordinator
        let web: WKWebView
        let nav: BrowserNav
        var lastUsed = Date()
        init(container: UIView, coordinator: ProtectedWeb.Coordinator, web: WKWebView, nav: BrowserNav) {
            self.container = container; self.coordinator = coordinator; self.web = web; self.nav = nav
        }
    }
    private var sessions: [String: Session] = [:]
    private(set) var identity = ""
    let limit = 2

    private init() {
        // ضغط الذاكرة: نُسقط الجلسات غير المعروضة
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            for (k, s) in self.sessions where s.container.window == nil { self.drop(k); HisnLog.write("sessions: dropped \(k) (memory)") }
        }
    }

    /// بصمة ما يُبطل الجلسات (المستخدم، وضع الطفل، اللغة): لو تغيّرت تُهدم الجلسات وتُبنى من جديد
    static func currentIdentity() -> String {
        "\(HisnSettings.viewer.rawValue)|\(HisnSettings.childMode)|\(HisnSettings.childAge)|\(Lang.isEnglish)"
    }

    func nav(for key: String) -> BrowserNav { session(key)?.nav ?? BrowserNav() }

    func session(_ key: String) -> Session? {
        if identity != Self.currentIdentity() { dropAll() }
        return sessions[key]
    }

    func store(_ key: String, _ s: Session) {
        identity = Self.currentIdentity()
        sessions[key] = s
        s.lastUsed = Date()
        while sessions.count > limit, let oldest = sessions.min(by: { $0.value.lastUsed < $1.value.lastUsed }) {
            drop(oldest.key)
        }
    }

    func touch(_ key: String) { sessions[key]?.lastUsed = Date() }
    func contains(container: UIView) -> Bool { sessions.values.contains { $0.container === container } }

    func drop(_ key: String) {
        guard let s = sessions.removeValue(forKey: key) else { return }
        s.coordinator.engine?.stopLoading()
        s.web.stopLoading()
        s.web.configuration.userContentController.removeAllScriptMessageHandlers()
        s.container.removeFromSuperview()
    }

    func dropAll() { for k in Array(sessions.keys) { drop(k) } }

    /// يدفع الإعدادات الجديدة لكل صفحة حيّة (الصفحة لا تقرأ التخزين بنفسها)
    func pushSettings() {
        guard let data = try? JSONSerialization.data(withJSONObject: ["type": "hisn:settings-changed", "settings": HisnSettings.webSettings()]),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "globalThis.__hisnPush && globalThis.__hisnPush(\(Self.quote(json)))"
        for s in sessions.values { s.web.evaluateJavaScript(js, in: nil, in: .defaultClient) { _ in } }
    }

    static func quote(_ s: String) -> String {
        let d = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data()
        let arr = String(data: d, encoding: .utf8) ?? "[\"\"]"
        return String(arr.dropFirst().dropLast())
    }

    /// تهيئة مسبقة لمنصة (آخر ما فتحه المستخدم) حتى يكون فتحها فوريًا
    func warm(_ platform: Platform) {
        let key = platform.id
        guard session(key) == nil, !platform.free else { return }
        let nav = BrowserNav()
        let rep = ProtectedWeb(start: platform.url, nav: nav, desktop: platform.desktop, sessionKey: key)
        // نبني العرض خارج الشاشة بحجم الشاشة حتى يُحمّل الموقع بتخطيطه الصحيح
        let holder = UIView(frame: UIScreen.main.bounds)
        // التهيئة المسبقة لا تأخذ المسبار (يُربط بالصفحة التي يفتحها المستخدم)
        let view = rep.build(coordinator: ProtectedWeb.Coordinator(nav: nav), key: key, probe: false)
        view.frame = holder.bounds
        holder.addSubview(view)
        warmHolders[key] = holder
        HisnLog.write("sessions: warmed \(key)")
    }
    private var warmHolders: [String: UIView] = [:]
    func releaseWarmHolder(_ key: String) { warmHolders.removeValue(forKey: key) }
}

struct ProtectedWeb: UIViewRepresentable {
    let start: URL
    let nav: BrowserNav
    var desktop = false
    /// مفتاح الجلسة الحيّة (معرّف المنصة). nil = متصفح لا يُحتفظ به
    var sessionKey: String? = nil
    /// متصفح حاسوب (سفاري على ماك) للمواقع التي لا تقدّم نسخة جوال
    static let desktopUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

    /// نعرّف أنفسنا كـ Safari الجوال بنفس إصدار النظام الحقيقي (إصدار قديم يجعل المواقع تشك في الدخول).
    static let safariSuffix: String = {
        let v = UIDevice.current.systemVersion.split(separator: ".").prefix(2).joined(separator: ".")
        return "Version/\(v) Mobile/15E148 Safari/604.1"
    }()
    static let userAgent: String = {
        let v = UIDevice.current.systemVersion.replacingOccurrences(of: ".", with: "_")
        return "Mozilla/5.0 (iPhone; CPU iPhone OS \(v) like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " + safariSuffix
    }()

    /// أشرطة «افتح التطبيق» التي تدفع للخروج إلى التطبيق الأصلي.
    static let hideAppBanners = """
    ytm-mealbar-promo-renderer, .mealbar-promo-renderer, ytm-app-promo-renderer, .ytm-open-app-banner,
    [data-e2e="launch-app-btn"], [data-e2e="open-app-button"], [class*="DivOpenInAppContainer"], [class*="OpenInApp"],
    [class*="AppDownload"], [data-testid="open-app-banner"], .smart-app-banner, #smart-banner,
    a[href^="https://apps.apple.com"], a[href^="itms-apps:"] { display: none !important; }
    """

    func makeCoordinator() -> Coordinator { Coordinator(nav: nav) }

    func makeUIView(context: Context) -> UIView {
        if let key = sessionKey, let s = BrowserSessions.shared.session(key) {
            // جلسة حيّة: نعيد العرض نفسه (الصفحة محمّلة وجاهزة)
            BrowserSessions.shared.touch(key)
            BrowserSessions.shared.releaseWarmHolder(key)
            s.container.removeFromSuperview()
            HisnLog.write("sessions: reused \(key)")
            #if DEBUG
            DebugProbe.attach(s.web)
            #endif
            return s.container
        }
        return build(coordinator: context.coordinator, key: sessionKey)
    }

    /// يبني المتصفح (والمحرك) ويسجّله جلسة حيّة إن كان له مفتاح
    func build(coordinator c: Coordinator, key: String?, probe: Bool = true) -> UIView {
        let container = UIView()

        // محرك الكشف: صفحة حصن مخفية (نفس نماذج الإضافة) تُخدم من ملفات التطبيق
        let engineConfig = WKWebViewConfiguration()
        engineConfig.setURLSchemeHandler(WebFiles.shared, forURLScheme: WebFiles.scheme)
        let engine = WKWebView(frame: CGRect(x: 0, y: 0, width: 2, height: 2), configuration: engineConfig)
        engine.alpha = 0.01
        engine.isUserInteractionEnabled = false
        // إن أغلق النظام صفحة المحرك (ذاكرة) نعيد تشغيلها، والصور تبقى مغطاة حتى يُعاد فحصها
        engine.navigationDelegate = c.engineWatcher
        engine.load(URLRequest(url: ProtectedWeb.engineURL))
        c.engine = engine

        // الموقع: سكربت حصن في عالم معزول عن الموقع، والرسائل ترد عليها هذه الفئة
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // تشغيل المقاطع بصوتها مثل التطبيق الأصلي (بدونه يبدأ كل فيديو مكتومًا حتى يُلمس)
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = Self.safariSuffix
        let ucc = config.userContentController
        ucc.addScriptMessageHandler(c, contentWorld: .defaultClient, name: "hisn")
        let css = Self.hideAppBanners.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "`", with: "")
        // وأزرار «Open App / افتح التطبيق» بنصها (أسماء عناصرها تتغير)
        let hideScript = """
        (function(){
          var s=document.createElement('style');s.textContent=`\(css) [data-hisn-widened="1"]{width:100% !important;max-width:100% !important}`;(document.head||document.documentElement).appendChild(s);
          var re=/^\\s*(open app|open in app|get the app|use the app|open tiktok|افتح التطبيق|فتح التطبيق|استخدم التطبيق)\\s*$/i;
          var modal=/get the full app experience|enjoy more videos and great features on the app|watch on the app|continue in app|see more in the app|افتح تيك توك|احصل على التطبيق/i;
          function hide(e){ e.style.setProperty('display','none','important'); }
          function log(text){ try{ webkit.messageHandlers.hisn.postMessage({type:'hisn:log',text:'page: '+text}); }catch(e){} }
          // صفحة بيضاء بعد التحميل: نسجل السبب المحتمل (حجم الصفحة وما أخفيناه نحن)
          setTimeout(function(){ var t=(document.body&&document.body.innerText||'').trim(); if(t.length<20) log('blank page '+location.hostname+location.pathname.slice(0,40)+' html='+document.documentElement.outerHTML.length+' hiddenByUs='+(window.__hisnHidden||0)+' videos='+document.querySelectorAll('video').length); },5000);
          // عارض المقاطع في رسائل إنستغرام يحسب عرضه من الارتفاع (9:16) ويقصّ المحتوى بـ overflow:hidden؛ ارتفاع
          // صفحتنا أقل من الشاشة (شريط حصن) فيصير الصندوق أضيق من الشاشة وتُقص الأيقونات اليمنى. نعيده لعرض الشاشة.
          function fixNarrowViewer(){
            document.querySelectorAll('video').forEach(function(v){
              for(var e=v.parentElement,i=0;e&&i<14;e=e.parentElement,i++){
                var b=e.getBoundingClientRect(); if(b.height<innerHeight*0.6) continue;
                var cs=getComputedStyle(e);
                // كل عنصر في السلسلة أضيق من الشاشة (ولم يُعرّض بعد): وسمه، والقاعدة في ورقة الأنماط تغلب أي عرض يعيد إنستغرام ضبطه
                if(b.width<innerWidth-8&&b.width>innerWidth*0.6&&!e.dataset.hisnWidened){ e.dataset.hisnWidened='1'; log('widened viewer '+e.tagName+' '+Math.round(b.width)+'→'+innerWidth+' ox='+cs.overflowX); }
              }
            });
          }
          // يوتيوب كيدز يُفتح بواجهة الحاسوب (الجوال يُحوَّل عنه): تخطيطه 840 بكسل فأكثر، فنضبط إطار العرض ليُصغَّر على عرض الجوال بدل أن يُقص
          function fitKids(){
            if(!location.hostname.endsWith('youtubekids.com')) return;
            var m=document.querySelector('meta[data-hisn-viewport]');
            // عرض التخطيط الفعلي (صفحة الإعداد 1002، والصفحة الرئيسية ~840): نجعل إطار العرض بعرضه فتُصغَّر الصفحة كلها
            var w=Math.min(1100, Math.max(840, document.documentElement.scrollWidth||0));
            if(m&&m.dataset.w==String(w)) return;
            document.querySelectorAll('meta[name="viewport"]').forEach(function(x){ x.remove(); });
            m=document.createElement('meta'); m.name='viewport'; m.content='width='+w+', minimum-scale=0.3, user-scalable=yes'; m.dataset.hisnViewport='1'; m.dataset.w=String(w);
            (document.head||document.documentElement).appendChild(m); log('kids viewport fitted '+w);
          }
          function sweep(){
            // توسيع العارض خاص بالرسائل فقط؛ في الريلز يغيّر التخطيط فتقفز الخلاصة
            if(location.hostname.endsWith('instagram.com')&&location.pathname.indexOf('/direct/')===0) fixNarrowViewer();
            fitKids();
            document.querySelectorAll('a,button,[role="button"]').forEach(function(b){ if(re.test(b.textContent||'')) hide(b); });
            // نوافذ «جرّب التطبيق» التي تغطي الصفحة: نخفي النافذة وخلفيتها المعتمة، ونعيد التمرير
            document.querySelectorAll('div,section,p,h2,h3,span').forEach(function(t){
              if(t.children.length>6||!modal.test(t.textContent||'')||(t.textContent||'').length>220) return;
              var e=t; while(e&&e!==document.body){ var cs=getComputedStyle(e); if(cs.position==='fixed'||cs.position==='absolute'&&+cs.zIndex>=100){
                  // لا نخفي ما يحوي الصفحة نفسها (فيديو أو نص طويل): نافذة «جرّب التطبيق» صغيرة دائمًا
                  // نافذة «جرّب التطبيق» الحقيقية صغيرة (أقل من 60% من الشاشة) وبلا حقول إدخال. ما عدا ذلك (صفحة ملف شخصي فيها
                  // «Watch on the app»، نافذة تسجيل الدخول…) هو الصفحة نفسها ولا يُخفى — كان إخفاؤه يترك الشاشة بيضاء
                  var eb=e.getBoundingClientRect();
                  if(e.querySelector('video,input,form,iframe')||eb.width*eb.height>innerWidth*innerHeight*0.6||(e.textContent||'').length>600) break;
                  hide(e); window.__hisnModal=Date.now(); window.__hisnHidden=(window.__hisnHidden||0)+1;
                  if(window.__hisnHidden<=3) log('hid modal '+e.tagName+'.'+String(e.className||'').slice(0,40)+' text='+(t.textContent||'').trim().slice(0,40)); break; } e=e.parentElement; }
            });
            // خلفية النافذة المعتمة: تُخفى خلال ثوانٍ من إخفاء النافذة فقط، ولا تُخفى أبدًا إن كانت تحوي حقول إدخال أو نص تسجيل
            // (كانت تُخفي نافذة تسجيل الدخول في تيك توك فتبقى الصفحة بيضاء)
            if(!window.__hisnModal||Date.now()-window.__hisnModal>4000) return;
            var loginRe=/log in|login|sign up|signup|تسجيل|إنشاء حساب|phone|email|password/i;
            document.querySelectorAll('[class*="Mask"],[class*="mask"],[class*="Backdrop"],[class*="Overlay"]').forEach(function(m){ var cs=getComputedStyle(m); if(cs.position==='fixed'&&m.offsetWidth>=innerWidth*0.9&&m.offsetHeight>=innerHeight*0.9&&!m.querySelector('video,input,form,iframe')&&!loginRe.test((m.textContent||'').slice(0,400))) hide(m); });
            if(document.body&&getComputedStyle(document.body).overflow==='hidden') document.body.style.setProperty('overflow','auto','important');
          }
          sweep(); new MutationObserver(function(){ clearTimeout(window.__hisnSweep); window.__hisnSweep=setTimeout(sweep,300); }).observe(document.documentElement,{childList:true,subtree:true});
        })();
        """
        ucc.addUserScript(WKUserScript(source: hideScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
        if let src = WebFiles.text("content-app.js") {
            ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .defaultClient))
        }
        // في سياق صفحة يوتيوب نفسها (لا يعمل إلا هناك): يقرأ الترجمات ومسارات الصوت من مشغّل يوتيوب ويبدّلها بطلب حصن
        if let yt = WebFiles.text("yt-main.js") {
            let guarded = "if(/(^|\\.)youtube\\.com$/.test(location.hostname)){" + yt + "}"
            ucc.addUserScript(WKUserScript(source: guarded, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .page))
        }
        if desktop { config.defaultWebpagePreferences.preferredContentMode = .desktop }
        let web = WKWebView(frame: .zero, configuration: config)
        if desktop { web.customUserAgent = Self.desktopUserAgent }
        web.navigationDelegate = c
        web.allowsBackForwardNavigationGestures = true
        nav.web = web
        c.observe(web)

        web.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(engine)
        container.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            web.topAnchor.constraint(equalTo: container.topAnchor),
            web.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        // يوتيوب المقيّد: تفضيل يوتيوب الرسمي في الكوكي (للطفل أو المستوى المتوسط فما فوق)
        let settings = HisnSettings.webSettings()
        if settings["youtubeRestricted"] as? Bool == true, let cookie = HTTPCookie(properties: [
            .domain: ".youtube.com", .path: "/", .name: "PREF", .value: "f2=8000000",
            .secure: "TRUE", .expires: Date().addingTimeInterval(365 * 86400),
        ]) {
            // ننتظر الكوكي قبل التحميل، لكن لا نعلق إن لم يرد (يحدث في بعض نسخ iOS)
            var loaded = false
            let go = { if !loaded { loaded = true; web.load(URLRequest(url: start)) } }
            config.websiteDataStore.httpCookieStore.setCookie(cookie) { go() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { go() }
        } else {
            web.load(URLRequest(url: start))
        }
        #if DEBUG
        if probe { DebugProbe.attach(web) }
        #endif
        if let key { BrowserSessions.shared.store(key, BrowserSessions.Session(container: container, coordinator: c, web: web, nav: nav)) }
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

    static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) {
        // الجلسات الحيّة تبقى (تُهدم من BrowserSessions عند تجاوز الحد أو تغيّر الهوية)؛ غيرها يُغلق
        if BrowserSessions.shared.contains(container: uiView) {
            // الصفحة الحيّة لا تُسمع صوتًا في الخلفية
            for case let web as WKWebView in uiView.subviews where web.alpha > 0.5 {
                web.evaluateJavaScript("document.querySelectorAll('video,audio').forEach(function(v){v.pause()})", in: nil, in: .page) { _ in }
            }
            return
        }
        coordinator.engine?.stopLoading()
        for case let web as WKWebView in uiView.subviews {
            web.configuration.userContentController.removeAllScriptMessageHandlers()
        }
    }

    static let engineURL = URL(string: "\(WebFiles.scheme)://app/pages/detector-app.html")!

    /// يعيد تحميل صفحة المحرك إن أغلقها النظام.
    final class EngineWatcher: NSObject, WKNavigationDelegate {
        var onRestart: () -> Void = {}
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            onRestart()
            webView.load(URLRequest(url: ProtectedWeb.engineURL))
        }
    }

    final class Coordinator: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
        let nav: BrowserNav
        var engine: WKWebView?
        let engineWatcher = EngineWatcher()
        private var backObservation: NSKeyValueObservation?
        private var urlObservation: NSKeyValueObservation?
        /// جاهزية المحرك: تُنتظر مرة واحدة (تحميل النماذج)، وتُعاد إن أُعيد تشغيله.
        private var readyTask: Task<Bool, Never>?
        /// صورتان على الأكثر تُجلبان معًا (الذاكرة).
        private let fetchGate = Gate(limit: 2)

        init(nav: BrowserNav) {
            self.nav = nav
            super.init()
            engineWatcher.onRestart = { [weak self] in self?.readyTask = nil }
        }

        @MainActor
        private func engineReady() async -> Bool {
            if let t = readyTask { return await t.value }
            let t = Task { @MainActor [weak self] () -> Bool in
                // الصفحة قد لا تكون حُمّلت بعد: نحاول حتى 30 ثانية
                for _ in 0..<60 {
                    guard let engine = self?.engine else { return false }
                    if let r = try? await engine.callAsyncJavaScript("return window.__hisnReady ? JSON.stringify(await window.__hisnReady()) : null;",
                                                                        arguments: [:], in: nil, contentWorld: .page) as? String,
                       r.contains("\"ok\":true") { return true }
                    try? await Task.sleep(nanoseconds: 500_000_000)
                }
                return false
            }
            readyTask = t
            let ok = await t.value
            if !ok { readyTask = nil }
            return ok
        }

        func observe(_ web: WKWebView) {
            backObservation = web.observe(\.canGoBack, options: [.initial, .new]) { [weak self] w, _ in
                DispatchQueue.main.async { self?.nav.canGoBack = w.canGoBack }
            }
            urlObservation = web.observe(\.url, options: [.initial, .new]) { [weak self] w, _ in
                DispatchQueue.main.async { self?.nav.url = w.url }
            }
        }

        // ===== رسائل سكربت حصن في الصفحة =====

        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                                   replyHandler: @escaping (Any?, String?) -> Void) {
            guard let msg = message.body as? [String: Any], let type = msg["type"] as? String else { return replyHandler(nil, nil) }
            switch type {
            case "hisn:get-settings":
                replyHandler(Self.json(HisnSettings.webSettings()), nil)
            case "hisn:detect-image", "hisn:detect-frame", "hisn:detect-audio":
                let store = message.webView?.configuration.websiteDataStore.httpCookieStore
                Task { @MainActor in replyHandler(await self.detectMessage(msg, store: store), nil) }
            case "hisn:log":
                // تشخيص من سكربت الصفحة (بلا عناوين ولا محتوى): يُحفظ في سجل الجهاز فقط
                if let t = msg["text"] as? String { HisnLog.write("web: " + String(t.prefix(200))) }
                replyHandler(nil, nil)
            case "hisn:get-health":
                Task { @MainActor in
                    let ok = await self.engineReady()
                    replyHandler(Self.json(["overall": ok ? "ok" : "partial", "layers": ["images": ok ? "ready" : "failed"]]), nil)
                }
            case "hisn:prefetch-video":
                // تهيئة مبكرة: تحميل رأس الفيديو وأول لقطة قبل التشغيل (الفحص الأول يصبح نحو 100ms بدل ثانية)
                let store = message.webView?.configuration.websiteDataStore.httpCookieStore
                if let src = msg["src"] as? String {
                    // واحدًا تلو الآخر حتى لا تزاحم التهيئةُ الفحصَ الحقيقي للمقطع الجاري
                    let prev = Self.prefetchChain
                    let t = Task { @MainActor in
                        _ = await prev?.value
                        if Self.assets.contains(where: { $0.0 == src }) { return }
                        _ = await Self.videoFrames(src, times: [0], page: msg["page"] as? String, cookies: store, isPrefetch: true)
                        Self.prefetching.removeValue(forKey: src)
                    }
                    Self.prefetching[src] = t
                    Self.prefetchChain = t
                }
                replyHandler(Self.json(["ok": true]), nil)
            case "hisn:listen-video":
                // كتم الموسيقى بالسماع: يقرأ صوت أول ثوانٍ من رابط المقطع ويمرّره على YAMNet في الجهاز
                let store = message.webView?.configuration.websiteDataStore.httpCookieStore
                if let b64 = msg["data"] as? String, let key = msg["key"] as? String, let data = Data(base64Encoded: b64) {
                    // الصفحة جلبت البايتات بنفسها (يوتيوب)
                    Task { @MainActor in replyHandler(Self.json(await Self.listenVideo(data: data, key: key)), nil) }
                } else if let src = msg["src"] as? String, !src.isEmpty {
                    Task { @MainActor in replyHandler(Self.json(await Self.listenVideo(src, page: msg["page"] as? String, cookies: store)), nil) }
                } else {
                    replyHandler(Self.json(["error": "src"]), nil)
                }
            case "hisn:listen-pcm":
                // نافذة صوت جاهزة (16kHz، Int16 بـbase64) من محلّل الصفحة (يوتيوب): حكم YAMNet فورًا
                if let b64 = msg["pcm"] as? String, let data = Data(base64Encoded: b64), let yamnet = Self.yamnet {
                    Task.detached(priority: .userInitiated) {
                        let n = data.count / 2
                        var win = [Float](repeating: 0, count: NativeYamnet.window)
                        data.withUnsafeBytes { raw in
                            let p = raw.bindMemory(to: Int16.self)
                            for i in 0..<min(n, NativeYamnet.window) { win[i] = Float(Int16(littleEndian: p[i])) / 32768 }
                        }
                        var out: [String: Any] = ["music": false, "reason": "other"]
                        if let sc = yamnet.scores16(win) {
                            if NativeYamnet.isMusic(sc) { out = ["music": true, "reason": "instrument"] }
                            else if NativeYamnet.isVocalOnly(sc) { out = ["music": false, "reason": "vocal"] }
                            else { out = ["music": false, "reason": NativeYamnet.speechOf(sc) >= 0.5 ? "speech" : "other"] }
                        } else { out = ["error": "model"] }
                        let json = Self.json(out)
                        await MainActor.run { replyHandler(json, nil) }
                    }
                } else {
                    replyHandler(Self.json(["error": "pcm"]), nil)
                }
            case "hisn:cleanup-progress":
                Task { @MainActor in CleanupState.shared.receive(msg) }
                replyHandler(Self.json(["ok": true]), nil)
            case "hisn:activity":
                // أعداد + عبارات بحث يوتيوب في وضع الطفل (إن سمح الوالد): تُحفظ على الجهاز فقط ١٤ يومًا
                if HisnSettings.childMode {
                    Activity.record(hidden: msg["hidden"] as? Int ?? 0, stopped: msg["stopped"] as? Int ?? 0,
                                    searches: ((msg["searches"] as? [String]) ?? []).map { String($0.prefix(60)) })
                    let t = Activity.totals()
                    HisnLog.write("activity: +hidden \(msg["hidden"] as? Int ?? 0) +stopped \(msg["stopped"] as? Int ?? 0) searches \((msg["searches"] as? [String])?.count ?? 0) → 7d hidden \(t.hidden) stopped \(t.stopped) blocked \(t.blocked)")
                }
                replyHandler(Self.json(["ok": true]), nil)
            case "hisn:allow-channel":
                // زر «ولي الأمر: السماح بهذه القناة» في صفحة يوتيوب: بعد رمز صحيح في الصفحة خلال الدقائق الأخيرة (أو بلا قفل)
                let name = String((msg["name"] as? String ?? "").prefix(80)), handle = String((msg["handle"] as? String ?? "").prefix(80))
                let authorized = !HisnSettings.lockEnabled || Self.pageUnlockedUntil > Date()
                if authorized, !(name.isEmpty && handle.isEmpty) {
                    var list = HisnSettings.allowedChannels
                    if !list.contains(where: { $0["handle"] == handle && $0["name"] == name }) { list.append(["name": name, "handle": handle]) }
                    HisnSettings.allowedChannels = list
                    HisnLog.write("child: channel allowed by parent")
                    BrowserSessions.shared.pushSettings()
                    replyHandler(Self.json(["ok": true]), nil)
                } else {
                    replyHandler(Self.json(["ok": false, "error": "locked"]), nil)
                }
            case "hisn:report-verdict":
                // «سليمة دائمًا» / «إخفاء هذه الصورة»: تصحيح لهذه الصورة وحدها. «سليمة» تقلل الحماية فتطلب الرمز إن وُجد
                let key = msg["key"] as? String ?? "", verdict = msg["verdict"] as? String ?? ""
                guard Exceptions.isValidKey(key), verdict == "safe" || verdict == "unsafe" else { replyHandler(Self.json(["ok": false, "error": "invalid"]), nil); return }
                if verdict == "safe" && HisnSettings.lockEnabled && !HisnSettings.unlocked && !(Self.pageUnlockedUntil > Date()) {
                    replyHandler(Self.json(["ok": false, "error": "locked"]), nil); return
                }
                Exceptions.set(key, verdict, host: msg["host"] as? String ?? "", label: msg["label"] as? String ?? "")
                HisnLog.write("exceptions: image marked \(verdict)")
                BrowserSessions.shared.pushSettings()
                replyHandler(Self.json(["ok": true]), nil)
            case "hisn:request-review":
                // وضع الطفل: طلب مراجعة يُحفظ على الجهاز فقط ليراه الوالد؛ لا يفتح شيئًا
                guard HisnSettings.childMode else { replyHandler(Self.json(["ok": false, "error": "child-only"]), nil); return }
                ReviewRequests.add(key: msg["key"] as? String ?? "", host: msg["host"] as? String ?? "",
                                   label: msg["label"] as? String ?? "", page: msg["page"] as? String ?? "")
                HisnLog.write("child: review requested")
                replyHandler(Self.json(["ok": true]), nil)
            case "hisn:check-pin":
                // فحص الرمز هنا في التطبيق (الصفحة لا ترى البصمة)، بنفس عدّ المحاولات والتأخير
                switch Pin.attempt(msg["pin"] as? String ?? "") {
                case .ok: Self.pageUnlockedUntil = Date().addingTimeInterval(120); replyHandler(Self.json(["ok": true]), nil)
                case .wrong: replyHandler(Self.json(["ok": false, "error": "pin"]), nil)
                case .wait(let s): replyHandler(Self.json(["ok": false, "error": "wait", "wait": s]), nil)
                }
            case "hisn:unlock-status":
                replyHandler(Self.json(["locked": HisnSettings.lockEnabled, "unlocked": HisnSettings.unlocked,
                                        "until": HisnSettings.lockEnabled ? Int(HisnSettings.unlockedUntil.timeIntervalSince1970 * 1000) : 0]), nil)
            case "hisn:lock-now":
                Unlocks.revokeAll()
                replyHandler(Self.json(["ok": true]), nil)
            default:
                // رسالة غير معروفة: رفض صريح، لا موافقة افتراضية
                replyHandler(Self.json(["ok": false, "error": "unsupported"]), nil)
            }
        }

        /// لقطة فيديو لا تقرؤها الصفحة (من موقع آخر): يقرؤها التطبيق من رابط الفيديو بنفس جلسة المستخدم.
        /// لقطتان في طلب واحد (الآن وبعد نصف ثانية): التأكيد مرة واحدة بدل انتظار طلب ثانٍ، فيظهر المقطع أسرع.
        @MainActor
        private func detectMessage(_ msg: [String: Any], store: WKHTTPCookieStore?) async -> String? {
            var m = msg
            guard let v = m["videoSrc"] as? String else {
                let r = await detect(m)
                #if DEBUG
                if m["type"] as? String == "hisn:detect-frame" { DebugFrames.save(m["dataUrl"] as? String, r) }
                #endif
                return r
            }
            let t = m["time"] as? Double ?? 0
            // حرارة الجهاز مرتفعة (serious فأعلى): لقطة واحدة دائمًا، ونخبر الصفحة لتُبطئ وتيرة الفحص
            let thermal = ProcessInfo.processInfo.thermalState.rawValue
            // جهاز أقدم: لقطة واحدة لكل فحص دائمًا (نصف الحمل)؛ الحكم الثاني يأتي بالفحص التالي
            let single = ((m["single"] as? Bool) ?? false) || thermal >= 2 || HisnSettings.perfTier == "low"
            let imgs = await Self.videoFrames(v, times: single ? [t] : [t, t + 0.6], page: m["page"] as? String, cookies: store)
            if imgs.isEmpty { return Self.json(["error": "video-frame"]) }
            m.removeValue(forKey: "videoSrc")
            var out: [String: Any] = [:]
            for (k, img) in zip(["analysis", "analysis2"], imgs) {
                m["dataUrl"] = img
                guard let r = await detect(m),
                      let d = (try? JSONSerialization.jsonObject(with: Data(r.utf8))) as? [String: Any],
                      let a = d["analysis"] else { continue }
                out[k] = a
            }
            if out.isEmpty { return Self.json(["error": "detect"]) }
            out["thermal"] = thermal
            return Self.json(out)
        }

        /// يجلب الصورة إن لزم (التطبيق لا تقيّده قيود المواقع)، ثم يرسلها لصفحة المحرك.
        @MainActor
        private func detect(_ input: [String: Any]) async -> String? {
            // الصور والإطارات: بكود الآيفون (أسرع بكثير)، وإن تعذّر فبصفحة المحرك كما كان
            if input["type"] as? String != "hisn:detect-audio", let det = NativeDetector.shared {
                if let r = await detectNative(input, det) { return r }
            }
            var msg = input
            if let src = msg["src"] as? String, msg["dataUrl"] == nil {
                await fetchGate.enter()
                let dataUrl = await Self.fetchDataURL(src)
                await fetchGate.leave()
                guard let dataUrl else { return Self.json(["error": "fetch"]) }
                msg["dataUrl"] = dataUrl
                msg.removeValue(forKey: "src")
            }
            guard let engine, await engineReady() else { return nil }
            do {
                let r = try await engine.callAsyncJavaScript(
                    "return JSON.stringify(await window.__hisnDetect(m));",
                    arguments: ["m": msg], in: nil, contentWorld: .page)
                return r as? String
            } catch {
                return nil // المحرك يُحمَّل بعد: سكربت الصفحة يعيد المحاولة
            }
        }

        /** فحص بكود الآيفون، مع ذاكرة للنتائج حسب رابط الصورة. */
        @MainActor
        private func detectNative(_ input: [String: Any], _ det: NativeDetector) async -> String? {
            let src = input["src"] as? String
            let key = src.map { Self.cacheKey($0) }
            if let key, let hit = await NativeQueue.shared.cached(key) { return "{\"analysis\":\(hit)}" }
            var data: Data?
            if let src {
                await fetchGate.enter()
                data = await Self.fetchData(src)
                await fetchGate.leave()
                if data == nil { return Self.json(["error": "fetch"]) }
            } else if let url = input["dataUrl"] as? String, let comma = url.firstIndex(of: ",") {
                data = Data(base64Encoded: String(url[url.index(after: comma)...]))
            }
            guard let data, let img = Self.downscaled(data, maxSide: 768) else { return nil }
            guard let a = await NativeQueue.shared.analyze(img, detector: det) else { return nil }
            let json = Self.json(a)
            if let key { await NativeQueue.shared.store(key, json) }
            return "{\"analysis\":\(json)}"
        }

        /// آخر مقاطع فُتحت: لا نعيد قراءة رأس الملف من الشبكة في كل لقطة.
        @MainActor private static var assets: [(String, AVURLAsset)] = []
        /// آخر رمز صحيح أُدخل داخل صفحة (لزر السماح بالقناة): صلاحية قصيرة
        nonisolated(unsafe) static var pageUnlockedUntil = Date.distantPast
        @MainActor static var prefetchChain: Task<Void, Never>?
        /// تهيئة جارية لكل رابط: الفحص الحقيقي ينتظرها بدل أن يبدأ تحميلًا ثانيًا للملف نفسه
        @MainActor static var prefetching: [String: Task<Void, Never>] = [:]

        /// لقطات من الفيديو عند لحظات معينة (بلا تنزيل الملف كله: يقرأ النظام ما يلزم فقط).
        /// أحكام السماع المحفوظة (مسار المقطع ← موسيقى؟) حتى لا يُعاد تحليل مقطع مرّ من قبل
        @MainActor private static var ears: [String: [String: Any]] = [:]
        @MainActor private static var earOrder: [String] = []
        static let yamnet: NativeYamnet? = try? NativeYamnet()

        /// هل في أول ثوانٍ من هذا المقطع موسيقى؟ يقرأ المسار الصوتي من الرابط (كما تُقرأ اللقطات) ويحوّله إلى 16kHz
        /// ويمرّر نوافذ: ثلاثًا من البداية وواحدة عند الثانية 8. آلات أو موسيقى واضحة ← موسيقى؛ إنشاد/تلاوة/كلام بلا آلات ← لا.
        @MainActor
        static func listenVideo(_ src: String, page: String?, cookies: WKHTTPCookieStore?) async -> [String: Any] {
            guard let url = URL(string: src), let host = url.host else { return ["error": "src"] }
            // المفتاح: المسار (+ معامل id لروابط يوتيوب التي تتشارك المسار /videoplayback)
            let idParam = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "id" }?.value ?? ""
            let key = (url.scheme ?? "") + "://" + host + url.path + (idParam.isEmpty ? "" : "?id=" + idParam)
            if let hit = ears[key] { return hit }
            guard let yamnet else { return ["error": "model"] }
            let t0 = CFAbsoluteTimeGetCurrent()
            var headers = ["User-Agent": ProtectedWeb.userAgent]
            if let page { headers["Referer"] = page }
            if let all = await cookies?.allCookies() {
                let mine = all.filter { c in
                    let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
                    return host == d || host.hasSuffix("." + d)
                }
                if !mine.isEmpty { headers["Cookie"] = mine.map { "\($0.name)=\($0.value)" }.joined(separator: "; ") }
            }
            // قارئ الصوت لا يقرأ من الشبكة مباشرة: ننزّل أول ~0.9 ميغابايت (تكفي لأول ثوانٍ) إلى ملف مؤقت ونقرأ منه
            var req = URLRequest(url: url)
            req.setValue("bytes=0-900000", forHTTPHeaderField: "Range")
            for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("hisn-ear-\(UUID().uuidString).mp4")
            defer { try? FileManager.default.removeItem(at: tmp) }
            // سقف فعلي ~0.9 ميغابايت حتى لو تجاهل الخادم Range وأرسل المقطع كاملًا (200)
            guard let (data, resp) = await CappedFetch.get(req, limit: 900_001, truncateOK: true) else {
                HisnLog.write("ear: error fetch"); return ["error": "fetch"]
            }
            guard resp.statusCode == 200 || resp.statusCode == 206, data.count > 50_000 else {
                HisnLog.write("ear: error fetch status \(resp.statusCode) bytes \(data.count)"); return ["error": "fetch"]
            }
            do { try data.write(to: tmp) } catch { return ["error": "write"] }
            let local = AVURLAsset(url: tmp)
            // القراءة خارج الخيط الرئيسي، بمهلة حتى لا يعلّق مقطع بطيء
            let result: [String: Any]? = await withTaskGroup(of: [String: Any]?.self) { g in
                g.addTask { await Task.detached(priority: .utility) { Self.readAndJudge(local, yamnet: yamnet) }.value }
                g.addTask { try? await Task.sleep(nanoseconds: 8_000_000_000); return nil }
                let first = await g.next() ?? nil
                g.cancelAll()
                return first
            }
            var out = result ?? ["error": "timeout"]
            out["ms"] = Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)
            if out["error"] == nil {
                ears[key] = out; earOrder.append(key)
                if earOrder.count > 300 { ears.removeValue(forKey: earOrder.removeFirst()) }
            }
            HisnLog.write("ear: \(out["music"] as? Bool == true ? "music" : (out["error"] as? String).map { "error " + $0 } ?? "clean") \(out["reason"] as? String ?? "") \(out["detail"] as? String ?? "") windows=\(out["windows"] as? Int ?? 0) \(out["ms"] ?? 0)ms")
            return out
        }

        /// بايتات جاهزة (جلبتها الصفحة): تُكتب لملف مؤقت وتُحكم كما السابق
        @MainActor
        static func listenVideo(data: Data, key: String) async -> [String: Any] {
            if let hit = ears[key] { return hit }
            guard let yamnet else { return ["error": "model"] }
            let t0 = CFAbsoluteTimeGetCurrent()
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("hisn-ear-\(UUID().uuidString).mp4")
            defer { try? FileManager.default.removeItem(at: tmp) }
            do { try data.write(to: tmp) } catch { return ["error": "write"] }
            let local = AVURLAsset(url: tmp)
            let result: [String: Any]? = await withTaskGroup(of: [String: Any]?.self) { g in
                g.addTask { await Task.detached(priority: .utility) { Self.readAndJudge(local, yamnet: yamnet) }.value }
                g.addTask { try? await Task.sleep(nanoseconds: 8_000_000_000); return nil }
                let first = await g.next() ?? nil
                g.cancelAll()
                return first
            }
            var out = result ?? ["error": "timeout"]
            out["ms"] = Int((CFAbsoluteTimeGetCurrent() - t0) * 1000)
            if out["error"] == nil {
                ears[key] = out; earOrder.append(key)
                if earOrder.count > 300 { ears.removeValue(forKey: earOrder.removeFirst()) }
            }
            HisnLog.write("ear: \(out["music"] as? Bool == true ? "music" : (out["error"] as? String).map { "error " + $0 } ?? "clean") \(out["reason"] as? String ?? "") \(out["detail"] as? String ?? "") windows=\(out["windows"] as? Int ?? 0) \(out["ms"] ?? 0)ms bytes=\(data.count)")
            return out
        }

        /// يقرأ المسار الصوتي في [0, 4) و[8, 9) ثوانٍ كـ16kHz أحادي ويحكم بنوافذ YAMNet
        nonisolated private static func readAndJudge(_ asset: AVURLAsset, yamnet: NativeYamnet) -> [String: Any] {
            guard let track = asset.tracks(withMediaType: .audio).first else { return ["error": "no-audio"] }
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
            ]
            var note = ""
            func read(_ from: Double, _ to: Double) -> [Float] {
                let reader: AVAssetReader
                do { reader = try AVAssetReader(asset: asset) } catch { note = "reader \(error.localizedDescription.prefix(60))"; return [] }
                let out = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
                out.alwaysCopiesSampleData = false
                guard reader.canAdd(out) else { note = "cannot-add"; return [] }
                reader.add(out)
                reader.timeRange = CMTimeRange(start: CMTime(seconds: from, preferredTimescale: 600), end: CMTime(seconds: to, preferredTimescale: 600))
                guard reader.startReading() else { note = "start \(reader.error?.localizedDescription.prefix(60) ?? "?")"; return [] }
                var pcm: [Float] = []
                pcm.reserveCapacity(Int((to - from) * 16000) + 1024)
                while let sb = out.copyNextSampleBuffer() {
                    guard let bb = CMSampleBufferGetDataBuffer(sb) else { continue }
                    var len = 0, ptr: UnsafeMutablePointer<Int8>?
                    guard CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr) == kCMBlockBufferNoErr, let ptr else { continue }
                    let n = len / 4
                    ptr.withMemoryRebound(to: Float.self, capacity: n) { pcm.append(contentsOf: UnsafeBufferPointer(start: $0, count: n)) }
                    if pcm.count > Int((to - from) * 16000) + 16000 { break }
                }
                if pcm.isEmpty { note = "empty status=\(reader.status.rawValue) \(reader.error?.localizedDescription.prefix(60) ?? "")" }
                reader.cancelReading()
                return pcm
            }
            let head = read(0, 4), later = read(8, 9.2)
            if head.count < NativeYamnet.window { return ["error": "short", "detail": "\(head.count) \(note) dur=\(Int(asset.duration.seconds))s fmt=\(track.formatDescriptions.count)"] }
            var windows: [[Float]] = []
            var pos = 0
            while pos + NativeYamnet.window <= head.count && windows.count < 3 { windows.append(Array(head[pos..<pos + NativeYamnet.window])); pos += NativeYamnet.window }
            if later.count >= NativeYamnet.window { windows.append(Array(later[0..<NativeYamnet.window])) }
            var judged = 0, musical = 0, vocal = 0
            for w in windows {
                var peak: Float = 0
                for i in stride(from: 0, to: w.count, by: 8) { peak = max(peak, abs(w[i])) }
                if peak < 1e-3 { continue }
                guard let s = yamnet.scores16(w) else { continue }
                judged += 1
                if NativeYamnet.isMusic(s) { musical += 1 }
                else if NativeYamnet.isVocalOnly(s) { vocal += 1 }
            }
            if judged == 0 { return ["music": false, "reason": "silent", "windows": 0] }
            // نافذة موسيقية واحدة تكفي (الأغنية تبدأ غالبًا من أول ثانية)؛ الإنشاد والكلام يمرّان
            return ["music": musical >= 1, "reason": musical >= 1 ? "instrument" : (vocal > 0 ? "vocal" : "speech"), "windows": judged]
        }

        @MainActor
        static func videoFrames(_ src: String, times: [Double], page: String?, cookies: WKHTTPCookieStore?, isPrefetch: Bool = false) async -> [String] {
            guard let url = URL(string: src), url.scheme == "https" || url.scheme == "http", let host = url.host else { return [] }
            let tStart = CFAbsoluteTimeGetCurrent()
            if !isPrefetch, let t = prefetching[src] { _ = await t.value }
            let asset: AVURLAsset
            if let hit = assets.first(where: { $0.0 == src })?.1 {
                asset = hit
            } else {
                var headers = ["User-Agent": ProtectedWeb.userAgent]
                if let page { headers["Referer"] = page }
                if let all = await cookies?.allCookies() {
                    let mine = all.filter { c in
                        let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
                        return host == d || host.hasSuffix("." + d)
                    }
                    if !mine.isEmpty { headers["Cookie"] = mine.map { "\($0.name)=\($0.value)" }.joined(separator: "; ") }
                }
                asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
                assets.insert((src, asset), at: 0)
                if assets.count > 8 { assets.removeLast() }
            }
            let gen = AVAssetImageGenerator(asset: asset)
            gen.appliesPreferredTrackTransform = true
            gen.maximumSize = CGSize(width: 768, height: 768)
            gen.requestedTimeToleranceBefore = CMTime(seconds: 0.3, preferredTimescale: 600)
            gen.requestedTimeToleranceAfter = CMTime(seconds: 0.3, preferredTimescale: 600)
            let cgs: [CGImage] = await withTaskGroup(of: [CGImage]?.self) { g in
                g.addTask {
                    var out: [CGImage] = []
                    for t in times {
                        guard let img = try? await gen.image(at: CMTime(seconds: max(0, t), preferredTimescale: 600)).image else { break }
                        out.append(img)
                    }
                    return out
                }
                g.addTask { try? await Task.sleep(nanoseconds: 6_000_000_000); return nil }
                let first = await g.next() ?? nil
                g.cancelAll(); gen.cancelAllCGImageGeneration()
                return first ?? []
            }
            if cgs.isEmpty { assets.removeAll { $0.0 == src } }
            #if DEBUG
            HisnLog.write("frame: \(cgs.count) frames in \(Int((CFAbsoluteTimeGetCurrent() - tStart) * 1000))ms host=\(host) cached=\(assets.first?.0 == src)")
            #endif
            return cgs.compactMap { cg in
                UIImage(cgImage: cg).jpegData(compressionQuality: 0.85).map { "data:image/jpeg;base64,\($0.base64EncodedString())" }
            }
        }

        static func cacheKey(_ src: String) -> String {
            let digest = SHA256.hash(data: Data(("v2|" + src).utf8))
            return digest.prefix(16).map { String(format: "%02x", $0) }.joined()
        }

        static func fetchData(_ src: String) async -> Data? {
            guard let url = URL(string: src), url.scheme == "https" || url.scheme == "http" else { return nil }
            var req = URLRequest(url: url, timeoutInterval: 12)
            req.setValue(ProtectedWeb.userAgent, forHTTPHeaderField: "User-Agent")
            guard let (data, _) = await CappedFetch.get(req, limit: 12 << 20) else { return nil }
            return data
        }

        static func downscaled(_ data: Data, maxSide: Int) -> CGImage? {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            let opts: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxSide,
                kCGImageSourceShouldCacheImmediately: true,
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary)
        }

        static func fetchDataURL(_ src: String) async -> String? {
            guard let url = URL(string: src), url.scheme == "https" || url.scheme == "http" else { return nil }
            var req = URLRequest(url: url, timeoutInterval: 12)
            req.setValue(ProtectedWeb.userAgent, forHTTPHeaderField: "User-Agent")
            guard let (data, _) = await CappedFetch.get(req, limit: 12 << 20) else { return nil }
            // نفك الصورة بالنظام (يقرأ WebP وAVIF وHEIC) ونصغّرها إلى JPEG: صفحة المحرك لا تفشل في صيغة
            // لا تعرفها، والذاكرة أقل بكثير
            guard let jpeg = downscaledJPEG(data) else { return nil }
            return "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
        }

        static func downscaledJPEG(_ data: Data, maxSide: Int = 1024) -> Data? {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            let opts: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxSide,
                kCGImageSourceShouldCacheImmediately: true,
            ]
            guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary) else { return nil }
            return UIImage(cgImage: cg).jpegData(compressionQuality: 0.85)
        }

        static func json(_ v: Any) -> String {
            String(data: (try? JSONSerialization.data(withJSONObject: v)) ?? Data("null".utf8), encoding: .utf8) ?? "null"
        }

        // ===== التنقل: حجب المواقع، والبحث الآمن =====

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            // لا خروج من حصن إلى التطبيق الأصلي أو متجر التطبيقات
            let scheme = url.scheme?.lowercased() ?? ""
            if !["http", "https", "about", "data", "blob"].contains(scheme) || url.host?.lowercased() == "apps.apple.com" {
                return decisionHandler(.cancel)
            }
            guard let host = url.host?.lowercased() else { return decisionHandler(.allow) }
            if action.targetFrame?.isMainFrame != false, Blocklist.shared.isAdult(host) {
                decisionHandler(.cancel)
                webView.loadHTMLString(Self.blockedPage, baseURL: nil)
                return
            }
            // خدمات بث مشفّرة (نتفلكس وأخواتها): الفيديو لا يُقرأ فلا يُفحص — لا تُفتح من حصن أصلًا
            if action.targetFrame?.isMainFrame != false, Blocklist.shared.isStreaming(host) {
                decisionHandler(.cancel)
                webView.loadHTMLString(Self.blockedPage(streaming: true), baseURL: nil)
                return
            }
            // وضع الطفل مع «المواقع المسموحة فقط»: ما ليس في قائمة التطبيقات (أو نطاقاتها المرافقة) يُحجب
            if action.targetFrame?.isMainFrame != false, HisnSettings.childMode, HisnSettings.allowedSitesOnly, !Platform.isAllowedHost(host) {
                decisionHandler(.cancel)
                HisnLog.write("child: blocked host not in allowed list \(host)")
                Activity.record(blocked: 1)
                webView.loadHTMLString(Self.blockedPage(kind: "notAllowed"), baseURL: nil)
                return
            }
            // أقل من 13: أي رابط يوتيوب عام يتحوّل إلى يوتيوب كيدز (لا يُحتال عليه برابط مباشر).
            // موقع يوتيوب كيدز يعمل بهوية حاسوب فقط، فنثبّتها على هذا المتصفح قبل التحويل
            if action.targetFrame?.isMainFrame != false, HisnSettings.youtubeToKids,
               host == "youtube.com" || host.hasSuffix(".youtube.com") || host == "youtu.be" || host.hasSuffix("youtubekids.com") {
                if webView.customUserAgent != ProtectedWeb.desktopUserAgent { webView.customUserAgent = ProtectedWeb.desktopUserAgent }
                if !host.hasSuffix("youtubekids.com") {
                    decisionHandler(.cancel)
                    webView.load(URLRequest(url: URL(string: "https://www.youtubekids.com")!))
                    return
                }
            }
            if action.targetFrame?.isMainFrame != false, let safe = SafeSearch.rewrite(url), safe != url {
                decisionHandler(.cancel)
                webView.load(URLRequest(url: safe))
                return
            }
            decisionHandler(.allow)
        }

        static var blockedPage: String { blockedPage(streaming: false) }
        static func blockedPage(streaming: Bool) -> String { blockedPage(kind: streaming ? "streaming" : "adult") }

        static func blockedPage(kind: String) -> String {
            let en = Lang.isEnglish
            let why: String
            switch kind {
            case "streaming":
                why = en ? "This is an encrypted streaming service: the device prevents reading its video, so Hisn cannot check it. It does not open from Hisn."
                         : "خدمة بث مشفّرة: الجهاز يمنع قراءة الفيديو فلا يستطيع حصن فحص محتواها، لذلك لا تُفتح من حصن."
            case "notAllowed":
                why = en ? "This site is not in the allowed apps list. Ask a parent to add it from the Hisn home screen."
                         : "هذا الموقع ليس في قائمة التطبيقات المسموحة. اطلب من ولي الأمر إضافته من شاشة حصن الرئيسية."
            default:
                why = "﴿قُل لِّلْمُؤْمِنِينَ يَغُضُّوا مِنْ أَبْصَارِهِمْ﴾"
            }
            return """
            <!doctype html><html dir="\(en ? "ltr" : "rtl")" lang="\(en ? "en" : "ar")"><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;background:#f7f5fb;color:#2e164f;text-align:center;padding:24px">
            <div><div style="font-size:56px">🛡️</div><h2>\(en ? "Hisn blocked this site" : "حجب حصن هذا الموقع")</h2>
            <p style="color:#667085">\(why)</p></div></body></html>
            """
        }
    }
}

/// ملفات صفحات حصن داخل التطبيق (مجلد web) بعنوان hisn://app/، مع عزل الصفحة (خيوط متعددة للنماذج).
final class WebFiles: NSObject, WKURLSchemeHandler {
    static let scheme = "hisn"
    static let shared = WebFiles()
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true).standardizedFileURL

    static func text(_ path: String) -> String? {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("web/\(path)") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app" else { return fail(task, 403) }
        let path = url.path
        let file = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL
        guard !path.contains(".."), file.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return fail(task, 404) }
        let headers = CleanVideoWeb.Coordinator.isolation.merging([
            "Content-Type": CleanVideoWeb.Coordinator.mime(file.pathExtension),
            "Content-Length": String(data.count),
        ]) { a, _ in a }
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, _ code: Int) {
        guard let url = task.request.url else { return }
        task.didReceive(HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: nil)!)
        task.didFinish()
    }
}

/// قائمة المواقع الإباحية (نفس قائمة الإضافة)، تُحمّل مرة واحدة.
final class Blocklist {
    static let shared = Blocklist()
    private lazy var adult: Set<String> = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("web/rules/adult-domains.json"),
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = obj["domains"] as? [String] else { return [] }
        return Set(list)
    }()

    private lazy var streaming: Set<String> = Self.load("web/rules/streaming-domains.json")

    private static func load(_ path: String) -> Set<String> {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent(path),
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = obj["domains"] as? [String] else { return [] }
        return Set(list)
    }

    /// الموقع نفسه أو أي نطاق أعلى منه في القائمة.
    func isAdult(_ host: String) -> Bool { matches(host, adult) }
    /// خدمة بث مشفّرة لا يمكن فحصها (نتفلكس، شاهد، OSN…)
    func isStreaming(_ host: String) -> Bool { matches(host, streaming) }

    private func matches(_ host: String, _ set: Set<String>) -> Bool {
        var parts = host.split(separator: ".").map(String.init)
        while parts.count >= 2 {
            if set.contains(parts.joined(separator: ".")) { return true }
            parts.removeFirst()
        }
        return false
    }
}

/// البحث الآمن في قوقل وبنج (مثل قواعد الإضافة).
enum SafeSearch {
    static func rewrite(_ url: URL) -> URL? {
        guard var c = URLComponents(url: url, resolvingAgainstBaseURL: false), let host = c.host?.lowercased() else { return nil }
        var items = c.queryItems ?? []
        func force(_ key: String, _ value: String) -> URL? {
            if items.first(where: { $0.name == key })?.value == value { return url }
            items.removeAll { $0.name == key }
            items.append(URLQueryItem(name: key, value: value))
            c.queryItems = items
            return c.url
        }
        if host.range(of: #"(^|\.)google\.[a-z.]+$"#, options: .regularExpression) != nil, c.path.hasPrefix("/search") { return force("safe", "active") }
        if host.hasSuffix("bing.com"), c.path.hasPrefix("/search") || c.path.hasPrefix("/images") { return force("adlt", "strict") }
        return nil
    }
}

/// يسمح بعدد محدود من المهام في الوقت نفسه.
actor Gate {
    private let limit: Int
    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []
    init(limit: Int) { self.limit = limit }
    func enter() async {
        if running < limit { running += 1; return }
        await withCheckedContinuation { waiting.append($0) }
    }
    func leave() {
        if waiting.isEmpty { running -= 1 } else { waiting.removeFirst().resume() }
    }
}

#if DEBUG
/// تجربة آلية من الماك (-hisnOpen <منصة> -hisnProbe): كل 8 ثوانٍ يسجّل حالة المقاطع في الصفحة ثم ينتقل للتالي.
enum DebugProbe {
    static var probed = false
    static func attach(_ web: WKWebView) {
        guard ProcessInfo.processInfo.arguments.contains("-hisnProbe") else { return }
        // التجربة الآلية تضغط «التالي» وتمرر الصفحة: لا تعمل إلا في أول صفحة بعد التشغيل، ولا تمس تصفح المستخدم
        guard !probed else { return }
        probed = true
        // اختبار القفل داخل المتصفح المحمي: رمز 1234 مؤقت، محاولات خاطئة ثم الصحيح، ثم يُزال الرمز
        if ProcessInfo.processInfo.arguments.contains("-hisnLockTest") {
            let h = Pin.hash("1234")
            HisnSettings.pinHash = h.hash; HisnSettings.pinSalt = h.salt
            HisnSettings.unlockedUntil = .distantPast
            AppGroup.defaults.set(0, forKey: "pinFails"); AppGroup.defaults.removeObject(forKey: "pinWaitUntil")
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak web] in
                let js = """
                (async () => { const h=webkit.messageHandlers.hisn; const out={};
                  out.settings=(await h.postMessage({type:'hisn:get-settings'}));
                  out.wrong=[]; for (let i=0;i<4;i++) out.wrong.push(await h.postMessage({type:'hisn:check-pin',pin:'0000'}));
                  out.right=await h.postMessage({type:'hisn:check-pin',pin:'1234'});
                  out.unknown=await h.postMessage({type:'hisn:whatever'});
                  out.status=await h.postMessage({type:'hisn:unlock-status'});
                  return JSON.stringify(out); })()
                """
                Task { @MainActor in
                    let r = try? await web?.callAsyncJavaScript("return await (" + js + ");", arguments: [:], in: nil, contentWorld: .defaultClient)
                    HisnLog.write("locktest: " + String(String(describing: r).prefix(900)))
                    HisnSettings.pinHash = nil; HisnSettings.pinSalt = nil
                    AppGroup.defaults.set(0, forKey: "pinFails"); AppGroup.defaults.removeObject(forKey: "pinWaitUntil")
                }
            }
        }
        var n = 0
        Timer.scheduledTimer(withTimeInterval: 8, repeats: true) { [weak web] t in
            let ticks = ProcessInfo.processInfo.arguments.contains("-hisnProbeLong") ? 40 : 12 // الطويل: ٥ دقائق لقياس الحرارة
            guard let web, n < ticks else { t.invalidate(); return }
            n += 1
            let clickFirst = ProcessInfo.processInfo.arguments.contains("-hisnClickFirst")
            // -hisnTap "css|نص;;css|نص": ضغطات متتابعة (واحدة كل دورتين) للوصول لصفحة داخلية — للقياس فقط
            let args = ProcessInfo.processInfo.arguments
            let taps: [String] = args.firstIndex(of: "-hisnTap").flatMap { i in i + 1 < args.count ? args[i + 1].components(separatedBy: ";;") : nil } ?? []
            let tapsJSON = (try? JSONSerialization.data(withJSONObject: taps)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
            let js = """
            (() => { const CLICKFIRST=\(clickFirst); const n=\(n); const v=[...document.querySelectorAll('video')]; const c={};
              v.forEach(x=>{const s=x.getAttribute('data-hisn')||'none'; c[s]=(c[s]||0)+1;});
              const r={host:location.hostname, layout:{iw:innerWidth,ih:innerHeight,sw:document.documentElement.scrollWidth,bw:document.body?.scrollWidth,vw:visualViewport?.width,vh:visualViewport?.height,dpr:devicePixelRatio,sx:scrollX,wide:[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect();return b.right>innerWidth+2&&b.width>40}).slice(0,4).map(e=>e.tagName+'.'+String(e.className||'').slice(0,25)+'@'+Math.round(e.getBoundingClientRect().right))},
                cost:document.documentElement.dataset.hisnCost||null, adsHidden:document.querySelectorAll('[data-hisn-ad="hidden"],[data-hisn-ad="folded"]').length, posts:document.querySelectorAll('article').length, docH:document.documentElement.scrollHeight, adLabelsVisible:[...document.querySelectorAll('span,div,a')].filter(e=>e.children.length<=1&&e.offsetParent&&/^(Sponsored|Ad|ممول|إعلان)$/.test((e.textContent||'').trim())).length, unmuted:document.querySelectorAll('video[data-hisn-unmuted]').length, trackChip:document.querySelector('.hisn-track-chip button')?.textContent||null, trackItems:document.querySelectorAll('.hisn-track-menu button').length,
                videos:v.length, states:c, muted:v.filter(x=>x.muted).length,
                playing:v.filter(x=>!x.paused).length, songBadges:document.querySelectorAll('.hisn-song-badge').length,
                imgs:document.querySelectorAll('img[data-hisn]').length,
                imgStates:[...document.querySelectorAll('img[data-hisn]')].reduce((a,x)=>{const s=x.getAttribute('data-hisn');a[s]=(a[s]||0)+1;return a;},{}),
                srcs:[...new Set(v.map(x=>(x.currentSrc||'').split(':')[0]))],
                topicHidden:document.querySelectorAll('[data-hisn-topic=hidden]').length,
                hiddenTitles:[...document.querySelectorAll('[data-hisn-topic=hidden]')].filter(e=>!e.parentElement?.closest('[data-hisn-topic=hidden]')).slice(0,14).map(e=>((e.querySelector('h3,h4,.media-item-headline,[class*="title"]')?.textContent||e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,48))+(e.dataset.hisnFlagged?' ⟨'+e.dataset.hisnFlagged+'⟩':'')),
                url:location.href.slice(0,120), text:(document.body?.innerText||'').replace(/[ \\t\\n\\r]+/g,' ').slice(0,300), ua:navigator.userAgent,
                chains:[...document.querySelectorAll('h3,h4,[class*=title]')].filter(e=>!e.closest('[data-hisn-topic]')&&e.offsetParent&&/hallow|هالو/i.test(e.textContent)).slice(0,3).map(e=>{const c=[];for(let p=e;p&&c.length<12;p=p.parentElement)c.push(p.tagName.toLowerCase()+(p.className&&typeof p.className==='string'?'.'+p.className.split(' ')[0]:''));return c.join('<');}),
                                visibleTitles:[...document.querySelectorAll('h3,h4,[class*=title]')].filter(e=>!e.closest('[data-hisn-topic]')&&e.offsetParent).map(e=>e.textContent.trim().slice(0,40)).filter(Boolean).slice(0,8)};
              const REELS=\(ProcessInfo.processInfo.arguments.contains("-hisnReels"));
              r.coverBoxes=[...document.querySelectorAll('.hisn-cover-box')].map(b=>{const q=b.getBoundingClientRect();return [Math.round(q.left),Math.round(q.top),Math.round(q.width),Math.round(q.height),b.style.display];});
              if(REELS){
                // تشخيص «نط» الريلز: تشغيل المقطع الظاهر مكتومًا، ومراقبة قفزات التمرير مع آخر تعديلاتنا على الصفحة قبلها
                if(!window.__hisnReels){
                  const st={jumps:[],muts:[],adds:0,removes:0,last:null,scroller:null};
                  window.__hisnReels=st;
                  const mo=new MutationObserver(ms=>{ for(const m of ms){ if(m.type==='attributes'){ const a=m.attributeName||''; const t=m.target; if(/^data-hisn|^style$|^class$/.test(a)&&(a.startsWith('data-hisn')||t.hasAttribute?.('data-hisn')||t.className?.toString?.().includes?.('hisn'))) st.muts.push({t:performance.now(),a,tag:t.tagName,v:(t.getAttribute(a)||'').slice(0,40)}); } else { for(const x of m.addedNodes) if(x.tagName==='VIDEO'||x.querySelector?.('video')) st.adds++; for(const x of m.removedNodes) if(x.tagName==='VIDEO'||x.querySelector?.('video')) st.removes++; } } if(st.muts.length>400) st.muts.splice(0,st.muts.length-400); });
                  mo.observe(document.documentElement,{attributes:true,subtree:true,childList:true,attributeFilter:['data-hisn','data-hisn-ad','data-hisn-topic','data-hisn-widened','data-hisn-fold','style','class']});
                  document.addEventListener('scroll',e=>{ const el=e.target===document?document.scrollingElement:e.target; if(!el||!el.querySelector?.('video')) return; const top=el.scrollTop, now=performance.now(); if(st.scroller!==el){ st.scroller=el; st.last={top,now}; return; } const d=top-st.last.top; if(Math.abs(d)>120&&now-st.last.now<400){ const recent=st.muts.filter(m=>now-m.t<1500).map(m=>m.a+':'+m.tag+'='+m.v).slice(-6); st.jumps.push({at:Math.round(now),d:Math.round(d),recent,adds:st.adds,removes:st.removes}); if(st.jumps.length>20) st.jumps.shift(); } st.last={top,now}; },true);
                }
                const vis=v.find(x=>{const b=x.getBoundingClientRect(); return b.height>innerHeight*0.5&&b.top<innerHeight*0.5&&b.bottom>innerHeight*0.5;});
                if(vis&&vis.paused){ vis.muted=true; vis.play().catch(()=>{}); }
                const st=window.__hisnReels; const sc=document.scrollingElement; st.tops=st.tops||[]; st.tops.push(Math.round(sc.scrollTop));
                // «سحبة» واحدة بارتفاع ريل كامل في الدورتين 4 و8 (كما يفعل المستخدم) ثم نراقب: هل يثبت أم يرتدّ؟
                if((n===4||n===8)&&vis){ sc.scrollTop+=Math.round(vis.getBoundingClientRect().height); st.swipes=(st.swipes||0)+1; }
                r.reels={jumps:st.jumps,tops:st.tops,swipes:st.swipes||0,muts:st.muts.length,adds:st.adds,removes:st.removes,scroller:st.scroller?st.scroller.tagName+'.'+String(st.scroller.className).slice(0,20):null,scrollTop:Math.round(sc.scrollTop),vis:vis?(vis.getAttribute('data-hisn')||'none')+'@'+Math.round(vis.getBoundingClientRect().top):null};
                return JSON.stringify(r);
              } else {
              const nx=[...document.querySelectorAll('button,[role=button]')].find(b=>/next|down|التالي/i.test((b.getAttribute('aria-label')||'')+(b.getAttribute('data-e2e')||'')));
              r.next=!!nx; if(nx) nx.click();
              ['keydown','keyup'].forEach(t=>document.dispatchEvent(new KeyboardEvent(t,{key:'ArrowDown',code:'ArrowDown',keyCode:40,bubbles:true})));
              }
              r.title=(document.querySelector('[data-e2e*=desc],[data-e2e*=title]')?.textContent||'').slice(0,60);
              r.e2e=[...new Set([...document.querySelectorAll('[data-e2e]')].map(e=>e.getAttribute('data-e2e')))].slice(0,60);
              r.soundish=[...document.querySelectorAll('a,span,div,p,marquee,h4')].filter(e=>e.children.length<3&&/original sound|الصوت الأصلي|♬|♪|sound|music/i.test(e.textContent||'')&&(e.textContent||'').length<120).slice(0,6).map(e=>e.tagName+'|'+(e.getAttribute('data-e2e')||'')+'|'+(e.className&&typeof e.className==='string'?e.className.slice(0,50):'')+'|'+(e.textContent||'').trim().slice(0,50));
              r.html=document.documentElement.outerHTML.length; r.frames=document.querySelectorAll('iframe').length;
              // تجربة تسجيل الدخول ببريد وهمي غير موجود: هل يرفض قوقل المتصفح أم يرد «الحساب غير موجود»؟
              r.inputs=[...document.querySelectorAll('input')].map(i=>i.type+'|'+(i.name||'')+'|'+(i.id||'')+'|'+(i.getAttribute('aria-label')||'')+'|'+(i.offsetParent?1:0)).slice(0,8);
              r.buttons=[...document.querySelectorAll('button')].map(b=>b.textContent.trim().slice(0,20)).filter(Boolean).slice(0,8);
              if(location.hostname==='accounts.google.com' && !window.__hisnTried){ const i=document.querySelector('input[type=email],input[name=identifier],input[autocomplete=username]'); if(i){ window.__hisnTried=1; i.focus(); i.value='hisn.probe.'+Date.now()+'@gmail.com'; i.dispatchEvent(new Event('input',{bubbles:true})); setTimeout(()=>{ const b=[...document.querySelectorAll('button')].find(b=>/^next$|التالي/i.test(b.textContent.trim())); b&&b.click(); },500); r.tried=1; } }
              // تجربة: فتح أول نتيجة فيديو في يوتيوب ثم مراقبة المقطع نفسه (لا الصورة المصغرة)
              const TAPS=\(tapsJSON); const ti=Math.floor((n-2)/2); if(n>=2&&n%2===0&&TAPS[ti]&&!window['__hisnTap'+ti]){ const [css,txt]=TAPS[ti].split('|'); const el=[...document.querySelectorAll(css)].find(e=>!txt||(e.textContent||'').includes(txt)); if(el){ window['__hisnTap'+ti]=1; r.tapped=ti+':'+(el.getAttribute('href')||el.tagName).slice(0,60); const b=el.getBoundingClientRect(); const cx=b.left+b.width/2, cy=b.top+b.height/2; const tgt=document.elementFromPoint(cx,cy)||el; r.tapTarget=tgt.tagName+'.'+String(tgt.className||'').slice(0,20); const o={bubbles:true,cancelable:true,clientX:cx,clientY:cy,pointerId:1,isPrimary:true}; try{ const tc=new Touch({identifier:1,target:tgt,clientX:cx,clientY:cy,pageX:cx,pageY:cy}); for(const t of ['touchstart','touchend']) tgt.dispatchEvent(new TouchEvent(t,{bubbles:true,cancelable:true,touches:t==='touchstart'?[tc]:[],changedTouches:[tc]})); }catch(e){ r.touchErr=String(e).slice(0,40); } for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']) tgt.dispatchEvent(t.startsWith('pointer')?new PointerEvent(t,o):new MouseEvent(t,o)); } else r.tapMiss=ti+':'+css; }
              if(CLICKFIRST&&n>=2&&!window.__hisnClicked){ const a=document.querySelector('ytm-video-with-context-renderer a[href*="/watch"],ytm-compact-video-renderer a[href*="/watch"],a[href*="/watch?v="]'); if(a){ window.__hisnClicked=1; r.clicked=a.getAttribute('href').slice(0,40); a.click(); } }
              if(location.pathname==='/watch'){ const v=document.querySelector('video'); r.watch={t:Math.round(v?.currentTime||0),state:v?.getAttribute('data-hisn'),partial:document.querySelectorAll('.hisn-partial,[data-hisn-partial]').length,title:document.title.slice(0,50)}; return JSON.stringify(r); }
              r.links=[...document.querySelectorAll('a[href*="/reel"],a[href*="/p/"]')].slice(0,5).map(a=>a.getAttribute('href').slice(0,50));
              const pv=v.find(x=>!x.paused)||v[0]; if(pv){ const rr=e=>{const b=e.getBoundingClientRect(); const cs=getComputedStyle(e); return e.tagName+(e.getAttribute('role')?'#'+e.getAttribute('role'):'')+' l='+Math.round(b.left)+' w='+Math.round(b.width)+' h='+Math.round(b.height)+' ox='+cs.overflowX+' pos='+cs.position+' tf='+(cs.transform==='none'?'-':cs.transform.slice(0,30))+' W='+cs.width+' MW='+cs.maxWidth;}; r.chain=[]; for(let e=pv,i=0;e&&i<14;e=e.parentElement,i++) r.chain.push(rr(e)); }
              if(TAPS.length){ r.buttons=[...document.querySelectorAll('div[role="button"],[role="link"]')].filter(e=>e.offsetParent).slice(-24).map(e=>((e.getAttribute('aria-label')||'')+'~'+(e.textContent||'').trim().slice(0,24)+'~'+(e.querySelector('img')?.alt||'').slice(0,20)+'~'+Math.round(e.getBoundingClientRect().width))); return JSON.stringify(r); } // مع الضغطات لا نمرر الصفحة
              window.scrollBy(0, innerHeight);
              document.querySelectorAll('*').forEach(e=>{ if(e.scrollHeight>e.clientHeight+50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) e.scrollBy(0, e.clientHeight); });
              return JSON.stringify(r); })()
            """
            let thermal = ["nominal", "fair", "serious", "critical"][min(3, ProcessInfo.processInfo.thermalState.rawValue)]
            // -hisnForcePartial: فرض تغطية جزئية على أول مقطع (سكربت حصن في عالمه المعزول) للتحقق من رسم الصناديق
            if n == 2, ProcessInfo.processInfo.arguments.contains("-hisnForcePartial") {
                web.evaluateJavaScript("globalThis.__hisnDebugPartial?.([[0.05,0.1,0.4,0.7]])", in: nil, in: .defaultClient) { r in HisnLog.write("probe forced partial: \(r)") }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    web.evaluateJavaScript("JSON.stringify([...document.querySelectorAll('.hisn-cover-box')].map(b=>{const q=b.getBoundingClientRect();return [Math.round(q.left),Math.round(q.top),Math.round(q.width),Math.round(q.height),b.style.display,getComputedStyle(b).backdropFilter||getComputedStyle(b).webkitBackdropFilter];}))") { r, _ in HisnLog.write("probe forced boxes: \(r as? String ?? "nil")") }
                    web.takeSnapshot(with: nil) { img, _ in
                        guard let data = img?.pngData() else { return }
                        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("shots")
                        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                        try? data.write(to: dir.appendingPathComponent("web-forced.png"))
                    }
                }
            }
            web.evaluateJavaScript(js) { r, _ in HisnLog.write("probe \(n) thermal=\(thermal): \(r as? String ?? "nil")") }
            // لقطة من صفحة الويب نفسها (لتشخيص القص والتخطيط)
            if n == 3 || n == 6 {
                web.takeSnapshot(with: nil) { img, _ in
                    guard let data = img?.pngData() else { return }
                    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("shots")
                    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    try? data.write(to: dir.appendingPathComponent("web-\(n).png"))
                    HisnLog.write("probe shot web-\(n).png \(Int(img!.size.width))x\(Int(img!.size.height)) frame=\(Int(web.bounds.width))x\(Int(web.bounds.height))")
                }
            }
        }
    }
}
#endif

#if DEBUG
/// يحفظ لقطات الفيديو المفحوصة مع ملخص حكم الكاشف (للمراجعة بالعين من الماك).
enum DebugFrames {
    static let on = ProcessInfo.processInfo.arguments.contains("-hisnProbe")
    static let dir: URL = {
        let d = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents/frames", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    static var n = 0
    static func save(_ dataUrl: String?, _ result: String?) {
        guard on, n < 150, let dataUrl, let comma = dataUrl.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])),
              let img = UIImage(data: data) else { return }
        n += 1
        var tag = "none"
        if let r = result, let d = try? JSONSerialization.jsonObject(with: Data(r.utf8)) as? [String: Any], let a = d["analysis"] as? [String: Any] {
            let people = (a["people"] as? [[String: Any]] ?? []).map { "\(($0["gender"] as? String ?? "?").prefix(1))\(Int((($0["genderScore"] as? Double) ?? 0) * 100))" }.joined(separator: "_")
            let sc = a["scene"] as? [String: Any]
            tag = "p-\(people.isEmpty ? "0" : people)-w\(Int(((sc?["woman"] as? Double) ?? 0) * 100))-s\(Int(((sc?["sexual"] as? Double) ?? 0) * 100))-n\(Int(((a["nudity"] as? Double) ?? 0) * 100))"
        }
        let side: CGFloat = 320
        let scale = min(1, side / max(img.size.width, img.size.height))
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let small = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        let f = DateFormatter(); f.dateFormat = "HHmmss.SSS"
        try? small.jpegData(compressionQuality: 0.7)?.write(to: dir.appendingPathComponent("\(f.string(from: Date()))-\(tag).jpg"))
    }
}
#endif


/// تنزيل بسقف فعلي للبايتات: يُلغى النقل لحظة تجاوز الحد (لا بعد اكتمال الملف)، ولا يعتمد على Content-Length
/// ولا على احترام الخادم لـ Range. truncateOK: يكفينا أول `limit` بايت (صوت أول ثوانٍ المقطع)؛ وإلا فالتجاوز فشل.
final class CappedFetch: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let limit: Int, truncateOK: Bool
    private var data = Data()
    private var response: HTTPURLResponse?
    private var cont: CheckedContinuation<(Data, HTTPURLResponse)?, Never>?
    private let lock = NSLock()

    private init(limit: Int, truncateOK: Bool) { self.limit = limit; self.truncateOK = truncateOK }

    static func get(_ req: URLRequest, limit: Int, truncateOK: Bool = false) async -> (Data, HTTPURLResponse)? {
        let f = CappedFetch(limit: limit, truncateOK: truncateOK)
        return await withCheckedContinuation { c in
            f.cont = c
            let task = URLSession.shared.dataTask(with: req)
            task.delegate = f // المهمة تحتفظ بالمفوّض حتى تنتهي
            task.resume()
        }
    }

    private func finish(_ ok: Bool) {
        lock.lock(); defer { lock.unlock() }
        guard let c = cont else { return }
        cont = nil
        if ok, let r = response { c.resume(returning: (data.count > limit ? data.prefix(limit) : data, r)) } else { c.resume(returning: nil) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let http = response as? HTTPURLResponse
        self.response = http
        // رمز خطأ، أو حجم معلن يتجاوز الحد ولا يكفينا جزؤه: لا ننزّل شيئًا
        if (http?.statusCode ?? 500) >= 400 || (!truncateOK && response.expectedContentLength > Int64(limit)) {
            completionHandler(.cancel); finish(false); return
        }
        data.reserveCapacity(min(limit, max(0, Int(response.expectedContentLength))))
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
        data.append(chunk)
        if data.count >= limit {
            dataTask.cancel()
            finish(truncateOK)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(error == nil)
    }
}
