import Foundation
import Testing
@testable import FamilyCalendar

// The website's calendar rules, ported in Shared/CalendarRules.swift and
// CalendarBoard.swift. The cases follow src/lib/calendar/calendar-utils.ts,
// grid-layout.ts, conflicts.ts and recurrence.ts.

private let pacific: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    return c
}()

private func id(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))! }

private let day = Day(year: 2026, month: 11, day: 18)

private func event(
    _ n: Int, _ member: String = "seb@x.io", from: Int = 9 * 60, to: Int? = 10 * 60, allDay: Bool = false,
    _ more: (inout CalEvent) -> Void = { _ in }
) -> CalEvent {
    var e = CalEvent(
        id: id(n), memberEmail: member, title: "Event \(n)",
        start: allDay ? CalendarRules.allDayInstant(day) : day.at(minutes: from, in: pacific),
        end: allDay ? nil : to.map { day.at(minutes: $0, in: pacific) }, allDay: allDay
    )
    more(&e)
    return e
}

@Suite struct Days {
    @Test func allDayIsReadInUTC() {
        // Midnight UTC is still the 17th in California; the event is on the 18th.
        let e = event(1, allDay: true)
        #expect(CalendarRules.day(of: e, in: pacific) == day)
        #expect(Day(e.start, in: pacific) == Day(year: 2026, month: 11, day: 17))
    }

    @Test func timedIsReadInThePhonesZone() {
        #expect(CalendarRules.day(of: event(1, from: 23 * 60, to: nil), in: pacific) == day)
    }

    @Test func weeksStartOnMonday() {
        #expect(day.weekdayIndex(in: pacific) == 2) // a Wednesday
        #expect(day.weekStart(in: pacific) == Day(year: 2026, month: 11, day: 16))
        let grid = day.monthGrid(in: pacific)
        #expect(grid.count == 6)
        #expect(grid[0][0] == Day(year: 2026, month: 10, day: 26))
        #expect(grid[0][6] == Day(year: 2026, month: 11, day: 1))
    }

    @Test func addingDaysCrossesDaylightSaving() {
        let before = Day(year: 2026, month: 10, day: 31)
        #expect(before.adding(days: 1, in: pacific) == Day(year: 2026, month: 11, day: 1))
        #expect(before.adding(days: 2, in: pacific) == Day(year: 2026, month: 11, day: 2))
        #expect(before.days(to: day, in: pacific) == 18)
    }

    @Test func postgresTimestampsParse() {
        #expect(Instant.parse("2026-11-18T17:00:00+00:00") != nil)
        #expect(Instant.parse("2026-11-18T17:00:00.123456+00:00") != nil)
        #expect(Instant.parse("2026-11-18T00:00:00.000Z") == CalendarRules.allDayInstant(day))
    }
}

@Suite struct DaysAway {
    private let home = TimeZone(identifier: "America/Los_Angeles")!
    private let costaRica = "America/Costa_Rica"
    private let me = "andrew@x.io"

    /// An event with a place, at Pacific minutes on a day `offset` from the 18th.
    private func placed(_ n: Int, day offset: Int = 0, from: Int = 9 * 60, in zone: String?, _ member: String = "andrew@x.io") -> CalEvent {
        let on = day.adding(days: offset, in: pacific)
        return CalEvent(
            id: id(n), memberEmail: member, title: "Event \(n)", location: "Somewhere",
            start: on.at(minutes: from, in: pacific), end: on.at(minutes: from + 60, in: pacific), locationZone: zone
        )
    }

    private func board(_ events: [CalEvent], in calendar: Calendar = pacific) -> Board {
        var snapshot = CalendarSnapshot()
        snapshot.members = [Member(email: me, name: "Andrew", role: .owner, color: "#2563eb")]
        snapshot.events = events
        return Board.build(snapshot, me: me, in: calendar)
    }

    @Test func aDayOfPlacesElsewhereIsAway() {
        let away = CalendarRules.awayZones([placed(1, in: costaRica), placed(2, from: 11 * 60, in: costaRica)], home: home)
        #expect(away[day]?.identifier == costaRica)
        #expect(away.count == 1)
    }

    @Test func aDayAtHomeIsNot() {
        #expect(CalendarRules.awayZones([placed(1, in: "America/Los_Angeles"), placed(2, in: nil)], home: home).isEmpty)
        // Another name for the same clock is still home.
        #expect(CalendarRules.awayZones([placed(1, in: "US/Pacific")], home: home).isEmpty)
    }

    @Test func mostOfTheDaysPlacesDecide() {
        let stray = placed(1, in: "America/New_York")
        let local = [placed(2, in: "America/Los_Angeles"), placed(3, in: "America/Los_Angeles")]
        #expect(CalendarRules.awayZones([stray] + local, home: home).isEmpty)
        // A practice left on the calendar at home doesn't undo a day of tours.
        let tours = [placed(4, in: costaRica), placed(5, in: costaRica)]
        #expect(CalendarRules.awayZones(tours + [local[0]], home: home)[day]?.identifier == costaRica)
    }

    @Test func emptyDaysInsideATripAreAwayToo() {
        let away = CalendarRules.awayZones([placed(1, in: costaRica), placed(2, day: 3, in: costaRica)], home: home)
        #expect(away.count == 4)
        #expect(away[day.adding(days: 2, in: pacific)]?.identifier == costaRica)
        // Too far apart to be one trip.
        #expect(CalendarRules.awayZones([placed(1, in: costaRica), placed(2, day: 6, in: costaRica)], home: home).count == 2)
        // A day at home between them isn't bridged.
        let between = placed(3, day: 1, in: "America/Los_Angeles")
        let split = CalendarRules.awayZones([placed(1, in: costaRica), between, placed(2, day: 2, in: costaRica)], home: home)
        #expect(split[day.adding(days: 1, in: pacific)] == nil)
    }

    @Test func allDayDrivesAndPlacelessEventsDontCount() {
        var allDay = placed(1, in: costaRica)
        allDay.allDay = true
        var drive = placed(2, in: costaRica)
        drive.driveSourceEventID = id(9)
        var cleared = placed(3, in: costaRica)
        cleared.location = nil
        #expect(CalendarRules.awayZones([allDay, drive, cleared], home: home).isEmpty)
    }

