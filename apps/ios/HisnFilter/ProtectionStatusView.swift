import SwiftUI
import WebKit

/// أعداد الصفحة الحالية من سكربت حصن (بلا محتوى)
struct PageStatus: Equatable {
    var active = true, hidden = 0, partial = 0, error = 0, pending = 0, folded = 0, songMuted = 0, earMuted = 0, revealed = 0

    @MainActor
    static func fetch(_ web: WKWebView?, _ done: @escaping (PageStatus?) -> Void) {
        guard let web else { return done(nil) }
        web.evaluateJavaScript("globalThis.__hisnStatus ? globalThis.__hisnStatus() : null", in: nil, in: .defaultClient) { r in
            guard case .success(let v) = r, let s = v as? String, let d = s.data(using: .utf8),
                  let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return done(nil) }
            func n(_ k: String) -> Int { o[k] as? Int ?? 0 }
            done(PageStatus(active: o["active"] as? Bool ?? true, hidden: n("hidden"), partial: n("partial"), error: n("error"), pending: n("pending"),
                            folded: n("folded"), songMuted: n("songMuted"), earMuted: n("earMuted"), revealed: n("revealed")))
        }
    }
}

/// «حالة الحماية هنا»: ما يعمل فعلًا في هذه الصفحة، وما تعذّر، وحدود الحماية — بصدق وبلا تفاصيل تقنية.
struct ProtectionStatusView: View {
    let web: WKWebView?
    let host: String
    @State private var page: PageStatus?
    @State private var retried: Int?
    @Environment(\.dismiss) private var dismiss

    private var engine: String { NativeDetector.state }
    private var isYouTube: Bool { host.contains("youtube") }
    private var isX: Bool { host == "x.com" || host.hasSuffix(".x.com") || host.contains("twitter.com") }
    private var isReddit: Bool { host.contains("reddit.com") }

