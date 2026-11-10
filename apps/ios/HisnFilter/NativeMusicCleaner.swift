import AVFoundation
import BackgroundTasks
import Photos
import UIKit
import OnnxRuntimeBindings
import UserNotifications

/// «أزل الموسيقى» بكود الآيفون نفسه: يكمل حتى لو خرج المستخدم من التطبيق (iOS 26: المعالجة المستمرة،
/// بشريط تقدم في شاشة القفل)، ثم يحفظ الفيديو في الصور ويرسل إشعارًا.
/// الصورة تُنسخ كما هي (بلا إعادة ترميز)، والصوت: الأصل ناقص الموسيقى المقدّرة (نفس نموذج UVR).
@MainActor
final class NativeMusicJob: ObservableObject {
    static let shared = NativeMusicJob()
    static let taskID = (Bundle.main.bundleIdentifier ?? "hisn") + ".clean.music"

    @Published private(set) var running = false
    /// يُستدعى مع (التقدم 0..1، اسم المرحلة) ثم عند الانتهاء (نجاح، رسالة)
    var onProgress: ((Double, String) -> Void)?
    var onDone: ((Bool, String) -> Void)?

    private var pending: (url: URL, name: String, bed: String)?
    /// مجلد ثابت للعمل الجاري (لا يُحذف إن أوقف النظام العمل، فيكمل لاحقًا)
    static let jobDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("hisn-music-job", isDirectory: true)
    private static let jobKey = "music.job"
    private var registered = false

    func start(url: URL, name: String, bed: String = "none") {
        guard !running else { HisnLog.write("music: start ignored (running)"); return }
        AppActive.shared.set(UIApplication.shared.applicationState == .active)
        running = true
        // عمل جديد: مجلد نظيف، والفيديو يُنقل إليه (لا يضيع إن أوقف النظام العمل)
        let fm = FileManager.default
        try? fm.removeItem(at: Self.jobDir)
        try? fm.createDirectory(at: Self.jobDir, withIntermediateDirectories: true)
        let kept = Self.jobDir.appendingPathComponent("input." + (url.pathExtension.isEmpty ? "mp4" : url.pathExtension))
        if (try? fm.moveItem(at: url, to: kept)) == nil { try? fm.copyItem(at: url, to: kept) }
        AppGroup.defaults.set(["name": name, "bed": bed, "file": kept.lastPathComponent], forKey: Self.jobKey)
        pending = (kept, name, bed)
        let url = kept
        let mb = ((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) / 1_000_000
        HisnLog.write("music: start \(url.lastPathComponent) \(mb)MB bed=\(bed)")
        Task { @MainActor in
            // الإذن يُطلب الآن والتطبيق ظاهر: في الخلفية لا تظهر نافذة الإذن فيفشل الحفظ في آخر العمل
            let photos = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard photos == .authorized || photos == .limited else {
                pending = nil
                running = false
                onDone?(false, tr("اسمح لفلتر حصن بإضافة الصور: الإعدادات ← فلتر حصن ← الصور", "Allow Hisn Filter to add photos: Settings → Hisn Filter → Photos"))
                finishJob()
                return
            }
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            submit()
        }
    }

    /// عمل أوقفه النظام (الجوال قُفل): يكمل من حيث وقف عند فتح التطبيق.
    func resumeIfNeeded() {
        AppActive.shared.set(UIApplication.shared.applicationState == .active)
        guard !running, let job = AppGroup.defaults.dictionary(forKey: Self.jobKey),
              let name = job["name"] as? String, let file = job["file"] as? String else { return }
        let url = Self.jobDir.appendingPathComponent(file)
        guard FileManager.default.fileExists(atPath: url.path) else { AppGroup.defaults.removeObject(forKey: Self.jobKey); return }
        HisnLog.write("music: resuming \(name)")
        running = true
        pending = (url, name, job["bed"] as? String ?? "none")
        submit()
    }

    private func finishJob() {
        try? FileManager.default.removeItem(at: Self.jobDir)
        AppGroup.defaults.removeObject(forKey: Self.jobKey)
    }

    private func submit() {
        if #available(iOS 26.0, *) {
            registerIfNeeded()
            let req = BGContinuedProcessingTaskRequest(identifier: Self.taskID,
                                                      title: tr("تنظيف فيديو", "Cleaning a video"),
                                                      subtitle: tr("إزالة الموسيقى…", "Removing music…"))
            req.strategy = .fail
            do {
                try BGTaskScheduler.shared.submit(req)
                HisnLog.write("music: background task submitted")
                return
            } catch {
                // النظام لم يقبل المهمة: نعمل والتطبيق مفتوح كالمعتاد
                HisnLog.write("music: submit refused → foreground: \(HisnLog.describe(error))")
            }
        }
        Task { await runJob(task: nil) }
    }

