import Foundation
import SafariServices

/// جسر بين إضافة Safari والتطبيق: يعطي الإضافة إعدادات التطبيق (من يستخدم الجهاز، والمستوى، والقفل)
/// عند طلبها بـ browser.runtime.sendNativeMessage. كود الإضافة نفسه في apps/extension.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        var reply: [String: Any] = ["ok": true]
        if message?["type"] as? String == "hisn:native-settings" {
            reply["settings"] = [
                "viewer": HisnSettings.viewer.rawValue,
                "level": HisnSettings.level.rawValue,
                "lockEnabled": HisnSettings.lockEnabled,
            ]
        }
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
