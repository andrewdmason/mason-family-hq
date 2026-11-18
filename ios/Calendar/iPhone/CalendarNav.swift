import Foundation
import Observation
import SwiftUI

enum ViewMode: String, CaseIterable, Identifiable {
    case day, schedule

    var id: String { rawValue }
    var title: String { self == .day ? "Day" : "Schedule" }
    var symbol: String { self == .day ? "rectangle.split.3x1" : "list.bullet" }
}

/// How the calendar looks on this phone. Kept on the phone, so one person
/// hiding a column changes nobody else's.
@MainActor
@Observable
final class Prefs {
    /// Members not shown, by email.
    var hidden: Set<String> { didSet { defaults.set(Array(hidden), forKey: "calendar.hidden") } }
    /// The order columns go in, by email; anyone not listed follows in family order.
    var order: [String] { didSet { defaults.set(order, forKey: "calendar.order") } }
    /// Other people's time as small blocks, not pin lines.
    var othersAsBlocks: Bool { didSet { defaults.set(othersAsBlocks, forKey: "calendar.othersAsBlocks") } }
    /// The view the app opens on.
    var opensOn: ViewMode { didSet { defaults.set(opensOn.rawValue, forKey: "calendar.opensOn") } }
    /// Show events that are hidden by default (declined, not going).
    var showHidden: Bool { didSet { defaults.set(showHidden, forKey: "calendar.showHidden") } }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        hidden = Set(defaults.stringArray(forKey: "calendar.hidden") ?? [])
        order = defaults.stringArray(forKey: "calendar.order") ?? []
        othersAsBlocks = defaults.bool(forKey: "calendar.othersAsBlocks")
        opensOn = ViewMode(rawValue: defaults.string(forKey: "calendar.opensOn") ?? "") ?? .day
        showHidden = defaults.bool(forKey: "calendar.showHidden")
    }

    /// Everyone, in this phone's order.
    func ordered(_ members: [Member]) -> [Member] {
        let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        return members.enumerated().sorted { a, b in
            let (ra, rb) = (rank[a.element.email] ?? 1000 + a.offset, rank[b.element.email] ?? 1000 + b.offset)
            return ra < rb
        }
        .map(\.element)
    }

    /// The members with a column.
    func shown(_ members: [Member]) -> [Member] {
        ordered(members).filter { !hidden.contains($0.email) }
    }
}

/// A new event being placed on the Day grid by a long-press.
struct GridDraft: Equatable {
    var day: Day
    var member: String
    /// Minutes after midnight.
    var start: Int
}

/// The event form, for a new event or an existing one.
struct EditorRequest: Identifiable {
    let id = UUID()
    var event: CalEvent?
    var draft: EventDraft
}

/// Where the app is: the day in view, which view, and what's open over it.
@MainActor
@Observable
final class CalendarNav {
    var day: Day
    var view: ViewMode
    /// The month grid is dropped open under the title.
    var monthOpen = false
    /// The event sheet.
    var opened: EventItem?
    /// The peek card raised by tapping a pin.
    var peek: EventItem?
    var editor: EditorRequest?
    var gridDraft: GridDraft?
    var showSettings = false
    /// A change that didn't go through, to say so.
    var problem: String?
    /// How far the top bar reaches down the screen, and the bottom bar up it,
    /// so content can scroll under both and still start and end clear of them.
    var topInset: CGFloat = 150
    var bottomInset: CGFloat = 90
    /// How far the Day grid is scrolled, shared by every day so paging
    /// between days keeps the time of day in view.
    var gridScroll: CGFloat

    init(view: ViewMode) {
        self.view = view
        day = .today()
        // Open a little before now, and no earlier than the small hours.
        let minutes = CalendarRules.minutes(Date())
        gridScroll = max(0, CGFloat(minutes) / 60 - 1.5) * CalendarStyle.hourHeight
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--view"), args.count > at + 1, let asked = ViewMode(rawValue: args[at + 1]) {
            self.view = asked
        }
    }

    /// The days the app can show: the window the local copy holds.
    static var days: [Day] {
        let today = Day.today()
        return (-60...180).map { today.adding(days: $0) }
    }

    func goToToday() {
        withAnimation(.snappy) {
            day = .today()
            monthOpen = false
        }
    }

    func open(_ item: EventItem, in board: Board) {
        peek = nil
        opened = board.opened(item)
    }
}