    @available(iOS 26.0, *)
    private func registerIfNeeded() {
        guard !registered else { return }
        registered = true
        let ok = BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskID, using: nil) { task in
            HisnLog.write("music: background task launched (\(type(of: task)))")
            guard let task = task as? BGContinuedProcessingTask else { task.setTaskCompleted(success: false); return }
            Task { @MainActor in await NativeMusicJob.shared.runJob(task: task) }
        }
        HisnLog.write("music: register \(ok)")
    }

    private func runJob(task: AnyObject?) async {
        guard let (url, name, bed) = pending else {
            running = false
            // لا عمل معلّق (مثل تشغيل النظام للمهمة مرتين): نُنهيها بنجاح بدل أن يعرض النظام «فشل»
            if #available(iOS 26.0, *), let t = task as? BGContinuedProcessingTask { t.setTaskCompleted(success: true) }
            return
        }
        pending = nil
        let worker = MusicRemover(input: url, bed: bed, dir: Self.jobDir.appendingPathComponent("work", isDirectory: true))
        var cancelled = false
        if #available(iOS 26.0, *), let t = task as? BGContinuedProcessingTask {
            t.progress.totalUnitCount = 1000
            t.expirationHandler = { HisnLog.write("music: EXPIRED by system at \(worker.stage)"); worker.cancel(); cancelled = true }
        }
        // التقدم يُرسل للواجهة 4 مرات في الثانية على الأكثر (الإرسال مع كل دفعة كان يُثقل الجهاز)
        var lastSent = 0.0, lastStage = ""
        let report: (Double, String) -> Void = { [weak self] p, stage in
            let now = CFAbsoluteTimeGetCurrent()
            guard stage != lastStage || now - lastSent >= 0.25 || p >= 1 else { return }
            if stage != lastStage { HisnLog.write("music: stage \(stage) p=\(String(format: "%.2f", p))") }
            lastSent = now; lastStage = stage
            Task { @MainActor in
                self?.onProgress?(p, stage)
                if #available(iOS 26.0, *), let t = task as? BGContinuedProcessingTask {
                    t.progress.completedUnitCount = Int64(p * 1000)
                    t.updateTitle(tr("تنظيف فيديو", "Cleaning a video"), subtitle: stage)
                }
            }
        }
        do {
            // أولوية «بدأه المستخدم»: مهمة الخلفية تُشغَّل بأولوية منخفضة فيبطؤ الفصل ٦ مرات (مقيس على الجهاز)
            let out = try await Task.detached(priority: .userInitiated) { try await worker.run(progress: report) }.value
            HisnLog.write("music: done \(worker.diag)")
            try await Self.saveToPhotos(out)
            HisnLog.write("music: saved to Photos")
            try? FileManager.default.removeItem(at: out)
            finishJob()
            Self.notify(ok: true, name: name)
            onDone?(true, tr("حُفظ الفيديو النظيف في الصور ✓", "The clean video was saved to Photos ✓"))
            if #available(iOS 26.0, *), let t = task as? BGContinuedProcessingTask { t.setTaskCompleted(success: true) }
        } catch {
            let e = error as NSError
            HisnLog.write("music: FAILED cancelled=\(cancelled) stage=\(worker.stage) \(HisnLog.describe(error)) diag=\(worker.diag)")
            // أوقفه النظام (غالبًا لأن الجوال قُفل): يبقى العمل محفوظًا ويكمل عند فتح التطبيق
            let paused = cancelled || e.code == 2
            if !paused { finishJob() }
            let msg = paused ? tr("توقف مؤقتًا لأن الجوال قُفل. افتح فلتر حصن ويكمل من حيث وقف.", "Paused because the phone locked. Open Hisn Filter and it continues where it stopped.")
                : "\(e.localizedDescription)\n[\(worker.stage) · \(e.domain) \(e.code) · \(worker.diag)]"
            Self.notify(ok: false, name: name, paused: paused)
            onDone?(false, msg)
            // التوقف المؤقت ليس فشلًا (نكمل بأنفسنا): إبلاغ النظام بالفشل يجعله يعرض إشعار «Task failed» فوق إشعارنا
            if #available(iOS 26.0, *), let t = task as? BGContinuedProcessingTask { t.setTaskCompleted(success: paused) }
        }
        running = false
    }

    static func saveToPhotos(_ file: URL) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            throw NSError(domain: "hisn", code: 1, userInfo: [NSLocalizedDescriptionKey: tr("اسمح لفلتر حصن بإضافة الصور: الإعدادات ← فلتر حصن ← الصور", "Allow Hisn Filter to add photos: Settings → Hisn Filter → Photos")])
        }
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetCreationRequest.creationRequestForAssetFromVideo(atFileURL: file)
        }
    }

    static func notify(ok: Bool, name: String, paused: Bool = false) {
        // الإشعار يفيد فقط إن كان المستخدم خارج التطبيق
        guard UIApplication.shared.applicationState != .active else { return }
        // إشعار واحد للتنظيف في كل وقت: الجديد يحل محل القديم بدل أن تتكدس
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: [notifyID])
        center.removePendingNotificationRequests(withIdentifiers: [notifyID])
        let c = UNMutableNotificationContent()
        c.title = ok ? tr("الفيديو النظيف جاهز ✓", "Your clean video is ready ✓") : paused ? tr("التنظيف متوقف مؤقتًا", "Cleaning paused") : tr("لم يكتمل التنظيف", "Cleaning didn't finish")
        c.body = ok ? tr("حُفظ في الصور: \(name)", "Saved to Photos: \(name)")
            : paused ? tr("افتح فلتر حصن ويكمل من حيث وقف.", "Open Hisn Filter and it continues where it stopped.")
            : tr("افتح فلتر حصن وأعد المحاولة.", "Open Hisn Filter and try again.")
        c.sound = .default
        center.add(UNNotificationRequest(identifier: notifyID, content: c, trigger: nil))
    }
    static let notifyID = "hisn.music.job"
    /// عند فتح التطبيق: إشعار التنظيف أدى غرضه
    static func clearNotifications() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [notifyID])
    }
}

