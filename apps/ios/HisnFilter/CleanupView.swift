import SwiftUI
import UserNotifications
import WebKit

/// «تنظيف الحساب»: إلغاء الإعجابات وإزالة إعادات النشر من حساب المستخدم نفسه، داخل متصفح حصن،
/// بدفعات مع استراحة (الموقع يوقف الحساب مؤقتًا عند الإفراط) وتذكير بعد الاستراحة. التنفيذ في cleanup.js.
@MainActor
final class CleanupState: ObservableObject {
    static let shared = CleanupState()
    struct Task: Equatable { var platform: String; var kind: String; var batch: Int; var username: String; var dryRun: Bool }
    @Published var task: Task?
    @Published var phase = "" // started | progress | paused | finished | stopped | error | ""
    @Published var done = 0
    @Published var batchDone = 0
    @Published var note = ""
    @Published var pausedAt: Date?
    var active: Bool { task != nil && phase != "finished" && phase != "stopped" && phase != "error" }
    static let notifyID = "hisn.cleanup.resume"

    func start(_ t: Task) {
        task = t; phase = "started"; done = 0; batchDone = 0; note = ""; pausedAt = nil
        HisnLog.write("cleanup: start \(t.platform)/\(t.kind) batch=\(t.batch) dry=\(t.dryRun)")
    }
    func stopAll() { phase = "stopped"; task = nil }

    /// رسالة تقدم من سكربت الصفحة
    func receive(_ m: [String: Any]) {
        let st = m["state"] as? String ?? ""
        phase = st
        done = m["done"] as? Int ?? done
        batchDone = m["batchDone"] as? Int ?? batchDone
        note = m["note"] as? String ?? ""
        if st == "paused" { pausedAt = Date(); scheduleReminder() }
        if st == "finished" || st == "error" || st == "stopped" { UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.notifyID]) }
        HisnLog.write("cleanup: \(st) done=\(done) \(note)")
    }

    /// تذكير إيجابي بعد ربع ساعة من استراحة الدفعة
    private func scheduleReminder() {
        guard let t = task else { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        center.removePendingNotificationRequests(withIdentifiers: [Self.notifyID])
        let c = UNMutableNotificationContent()
        let what = t.kind == "likes" ? tr("إعجاب", "likes") : t.kind == "subs" ? tr("اشتراك", "subscriptions") : t.kind == "comments" ? tr("تعليق", "comments") : t.kind == "posts" ? tr("منشور", "posts") : tr("إعادة نشر", "reposts")
        c.title = tr("أحسنتِ — أُلغي \(done) \(what) ✅", "Well done — \(done) \(what) removed ✅")
        c.body = tr("انتهت الاستراحة. افتحي حصن للمتابعة من حيث توقفنا.", "Break is over. Open Hisn to continue where we stopped.")
        c.sound = .default
        center.add(UNNotificationRequest(identifier: Self.notifyID, content: c, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 15 * 60, repeats: false)))
    }

    /// أمر البدء/المتابعة لسكربت الصفحة (في عالم حصن المعزول)
    func kick(_ web: WKWebView?) {
        guard let web, let t = task, active, phase != "paused" else { return }
        let opts: [String: Any] = ["platform": t.platform, "kind": t.kind, "batch": t.batch, "username": t.username, "dryRun": t.dryRun, "done": done, "batchDone": batchDone]
        guard let data = try? JSONSerialization.data(withJSONObject: opts), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("globalThis.__hisnCleanup && globalThis.__hisnCleanup(\(json))", in: nil, in: .defaultClient) { r in
            if case .success(let v) = r, let s = v as? String { HisnLog.write("cleanup: kick → \(s)") }
        }
    }
    func resumeAfterBreak(_ web: WKWebView?) { phase = "started"; pausedAt = nil; batchDone = 0; kick(web) }
    func stop(_ web: WKWebView?) {
        web?.evaluateJavaScript("globalThis.__hisnCleanupStop && globalThis.__hisnCleanupStop()", in: nil, in: .defaultClient) { _ in }
        stopAll()
    }
}

struct CleanupView: View {
    @ObservedObject private var st = CleanupState.shared
    @State private var platformID = "instagram"
    @State private var kind = "likes"
    @State private var ttUser = HisnSettings.ttUsername
    @State private var batch = 200
    @State private var username = HisnSettings.igUsername
    @State private var open: Platform?
    @State private var showConfirm = false

