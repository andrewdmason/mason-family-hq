import AVFoundation
import CoreImage
import XCTest
@testable import ClipsCamera

/// The title card: its words, the swing behind it, its typefaces, and every
/// theme drawn in both shapes. (Frames go to /tmp/clipscamera-snapshots when it
/// exists; CARD_HEADSHOT and CARD_SWING, paths to a cut-out PNG and a frame of
/// a swing, draw them with a real headshot and picture.)
final class TitleCardTests: XCTestCase {
    func testWords() {
        let card = TitleCard.make(kid: "Oscar Mason", result: .homeRun, game: "Kabuki", playedOn: "2026-10-11")
        XCTAssertEqual(card.name, "Oscar Mason")
        XCTAssertEqual(card.result, "Home run")
        XCTAssertEqual(card.meta, "vs Kabuki · Sun, Oct 11, 2026")
        XCTAssertEqual(TitleCard.meta(game: "vs Kabuki", playedOn: nil), "vs Kabuki")
        XCTAssertEqual(TitleCard.meta(game: "Oakland Ballers 13U @ Falcon Prospects 13U", playedOn: nil),
                       "Oakland Ballers 13U @ Falcon Prospects 13U")
        XCTAssertEqual(TitleCard.make(kid: nil, result: nil, game: nil, playedOn: nil).name, "Highlights")
        XCTAssertEqual(CardBadge(.strikeoutLooking), CardBadge(text: "K", hit: false, mirrored: true))
        XCTAssertEqual(CardBadge(.triple), CardBadge(text: "3B", hit: true))
        XCTAssertEqual(CardBadge(.fieldersChoice), CardBadge(text: "FC", hit: false))
    }

    func testTypefacesAreInTheApp() {
        CardFonts.register()
        for theme in CardTheme.all {
            XCTAssertNotNil(UIFont(name: theme.font, size: 40), "\(theme.name) needs \(theme.font)")
        }
        XCTAssertEqual(CardTheme.named("nope"), CardTheme.standard)
    }

    func testTheSwingBehindTheCard() {
        let reel = URL(fileURLWithPath: "/tmp/reel.mp4")
        let segments = [ReelSegment(start: 0, end: 3, fps: 60, pitch: 0), ReelSegment(start: 3, end: 7.5, fps: 240, pitch: 1)]
        // The ball in play: half a second (a 2s card at ¼ speed), starting a
        // little before the tap.
        let hit = CardSwing.make(reel: reel, segments: segments,
                                 pitches: [Pitch(t: 2, outcome: .ball), Pitch(t: 5, outcome: .inPlay)], cardSeconds: 2, focus: 0.4)
        XCTAssertEqual(hit?.start ?? 0, 4.8, accuracy: 0.001)
        XCTAssertEqual(hit?.end ?? 0, 5.3, accuracy: 0.001)
        XCTAssertEqual(hit?.focus, 0.4)
        // Kept inside its slow-motion stretch.
        let early = CardSwing.make(reel: reel, segments: segments, pitches: [Pitch(t: 3.05, outcome: .foul)], cardSeconds: 2, focus: nil)
        XCTAssertEqual(early?.start ?? 0, 3, accuracy: 0.001)
        // No swing, or a swing not filmed in slow motion: the graphic.
        XCTAssertNil(CardSwing.make(reel: reel, segments: segments, pitches: [Pitch(t: 5, outcome: .ball)], cardSeconds: 2, focus: nil))
        XCTAssertNil(CardSwing.make(reel: reel, segments: segments, pitches: [Pitch(t: 2, outcome: .inPlay)], cardSeconds: 2, focus: nil))
        XCTAssertGreaterThan(CardSwing.rank(.homeRun), CardSwing.rank(.double))
        XCTAssertGreaterThan(CardSwing.rank(.groundout), CardSwing.rank(nil))
    }

