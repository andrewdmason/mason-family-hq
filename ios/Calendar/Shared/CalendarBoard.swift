import Foundation

/// What a duty shows as on a card: nobody yet, not needed, or whoever's doing it.
enum DutyChip: Hashable, Sendable {
    case unset
    case notNeeded
    case person(initial: String, color: String)
}

/// One event as the views draw it: the row that owns it, who else is going,
/// and everything the website's `display` works out for a card.
struct EventItem: Identifiable, Hashable, Sendable {
    var event: CalEvent
    var day: Day
    /// The trip's zone, when its day is drawn in another place's time.
    var zone: TimeZone?
    /// The other family members going, in family order.
    var attendees: [String]
    /// "#rrggbb": the kid's on a drive block, else the owner's.
    var color: String
    /// The calendar's name, when it goes in front of the title.
    var label: String?
    /// The calendar or team it's from, for the event sheet, when that has a
    /// name; whose it is, the sheet already shows.
    var sourceName: String?
    var conflict = false
    /// Out of sight unless Settings asks for hidden events: declined or not
    /// going, or hidden by the signed-in member themselves.
    var hidden = false
    /// Hidden by the signed-in member (a long-press), which they can undo.
    var hiddenByMe = false
    /// On the signed-in member's calendar, or they're going or driving.
    var involved = false
    /// Drop-off and pick-up, when the event is one that needs driving to.
    var duties: [DutyKind: DutyChip]?
    var isTeamsnap = false

    var id: UUID { event.id }

    /// The calendar its times are read in: the trip's, on a day away.
    func calendar(in base: Calendar = .current) -> Calendar {
        guard let zone else { return base }
        var calendar = base
        calendar.timeZone = zone
        return calendar
    }

    /// "FSB: Practice".
    var title: String { label.map { "\($0): \(event.title)" } ?? event.title }

    /// A drive that still needs someone.
    var needsDriver: Bool {
        guard let duties, event.location != nil else { return false }
        return duties.values.contains(.unset)
    }
}

/// The calendar worked out from the local copy: the website client's pipeline
/// (calendar-client.tsx) from raw rows to what's on screen.
struct Board: Sendable {
    var members: [Member] = []
    var sources: [UUID: CalSource] = [:]
    /// Every logical event, hidden ones included, by start.
    var items: [EventItem] = []
    var byDay: [Day: [EventItem]] = [:]
    /// Every row as read, for following a drive block back to its event.
    var rows: [UUID: CalEvent] = [:]
    var logistics = Logistics()
    /// What the signed-in member has hidden from their own view.
    var hides: [EventHide] = []
    /// The days drawn in another place's time (a trip), and which place's.
    var away: [Day: TimeZone] = [:]

    /// The calendar `day` is drawn in: the trip's zone on a day away.
    func calendar(on day: Day, in base: Calendar = .current) -> Calendar {
        guard let zone = away[day] else { return base }
        var calendar = base
        calendar.timeZone = zone
        return calendar
    }

    /// The trip zone a moment is drawn in, for an event not on the board yet.
    func zone(at date: Date) -> TimeZone? { CalendarRules.zone(at: date, away: away) }

    /// "Costa Rica time · 2h ahead", on a day drawn in a clock that isn't the
    /// family's at home. A day in home time says nothing, wherever the device
    /// is: opened on a trip, the days back home aren't the ones to mark.
    func zoneNote(on day: Day, in base: Calendar = .current, home: TimeZone = CalendarRules.familyZone) -> String? {
        let calendar = calendar(on: day, in: base)
        let noon = day.at(minutes: 12 * 60, in: calendar)
        guard calendar.timeZone.secondsFromGMT(for: noon) != home.secondsFromGMT(for: noon) else { return nil }
        return CalendarRules.zoneNote(calendar.timeZone, home: home, at: noon)
    }

