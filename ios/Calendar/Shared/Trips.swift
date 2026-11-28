import Foundation

// Trips: a named stretch of days with its travelers, the bookings that get
// them there, house them and bring them home, and their own to-dos. Plan:
// docs/plans/2026-11-28-001-feat-calendar-trips-plan.md. The rows are
// supabase/migrations/00232_calendar_trips.sql; the rules (what's still to
// book, which time each day is in, what to suggest, what an event says about
// itself) are here, tested in Tests/TripTests.swift.

// MARK: Rows

extension Day {
    /// "2026-11-22", as Postgres writes a date.
    init?(iso text: String) {
        let parts = text.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }
}

/// What a piece of a trip is.
enum PieceKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case flight, train, bus, ferry, drive, car, stay, other

    var id: String { rawValue }

    /// A way of getting somewhere: fills getting there, moving on, getting home.
    var isTravel: Bool { self != .stay && self != .car }

    var label: String {
        switch self {
        case .flight: "Flight"
        case .train: "Train"
        case .bus: "Bus"
        case .ferry: "Ferry"
        case .drive: "Drive"
        case .car: "Rental car"
        case .stay: "Stay"
        case .other: "Other travel"
        }
    }

    var symbol: String {
        switch self {
        case .flight: "airplane"
        case .train: "tram.fill"
        case .bus: "bus.fill"
        case .ferry: "ferry.fill"
        case .drive: "car.fill"
        case .car: "car.side.fill"
        case .stay: "bed.double.fill"
        case .other: "figure.walk"
        }
    }

    /// The details worth a field of their own, in the order the editor shows them.
    var fields: [(key: String, label: String)] {
        switch self {
        case .flight: [("airline", "Airline"), ("flight_number", "Flight"), ("seat", "Seats"), ("terminal", "Terminal")]
        case .train, .bus, .ferry: [("company", "Company"), ("number", "Number"), ("seat", "Seats")]
        case .drive: []
        case .car: [("company", "Company"), ("phone", "Phone")]
        case .stay: [("address", "Address"), ("phone", "Phone"), ("door_code", "Door code"), ("wifi", "Wi-Fi")]
        case .other: [("company", "Company")]
        }
    }
}

/// Which slot a way of getting somewhere fills.
enum LegRole: String, Codable, Sendable, CaseIterable, Identifiable {
    case out, between, back

    var id: String { rawValue }
    var label: String {
        switch self {
        case .out: "Getting there"
        case .between: "Moving on"
        case .back: "Getting home"
        }
    }
}

/// A booking (or a plan for one) on a trip: a flight, a stay, a rental car.
struct TripPiece: Identifiable, Hashable, Codable, Sendable {
    var id = UUID()
    var tripID: UUID
    var kind: PieceKind
    var leg: LegRole?
    /// False: planned but not locked in, which leaves its slot open.
    var booked = true
    var eventID: UUID?
    var eventGoogleID: String?
    var title = ""
    /// Departure and arrival; check-in and check-out; pickup and drop-off.
    var start: Date?
    var end: Date?
    var fromPlace: String?
    var toPlace: String?
    var fromZone: String?
    var toZone: String?
    var confirmation: String?
    var details: [String: String] = [:]
    /// Nil: everyone on the trip.
    var travelers: [String]?

    /// Set by a one-tap "We're driving" or "Staying with family": it's on its
    /// days, at no particular time.
    var dayOnly: Bool { details["day_only"] == "true" }

    /// The zone its start is read in, and its end.
    var startZone: TimeZone? { (fromZone ?? toZone).flatMap(TimeZone.init(identifier:)) }
    var endZone: TimeZone? { (toZone ?? fromZone).flatMap(TimeZone.init(identifier:)) }

    /// What it's called when nothing better is written: "Flight to San José", "Stay".
    var displayTitle: String {
        let written = title.trimmingCharacters(in: .whitespaces)
        if !written.isEmpty { return written }
        if kind.isTravel, let to = toPlace, !to.isEmpty { return "\(kind.label) to \(to)" }
        return kind.label
    }
}

/// One of the trip's own to-dos.
struct TripItem: Identifiable, Hashable, Codable, Sendable {
    var id = UUID()
    var tripID: UUID
    var title: String
    var done = false
    var position = 0
}

struct Trip: Identifiable, Hashable, Codable, Sendable {
    var id = UUID()
    var name: String
    /// The first day and the last, both included.
    var start: Day
    var end: Day
    /// Who's going, by email.
    var travelers: [String]
    var notes: String?
    var createdBy: String?
    var pieces: [TripPiece] = []
    var items: [TripItem] = []

    /// How many days it runs, counting both ends.
    var length: Int { start.days(to: end, in: CalendarRules.utc) + 1 }

    func contains(_ day: Day) -> Bool { start <= day && day <= end }

    /// Who a piece is for: its own list when narrowed, else everyone on the trip.
    func travelers(of piece: TripPiece) -> [String] { piece.travelers ?? travelers }

    /// "Day 4 of 9".
    func dayNumber(_ day: Day) -> Int { start.days(to: day, in: CalendarRules.utc) + 1 }
}

// MARK: Supabase's rows

/// The rows as Supabase reads and writes them. Dates go as text, so nothing
/// depends on the client's own date coding.
enum TripRows {
    struct TripRow: Codable {
        var id: UUID
        var name: String
        var start_date: String
        var end_date: String
        var traveler_emails: [String]
        var notes: String?
        var created_by_email: String?

        init(_ trip: Trip) {
            id = trip.id
            name = trip.name
            start_date = trip.start.description
            end_date = trip.end.description
            traveler_emails = trip.travelers
            notes = trip.notes
            created_by_email = trip.createdBy
        }

        var trip: Trip? {
            guard let start = Day(iso: start_date), let end = Day(iso: end_date) else { return nil }
            return Trip(
                id: id, name: name, start: start, end: end, travelers: traveler_emails.map { $0.lowercased() },
                notes: notes, createdBy: created_by_email
            )
        }

