import AVFoundation
import CoreImage
import XCTest
@testable import ClipsCamera

/// Builds a real edit from a generated 240fps clip with sound, so the whole
/// render path (composition, slow-motion, compositor, encoder) runs without a
/// camera.
final class EditRendererTests: XCTestCase {
    func testRendersPlanFromA240fpsRecording() async throws {
        let raw = FileManager.default.temporaryDirectory.appendingPathComponent("synthetic-\(UUID().uuidString).mov")
        try await Self.makeClip(at: raw, seconds: 8, fps: 240)
        defer { try? FileManager.default.removeItem(at: raw) }

        let pitches = [
            Pitch(t: 2.5, outcome: .ball),
            Pitch(t: 5.5, outcome: .inPlay, battedBall: .lineDrive, playResult: .single),
        ]
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("edit-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: out) }
        let card = TitleCard.make(kid: "Sebastian Mason", result: .single, game: "Kabuki", playedOn: "2026-10-11")
        XCTAssertEqual(card, TitleCard(name: "Sebastian Mason", result: "Single", meta: "vs Kabuki · Sun, Oct 11, 2026"))
        let edit = try await EditRenderer.render(raw: raw, rotation: 180, pitches: pitches, result: .single, card: card, timings: .standard, to: out)

        // The 2s title card, then the ball: 0.5→3.5 (3s), in play: 3.5→8 (4.5s,
        // clipped to the clip's end), then its replay 4.7→5.9 at ¼ (4.8s).
        let expected = 2 + 3 + 4.5 + 4.8
        XCTAssertEqual(edit.duration, expected, accuracy: 0.05)
        XCTAssertEqual(edit.pitchTimes[0], 2 + 2, accuracy: 0.01)
        XCTAssertEqual(edit.pitchTimes[1], 2 + 3 + 2, accuracy: 0.01)
        XCTAssertGreaterThan(edit.bytes, 0)

        let asset = AVURLAsset(url: out)
        let duration = try await asset.load(.duration).seconds
        XCTAssertEqual(duration, expected, accuracy: 0.1)
        // The app's player skips the card, so the file says how long it is.
        let intro = await EditRenderer.IntroMark.seconds(in: asset)
        XCTAssertEqual(try XCTUnwrap(intro), 2, accuracy: 0.001)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let video = try XCTUnwrap(videoTracks.first)
        let size = try await video.load(.naturalSize)
        XCTAssertEqual(size, CGSize(width: 1920, height: 1080))
        let fps = try await video.load(.nominalFrameRate)
        XCTAssertEqual(fps, 60, accuracy: 1)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(audio.count, 1)

        // Every replay frame is a distinct source frame: within the ¼-speed
        // replay, consecutive output frames show consecutive 240fps frames.
        let gen = AVAssetImageGenerator(asset: asset)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        let replayStart = 2 + 3 + 4.5
        let a = try await Self.frameNumber(gen, at: replayStart + 1.0)
        let b = try await Self.frameNumber(gen, at: replayStart + 1.0 + 1.0 / 60)
        XCTAssertEqual(b - a, 1, "¼-speed replay should step one 240fps frame per 60fps frame (got \(a)→\(b))")

        // Snapshots for eyeballing captions and the card, when asked for.
        if let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? (FileManager.default.fileExists(atPath: "/tmp/clipscamera-snapshots") ? "/tmp/clipscamera-snapshots" : nil) {
            for (name, t) in [("card", 0.5), ("pitch", 3.0), ("replay", replayStart + 0.5)] {
                let (image, _) = try await gen.image(at: CMTime(seconds: t, preferredTimescale: 600))
                let url = URL(fileURLWithPath: dir).appendingPathComponent("\(name).png")
                let ctx = CIContext()
                try ctx.writePNGRepresentation(of: CIImage(cgImage: image), to: url, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
            }
        }
    }

    // MARK: Synthetic clip: each frame's brightness encodes its index.

    static func makeClip(at url: URL, seconds: Double, fps: Int32, width: Int = 1920, height: Int = 1080, level: Int? = nil) async throws {
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vIn, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ])
        writer.add(vIn)
        let aIn = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64_000,
        ])
        writer.add(aIn)
        XCTAssertTrue(writer.startWriting())
        writer.startSession(atSourceTime: .zero)

        // Picture and sound are each fed whenever the writer asks for more,
        // so neither waits on the other while it interleaves them.
        let frames = Int(seconds * Double(fps))
        let rate = 48_000
        let totalSamples = Int(seconds * Double(rate))
        let pool = adaptor.pixelBufferPool!
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            let group = DispatchGroup()
            group.enter()
            var frame = 0
            vIn.requestMediaDataWhenReady(on: DispatchQueue(label: "clip.video")) {
                while vIn.isReadyForMoreMediaData {
                    guard frame < frames else {
                        if frame == frames { frame += 1; vIn.markAsFinished(); group.leave() }
                        return
                    }
                    var pb: CVPixelBuffer?
                    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
                    let buffer = pb!
                    CVPixelBufferLockBaseAddress(buffer, [])
                    // The whole frame is one grey level: a coarse 32-step code
                    // of the frame index, coarse enough to survive compression
                    // (or a fixed level, to tell clips apart).
                    memset(CVPixelBufferGetBaseAddress(buffer)!, Int32(level ?? (frame % 32) * 8), CVPixelBufferGetBytesPerRow(buffer) * height)
                    CVPixelBufferUnlockBaseAddress(buffer, [])
                    adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps))
                    frame += 1
                }
            }
            group.enter()
            var written = 0
            aIn.requestMediaDataWhenReady(on: DispatchQueue(label: "clip.audio")) {
                while aIn.isReadyForMoreMediaData {
                    guard written < totalSamples else {
                        if written == totalSamples { written += 1; aIn.markAsFinished(); group.leave() }
                        return
                    }
                    let n = min(1024, totalSamples - written)
                    aIn.append(try! pcmBuffer(start: written, count: n, rate: rate))
                    written += n
                }
            }
            group.notify(queue: .global()) { done.resume() }
        }
        await writer.finishWriting()
        XCTAssertEqual(writer.status, .completed, writer.error?.localizedDescription ?? "")
    }

    private static func pcmBuffer(start: Int, count: Int, rate: Int) throws -> CMSampleBuffer {
        var asbd = AudioStreamBasicDescription(
            mSampleRate: Double(rate), mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
            mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
        var format: CMAudioFormatDescription?
        CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format)
        var samples = [Int16](repeating: 0, count: count)
        for k in 0..<count { samples[k] = Int16(2000 * sin(Double(start + k) * 2 * .pi * 440 / Double(rate))) }
        var block: CMBlockBuffer?
        let bytes = count * 2
        CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: 0, blockBufferOut: &block)
        _ = samples.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: bytes) }
        var sample: CMSampleBuffer?
        CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block!, formatDescription: format!, sampleCount: count, presentationTimeStamp: CMTime(value: CMTimeValue(start), timescale: CMTimeScale(rate)), packetDescriptions: nil, sampleBufferOut: &sample)
        return sample!
    }

    /// Reads back the coarse frame code (0–31) from a frame's brightness.
    /// The replay is drawn rotated 180° but the frame is a flat grey, so
    /// rotation doesn't matter; sample the middle, away from the caption.
    static func frameNumber(_ gen: AVAssetImageGenerator, at seconds: Double) async throws -> Int {
        let (image, _) = try await gen.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
        let ci = CIImage(cgImage: image)
        var pixel = [UInt8](repeating: 0, count: 4)
        let ctx = CIContext()
        ctx.render(ci, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: 960, y: 700, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        return Int((Double(pixel[0]) / 8).rounded())
    }
}