    /// Just the place of that note ("Costa Rica"), for where the whole of it won't fit.
    func zonePlace(on day: Day, in base: Calendar = .current, home: TimeZone = CalendarRules.familyZone) -> String? {
        zoneNote(on: day, in: base, home: home).map { _ in CalendarRules.zonePlace(calendar(on: day, in: base).timeZone) }
    }

    func member(_ email: String?) -> Member? {
        guard let email else { return nil }
        return members.first { $0.email == email }
    }

    var parents: [Member] { members.filter { $0.role.isParent } }

    func item(_ id: UUID) -> EventItem? { items.first { $0.id == id } }

    /// The event a tap opens: a drive block opens the kid's event it's for.
    func opened(_ item: EventItem) -> EventItem {
        guard let source = item.event.driveSourceEventID else { return item }
        return self.item(source) ?? item
    }

    /// A day's events, hidden ones left out unless asked for.
    func events(on day: Day, showHidden: Bool) -> [EventItem] {
        (byDay[day] ?? []).filter { showHidden || !$0.hidden }
    }

    /// Whether the kid's own going / not going applies: a kid's event that
    /// isn't TeamSnap's (which has its own RSVP) or a drive.
    func hasOwnerGoing(_ event: CalEvent) -> Bool {
        !event.isDrive && event.sourceType != .teamsnap && member(event.memberEmail)?.role == .kid
    }

    /// Whether drop-off and pick-up apply: a kid's timed event away from
    /// home, in person (not one on a call).
    func hasDrives(_ event: CalEvent) -> Bool {
        !event.allDay && !event.isDrive && member(event.memberEmail)?.role == .kid
            && !CalendarRules.isHome(event.location, homeAddress: logistics.homeAddress)
            && !CalendarRules.isRemote(location: event.location, joinURL: event.joinURL)
            && !parents.isEmpty
    }

    /// Whether the event can be edited here: Google and app-only events.
    func isEditable(_ event: CalEvent) -> Bool {
        !event.isDrive && (event.sourceType == .manual || event.sourceType == .google)
    }

    /// Whether the event can move to `member`'s calendar: an event that can
    /// be edited, and for a Google one a member with a Google calendar set up.
    func canHold(_ member: Member, _ event: CalEvent) -> Bool {
        guard isEditable(event), member.email != event.memberEmail else { return false }
        return event.sourceType == .manual || member.primaryCalendarID != nil
    }

    /// Whether TeamSnap takes an RSVP for it: a TeamSnap event.
    func hasRsvp(_ event: CalEvent) -> Bool {
        event.sourceType == .teamsnap && !event.isDrive
    }

    /// Whether a long-press can hide it: not a drive (those go with their
    /// event), and not something already out of sight for another reason.
    func canHide(_ item: EventItem) -> Bool {
        !item.event.isDrive && !item.hidden
    }

    /// Whether hiding can offer every occurrence as well as this one: a real
    /// repeating series, and not one the member is part of, where a hidden
    /// series would show anyway.
    func canHideSeries(_ item: EventItem) -> Bool {
        canHide(item) && CalendarRules.repeats(item.event) && !item.involved
    }