        static let columns = "id, name, start_date, end_date, traveler_emails, notes, created_by_email"
    }

    struct PieceRow: Codable {
        var id: UUID
        var trip_id: UUID
        var kind: PieceKind
        var leg: LegRole?
        var booked: Bool
        var event_id: UUID?
        var event_google_id: String?
        var title: String
        var starts_at: String?
        var ends_at: String?
        var from_place: String?
        var to_place: String?
        var from_zone: String?
        var to_zone: String?
        var confirmation: String?
        var details: [String: String]
        var traveler_emails: [String]?

        init(_ p: TripPiece) {
            id = p.id
            trip_id = p.tripID
            kind = p.kind
            leg = p.leg
            booked = p.booked
            event_id = p.eventID
            event_google_id = p.eventGoogleID
            title = p.title
            starts_at = p.start.map(Instant.string)
            ends_at = p.end.map(Instant.string)
            from_place = p.fromPlace
            to_place = p.toPlace
            from_zone = p.fromZone
            to_zone = p.toZone
            confirmation = p.confirmation
            details = p.details
            traveler_emails = p.travelers
        }

        // Encoded by hand so an unset field is sent as null: an update has
        // to be able to clear one.
        enum CodingKeys: String, CodingKey {
            case id, trip_id, kind, leg, booked, event_id, event_google_id, title, starts_at, ends_at
            case from_place, to_place, from_zone, to_zone, confirmation, details, traveler_emails
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(id, forKey: .id)
            try c.encode(trip_id, forKey: .trip_id)
            try c.encode(kind, forKey: .kind)
            try c.encode(leg, forKey: .leg)
            try c.encode(booked, forKey: .booked)
            try c.encode(event_id, forKey: .event_id)
            try c.encode(event_google_id, forKey: .event_google_id)
            try c.encode(title, forKey: .title)
            try c.encode(starts_at, forKey: .starts_at)
            try c.encode(ends_at, forKey: .ends_at)
            try c.encode(from_place, forKey: .from_place)
            try c.encode(to_place, forKey: .to_place)
            try c.encode(from_zone, forKey: .from_zone)
            try c.encode(to_zone, forKey: .to_zone)
            try c.encode(confirmation, forKey: .confirmation)
            try c.encode(details, forKey: .details)
            try c.encode(traveler_emails, forKey: .traveler_emails)
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(UUID.self, forKey: .id)
            trip_id = try c.decode(UUID.self, forKey: .trip_id)
            kind = (try? c.decode(PieceKind.self, forKey: .kind)) ?? .other
            leg = try? c.decodeIfPresent(LegRole.self, forKey: .leg)
            booked = try c.decodeIfPresent(Bool.self, forKey: .booked) ?? true
            event_id = try c.decodeIfPresent(UUID.self, forKey: .event_id)
            event_google_id = try c.decodeIfPresent(String.self, forKey: .event_google_id)
            title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
            starts_at = try c.decodeIfPresent(String.self, forKey: .starts_at)
            ends_at = try c.decodeIfPresent(String.self, forKey: .ends_at)
            from_place = try c.decodeIfPresent(String.self, forKey: .from_place)
            to_place = try c.decodeIfPresent(String.self, forKey: .to_place)
            from_zone = try c.decodeIfPresent(String.self, forKey: .from_zone)
            to_zone = try c.decodeIfPresent(String.self, forKey: .to_zone)
            confirmation = try c.decodeIfPresent(String.self, forKey: .confirmation)
            details = (try? c.decodeIfPresent([String: String].self, forKey: .details)) ?? [:]
            traveler_emails = try c.decodeIfPresent([String].self, forKey: .traveler_emails)
        }

        var piece: TripPiece {
            TripPiece(
                id: id, tripID: trip_id, kind: kind, leg: leg, booked: booked, eventID: event_id,
                eventGoogleID: event_google_id, title: title, start: starts_at.flatMap(Instant.parse),
                end: ends_at.flatMap(Instant.parse), fromPlace: from_place, toPlace: to_place, fromZone: from_zone,
                toZone: to_zone, confirmation: confirmation, details: details,
                travelers: traveler_emails?.map { $0.lowercased() }
            )
        }

        static let columns =
            "id, trip_id, kind, leg, booked, event_id, event_google_id, title, starts_at, ends_at, from_place, to_place, from_zone, to_zone, confirmation, details, traveler_emails"
    }

    struct ItemRow: Codable {
        var id: UUID
        var trip_id: UUID
        var title: String
        var done: Bool
        var position: Int

        init(_ item: TripItem) {
            id = item.id
            trip_id = item.tripID
            title = item.title
            done = item.done
            position = item.position
        }

        var item: TripItem { TripItem(id: id, tripID: trip_id, title: title, done: done, position: position) }

        static let columns = "id, trip_id, title, done, position"
    }

    struct DismissalRow: Codable {
        var key: String
    }
}

// MARK: Slots

/// One thing every trip needs, for some of its travelers.
struct TripSlot: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable, Comparable {
        case there
        /// A bed for the night that starts on this day.
        case night(Day)
        /// Getting from one stay to the next, on this day.
        case move(Day, from: String, to: String)
        case home

        /// Where it sits in the list: by day, getting there first and home last.
        var order: (Int, Day, Int) {
            switch self {
            case .there: (0, Day(year: 0, month: 1, day: 1), 0)
            case .night(let day): (1, day, 1)
            case .move(let day, _, _): (1, day, 0)
            case .home: (2, Day(year: 9999, month: 1, day: 1), 0)
            }
        }

