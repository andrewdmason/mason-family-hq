import SwiftUI
import UIKit

// Trips on the phone: the Trips list (the suitcase in the top bar), a trip's
// page (what's still to book, day by day, its own list), and the forms for a
// trip and its pieces. The band in the top bar is TripBand below. The rules
// are Shared/Trips.swift; the words Shared/TripFormat.swift. The Mac's
// version is Mac/TripViews.swift.

/// A trip to open, as a sheet's item.
struct TripRef: Identifiable, Hashable {
    let id: UUID
}

/// A piece of a trip in its form: one being added or one already there.
struct PieceDraft: Identifiable {
    let id = UUID()
    var piece: TripPiece
    var isNew: Bool
}

// MARK: The band

/// Under the week strip, on a day of a trip: its name, which day of it this
/// is and what's still to book, or where you sleep tonight. A tap opens it.
/// On a day a trip is only suggested for, the suggestion, to make or not.
struct TripBand: View {
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    let me: String?

    var body: some View {
        let board = store.board
        let day = nav.day
        if let view = board.trips(on: day, me: me).first {
            Button {
                nav.trip = TripRef(id: view.id)
            } label: {
                bandLabel(view, day: day)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
            .transition(.opacity)
        } else if let s = board.suggestions.first(where: { $0.trip.contains(day) }) {
            HStack(spacing: 8) {
                Image(systemName: "suitcase").foregroundStyle(CalendarStyle.accent)
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(s.name)?").font(.subheadline.weight(.semibold))
                    Text(s.reason).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Make a Trip") { nav.newTrip = s.trip.withSuggestion(s) }
                    .buttonStyle(.glassProminent)
                    .tint(CalendarStyle.olive)
                    .controlSize(.small)
                Button {
                    store.dismiss(s) { nav.problem = $0 }
                } label: {
                    Image(systemName: "xmark").font(.caption.weight(.bold))
                }
                .buttonStyle(.glass)
                .controlSize(.small)
                .accessibilityLabel("Not a trip")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(CalendarStyle.accent.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            }
            .padding(.horizontal, 12)
            .transition(.opacity)
        }
    }

    private func bandLabel(_ view: TripView, day: Day) -> some View {
        let trip = view.trip
        let mine = me.map(trip.travelers.contains) ?? true
        let tonight = trip.pieces.first { $0.kind == .stay && Trips.nights($0, home: CalendarRules.familyZone).contains(day) }
        return HStack(spacing: 9) {
            Image(systemName: "suitcase.fill").font(.subheadline)
            VStack(alignment: .leading, spacing: 0) {
                Text("\(trip.name) · Day \(trip.dayNumber(day)) of \(trip.length)")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                if day != trip.end {
                    Text(tonight.map { "Tonight: \($0.displayTitle)\($0.booked ? "" : " · not booked")" } ?? "Tonight: nowhere yet")
                        .font(.caption)
                        .opacity(0.8)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if let label = view.openLabel {
                Text(label)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(CalendarStyle.amber, in: .capsule)
            }
            Image(systemName: "chevron.right").font(.caption.weight(.bold)).opacity(0.6)
        }
        .foregroundStyle(mine ? Color.white : CalendarStyle.accent)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            mine ? AnyShapeStyle(CalendarStyle.olive) : AnyShapeStyle(CalendarStyle.olive.opacity(0.14)),
            in: .rect(cornerRadius: 14, style: .continuous)
        )
        .contentShape(.rect)
    }
}

/// A row of faces, overlapping a little.
struct TripFaces: View {
    let emails: [String]
    var size: CGFloat = 22
    @Environment(CalendarStore.self) private var store

    var body: some View {
        HStack(spacing: -size * 0.28) {
            ForEach(emails.prefix(5), id: \.self) { email in
                Avatar(member: store.board.member(email), size: size)
                    .overlay(Circle().strokeBorder(CalendarStyle.ground, lineWidth: 1.5))
            }
        }
    }
}

// MARK: The Trips list

/// From the suitcase: trips to come with what's open on each, the ones the
/// calendar suggests, and a way to make one.
struct TripsSheet: View {
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var path: [TripRef] = []
    @State private var making: Trip?

    var body: some View {
        let board = store.board
        let today = Day.today()
        let upcoming = board.trips.filter { $0.trip.end >= today }
        NavigationStack(path: $path) {
            List {
                if upcoming.isEmpty && board.suggestions.isEmpty {
                    Text("No trips coming up. Make one for a vacation or a tournament weekend, and the calendar keeps track of what's booked.")
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
                if !upcoming.isEmpty {
                    Section("Coming up") {
                        ForEach(upcoming) { view in
                            NavigationLink(value: TripRef(id: view.id)) {
                                TripListRow(view: view, today: today)
                            }
                        }
                    }
                }
                if !board.suggestions.isEmpty {
                    Section("Suggested") {
                        ForEach(board.suggestions) { s in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 10) {
                                    Image(systemName: "suitcase").foregroundStyle(CalendarStyle.accent).frame(width: 26)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(s.name).font(.body.weight(.semibold))
                                        Text("\(TripFormat.dates(s.start, s.end)) · \(s.reason)").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                HStack {
                                    Button("Make a Trip") { making = s.trip.withSuggestion(s) }
                                        .buttonStyle(.glassProminent)
                                        .tint(CalendarStyle.olive)
                                    Button("Not a Trip") { store.dismiss(s) { nav.problem = $0 } }
                                        .buttonStyle(.glass)
                                }
                                .controlSize(.small)
                                .padding(.leading, 36)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Trips")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: TripRef.self) { ref in
                TripPage(id: ref.id, me: me)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("New Trip", systemImage: "plus") {
                        making = Trip(name: "", start: today, end: today.adding(days: 2), travelers: me.map { [$0] } ?? [])
                    }
                }
            }
            .sheet(item: $making) { trip in
                TripForm(trip: trip, isNew: true) { made in
                    path.append(TripRef(id: made.id))
                }
            }
        }
        .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
    }
}

private struct TripListRow: View {
    let view: TripView
    let today: Day

    var body: some View {
        let trip = view.trip
        HStack(spacing: 10) {
            Image(systemName: "suitcase.fill").foregroundStyle(CalendarStyle.olive).frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(trip.name.isEmpty ? "Untitled trip" : trip.name).font(.body.weight(.semibold))
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            TripFaces(emails: trip.travelers, size: 20)
            if let label = view.openLabel {
                Text(label)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(CalendarStyle.amber, in: .capsule)
            } else {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(CalendarStyle.accent)
            }
        }
    }

    private var subtitle: String {
        let trip = view.trip
        let when = TripFormat.dates(trip.start, trip.end)
        if trip.contains(today) { return "\(when) · Day \(trip.dayNumber(today)) of \(trip.length)" }
        let days = today.days(to: trip.start, in: CalendarRules.utc)
        return "\(when) · in \(days) day\(days == 1 ? "" : "s")"
    }
}

/// A trip's page on its own, from the band.
struct TripSheet: View {
    let id: UUID
    let me: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TripPage(id: id, me: me)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { dismiss() }
                    }
                }
        }
        .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
    }
}

// MARK: A trip's page

/// One trip: who and when, what's still to book (each with the ways to sort
/// it out), day by day where everyone goes and sleeps, and its own list.
struct TripPage: View {
    let id: UUID
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var editing: Trip?
    @State private var piece: PieceDraft?
    @State private var attaching = false
    @State private var newItem = ""
    @State private var confirmDelete = false

    private var report: (String) -> Void { { nav.problem = $0 } }

    var body: some View {
        Group {
            if let view = store.board.trip(id) {
                content(view)
            } else {
                ContentUnavailableView("No trip", systemImage: "suitcase")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { trip in TripForm(trip: trip, isNew: false) }
        .sheet(item: $piece) { draft in PieceForm(draft: draft) }
        .sheet(isPresented: $attaching) {
            AttachList(tripID: id) { picked in
                attaching = false
                // The form follows once the list has gone.
                Task {
                    try? await Task.sleep(for: .milliseconds(450))
                    piece = picked
                }
            }
        }
    }

    private func content(_ view: TripView) -> some View {
        let trip = view.trip
        let days = (0..<trip.length).map { trip.start.adding(days: $0, in: CalendarRules.utc) }
        return ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header(view)
                toBook(view)
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        sectionTitle("Day by day")
                        Spacer()
                        addMenu(trip)
                    }
                    ForEach(days, id: \.self) { day in
                        DayBlockView(view: view, day: TripDay(view, day: day, board: store.board)) { piece = PieceDraft(piece: $0, isNew: false) }
                    }
                }
                list(trip, view: view)
                Button("Delete Trip", role: .destructive) { confirmDelete = true }
                    .padding(.top, 6)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 40)
        }
        .scrollContentBackground(.hidden)
        // Its own paper, so the day cards stand out wherever it's shown.
        .background(CalendarStyle.ground.opacity(0.75).ignoresSafeArea())
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit") { editing = trip }
            }
        }
        .confirmationDialog("Delete “\(trip.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Trip", role: .destructive) {
                store.deleteTrip(trip.id, report: report)
                dismiss()
            }
        } message: {
            Text("Its bookings and list go with it. The events stay on the calendar.")
        }
    }

    private func header(_ view: TripView) -> some View {
        let trip = view.trip
        let today = Day.today()
        let nights = trip.start.days(to: trip.end, in: CalendarRules.utc)
        return VStack(alignment: .leading, spacing: 6) {
            Text(trip.name).font(.system(.largeTitle, design: .serif).weight(.semibold))
            Text("\(TripFormat.dates(trip.start, trip.end)) · \(trip.length) day\(trip.length == 1 ? "" : "s")\(nights > 0 ? ", \(nights) night\(nights == 1 ? "" : "s")" : "")\(view.placeName.map { " · \($0)" } ?? "")")
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                TripFaces(emails: trip.travelers, size: 24)
                Text(ListFormatter.localizedString(byJoining: trip.travelers.compactMap { store.board.member($0)?.firstName }))
                    .font(.subheadline)
            }
            if trip.contains(today) {
                Label("Day \(trip.dayNumber(today)) of \(trip.length)", systemImage: "location.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(CalendarStyle.accent)
            } else if trip.start > today {
                let days = today.days(to: trip.start, in: CalendarRules.utc)
                Text("In \(days) day\(days == 1 ? "" : "s")").font(.subheadline.weight(.semibold)).foregroundStyle(CalendarStyle.accent)
            }
        }
    }

    @ViewBuilder
    private func toBook(_ view: TripView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(view.open.isEmpty ? "Booked" : "Still to book", count: view.open.isEmpty ? nil : view.open.count)
            if view.open.isEmpty {
                Label("Everyone has a way there, a bed every night and a way home.", systemImage: "checkmark.seal.fill")
                    .font(.subheadline)
                    .foregroundStyle(CalendarStyle.accent)
            }
            ForEach(view.openGroups, id: \.first!.id) { group in
                slotRow(group, view: view)
            }
        }
    }

    private func slotRow(_ slots: [TripSlot], view: TripView) -> some View {
        let slot = slots[0]
        let trip = view.trip
        let day = TripFormat.day(of: slot, in: view)
        return HStack(spacing: 12) {
            Image(systemName: TripFormat.symbol(slot))
                .font(.body.weight(.semibold))
                .foregroundStyle(CalendarStyle.amber)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(TripFormat.title(slots)).font(.subheadline.weight(.semibold))
                Text(TripFormat.subtitle(slot, of: trip, board: store.board)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 6)
            Menu {
                if case .planned(let planned) = slot.state {
                    Button("Mark “\(planned.displayTitle)” Booked", systemImage: "checkmark") {
                        var booked = planned
                        booked.booked = true
                        store.savePiece(booked, report: report)
                    }
                    Divider()
                }
                Button("From the Calendar…", systemImage: "calendar") { attaching = true }
                if case .night = slot.kind {
                    Button("Add a Stay…", systemImage: "bed.double.fill") {
                        var stay = TripEditing.blank(.stay, trip: trip, on: day, leg: nil, for: slot.travelers)
                        if slots.count > 1, let out = stay.end { stay.end = out.addingTimeInterval(Double(slots.count - 1) * 86_400) }
                        piece = PieceDraft(piece: stay, isNew: true)
                    }
                    Button("Staying with Family or Friends", systemImage: "house.fill") {
                        if let p = TripEditing.withFamily(slot, view: view) { store.savePiece(p, report: report) }
                    }
                } else {
                    Button("Add a Flight…", systemImage: "airplane") {
                        piece = PieceDraft(piece: TripEditing.blank(.flight, trip: trip, on: day, leg: slot.leg, for: slot.travelers), isNew: true)
                    }
                    Button("Add Other Travel…", systemImage: "tram.fill") {
                        piece = PieceDraft(piece: TripEditing.blank(.train, trip: trip, on: day, leg: slot.leg, for: slot.travelers), isNew: true)
                    }
                    Button("We're Driving", systemImage: "car.fill") {
                        store.savePieces(TripEditing.driving(slot, view: view), report: report)
                    }
                }
            } label: {
                Text("Sort Out").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.glass)
            .controlSize(.small)
        }
        .padding(12)
        .background(CalendarStyle.amber.opacity(0.11), in: .rect(cornerRadius: 16, style: .continuous))
    }

    private func addMenu(_ trip: Trip) -> some View {
        Menu {
            ForEach(PieceKind.allCases) { kind in
                Button(kind.label, systemImage: kind.symbol) {
                    piece = PieceDraft(piece: TripEditing.blank(kind, trip: trip, on: trip.start, leg: nil), isNew: true)
                }
            }
            Divider()
            Button("From the Calendar…", systemImage: "calendar") { attaching = true }
        } label: {
            Label("Add", systemImage: "plus").font(.subheadline.weight(.semibold))
        }
        .buttonStyle(.glass)
        .controlSize(.small)
    }

    private func list(_ trip: Trip, view: TripView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Our list", count: view.openItems.isEmpty ? nil : view.openItems.count)
            ForEach(trip.items.sorted { $0.position < $1.position }) { item in
                HStack(spacing: 10) {
                    Button {
                        var done = item
                        done.done.toggle()
                        store.saveItem(done, report: report)
                    } label: {
                        Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(item.done ? CalendarStyle.accent : .secondary)
                    }
                    .buttonStyle(.plain)
                    Text(item.title)
                        .strikethrough(item.done)
                        .foregroundStyle(item.done ? .secondary : .primary)
                    Spacer()
                }
                .contextMenu {
                    Button("Remove", systemImage: "trash", role: .destructive) { store.deleteItem(item, report: report) }
                }
            }
            HStack(spacing: 10) {
                Image(systemName: "plus.circle").font(.title3).foregroundStyle(.tertiary)
                TextField("Dog sitter, registration…", text: $newItem)
                    .submitLabel(.done)
                    .onSubmit {
                        let title = newItem.trimmingCharacters(in: .whitespaces)
                        guard !title.isEmpty else { return }
                        store.saveItem(TripItem(tripID: trip.id, title: title, position: (trip.items.map(\.position).max() ?? -1) + 1), report: report)
                        newItem = ""
                    }
            }
        }
    }

    private func sectionTitle(_ title: String, count: Int? = nil) -> some View {
        HStack(spacing: 6) {
            Text(title.uppercased()).font(.caption.weight(.bold)).foregroundStyle(.secondary)
            if let count {
                Text("\(count)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(CalendarStyle.amber, in: .capsule)
            }
        }
    }
}

