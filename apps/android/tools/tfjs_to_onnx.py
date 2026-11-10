"""يحوّل نماذج TF.js (graph-model) إلى ONNX لتعمل على أندرويد وآيفون، ويتحقق أن المخرجات متطابقة.

الاستخدام:
    python3 tfjs_to_onnx.py <model.json> <out.onnx>

يحتاج: tensorflow, tf2onnx, onnxruntime, numpy (من PyPI).
"""
import json
import os
import sys

import numpy as np
import tensorflow as tf
import tf2onnx
import onnxruntime as ort
from google.protobuf import json_format

DTYPES = {"float32": np.float32, "int32": np.int32, "bool": np.bool_}


def load_graph_def(model_json):
    base = os.path.dirname(model_json)
    m = json.load(open(model_json))
    gd = json_format.ParseDict(m["modelTopology"], tf.compat.v1.GraphDef(), ignore_unknown_fields=True)
    # الأوزان: ملفات bin متتالية لكل مجموعة، بالترتيب المذكور في البيان
    weights = {}
    for group in m["weightsManifest"]:
        data = b"".join(open(os.path.join(base, p), "rb").read() for p in group["paths"])
        offset = 0
        for w in group["weights"]:
            shape = w["shape"]
            n = int(np.prod(shape)) if shape else 1
            q = w.get("quantization")
            if q and q.get("dtype") == "float16":
                arr = np.frombuffer(data, np.float16, n, offset).astype(np.float32)
                offset += n * 2
            elif q:
                raise ValueError(f"تكميم غير مدعوم: {q}")
            else:
                dt = DTYPES[w["dtype"]]
                arr = np.frombuffer(data, dt, n, offset)
                offset += n * np.dtype(dt).itemsize
            weights[w["name"]] = arr.reshape(shape)
    # نملأ عقد Const بقيمها
    filled = 0
    for node in gd.node:
        if node.op == "Const" and node.name in weights:
            node.attr["value"].tensor.CopyFrom(tf.make_tensor_proto(weights[node.name]))
            filled += 1
    return unfuse(gd), m, filled, len(weights)


FUSED_BASE = {"_FusedConv2D": "Conv2D", "FusedDepthwiseConv2dNative": "DepthwiseConv2dNative", "_FusedMatMul": "MatMul"}
BASE_ATTRS = ("T", "strides", "padding", "data_format", "dilations", "explicit_paddings", "transpose_a", "transpose_b")


def unfuse(gd):
    """محوّل TF.js يدمج الطبقات في عمليات خاصة (_FusedConv2D، FusedDepthwiseConv2dNative)
    لا يعرفها TensorFlow العادي. نفكّها إلى: التفاف + BiasAdd + دالة تنشيط، بنفس الاسم النهائي."""
    out = tf.compat.v1.GraphDef()
    out.versions.CopyFrom(gd.versions)
    out.library.CopyFrom(gd.library)
    for node in gd.node:
        if node.op not in FUSED_BASE:
            out.node.add().CopyFrom(node)
            continue
        ops = [s.decode() for s in node.attr["fused_ops"].list.s]
        x, w, *args = list(node.input)
        base = out.node.add()
        base.name = node.name + "/hisn_base"
        base.op = FUSED_BASE[node.op]
        base.input.extend([x, w])
        for k in BASE_ATTRS:
            if k in node.attr:
                base.attr[k].CopyFrom(node.attr[k])
        last = base.name
        rest = list(ops)
        if rest and rest[0] == "BiasAdd":
            b = out.node.add()
            b.name = node.name + ("/hisn_bias" if len(rest) > 1 else "")
            b.op = "BiasAdd"
            b.input.extend([last, args[0]])
            b.attr["T"].CopyFrom(node.attr["T"])
            if "data_format" in node.attr and node.op != "_FusedMatMul":
                b.attr["data_format"].CopyFrom(node.attr["data_format"])
            last = b.name
            rest = rest[1:]
        if rest:
            act = rest[0]
            if act not in ("Relu", "Relu6", "Elu", "Sigmoid", "Tanh"):
                raise ValueError(f"دالة تنشيط غير مدعومة: {act}")
            a = out.node.add()
            a.name = node.name
            a.op = act
            a.input.append(last)
            a.attr["T"].CopyFrom(node.attr["T"])
            last = a.name
        if last != node.name:
            # لا تنشيط ولا انحياز: نعيد تسمية العقدة الأساسية
            out.node[-1].name = node.name
    return out


def signature(m):
    sig = m.get("signature") or m.get("userDefinedMetadata", {}).get("signature")
    ins = {v["name"].split(":")[0]: v for v in sig["inputs"].values()}
    outs = [v["name"].split(":")[0] for v in sig["outputs"].values()]
    return ins, outs


def main(model_json, out_path):
    gd, m, filled, total = load_graph_def(model_json)
    print(f"أوزان: {filled}/{total}")
    ins, outs = signature(m)
    in_names = [n + ":0" for n in ins]
    out_names = [n + ":0" for n in outs]
    model_proto, _ = tf2onnx.convert.from_graph_def(gd, input_names=in_names, output_names=out_names, opset=17)
    open(out_path, "wb").write(model_proto.SerializeToString())

    # التحقق: نفس المدخل العشوائي في TensorFlow و ONNX
    rng = np.random.default_rng(0)
    feeds = {}
    for name, spec in ins.items():
        dims = [max(1, int(d["size"])) for d in spec["tensorShape"]["dim"]]
        if spec["dtype"] == "DT_INT32":
            feeds[name + ":0"] = rng.integers(0, 255, dims).astype(np.int32)
        else:
            feeds[name + ":0"] = rng.random(dims, dtype=np.float32)
    graph = tf.Graph()
    with graph.as_default():
        tf.import_graph_def(gd, name="")
    with tf.compat.v1.Session(graph=graph) as sess:
        tf_out = sess.run(out_names, feed_dict=feeds)
    sess2 = ort.InferenceSession(out_path)
    onnx_out = sess2.run(None, {i.name: feeds[i.name] for i in sess2.get_inputs()})
    by_name = dict(zip([o.name for o in sess2.get_outputs()], onnx_out))
    worst = 0.0
    for name, ref in zip(out_names, tf_out):
        got = by_name[name]
        diff = float(np.max(np.abs(np.asarray(got, np.float64) - np.asarray(ref, np.float64)))) if np.size(ref) else 0.0
        worst = max(worst, diff)
        print(f"  {name} {list(np.shape(ref))} أقصى فرق = {diff:.2e}")
    print(f"✓ {out_path} ({os.path.getsize(out_path) // 1024} KB) — أقصى فرق {worst:.2e}")
    return worst


if __name__ == "__main__":
    w = main(sys.argv[1], sys.argv[2])
    sys.exit(0 if w < 1e-3 else 1)
