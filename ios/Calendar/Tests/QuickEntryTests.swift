import Foundation
import Testing
@testable import FamilyCalendar

// The Mac applet's typed line (Shared/QuickEntry.swift) and its list
// (Shared/Agenda.swift).

private let pacific: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    return c
}()

/// Thursday.
private let today = Day(year: 2026, month: 11, day: 26)
private let andrew = "andrew@x.io"
private let jenny = "jenny@x.io"
private let oscar = "oscar@x.io"

private func read(_ line: String, at minutes: Int = 10 * 60, on day: Day? = nil) -> QuickEntry {
    QuickEntry.parse(line, QuickEntry.Context(
        now: today.at(minutes: minutes, in: pacific), calendar: pacific, day: day ?? today,
        people: [.init(name: "Jenny", email: jenny), .init(name: "Andrew", email: andrew), .init(name: "Oscar", email: oscar)],
        me: andrew
    ))
}

private func at(_ day: Day, _ hour: Int, _ minute: Int = 0) -> Date { day.at(minutes: hour * 60 + minute, in: pacific) }

@Suite struct QuickEntryDays {
    @Test func wordsForDays() {
        #expect(read("Dentist tomorrow 3pm").start == at(today.adding(days: 1, in: pacific), 15))
        #expect(read("Dentist today 3pm").start == at(today, 15))
        #expect(read("Dentist day after tomorrow 3pm").start == at(Day(year: 2026, month: 11, day: 28), 15))
        #expect(read("Dentist in 3 days at 9").start == at(Day(year: 2026, month: 11, day: 29), 9))
        #expect(read("Review next week 2pm").start == at(Day(year: 2026, month: 12, day: 3), 14))
    }

    @Test func weekdaysAreTheNextOneToCome() {
        #expect(read("Golf sat 8am").start == at(Day(year: 2026, month: 11, day: 28), 8))
        #expect(read("Golf on Monday 8am").start == at(Day(year: 2026, month: 11, day: 30), 8))
        // Said on a Thursday: today while it's still to come, else next week's.
        #expect(read("Call thursday 3pm").start == at(today, 15))
        #expect(read("Call thursday 9am").start == at(Day(year: 2026, month: 12, day: 3), 9))
        // "Next friday" is the Friday of next week, not tomorrow.
        #expect(read("Call next friday 9am").start == at(Day(year: 2026, month: 12, day: 4), 9))
    }

    @Test func dates() {
        #expect(read("Recital dec 3 at 6pm").start == at(Day(year: 2026, month: 12, day: 3), 18))
        #expect(read("Recital December 3rd, 2027 6pm").start == at(Day(year: 2027, month: 12, day: 3), 18))
        #expect(read("Recital 3 dec 6pm").start == at(Day(year: 2026, month: 12, day: 3), 18))
        #expect(read("Recital 12/3 6pm").start == at(Day(year: 2026, month: 12, day: 3), 18))
        #expect(read("Recital on the 30th 6pm").start == at(Day(year: 2026, month: 11, day: 30), 18))
        // A date already gone this year is next year's.
        #expect(read("Taxes apr 15").start == at(Day(year: 2027, month: 4, day: 15), 9))
    }

    @Test func noDayIsTheDayInView() {
        let friday = Day(year: 2026, month: 11, day: 27)
        #expect(read("Dentist 3pm", on: friday).start == at(friday, 15))
    }
}

@Suite struct QuickEntryTimes {
    @Test func oneTimeIsAnHour() {
        let entry = read("Dentist 3:30pm")
        #expect(entry.start == at(today, 15, 30))
        #expect(entry.end == at(today, 16, 30))
        #expect(!entry.allDay)
        #expect(read("Dentist at 3").start == at(today, 15))
        #expect(read("Standup at 9").start == at(today, 9))
        #expect(read("Lunch at noon").start == at(today, 12))
        #expect(read("Flight 14:05").start == at(today, 14, 5))
        #expect(read("Coffee 3p").start == at(today, 15))
    }

