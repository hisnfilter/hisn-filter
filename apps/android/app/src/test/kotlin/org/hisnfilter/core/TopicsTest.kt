package org.hisnfilter.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** نفس حالات packages/core/test/topics.test.js. */
class TopicsTest {
    private val t = Topics.fromJson(TestFiles.text("packages/core/data/topics.json"))

    @Test fun scaryTitlesDetected() {
        for (s in listOf(
            "قصة رعب حقيقية في بيت مسكون 😱", "تعلم السحر الأسود في 5 دقائق", "تحدي استحضار الأرواح الساعة 3",
            "حفلة الهالوين 🎃 أزياء مخيفة", "قصص جن واقعية", "لعبة تشارلي الحقيقية", "حظك اليوم مع الأبراج اليومية",
            "أقوى مشعوذ في العالم", "زومبي يهاجم المدينة", "Top 10 SCARY videos you shouldn't watch at night",
            "Roblox DOORS full walkthrough", "Poppy Playtime chapter 3", "Halloween costume ideas", "Ouija board gone wrong",
            "FNAF movie", "witchcraft for beginners", "وبالرعب الحقيقي",
        )) assertTrue(s, t.isScary(s))
    }

    @Test fun cleanTitlesKept() {
        for (s in listOf(
            "سورة الجن كاملة بصوت جميل", "الرقية الشرعية من القرآن الكريم", "أذكار التحصين من الشيطان",
            "سحر الطبيعة في الريف", "أغنية سحر", "جني الثمار في المزرعة", "عيون ساحرة", "تعلم الرسم للأطفال",
            "Minecraft house tutorial", "How to make pancakes", "Spelling bee practice", "Magic tricks for kids", "بلال يتعلم الحروف",
        )) assertFalse(s, t.isScary(s))
        assertTrue(t.isScary("رقية شرعية | قصة رعب مع الجن في بيت مسكون"))
    }
}
