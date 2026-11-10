// الفخذ المكشوف (من العورة بين السرة والركبة): نموذج كشف العري لا يعرفه، فنقيسه من وضع الجسم
// (الورك والركبة من نموذج الأجسام) ولون البشرة على امتداد الفخذ. لباس قصير يكشف الفخذ ← يُغطّى.

/** نسبة البشرة على الفخذ التي نعدّها «مكشوفًا». */
export const THIGH_SKIN = 0.55;
const MIN_POINT = 0.3; // أقل ثقة لنقطة الورك أو الركبة

/** لون بشرة (YCbCr، يشمل البشرة الفاتحة والداكنة، ويستبعد الرمادي والأزرق والأخضر). */
export function isSkin(r, g, b) {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    return y > 45 && cr >= 135 && cr <= 180 && cb >= 80 && cb <= 135 && r > g && r > b && r - Math.min(g, b) > 12;
}

/** نسبة البشرة على شريط بين الورك والركبة (من 25% إلى 85% من طوله). */
export function legSkin(hip, knee, rgba, w, h) {
    const dx = knee[0] - hip[0], dy = knee[1] - hip[1];
    const len = Math.hypot(dx, dy);
    if (len < 10) return null; // الساق صغيرة جدًا في الصورة
    const nx = -dy / len, ny = dx / len; // عمودي على الفخذ
    const half = 0.18 * len;
    let skin = 0, total = 0;
    for (let t = 0.25; t <= 0.851; t += 0.05) {
        for (let s = -1; s <= 1.001; s += 0.25) {
            const x = Math.round(hip[0] + dx * t + nx * half * s), y = Math.round(hip[1] + dy * t + ny * half * s);
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const i = (y * w + x) * 4;
            total++;
            if (isSkin(rgba[i], rgba[i + 1], rgba[i + 2])) skin++;
        }
    }
    return total >= 20 ? skin / total : null;
}

/**
 * @param kp نقاط الجسم: { leftHip:[x,y,ثقة], rightHip, leftKnee, rightKnee }
 * @returns {{ score:number, box:number[] } | null} أعلى نسبة بشرة بين الفخذين، وصندوق الفخذين
 */
export function thighExposure(kp, rgba, w, h) {
    let best = null;
    const xs = [], ys = [];
    for (const side of ["left", "right"]) {
        const hip = kp?.[side + "Hip"], knee = kp?.[side + "Knee"];
        if (!hip || !knee || hip[2] < MIN_POINT || knee[2] < MIN_POINT) continue;
        const f = legSkin(hip, knee, rgba, w, h);
        if (f === null) continue;
        best = Math.max(best ?? 0, f);
        xs.push(hip[0], knee[0]); ys.push(hip[1], knee[1]);
    }
    if (best === null) return null;
    const pad = 0.25 * (Math.max(...ys) - Math.min(...ys));
    const x1 = Math.min(...xs) - pad, y1 = Math.min(...ys) - pad / 2;
    return { score: best, box: [x1, y1, Math.max(...xs) + pad - x1, Math.max(...ys) + pad / 2 - y1] };
}

/**
 * بديل حين لا يُكتشف الجسم (زحام أو صورة صغيرة): نقدّر موضع الفخذين من الوجه بنِسب الجسم المعتادة
 * (الفخذ بين نحو 3.7 و5.3 من طول الوجه تحت أعلاه، بعرض الوجه تقريبًا) ونقيس البشرة هناك.
 */
export function thighFromFace(faceBox, rgba, w, h) {
    const [fx, fy, fw, fh] = faceBox;
    if (fh < 8) return null;
    const cx = fx + fw / 2;
    const x1 = cx - 0.75 * fw, x2 = cx + 0.75 * fw, y1 = fy + 3.7 * fh, y2 = fy + 5.3 * fh;
    if (y2 > h + 0.3 * fh) return null; // الساقان خارج الصورة (صورة نصفية)
    let skin = 0, total = 0;
    for (let y = y1; y <= y2; y += (y2 - y1) / 10) {
        for (let x = x1; x <= x2; x += (x2 - x1) / 8) {
            const xi = Math.round(x), yi = Math.round(y);
            if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
            const i = (yi * w + xi) * 4;
            total++;
            if (isSkin(rgba[i], rgba[i + 1], rgba[i + 2])) skin++;
        }
    }
    if (total < 40) return null;
    return { score: skin / total, box: [x1, y1, x2 - x1, y2 - y1] };
}


/**
 * هل المنطقة (وجه أو جسم) رسم أو شخصية ألعاب (روبلوكس، كرتون) لا صورة شخص حقيقي؟
 * نموذج الجنس مدرّب على وجوه حقيقية فيخطئ في الشخصيات المرسومة. الرسم: ألوان مسطحة قليلة،
 * وملمس ناعم بلا تفاصيل البشرة. الصور الرمادية (أبيض وأسود) تُعدّ صورًا حقيقية دائمًا.
 * @returns {{ drawn: boolean, skin: number, flat: number, texture: number, sat: number } | null}
 */
export function drawnRegion(box, rgba, w, h) {
    const x0 = Math.max(0, Math.round(box[0] + box[2] * 0.15)), y0 = Math.max(0, Math.round(box[1] + box[3] * 0.15));
    const x1 = Math.min(w, Math.round(box[0] + box[2] * 0.85)), y1 = Math.min(h, Math.round(box[1] + box[3] * 0.85));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 8 || bh < 8) return null; // صغير جدًا للحكم
    const step = Math.max(1, Math.floor(Math.min(bw, bh) / 40));
    const bins = new Map();
    let n = 0, skin = 0, sat = 0, tex = 0, texN = 0;
    const lum = (i) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
            const i = (y * w + x) * 4;
            const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
            n++;
            if (isSkin(r, g, b)) skin++;
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            sat += mx ? (mx - mn) / mx : 0;
            const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
            bins.set(key, (bins.get(key) ?? 0) + 1);
            // ملمس: الفرق بين البكسل وجيرانه المباشرين (لا بخطوة العينة) — البشرة الحقيقية فيها تفاصيل دقيقة
            if (x + 1 < w && y + 1 < h) {
                tex += Math.abs(2 * lum(i) - lum(i + 4) - lum(i + w * 4));
                texN++;
            }
        }
    }
    if (n < 30) return null;
    const top = [...bins.values()].sort((a, b) => b - a);
    const flat = (top[0] + (top[1] ?? 0) + (top[2] ?? 0)) / n;
    const out = { skin: skin / n, flat, texture: texN ? tex / texN : 0, sat: sat / n };
    const gray = out.sat < 0.12;
    out.drawn = !gray && out.texture < DRAWN_TEXTURE && (out.flat > DRAWN_FLAT || out.skin < 0.1);
    return out;
}
export const DRAWN_TEXTURE = 8;
export const DRAWN_FLAT = 0.65;
