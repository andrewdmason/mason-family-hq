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
        let card = TitleCard.make(number: 2, result: .single, game: "vs Kabuki", playedOn: "2026-10-11")
        XCTAssertEqual(card, TitleCard(title: "AB 2 · Single", subtitle: "vs Kabuki · Sun, Oct 11, 2026"))
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

    static func makeClip(at url: URL, seconds: Double, fps: Int32) async throws {
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: 1920,
            AVVideoHeightKey: 1080,
        ])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vIn, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: 1920,
            kCVPixelBufferHeightKey as String: 1080,
        ])
        writer.add(vIn)
        let aIn = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64_000,
        ])
        writer.add(aIn)
        XCTAssertTrue(writer.startWriting())
        writer.startSession(atSourceTime: .zero)

        // Video and sound are appended interleaved — the writer stalls one
        // input while it waits for the other to catch up.
        let frames = Int(seconds * Double(fps))
        let rate = 48_000
        let totalSamples = Int(seconds * Double(rate))
        var written = 0
        for i in 0..<frames {
            let dueSamples = min(totalSamples, Int(Double(i + 1) / Double(fps) * Double(rate)))
            while written < dueSamples {
                while !aIn.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 1_000_000) }
                let n = min(1024, dueSamples - written)
                aIn.append(try pcmBuffer(start: written, count: n, rate: rate))
                written += n
            }
            while !vIn.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 1_000_000) }
            var pb: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
            let buffer = pb!
            CVPixelBufferLockBaseAddress(buffer, [])
            let base = CVPixelBufferGetBaseAddress(buffer)!
            // The whole frame is one grey level: a coarse 32-step code of the
            // frame index, coarse enough to survive compression.
            let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
            memset(base, Int32((i % 32) * 8), bytesPerRow * 1080)
            CVPixelBufferUnlockBaseAddress(buffer, [])
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: fps))
        }
        vIn.markAsFinished()
        aIn.markAsFinished()
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