    @Test func onlyADayOffHomeTimeSaysSo() {
        // Opened on the trip, where the device keeps Costa Rica's time.
        var there = pacific
        there.timeZone = TimeZone(identifier: costaRica)!
        // A day back home is drawn in home time, and that needs no saying.
        let atHome = board([placed(1, in: "America/Los_Angeles")], in: there)
        #expect(atHome.away[day]?.identifier == "America/Los_Angeles")
        #expect(atHome.zoneNote(on: day, in: there) == nil)
        #expect(atHome.zonePlace(on: day, in: there) == nil)
        // A day of the trip is the one that's marked, though it's the device's own time.
        let onTrip = board([placed(1, in: costaRica)], in: there)
        #expect(onTrip.away[day] == nil)
        #expect(onTrip.zoneNote(on: day, in: there) == "Costa Rica time · 2h ahead")
        #expect(onTrip.zonePlace(on: day, in: there) == "Costa Rica")
        // At home, a day at home says nothing either.
        #expect(board([placed(1, in: "America/Los_Angeles")]).zoneNote(on: day, in: pacific) == nil)
    }

    @Test func aDayAwayReadsInItsOwnTime() {
        // 8:45 Pacific is 10:45 in Costa Rica; dinner has no place but is that day.
        let tubing = placed(1, from: 8 * 60 + 45, in: costaRica)
        let dinner = placed(2, from: 17 * 60, in: nil)
        let built = board([tubing, dinner])
        let item = built.item(tubing.id)!
        #expect(item.zone?.identifier == costaRica)
        #expect(CalendarRules.timeRange(item.event, in: item.calendar(in: pacific)) == "10:45 AM – 11:45 AM")
        #expect(built.item(dinner.id)?.zone?.identifier == costaRica)
        #expect(built.zoneNote(on: day, in: pacific) == "Costa Rica time · 2h ahead")
        let layout = DayLayout.build(day: day, board: built, shown: built.members, me: me, showHidden: false, in: pacific)
        #expect(layout.columns[0].blocks.map(\.start) == [10 * 60 + 45, 19 * 60])
    }

    @Test func aLateEventMovesToTheDayItsOnThere() {
        // 11 PM Pacific on a day away is 1 AM the next day there, also away.
        let late = placed(1, from: 23 * 60, in: costaRica)
        let next = placed(2, day: 1, in: costaRica)
        let built = board([placed(3, in: costaRica), late, next])
        #expect(built.item(late.id)?.day == day.adding(days: 1, in: pacific))
    }

    @Test func someoneElsesTripLeavesMyDaysAlone() {
        let hers = placed(1, in: "America/New_York", "jenny@x.io")
        var snapshot = CalendarSnapshot()
        snapshot.members = [
            Member(email: me, name: "Andrew", role: .owner, color: "#2563eb"),
            Member(email: "jenny@x.io", name: "Jenny", role: .parent, color: "#db2777"),
        ]
        snapshot.events = [hers]
        #expect(Board.build(snapshot, me: me, in: pacific).away.isEmpty)
        // Going along makes it mine.
        snapshot.going[hers.id] = [me]
        #expect(Board.build(snapshot, me: me, in: pacific).away[day]?.identifier == "America/New_York")
    }

    @Test func theNoteSaysHowFar() {
        let at = day.at(minutes: 12 * 60, in: pacific)
        #expect(CalendarRules.zoneNote(TimeZone(identifier: "America/New_York")!, home: home, at: at) == "New York time · 3h ahead")
        #expect(CalendarRules.zoneNote(TimeZone(identifier: "Pacific/Honolulu")!, home: home, at: at) == "Honolulu time · 2h behind")
        #expect(CalendarRules.zoneNote(TimeZone(identifier: "Asia/Kolkata")!, home: home, at: at) == "Kolkata time · 13h 30m ahead")
    }

    @Test func theZoneComesFromTheTable() throws {
        let row = #"{"id":"00000000-0000-0000-0000-000000000001","member_email":"a@x.io","title":"Tubing","start_time":"2026-11-18T16:45:00+00:00","source_type":"google","location_time_zone":"America/Costa_Rica"}"#
        #expect(try JSONDecoder().decode(CalEvent.self, from: Data(row.utf8)).locationZone == costaRica)
        #expect(CalEvent.columns.contains("location_time_zone"))
    }
}

@Suite struct SharedEvents {
    @Test func rowsOfOneGoogleEventCollapse() {
        let mine = event(1, "jenny@x.io") { $0.externalID = "google:abc"; $0.organizerEmail = "jenny@x.io" }
        let copy = event(2, "andrew@x.io") { $0.externalID = "google:abc"; $0.organizerEmail = "jenny@x.io" }
        let logical = CalendarRules.logical([copy, mine], going: [:], memberOrder: ["andrew@x.io", "jenny@x.io"])
        #expect(logical.events.map(\.id) == [id(1)]) // the organizer's row owns it
        #expect(logical.attendees[id(1)] == ["andrew@x.io"])
    }

    @Test func aMaterializedRowOwnsItFirst() {
        let ours = event(1, "seb@x.io") { $0.googleEventID = "abc" }
        let guest = event(2, "jenny@x.io") { $0.externalID = "google:abc"; $0.organizerEmail = "jenny@x.io" }
        let logical = CalendarRules.logical([guest, ours], going: [:], memberOrder: ["jenny@x.io", "seb@x.io"])
        #expect(logical.events.map(\.id) == [id(1)])
    }

    @Test func memberOrderSettlesTheRest() {
        let a = event(1, "seb@x.io") { $0.externalID = "google:abc" }
        let b = event(2, "jenny@x.io") { $0.externalID = "google:abc" }
        let logical = CalendarRules.logical([a, b], going: [:], memberOrder: ["jenny@x.io", "seb@x.io"])
        #expect(logical.events.map(\.id) == [id(2)])
    }

