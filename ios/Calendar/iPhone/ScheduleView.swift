import SwiftUI

/// The Schedule view: the calendar as one continuous list, day after day.
/// Days with nothing on are skipped, except today. A day is the member's own
/// events and the time between them (`RundownRows`) unless Settings says to
/// list every event. Scrolling moves the day up
/// top; choosing a day up top scrolls here.
struct ScheduleView: View {
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(Prefs.self) private var prefs
    @State private var position = ScrollPosition(idType: Day.self)

    /// Open on a day. The list is lazy, so where a day sits is a guess until
    /// the rows near it are laid out: go there, then again once they are.
    private func land(_ day: Day?) {
        guard let day else { return }
        position.scrollTo(id: day, anchor: .top)
        Task {
            try? await Task.sleep(for: .milliseconds(60))
            position.scrollTo(id: day, anchor: .top)
        }
    }

    var body: some View {
        let shown = Set(prefs.shown(store.board.members).map(\.email))
        let today = Day.today()
        let days = CalendarNav.days.compactMap { day -> (Day, [EventItem])? in
            let items = store.board.events(on: day, showHidden: prefs.showHidden)
                .filter { !$0.event.isDrive && (shown.contains($0.event.memberEmail) || !shown.isDisjoint(with: $0.attendees)) }
                .sorted { a, b in
                    // All-day first, then by start.
                    if a.event.allDay != b.event.allDay { return a.event.allDay }
                    return a.event.start < b.event.start
                }
            return items.isEmpty && day != today ? nil : (day, items)
        }
        // The section for a day: the day itself, or the next one with
        // something on.
        let section: (Day) -> Day? = { day in days.first { $0.0 >= day }?.0 ?? days.last?.0 }
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(days, id: \.0) { day, items in
                    DaySection(day: day, items: items, me: me)
                        .id(day)
                }
            }
            .scrollTargetLayout()
            .padding(.bottom, 24)
        }
        // The bars float over the list; these keep it starting and ending
        // clear of them, and a day scrolled to lands just under the top bar.
        .safeAreaInset(edge: .top, spacing: 0) { Color.clear.frame(height: nav.topInset + 4) }
        .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: nav.bottomInset) }
        .scrollPosition($position, anchor: .top)
        .onAppear { land(section(nav.day)) }
        .onChange(of: position.viewID(type: Day.self)) { _, top in
            // Scrolling the list moves the day up top.
            if let top, top != section(nav.day) { nav.day = top }
        }
        .onChange(of: nav.day) { _, day in
            // Choosing a day up top scrolls the list there.
            if let target = section(day), target != position.viewID(type: Day.self) {
                withAnimation(.snappy) { position.scrollTo(id: target, anchor: .top) }
            }
        }
        .scrollIndicators(.hidden)
        .refreshable { await store.sync() }
        .onTapGesture { nav.peek = nil }
    }
}

private struct DaySection: View {
    let day: Day
    let items: [EventItem]
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(Prefs.self) private var prefs

    private static let weekdays = Calendar.current.weekdaySymbols
    private static let months = Calendar.current.shortMonthSymbols

    var body: some View {
        let today = Day.today()
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title(today))
                    .font(.system(.headline, design: .serif))
                    .foregroundStyle(day == today ? CalendarStyle.accent : .primary)
                Text("\(Self.months[day.month - 1]) \(day.day)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                // A day away: its times are the trip's, not the phone's.
                if let note = store.board.zoneNote(on: day) {
                    Spacer(minLength: 0)
                    Text(note)
                        .font(.system(.caption, design: .rounded).weight(.semibold))
                        .foregroundStyle(CalendarStyle.accent)
                        .lineLimit(1)
                        .accessibilityLabel("Times shown in \(note)")
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 6)

            if prefs.timeBetween {
                // The member's own events and the time between them. Today's
                // keeps up with the minute.
                if day == today {
                    TimelineView(.everyMinute) { time in
                        RundownRows(day: day, me: me, now: DemoCalendar.now(time.date))
                    }
                } else {
                    RundownRows(day: day, me: me, now: DemoCalendar.now())
                }
            } else {
                if items.isEmpty {
                    Text("Nothing on today.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 8)
                }
                ForEach(items) { item in
                    ScheduleRow(item: item, isPast: day == today && isOver(item))
                }
            }
        }
        .opacity(day < today ? 0.6 : 1)
    }

    private func title(_ today: Day) -> String {
        switch today.days(to: day) {
        case 0: "Today"
        case 1: "Tomorrow"
        case -1: "Yesterday"
        default: Self.weekdays[(day.weekdayIndex() + 1) % 7]
        }
    }

    private func isOver(_ item: EventItem) -> Bool {
        !item.event.allDay && (item.event.end ?? item.event.start) < Date()
    }
}

/// One event in the Schedule: its times down the left, a bar of whose it is,
/// its words, and who's in it.
struct ScheduleRow: View {
    let item: EventItem
    let isPast: Bool
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    var body: some View {
        Button {
            nav.open(item, in: store)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .trailing, spacing: 1) {
                    if item.event.allDay {
                        Text("All day")
                    } else {
                        Text(CalendarRules.shortClock(item.event.start, in: item.calendar()))
                            .foregroundStyle(.primary)
                        if let end = item.event.end { Text(CalendarRules.shortClock(end, in: item.calendar())) }
                    }
                }
                .font(.system(.caption, design: .rounded).weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 58, alignment: .trailing)
                .padding(.top, 2)

                RoundedRectangle(cornerRadius: 2)
                    .fill(CalendarStyle.muted(item.color))
                    .frame(width: 4)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(item.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .strikethrough(item.hidden && !item.hiddenByMe)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        if item.conflict { ConflictMark() }
                    }
                    if let place = CalendarRules.whereLine(item.event) {
                        Text(place.text)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    if item.duties != nil {
                        DutyGlyphs(item: item)
                            .padding(.top, 1)
                    }
                }
                Spacer(minLength: 4)
                HStack(spacing: -6) {
                    ForEach([item.event.memberEmail] + item.attendees.prefix(3), id: \.self) { email in
                        Avatar(member: store.board.member(email), size: 22)
                            .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1.5))
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .opacity(item.hidden ? 0.5 : isPast ? 0.55 : 1)
        .hideMenu(item, cornerRadius: 12)
    }
}
