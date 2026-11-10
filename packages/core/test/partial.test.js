import { test } from "node:test";
import assert from "node:assert/strict";
import { partialImage, decideImage, defaultSettings } from "../src/index.js";

const woman = (box, o = {}) => ({ gender: "female", genderScore: 0.8, adult: true, area: box[2] * box[3], box, ...o });
const man = (box, score = 0.6) => ({ gender: "male", genderScore: score, adult: true, area: box[2] * box[3], box });
const img = (people, o = {}) => ({ analyzed: true, nudity: 0, sexual: 0, people, ...o });
const male = defaultSettings("male");

test("رجل واثق وامرأة: تُغطّى المرأة وحدها", () => {
    const r = partialImage(img([man([0.05, 0.1, 0.25, 0.8]), woman([0.6, 0.1, 0.25, 0.8])]), male);
    assert.equal(r.length, 1);
    assert.equal(r[0].reason, "woman");
    assert.ok(r[0].box[0] > 0.5);
});

test("رجل بثقة ضعيفة (قد يكون امرأة): الصورة كلها", () => {
    assert.equal(partialImage(img([man([0.05, 0.1, 0.25, 0.8], 0.2), woman([0.6, 0.1, 0.25, 0.8])]), male), null);
});

test("الأغطية تملأ أغلب الصورة: الصورة كلها", () => {
    assert.equal(partialImage(img([woman([0, 0, 0.9, 1])]), male), null);
});

test("عري أو محتوى جنسي، أو المستوى الصارم، أو الخيار مطفأ: الصورة كلها", () => {
    const people = [man([0.05, 0.1, 0.25, 0.8]), woman([0.6, 0.1, 0.25, 0.8])];
    assert.equal(partialImage(img(people, { nudity: 0.9 }), male), null);
    assert.equal(partialImage(img(people), { ...male, level: "strict" }), null);
    assert.equal(partialImage(img(people), { ...male, partialBlur: false }), null);
});

test("لا شيء يُغطّى: لا تغطية جزئية (القرار العادي يُظهرها)", () => {
    assert.equal(partialImage(img([man([0.1, 0.1, 0.3, 0.8])]), male), null);
    assert.equal(decideImage(img([man([0.1, 0.1, 0.3, 0.8])]), male).action, "show");
});

test("مستخدمة: امرأة بلباس قصير تُغطّى وحدها، والبقية تظهر", () => {
    const r = partialImage(img([woman([0.05, 0.1, 0.25, 0.8]), woman([0.6, 0.1, 0.25, 0.8], { thighSkin: 0.8 })]), defaultSettings("female"));
    assert.equal(r.length, 1);
    assert.equal(r[0].reason, "nudity");
});

test("مستخدمة: شخص ظُنّ رجلًا بثقة ضعيفة وفخذه مكشوف ← الصورة كلها (قد يكون امرأة)", () => {
    const weak = { gender: "male", genderScore: 0.1, adult: true, area: 0.2, box: [0.05, 0.1, 0.25, 0.8], thighSkin: 0.9 };
    assert.equal(partialImage(img([weak, woman([0.6, 0.1, 0.25, 0.8], { thighSkin: 0.8 })]), defaultSettings("female")), null);
});

import { mergeDuplicateBodies } from "../src/people.js";
test("جسمان متداخلان للشخص نفسه يُدمجان في واحد يشملهما", () => {
    const r = mergeDuplicateBodies([{ box: [10, 10, 40, 80], score: 0.6 }, { box: [15, 5, 40, 90], score: 0.4 }, { box: [200, 10, 40, 80], score: 0.5 }]);
    assert.equal(r.length, 2);
    assert.deepEqual(r[0].box, [10, 5, 45, 90]);
});
