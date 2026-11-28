import AppKit
import SwiftUI

// Trips on the Mac: the band across a trip's days at the top of the week,
// the trip in a side panel (what's still to book, day by day, its own list),
// the Trips list from the toolbar, and the editors for a trip and its
// pieces. The rules are Shared/Trips.swift.

// MARK: Glass

/// A dialog floating over the calendar as the event card does: glass, with
/// ✕ (Escape) and ✓ (⌘Return) in its header and the trash when there's
/// something to remove.
struct GlassDialog<Content: View>: View {
    let title: String
    var symbol: String?
    var width: CGFloat = 460
    var canSave = true
    var saveLabel = "Save"
    var remove: (() -> Void)?
    let close: () -> Void
    var save: (() -> Void)?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                GlassCircleButton(symbol: "xmark", label: "Close", action: close)
                    .keyboardShortcut(.cancelAction)
                if let symbol {
                    Image(systemName: symbol).foregroundStyle(CalendarStyle.olive)
                }
                Text(title)
                    .font(.system(size: 19, weight: .semibold, design: .serif))
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let remove {
                    GlassCircleButton(symbol: "trash", label: "Remove", action: remove)
                        .foregroundStyle(.red)
                }
                if let save {
                    GlassCircleButton(symbol: "checkmark", tint: canSave ? CalendarStyle.olive.opacity(0.5) : nil, label: saveLabel, action: save)
                        .disabled(!canSave)
                        .opacity(canSave ? 1 : 0.5)
                        .keyboardShortcut(.return, modifiers: .command)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 54)
            content()
                .padding(.horizontal, 18)
                .padding(.top, 4)
                .padding(.bottom, 18)
        }
        .frame(width: width)
        .paperGlass(26)
        .shadow(color: .black.opacity(0.18), radius: 30, y: 12)
    }
}

/// A field on glass: plain text on a soft fill, no box.
struct GlassFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .textFieldStyle(.plain)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 8, style: .continuous))
    }
}

extension TextFieldStyle where Self == GlassFieldStyle {
    static var glass: GlassFieldStyle { GlassFieldStyle() }
}

/// What floats over the window for trips: the trip's panel at the right,
/// and whichever dialog is open, centred over everything.
struct TripOverlays: View {
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    static let panelWidth: CGFloat = 390

    var body: some View {
        let window = model.window
        ZStack {
            if let id = window.trip {
                HStack {
                    Spacer()
                    TripPanel(id: id)
                        .id(id)
                        .frame(width: Self.panelWidth)
                        .frame(maxHeight: .infinity)
                        .paperGlass(24)
                        .shadow(color: .black.opacity(0.12), radius: 20, y: 6)
                }
                .padding(10)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
            if window.hasTripDialog {
                Color.black.opacity(0.1)
                    .ignoresSafeArea()
                    .contentShape(.rect)
                    .onTapGesture { window.closeTripDialog() }
                    .transition(.opacity)
                Group {
                    if let trip = window.newTrip {
                        NewTripSheet(trip: trip, close: window.closeTripDialog)
                    } else if let trip = window.editTrip {
                        EditTripSheet(trip: trip, close: window.closeTripDialog)
                    } else if let edit = window.piece {
                        PieceEditor(edit: edit, close: window.closeTripDialog).id(edit.id)
                    } else if let id = window.attaching {
                        AttachSheet(tripID: id, close: window.closeTripDialog)
                    }
                }
                .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.25), value: window.trip)
        .animation(.snappy(duration: 0.2), value: window.hasTripDialog)
    }
}

// MARK: The band

/// The trips across the days in view, a band each, above the all-day events:
/// the signed-in member's own trips solid, the rest of the family's faint,
/// and suggested ones dashed with a way to say yes.
struct TripBands: View {
    let days: [Day]
    let metrics: GridMetrics
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    private struct Row: Identifiable {
        var id: String
        var range: ClosedRange<Int>
        var view: TripView?
        var suggestion: TripSuggestion?
    }

    private var rows: [Row] {
        let board = store.board
        var rows: [Row] = board.trips.compactMap { view in
            Trips.runs(view.trip, across: days).map { Row(id: view.id.uuidString, range: $0, view: view) }
        }
        rows += board.suggestions.compactMap { s in
            Trips.runs(s.trip, across: days).map { Row(id: s.key, range: $0, suggestion: s) }
        }
        return rows
    }

    var body: some View {
        let rows = rows
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                ForEach(rows) { row in
                    let x = metrics.x(row.range.lowerBound) + 3
                    let width = metrics.dayWidth * CGFloat(row.range.count) - 6
                    Group {
                        if let view = row.view {
                            TripBand(view: view, days: days, range: row.range)
                        } else if let s = row.suggestion {
                            SuggestionBand(suggestion: s)
                        }
                    }
                    .frame(width: width, height: 22)
                    .offset(x: x)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 4)
        }
    }
}

