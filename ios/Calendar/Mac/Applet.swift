import SwiftUI

/// What the menubar panel holds: the applet at the right, under the menubar
/// item, and the event card beside it when one's open. The panel is clear
/// where neither is, and a click there puts it away.
struct AppletRoot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let state = model.applet
        GeometryReader { geo in
            let room = geo.size.height - AppletController.margin * 2
            HStack(alignment: .top, spacing: AppletController.gap) {
                if let card = state.card, model.ready {
                    EventCardMac(
                        request: card, me: model.me, maxHeight: room, escapes: state.escapes, leaves: state.leaves,
                        report: { state.report($0) }, close: { state.card = nil },
                        added: { show($0) }, dirty: { state.cardDirty = $0 }
                    )
                    .id(card.id)
                    .frame(width: AppletController.cardWidth)
                    .paperGlass()
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
                AppletView(room: room)
                    .frame(width: AppletController.appletWidth)
                    .paperGlass()
            }
            .padding(AppletController.margin)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .background {
                Color.clear.contentShape(.rect).onTapGesture { model.dismissApplet() }
            }
        }
        .environment(model.store)
        // The panel takes the keyboard without the app coming forward; its
        // controls shouldn't look switched off for that.
        .environment(\.controlActiveState, .key)
        .tint(CalendarStyle.accent)
        .animation(.snappy(duration: 0.25), value: state.card)
    }

    /// Show the day a new event landed on.
    private func show(_ day: Day) {
        model.applet.pick(day)
    }
}

/// The applet: a line to type a new event in, the week to pick a day from
/// (the month name drops the whole month open), and that day as a list.
struct AppletView: View {
    /// How tall it may be.
    let room: CGFloat
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store
    @FocusState private var typing: Bool
    @State private var listHeight: CGFloat = 200

    private var state: AppletState { model.applet }

    /// What the typed line says, read as it's typed.
    private var entry: QuickEntry? {
        let line = state.line.trimmingCharacters(in: .whitespaces)
        guard !line.isEmpty, model.ready else { return nil }
        let people = store.board.members.map { QuickEntry.Context.Person(name: $0.firstName, email: $0.email) }
        return QuickEntry.parse(line, QuickEntry.Context(day: state.chosen ?? .today(), people: people, me: model.me))
    }

    var body: some View {
        @Bindable var state = model.applet
        let entry = entry
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                TextField("New event", text: $state.line, prompt: Text("Lunch with Jenny fri at noon"))
                    .textFieldStyle(.plain)
                    .font(.system(size: 16))
                    .focused($typing)
                    .onSubmit { add(entry) }
                    .disabled(!model.ready)
                if !state.line.isEmpty {
                    Button {
                        state.line = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 15)
            .padding(.bottom, 11)

            if let entry {
                EntryPreview(entry: entry, me: model.me, add: { add(entry) }, details: { details(entry) })
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
                    .transition(.opacity)
            }
            Rectangle().fill(CalendarStyle.line).frame(height: 1)

            if model.ready {
                strip
                Rectangle().fill(CalendarStyle.line).frame(height: 1)
                TimelineView(.everyMinute) { time in
                    list(now: Clock.now(time.date))
                }
            } else {
                signedOut
            }
            footer
        }
        .animation(.snappy(duration: 0.2), value: entry != nil)
        .animation(.snappy(duration: 0.25), value: state.monthOpen)
        .onChange(of: state.opened, initial: true) { typing = true }
        // Back from a card, the line has the cursor again.
        .onChange(of: state.card == nil) { _, closed in if closed { typing = true } }
    }

    // MARK: The line

    /// Return: the event as read, straight onto the calendar.
    private func add(_ entry: QuickEntry?) {
        guard let entry, let me = model.me, !entry.title.isEmpty else { return }
        let draft = entry.draft(me: me)
        let state = state
        store.save(CardSave(event: nil, before: draft, after: draft)) { state.report($0) }
        state.line = ""
        state.pick(Day(entry.start))
    }

