import Foundation

// The calendar's rows as the phone keeps them: the website's types
// (src/lib/calendar/types.ts), read straight from Supabase and saved in the
// local copy. Emails are lowercased on the way in, so they compare plainly.

enum SourceType: String, Codable, Sendable {
    case teamsnap, ics, manual, google
}

enum TeamsnapRsvp: String, Codable, Sendable {
    case going, maybe, notGoing = "not_going", noReply = "no_reply"
}

enum DutyKind: String, Codable, Sendable, CaseIterable {
    case dropoff, pickup

    var label: String { self == .dropoff ? "Drop-off" : "Pick-up" }
}

/// One guest on a Google event, as of the last sync.
struct GoogleGuest: Codable, Hashable, Sendable {
    var email: String
    var responseStatus: String
    var displayName: String?
}

struct CalEvent: Identifiable, Hashable, Codable, Sendable {
    var id: UUID
    var memberEmail: String
    var sourceID: UUID?
    var title: String
    var notes: String?
    var location: String?
    var start: Date
    var end: Date?
    var allDay: Bool
    var sourceType: SourceType
    var externalID: String?
    var googleEventID: String?
    var organizerEmail: String?
    var teamsnapOpponent: String?
    var teamsnapArrival: Date?
    var teamsnapIsGame: Bool?
    var teamsnapRsvp: TeamsnapRsvp?
    /// RFC 5545 rule body when the event repeats.
    var rrule: String?
    var recurringEventID: String?
    var guests: [GoogleGuest]?
    var dismissed: Bool
    var ownerNotGoing: Bool
    /// Set on a drive block: the kid's event it drives to or from.
    var driveSourceEventID: UUID?
    var driveDuty: DutyKind?
    /// One-way minutes from home, once worked out.
    var driveMinutes: Int?

    var isDrive: Bool { driveSourceEventID != nil }

    init(
        id: UUID = UUID(), memberEmail: String, sourceID: UUID? = nil, title: String, notes: String? = nil,
        location: String? = nil, start: Date, end: Date? = nil, allDay: Bool = false, sourceType: SourceType = .manual,
        externalID: String? = nil, googleEventID: String? = nil, organizerEmail: String? = nil,
        teamsnapOpponent: String? = nil, teamsnapArrival: Date? = nil, teamsnapIsGame: Bool? = nil,
        teamsnapRsvp: TeamsnapRsvp? = nil, rrule: String? = nil, recurringEventID: String? = nil,
        guests: [GoogleGuest]? = nil, dismissed: Bool = false, ownerNotGoing: Bool = false,
        driveSourceEventID: UUID? = nil, driveDuty: DutyKind? = nil, driveMinutes: Int? = nil
    ) {
        self.id = id
        self.memberEmail = memberEmail
        self.sourceID = sourceID
        self.title = title
        self.notes = notes
        self.location = location
        self.start = start
        self.end = end
        self.allDay = allDay
        self.sourceType = sourceType
        self.externalID = externalID
        self.googleEventID = googleEventID
        self.organizerEmail = organizerEmail
        self.teamsnapOpponent = teamsnapOpponent
        self.teamsnapArrival = teamsnapArrival
        self.teamsnapIsGame = teamsnapIsGame
        self.teamsnapRsvp = teamsnapRsvp
        self.rrule = rrule
        self.recurringEventID = recurringEventID
        self.guests = guests
        self.dismissed = dismissed
        self.ownerNotGoing = ownerNotGoing
        self.driveSourceEventID = driveSourceEventID
        self.driveDuty = driveDuty
        self.driveMinutes = driveMinutes
    }

    static let columns =
        "id, member_email, calendar_source_id, title, description, location, start_time, end_time, all_day, source_type, external_id, google_event_id, organizer_email, teamsnap_opponent, teamsnap_arrival_time, teamsnap_is_game, teamsnap_rsvp, rrule, google_recurring_event_id, google_attendees, dismissed, owner_not_going, drive_source_event_id, drive_duty, drive_minutes"

