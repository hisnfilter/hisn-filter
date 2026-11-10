#if DEBUG
import AVFoundation
import ImageIO
import Foundation
import UIKit

/// اختبار آلي على المحاكي (للمطوّر فقط، لا يدخل نسخة المتجر):
///   simctl launch … -hisnTestMusic <فيديو داخل حاوية التطبيق> <مجلد الناتج>
/// يشغّل «أزل الموسيقى» بكود الجوال، ويكتب تقريرًا (الزمن، والمحرك، والصوت قبل وبعد) ثم يغلق التطبيق.
/// اختبارات قبول لإصلاحات المراجعة (F04/F06/F07) على الجهاز نفسه؛ النتائج في سجل حصن «selftest:».
enum SelfTest {
    static func check(_ name: String, _ ok: Bool, _ detail: String = "") { HisnLog.write("selftest: \(ok ? "PASS" : "FAIL") \(name) \(detail)") }

    static func run() async {
        // F04: الاحتفاظ والملخص بالتاريخ الفعلي (نحفظ السجل الحقيقي ونعيده)
        let saved = Activity.all, savedLog = HisnSettings.logSearches
        let cal = Calendar(identifier: .gregorian), now = Date()
        func day(_ n: Int) -> String { let f = DateFormatter(); f.calendar = cal; f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from: cal.date(byAdding: .day, value: -n, to: now)!) }
        Activity.all = [day(0): ["hidden": 1], day(6): ["hidden": 10], day(7): ["hidden": 100], day(13): ["hidden": 1000], day(14): ["hidden": 5], day(40): ["hidden": 7, "searches": ["old"]]]
        check("F04 last-7-calendar-days", Activity.totals().hidden == 11, "got \(Activity.totals().hidden)")
        Activity.prune()
        let keys = Set(Activity.all.keys)
        check("F04 prune-by-date (gap >14d)", keys == [day(0), day(6), day(7), day(13)], keys.sorted().joined(separator: ","))
        HisnSettings.logSearches = true
        Activity.record(searches: ["q1"])
        check("F04 searches saved when on", (Activity.all[day(0)]?["searches"] as? [String]) == ["q1"])
        HisnSettings.logSearches = false
        Activity.record(searches: ["q2"])
        check("F04 toggle off clears + stops", Activity.all[day(0)]?["searches"] == nil)
        Activity.clear()
        check("F04 manual clear", Activity.all.isEmpty)
        Activity.all = saved; HisnSettings.logSearches = savedLog

        // F06: القفل الآن يلغي تفويض الصفحة أيضًا
        await MainActor.run {
            HisnSettings.unlockedUntil = Date().addingTimeInterval(300)
            ProtectedWeb.Coordinator.pageUnlockedUntil = Date().addingTimeInterval(300)
            Unlocks.revokeAll()
            check("F06 lock-now revokes page unlock", ProtectedWeb.Coordinator.pageUnlockedUntil <= Date() && HisnSettings.unlockedUntil <= Date())
        }

