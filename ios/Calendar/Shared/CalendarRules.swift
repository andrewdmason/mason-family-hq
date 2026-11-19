import Foundation

// The website's calendar rules, ported: which day an event is on, which rows
// are one event, what's hidden, how overlaps sit side by side, what conflicts.
// Keep in step with src/lib/calendar/calendar-utils.ts, grid-layout.ts,
// conflicts.ts, recurrence.ts and the `display` function of
// src/components/calendar/calendar-client.tsx. Tested in Tests/.

/// A wall-clock date, with no time or zone.
struct Day: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    var year: Int
    var month: Int
    var day: Int

    static func < (a: Day, b: Day) -> Bool {
        (a.year, a.month, a.day) < (b.year, b.month, b.day)
    }

    var description: String { String(format: "%04d-%02d-%02d", year, month, day) }

    /// The day `date` falls on in `calendar`'s zone.
    init(_ date: Date, in calendar: Calendar = .current) {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        year = c.year ?? 1970
        month = c.month ?? 1
        day = c.day ?? 1
    }

    init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    static func today(in calendar: Calendar = .current) -> Day { Day(Date(), in: calendar) }

    /// Midnight at the start of this day in `calendar`'s zone.
    func start(in calendar: Calendar = .current) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day)) ?? .distantPast
    }

    /// A time on this day, `minutes` after midnight.
    func at(minutes: Int, in calendar: Calendar = .current) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: minutes / 60, minute: minutes % 60))
            ?? start(in: calendar)
    }

    func adding(days: Int, in calendar: Calendar = .current) -> Day {
        // From noon, so a daylight-saving change can't land on the wrong day.
        let noon = at(minutes: 12 * 60, in: calendar)
        return Day(calendar.date(byAdding: .day, value: days, to: noon) ?? noon, in: calendar)
    }

    func adding(months: Int, in calendar: Calendar = .current) -> Day {
        let noon = at(minutes: 12 * 60, in: calendar)
        return Day(calendar.date(byAdding: .month, value: months, to: noon) ?? noon, in: calendar)
    }

    func days(to other: Day, in calendar: Calendar = .current) -> Int {
        calendar.dateComponents([.day], from: at(minutes: 12 * 60, in: calendar), to: other.at(minutes: 12 * 60, in: calendar)).day ?? 0
    }

    /// 0 for Monday … 6 for Sunday: the website's weeks start on Monday.
    func weekdayIndex(in calendar: Calendar = .current) -> Int {
        (calendar.component(.weekday, from: at(minutes: 12 * 60, in: calendar)) + 5) % 7
    }

    /// The Monday of this day's week.
    func weekStart(in calendar: Calendar = .current) -> Day {
        adding(days: -weekdayIndex(in: calendar), in: calendar)
    }

    var monthStart: Day { Day(year: year, month: month, day: 1) }

    /// The six Monday-first weeks that cover this day's month.
    func monthGrid(in calendar: Calendar = .current) -> [[Day]] {
        let first = monthStart.weekStart(in: calendar)
        return (0..<6).map { week in (0..<7).map { first.adding(days: week * 7 + $0, in: calendar) } }
    }
}

/// A block on the time axis, in minutes after the day's midnight.
struct Span: Hashable, Sendable {
    var id: UUID
    var start: Int
    var end: Int
}

struct Placed: Hashable, Sendable {
    var span: Span
    var lane: Int
    var lanes: Int
}

/// "#rrggbb" as numbers, for mixing.
struct RGB: Hashable, Sendable {
    var r: Double
    var g: Double
    var b: Double

    init(r: Double, g: Double, b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    init(hex: String) {
        var text = hex.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        let value = UInt32(text, radix: 16) ?? 0x64748B
        r = Double((value >> 16) & 0xFF) / 255
        g = Double((value >> 8) & 0xFF) / 255
        b = Double(value & 0xFF) / 255
    }

    func mixed(_ share: Double, with other: RGB) -> RGB {
        RGB(r: r * share + other.r * (1 - share), g: g * share + other.g * (1 - share), b: b * share + other.b * (1 - share))
    }

    /// The Day view's earthy version of a member colour: 60% the colour, the
    /// rest a warm grey (the website's `mutedColor`).
    var muted: RGB { mixed(0.6, with: RGB(hex: "#6f6a5f")) }
}

/// Logical events: one row per real event, with who else is going.
struct LogicalEvents: Sendable {
    var events: [CalEvent]
    var attendees: [UUID: [String]]
}

enum CalendarRules {
    static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    static let caregivers = ["Marina", "Elias"]
    static let caregiverColor = "#64748b"
    static let familyColor = "#8a8a80"