private struct TripBand: View {
    let view: TripView
    let days: [Day]
    let range: ClosedRange<Int>
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let trip = view.trip
        let mine = model.me.map(trip.travelers.contains) ?? false
        let today = Day.today()
        let open = view.openCount
        let selected = model.window.trip == trip.id
        Button {
            model.window.trip = selected ? nil : trip.id
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "suitcase.fill").font(.system(size: 10, weight: .semibold))
                Text(trip.name).font(.system(size: 11.5, weight: .semibold)).lineLimit(1)
                // The day it is on the trip, or where the band starts mid-trip.
                if trip.contains(today), days.contains(today) {
                    Text("Day \(trip.dayNumber(today)) of \(trip.length)").font(.system(size: 11)).opacity(0.75).lineLimit(1)
                } else if trip.start < days[range.lowerBound] {
                    Text("continued").font(.system(size: 11)).opacity(0.6).lineLimit(1)
                }
                Spacer(minLength: 4)
                if let label = view.openLabel {
                    Text(label)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1.5)
                        .background(CalendarStyle.amber, in: .capsule)
                        .lineLimit(1)
                } else {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 11))
                }
                Faces(emails: trip.travelers, size: 15, limit: 4, ring: .clear)
            }
            .foregroundStyle(mine ? Color.white : CalendarStyle.accent)
            .padding(.horizontal, 8)
            .frame(maxHeight: .infinity)
            .background {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(mine ? AnyShapeStyle(CalendarStyle.olive) : AnyShapeStyle(CalendarStyle.olive.opacity(0.14)))
            }
            .overlay {
                if selected {
                    RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(CalendarStyle.accent, lineWidth: 2).padding(-2)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help("\(trip.name) · \(TripFormat.dates(trip.start, trip.end))\(open > 0 ? " · \(open) still to book" : "")")
    }
}

private struct SuggestionBand: View {
    let suggestion: TripSuggestion
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "suitcase").font(.system(size: 10, weight: .semibold))
            Text("\(suggestion.name)?").font(.system(size: 11.5, weight: .semibold)).lineLimit(1)
            Text(suggestion.reason).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 4)
            Button("Make a trip") { model.window.newTrip = suggestion.trip.withSuggestion(suggestion) }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(CalendarStyle.accent)
            Button {
                store.dismiss(suggestion) { model.window.report($0) }
            } label: {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Not a trip")
        }
        .foregroundStyle(CalendarStyle.accent)
        .padding(.horizontal, 8)
        .frame(maxHeight: .infinity)
        .background {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(CalendarStyle.accent.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        }
    }
}

// MARK: The Trips list

/// Dropped from the toolbar's suitcase: trips still to come with what's
/// open on each, the ones the calendar suggests, and a way to make one.
struct TripsList: View {
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let board = store.board
        let today = Day.today()
        let upcoming = board.trips.filter { $0.trip.end >= today }
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Trips").font(.system(size: 17, weight: .semibold, design: .serif))
                Spacer()
                Button("New Trip…", systemImage: "plus") {
                    model.window.tripsOpen = false
                    model.window.newTrip = Trip(name: "", start: today, end: today.adding(days: 2), travelers: model.me.map { [$0] } ?? [])
                }
                .buttonStyle(.glass)
                .controlSize(.small)
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 8)

            if upcoming.isEmpty && board.suggestions.isEmpty {
                Text("No trips coming up. Make one for a vacation or a tournament weekend, and the calendar will keep track of what's booked.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 14)
            }
            ForEach(upcoming) { view in
                Button {
                    model.window.tripsOpen = false
                    model.window.trip = view.id
                    model.window.day = view.trip.start
                } label: {
                    TripRow(view: view, today: today)
                }
                .buttonStyle(.plain)
            }
            if !board.suggestions.isEmpty {
                Text("SUGGESTED")
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 14)
                    .padding(.top, 10)
                    .padding(.bottom, 4)
                ForEach(board.suggestions) { s in
                    HStack(spacing: 10) {
                        Image(systemName: "suitcase").foregroundStyle(CalendarStyle.accent).frame(width: 22)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(s.name).font(.system(size: 13, weight: .semibold))
                            Text("\(TripFormat.dates(s.start, s.end)) · \(s.reason)").font(.system(size: 11.5)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Make a Trip") {
                            model.window.tripsOpen = false
                            model.window.newTrip = s.trip.withSuggestion(s)
                        }
                        .buttonStyle(.glassProminent)
                        .tint(CalendarStyle.olive)
                        .controlSize(.small)
                        Button("Not a Trip") { store.dismiss(s) { model.window.report($0) } }
                            .buttonStyle(.glass)
                            .controlSize(.small)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                }
            }
            Spacer(minLength: 10).frame(height: 10)
        }
        .frame(width: 400)
    }
}

private struct TripRow: View {
    let view: TripView
    let today: Day
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let trip = view.trip
        HStack(spacing: 10) {
            Image(systemName: "suitcase.fill").foregroundStyle(CalendarStyle.olive).frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(trip.name.isEmpty ? "Untitled trip" : trip.name).font(.system(size: 13, weight: .semibold))
                Text(subtitle).font(.system(size: 11.5)).foregroundStyle(.secondary)
            }
            Spacer()
            Faces(emails: trip.travelers, size: 18, ring: CalendarStyle.ground)
            status
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .contentShape(.rect)
    }

    private var subtitle: String {
        let trip = view.trip
        let when = TripFormat.dates(trip.start, trip.end)
        if trip.contains(today) { return "\(when) · Day \(trip.dayNumber(today)) of \(trip.length)" }
        let days = today.days(to: trip.start, in: CalendarRules.utc)
        return "\(when) · in \(days) day\(days == 1 ? "" : "s")"
    }

    @ViewBuilder private var status: some View {
        if let label = view.openLabel {
            Text(label)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(CalendarStyle.amber, in: .capsule)
        } else {
            Label("Booked", systemImage: "checkmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(CalendarStyle.accent)
        }
    }
}

