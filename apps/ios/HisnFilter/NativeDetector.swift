import CoreGraphics
import Foundation
import ImageIO
import OnnxRuntimeBindings

// كشف الصور بكود الآيفون نفسه (أسرع بكثير من صفحة الويب): نفس النماذج الأربعة ونفس الحساب
// المنقول من أندرويد (Vision.kt وPipeline.kt) والإضافة (people.js وskin.js وnudenet.js)،
// على ONNX Runtime مع Core ML (المعالج العصبي) عند توفره، وإلا المعالج العادي.
// النتيجة بنفس صيغة analyzeBitmap في الإضافة، فتحكم عليها سياسة المحتوى نفسها في الصفحة.

struct DBox {
    var x: Float, y: Float, w: Float, h: Float
    var area: Float { max(0, w) * max(0, h) }
    var cx: Float { x + w / 2 }
    var cy: Float { y + h / 2 }
    var right: Float { x + w }
    var bottom: Float { y + h }
    func iou(_ o: DBox) -> Float {
        let iw = max(0, min(right, o.right) - max(x, o.x)), ih = max(0, min(bottom, o.bottom) - max(y, o.y))
        let u = area + o.area - iw * ih
        return u > 0 ? iw * ih / u : 0
    }
    func contains(_ px: Float, _ py: Float, margin: Float = 0) -> Bool {
        let mx = w * margin, my = h * margin
        return px >= x - mx && px <= right + mx && py >= y - my && py <= bottom + my
    }
    func clip(_ W: Int, _ H: Int) -> DBox {
        let x1 = min(max(x, 0), Float(W)), y1 = min(max(y, 0), Float(H))
        let x2 = min(max(right, 0), Float(W)), y2 = min(max(bottom, 0), Float(H))
        return DBox(x: x1, y: y1, w: max(0, x2 - x1), h: max(0, y2 - y1))
    }
    var array: [Float] { [x, y, w, h] }
}

func nmsKeep(_ boxes: [DBox], _ scores: [Float], scoreMin: Float, iou: Float, maxOut: Int = .max, strict: Bool = false) -> [Int] {
    let order = scores.indices.filter { strict ? scores[$0] > scoreMin : scores[$0] >= scoreMin }.sorted { scores[$0] > scores[$1] }
    var keep: [Int] = []
    for i in order where keep.allSatisfy({ boxes[i].iou(boxes[$0]) <= iou }) {
        keep.append(i)
        if keep.count >= maxOut { break }
    }
    return keep
}

/** صورة RGBA في الذاكرة. */
struct RGBA {
    let w: Int, h: Int
    var px: [UInt8]

    /** يرسم الصورة في لوحة جديدة (تصغير أو قص أو تبطين) بإطار أسود. */
    static func render(_ img: CGImage, width: Int, height: Int, rect: CGRect) -> RGBA {
        var px = [UInt8](repeating: 0, count: width * height * 4)
        px.withUnsafeMutableBytes { raw in
            guard let ctx = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return }
            ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
            ctx.interpolationQuality = .medium
            // CG أصله أسفل اليسار: نقلب المستطيل
            ctx.draw(img, in: CGRect(x: rect.minX, y: CGFloat(height) - rect.maxY, width: rect.width, height: rect.height))
        }
        return RGBA(w: width, h: height, px: px)
    }

    func skin(_ x: Int, _ y: Int) -> Bool? {
        guard x >= 0, y >= 0, x < w, y < h else { return nil }
        let i = (y * w + x) * 4
        return NativeDetector.isSkin(Double(px[i]), Double(px[i + 1]), Double(px[i + 2]))
    }
}

struct NNDet { let label: String; let score: Float; let box: DBox }
struct NFace { var box: DBox; var score: Float; var gender = "unknown"; var genderScore = 0.0; var age = 0.0; var thigh: Double?; var drawn = false }
struct NBody { var box: DBox; var score: Float; var legs: [Float]; var thigh: Double? }

final class NativeDetector: @unchecked Sendable {
    static let shared: NativeDetector? = {
        do { let d = try NativeDetector(); state = "ready"; return d } catch {
            state = "failed"
            initError = HisnLog.describe(error)
            HisnLog.write("detector: init failed \(initError ?? "")")
            return nil
        }
    }()
    /// سبب تعذّر تشغيل المحرك (لفحص الحماية)
    static var initError: String?
    /// حالة المحرك دون لمس `shared` (لمسه يبدأ تحميل النماذج): loading | ready | failed
    nonisolated(unsafe) static var state = "loading"

