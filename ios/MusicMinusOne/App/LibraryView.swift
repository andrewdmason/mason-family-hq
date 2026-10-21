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
                ForEach(library.shelf) { shelf in
                    Section {
                        ForEach(shelf.songs) { song in
                            Button { open = song.id } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(song.name).font(.headline)
                                    Text(summary(song, in: shelf)).font(.subheadline).foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 4)
                            }
                            .tint(.primary)
                            .swipeActions {
                                Button("Delete", role: .destructive) { confirmDelete = song }
                            }
                        }
                    } header: {
                        if let album = shelf.album {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(album).font(.title3.bold()).foregroundStyle(.primary)
                                if let artist = shelf.artist { Text(artist).font(.subheadline) }
                            }
                            .textCase(nil)
                        } else if library.shelf.count > 1 {
                            Text("Songs")
                        }
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

    private func summary(_ song: Song, in shelf: Shelf) -> String {
        var parts = [String]()
        // In an album, the artist is in its heading unless this one differs.
        if let artist = song.artist, !artist.isEmpty, shelf.album == nil || artist != shelf.artist { parts.append(artist) }
        parts.append("\(Int(song.tempo.rounded())) BPM")
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
    @State private var artist = ""
    @State private var album = ""
    @State private var number = ""
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
                    TextField("Artist", text: $artist)
                }
                Section {
                    HStack {
                        TextField("Album or work", text: $album)
                        let others = Library.shared.albums.filter { $0 != album }
                        if !others.isEmpty {
                            Menu {
                                ForEach(others, id: \.self) { name in Button(name) { pick(name) } }
                            } label: {
                                Image(systemName: "chevron.up.chevron.down")
                            }
                            .accessibilityLabel("Choose an album")
                        }
                    }
                    if !album.trimmingCharacters(in: .whitespaces).isEmpty {
                        HStack {
                            Text("Movement")
                            TextField("Number", text: $number)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                } footer: {
                    Text("Optional. Songs in the same album are listed together, in movement order.")
                }
                Section {
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
                    artist = song.artist ?? ""
                    album = song.album ?? ""
                    number = song.albumNumber.map(String.init) ?? ""
                    tempo = String(format: "%g", song.tempo)
                } else {
                    nameFocused = true
                }
            }
        }
    }

    /// An existing album: its artist, and the next movement number.
    private func pick(_ name: String) {
        album = name
        let songs = Library.shared.shelf.first { $0.album == name }
        if artist.isEmpty, let a = songs?.artist { artist = a }
        if number.isEmpty || song == nil {
            number = String((songs?.songs.compactMap(\.albumNumber).max() ?? 0) + 1)
        }
    }

    private var bpm: Double? {
        Double(tempo.replacingOccurrences(of: ",", with: ".")).flatMap { $0 > 0 && $0 < 400 ? $0 : nil }
    }

    private func save() {
        let library = Library.shared
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let by = artist.trimmingCharacters(in: .whitespaces)
        let work = album.trimmingCharacters(in: .whitespaces)
        let place = work.isEmpty ? nil : Int(number)
        guard let bpm else { return }
        if let song {
            library.update(song.id) {
                $0.name = trimmed
                $0.artist = by.isEmpty ? nil : by
                $0.album = work.isEmpty ? nil : work
                $0.albumNumber = place
                $0.tempo = bpm
            }
            dismiss()
        } else {
            let new = Song(
                name: trimmed, artist: by.isEmpty ? nil : by,
                album: work.isEmpty ? nil : work, albumNumber: place, tempo: bpm, tracks: library.importTracks(files))
            library.add(new)
            dismiss()
            onCreate(new.id)
        }
    }
}
