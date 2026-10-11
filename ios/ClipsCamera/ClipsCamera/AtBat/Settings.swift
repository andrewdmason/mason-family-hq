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

    /// Seconds the at-bat-ending countdown runs before recording stops.
    var autoStopSeconds: Int {
        didSet { defaults.set(autoStopSeconds, forKey: "autoStopSeconds") }
    }

    private init() {
        timings = (defaults.data(forKey: "timings")).flatMap { try? JSONDecoder().decode(EditTimings.self, from: $0) } ?? .standard
        saveRawToPhotos = defaults.bool(forKey: "saveRawToPhotos")
        autoStopSeconds = defaults.object(forKey: "autoStopSeconds") as? Int ?? 3
    }

    private func save<T: Encodable>(_ value: T, key: String) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }
}
