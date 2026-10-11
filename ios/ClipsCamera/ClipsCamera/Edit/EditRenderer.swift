import AVFoundation
import CoreImage
import UIKit

// Turns a raw 240fps recording plus its pitch log into the finished at-bat:
// the quick-version plan laid out on a composition (replays slowed by
// stretching time, so a ¼-speed replay shows every captured frame at 60fps),
// the title card (laid out like the website's exports) and captions drawn by a
// small Core Image compositor, then
// re-encoded as 1080p60 H.264 with a keyframe every half second so Clips can
// scrub and frame-step it instantly.

/// The card the video opens on, as the website's exports have it:
/// "AB 2 · Single" big, "vs Kabuki · Sat, Oct 11, 2026" beneath.
struct TitleCard: Equatable {
    var title: String
    var subtitle: String

    static func make(number: Int?, result: AtBatResult?, game: String?, playedOn: String?) -> TitleCard {
        var title = number.map { "AB \($0)" } ?? "At-bat"
        if let result { title += " · \(result.name)" }
        let parts = [game, playedOn.map(formatGameDate)].compactMap { $0 }.filter { !$0.isEmpty }
        return TitleCard(title: title, subtitle: parts.joined(separator: " · "))
    }

    /// "2026-10-11" → "Sat, Oct 11, 2026", the website's long game date.
    static func formatGameDate(_ ymd: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ymd) else { return ymd }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US")
        out.dateFormat = "EEE, MMM d, yyyy"
        return out.string(from: d)
    }
}

struct RenderedEdit {
    var url: URL
    var duration: Double
    /// Where each pitch (sorted by time) lands in the finished video.
    var pitchTimes: [Double]
    var bytes: Int64
    var renderSeconds: Double
}

enum RenderError: LocalizedError {
    case noVideo, failed(String)
    var errorDescription: String? {
        switch self {
        case .noVideo: "The recording has no video."
        case .failed(let m): "Couldn't build the edit: \(m)"
        }
    }
}

enum EditRenderer {
    static let size = CGSize(width: 1920, height: 1080)
    static let fps: Int32 = 60
    private static let timescale: CMTimeScale = 24_000 // divides evenly by 240 and 60

    static func render(
        raw: URL,
        rotation: Int,
        pitches: [Pitch],
        result: AtBatResult?,
        card: TitleCard?,
        timings: EditTimings,
        to out: URL
    ) async throws -> RenderedEdit {
        let started = Date()
        let asset = AVURLAsset(url: raw)
        let duration = try await asset.load(.duration).seconds
        guard let sourceVideo = try await asset.loadTracks(withMediaType: .video).first else { throw RenderError.noVideo }
        let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first

        let plan = QuickPlan.build(pitches: pitches, duration: duration, result: result, timings: timings)
        guard !plan.isEmpty else { throw RenderError.failed("no pitches to show") }

        // Lay the plan out on a composition.
        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError.failed("composition")
        }
        let audio = sourceAudio == nil ? nil : composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        var instructions: [CaptionInstruction] = []
        var cursor = CMTime.zero
        if let card, timings.titleCard > 0 {
            // The card stands on one source frame stretched out (a track can't
            // start with nothing); the compositor ignores it and draws the card.
            let range = CMTimeRange(start: .zero, duration: time(timings.titleCard))
            let oneFrame = CMTimeRange(start: .zero, duration: CMTime(value: 1, timescale: 240))
            try video.insertTimeRange(oneFrame, of: sourceVideo, at: .zero)
            video.scaleTimeRange(CMTimeRange(start: .zero, duration: oneFrame.duration), toDuration: range.duration)
            audio?.insertEmptyTimeRange(range)
            instructions.append(CaptionInstruction(
                timeRange: range, sourceTrackID: nil, rotate180: false,
                overlay: CaptionArt.titleCard(card)
            ))
            cursor = range.duration
        }
        let cardLength = cursor.seconds
        for seg in plan {
            let range = CMTimeRange(start: time(seg.start), end: time(seg.end))
            let played = time(seg.playLength)
            try video.insertTimeRange(range, of: sourceVideo, at: cursor)
            if seg.rate != 1 {
                video.scaleTimeRange(CMTimeRange(start: cursor, duration: range.duration), toDuration: played)
            }
            if let audio, let sourceAudio {
                if seg.muted || seg.rate != 1 {
                    audio.insertEmptyTimeRange(CMTimeRange(start: cursor, duration: played))
                } else {
                    try audio.insertTimeRange(range, of: sourceAudio, at: cursor)
                }
            }
            instructions.append(CaptionInstruction(
                timeRange: CMTimeRange(start: cursor, duration: played),
                sourceTrackID: video.trackID,
                rotate180: rotation == 180,
                overlay: CaptionArt.caption(seg.caption, replay: seg.replay)
            ))
            cursor = CMTimeAdd(cursor, played)
        }