    @Test func spans() {
        var entry = read("Dinner 7-9pm")
        #expect(entry.start == at(today, 19) && entry.end == at(today, 21))
        entry = read("Brunch 11-1pm")
        #expect(entry.start == at(today, 11) && entry.end == at(today, 13))
        entry = read("Workshop 9am to 12")
        #expect(entry.start == at(today, 9) && entry.end == at(today, 12))
        entry = read("Party from 3:30 to 5:30")
        #expect(entry.start == at(today, 15, 30) && entry.end == at(today, 17, 30))
        // Past midnight ends tomorrow.
        entry = read("Gig 10pm-1am")
        #expect(entry.start == at(today, 22) && entry.end == at(today.adding(days: 1, in: pacific), 1))
    }

    @Test func howLong() {
        var entry = read("Run 6pm for 45 min")
        #expect(entry.end == at(today, 18, 45))
        entry = read("Hike sat 9am for 2.5 hours")
        #expect(entry.end == at(Day(year: 2026, month: 11, day: 28), 11, 30))
        // Long with no time: from the next round hour.
        entry = read("Focus for 2 hours", at: 10 * 60 + 20)
        #expect(entry.start == at(today, 11) && entry.end == at(today, 13))
    }

    @Test func noTimeIsAllDay() {
        let entry = read("Grandma visiting tomorrow")
        #expect(entry.allDay)
        #expect(entry.title == "Grandma visiting")
        #expect(Day(entry.start, in: pacific) == today.adding(days: 1, in: pacific))
    }

    @Test func mealsHaveTheirHour() {
        #expect(read("Lunch with Sam tomorrow").start == at(today.adding(days: 1, in: pacific), 12))
        let dinner = read("Dinner at Zuni")
        #expect(dinner.start == at(today, 19) && dinner.end == at(today, 20, 30))
        #expect(!dinner.allDay)
        #expect(read("Movie tonight").start == at(today, 19))
    }
}

@Suite struct QuickEntryWords {
    @Test func titleIsWhatIsLeft() {
        #expect(read("Dentist tomorrow 3pm").title == "Dentist")
        #expect(read("lunch on friday at noon").title == "Lunch")
        #expect(read("Call with the bank, tomorrow at 3").title == "Call with the bank")
        #expect(read("3pm dentist").title == "Dentist")
        #expect(read("Pick up dry cleaning").title == "Pick up dry cleaning")
    }

    @Test func placeFollowsAt() {
        var entry = read("Dinner at Zuni tomorrow 7pm")
        #expect(entry.title == "Dinner" && entry.location == "Zuni")
        entry = read("Coffee at 10 at Blue Bottle")
        #expect(entry.title == "Coffee" && entry.location == "Blue Bottle")
        #expect(entry.start == at(today, 10))
        entry = read("Dinner at Zuni with Jenny 7pm")
        #expect(entry.title == "Dinner with Jenny" && entry.location == "Zuni")
        entry = read("Haircut @ the barber fri 2pm")
        #expect(entry.title == "Haircut" && entry.location == "The barber")
    }

    @Test func theFamily() {
        var entry = read("Dinner with Jenny and Oscar 7pm")
        #expect(entry.going == [jenny, oscar])
        #expect(entry.holder == nil)
        #expect(entry.title == "Dinner with Jenny and Oscar")
        // "For Oscar" puts it on Oscar's calendar and comes out of the title.
        entry = read("Dentist for Oscar tue 3:30pm")
        #expect(entry.holder == oscar && entry.going.isEmpty)
        #expect(entry.title == "Dentist")
        // Someone who isn't family stays in the words and adds nobody.
        entry = read("Lunch with Sam 12pm")
        #expect(entry.going.isEmpty && entry.title == "Lunch with Sam")
        // Their own name adds nobody.
        #expect(read("Andrew haircut 2pm").going.isEmpty)
        #expect(read("Oscar's game sat 10am").going == [oscar])
    }

    @Test func theDraft() {
        let mine = read("Dinner with Jenny at Zuni tomorrow 7-9pm").draft(me: andrew)
        #expect(mine.event.memberEmail == andrew && mine.going == [jenny])
        #expect(mine.event.title == "Dinner with Jenny" && mine.event.location == "Zuni")
        let oscars = read("Dentist for Oscar with Jenny tue 3:30pm").draft(me: andrew)
        #expect(oscars.event.memberEmail == oscar && oscars.going == [jenny])
    }
}

