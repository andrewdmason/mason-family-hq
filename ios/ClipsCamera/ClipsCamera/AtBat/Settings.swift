import Foundation
import Observation

/// App settings, kept in UserDefaults. Timing changes apply to at-bats built
/// after the change.
@Observable
final class AppSettings {
    static let shared = AppSettings()
    private let defaults = UserDefaults.standard

    var timings: EditTimings {
        didSet { save(timings, key: "timings") }
    }

    /// Testing aid: also save the raw 240fps recording to Photos (big — about
    /// half a gigabyte a minute), to check tap timing against the full footage.
    var saveRawToPhotos: Bool {
        didSet { defaults.set(saveRawToPhotos, forKey: "saveRawToPhotos") }
    }

    /// Also keep a copy of each finished at-bat in Photos.
    var saveEditsToPhotos: Bool {
        didSet { defaults.set(saveEditsToPhotos, forKey: "saveEditsToPhotos") }
    }

    /// The game new at-bats are filed under — set once per game.
    var game: GameChoice? {
        didSet { save(game, key: "game") }
    }

    /// Kids from the last time the list loaded, so the picker works offline.
    var cachedKids: [Kid] {
        didSet { save(cachedKids, key: "cachedKids") }
    }

    /// Seconds the at-bat-ending countdown runs before recording stops.
    var autoStopSeconds: Int {
        didSet { defaults.set(autoStopSeconds, forKey: "autoStopSeconds") }
    }

    private init() {
        timings = (defaults.data(forKey: "timings")).flatMap { try? JSONDecoder().decode(EditTimings.self, from: $0) } ?? .standard
        saveRawToPhotos = defaults.bool(forKey: "saveRawToPhotos")
        saveEditsToPhotos = defaults.bool(forKey: "saveEditsToPhotos")
        game = defaults.data(forKey: "game").flatMap { try? JSONDecoder().decode(GameChoice.self, from: $0) }
        cachedKids = defaults.data(forKey: "cachedKids").flatMap { try? JSONDecoder().decode([Kid].self, from: $0) } ?? []
        autoStopSeconds = defaults.object(forKey: "autoStopSeconds") as? Int ?? 3
    }

    private func save<T: Encodable>(_ value: T, key: String) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }
}