    private let env: ORTEnv
    private let nude: ORTSession, blaze: ORTSession, faceres: ORTSession, movenet: ORTSession
    /// فهم الصورة كاملة (MobileCLIP-S0): يلتقط ما يفوت نماذج الوجوه والأجسام
    private let clip: ORTSession?
    private let sceneText: (emb: [[Float]], woman: [Int], sexual: [Int], covered: [Int], nobody: [Int], scary: [Int], scale: Float)?
    private let lock = NSLock()
    let backend: String

    /// تهيئة مبكرة في الخلفية عند تشغيل التطبيق (تحميل النماذج يأخذ ثوانيَ؛ بدونها تنتظر أول صفحة تُفتح)
    static func prepareInBackground() {
        DispatchQueue.global(qos: .userInitiated).async { _ = NativeDetector.shared }
    }

    private init() throws {
        let t0 = CFAbsoluteTimeGetCurrent()
        let env = try ORTEnv(loggingLevel: .warning)
        self.env = env
        let base = Bundle.main.resourceURL!.appendingPathComponent("web/models")
        var coreML = true
        var timing: [String] = []
        func open(_ path: String) throws -> ORTSession {
            let file = base.appendingPathComponent(path).path
            let t = CFAbsoluteTimeGetCurrent()
            defer { timing.append("\(path.split(separator: "/").last ?? "") \(Int((CFAbsoluteTimeGetCurrent() - t) * 1000))ms") }
            func make(_ format: String?) throws -> ORTSession {
                let opts = try ORTSessionOptions()
                try opts.setIntraOpNumThreads(2)
                try opts.setGraphOptimizationLevel(.all)
                if let format, OrtSetup.addCoreML(opts, format: format) == nil { coreML = false }
                return try ORTSession(env: env, modelPath: file, sessionOptions: opts)
            }
            // Core ML قد يرفض نموذجًا بصيغة MLProgram (blazeface وmovenet): نجرب صيغة NeuralNetwork الأقدم
            // (تعمل على المحرك العصبي أيضًا) قبل السقوط للمعالج — المعالج حار وبطيء.
            // الرفض يُحفظ، فلا تُعاد المحاولة الفاشلة (ثوانٍ) في كل تشغيل.
            guard coreML else { return try make(nil) }
            let memoKey = "coremlFormat:" + path
            if UserDefaults.standard.string(forKey: memoKey) == "NeuralNetwork" {
                if let s = try? make("NeuralNetwork") { return s }
            }
            do { return try make("MLProgram") } catch {
                do {
                    let s = try make("NeuralNetwork")
                    UserDefaults.standard.set("NeuralNetwork", forKey: memoKey)
                    HisnLog.write("detector: \(path) MLProgram rejected → NeuralNetwork OK")
                    return s
                } catch {
                    HisnLog.write("detector: \(path) Core ML failed → CPU: \(HisnLog.describe(error))")
                    return try make(nil)
                }
            }
        }
        nude = try open("nudenet/320n.onnx")
        blaze = try open("native/blazeface.onnx")
        faceres = try open("native/faceres.onnx")
        movenet = try open("native/movenet-multipose.onnx")
        clip = try? open("native/clip-s0.onnx")
        sceneText = Self.loadScene()
        backend = coreML ? "native:coreml" : "native:cpu"
        HisnLog.write("detector: ready in \(Int((CFAbsoluteTimeGetCurrent() - t0) * 1000))ms (\(timing.joined(separator: ", ")))")
    }

    private static func loadScene() -> (emb: [[Float]], woman: [Int], sexual: [Int], covered: [Int], nobody: [Int], scary: [Int], scale: Float)? {
        guard let url = Bundle.main.url(forResource: "scene", withExtension: "json", subdirectory: "web"),
              let data = try? Data(contentsOf: url),
              let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let emb = j["emb"] as? [[NSNumber]], let woman = j["woman"] as? [Int], let sexual = j["sexual"] as? [Int] else { return nil }
        return (emb.map { $0.map(\.floatValue) }, woman, sexual, j["covered"] as? [Int] ?? [], j["nobody"] as? [Int] ?? [], j["scary"] as? [Int] ?? [], (j["scale"] as? NSNumber)?.floatValue ?? 100)
    }

