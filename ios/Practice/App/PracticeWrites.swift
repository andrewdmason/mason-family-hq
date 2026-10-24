import Foundation
import MasonKit
import Observation
import Supabase

/// A change to practice_tasks, made on the phone first and sent to the log
/// when it can be. The same writes the website makes
/// (src/app/practice/timer/task-actions.ts), so either one reads the other's.
enum PracticeWrite: Codable, Equatable {
    /// A new entry for a piece, appended to the end of its day like the
    /// website's quick log does. The id is made here, so the timer can run on
    /// it before the row exists.
    case create(id: UUID, pieceID: UUID, date: String, sessionNumber: Int, createdAt: Date)
    case start(taskID: UUID, at: Date)
    case stop(taskID: UUID, remainingSeconds: Int, endedAt: Date)
}

/// The queue of writes not yet in the log. Kept on disk, so nothing is lost to
/// a dead zone or a killed app; sent in order, oldest first.
@MainActor
@Observable
final class PracticeWrites {
    static let shared = PracticeWrites()

    private(set) var pending: [PracticeWrite] = []
    private var flushing = false
    private let defaults: UserDefaults
    private static let key = "practice.pendingWrites"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.key),
           let saved = try? JSONDecoder().decode([PracticeWrite].self, from: data) {
            pending = saved
        }
    }

    func enqueue(_ write: PracticeWrite) {
        pending.append(write)
        save()
        Task { await flush() }
    }

    /// Send what's waiting. Stops at the first write that can't go yet (no
    /// signal) and leaves it for next time; a write the database refuses is
    /// dropped so it can't hold up everything behind it.
    func flush() async {
        // Launched in the background by the Live Activity's Stop button, the
        // stored sign-in may not be read yet.
        for _ in 0..<50 where !Session.shared.checked {
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard !flushing, Session.shared.isSignedIn else { return }
        flushing = true
        defer { flushing = false }
        while let write = pending.first {
            do {
                try await send(write)
            } catch is PostgrestError {
                print("practice write refused, dropping: \(write)")
            } catch {
                return
            }
            pending.removeFirst()
            save()
        }
    }

    /// Today's rows as the log will have them once the queue is through.
    func apply(to tasks: [PracticeTask], date: String) -> [PracticeTask] {
        var tasks = tasks
        for write in pending {
            switch write {
            case let .create(id, pieceID, day, session, createdAt):
                guard day == date, !tasks.contains(where: { $0.id == id }) else { continue }
                tasks.append(PracticeTask(
                    id: id, pieceID: pieceID, timerSeconds: 0, timerRemainingSeconds: 0,
                    completed: false, startedAt: nil, endedAt: nil, createdAt: createdAt, sessionNumber: session
                ))
            case let .start(taskID, at):
                if let i = tasks.firstIndex(where: { $0.id == taskID }) { tasks[i].startedAt = at }
            case let .stop(taskID, remaining, endedAt):
                if let i = tasks.firstIndex(where: { $0.id == taskID }) {
                    tasks[i].timerRemainingSeconds = remaining
                    tasks[i].endedAt = endedAt
                }
            }
        }
        return tasks
    }

    private func save() {
        if let data = try? JSONEncoder().encode(pending) { defaults.set(data, forKey: Self.key) }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func send(_ write: PracticeWrite) async throws {
        let db = Session.shared.client
        switch write {
        case let .create(id, pieceID, date, session, createdAt):
            // At the end of the day, as the website's createTask places it.
            struct Order: Decodable { let sort_order: Int }
            let last: [Order] = try await db.from("practice_tasks")
                .select("sort_order")
                .eq("date", value: date)
                .order("sort_order", ascending: false)
                .limit(1)
                .execute()
                .value
            struct Row: Encodable {
                let id: String, piece_id: String, date: String
                let sort_order: Int, session_number: Int
                let timer_seconds = 0, timer_remaining_seconds = 0
                let created_at: String
            }
            // Sent again after a lost reply, the row is already there: skip it.
            try await db.from("practice_tasks")
                .upsert(Row(
                    id: id.uuidString.lowercased(), piece_id: pieceID.uuidString.lowercased(), date: date,
                    sort_order: (last.first?.sort_order ?? -1) + 1, session_number: session,
                    created_at: Self.iso.string(from: createdAt)
                ), onConflict: "id", ignoreDuplicates: true)
                .execute()
        case let .start(taskID, at):
            try await db.from("practice_tasks")
                .update(["started_at": Self.iso.string(from: at)])
                .eq("id", value: taskID.uuidString.lowercased())
                .execute()
        case let .stop(taskID, remaining, endedAt):
            struct Stop: Encodable { let timer_remaining_seconds: Int; let ended_at: String }
            try await db.from("practice_tasks")
                .update(Stop(timer_remaining_seconds: remaining, ended_at: Self.iso.string(from: endedAt)))
                .eq("id", value: taskID.uuidString.lowercased())
                .execute()
        }
    }
}
