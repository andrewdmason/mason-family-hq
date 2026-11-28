import Foundation

// Trips in words, and the pieces a tap makes: shared by the Mac's trip
// panel (Mac/TripViews.swift) and the phone's trip page (iPhone/TripPage.swift).
// The rules themselves are Trips.swift.

/// How trips read in words.
enum TripFormat {
    private static let english = Locale(identifier: "en_US")

    /// "Nov 22 – 29", "Nov 28 – Dec 3", "Dec 9" for one day.
    static func dates(_ start: Day, _ end: Day) -> String {
        let utc = CalendarRules.utc
        let a = start.at(minutes: 12 * 60, in: utc), b = end.at(minutes: 12 * 60, in: utc)
        let first = a.formatted(Date.FormatStyle(locale: english, timeZone: utc.timeZone).month(.abbreviated).day())
        if start == end { return first }
        let last = start.month == end.month
            ? b.formatted(Date.FormatStyle(locale: english, timeZone: utc.timeZone).day())
            : b.formatted(Date.FormatStyle(locale: english, timeZone: utc.timeZone).month(.abbreviated).day())
        return "\(first) – \(last)"
    }

    /// "Sat 22".
    static func day(_ day: Day) -> String {
        let utc = CalendarRules.utc
        return day.at(minutes: 12 * 60, in: utc).formatted(Date.FormatStyle(locale: english, timeZone: utc.timeZone).weekday(.abbreviated).day())
    }

    /// "7:05 AM", in a zone's clock.
    static func time(_ date: Date, in zone: TimeZone?) -> String {
        var style = Date.FormatStyle(date: .omitted, time: .shortened, locale: english)
        style.timeZone = zone ?? CalendarRules.familyZone
        return date.formatted(style)
    }

    /// "Costa Rica time" when a zone isn't home's, else nothing.
    static func zoneName(_ zone: TimeZone?, at date: Date) -> String? {
        guard let zone, zone.secondsFromGMT(for: date) != CalendarRules.familyZone.secondsFromGMT(for: date) else { return nil }
        return "\(CalendarRules.zonePlace(zone)) time"
    }

    /// "Andrew and Jenny", "everyone".
    static func people(_ emails: [String], of trip: Trip, board: Board) -> String {
        if Set(emails) == Set(trip.travelers), trip.travelers.count > 2 { return "everyone" }
        if Set(emails) == Set(trip.travelers), trip.travelers.count == 2 { return "both" }
        let names = emails.compactMap { board.member($0)?.firstName }
        return ListFormatter.localizedString(byJoining: names)
    }

    /// Where a piece goes, and when: "SFO 7:05 AM → San José 1:40 PM".
    static func route(_ piece: TripPiece) -> String {
        guard let start = piece.start else { return [piece.fromPlace, piece.toPlace].compactMap { $0 }.joined(separator: " → ") }
        if piece.dayOnly { return [piece.fromPlace, piece.toPlace].compactMap { $0 }.joined(separator: " → ") }
        var out = [piece.fromPlace, time(start, in: piece.startZone)].compactMap { $0 }.joined(separator: " ")
        if let end = piece.end {
            out += " → " + [piece.toPlace, time(end, in: piece.endZone)].compactMap { $0 }.joined(separator: " ")
        }
        return out
    }

    /// The zones a piece can be set in: home's, the ones on the trip, the airports'.
    static func zones(for trip: Trip) -> [String] {
        var seen = [CalendarRules.familyZone.identifier]
        for p in trip.pieces { for z in [p.fromZone, p.toZone].compactMap({ $0 }) where !seen.contains(z) { seen.append(z) } }
        let more = Set(TripPrefill.airports.values.map(\.zone)).subtracting(seen).sorted()
        return seen + more
    }
}