    enum CodingKeys: String, CodingKey {
        case id, title, location, rrule, dismissed
        case memberEmail = "member_email"
        case sourceID = "calendar_source_id"
        case notes = "description"
        case start = "start_time"
        case end = "end_time"
        case allDay = "all_day"
        case sourceType = "source_type"
        case externalID = "external_id"
        case googleEventID = "google_event_id"
        case organizerEmail = "organizer_email"
        case teamsnapOpponent = "teamsnap_opponent"
        case teamsnapArrival = "teamsnap_arrival_time"
        case teamsnapIsGame = "teamsnap_is_game"
        case teamsnapRsvp = "teamsnap_rsvp"
        case recurringEventID = "google_recurring_event_id"
        case guests = "google_attendees"
        case ownerNotGoing = "owner_not_going"
        case driveSourceEventID = "drive_source_event_id"
        case driveDuty = "drive_duty"
        case driveMinutes = "drive_minutes"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        memberEmail = try c.decode(String.self, forKey: .memberEmail).lowercased()
        sourceID = try c.decodeIfPresent(UUID.self, forKey: .sourceID)
        title = try c.decode(String.self, forKey: .title)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        location = try c.decodeIfPresent(String.self, forKey: .location)
        start = try Instant.decode(c, .start)
        end = try Instant.decodeIfPresent(c, .end)
        allDay = try c.decodeIfPresent(Bool.self, forKey: .allDay) ?? false
        sourceType = try c.decode(SourceType.self, forKey: .sourceType)
        externalID = try c.decodeIfPresent(String.self, forKey: .externalID)
        googleEventID = try c.decodeIfPresent(String.self, forKey: .googleEventID)
        organizerEmail = try c.decodeIfPresent(String.self, forKey: .organizerEmail)?.lowercased()
        teamsnapOpponent = try c.decodeIfPresent(String.self, forKey: .teamsnapOpponent)
        teamsnapArrival = try Instant.decodeIfPresent(c, .teamsnapArrival)
        teamsnapIsGame = try c.decodeIfPresent(Bool.self, forKey: .teamsnapIsGame)
        teamsnapRsvp = try c.decodeIfPresent(TeamsnapRsvp.self, forKey: .teamsnapRsvp)
        rrule = try c.decodeIfPresent(String.self, forKey: .rrule)
        recurringEventID = try c.decodeIfPresent(String.self, forKey: .recurringEventID)
        guests = try? c.decodeIfPresent([GoogleGuest].self, forKey: .guests)
        dismissed = try c.decodeIfPresent(Bool.self, forKey: .dismissed) ?? false
        ownerNotGoing = try c.decodeIfPresent(Bool.self, forKey: .ownerNotGoing) ?? false
        driveSourceEventID = try c.decodeIfPresent(UUID.self, forKey: .driveSourceEventID)
        driveDuty = try c.decodeIfPresent(DutyKind.self, forKey: .driveDuty)
        driveMinutes = try c.decodeIfPresent(Int.self, forKey: .driveMinutes)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(memberEmail, forKey: .memberEmail)
        try c.encodeIfPresent(sourceID, forKey: .sourceID)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(notes, forKey: .notes)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encode(Instant.string(start), forKey: .start)
        try c.encodeIfPresent(end.map(Instant.string), forKey: .end)
        try c.encode(allDay, forKey: .allDay)
        try c.encode(sourceType, forKey: .sourceType)
        try c.encodeIfPresent(externalID, forKey: .externalID)
        try c.encodeIfPresent(googleEventID, forKey: .googleEventID)
        try c.encodeIfPresent(organizerEmail, forKey: .organizerEmail)
        try c.encodeIfPresent(teamsnapOpponent, forKey: .teamsnapOpponent)
        try c.encodeIfPresent(teamsnapArrival.map(Instant.string), forKey: .teamsnapArrival)
        try c.encodeIfPresent(teamsnapIsGame, forKey: .teamsnapIsGame)
        try c.encodeIfPresent(teamsnapRsvp, forKey: .teamsnapRsvp)
        try c.encodeIfPresent(rrule, forKey: .rrule)
        try c.encodeIfPresent(recurringEventID, forKey: .recurringEventID)
        try c.encodeIfPresent(guests, forKey: .guests)
        try c.encode(dismissed, forKey: .dismissed)
        try c.encode(ownerNotGoing, forKey: .ownerNotGoing)
        try c.encodeIfPresent(driveSourceEventID, forKey: .driveSourceEventID)
        try c.encodeIfPresent(driveDuty, forKey: .driveDuty)
        try c.encodeIfPresent(driveMinutes, forKey: .driveMinutes)
    }
}

/// Postgres timestamps as they come over the wire ("2026-11-18T17:00:00+00:00",
/// with or without fractional seconds).
enum Instant {
    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func parse(_ text: String) -> Date? {
        plain.date(from: text) ?? fractional.date(from: text)
    }

    static func string(_ date: Date) -> String { fractional.string(from: date) }

    static func decode<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) throws -> Date {
        let text = try c.decode(String.self, forKey: key)
        guard let date = parse(text) else {
            throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "not a timestamp: \(text)")
        }
        return date
    }

    static func decodeIfPresent<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) throws -> Date? {
        guard let text = try c.decodeIfPresent(String.self, forKey: key) else { return nil }
        return parse(text)
    }
}

enum MemberRole: String, Codable, Sendable {
    case owner, parent, kid

    var isParent: Bool { self != .kid }
}

struct Member: Identifiable, Hashable, Codable, Sendable {
    var email: String
    var name: String?
    var role: MemberRole
    /// "#rrggbb"; the website's hash colour when none is set.
    var color: String
    /// The Google calendar new events for this member go into, once set up.
    var primaryCalendarID: String?
    /// Where their photo sits in the member-photos bucket, when they have one.
    var photoPath: String?

    var id: String { email }

    /// "Sebastian" from "Sebastian Mason"; the email's name when there's none.
    var firstName: String {
        let full = name?.trimmingCharacters(in: .whitespaces) ?? ""
        if let first = full.split(separator: " ").first { return String(first) }
        return email.split(separator: "@").first.map(String.init)?.capitalized ?? email
    }

