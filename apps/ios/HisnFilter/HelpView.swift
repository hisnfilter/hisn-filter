import SwiftUI

/// الأسئلة الشائعة، والأمن والأمان، وسياسة الخصوصية: نفس نصوص docs/FAQ.md وSECURITY.md وPRIVACY.md.
struct HelpView: View {
    var body: some View {
        List {
            Section {
                NavigationLink { TourView { } } label: { Label(tr("جولة سريعة في التطبيق", "Quick tour of the app"), systemImage: "hand.wave") }
            }
            NavigationLink { TipsView() } label: { Label(tr("نصائح لتصفح أنظف", "Tips for a cleaner feed"), systemImage: "lightbulb") }
            NavigationLink { FAQView() } label: { Label(tr("الأسئلة الشائعة", "FAQ"), systemImage: "questionmark.circle") }
            NavigationLink { SecurityView() } label: { Label(tr("الأمن والأمان", "Security"), systemImage: "lock.shield") }
            NavigationLink { PrivacyView() } label: { Label(tr("سياسة الخصوصية", "Privacy policy"), systemImage: "hand.raised") }
            NavigationLink { AboutView() } label: { Label(tr("عن حصن والحقوق", "About & credits"), systemImage: "info.circle") }
        }
        .navigationTitle(tr("المساعدة والسياسات", "Help & policies"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct QA: Identifiable {
    let id = UUID()
    let q: String
    let a: String
    var g: String = ""
    init(g: String = "basics", q: String, a: String) { self.g = g; self.q = q; self.a = a }
    init(q: String, a: String, g: String) { self.g = g; self.q = q; self.a = a }
}

/// مجموعات الأسئلة (ترتيب العرض)
private let FAQ_GROUPS: [(key: String, title: String, icon: String)] = [
    ("basics", tr("الأساسيات", "Basics"), "shield.lefthalf.filled"),
    ("kids", tr("الأطفال", "Children"), "figure.and.child.holdinghands"),
    ("devices", tr("أجهزة أخرى: تلفزيون، أليكسا، آيباد، حاسوب", "Other devices: TV, Alexa, iPad, computer"), "tv"),
    ("audio", tr("الصوت والموسيقى", "Audio & music"), "speaker.wave.2"),
    ("issues", tr("مشاكل شائعة", "Common issues"), "wrench.and.screwdriver"),
]

struct FAQView: View {
    private let items: [QA] = [
        QA(g: "basics", q: tr("هل يرسل التطبيق صوري أو ما أتصفحه لأحد؟", "Does the app send my photos or browsing to anyone?"),
           a: tr("لا. كل الفحص على جهازك، ولا خادم لنا.", "No. Everything is checked on your device; we have no server.")),
        QA(g: "devices", q: tr("هل يعمل حصن على التلفزيون الذكي؟", "Does Hisn work on a smart TV?"),
           a: tr("""
لا. تلفزيونات سامسونج وLG وأبل أنظمة مغلقة لا تسمح بفلتر فوق تطبيقاتها. ما يحمي التلفزيون فعليًا:

١) DNS عائلي على الراوتر (يحجب المواقع الإباحية على كل أجهزة البيت، ومنها التلفزيون):
• افتح إعدادات الراوتر من المتصفح: غالبًا 192.168.1.1 أو 192.168.0.1 (اسم الدخول وكلمته على ملصق الراوتر).
• ابحث عن «DNS» (في Internet / WAN / LAN / DHCP).
• اكتب الأساسي 1.1.1.3 والثانوي 1.0.0.3 (Cloudflare للعائلات)، ثم احفظ وأعد تشغيل الراوتر.
• للتأكد: افتح موقعًا إباحيًا معروفًا من أي جهاز في البيت — لا يفتح.

٢) يوتيوب على التلفزيون: إعدادات التطبيق ← «الوضع المقيّد» تشغيل، أو حساب أطفال / يوتيوب كيدز.
٣) نتفلكس وشاهد: ملف أطفال + حد نضج + رمز للملفات الأخرى.
٤) أندرويد تي في: يمكن مستقبلًا تثبيت نسخة أندرويد من حصن، لكنها غير مهيأة للريموت بعد.
""", """
No. Samsung, LG and Apple TVs are closed systems that allow no filter over their apps. What actually protects a TV:

1) Family DNS on the router (blocks adult sites on every device at home, including the TV):
• Open the router settings in a browser: usually 192.168.1.1 or 192.168.0.1 (login on the router's sticker).
• Find “DNS” (under Internet / WAN / LAN / DHCP).
• Primary 1.1.1.3, secondary 1.0.0.3 (Cloudflare for Families), save, restart the router.
• To verify: a known adult site should not open from any device at home.

2) YouTube on the TV: app settings → Restricted Mode on, or a kids account / YouTube Kids.
3) Netflix and Shahid: kids profile + maturity rating + PIN on other profiles.
4) Android TV: an Android build of Hisn could be installed in future, but it is not remote-friendly yet.
""")),
        QA(q: tr("ابني يستخدم أليكسا (Echo). هل يحميه حصن؟", "My child uses Alexa (Echo). Does Hisn protect it?"),
           a: tr("""
لا؛ أليكسا نظام مغلق من أمازون لا يقبل تطبيقات ولا إضافات، ولا يستطيع أي برنامج خارجي فلترته. ما يمكنك فعله فعلًا، خطوة خطوة:

١. افتحي تطبيق Alexa على جوالك ← «الأجهزة» (Devices) ← اختاري جهاز Echo.
٢. فعّلي «Amazon Kids»: يحصر الأغاني والمهارات والمقاطع بمحتوى الأطفال، ويتيح حدود وقت ووقت نوم.
٣. من القائمة ← «الإعدادات» ← «الموسيقى والبودكاست» ← شغّلي «Explicit Language Filter» (فلتر الألفاظ الصريحة).
٤. إن كان الجهاز Echo Show (بشاشة): من إعدادات الشاشة ← أوقفي «المتصفح» (Silk/Firefox) نهائيًا؛ هو الباب لأي موقع وليوتيوب.
٥. للبيت كله (بما فيه أليكسا): اضبطي DNS الراوتر كما في سؤال «التلفزيون الذكي»؛ يحجب المواقع الإباحية ويفرض الوضع المقيّد في يوتيوب على كل الأجهزة.

ما لا يُحل بأي طريقة: الطلبات الصوتية العامة («أليكسا، شغّلي…») تمر بخوادم أمازون، وفلترتها بيد أمازون وحدها.
""", """
No. Alexa is a closed Amazon system that accepts no apps or extensions, and no outside software can filter it. What you can actually do, step by step:

1. Open the Alexa app → Devices → pick the Echo.
2. Turn on Amazon Kids: limits songs, skills and videos to children's content, with time limits and bedtime.
3. Menu → Settings → Music & Podcasts → turn on “Explicit Language Filter”.
4. On an Echo Show (with a screen): in the display settings, disable the browser (Silk/Firefox); it is the door to any website and YouTube.
5. For the whole house (Alexa included): set the router DNS as in the “smart TV” question; it blocks adult sites and forces YouTube Restricted Mode on every device.

What nothing can solve: general voice requests (“Alexa, play…”) go through Amazon's servers; filtering them is in Amazon's hands only.
"""), g: "devices"),
        QA(g: "kids", q: tr("ما «القنوات المسموحة» في يوتيوب؟", "What are “Allowed channels” on YouTube?"),
           a: tr("""
قائمة بيضاء لوضع الطفل: تضيفين القنوات التي تثقين بها، وتشغّلين «القنوات المسموحة فقط».
١. وضع الطفل ← «القنوات المسموحة في يوتيوب» ← اكتبي اسم القناة أو @معرّفها أو رابطها ← إضافة (بالرمز).
٢. أو افتحي أي مقطع من القناة داخل حصن: إن كانت غير مسموحة تظهر شاشة فيها زر «ولي الأمر: السماح بهذه القناة» ← أدخلي الرمز.
٣. بعدها لا يظهر في الرئيسية والبحث والمقترحات إلا مقاطع هذه القنوات، ويبقى الفلتر العام يعمل فوقها.
الحذف من القائمة لا يحتاج رمزًا (يضيّق)، والإضافة وإيقاف الخيار يحتاجان الرمز (يوسّعان).
""", """
An allow-list for child mode: add the channels you trust and turn on “Allowed channels only”.
1. Child mode → “Allowed YouTube channels” → type the channel name, @handle or link → Add (with the code).
2. Or open any of the channel's videos inside Hisn: if it isn't allowed, a screen appears with “Parent: allow this channel” → enter the code.
3. Then only those channels' videos appear on Home, Search and suggestions; the general filter still runs on top.
Removing needs no code (narrows); adding and turning the option off need the code (widen).
""")),
        QA(g: "kids", q: tr("ما «الكلمات المحجوبة»؟", "What are “Blocked words”?"),
           a: tr("قائمة تكتب فيها كلمات أو عبارات (عربي أو إنجليزي). أي مقطع عنوانه فيه واحدة منها تُحذف بطاقته كاملة من الرئيسية والبحث والمقترحات في يوتيوب وتيك توك وألعاب روبلوكس، ولو فُتح يُوقَف. الكلمة العربية تطابق اشتقاقاتها (مرعب ← مرعبة). تعمل فورًا وفي كل الأوضاع، والحذف منها يطلب الرمز.",
                  "A list of words or phrases (Arabic or English). Any video whose title contains one has its whole card removed from Home, Search and suggestions on YouTube, TikTok and Roblox, and is stopped if opened. An Arabic word matches its derived forms. Works immediately in every mode; removing a word asks for the code.")),
        QA(g: "kids", q: tr("ما «المواقع المسموحة فقط» في وضع الطفل؟", "What is “Allowed sites only” in child mode?"),
           a: tr("لا يفتح المتصفح المحمي إلا ما في «قائمة التطبيقات» (وما يلزمها لتسجيل الدخول)؛ أي رابط آخر يُحجب بصفحة تطلب من ولي الأمر إضافته. احذف من القائمة ما لا تريده للطفل وأضف ما تريده، وكل تعديل يطلب رمز القفل.",
                  "The protected browser opens only what is in the “Apps list” (plus what they need for sign-in); any other link is blocked with a page asking a parent to add it. Remove what you don't want and add what you do; every change asks for the lock code.")),
        QA(g: "kids", q: tr("كيف يحمي حصن طفلًا دون ١٣ في يوتيوب؟", "How does Hisn protect a child under 13 on YouTube?"),
           a: tr("خياران في وضع الطفل (٩–١٢): «يوتيوب كيدز» (الافتراضي): يُستبدل يوتيوب كليًا بمحتوى منتقى للأطفال، وأي رابط يوتيوب عادي يتحوّل إليه. أو «العادي بتقييد الصغار» لمن يريد قنوات ليست في كيدز: يوتيوب نفسه لكن تُحذف بطاقات الرعب والسحر والكرتون غير اللائق كاملةً من الرئيسية والبحث والمقترحات (من العنوان ومن فحص الصورة المصغّرة)، ولا Shorts ولا تعليقات ولا تشغيل تلقائي، مع الوضع المقيّد. في الحالتين: اقفل تطبيق يوتيوب الأصلي من «التطبيقات المقفلة»، وتغيير الخيار يطلب الرمز.",
                  "Two options in child mode (9–12): “YouTube Kids” (default): YouTube is replaced by curated children's content and any regular link redirects to it. Or “Regular, kid-restricted” for channels that aren't on Kids: YouTube itself, but horror, magic and inappropriate-cartoon cards are removed entirely from Home, Search and suggestions (by title and by thumbnail scan), with no Shorts, comments or autoplay, and Restricted Mode on. Either way, lock the native YouTube app under “Locked apps”; changing the option asks for the code.")),
        QA(g: "audio", q: tr("ما زر «🎙 الصوت» فوق مقاطع يوتيوب؟", "What is the “🎙 Audio” button over YouTube videos?"),
           a: tr("بعض أصحاب القنوات يرفعون مع المقطع مسار صوت ثانيًا (يظهر باسم لغة أخرى مثل «Spanish») فيه الكلام نفسه بلا موسيقى. يوتيوب يخفي الخيار في قوائم عميقة؛ حصن يعرضه زرًا واحدًا فوق المقطع حين يتوفر أكثر من مسار، ويتذكر اختيارك لكل قناة فيطبّقه تلقائيًا في مقاطعها التالية. لا تحليل صوت ولا حمل إضافي — مجرد تبديل مسار يقدّمه يوتيوب نفسه.",
                  "Some channels upload a second audio track with the video (shown under another language such as “Spanish”) with the same speech and no music. YouTube hides the option deep in menus; Hisn shows it as one button over the video when more than one track exists, and remembers your choice per channel. No audio analysis, no extra load — just switching a track YouTube itself provides.")),
        QA(g: "basics", q: tr("لماذا لا يفتح نتفلكس وشاهد من حصن؟", "Why don't Netflix and Shahid open from Hisn?"),
           a: tr("خدمات البث هذه تشفّر الفيديو: الجهاز يعرضه ويمنع أي برنامج من قراءته، فلا يستطيع حصن فحصه أو تغبيشه. بدل فتح باب لمحتوى غير مفحوص، لا تُفتح من حصن أصلًا. للتطبيق الأصلي: اقفله من «التطبيقات المقفلة»، واستعمل حد النضج في إعدادات الخدمة نفسها.",
                  "These streaming services encrypt their video: the device shows it but prevents any app from reading it, so Hisn cannot check or blur it. Rather than opening a door to unchecked content, they don't open from Hisn at all. For the native app: lock it under “Locked apps”, and use the service's own maturity settings.")),
        QA(g: "basics", q: tr("لماذا يبدأ كل مقطع مغبشًا ثم يظهر؟", "Why does every video start blurred, then appear?"),
           a: tr("لأننا نفحص أولًا ثم نُظهر، لا العكس. لو أظهرنا ثم غبّشنا لمرّت ثوانٍ من المحتوى قبل الحجب. الفحص يستغرق عادة أقل من ثانيتين.",
                 "We check first, then show. Showing first would let seconds of content through before blocking. Checking usually takes under two seconds.")),
        QA(g: "basics", q: tr("لماذا يختلف ما يُغطّى بين رجل وامرأة وطفل؟", "Why does coverage differ between man, woman and child?"),
           a: tr("للرجل تُغطّى النساء البالغات والعورات. للمرأة تظهر النساء وتُغطّى العورات فقط. للطفل تُحجب إضافة إلى ذلك مواضيع السحر والرعب والهالوين وألعاب الرعب والألفاظ.",
                 "For a man, adult women and nudity are covered. For a woman, women are shown and only nudity is covered. For a child, magic, horror, Halloween, horror games and bad words are hidden too.")),
        QA(g: "basics", q: tr("ما «حماية العقيدة»؟", "What is “Protect beliefs”?"),
           a: tr("إخفاء مقاطع وصور السحر والجن والرعب والهالوين وألعاب الرعب في المنصات والبحث. مفعّلة للجميع، ويمكن إيقافها من الإعدادات (يطلب الرمز إن وُجد).",
                 "Hiding magic, jinn, horror, Halloween and horror-game videos and images on platforms and in search. On for everyone; can be turned off in Settings (asks for the code if set).")),
        QA(g: "audio", q: tr("الموسيقى: ماذا يُكتم وماذا لا؟", "Music: what is muted and what isn't?"),
           a: tr("في إنستغرام وتيك توك وفيسبوك: يُكتم المقطع بالاسم المكتوب للصوت، وبـ«السماع» أيضًا — التطبيق يسمع أول ثوانيه على الجهاز ويكتمه إن سمع آلات أو موسيقى (الإنشاد والتلاوة والكلام لا تُكتم). في يوتيوب لا يمكن سماع الصوت على الآيفون، فيُكتم ما صنّفه يوتيوب «موسيقى» أو ما يدل عنوانه على أغنية (أغنية، كليب، lyrics…)؛ الموسيقى الخلفية داخل مقطع عادي في يوتيوب لا تُكتم. أي كتم خاطئ تُعيدينه بزر «ليست موسيقى؟». الفيديو المحفوظ تُزال منه الموسيقى ويبقى الكلام عبر «تنظيف فيديو».",
                 "On Instagram, TikTok and Facebook a clip is muted by its written sound name and also by listening: the app hears its first seconds on-device and mutes it on instruments or music (nasheed, recitation and speech are not muted). On YouTube the audio cannot be heard on iPhone, so videos YouTube classifies as Music, or whose title indicates a song (song, lyrics, clip…), are muted; background music inside a regular YouTube video is not. A wrong mute is undone with “not music?”. A saved video gets its music removed, keeping speech, via “Clean a video”.")),
        QA(g: "issues", q: tr("جاءني تنبيه «جهاز جديد سجّل دخولًا» من إنستغرام أو قوقل. هل هذا اختراق؟", "Instagram or Google warned “a new device signed in”. Was I hacked?"),
           a: tr("لا. المتصفح المحمي يُعدّ جهازًا مستقلًا مثل سفاري، فيصلك التنبيه مرة واحدة عند أول دخول. أجب «نعم، هذا أنا» إن سُئلت.",
                 "No. The protected browser counts as a separate device, like Safari, so you get the notice once on first sign-in. Answer “yes, it was me” if asked.")),
        QA(g: "basics", q: tr("هل يمنع التطبيق حذفه أو استخدام سفاري؟", "Does the app prevent deleting it or using Safari?"),
           a: tr("لا. هو فلتر للمحتوى، لا قفل للجهاز. لحماية جهاز الطفل كاملًا استخدم «مدة استخدام الجهاز» من آبل (مدمجة في وضع الطفل: قفل التطبيقات وحدّ الألعاب).",
                 "No. It is a content filter, not a device lock. For full protection of a child’s device use Apple’s Screen Time (built into child mode: app locks and game limits).")),
        QA(g: "issues", q: tr("لماذا لا يعمل كشف العري؟", "Why isn't nudity detection working?"),
           a: tr("يحتاج تفعيل «تحذير المحتوى الحساس» من إعدادات آيفون ← الخصوصية والأمن.", "It needs “Sensitive Content Warning” on: iPhone Settings → Privacy & Security.")),
        QA(g: "devices", q: tr("هل يعمل على الآيباد والحاسوب؟", "Does it work on iPad and computers?"),
           a: tr("التطبيق يعمل على آيفون وآيباد. وللحاسوب إضافة المتصفح (كروم وفايرفوكس وسفاري).", "The app works on iPhone and iPad. For computers there is the browser extension (Chrome, Firefox, Safari).")),
        QA(g: "issues", q: tr("نسيت رمز القفل.", "I forgot the lock code."),
           a: tr("لا يمكن استرجاعه لأننا لا نحفظه. الحل حذف التطبيق وإعادة تثبيته (تُفقد الإعدادات).", "It can't be recovered because we never store it. Delete and reinstall the app (settings are lost).")),
    ]

    var body: some View {
        // مجموعات واضحة، وكل جواب مطوي يُفتح بضغطة؛ الخطوات المرقّمة تُعرض سطرًا سطرًا
        List {
            ForEach(FAQ_GROUPS, id: \.key) { grp in
                let rows = items.filter { $0.g == grp.key }
                if !rows.isEmpty {
                    Section {
                        ForEach(rows) { it in
                            DisclosureGroup {
                                VStack(alignment: .leading, spacing: 6) {
                                    ForEach(Array(it.a.split(separator: "\n", omittingEmptySubsequences: true).enumerated()), id: \.offset) { _, line in
                                        let l = String(line).trimmingCharacters(in: .whitespaces)
                                        Text(l)
                                            .foregroundStyle(.secondary)
                                            .padding(.leading, l.first.map { "١٢٣٤٥٦٧٨٩0123456789".contains($0) } == true ? 8 : 0)
                                    }
                                }
                                .padding(.top, 4).textSelection(.enabled)
                            } label: {
                                Text(it.q).font(.headline)
                            }
                            .padding(.vertical, 2)
                        }
                    } header: {
                        Label(grp.title, systemImage: grp.icon)
                    }
                }
            }
        }
        .navigationTitle(tr("الأسئلة الشائعة", "FAQ"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SecurityView: View {
    var body: some View {
        List {
            Section {
                NavigationLink { TourView { } } label: { Label(tr("جولة سريعة في التطبيق", "Quick tour of the app"), systemImage: "hand.wave") }
            }
            Section(tr("هل التطبيق آمن مثل التطبيقات المعروفة؟", "Is the app as safe as well-known apps?")) {
                Text(tr("نعم، وبعدة أوجه أأمن، لأن أكبر مصدر لتسريب البيانات هو خوادم الشركات، ونحن بلا خادم أصلًا.",
                        "Yes, and in several ways safer: the biggest source of data leaks is company servers, and we have none."))
                Text(tr("المتصفح المحمي هو متصفح النظام نفسه (محرك سفاري): نفس تشفير الاتصال وعزل المواقع وحفظ الجلسات.",
                        "The protected browser is the system browser itself (Safari’s engine): the same encryption, site isolation and session storage."))
                Text(tr("كلمات السر لا تمر علينا: عند تسجيل الدخول تذهب الكلمة مباشرة للموقع عبر متصفح النظام، ولا يقرؤها التطبيق ولا يخزنها.",
                        "Passwords never pass through us: at sign-in they go straight to the site via the system browser; the app neither reads nor stores them."))
                Text(tr("عزل النظام: التطبيق معزول عن باقي الجوال، فلا يصل لصورك أو رسائلك أو تطبيقاتك.",
                        "System sandbox: the app is isolated from the rest of the phone and cannot reach your photos, messages or other apps."))
                Text(tr("رمز القفل: تُحفظ بصمته فقط، مع حدّ للمحاولات وتأخير متصاعد.", "Lock code: only its hash is stored, with limited attempts and growing delays."))
                Text(tr("مفتوح المصدر: يراجعه من يشاء.", "Open source: anyone can review it."))
            }
            Section(tr("حدود يجب أن تعرفها", "Limits you should know")) {
                Text(tr("فلتر، لا قفل للجهاز: رمز القفل يمنع العبث بإعدادات حصن، لكنه لا يمنع حذف التطبيق أو استخدام متصفح آخر. حماية الجهاز الكاملة بـ «مدة استخدام الجهاز» (مدمجة في وضع الطفل).",
                        "A filter, not a device lock: the code protects Hisn’s settings but doesn’t stop deleting the app or using another browser. Full device protection is Screen Time (built into child mode)."))
                Text(tr("الكشف بالذكاء الاصطناعي قد يفوّت أو يغطي خطأً. الحماية طبقات متعددة، لا ضمان مطلق.",
                        "AI detection can miss or over-cover. Protection is several layers, not an absolute guarantee."))
                Text(tr("موقع يتعمد مقاومة الفلتر قد يتجاوز بعض الطبقات. المنصات الكبرى لا تفعل ذلك.",
                        "A site that deliberately fights the filter may bypass some layers. Major platforms don’t."))
            }
            Section(tr("تنبيه «جهاز جديد» من إنستغرام وقوقل", "“New device” notice from Instagram and Google")) {
                Text(tr("عند أول تسجيل دخول داخل حصن قد يصلك تنبيه «جهاز غير معروف سجّل دخولًا». هذا طبيعي: الموقع يعتبر المتصفح المحمي جهازًا مستقلًا مثل سفاري. يحدث مرة واحدة، وإن سُئلت «هل هذا أنت؟» فأجب بنعم.",
                        "On first sign-in inside Hisn you may get “an unrecognized device signed in”. That’s normal: the site treats the protected browser as a separate device, like Safari. It happens once; if asked “was this you?”, answer yes."))
            }
            Section(tr("الإبلاغ عن ثغرة", "Reporting a vulnerability")) {
                Text(tr("إن وجدت ثغرة أمنية فأبلغ عنها بشكل خاص عبر صفحة المشروع قبل نشرها، لنصلحها أولًا.",
                        "If you find a security issue, report it privately via the project page before publishing it, so we can fix it first."))
            }
        }
        .navigationTitle(tr("الأمن والأمان", "Security"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct PrivacyView: View {
    var body: some View {
        List {
            Section {
                NavigationLink { TourView { } } label: { Label(tr("جولة سريعة في التطبيق", "Quick tour of the app"), systemImage: "hand.wave") }
            }
            Section {
                Text(tr("كل الفحص يتم على جهازك. لا خوادم لنا، ولا حسابات، ولا إعلانات، ولا تحليلات، ولا يُرسل عنك شيء لأحد.",
                        "Everything is checked on your device. No servers, no accounts, no ads, no analytics; nothing about you is sent to anyone.")).font(.headline)
            }
            Section(tr("ما يُعالج على جهازك", "Processed on your device")) {
                Text(tr("الصور والمقاطع والنصوص في الصفحات تُفحص بنماذج تعمل على الجهاز ثم تُحذف من الذاكرة. لا تُحفظ ولا تُرسل.",
                        "Images, videos and text on pages are checked by on-device models, then dropped from memory. Not stored, not sent."))
                Text(tr("الفيديو الذي تنظّفه يُعالج على الجهاز ويُحفظ في صورك فقط.", "A video you clean is processed on the device and saved only to your Photos."))
            }
            Section(tr("ما يُحفظ على الجهاز", "Stored on the device")) {
                Text(tr("إعداداتك، وبصمة رمز القفل (لا الرمز نفسه).", "Your settings, and a hash of the lock code (not the code)."))
                Text(tr("جلسات المواقع التي تسجّل دخولك فيها داخل المتصفح المحمي، في مخزن النظام المشفّر مثل سفاري.",
                        "Sessions of sites you sign into inside the protected browser, in the system’s encrypted store, like Safari."))
                Text(tr("سجل تقني صغير بلا أي محتوى (أخطاء النماذج فقط) يُحذف تلقائيًا بعد أسبوع.", "A small technical log with no content (model errors only), deleted automatically after a week."))
            }
            Section(tr("الاتصالات بالإنترنت", "Internet connections")) {
                Text(tr("المواقع التي تفتحها أنت، وجلب أيقوناتها، وجلب صور ومقاطع الصفحة المفتوحة لفحصها على جهازك (من الموقع نفسه، لا من خادم لنا).",
                        "The sites you open, their icons, and the open page’s images and videos fetched for on-device checking (from the site itself, never from a server of ours)."))
            }
            Section(tr("ما لا نفعله", "What we never do")) {
                Text(tr("لا نجمع بيانات، ولا نبيعها، ولا نشارك شيئًا مع أي طرف. لا نعرف من يستخدم التطبيق ولا ماذا يتصفح.",
                        "We don’t collect, sell or share data with anyone. We don’t know who uses the app or what they browse."))
            }
        }
        .navigationTitle(tr("سياسة الخصوصية", "Privacy policy"))
        .navigationBarTitleDisplayMode(.inline)
    }
}


/// نصائح عامة لا تحتاج حصن أصلًا: إعدادات في المنصات نفسها تقلّل ما يصلك من محتوى مقترح، فيقلّ ما يحتاج حجبًا.
struct TipsView: View {
    private struct Tip: Identifiable { let id = UUID(); let app: String; let icon: String; let lines: [String] }
    private let tips: [Tip] = [
        Tip(app: tr("إنستغرام", "Instagram"), icon: "camera", lines: [
            tr("اضغط على كلمة Instagram أعلى الصفحة واختر «Following»: تظهر منشورات من تتابعهم فقط، بلا حسابات مقترحة.", "Tap the Instagram word at the top and choose “Following”: only accounts you follow, no suggestions."),
            tr("تجنّب تبويب البحث (العدسة) والريلز: هما مصدر أغلب المحتوى المقترح.", "Avoid the Search (magnifier) and Reels tabs: most suggested content comes from there."),
            tr("الإعدادات ← تفضيلات المحتوى ← المحتوى الحساس ← «أقل».", "Settings → Content preferences → Sensitive content → “Less”."),
            tr("على أي منشور لا تريده: ⋯ ← «غير مهتم»، فيتعلّم إنستغرام ما لا تريده.", "On any unwanted post: ⋯ → “Not interested”, so Instagram learns."),
            tr("تعديل الملف الشخصي ← أوقف «إظهار اقتراحات الحسابات في الملفات الشخصية» (Show account suggestions on profiles).", "Edit profile → turn off “Show account suggestions on profiles”."),
            tr("حصن يطوي تلقائيًا منشورات «مقترح لك» والإعلانات في الخلاصة الرئيسية (يمكن إيقافه من إعدادات الإضافة).", "Hisn automatically folds “Suggested for you” posts and ads in the home feed."),
        ]),
        Tip(app: tr("يوتيوب", "YouTube"), icon: "play.rectangle", lines: [
            tr("استعمل تبويب «الاشتراكات» بدل الصفحة الرئيسية.", "Use the “Subscriptions” tab instead of Home."),
            tr("صورة الحساب ← الإعدادات ← عام ← «الوضع المقيّد».", "Profile picture → Settings → General → “Restricted mode”."),
            tr("أوقف سجلّ المشاهدة أو امسحه: تختفي التوصيات المبنية عليه.", "Pause or clear watch history: recommendations built on it disappear."),
            tr("للأطفال دون ١٣: حصن يفتح YouTube Kids تلقائيًا في وضع الطفل.", "For children under 13: Hisn opens YouTube Kids automatically in child mode."),
        ]),
        Tip(app: tr("تيك توك", "TikTok"), icon: "music.note", lines: [
            tr("استعمل تبويب «Following» بدل «For You».", "Use the “Following” tab instead of “For You”."),
            tr("الإعدادات ← الرفاهية الرقمية ← «الوضع المقيّد».", "Settings → Digital wellbeing → “Restricted mode”."),
        ]),
        Tip(app: tr("سناب شات", "Snapchat"), icon: "bubble.left", lines: [
            tr("ابقَ في الدردشة والقصص؛ تبويبا Discover وSpotlight هما المحتوى المقترح.", "Stay in Chat and Stories; Discover and Spotlight are the suggested content."),
        ]),
        Tip(app: tr("عام", "General"), icon: "checkmark.shield", lines: [
            tr("ألغِ متابعة أي حساب يجرّ إليك اقتراحات لا تريدها؛ الاقتراحات تُبنى على من تتابع وما توقفت عنده.", "Unfollow any account that drags unwanted suggestions; suggestions are built on who you follow and where you pause."),
            tr("حصن يحجب ما يصل، لكن تقليل ما يصل أصلًا أهدأ للعين والجهاز.", "Hisn blocks what arrives, but reducing what arrives in the first place is easier on the eye and the device."),
        ]),
    ]

    var body: some View {
        List(tips) { t in
            Section {
                ForEach(t.lines, id: \.self) { Text($0).textSelection(.enabled) }
            } header: { Label(t.app, systemImage: t.icon) }
        }
        .navigationTitle(tr("نصائح لتصفح أنظف", "Tips for a cleaner feed"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
