import SwiftUI

/// The event form, for a new event or an existing one: the website's fields
/// (title, all-day, start and end, whose calendar, location, notes). Saving
/// shows on the calendar and closes the form at once; the website hears in
/// the background.
struct EventEditor: View {
    let request: EditorRequest
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @Environment(\.dismiss) private var dismiss
    @State private var draft: EventDraft
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
    private var canSave: Bool { !titleIsEmpty && (isNew || draft != request.draft) }

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
                        Text("Edits here are to this one event; change the whole series in Google Calendar. Deleting can take the whole series.")
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
                            .confirmationDialog("Delete “\(event.title)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                                if CalendarRules.repeats(event) {
                                    Button("Delete This Event Only", role: .destructive) { delete(event) }
                                    Button("Delete All Events", role: .destructive) { delete(event, series: true) }
                                } else {
                                    Button("Delete", role: .destructive) { delete(event) }
                                }
                            } message: {
                                Text(deleteNote(event))
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
                    Button(isNew ? "Add" : "Save") { save() }
                        .fontWeight(.semibold)
                        .disabled(!canSave)
                }
            }
            .onAppear { if isNew { focus = .title } }
            .interactiveDismissDisabled(!isNew && draft != request.draft)
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

    /// Save and close at once. The website hears in the background; if it
    /// says no, the change is put back and the calendar says so.
    private func save() {
        guard !titleIsEmpty else {
            error = "A title is required."
            return
        }
        let nav = nav
        if let event = request.event {
            store.update(event, draft) { nav.problem = $0 }
        } else {
            store.create(draft) { nav.problem = $0 }
            // Show the day it landed on.
            nav.day = Day(draft.start)
        }
        dismiss()
    }

    private func deleteNote(_ event: CalEvent) -> String {
        if CalendarRules.repeats(event) {
            return "This is a repeating event. Deleting all of them takes the whole series off Google Calendar, past ones too."
        }
        return event.sourceType == .google ? "It comes off Google Calendar too." : "This can't be undone."
    }

    private func delete(_ event: CalEvent, series: Bool = false) {
        let nav = nav
        store.delete(event, series: series) { nav.problem = $0 }
        dismiss()
    }
}
