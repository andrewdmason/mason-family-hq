import AVFoundation
import CoreImage
import UIKit

// The GameChanger "field view": the wide stream camera's look at the whole
// play, trimmed and added to the end of an at-bat. The close-up (the finished
// edit, title card and all) plays out in full, then its last frame holds while
// the field view dissolves in over it for half a second, at real speed with its
// own sound. (The dissolve doesn't overlap the close-up, which is cut tight —
// it would eat the end of the swing.) An at-bat with no close-up is the title
// card, if any, and then the field view.
//
// The GameChanger clip can be any size or frame rate; it's fitted into the
// 1080p60 frame with black bars rather than stretched.

struct RenderedFieldView {
    var duration: Double
    /// Where the field view starts in the finished video.
    var fieldViewAt: Double
    var bytes: Int64
}

enum FieldViewRenderer {
    static let dissolve = 0.5

    /// The close-up, then the field view: the kept stretch of `fieldView`.
    static func append(closeup: URL, fieldView: URL, start: Double, end: Double, to out: URL) async throws -> RenderedFieldView {
        let a = AVURLAsset(url: closeup)
        let b = AVURLAsset(url: fieldView)
        guard let aVideo = try await a.loadTracks(withMediaType: .video).first,
              let bVideo = try await b.loadTracks(withMediaType: .video).first else { throw RenderError.noVideo }
        let aAudio = try await a.loadTracks(withMediaType: .audio).first
        let bAudio = try await b.loadTracks(withMediaType: .audio).first
        let aRange = try await aVideo.load(.timeRange)
        let bRange = try await clamp(start: start, end: end, to: bVideo)
        let bOrientation = orientation(try await bVideo.load(.preferredTransform))
        let intro = await EditRenderer.IntroMark.seconds(in: a) ?? EditTimings.standard.titleCard

        let composition = AVMutableComposition()
        guard let videoA = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let videoB = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError.failed("composition")
        }
        let closeupLength = aRange.duration
        let fade = EditRenderer.time(min(dissolve, bRange.duration.seconds / 2))
        let bAt = closeupLength
        try videoA.insertTimeRange(aRange, of: aVideo, at: .zero)
        // The close-up's last frame, held through the dissolve.
        var frame = try await aVideo.load(.minFrameDuration)
        if !frame.isValid || frame.seconds <= 0 || frame > aRange.duration { frame = CMTime(value: 1, timescale: EditRenderer.fps) }
        try videoA.insertTimeRange(CMTimeRange(start: CMTimeSubtract(aRange.end, frame), duration: frame), of: aVideo, at: closeupLength)
        videoA.scaleTimeRange(CMTimeRange(start: closeupLength, duration: frame), toDuration: fade)
        try videoB.insertTimeRange(bRange, of: bVideo, at: bAt)
        let end = CMTimeAdd(bAt, bRange.duration)

