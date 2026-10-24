import Foundation

// The quick logger's rules, ported from the website so a tap means the same
// thing on either: src/lib/practice/quick-log.ts and maintenance.ts. Keep the
// two in step. Pure functions only, so the tests can cover them.

struct Piece: Codable, Identifiable, Hashable {
    let id: UUID
    let workID: UUID?
    let name: String
    let composer: String?
    /// technique · sight_reading · piece
    let kind: String
    let maintenance: Bool
    /// Stands for its whole work while the work isn't tracked by movement
    /// (migration 00206).
    var wholeWork = false

    enum CodingKeys: String, CodingKey {
        case id, name, composer, kind, maintenance
        case workID = "work_id"
        case wholeWork = "whole_work"
    }
}

extension Piece {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        workID = try c.decodeIfPresent(UUID.self, forKey: .workID)
        name = try c.decode(String.self, forKey: .name)
        composer = try c.decodeIfPresent(String.self, forKey: .composer)
        kind = try c.decode(String.self, forKey: .kind)
        maintenance = try c.decode(Bool.self, forKey: .maintenance)
        // Absent until the migration is in.
        wholeWork = try c.decodeIfPresent(Bool.self, forKey: .wholeWork) ?? false
    }
}

/// A multi-movement work, and whether it's logged movement by movement.
struct Work: Decodable, Identifiable {
    let id: UUID
    let name: String
    let trackByMovement: Bool

    enum CodingKeys: String, CodingKey {
        case id, name
        case trackByMovement = "track_by_movement"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        trackByMovement = try c.decodeIfPresent(Bool.self, forKey: .trackByMovement) ?? true
    }
}

/// Where a piece sits, as the long-press sheet offers it. Maintenance is an
/// active piece with the rotation flag on (migration 00194), not a status.
enum PieceListing: String, CaseIterable, Identifiable {
    case active, maintenance, archived
    var id: String { rawValue }

    init(_ piece: Piece) { self = piece.maintenance ? .maintenance : .active }

    var label: String {
        switch self {
        case .active: "Active"
        case .maintenance: "Maintenance"
        case .archived: "Archive"
        }
    }
}

/// The columns of a practice_tasks row the quick logger reads.
struct PracticeTask: Codable, Identifiable, Hashable {
    let id: UUID
    let pieceID: UUID?
    var timerSeconds: Int
    var timerRemainingSeconds: Int
    var completed: Bool
    var startedAt: Date?
    var endedAt: Date?
    var createdAt: Date
    var sessionNumber: Int
    /// What it says to work on, shown under the piece's name.
    var text: String = ""

    enum CodingKeys: String, CodingKey {
        case id, completed, text
        case pieceID = "piece_id"
        case timerSeconds = "timer_seconds"
        case timerRemainingSeconds = "timer_remaining_seconds"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case createdAt = "created_at"
        case sessionNumber = "session_number"
    }

    /// Seconds of practice it holds, never negative.
    var elapsedSeconds: Int { max(0, timerSeconds - timerRemainingSeconds) }
}

/// One card. A work with several active pieces (a trio's movements) is one
/// card split into a segment per piece; anything else is a card of one.
struct QuickCard: Identifiable, Hashable {
    let key: String
    let title: String
    /// In display order. More than one means a segmented card.
    let pieces: [Piece]
    var id: String { key }
}

enum QuickLog {
    /// The active pieces to show, following each work's "Track by movement"
    /// switch: a work tracked by movement shows its movements; one that isn't
    /// shows its whole-work piece instead. visibleActivePieces on the website.
    static func visiblePieces(_ pieces: [Piece], wholeWorkIDs: Set<UUID>) -> [Piece] {
        pieces.filter { piece in
            if let work = piece.workID, wholeWorkIDs.contains(work) { return piece.wholeWork }
            return !piece.wholeWork
        }
    }

    private static let kindOrder = ["technique": 0, "sight_reading": 1, "piece": 2]

    /// JavaScript's `localeCompare(b, undefined, { numeric: true })`, near
    /// enough: "No. 2" before "No. 10".
    static func numericLess(_ a: String, _ b: String) -> Bool {
        a.localizedStandardCompare(b) == .orderedAscending
    }

