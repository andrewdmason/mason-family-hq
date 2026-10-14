import AVFoundation
import CoreImage
import XCTest
@testable import ClipsCamera

/// Vertical shares: where the crop lands, the blurred fill behind a whole
/// field view, and remembering options and framing.
final class VerticalTests: XCTestCase {
    private let landscape = CGRect(x: 0, y: 0, width: 1920, height: 1080)
    private let tall = VideoShape.vertical.size

    func testFillBoxSlidesAndStaysInside() {
        let middle = VideoShape.fillBox(extent: landscape, frame: tall, centerX: 0.5)
        XCTAssertEqual(middle.width, 607.5, accuracy: 0.01)
        XCTAssertEqual(middle.height, 1080)
        XCTAssertEqual(middle.midX, 960, accuracy: 0.01)
        XCTAssertEqual(VideoShape.fillBox(extent: landscape, frame: tall, centerX: 0).minX, 0)
        XCTAssertEqual(VideoShape.fillBox(extent: landscape, frame: tall, centerX: 1).maxX, 1920, accuracy: 0.01)
        XCTAssertEqual(VideoShape.fillBox(extent: landscape, frame: tall, centerX: 0.25).midX, 480, accuracy: 0.01)
        // Already the frame's shape (or narrower): kept whole across.
        let portrait = CGRect(x: 0, y: 0, width: 1080, height: 1920)
        XCTAssertEqual(VideoShape.fillBox(extent: portrait, frame: tall, centerX: 0.1), portrait)
        // Landscape into landscape is the whole picture.
        XCTAssertEqual(VideoShape.fillBox(extent: landscape, frame: landscape.size, centerX: 0.3), landscape)
        XCTAssertEqual(VideoShape.verticalWidth(aspect: 16.0 / 9.0), 607.5 / 1920, accuracy: 0.0001)
        XCTAssertEqual(clampedCropCenter(0, aspect: 16.0 / 9.0), 607.5 / 1920 / 2, accuracy: 0.0001)
        XCTAssertEqual(clampedCropCenter(0.5, aspect: 16.0 / 9.0), 0.5)
    }

    /// A picture dark on the left and bright on the right.
    private func gradient(_ size: CGSize) -> CIImage {
        CIFilter(name: "CILinearGradient", parameters: [
            "inputPoint0": CIVector(x: 0, y: 0), "inputColor0": CIColor.black,
            "inputPoint1": CIVector(x: size.width, y: 0), "inputColor1": CIColor.white,
        ])!.outputImage!.cropped(to: CGRect(origin: .zero, size: size))
    }

    private func level(_ image: CIImage, at p: CGPoint) -> Double {
        var pixel = [UInt8](repeating: 0, count: 4)
        CIContext().render(image, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(origin: p, size: CGSize(width: 1, height: 1)),
                           format: .RGBA8, colorSpace: nil)
        return Double(pixel[0])
    }

    func testCropFillsTheFrameAroundItsCenter() {
        let frame = CGRect(origin: .zero, size: tall)
        let src = gradient(landscape.size)
        let left = LayerCompositor.lay(src, into: frame, fill: .crop(center: 0.1))
        let right = LayerCompositor.lay(src, into: frame, fill: .crop(center: 0.9))
        XCTAssertEqual(left.extent, frame)
        XCTAssertEqual(right.extent, frame)
        let mid = CGPoint(x: 540, y: 960)
        XCTAssertLessThan(level(left, at: mid), 60, "framed on the left, the dark side fills the frame")
        XCTAssertGreaterThan(level(right, at: mid), 190)
    }

    func testWholeFieldSitsOverABlurredFill() {
        let frame = CGRect(origin: .zero, size: tall)
        let grey = CIImage(color: CIColor(red: 0.8, green: 0.8, blue: 0.8)).cropped(to: CGRect(x: 0, y: 0, width: 1280, height: 720))
        let fit = LayerCompositor.lay(grey, into: frame, fill: .fit)
        let blur = LayerCompositor.lay(grey, into: frame, fill: .fitOverBlur)
        let top = CGPoint(x: 540, y: 1800)
        // Plain fit leaves the space above the picture empty; the blurred
        // fill covers it.
        let mid = CGPoint(x: 540, y: 960)
        let plain = fit.composited(over: CIImage(color: .black).cropped(to: frame))
        XCTAssertEqual(level(plain, at: top), 0)
        XCTAssertGreaterThan(level(blur, at: top), 60)
        XCTAssertEqual(level(blur, at: mid), level(plain, at: mid), accuracy: 2, "the picture itself, whole, in the middle")
        XCTAssertLessThan(level(blur, at: top), level(blur, at: mid), "the fill is dimmed behind it")
    }

