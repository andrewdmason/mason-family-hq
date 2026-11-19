import SwiftUI

/// An event, opened. At half height: what, when, where, and the things you
/// do from here in one tap (who's going and whose calendar it's on, who's
/// driving, the TeamSnap RSVP).
/// Pulled up: notes, and where the event comes from. Each tap shows at once
/// and is put back, with why, if the website refuses it.
struct EventSheet: View {
    let itemID: UUID
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    /// What the last action came back with: a warning, or why it didn't go.
    @State private var note: String?

    private static let weekdays = Calendar.current.weekdaySymbols
    private static let months = Calendar.current.monthSymbols

    var body: some View {
        let board = store.board
        if let item = board.item(itemID) {
            let event = item.event
            let owner = board.member(event.memberEmail)
            let roster = roster(event)
            let holderGoing = holderGoing(event)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header(item, owner: owner, showsOwner: roster.isEmpty, dimmed: !holderGoing)
                    VStack(alignment: .leading, spacing: 12) {
                        when(event)
                        if let location = event.location { place(location) }
                    }
                    actions(item, roster: roster, holderGoing: holderGoing)
                    if let notes = event.notes, !notes.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Notes").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                            Text(notes)
                                .font(.subheadline)
                                .textSelection(.enabled)
                        }
                    }
                    if let from = item.sourceName {
                        Label(from, systemImage: item.isTeamsnap ? "baseball" : "calendar")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 22)
                .padding(.bottom, 30)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            // The page's paper, part see-through: glass enough to feel the day
            // behind it, solid enough that a bright block doesn't bleed into the words.
            .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
            .animation(.snappy, value: note)
            .modifier(ConvertAlert(active: true))
        } else {
            // Deleted, or gone in a refresh.
            Color.clear.onAppear { dismiss() }
        }
    }

    // MARK: What, when, where

    private func header(_ item: EventItem, owner: Member?, showsOwner: Bool, dimmed: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2.5)
                .fill(CalendarStyle.muted(item.color))
                .frame(width: 5)
            VStack(alignment: .leading, spacing: 6) {
                Text(item.title)
                    .font(.system(.title2, design: .serif).weight(.semibold))
                    .opacity(dimmed ? 0.5 : 1)
                    .fixedSize(horizontal: false, vertical: true)
                // Whose it is sits with who's going, below; without that
                // row (a drive), it's said here.
                if showsOwner || item.conflict {
                    HStack(spacing: 6) {
                        if showsOwner {
                            Avatar(member: owner, size: 20)
                            Text(owner?.firstName ?? "Family")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        if item.conflict {
                            ConflictMark()
                            Text("Overlaps").font(.footnote).foregroundStyle(CalendarStyle.amber)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            if store.board.isEditable(item.event) {
                Button {
                    let request = EditorRequest(event: item.event, draft: store.draft(for: item.event))
                    dismiss()
                    // Let this sheet leave before the form arrives.
                    Task {
                        try? await Task.sleep(for: .milliseconds(350))
                        nav.editor = request
                    }
                } label: {
                    Text("Edit")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                }
                .buttonStyle(.plain)
                .foregroundStyle(CalendarStyle.accent)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func when(_ event: CalEvent) -> some View {
        let day = CalendarRules.day(of: event)
        return row("calendar") {
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
    }

    private func place(_ location: String) -> some View {
        Button {
            var maps = URLComponents(string: "https://maps.apple.com/")!
            maps.queryItems = [URLQueryItem(name: "q", value: location)]
            if let url = maps.url { openURL(url) }
        } label: {
            row("mappin.and.ellipse") {
                Text(location)
                    .font(.body)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(CalendarStyle.accent)
            }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens Maps")
    }

    private func row(_ symbol: String, @ViewBuilder _ content: () -> some View) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(width: 22)
            content()
            Spacer(minLength: 0)
        }
    }

    // MARK: Instant actions

    /// The faces in "Who's going": the family, or just whose it is for an
    /// app-only event, which has no Google event to add guests to.
    private func roster(_ event: CalEvent) -> [Member] {
        guard !event.isDrive else { return [] }
        let members = store.board.members
        return event.sourceType == .manual ? members.filter { $0.email == event.memberEmail } : members
    }

    /// Whether the one whose calendar it's on is going. Only a kid can not
    /// be: a TeamSnap "no", or their own not going.
    private func holderGoing(_ event: CalEvent) -> Bool {
        let board = store.board
        if board.hasRsvp(event) { return !(event.teamsnapRsvp == .notGoing || event.ownerNotGoing) }
        if board.hasOwnerGoing(event) { return !event.ownerNotGoing }
        return true
    }

    @ViewBuilder
    private func actions(_ item: EventItem, roster: [Member], holderGoing: Bool) -> some View {
        let board = store.board
        let event = item.event
        let showsRsvp = board.hasRsvp(event)
        let showsDrives = holderGoing && board.hasDrives(event)
        if showsRsvp || !roster.isEmpty || showsDrives {
            VStack(alignment: .leading, spacing: 14) {
                if showsRsvp {
                    actionRow("Attendance", badge: (event.teamsnapRsvp ?? .noReply) == .noReply ? "Needs RSVP" : nil) {
                        Picker("RSVP", selection: Binding(
                            get: { event.teamsnapRsvp ?? .noReply },
                            set: { answer in act { try await store.setRsvp(event, answer); return nil } }
                        )) {
                            Text("Going").tag(TeamsnapRsvp.going)
                            Text("Maybe").tag(TeamsnapRsvp.maybe)
                            Text("Not going").tag(TeamsnapRsvp.notGoing)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                if !roster.isEmpty {
                    actionRow("Who's going") {
                        ScrollView(.horizontal) {
                            HStack(spacing: 12) {
                                ForEach(roster) { member in
                                    face(member, item, holderGoing: holderGoing)
                                }
                            }
                            .padding(.vertical, 2)
                            .padding(.horizontal, 2)
                        }
                        .scrollIndicators(.hidden)
                        // A held face lifts whole, name and all.
                        .scrollClipDisabled()
                        if !holderGoing, let holder = board.member(event.memberEmail) {
                            Text("\(holder.firstName) isn't going, so it's off everyone's calendar.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                if showsDrives {
                    ForEach(DutyKind.allCases, id: \.self) { duty in
                        driveRow(event, duty)
                    }
                    if let warning = unconnected(event) {
                        Text(warning).font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let note {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .transition(.opacity)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 20, style: .continuous))
        }
    }

    /// One face in "Who's going". A tap is going or not; whoever's calendar
    /// it's on wears the calendar badge, and holding anyone else's face
    /// offers to move it to theirs.
    @ViewBuilder
    private func face(_ member: Member, _ item: EventItem, holderGoing: Bool) -> some View {
        let event = item.event
        let holds = member.email == event.memberEmail
        // With the kid whose event it is not going, nobody is.
        let going = holds ? holderGoing : holderGoing && item.attendees.contains(member.email)
        let button = Button {
            if holds {
                toggleHolder(member, event, going: holderGoing)
            } else {
                act { try await store.setGoing(event, member: member.email, going: !going) }
            }
        } label: {
            PersonChoice(member: member, name: member.firstName, color: member.color, selected: going, holder: holds)
        }
        .buttonStyle(.plain)
        .disabled(!holds && !holderGoing)
        .accessibilityLabel("\(member.firstName), \(going ? "going" : "not going")\(holds ? ", on their calendar" : "")")
        if store.board.canHold(member, event) {
            button
                .contentShape(.contextMenuPreview, .rect(cornerRadius: 16, style: .continuous))
                .contextMenu {
                    Button("Move to \(member.firstName)'s Calendar", systemImage: "calendar") { move(event, to: member) }
                }
        } else {
            button
        }
    }

    /// A tap on whoever's calendar it's on. A kid can sit their own event
    /// out (through TeamSnap when it's TeamSnap's); a parent's event can't go
    /// on without them, so it says how to hand it over instead.
    private func toggleHolder(_ holder: Member, _ event: CalEvent, going: Bool) {
        let board = store.board
        if board.hasRsvp(event) {
            act { try await store.setRsvp(event, going ? .notGoing : .going); return nil }
        } else if board.hasOwnerGoing(event) {
            act { try await store.setOwnerGoing(event, going: !going) }
        } else if board.members.contains(where: { board.canHold($0, event) }) {
            note = "It's on \(holder.firstName)'s calendar, so \(holder.firstName) counts as going. To take \(holder.firstName) off it, hold someone else's face and move it to theirs."
        } else {
            note = "It's \(holder.firstName)'s event, so \(holder.firstName) counts as going."
        }
    }

    private func move(_ event: CalEvent, to member: Member) {
        act { try await store.setHolder(event, member: member.email) }
    }

    private func actionRow(_ title: String, badge: String? = nil, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
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
            content()
        }
    }

    private func driveRow(_ event: CalEvent, _ duty: DutyKind) -> some View {
        let current = store.snapshot.duties[event.id]?[duty]
        func choose(_ state: DutyState) {
            // Tapping the one that's chosen clears it.
            let next: DutyState? = current == state ? nil : state
            act {
                try await store.setDuty(event, duty, next)
                return nil
            }
        }
        return actionRow(duty.label) {
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

    /// A parent given a drive whose Google calendar isn't connected: the
    /// drive shows here but can't reach their real calendar.
    private func unconnected(_ event: CalEvent) -> String? {
        let duties = store.snapshot.duties[event.id] ?? [:]
        let names = store.board.parents
            .filter { parent in parent.primaryCalendarID == nil && duties.values.contains { $0.assignee == parent.email } }
            .map(\.firstName)
        guard !names.isEmpty else { return nil }
        return "\(names.joined(separator: " and ")) \(names.count == 1 ? "has" : "have") no Google calendar connected, so the drive shows here but won't reach their own calendar yet."
    }

    /// Run an instant action: any warning it comes back with shows under the
    /// actions, and so does why it didn't go through.
    private func act(_ action: @escaping () async throws -> String?) {
        note = nil
        Task {
            do {
                note = try await action()
            } catch {
                note = error.localizedDescription
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
