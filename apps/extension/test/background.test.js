// اختبارات قواعد الشبكة والقفل، مع محاكاة بسيطة لمطابقة قواعد declarativeNetRequest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
};
const { _test } = await import("../src/background/dnr.js");
const { hashPin, verifyPin, listHasSite, siteOf } = await import("../src/shared/settings.js");

const adult = JSON.parse(readFileSync(new URL("../static/rules/adult-domains.json", import.meta.url))).domains;

// مطابقة مبسطة بنفس منطق المتصفح: requestDomains تشمل النطاقات الفرعية، و regexFilter على الرابط كاملًا
function matches(rule, url, type = "main_frame") {
    const u = new URL(url);
    const c = rule.condition;
    if (c.resourceTypes && !c.resourceTypes.includes(type)) return false;
    if (c.requestDomains) {
        const h = u.hostname;
        if (!c.requestDomains.some((d) => h === d || h.endsWith("." + d))) return false;
    }
    if (c.excludedRequestDomains?.some((d) => u.hostname === d || u.hostname.endsWith("." + d))) return false;
    if (c.regexFilter && !new RegExp(c.regexFilter).test(url)) return false;
    return true;
}
function decide(rules, url, type) {
    const hits = rules.filter((r) => matches(r, url, type)).sort((a, b) => b.priority - a.priority);
    return hits[0] ?? null;
}

const rules = [
    ..._test.redirectRules(adult, 2000, "adult"),
    ..._test.blockMediaRules(adult, 3000),
    ..._test.safeSearchRules(),
    _test.youtubeRule(),
];

test("قوائم المواقع محمّلة ومقسمة على قواعد", () => {
    assert.ok(adult.length > 40000);
    assert.ok(_test.redirectRules(adult, 2000, "adult").length < 100);
    const ids = rules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, "معرّفات القواعد يجب ألا تتكرر");
});

test("الموقع الإباحي ونطاقاته الفرعية تُحوَّل لصفحة الحجب", () => {
    const site = adult.find((d) => d.split(".").length === 2);
    for (const url of [`https://${site}/`, `http://www.${site}/video?id=1&x=2`]) {
        const r = decide(rules, url);
        assert.equal(r?.action.type, "redirect", url);
        // استبدال \\0 بالرابط كاملًا كما يفعل المتصفح
        const target = r.action.redirect.regexSubstitution.replace("\\0", url);
        assert.ok(target.startsWith("chrome-extension://abc/pages/blocked.html?r=adult&u=https://") ||
            target.startsWith("chrome-extension://abc/pages/blocked.html?r=adult&u=http://"));
    }
});

test("صور المواقع الإباحية داخل المواقع الأخرى تُحجب", () => {
    const site = adult[100];
    assert.equal(decide(rules, `https://${site}/thumb.jpg`, "image")?.action.type, "block");
});

test("المواقع العامة لا تُحجب", () => {
    for (const url of ["https://www.google.com/", "https://x.com/home", "https://www.reddit.com/", "https://www.youtube.com/", "https://ar.wikipedia.org/", "https://quran.com/"]) {
        const r = decide(rules, url);
        assert.ok(!r || r.action.type !== "redirect", `${url} ← ${JSON.stringify(r?.action)}`);
    }
});

test("البحث الآمن: قوقل وبنج وDuckDuckGo", () => {
    const g = decide(rules, "https://www.google.com/search?q=x");
    assert.deepEqual(g.action.redirect.transform.queryTransform.addOrReplaceParams[0], { key: "safe", value: "active" });
    assert.equal(decide(rules, "https://www.google.com.sa/search?q=x")?.action.type, "redirect");
    assert.equal(decide(rules, "https://www.bing.com/images/search?q=x").action.redirect.transform.queryTransform.addOrReplaceParams[0].key, "adlt");
    assert.equal(decide(rules, "https://duckduckgo.com/?q=x").action.redirect.transform.queryTransform.addOrReplaceParams[0].key, "kp");
    assert.equal(decide(rules, "https://www.google.com/maps"), null);
});

