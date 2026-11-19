import SwiftUI
import UIKit

/// The Day view: swipe left and right between days, each a time grid with a
/// column per family member.
struct DayPager: View {
    let me: String?
    @Environment(CalendarNav.self) private var nav

    var body: some View {
        let day = Binding<Day?>(
            get: { nav.day },
            set: { if let new = $0, new != nav.day { nav.day = new } }
        )
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(CalendarNav.days, id: \.self) { day in
                    DayPage(day: day, me: me, scroll: nav.gridScroll)
                        .containerRelativeFrame(.horizontal)
                        .id(day)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollIndicators(.hidden)
        .scrollPosition(id: day)
    }
}

/// One day's grid. The whole day is there, midnight to midnight, opened a
/// little before now; every day shares one scroll position, so paging keeps
/// the time of day in view.
private struct DayPage: View {
    let day: Day
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(Prefs.self) private var prefs
    @State private var position: ScrollPosition
    /// How tall this day's all-day strip is; the grid starts below it.
    @State private var stripHeight: CGFloat = 0

    init(day: Day, me: String?, scroll: CGFloat) {
        self.day = day
        self.me = me
        _position = State(initialValue: ScrollPosition(y: scroll))
    }

    private var height: CGFloat { CalendarStyle.hourHeight * 24 }

    var body: some View {
        let layout = DayLayout.build(
            day: day, board: store.board, shown: prefs.shown(store.board.members), me: me, showHidden: prefs.showHidden
        )
        GeometryReader { geo in
            let metrics = ColumnMetrics(width: geo.size.width, count: layout.columns.count, asBlocks: prefs.othersAsBlocks)
            ScrollView(.vertical) {
                ZStack(alignment: .topLeading) {
                    HourLines()
                    ColumnRules(metrics: metrics, wash: layout.columns.first.map { CalendarStyle.muted($0.member.color).opacity(0.045) })
                    ForEach(Array(layout.columns.enumerated()), id: \.element.id) { index, column in
                        ColumnBlocks(column: column, wide: index == 0, width: metrics.widths[index], inWide: layout.inWideColumn)
                            .frame(width: metrics.widths[index], height: height, alignment: .topLeading)
                            .offset(x: metrics.x(index))
                    }
                    if let draft = nav.gridDraft, draft.day == day,
                       let index = layout.columns.firstIndex(where: { $0.member.email == draft.member }) {
                        DraftBlock(start: draft.start, member: layout.columns[index].member)
                            .frame(width: max(metrics.widths[index], 120))
                            .offset(x: min(metrics.x(index), geo.size.width - max(metrics.widths[index], 120)), y: y(draft.start))
                    }
                    if day == .today() { NowLine() }
                }
                .frame(width: geo.size.width, height: height, alignment: .topLeading)
                .contentShape(.rect)
                .onTapGesture { nav.peek = nil }
                .gesture(GridPress { phase, point in
                    press(phase, point, metrics: metrics, columns: layout.columns)
                })
            }
            .contentMargins(.top, nav.topInset + stripHeight + 6, for: .scrollContent)
            .contentMargins(.bottom, nav.bottomInset, for: .scrollContent)
            .scrollIndicators(.hidden)
            .scrollPosition($position)
            .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, offset in
                if day == nav.day { nav.gridScroll = offset }
            }
            .onChange(of: nav.gridScroll) { _, offset in
                // The pages either side follow the one in view.
                if day != nav.day { position.scrollTo(y: offset) }
            }
            .refreshable { await store.sync() }
            .overlay(alignment: .top) {
                AllDayStrip(day: day)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { stripHeight = $0 }
                    .padding(.top, nav.topInset)
            }
        }
    }

    private func y(_ minutes: Int) -> CGFloat { CGFloat(minutes) / 60 * CalendarStyle.hourHeight }

