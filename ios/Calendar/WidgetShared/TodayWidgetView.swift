import SwiftUI
import UIKit
import WidgetKit

/// Today as the large home screen widget shows it: the Day view in small. The
/// member whose phone it is gets the wide column with their events as cards;
/// the rest of the family are pin lines beside it, so a glance says what
/// you're doing and where everyone else is. Eight hours are in view, starting
/// an hour before now.
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

    /// Whether anything is on in the hours in view.
    var isQuiet: Bool {
        let window = (firstHour * 60)..<((firstHour + Self.hoursShown) * 60)
        return !layout.columns.contains { $0.blocks.contains { $0.start < window.upperBound && $0.end > window.lowerBound } }
    }

    init(snapshot: CalendarSnapshot, me: String?, photos: [String: Data], now: Date, in calendar: Calendar = .current) {
        self.now = now
        self.photos = photos
        day = Day(now, in: calendar)
        let board = Board.build(snapshot, me: me, in: calendar)
        let shown = CalendarShared.shown(board.members)
        layout = DayLayout.build(day: day, board: board, shown: shown, me: me, showHidden: false, in: calendar)
        let emails = Set(shown.map(\.email))
        allDay = board.events(on: day, showHidden: false).filter { $0.event.allDay && emails.contains($0.event.memberEmail) }
        members = Dictionary(board.members.map { ($0.email, $0) }, uniquingKeysWith: { a, _ in a })
        nowMinutes = CalendarRules.minutes(now, in: board.calendar(on: day, in: calendar))
        firstHour = min(max(nowMinutes / 60 - 1, 0), 24 - Self.hoursShown)
    }
}

struct TodayWidgetView: View {
    let model: TodayWidgetModel?

    private static let weekdays = Calendar.current.weekdaySymbols
    private static let months = Calendar.current.monthSymbols
    private static let gutter: CGFloat = 34
    private static let narrow: CGFloat = 26

    var body: some View {
        if let model {
            VStack(alignment: .leading, spacing: 6) {
                header(model)
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

    private func header(_ model: TodayWidgetModel) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(Self.weekdays[(model.day.weekdayIndex() + 1) % 7].uppercased())
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .tracking(0.8)
                    .foregroundStyle(CalendarStyle.accent)
                    .widgetAccentable()
                Text("\(Self.months[model.day.month - 1]) \(model.day.day)")
                    .font(.system(size: 19, weight: .semibold, design: .serif))
            }
            .fixedSize()
            Spacer(minLength: 4)
            HStack(spacing: 4) {
                ForEach(model.allDay.prefix(2)) { item in
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
                if model.allDay.count > 2 {
                    Text("+\(model.allDay.count - 2)")
                        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
        }
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
