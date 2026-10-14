import AVFoundation
import CoreImage
import XCTest
@testable import ClipsCamera

/// The ball trail in the other kinds of share: vertical (the trail laid out
/// exactly as its cropped or fitted picture is) and highlight reels (each
/// at-bat's field view with its own trail, in its stretch of the reel).
/// The footage tests need the Falcon clip (see BallTrailTests).
final class BallTrailShareTests: XCTestCase {
    private let falcon = URL(fileURLWithPath: "/tmp/ball-trail/falcon.mp4")

    private func temp(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(UUID().uuidString).mp4")
    }

    /// The trail is placed by the same rectangle the picture is laid into: a
    /// marked pixel of the source lands where the placement says it does.
    func testPictureAndTrailShareOnePlacement() {
        let size = CGSize(width: 1280, height: 720)
        // A source that's black but for a small bright square around (0.3, 0.6)
        // of the picture, from the top left.
        let mark = CGPoint(x: 0.3 * size.width, y: (1 - 0.6) * size.height)
        let src = CIImage(color: .white).cropped(to: CGRect(x: mark.x - 4, y: mark.y - 4, width: 8, height: 8))
            .composited(over: CIImage(color: .black).cropped(to: CGRect(origin: .zero, size: size)))
        let frame = CGRect(x: 0, y: 0, width: 1080, height: 1920)
        for fill in [LayerFill.crop(center: 0.35), .crop(center: 0.0), .fit, .fitOverBlur] {
            let rect = LayerCompositor.placement(of: size, into: frame, fill: fill)
            let at = TrailRenderer.pixel(SIMD2(0.3, 0.6), in: rect)
            var px = [UInt8](repeating: 0, count: 4)
            let laid = LayerCompositor.lay(src, into: frame, fill: fill)
            CIContext(options: [.workingColorSpace: NSNull()]).render(
                laid, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: at.x.rounded(.down), y: at.y.rounded(.down), width: 1, height: 1),
                format: .RGBA8, colorSpace: nil)
            XCTAssertGreaterThan(px[0], 200, "\(fill): the marked pixel is where the trail would put it (\(px))")
        }
        // Cropped, the picture is enlarged past the frame: the trail's sizes
        // (1280 px across the picture) scale with it, not with the frame.
        let crop = LayerCompositor.placement(of: size, into: frame, fill: .crop(center: 0.5))
        XCTAssertEqual(crop.height, 1920, accuracy: 1e-9)
        XCTAssertEqual(crop.width, 1920 * 16 / 9, accuracy: 1e-6)
        XCTAssertEqual(crop.midX, frame.midX, accuracy: 1e-6)
    }

    /// A vertical share, GameChanger cropped around the ball and whole over
    /// its blur: at the ball's mapped spot the frame carries the trail. Stills
    /// go to /tmp/ball-trail/vertical when that folder exists.
    func testVerticalShareKeepsTheTrailOnTheBall() async throws {
        guard FileManager.default.fileExists(atPath: falcon.path) else { throw XCTSkip("No clip at \(falcon.path)") }
        let trail = try BallTrailTests.fixture("falcon")
        let g = TrailGeometry(trail)
        let start = trail.contactS - 0.8, end = trail.landS + 1.2
        let mid = trail.points[trail.points.count / 2].t
        // Framed the way someone would: the strip centred on the flight.
        let center = (trail.points.map(\.x).min()! + trail.points.map(\.x).max()!) / 2
        let frame = CGRect(origin: .zero, size: VideoShape.vertical.size)
        let source = AVAssetImageGenerator(asset: AVURLAsset(url: falcon))
        source.requestedTimeToleranceBefore = .zero
        source.requestedTimeToleranceAfter = .zero
        let cases: [(LayerFill, TrailStyle, String)] = [(.crop(center: center), .neon, "crop-neon"),
                                                         (.crop(center: center), .broadcast, "crop-broadcast"),
                                                         (.fitOverBlur, .neon, "whole-neon")]
        for (fill, style, label) in cases {
            let out = temp("vertical")
            defer { try? FileManager.default.removeItem(at: out) }
            _ = try await FieldViewRenderer.alone(card: nil, cardSeconds: 0, fieldView: falcon, start: start, end: end,
                                                  shape: .vertical, fieldFill: fill,
                                                  trail: ShareTrail(geometry: g, style: style), to: out)
            let gen = AVAssetImageGenerator(asset: AVURLAsset(url: out))
            gen.requestedTimeToleranceBefore = .zero
            gen.requestedTimeToleranceAfter = .zero
            let tracks = try await AVURLAsset(url: out).loadTracks(withMediaType: .video)
            let size = try await XCTUnwrap(tracks.first).load(.naturalSize)
            XCTAssertEqual(size, CGSize(width: 1080, height: 1920))
            Self.stills(gen, ["a-early": trail.contactS + 0.2, "b-mid": (trail.contactS + trail.landS) / 2,
                              "c-late": trail.landS - 0.15, "d-landed": trail.landS + 0.2].reduce(into: [:]) {
                $0["\(label)-\($1.key)"] = $1.value - start
            })

            let m = try XCTUnwrap(g.moment(at: mid, style: style))
            let along = m.points[m.points.count * (style == .neon ? 9 : 7) / 10]
            let rect = LayerCompositor.placement(of: CGSize(width: trail.clip.width, height: trail.clip.height), into: frame, fill: fill)
            let at = TrailRenderer.pixel(along, in: rect)
            XCTAssertTrue(frame.contains(at), "\(label): the ball is in the frame (\(at))")
            let shared = try await BallTrailTests.pixel(gen, at: mid - start, at)
            let was = try await BallTrailTests.pixel(source, at: mid,
                                                     TrailRenderer.pixel(along, in: CGRect(x: 0, y: 0, width: trail.clip.width, height: trail.clip.height)))
            let what = "\(label): \(was) → \(shared) at \(at)"
            switch style {
            case .neon: XCTAssertGreaterThan(shared[2] - was[2], 25, what)
            case .broadcast: XCTAssertTrue(shared[0] - was[0] > 60 && shared[0] > shared[1], what)
            case .vapor: break
            }
        }
    }

    /// A highlight reel: each at-bat is made on its own (as Share makes it,
    /// trail and all) and put together; the trail comes in that at-bat's
    /// stretch, on its ball, and the switch and look are in the share's cache key.
    func testHighlightReelCarriesEachAtBatsTrail() async throws {
        guard FileManager.default.fileExists(atPath: falcon.path) else { throw XCTSkip("No clip at \(falcon.path)") }
        let trail = try BallTrailTests.fixture("falcon")
        let g = TrailGeometry(trail)
        let start = trail.contactS - 0.8, end = trail.landS + 1.2
        // The first at-bat: a grey stand-in with no field view.
        let plain = temp("plain")
        defer { try? FileManager.default.removeItem(at: plain) }
        try await EditRendererTests.makeClip(at: plain, seconds: 2, fps: 30, level: 60)
        // The second: its field view alone, as a highlight reel asks for it (no card, no captions).
        let options = ShareOptions(content: .fieldView, titleCard: false, captions: false)
        var request = ShareRequest(atBatID: UUID(), reel: plain, segments: [], pitches: [], result: .double,
                                   card: TitleCard(title: "", subtitle: ""), options: options,
                                   fieldView: (falcon, start, end, "test/falcon.mp4"), reelKey: "test", timings: .standard)
        request.trail = trail
        request.trailStyle = .neon
        let withTrail = try await ShareRenderer.render(request)
        var off = request
        off.options.ballTrail = false
        var broadcast = request
        broadcast.trailStyle = .broadcast
        XCTAssertNotNil(request.shareTrail)
        XCTAssertNil(off.shareTrail)
        let keys = [withTrail, try await ShareRenderer.render(off), try await ShareRenderer.render(broadcast)].map(\.lastPathComponent)
        XCTAssertEqual(Set(keys).count, 3, "switch and look each make their own copy: \(keys)")

        let out = temp("highlights")
        defer { try? FileManager.default.removeItem(at: out) }
        let plainLength = try await AVURLAsset(url: plain).load(.duration).seconds
        try await ReelStitcher.render(clips: [StitchClip(url: plain, caption: "AB 1 · Walk"), StitchClip(url: withTrail, caption: "AB 2 · Double")],
                                      card: nil, cardSeconds: 0, shape: .landscape, to: out)
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: out))
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        let mid = trail.points[trail.points.count / 2].t
        let m = try XCTUnwrap(g.moment(at: mid, style: .neon))
        let at = TrailRenderer.pixel(m.points[m.points.count * 9 / 10], in: CGRect(origin: .zero, size: EditRenderer.size))
        let shared = try await BallTrailTests.pixel(gen, at: plainLength + mid - start, at)
        let source = AVAssetImageGenerator(asset: AVURLAsset(url: falcon))
        source.requestedTimeToleranceBefore = .zero
        source.requestedTimeToleranceAfter = .zero
        let was = try await BallTrailTests.pixel(source, at: mid,
                                                 TrailRenderer.pixel(m.points[m.points.count * 9 / 10], in: CGRect(x: 0, y: 0, width: 1280, height: 720)))
        XCTAssertGreaterThan(shared[2] - was[2], 25, "the trail in the second at-bat's stretch: \(was) → \(shared)")
        Self.stills(gen, ["highlights-mid": plainLength + mid - start])
    }

    static func stills(_ gen: AVAssetImageGenerator, _ frames: [String: Double]) {
        let dir = URL(fileURLWithPath: "/tmp/ball-trail/vertical")
        guard FileManager.default.fileExists(atPath: dir.path) else { return }
        for (name, t) in frames {
            guard let image = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { continue }
            try? CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: dir.appendingPathComponent("\(name).png"),
                                                    format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        }
    }
}
