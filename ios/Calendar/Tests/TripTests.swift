import Foundation
import Testing
@testable import FamilyCalendar

// Trips (Shared/Trips.swift): what's still to book, which time each day is
// in, what the calendar suggests, and what an event says about itself.

private func zone(_ id: String) -> TimeZone { TimeZone(identifier: id)! }
private let home = zone("America/Los_Angeles")
private let costaRica = zone("America/Costa_Rica")

private func calendar(_ tz: TimeZone) -> Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = tz
    return c
}

private func d(_ day: Int) -> Day { Day(year: 2026, month: 11, day: day) }
private func at(_ day: Int, _ hour: Int, _ tz: TimeZone = home) -> Date { d(day).at(minutes: hour * 60, in: calendar(tz)) }

private let andrew = "andrew@x.io", jenny = "jenny@x.io"

/// Costa Rica, Nov 22–29: two of us, seven nights.
private func trip(_ pieces: [TripPiece] = []) -> Trip {
    var t = Trip(name: "Costa Rica", start: d(22), end: d(29), travelers: [andrew, jenny])
    t.pieces = pieces.map { var p = $0; p.tripID = t.id; return p }
    return t
}

private func flight(_ day: Int, _ hour: Int, leg: LegRole? = nil, to: TimeZone = costaRica, hours: Double = 6, for who: [String]? = nil) -> TripPiece {
    let start = at(day, hour)
    return TripPiece(
        tripID: UUID(), kind: .flight, leg: leg, start: start, end: start.addingTimeInterval(hours * 3600),
        fromZone: "America/Los_Angeles", toZone: to.identifier, travelers: who
    )
}

private func stay(_ from: Int, _ to: Int, _ name: String = "Arenal Kioro", booked: Bool = true, for who: [String]? = nil) -> TripPiece {
    TripPiece(
        tripID: UUID(), kind: .stay, booked: booked, title: name, start: at(from, 15, costaRica), end: at(to, 11, costaRica),
        toPlace: name, toZone: costaRica.identifier, travelers: who
    )
}

@Suite struct TripSlots {
    @Test func aStubHasEverythingOpen() {
        let view = Trips.view(trip(), home: home)
        // Getting there, seven nights, getting home: for both, as one slot each.
        #expect(view.open.count == 9)
        #expect(view.open.allSatisfy { Set($0.travelers) == [andrew, jenny] })
        #expect(view.open.first?.kind == .there)
        #expect(view.open.last?.kind == .home)
    }

    @Test func bookedPiecesCloseTheirSlots() {
        let view = Trips.view(trip([flight(22, 7), stay(22, 29), flight(29, 14, to: home)]), home: home)
        #expect(view.open.isEmpty)
    }

    @Test func aPlannedStayLeavesItsNightsOpenButSaysSo() {
        let view = Trips.view(trip([flight(22, 7), stay(22, 26), stay(26, 29, "Tabacón", booked: false), flight(29, 14)]), home: home)
        let nights = view.open.filter { if case .night = $0.kind { return true }; return false }
        #expect(nights.count == 3)
        #expect(nights.allSatisfy { if case .planned = $0.state { return true }; return false })
    }

    @Test func movingBetweenStaysNeedsAWay() {
        let pieces = [flight(22, 7), stay(22, 25, "Hotel, 1 Royal Mile, Edinburgh EH1, UK"), stay(25, 29, "Hotel, 2 Strand, London WC2, UK"), flight(29, 14)]
        let open = Trips.view(trip(pieces), home: home).open
        #expect(open.count == 1)
        guard case .move(let day, let from, let to) = open.first?.kind else {
            Issue.record("expected a move")
            return
        }
        #expect(day == d(25))
        #expect(from == "Edinburgh")
        #expect(to == "London")
        var train = TripPiece(tripID: UUID(), kind: .train, start: at(25, 10, costaRica), fromZone: costaRica.identifier)
        train.leg = .between
        #expect(Trips.view(trip(pieces + [train]), home: home).open.isEmpty)
    }