@Suite struct QuickEntryRepeats {
    @Test func everySomething() {
        #expect(read("Standup every weekday 9am").repeats == Repeat(every: .weekday))
        #expect(read("Vitamins daily 8am").repeats == Repeat(every: .day))
        #expect(read("Trash every week").repeats == Repeat(every: .week))
        #expect(read("Payroll every other week").repeats == Repeat(every: .twoWeeks))
        #expect(read("Rent every month").repeats == Repeat(every: .month))
        #expect(read("Anniversary every year").repeats == Repeat(every: .year))
        #expect(read("Dentist tomorrow").repeats == nil)
    }

    @Test func everyWeekdayNamed() {
        let entry = read("Piano every tuesday 4pm")
        #expect(entry.repeats == Repeat(every: .week))
        #expect(entry.start == at(Day(year: 2026, month: 12, day: 1), 16))
        #expect(entry.title == "Piano")
    }

    @Test func until() {
        let entry = read("Piano every tuesday 4pm until dec 15")
        #expect(entry.repeats == Repeat(every: .week, until: Day(year: 2026, month: 12, day: 15)))
        #expect(entry.start == at(Day(year: 2026, month: 12, day: 1), 16))
        #expect(entry.title == "Piano")
    }
}

// MARK: The applet's list

private func id(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))! }

private func snapshot(_ events: [CalEvent], going: [UUID: [String]] = [:]) -> CalendarSnapshot {
    var s = CalendarSnapshot()
    s.members = [
        Member(email: jenny, name: "Jenny Mason", role: .parent, color: "#db2777"),
        Member(email: andrew, name: "Andrew Mason", role: .owner, color: "#2563eb"),
        Member(email: oscar, name: "Oscar Mason", role: .kid, color: "#d97706"),
        Member(email: "seb@x.io", name: "Sebastian Mason", role: .kid, color: "#16a34a"),
    ]
    s.events = events
    s.going = going
    return s
}

private func event(_ n: Int, _ member: String, _ title: String, on day: Day = today, _ from: Int, _ to: Int, allDay: Bool = false) -> CalEvent {
    CalEvent(
        id: id(n), memberEmail: member, title: title,
        start: allDay ? CalendarRules.allDayInstant(day) : day.at(minutes: from, in: pacific),
        end: allDay ? nil : day.at(minutes: to, in: pacific), allDay: allDay
    )
}

private func agenda(_ s: CalendarSnapshot, at minutes: Int, chosen: Day? = nil) -> Agenda {
    let board = Board.build(s, me: andrew, in: pacific)
    return Agenda.build(
        board: board, me: andrew, shown: board.members, showHidden: false, chosen: chosen,
        now: today.at(minutes: minutes, in: pacific), in: pacific
    )
}

@Suite struct AgendaRows {
    private let tomorrow = today.adding(days: 1, in: pacific)

    @Test func mineAreFullRowsAndTheRestAreNot() {
        let s = snapshot([
            event(1, andrew, "Design review", 9 * 60, 10 * 60),
            event(2, jenny, "Pilates", 8 * 60 + 30, 9 * 60 + 30),
            event(3, jenny, "Dinner", 19 * 60, 21 * 60),
        ], going: [id(3): [andrew]])
        let list = agenda(s, at: 7 * 60)
        #expect(list.day == today && !list.upcoming)
        #expect(list.rows.map(\.item.title) == ["Pilates", "Design review", "Dinner"])
        #expect(list.rows.map(\.mine) == [false, true, true])
        // Someone else's shows whose it is; one they're going to, who else is in it.
        #expect(list.rows[0].people == [jenny])
        #expect(list.rows[2].people == [jenny])
    }

    @Test func theSameThingForSeveralIsOneLine() {
        let s = snapshot([
            event(1, oscar, "School", 8 * 60 + 20, 14 * 60 + 30),
            event(2, "seb@x.io", "School", 8 * 60 + 20, 15 * 60),
        ])
        let list = agenda(s, at: 7 * 60)
        #expect(list.rows.count == 1)
        #expect(list.rows[0].people == [oscar, "seb@x.io"])
        // Still on until the last of them is over.
        #expect(agenda(s, at: 14 * 60 + 45).rows.first?.over == false)
    }

