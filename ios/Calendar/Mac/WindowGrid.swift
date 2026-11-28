import SwiftUI

/// Which drawing of an event its card hangs off.
enum GridAnchor {
    static let new = "new"
    static func card(_ day: Day, _ id: UUID) -> String { "card-\(day)-\(id)" }
    static func line(_ day: Day, _ member: String, _ id: UUID) -> String { "line-\(day)-\(member)-\(id)" }
    static func allDay(_ day: Day, _ id: UUID) -> String { "allday-\(day)-\(id)" }
}

/// Where things sit across the window's grid.
struct GridMetrics {
    var width: CGFloat
    var days: Int
    var others: Int
    var style: WindowView

    var dayWidth: CGFloat { max(60, (width - MacStyle.gutter) / CGFloat(max(days, 1))) }
    func x(_ day: Int) -> CGFloat { MacStyle.gutter + dayWidth * CGFloat(day) }

    /// The signed-in member's cards.
    var cardsWidth: CGFloat {
        switch style {
        case .week: max(40, dayWidth - lanesWidth - 5)
        case .day: min(max(dayWidth * 0.44, 300), 520)
        }
    }

    /// Week: the family's thin lines at the right edge of each day.
    var lanesWidth: CGFloat { others == 0 ? 0 : CGFloat(others) * MacStyle.lane + 4 }
    func laneX(_ member: Int) -> CGFloat { cardsWidth + 5 + CGFloat(member) * MacStyle.lane }

    /// Day: a column of pins each, then their labels.
    func pinX(_ member: Int) -> CGFloat { cardsWidth + 12 + CGFloat(member) * MacStyle.pinColumn }
    var labelsX: CGFloat { pinX(others) + 6 }

    func day(at x: CGFloat) -> Int {
        min(max(Int((x - MacStyle.gutter) / dayWidth), 0), days - 1)
    }

    static func y(_ minutes: Int) -> CGFloat { CGFloat(minutes) / 60 * MacStyle.hourHeight }
    /// The quarter hour nearest a height.
    static func minutes(at y: CGFloat) -> Int {
        min(max(Int((y / MacStyle.hourHeight * 4).rounded()) * 15, 0), 24 * 60)
    }
}

/// The window's calendar: a time grid of seven days (Week) or one (Day),
/// read from the signed-in member's side. Only their events are cards. In
/// Week the rest of the family are thin lines down the right of each day, a
/// lane each; in Day they're pins with a face at each start and the event's
/// name beside them where there's room.
///
/// Dragging on empty grid draws a new event; dragging a card moves it, and
/// dragging its lower edge changes when it ends.
struct CalendarGrid: View {
    let days: [Day]
    let style: WindowView
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    private var me: String? { model.me }

    /// Everyone drawn: the signed-in member, then who's shown.
    private var members: [Member] {
        var shown = model.prefs.shown(store.board.members)
        if let me, !shown.contains(where: { $0.email == me }), let mine = store.board.member(me) { shown.append(mine) }
        return DayLayout.order(shown, me: me)
    }

    var body: some View {
        let members = members
        let others = Array(members.dropFirst())
        let layouts = days.map {
            DayLayout.build(day: $0, board: store.board, shown: members, me: me, showHidden: model.prefs.showHidden)
        }
        GeometryReader { geo in
            let metrics = GridMetrics(width: geo.size.width, days: days.count, others: others.count, style: style)
            VStack(spacing: 0) {
                GridHeader(days: days, layouts: layouts, others: others, metrics: metrics)
                Rectangle().fill(CalendarStyle.line).frame(height: 1)
                ScrollViewReader { proxy in
                    ScrollView(.vertical) {
                        TimelineView(.everyMinute) { time in
                            hours(layouts: layouts, others: others, metrics: metrics, now: Clock.now(time.date))
                        }
                    }
                    .scrollIndicators(.never)
                    .onAppear {
                        // Open a little before now, and no earlier than seven.
                        let hour = max(0, min(CalendarRules.minutes(Clock.now()) / 60 - 2, 7))
                        proxy.scrollTo("hour-\(max(hour, 1))", anchor: .top)
                    }
                    .onChange(of: model.window.reveal) { _, hour in
                        // A new event made from the menu may be out of sight:
                        // scroll to it, so its card has somewhere to hang.
                        guard let hour else { return }
                        proxy.scrollTo("hour-\(max(1, hour - 3))", anchor: .top)
                        model.window.reveal = nil
                    }
                }
            }
        }
    }