test("يوتيوب: ترويسة الوضع المقيّد", () => {
    const r = decide(rules, "https://www.youtube.com/watch?v=1");
    assert.equal(r.action.type, "modifyHeaders");
    assert.deepEqual(r.action.requestHeaders[0], { header: "YouTube-Restrict", operation: "set", value: "Moderate" });
});

test("«هذا الموقع سليم» يستثنيه من حجب المواقع فقط، والبحث الآمن ويوتيوب المقيّد باقيان", () => {
    const site = adult[5];
    const withExcept = [..._test.redirectRules(adult, 2000, "adult", [site]), ..._test.safeSearchRules(), _test.youtubeRule()];
    assert.equal(decide(withExcept, `https://${site}/`), null);
    assert.notEqual(decide(withExcept, `https://${adult[6]}/`), null); // غيره ما زال محجوبًا
    assert.equal(decide(withExcept, "https://www.youtube.com/watch?v=1").action.type, "modifyHeaders");
    assert.ok(withExcept.every((r) => r.action.type !== "allowAllRequests"));
});

test("رمز القفل: يُحفظ كبصمة، ويُتحقق منه، ولا يقبل رمزًا خاطئًا", async () => {
    const { hash, salt } = await hashPin("4826");
    assert.ok(!hash.includes("4826") && hash.length === 64);
    const s = { pinHash: hash, pinSalt: salt };
    assert.equal(await verifyPin("4826", s), true);
    assert.equal(await verifyPin("4827", s), false);
    assert.equal(await verifyPin("", s), false);
    assert.equal(await verifyPin("anything", { pinHash: null }), true);
});

test("مقارنة المواقع: www والنطاقات الفرعية", () => {
    assert.equal(siteOf("WWW.Example.com"), "example.com");
    assert.ok(listHasSite(["example.com"], "m.example.com"));
    assert.ok(!listHasSite(["example.com"], "notexample.com"));
});

test("بديل الحجب المباشر يغطي نفس المواقع بلا تحويل", () => {
    const r = _test.blockPageRules(adult, 2000);
    const site = adult.find((d) => d.split(".").length === 2);
    const hit = decide(r, `https://www.${site}/`);
    assert.equal(hit?.action.type, "block");
    assert.equal(r.length, _test.redirectRules(adult, 2000, "adult").length);
});

test("القفل: التشديد بلا رمز، والتخفيف بالرمز", async () => {
    const { onlyStrengthens } = await import("../src/background/lock.js");
    const cur = { level: "medium", blockAdultSites: true, removeMusic: false, disabledSites: ["a.com"], allowNasheedsWithoutInstruments: true };
    assert.equal(onlyStrengthens({ level: "strict" }, cur), true);
    assert.equal(onlyStrengthens({ level: "light" }, cur), false);
    assert.equal(onlyStrengthens({ removeMusic: true }, cur), true);
    assert.equal(onlyStrengthens({ blockAdultSites: false }, cur), false);
    assert.equal(onlyStrengthens({ disabledSites: [] }, cur), true);
    assert.equal(onlyStrengthens({ disabledSites: ["a.com", "b.com"] }, cur), false);
    assert.equal(onlyStrengthens({ allowNasheedsWithoutInstruments: false }, cur), true);
    assert.equal(onlyStrengthens({ viewer: "female" }, cur), false);
});