    @Test func todayUntilNothingIsLeftThenTomorrow() {
        let s = snapshot([
            event(1, andrew, "Design review", 9 * 60, 10 * 60),
            event(2, "seb@x.io", "Soccer", 17 * 60, 19 * 60),
            event(3, andrew, "Board call", on: tomorrow, 10 * 60, 11 * 60),
            event(4, jenny, "Grandma visiting", 0, 0, allDay: true),
        ])
        // His own are over, but the family's evening still holds today open.
        var list = agenda(s, at: 18 * 60)
        #expect(list.day == today && !list.upcoming)
        #expect(list.rows.map(\.over) == [true, false])
        // Once that's over too it's tomorrow; an all-day event doesn't hold today.
        list = agenda(s, at: 19 * 60 + 1)
        #expect(list.day == tomorrow && list.upcoming)
        #expect(list.rows.map(\.item.title) == ["Board call"])
        #expect(list.stillToday.map(\.item.title) == ["Grandma visiting"])
    }

    @Test func aChosenDayIsJustThatDay() {
        let s = snapshot([event(1, andrew, "Board call", on: tomorrow, 10 * 60, 11 * 60)])
        let list = agenda(s, at: 9 * 60, chosen: tomorrow)
        #expect(list.day == tomorrow && !list.upcoming)
    }
}

// MARK: The day as stops and the time between (Shared/Rundown.swift)

private func rundown(_ s: CalendarSnapshot, at minutes: Int, chosen: Day? = nil) -> Rundown {
    let board = Board.build(s, me: andrew, in: pacific)
    let now = today.at(minutes: minutes, in: pacific)
    let list = Agenda.build(board: board, me: andrew, shown: board.members, showHidden: false, chosen: chosen, now: now, in: pacific)
    return Rundown.build(list, board: board, me: andrew, now: now, in: pacific)
}

/// Andrew's drive for an event: there and back, as the website makes them.
private func drive(_ n: Int, for source: Int, _ duty: DutyKind, _ title: String, _ from: Int, _ to: Int) -> CalEvent {
    var e = event(n, andrew, title, from, to)
    e.driveSourceEventID = id(source)
    e.driveDuty = duty
    return e
}

@Suite struct RundownParts {
    private let tomorrow = today.adding(days: 1, in: pacific)

    private var workday: CalendarSnapshot {
        snapshot([
            event(1, andrew, "Design review", 9 * 60, 10 * 60),
            event(2, andrew, "Lunch", 12 * 60, 13 * 60),
            event(3, oscar, "School", 8 * 60 + 20, 14 * 60 + 30),
            event(4, jenny, "Pilates", 10 * 60 + 30, 11 * 60 + 30),
            event(5, jenny, "Dinner out", 19 * 60, 21 * 60),
        ])
    }

    @Test func theTimeBetweenStopsCarriesTheFamily() {
        let day = rundown(workday, at: 7 * 60)
        #expect(day.parts.map(\.kind) == [.gap, .stop, .gap, .stop, .gap])
        #expect(day.parts.map { $0.row?.item.title } == [nil, "Design review", nil, "Lunch", nil])
        // The day's ends have no length; the gap between is two hours.
        #expect(day.parts.map { $0.length.map(Rundown.length) } == [nil, "1h", "2h", "1h", nil])
        // Each of the family's is in the gap it starts in.
        #expect(day.parts.map { $0.others.map(\.item.title) } == [["School"], [], ["Pilates"], [], ["Dinner out"]])
        // Before the first stop is where he is.
        #expect(day.parts.map(\.phase) == [.now, .ahead, .ahead, .ahead, .ahead])
    }

    @Test func nowIsAStopOrTheTimeBetween() {
        // Mid-review: the review is now, with half an hour left.
        var day = rundown(workday, at: 9 * 60 + 30)
        var current = day.parts.first { $0.phase == .now }
        #expect(current?.row?.item.title == "Design review")
        #expect(current?.end.map { Rundown.length($0.timeIntervalSince(today.at(minutes: 9 * 60 + 30, in: pacific))) } == "30m")
        // Between the two: the gap is now, and Lunch is what it runs up to.
        day = rundown(workday, at: 10 * 60 + 15)
        current = day.parts.first { $0.phase == .now }
        #expect(current?.kind == .gap && current?.length == 2 * 3600)
        #expect(current.flatMap { day.nextStop(after: $0) }?.row?.item.title == "Lunch")
        // What's been: the review, and the morning's gap kept only for School.
        #expect(day.parts.prefix(2).map(\.phase) == [.over, .over])
        #expect(day.parts[0].others.map(\.item.title) == ["School"])
        // After the last stop he's in the open end of the day.
        day = rundown(workday, at: 14 * 60)
        #expect(day.parts.last?.phase == .now && day.parts.last?.length == nil)
    }

