package org.hisnfilter.core

/**
 * سياسة المحتوى — منقولة من packages/core/src/policy.js.
 * المرجع: وثيقة "سياسة المحتوى — فلتر حصن".
 */
enum class Viewer { MALE, FEMALE }

enum class Level(val key: String, val threshold: Double) {
    LIGHT("light", 0.75), MEDIUM("medium", 0.6), STRICT("strict", 0.45);

    companion object {
        fun of(key: String?) = values().firstOrNull { it.key == key } ?: MEDIUM
    }
}

data class PolicySettings(
    val viewer: Viewer = Viewer.MALE,
    val level: Level = Level.MEDIUM,
    val blurAdultWomen: Boolean = viewer == Viewer.MALE,
    val blurMen: Boolean = false,
    val blurCoveredWomen: Boolean = false,
    val blurCartoonWomen: Boolean = viewer == Viewer.MALE,
    val blurGirls: Boolean = false,
    val blurPeople: Boolean = false,
    val lockEnabled: Boolean = false,
    val childMode: Boolean = false,
    val blockScaryTopics: Boolean = true,
) {
    /** يطبّق المستوى: المخفف لا يضبّب النساء، والصارم يغطّي الصورة كاملة إذا فيها امرأة (الرجال لا يُغطّون). */
    fun effective(): PolicySettings = when (level) {
        Level.LIGHT -> copy(blurAdultWomen = false)
        Level.STRICT -> copy(blurCoveredWomen = blurCoveredWomen || viewer == Viewer.MALE)
        Level.MEDIUM -> this
    }

    companion object {
        fun defaults(viewer: Viewer) = PolicySettings(viewer = viewer)
    }
}

enum class Gender { FEMALE, MALE, UNKNOWN }

data class Person(
    val gender: Gender,
    val genderScore: Double,
    val adult: Boolean?,
    val area: Double,
    val box: Box = Box(0f, 0f, 0f, 0f),
    val covered: Boolean = false,
    val cartoon: Boolean = false,
    val thighSkin: Double? = null,
)

data class ImageAnalysis(
    val analyzed: Boolean,
    val nudity: Double = 0.0,
    val sexual: Double = 0.0,
    val people: List<Person> = emptyList(),
    /** نموذج المشهد: احتمال امرأة / محتوى إيحائي (0 إن لم يعمل) */
    val sceneWoman: Double = 0.0,
    val sceneSexual: Double = 0.0,
    val sceneCovered: Double = 0.0,
    val sceneScary: Double = 0.0,
    /** هل عمل نموذج المشهد؟ (قيم المشهد بلا معنى بدونه) */
    val hasScene: Boolean = false,
    /** فحص ناقص (نموذج مساعد لم يعمل): في الصارم لا نُظهر */
    val partial: Boolean = false,
)

enum class Action { SHOW, BLUR, COVER }

data class Decision(val action: Action, val reason: String)

object Policy {
    /**
     * قرار صورة كاملة أو إطار فيديو.
     * @param minArea الأشخاص الأصغر من هذه النسبة يُتجاهلون (إلا في الصارم). في الصفحات 1%،
     *   وفي لقطة الشاشة أصغر لأن الصورة المصغرة في التطبيق جزء صغير من الشاشة.
     */
    const val SCENE_MEN_ONLY = 0.3
    fun menGathering(d: ImageAnalysis, s: PolicySettings): Boolean {
        if (!d.hasScene || d.sceneWoman >= SCENE_MEN_ONLY || d.sceneSexual >= 0.1) return false
        if (s.blurCoveredWomen && d.sceneCovered >= SCENE_MEN_ONLY) return false
        if (d.people.any { it.gender == Gender.FEMALE }) return false
        return d.people.any { it.gender == Gender.MALE && it.genderScore >= 0.25 && it.adult != false }
    }