    // MARK: Days

    /// The day an event belongs to. All-day events are stored at midnight UTC
    /// of their date and must be read back in UTC; timed ones in the phone's
    /// zone.
    static func day(of event: CalEvent, in calendar: Calendar = .current) -> Day {
        event.allDay ? Day(event.start, in: utc) : Day(event.start, in: calendar)
    }

    /// The instant an all-day event on `day` is stored at.
    static func allDayInstant(_ day: Day) -> Date { day.start(in: utc) }

    // MARK: Which rows are one event

    private static func googleID(_ e: CalEvent) -> String? {
        if let id = e.googleEventID { return id }
        if let ext = e.externalID, ext.hasPrefix("google:") { return String(ext.dropFirst("google:".count)) }
        return nil
    }

    /// Collapse rows that are the same underlying event (a shared Google event
    /// read from several members' calendars, or our materialized event and its
    /// guest copies) into one, owned by one member with the others attending.
    /// Anyone marked going attends too. `memberOrder` settles ownership when
    /// nothing else does.
    static func logical(_ events: [CalEvent], going: [UUID: [String]], memberOrder: [String]) -> LogicalEvents {
        var order: [String] = []
        var groups: [String: [CalEvent]] = [:]
        for e in events {
            let key = googleID(e).map { "g:\($0)" } ?? "s:\(e.id)"
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(e)
        }
        let rank = Dictionary(memberOrder.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        var owners: [CalEvent] = []
        var attendees: [UUID: [String]] = [:]
        for key in order {
            let rows = groups[key] ?? []
            let owner = rows.first { $0.googleEventID != nil }
                ?? rows.first { $0.organizerEmail != nil && $0.memberEmail == $0.organizerEmail }
                ?? rows.enumerated().min { a, b in
                    let (ra, rb) = (rank[a.element.memberEmail] ?? 999, rank[b.element.memberEmail] ?? 999)
                    return ra == rb ? a.offset < b.offset : ra < rb
                }!.element
            var along: [String] = []
            for r in rows where r.memberEmail != owner.memberEmail && !along.contains(r.memberEmail) {
                along.append(r.memberEmail)
            }
            for m in going[owner.id] ?? [] where m != owner.memberEmail && !along.contains(m) {
                along.append(m)
            }
            owners.append(owner)
            attendees[owner.id] = along
        }
        return LogicalEvents(events: owners, attendees: attendees)
    }

    // MARK: Hidden

    /// Out of sight unless asked for: deleted off a Google calendar, a kid's
    /// event they're not going to, or a TeamSnap event the linked player
    /// answered "not going".
    static func isHidden(_ event: CalEvent, source: CalSource?) -> Bool {
        if event.dismissed || event.ownerNotGoing { return true }
        return source?.sourceType == .teamsnap && source?.teamsnapPlayerID != nil && event.teamsnapRsvp == .notGoing
    }

    // MARK: Hidden by the member themselves

    // Not the website's: only the phone has this, for now. A member hides an
    // event, or a whole repeating series, from their own view (long-press).

    /// What a hide of this one event is kept under: its Google id when it has
    /// one, so every member's copy of a shared event is the one event, else
    /// its row's id.
    static func hideTarget(_ event: CalEvent) -> String {
        googleID(event) ?? event.id.uuidString.lowercased()
    }

    /// Whether the event is `me`'s business: it's on their calendar, they're
    /// going along, or they're doing its drop-off or pick-up.
    static func isInvolved(_ me: String?, in event: CalEvent, attendees: [String], duties: [DutyKind: DutyState]?) -> Bool {
        guard let me else { return false }
        return event.memberEmail == me || attendees.contains(me)
            || duties?.values.contains { $0.assignee == me } == true
    }

    /// The hides that cover this event: of it alone, and of its series.
    static func hides(covering event: CalEvent, in hides: [EventHide]) -> [EventHide] {
        let target = hideTarget(event)
        let series = repeats(event) ? event.recurringEventID : nil
        return hides.filter {
            switch $0.scope {
            case .event: $0.target == target
            case .series: $0.target == series
            }
        }
    }

    /// The logical events `me` has hidden. Hiding one event always hides it.
    /// A hidden series gives way, occurrence by occurrence, wherever `me` is
    /// involved, so a pick-up they've been given can't go unseen. A drive
    /// block is hidden with the event it's for.
    static func hiddenByMember(
        _ logical: LogicalEvents, hides: [EventHide], me: String?, duties: [UUID: [DutyKind: DutyState]],
        rows: [UUID: CalEvent]
    ) -> Set<UUID> {
        guard !hides.isEmpty else { return [] }
        var hidden: Set<UUID> = []
        var byTarget: [String: UUID] = [:]
        for event in logical.events where !event.isDrive {
            byTarget[hideTarget(event)] = event.id
            let covering = Self.hides(covering: event, in: hides)
            if covering.contains(where: { $0.scope == .event }) {
                hidden.insert(event.id)
            } else if !covering.isEmpty,
                      !isInvolved(me, in: event, attendees: logical.attendees[event.id] ?? [], duties: duties[event.id]) {
                hidden.insert(event.id)
            }
        }
        for drive in logical.events {
            guard let source = drive.driveSourceEventID.flatMap({ rows[$0] }),
                  let event = byTarget[hideTarget(source)], hidden.contains(event)
            else { continue }
            hidden.insert(drive.id)
        }
        return hidden
    }

    // MARK: Blocks on the axis

    /// Where a block begins: a TeamSnap arrival time earlier than the start
    /// pulls it up, so the block covers the whole commitment.
    static func blockStart(_ e: CalEvent) -> Date {
        if let arrival = e.teamsnapArrival, arrival < e.start { return arrival }
        return e.start
    }

    static func minutes(_ date: Date, in calendar: Calendar = .current) -> Int {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    static func startMinutes(_ e: CalEvent, in calendar: Calendar = .current) -> Int {
        minutes(blockStart(e), in: calendar)
    }

    /// Half an hour when there's no end; to midnight when it runs past it; at
    /// least a quarter of an hour.
    static func endMinutes(_ e: CalEvent, in calendar: Calendar = .current) -> Int {
        let s = startMinutes(e, in: calendar)
        guard let end = e.end else { return s + 30 }
        let em = minutes(end, in: calendar)
        return em <= s ? 24 * 60 : max(em, s + 15)
    }

    static func span(_ e: CalEvent, in calendar: Calendar = .current) -> Span {
        Span(id: e.id, start: startMinutes(e, in: calendar), end: endMinutes(e, in: calendar))
    }

    /// Side-by-side lanes for a column: chained overlaps form a cluster, each
    /// block takes the first lane free at its start, and everything in a
    /// cluster shares its lane count so widths line up.
    static func pack(_ spans: [Span]) -> [Placed] {
        let sorted = spans.sorted { ($0.start, $0.end) < ($1.start, $1.end) }
        var out: [Placed] = []
        var cluster: [(span: Span, lane: Int)] = []
        var clusterEnd = -1

        func flush() {
            let lanes = cluster.reduce(0) { max($0, $1.lane + 1) }
            out += cluster.map { Placed(span: $0.span, lane: $0.lane, lanes: lanes) }
            cluster = []
            clusterEnd = -1
        }

        for span in sorted {
            if !cluster.isEmpty, span.start >= clusterEnd { flush() }
            var laneEnds: [Int: Int] = [:]
            for c in cluster { laneEnds[c.lane] = max(laneEnds[c.lane] ?? -1, c.span.end) }
            var lane = 0
            while let end = laneEnds[lane], end > span.start { lane += 1 }
            cluster.append((span, lane))
            clusterEnd = max(clusterEnd, span.end)
        }
        flush()
        return out
    }

    // MARK: Conflicts

    /// Events that overlap another of the same member's. All-day events don't
    /// count; an event with no end is taken as two hours; back-to-back is fine.
    static func conflicts(_ events: [CalEvent]) -> Set<UUID> {
        var byMember: [String: [(id: UUID, start: Date, end: Date)]] = [:]
        for e in events where !e.allDay {
            byMember[e.memberEmail, default: []].append((e.id, e.start, e.end ?? e.start.addingTimeInterval(2 * 3600)))
        }
        var ids: Set<UUID> = []
        for list in byMember.values {
            let sorted = list.sorted { ($0.start, $0.end) < ($1.start, $1.end) }
            for i in sorted.indices {
                for j in sorted.indices where j > i {
                    if sorted[j].start >= sorted[i].end { break }
                    ids.insert(sorted[i].id)
                    ids.insert(sorted[j].id)
                }
            }
        }
        return ids
    }

    // MARK: Places

    /// A location as the two lines it's shown on: the name, or the street
    /// of a bare address, then the rest. "Crowden School, 1475 Rose St,
    /// Berkeley" is "Crowden School" over "1475 Rose St, Berkeley".
    static func placeParts(_ location: String) -> (name: String, rest: String?) {
        let text = location.split(whereSeparator: \.isNewline).joined(separator: ", ")
            .trimmingCharacters(in: .whitespaces)
        guard let comma = text.range(of: ", ") else { return (text, nil) }
        let rest = text[comma.upperBound...].trimmingCharacters(in: .whitespaces)
        return (String(text[..<comma.lowerBound]), rest.isEmpty ? nil : rest)
    }

    /// The places the family's events are at, for the location card: each
    /// once, those of the events nearest `now` first (last week's and next
    /// week's before last month's). Written two ways, a place counts once,
    /// as its nearest event has it. What isn't somewhere is left out.
    static func recentPlaces(_ events: [CalEvent], now: Date = Date(), limit: Int = 8) -> [String] {
        var nearest: [String: (place: String, distance: TimeInterval)] = [:]
        for event in events where !event.isDrive && !event.dismissed {
            guard let place = event.location?.trimmingCharacters(in: .whitespacesAndNewlines), isSomewhere(place) else { continue }
            let key = place.lowercased()
            let distance = abs(event.start.timeIntervalSince(now))
            if let had = nearest[key], had.distance <= distance { continue }
            nearest[key] = (place, distance)
        }
        return nearest.values
            .sorted { ($0.distance, $0.place) < ($1.distance, $1.place) }
            .prefix(limit)
            .map(\.place)
    }

    /// Whether a location names a place. Calendars put other things there:
    /// a booking tool's "Click to join meeting: https://…", or "TBD".
    static func isSomewhere(_ location: String) -> Bool {
        let text = location.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if text.isEmpty || text.contains("://") || text.contains("www.") { return false }
        return !["tbd", "tba", "tbc", "n/a", "none", "online", "virtual", "zoom", "phone", "phone call"].contains(text)
    }

    /// The recent places that match what's been typed, by any word in them.
    static func matching(_ places: [String], _ query: String) -> [String] {
        let query = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return places }
        return places.filter { $0.lowercased().contains(query) }
    }

    // MARK: Home

    /// Whether an event is at home, which needs no drop-off or pick-up:
    /// "Home"-style names, or the family's address matched on its street
    /// number and name.
    static func isHome(_ location: String?, homeAddress: String?) -> Bool {
        guard let location else { return false }
        func norm(_ s: String) -> String {
            let cleaned = s.lowercased().unicodeScalars.map { c -> Character in
                (c.isASCII && (CharacterSet.alphanumerics.contains(c) || c == " ")) ? Character(c) : " "
            }
            return String(cleaned).split(separator: " ").joined(separator: " ")
        }
        let loc = norm(location)
        if ["home", "house", "our house"].contains(loc) { return true }
        if let homeAddress {
            let street = norm(homeAddress).split(separator: " ").prefix(2).joined(separator: " ")
            if street.count >= 6, loc.hasPrefix(street) { return true }
        }
        return false
    }

    // MARK: Colour

    private static let palette = ["#2563eb", "#db2777", "#16a34a", "#d97706", "#7c3aed", "#0891b2"]

    /// The colour a member gets when none is set: the website's hash of the
    /// email into a fixed palette.
    static func hashColor(_ email: String) -> String {
        var hash: Int32 = 0
        for unit in email.utf16 { hash = hash &* 31 &+ Int32(truncatingIfNeeded: unit) }
        return palette[Int(abs(Int64(hash)) % Int64(palette.count))]
    }

    // MARK: Words

    /// "3:00 PM – 4:30 PM", the start alone with no end, "All day".
    static func timeRange(_ e: CalEvent, in calendar: Calendar = .current) -> String {
        if e.allDay { return "All day" }
        guard let end = e.end else { return clock(e.start, in: calendar) }
        return "\(clock(e.start, in: calendar)) – \(clock(end, in: calendar))"
    }

    /// "3:00 PM".
    static func clock(_ date: Date, in calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        let h = c.hour ?? 0
        return String(format: "%d:%02d %@", h % 12 == 0 ? 12 : h % 12, c.minute ?? 0, h < 12 ? "AM" : "PM")
    }

    /// "3 PM", "3:15 PM": shorter, for tight rows.
    static func shortClock(_ date: Date, in calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        let h = c.hour ?? 0
        let hour = h % 12 == 0 ? 12 : h % 12
        let half = h < 12 ? "AM" : "PM"
        return (c.minute ?? 0) == 0 ? "\(hour) \(half)" : String(format: "%d:%02d %@", hour, c.minute ?? 0, half)
    }

    /// The grid's hour labels: "12 AM", "9 AM", "Noon", "3 PM".
    static func hourLabel(_ hour: Int) -> String {
        let h = hour % 24
        if h == 0 { return "12 AM" }
        if h == 12 { return "Noon" }
        return h < 12 ? "\(h) AM" : "\(h - 12) PM"
    }

    /// The title with its calendar's name in front ("FSB: Practice"), the way
    /// the website's cards show it: always for TeamSnap and ICS calendars,
    /// otherwise only when the owner has more than one calendar.
    static func calendarLabel(_ event: CalEvent, source: CalSource?, activeSourcesOfOwner: Int) -> String? {
        guard let source, let name = source.name, !name.isEmpty else { return nil }
        if source.sourceType == .teamsnap || source.sourceType == .ics || activeSourcesOfOwner > 1 { return name }
        return nil
    }

    /// Every occurrence of the repeating event `event` is one of, itself
    /// included: the rows on the same calendar from the same Google series.
    /// Just the event when it doesn't repeat.
    static func series(of event: CalEvent, in events: [CalEvent]) -> [CalEvent] {
        guard event.sourceType == .google, let series = event.recurringEventID else { return [event] }
        return events.filter { $0.id == event.id || ($0.recurringEventID == series && $0.sourceID == event.sourceID) }
    }

    /// Whether deleting can offer the whole series as well as the one event.
    static func repeats(_ event: CalEvent) -> Bool {
        event.sourceType == .google && event.recurringEventID != nil
    }

    private static let weekdayNames = ["MO": "Mon", "TU": "Tue", "WE": "Wed", "TH": "Thu", "FR": "Fri", "SA": "Sat", "SU": "Sun"]
    private static let weekdayOrder = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]

