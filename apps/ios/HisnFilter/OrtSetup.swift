import Foundation
import OnnxRuntimeBindings

/// إعداد Core ML موحّد لكل نماذج التطبيق (الكشف وفصل الموسيقى):
/// - المعالج + المحرك العصبي فقط (بلا كرت الشاشة): يعمل في الخلفية أيضًا، والنظام يمنع كرت الشاشة هناك.
/// - صيغة MLProgram: تشغّل عمليات أكثر على المحرك العصبي، وهو أسرع بكثير من المعالج.
/// - ذاكرة مؤقتة للنموذج المحوَّل: لا يُعاد تحويله في كل مرة يُفتح فيها التطبيق.
enum OrtSetup {
    static let cacheDir: String = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("coreml", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.path
    }()

    /// يضيف Core ML إن أمكن (بخيارات تتدرج من الأفضل إلى الأبسط). يُرجع اسم ما استُخدم، أو nil (المعالج وحده).
    @discardableResult
    static func addCoreML(_ opts: ORTSessionOptions, format: String = "MLProgram") -> String? {
        // (جُرّب RequireStaticInputShapes: يُسكت أخطاء movenet لكنه يُفسد نتائج الوجوه والمشهد — لا يُستخدم)
        let base: [String: String] = ["MLComputeUnits": "CPUAndNeuralEngine", "ModelFormat": format]
        if (try? opts.appendCoreMLExecutionProvider(withOptionsV2: base.merging(["ModelCacheDirectory": cacheDir]) { a, _ in a })) != nil { return "coreml-ane" }
        if (try? opts.appendCoreMLExecutionProvider(withOptionsV2: base)) != nil { return "coreml-ane" }
        if (try? opts.appendCoreMLExecutionProvider(with: ORTCoreMLExecutionProviderOptions())) != nil { return "coreml" }
        return nil
    }

    /// الفرق النسبي بين ناتجين (للتأكد أن Core ML يعطي نفس نتيجة المعالج).
    static func relativeError(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return .infinity }
        var d: Float = 0, n: Float = 0
        for i in 0..<a.count { let x = a[i] - b[i]; d += x * x; n += b[i] * b[i] }
        return n > 0 ? (d / n).squareRoot() : (d > 0 ? .infinity : 0)
    }
}
