import AVFoundation
import CoreImage
import XCTest
@testable import ClipsCamera

/// Highlight reels of several at-bats: their words, which at-bats go in and
/// how long it runs, the caption's entrance, and a real reel put together.
final class ReelStitcherTests: XCTestCase {
    func testCaptionsName_theAtBat() {
        XCTAssertEqual(ReelStitcher.caption(number: 2, result: .double, day: nil), "AB 2 · Double")
        XCTAssertEqual(ReelStitcher.caption(number: 2, result: .double, day: "2026-10-11"), "Oct 11 · AB 2 · Double")
        XCTAssertEqual(ReelStitcher.caption(number: 5, result: nil, day: nil), "AB 5")
    }

    func testOneTitleCard() {
        let one = ReelStitcher.card(kid: "Sebastian Mason", games: [("vs Kabuki", "2026-10-11"), ("vs Kabuki", "2026-10-11")],
                                    results: [.double, .strikeoutLooking])
        XCTAssertEqual(one, TitleCard(name: "Sebastian Mason", chip: "Highlights", meta: "vs Kabuki · Sun, Oct 11, 2026",
                                      badges: [CardBadge(text: "2B", hit: true), CardBadge(text: "K", hit: false, mirrored: true)]))
        let span = ReelStitcher.card(kid: "Sebastian Mason", games: [("Merchants", "2026-09-26"), ("vs Kabuki", "2026-10-14")])
        XCTAssertEqual(span.meta, "2 games · Sep 26 – Oct 14, 2026")
        XCTAssertEqual(ReelStitcher.dateRange("2026-12-30", "2027-01-02"), "Dec 30, 2026 – Jan 2, 2027")
        XCTAssertEqual(ReelStitcher.card(kid: nil, games: [("A", "2026-10-11")]).name, "Highlights")
        // Ten or more at-bats: a tally instead of badges.
        let long = ReelStitcher.card(kid: "Oscar Mason", games: [("A", "2026-10-11")],
                                     results: [.single, .walk, .groundout, .double, .strikeoutSwinging, .flyout, .single, .hitByPitch, .popout, .lineout])
        XCTAssertEqual(long.badges, [])
        XCTAssertEqual(long.tally, "10 at-bats · 3 hits · 2 walks")
    }

    func testReelFileName() {
        XCTAssertEqual(HomeView.reelFileName(kid: "Sebastian", games: [("vs Kabuki", "2026-10-11")], count: 4),
                       "Sebastian - vs Kabuki - 4 at-bats - 2026-10-11.mp4")
        XCTAssertEqual(HomeView.reelFileName(kid: "Sebastian", games: [("A", "2026-09-26"), ("B/C", "2026-10-14")], count: 6),
                       "Sebastian - 6 at-bats - 2026-09-26 to 2026-10-14.mp4")
    }

    private let segments = [ReelSegment(start: 0, end: 3, fps: 60, pitch: 0), ReelSegment(start: 3, end: 7.5, fps: 240, pitch: 1)]

    func testWhichAtBatsGoInAndHowLong() {
        let hit = ShareItem(id: UUID(), segments: segments,
                            pitches: [Pitch(t: 2, outcome: .ball), Pitch(t: 5, outcome: .inPlay)], fieldViewLength: 4)
        let walk = ShareItem(id: UUID(), segments: segments,
                             pitches: [Pitch(t: 2, outcome: .ball), Pitch(t: 5, outcome: .ball)], fieldViewLength: nil)
        let justHit = ShareOptions(content: .hit)
        XCTAssertTrue(hit.isIncluded(justHit))
        XCTAssertFalse(walk.isIncluded(justHit))
        XCTAssertFalse(walk.isIncluded(ShareOptions(content: .fieldView)))
        XCTAssertTrue(walk.isIncluded(ShareOptions(content: .whole)))
        // The in-play window and its replay, then the field view.
        XCTAssertEqual(hit.length(justHit, timings: .standard), 4.5 + 4.8 + 4, accuracy: 0.001)
        XCTAssertEqual(walk.length(ShareOptions(content: .whole, slowMo: false), timings: .standard), 7.5, accuracy: 0.001)
        XCTAssertEqual(hit.length(ShareOptions(content: .fieldView), timings: .standard), 4, accuracy: 0.001)
        let both = ShareAvailability(items: [hit, walk])
        XCTAssertTrue(both.hasHit && both.hasFieldView)
    }