/// العمل نفسه، خارج الخيط الرئيسي: قراءة الصوت إلى ملف، ثم فصل الموسيقى على مقاطع، ثم كتابة الفيديو.
final class MusicRemover: @unchecked Sendable {
    let input: URL
    private var stopped = false
    private let dir: URL
    static let rate = 44100
    static let chunk = 15 * 44100 // 15 ثانية: ما لا موسيقى فيه يُترك كما هو (أسرع بكثير)
    static let pad = 44100 // ثانية قبل وبعد كل مقطع تُحذف (حواف النموذج)

    /// المرحلة الحالية وملاحظات التشخيص (تظهر مع رسالة الخطأ)
    private(set) var stage = "start"
    private(set) var diag = ""

    let bedKind: String
    /// dir: مجلد العمل. إن كان فيه عمل سابق لم يكتمل (أوقفه النظام) يكمل من حيث وقف.
    init(input: URL, bed: String = "none", dir: URL? = nil) {
        self.input = input; self.bedKind = bed
        self.dir = dir ?? FileManager.default.temporaryDirectory.appendingPathComponent("hisn-native-\(UUID().uuidString)", isDirectory: true)
    }

    /// يحذف ملفات العمل (بعد النجاح أو الإلغاء النهائي)
    func cleanup() { try? FileManager.default.removeItem(at: dir) }

    // خلفية هادئة مكان الموسيقى (اختيارية): تدخل بتدرّج في الأجزاء التي حُذفت منها الموسيقى وتخرج بعدها
    private lazy var bedL = Ambient(kind: bedKind, rate: Double(Self.rate), seed: 11)
    private lazy var bedR = Ambient(kind: bedKind, rate: Double(Self.rate), seed: 29)
    private var bedGain: Float = 0
    private func bedSample(target: Float) -> (Float, Float) {
        guard bedKind != "none" else { return (0, 0) }
        bedGain += (target - bedGain) / Float(0.5 * Double(Self.rate))
        let l = bedL.next(), r = bedR.next() // تتقدم دائمًا فلا تنقطع
        return bedGain > 1e-4 ? (l * bedGain, r * bedGain) : (0, 0)
    }
    func cancel() { stopped = true }

    private func check() throws {
        if stopped { throw NSError(domain: "hisn", code: 2, userInfo: [NSLocalizedDescriptionKey: "stopped"]) }
    }

