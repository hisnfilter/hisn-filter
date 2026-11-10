// نفس حالات PolicyTest.kt (قرار الشاشة) حتى يتطابق تنظيف الفيديو مع شاشة أندرويد.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRegions, defaultSettings } from "../src/index.js";

const woman = { gender: "female", genderScore: 0.9, adult: true };
const man = { gender: "male", genderScore: 0.9, adult: true };
const frame = (people, detections = []) => ({ width: 540, height: 1200, people, detections });
const inside = (b, x, y) => x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3];

test("المناطق: المرأة وحدها تُغطّى للرجل، ولا شيء للمرأة", () => {
    const w = { ...woman, box: [10, 100, 200, 300], area: 0.09 };
    const m = { ...man, box: [300, 100, 200, 300], area: 0.09 };
    const v = decideRegions(frame([w, m]), defaultSettings("male"));
    assert.equal(v.covers.length, 1);
    assert.ok(inside(v.covers[0].box, 110, 250) && !inside(v.covers[0].box, 400, 250));
    assert.equal(v.full, false);
    assert.equal(decideRegions(frame([w, m]), defaultSettings("female")).covers.length, 0);
});

test("المناطق: صورة مصغرة صغيرة تُغطّى أيضًا", () => {
    const w = { ...woman, box: [10, 10, 60, 60], area: 3600 / (540 * 1200) };
    assert.equal(decideRegions(frame([w]), defaultSettings("male")).covers.length, 1);
});

test("المناطق: المحتوى الجنسي يغطي الإطار كله، واللباس الفاضح يُغطّى للمرأة", () => {
    const sx = { class: "FEMALE_GENITALIA_EXPOSED", score: 0.8, box: [100, 500, 50, 50] };
    const v = decideRegions(frame([], [sx]), defaultSettings("female"));
    assert.ok(v.full);
    const belly = { class: "BELLY_EXPOSED", score: 0.5, box: [100, 500, 50, 50] };
    const bra = { class: "FEMALE_BREAST_COVERED", score: 0.6, box: [100, 430, 60, 50] };
    const v2 = decideRegions(frame([], [belly, bra]), defaultSettings("female"));
    assert.equal(v2.full, false);
    assert.equal(v2.covers.length, 1);
});
