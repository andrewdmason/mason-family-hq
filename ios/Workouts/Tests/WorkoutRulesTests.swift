import Foundation
import Testing
@testable import Workouts

// The website's rules, ported in WorkoutRules.swift. The math cases are
// scripts/verify-workout-math.mts, case for case, so the phone and the website
// agree on an estimated 1RM; the rest follow src/lib/workouts/format.ts,
// src/lib/home/workouts.ts, workout-summary.tsx and progress.ts.

private func id(_ name: String) -> UUID {
    // Stable ids from names, so failures read clearly.
    let hex = name.utf8.reduce(into: UInt64(1469598103934665603)) { $0 = ($0 ^ UInt64($1)) &* 1099511628211 }
    return UUID(uuidString: String(format: "00000000-0000-0000-%04X-%012llX", UInt16(truncatingIfNeeded: hex >> 48), hex & 0xFFFF_FFFF_FFFF))!
}

private func set(
    _ type: MetricType = .loadReps, load: Double? = nil, reps: Int? = nil, context: SetContext = .strength,
    rx: SetMetrics? = nil, e1rm: Double? = nil, loose: Bool = false
) -> WorkoutSet {
    let actual = SetMetrics(reps: reps, load: load, unit: load == nil ? nil : "lb")
    return WorkoutSet(
        id: UUID(), position: 0, metricType: type, context: context, rxLevel: nil,
        prescribed: rx ?? actual, actual: actual, e1rm: e1rm, e1rmIsLoose: loose
    )
}

private func entry(_ name: String, _ sets: [WorkoutSet]) -> Entry {
    Entry(id: id(name), position: 0, rawName: name, movementID: id("m-" + name), canonicalName: name, family: "squat", isLoaded: true, sets: sets)
}

private func block(_ key: String, title: String? = nil, group: String? = nil, type: BlockType = .metcon, entries: [Entry] = []) -> Block {
    Block(
        id: id(key), position: 0, blockType: type, title: title, groupLabel: group, scoreType: .none, score: Score(),
        rxLevel: nil, benchmarkID: nil, benchmarkName: nil, entries: entries
    )
}

private func session(_ key: String, _ date: String, completed: Bool = false, event: String? = nil, created: String = "2026-06-01T08:00:00Z") -> SessionSummary {
    SessionSummary(id: id(key), date: date, title: key, blockCount: 1, completed: completed, calendarEventID: event.map(id), createdAt: created)
}

private func event(_ key: String, _ date: String) -> WorkoutEvent {
    WorkoutEvent(id: id(key), title: key, date: date)
}

@Suite struct EstimatedMax {
    @Test func epley() {
        #expect(WorkoutRules.epleyE1rm(load: 225, reps: 5) == 262.5)
        #expect(WorkoutRules.epleyE1rm(load: 185, reps: 1) == 185)
        #expect(abs(WorkoutRules.inverseEpleyLoad(e1rm: 262.5, reps: 3) - 238.6) <= 0.5)
    }

    @Test func looseness() {
        #expect(WorkoutRules.isLooseReps(13))
        #expect(!WorkoutRules.isLooseReps(12))
    }

    @Test func setEstimates() {
        let kilos = WorkoutRules.setE1rm(load: 100, reps: 1, unit: "kg", isLoadedMovement: true)
        #expect(abs((kilos?.e1rm ?? 0) - 220.5) <= 0.5)
        #expect(WorkoutRules.setE1rm(load: 50, reps: 5, unit: "lb", isLoadedMovement: false) == nil)
        #expect(WorkoutRules.setE1rm(load: nil, reps: 5, unit: "lb", isLoadedMovement: true) == nil)
        #expect(WorkoutRules.setE1rm(load: 95, reps: 15, unit: "lb", isLoadedMovement: true)?.isLoose == true)
    }

    @Test func normalization() {
        #expect(WorkoutRules.suggestedLoad(bestE1rm: 262.5, reps: 5) == 225)
        #expect(WorkoutRules.percentOfE1rm(load: 155, bestE1rm: 200) == 78)
        #expect(WorkoutRules.percentOfE1rm(load: 155, bestE1rm: 0) == nil)
    }

    @Test func siblings() {
        let estimate = WorkoutRules.siblingEstimate(fromE1rm: 200, low: 0.7, high: 0.8)
        #expect(estimate.low == 140)
        #expect(estimate.high == 160)
    }
}

@Suite struct Formatting {
    @Test func durations() {
        #expect(WorkoutRules.duration(418) == "6:58")
        #expect(WorkoutRules.duration(30) == "0:30")
        #expect(WorkoutRules.duration(3725) == "1:02:05")
        #expect(WorkoutRules.duration(nil) == "—")
    }