// MARK: Making a trip

/// A new trip's name, days and travelers. From a suggestion, its flights
/// and stays come along when it's made.
struct NewTripSheet: View {
    @State var trip: Trip
    let close: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let suggestion = suggestionKey.flatMap { key in store.board.suggestions.first { $0.key == key } }
        GlassDialog(
            title: suggestion == nil ? "New Trip" : "Make a Trip", symbol: "suitcase.fill",
            canSave: !trip.name.trimmingCharacters(in: .whitespaces).isEmpty && !trip.travelers.isEmpty,
            saveLabel: "Make Trip", close: close, save: { make(suggestion) }
        ) {
          VStack(alignment: .leading, spacing: 14) {
            TripFields(trip: $trip)
            if let suggestion, !suggestion.eventIDs.isEmpty {
                Label(
                    "\(suggestion.eventIDs.count) flight\(suggestion.eventIDs.count == 1 ? "" : "s") and stays on the calendar will be attached.",
                    systemImage: "paperclip"
                )
                .font(.callout)
                .foregroundStyle(.secondary)
            }
          }
        }
    }

    private var suggestionKey: String? { trip.suggestionKey }

    private func make(_ suggestion: TripSuggestion?) {
        var made = trip
        made.name = made.name.trimmingCharacters(in: .whitespaces)
        if suggestionKey != nil { made.notes = nil }
        let report: (String) -> Void = { model.window.report($0) }
        if var s = suggestion {
            s.name = made.name
            s.start = made.start
            s.end = made.end
            s.travelers = made.travelers
            let created = store.accept(s, report: report)
            model.window.trip = created.id
        } else {
            store.createTrip(made, report: report)
            model.window.trip = made.id
        }
        model.window.day = made.start
        close()
    }
}

/// A trip's name, first and last day, and who's going.
private struct TripFields: View {
    @Binding var trip: Trip
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let utc = CalendarRules.utc
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
            GridRow {
                Text("Name").foregroundStyle(.secondary)
                TextField("Costa Rica, Manteca tournament…", text: $trip.name)
                    .textFieldStyle(.glass)
                    .font(.system(size: 15))
            }
            GridRow {
                Text("Days").foregroundStyle(.secondary)
                HStack {
                    DatePicker("", selection: dayBinding(\.start), displayedComponents: .date).labelsHidden()
                    Text("to").foregroundStyle(.secondary)
                    DatePicker("", selection: dayBinding(\.end), in: trip.start.start(in: utc)..., displayedComponents: .date).labelsHidden()
                    let nights = trip.start.days(to: trip.end, in: utc)
                    Text(nights == 0 ? "a day" : "\(nights) night\(nights == 1 ? "" : "s")").foregroundStyle(.secondary)
                }
                .environment(\.timeZone, utc.timeZone)
            }
            GridRow(alignment: .top) {
                Text("Who").foregroundStyle(.secondary)
                TravelerToggles(selected: $trip.travelers)
            }
        }
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
}

