import SwiftUI

/// The top of the calendar, in glass with the day scrolling under it: the
/// month (tap to drop open a month grid), Today, the week to move between
/// days.
struct TopBar: View {
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    private static let monthNames = Calendar.current.monthSymbols

    var body: some View {
        VStack(spacing: 6) {
            titleRow
            if nav.monthOpen {
                MonthGrid()
                    .transition(.opacity.combined(with: .move(edge: .top)))
            } else {
                WeekStrip(me: me)
            }
            TripBand(me: me)
        }
        .padding(.top, 2)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background {
            Color.clear
                .glassEffect(.regular, in: UnevenRoundedRectangle(bottomLeadingRadius: 26, bottomTrailingRadius: 26, style: .continuous))
                .ignoresSafeArea(edges: .top)
        }
        .animation(.snappy, value: nav.monthOpen)
    }

    private var titleRow: some View {
        HStack(spacing: 10) {
            Button {
                nav.monthOpen.toggle()
            } label: {
                HStack(spacing: 6) {
                    Text(Self.monthNames[nav.day.month - 1])
                        .font(.system(.title, design: .serif).weight(.semibold))
                        .contentTransition(.numericText())
                    if nav.day.year != Day.today().year {
                        Text(String(nav.day.year))
                            .font(.system(.title3, design: .serif))
                            .foregroundStyle(.secondary)
                    }
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(nav.monthOpen ? 180 : 0))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(Self.monthNames[nav.day.month - 1]), choose a day")

            Spacer()

            if store.offline {
                Label("Offline", systemImage: "wifi.slash")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            } else if store.refreshing, !store.loaded {
                ProgressView().controlSize(.small)
            }

            if nav.monthOpen {
                HStack(spacing: 4) {
                    monthStep(-1, "chevron.left", "Previous month")
                    monthStep(1, "chevron.right", "Next month")
                }
            }

            Button {
                nav.tripsOpen = true
            } label: {
                Image(systemName: "suitcase")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(CalendarStyle.accent)
                    .frame(width: 34, height: 30)
                    .background(CalendarStyle.accent.opacity(0.14), in: .rect(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Trips")

            Button {
                nav.goToToday()
            } label: {
                Text(String(Day.today().day))
                    .font(.system(.subheadline, design: .rounded).weight(.bold))
                    .foregroundStyle(nav.day == .today() ? Color.white : CalendarStyle.accent)
                    .frame(width: 34, height: 30)
                    .background(
                        nav.day == .today() ? AnyShapeStyle(CalendarStyle.olive) : AnyShapeStyle(CalendarStyle.accent.opacity(0.14)),
                        in: .rect(cornerRadius: 9)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Today")
        }
        .padding(.horizontal, 18)
    }

    private func monthStep(_ by: Int, _ symbol: String, _ label: String) -> some View {
        Button {
            let target = nav.day.adding(months: by)
            if let first = CalendarNav.days.first, let last = CalendarNav.days.last {
                nav.day = min(max(target, first), last)
            }
        } label: {
            Image(systemName: symbol)
                .font(.footnote.weight(.bold))
                .frame(width: 30, height: 30)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel(label)
    }
}

private let weekdayLetters = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

/// One day in the week strip or the month grid.
private struct DayCell: View {
    let day: Day
    var dimmed = false
    /// On a trip of the signed-in member's: a short bar under the date.
    var onTrip = false
    @Environment(CalendarNav.self) private var nav

    var body: some View {
        let isToday = day == .today()
        let selected = day == nav.day
        Button {
            withAnimation(.snappy) {
                nav.day = day
                nav.monthOpen = false
            }
        } label: {
            Text(String(day.day))
                .font(.system(.callout, design: .rounded).weight(selected || isToday ? .bold : .medium))
                .foregroundStyle(selected ? Color.white : isToday ? CalendarStyle.accent : dimmed ? Color.secondary.opacity(0.5) : Color.primary)
                .frame(width: 34, height: 34)
                .background {
                    if selected {
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .fill(isToday ? AnyShapeStyle(CalendarStyle.olive) : AnyShapeStyle(Color.primary.opacity(0.82)))
                    } else if isToday {
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .strokeBorder(CalendarStyle.accent, lineWidth: 1.5)
                    }
                }
            .overlay(alignment: .bottom) {
                if onTrip {
                    Capsule().fill(CalendarStyle.olive).frame(width: 16, height: 3).offset(y: 3)
                }
            }
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The week in view, Monday first; swipe for the weeks either side.
private struct WeekStrip: View {
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    private static let weeks: [Day] = {
        guard let first = CalendarNav.days.first?.weekStart(), let last = CalendarNav.days.last else { return [] }
        return stride(from: 0, through: first.days(to: last), by: 7).map { first.adding(days: $0) }
    }()

    var body: some View {
        // Swiping a week keeps the weekday: Wednesday stays Wednesday.
        let week = Binding<Day?>(
            get: { nav.day.weekStart() },
            set: { new in
                guard let new, new != nav.day.weekStart() else { return }
                let target = new.adding(days: nav.day.weekdayIndex())
                if let first = CalendarNav.days.first, let last = CalendarNav.days.last {
                    nav.scrolled(to: min(max(target, first), last))
                }
            }
        )
        VStack(spacing: 2) {
            HStack(spacing: 0) {
                ForEach(weekdayLetters, id: \.self) { letter in
                    Text(letter)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 10)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(Self.weeks, id: \.self) { start in
                        HStack(spacing: 0) {
                            ForEach(0..<7, id: \.self) { offset in
                                let day = start.adding(days: offset)
                                DayCell(day: day, onTrip: store.board.trips.contains { $0.trip.contains(day) && (me.map($0.trip.travelers.contains) ?? true) })
                            }
                        }
                        .padding(.horizontal, 10)
                        .containerRelativeFrame(.horizontal)
                        .id(start)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollIndicators(.hidden)
            .scrollPosition(id: week)
            .frame(height: 36)
        }
    }
}

/// The month dropped open: tap a day to go there.
private struct MonthGrid: View {
    @Environment(CalendarNav.self) private var nav

    var body: some View {
        VStack(spacing: 2) {
            HStack(spacing: 0) {
                ForEach(weekdayLetters, id: \.self) { letter in
                    Text(letter)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            ForEach(nav.day.monthGrid(), id: \.self) { week in
                HStack(spacing: 0) {
                    ForEach(week, id: \.self) { day in
                        DayCell(day: day, dimmed: day.month != nav.day.month)
                    }
                }
            }
        }
        .padding(.horizontal, 10)
        .gesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    guard abs(value.translation.width) > abs(value.translation.height) else { return }
                    let target = nav.day.adding(months: value.translation.width < 0 ? 1 : -1)
                    if let first = CalendarNav.days.first, let last = CalendarNav.days.last {
                        withAnimation(.snappy) { nav.day = min(max(target, first), last) }
                    }
                }
        )
    }
}

/// How the Day view's columns share the width: the first is wide, with full
/// cards; the others are narrow pin columns, or thin blocks.
struct ColumnMetrics {
    var widths: [CGFloat]

    init(width: CGFloat, count: Int, asBlocks: Bool) {
        let space = max(0, width - CalendarStyle.gutter)
        guard count > 1 else {
            widths = count == 1 ? [space] : []
            return
        }
        if asBlocks {
            let unit = space / CGFloat(count + 2)
            widths = [unit * 3] + Array(repeating: unit, count: count - 1)
        } else {
            let narrow = min(CalendarStyle.pinColumn, space / CGFloat(count + 2))
            widths = [space - narrow * CGFloat(count - 1)] + Array(repeating: narrow, count: count - 1)
        }
    }

    func x(_ index: Int) -> CGFloat {
        CalendarStyle.gutter + widths.prefix(index).reduce(0, +)
    }

    /// The column a point across the grid falls in.
    func column(at x: CGFloat) -> Int? {
        guard !widths.isEmpty else { return nil }
        var edge = CalendarStyle.gutter
        for (i, w) in widths.enumerated() {
            edge += w
            if x < edge { return i }
        }
        return widths.count - 1
    }
}