    @Test func someoneFlyingHomeEarlyNeedsNoBedAfter() {
        // Andrew flies back on the 26th; Jenny stays to the end.
        let pieces = [flight(22, 7), stay(22, 29), flight(26, 9, leg: .back, to: home, for: [andrew]), flight(29, 14, leg: .back, to: home, for: [jenny])]
        let view = Trips.view(trip(pieces), home: home)
        #expect(view.open.isEmpty)
        #expect(view.spans[andrew] == d(22)...d(26))
        #expect(view.spans[jenny] == d(22)...d(29))
    }

    @Test func slotsAreSaidPerPerson() {
        let pieces = [flight(22, 7), stay(22, 29), flight(29, 14, leg: .back, to: home, for: [jenny])]
        let open = Trips.view(trip(pieces), home: home).open
        #expect(open.count == 1)
        #expect(open.first?.kind == .home)
        #expect(open.first?.travelers == [andrew])
    }

    @Test func aRedEyeCoversItsNight() {
        // Out on the evening of the 22nd, landing the next morning.
        let pieces = [flight(22, 21, hours: 14), stay(23, 29), flight(29, 14)]
        #expect(Trips.view(trip(pieces), home: home).open.isEmpty)
    }

    @Test func drivingOneDayEachWayNeedsNoTimes() {
        var weekend = Trip(name: "Manteca", start: d(5), end: d(7), travelers: [andrew])
        var drive = TripPiece(tripID: weekend.id, kind: .drive, start: at(5, 12), details: ["day_only": "true"])
        drive.leg = .out
        var back = drive
        back.id = UUID()
        back.leg = .back
        back.start = at(7, 12)
        weekend.pieces = [drive, back, TripPiece(tripID: weekend.id, kind: .stay, title: "Staying with Grandma", start: at(5, 15), end: at(7, 11))]
        #expect(Trips.view(weekend, home: home).open.isEmpty)
    }
}

@Suite struct TripTime {
    @Test func daysAreInTheZoneOfTheNightsStay() {
        let view = Trips.view(trip([flight(22, 7), stay(22, 29)]), home: home)
        #expect(view.zone(for: andrew, on: d(22))?.identifier == costaRica.identifier)
        // The last day is in the zone of the night before.
        #expect(view.zone(for: andrew, on: d(29))?.identifier == costaRica.identifier)
        #expect(view.placeName == "Costa Rica")
    }

    @Test func aTripOverridesTheGuessAndHomeTimeWins() {
        // The guess had the 23rd away; a trip in home's own time says it isn't.
        var weekend = Trip(name: "Manteca", start: d(23), end: d(24), travelers: [andrew])
        weekend.pieces = [TripPiece(tripID: weekend.id, kind: .stay, start: at(23, 15), end: at(24, 11), toZone: home.identifier)]
        let view = Trips.view(weekend, home: home)
        let away = Trips.away([view], me: andrew, inferred: [d(23): costaRica, d(30): costaRica], home: home)
        #expect(away[d(23)] == nil)
        #expect(away[d(30)]?.identifier == costaRica.identifier)
        // Someone else's trip leaves my days alone.
        #expect(Trips.away([view], me: jenny, inferred: [d(23): costaRica], home: home)[d(23)] != nil)
    }
}

@Suite struct TripPrefillReading {
    private func event(_ title: String, location: String? = nil, notes: String? = nil, allDay: Bool = false) -> CalEvent {
        CalEvent(memberEmail: andrew, title: title, notes: notes, location: location, start: at(22, 7), end: at(22, 13), allDay: allDay)
    }

    @Test func aGmailFlight() {
        let e = event("Flight to San José (UA 1590)", location: "San Francisco SFO", notes: "Confirmation: K7QX2P")
        let p = TripPrefill.piece(from: e, tripID: UUID())
        #expect(p.kind == .flight)
        #expect(p.details["airline"] == "United")
        #expect(p.details["flight_number"] == "UA 1590")
        #expect(p.fromPlace == "SFO")
        #expect(p.fromZone == "America/Los_Angeles")
        #expect(p.toPlace == "San José")
        #expect(p.toZone == "America/Costa_Rica")
        #expect(p.confirmation == "K7QX2P")
    }

