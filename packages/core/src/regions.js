// قرارات على مستوى المناطق: ماذا نغطي داخل الصورة (لا الصورة كلها).
// تُستخدم في تنظيف الفيديو من الاستوديو، وهي نفس منطق شاشة أندرويد (ScreenPolicy.kt).
import { effectiveSettings, exposedThigh } from "./policy.js";
import { THIGH_SKIN } from "./skin.js";
import { bellyWeight } from "./nudenet.js";

const SEXUAL = new Set(["FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_EXPOSED"]);
const AWRAH = new Set(["FEMALE_BREAST_EXPOSED", "BUTTOCKS_EXPOSED"]);
const THRESHOLD = { light: 0.75, medium: 0.6, strict: 0.45 };
/** أصغر شخص يُحسب: 0.2% من الإطار (وجه بعيد في الخلفية). */
export const MIN_REGION_AREA = 0.002;

const area = (b) => Math.max(0, b[2]) * Math.max(0, b[3]);
const center = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
const contains = (b, [x, y]) => x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3];
export function expand(b, f) {
    return [b[0] - (b[2] * f) / 2, b[1] - (b[3] * f) / 2, b[2] * (1 + f), b[3] * (1 + f)];
}
export function clip(b, w, h) {
    const x1 = Math.max(0, Math.min(w, b[0])), y1 = Math.max(0, Math.min(h, b[1]));
    const x2 = Math.max(0, Math.min(w, b[0] + b[2])), y2 = Math.max(0, Math.min(h, b[1] + b[3]));
    return [x1, y1, x2 - x1, y2 - y1];
}
function iouAny(a, b) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    return x2 > x1 && y2 > y1;
}

/** قرار شخص واحد (منقول من policy.js decideImage) — null يعني لا يُغطّى. */
export function personRegionDecision(p, s) {
    if ((p.area ?? 1) < MIN_REGION_AREA && s.level !== "strict") return null;
    if (s.blurPeople) return "person";
    const female = p.gender === "female";
    const unsure = p.gender === "unknown" || (p.gender === "male" && (p.genderScore ?? 1) < 0.1);
    if (p.adult === false && !s.blurGirls) return null;
    if (p.cartoon && s.level !== "strict") return null;
    if (female && p.covered && !s.blurCoveredWomen) return null;
    if (female && s.blurAdultWomen) return "woman";
    if (p.gender === "male" && s.blurMen) return "man";
    if (unsure && s.blurAdultWomen && s.level !== "light") return "uncertain-person";
    return null;
}

/**
 * @param {{ width:number, height:number, detections:{class:string,score:number,box:number[]}[],
 *           people:{gender:string,genderScore:number,adult:boolean|null,area:number,box:number[]}[] }} frame
 * @returns {{ covers: { box:number[], reason:string }[], full: boolean }}
 */
export function decideRegions(frame, settings) {
    const s = effectiveSettings(settings);
    const t = THRESHOLD[s.level] ?? 0.6;
    const { width: w, height: h } = frame;
    const covers = [];
    let full = false;
    const personAt = (b) => frame.people.filter((p) => contains(p.box, center(b))).sort((a, c) => area(c.box) - area(a.box))[0];
    const coverAround = (b, reason) => {
        const p = personAt(b);
        covers.push({ box: clip(expand(p ? p.box : expand(b, 1), 0.08), w, h), reason });
    };
    const femaleNear = (b) => personAt(b)?.gender === "female" ||
        frame.detections.some((d) => d.class === "FACE_FEMALE" && d.score >= 0.4 && iouAny(d.box, expand(b, 3)));
    for (const d of frame.detections) {
        let eff = 0;
        if (SEXUAL.has(d.class) || AWRAH.has(d.class)) eff = d.score;
        else if (d.class === "BELLY_EXPOSED") eff = bellyWeight(d.score, femaleNear(d.box));
        if (eff >= t) {
            const sexual = SEXUAL.has(d.class);
            coverAround(d.box, sexual ? "sexual" : "nudity");
            if (sexual) full = true;
        }
    }
    // لباس فاضح: بطن مكشوف مع صدر أو أرداف مغطاة بشيء ضيق، في نفس الشخص
    for (const belly of frame.detections.filter((d) => d.class === "BELLY_EXPOSED")) {
        const p = personAt(belly.box);
        const tight = Math.max(0, ...frame.detections
            .filter((d) => (d.class === "FEMALE_BREAST_COVERED" || d.class === "BUTTOCKS_COVERED") &&
                (p ? contains(p.box, center(d.box)) : iouAny(d.box, expand(belly.box, 2))))
            .map((d) => d.score));
        const revealing = Math.min(tight, belly.score);
        if (revealing > 0.3 && Math.min(1, revealing + 0.25) >= t) coverAround(belly.box, "nudity");
    }
    for (const p of frame.people) {
        if (exposedThigh(p, s)) covers.push({ box: clip(expand(p.box, 0.08), w, h), reason: "nudity" });
        const r = personRegionDecision(p, s);
        if (r) covers.push({ box: clip(expand(p.box, 0.08), w, h), reason: r });
    }
    return { covers, full };
}

