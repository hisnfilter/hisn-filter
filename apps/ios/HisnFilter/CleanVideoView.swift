import AVFoundation
import Photos
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// تنظيف فيديو من الاستوديو على آيفون: نفس صفحة الإضافة ونفس النماذج داخل WKWebView.
/// الملفات من حزمة التطبيق (مجلد web) عبر عنوان داخلي hisn://app — لا شبكة ولا رفع.
struct CleanVideoView: View {
    var body: some View {
        CleanVideoWeb()
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(tr("تنظيف فيديو", "Clean a video"))
            .navigationBarTitleDisplayMode(.inline)
            // الشاشة لا تنطفئ أثناء التنظيف (انطفاؤها يوقف العمل)، ونطلب وقتًا إضافيًا إن خرج المستخدم
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
                var task: UIBackgroundTaskIdentifier = .invalid
                task = UIApplication.shared.beginBackgroundTask(withName: "hisn-clean") {
                    UIApplication.shared.endBackgroundTask(task)
                }
            }
    }
}

/// إعدادات تنظيف الفيديو (نفس أسماء الإضافة وأندرويد).
extension HisnSettings {
    static var removeMusic: Bool {
        get { AppGroup.defaults.object(forKey: "removeMusic") as? Bool ?? true }
        set { AppGroup.defaults.set(newValue, forKey: "removeMusic") }
    }
    static var muteSinger: Bool {
        get { AppGroup.defaults.object(forKey: "muteSinger") as? Bool ?? true }
        set { AppGroup.defaults.set(newValue, forKey: "muteSinger") }
    }
}

