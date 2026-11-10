import { readFileSync, writeFileSync } from "node:fs";
const pkg = process.argv[2];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => String(u).startsWith("file:") ? new Response(readFileSync(new URL(u)), { headers: { "content-type": "application/wasm" } }) : realFetch(u);
const { DeepFilter } = await import(pkg + "/dist/index.js");
for (const f of process.argv.slice(3)) {
  const df = await DeepFilter.create({ wasmUrl: "file://" + pkg + "/dist/df_bg.wasm", attenuationLimit: 100 });
  const buf = readFileSync(f);
  const x = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const n = df.frameLength, out = new Float32Array(x.length);
  const t0 = performance.now();
  for (let i = 0; i + n <= x.length; i += n) out.set(df.process(x.subarray(i, i + n)), i);
  const ms = performance.now() - t0;
  writeFileSync(f.replace(".f32", ".dfn.f32"), Buffer.from(out.buffer));
  console.log(f.split("/").pop(), "frame", n, "RTF", (ms / 1000 / (x.length / 48000)).toFixed(3));
  df.destroy();
}
