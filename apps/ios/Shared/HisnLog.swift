import Foundation

/// سجل تشخيص صغير على الجهاز فقط (Documents/hisn-log.txt): لا يُرسل لأي مكان.
/// يُقرأ عند الحاجة من الماك أثناء التطوير لمعرفة سبب عطل لا يظهر في الرسائل.
enum HisnLog {
    private static let queue = DispatchQueue(label: "hisn.log")
    static let url: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("hisn-log.txt")

    /// في نسخة المتجر لا يُكتب شيء عن المحتوى (أسماء أصوات، عناوين، روابط): سطور «web:» و«page:» و«probe» تشخيص تطوير فقط.
    /// الأخطاء التقنية (فشل نموذج، فشل مهمة) تبقى لأنها بلا محتوى، ويُحذف السجل كله بعد 7 أيام.
    static func write(_ s: String) {
        #if !DEBUG
        if s.hasPrefix("web:") || s.hasPrefix("page:") || s.hasPrefix("probe") || s.hasPrefix("harness") || s.hasPrefix("shots") { return }
        #endif
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
        queue.async {
            // سجل أقدم من أسبوع يُحذف: لا تراكم بيانات تشخيص على الجهاز
            if let date = (try? FileManager.default.attributesOfItem(atPath: url.path)[.creationDate] as? Date) ?? nil, Date().timeIntervalSince(date) > 7 * 86400 {
                try? FileManager.default.removeItem(at: url)
            }
            let fm = FileManager.default
            if let size = (try? fm.attributesOfItem(atPath: url.path)[.size] as? Int) ?? nil, size > 400_000 {
                // نبقي آخر جزء فقط
                if let data = try? Data(contentsOf: url) { try? data.suffix(200_000).write(to: url) }
            }
            if let h = try? FileHandle(forWritingTo: url) {
                h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close()
            } else {
                try? Data(line.utf8).write(to: url)
            }
        }
    }

    /// وصف كامل للخطأ مع الأخطاء الداخلية
    static func describe(_ error: Error) -> String {
        var e: NSError? = error as NSError
        var parts: [String] = []
        while let x = e, parts.count < 4 {
            parts.append("\(x.domain) \(x.code): \(x.localizedDescription)")
            e = x.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return parts.joined(separator: " ← ")
    }
}
