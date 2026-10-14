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

/// The finished video's shape: landscape as filmed, or vertical for Reels
/// and Stories (the picture cropped to fill it).
enum VideoShape: String, Codable {
    case landscape, vertical

    var size: CGSize { self == .landscape ? EditRenderer.size : CGSize(width: 1080, height: 1920) }

    /// The part of a picture of `extent` that fills a frame of this shape:
    /// full height (or full width, for a picture narrower than the frame),
    /// slid sideways to sit around `centerX` (a fraction of the width) and
    /// kept inside the picture.
    static func fillBox(extent e: CGRect, frame: CGSize, centerX: Double) -> CGRect {
        let aspect = frame.width / frame.height
        if e.width / e.height <= aspect {
            let h = e.width / aspect
            return CGRect(x: e.minX, y: e.minY + (e.height - h) / 2, width: e.width, height: h)
        }
        let w = e.height * aspect
        let x = min(max(e.minX, e.minX + CGFloat(centerX) * e.width - w / 2), e.maxX - w)
        return CGRect(x: x, y: e.minY, width: w, height: e.height)
    }

    /// How wide a vertical crop is, as a fraction of a picture this shape.
    static func verticalWidth(aspect: CGFloat) -> CGFloat {
        min(1, (9.0 / 16.0) / aspect)
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
        replayCrop: CGRect? = nil,
        to out: URL
    ) async throws -> RenderedEdit {
        let started = Date()
        let duration = try await AVURLAsset(url: raw).load(.duration).seconds
        let plan = QuickPlan.build(pitches: pitches, duration: duration, result: result, timings: timings)
        let rendered = try await render(source: raw, rotation: rotation, plan: plan, card: card, timings: timings,
                                        replayCrop: replayCrop, to: out)
        return RenderedEdit(
            url: out,
            duration: rendered.duration,
            pitchTimes: QuickPlan.editTimes(pitches: pitches, plan: plan).map { $0 + rendered.cardLength },
            bytes: rendered.bytes,
            renderSeconds: Date().timeIntervalSince(started)
        )
    }