extension TripFormat {
    /// "SFO 7:05 AM → San José 1:40 PM · United UA 1590"; "In 3:00 PM · out Sat 12 11:00 AM · the address".
    static func detail(_ piece: TripPiece) -> String {
        var parts: [String] = []
        let home = CalendarRules.familyZone
        switch piece.kind {
        case .stay:
            if !piece.dayOnly, let s = piece.start, let e = piece.end {
                let out = Trips.endDay(piece, home: home).map(day) ?? ""
                parts.append("In \(time(s, in: piece.endZone)) · out \(out) \(time(e, in: piece.endZone))")
            } else if let out = Trips.endDay(piece, home: home) {
                parts.append("Until \(day(out))")
            }
            if let address = piece.details["address"], address != piece.displayTitle { parts.append(address) }
        case .car:
            if let s = piece.start { parts.append("Pickup \(time(s, in: piece.startZone))") }
            if let company = piece.details["company"] { parts.append(company) }
        default:
            let line = route(piece)
            if !line.isEmpty { parts.append(line) }
            let number = [piece.details["airline"], piece.details["flight_number"] ?? piece.details["number"]].compactMap { $0 }.joined(separator: " ")
            if !number.isEmpty { parts.append(number) }
            if let seat = piece.details["seat"] { parts.append("Seats \(seat)") }
        }
        return parts.joined(separator: " · ")
    }

    /// "Sat, Dec 12 night", or for nights in a row "3 nights from Sat, Dec 12".
    static func title(_ slots: [TripSlot]) -> String {
        guard let slot = slots.first else { return "" }
        guard slots.count > 1, case .night(let first) = slot.kind else { return slot.title() }
        let from = first.at(minutes: 12 * 60, in: CalendarRules.utc)
            .formatted(Date.FormatStyle(locale: english, timeZone: CalendarRules.utc.timeZone).weekday(.abbreviated).month(.abbreviated).day())
        return "\(slots.count) nights from \(from)"
    }

    /// "Planned, not booked: Tabacón Resort · for everyone"; "Nothing yet · for Andrew".
    static func subtitle(_ slot: TripSlot, of trip: Trip, board: Board) -> String {
        let who = people(slot.travelers, of: trip, board: board)
        if case .planned(let piece) = slot.state { return "Planned, not booked: \(piece.displayTitle) · for \(who)" }
        return "Nothing yet · for \(who)"
    }

    static func symbol(_ slot: TripSlot) -> String {
        switch slot.kind {
        case .there: "airplane.departure"
        case .home: "airplane.arrival"
        case .night: "bed.double"
        case .move: "arrow.triangle.swap"
        }
    }

    /// The day a slot is about, for a new piece to start on.
    static func day(of slot: TripSlot, in view: TripView) -> Day {
        let trip = view.trip
        switch slot.kind {
        case .there: return slot.travelers.compactMap { view.spans[$0]?.lowerBound }.min() ?? trip.start
        case .home: return slot.travelers.compactMap { view.spans[$0]?.upperBound }.max() ?? trip.end
        case .move(let day, _, _), .night(let day): return day
        }
    }
}

/// What's on one day of a trip: the ways of getting somewhere and cars that
/// start on it, the stays checked into on it, the stays slept in that night,
/// and the travelers' other events.
struct TripDay {
    var day: Day
    var travel: [TripPiece]
    var checkIns: [TripPiece]
    var tonight: [TripPiece]
    var events: [EventItem]
    /// The trip's last day, with no night to sleep.
    var isLast: Bool

    init(_ view: TripView, day: Day, board: Board) {
        let trip = view.trip
        let home = CalendarRules.familyZone
        self.day = day
        travel = trip.pieces.filter { ($0.kind.isTravel || $0.kind == .car) && Trips.startDay($0, home: home) == day }
        checkIns = trip.pieces.filter { $0.kind == .stay && Trips.startDay($0, home: home) == day }
        tonight = trip.pieces.filter { $0.kind == .stay && Trips.nights($0, home: home).contains(day) }
        let attached = Set(trip.pieces.compactMap(\.eventID))
        let travelers = Set(trip.travelers)
        events = board.events(on: day, showHidden: false).filter { item in
            !attached.contains(item.id) && !item.event.isDrive && item.involved
                && !Set(item.attendees + [item.event.memberEmail]).isDisjoint(with: travelers)
        }
        isLast = day == trip.end
    }
}

extension Trip {
    /// A suggestion's trip, remembering which suggestion it came from, so
    /// making it attaches its flights and stays.
    func withSuggestion(_ suggestion: TripSuggestion) -> Trip {
        var trip = self
        trip.notes = "suggestion:\(suggestion.key)"
        return trip
    }

    var suggestionKey: String? {
        guard let notes, notes.hasPrefix("suggestion:") else { return nil }
        return String(notes.dropFirst("suggestion:".count))
    }
}

