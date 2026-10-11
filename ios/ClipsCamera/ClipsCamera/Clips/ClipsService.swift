import Foundation
import Observation
import Supabase

// Talks to Baseball Clips: Google sign-in, the kid and game lists, and the
// final step of an upload — the game, the at-bat and its pitches, written once
// the video is safely in storage so the feed never shows a half-sent at-bat.

struct Kid: Codable, Identifiable, Hashable {
    let id: UUID
    let displayName: String
    var firstName: String { displayName.split(separator: " ").first.map(String.init) ?? displayName }
}

/// The game at-bats are filed under. A new one gets its id on the phone and is
/// created in Clips with the first upload, so picking it works offline.
struct GameChoice: Codable, Equatable, Identifiable {
    var id: UUID
    var kid: Kid
    var name: String
    /// yyyy-MM-dd
    var playedOn: String
    /// At-bats it already had in Clips when picked, so new ones number on from there.
    var priorAtBats: Int?

    /// yyyy-MM-dd for a calendar day.
    static func day(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

/// Storage paths, the same layout the website uses.
struct AtBatPaths {
    let video: String
    let poster: String
    init(gameID: UUID, atBatID: UUID) {
        let dir = "\(gameID.uuidString.lowercased())/\(atBatID.uuidString.lowercased())"
        video = "\(dir)/playback.mp4"
        poster = "\(dir)/poster.jpg"
    }
}

@MainActor
@Observable
final class ClipsService {
    static let shared = ClipsService()

    let client = SupabaseClient(
        supabaseURL: Config.supabaseURL,
        supabaseKey: Config.supabaseKey,
        options: SupabaseClientOptions(auth: .init(redirectToURL: Config.authRedirect, flowType: .pkce))
    )

    private(set) var email: String?
    private(set) var userID: UUID?
    /// False until the stored session has been checked at launch.
    private(set) var checkedSession = false

    var isSignedIn: Bool { userID != nil }

    private init() {
        Task { await watchAuth() }
    }

    private func watchAuth() async {
        for await (_, session) in client.auth.authStateChanges {
            email = session?.user.email
            userID = session?.user.id
            checkedSession = true
        }
    }

    func signIn() async throws {
        try await client.auth.signInWithOAuth(provider: .google, redirectTo: Config.authRedirect)
    }

    func signOut() async {
        try? await client.auth.signOut()
    }

    // MARK: Lists

    func kids() async throws -> [Kid] {
        struct Row: Decodable { let id: UUID; let display_name: String }
        let rows: [Row] = try await client.from("baseball_people")
            .select("id, display_name")
            .eq("kind", value: "kid")
            .order("display_name")
            .execute()
            .value
        return rows.map { Kid(id: $0.id, displayName: $0.display_name) }
    }

    // MARK: History

    /// A kid's games in Clips, newest first, each with its at-bats in order.
    func history(for kid: Kid) async throws -> [HistoryGame] {
        let games: [HistoryGame] = try await client.from("clip_games")
            .select("id, name, played_on, clip_at_bats(id, source, status, result, poster_path, playback_path, duration_s, recorded_at, created_at, clip_pitches(outcome))")
            .eq("kid_id", value: kid.id)
            .order("played_on", ascending: false)
            .order("created_at", ascending: false)
            .limit(40)
            .execute()
            .value
        return games.filter { !$0.atBats.isEmpty }
    }

    /// Short-lived links for feed thumbnails, by storage path.
    func posterURLs(_ paths: [String]) async -> [String: URL] {
        guard !paths.isEmpty,
              let results: [SignedURLResult] = try? await client.storage.from(Config.bucket).createSignedURLs(paths: paths, expiresIn: 3600)
        else { return [:] }
        var out: [String: URL] = [:]
        for case .success(let path, let url) in results { out[path] = url }
        return out
    }

    /// The newest finished export of a website at-bat, if one was ever made.
    func latestExportPath(atBatID: UUID) async -> String? {
        struct Row: Decodable { let path: String? }
        let rows: [Row]? = try? await client.from("clip_exports")
            .select("path")
            .eq("at_bat_id", value: atBatID)
            .eq("status", value: "ready")
            .order("created_at", ascending: false)
            .limit(1)
            .execute()
            .value
        return rows?.first?.path ?? nil
    }

    /// Delete an at-bat from Clips, as the website's Delete does: its files
    /// (video, poster, playback copy) and the row, which takes its pitches with it.
    func deleteAtBat(_ id: UUID, gameID: UUID) async throws {
        let dir = "\(gameID.uuidString.lowercased())/\(id.uuidString.lowercased())"
        let bucket = client.storage.from(Config.bucket)
        let files = try await bucket.list(path: dir)
        if !files.isEmpty {
            _ = try await bucket.remove(paths: files.map { "\(dir)/\($0.name)" })
        }
        try await client.from("clip_at_bats").delete().eq("id", value: id).execute()
    }

    func videoURL(_ path: String) async throws -> URL {
        try await client.storage.from(Config.bucket).createSignedURL(path: path, expiresIn: 3600)
    }

    // MARK: Upload

    /// A fresh signed upload URL for the at-bat's video (good for two hours).
    func videoUploadURL(_ paths: AtBatPaths) async throws -> URL {
        _ = try await client.auth.session // refreshes an expired token first
        let signed = try await client.storage.from(Config.bucket)
            .createSignedUploadURL(path: paths.video, options: CreateSignedUploadURLOptions(upsert: true))
        return signed.signedURL
    }

    /// The video is up: file the poster, the game, the at-bat and its pitches.
    /// Safe to repeat — every write is an upsert keyed on the phone's ids.
    func finalize(job: AtBatJob, game: GameChoice, poster: Data?) async throws {
        let session = try await client.auth.session
        let paths = AtBatPaths(gameID: game.id, atBatID: job.id)
        if let poster {
            try await client.storage.from(Config.bucket)
                .upload(paths.poster, data: poster, options: FileOptions(contentType: "image/jpeg", upsert: true))
        }

        struct GameRow: Encodable {
            let id: UUID; let kid_id: UUID; let name: String; let played_on: String; let created_by: UUID
        }
        try await client.from("clip_games")
            .upsert(GameRow(id: game.id, kid_id: game.kid.id, name: game.name, played_on: game.playedOn, created_by: session.user.id),
                    onConflict: "id", ignoreDuplicates: true)
            .execute()

        struct AtBatRow: Encodable {
            let id: UUID; let game_id: UUID; let source = "camera"; let status = "ready"
            let original_path: String; let original_name: String; let original_bytes: Int64?
            let playback_path: String; let poster_path: String?
            let duration_s: Double?; let fps = 60.0; let width = 1920; let height = 1080; let codec = "h264"
            let recorded_at: Date; let marked_at: Date; let result: String?; let created_by: UUID
        }
        try await client.from("clip_at_bats")
            .upsert(AtBatRow(
                id: job.id, game_id: game.id,
                original_path: paths.video, original_name: "Clips Camera", original_bytes: job.editBytes,
                playback_path: paths.video, poster_path: poster == nil ? nil : paths.poster,
                duration_s: job.editDuration, recorded_at: job.recordedAt, marked_at: Date(),
                result: job.result?.rawValue, created_by: session.user.id
            ), onConflict: "id")
            .execute()

        struct PitchRow: Encodable {
            let id: UUID; let at_bat_id: UUID; let t: Double; let outcome: String?; let batted_ball: String?; let source = "camera"
        }
        let sorted = job.pitches.sorted { $0.t < $1.t }
        let times = job.pitchTimes ?? []
        let rows = sorted.enumerated().map { i, p in
            PitchRow(id: p.id, at_bat_id: job.id, t: i < times.count ? times[i] : 0,
                     outcome: p.outcome?.rawValue, batted_ball: p.battedBall?.rawValue)
        }
        if !rows.isEmpty {
            try await client.from("clip_pitches").upsert(rows, onConflict: "id").execute()
        }
    }
}

// MARK: - History rows

struct HistoryGame: Decodable, Identifiable {
    let id: UUID
    let name: String
    let playedOn: String
    /// In the order they happened.
    var atBats: [HistoryAtBat]

    /// Without one at-bat; nil when that was the game's last.
    func removing(_ atBatID: UUID) -> HistoryGame? {
        var copy = self
        copy.atBats.removeAll { $0.id == atBatID }
        return copy.atBats.isEmpty ? nil : copy
    }

    enum CodingKeys: String, CodingKey { case id, name, played_on, clip_at_bats }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        playedOn = try c.decode(String.self, forKey: .played_on)
        atBats = try c.decode([HistoryAtBat].self, forKey: .clip_at_bats).sorted { $0.when < $1.when }
    }
}

struct HistoryAtBat: Decodable, Identifiable {
    let id: UUID
    let source: String
    let status: String
    let result: AtBatResult?
    let posterPath: String?
    let playbackPath: String?
    let durationS: Double?
    let when: Date
    let pitches: Int
    let swings: Int

