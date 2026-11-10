// فيديو الجوال العمودي يُخزَّن غالبًا مائلًا (90°) ويُعرض مُدارًا. نفحص الصورة كما تُعرض (معتدلة)
// لأن النموذج أدق على الأشخاص الواقفين، ثم نعيد المربعات إلى إحداثيات الإطار المخزَّن للرسم.
// الزاوية باتجاه عقارب الساعة (كما في مصفوفة MP4 وفي mp4-muxer).

/** أبعاد الصورة المعروضة. */
export function displaySize(w, h, rot) {
    return rot === 90 || rot === 270 ? [h, w] : [w, h];
}

/** يرسم الإطار المخزَّن مُدارًا كما يُعرض. */
export function drawRotated(ctx, src, w, h, rot) {
    ctx.save();
    if (rot === 90) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(w, h); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
}

/** مربع نسبي [x,y,w,h] في الصورة المعروضة ← مربع نسبي في الإطار المخزَّن. */
export function unrotateBox([X, Y, W, H], rot) {
    if (rot === 90) return [Y, 1 - X - W, H, W];
    if (rot === 180) return [1 - X - W, 1 - Y - H, W, H];
    if (rot === 270) return [1 - Y - H, X, H, W];
    return [X, Y, W, H];
}

/** نقطة نسبية في الإطار المخزَّن ← نقطة في الصورة المعروضة (للاختبار وللتحقق). */
export function rotatePoint([x, y], rot) {
    if (rot === 90) return [1 - y, x];
    if (rot === 180) return [1 - x, 1 - y];
    if (rot === 270) return [y, 1 - x];
    return [x, y];
}