        static func < (a: Kind, b: Kind) -> Bool { a.order < b.order }
    }

    enum State: Hashable, Sendable {
        case open
        /// Something's planned but not locked in.
        case planned(TripPiece)
        case sorted(TripPiece)

        var isOpen: Bool {
            if case .sorted = self { return false }
            return true
        }
    }

    var kind: Kind
    var state: State
    var travelers: [String]

    var id: String {
        switch kind {
        case .there: "there"
        case .night(let day): "night-\(day)"
        case .move(let day, let from, let to): "move-\(day)-\(from)-\(to)"
        case .home: "home"
        }
    }

    /// "Getting there", "Fri night", "Edinburgh → London", "Getting home".
    func title(in calendar: Calendar = CalendarRules.utc) -> String {
        switch kind {
        case .there: "Getting there"
        case .home: "Getting home"
        case .night(let day): "\(day.at(minutes: 12 * 60, in: calendar).formatted(.dateTime.weekday(.abbreviated).locale(Locale(identifier: "en_US")).month(.abbreviated).day())) night"
        case .move(_, let from, let to): "\(from) → \(to)"
        }
    }

    /// The leg a way of getting somewhere filling this slot would be.
    var leg: LegRole? {
        switch kind {
        case .there: .out
        case .home: .back
        case .move: .between
        case .night: nil
        }
    }
}

/// Everything worked out about one trip from its pieces and the calendar.
struct TripView: Identifiable, Hashable, Sendable {
    var trip: Trip
    /// Each traveler's first day and last.
    var spans: [String: ClosedRange<Day>]
    /// Every slot, open or not, merged across travelers where they're the same.
    var slots: [TripSlot]
    /// Each traveler's day → the zone they're in that day, where it's known.
    var zones: [String: [Day: TimeZone]]

    var id: UUID { trip.id }

    var open: [TripSlot] { slots.filter(\.state.isOpen) }

    /// The open slots as the panel lists them: nights in a row that are open
    /// the same way for the same people are one entry ("3 nights").
    var openGroups: [[TripSlot]] {
        var groups: [[TripSlot]] = []
        for slot in open {
            if case .night(let day) = slot.kind, let last = groups.last?.last, case .night(let before) = last.kind,
               before.adding(days: 1, in: CalendarRules.utc) == day, last.state == slot.state,
               Set(last.travelers) == Set(slot.travelers) {
                groups[groups.count - 1].append(slot)
            } else {
                groups.append([slot])
            }
        }
        return groups
    }

    /// "4 to book", or "1 to do" when only the list's own items are left.
    var openLabel: String? {
        if !open.isEmpty { return "\(open.count) to book" }
        if !openItems.isEmpty { return "\(openItems.count) to do" }
        return nil
    }
    var openItems: [TripItem] { trip.items.filter { !$0.done } }
    /// How many things are still to do: open slots and unticked items.
    var openCount: Int { open.count + openItems.count }

    /// The zone a traveler is in on a day, if the trip says.
    func zone(for member: String, on day: Day) -> TimeZone? { zones[member]?[day] }

    /// The place most of the trip's nights are in, for the band ("Costa Rica").
    var placeName: String? {
        var counts: [String: Int] = [:]
        for zones in zones.values { for zone in zones.values { counts[zone.identifier, default: 0] += 1 } }
        return counts.max { ($0.value, $1.key) < ($1.value, $0.key) }.map { CalendarRules.zonePlace(TimeZone(identifier: $0.key)!) }
    }
}

enum Trips {
    /// The day a moment falls on in a zone (home's when there's none).
    static func day(_ date: Date, in zone: TimeZone?, home: TimeZone) -> Day {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone ?? home
        return Day(date, in: calendar)
    }

    /// The day a piece starts on, where it starts.
    static func startDay(_ piece: TripPiece, home: TimeZone) -> Day? {
        piece.start.map { day($0, in: piece.startZone, home: home) }
    }

    /// The day a piece ends on, where it ends.
    static func endDay(_ piece: TripPiece, home: TimeZone) -> Day? {
        (piece.end ?? piece.start).map { day($0, in: piece.endZone, home: home) }
    }

    /// The nights a stay covers: check-in day up to the day before check-out.
    static func nights(_ stay: TripPiece, home: TimeZone) -> [Day] {
        guard stay.kind == .stay, let first = startDay(stay, home: home), let out = endDay(stay, home: home) else { return [] }
        let count = first.days(to: out, in: CalendarRules.utc)
        return (0..<max(count, 0)).map { first.adding(days: $0, in: CalendarRules.utc) }
    }

    /// The pieces for a traveler, read against the events they're attached
    /// to: an event that's moved takes the piece with it.
    static func pieces(of trip: Trip, for member: String) -> [TripPiece] {
        trip.pieces.filter { trip.travelers(of: $0).contains(member) }
    }

    /// A traveler's first day and last: the trip's, unless a leg of theirs
    /// marked as getting there or getting home says otherwise.
    static func span(of trip: Trip, for member: String, home: TimeZone) -> ClosedRange<Day> {
        let mine = pieces(of: trip, for: member).filter { $0.kind.isTravel }
        let first = mine.filter { $0.leg == .out }.compactMap { startDay($0, home: home) }.min() ?? trip.start
        let last = mine.filter { $0.leg == .back }.compactMap { startDay($0, home: home) }.max() ?? trip.end
        return first <= last ? first...last : trip.start...trip.end
    }

    /// Where a stay is, to tell one from the next.
    private static func place(_ stay: TripPiece) -> String {
        let name = (stay.toPlace ?? stay.details["address"] ?? stay.title).trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? stay.displayTitle : name
    }

    /// A short name for a stay's place, for a move between two: the town if
    /// the address gives one, else the name.
    static func shortPlace(_ stay: TripPiece) -> String {
        if let zone = stay.endZone, stay.toPlace == nil { return CalendarRules.zonePlace(zone) }
        let parts = place(stay).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        // "Hotel X, 12 High St, Edinburgh EH1, UK": the town is the second to
        // last part, its postcode left off.
        if parts.count >= 3 {
            let town = parts[parts.count - 2].split(separator: " ").prefix { !$0.contains(where: \.isNumber) }
            if !town.isEmpty { return town.joined(separator: " ") }
        }
        return parts.first ?? stay.displayTitle
    }

