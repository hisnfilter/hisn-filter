import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextFilter, normalize } from "../src/index.js";

const lexicon = JSON.parse(readFileSync(new URL("../data/lexicon.json", import.meta.url)));
const f = new TextFilter(lexicon);
const flagged = (t) => f.findProfanity(t).length > 0;

test("التطبيع: التشكيل والتطويل وأشكال الألف والتاء المربوطة", () => {
    assert.equal(normalize("شَرْمُوطَةٌ").text, "شرموطه");
    assert.equal(normalize("شـــرمـوطة").text, "شرموطه");
    assert.equal(normalize("أحمد إبراهيم آمنة ٱلله").text, "احمد ابراهيم امنه الله");
    assert.equal(normalize("مكتبة على").text, "مكتبه علي");
});

test("التطبيع: المحارف الخفية والتكرار", () => {
    assert.equal(normalize("ش​ر‌م").text, "شرم");
    assert.equal(normalize("كلممممة").text, "كلمه");
    assert.equal(normalize("مملكة").text, "مملكه"); // حرفان متتاليان يبقيان
    assert.equal(normalize("FUUUCK").text, "fuck");
});

test("التطبيع: الخريطة تشير إلى الموضع الصحيح في النص الأصلي", () => {
    const src = "يا شَرْمُوطَة";
    const n = normalize(src);
    const idx = n.text.indexOf("شرموطه");
    assert.equal(src.slice(n.map[idx], n.map[idx + 5] + 1), "شَرْمُوطَة");
});

test("يكشف الألفاظ العربية بأشكالها", () => {
    for (const t of [
        "يا شرموطة",
        "والشرموطه",
        "شَرْمُوطَة",
        "شـرمـوطـة",
        "ابن القحبة",
        "كس امك",
        "كسمك يا",
        "يا منيوك",
        "متناكة",
        "يا معرص",
        "شرموطات",
        "ش ر م و ط ة",
        "ق.ح.ب.ة",
    ]) {
        assert.ok(flagged(t), `لم يُكتشف: ${t}`);
    }
});

test("يكشف الفرانكو والإنجليزية والتحايل بالأرقام", () => {
    for (const t of [
        "ya sharmoota",
        "a7a ya",
        "kosomak",
        "kos omak",
        "what the fuck",
        "FUCKING hell",
        "sh1t",
        "b1tch",
        "f u c k you",
        "fuuuuck",
    ]) {
        assert.ok(flagged(t), `لم يُكتشف: ${t}`);
    }
});

test("لا يحجب كلمات سليمة تشبه الألفاظ", () => {
    for (const t of [
        "كسر الزجاج",
        "الكساء الأبيض",
        "مكسرات",
        "زبدة الفول",
        "زبيب",
        "نيكول كيدمان",
        "نيجيريا والنيجر",
        "عرصات يوم القيامة",
        "وكل شيء فعلوه في الزبر",
        "قصة قوم لوط في القرآن",
        "باب الطهارة: أحكام الجماع والغسل",
        "تكسير الحجارة",
        "class assistant analysis",
        "Scunthorpe United",
        "a cocktail party",
        "Dickens wrote novels",
        "the therapist said",
        "shiitake mushrooms",
        "kosher food",
        "nikon camera",
    ]) {
        assert.ok(!flagged(t), `حُجب بالخطأ: ${t} ← ${JSON.stringify(f.findProfanity(t))}`);
    }
});

test("الإخفاء يحافظ على طول النص والمسافات", () => {
    const src = "قال له يا شَرْمُوطَة ثم ذهب";
    const out = f.censor(src);
    assert.equal(out.length, src.length);
    assert.ok(out.startsWith("قال له يا "));
    assert.ok(out.endsWith(" ثم ذهب"));
    assert.ok(!out.includes("شَرْمُوطَة"));
    assert.equal(f.censor("نص نظيف تمامًا"), "نص نظيف تمامًا");
});

test("كشف الفقرات الإباحية دون طيّ النصوص الطبية والفقهية", () => {
    const story =
        "خلعت ملابسها ببطء واقتربت منه، وظهر صدرها العاري، فاشتعلت شهوته وضاجعها على سريرها وتأوهت من لذتها";
    const medical =
        "يُنصح بفحص الثدي شهريًا للكشف المبكر عن الأورام، ويُفضّل استشارة الطبيب عند ملاحظة أي تغير.";
    const fiqh = "باب الطهارة: يجب الغسل من الجماع، ويُسن الوضوء قبل النوم.";
    const news = "عرضت القناة فيلمًا وثائقيًا عن حياة الأسود في أفريقيا.";
    assert.ok(f.isExplicit(story, "medium"), JSON.stringify(f.explicitScore(story)));
    assert.ok(!f.isExplicit(medical, "medium"), JSON.stringify(f.explicitScore(medical)));
    assert.ok(!f.isExplicit(fiqh, "strict"), JSON.stringify(f.explicitScore(fiqh)));
    assert.ok(!f.isExplicit(news, "strict"));
    const en = "She undressed slowly, he caressed her naked body and she moaned, aroused, until climax.";
    assert.ok(f.isExplicit(en, "medium"), JSON.stringify(f.explicitScore(en)));
    assert.ok(!f.isExplicit("Breast cancer screening saves lives; see your doctor.", "medium"));
});

const cases = JSON.parse(readFileSync(new URL("./fixtures/text-cases.json", import.meta.url)));
test("الحالات المشتركة: كل الألفاظ في اللهجات والتحايل تُكشف", () => {
    const missed = cases.profane.filter((t) => !flagged(t));
    assert.deepEqual(missed, []);
});
test("الحالات المشتركة: كلمات من القرآن والحديث وكلمات سليمة لا تُكشف", () => {
    const wrong = cases.clean.filter((t) => flagged(t));
    assert.deepEqual(wrong, []);
});

test("الشتائم العامة: تُخفى في وضع الطفل فقط، والكلمات العادية تبقى", () => {
    const f = new TextFilter(lexicon);
    const s = "والله إنك حمار وما تفهم، يا كلب يا حيوان، ابن الكلب سرق جوالي، you idiot";
    assert.equal(f.censor(s), s); // افتراضيًا لا تُمس
    f.setInsults(true);
    const out = f.censor(s);
    for (const w of ["حمار", "كلب", "حيوان", "idiot"]) assert.ok(!out.includes(w), out);
    // كلمات عادية بلا خطاب شتم
    for (const ok of ["ركبنا الحمار في المزرعة", "عندي كلب صغير اسمه لولو", "حديقة الحيوان جميلة", "الكلب يحرس البيت"]) assert.equal(f.censor(ok), ok);
});
