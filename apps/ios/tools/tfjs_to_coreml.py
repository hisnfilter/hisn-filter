"""يحوّل نموذج الجنس والعمر (faceres من Human، صيغة TF.js) إلى Core ML لامتداد فحص الشاشة في آيفون.

الاستخدام:
    python3 tfjs_to_coreml.py <faceres.json> <FaceRes.mlpackage>

يعيد استخدام قارئ TF.js وفك العمليات المدمجة من أداة أندرويد (tfjs_to_onnx.py).
التحويل يعمل على أي جهاز، أما تجربة النموذج فتحتاج ماك: verify_coreml.py.
"""
import os
import sys

import coremltools as ct
import numpy as np
import tensorflow as tf

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../android/tools"))
from tfjs_to_onnx import load_graph_def, signature  # noqa: E402


def main(model_json, out_path):
    gd, m, filled, total = load_graph_def(model_json)
    print(f"أوزان: {filled}/{total}")
    ins, outs = signature(m)
    in_name = next(iter(ins))
    # نثبّت حجم الدفعة على 1 (Core ML يحتاج شكلًا ثابتًا)
    for node in gd.node:
        if node.name == in_name and "shape" in node.attr:
            node.attr["shape"].shape.dim[0].size = 1
    wanted = [o for o in outs if "gender" in o or "age" in o]
    wrapped = tf.compat.v1.wrap_function(lambda: tf.compat.v1.import_graph_def(gd, name=""), [])
    fn = wrapped.prune(feeds=in_name + ":0", fetches=[o + ":0" for o in wanted])
    mlmodel = ct.convert(
        [fn],
        source="tensorflow",
        inputs=[ct.TensorType(shape=(1, 224, 224, 3), dtype=np.float32)],
        convert_to="mlprogram",
        compute_precision=ct.precision.FLOAT16,
        minimum_deployment_target=ct.target.iOS17,
    )
    mlmodel.short_description = "FaceRes (HSE) — الجنس والعمر من صورة الوجه 224×224، القيم 0..255"
    mlmodel.save(out_path)
    print("✓", out_path, [o.name for o in mlmodel.get_spec().description.output])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