        // F07: سقف فعلي للتنزيل (الخادم هنا يتجاهل Range ويرسل الصفحة كاملة)
        let big = URLRequest(url: URL(string: "https://www.apple.com/")!)
        let r1 = await CappedFetch.get(big, limit: 20_000)
        check("F07 over-limit rejected (no truncate)", r1 == nil)
        let r2 = await CappedFetch.get(big, limit: 20_000, truncateOK: true)
        check("F07 truncate to limit", r2 != nil && r2!.0.count <= 20_000, "bytes \(r2?.0.count ?? -1)")
        let r3 = await CappedFetch.get(big, limit: 5 << 20)
        check("F07 under-limit full body", r3 != nil && (r3!.0.count) > 20_000, "bytes \(r3?.0.count ?? -1)")
        // F05: «صارم» في فحص الشاشة يطابق المتصفح (رجل/طفل/مستخدمة لا يُحجبون؛ امرأة ووجه صغير يُحجبان)
        let man = ScanFace(area: 0.05, female: false, genderScore: 0.6, age: 35)
        let woman = ScanFace(area: 0.05, female: true, genderScore: 0.6, age: 30)
        let kid = ScanFace(area: 0.05, female: true, genderScore: 0.6, age: 8)
        let tinyWoman = ScanFace(area: 0.001, female: true, genderScore: 0.6, age: 30)
        let unsure = ScanFace(area: 0.05, female: false, genderScore: 0.05, age: 30)
        check("F05 strict man shown", ScreenPolicy.decide(sensitive: false, faces: [man], viewer: .male, level: .strict) == .clean)
        check("F05 strict child shown", ScreenPolicy.decide(sensitive: false, faces: [kid], viewer: .male, level: .strict) == .clean)
        check("F05 strict woman blocked", ScreenPolicy.decide(sensitive: false, faces: [woman], viewer: .male, level: .strict) == .violation("woman"))
        check("F05 strict female viewer sees woman", ScreenPolicy.decide(sensitive: false, faces: [woman], viewer: .female, level: .strict) == .clean)
        check("F05 strict tiny woman blocked", ScreenPolicy.decide(sensitive: false, faces: [tinyWoman], viewer: .male, level: .strict) == .violation("woman"))
        check("F05 medium tiny woman ignored", ScreenPolicy.decide(sensitive: false, faces: [tinyWoman], viewer: .male, level: .medium) == .clean)
        check("F05 unsure gender blocked (male viewer)", ScreenPolicy.decide(sensitive: false, faces: [unsure], viewer: .male, level: .medium) == .violation("woman"))
        // الاستثناءات وطلبات المراجعة (نحفظ الحقيقية ونعيدها)
        let sv = Exceptions.verdicts, sm = Exceptions.meta, sr = ReviewRequests.raw
        Exceptions.set("abcdef0123456789", "safe", host: "x.com", label: "t")
        check("EXC set+meta", Exceptions.verdicts["abcdef0123456789"] == "safe" && Exceptions.items("safe").first?.host == "x.com")
        check("EXC in web settings", (HisnSettings.webSettings()["imageVerdicts"] as? [String: String])?["abcdef0123456789"] == "safe")
        Exceptions.set("not-a-key", "safe", host: "", label: "")
        check("EXC rejects bad key", Exceptions.verdicts["not-a-key"] == nil)
        Exceptions.remove(["abcdef0123456789"])
        check("EXC remove", Exceptions.verdicts["abcdef0123456789"] == nil)
        ReviewRequests.raw = []
        ReviewRequests.add(key: "abcdef0123456789", host: "y.com", label: "l", page: "https://y.com/p")
        ReviewRequests.add(key: "abcdef0123456789", host: "y.com", label: "l", page: "https://y.com/p")
        check("REQ dedupe", ReviewRequests.count == 1)
        ReviewRequests.raw = ReviewRequests.raw + [["id": "old", "key": "", "host": "z", "label": "", "page": "", "date": "2000-01-01"]]
        check("REQ 14-day expiry", ReviewRequests.count == 1)
        Exceptions.verdicts = sv; Exceptions.meta = sm; ReviewRequests.raw = sr
        HisnLog.write("selftest: done")
    }
}

