import Foundation

/// إعدادات مشتركة بين التطبيق وامتداداته عبر مجموعة التطبيقات (App Group) — على الجهاز فقط.
enum AppGroup {
    static let id: String = Bundle.main.object(forInfoDictionaryKey: "HisnAppGroup") as? String ?? "group.hisnfilter"
    static var defaults: UserDefaults { UserDefaults(suiteName: id) ?? .standard }
}

/// لغة الواجهة (عربي أو إنجليزي)، يختارها المستخدم من زر 🌐. مشتركة مع الامتدادات (شاشة الحجب).
enum Lang {
    static var isEnglish: Bool {
        get { AppGroup.defaults.string(forKey: "lang") == "en" }
        set { AppGroup.defaults.set(newValue ? "en" : "ar", forKey: "lang") }
    }
}

/// النص بلغة الواجهة: tr("عربي", "English").
func tr(_ ar: String, _ en: String) -> String { Lang.isEnglish ? en : ar }

enum Viewer: String, CaseIterable, Identifiable {
    case male, female
    var id: String { rawValue }
    var title: String { self == .male ? tr("رجل", "Man") : tr("امرأة", "Woman") }
}

enum Level: String, CaseIterable, Identifiable {
    case light, medium, strict
    var id: String { rawValue }
    var title: String {
        switch self {
        case .light: return tr("مخفف", "Light")
        case .medium: return tr("متوسط", "Medium")
        case .strict: return tr("صارم", "Strict")
        }
    }
}

/// نفس أسماء الإعدادات في الإضافة وتطبيق أندرويد.
enum HisnSettings {
    private static var d: UserDefaults { AppGroup.defaults }

    static var onboarded: Bool {
        get { d.bool(forKey: "onboarded") }
        set { d.set(newValue, forKey: "onboarded") }
    }
    /// فتح خطوة «الحماية في Safari» مرة (أو أخفى قسم الإعداد من الرئيسية)؛ بعدها الأزرار في الإعدادات فقط
    static var safariSetupSeen: Bool {
        get { d.bool(forKey: "safariSetupSeen") }
        set { d.set(newValue, forKey: "safariSetupSeen") }
    }
    /// شاهد الجولة القصيرة بعد الإعداد الأول
    static var toured: Bool {
        get { d.bool(forKey: "toured") }
        set { d.set(newValue, forKey: "toured") }
    }
    static var viewer: Viewer {
        get { Viewer(rawValue: d.string(forKey: "viewer") ?? "") ?? .male }
        set { d.set(newValue.rawValue, forKey: "viewer") }
    }
    static var level: Level {
        get { Level(rawValue: d.string(forKey: "level") ?? "") ?? .medium }
        set { d.set(newValue.rawValue, forKey: "level") }
    }
    static var systemFilter: Bool {
        get { d.object(forKey: "systemFilter") as? Bool ?? true }
        set { d.set(newValue, forKey: "systemFilter") }
    }

    // القفل: بصمة PBKDF2 مع ملح، لا الرمز نفسه
    static var pinHash: String? {
        get { d.string(forKey: "pinHash") }
        set { d.set(newValue, forKey: "pinHash") }
    }
    static var pinSalt: String? {
        get { d.string(forKey: "pinSalt") }
        set { d.set(newValue, forKey: "pinSalt") }
    }
    static var lockEnabled: Bool { !(pinHash ?? "").isEmpty }
    static var unlockedUntil: Date {
        get { d.object(forKey: "unlockedUntil") as? Date ?? .distantPast }
        set { d.set(newValue, forKey: "unlockedUntil") }
    }
    static var unlocked: Bool { !lockEnabled || Date() < unlockedUntil }

    // فحص الشاشة
    static var scanShieldActive: Bool {
        get { d.bool(forKey: "scanShieldActive") }
        set { d.set(newValue, forKey: "scanShieldActive") }
    }
    static var scanReason: String {
        get { d.string(forKey: "scanReason") ?? "" }
        set { d.set(newValue, forKey: "scanReason") }
    }
    static var scanGraceUntil: Date {
        get { d.object(forKey: "scanGraceUntil") as? Date ?? .distantPast }
        set { d.set(newValue, forKey: "scanGraceUntil") }
    }
    static var scanRunning: Bool {
        get { d.bool(forKey: "scanRunning") }
        set { d.set(newValue, forKey: "scanRunning") }
    }