        // Sound: the close-up's plays out, then the field view's fades in.
        var audioTracks: [AVCompositionTrack] = []
        var mixParams: [AVAudioMixInputParameters] = []
        let overlap = CMTimeRange(start: bAt, duration: fade)
        if let aAudio, let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            let range = try await aAudio.load(.timeRange)
            try track.insertTimeRange(CMTimeRange(start: range.start, duration: CMTimeMinimum(range.duration, closeupLength)), of: aAudio, at: .zero)
            audioTracks.append(track)
            mixParams.append(AVMutableAudioMixInputParameters(track: track))
        }
        if let bAudio, let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try track.insertTimeRange(bRange, of: bAudio, at: bAt)
            let p = AVMutableAudioMixInputParameters(track: track)
            p.setVolumeRamp(fromStartVolume: 0, toEndVolume: 1, timeRange: overlap)
            audioTracks.append(track)
            mixParams.append(p)
        }
        let mix = AVMutableAudioMix()
        mix.inputParameters = mixParams

        let closeupLayer = LayerInstruction.Layer(trackID: videoA.trackID, orientation: .up, fadeIn: false)
        let fieldLayer = LayerInstruction.Layer(trackID: videoB.trackID, orientation: bOrientation, fadeIn: false)
        var instructions = [
            LayerInstruction(timeRange: CMTimeRange(start: .zero, duration: bAt), layers: [closeupLayer]),
            LayerInstruction(timeRange: overlap, layers: [closeupLayer, .init(trackID: videoB.trackID, orientation: bOrientation, fadeIn: true)]),
            LayerInstruction(timeRange: CMTimeRange(start: overlap.end, end: end), layers: [fieldLayer]),
        ]
        instructions.removeAll { $0.timeRange.duration.seconds <= 0 }

        try? FileManager.default.removeItem(at: out)
        try await EditRenderer.encode(
            composition: composition, videoTracks: [videoA, videoB], audioTracks: audioTracks, audioMix: mix,
            videoComposition: videoComposition(instructions), intro: intro, to: out
        )
        return RenderedFieldView(duration: end.seconds, fieldViewAt: bAt.seconds, bytes: bytes(out))
    }

    /// An at-bat that's only the field view: the title card (when there is
    /// one), then the clip.
    static func alone(card: TitleCard?, cardSeconds: Double, fieldView: URL, start: Double, end: Double, to out: URL) async throws -> RenderedFieldView {
        let b = AVURLAsset(url: fieldView)
        guard let bVideo = try await b.loadTracks(withMediaType: .video).first else { throw RenderError.noVideo }
        let bAudio = try await b.loadTracks(withMediaType: .audio).first
        let bRange = try await clamp(start: start, end: end, to: bVideo)
        let bOrientation = orientation(try await bVideo.load(.preferredTransform))

        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError.failed("composition")
        }
        let audio = bAudio == nil ? nil : composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        let cardSeconds = card == nil ? 0 : max(0, cardSeconds)
        let cardLength = EditRenderer.time(cardSeconds)
        var instructions: [LayerInstruction] = []
        if let card, cardSeconds > 0 {
            // The card stands on one frame stretched out (a track can't start
            // with nothing); the compositor draws the card over it.
            let oneFrame = CMTimeRange(start: bRange.start, duration: CMTime(value: 1, timescale: 600))
            try video.insertTimeRange(oneFrame, of: bVideo, at: .zero)
            video.scaleTimeRange(CMTimeRange(start: .zero, duration: oneFrame.duration), toDuration: cardLength)
            audio?.insertEmptyTimeRange(CMTimeRange(start: .zero, duration: cardLength))
            instructions.append(LayerInstruction(timeRange: CMTimeRange(start: .zero, duration: cardLength), layers: [],
                                                 overlay: CaptionArt.titleCard(card)))
        }
        try video.insertTimeRange(bRange, of: bVideo, at: cardLength)
        if let audio, let bAudio {
            try audio.insertTimeRange(bRange, of: bAudio, at: cardLength)
        }
        let end = CMTimeAdd(cardLength, bRange.duration)
        instructions.append(LayerInstruction(timeRange: CMTimeRange(start: cardLength, end: end),
                                             layers: [.init(trackID: video.trackID, orientation: bOrientation, fadeIn: false)]))

        try? FileManager.default.removeItem(at: out)
        try await EditRenderer.encode(
            composition: composition, videoTracks: [video], audioTracks: audio.map { [$0] } ?? [],
            videoComposition: videoComposition(instructions), intro: cardSeconds, to: out
        )
        return RenderedFieldView(duration: end.seconds, fieldViewAt: cardSeconds, bytes: bytes(out))
    }

    /// The kept stretch, inside the clip and at least a frame long.
    private static func clamp(start: Double, end: Double, to track: AVAssetTrack) async throws -> CMTimeRange {
        let full = try await track.load(.timeRange)
        let s = max(full.start.seconds, start)
        let e = min(full.end.seconds, end)
        guard e - s > 0.1 else { throw RenderError.failed("the kept part of the GameChanger video is empty") }
        return CMTimeRange(start: EditRenderer.time(s), end: EditRenderer.time(e))
    }

    private static func videoComposition(_ instructions: [LayerInstruction]) -> AVVideoComposition {
        var config = AVVideoComposition.Configuration()
        config.customVideoCompositorClass = LayerCompositor.self
        config.frameDuration = CMTime(value: 1, timescale: EditRenderer.fps)
        config.renderSize = EditRenderer.size
        config.instructions = instructions
        return AVVideoComposition(configuration: config)
    }

    /// Which way up a track's frames are meant to be shown (a phone video
    /// filmed upright is stored sideways with a rotation to apply).
    static func orientation(_ t: CGAffineTransform) -> CGImagePropertyOrientation {
        switch (t.a.rounded(), t.b.rounded(), t.c.rounded(), t.d.rounded()) {
        case (0, 1, -1, 0): .right
        case (0, -1, 1, 0): .left
        case (-1, 0, 0, -1): .down
        default: .up
        }
    }

    private static func bytes(_ url: URL) -> Int64 {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? 0
    }
}

