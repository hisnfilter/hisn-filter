import ManagedSettings

/// أزرار شاشة الحجب: "إغلاق" يغلق التطبيق، و"تخطي" يرفع حجب الفحص لثوانٍ ليسحب المستخدم للمقطع التالي.
final class ShieldActionExtension: ShieldActionDelegate {
    override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        completionHandler(respond(action))
    }

    override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        completionHandler(respond(action))
    }

    override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        completionHandler(respond(action))
    }

    private func respond(_ action: ShieldAction) -> ShieldActionResponse {
        switch action {
        case .primaryButtonPressed:
            if HisnSettings.scanShieldActive { Shields.clearScan(grace: 1.5) }
            return .close
        case .secondaryButtonPressed:
            guard HisnSettings.scanShieldActive else { return .none }
            Shields.clearScan(grace: 2.5)
            return .defer
        @unknown default:
            return .close
        }
    }
}