    // ===== وضع الطفل =====
    static var childMode: Bool {
        get { d.bool(forKey: "childMode") }
        set { d.set(newValue, forKey: "childMode") }
    }
    /// "9to12" (أقل من 13) | "13to15". القيمة القديمة "under9" تُعامل كأقل من 13.
    static var childAge: String {
        get { d.string(forKey: "childAge") == "13to15" ? "13to15" : "9to12" }
        set { d.set(newValue, forKey: "childAge") }
    }
    /// "boy" | "girl": يفرق في «حماية أشد» فقط (الولد تُغطّى عنه صور النساء).
    static var childSex: String {
        get { d.string(forKey: "childSex") == "boy" ? "boy" : "girl" }
        set { d.set(newValue, forKey: "childSex") }
    }
    /// الطفل دون 13: تُخفى المنصات التي لا تسمح بأقل من 13 (إنستغرام وتيك توك وغيرها).
    static var under13: Bool { childMode && childAge != "13to15" }
    /// دون 13: يوتيوب العادي بتقييد الصغار (بدل يوتيوب كيدز) — لقنوات يريدها الطفل وليست في كيدز
    static var youtubeChildRegular: Bool {
        get { d.bool(forKey: "youtubeChildRegular") }
        set { d.set(newValue, forKey: "youtubeChildRegular") }
    }
    /// هل يُحوَّل يوتيوب إلى يوتيوب كيدز؟ (دون 13 ولم يُختر يوتيوب العادي)
    static var youtubeToKids: Bool { under13 && !youtubeChildRegular }
    /// وضع الطفل: لا يُفتح إلا ما في قائمة التطبيقات (وما يلزمها لتسجيل الدخول)؛ أي موقع آخر يُحجب
    static var allowedSitesOnly: Bool {
        get { d.object(forKey: "allowedSitesOnly") as? Bool ?? true }
        set { d.set(newValue, forKey: "allowedSitesOnly") }
    }

