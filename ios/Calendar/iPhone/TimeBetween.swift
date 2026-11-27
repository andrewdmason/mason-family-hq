import SwiftUI

/// A day of the Schedule as the member's own stops and the time between them
/// (`Rundown`, first tried in the Mac's menubar applet; Settings switches it
/// off). Only what's theirs is a row with its times down the left. The time
/// between is one grey line, a clock and its length and who in the family has
/// what on in it, that a tap opens into those events. Today says where the
/// member is: how far through a stop and how long is left, or how long
/// they're free; what's been folds into one line.
struct RundownRows: View {
    let day: Day
    let me: String?
    let now: Date
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(Prefs.self) private var prefs
    @State private var showEarlier = false
    /// The grey lines that have been opened, by the part they're in.
    @State private var opened: Set<String> = []

    /// The colour of where the member is now: the calendar's olive, not the
    /// now line's red, which in a list reads as a warning.
    static let live = CalendarStyle.accent
    /// The Schedule row's time column and bar, which these lines sit under.
    static let timeColumn: CGFloat = 58
    static let gap: CGFloat = 10

    var body: some View {
        let agenda = Agenda.day(
            day, board: store.board, me: me, shown: prefs.shown(store.board.members), showHidden: prefs.showHidden, now: now
        )
        let rundown = Rundown.build(agenda, board: store.board, me: me, now: now)
        let anyStops = rundown.parts.contains { $0.kind == .stop }
        let live = rundown.parts.contains { $0.phase == .now }
        let earlier = live ? rundown.parts.filter { $0.phase == .over } : []
        let count = earlier.reduce(0) { $0 + ($1.kind == .stop ? 1 : 0) + $1.others.count }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(agenda.allDay) { row in
                ScheduleRow(item: row.item, isPast: false)
            }
            if rundown.isEmpty, agenda.allDay.isEmpty {
                Text("Nothing on today.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 8)
            }
            if count > 0 {
                Button {
                    withAnimation(.snappy(duration: 0.2)) { showEarlier.toggle() }
                } label: {
                    line(icon: "chevron.right", turned: showEarlier) {
                        Text("Earlier · \(count) \(count == 1 ? "event" : "events")")
                            .font(.system(.caption, design: .rounded).weight(.medium))
                    }
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 6)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint(showEarlier ? "Hides what's been today" : "Shows what's been today")
                if showEarlier {
                    ForEach(earlier) { part($0, anyStops: anyStops) }
                }
            }
            ForEach(rundown.parts.filter { !live || $0.phase != .over }) { part($0, anyStops: anyStops) }
        }
    }