test("القفل: ثغرات المراجعة مغلقة", async () => {
    const { onlyStrengthens, validPatch, pinBackoff } = await import("../src/background/lock.js");
    const cur = {
        level: "medium", childAge: "under9",
        hiddenAccounts: [{ site: "x.com", handle: "bad" }],
        imageVerdicts: { "aaaaaaaaaaaaaaaaaaaaaaaa": "unsafe", "bbbbbbbbbbbbbbbbbbbbbbbb": "safe" },
    };
    // استبدال حساب مخفي بآخر بنفس العدد ← يحتاج الرمز
    assert.equal(onlyStrengthens({ hiddenAccounts: [{ site: "x.com", handle: "other" }] }, cur), false);
    assert.equal(onlyStrengthens({ hiddenAccounts: [{ site: "x.com", handle: "@BAD" }, { site: "x.com", handle: "new" }] }, cur), true);
    // تفريغ الأحكام يحذف «غير آمن» ← يحتاج الرمز؛ إضافة «غير آمن» مسموحة؛ إضافة «آمن» لا
    assert.equal(onlyStrengthens({ imageVerdicts: {} }, cur), false);
    assert.equal(onlyStrengthens({ imageVerdicts: { ...cur.imageVerdicts, cccccccccccccccccccccccc: "unsafe" } }, cur), true);
    assert.equal(onlyStrengthens({ imageVerdicts: { ...cur.imageVerdicts, cccccccccccccccccccccccc: "safe" } }, cur), false);
    // عمر غير معروف أو مفتاح غريب أو نوع خاطئ ← مرفوض
    assert.equal(onlyStrengthens({ childAge: "baby" }, cur), false);
    assert.equal(onlyStrengthens({ childAge: "13to15" }, cur), false);
    assert.equal(onlyStrengthens({ childAge: "under9" }, cur), true);
    assert.equal(validPatch({ pinHash: "x" }), false);
    assert.equal(validPatch({ enabled: "yes" }), false);
    assert.equal(validPatch({ level: "off" }), false);
    assert.equal(validPatch({ allowlist: ["ok.com", "<script>"] }), false);
    // تشغيل التغطية الجزئية يُظهر أكثر ← يحتاج الرمز
    assert.equal(onlyStrengthens({ partialBlur: true }, { partialBlur: false }), false);
    // محاولات الرمز: 3 مجانية ثم 30 ثانية تتضاعف حتى 15 دقيقة
    assert.equal(pinBackoff(2), 0);
    assert.equal(pinBackoff(3), 30_000);
    assert.equal(pinBackoff(4), 60_000);
    assert.equal(pinBackoff(20), 15 * 60_000);
});

test("القفل: لا تغيير بلا رمز يحوّل محجوبًا إلى مسموح (وضع الطفل مثلًا)", async () => {
    const { onlyStrengthens } = await import("../src/background/lock.js");
    const { defaultSettings, effectiveSettings, decideImage } = await import("@hisn/core");
    const man = { ...defaultSettings("male"), level: "medium", lockEnabled: true };
    const woman = { people: [{ gender: "female", genderScore: 0.9, adult: true, area: 0.2, covered: false, cartoon: false }], nudity: 0, analyzed: true };
    assert.equal(decideImage(woman, effectiveSettings(man)).action, "blur");
    // تشغيل وضع الطفل كان «حماية» بالاسم لكنه يُظهر النساء للرجل: لا بد من الرمز
    assert.equal(onlyStrengthens({ childMode: true }, man), false);
    assert.equal(onlyStrengthens({ childMode: true, childAge: "9to12" }, man), false);
    // عام: كل تغيير مسموح بلا رمز يبقي الصورة محجوبة
    const patches = [{ level: "strict" }, { childMode: true }, { childSex: "boy" }, { childMode: true, childSex: "boy", level: "strict" }, { blurAdultWomen: true }, { viewer: "male" }];
    for (const p of patches) {
        if (!onlyStrengthens(p, man)) continue;
        assert.notEqual(decideImage(woman, effectiveSettings({ ...man, ...p })).action, "show", JSON.stringify(p));
    }
    // للمرأة وضع الطفل لا يخفف شيئًا: مسموح بلا رمز
    const fem = { ...defaultSettings("female"), level: "medium" };
    assert.equal(onlyStrengthens({ childMode: true }, fem), true);
});
