import Foundation
import Testing
@testable import MasonOS

/// A clock the test moves by hand.
private final class Clock {
    var now = Date(timeIntervalSince1970: 1_800_000_000)
    func advance(minutes: Double) { now = now.addingTimeInterval(minutes * 60) }
}

@MainActor
private func fresh() -> (PracticeTimer, PracticeWrites, Clock) {
    let defaults = UserDefaults(suiteName: "test-\(UUID().uuidString)")!
    let clock = Clock()
    let writes = PracticeWrites(defaults: defaults)
    let timer = PracticeTimer(writes: writes, defaults: defaults, now: { clock.now })
    return (timer, writes, clock)
}

private let pieceA = Piece(id: UUID(), workID: nil, name: "Nocturne", composer: nil, kind: "piece", maintenance: false)

private func task(goal: Int = 0, remaining: Int = 0) -> PracticeTask {
    PracticeTask(id: UUID(), pieceID: pieceA.id, timerSeconds: goal, timerRemainingSeconds: remaining,
                 completed: false, startedAt: nil, endedAt: nil, createdAt: .now, sessionNumber: 1)
}

@MainActor
@Suite struct PracticeTimerTests {
    @Test func aStopWritesTheTimeOffTheRemaining() {
        let (timer, writes, clock) = fresh()
        let t = task(goal: 900, remaining: 600) // 5 minutes already in
        timer.start(task: t, piece: pieceA, date: "2026-10-15", todayBeforeSeconds: 300)
        clock.advance(minutes: 12)
        let run = timer.stop(reason: .tap)
        #expect(run?.remainingSeconds == 600 - 12 * 60) // into overtime, as on the web
        #expect(timer.running == nil)
        #expect(writes.pending.last == .stop(taskID: t.id, remainingSeconds: -120, endedAt: clock.now))
    }

    @Test func aForgottenTimerStopsAnHourAfterTheLastTouch() {
        let (timer, writes, clock) = fresh()
        let t = task()
        timer.start(task: t, piece: pieceA, date: "2026-10-15", todayBeforeSeconds: 0)
        let started = clock.now
        clock.advance(minutes: 59)
        timer.enforceCutoff()
        #expect(timer.running != nil)
        clock.advance(minutes: 120)
        timer.enforceCutoff()
        #expect(timer.running == nil)
        // Logged as stopping at the cutoff, with an hour on it, not three.
        #expect(writes.pending.last == .stop(taskID: t.id, remainingSeconds: -3600, endedAt: started.addingTimeInterval(3600)))
    }

    @Test func touchingTheAppMovesTheCutoff() {
        let (timer, _, clock) = fresh()
        timer.start(task: task(), piece: pieceA, date: "2026-10-15", todayBeforeSeconds: 0)
        clock.advance(minutes: 50)
        timer.touch()
        clock.advance(minutes: 50)
        timer.enforceCutoff()
        #expect(timer.running?.elapsed(at: clock.now) == 100 * 60)
    }

    @Test func touchingAfterTheCutoffStopsIt() {
        let (timer, writes, clock) = fresh()
        let t = task()
        timer.start(task: t, piece: pieceA, date: "2026-10-15", todayBeforeSeconds: 0)
        clock.advance(minutes: 90)
        timer.touch()
        #expect(timer.running == nil)
        #expect(writes.pending.last == .stop(taskID: t.id, remainingSeconds: -3600, endedAt: clock.now.addingTimeInterval(-30 * 60)))
    }

    @Test func startingAnotherStopsTheFirst() {
        let (timer, writes, clock) = fresh()
        let a = task(), b = task()
        timer.start(task: a, piece: pieceA, date: "2026-10-15", todayBeforeSeconds: 0)
        clock.advance(minutes: 3)
        timer.start(task: b, piece: pieceA, date: "2026-10-15", todayBeforeSeconds: 180)
        #expect(timer.running?.taskID == b.id)
        #expect(writes.pending.contains(.stop(taskID: a.id, remainingSeconds: -180, endedAt: clock.now)))
    }

    @Test func aRunningTimerSurvivesARelaunch() {
        let defaults = UserDefaults(suiteName: "test-\(UUID().uuidString)")!
        let writes = PracticeWrites(defaults: defaults)
        let t = task()
        PracticeTimer(writes: writes, defaults: defaults).start(task: t, piece: pieceA, date: "2026-10-15", todayBeforeSeconds: 0)
        let relaunched = PracticeTimer(writes: PracticeWrites(defaults: defaults), defaults: defaults)
        #expect(relaunched.running?.taskID == t.id)
    }
}

@MainActor
@Suite struct PendingWritesTests {
    @Test func theDayReadsAsItWillOnceTheQueueIsThrough() {
        let writes = PracticeWrites(defaults: UserDefaults(suiteName: "test-\(UUID().uuidString)")!)
        let made = UUID()
        let at = Date(timeIntervalSince1970: 1_800_000_000)
        writes.enqueue(.create(id: made, pieceID: pieceA.id, date: "2026-10-15", sessionNumber: 2, createdAt: at))
        writes.enqueue(.start(taskID: made, at: at))
        writes.enqueue(.stop(taskID: made, remainingSeconds: -300, endedAt: at.addingTimeInterval(300)))
        writes.enqueue(.create(id: UUID(), pieceID: pieceA.id, date: "2026-10-14", sessionNumber: 1, createdAt: at))

        let day = writes.apply(to: [], date: "2026-10-15")
        #expect(day.count == 1) // yesterday's entry stays off today
        #expect(day.first?.id == made)
        #expect(day.first?.elapsedSeconds == 300)
        #expect(day.first?.sessionNumber == 2)
    }
}
