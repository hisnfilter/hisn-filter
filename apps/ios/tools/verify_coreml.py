"""على الماك فقط: يتحقق أن FaceRes.mlpackage يعطي نفس نتيجة نموذج ONNX (أندرويد) على مدخل عشوائي.
    python3 verify_coreml.py ../Models/FaceRes.mlpackage ../../android/models/faceres.onnx
"""
import sys

import coremltools as ct
import numpy as np
import onnxruntime as ort

ml = ct.models.MLModel(sys.argv[1])
ox = ort.InferenceSession(sys.argv[2])
x = (np.random.default_rng(0).random((1, 224, 224, 3), dtype=np.float32) * 255).astype(np.float32)
a = ml.predict({ml.get_spec().description.input[0].name: x})
b = dict(zip([o.name for o in ox.get_outputs()], ox.run(None, {ox.get_inputs()[0].name: x})))
g1 = float(np.ravel(a["gender_pred_Sigmoid"])[0])
g2 = float(np.ravel(next(v for k, v in b.items() if "gender" in k))[0])
print(f"الجنس: CoreML={g1:.4f} ONNX={g2:.4f} فرق={abs(g1 - g2):.4f}")
sys.exit(0 if abs(g1 - g2) < 0.02 else 1)
