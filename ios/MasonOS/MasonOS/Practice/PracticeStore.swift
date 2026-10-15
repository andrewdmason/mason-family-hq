import Foundation
import Observation
import Supabase

/// What one piece's card shows.
struct PieceState: Equatable {
    var running: Bool
    /// Practice today, including the live seconds of a running timer.
    var elapsedSeconds: Int
    var goalSeconds: Int
    var playedToday: Bool
    var lastPracticed: String?
}

/// Today's quick log: the active pieces, what's already in today's log, and
/// what a tap does to it.
@MainActor
@Observable
final class PracticeStore {
    private(set) var pieces: [Piece] = []
    private(set) var worksByID: [UUID: String] = [:]
    private(set) var tasks: [PracticeTask] = []
    /// Last day real practice went into each piece, as of today.
    private(set) var lastPracticed: [UUID: String] = [:]
    private(set) var today = PracticeDay.today()
    private(set) var loaded = false
    private(set) var loadError: String?

    let timer: PracticeTimer
    private let writes: PracticeWrites
    private var db: SupabaseClient { Session.shared.client }

    init(timer: PracticeTimer = .shared, writes: PracticeWrites = .shared) {
        self.timer = timer
        self.writes = writes
        NotificationCenter.default.addObserver(forName: .practiceRunStopped, object: nil, queue: .main) { [weak self] note in
            guard let run = note.userInfo?["run"] as? StoppedRun else { return }
            MainActor.assumeIsolated { self?.record(run) }
        }
    }

    var cards: (current: [QuickCard], maintenance: [QuickCard]) {
        QuickLog.cards(activePieces: pieces, worksByID: worksByID)
    }

    /// The rotation's next piece gets a quiet highlight, as on the website.
    var dueMaintenanceID: UUID? {
        QuickLog.dueMaintenance(
            pieces: pieces, lastPracticed: lastPracticed,
            excluded: Set(tasks.compactMap(\.pieceID)), asOf: today
        )?.id
    }

    // MARK: Loading

    func load() async {
        today = PracticeDay.today()
        await writes.flush()
        // Archive days that have ended first, as the website does on load.
        let db = self.db
        let today = self.today
        _ = try? await db.rpc("practice_rollover", params: ["cutoff": PracticeDay.rolloverCutoff()]).execute()
        do {
            struct Work: Decodable { let id: UUID; let name: String }
            struct LastPracticed: Decodable { let piece_id: UUID; let last_practiced: String }
            async let piecesQuery: [Piece] = db.from("pieces")
                .select("id, work_id, name, composer, kind, maintenance")
                .eq("status", value: "active")
                .order("name")
                .execute().value
            async let worksQuery: [Work] = db.from("works").select("id, name").execute().value
            async let tasksQuery: [PracticeTask] = db.from("practice_tasks")
                .select("id, piece_id, timer_seconds, timer_remaining_seconds, completed, started_at, ended_at, created_at, session_number")
                .eq("date", value: today)
                .order("session_number")
                .order("sort_order")
                .execute().value
            async let lastQuery: [LastPracticed] = db.rpc("piece_last_practiced", params: ["as_of_dates": [today]])
                .execute().value
            let (p, w, t, l) = try await (piecesQuery, worksQuery, tasksQuery, lastQuery)
            pieces = p
            worksByID = Dictionary(w.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
            tasks = writes.apply(to: t, date: today)
            lastPracticed = Dictionary(l.map { ($0.piece_id, $0.last_practiced) }, uniquingKeysWith: { a, _ in a })
            loadError = nil
        } catch {
            loadError = "Couldn't load today's practice. Pull to try again."
        }
        loaded = true
    }

    /// A new day while the app was open: start the cards over.
    func checkDayChange() async {
        if PracticeDay.today() != today { await load() }
    }

    // MARK: Cards

    func state(for piece: Piece, at now: Date) -> PieceState {
        let mine = tasks.filter { $0.pieceID == piece.id }
        let run = timer.running.flatMap { $0.pieceID == piece.id && $0.date == today ? $0 : nil }
        var elapsed = 0
        var goal = 0
        for task in mine {
            goal += max(0, task.timerSeconds)
            if task.id == run?.taskID { continue }
            elapsed += task.elapsedSeconds
        }
        if let run { elapsed += run.taskElapsed(at: now) }
        return PieceState(
            running: run != nil, elapsedSeconds: elapsed, goalSeconds: goal,
            playedToday: run != nil || elapsed > 0, lastPracticed: lastPracticed[piece.id]
        )
    }

    // MARK: Tapping

    /// The quick log's one gesture, the same as on the website: tap the running
    /// piece to stop it; tap anything else to time it (today's entry for it, or
    /// a new one), stopping whatever was running.
    func tap(_ piece: Piece) {
        if let run = timer.running, run.pieceID == piece.id {
            if let stopped = timer.stop(reason: .tap) { record(stopped) }
            return
        }

        let now = Date.now
        let target: PracticeTask
        if let existing = QuickLog.taskToTime(tasks.filter { $0.pieceID == piece.id }) {
            target = existing
        } else {
            // Nothing for this piece today: put an entry on the day and time it
            // in the same moment. The row follows when there's signal.
            let session = tasks.map(\.sessionNumber).max() ?? 1
            let created = PracticeTask(
                id: UUID(), pieceID: piece.id, timerSeconds: 0, timerRemainingSeconds: 0,
                completed: false, startedAt: nil, endedAt: nil, createdAt: now, sessionNumber: session
            )
            tasks.append(created)
            writes.enqueue(.create(id: created.id, pieceID: piece.id, date: today, sessionNumber: session, createdAt: now))
            target = created
        }

        // Stop the old run first so its time is in the day's total.
        if let stopped = timer.stop(reason: .switched) { record(stopped) }
        let before = tasks.reduce(0) { $0 + $1.elapsedSeconds }
        timer.start(task: target, piece: piece, date: today, todayBeforeSeconds: before)
        if let i = tasks.firstIndex(where: { $0.id == target.id }) { tasks[i].startedAt = now }
    }

    /// Today's total, a running timer included.
    func todayTotal(at now: Date) -> Int {
        let run = timer.running.flatMap { $0.date == today ? $0 : nil }
        return tasks.reduce(0) { sum, task in
            sum + (task.id == run?.taskID ? run!.taskElapsed(at: now) : task.elapsedSeconds)
        }
    }

    private func record(_ run: StoppedRun) {
        guard let i = tasks.firstIndex(where: { $0.id == run.taskID }) else { return }
        tasks[i].timerRemainingSeconds = run.remainingSeconds
        tasks[i].endedAt = run.endedAt
    }
}
