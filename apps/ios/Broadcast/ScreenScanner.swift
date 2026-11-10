import CoreImage
import CoreML
import SensitiveContentAnalysis
import Vision

/// يحلل إطار الشاشة على الجهاز:
///  - العري: SensitiveContentAnalysis من آبل (يحتاج تفعيل "تحذير المحتوى الحساس" في الإعدادات).
///  - الوجوه: Vision، ثم نموذج FaceRes (Core ML) للجنس والعمر — نفس نموذج الإضافة وأندرويد.
final class ScreenScanner {
    private let analyzer = SCSensitivityAnalyzer()
    private let ci = CIContext(options: [.cacheIntermediates: false])
    private lazy var faceModel: FaceRes? = {
        let cfg = MLModelConfiguration()
        cfg.computeUnits = .cpuAndNeuralEngine
        return try? FaceRes(configuration: cfg)
    }()

    /// نصغّر الإطار إلى عرض 540 (كافٍ للكشف وأخف على الذاكرة).
    func prepare(_ pb: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> CGImage? {
        let img = CIImage(cvPixelBuffer: pb).oriented(orientation)
        let scale = min(1, 540 / max(1, img.extent.width))
        let small = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return ci.createCGImage(small, from: small.extent)
    }

    func scan(_ image: CGImage, viewer: Viewer, level: Level) async -> ScanVerdict {
        var sensitive = false
        if analyzer.analysisPolicy != .disabled {
            sensitive = (try? await analyzer.analyzeImage(image))?.isSensitive ?? false
        }
        if sensitive { return .violation("nudity") }
        return ScreenPolicy.decide(sensitive: false, faces: faces(in: image), viewer: viewer, level: level, thighs: thighs(in: image))
    }

    /// نسبة البشرة على الفخذ لكل جسم: نقاط الورك والركبة من Vision ولون البشرة بينهما (مثل skin.js).
    private func thighs(in image: CGImage) -> [Double] {
        let req = VNDetectHumanBodyPoseRequest()
        try? VNImageRequestHandler(cgImage: image).perform([req])
        guard let bodies = req.results, !bodies.isEmpty, let px = Pixels(image) else { return [] }
        return bodies.prefix(6).compactMap { body in
            guard let pts = try? body.recognizedPoints(.all) else { return nil }
            func p(_ j: VNHumanBodyPoseObservation.JointName) -> (x: Double, y: Double, c: Double)? {
                guard let q = pts[j], q.confidence >= 0.3 else { return nil }
                return (Double(q.location.x) * Double(px.w), (1 - Double(q.location.y)) * Double(px.h), Double(q.confidence))
            }
            var best: Double?
            for (hip, knee) in [(VNHumanBodyPoseObservation.JointName.leftHip, VNHumanBodyPoseObservation.JointName.leftKnee),
                                (.rightHip, .rightKnee)] {
                guard let a = p(hip), let b = p(knee), let f = px.legSkin(a.x, a.y, b.x, b.y) else { continue }
                best = max(best ?? 0, f)
            }
            return best
        }
    }

    private func faces(in image: CGImage) -> [ScanFace] {
        let req = VNDetectFaceRectanglesRequest()
        try? VNImageRequestHandler(cgImage: image).perform([req])
        let w = CGFloat(image.width), h = CGFloat(image.height)
        return (req.results ?? []).prefix(8).compactMap { obs in
            // صندوق Vision نسبي وأصله أسفل اليسار؛ نوسعه 1.4 ونربّعه كما يفعل Human قبل FaceRes
            let b = obs.boundingBox
            let rect = CGRect(x: b.minX * w, y: (1 - b.maxY) * h, width: b.width * w, height: b.height * h)
            let side = max(rect.width, rect.height) * 1.4
            let square = CGRect(x: rect.midX - side / 2, y: rect.midY - side / 2, width: side, height: side)
            let area = Double(rect.width * rect.height / (w * h))
            guard let r = classify(image, square) else { return ScanFace(area: area, female: false, genderScore: 0, age: 0) }
            return ScanFace(area: area, female: r.female, genderScore: r.score, age: r.age)
        }
    }

    /// يقص الوجه إلى 224×224 (ما خرج عن الشاشة أسود) ويشغّل FaceRes. القيم 0..255 بترتيب RGB.
    private func classify(_ image: CGImage, _ square: CGRect) -> (female: Bool, score: Double, age: Double)? {
        guard let model = faceModel,
              let input = try? MLMultiArray(shape: [1, 224, 224, 3], dataType: .float32) else { return nil }
        let n = 224
        // يحجز CGContext ذاكرته بنفسه (data: nil) ونقرؤها بعد الرسم
        guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: n, height: n))
        let s = CGFloat(n) / square.width
        // CGContext أصله أسفل اليسار: نرسم الصورة كاملة مزاحة بحيث يقع المربع في اللوحة
        ctx.interpolationQuality = .medium
        ctx.draw(image, in: CGRect(x: -square.minX * s,
                                   y: -(CGFloat(image.height) - square.maxY) * s,
                                   width: CGFloat(image.width) * s, height: CGFloat(image.height) * s))
        guard let raw = ctx.data else { return nil }
        let rgba = raw.bindMemory(to: UInt8.self, capacity: ctx.bytesPerRow * n)
        let stride = ctx.bytesPerRow
        let ptr = input.dataPointer.bindMemory(to: Float32.self, capacity: n * n * 3)
        for y in 0..<n {
            for x in 0..<n {
                let s = y * stride + x * 4, d = (y * n + x) * 3
                ptr[d] = Float32(rgba[s])
                ptr[d + 1] = Float32(rgba[s + 1])
                ptr[d + 2] = Float32(rgba[s + 2])
            }
        }
        guard let out = try? model.prediction(input_1: input) else { return nil }
        let g = out.gender_pred_Sigmoid[0].doubleValue
        let ages = (0..<100).map { out.age_pred_Softmax[$0].doubleValue }
        return ScreenPolicy.parseFaceRes(genderP: g, ages: ages)
    }
}

