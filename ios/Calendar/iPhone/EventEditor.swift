import SwiftUI

/// The event form, for a new event or an existing one: the website's fields
/// (title, all-day, start and end, whose calendar, location, notes). Saving
/// goes through the website and needs a connection; the form stays open, with
/// why, when it doesn't go through.
struct EventEditor: View {
    let request: EditorRequest
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var draft: EventDraft
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false
    @State private var suggestions: [PlaceSuggestion] = []
    @State private var search: Task<Void, Never>?
    @FocusState private var focus: Field?

    private enum Field { case title, location, notes }

    init(request: EditorRequest) {
        self.request = request
        _draft = State(initialValue: request.draft)
    }

    private var isNew: Bool { request.event == nil }
    private var titleIsEmpty: Bool { draft.title.trimmingCharacters(in: .whitespaces).isEmpty }
    private var canSave: Bool { !titleIsEmpty && !saving && (isNew || draft != request.draft) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $draft.title, axis: .vertical)
                        .font(.system(.title3, design: .serif).weight(.semibold))
                        .focused($focus, equals: .title)
                        .submitLabel(.done)
                }

                Section {
                    Toggle("All day", isOn: $draft.allDay)
                    if draft.allDay {
                        DatePicker("Date", selection: start, displayedComponents: .date)
                    } else {
                        DatePicker("Starts", selection: start)
                        DatePicker("Ends", selection: end, in: draft.start...)
                    }
                }

                Section {
                    Picker(request.event?.sourceType == .manual ? "Who" : "Calendar", selection: $draft.memberEmail) {
                        ForEach(store.board.members) { member in
                            Text(label(member)).tag(member.email)
                                .selectionDisabled(!canOwn(member))
                        }
                    }
                } footer: {
                    Text(calendarNote)
                }

                Section {
                    TextField("Location", text: $draft.location)
                        .focused($focus, equals: .location)
                        .textContentType(.fullStreetAddress)
                        .autocorrectionDisabled()
                        .onChange(of: draft.location) { _, text in suggest(text) }
                    ForEach(focus == .location ? suggestions : []) { place in
                        Button {
                            draft.location = place.location
                            suggestions = []
                            focus = nil
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(place.label).font(.subheadline).foregroundStyle(.primary)
                                if let secondary = place.secondary {
                                    Text(secondary).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                Section {
                    TextField("Notes", text: $draft.notes, axis: .vertical)
                        .lineLimit(3...8)
                        .focused($focus, equals: .notes)
                }

                if let rrule = request.event?.rrule {
                    Section {
                        Label(CalendarRules.repeatText(rrule), systemImage: "repeat")
                            .foregroundStyle(.secondary)
                    } footer: {
                        Text("Changes here are to this one event. Change the whole series in Google Calendar.")
                    }
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.red)
                    }
                }

                if let event = request.event {
                    Section {
                        Button("Delete event", systemImage: "trash", role: .destructive) { confirmDelete = true }
                            .foregroundStyle(.red)
                            .disabled(saving)
                            .confirmationDialog("Delete “\(event.title)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                                Button("Delete", role: .destructive) { delete(event) }
                            } message: {
                                Text(event.sourceType == .google ? "It comes off Google Calendar too." : "This can't be undone.")
                            }
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(isNew ? "New event" : "Edit event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button(isNew ? "Add" : "Save") { save() }
                            .fontWeight(.semibold)
                            .disabled(!canSave)
                    }
                }
            }
            .onAppear { if isNew { focus = .title } }
            .interactiveDismissDisabled(saving || (!isNew && draft != request.draft))
        }
        .presentationDetents([.large])
    }

    // MARK: Times

    /// Moving the start keeps the event's length.
    private var start: Binding<Date> {
        Binding(get: { draft.start }, set: { CalendarRules.moveStart(&draft, to: $0) })
    }

    /// An end before the start snaps to a quarter of an hour after it.
    private var end: Binding<Date> {
        Binding(get: { draft.end }, set: { CalendarRules.moveEnd(&draft, to: $0) })
    }

    // MARK: Whose calendar

    /// A Google event can only move to someone with a Google calendar set up.
    private func canOwn(_ member: Member) -> Bool {
        guard let event = request.event, event.sourceType == .google else { return true }
        return member.primaryCalendarID != nil || member.email == event.memberEmail
    }

    private func label(_ member: Member) -> String {
        canOwn(member) ? member.firstName : "\(member.firstName) (no Google calendar)"
    }

    private var calendarNote: String {
        let name = store.board.member(draft.memberEmail)?.firstName ?? "Their"
        if let event = request.event {
            if event.sourceType == .google, draft.memberEmail != event.memberEmail {
                let old = store.board.member(event.memberEmail)?.firstName
                return "Saving moves this event to \(name)'s calendar" + (old.map { "; \($0) and current guests stay invited." } ?? ".")
            }
            return event.sourceType == .google ? "On \(name)'s Google calendar." : "Only in Family HQ, not on a Google calendar."
        }
        return store.sourceForNewEvent(draft.memberEmail) != nil || store.isDemo
            ? "Goes on \(name)'s Google calendar."
            : "\(name) has no Google calendar connected, so this stays in Family HQ only."
    }

    // MARK: Location

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

    // MARK: Saving

    private func save() {
        guard !titleIsEmpty else {
            error = "A title is required."
            return
        }
        saving = true
        error = nil
        Task {
            do {
                if let event = request.event {
                    if let warning = try await store.update(event, draft) { nav.problem = warning }
                } else {
                    try await store.create(draft)
                    // Show the day it landed on.
                    nav.day = Day(draft.start)
                }
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }

    private func delete(_ event: CalEvent) {
        saving = true
        error = nil
        Task {
            do {
                try await store.delete(event)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}
