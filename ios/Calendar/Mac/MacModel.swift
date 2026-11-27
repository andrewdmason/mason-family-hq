import Foundation
import MasonKit
import Observation
import SwiftUI

/// The window's two views.
enum WindowView: String, CaseIterable, Identifiable {
    case week, day

    var id: String { rawValue }
    var title: String { self == .week ? "Week" : "Day" }
}

/// How the calendar looks on this Mac: who shows and in what order, as on
/// the phone, kept here so it changes nobody else's.
@MainActor
@Observable
final class Prefs {
    /// Members not shown, by email.
    var hidden: Set<String> { didSet { defaults.set(Array(hidden), forKey: "calendar.hidden") } }
    /// The order people go in, by email; anyone not listed follows in family order.
    var order: [String] { didSet { defaults.set(order, forKey: "calendar.order") } }
    /// Show events that are hidden by default (declined, not going, or
    /// hidden by this member).
    var showHidden: Bool { didSet { defaults.set(showHidden, forKey: "calendar.showHidden") } }
    /// The view the window was last on.
    var view: WindowView { didSet { defaults.set(view.rawValue, forKey: "calendar.windowView") } }
    /// The applet lists the day as stops and the time between (an
    /// experiment, on unless switched off from the applet's gear).
    var gaps: Bool { didSet { defaults.set(gaps, forKey: "calendar.appletGaps") } }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = CalendarShared.defaults) {
        self.defaults = defaults
        hidden = Set(defaults.stringArray(forKey: "calendar.hidden") ?? [])
        order = defaults.stringArray(forKey: "calendar.order") ?? []
        showHidden = defaults.bool(forKey: "calendar.showHidden")
        view = WindowView(rawValue: defaults.string(forKey: "calendar.windowView") ?? "") ?? .week
        gaps = defaults.object(forKey: "calendar.appletGaps") as? Bool ?? true
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--view"), args.count > at + 1, let asked = WindowView(rawValue: args[at + 1]) {
            view = asked
        }
    }

    /// Everyone, in this Mac's order.
    func ordered(_ members: [Member]) -> [Member] {
        CalendarShared.shown(members, order: order, hidden: [])
    }

    /// The members who show.
    func shown(_ members: [Member]) -> [Member] {
        CalendarShared.shown(members, order: order, hidden: hidden)
    }

    /// The members who show beside the signed-in one: everyone shown but them.
    func others(_ members: [Member], me: String?) -> [Member] {
        shown(members).filter { $0.email != me }
    }
}

/// The event card: an event opened, or a new one being made.
struct CardRequest: Identifiable, Equatable {
    let id = UUID()
    /// The event; nil for a new one.
    var itemID: UUID?
    /// The event as the card opens on it.
    var draft: CardDraft

    static func == (a: CardRequest, b: CardRequest) -> Bool { a.id == b.id }
}

/// A block being dragged on the window's grid: a new event being drawn, or
/// one being moved or having its end pulled.
struct GridDrag: Equatable {
    enum Kind: Equatable {
        case create
        case move(UUID)
        case resize(UUID)
    }

    var kind: Kind
    var day: Day
    /// Minutes after the day's midnight.
    var start: Int
    var end: Int

    var event: UUID? {
        switch kind {
        case .create: nil
        case .move(let id), .resize(let id): id
        }
    }
}

/// A change to a repeating event made by dragging, waiting on "this one or
/// all of them".
struct PendingSave: Identifiable {
    let id = UUID()
    var save: CardSave
}

/// What the pointer is over on the grid: someone else's event, to say what it is.
struct Peek: Equatable {
    var item: EventItem
    /// Where the line is, in the grid's space.
    var x: CGFloat
    var y: CGFloat
}

/// Where the window is: the day in view, and what's open over it.
@MainActor
@Observable
final class WindowState {
    var day = Day.today()
    var card: CardRequest?
    /// Which drawing of the event the card hangs off: one event can be a card
    /// in one column and a line in another.
    var cardAnchor = ""
    /// A new event's block, while its card is open.
    var ghost: GridDrag?
    var drag: GridDrag?
    var peek: Peek?
    var pending: PendingSave?
    var monthOpen = false
    var problem: String?
    /// An hour for the grid to scroll into view: a new event made from the
    /// menu, which may be out of sight.
    var reveal: Int?

    func open(_ item: EventItem, anchor: String, in store: CalendarStore) {
        peek = nil
        ghost = nil
        let opened = store.board.opened(item)
        cardAnchor = anchor
        card = CardRequest(itemID: opened.id, draft: store.cardDraft(for: opened))
    }

