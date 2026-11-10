"""يولّد مراجع من كود NudeNet الرسمي (Python) لاختبار نقلنا إلى JavaScript.
التشغيل: python3 make_nudenet_reference.py <مجلد حزمة nudenet> <مجلد الصور> <مجلد الإخراج>
"""
import sys, json, os
sys.path.insert(0, sys.argv[1])
import numpy as np
from nudenet import nudenet as nn

det = nn.NudeDetector()
out_dir = sys.argv[3]
for name in sorted(os.listdir(sys.argv[2])):
    if not name.endswith(".jpg"):
        continue
    path = os.path.join(sys.argv[2], name)
    blob, xr, yr, xp, yp, w, h = nn._read_image(path, 320)
    raw = det.onnx_session.run(None, {det.input_name: blob})
    dets = nn._postprocess(raw, xp, yp, xr, yr, w, h, 320, 320)
    stem = name[:-4]
    raw[0].astype(np.float32).tofile(os.path.join(out_dir, stem + ".out.bin"))
    json.dump({"width": w, "height": h, "dims": list(raw[0].shape), "detections": [
        {"class": d["class"], "score": d["score"], "box": d["box"]} for d in dets]},
        open(os.path.join(out_dir, stem + ".json"), "w"))
    print(stem, [(d["class"], round(d["score"], 2)) for d in dets])