    /// The event as read, opened as a card to finish by hand.
    private func details(_ entry: QuickEntry) {
        guard let me = model.me else { return }
        state.card = CardRequest(itemID: nil, draft: entry.draft(me: me))
        state.line = ""
    }

    // MARK: The week

    private var strip: some View {
        let selected = state.chosen ?? .today()
        return VStack(spacing: 6) {
            HStack(spacing: 4) {
                Button {
                    state.monthOpen.toggle()
                } label: {
                    HStack(spacing: 5) {
                        Text(MacStyle.monthTitle(state.shownWeek))
                            .font(.system(size: 16, weight: .semibold, design: .serif))
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.secondary)
                            .rotationEffect(.degrees(state.monthOpen ? 180 : 0))
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint(state.monthOpen ? "Shows just the week" : "Shows the whole month")
                Spacer()
                if state.chosen != nil || state.shownWeek.weekStart() != Day.today().weekStart() {
                    Button("Today") { state.pick(.today()) }
                        .help("Today (⌘T)")
                    .buttonStyle(.plain)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(CalendarStyle.accent)
                    .padding(.trailing, 4)
                }
                stepper("chevron.left", -1, "Earlier")
                stepper("chevron.right", 1, "Later")
            }
            DayPicker(anchor: state.shownWeek, selected: selected, wholeMonth: state.monthOpen) { state.pick($0) }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    private func stepper(_ symbol: String, _ direction: Int, _ label: String) -> some View {
        Button {
            state.shownWeek = state.monthOpen
                ? state.shownWeek.monthStart.adding(months: direction)
                : state.shownWeek.adding(days: 7 * direction)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.secondary)
                .frame(width: 24, height: 24)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: The list

    private func list(now: Date) -> some View {
        let agenda = Agenda.build(
            board: store.board, me: model.me, shown: model.prefs.shown(store.board.members),
            showHidden: model.prefs.showHidden, chosen: state.chosen, now: now
        )
        // The experiment: the day as stops and the time between them.
        let rundown = model.prefs.gaps ? Rundown.build(agenda, board: store.board, me: model.me, now: now) : nil
        let chrome: CGFloat = (state.monthOpen ? 330 : 190) + (entry == nil ? 0 : 120)
        return ScrollView {
            AgendaList(agenda: agenda, rundown: rundown, now: now, open: open, report: { state.report($0) }, openID: state.card?.itemID)
                .padding(.bottom, 8)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { listHeight = $0 }
        }
        .scrollIndicators(.never)
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: min(listHeight, max(140, room - chrome)))
    }

    private func open(_ item: EventItem) {
        let opened = store.board.opened(item)
        // A click on the open one closes it.
        if state.card?.itemID == opened.id {
            state.escapes += 1
        } else {
            state.card = CardRequest(itemID: opened.id, draft: store.cardDraft(for: opened))
        }
    }

    private var signedOut: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar").font(.system(size: 28)).foregroundStyle(CalendarStyle.accent)
            Text(model.session.checked ? "Open Calendar to sign in." : "One moment…")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
    }

    // MARK: The foot

    private var footer: some View {
        VStack(spacing: 8) {
            if let conversion = store.conversion, state.card == nil {
                ConvertBanner(conversion: conversion) { state.report($0) }
            }
            if let problem = state.problem {
                ProblemBanner(message: problem)
            }
            HStack {
                Button {
                    model.showWindow()
                } label: {
                    Label("Open Calendar", systemImage: "macwindow")
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .capsule)
                Spacer()
                if store.offline {
                    Image(systemName: "wifi.slash")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .help("Offline: showing the calendar as last read")
                }
                Menu {
                    Button("Settings…") { model.showSettings() }
                    Button("Refresh") { Task { await model.sync(force: true) } }
                    Divider()
                    Toggle("Show Time Between Events", isOn: Binding(get: { model.prefs.gaps }, set: { model.prefs.gaps = $0 }))
                    Divider()
                    Button("Quit Calendar Completely") { model.quitCompletely() }
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 13, weight: .medium))
                        .frame(width: 30, height: 28)
                        .contentShape(.circle)
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Settings and quit")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .animation(.snappy, value: state.problem)
    }
}

/// The event the typed line makes, shown under it as it's typed.
private struct EntryPreview: View {
    let entry: QuickEntry
    let me: String?
    let add: () -> Void
    let details: () -> Void
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let holder = store.board.member(entry.holder ?? me)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(CalendarStyle.muted(holder?.color ?? CalendarRules.familyColor))
                    .frame(width: 4)
                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.title.isEmpty ? "New event" : entry.title)
                        .font(.system(size: 15, weight: .semibold, design: .serif))
                        .foregroundStyle(entry.title.isEmpty ? .secondary : .primary)
                        .lineLimit(2)
                    Text(when)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if !entry.location.isEmpty {
                        Label(entry.location, systemImage: "mappin")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    if let rule = entry.repeats {
                        Label(repeatText(rule), systemImage: "repeat")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if let holder, holder.email != me {
                        Label("On \(holder.firstName)'s calendar", systemImage: "calendar")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 4)
                Faces(emails: entry.going.filter { $0 != entry.holder }, size: 20, ring: CalendarStyle.card)
            }
            .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                Button(action: add) {
                    Text("Add").font(.footnote.weight(.semibold))
                    Image(systemName: "return").font(.system(size: 9, weight: .bold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(entry.title.isEmpty ? AnyShapeStyle(.tertiary) : AnyShapeStyle(CalendarStyle.accent))
                .disabled(entry.title.isEmpty)
                Spacer()
                Button("Details…", action: details)
                    .buttonStyle(.plain)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.leading, 14)
        }
        .padding(10)
        .background(CalendarStyle.card.opacity(0.75), in: .rect(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var when: String {
        let day = MacStyle.shortDate(Day(entry.start))
        if entry.allDay { return "\(day) · All day" }
        let ends = Day(entry.end) == Day(entry.start) ? CalendarRules.clock(entry.end) : "\(MacStyle.shortDate(Day(entry.end))) \(CalendarRules.clock(entry.end))"
        return "\(day) · \(CalendarRules.clock(entry.start)) – \(ends)"
    }

    private func repeatText(_ rule: Repeat) -> String {
        let every = CalendarRules.repeatLabel(rule.every)
        guard let until = rule.until else { return every }
        return "\(every) until \(until.at(minutes: 12 * 60).formatted(.dateTime.month(.abbreviated).day().year()))"
    }
}

/// A day as the applet lists it. The left column holds only the member's own
/// times; everyone else's events are one line each, their time in brackets
/// after the words, their faces down the right.
struct AgendaList: View {
    let agenda: Agenda
    /// The same day as stops and the time between, when that's how it's
    /// listed (the experiment; see `Rundown`). Nil is the plain list.
    var rundown: Rundown?
    let now: Date
    let open: (EventItem) -> Void
    let report: (String) -> Void
    /// The event whose card is open.
    let openID: UUID?
    /// What's been today, unfolded (the time-between list folds it away).
    var unfolded = false
    /// Every grey line of the family's events opened out.
    var expanded = false
    @Environment(CalendarStore.self) private var store
    @State private var showEarlier = false
    /// The grey lines that have been opened, by the part they're in.
    @State private var opened: Set<String> = []

    static let timeColumn: CGFloat = 52

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if agenda.upcoming {
                if !agenda.stillToday.isEmpty {
                    heading("Today", Day(now))
                    chips(agenda.stillToday)
                }
                Label("Nothing more today", systemImage: "checkmark")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                // Tomorrow, in a panel of its own so it reads as not yet.
                VStack(alignment: .leading, spacing: 0) {
                    heading(MacStyle.dayName(agenda.day, today: Day(now)), agenda.day, symbol: "sunrise")
                    rows
                }
                .padding(.bottom, 6)
                .background(Color.primary.opacity(0.055), in: .rect(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 8)
            } else {
                heading(MacStyle.dayName(agenda.day, today: Day(now)), agenda.day)
                rows
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func heading(_ name: String, _ day: Day, symbol: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let symbol {
                Image(systemName: symbol).font(.footnote).foregroundStyle(.secondary)
            }
            Text(name)
                .font(.system(size: 15, weight: .semibold, design: .serif))
                .foregroundStyle(day == Day(now) ? CalendarStyle.accent : .primary)
            Text(MacStyle.shortDate(day))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if let note = store.board.zoneNote(on: day) {
                Text(note)
                    .font(.system(.caption2, design: .rounded).weight(.semibold))
                    .foregroundStyle(CalendarStyle.accent)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var rows: some View {
        if let rundown { flow(rundown) } else { plainRows }
    }

    @ViewBuilder
    private var plainRows: some View {
        if !agenda.allDay.isEmpty { chips(agenda.allDay) }
        if agenda.rows.isEmpty, agenda.allDay.isEmpty {
            Text("Nothing on.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
        }
        // Now sits between what has started and what's still to come.
        let isToday = agenda.day == Day(now) && !agenda.rows.isEmpty
        let firstAhead = agenda.rows.firstIndex { $0.item.event.start > now }
        ForEach(Array(agenda.rows.enumerated()), id: \.element.id) { index, row in
            if isToday, index == firstAhead, index > 0 { nowLine }
            button(row)
        }
        if isToday, firstAhead == nil { nowLine }
    }

    private var nowLine: some View {
        HStack(spacing: 5) {
            Text(MacStyle.compactClock(now))
                .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                .foregroundStyle(CalendarStyle.now)
                .frame(width: Self.timeColumn - 6, alignment: .trailing)
            Circle().fill(CalendarStyle.now).frame(width: 6, height: 6)
            Rectangle().fill(CalendarStyle.now).frame(height: 1)
        }
        .padding(.leading, 6)
        .padding(.trailing, 12)
        .padding(.vertical, 3)
        .accessibilityLabel("Now")
    }

    // MARK: The time between

    /// The colour of where the member is now: the calendar's own olive, not
    /// the red of the grid's now line, which in a list reads as a warning.
    static let live = CalendarStyle.accent

    /// The day as stops and gaps. What's over folds into one line, so the
    /// list starts where the member is.
    @ViewBuilder
    private func flow(_ day: Rundown) -> some View {
        if !agenda.allDay.isEmpty { chips(agenda.allDay) }
        if day.isEmpty, agenda.allDay.isEmpty {
            Text("Nothing on.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
        }
        let live = day.parts.contains { $0.phase == .now }
        let earlier = live ? day.parts.filter { $0.phase == .over } : []
        let count = earlier.reduce(0) { $0 + ($1.kind == .stop ? 1 : 0) + $1.others.count }
        if count > 0 {
            Button {
                withAnimation(.snappy(duration: 0.2)) { showEarlier.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Color.clear.frame(width: Self.timeColumn - 6, height: 1)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 7.5, weight: .bold))
                        .rotationEffect(.degrees(showEarlier || unfolded ? 90 : 0))
                        .frame(width: 4)
                    Text("Earlier · \(count) \(count == 1 ? "event" : "events")")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.tertiary)
                .padding(.leading, 6)
                .padding(.vertical, 4)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(showEarlier ? "Hides what's been today" : "Shows what's been today")
            if showEarlier || unfolded {
                ForEach(earlier) { part($0, in: day) }
            }
        }
        ForEach(day.parts.filter { !live || $0.phase != .over }) { part($0, in: day) }
    }

    @ViewBuilder
    private func part(_ part: Rundown.Part, in day: Rundown) -> some View {
        switch part.kind {
        case .stop:
            if let row = part.row {
                VStack(spacing: 0) {
                    button(row, stop: part)
                    if part.phase == .now, let start = part.start, let end = part.end {
                        LiveLine(start: start, end: end, now: now)
                            .padding(.leading, 6)
                            .padding(.trailing, 12)
                            .padding(.bottom, 7)
                    }
                }
                .background { if part.phase == .now { nowGround } }
                // The family's, wholly inside it.
                if !part.others.isEmpty {
                    aside(id: part.id, lead: nil, clock: false, others: part.others, isNow: false, dim: part.phase == .over)
                }
            }
        case .gap:
            gap(part, anyStops: day.parts.contains { $0.kind == .stop })
        }
    }

    /// The time between two stops, as one grey line: a clock and how long it
    /// is (or, where the member is now, how long is left of it), then who in
    /// the family has what on in it. The line opens to those events.
    @ViewBuilder
    private func gap(_ part: Rundown.Part, anyStops: Bool) -> some View {
        let isNow = part.phase == .now
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

    /// A grey line of the family's events, "(J: Surfing, S+O: School)" after
    /// whatever leads it. A click opens it into the events themselves, each
    /// its own line down a dotted spine; another closes it.
    private func aside(
        id: String, lead: String?, clock: Bool, others: [Agenda.Row], isNow: Bool, dim: Bool, alwaysOpen: Bool = false
    ) -> some View {
        let isOpen = !others.isEmpty && (opened.contains(id) || expanded || alwaysOpen)
        let head = Text(lead ?? "")
            .font(isNow ? .system(size: 13, weight: .semibold) : .system(size: 11, weight: .medium, design: .rounded))
            .foregroundStyle(isNow ? AnyShapeStyle(Self.live) : AnyShapeStyle(.secondary))
        let tail = Text(isOpen || others.isEmpty ? "" : "\(lead == nil ? "" : "  ")(\(summary(others)))")
            .font(.system(size: 11))
            .foregroundStyle(.tertiary)
        return VStack(alignment: .leading, spacing: 0) {
            if lead != nil || !isOpen {
                Button {
                    withAnimation(.snappy(duration: 0.2)) {
                        if opened.contains(id) { opened.remove(id) } else { opened.insert(id) }
                    }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Color.clear.frame(width: Self.timeColumn - 6, height: 1)
                        Group {
                            if clock {
                                Image(systemName: "clock")
                                    .font(.system(size: 9.5, weight: .medium))
                                    .foregroundStyle(isNow ? AnyShapeStyle(Self.live) : AnyShapeStyle(.tertiary))
                            } else {
                                Color.clear.frame(height: 1)
                            }
                        }
                        .frame(width: 4)
                        Text("\(head)\(tail)")
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 6)
                    .padding(.trailing, 12)
                    .padding(.vertical, isNow ? 6 : 3)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .allowsHitTesting(!others.isEmpty && !alwaysOpen)
                .help(others.isEmpty ? "" : isOpen ? "Hide these" : "Show these")
                .accessibilityLabel(([lead].compactMap { $0 } + others.map { accessible($0) }).joined(separator: ", "))
            }
            if isOpen {
                VStack(spacing: 0) {
                    ForEach(others) { button($0) }
                }
                .overlay(alignment: .topLeading) {
                    Spine()
                        .stroke(
                            isNow ? Self.live.opacity(0.6) : Color.primary.opacity(0.22),
                            style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [0.01, 5])
                        )
                        .frame(width: 4)
                        .padding(.vertical, 5)
                        .padding(.leading, Self.timeColumn + 8)
                        .allowsHitTesting(false)
                }
            }
        }
        .padding(.bottom, isNow && isOpen ? 4 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { if isNow { nowGround } }
        .opacity(dim ? 0.75 : 1)
    }

    /// "J: Surfing, S+O: School": whose, by first letter, and what.
    private func summary(_ rows: [Agenda.Row]) -> String {
        rows.map { row in
            let who = row.people.compactMap { store.board.member($0)?.firstName.first.map(String.init) }.joined(separator: "+")
            return who.isEmpty ? row.item.event.title : "\(who): \(row.item.event.title)"
        }
        .joined(separator: ", ")
    }

    private func accessible(_ row: Agenda.Row) -> String {
        let who = row.people.compactMap { store.board.member($0)?.firstName }.joined(separator: " and ")
        return who.isEmpty ? row.item.title : "\(who): \(row.item.title)"
    }

    /// Behind where the member is now.
    private var nowGround: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Self.live.opacity(0.09))
            .padding(.horizontal, 6)
    }

    private func button(_ row: Agenda.Row, stop: Rundown.Part? = nil) -> some View {
        Button {
            open(row.item)
        } label: {
            Group {
                if let stop, stop.leg != nil {
                    LegRow(part: stop, hollow: agenda.upcoming)
                } else if row.mine {
                    MineRow(row: row, hollow: agenda.upcoming)
                } else {
                    TheirRow(row: row)
                }
            }
            .padding(.leading, 6)
            .padding(.trailing, 12)
            .background {
                if openID == row.id {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.07)).padding(.horizontal, 4)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .opacity(row.item.hidden ? 0.5 : 1)
        .contextMenu { HideMenu(item: row.item, report: report) }
    }

    /// All-day events: chips across the top of the day.
    private func chips(_ rows: [Agenda.Row]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(rows) { row in
                Button {
                    open(row.item)
                } label: {
                    HStack(spacing: 6) {
                        Text(row.item.title)
                            .font(.system(size: 12, weight: row.mine ? .semibold : .regular))
                            .foregroundStyle(CalendarStyle.ink(row.item.color))
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Faces(emails: row.people, size: 15, ring: CalendarStyle.wash(row.item.color))
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3.5)
                    .background(CalendarStyle.wash(row.item.color, row.mine ? 0.26 : 0.14), in: .rect(cornerRadius: 6, style: .continuous))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .contextMenu { HideMenu(item: row.item, report: report) }
            }
        }
        .padding(.leading, Self.timeColumn + 14)
        .padding(.trailing, 12)
        .padding(.vertical, 3)
    }
}

/// The member's own event: when down the left, a bar of the colour of whose
/// it is, the words, and who else is in it.
private struct MineRow: View {
    let row: Agenda.Row
    /// Tomorrow's: an outline, not yet filled in.
    let hollow: Bool

    var body: some View {
        let item = row.item
        let clock = item.calendar()
        let color = CalendarStyle.muted(item.color)
        HStack(alignment: .top, spacing: 8) {
            Text(MacStyle.compactClock(item.event.start, in: clock))
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(row.over ? .tertiary : .secondary)
                .frame(width: AgendaList.timeColumn - 6, alignment: .trailing)
                .padding(.top, 2)
            Group {
                if hollow {
                    RoundedRectangle(cornerRadius: 2).strokeBorder(color, lineWidth: 1.2)
                } else {
                    RoundedRectangle(cornerRadius: 2).fill(row.over ? AnyShapeStyle(Color.primary.opacity(0.18)) : AnyShapeStyle(color))
                }
            }
            .frame(width: 4)
            VStack(alignment: .leading, spacing: 1.5) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(item.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(row.over ? .secondary : .primary)
                        .strikethrough(item.hidden && !item.hiddenByMe)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if item.conflict { ConflictMark() }
                }
                if let detail {
                    Text(detail)
                        .font(.system(size: 11.5))
                        .foregroundStyle(row.over ? .tertiary : .secondary)
                        .lineLimit(1)
                }
                if item.needsDriver, !row.over {
                    DutyGlyphs(item: item, onlyUnset: true).padding(.top, 1)
                }
            }
            Spacer(minLength: 4)
            Faces(emails: row.people, size: 18)
                .padding(.top, 1)
        }
        .padding(.vertical, 5.5)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// When to leave, when the member's driving; else where it is.
    private var detail: String? {
        let clock = row.item.calendar()
        var parts: [String] = []
        if let leave = row.leaves[.dropoff] { parts.append("Leave \(MacStyle.compactClock(leave, in: clock))") }
        if let back = row.leaves[.pickup] { parts.append("Pick up: leave \(MacStyle.compactClock(back, in: clock))") }
        if parts.isEmpty, let place = CalendarRules.whereLine(row.item.event) { parts.append(place.text) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// Someone else's event: one line, starting where the member's own titles
/// do, in that person's colour, with its time in brackets after it.
private struct TheirRow: View {
    let row: Agenda.Row

    var body: some View {
        let item = row.item
        let title = Text(item.title)
            .foregroundStyle(row.over ? AnyShapeStyle(.tertiary) : AnyShapeStyle(CalendarStyle.ink(item.color)))
        let time = Text("  (\(MacStyle.compactClock(item.event.start, in: item.calendar())))")
            .font(.system(size: 10.5, design: .rounded))
            .foregroundStyle(.tertiary)
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Color.clear.frame(width: AgendaList.timeColumn - 6, height: 1)
            Color.clear.frame(width: 4, height: 1)
            Text("\(title)\(time)")
                .font(.system(size: 12))
                .lineLimit(1)
            Spacer(minLength: 4)
            Faces(emails: row.people, size: 15)
                .opacity(row.over ? 0.55 : 1)
        }
        .padding(.vertical, 2.5)
    }
}

/// A drive that's the member's own, for an event that isn't: when to leave
/// down the left, who's being driven, and what it's for.
private struct LegRow: View {
    let part: Rundown.Part
    let hollow: Bool

    var body: some View {
        if let row = part.row, let leg = part.leg {
            let item = row.item
            let clock = item.calendar()
            let color = CalendarStyle.muted(item.color)
            let over = part.phase == .over
            HStack(alignment: .top, spacing: 8) {
                Text(MacStyle.compactClock(leg.start, in: clock))
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(over ? .tertiary : .secondary)
                    .frame(width: AgendaList.timeColumn - 6, alignment: .trailing)
                    .padding(.top, 2)
                Group {
                    if hollow {
                        RoundedRectangle(cornerRadius: 2).strokeBorder(color, lineWidth: 1.2)
                    } else {
                        RoundedRectangle(cornerRadius: 2).fill(over ? AnyShapeStyle(Color.primary.opacity(0.18)) : AnyShapeStyle(color))
                    }
                }
                .frame(width: 4)
                VStack(alignment: .leading, spacing: 1.5) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Image(systemName: "car.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                        Text(leg.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(over ? .secondary : .primary)
                            .lineLimit(1)
                    }
                    // What the drive says of itself ("4:30pm (18 min drive)"); the
                    // event it's for is the next line down, in the time between.
                    Text(leg.note ?? item.title)
                        .font(.system(size: 11.5))
                        .foregroundStyle(over ? .tertiary : .secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Faces(emails: row.people, size: 18)
                    .padding(.top, 1)
            }
            .padding(.vertical, 5.5)
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Under the stop the member is in: how far through it they are, and how
/// long is left.
private struct LiveLine: View {
    let start: Date
    let end: Date
    let now: Date

    var body: some View {
        let whole = max(end.timeIntervalSince(start), 1)
        let done = min(max(now.timeIntervalSince(start) / whole, 0), 1)
        HStack(spacing: 8) {
            Color.clear.frame(width: AgendaList.timeColumn - 6, height: 1)
            Color.clear.frame(width: 4, height: 1)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.12))
                    Capsule().fill(AgendaList.live).frame(width: max(geo.size.width * done, 3))
                }
            }
            .frame(height: 3)
            Text("\(Rundown.length(end.timeIntervalSince(now))) left")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(AgendaList.live)
                .fixedSize()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Rundown.length(end.timeIntervalSince(now))) left")
    }
}

/// A line straight down, for a gap's dotted spine.
private struct Spine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        return path
    }
}