    /// "Weekly", "Every 2 weeks", "Weekly on Mon, Wed", "Monthly until Jun 30,
    /// 2026", with a best-effort reading of anything fancier.
    static func repeatText(_ rrule: String) -> String {
        var parts: [String: String] = [:]
        for piece in rrule.split(separator: ";") {
            guard let eq = piece.firstIndex(of: "="), eq != piece.startIndex else { continue }
            parts[piece[..<eq].uppercased()] = String(piece[piece.index(after: eq)...])
        }
        let interval = Int(parts["INTERVAL"] ?? "1") ?? 1
        let until = parts["UNTIL"].flatMap(untilText)

        if let nice = niceRepeat(parts, interval: interval) {
            if parts["UNTIL"] == nil { return nice }
            if let until { return "\(nice) until \(until)" }
        }

        guard let freq = parts["FREQ"]?.lowercased() else { return "Repeats" }
        let noun = ["daily": "day", "weekly": "week", "monthly": "month", "yearly": "year"][freq]
        var base = noun.map { interval > 1 ? "Every \(interval) \($0)s" : "Every \($0)" } ?? "Repeats"
        if let count = parts["COUNT"] { base += ", \(count) times" }
        if let until { base += " until \(until)" }
        return base
    }

    private static func niceRepeat(_ parts: [String: String], interval: Int) -> String? {
        guard let freq = parts["FREQ"], parts["COUNT"] == nil,
              parts.keys.allSatisfy({ ["FREQ", "INTERVAL", "UNTIL", "BYDAY", "WKST"].contains($0) })
        else { return nil }
        let byDay = parts["BYDAY"].map { $0.split(separator: ",").map(String.init) } ?? []
        guard byDay.allSatisfy({ weekdayNames[$0] != nil }) else { return nil }
        switch (freq, interval) {
        case ("DAILY", 1) where byDay.isEmpty: return "Daily"
        case ("WEEKLY", 1):
            if byDay.count <= 1 { return "Weekly" }
            return "Weekly on " + byDay.compactMap { weekdayNames[$0] }.joined(separator: ", ")
        case ("WEEKLY", 2) where byDay.count <= 1: return "Every 2 weeks"
        case ("MONTHLY", 1) where byDay.isEmpty: return "Monthly"
        case ("YEARLY", 1) where byDay.isEmpty: return "Yearly"
        default: return nil
        }
    }

    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// "20260630T235959Z" → "Jun 30, 2026".
    private static func untilText(_ value: String) -> String? {
        guard let day = untilDay(value), (1...12).contains(day.month) else { return nil }
        return "\(months[day.month - 1]) \(day.day), \(day.year)"
    }

