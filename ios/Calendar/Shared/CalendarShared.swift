import Foundation

/// What the app and its home screen widget both reach: the calendar's local
/// copy, members' photos, who's signed in, and this phone's choice of who
/// shows. It all sits in the app group's container; a build without the group
/// (unsigned, as in CI) falls back to the app's own folders, where the widget
/// can't see it.
enum CalendarShared {
    static let group = "group.io.mason.calendar"

    static let defaults = UserDefaults(suiteName: group) ?? .standard

    private static let folder: URL = {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
            ?? URL.applicationSupportDirectory
        let folder = base.appending(path: "Calendar")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }()

    /// A member's local copy of the calendar.
    static func copy(_ user: UUID) -> URL {
        folder.appending(path: "copy-\(user.uuidString.lowercased()).json")
    }

    static func photo(_ email: String) -> URL {
        let photos = folder.appending(path: "photos")
        try? FileManager.default.createDirectory(at: photos, withIntermediateDirectories: true)
        return photos.appending(path: email.replacingOccurrences(of: "/", with: "_") + ".img")
    }

    /// Whose calendar the widget shows: the member last signed in to the app.
    struct Who: Codable, Equatable {
        var user: UUID
        var email: String
    }

    static var who: Who? {
        get { defaults.data(forKey: "calendar.who").flatMap { try? JSONDecoder().decode(Who.self, from: $0) } }
        set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "calendar.who") }
    }

    /// The members with a column, in this phone's order (Settings › People).
    static func shown(_ members: [Member], order: [String], hidden: Set<String>) -> [Member] {
        let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        return members.enumerated()
            .sorted { a, b in (rank[a.element.email] ?? 1000 + a.offset) < (rank[b.element.email] ?? 1000 + b.offset) }
            .map(\.element)
            .filter { !hidden.contains($0.email) }
    }

    /// The same, read from what Settings saved.
    static func shown(_ members: [Member]) -> [Member] {
        shown(
            members, order: defaults.stringArray(forKey: "calendar.order") ?? [],
            hidden: Set(defaults.stringArray(forKey: "calendar.hidden") ?? [])
        )
    }
}