    @Test func goingAddsAttendeesButNotTheOwner() {
        let e = event(1, "seb@x.io")
        let logical = CalendarRules.logical([e], going: [id(1): ["seb@x.io", "jenny@x.io"]], memberOrder: [])
        #expect(logical.attendees[id(1)] == ["jenny@x.io"])
    }
}

@Suite struct Hidden {
    private let team = CalSource(id: id(900), memberEmail: "seb@x.io", sourceType: .teamsnap, teamsnapPlayerID: 7, isActive: true)

    @Test func dismissedAndNotGoingAreHidden() {
        #expect(CalendarRules.isHidden(event(1) { $0.dismissed = true }, source: nil))
        #expect(CalendarRules.isHidden(event(1) { $0.ownerNotGoing = true }, source: nil))
        #expect(!CalendarRules.isHidden(event(1), source: nil))
    }

    @Test func teamsnapNotGoingNeedsALinkedPlayer() {
        let declined = event(1) { $0.teamsnapRsvp = .notGoing }
        #expect(CalendarRules.isHidden(declined, source: team))
        var unlinked = team
        unlinked.teamsnapPlayerID = nil
        #expect(!CalendarRules.isHidden(declined, source: unlinked))
        #expect(!CalendarRules.isHidden(event(1) { $0.teamsnapRsvp = .maybe }, source: team))
    }
}

@Suite struct Blocks {
    @Test func arrivalTimeStartsTheBlockEarly() {
        let e = event(1, from: 10 * 60, to: 12 * 60) { $0.teamsnapArrival = day.at(minutes: 9 * 60 + 15, in: pacific) }
        #expect(CalendarRules.startMinutes(e, in: pacific) == 9 * 60 + 15)
        let late = event(1, from: 10 * 60, to: 12 * 60) { $0.teamsnapArrival = day.at(minutes: 11 * 60, in: pacific) }
        #expect(CalendarRules.startMinutes(late, in: pacific) == 10 * 60)
    }

    @Test func ends() {
        #expect(CalendarRules.endMinutes(event(1, from: 540, to: nil), in: pacific) == 570) // no end: half an hour
        #expect(CalendarRules.endMinutes(event(1, from: 540, to: 545), in: pacific) == 555) // at least a quarter
        #expect(CalendarRules.endMinutes(event(1, from: 23 * 60, to: 30), in: pacific) == 1440) // past midnight
    }

    @Test func overlapsShareLanes() {
        let placed = CalendarRules.pack([
            Span(id: id(1), start: 540, end: 600),
            Span(id: id(2), start: 570, end: 630),
            Span(id: id(3), start: 600, end: 660),
            Span(id: id(4), start: 700, end: 760),
        ])
        let by = Dictionary(uniqueKeysWithValues: placed.map { ($0.span.id, $0) })
        #expect(by[id(1)]?.lane == 0)
        #expect(by[id(2)]?.lane == 1)
        #expect(by[id(3)]?.lane == 0) // the first lane is free again at 10
        #expect([id(1), id(2), id(3)].allSatisfy { by[$0]?.lanes == 2 })
        #expect(by[id(4)]?.lanes == 1) // its own cluster
    }

    @Test func backToBackIsNotAConflict() {
        let a = event(1, from: 540, to: 600)
        let b = event(2, from: 600, to: 660)
        let c = event(3, from: 630, to: 700)
        let other = event(4, "jenny@x.io", from: 540, to: 700)
        #expect(CalendarRules.conflicts([a, b, c, other]) == [id(2), id(3)])
        #expect(CalendarRules.conflicts([event(1, allDay: true), a]).isEmpty)
        // No end counts as two hours.
        #expect(CalendarRules.conflicts([event(1, from: 540, to: nil), event(2, from: 650, to: 700)]) == [id(1), id(2)])
    }
}

@Suite struct Words {
    @Test func home() {
        let address = "2909 Avalon Ave, Berkeley, CA 94705"
        #expect(CalendarRules.isHome("Home", homeAddress: nil))
        #expect(CalendarRules.isHome("Our house!", homeAddress: nil))
        #expect(CalendarRules.isHome("2909 Avalon Ave.", homeAddress: address))
        #expect(!CalendarRules.isHome("2909 Telegraph Ave", homeAddress: address))
        #expect(!CalendarRules.isHome(nil, homeAddress: address))
    }

    @Test func repeats() {
        #expect(CalendarRules.repeatText("FREQ=WEEKLY") == "Weekly")
        #expect(CalendarRules.repeatText("FREQ=WEEKLY;BYDAY=MO") == "Weekly")
        #expect(CalendarRules.repeatText("FREQ=WEEKLY;BYDAY=MO,WE") == "Weekly on Mon, Wed")
        #expect(CalendarRules.repeatText("FREQ=WEEKLY;INTERVAL=2") == "Every 2 weeks")
        #expect(CalendarRules.repeatText("FREQ=MONTHLY;UNTIL=20260630T235959Z") == "Monthly until Jun 30, 2026")
        #expect(CalendarRules.repeatText("FREQ=DAILY;COUNT=5") == "Every day, 5 times")
        #expect(CalendarRules.repeatText("FREQ=MONTHLY;INTERVAL=3") == "Every 3 months")
        #expect(CalendarRules.repeatText("BYDAY=MO") == "Repeats")
    }

    @Test func times() {
        #expect(CalendarRules.timeRange(event(1, from: 15 * 60, to: 16 * 60 + 30), in: pacific) == "3:00 PM – 4:30 PM")
        #expect(CalendarRules.timeRange(event(1, from: 0, to: nil), in: pacific) == "12:00 AM")
        #expect(CalendarRules.timeRange(event(1, allDay: true), in: pacific) == "All day")
        #expect(CalendarRules.shortClock(day.at(minutes: 12 * 60, in: pacific), in: pacific) == "12 PM")
    }

    @Test func colours() {
        // The website's memberColor: a 32-bit hash into its palette.
        #expect(CalendarRules.hashColor("ab") == "#d97706") // 97·31 + 98 = 3105, and 3105 mod 6 is 3
        let muted = RGB(hex: "#ffffff").muted
        #expect(abs(muted.r - (0.6 + 0.4 * 111 / 255)) < 0.001)
    }
}

