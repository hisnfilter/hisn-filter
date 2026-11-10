import { test } from "node:test";
import assert from "node:assert/strict";
import { isSkin, thighExposure, THIGH_SKIN } from "../src/skin.js";

/** صورة اصطناعية: خلفية، وفخذان من الورك إلى الركبة بلون معيّن. */
function image(color, w = 200, h = 300) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([200, 205, 210, 255], i * 4); // جدار رمادي فاتح
    for (let y = 100; y < 200; y++) for (let x = 60; x < 140; x++) rgba.set([...color, 255], (y * w + x) * 4);
    return { rgba, w, h };
}
const kp = { leftHip: [80, 100, 0.9], rightHip: [120, 100, 0.9], leftKnee: [80, 200, 0.9], rightKnee: [120, 200, 0.9] };

test("ألوان البشرة الفاتحة والداكنة بشرة، والملابس الشائعة ليست بشرة", () => {
    for (const c of [[224, 172, 140], [198, 134, 100], [141, 85, 60], [95, 60, 45], [240, 195, 170]]) assert.ok(isSkin(...c), String(c));
    for (const c of [[40, 60, 120], [20, 20, 20], [230, 230, 230], [60, 110, 60], [120, 120, 125], [30, 40, 80]]) assert.ok(!isSkin(...c), String(c));
});

test("فخذ مكشوف (بشرة بين الورك والركبة) يُكتشف", () => {
    for (const skin of [[224, 172, 140], [141, 85, 60]]) {
        const { rgba, w, h } = image(skin);
        const r = thighExposure(kp, rgba, w, h);
        assert.ok(r && r.score >= THIGH_SKIN, JSON.stringify(r));
    }
});

test("بنطال جينز أو قماش داكن لا يُعدّ مكشوفًا", () => {
    for (const cloth of [[40, 60, 120], [20, 20, 20]]) {
        const { rgba, w, h } = image(cloth);
        const r = thighExposure(kp, rgba, w, h);
        assert.ok(r && r.score < THIGH_SKIN, JSON.stringify(r));
    }
});

test("نقاط غير واضحة (الركبة خارج الصورة أو ثقة ضعيفة) ← لا حكم", () => {
    const { rgba, w, h } = image([224, 172, 140]);
    assert.equal(thighExposure({ ...kp, leftKnee: [80, 200, 0.1], rightKnee: [120, 200, 0.1] }, rgba, w, h), null);
});

import { decideImage, defaultSettings, decideRegions } from "../src/index.js";

const person = (o) => ({ gender: "female", genderScore: 0.9, adult: true, area: 0.2, box: [0, 0, 50, 100], ...o });
const analyzed = (people) => ({ analyzed: true, nudity: 0, sexual: 0, people });

test("مستخدمة: امرأة بفستان قصير (فخذ مكشوف) تُغطّى، وبفستان طويل تظهر", () => {
    const s = defaultSettings("female");
    assert.deepEqual(decideImage(analyzed([person({ thighSkin: 0.8 })]), s), { action: "cover", reason: "nudity" });
    assert.equal(decideImage(analyzed([person({ thighSkin: 0.1 })]), s).action, "show");
    assert.equal(decideImage(analyzed([person({})]), s).action, "show");
});

test("الفخذ: لا يُطبّق على الأطفال ولا على الرجل المعروف", () => {
    const s = defaultSettings("female");
    assert.equal(decideImage(analyzed([person({ thighSkin: 0.9, adult: false })]), s).action, "show");
    assert.equal(decideImage(analyzed([person({ thighSkin: 0.9, gender: "male", genderScore: 0.3 })]), s).action, "show");
});

test("الفخذ في تنظيف الفيديو: تُغطّى منطقة الشخص وحده", () => {
    const r = decideRegions({ width: 100, height: 100, detections: [], people: [person({ thighSkin: 0.8 })] }, defaultSettings("female"));
    assert.equal(r.full, false);
    assert.equal(r.covers.length, 1);
    assert.equal(r.covers[0].reason, "nudity");
});

import { thighFromFace } from "../src/skin.js";

test("بلا جسم مكتشف: موضع الفخذ يُقدَّر من الوجه", () => {
    // وجه 20×20 أعلاه عند y=20 ← الفخذ تقديرًا بين 94 و126، داخل منطقة البشرة في الصورة
    const { rgba, w, h } = image([224, 172, 140]);
    assert.ok(thighFromFace([90, 20, 20, 20], rgba, w, h).score >= THIGH_SKIN);
    const jeans = image([40, 60, 120]);
    assert.ok(thighFromFace([90, 20, 20, 20], jeans.rgba, jeans.w, jeans.h).score < THIGH_SKIN);
    assert.equal(thighFromFace([90, 250, 20, 20], rgba, w, h), null); // صورة نصفية: الساقان خارجها
});

