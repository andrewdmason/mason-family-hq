import AVFoundation
import XCTest
@testable import ClipsCamera

/// The pitch reel: its cuts and frame rates, the player's arithmetic, and a
/// real reel and shared video made from a generated 240fps clip.
final class ReelTests: XCTestCase {
    private let pitches = [
        Pitch(t: 2.5, outcome: .ball),
        Pitch(t: 5.5, outcome: .inPlay, battedBall: .lineDrive, playResult: .single),
    ]

    // MARK: Plan

    func testCutsKeepFullRateOnlyForSwings() {
        let cuts = ReelPlan.cuts(pitches: pitches, duration: 8)
        XCTAssertEqual(cuts.map(\.segment), [
            ReelSegment(start: 0, end: 3, fps: 60, pitch: 0),
            ReelSegment(start: 3, end: 7.5, fps: 240, pitch: 1),
        ])
        XCTAssertEqual(ReelPlan.pitchTimes(pitches: pitches, cuts: cuts), [2, 5])
    }

    func testUnlabeledPitchKeepsFullRate() {
        let cuts = ReelPlan.cuts(pitches: [Pitch(t: 3, outcome: nil)], duration: 8)
        XCTAssertEqual(cuts.first?.segment.fps, 240)
    }

    func testRebuildOnlyWhenTheCutsChange() {
        var called = pitches
        called[0].outcome = .calledStrike
        XCTAssertFalse(ReelPlan.needsRebuild(old: pitches, new: called, duration: 8), "take to take keeps the reel")
        var foul = pitches
        foul[0].outcome = .foul
        XCTAssertTrue(ReelPlan.needsRebuild(old: pitches, new: foul, duration: 8), "a swing needs every frame")
        var swinging = pitches
        swinging[0].outcome = .swingingStrike
        XCTAssertTrue(ReelPlan.needsRebuild(old: pitches, new: swinging, duration: 8))
    }

    func testPlayerArithmetic() {
        let segments = [ReelSegment(start: 0, end: 3, fps: 60, pitch: 0), ReelSegment(start: 3, end: 7.5, fps: 240, pitch: 1)]
        let times = [2.0, 5.0]
        XCTAssertEqual(ReelPlan.pitchShowing(at: 0.5, segments: segments, pitchTimes: times), 0)
        XCTAssertEqual(ReelPlan.pitchShowing(at: 3.1, segments: segments, pitchTimes: times), 1)
        XCTAssertEqual(ReelPlan.pitchShowing(at: 7.5, segments: segments, pitchTimes: times), 1, "the very end still shows the last pitch")
        XCTAssertEqual(ReelPlan.jumpTarget(pitch: 0, segments: segments, pitchTimes: times), 0)
        XCTAssertEqual(ReelPlan.jumpTarget(pitch: 1, segments: segments, pitchTimes: times), 3)
        let replay = ReelPlan.replayWindow(pitch: 1, segments: segments, pitchTimes: times)
        XCTAssertEqual(replay?.lowerBound ?? 0, 4.2, accuracy: 0.001)
        XCTAssertEqual(replay?.upperBound ?? 0, 5.4, accuracy: 0.001)
    }

    func testSharePlanAddsReplaysAfterSwings() {
        let segments = [ReelSegment(start: 0, end: 3, fps: 60, pitch: 0), ReelSegment(start: 3, end: 7.5, fps: 240, pitch: 1)]
        let reelPitches = [Pitch(t: 2, outcome: .ball), Pitch(t: 5, outcome: .inPlay, battedBall: .lineDrive, playResult: .single)]
        let plan = ReelPlan.sharePlan(segments: segments, pitches: reelPitches, result: .single, replays: true)
        XCTAssertEqual(plan.map(\.replay), [false, false, true])
        XCTAssertEqual(plan[1].caption, "Pitch 2 · 1-0 · Ball in play · 1B")
        XCTAssertEqual(plan[2].caption, "Pitch 2 · 1-0 · Ball in play · 1B · Replay")
        XCTAssertEqual(QuickPlan.duration(plan), 3 + 4.5 + 4.8, accuracy: 0.001)
        let plain = ReelPlan.sharePlan(segments: segments, pitches: reelPitches, result: .single, replays: false)
        XCTAssertEqual(QuickPlan.duration(plain), 7.5, accuracy: 0.001)
    }

