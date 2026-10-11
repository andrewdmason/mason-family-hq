import SwiftUI

/// Once per game: whose at-bats, and which game they're filed under — one of
/// the kid's recent Clips games, or a new one (created in Clips with the first
/// upload, so this works without signal).
struct GamePickerView: View {
    let clips: ClipsService
    @Bindable var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    @State private var kid: Kid?
    @State private var games: [GameChoice] = []
    @State private var loading = false
    @State private var loadError: String?
    @State private var newName = ""
    @State private var newDate = Date()

    var body: some View {
        NavigationStack {
            Form {
                Section("Who's batting") {
                    if settings.cachedKids.isEmpty {
                        Text(loadError ?? "Loading…").foregroundStyle(.secondary)
                    } else {
                        Picker("Kid", selection: $kid) {
                            ForEach(settings.cachedKids) { k in Text(k.firstName).tag(Optional(k)) }
                        }
                        .pickerStyle(.segmented)
                    }
                }

                if let kid {
                    Section {
                        if loading && games.isEmpty {
                            ProgressView()
                        }
                        ForEach(games) { g in
                            Button {
                                choose(g)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(g.name).foregroundStyle(.primary)
                                        Text(g.playedOn).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if settings.game?.id == g.id { Image(systemName: "checkmark") }
                                }
                            }
                        }
                        if let loadError, games.isEmpty, !loading {
                            Text(loadError).font(.caption).foregroundStyle(.secondary)
                        }
                    } header: {
                        Text("\(kid.firstName)'s recent games")
                    }

                    Section("New game") {
                        TextField("Game name (e.g. vs Kabuki)", text: $newName)
                            .textInputAutocapitalization(.words)
                        DatePicker("Date", selection: $newDate, displayedComponents: .date)
                        Button("Use this game") {
                            choose(GameChoice(id: UUID(), kid: kid, name: newName.trimmingCharacters(in: .whitespaces), playedOn: GameChoice.day(newDate)))
                        }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .navigationTitle("Game")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task { await loadKids() }
            .onChange(of: kid) { _, k in
                games = []
                if let k { Task { await loadGames(k) } }
            }
        }
    }

    private func choose(_ game: GameChoice) {
        settings.game = game
        dismiss()
    }

    private func loadKids() async {
        kid = settings.game?.kid ?? settings.cachedKids.first
        do {
            let kids = try await clips.kids()
            settings.cachedKids = kids
            if kid == nil || !kids.contains(where: { $0.id == kid?.id }) { kid = kids.first }
            loadError = nil
        } catch {
            loadError = "Couldn't load the kids — check your signal."
        }
        if let kid, games.isEmpty { await loadGames(kid) }
    }

    private func loadGames(_ kid: Kid) async {
        loading = true
        defer { loading = false }
        do {
            games = try await clips.recentGames(for: kid)
            loadError = nil
        } catch {
            loadError = "No signal — recent games aren't available, but a new game works."
        }
    }
}