    /// One traveler's slots.
    static func slots(of trip: Trip, for member: String, home: TimeZone) -> [TripSlot.Kind: TripSlot.State] {
        let span = span(of: trip, for: member, home: home)
        let mine = pieces(of: trip, for: member)
        let travel = mine.filter { $0.kind.isTravel }
        let stays = mine.filter { $0.kind == .stay }
        var out: [TripSlot.Kind: TripSlot.State] = [:]

        func state(_ matches: [TripPiece]) -> TripSlot.State {
            if let done = matches.first(where: \.booked) { return .sorted(done) }
            if let planned = matches.first { return .planned(planned) }
            return .open
        }

        out[.there] = state(travel.filter { p in
            p.leg == .out || (p.leg == nil && startDay(p, home: home) == span.lowerBound)
        })
        out[.home] = state(travel.filter { p in
            p.leg == .back || (p.leg == nil && startDay(p, home: home) == span.upperBound)
        })

        var night = span.lowerBound
        while night < span.upperBound {
            let covering = stays.filter { nights($0, home: home).contains(night) }
            // A way of getting somewhere that runs through the night (a red-eye).
            let overnight = travel.filter { p in
                guard let s = startDay(p, home: home), let e = endDay(p, home: home) else { return false }
                return s <= night && e > night
            }
            out[.night(night)] = state(covering + overnight)
            night = night.adding(days: 1, in: CalendarRules.utc)
        }

        // Moving on: a day the stay changes from one place to another.
        let ordered = stays.filter(\.booked).sorted { ($0.start ?? .distantPast) < ($1.start ?? .distantPast) }
        for (a, b) in zip(ordered, ordered.dropFirst()) where place(a) != place(b) {
            guard let day = startDay(b, home: home), let left = endDay(a, home: home) else { continue }
            let kind = TripSlot.Kind.move(day, from: shortPlace(a), to: shortPlace(b))
            out[kind] = state(travel.filter { p in
                guard let s = startDay(p, home: home) else { return false }
                return s >= left && s <= day && p.leg != .out && p.leg != .back
            })
        }
        return out
    }

    /// Each day of a traveler's span → the zone they're in: where they sleep
    /// that night, or on the last day where they slept the night before.
    static func zones(of trip: Trip, for member: String, home: TimeZone) -> [Day: TimeZone] {
        let span = span(of: trip, for: member, home: home)
        let stays = pieces(of: trip, for: member).filter { $0.kind == .stay }
        var night: [Day: TimeZone] = [:]
        for stay in stays {
            guard let zone = stay.endZone else { continue }
            for day in nights(stay, home: home) { night[day] = zone }
        }
        var out: [Day: TimeZone] = [:]
        var day = span.lowerBound
        while day <= span.upperBound {
            if let zone = night[day] ?? night[day.adding(days: -1, in: CalendarRules.utc)] { out[day] = zone }
            day = day.adding(days: 1, in: CalendarRules.utc)
        }
        // A day trip, or nights not booked yet: a leg's far end says where they are.
        if out.isEmpty {
            for p in pieces(of: trip, for: member) where p.kind.isTravel && p.leg != .back {
                guard let zone = p.endZone, let s = endDay(p, home: home) else { continue }
                var d = s
                while d <= span.upperBound, out[d] == nil {
                    out[d] = zone
                    d = d.adding(days: 1, in: CalendarRules.utc)
                }
            }
        }
        return out
    }

    /// Everything about a trip, the travelers' slots merged where they're the
    /// same: "Getting home" open for two people is one slot, not two.
    static func view(_ trip: Trip, home: TimeZone) -> TripView {
        var spans: [String: ClosedRange<Day>] = [:]
        var zones: [String: [Day: TimeZone]] = [:]
        var merged: [TripSlot] = []
        for member in trip.travelers {
            spans[member] = span(of: trip, for: member, home: home)
            zones[member] = self.zones(of: trip, for: member, home: home)
            for (kind, state) in slots(of: trip, for: member, home: home) {
                if let at = merged.firstIndex(where: { $0.kind == kind && $0.state == state }) {
                    merged[at].travelers.append(member)
                } else {
                    merged.append(TripSlot(kind: kind, state: state, travelers: [member]))
                }
            }
        }
        merged.sort { a, b in
            if a.kind != b.kind { return a.kind < b.kind }
            return a.state.isOpen && !b.state.isOpen
        }
        return TripView(trip: trip, spans: spans, slots: merged, zones: zones)
    }

    /// A trip's pieces read against their events: an event that's moved
    /// takes its piece's times with it, and one made in Google from an email
    /// can be found again by its Google id after a re-sync.
    static func resolved(_ trip: Trip, rows: [UUID: CalEvent], byGoogleID: [String: CalEvent]) -> Trip {
        var trip = trip
        trip.pieces = trip.pieces.map { piece in
            guard !piece.dayOnly else { return piece }
            let event = piece.eventID.flatMap { rows[$0] } ?? piece.eventGoogleID.flatMap { byGoogleID[$0] }
            guard let event else { return piece }
            var p = piece
            p.eventID = event.id
            if event.allDay {
                let (start, end) = TripPrefill.allDayTimes(event, zone: piece.endZone ?? CalendarRules.familyZone)
                p.start = start
                p.end = end
            } else {
                p.start = event.start
                p.end = event.end ?? piece.end
            }
            if p.toZone == nil, p.kind == .stay { p.toZone = event.locationZone }
            return p
        }
        return trip
    }

    // MARK: Days drawn in the trip's time

    /// The signed-in member's days in their trips' zones: a zone where the
    /// trip knows it, home's own clock where it knows that (a weekend in
    /// Manteca, which the inference must not make a day away). Days a trip
    /// doesn't know are left to the inference.
    static func away(_ views: [TripView], me: String?, inferred: [Day: TimeZone], home: TimeZone) -> [Day: TimeZone] {
        guard let me else { return inferred }
        var out = inferred
        for view in views {
            guard let zones = view.zones[me] else { continue }
            for (day, zone) in zones {
                let noon = day.at(minutes: 12 * 60, in: CalendarRules.utc)
                if zone.secondsFromGMT(for: noon) == home.secondsFromGMT(for: noon) {
                    out[day] = nil
                } else {
                    out[day] = zone
                }
            }
        }
        return out
    }