/// A day of the trip as a card: its bookings, the travelers' events, and
/// where everyone sleeps that night.
private struct DayBlockView: View {
    let view: TripView
    let day: TripDay
    let open: (TripPiece) -> Void

    var body: some View {
        let trip = view.trip
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(TripFormat.day(day.day)).font(.subheadline.weight(.semibold))
                Text("Day \(trip.dayNumber(day.day))").font(.caption).foregroundStyle(.secondary)
                if day.day == .today() {
                    Text("Today").font(.caption2.weight(.bold)).foregroundStyle(CalendarStyle.now)
                }
                Spacer()
                if let zone = view.zones.values.compactMap({ $0[day.day] }).first,
                   let name = TripFormat.zoneName(zone, at: day.day.at(minutes: 12 * 60, in: CalendarRules.utc)) {
                    Text(name).font(.caption2.weight(.medium)).foregroundStyle(CalendarStyle.accent)
                }
            }
            ForEach(day.travel) { piece in PieceLine(piece: piece, trip: trip).onTapGesture { open(piece) } }
            ForEach(day.events.prefix(6)) { item in
                HStack(spacing: 8) {
                    Circle().fill(CalendarStyle.muted(item.color)).frame(width: 7, height: 7).frame(width: 26)
                    Text(item.event.allDay ? "All day" : TripFormat.time(item.event.start, in: item.zone ?? .current))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 64, alignment: .leading)
                    Text(item.event.title).font(.subheadline).lineLimit(1)
                }
            }
            if !day.isLast {
                if day.tonight.isEmpty {
                    Label("Tonight: nowhere yet", systemImage: "bed.double")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(CalendarStyle.amber)
                } else {
                    ForEach(day.tonight) { stay in
                        if day.checkIns.contains(stay) {
                            PieceLine(piece: stay, trip: trip).onTapGesture { open(stay) }
                        } else {
                            HStack(spacing: 8) {
                                Image(systemName: "bed.double").font(.caption).foregroundStyle(.secondary).frame(width: 26)
                                Text("Tonight: \(stay.displayTitle)").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                if !stay.booked { Text("not booked").font(.caption.weight(.semibold)).foregroundStyle(CalendarStyle.amber) }
                            }
                            .contentShape(.rect)
                            .onTapGesture { open(stay) }
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(CalendarStyle.card.opacity(0.7), in: .rect(cornerRadius: 16, style: .continuous))
    }
}

/// A booking: what, where and when, and its confirmation code to copy.
private struct PieceLine: View {
    let piece: TripPiece
    let trip: Trip
    @Environment(CalendarStore.self) private var store
    @State private var copied = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: piece.kind.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(piece.booked ? CalendarStyle.olive : CalendarStyle.amber)
                .frame(width: 26, height: 20)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(piece.displayTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if !piece.booked { Text("not booked").font(.caption.weight(.semibold)).foregroundStyle(CalendarStyle.amber) }
                }
                let detail = TripFormat.detail(piece)
                if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                if let travelers = piece.travelers {
                    Text("For \(TripFormat.people(travelers, of: trip, board: store.board))").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 4)
            if let code = piece.confirmation, !code.isEmpty {
                Button {
                    UIPasteboard.general.string = code
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.4))
                        copied = false
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.caption2.weight(.semibold))
                        Text(copied ? "Copied" : code).font(.caption.weight(.semibold).monospaced())
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(CalendarStyle.olive.opacity(0.13), in: .rect(cornerRadius: 8, style: .continuous))
                    .foregroundStyle(CalendarStyle.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Copy confirmation code \(code)")
                .sensoryFeedback(.success, trigger: copied) { _, new in new }
            }
        }
        .contentShape(.rect)
    }
}