/// The family as faces to tick on and off.
private struct TravelerToggles: View {
    @Binding var selected: [String]
    var allowed: [String]?
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let members = store.board.members.filter { allowed?.contains($0.email) ?? true }
        HStack(spacing: 10) {
            ForEach(members) { member in
                let on = selected.contains(member.email)
                Button {
                    if on { selected.removeAll { $0 == member.email } } else { selected.append(member.email) }
                } label: {
                    VStack(spacing: 3) {
                        Avatar(member: member, size: 30)
                            .overlay(Circle().strokeBorder(on ? CalendarStyle.accent : .clear, lineWidth: 2).padding(-3))
                            .opacity(on ? 1 : 0.35)
                        Text(member.firstName).font(.system(size: 11)).foregroundStyle(on ? .primary : .secondary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 2)
    }
}

// MARK: The trip, in the side panel

/// One trip: its days and travelers, what's still to book, day by day where
/// everyone goes and sleeps, and its own list.
struct TripPanel: View {
    let id: UUID
    /// Off only for a picture of it (`--render-trip`), which can't draw a scroll view.
    var scrolls = true
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store
    @State private var newItem = ""
    @State private var confirmDelete = false

    var body: some View {
        if let view = store.board.trip(id) {
            Group {
                if scrolls {
                    ScrollView { content(view) }
                } else {
                    content(view)
                }
            }
            .confirmationDialog("Delete “\(view.trip.name)”?", isPresented: $confirmDelete) {
                Button("Delete Trip", role: .destructive) {
                    model.window.trip = nil
                    store.deleteTrip(id) { model.window.report($0) }
                }
            } message: {
                Text("Its bookings and list go with it. The events stay on the calendar.")
            }
        } else {
            ContentUnavailableView("No trip", systemImage: "suitcase")
        }
    }

    private var report: (String) -> Void { { model.window.report($0) } }

    private func content(_ view: TripView) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            header(view)
            toBook(view)
            itinerary(view)
            list(view)
            Button("Delete Trip", role: .destructive) { confirmDelete = true }
                .buttonStyle(.plain)
                .foregroundStyle(.red)
                .font(.callout)
                .padding(.top, 4)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Header

    private func header(_ view: TripView) -> some View {
        let trip = view.trip
        let today = Day.today()
        let nights = trip.start.days(to: trip.end, in: CalendarRules.utc)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(trip.name).font(.system(size: 24, weight: .semibold, design: .serif))
                Spacer()
                Button("Edit") { model.window.editTrip = trip }
                    .buttonStyle(.glass)
                    .controlSize(.small)
                GlassCircleButton(symbol: "xmark", label: "Close", size: 26) { model.window.trip = nil }
            }
            Text("\(TripFormat.dates(trip.start, trip.end)) · \(trip.length) day\(trip.length == 1 ? "" : "s")\(nights > 0 ? ", \(nights) night\(nights == 1 ? "" : "s")" : "")")
                .font(.callout)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Faces(emails: trip.travelers, size: 22, limit: 6)
                Text(ListFormatter.localizedString(byJoining: trip.travelers.compactMap { store.board.member($0)?.firstName }))
                    .font(.callout)
                if let place = view.placeName {
                    Text("· \(place)").font(.callout).foregroundStyle(.secondary)
                }
            }
            if trip.contains(today) {
                Label("Day \(trip.dayNumber(today)) of \(trip.length)", systemImage: "location.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(CalendarStyle.accent)
            } else if trip.start > today {
                let days = today.days(to: trip.start, in: CalendarRules.utc)
                Text("In \(days) day\(days == 1 ? "" : "s")").font(.system(size: 12, weight: .semibold)).foregroundStyle(CalendarStyle.accent)
            }
        }
    }

    // MARK: Still to book

    @ViewBuilder
    private func toBook(_ view: TripView) -> some View {
        let open = view.open
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(open.isEmpty ? "Booked" : "Still to book", count: open.isEmpty ? nil : open.count)
            if open.isEmpty {
                Label("Everyone has a way there, a bed every night and a way home.", systemImage: "checkmark.seal.fill")
                    .font(.callout)
                    .foregroundStyle(CalendarStyle.accent)
            }
            ForEach(view.openGroups, id: \.first!.id) { group in
                SlotRow(slots: group, view: view)
            }
        }
    }

    // MARK: Day by day

    private func itinerary(_ view: TripView) -> some View {
        let trip = view.trip
        let days = (0..<trip.length).map { trip.start.adding(days: $0, in: CalendarRules.utc) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                sectionTitle("Day by day")
                Spacer()
                Menu {
                    ForEach(PieceKind.allCases) { kind in
                        Button(kind.label, systemImage: kind.symbol) { add(kind, to: trip, on: trip.start) }
                    }
                    Divider()
                    Button("From the Calendar…", systemImage: "calendar") { model.window.attaching = trip.id }
                } label: {
                    Label("Add", systemImage: "plus")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .controlSize(.small)
            }
            ForEach(days, id: \.self) { day in
                DayEntry(view: view, day: day)
            }
        }
    }

    // MARK: The trip's own list

    private func list(_ view: TripView) -> some View {
        let trip = view.trip
        return VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Our list", count: view.openItems.isEmpty ? nil : view.openItems.count)
            ForEach(trip.items.sorted { $0.position < $1.position }) { item in
                HStack(spacing: 8) {
                    Toggle(isOn: Binding(
                        get: { item.done },
                        set: { var i = item; i.done = $0; store.saveItem(i, report: report) }
                    )) {
                        Text(item.title).strikethrough(item.done).foregroundStyle(item.done ? .secondary : .primary)
                    }
                    .toggleStyle(.checkbox)
                    Spacer()
                    Button {
                        store.deleteItem(item, report: report)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                    .help("Remove")
                }
            }
            TextField("Add to the list: dog sitter, registration…", text: $newItem)
                .textFieldStyle(.glass)
                .onSubmit {
                    let title = newItem.trimmingCharacters(in: .whitespaces)
                    guard !title.isEmpty else { return }
                    let item = TripItem(tripID: trip.id, title: title, position: (trip.items.map(\.position).max() ?? -1) + 1)
                    store.saveItem(item, report: report)
                    newItem = ""
                }
        }
    }

    private func sectionTitle(_ title: String, count: Int? = nil) -> some View {
        HStack(spacing: 6) {
            Text(title.uppercased()).font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
            if let count {
                Text("\(count)")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(CalendarStyle.amber, in: .capsule)
            }
        }
    }

    private func add(_ kind: PieceKind, to trip: Trip, on day: Day) {
        model.window.piece = PieceEdit(piece: TripEditing.blank(kind, trip: trip, on: day, leg: nil), isNew: true)
    }
}

/// An open slot, and the ways to close it.
private struct SlotRow: View {
    /// One slot, or nights in a row open the same way.
    let slots: [TripSlot]
    let view: TripView

    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    private var slot: TripSlot { slots[0] }

