import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

/// تحكم الوالدين في الألعاب من «فلتر حصن»: قفل اللعبة، والحد اليومي.
/// كل لعبة تُربط مرة واحدة باختيارها من قائمة آبل (لا نعرف التطبيقات إلا بهذا الاختيار)،
/// ثم يُطبَّق القفل والحد بأدوات «مدة استخدام الجهاز» حتى لو كان تطبيقنا مغلقًا.
enum Games {
    static func selKey(_ id: String) -> String { "game.\(id).sel" }
    static func lockedKey(_ id: String) -> String { "game.\(id).locked" }
    static func limitKey(_ id: String) -> String { "game.\(id).limit" }
    static func doneKey(_ id: String) -> String { "game.\(id).doneToday" }
    static let idsKey = "games.ids" // الألعاب المربوطة (للامتداد)

    static func store(_ id: String) -> ManagedSettingsStore { ManagedSettingsStore(named: .init("hisn.game.\(id)")) }
    static func activity(_ id: String) -> DeviceActivityName { .init("hisn.game.\(id)") }
    static let limitEvent = DeviceActivityEvent.Name("limit")

    static func selection(_ id: String) -> FamilyActivitySelection { Shields.selection(selKey(id)) }
    static func isLinked(_ id: String) -> Bool { !selection(id).applicationTokens.isEmpty }
    static func locked(_ id: String) -> Bool { AppGroup.defaults.bool(forKey: lockedKey(id)) }
    /// دقائق اللعب في اليوم (0 = بلا حد)
    static func limit(_ id: String) -> Int { AppGroup.defaults.integer(forKey: limitKey(id)) }

    static func link(_ id: String, _ s: FamilyActivitySelection) {
        Shields.save(s, selKey(id))
        var ids = Set(AppGroup.defaults.stringArray(forKey: idsKey) ?? [])
        if s.applicationTokens.isEmpty { ids.remove(id) } else { ids.insert(id) }
        AppGroup.defaults.set(Array(ids), forKey: idsKey)
        apply(id)
    }

    static func setLocked(_ id: String, _ on: Bool) {
        AppGroup.defaults.set(on, forKey: lockedKey(id))
        apply(id)
    }

    static func setLimit(_ id: String, minutes: Int) throws {
        AppGroup.defaults.set(minutes, forKey: limitKey(id))
        AppGroup.defaults.set(false, forKey: doneKey(id))
        try schedule(id)
        apply(id)
    }

    /// الحجب الآن: مقفلة، أو انتهى وقتها اليوم.
    static func apply(_ id: String) {
        let s = selection(id)
        let block = locked(id) || (limit(id) > 0 && AppGroup.defaults.bool(forKey: doneKey(id)))
        let st = store(id)
        if block && !s.applicationTokens.isEmpty {
            st.shield.applications = s.applicationTokens
        } else {
            st.clearAllSettings()
        }
    }

    /// مراقبة يومية (من منتصف الليل): عند بلوغ الحد يحجب الامتداد اللعبة، ومع يوم جديد يفتحها.
    static func schedule(_ id: String) throws {
        let center = DeviceActivityCenter()
        center.stopMonitoring([activity(id)])
        let m = limit(id), s = selection(id)
        guard m > 0, !s.applicationTokens.isEmpty else { return }
        let day = DeviceActivitySchedule(intervalStart: DateComponents(hour: 0, minute: 0),
                                         intervalEnd: DateComponents(hour: 23, minute: 59, second: 59), repeats: true)
        let event = DeviceActivityEvent(applications: s.applicationTokens, threshold: DateComponents(minute: m))
        try center.startMonitoring(activity(id), during: day, events: [limitEvent: event])
    }

    /// يُستدعى من امتداد المراقبة.
    static func gameID(of activity: DeviceActivityName) -> String? {
        let raw = activity.rawValue
        return raw.hasPrefix("hisn.game.") ? String(raw.dropFirst("hisn.game.".count)) : nil
    }

    static func limitReached(_ id: String) {
        AppGroup.defaults.set(true, forKey: doneKey(id))
        apply(id)
    }

    static func newDay(_ id: String) {
        AppGroup.defaults.set(false, forKey: doneKey(id))
        apply(id)
    }
}
