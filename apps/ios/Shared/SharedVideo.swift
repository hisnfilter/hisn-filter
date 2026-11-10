import Foundation

/// فيديو مُشارك من تطبيق الصور («مشاركة» ← «تنظيف بفلتر حصن»): يُحفظ في حاوية مجموعة التطبيقات
/// ثم يكمله التطبيق نفسه (امتداد المشاركة محدود الذاكرة، والتنظيف يحتاج التطبيق).
enum SharedVideo {
    static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroup.id)?
            .appendingPathComponent("Incoming", isDirectory: true)
    }

    static var file: URL? { folder?.appendingPathComponent("video") }

    /// الاسم الأصلي للفيديو (لاسم الملف النظيف).
    static var name: String {
        get { AppGroup.defaults.string(forKey: "sharedVideoName") ?? "video.mp4" }
        set { AppGroup.defaults.set(newValue, forKey: "sharedVideoName") }
    }

    static var pending: Bool {
        guard let f = file else { return false }
        return FileManager.default.fileExists(atPath: f.path)
    }

    static var size: Int64 {
        guard let f = file, let a = try? FileManager.default.attributesOfItem(atPath: f.path) else { return 0 }
        return (a[.size] as? NSNumber)?.int64Value ?? 0
    }

    /// يُحذف بعد الحفظ أو الإلغاء.
    static func clear() {
        if let f = file { try? FileManager.default.removeItem(at: f) }
    }
}

/// رابط مُشارك («مشاركة» ← «فلتر حصن» من واتساب وغيره): يفتحه التطبيق في المتصفح المحمي.
enum SharedLink {
    static var pending: URL? {
        get { AppGroup.defaults.string(forKey: "sharedLink").flatMap(URL.init(string:)) }
        set { AppGroup.defaults.set(newValue?.absoluteString, forKey: "sharedLink") }
    }
    /// أول رابط http(s) في نص
    static func extract(_ text: String) -> URL? {
        let det = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let m = det?.matches(in: text, range: NSRange(text.startIndex..., in: text)) ?? []
        return m.compactMap { $0.url }.first { $0.scheme == "https" || $0.scheme == "http" }
    }
}
