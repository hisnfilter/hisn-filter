import { THIGH_SKIN } from "./skin.js";
// سياسة المحتوى في صورة كود. المرجع: وثيقة "سياسة المحتوى — فلتر حصن".
// كل منتج (الإضافة، وأندرويد، وآيفون) يسأل هذه الدوال: هل أحجب هذا؟

export const LEVELS = ["light", "medium", "strict"];

/** الإعدادات الافتراضية حسب جنس المستخدم. كل قيمة يمكن تغييرها من الإعدادات. */
export function defaultSettings(viewer = "male") {
    const isMale = viewer === "male";
    return {
        viewer, // "male" | "female"
        level: "medium",
        blurAdultWomen: isMale,
        blurMen: false,
        blurCoveredWomen: false, // المنقبة: تُضبَّب في الصارم فقط
        blurCartoonWomen: isMale,
        blurGirls: false,
        blurStyle: "blur", // "blur" | "opaque" | "gray"
        partialBlur: true,
        childMode: false, // وضع الطفل: زر واحد يشغّل كل الحمايات (انظر topics.js childPreset)
        childAge: "9to12",
        childSex: "girl", // "boy" | "girl": يفرق في الصارم فقط
        blockScaryTopics: false, // إخفاء مقاطع السحر والجن والرعب والهالوين (يشغّله وضع الطفل)
        hideSuggestive: isMale, // إخفاء المقاطع الإيحائية من عناوينها (بكيني، ملابس داخلية…) للرجل ووضع الطفل
        maskInsults: false, // إخفاء الشتائم العامة مثل «يا حمار» (يشغّله وضع الطفل)
        youtubeStrict: false, // تغطية النساء وحدهن في الصورة حين يكون الكشف واثقًا، لا الصورة كلها
        removeMusic: true,
        muteSingerAfterMusicRemoval: true,
        allowNasheedsWithoutInstruments: true,
        muteSpokenProfanity: true,
        blockGambling: true,
        blockUnfilterableStreaming: true, // خدمات البث المشفّرة (نتفلكس…): لا تُفحص فلا تُفتح
        fastReveal: true,
        hideAds: true,
        hideSuggested: true,
        blockedWords: [],
        allowedChannels: [], // وضع الطفل في يوتيوب: قنوات يختارها ولي الأمر [{name, handle}]
        allowedChannelsOnly: false, // مع القائمة: لا يظهر إلا مقاطع هذه القنوات // كلمات يضيفها ولي الأمر: تُحذف بطاقات المقاطع التي تحويها ويُوقف المقطع المفتوح
        removeFlaggedCards: false, // وضع الطفل: بطاقة يوتيوب صورتها مخالفة تُحذف كلها
        hideShortsAndComments: false, // وضع الطفل دون 13: إخفاء Shorts والتعليقات وإيقاف التشغيل التلقائي // طيّ منشورات «مقترح لك» (حسابات لا يتابعها المستخدم) في خلاصة إنستغرام الرئيسية // إخفاء منشورات «ممول» والبطاقات المروّجة، وتخطّي إعلانات يوتيوب حين يتاح
        autoUnmute: true, // إنستغرام: إعادة الصوت لمقاطع الخلاصة التي يكتمها الموقع افتراضيًا (لا ما كتمه حصن) // المتوسط للبالغين: المقطع يظهر بعد فحص غلافه (~0.1 ث) ويستمر فحص إطاراته خلفه
        youtubeRestricted: true,
        lockEnabled: false,
    };
}

/** يطبّق مستوى الشدة فوق الإعدادات (المستوى الصارم يشدد ولا يخفف). */
export function effectiveSettings(settings) {
    const s = { ...settings };
    if (s.level === "light") {
        s.blurAdultWomen = false;
        s.youtubeRestricted = false;
        s.removeMusic = false;
    }
    // وضع الطفل: لا يتبع «من يستخدم الجهاز».
    //  المتوسط: مثل وضع المرأة (المحتشمات يظهرن، والعورات واللباس القصير مغطاة) للولد والبنت.
    //  الصارم: حسب الطفل — الولد تُغطّى عنه النساء، والبنت مثل المتوسط — مع حد عري أشد. لا يُغطّى كل الأشخاص.
    if (s.childMode) {
        const boyStrict = s.level === "strict" && s.childSex === "boy";
        s.blurAdultWomen = boyStrict;
        s.blurCartoonWomen = false;
        s.blurCoveredWomen = false;
        if (s.level === "strict") s.blurPeople = false;
        return s;
    }
    if (s.level === "strict") {
        // الصارم: الصورة أو المقطع كاملًا إذا فيه امرأة (لا تغطية جزئية)، والمنقبة للرجل، وحد عري أشد.
        // الرجال لا يُغطّون.
        if (s.viewer === "male") s.blurCoveredWomen = true;
    }
    return s;
}

