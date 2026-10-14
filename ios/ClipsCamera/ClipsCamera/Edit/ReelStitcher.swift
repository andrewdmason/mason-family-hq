import AVFoundation
import CoreImage

// Several at-bats in one video, for a highlight reel: one title card, then
// each at-bat (already rendered on its own, with no card or captions) in the
// order they happened. Each plays out in full, then its last frame holds while
// the next dissolves in over it, as the close-up meets the field view. Each
// at-bat's caption ("AB 2 · Double") shows for the whole of it — field view
// too — sliding in as it starts and turning orange during slow motion.

/// One at-bat's finished video, and what to caption it with.
struct StitchClip {
    var url: URL
    /// Nil for no caption.
    var caption: String?
    /// Where its slow-motion replays fall, in its own time.
    var replays: [ClosedRange<Double>] = []
}

enum ReelStitcher {
    /// The finished reel's length.
    @discardableResult
    static func render(clips: [StitchClip], card: TitleCard?, cardSeconds: Double, shape: VideoShape, to out: URL) async throws -> Double {
        guard !clips.isEmpty else { throw RenderError.failed("no at-bats to put together") }
        let composition = AVMutableComposition()
        var videoTracks: [AVMutableCompositionTrack] = []
        var audioTracks: [AVMutableCompositionTrack] = []
        for _ in 0 ..< min(2, clips.count) {
            guard let v = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
                  let a = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
                throw RenderError.failed("composition")
            }
            videoTracks.append(v)
            audioTracks.append(a)
        }
        var mixParams: [CMPersistentTrackID: AVMutableAudioMixInputParameters] = [:]
        func mix(_ track: AVMutableCompositionTrack) -> AVMutableAudioMixInputParameters {
            if let p = mixParams[track.trackID] { return p }
            let p = AVMutableAudioMixInputParameters(track: track)
            p.setVolume(1, at: .zero)
            mixParams[track.trackID] = p
            return p
        }

        var instructions: [LayerInstruction] = []
        var cursor = CMTime.zero
        let cardSeconds = card == nil ? 0 : max(0, cardSeconds)
        // Each clip's place: where it starts, its length, its track.
        var placed: [(start: CMTime, length: CMTime, track: Int, fade: CMTime)] = []
        for (i, clip) in clips.enumerated() {
            let asset = AVURLAsset(url: clip.url)
            guard let video = try await asset.loadTracks(withMediaType: .video).first else { throw RenderError.noVideo }
            let range = try await video.load(.timeRange)
            let k = i % videoTracks.count
            if i == 0, let card, cardSeconds > 0 {
                // The card stands on one frame stretched out (a track can't
                // start with nothing); the compositor draws the card over it.
                let length = EditRenderer.time(cardSeconds)
                let oneFrame = CMTimeRange(start: range.start, duration: CMTime(value: 1, timescale: 600))
                try videoTracks[0].insertTimeRange(oneFrame, of: video, at: .zero)
                videoTracks[0].scaleTimeRange(CMTimeRange(start: .zero, duration: oneFrame.duration), toDuration: length)
                audioTracks[0].insertEmptyTimeRange(CMTimeRange(start: .zero, duration: length))
                instructions.append(LayerInstruction(timeRange: CMTimeRange(start: .zero, duration: length), layers: [],
                                                     overlay: CaptionArt.titleCard(card, size: shape.size)))
                cursor = length
            }
            try videoTracks[k].insertTimeRange(range, of: video, at: cursor)
            let fade = i == 0 ? .zero : EditRenderer.time(min(FieldViewRenderer.dissolve, range.duration.seconds / 2,
                                                             placed[i - 1].length.seconds / 2))
            if let audio = try await asset.loadTracks(withMediaType: .audio).first {
                let aRange = try await audio.load(.timeRange)
                try audioTracks[k].insertTimeRange(CMTimeRange(start: aRange.start, duration: CMTimeMinimum(aRange.duration, range.duration)),
                                                   of: audio, at: cursor)
                if i > 0 {
                    let p = mix(audioTracks[k])
                    p.setVolumeRamp(fromStartVolume: 0, toEndVolume: 1, timeRange: CMTimeRange(start: cursor, duration: fade))
                }
            }
            // Hold this clip's last frame while the next one dissolves in.
            if i < clips.count - 1 {
                var frame = try await video.load(.minFrameDuration)
                if !frame.isValid || frame.seconds <= 0 || frame > range.duration { frame = CMTime(value: 1, timescale: EditRenderer.fps) }
                let end = CMTimeAdd(cursor, range.duration)
                try videoTracks[k].insertTimeRange(CMTimeRange(start: CMTimeSubtract(range.end, frame), duration: frame), of: video, at: end)
                videoTracks[k].scaleTimeRange(CMTimeRange(start: end, duration: frame),
                                              toDuration: EditRenderer.time(FieldViewRenderer.dissolve))
            }
            placed.append((cursor, range.duration, k, fade))
            cursor = CMTimeAdd(cursor, range.duration)
        }

