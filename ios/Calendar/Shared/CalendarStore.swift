import Foundation
import MasonKit
import Observation
import Supabase
import WidgetKit

/// The family calendar on this device. It opens on the local copy (a file, so
/// it's there with no signal), reads the rest straight from Supabase under the
/// member's sign-in, and sends every change through the website
/// (`CalendarAPI`), showing it at once and putting it back if the website
/// refuses or can't be reached. Nothing queues across launches.
@MainActor
@Observable
final class CalendarStore {
    private(set) var snapshot = CalendarSnapshot() {
        didSet { board = Board.build(snapshot) }
    }
    /// The calendar worked out from the copy; what the views read.
    private(set) var board = Board()
    /// Members' photos, by email.
    private(set) var photos: [String: Data] = [:]
    /// False until there's something to show (a saved copy, or the first read).
    private(set) var loaded = false
    private(set) var refreshing = false
    /// The last read didn't reach the server.
    private(set) var offline = false
    /// Google just refused a change to an event it made itself: the offer to
    /// swap it for a copy that can be changed.
    var conversion: Conversion?
    /// Canned family with no sign-in or network: `--demo`, for the simulator.
    let isDemo: Bool

    private var owner: UUID?
    private var followUp: Task<Void, Never>?
    /// Changes on their way to the website. Reading waits for them, so a
    /// read that left before a change landed can't put the old state back.
    private var sending = 0
    /// New events shown before the website has made them, under an id made
    /// up here; each one's real id once it has one, and the request that's
    /// fetching it.
    private var provisional: [UUID: CalEvent] = [:]
    private var serverIDs: [UUID: UUID] = [:]
    private var creating: [UUID: Task<UUID?, Never>] = [:]
    private var db: SupabaseClient { Session.shared.client }

    static var isDemoLaunch: Bool { CommandLine.arguments.contains("--demo") }

    init() {
        isDemo = false
    }

    init(demo: CalendarSnapshot) {
        isDemo = true
        snapshot = demo
        board = Board.build(demo)
        loaded = true
        // The widget shows the made-up family too, under a made-up member.
        let user = UUID(uuidString: "00000000-0000-0000-0000-00000000DE30")!
        if let data = try? JSONEncoder().encode(demo) { try? data.write(to: CalendarShared.copy(user), options: .atomic) }
        CalendarShared.who = .init(user: user, email: DemoCalendar.me)
        reloadWidget()
    }

    var lastUpdated: Date? { snapshot.fetchedAt }

    // MARK: The local copy

    /// Open on what this member last saw here.
    func open(for user: UUID, email: String?) {
        guard !isDemo, owner != user else { return }
        owner = user
        if let email { CalendarShared.who = .init(user: user, email: email.lowercased()) }
        if let data = try? Data(contentsOf: CalendarShared.copy(user)),
           let saved = try? JSONDecoder().decode(CalendarSnapshot.self, from: data) {
            snapshot = saved
            loaded = true
            for member in saved.members {
                if let data = try? Data(contentsOf: CalendarShared.photo(member.email)) { photos[member.email] = data }
            }
        }
    }

