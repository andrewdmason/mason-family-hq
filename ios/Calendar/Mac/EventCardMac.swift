import AppKit
import SwiftUI

/// An event, opened, or a new one being made: the phone's card
/// (iPhone/EventCard.swift) on the Mac, beside the applet or hanging off an
/// event in the window. Every row is the thing itself and the way to change
/// it, and it all sits in a draft until the ✓ (⌘Return; Return in a new
/// event's title). ✕ or Escape with changes asks before dropping them.
///
/// What it asks (discard, this one or all of them, delete) it asks in the
/// card itself, so it works the same in a popover and in the menubar panel.
struct EventCardMac: View {
    let request: CardRequest
    let me: String?
    /// As tall as what's on it, up to this.
    var maxHeight: CGFloat = 620
    /// Goes up when Escape is pressed outside the card's own fields.
    var escapes = 0
    /// Goes up when whoever holds the card wants to put it away with changes
    /// in it: the card asks about them.
    var leaves = 0
    let report: (String) -> Void
    let close: () -> Void
    /// A new event was added, on this day.
    var added: (Day) -> Void = { _ in }
    /// Whether closing now would lose something: for whoever holds the card
    /// to know before putting it away.
    var dirty: (Bool) -> Void = { _ in }

    @Environment(CalendarStore.self) private var store
    @Environment(\.openURL) private var openURL

    @State private var draft: CardDraft
    /// The event as last read: what the draft is compared with, and sent as
    /// changes to.
    @State private var base: CardDraft
    @State private var asking: Question?
    /// Why a click did nothing.
    @State private var note: String?
    @State private var placing = false
    @State private var placeText = ""
    @State private var placeSession = UUID()
    @State private var suggestions: [PlaceSuggestion] = []
    @State private var search: Task<Void, Never>?
    @State private var lookup: Task<Void, Never>?
    @State private var contentHeight: CGFloat = 300
    @State private var leaving = false
    @FocusState private var focus: Field?

    private enum Field { case title, place, notes }

    private enum Question { case discard, scope, stop, delete }

    private static let headerHeight: CGFloat = 54

    init(
        request: CardRequest, me: String?, maxHeight: CGFloat = 620, escapes: Int = 0, leaves: Int = 0,
        report: @escaping (String) -> Void, close: @escaping () -> Void, added: @escaping (Day) -> Void = { _ in },
        dirty: @escaping (Bool) -> Void = { _ in }
    ) {
        self.request = request
        self.me = me
        self.maxHeight = maxHeight
        self.escapes = escapes
        self.leaves = leaves
        self.report = report
        self.close = close
        self.added = added
        self.dirty = dirty
        _draft = State(initialValue: request.draft)
        _base = State(initialValue: request.draft)
    }

    // MARK: What it's showing