    /// The cards, split into what's being learned and the keep-it-warm
    /// rotation. The order is fixed (by kind, then name) so a card never moves
    /// out from under a finger as practice goes in. `activePieces` comes
    /// ordered by name, as the website loads them.
    static func cards(activePieces: [Piece], worksByID: [UUID: String]) -> (current: [QuickCard], maintenance: [QuickCard]) {
        var byWork: [UUID: [Piece]] = [:]
        for piece in activePieces {
            guard let work = piece.workID else { continue }
            byWork[work, default: []].append(piece)
        }

        var cards: [QuickCard] = []
        var seenWorks = Set<UUID>()
        for piece in activePieces {
            if let work = piece.workID, let siblings = byWork[work], siblings.count > 1 {
                guard seenWorks.insert(work).inserted else { continue }
                cards.append(QuickCard(
                    key: "work:\(work.uuidString.lowercased())",
                    title: worksByID[work] ?? piece.name,
                    pieces: siblings.sorted { numericLess($0.name, $1.name) }
                ))
            } else {
                cards.append(QuickCard(key: piece.id.uuidString.lowercased(), title: piece.name, pieces: [piece]))
            }
        }

        func rank(_ card: QuickCard) -> Int {
            card.pieces.map { kindOrder[$0.kind] ?? 2 }.min() ?? 2
        }
        // Stable: equal cards keep the order they came in.
        let sorted = cards.enumerated().sorted { l, r in
            let (a, b) = (l.element, r.element)
            if rank(a) != rank(b) { return rank(a) < rank(b) }
            if numericLess(a.title, b.title) { return true }
            if numericLess(b.title, a.title) { return false }
            return l.offset < r.offset
        }.map(\.element)

        // A card belongs to the rotation only when every piece on it does.
        let isMaintenance = { (card: QuickCard) in card.pieces.allSatisfy(\.maintenance) }
        return (sorted.filter { !isMaintenance($0) }, sorted.filter(isMaintenance))
    }

    /// Which of a piece's tasks today a tap should time: the first one still
    /// open, in the day's order; failing that, the one most recently worked
    /// on. Nil when the piece has nothing today and a tap should create one.
    static func taskToTime(_ tasks: [PracticeTask]) -> PracticeTask? {
        if let open = tasks.first(where: { !$0.completed }) { return open }
        var best: PracticeTask?
        var bestAt = Date.distantPast
        for task in tasks {
            let at = [task.endedAt, task.startedAt, task.createdAt].compactMap { $0 }.max() ?? .distantPast
            if best == nil || at >= bestAt {
                best = task
                bestAt = at
            }
        }
        return best
    }

    /// Whichever maintenance piece has gone longest without real practice,
    /// skipping pieces already on the day. Never-practiced pieces come first;
    /// ties break on name so the highlight doesn't flicker between pieces.
    static func dueMaintenance(pieces: [Piece], lastPracticed: [UUID: String], excluded: Set<UUID>, asOf: String) -> Piece? {
        var best: Piece?
        var bestRank = -Double.infinity
        for piece in pieces where piece.maintenance && !excluded.contains(piece.id) {
            let rank = lastPracticed[piece.id].map { Double(PracticeDay.daysBetween($0, asOf)) } ?? .infinity
            if rank > bestRank || (rank == bestRank && best != nil && piece.name.localizedCompare(best!.name) == .orderedAscending) {
                best = piece
                bestRank = rank
            }
        }
        return best
    }

    /// "45m", "1h 16m": the quiet total under a stopped card.
    static func total(_ seconds: Int) -> String {
        let minutes = max(0, seconds) / 60
        if minutes < 60 { return "\(minutes)m" }
        let (h, m) = (minutes / 60, minutes % 60)
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    /// "4:07", "1:16:05": the live clock on a running card.
    static func clock(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60)
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    /// "1d ago", "12d ago", "Never": the card's corner when it's not been
    /// played today.
    static func sinceShort(_ lastPracticed: String?, today: String) -> String {
        guard let lastPracticed else { return "Never" }
        let days = PracticeDay.daysBetween(lastPracticed, today)
        return days <= 0 ? "Today" : "\(days)d ago"
    }

    /// A movement's segment says just its number: "II" from "II. Adagio",
    /// "3" from "3. Finale", else its place on the card.
    static func movementLabel(_ name: String, index: Int) -> String {
        if let match = name.firstMatch(of: /^\s*([IVXLC]+|\d+)[.:)]/) { return String(match.1) }
        return "\(index + 1)"
    }

    /// "Yesterday", "12 days ago", "Never played": for a card not played today.
    static func daysSince(_ lastPracticed: String?, today: String) -> String {
        guard let lastPracticed else { return "Never played" }
        let days = PracticeDay.daysBetween(lastPracticed, today)
        if days <= 0 { return "Today" }
        if days == 1 { return "Yesterday" }
        return "\(days) days ago"
    }
}

/// Calendar days the way the website counts them (src/lib/date-utils.ts).
enum PracticeDay {
    /// The practice log's "today": the calendar date where the phone is.
    static func today(_ now: Date = .now, timeZone: TimeZone = .current) -> String {
        format(now, timeZone: timeZone)
    }

    /// Days before this are over. The practice day ends at 3am, not midnight,
    /// so a late session isn't archived out from under the timer; mirrors the
    /// website's rollover and the pg_cron schedule in migration 00197.
    static func rolloverCutoff(_ now: Date = .now, timeZone: TimeZone = .current) -> String {
        format(now.addingTimeInterval(-3 * 3600), timeZone: timeZone)
    }

    static func format(_ date: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// Whole days from one yyyy-MM-dd to another.
    static func daysBetween(_ from: String, _ to: String) -> Int {
        guard let a = parse(from), let b = parse(to) else { return 0 }
        return Int((b.timeIntervalSince(a) / 86_400).rounded())
    }

    private static func parse(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
