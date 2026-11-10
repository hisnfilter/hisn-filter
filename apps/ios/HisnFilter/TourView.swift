import SwiftUI

/// جولة قصيرة بعد الإعداد الأول: أربع بطاقات تشرح الشاشة الرئيسية بنقاط بسيطة. تُعرض مرة واحدة،
/// ويمكن إعادتها من «الأسئلة الشائعة والأمان».
struct TourView: View {
    var done: () -> Void
    @State private var page = 0
    @State private var authorized = ProtectionSetup.authorized
    @State private var safariHelp = false
    @State private var authError: String?

    private struct Card { let icon: String; let title: String; let lines: [String]; var setup = false }
    private var cards: [Card] {
        [
            Card(icon: "person.2.fill",
                 title: tr("الوضعية", "Mode"),
                 lines: [tr("أعلى الشاشة: من يستخدم الجوال (رجل / امرأة) ومستوى الحماية.", "At the top: who uses the phone (man / woman) and the protection level."),
                         tr("«وضع الطفل» مفتاح واحد يشغّل كل حمايات الطفل معًا.", "“Child mode” is one switch that turns on every child protection at once.")]),
            Card(icon: "square.grid.2x2.fill",
                 title: tr("قائمة التطبيقات", "Apps list"),
                 lines: [tr("إنستغرام وتيك توك ويوتيوب وغيرها تُفتح من هنا داخل حصن، بكل الحماية.", "Instagram, TikTok, YouTube and more open from here inside Hisn, fully protected."),
                         tr("اضغط مطولًا على تطبيق لحذفه من القائمة، و«أضف موقعًا» لأي موقع آخر.", "Long-press an app to remove it; “Add site” for any other website.")]),
            Card(icon: "video.badge.checkmark",
                 title: tr("تنظيف الفيديو", "Clean a video"),
                 lines: [tr("وصول سريع من البطاقة البنفسجية: يحذف الموسيقى من أي مقطع ويبقي الكلام، ويحفظه في الصور.", "Quick access from the purple card: removes music from any video, keeps the speech, saves it to Photos."),
                         tr("كل المعالجة على جهازك، بلا إنترنت.", "All processing happens on your phone, offline.")]),
            Card(icon: "lock.shield.fill",
                 title: tr("القفل والإعدادات", "Lock & settings"),
                 lines: [tr("ضع رمز قفل من الإعدادات: أي تخفيف للحماية يطلب الرمز.", "Set a lock code in Settings: relaxing any protection asks for the code."),
                         tr("«التطبيقات المقفلة» تقفل التطبيقات الأصلية (إنستغرام، نتفلكس…) حتى لا تُفتح إلا بالرمز.", "“Locked apps” locks the native apps (Instagram, Netflix…) so they open only with the code.")]),
            Card(icon: "iphone.and.arrow.forward",
                 title: tr("خارج حصن", "Outside Hisn"),
                 lines: [tr("«فعّل الحماية»: يحجب المواقع الإباحية في الجوال كله (سفاري وكروم وأي تطبيق). يطلب الآيفون موافقتك مرة واحدة.", "“Turn on protection” blocks adult sites on the whole phone (Safari, Chrome, any app). iPhone asks once."),
                         tr("«الحماية في Safari»: تفلتر الصور والمقاطع داخل سفاري نفسه. خطوتان في إعدادات الآيفون، مرة واحدة.", "“Protection in Safari” filters images and videos inside Safari itself. Two steps in iPhone Settings, once."),
                         tr("يمكن فعلهما لاحقًا من الإعدادات.", "Both can be done later from Settings.")],
                 setup: true),
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $page) {
                ForEach(Array(cards.enumerated()), id: \.offset) { i, c in
                    VStack(spacing: 18) {
                        Spacer()
                        Image(systemName: c.icon)
                            .font(.system(size: 56)).foregroundStyle(Color.brand)
                            .frame(width: 120, height: 120)
                            .background(Color.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: 28))
                        Text("\(i + 1) / \(cards.count) · \(c.title)").font(.title2.bold())
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(c.lines, id: \.self) { l in
                                HStack(alignment: .top, spacing: 8) {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.brand).padding(.top, 2)
                                    Text(l).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.horizontal, 28)
                        if c.setup {
                            VStack(spacing: 10) {
                                if authorized {
                                    Label(tr("الحماية تعمل في الجوال كله", "Protection is on for the whole phone"), systemImage: "checkmark.seal.fill").foregroundStyle(Color.brand)
                                } else if !ProtectionSetup.available {
                                    Text(tr("لحجب المواقع خارج حصن: «قيود المحتوى» في إعدادات الآيفون (الشرح في الإعدادات).", "To block sites outside Hisn: Content Restrictions in iPhone Settings (guide in Settings)."))
                                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                                } else {
                                    Button { Task { authError = await ProtectionSetup.authorize(); authorized = ProtectionSetup.authorized } } label: {
                                        Label(tr("فعّل الحماية", "Turn on protection"), systemImage: "shield.lefthalf.filled").frame(maxWidth: .infinity, minHeight: 40)
                                    }.buttonStyle(.borderedProminent)
                                }
                                Button { HisnSettings.safariSetupSeen = true; ProtectionSetup.openSafariSettings { safariHelp = true } } label: {
                                    Label(tr("الحماية في Safari", "Protection in Safari"), systemImage: "safari").frame(maxWidth: .infinity, minHeight: 40)
                                }.buttonStyle(.bordered)
                                if let e = authError { Text(e).font(.footnote).foregroundStyle(.red) }
                            }
                            .padding(.horizontal, 28)
                        }
                        Spacer()
                        Spacer()
                    }
                    .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))

            HStack {
                Button(tr("تخطّي", "Skip")) { finish() }.foregroundStyle(.secondary)
                Spacer()
                Button(page == cards.count - 1 ? tr("ابدأ", "Start") : tr("التالي", "Next")) {
                    if page < cards.count - 1 { withAnimation { page += 1 } } else { finish() }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 24).padding(.bottom, 20)
        }
        .background(Color(uiColor: .systemBackground))
        .sheet(isPresented: $safariHelp) { SafariHelpSheet() }
    }

    private func finish() {
        HisnSettings.toured = true
        done()
    }
}
