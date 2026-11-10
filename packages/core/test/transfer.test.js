import { test } from "node:test";
import assert from "node:assert/strict";
import { exportSettings, importSettings, transferLink, childPreset, defaultSettings } from "../src/index.js";

test("الإعدادات تنتقل كما هي، أما رمز القفل فلا", () => {
    const s = { ...defaultSettings("female"), ...childPreset("under9"), pinHash: "a".repeat(64), pinSalt: "b".repeat(32), imageVerdicts: { x: "safe" } };
    const code = exportSettings(s);
    assert.ok(code.startsWith("HISN1.") && code.length < 160, code.length);
    const back = importSettings(code);
    assert.equal(back.viewer, "female");
    assert.equal(back.childMode, true);
    assert.equal(back.childAge, "under9");
    assert.equal(back.pinHash, undefined);
    assert.equal(back.imageVerdicts, undefined); // التصحيحات الشخصية لا تُنقل
    assert.deepEqual(importSettings(transferLink(s)), back); // من رابط QR
    assert.deepEqual(importSettings(`انسخ هذا: ${code} `), back); // من نص منسوخ
});

test("رمز تالف أو قيم غريبة لا تُقبل", () => {
    assert.equal(importSettings("hello"), null);
    assert.equal(importSettings("HISN1.@@@"), null);
    assert.equal(importSettings("HISN1.999.0.0"), null); // لا شيء صالح
    assert.equal(importSettings("HISN1.019.0.0").viewer, "male");
});