    /// مواقع أضافها المستخدم إلى «تصفح محمي».
    /// آخر منصة فتحها المستخدم: تُهيّأ مسبقًا عند فتح التطبيق
    static var lastPlatform: String? {
        get { d.string(forKey: "lastPlatform") }
        set { d.set(newValue, forKey: "lastPlatform") }
    }
    /// تطبيقات مدمجة حذفها المستخدم من القائمة (تُستعاد من «استعادة»)
    static var hiddenPlatforms: [String] {
        get { d.stringArray(forKey: "hiddenPlatforms") ?? [] }
        set { d.set(newValue, forKey: "hiddenPlatforms") }
    }
    /// كلمات يضيفها ولي الأمر: أي عنوان مقطع فيها يُحذف (يوتيوب وتيك توك والألعاب) ويُوقف المقطع المفتوح
    static var blockedWords: [String] {
        get { d.stringArray(forKey: "blockedWords") ?? [] }
        set { d.set(newValue, forKey: "blockedWords") }
    }
    /// القنوات المسموحة في يوتيوب (وضع الطفل): [{name, handle}]
    static var allowedChannels: [[String: String]] {
        get { (d.array(forKey: "allowedChannels") as? [[String: String]]) ?? [] }
        set { d.set(newValue, forKey: "allowedChannels") }
    }
    /// مع القائمة: لا يظهر في يوتيوب إلا مقاطع القنوات المسموحة
    static var allowedChannelsOnly: Bool {
        get { d.bool(forKey: "allowedChannelsOnly") }
        set { d.set(newValue, forKey: "allowedChannelsOnly") }
    }
    static var customSites: [[String: String]] {
        get { (d.array(forKey: "customSites") as? [[String: String]]) ?? [] }
        set { d.set(newValue, forKey: "customSites") }
    }
    /// حماية العقيدة: إخفاء السحر والجن والرعب والهالوين.
    static var blockScaryTopics: Bool {
        get { d.object(forKey: "blockScaryTopics") as? Bool ?? true }
        set { d.set(newValue, forKey: "blockScaryTopics") }
    }
    /// إخفاء الإعلانات (ممول/Sponsored) في الخلاصات والبطاقات المروّجة في يوتيوب.
    static var hideAds: Bool {
        get { d.object(forKey: "hideAds") as? Bool ?? true }
        set { d.set(newValue, forKey: "hideAds") }
    }
    /// إخفاء منشورات «مقترح لك» من حسابات غير متابَعة في خلاصة إنستغرام.
    static var hideSuggested: Bool {
        get { d.object(forKey: "hideSuggested") as? Bool ?? true }
        set { d.set(newValue, forKey: "hideSuggested") }
    }
    /// كتم الموسيقى بالسماع (YAMNet في الجهاز على أول ثوانٍ من المقطع).
    static var muteMusicByEar: Bool {
        get { d.object(forKey: "muteMusicByEar") as? Bool ?? (childMode || level != .light) }
        set { d.set(newValue, forKey: "muteMusicByEar") }
    }
    static var ttUsername: String {
        get { d.string(forKey: "ttUsername") ?? "" }
        set { d.set(newValue, forKey: "ttUsername") }
    }
    /// حماية إكس وريديت (وسوم «حساس»/NSFW، ردود الإغراء، تبويبات الخوارزمية)
    static var protectX: Bool {
        get { d.object(forKey: "protectX") as? Bool ?? true }
        set { d.set(newValue, forKey: "protectX") }
    }
    /// منصات مدمجة غير معروضة افتراضيًا (تيك توك، فيسبوك، إكس، ريديت) أضافها المستخدم بنفسه
    static var addedPlatforms: [String] {
        get { d.stringArray(forKey: "addedPlatforms") ?? [] }
        set { d.set(newValue, forKey: "addedPlatforms") }
    }
    /// المنصات التي عُرضت فيها رسالة «سجّلي دخولك مرة واحدة داخل حصن»
    static var loginHintSeen: [String] {
        get { d.stringArray(forKey: "loginHintSeen") ?? [] }
        set { d.set(newValue, forKey: "loginHintSeen") }
    }
    /// حفظ عبارات بحث يوتيوب في ملخص النشاط (وضع الطفل فقط) — مستقل عن الأعداد
    static var logSearches: Bool {
        get { d.object(forKey: "logSearches") as? Bool ?? true }
        set { d.set(newValue, forKey: "logSearches"); if !newValue { Activity.clearSearches() } }
    }
    static var protectReddit: Bool {
        get { d.object(forKey: "protectReddit") as? Bool ?? true }
        set { d.set(newValue, forKey: "protectReddit") }
    }
    /// ريديت: المجتمعات المسموحة فقط (فارغة = كل المجتمعات غير الموسومة)
    static var redditAllowed: [String] {
        get { d.stringArray(forKey: "redditAllowed") ?? [] }
        set { d.set(newValue, forKey: "redditAllowed") }
    }
    /// اسم مستخدم إنستغرام (لأداة تنظيف الحساب: صفحة إعادات النشر)
    static var igUsername: String {
        get { d.string(forKey: "igUsername") ?? "" }
        set { d.set(newValue, forKey: "igUsername") }
    }
    /// إخفاء الشتائم العامة.
    static var maskInsults: Bool {
        get { d.object(forKey: "maskInsults") as? Bool ?? childMode }
        set { d.set(newValue, forKey: "maskInsults") }
    }

    /// زر واحد: كل الحمايات المناسبة لعمر الطفل (مثل childPreset في packages/core/src/topics.js).
    static func applyChildPreset(age: String) {
        childMode = true
        childAge = age
        if level == .light { level = .medium }
        blockScaryTopics = true
        maskInsults = true
        systemFilter = true
    }