    @Test func setMetrics() {
        #expect(WorkoutRules.setMetric(.loadReps, SetMetrics(reps: 9, load: 55, unit: "lb")) == "55 lb × 9")
        #expect(WorkoutRules.setMetric(.loadReps, SetMetrics(reps: 5, load: 102.5, unit: "kg")) == "102.5 kg × 5")
        #expect(WorkoutRules.setMetric(.loadReps, SetMetrics(load: 225)) == "225 lb")
        #expect(WorkoutRules.setMetric(.loadReps, SetMetrics(reps: 8)) == "× 8")
        #expect(WorkoutRules.setMetric(.loadReps, SetMetrics()) == "—")
        #expect(WorkoutRules.setMetric(.distance, SetMetrics(distance: 400)) == "400 m")
        #expect(WorkoutRules.setMetric(.duration, SetMetrics(duration: 30)) == "0:30")
        #expect(WorkoutRules.setMetric(.calories, SetMetrics(calories: 12)) == "12 cal")
        #expect(WorkoutRules.setMetric(.reps, SetMetrics(reps: 21)) == "× 21")
    }

    @Test func scores() {
        #expect(WorkoutRules.score(.time, Score(seconds: 462)) == "7:42")
        #expect(WorkoutRules.score(.roundsReps, Score(rounds: 17, reps: 8)) == "17 rounds + 8")
        #expect(WorkoutRules.score(.roundsReps, Score(rounds: 12)) == "12 rounds")
        #expect(WorkoutRules.score(.roundsReps, Score()) == nil)
        #expect(WorkoutRules.score(.load, Score(load: 185)) == "185 lb")
        #expect(WorkoutRules.score(.none, Score(seconds: 10)) == nil)
    }

    @Test func days() {
        let today = "2026-06-01"
        #expect(WorkoutDay.short(today) == "Mon, Jun 1")
        #expect(WorkoutDay.label(today, today: today) == "Today")
        #expect(WorkoutDay.label("2026-06-02", today: today) == "Tomorrow")
        #expect(WorkoutDay.label("2026-06-04", today: today) == "Thursday")
        #expect(WorkoutDay.label("2026-06-09", today: today) == "Tue, Jun 9")
        #expect(WorkoutDay.relative("2026-05-31", today: today) == "yesterday")
        #expect(WorkoutDay.relative("2026-05-25", today: today) == "7 days ago")
        #expect(WorkoutDay.relative("2026-05-11", today: today) == "3 weeks ago")
        #expect(WorkoutDay.relative("2026-02-01", today: today) == "4 months ago")
        #expect(WorkoutDay.daysAgo("2026-03-01", 1) == "2026-02-28")
        #expect(WorkoutDay.days(from: "2026-03-07", to: "2026-03-09") == 2)
    }

    @Test func dayOfAnInstantFollowsTheClock() {
        var pacific = Calendar(identifier: .gregorian)
        pacific.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        // 01:30 UTC on June 2 is still the evening of June 1 in California.
        let instant = ISO8601DateFormatter().date(from: "2026-06-02T01:30:00Z")!
        #expect(WorkoutDay.string(instant, calendar: pacific) == "2026-06-01")
    }
}

@Suite struct Grouping {
    @Test func partTitles() {
        let parsed = WorkoutRules.wodTitle("Steak and Pudding: Part 1")
        #expect(parsed?.base == "Steak and Pudding")
        #expect(parsed?.part == "Part 1")
        #expect(WorkoutRules.wodTitle("Back Squat") == nil)
        #expect(WorkoutRules.wodTitle(nil) == nil)
    }

    @Test func partsRunTogether() {
        let groups = WorkoutRules.groups([
            block("squat", title: "Back Squat", type: .strength),
            block("p1", title: "Part 1", group: "Steak and Pudding"),
            block("p2", title: "Part 2", group: "Steak and Pudding"),
            block("old1", title: "Chipper: Part 1"),
            block("old2", title: "Chipper: Part 2"),
            block("acc", type: .accessory),
        ])
        #expect(groups.map(\.blocks.count) == [1, 2, 2, 1])
        #expect(groups[1].label == "Steak and Pudding")
        #expect(groups[2].label == "Chipper")
        #expect(groups[0].label == nil)
        #expect(WorkoutRules.partLabel(groups[1].blocks[0]) == "Part 1")
        #expect(WorkoutRules.partLabel(groups[2].blocks[1]) == "Part 2")
    }

    @Test func metconLineKeepsTheRxInView() {
        let scaled = entry("Thruster", [
            set(load: 75, reps: 21, context: .metcon, rx: SetMetrics(reps: 21, load: 95, unit: "lb")),
            set(load: 95, reps: 15, context: .metcon),
        ])
        #expect(WorkoutRules.metconLine(scaled) == "75 lb × 21 (Rx 95 lb × 21) · 95 lb × 15")
    }
}