    func run(progress: @escaping (Double, String) -> Void) async throws -> URL {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let asset = AVURLAsset(url: input)
        guard let audio = try await asset.loadTracks(withMediaType: .audio).first else {
            throw NSError(domain: "hisn", code: 3, userInfo: [NSLocalizedDescriptionKey: tr("لا يوجد صوت في هذا الفيديو.", "This video has no sound.")])
        }
        let video = try await asset.loadTracks(withMediaType: .video).first
        let duration = try await asset.load(.duration).seconds

        // ٠) الموسيقى في مسار صوت مستقل؟ (بعض الملفات فيها أكثر من مسار): نحذف مسار الموسيقى فورًا،
        // بلا فصل ولا إعادة ترميز — أنقى وأسرع ما يمكن
        let allAudio = try await asset.loadTracks(withMediaType: .audio)
        if allAudio.count > 1, let yam = try? NativeYamnet() {
            stage = "tracks"
            var keep: [AVAssetTrack] = []
            for t in allAudio {
                let isMusic = (try? await Self.isMusicTrack(asset, t, yam)) ?? false
                if !isMusic { keep.append(t) }
            }
            HisnLog.write("music: \(allAudio.count) audio tracks, keeping \(keep.count)")
            if !keep.isEmpty, keep.count < allAudio.count {
                progress(0.5, tr("حذف مسار الموسيقى", "Removing the music track"))
                let out = dir.appendingPathComponent("clean.mov")
                try await Self.exportWithout(asset: asset, video: video, audio: keep, to: out)
                stage = "save"
                diag = "music track removed"
                return out
            }
        }

        // ١) الصوت إلى ملف (أرقام عشرية متداخلة، قناتان، 44.1kHz)
        stage = "decode"
        progress(0, tr("قراءة الصوت", "Reading audio"))
        let rawIn = dir.appendingPathComponent("in.raw")
        let stateURL = dir.appendingPathComponent("state.json")
        let frames: Int, audioStart: CMTime
        if let d = try? Data(contentsOf: stateURL), let st = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let f = st["frames"] as? Int, let v = st["startValue"] as? Int64, let ts = st["startScale"] as? Int32,
           FileManager.default.fileExists(atPath: rawIn.path) {
            // استكمال: الصوت مقروء من قبل
            frames = f; audioStart = CMTime(value: v, timescale: ts)
            HisnLog.write("music: resume (decoded already, \(frames / Self.rate)s)")
        } else {
            (frames, audioStart) = try await decodeAudio(asset: asset, track: audio, to: rawIn) { p in progress(0.08 * p, tr("قراءة الصوت", "Reading audio")) }
            let st: [String: Any] = ["frames": frames, "startValue": audioStart.value, "startScale": audioStart.timescale]
            try? JSONSerialization.data(withJSONObject: st).write(to: stateURL)
        }

        // ٢) فصل الموسيقى على مقاطع 30 ثانية (مع هامش ثانية) — الذاكرة ثابتة مهما طال الفيديو
        guard let model = Bundle.main.path(forResource: "inst-hq4-w8", ofType: "onnx", inDirectory: "web/models/uvr") else {
            throw NSError(domain: "hisn", code: 11, userInfo: [NSLocalizedDescriptionKey: tr("نموذج الفصل غير موجود", "Separation model missing")])
        }
        stage = "model"
        // المحرك العصبي والتطبيق ظاهر (أسرع ٤ مرات تقريبًا)، والمعالج حين يكون في الخلفية
        let separator = try NativeSeparator(modelPath: model, accelerate: true, useAccel: { AppActive.shared.isActive })
        let yamnet = try? NativeYamnet()
        let t0 = CFAbsoluteTimeGetCurrent()
        var separated = 0, skipped = 0
        let rawOut = dir.appendingPathComponent("out.raw")
        if !FileManager.default.fileExists(atPath: rawOut.path) { FileManager.default.createFile(atPath: rawOut.path, contents: nil) }
        let inH = try FileHandle(forReadingFrom: rawIn), outH = try FileHandle(forWritingTo: rawOut)
        defer { try? inH.close(); try? outH.close() }
        // ما كُتب سابقًا يبقى: نكمل من أول جزء كامل لم يُكتب (جزء ناقص يُعاد)
        let written = Int(try outH.seekToEnd()) / 8
        var start = min(frames, (written / Self.chunk) * Self.chunk)
        if written >= frames { start = frames }
        try outH.truncate(atOffset: UInt64(start * 8))
        try outH.seek(toOffset: UInt64(start * 8))
        if start > 0 { HisnLog.write("music: resume from \(start / Self.rate)s") }
        while start < frames {
            try check()
            let end = min(frames, start + Self.chunk)
            let a = max(0, start - Self.pad), b = min(frames, end + Self.pad)
            let (l, r) = try readFrames(inH, from: a, count: b - a)
            let base = 0.08 + 0.80 * Double(start) / Double(max(1, frames))
            let span = 0.80 * Double(end - start) / Double(max(1, frames))
            stage = "separate \(start / Self.rate)s"
            HisnLog.write("music: chunk \(start / Self.rate)s")
            // لا موسيقى في هذا الجزء (أو صمت): يبقى الصوت الأصلي كما هو، بلا فصل
            let hasMusic = yamnet?.hasMusic(l, r, from: start - a, to: end - a) ?? true
            HisnLog.write("music: chunk \(start / Self.rate)s music=\(hasMusic)")
            if !hasMusic {
                skipped += 1
                var out = [Float](repeating: 0, count: (end - start) * 2)
                for i in 0..<(end - start) {
                    let (b0, b1) = bedSample(target: 0)
                    out[2 * i] = l[start - a + i] + b0; out[2 * i + 1] = r[start - a + i] + b1
                }
                try outH.write(contentsOf: out.withUnsafeBufferPointer { Data(buffer: $0) })
                progress(base + span, tr("إزالة الموسيقى وإبقاء الكلام", "Removing music, keeping speech"))
                start = end
                continue
            }
            separated += 1
            let m = try separator.music(l, r) { p in progress(base + span * Double(p), tr("إزالة الموسيقى وإبقاء الكلام", "Removing music, keeping speech")) }
            diag = "\(separator.backend) · \(separated) فصل/\(skipped) بلا موسيقى · \(Int(CFAbsoluteTimeGetCurrent() - t0))ث"
            // الكلام = الأصل ناقص الموسيقى، ونحفظ وسط المقطع فقط
            var out = [Float](repeating: 0, count: (end - start) * 2)
            for i in 0..<(end - start) {
                let j = start - a + i
                out[2 * i] = l[j] - (j < m[0].count ? m[0][j] : 0)
                out[2 * i + 1] = r[j] - (j < m[1].count ? m[1][j] : 0)
            }
            // بقايا الموسيقى: نصف ثانية بلا أي كلام (ولا كلام بجوارها) تُصمت بتلاشٍ ناعم — مثل الإضافة
            if let yamnet { gateLeftover(&out, yamnet: yamnet, bedOn: bedKind != "none") }
            // الخلفية الهادئة بعد الإسكات (لا تُصمت معه)
            if bedKind != "none" {
                for i in 0..<(end - start) {
                    let (b0, b1) = bedSample(target: 1)
                    out[2 * i] += b0; out[2 * i + 1] += b1
                }
            }
            try outH.write(contentsOf: out.withUnsafeBufferPointer { Data(buffer: $0) })
            start = end
        }
        try outH.synchronize()

        // ٣) الفيديو: الصورة كما هي، والصوت الجديد AAC
        try check()
        stage = "write"
        progress(0.9, tr("حفظ الفيديو", "Saving the video"))
        let output = dir.appendingPathComponent("clean.mp4")
        try await write(asset: asset, video: video, raw: rawOut, frames: frames, audioStart: audioStart, to: output) { p in
            progress(0.9 + 0.1 * p, tr("حفظ الفيديو", "Saving the video"))
        }
        _ = duration
        stage = "save"
        return output
    }

