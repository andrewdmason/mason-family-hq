import Foundation
import Observation
import SwiftUI
import WidgetKit

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
    /// Show events that are hidden by default (declined, not going, or
    /// hidden by this member).
    var showHidden: Bool { didSet { defaults.set(showHidden, forKey: "calendar.showHidden") } }
    /// Schedule and the widget list a day as the member's own events and the
    /// time between them (see `Rundown`), not every event in a row. An
    /// experiment, on unless switched off.
    var timeBetween: Bool {
        didSet {
            defaults.set(timeBetween, forKey: CalendarShared.timeBetweenKey)
            // The widget lists the day the same way.
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private let defaults: UserDefaults

    /// In the app group's defaults, so the widget shows the same people.
    init(defaults: UserDefaults = CalendarShared.defaults) {
        self.defaults = defaults
        hidden = Set(defaults.stringArray(forKey: "calendar.hidden") ?? [])
        order = defaults.stringArray(forKey: "calendar.order") ?? []
        othersAsBlocks = defaults.bool(forKey: "calendar.othersAsBlocks")
        opensOn = ViewMode(rawValue: defaults.string(forKey: "calendar.opensOn") ?? "") ?? .day
        showHidden = defaults.bool(forKey: "calendar.showHidden")
        timeBetween = CalendarShared.timeBetween(in: defaults)
    }

    /// Everyone, in this phone's order.
    func ordered(_ members: [Member]) -> [Member] {
        CalendarShared.shown(members, order: order, hidden: [])
    }

    /// The members with a column.
    func shown(_ members: [Member]) -> [Member] {
        CalendarShared.shown(members, order: order, hidden: hidden)
    }
}

/// A new event being placed on the Day grid by a long-press.
struct GridDraft: Equatable {
    var day: Day
    var member: String
    /// Minutes after midnight.
    var start: Int
}

/// The event card: an event opened, or a new one being made.
struct CardRequest: Identifiable {
    let id = UUID()
    /// The event; nil for a new one.
    var itemID: UUID?
    /// The event as the card opens on it.
    var draft: CardDraft
}

/// Where the app is: the day in view, which view, and what's open over it.
@MainActor
@Observable
final class CalendarNav {
    var day: Day
    var view: ViewMode
    /// The month grid is dropped open under the title.
    var monthOpen = false
    /// The event card.
    var card: CardRequest?
    /// The peek card raised by tapping a pin.
    var peek: EventItem?
    var gridDraft: GridDraft?
    var showSettings = false
    /// A change that didn't go through, to say so.
    var problem: String?
    /// What a long-press just hid, while its Undo is on offer.
    var justHidden: EventHide?
    /// How far the top bar reaches down the screen, and the bottom bar up it,
    /// so content can scroll under both and still start and end clear of them.
    var topInset: CGFloat = 150
    var bottomInset: CGFloat = 90
    /// How tall the screen is, for the event card to fit itself to.
    var screenHeight: CGFloat = 800
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

    /// A scroll view bound to the day (the week strip, the Day pager) landing
    /// on a new one. Set from inside one scroll view's position update, the
    /// day moves that scroll view only: the other, bound to the same day,
    /// stays where it was, so a week swiped in the strip left the grid on the
    /// old day. Set a moment later, as its own change, both follow it.
    func scrolled(to new: Day) {
        Task { @MainActor in
            if day != new { day = new }
        }
    }

    func goToToday() {
        withAnimation(.snappy) {
            day = .today()
            monthOpen = false
        }
    }

    func open(_ item: EventItem, in store: CalendarStore) {
        peek = nil
        let opened = store.board.opened(item)
        card = CardRequest(itemID: opened.id, draft: store.cardDraft(for: opened))
    }

    /// A new event, on `member`'s calendar until the card says otherwise.
    func compose(for member: String, from start: Date, to end: Date) {
        peek = nil
        card = CardRequest(itemID: nil, draft: CardDraft(event: EventDraft(memberEmail: member, start: start, end: end)))
    }
}