    func testSharePlanJustTheHit() {
        let segments = [ReelSegment(start: 0, end: 3, fps: 60, pitch: 0), ReelSegment(start: 3, end: 7.5, fps: 240, pitch: 1)]
        let reelPitches = [Pitch(t: 2, outcome: .foul), Pitch(t: 5, outcome: .inPlay, battedBall: .lineDrive, playResult: .single)]
        XCTAssertEqual(ReelPlan.hitPitch(reelPitches), 1)
        let plan = ReelPlan.sharePlan(segments: segments, pitches: reelPitches, result: .single, replays: true, only: 1)
        XCTAssertEqual(plan.map(\.replay), [false, true], "the foul's replay is left out")
        XCTAssertEqual(plan.map(\.pitchIndex), [1, 1])
        XCTAssertEqual(plan[0].start, 3)
        XCTAssertEqual(QuickPlan.duration(plan), 4.5 + 4.8, accuracy: 0.001)
        let plain = ReelPlan.sharePlan(segments: segments, pitches: reelPitches, result: .single, replays: false, only: 1)
        XCTAssertEqual(QuickPlan.duration(plain), 4.5, accuracy: 0.001)
    }

    func testShareChoicesFitTheAtBat() {
        let strikeout = [Pitch(t: 1, outcome: .swingingStrike), Pitch(t: 2, outcome: .foul)]
        let single = [Pitch(t: 1, outcome: .ball), Pitch(t: 2, outcome: .inPlay)]

        let full = ShareAvailability(pitches: single, hasFieldView: true)
        XCTAssertEqual(full.choices, [.whole, .hit, .pitches, .fieldView])
        XCTAssertTrue(ShareContent.allCases.allSatisfy(full.offers))

        // No ball in play: "Just the hit" is shown but can't be picked.
        let noHit = ShareAvailability(pitches: strikeout, hasFieldView: true)
        XCTAssertTrue(noHit.choices.contains(.hit))
        XCTAssertFalse(noHit.offers(.hit))

        // No field view: only the whole at-bat and the hit.
        let noField = ShareAvailability(pitches: single, hasFieldView: false)
        XCTAssertEqual(noField.choices, [.whole, .hit])
        XCTAssertTrue(noField.offers(.hit), "the swing alone still makes a clip")

        // A remembered choice that doesn't fit falls back to the whole at-bat, the rest kept.
        let remembered = ShareOptions(content: .fieldView, slowMo: false, titleCard: false, captions: false)
        XCTAssertEqual(remembered.fitted(to: noField), ShareOptions(content: .whole, slowMo: false, titleCard: false, captions: false))
        XCTAssertEqual(ShareOptions(content: .hit).fitted(to: noHit).content, .whole)
        XCTAssertEqual(remembered.fitted(to: full), remembered)
    }

    // MARK: Rendering
    //
    // One generated 240fps recording becomes a reel once per test run; the
    // share tests below build on it. Shares render at EditRendererTests.small.

    private static let reelFixture = Task { () throws -> (url: URL, reel: RenderedReel) in
        let tmp = FileManager.default.temporaryDirectory
        let raw = tmp.appendingPathComponent("reel-raw-\(UUID().uuidString).mov")
        try await EditRendererTests.makeClip(at: raw, seconds: 8, fps: 240,
                                             width: EditRendererTests.small.width, height: EditRendererTests.small.height)
        defer { try? FileManager.default.removeItem(at: raw) }
        let out = tmp.appendingPathComponent("reel-\(UUID().uuidString).mp4")
        let pitches = [
            Pitch(t: 2.5, outcome: .ball),
            Pitch(t: 5.5, outcome: .inPlay, battedBall: .lineDrive, playResult: .single),
        ]
        let reel = try await ReelRenderer.render(raw: raw, rotation: 180, pitches: pitches, timings: .standard, to: out)
        return (out, reel)
    }