    /// A long-press on empty grid places a new event: an hour in that
    /// person's column, snapped to the quarter hour, which follows the finger
    /// until it lifts and then opens the card.
    private func press(_ phase: GridPress.Phase, _ point: CGPoint, metrics: ColumnMetrics, columns: [DayColumn]) {
        guard let index = metrics.column(at: point.x), columns.indices.contains(index) else { return }
        // A long-press on an event is that event's own (its menu), not a new one.
        if phase == .began {
            let touched = Int(point.y / CalendarStyle.hourHeight * 60)
            let least = Int(CalendarStyle.minBlock / CalendarStyle.hourHeight * 60)
            if columns[index].blocks.contains(where: { $0.start <= touched && touched < max($0.end, $0.start + least) }) { return }
        }
        let raw = Int(point.y / CalendarStyle.hourHeight * 60) - 30
        let start = min(max(0, (raw + 7) / 15 * 15), 23 * 60)
        switch phase {
        case .began:
            nav.peek = nil
            nav.gridDraft = GridDraft(day: day, member: columns[index].member.email, start: start)
        case .moved:
            guard let draft = nav.gridDraft else { return }
            nav.gridDraft = GridDraft(day: day, member: draft.member, start: start)
        case .ended:
            guard let draft = nav.gridDraft else { return }
            let begins = day.at(minutes: draft.start)
            nav.compose(for: draft.member, from: begins, to: begins.addingTimeInterval(3600))
            nav.gridDraft = nil
        case .cancelled:
            nav.gridDraft = nil
        }
    }
}

/// A long-press with its place on the grid, which SwiftUI's own long-press
/// doesn't report. It leaves scrolling and taps alone.
private struct GridPress: UIGestureRecognizerRepresentable {
    enum Phase { case began, moved, ended, cancelled }

    var action: (Phase, CGPoint) -> Void

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let press = UILongPressGestureRecognizer()
        press.minimumPressDuration = 0.4
        return press
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        let point = context.converter.localLocation
        switch recognizer.state {
        case .began: action(.began, point)
        case .changed: action(.moved, point)
        case .ended: action(.ended, point)
        case .cancelled, .failed: action(.cancelled, point)
        default: break
        }
    }
}

