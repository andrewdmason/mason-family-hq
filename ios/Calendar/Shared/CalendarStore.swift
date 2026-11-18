import Foundation
import MasonKit
import Observation
import Supabase

/// The family calendar on this device. It opens on the local copy (a file, so
/// it's there with no signal), reads the rest straight from Supabase under the
/// member's sign-in, and sends every change through the website
/// (`CalendarAPI`), showing it at once and putting it back if the website
/// refuses. Changes need a connection; nothing queues.
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
    /// Canned family with no sign-in or network: `--demo`, for the simulator.
    let isDemo: Bool

    private var owner: UUID?
    private var followUp: Task<Void, Never>?
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
    }

    var lastUpdated: Date? { snapshot.fetchedAt }

    // MARK: The local copy

    private static func file(_ user: UUID) -> URL {
        let folder = URL.applicationSupportDirectory.appending(path: "Calendar")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appending(path: "copy-\(user.uuidString.lowercased()).json")
    }

    private static func photoFolder() -> URL {
        let folder = URL.cachesDirectory.appending(path: "member-photos")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// Open on what this member last saw here.
    func open(for user: UUID) {
        guard !isDemo, owner != user else { return }
        owner = user
        if let data = try? Data(contentsOf: Self.file(user)),
           let saved = try? JSONDecoder().decode(CalendarSnapshot.self, from: data) {
            snapshot = saved
            loaded = true
            for member in saved.members {
                if let data = try? Data(contentsOf: Self.photoFile(member)) { photos[member.email] = data }
            }
        }
    }

    private static func photoFile(_ member: Member) -> URL {
        photoFolder().appending(path: member.email.replacingOccurrences(of: "/", with: "_") + ".img")
    }

    private func save() {
        guard !isDemo, let owner, let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: Self.file(owner), options: .atomic)
    }

    /// Another member signing in starts from nothing of the last one's.
    func forget() {
        if let owner { try? FileManager.default.removeItem(at: Self.file(owner)) }
        owner = nil
        followUp?.cancel()
        snapshot = CalendarSnapshot()
        photos = [:]
        loaded = false
    }

    // MARK: Reading

    /// Read the calendar again. Keeps the copy when there's no signal.
    func refresh() async {
        guard !isDemo, Session.shared.isSignedIn, !refreshing else { return }
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
            try? data.write(to: Self.photoFile(member), options: .atomic)
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
        return try await send(revert: { self.snapshot.going[event.id] = before }) {
            try await CalendarAPI.post("going", ["id": Self.id(event), "memberEmail": member, "going": going])
        }
    }

    /// A kid going to their own event, or not: not going takes it off every
    /// calendar, drives included.
    func setOwnerGoing(_ event: CalEvent, going: Bool) async throws -> String? {
        mutate(event.id) { $0.ownerNotGoing = !going }
        return try await send(revert: { self.mutate(event.id) { $0.ownerNotGoing = event.ownerNotGoing } }) {
            try await CalendarAPI.post("owner-going", ["id": Self.id(event), "going": going])
        }
    }

    /// Who's doing a drop-off or pick-up; nil clears it.
    func setDuty(_ event: CalEvent, _ duty: DutyKind, _ state: DutyState?) async throws {
        let before = snapshot.duties[event.id]?[duty]
        snapshot.duties[event.id, default: [:]][duty] = state
        _ = try await send(revert: { self.snapshot.duties[event.id, default: [:]][duty] = before }) {
            try await CalendarAPI.post("duty", ["id": Self.id(event), "duty": duty.rawValue, "state": CalendarAPI.body(state)])
        }
    }

    /// The linked player's answer, written back to TeamSnap.
    func setRsvp(_ event: CalEvent, _ answer: TeamsnapRsvp) async throws {
        mutate(event.id) { $0.teamsnapRsvp = answer }
        _ = try await send(revert: { self.mutate(event.id) { $0.teamsnapRsvp = event.teamsnapRsvp } }) {
            try await CalendarAPI.post("rsvp", ["id": Self.id(event), "status": answer.rawValue])
        }
    }

    private static func id(_ event: CalEvent) -> String { event.id.uuidString.lowercased() }

    private func mutate(_ id: UUID, _ change: (inout CalEvent) -> Void) {
        guard let at = snapshot.events.firstIndex(where: { $0.id == id }) else { return }
        change(&snapshot.events[at])
    }

    /// Send a change already shown; put it back if it didn't go through.
    private func send(
        revert: () -> Void, _ request: () async throws -> CalendarAPI.Reply
    ) async throws -> String? {
        guard !isDemo else { return nil }
        do {
            let reply = try await request()
            save()
            refreshSoon()
            return reply.warning
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

    /// A new event. It appears once the website has made it.
    @discardableResult
    func create(_ draft: EventDraft) async throws -> UUID {
        let sourceID = sourceForNewEvent(draft.memberEmail)
        if isDemo {
            let event = applied(draft, to: CalEvent(memberEmail: draft.memberEmail, title: "", start: draft.start))
            snapshot.events.append(event)
            return event.id
        }
        let reply = try await CalendarAPI.post("create", ["event": CalendarAPI.body(draft, sourceID: sourceID)])
        guard let id = reply.id else { throw CalendarProblem.refused("That didn't go through. Try again.") }
        var event = applied(draft, to: CalEvent(id: id, memberEmail: draft.memberEmail, title: "", start: draft.start))
        if let sourceID {
            event.sourceID = sourceID
            event.sourceType = .google
        }
        snapshot.events.append(event)
        save()
        refreshSoon()
        return id
    }

    /// Save an edit. Returns a note when the event moved calendars but the
    /// old copy couldn't be removed.
    func update(_ event: CalEvent, _ draft: EventDraft) async throws -> String? {
        let before = event
        mutate(event.id) { $0 = self.applied(draft, to: $0, keepOwner: event.sourceType == .google) }
        guard !isDemo else {
            mutate(event.id) { $0.memberEmail = draft.memberEmail }
            return nil
        }
        do {
            _ = try await CalendarAPI.post("update", [
                "id": Self.id(event), "event": CalendarAPI.body(draft, sourceID: event.sourceID),
            ])
        } catch {
            mutate(event.id) { $0 = before }
            throw error
        }
        var warning: String?
        // A Google event changes owner by being made again on the new
        // owner's calendar, which the update alone doesn't do.
        if event.sourceType == .google, draft.memberEmail != event.memberEmail {
            let reply = try await CalendarAPI.post("owner", ["id": Self.id(event), "memberEmail": draft.memberEmail])
            mutate(event.id) { $0.memberEmail = draft.memberEmail }
            warning = reply.warning
        }
        save()
        refreshSoon()
        return warning
    }

    func delete(_ event: CalEvent) async throws {
        if !isDemo { _ = try await CalendarAPI.post("delete", ["id": Self.id(event)]) }
        snapshot.events.removeAll { $0.id == event.id || $0.driveSourceEventID == event.id }
        save()
        refreshSoon()
    }

    private func applied(_ draft: EventDraft, to event: CalEvent, keepOwner: Bool = false) -> CalEvent {
        var e = event
        e.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        e.location = location.isEmpty ? nil : location
        e.notes = notes.isEmpty ? nil : notes
        e.allDay = draft.allDay
        e.start = draft.allDay ? CalendarRules.allDayInstant(Day(draft.start)) : draft.start
        e.end = draft.allDay ? nil : draft.end
        if !keepOwner { e.memberEmail = draft.memberEmail }
        return e
    }

    /// Places for the location field, near home first.
    func places(_ query: String) async -> [PlaceSuggestion] {
        guard !isDemo else { return [] }
        return (try? await CalendarAPI.post("places", ["query": query], timeout: 15))?.suggestions ?? []
    }
}
