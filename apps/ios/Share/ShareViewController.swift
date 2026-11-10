import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// «مشاركة» ← «تنظيف بفلتر حصن» من تطبيق الصور: ينسخ الفيديو لحاوية التطبيق، ثم يكمل التطبيق التنظيف
/// تلقائيًا عند فتحه. لا يُرفع شيء.
final class ShareViewController: UIViewController {
    private var status = ShareStatus()

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareView(status: status) { [weak self] in self?.done() })
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        receive()
    }

    private func receive() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap { $0.attachments ?? [] } ?? []
        // رابط (من واتساب أو سفاري أو أي تطبيق): يُفتح في المتصفح المحمي
        if let u = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            u.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] item, _ in
                let url = (item as? URL) ?? (item as? Data).flatMap { String(data: $0, encoding: .utf8) }.flatMap(URL.init(string:))
                self?.gotLink(url)
            }
            return
        }
        if let t = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }),
           !providers.contains(where: { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }) {
            t.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                let text = (item as? String) ?? (item as? Data).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                self?.gotLink(SharedLink.extract(text))
            }
            return
        }
        guard let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }) else {
            status.set(.failed(tr("لم يُعثر على فيديو أو رابط.", "No video or link found.")))
            return
        }
        p.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { [weak self] url, error in
            guard let self else { return }
            do {
                guard let url, let dest = SharedVideo.file, let folder = SharedVideo.folder else { throw error ?? NSError(domain: "hisn", code: 1) }
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try? FileManager.default.removeItem(at: dest)
                // نسخة لأن الملف المؤقت يُحذف بعد انتهاء هذه الدالة
                try FileManager.default.copyItem(at: url, to: dest)
                SharedVideo.name = url.lastPathComponent
                self.status.set(.ready)
            } catch {
                self.status.set(.failed(tr("تعذّر نسخ الفيديو: ", "Couldn't copy the video: ") + error.localizedDescription))
            }
        }
    }

    private func gotLink(_ url: URL?) {
        guard let url, url.scheme == "https" || url.scheme == "http" else {
            status.set(.failed(tr("الرابط غير صالح.", "The link isn't valid.")))
            return
        }
        SharedLink.pending = url
        status.set(.link)
        // فتح التطبيق مباشرة (امتداد المشاركة لا يملك openURL رسميًا؛ هذه الطريقة تعمل في الإصدارات الحالية، وإلا يفتحه المستخدم)
        DispatchQueue.main.async { [weak self] in
            var r: UIResponder? = self
            let open = URL(string: "hisnfilter://open")!
            while let x = r {
                if let app = x as? UIApplication { app.open(open); break }
                r = x.next
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self?.done() }
        }
    }

    private func done() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}

final class ShareStatus: ObservableObject {
    enum State { case copying, ready, link, failed(String) }
    @Published var state: State = .copying
    func set(_ s: State) { DispatchQueue.main.async { self.state = s } }
}

struct ShareView: View {
    @ObservedObject var status: ShareStatus
    let close: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.shield").font(.system(size: 44)).foregroundStyle(.green)
            switch status.state {
            case .copying:
                ProgressView(tr("جارٍ تجهيز الفيديو…", "Preparing the video…"))
            case .ready:
                Text(tr("جاهز ✓", "Ready ✓")).font(.title2.bold())
                Text(tr("افتح «فلتر حصن» وسيبدأ التنظيف تلقائيًا، ثم يُحفظ الفيديو النظيف في الصور.", "Open Hisn Filter and cleaning starts automatically; the clean video is saved to Photos."))
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
            case .link:
                Text(tr("يُفتح في فلتر حصن…", "Opening in Hisn Filter…")).font(.title2.bold())
                Text(tr("إن لم يُفتح تلقائيًا، افتح «فلتر حصن» وسيعرض الرابط بالحماية.", "If it doesn't open automatically, open Hisn Filter and the link shows with protection."))
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
            case .failed(let msg):
                Text(msg).multilineTextAlignment(.center)
            }
            Button(tr("تم", "Done"), action: close).buttonStyle(.borderedProminent)
        }
        .padding(24)
        .environment(\.layoutDirection, .rightToLeft)
    }
}
