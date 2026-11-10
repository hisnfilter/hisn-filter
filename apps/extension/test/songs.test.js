import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("كتم مقاطع الأغاني: يقرأ اسم الصوت قرب الفيديو، والصوت الأصلي لا يُكتم", async () => {
    const dom = new JSDOM(`<div id="a"><div><video id="v1"></video></div><a href="/music/abc" data-e2e="video-music">Alan Walker - Faded</a></div>
        <div id="b"><div><video id="v2"></video></div><a data-e2e="video-music">original sound - user123</a></div>
        <article><video id="v3"></video><a href="/reels/audio/1">الصوت الأصلي</a></article>
        <section><div class="MusicWrapper"><video id="v4"></video><button aria-label="Toggle audio">Audio is muted</button></div><a href="/reels/audio/9">sounds1sa · Original audio</a></section>
        <section><div><video id="v5"></video><button aria-label="Toggle audio"></button><span class="musicLike">decor</span></div></section>`);
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    const { _test } = await import("../src/content/songs.js");
    const d = dom.window.document;
    const label = (id) => _test.soundLabel(d.getElementById(id));
    assert.equal(label("v1"), "Alan Walker - Faded");
    assert.equal(_test.ORIGINAL.test(label("v1")), false);
    assert.equal(_test.ORIGINAL.test(label("v2")), true);
    assert.equal(_test.ORIGINAL.test(label("v3")), true);
    // زر «Toggle audio» ليس اسم صوت: يُؤخذ رابط الصوت الحقيقي
    assert.equal(label("v4"), "sounds1sa · Original audio");
    // وسوم عامة بلا رابط صوت ولا «صوت أصلي»: لا اسم → لا كتم
    assert.equal(label("v5"), null);
    // أصوات ليست أغاني وإن حملت اسمًا: قرآن وأناشيد وأذكار
    const { isSongLabel } = _test;
    assert.equal(isSongLabel("Alan Walker - Faded"), true);
    assert.equal(isSongLabel("Mohammed Al Hisayan · Maulai (Muatherat)"), false);
    assert.equal(isSongLabel("تلاوة خاشعة · سورة الكهف"), false);
    assert.equal(isSongLabel("أنشودة يا طيبة · أبو عبد الملك"), false);
    assert.equal(isSongLabel("Surah Al Mulk · Mishary Rashid"), false);
    assert.equal(isSongLabel("أذكار الصباح"), false);
    assert.equal(isSongLabel("Rain sounds for sleep"), false);
    assert.equal(isSongLabel("احمد القويعي · وسبح بحمد ربك"), false);
    assert.equal(isSongLabel("Maher Zain · Ya Nabi Salam Alayka"), false);
    assert.equal(isSongLabel("Taylor Swift · Love Story"), true);
});