    func testOptionsSavedBeforeVerticalStillLoad() throws {
        let old = #"{"content":"hit","slowMo":false,"titleCard":true,"captions":true}"#
        let options = try JSONDecoder().decode(ShareOptions.self, from: Data(old.utf8))
        XCTAssertEqual(options, ShareOptions(content: .hit, slowMo: false))
        XCTAssertFalse(options.vertical)
        XCTAssertFalse(options.cropFieldView)
        let round = try JSONDecoder().decode(ShareOptions.self, from: JSONEncoder().encode(ShareOptions(vertical: true, cropFieldView: true)))
        XCTAssertTrue(round.vertical && round.cropFieldView)
    }

    func testFramingFallsBackToTheGame() {
        let settings = AppSettings.shared
        let game = UUID(), first = UUID(), second = UUID()
        settings.saveFraming(Framing(closeup: 0.3, fieldView: nil), atBat: first, game: game)
        settings.saveFraming(Framing(closeup: nil, fieldView: 0.7), atBat: first, game: game)
        XCTAssertEqual(settings.framing(atBat: first, game: game), Framing(closeup: 0.3, fieldView: 0.7), "an unset camera keeps its framing")
        XCTAssertEqual(settings.framing(atBat: second, game: game), Framing(closeup: 0.3, fieldView: 0.7), "a new at-bat starts from its game")
        settings.saveFraming(Framing(closeup: 0.6, fieldView: nil), atBat: second, game: game)
        XCTAssertEqual(settings.framing(atBat: first, game: game).closeup, 0.3, "the first at-bat keeps its own")
        XCTAssertEqual(settings.framing(atBat: UUID(), game: UUID()), Framing())
    }

    /// A vertical video end to end: the card, a captioned pitch cropped to
    /// the frame, then a field view whole over its blurred fill. (Frames are
    /// saved to /tmp/clipscamera-snapshots when that folder exists.)
    func testVerticalVideoEndToEnd() async throws {
        let tmp = FileManager.default.temporaryDirectory
        let raw = tmp.appendingPathComponent("v-raw-\(UUID().uuidString).mov")
        let gc = tmp.appendingPathComponent("v-gc-\(UUID().uuidString).mov")
        let closeup = tmp.appendingPathComponent("v-closeup-\(UUID().uuidString).mp4")
        let out = tmp.appendingPathComponent("v-out-\(UUID().uuidString).mp4")
        defer { for u in [raw, gc, closeup, out] { try? FileManager.default.removeItem(at: u) } }
        try await EditRendererTests.makeClip(at: raw, seconds: 3, fps: 60, level: 60)
        try await EditRendererTests.makeClip(at: gc, seconds: 3, fps: 30, width: 1280, height: 720, level: 200)

        let plan = [PlanSegment(start: 0, end: 3, rate: 1, muted: false, caption: "Pitch 4 · 1-2 · Ball in play · 2B",
                                pitchIndex: 0, replay: false)]
        let card = TitleCard.make(number: 3, result: .double, game: "Oakland Ballers 13U @ Falcon Prospects 13U", playedOn: "2026-10-14")
        _ = try await EditRenderer.render(source: raw, rotation: 0, plan: plan, card: card, timings: .standard,
                                          shape: .vertical, cropCenter: 0.3, to: closeup)
        let done = try await FieldViewRenderer.append(closeup: closeup, fieldView: gc, start: 0, end: 3,
                                                      shape: .vertical, fieldFill: .fitOverBlur, to: out)
        XCTAssertEqual(done.duration, 2 + 3 + 3, accuracy: 0.1)
        let asset = AVURLAsset(url: out)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let size = try await XCTUnwrap(tracks.first).load(.naturalSize)
        XCTAssertEqual(size, CGSize(width: 1080, height: 1920))
        let gen = AVAssetImageGenerator(asset: asset)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        FieldViewRendererTests.snapshot(gen, ["vertical-card": 1, "vertical-pitch": 3, "vertical-field": 7])
    }

    func testFramingLoopsTheKeySwing() {
        let reel = URL(fileURLWithPath: "/tmp/reel.mp4")
        let segments = [ReelSegment(start: 0, end: 3, fps: 60, pitch: 0), ReelSegment(start: 3, end: 7.5, fps: 240, pitch: 1)]
        let hit = FramingSources(reel: reel, segments: segments,
                                 pitches: [Pitch(t: 2, outcome: .foul), Pitch(t: 5, outcome: .inPlay)], fieldView: nil)
        XCTAssertEqual(hit.closeup?.start ?? 0, 4.2, accuracy: 0.001)
        XCTAssertEqual(hit.closeup?.rate, 0.25)
        XCTAssertNil(hit.fieldView)
        let walk = FramingSources(reel: reel, segments: segments,
                                  pitches: [Pitch(t: 2, outcome: .swingingStrike), Pitch(t: 5, outcome: .ball)],
                                  fieldView: FieldViewPlayback(url: reel, start: 1, end: 4))
        XCTAssertEqual(walk.closeup?.start ?? 0, 1.2, accuracy: 0.001, "no ball in play: the last swing")
        XCTAssertEqual(walk.fieldView, FramingLoop(url: reel, start: 1, end: 4, rate: 1))
    }
}