    /// A line under the rows' own columns: nothing where the times go, a small
    /// mark where the bar goes, then the words.
    private func line(icon: String?, turned: Bool = false, @ViewBuilder words: () -> some View) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Self.gap) {
            Color.clear.frame(width: Self.timeColumn, height: 1)
            Group {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: icon == "clock" ? 11 : 8.5, weight: icon == "clock" ? .medium : .bold))
                        .rotationEffect(.degrees(turned ? 90 : 0))
                } else {
                    Color.clear.frame(height: 1)
                }
            }
            .frame(width: 4)
            words()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
    }

    @ViewBuilder
    private func part(_ part: Rundown.Part, anyStops: Bool) -> some View {
        let isNow = part.phase == .now
        switch part.kind {
        case .stop:
            if let row = part.row {
                VStack(spacing: 0) {
                    if part.leg != nil {
                        LegRow(part: part)
                    } else {
                        ScheduleRow(item: row.item, isPast: part.phase == .over && day == Day(now))
                    }
                    if isNow, let start = part.start, let end = part.end {
                        line(icon: nil) {
                            let whole = max(end.timeIntervalSince(start), 1)
                            ProgressView(value: min(max(now.timeIntervalSince(start) / whole, 0), 1))
                                .tint(Self.live)
                            Text("\(Rundown.length(end.timeIntervalSince(now))) left")
                                .font(.system(.caption, design: .rounded).weight(.semibold))
                                .foregroundStyle(Self.live)
                                .fixedSize()
                        }
                        .padding(.bottom, 10)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(Rundown.length(end.timeIntervalSince(now))) left")
                    }
                }
                .background { if isNow { nowGround } }
                // The family's, wholly inside it.
                if !part.others.isEmpty {
                    aside(id: part.id, lead: nil, clock: false, others: part.others, isNow: false, dim: part.phase == .over)
                }
            }
        case .gap:
            let lead: String? = if isNow {
                part.end.map { "\(Rundown.length($0.timeIntervalSince(now))) free" }
                    ?? (anyStops ? "Done for today" : "Nothing of yours today")
            } else if let length = part.length {
                Rundown.length(length)
            } else if part.start == nil, part.end == nil {
                nil
            } else {
                part.start == nil ? "Before" : "Later"
            }
            if lead != nil || !part.others.isEmpty {
                aside(
                    id: part.id, lead: lead, clock: part.end != nil && (isNow || part.length != nil), others: part.others,
                    isNow: isNow, dim: part.phase == .over, alwaysOpen: !anyStops
                )
            }
        }
    }

    /// A grey line of the family's events, "(J: Surfing, S+O: School)" after
    /// whatever leads it. A tap opens it into the events themselves, each a
    /// line of its own; another closes it.
    private func aside(
        id: String, lead: String?, clock: Bool, others: [Agenda.Row], isNow: Bool, dim: Bool, alwaysOpen: Bool = false
    ) -> some View {
        let isOpen = !others.isEmpty && (opened.contains(id) || alwaysOpen)
        let head = Text(lead ?? "")
            .font(isNow ? .subheadline.weight(.semibold) : .system(.caption, design: .rounded).weight(.medium))
            .foregroundStyle(isNow ? AnyShapeStyle(Self.live) : AnyShapeStyle(.secondary))
        let tail = Text(isOpen || others.isEmpty ? "" : "\(lead == nil ? "" : "  ")(\(summary(others)))")
            .font(.caption)
            .foregroundStyle(.tertiary)
        return VStack(alignment: .leading, spacing: 0) {
            if lead != nil || !isOpen {
                Button {
                    withAnimation(.snappy(duration: 0.2)) {
                        if opened.contains(id) { opened.remove(id) } else { opened.insert(id) }
                    }
                } label: {
                    line(icon: clock ? "clock" : nil) {
                        Text("\(head)\(tail)").lineLimit(1)
                    }
                    .foregroundStyle(isNow ? AnyShapeStyle(Self.live) : AnyShapeStyle(.tertiary))
                    .padding(.vertical, isNow ? 10 : 6)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .allowsHitTesting(!others.isEmpty && !alwaysOpen)
                .accessibilityLabel(([lead].compactMap { $0 } + others.map { spoken($0) }).joined(separator: ", "))
                .accessibilityHint(others.isEmpty ? "" : isOpen ? "Hides these events" : "Shows these events")
            }
            if isOpen {
                ForEach(others) { FamilyLine(row: $0) }
            }
        }
        .padding(.bottom, isNow && isOpen ? 4 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { if isNow { nowGround } }
        .opacity(dim ? 0.75 : 1)
    }

    /// Behind where the member is now.
    private var nowGround: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Self.live.opacity(0.1))
            .padding(.horizontal, 8)
    }

    /// "J: Surfing, S+O: School": whose, by first letter, and what.
    private func summary(_ rows: [Agenda.Row]) -> String {
        rows.map { row in
            let who = row.people.compactMap { store.board.member($0)?.initial }.joined(separator: "+")
            return who.isEmpty ? row.item.event.title : "\(who): \(row.item.event.title)"
        }
        .joined(separator: ", ")
    }

    private func spoken(_ row: Agenda.Row) -> String {
        let who = row.people.compactMap { store.board.member($0)?.firstName }.joined(separator: " and ")
        return who.isEmpty ? row.item.title : "\(who): \(row.item.title)"
    }
}

/// Someone else's event, opened out of a grey line: its words in that
/// person's colour with its time in brackets, and whose it is.
private struct FamilyLine: View {
    let row: Agenda.Row
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    var body: some View {
        let item = row.item
        let title = Text(item.title)
            .foregroundStyle(row.over ? AnyShapeStyle(.tertiary) : AnyShapeStyle(CalendarStyle.ink(item.color)))
        let time = Text("  (\(CalendarRules.shortClock(item.event.start, in: item.calendar())))")
            .font(.system(.caption2, design: .rounded))
            .foregroundStyle(.tertiary)
        Button {
            nav.open(item, in: store)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: RundownRows.gap) {
                Color.clear.frame(width: RundownRows.timeColumn, height: 1)
                Color.clear.frame(width: 4, height: 1)
                Text("\(title)\(time)")
                    .font(.footnote)
                    .lineLimit(1)
                Spacer(minLength: 4)
                HStack(spacing: -5) {
                    ForEach(row.people.prefix(3), id: \.self) { email in
                        Avatar(member: store.board.member(email), size: 18)
                            .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1.5))
                    }
                }
                .opacity(row.over ? 0.55 : 1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .opacity(item.hidden ? 0.5 : 1)
        .hideMenu(item, cornerRadius: 10)
    }
}

/// A drive that's the member's own, for an event that isn't: when to leave
/// down the left, who's being driven, and what the drive says of itself. The
/// event it's for is in the time between, on the next line.
private struct LegRow: View {
    let part: Rundown.Part
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    var body: some View {
        if let row = part.row, let leg = part.leg {
            let item = row.item
            let clock = item.calendar()
            Button {
                nav.open(item, in: store)
            } label: {
                HStack(alignment: .top, spacing: RundownRows.gap) {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(CalendarRules.shortClock(leg.start, in: clock)).foregroundStyle(.primary)
                        Text(CalendarRules.shortClock(leg.end, in: clock))
                    }
                    .font(.system(.caption, design: .rounded).weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(width: RundownRows.timeColumn, alignment: .trailing)
                    .padding(.top, 2)

                    RoundedRectangle(cornerRadius: 2)
                        .fill(CalendarStyle.muted(item.color))
                        .frame(width: 4)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Image(systemName: "car.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(leg.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                        }
                        Text(leg.note ?? item.title)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    HStack(spacing: -6) {
                        ForEach(row.people.prefix(3), id: \.self) { email in
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
            .opacity(part.phase == .over ? 0.55 : 1)
            .hideMenu(item, cornerRadius: 12)
        }
    }
}