    func testDrawsEveryThemeInBothShapes() throws {
        let env = ProcessInfo.processInfo.environment
        let headshot = try env["CARD_HEADSHOT"].map { URL(fileURLWithPath: $0) } ?? Self.makeHeadshot()
        let swing = env["CARD_SWING"].flatMap { CIImage(contentsOf: URL(fileURLWithPath: $0)) } ?? Self.makeSwing()
        let dir = env["SNAPSHOT_DIR"] ?? (FileManager.default.fileExists(atPath: "/tmp/clipscamera-snapshots") ? "/tmp/clipscamera-snapshots" : nil)
        let context = CIContext()
        for theme in CardTheme.all {
            for shape in [VideoShape.landscape, .vertical] {
                let style = CardStyle(theme: theme.id, headshot: headshot)
                let single = TitleCard.make(kid: "Sebastian Mason", result: .double, game: "DEC Elite 13u", playedOn: "2026-10-11", style: style)
                var reel = ReelStitcher.card(kid: "Sebastian Mason", games: [("DEC Elite 13u", "2026-10-11")],
                                             results: [.double, .strikeoutLooking, .triple, .single], style: style)
                reel.swing = CardSwing(url: headshot, start: 0, end: 0.5, focus: 0.39)
                for (name, card, picture) in [("single", single, swing), ("reel", reel, swing), ("walk", single, nil)] {
                    let animator = CardAnimator(card: card, size: shape.size, length: 2)
                    for t in [0.0, 0.3, 1.2, 1.95] {
                        let frame = animator.frame(at: t, swing: picture)
                        XCTAssertEqual(frame.extent, CGRect(origin: .zero, size: shape.size))
                    }
                    if let dir {
                        let url = URL(fileURLWithPath: dir).appendingPathComponent("card-\(theme.id)-\(shape.rawValue)-\(name).png")
                        try context.writePNGRepresentation(of: animator.frame(at: 1.2, swing: picture), to: url, format: .RGBA8,
                                                           colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
                    }
                }
            }
        }
    }

    /// A real at-bat, shared with its card: CARD_REEL (a pitch reel whose
    /// last stretch is a 240fps swing put in play at CARD_TAP seconds).
    /// Frames of the card go to the snapshot folder. Skipped without one.
    func testRealAtBatShare() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let path = env["CARD_REEL"], let tap = env["CARD_TAP"].flatMap(Double.init) else { throw XCTSkip("no CARD_REEL") }
        let reel = URL(fileURLWithPath: path)
        let duration = try await AVURLAsset(url: reel).load(.duration).seconds
        let segments = [ReelSegment(start: 0, end: tap - 2, fps: 60, pitch: 0), ReelSegment(start: tap - 2, end: duration, fps: 240, pitch: 1)]
        let headshot = env["CARD_HEADSHOT"].map { URL(fileURLWithPath: $0) }
        // CARD_BATTER: where the batter really stands, across the picture.
        if let truth = env["CARD_BATTER"].flatMap(Double.init) {
            let found = await CardSwing.findBatter(in: reel, from: tap - 0.2, to: tap + 0.3)
            XCTAssertEqual(try XCTUnwrap(found), truth, accuracy: 0.06)
        }
        for vertical in [false, true] {
            let card = TitleCard.make(kid: "Sebastian Mason", result: .double, game: "DEC Elite 13u", playedOn: "2026-10-11",
                                      style: CardStyle(theme: "gold", headshot: headshot))
            let request = ShareRequest(atBatID: UUID(), reel: reel, segments: segments,
                                       pitches: [Pitch(t: 1, outcome: .ball), Pitch(t: tap, outcome: .inPlay)], result: .double,
                                       card: card, options: ShareOptions(content: .hit, vertical: vertical),
                                       reelKey: UUID().uuidString, timings: .standard)
            let out = try await ShareRenderer.render(request)
            let gen = AVAssetImageGenerator(asset: AVURLAsset(url: out))
            gen.requestedTimeToleranceBefore = .zero
            gen.requestedTimeToleranceAfter = .zero
            if let dir = env["SNAPSHOT_DIR"] ?? (FileManager.default.fileExists(atPath: "/tmp/clipscamera-snapshots") ? "/tmp/clipscamera-snapshots" : nil) {
                for t in [0.15, 0.5, 1.0, 1.3, 1.9, 2.3] {
                    let (image, _) = try await gen.image(at: CMTime(seconds: t, preferredTimescale: 600))
                    let url = URL(fileURLWithPath: dir).appendingPathComponent("real-\(vertical ? "tall" : "wide")-\(String(format: "%.2f", t)).png")
                    try CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: url, format: .RGBA8,
                                                           colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
                }
            }
        }
    }

    /// A stand-in headshot: a grey figure with a white outline.
    static func makeHeadshot() throws -> URL {
        let size = CGSize(width: 400, height: 520)
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            let outline = UIBezierPath(ovalIn: CGRect(x: 90, y: 40, width: 220, height: 260))
            outline.append(UIBezierPath(roundedRect: CGRect(x: 10, y: 300, width: 380, height: 220), cornerRadius: 120))
            UIColor.white.setFill()
            outline.fill()
            UIColor.gray.setFill()
            UIBezierPath(ovalIn: CGRect(x: 104, y: 54, width: 192, height: 232)).fill()
            UIBezierPath(roundedRect: CGRect(x: 24, y: 314, width: 352, height: 206), cornerRadius: 110).fill()
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("headshot-test.png")
        try XCTUnwrap(image.pngData()).write(to: url)
        return url
    }

    /// A stand-in swing frame: a bright figure on a mid-grey field.
    static func makeSwing() -> CIImage {
        let size = CGSize(width: 1920, height: 1080)
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            UIColor(white: 0.45, alpha: 1).setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            UIColor(white: 0.9, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 700, y: 250, width: 120, height: 420), cornerRadius: 40).fill()
        }
        return CIImage(image: image)!
    }
}