    @Test func backToBackAndOverlappingStopsLeaveNoGap() {
        let day = rundown(snapshot([
            event(1, andrew, "Standup", 9 * 60, 10 * 60),
            event(2, andrew, "Review", 10 * 60 + 2, 11 * 60 + 30),
            event(3, andrew, "Call", 10 * 60 + 30, 11 * 60),
            event(4, andrew, "Lunch", 12 * 60, 13 * 60),
        ]), at: 8 * 60, chosen: tomorrow.adding(days: -1, in: pacific))
        // One gap only, measured from the end of the longest of what overlapped.
        let gaps = day.parts.filter { $0.kind == .gap && $0.length != nil }
        #expect(gaps.count == 1)
        #expect(gaps.first?.length.map(Rundown.length) == "30m")
    }

    @Test func onlyDrivingMakesTheDrivesTheStops() {
        var s = snapshot([
            event(1, "seb@x.io", "Practice", 16 * 60 + 30, 18 * 60),
            drive(2, for: 1, .dropoff, "Drop off Sebastian @ 4:30pm (18 min drive)", 16 * 60 + 7, 16 * 60 + 43),
            drive(3, for: 1, .pickup, "Pick up Sebastian @ 6pm (18 min drive)", 17 * 60 + 42, 18 * 60 + 18),
        ])
        s.duties = [id(1): [.dropoff: .parent(andrew), .pickup: .parent(andrew)]]
        let day = rundown(s, at: 15 * 60)
        #expect(day.parts.map(\.kind) == [.gap, .stop, .gap, .stop])
        #expect(day.parts.map { $0.leg?.title } == [nil, "Drop off Sebastian", nil, "Pick up Sebastian"])
        // Practice is Sebastian's, going on in the 59 minutes between the two drives.
        #expect(day.parts[2].length.map(Rundown.length) == "59m")
        #expect(day.parts[2].others.map(\.item.title) == ["Practice"])
        #expect(day.parts[2].others.first?.mine == false)
    }

    @Test func goingAlongIsOneStopDoorToDoor() {
        var s = snapshot([
            event(1, "seb@x.io", "Game", 10 * 60, 12 * 60),
            drive(2, for: 1, .dropoff, "Drop off Sebastian @ 10am (25 min drive)", 9 * 60 + 30, 10 * 60),
        ], going: [id(1): [andrew]])
        s.duties = [id(1): [.dropoff: .parent(andrew)]]
        let stop = rundown(s, at: 8 * 60).parts.first { $0.kind == .stop }
        #expect(stop?.leg == nil && stop?.row?.item.title == "Game")
        #expect(stop?.start == today.at(minutes: 9 * 60 + 30, in: pacific))
        #expect(stop?.end == today.at(minutes: 12 * 60, in: pacific))
    }

    @Test func anotherDayIsAllAheadWithNoEmptyEnds() {
        let day = rundown(snapshot([
            event(1, andrew, "Board call", on: tomorrow, 10 * 60, 11 * 60),
            event(2, andrew, "Dentist", on: tomorrow, 14 * 60, 15 * 60),
        ]), at: 9 * 60, chosen: tomorrow)
        #expect(day.parts.map(\.kind) == [.stop, .gap, .stop])
        #expect(day.parts.allSatisfy { $0.phase == .ahead })
    }

    @Test func lengthsReadToTheMinuteAbove() {
        #expect(Rundown.length(45 * 60) == "45m")
        #expect(Rundown.length(3600) == "1h")
        #expect(Rundown.length(65 * 60) == "1h 5m")
        #expect(Rundown.length(59 * 60 + 20) == "1h")
        #expect(Rundown.length(20) == "1m")
    }
}
