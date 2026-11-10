import { test } from "node:test";
import assert from "node:assert/strict";
import { unrotateBox, rotatePoint, displaySize } from "../src/cleaner/geometry.js";

const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} != ${b}`));

test("مربع الصورة المعروضة يعود إلى نفس الموضع في الإطار المخزَّن لكل زاوية", () => {
    const stored = [0.1, 0.2, 0.3, 0.15];
    for (const rot of [0, 90, 180, 270]) {
        // ندير أركان المربع المخزَّن إلى العرض، ثم نعيده
        const pts = [[stored[0], stored[1]], [stored[0] + stored[2], stored[1] + stored[3]]].map((p) => rotatePoint(p, rot));
        const X = Math.min(pts[0][0], pts[1][0]), Y = Math.min(pts[0][1], pts[1][1]);
        const W = Math.abs(pts[0][0] - pts[1][0]), H = Math.abs(pts[0][1] - pts[1][1]);
        close(unrotateBox([X, Y, W, H], rot), stored);
    }
});

test("أبعاد العرض تتبادل عند 90 و270", () => {
    assert.deepEqual(displaySize(1920, 1080, 90), [1080, 1920]);
    assert.deepEqual(displaySize(1920, 1080, 180), [1920, 1080]);
});

// ===== أمان الكتم: لا فيديو صامت من فيديو فيه كلام =====
import { guardMutes } from "../src/cleaner/audio.js";
import { hearsSinging } from "@hisn/core";

test("كلام منغّم (رسوم متحركة) ظُنّ غناءً في معظم المقطع: لا يُكتم، ويبقى حذف الموسيقى", () => {
    const n = 20;
    const speechy = Array(n).fill(true), sung = Array(n).fill(false);
    const singer = Array(n).fill(true), leftover = Array(n).fill(false);
    const r = guardMutes(leftover, singer, speechy, sung);
    assert.equal(r.guarded, true);
    assert.equal(r.leftover.filter(Boolean).length, 0);
});

test("أغنية حقيقية: نوافذ الغناء تُكتم وحدها", () => {
    const n = 20;
    const sung = Array.from({ length: n }, (_, w) => w >= 4 && w < 16);
    const speechy = sung.slice(); // الغناء يُسمع «كلامًا» أيضًا
    const singer = sung.slice(), leftover = Array.from({ length: n }, (_, w) => w < 4);
    const r = guardMutes(leftover, singer, speechy, sung);
    assert.equal(r.guarded, false);
    assert.equal(r.leftover.filter(Boolean).length, 16);
});

test("hearsSinging: الكلام فوق الموسيقى ليس غناءً، والغناء غناء", () => {
    assert.equal(hearsSinging({ speech: 0.8, vocal: 0.2 }), false);
    assert.equal(hearsSinging({ speech: 0.3, vocal: 0.5 }), true);
    assert.equal(hearsSinging({ speech: 0.1, vocal: 0.05 }), true); // موسيقى بلا كلام واضح: لا نمنع
});
