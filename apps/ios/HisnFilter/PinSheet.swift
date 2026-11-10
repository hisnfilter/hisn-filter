import SwiftUI

enum PinRequest: Identifiable {
    case create
    case verify(() -> Void)

    var id: String {
        switch self {
        case .create: return "create"
        case .verify: return "verify"
        }
    }
}

/// إدخال رمز القفل أو إنشاؤه. الحساب (PBKDF2) يتم خارج الخيط الرئيسي.
struct PinSheet: View {
    let request: PinRequest
    var done: (Bool) -> Void
    @State private var pin = ""
    @State private var error: String?
    @State private var working = false

    private var creating: Bool { if case .create = request { return true } else { return false } }

    var body: some View {
        NavigationStack {
            Form {
                Section(creating ? tr("الرمز الجديد (4 إلى 8 أرقام)", "New code (4 to 8 digits)") : tr("أدخل رمز القفل", "Enter the lock code")) {
                    SecureField(tr("الرمز", "Code"), text: $pin)
                        .keyboardType(.numberPad)
                        .font(.title2)
                        .multilineTextAlignment(.center)
                    if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                }
                Button(working ? tr("جارٍ التحقق…", "Checking…") : tr("تأكيد", "Confirm")) { submit() }
                    .disabled(working || !Pin.isValid(pin))
            }
            .navigationTitle(creating ? tr("رمز القفل", "Lock code") : tr("محمي برمز", "Locked"))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(tr("إلغاء", "Cancel")) { done(false) } } }
        }
        .presentationDetents([.medium])
    }

    private func submit() {
        working = true
        let value = pin
        DispatchQueue.global(qos: .userInitiated).async {
            if creating {
                let h = Pin.hash(value)
                DispatchQueue.main.async {
                    HisnSettings.pinHash = h.hash
                    HisnSettings.pinSalt = h.salt
                    Unlocks.revokeAll()
                    done(true)
                }
            } else {
                let r = Pin.attempt(value)
                DispatchQueue.main.async {
                    working = false
                    switch r {
                    case .ok: done(true)
                    case .wrong: error = tr("رمز غير صحيح", "Wrong code"); pin = ""
                    case .wait(let sec): error = tr("محاولات كثيرة، انتظر \(sec) ثانية", "Too many tries, wait \(sec)s"); pin = ""
                    }
                }
            }
        }
    }
}
