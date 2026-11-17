import Foundation
import MasonKit
import Observation
import Supabase

/// A change to a logged workout, made on the phone first and sent when it can
/// be. The same writes the website makes (src/app/(workouts)/workouts/actions.ts),
/// so either one reads the other's.
enum WorkoutWrite: Codable, Equatable {
    /// What was actually done for a set, with its estimated 1RM worked out
    /// here as the website's updateSet does (`e1rm` only applies to load × reps).
    case set(id: UUID, session: UUID, actual: SetMetrics, isLoadReps: Bool, e1rm: Double?, e1rmIsLoose: Bool)
    /// A block's result.
    case score(block: UUID, session: UUID, score: Score)
    case notes(session: UUID, text: String?)
    case effort(session: UUID, value: String?)
    case energy(session: UUID, value: String?)
    /// Marked done at a time, or reopened.
    case completed(session: UUID, at: Date?)

    /// What it overwrites: a later write to the same thing replaces an
    /// earlier one still waiting.
    var slot: String {
        switch self {
        case .set(let id, _, _, _, _, _): "set:\(id)"
        case .score(let block, _, _): "score:\(block)"
        case .notes(let session, _): "notes:\(session)"
        case .effort(let session, _): "effort:\(session)"
        case .energy(let session, _): "energy:\(session)"
        case .completed(let session, _): "completed:\(session)"
        }
    }

    var session: UUID {
        switch self {
        case .set(_, let session, _, _, _, _), .score(_, let session, _), .notes(let session, _),
             .effort(let session, _), .energy(let session, _), .completed(let session, _):
            session
        }
    }
}

/// The queue of writes not yet in the database. Kept on disk, so a set logged
/// in a gym with no signal isn't lost; sent in order, oldest first.
@MainActor
@Observable
final class WorkoutWrites {
    static let shared = WorkoutWrites()

    private(set) var pending: [WorkoutWrite] = []
    private var flushing = false
    private var scheduled: Task<Void, Never>?
    private let defaults: UserDefaults
    private static let key = "workouts.pendingWrites"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.key),
           let saved = try? JSONDecoder().decode([WorkoutWrite].self, from: data) {
            pending = saved
        }
    }

    /// Queue a write and send it shortly, so a number typed digit by digit
    /// goes once.
    func enqueue(_ write: WorkoutWrite) {
        pending.removeAll { $0.slot == write.slot }
        pending.append(write)
        save()
        scheduled?.cancel()
        scheduled = Task {
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            await flush()
        }
    }

    /// Send what's waiting. Stops at the first write that can't go yet (no
    /// signal) and leaves it for next time; a write the database refuses is
    /// dropped so it can't hold up everything behind it.
    func flush() async {
        guard !flushing, Session.shared.isSignedIn else { return }
        flushing = true
        defer { flushing = false }
        while let write = pending.first {
            do {
                try await send(write)
            } catch is PostgrestError {
                print("workout write refused, dropping: \(write)")
            } catch {
                return
            }
            // Replaced while it was on its way: the newer one is still to go.
            if pending.first == write { pending.removeFirst() }
            save()
        }
    }

    /// A session as it will be once the queue is through.
    func apply(to detail: inout SessionDetail) {
        for write in pending where write.session == detail.id {
            switch write {
            case let .set(id, _, actual, isLoadReps, e1rm, loose):
                for b in detail.blocks.indices {
                    for e in detail.blocks[b].entries.indices {
                        guard let s = detail.blocks[b].entries[e].sets.firstIndex(where: { $0.id == id }) else { continue }
                        detail.blocks[b].entries[e].sets[s].actual = actual
                        if isLoadReps {
                            detail.blocks[b].entries[e].sets[s].e1rm = e1rm
                            detail.blocks[b].entries[e].sets[s].e1rmIsLoose = loose
                        }
                    }
                }
            case let .score(block, _, score):
                if let b = detail.blocks.firstIndex(where: { $0.id == block }) { detail.blocks[b].score = score }
            case let .notes(_, text): detail.notes = text
            case let .effort(_, value): detail.effort = value
            case let .energy(_, value): detail.energy = value
            case let .completed(_, at): detail.completed = at != nil
            }
        }
    }

    /// The session list as it will be once the queue is through.
    func apply(to sessions: inout [SessionSummary]) {
        for case let .completed(session, at) in pending {
            if let i = sessions.firstIndex(where: { $0.id == session }) { sessions[i].completed = at != nil }
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(pending) { defaults.set(data, forKey: Self.key) }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func json(_ value: Int?) -> AnyJSON { value.map { .integer($0) } ?? .null }
    private static func json(_ value: Double?) -> AnyJSON { value.map { .double($0) } ?? .null }
    private static func json(_ value: String?) -> AnyJSON { value.map { .string($0) } ?? .null }

    private func send(_ write: WorkoutWrite) async throws {
        let db = Session.shared.client
        switch write {
        case let .set(id, session, actual, isLoadReps, e1rm, loose):
            var row: [String: AnyJSON] = [
                "actual_reps": Self.json(actual.reps),
                "actual_load": Self.json(actual.load),
                "actual_distance": Self.json(actual.distance),
                "actual_duration": Self.json(actual.duration),
                "actual_calories": Self.json(actual.calories),
            ]
            if isLoadReps {
                row["e1rm"] = Self.json(e1rm)
                row["e1rm_is_loose"] = .bool(loose)
            }
            try await db.from("workout_sets").update(row).eq("id", value: id.uuidString.lowercased()).execute()
            // What WHOOP was sent no longer matches (the website's
            // markSessionWhoopDirty).
            try await db.from("workout_sessions")
                .update(["whoop_sync_status": "dirty"])
                .eq("id", value: session.uuidString.lowercased())
                .eq("whoop_sync_status", value: "synced")
                .not("whoop_workout_id", operator: .is, value: "null")
                .execute()
        case let .score(block, _, score):
            let row: [String: AnyJSON] = [
                "score_seconds": Self.json(score.seconds),
                "score_rounds": Self.json(score.rounds),
                "score_reps": Self.json(score.reps),
                "score_distance": Self.json(score.distance),
                "score_calories": Self.json(score.calories),
            ]
            try await db.from("workout_blocks").update(row).eq("id", value: block.uuidString.lowercased()).execute()
        case let .notes(session, text):
            try await update(session, ["notes": Self.json(text)])
        case let .effort(session, value):
            try await update(session, ["effort": Self.json(value)])
        case let .energy(session, value):
            try await update(session, ["energy": Self.json(value)])
        case let .completed(session, at):
            try await update(session, ["completed_at": Self.json(at.map(Self.iso.string(from:)))])
        }
    }

    private func update(_ session: UUID, _ row: [String: AnyJSON]) async throws {
        try await Session.shared.client.from("workout_sessions")
            .update(row)
            .eq("id", value: session.uuidString.lowercased())
            .execute()
    }
}
