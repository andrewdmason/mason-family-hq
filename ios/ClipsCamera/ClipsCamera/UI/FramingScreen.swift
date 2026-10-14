import AVFoundation
import SwiftUI

// Framing a vertical share: the footage loops behind a tall frame the width of
// what a 9:16 video keeps, the rest dimmed; drag it sideways. The close-up
// loops its key swing in slow motion so the whole swing can be checked against
// the frame; the GameChanger clip loops as trimmed.

/// A stretch of a video to loop, at a speed.
struct FramingLoop: Equatable {
    var url: URL
    var start: Double
    var end: Double
    var rate: Float
}

/// The footage the share sheet frames from.
struct FramingSources {
    var closeup: FramingLoop?
    var fieldView: FramingLoop?

    /// From a reel: the swing that matters most — the ball in play, else
    /// the last swing, else the last pitch — slowed, and the field view.
    init(reel: URL, segments: [ReelSegment], pitches: [Pitch], fieldView: FieldViewPlayback?) {
        let sorted = pitches.sorted { $0.t < $1.t }
        let times = sorted.map(\.t)
        let key = ReelPlan.hitPitch(sorted) ?? sorted.lastIndex { $0.outcome?.isSwing ?? false } ?? sorted.indices.last
        if let key, let w = ReelPlan.replayWindow(pitch: key, segments: segments, pitchTimes: times) {
            closeup = FramingLoop(url: reel, start: w.lowerBound, end: w.upperBound, rate: Float(EditTimings.standard.replayRate))
        } else if let last = segments.last {
            closeup = FramingLoop(url: reel, start: last.start, end: last.end, rate: 1)
        }
        self.fieldView = fieldView.map { FramingLoop(url: $0.url, start: $0.start, end: $0.end, rate: 1) }
    }
}

/// Keeps a crop's middle where the whole strip stays inside the picture.
func clampedCropCenter(_ c: Double, aspect: CGFloat) -> Double {
    let half = Double(VideoShape.verticalWidth(aspect: aspect)) / 2
    return min(max(c, half), 1 - half)
}

/// A video's picture shape, as shown (its rotation applied).
func displayAspect(of url: URL) async -> CGFloat? {
    guard let track = try? await AVURLAsset(url: url).loadTracks(withMediaType: .video).first,
          let (size, transform) = try? await track.load(.naturalSize, .preferredTransform) else { return nil }
    let shown = size.applying(transform)
    guard shown.height != 0 else { return nil }
    return abs(shown.width / shown.height)
}

struct FramingScreen: View {
    let title: String
    let loop: FramingLoop
    @Binding var center: Double

    @Environment(\.dismiss) private var dismiss
    @State private var player = AVQueuePlayer()
    @State private var looper: AVPlayerLooper?
    @State private var aspect: CGFloat = 16.0 / 9.0
    @State private var dragFrom: Double?

    var body: some View {
        VStack(spacing: 16) {
            Spacer(minLength: 0)
            ZStack {
                PlayerLayerView(player: player)
                GeometryReader { geo in frame(in: geo.size) }
            }
            .aspectRatio(aspect, contentMode: .fit)
            Text("Drag the frame to choose what's kept")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.7))
            Spacer(minLength: 0)
        }
        .padding(.horizontal)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.black, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }.fontWeight(.semibold)
            }
        }
        .task { await start() }
        .onDisappear {
            player.pause()
            looper = nil
        }
    }

    /// The tall frame over the picture, everything outside it dimmed.
    private func frame(in size: CGSize) -> some View {
        let width = size.width * VideoShape.verticalWidth(aspect: aspect)
        let x = min(max(0, CGFloat(center) * size.width - width / 2), size.width - width)
        return ZStack(alignment: .topLeading) {
            Color.black.opacity(0.6).frame(width: x, height: size.height)
            Color.black.opacity(0.6)
                .frame(width: max(0, size.width - x - width), height: size.height)
                .offset(x: x + width)
            Rectangle()
                .strokeBorder(.white, lineWidth: 3)
                .frame(width: width, height: size.height)
                .offset(x: x)
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0).onChanged { g in
            if dragFrom == nil { dragFrom = clampedCropCenter(center, aspect: aspect) }
            center = clampedCropCenter((dragFrom ?? 0.5) + g.translation.width / max(1, size.width), aspect: aspect)
        }.onEnded { _ in dragFrom = nil })
        .accessibilityElement()
        .accessibilityLabel("Frame")
        .accessibilityValue("\(Int((center * 100).rounded())) percent across")
        .accessibilityAdjustableAction { dir in
            let step = dir == .increment ? 0.05 : -0.05
            center = clampedCropCenter(center + step, aspect: aspect)
        }
    }

    private func start() async {
        if let a = await displayAspect(of: loop.url) { aspect = a }
        center = clampedCropCenter(center, aspect: aspect)
        let range = CMTimeRange(start: CMTime(seconds: loop.start, preferredTimescale: 600),
                                end: CMTime(seconds: max(loop.end, loop.start + 0.1), preferredTimescale: 600))
        looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: loop.url), timeRange: range)
        player.isMuted = true
        player.defaultRate = loop.rate
        player.play()
    }
}

/// A small picture of what a framing keeps: a still from the middle of its
/// loop, cropped to the strip.
struct FramingThumbnail: View {
    let loop: FramingLoop?
    let center: Double

    @State private var still: CGImage?

    var body: some View {
        ZStack {
            Color.black
            if let still, let crop = cropped(still) {
                Image(decorative: crop, scale: 1).resizable().scaledToFill()
            } else if loop != nil {
                ProgressView().controlSize(.mini)
            }
        }
        .frame(width: 27, height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .task(id: loop) { await load() }
    }

    private func cropped(_ image: CGImage) -> CGImage? {
        let extent = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        let box = VideoShape.fillBox(extent: extent, frame: VideoShape.vertical.size, centerX: center)
        return image.cropping(to: box.integral)
    }

    private func load() async {
        guard let loop else { return }
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: loop.url))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 640, height: 640)
        let mid = CMTime(seconds: (loop.start + loop.end) / 2, preferredTimescale: 600)
        still = try? await gen.image(at: mid).image
    }
}