    private func save() {
        guard !isDemo, let owner, let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: CalendarShared.copy(owner), options: .atomic)
        reloadWidget()
    }

    /// The home screen widget reads the copy just saved. (Not from inside the
    /// widget, which is what's reading.)
    private func reloadWidget() {
        #if !WIDGET_EXTENSION
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    /// Another member signing in starts from nothing of the last one's.
    func forget() {
        if let owner { try? FileManager.default.removeItem(at: CalendarShared.copy(owner)) }
        owner = nil
        CalendarShared.who = nil
        reloadWidget()
        followUp?.cancel()
        provisional = [:]
        serverIDs = [:]
        creating = [:]
        snapshot = CalendarSnapshot()
        photos = [:]
        loaded = false
    }

    // MARK: Reading

    /// Read the calendar again. Keeps the copy when there's no signal.
    func refresh() async {
        guard !isDemo, Session.shared.isSignedIn, !refreshing, sending == 0 else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            async let members = fetchMembers()
            async let sources = fetchSources()
            async let events = fetchEvents()
            async let going = fetchGoing()
            async let duties = fetchDuties()
            async let logistics = fetchLogistics()
            var fresh = CalendarSnapshot()
            fresh.members = try await members
            fresh.sources = try await sources
            fresh.events = try await events
            fresh.going = try await going
            fresh.duties = try await duties
            fresh.logistics = (try? await logistics) ?? snapshot.logistics
            fresh.fetchedAt = Date()
            // A change sent while this was reading: what was read may be from
            // before it. Leave the screen as it is; the read that follows the
            // change brings it all in.
            guard sending == 0 else { return }
            // A new event stays on screen under its made-up id until the
            // website's own row for it has been read.
            let read = Set(fresh.events.map(\.id))
            for (id, event) in provisional {
                if let real = serverIDs[id], read.contains(real) {
                    provisional[id] = nil
                    serverIDs[id] = nil
                } else {
                    fresh.events.append(event)
                }
            }
            snapshot = fresh
            offline = false
            loaded = true
            save()
            await loadPhotos()
        } catch {
            offline = true
            // Nothing saved and nothing read: still show the (empty) calendar
            // rather than a spinner forever.
            loaded = true
        }
    }

    /// Have the website pull from Google, TeamSnap and the ICS feeds (its
    /// light page-load sync), then read again.
    func sync() async {
        guard !isDemo else { return }
        await refresh()
        if (try? await CalendarAPI.post("sync")) != nil { await refresh() }
    }

    /// Read again a few seconds after a change, once the website has finished
    /// what it does afterwards (drive blocks, Google guests).
    private func refreshSoon() {
        guard !isDemo else { return }
        followUp?.cancel()
        followUp = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            await self?.refresh()
        }
    }

    private static let pageSize = 1000

    private func fetchEvents() async throws -> [CalEvent] {
        // The website's window: about two months back, six ahead.
        let from = Instant.string(Date().addingTimeInterval(-60 * 86_400))
        let to = Instant.string(Date().addingTimeInterval(180 * 86_400))
        var all: [CalEvent] = []
        while true {
            let page: [CalEvent] = try await db.from("calendar_events")
                .select(CalEvent.columns)
                .eq("is_canceled", value: false)
                .not("member_email", operator: .is, value: "null")
                .gte("start_time", value: from)
                .lte("start_time", value: to)
                .order("start_time")
                .order("id")
                .range(from: all.count, to: all.count + Self.pageSize - 1)
                .execute()
                .value
            all += page
            if page.count < Self.pageSize { return all }
        }
    }

    private func fetchMembers() async throws -> [Member] {
        struct Row: Decodable {
            let email: String
            let name: String?
            let role: String
            let color: String?
            let primary_calendar_id: String?
        }
        struct Photo: Decodable {
            let member_email: String
            let storage_path: String
        }
        async let memberRows: [Row] = db.from("family_members")
            .select("email, name, role, color, primary_calendar_id")
            .order("role")
            .order("name")
            .execute()
            .value
        async let photoRows: [Photo] = db.from("journal_member_photos")
            .select("member_email, storage_path")
            .eq("is_primary", value: true)
            .execute()
            .value
        let rows = try await memberRows
        let paths = Dictionary(
            ((try? await photoRows) ?? []).map { ($0.member_email.lowercased(), $0.storage_path) },
            uniquingKeysWith: { a, _ in a }
        )
        // The website's order: kids come first from the query, and the
        // calendar reads better adults first.
        return rows.reversed().map { row in
            let email = row.email.lowercased()
            return Member(
                email: email, name: row.name, role: MemberRole(rawValue: row.role) ?? .kid,
                color: row.color ?? CalendarRules.hashColor(row.email),
                primaryCalendarID: row.primary_calendar_id, photoPath: paths[email]
            )
        }
    }

    private func fetchSources() async throws -> [CalSource] {
        struct Row: Decodable {
            let id: UUID
            let member_email: String?
            let source_type: SourceType
            let teamsnap_team_name: String?
            let teamsnap_player_member_id: Int?
            let google_calendar_id: String?
            let nickname: String?
            let is_active: Bool
        }
        let rows: [Row] = try await db.from("calendar_sources")
            .select("id, member_email, source_type, teamsnap_team_name, teamsnap_player_member_id, google_calendar_id, nickname, is_active")
            .order("created_at")
            .execute()
            .value
        return rows.map {
            CalSource(
                id: $0.id, memberEmail: $0.member_email?.lowercased(), sourceType: $0.source_type,
                teamName: $0.teamsnap_team_name, teamsnapPlayerID: $0.teamsnap_player_member_id,
                googleCalendarID: $0.google_calendar_id, nickname: $0.nickname, isActive: $0.is_active
            )
        }
    }

    private func fetchGoing() async throws -> [UUID: [String]] {
        struct Row: Decodable {
            let event_id: UUID
            let member_email: String
        }
        var out: [UUID: [String]] = [:]
        var read = 0
        while true {
            let page: [Row] = try await db.from("event_attendees")
                .select("event_id, member_email")
                .eq("going", value: true)
                .order("event_id")
                .order("member_email")
                .range(from: read, to: read + Self.pageSize - 1)
                .execute()
                .value
            for row in page { out[row.event_id, default: []].append(row.member_email.lowercased()) }
            read += page.count
            if page.count < Self.pageSize { return out }
        }
    }

    private func fetchDuties() async throws -> [UUID: [DutyKind: DutyState]] {
        struct Row: Decodable {
            let event_id: UUID
            let duty: DutyKind
            let assignee_email: String?
            let is_na: Bool
            let caregiver: String?
        }
        var out: [UUID: [DutyKind: DutyState]] = [:]
        var read = 0
        while true {
            let page: [Row] = try await db.from("event_duty_assignments")
                .select("event_id, duty, assignee_email, is_na, caregiver")
                .order("event_id")
                .order("duty")
                .range(from: read, to: read + Self.pageSize - 1)
                .execute()
                .value
            for row in page {
                out[row.event_id, default: [:]][row.duty] = DutyState(
                    assignee: row.assignee_email?.lowercased(), isNa: row.is_na, caregiver: row.caregiver
                )
            }
            read += page.count
            if page.count < Self.pageSize { return out }
        }
    }

    private func fetchLogistics() async throws -> Logistics {
        struct Row: Decodable {
            let home_address: String?
            let drive_buffer_minutes: Int?
        }
        let rows: [Row] = try await db.from("calendar_logistics_settings")
            .select("home_address, drive_buffer_minutes")
            .eq("id", value: 1)
            .limit(1)
            .execute()
            .value
        return Logistics(homeAddress: rows.first?.home_address, bufferMinutes: rows.first?.drive_buffer_minutes ?? 5)
    }

    /// Members' photos, from the private bucket every member can read. Kept
    /// on disk; fetched again only when a member's photo changes.
    private func loadPhotos() async {
        let known = UserDefaults.standard.dictionary(forKey: "calendar.photoPaths") as? [String: String] ?? [:]
        var paths = known
        for member in snapshot.members {
            guard let path = member.photoPath else {
                photos[member.email] = nil
                continue
            }
            if photos[member.email] != nil, known[member.email] == path { continue }
            guard let data = try? await db.storage.from("member-photos").download(path: path) else { continue }
            photos[member.email] = data
            paths[member.email] = path
            try? data.write(to: CalendarShared.photo(member.email), options: .atomic)
        }
        UserDefaults.standard.set(paths, forKey: "calendar.photoPaths")
    }

    /// The event's id as the website knows it. An event made here a moment
    /// ago waits for the website to have made it.
    private func id(_ event: CalEvent) async -> String {
        var id = event.id
        if let making = creating[id] { id = await making.value ?? id }
        return (serverIDs[id] ?? id).uuidString.lowercased()
    }

    private func mutate(_ id: UUID, _ change: (inout CalEvent) -> Void) {
        guard let at = snapshot.events.firstIndex(where: { $0.id == id }) else { return }
        change(&snapshot.events[at])
    }

    // MARK: Creating and editing

    /// The Google calendar a new event for `member` goes on, when they have
    /// one; nil makes it app-only.
    func sourceForNewEvent(_ member: String) -> UUID? {
        snapshot.sources.first { $0.sourceType == .google && $0.isActive && $0.memberEmail == member }?.id
    }

    func draft(for event: CalEvent) -> EventDraft {
        if event.allDay {
            // The date is the stored UTC date; the hidden times are 9 to 10.
            let day = CalendarRules.day(of: event)
            return EventDraft(
                title: event.title, memberEmail: event.memberEmail,
                start: day.at(minutes: 9 * 60), end: day.at(minutes: 10 * 60), allDay: true,
                location: event.location ?? "", notes: event.notes ?? ""
            )
        }
        return EventDraft(
            title: event.title, memberEmail: event.memberEmail,
            start: event.start, end: event.end ?? event.start.addingTimeInterval(3600), allDay: false,
            location: event.location ?? "", notes: event.notes ?? ""
        )
    }

    // Creating, editing and deleting show at once and close the card; the
    // website hears in the background. If it refuses, or can't be reached,
    // the change is put back and `report` is told why.

    /// A new event, on screen straight away under an id made up here. One
    /// that repeats shows its first occurrence; the rest come with the read
    /// that follows.
    @discardableResult
    private func create(_ draft: EventDraft, rule: String?, report: @escaping (String) -> Void) -> CalEvent {
        let sourceID = sourceForNewEvent(draft.memberEmail)
        var event = applied(draft, to: CalEvent(memberEmail: draft.memberEmail, title: "", start: draft.start))
        if sourceID != nil {
            event.sourceID = sourceID
            event.sourceType = .google
        }
        // Only a Google calendar can hold a repeating event.
        let rule = sourceID == nil ? nil : rule
        event.rrule = rule
        snapshot.events.append(event)
        guard !isDemo else { return event }
        let local = event.id
        provisional[local] = event
        sending += 1
        let request = Task { [weak self] () -> UUID? in
            let reply = try? await CalendarAPI.post(
                "create", ["event": CalendarAPI.body(draft, sourceID: sourceID, rule: rule.map { .some($0) })]
            )
            guard let self else { return nil }
            self.sending -= 1
            self.creating[local] = nil
            if let id = reply?.id {
                self.serverIDs[local] = id
                self.refreshSoon()
                return id
            }
            self.provisional[local] = nil
            self.snapshot.events.removeAll { $0.id == local }
            report("“\(event.title)” wasn't added. Check your connection and try again.")
            return nil
        }
        creating[local] = request
        return event
    }

    // MARK: The event card

    /// An event as the card opens on it.
    func cardDraft(for item: EventItem) -> CardDraft {
        let event = item.event
        var draft = CardDraft(event: draft(for: event), going: item.attendees, duties: snapshot.duties[event.id] ?? [:])
        if CalendarRules.repeats(event) {
            draft.repeats = event.rrule.map { CalendarRules.repeats(from: $0) } ?? Repeat(every: .other(""))
        } else if let rule = event.rrule {
            // Made here a moment ago, or the demo's: the rule without a series yet.
            draft.repeats = CalendarRules.repeats(from: rule)
        }
        if board.hasRsvp(event) {
            draft.rsvp = event.teamsnapRsvp ?? .noReply
            draft.holderGoing = !(event.teamsnapRsvp == .notGoing || event.ownerNotGoing)
        } else if board.hasOwnerGoing(event) {
            draft.holderGoing = !event.ownerNotGoing
        }
        return draft
    }

    /// The card's ✓. Everything it changed shows at once; the website hears
    /// each part in the background, and a part it refuses is put back, with
    /// `report` told why, while the rest stands.
    func save(_ save: CardSave, report: @escaping (String) -> Void) {
        if let event = save.event {
            saveChanges(to: event, save, report: report)
        } else {
            saveNew(save.after, report: report)
        }
    }

    private func saveNew(_ draft: CardDraft, report: @escaping (String) -> Void) {
        let rule = draft.repeats.flatMap { CalendarRules.rrule($0, allDay: draft.event.allDay) }
        let event = create(draft.event, rule: rule, report: report)
        let local = event.id
        if !draft.going.isEmpty { snapshot.going[local] = draft.going }
        if !draft.duties.isEmpty { snapshot.duties[local] = draft.duties }
        guard !isDemo, let making = creating[local], !(draft.going.isEmpty && draft.duties.isEmpty) else { return }
        sending += 1
        Task { [weak self] in
            guard let self else { return }
            defer { self.sending -= 1 }
            // Who's going and who's driving wait for the event to exist.
            guard let real = await making.value else {
                self.snapshot.going[local] = nil
                self.snapshot.duties[local] = nil
                return
            }
            let id = real.uuidString.lowercased()
            let sent = Sent()
            for member in draft.going {
                await self.part(sent, "Couldn't add who's going to “\(event.title)”", report) {
                    self.snapshot.going[local]?.removeAll { $0 == member }
                } _: {
                    try await CalendarAPI.post("going", ["id": id, "memberEmail": member, "going": true])
                }
            }
            for (duty, state) in draft.duties {
                await self.part(sent, "The \(duty.label.lowercased()) for “\(event.title)” wasn't saved", report) {
                    self.snapshot.duties[local]?[duty] = nil
                } _: {
                    try await CalendarAPI.post("duty", ["id": id, "duty": duty.rawValue, "state": CalendarAPI.body(state)])
                }
            }
            self.refreshSoon()
        }
    }

    private func saveChanges(to event: CalEvent, _ save: CardSave, report: @escaping (String) -> Void) {
        let id = event.id
        let (was, now) = (save.before, save.after)
        if isDemo, Self.isDemoGoogleMade(event) {
            conversion = Conversion(event: event, save: save)
            return
        }
        let row = snapshot.events.first { $0.id == id } ?? event
        let title = now.event.title.trimmingCharacters(in: .whitespacesAndNewlines)

        // What changed. Whose calendar it's on is its own part: the fields
        // are compared, and sent, as if it hadn't moved.
        var fields = now.event
        fields.memberEmail = was.event.memberEmail
        let fieldsChanged = fields != was.event
        let ruleChanged = was.repeats != now.repeats
        let moved = was.event.memberEmail != now.event.memberEmail
        let inSeries = CalendarRules.repeats(row)
        let whole = inSeries && (save.series || ruleChanged)
        let rule = now.repeats.flatMap { CalendarRules.rrule($0, allDay: now.event.allDay) }
        let goingAsMoved = moved
            ? CalendarRules.goingAfterMove(was.going, from: was.event.memberEmail, to: now.event.memberEmail)
            : was.going
        let goingChanges = Set(now.going).symmetricDifference(goingAsMoved).sorted()
        let dutyChanges = DutyKind.allCases.filter { was.duties[$0] != now.duties[$0] }
        let answersTeamsnap = now.rsvp != nil
        let rsvpChanged = answersTeamsnap && was.rsvp != now.rsvp
        let holderGoingChanged = !answersTeamsnap && was.holderGoing != now.holderGoing

        // Show all of it now.
        let siblings = whole ? CalendarRules.series(of: row, in: snapshot.events).filter { $0.id != id } : []
        var removed: [CalEvent] = []
        if fieldsChanged || ruleChanged {
            var after = applied(fields, to: row)
            if ruleChanged {
                after.rrule = rule
                if rule == nil {
                    // Stops repeating: this one stays, the others go.
                    after.recurringEventID = nil
                    let gone = Set(siblings.map(\.id))
                    let isGone: (CalEvent) -> Bool = { gone.contains($0.id) || $0.driveSourceEventID.map(gone.contains) == true }
                    removed = snapshot.events.filter(isGone)
                    snapshot.events.removeAll(where: isGone)
                } else if isDemo, !inSeries {
                    after.recurringEventID = "demo-\(id.uuidString)"
                }
            }
            set(after)
            if rule != nil || !ruleChanged {
                // Every occurrence takes the edit: the words as they are, a
                // new time as the same move on the clock.
                let shift = after.start.timeIntervalSince(row.start)
                let length = after.end.map { $0.timeIntervalSince(after.start) }
                for sibling in siblings {
                    mutate(sibling.id) {
                        $0.title = after.title
                        $0.location = after.location
                        $0.notes = after.notes
                        if ruleChanged { $0.rrule = rule }
                        guard after.allDay == row.allDay, $0.allDay == row.allDay else { return }
                        $0.start = $0.start.addingTimeInterval(shift)
                        $0.end = length.map($0.start.addingTimeInterval)
                    }
                }
            }
        }
        let putFieldsBack = {
            for before in [row] + siblings {
                self.mutate(before.id) {
                    $0.title = before.title
                    $0.location = before.location
                    $0.notes = before.notes
                    $0.allDay = before.allDay
                    $0.start = before.start
                    $0.end = before.end
                    $0.rrule = before.rrule
                    $0.recurringEventID = before.recurringEventID
                }
            }
            self.snapshot.events += removed.filter { gone in !self.snapshot.events.contains { $0.id == gone.id } }
        }
        if moved { mutate(id) { $0.memberEmail = now.event.memberEmail } }
        let goingBefore = snapshot.going[id]
        if moved || !goingChanges.isEmpty { snapshot.going[id] = now.going }
        let isKids = board.member(now.event.memberEmail)?.role == .kid
        if rsvpChanged {
            // A TeamSnap "no" is the kid not going, as the website has it.
            mutate(id) {
                $0.teamsnapRsvp = now.rsvp
                if isKids { $0.ownerNotGoing = now.rsvp == .notGoing }
            }
        }
        if holderGoingChanged { mutate(id) { $0.ownerNotGoing = !now.holderGoing } }
        let putAnswerBack = {
            self.mutate(id) {
                $0.teamsnapRsvp = row.teamsnapRsvp
                $0.ownerNotGoing = row.ownerNotGoing
            }
        }
        for duty in dutyChanges { snapshot.duties[id, default: [:]][duty] = now.duties[duty] }

        guard !isDemo else { return }
        sending += 1
        Task { [weak self] in
            guard let self else { return }
            defer { self.sending -= 1 }
            let sid = await self.id(event)
            let sent = Sent()

            if fieldsChanged || ruleChanged {
                var body: [String: Any] = [
                    "id": sid,
                    "event": CalendarAPI.body(fields, sourceID: event.sourceID, rule: ruleChanged ? .some(rule) : nil),
                ]
                if whole { body["scope"] = "series" }
                do {
                    // Changing a long series takes Google a while.
                    _ = try await CalendarAPI.post("update", body, timeout: 90)
                } catch CalendarProblem.googleMade {
                    // Nothing saved; offer the swap, which makes this save afterwards.
                    putFieldsBack()
                    self.mutate(id) { $0.memberEmail = row.memberEmail }
                    self.snapshot.going[id] = goingBefore
                    putAnswerBack()
                    for duty in dutyChanges { self.snapshot.duties[id, default: [:]][duty] = was.duties[duty] }
                    self.conversion = Conversion(event: row, save: save)
                    return
                } catch {
                    putFieldsBack()
                    sent.offline = error as? CalendarProblem == .offline
                    report("“\(row.title)” wasn't saved: \(error.localizedDescription)")
                }
            }
            if moved {
                // Whoever had it stays on as going, as the website records.
                let reply = await self.part(sent, "“\(title)” couldn't move calendars", report) {
                    self.mutate(id) { $0.memberEmail = row.memberEmail }
                    self.snapshot.going[id] = goingBefore
                } _: {
                    try await CalendarAPI.post("owner", ["id": sid, "memberEmail": now.event.memberEmail])
                }
                if let warning = reply?.warning { report(warning) }
            }
            for member in goingChanges {
                let going = now.going.contains(member)
                let reply = await self.part(sent, "Couldn't change who's going to “\(title)”", report) {
                    self.snapshot.going[id]?.removeAll { $0 == member }
                    if !going { self.snapshot.going[id, default: []].append(member) }
                } _: {
                    try await CalendarAPI.post("going", ["id": sid, "memberEmail": member, "going": going])
                }
                // Google made this event and won't take guests: it's saved
                // here, and the offer to swap it for a copy says the rest.
                if reply?.convertible == true {
                    self.conversion = Conversion(event: row)
                } else if let warning = reply?.warning {
                    report(warning)
                }
            }
            if rsvpChanged, let answer = now.rsvp {
                await self.part(sent, "The RSVP for “\(title)” wasn't sent", report, revert: putAnswerBack) {
                    try await CalendarAPI.post("rsvp", ["id": sid, "status": answer.rawValue])
                }
            }
            if holderGoingChanged {
                let reply = await self.part(sent, "“\(title)” wasn't changed", report, revert: putAnswerBack) {
                    try await CalendarAPI.post("owner-going", ["id": sid, "going": now.holderGoing])
                }
                if let warning = reply?.warning { report(warning) }
            }
            for duty in dutyChanges {
                await self.part(sent, "The \(duty.label.lowercased()) for “\(title)” wasn't saved", report) {
                    self.snapshot.duties[id, default: [:]][duty] = was.duties[duty]
                } _: {
                    try await CalendarAPI.post(
                        "duty", ["id": sid, "duty": duty.rawValue, "state": CalendarAPI.body(now.duties[duty])]
                    )
                }
            }
            self.save()
            self.refreshSoon()
        }
    }

    /// Whether a save's parts are still worth sending: once one finds the
    /// phone offline, the rest are put back without asking.
    private final class Sent {
        var offline = false
    }

    /// Send one part of a save that's already on screen. If it doesn't go
    /// through it's put back and `report` hears why; offline is said once.
    @discardableResult
    private func part(
        _ sent: Sent, _ failed: String, _ report: (String) -> Void,
        revert: () -> Void, _ request: () async throws -> CalendarAPI.Reply
    ) async -> CalendarAPI.Reply? {
        guard !sent.offline else {
            revert()
            return nil
        }
        do {
            return try await request()
        } catch {
            revert()
            sent.offline = error as? CalendarProblem == .offline
            report("\(failed): \(error.localizedDescription)")
            return nil
        }
    }

    /// Swap an event Google made itself for an ordinary copy that can be
    /// changed (the website makes the copy and deletes the original), then
    /// make the edit that was refused, if there was one.
    func convert(_ conversion: Conversion, report: @escaping (String) -> Void) {
        let event = conversion.event
        if isDemo {
            mutate(event.id) { $0.externalID = nil }
            if var save = conversion.save, let now = snapshot.events.first(where: { $0.id == event.id }) {
                save.event = now
                self.save(save, report: report)
            }
            return
        }
        sending += 1
        Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await CalendarAPI.post("convert", ["id": await self.id(event)])
                self.sending -= 1
                if let save = conversion.save {
                    self.save(save, report: report)
                } else {
                    self.refreshSoon()
                }
            } catch {
                self.sending -= 1
                report("“\(event.title)” couldn't be replaced: \(error.localizedDescription)")
            }
        }
    }

    /// In the demo, the made-up flight stands in for an event Google made.
    private static func isDemoGoogleMade(_ event: CalEvent) -> Bool {
        event.externalID?.hasPrefix("gmail:") == true
    }

    /// Delete an event, or with `series` every occurrence of the repeating
    /// event it's one of, past and to come.
    func delete(_ event: CalEvent, series: Bool = false, report: @escaping (String) -> Void) {
        let gone = Set((series ? CalendarRules.series(of: event, in: snapshot.events) : [event]).map(\.id))
        let isGone: (CalEvent) -> Bool = { gone.contains($0.id) || $0.driveSourceEventID.map(gone.contains) == true }
        let removed = snapshot.events.filter(isGone)
        snapshot.events.removeAll(where: isGone)
        for id in gone { provisional[id] = nil }
        guard !isDemo else { return }
        sending += 1
        Task { [weak self] in
            guard let self else { return }
            defer { self.sending -= 1 }
            do {
                _ = try await CalendarAPI.post("delete", ["id": await self.id(event), "series": series])
                self.save()
                self.refreshSoon()
            } catch {
                self.snapshot.events += removed
                report("“\(event.title)” \(series ? "and its series weren't" : "wasn't") deleted: \(error.localizedDescription)")
            }
        }
    }

    /// Put an event in place of the one with its id.
    private func set(_ event: CalEvent) {
        if provisional[event.id] != nil { provisional[event.id] = event }
        mutate(event.id) { $0 = event }
    }

    private func applied(_ draft: EventDraft, to event: CalEvent) -> CalEvent {
        var e = event
        e.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        e.location = location.isEmpty ? nil : location
        e.notes = notes.isEmpty ? nil : notes
        e.allDay = draft.allDay
        e.start = draft.allDay ? CalendarRules.allDayInstant(Day(draft.start)) : draft.start
        e.end = draft.allDay ? nil : draft.end
        return e
    }

    /// Places for the location field, near home first.
    func places(_ query: String) async -> [PlaceSuggestion] {
        guard !isDemo else { return [] }
        return (try? await CalendarAPI.post("places", ["query": query], timeout: 15))?.suggestions ?? []
    }
}