    /// The last day an UNTIL allows: a bare date as it is ("20260630"), an
    /// instant ("20260701T065959Z") as the day it falls on here.
    static func untilDay(_ value: String, in calendar: Calendar = .current) -> Day? {
        let digits = value.prefix(8)
        guard digits.count == 8, digits.allSatisfy(\.isNumber),
              let y = Int(digits.prefix(4)), let m = Int(digits.dropFirst(4).prefix(2)), let d = Int(digits.suffix(2))
        else { return nil }
        let clock = value.dropFirst(8)
        guard clock.hasPrefix("T"), clock.hasSuffix("Z"), clock.count == 8,
              let h = Int(clock.dropFirst().prefix(2)), let min = Int(clock.dropFirst(3).prefix(2)), let sec = Int(clock.dropFirst(5).prefix(2)),
              let instant = utc.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min, second: sec))
        else { return Day(year: y, month: m, day: d) }
        return Day(instant, in: calendar)
    }

    // MARK: Repeating, as the card edits it

    /// "Every week": what the card calls each way of repeating.
    static func repeatLabel(_ every: Repeat.Every) -> String {
        switch every {
        case .day: "Every day"
        case .weekday: "Every weekday"
        case .week: "Every week"
        case .twoWeeks: "Every 2 weeks"
        case .month: "Every month"
        case .year: "Every year"
        case .other(let body): body.isEmpty ? "Repeats" : repeatText(body)
        }
    }

    private static func ruleParts(_ rrule: String) -> [(key: String, value: String)] {
        rrule.split(separator: ";").compactMap { piece in
            guard let eq = piece.firstIndex(of: "="), eq != piece.startIndex else { return nil }
            return (piece[..<eq].uppercased(), String(piece[piece.index(after: eq)...]))
        }
    }

    /// An RRULE body as the card's choice. Anything the choices can't say is
    /// kept whole, less its end, which the card edits on its own.
    static func repeats(from rrule: String, in calendar: Calendar = .current) -> Repeat {
        let parts = ruleParts(rrule)
        let until = parts.first { $0.key == "UNTIL" }.flatMap { untilDay($0.value, in: calendar) }
        let rest = parts.filter { $0.key != "UNTIL" }
        let body = rest.map { "\($0.key)=\($0.value)" }.joined(separator: ";")
        var named: [String: String] = [:]
        for part in rest where part.key != "WKST" { named[part.key] = part.value }
        let freq = named.removeValue(forKey: "FREQ")
        let interval = Int(named.removeValue(forKey: "INTERVAL") ?? "1") ?? 1
        let byDay = named.removeValue(forKey: "BYDAY").map { Set($0.split(separator: ",").map(String.init)) } ?? []
        var every = Repeat.Every.other(body)
        if named.isEmpty {
            switch (freq, interval) {
            case ("DAILY", 1) where byDay.isEmpty: every = .day
            case ("WEEKLY", 1) where byDay == ["MO", "TU", "WE", "TH", "FR"]: every = .weekday
            case ("WEEKLY", 1) where byDay.count <= 1 && byDay.allSatisfy { weekdayNames[$0] != nil }: every = .week
            case ("WEEKLY", 2) where byDay.count <= 1 && byDay.allSatisfy { weekdayNames[$0] != nil }: every = .twoWeeks
            case ("MONTHLY", 1) where byDay.isEmpty: every = .month
            case ("YEARLY", 1) where byDay.isEmpty: every = .year
            default: break
            }
        }
        return Repeat(every: every, until: until)
    }

    /// The card's choice as an RRULE body, anchored to the event's own start
    /// by Google. The end is the whole of its last day here: a bare date for
    /// an all-day event, else that day's last second as a UTC instant, which
    /// is what Google wants for each. Nil when there's no rule to send.
    static func rrule(_ rule: Repeat, allDay: Bool, in calendar: Calendar = .current) -> String? {
        var body: String
        switch rule.every {
        case .day: body = "FREQ=DAILY"
        case .weekday: body = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
        case .week: body = "FREQ=WEEKLY"
        case .twoWeeks: body = "FREQ=WEEKLY;INTERVAL=2"
        case .month: body = "FREQ=MONTHLY"
        case .year: body = "FREQ=YEARLY"
        case .other(let kept):
            guard !kept.isEmpty else { return nil }
            body = kept
        }
        guard let until = rule.until else { return body }
        if allDay {
            body += String(format: ";UNTIL=%04d%02d%02d", until.year, until.month, until.day)
        } else {
            let last = until.adding(days: 1, in: calendar).start(in: calendar).addingTimeInterval(-1)
            let c = utc.dateComponents([.year, .month, .day, .hour, .minute, .second], from: last)
            body += String(
                format: ";UNTIL=%04d%02d%02dT%02d%02d%02dZ",
                c.year ?? 0, c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0, c.second ?? 0
            )
        }
        return body
    }

    /// "1h 30min", "45min", "2h": how long an event runs.
    static func length(from start: Date, to end: Date) -> String {
        let minutes = max(0, Int((end.timeIntervalSince(start) / 60).rounded()))
        let (h, m) = (minutes / 60, minutes % 60)
        if h == 0 { return "\(m)min" }
        return m == 0 ? "\(h)h" : "\(h)h \(m)min"
    }

    // MARK: Changing hands

    /// Who's going along once an event moves to another member's calendar:
    /// whoever had it is assumed to still be going, and the new owner drops
    /// off the list (the owner is implicit).
    static func goingAfterMove(_ going: [String], from previous: String, to owner: String) -> [String] {
        var list = going.filter { $0 != owner }
        if previous != owner, !list.contains(previous) { list.append(previous) }
        return list
    }

    // MARK: New events

    /// Where a new event starts: the next round hour when the day is today,
    /// 9:00 otherwise; an hour long.
    static func newEventTimes(on day: Day, now: Date = Date(), in calendar: Calendar = .current) -> (start: Date, end: Date) {
        var startMinute = 9 * 60
        if day == Day(now, in: calendar) {
            startMinute = min((minutes(now, in: calendar) / 60 + 1) * 60, 23 * 60)
        }
        let start = day.at(minutes: startMinute, in: calendar)
        return (start, start.addingTimeInterval(3600))
    }

    /// Moving the start keeps the length (a quarter of an hour at least).
    static func moveStart(_ draft: inout EventDraft, to start: Date) {
        let length = max(draft.end.timeIntervalSince(draft.start), 15 * 60)
        draft.start = start
        draft.end = start.addingTimeInterval(length)
    }

    /// An end at or before the start snaps to a quarter of an hour after it.
    static func moveEnd(_ draft: inout EventDraft, to end: Date) {
        draft.end = end <= draft.start ? draft.start.addingTimeInterval(15 * 60) : end
    }
}