    // MARK: Suggestions

    /// The days the band covers this week: each trip's run across `days`.
    static func runs(_ trip: Trip, across days: [Day]) -> ClosedRange<Int>? {
        let inside = days.indices.filter { trip.contains(days[$0]) }
        guard let first = inside.first, let last = inside.last else { return nil }
        return first...last
    }
}

/// A trip the app thinks is there, waiting for a yes.
struct TripSuggestion: Identifiable, Hashable, Sendable {
    /// What a no is remembered by.
    var key: String
    var name: String
    var start: Day
    var end: Day
    var travelers: [String]
    /// The events to attach as pieces when it's made: flights and stays.
    var eventIDs: [UUID]
    /// Why it's suggested, in a few words: "Days in Costa Rica time".
    var reason: String

    var id: String { key }

    var trip: Trip { Trip(name: name, start: start, end: end, travelers: travelers) }
}

extension Trips {
    /// Trips the calendar suggests: runs of days away (two or more in one
    /// zone), all-day events that run two days or more, and flights out with
    /// a flight back. None that overlaps a trip of the member's, has been
    /// said no to, or is over.
    static func suggestions(
        events: [EventItem], away: [Day: TimeZone], trips: [Trip], dismissed: Set<String>, me: String?,
        today: Day, home: TimeZone
    ) -> [TripSuggestion] {
        guard let me else { return [] }
        let utc = CalendarRules.utc
        var out: [TripSuggestion] = []
        func involves(_ item: EventItem) -> Bool { item.involved && !item.hidden && !item.event.isDrive }
        let mine = events.filter(involves)

        // Days away, in runs of one zone.
        let days = away.keys.sorted()
        var run: [Day] = []
        func close() {
            defer { run = [] }
            guard run.count >= 2, let zone = away[run[0]] else { return }
            let start = run[0], end = run[run.count - 1]
            let inside = mine.filter { $0.day >= start.adding(days: -1, in: utc) && $0.day <= end.adding(days: 1, in: utc) }
            var travelers = Set([me])
            for item in inside where item.event.locationZone == zone.identifier {
                travelers.insert(item.event.memberEmail)
                travelers.formUnion(item.attendees)
            }
            let attach = inside.filter { [.flight, .stay, .car, .train].contains(TripPrefill.kind(of: $0.event)) }
            out.append(TripSuggestion(
                key: "away:\(zone.identifier):\(start)", name: CalendarRules.zonePlace(zone), start: start, end: end,
                travelers: Array(travelers).sorted(), eventIDs: attach.map(\.id),
                reason: "Days in \(CalendarRules.zonePlace(zone)) time"
            ))
        }
        for day in days {
            if let last = run.last, last.adding(days: 1, in: utc) == day, away[last]?.identifier == away[day]?.identifier {
                run.append(day)
            } else {
                close()
                run = [day]
            }
        }
        close()

        // All-day events two days or more.
        for item in mine where item.event.allDay {
            let first = Day(item.event.start, in: utc)
            guard let end = item.event.end else { continue }
            let last = Day(end.addingTimeInterval(-1), in: utc)
            guard first < last else { continue }
            out.append(TripSuggestion(
                key: "event:\(item.event.googleEventID ?? item.event.id.uuidString.lowercased())", name: item.event.title,
                start: first, end: last, travelers: Array(Set([item.event.memberEmail] + item.attendees)).sorted(),
                eventIDs: [], reason: "A \(first.days(to: last, in: utc) + 1)-day event"
            ))
        }

        // A flight out and the next one back within three weeks.
        let flights = mine.filter { !$0.event.allDay && TripPrefill.kind(of: $0.event) == .flight }
            .sorted { $0.event.start < $1.event.start }
        var used: Set<UUID> = []
        for (n, outbound) in flights.enumerated() where !used.contains(outbound.id) {
            let back = flights.dropFirst(n + 1).first { f in
                !used.contains(f.id) && f.event.start.timeIntervalSince(outbound.event.start) < 21 * 86_400
                    && f.event.start.timeIntervalSince(outbound.event.start) > 12 * 3600
            }
            guard let back else { continue }
            used.formUnion([outbound.id, back.id])
            let prefill = TripPrefill.piece(from: outbound.event, tripID: UUID())
            let start = Trips.day(outbound.event.start, in: prefill.startZone, home: home)
            let returning = TripPrefill.piece(from: back.event, tripID: UUID())
            let end = Trips.day(back.event.start, in: returning.startZone, home: home)
            let name = prefill.toPlace ?? "Trip"
            out.append(TripSuggestion(
                key: "flight:\(outbound.event.googleEventID ?? outbound.id.uuidString.lowercased())", name: name,
                start: start, end: end,
                travelers: Array(Set([outbound.event.memberEmail] + outbound.attendees)).sorted(),
                eventIDs: [outbound.id, back.id], reason: "A flight out and one back"
            ))
        }

        // One suggestion per stretch: the first found wins (days away, then
        // a long event, then flights), and none overlaps a trip already made.
        var kept: [TripSuggestion] = []
        for s in out where s.end >= today && !dismissed.contains(s.key) {
            let overlapsTrip = trips.contains { t in
                t.start <= s.end && s.start <= t.end && (t.travelers.contains(me) || !Set(t.travelers).isDisjoint(with: s.travelers))
            }
            let overlapsKept = kept.contains { $0.start <= s.end && s.start <= $0.end }
            if !overlapsTrip && !overlapsKept { kept.append(s) }
        }
        return kept.sorted { $0.start < $1.start }
    }
}

// MARK: What an event says about itself

