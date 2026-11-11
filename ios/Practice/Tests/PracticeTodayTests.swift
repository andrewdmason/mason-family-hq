import Foundation
import Testing
import WidgetKit
@testable import Practice

private let utc = TimeZone(identifier: "UTC")!
/// 2026-10-15 10:00:00 UTC.
private let ten = Date(timeIntervalSince1970: 1_792_022_400 + 10 * 3600)
private let day = "2026-10-15"

private func timeline(_ saved: PracticeToday?, server: Int? = nil, serverGoal: Int? = nil, now: Date = ten) -> [PracticeTodayEntry] {
    PracticeToday.timeline(saved: saved, loggedOnServer: server, goalOnServer: serverGoal, now: now, timeZone: utc).entries
}

@Suite struct PracticeTodayTests {
    @Test func theLargerOfThePhoneAndTheLogWins() {
        let saved = PracticeToday(date: day, loggedSeconds: 600)
        #expect(timeline(saved, server: 300)[0].seconds == 600) // writes waiting for signal
        #expect(timeline(saved, server: 900)[0].seconds == 900) // practice on the website
        #expect(timeline(saved, server: nil)[0].seconds == 600) // no signal
        #expect(timeline(nil, server: 900)[0].seconds == 900) // the app hasn't said anything yet
    }

    @Test func yesterdaysCountIsntToday() {
        let saved = PracticeToday(
            date: "2026-10-14", loggedSeconds: 600,
            run: .init(startedAt: ten, endsBy: ten.addingTimeInterval(3600))
        )
        let entries = timeline(saved)
        #expect(entries[0].seconds == 0)
        #expect(!entries[0].running)
        #expect(entries.count == 2)
    }

    @Test func idleItHoldsThenGoesToZeroAtMidnight() {
        let entries = timeline(PracticeToday(date: day, loggedSeconds: 600))
        #expect(entries.count == 2)
        #expect(entries[0].date == ten)
        #expect(entries[1].date == ten.addingTimeInterval(14 * 3600))
        #expect(entries[1].seconds == 0)
    }

    @Test func aRunningTimerStepsOnEachNewMinuteAndStopsAtItsCutoff() {
        // 10m logged, plus a run 30s old that stops itself in 2m 15s.
        let run = PracticeToday.Run(startedAt: ten.addingTimeInterval(-30), endsBy: ten.addingTimeInterval(135))
        let entries = timeline(PracticeToday(date: day, loggedSeconds: 600, run: run))
        #expect(entries.map(\.seconds) == [630, 660, 720, 765, 0])
        #expect(entries.map(\.running) == [true, true, true, false, false])
        #expect(entries[1].date == ten.addingTimeInterval(30))
        #expect(entries[3].date == run.endsBy)
    }

    @Test func aRunPastItsCutoffStaysStopped() {
        let run = PracticeToday.Run(startedAt: ten.addingTimeInterval(-7200), endsBy: ten.addingTimeInterval(-3600))
        let entries = timeline(PracticeToday(date: day, loggedSeconds: 600, run: run))
        #expect(entries.map(\.seconds) == [600 + 3600, 0])
        #expect(!entries[0].running)
    }

    @Test func aRunOverMidnightStopsCountingAtMidnight() {
        let lateNow = ten.addingTimeInterval(13.5 * 3600) // 23:30
        let run = PracticeToday.Run(startedAt: lateNow, endsBy: lateNow.addingTimeInterval(3600))
        let entries = timeline(PracticeToday(date: day, loggedSeconds: 0, run: run), now: lateNow)
        #expect(entries.last?.seconds == 0)
        #expect(entries.last?.date == lateNow.addingTimeInterval(1800))
        #expect(entries.dropLast().allSatisfy { $0.date < lateNow.addingTimeInterval(1800) })
    }

    @Test func itRefreshesEveryHalfHourAndAtMidnight() {
        let saved = PracticeToday(date: day, loggedSeconds: 0)
        #expect(PracticeToday.timeline(saved: saved, loggedOnServer: nil, now: ten, timeZone: utc).policy == .after(ten.addingTimeInterval(1800)))
        let late = ten.addingTimeInterval(13.75 * 3600) // 23:45
        #expect(PracticeToday.timeline(saved: saved, loggedOnServer: nil, now: late, timeZone: utc).policy == .after(ten.addingTimeInterval(14 * 3600)))
    }

    @Test func theGoalIsMetOnceTheDaysPlanIsPracticed() {
        #expect(!timeline(PracticeToday(date: day, loggedSeconds: 600))[0].goalMet) // no plan, nothing to meet
        #expect(!timeline(PracticeToday(date: day, loggedSeconds: 600, goalSeconds: 900))[0].goalMet)
        #expect(timeline(PracticeToday(date: day, loggedSeconds: 900, goalSeconds: 900))[0].goalMet)
        #expect(timeline(PracticeToday(date: day, loggedSeconds: 1200, goalSeconds: 900))[0].goalMet)
        // A plan grown on the website holds the celebration back.
        #expect(!timeline(PracticeToday(date: day, loggedSeconds: 900, goalSeconds: 900), serverGoal: 1800)[0].goalMet)
        // Midnight starts over.
        #expect(!timeline(PracticeToday(date: day, loggedSeconds: 900, goalSeconds: 900)).last!.goalMet)
    }

    @Test func aRunningTimerTurnsGreenTheMomentItReachesTheGoal() {
        // 10m logged, a run 30s old, a goal of 11m 45s: met 75s from now.
        let run = PracticeToday.Run(startedAt: ten.addingTimeInterval(-30), endsBy: ten.addingTimeInterval(600))
        let entries = timeline(PracticeToday(date: day, loggedSeconds: 600, run: run, goalSeconds: 705))
        let met = entries.first { $0.goalMet }
        #expect(met?.date == ten.addingTimeInterval(75))
        #expect(met?.seconds == 705)
        #expect(entries.prefix { !$0.goalMet }.allSatisfy { $0.seconds < 705 })
        #expect(zip(entries, entries.dropFirst()).allSatisfy { $0.date < $1.date })
    }

    @Test func aSavedDayFromBeforeGoalsStillLoads() throws {
        let json = #"{"date":"2026-10-15","loggedSeconds":600}"#
        let saved = try JSONDecoder().decode(PracticeToday.self, from: Data(json.utf8))
        #expect(saved.goalSeconds == 0)
    }
}
