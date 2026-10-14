import AVFoundation
import SwiftUI

/// "Fix the ball": when tracing couldn't follow the ball on its own (or
/// followed the wrong thing), point it out once. The field view opens paused
/// near contact; scrub or step to a frame where the ball shows, tap it, and
/// Use this sends that frame and spot to be traced again.
struct FixBallScreen: View {
    let fieldView: FieldViewPlayback
    /// Clip seconds to open on.
    let startAt: Double
    let onUse: (TrailTap) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer
    @State private var time: Double
    @State private var videoSize: CGSize?
    /// The tap, on the frame at `tap.t`.
    @State private var tap: TrailTap?
    @State private var scrubbing = false
    @State private var token: Any?

    init(fieldView: FieldViewPlayback, startAt: Double, onUse: @escaping (TrailTap) -> Void) {
        self.fieldView = fieldView
        let start = min(max(startAt, fieldView.start), fieldView.end)
        self.startAt = start
        self.onUse = onUse
        let item = AVPlayerItem(url: fieldView.url)
        _player = State(initialValue: AVPlayer(playerItem: item))
        _time = State(initialValue: start)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            GeometryReader { geo in
                ZStack {
                    PlayerLayerView(player: player)
                    if let tap, let videoSize, abs(tap.t - time) < 0.001 {
                        let p = TapMapping.point(CGPoint(x: tap.x, y: tap.y), in: geo.size, video: videoSize)
                        Circle()
                            .strokeBorder(.orange, lineWidth: 3)
                            .frame(width: 44, height: 44)
                            .shadow(color: .black.opacity(0.6), radius: 2)
                            .position(p)
                            .allowsHitTesting(false)
                    }
                }
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { e in
                    guard let videoSize, let n = TapMapping.normalized(e.location, in: geo.size, video: videoSize) else { return }
                    player.pause()
                    // The frame on screen.
                    let shown = player.currentItem?.currentTime().seconds ?? time
                    time = shown
                    tap = TrailTap(t: shown, x: Double(n.x), y: Double(n.y))
                })
            }
            .ignoresSafeArea()
            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                controls
            }
        }
        .preferredColorScheme(.dark)
        .task { await setUp() }
        .onDisappear {
            player.pause()
            if let token { player.removeTimeObserver(token) }
            token = nil
        }
    }

    private var topBar: some View {
        HStack {
            Button("Cancel") { dismiss() }
            Spacer()
            Text(tap == nil ? "Tap the ball" : "Got it — Use this, or tap again")
                .font(.headline)
            Spacer()
            Button("Use this") {
                guard let tap else { return }
                onUse(tap)
                dismiss()
            }
            .fontWeight(.semibold)
            .disabled(tap == nil)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom))
    }

    private var controls: some View {
        HStack(spacing: 4) {
            HoldButton(systemImage: "backward.frame.fill", label: "Back one frame") { step(-1) }
            Slider(value: Binding(get: { time }, set: { seek($0) }), in: fieldView.start...max(fieldView.start + 0.1, fieldView.end)) { editing in
                scrubbing = editing
            }
            .tint(.white)
            HoldButton(systemImage: "forward.frame.fill", label: "Forward one frame") { step(1) }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }

    private func setUp() async {
        let asset = player.currentItem?.asset
        if let track = try? await asset?.loadTracks(withMediaType: .video).first,
           let loaded = try? await track.load(.naturalSize, .preferredTransform) {
            let s = loaded.0.applying(loaded.1)
            videoSize = CGSize(width: abs(s.width), height: abs(s.height))
        }
        await player.seek(to: CMTime(seconds: startAt, preferredTimescale: 24_000), toleranceBefore: .zero, toleranceAfter: .zero)
        player.isMuted = true
        token = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 60), queue: .main) { t in
            MainActor.assumeIsolated {
                if !scrubbing { time = t.seconds }
            }
        }
    }

    private func seek(_ t: Double) {
        time = t
        player.seek(to: CMTime(seconds: t, preferredTimescale: 24_000), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func step(_ frames: Int) {
        player.pause()
        guard let item = player.currentItem else { return }
        if frames > 0 && item.currentTime().seconds >= fieldView.end { return }
        if frames < 0 && item.currentTime().seconds <= fieldView.start { return }
        item.step(byCount: frames)
    }
}

/// Where the picture sits in a view that fits it whole (black bars on the
/// long sides), and taps there in the picture's own 0–1 coordinates.
enum TapMapping {
    static func videoRect(in container: CGSize, video: CGSize) -> CGRect {
        guard video.width > 0, video.height > 0, container.width > 0, container.height > 0 else { return .zero }
        let scale = min(container.width / video.width, container.height / video.height)
        let w = video.width * scale, h = video.height * scale
        return CGRect(x: (container.width - w) / 2, y: (container.height - h) / 2, width: w, height: h)
    }

    /// A point in the view → 0–1 of the picture from its top left; nil on the bars.
    static func normalized(_ p: CGPoint, in container: CGSize, video: CGSize) -> CGPoint? {
        let r = videoRect(in: container, video: video)
        guard r.width > 0, r.contains(p) else { return nil }
        return CGPoint(x: (p.x - r.minX) / r.width, y: (p.y - r.minY) / r.height)
    }

    /// 0–1 of the picture → a point in the view.
    static func point(_ n: CGPoint, in container: CGSize, video: CGSize) -> CGPoint {
        let r = videoRect(in: container, video: video)
        return CGPoint(x: r.minX + n.x * r.width, y: r.minY + n.y * r.height)
    }
}