/// Reading a flight, stay or rental car out of an event's own words: the
/// title, place and notes Gmail or the airline wrote. Whatever it finds is a
/// guess for the editor to correct.
enum TripPrefill {
    /// Airports by code: the city, and its zone, for each end of a flight.
    static let airports: [String: (city: String, zone: String)] = [
        // Home and the West
        "SFO": ("San Francisco", "America/Los_Angeles"), "OAK": ("Oakland", "America/Los_Angeles"),
        "SJC": ("San Jose", "America/Los_Angeles"), "SMF": ("Sacramento", "America/Los_Angeles"),
        "LAX": ("Los Angeles", "America/Los_Angeles"), "BUR": ("Burbank", "America/Los_Angeles"),
        "SAN": ("San Diego", "America/Los_Angeles"), "SNA": ("Santa Ana", "America/Los_Angeles"),
        "LGB": ("Long Beach", "America/Los_Angeles"), "PSP": ("Palm Springs", "America/Los_Angeles"),
        "SBA": ("Santa Barbara", "America/Los_Angeles"), "FAT": ("Fresno", "America/Los_Angeles"),
        "RNO": ("Reno", "America/Los_Angeles"), "LAS": ("Las Vegas", "America/Los_Angeles"),
        "PDX": ("Portland", "America/Los_Angeles"), "SEA": ("Seattle", "America/Los_Angeles"),
        "PHX": ("Phoenix", "America/Phoenix"), "TUS": ("Tucson", "America/Phoenix"),
        "SLC": ("Salt Lake City", "America/Denver"), "DEN": ("Denver", "America/Denver"),
        "BOI": ("Boise", "America/Boise"), "ABQ": ("Albuquerque", "America/Denver"),
        "ANC": ("Anchorage", "America/Anchorage"), "HNL": ("Honolulu", "Pacific/Honolulu"),
        "OGG": ("Maui", "Pacific/Honolulu"), "KOA": ("Kona", "Pacific/Honolulu"), "LIH": ("Kauai", "Pacific/Honolulu"),
        // The rest of the US
        "DFW": ("Dallas", "America/Chicago"), "DAL": ("Dallas", "America/Chicago"), "IAH": ("Houston", "America/Chicago"),
        "HOU": ("Houston", "America/Chicago"), "AUS": ("Austin", "America/Chicago"), "SAT": ("San Antonio", "America/Chicago"),
        "MSP": ("Minneapolis", "America/Chicago"), "ORD": ("Chicago", "America/Chicago"), "MDW": ("Chicago", "America/Chicago"),
        "STL": ("St. Louis", "America/Chicago"), "MCI": ("Kansas City", "America/Chicago"), "MSY": ("New Orleans", "America/Chicago"),
        "BNA": ("Nashville", "America/Chicago"), "ATL": ("Atlanta", "America/New_York"), "MCO": ("Orlando", "America/New_York"),
        "MIA": ("Miami", "America/New_York"), "FLL": ("Fort Lauderdale", "America/New_York"), "TPA": ("Tampa", "America/New_York"),
        "CLT": ("Charlotte", "America/New_York"), "RDU": ("Raleigh", "America/New_York"), "DCA": ("Washington", "America/New_York"),
        "IAD": ("Washington", "America/New_York"), "BWI": ("Baltimore", "America/New_York"), "PHL": ("Philadelphia", "America/New_York"),
        "EWR": ("Newark", "America/New_York"), "JFK": ("New York", "America/New_York"), "LGA": ("New York", "America/New_York"),
        "BOS": ("Boston", "America/New_York"), "DTW": ("Detroit", "America/Detroit"), "PIT": ("Pittsburgh", "America/New_York"),
        "CLE": ("Cleveland", "America/New_York"),
        // Canada, Mexico, Central America, the Caribbean
        "YVR": ("Vancouver", "America/Vancouver"), "YYC": ("Calgary", "America/Edmonton"), "YYZ": ("Toronto", "America/Toronto"),
        "YUL": ("Montreal", "America/Toronto"), "MEX": ("Mexico City", "America/Mexico_City"), "CUN": ("Cancún", "America/Cancun"),
        "SJD": ("Los Cabos", "America/Mazatlan"), "PVR": ("Puerto Vallarta", "America/Mexico_City"),
        "GDL": ("Guadalajara", "America/Mexico_City"), "SJO": ("San José", "America/Costa_Rica"),
        "LIR": ("Liberia", "America/Costa_Rica"), "PTY": ("Panama City", "America/Panama"),
        "BZE": ("Belize City", "America/Belize"), "GUA": ("Guatemala City", "America/Guatemala"),
        "SJU": ("San Juan", "America/Puerto_Rico"), "NAS": ("Nassau", "America/Nassau"), "MBJ": ("Montego Bay", "America/Jamaica"),
        "BOG": ("Bogotá", "America/Bogota"), "LIM": ("Lima", "America/Lima"),
        // Europe
        "LHR": ("London", "Europe/London"), "LGW": ("London", "Europe/London"), "STN": ("London", "Europe/London"),
        "LCY": ("London", "Europe/London"), "EDI": ("Edinburgh", "Europe/London"), "GLA": ("Glasgow", "Europe/London"),
        "MAN": ("Manchester", "Europe/London"), "DUB": ("Dublin", "Europe/Dublin"), "CDG": ("Paris", "Europe/Paris"),
        "ORY": ("Paris", "Europe/Paris"), "NCE": ("Nice", "Europe/Paris"), "AMS": ("Amsterdam", "Europe/Amsterdam"),
        "BRU": ("Brussels", "Europe/Brussels"), "FRA": ("Frankfurt", "Europe/Berlin"), "MUC": ("Munich", "Europe/Berlin"),
        "BER": ("Berlin", "Europe/Berlin"), "ZRH": ("Zurich", "Europe/Zurich"), "GVA": ("Geneva", "Europe/Zurich"),
        "VIE": ("Vienna", "Europe/Vienna"), "PRG": ("Prague", "Europe/Prague"), "CPH": ("Copenhagen", "Europe/Copenhagen"),
        "ARN": ("Stockholm", "Europe/Stockholm"), "OSL": ("Oslo", "Europe/Oslo"), "HEL": ("Helsinki", "Europe/Helsinki"),
        "KEF": ("Reykjavík", "Atlantic/Reykjavik"), "MAD": ("Madrid", "Europe/Madrid"), "BCN": ("Barcelona", "Europe/Madrid"),
        "LIS": ("Lisbon", "Europe/Lisbon"), "FCO": ("Rome", "Europe/Rome"), "MXP": ("Milan", "Europe/Rome"),
        "VCE": ("Venice", "Europe/Rome"), "FLR": ("Florence", "Europe/Rome"), "ATH": ("Athens", "Europe/Athens"),
        "IST": ("Istanbul", "Europe/Istanbul"),
        // Further
        "NRT": ("Tokyo", "Asia/Tokyo"), "HND": ("Tokyo", "Asia/Tokyo"), "KIX": ("Osaka", "Asia/Tokyo"),
        "ICN": ("Seoul", "Asia/Seoul"), "HKG": ("Hong Kong", "Asia/Hong_Kong"), "TPE": ("Taipei", "Asia/Taipei"),
        "SIN": ("Singapore", "Asia/Singapore"), "BKK": ("Bangkok", "Asia/Bangkok"), "DXB": ("Dubai", "Asia/Dubai"),
        "DOH": ("Doha", "Asia/Qatar"), "SYD": ("Sydney", "Australia/Sydney"), "MEL": ("Melbourne", "Australia/Melbourne"),
        "AKL": ("Auckland", "Pacific/Auckland"),
    ]

