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
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Today's practice")
        .description("How long you've practiced today.")
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
            let logged = try? await loggedToday()
            completion(PracticeToday.timeline(saved: .load(), loggedOnServer: logged, now: .now))
        }
    }

    /// Today's total in the log, the way the app adds it up. Given up on after
    /// a few seconds: iOS doesn't wait long, and the phone's own count will do.
    private func loggedToday() async throws -> Int {
        struct Row: Decodable { let timer_seconds: Int; let timer_remaining_seconds: Int }
        let db = await Session.shared.client
        let today = PracticeDay.today()
        return try await withThrowingTaskGroup(of: Int.self) { group in
            group.addTask {
                let rows: [Row] = try await db.from("practice_tasks")
                    .select("timer_seconds, timer_remaining_seconds")
                    .eq("date", value: today)
                    .execute()
                    .value
                return rows.reduce(0) { $0 + max(0, $1.timer_seconds - $1.timer_remaining_seconds) }
            }
            group.addTask {
                try await Task.sleep(for: .seconds(8))
                throw CancellationError()
            }
            defer { group.cancelAll() }
            return try await group.next() ?? 0
        }
    }
}

private struct PracticeTodayView: View {
    let entry: PracticeTodayEntry

    var body: some View {
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
            Text(QuickLog.total(entry.seconds))
                .font(.system(size: 44, weight: .semibold, design: .rounded).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundStyle(entry.running ? Color.red : Color.primary)
        }
    }
}
