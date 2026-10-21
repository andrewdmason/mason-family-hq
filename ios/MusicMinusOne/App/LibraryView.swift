import MasonKit
import SwiftUI
import UniformTypeIdentifiers

/// The first screen: every song, and a way to add one.
struct LibraryView: View {
    @State private var library = Library.shared
    @State private var adding = false
    @State private var open: UUID?
    @State private var confirmDelete: Song?

    var body: some View {
        NavigationStack {
            List {
                ForEach(library.songs) { song in
                    Button { open = song.id } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(song.name).font(.headline)
                            Text(summary(song)).font(.subheadline).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    .tint(.primary)
                    .swipeActions {
                        Button("Delete", role: .destructive) { confirmDelete = song }
                    }
                }
            }
            .overlay {
                if library.songs.isEmpty {
                    ContentUnavailableView {
                        Label("No songs yet", systemImage: "music.quarternote.3")
                    } description: {
                        Text("Add a song and load each instrument's recording as its own track.")
                    } actions: {
                        Button("New Song") { adding = true }.buttonStyle(.borderedProminent)
                    }
                }
            }
            .refreshable { await library.syncNow() }
            .navigationTitle("Music Minus One")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { AccountMenu(sync: library.sync) }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("New song")
                }
            }
            .sheet(isPresented: $adding) {
                SongDetailsView(song: nil) { id in open = id }
            }
            .fullScreenCover(item: Binding(get: { open.map(OpenSong.init) }, set: { open = $0?.id })) { item in
                SongView(songID: item.id)
            }
            .confirmationDialog(
                "Delete \(confirmDelete?.name ?? "song")?",
                isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
                titleVisibility: .visible
            ) {
                Button("Delete Song", role: .destructive) {
                    if let song = confirmDelete {
                        song.tracks.forEach(library.removeAudio)
                        library.delete(song.id)
                    }
                }
            } message: {
                Text("Its tracks and markers go too, on every device.")
            }
        }
    }

    private func summary(_ song: Song) -> String {
        var parts = ["\(Int(song.tempo.rounded())) BPM"]
        parts.append(song.tracks.count == 1 ? "1 track" : "\(song.tracks.count) tracks")
        if !song.markers.isEmpty { parts.append(song.markers.count == 1 ? "1 marker" : "\(song.markers.count) markers") }
        return parts.joined(separator: " · ")
    }
}

private struct OpenSong: Identifiable { let id: UUID }

/// Who's signed in, whether the library is backed up, and the way out.
struct AccountMenu: View {
    let sync: SyncState

    var body: some View {
        Menu {
            Section(Session.shared.email ?? "Signed in") {
                Text(syncText)
                Button("Sign out", role: .destructive) { Task { await Session.shared.signOut() } }
            }
        } label: {
            Image(systemName: sync == .offline ? "icloud.slash" : "person.crop.circle")
        }
        .accessibilityLabel("Account")
    }

    private var syncText: String {
        switch sync {
        case .idle, .syncing: "Syncing…"
        case .synced: "Backed up"
        case .offline: "Not backed up yet. Your songs are safe on this phone."
        }
    }
}

/// A new song's name, tempo and tracks; or an existing song's name and tempo.
struct SongDetailsView: View {
    let song: Song?
    var onCreate: (UUID) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var tempo = ""
    @State private var files: [URL] = []
    @State private var picking = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .focused($nameFocused)
                    HStack {
                        TextField("Tempo", text: $tempo)
                            .keyboardType(.decimalPad)
                        Text("BPM").foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("The recording's tempo at normal speed. The count-in uses it.")
                }
                if song == nil {
                    Section {
                        ForEach(files, id: \.self) { url in
                            Label(url.deletingPathExtension().lastPathComponent, systemImage: "waveform")
                        }
                        Button(files.isEmpty ? "Choose Audio Files…" : "Choose Different Files…") { picking = true }
                    } header: {
                        Text("Tracks")
                    } footer: {
                        Text("Pick every instrument's file at once. Each becomes a track named after its file.")
                    }
                }
            }
            .navigationTitle(song == nil ? "New Song" : "Song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(song == nil ? "Create" : "Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || bpm == nil)
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.audio], allowsMultipleSelection: true) { result in
                if case let .success(urls) = result { files = urls }
            }
            .onAppear {
                if let song {
                    name = song.name
                    tempo = String(format: "%g", song.tempo)
                } else {
                    nameFocused = true
                }
            }
        }
    }

    private var bpm: Double? {
        Double(tempo.replacingOccurrences(of: ",", with: ".")).flatMap { $0 > 0 && $0 < 400 ? $0 : nil }
    }

    private func save() {
        let library = Library.shared
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let bpm else { return }
        if let song {
            library.update(song.id) {
                $0.name = trimmed
                $0.tempo = bpm
            }
            dismiss()
        } else {
            let new = Song(name: trimmed, tempo: bpm, tracks: library.importTracks(files))
            library.add(new)
            dismiss()
            onCreate(new.id)
        }
    }
}