@Suite struct NewEvents {
    @Test func startsOnTheNextHourToday() {
        let now = day.at(minutes: 14 * 60 + 20, in: pacific)
        let today = CalendarRules.newEventTimes(on: day, now: now, in: pacific)
        #expect(CalendarRules.minutes(today.start, in: pacific) == 15 * 60)
        #expect(today.end.timeIntervalSince(today.start) == 3600)
        let other = CalendarRules.newEventTimes(on: day.adding(days: 3, in: pacific), now: now, in: pacific)
        #expect(CalendarRules.minutes(other.start, in: pacific) == 9 * 60)
    }

    @Test func movingTheStartKeepsTheLength() {
        var draft = EventDraft(memberEmail: "seb@x.io", start: day.at(minutes: 540, in: pacific), end: day.at(minutes: 630, in: pacific))
        CalendarRules.moveStart(&draft, to: day.at(minutes: 600, in: pacific))
        #expect(CalendarRules.minutes(draft.end, in: pacific) == 690)
        CalendarRules.moveEnd(&draft, to: day.at(minutes: 500, in: pacific))
        #expect(CalendarRules.minutes(draft.end, in: pacific) == 615)
    }

    @Test func whoeverHadAnEventStaysGoingWhenItMoves() {
        #expect(CalendarRules.goingAfterMove([], from: "andrew@x.io", to: "seb@x.io") == ["andrew@x.io"])
        // The new owner comes off the list; the old one isn't listed twice.
        #expect(CalendarRules.goingAfterMove(["seb@x.io", "jenny@x.io", "andrew@x.io"], from: "andrew@x.io", to: "seb@x.io") == ["jenny@x.io", "andrew@x.io"])
        #expect(CalendarRules.goingAfterMove(["jenny@x.io"], from: "seb@x.io", to: "seb@x.io") == ["jenny@x.io"])
    }

    @Test func allDayGoesAsMidnightUTCWithNoEnd() {
        var draft = EventDraft(memberEmail: "seb@x.io", start: day.at(minutes: 540, in: pacific), end: day.at(minutes: 600, in: pacific))
        draft.title = " Science fair "
        draft.allDay = true
        let body = CalendarAPI.body(draft, sourceID: nil, in: pacific)
        #expect(body["startTime"] as? String == "2026-11-18T00:00:00.000Z")
        #expect(body["endTime"] is NSNull)
        #expect(body["title"] as? String == "Science fair")
        #expect(body["location"] is NSNull)
    }
}

@Suite struct TheCard {
    @Test func theChoicesAreTheRulesGoogleKeeps() {
        #expect(CalendarRules.rrule(Repeat(every: .day), allDay: false) == "FREQ=DAILY")
        #expect(CalendarRules.rrule(Repeat(every: .weekday), allDay: false) == "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
        #expect(CalendarRules.rrule(Repeat(every: .twoWeeks), allDay: false) == "FREQ=WEEKLY;INTERVAL=2")
        // A rule the choices can't say goes back as it came; one never read, not at all.
        #expect(CalendarRules.rrule(Repeat(every: .other("FREQ=MONTHLY;BYDAY=3FR")), allDay: false) == "FREQ=MONTHLY;BYDAY=3FR")
        #expect(CalendarRules.rrule(Repeat(every: .other("")), allDay: false) == nil)
    }

    @Test func aRuleReadsBackAsItsChoice() {
        #expect(CalendarRules.repeats(from: "FREQ=DAILY").every == .day)
        #expect(CalendarRules.repeats(from: "FREQ=WEEKLY;BYDAY=FR").every == .week)
        #expect(CalendarRules.repeats(from: "FREQ=WEEKLY;WKST=SU;BYDAY=TU,MO,WE,TH,FR").every == .weekday)
        #expect(CalendarRules.repeats(from: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO").every == .twoWeeks)
        #expect(CalendarRules.repeats(from: "FREQ=MONTHLY").every == .month)
        #expect(CalendarRules.repeats(from: "FREQ=YEARLY").every == .year)
        // Kept whole, less its end.
        let twice = CalendarRules.repeats(from: "FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270101T075959Z", in: pacific)
        #expect(twice.every == .other("FREQ=WEEKLY;BYDAY=TU,TH"))
        #expect(twice.until == Day(year: 2026, month: 12, day: 31))
        #expect(CalendarRules.repeats(from: "FREQ=DAILY;COUNT=5").every == .other("FREQ=DAILY;COUNT=5"))
        #expect(CalendarRules.repeatLabel(.other("FREQ=WEEKLY;BYDAY=TU,TH")) == "Weekly on Tue, Thu")
    }

    @Test func theLastDayIsTheWholeOfItHere() {
        // An evening event on the last day is already tomorrow in UTC: the
        // end is that day's last second in Pacific, not UTC's.
        let rule = Repeat(every: .week, until: Day(year: 2026, month: 12, day: 31))
        #expect(CalendarRules.rrule(rule, allDay: false, in: pacific) == "FREQ=WEEKLY;UNTIL=20270101T075959Z")
        #expect(CalendarRules.rrule(rule, allDay: true, in: pacific) == "FREQ=WEEKLY;UNTIL=20261231")
        #expect(CalendarRules.repeats(from: "FREQ=WEEKLY;UNTIL=20261231", in: pacific).until == rule.until)
        #expect(CalendarRules.untilDay("20260701T065959Z", in: pacific) == Day(year: 2026, month: 6, day: 30))
    }

    @Test func howLongItRuns() {
        let start = Date(timeIntervalSince1970: 0)
        #expect(CalendarRules.length(from: start, to: start.addingTimeInterval(90 * 60)) == "1h 30min")
        #expect(CalendarRules.length(from: start, to: start.addingTimeInterval(45 * 60)) == "45min")
        #expect(CalendarRules.length(from: start, to: start.addingTimeInterval(120 * 60)) == "2h")
    }

    @Test func aReadUnderAnOpenCardKeepsWhatWasChanged() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var base = CardDraft(event: EventDraft(title: "Recital", memberEmail: "seb@x.io", start: start, end: start.addingTimeInterval(3600)))
        base.going = ["jenny@x.io"]
        base.duties = [.dropoff: .parent("jenny@x.io")]

