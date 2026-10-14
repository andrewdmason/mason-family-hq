import AVFoundation
import XCTest
@testable import ClipsCamera

/// Step 2 of the one-time migration of website-uploaded at-bats
/// (scripts/clips-migrate-uploads.mts): render each one with the phone's own
/// renderer so it comes out exactly like a filmed-on-the-phone at-bat. Reads
/// the manifest the script's `fetch` step wrote and writes results.json beside
/// it. Skipped unless the manifest exists:
///
///   xcodebuild test -project ClipsCamera.xcodeproj -scheme ClipsCamera \
///     -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
///     -only-testing:ClipsCameraTests/MigrationRenderTests
///
/// The work folder defaults to /tmp/clips-migrate (TEST_RUNNER_CLIPS_MIGRATE_DIR overrides).
final class MigrationRenderTests: XCTestCase {
    struct Item: Decodable {
        struct P: Decodable { let id: String; let t: Double; let outcome: String?; let battedBall: String? }
        struct Box: Decodable { let x: Double; let y: Double; let s: Double }
        let id: String
        let original: String
        let number: Int
        let game: String
        let playedOn: String
        let result: String?
        let pitches: [P]
        let crop: Box?
        let out: String
    }

    struct Result: Encodable {
        let id: String
        let out: String
        let duration: Double
        let bytes: Int64
        let pitchTimes: [String: Double]
    }

    func testRenderUploadedAtBats() async throws {
        let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["CLIPS_MIGRATE_DIR"] ?? "/tmp/clips-migrate")
        let manifest = dir.appendingPathComponent("manifest.json")
        guard FileManager.default.fileExists(atPath: manifest.path) else {
            throw XCTSkip("No migration manifest at \(manifest.path)")
        }
        let items = try JSONDecoder().decode([Item].self, from: Data(contentsOf: manifest))
        var results: [Result] = []
        for item in items {
            let raw = URL(fileURLWithPath: item.original)
            let rotation = try await Self.rotation(of: raw)
            let pitches = item.pitches.map {
                Pitch(t: $0.t, outcome: $0.outcome.flatMap(PitchOutcome.init(rawValue:)),
                      battedBall: $0.battedBall.flatMap(BattedBall.init(rawValue:)))
            }
            // Every label the website stored must survive the trip.
            XCTAssertEqual(pitches.compactMap(\.outcome).count, item.pitches.compactMap(\.outcome).count, item.id)
            let result = item.result.flatMap(AtBatResult.init(rawValue:))
            let card = TitleCard.make(kid: "Sebastian Mason", result: result, game: item.game, playedOn: item.playedOn)
            let crop = item.crop.map { CGRect(x: $0.x, y: $0.y, width: $0.s, height: $0.s) }
            print("rendering \(item.game) AB \(item.number) (rotation \(rotation), crop \(crop.map { "\($0)" } ?? "none"))")
            let edit: RenderedEdit
            do {
                edit = try await EditRenderer.render(
                    raw: raw, rotation: rotation, pitches: pitches, result: result, card: card,
                    timings: .standard, replayCrop: crop, to: URL(fileURLWithPath: item.out)
                )
            } catch {
                XCTFail("\(item.game) AB \(item.number): \(error)")
                continue
            }
            // pitchTimes follow the pitches sorted by time — the manifest's order.
            let times = Dictionary(uniqueKeysWithValues: zip(item.pitches.map(\.id), edit.pitchTimes))
            results.append(Result(id: item.id, out: item.out, duration: edit.duration, bytes: edit.bytes, pitchTimes: times))
            print("rendered \(item.game) AB \(item.number): \(String(format: "%.1f", edit.duration))s in \(String(format: "%.0f", edit.renderSeconds))s")
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(results).write(to: dir.appendingPathComponent("results.json"))
    }

    /// The phone renderer draws frames as stored, so an upside-down original
    /// (filmed with the phone turned the other way) needs the 180° flip; a
    /// portrait one can't be handled.
    private static func rotation(of url: URL) async throws -> Int {
        let tracks = try await AVURLAsset(url: url).loadTracks(withMediaType: .video)
        let track = try XCTUnwrap(tracks.first)
        let t = try await track.load(.preferredTransform)
        let degrees = Int((atan2(t.b, t.a) * 180 / .pi).rounded())
        switch (degrees + 360) % 360 {
        case 0: return 0
        case 180: return 180
        default: throw RenderError.failed("\(url.lastPathComponent) is rotated \(degrees)°")
        }
    }
}
