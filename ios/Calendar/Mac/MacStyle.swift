import SwiftUI

/// The Mac's look, on top of the phone's (CalendarStyle): the same warm paper
/// and softened member colours for the calendar itself, with Liquid Glass for
/// what floats over it: the applet, the event card, the peek, the toolbar.
enum MacStyle {
    // The window's grid.
    static let hourHeight: CGFloat = 50
    static let gutter: CGFloat = 54
    /// One family member's lane of thin lines at the edge of a Week day.
    static let lane: CGFloat = 8
    /// One family member's column of pins in Day.
    static let pinColumn: CGFloat = 36

    /// "8:20am", "3pm": a time small enough to sit in a list.
    static func compactClock(_ date: Date, in calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        let h = c.hour ?? 0
        let hour = h % 12 == 0 ? 12 : h % 12
        let half = h < 12 ? "am" : "pm"
        return (c.minute ?? 0) == 0 ? "\(hour)\(half)" : String(format: "%d:%02d%@", hour, c.minute ?? 0, half)
    }

    /// "Thu, Nov 26".
    static func shortDate(_ day: Day) -> String {
        day.at(minutes: 12 * 60).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    /// "November 2026".
    static func monthTitle(_ day: Day) -> String {
        day.at(minutes: 12 * 60).formatted(.dateTime.month(.wide).year())
    }

    /// "Today", "Tomorrow", "Yesterday", else the weekday.
    static func dayName(_ day: Day, today: Day = .today()) -> String {
        switch today.days(to: day) {
        case 0: "Today"
        case 1: "Tomorrow"
        case -1: "Yesterday"
        default: day.at(minutes: 12 * 60).formatted(.dateTime.weekday(.wide))
        }
    }
}

extension View {
    /// Glass with the page's paper in it: clear enough to feel what's behind,
    /// solid enough that the words on it read over anything.
    func paperGlass(_ cornerRadius: CGFloat = 22) -> some View {
        glassEffect(.regular.tint(CalendarStyle.ground.opacity(0.72)), in: .rect(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// A row of faces, overlapping a little, each ringed in what's behind it.
struct Faces: View {
    let emails: [String]
    var size: CGFloat = 18
    var limit = 4
    var ring = CalendarStyle.ground
    @Environment(CalendarStore.self) private var store

    var body: some View {
        if !emails.isEmpty {
            HStack(spacing: -size * 0.28) {
                ForEach(emails.prefix(limit), id: \.self) { email in
                    Avatar(member: store.board.member(email), size: size)
                        .overlay(Circle().strokeBorder(ring, lineWidth: 1.5))
                }
            }
        }
    }
}

/// A round glass button with one symbol: the card's ✕ and ✓.
struct GlassCircleButton: View {
    let symbol: String
    var tint: Color?
    var label: String
    var size: CGFloat = 30
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .semibold))
                .frame(width: size, height: size)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(tint.map { .regular.tint($0).interactive() } ?? .regular.interactive(), in: .circle)
        .help(label)
        .accessibilityLabel(label)
    }
}

/// A change that didn't go through.
struct ProblemBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle.fill")
            .font(.callout.weight(.medium))
            .lineLimit(3)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.14), in: .rect(cornerRadius: 10, style: .continuous))
    }
}

/// Google won't let an event it made from an email be changed: the offer to
/// swap it for a copy that can be.
struct ConvertBanner: View {
    let conversion: Conversion
    let report: (String) -> Void
    @Environment(CalendarStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Make “\(conversion.event.title)” an editable event?")
                .font(.callout.weight(.semibold))
            Text("Google created this from an email, so it can't be changed. Replace it with a copy you can edit?")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Cancel") { store.conversion = nil }
                Button("Replace") {
                    store.conversion = nil
                    store.convert(conversion, report: report)
                }
                .buttonStyle(.borderedProminent)
                .tint(CalendarStyle.olive)
            }
        }
        .padding(12)
        .background(CalendarStyle.card, in: .rect(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(CalendarStyle.line))
    }
}

/// Hide from this member's own view, from a right-click.
struct HideMenu: View {
    let item: EventItem
    let report: (String) -> Void
    @Environment(CalendarStore.self) private var store

    var body: some View {
        if store.board.canHide(item) {
            if store.board.canHideSeries(item) {
                Button("Hide This Event", systemImage: "eye.slash") { store.hide(item.event, series: false, report: report) }
                Button("Hide Every Occurrence", systemImage: "eye.slash") { store.hide(item.event, series: true, report: report) }
            } else {
                Button("Hide from My Calendar", systemImage: "eye.slash") { store.hide(item.event, series: false, report: report) }
            }
        }
    }
}

/// The week or the month as a grid of days to pick from: the applet's strip
/// and the window's month popover.
struct DayPicker: View {
    /// Any day in the week (or month) to show.
    let anchor: Day
    let selected: Day
    /// Six weeks, not one.
    let wholeMonth: Bool
    var cell: CGFloat = 30
    let pick: (Day) -> Void

    private static let letters = ["M", "T", "W", "T", "F", "S", "S"]

    var body: some View {
        let today = Day.today()
        let weeks = wholeMonth ? anchor.monthGrid() : [(0..<7).map { anchor.weekStart().adding(days: $0) }]
        VStack(spacing: 2) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { n in
                    Text(Self.letters[n])
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                }
            }
            ForEach(weeks, id: \.first) { week in
                HStack(spacing: 0) {
                    ForEach(week, id: \.self) { day in
                        Button {
                            pick(day)
                        } label: {
                            dayCell(day, today: today)
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private func dayCell(_ day: Day, today: Day) -> some View {
        let isToday = day == today
        let isSelected = day == selected
        let outside = wholeMonth && day.month != anchor.month
        return VStack(spacing: 1) {
            Text("\(day.day)")
                .font(.system(size: 13, weight: isToday || isSelected ? .semibold : .regular, design: .rounded))
                .foregroundStyle(isToday ? AnyShapeStyle(.white) : outside ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.primary))
                .frame(width: cell - 4, height: cell - 4)
                .background {
                    if isToday {
                        Circle().fill(CalendarStyle.olive)
                    } else if isSelected {
                        Circle().strokeBorder(CalendarStyle.accent, lineWidth: 1.5)
                    }
                }
        }
        .frame(height: cell)
        .contentShape(.rect)
        .accessibilityLabel(MacStyle.shortDate(day))
    }
}