    /// مسار صوت كله موسيقى بلا كلام؟ (أول دقيقة منه)
    private static func isMusicTrack(_ asset: AVAsset, _ track: AVAssetTrack, _ yam: NativeYamnet) async throws -> Bool {
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: 60, preferredTimescale: 600))
        let out = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVLinearPCMIsBigEndianKey: false,
        ])
        reader.add(out)
        guard reader.startReading() else { return false }
        var x: [Float] = []
        while let sb = out.copyNextSampleBuffer(), let bb = CMSampleBufferGetDataBuffer(sb) {
            let len = CMBlockBufferGetDataLength(bb)
            var chunk = [Float](repeating: 0, count: len / 4)
            _ = chunk.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(bb, atOffset: 0, dataLength: len, destination: $0.baseAddress!) }
            x.append(contentsOf: chunk)
        }
        var music = 0, speech = 0, n = 0
        var i = 0
        while i + NativeYamnet.window <= x.count {
            let w = Array(x[i..<(i + NativeYamnet.window)])
            if (w.map(abs).max() ?? 0) >= 1e-3, let s = yam.scores16(w) {
                n += 1
                if NativeYamnet.isMusic(s, sensitive: true) { music += 1 }
                if NativeYamnet.speechOf(s) >= 0.3 { speech += 1 }
            }
            i += 16000
        }
        return n > 0 && speech == 0 && music * 2 >= n
    }

    /// الفيديو كما هو مع مسارات الصوت المختارة فقط (بلا إعادة ترميز)
    private static func exportWithout(asset: AVAsset, video: AVAssetTrack?, audio: [AVAssetTrack], to out: URL) async throws {
        let comp = AVMutableComposition()
        let range = CMTimeRange(start: .zero, duration: try await asset.load(.duration))
        if let video, let v = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try v.insertTimeRange(range, of: video, at: .zero)
            v.preferredTransform = try await video.load(.preferredTransform)
        }
        for a in audio {
            try comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)?.insertTimeRange(range, of: a, at: .zero)
        }
        try? FileManager.default.removeItem(at: out)
        guard let s = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else { throw NSError(domain: "hisn", code: 40) }
        s.outputURL = out
        s.outputFileType = .mov
        await s.export()
        if let e = s.error { throw e }
    }

    private static let pcmSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: rate,
        AVNumberOfChannelsKey: 2,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsNonInterleaved: false,
        AVLinearPCMIsBigEndianKey: false,
    ]

    private func decodeAudio(asset: AVAsset, track: AVAssetTrack, to file: URL, progress: (Double) -> Void) async throws -> (Int, CMTime) {
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: Self.pcmSettings)
        reader.add(output)
        guard reader.startReading() else { throw reader.error ?? NSError(domain: "hisn", code: 4) }
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let h = try FileHandle(forWritingTo: file)
        defer { try? h.close() }
        let total = max(1.0, try await asset.load(.duration).seconds * Double(Self.rate))
        var frames = 0
        var first: CMTime?
        while let sb = output.copyNextSampleBuffer() {
            try check()
            if first == nil { first = CMSampleBufferGetPresentationTimeStamp(sb) }
            guard let bb = CMSampleBufferGetDataBuffer(sb) else { continue }
            var len = 0
            var ptr: UnsafeMutablePointer<CChar>?
            guard CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr) == noErr, let ptr else { continue }
            // قد تكون البيانات على أجزاء: ننسخها كاملة
            var data = Data(count: len)
            _ = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(bb, atOffset: 0, dataLength: len, destination: $0.baseAddress!) }
            _ = ptr
            try h.write(contentsOf: data)
            frames += len / 8
            progress(min(1, Double(frames) / total))
        }
        if reader.status == .failed { throw reader.error ?? NSError(domain: "hisn", code: 5) }
        return (frames, first ?? .zero)
    }

    /// يصمت نوافذ نصف الثانية التي لا كلام فيها ولا في جاريها (تلاشٍ 50ms عند الحدود).
    private func gateLeftover(_ out: inout [Float], yamnet: NativeYamnet, bedOn: Bool) {
        let n = out.count / 2, slot = Self.rate / 2
        let slots = (n + slot - 1) / slot
        guard slots > 0 else { return }
        var l = [Float](repeating: 0, count: n), r = l
        for i in 0..<n { l[i] = out[2 * i]; r[i] = out[2 * i + 1] }
        var speechy = [Bool](repeating: true, count: slots), silent = [Bool](repeating: false, count: slots)
        for w in 0..<slots {
            let (win, peak) = NativeYamnet.window16(l, r, from: max(0, min(w * slot, n - Int(0.975 * Double(Self.rate)))))
            if peak < 1e-3 { silent[w] = true; speechy[w] = false; continue }
            if let sp = yamnet.speechScore(win) { speechy[w] = sp >= 0.2 }
        }
        var mute = [Bool](repeating: false, count: slots)
        for w in 0..<slots where !speechy[w] && !silent[w] {
            mute[w] = !(w > 0 && speechy[w - 1]) && !(w + 1 < slots && speechy[w + 1])
        }
        guard mute.contains(true) else { return }
        // كسب لكل عينة مع تلاشٍ 50ms
        let fade = Float(Self.rate) * 0.05
        var g: Float = mute[0] ? 0 : 1
        for i in 0..<n {
            let target: Float = mute[min(slots - 1, i / slot)] ? 0 : 1
            g += (target - g) / fade * 3
            g = max(0, min(1, g))
            out[2 * i] *= g; out[2 * i + 1] *= g
        }
        _ = bedOn
    }

    private func readFrames(_ h: FileHandle, from: Int, count: Int) throws -> ([Float], [Float]) {
        try h.seek(toOffset: UInt64(from * 8))
        let data = try h.read(upToCount: count * 8) ?? Data()
        let n = data.count / 8
        var l = [Float](repeating: 0, count: count), r = [Float](repeating: 0, count: count)
        data.withUnsafeBytes { raw in
            let f = raw.bindMemory(to: Float.self)
            for i in 0..<n { l[i] = f[2 * i]; r[i] = f[2 * i + 1] }
        }
        return (l, r)
    }

    private func write(asset: AVAsset, video: AVAssetTrack?, raw: URL, frames: Int, audioStart: CMTime, to output: URL,
                       progress: (Double) -> Void) async throws {
        try? FileManager.default.removeItem(at: output)
        let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)

        // الصورة: نسخ العينات كما هي
        var vReader: AVAssetReader?, vOut: AVAssetReaderTrackOutput?, vIn: AVAssetWriterInput?
        if let video {
            let r = try AVAssetReader(asset: asset)
            let o = AVAssetReaderTrackOutput(track: video, outputSettings: nil)
            o.alwaysCopiesSampleData = false
            r.add(o)
            let fmt = try await video.load(.formatDescriptions).first
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: fmt)
            input.transform = try await video.load(.preferredTransform)
            input.expectsMediaDataInRealTime = false
            writer.add(input)
            guard r.startReading() else { throw r.error ?? NSError(domain: "hisn", code: 6) }
            vReader = r; vOut = o; vIn = input
        }

        // الصوت: AAC من الملف النظيف
        let aIn = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: Self.rate, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 160_000,
        ])
        aIn.expectsMediaDataInRealTime = false
        writer.add(aIn)
        var asbd = AudioStreamBasicDescription(mSampleRate: Float64(Self.rate), mFormatID: kAudioFormatLinearPCM,
                                               mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
                                               mBytesPerPacket: 8, mFramesPerPacket: 1, mBytesPerFrame: 8, mChannelsPerFrame: 2,
                                               mBitsPerChannel: 32, mReserved: 0)
        var afmt: CMAudioFormatDescription?
        CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &afmt)
        guard let afmt else { throw NSError(domain: "hisn", code: 7) }

        guard writer.startWriting() else { throw writer.error ?? NSError(domain: "hisn", code: 8) }
        writer.startSession(atSourceTime: .zero)

        let rawH = try FileHandle(forReadingFrom: raw)
        defer { try? rawH.close() }
        let step = 8192
        var aPos = 0
        var vDone = vOut == nil, aDone = false
        var nextVideo: CMSampleBuffer? = vOut?.copyNextSampleBuffer()

        func audioBuffer() throws -> CMSampleBuffer? {
            guard aPos < frames else { return nil }
            let n = min(step, frames - aPos)
            try rawH.seek(toOffset: UInt64(aPos * 8))
            guard let data = try rawH.read(upToCount: n * 8), !data.isEmpty else { return nil }
            var block: CMBlockBuffer?
            CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: data.count, blockAllocator: nil,
                                               customBlockSource: nil, offsetToData: 0, dataLength: data.count, flags: 0, blockBufferOut: &block)
            guard let block else { return nil }
            _ = data.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: data.count) }
            var sb: CMSampleBuffer?
            let pts = CMTimeAdd(audioStart, CMTime(value: CMTimeValue(aPos), timescale: CMTimeScale(Self.rate)))
            CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block, formatDescription: afmt,
                                                                 sampleCount: data.count / 8, presentationTimeStamp: pts,
                                                                 packetDescriptions: nil, sampleBufferOut: &sb)
            aPos += data.count / 8
            return sb
        }

        var pendingAudio = try audioBuffer()
        while !(vDone && aDone) {
            try check()
            var progressed = false
            // نقدّم الأقدم زمنًا (تداخل الصوت والصورة)
            let aTime = pendingAudio.map { CMSampleBufferGetPresentationTimeStamp($0) }
            let vTime = nextVideo.map { CMSampleBufferGetPresentationTimeStamp($0) }
            let preferVideo = !vDone && (aDone || (vTime != nil && (aTime == nil || CMTimeCompare(vTime!, aTime!) <= 0)))
            func pushVideo() {
                guard !vDone, let vIn, vIn.isReadyForMoreMediaData else { return }
                if let sb = nextVideo { vIn.append(sb); progressed = true }
                nextVideo = vOut?.copyNextSampleBuffer()
                if nextVideo == nil { vDone = true; vIn.markAsFinished() }
            }
            func pushAudio() throws {
                guard !aDone, aIn.isReadyForMoreMediaData else { return }
                if let sb = pendingAudio { aIn.append(sb); progressed = true }
                pendingAudio = try audioBuffer()
                if pendingAudio == nil { aDone = true; aIn.markAsFinished() }
            }
            // الأقدم أولًا، وإن لم يكن جاهزًا فالآخر (الكاتب قد ينتظر أحدهما)
            if preferVideo { pushVideo(); if !progressed { try pushAudio() } }
            else { try pushAudio(); if !progressed { pushVideo() } }
            progress(Double(aPos) / Double(max(1, frames)))
            if writer.status == .failed { throw writer.error ?? NSError(domain: "hisn", code: 9) }
            if !progressed { try await Task.sleep(nanoseconds: 2_000_000) }
        }
        _ = vReader
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? NSError(domain: "hisn", code: 10) }
    }
}

