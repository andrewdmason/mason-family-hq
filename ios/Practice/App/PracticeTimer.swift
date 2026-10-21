import ActivityKit
import Foundation
import Observation

/// A timer that's running, kept on disk so closing or killing the app doesn't
/// lose it: everything is worked out from when it started.
struct RunningTimer: Codable, Equatable {
    /// A forgotten timer stops itself this long after the last interaction.
    static let autoEndAfter: TimeInterval = 60 * 60

    var taskID: UUID
    var pieceID: UUID
    var pieceName: String
    /// The practice day it's logged on.
    var date: String
    var startedAt: Date
    var lastInteraction: Date
    /// The task's timer_remaining_seconds when this run began. Elapsed time
    /// comes off it, past zero into overtime, as on the website.
    var remainingAtStart: Int
    var goalSeconds: Int
    /// Today's practice before this run, for the Live Activity's total.
    var todayBeforeSeconds: Int

    var endsBy: Date { lastInteraction.addingTimeInterval(Self.autoEndAfter) }

    /// Seconds this run has counted, stopping at the auto-end.
    func elapsed(at now: Date) -> Int {
        max(0, Int(min(now, endsBy).timeIntervalSince(startedAt)))
    }

    func isOver(at now: Date) -> Bool { now >= endsBy }

    /// What timer_remaining_seconds becomes when it stops.
    func remaining(at now: Date) -> Int { remainingAtStart - elapsed(at: now) }

    /// The task's whole practice so far, this run included.
    func taskElapsed(at now: Date) -> Int { max(0, goalSeconds - remaining(at: now)) }
}

/// A run that just ended, for the screen to update its copy of the day.
struct StoppedRun {
    let taskID: UUID
    let remainingSeconds: Int
    let endedAt: Date
}

extension Notification.Name {
    static let practiceRunStopped = Notification.Name("practiceRunStopped")
}

/// The one practice timer: start, stop, the hour-without-touching cutoff, and
/// the Live Activity that shows it on the Lock Screen.
@MainActor
@Observable
final class PracticeTimer {
    static let shared = PracticeTimer()

    enum StopReason { case tap, switched, liveActivity, autoEnded }

    private(set) var running: RunningTimer?
    private static let key = "practice.runningTimer"
    private let writes: PracticeWrites
    private let defaults: UserDefaults
    private let now: () -> Date

    init(writes: PracticeWrites = .shared, defaults: UserDefaults = .standard, now: @escaping () -> Date = { .now }) {
        self.writes = writes
        self.defaults = defaults
        self.now = now
        if let data = defaults.data(forKey: Self.key) {
            running = try? JSONDecoder().decode(RunningTimer.self, from: data)
        }
    }

    func start(task: PracticeTask, piece: Piece, date: String, todayBeforeSeconds: Int) {
        if running != nil { stop(reason: .switched) }
        let at = now()
        let timer = RunningTimer(
            taskID: task.id, pieceID: piece.id, pieceName: piece.name, date: date,
            startedAt: at, lastInteraction: at,
            remainingAtStart: task.timerRemainingSeconds, goalSeconds: task.timerSeconds,
            todayBeforeSeconds: todayBeforeSeconds
        )
        running = timer
        save()
        writes.enqueue(.start(taskID: task.id, at: at))
        LiveActivity.start(timer)
    }

    @discardableResult
    func stop(reason: StopReason) -> StoppedRun? {
        guard let timer = running else { return nil }
        let at = now()
        // A forgotten timer is logged as stopping at its cutoff, not now.
        let run = StoppedRun(taskID: timer.taskID, remainingSeconds: timer.remaining(at: at), endedAt: min(at, timer.endsBy))
        running = nil
        save()
        writes.enqueue(.stop(taskID: run.taskID, remainingSeconds: run.remainingSeconds, endedAt: run.endedAt))
        LiveActivity.end()
        NotificationCenter.default.post(name: .practiceRunStopped, object: nil, userInfo: ["run": run])
        return run
    }

    /// Opening the app or tapping in it counts as being there: the cutoff
    /// moves to an hour from now. A timer already past its cutoff stops.
    func touch() {
        guard var timer = running else { return }
        if timer.isOver(at: now()) {
            stop(reason: .autoEnded)
            return
        }
        timer.lastInteraction = now()
        running = timer
        save()
        LiveActivity.update(timer)
    }

    /// Stops a timer that has run an hour since anyone touched it. Called on
    /// launch, on return to the app, and every second while it's open.
    func enforceCutoff() {
        if let timer = running, timer.isOver(at: now()) { stop(reason: .autoEnded) }
    }

    /// Puts the Live Activity back in step with the timer after a relaunch.
    func restoreLiveActivity() {
        if let running { LiveActivity.update(running) } else { LiveActivity.end() }
    }

    private func save() {
        if let running, let data = try? JSONEncoder().encode(running) {
            defaults.set(data, forKey: Self.key)
        } else {
            defaults.removeObject(forKey: Self.key)
        }
    }
}

/// The Lock Screen / Dynamic Island side. There's only ever one.
@MainActor
enum LiveActivity {
    private static func content(_ timer: RunningTimer) -> ActivityContent<PracticeActivityAttributes.ContentState> {
        ActivityContent(
            state: .init(pieceName: timer.pieceName, startedAt: timer.startedAt, endsBy: timer.endsBy, todayBeforeSeconds: timer.todayBeforeSeconds),
            // Past the cutoff the Lock Screen says the timer stopped.
            staleDate: timer.endsBy
        )
    }

    static func start(_ timer: RunningTimer) {
        end()
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        _ = try? Activity.request(attributes: PracticeActivityAttributes(taskID: timer.taskID), content: content(timer))
    }

    static func update(_ timer: RunningTimer) {
        let activities = Activity<PracticeActivityAttributes>.activities
        guard let activity = activities.first(where: { $0.attributes.taskID == timer.taskID }) else {
            start(timer)
            return
        }
        Task { await activity.update(content(timer)) }
    }

    static func end() {
        for activity in Activity<PracticeActivityAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