/** أقل ثقة لـ«رجل» حتى نُظهره وحده بجوار امرأة مغطّاة (الأقل قد يكون امرأة أخطأ فيها النموذج). */
export const PARTIAL_MALE_SCORE = 0.25;
/** إذا تجاوزت الأغطية هذه النسبة من الصورة، نغطيها كلها (أنظف شكلًا). */
const PARTIAL_MAX_AREA = 0.6;

/**
 * تغطية جزئية لصورة: النساء (أو العورة على شخص) وحدهن، ويبقى الباقي ظاهرًا.
 * تُرجع null حين يجب الرجوع لتغطية الصورة كلها: محتوى جنسي أو عري، أو شخص ظاهر لا نثق أنه رجل،
 * أو أغطية تملأ أغلب الصورة، أو لا يوجد ما يُغطّى أصلًا.
 * @param d نتيجة الكشف، وفيها لكل شخص box نسبي (0..1)
 * @returns {{ box:number[], reason:string }[] | null} صناديق نسبية
 */
// هامش أوسع من تغطية الفيديو: الشعر والذراعان والركبتان تخرج عن صندوق الجسم (نقاطه داخلية)،
// فنوسّع العرض 60% والطول 16%
const widenBox = ([x, y, w, h]) => [x - w * 0.3, y - h * 0.08, w * 1.6, h * 1.16];

export function partialImage(d, settings) {
    const s = effectiveSettings(settings);
    // الصارم: الصورة كلها تُغطّى (لا تغطية جزئية)
    if (!d?.analyzed || s.blurPeople || settings.partialBlur === false || s.level === "strict") return null;
    const t = THRESHOLD[s.level] ?? 0.6;
    if ((d.sexual ?? 0) >= t || (d.nudity ?? 0) >= t) return null;
    const covers = [];
    for (const p of d.people ?? []) {
        if (!p.box) return null;
        if (exposedThigh(p, s)) { covers.push({ box: p.box, reason: "nudity" }); continue; }
        if ((p.area ?? 1) < 0.01 && s.level !== "strict") continue; // مثل قرار الصورة كاملة
        const r = personRegionDecision(p, s);
        if (r) { covers.push({ box: p.box, reason: r }); continue; }
        // يظهر: يجب أن نثق أنه ليس امرأة أخطأ فيها النموذج — للرجل المستخدم دائمًا،
        // وللمستخدمة إن كان فخذه مكشوفًا (لو كانت امرأة لوجبت تغطيتها)
        const weakMale = p.gender === "male" && (p.genderScore ?? 0) < PARTIAL_MALE_SCORE && p.adult !== false;
        if (weakMale && (s.blurAdultWomen || (p.thighSkin ?? 0) >= THIGH_SKIN)) return null;
    }
    if (!covers.length) return null;
    // ما فات كشف الأشخاص: أجزاء امرأة من NudeNet (صدر أو أرداف أو بطن أو وجه) خارج ما سيُغطّى،
    // وليست داخل رجل واثقين منه ← لا نثق بالتغطية الجزئية، فالصورة كلها
    if (s.blurAdultWomen) {
        const men = (d.people ?? []).filter((p) => p.box && p.gender === "male" && (p.genderScore ?? 0) >= PARTIAL_MALE_SCORE);
        const covered = covers.map((c) => widenBox(c.box));
        for (const part of d.parts ?? []) {
            const c = [part.box[0] + part.box[2] / 2, part.box[1] + part.box[3] / 2];
            if (covered.some((b) => contains(b, c))) continue;
            if (part.class === "FACE_FEMALE" && men.some((m) => contains(m.box, c))) continue; // NudeNet يخطئ في وجوه الرجال
            return null;
        }
    }
    const out = covers.map((c) => ({ box: clip(widenBox(c.box), 1, 1), reason: c.reason }));
    if (unionArea(out.map((c) => c.box)) > PARTIAL_MAX_AREA) return null;
    return out;
}

/** مساحة اتحاد صناديق نسبية (بشبكة تقريبية 50×50 تكفي هنا). */
function unionArea(boxes) {
    const n = 50;
    let hit = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = (i + 0.5) / n, y = (j + 0.5) / n;
        if (boxes.some((b) => contains(b, [x, y]))) hit++;
    }
    return hit / (n * n);
}