    /// `me` is whose phone it is: their own hides apply, and give way where
    /// they're involved.
    static func build(_ snapshot: CalendarSnapshot, me: String? = nil, in calendar: Calendar = .current) -> Board {
        var board = Board()
        board.members = snapshot.members
        board.logistics = snapshot.logistics
        board.hides = snapshot.hides
        board.sources = Dictionary(snapshot.sources.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        board.rows = Dictionary(snapshot.events.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        let order = snapshot.members.map(\.email)
        let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        let colors = Dictionary(snapshot.members.map { ($0.email, $0.color) }, uniquingKeysWith: { a, _ in a })
        let roles = Dictionary(snapshot.members.map { ($0.email, $0.role) }, uniquingKeysWith: { a, _ in a })
        var activeSources: [String: Int] = [:]
        for s in snapshot.sources where s.isActive {
            if let m = s.memberEmail { activeSources[m, default: 0] += 1 }
        }

        let logical = CalendarRules.logical(snapshot.events, going: snapshot.going, memberOrder: order)
        func hidden(_ e: CalEvent) -> Bool {
            CalendarRules.isHidden(e, source: e.sourceID.flatMap { board.sources[$0] })
        }
        // An event the member has only hidden from themselves is still on,
        // so it still counts as a conflict for whoever's it is.
        let conflicts = CalendarRules.conflicts(logical.events.filter { !hidden($0) })
        let mine = CalendarRules.hiddenByMember(
            logical, hides: snapshot.hides, me: me, duties: snapshot.duties, rows: board.rows
        )

        // Where the phone's owner will be: their own events say. With nobody
        // signed in (a preview), everyone's do.
        board.away = CalendarRules.awayZones(
            logical.events.filter { e in
                !hidden(e) && !mine.contains(e.id) && (me == nil || CalendarRules.isInvolved(
                    me, in: e, attendees: logical.attendees[e.id] ?? [], duties: snapshot.duties[e.id]
                ))
            },
            home: calendar.timeZone
        )
        let away = board.away

        func chip(_ state: DutyState?) -> DutyChip {
            guard let state else { return .unset }
            if state.isNa { return .notNeeded }
            if let caregiver = state.caregiver {
                return .person(initial: String(caregiver.prefix(1)).uppercased(), color: CalendarRules.caregiverColor)
            }
            if let email = state.assignee, let member = board.member(email) {
                return .person(initial: member.initial, color: member.color)
            }
            return .unset
        }

        board.items = logical.events.map { e in
            let source = e.sourceID.flatMap { board.sources[$0] }
            let isHidden = hidden(e)
            let kid = e.driveSourceEventID.flatMap { board.rows[$0]?.memberEmail }
            let color = kid.flatMap { colors[$0] } ?? colors[e.memberEmail] ?? CalendarRules.hashColor(e.memberEmail)
            var duties: [DutyKind: DutyChip]?
            if !e.allDay, !isHidden, !e.isDrive, roles[e.memberEmail] == .kid,
               !CalendarRules.isHome(e.location, homeAddress: snapshot.logistics.homeAddress),
               !CalendarRules.isRemote(location: e.location, joinURL: e.joinURL) {
                let saved = snapshot.duties[e.id] ?? [:]
                duties = [.dropoff: chip(saved[.dropoff]), .pickup: chip(saved[.pickup])]
            }
            // On a day away, a timed event is on the day it's on there.
            let zone = e.allDay ? nil : CalendarRules.zone(at: e.start, away: away)
            var local = calendar
            if let zone { local.timeZone = zone }
            return EventItem(
                event: e,
                day: CalendarRules.day(of: e, in: local),
                zone: zone,
                attendees: (logical.attendees[e.id] ?? [])
                    .filter { rank[$0] != nil }
                    .sorted { (rank[$0] ?? 0) < (rank[$1] ?? 0) },
                color: color,
                label: CalendarRules.calendarLabel(e, source: source, activeSourcesOfOwner: activeSources[e.memberEmail] ?? 0),
                sourceName: source?.name,
                conflict: conflicts.contains(e.id),
                hidden: isHidden || mine.contains(e.id),
                hiddenByMe: mine.contains(e.id),
                involved: CalendarRules.isInvolved(
                    me, in: e, attendees: logical.attendees[e.id] ?? [], duties: snapshot.duties[e.id]
                ),
                duties: duties,
                isTeamsnap: e.sourceType == .teamsnap
            )
        }
        .sorted { a, b in
            let (sa, sb) = (CalendarRules.blockStart(a.event), CalendarRules.blockStart(b.event))
            if sa != sb { return sa < sb }
            return a.event.title < b.event.title
        }
        board.byDay = Dictionary(grouping: board.items, by: \.day)
        return board
    }
}

/// A column of the Day view: one member's events, and the ones they're going
/// along to.
struct DayColumn: Identifiable, Sendable {
    var member: Member
    var isMe: Bool
    var allDay: [EventItem] = []
    var blocks: [DayBlock] = []

    var id: String { member.email }
}

/// A block in a column, placed in its lane.
struct DayBlock: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable {
        /// The member's own event.
        case own
        /// Their drive to or from a kid's event.
        case drive
        /// Someone else's event they're going to, with their drives to and
        /// from it fused on: the event itself runs `eventStart` to `eventEnd`.
        case attending(eventStart: Int, eventEnd: Int)
    }

    var item: EventItem
    var kind: Kind
    var start: Int
    var end: Int
    var lane: Int
    var lanes: Int

    var id: UUID { item.id }
}

struct DayLayout: Sendable {
    var day: Day
    var columns: [DayColumn]

