import CoreMedia
import ImageIO
import ReplayKit

/// امتداد "فحص الشاشة": يبدأ من زر التسجيل في مركز التحكم (بث على الجهاز نفسه، لا يُرسل شيء).
/// كل ~0.6 ثانية يحلل إطارًا: إن وُجد محتوى مخالف يحجب التطبيقات المراقبة بشاشة حصن فورًا.
/// حد الذاكرة في هذا النوع من الامتدادات نحو 50MB، لذلك نصغّر الإطار ونحلل إطارًا واحدًا في كل مرة.
final class SampleHandler: RPBroadcastSampleHandler {
    private let scanner = ScreenScanner()
    private var lastScan = Date.distantPast
    private var busy = false
    private let queue = DispatchQueue(label: "hisn.scan", qos: .userInitiated)

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        HisnSettings.scanRunning = true
    }

    override func broadcastFinished() {
        HisnSettings.scanRunning = false
        Shields.clearScan(grace: 0)
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with type: RPSampleBufferType) {
        guard type == .video else { return }
        let now = Date()
        // الشاشة محجوبة الآن، أو المستخدم ضغط "تخطي" للتو: لا حاجة للفحص
        if busy || now.timeIntervalSince(lastScan) < 0.6 || HisnSettings.scanShieldActive || now < HisnSettings.scanGraceUntil { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        busy = true
        lastScan = now
        let orientation = Self.orientation(of: sampleBuffer)
        queue.async { [weak self] in
            guard let self else { return }
            let image = self.scanner.prepare(pixelBuffer, orientation: orientation)
            Task {
                defer { self.busy = false }
                guard let image else { return }
                let verdict = await self.scanner.scan(image, viewer: HisnSettings.viewer, level: HisnSettings.level)
                if case let .violation(reason) = verdict { Shields.shieldForScan(reason: reason) }
            }
        }
    }

    private static func orientation(of buffer: CMSampleBuffer) -> CGImagePropertyOrientation {
        guard let n = CMGetAttachment(buffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber,
              let o = CGImagePropertyOrientation(rawValue: n.uint32Value) else { return .up }
        return o
    }
}