    /// الإعدادات بصيغة الإضافة (لصفحات حصن داخل التطبيق).
    /// جيل الجهاز: "low" لشرائح A14 وما قبلها (iPhone 12 وأقدم، iPad بلا M1/A15) — فحص أخف وتيرة ولقطة واحدة لكل فحص
    static let perfTier: String = {
        var sys = utsname(); uname(&sys)
        let id = withUnsafePointer(to: &sys.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 256) { String(cString: $0) } }
        if let m = id.range(of: #"^(iPhone|iPad)(\d+),"#, options: .regularExpression) {
            let s = String(id[m]); let n = Int(s.filter(\.isNumber)) ?? 99
            if s.hasPrefix("iPhone") { return n <= 13 ? "low" : "normal" } // iPhone13,x = iPhone 12 (A14)
            return n <= 12 ? "low" : "normal" // iPad12,x = iPad 9 (A13)
        }
        return "normal"
    }()

    static func webSettings() -> [String: Any] {
        [
            "viewer": viewer.rawValue,
            "perfTier": perfTier,
            "level": level.rawValue,
            // للاختبار فقط (-hisnSet hisnOff=on): تعطيل الفلتر داخل المتصفح لمقارنة سلوك الصفحة بدوننا؛ يُصفَّر مع كل تشغيل من الماك
            "enabled": !d.bool(forKey: "hisnOff"),
            // القفل في التطبيق يسري داخل المتصفح المحمي أيضًا (الإظهار يطلب الرمز)
            "lockEnabled": lockEnabled,
            "childMode": childMode,
            "childAge": childAge,
            "childSex": childSex,
            "blockScaryTopics": blockScaryTopics,
            "hideSuggestive": childMode || viewer == .male,
            // كتم مقاطع الأغاني (تيك توك وإنستغرام وShorts) في المستوى المتوسط فما فوق
            "muteSongClips": childMode || level != .light,
            "muteMusicByEar": muteMusicByEar,
            "maskInsults": maskInsults,
            "hideAds": hideAds,
            "protectX": protectX,
            "protectReddit": protectReddit,
            "redditAllowed": redditAllowed,
            "hideSuggested": hideSuggested,
            "youtubeStrict": childMode && childAge != "13to15",
            "removeFlaggedCards": childMode,
            "blockedWords": blockedWords,
            "allowedChannels": allowedChannels,
            "imageVerdicts": Exceptions.verdicts,
            "allowedChannelsOnly": allowedChannelsOnly,
            "hideShortsAndComments": childMode && childAge != "13to15",
            "youtubeRestricted": level != .light || childMode,
        ]
    }

    static func data(_ key: String) -> Data? { d.data(forKey: key) }
    static func setData(_ v: Data?, _ key: String) { d.set(v, forKey: key) }
}


/// ملخص النشاط (وضع الطفل): أعداد لكل يوم وعناوين بحث — على الجهاز فقط، آخر 14 يومًا.
enum Activity {
    private static let key = "activityByDay"
    private static var fmt: DateFormatter { let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f }
    static func today() -> String { fmt.string(from: Date()) }

    static var all: [String: [String: Any]] {
        get { (AppGroup.defaults.dictionary(forKey: key) as? [String: [String: Any]]) ?? [:] }
        set { AppGroup.defaults.set(newValue, forKey: key) }
    }

    static let retentionDays = 14
    /// أول يوم (بالتاريخ الفعلي) ضمن آخر n يومًا تقويميًا، شاملًا اليوم
    static func firstDay(of n: Int, now: Date = Date()) -> String {
        fmt.string(from: Calendar(identifier: .gregorian).date(byAdding: .day, value: -(n - 1), to: now) ?? now)
    }
    /// يحذف ما تجاوز عمره 14 يومًا بالتاريخ الفعلي (لا «آخر 14 يومًا مسجّلًا»)
    static func pruned(_ days: [String: [String: Any]], now: Date = Date()) -> [String: [String: Any]] {
        let first = firstDay(of: retentionDays, now: now)
        return days.filter { $0.key >= first }
    }
    static func prune() { let p = pruned(all); if p.count != all.count { all = p } }
    static func clearSearches() {
        var days = all
        for k in days.keys { days[k]?["searches"] = nil }
        all = days
    }

    /// يضيف أعدادًا لليوم ("hidden" | "stopped" | "blocked") وعبارات بحث يوتيوب (بلا تكرار، 40 كحد أقصى، إن سمح الوالد)
    static func record(hidden: Int = 0, stopped: Int = 0, blocked: Int = 0, searches: [String] = []) {
        let searches = HisnSettings.logSearches ? searches : []
        var days = all
        let d = today()
        var day = days[d] ?? [:]
        for (k, n) in [("hidden", hidden), ("stopped", stopped), ("blocked", blocked)] where n > 0 { day[k] = ((day[k] as? Int) ?? 0) + n }
        if !searches.isEmpty {
            var list = (day["searches"] as? [String]) ?? []
            for q in searches where !list.contains(q) { list.append(String(q.prefix(60))) }
            day["searches"] = Array(list.suffix(40))
        }
        days[d] = day
        all = pruned(days)
    }

    /// مجموع آخر n يومًا تقويميًا (لا آخر n يومًا مسجّلًا)
    static func totals(days n: Int = 7, now: Date = Date()) -> (hidden: Int, stopped: Int, blocked: Int) {
        let first = firstDay(of: n, now: now), last = fmt.string(from: now)
        var h = 0, s = 0, b = 0
        for (k, d) in all where k >= first && k <= last { h += (d["hidden"] as? Int) ?? 0; s += (d["stopped"] as? Int) ?? 0; b += (d["blocked"] as? Int) ?? 0 }
        return (h, s, b)
    }

