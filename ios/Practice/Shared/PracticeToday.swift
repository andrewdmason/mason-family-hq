import Foundation
import WidgetKit

/// Today's practice as the app last knew it, left in the app group for the home
/// screen widget. Compiled into both the app and the widget extension.
struct PracticeToday: Codable, Equatable {
    struct Run: Codable, Equatable {
        var startedAt: Date
        /// When the timer stops on its own. The total stops counting here.
        var endsBy: Date

        func elapsed(at now: Date) -> Int {
            max(0, Int(min(now, endsBy).timeIntervalSince(startedAt)))
        }
    }

    /// The practice day it describes.
    var date: String
    /// Seconds in the day's log, not counting a running timer's current run.
    var loggedSeconds: Int
    var run: Run?

    private static let key = "practice.today"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: "group.io.mason.practice") }

    static func load() -> PracticeToday? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(PracticeToday.self, from: data)
    }

    /// Save it and have the widget redraw.
    func publish() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        Self.defaults?.set(data, forKey: Self.key)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// One moment of the widget.
struct PracticeTodayEntry: TimelineEntry {
    let date: Date
    let seconds: Int
    let running: Bool
}

extension PracticeToday {
    /// iOS allows a widget a few dozen wake-ups a day, so it asks for one this
    /// often to pick up practice logged on the website.
    static let refreshEvery: TimeInterval = 30 * 60

    /// What the widget shows from now on. iOS plays the entries on its own, so
    /// a running timer's total climbs minute by minute with nothing awake, and
    /// the count goes back to zero at midnight.
    ///
    /// `saved` is what the phone knows, which can be ahead of the log (writes
    /// waiting for signal); `loggedOnServer` is what the log holds, which can be
    /// ahead of the phone (practice on the website). The larger of the two wins.
    static func timeline(saved: PracticeToday?, loggedOnServer: Int?, now: Date, timeZone: TimeZone = .current) -> Timeline<PracticeTodayEntry> {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!

        let mine = saved?.date == PracticeDay.today(now, timeZone: timeZone) ? saved : nil
        let logged = max(mine?.loggedSeconds ?? 0, loggedOnServer ?? 0)
        let run = mine?.run

        func entry(at date: Date) -> PracticeTodayEntry {
            PracticeTodayEntry(
                date: date,
                seconds: logged + (run?.elapsed(at: date) ?? 0),
                running: run.map { date < $0.endsBy } ?? false
            )
        }

        var entries = [entry(at: now)]
        if let run, now < run.endsBy {
            // A step each time the total reaches a new minute.
            var step = now.addingTimeInterval(Double(60 - entries[0].seconds % 60))
            while step < min(run.endsBy, midnight) {
                entries.append(entry(at: step))
                step.addTimeInterval(60)
            }
            if run.endsBy < midnight { entries.append(entry(at: run.endsBy)) }
        }
        entries.append(PracticeTodayEntry(date: midnight, seconds: 0, running: false))

        return Timeline(entries: entries, policy: .after(min(now.addingTimeInterval(refreshEvery), midnight)))
    }
}
