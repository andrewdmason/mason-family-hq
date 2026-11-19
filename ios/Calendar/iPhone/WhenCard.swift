import SwiftUI

/// When an event is, set: the screen the event card's time row slides over
/// to. All of it is here and nowhere else on the card: all-day, the day and
/// time it starts and ends, how it repeats and until when.
///
/// It edits the card's own draft, so there's nothing to confirm: ‹ goes back
/// to the card, whose ✓ saves the lot.
struct WhenScreen: View {
    @Binding var draft: CardDraft
    /// The calendar the times are read and set in: the trip's on a day away.
    let clock: Calendar
    /// "Costa Rica time · 2h ahead", when that's whose time this is.
    let zoneNote: String?
    /// Whether the event can repeat: one on a Google calendar.
    let canRepeat: Bool
    let back: () -> Void

    /// The picker open under its row.
    @State private var picking: Part?

    private enum Part { case startDay, startTime, endDay, endTime, until }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    row {
                        Toggle("All-day", isOn: $draft.event.allDay)
                            .tint(CalendarStyle.olive)
                            .padding(.trailing, 2)
                    }
                    divider
                    startRows
                    if !draft.event.allDay { endRows }
                    if !draft.event.allDay, let zoneNote {
                        Text(zoneNote)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(CalendarStyle.accent)
                            .padding(.bottom, 11)
                    }
                    if canRepeat {
                        divider
                        repeatRows
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .animation(.snappy, value: picking)
        .animation(.snappy, value: draft.event.allDay)
        .animation(.snappy, value: draft.repeats)
        .onChange(of: draft.event.allDay) { _, allDay in
            // An all-day event has a day and nothing else.
            if allDay, picking != .startDay, picking != .until { picking = nil }
        }
    }

