import CryptoKit
import Foundation

// "Remind me to get the milk" goes to Apple's Reminders, and no other app can take
// that over. So Todos collects from there: plain reminders in the default list move
// to the Inbox. These are the rules, with no Reminders access here so they can be
// tested.

enum ReminderRules {
    /// Anything that needs to alert you stays in Reminders, since Todos doesn't send
    /// alerts: a date, a time, a place or a repeat.
    static func shouldMove(title: String?, hasDate: Bool, hasAlarm: Bool, repeats: Bool) -> Bool {
        guard let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return !hasDate && !hasAlarm && !repeats
    }

    /// The same reminder gets the same to-do id on every device, so if the phone and
    /// the Mac both catch it, it's still one to-do.
    static func todoID(forReminder identifier: String) -> String {
        let hash = Array(SHA256.hash(data: Data("reminder:\(identifier)".utf8)).prefix(16))
        var bytes = hash
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        let parts = [hex.prefix(8), hex.dropFirst(8).prefix(4), hex.dropFirst(12).prefix(4), hex.dropFirst(16).prefix(4), hex.dropFirst(20)]
        return parts.joined(separator: "-")
    }
}
