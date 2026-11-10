// يتحقق أن نقلنا لمعالجة مخرجات NudeNet إلى JavaScript يطابق الكود الرسمي (Python) حرفيًا.
// المراجع في test/fixtures/nudenet من make_nudenet_reference.py على نفس صور الاختبار.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { postprocess, letterbox, rgbaToTensor } from "../src/index.js";

const dir = new URL("./fixtures/nudenet/", import.meta.url);
const cases = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

test("توجد مراجع للاختبار", () => assert.ok(cases.length >= 5));

for (const name of cases) {
    test(`postprocess يطابق NudeNet الرسمي: ${name}`, () => {
        const ref = JSON.parse(readFileSync(new URL(`${name}.json`, dir)));
        const buf = readFileSync(new URL(`${name}.out.bin`, dir));
        const out = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        const got = postprocess(out, ref.dims, ref.width, ref.height);
        assert.equal(got.length, ref.detections.length, JSON.stringify(got));
        got.forEach((d, i) => {
            const r = ref.detections[i];
            assert.equal(d.class, r.class);
            assert.ok(Math.abs(d.score - r.score) < 1e-5);
            assert.deepEqual(d.box, r.box);
        });
    });
}

test("التبطين يطابق الكود الأصلي (يمين وأسفل)", () => {
    assert.deepEqual(letterbox(640, 420), { side: 640, xPad: 0, yPad: 220 });
    assert.deepEqual(letterbox(300, 500), { side: 500, xPad: 200, yPad: 0 });
});

test("تحويل البكسلات إلى مدخل النموذج: RGB مقسوم على 255 بترتيب القنوات", () => {
    const rgba = new Uint8ClampedArray([255, 0, 51, 255, 0, 255, 102, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    const t = rgbaToTensor(rgba, 2);
    assert.deepEqual([...t].map((v) => +v.toFixed(2)), [1, 0, 0, 1, 0, 1, 0, 1, 0.2, 0.4, 0, 1]);
});

test("البطن المكشوف: عورة كاملة في صورة امرأة، وأخف في صورة بلا امرأة", async () => {
    const { summarizeNudity } = await import("../src/index.js");
    const belly = { class: "BELLY_EXPOSED", score: 0.68, box: [0, 0, 10, 10] };
    const face = { class: "FACE_FEMALE", score: 0.62, box: [0, 0, 5, 5] };
    assert.ok(summarizeNudity([belly, face]).nudity >= 0.6);
    assert.ok(Math.abs(summarizeNudity([belly]).nudity - 0.544) < 1e-6);
});