    var isEmpty: Bool { columns.allSatisfy { $0.allDay.isEmpty && $0.blocks.isEmpty } }

    /// The events the first, wide column shows as cards. Someone else going
    /// along to one of these has their face on its card there, so their own
    /// column doesn't draw it again.
    var inWideColumn: Set<UUID> {
        Set((columns.first?.blocks ?? []).filter { $0.kind != .drive }.map(\.id))
    }

    /// The columns' order: the signed-in member first, then the rest as shown.
    static func order(_ shown: [Member], me: String?) -> [Member] {
        var members = shown
        if let me, let at = members.firstIndex(where: { $0.email == me }) {
            members.insert(members.remove(at: at), at: 0)
        }
        return members
    }

    /// The website's Day view (day-view.tsx): a column per shown member with
    /// the signed-in one first, each member's own events packed into lanes,
    /// and the events they attend drawn in their column too, taking in their
    /// own drive legs.
    static func build(
        day: Day, board: Board, shown: [Member], me: String?, showHidden: Bool, in calendar: Calendar = .current
    ) -> DayLayout {
        let items = board.events(on: day, showHidden: showHidden)
        let timed = items.filter { !$0.event.allDay }
        let members = order(shown, me: me)

        let columns = members.map { member -> DayColumn in
            var column = DayColumn(member: member, isMe: member.email == me)
            column.allDay = items.filter { $0.event.allDay && $0.event.memberEmail == member.email }
            let own = timed.filter { $0.event.memberEmail == member.email }
            let attended = timed.filter { $0.event.memberEmail != member.email && $0.attendees.contains(member.email) }

            var claimed: Set<UUID> = []
            var blocks: [UUID: (EventItem, DayBlock.Kind, Span)] = [:]
            for item in attended {
                let legs = own.filter { $0.event.driveSourceEventID == item.id }
                let top = legs.first { $0.event.driveDuty == .dropoff }
                let bottom = legs.first { $0.event.driveDuty == .pickup }
                let event = CalendarRules.span(item.event, in: item.calendar(in: calendar))
                let start = top.map { CalendarRules.startMinutes($0.event, in: $0.calendar(in: calendar)) } ?? event.start
                let end = bottom.map { CalendarRules.endMinutes($0.event, in: $0.calendar(in: calendar)) } ?? event.end
                for leg in [top, bottom].compactMap({ $0 }) { claimed.insert(leg.id) }
                blocks[item.id] = (
                    item, .attending(eventStart: event.start, eventEnd: event.end),
                    Span(id: item.id, start: min(start, event.start), end: max(end, event.end))
                )
            }
            for item in own where !claimed.contains(item.id) {
                blocks[item.id] = (item, item.event.isDrive ? .drive : .own, CalendarRules.span(item.event, in: item.calendar(in: calendar)))
            }
            let placed = CalendarRules.pack(blocks.values.map(\.2))
            column.blocks = placed.compactMap { p in
                guard let (item, kind, _) = blocks[p.span.id] else { return nil }
                return DayBlock(item: item, kind: kind, start: p.span.start, end: p.span.end, lane: p.lane, lanes: p.lanes)
            }
            .sorted { ($0.start, $0.lane) < ($1.start, $1.lane) }
            return column
        }
        return DayLayout(day: day, columns: columns)
    }
}