    fun decide(d: ImageAnalysis?, settings: PolicySettings, minArea: Double = 0.01): Decision {
        val s = settings.effective()
        if (d == null || !d.analyzed) return Decision(Action.BLUR, "not-analyzed")
        if (d.partial && s.level == Level.STRICT) return Decision(Action.BLUR, "partial-analysis")
        val t = s.level.threshold
        if (d.sexual >= t) return Decision(Action.COVER, "sexual")
        if (d.nudity >= t) return Decision(Action.COVER, "nudity")
        // وضع الطفل مع حماية العقيدة: مشهد مخيف يُحجب ولو خلا العنوان من كلمة رعب
        if (s.childMode && s.blockScaryTopics && d.sceneScary >= SceneText.SCENE_SCARY) return Decision(Action.BLUR, "scary")
        // «شخص» مجهول الجنس والمشهد كله بلا امرأة (سيارة، دخان، لعبة، رجال): كشف كاذب على الأغلب — لا نحجبه
        // «covered» يُحسب هنا فقط حين تُحجب المنقبات أصلًا (نموذج المشهد يخلط الرجال بالغترة مع المنقبة)
        val coveredLow = d.sceneCovered < SceneText.SCENE_NO_WOMAN || !s.blurCoveredWomen
        val sceneSaysNoWoman = d.hasScene && d.sceneWoman < SceneText.SCENE_NO_WOMAN && coveredLow
        for (p in d.people) if (exposedThigh(p, s, minArea) && !(p.gender != Gender.FEMALE && sceneSaysNoWoman)) return Decision(Action.COVER, "nudity")
        // مجلس رجال (منقول من policy.js menGathering): رجل واثق، ولا امرأة، والمشهد لا يرجّح امرأة ← المجهول يُعدّ رجلًا
        val menOnlyScene = sceneSaysNoWoman || menGathering(d, s)
        for (p in d.people) {
            // «امرأة» بثقة شبه معدومة (<0.1) والمشهد كله بلا امرأة: وجه رجل أخطأ فيه النموذج — يُعامل مجهولًا (مثل policy.js)
            val q = if (p.gender == Gender.FEMALE && p.genderScore < 0.1 && sceneSaysNoWoman) p.copy(gender = Gender.UNKNOWN) else p
            val r = personDecision(q, s, minArea) ?: continue
            if (r.reason == "uncertain-person" && menOnlyScene) continue
            return r
        }
        // المشهد كاملًا (منقول من policy.js): لا يُطبّق في الخفيف
        if (s.level != Level.LIGHT) {
            if (d.sceneSexual >= SceneText.SCENE_SEXUAL) return Decision(Action.BLUR, "scene-sexual")
            if (s.blurAdultWomen && d.sceneWoman >= SceneText.SCENE_WOMAN) return Decision(Action.BLUR, "scene-woman")
            if (s.blurAdultWomen && s.blurCoveredWomen && d.sceneCovered >= SceneText.SCENE_WOMAN) return Decision(Action.BLUR, "woman")
        }
        return Decision(Action.SHOW, "clear")
    }

    /** قرار شخص واحد (null = لا يُحجب). s يجب أن تكون إعدادات فعلية (effective). */
    fun personDecision(p: Person, s: PolicySettings, minArea: Double): Decision? {
        if (p.area < minArea && s.level != Level.STRICT) return null
        if (s.blurPeople) return Decision(Action.BLUR, "person")
        val female = p.gender == Gender.FEMALE
        // نموذج الوجوه يعطي الرجال ثقة منخفضة عادة (0.13–0.27) مع اتجاه صحيح،
        // فلا نعدّ "رجل" غير مؤكد إلا تحت 0.1. و"امرأة" تبقى امرأة مهما كانت الثقة.
        val unsure = p.gender == Gender.UNKNOWN || (p.gender == Gender.MALE && p.genderScore < 0.1)
        if (p.adult == false && !s.blurGirls) return null
        if (p.cartoon && s.level != Level.STRICT) return null
        if (female && p.covered && !s.blurCoveredWomen) return null
        if (female && s.blurAdultWomen) return Decision(Action.BLUR, "woman")
        if (p.gender == Gender.MALE && s.blurMen) return Decision(Action.BLUR, "man")
        if (unsure && s.blurAdultWomen && s.level != Level.LIGHT) return Decision(Action.BLUR, "uncertain-person")
        return null
    }

    /** فخذ مكشوف: للمرأة، ولغير معروف الجنس في المتوسط والصارم. لا للأطفال ولا للرجل (منقول من policy.js). */
    fun exposedThigh(p: Person, s: PolicySettings, minArea: Double): Boolean {
        if ((p.thighSkin ?: 0.0) < Skin.THIGH_SKIN || p.adult == false) return false
        if (p.area < minArea && s.level != Level.STRICT) return false
        if (p.gender == Gender.FEMALE) return true
        val unsure = p.gender == Gender.UNKNOWN || (p.gender == Gender.MALE && p.genderScore < 0.1)
        return unsure && s.level != Level.LIGHT
    }

    fun canReveal(reason: String, settings: PolicySettings): String =
        if (reason == "sexual" || reason == "nudity") {
            if (settings.lockEnabled) "never" else "confirm"
        } else {
            if (settings.lockEnabled) "pin" else "tap"
        }
}