    private func hours(layouts: [DayLayout], others: [Member], metrics: GridMetrics, now: Date) -> some View {
        let window = model.window
        let today = Day(now)
        return ZStack(alignment: .topLeading) {
            // The hours: a row each, to scroll to, with its line and label.
            VStack(spacing: 0) {
                ForEach(0..<24, id: \.self) { hour in
                    HStack(alignment: .top, spacing: 0) {
                        Text(hour == 0 ? "" : CalendarRules.hourLabel(hour))
                            .font(.system(size: 10.5, weight: .medium, design: .rounded))
                            .foregroundStyle(.tertiary)
                            .frame(width: MacStyle.gutter - 8, alignment: .trailing)
                            .offset(y: -7)
                        Rectangle().fill(CalendarStyle.line).frame(height: 1).padding(.leading, 8)
                    }
                    .frame(height: MacStyle.hourHeight, alignment: .top)
                    // What's scrolled to: a little above the next hour's line,
                    // so that hour's label, which sits on the line, isn't cut.
                    .overlay(alignment: .bottom) { Color.clear.frame(height: 12).id("hour-\(hour + 1)") }
                }
            }
            ForEach(Array(layouts.enumerated()), id: \.element.day) { index, layout in
                DayStripe(
                    layout: layout, index: index, days: days, others: others, metrics: metrics,
                    isToday: layout.day == today
                )
                .frame(width: metrics.dayWidth, height: MacStyle.hourHeight * 24, alignment: .topLeading)
                .offset(x: metrics.x(index))
            }
            if let index = days.firstIndex(of: today) {
                NowLine(minutes: CalendarRules.minutes(now, in: store.board.calendar(on: today)))
                    .frame(width: style == .day ? metrics.width - MacStyle.gutter + 6 : metrics.dayWidth + 6)
                    .offset(x: metrics.x(index) - 6)
            }
            // What's being drawn or moved, and a new event while its card is open.
            if let drag = window.drag ?? window.ghost, let index = days.firstIndex(of: drag.day) {
                GhostBlock(drag: drag, title: drag.event.flatMap { store.board.item($0)?.title }, color: ghostColor(drag))
                    .frame(width: metrics.cardsWidth - 2, height: max(GridMetrics.y(drag.end) - GridMetrics.y(drag.start), 14))
                    .popover(item: cardBinding(GridAnchor.new), attachmentAnchor: .rect(.bounds), arrowEdge: .trailing) { card in
                        EventPopover(request: card)
                    }
                    .offset(x: metrics.x(index) + 1, y: GridMetrics.y(drag.start))
                    .allowsHitTesting(false)
            }
            if let peek = window.peek, window.card == nil {
                PeekBubble(item: peek.item)
                    .offset(x: peek.x > 260 + MacStyle.gutter ? peek.x - 252 : peek.x + 14, y: max(peek.y - 6, 4))
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .frame(width: metrics.width, height: MacStyle.hourHeight * 24, alignment: .topLeading)
        .coordinateSpace(.named("grid"))
        // Room for the first hour's label, which sits on its line.
        .padding(.top, 10)
        .padding(.bottom, 16)
        .animation(.easeOut(duration: 0.12), value: window.peek)
    }

    private func ghostColor(_ drag: GridDrag) -> String {
        drag.event.flatMap { store.board.item($0)?.color } ?? store.board.member(me)?.color ?? CalendarRules.familyColor
    }

    private func cardBinding(_ anchor: String) -> Binding<CardRequest?> {
        let window = model.window
        return Binding(
            get: { window.cardAnchor == anchor ? window.card : nil },
            set: { if $0 == nil, window.cardAnchor == anchor { window.closeCard() } }
        )
    }
}

/// The event card in a popover off whatever was clicked.
struct EventPopover: View {
    let request: CardRequest
    @Environment(AppModel.self) private var model

    var body: some View {
        let window = model.window
        EventCardMac(
            request: request, me: model.me, maxHeight: 600,
            report: { window.report($0) }, close: { window.closeCard() },
            added: { day in if model.prefs.view == .day { window.day = day } }
        )
        .frame(width: 372)
        .environment(model.store)
        .tint(CalendarStyle.accent)
    }
}

/// One day of the grid: the member's own cards, and the family beside them.
private struct DayStripe: View {
    let layout: DayLayout
    let index: Int
    let days: [Day]
    let others: [Member]
    let metrics: GridMetrics
    let isToday: Bool
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    private var window: WindowState { model.window }
    private var day: Day { layout.day }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // The day's own ground: today a touch warmer, a rule down its left.
            Rectangle()
                .fill(isToday && metrics.style == .week ? CalendarStyle.accent.opacity(0.05) : .clear)
            Rectangle().fill(CalendarStyle.faintLine).frame(width: 1)

            // Empty grid: drag to draw a new event, double-click for an hour.
            Color.clear
                .contentShape(.rect)
                .frame(width: metrics.style == .week ? metrics.dayWidth : metrics.cardsWidth)
                .onTapGesture(count: 2, coordinateSpace: .named("grid")) { point in
                    // The half hour the click is in.
                    let start = min(Int(point.y / MacStyle.hourHeight * 2) * 30, 23 * 60)
                    compose(from: start, to: start + 60)
                }
                .onTapGesture { window.peek = nil }
                .gesture(
                    DragGesture(minimumDistance: 6, coordinateSpace: .named("grid"))
                        .onChanged { drag in
                            let a = GridMetrics.minutes(at: drag.startLocation.y)
                            let b = GridMetrics.minutes(at: drag.location.y)
                            let (start, end) = a <= b ? (a, max(b, a + 15)) : (b, max(a, b + 15))
                            window.drag = GridDrag(kind: .create, day: day, start: start, end: min(end, 24 * 60))
                        }
                        .onEnded { _ in
                            guard let drag = window.drag, drag.kind == .create else { return }
                            window.drag = nil
                            compose(from: drag.start, to: max(drag.end, drag.start + 30))
                        }
                )

            if let mine = layout.columns.first {
                ForEach(mine.blocks) { block in
                    BlockCard(block: block, day: day, days: days, metrics: metrics)
                }
            }
            ForEach(Array(layout.columns.dropFirst().enumerated()), id: \.element.id) { n, column in
                switch metrics.style {
                case .week:
                    ForEach(column.blocks.filter { showsLine($0) }) { block in
                        FamilyLine(block: block, day: day, member: column.member, x: metrics.laneX(n), gridX: metrics.x(index) + metrics.laneX(n))
                    }
                case .day:
                    ForEach(column.blocks.filter { showsPin($0) }) { block in
                        FamilyPin(block: block, day: day, member: column.member, x: metrics.pinX(n))
                    }
                }
            }
            if metrics.style == .day {
                PinLabels(layout: layout, x: metrics.labelsX, width: max(0, metrics.dayWidth - metrics.labelsX - 8))
            }
        }
    }

