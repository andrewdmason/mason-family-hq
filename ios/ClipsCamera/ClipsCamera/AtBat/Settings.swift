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

    /// The game the camera files at-bats under — set when Film is tapped.
    var game: GameChoice? {
        didSet { save(game, key: "game") }
    }

    /// Each kid's current game (the one on their home tab's card), by kid id.
    var currentGames: [String: GameChoice] {
        didSet { save(currentGames, key: "currentGames") }
    }

    func currentGame(for kid: UUID) -> GameChoice? { currentGames[kid.uuidString] }
    func setCurrentGame(_ game: GameChoice) { currentGames[game.kid.id.uuidString] = game }

    /// Kids from the last time the list loaded, so the picker works offline.
    var cachedKids: [Kid] {
        didSet { save(cachedKids, key: "cachedKids") }
    }

    /// The camera's control rail (Record/Pitch and the labels) sits on the
    /// right instead of the left.
    var railOnRight: Bool {
        didSet { defaults.set(railOnRight, forKey: "railOnRight") }
    }

    /// Seconds the at-bat-ending countdown runs before recording stops.
    var autoStopSeconds: Int {
        didSet { defaults.set(autoStopSeconds, forKey: "autoStopSeconds") }
    }

    /// The share sheet's choices from the last share.
    var shareOptions: ShareOptions {
        didSet { save(shareOptions, key: "shareOptions") }
    }

    private init() {
        timings = (defaults.data(forKey: "timings")).flatMap { try? JSONDecoder().decode(EditTimings.self, from: $0) } ?? .standard
        saveRawToPhotos = defaults.bool(forKey: "saveRawToPhotos")
        saveEditsToPhotos = defaults.bool(forKey: "saveEditsToPhotos")
        let game = defaults.data(forKey: "game").flatMap { try? JSONDecoder().decode(GameChoice.self, from: $0) }
        self.game = game
        var current = defaults.data(forKey: "currentGames").flatMap { try? JSONDecoder().decode([String: GameChoice].self, from: $0) } ?? [:]
        // Before per-kid games existed, the one picked game becomes its kid's current game.
        if current.isEmpty, let game { current[game.kid.id.uuidString] = game }
        currentGames = current
        cachedKids = defaults.data(forKey: "cachedKids").flatMap { try? JSONDecoder().decode([Kid].self, from: $0) } ?? []
        autoStopSeconds = defaults.object(forKey: "autoStopSeconds") as? Int ?? 3
        railOnRight = defaults.bool(forKey: "railOnRight")
        shareOptions = defaults.data(forKey: "shareOptions").flatMap { try? JSONDecoder().decode(ShareOptions.self, from: $0) } ?? .standard
    }

    private func save<T: Encodable>(_ value: T, key: String) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }
}