        var config = AVVideoComposition.Configuration()
        config.customVideoCompositorClass = CaptionCompositor.self
        config.frameDuration = CMTime(value: 1, timescale: fps)
        config.renderSize = size
        config.instructions = instructions
        let videoComposition = AVVideoComposition(configuration: config)

        try? FileManager.default.removeItem(at: out)
        try await encode(composition: composition, video: video, audio: audio, videoComposition: videoComposition, to: out)

        let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int64) ?? 0
        return RenderedEdit(
            url: out,
            duration: cursor.seconds,
            pitchTimes: QuickPlan.editTimes(pitches: pitches, plan: plan).map { $0 + cardLength },
            bytes: bytes,
            renderSeconds: Date().timeIntervalSince(started)
        )
    }

    private static func time(_ seconds: Double) -> CMTime {
        CMTime(seconds: seconds, preferredTimescale: timescale)
    }

    // MARK: Encoding

    private static func encode(
        composition: AVComposition,
        video: AVCompositionTrack,
        audio: AVCompositionTrack?,
        videoComposition: AVVideoComposition,
        to out: URL
    ) async throws {
        let reader = try AVAssetReader(asset: composition)
        let videoOut = AVAssetReaderVideoCompositionOutput(
            videoTracks: [video],
            videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        )
        videoOut.videoComposition = videoComposition
        videoOut.alwaysCopiesSampleData = false
        guard reader.canAdd(videoOut) else { throw RenderError.failed("reader video") }
        reader.add(videoOut)

        var audioOut: AVAssetReaderAudioMixOutput?
        if let audio {
            let o = AVAssetReaderAudioMixOutput(audioTracks: [audio], audioSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 48_000,
                AVNumberOfChannelsKey: 2,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ])
            if reader.canAdd(o) { reader.add(o); audioOut = o }
        }

        let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(size.width),
            AVVideoHeightKey: Int(size.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 12_000_000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: Int(fps),
                AVVideoMaxKeyFrameIntervalKey: Int(fps) / 2,
                AVVideoMaxKeyFrameIntervalDurationKey: 0.5,
                AVVideoAllowFrameReorderingKey: false,
            ],
        ])
        videoIn.expectsMediaDataInRealTime = false
        guard writer.canAdd(videoIn) else { throw RenderError.failed("writer video") }
        writer.add(videoIn)

        var audioIn: AVAssetWriterInput?
        if audioOut != nil {
            let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48_000,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 128_000,
            ])
            if writer.canAdd(i) { writer.add(i); audioIn = i }
        }

        guard reader.startReading() else { throw RenderError.failed(reader.error?.localizedDescription ?? "reader didn't start") }
        guard writer.startWriting() else { throw RenderError.failed(writer.error?.localizedDescription ?? "writer didn't start") }
        writer.startSession(atSourceTime: .zero)

        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            let group = DispatchGroup()
            pump(videoOut, into: videoIn, reader: reader, group: group, label: "render.video")
            if let audioOut, let audioIn {
                pump(audioOut, into: audioIn, reader: reader, group: group, label: "render.audio")
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

    /// Copy samples from a reader output into a writer input until either runs out.
    private static func pump(_ output: AVAssetReaderOutput, into input: AVAssetWriterInput, reader: AVAssetReader, group: DispatchGroup, label: String) {
        group.enter()
        var finished = false
        input.requestMediaDataWhenReady(on: DispatchQueue(label: label)) {
            guard !finished else { return }
            while input.isReadyForMoreMediaData {
                guard reader.status == .reading, let sample = output.copyNextSampleBuffer() else {
                    finished = true
                    input.markAsFinished()
                    group.leave()
                    return
                }
                if !input.append(sample) {
                    finished = true
                    reader.cancelReading()
                    input.markAsFinished()
                    group.leave()
                    return
                }
            }
        }
    }
}

// MARK: - Compositor

/// One stretch of the finished video: which source frames to show (none for
/// the result card), and the art drawn over them.
final class CaptionInstruction: NSObject, AVVideoCompositionInstructionProtocol {
    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    nonisolated(unsafe) let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID = kCMPersistentTrackID_Invalid

    let sourceTrackID: CMPersistentTrackID?
    let rotate180: Bool
    let overlay: CIImage?