    /// Filmed with this app: the file is the finished video.
    var isCamera: Bool { source == "camera" }
    var webURL: URL { URL(string: "https://family.mason.io/clips/at-bat/\(id.uuidString.lowercased())")! }

    enum CodingKeys: String, CodingKey {
        case id, source, status, result, poster_path, playback_path, duration_s, recorded_at, created_at, clip_pitches
    }
    private struct PitchRow: Decodable { let outcome: PitchOutcome? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "upload"
        status = try c.decode(String.self, forKey: .status)
        result = (try? c.decodeIfPresent(String.self, forKey: .result)).flatMap { $0.flatMap(AtBatResult.init(rawValue:)) }
        posterPath = try c.decodeIfPresent(String.self, forKey: .poster_path)
        playbackPath = try c.decodeIfPresent(String.self, forKey: .playback_path)
        durationS = try c.decodeIfPresent(Double.self, forKey: .duration_s)
        let recorded = try c.decodeIfPresent(Date.self, forKey: .recorded_at)
        when = try recorded ?? c.decode(Date.self, forKey: .created_at)
        let rows = (try? c.decode([PitchRow].self, forKey: .clip_pitches)) ?? []
        pitches = rows.count
        swings = rows.filter { $0.outcome?.isSwing ?? false }.count
    }
}
