import SwiftUI

/// An event, opened, or a new one being made: one card, with no separate
/// form. Every row is the thing itself and the way to change it: the title,
/// when (and how it repeats), where, who's going and whose calendar it's on,
/// who's driving, the TeamSnap RSVP, notes.
/// When and where each say what's so in one row, and a tap on it goes to a
/// screen of its own to change it: WhenScreen slides over from the right,
/// LocationCard comes up over the card.
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
    /// Slid over to the screen where the day, times and repeat are set.
    @State private var settingWhen = false
    @State private var confirmDiscard = false
    @State private var confirmDelete = false
    @State private var askScope = false
    @State private var confirmStop = false
    /// The location card is open over this one.
    @State private var placing = false
    /// That card's search, a new one each time it opens.
    @State private var placeSession = UUID()
    /// A picked place's full address, on its way.
    @State private var lookup: Task<Void, Never>?
    @State private var editingNotes = false
    @State private var contentHeight: CGFloat = 380
    /// Pulled up to full height, or up there for the keyboard.
    @State private var tall = false
    /// The rows are scrolled to their top, where a pull down is a pull on the card.
    @State private var atTop = true
    /// On its way out by its own doing, not because the event went away.
    @State private var leaving = false
    @FocusState private var focus: Field?

    private enum Field { case title, notes }

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
    /// The trip's zone, when the event was opened on a day away. From the
    /// event as opened, so the clock doesn't jump as its date is changed.
    private var zone: TimeZone? { base.event.allDay ? nil : store.board.zone(at: base.event.start) }
    /// The calendar the card's times are read and set in.
    private var clock: Calendar {
        var calendar = Calendar.current
        if let zone { calendar.timeZone = zone }
        return calendar
    }
    /// "Costa Rica time · 2h ahead", when that's whose time the card is in.
    private var zoneNote: String? {
        zone.map { CalendarRules.zoneNote($0, home: .current, at: draft.event.start) }
    }
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
        // The card, and the screen its time row slides over to from the right.
        ZStack {
            if settingWhen {
                WhenScreen(
                    draft: $draft, clock: clock, zoneNote: zoneNote, canRepeat: onGoogle,
                    back: { settingWhen = false }
                )
                // A swipe back from the left edge, as a pushed screen has.
                .simultaneousGesture(
                    DragGesture(minimumDistance: 30).onEnded { drag in
                        let across = drag.translation.width
                        if drag.startLocation.x < 40, across > 70, across > abs(drag.translation.height) * 2 {
                            settingWhen = false
                        }
                    }
                )
                .transition(.move(edge: .trailing))
            } else {
                front.transition(.move(edge: .leading))
            }
        }
        .clipped()
        .animation(.snappy(duration: 0.3), value: settingWhen)
        .presentationDetents(detents, selection: detent)
        .presentationDragIndicator(.visible)
        // The page's paper, part see-through: glass enough to feel the day
        // behind it, solid enough that a bright block doesn't bleed into the words.
        .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
        .interactiveDismissDisabled(hasWork)
        // A swipe down with changes doesn't close the card (above); it asks
        // about them, as ✕ does. Not on the time screen, where a wheel may
        // be under the finger.
        .simultaneousGesture(
            DragGesture(minimumDistance: 40).onEnded { drag in
                let down = drag.translation.height
                guard hasWork, atTop, !settingWhen, focus == nil else { return }
                if down > 90, down > abs(drag.translation.width) * 2 { confirmDiscard = true }
            }
        )
        // On the card as a whole, not its front: the front is away while the
        // time screen is up, and a new event's title is focused only once.
        .onAppear { if isNew { focus = .title } }
        // The event read again under the open card: what was changed here
        // stays, the rest follows.
        .onChange(of: item) { _, item in
            guard let item else { return }
            let fresh = store.cardDraft(for: item)
            draft = draft.rebased(from: base, onto: fresh)
            base = fresh
        }
    }

    private var front: some View {
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
        .animation(.snappy, value: note)
        .animation(.snappy, value: needsDrives)
        .modifier(ConvertAlert(active: true))
        .sheet(isPresented: $placing) {
            LocationCard(current: draft.event.location, session: placeSession) { setPlace($0, from: $1) }
        }
        .onChange(of: focus) { _, field in
            // Up out of the keyboard's way, and back to its own height after.
            tall = field != nil
            if field != .notes { editingNotes = false }
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
            // The time screen has a month to show: it gets the whole height.
            get: { tall || settingWhen ? .large : fits.map { .height($0) } ?? .large },
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

    /// When it is, in words, and the one thing to tap to change any of it:
    /// the day, the times, all-day, how it repeats. They're all set on the
    /// screen it slides over to (WhenScreen), so the card only says what's so.
    @ViewBuilder
    private var whenRows: some View {
        let event = draft.event
        Button {
            focus = nil
            settingWhen = true
        } label: {
            row("clock", alignment: .top) {
                HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 5) {
                    if !event.allDay {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(CalendarRules.clock(event.start, in: clock))
                            Image(systemName: "arrow.right")
                                .font(.footnote)
                                .foregroundStyle(.tertiary)
                                .accessibilityLabel("to")
                            Text(CalendarRules.clock(event.end, in: clock))
                            Text(CalendarRules.length(from: event.start, to: event.end))
                                .foregroundStyle(.secondary)
                        }
                        .font(.body.weight(.medium))
                    }
                    Text(event.allDay ? "\(dateText) · All day" : dateText)
                        .font(event.allDay ? .body.weight(.medium) : .body)
                    if let repeatText {
                        Label(repeatText, systemImage: "repeat")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if !event.allDay, let zoneNote {
                        Text(zoneNote)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(CalendarStyle.accent)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
                    .padding(.trailing, 8)
                }
                .frame(maxWidth: .infinity)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .accessibilityHint("Sets the date, time, all-day and repeat")
        divider
    }

    /// "Fri, Nov 20", with the day it ends on when that's another one.
    private var dateText: String {
        let event = draft.event
        let style = Date.FormatStyle(timeZone: clock.timeZone).weekday(.abbreviated).month(.abbreviated).day()
        let sameYear = clock.isDate(event.start, equalTo: Date(), toGranularity: .year)
        func words(_ date: Date) -> String { date.formatted(sameYear ? style : style.year()) }
        if !event.allDay, Day(event.end, in: clock) != Day(event.start, in: clock) { return "\(words(event.start)) → \(words(event.end))" }
        return words(event.start)
    }

    /// "Every week", "Every week until Dec 31, 2026"; nil when it happens once.
    private var repeatText: String? {
        guard let rule = draft.repeats else { return nil }
        let every = CalendarRules.repeatLabel(rule.every)
        return rule.until.map { "\(every) until \(WhenScreen.untilText($0))" } ?? every
    }

    /// When, for an event that can't be changed here.
    @ViewBuilder
    private func lockedWhen(_ event: CalEvent) -> some View {
        let day = CalendarRules.day(of: event, in: clock)
        row("clock") {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Self.weekdays[(day.weekdayIndex() + 1) % 7]), \(Self.months[day.month - 1]) \(day.day)")
                    .font(.body.weight(.medium))
                Text([CalendarRules.timeRange(event, in: clock), event.rrule.map(CalendarRules.repeatText)].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if !event.allDay, let zoneNote {
                    Text(zoneNote)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(CalendarStyle.accent)
                }
                if let arrival = event.teamsnapArrival, arrival < event.start {
                    Text("Arrive by \(CalendarRules.clock(arrival, in: clock))")
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

    /// Where: with none, a tap opens the location card. With one, a tap
    /// opens Maps, since where it is gets looked up far more than changed;
    /// changing it is under the ⋯.
    @ViewBuilder
    private var whereRows: some View {
        let location = draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        let somewhere = CalendarRules.isPlace(location)
        // The place is the location without any link in it. On a call,
        // what's left that isn't a place ("Zoom") is the call's row to say.
        let place = somewhere || joinURL == nil ? CalendarRules.placeText(location) : nil
        if let joinURL {
            row("video") {
                Button {
                    if let url = URL(string: joinURL) { openURL(url) }
                } label: {
                    Text("Join \(CalendarRules.joinName(joinURL))")
                        .foregroundStyle(CalendarStyle.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the call")
                Menu {
                    Button("Copy Link", systemImage: "doc.on.doc") { UIPasteboard.general.string = joinURL }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 30, alignment: .trailing)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Call Options")
            }
            divider
        }
        if editable, place == nil {
            Button {
                self.place()
            } label: {
                row("mappin.and.ellipse") {
                    Text("Location").foregroundStyle(.tertiary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Searches for a place")
            divider
        } else if let place {
            row("mappin.and.ellipse") {
                if somewhere {
                    Button {
                        openMaps(place)
                    } label: {
                        placeLabel(place)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens Maps")
                } else {
                    // "TBD": said, with nowhere to look up.
                    Text(place).frame(maxWidth: .infinity, alignment: .leading)
                }
                if editable {
                    Menu {
                        Button("Change", systemImage: "pencil") { self.place() }
                        Button("Copy Address", systemImage: "doc.on.doc") { UIPasteboard.general.string = place }
                        Button("Remove", systemImage: "trash", role: .destructive) { setPlace("", from: nil) }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 44, height: 30, alignment: .trailing)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Location Options")
                }
            }
            divider
        }
    }

    /// A place on two lines: its name, then the rest of its address.
    private func placeLabel(_ location: String) -> some View {
        let parts = CalendarRules.placeParts(location)
        return VStack(alignment: .leading, spacing: 2) {
            Text(parts.name).foregroundStyle(CalendarStyle.accent)
            if let rest = parts.rest {
                Text(rest).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }

    private func place() {
        focus = nil
        placeSession = UUID()
        placing = true
    }

    /// The location card's answer. A suggestion comes without its street
    /// number or zip, so it's shown as it is at once and swapped for the
    /// full address when that arrives, unless the location has moved on.
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

    /// Return in a one-line field that wraps: leave the field, and take the
    /// line break back out once it has let go (while it's still being
    /// written in, the field keeps the break's empty line).
    private func endLine(_ field: WritableKeyPath<CardDraft, String>) {
        focus = nil
        Task {
            draft[keyPath: field] = draft[keyPath: field].replacingOccurrences(of: "\n", with: "")
        }
    }

    /// The link to join the event's call by, as last read (the database
    /// finds it; a link typed just now shows once it's saved).
    private var joinURL: String? { item?.event.joinURL }

    private func openMaps(_ location: String) {
        var maps = URLComponents(string: "https://maps.apple.com/")!
        maps.queryItems = [URLQueryItem(name: "q", value: location)]
        if let url = maps.url { openURL(url) }
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
    /// timed event away from home, in person.
    private var needsDrives: Bool {
        let location = draft.event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        return draft.holderGoing && !draft.event.allDay && item?.event.isDrive != true && holder?.role == .kid
            && !CalendarRules.isHome(location.isEmpty ? nil : location, homeAddress: store.board.logistics.homeAddress)
            && !CalendarRules.isRemote(location: location, joinURL: joinURL)
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