    /// Airlines by their two-letter code, for "UA 2312".
    static let airlines: [String: String] = [
        "UA": "United", "AA": "American", "DL": "Delta", "AS": "Alaska", "WN": "Southwest", "B6": "JetBlue",
        "NK": "Spirit", "F9": "Frontier", "HA": "Hawaiian", "SY": "Sun Country", "G4": "Allegiant",
        "AC": "Air Canada", "WS": "WestJet", "AM": "Aeroméxico", "Y4": "Volaris", "CM": "Copa", "AV": "Avianca",
        "BA": "British Airways", "VS": "Virgin Atlantic", "EI": "Aer Lingus", "AF": "Air France", "KL": "KLM",
        "LH": "Lufthansa", "LX": "Swiss", "OS": "Austrian", "IB": "Iberia", "TP": "TAP", "AY": "Finnair",
        "SK": "SAS", "FI": "Icelandair", "FR": "Ryanair", "U2": "easyJet", "VY": "Vueling", "TK": "Turkish",
        "EK": "Emirates", "QR": "Qatar", "NH": "ANA", "JL": "JAL", "CX": "Cathay", "SQ": "Singapore",
        "QF": "Qantas", "NZ": "Air New Zealand", "KE": "Korean Air", "LA": "LATAM",
    ]

    private static let carCompanies = ["Hertz", "Avis", "Enterprise", "National", "Budget", "Alamo", "Sixt", "Thrifty", "Dollar", "Europcar", "Turo"]
    private static let stayWords = [
        "hotel", "inn", "resort", "lodge", "motel", "airbnb", "vrbo", "hostel", "suites", "check-in", "check in",
        "stay at", "staying at", "b&b", "bed and breakfast", "marriott", "hilton", "hyatt", "westin", "sheraton",
        "holiday inn", "hampton", "courtyard", "four seasons", "ritz", "residence inn", "embassy suites", "doubletree",
    ]
    private static let trainWords = ["train", "amtrak", "eurostar", "rail", "tgv", "lner", "avanti", "caltrain"]

    private static func text(_ event: CalEvent) -> String {
        [event.title, event.location ?? "", event.notes ?? ""].joined(separator: "\n")
    }