    /// As on the phone: a drive on its own gets no pin, nor does going along
    /// to an event that's already a card in the member's own column.
    private func showsPin(_ block: DayBlock) -> Bool {
        switch block.kind {
        case .own: true
        case .drive: false
        case .attending: !layout.inWideColumn.contains(block.item.id)
        }
    }

    /// Week: a line is for an event that isn't a card of mine. One we're both
    /// at (theirs that I'm going to, or mine that they are) has their face on
    /// my card already.
    private func showsLine(_ block: DayBlock) -> Bool {
        block.kind != .drive && !layout.inWideColumn.contains(block.item.id)
    }

    private func compose(from start: Int, to end: Int) {
        guard let me = model.me ?? store.board.members.first?.email else { return }
        window.compose(for: me, on: day, from: start, to: min(end, 24 * 60), in: store)
    }
}

/// One of the member's own blocks: a card that opens the event, moves when
/// dragged, and ends later or sooner when its lower edge is.
private struct BlockCard: View {
    let block: DayBlock
    let day: Day
    let days: [Day]
    let metrics: GridMetrics
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    private var window: WindowState { model.window }
    private var item: EventItem { block.item }

    /// Whether it can be dragged: an event that can be edited here.
    private var movable: Bool {
        block.kind != .drive && !item.event.allDay && store.board.isEditable(item.event)
    }