struct CleanVideoWeb: UIViewRepresentable {
    static let scheme = "hisn"

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(context.coordinator, forURLScheme: Self.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .nonPersistent()
        let ucc = config.userContentController
        ucc.add(context.coordinator, name: "hisn")
        // جسر التطبيق: الإعدادات تُحقن نصًا (متزامنة)، والحفظ يُرسل رسائل بالترتيب
        let settings: [String: Any] = [
            "viewer": HisnSettings.viewer.rawValue,
            "level": HisnSettings.level.rawValue,
            "removeMusic": HisnSettings.removeMusic,
            "muteSingerAfterMusicRemoval": HisnSettings.muteSinger,
            "allowNasheedsWithoutInstruments": true,
            "musicBed": AppGroup.defaults.string(forKey: "musicBed") ?? "none",
        ]
        let json = String(data: (try? JSONSerialization.data(withJSONObject: settings)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
        let quoted = String(data: (try? JSONSerialization.data(withJSONObject: [json])) ?? Data("[\"{}\"]".utf8), encoding: .utf8) ?? "[\"{}\"]"
        let bridge = """
        (function(){
          const post = (m) => window.webkit.messageHandlers.hisn.postMessage(m);
          const settings = \(quoted)[0];
          window.HisnHost = {
            settings: () => settings,
            sharedName: () => \(Self.jsString(SharedVideo.name)),
            sharedSize: () => \(SharedVideo.size),
            begin: (part, mime) => post({ op: "begin", part }),
            write: (part, position, data) => post({ op: "write", part, position, data }),
            // فصل الموسيقى بمعالج الجوال (أسرع بكثير من المتصفح)
            sepBegin: (id, n) => post({ op: "sepBegin", id, n }),
            sepPush: (id, o, l, r) => post({ op: "sepPush", id, o, l, r }),
            sepRun: (id) => post({ op: "sepRun", id }),
            finish: (name) => post({ op: "finish", name }),
            // دمج الصوت النظيف (WAV) مع الصورة بأدوات النظام، قبل المعاينة
            merge: () => post({ op: "merge" }),
            // «أزل الموسيقى» بكود الجوال: يكمل في الخلفية (iOS 26)
            nativeMusic: (bed) => post({ op: "nativeMusic", bed: bed || "none" }),
            // تذكّر اختيار الصفحة (الخلفية مكان الموسيقى)
            setPref: (key, value) => post({ op: "pref", key, value: String(value) }),
          };
        })();
        """
        ucc.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        context.coordinator.web = web
        // فيديو مُشارك من تطبيق الصور: يبدأ تنظيفه تلقائيًا
        let hash = SharedVideo.pending ? "#shared" : ""
        web.load(URLRequest(url: URL(string: "\(Self.scheme)://app/pages/clean-video.html\(hash)")!))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    /// نص JavaScript آمن (بين علامتي تنصيص).
    static func jsString(_ s: String) -> String {
        String(data: (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8), encoding: .utf8).map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "hisn")
    }

    final class Coordinator: NSObject, WKURLSchemeHandler, WKScriptMessageHandler, WKNavigationDelegate, PHPickerViewControllerDelegate {
        weak var web: WKWebView?
        private let root = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true).standardizedFileURL
        private let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("hisn-clean", isDirectory: true)
        private var handles: [String: FileHandle] = [:]
        private var jobs: [String: ([Float], [Float])] = [:]
        private var separator: NativeSeparator?
        private let sepQueue = DispatchQueue(label: "hisn.separate", qos: .userInitiated)
        private var nativeBed = "none"

        // ===== ملفات الصفحة =====

        func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
            guard let url = task.request.url, url.host == "app" else { return fail(task, 403) }
            let path = url.path
            if path == "/output/video" {
                // بعد الدمج: المعاينة من الملف المدموج (فيه الصوت)
                let merged = tmp.appendingPathComponent("clean.mov")
                if FileManager.default.fileExists(atPath: merged.path) { return serveFile(task, url, merged, type: "video/quicktime") }
                return serveFile(task, url, tmp.appendingPathComponent("video"))
            }
            if path == "/shared/video", let f = SharedVideo.file { return serveFile(task, url, f) }
            let file = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL
            // لا خروج من مجلد الصفحات
            guard !path.contains(".."), file.path.hasPrefix(root.path + "/"),
                  let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return fail(task, 404) }
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: Self.isolation.merging([
                "Content-Type": Self.mime(file.pathExtension),
                "Content-Length": String(data.count),
            ]) { a, _ in a })!
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        }

        func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

        /// معاينة الناتج قبل حفظه، مع طلبات Range (التقديم والتأخير في الفيديو).
        private func serveFile(_ task: WKURLSchemeTask, _ url: URL, _ file: URL, type: String = "video/mp4") {
            for h in handles.values { try? h.synchronize() }
            guard let h = try? FileHandle(forReadingFrom: file), let size = try? h.seekToEnd(), size > 0 else { return fail(task, 404) }
            defer { try? h.close() }
            var from: UInt64 = 0, to: UInt64 = size - 1, status = 200
            if let range = task.request.value(forHTTPHeaderField: "Range"), range.hasPrefix("bytes=") {
                let parts = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
                if parts.count == 2 {
                    if let a = UInt64(parts[0]) { from = min(a, size - 1); if let b = UInt64(parts[1]) { to = min(b, size - 1) } }
                    else if let n = UInt64(parts[1]) { from = size - min(n, size) }
                    status = 206
                }
            }
            guard from <= to else { return fail(task, 416) }
            // لا نقرأ أكثر من 8MB في الرد الواحد (المشغل يطلب الباقي): لا يُحمَّل الفيديو كله في الذاكرة
            if status == 206 { to = min(to, from + (8 << 20) - 1) }
            try? h.seek(toOffset: from)
            let data = (try? h.read(upToCount: Int(to - from + 1))) ?? Data()
            var headers = Self.isolation.merging(["Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(data.count)]) { a, _ in a }
            if status == 206 { headers["Content-Range"] = "bytes \(from)-\(from + UInt64(data.count) - 1)/\(size)" }
            task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
            task.didReceive(data)
            task.didFinish()
        }

        private func fail(_ task: WKURLSchemeTask, _ code: Int) {
            guard let url = task.request.url else { return }
            task.didReceive(HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: nil)!)
            task.didFinish()
        }

        /// صفحات معزولة: تسمح بتشغيل النماذج على عدة أنوية (SharedArrayBuffer) داخل WKWebView.
        static let isolation = [
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Resource-Policy": "same-origin",
        ]

        static func mime(_ ext: String) -> String {
            switch ext.lowercased() {
            case "html": return "text/html; charset=utf-8"
            case "js", "mjs": return "text/javascript"
            case "css": return "text/css"
            case "wasm": return "application/wasm"
            case "json": return "application/json"
            default: return "application/octet-stream"
            }
        }

        // لا تنقّل خارج صفحات التطبيق
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(action.request.url?.scheme == CleanVideoWeb.scheme ? .allow : .cancel)
        }

        // ===== الحفظ في الصور =====

        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let m = message.body as? [String: Any], let op = m["op"] as? String else { return }
            do {
                switch op {
                case "begin":
                    guard let part = m["part"] as? String, ["video", "audio"].contains(part) else { return }
                    if part == "video" {
                        // ملف جديد: نحذف ناتج المرة السابقة
                        handles.values.forEach { try? $0.close() }
                        handles.removeAll()
                        try? FileManager.default.removeItem(at: tmp)
                    }
                    try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
                    let url = tmp.appendingPathComponent(part)
                    try? FileManager.default.removeItem(at: url)
                    FileManager.default.createFile(atPath: url.path, contents: nil)
                    handles[part] = try FileHandle(forUpdating: url)
                case "write":
                    // كتابة في موضع (ملف MP4 تُصحَّح ترويسته في النهاية)
                    guard let part = m["part"] as? String, let b64 = m["data"] as? String,
                          let pos = (m["position"] as? NSNumber)?.uint64Value,
                          let data = Data(base64Encoded: b64), let h = handles[part] else { return }
                    try h.seek(toOffset: pos)
                    try h.write(contentsOf: data)
                case "sepBegin":
                    guard let id = m["id"] as? String, let n = (m["n"] as? NSNumber)?.intValue, n > 0 else { return }
                    jobs[id] = ([Float](repeating: 0, count: n), [Float](repeating: 0, count: n))
                case "sepPush":
                    guard let id = m["id"] as? String, var job = jobs[id], let o = (m["o"] as? NSNumber)?.intValue,
                          let l = m["l"] as? String, let r = m["r"] as? String else { return }
                    let a = Pcm.decode(l), b = Pcm.decode(r)
                    for i in 0..<min(a.count, job.0.count - o) { job.0[o + i] = a[i] }
                    for i in 0..<min(b.count, job.1.count - o) { job.1[o + i] = b[i] }
                    jobs[id] = job
                case "sepRun":
                    guard let id = m["id"] as? String, let job = jobs.removeValue(forKey: id) else { return }
                    runSeparation(id: id, left: job.0, right: job.1)
                case "nativeMusic":
                    nativeBed = (m["bed"] as? String).flatMap { ["none", "rain", "breeze", "waves"].contains($0) ? $0 : nil } ?? "none"
                    pickForNativeMusic()
                case "pref":
                    if m["key"] as? String == "musicBed", let v = m["value"] as? String, ["none", "rain", "breeze", "waves"].contains(v) {
                        AppGroup.defaults.set(v, forKey: "musicBed")
                    }
                case "merge":
                    handles.values.forEach { try? $0.close() }
                    handles.removeAll()
                    Task { await mergeForPreview() }
                case "finish":
                    handles.values.forEach { try? $0.close() }
                    handles.removeAll()
                    Task { await finish() }
                default: break
                }
            } catch {
                reply(false, error.localizedDescription)
            }
        }

        // ===== «أزل الموسيقى» بكود الجوال =====

        private func pickForNativeMusic() {
            var cfg = PHPickerConfiguration(photoLibrary: .shared())
            cfg.filter = .videos
            cfg.selectionLimit = 1
            cfg.preferredAssetRepresentationMode = .current
            let picker = PHPickerViewController(configuration: cfg)
            picker.delegate = self
            Self.topController()?.present(picker, animated: true)
        }

        static func topController() -> UIViewController? {
            var vc = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController
            while let p = vc?.presentedViewController { vc = p }
            return vc
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            guard let provider = results.first?.itemProvider, provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) else { return }
            provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { [weak self] url, _ in
                guard let url else { return }
                // الملف المؤقت يُحذف بعد هذه الدالة: ننسخه
                let copy = FileManager.default.temporaryDirectory.appendingPathComponent("hisn-music-\(UUID().uuidString).\(url.pathExtension)")
                guard (try? FileManager.default.copyItem(at: url, to: copy)) != nil else { return }
                let name = url.lastPathComponent
                let mb = Double((try? copy.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) / 1e6
                DispatchQueue.main.async { self?.startNativeMusic(copy, name: name, mb: mb) }
            }
        }

        @MainActor
        private func startNativeMusic(_ url: URL, name: String, mb: Double) {
            let job = NativeMusicJob.shared
            js("window.__hisnNativeStart(\(CleanVideoWeb.jsString(name)), \(mb))")
            job.onProgress = { [weak self] p, stage in
                self?.js("window.__hisnNativeProgress(\(p), \(CleanVideoWeb.jsString(stage)))")
            }
            job.onDone = { [weak self] ok, msg in
                self?.js("window.__hisnNativeDone(\(ok), \(CleanVideoWeb.jsString(msg)))")
            }
            job.start(url: url, name: name, bed: nativeBed)
        }

        /// يدمج الصورة والصوت النظيف قبل المعاينة، فتُسمع المعاينة كما سيُحفظ الفيديو.
        @MainActor
        private func mergeForPreview() async {
            let video = tmp.appendingPathComponent("video"), audio = tmp.appendingPathComponent("audio")
            let output = tmp.appendingPathComponent("clean.mov")
            do {
                try? FileManager.default.removeItem(at: output)
                try await Self.merge(video: video, wav: audio, to: output)
                js("window.__hisnMerged(true, '')")
            } catch {
                try? FileManager.default.removeItem(at: output)
                js("window.__hisnMerged(false, \(CleanVideoWeb.jsString(Self.describe(error))))")
            }
        }

        /// رسالة خطأ مفيدة للتشخيص (النص، والمصدر، والرقم).
        static func describe(_ error: Error) -> String {
            let e = error as NSError
            return "\(e.localizedDescription) [\(e.domain) \(e.code)]"
        }

        private func finish() async {
            let video = tmp.appendingPathComponent("video"), audio = tmp.appendingPathComponent("audio")
            let merged = tmp.appendingPathComponent("clean.mov")
            do {
                var output = tmp.appendingPathComponent("clean.mp4")
                try? FileManager.default.removeItem(at: output)
                if FileManager.default.fileExists(atPath: merged.path) {
                    output = merged // دُمج مسبقًا للمعاينة
                } else if FileManager.default.fileExists(atPath: audio.path) {
                    // متصفح بلا مرمّز صوت: الفيديو بلا صوت + صوت WAV نظيف ← ندمجهما بأدوات النظام (بلا إعادة ترميز الصورة)
                    output = tmp.appendingPathComponent("clean.mov")
                    try? FileManager.default.removeItem(at: output)
                    try await Self.merge(video: video, wav: audio, to: output)
                } else {
                    try FileManager.default.moveItem(at: video, to: output)
                }
                let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                guard status == .authorized || status == .limited else {
                    throw NSError(domain: "hisn", code: 1, userInfo: [NSLocalizedDescriptionKey: tr("اسمح لفلتر حصن بإضافة الصور: الإعدادات ← فلتر حصن ← الصور", "Allow Hisn Filter to add photos: Settings → Hisn Filter → Photos")])
                }
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetCreationRequest.forAsset().addResource(with: .video, fileURL: output, options: nil)
                }
                reply(true, "")
                SharedVideo.clear() // انتهى الفيديو المُشارك
            } catch {
                reply(false, Self.describe(error))
            }
            try? FileManager.default.removeItem(at: tmp)
        }

        static func merge(video: URL, wav: URL, to out: URL) async throws {
            // الامتداد يحدد النوع عند القراءة
            let v = video.appendingPathExtension("mp4"), a = wav.appendingPathExtension("wav")
            try? FileManager.default.removeItem(at: v); try? FileManager.default.removeItem(at: a)
            try FileManager.default.moveItem(at: video, to: v)
            try FileManager.default.moveItem(at: wav, to: a)
            let comp = AVMutableComposition()
            let vAsset = AVURLAsset(url: v), aAsset = AVURLAsset(url: a)
            guard let vSrc = try await vAsset.loadTracks(withMediaType: .video).first else { throw NSError(domain: "hisn", code: 2) }
            let duration = try await vAsset.load(.duration)
            let vDst = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
            try vDst?.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: vSrc, at: .zero)
            vDst?.preferredTransform = try await vSrc.load(.preferredTransform)
            // الصوت إلزامي: لا نُخرج فيديو صامتًا بصمت (كان هذا سبب «فيديو بلا صوت»)
            guard let aSrc = try await aAsset.loadTracks(withMediaType: .audio).first else {
                throw NSError(domain: "hisn", code: 21, userInfo: [NSLocalizedDescriptionKey: tr("تعذّر قراءة الصوت النظيف", "Couldn't read the clean audio")])
            }
            let aDur = try await aAsset.load(.duration)
            let aDst = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
            try aDst?.insertTimeRange(CMTimeRange(start: .zero, duration: CMTimeMinimum(duration, aDur)), of: aSrc, at: .zero)
            guard let session = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else { throw NSError(domain: "hisn", code: 3) }
            session.outputURL = out
            session.outputFileType = .mov
            await session.export()
            if let e = session.error { throw e }
            let check = try await AVURLAsset(url: out).loadTracks(withMediaType: .audio)
            if check.isEmpty { throw NSError(domain: "hisn", code: 22, userInfo: [NSLocalizedDescriptionKey: tr("خرج الفيديو بلا صوت", "The video came out without sound")]) }
        }

        private func js(_ code: String) {
            DispatchQueue.main.async { [weak self] in self?.web?.evaluateJavaScript(code) }
        }

        private static func quote(_ s: String) -> String {
            String(data: (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8), encoding: .utf8).map { String($0.dropFirst().dropLast()) } ?? "\"\""
        }

        /// الفصل في الخلفية، والنتيجة للصفحة على دفعات (ثانية لكل رسالة).
        private func runSeparation(id: String, left: [Float], right: [Float]) {
            let qid = Self.quote(id)
            sepQueue.async { [weak self] in
                guard let self else { return }
                do {
                    if self.separator == nil {
                        guard let path = Bundle.main.path(forResource: "inst-hq4-w8", ofType: "onnx", inDirectory: "web/models/uvr") else {
                            throw NSError(domain: "hisn", code: 11, userInfo: [NSLocalizedDescriptionKey: "نموذج الفصل غير موجود"])
                        }
                        self.separator = try NativeSeparator(modelPath: path, useAccel: { AppActive.shared.isActive })
                    }
                    var last: Float = 0
                    let m = try self.separator!.music(left, right) { p in
                        if p - last >= 0.05 || p >= 1 { last = p; self.js("window.__hisnSep(\(qid), 'p', \(p))") }
                    }
                    let step = 44100
                    var o = 0
                    while o < m[0].count {
                        let e = min(m[0].count, o + step)
                        self.js("window.__hisnSep(\(qid), 'd', \(o), '\(Pcm.encode(m[0][o..<e]))', '\(Pcm.encode(m[1][o..<e]))')")
                        o = e
                    }
                    self.js("window.__hisnSep(\(qid), 'end')")
                } catch {
                    self.js("window.__hisnSep(\(qid), 'err', \(Self.quote(error.localizedDescription)))")
                }
            }
        }

        private func reply(_ ok: Bool, _ message: String) {
            let msg = String(data: (try? JSONSerialization.data(withJSONObject: [message])) ?? Data("[\"\"]".utf8), encoding: .utf8) ?? "[\"\"]"
            DispatchQueue.main.async { [weak self] in
                self?.web?.evaluateJavaScript("window.__hisnSaved(\(ok), \(msg)[0])")
            }
        }
    }
}
