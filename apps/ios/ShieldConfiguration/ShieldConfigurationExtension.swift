import ManagedSettings
import ManagedSettingsUI
import UIKit

/// شكل شاشة حصن التي تغطي التطبيق: حجب دائم لتطبيق اختاره المستخدم، أو حجب مؤقت عند كشف محتوى مخالف.
final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private let brand = UIColor(red: 0x1F / 255, green: 0x6F / 255, blue: 0x5C / 255, alpha: 1)

    override func configuration(shielding application: Application) -> ShieldConfiguration {
        make(name: application.localizedDisplayName)
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        make(name: application.localizedDisplayName)
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        make(name: webDomain.domain)
    }

    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        make(name: webDomain.domain)
    }

    private func make(name: String?) -> ShieldConfiguration {
        let scan = HisnSettings.scanShieldActive
        let title = scan ? tr("حصن: غُطّي محتوى مخالف", "Hisn: unsuitable content covered") : tr("حصن: \(name ?? "هذا التطبيق") مقفل", "Hisn: \(name ?? "this app") is locked")
        let subtitle = scan
            ? tr("اضغط «تخطي» ثم انتقل مباشرة للمقطع التالي.\n«قُل لِّلْمُؤْمِنِينَ يَغُضُّوا مِنْ أَبْصَارِهِمْ»", "Tap “Skip”, then move straight to the next clip.")
            : tr("افتحه من «تصفح محمي» في تطبيق فلتر حصن.\nللسماح مؤقتًا: الإعدادات في حصن، مع الرمز.", "Open it from “Protected browsing” in Hisn Filter.\nTo allow for a while: Settings in Hisn, with the code.")
        return ShieldConfiguration(
            backgroundBlurStyle: .systemUltraThinMaterialDark,
            backgroundColor: UIColor(red: 0.07, green: 0.11, blue: 0.10, alpha: 0.96),
            icon: UIImage(systemName: "checkmark.shield.fill")?.withTintColor(brand, renderingMode: .alwaysOriginal),
            title: .init(text: title, color: .white),
            subtitle: .init(text: subtitle, color: UIColor(white: 0.85, alpha: 1)),
            primaryButtonLabel: .init(text: tr("إغلاق", "Close"), color: .white),
            primaryButtonBackgroundColor: brand,
            secondaryButtonLabel: scan ? .init(text: tr("تخطي", "Skip"), color: UIColor(white: 0.9, alpha: 1)) : nil
        )
    }
}
