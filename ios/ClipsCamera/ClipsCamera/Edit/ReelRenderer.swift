import AVFoundation
import VideoToolbox

// Cuts a raw 240fps recording down to its pitch reel (see ReelPlan): the
// windows laid end to end at real speed, swings at every captured frame and
// takes thinned to 60fps, turned right way up, with the sound. Written as
// HEVC with a keyframe every half second so the player can scrub and step
// frames quickly.

struct RenderedReel {
    var url: URL
    var duration: Double
    var segments: [ReelSegment]
    /// Where each pitch (sorted by time) lands in the reel.
    var pitchTimes: [Double]
    var bytes: Int64
    var renderSeconds: Double
}

enum ReelRenderer {
    static let bitRate = 30_000_000

    static func render(raw: URL, rotation: Int, pitches: [Pitch], timings: EditTimings, to out: URL) async throws -> RenderedReel {
        let started = Date()
        let asset = AVURLAsset(url: raw)
        let duration = try await asset.load(.duration).seconds
        guard let sourceVideo = try await asset.loadTracks(withMediaType: .video).first else { throw RenderError.noVideo }
        let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first
        let size = try await sourceVideo.load(.naturalSize)

        let cuts = ReelPlan.cuts(pitches: pitches, duration: duration, timings: timings)
        guard !cuts.isEmpty else { throw RenderError.failed("no pitches to show") }

        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError.failed("composition")
        }
        let audio = sourceAudio == nil ? nil : composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        var cursor = CMTime.zero
        for cut in cuts {
            let range = CMTimeRange(start: EditRenderer.time(cut.sourceStart), end: EditRenderer.time(cut.sourceEnd))
            try video.insertTimeRange(range, of: sourceVideo, at: cursor)
            if let audio, let sourceAudio { try audio.insertTimeRange(range, of: sourceAudio, at: cursor) }
            cursor = CMTimeAdd(cursor, range.duration)
        }
        // Segment times as laid down, to the tick.
        var segments: [ReelSegment] = []
        var at = 0.0
        for cut in cuts {
            let length = EditRenderer.time(cut.sourceEnd).seconds - EditRenderer.time(cut.sourceStart).seconds
            var s = cut.segment
            s.start = at
            s.end = at + length
            segments.append(s)
            at += length
        }

        try? FileManager.default.removeItem(at: out)
        try await encode(composition: composition, video: video, audio: audio, size: size,
                         rotate180: rotation == 180, segments: segments, to: out)

        let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int64) ?? 0
        return RenderedReel(
            url: out, duration: cursor.seconds, segments: segments,
            pitchTimes: ReelPlan.pitchTimes(pitches: pitches, cuts: cuts),
            bytes: bytes, renderSeconds: Date().timeIntervalSince(started)
        )
    }

    private static func encode(
        composition: AVComposition, video: AVCompositionTrack, audio: AVCompositionTrack?, size: CGSize,
        rotate180: Bool, segments: [ReelSegment], to out: URL
    ) async throws {
        let pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        let reader = try AVAssetReader(asset: composition)
        let videoOut = AVAssetReaderTrackOutput(track: video, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: pixelFormat])
        videoOut.alwaysCopiesSampleData = false
        guard reader.canAdd(videoOut) else { throw RenderError.failed("reader video") }
        reader.add(videoOut)
        var audioOut: AVAssetReaderAudioMixOutput?
        if let audio {
            let o = AVAssetReaderAudioMixOutput(audioTracks: [audio], audioSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2,
                AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ])
            if reader.canAdd(o) { reader.add(o); audioOut = o }
        }

        let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        // Older app builds skip a title card at the start of what they play; there's none.
        writer.metadata = [EditRenderer.IntroMark.item(seconds: 0)]
        let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: Int(size.width),
            AVVideoHeightKey: Int(size.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitRate,
                AVVideoExpectedSourceFrameRateKey: ReelPlan.fullRate,
                AVVideoMaxKeyFrameIntervalDurationKey: 0.5,
                AVVideoAllowFrameReorderingKey: false,
            ],
        ])
        videoIn.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoIn, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: pixelFormat,
            kCVPixelBufferWidthKey as String: Int(size.width),
            kCVPixelBufferHeightKey as String: Int(size.height),
        ])
        guard writer.canAdd(videoIn) else { throw RenderError.failed("writer video") }
        writer.add(videoIn)
        var audioIn: AVAssetWriterInput?
        if audioOut != nil {
            let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128_000,
            ])
            if writer.canAdd(i) { writer.add(i); audioIn = i }
        }

        var rotator: VTPixelRotationSession?
        if rotate180 {
            VTPixelRotationSessionCreate(nil, &rotator)
            if let rotator { VTSessionSetProperty(rotator, key: kVTPixelRotationPropertyKey_Rotation, value: kVTRotation_180) }
        }
        defer { if let rotator { VTPixelRotationSessionInvalidate(rotator) } }

        guard reader.startReading() else { throw RenderError.failed(reader.error?.localizedDescription ?? "reader didn't start") }
        guard writer.startWriting() else { throw RenderError.failed(writer.error?.localizedDescription ?? "writer didn't start") }
        writer.startSession(atSourceTime: .zero)

        let thinning = FrameThinning(segments: segments)
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            let group = DispatchGroup()
            group.enter()
            var finished = false
            videoIn.requestMediaDataWhenReady(on: DispatchQueue(label: "reel.video")) {
                guard !finished else { return }
                func finish() {
                    finished = true
                    videoIn.markAsFinished()
                    group.leave()
                }
                while videoIn.isReadyForMoreMediaData {
                    guard reader.status == .reading, let sample = videoOut.copyNextSampleBuffer() else { return finish() }
                    let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                    guard thinning.keep(pts.seconds), var frame = CMSampleBufferGetImageBuffer(sample) else { continue }
                    if let rotator, let pool = adaptor.pixelBufferPool {
                        var turned: CVPixelBuffer?
                        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &turned)
                        if let turned, VTPixelRotationSessionRotateImage(rotator, frame, turned) == noErr { frame = turned }
                    }
                    if !adaptor.append(frame, withPresentationTime: pts) {
                        reader.cancelReading()
                        return finish()
                    }
                }
            }
            if let audioOut, let audioIn {
                EditRenderer.pump(audioOut, into: audioIn, reader: reader, group: group, label: "reel.audio")
            }
            group.notify(queue: .global()) { done.resume() }
        }

        if reader.status == .failed {
            writer.cancelWriting()
            throw RenderError.failed(reader.error?.localizedDescription ?? "reading failed")
        }
        await writer.finishWriting()
        if writer.status != .completed {
            throw RenderError.failed(writer.error?.localizedDescription ?? "writing failed")
        }
    }
}

/// Drops frames in take windows down to one per 1/60s; swing windows keep all.
final class FrameThinning: @unchecked Sendable {
    private let segments: [ReelSegment]
    private var lastSlot: (segment: Int, slot: Int)?

    init(segments: [ReelSegment]) { self.segments = segments }

    func keep(_ t: Double) -> Bool {
        guard let k = segments.firstIndex(where: { t >= $0.start - 0.0005 && t < $0.end }) ?? (segments.isEmpty ? nil : segments.count - 1) else { return true }
        let seg = segments[k]
        guard seg.fps < ReelPlan.fullRate else { return true }
        let slot = Int(((t - seg.start) * Double(seg.fps) + 0.001).rounded(.down))
        if let last = lastSlot, last.segment == k, last.slot == slot { return false }
        lastSlot = (k, slot)
        return true
    }
}