    private var item: EventItem? { request.itemID.flatMap { store.board.item($0) } }
    private var isNew: Bool { request.itemID == nil }
    /// The trip's zone, when the event was opened on a day away.
    private var zone: TimeZone? { base.event.allDay ? nil : store.board.zone(at: base.event.start) }
    private var clock: Calendar {
        var calendar = Calendar.current
        if let zone { calendar.timeZone = zone }
        return calendar
    }
    private var zoneNote: String? {
        zone.map { CalendarRules.zoneNote($0, home: .current, at: draft.event.start) }
    }
    private var editable: Bool { isNew || item.map { store.board.isEditable($0.event) } == true }
    private var holder: Member? { store.board.member(draft.event.memberEmail) }
    private var titleIsEmpty: Bool { draft.event.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var changed: Bool { draft != base }
    private var canSave: Bool { !titleIsEmpty && (isNew || changed) }

    private var fieldsChanged: Bool {
        var fields = draft.event
        fields.memberEmail = base.event.memberEmail
        return fields != base.event
    }

    /// Whether the event is, or would be, on a Google calendar: what can
    /// repeat, and what can have others going along.
    private var onGoogle: Bool {
        if let item { return item.event.sourceType == .google }
        return store.isDemo || store.sourceForNewEvent(draft.event.memberEmail) != nil
    }

    private var joinURL: String? { item?.event.joinURL }

    var body: some View {
        if isNew || item != nil {
            card
        } else {
            // Deleted, or gone in a refresh.
            Color.clear.frame(height: 1).onAppear {
                if !leaving, changed { report("“\(base.event.title)” is no longer on the calendar.") }
                close()
            }
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            header
            if let asking { question(asking) }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    titleRow
                    divider
                    if editable { whenRows } else if let item { lockedWhen(item.event) }
                    whereRows
                    familyRows
                    notesRow
                    footer
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollIndicators(.never)
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: min(contentHeight, max(200, maxHeight - Self.headerHeight - (asking == nil ? 0 : 96))))
        }
        .animation(.snappy(duration: 0.2), value: asking)
        .animation(.snappy(duration: 0.2), value: note)
        .animation(.snappy(duration: 0.2), value: placing)
        .onAppear {
            if isNew {
                focus = .title
            } else {
                // An event opened to look at: nothing's being typed in yet.
                Task {
                    focus = nil
                    if let window = NSApp.keyWindow, window.firstResponder is NSText { window.makeFirstResponder(nil) }
                }
            }
        }
        .interactiveDismissDisabled(changed)
        .onChange(of: changed, initial: true) { dirty(changed) }
        .onDisappear { dirty(false) }
        .onExitCommand { cancel() }
        .onChange(of: escapes) { cancel() }
        .onChange(of: leaves) { if changed { asking = .discard } else { leave() } }
        // The event read again under the open card: what was changed here
        // stays, the rest follows.
        .onChange(of: item) { _, item in
            guard let item else { return }
            let fresh = store.cardDraft(for: item)
            draft = draft.rebased(from: base, onto: fresh)
            base = fresh
        }
    }

    // MARK: ✕ and ✓

    private var header: some View {
        HStack(spacing: 8) {
            GlassCircleButton(symbol: "xmark", label: "Close") { cancel() }
            Spacer()
            if let item, editable {
                GlassCircleButton(symbol: "trash", label: "Delete") { asking = asking == .delete ? nil : .delete }
                    .foregroundStyle(.red)
                    .accessibilityHint("Deletes “\(item.event.title)”")
            }
            GlassCircleButton(
                symbol: "checkmark", tint: canSave ? CalendarStyle.olive.opacity(0.5) : nil, label: isNew ? "Add" : "Save"
            ) { commit() }
            .disabled(!canSave)
            .opacity(canSave ? 1 : 0.5)
            .keyboardShortcut(.return, modifiers: .command)
        }
        .padding(.horizontal, 12)
        .frame(height: Self.headerHeight)
    }

    /// ✕, or Escape: with changes, asks first.
    private func cancel() {
        if asking != nil {
            asking = nil
        } else if placing {
            placing = false
        } else if changed {
            asking = .discard
        } else {
            leave()
        }
    }

    private func leave() {
        leaving = true
        close()
    }

    private func commit() {
        guard canSave else { return }
        focus = nil
        if let event = item?.event, CalendarRules.repeats(event) {
            if draft.repeats != base.repeats {
                // How it repeats is the whole series' business.
                if draft.repeats == nil { asking = .stop } else { send(series: true) }
                return
            }
            if fieldsChanged {
                asking = .scope
                return
            }
        }
        send(series: false)
    }

    /// Save and close at once. The website hears in the background; whatever
    /// it refuses is put back and the calendar says so.
    private func send(series: Bool) {
        var after = draft
        // Drivers picked for an event that turned out not to need driving to.
        if !needsDrives { after.duties = base.duties }
        store.save(CardSave(event: item?.event, before: base, after: after, series: series), report: report)
        if isNew { added(Day(draft.event.start)) }
        leave()
    }

    private func delete(series: Bool) {
        guard let event = item?.event else { return }
        store.delete(event, series: series, report: report)
        leave()
    }