    private var header: some View {
        ZStack {
            Text("Date & Time")
                .font(.headline)
            HStack {
                Button(action: back) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 44, height: 44)
                        .contentShape(.circle)
                }
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Back")
                Spacer()
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 10)
        .frame(height: 70)
    }

    private var divider: some View {
        Rectangle().fill(CalendarStyle.line).frame(height: 1)
    }

    private func row(@ViewBuilder _ content: () -> some View) -> some View {
        HStack(spacing: 8) { content() }
            .frame(minHeight: 30)
            .padding(.vertical, 9)
    }

    /// A day or a time, as a thing to tap: it opens its picker under the row.
    private func chip(_ part: Part, _ text: String) -> some View {
        Button {
            picking = picking == part ? nil : part
        } label: {
            Text(text)
                .font(.body.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(picking == part ? CalendarStyle.accent : .primary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    picking == part ? CalendarStyle.accent.opacity(0.14) : Color.primary.opacity(0.06),
                    in: .rect(cornerRadius: 9, style: .continuous)
                )
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    // MARK: Starts and ends

    @ViewBuilder
    private var startRows: some View {
        let event = draft.event
        row {
            Text(event.allDay ? "Date" : "Starts")
            Spacer()
            chip(.startDay, dayText(event.start))
            if !event.allDay { chip(.startTime, CalendarRules.clock(event.start, in: clock)) }
        }
        if picking == .startDay {
            // Another day, the same time; the event keeps its length.
            picker(DatePicker("Date", selection: Binding(
                get: { draft.event.start },
                set: { date in
                    let start = Day(date, in: clock)
                        .at(minutes: CalendarRules.minutes(draft.event.start, in: clock), in: clock)
                    CalendarRules.moveStart(&draft.event, to: start)
                }
            ), displayedComponents: .date).datePickerStyle(.graphical))
        }
        if picking == .startTime {
            // Moving the start keeps the event's length.
            picker(DatePicker("Starts", selection: Binding(
                get: { draft.event.start }, set: { CalendarRules.moveStart(&draft.event, to: $0) }
            ), displayedComponents: .hourAndMinute).datePickerStyle(.wheel))
        }
    }

    @ViewBuilder
    private var endRows: some View {
        let event = draft.event
        row {
            Text("Ends")
            Text(CalendarRules.length(from: event.start, to: event.end))
                .foregroundStyle(.secondary)
            Spacer()
            chip(.endDay, dayText(event.end))
            chip(.endTime, CalendarRules.clock(event.end, in: clock))
        }
        // An end before the start snaps to a quarter of an hour after it.
        if picking == .endDay {
            picker(DatePicker("Ends", selection: Binding(
                get: { draft.event.end }, set: { CalendarRules.moveEnd(&draft.event, to: $0) }
            ), in: Day(draft.event.start, in: clock).start(in: clock)..., displayedComponents: .date)
                .datePickerStyle(.graphical))
        }
        if picking == .endTime {
            picker(DatePicker("Ends", selection: Binding(
                get: { draft.event.end }, set: { CalendarRules.moveEnd(&draft.event, to: $0) }
            ), displayedComponents: .hourAndMinute).datePickerStyle(.wheel))
        }
    }

    /// "Thu, Nov 19", with the year when it isn't this one.
    private func dayText(_ date: Date) -> String {
        let style = Date.FormatStyle(timeZone: clock.timeZone).weekday(.abbreviated).month(.abbreviated).day()
        let sameYear = clock.isDate(date, equalTo: Date(), toGranularity: .year)
        return date.formatted(sameYear ? style : style.year())
    }

    private var monthCalendar: Calendar {
        var calendar = clock
        calendar.firstWeekday = 2
        return calendar
    }

    private func picker(_ picker: some View) -> some View {
        picker
            .labelsHidden()
            .tint(CalendarStyle.olive)
            // The wheels turn in the trip's time on a day away, and the month
            // starts its weeks on Monday, as the rest of the calendar does.
            .environment(\.timeZone, clock.timeZone)
            .environment(\.calendar, monthCalendar)
            .frame(maxWidth: .infinity)
            .transition(.opacity)
    }

    // MARK: Repeating

    /// How it repeats, and until when.
    @ViewBuilder
    private var repeatRows: some View {
        let every = draft.repeats?.every
        row {
            Text("Repeat")
            Spacer()
            Menu {
                Picker("Repeat", selection: Binding(
                    get: { every },
                    set: { choice in
                        draft.repeats = choice.map { Repeat(every: $0, until: draft.repeats?.until) }
                        if choice == nil, picking == .until { picking = nil }
                    }
                )) {
                    Text("Doesn't repeat").tag(Repeat.Every?.none)
                    ForEach(Repeat.Every.choices, id: \.self) { choice in
                        Text(CalendarRules.repeatLabel(choice)).tag(Repeat.Every?.some(choice))
                    }
                    // A rule made in Google Calendar that these can't say.
                    if let every, case .other = every {
                        Text(CalendarRules.repeatLabel(every)).tag(Repeat.Every?.some(every))
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Text(every.map(CalendarRules.repeatLabel) ?? "Never")
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 9, style: .continuous))
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.primary)
        }
        // A rule that hasn't been read can't be given an end.
        if let rule = draft.repeats, rule.every != .other("") {
            row {
                Text("Until")
                Spacer()
                if rule.until != nil {
                    Button {
                        draft.repeats?.until = nil
                        picking = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Never ends")
                }
                chip(.until, rule.until.map(WhenScreen.untilText) ?? "Never")
            }
            if picking == .until {
                picker(DatePicker("Ends", selection: Binding(
                    get: { draft.repeats?.until?.at(minutes: 12 * 60) ?? draft.event.start },
                    set: { draft.repeats?.until = Day($0) }
                ), in: draft.event.start..., displayedComponents: .date).datePickerStyle(.graphical))
            }
        }
    }

    /// "Dec 31, 2026": the last day a repeating event happens on.
    static func untilText(_ day: Day) -> String {
        day.at(minutes: 12 * 60).formatted(.dateTime.month(.abbreviated).day().year())
    }
}