    private static let fieldFixture = Task { () throws -> URL in
        let field = FileManager.default.temporaryDirectory.appendingPathComponent("reel-field-\(UUID().uuidString).mov")
        try await EditRendererTests.makeClip(at: field, seconds: 4, fps: 30, width: 320, height: 180, level: 200)
        return field
    }

    /// A share of the fixture reel: card, both pitches, all options at their defaults.
    private func shareRequest() async throws -> ShareRequest {
        let (out, reel) = try await Self.reelFixture.value
        let card = TitleCard.make(number: 2, result: .single, game: "vs Kabuki", playedOn: "2026-10-11")
        let reelPitches = [Pitch(t: 2, outcome: .ball), Pitch(t: 5, outcome: .inPlay, battedBall: .lineDrive, playResult: .single)]
        return ShareRequest(atBatID: UUID(), reel: out, segments: reel.segments, pitches: reelPitches, result: .single,
                            card: card, options: ShareOptions(), reelKey: out.lastPathComponent, timings: .standard)
    }

    /// Real speed only, with the fixture field view (1–3s of it) running on after.
    private func fieldShareRequest() async throws -> ShareRequest {
        var plain = try await shareRequest()
        plain.options.slowMo = false
        plain.fieldView = (try await Self.fieldFixture.value, 1, 3, "g/a/gamechanger.mov")
        return plain
    }

    private func duration(_ url: URL) async throws -> Double {
        try await AVURLAsset(url: url).load(.duration).seconds
    }

    func testBuildsAReel() async throws {
        let (out, reel) = try await Self.reelFixture.value
        XCTAssertEqual(reel.duration, 7.5, accuracy: 0.01)
        XCTAssertEqual(reel.pitchTimes[0], 2, accuracy: 0.01)
        XCTAssertEqual(reel.pitchTimes[1], 5, accuracy: 0.01)
        XCTAssertEqual(reel.segments.map(\.fps), [60, 240])

        // HEVC, the recording's size, with sound, and the take thinned to 60fps.
        let asset = AVURLAsset(url: out)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let video = try XCTUnwrap(videoTracks.first)
        let size = try await video.load(.naturalSize)
        XCTAssertEqual(size, CGSize(width: EditRendererTests.small.width, height: EditRendererTests.small.height))
        let formats = try await video.load(.formatDescriptions)
        let format = try XCTUnwrap(formats.first)
        XCTAssertEqual(CMFormatDescriptionGetMediaSubType(format), kCMVideoCodecType_HEVC)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(audio.count, 1)
        let times = try Self.frameTimes(asset: asset, track: video)
        let take = times.filter { $0 < 3 }.count
        let swing = times.filter { $0 >= 3 }.count
        XCTAssertEqual(Double(take), 3 * 60, accuracy: 3)
        XCTAssertEqual(Double(swing), 4.5 * 240, accuracy: 3)
    }

    func testSharesWithReplays() async throws {
        renderSmall()
        // Card, both pitches, the in-play replay at ¼.
        let request = try await shareRequest()
        let shared = try await ShareRenderer.render(request)
        let sharedAsset = AVURLAsset(url: shared)
        let replayStart = 2 + 3 + 4.5
        let sharedDuration = try await duration(shared)
        XCTAssertEqual(sharedDuration, replayStart + 4.8, accuracy: 0.1)
        let gen = AVAssetImageGenerator(asset: sharedAsset)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        let a = try await EditRendererTests.frameNumber(gen, at: replayStart + 1.0)
        let b = try await EditRendererTests.frameNumber(gen, at: replayStart + 1.0 + 1.0 / 60)
        XCTAssertEqual((b - a + 32) % 32, 1, "the replay should step one 240fps frame per output frame (got \(a)→\(b))")
        // Asked again, it's the same file.
        let again = try await ShareRenderer.render(request)
        XCTAssertEqual(again, shared)
    }