    var body: some View {
        Form {
            Section {
                Text(tr("تحذف من حسابك أنتِ، داخل متصفح حصن، ما تراكم من إعجابات وإعادات نشر لمقاطع لم تعودي تريدينها — كأنك تضغطين بيدك لكن بلا تعب. لا كلمات سر، ولا شيء يخرج من الجهاز.",
                        "Removes, from your own account inside Hisn's browser, the likes and reposts you no longer want — as if you tapped them yourself, without the effort. No passwords, nothing leaves the device."))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section(tr("ماذا نزيل", "What to remove")) {
                Picker(tr("المنصة", "Platform"), selection: $platformID) {
                    Text(tr("إنستغرام", "Instagram")).tag("instagram")
                    Text(tr("يوتيوب", "YouTube")).tag("youtube")
                    Text(tr("تيك توك", "TikTok")).tag("tiktok")
                    Text(tr("فيسبوك", "Facebook")).tag("facebook")
                }.pickerStyle(.segmented)
                .onChange(of: platformID) { _, _ in kind = "likes" }
                Picker(tr("النوع", "Type"), selection: $kind) {
                    Text(tr("الإعجابات", "Likes")).tag("likes")
                    if platformID == "youtube" { Text(tr("الاشتراكات", "Subscriptions")).tag("subs") }
                    else if platformID == "facebook" {
                        Text(tr("التعليقات", "Comments")).tag("comments")
                        Text(tr("المنشورات", "Posts")).tag("posts")
                    }
                    else { Text(tr("إعادات النشر", "Reposts")).tag("reposts") }
                }.pickerStyle(.segmented)
                if platformID == "instagram" && kind == "reposts" {
                    TextField(tr("اسم المستخدم في إنستغرام (بدون @)", "Instagram username (without @)"), text: $username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: username) { _, v in HisnSettings.igUsername = v.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "@", with: "") }
                }
                if platformID == "tiktok" {
                    TextField(tr("اسم المستخدم في تيك توك (بدون @)", "TikTok username (without @)"), text: $ttUser)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: ttUser) { _, v in HisnSettings.ttUsername = v.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "@", with: "") }
                    Text(tr("سجّلي الدخول في تيك توك داخل حصن أولًا، واجعلي قائمة الإعجابات ظاهرة لك في ملفك.", "Sign in to TikTok inside Hisn first."))
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Picker(tr("حجم الدفعة", "Batch size"), selection: $batch) {
                    Text("100").tag(100); Text("200").tag(200); Text("300").tag(300)
                }
                Text(tr("بعد كل دفعة يتوقف ربع ساعة ويذكّرك بإشعار — حتى لا يوقف إنستغرام حسابك مؤقتًا.",
                        "After each batch it pauses 15 minutes and reminds you — so Instagram doesn't temporarily restrict your account."))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                Button {
                    showConfirm = true
                } label: {
                    Label(tr("ابدأ التنظيف", "Start cleaning"), systemImage: "sparkles")
                }
                .disabled((platformID == "instagram" && kind == "reposts" && username.isEmpty) || (platformID == "tiktok" && ttUser.isEmpty))
                if st.task != nil {
                    HStack {
                        Text(statusText).font(.footnote).foregroundStyle(.secondary)
                        Spacer()
                        Button(tr("إيقاف", "Stop"), role: .destructive) { st.stopAll() }.font(.footnote)
                    }
                }
            } footer: {
                Text(tr("يعمل فقط والشاشة مفتوحة على الصفحة. إن غيّرت المنصة أزرارها يتوقف ويخبرك بدل أن يعبث. سجل مشاهدة يوتيوب يُحذف كاملًا من «سجل النشاط» في حساب قوقل (زر حذف رسمي).",
                        "Works only while the page is open on screen. If the platform changes its buttons it stops and tells you instead of guessing. YouTube watch history can be deleted entirely from Google's My Activity."))
            }
        }
        .navigationTitle(tr("تنظيف الحساب", "Account cleanup"))
        .confirmationDialog(tr("سيُلغى ما تراكم في حسابك من \(kindAr) على دفعات. لا يمكن التراجع.", "This removes your accumulated \(kind) in batches. This cannot be undone."), isPresented: $showConfirm, titleVisibility: .visible) {
            Button(tr("ابدأ", "Start")) {
                st.start(.init(platform: platformID, kind: kind, batch: batch, username: platformID == "tiktok" ? HisnSettings.ttUsername : HisnSettings.igUsername, dryRun: false))
                open = Platform.builtIn.first { $0.id == platformID }
            }
            Button(tr("إلغاء", "Cancel"), role: .cancel) {}
        }
        .navigationDestination(item: $open) { ProtectedBrowserView(platform: $0) }
    }

    private var kindAr: String { kind == "likes" ? "إعجابات" : kind == "subs" ? "اشتراكات" : kind == "comments" ? "تعليقات" : kind == "posts" ? "منشورات" : "إعادات نشر" }

    private var statusText: String {
        switch st.phase {
        case "paused": return tr("استراحة: أُلغي \(st.done) حتى الآن — نذكّرك بعد ربع ساعة", "Break: \(st.done) removed so far — reminder in 15 min")
        case "finished": return tr("انتهى: أُلغي \(st.done) ولم يبقَ شيء", "Done: \(st.done) removed, nothing left")
        case "error": return tr("توقف: \(st.note) — ربما تغيّرت الصفحة، سنحدّث الأداة", "Stopped: \(st.note) — the page may have changed; we'll update the tool")
        default: return tr("يعمل: أُلغي \(st.done)", "Running: \(st.done) removed")
        }
    }
}
