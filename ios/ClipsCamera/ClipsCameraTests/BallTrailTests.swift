import AVFoundation
import CoreImage
import XCTest
@testable import ClipsCamera

/// The ball trail: reading the worker's JSON, the reference-frame projection,
/// the head/tail/drain timing, and the drawing — on the sample trails in
/// prototypes/ball-trail/fixtures, and (when the footage is on this Mac) on the
/// GameChanger clips they were traced from.
final class BallTrailTests: XCTestCase {
    static let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("prototypes/ball-trail/fixtures")

    static func fixture(_ name: String) throws -> BallTrail {
        try JSONDecoder().decode(BallTrail.self, from: Data(contentsOf: fixtures.appendingPathComponent("\(name).json")))
    }

    // MARK: Model

    func testDecodesBothFixtures() throws {
        let falcon = try Self.fixture("falcon")
        XCTAssertEqual(falcon.version, 1)
        XCTAssertEqual(falcon.source, "auto")
        XCTAssertEqual(falcon.clip, BallTrail.Clip(fps: 29.797, width: 1280, height: 720))
        XCTAssertEqual(falcon.contactS, 5.3361, accuracy: 1e-9)
        XCTAssertEqual(falcon.landS, 6.8463, accuracy: 1e-9)
        XCTAssertTrue(falcon.landed)
        XCTAssertEqual(falcon.points.count, 46)
        XCTAssertEqual(falcon.frames.count, 72)
        XCTAssertEqual(falcon.points.first, BallTrail.Point(t: 5.3361, x: 0.54119, y: 0.58553))
        XCTAssertEqual(falcon.frames.first?.h.count, 9)
        XCTAssertEqual(falcon.stats?.exitMph, 67)
        XCTAssertEqual(falcon.stats?.carryFt, 132)

        let cardinals = try Self.fixture("cardinals")
        XCTAssertEqual(cardinals.clip.width, 1920)
        XCTAssertEqual(cardinals.points.count, 73)
        XCTAssertEqual(cardinals.frames.count, 104)
        XCTAssertNil(cardinals.stats, "stats: null")
        XCTAssertEqual(cardinals.points.last?.t ?? 0, cardinals.landS, accuracy: 1e-9)

        // Round trip.
        let again = try JSONDecoder().decode(BallTrail.self, from: JSONEncoder().encode(falcon))
        XCTAssertEqual(again, falcon)
        XCTAssertEqual(again.fingerprint, falcon.fingerprint)
        XCTAssertNotEqual(cardinals.fingerprint, falcon.fingerprint)
    }

    func testRejectsAnotherVersion() throws {
        var json = try JSONSerialization.jsonObject(with: Data(contentsOf: Self.fixtures.appendingPathComponent("falcon.json"))) as! [String: Any]
        json["version"] = 2
        XCTAssertThrowsError(try JSONDecoder().decode(BallTrail.self, from: JSONSerialization.data(withJSONObject: json)))
    }