    func testCaptionSlidesInThenHolds() {
        let frame = CGRect(x: 0, y: 0, width: 400, height: 200)
        let white = CIImage(color: .white).cropped(to: CGRect(x: 10, y: 50, width: 100, height: 20))
        let orange = CIImage(color: CIColor(red: 1, green: 0.5, blue: 0)).cropped(to: white.extent)
        let caption = AnimatedCaption(normal: white, replay: orange, appear: 10, gone: 15, replays: [12 ... 13])
        func alpha(_ t: Double, at p: CGPoint) -> Double {
            var pixel = [UInt8](repeating: 0, count: 4)
            CIContext().render(caption.image(at: t).cropped(to: frame), toBitmap: &pixel, rowBytes: 4,
                               bounds: CGRect(origin: p, size: CGSize(width: 1, height: 1)), format: .RGBA8, colorSpace: nil)
            return Double(pixel[3])
        }
        let place = CGPoint(x: 50, y: 60)
        XCTAssertEqual(alpha(10, at: place), 0, "not in yet")
        // A tenth of a second in: partly faded in, and lower than its place.
        XCTAssertGreaterThan(alpha(10.1, at: CGPoint(x: 50, y: 35)), 0, "coming in from below")
        XCTAssertEqual(alpha(11, at: CGPoint(x: 50, y: 45)), 0, "then risen to its place")
        XCTAssertEqual(alpha(11, at: place), 255, "settled")
        XCTAssertEqual(caption.image(at: 11).extent, white.extent)
        let leaving = alpha(14.85, at: CGPoint(x: 50, y: 45))
        XCTAssertTrue(leaving > 0 && leaving < 255, "dropping and fading as its at-bat ends (\(leaving))")
        XCTAssertEqual(alpha(15, at: place), 0, "gone")
        XCTAssertEqual(caption.image(at: 12.5).extent, orange.extent)
        var pixel = [UInt8](repeating: 0, count: 4)
        CIContext().render(caption.image(at: 12.5), toBitmap: &pixel, rowBytes: 4, bounds: CGRect(origin: place, size: CGSize(width: 1, height: 1)),
                           format: .RGBA8, colorSpace: nil)
        XCTAssertLessThan(pixel[2], 50, "orange during a replay")
    }

    /// Two at-bats under one card: the first plays out, holds, and the second
    /// dissolves in. (Frames go to /tmp/clipscamera-snapshots when it exists.)
    func testPutsAtBatsTogether() async throws {
        let tmp = FileManager.default.temporaryDirectory
        let a = tmp.appendingPathComponent("stitch-a-\(UUID().uuidString).mov")
        let b = tmp.appendingPathComponent("stitch-b-\(UUID().uuidString).mov")
        let out = tmp.appendingPathComponent("stitch-\(UUID().uuidString).mp4")
        defer { for u in [a, b, out] { try? FileManager.default.removeItem(at: u) } }
        try await EditRendererTests.makeClip(at: a, seconds: 2, fps: 60, width: 1080, height: 1920, level: 40)
        try await EditRendererTests.makeClip(at: b, seconds: 3, fps: 60, width: 1080, height: 1920, level: 200)

        let card = ReelStitcher.card(kid: "Sebastian Mason", games: [("Merchants", "2026-09-26"), ("vs Kabuki", "2026-10-14")], results: [.walk, .double])
        let length = try await ReelStitcher.render(
            clips: [StitchClip(url: a, caption: "Sep 26 · AB 1 · Walk"),
                    StitchClip(url: b, caption: "Oct 14 · AB 3 · Double", replays: [1 ... 2])],
            card: card, cardSeconds: 2, shape: .vertical, to: out)
        XCTAssertEqual(length, 2 + 2 + 3, accuracy: 0.05)
        let asset = AVURLAsset(url: out)
        let duration = try await asset.load(.duration).seconds
        XCTAssertEqual(duration, 7, accuracy: 0.1)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let size = try await XCTUnwrap(tracks.first).load(.naturalSize)
        XCTAssertEqual(size, CGSize(width: 1080, height: 1920))
        let audio = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(audio.count, 1)

        let gen = AVAssetImageGenerator(asset: asset)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        let first = try await Self.grey(gen, at: 3.9)
        let blend = try await Self.grey(gen, at: 4.25)
        let second = try await Self.grey(gen, at: 5.5)
        XCTAssertLessThan(first, 90, "the first at-bat to its end")
        XCTAssertGreaterThan(second, 130)
        XCTAssertTrue(blend > first + 20 && blend < second - 20, "dissolving (\(first) → \(blend) → \(second))")
        FieldViewRendererTests.snapshot(gen, ["reel-card": 1, "reel-first": 3, "reel-leaving": 3.85, "reel-beat": 4.3,
                                              "reel-entering": 4.65, "reel-second": 5.3, "reel-replay": 5.6])
    }

    /// A pixel well clear of the caption.
    static func grey(_ gen: AVAssetImageGenerator, at seconds: Double) async throws -> Double {
        let (image, _) = try await gen.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
        var pixel = [UInt8](repeating: 0, count: 4)
        CIContext().render(CIImage(cgImage: image), toBitmap: &pixel, rowBytes: 4,
                           bounds: CGRect(x: 540, y: 600, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        return Double(pixel[0])
    }
}