// MARK: - Compositor

/// One stretch of the finished video: source frames stacked bottom to top
/// (each fitted to the frame), the top one optionally fading in across the
/// stretch, and art drawn over them.
final class LayerInstruction: NSObject, AVVideoCompositionInstructionProtocol {
    struct Layer {
        let trackID: CMPersistentTrackID
        let orientation: CGImagePropertyOrientation
        /// Opacity rises from 0 to 1 over the instruction.
        let fadeIn: Bool
    }

    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    nonisolated(unsafe) let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID = kCMPersistentTrackID_Invalid
    let layers: [Layer]
    let overlay: CIImage?

    init(timeRange: CMTimeRange, layers: [Layer], overlay: CIImage? = nil) {
        self.timeRange = timeRange
        self.layers = layers
        self.overlay = overlay
        self.requiredSourceTrackIDs = layers.map { NSNumber(value: $0.trackID) }
    }
}

final class LayerCompositor: NSObject, AVVideoCompositing {
    private let context = CIContext(options: [.cacheIntermediates: false])

    var sourcePixelBufferAttributes: [String: any Sendable]? {
        [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    }

    var requiredPixelBufferAttributesForRenderContext: [String: any Sendable] {
        [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    }

    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

    func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        guard let instruction = request.videoCompositionInstruction as? LayerInstruction,
              let output = request.renderContext.newPixelBuffer() else {
            request.finish(with: RenderError.failed("compositor setup"))
            return
        }
        let frame = CGRect(origin: .zero, size: EditRenderer.size)
        var image = CIImage(color: .black).cropped(to: frame)
        for layer in instruction.layers {
            guard let source = request.sourceFrame(byTrackID: layer.trackID) else { continue }
            var src = CIImage(cvPixelBuffer: source).oriented(layer.orientation)
            src = src.transformed(by: CGAffineTransform(translationX: -src.extent.minX, y: -src.extent.minY))
            let e = src.extent
            if e.size != frame.size {
                let scale = min(frame.width / e.width, frame.height / e.height)
                src = src
                    .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                    .transformed(by: CGAffineTransform(translationX: (frame.width - e.width * scale) / 2,
                                                       y: (frame.height - e.height * scale) / 2))
            }
            if layer.fadeIn {
                let range = instruction.timeRange
                let a = CGFloat(max(0, min(1, (request.compositionTime - range.start).seconds / range.duration.seconds)))
                src = src.applyingFilter("CIColorMatrix", parameters: [
                    "inputRVector": CIVector(x: a, y: 0, z: 0, w: 0),
                    "inputGVector": CIVector(x: 0, y: a, z: 0, w: 0),
                    "inputBVector": CIVector(x: 0, y: 0, z: a, w: 0),
                    "inputAVector": CIVector(x: 0, y: 0, z: 0, w: a),
                ])
            }
            image = src.composited(over: image)
        }
        if let overlay = instruction.overlay {
            image = overlay.composited(over: image)
        }
        context.render(image.cropped(to: frame), to: output)
        request.finish(withComposedVideoFrame: output)
    }

    func cancelAllPendingVideoCompositionRequests() {}
}