    func testAtBatReadsItsTrailColumns() throws {
        let trail = try String(contentsOf: Self.fixtures.appendingPathComponent("falcon.json"), encoding: .utf8)
        func atBat(_ extra: String) throws -> HistoryAtBat {
            let json = """
            {"id":"\(UUID())","source":"camera","status":"ready","created_at":"2026-10-11T16:02:00Z",
             "field_view_path":"g/a/gamechanger-1.mp4","field_view_start_s":4,"field_view_end_s":12\(extra)}
            """
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode(HistoryAtBat.self, from: Data(json.utf8))
        }
        let ready = try atBat(#","ball_trail":\#(trail),"ball_trail_status":"ready","ball_trail_tap":{"t":5.47,"x":0.474,"y":0.5}"#)
        XCTAssertEqual(ready.trail.status, .ready)
        XCTAssertEqual(ready.trail.ready?.points.count, 46)
        XCTAssertEqual(ready.trail.tap, TrailTap(t: 5.47, x: 0.474, y: 0.5))

        // A failed re-trace keeps the last trail, and it's still drawn; one in
        // progress shows the last one too.
        let failed = try atBat(#","ball_trail":\#(trail),"ball_trail_status":"failed""#)
        XCTAssertNotNil(failed.trail.ready)
        XCTAssertFalse(failed.trail.needsHelp, "there's a trail to show")
        XCTAssertNotNil(try atBat(#","ball_trail":\#(trail),"ball_trail_status":"pending""#).trail.ready)
        XCTAssertNil(try atBat(#","ball_trail":\#(trail),"ball_trail_status":"needs_tap""#).trail.ready)
        XCTAssertTrue(try atBat(#","ball_trail":null,"ball_trail_status":"failed""#).trail.needsHelp)

        let help = try atBat(#","ball_trail":null,"ball_trail_status":"needs_tap","ball_trail_tap":null"#)
        XCTAssertEqual(help.trail.status, .needsTap)
        XCTAssertTrue(help.trail.needsHelp)
        XCTAssertNil(help.trail.ready)

        // Before the columns exist, and with a trail this app can't read: the at-bat still loads.
        XCTAssertEqual(try atBat("").trail, .none)
        let odd = try atBat(#","ball_trail":{"version":9},"ball_trail_status":"ready""#)
        XCTAssertNil(odd.trail.trail)
        XCTAssertNil(odd.trail.ready)
    }

    func testOldShareOptionsKeepTheirChoices() throws {
        let saved = #"{"content":"hit","slowMo":false,"titleCard":true,"captions":false}"#
        let options = try JSONDecoder().decode(ShareOptions.self, from: Data(saved.utf8))
        XCTAssertEqual(options, ShareOptions(content: .hit, slowMo: false, titleCard: true, captions: false, ballTrail: true))
        let withTrail = ShareAvailability(hasFieldView: true, hasHit: true, hasTrail: true)
        XCTAssertTrue(withTrail.offersTrail(.whole))
        XCTAssertTrue(withTrail.offersTrail(.fieldView))
        XCTAssertFalse(withTrail.offersTrail(.pitches), "no GameChanger part, no trail")
        XCTAssertFalse(ShareAvailability(hasFieldView: false, hasHit: true, hasTrail: true).offersTrail(.whole))
        XCTAssertFalse(ShareAvailability(hasFieldView: true, hasHit: true).offersTrail(.whole))
    }

    // MARK: Projection

    /// Each point at its own time maps through its own frame's homography —
    /// worked out here straight from the JSON.
    func testHeadIsThePointThroughItsFramesHomography() throws {
        for name in ["falcon", "cardinals"] {
            let trail = try Self.fixture(name)
            let g = TrailGeometry(trail)
            for k in [3, 10, 20, trail.points.count - 1] {
                let p = trail.points[k]
                let f = try XCTUnwrap(trail.frames.first { abs($0.t - p.t) < 1e-6 }, "a frame at the point's time")
                let h = f.h
                let w = h[6] * p.x + h[7] * p.y + h[8]
                let expected = SIMD2((h[0] * p.x + h[1] * p.y + h[2]) / w, (h[3] * p.x + h[4] * p.y + h[5]) / w)
                let m = try XCTUnwrap(g.moment(at: p.t, style: .neon), "\(name) point \(k)")
                XCTAssertEqual(m.frameTime, p.t, accuracy: 1e-9)
                let head = try XCTUnwrap(m.points.last)
                XCTAssertEqual(head.x, expected.x, accuracy: 1e-9, "\(name) point \(k)")
                XCTAssertEqual(head.y, expected.y, accuracy: 1e-9, "\(name) point \(k)")
                // In pixels of the clip's own frame (Core Image: y up from the bottom).
                let size = CGRect(x: 0, y: 0, width: trail.clip.width, height: trail.clip.height)
                let px = TrailRenderer.pixel(head, in: size)
                XCTAssertEqual(px.x, expected.x * trail.clip.width, accuracy: 1e-6)
                XCTAssertEqual(px.y, trail.clip.height - expected.y * trail.clip.height, accuracy: 1e-6)
            }
        }
    }

    /// The camera pans: the tail is re-projected through the frame on screen,
    /// not the frames it was first seen in.
    func testTailUsesTheCurrentFramesHomography() throws {
        let trail = try Self.fixture("cardinals")
        let g = TrailGeometry(trail)
        let k = 40
        let m = try XCTUnwrap(g.moment(at: trail.points[k].t, style: .neon))
        let tailRef = g.position(m.times[0])
        let viaNow = g.project(tailRef, frame: m.frameIndex)
        XCTAssertEqual(m.points[0].x, viaNow.x, accuracy: 1e-12)
        XCTAssertEqual(m.points[0].y, viaNow.y, accuracy: 1e-12)
        let then = try XCTUnwrap(g.frameIndex(at: m.times[0]))
        XCTAssertNotEqual(then, m.frameIndex)
    }

    // MARK: Timing

    func testHeadTailAndDrain() throws {
        let trail = try Self.fixture("falcon")
        let g = TrailGeometry(trail)
        let frame = 1 / trail.clip.fps
        let style = TrailStyle.neon

        XCTAssertNil(g.moment(at: trail.contactS - 0.1, style: style), "nothing before contact")
        XCTAssertNil(g.moment(at: trail.contactS, style: style), "a point isn't a trail")

        // Between frames the frame on screen decides: the trail steps with the picture.
        let p5 = trail.points[5]
        let between = try XCTUnwrap(g.moment(at: p5.t + 0.4 * frame, style: style))
        XCTAssertEqual(between.frameTime, p5.t, accuracy: 1e-9)
        XCTAssertEqual(between.head, p5.t, accuracy: 1e-9)
        XCTAssertEqual(between.tailStart, trail.contactS, accuracy: 1e-9, "early on the tail reaches back to contact")

        // In flight the tail is 150 px (at 1280) or 15 frames, whichever is shorter.
        for k in stride(from: 16, to: trail.points.count, by: 5) {
            let m = try XCTUnwrap(g.moment(at: trail.points[k].t, style: style))
            let frames = (m.head - m.tailStart) * trail.clip.fps
            let pixels = g.arc(at: m.head) - g.arc(at: m.tailStart)
            XCTAssertLessThanOrEqual(frames, 15 + 1e-6)
            XCTAssertLessThanOrEqual(pixels, 150 + 0.5)
            XCTAssertTrue(abs(frames - 15) < 1e-6 || abs(pixels - 150) < 0.5, "one limit binds (\(frames) frames, \(pixels) px)")
            XCTAssertTrue(m.inFlight)
            XCTAssertEqual(m.fade, 1)
            XCTAssertEqual(m.u.first ?? 0, 1, accuracy: 1e-9)
            XCTAssertEqual(m.u.last ?? 1, 0, accuracy: 1e-9)
        }

        // After landing the head stays put, the tail drains into it at 1.2×
        // and fades over the 15-frame cap.
        let atLand = try XCTUnwrap(g.moment(at: trail.landS, style: style))
        let landIndex = try XCTUnwrap(g.frameIndex(at: trail.landS))
        let after3 = try XCTUnwrap(g.moment(at: g.frameTime(landIndex + 3), style: style))
        let late = (g.frameTime(landIndex + 3) - trail.landS) * trail.clip.fps
        XCTAssertEqual(after3.head, trail.landS, accuracy: 1e-9)
        XCTAssertFalse(after3.inFlight)
        XCTAssertEqual(after3.fade, 1 - late / 15, accuracy: 1e-6)
        XCTAssertEqual((after3.tailStart - atLand.tailStart) * trail.clip.fps, late * 1.2, accuracy: 1e-6)
        XCTAssertNil(g.moment(at: trail.landS + 16 * frame, style: style), "drained")
        XCTAssertNotNil(g.moment(at: trail.landS + 6 * frame, style: .vapor), "vapor lingers (26 frames)")
        XCTAssertNil(g.moment(at: trail.landS + 27 * frame, style: .vapor))
    }

    /// GameChanger clips run at a variable frame rate and trail times are the
    /// frames' own timestamps: the frame on screen is the last one that has
    /// started, however uneven the spacing.
    func testUnevenFrameTimes() throws {
        var trail = try Self.fixture("falcon")
        let shift = { (k: Int) in k % 3 == 1 ? 0.012 : (k % 3 == 2 ? -0.009 : 0) }
        for k in trail.frames.indices { trail.frames[k].t += shift(k) }
        for k in trail.points.indices { trail.points[k].t += shift(k) }
        trail.contactS = trail.points[0].t
        trail.landS = trail.points[trail.points.count - 1].t
        let g = TrailGeometry(trail)
        for k in [4, 5, 6, 7] {
            let shown = trail.frames[k].t
            let next = trail.frames[k + 1].t
            for t in [shown, (shown + next) / 2, next - 0.003] {
                let m = try XCTUnwrap(g.moment(at: t, style: .neon))
                XCTAssertEqual(m.frameIndex, k, "at \(t)")
                XCTAssertEqual(m.head, trail.points[k].t, accuracy: 1e-9)
                let p = trail.points[k], h = trail.frames[k].h
                let w = h[6] * p.x + h[7] * p.y + h[8]
                XCTAssertEqual(m.points.last?.x ?? 0, (h[0] * p.x + h[1] * p.y + h[2]) / w, accuracy: 1e-9)
            }
        }
    }

    func testTrailEndingInTheAirFadesInsteadOfDraining() throws {
        var trail = try Self.fixture("falcon")
        trail.landed = false
        let g = TrailGeometry(trail)
        let last = trail.points.count - 1
        let m = try XCTUnwrap(g.moment(at: trail.points[last - 2].t, style: .broadcast))
        XCTAssertEqual(m.fade, (trail.points[last].t - trail.points[last - 2].t) * trail.clip.fps / TrailGeometry.fadeOutFrames, accuracy: 1e-6)
        XCTAssertNil(g.moment(at: trail.landS + 0.1, style: .broadcast))
    }

    // MARK: Drawing

    /// Each look puts its colour at the ball, and nothing outside the picture.
    func testDrawsEachLookAtTheBall() throws {
        let trail = try Self.fixture("falcon")
        let g = TrailGeometry(trail)
        let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
        let rect = CGRect(x: 0, y: 0, width: 1280, height: 720)
        let t = trail.points[20].t
        let head = TrailRenderer.pixel(try XCTUnwrap(g.moment(at: t, style: .neon)?.points.last), in: rect)
        func rgba(_ image: CIImage, _ p: CGPoint) -> [Double] {
            var px = [UInt8](repeating: 0, count: 4)
            context.render(image, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: p.x.rounded(.down), y: p.y.rounded(.down), width: 1, height: 1),
                           format: .RGBA8, colorSpace: nil)
            return px.map { Double($0) / 255 }
        }
        for style in TrailStyle.allCases {
            let image = try XCTUnwrap(TrailRenderer.image(g, at: t, style: style, videoRect: rect), style.label)
            XCTAssertTrue(rect.contains(image.extent), "\(style.label) stays in the picture")
            XCTAssertLessThan(image.extent.width * image.extent.height, rect.width * rect.height / 4, "just around the trail")
            let c = rgba(image, head)
            XCTAssertGreaterThan(c[3], 0.25, "\(style.label) covers the ball (\(c))")
            for i in 0..<3 { XCTAssertLessThanOrEqual(c[i], c[3] + 1.0 / 255, "premultiplied") }
            switch style {
            case .neon: XCTAssertTrue(c[2] > 0.6 && c[2] >= c[0], "blue-white light (\(c))")
            case .vapor:
                XCTAssertLessThanOrEqual(c[3], 0.86)
                XCTAssertEqual(c[0] / c[3], 248.0 / 255, accuracy: 0.03)
            case .broadcast: break // the ring's hole is at the ball; check the line behind it
            }
            XCTAssertEqual(rgba(image, CGPoint(x: 5, y: 5))[3], 0, "\(style.label) is clear far from the ball")
        }
        // Broadcast: red behind the ball, inside its ring.
        let m = try XCTUnwrap(g.moment(at: t, style: .broadcast))
        let behind = TrailRenderer.pixel(m.points[m.points.count * 7 / 10], in: rect)
        let red = rgba(try XCTUnwrap(TrailRenderer.image(g, at: t, style: .broadcast, videoRect: rect)), behind)
        XCTAssertGreaterThan(red[0], red[1] + 0.2, "red line (\(red))")
    }

    // MARK: On the real footage

    /// Burns each look into the Falcon clip with the share renderer and
    /// writes stills to /tmp/ball-trail/stills/ball-trail-*.png (when that
    /// folder exists) to look at. Needs the clip:
    ///
    ///   mkdir -p /tmp/ball-trail/stills
    ///   cp ~/Downloads/"Double @ Falcon Prospects 13U.mp4" /tmp/ball-trail/falcon.mp4
    ///   cp ~/Desktop/"Sebastian double Cardinals Game 1.mov" /tmp/ball-trail/cardinals.mov
    func testBurnsTheTrailIntoTheFieldView() async throws {
        for (name, file) in [("falcon", "falcon.mp4"), ("cardinals", "cardinals.mov")] {
            let video = URL(fileURLWithPath: "/tmp/ball-trail/\(file)")
            guard FileManager.default.fileExists(atPath: video.path) else { throw XCTSkip("No clip at \(video.path)") }
            let trail = try Self.fixture(name)
            let g = TrailGeometry(trail)
            let start = trail.contactS - 0.8, end = trail.landS + 1.2
            let times = ["a-early": trail.contactS + 0.2, "b-mid": (trail.contactS + trail.landS) / 2,
                         "c-late": trail.landS - 0.15, "d-landed": trail.landS + 0.2]
            for style in TrailStyle.allCases {
                let out = FileManager.default.temporaryDirectory.appendingPathComponent("trail-\(UUID().uuidString).mp4")
                defer { try? FileManager.default.removeItem(at: out) }
                _ = try await FieldViewRenderer.alone(card: nil, cardSeconds: 0, fieldView: video, start: start, end: end,
                                                      trail: ShareTrail(geometry: g, style: style), to: out)
                let gen = AVAssetImageGenerator(asset: AVURLAsset(url: out))
                gen.requestedTimeToleranceBefore = .zero
                gen.requestedTimeToleranceAfter = .zero
                var stills: [String: Double] = [:]
                for (label, t) in times { stills["ball-trail-\(name)-\(style.rawValue)-\(label)"] = t - start }
                Self.stills(gen, stills)

                // Mid-flight, along the trail, the shared frame has changed
                // from the GameChanger frame the way the look says.
                let mid = trail.points[trail.points.count / 2].t
                let m = try XCTUnwrap(g.moment(at: mid, style: style))
                // Behind the head: the ring is hollow, and vapor is thickest a little back.
                let along = m.points[m.points.count * (style == .neon ? 9 : 7) / 10]
                let shared = try await Self.pixel(gen, at: mid - start, TrailRenderer.pixel(along, in: CGRect(origin: .zero, size: EditRenderer.size)))
                let sourceGen = AVAssetImageGenerator(asset: AVURLAsset(url: video))
                sourceGen.requestedTimeToleranceBefore = .zero
                sourceGen.requestedTimeToleranceAfter = .zero
                let source = try await Self.pixel(sourceGen, at: mid,
                                                  TrailRenderer.pixel(along, in: CGRect(x: 0, y: 0, width: trail.clip.width, height: trail.clip.height)))
                let what = "\(name) \(style.rawValue): \(source) → \(shared)"
                switch style {
                case .neon: XCTAssertGreaterThan(shared[2] - source[2], 25, what) // light added, blue first
                case .vapor: XCTAssertGreaterThan(shared.reduce(0, +) - source.reduce(0, +), 45, what) // whiter
                case .broadcast: XCTAssertTrue(shared[0] - source[0] > 60 && shared[0] > shared[1], what) // red
                }
            }
        }
    }

    static func stills(_ gen: AVAssetImageGenerator, _ frames: [String: Double]) {
        let dir = URL(fileURLWithPath: "/tmp/ball-trail/stills")
        guard FileManager.default.fileExists(atPath: dir.path) else { return }
        for (name, t) in frames {
            guard let image = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { continue }
            try? CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: dir.appendingPathComponent("\(name).png"),
                                                    format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        }
    }

    /// One pixel of a video frame (Core Image coordinates), RGB 0–255.
    static func pixel(_ gen: AVAssetImageGenerator, at seconds: Double, _ p: CGPoint) async throws -> [Int] {
        let (image, _) = try await gen.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
        var px = [UInt8](repeating: 0, count: 4)
        CIContext().render(CIImage(cgImage: image), toBitmap: &px, rowBytes: 4,
                           bounds: CGRect(x: p.x.rounded(.down), y: p.y.rounded(.down), width: 1, height: 1),
                           format: .RGBA8, colorSpace: nil)
        return px.prefix(3).map(Int.init)
    }
}