private struct HourLines: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(0..<24, id: \.self) { hour in
                let top = CGFloat(hour) * CalendarStyle.hourHeight
                Rectangle()
                    .fill(CalendarStyle.line)
                    .frame(height: 0.5)
                    .padding(.leading, CalendarStyle.gutter)
                    .offset(y: top)
                if hour > 0 {
                    Text(CalendarRules.hourLabel(hour))
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .frame(width: CalendarStyle.gutter - 8, alignment: .trailing)
                        .offset(y: top - 6)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// The lines between columns, and the faint wash of their own colour down the
/// signed-in member's.
private struct ColumnRules: View {
    let metrics: ColumnMetrics
    let wash: Color?

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let wash, let width = metrics.widths.first {
                Rectangle().fill(wash).frame(width: width).offset(x: metrics.x(0))
            }
            ForEach(metrics.widths.indices, id: \.self) { index in
                Rectangle()
                    .fill(index == 1 ? CalendarStyle.line : CalendarStyle.faintLine)
                    .frame(width: 0.5)
                    .offset(x: metrics.x(index))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct NowLine: View {
    var body: some View {
        TimelineView(.everyMinute) { context in
            let top = CGFloat(CalendarRules.minutes(context.date)) / 60 * CalendarStyle.hourHeight
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(CalendarStyle.now)
                    .frame(height: 1.5)
                    .padding(.leading, CalendarStyle.gutter)
                    .offset(y: top - 0.75)
                Circle()
                    .fill(CalendarStyle.now)
                    .frame(width: 8, height: 8)
                    .offset(x: CalendarStyle.gutter - 4, y: top - 4)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .allowsHitTesting(false)
    }
}

/// The hour a long-press is placing, before the form opens.
private struct DraftBlock: View {
    let start: Int
    let member: Member

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("New event")
                .font(.caption.weight(.semibold))
            Text(CalendarRules.clock(Day.today().at(minutes: start)))
                .font(.caption2)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, minHeight: CalendarStyle.hourHeight, alignment: .topLeading)
        .background(CalendarStyle.muted(member.color).opacity(0.92), in: .rect(cornerRadius: 9))
        .shadow(color: .black.opacity(0.18), radius: 8, y: 3)
        .sensoryFeedback(.selection, trigger: start)
        .allowsHitTesting(false)
    }
}

/// A column's blocks: full cards in the wide column; pin lines or thin blocks
/// in the others.
private struct ColumnBlocks: View {
    let column: DayColumn
    let wide: Bool
    let width: CGFloat
    /// The events on cards in the wide column (DayLayout.inWideColumn).
    let inWide: Set<UUID>
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(Prefs.self) private var prefs

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(column.blocks) { block in
                if wide {
                    card(block)
                } else if prefs.othersAsBlocks {
                    thin(block)
                } else if showsPin(block) {
                    pin(block)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func y(_ minutes: Int) -> CGFloat { CGFloat(minutes) / 60 * CalendarStyle.hourHeight }

    private func frame(_ block: DayBlock) -> CGRect {
        let lane = (width - 3) / CGFloat(block.lanes)
        let trueHeight = y(block.end) - y(block.start)
        let height = max(trueHeight, CalendarStyle.minBlock)
        // A short drop-off grows upward, so its end still meets the event.
        let top = block.kind == .drive && block.item.event.driveDuty != .pickup ? y(block.end) - height : y(block.start)
        return CGRect(x: 1.5 + lane * CGFloat(block.lane), y: top, width: max(lane - 2, 4), height: height - 1.5)
    }

    // MARK: The wide column

    @ViewBuilder
    private func card(_ block: DayBlock) -> some View {
        let rect = frame(block)
        Button {
            nav.open(block.item, in: store)
        } label: {
            Group {
                switch block.kind {
                case .own: OwnCard(item: block.item, height: rect.height)
                case .drive: DriveCard(item: block.item, height: rect.height, compact: block.lanes > 1)
                case .attending(let eventStart, let eventEnd):
                    AttendingCard(
                        item: block.item, height: rect.height,
                        legTop: y(eventStart) - y(block.start), legBottom: max(0, y(block.end) - y(eventEnd))
                    )
                }
            }
            .frame(width: rect.width, height: rect.height, alignment: .topLeading)
        }
        .buttonStyle(.plain)
        .opacity(block.item.hidden ? 0.5 : 1)
        .hideMenu(block.item)
        .offset(x: rect.minX, y: rect.minY)
    }

    // MARK: The narrow columns

    /// A drive on its own doesn't get a pin; one fused onto an event the
    /// driver attends is part of that event's. Nor does going along to an
    /// event that's a card in the wide column, where their face already is:
    /// a family trip would otherwise be a bare line down every column.
    private func showsPin(_ block: DayBlock) -> Bool {
        switch block.kind {
        case .own: true
        case .drive: false
        case .attending: !inWide.contains(block.item.id)
        }
    }

    @ViewBuilder
    private func pin(_ block: DayBlock) -> some View {
        let hot = nav.peek?.id == block.item.id
        let top = y(block.start)
        let height = max(y(block.end) - top, 12)
        // Someone else's event this member is going to: drawn lighter and
        // without a face, so it reads as "busy with that", not a second event.
        let attending: Bool = { if case .attending = block.kind { true } else { false } }()
        let (coreTop, coreHeight): (CGFloat, CGFloat) = {
            if case .attending(let eventStart, let eventEnd) = block.kind {
                return (y(eventStart) - top, max(y(eventEnd) - y(eventStart), 2))
            }
            return (0, height)
        }()
        let color = CalendarStyle.muted(block.item.color)
        Button {
            nav.peek = hot ? nil : block.item
        } label: {
            ZStack(alignment: .top) {
                if attending {
                    // Their drives there and back, fainter still.
                    Capsule()
                        .fill(color.opacity(0.18))
                        .frame(width: hot ? 4 : 2.5, height: height)
                    Capsule()
                        .fill(color.opacity(0.45))
                        .frame(width: hot ? 4 : 2.5, height: coreHeight)
                        .offset(y: coreTop)
                    Circle()
                        .fill(CalendarStyle.ground)
                        .overlay(Circle().strokeBorder(color.opacity(0.75), lineWidth: 2))
                        .frame(width: 9, height: 9)
                        .scaleEffect(hot ? 1.25 : 1)
                        .offset(y: coreTop - 4.5)
                } else {
                    Capsule()
                        .fill(color)
                        .frame(width: hot ? 4 : 2.5, height: height)
                    Avatar(member: store.board.member(block.item.event.memberEmail), size: 22)
                        .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1.5))
                        .scaleEffect(hot ? 1.15 : 1)
                        .offset(y: -11)
                }
            }
            .frame(width: width, height: height, alignment: .top)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .opacity(block.item.hidden ? 0.5 : 1)
        .hideMenu(block.item, cornerRadius: 11)
        .offset(y: top)
        .animation(.snappy, value: hot)
        .accessibilityLabel("\(block.item.title), \(CalendarRules.timeRange(block.item.event))")
    }

    @ViewBuilder
    private func thin(_ block: DayBlock) -> some View {
        let rect = frame(block)
        Button {
            nav.open(block.item, in: store)
        } label: {
            Group {
                if block.kind == .drive {
                    DriveArrow(duty: block.item.event.driveDuty ?? .dropoff, depth: 6)
                        .fill(CalendarStyle.muted(block.item.color))
                } else {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(CalendarStyle.wash(block.item.color, 0.42))
                        .overlay(alignment: .topTrailing) {
                            if block.item.isTeamsnap, rect.height >= 30 {
                                Image(systemName: "baseball")
                                    .font(.system(size: 9))
                                    .foregroundStyle(CalendarStyle.ink(block.item.color))
                                    .padding(3)
                            }
                        }
                }
            }
            .frame(width: rect.width, height: rect.height)
        }
        .buttonStyle(.plain)
        .opacity(block.item.hidden ? 0.5 : 1)
        .hideMenu(block.item, cornerRadius: 5)
        .offset(x: rect.minX, y: rect.minY)
        .accessibilityLabel("\(block.item.title), \(CalendarRules.timeRange(block.item.event))")
    }
}

/// The signed-in member's own event: a washed card with a bar of their
/// colour, and as much as its height has room for.
private struct OwnCard: View {
    let item: EventItem
    let height: CGFloat
    @Environment(CalendarStore.self) private var store

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle()
                .fill(CalendarStyle.muted(item.color))
                .frame(width: 3.5)
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(item.title)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(CalendarStyle.ink(item.color))
                        .lineLimit(height >= 54 ? 2 : 1)
                    if item.conflict { ConflictMark() }
                    Spacer(minLength: 0)
                    if height < 44 { trailing(limit: 2, onlyUnset: true) }
                }
                if height >= 44 {
                    HStack(spacing: 4) {
                        Text(CalendarRules.timeRange(item.event))
                            .font(.system(size: 10.5))
                            .foregroundStyle(CalendarStyle.ink(item.color).opacity(0.75))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        trailing(limit: 3, onlyUnset: false)
                    }
                }
                if height >= 74, let location = item.event.location {
                    Label(location, systemImage: "mappin")
                        .labelStyle(.titleAndIcon)
                        .font(.system(size: 10.5))
                        .foregroundStyle(CalendarStyle.ink(item.color).opacity(0.65))
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(CalendarStyle.wash(item.color))
        .clipShape(.rect(cornerRadius: 7, style: .continuous))
    }

    @ViewBuilder
    private func trailing(limit: Int, onlyUnset: Bool) -> some View {
        DutyGlyphs(item: item, onlyUnset: onlyUnset)
        if !item.attendees.isEmpty {
            HStack(spacing: -5) {
                ForEach(item.attendees.prefix(limit), id: \.self) { email in
                    Avatar(member: store.board.member(email), size: 15)
                        .overlay(Circle().strokeBorder(CalendarStyle.wash(item.color), lineWidth: 1))
                }
            }
        }
    }
}

/// A drive: an arrow in the kid's colour.
private struct DriveCard: View {
    let item: EventItem
    let height: CGFloat
    let compact: Bool

    var body: some View {
        Text(compact ? Self.short(item.event.title) : item.event.title)
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(.white.opacity(0.96))
            .lineLimit(height < 40 ? 1 : 2)
            .padding(.leading, item.event.driveDuty == .pickup ? 14 : 7)
            .padding(.trailing, item.event.driveDuty == .pickup ? 5 : 14)
            .padding(.vertical, 3)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: height < 40 ? .leading : .topLeading)
            .background(CalendarStyle.muted(item.color), in: DriveArrow(duty: item.event.driveDuty ?? .dropoff))
    }

    /// "18 min" from "Drop off Sebastian @ 4:30pm (18 min drive)".
    static func short(_ title: String) -> String {
        if let open = title.lastIndex(of: "("), let close = title.lastIndex(of: ")"), open < close {
            let inside = title[title.index(after: open)..<close]
            if inside.hasSuffix(" drive") { return String(inside.dropLast(" drive".count)) }
        }
        return title
    }
}

/// Someone else's event the signed-in member is going to, with their drives
/// there and back fused on as lighter ends.
private struct AttendingCard: View {
    let item: EventItem
    let height: CGFloat
    let legTop: CGFloat
    let legBottom: CGFloat
    @Environment(CalendarStore.self) private var store

    var body: some View {
        ZStack(alignment: .topLeading) {
            CalendarStyle.muted(item.color)
            VStack(spacing: 0) {
                Rectangle().fill(.white.opacity(0.28)).frame(height: legTop)
                Spacer(minLength: 0)
                Rectangle().fill(.white.opacity(0.28)).frame(height: legBottom)
            }
            HStack(alignment: .top, spacing: 5) {
                Avatar(member: store.board.member(item.event.memberEmail), size: 16)
                    .overlay(Circle().strokeBorder(.white.opacity(0.7), lineWidth: 1))
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title)
                        .font(.system(size: 12.5, weight: .semibold))
                        .lineLimit(2)
                    if height - legTop - legBottom >= 44 {
                        Text(CalendarRules.timeRange(item.event))
                            .font(.system(size: 10.5))
                            .opacity(0.85)
                            .lineLimit(1)
                    }
                }
                .foregroundStyle(.white.opacity(0.96))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .offset(y: legTop)
        }
        .clipShape(.rect(cornerRadius: 7, style: .continuous))
    }
}

/// The day's all-day events: a strip of the grid pinned under the top bar,
/// a row each, lined up with the columns and in the colour of whose it is.
/// The day's timed events scroll under it.
private struct AllDayStrip: View {
    let day: Day
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(Prefs.self) private var prefs

