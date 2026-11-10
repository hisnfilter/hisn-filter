"""يصغّر نموذج الفصل إلى ربع حجمه: أوزان الالتفاف int8 لكل قناة (DequantizeLinear)، والحساب يبقى float.
في المقياس: فرق ‎-0.1dB عن الأصل. يُحمَّل مع session.disable_quant_qdq=1 فتُفك الأوزان مرة واحدة.
    python3 quantize.py UVR-MDX-NET-Inst_HQ_4.onnx inst-hq4-w8.onnx
"""
import sys
import numpy as np
import onnx
from onnx import helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
inits = {i.name: i for i in g.initializer}
targets = set()
for n in g.node:
    if n.op_type in ("Conv", "ConvTranspose", "MatMul", "Gemm"):
        for inp in n.input:
            if inp in inits and numpy_helper.to_array(inits[inp]).ndim >= 2:
                targets.add(inp)
nodes = []
for name in sorted(targets):
    W = numpy_helper.to_array(inits[name]).astype(np.float32)
    mx = np.abs(W.reshape(W.shape[0], -1)).max(1)
    scale = (mx / 127).astype(np.float32)
    scale[scale == 0] = 1e-8
    q = np.clip(np.round(W / scale.reshape([-1] + [1] * (W.ndim - 1))), -127, 127).astype(np.int8)
    g.initializer.remove(inits[name])
    g.initializer.extend([numpy_helper.from_array(q, name + "_q"), numpy_helper.from_array(scale, name + "_s"),
                          numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), name + "_z")])
    nodes.append(helper.make_node("DequantizeLinear", [name + "_q", name + "_s", name + "_z"], [name], axis=0))
for i, nd in enumerate(nodes):
    g.node.insert(i, nd)
if m.opset_import[0].version < 13:
    m.opset_import[0].version = 13
onnx.save(m, dst)
print(f"{len(targets)} أوزان ← int8: {dst}")