        var draft = base
        draft.event.title = "Spring recital"
        draft.going = ["jenny@x.io", "andrew@x.io"]
        draft.duties[.pickup] = .parent("andrew@x.io")

        // Meanwhile, elsewhere: it moved an hour, Jenny dropped out, and the
        // drop-off changed hands.
        var fresh = base
        fresh.event.start = start.addingTimeInterval(3600)
        fresh.event.end = start.addingTimeInterval(7200)
        fresh.event.location = "Hertz Hall"
        fresh.going = []
        fresh.duties[.dropoff] = .caregiver("Marina")

        let merged = draft.rebased(from: base, onto: fresh)
        #expect(merged.event.title == "Spring recital")
        #expect(merged.event.start == fresh.event.start)
        #expect(merged.event.location == "Hertz Hall")
        #expect(merged.going == ["andrew@x.io"])
        #expect(merged.duties == [.dropoff: .caregiver("Marina"), .pickup: .parent("andrew@x.io")])
        // Nothing changed here: the card is just the fresh read.
        #expect(base.rebased(from: base, onto: fresh) == fresh)
    }

    @Test func theRuleGoesOnlyWhenItsBeingSet() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let draft = EventDraft(title: "Lesson", memberEmail: "seb@x.io", start: start, end: start.addingTimeInterval(1800))
        #expect(CalendarAPI.body(draft, sourceID: nil)["rrule"] == nil)
        #expect(CalendarAPI.body(draft, sourceID: nil, rule: .some("FREQ=WEEKLY"))["rrule"] as? String == "FREQ=WEEKLY")
        #expect(CalendarAPI.body(draft, sourceID: nil, rule: .some(nil))["rrule"] is NSNull)
    }
}

@Suite struct TheBoard {
    private let jenny = Member(email: "jenny@x.io", name: "Jenny Mason", role: .parent, color: "#db2777")
    private let seb = Member(email: "seb@x.io", name: "Sebastian Mason", role: .kid, color: "#16a34a")

    private func snapshot(_ events: [CalEvent]) -> CalendarSnapshot {
        var s = CalendarSnapshot()
        s.members = [jenny, seb]
        s.events = events
        s.logistics = Logistics(homeAddress: "2909 Avalon Ave, Berkeley", bufferMinutes: 5)
        return s
    }

    @Test func driveBlocksTakeTheKidsColourAndOpenTheKidsEvent() {
        let practice = event(1, "seb@x.io", from: 16 * 60, to: 17 * 60) { $0.location = "Field" }
        let drive = event(2, "jenny@x.io", from: 15 * 60 + 30, to: 16 * 60) {
            $0.driveSourceEventID = id(1)
            $0.driveDuty = .dropoff
        }
        let board = Board.build(snapshot([practice, drive]), in: pacific)
        let block = board.item(id(2))!
        #expect(block.color == "#16a34a")
        #expect(board.opened(block).id == id(1))
    }

    @Test func dutiesShowOnlyWhereADriveApplies() {
        var s = snapshot([
            event(1, "seb@x.io") { $0.location = "Field" },
            event(2, "seb@x.io") { $0.location = "Home" },
            event(3, "jenny@x.io") { $0.location = "Field" },
            event(4, "seb@x.io", allDay: true),
        ])
        s.duties[id(1)] = [.dropoff: .parent("jenny@x.io"), .pickup: .caregiver("Marina")]
        let board = Board.build(s, in: pacific)
        #expect(board.item(id(1))?.duties == [.dropoff: .person(initial: "J", color: "#db2777"), .pickup: .person(initial: "M", color: "#64748b")])
        #expect(board.item(id(2))?.duties == nil) // at home
        #expect(board.item(id(3))?.duties == nil) // a parent's
        #expect(board.item(id(4))?.duties == nil) // all day
        #expect(board.hasDrives(board.item(id(1))!.event))
        #expect(!board.hasDrives(board.item(id(2))!.event))
        #expect(board.hasOwnerGoing(board.item(id(1))!.event))
        #expect(!board.hasOwnerGoing(board.item(id(3))!.event))
    }

    @Test func theLabelGoesInFrontForTeamsAndFeeds() {
        var s = snapshot([event(1, "seb@x.io") { $0.sourceID = id(900); $0.sourceType = .teamsnap }])
        s.sources = [CalSource(id: id(900), memberEmail: "seb@x.io", sourceType: .teamsnap, teamName: "FSB 10U", nickname: "FSB", isActive: true)]
        #expect(Board.build(s, in: pacific).item(id(1))?.title == "FSB: Event 1")
    }

    @Test func aDayPutsTheSignedInMemberFirstAndFusesTheirDrives() {
        let game = event(1, "seb@x.io", from: 10 * 60, to: 12 * 60) { $0.location = "Field" }
        let out = event(2, "jenny@x.io", from: 9 * 60 + 20, to: 10 * 60) { $0.driveSourceEventID = id(1); $0.driveDuty = .dropoff }
        let back = event(3, "jenny@x.io", from: 12 * 60, to: 12 * 60 + 25) { $0.driveSourceEventID = id(1); $0.driveDuty = .pickup }
        let lunch = event(4, "jenny@x.io", from: 13 * 60, to: 14 * 60)
        var s = snapshot([game, out, back, lunch])
        s.going[id(1)] = ["jenny@x.io"]
        let board = Board.build(s, in: pacific)
        let layout = DayLayout.build(day: day, board: board, shown: board.members, me: "seb@x.io", showHidden: false, in: pacific)
        #expect(layout.columns.map(\.member.email) == ["seb@x.io", "jenny@x.io"])
        #expect(layout.columns[0].blocks.map(\.id) == [id(1)])
        let jennys = layout.columns[1].blocks
        #expect(jennys.map(\.id) == [id(1), id(4)]) // the two drives are part of the game's block
        #expect(jennys[0].kind == .attending(eventStart: 600, eventEnd: 720))
        #expect(jennys[0].start == 560)
        #expect(jennys[0].end == 745)
        // Seb's own game is a card in his wide column; Jenny's lunch isn't.
        #expect(layout.inWideColumn == [id(1)])
    }