    /// Lays a plan (ranges of `source`, in its own time) out after the title
    /// card and writes the finished video. Shared reels go through here too.
    static func render(
        source: URL,
        rotation: Int,
        plan: [PlanSegment],
        card: TitleCard?,
        timings: EditTimings,
        replayCrop: CGRect? = nil,
        shape: VideoShape = .landscape,
        /// Where the picture sits in a vertical crop: the middle of the kept
        /// strip, as a fraction of the width.
        cropCenter: Double = 0.5,
        to out: URL
    ) async throws -> (duration: Double, cardLength: Double, bytes: Int64) {
        let asset = AVURLAsset(url: source)
        guard let sourceVideo = try await asset.loadTracks(withMediaType: .video).first else { throw RenderError.noVideo }
        let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first
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
                timeRange: range, sourceTrackID: nil, rotate180: false, crop: nil, fillCenter: nil,
                overlay: CaptionArt.titleCard(card, size: shape.size)
            ))
            cursor = range.duration
        }
        let cardLength = cursor.seconds
        for seg in plan {
            let range = CMTimeRange(start: time(seg.start), end: time(seg.end))
            // At real speed the inserted range is the played length, to the tick.
            let played = seg.rate == 1 ? range.duration : time(seg.playLength)
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
                crop: seg.replay ? replayCrop : nil,
                fillCenter: shape == .vertical ? cropCenter : nil,
                // No caption, no pill (a shared video with captions off).
                overlay: seg.caption.isEmpty ? nil : CaptionArt.caption(seg.caption, replay: seg.replay, size: shape.size)
            ))
            cursor = CMTimeAdd(cursor, played)
        }

        var config = AVVideoComposition.Configuration()
        config.customVideoCompositorClass = CaptionCompositor.self
        config.frameDuration = CMTime(value: 1, timescale: fps)
        config.renderSize = shape.size
        config.instructions = instructions
        let videoComposition = AVVideoComposition(configuration: config)

        try? FileManager.default.removeItem(at: out)
        try await encode(composition: composition, videoTracks: [video], audioTracks: audio.map { [$0] } ?? [],
                         videoComposition: videoComposition, intro: cardLength, to: out)

        let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int64) ?? 0
        return (cursor.seconds, cardLength, bytes)
    }

    static func time(_ seconds: Double) -> CMTime {
        CMTime(seconds: seconds, preferredTimescale: timescale)
    }

    // MARK: Encoding

    /// How long the title card runs, written into the file so the app's player
    /// can start after it. Shared and downloaded copies keep the card.
    enum IntroMark {
        // A comment, because an MP4 drops custom QuickTime keys on writing.
        static let prefix = "clips-intro-seconds="

        static func item(seconds: Double) -> AVMetadataItem {
            let item = AVMutableMetadataItem()
            item.identifier = .iTunesMetadataUserComment
            item.value = (prefix + String(format: "%.3f", seconds)) as NSString
            return item
        }

        /// The card's length; nil for a file from before the mark was written.
        static func seconds(in asset: AVAsset) async -> Double? {
            guard let items = try? await asset.load(.metadata) else { return nil }
            for item in AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .iTunesMetadataUserComment) {
                if let s = try? await item.load(.stringValue), s.hasPrefix(prefix), let v = Double(s.dropFirst(prefix.count)) { return v }
            }
            return nil
        }
    }

    /// Draws the composition through its compositor and writes the 1080p60
    /// file (the composition's size), with the title card's length marked in it. Several audio tracks
    /// are mixed down (with `audioMix`'s fades).
    static func encode(
        composition: AVComposition,
        videoTracks: [AVCompositionTrack],
        audioTracks: [AVCompositionTrack],
        audioMix: AVAudioMix? = nil,
        videoComposition: AVVideoComposition,
        intro: Double,
        to out: URL
    ) async throws {
        let reader = try AVAssetReader(asset: composition)
        let videoOut = AVAssetReaderVideoCompositionOutput(
            videoTracks: videoTracks,
            videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        )
        videoOut.videoComposition = videoComposition
        videoOut.alwaysCopiesSampleData = false
        guard reader.canAdd(videoOut) else { throw RenderError.failed("reader video") }
        reader.add(videoOut)

        var audioOut: AVAssetReaderAudioMixOutput?
        if !audioTracks.isEmpty {
            let o = AVAssetReaderAudioMixOutput(audioTracks: audioTracks, audioSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 48_000,
                AVNumberOfChannelsKey: 2,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ])
            o.audioMix = audioMix
            if reader.canAdd(o) { reader.add(o); audioOut = o }
        }

        let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        writer.metadata = [IntroMark.item(seconds: intro)]
        let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(videoComposition.renderSize.width),
            AVVideoHeightKey: Int(videoComposition.renderSize.height),
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
    static func pump(_ output: AVAssetReaderOutput, into input: AVAssetWriterInput, reader: AVAssetReader, group: DispatchGroup, label: String) {
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
    /// Zoom box as fractions of the picture, origin top-left (website-uploaded
    /// at-bats' replay zoom).
    let crop: CGRect?
    /// Crop to the frame's shape around this point (a fraction of the width)
    /// rather than stretching to it: a vertical video.
    let fillCenter: Double?
    let overlay: CIImage?

    init(timeRange: CMTimeRange, sourceTrackID: CMPersistentTrackID?, rotate180: Bool, crop: CGRect?,
         fillCenter: Double? = nil, overlay: CIImage?) {
        self.timeRange = timeRange
        self.sourceTrackID = sourceTrackID
        self.requiredSourceTrackIDs = sourceTrackID.map { [NSNumber(value: $0)] } ?? []
        self.rotate180 = rotate180
        self.crop = crop
        self.fillCenter = fillCenter
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
        let frame = CGRect(origin: .zero, size: request.renderContext.size)
        var image = CIImage(color: .black).cropped(to: frame)
        if let id = instruction.sourceTrackID, let source = request.sourceFrame(byTrackID: id) {
            var src = CIImage(cvPixelBuffer: source)
            if instruction.rotate180 {
                let e = src.extent
                src = src.transformed(by: CGAffineTransform(translationX: e.width, y: e.height).rotated(by: .pi))
            }
            // Crop at full resolution before scaling, so a zoomed 4K replay stays sharp.
            if let c = instruction.crop {
                let e = src.extent
                let box = CGRect(x: c.minX * e.width, y: (1 - c.maxY) * e.height, width: c.width * e.width, height: c.height * e.height)
                src = src.cropped(to: box).transformed(by: CGAffineTransform(translationX: -box.minX, y: -box.minY))
            }
            if let center = instruction.fillCenter {
                let box = VideoShape.fillBox(extent: src.extent, frame: frame.size, centerX: center)
                src = src.cropped(to: box).transformed(by: CGAffineTransform(translationX: -box.minX, y: -box.minY))
            }
            let e = src.extent
            if e.size != frame.size {
                src = src.transformed(by: CGAffineTransform(scaleX: frame.width / e.width, y: frame.height / e.height))
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
    /// orange during a replay. In a vertical video it's centered near the top,
    /// just under where Instagram puts a Reel's header — its caption, name and
    /// buttons cover the bottom third.
    static func caption(_ text: String, replay: Bool, size: CGSize = EditRenderer.size) -> CIImage? {
        let tall = size.height > size.width
        var font = UIFont.systemFont(ofSize: 40, weight: .semibold)
        let margin: CGFloat = tall ? 60 : 48
        let pad = CGSize(width: 28, height: 14)
        let room = size.width - margin * 2 - pad.width * 2
        let wide = (text as NSString).size(withAttributes: [.font: font]).width
        if wide > room { font = UIFont.systemFont(ofSize: (font.pointSize * room / wide).rounded(.down), weight: .semibold) }
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]
        let textSize = (text as NSString).size(withAttributes: attrs)
        let pill = CGRect(x: 0, y: 0, width: textSize.width + pad.width * 2, height: textSize.height + pad.height * 2)
        let image = draw(pill.size) { _ in
            let bg = replay ? UIColor(red: 0.85, green: 0.55, blue: 0.0, alpha: 0.85) : UIColor(white: 0, alpha: 0.6)
            bg.setFill()
            UIBezierPath(roundedRect: pill, cornerRadius: pill.height / 2).fill()
            (text as NSString).draw(at: CGPoint(x: pad.width, y: pad.height), withAttributes: attrs)
        }
        // CIImage's origin is bottom-left.
        let at = tall
            ? CGPoint(x: ((size.width - pill.width) / 2).rounded(), y: size.height - (size.height * 0.15).rounded() - pill.height)
            : CGPoint(x: margin, y: 48)
        return image.map { CIImage(cgImage: $0).transformed(by: CGAffineTransform(translationX: at.x, y: at.y)) }
    }

    /// The opening card, laid out like the website's exports (same sizes and
    /// spacing) so both kinds of clip open the same way. A subtitle too wide
    /// for the frame (a vertical one, a long game name) breaks into its parts,
    /// game over date; any line still too wide is set smaller to fit.
    static func titleCard(_ card: TitleCard, size: CGSize = EditRenderer.size) -> CIImage? {
        let room = size.width - 120
        func width(_ text: String, _ font: UIFont) -> CGFloat { (text as NSString).size(withAttributes: [.font: font]).width }
        func attrs(_ text: String, size points: CGFloat, alpha: CGFloat) -> [NSAttributedString.Key: Any] {
            var font = UIFont.systemFont(ofSize: points)
            let w = width(text, font)
            if w > room { font = UIFont.systemFont(ofSize: (points * room / w).rounded(.down)) }
            return [.font: font, .foregroundColor: UIColor(white: 1, alpha: alpha)]
        }
        let subPoints: CGFloat = 52
        var subLines = card.subtitle.isEmpty ? [] : [card.subtitle]
        if width(card.subtitle, .systemFont(ofSize: subPoints)) > room {
            subLines = card.subtitle.components(separatedBy: " · ")
        }
        let lines = [(card.title, attrs(card.title, size: 110, alpha: 1))]
            + subLines.map { ($0, attrs($0, size: subPoints, alpha: 170 / 255)) }
        let image = draw(size) { _ in
            UIColor.black.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            let sizes = lines.map { ($0.0 as NSString).size(withAttributes: $0.1) }
            // 36 between the title and the subtitle, 12 between subtitle lines.
            let gaps = lines.indices.dropFirst().map { $0 == 1 ? CGFloat(36) : 12 }
            var y = (size.height - sizes.map(\.height).reduce(0, +) - gaps.reduce(0, +)) / 2
            for (i, line) in lines.enumerated() {
                if i > 0 { y += gaps[i - 1] }
                (line.0 as NSString).draw(at: CGPoint(x: (size.width - sizes[i].width) / 2, y: y), withAttributes: line.1)
                y += sizes[i].height
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
