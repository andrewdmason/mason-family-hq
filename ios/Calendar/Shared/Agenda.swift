import Foundation

/// The Mac menubar applet's list: one day, read from one member's side.
///
/// Their own events (on their calendar, or they're going or driving) are full
/// rows. Everyone else's are one line each, and the same thing on at the same
/// time for several people (two kids at one school) is one line with both
/// faces.
///
/// With no day chosen it's today, for as long as anything on the list is
/// still to come, the family's included; all-day events don't count. After
/// that it's tomorrow, marked as not yet.
struct Agenda: Sendable {
    struct Row: Identifiable, Sendable {
        /// The event a click opens.
        var item: EventItem
        /// The signed-in member's own: a full row, with its time down the left.
        var mine: Bool
        /// The faces down the right: for their own, who else is in it; for
        /// someone else's, whose it is and who's going along.
        var people: [String]
        /// When the member's own drive to it leaves, and the one back.
        var leaves: [DutyKind: Date] = [:]
        /// Already finished.
        var over = false

        var id: UUID { item.id }
    }

    var day: Day
    /// Tomorrow, shown because nothing is left today.
    var upcoming = false
    var allDay: [Row] = []
    var rows: [Row] = []
    /// When `upcoming`: today's all-day events, which are still on.
    var stillToday: [Row] = []

    static func build(
        board: Board, me: String?, shown: [Member], showHidden: Bool, chosen: Day? = nil,
        now: Date = Date(), in calendar: Calendar = .current
    ) -> Agenda {
        let today = Day(now, in: calendar)
        if let chosen, chosen != today {
            return day(chosen, board: board, me: me, shown: shown, showHidden: showHidden, now: now, in: calendar)
        }
        let todays = day(today, board: board, me: me, shown: shown, showHidden: showHidden, now: now, in: calendar)
        if todays.rows.contains(where: { !$0.over }) { return todays }
        var next = day(today.adding(days: 1, in: calendar), board: board, me: me, shown: shown, showHidden: showHidden, now: now, in: calendar)
        next.upcoming = true
        next.stillToday = todays.allDay
        return next
    }

    private static func day(
        _ day: Day, board: Board, me: String?, shown: [Member], showHidden: Bool, now: Date, in calendar: Calendar
    ) -> Agenda {
        let visible = Set(shown.map(\.email)).union(me.map { [$0] } ?? [])
        let order = Dictionary(board.members.enumerated().map { ($1.email, $0) }, uniquingKeysWith: { a, _ in a })
        func inOrder(_ emails: [String]) -> [String] {
            var seen = Set<String>()
            return emails.filter { $0 != me && seen.insert($0).inserted }
                .sorted { (order[$0] ?? .max) < (order[$1] ?? .max) }
        }
        let items = board.events(on: day, showHidden: showHidden)
            .filter { !$0.event.isDrive && (visible.contains($0.event.memberEmail) || !visible.isDisjoint(with: $0.attendees)) }

        var rows: [Row] = []
        // Other people's events that are one thing: the same words at the same time.
        var merged: [String: Int] = [:]
        for item in items {
            let event = item.event
            let over = !event.allDay && (event.end ?? CalendarRules.blockStart(event).addingTimeInterval(30 * 60)) <= now
            if item.involved {
                var row = Row(item: item, mine: true, people: inOrder([event.memberEmail] + item.attendees), over: over)
                for drive in board.rows.values where drive.driveSourceEventID == event.id && drive.memberEmail == me {
                    if let duty = drive.driveDuty { row.leaves[duty] = drive.start }
                }
                rows.append(row)
                continue
            }
            let key = "\(event.allDay)|\(event.start.timeIntervalSince1970)|\(item.title.lowercased())"
            if let at = merged[key] {
                rows[at].people = inOrder(rows[at].people + [event.memberEmail] + item.attendees)
                rows[at].over = rows[at].over && over
            } else {
                merged[key] = rows.count
                rows.append(Row(item: item, mine: false, people: inOrder([event.memberEmail] + item.attendees), over: over))
            }
        }
        func starts(_ row: Row) -> Date { row.item.event.start }
        var agenda = Agenda(day: day)
        agenda.allDay = rows.filter { $0.item.event.allDay }
        agenda.rows = rows.filter { !$0.item.event.allDay }.sorted { a, b in
            if starts(a) != starts(b) { return starts(a) < starts(b) }
            // At the same time, the member's own comes first.
            if a.mine != b.mine { return a.mine }
            return a.item.title < b.item.title
        }
        return agenda
    }
}