        // Picture: each clip, dissolving in over the last one's held frame,
        // with its caption.
        for (i, p) in placed.enumerated() {
            let clip = clips[i]
            let start = p.start.seconds
            let caption = clip.caption.flatMap { text -> AnimatedCaption? in
                guard let normal = CaptionArt.caption(text, replay: false, size: shape.size),
                      let replay = CaptionArt.caption(text, replay: true, size: shape.size) else { return nil }
                return AnimatedCaption(normal: normal, replay: replay, appear: start,
                                       replays: clip.replays.map { (start + $0.lowerBound) ... (start + $0.upperBound) })
            }
            let layer = LayerInstruction.Layer(trackID: videoTracks[p.track].trackID, orientation: .up, fadeIn: false)
            let end = CMTimeAdd(p.start, p.length)
            if i > 0 && p.fade > .zero {
                let previous = LayerInstruction.Layer(trackID: videoTracks[placed[i - 1].track].trackID, orientation: .up, fadeIn: false)
                let fading = LayerInstruction.Layer(trackID: layer.trackID, orientation: .up, fadeIn: true)
                instructions.append(LayerInstruction(timeRange: CMTimeRange(start: p.start, duration: p.fade),
                                                     layers: [previous, fading], caption: caption))
                instructions.append(LayerInstruction(timeRange: CMTimeRange(start: CMTimeAdd(p.start, p.fade), end: end),
                                                     layers: [layer], caption: caption))
            } else {
                instructions.append(LayerInstruction(timeRange: CMTimeRange(start: p.start, end: end), layers: [layer], caption: caption))
            }
        }
        instructions.removeAll { $0.timeRange.duration.seconds <= 0 }

        var config = AVVideoComposition.Configuration()
        config.customVideoCompositorClass = LayerCompositor.self
        config.frameDuration = CMTime(value: 1, timescale: EditRenderer.fps)
        config.renderSize = shape.size
        config.instructions = instructions
        // Only tracks with some sound in them (a silent clip leaves one empty).
        let sounding = audioTracks.filter { $0.segments.contains { !$0.isEmpty } }
        let audioMix = AVMutableAudioMix()
        audioMix.inputParameters = sounding.map { mix($0) }

        try? FileManager.default.removeItem(at: out)
        try await EditRenderer.encode(composition: composition, videoTracks: videoTracks, audioTracks: sounding,
                                      audioMix: audioMix, videoComposition: AVVideoComposition(configuration: config),
                                      intro: cardSeconds, to: out)
        return cursor.seconds
    }
}

// MARK: - Words

extension ReelStitcher {
    /// "AB 2 · Double" — with the day first ("Oct 11 · AB 2 · Double") when
    /// the reel spans games, since game names are too long for a caption.
    static func caption(number: Int, result: AtBatResult?, day: String?) -> String {
        var parts = [String]()
        if let day { parts.append(shortDate(day)) }
        parts.append("AB \(number)")
        if let result { parts.append(result.name) }
        return parts.joined(separator: " · ")
    }

    /// The reel's one card: the kid's name over the game and its date, or
    /// over the span of dates when the at-bats come from several games.
    static func card(kid: String?, games: [(name: String, playedOn: String)]) -> TitleCard {
        let title = kid.flatMap { $0.isEmpty ? nil : $0 } ?? "Highlights"
        let days = games.map(\.playedOn).sorted()
        let names = Set(games.map(\.name))
        guard let first = days.first, let last = days.last else { return TitleCard(title: title, subtitle: "") }
        if names.count == 1, first == last, let name = names.first {
            return TitleCard(title: title, subtitle: "\(name) · \(TitleCard.formatGameDate(first))")
        }
        return TitleCard(title: title, subtitle: dateRange(first, last))
    }

    /// "Oct 11" from "2026-10-11".
    static func shortDate(_ ymd: String) -> String {
        guard let d = day(ymd) else { return ymd }
        return format(d, "MMM d")
    }

    /// "Sep 26 – Oct 14, 2026" (the year once when it's the same), or one
    /// long date when they're the same day.
    static func dateRange(_ from: String, _ to: String) -> String {
        guard let a = day(from), let b = day(to) else { return "\(from) – \(to)" }
        if from == to { return TitleCard.formatGameDate(from) }
        let sameYear = Calendar(identifier: .gregorian).component(.year, from: a) == Calendar(identifier: .gregorian).component(.year, from: b)
        return sameYear ? "\(format(a, "MMM d")) – \(format(b, "MMM d, yyyy"))"
            : "\(format(a, "MMM d, yyyy")) – \(format(b, "MMM d, yyyy"))"
    }

    private static func day(_ ymd: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: ymd)
    }

    private static func format(_ d: Date, _ pattern: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = pattern
        return f.string(from: d)
    }
}
