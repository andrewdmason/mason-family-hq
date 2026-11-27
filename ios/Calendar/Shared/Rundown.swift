import Foundation

/// A day as stretches of one member's time: what's theirs to be at, and the
/// time between. (An experiment in the Mac applet, beside `Agenda`'s plain
/// list, which it's built from.)
///
/// - A **stop** takes their time: an event they're at, from when they leave
///   for it to when they're back if they're driving. An event they only
///   drive for isn't one stop but its drives: the drop-off and the pick-up
///   are each a stop, and the event itself is the family's, going on in the
///   time between.
/// - A **gap** is the time between two stops, when it's five minutes or more.
///   The day's two ends are gaps too, with no length: before the first stop
///   and after the last.
/// - Everyone else's events ride in a gap: the one they start in, or else
///   the first one they run on into. One wholly inside a stop stays under
///   that stop.
///
/// Each part is over, now or ahead, so the list can say where in the day the
/// member is: how long is left of this, or how long until the next.
struct Rundown: Sendable {
    /// A drive the member does for someone else's event.
    struct Leg: Hashable, Sendable {
        var duty: DutyKind
        /// "Drop off Sebastian".
        var title: String
        /// "4:30pm (18 min drive)": what the drive's own title says after that.
        var note: String?
        var start: Date
        var end: Date
    }

    enum Phase: Sendable { case over, now, ahead }

    struct Part: Identifiable, Sendable {
        enum Kind: Sendable { case stop, gap }

        var kind: Kind
        /// A stop's event: the one they're at, or the one the drive is for.
        var row: Agenda.Row?
        /// Set when only the drive is theirs.
        var leg: Leg?
        /// Nil at the day's ends: a gap from its start, or to its end.
        var start: Date?
        var end: Date?
        /// The family's events going on in it, by start.
        var others: [Agenda.Row] = []
        var phase: Phase
        var id: String

        /// How long it is, when it has both ends.
        var length: TimeInterval? {
            guard let start, let end else { return nil }
            return end.timeIntervalSince(start)
        }
    }

    /// The day, its all-day events, and whether it's tomorrow shown early.
    var agenda: Agenda
    var parts: [Part]

    /// Nothing timed at all.
    var isEmpty: Bool { parts.allSatisfy { $0.kind == .gap && $0.others.isEmpty } }

    /// The stop that follows a part, across any gap.
    func nextStop(after part: Part) -> Part? {
        guard let at = parts.firstIndex(where: { $0.id == part.id }) else { return nil }
        return parts[(at + 1)...].first { $0.kind == .stop }
    }

    /// A gap shorter than this isn't one: the two stops are back to back.
    static let shortest: TimeInterval = 5 * 60

    static func build(_ agenda: Agenda, board: Board, me: String?, now: Date = Date(), in calendar: Calendar = .current) -> Rundown {
        let today = Day(now, in: calendar)
        func phase(_ start: Date?, _ end: Date?) -> Phase {
            if agenda.day != today { return agenda.day < today ? .over : .ahead }
            if let end, end <= now { return .over }
            if let start, start > now { return .ahead }
            return .now
        }
        func gap(_ start: Date?, _ end: Date?) -> Part {
            Part(kind: .gap, start: start, end: end, phase: phase(start, end), id: "gap-\(start?.timeIntervalSince1970 ?? 0)")
        }

        var stops: [Part] = []
        var others: [Agenda.Row] = []
        for row in agenda.rows {
            guard row.mine, let me else {
                others.append(row)
                continue
            }
            let event = row.item.event
            let start = CalendarRules.blockStart(event)
            let end = max(event.end ?? start.addingTimeInterval(30 * 60), start)
            let legs = board.rows.values
                .filter { $0.driveSourceEventID == event.id && $0.memberEmail == me }
                .compactMap { drive -> Leg? in
                    guard let duty = drive.driveDuty else { return nil }
                    // "Drop off Sebastian @ 4:30pm (18 min drive)": the words, and the rest.
                    let words = drive.title.components(separatedBy: " @ ")
                    return Leg(
                        duty: duty, title: words[0], note: words.count > 1 ? words.dropFirst().joined(separator: " @ ") : nil,
                        start: drive.start, end: max(drive.end ?? drive.start.addingTimeInterval(15 * 60), drive.start)
                    )
                }
                .sorted { $0.start < $1.start }
            if event.memberEmail == me || row.item.attendees.contains(me) || legs.isEmpty {
                // They're at it: one stop, door to door.
                let from = min(start, legs.first?.start ?? start)
                let to = max(end, legs.last?.end ?? end)
                stops.append(Part(kind: .stop, row: row, start: from, end: to, phase: phase(from, to), id: "stop-\(event.id)"))
            } else {
                // They only drive: the drives are theirs, the event is the family's.
                for leg in legs {
                    stops.append(Part(
                        kind: .stop, row: row, leg: leg, start: leg.start, end: leg.end,
                        phase: phase(leg.start, leg.end), id: "leg-\(event.id)-\(leg.duty.rawValue)"
                    ))
                }
                var theirs = row
                theirs.mine = false
                theirs.leaves = [:]
                others.append(theirs)
            }
        }
        stops.sort { a, b in
            if a.start != b.start { return (a.start ?? .distantPast) < (b.start ?? .distantPast) }
            return (a.end ?? .distantPast) < (b.end ?? .distantPast)
        }

        var parts: [Part] = []
        var busyUntil: Date?
        for stop in stops {
            guard let start = stop.start, let end = stop.end else { continue }
            if let busyUntil {
                if start.timeIntervalSince(busyUntil) >= shortest { parts.append(gap(busyUntil, start)) }
            } else {
                parts.append(gap(nil, start))
            }
            parts.append(stop)
            busyUntil = max(busyUntil ?? end, end)
        }
        parts.append(gap(busyUntil, nil))

        for other in others.sorted(by: { $0.item.event.start < $1.item.event.start }) {
            let start = other.item.event.start
            let end = max(other.item.event.end ?? start.addingTimeInterval(30 * 60), start.addingTimeInterval(1))
            let at = parts.firstIndex { $0.kind == .gap && ($0.start ?? .distantPast) < end && ($0.end ?? .distantFuture) > start }
                ?? parts.lastIndex { $0.kind == .stop && ($0.start ?? .distantFuture) <= start }
                ?? 0
            parts[at].others.append(other)
        }

        // An end of the day with nothing in it isn't worth a line, unless it's
        // where the member is now; nor is a gap that's been and gone.
        parts.removeAll { part in
            guard part.kind == .gap, part.others.isEmpty else { return false }
            return part.phase == .over || (part.length == nil && part.phase != .now)
        }
        return Rundown(agenda: agenda, parts: parts)
    }

    /// "45m", "2h", "1h 5m": a length of time, to the minute above.
    static func length(_ seconds: TimeInterval) -> String {
        let minutes = max(Int((seconds / 60 - 0.001).rounded(.up)), 0)
        let (h, m) = (minutes / 60, minutes % 60)
        return h == 0 ? "\(m)m" : m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }
}
