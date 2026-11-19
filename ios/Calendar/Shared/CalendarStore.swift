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

    // MARK: Instant actions

    /// Mark a family member as going along, or not. Returns a note to show
    /// when it was saved here but Google wouldn't take it.
    func setGoing(_ event: CalEvent, member: String, going: Bool) async throws -> String? {
        let before = snapshot.going[event.id]
        var list = (before ?? []).filter { $0 != member }
        if going { list.append(member) }
        snapshot.going[event.id] = list
        if isDemo, going, Self.isDemoGoogleMade(event) {
            conversion = Conversion(event: event)
            return nil
        }
        let reply = try await send(revert: { self.snapshot.going[event.id] = before }) {
            try await CalendarAPI.post("going", ["id": await self.id(event), "memberEmail": member, "going": going])
        }
        // Google made this event and won't take guests: it's saved here, and
        // the offer to swap the event for an ordinary copy says the rest.
        if reply?.convertible == true {
            conversion = Conversion(event: event)
            return nil
        }
        return reply?.warning
    }

    /// A kid going to their own event, or not: not going takes it off every
    /// calendar, drives included.
    func setOwnerGoing(_ event: CalEvent, going: Bool) async throws -> String? {
        mutate(event.id) { $0.ownerNotGoing = !going }
        return try await send(revert: { self.mutate(event.id) { $0.ownerNotGoing = event.ownerNotGoing } }) {
            try await CalendarAPI.post("owner-going", ["id": await self.id(event), "going": going])
        }?.warning
    }

    /// Move an event to another member's calendar. As the website does it,
    /// whoever had it stays on as going.
    func setHolder(_ event: CalEvent, member: String) async throws -> String? {
        let before = snapshot.events.first { $0.id == event.id } ?? event
        let goingBefore = snapshot.going[event.id]
        var after = before
        after.memberEmail = member
        set(after)
        snapshot.going[event.id] = CalendarRules.goingAfterMove(goingBefore ?? [], from: before.memberEmail, to: member)
        return try await send(revert: {
            self.set(before)
            self.snapshot.going[event.id] = goingBefore
        }) {
            try await CalendarAPI.post("owner", ["id": await self.id(event), "memberEmail": member])
        }?.warning
    }

    /// Who's doing a drop-off or pick-up; nil clears it.
    func setDuty(_ event: CalEvent, _ duty: DutyKind, _ state: DutyState?) async throws {
        let before = snapshot.duties[event.id]?[duty]
        snapshot.duties[event.id, default: [:]][duty] = state
        _ = try await send(revert: { self.snapshot.duties[event.id, default: [:]][duty] = before }) {
            try await CalendarAPI.post("duty", ["id": await self.id(event), "duty": duty.rawValue, "state": CalendarAPI.body(state)])
        }
    }

    /// The linked player's answer, written back to TeamSnap.
    func setRsvp(_ event: CalEvent, _ answer: TeamsnapRsvp) async throws {
        // A TeamSnap "no" is the kid not going, as the website has it.
        let isKids = board.member(event.memberEmail)?.role == .kid
        mutate(event.id) {
            $0.teamsnapRsvp = answer
            if isKids { $0.ownerNotGoing = answer == .notGoing }
        }
        _ = try await send(revert: {
            self.mutate(event.id) {
                $0.teamsnapRsvp = event.teamsnapRsvp
                $0.ownerNotGoing = event.ownerNotGoing
            }
        }) {
            try await CalendarAPI.post("rsvp", ["id": await self.id(event), "status": answer.rawValue])
        }
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

    /// Send a change already shown; put it back if it didn't go through.
    private func send(
        revert: () -> Void, _ request: () async throws -> CalendarAPI.Reply
    ) async throws -> CalendarAPI.Reply? {
        guard !isDemo else { return nil }
        sending += 1
        defer { sending -= 1 }
        do {
            let reply = try await request()
            save()
            refreshSoon()
            return reply
        } catch {
            revert()
            throw error
        }
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

    // Creating, editing and deleting show at once and close their form; the
    // website hears in the background. If it refuses, or can't be reached,
    // the change is put back and `report` is told why.

    /// A new event, on screen straight away under an id made up here.
    func create(_ draft: EventDraft, report: @escaping (String) -> Void) {
        let sourceID = sourceForNewEvent(draft.memberEmail)
        var event = applied(draft, to: CalEvent(memberEmail: draft.memberEmail, title: "", start: draft.start))
        if sourceID != nil {
            event.sourceID = sourceID
            event.sourceType = .google
        }
        snapshot.events.append(event)
        guard !isDemo else { return }
        let local = event.id
        provisional[local] = event
        sending += 1
        let request = Task { [weak self] () -> UUID? in
            let reply = try? await CalendarAPI.post("create", ["event": CalendarAPI.body(draft, sourceID: sourceID)])
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
    }

    /// Save an edit.
    func update(_ event: CalEvent, _ draft: EventDraft, report: @escaping (String) -> Void) {
        let before = snapshot.events.first { $0.id == event.id } ?? event
        let after = applied(draft, to: before)
        set(after)
        // An event that changes hands keeps whoever had it: they're shown as
        // going at once, as the website records when it makes the move.
        let goingBefore = snapshot.going[event.id]
        if after.memberEmail != before.memberEmail {
            snapshot.going[event.id] = CalendarRules.goingAfterMove(
                goingBefore ?? [], from: before.memberEmail, to: after.memberEmail
            )
        }
        if isDemo, Self.isDemoGoogleMade(event) {
            set(before)
            snapshot.going[event.id] = goingBefore
            conversion = Conversion(event: before, draft: draft)
            return
        }
        guard !isDemo else { return }
        sending += 1
        Task { [weak self] in
            guard let self else { return }
            defer { self.sending -= 1 }
            do {
                let id = await self.id(event)
                _ = try await CalendarAPI.post("update", ["id": id, "event": CalendarAPI.body(draft, sourceID: event.sourceID)])
                // A Google event changes owner by being made again on the
                // new owner's calendar, which the update alone doesn't do.
                if event.sourceType == .google, draft.memberEmail != event.memberEmail {
                    do {
                        let reply = try await CalendarAPI.post("owner", ["id": id, "memberEmail": draft.memberEmail])
                        if let warning = reply.warning { report(warning) }
                    } catch {
                        // The rest of the edit went through; only the move didn't.
                        var kept = after
                        kept.memberEmail = event.memberEmail
                        self.set(kept)
                        self.snapshot.going[event.id] = goingBefore
                        report("Saved, but “\(after.title)” couldn't move calendars: \(error.localizedDescription)")
                    }
                }
                self.save()
                self.refreshSoon()
            } catch CalendarProblem.googleMade {
                // Not saved; offer the swap, which makes this edit afterwards.
                self.set(before)
                self.snapshot.going[event.id] = goingBefore
                self.conversion = Conversion(event: before, draft: draft)
            } catch {
                self.set(before)
                self.snapshot.going[event.id] = goingBefore
                report("“\(before.title)” wasn't saved: \(error.localizedDescription)")
            }
        }
    }

    /// Swap an event Google made itself for an ordinary copy that can be
    /// changed (the website makes the copy and deletes the original), then
    /// make the edit that was refused, if there was one.
    func convert(_ conversion: Conversion, report: @escaping (String) -> Void) {
        let event = conversion.event
        if isDemo {
            mutate(event.id) { $0.externalID = nil }
            if let draft = conversion.draft, let now = snapshot.events.first(where: { $0.id == event.id }) {
                update(now, draft, report: report)
            }
            return
        }
        sending += 1
        Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await CalendarAPI.post("convert", ["id": await self.id(event)])
                self.sending -= 1
                if let draft = conversion.draft {
                    self.update(event, draft, report: report)
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
        e.memberEmail = draft.memberEmail
        return e
    }

    /// Places for the location field, near home first.
    func places(_ query: String) async -> [PlaceSuggestion] {
        guard !isDemo else { return [] }
        return (try? await CalendarAPI.post("places", ["query": query], timeout: 15))?.suggestions ?? []
    }
}