/// YAMNet بكود الجوال: هل في هذا الجزء موسيقى؟ (نفس قاعدة الإضافة classifyMusic، مع السماح بالإنشاد بلا آلات)
final class NativeYamnet {
    private let env: ORTEnv
    private let session: ORTSession
    static let window = 15600

    init() throws {
        guard let path = Bundle.main.path(forResource: "yamnet", ofType: "onnx", inDirectory: "web/models/yamnet") else {
            throw NSError(domain: "hisn", code: 30)
        }
        env = try ORTEnv(loggingLevel: .warning)
        let opts = try ORTSessionOptions()
        try opts.setIntraOpNumThreads(2)
        session = try ORTSession(env: env, modelPath: path, sessionOptions: opts)
    }

    private static let speech = Array(0...3)
    private static let vocal = Array(24...32) + [249, 250]
    private static let instrument = Array(133...194) + Array(203...208) + [210]
    private static let genre = Array(211...276).filter { $0 != 249 && $0 != 250 }

    /// نافذة كل ثانية في [from, to) من القناتين (44.1kHz). أي نافذة موسيقية ← نعم. الخطأ يُعدّ موسيقى (الأحوط).
    func hasMusic(_ l: [Float], _ r: [Float], from: Int, to: Int) -> Bool {
        let ratio = 44100.0 / 16000.0, need = Int(Double(Self.window) * ratio) + 2
        var pos = from
        while pos < to {
            let s0 = max(0, min(pos, to - need))
            var win = [Float](repeating: 0, count: Self.window)
            var peak: Float = 0
            for k in 0..<Self.window {
                let x = Double(s0) + Double(k) * ratio
                let i = Int(x)
                guard i + 1 < l.count else { break }
                let fr = Float(x - Double(i))
                let a = (l[i] + r[i]) / 2, b = (l[i + 1] + r[i + 1]) / 2
                let v = a + (b - a) * fr
                win[k] = v
                peak = max(peak, abs(v))
            }
            if peak >= 1e-3 {
                guard let scores = try? run(win) else { return true }
                if Self.isMusic(scores, sensitive: true) { return true }
            }
            pos += 44100
        }
        return false
    }