    private var rect: CGRect {
        let lane = (metrics.cardsWidth - 2) / CGFloat(block.lanes)
        let trueHeight = GridMetrics.y(block.end) - GridMetrics.y(block.start)
        let height = max(trueHeight, 18)
        // A short drop-off grows upward, so its end still meets the event.
        let top = block.kind == .drive && item.event.driveDuty != .pickup ? GridMetrics.y(block.end) - height : GridMetrics.y(block.start)
        return CGRect(x: 1 + lane * CGFloat(block.lane), y: top, width: max(lane - 2, 6), height: height - 1.5)
    }

    var body: some View {
        let rect = rect
        let anchor = GridAnchor.card(day, item.id)
        let dragged = window.drag?.event == item.id
        Group {
            switch block.kind {
            case .own: OwnCard(item: item, height: rect.height, width: rect.width)
            case .drive: DriveCard(item: item, height: rect.height, compact: rect.width < 110)
            case .attending(let eventStart, let eventEnd):
                AttendingCard(
                    item: item, height: rect.height,
                    legTop: GridMetrics.y(eventStart) - GridMetrics.y(block.start),
                    legBottom: max(0, GridMetrics.y(block.end) - GridMetrics.y(eventEnd))
                )
            }
        }
        .frame(width: rect.width, height: rect.height, alignment: .topLeading)
        .contentShape(.rect)
        .onTapGesture { window.open(item, anchor: anchor, in: store) }
        .gesture(move, isEnabled: movable)
        .overlay(alignment: .bottom) {
            if movable, rect.height >= 22 {
                Color.clear
                    .frame(height: 6)
                    .contentShape(.rect)
                    .onHover { inside in
                        if inside { NSCursor.resizeUpDown.push() } else { NSCursor.pop() }
                    }
                    .gesture(resize)
            }
        }
        .popover(item: Binding(
            get: { window.cardAnchor == anchor ? window.card : nil },
            set: { if $0 == nil, window.cardAnchor == anchor { window.closeCard() } }
        ), attachmentAnchor: .rect(.bounds), arrowEdge: .trailing) { card in
            EventPopover(request: card)
        }
        .contextMenu { HideMenu(item: item) { window.report($0) } }
        .opacity(dragged ? 0.3 : item.hidden ? 0.5 : 1)
        .offset(x: rect.minX, y: rect.minY)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.title), \(CalendarRules.timeRange(item.event, in: item.calendar()))")
        .accessibilityAddTraits(.isButton)
    }

    /// The event's own start and end on the grid (a block can be longer: the
    /// drives fused onto an event the member is going to).
    private var span: Span { CalendarRules.span(item.event, in: item.calendar()) }

    private var move: some Gesture {
        DragGesture(minimumDistance: 5, coordinateSpace: .named("grid"))
            .onChanged { drag in
                let span = span
                let shift = Int((drag.translation.height / MacStyle.hourHeight * 60 / 15).rounded()) * 15
                let length = span.end - span.start
                let start = min(max(span.start + shift, 0), 24 * 60 - 15)
                let over = days[metrics.day(at: drag.location.x)]
                window.peek = nil
                window.drag = GridDrag(kind: .move(item.id), day: over, start: start, end: start + length)
            }
            .onEnded { _ in
                guard let drag = window.drag, drag.kind == .move(item.id) else { return }
                window.drag = nil
                let span = span
                guard drag.day != day || drag.start != span.start else { return }
                var after = store.cardDraft(for: item)
                let before = after
                CalendarRules.moveStart(&after.event, to: drag.day.at(minutes: drag.start, in: store.board.calendar(on: drag.day)))
                save(before, after)
            }
    }

    private var resize: some Gesture {
        DragGesture(minimumDistance: 2, coordinateSpace: .named("grid"))
            .onChanged { drag in
                let span = span
                let shift = Int((drag.translation.height / MacStyle.hourHeight * 60 / 15).rounded()) * 15
                let end = min(max(span.end + shift, span.start + 15), 24 * 60)
                window.drag = GridDrag(kind: .resize(item.id), day: day, start: span.start, end: end)
            }
            .onEnded { _ in
                guard let drag = window.drag, drag.kind == .resize(item.id) else { return }
                window.drag = nil
                guard drag.end != span.end else { return }
                var after = store.cardDraft(for: item)
                let before = after
                CalendarRules.moveEnd(&after.event, to: day.at(minutes: drag.end, in: store.board.calendar(on: day)))
                save(before, after)
            }
    }

    /// A drag's change, made at once. A repeating event asks first whether
    /// it's this one or all of them.
    private func save(_ before: CardDraft, _ after: CardDraft) {
        let save = CardSave(event: item.event, before: before, after: after)
        if CalendarRules.repeats(item.event) {
            window.pending = PendingSave(save: save)
        } else {
            let window = window
            store.save(save) { window.report($0) }
        }
    }
}

