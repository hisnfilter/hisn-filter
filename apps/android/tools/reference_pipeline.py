"""خط الكشف المرجعي لنسخة الجوال (بايثون + ONNX).

يعيد تنفيذ ما تفعله مكتبة Human في الإضافة، لكن على نماذج ONNX المحوّلة:
  blazeface (الوجوه) ← faceres (الجنس والعمر)، و movenet-multipose (الأجسام).
الهدف: (1) التأكد أن النماذج المحوّلة تعطي نفس الحكم على صور الاختبار،
        (2) توليد مخرجات خام ونتائج متوقعة يُختبر بها كود Kotlin على الحاسوب.

الاستخدام:
    python3 -I reference_pipeline.py <مجلد النماذج> <مجلد الإخراج> صورة1.jpg صورة2.jpg ...
"""
import json
import math
import os
import sys

import numpy as np
import onnxruntime as ort
from PIL import Image

BLAZE = 256
FACERES = 224
MOVENET = 256


def resize_bilinear(img, w, h):
    # PIL: نفس الاستيفاء الخطي تقريبًا الذي في TF (فروق طفيفة لا تغير الحكم)
    return np.asarray(Image.fromarray(img).resize((w, h), Image.BILINEAR), dtype=np.float32)


def anchors(size=BLAZE):
    out = []
    for stride, n in ((size // 16, 2), (size // 8, 6)):
        rows = (size + stride - 1) // stride
        for gy in range(rows):
            for gx in range(rows):
                for _ in range(n):
                    out.append((stride * (gx + 0.5), stride * (gy + 0.5)))
    return np.array(out, np.float32)


ANCHORS = anchors()


def nms(boxes, scores, max_out, iou_thr, min_score):
    order = [i for i in np.argsort(-scores, kind="stable") if scores[i] > min_score]
    keep = []
    for i in order:
        ok = True
        for j in keep:
            if iou_xyxy(boxes[i], boxes[j]) > iou_thr:
                ok = False
                break
        if ok:
            keep.append(i)
            if len(keep) >= max_out:
                break
    return keep


def iou_xyxy(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def blaze_merge(outs):
    """يرتب مخرجات blazeface الأربعة كما في Human: [512 صف ثم 384]، كل صف = 1 ثقة + 16 إحداثيات."""
    s = sorted(outs, key=lambda a: a.size)  # 384x1, 512x1, 384x16, 512x16
    c384 = np.concatenate([s[0], s[2]], 2)
    c512 = np.concatenate([s[1], s[3]], 2)
    return np.concatenate([c512, c384], 1)[0]  # [896, 17]


def blaze_decode(batch, img_w, img_h, max_faces=10, min_conf=0.3, iou=0.1, scale=1.4):
    centers = batch[:, 1:3] + ANCHORS
    sizes = batch[:, 3:5]
    starts = centers - sizes / 2
    ends = centers + sizes / 2
    boxes = np.concatenate([starts, ends], 1)
    scores = 1 / (1 + np.exp(-batch[:, 0]))
    keep = nms(boxes, scores, max_faces, iou, min_conf)
    fx, fy = img_w / BLAZE, img_h / BLAZE
    faces = []
    for i in keep:
        x1, y1, x2, y2 = boxes[i][0] * fx, boxes[i][1] * fy, boxes[i][2] * fx, boxes[i][3] * fy
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        w, h = (x2 - x1) * scale, (y2 - y1) * scale
        half = max(w, h) / 2  # تربيع الصندوق
        sq = [round(cx - half), round(cy - half), round(cx + half), round(cy + half)]
        faces.append({"score": float(scores[i]), "square": sq})
    return faces


def crop_resize(img, box, size):
    """قص منطقة (قد تتجاوز حدود الصورة، فالخارج أسود) ثم تحجيمها."""
    x1, y1, x2, y2 = box
    h, w = img.shape[:2]
    cw, ch = max(1, x2 - x1), max(1, y2 - y1)
    canvas = np.zeros((ch, cw, 3), np.uint8)
    sx1, sy1, sx2, sy2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    if sx2 > sx1 and sy2 > sy1:
        canvas[sy1 - y1:sy2 - y1, sx1 - x1:sx2 - x1] = img[sy1:sy2, sx1:sx2]
    return resize_bilinear(canvas, size, size)


def faceres_parse(gender_p, age_probs):
    conf = math.trunc(200 * abs(gender_p - 0.5)) / 100
    gender = "unknown"
    score = 0.0
    if conf > 0:
        gender = "female" if gender_p <= 0.5 else "male"
        score = min(0.99, conf)
    i = int(np.argmax(age_probs))
    lo = age_probs[i - 1] if i > 0 else 0.0
    hi = age_probs[i + 1] if i + 1 < len(age_probs) else 0.0
    age = round(10 * i - 100 * lo if lo > hi else 10 * i + 100 * hi) / 10
    return gender, score, age


def movenet_input(img):
    h, w = img.shape[:2]
    side = max(w, h)
    padx, pady = (side - w) // 2, (side - h) // 2
    canvas = np.zeros((side, side, 3), np.uint8)
    canvas[pady:pady + h, padx:padx + w] = img
    return resize_bilinear(canvas, MOVENET, MOVENET).astype(np.int32), side, padx, pady


def movenet_parse(res, side, padx, pady, w, h, min_conf=0.25, max_det=6):
    bodies = []
    for k in res[0]:
        score = round(100 * float(k[55])) / 100
        if score <= min_conf:
            continue
        pts = []
        for i in range(17):
            if k[3 * i + 2] > min_conf:
                pts.append((k[3 * i + 1] * side - padx, k[3 * i] * side - pady))
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x1, y1 = max(0, min(xs)), max(0, min(ys))
        x2, y2 = min(w, max(xs)), min(h, max(ys))
        bodies.append({"score": score, "box": [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]})
    bodies.sort(key=lambda b: -b["score"])
    return bodies[:max_det]


def main(models, out_dir, images):
    so = ort.SessionOptions()
    blaze = ort.InferenceSession(os.path.join(models, "blazeface.onnx"), so)
    fres = ort.InferenceSession(os.path.join(models, "faceres.onnx"), so)
    move = ort.InferenceSession(os.path.join(models, "movenet-multipose.onnx"), so)
    fres_out = [o.name for o in fres.get_outputs()]
    os.makedirs(out_dir, exist_ok=True)
    summary = {}
    for path in images:
        name = os.path.splitext(os.path.basename(path))[0]
        img = np.asarray(Image.open(path).convert("RGB"))
        h, w = img.shape[:2]
        x = resize_bilinear(img, BLAZE, BLAZE) / 127.5 - 1
        bouts = blaze.run(None, {blaze.get_inputs()[0].name: x[None].astype(np.float32)})
        batch = blaze_merge(bouts)
        faces = blaze_decode(batch, w, h)
        for f in faces:
            crop = crop_resize(img, f["square"], FACERES)
            r = dict(zip(fres_out, fres.run(None, {fres.get_inputs()[0].name: crop[None]})))
            gp = float(next(v for k, v in r.items() if "gender" in k).reshape(-1)[0])
            ages = next(v for k, v in r.items() if "age" in k).reshape(-1)
            f["genderP"] = gp
            f["ages"] = [float(v) for v in ages]
            f["gender"], f["genderScore"], f["age"] = faceres_parse(gp, ages)
            sx1, sy1, sx2, sy2 = f["square"]
            f["box"] = [max(0, sx1), max(0, sy1), min(w, sx2) - max(0, sx1), min(h, sy2) - max(0, sy1)]
        mi, side, px, py = movenet_input(img)
        mres = move.run(None, {move.get_inputs()[0].name: mi[None]})[0]
        bodies = movenet_parse(mres, side, px, py, w, h)
        summary[name] = {
            "faces": [[f["gender"], round(f["genderScore"], 2), f["age"]] for f in faces],
            "bodies": len(bodies),
        }
        # مخرجات خام لاختبار كود Kotlin: بلا صور، أرقام فقط
        np.asarray(batch, "<f4").tofile(os.path.join(out_dir, f"{name}.blaze.bin"))
        np.asarray(mres, "<f4").tofile(os.path.join(out_dir, f"{name}.movenet.bin"))
        json.dump({"width": w, "height": h, "side": side, "padx": px, "pady": py,
                   "faces": [{k: f[k] for k in ("score", "square")} for f in faces],
                   "faceres": [{"genderP": f["genderP"], "ages": f["ages"], "gender": f["gender"], "genderScore": f["genderScore"], "age": f["age"]} for f in faces],
                   "bodies": bodies},
                  open(os.path.join(out_dir, f"{name}.expected.json"), "w"), indent=1)
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