    private func run(_ win: [Float]) throws -> [Float] {
        let data = win.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * 4) }
        let t = try ORTValue(tensorData: data, elementType: .float, shape: [NSNumber(value: Self.window)])
        let name = try session.inputNames()[0], outName = try session.outputNames()[0]
        let out = try session.run(withInputs: [name: t], outputNames: [outName], runOptions: nil)
        guard let v = out[outName] else { throw NSError(domain: "hisn", code: 31) }
        let all = (try v.tensorData() as Data).withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        // [إطارات × 521] ← أعلى درجة لكل فئة
        var s = [Float](repeating: 0, count: 521)
        var i = 0
        while i + 521 <= all.count { for c in 0..<521 { s[c] = max(s[c], all[i + c]) }; i += 521 }
        return s
    }

    /// درجات YAMNet لنافذة 16kHz جاهزة
    func scores16(_ win: [Float]) -> [Float]? { try? run(win) }
    static func speechOf(_ s: [Float]) -> Float { speech.reduce(0) { max($0, $1 < s.count ? s[$1] : 0) } }

    /// احتمال الكلام في نافذة 16kHz (لإسكات بقايا الموسيقى حيث لا كلام)
    func speechScore(_ win: [Float]) -> Float? {
        guard let s = try? run(win) else { return nil }
        return Self.speech.reduce(0) { max($0, $1 < s.count ? s[$1] : 0) }
    }

    /// يحوّل جزءًا من قناتين 44.1kHz إلى نافذة YAMNet أحادية 16kHz تبدأ عند from
    static func window16(_ l: [Float], _ r: [Float], from: Int) -> (win: [Float], peak: Float) {
        let ratio = 44100.0 / 16000.0
        var win = [Float](repeating: 0, count: window), peak: Float = 0
        for k in 0..<window {
            let x = Double(from) + Double(k) * ratio
            let i = Int(x)
            guard i + 1 < l.count, i >= 0 else { break }
            let fr = Float(x - Double(i))
            let a = (l[i] + r[i]) / 2, b = (l[i + 1] + r[i + 1]) / 2
            let v = a + (b - a) * fr
            win[k] = v; peak = max(peak, abs(v))
        }
        return (win, peak)
    }

    /// صوت بشري (إنشاد/تلاوة/غناء) بلا آلات تقريبًا
    static func isVocalOnly(_ s: [Float]) -> Bool {
        func mx(_ ids: [Int]) -> Float { ids.reduce(0) { max($0, $1 < s.count ? s[$1] : 0) } }
        return mx(vocal) >= 0.2 && mx(instrument) < 0.12 && mx(genre) < 0.2
    }

    /// sensitive: لتقرير فصل الجزء أم لا — أي أثر موسيقى يكفي (الفوات أسوأ من فصل زائد)
    static func isMusic(_ s: [Float], sensitive: Bool = false) -> Bool {
        func mx(_ ids: [Int]) -> Float { ids.reduce(0) { max($0, $1 < s.count ? s[$1] : 0) } }
        let sp = mx(speech), vo = mx(vocal), mu = mx([132]), ins = mx(instrument), ge = mx(genre)
        if sensitive && vo < 0.2 && (ins >= 0.1 || ge >= 0.15 || mu >= 0.15) { return true }
        if vo >= 0.2 && ins < 0.12 && ge < 0.2 { return false } // إنشاد أو تلاوة بلا آلات
        if ins >= 0.25 || ge >= 0.3 { return true }
        let speechOverFaint = sp >= 0.5 && mu < 0.5 && ins < 0.12
        return mu >= 0.35 && !speechOverFaint
    }
}