// MARK: Forms

/// A trip's name, days and travelers: a new one (from a suggestion, its
/// flights and stays come along) or one being changed.
struct TripForm: View {
    @State var trip: Trip
    let isNew: Bool
    var made: (Trip) -> Void = { _ in }
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let utc = CalendarRules.utc
        let suggestion = trip.suggestionKey.flatMap { key in store.board.suggestions.first { $0.key == key } }
        NavigationStack {
            Form {
                Section {
                    TextField("Costa Rica, Manteca tournament…", text: $trip.name)
                        .font(.title3)
                }
                Section {
                    DatePicker("First day", selection: dayBinding(\.start), displayedComponents: .date)
                    DatePicker("Last day", selection: dayBinding(\.end), in: trip.start.start(in: utc)..., displayedComponents: .date)
                } footer: {
                    let nights = trip.start.days(to: trip.end, in: utc)
                    Text(nights == 0 ? "A day trip." : "\(nights) night\(nights == 1 ? "" : "s").")
                }
                .environment(\.timeZone, utc.timeZone)
                Section("Who's going") {
                    ForEach(store.board.members) { member in
                        Toggle(isOn: Binding(
                            get: { trip.travelers.contains(member.email) },
                            set: { on in
                                if on { trip.travelers.append(member.email) } else { trip.travelers.removeAll { $0 == member.email } }
                            }
                        )) {
                            HStack(spacing: 10) {
                                Avatar(member: member, size: 28)
                                Text(member.firstName)
                            }
                        }
                    }
                }
                if !isNew {
                    Section("Notes") {
                        TextField("", text: Binding(get: { trip.notes ?? "" }, set: { trip.notes = $0.isEmpty ? nil : $0 }), axis: .vertical)
                            .lineLimit(2...5)
                    }
                }
                if let suggestion, !suggestion.eventIDs.isEmpty {
                    Section {
                        Label("\(suggestion.eventIDs.count) flights and stays on the calendar will be attached.", systemImage: "paperclip")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle(isNew ? (suggestion == nil ? "New Trip" : "Make a Trip") : "Edit Trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isNew ? "Make Trip" : "Save", systemImage: "checkmark") { save(suggestion) }
                        .disabled(trip.name.trimmingCharacters(in: .whitespaces).isEmpty || trip.travelers.isEmpty)
                }
            }
        }
        .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
    }

    private func dayBinding(_ key: WritableKeyPath<Trip, Day>) -> Binding<Date> {
        let utc = CalendarRules.utc
        return Binding(
            get: { trip[keyPath: key].at(minutes: 12 * 60, in: utc) },
            set: { date in
                trip[keyPath: key] = Day(date, in: utc)
                if trip.end < trip.start { trip.end = trip.start }
            }
        )
    }

    private func save(_ suggestion: TripSuggestion?) {
        var saved = trip
        saved.name = saved.name.trimmingCharacters(in: .whitespaces)
        let report: (String) -> Void = { nav.problem = $0 }
        if !isNew {
            store.updateTrip(saved, report: report)
        } else if var s = suggestion {
            s.name = saved.name
            s.start = saved.start
            s.end = saved.end
            s.travelers = saved.travelers
            made(store.accept(s, report: report))
        } else {
            saved.notes = nil
            store.createTrip(saved, report: report)
            made(saved)
        }
        dismiss()
    }
}

/// A flight, stay or rental car: what it is, when and where, its
/// confirmation code and the rest, who it's for, and whether it's booked.
struct PieceForm: View {
    @State var draft: PieceDraft
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let trip = store.board.trip(draft.piece.tripID)?.trip
        let p = draft.piece
        NavigationStack {
            Form {
                Section {
                    Picker("Kind", selection: $draft.piece.kind) {
                        ForEach(PieceKind.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
                    }
                    TextField(p.kind == .stay ? "Hotel Arenal Kioro" : "Flight to San José", text: $draft.piece.title)
                    Toggle("Booked", isOn: $draft.piece.booked)
                } footer: {
                    if !p.booked { Text("Planned, not locked in: its slot stays on the list to book.") }
                }
                if p.kind.isTravel {
                    Section {
                        Picker("Fills", selection: $draft.piece.leg) {
                            Text("Getting there").tag(LegRole?.some(.out))
                            Text("Moving on").tag(LegRole?.some(.between))
                            Text("Getting home").tag(LegRole?.some(.back))
                            Text("Nothing in particular").tag(LegRole?.none)
                        }
                        place("From", $draft.piece.fromPlace, zone: $draft.piece.fromZone, prompt: "SFO", trip: trip)
                        place("To", $draft.piece.toPlace, zone: $draft.piece.toZone, prompt: "San José", trip: trip)
                    }
                } else if p.kind == .stay {
                    Section {
                        place("Where", $draft.piece.toPlace, zone: $draft.piece.toZone, prompt: "La Fortuna", trip: trip)
                    }
                }
                if !p.dayOnly {
                    Section {
                        time(p.kind == .stay ? "Check in" : p.kind == .car ? "Pickup" : "Leaves", \.start, zone: p.kind == .stay ? p.endZone : p.startZone)
                        time(p.kind == .stay ? "Check out" : p.kind == .car ? "Return" : "Arrives", \.end, zone: p.endZone)
                    } footer: {
                        Text("Each time is in its own place's clock.")
                    }
                }
                Section {
                    field("Confirmation", "confirmation", prompt: "Code", monospaced: true)
                    ForEach(p.kind.fields, id: \.key) { f in field(f.label, f.key) }
                    field("Notes", "notes")
                }
                if let trip, trip.travelers.count > 1 {
                    Section("For") {
                        ForEach(trip.travelers, id: \.self) { email in
                            Toggle(isOn: Binding(
                                get: { (draft.piece.travelers ?? trip.travelers).contains(email) },
                                set: { on in
                                    var list = draft.piece.travelers ?? trip.travelers
                                    if on { list.append(email) } else { list.removeAll { $0 == email } }
                                    draft.piece.travelers = Set(list) == Set(trip.travelers) ? nil : list
                                }
                            )) {
                                HStack(spacing: 10) {
                                    Avatar(member: store.board.member(email), size: 26)
                                    Text(store.board.member(email)?.firstName ?? email)
                                }
                            }
                        }
                    }
                }
                if let eventID = p.eventID, let event = store.board.rows[eventID] {
                    Section {
                        Label("Attached to “\(event.title)”", systemImage: "paperclip").foregroundStyle(.secondary)
                        Button("Detach from the Event") {
                            draft.piece.eventID = nil
                            draft.piece.eventGoogleID = nil
                        }
                    }
                }
                if !draft.isNew {
                    Section {
                        Button("Remove from the Trip", role: .destructive) {
                            store.deletePiece(draft.piece) { nav.problem = $0 }
                            dismiss()
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle(draft.isNew ? "Add \(p.kind.label)" : p.displayTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(draft.isNew ? "Add" : "Save", systemImage: "checkmark") {
                        var saved = draft.piece
                        saved.title = saved.title.trimmingCharacters(in: .whitespaces)
                        if !saved.kind.isTravel { saved.leg = nil }
                        store.savePiece(saved) { nav.problem = $0 }
                        dismiss()
                    }
                }
            }
        }
        .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
    }

    /// A place, and the zone its times are in (an airport code sets it).
    private func place(_ label: String, _ value: Binding<String?>, zone: Binding<String?>, prompt: String, trip: Trip?) -> some View {
        Group {
            LabeledContent(label) {
                TextField(prompt, text: Binding(get: { value.wrappedValue ?? "" }, set: { value.wrappedValue = $0.isEmpty ? nil : $0 }))
                    .multilineTextAlignment(.trailing)
                    .onSubmit {
                        if let code = value.wrappedValue?.uppercased(), let airport = TripPrefill.airports[code] { zone.wrappedValue = airport.zone }
                    }
            }
            Picker("\(label) time", selection: zone) {
                Text("Home time").tag(String?.none)
                ForEach(trip.map(TripFormat.zones) ?? [], id: \.self) { id in
                    Text(CalendarRules.zonePlace(TimeZone(identifier: id) ?? .current)).tag(String?.some(id))
                }
            }
        }
    }

    private func time(_ label: String, _ key: WritableKeyPath<TripPiece, Date?>, zone: TimeZone?) -> some View {
        DatePicker(label, selection: Binding(
            get: { draft.piece[keyPath: key] ?? draft.piece.start ?? Date() },
            set: { draft.piece[keyPath: key] = $0 }
        ))
        .environment(\.timeZone, zone ?? CalendarRules.familyZone)
    }

    private func field(_ label: String, _ key: String, prompt: String = "", monospaced: Bool = false) -> some View {
        LabeledContent(label) {
            TextField(prompt, text: Binding(
                get: { key == "confirmation" ? draft.piece.confirmation ?? "" : draft.piece.details[key] ?? "" },
                set: { value in
                    if key == "confirmation" {
                        draft.piece.confirmation = value.isEmpty ? nil : value
                    } else {
                        draft.piece.details[key] = value.isEmpty ? nil : value
                    }
                }
            ))
            .multilineTextAlignment(.trailing)
            .font(monospaced ? .body.monospaced() : .body)
            .textInputAutocapitalization(monospaced ? .characters : .sentences)
        }
    }
}

/// The travelers' events around the trip, to make one a booking: picking
/// one reads it (`TripPrefill`) and hands the piece on to its form.
struct AttachList: View {
    let tripID: UUID
    let picked: (PieceDraft) -> Void
    @Environment(CalendarStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let board = store.board
        let trip = board.trip(tripID)?.trip
        let candidates = (trip.map { board.candidates(for: $0) } ?? []).sorted { a, b in
            let (ka, kb) = (TripPrefill.kind(of: a.event) == .other ? 1 : 0, TripPrefill.kind(of: b.event) == .other ? 1 : 0)
            if ka != kb { return ka < kb }
            return a.event.start < b.event.start
        }
        NavigationStack {
            List {
                Section {
                    ForEach(candidates) { item in
                        let kind = TripPrefill.kind(of: item.event)
                        Button {
                            guard let trip else { return }
                            var piece = TripPrefill.piece(from: item.event, tripID: trip.id)
                            piece.leg = TripPrefill.role(of: piece, in: trip, home: CalendarRules.familyZone)
                            picked(PieceDraft(piece: piece, isNew: true))
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: kind == .other ? "calendar" : kind.symbol)
                                    .foregroundStyle(kind == .other ? .secondary : CalendarStyle.olive)
                                    .frame(width: 26)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.event.title).foregroundStyle(.primary).lineLimit(1)
                                    Text(when(item)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                    }
                } footer: {
                    Text(candidates.isEmpty
                        ? "Nothing on the travelers' calendars around these days."
                        : "Events from the day before the trip to the day after. The details are read from the event, for you to check.")
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("From the Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
            }
        }
        .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
    }

    private func when(_ item: EventItem) -> String {
        let time = item.event.allDay ? "all day" : TripFormat.time(item.event.start, in: item.zone ?? .current)
        return [TripFormat.day(item.day), time, item.event.location].compactMap { $0 }.joined(separator: " · ")
    }
}
