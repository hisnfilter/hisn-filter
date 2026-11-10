import DeviceActivity
import ManagedSettings

/// يعمل حتى لو كان التطبيق مغلقًا:
/// - عند انتهاء السماح المؤقت (15 دقيقة) يعيد حجب التطبيقات المختارة.
/// - الألعاب: عند بلوغ الحد اليومي تُحجب اللعبة، ومع بداية يوم جديد تُفتح (إلا إن كانت مقفلة).
final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        if let id = Games.gameID(of: activity) { Games.newDay(id) }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        if activity == .hisnUnlock {
            Shields.applyApps()
        }
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        if event == Games.limitEvent, let id = Games.gameID(of: activity) { Games.limitReached(id) }
    }
}