    var body: some View {
        let trip = view.trip
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: TripFormat.symbol(slot))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(CalendarStyle.amber)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(TripFormat.title(slots)).font(.system(size: 13, weight: .semibold))
                Text(TripFormat.subtitle(slot, of: trip, board: store.board)).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 6)
            Menu {
                if case .planned(let piece) = slot.state {
                    Button("Mark “\(piece.displayTitle)” Booked", systemImage: "checkmark") {
                        var booked = piece
                        booked.booked = true
                        store.savePiece(booked, report: report)
                    }
                    Divider()
                }
                Button("From the Calendar…", systemImage: "calendar") { model.window.attaching = trip.id }
                if case .night(let day) = slot.kind {
                    Button("Add a Stay…", systemImage: "bed.double.fill") {
                        var stay = TripEditing.blank(.stay, trip: trip, on: day, leg: nil, for: slot.travelers)
                        // For all the nights in the row.
                        if slots.count > 1, let out = stay.end {
                            stay.end = out.addingTimeInterval(Double(slots.count - 1) * 86_400)
                        }
                        model.window.piece = PieceEdit(piece: stay, isNew: true)
                    }
                    Button("Staying with Family or Friends", systemImage: "house.fill") {
                        if let p = TripEditing.withFamily(slot, view: view) { store.savePiece(p, report: report) }
                    }
                } else {
                    let day = TripFormat.day(of: slot, in: view)
                    Button("Add a Flight…", systemImage: "airplane") {
                        model.window.piece = PieceEdit(piece: TripEditing.blank(.flight, trip: trip, on: day, leg: slot.leg, for: slot.travelers), isNew: true)
                    }
                    Button("Add Other Travel…", systemImage: "tram.fill") {
                        model.window.piece = PieceEdit(piece: TripEditing.blank(.train, trip: trip, on: day, leg: slot.leg, for: slot.travelers), isNew: true)
                    }
                    Button("We're Driving", systemImage: "car.fill") {
                        store.savePieces(TripEditing.driving(slot, view: view), report: report)
                    }
                }
            } label: {
                Text("Sort Out")
            }
            .menuStyle(.button)
            .buttonStyle(.glass)
            .controlSize(.small)
            .fixedSize()
        }
        .padding(10)
        .background(CalendarStyle.amber.opacity(0.11), in: .rect(cornerRadius: 12, style: .continuous))
    }

    private var report: (String) -> Void { { model.window.report($0) } }

}

/// A day of the trip: the ways of getting somewhere that leave on it, where
/// everyone sleeps that night, and the travelers' other events.
private struct DayEntry: View {
    let view: TripView
    let day: Day
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let trip = view.trip
        let home = CalendarRules.familyZone
        let travel = trip.pieces.filter { $0.kind.isTravel && Trips.startDay($0, home: home) == day }
        let cars = trip.pieces.filter { $0.kind == .car && Trips.startDay($0, home: home) == day }
        let checkIns = trip.pieces.filter { $0.kind == .stay && Trips.startDay($0, home: home) == day }
        let tonight = trip.pieces.filter { $0.kind == .stay && Trips.nights($0, home: home).contains(day) }
        let pieceEvents = Set(trip.pieces.compactMap(\.eventID))
        let events = store.board.events(on: day, showHidden: false).filter { item in
            !pieceEvents.contains(item.id) && !item.event.isDrive
                && (trip.travelers.contains(item.event.memberEmail) && item.involved || !Set(item.attendees + [item.event.memberEmail]).isDisjoint(with: trip.travelers) && item.involved)
        }
        let isLast = day == trip.end
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(TripFormat.day(day)).font(.system(size: 13, weight: .semibold))
                Text("Day \(trip.dayNumber(day))").font(.system(size: 11.5)).foregroundStyle(.secondary)
                if day == .today() {
                    Text("Today").font(.system(size: 10.5, weight: .bold)).foregroundStyle(CalendarStyle.now)
                }
                Spacer()
                if let zone = view.zones.values.compactMap({ $0[day] }).first,
                   let name = TripFormat.zoneName(zone, at: day.at(minutes: 12 * 60, in: CalendarRules.utc)) {
                    Text(name).font(.system(size: 10.5, weight: .medium)).foregroundStyle(CalendarStyle.accent)
                }
            }
            ForEach(travel + cars) { piece in PieceRow(piece: piece, trip: trip) }
            ForEach(events.prefix(6)) { item in
                HStack(spacing: 8) {
                    Circle().fill(CalendarStyle.muted(item.color)).frame(width: 6, height: 6).frame(width: 22)
                    Text(item.event.allDay ? "All day" : TripFormat.time(item.event.start, in: item.zone ?? .current))
                        .font(.system(size: 11.5, design: .rounded)).foregroundStyle(.secondary)
                        .frame(width: 62, alignment: .leading)
                    Text(item.event.title).font(.system(size: 12)).lineLimit(1)
                }
            }
            if !isLast {
                if tonight.isEmpty {
                    Label("Tonight: nowhere yet", systemImage: "bed.double")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(CalendarStyle.amber)
                        .padding(.leading, 2)
                } else {
                    ForEach(tonight) { stay in
                        if checkIns.contains(stay) {
                            PieceRow(piece: stay, trip: trip)
                        } else {
                            Button {
                                model.window.piece = PieceEdit(piece: stay, isNew: false)
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "bed.double").font(.system(size: 11)).foregroundStyle(.secondary).frame(width: 22)
                                    Text("Tonight: \(stay.displayTitle)").font(.system(size: 12)).foregroundStyle(.secondary)
                                    if !stay.booked { Text("not booked").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(CalendarStyle.amber) }
                                }
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding(10)
        .background(CalendarStyle.card.opacity(0.62), in: .rect(cornerRadius: 12, style: .continuous))
    }
}

/// A piece in the day by day: what it is, where and when, and its
/// confirmation code to copy. A click opens it.
private struct PieceRow: View {
    let piece: TripPiece
    let trip: Trip
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store
    @State private var copied = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: piece.kind.symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(piece.booked ? CalendarStyle.olive : CalendarStyle.amber)
                .frame(width: 22, height: 18)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(piece.displayTitle).font(.system(size: 12.5, weight: .semibold)).lineLimit(1)
                    if !piece.booked {
                        Text("not booked").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(CalendarStyle.amber)
                    }
                }
                let line = description
                if !line.isEmpty { Text(line).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(2) }
                if let travelers = piece.travelers {
                    Text("For \(TripFormat.people(travelers, of: trip, board: store.board))").font(.system(size: 11)).foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 4)
            if let code = piece.confirmation, !code.isEmpty {
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.4))
                        copied = false
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 9.5, weight: .semibold))
                        Text(copied ? "Copied" : code).font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                    }
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(CalendarStyle.olive.opacity(0.13), in: .rect(cornerRadius: 6, style: .continuous))
                    .foregroundStyle(CalendarStyle.accent)
                }
                .buttonStyle(.plain)
                .help("Copy the confirmation code")
            }
        }
        .contentShape(.rect)
        .onTapGesture { model.window.piece = PieceEdit(piece: piece, isNew: false) }
    }

    private var description: String { TripFormat.detail(piece) }
}

