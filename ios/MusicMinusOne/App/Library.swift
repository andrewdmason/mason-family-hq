import Foundation
import Observation
import UniformTypeIdentifiers

/// One recording to play along with: its instruments as separate,
/// time-aligned tracks, and measure markers to jump to.
struct Song: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    /// Composer or performer; optional.
    var artist: String?
    /// The recording's tempo at 1.0x, entered by hand.
    var tempo: Double
    /// Playback speed, pitch kept: 0.5…1.5 in 5% steps.
    var speed: Double = 1
    /// Overall volume, 0…1.
    var volume: Double = 1
    var tracks: [Track] = []
    /// Always in time order.
    var markers: [Marker] = []
    var createdAt = Date.now
    var updatedAt = Date.now
    /// Changed here since the backend last had it.
    var dirty = true
    /// Deleted here; kept until the backend knows.
    var deleted = false

    /// The tempo you're hearing at the current speed.
    var currentBPM: Int { Int((tempo * speed).rounded()) }
}

struct Track: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    /// The audio's file name, the same on the phone and in storage
    /// (`<uuid>.<ext>`). A new file gets a new name.
    var file: String
    /// The file is in storage.
    var uploaded = false
    var enabled = true
    var volume: Double = 1
    /// -1 (left) … 1 (right).
    var pan: Double = 0
}

struct Marker: Codable, Identifiable, Equatable {
    var id = UUID()
    /// Seconds into the recording.
    var time: Double
    var measure: Int
}

enum Speed {
    static let step = 0.05
    static let range = 0.5...1.5

    /// One 5% step up or down, landing on the 5% grid.
    static func stepped(_ speed: Double, by steps: Int) -> Double {
        let next = ((speed / step).rounded() + Double(steps)) * step
        return min(range.upperBound, max(range.lowerBound, (next * 100).rounded() / 100))
    }
}

enum Volume {
    static func stepped(_ volume: Double, by steps: Int) -> Double {
        min(1, max(0, ((volume * 10).rounded() + Double(steps)) / 10))
    }
}

/// The songs on this phone, the source of truth: saved to disk as they
/// change, and sent to the backend whenever there's signal (see Sync.swift).
@MainActor
@Observable
final class Library {
    static let shared = Library()

    /// Every song, deleted ones included until the backend has caught up.
    var all: [Song] = []
    var sync = SyncState.idle
    /// Audio files being fetched from storage.
    var downloading: Set<String> = []

    let folder: URL
    let audioFolder: URL
    private var syncTask: Task<Void, Never>?

    var songs: [Song] {
        all.filter { !$0.deleted }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    init(folder: URL? = nil) {
        let base = folder ?? URL.applicationSupportDirectory.appending(path: "MusicMinusOne")
        self.folder = base
        audioFolder = base.appending(path: "audio")
        try? FileManager.default.createDirectory(at: audioFolder, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: libraryFile),
           let saved = try? JSONDecoder.library.decode([Song].self, from: data) {
            all = saved
        }
    }

    private var libraryFile: URL { folder.appending(path: "library.json") }

    func song(_ id: UUID) -> Song? { all.first { $0.id == id && !$0.deleted } }

    func audioURL(_ track: Track) -> URL { audioFolder.appending(path: track.file) }

    func hasAudio(_ track: Track) -> Bool {
        FileManager.default.fileExists(atPath: audioURL(track).path)
    }

    // MARK: Changes

    func add(_ song: Song) {
        all.append(song)
        changed()
    }

    /// Any change to a song: kept on disk now, sent to the backend shortly.
    func update(_ id: UUID, _ change: (inout Song) -> Void) {
        guard let i = all.firstIndex(where: { $0.id == id }) else { return }
        var song = all[i]
        change(&song)
        song.markers.sort { $0.time < $1.time }
        guard song != all[i] else { return }
        song.updatedAt = .now
        song.dirty = true
        all[i] = song
        changed()
    }

    func delete(_ id: UUID) {
        update(id) { $0.deleted = true }
    }

    /// Copies picked files into the library as new tracks (named after the
    /// files). Files that aren't readable audio are skipped.
    func importTracks(_ urls: [URL]) -> [Track] {
        urls.compactMap { url in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let ext = url.pathExtension.isEmpty ? "m4a" : url.pathExtension.lowercased()
            let track = Track(name: url.deletingPathExtension().lastPathComponent, file: "\(UUID().uuidString.lowercased()).\(ext)")
            do {
                try FileManager.default.copyItem(at: url, to: audioURL(track))
                return track
            } catch {
                print("import failed: \(url.lastPathComponent): \(error)")
                return nil
            }
        }
    }

    func removeAudio(_ track: Track) {
        try? FileManager.default.removeItem(at: audioURL(track))
        try? FileManager.default.removeItem(at: audioURL(track).appendingPathExtension("peaks"))
        Waveforms.shared.forget(track.file)
    }

    func save() {
        if let data = try? JSONEncoder.library.encode(all) {
            try? data.write(to: libraryFile, options: .atomic)
        }
    }

    /// Saves, and sends to the backend after a short pause so a run of
    /// changes (slider drags) goes as one.
    private func changed() {
        save()
        syncTask?.cancel()
        syncTask = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            await syncNow()
        }
    }

    /// Replaces the whole library: songs that came from the backend.
    func replaceAll(_ songs: [Song]) {
        all = songs
        save()
    }
}

extension JSONEncoder {
    static let library: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601WithFraction
        return e
    }()
}

extension JSONDecoder {
    static let library: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601WithFraction
        return d
    }()
}

extension ISO8601DateFormatter {
    nonisolated(unsafe) static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

extension JSONEncoder.DateEncodingStrategy {
    static let iso8601WithFraction = custom { date, encoder in
        var c = encoder.singleValueContainer()
        try c.encode(ISO8601DateFormatter.withFraction.string(from: date))
    }
}

extension JSONDecoder.DateDecodingStrategy {
    static let iso8601WithFraction = custom { decoder in
        let s = try decoder.singleValueContainer().decode(String.self)
        if let d = ISO8601DateFormatter.withFraction.date(from: s) ?? ISO8601DateFormatter().date(from: s) { return d }
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(s)"))
    }
}

/// "02:45.669", the way Anytune shows a position.
func formatTime(_ seconds: Double) -> String {
    let s = max(0, seconds)
    let minutes = Int(s) / 60
    let rest = s - Double(minutes * 60)
    return String(format: "%02d:%06.3f", minutes, rest)
}
