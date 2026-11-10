import { test } from "node:test";
import assert from "node:assert/strict";
import { fusePeople, summarizeNudity } from "../src/index.js";

const W = 400, H = 400;

test("جسم بلا وجه = شخص غير معروف الجنس (امرأة من الخلف مثلًا)", () => {
    const people = fusePeople({ bodies: [{ box: [100, 50, 120, 300], score: 0.8 }], width: W, height: H });
    assert.equal(people.length, 1);
    assert.equal(people[0].gender, "unknown");
});

test("الوجه داخل الجسم يعطيه جنسه", () => {
    const people = fusePeople({
        faces: [{ box: [140, 60, 40, 40], gender: "female", genderScore: 0.8, age: 30 }],
        bodies: [{ box: [100, 50, 120, 300], score: 0.8 }],
        width: W, height: H,
    });
    assert.equal(people.length, 1);
    assert.equal(people[0].gender, "female");
    assert.equal(people[0].adult, true);
});

test("الجنس من نموذج الوجوه فقط، ووجه NudeNet وحده يعني شخصًا مجهول الجنس", () => {
    const humanMale = fusePeople({
        faces: [{ box: [140, 60, 40, 40], gender: "male", genderScore: 0.14 }],
        nnFaces: [{ box: [141, 61, 40, 40], gender: "female", score: 0.8 }],
        width: W, height: H,
    });
    assert.equal(humanMale.length, 1);
    assert.equal(humanMale[0].gender, "male");
    const nnOnly = fusePeople({ nnFaces: [{ box: [10, 10, 40, 40], gender: "female", score: 0.7 }], width: W, height: H });
    assert.equal(nnOnly[0].gender, "unknown");
});

test("المساحة لا تتجاوز 100% حتى لو توسّع صندوق الوجه خارج الصورة", () => {
    const p = fusePeople({ faces: [{ box: [0, 0, 380, 380], gender: "female", genderScore: 0.9 }], width: W, height: H });
    assert.ok(p[0].area <= 1);
});

test("الطفل يُعرف من العمر", () => {
    const p = fusePeople({ faces: [{ box: [10, 10, 40, 40], gender: "female", genderScore: 0.9, age: 8 }], width: W, height: H });
    assert.equal(p[0].adult, false);
});

test("ملخص NudeNet: العورة الصريحة، ولباس السباحة، والوجوه", () => {
    const d = (c, s) => ({ class: c, score: s, box: [0, 0, 10, 10] });
    assert.ok(summarizeNudity([d("FEMALE_GENITALIA_EXPOSED", 0.7)]).sexual >= 0.7);
    assert.ok(summarizeNudity([d("FEMALE_BREAST_EXPOSED", 0.6)]).nudity >= 0.6);
    const bikini = summarizeNudity([d("FEMALE_BREAST_COVERED", 0.6), d("BELLY_EXPOSED", 0.5)]);
    assert.ok(bikini.nudity >= 0.6, JSON.stringify(bikini));
    const clothed = summarizeNudity([d("FEMALE_BREAST_COVERED", 0.6), d("FACE_FEMALE", 0.8)]);
    assert.equal(clothed.nudity, 0);
    assert.equal(clothed.faces[0].gender, "female");
    assert.equal(summarizeNudity([d("MALE_BREAST_EXPOSED", 0.9)]).nudity, 0); // صدر الرجل ليس عورة
});
