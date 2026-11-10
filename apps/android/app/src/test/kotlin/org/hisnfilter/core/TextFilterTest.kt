package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** نفس حالات packages/core/test/textFilter.test.js — حتى يتطابق سلوك الإضافة والتطبيق. */
class TextFilterTest {
    private val f = TextFilter(TestFiles.lexicon)
    private fun flagged(t: String) = f.findProfanity(t).isNotEmpty()

    @Test
    fun normalizeDiacriticsAndLetters() {
        assertEquals("شرموطه", Normalize.normalize("شَرْمُوطَةٌ").text)
        assertEquals("شرموطه", Normalize.normalize("شـــرمـوطة").text)
        assertEquals("احمد ابراهيم امنه الله", Normalize.normalize("أحمد إبراهيم آمنة ٱلله").text)
        assertEquals("مكتبه علي", Normalize.normalize("مكتبة على").text)
    }

    @Test
    fun normalizeInvisibleAndRepeats() {
        assertEquals("شرم", Normalize.normalize("ش​ر‌م").text)
        assertEquals("كلمه", Normalize.normalize("كلممممة").text)
        assertEquals("مملكه", Normalize.normalize("مملكة").text)
        assertEquals("fuck", Normalize.normalize("FUUUCK").text)
        assertEquals("123", Normalize.normalize("١٢٣").text)
    }

    @Test
    fun normalizeMapPointsToOriginal() {
        val src = "يا شَرْمُوطَة"
        val n = Normalize.normalize(src)
        val idx = n.text.indexOf("شرموطه")
        assertEquals("شَرْمُوطَة", src.substring(n.map[idx], n.map[idx + 5] + 1))
    }

    @Test
    fun detectsArabic() {
        for (t in listOf("يا شرموطة", "والشرموطه", "شَرْمُوطَة", "شـرمـوطـة", "ابن القحبة", "كس امك", "كسمك يا",
            "يا منيوك", "متناكة", "يا معرص", "شرموطات", "ش ر م و ط ة", "ق.ح.ب.ة")) {
            assertTrue("لم يُكتشف: $t", flagged(t))
        }
    }

    @Test
    fun detectsFrancoEnglishLeet() {
        for (t in listOf("ya sharmoota", "a7a ya", "kosomak", "kos omak", "what the fuck", "FUCKING hell",
            "sh1t", "b1tch", "f u c k you", "fuuuuck")) {
            assertTrue("لم يُكتشف: $t", flagged(t))
        }
    }

    @Test
    fun noFalsePositives() {
        for (t in listOf("كسر الزجاج", "الكساء الأبيض", "مكسرات", "زبدة الفول", "زبيب", "نيكول كيدمان", "نيجيريا والنيجر",
            "عرصات يوم القيامة", "وكل شيء فعلوه في الزبر", "قصة قوم لوط في القرآن", "باب الطهارة: أحكام الجماع والغسل",
            "تكسير الحجارة", "class assistant analysis", "Scunthorpe United", "a cocktail party", "Dickens wrote novels",
            "the therapist said", "shiitake mushrooms", "kosher food", "nikon camera")) {
            assertFalse("حُجب بالخطأ: $t ← ${f.findProfanity(t)}", flagged(t))
        }
    }

    @Test
    fun censorKeepsLengthAndSpaces() {
        val src = "قال له يا شَرْمُوطَة ثم ذهب"
        val out = f.censor(src)
        assertEquals(src.length, out.length)
        assertTrue(out.startsWith("قال له يا "))
        assertTrue(out.endsWith(" ثم ذهب"))
        assertFalse(out.contains("شَرْمُوطَة"))
        assertEquals("نص نظيف تمامًا", f.censor("نص نظيف تمامًا"))
    }

    @Test
    fun explicitParagraphs() {
        val story = "خلعت ملابسها ببطء واقتربت منه، وظهر صدرها العاري، فاشتعلت شهوته وضاجعها على سريرها وتأوهت من لذتها"
        val medical = "يُنصح بفحص الثدي شهريًا للكشف المبكر عن الأورام، ويُفضّل استشارة الطبيب عند ملاحظة أي تغير."
        val fiqh = "باب الطهارة: يجب الغسل من الجماع، ويُسن الوضوء قبل النوم."
        val news = "عرضت القناة فيلمًا وثائقيًا عن حياة الأسود في أفريقيا."
        assertTrue(f.explicitScore(story).toString(), f.isExplicit(story, "medium"))
        assertFalse(f.explicitScore(medical).toString(), f.isExplicit(medical, "medium"))
        assertFalse(f.explicitScore(fiqh).toString(), f.isExplicit(fiqh, "strict"))
        assertFalse(f.isExplicit(news, "strict"))
        val en = "She undressed slowly, he caressed her naked body and she moaned, aroused, until climax."
        assertTrue(f.explicitScore(en).toString(), f.isExplicit(en, "medium"))
        assertFalse(f.isExplicit("Breast cancer screening saves lives; see your doctor.", "medium"))
    }

    private val cases = MiniJson.parse(TestFiles.text("packages/core/test/fixtures/text-cases.json")).obj()

    @Test
    fun sharedProfaneCases() {
        val missed = cases["profane"].strings().filter { !flagged(it) }
        assertEquals(emptyList<String>(), missed)
    }

    @Test
    fun sharedCleanCases() {
        val wrong = cases["clean"].strings().filter { flagged(it) }
        assertEquals(emptyList<String>(), wrong)
    }

    @Test fun insultsOnlyInChildMode() {
        val f = TextFilter.fromJson(TestFiles.text("packages/core/data/lexicon.json"))
        val s = "والله إنك حمار، يا كلب، ابن الكلب، you idiot"
        assertEquals(s, f.censor(s))
        f.insults = true
        val out = f.censor(s)
        for (w in listOf("حمار", "كلب", "idiot")) assertTrue(out, !out.contains(w))
        for (ok in listOf("ركبنا الحمار في المزرعة", "عندي كلب صغير", "حديقة الحيوان جميلة")) assertEquals(ok, f.censor(ok))
    }
}