@Suite struct Focus {
    let today = "2026-06-01"

    @Test func anOpenedSessionWinsOverTheEvent() {
        let focus = WorkoutRules.focus(
            sessions: [session("opened", today, event: "cfo")],
            events: [event("cfo", today), event("other", today), event("later", "2026-06-03")],
            today: today
        )
        #expect(focus.today == .session(session("opened", today, event: "cfo")))
        #expect(!focus.todayCompleted)
        #expect(focus.next?.title == "later")
    }

    @Test func anUnopenedEventIsTodays() {
        let focus = WorkoutRules.focus(sessions: [], events: [event("cfo", today)], today: today)
        #expect(focus.today == .event(event("cfo", today)))
        #expect(focus.next == nil)
    }

    @Test func theOpenOneThenTheNewest() {
        let focus = WorkoutRules.focus(
            sessions: [
                session("done", today, completed: true, created: "2026-06-01T09:00:00Z"),
                session("open", today, created: "2026-06-01T07:00:00Z"),
            ],
            events: [], today: today
        )
        #expect(focus.today?.title == "open")
        let allDone = WorkoutRules.focus(
            sessions: [
                session("early", today, completed: true, created: "2026-06-01T07:00:00Z"),
                session("late", today, completed: true, created: "2026-06-01T09:00:00Z"),
            ],
            events: [], today: today
        )
        #expect(allDone.today?.title == "late")
        #expect(allDone.todayCompleted)
    }

    @Test func restDayLooksAhead() {
        let focus = WorkoutRules.focus(
            sessions: [session("old", "2026-05-30", completed: true), session("soon", "2026-06-04")],
            events: [event("sooner", "2026-06-02")], today: today
        )
        #expect(focus.today == nil)
        #expect(focus.next?.title == "sooner")
    }

    @Test func todoAndDone() {
        let sessions = [
            session("logging", "2026-05-30"), session("finished", "2026-05-29", completed: true),
            session("opened", "2026-06-02", event: "cfo-2"),
        ]
        let events = [event("cfo-2", "2026-06-02"), event("cfo-3", "2026-06-03"), event("past", "2026-05-31")]
        #expect(WorkoutRules.todo(sessions: sessions, events: events, today: today).map(\.title) == ["logging", "opened", "cfo-3"])
        #expect(WorkoutRules.done(sessions: sessions).map(\.title) == ["finished"])
    }

    @Test func trend() {
        let trend = WorkoutRules.trend(
            dates: ["2026-06-01", "2026-05-26", "2026-05-25", "2026-05-19", "2026-05-03", "2026-04-20", "2026-06-02"],
            today: today
        )
        // The week is the six days before today and today; May 25 is the
        // week before.
        #expect(trend == WorkoutTrend(last7: 2, prev7: 2, last30: 5, prev30: 1))
    }
}

@Suite struct Recap {
    @Test func uniformSetsCollapse() {
        let line = WorkoutRules.summarize(entry("Back Squat", Array(repeating: set(load: 225, reps: 5, e1rm: 262.5), count: 5)))
        #expect(line.detail == "5 × 225 lb × 5")
        #expect(line.e1rm == 262.5)
    }

    @Test func mixedSetsList() {
        let line = WorkoutRules.summarize(entry("Deadlift", [
            set(load: 315, reps: 3, e1rm: 346.5), set(load: 335, reps: 1, e1rm: 335), set(load: 135, reps: 20, e1rm: 225, loose: true),
        ]))
        #expect(line.detail == "315 lb × 3, 335 lb × 1, 135 lb × 20")
        #expect(line.e1rm == 346.5)
    }

    @Test func metconShowsTheSchemeOnly() {
        let line = WorkoutRules.summarize(entry("Pull-Up", [
            set(.reps, reps: 21, context: .metcon), set(.reps, reps: 15, context: .metcon),
        ]))
        #expect(line.detail == "21 reps, 15 reps")
        #expect(line.e1rm == nil)
    }

    @Test func headlineStats() {
        let detail = SessionDetail(
            id: UUID(), sessionDate: "2026-06-01", title: nil, source: "manual", calendarEventID: nil, rawDescription: nil,
            notes: nil, effort: nil, energy: nil, parsed: true, completed: true, whoopSyncStatus: nil,
            blocks: [block("a", type: .strength, entries: [
                entry("Back Squat", Array(repeating: set(load: 225, reps: 5, e1rm: 262.5), count: 5)),
                entry("Pull-Up", [set(.reps, reps: 10)]),
            ])]
        )
        #expect(WorkoutRules.stats(detail) == [
            SummaryStat(value: "6", label: "sets"),
            SummaryStat(value: "5,625", label: "lb volume"),
            SummaryStat(value: "262.5", label: "Back Squat e1RM"),
        ])
    }
}