/// The member's own event: a washed card with a bar of its colour, and as
/// much as its size has room for.
private struct OwnCard: View {
    let item: EventItem
    let height: CGFloat
    let width: CGFloat
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let ink = CalendarStyle.ink(item.color)
        HStack(alignment: .top, spacing: 0) {
            Rectangle().fill(CalendarStyle.muted(item.color)).frame(width: 3.5)
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(item.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(ink)
                        .lineLimit(height >= 58 ? 2 : 1)
                    if item.conflict { ConflictMark() }
                    Spacer(minLength: 0)
                    if height < 38 { trailing(onlyUnset: true) }
                }
                if height >= 38 {
                    HStack(spacing: 4) {
                        Text(CalendarRules.timeRange(item.event, in: item.calendar()))
                            .font(.system(size: 10.5))
                            .foregroundStyle(ink.opacity(0.75))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        trailing(onlyUnset: false)
                    }
                }
                if height >= 72, let place = CalendarRules.whereLine(item.event) {
                    Label(place.text, systemImage: place.call ? "video" : "mappin")
                        .labelStyle(.titleAndIcon)
                        .font(.system(size: 10.5))
                        .foregroundStyle(ink.opacity(0.65))
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2.5)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(CalendarStyle.wash(item.color))
        .clipShape(.rect(cornerRadius: 6, style: .continuous))
    }

    @ViewBuilder
    private func trailing(onlyUnset: Bool) -> some View {
        if width >= 110 {
            DutyGlyphs(item: item, onlyUnset: onlyUnset)
            Faces(emails: item.attendees, size: 14, limit: width >= 170 ? 3 : 2, ring: CalendarStyle.wash(item.color))
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
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white.opacity(0.96))
            .lineLimit(height < 36 ? 1 : 2)
            .padding(.leading, item.event.driveDuty == .pickup ? 13 : 6)
            .padding(.trailing, item.event.driveDuty == .pickup ? 4 : 13)
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: height < 36 ? .leading : .topLeading)
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

/// Someone else's event the member is going to, with their drives there and
/// back fused on as lighter ends.
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
                Avatar(member: store.board.member(item.event.memberEmail), size: 15)
                    .overlay(Circle().strokeBorder(.white.opacity(0.7), lineWidth: 1))
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(height - legTop - legBottom >= 58 ? 2 : 1)
                    if height - legTop - legBottom >= 38 {
                        Text(CalendarRules.timeRange(item.event, in: item.calendar()))
                            .font(.system(size: 10.5))
                            .opacity(0.85)
                            .lineLimit(1)
                    }
                }
                .foregroundStyle(.white.opacity(0.96))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2.5)
            .offset(y: legTop)
        }
        .clipShape(.rect(cornerRadius: 6, style: .continuous))
    }
}

