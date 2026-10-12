import AVFoundation
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

/// Storage paths, the same layout the website uses. A rebuilt video (and its
/// poster) gets a new name, so no cache serves the old one.
struct AtBatPaths {
    let dir: String
    let video: String
    let poster: String
    /// The finished video without its field view, kept for re-trimming.
    let closeup: String
    /// The pitch reel the app plays live (at-bats filmed from the reel on).
    let reel: String
    init(gameID: UUID, atBatID: UUID, revision: Int? = nil) {
        dir = "\(gameID.uuidString.lowercased())/\(atBatID.uuidString.lowercased())"
        let suffix = revision.map { $0 > 0 ? "-r\($0)" : "" } ?? ""
        video = "\(dir)/playback\(suffix).mp4"
        poster = "\(dir)/poster\(suffix).jpg"
        closeup = "\(dir)/closeup\(suffix).mp4"
        reel = "\(dir)/reel\(suffix).mp4"
    }

    /// A GameChanger clip as shared, in the at-bat's folder (so deleting the
    /// at-bat takes it too). Each import gets its own name.
    func fieldView(fileExtension: String) -> String {
        "\(dir)/gamechanger-\(UUID().uuidString.prefix(8).lowercased()).\(fileExtension.isEmpty ? "mp4" : fileExtension.lowercased())"
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
        let base = "id, source, status, result, poster_path, playback_path, duration_s, recorded_at, created_at"
        let fieldView = "closeup_path, field_view_path, field_view_start_s, field_view_end_s, field_view_at_s"
        func fetch(_ columns: String) async throws -> [HistoryGame] {
            try await client.from("clip_games")
                .select("id, name, played_on, clip_at_bats(\(columns), clip_pitches(id, t, outcome, batted_ball))")
                .eq("kid_id", value: kid.id)
                .order("played_on", ascending: false)
                .order("created_at", ascending: false)
                .limit(40)
                .execute()
                .value
        }
        let games: [HistoryGame]
        do {
            games = try await fetch("\(base), \(fieldView), reel")
        } catch is PostgrestError {
            // Clips without the reel column yet (migration 00202), or the
            // field-view columns (00201).
            do {
                games = try await fetch("\(base), \(fieldView)")
            } catch is PostgrestError {
                games = try await fetch(base)
            }
        }
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

    // MARK: Relabeling

    /// An at-bat's pitches as Clips has them, in order. The deciding ball in
    /// play gets its result back from the at-bat's.
    func pitches(atBatID: UUID, result: AtBatResult?) async throws -> [Pitch] {
        struct Row: Decodable { let id: UUID; let t: Double; let outcome: PitchOutcome?; let batted_ball: BattedBall? }
        let rows: [Row] = try await client.from("clip_pitches")
            .select("id, t, outcome, batted_ball")
            .eq("at_bat_id", value: atBatID)
            .order("t")
            .execute()
            .value
        var pitches = rows.map { Pitch(id: $0.id, t: $0.t, outcome: $0.outcome, battedBall: $0.batted_ball) }
        if let i = pitches.lastIndex(where: { $0.outcome == .inPlay }) {
            pitches[i].playResult = result?.playResult
        }
        return pitches
    }

    /// New labels for an at-bat's pitches and its result. The video is untouched.
    func relabel(atBatID: UUID, pitches: [Pitch]) async throws {
        struct PitchLabels: Encodable { @Nullable var outcome: String?; @Nullable var batted_ball: String? }
        for p in pitches {
            try await client.from("clip_pitches")
                .update(PitchLabels(outcome: p.outcome?.rawValue, batted_ball: p.outcome == .inPlay ? p.battedBall?.rawValue : nil))
                .eq("id", value: p.id)
                .execute()
        }
        struct ResultRow: Encodable { @Nullable var result: String? }
        let result = Scorebook.outcome(pitches.sorted { $0.t < $1.t })?.result
        try await client.from("clip_at_bats")
            .update(ResultRow(result: result?.rawValue))
            .eq("id", value: atBatID)
            .execute()
    }

    func videoURL(_ path: String) async throws -> URL {
        try await client.storage.from(Config.bucket).createSignedURL(path: path, expiresIn: 3600)
    }

    // MARK: Upload

    /// A fresh signed upload URL for one of the at-bat's files (good for two hours).
    func uploadURL(path: String) async throws -> URL {
        _ = try await client.auth.session // refreshes an expired token first
        let signed = try await client.storage.from(Config.bucket)
            .createSignedUploadURL(path: path, options: CreateSignedUploadURLOptions(upsert: true))
        return signed.signedURL
    }

    /// Fetch a file from Clips into `destination`.
    func download(_ path: String, to destination: URL) async throws {
        let (file, response) = try await URLSession.shared.download(from: try await videoURL(path))
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw StoreError("Couldn't download the video from Clips (\(http.statusCode)).")
        }
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: file, to: destination)
    }

    /// The video is up: file the poster, the game, the at-bat and its pitches.
    /// Safe to repeat — every write is an upsert keyed on the phone's ids.
    func finalize(job: AtBatJob, game: GameChoice, poster: Data?) async throws {
        let session = try await client.auth.session
        let paths = AtBatPaths(gameID: game.id, atBatID: job.id, revision: job.revision)
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
            let duration_s: Double?; let fps: Double; let width = 1920; let height = 1080; let codec: String
            let recorded_at: Date; let marked_at: Date; @Nullable var result: String?; let created_by: UUID
            // Left out when there's no field view (a removal clears them
            // itself), so at-bats file fine before migration 00201 is live.
            var field_view_path: String?; var field_view_start_s: Double?
            var field_view_end_s: Double?; var field_view_at_s: Double?; var closeup_path: String?
            // Only for a reel (needs migration 00202).
            var reel: ReelColumn?
        }
        let fv = FieldViewColumns(job)
        let video = job.isReel ? paths.reel : paths.video
        try await client.from("clip_at_bats")
            .upsert(AtBatRow(
                id: job.id, game_id: game.id,
                original_path: video, original_name: job.kind == .fieldOnly ? "GameChanger" : "Clips Camera",
                original_bytes: job.editBytes,
                playback_path: video, poster_path: poster == nil ? nil : paths.poster,
                duration_s: job.editDuration, fps: job.isReel ? Double(ReelPlan.fullRate) : 60,
                codec: job.isReel ? "hevc" : "h264",
                recorded_at: job.recordedAt, marked_at: Date(),
                result: job.result?.rawValue, created_by: session.user.id,
                field_view_path: fv.path, field_view_start_s: fv.start, field_view_end_s: fv.end,
                field_view_at_s: fv.at, closeup_path: fv.closeup,
                reel: job.isReel ? job.reelSegments.map { ReelColumn(segments: $0) } : nil
            ), onConflict: "id")
            .execute()

        struct PitchRow: Encodable {
            let id: UUID; let at_bat_id: UUID; let t: Double; @Nullable var outcome: String?; @Nullable var batted_ball: String?; let source = "camera"
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

// MARK: - Field view

/// The field-view columns as a job has them; all nil when it has none.
struct FieldViewColumns {
    var path: String?
    var start: Double?
    var end: Double?
    var at: Double?
    var closeup: String?

    init(_ job: AtBatJob) {
        let fv = job.fieldView
        path = fv?.path
        start = fv?.start
        end = fv?.end
        // A reel's field view is a file of its own, not part of the video.
        at = fv == nil || job.isReel ? nil : job.fieldViewAt
        closeup = fv == nil || job.kind == .fieldOnly || job.isReel ? nil : job.closeupPath
    }
}

extension ClipsService {
    /// A field view was added to (or re-trimmed on) an at-bat already in
    /// Clips: point it at the new video. Labels, result and poster stay.
    func attachFieldView(job: AtBatJob, game: GameChoice) async throws {
        if job.isReel {
            // The reel stays as it is; only the field view's columns change.
            guard let fv = job.fieldView else { return }
            struct ReelRow: Encodable { let field_view_path: String; let field_view_start_s: Double; let field_view_end_s: Double }
            try await client.from("clip_at_bats")
                .update(ReelRow(field_view_path: fv.path, field_view_start_s: fv.start, field_view_end_s: fv.end))
                .eq("id", value: job.id)
                .execute()
            return
        }
        struct Row: Encodable {
            let original_path: String; let playback_path: String; let original_bytes: Int64?; let duration_s: Double?
            // Left out when there's no field view (a removal clears them
            // itself), so at-bats file fine before migration 00201 is live.
            var field_view_path: String?; var field_view_start_s: Double?
            var field_view_end_s: Double?; var field_view_at_s: Double?; var closeup_path: String?
        }
        let fv = FieldViewColumns(job)
        let paths = AtBatPaths(gameID: game.id, atBatID: job.id, revision: job.revision)
        try await client.from("clip_at_bats")
            .update(Row(original_path: paths.video, playback_path: paths.video, original_bytes: job.editBytes,
                        duration_s: job.editDuration, field_view_path: fv.path, field_view_start_s: fv.start,
                        field_view_end_s: fv.end, field_view_at_s: fv.at, closeup_path: fv.closeup))
            .eq("id", value: job.id)
            .execute()
    }

    /// Take the field view off: the at-bat goes back to its close-up, and the
    /// GameChanger clip and the combined video leave storage.
    func removeFieldView(_ ab: HistoryAtBat) async throws {
        if ab.isReel {
            struct ReelRow: Encodable {
                @Nullable var field_view_path: String?; @Nullable var field_view_start_s: Double?; @Nullable var field_view_end_s: Double?
            }
            try await client.from("clip_at_bats")
                .update(ReelRow(field_view_path: nil, field_view_start_s: nil, field_view_end_s: nil))
                .eq("id", value: ab.id)
                .execute()
            if let path = ab.fieldViewPath { _ = try? await client.storage.from(Config.bucket).remove(paths: [path]) }
            return
        }
        guard let closeup = ab.closeupPath else { return }
        var duration: Double?
        if let url = try? await videoURL(closeup) {
            duration = try? await AVURLAsset(url: url).load(.duration).seconds
        }
        struct Row: Encodable {
            let original_path: String; let playback_path: String; let duration_s: Double?
            @Nullable var closeup_path: String?; @Nullable var field_view_path: String?
            @Nullable var field_view_start_s: Double?; @Nullable var field_view_end_s: Double?; @Nullable var field_view_at_s: Double?
        }
        try await client.from("clip_at_bats")
            .update(Row(original_path: closeup, playback_path: closeup, duration_s: duration ?? ab.durationS))
            .eq("id", value: ab.id)
            .execute()
        let stale = [ab.fieldViewPath, ab.playbackPath].compactMap { $0 }.filter { $0 != closeup }
        if !stale.isEmpty { _ = try? await client.storage.from(Config.bucket).remove(paths: stale) }
    }

    /// An at-bat's field view as Clips has it, so a rebuild on this phone
    /// keeps one that was added on another.
    func fieldView(of atBatID: UUID) async throws -> FieldView? {
        struct Row: Decodable { let field_view_path: String?; let field_view_start_s: Double?; let field_view_end_s: Double? }
        let rows: [Row] = try await client.from("clip_at_bats")
            .select("field_view_path, field_view_start_s, field_view_end_s")
            .eq("id", value: atBatID)
            .execute()
            .value
        guard let r = rows.first, let path = r.field_view_path, let start = r.field_view_start_s, let end = r.field_view_end_s else { return nil }
        return FieldView(file: nil, path: path, uploaded: true, start: start, end: end)
    }
}

/// Writes a missing value as null, so an upsert or update clears the column
/// (a plain optional is left out, which keeps the old value).
@propertyWrapper
struct Nullable<Value: Encodable>: Encodable {
    var wrappedValue: Value?
    init(wrappedValue: Value?) { self.wrappedValue = wrappedValue }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        if let wrappedValue { try c.encode(wrappedValue) } else { try c.encodeNil() }
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
    /// The GameChanger clip, untrimmed, and the stretch of it that's kept.
    let fieldViewPath: String?
    let fieldViewStart: Double?
    let fieldViewEnd: Double?
    /// The video without its field view (nil for a field view alone).
    let closeupPath: String?
    /// A pitch reel's windows; nil for a finished edit.
    let reel: [ReelSegment]?
    /// Sorted, at their times in the video, the deciding ball in play with
    /// the at-bat's result.
    let pitchList: [Pitch]

    /// Filmed with this app: the file is the finished video, or a pitch reel.
    var isCamera: Bool { source == "camera" }
    /// Played live: the reel, then the field view from its own file.
    var isReel: Bool { reel != nil }
    var hasFieldView: Bool { fieldViewPath != nil }
    /// Made from a GameChanger clip alone, with no close-up.
    var isFieldOnly: Bool { hasFieldView && closeupPath == nil && !isReel }
    var webURL: URL { URL(string: "https://family.mason.io/clips/at-bat/\(id.uuidString.lowercased())")! }

    enum CodingKeys: String, CodingKey {
        case id, source, status, result, poster_path, playback_path, duration_s, recorded_at, created_at, clip_pitches
        case closeup_path, field_view_path, field_view_start_s, field_view_end_s, reel
    }
    private struct PitchRow: Decodable { let id: UUID?; let t: Double?; let outcome: PitchOutcome?; let batted_ball: BattedBall? }

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
        var list = rows.map { Pitch(id: $0.id ?? UUID(), t: $0.t ?? 0, outcome: $0.outcome, battedBall: $0.batted_ball) }
            .sorted { $0.t < $1.t }
        if let i = list.lastIndex(where: { $0.outcome == .inPlay }) { list[i].playResult = result?.playResult }
        pitchList = list
        reel = (try? c.decodeIfPresent(ReelColumn.self, forKey: .reel))?.segments
        fieldViewPath = try c.decodeIfPresent(String.self, forKey: .field_view_path)
        fieldViewStart = try c.decodeIfPresent(Double.self, forKey: .field_view_start_s)
        fieldViewEnd = try c.decodeIfPresent(Double.self, forKey: .field_view_end_s)
        closeupPath = try c.decodeIfPresent(String.self, forKey: .closeup_path)
    }
}

/// `clip_at_bats.reel`: the pitch reel's windows.
struct ReelColumn: Codable {
    var segments: [ReelSegment]
    init(segments: [ReelSegment]) { self.segments = segments }
}