    static func clear() { AppGroup.defaults.removeObject(forKey: key) }
}

/// تصحيحات الصور («سليمة دائمًا» / «أخفيتِها بنفسك»): مفتاح بصمة الصورة (لا رابطها) مع وصف قصير ليعرفها الوالد
/// في «الاستثناءات». التصحيح يخص تلك الصورة وحدها، لا الحساب ولا الموقع.
enum Exceptions {
    static let max = 5000
    static var verdicts: [String: String] {
        get { (AppGroup.defaults.dictionary(forKey: "imageVerdicts") as? [String: String]) ?? [:] }
        set { AppGroup.defaults.set(newValue, forKey: "imageVerdicts") }
    }
    /// key → ["host", "label", "date"]
    static var meta: [String: [String: String]] {
        get { (AppGroup.defaults.dictionary(forKey: "imageVerdictMeta") as? [String: [String: String]]) ?? [:] }
        set { AppGroup.defaults.set(newValue, forKey: "imageVerdictMeta") }
    }
    static func isValidKey(_ k: String) -> Bool { k.range(of: "^[0-9a-f]{8,64}$", options: .regularExpression) != nil }

    static func set(_ key: String, _ verdict: String, host: String, label: String) {
        guard isValidKey(key), verdict == "safe" || verdict == "unsafe" else { return }
        var v = verdicts, m = meta
        v[key] = verdict
        m[key] = ["host": String(host.prefix(60)), "label": String(label.prefix(80)), "date": Activity.today()]
        // الأقدم يُحذف أولًا عند تجاوز الحد
        if v.count > max {
            let old = v.keys.sorted { (m[$0]?["date"] ?? "") < (m[$1]?["date"] ?? "") }.prefix(v.count - max)
            for k in old { v[k] = nil; m[k] = nil }
        }
        verdicts = v; meta = m
    }
    static func remove(_ keys: [String]) {
        var v = verdicts, m = meta
        for k in keys { v[k] = nil; m[k] = nil }
        verdicts = v; meta = m
    }
    struct Item: Identifiable, Hashable { let id: String; let verdict: String; let host: String; let label: String; let date: String }
    static func items(_ verdict: String) -> [Item] {
        let m = meta
        return verdicts.filter { $0.value == verdict }.map { k, v in
            Item(id: k, verdict: v, host: m[k]?["host"] ?? "", label: m[k]?["label"] ?? "", date: m[k]?["date"] ?? "")
        }.sorted { $0.date > $1.date }
    }
}

/// «اطلب من ولي الأمر مراجعتها» في وضع الطفل: طلب محفوظ على الجهاز فقط (حتى 30 طلبًا، 14 يومًا)، لا يفتح المحتوى.
/// يراه الوالد في «الاستثناءات وطلبات المراجعة» فيسمح بالصورة أو يرفض.
enum ReviewRequests {
    struct Item: Identifiable, Hashable { let id: String; let key: String; let host: String; let label: String; let page: String; let date: String }
    static var raw: [[String: String]] {
        get { (AppGroup.defaults.array(forKey: "reviewRequests") as? [[String: String]]) ?? [] }
        set { AppGroup.defaults.set(newValue, forKey: "reviewRequests") }
    }
    static var all: [Item] {
        let first = Activity.firstDay(of: Activity.retentionDays)
        return raw.filter { ($0["date"] ?? "") >= first }.map {
            Item(id: $0["id"] ?? UUID().uuidString, key: $0["key"] ?? "", host: $0["host"] ?? "", label: $0["label"] ?? "", page: $0["page"] ?? "", date: $0["date"] ?? "")
        }
    }
    static var count: Int { all.count }
    static func add(key: String, host: String, label: String, page: String) {
        var list = raw.filter { ($0["date"] ?? "") >= Activity.firstDay(of: Activity.retentionDays) }
        // الطلب نفسه مرة واحدة
        if !key.isEmpty, list.contains(where: { $0["key"] == key }) { return }
        list.append(["id": UUID().uuidString, "key": Exceptions.isValidKey(key) ? key : "", "host": String(host.prefix(60)),
                     "label": String(label.prefix(80)), "page": String(page.prefix(500)), "date": Activity.today()])
        raw = Array(list.suffix(30))
    }
    static func remove(_ id: String) { raw = raw.filter { $0["id"] != id } }
    static func clear() { raw = [] }
}