    /// احتمال أن الصورة فيها امرأة، وأنها إيحائية — من مقارنة الصورة كاملة بنصوص (scene.json)
    private func sceneScores(_ img: CGImage, _ W: Int, _ H: Int) throws -> [String: Double]? {
        guard let clip, let st = sceneText else { return nil }
        // أقصر ضلع = 256 ثم قص الوسط، بقيم 0..1 (مثل معالج النموذج)
        let k = 256.0 / Double(min(W, H))
        let w = Double(W) * k, h = Double(H) * k
        let r = RGBA.render(img, width: 256, height: 256, rect: CGRect(x: (256 - w) / 2, y: (256 - h) / 2, width: w, height: h))
        var x = [Float](repeating: 0, count: 3 * 256 * 256)
        for i in 0..<(256 * 256) {
            x[i] = Float(r.px[i * 4]) / 255; x[65536 + i] = Float(r.px[i * 4 + 1]) / 255; x[131072 + i] = Float(r.px[i * 4 + 2]) / 255
        }
        guard let e = try run(clip, Self.floats(x), .float, [1, 3, 256, 256]).values.first(where: { $0.count == 512 }) else { return nil }
        let norm = max(1e-6, sqrt(e.reduce(0) { $0 + $1 * $1 }))
        let sims = st.emb.map { t in zip(t, e).reduce(0) { $0 + $1.0 * $1.1 } / norm * st.scale }
        let mx = sims.max() ?? 0
        let ex = sims.map { exp(Double($0 - mx)) }
        let sum = ex.reduce(0, +)
        return ["woman": st.woman.reduce(0) { $0 + ex[$1] } / sum, "sexual": st.sexual.reduce(0) { $0 + ex[$1] } / sum,
                "covered": st.covered.reduce(0) { $0 + ex[$1] } / sum, "nobody": st.nobody.reduce(0) { $0 + ex[$1] } / sum,
                "scary": st.scary.reduce(0) { $0 + ex[$1] } / sum]
    }

    // ===== تشغيل النماذج =====

    private func run(_ s: ORTSession, _ data: NSMutableData, _ type: ORTTensorElementDataType, _ shape: [NSNumber]) throws -> [String: [Float]] {
        let input = try ORTValue(tensorData: data, elementType: type, shape: shape)
        let names = try s.outputNames()
        let out = try s.run(withInputs: [try s.inputNames()[0]: input], outputNames: Set(names), runOptions: nil)
        var r: [String: [Float]] = [:]
        for (k, v) in out {
            let d = try v.tensorData() as Data
            r[k] = d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        }
        return r
    }

