import MasonKit
import SwiftUI
import WidgetKit

@main
struct CalendarWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
    }
}

/// Today on the home screen: the member's own events from now on and the time
/// between them, or (with that setting off) the Day view in small, with the
/// phone's own member in the wide column and the family as pin lines beside
/// it. Tapping an event opens it in the app; anywhere else opens the app on
/// today.
struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CalendarToday", provider: TodayProvider()) { entry in
            TodayWidgetView(model: entry.model)
                .widgetURL(URL(string: "io.mason.calendar://today"))
                .containerBackground(for: .widget) { CalendarStyle.ground }
        }
        .configurationDisplayName("Today")
        .description("Your day, with where the rest of the family is.")
        .supportedFamilies([.systemLarge])
    }
}

struct TodayEntry: TimelineEntry {
    let date: Date
    let model: TodayWidgetModel?
}

private struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: .now, model: Self.model(DemoCalendar.make(), me: DemoCalendar.sebastian, at: .now))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        // The gallery shows the made-up family until there's a real one.
        completion(Self.entries(from: .now).first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        Task { @MainActor in
            await Self.readCalendar()
            let now = Date()
            let entries = Self.entries(from: now)
            // iOS allows a few dozen wake-ups a day: one every half hour picks
            // up what the family changed, and midnight turns the page.
            let midnight = Day(now).adding(days: 1).start()
            completion(Timeline(
                entries: entries.isEmpty ? [TodayEntry(date: now, model: nil)] : entries,
                policy: .after(min(now.addingTimeInterval(30 * 60), midnight))
            ))
        }
    }

    /// What the widget shows from `now` on: the copy the app last saved, at
    /// each minute for the next two hours, so "1h 4m free", the now line and
    /// the hours in view keep time with nothing awake. The calendar is laid
    /// out once and each minute read from that.
    private static func entries(from now: Date) -> [TodayEntry] {
        guard let who = CalendarShared.who,
              let data = try? Data(contentsOf: CalendarShared.copy(who.user)),
              let snapshot = try? JSONDecoder().decode(CalendarSnapshot.self, from: data)
        else { return [] }
        var photos: [String: Data] = [:]
        for member in snapshot.members {
            if let photo = try? Data(contentsOf: CalendarShared.photo(member.email)) { photos[member.email] = photo }
        }
        let board = Board.build(snapshot, me: who.email)
        let minute: TimeInterval = 60
        let first = Date(timeIntervalSinceReferenceDate: (now.timeIntervalSinceReferenceDate / minute).rounded(.down) * minute + minute)
        var times = [now] + (0..<120).map { first.addingTimeInterval(Double($0) * minute) }
        // One of the member's events starting or ending off the minute changes what it says too.
        times += TodayWidgetModel(board: board, me: who.email, photos: [:], now: now).turns(until: times.last ?? now)
        times = Array(Set(times)).sorted()
        return times.map { TodayEntry(date: $0, model: TodayWidgetModel(board: board, me: who.email, photos: photos, now: $0)) }
    }

    private static func model(_ snapshot: CalendarSnapshot, me: String, at now: Date) -> TodayWidgetModel {
        TodayWidgetModel(snapshot: snapshot, me: me, photos: [:], now: now)
    }

    /// Read the calendar again with the family sign-in the apps share, so the
    /// widget keeps up when the app hasn't been opened. Given up on after a few
    /// seconds (iOS doesn't wait long), when the app's last copy will do.
    @MainActor
    private static func readCalendar() async {
        let session = Session.shared
        for _ in 0..<20 where !session.checked { try? await Task.sleep(for: .milliseconds(100)) }
        guard let user = session.userID, let who = CalendarShared.who, who.user == user else { return }
        let store = CalendarStore()
        store.open(for: user, email: who.email)
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await store.refresh() }
            group.addTask { try? await Task.sleep(for: .seconds(10)) }
            await group.next()
            group.cancelAll()
        }
    }
}