    init(timeRange: CMTimeRange, sourceTrackID: CMPersistentTrackID?, rotate180: Bool, overlay: CIImage?) {
        self.timeRange = timeRange
        self.sourceTrackID = sourceTrackID
        self.requiredSourceTrackIDs = sourceTrackID.map { [NSNumber(value: $0)] } ?? []
        self.rotate180 = rotate180
        self.overlay = overlay
    }
}

final class CaptionCompositor: NSObject, AVVideoCompositing {
    private let context = CIContext(options: [.cacheIntermediates: false])

    var sourcePixelBufferAttributes: [String: any Sendable]? {
        [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    }

    var requiredPixelBufferAttributesForRenderContext: [String: any Sendable] {
        [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    }

    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

    func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        guard let instruction = request.videoCompositionInstruction as? CaptionInstruction,
              let output = request.renderContext.newPixelBuffer() else {
            request.finish(with: RenderError.failed("compositor setup"))
            return
        }
        let frame = CGRect(origin: .zero, size: EditRenderer.size)
        var image = CIImage(color: .black).cropped(to: frame)
        if let id = instruction.sourceTrackID, let source = request.sourceFrame(byTrackID: id) {
            var src = CIImage(cvPixelBuffer: source)
            let e = src.extent
            if e.size != frame.size {
                src = src.transformed(by: CGAffineTransform(scaleX: frame.width / e.width, y: frame.height / e.height))
            }
            if instruction.rotate180 {
                src = src.transformed(by: CGAffineTransform(translationX: frame.width, y: frame.height).rotated(by: .pi))
            }
            image = src.composited(over: image)
        }
        if let overlay = instruction.overlay {
            image = overlay.composited(over: image)
        }
        context.render(image, to: output)
        request.finish(withComposedVideoFrame: output)
    }

    func cancelAllPendingVideoCompositionRequests() {}
}

// MARK: - Art

enum CaptionArt {
    /// The caption pill, bottom-left, as a full-frame transparent overlay;
    /// orange during a replay.
    static func caption(_ text: String, replay: Bool) -> CIImage? {
        let font = UIFont.systemFont(ofSize: 40, weight: .semibold)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
        let textSize = (text as NSString).size(withAttributes: attrs)
        let pad = CGSize(width: 28, height: 14)
        let pill = CGRect(x: 48, y: 0, width: textSize.width + pad.width * 2, height: textSize.height + pad.height * 2)
        let image = draw(CGSize(width: pill.maxX + 8, height: pill.height)) { _ in
            let bg = replay ? UIColor(red: 0.85, green: 0.55, blue: 0.0, alpha: 0.85) : UIColor(white: 0, alpha: 0.6)
            bg.setFill()
            UIBezierPath(roundedRect: pill, cornerRadius: pill.height / 2).fill()
            (text as NSString).draw(at: CGPoint(x: pill.minX + pad.width, y: pad.height), withAttributes: attrs)
        }
        // CIImage's origin is bottom-left: lift the pill off the bottom edge.
        return image.map { CIImage(cgImage: $0).transformed(by: CGAffineTransform(translationX: 0, y: 48)) }
    }

    /// The opening card, laid out like the website's exports (same sizes and
    /// spacing) so both kinds of clip open the same way.
    static func titleCard(_ card: TitleCard) -> CIImage? {
        let size = EditRenderer.size
        let titleAttrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 110), .foregroundColor: UIColor.white]
        let subAttrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 52), .foregroundColor: UIColor(white: 1, alpha: 170 / 255)]
        let image = draw(size) { _ in
            UIColor.black.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            let t = (card.title as NSString).size(withAttributes: titleAttrs)
            let s = card.subtitle.isEmpty ? .zero : (card.subtitle as NSString).size(withAttributes: subAttrs)
            let gap: CGFloat = card.subtitle.isEmpty ? 0 : 36
            let top = (size.height - t.height - gap - s.height) / 2
            (card.title as NSString).draw(at: CGPoint(x: (size.width - t.width) / 2, y: top), withAttributes: titleAttrs)
            if !card.subtitle.isEmpty {
                (card.subtitle as NSString).draw(at: CGPoint(x: (size.width - s.width) / 2, y: top + t.height + gap), withAttributes: subAttrs)
            }
        }
        return image.map { CIImage(cgImage: $0) }
    }

    private static func draw(_ size: CGSize, _ body: (UIGraphicsImageRendererContext) -> Void) -> CGImage? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format).image(actions: body).cgImage
    }
}
