import SwiftUI
import UIKit
import WidgetKit

/// Today as the large home screen widget shows it. With the app's "time
/// between" setting on (it is unless switched off) that's a list: the
/// member's own events from now on and the time between them (`Rundown`),
/// tomorrow's once nothing is left today. With it off it's the Day view in
/// small: the member whose phone it is gets the wide column with their events
/// as cards; the rest of the family are pin lines beside it. Eight hours are
/// in view, starting an hour before now.
struct TodayWidgetModel {
    static let hoursShown = 8

    var now: Date
    var day: Day
    var layout: DayLayout
    var allDay: [EventItem]
    var members: [String: Member]
    var photos: [String: Data]
    /// The first hour on the axis.
    var firstHour: Int

    /// Now on the axis, which on a day away is in the trip's time.
    var nowMinutes: Int
    /// The day as a list of the member's stops and the time between; nil when
    /// the setting's off, and the grid is shown.
    var rundown: Rundown?

    /// Whether anything is on in the hours in view.
    var isQuiet: Bool {
        let window = (firstHour * 60)..<((firstHour + Self.hoursShown) * 60)
        return !layout.columns.contains { $0.blocks.contains { $0.start < window.upperBound && $0.end > window.lowerBound } }
    }

    init(snapshot: CalendarSnapshot, me: String?, photos: [String: Data], now: Date, in calendar: Calendar = .current) {
        self.init(board: Board.build(snapshot, me: me, in: calendar), me: me, photos: photos, now: now, in: calendar)
    }

    /// From a board already built, which is most of the work: the widget
    /// makes one of these for every minute ahead from the one board.
    init(board: Board, me: String?, photos: [String: Data], now: Date, in calendar: Calendar = .current) {
        self.now = now
        self.photos = photos
        day = Day(now, in: calendar)
        let shown = CalendarShared.shown(board.members)
        layout = DayLayout.build(day: day, board: board, shown: shown, me: me, showHidden: false, in: calendar)
        let emails = Set(shown.map(\.email))
        allDay = board.events(on: day, showHidden: false).filter { $0.event.allDay && emails.contains($0.event.memberEmail) }
        members = Dictionary(board.members.map { ($0.email, $0) }, uniquingKeysWith: { a, _ in a })
        nowMinutes = CalendarRules.minutes(now, in: board.calendar(on: day, in: calendar))
        firstHour = min(max(nowMinutes / 60 - 1, 0), 24 - Self.hoursShown)
        if CalendarShared.timeBetween() {
            let agenda = Agenda.build(board: board, me: me, shown: shown, showHidden: false, now: now, in: calendar)
            rundown = Rundown.build(agenda, board: board, me: me, now: now, in: calendar)
        }
    }

    /// When the list next reads differently: a stop starting or ending.
    func turns(until end: Date) -> [Date] {
        (rundown?.parts ?? []).flatMap { [$0.start, $0.end] }.compactMap { $0 }.filter { $0 > now && $0 < end }
    }
}

struct TodayWidgetView: View {
    let model: TodayWidgetModel?

    private static let weekdays = Calendar.current.weekdaySymbols
    private static let months = Calendar.current.monthSymbols
    private static let gutter: CGFloat = 34
    private static let narrow: CGFloat = 26

