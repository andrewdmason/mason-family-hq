import SwiftUI

/// Where an event is, chosen: a card over the event's, with a field to type
/// in and places to pick under it. Before anything is typed those are the
/// places the family's own events are at; typing narrows them and adds what
/// the website finds, near home first.
///
/// A tap on a place chooses it and closes the card. ✓, or return, keeps the
/// words as typed (none takes the location off); ✕ changes nothing.
struct LocationCard: View {
    /// What the event has now.
    let current: String
    /// One search, from its first letter to its pick (CalendarStore.places).
    let session: UUID
    /// The words chosen, and the suggestion they came from when it was one.
    let choose: (String, PlaceSuggestion?) -> Void

    @Environment(CalendarStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var text: String
    @State private var selection: TextSelection?
    @State private var recents: [String] = []
    @State private var suggestions: [PlaceSuggestion] = []
    @State private var search: Task<Void, Never>?
    @FocusState private var typing: Bool

    init(current: String, session: UUID, choose: @escaping (String, PlaceSuggestion?) -> Void) {
        self.current = current.trimmingCharacters(in: .whitespacesAndNewlines)
        self.session = session
        self.choose = choose
        _text = State(initialValue: self.current)
    }

    /// What's typed. Return in the field, which wraps, leaves a line break
    /// behind; it's not part of the place.
    private var query: String {
        text.replacingOccurrences(of: "\n", with: "").trimmingCharacters(in: .whitespaces)
    }
    /// Still what the event has: nothing to search for yet.
    private var untouched: Bool { query == current }
    private var canKeep: Bool { !untouched }

    /// The family's places: all of them until something's typed, then the
    /// few that match it.
    private var shownRecents: [String] {
        untouched ? recents : Array(CalendarRules.matching(recents, query).prefix(3))
    }

    /// What the website found, less what's already listed as the family's.
    private var shownSuggestions: [PlaceSuggestion] {
        guard !untouched else { return [] }
        let listed = Set(shownRecents.map { $0.lowercased() })
        return suggestions.filter { !listed.contains($0.location.lowercased()) }
    }

    /// The words as typed, offered as a row when no row is exactly them.
    private var asTyped: String? {
        guard !untouched, !query.isEmpty else { return nil }
        let exact = shownRecents.contains { $0.caseInsensitiveCompare(query) == .orderedSame }
        return exact ? nil : query
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            field
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(shownRecents, id: \.self) { place in
                        let parts = CalendarRules.placeParts(place)
                        row("clock", parts.name, parts.rest) { pick(place, nil) }
                    }
                    ForEach(shownSuggestions) { place in
                        row("mappin.and.ellipse", place.label, place.secondary) { pick(place.location, place) }
                    }
                    if let asTyped {
                        row("character.cursor.ibeam", "“\(asTyped)”", "Use what you typed") { pick(asTyped, nil) }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground { CalendarStyle.ground.opacity(0.82).background(.ultraThinMaterial) }
        .animation(.snappy, value: shownSuggestions)
        .animation(.snappy, value: shownRecents)
        .onAppear {
            recents = CalendarRules.recentPlaces(Array(store.board.rows.values))
                .filter { $0.caseInsensitiveCompare(current) != .orderedSame }
            typing = true
        }
        .onChange(of: typing) {
            // What the event has comes selected, so typing replaces it and a
            // tap in it edits it. Only once the field has the keyboard: a
            // selection set before then doesn't take.
            guard typing, untouched, !text.isEmpty else { return }
            Task {
                try? await Task.sleep(for: .milliseconds(80))
                if untouched { selection = TextSelection(range: text.startIndex..<text.endIndex) }
            }
        }
        .onChange(of: text) {
            // Return keeps the words as typed.
            if text.contains("\n") { submit() } else { suggest() }
        }
        .onDisappear { search?.cancel() }
    }

    private var header: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Cancel")

            Spacer()
            Text("Location").font(.headline)
            Spacer()

            Button {
                pick(query, nil)
            } label: {
                Image(systemName: "checkmark")
                    .font(.system(size: 16, weight: .bold))
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .disabled(!canKeep)
            .glassEffect(canKeep ? .regular.tint(CalendarStyle.olive.opacity(0.45)).interactive() : .regular, in: .circle)
            .accessibilityLabel(query.isEmpty ? "Remove Location" : "Use What You Typed")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 10)
        .animation(.snappy, value: canKeep)
    }

    private var field: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            // It wraps, so a long address shows whole and not just its tail.
            TextField("Search or enter an address", text: $text, selection: $selection, axis: .vertical)
                .lineLimit(1...3)
                .focused($typing)
                .textContentType(.fullStreetAddress)
                .autocorrectionDisabled()
                .submitLabel(.done)
            if !text.isEmpty {
                Button {
                    text = ""
                    typing = true
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func row(_ symbol: String, _ name: String, _ rest: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: symbol)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).foregroundStyle(.primary)
                    if let rest {
                        Text(rest).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 10)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func submit() {
        if canKeep { pick(query, nil) } else { dismiss() }
    }

    private func pick(_ location: String, _ place: PlaceSuggestion?) {
        choose(location, place)
        dismiss()
    }

    private func suggest() {
        search?.cancel()
        let query = query
        guard !untouched, query.count >= 2 else {
            suggestions = []
            return
        }
        search = Task {
            try? await Task.sleep(for: .milliseconds(220))
            guard !Task.isCancelled else { return }
            let found = await store.places(query, session: session)
            if !Task.isCancelled { suggestions = found }
        }
    }
}