    func testShareContentChoices() async throws {
        renderSmall()
        let plain = try await fieldShareRequest()
        let withField = try await ShareRenderer.render(plain)
        let fieldDuration = try await duration(withField)
        XCTAssertEqual(fieldDuration, 2 + 7.5 + 2, accuracy: 0.1)

        // Just the hit, no title card: the in-play window, its replay, then the field view.
        var hit = plain
        hit.options = ShareOptions(content: .hit, slowMo: true, titleCard: false, captions: false)
        let hitDuration = try await duration(try await ShareRenderer.render(hit))
        XCTAssertEqual(hitDuration, 4.5 + 4.8 + 2, accuracy: 0.1)

        // Pitches only drops the field view.
        var closeOnly = plain
        closeOnly.options.content = .pitches
        let closeDuration = try await duration(try await ShareRenderer.render(closeOnly))
        XCTAssertEqual(closeDuration, 2 + 7.5, accuracy: 0.1)

        // GameChanger only, with and without its card.
        var gcOnly = plain
        gcOnly.options.content = .fieldView
        let gcDuration = try await duration(try await ShareRenderer.render(gcOnly))
        XCTAssertEqual(gcDuration, 2 + 2, accuracy: 0.1)
        gcOnly.options.titleCard = false
        let bareDuration = try await duration(try await ShareRenderer.render(gcOnly))
        XCTAssertEqual(bareDuration, 2, accuracy: 0.1)
    }

    func testVerticalShares() async throws {
        renderSmall()
        let plain = try await fieldShareRequest()
        // The hit, cropped, the field view cropped too.
        var tall = plain
        tall.options = ShareOptions(content: .hit, slowMo: true, titleCard: false, captions: false)
        tall.options.vertical = true
        tall.options.cropFieldView = true
        tall.framing = Framing(closeup: 0.2, fieldView: 0.8)
        let tallFile = try await ShareRenderer.render(tall)
        let tallDuration = try await duration(tallFile)
        XCTAssertEqual(tallDuration, 4.5 + 4.8 + 2, accuracy: 0.1)
        let tallTracks = try await AVURLAsset(url: tallFile).loadTracks(withMediaType: .video)
        let tallSize = try await XCTUnwrap(tallTracks.first).load(.naturalSize)
        XCTAssertEqual(tallSize, VideoShape.vertical.size)
        // The field view alone, whole over its blurred fill.
        var tallField = plain
        tallField.options.content = .fieldView
        tallField.options.vertical = true
        let tallFieldTracks = try await AVURLAsset(url: try await ShareRenderer.render(tallField)).loadTracks(withMediaType: .video)
        let tallFieldSize = try await XCTUnwrap(tallFieldTracks.first).load(.naturalSize)
        XCTAssertEqual(tallFieldSize, VideoShape.vertical.size)
        // A different framing is a different video.
        var moved = tall
        moved.framing.closeup = 0.6
        let movedFile = try await ShareRenderer.render(moved)
        XCTAssertNotEqual(movedFile, tallFile)
    }

    /// Presentation times of every frame in a track, without decoding.
    static func frameTimes(asset: AVAsset, track: AVAssetTrack) throws -> [Double] {
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        reader.add(output)
        reader.startReading()
        var times: [Double] = []
        while let sample = output.copyNextSampleBuffer() {
            if CMSampleBufferGetNumSamples(sample) > 0 { times.append(CMSampleBufferGetPresentationTimeStamp(sample).seconds) }
        }
        return times
    }
}