/// Week: someone else's event as a thin line in their lane. Solid for their
/// own; hollow when they're going along to someone else's. The pointer over
/// it says what it is, a click opens it.
private struct FamilyLine: View {
    let block: DayBlock
    let day: Day
    let member: Member
    /// Where the lane starts in the day, and in the grid.
    let x: CGFloat
    let gridX: CGFloat
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let window = model.window
        let item = block.item
        let anchor = GridAnchor.line(day, member.email, item.id)
        // The event itself, not the drives either side of it.
        let (from, to): (Int, Int) = {
            if case .attending(let start, let end) = block.kind { return (start, end) }
            return (block.start, block.end)
        }()
        let top = GridMetrics.y(from)
        let height = max(GridMetrics.y(to) - top, 8) - 1.5
        let color = CalendarStyle.muted(member.color)
        let hot = window.peek?.item.id == item.id || (window.card?.itemID == item.id && window.cardAnchor == anchor)
        let attending: Bool = { if case .attending = block.kind { true } else { false } }()
        Group {
            if attending {
                Capsule().strokeBorder(color.opacity(0.85), lineWidth: 1)
            } else {
                Capsule().fill(color)
            }
        }
        .frame(width: hot ? 5 : 3, height: height)
        .frame(width: MacStyle.lane, height: height)
        .contentShape(.rect)
        .onHover { inside in
            if inside {
                window.peek = Peek(item: item, x: gridX, y: top)
            } else if window.peek?.item.id == item.id {
                window.peek = nil
            }
        }
        .onTapGesture { window.open(item, anchor: anchor, in: store) }
        .popover(item: Binding(
            get: { window.cardAnchor == anchor ? window.card : nil },
            set: { if $0 == nil, window.cardAnchor == anchor { window.closeCard() } }
        ), attachmentAnchor: .rect(.bounds), arrowEdge: .trailing) { card in
            EventPopover(request: card)
        }
        .contextMenu { HideMenu(item: item) { window.report($0) } }
        .opacity(item.hidden ? 0.5 : 1)
        .offset(x: x, y: top)
        .animation(.snappy(duration: 0.15), value: hot)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(member.firstName): \(item.title), \(CalendarRules.timeRange(item.event, in: item.calendar()))")
        .accessibilityAddTraits(.isButton)
    }
}

/// Day: someone else's event as a pin in their column, their face at its
/// start; fainter, with a ring for a face, when they're only going along.
private struct FamilyPin: View {
    let block: DayBlock
    let day: Day
    let member: Member
    let x: CGFloat
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let window = model.window
        let item = block.item
        let anchor = GridAnchor.line(day, member.email, item.id)
        let top = GridMetrics.y(block.start)
        let height = max(GridMetrics.y(block.end) - top, 12)
        let attending: Bool = { if case .attending = block.kind { true } else { false } }()
        let (coreTop, coreHeight): (CGFloat, CGFloat) = {
            if case .attending(let eventStart, let eventEnd) = block.kind {
                return (GridMetrics.y(eventStart) - top, max(GridMetrics.y(eventEnd) - GridMetrics.y(eventStart), 2))
            }
            return (0, height)
        }()
        let color = CalendarStyle.muted(item.color)
        ZStack(alignment: .top) {
            if attending {
                Capsule().fill(color.opacity(0.18)).frame(width: 2.5, height: height)
                Capsule().fill(color.opacity(0.45)).frame(width: 2.5, height: coreHeight).offset(y: coreTop)
                Circle()
                    .fill(CalendarStyle.ground)
                    .overlay(Circle().strokeBorder(color.opacity(0.75), lineWidth: 2))
                    .frame(width: 9, height: 9)
                    .offset(y: coreTop - 4.5)
            } else {
                Capsule().fill(color).frame(width: 2.5, height: height)
                Avatar(member: store.board.member(item.event.memberEmail), size: 22)
                    .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1.5))
                    .offset(y: -11)
            }
        }
        .frame(width: MacStyle.pinColumn, height: height, alignment: .top)
        .contentShape(.rect)
        .onTapGesture { window.open(item, anchor: anchor, in: store) }
        .popover(item: Binding(
            get: { window.cardAnchor == anchor ? window.card : nil },
            set: { if $0 == nil, window.cardAnchor == anchor { window.closeCard() } }
        ), attachmentAnchor: .rect(.bounds), arrowEdge: .trailing) { card in
            EventPopover(request: card)
        }
        .contextMenu { HideMenu(item: item) { window.report($0) } }
        .help("\(item.title), \(CalendarRules.timeRange(item.event, in: item.calendar()))")
        .opacity(item.hidden ? 0.5 : 1)
        .offset(x: x, y: top)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(member.firstName): \(item.title), \(CalendarRules.timeRange(item.event, in: item.calendar()))")
        .accessibilityAddTraits(.isButton)
    }
}

/// Day: the names of the family's events, beside their pins, where there's
/// room. One label for the same thing at the same time; a label that would
/// sit on another moves down.
private struct PinLabels: View {
    let layout: DayLayout
    let x: CGFloat
    let width: CGFloat
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    private struct Entry: Identifiable {
        var item: EventItem
        var start: Int
        var y: CGFloat
        var id: UUID { item.id }
    }

