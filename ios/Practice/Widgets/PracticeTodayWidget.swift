import MasonKit
import Supabase
import SwiftUI
import WidgetKit

/// Today's practice total on the home screen. Tapping a widget opens its app,
/// so that part needs nothing here.
struct PracticeTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PracticeToday", provider: PracticeTodayProvider()) { entry in
            PracticeTodayView(entry: entry)
                .containerBackground(for: .widget) {
                    if entry.goalMet { PracticeTodayView.celebration } else { Rectangle().fill(.background) }
                }
        }
        .configurationDisplayName("Today's practice")
        .description("How long you've practiced today, in green once the day's plan is done.")
        .supportedFamilies([.systemSmall])
    }
}

private struct PracticeTodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> PracticeTodayEntry {
        PracticeTodayEntry(date: .now, seconds: 45 * 60, running: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (PracticeTodayEntry) -> Void) {
        completion(PracticeToday.timeline(saved: .load(), loggedOnServer: nil, now: .now).entries[0])
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PracticeTodayEntry>) -> Void) {
        Task {
            let server = try? await loggedToday()
            completion(PracticeToday.timeline(saved: .load(), loggedOnServer: server?.logged, goalOnServer: server?.goal, now: .now))
        }
    }

    /// Today's total and goal in the log, the way the app adds them up. Given
    /// up on after a few seconds: iOS doesn't wait long, and the phone's own
    /// count will do.
    private func loggedToday() async throws -> (logged: Int, goal: Int) {
        struct Row: Decodable {
            struct Work: Decodable { let track_by_movement: Bool }
            struct Piece: Decodable { let whole_work: Bool; let works: Work? }
            let timer_seconds: Int
            let timer_remaining_seconds: Int
            let pieces: Piece?

            /// The app's rule: a duration on a piece the "Track by movement"
            /// switch hides doesn't count toward the goal.
            var countsTowardGoal: Bool {
                guard let piece = pieces else { return true }
                return QuickLog.isShown(wholeWork: piece.whole_work, workTrackedWhole: piece.works.map { !$0.track_by_movement } ?? false)
            }
        }
        let db = await Session.shared.client
        let today = PracticeDay.today()
        return try await withThrowingTaskGroup(of: (logged: Int, goal: Int).self) { group in
            group.addTask {
                let rows: [Row] = try await db.from("practice_tasks")
                    .select("timer_seconds, timer_remaining_seconds, pieces(whole_work, works(track_by_movement))")
                    .eq("date", value: today)
                    .execute()
                    .value
                return (
                    logged: rows.reduce(0) { $0 + max(0, $1.timer_seconds - $1.timer_remaining_seconds) },
                    goal: rows.filter(\.countsTowardGoal).reduce(0) { $0 + max(0, $1.timer_seconds) }
                )
            }
            group.addTask {
                try await Task.sleep(for: .seconds(8))
                throw CancellationError()
            }
            defer { group.cancelAll() }
            return try await group.next() ?? (0, 0)
        }
    }
}

private struct PracticeTodayView: View {
    let entry: PracticeTodayEntry
    @Environment(\.widgetRenderingMode) private var renderingMode

    /// The day's plan done: a deep green, lighter at the top.
    static let celebration = LinearGradient(
        colors: [Color(red: 0.36, green: 0.72, blue: 0.47), Color(red: 0.16, green: 0.50, blue: 0.31)],
        startPoint: .top, endPoint: .bottom
    )

    var body: some View {
        if entry.goalMet { celebrating } else { counting }
    }

    private var counting: some View {
        VStack(alignment: .leading) {
            HStack(spacing: 4) {
                Image(systemName: "music.note")
                Text("Today")
                Spacer()
                if entry.running {
                    Circle().fill(.red).frame(width: 9, height: 9)
                }
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.secondary)
            Spacer()
            total
                .foregroundStyle(entry.running ? Color.red : Color.primary)
        }
    }

    /// White on green, a seal where the note was. On a tinted or clear home
    /// screen the green goes, and the seal and words carry it.
    private var celebrating: some View {
        let full = renderingMode == .fullColor
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 30))
                    .symbolRenderingMode(.hierarchical)
                    .widgetAccentable()
                Spacer()
                if entry.running {
                    Circle().fill(full ? Color.white : Color.red).frame(width: 9, height: 9)
                }
            }
            Spacer()
            Text("Goal met")
                .font(.subheadline.weight(.semibold))
                .opacity(0.85)
            total
        }
        .foregroundStyle(full ? Color.white : Color.primary)
    }

    private var total: some View {
        Text(QuickLog.total(entry.seconds))
            .font(.system(size: 44, weight: .semibold, design: .rounded).monospacedDigit())
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

#Preview("Goal met", as: .systemSmall) {
    PracticeTodayWidget()
} timeline: {
    PracticeTodayEntry(date: .now, seconds: 40 * 60, running: false, goalSeconds: 45 * 60)
    PracticeTodayEntry(date: .now, seconds: 45 * 60, running: true, goalSeconds: 45 * 60)
    PracticeTodayEntry(date: .now, seconds: 62 * 60, running: false, goalSeconds: 45 * 60)
}
