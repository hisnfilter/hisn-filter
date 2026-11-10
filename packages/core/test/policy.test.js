import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, decideImage, canReveal } from "../src/index.js";

const woman = { gender: "female", genderScore: 0.9, adult: true, area: 0.2 };
const man = { gender: "male", genderScore: 0.9, adult: true, area: 0.2 };
const girl = { gender: "female", genderScore: 0.9, adult: false, area: 0.2 };
const niqabi = { ...woman, covered: true };
const img = (people, extra = {}) => ({ analyzed: true, nudity: 0, sexual: 0, people, ...extra });

test("الشك يُحجب: ما لم يُفحص يبقى مضبّبًا", () => {
    assert.equal(decideImage({ analyzed: false }, defaultSettings("female")).action, "blur");
    assert.equal(decideImage(null, defaultSettings("male")).action, "blur");
});

test("العورة تُحجب للجميع في كل المستويات", () => {
    for (const viewer of ["male", "female"]) {
        for (const level of ["light", "medium", "strict"]) {
            const s = { ...defaultSettings(viewer), level };
            assert.equal(decideImage(img([], { nudity: 0.9 }), s).action, "cover");
            assert.equal(decideImage(img([], { sexual: 0.9 }), s).action, "cover");
        }
    }
});

test("المستخدم الرجل: تُضبَّب النساء، ولا تُضبَّب الطفلات ولا الرجال", () => {
    const s = defaultSettings("male");
    assert.equal(decideImage(img([woman]), s).action, "blur");
    assert.equal(decideImage(img([girl]), s).action, "show");
    assert.equal(decideImage(img([man]), s).action, "show");
});

test("المستخدمة المرأة: تظهر النساء، والعورة وحدها تُحجب", () => {
    const s = defaultSettings("female");
    assert.equal(decideImage(img([woman]), s).action, "show");
    assert.equal(decideImage(img([man]), s).action, "show");
    assert.equal(decideImage(img([woman], { nudity: 0.8 }), s).action, "cover");
});

test("المنقبة: تظهر في المتوسط وتُضبَّب في الصارم للرجل", () => {
    const s = defaultSettings("male");
    assert.equal(decideImage(img([niqabi]), s).action, "show");
    assert.equal(decideImage(img([niqabi]), { ...s, level: "strict" }).action, "blur");
});

test("المستوى المخفف لا يضبّب النساء، والصارم لا يغطّي الرجال ويغطّي صورة المرأة كاملة", () => {
    const s = defaultSettings("male");
    assert.equal(decideImage(img([woman]), { ...s, level: "light" }).action, "show");
    assert.equal(decideImage(img([man]), { ...s, level: "strict" }).action, "show");
    assert.equal(decideImage(img([woman]), { ...s, level: "strict" }).action, "blur");
});

test("رجل بثقة منخفضة (0.14) يبقى رجلًا، وامرأة بثقة منخفضة تبقى امرأة", () => {
    const s = defaultSettings("male");
    assert.equal(decideImage(img([{ ...man, genderScore: 0.14 }]), s).action, "show");
    assert.equal(decideImage(img([{ ...woman, genderScore: 0.04 }]), s).action, "blur");
});

test("جنس غير مؤكد يُحجب للرجل في المتوسط", () => {
    const unsure = { gender: "unknown", genderScore: 0.3, adult: true, area: 0.2 };
    assert.equal(decideImage(img([unsure]), defaultSettings("male")).action, "blur");
    assert.equal(decideImage(img([unsure]), defaultSettings("female")).action, "show");
});

test("القفل: العورة لا تُكشف أبدًا مع القفل", () => {
    const locked = { ...defaultSettings("male"), lockEnabled: true };
    assert.equal(canReveal("nudity", locked), "never");
    assert.equal(canReveal("woman", locked), "pin");
    assert.equal(canReveal("woman", defaultSettings("male")), "tap");
});

// ===== نموذج المشهد (فهم الصورة كاملة) =====
test("المشهد: امرأة لم تكتشفها نماذج الوجوه (من الخلف، ساقان) تُغطّى للرجل، وتظهر للمرأة", () => {
    const d = { analyzed: true, nudity: 0, sexual: 0, people: [], scene: { woman: 0.95, sexual: 0.05 } };
    assert.equal(decideImage(d, { ...defaultSettings("male"), level: "medium" }).action, "blur");
    assert.equal(decideImage(d, { ...defaultSettings("female"), level: "medium" }).action, "show");
    assert.equal(decideImage(d, { ...defaultSettings("male"), level: "light" }).action, "show");
});

test("المشهد: صورة إيحائية (قبلة، رسم إيحائي) تُغطّى للرجل والمرأة", () => {
    const d = { analyzed: true, nudity: 0, sexual: 0, people: [], scene: { woman: 0.95, sexual: 0.93 } };
    assert.equal(decideImage(d, { ...defaultSettings("male"), level: "medium" }).action, "blur");
    assert.equal(decideImage(d, { ...defaultSettings("female"), level: "medium" }).action, "blur");
});

test("المشهد: رجال ومناظر لا تتأثر", () => {
    const d = { analyzed: true, nudity: 0, sexual: 0, people: [], scene: { woman: 0.01, sexual: 0.0 } };
    assert.equal(decideImage(d, { ...defaultSettings("male"), level: "strict" }).action, "show");
});
