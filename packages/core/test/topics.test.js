import { test } from "node:test";
import assert from "node:assert/strict";
import { scaryTopic, kidsTopic, customTopic, childPreset } from "../src/index.js";

const hit = (s) => scaryTopic(s).hit;

test("عناوين سحر وجن ورعب وهالوين تُكشف (عربي وإنجليزي)", () => {
    for (const s of [
        "قصة رعب حقيقية في بيت مسكون 😱", "تعلم السحر الأسود في 5 دقائق", "تحدي استحضار الأرواح الساعة 3",
        "حفلة الهالوين 🎃 أزياء مخيفة", "قصص جن واقعية", "لعبة تشارلي الحقيقية", "حظك اليوم مع الأبراج اليومية",
        "أقوى مشعوذ في العالم", "زومبي يهاجم المدينة", "Top 10 SCARY videos you shouldn't watch at night",
        "Roblox DOORS full walkthrough", "Poppy Playtime chapter 3", "Halloween costume ideas", "Ouija board gone wrong",
        "FNAF movie", "witchcraft for beginners", "وبالرعب الحقيقي", "مصاص الدماء الأخير - فيلم كامل",
    ]) assert.ok(hit(s), s);
});

test("محتوى سليم لا يُحجب: القرآن، الرقية، الأسماء، الأوصاف العادية", () => {
    for (const s of [
        "سورة الجن كاملة بصوت جميل", "الرقية الشرعية من القرآن الكريم", "أذكار التحصين من الشيطان",
        "سحر الطبيعة في الريف", "أغنية سحر", "جني الثمار في المزرعة", "عيون ساحرة", "تعلم الرسم للأطفال",
        "Minecraft house tutorial", "How to make pancakes", "Spelling bee practice", "Magic tricks for kids", "بلال يتعلم الحروف",
    ]) assert.ok(!hit(s), s);
});

test("الرقية مع رعب صريح تُحجب", () => {
    assert.ok(hit("رقية شرعية | قصة رعب مع الجن في بيت مسكون"));
});

test("وضع الطفل: الأصغر يأخذ الوضع المقيّد الشديد", () => {
    assert.equal(childPreset("under9").youtubeStrict, true);
    assert.equal(childPreset("13to15").youtubeStrict, false);
    assert.equal(childPreset("x").childAge, "9to12");
    assert.equal(childPreset().blockScaryTopics, true);
});

test("وضع الطفل في المتوسط مثل وضع المرأة: المحتشمة تظهر، والعورة تُغطّى، والصارم حسب الطفل", async () => {
    const { decideImage, defaultSettings } = await import("../src/policy.js");
    const { childPreset } = await import("../src/topics.js");
    const s = { ...defaultSettings("male"), ...childPreset("9to12") };
    const woman = { analyzed: true, nudity: 0, sexual: 0, people: [{ gender: "female", genderScore: 0.9, adult: true, area: 0.3 }] };
    assert.equal(decideImage(woman, s).action, "show");
    assert.equal(decideImage({ ...woman, nudity: 0.9 }, s).action, "cover");
    // الصارم حسب الطفل: الولد تُغطّى عنه المرأة، والبنت تظهر لها المحتشمة؛ والرجل يظهر للاثنين
    assert.equal(decideImage(woman, { ...s, level: "strict", childSex: "boy" }).action, "blur");
    assert.equal(decideImage(woman, { ...s, level: "strict", childSex: "girl" }).action, "show");
    const man = { analyzed: true, nudity: 0, sexual: 0, people: [{ gender: "male", genderScore: 0.5, adult: true, area: 0.3 }] };
    assert.equal(decideImage(man, { ...s, level: "strict", childSex: "boy" }).action, "show");
});

test("العناوين الإيحائية تُعرف، والعادية لا", async () => {
    const { suggestiveTopic } = await import("../src/topics.js");
    for (const t of ["How to quit gooning forever in 5 mins.", "Summer BIKINI try-on haul", "ملابس داخلية جديدة", "رقص شرقي مثير", "NSFW compilation 18+"]) assert.equal(suggestiveTopic(t).hit, true, t);
    for (const t of ["Ted Brutally Roasts The Mean Girl At School", "طبخ كبسة دجاج", "Peppa Pig", "Minecraft goonies map", "Sadie Sink Feels the Fit"]) assert.equal(suggestiveTopic(t).hit, false, t);
});

test("kidsTopic: ما لا يناسب الصغار يُلتقط، والعادي لا", () => {
    for (const t of ["Gacha Life Heat compilation", "18+ cartoon", "كرتون للكبار", "Elsa and Spiderman bad baby", "Poppy Playtime chapter 3", "تحدي التدخين"]) assert.equal(kidsTopic(t).hit, true, t);
    for (const t of ["Candy Crush level 5", "تعلم الحروف مع سبيستون", "Paper cutting craft", "Peppa Pig full episodes", "سورة البقرة كاملة"]) assert.equal(kidsTopic(t).hit, false, t);
});

test("customTopic: كلمات ولي الأمر — اشتقاق عربي، عبارة، إنجليزية كلمة كاملة", () => {
    const w = ["مرعب", "gacha", "الموت يطارد"];
    for (const t of ["فيلم مرعب جدا", "والمرعبة قصة", "Gacha club episode", "الموت يطارد العيلة"]) assert.equal(customTopic(t, w).hit, true, t);
    for (const t of ["مرعى الأغنام", "تلاوة خاشعة", "gachapon machine"]) assert.equal(customTopic(t, w).hit, false, t);
    assert.equal(customTopic("أي شيء", []).hit, false);
});

import { songHint } from "../src/topics.js";
test("songHint: أغنية من العنوان أو الكلمات المفتاحية، لا الإنشاد والقرآن", () => {
    assert.equal(songHint({ title: "Shakira - Dai Dai (Official Music Video)" }).hit, true);
    assert.equal(songHint({ title: "أغنية جديدة 2026 - كليب" }).hit, true);
    assert.equal(songHint({ title: "Aap Ka Aana (8K Video Song)" }).hit, true);
    assert.equal(songHint({ title: "Big, Medium and Small Plate Challenge | Kitchen Hacks" }).hit, false);
    assert.equal(songHint({ title: "أنشودة طلع البدر علينا بدون موسيقى" }).hit, false);
    assert.equal(songHint({ title: "سورة البقرة كاملة - تلاوة خاشعة" }).hit, false);
    assert.equal(songHint({ title: "حكم الأغاني في الإسلام - محاضرة" }).hit, false);
    assert.equal(songHint({ title: "Random vlog", keywords: ["music", "song", "pop"] }).hit, true);
    assert.equal(songHint({ title: "Random vlog", author: "XYZ Records", keywords: ["music"] }).hit, true);
    assert.equal(songHint({ title: "Random vlog", author: "XYZ Records" }).hit, false);
});