    var body: some View {
        let shown = Set(prefs.shown(store.board.members).map(\.email))
        let items = store.board.events(on: day, showHidden: prefs.showHidden)
            .filter { $0.event.allDay && shown.contains($0.event.memberEmail) }
        if !items.isEmpty {
            VStack(spacing: 3) {
                ForEach(items) { item in
                    Button {
                        nav.open(item, in: store)
                    } label: {
                        HStack(spacing: 6) {
                            Text(item.title)
                                .font(.system(size: 12.5, weight: .semibold))
                                .foregroundStyle(CalendarStyle.ink(item.color))
                                .strikethrough(item.hidden && !item.hiddenByMe)
                                .lineLimit(1)
                            if item.conflict { ConflictMark() }
                            Spacer(minLength: 0)
                            Avatar(member: store.board.member(item.event.memberEmail), size: 16)
                        }
                        .padding(.leading, 9)
                        .padding(.trailing, 5)
                        .frame(height: 24)
                        .background(CalendarStyle.wash(item.color, 0.3))
                        .overlay(alignment: .leading) {
                            Rectangle().fill(CalendarStyle.muted(item.color)).frame(width: 3.5)
                        }
                        .clipShape(.rect(cornerRadius: 7, style: .continuous))
                        .opacity(item.hidden ? 0.5 : 1)
                    }
                    .buttonStyle(.plain)
                    .hideMenu(item)
                }
            }
            .padding(.leading, CalendarStyle.gutter + 1.5)
            .padding(.trailing, 6)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity)
            .background(alignment: .leading) {
                // The gutter's edge carries on up through the strip.
                Rectangle().fill(CalendarStyle.line).frame(width: 0.5).padding(.leading, CalendarStyle.gutter)
            }
            .background(CalendarStyle.ground)
            .overlay(alignment: .bottom) { Rectangle().fill(CalendarStyle.line).frame(height: 0.5) }
        }
    }
}