    private static func matches(_ pattern: String, in text: String, options: NSRegularExpression.Options = []) -> [[String]] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).map { match in
            (0..<match.numberOfRanges).map { i in
                Range(match.range(at: i), in: text).map { String(text[$0]) } ?? ""
            }
        }
    }

    /// "UA 2312" from "Flight to San José (UA 2312)", when the airline is one known.
    static func flightNumber(in text: String) -> (airline: String, code: String, number: String)? {
        for m in matches(#"\b([A-Z][A-Z0-9])\s?(\d{1,4})\b"#, in: text) {
            if let airline = airlines[m[1]], !m[1].allSatisfy(\.isNumber) { return (airline, m[1], m[2]) }
        }
        return nil
    }

    /// Airport codes in the order they're written.
    static func airportCodes(in text: String) -> [String] {
        var seen: [String] = []
        for m in matches(#"\b([A-Z]{3})\b"#, in: text) where airports[m[1]] != nil && !seen.contains(m[1]) {
            seen.append(m[1])
        }
        return seen
    }

    /// The code after "Confirmation", "Record locator", "Booking reference", "PNR".
    static func confirmation(in text: String) -> String? {
        let label = #"(?:confirmation(?:\s*(?:code|number|no\.?|#))?|conf(?:\.|irmation)?\s*#|record\s+locator|booking\s+(?:reference|ref\.?|code|number|id)|reservation\s+(?:code|number|no\.?|#|id)|itinerary\s+(?:number|#)|PNR)"#
        let pattern = label + #"\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,15})\b"#
        for m in matches(pattern, in: text, options: [.caseInsensitive]) {
            let code = m[1]
            // A word that happens to follow the label ("Confirmation number is…") isn't a code.
            if code.contains(where: \.isNumber) || code == code.uppercased() { return code.uppercased() }
        }
        return nil
    }

    static func phone(in text: String) -> String? {
        matches(#"(\+?\d[\d\s().-]{7,}\d)"#, in: text).first.map { $0[1].trimmingCharacters(in: .whitespaces) }
    }

    /// Whether a word or phrase is in the text as words: "inn" isn't in "dinner".
    private static func has(_ word: String, in text: String) -> Bool {
        let escaped = NSRegularExpression.escapedPattern(for: word)
        return text.range(of: "(?<![a-z])\(escaped)(?![a-z])", options: .regularExpression) != nil
    }

    /// What kind of piece an event looks like.
    static func kind(of event: CalEvent) -> PieceKind {
        let lower = text(event).lowercased()
        let title = event.title.lowercased()
        let carWords = ["car", "rental", "pickup", "pick up", "pick-up", "return", "vehicle"]
        if title.contains("flight") || flightNumber(in: event.title) != nil
            || (airportCodes(in: event.title + " " + (event.location ?? "")).count >= 1 && title.contains(" to ")) {
            return .flight
        }
        if trainWords.contains(where: { has($0, in: title) }) { return .train }
        if has("ferry", in: title) { return .ferry }
        if has("bus", in: title) { return .bus }
        if lower.contains("rental car") || lower.contains("car rental")
            || (carCompanies.contains { has($0.lowercased(), in: lower) } && carWords.contains { has($0, in: lower) }) {
            return .car
        }
        if stayWords.contains(where: { has($0, in: lower) }) { return .stay }
        if title.hasPrefix("drive") || title.contains("road trip") { return .drive }
        return .other
    }

    /// A stay on all-day events: check-in at 3pm on its first day and out at
    /// 11 on the day after its last, in its own zone.
    static func allDayTimes(_ event: CalEvent, zone: TimeZone) -> (Date, Date) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let first = Day(event.start, in: CalendarRules.utc)
        // Google's all-day end is the morning after the last day.
        let out = event.end.map { Day($0, in: CalendarRules.utc) } ?? first.adding(days: 1, in: CalendarRules.utc)
        let checkout = out > first ? out : first.adding(days: 1, in: CalendarRules.utc)
        return (first.at(minutes: 15 * 60, in: calendar), checkout.at(minutes: 11 * 60, in: calendar))
    }

    /// A destination from "Flight to San José" or "Train to London".
    private static func destination(in title: String) -> String? {
        guard let m = matches(#"(?i)\bto\s+([^()\n,]+?)(?:\s*\(|\s*$|,|\s+-\s)"#, in: title).first else { return nil }
        let place = m[1].trimmingCharacters(in: .whitespaces)
        return place.isEmpty ? nil : place
    }

    /// A piece read from an event: its kind, times, places and zones, the
    /// confirmation code and whatever else the words give. `leg` is left for
    /// the trip to decide (`role`).
    static func piece(from event: CalEvent, tripID: UUID) -> TripPiece {
        let all = text(event)
        let kind = kind(of: event)
        var piece = TripPiece(tripID: tripID, kind: kind, eventID: event.id, eventGoogleID: event.googleEventID, title: event.title)
        piece.confirmation = confirmation(in: all)
        if event.allDay {
            let zone = event.locationZone.flatMap(TimeZone.init(identifier:)) ?? CalendarRules.familyZone
            let (start, end) = allDayTimes(event, zone: zone)
            piece.start = start
            piece.end = end
        } else {
            piece.start = event.start
            piece.end = event.end
        }

        switch kind {
        case .flight:
            if let f = flightNumber(in: all) {
                piece.details["airline"] = f.airline
                piece.details["flight_number"] = "\(f.code) \(f.number)"
            }
            let codes = airportCodes(in: event.title + "\n" + (event.location ?? "") + "\n" + (event.notes ?? ""))
            let to = destination(in: event.title)
            // The destination's airport: the city written after "to" (exactly,
            // then without accents: "San José" is SJO, "San Jose" either), one
            // of its codes written in the text first; else the second code.
            func cities(_ options: String.CompareOptions) -> [String] {
                guard let to else { return [] }
                return airports.filter { $0.value.city.compare(to, options: options) == .orderedSame }.map(\.key).sorted()
            }
            let exact = cities([.caseInsensitive])
            let named = exact.isEmpty ? cities([.caseInsensitive, .diacriticInsensitive]) : exact
            let toCode = codes.first(where: named.contains) ?? named.first ?? codes.dropFirst().first
            let fromCode = codes.first { $0 != toCode }
            if let fromCode, let a = airports[fromCode] {
                piece.fromPlace = fromCode
                piece.fromZone = a.zone
            } else {
                piece.fromPlace = event.location
                piece.fromZone = event.locationZone
            }
            if let toCode, let a = airports[toCode] {
                piece.toPlace = to ?? a.city
                piece.details["to_airport"] = toCode
                piece.toZone = a.zone
            } else if let to {
                piece.toPlace = to
            }
            if piece.fromPlace == nil, let fromCode { piece.fromPlace = fromCode }
        case .stay:
            piece.toPlace = stayName(event.title)
            if let location = event.location, !location.isEmpty { piece.details["address"] = location }
            piece.toZone = event.locationZone
            if let phone = phone(in: event.notes ?? "") { piece.details["phone"] = phone }
        case .car:
            if let company = carCompanies.first(where: { has($0.lowercased(), in: all.lowercased()) }) {
                piece.details["company"] = company
            }
            piece.fromPlace = event.location
            piece.fromZone = event.locationZone
            piece.toZone = event.locationZone
        case .train, .bus, .ferry, .drive, .other:
            piece.fromPlace = event.location
            piece.fromZone = event.locationZone
            piece.toPlace = destination(in: event.title)
        }
        return piece
    }

    /// "Hotel Arenal Kioro" from "Stay at Hotel Arenal Kioro" or "Check-in: Hotel Arenal Kioro".
    private static func stayName(_ title: String) -> String {
        var name = title
        for prefix in ["stay at ", "staying at ", "check-in: ", "check in: ", "check-in at ", "hotel stay: ", "stay: "] {
            if name.lowercased().hasPrefix(prefix) { name = String(name.dropFirst(prefix.count)) }
        }
        return name.trimmingCharacters(in: .whitespaces)
    }

    /// Which slot a way of getting somewhere on a trip fills, by its day:
    /// getting there on or before the first, home on or after the last.
    static func role(of piece: TripPiece, in trip: Trip, home: TimeZone) -> LegRole? {
        guard piece.kind.isTravel, let day = Trips.startDay(piece, home: home) else { return nil }
        if day <= trip.start { return .out }
        if day >= trip.end { return .back }
        return .between
    }
}
