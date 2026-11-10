// معالجة مخرجات نموذج NudeNet 320n (YOLOv8n) — منقولة من الكود الرسمي nudenet 3.4.2 (AGPL-3.0)
// https://github.com/notAI-tech/NudeNet
// الدوال هنا لا تعتمد على المتصفح، فتُستخدم في الإضافة وتُختبر في Node.

export const NUDENET_LABELS = [
    "FEMALE_GENITALIA_COVERED",
    "FACE_FEMALE",
    "BUTTOCKS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_BREAST_EXPOSED",
    "ANUS_EXPOSED",
    "FEET_EXPOSED",
    "BELLY_COVERED",
    "FEET_COVERED",
    "ARMPITS_COVERED",
    "ARMPITS_EXPOSED",
    "FACE_MALE",
    "BELLY_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "ANUS_COVERED",
    "FEMALE_BREAST_COVERED",
    "BUTTOCKS_COVERED",
];

export const NUDENET_SIZE = 320;

/**
 * معاملات التبطين: الصورة تُوضع في مربع ضلعه أكبر بعديها، والفراغ يمين وأسفل،
 * ثم يُصغَّر المربع إلى 320×320 (مطابق لـ _read_image في الكود الأصلي).
 */
export function letterbox(width, height) {
    const side = Math.max(width, height);
    return { side, xPad: side - width, yPad: side - height };
}

/**
 * يحوّل بكسلات RGBA (320×320 بعد التبطين والتصغير) إلى مدخل النموذج:
 * Float32 بشكل [1, 3, 320, 320]، قيم 0..1، ترتيب RGB.
 */
export function rgbaToTensor(rgba, size = NUDENET_SIZE) {
    const plane = size * size;
    const out = new Float32Array(3 * plane);
    for (let i = 0, p = 0; p < plane; i += 4, p++) {
        out[p] = rgba[i] / 255;
        out[plane + p] = rgba[i + 1] / 255;
        out[2 * plane + p] = rgba[i + 2] / 255;
    }
    return out;
}

function iou(a, b) {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
    const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a[2] * a[3] + b[2] * b[3] - inter;
    return union > 0 ? inter / union : 0;
}

/** NMS بنفس سلوك cv2.dnn.NMSBoxes: ترتيب تنازلي بالثقة، وحذف المتداخل فوق العتبة. */
export function nms(boxes, scores, scoreThreshold = 0.25, iouThreshold = 0.45) {
    const order = scores
        .map((s, i) => [s, i])
        .filter(([s]) => s >= scoreThreshold)
        .sort((a, b) => b[0] - a[0])
        .map(([, i]) => i);
    const keep = [];
    for (const i of order) {
        if (keep.every((k) => iou(boxes[i], boxes[k]) <= iouThreshold)) keep.push(i);
    }
    return keep;
}

/**
 * يحوّل مخرج النموذج [1, 22, N] إلى كشوفات: { class, score, box:[x,y,w,h] } بإحداثيات الصورة الأصلية.
 * @param {Float32Array} output البيانات الخام
 * @param {number[]} dims شكل المخرج، مثل [1, 22, 2100]
 */
export function postprocess(output, dims, width, height, { minScore = 0.2, nmsScore = 0.25, nmsIou = 0.45 } = {}) {
    const [, channels, rows] = dims;
    const nClasses = channels - 4;
    const { xPad, yPad } = letterbox(width, height);
    const sx = (width + xPad) / NUDENET_SIZE;
    const sy = (height + yPad) / NUDENET_SIZE;
    const boxes = [];
    const scores = [];
    const classIds = [];
    // المخرج مخزّن [channel][row]؛ الكود الأصلي ينقله إلى [row][channel]
    for (let r = 0; r < rows; r++) {
        let best = -1;
        let bestScore = -Infinity;
        for (let c = 0; c < nClasses; c++) {
            const v = output[(4 + c) * rows + r];
            if (v > bestScore) { bestScore = v; best = c; }
        }
        if (bestScore < minScore) continue;
        let x = output[r], y = output[rows + r], w = output[2 * rows + r], h = output[3 * rows + r];
        x = (x - w / 2) * sx;
        y = (y - h / 2) * sy;
        w = w * sx;
        h = h * sy;
        x = Math.max(0, Math.min(x, width));
        y = Math.max(0, Math.min(y, height));
        w = Math.min(w, width - x);
        h = Math.min(h, height - y);
        boxes.push([x, y, w, h]);
        scores.push(bestScore);
        classIds.push(best);
    }
    return nms(boxes, scores, nmsScore, nmsIou).map((i) => ({
        class: NUDENET_LABELS[classIds[i]],
        score: scores[i],
        box: boxes[i].map((v) => Math.trunc(v)),
    }));
}

const EXPOSED_SEXUAL = ["FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_EXPOSED"];
const EXPOSED_AWRAH = ["FEMALE_BREAST_EXPOSED", "BUTTOCKS_EXPOSED"];

/**
 * يلخّص كشوفات NudeNet إلى درجات تفهمها سياسة المحتوى:
 * - sexual: أعضاء مكشوفة صراحة
 * - nudity: عورة مكشوفة، أو لباس فاضح (مثل ملابس السباحة: صدر مغطى مع بطن مكشوف)
 * - faces: الوجوه مع الجنس (دليل إضافي لنموذج الأشخاص)
 */
/**
 * وزن البطن المكشوف: للمرأة أعلى من ثقة النموذج نفسها (ثقته في البطن منخفضة عادة حتى حين يكون واضحًا:
 * 0.5–0.6 لبلوزة قصيرة في صورة واسعة)، وللرجل أقل.
 */
export function bellyWeight(score, female) {
    if (!(score > 0)) return 0;
    return female ? Math.min(1, score * 1.15 + 0.05) : 0.8 * score;
}

export function summarizeNudity(detections) {
    const best = (cls) => Math.max(0, ...detections.filter((d) => d.class === cls).map((d) => d.score));
    const sexual = Math.max(...EXPOSED_SEXUAL.map(best));
    // البطن المكشوف: عورة كاملة إذا كانت الصورة لامرأة (وجه امرأة أو صدر مغطى)، وأخف وزنًا للرجال
    const female = best("FACE_FEMALE") >= 0.4 || best("FEMALE_BREAST_COVERED") >= 0.3;
    let nudity = Math.max(sexual, ...EXPOSED_AWRAH.map(best), bellyWeight(best("BELLY_EXPOSED"), female));
    // لباس فاضح: صدر أو أرداف مغطاة بشيء ضيق مع بطن مكشوف
    const revealing = Math.min(
        Math.max(best("FEMALE_BREAST_COVERED"), best("BUTTOCKS_COVERED")),
        best("BELLY_EXPOSED")
    );
    nudity = Math.max(nudity, revealing > 0.3 ? Math.min(1, revealing + 0.25) : 0);
    const faces = detections
        .filter((d) => d.class === "FACE_FEMALE" || d.class === "FACE_MALE")
        .map((d) => ({ gender: d.class === "FACE_FEMALE" ? "female" : "male", score: d.score, box: d.box }));
    return { sexual, nudity, faces };
}