/**
 * قرار حجب صورة أو إطار فيديو.
 * @param {object} d نتيجة الكشف:
 *   { nudity: 0..1, sexual: 0..1, people: [{ gender: "female"|"male"|"unknown",
 *     genderScore: 0..1, adult: true|false|null, covered: bool, cartoon: bool, area: 0..1 }],
 *     analyzed: bool }
 * @returns {{ action: "show"|"blur"|"cover", reason: string }}
 */
export function decideImage(d, settings) {
    const s = effectiveSettings(settings);
    // الشك يُحجب: إذا لم يكتمل الفحص لا نُظهر
    if (!d || !d.analyzed) return { action: "blur", reason: "not-analyzed" };
    // فحص ناقص (نموذج مساعد لم يعمل): في الصارم لا نُظهر، لأن غياب النتيجة ليس دليل سلامة
    if (d.partial && s.level === "strict") return { action: "blur", reason: "partial-analysis" };

    const t = { light: 0.75, medium: 0.6, strict: 0.45 }[s.level];
    if ((d.sexual ?? 0) >= t) return { action: "cover", reason: "sexual" };
    if ((d.nudity ?? 0) >= t) return { action: "cover", reason: "nudity" };
    // وضع الطفل مع «حماية العقيدة»: مشهد مخيف (وحوش، مهرج مخيف، مبنى مسكون، زومبي) يُحجب ولو خلا العنوان من كلمة رعب
    if (s.childMode && s.blockScaryTopics && (d.scene?.scary ?? 0) >= SCENE_SCARY) return { action: "blur", reason: "scary" };

    // «شخص» مجهول الجنس والمشهد كله بلا امرأة (سيارة، دخان، لعبة، رجال): كشف كاذب على الأغلب — لا نحجبه
    // «covered» (منقبة) يُحسب في هذا الحكم فقط حين تُحجب المنقبات أصلًا: نموذج المشهد يخلط الرجال بالغترة والشماغ مع المنقبة
    const coveredLow = (d.scene?.covered ?? 0) < SCENE_NO_WOMAN || !s.blurCoveredWomen;
    const sceneSaysNoWoman = !!d.scene && (d.scene.woman ?? 0) < SCENE_NO_WOMAN && coveredLow;
    // مجلس رجال: رجل واثقون منه، ولا امرأة مكتشفة، والمشهد لا يرجّح امرأة — من كان جنسه مجهولًا (وجه من الجانب،
    // أو تحت الغترة) يُعدّ رجلًا لا «شخصًا غير مؤكد»
    const menOnlyScene = sceneSaysNoWoman || menGathering(d, s);
    // الفخذ المكشوف لمجهول الجنس يُحكم به فقط إن لم يقطع المشهد بغياب النساء (سيقان الرجال في الرياضة كثيرة)
    for (const p of d.people ?? []) if (exposedThigh(p, s) && !(p.gender !== "female" && sceneSaysNoWoman)) return { action: "cover", reason: "nudity" };

    for (const p of d.people ?? []) {
        // الأشخاص الصغار جدًا في الخلفية يُتجاهلون إلا في الصارم
        if ((p.area ?? 1) < 0.01 && s.level !== "strict") continue;
        if (s.blurPeople) return { action: "blur", reason: "person" };

        // «امرأة» بثقة شبه معدومة (<0.1) والمشهد كله يقول لا امرأة: وجه جانبي أو صغير لرجل أخطأ فيه النموذج — يُعامل مجهولًا
        const female = p.gender === "female" && !((p.genderScore ?? 1) < 0.1 && sceneSaysNoWoman);
        // genderScore من 0 (لا يُعرف) إلى 1 (مؤكد). نموذج الوجوه يعطي الرجال ثقة منخفضة عادة
        // (0.13 إلى 0.27 في اختباراتنا) مع اتجاه صحيح، فلا نعدّ "رجل" غير مؤكد إلا تحت 0.1.
        // و"امرأة" تُعامل امرأة مهما كانت الثقة، لأن خطأ إظهار امرأة أشد من خطأ تضبيب رجل.
        const unsure = p.gender === "unknown" || (p.gender !== "female" || !female) && (p.genderScore ?? 1) < 0.1;
        if (p.adult === false && !s.blurGirls) continue;
        // شخصية مرسومة (كرتون أو لعبة مثل روبلوكس): نموذج الجنس لا يُعتمد عليه فيها، فلا تُغطّى إلا
        // في الصارم أو إن كان فيها عري (يُحكم به أعلاه)
        if (p.cartoon && s.level !== "strict") continue;
        if (female && p.covered && !s.blurCoveredWomen) continue;
        if (female && s.blurAdultWomen) return { action: "blur", reason: "woman" };
        if (p.gender === "male" && s.blurMen) return { action: "blur", reason: "man" };
        // جنس غير مؤكد: يُحجب في المتوسط والصارم إذا كان المستخدم يحجب النساء
        if (unsure && s.blurAdultWomen && s.level !== "light" && !menOnlyScene) {
            return { action: "blur", reason: "uncertain-person" };
        }
    }
    // فهم الصورة كاملة (نموذج المشهد): ما يفوت نماذج الوجوه والأجسام — ساقان بلا وجه، امرأة من الخلف،
    // وجه مغطى بقناع، رسم إيحائي، قبلة. يُحكم به بعد كل ما سبق، ولا يُستعمل في المخفف.
    const sc = d.scene;
    if (sc && s.level !== "light") {
        if ((sc.sexual ?? 0) >= SCENE_SEXUAL) return { action: "blur", reason: "scene-sexual" };
        if (s.blurAdultWomen && (sc.woman ?? 0) >= SCENE_WOMAN) return { action: "blur", reason: "scene-woman" };
        // منقبة (وجه مغطى): كالمنقبة المكتشفة بالوجه — تُحجب فقط حين يُحجب المنقبات (الصارم للرجل)
        if (s.blurAdultWomen && s.blurCoveredWomen && (sc.covered ?? 0) >= SCENE_WOMAN) return { action: "blur", reason: "woman" };
    }
    return { action: "show", reason: "clear" };
}

