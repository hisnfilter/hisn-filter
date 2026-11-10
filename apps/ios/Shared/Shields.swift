import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

extension ManagedSettingsStore.Name {
    /// التطبيقات التي اختار المستخدم حجبها دائمًا (تيك توك مثلًا، ويستخدم نسخة الويب الآمنة بدلًا منه).
    static let hisnApps = Self("hisn.apps")
    /// حجب مؤقت عند كشف محتوى مخالف أثناء فحص الشاشة.
    static let hisnScan = Self("hisn.scan")
    /// فلتر النظام للمواقع الإباحية في Safari والمتصفحات داخل التطبيقات.
    static let hisnSystem = Self("hisn.system")
}

extension DeviceActivityName {
    /// السماح المؤقت (15 دقيقة) بعد إدخال الرمز؛ عند انتهائه يعيد الامتداد الحجب.
    static let hisnUnlock = Self("hisn.unlock")
}

enum Shields {
    static let appsKey = "selection.apps"
    static let scanKey = "selection.scan"

    static func selection(_ key: String) -> FamilyActivitySelection {
        guard let data = HisnSettings.data(key),
              let s = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else { return FamilyActivitySelection() }
        return s
    }

    static func save(_ s: FamilyActivitySelection, _ key: String) {
        HisnSettings.setData(try? JSONEncoder().encode(s), key)
    }

    private static func shield(_ store: ManagedSettingsStore, with s: FamilyActivitySelection) {
        store.shield.applications = s.applicationTokens.isEmpty ? nil : s.applicationTokens
        store.shield.applicationCategories = s.categoryTokens.isEmpty ? nil : .specific(s.categoryTokens)
        store.shield.webDomains = s.webDomainTokens.isEmpty ? nil : s.webDomainTokens
        store.shield.webDomainCategories = s.categoryTokens.isEmpty ? nil : .specific(s.categoryTokens)
    }

    static func applyApps() {
        shield(ManagedSettingsStore(named: .hisnApps), with: selection(appsKey))
    }

    static func clearApps() {
        ManagedSettingsStore(named: .hisnApps).clearAllSettings()
    }

    /// فلتر آبل المدمج للمواقع الإباحية (Safari وكل متصفح WebKit داخل التطبيقات) ومنع المحتوى الصريح في الوسائط.
    static func applySystem(_ on: Bool) {
        let store = ManagedSettingsStore(named: .hisnSystem)
        if on {
            store.webContent.blockedByFilter = .auto()
            store.media.denyExplicitContent = true
        } else {
            store.clearAllSettings()
        }
    }

    /// يحجب التطبيقات المراقبة فورًا (يُستدعى من امتداد فحص الشاشة عند كشف مخالفة).
    static func shieldForScan(reason: String) {
        HisnSettings.scanReason = reason
        HisnSettings.scanShieldActive = true
        shield(ManagedSettingsStore(named: .hisnScan), with: selection(scanKey))
    }

    /// يرفع حجب الفحص، مع مهلة قصيرة يسحب فيها المستخدم للمقطع التالي.
    static func clearScan(grace: TimeInterval) {
        ManagedSettingsStore(named: .hisnScan).clearAllSettings()
        HisnSettings.scanShieldActive = false
        HisnSettings.scanGraceUntil = Date().addingTimeInterval(grace)
    }

    /// يسمح بالتطبيقات المحجوبة 15 دقيقة (أقل مدة تقبلها آبل لجدول المراقبة) ثم يعيد حجبها تلقائيًا.
    static func allowAppsTemporarily(minutes: Int = 15) throws {
        let cal = Calendar.current
        let now = Date()
        let end = now.addingTimeInterval(TimeInterval(minutes * 60))
        let schedule = DeviceActivitySchedule(
            intervalStart: cal.dateComponents([.hour, .minute, .second], from: now),
            intervalEnd: cal.dateComponents([.hour, .minute, .second], from: end),
            repeats: false
        )
        let center = DeviceActivityCenter()
        center.stopMonitoring([.hisnUnlock])
        try center.startMonitoring(.hisnUnlock, during: schedule)
        // نرفع الحجب فقط بعد نجاح جدولة إعادته، حتى لا تبقى التطبيقات مفتوحة للأبد
        clearApps()
    }
}