    @Test func aFlightNamedByCodes() {
        let p = TripPrefill.piece(from: event("BA 1435 EDI to LHR"), tripID: UUID())
        #expect(p.kind == .flight)
        #expect(p.fromPlace == "EDI")
        #expect(p.details["to_airport"] == "LHR")
        #expect(p.toZone == "Europe/London")
    }

    @Test func confirmationCodes() {
        #expect(TripPrefill.confirmation(in: "Record locator: ABC12D") == "ABC12D")
        #expect(TripPrefill.confirmation(in: "Booking reference 4821-9907") == "4821-9907")
        #expect(TripPrefill.confirmation(in: "PNR: QWERTY") == "QWERTY")
        #expect(TripPrefill.confirmation(in: "Your confirmation number is below") == nil)
    }

    @Test func aStayAndACar() {
        var hotel = event("Stay at Hotel Arenal Kioro", location: "La Fortuna, Costa Rica", notes: "Reservation number: 77120\nCall +506 2479 1700", allDay: true)
        hotel.end = CalendarRules.allDayInstant(d(25))
        hotel.start = CalendarRules.allDayInstant(d(22))
        hotel.locationZone = "America/Costa_Rica"
        let p = TripPrefill.piece(from: hotel, tripID: UUID())
        #expect(p.kind == .stay)
        #expect(p.toPlace == "Hotel Arenal Kioro")
        #expect(p.confirmation == "77120")
        #expect(p.details["phone"] == "+506 2479 1700")
        #expect(Trips.nights(p, home: home) == [d(22), d(23), d(24)])
        #expect(TripPrefill.kind(of: event("Hertz pickup", location: "SJO")) == .car)
        #expect(TripPrefill.kind(of: event("Team dinner")) == .other)
    }

    @Test func theLegFollowsTheDay() {
        let t = trip()
        #expect(TripPrefill.role(of: flight(22, 7), in: t, home: home) == .out)
        #expect(TripPrefill.role(of: flight(25, 7), in: t, home: home) == .between)
        #expect(TripPrefill.role(of: flight(29, 7), in: t, home: home) == .back)
    }
}

@Suite struct TripSuggestions {
    private func item(_ e: CalEvent) -> EventItem {
        EventItem(event: e, day: CalendarRules.day(of: e, in: calendar(home)), attendees: [], color: "#000000", involved: true)
    }

    @Test func daysAwaySuggestATripUnlessOneIsThere() {
        let away = [d(22): costaRica, d(23): costaRica, d(24): costaRica]
        let found = Trips.suggestions(events: [], away: away, trips: [], dismissed: [], me: andrew, today: d(1), home: home)
        #expect(found.count == 1)
        #expect(found.first?.name == "Costa Rica")
        #expect(found.first?.start == d(22))
        #expect(found.first?.end == d(24))
        #expect(Trips.suggestions(events: [], away: away, trips: [trip()], dismissed: [], me: andrew, today: d(1), home: home).isEmpty)
        let key = found[0].key
        #expect(Trips.suggestions(events: [], away: away, trips: [], dismissed: [key], me: andrew, today: d(1), home: home).isEmpty)
    }

    @Test func aLongAllDayEventAndAPairOfFlights() {
        var tahoe = CalEvent(memberEmail: andrew, title: "Tahoe", start: CalendarRules.allDayInstant(d(10)), allDay: true)
        tahoe.end = CalendarRules.allDayInstant(d(13))
        let out = CalEvent(memberEmail: andrew, title: "Flight to Edinburgh (UA 162)", location: "SFO", start: at(20, 18), end: at(21, 8))
        let back = CalEvent(memberEmail: andrew, title: "Flight to San Francisco (UA 925)", location: "LHR", start: at(28, 12), end: at(28, 22))
        let found = Trips.suggestions(events: [tahoe, out, back].map(item), away: [:], trips: [], dismissed: [], me: andrew, today: d(1), home: home)
        #expect(found.map(\.name) == ["Tahoe", "Edinburgh"])
        #expect(found[0].end == d(12))
        #expect(found[1].start == d(20))
        #expect(found[1].end == d(28))
        #expect(found[1].eventIDs == [out.id, back.id])
    }
}
