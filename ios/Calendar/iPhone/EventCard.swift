import SwiftUI

/// An event, opened, or a new one being made: one card, with no separate
/// form. Every row is the thing itself and the way to change it: the title,
/// when (and how it repeats), where, who's going and whose calendar it's on,
/// who's driving, the TeamSnap RSVP, notes.
///
/// It all sits in a draft until the ✓, which saves the lot and closes the
/// card; ✕, or a swipe down, asks before dropping changes. An event
/// that can't be edited here (TeamSnap's, a school feed's) shows its fields as
/// plain words, with the family's rows still live. The card is as tall as
/// what's on it.
struct EventCard: View {
    let request: CardRequest
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var draft: CardDraft
    /// The event as last read: what the draft is compared with, and sent as
    /// changes to.
    @State private var base: CardDraft
    /// Why a tap did nothing.
    @State private var note: String?
    /// The picker open under the time row.
    @State private var picking: TimePart?
    @State private var confirmDiscard = false
    @State private var confirmDelete = false
    @State private var askScope = false
    @State private var confirmStop = false
    @State private var suggestions: [PlaceSuggestion] = []
    @State private var search: Task<Void, Never>?
    @State private var editingNotes = false
    @State private var contentHeight: CGFloat = 380
    /// Pulled up to full height, or up there for the keyboard.
    @State private var tall = false
    /// The rows are scrolled to their top, where a pull down is a pull on the card.
    @State private var atTop = true
    /// On its way out by its own doing, not because the event went away.
    @State private var leaving = false
    @FocusState private var focus: Field?

    private enum Field { case title, location, notes }
    private enum TimePart { case start, end, date, until }

    private static let weekdays = Calendar.current.weekdaySymbols
    private static let months = Calendar.current.monthSymbols
    private static let headerHeight: CGFloat = 70

    init(request: CardRequest, me: String?) {
        self.request = request
        self.me = me
        _draft = State(initialValue: request.draft)
        _base = State(initialValue: request.draft)
    }

    // MARK: What it's showing

    private var item: EventItem? { request.itemID.flatMap { store.board.item($0) } }
    private var isNew: Bool { request.itemID == nil }
    private var editable: Bool { isNew || item.map { store.board.isEditable($0.event) } == true }
    private var holder: Member? { store.board.member(draft.event.memberEmail) }
    private var titleIsEmpty: Bool { draft.event.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var changed: Bool { draft != base }
    private var canSave: Bool { !titleIsEmpty && (isNew || changed) }
    /// Something here would be lost by closing: a change, or a new event begun.
    private var hasWork: Bool { changed }

    /// The words, the time or the place changed: what an edit to a repeating
    /// event can make to all of them.
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

    var body: some View {
        if isNew || item != nil {
            card
        } else {
            // Deleted, or gone in a refresh.
            Color.clear.onAppear {
                if !leaving, changed { nav.problem = "“\(base.event.title)” is no longer on the calendar." }
                dismiss()
            }
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            header
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
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y <= 1 } action: { atTop = $1 }
        }
        .presentationDetents(detents, selection: detent)
        .presentationDragIndicator(.visible)
        // The page's paper, part see-through: glass enough to feel the day
        // behind it, solid enough that a bright block doesn't bleed into the words.
        .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
        .interactiveDismissDisabled(hasWork)
        // A swipe down with changes doesn't close the card (above); it asks
        // about them, as ✕ does. Not while a wheel is open under the finger.
        .simultaneousGesture(
            DragGesture(minimumDistance: 40).onEnded { drag in
                let down = drag.translation.height
                guard hasWork, atTop, picking != .start, picking != .end, focus == nil else { return }
                if down > 90, down > abs(drag.translation.width) * 2 { confirmDiscard = true }
            }
        )
        .animation(.snappy, value: note)
        .animation(.snappy, value: picking)
        .animation(.snappy, value: needsDrives)
        .modifier(ConvertAlert(active: true))
        .onAppear { if isNew { focus = .title } }
        .onChange(of: focus) { _, field in
            // Up out of the keyboard's way, and back to its own height after.
            tall = field != nil
            if field != nil { picking = nil }
            if field != .notes { editingNotes = false }
        }
        // The event read again under the open card: what was changed here
        // stays, the rest follows.
        .onChange(of: item) { _, item in
            guard let item else { return }
            let fresh = store.cardDraft(for: item)
            draft = draft.rebased(from: base, onto: fresh)
            base = fresh
        }
    }

