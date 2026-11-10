import SwiftUI
import WebKit

/// «فحص الحماية»: يشغّل محرك الكشف على هذا الجوال بصور اختبار معروفة ويعرض النتيجة.
/// للتأكد أن التغطية تعمل فعلًا على الجهاز (لا على الحاسوب فقط).
struct SelfTestView: View {
    @StateObject private var model = SelfTestModel()

    var body: some View {
        List {
            Section {
                switch model.state {
                case .running:
                    HStack { ProgressView(); Text(tr("جارٍ الفحص… (أول مرة قد تأخذ دقيقة)", "Checking… (the first time can take a minute)")) }
                case .done(let ok):
                    Label(ok ? tr("الحماية تعمل على هذا الجوال", "Protection works on this phone") : tr("في الحماية مشكلة", "Something is wrong"),
                          systemImage: ok ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                        .font(.headline).foregroundStyle(ok ? Color.brand : .orange)
                }
            }
            if !model.rows.isEmpty {
                Section(tr("صور الاختبار", "Test images")) {
                    ForEach(model.rows, id: \.self) { Text($0).font(.footnote.monospaced()) }
                }
            }
            if !model.details.isEmpty {
                Section(tr("للمطوّر", "For the developer")) {
                    Text(model.details).font(.caption2.monospaced()).textSelection(.enabled)
                    Button(tr("نسخ", "Copy")) { UIPasteboard.general.string = model.details }
                }
            }
            Section {
                Button(tr("إعادة الفحص", "Run again")) { model.run() }.disabled(model.state == .running)
            }
        }
        .background(EngineHost(model: model).frame(width: 2, height: 2).opacity(0.01))
        .navigationTitle(tr("فحص الحماية", "Protection check"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

@MainActor
final class SelfTestModel: ObservableObject {
    enum State: Equatable { case running, done(Bool) }
    @Published var state: State = .running
    @Published var rows: [String] = []
    @Published var details = ""
    weak var web: WKWebView?

    func run() {
        guard let web else { return }
        state = .running
        rows = []
        details = ""
        Task {
            var json: String?
            for _ in 0..<3 {
                json = try? await web.callAsyncJavaScript("return window.__hisnSelfTest ? JSON.stringify(await window.__hisnSelfTest()) : null;",
                                                          arguments: [:], in: nil, contentWorld: .page) as? String
                if json != nil { break }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
            show(json)
            await runNative(web)
        }
    }

    /** المحرك الأصلي (كود الآيفون): نفس الصور، والقرار من سياسة الصفحة نفسها. */
    private func runNative(_ web: WKWebView) async {
        guard let det = NativeDetector.shared else {
            rows.append("✗ " + tr("محرك الآيفون لم يعمل", "iPhone engine failed to start"))
            return
        }
        let expect: [(String, String, String)] = [("woman", "blur", "show"), ("man", "show", "show"), ("landscape", "show", "show"), ("belly", "cover", "cover")]
        var allOk = true
        for (name, em, ef) in expect {
            guard let url = Bundle.main.url(forResource: name, withExtension: "jpg", subdirectory: "web/pages/selftest"),
                  let data = try? Data(contentsOf: url), let img = ProtectedWeb.Coordinator.downscaled(data, maxSide: 768) else { continue }
            let t = Date()
            guard let a = await NativeQueue.shared.analyze(img, detector: det) else { rows.append("✗ \(name)"); allOk = false; continue }
            let ms = Int(Date().timeIntervalSince(t) * 1000)
            let json = ProtectedWeb.Coordinator.json(a)
            let male = (try? await web.callAsyncJavaScript("return window.__hisnDecide(JSON.parse(a), 'male');", arguments: ["a": json], in: nil, contentWorld: .page)) as? String ?? "?"
            let female = (try? await web.callAsyncJavaScript("return window.__hisnDecide(JSON.parse(a), 'female');", arguments: ["a": json], in: nil, contentWorld: .page)) as? String ?? "?"
            let ok = (male == em || (em == "blur" && male == "cover")) && female == ef
            allOk = allOk && ok
            rows.append("\(ok ? "✓" : "✗") ⚡︎ \(name): \(tr("رجل", "man"))=\(male) \(tr("امرأة", "woman"))=\(female) (\(ms)ms)")
        }
        details += "\nnative: \(det.backend) ok=\(allOk)"
        if case .done(let webOk) = state { state = .done(webOk && allOk) }
    }

    private func show(_ json: String?) {
        details = json ?? "no result"
        guard let data = json?.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            state = .done(false)
            return
        }
        let cases = obj["cases"] as? [[String: Any]] ?? []
        rows = cases.map { c in
            let ok = c["ok"] as? Bool ?? false
            let name = (c["file"] as? String ?? "").replacingOccurrences(of: ".jpg", with: "")
            if let err = c["error"] as? String { return "✗ \(name): \(err)" }
            return "\(ok ? "✓" : "✗") \(name): \(tr("رجل", "man"))=\(c["male"] ?? "") \(tr("امرأة", "woman"))=\(c["female"] ?? "") (\(c["ms"] ?? "")ms)"
        }
        let ready = (obj["ready"] as? [String: Any])?["ok"] as? Bool ?? false
        state = .done(ready && !cases.isEmpty && cases.allSatisfy { $0["ok"] as? Bool ?? false })
    }
}

/// صفحة المحرك المخفية للفحص.
private struct EngineHost: UIViewRepresentable {
    let model: SelfTestModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(WebFiles.shared, forURLScheme: WebFiles.scheme)
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 2, height: 2), configuration: config)
        web.navigationDelegate = context.coordinator
        model.web = web
        web.load(URLRequest(url: ProtectedWeb.engineURL))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let model: SelfTestModel
        init(model: SelfTestModel) { self.model = model }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in model.run() }
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            Task { @MainActor in
                model.details = "engine process terminated (memory?)"
                model.state = .done(false)
            }
        }
    }
}