// MARK: Editing a trip

struct EditTripSheet: View {
    @State var trip: Trip
    let close: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        GlassDialog(
            title: "Edit Trip", symbol: "suitcase.fill",
            canSave: !trip.name.trimmingCharacters(in: .whitespaces).isEmpty && !trip.travelers.isEmpty,
            close: close,
            save: {
                store.updateTrip(trip) { model.window.report($0) }
                close()
            }
        ) {
          VStack(alignment: .leading, spacing: 14) {
            TripFields(trip: $trip)
            VStack(alignment: .leading, spacing: 4) {
                Text("Notes").foregroundStyle(.secondary)
                TextEditor(text: Binding(get: { trip.notes ?? "" }, set: { trip.notes = $0.isEmpty ? nil : $0 }))
                    .font(.body)
                    .frame(height: 70)
                    .scrollContentBackground(.hidden)
                    .padding(5)
                    .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 8, style: .continuous))
            }
          }
        }
    }
}

// MARK: Attaching an event

/// The travelers' events around the trip, to make one a piece: picking one
/// reads it (`TripPrefill`) and opens the piece's editor.
struct AttachSheet: View {
    let tripID: UUID
    let close: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        let board = store.board
        let trip = board.trip(tripID)?.trip
        let candidates = trip.map { board.candidates(for: $0) } ?? []
        // Flights and stays first, then the rest by time.
        let sorted = candidates.sorted { a, b in
            let (ka, kb) = (TripPrefill.kind(of: a.event) == .other ? 1 : 0, TripPrefill.kind(of: b.event) == .other ? 1 : 0)
            if ka != kb { return ka < kb }
            return a.event.start < b.event.start
        }
        GlassDialog(title: "Attach from the Calendar", symbol: "paperclip", width: 500, close: close) {
          VStack(alignment: .leading, spacing: 10) {
            Text("Events of the travelers from the day before the trip to the day after. The details are read from the event, for you to check.")
                .font(.callout)
                .foregroundStyle(.secondary)
            if sorted.isEmpty {
                Text("Nothing on the calendar around these days.").foregroundStyle(.secondary).padding(.vertical, 20)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(sorted) { item in
                        let kind = TripPrefill.kind(of: item.event)
                        Button {
                            guard let trip else { return }
                            var piece = TripPrefill.piece(from: item.event, tripID: trip.id)
                            piece.leg = TripPrefill.role(of: piece, in: trip, home: CalendarRules.familyZone)
                            if kind == .other { piece.kind = .other }
                            // Straight on to the piece's editor, in this one's place.
                            model.window.attaching = nil
                            model.window.piece = PieceEdit(piece: piece, isNew: true)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: kind == .other ? "calendar" : kind.symbol)
                                    .foregroundStyle(kind == .other ? .secondary : CalendarStyle.olive)
                                    .frame(width: 22)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.event.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
                                    Text(when(item)).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                                if kind != .other {
                                    Text(kind.label).font(.system(size: 11)).foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 7)
                            .padding(.horizontal, 10)
                            .background(Color.primary.opacity(0.045), in: .rect(cornerRadius: 10, style: .continuous))
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(height: 340)
          }
        }
    }

    private func when(_ item: EventItem) -> String {
        let day = TripFormat.day(item.day)
        let time = item.event.allDay ? "all day" : TripFormat.time(item.event.start, in: item.zone ?? .current)
        return [day, time, item.event.location].compactMap { $0 }.joined(separator: " · ")
    }
}

// MARK: Editing a piece

/// A flight, stay or rental car: what it is, when and where, its
/// confirmation code and the rest, who it's for, and whether it's booked.
struct PieceEditor: View {
    @State var edit: PieceEdit
    let close: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    private var piece: Binding<TripPiece> { $edit.piece }