    // MARK: Height

    /// As tall as what's on it, up to the whole screen.
    private var fits: CGFloat? {
        guard !isNew else { return nil }
        let wanted = contentHeight + Self.headerHeight
        // Past this it's as good as the whole screen, and is.
        return wanted < nav.screenHeight - 110 ? wanted : nil
    }

    private var detents: Set<PresentationDetent> {
        fits.map { [.height($0), .large] } ?? [.large]
    }

    private var detent: Binding<PresentationDetent> {
        Binding(
            get: { tall ? .large : fits.map { .height($0) } ?? .large },
            set: { tall = $0 == .large }
        )
    }

    // MARK: ✕ and ✓

    private var header: some View {
        HStack {
            Button {
                if hasWork { confirmDiscard = true } else { leave() }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Close")
            .confirmationDialog("This event has changes", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("Discard Changes", role: .destructive) { leave() }
            }

            Spacer()

            Button {
                commit()
            } label: {
                Image(systemName: "checkmark")
                    .font(.system(size: 16, weight: .bold))
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .disabled(!canSave)
            .glassEffect(canSave ? .regular.tint(CalendarStyle.olive.opacity(0.45)).interactive() : .regular, in: .circle)
            .accessibilityLabel(isNew ? "Add" : "Save")
            .confirmationDialog("This is a repeating event", isPresented: $askScope, titleVisibility: .visible) {
                Button("This Event Only") { send(series: false) }
                Button("All Events") { send(series: true) }
            }
            .background {
                Color.clear.confirmationDialog("Stop repeating?", isPresented: $confirmStop, titleVisibility: .visible) {
                    Button("Stop Repeating", role: .destructive) { send(series: true) }
                } message: {
                    Text("This event stays. The others in the series come off Google Calendar, past ones too.")
                }
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 10)
        .frame(height: Self.headerHeight)
        .animation(.snappy, value: canSave)
    }

    private func leave() {
        leaving = true
        dismiss()
    }

    private func commit() {
        guard canSave else { return }
        focus = nil
        if let event = item?.event, CalendarRules.repeats(event) {
            if draft.repeats != base.repeats {
                // How it repeats is the whole series' business.
                if draft.repeats == nil { confirmStop = true } else { send(series: true) }
                return
            }
            if fieldsChanged {
                askScope = true
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
        let nav = nav
        store.save(CardSave(event: item?.event, before: base, after: after, series: series)) { nav.problem = $0 }
        // Show the day a new event landed on.
        if isNew { nav.day = Day(draft.event.start) }
        leave()
    }

    // MARK: Rows

    private var divider: some View {
        Rectangle().fill(CalendarStyle.line).frame(height: 1)
    }

    /// A row: its icon in the column down the left, then what it holds.
    private func row(
        _ symbol: String?, alignment: VerticalAlignment = .firstTextBaseline, @ViewBuilder _ content: () -> some View
    ) -> some View {
        HStack(alignment: alignment, spacing: 12) {
            Image(systemName: symbol ?? "circle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .opacity(symbol == nil ? 0 : 1)
                .frame(width: 24)
                .accessibilityHidden(true)
            content()
            Spacer(minLength: 0)
        }
        .padding(.vertical, 11)
    }

    private func caption(_ title: String, badge: String? = nil) -> some View {
        HStack {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            Spacer()
            if let badge {
                Text(badge)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(CalendarStyle.amber)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(CalendarStyle.amber.opacity(0.15), in: .capsule)
            }
        }
    }

    // MARK: What

    private var titleRow: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2.5)
                .fill(CalendarStyle.muted(holder?.color ?? item?.color ?? CalendarRules.familyColor))
                .frame(width: 5)
            VStack(alignment: .leading, spacing: 6) {
                Group {
                    if editable {
                        TextField("Title", text: $draft.event.title, axis: .vertical)
                            .focused($focus, equals: .title)
                            .submitLabel(.done)
                            .onChange(of: draft.event.title) { _, text in
                                // Return ends the title; it doesn't break it.
                                if text.contains("\n") { endLine(\.event.title) }
                            }
                    } else {
                        Text(item?.title ?? draft.event.title)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .font(.system(.title2, design: .serif).weight(.semibold))
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
        .padding(.top, 6)
        .padding(.bottom, 16)
    }

    // MARK: When

    @ViewBuilder
    private var whenRows: some View {
        let event = draft.event
        row("clock", alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                if !event.allDay {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        timePart(.start, CalendarRules.clock(event.start))
                        Image(systemName: "arrow.right")
                            .font(.footnote)
                            .foregroundStyle(.tertiary)
                            .accessibilityLabel("to")
                        timePart(.end, CalendarRules.clock(event.end))
                        Text(CalendarRules.length(from: event.start, to: event.end))
                            .foregroundStyle(.secondary)
                    }
                    .font(.body.weight(.medium))
                }
                timePart(.date, dateText)
                    .font(event.allDay ? .body.weight(.medium) : .body)
            }
        }
        if let picking, picking != .until {
            picker(picking)
        }
        row(nil, alignment: .center) {
            Toggle("All-day", isOn: $draft.event.allDay)
                .tint(CalendarStyle.olive)
                .onChange(of: draft.event.allDay) { _, allDay in
                    if allDay, picking != .date { picking = nil }
                }
        }
        if onGoogle { repeatRows }
        divider
    }

    private func timePart(_ part: TimePart, _ text: String) -> some View {
        Button {
            focus = nil
            picking = picking == part ? nil : part
        } label: {
            Text(text)
                .foregroundStyle(picking == part ? CalendarStyle.accent : .primary)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    /// "Fri, Nov 20", with the day it ends on when that's another one.
    private var dateText: String {
        let event = draft.event
        let style = Date.FormatStyle().weekday(.abbreviated).month(.abbreviated).day()
        let sameYear = Calendar.current.isDate(event.start, equalTo: Date(), toGranularity: .year)
        func words(_ date: Date) -> String { date.formatted(sameYear ? style : style.year()) }
        if !event.allDay, Day(event.end) != Day(event.start) { return "\(words(event.start)) → \(words(event.end))" }
        return words(event.start)
    }

    @ViewBuilder
    private func picker(_ part: TimePart) -> some View {
        Group {
            switch part {
            case .start:
                // Moving the start keeps the event's length.
                DatePicker("Starts", selection: Binding(
                    get: { draft.event.start }, set: { CalendarRules.moveStart(&draft.event, to: $0) }
                ), displayedComponents: .hourAndMinute)
                .datePickerStyle(.wheel)
            case .end:
                // An end before the start snaps to a quarter of an hour after it.
                DatePicker("Ends", selection: Binding(
                    get: { draft.event.end }, set: { CalendarRules.moveEnd(&draft.event, to: $0) }
                ), in: draft.event.start..., displayedComponents: [.date, .hourAndMinute])
                .datePickerStyle(.wheel)
            case .date:
                DatePicker("Date", selection: Binding(
                    get: { draft.event.start },
                    set: { date in
                        let start = Day(date).at(minutes: CalendarRules.minutes(draft.event.start))
                        CalendarRules.moveStart(&draft.event, to: start)
                    }
                ), displayedComponents: .date)
                .datePickerStyle(.graphical)
            case .until:
                DatePicker("Ends", selection: Binding(
                    get: { draft.repeats?.until?.at(minutes: 12 * 60) ?? draft.event.start },
                    set: { draft.repeats?.until = Day($0) }
                ), in: draft.event.start..., displayedComponents: .date)
                .datePickerStyle(.graphical)
            }
        }
        .labelsHidden()
        .tint(CalendarStyle.olive)
        .frame(maxWidth: .infinity)
        .padding(.leading, 36)
        .transition(.opacity)
    }

    /// How it repeats, and until when.
    @ViewBuilder
    private var repeatRows: some View {
        let every = draft.repeats?.every
        row("repeat") {
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
                HStack {
                    Text(every.map(CalendarRules.repeatLabel) ?? "Repeat")
                        .foregroundStyle(every == nil ? .tertiary : .primary)
                    Spacer()
                    Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
        // A rule that hasn't been read can't be given an end.
        if let rule = draft.repeats, rule.every != .other("") {
            row(nil) {
                Button {
                    focus = nil
                    picking = picking == .until ? nil : .until
                } label: {
                    HStack(spacing: 6) {
                        Text("Ends").foregroundStyle(.secondary)
                        Text(rule.until.map(untilText) ?? "Never")
                            .foregroundStyle(picking == .until ? CalendarStyle.accent : .primary)
                        Spacer()
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
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
            }
            if picking == .until { picker(.until) }
        }
    }

    private func untilText(_ day: Day) -> String {
        day.at(minutes: 12 * 60).formatted(.dateTime.month(.abbreviated).day().year())
    }

    /// When, for an event that can't be changed here.
    @ViewBuilder
    private func lockedWhen(_ event: CalEvent) -> some View {
        let day = CalendarRules.day(of: event)
        row("clock") {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Self.weekdays[(day.weekdayIndex() + 1) % 7]), \(Self.months[day.month - 1]) \(day.day)")
                    .font(.body.weight(.medium))
                Text([CalendarRules.timeRange(event), event.rrule.map(CalendarRules.repeatText)].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let arrival = event.teamsnapArrival, arrival < event.start {
                    Text("Arrive by \(CalendarRules.clock(arrival))")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(CalendarStyle.accent)
                }
                if let opponent = event.teamsnapOpponent {
                    Text("vs. \(opponent)").font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        divider
    }

    // MARK: Where

    @ViewBuilder
    private var whereRows: some View {
        let location = draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        if editable {
            row("mappin.and.ellipse", alignment: .center) {
                TextField("Location", text: $draft.event.location, axis: .vertical)
                    .focused($focus, equals: .location)
                    .textContentType(.fullStreetAddress)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onChange(of: draft.event.location) { _, text in
                        if text.contains("\n") { endLine(\.event.location) } else { suggest(text) }
                    }
                if !location.isEmpty, focus != .location {
                    Button {
                        openMaps(location)
                    } label: {
                        Image(systemName: "arrow.triangle.turn.up.right.circle.fill")
                            .font(.title2)
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(CalendarStyle.accent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open in Maps")
                }
            }
            ForEach(focus == .location ? suggestions : []) { place in
                Button {
                    draft.event.location = place.location
                    suggestions = []
                    focus = nil
                } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(place.label).font(.subheadline).foregroundStyle(.primary)
                        if let secondary = place.secondary {
                            Text(secondary).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 36)
                    .padding(.vertical, 7)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            divider
        } else if !location.isEmpty {
            Button {
                openMaps(location)
            } label: {
                row("mappin.and.ellipse") {
                    Text(location)
                        .multilineTextAlignment(.leading)
                        .foregroundStyle(CalendarStyle.accent)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens Maps")
            divider
        }
    }

    /// Return in a one-line field that wraps: leave the field, and take the
    /// line break back out once it has let go (while it's still being
    /// written in, the field keeps the break's empty line).
    private func endLine(_ field: WritableKeyPath<CardDraft, String>) {
        focus = nil
        Task {
            draft[keyPath: field] = draft[keyPath: field].replacingOccurrences(of: "\n", with: "")
        }
    }

    private func openMaps(_ location: String) {
        var maps = URLComponents(string: "https://maps.apple.com/")!
        maps.queryItems = [URLQueryItem(name: "q", value: location)]
        if let url = maps.url { openURL(url) }
    }

    private func suggest(_ text: String) {
        search?.cancel()
        let query = text.trimmingCharacters(in: .whitespaces)
        guard focus == .location, query.count >= 2 else {
            suggestions = []
            return
        }
        search = Task {
            try? await Task.sleep(for: .milliseconds(220))
            guard !Task.isCancelled else { return }
            let found = await store.places(query)
            if !Task.isCancelled { suggestions = found }
        }
    }

    // MARK: The family's rows

    /// The faces in "Who's going": the family. Nobody on a drive block.
    private var roster: [Member] {
        item?.event.isDrive == true ? [] : store.board.members
    }

    private var answersTeamsnap: Bool { draft.rsvp != nil }

    /// Whether the kid's own going / not going applies: a kid's event, made
    /// already, that isn't TeamSnap's (which has its own RSVP).
    private var holderCanSitOut: Bool {
        !isNew && !answersTeamsnap && holder?.role == .kid
    }

    /// Whether drop-off and pick-up apply to the event as drafted: a kid's
    /// timed event away from home.
    private var needsDrives: Bool {
        let location = draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        return draft.holderGoing && !draft.event.allDay && item?.event.isDrive != true && holder?.role == .kid
            && !CalendarRules.isHome(location.isEmpty ? nil : location, homeAddress: store.board.logistics.homeAddress)
            && !store.board.parents.isEmpty
    }

    /// Whether the event can move to `member`'s calendar: one that can be
    /// edited, and for one already on Google a member with a Google calendar.
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
                    VStack(alignment: .leading, spacing: 8) {
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
                    }
                }
            }
            if !roster.isEmpty {
                row("person.2", alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) {
                        caption("Who's going")
                        ScrollView(.horizontal) {
                            HStack(spacing: 12) {
                                ForEach(roster) { member in face(member) }
                            }
                            .padding(.vertical, 2)
                            .padding(.horizontal, 2)
                        }
                        .scrollIndicators(.hidden)
                        // A held face lifts whole, name and all.
                        .scrollClipDisabled()
                        if !draft.holderGoing, let holder {
                            Text("\(holder.firstName) isn't going, so it's off everyone's calendar.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        if let note {
                            Text(note)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
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
                    row(nil) { Text(warning).font(.caption).foregroundStyle(.secondary) }
                }
            }
            divider
        }
    }

    /// One face in "Who's going". A tap is going or not; whoever's calendar
    /// it's on wears the calendar badge, and holding anyone else's face
    /// offers to move it to theirs.
    @ViewBuilder
    private func face(_ member: Member) -> some View {
        let holds = member.email == draft.event.memberEmail
        // With the kid whose event it is not going, nobody is.
        let going = holds ? draft.holderGoing : draft.holderGoing && draft.going.contains(member.email)
        let button = Button {
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
        if canHold(member) {
            button
                .contentShape(.contextMenuPreview, .rect(cornerRadius: 16, style: .continuous))
                .contextMenu {
                    Button("Move to \(member.firstName)'s Calendar", systemImage: "calendar") { move(to: member) }
                }
        } else {
            button
        }
    }

    /// Who's going, kept in the family's order so the same people are the
    /// same draft however they were tapped.
    private func setGoing(_ email: String, _ going: Bool) {
        var list = Set(draft.going)
        if going { list.insert(email) } else { list.remove(email) }
        draft.going = store.board.members.map(\.email).filter(list.contains)
    }

    /// A tap on whoever's calendar it's on. A kid can sit their own event
    /// out (through TeamSnap when it's TeamSnap's); a parent's event can't go
    /// on without them, so it says how to hand it over instead.
    private func toggleHolder(_ holder: Member) {
        if answersTeamsnap {
            draft.rsvp = draft.holderGoing ? .notGoing : .going
            draft.holderGoing.toggle()
        } else if holderCanSitOut {
            draft.holderGoing.toggle()
        } else if store.board.members.contains(where: canHold) {
            note = "It's on \(holder.firstName)'s calendar, so \(holder.firstName) counts as going. To take \(holder.firstName) off it, hold someone else's face and move it to theirs."
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
            // Tapping the one that's chosen clears it.
            draft.duties[duty] = current == state ? nil : state
        }
        return row("car", alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                caption(duty.label)
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
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
                            VStack(spacing: 4) {
                                Image(systemName: "minus")
                                    .font(.footnote.weight(.bold))
                                    .frame(width: 38, height: 38)
                                    .background(Color.primary.opacity(current?.isNa == true ? 0.16 : 0.06), in: .circle)
                                    .overlay(Circle().strokeBorder(Color.primary.opacity(current?.isNa == true ? 0.7 : 0), lineWidth: 2))
                                    .padding(3)
                                Text("Not needed").font(.caption2).foregroundStyle(.secondary)
                            }
                            .opacity(current == nil || current?.isNa == true ? 1 : 0.45)
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 2)
                }
                .scrollIndicators(.hidden)
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

    // MARK: Notes

    @ViewBuilder
    private var notesRow: some View {
        let notes = draft.event.notes
        if editable {
            row("text.alignleft", alignment: .top) {
                if !notes.isEmpty, !editingNotes, focus != .notes {
                    // Read: links open. A tap anywhere else starts writing.
                    Text(Self.linked(notes))
                        .tint(CalendarStyle.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                        .onTapGesture {
                            editingNotes = true
                            Task { focus = .notes }
                        }
                } else {
                    TextField("Notes", text: $draft.event.notes, axis: .vertical)
                        .lineLimit(1...14)
                        .focused($focus, equals: .notes)
                }
            }
            .frame(minHeight: 64, alignment: .top)
        } else if !notes.isEmpty {
            row("text.alignleft", alignment: .top) {
                Text(Self.linked(notes))
                    .tint(CalendarStyle.accent)
                    .textSelection(.enabled)
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

    // MARK: Where it's from, and deleting

    @ViewBuilder
    private var footer: some View {
        if let item {
            let from = item.sourceName ?? (editable ? nil : item.isTeamsnap ? "TeamSnap" : "a subscribed calendar")
            if let from {
                // Under the notes; with none, the rule above is already there.
                if editable || !draft.event.notes.isEmpty { divider }
                Label(editable ? from : "From \(from)", systemImage: item.isTeamsnap ? "baseball" : "calendar")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 12)
            }
            if editable {
                Button {
                    confirmDelete = true
                } label: {
                    Text("Delete Event")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .capsule)
                .padding(.top, 14)
                .confirmationDialog("Delete “\(item.event.title)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                    if CalendarRules.repeats(item.event) {
                        Button("Delete This Event Only", role: .destructive) { delete(item.event) }
                        Button("Delete All Events", role: .destructive) { delete(item.event, series: true) }
                    } else {
                        Button("Delete", role: .destructive) { delete(item.event) }
                    }
                } message: {
                    Text(deleteNote(item.event))
                }
            }
        }
    }

    private func deleteNote(_ event: CalEvent) -> String {
        if CalendarRules.repeats(event) {
            return "This is a repeating event. Deleting all of them takes the whole series off Google Calendar, past ones too."
        }
        return event.sourceType == .google ? "It comes off Google Calendar too." : "This can't be undone."
    }

    /// Straight away, whatever else the card had changed.
    private func delete(_ event: CalEvent, series: Bool = false) {
        let nav = nav
        store.delete(event, series: series) { nav.problem = $0 }
        leave()
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
        VStack(spacing: 4) {
            Group {
                if let member {
                    Avatar(member: member, size: 38)
                } else {
                    Text(String(name.prefix(1)))
                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .frame(width: 38, height: 38)
                        .background(CalendarStyle.muted(color), in: .circle)
                }
            }
            .padding(3)
            .overlay(Circle().strokeBorder(CalendarStyle.muted(color).opacity(selected ? 1 : 0), lineWidth: 2.5))
            .overlay(alignment: .bottomTrailing) {
                if holder {
                    Image(systemName: "calendar")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 18, height: 18)
                        .background(CalendarStyle.muted(color), in: .circle)
                        .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1.5))
                        .offset(x: 3, y: 3)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            Text(name)
                .font(.caption2.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? .primary : .secondary)
        }
        .opacity(selected ? 1 : 0.45)
        .animation(.snappy, value: selected)
        .animation(.snappy, value: holder)
    }
}