    var body: some View {
        if let model, let rundown = model.rundown {
            VStack(alignment: .leading, spacing: 6) {
                header(model, day: rundown.agenda.day, allDay: rundown.agenda.allDay.map(\.item))
                list(model, rundown)
            }
        } else if let model {
            VStack(alignment: .leading, spacing: 6) {
                header(model, day: model.day, allDay: model.allDay)
                grid(model)
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "calendar")
                    .font(.system(size: 34))
                    .foregroundStyle(CalendarStyle.accent)
                Text("Open Calendar to sign in")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: The date, and the all-day events

    private func header(_ model: TodayWidgetModel, day: Day, allDay: [EventItem]) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                // Tomorrow, once nothing is left today, says so.
                Text(day == model.day ? Self.weekdays[(day.weekdayIndex() + 1) % 7].uppercased() : "TOMORROW")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .tracking(0.8)
                    .foregroundStyle(CalendarStyle.accent)
                    .widgetAccentable()
                Text("\(Self.months[day.month - 1]) \(day.day)")
                    .font(.system(size: 19, weight: .semibold, design: .serif))
            }
            .fixedSize()
            Spacer(minLength: 4)
            HStack(spacing: 4) {
                ForEach(allDay.prefix(2)) { item in
                    HStack(spacing: 4) {
                        Face(member: model.members[item.event.memberEmail], data: model.photos[item.event.memberEmail], size: 13)
                        Text(item.title)
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(CalendarStyle.ink(item.color))
                            .lineLimit(1)
                    }
                    .padding(.leading, 3)
                    .padding(.trailing, 7)
                    .padding(.vertical, 3)
                    .background(CalendarStyle.wash(item.color, 0.3), in: .capsule)
                }
                if allDay.count > 2 {
                    Text("+\(allDay.count - 2)")
                        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: The list

    /// One line of the list, and how tall it is.
    private enum Line: Identifiable {
        case stop(Rundown.Part, detail: String?)
        /// `listed`: the family's events follow on lines of their own, so
        /// they're not named here.
        case gap(Rundown.Part, lead: String?, clock: Bool, listed: Bool)
        /// Someone else's event on a line of its own.
        case family(Agenda.Row, in: String)

        var id: String {
            switch self {
            case .stop(let part, _), .gap(let part, _, _, _): part.id
            case .family(let row, let part): "family-\(part)-\(row.id)"
            }
        }

        var height: CGFloat {
            switch self {
            case .stop(let part, let detail): (detail == nil ? 25 : 38) + (part.phase == .now ? 18 : 0)
            case .gap(let part, _, _, _): part.phase == .now ? 30 : 22
            case .family: 21
            }
        }
    }

    private static let listTime: CGFloat = 46
    private static let live = CalendarStyle.accent

    /// The day from now on, as lines. A widget can't be scrolled or tapped
    /// open, so what's over is left off; `open` lists the family's events
    /// under each gap, for when there's the room, where otherwise the gap's
    /// own line names them.
    private func lines(_ day: Rundown, open: Bool) -> [Line] {
        let anyStops = day.parts.contains { $0.kind == .stop }
        let isLive = day.parts.contains { $0.phase == .now }
        var lines: [Line] = []
        for part in day.parts where !isLive || part.phase != .over {
            switch part.kind {
            case .stop:
                guard let row = part.row else { continue }
                let clock = row.item.calendar()
                let detail: String? = if let leg = part.leg {
                    leg.note
                } else if let leave = row.leaves[.dropoff] {
                    "Leave \(Self.compact(leave, in: clock))"
                } else {
                    CalendarRules.whereLine(row.item.event)?.text
                }
                lines.append(.stop(part, detail: detail))
                // The family's, wholly inside it.
                if !part.others.isEmpty {
                    if open {
                        lines += part.others.map { .family($0, in: part.id) }
                    } else {
                        lines.append(.gap(part, lead: nil, clock: false, listed: false))
                    }
                }
            case .gap:
                let isNow = part.phase == .now
                // How long is left of it, as of this entry: the widget has an
                // entry for every minute (see TodayProvider), so it keeps count.
                let lead: String? = if isNow {
                    part.end.map { "\(Rundown.length($0.timeIntervalSince(day.now))) free" } ?? (anyStops ? "Done for today" : nil)
                } else if let length = part.length {
                    Rundown.length(length)
                } else if anyStops {
                    part.start == nil ? "Before" : "Later"
                } else {
                    nil
                }
                let listed = open || !anyStops
                if lead != nil || (!listed && !part.others.isEmpty) {
                    lines.append(.gap(part, lead: lead, clock: part.end != nil && (isNow || part.length != nil), listed: listed))
                }
                if listed { lines += part.others.map { .family($0, in: part.id) } }
            }
        }
        return lines
    }

    /// "8am", "1:35pm".
    private static func compact(_ date: Date, in calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        let h = c.hour ?? 0
        let hour = h % 12 == 0 ? 12 : h % 12
        return (c.minute ?? 0) == 0 ? "\(hour)\(h < 12 ? "am" : "pm")" : String(format: "%d:%02d%@", hour, c.minute ?? 0, h < 12 ? "am" : "pm")
    }

    private func list(_ model: TodayWidgetModel, _ day: Rundown) -> some View {
        GeometryReader { geo in
            // The family's events on lines of their own if all of that fits;
            // if not, named on the gaps' lines.
            let room = geo.size.height - (day.agenda.upcoming ? 16 : 0)
            let opened = lines(day, open: true)
            let all = opened.reduce(0) { $0 + $1.height } <= room ? opened : lines(day, open: false)
            // As many as fit, with room kept for saying there are more.
            let fits: Int = {
                var used: CGFloat = 0
                for (index, line) in all.enumerated() {
                    used += line.height
                    let more = index < all.count - 1
                    if used + (more ? 16 : 0) > room { return index }
                }
                return all.count
            }()
            VStack(alignment: .leading, spacing: 0) {
                if day.agenda.upcoming {
                    Text("Nothing more today")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(.tertiary)
                        .padding(.leading, Self.listTime + 14)
                        .frame(height: 16)
                }
                if all.isEmpty {
                    Text("Nothing on")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                ForEach(all.prefix(fits)) { line in
                    self.line(line, model, day)
                        .frame(height: line.height - 3)
                        .padding(.bottom, 3)
                }
                if fits < all.count {
                    Text("+\(all.count - fits) more")
                        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .padding(.leading, Self.listTime + 14)
                        .frame(height: 16)
                }
                Spacer(minLength: 0)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
    }

    @ViewBuilder
    private func line(_ line: Line, _ model: TodayWidgetModel, _ day: Rundown) -> some View {
        switch line {
        case .stop(let part, let detail):
            if let row = part.row { stop(part, row, detail, model) }
        case .gap(let part, let lead, let clock, let listed):
            let isNow = part.phase == .now && part.kind == .gap
            let head = Text(lead ?? "")
                .font(isNow ? .system(size: 12.5, weight: .semibold) : .system(size: 10.5, weight: .medium, design: .rounded))
                .foregroundStyle(isNow ? AnyShapeStyle(Self.live) : AnyShapeStyle(.secondary))
            let tail = Text(listed || part.others.isEmpty ? "" : "\(lead == nil ? "" : "  ")(\(summary(part.others, model)))")
                .font(.system(size: 10.5))
                .foregroundStyle(.tertiary)
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Color.clear.frame(width: Self.listTime, height: 1)
                Group {
                    if clock {
                        Image(systemName: "clock")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(isNow ? AnyShapeStyle(Self.live) : AnyShapeStyle(.tertiary))
                    } else {
                        Color.clear.frame(height: 1)
                    }
                }
                .frame(width: 3)
                Text("\(head)\(tail)").lineLimit(1)
                Spacer(minLength: 0)
            }
            .frame(maxHeight: .infinity)
            .background {
                if isNow { RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Self.live.opacity(0.11)).padding(.horizontal, -4) }
            }
        case .family(let row, _):
            // No time down the left: that column is the member's own.
            let title = Text(row.item.title)
                .foregroundStyle(row.over ? AnyShapeStyle(.tertiary) : AnyShapeStyle(CalendarStyle.ink(row.item.color)))
            let time = Text("  (\(Self.compact(row.item.event.start, in: row.item.calendar())))")
                .font(.system(size: 9.5, design: .rounded))
                .foregroundStyle(.tertiary)
            Link(destination: URL(string: "io.mason.calendar://event/\(row.item.id.uuidString.lowercased())")!) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Color.clear.frame(width: Self.listTime, height: 1)
                    Color.clear.frame(width: 3, height: 1)
                    Text("\(title)\(time)")
                        .font(.system(size: 11.5))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    faces(row.people, model, size: 14)
                }
                .frame(maxHeight: .infinity)
            }
            .buttonStyle(.plain)
        }
    }

    /// One of the member's own: when down the left, a bar of whose it is, the
    /// words and where (or when to leave), and who else is in it. The one
    /// they're in now shows how far through it they are, and when it ends.
    private func stop(_ part: Rundown.Part, _ row: Agenda.Row, _ detail: String?, _ model: TodayWidgetModel) -> some View {
        let item = row.item
        let clock = item.calendar()
        let isNow = part.phase == .now
        return Link(destination: URL(string: "io.mason.calendar://event/\(item.id.uuidString.lowercased())")!) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .top, spacing: 7) {
                    Text(Self.compact(part.leg?.start ?? item.event.start, in: clock))
                        .font(.system(size: 10.5, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .frame(width: Self.listTime, alignment: .trailing)
                        .padding(.top, 1.5)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(CalendarStyle.muted(item.color))
                        .frame(width: 3, height: detail == nil ? 17 : 29)
                        .widgetAccentable()
                    VStack(alignment: .leading, spacing: 0.5) {
                        HStack(spacing: 4) {
                            if part.leg != nil {
                                Image(systemName: "car.fill").font(.system(size: 9)).foregroundStyle(.secondary)
                            }
                            Text(part.leg?.title ?? item.title)
                                .font(.system(size: 12.5, weight: .semibold))
                                .lineLimit(1)
                            if item.conflict {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 8))
                                    .foregroundStyle(CalendarStyle.amber)
                            }
                        }
                        if let detail {
                            Text(detail)
                                .font(.system(size: 10.5))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 2)
                    faces(row.people, model, size: 16)
                }
                if isNow, let start = part.start, let end = part.end {
                    HStack(spacing: 7) {
                        Color.clear.frame(width: Self.listTime, height: 1)
                        Color.clear.frame(width: 3, height: 1)
                        // Fills by itself as the time passes, between redraws.
                        ProgressView(timerInterval: start...end, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                            .progressViewStyle(.linear)
                            .tint(Self.live)
                        Text("until \(Self.compact(end, in: clock))")
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundStyle(Self.live)
                            .fixedSize()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background {
                if isNow { RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Self.live.opacity(0.11)).padding(.horizontal, -4) }
            }
        }
        // A link's words take its tint unless it's plain.
        .buttonStyle(.plain)
    }

    private func faces(_ emails: [String], _ model: TodayWidgetModel, size: CGFloat) -> some View {
        HStack(spacing: -size * 0.3) {
            ForEach(emails.prefix(3), id: \.self) { email in
                Face(member: model.members[email], data: model.photos[email], size: size)
                    .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1))
            }
        }
    }

    /// "J: Surfing, S+O: School": whose, by first letter, and what.
    private func summary(_ rows: [Agenda.Row], _ model: TodayWidgetModel) -> String {
        rows.map { row in
            let who = row.people.compactMap { model.members[$0]?.initial }.joined(separator: "+")
            return who.isEmpty ? row.item.event.title : "\(who): \(row.item.event.title)"
        }
        .joined(separator: ", ")
    }

    // MARK: The hours

    private func grid(_ model: TodayWidgetModel) -> some View {
        GeometryReader { geo in
            let hour = geo.size.height / CGFloat(TodayWidgetModel.hoursShown)
            let origin = model.firstHour * 60
            let y: (Int) -> CGFloat = { CGFloat($0 - origin) / 60 * hour }
            let columns = model.layout.columns
            let narrow = columns.count > 1 ? min(Self.narrow, (geo.size.width - Self.gutter) / CGFloat(columns.count + 2)) : 0
            let wide = geo.size.width - Self.gutter - narrow * CGFloat(max(columns.count - 1, 0))

            ZStack(alignment: .topLeading) {
                // The signed-in member's column, faintly their own colour.
                if let mine = columns.first {
                    Rectangle()
                        .fill(CalendarStyle.muted(mine.member.color).opacity(0.05))
                        .frame(width: wide)
                        .offset(x: Self.gutter)
                }
                ForEach(0..<TodayWidgetModel.hoursShown, id: \.self) { index in
                    Rectangle()
                        .fill(CalendarStyle.line)
                        .frame(height: 0.5)
                        .padding(.leading, Self.gutter)
                        .offset(y: CGFloat(index) * hour)
                    Text(Self.hourLabel(model.firstHour + index))
                        .font(.system(size: 9, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .frame(width: Self.gutter - 6, alignment: .trailing)
                        .offset(y: CGFloat(index) * hour + 2)
                }

                ForEach(Array(columns.enumerated()), id: \.element.id) { index, column in
                    let x = Self.gutter + (index == 0 ? 0 : wide + narrow * CGFloat(index - 1))
                    ZStack(alignment: .topLeading) {
                        ForEach(column.blocks) { block in
                            if index == 0 {
                                card(block, model, width: wide, y: y)
                            } else if block.kind != .drive {
                                pin(block, model, width: narrow, y: y)
                            }
                        }
                    }
                    .frame(width: index == 0 ? wide : narrow, height: geo.size.height, alignment: .topLeading)
                    .offset(x: x)
                }

                if model.isQuiet {
                    Text(model.firstHour + TodayWidgetModel.hoursShown >= 24 ? "Nothing more today" : "Nothing on for a while")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: wide, height: geo.size.height)
                        .offset(x: Self.gutter)
                }

                // Now.
                let now = y(model.nowMinutes)
                Rectangle()
                    .fill(CalendarStyle.now)
                    .frame(height: 1.5)
                    .padding(.leading, Self.gutter)
                    .offset(y: now - 0.75)
                Circle()
                    .fill(CalendarStyle.now)
                    .frame(width: 7, height: 7)
                    .offset(x: Self.gutter - 3.5, y: now - 3.5)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .clipped()
        }
    }

    /// "3 PM"; noon and midnight by number, to stay narrow.
    private static func hourLabel(_ hour: Int) -> String {
        let h = hour % 24
        return "\(h % 12 == 0 ? 12 : h % 12) \(h < 12 ? "AM" : "PM")"
    }

    // MARK: The wide column

    @ViewBuilder
    private func card(_ block: DayBlock, _ model: TodayWidgetModel, width: CGFloat, y: (Int) -> CGFloat) -> some View {
        let lane = (width - 3) / CGFloat(block.lanes)
        let top = y(block.start)
        let height = max(y(block.end) - top, 15) - 1.5
        let item = block.item
        let over = block.end <= model.nowMinutes
        Link(destination: URL(string: "io.mason.calendar://event/\(item.id.uuidString.lowercased())")!) {
            Group {
                switch block.kind {
                case .own:
                    HStack(alignment: .top, spacing: 0) {
                        Rectangle().fill(CalendarStyle.muted(item.color)).frame(width: 3).widgetAccentable()
                        words(item, height: height, color: CalendarStyle.ink(item.color))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(CalendarStyle.wash(item.color))
                    .clipShape(.rect(cornerRadius: 6, style: .continuous))
                case .drive:
                    Text(Self.short(item.event.title))
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.96))
                        .lineLimit(1)
                        .padding(.leading, item.event.driveDuty == .pickup ? 12 : 6)
                        .padding(.trailing, item.event.driveDuty == .pickup ? 4 : 12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                        .background(CalendarStyle.muted(item.color), in: DriveArrow(duty: item.event.driveDuty ?? .dropoff, depth: 7))
                case .attending:
                    HStack(alignment: .top, spacing: 0) {
                        Face(member: model.members[item.event.memberEmail], data: model.photos[item.event.memberEmail], size: 14)
                            .overlay(Circle().strokeBorder(.white.opacity(0.7), lineWidth: 1))
                            .padding(.leading, 4)
                            .padding(.top, 3)
                        words(item, height: height, color: .white.opacity(0.96))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(CalendarStyle.muted(item.color))
                    .clipShape(.rect(cornerRadius: 6, style: .continuous))
                }
            }
            .frame(width: max(lane - 2, 4), height: height, alignment: .topLeading)
        }
        .opacity(over ? 0.55 : 1)
        .offset(x: 1.5 + lane * CGFloat(block.lane), y: top)
    }

    private func words(_ item: EventItem, height: CGFloat, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 3) {
                Text(item.title)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(height >= 52 ? 2 : 1)
                if item.conflict {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(CalendarStyle.amber)
                }
            }
            if height >= 30 {
                Text(CalendarRules.timeRange(item.event, in: item.calendar()))
                    .font(.system(size: 9.5))
                    .opacity(0.75)
                    .lineLimit(1)
            }
            if height >= 64, let place = CalendarRules.whereLine(item.event) {
                Text(place.text)
                    .font(.system(size: 9.5))
                    .opacity(0.65)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(color)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
    }

    /// "Drop off Sebastian" from "Drop off Sebastian @ 4:30pm (18 min drive)".
    private static func short(_ title: String) -> String {
        guard let at = title.firstIndex(of: "@") else { return title }
        return String(title[..<at]).trimmingCharacters(in: .whitespaces)
    }

    // MARK: The family

    /// Someone else's event: a line down their column with their face at its
    /// start. One they're only going along to is fainter, with a ring.
    @ViewBuilder
    private func pin(_ block: DayBlock, _ model: TodayWidgetModel, width: CGFloat, y: (Int) -> CGFloat) -> some View {
        let attending: Bool = { if case .attending = block.kind { true } else { false } }()
        let (start, end): (Int, Int) = {
            if case .attending(let eventStart, let eventEnd) = block.kind { return (eventStart, eventEnd) }
            return (block.start, block.end)
        }()
        let top = y(start)
        let height = max(y(end) - top, 8)
        let color = CalendarStyle.muted(block.item.color)
        ZStack(alignment: .top) {
            Capsule()
                .fill(color.opacity(attending ? 0.45 : 1))
                .frame(width: 2.5, height: height)
            if attending {
                Circle()
                    .fill(CalendarStyle.ground)
                    .overlay(Circle().strokeBorder(color.opacity(0.75), lineWidth: 1.5))
                    .frame(width: 8, height: 8)
                    .offset(y: -4)
            } else {
                Face(member: model.members[block.item.event.memberEmail], data: model.photos[block.item.event.memberEmail], size: 17)
                    .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1.5))
                    .offset(y: -8.5)
            }
        }
        .frame(width: width, height: height, alignment: .top)
        .opacity(end <= model.nowMinutes ? 0.45 : 1)
        .offset(y: top)
    }
}

/// A family member's face from their saved photo, else their initial on their
/// colour. (The app's `Avatar` reads from its store, which a widget hasn't.)
private struct Face: View {
    let member: Member?
    let data: Data?
    let size: CGFloat

    var body: some View {
        Group {
            if let data, let image = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 80, height: 80)) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ZStack {
                    CalendarStyle.muted(member?.color ?? CalendarRules.familyColor)
                    Text(member?.initial ?? "?")
                        .font(.system(size: size * 0.5, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
    }
}