/// نفس مولّد الخلفية في الإضافة (apps/extension/src/cleaner/ambient.js): ضوضاء مُرشَّحة، بلا ملفات صوت.
final class Ambient {
    private let kind: String, rate: Double
    private var s: UInt32
    private var n = 0.0, lp1: Double = 0, lp2: Double = 0, hp: Double = 0, drop: Double = 0, dropEnv: Double = 0
    private let aLow: Double, aHigh: Double, aDrop: Double, phase: Double
    private static let level = 0.025
    private static let gain: [String: Double] = ["rain": 6, "breeze": 9.6, "waves": 10.4]

    init(kind: String, rate: Double, seed: UInt32) {
        self.kind = kind; self.rate = rate; self.s = seed == 0 ? 1 : seed
        func a(_ fc: Double) -> Double { 1 - exp(-2 * Double.pi * fc / rate) }
        aLow = a(kind == "waves" ? 350 : kind == "breeze" ? 500 : 3000)
        aHigh = a(kind == "rain" ? 400 : 60)
        aDrop = a(2500)
        var tmp = self.s
        tmp ^= tmp << 13; tmp ^= tmp >> 17; tmp ^= tmp << 5
        self.s = tmp
        phase = (Double(tmp) / 4294967296 * 2 - 1) * 1000
    }

    private func rnd() -> Double {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5
        return Double(s) / 4294967296 * 2 - 1
    }

    func next() -> Float {
        let t = n / rate + phase
        n += 1
        let w = rnd()
        lp1 += aLow * (w - lp1)
        lp2 += aLow * (lp1 - lp2)
        hp += aHigh * (lp2 - hp)
        var y = lp2 - hp
        switch kind {
        case "breeze":
            y *= 2.2 * (0.55 + 0.25 * sin(2 * .pi * 0.07 * t) + 0.2 * sin(2 * .pi * 0.031 * t + 1.3))
        case "waves":
            var p = (t / 8).truncatingRemainder(dividingBy: 1)
            if p < 0 { p += 1 }
            let swell = p < 0.35 ? sin(p / 0.35 * .pi / 2) : cos((p - 0.35) / 0.65 * .pi / 2)
            y *= 2.6 * (0.15 + 0.85 * swell * swell)
        default:
            y *= 0.9
            if dropEnv < 1e-3 && rnd() > 1 - 18 / rate { dropEnv = 0.35 + 0.4 * abs(rnd()) }
            drop += aDrop * (rnd() - drop)
            y += drop * dropEnv
            dropEnv *= exp(-1 / (0.012 * rate))
        }
        return Float(y * Self.level * (Self.gain[kind] ?? 0))
    }
}


/// هل التطبيق ظاهر الآن؟ يُقرأ من خيط العمل قبل كل مقطع (المحرك العصبي للظاهر فقط).
final class AppActive: @unchecked Sendable {
    static let shared = AppActive()
    private let lock = NSLock()
    private var value = true
    var isActive: Bool { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ v: Bool) { lock.lock(); value = v; lock.unlock() }
    private init() {
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.set(true) }
        nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.set(false) }
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.set(false) }
    }
}
