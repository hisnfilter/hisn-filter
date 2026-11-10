import Accelerate
import Foundation
import OnnxRuntimeBindings

/// فصل الموسيقى بمعالج الجوال (ONNX Runtime مع Core ML): نفس نموذج الصفحة ونفس الحساب
/// (مطابق لـ separate.js و Separation.kt)، لكنه أسرع بكثير من تشغيله داخل المتصفح.
/// النموذج يقدّر الموسيقى وحدها، ثم تطرحها الصفحة من الأصل فيبقى صوت المتكلم كما سُجّل.
final class MdxSeparator {
    // 64 إطارًا: ربع الذاكرة بجودة شبه مطابقة (انظر separate.js)
    let nFft = 5120, hop = 1024, dimF = 2560, dimT = 64
    private let forward: vDSP_DFT_Setup
    private let inverse: vDSP_DFT_Setup
    private let win: [Float]
    private let model: ([Float]) throws -> [Float]

    init(model: @escaping ([Float]) throws -> [Float]) {
        self.model = model
        // 5120 = 5 × 1024: طول يدعمه vDSP مباشرة
        forward = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(nFft), .FORWARD)!
        inverse = vDSP_DFT_zop_CreateSetup(forward, vDSP_Length(nFft), .INVERSE)!
        let n = 5120
        win = (0..<n).map { 0.5 - 0.5 * cos(2 * Float.pi * Float($0) / Float(n)) }
    }

    deinit {
        vDSP_DFT_DestroySetup(forward)
        vDSP_DFT_DestroySetup(inverse)
    }

    /// طيف قناتين بتحويل مركب واحد (x0 + i·x1)، مثل torch.stft(center=True).
    /// الناتج لكل قناة: [bins × frames] حقيقي وتخيلي.
    private func stft(_ x0: [Float], _ x1: [Float], from: Int, len: Int) -> (re: [[Float]], im: [[Float]], frames: Int) {
        let pad = nFft / 2, frames = 1 + len / hop, bins = nFft / 2 + 1
        var re = [[Float]](repeating: [Float](repeating: 0, count: bins * frames), count: 2)
        var im = re
        var ir = [Float](repeating: 0, count: nFft), ii = ir, orr = ir, oi = ir
        for f in 0..<frames {
            let start = f * hop - pad
            for i in 0..<nFft {
                var j = start + i
                if j < 0 { j = -j }
                if j >= len { j = 2 * (len - 1) - j }
                ir[i] = x0[from + j] * win[i]; ii[i] = x1[from + j] * win[i]
            }
            vDSP_DFT_Execute(forward, ir, ii, &orr, &oi)
            for k in 0..<bins {
                let kk = (nFft - k) % nFft
                let ar = orr[k], ai = oi[k], br = orr[kk], bi = -oi[kk]
                re[0][k * frames + f] = (ar + br) / 2; im[0][k * frames + f] = (ai + bi) / 2
                re[1][k * frames + f] = (ai - bi) / 2; im[1][k * frames + f] = -(ar - br) / 2
            }
        }
        return (re, im, frames)
    }

    private func istft(re: [[Float]], im: [[Float]], frames: Int, length: Int) -> [[Float]] {
        let pad = nFft / 2, bins = nFft / 2 + 1
        let total = nFft + hop * (frames - 1)
        var y0 = [Float](repeating: 0, count: total), y1 = y0, norm = y0
        var ir = [Float](repeating: 0, count: nFft), ii = ir, orr = ir, oi = ir
        for f in 0..<frames {
            for k in 0..<nFft {
                let x0r, x0i, x1r, x1i: Float
                if k < bins {
                    x0r = re[0][k * frames + f]; x0i = im[0][k * frames + f]; x1r = re[1][k * frames + f]; x1i = im[1][k * frames + f]
                } else {
                    let kk = nFft - k
                    x0r = re[0][kk * frames + f]; x0i = -im[0][kk * frames + f]; x1r = re[1][kk * frames + f]; x1i = -im[1][kk * frames + f]
                }
                ir[k] = x0r - x1i; ii[k] = x0i + x1r
            }
            vDSP_DFT_Execute(inverse, ir, ii, &orr, &oi)
            let o = f * hop, n = Float(nFft)
            for i in 0..<nFft {
                let w = win[i]
                y0[o + i] += orr[i] / n * w; y1[o + i] += oi[i] / n * w; norm[o + i] += w * w
            }
        }
        var r0 = [Float](repeating: 0, count: length), r1 = r0
        for i in 0..<length {
            let nn = max(norm[pad + i], 1e-8)
            r0[i] = y0[pad + i] / nn; r1[i] = y1[pad + i] / nn
        }
        return [r0, r1]
    }

    /// الموسيقى المقدّرة لقناتين بتردد 44.1kHz (نفس الطول).
    func music(_ left: [Float], _ right: [Float], progress: (Float) -> Void) throws -> [[Float]] {
        let trim = nFft / 2, chunk = hop * (dimT - 1), gen = chunk - 2 * trim
        let n = left.count, pad = gen - n % gen, total = trim + n + pad + trim
        var p0 = [Float](repeating: 0, count: total), p1 = p0
        p0.replaceSubrange(trim..<(trim + n), with: left)
        p1.replaceSubrange(trim..<(trim + n), with: right)
        var o0 = [Float](repeating: 0, count: n + pad), o1 = o0
        var input = [Float](repeating: 0, count: 4 * dimF * dimT)
        let steps = (n + pad + gen - 1) / gen
        var i = 0, step = 0
        while i < n + pad {
            let s = stft(p0, p1, from: i, len: chunk)
            let frames = s.frames
            for c in 0..<2 {
                for k in 0..<dimF {
                    for t in 0..<dimT {
                        input[((2 * c) * dimF + k) * dimT + t] = s.re[c][k * frames + t]
                        input[((2 * c + 1) * dimF + k) * dimT + t] = s.im[c][k * frames + t]
                    }
                }
            }
            let y = try model(input)
            let bins = nFft / 2 + 1
            var re = [[Float]](repeating: [Float](repeating: 0, count: bins * frames), count: 2), im = re
            for c in 0..<2 {
                for k in 0..<dimF {
                    for t in 0..<dimT {
                        re[c][k * frames + t] = y[((2 * c) * dimF + k) * dimT + t]
                        im[c][k * frames + t] = y[((2 * c + 1) * dimF + k) * dimT + t]
                    }
                }
            }
            let r = istft(re: re, im: im, frames: frames, length: chunk)
            o0.replaceSubrange(i..<(i + gen), with: r[0][trim..<(trim + gen)])
            o1.replaceSubrange(i..<(i + gen), with: r[1][trim..<(trim + gen)])
            i += gen
            step += 1
            progress(Float(step) / Float(steps))
        }
        return [Array(o0[0..<n]), Array(o1[0..<n])]
    }
}