    var body: some View {
        NavigationStack {
            List {
                Section(tr("في هذه الصفحة", "On this page")) {
                    if let p = page {
                        if !p.active {
                            row("pause.circle", .secondary, tr("الحماية متوقفة في هذا الموقع", "Protection is paused on this site"), nil)
                        } else {
                            row("eye.slash", .brand, tr("مُغطّى: \(p.hidden) · مُغطّى جزئيًا: \(p.partial) · منشورات مطوية: \(p.folded)", "Covered: \(p.hidden) · partly covered: \(p.partial) · folded posts: \(p.folded)"), nil)
                            if p.pending > 0 { row("hourglass", .secondary, tr("قيد الفحص: \(p.pending)", "Being checked: \(p.pending)"), nil) }
                            if p.songMuted + p.earMuted > 0 { row("speaker.slash", .brand, tr("مقاطع كُتمت لأنها أغانٍ أو موسيقى: \(p.songMuted + p.earMuted)", "Clips muted as songs/music: \(p.songMuted + p.earMuted)"), nil) }
                            if p.revealed > 0 { row("eye", .secondary, tr("أظهرتِه بنفسك: \(p.revealed)", "Shown by you: \(p.revealed)"), nil) }
                            if p.error > 0 {
                                row("exclamationmark.triangle.fill", .orange, tr("تعذّر فحص \(p.error) — بقي مغطى احتياطًا، وليس حكمًا بأنه مخالف", "\(p.error) couldn't be checked — kept covered as a precaution, not judged as violating"), nil)
                                Button(tr("أعد فحص ما تعذّر", "Re-check what failed")) { retry() }
                            }
                            if let r = retried { Text(tr("أُعيد فحص \(r).", "\(r) re-checked.")).font(.footnote).foregroundStyle(.secondary) }
                        }
                    } else {
                        row("questionmark.circle", .secondary, tr("لم تُقرأ حالة الصفحة (ربما ما زالت تُحمّل).", "Couldn't read the page status (it may still be loading)."), nil)
                    }
                }

                Section(tr("طبقات الحماية", "Protection layers")) {
                    switch engine {
                    case "ready": row("checkmark.circle.fill", .green, tr("الصور والمقاطع: تعمل", "Images & videos: working"), nil)
                    case "failed": row("xmark.octagon.fill", .red, tr("الصور والمقاطع: المحرك متعذّر — كل شيء يبقى مغطى", "Images & videos: engine failed — everything stays covered"), tr("افتحي «الإعدادات ← فحص الحماية».", "Open Settings → Protection check."))
                    default: row("hourglass", .secondary, tr("الصور والمقاطع: يُحمّل المحرك…", "Images & videos: engine loading…"), tr("حتى يجهز يبقى المحتوى مغبّشًا.", "Until ready, content stays blurred."))
                    }
                    row("text.badge.checkmark", .green, tr("النصوص والألفاظ: تعمل", "Text & words: working"), nil)
                    if HisnSettings.childMode || HisnSettings.level != .light {
                        row("music.note", .green, tr("كتم مقاطع الأغاني (باسم الصوت): يعمل", "Muting song clips (by sound name): working"), nil)
                    } else {
                        row("music.note", .secondary, tr("كتم مقاطع الأغاني: مطفأ في المستوى المخفف", "Muting song clips: off at Light level"), nil)
                    }
                    if HisnSettings.muteMusicByEar {
                        row("ear", .green, tr("كتم الموسيقى بالسماع: يعمل", "Muting music by listening: working"),
                            isYouTube ? tr("في يوتيوب: بتصنيف يوتيوب «موسيقى» والعنوان فقط (لا يمكن سماع صوته داخل المتصفح).", "On YouTube: by YouTube's Music category and title only.") : nil)
                    } else {
                        row("ear", .secondary, tr("كتم الموسيقى بالسماع: مطفأ", "Muting music by listening: off"), tr("يُفعَّل من الإعدادات ← الصوت.", "Turn on in Settings → Audio."))
                    }
                    row("waveform.badge.minus", .secondary, tr("إزالة الموسيقى مع إبقاء الكلام: غير متاحة أثناء التصفح", "Removing music but keeping speech: not available while browsing"),
                        tr("متاحة لمقاطعك المحفوظة في «تنظيف فيديو».", "Available for your saved clips in “Clean a video”."))
                    if isX { row("checkmark.shield", HisnSettings.protectX ? .green : .secondary, HisnSettings.protectX ? tr("حماية إكس: تعمل", "X protection: working") : tr("حماية إكس: مطفأة", "X protection: off"), nil) }
                    if isReddit { row("checkmark.shield", HisnSettings.protectReddit ? .green : .secondary, HisnSettings.protectReddit ? tr("حماية ريديت: تعمل", "Reddit protection: working") : tr("حماية ريديت: مطفأة", "Reddit protection: off"), nil) }
                }

                Section {
                    Text(tr("هذه الحماية داخل متصفح حصن. في سفاري تعمل إضافة حصن إن فعّلتِها. التطبيقات الأخرى (إنستغرام وتيك توك الأصليان…) لا يصل إليها الفلتر؛ يقفلها «وقت الشاشة» أو يراقبها «فحص الشاشة».",
                            "This protection works inside Hisn's browser. In Safari, Hisn's extension works if you enable it. Other apps (the original Instagram, TikTok…) aren't filtered; Screen Time locks them, or Screen Scan watches them."))
                        .font(.footnote).foregroundStyle(.secondary)
                } header: { Text(tr("أين تعمل الحماية", "Where protection works")) }
            }
            .navigationTitle(tr("حالة الحماية هنا", "Protection here"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(tr("تم", "Done")) { dismiss() } } }
            .onAppear { refresh() }
        }
    }

    private func refresh() { PageStatus.fetch(web) { page = $0 } }
    private func retry() {
        web?.evaluateJavaScript("globalThis.__hisnRetryErrors ? globalThis.__hisnRetryErrors() : 0", in: nil, in: .defaultClient) { r in
            if case .success(let v) = r { retried = v as? Int ?? 0 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { refresh() }
        }
    }

    private func row(_ icon: String, _ color: Color, _ title: String, _ sub: String?) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundStyle(color).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline)
                if let sub { Text(sub).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
}