    var body: some View {
        let trip = store.board.trip(edit.piece.tripID)?.trip
        let p = edit.piece
        GlassDialog(
            title: edit.isNew ? "Add \(p.kind.label)" : p.displayTitle, symbol: p.kind.symbol, width: 500,
            saveLabel: edit.isNew ? "Add" : "Save",
            remove: edit.isNew ? nil : {
                store.deletePiece(edit.piece) { model.window.report($0) }
                close()
            },
            close: close,
            save: {
                var saved = edit.piece
                saved.title = saved.title.trimmingCharacters(in: .whitespaces)
                if !saved.kind.isTravel { saved.leg = nil }
                store.savePiece(saved) { model.window.report($0) }
                close()
            }
        ) {
          VStack(alignment: .leading, spacing: 12) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 9) {
                GridRow {
                    label("Kind")
                    Picker("", selection: piece.kind) {
                        ForEach(PieceKind.allCases) { Label($0.label, systemImage: $0.symbol).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
                GridRow {
                    label("Name")
                    TextField(p.kind == .stay ? "Hotel Arenal Kioro" : "Flight to San José", text: piece.title)
                        .textFieldStyle(.glass)
                }
                if p.kind.isTravel {
                    GridRow {
                        label("Fills")
                        Picker("", selection: piece.leg) {
                            Text("Getting there").tag(LegRole?.some(.out))
                            Text("Moving on").tag(LegRole?.some(.between))
                            Text("Getting home").tag(LegRole?.some(.back))
                            Text("Nothing in particular").tag(LegRole?.none)
                        }
                        .labelsHidden()
                        .fixedSize()
                    }
                    GridRow {
                        label("From")
                        place(piece.fromPlace, zone: piece.fromZone, prompt: "SFO", trip: trip)
                    }
                    GridRow {
                        label("To")
                        place(piece.toPlace, zone: piece.toZone, prompt: "San José", trip: trip)
                    }
                } else if p.kind == .stay {
                    GridRow {
                        label("Where")
                        place(piece.toPlace, zone: piece.toZone, prompt: "La Fortuna", trip: trip)
                    }
                }
                if !p.dayOnly {
                    GridRow {
                        label(p.kind == .stay ? "Check in" : p.kind == .car ? "Pickup" : "Leaves")
                        time(\.start, zone: p.kind == .stay ? p.endZone : p.startZone)
                    }
                    GridRow {
                        label(p.kind == .stay ? "Check out" : p.kind == .car ? "Return" : "Arrives")
                        time(\.end, zone: p.endZone)
                    }
                }
                GridRow {
                    label("Confirmation")
                    TextField("Code", text: Binding(
                        get: { edit.piece.confirmation ?? "" },
                        set: { edit.piece.confirmation = $0.isEmpty ? nil : $0 }
                    ))
                    .textFieldStyle(.glass)
                    .font(.system(.body, design: .monospaced))
                }
                ForEach(p.kind.fields, id: \.key) { field in
                    GridRow {
                        label(field.label)
                        TextField("", text: Binding(
                            get: { edit.piece.details[field.key] ?? "" },
                            set: { edit.piece.details[field.key] = $0.isEmpty ? nil : $0 }
                        ))
                        .textFieldStyle(.glass)
                    }
                }
                GridRow {
                    label("Notes")
                    TextField("", text: Binding(
                        get: { edit.piece.details["notes"] ?? "" },
                        set: { edit.piece.details["notes"] = $0.isEmpty ? nil : $0 }
                    ), axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.glass)
                }
                if let trip, trip.travelers.count > 1 {
                    GridRow(alignment: .top) {
                        label("For")
                        TravelerToggles(selected: Binding(
                            get: { edit.piece.travelers ?? trip.travelers },
                            set: { edit.piece.travelers = Set($0) == Set(trip.travelers) ? nil : $0 }
                        ), allowed: trip.travelers)
                    }
                }
                GridRow {
                    label("")
                    Toggle("Booked", isOn: piece.booked)
                        .help("Off: planned, not locked in yet")
                }
            }
            if let eventID = p.eventID, let event = store.board.rows[eventID] {
                HStack(spacing: 6) {
                    Image(systemName: "paperclip").foregroundStyle(.secondary)
                    Text("Attached to “\(event.title)”").font(.callout).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Button("Detach") {
                        edit.piece.eventID = nil
                        edit.piece.eventGoogleID = nil
                    }
                    .buttonStyle(.glass)
                    .controlSize(.small)
                }
            }
          }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text).foregroundStyle(.secondary).gridColumnAlignment(.trailing)
    }

    /// A place and the zone its times are in.
    private func place(_ place: Binding<String?>, zone: Binding<String?>, prompt: String, trip: Trip?) -> some View {
        HStack {
            TextField(prompt, text: Binding(get: { place.wrappedValue ?? "" }, set: { place.wrappedValue = $0.isEmpty ? nil : $0 }))
                .textFieldStyle(.glass)
                .onSubmit {
                    // An airport code sets its zone.
                    if let code = place.wrappedValue?.uppercased(), let airport = TripPrefill.airports[code] { zone.wrappedValue = airport.zone }
                }
            Picker("", selection: zone) {
                Text("Home time").tag(String?.none)
                ForEach(trip.map(TripFormat.zones) ?? [], id: \.self) { id in
                    Text(CalendarRules.zonePlace(TimeZone(identifier: id) ?? .current)).tag(String?.some(id))
                }
            }
            .labelsHidden()
            .frame(width: 150)
            .help("The clock its times are in")
        }
    }

    /// A date and time, in the zone of that end.
    private func time(_ key: WritableKeyPath<TripPiece, Date?>, zone: TimeZone?) -> some View {
        DatePicker("", selection: Binding(
            get: { edit.piece[keyPath: key] ?? edit.piece.start ?? Date() },
            set: { edit.piece[keyPath: key] = $0 }
        ), displayedComponents: [.date, .hourAndMinute])
        .labelsHidden()
        .environment(\.timeZone, zone ?? CalendarRules.familyZone)
        .fixedSize()
    }
}

// MARK: The applet's line

/// At the top of the applet's day: the trip you're on ("Day 4 of 9 ·
/// Costa Rica · 2:14 pm, 12:14 pm at home") with what's next, or one coming
/// within two weeks with things still to book.
struct AppletTripLine: View {
    let now: Date
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    static func trip(on board: Board, me: String?, now: Date) -> TripView? {
        let today = Day(now)
        let mine = board.trips.filter { v in me.map(v.trip.travelers.contains) ?? true }
        if let on = mine.first(where: { $0.trip.contains(today) }) { return on }
        return mine.first { v in
            v.trip.start > today && today.days(to: v.trip.start, in: CalendarRules.utc) <= 14 && v.openCount > 0
        }
    }