/** مجلس رجال (انظر decideImage): رجل واحد على الأقل بثقة كافية، ولا امرأة، والمشهد تحت SCENE_MEN_ONLY */
export const SCENE_MEN_ONLY = 0.3;
export function menGathering(d, s) {
    const sc = d.scene, people = d.people ?? [];
    if (!sc || (sc.woman ?? 0) >= SCENE_MEN_ONLY || (sc.sexual ?? 0) >= 0.1) return false;
    if (s?.blurCoveredWomen && (sc.covered ?? 0) >= SCENE_MEN_ONLY) return false;
    if (people.some((p) => p.gender === "female")) return false;
    return people.some((p) => p.gender === "male" && (p.genderScore ?? 0) >= 0.25 && p.adult !== false);
}

/** مشهد مخيف (وضع الطفل): قياس — بطاقات رعب روبلوكس 0.58 و1.00، والمناظر والناس والطعام 0.00–0.06 */
export const SCENE_SCARY = 0.65;

/** حدود نموذج المشهد (مقيسة على الآيفون: الصور الفائتة 0.81 فأكثر، والرجال والمناظر واللعب تحت 0.05) */
export const SCENE_WOMAN = 0.75;
export const SCENE_SEXUAL = 0.75;
/** تحت هذا الحد يُعدّ المشهد خاليًا من النساء (قياس: الرجال والمناظر واللعب تحت 0.05، والنساء 0.8+) */
export const SCENE_NO_WOMAN = 0.15;

/**
 * فخذ مكشوف (لباس قصير): عورة تُغطّى حتى للمستخدمة. يُحكم به على المرأة، وعلى غير معروف الجنس
 * في المتوسط والصارم. لا يُطبّق على الأطفال، ولا على الرجال (ملابس الرياضة القصيرة كثيرة ومحل خلاف).
 */
export function exposedThigh(p, s) {
    if (!((p.thighSkin ?? 0) >= THIGH_SKIN) || p.adult === false) return false;
    if ((p.area ?? 1) < 0.01 && s.level !== "strict") return false; // بعيد جدًا في الخلفية
    if (p.gender === "female") return true;
    const unsure = p.gender === "unknown" || (p.gender === "male" && (p.genderScore ?? 1) < 0.1);
    return unsure && s.level !== "light";
}

/** ما يمكن للمستخدم فعله بالمحتوى المحجوب، حسب القفل (القسم: القفل والإظهار). */
export function canReveal(reason, settings) {
    if (reason === "sexual" || reason === "nudity") {
        return settings.lockEnabled ? "never" : "confirm";
    }
    return settings.lockEnabled ? "pin" : "tap";
}
