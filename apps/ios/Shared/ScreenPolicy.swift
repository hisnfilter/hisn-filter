import Foundation

/// وجه في لقطة الشاشة بعد تحليل نموذج الجنس والعمر.
struct ScanFace {
    let area: Double // نسبة من الشاشة
    let female: Bool
    let genderScore: Double
    let age: Double
}

enum ScanVerdict: Equatable {
    case clean
    case violation(String)
}

/// نفس قواعد سياسة المحتوى في الإضافة وأندرويد (packages/core/src/policy.js)، مختصرة للشاشة.
enum ScreenPolicy {
    static let minArea = 0.002

    /// نسبة البشرة على الفخذ التي نعدّها «مكشوفًا» (مثل skin.js).
    static let thighSkin = 0.55

    /// - thighs: نسبة البشرة بين الورك والركبة لكل جسم ظاهر (لباس قصير).
    static func decide(sensitive: Bool, faces: [ScanFace], viewer: Viewer, level: Level, thighs: [Double] = []) -> ScanVerdict {
        if sensitive { return .violation("nudity") } // العورة للجميع وفي كل المستويات
        // فخذ مكشوف: عورة حتى للمستخدمة، إذا كان في الشاشة امرأة (أو لم يُعرف الجنس في المتوسط والصارم)
        if thighs.contains(where: { $0 >= thighSkin }) {
            let adults = faces.filter { !($0.age > 0 && $0.age <= 12) }
            let woman = adults.contains { $0.female }
            let unknown = adults.isEmpty || adults.contains { !$0.female && $0.genderScore < 0.1 }
            if woman || (unknown && level != .light) { return .violation("nudity") }
        }
        if level == .light { return .clean }
        // مثل policy.js تمامًا: «صارم» لا يحجب كل الأشخاص — الرجال والأطفال لا يُحجبون، ولا شيء للمستخدمة؛
        // الفرق عن المتوسط أن الوجوه الصغيرة البعيدة تُحسب أيضًا
        for f in faces {
            if f.area < minArea && level != .strict { continue }
            if f.age > 0 && f.age <= 12 { continue } // الأطفال
            guard viewer == .male else { continue }
            // "امرأة" تبقى امرأة مهما كانت الثقة؛ و"رجل" بثقة أقل من 0.1 غير مؤكد فيُحجب
            if f.female || f.genderScore < 0.1 { return .violation("woman") }
        }
        return .clean
    }

    /// تفسير مخرجات FaceRes (مثل Human): الثقة = 2×|p−0.5|، والعمر من توزيع 100 فئة.
    static func parseFaceRes(genderP: Double, ages: [Double]) -> (female: Bool, score: Double, age: Double) {
        let conf = Double(Int(200 * abs(genderP - 0.5))) / 100
        let female = genderP <= 0.5
        guard let i = ages.indices.max(by: { ages[$0] < ages[$1] }) else { return (female, min(0.99, conf), 0) }
        let lo = i > 0 ? ages[i - 1] : 0
        let hi = i + 1 < ages.count ? ages[i + 1] : 0
        let v = lo > hi ? 10 * Double(i) - 100 * lo : 10 * Double(i) + 100 * hi
        let age = v.rounded() / 10
        return (female, min(0.99, conf), age)
    }
}