    @Test func anEventMovesOnlyToSomeoneWhoCanHoldIt() {
        var board = Board()
        let jenny = Member(email: "jenny@x.io", role: .parent, color: "#db2777", primaryCalendarID: "jenny")
        let oscar = Member(email: "oscar@x.io", role: .kid, color: "#d97706")
        board.members = [jenny, oscar]
        let google = event(1) { $0.sourceType = .google }
        #expect(board.canHold(jenny, google))
        #expect(!board.canHold(oscar, google)) // no Google calendar to put it on
        #expect(board.canHold(oscar, event(2))) // app-only: anyone's
        #expect(!board.canHold(jenny, event(3, "jenny@x.io"))) // already hers
        #expect(!board.canHold(jenny, event(4) { $0.sourceType = .teamsnap }))
    }

    @Test func hiddenEventsStayOutUnlessAskedFor() {
        let board = Board.build(snapshot([event(1) { $0.ownerNotGoing = true }, event(2)]), in: pacific)
        #expect(board.events(on: day, showHidden: false).map(\.id) == [id(2)])
        #expect(board.events(on: day, showHidden: true).count == 2)
    }
}

@Suite struct Series {
    @Test func aRepeatingEventsSeriesIsItsCalendarsOccurrences() {
        let calendar = UUID()
        let mine = event(1) { $0.sourceType = .google; $0.recurringEventID = "weekly"; $0.sourceID = calendar }
        let next = event(2) { $0.sourceType = .google; $0.recurringEventID = "weekly"; $0.sourceID = calendar }
        let guestCopy = event(3, "dad@x.io") { $0.sourceType = .google; $0.recurringEventID = "weekly"; $0.sourceID = UUID() }
        let other = event(4) { $0.sourceType = .google; $0.recurringEventID = "monthly"; $0.sourceID = calendar }
        let oneOff = event(5) { $0.sourceID = calendar }
        let all = [mine, next, guestCopy, other, oneOff]

        #expect(CalendarRules.repeats(mine))
        #expect(CalendarRules.series(of: mine, in: all).map(\.id) == [mine.id, next.id])
    }

    @Test func anEventThatDoesntRepeatIsItsOwnSeries() {
        let oneOff = event(1)
        let appOnly = event(2) { $0.recurringEventID = "weekly"; $0.sourceType = .manual }
        #expect(!CalendarRules.repeats(oneOff))
        #expect(!CalendarRules.repeats(appOnly))
        #expect(CalendarRules.series(of: appOnly, in: [oneOff, appOnly]).map(\.id) == [appOnly.id])
    }
}

@Suite struct Hiding {
    private let jenny = Member(email: "jenny@x.io", name: "Jenny Mason", role: .parent, color: "#db2777")
    private let dad = Member(email: "dad@x.io", name: "Andrew Mason", role: .owner, color: "#2563eb")
    private let seb = Member(email: "seb@x.io", name: "Sebastian Mason", role: .kid, color: "#16a34a")

    private func snapshot(_ events: [CalEvent], hides: [EventHide]) -> CalendarSnapshot {
        var s = CalendarSnapshot()
        s.members = [jenny, dad, seb]
        s.events = events
        s.hides = hides
        return s
    }

    private func walk(_ n: Int, _ member: String = "jenny@x.io", _ more: (inout CalEvent) -> Void = { _ in }) -> CalEvent {
        event(n, member) {
            $0.sourceType = .google
            $0.recurringEventID = "walks"
            $0.googleEventID = "walks_\(n)"
            more(&$0)
        }
    }

    private func shown(_ s: CalendarSnapshot, me: String? = "dad@x.io") -> [UUID] {
        Board.build(s, me: me, in: pacific).events(on: day, showHidden: false).map(\.id).sorted { $0.uuidString < $1.uuidString }
    }

    @Test func hidingOneEventLeavesTheRestOfItsSeries() {
        let s = snapshot([walk(1), walk(2)], hides: [EventHide(scope: .event, target: "walks_1", title: "Walk")])
        #expect(shown(s) == [id(2)])
        // Asked for, it's back, marked as the member's own doing.
        let board = Board.build(s, me: "dad@x.io", in: pacific)
        #expect(board.events(on: day, showHidden: true).count == 2)
        #expect(board.item(id(1))?.hiddenByMe == true)
        #expect(board.item(id(2))?.hiddenByMe == false)
    }

    @Test func hidingASeriesHidesEveryOccurrence() {
        let other = event(3, "jenny@x.io") { $0.sourceType = .google; $0.recurringEventID = "pilates" }
        let s = snapshot([walk(1), walk(2), other], hides: [EventHide(scope: .series, target: "walks", title: "Walk")])
        #expect(shown(s) == [id(3)])
    }

    @Test func anEventWithNoGoogleIdIsHiddenByItsRow() {
        let practice = event(1) { $0.sourceType = .teamsnap }
        #expect(CalendarRules.hideTarget(practice) == id(1).uuidString.lowercased())
        let s = snapshot([practice, event(2)], hides: [EventHide(scope: .event, target: CalendarRules.hideTarget(practice), title: "Practice")])
        #expect(shown(s) == [id(2)])
    }

    @Test func aHiddenSeriesShowsWhereTheMemberIsInvolved() {
        // Going along to one, driving to another, and one moved onto their
        // own calendar: each shows; the plain one stays hidden.
        var s = snapshot(
            [walk(1), walk(2), walk(3, "seb@x.io") { $0.location = "Park" }, walk(4, "dad@x.io")],
            hides: [EventHide(scope: .series, target: "walks", title: "Walk")]
        )
        s.going[id(2)] = ["dad@x.io"]
        s.duties[id(3)] = [.pickup: .parent("dad@x.io")]
        #expect(shown(s) == [id(2), id(3), id(4)])
        // On Jenny's phone it's her own two that show, not the others' ones.
        #expect(shown(s, me: "jenny@x.io") == [id(1), id(2)])
    }

    @Test func hidingJustTheOneHoldsEvenWhenInvolved() {
        var s = snapshot([walk(1)], hides: [EventHide(scope: .event, target: "walks_1", title: "Walk")])
        s.going[id(1)] = ["dad@x.io"]
        #expect(shown(s).isEmpty)
    }