enum DebugHarness {
    static func runIfRequested() -> Bool {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-hisnOpen") { HisnLog.write("harness launch \(args.dropFirst().joined(separator: " "))") }
        if args.contains("-hisnSelfTest") { Task { await SelfTest.run() } }
        // فحص صور على الجهاز نفسه: المحرك الأصلي على كل صورة في مجلد، والزمن والنتيجة لكل صورة
        if let j = args.firstIndex(of: "-hisnTestImages"), j + 2 < args.count {
            func path(_ p: String) -> URL { p.hasPrefix("/") ? URL(fileURLWithPath: p) : URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(p) }
            let dir = path(args[j + 1]), outDir = path(args[j + 2])
            Task.detached {
                try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
                var rows: [[String: Any]] = []
                let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".jpg") || $0.hasSuffix(".png") }.sorted()
                if NativeDetector.shared == nil { rows.append(["file": "INIT", "error": NativeDetector.initError ?? "?"]) }
                for f in files {
                    guard let data = try? Data(contentsOf: dir.appendingPathComponent(f)),
                          let src = CGImageSourceCreateWithData(data as CFData, nil),
                          let img = CGImageSourceCreateImageAtIndex(src, 0, nil), let det = NativeDetector.shared else { continue }
                    let t = CFAbsoluteTimeGetCurrent()
                    let a = (try? det.analyze(img)) ?? [:]
                    let people = (a["people"] as? [[String: Any]] ?? []).map { p -> String in
                        let b = (p["box"] as? [Double] ?? []).map { String(format: "%.2f", $0) }.joined(separator: ",")
                        return "\(p["gender"] ?? "?"):\(Int(((p["genderScore"] as? Double) ?? 0) * 100)) [\(b)]"
                    }
                    rows.append(["file": f, "ms": Int((CFAbsoluteTimeGetCurrent() - t) * 1000), "scene": a["scene"] ?? NSNull(), "people": people, "nudity": a["nudity"] ?? 0, "engine": a["engine"] ?? ""])
                }
                let data = (try? JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted])) ?? Data()
                try? data.write(to: outDir.appendingPathComponent("result.json"))
                exit(0)
            }
            return true
        }
        // المسار الحقيقي كاملًا (مهمة الخلفية والحفظ في الصور والإشعار): نتأكد أنه يكمل والشاشة مقفلة
        if let j = args.firstIndex(of: "-hisnTestJob"), j + 2 < args.count {
            func path(_ p: String) -> URL { p.hasPrefix("/") ? URL(fileURLWithPath: p) : URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(p) }
            let input = path(args[j + 1]), outDir = path(args[j + 2])
            try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
            // نسخة لأن المهمة تحذف ملفها بعد الانتهاء
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("job-\(UUID().uuidString).mp4")
            try? FileManager.default.copyItem(at: input, to: copy)
            let t0 = CFAbsoluteTimeGetCurrent()
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                let job = NativeMusicJob.shared
                job.onDone = { ok, msg in
                    let log: [String: Any] = ["ok": ok, "message": msg, "seconds": Int(CFAbsoluteTimeGetCurrent() - t0)]
                    let data = (try? JSONSerialization.data(withJSONObject: log, options: [.prettyPrinted])) ?? Data()
                    try? data.write(to: outDir.appendingPathComponent("result.json"))
                    HisnLog.write("harness job result: \(String(data: data, encoding: .utf8) ?? "")")
                }
                job.start(url: copy, name: input.lastPathComponent)
            }
            return true
        }
        guard let i = args.firstIndex(of: "-hisnTestMusic"), i + 2 < args.count else { return false }
        // مسار نسبي = داخل حاوية التطبيق (للتشغيل على الجهاز من الماك)
        func path(_ p: String) -> URL { p.hasPrefix("/") ? URL(fileURLWithPath: p) : URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(p) }
        let input = path(args[i + 1]), outDir = path(args[i + 2])
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        HisnLog.write("harness: \(input.path)")
        Task.detached {
            var log: [String: Any] = ["input": input.lastPathComponent]
            let t0 = CFAbsoluteTimeGetCurrent()
            var stages: [String] = []
            let worker = MusicRemover(input: input)
            do {
                let out = try await worker.run { p, stage in
                    if stages.last != stage { stages.append(stage) }
                    _ = p
                }
                log["ok"] = true
                log["seconds"] = Int(CFAbsoluteTimeGetCurrent() - t0)
                let dest = outDir.appendingPathComponent("clean.mp4")
                try? FileManager.default.removeItem(at: dest)
                try FileManager.default.copyItem(at: out, to: dest)
                let asset = AVURLAsset(url: dest)
                log["outAudioTracks"] = try await asset.loadTracks(withMediaType: .audio).count
                log["outVideoTracks"] = try await asset.loadTracks(withMediaType: .video).count
                log["outDuration"] = try await asset.load(.duration).seconds
                log["inDuration"] = try await AVURLAsset(url: input).load(.duration).seconds
            } catch {
                let e = error as NSError
                log["ok"] = false
                log["error"] = "\(e.localizedDescription) [\(e.domain) \(e.code)]"
                log["seconds"] = Int(CFAbsoluteTimeGetCurrent() - t0)
            }
            log["stage"] = worker.stage
            log["diag"] = worker.diag
            log["stages"] = stages
            let data = (try? JSONSerialization.data(withJSONObject: log, options: [.prettyPrinted, .sortedKeys])) ?? Data()
            try? data.write(to: outDir.appendingPathComponent("result.json"))
            HisnLog.write("harness result: \(String(data: data, encoding: .utf8) ?? "")")
            exit(0)
        }
        return true
    }
}
#endif