    private static func floats(_ a: [Float]) -> NSMutableData {
        a.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * 4) }
    }

    // ===== التحليل =====

    /** يحلل صورة ويُرجع قاموسًا بصيغة الإضافة. */
    func analyze(_ img: CGImage) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        let W = img.width, H = img.height
        guard W > 0, H > 0 else { throw NSError(domain: "hisn", code: 20) }

        // NudeNet: الصورة أعلى اليسار في مربع أسود، 320×320، CHW 0..1
        var dets = try nudeNet(img, W, H)
        // المشهد أولًا: إن قال بثقة «لا أشخاص» (منظر، طعام، لعبة، نص، حيوان، مبنى) ولا وجوه من NudeNet
        // نتخطى نماذج الوجوه والأجسام — أغلب الصور في الخلاصة بلا أشخاص، وهذا يوفر ثلثي الحمل والحرارة
        let scene = (try? sceneScores(img, W, H)) ?? nil
        if let scene, (scene["nobody"] ?? 0) >= 0.9, (scene["woman"] ?? 0) < 0.05, (scene["covered"] ?? 0) < 0.05,
           !dets.contains(where: { $0.label == "FACE_FEMALE" || $0.label == "FACE_MALE" }) {
            let (nudity, sexual) = Self.summarize(dets)
            return ["analyzed": true, "nudity": nudity, "sexual": sexual, "people": [] as [[String: Any]], "detections": dets.map(\.label),
                    "parts": [] as [[String: Any]], "engine": backend, "scene": scene as Any, "skipped": "nobody"]
        }
        // الوجوه
        let bw = RGBA.render(img, width: 256, height: 256, rect: CGRect(x: 0, y: 0, width: 256, height: 256))
        var bIn = [Float](repeating: 0, count: 256 * 256 * 3)
        for i in 0..<(256 * 256) {
            bIn[i * 3] = Float(bw.px[i * 4]) / 127.5 - 1
            bIn[i * 3 + 1] = Float(bw.px[i * 4 + 1]) / 127.5 - 1
            bIn[i * 3 + 2] = Float(bw.px[i * 4 + 2]) / 127.5 - 1
        }
        let bOut = try run(blaze, Self.floats(bIn), .float, [1, 256, 256, 3])
        let small = Self.smallPixels(img, max: 512)
        let sc = Float(small.w) / Float(W)
        var faces: [NFace] = []
        for (idx, (sq, score)) in Self.decodeBlaze(Array(bOut.values), W, H).enumerated() {
            var f = NFace(box: sq.clip(W, H), score: score)
            if idx < 12 {
                // faceres: قص الصندوق المربع (ما خرج عن الصورة أسود) إلى 224، والقيم 0..255
                let sx = Float(224) / max(1, sq.w), sy = Float(224) / max(1, sq.h)
                let crop = RGBA.render(img, width: 224, height: 224,
                                       rect: CGRect(x: CGFloat(-sq.x * sx), y: CGFloat(-sq.y * sy), width: CGFloat(Float(W) * sx), height: CGFloat(Float(H) * sy)))
                var fIn = [Float](repeating: 0, count: 224 * 224 * 3)
                for i in 0..<(224 * 224) { for k in 0..<3 { fIn[i * 3 + k] = Float(crop.px[i * 4 + k]) } }
                let o = try run(faceres, Self.floats(fIn), .float, [1, 224, 224, 3])
                if let g = o.first(where: { $0.key.contains("gender") })?.value.first, let ages = o.first(where: { $0.key.contains("age") })?.value {
                    (f.gender, f.genderScore, f.age) = Self.parseFaceres(g, ages)
                }
            }
            f.thigh = Self.thighFromFace(f.box, small, sc)
            f.drawn = Self.drawnRegion(f.box, small, sc)
            faces.append(f)
        }
        // الأجسام: الصورة في وسط مربع أسود، 256×256 أعداد صحيحة
        let side = max(W, H), padX = (side - W) / 2, padY = (side - H) / 2
        let k = 256 / Float(side)
        let mv = RGBA.render(img, width: 256, height: 256, rect: CGRect(x: CGFloat(Float(padX) * k), y: CGFloat(Float(padY) * k), width: CGFloat(Float(W) * k), height: CGFloat(Float(H) * k)))
        var mIn = [Int32](repeating: 0, count: 256 * 256 * 3)
        for i in 0..<(256 * 256) { for c in 0..<3 { mIn[i * 3 + c] = Int32(mv.px[i * 4 + c]) } }
        let mData = mIn.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * 4) }
        let mOut = try run(movenet, mData, .int32, [1, 256, 256, 3]).values.first ?? []
        var bodies = Self.parseMoveNet(mOut, side, padX, padY, W, H)
        for i in bodies.indices { bodies[i].thigh = Self.thighExposure(bodies[i].legs, small, sc) }

        let nnFaces = dets.filter { $0.label == "FACE_FEMALE" || $0.label == "FACE_MALE" }
        var people = Self.fuse(faces, bodies, nnFaces, W, H, small: small, sc: sc)
        // نظرة مقرّبة لامرأة أو غير معروف صغير في صورة واسعة (البطن والصدر)
        for p in people.filter({ ($0["gender"] as? String) != "male" && ($0["_area"] as? Double ?? 1) < 0.7 }).prefix(2) {
            guard let b = p["_box"] as? DBox, b.w >= 40, b.h >= 60 else { continue }
            let fx = max(0, b.x - b.w * 0.2), fy = max(0, b.y - b.h * 0.08)
            let full = DBox(x: fx, y: fy, w: min(Float(W) - fx, b.w * 1.4), h: min(Float(H) - fy, b.h * 1.16))
            let upper = DBox(x: full.x, y: full.y, w: full.w, h: min(Float(H) - full.y, b.h * 0.66))
            for c in [full, upper] where c.w >= 32 && c.h >= 32 {
                guard let crop = img.cropping(to: CGRect(x: Int(c.x), y: Int(c.y), width: Int(c.w), height: Int(c.h))) else { continue }
                for d in try nudeNet(crop, crop.width, crop.height) {
                    dets.append(NNDet(label: d.label, score: d.score, box: DBox(x: d.box.x + c.x, y: d.box.y + c.y, w: d.box.w, h: d.box.h)))
                }
            }
        }
        let (nudity, sexual) = Self.summarize(dets)
        for i in people.indices {
            let b = people[i].removeValue(forKey: "_box") as! DBox
            people[i].removeValue(forKey: "_area")
            people[i]["box"] = [b.x / Float(W), b.y / Float(H), b.w / Float(W), b.h / Float(H)]
        }
        let partsWanted: Set<String> = ["FACE_FEMALE", "FEMALE_BREAST_COVERED", "FEMALE_BREAST_EXPOSED", "BUTTOCKS_COVERED", "BUTTOCKS_EXPOSED", "FEMALE_GENITALIA_COVERED", "BELLY_EXPOSED"]
        return [
            "analyzed": true,
            "nudity": nudity,
            "sexual": sexual,
            "people": people,
            "detections": dets.map(\.label),
            "parts": dets.filter { partsWanted.contains($0.label) && $0.score >= 0.35 }.map {
                ["class": $0.label, "score": Double($0.score), "box": [$0.box.x / Float(W), $0.box.y / Float(H), $0.box.w / Float(W), $0.box.h / Float(H)]] as [String: Any]
            },
            "engine": backend,
            "scene": scene.map { $0 as Any } ?? NSNull(),
        ]
    }

    private func nudeNet(_ img: CGImage, _ W: Int, _ H: Int) throws -> [NNDet] {
        let side = Float(max(W, H)), s = 320 / side
        let r = RGBA.render(img, width: 320, height: 320, rect: CGRect(x: 0, y: 0, width: CGFloat(Float(W) * s), height: CGFloat(Float(H) * s)))
        let plane = 320 * 320
        var input = [Float](repeating: 0, count: 3 * plane)
        for i in 0..<plane {
            input[i] = Float(r.px[i * 4]) / 255
            input[plane + i] = Float(r.px[i * 4 + 1]) / 255
            input[2 * plane + i] = Float(r.px[i * 4 + 2]) / 255
        }
        let out = try run(nude, Self.floats(input), .float, [1, 3, 320, 320]).values.first ?? []
        return Self.postprocessNude(out, rows: out.count / 22, W, H)
    }

    // ===== NudeNet (مطابق لـ nudenet.js وVision.kt) =====

    static let labels = [
        "FEMALE_GENITALIA_COVERED", "FACE_FEMALE", "BUTTOCKS_EXPOSED", "FEMALE_BREAST_EXPOSED",
        "FEMALE_GENITALIA_EXPOSED", "MALE_BREAST_EXPOSED", "ANUS_EXPOSED", "FEET_EXPOSED",
        "BELLY_COVERED", "FEET_COVERED", "ARMPITS_COVERED", "ARMPITS_EXPOSED", "FACE_MALE",
        "BELLY_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_COVERED", "FEMALE_BREAST_COVERED", "BUTTOCKS_COVERED",
    ]

    static func postprocessNude(_ o: [Float], rows: Int, _ W: Int, _ H: Int) -> [NNDet] {
        guard rows > 0 else { return [] }
        let nc = o.count / rows - 4
        let s = Float(max(W, H)) / 320
        var boxes: [DBox] = [], scores: [Float] = [], ids: [Int] = []
        for r in 0..<rows {
            var best = -1, bs = -Float.infinity
            for c in 0..<nc where o[(4 + c) * rows + r] > bs { bs = o[(4 + c) * rows + r]; best = c }
            if bs < 0.2 { continue }
            let cx = o[r], cy = o[rows + r], w0 = o[2 * rows + r], h0 = o[3 * rows + r]
            var x = (cx - w0 / 2) * s, y = (cy - h0 / 2) * s
            var w = w0 * s, h = h0 * s
            x = min(max(x, 0), Float(W)); y = min(max(y, 0), Float(H))
            w = min(w, Float(W) - x); h = min(h, Float(H) - y)
            boxes.append(DBox(x: x, y: y, w: w, h: h)); scores.append(bs); ids.append(best)
        }
        return nmsKeep(boxes, scores, scoreMin: 0.25, iou: 0.45).map { i in
            let b = boxes[i]
            return NNDet(label: labels[ids[i]], score: scores[i], box: DBox(x: b.x.rounded(.towardZero), y: b.y.rounded(.towardZero), w: b.w.rounded(.towardZero), h: b.h.rounded(.towardZero)))
        }
    }

    static func summarize(_ d: [NNDet]) -> (Double, Double) {
        func best(_ l: String) -> Double { Double(d.filter { $0.label == l }.map(\.score).max() ?? 0) }
        let sexual = ["FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_EXPOSED"].map(best).max()!
        let female = best("FACE_FEMALE") >= 0.4 || best("FEMALE_BREAST_COVERED") >= 0.3
        let belly = best("BELLY_EXPOSED")
        let bellyW = belly > 0 ? (female ? min(1, belly * 1.15 + 0.05) : 0.8 * belly) : 0
        var nudity = max(sexual, best("FEMALE_BREAST_EXPOSED"), best("BUTTOCKS_EXPOSED"), bellyW)
        let revealing = min(max(best("FEMALE_BREAST_COVERED"), best("BUTTOCKS_COVERED")), belly)
        nudity = max(nudity, revealing > 0.3 ? min(1, revealing + 0.25) : 0)
        return (nudity, sexual)
    }

    // ===== BlazeFace وFaceRes وMoveNet (مطابق لـ Vision.kt) =====

    static let anchors: [Float] = {
        var out: [Float] = []
        for (stride, n) in [(16, 2), (32, 6)] {
            let rows = (256 + stride - 1) / stride
            for gy in 0..<rows { for gx in 0..<rows { for _ in 0..<n { out.append(Float(stride) * (Float(gx) + 0.5)); out.append(Float(stride) * (Float(gy) + 0.5)) } } }
        }
        return out
    }()

    static func decodeBlaze(_ outs: [[Float]], _ W: Int, _ H: Int) -> [(DBox, Float)] {
        guard outs.count == 4 else { return [] }
        let s = outs.sorted { $0.count < $1.count }
        let (c384, c512, d384, d512) = (s[0], s[1], s[2], s[3])
        var batch = [Float](repeating: 0, count: 896 * 17)
        func put(_ row: Int, _ conf: [Float], _ data: [Float], _ i: Int) {
            batch[row * 17] = conf[i]
            for j in 0..<16 { batch[row * 17 + 1 + j] = data[i * 16 + j] }
        }
        for i in 0..<512 { put(i, c512, d512, i) }
        for i in 0..<384 { put(512 + i, c384, d384, i) }
        var boxes: [DBox] = [], scores: [Float] = []
        for i in 0..<896 {
            let o = i * 17
            let cx = batch[o + 1] + anchors[2 * i], cy = batch[o + 2] + anchors[2 * i + 1]
            let w = batch[o + 3], h = batch[o + 4]
            boxes.append(DBox(x: cx - w / 2, y: cy - h / 2, w: w, h: h))
            scores.append(Float(1 / (1 + exp(-Double(batch[o])))))
        }
        let fx = Float(W) / 256, fy = Float(H) / 256
        return nmsKeep(boxes, scores, scoreMin: 0.3, iou: 0.1, maxOut: 20, strict: true).map { i in
            let b = boxes[i]
            let x1 = b.x * fx, y1 = b.y * fy, x2 = b.right * fx, y2 = b.bottom * fy
            let cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
            let half = max((x2 - x1) * 1.4, (y2 - y1) * 1.4) / 2
            let r = { (v: Float) in (v + 0.5).rounded(.down) }
            let sx1 = r(cx - half), sy1 = r(cy - half), sx2 = r(cx + half), sy2 = r(cy + half)
            return (DBox(x: sx1, y: sy1, w: sx2 - sx1, h: sy2 - sy1), scores[i])
        }
    }

    static func parseFaceres(_ p: Float, _ ages: [Float]) -> (String, Double, Double) {
        let conf = Double(Int(200 * abs(p - 0.5))) / 100
        var gender = "unknown", score = 0.0
        if conf > 0 { gender = p <= 0.5 ? "female" : "male"; score = min(0.99, conf) }
        var i = 0
        for k in ages.indices where ages[k] > ages[i] { i = k }
        let lo = i > 0 ? ages[i - 1] : 0, hi = i + 1 < ages.count ? ages[i + 1] : 0
        let age = (lo > hi ? 10.0 * Double(i) - 100.0 * Double(lo) : 10.0 * Double(i) + 100.0 * Double(hi)).rounded() / 10
        return (gender, score, age)
    }

    static func parseMoveNet(_ res: [Float], _ side: Int, _ padX: Int, _ padY: Int, _ W: Int, _ H: Int) -> [NBody] {
        var out: [NBody] = []
        for d in 0..<(res.count / 56) {
            let o = d * 56
            let score = (100 * res[o + 55]).rounded() / 100
            if score <= 0.25 { continue }
            var x1 = Float.greatestFiniteMagnitude, y1 = x1, x2 = -x1, y2 = -x1, count = 0
            for k in 0..<17 where res[o + 3 * k + 2] > 0.25 {
                let px = res[o + 3 * k + 1] * Float(side) - Float(padX), py = res[o + 3 * k] * Float(side) - Float(padY)
                x1 = min(x1, px); y1 = min(y1, py); x2 = max(x2, px); y2 = max(y2, py); count += 1
            }
            if count == 0 { continue }
            var legs = [Float](repeating: 0, count: 12)
            for (j, k) in [11, 12, 13, 14].enumerated() {
                legs[3 * j] = res[o + 3 * k + 1] * Float(side) - Float(padX)
                legs[3 * j + 1] = res[o + 3 * k] * Float(side) - Float(padY)
                legs[3 * j + 2] = res[o + 3 * k + 2]
            }
            x1 = max(0, x1); y1 = max(0, y1); x2 = min(Float(W), x2); y2 = min(Float(H), y2)
            out.append(NBody(box: DBox(x: x1, y: y1, w: x2 - x1, h: y2 - y1), score: score, legs: legs, thigh: nil))
        }
        return Array(out.sorted { $0.score > $1.score }.prefix(6))
    }

    // ===== البشرة والرسم (مطابق لـ skin.js) =====

    static func isSkin(_ r: Double, _ g: Double, _ b: Double) -> Bool {
        let y = 0.299 * r + 0.587 * g + 0.114 * b
        let cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
        let cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
        return y > 45 && cr >= 135 && cr <= 180 && cb >= 80 && cb <= 135 && r > g && r > b && r - min(g, b) > 12
    }

    static func smallPixels(_ img: CGImage, max side: Int) -> RGBA {
        let s = min(1, Float(side) / Float(Swift.max(img.width, img.height)))
        let w = Swift.max(1, Int((Float(img.width) * s).rounded())), h = Swift.max(1, Int((Float(img.height) * s).rounded()))
        return RGBA.render(img, width: w, height: h, rect: CGRect(x: 0, y: 0, width: w, height: h))
    }

    static func legSkin(_ hx: Float, _ hy: Float, _ kx: Float, _ ky: Float, _ p: RGBA) -> Double? {
        let dx = kx - hx, dy = ky - hy, len = hypot(dx, dy)
        if len < 10 { return nil }
        let nx = -dy / len, ny = dx / len, half = 0.18 * len
        var skin = 0, total = 0
        for ti in 0...12 { for si in 0...8 {
            let t = 0.25 + 0.05 * Float(ti), s = -1 + 0.25 * Float(si)
            guard let v = p.skin(Int((hx + dx * t + nx * half * s).rounded()), Int((hy + dy * t + ny * half * s).rounded())) else { continue }
            total += 1; if v { skin += 1 }
        } }
        return total >= 20 ? Double(skin) / Double(total) : nil
    }

    static func thighExposure(_ legs: [Float], _ p: RGBA, _ sc: Float) -> Double? {
        var best: Double?
        for side in 0...1 {
            let hip = side * 3, knee = (2 + side) * 3
            if legs[hip + 2] < 0.3 || legs[knee + 2] < 0.3 { continue }
            guard let f = legSkin(legs[hip] * sc, legs[hip + 1] * sc, legs[knee] * sc, legs[knee + 1] * sc, p) else { continue }
            best = max(best ?? 0, f)
        }
        return best
    }

    static func thighFromFace(_ face: DBox, _ p: RGBA, _ sc: Float) -> Double? {
        let f = DBox(x: face.x * sc, y: face.y * sc, w: face.w * sc, h: face.h * sc)
        if f.h < 8 { return nil }
        let x1 = f.cx - 0.75 * f.w, x2 = f.cx + 0.75 * f.w, y1 = f.y + 3.7 * f.h, y2 = f.y + 5.3 * f.h
        if y2 > Float(p.h) + 0.3 * f.h { return nil }
        var skin = 0, total = 0
        for yi in 0...10 { for xi in 0...8 {
            guard let v = p.skin(Int((x1 + (x2 - x1) * Float(xi) / 8).rounded()), Int((y1 + (y2 - y1) * Float(yi) / 10).rounded())) else { continue }
            total += 1; if v { skin += 1 }
        } }
        return total >= 40 ? Double(skin) / Double(total) : nil
    }

    /** وجه مرسوم (كرتون أو لعبة): ألوان مسطحة وملمس ناعم (مطابق لـ drawnRegion). */
    static func drawnRegion(_ box: DBox, _ p: RGBA, _ sc: Float) -> Bool {
        let b = DBox(x: box.x * sc, y: box.y * sc, w: box.w * sc, h: box.h * sc)
        let x0 = max(0, Int((b.x + b.w * 0.15).rounded())), y0 = max(0, Int((b.y + b.h * 0.15).rounded()))
        let x1 = min(p.w, Int((b.x + b.w * 0.85).rounded())), y1 = min(p.h, Int((b.y + b.h * 0.85).rounded()))
        let bw = x1 - x0, bh = y1 - y0
        guard bw >= 8, bh >= 8 else { return false }
        let step = max(1, min(bw, bh) / 40)
        var bins: [Int: Int] = [:]
        var n = 0, skin = 0, sat = 0.0, tex = 0.0, texN = 0
        func lum(_ i: Int) -> Double { 0.299 * Double(p.px[i]) + 0.587 * Double(p.px[i + 1]) + 0.114 * Double(p.px[i + 2]) }
        var y = y0
        while y < y1 {
            var x = x0
            while x < x1 {
                let i = (y * p.w + x) * 4
                let r = Int(p.px[i]), g = Int(p.px[i + 1]), bl = Int(p.px[i + 2])
                n += 1
                if isSkin(Double(r), Double(g), Double(bl)) { skin += 1 }
                let mx = max(r, g, bl), mn = min(r, g, bl)
                sat += mx > 0 ? Double(mx - mn) / Double(mx) : 0
                bins[(r >> 5) * 64 + (g >> 5) * 8 + (bl >> 5), default: 0] += 1
                if x + 1 < p.w && y + 1 < p.h { tex += abs(2 * lum(i) - lum(i + 4) - lum(i + p.w * 4)); texN += 1 }
                x += step
            }
            y += step
        }
        guard n >= 30 else { return false }
        let top = bins.values.sorted(by: >)
        let flat = Double(top.prefix(3).reduce(0, +)) / Double(n)
        let texture = texN > 0 ? tex / Double(texN) : 0
        if sat / Double(n) < 0.12 { return false } // رمادية: صورة حقيقية
        return texture < 8 && (flat > 0.65 || Double(skin) / Double(n) < 0.1)
    }

    // ===== دمج الوجوه والأجسام (مطابق لـ people.js) =====

    static func fuse(_ faces: [NFace], _ bodiesIn: [NBody], _ nn: [NNDet], _ W: Int, _ H: Int, small: RGBA, sc: Float) -> [[String: Any]] {
        let area = Double(max(1, W * H))
        var all = faces
        for f in nn {
            let match = all.contains { $0.box.iou(f.box) > 0.3 || $0.box.contains(f.box.cx, f.box.cy) || f.box.contains($0.box.cx, $0.box.cy) }
            if !match && f.score >= 0.4 { all.append(NFace(box: f.box, score: f.score, drawn: drawnRegion(f.box, small, sc))) }
        }
        // نفس الشخص بصندوقين متداخلين: ندمجهما
        var bodies: [NBody] = []
        for b in bodiesIn.sorted(by: { $0.score > $1.score }) {
            if let j = bodies.firstIndex(where: { $0.box.iou(b.box) > 0.4 }) {
                let d = bodies[j].box
                let x1 = min(d.x, b.box.x), y1 = min(d.y, b.box.y), x2 = max(d.right, b.box.right), y2 = max(d.bottom, b.box.bottom)
                bodies[j].box = DBox(x: x1, y: y1, w: x2 - x1, h: y2 - y1)
                if (b.thigh ?? 0) > (bodies[j].thigh ?? 0) { bodies[j].thigh = b.thigh }
            } else { bodies.append(b) }
        }
        var people: [[String: Any]] = []
        var used = Set<Int>()
        for b in bodies {
            let fi = all.indices.first { !used.contains($0) && b.box.contains(all[$0].box.cx, all[$0].box.cy, margin: 0.15) }
            if let fi { used.insert(fi) }
            people.append(person(fi.map { all[$0] }, b.box, area, W, H, thigh: b.thigh ?? fi.flatMap { all[$0].thigh }))
        }
        for i in all.indices where !used.contains(i) {
            let f = all[i].box
            people.append(person(all[i], DBox(x: f.x - f.w, y: f.y, w: f.w * 3, h: min(Float(H) - f.y, f.h * 6)), area, W, H, thigh: all[i].thigh))
        }
        return people
    }

    private static func person(_ f: NFace?, _ raw: DBox, _ area: Double, _ W: Int, _ H: Int, thigh: Double?) -> [String: Any] {
        let box = raw.clip(W, H)
        let gender = f?.gender ?? "unknown"
        var p: [String: Any] = [
            "gender": gender,
            "genderScore": gender == "unknown" ? 0 : (f?.genderScore ?? 0.5),
            "covered": false,
            "cartoon": f?.drawn ?? false,
            "area": Double(box.area) / area,
            "_box": box,
            "_area": Double(box.area) / area,
        ]
        if let age = f?.age, age > 0 { p["adult"] = age > 12 } else { p["adult"] = NSNull() }
        if let thigh { p["thighSkin"] = thigh }
        return p
    }
}