    /// What the card needs answered before it goes on, asked in the card.
    @ViewBuilder
    private func question(_ question: Question) -> some View {
        let repeating = item.map { CalendarRules.repeats($0.event) } == true
        VStack(alignment: .leading, spacing: 8) {
            switch question {
            case .discard:
                Text("This event has changes").font(.callout.weight(.semibold))
                answers {
                    Button("Keep Editing") { asking = nil }
                    Button("Discard Changes", role: .destructive) { leave() }
                }
            case .scope:
                Text("This is a repeating event").font(.callout.weight(.semibold))
                answers {
                    Button("Cancel") { asking = nil }
                    Button("All Events") { send(series: true) }
                    Button("This Event Only") { send(series: false) }.buttonStyle(.borderedProminent)
                }
            case .stop:
                Text("Stop repeating?").font(.callout.weight(.semibold))
                Text("This event stays. The others in the series come off Google Calendar, past ones too.")
                    .font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                answers {
                    Button("Cancel") { asking = nil }
                    Button("Stop Repeating", role: .destructive) { send(series: true) }
                }
            case .delete:
                Text("Delete “\(item?.event.title ?? "")”?").font(.callout.weight(.semibold)).lineLimit(2)
                Text(deleteNote).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                answers {
                    Button("Cancel") { asking = nil }
                    if repeating {
                        Button("All Events", role: .destructive) { delete(series: true) }
                        Button("This Event Only", role: .destructive) { delete(series: false) }
                    } else {
                        Button("Delete", role: .destructive) { delete(series: false) }
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CalendarStyle.card, in: .rect(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(CalendarStyle.line))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func answers(@ViewBuilder _ buttons: () -> some View) -> some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            buttons()
        }
        .controlSize(.regular)
        .tint(CalendarStyle.olive)
    }

    private var deleteNote: String {
        guard let event = item?.event else { return "" }
        if CalendarRules.repeats(event) {
            return "This is a repeating event. Deleting all of them takes the whole series off Google Calendar, past ones too."
        }
        return event.sourceType == .google ? "It comes off Google Calendar too." : "This can't be undone."
    }

    // MARK: Rows

    private var divider: some View {
        Rectangle().fill(CalendarStyle.line).frame(height: 1)
    }

    /// A row: its icon in the column down the left, then what it holds.
    private func row(
        _ symbol: String?, alignment: VerticalAlignment = .firstTextBaseline, @ViewBuilder _ content: () -> some View
    ) -> some View {
        HStack(alignment: alignment, spacing: 10) {
            Image(systemName: symbol ?? "circle")
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
                .opacity(symbol == nil ? 0 : 1)
                .frame(width: 20)
                .accessibilityHidden(true)
            content()
            Spacer(minLength: 0)
        }
        .padding(.vertical, 9)
    }

    private func caption(_ title: String, badge: String? = nil) -> some View {
        HStack {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Spacer()
            if let badge {
                Text(badge)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(CalendarStyle.amber)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(CalendarStyle.amber.opacity(0.15), in: .capsule)
            }
        }
    }

    // MARK: What

    private var titleRow: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2.5)
                .fill(CalendarStyle.muted(holder?.color ?? item?.color ?? CalendarRules.familyColor))
                .frame(width: 5)
            VStack(alignment: .leading, spacing: 5) {
                Group {
                    if editable {
                        TextField("Title", text: $draft.event.title, axis: .vertical)
                            .textFieldStyle(.plain)
                            .focused($focus, equals: .title)
                            // Return in the title is the ✓.
                            .onSubmit { commit() }
                    } else {
                        Text(item?.title ?? draft.event.title)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                }
                .font(.system(size: 20, weight: .semibold, design: .serif))
                .foregroundStyle(Color.primary)
                .opacity(draft.holderGoing ? 1 : 0.5)
                if item?.conflict == true {
                    HStack(spacing: 6) {
                        ConflictMark()
                        Text("Overlaps").font(.footnote).foregroundStyle(CalendarStyle.amber)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 2)
        .padding(.bottom, 12)
    }

    // MARK: When

    /// The day, the times, all-day and how it repeats, each set where it
    /// stands. On a day away they're in the trip's time.
    @ViewBuilder
    private var whenRows: some View {
        let event = draft.event
        row("clock", alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    DatePicker("Day", selection: Binding(
                        get: { event.start },
                        set: { CalendarRules.moveStart(&draft.event, to: $0) }
                    ), displayedComponents: .date)
                    if !event.allDay {
                        DatePicker("Starts", selection: Binding(
                            get: { event.start },
                            set: { CalendarRules.moveStart(&draft.event, to: $0) }
                        ), displayedComponents: .hourAndMinute)
                        Image(systemName: "arrow.right").font(.caption).foregroundStyle(.tertiary).accessibilityLabel("to")
                        DatePicker("Ends", selection: Binding(
                            get: { event.end },
                            set: { CalendarRules.moveEnd(&draft.event, to: $0) }
                        ), displayedComponents: Day(event.end, in: clock) == Day(event.start, in: clock) ? .hourAndMinute : [.date, .hourAndMinute])
                    }
                }
                .labelsHidden()
                .datePickerStyle(.field)
                .environment(\.timeZone, clock.timeZone)
                .environment(\.calendar, clock)
                HStack(spacing: 10) {
                    Toggle("All day", isOn: $draft.event.allDay)
                        .toggleStyle(.checkbox)
                    if !event.allDay {
                        Text(CalendarRules.length(from: event.start, to: event.end))
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .font(.callout)
                if onGoogle || draft.repeats != nil {
                    HStack(spacing: 6) {
                        Image(systemName: "repeat").font(.caption).foregroundStyle(.secondary)
                        Picker("Repeat", selection: Binding(
                            get: { draft.repeats?.every },
                            set: { every in
                                draft.repeats = every.map { Repeat(every: $0, until: draft.repeats?.until) }
                            }
                        )) {
                            Text("Doesn't repeat").tag(Repeat.Every?.none)
                            ForEach(repeatChoices, id: \.self) { every in
                                Text(CalendarRules.repeatLabel(every)).tag(Repeat.Every?.some(every))
                            }
                        }
                        .labelsHidden()
                        .fixedSize()
                        if draft.repeats != nil {
                            Toggle("until", isOn: Binding(
                                get: { draft.repeats?.until != nil },
                                set: { draft.repeats?.until = $0 ? Day(event.start, in: clock).adding(months: 3) : nil }
                            ))
                            .toggleStyle(.checkbox)
                            if let until = draft.repeats?.until {
                                DatePicker("Last day", selection: Binding(
                                    get: { until.at(minutes: 12 * 60) },
                                    set: { draft.repeats?.until = Day($0) }
                                ), in: event.start..., displayedComponents: .date)
                                .labelsHidden()
                                .datePickerStyle(.field)
                            }
                        }
                    }
                    .font(.callout)
                }
                if !event.allDay, let zoneNote {
                    Text(zoneNote)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(CalendarStyle.accent)
                }
            }
        }
        divider
    }

    /// The card's ways of repeating, and the event's own when it's one they
    /// can't say.
    private var repeatChoices: [Repeat.Every] {
        var choices = Repeat.Every.choices
        if let every = draft.repeats?.every, !choices.contains(every) { choices.append(every) }
        return choices
    }

    /// When, for an event that can't be changed here.
    @ViewBuilder
    private func lockedWhen(_ event: CalEvent) -> some View {
        let day = CalendarRules.day(of: event, in: clock)
        row("clock") {
            VStack(alignment: .leading, spacing: 2) {
                Text(day.at(minutes: 12 * 60).formatted(.dateTime.weekday(.wide).month(.wide).day()))
                    .font(.body.weight(.medium))
                Text([CalendarRules.timeRange(event, in: clock), event.rrule.map(CalendarRules.repeatText)].compactMap { $0 }.joined(separator: " · "))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if !event.allDay, let zoneNote {
                    Text(zoneNote).font(.footnote.weight(.medium)).foregroundStyle(CalendarStyle.accent)
                }
                if let arrival = event.teamsnapArrival, arrival < event.start {
                    Text("Arrive by \(CalendarRules.clock(arrival, in: clock))")
                        .font(.callout.weight(.medium))
                        .foregroundStyle(CalendarStyle.accent)
                }
                if let opponent = event.teamsnapOpponent {
                    Text("vs. \(opponent)").font(.callout).foregroundStyle(.secondary)
                }
            }
        }
        divider
    }

    // MARK: Where

    /// Where: with none, a click starts a search. With one, a click opens
    /// Maps, since where it is gets looked up far more than changed; changing
    /// it is under the ⋯.
    @ViewBuilder
    private var whereRows: some View {
        let location = draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        let somewhere = CalendarRules.isPlace(location)
        let place = somewhere || joinURL == nil ? CalendarRules.placeText(location) : nil
        if let joinURL {
            row("video") {
                Button("Join \(CalendarRules.joinName(joinURL))") {
                    if let url = URL(string: joinURL) { openURL(url) }
                }
                .buttonStyle(.plain)
                .foregroundStyle(CalendarStyle.accent)
                Spacer(minLength: 0)
                Button {
                    copy(joinURL)
                } label: {
                    Image(systemName: "doc.on.doc").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Copy link")
            }
            divider
        }
        if placing {
            placeSearch
            divider
        } else if editable, place == nil {
            Button {
                startPlacing()
            } label: {
                row("mappin.and.ellipse") {
                    Text("Location").foregroundStyle(.tertiary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            divider
        } else if let place {
            row("mappin.and.ellipse") {
                if somewhere {
                    Button {
                        var maps = URLComponents(string: "https://maps.apple.com/")!
                        maps.queryItems = [URLQueryItem(name: "q", value: place)]
                        if let url = maps.url { openURL(url) }
                    } label: {
                        placeLabel(place)
                    }
                    .buttonStyle(.plain)
                    .help("Open in Maps")
                } else {
                    Text(place).frame(maxWidth: .infinity, alignment: .leading)
                }
                if editable {
                    Menu {
                        Button("Change", systemImage: "pencil") { startPlacing() }
                        Button("Copy Address", systemImage: "doc.on.doc") { copy(place) }
                        Button("Remove", systemImage: "trash", role: .destructive) { setPlace("", from: nil) }
                    } label: {
                        Image(systemName: "ellipsis").foregroundStyle(.secondary).frame(width: 24, height: 18).contentShape(.rect)
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .accessibilityLabel("Location options")
                }
            }
            divider
        }
    }

    /// A place on two lines: its name, then the rest of its address.
    private func placeLabel(_ location: String) -> some View {
        let parts = CalendarRules.placeParts(location)
        return VStack(alignment: .leading, spacing: 1) {
            Text(parts.name).foregroundStyle(CalendarStyle.accent)
            if let rest = parts.rest {
                Text(rest).font(.callout).foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }

    /// The field to type a place in, with the family's own places and what
    /// the website finds under it. Return keeps the words as typed.
    private var placeSearch: some View {
        let query = placeText.trimmingCharacters(in: .whitespaces)
        let recents = CalendarRules.recentPlaces(Array(store.board.rows.values))
        let own = query.isEmpty ? Array(recents.prefix(5)) : Array(CalendarRules.matching(recents, query).prefix(3))
        let listed = Set(own.map { $0.lowercased() })
        let found = query.isEmpty ? [] : suggestions.filter { !listed.contains($0.location.lowercased()) }.prefix(5)
        return row("mappin.and.ellipse", alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                TextField("Search for a place", text: $placeText)
                    .textFieldStyle(.plain)
                    .focused($focus, equals: .place)
                    .onSubmit {
                        setPlace(query, from: nil)
                        placing = false
                    }
                    .onChange(of: placeText) { lookUp(query: placeText.trimmingCharacters(in: .whitespaces)) }
                ForEach(own, id: \.self) { place in
                    placeRow(CalendarRules.placeParts(place).name, CalendarRules.placeParts(place).rest, symbol: "clock.arrow.circlepath") {
                        setPlace(place, from: nil)
                        placing = false
                    }
                }
                ForEach(Array(found)) { suggestion in
                    placeRow(suggestion.label, suggestion.secondary, symbol: "mappin") {
                        setPlace(suggestion.location, from: suggestion)
                        placing = false
                    }
                }
            }
        }
    }

    private func placeRow(_ name: String, _ rest: String?, symbol: String, pick: @escaping () -> Void) -> some View {
        Button(action: pick) {
            HStack(spacing: 6) {
                Image(systemName: symbol).font(.caption).foregroundStyle(.tertiary).frame(width: 14)
                VStack(alignment: .leading, spacing: 0) {
                    Text(name).font(.callout).lineLimit(1)
                    if let rest { Text(rest).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 2)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func startPlacing() {
        placeText = CalendarRules.placeText(draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)) ?? ""
        placeSession = UUID()
        suggestions = []
        placing = true
        focus = .place
    }

    /// What the website finds for what's typed, once the typing pauses.
    private func lookUp(query: String) {
        search?.cancel()
        guard query.count >= 2 else {
            suggestions = []
            return
        }
        let session = placeSession
        search = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let found = await store.places(query, session: session)
            if !Task.isCancelled { suggestions = found }
        }
    }

    /// The place chosen. A suggestion comes without its street number or
    /// zip, so it's shown as it is at once and swapped for the full address
    /// when that arrives, unless the location has moved on.
    private func setPlace(_ location: String, from place: PlaceSuggestion?) {
        lookup?.cancel()
        // A call's link that was written in the location goes to the notes
        // rather than away with it, where it's still found to join by.
        let had = draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        if let joinURL, CalendarRules.placeText(had) != had, !draft.event.notes.contains(joinURL) {
            draft.event.notes = draft.event.notes.isEmpty ? joinURL : draft.event.notes + "\n\n" + joinURL
        }
        draft.event.location = location
        guard let place else { return }
        let session = placeSession
        lookup = Task {
            guard let full = await store.fullAddress(of: place, session: session), !Task.isCancelled else { return }
            if draft.event.location == location { draft.event.location = full }
        }
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    // MARK: The family's rows

    /// The faces in "Who's going": the family. Nobody on a drive block.
    private var roster: [Member] {
        item?.event.isDrive == true ? [] : store.board.members
    }

    private var answersTeamsnap: Bool { draft.rsvp != nil }

    private var holderCanSitOut: Bool {
        !isNew && !answersTeamsnap && holder?.role == .kid
    }

    /// Whether drop-off and pick-up apply to the event as drafted: a kid's
    /// timed event away from home, in person.
    private var needsDrives: Bool {
        let location = draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        return draft.holderGoing && !draft.event.allDay && item?.event.isDrive != true && holder?.role == .kid
            && !CalendarRules.isHome(location.isEmpty ? nil : location, homeAddress: store.board.logistics.homeAddress)
            && !CalendarRules.isRemote(location: location, joinURL: joinURL)
            && !store.board.parents.isEmpty
    }

    private func canHold(_ member: Member) -> Bool {
        guard editable, member.email != draft.event.memberEmail else { return false }
        guard let event = item?.event else { return true }
        return event.sourceType == .manual || member.primaryCalendarID != nil
    }

    @ViewBuilder
    private var familyRows: some View {
        let roster = roster
        if answersTeamsnap || !roster.isEmpty || needsDrives {
            if answersTeamsnap {
                row("checkmark.circle", alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        caption("Attendance", badge: draft.rsvp == .noReply ? "Needs RSVP" : nil)
                        Picker("RSVP", selection: Binding(
                            get: { draft.rsvp ?? .noReply },
                            set: { answer in
                                draft.rsvp = answer
                                draft.holderGoing = answer != .notGoing
                            }
                        )) {
                            Text("Going").tag(TeamsnapRsvp.going)
                            Text("Maybe").tag(TeamsnapRsvp.maybe)
                            Text("Not going").tag(TeamsnapRsvp.notGoing)
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                }
            }
            if !roster.isEmpty {
                row("person.2", alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        caption("Who's going")
                        HStack(spacing: 10) {
                            ForEach(roster) { member in face(member) }
                        }
                        if !draft.holderGoing, let holder {
                            Text("\(holder.firstName) isn't going, so it's off everyone's calendar.")
                                .font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        if let note {
                            Text(note)
                                .font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                                .transition(.opacity)
                        }
                    }
                }
            }
            if needsDrives {
                ForEach(DutyKind.allCases, id: \.self) { duty in
                    driveRow(duty)
                }
                if let warning = unconnected {
                    row(nil) { Text(warning).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                }
            }
            divider
        }
    }

    /// One face in "Who's going". A click is going or not; whoever's calendar
    /// it's on wears the calendar badge, and a right-click on anyone else's
    /// face offers to move it to theirs.
    @ViewBuilder
    private func face(_ member: Member) -> some View {
        let holds = member.email == draft.event.memberEmail
        // With the kid whose event it is not going, nobody is.
        let going = holds ? draft.holderGoing : draft.holderGoing && draft.going.contains(member.email)
        Button {
            note = nil
            if holds {
                toggleHolder(member)
            } else if onGoogle || item?.event.sourceType != .manual {
                setGoing(member.email, !going)
            } else {
                note = "It's only in Family HQ, not on a Google calendar, so nobody can be added to it."
            }
        } label: {
            PersonChoice(member: member, name: member.firstName, color: member.color, selected: going, holder: holds)
        }
        .buttonStyle(.plain)
        .disabled(!holds && !draft.holderGoing)
        .accessibilityLabel("\(member.firstName), \(going ? "going" : "not going")\(holds ? ", on their calendar" : "")")
        .contextMenu {
            if canHold(member) {
                Button("Move to \(member.firstName)'s Calendar", systemImage: "calendar") { move(to: member) }
            }
        }
    }

    private func setGoing(_ email: String, _ going: Bool) {
        var list = Set(draft.going)
        if going { list.insert(email) } else { list.remove(email) }
        draft.going = store.board.members.map(\.email).filter(list.contains)
    }

    private func toggleHolder(_ holder: Member) {
        if answersTeamsnap {
            draft.rsvp = draft.holderGoing ? .notGoing : .going
            draft.holderGoing.toggle()
        } else if holderCanSitOut {
            draft.holderGoing.toggle()
        } else if store.board.members.contains(where: canHold) {
            note = "It's on \(holder.firstName)'s calendar, so \(holder.firstName) counts as going. To take \(holder.firstName) off it, right-click someone else's face and move it to theirs."
        } else {
            note = "It's \(holder.firstName)'s event, so \(holder.firstName) counts as going."
        }
    }

    /// Onto someone else's calendar. Whoever had it stays on as going.
    private func move(to member: Member) {
        note = nil
        let previous = draft.event.memberEmail
        draft.event.memberEmail = member.email
        draft.holderGoing = true
        let going = Set(CalendarRules.goingAfterMove(draft.going, from: previous, to: member.email))
        draft.going = onGoogle || item != nil ? store.board.members.map(\.email).filter(going.contains) : []
        // Only a Google calendar holds a repeating event.
        if !onGoogle { draft.repeats = nil }
    }

    private func driveRow(_ duty: DutyKind) -> some View {
        let current = draft.duties[duty]
        func choose(_ state: DutyState) {
            // Clicking the one that's chosen clears it.
            draft.duties[duty] = current == state ? nil : state
        }
        return row("car", alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                caption(duty.label)
                HStack(spacing: 10) {
                    ForEach(store.board.parents) { parent in
                        Button { choose(.parent(parent.email)) } label: {
                            PersonChoice(member: parent, name: parent.firstName, color: parent.color, selected: current?.assignee == parent.email)
                        }
                    }
                    ForEach(CalendarRules.caregivers, id: \.self) { name in
                        Button { choose(.caregiver(name)) } label: {
                            PersonChoice(member: nil, name: name, color: CalendarRules.caregiverColor, selected: current?.caregiver == name)
                        }
                    }
                    Button { choose(.notNeeded) } label: {
                        VStack(spacing: 3) {
                            Image(systemName: "minus")
                                .font(.caption.weight(.bold))
                                .frame(width: 30, height: 30)
                                .background(Color.primary.opacity(current?.isNa == true ? 0.16 : 0.06), in: .circle)
                                .overlay(Circle().strokeBorder(Color.primary.opacity(current?.isNa == true ? 0.7 : 0), lineWidth: 2))
                                .padding(3)
                            Text("Not needed").font(.caption2).foregroundStyle(.secondary)
                        }
                        .opacity(current == nil || current?.isNa == true ? 1 : 0.45)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// A parent given a drive whose Google calendar isn't connected: the
    /// drive shows here but can't reach their real calendar.
    private var unconnected: String? {
        let names = store.board.parents
            .filter { parent in parent.primaryCalendarID == nil && draft.duties.values.contains { $0.assignee == parent.email } }
            .map(\.firstName)
        guard !names.isEmpty else { return nil }
        return "\(names.joined(separator: " and ")) \(names.count == 1 ? "has" : "have") no Google calendar connected, so the drive shows here but won't reach their own calendar yet."
    }

    // MARK: Notes, and where it's from

    @ViewBuilder
    private var notesRow: some View {
        let notes = draft.event.notes
        if editable {
            row("text.alignleft", alignment: .top) {
                TextField("Notes", text: $draft.event.notes, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(2...12)
                    .focused($focus, equals: .notes)
            }
        } else if !notes.isEmpty {
            row("text.alignleft", alignment: .top) {
                Text(Self.linked(notes))
                    .tint(CalendarStyle.accent)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// Notes with their web addresses made into links.
    private static func linked(_ text: String) -> AttributedString {
        var out = AttributedString(text)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return out }
        for match in detector.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let url = match.url, let found = Range(match.range, in: text), let range = Range(found, in: out) else { continue }
            out[range].link = url
            out[range].underlineStyle = .single
        }
        return out
    }

    @ViewBuilder
    private var footer: some View {
        if let item {
            let from = item.sourceName ?? (editable ? nil : item.isTeamsnap ? "TeamSnap" : "a subscribed calendar")
            if let from {
                divider
                Label(editable ? from : "From \(from)", systemImage: item.isTeamsnap ? "baseball" : "calendar")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 10)
            }
        }
    }
}

/// Someone to pick: their face, ringed in their colour when chosen, faded
/// when not. `holder` adds the calendar badge: the event is on their calendar.
private struct PersonChoice: View {
    let member: Member?
    let name: String
    let color: String
    let selected: Bool
    var holder = false

    var body: some View {
        VStack(spacing: 3) {
            Group {
                if let member {
                    Avatar(member: member, size: 30)
                } else {
                    Text(String(name.prefix(1)))
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(CalendarStyle.muted(color), in: .circle)
                }
            }
            .padding(3)
            .overlay(Circle().strokeBorder(CalendarStyle.muted(color).opacity(selected ? 1 : 0), lineWidth: 2))
            .overlay(alignment: .bottomTrailing) {
                if holder {
                    Image(systemName: "calendar")
                        .font(.system(size: 7.5, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 15, height: 15)
                        .background(CalendarStyle.muted(color), in: .circle)
                        .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1.5))
                        .offset(x: 2, y: 2)
                }
            }
            Text(name)
                .font(.caption2.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? .primary : .secondary)
                .lineLimit(1)
        }
        .opacity(selected ? 1 : 0.45)
        .animation(.snappy, value: selected)
        .animation(.snappy, value: holder)
        .contentShape(.rect)
    }
}
