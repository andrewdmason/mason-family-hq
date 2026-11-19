import SwiftUI

// Hiding an event from your own view: the long-press menu on an event, the
// note with Undo that follows, and the list in Settings that brings things
// back. Nobody else's calendar changes. The rules are in
// CalendarRules.hiddenByMember.

extension View {
    /// A long-press on an event offers to hide it; on one already hidden
    /// (shown because Settings asks for hidden events), to bring it back.
    func hideMenu(_ item: EventItem, cornerRadius: CGFloat = 7) -> some View {
        modifier(HideMenu(item: item, cornerRadius: cornerRadius))
    }
}

private struct HideMenu: ViewModifier {
    let item: EventItem
    let cornerRadius: CGFloat
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    func body(content: Content) -> some View {
        let board = store.board
        if item.hiddenByMe || board.canHide(item) {
            content
                .contentShape(.contextMenuPreview, .rect(cornerRadius: cornerRadius, style: .continuous))
                .contextMenu {
                    // Named, since a pin doesn't say what it is.
                    Section(item.title) {
                        if item.hiddenByMe {
                            let hides = CalendarRules.hides(covering: item.event, in: board.hides)
                            Button(hides.contains { $0.scope == .series } ? "Unhide All of These" : "Unhide", systemImage: "eye") {
                                unhide(hides)
                            }
                        } else if board.canHideSeries(item) {
                            Button("Hide All of These", systemImage: "eye.slash") { hide(series: true) }
                            Button("Hide Just This One", systemImage: "eye.slash") { hide(series: false) }
                        } else {
                            Button(CalendarRules.repeats(item.event) ? "Hide Just This One" : "Hide", systemImage: "eye.slash") {
                                hide(series: false)
                            }
                        }
                    }
                }
        } else {
            content
        }
    }

    private func hide(series: Bool) {
        let nav = nav
        if nav.peek?.id == item.id { nav.peek = nil }
        nav.justHidden = store.hide(item.event, series: series) { nav.problem = $0 }
    }

    private func unhide(_ hides: [EventHide]) {
        let nav = nav
        nav.justHidden = nil
        store.unhide(hides) { nav.problem = $0 }
    }
}

/// What was just hidden, with a way straight back.
struct HiddenBanner: View {
    let hide: EventHide
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    var body: some View {
        HStack(spacing: 10) {
            Label {
                Text(hide.scope == .series ? "Hid every “\(hide.title)”" : "Hid “\(hide.title)”")
                    .lineLimit(1)
            } icon: {
                Image(systemName: "eye.slash")
            }
            .font(.footnote.weight(.medium))
            Button("Undo") {
                let nav = nav
                nav.justHidden = nil
                store.unhide([hide]) { nav.problem = $0 }
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(CalendarStyle.accent)
        }
        .padding(.leading, 14)
        .padding(.trailing, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular.interactive(), in: .capsule)
    }
}

/// Settings › Hidden events: everything this member has hidden, each with a
/// way back. A hidden series is one row, however many days it's on.
struct HiddenEventsView: View {
    @Environment(CalendarStore.self) private var store
    @State private var problem: String?

    private static let months = Calendar.current.shortMonthSymbols
    private static let weekdays = Calendar.current.shortWeekdaySymbols

    var body: some View {
        let hides = store.hides
        Form {
            if hides.isEmpty {
                ContentUnavailableView {
                    Label("Nothing hidden", systemImage: "eye")
                } description: {
                    Text("Touch and hold an event to hide it from your view. It stays on everyone else's calendar.")
                }
                .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(hides) { hide in
                        HStack(spacing: 10) {
                            Avatar(member: store.board.member(hide.ownerEmail), size: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hide.title)
                                    .lineLimit(2)
                                Text(detail(hide))
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Button("Unhide") {
                                withAnimation { store.unhide([hide]) { problem = $0 } }
                            }
                            .buttonStyle(.borderless)
                            .font(.subheadline.weight(.semibold))
                        }
                    }
                } footer: {
                    Text(problem ?? "Only your view changes. A hidden repeating event still shows on a day you're going or driving.")
                        .foregroundStyle(problem == nil ? Color.secondary : Color.red)
                }
            }
        }
        .environment(\.editMode, .constant(.inactive))
        .navigationTitle("Hidden events")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// "Every one · Weekly on Mon, Wed", or "Wed, Nov 18".
    private func detail(_ hide: EventHide) -> String {
        switch hide.scope {
        case .series:
            return (["Every one"] + [hide.rrule.map(CalendarRules.repeatText)].compactMap { $0 }).joined(separator: " · ")
        case .event:
            guard let start = hide.start else { return "One event" }
            let day = Day(start)
            return "\(Self.weekdays[(day.weekdayIndex() + 1) % 7]), \(Self.months[day.month - 1]) \(day.day)"
        }
    }
}