    /// A new event on `member`'s calendar, its card hanging off a block
    /// drawn where it will go.
    func compose(for member: String, on day: Day, from start: Int, to end: Int, reveal: Bool = false, in store: CalendarStore) {
        peek = nil
        if reveal { self.reveal = start / 60 }
        let calendar = store.board.calendar(on: day)
        ghost = GridDrag(kind: .create, day: day, start: start, end: end)
        cardAnchor = "new"
        card = CardRequest(itemID: nil, draft: CardDraft(event: EventDraft(
            memberEmail: member, start: day.at(minutes: start, in: calendar), end: day.at(minutes: end, in: calendar)
        )))
    }

    func closeCard() {
        card = nil
        ghost = nil
    }

    func report(_ problem: String) {
        self.problem = problem
        Task {
            try? await Task.sleep(for: .seconds(5))
            if self.problem == problem { self.problem = nil }
        }
    }
}

/// The menubar applet: the line being typed, the day chosen, the card open
/// beside it.
@MainActor
@Observable
final class AppletState {
    var line = ""
    /// The day picked from the strip; nil is today, moving on to tomorrow
    /// once today is over.
    var chosen: Day?
    /// The week (or month) the strip shows, by any day in it.
    var shownWeek = Day.today()
    var monthOpen = false
    var card: CardRequest?
    /// The open card has changes that closing would lose.
    var cardDirty = false
    var problem: String?
    /// Goes up each time the applet opens, so the line takes the cursor.
    var opened = 0
    /// Goes up when Escape is pressed with a card open, for the card to hear.
    var escapes = 0
    /// Goes up when the applet is being put away with changes in its card.
    var leaves = 0

    /// Back to how it opens: today, nothing typed, no card.
    func reset() {
        line = ""
        chosen = nil
        shownWeek = .today()
        monthOpen = false
        card = nil
        cardDirty = false
    }

    /// The day before or after the one the strip has picked.
    func step(_ days: Int) {
        pick((chosen ?? .today()).adding(days: days))
    }

    /// Show a day, the strip moving to its week.
    func pick(_ day: Day) {
        chosen = day == .today() ? nil : day
        shownWeek = day
    }

    func report(_ problem: String) {
        self.problem = problem
        Task {
            try? await Task.sleep(for: .seconds(5))
            if self.problem == problem { self.problem = nil }
        }
    }
}

/// Everything the window and the applet share: one calendar, one sign-in,
/// so a change made in one shows in the other at once.
@MainActor
@Observable
final class AppModel {
    let store: CalendarStore
    let prefs = Prefs()
    let session = Session.shared
    let window = WindowState()
    let applet = AppletState()

    /// What the app delegate does for the views.
    @ObservationIgnored var showWindow: () -> Void = {}
    @ObservationIgnored var showSettings: () -> Void = {}
    @ObservationIgnored var hideApplet: () -> Void = {}
    /// Put the applet away, unless its card has changes to ask about first.
    @ObservationIgnored var dismissApplet: () -> Void = {}
    @ObservationIgnored var quitCompletely: () -> Void = {}
    /// ⌃⌥Space couldn't be taken: another app has it.
    var shortcutTaken = false

    @ObservationIgnored private var lastUser: UUID?
    @ObservationIgnored private var lastSync = Date.distantPast
    @ObservationIgnored private var timer: Timer?

    init() {
        store = CalendarStore.isDemoLaunch ? CalendarStore(demo: DemoCalendar.make()) : CalendarStore()
    }

    /// Whose Mac it is, by email.
    var me: String? { store.isDemo ? DemoCalendar.me : session.email?.lowercased() }

    /// Signed in as one of the family (or the demo): there's a calendar to show.
    var ready: Bool { store.isDemo || (session.isSignedIn && session.role != nil) }

    func start() {
        guard !store.isDemo else { return }
        followSession()
        // The menubar item is up all day: keep what it shows fresh.
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.store.refresh() }
        }
    }

    private func followSession() {
        // Only the sign-in is watched; what follows from it happens outside.
        let (user, email) = withObservationTracking {
            (session.userID, session.email)
        } onChange: { [weak self] in
            Task { @MainActor in self?.followSession() }
        }
        sessionChanged(user: user, email: email)
    }

    private func sessionChanged(user: UUID?, email: String?) {
        guard user != lastUser else { return }
        // Another member signing in starts from nothing of the last one's.
        if lastUser != nil { store.forget() }
        lastUser = user
        if let user {
            store.open(for: user, email: email)
            Task { await sync(force: true) }
        }
    }

    /// Have the website pull from Google and the rest, then read again; at
    /// most once a minute unless asked.
    func sync(force: Bool = false) async {
        guard !store.isDemo, session.isSignedIn else { return }
        guard force || Date().timeIntervalSince(lastSync) > 60 else { return }
        lastSync = Date()
        await store.sync()
    }
}