/// النموذج نفسه عبر ONNX Runtime: المحرك العصبي (Core ML) إن كان أسرع ونتيجته مطابقة، وإلا المعالج بعدة أنوية.
/// أول مقطع يُشغَّل بالطريقتين: نقارن النتيجة والزمن ونختار، فلا نخاطر بجودة الصوت ولا بالسرعة.
final class NativeSeparator {
    private let env: ORTEnv
    private let modelPath: String
    /// المحرك العصبي (أسرع ٤ مرات تقريبًا) — يُستعمل والتطبيق ظاهر فقط
    private var fast: ORTSession?
    private var accel: String?
    /// المعالج: يعمل دائمًا، وفي الخلفية
    private var cpuSession: ORTSession?
    private var checked = false
    private let useAccel: () -> Bool
    private(set) var backend = "cpu"
    /// زمن تشغيل النموذج لكل مقطع (للتشخيص)
    private(set) var lastMs = 0.0
    private var calls = 0, fastCalls = 0
    private lazy var mdx = MdxSeparator { [unowned self] input in try self.run(input) }

    /// accelerate: يُجهَّز المحرك العصبي. useAccel: يُسأل قبل كل مقطع (مثلًا: هل التطبيق ظاهر؟)؛
    /// في الخلفية قد ينام الجهاز ويتعطل المحرك العصبي، فنكمل بالمعالج.
    init(modelPath: String, accelerate: Bool = true, useAccel: @escaping () -> Bool = { true }) throws {
        env = try ORTEnv(loggingLevel: .warning)
        self.modelPath = modelPath
        self.useAccel = useAccel
        if accelerate, let made = try? Self.makeSession(env, modelPath, coreML: true), made.1 != nil {
            fast = made.0; accel = made.1; backend = made.1 ?? "cpu"
        } else {
            cpuSession = try Self.makeSession(env, modelPath, coreML: false).0
        }
    }