@Suite struct Progress {
    let today = "2026-06-01"

    private func lift(_ name: String, family: String, _ date: String, e1rm: Double?, loose: Bool = false, context: SetContext = .strength) -> ProgressSet {
        ProgressSet(
            movementID: id(name), name: name, family: family, isLoaded: true, date: date, load: 100, reps: 5,
            e1rm: e1rm, e1rmIsLoose: loose, context: context
        )
    }

    @Test func bestsAgainstNinetyDaysAgo() {
        let families = WorkoutRules.familyProgress([
            lift("Back Squat", family: "squat", "2026-01-10", e1rm: 250),
            lift("Back Squat", family: "squat", "2026-05-20", e1rm: 275),
            lift("Back Squat", family: "squat", "2026-05-28", e1rm: 300, loose: true),
            lift("Front Squat", family: "squat", "2026-05-25", e1rm: 220),
            lift("Thruster", family: "squat", "2026-05-27", e1rm: 150, context: .metcon),
            lift("Run", family: "monostructural", "2026-05-30", e1rm: nil),
        ], today: today)
        #expect(families.map(\.family) == ["squat", "monostructural"])
        let squat = families[0]
        #expect(squat.lifts.map(\.name) == ["Back Squat", "Front Squat"])
        #expect(squat.lifts[0].bestE1rm == 275)
        #expect(squat.lifts[0].priorE1rm == 250)
        // A loose set doesn't count as the lift's last strength day.
        #expect(squat.lifts[0].lastDate == "2026-05-20")
        #expect(squat.lifts[1].priorE1rm == nil)
        #expect(squat.totalReps == 25)
        #expect(squat.totalVolumeLoad == 2500)
        #expect(squat.lastDate == "2026-05-28")
        #expect(families[1].label == "Cardio")
    }

    @Test func benchmarkBests() {
        func row(_ name: String, _ date: String, _ type: ScoreType, _ score: Score, _ level: RxLevel? = .rx) -> BenchmarkRow {
            BenchmarkRow(benchmarkID: id(name), name: name, date: date, scoreType: type, score: score, rxLevel: level)
        }
        let prs = WorkoutRules.benchmarkPRs([
            row("Fran", "2026-01-05", .time, Score(seconds: 462)),
            row("Fran", "2026-04-02", .time, Score(seconds: 418)),
            row("Fran", "2026-05-30", .time, Score(), .scaled),
            row("Cindy", "2026-05-01", .roundsReps, Score(rounds: 16, reps: 20)),
            row("Cindy", "2026-03-01", .roundsReps, Score(rounds: 17, reps: 3), .scaled),
        ])
        #expect(prs.map(\.name) == ["Fran", "Cindy"])
        // Lower is better only for time.
        #expect(prs[0].best.seconds == 418)
        #expect(prs[0].attempts == 3)
        #expect(prs[0].lastDate == "2026-05-30")
        #expect(prs[0].bestRxLevel == .rx)
        #expect(prs[1].best.rounds == 17)
        #expect(prs[1].bestRxLevel == .scaled)
    }
}

@Suite struct Queue {
    @Test @MainActor func pendingWritesShowOnAReload() {
        let defaults = UserDefaults(suiteName: "workouts.tests.\(UUID().uuidString)")!
        let sets = [set(load: 225, reps: 5, e1rm: 262.5)]
        var detail = SessionDetail(
            id: id("session"), sessionDate: "2026-06-01", title: nil, source: "manual", calendarEventID: nil, rawDescription: nil,
            notes: nil, effort: nil, energy: nil, parsed: true, completed: false, whoopSyncStatus: nil,
            blocks: [block("a", type: .strength, entries: [entry("Back Squat", sets)])]
        )
        let writes = WorkoutWrites(defaults: defaults)
        writes.enqueue(.set(
            id: sets[0].id, session: detail.id, actual: SetMetrics(reps: 5, load: 235, unit: "lb"),
            isLoadReps: true, e1rm: 274.2, e1rmIsLoose: false
        ))
        writes.enqueue(.notes(session: detail.id, text: "first"))
        writes.enqueue(.notes(session: detail.id, text: "second"))
        writes.enqueue(.completed(session: detail.id, at: .now))
        // A later write to the same thing replaces the one still waiting.
        #expect(writes.pending.count == 3)
        writes.apply(to: &detail)
        #expect(detail.blocks[0].entries[0].sets[0].actual.load == 235)
        #expect(detail.blocks[0].entries[0].sets[0].e1rm == 274.2)
        #expect(detail.notes == "second")
        #expect(detail.completed)
        // And it's all still there for the next launch.
        #expect(WorkoutWrites(defaults: defaults).pending.count == 3)
    }
}
