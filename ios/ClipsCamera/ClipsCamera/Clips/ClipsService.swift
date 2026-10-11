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

    func recentGames(for kid: Kid) async throws -> [GameChoice] {
        struct Row: Decodable { let id: UUID; let name: String; let played_on: String }
        let rows: [Row] = try await client.from("clip_games")
            .select("id, name, played_on")
            .eq("kid_id", value: kid.id)
            .order("played_on", ascending: false)
            .order("created_at", ascending: false)
            .limit(12)
            .execute()
            .value
        return rows.map { GameChoice(id: $0.id, kid: kid, name: $0.name, playedOn: $0.played_on) }
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
