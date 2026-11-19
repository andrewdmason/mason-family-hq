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