    @Test func aSharedEventIsHiddenWhicheverCopyOwnsIt() {
        // The same Google event on two calendars is one event, hidden once.
        let hers = event(1, "jenny@x.io") { $0.sourceType = .google; $0.externalID = "google:dinner" }
        let sebs = event(2, "seb@x.io") { $0.sourceType = .google; $0.externalID = "google:dinner" }
        let s = snapshot([hers, sebs], hides: [EventHide(scope: .event, target: "dinner", title: "Dinner")])
        #expect(shown(s).isEmpty)
    }

    @Test func driveBlocksGoWithTheirEvent() {
        let lesson = walk(1, "seb@x.io") { $0.location = "Pool" }
        let drive = event(2, "jenny@x.io", from: 8 * 60, to: 9 * 60) {
            $0.driveSourceEventID = id(1)
            $0.driveDuty = .dropoff
        }
        var s = snapshot([lesson, drive], hides: [EventHide(scope: .series, target: "walks", title: "Lesson")])
        s.duties[id(1)] = [.dropoff: .parent("jenny@x.io")]
        #expect(shown(s).isEmpty)
        // Jenny is the one driving, so on her phone the same hide gives way.
        #expect(shown(s, me: "jenny@x.io") == [id(1), id(2)])
    }

    @Test func whatALongPressOffers() {
        let ownWalk = walk(3, "dad@x.io")
        let drive = event(4, "dad@x.io") { $0.driveSourceEventID = id(1) }
        let declined = event(5, "seb@x.io") { $0.ownerNotGoing = true }
        let board = Board.build(snapshot([walk(1), event(2, "jenny@x.io"), ownWalk, drive, declined], hides: []), me: "dad@x.io", in: pacific)
        func item(_ n: Int) -> EventItem { board.item(id(n))! }
        #expect(board.canHide(item(1)) && board.canHideSeries(item(1)))
        #expect(board.canHide(item(2)) && !board.canHideSeries(item(2))) // doesn't repeat
        #expect(board.canHide(item(3)) && !board.canHideSeries(item(3))) // their own: one at a time
        #expect(!board.canHide(item(4))) // a drive goes with its event
        #expect(!board.canHide(item(5))) // already out of sight
    }

    @Test func aHiddenEventStillConflicts() {
        let s = snapshot(
            [event(1, "seb@x.io"), event(2, "seb@x.io")],
            hides: [EventHide(scope: .event, target: CalendarRules.hideTarget(event(1, "seb@x.io")), title: "Event 1")]
        )
        #expect(Board.build(s, me: "dad@x.io", in: pacific).item(id(2))?.conflict == true)
    }

    @Test func aCopySavedBeforeHidingStillOpens() throws {
        var saved = CalendarSnapshot()
        saved.events = [event(1)]
        saved.going[id(1)] = ["dad@x.io"]
        var old = try JSONSerialization.jsonObject(with: JSONEncoder().encode(saved)) as! [String: Any]
        old["hides"] = nil
        let snapshot = try JSONDecoder().decode(CalendarSnapshot.self, from: JSONSerialization.data(withJSONObject: old))
        #expect(snapshot.hides.isEmpty)
        #expect(snapshot.events.map(\.id) == [id(1)])
        #expect(snapshot.going[id(1)] == ["dad@x.io"])
    }

    @Test func aHideGoesToAndFromTheTable() throws {
        let hide = EventHide(
            id: id(9), scope: .series, target: "walks", title: "Walk", ownerEmail: "jenny@x.io",
            start: day.at(minutes: 9 * 60, in: pacific), rrule: "FREQ=WEEKLY"
        )
        let row = try JSONSerialization.jsonObject(with: JSONEncoder().encode(hide)) as! [String: Any]
        #expect(Set(row.keys) == ["id", "scope", "target", "title", "owner_email", "start_time", "rrule"])
        #expect(row["scope"] as? String == "series")
        #expect(try JSONDecoder().decode(EventHide.self, from: JSONEncoder().encode(hide)) == hide)
    }
}

@Suite struct TheWidget {
    private let jenny = Member(email: "jenny@x.io", name: "Jenny Mason", role: .parent, color: "#db2777")
    private let seb = Member(email: "seb@x.io", name: "Sebastian Mason", role: .kid, color: "#16a34a")
    private let oscar = Member(email: "oscar@x.io", name: "Oscar Mason", role: .kid, color: "#d97706")

    @Test func peopleFollowThisPhonesOrderAndHiding() {
        let all = [jenny, seb, oscar]
        #expect(CalendarShared.shown(all, order: [], hidden: []).map(\.email) == ["jenny@x.io", "seb@x.io", "oscar@x.io"])
        #expect(CalendarShared.shown(all, order: ["oscar@x.io"], hidden: ["seb@x.io"]).map(\.email) == ["oscar@x.io", "jenny@x.io"])
    }

    @Test func theHoursInViewStartAnHourBeforeNow() {
        var snapshot = CalendarSnapshot()
        snapshot.members = [jenny, seb]
        snapshot.events = [event(1, "seb@x.io", from: 16 * 60, to: 17 * 60), event(2, "jenny@x.io", from: 12 * 60, to: 13 * 60)]
        func model(_ minutes: Int) -> TodayWidgetModel {
            TodayWidgetModel(snapshot: snapshot, me: "seb@x.io", photos: [:], now: day.at(minutes: minutes, in: pacific), in: pacific)
        }
        #expect(model(15 * 60 + 20).firstHour == 14)
        #expect(model(20).firstHour == 0) // not before midnight
        #expect(model(23 * 60).firstHour == 16) // nor past it
        #expect(model(15 * 60).layout.columns.map(\.member.email) == ["seb@x.io", "jenny@x.io"])
    }
}