// ===== الطابور والذاكرة =====

/** فحص صورة واحدة في كل مرة، الأحدث طلبًا أولًا (ما على الشاشة الآن)، مع ذاكرة للنتائج على الجهاز. */
actor NativeQueue {
    static let shared = NativeQueue()
    private var waiting: [(id: Int, run: CheckedContinuation<Void, Never>)] = []
    private var busy = false
    private var nextID = 0
    private let memory = NSCache<NSString, NSString>()
    private let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("verdicts", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    init() { memory.countLimit = 3000 }

    private func turn() async {
        if !busy { busy = true; return }
        nextID += 1
        let id = nextID
        await withCheckedContinuation { waiting.append((id, $0)) }
    }

    private func done() {
        // الأحدث أولًا: المستخدم مرّ عن القديم غالبًا
        if let last = waiting.popLast() { last.run.resume() } else { busy = false }
    }

    func cached(_ key: String) -> String? {
        if let m = memory.object(forKey: key as NSString) { return m as String }
        let f = dir.appendingPathComponent(key)
        guard let s = try? String(contentsOf: f, encoding: .utf8) else { return nil }
        memory.setObject(s as NSString, forKey: key as NSString)
        return s
    }

    func store(_ key: String, _ json: String) {
        memory.setObject(json as NSString, forKey: key as NSString)
        try? json.write(to: dir.appendingPathComponent(key), atomically: true, encoding: .utf8)
    }

    func analyze(_ img: CGImage, detector: NativeDetector) async -> [String: Any]? {
        await turn()
        defer { done() }
        return try? detector.analyze(img)
    }
}