    private static func makeSession(_ env: ORTEnv, _ path: String, coreML: Bool) throws -> (ORTSession, String?) {
        let opts = try ORTSessionOptions()
        try opts.setIntraOpNumThreads(Int32(min(4, ProcessInfo.processInfo.activeProcessorCount)))
        // الأوزان int8 تُفك إلى float مرة واحدة عند التحميل (ربع الحجم بنفس الجودة تقريبًا)
        try opts.addConfigEntry(withKey: "session.disable_quant_qdq", value: "1")
        let used = coreML ? OrtSetup.addCoreML(opts) : nil
        return (try ORTSession(env: env, modelPath: path, sessionOptions: opts), used)
    }

    private func cpu() throws -> ORTSession {
        if let cpuSession { return cpuSession }
        let s = try Self.makeSession(env, modelPath, coreML: false).0
        cpuSession = s
        return s
    }

    private func run(_ input: [Float]) throws -> [Float] {
        let t0 = CFAbsoluteTimeGetCurrent()
        calls += 1
        defer {
            lastMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000
            if calls <= 3 || calls % 20 == 0 { HisnLog.write("sep: call \(calls) \(Int(lastMs))ms (\(fastCalls) fast)") }
        }
        guard let fastSession = fast, useAccel() else { return try runOnce(try cpu(), input) }
        let out: [Float]
        do {
            out = try runOnce(fastSession, input)
        } catch {
            // Core ML رفض: نكمل بالمعالج، النتيجة نفسها
            fast = nil; backend = "cpu (fallback)"
            return try runOnce(try cpu(), input)
        }
        fastCalls += 1
        if checked { return out }
        checked = true
        // أول مرة: نفس المقطع بالمعالج — إن اختلفت النتيجة أو كان المعالج أسرع، نعتمد المعالج
        let t2 = CFAbsoluteTimeGetCurrent()
        _ = try runOnce(fastSession, input)
        let tFast = CFAbsoluteTimeGetCurrent() - t2
        let t1 = CFAbsoluteTimeGetCurrent()
        let ref = try runOnce(try cpu(), input)
        let tCPU = CFAbsoluteTimeGetCurrent() - t1
        let err = OrtSetup.relativeError(out, ref)
        if err > 0.03 || tCPU < tFast * 0.8 {
            fast = nil
            backend = "cpu (\(accel ?? "") err \(String(format: "%.3f", err)), \(Int(tFast * 1000))ms vs \(Int(tCPU * 1000))ms)"
            return ref
        }
        backend = "\(accel ?? "") (err \(String(format: "%.3f", err)), \(Int(tFast * 1000))ms vs cpu \(Int(tCPU * 1000))ms)"
        return out
    }

    private func runOnce(_ s: ORTSession, _ input: [Float]) throws -> [Float] {
        let data = input.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * 4) }
        let tensor = try ORTValue(tensorData: data, elementType: .float, shape: [1, 4, 2560, NSNumber(value: input.count / (4 * 2560))])
        let out = try s.run(withInputs: ["input": tensor], outputNames: ["output"], runOptions: nil)
        guard let value = out["output"] else { throw NSError(domain: "hisn", code: 10) }
        let bytes = try value.tensorData() as Data
        return bytes.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }

    func music(_ left: [Float], _ right: [Float], progress: (Float) -> Void) throws -> [[Float]] {
        try mdx.music(left, right, progress: progress)
    }
}

/// صوت int16 (base64) ↔ أرقام عشرية — نفس ترميز الصفحة.
enum Pcm {
    static func decode(_ b64: String) -> [Float] {
        guard let d = Data(base64Encoded: b64) else { return [] }
        return d.withUnsafeBytes { raw in raw.bindMemory(to: Int16.self).map { Float(Int16(littleEndian: $0)) / 32768 } }
    }

    static func encode(_ x: ArraySlice<Float>) -> String {
        var out = Data(capacity: x.count * 2)
        for v in x {
            let s = Int16(max(-1, min(1, v)) * 32767).littleEndian
            withUnsafeBytes(of: s) { out.append(contentsOf: $0) }
        }
        return out.base64EncodedString()
    }
}