extension String {
    /// "Everyone" from "everyone"; the rest left as it is.
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// New pieces as the editor first shows them.
enum TripEditing {
    /// A piece of a kind on a day: a way of getting somewhere leaving at nine,
    /// a stay from three that day to eleven the next, in the trip's zone there.
    static func blank(_ kind: PieceKind, trip: Trip, on day: Day, leg: LegRole?, for travelers: [String]? = nil) -> TripPiece {
        let view = Trips.view(trip, home: CalendarRules.familyZone)
        let zone = view.zones.values.compactMap { $0[day] }.first ?? CalendarRules.familyZone
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        var piece = TripPiece(tripID: trip.id, kind: kind, leg: kind.isTravel ? leg : nil)
        piece.travelers = travelers.flatMap { Set($0) == Set(trip.travelers) ? nil : $0 }
        if kind == .stay {
            piece.start = day.at(minutes: 15 * 60, in: calendar)
            piece.end = day.adding(days: 1, in: CalendarRules.utc).at(minutes: 11 * 60, in: calendar)
            piece.toZone = zone.identifier
        } else {
            piece.start = day.at(minutes: 9 * 60, in: calendar)
            piece.end = day.at(minutes: 11 * 60, in: calendar)
            piece.fromZone = (leg == .out ? CalendarRules.familyZone : zone).identifier
            piece.toZone = (leg == .back ? CalendarRules.familyZone : zone).identifier
            if piece.leg == nil, kind.isTravel { piece.leg = TripPrefill.role(of: piece, in: trip, home: CalendarRules.familyZone) }
        }
        return piece
    }

    /// "We're driving": a way there with no booking and no time, on the
    /// slot's day; with the drive home too when that's open as well.
    static func driving(_ slot: TripSlot, view: TripView) -> [TripPiece] {
        let trip = view.trip
        func drive(_ leg: LegRole, on day: Day) -> TripPiece {
            var p = TripPiece(tripID: trip.id, kind: .drive, leg: leg, title: "Driving", details: ["day_only": "true"])
            p.start = day.at(minutes: 12 * 60, in: calendar(CalendarRules.familyZone))
            p.travelers = Set(slot.travelers) == Set(trip.travelers) ? nil : slot.travelers
            return p
        }
        let first = slot.travelers.compactMap { view.spans[$0]?.lowerBound }.min() ?? trip.start
        let last = slot.travelers.compactMap { view.spans[$0]?.upperBound }.max() ?? trip.end
        switch slot.kind {
        case .there:
            var out = [drive(.out, on: first)]
            if view.open.contains(where: { $0.kind == .home && $0.travelers == slot.travelers }) { out.append(drive(.back, on: last)) }
            return out
        case .home:
            var out = [drive(.back, on: last)]
            if view.open.contains(where: { $0.kind == .there && $0.travelers == slot.travelers }) { out.append(drive(.out, on: first)) }
            return out
        case .move(let day, let from, let to):
            var p = drive(.between, on: day)
            p.fromPlace = from
            p.toPlace = to
            return [p]
        case .night:
            return []
        }
    }

    /// "Staying with family": a stay with no booking from this night through
    /// the open nights that follow it for the same people.
    static func withFamily(_ slot: TripSlot, view: TripView) -> TripPiece? {
        guard case .night(let first) = slot.kind else { return nil }
        let trip = view.trip
        var last = first
        while view.open.contains(where: { $0.kind == .night(last.adding(days: 1, in: CalendarRules.utc)) && $0.travelers == slot.travelers }) {
            last = last.adding(days: 1, in: CalendarRules.utc)
        }
        let zone = view.zones.values.compactMap { $0[first] }.first ?? CalendarRules.familyZone
        var p = TripPiece(tripID: trip.id, kind: .stay, title: "Staying with family", details: ["day_only": "true"])
        p.start = first.at(minutes: 15 * 60, in: calendar(zone))
        p.end = last.adding(days: 1, in: CalendarRules.utc).at(minutes: 11 * 60, in: calendar(zone))
        p.toZone = zone.identifier
        p.travelers = Set(slot.travelers) == Set(trip.travelers) ? nil : slot.travelers
        return p
    }

    private static func calendar(_ zone: TimeZone) -> Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }
}
