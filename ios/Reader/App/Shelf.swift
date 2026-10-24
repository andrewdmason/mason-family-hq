import Foundation
import MasonKit
import Observation
import Supabase

/// A book or article on the shelf: reading_books, with its content's state and
/// how far in you are. The same rows the website's shelf reads
/// (getReadingHome in src/app/(reading)/reader/actions.ts).
struct ShelfBook: Codable, Identifiable, Hashable {
    let id: UUID
    let type: String?
    let title: String
    let author: String?
    let site_name: String?
    let excerpt: String?
    let word_count: Int?
    let status: String
    let cover_image_url: String?
    let sort_order: Double?
    let created_at: Date
    /// reading_book_content.status: ready, processing, uploaded, failed; nil
    /// when no file has been added yet.
    var content: String?
    /// 0…1 through the book (reading_book_state.last_scroll_ratio).
    var progress: Double?
    var lastReadAt: Date?

    var isArticle: Bool { type == "article" }
    var isReady: Bool { content == "ready" }
    var readPath: String { "/reader/\(id.uuidString.lowercased())/read" }
}

/// The shelf's tabs, the website's book statuses (src/lib/reading/status.ts).
/// Paused books show under Reading, as the website's collapsed Paused section.
enum ShelfTab: String, CaseIterable, Identifiable {
    case reading = "in_progress"
    case queue = "queued"
    case archive

    var id: String { rawValue }
    var label: String {
        switch self {
        case .reading: "Reading"
        case .queue: "Queue"
        case .archive: "Archive"
        }
    }
}

enum ShelfOrder {
    /// The books in a tab, in the website's order (sort_order, then when
    /// added); Reading also gets the paused books after.
    static func books(_ all: [ShelfBook], in tab: ShelfTab) -> (main: [ShelfBook], paused: [ShelfBook]) {
        let ordered = all.sorted {
            ($0.sort_order ?? .greatestFiniteMagnitude, $0.created_at) < ($1.sort_order ?? .greatestFiniteMagnitude, $1.created_at)
        }
        let main = ordered.filter { $0.status == tab.rawValue }
        let paused = tab == .reading ? ordered.filter { $0.status == "paused" } : []
        return (main, paused)
    }

    /// The tab that opens first: Reading when it has anything, else Queue.
    static func firstTab(_ all: [ShelfBook]) -> ShelfTab {
        all.contains { $0.status == ShelfTab.reading.rawValue } ? .reading : .queue
    }

    /// The books kept on the device: everything being read, then the most
    /// recently opened, up to `limit` beyond those. Only ones that can open.
    static func keepOffline(_ all: [ShelfBook], limit: Int = 5) -> [ShelfBook] {
        let ready = all.filter(\.isReady)
        let reading = ready.filter { $0.status == ShelfTab.reading.rawValue }
        let recent = ready
            .filter { $0.lastReadAt != nil && $0.status != ShelfTab.archive.rawValue }
            .sorted { $0.lastReadAt! > $1.lastReadAt! }
            .filter { book in !reading.contains { $0.id == book.id } }
            .prefix(limit)
        return reading + recent
    }

    /// Where opening the app goes, by the website's rule
    /// (src/lib/reading/last-place.ts): the book you were last in, unless you
    /// went back to the shelf after it, or another book has been read since
    /// (on any device).
    static func resume(place: LastPlace?, books: [ShelfBook]) -> ShelfBook? {
        let candidates = books
            .filter { $0.isReady && $0.status != ShelfTab.archive.rawValue && $0.lastReadAt != nil }
            .sorted { $0.lastReadAt! > $1.lastReadAt! }
        guard let newest = candidates.first else { return nil }
        switch place {
        case nil:
            return newest
        case .shelf(let at):
            return newest.lastReadAt! > at ? newest : nil
        case .book(let id, _):
            return candidates.first { $0.id == id }.map { kept in
                newest.lastReadAt! > kept.lastReadAt! ? newest : kept
            } ?? newest
        }
    }
}

/// The last place in the app: the shelf, or a book. Kept on the device, like
/// the website's reader-place cookie.
enum LastPlace: Codable, Equatable {
    case shelf(at: Date)
    case book(UUID, at: Date)

    private static let key = "reader.lastPlace"

    static var saved: LastPlace? {
        get {
            UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(LastPlace.self, from: $0) }
        }
        set {
            UserDefaults.standard.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: key)
        }
    }
}

/// The shelf: loaded from Supabase, kept on disk so it shows with no signal.
@MainActor
@Observable
final class ShelfStore {
    static let shared = ShelfStore()

    private(set) var books: [ShelfBook] = []
    private(set) var loaded = false
    private(set) var offline = false
    /// Books whose text is on the device, as the website's offline store
    /// last reported (Offline).
    var onDevice: Set<UUID> = Set(
        (UserDefaults.standard.stringArray(forKey: "reader.onDevice") ?? []).compactMap(UUID.init)
    ) {
        didSet { UserDefaults.standard.set(onDevice.map(\.uuidString), forKey: "reader.onDevice") }
    }

    private let file = URL.applicationSupportDirectory.appending(path: "shelf.json")

    private init() {
        if let data = try? Data(contentsOf: file), let saved = try? Self.decoder.decode([ShelfBook].self, from: data) {
            books = saved
            loaded = true
        }
    }

    func refresh() async {
        guard let userID = Session.shared.userID else { return }
        let db = Session.shared.client
        let user = userID.uuidString.lowercased()
        struct Content: Decodable { let book_id: UUID; let status: String }
        struct State: Decodable { let book_id: UUID; let last_scroll_ratio: Double?; let last_read_at: Date? }
        do {
            async let rowsQuery: [ShelfBook] = db.from("reading_books")
                .select("id, type, title, author, site_name, excerpt, word_count, status, cover_image_url, sort_order, created_at")
                .eq("user_id", value: user)
                .execute().value
            async let contentQuery: [Content] = db.from("reading_book_content")
                .select("book_id, status")
                .eq("user_id", value: user)
                .execute().value
            async let stateQuery: [State] = db.from("reading_book_state")
                .select("book_id, last_scroll_ratio, last_read_at")
                .eq("user_id", value: user)
                .execute().value
            let (rows, contents, states) = try await (rowsQuery, contentQuery, stateQuery)
            let contentByID = Dictionary(contents.map { ($0.book_id, $0.status) }, uniquingKeysWith: { a, _ in a })
            let stateByID = Dictionary(states.map { ($0.book_id, $0) }, uniquingKeysWith: { a, _ in a })
            books = rows.map { row in
                var book = row
                book.content = contentByID[row.id]
                book.progress = stateByID[row.id]?.last_scroll_ratio
                book.lastReadAt = stateByID[row.id]?.last_read_at
                return book
            }
            loaded = true
            offline = false
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? Self.encoder.encode(books).write(to: file, options: .atomic)
        } catch {
            offline = true
            loaded = true
        }
    }

    func book(_ id: UUID) -> ShelfBook? { books.first { $0.id == id } }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
