"""جسر لاختبار خط كشف Kotlin بالنماذج الحقيقية على الحاسوب (بلا أندرويد).
يقرأ من stdin: اسم النموذج، ونوع المدخل، والطول، ثم البايتات؛ ويكتب المخرجات بنفس الطريقة.
"""
import os
import struct
import sys

import numpy as np
import onnxruntime as ort

models = sys.argv[1]
SHAPES = {"nudenet": (1, 3, 320, 320), "blazeface": (1, 256, 256, 3), "faceres": (1, 224, 224, 3), "movenet": (1, 256, 256, 3)}
FILES = {"nudenet": os.path.join(models, "320n.onnx"), "blazeface": os.path.join(models, "blazeface.onnx"),
         "faceres": os.path.join(models, "faceres.onnx"), "movenet": os.path.join(models, "movenet-multipose.onnx")}
sessions = {}
inp, out = sys.stdin.buffer, sys.stdout.buffer
while True:
    head = inp.read(12)
    if len(head) < 12:
        break
    mid, isint, n = struct.unpack(">iii", head)
    name = ["nudenet", "blazeface", "faceres", "movenet"][mid]
    data = np.frombuffer(inp.read(n), ">i4" if isint else ">f4").astype(np.int32 if isint else np.float32).reshape(SHAPES[name])
    s = sessions.get(name) or sessions.setdefault(name, ort.InferenceSession(FILES[name]))
    res = s.run(None, {s.get_inputs()[0].name: data})
    if name == "faceres":
        names = [o.name for o in s.get_outputs()]
        g = next(r for k, r in zip(names, res) if "gender" in k)
        a = next(r for k, r in zip(names, res) if "age" in k)
        res = [g, a]
    out.write(struct.pack(">i", len(res)))
    for r in res:
        b = np.asarray(r, ">f4").tobytes()
        out.write(struct.pack(">i", len(b)))
        out.write(b)
    out.flush()