    private var entries: [Entry] {
        var seen = Set<String>()
        var out: [Entry] = []
        let blocks = layout.columns.dropFirst()
            .flatMap(\.blocks)
            .filter { $0.kind == .own }
            .sorted { ($0.start, $0.item.title) < ($1.start, $1.item.title) }
        var floor: CGFloat = -100
        for block in blocks {
            guard seen.insert("\(block.start)|\(block.item.title.lowercased())").inserted else { continue }
            let y = max(GridMetrics.y(block.start) - 8, floor)
            floor = y + 17
            out.append(Entry(item: block.item, start: block.start, y: y))
        }
        return out
    }

    var body: some View {
        if width >= 120 {
            let window = model.window
            ForEach(entries) { entry in
                let item = entry.item
                Button {
                    window.open(item, anchor: GridAnchor.card(layout.day, item.id), in: store)
                } label: {
                    Text("\(Text(CalendarRules.shortClock(item.event.start, in: item.calendar())).foregroundStyle(CalendarStyle.ink(item.color).opacity(0.6)))  \(Text(item.title).foregroundStyle(CalendarStyle.ink(item.color)))")
                        .font(.system(size: 11.5))
                        .lineLimit(1)
                        .frame(width: width, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .popover(item: Binding(
                    get: { window.cardAnchor == GridAnchor.card(layout.day, item.id) ? window.card : nil },
                    set: { if $0 == nil, window.cardAnchor == GridAnchor.card(layout.day, item.id) { window.closeCard() } }
                ), attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) { card in
                    EventPopover(request: card)
                }
                .opacity(item.hidden ? 0.5 : 1)
                .offset(x: x, y: entry.y)
            }
        }
    }
}

/// Where a new event is being drawn, or a moved one will land.
private struct GhostBlock: View {
    let drag: GridDrag
    let title: String?
    let color: String

    var body: some View {
        let ink = CalendarStyle.ink(color)
        VStack(alignment: .leading, spacing: 0) {
            Text(title ?? "New event")
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
            Text("\(clock(drag.start)) – \(clock(drag.end))")
                .font(.system(size: 10.5, design: .rounded))
                .opacity(0.8)
        }
        .foregroundStyle(ink)
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(CalendarStyle.wash(color, 0.34), in: .rect(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(CalendarStyle.muted(color), style: StrokeStyle(lineWidth: 1.2, dash: [4, 3])))
        .clipped()
    }

    private func clock(_ minutes: Int) -> String {
        let h = minutes / 60 % 24
        return String(format: "%d:%02d %@", h % 12 == 0 ? 12 : h % 12, minutes % 60, h < 12 ? "AM" : "PM")
    }
}

/// The pointer is over someone else's event: who, what and when.
private struct PeekBubble: View {
    let item: EventItem
    @Environment(CalendarStore.self) private var store

    var body: some View {
        HStack(spacing: 8) {
            Avatar(member: store.board.member(store.board.opened(item).event.memberEmail), size: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.system(size: 12.5, weight: .semibold))
                    .lineLimit(1)
                Text(CalendarRules.timeRange(item.event, in: item.calendar()))
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(width: 238, alignment: .leading)
        .paperGlass(14)
    }
}

/// Now, as a line across today.
private struct NowLine: View {
    let minutes: Int

    var body: some View {
        HStack(spacing: 0) {
            Circle().fill(CalendarStyle.now).frame(width: 7, height: 7)
            Rectangle().fill(CalendarStyle.now).frame(height: 1.2)
        }
        .offset(y: GridMetrics.y(minutes) - 3.5)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The top of the grid: each day's name and date (a click goes to that day),
/// the trip's time on a day away, and the day's all-day events.
private struct GridHeader: View {
    let days: [Day]
    let layouts: [DayLayout]
    let others: [Member]
    let metrics: GridMetrics
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let today = Day.today()
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 0) {
                Color.clear.frame(width: MacStyle.gutter, height: 1)
                ForEach(layouts, id: \.day) { layout in
                    title(layout.day, today: today)
                        .frame(width: metrics.dayWidth, alignment: .topLeading)
                }
            }
            // A trip's band runs across its days, over the all-day events.
            TripBands(days: days, metrics: metrics)
            HStack(alignment: .top, spacing: 0) {
                Color.clear.frame(width: MacStyle.gutter, height: 1)
                ForEach(layouts, id: \.day) { layout in
                    VStack(alignment: .leading, spacing: 4) { allDay(layout) }
                        .frame(width: metrics.dayWidth, alignment: .topLeading)
                }
            }
            .padding(.bottom, 6)
        }
        .padding(.top, 6)
    }

    @ViewBuilder
    private func title(_ day: Day, today: Day) -> some View {
        let isToday = day == today
        let date = day.at(minutes: 12 * 60)
        HStack(alignment: .center, spacing: 6) {
            Button {
                model.window.day = day
                if metrics.style == .week { model.prefs.view = .day }
            } label: {
                HStack(spacing: 6) {
                    Text(date.formatted(.dateTime.weekday(metrics.style == .day ? .wide : .abbreviated)))
                        .font(.system(size: metrics.style == .day ? 20 : 12, weight: .semibold, design: metrics.style == .day ? .serif : .default))
                        .foregroundStyle(isToday ? CalendarStyle.accent : metrics.style == .day ? .primary : .secondary)
                    Text("\(day.day)")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(isToday ? .white : .primary)
                        .frame(minWidth: 24, minHeight: 24)
                        .background { if isToday { Circle().fill(CalendarStyle.olive) } }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .allowsHitTesting(metrics.style == .week)
            .help(metrics.style == .week ? "Show this day" : "")
            // A day away from home says whose time it's in; a week's column
            // has room for the place alone.
            if let note = store.board.zoneNote(on: day), let place = store.board.zonePlace(on: day) {
                Label(metrics.style == .week ? place : note, systemImage: "globe.americas.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(CalendarStyle.accent)
                    .lineLimit(1)
                    .help("Times shown in \(note)")
            }
            Spacer(minLength: 0)
            // Day: whose pins are whose.
            if metrics.style == .day {
                Color.clear.frame(width: 0, height: 24)
                    .overlay(alignment: .leading) {
                        HStack(spacing: 0) {
                            ForEach(others) { member in
                                Avatar(member: member, size: 22)
                                    .frame(width: MacStyle.pinColumn)
                                    .help(member.firstName)
                            }
                        }
                        .fixedSize()
                        .offset(x: metrics.pinX(0) - metrics.dayWidth + 8)
                    }
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 8)
        .frame(height: 28)
    }

    /// The day's all-day events as chips: the member's own filled, the rest
    /// of the family's outlined.
    @ViewBuilder
    private func allDay(_ layout: DayLayout) -> some View {
        let window = model.window
        let items = layout.columns.flatMap(\.allDay)
        let width = (metrics.style == .week ? metrics.dayWidth : metrics.cardsWidth) - 6
        ForEach(items.prefix(4)) { item in
            let anchor = GridAnchor.allDay(layout.day, item.id)
            Button {
                window.open(item, anchor: anchor, in: store)
            } label: {
                Text(item.title)
                    .font(.system(size: 11, weight: item.involved ? .semibold : .regular))
                    .foregroundStyle(CalendarStyle.ink(item.color))
                    .lineLimit(1)
                    .padding(.horizontal, 6)
                    .frame(width: width, height: 18, alignment: .leading)
                    .background(CalendarStyle.wash(item.color, item.involved ? 0.26 : 0.1), in: .rect(cornerRadius: 5, style: .continuous))
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .popover(item: Binding(
                get: { window.cardAnchor == anchor ? window.card : nil },
                set: { if $0 == nil, window.cardAnchor == anchor { window.closeCard() } }
            ), attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) { card in
                EventPopover(request: card)
            }
            .contextMenu { HideMenu(item: item) { window.report($0) } }
            .opacity(item.hidden ? 0.5 : 1)
            .padding(.leading, 3)
        }
        if items.count > 4 {
            Text("+\(items.count - 4) more")
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
                .padding(.leading, 9)
        }
    }
}

/// The time the views take as now. A debug build can be told another
/// (`--now 14:45`), to look at a day partway through.
enum Clock {
    static func now(_ real: Date = Date()) -> Date {
        #if DEBUG
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--now"), args.count > at + 1 {
            let parts = args[at + 1].split(separator: ":").compactMap { Int($0) }
            if parts.count == 2 { return Day(real).at(minutes: parts[0] * 60 + parts[1]) }
        }
        #endif
        return real
    }
}
