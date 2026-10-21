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
    /// The album or work it belongs to (a trio, for its movements); optional.
    var album: String?
    /// Its place in the album: the movement number.
    var albumNumber: Int?
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

    /// "I. Allegro": the movement number, in Roman numerals, before the name
    /// when it's part of an album.
    var displayName: String {
        guard album?.isEmpty == false, let n = albumNumber, n > 0 else { return name }
        return "\(roman(n)). \(name)"
    }

    /// The tempo you're hearing at the current speed.
    var currentBPM: Int { Int((tempo * speed).rounded()) }
}

struct Shelf: Identifiable {
    /// Nil for the songs that aren't in an album.
    let album: String?
    let songs: [Song]
    var id: String { album ?? "" }
    var artist: String? { songs.lazy.compactMap(\.artist).first { !$0.isEmpty } }
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
    /// A measure number ("143"), a rehearsal letter ("A"), or empty until
    /// it's filled in.
    var label: String

    /// "Measure 143", "A", or "Unlabeled".
    var title: String {
        if label.isEmpty { return "Unlabeled" }
        return label.allSatisfy(\.isNumber) ? "Measure \(label)" : label
    }

    init(id: UUID = UUID(), time: Double, label: String) {
        self.id = id
        self.time = time
        self.label = label
    }

    private enum CodingKeys: String, CodingKey { case id, time, label, measure }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        time = try c.decode(Double.self, forKey: .time)
        // Markers saved before labels were text carry a measure number.
        label = try c.decodeIfPresent(String.self, forKey: .label)
            ?? c.decodeIfPresent(Int.self, forKey: .measure).map(String.init) ?? ""
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(time, forKey: .time)
        try c.encode(label, forKey: .label)
    }
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

    var songs: [Song] { shelf.flatMap(\.songs) }

    /// The library as it's listed: each album (A–Z) with its songs in
    /// movement order, then the songs that aren't in one.
    var shelf: [Shelf] {
        let live = all.filter { !$0.deleted }
        let byAlbum = Dictionary(grouping: live) { $0.album?.isEmpty == false ? $0.album : nil }
        var out = byAlbum.compactMap { album, songs in
            album.map { Shelf(album: $0, songs: songs.sorted(by: Self.albumOrder)) }
        }
        .sorted { $0.album!.localizedStandardCompare($1.album!) == .orderedAscending }
        if let loose = byAlbum[nil] {
            out.append(Shelf(album: nil, songs: loose.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }))
        }
        return out
    }

    /// The songs listed with this one: its album, or the loose songs.
    func siblings(of song: Song) -> [Song] {
        shelf.first { $0.songs.contains { $0.id == song.id } }?.songs ?? [song]
    }

    /// Every album name in use, for picking one.
    var albums: [String] { shelf.compactMap(\.album) }

    static func albumOrder(_ a: Song, _ b: Song) -> Bool {
        switch (a.albumNumber, b.albumNumber) {
        case let (x?, y?) where x != y: x < y
        case (_?, nil): true
        case (nil, _?): false
        default: a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
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

func roman(_ n: Int) -> String {
    let table: [(Int, String)] = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
                                  (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    var n = n
    var out = ""
    for (value, numeral) in table {
        while n >= value {
            out += numeral
            n -= value
        }
    }
    return out
}