/// بكسلات الصورة RGBA لقياس لون البشرة (منقول من packages/core/src/skin.js).
struct Pixels {
    let w: Int, h: Int
    private let data: [UInt8]

    init?(_ image: CGImage) {
        let iw = image.width, ih = image.height
        w = iw; h = ih
        var buf = [UInt8](repeating: 0, count: iw * ih * 4)
        let ok = buf.withUnsafeMutableBytes { raw -> Bool in
            guard let ctx = CGContext(data: raw.baseAddress, width: iw, height: ih, bitsPerComponent: 8, bytesPerRow: iw * 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: iw, height: ih))
            return true
        }
        guard ok else { return nil }
        data = buf
    }

    static func isSkin(_ r: Double, _ g: Double, _ b: Double) -> Bool {
        let y = 0.299 * r + 0.587 * g + 0.114 * b
        let cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
        let cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
        return y > 45 && cr >= 135 && cr <= 180 && cb >= 80 && cb <= 135 && r > g && r > b && r - min(g, b) > 12
    }

    /// نسبة البشرة على شريط بين الورك والركبة (25%–85% من طوله، وعرضه 0.36 من طوله).
    func legSkin(_ hx: Double, _ hy: Double, _ kx: Double, _ ky: Double) -> Double? {
        let dx = kx - hx, dy = ky - hy
        let len = (dx * dx + dy * dy).squareRoot()
        if len < 10 { return nil }
        let nx = -dy / len, ny = dx / len, half = 0.18 * len
        var skin = 0, total = 0
        for ti in 0...12 {
            for si in 0...8 {
                let t = 0.25 + 0.05 * Double(ti), s = -1 + 0.25 * Double(si)
                let x = Int((hx + dx * t + nx * half * s).rounded()), y = Int((hy + dy * t + ny * half * s).rounded())
                if x < 0 || y < 0 || x >= w || y >= h { continue }
                let i = (y * w + x) * 4
                total += 1
                if Pixels.isSkin(Double(data[i]), Double(data[i + 1]), Double(data[i + 2])) { skin += 1 }
            }
        }
        return total >= 20 ? Double(skin) / Double(total) : nil
    }
}
