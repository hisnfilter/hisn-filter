import CommonCrypto
import Foundation
import Security

/// رمز القفل: بصمة PBKDF2-SHA256 (150 ألف تكرار) مع ملح عشوائي — نفس طريقة الإضافة وأندرويد.
enum Pin {
    static let iterations: UInt32 = 150_000

    static func isValid(_ pin: String) -> Bool {
        (4...8).contains(pin.count) && pin.allSatisfy { $0.isASCII && $0.isNumber }
    }

    static func hash(_ pin: String, saltHex: String? = nil) -> (hash: String, salt: String) {
        var salt = [UInt8](repeating: 0, count: 16)
        if let hex = saltHex { salt = fromHex(hex) } else { _ = SecRandomCopyBytes(kSecRandomDefault, salt.count, &salt) }
        var out = [UInt8](repeating: 0, count: 32)
        // String يُمرَّر كمؤشر C تلقائيًا؛ الرمز أرقام فقط فطوله بالبايت = عدد محارفه
        _ = CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            pin, pin.utf8.count,
            salt, salt.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations,
            &out, out.count
        )
        return (toHex(out), toHex(salt))
    }

    /// بلا رمز محفوظ: مسموح. المقارنة بزمن ثابت.
    static func verify(_ pin: String) -> Bool {
        guard let h = HisnSettings.pinHash, let s = HisnSettings.pinSalt, !h.isEmpty else { return true }
        guard isValid(pin) else { return false }
        let got = Array(hash(pin, saltHex: s).hash.utf8), want = Array(h.utf8)
        guard got.count == want.count else { return false }
        var diff: UInt8 = 0
        for i in got.indices { diff |= got[i] ^ want[i] }
        return diff == 0
    }

    // ===== محاولات الرمز: 3 محاولات حرة ثم انتظار 30 ثانية يتضاعف حتى 15 دقيقة (نفس الإضافة) =====
    static let freeTries = 3
    static func backoff(_ fails: Int) -> TimeInterval {
        fails < freeTries ? 0 : min(15 * 60, 30 * pow(2, Double(fails - freeTries)))
    }
    /// ثوانٍ متبقية قبل السماح بمحاولة جديدة (0 = مسموح)
    static var waitSeconds: Int {
        let until = AppGroup.defaults.object(forKey: "pinWaitUntil") as? Date ?? .distantPast
        return max(0, Int(until.timeIntervalSinceNow.rounded(.up)))
    }
    /// الفحص الموحّد: يفتح 5 دقائق عند النجاح، ويعدّ المحاولات الخاطئة مرة واحدة.
    enum Result { case ok, wrong, wait(Int) }
    static func attempt(_ pin: String) -> Result {
        if !HisnSettings.lockEnabled || HisnSettings.unlocked { return .ok }
        let w = waitSeconds
        if w > 0 { return .wait(w) }
        if verify(pin) {
            AppGroup.defaults.set(0, forKey: "pinFails")
            AppGroup.defaults.removeObject(forKey: "pinWaitUntil")
            HisnSettings.unlockedUntil = Date().addingTimeInterval(5 * 60)
            return .ok
        }
        let fails = AppGroup.defaults.integer(forKey: "pinFails") + 1
        AppGroup.defaults.set(fails, forKey: "pinFails")
        let b = backoff(fails)
        if b > 0 { AppGroup.defaults.set(Date().addingTimeInterval(b), forKey: "pinWaitUntil") }
        return b > 0 ? .wait(Int(b)) : .wrong
    }

    static func toHex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined() }

    static func fromHex(_ s: String) -> [UInt8] {
        var out: [UInt8] = []
        var i = s.startIndex
        while i < s.endIndex, let j = s.index(i, offsetBy: 2, limitedBy: s.endIndex) {
            out.append(UInt8(s[i..<j], radix: 16) ?? 0)
            i = j
        }
        return out
    }
}
