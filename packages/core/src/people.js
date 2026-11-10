// دمج كشف الوجوه والأجسام في قائمة أشخاص تفهمها سياسة المحتوى.
// الفكرة: الجسم وحده يكفي لاعتبار وجود شخص، حتى لو لم يظهر وجهه (امرأة من الخلف مثلًا).
// الجنس يأتي من الوجه إن وُجد، وإلا يبقى "غير معروف" فيُعامل بحذر.

const CHILD_AGE = 12; // دون هذا العمر: طفل

function center(b) {
    return [b[0] + b[2] / 2, b[1] + b[3] / 2];
}

function inside(pt, b, margin = 0.15) {
    const mx = b[2] * margin, my = b[3] * margin;
    return pt[0] >= b[0] - mx && pt[0] <= b[0] + b[2] + mx && pt[1] >= b[1] - my && pt[1] <= b[1] + b[3] + my;
}

function iou(a, b) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = a[2] * a[3] + b[2] * b[3] - inter;
    return u > 0 ? inter / u : 0;
}

/**
 * @param {object} p
 * @param {{box:number[], gender?:string, genderScore?:number, age?:number, score?:number}[]} p.faces وجوه من نموذج Human
 * @param {{box:number[], score:number, thigh?:{score:number, box:number[]}}[]} p.bodies أجسام من نموذج الوضعيات (thigh: نسبة البشرة على الفخذ)
 * @param {{box:number[], gender:string, score:number}[]} p.nnFaces وجوه من NudeNet (دليل إضافي على الجنس)
 * @param {number} p.width
 * @param {number} p.height
 * @param {(box:number[]) => {drawn:boolean}|null} [p.lookOf] هل المنطقة رسم (للوجوه التي لا يعرفها نموذج الوجوه)
 */
export function fusePeople({ faces = [], bodies = [], nnFaces = [], width, height, lookOf }) {
    const area = Math.max(1, width * height);
    // الجنس يؤخذ من نموذج الوجوه (Human) فقط. في اختباراتنا كان NudeNet يصنّف وجوه الرجال "أنثى"
    // بثقة عالية، فلا نعتمد رأيه في الجنس. نستخدم وجوهه فقط لاكتشاف شخص فات Human: جنسه غير معروف.
    const allFaces = faces.map((f) => ({ ...f }));
    for (const nf of nnFaces) {
        // نفس الوجه بصندوقين مختلفي الحجم: يكفي أن يقع مركز أحدهما داخل الآخر
        const match = allFaces.find((f) => iou(f.box, nf.box) > 0.3 || inside(center(nf.box), f.box, 0) || inside(center(f.box), nf.box, 0));
        if (!match && nf.score >= 0.4) allFaces.push({ box: nf.box, gender: "unknown", genderScore: 0, look: lookOf?.(nf.box) });
    }

    const people = [];
    const usedFaces = new Set();
    for (const b of mergeDuplicateBodies(bodies)) {
        const fi = allFaces.findIndex((f, i) => !usedFaces.has(i) && inside(center(f.box), b.box));
        const f = fi >= 0 ? allFaces[fi] : null;
        if (fi >= 0) usedFaces.add(fi);
        const person = toPerson(f, b.box, area, width, height);
        // شخصية مرسومة (كرتون أو لعبة)
        person.cartoon = Boolean(f?.look?.drawn); // من الوجه فقط: الملابس السادة تشبه الرسم
        people.push(withThigh(person, b.thigh ?? f?.thigh));
    }
    allFaces.forEach((f, i) => {
        if (!usedFaces.has(i)) {
            // وجه بلا جسم مكتشف: نوسّع الصندوق تقديريًا ليشمل الجسم
            const [x, y, w, h] = f.box;
            const box = [x - w, y, w * 3, Math.min(height - y, h * 6)];
            const person = toPerson(f, box, area, width, height);
            person.cartoon = Boolean(f.look?.drawn);
            people.push(withThigh(person, f.thigh));
        }
    });
    return people;
}

/**
 * نموذج الوضعيات قد يكتشف الشخص نفسه مرتين بصندوقين متداخلين (فيظهر «شخص مجهول» زائد
 * فوق رجل معروف). ندمج المتداخلين بشدة في صندوق واحد يشملهما (الأحوط) ونبقي الأعلى ثقة.
 */
export function mergeDuplicateBodies(bodies) {
    const out = [];
    for (const b of [...bodies].sort((x, y) => y.score - x.score)) {
        const dup = out.find((o) => iou(o.box, b.box) > 0.4);
        if (!dup) { out.push({ ...b }); continue; }
        const x1 = Math.min(dup.box[0], b.box[0]), y1 = Math.min(dup.box[1], b.box[1]);
        const x2 = Math.max(dup.box[0] + dup.box[2], b.box[0] + b.box[2]), y2 = Math.max(dup.box[1] + dup.box[3], b.box[1] + b.box[3]);
        dup.box = [x1, y1, x2 - x1, y2 - y1];
        if ((b.thigh?.score ?? 0) > (dup.thigh?.score ?? 0)) dup.thigh = b.thigh;
    }
    return out;
}

/** نسبة البشرة على الفخذ: من نقاط الجسم إن وُجدت، وإلا تقديرًا من الوجه. */
function withThigh(person, thigh) {
    return thigh ? { ...person, thighSkin: thigh.score, thighBox: thigh.box } : person;
}

function toPerson(face, rawBox, area, width, height) {
    // نقص الصندوق على حدود الصورة حتى لا تتجاوز المساحة 100%
    const x1 = Math.max(0, rawBox[0]), y1 = Math.max(0, rawBox[1]);
    const x2 = Math.min(width, rawBox[0] + rawBox[2]), y2 = Math.min(height, rawBox[1] + rawBox[3]);
    const box = [x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1)];
    const gender = face?.gender && face.gender !== "unknown" ? face.gender : "unknown";
    let adult = null;
    if (typeof face?.age === "number" && face.age > 0) adult = face.age > CHILD_AGE;
    return {
        gender,
        genderScore: gender === "unknown" ? 0 : face.genderScore ?? 0.5,
        adult,
        covered: false, // كشف النقاب غير مدعوم بعد، فتُعامل المنقبة كغيرها (الأحوط)
        cartoon: false,
        area: Math.max(0, (box[2] * box[3]) / area),
        box,
    };
}