    var body: some View {
        if let view = Self.trip(on: store.board, me: model.me, now: now) {
            let trip = view.trip
            let today = Day(now)
            Button {
                model.window.trip = trip.id
                model.window.day = trip.contains(today) ? today : trip.start
                model.showWindow()
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "suitcase.fill").foregroundStyle(CalendarStyle.olive).padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(headline(view, today: today)).font(.system(size: 13, weight: .semibold))
                        if let detail = detail(view, today: today) {
                            Text(detail).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                    if let code = next(view)?.confirmation {
                        Text(code).font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(CalendarStyle.olive.opacity(0.13), in: .rect(cornerRadius: 5))
                            .foregroundStyle(CalendarStyle.accent)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("Open the trip")
            Rectangle().fill(CalendarStyle.line).frame(height: 1)
        }
    }

    private func headline(_ view: TripView, today: Day) -> String {
        let trip = view.trip
        guard trip.contains(today) else {
            let days = today.days(to: trip.start, in: CalendarRules.utc)
            return ["\(trip.name) in \(days) day\(days == 1 ? "" : "s")", view.openLabel].compactMap { $0 }.joined(separator: " · ")
        }
        var parts = ["Day \(trip.dayNumber(today)) of \(trip.length)", trip.name]
        if let me = model.me, let zone = view.zone(for: me, on: today),
           zone.secondsFromGMT(for: now) != CalendarRules.familyZone.secondsFromGMT(for: now) {
            parts.append("\(TripFormat.time(now, in: zone)) (\(TripFormat.time(now, in: CalendarRules.familyZone)) home)")
        }
        return parts.joined(separator: " · ")
    }

    /// The next way of getting somewhere, or tonight's bed.
    private func next(_ view: TripView) -> TripPiece? {
        view.trip.pieces.filter { $0.kind.isTravel && ($0.start ?? .distantPast) > now }.min { ($0.start ?? now) < ($1.start ?? now) }
    }

    private func detail(_ view: TripView, today: Day) -> String? {
        let trip = view.trip
        guard trip.contains(today) else {
            return view.open.prefix(3).map { $0.title() }.joined(separator: ", ")
        }
        var parts: [String] = []
        if let next = next(view), let start = next.start {
            let day = Trips.startDay(next, home: CalendarRules.familyZone)
            let when = day == today ? TripFormat.time(start, in: next.startZone) : "\(day.map(TripFormat.day) ?? "") \(TripFormat.time(start, in: next.startZone))"
            parts.append("Next: \(next.displayTitle), \(when)")
        }
        let tonight = trip.pieces.first { $0.kind == .stay && Trips.nights($0, home: CalendarRules.familyZone).contains(today) }
        if let tonight { parts.append("Tonight: \(tonight.displayTitle)") } else if today != trip.end { parts.append("Tonight: nowhere yet") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
