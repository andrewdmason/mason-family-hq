import AVFoundation
import CoreImage
import XCTest
@testable import ClipsCamera

/// A field view on a generated close-up and a generated "GameChanger" clip
/// (smaller and at 30fps, as GameChanger's are), so the dissolve, the fitting
/// and the audio mix all run without real footage.
final class FieldViewRendererTests: XCTestCase {
    private func temp(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(UUID().uuidString).mov")
    }

    func testAppendsTheTrimmedFieldViewAfterTheCloseUp() async throws {
        let raw = temp("raw"), gc = temp("gc")
        let closeup = temp("closeup").deletingPathExtension().appendingPathExtension("mp4")
        let out = temp("combined").deletingPathExtension().appendingPathExtension("mp4")
        defer { for u in [raw, gc, closeup, out] { try? FileManager.default.removeItem(at: u) } }
        try await EditRendererTests.makeClip(at: raw, seconds: 6, fps: 240, level: 40)
        try await EditRendererTests.makeClip(at: gc, seconds: 20, fps: 30, width: 1280, height: 720, level: 200)

        let edit = try await EditRenderer.render(
            raw: raw, rotation: 0, pitches: [Pitch(t: 3, outcome: .calledStrike)], result: nil,
            card: TitleCard(title: "AB 1", subtitle: ""), timings: .standard, to: closeup)
        let combined = try await FieldViewRenderer.append(closeup: closeup, fieldView: gc, start: 5, end: 13, to: out)

        // Close-up, then 8s of field view overlapping its last half second.
        XCTAssertEqual(combined.fieldViewAt, edit.duration - 0.5, accuracy: 0.05)
        XCTAssertEqual(combined.duration, edit.duration - 0.5 + 8, accuracy: 0.05)
        let asset = AVURLAsset(url: out)
        let duration = try await asset.load(.duration).seconds
        XCTAssertEqual(duration, combined.duration, accuracy: 0.1)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let size = try await XCTUnwrap(videoTracks.first).load(.naturalSize)
        XCTAssertEqual(size, CGSize(width: 1920, height: 1080))
        let audio = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(audio.count, 1)

        let gen = AVAssetImageGenerator(asset: asset)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        // The close-up before the dissolve, a blend in the middle of it, the field view after.
        let before = try await Self.grey(gen, at: combined.fieldViewAt - 0.3)
        let middle = try await Self.grey(gen, at: combined.fieldViewAt + 0.25)
        let after = try await Self.grey(gen, at: combined.fieldViewAt + 2)
        // (Grey levels shift a little through the encoder; what matters is
        // dark close-up → bright field view.)
        XCTAssertLessThan(before, 90)
        XCTAssertGreaterThan(after, 130)
        XCTAssertTrue(middle > before + 20 && middle < after - 20, "mid-dissolve should be a blend (\(before) → \(middle) → \(after))")
        Self.snapshot(gen, ["combined-closeup": combined.fieldViewAt - 0.3, "combined-dissolve": combined.fieldViewAt + 0.25, "combined-field": combined.fieldViewAt + 2])
    }

    func testFieldViewAloneOpensOnTheTitleCard() async throws {
        let gc = temp("gc")
        let out = temp("alone").deletingPathExtension().appendingPathExtension("mp4")
        defer { for u in [gc, out] { try? FileManager.default.removeItem(at: u) } }
        try await EditRendererTests.makeClip(at: gc, seconds: 10, fps: 30, width: 1280, height: 720, level: 200)

        let card = TitleCard.make(number: 3, result: .double, game: "vs Kabuki", playedOn: "2026-10-11")
        let rendered = try await FieldViewRenderer.alone(card: card, cardSeconds: 2, fieldView: gc, start: 2, end: 8, to: out)
        XCTAssertEqual(rendered.fieldViewAt, 2, accuracy: 0.001)
        XCTAssertEqual(rendered.duration, 8, accuracy: 0.05)
        let asset = AVURLAsset(url: out)
        let gen = AVAssetImageGenerator(asset: asset)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        let card0 = try await Self.grey(gen, at: 1)
        let field = try await Self.grey(gen, at: 4)
        XCTAssertLessThan(card0, 20) // the card is black around its text
        XCTAssertGreaterThan(field, 130)
        Self.snapshot(gen, ["alone-card": 1, "alone-field": 4])
    }

    func testOrientationFromTransform() {
        XCTAssertEqual(FieldViewRenderer.orientation(.identity), .up)
        XCTAssertEqual(FieldViewRenderer.orientation(CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 720, ty: 0)), .right)
        XCTAssertEqual(FieldViewRenderer.orientation(CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: 0, ty: 0)), .down)
    }

    /// The grey level just left of centre, high enough to miss captions and the card's text.
    static func grey(_ gen: AVAssetImageGenerator, at seconds: Double) async throws -> Double {
        let (image, _) = try await gen.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
        var pixel = [UInt8](repeating: 0, count: 4)
        CIContext().render(CIImage(cgImage: image), toBitmap: &pixel, rowBytes: 4,
                           bounds: CGRect(x: 300, y: 900, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        return Double(pixel[0])
    }

    static func snapshot(_ gen: AVAssetImageGenerator, _ frames: [String: Double]) {
        let dir = "/tmp/clipscamera-snapshots"
        guard FileManager.default.fileExists(atPath: dir) else { return }
        for (name, t) in frames {
            guard let image = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { continue }
            try? CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"),
                                                    format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        }
    }
}
