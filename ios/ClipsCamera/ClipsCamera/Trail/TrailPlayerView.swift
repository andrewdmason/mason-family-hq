import AVFoundation
import CoreImage
import SwiftUI
import UIKit

/// The field view's picture with its ball trail drawn live over it.
///
/// A display link reads the player's clock every screen refresh and redraws
/// the trail whenever the source frame on screen changes — so it follows
/// playback, Slow ¼×, scrubbing and frame steps alike — through the same
/// TrailRenderer that burns trails into shares. The trail sits in the video's
/// own rectangle inside the layer (fitted, black bars and all).
struct TrailPlayerView: UIViewRepresentable {
    let player: AVPlayer
    /// Nil draws no trail.
    var trail: TrailGeometry?
    var style: TrailStyle

    func makeUIView(context: Context) -> TrailPlayerUIView {
        let v = TrailPlayerUIView()
        v.playerLayer.player = player
        v.playerLayer.videoGravity = .resizeAspect
        v.configure(trail: trail, style: style)
        return v
    }

    func updateUIView(_ v: TrailPlayerUIView, context: Context) {
        if v.playerLayer.player !== player { v.playerLayer.player = player }
        v.configure(trail: trail, style: style)
    }

    static func dismantleUIView(_ v: TrailPlayerUIView, coordinator: ()) {
        v.stop()
    }
}

final class TrailPlayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

    /// No colour management: the renderer's values go to the screen as they are.
    private static let context = CIContext(options: [
        .workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false,
    ])
    private static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

    private let trailLayer = CALayer()
    private var geometry: TrailGeometry?
    private var style: TrailStyle = .neon
    private var link: CADisplayLink?
    /// What's drawn now, so an unchanged frame isn't drawn twice.
    private var drawn: DrawKey?

    private struct DrawKey: Equatable {
        var frameTime: Double?
        var style: TrailStyle
        var rect: CGRect
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        trailLayer.contentsGravity = .resize
        trailLayer.isHidden = true
        layer.addSublayer(trailLayer)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(trail: TrailGeometry?, style: TrailStyle) {
        guard trail !== geometry || style != self.style else { return }
        geometry = trail
        self.style = style
        drawn = nil
        updateLink()
        refresh()
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updateLink()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        drawn = nil
        refresh()
    }

    private func updateLink() {
        let wanted = window != nil && geometry != nil
        if wanted, link == nil {
            let link = CADisplayLink(target: Ticker(self), selector: #selector(Ticker.tick))
            link.add(to: .main, forMode: .common)
            self.link = link
        } else if !wanted {
            stop()
            trailLayer.isHidden = true
        }
    }

    /// Draw the trail for the frame on screen, if that's changed.
    fileprivate func refresh() {
        guard let geometry, let item = playerLayer.player?.currentItem else {
            trailLayer.isHidden = true
            return
        }
        let rect = playerLayer.videoRect
        guard rect.width > 1, rect.height > 1 else { return }
        let t = item.currentTime().seconds
        let moment = t.isFinite ? geometry.moment(at: t, style: style) : nil
        let key = DrawKey(frameTime: moment?.frameTime, style: style, rect: rect)
        guard key != drawn else { return }
        drawn = key
        let scale = window?.screen.scale ?? traitCollection.displayScale
        let pixels = CGRect(x: 0, y: 0, width: (rect.width * scale).rounded(), height: (rect.height * scale).rounded())
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        guard moment != nil,
              let image = TrailRenderer.image(geometry, at: t, style: style, videoRect: pixels),
              let cg = Self.context.createCGImage(image, from: image.extent, format: .RGBA8, colorSpace: Self.sRGB) else {
            trailLayer.isHidden = true
            return
        }
        let e = image.extent
        // Pixels (origin bottom left) → points in this view (origin top left).
        trailLayer.frame = CGRect(x: rect.minX + e.minX / scale, y: rect.minY + (pixels.height - e.maxY) / scale,
                                  width: e.width / scale, height: e.height / scale)
        trailLayer.contentsScale = scale
        trailLayer.contents = cg
        // Neon is light added to the picture ("plus lighter", as SwiftUI's
        // blend mode of that name), the others lie over it.
        trailLayer.compositingFilter = style.additive ? "plusL" : nil
        trailLayer.isHidden = false
    }

    /// The display link holds its target strongly; this lets the view go.
    private final class Ticker: NSObject {
        weak var view: TrailPlayerUIView?
        init(_ view: TrailPlayerUIView) { self.view = view }
        @objc func tick() {
            guard let view else { return }
            view.refresh()
        }
    }
}