    var initial: String { String(firstName.prefix(1)).uppercased() }
}

struct CalSource: Identifiable, Hashable, Codable, Sendable {
    var id: UUID
    var memberEmail: String?
    var sourceType: SourceType
    var teamName: String?
    /// The TeamSnap player this source answers for, once linked.
    var teamsnapPlayerID: Int?
    var googleCalendarID: String?
    var nickname: String?
    var isActive: Bool

    /// What the website calls it: the nickname, else the TeamSnap team.
    var name: String? { nickname ?? teamName }
}

/// Who's doing a drop-off or pick-up. Exactly one of the three carries it.
struct DutyState: Hashable, Codable, Sendable {
    var assignee: String?
    var isNa: Bool
    var caregiver: String?

    static let notNeeded = DutyState(assignee: nil, isNa: true, caregiver: nil)
    static func parent(_ email: String) -> DutyState { DutyState(assignee: email, isNa: false, caregiver: nil) }
    static func caregiver(_ name: String) -> DutyState { DutyState(assignee: nil, isNa: false, caregiver: name) }
}

struct Logistics: Hashable, Codable, Sendable {
    var homeAddress: String?
    var bufferMinutes: Int = 5
}

/// Something the signed-in member has hidden from their own view: one event,
/// or every occurrence of a repeating one. A row of calendar_event_hides.
struct EventHide: Identifiable, Hashable, Codable, Sendable {
    enum Scope: String, Codable, Sendable {
        case event, series
    }

    var id: UUID
    var scope: Scope
    /// What's hidden: `CalendarRules.hideTarget` of the event, or the Google
    /// series' id.
    var target: String
    // The event as it was when hidden, for the list in Settings.
    var title: String
    var ownerEmail: String?
    var start: Date?
    var rrule: String?

    static let columns = "id, scope, target, title, owner_email, start_time, rrule"

    enum CodingKeys: String, CodingKey {
        case id, scope, target, title, rrule
        case ownerEmail = "owner_email"
        case start = "start_time"
    }

    init(
        id: UUID = UUID(), scope: Scope, target: String, title: String, ownerEmail: String? = nil,
        start: Date? = nil, rrule: String? = nil
    ) {
        self.id = id
        self.scope = scope
        self.target = target
        self.title = title
        self.ownerEmail = ownerEmail
        self.start = start
        self.rrule = rrule
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        scope = try c.decode(Scope.self, forKey: .scope)
        target = try c.decode(String.self, forKey: .target)
        title = try c.decode(String.self, forKey: .title)
        ownerEmail = try c.decodeIfPresent(String.self, forKey: .ownerEmail)?.lowercased()
        start = try Instant.decodeIfPresent(c, .start)
        rrule = try c.decodeIfPresent(String.self, forKey: .rrule)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(scope, forKey: .scope)
        try c.encode(target, forKey: .target)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(ownerEmail, forKey: .ownerEmail)
        try c.encodeIfPresent(start.map(Instant.string), forKey: .start)
        try c.encodeIfPresent(rrule, forKey: .rrule)
    }
}

/// Everything the calendar shows, as last read: the local copy the app opens on.
struct CalendarSnapshot: Codable, Sendable {
    var members: [Member] = []
    var sources: [CalSource] = []
    var events: [CalEvent] = []
    /// Event id → the members marked going.
    var going: [UUID: [String]] = [:]
    /// Event id → its drop-off and pick-up, where set.
    var duties: [UUID: [DutyKind: DutyState]] = [:]
    var logistics = Logistics()
    /// What the signed-in member has hidden from their own view.
    var hides: [EventHide] = []
    var fetchedAt: Date?
}

extension CalendarSnapshot {
    /// A copy saved before a field existed still opens, with that field empty.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init()
        members = try c.decodeIfPresent([Member].self, forKey: .members) ?? []
        sources = try c.decodeIfPresent([CalSource].self, forKey: .sources) ?? []
        events = try c.decodeIfPresent([CalEvent].self, forKey: .events) ?? []
        going = try c.decodeIfPresent([UUID: [String]].self, forKey: .going) ?? [:]
        duties = try c.decodeIfPresent([UUID: [DutyKind: DutyState]].self, forKey: .duties) ?? [:]
        logistics = try c.decodeIfPresent(Logistics.self, forKey: .logistics) ?? Logistics()
        hides = try c.decodeIfPresent([EventHide].self, forKey: .hides) ?? []
        fetchedAt = try c.decodeIfPresent(Date.self, forKey: .fetchedAt)
    }
}

/// What the event form sends: the website's ManualEventInput.
struct EventDraft: Hashable, Sendable {
    var title = ""
    var memberEmail: String
    var start: Date
    var end: Date
    var allDay = false
    var location = ""
    var notes = ""
}

/// An event Google made itself (from a Gmail confirmation) that just refused a
/// change: the offer to swap it for an ordinary copy, and the edit to make
/// once it has been, if it was an edit.
struct Conversion: Identifiable, Sendable {
    let id = UUID()
    var event: CalEvent
    var draft: EventDraft?
}