@Suite struct Places {
    @Test func aPlaceIsItsNameOverTheRest() {
        let school = CalendarRules.placeParts("Crowden School, 1475 Rose St, Berkeley, CA 94702, USA")
        #expect(school.name == "Crowden School")
        #expect(school.rest == "1475 Rose St, Berkeley, CA 94702, USA")
        // A bare address leads with its street.
        #expect(CalendarRules.placeParts("2909 Avalon Ave, Berkeley").name == "2909 Avalon Ave")
        #expect(CalendarRules.placeParts("Hertz Hall").rest == nil)
        // Google's own events can break an address over lines.
        #expect(CalendarRules.placeParts("Field 3\n100 Park Rd").rest == "100 Park Rd")
    }

    @Test func recentPlacesAreEachOnceNearestFirst() {
        let now = day.at(minutes: 12 * 60, in: pacific)
        func at(_ n: Int, _ offset: Int, _ place: String?, _ more: (inout CalEvent) -> Void = { _ in }) -> CalEvent {
            event(n) {
                $0.start = now.addingTimeInterval(Double(offset) * 86_400)
                $0.location = place
                more(&$0)
            }
        }
        let places = CalendarRules.recentPlaces([
            at(1, -20, "Pool"),
            at(2, -3, "School"),
            at(3, 1, "Field"),
            at(4, 9, "school"),
            at(5, -1, nil),
            at(6, 0, "  "),
            at(7, 0, "Garage") { $0.driveSourceEventID = id(3) },
            at(8, 0, "Gone") { $0.dismissed = true },
            at(9, 0, "Click to join meeting: https://app.example.com/schedule.php?owner=1"),
            at(10, 0, "TBD"),
        ], now: now)
        // The school once, as the nearer event spells it; no drive blocks,
        // dismissed events, blanks, links or placeholders.
        #expect(places == ["Field", "School", "Pool"])
        #expect(CalendarRules.recentPlaces([at(1, 0, "A"), at(2, 1, "B")], now: now, limit: 1) == ["A"])
    }

    // The same cases as the website's scripts/verify-calendar-place.mts.
    @Test func aLinkInTheLocationIsNotThePlace() {
        #expect(CalendarRules.placeText("Crowden School, 1475 Rose St") == "Crowden School, 1475 Rose St")
        #expect(CalendarRules.placeText("https://us02web.zoom.us/j/8123?pwd=abc") == nil)
        #expect(CalendarRules.placeText("Click to join meeting: https://book.example.com/m/42") == nil)
        #expect(CalendarRules.placeText("Zoom Meeting - https://zoom.us/j/1") == nil)
        #expect(CalendarRules.placeText("Room 4, Crowden School — https://zoom.us/j/1") == "Room 4, Crowden School")
        #expect(CalendarRules.placeText("Room 4, zoom.us/j/123") == "Room 4")
        #expect(CalendarRules.placeText("St. Mary's Hall\n2501 Grove St") == "St. Mary's Hall\n2501 Grove St")
        #expect(CalendarRules.placeText("  ") == nil)
        #expect(CalendarRules.placeText(nil) == nil)

        #expect(CalendarRules.isPlace("Field 3"))
        #expect(CalendarRules.isPlace("Room 4 https://zoom.us/j/1"))
        for nowhere in ["TBD", "n/a", "Zoom", "Online", "Phone call", "https://meet.google.com/abc-defg-hij"] {
            #expect(!CalendarRules.isPlace(nowhere), "\(nowhere)")
        }
        #expect(!CalendarRules.isPlace(nil))
    }

    @Test func anEventOnACallNeedsNoDrive() {
        let zoom = "https://zoom.us/j/1"
        #expect(CalendarRules.isRemote(location: zoom, joinURL: zoom))
        // The link was in the notes.
        #expect(CalendarRules.isRemote(location: nil, joinURL: zoom))
        #expect(CalendarRules.isRemote(location: "TBD", joinURL: zoom))
        #expect(CalendarRules.isRemote(location: "Zoom", joinURL: nil))
        // In person, with a remote option.
        #expect(!CalendarRules.isRemote(location: "Crowden School", joinURL: zoom))
        #expect(!CalendarRules.isRemote(location: "TBD", joinURL: nil))
        #expect(!CalendarRules.isRemote(location: nil, joinURL: nil))
    }

    @Test func aJoinLinkIsCalledByItsService() {
        #expect(CalendarRules.joinName("https://us02web.zoom.us/j/8123") == "Zoom")
        #expect(CalendarRules.joinName("https://meet.google.com/abc-defg-hij") == "Google Meet")
        #expect(CalendarRules.joinName("https://teams.microsoft.com/l/meetup-join/19%3a") == "Microsoft Teams")
        #expect(CalendarRules.joinName("https://teams.live.com/meet/9334") == "Microsoft Teams")
        #expect(CalendarRules.joinName("https://acme.webex.com/meet/bob") == "Webex")
        #expect(CalendarRules.joinName("https://facetime.apple.com/join#v=1") == "FaceTime")
        #expect(CalendarRules.joinName("https://www.book.example.com/m/42") == "book.example.com")
        #expect(CalendarRules.joinName("https://notzoom.us/j/1") == "notzoom.us")
    }

    @Test func aCompactViewSaysThePlaceOrTheCall() {
        let zoom = "https://zoom.us/j/1"
        func line(_ location: String?, _ joinURL: String?) -> String? {
            CalendarRules.whereLine(event(1) { $0.location = location; $0.joinURL = joinURL }).map { "\($0.call ? "call" : "place"): \($0.text)" }
        }
        #expect(line("Field 3", nil) == "place: Field 3")
        #expect(line(zoom, zoom) == "call: Zoom")
        #expect(line("Room 4 " + zoom, zoom) == "place: Room 4")
        #expect(line(nil, "https://meet.google.com/abc") == "call: Google Meet")
        #expect(line("TBD", nil) == "place: TBD")
        #expect(line("Zoom", nil) == "call: Zoom")
        #expect(line(nil, nil) == nil)
    }

    @Test func typingNarrowsThem() {
        let places = ["Crowden School, 1475 Rose St", "Temescal Pool", "Park Day School"]
        #expect(CalendarRules.matching(places, " school ") == ["Crowden School, 1475 Rose St", "Park Day School"])
        #expect(CalendarRules.matching(places, "rose") == ["Crowden School, 1475 Rose St"])
        #expect(CalendarRules.matching(places, "") == places)
    }
}
