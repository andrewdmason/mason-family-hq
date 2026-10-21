import SwiftUI
import UniformTypeIdentifiers

/// Each track on or off, its volume and its pan; and adding, renaming,
/// replacing and removing tracks.
struct MixerView: View {
    let songID: UUID

    @Environment(\.dismiss) private var dismiss
    @State private var library = Library.shared
    /// What the file picker is for. Kept after the picker closes: its result
    /// arrives after that.
    @State private var importing = ImportTarget.add
    @State private var picking = false
    @State private var renaming: Track?
    @State private var newName = ""

    private enum ImportTarget: Identifiable {
        case add
        case replace(UUID)
        var id: String {
            switch self {
            case .add: "add"
            case let .replace(id): id.uuidString
            }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if let song = library.song(songID) {
                    ForEach(song.tracks) { track in
                        TrackStrip(track: track, available: library.hasAudio(track)) { change in
                            library.update(songID) { song in
                                if let i = song.tracks.firstIndex(where: { $0.id == track.id }) { change(&song.tracks[i]) }
                            }
                        }
                        .contextMenu {
                            Button("Rename…", systemImage: "pencil") {
                                newName = track.name
                                renaming = track
                            }
                            Button("Replace Audio File…", systemImage: "arrow.triangle.2.circlepath") {
                                importing = .replace(track.id)
                                picking = true
                            }
                        }
                    }
                    .onDelete { offsets in
                        let gone = offsets.map { song.tracks[$0] }
                        gone.forEach(library.removeAudio)
                        library.update(songID) { $0.tracks.removeAll { t in gone.contains { $0.id == t.id } } }
                    }
                }
                Section {
                    Button("Add Tracks…", systemImage: "plus") {
                        importing = .add
                        picking = true
                    }
                } footer: {
                    Text("Touch and hold a track to rename it or replace its file. Swipe to remove it.")
                }
            }
            .navigationTitle("Mixer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .fileImporter(
                isPresented: $picking,
                allowedContentTypes: [.audio],
                allowsMultipleSelection: true
            ) { result in
                guard case let .success(urls) = result else { return }
                let target = importing
                let tracks: [Track]
                if case .replace = target { tracks = library.importTracks(Array(urls.prefix(1))) } else { tracks = library.importTracks(urls) }
                switch target {
                case .add:
                    library.update(songID) { $0.tracks += tracks }
                case let .replace(id):
                    guard let new = tracks.first else { return }
                    library.update(songID) { song in
                        guard let i = song.tracks.firstIndex(where: { $0.id == id }) else { return }
                        library.removeAudio(song.tracks[i])
                        song.tracks[i].file = new.file
                        song.tracks[i].uploaded = false
                    }
                }
            }
            .alert("Rename Track", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $newName)
                Button("Cancel", role: .cancel) {}
                Button("Save") {
                    guard let track = renaming, !newName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    library.update(songID) { song in
                        if let i = song.tracks.firstIndex(where: { $0.id == track.id }) {
                            song.tracks[i].name = newName.trimmingCharacters(in: .whitespaces)
                        }
                    }
                }
            }
        }
    }
}

private struct TrackStrip: View {
    let track: Track
    let available: Bool
    let change: ((inout Track) -> Void) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: Binding(get: { track.enabled }, set: { on in change { $0.enabled = on } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.name).font(.headline)
                    if !available {
                        Text("Not on this phone yet").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            HStack {
                Image(systemName: "speaker.fill").foregroundStyle(.secondary).frame(width: 24)
                Slider(value: Binding(get: { track.volume }, set: { v in change { $0.volume = v } }), in: 0...1)
                Text("\(Int((track.volume * 100).rounded()))%")
                    .font(.caption.monospacedDigit()).frame(width: 40, alignment: .trailing)
            }
            HStack {
                Text("L").font(.caption.bold()).foregroundStyle(.secondary).frame(width: 24)
                Slider(value: Binding(get: { track.pan }, set: { v in change { $0.pan = abs(v) < 0.05 ? 0 : v } }), in: -1...1)
                Text("R").font(.caption.bold()).foregroundStyle(.secondary).frame(width: 40, alignment: .trailing)
            }
            .onTapGesture(count: 2) { change { $0.pan = 0 } }
        }
        .opacity(track.enabled ? 1 : 0.5)
        .padding(.vertical, 4)
    }
}
