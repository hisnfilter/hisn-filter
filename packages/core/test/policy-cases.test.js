import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideImage, defaultSettings } from "../src/policy.js";

// الحالات المشتركة بين JS وKotlin: packages/core/data/policy-cases.json
const { cases } = JSON.parse(readFileSync(new URL("../data/policy-cases.json", import.meta.url), "utf8"));

for (const c of cases) {
    test(`سياسة مشتركة: ${c.name}`, () => {
        const settings = { ...defaultSettings(c.viewer), ...(c.settings ?? {}) };
        const r = decideImage(c.image, settings);
        assert.deepEqual({ action: r.action, reason: r.reason }, c.expect);
    });
}
