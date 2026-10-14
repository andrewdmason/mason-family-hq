import CoreGraphics
import CoreImage
import Foundation
import simd

// Draws a ball trail for one moment of the field view — the one drawing path
// for both the live player's overlay and shared videos, so what you watch is
// what you post. The looks follow the prototype (prototypes/ball-trail/styles.py:
// draw_neon, draw_contrail, draw_broadcast); lengths there are at 1280 px wide
// and scale with the picture.
//
// Strokes are drawn with Core Graphics into small greyscale or colour bitmaps
// covering just the trail; blurs and colour happen in Core Image. The result is
// premultiplied colour with no colour management — gamma-encoded values, the
// way the prototype adds and blends — so the player's layer compositing and
// the share compositor (which converts to gamma for the trail) come out the
// same. Vapor and Broadcast go *over* the picture; Neon is light *added* to
// it (`TrailStyle.additive`), as in the prototype: opaque light on black, so
// "plus lighter" in the player and linear dodge in shares both come to
// picture + light, and the black adds nothing.

enum TrailRenderer {
    /// The trail at clip time `t`, positioned in a picture occupying
    /// `videoRect` (Core Image coordinates: origin bottom left, pixels), or nil
    /// when there's nothing to draw. Its extent is just the trail's surroundings.
    static func image(_ geometry: TrailGeometry, at t: Double, style: TrailStyle, videoRect: CGRect) -> CIImage? {
        guard videoRect.width > 1, videoRect.height > 1,
              let m = geometry.moment(at: t, style: style) else { return nil }
        let sc = videoRect.width / 1280
        let pts = m.points.map { pixel($0, in: videoRect) }
        switch style {
        case .neon: return neon(m, pts, sc: sc, rect: videoRect)
        case .vapor: return vapor(m, geometry, sc: sc, rect: videoRect)
        case .broadcast: return broadcast(m, pts, sc: sc, rect: videoRect)
        }
    }

    /// Frame-normalized (origin top left) → pixels in `rect` (origin bottom left).
    static func pixel(_ p: SIMD2<Double>, in rect: CGRect) -> CGPoint {
        CGPoint(x: rect.minX + p.x * rect.width, y: rect.maxY - p.y * rect.height)
    }

    // MARK: Styles

    /// Electric-blue streak tapering from the ball, a white-hot core on its
    /// front half, and a soft two-level glow.
    private static func neon(_ m: TrailMoment, _ pts: [CGPoint], sc: Double, rect: CGRect) -> CIImage? {
        let glowSigma = (near: 4 * sc, far: 14 * sc)
        guard let canvas = Canvas(around: pts, pad: 10 * sc + 3 * glowSigma.far, clip: rect, gray: false) else { return nil }
        let ctx = canvas.ctx
        for i in 0..<(pts.count - 1) {
            let u = m.u[i]
            let w = sc * (1 + 4 * pow(1 - u, 1.3))
            let k = (1 - 0.75 * u) * m.fade
            ctx.setStrokeColor(red: 40 / 255 * k, green: 200 / 255 * k, blue: k, alpha: 1)
            canvas.line(pts[i], pts[i + 1], width: max(1, w * 2))
        }
        for i in 0..<(pts.count - 1) where m.u[i] <= 0.45 {
            ctx.setStrokeColor(red: m.fade, green: m.fade, blue: m.fade, alpha: 1)
            canvas.line(pts[i], pts[i + 1], width: max(1, sc * 1.6 * (1 - m.u[i])))
        }
        let layer = canvas.image()
        let extent = layer.extent
        let near = scaled(layer.clampedToExtent().applyingGaussianBlur(sigma: glowSigma.near), by: 1.6)
        let far = scaled(layer.clampedToExtent().applyingGaussianBlur(sigma: glowSigma.far), by: 1.1)
        // Summed with linear dodge, which keeps these opaque images opaque and
        // clamps at white (plain addition compositing adds the alphas too).
        let total = scaled(layer, by: 0.9)
            .applyingFilter("CILinearDodgeBlendMode", parameters: [kCIInputBackgroundImageKey: near])
            .applyingFilter("CILinearDodgeBlendMode", parameters: [kCIInputBackgroundImageKey: far])
            .cropped(to: extent)
        // Opaque light on black: added to the picture, the black adds nothing.
        return total
    }

    /// A white contrail: puffs laid three per source frame along the path,
    /// each growing, drifting up and thinning as it ages; softly blurred.
    private static func vapor(_ m: TrailMoment, _ g: TrailGeometry, sc: Double, rect: CGRect) -> CIImage? {
        let fps = g.fps
        let headF = m.head * fps
        let first = Int((m.tailStart * fps * 3).rounded(.up))
        let last = Int((headF * 3 + 1e-6).rounded(.down))
        guard last >= first else { return nil }
        struct Puff { var c: CGPoint; var r: Double; var op: Double }
        var puffs: [Puff] = []
        for n in first...last {
            let k = Double(n) / 3
            let age = headF - k
            var rng = SeededRandom(seed: UInt64(n))
            let rad = sc * (2.5 + age * 0.75) * (0.8 + 0.4 * rng.next())
            let op = 0.6 * pow(max(0, 1 - age / 24), 1.4) * m.fade
            let p = pixel(g.project(g.position(k / fps), frame: m.frameIndex), in: rect)
            let spread = (0.5 + age * 0.25) * sc
            // Drifting up: +y here, where y runs up the picture.
            let c = CGPoint(x: p.x + rng.normal() * spread, y: p.y - rng.normal() * spread + age * 0.35 * sc)
            if op > 0 { puffs.append(Puff(c: c, r: max(1, rad), op: op)) }
        }
        guard !puffs.isEmpty else { return nil }
        let blur = 2.5 * sc
        let maxR = puffs.map(\.r).max() ?? 0
        guard let canvas = Canvas(around: puffs.map(\.c), pad: maxR + 3 * blur + 2, clip: rect, gray: true) else { return nil }
        for puff in puffs {
            canvas.ctx.setFillColor(gray: puff.op, alpha: 1)
            canvas.ctx.fillEllipse(in: CGRect(x: puff.c.x - puff.r, y: puff.c.y - puff.r, width: puff.r * 2, height: puff.r * 2))
        }
        let mask = canvas.image()
        let alpha = mask.clampedToExtent().applyingGaussianBlur(sigma: blur).cropped(to: mask.extent)
            .applyingFilter("CIColorClamp", parameters: ["inputMaxComponents": CIVector(x: 0.85, y: 0.85, z: 0.85, w: 1)])
        return tinted(alpha, red: 248 / 255, green: 248 / 255, blue: 248 / 255)
    }

    /// A crisp TV tracer: a red line with a thin white core, fading toward the
    /// tail, and a white ring around the ball while it's in the air.
    private static func broadcast(_ m: TrailMoment, _ pts: [CGPoint], sc: Double, rect: CGRect) -> CIImage? {
        let ringR = 8 * sc
        guard let red = Canvas(around: pts, pad: ringR + 4 * sc + 2, clip: rect, gray: true),
              let white = Canvas(around: pts, pad: ringR + 4 * sc + 2, clip: rect, gray: true) else { return nil }
        for i in 0..<(pts.count - 1) {
            red.ctx.setStrokeColor(gray: pow(1 - m.u[i], 0.7) * m.fade, alpha: 1)
            red.line(pts[i], pts[i + 1], width: max(1, 4.5 * sc))
        }
        for i in 0..<(pts.count - 1) {
            white.ctx.setStrokeColor(gray: 230 / 255 * (1 - m.u[i]) * m.fade, alpha: 1)
            white.line(pts[i], pts[i + 1], width: max(1, 1.4 * sc))
        }
        if m.inFlight, let head = pts.last {
            white.ctx.setStrokeColor(gray: 0.9 * m.fade, alpha: 1)
            white.ctx.setLineWidth(max(1, 1.6 * sc))
            white.ctx.strokeEllipse(in: CGRect(x: head.x - ringR, y: head.y - ringR, width: ringR * 2, height: ringR * 2))
        }
        let line = tinted(red.image(), red: 225 / 255, green: 40 / 255, blue: 40 / 255)
        let core = tinted(white.image(), red: 1, green: 1, blue: 1)
        return core.composited(over: line)
    }

    /// A drawn trail onto `picture` (gamma-encoded, like the trail): over it,
    /// or added for a light style.
    static func composite(_ trail: CIImage, style: TrailStyle, onto picture: CIImage) -> CIImage {
        style.additive
            ? trail.applyingFilter("CILinearDodgeBlendMode", parameters: [kCIInputBackgroundImageKey: picture])
            : trail.composited(over: picture)
    }

    /// A drawn trail at `opacity` (premultiplied, so everything scales).
    static func faded(_ image: CIImage, by opacity: Double) -> CIImage {
        image.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: CIImage.empty(),
            kCIInputMaskImageKey: solid(opacity, opacity, opacity, image.extent),
        ]).cropped(to: image.extent)
    }

    // MARK: Core Image helpers

    /// An opaque colour, raw (no colour management).
    private static func solid(_ r: Double, _ g: Double, _ b: Double, _ extent: CGRect) -> CIImage {
        CIImage(color: .black).applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            "inputBiasVector": CIVector(x: r, y: g, z: b, w: 1),
        ]).cropped(to: extent)
    }

    /// A colour laid through a greyscale mask: premultiplied (colour·m, m).
    private static func tinted(_ mask: CIImage, red: Double, green: Double, blue: Double) -> CIImage {
        solid(red, green, blue, mask.extent).applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: CIImage.empty(),
            kCIInputMaskImageKey: mask,
        ]).cropped(to: mask.extent)
    }

    /// An opaque image's colours times `k` (it stays opaque).
    private static func scaled(_ image: CIImage, by k: Double) -> CIImage {
        image.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: k, y: 0, z: 0, w: 0),
            "inputGVector": CIVector(x: 0, y: k, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: k, w: 0),
            "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
        ])
    }
}

// MARK: - Drawing surface

/// A small bitmap covering some points (padded, inside the picture), drawn
/// in output pixels. Opaque, so later strokes replace earlier ones as the
/// prototype's do.
private struct Canvas {
    let ctx: CGContext
    let origin: CGPoint
    let size: CGSize

    init?(around points: [CGPoint], pad: Double, clip: CGRect, gray: Bool) {
        guard let first = points.first else { return nil }
        var box = CGRect(origin: first, size: .zero)
        for p in points.dropFirst() { box = box.union(CGRect(origin: p, size: .zero)) }
        box = box.insetBy(dx: -pad, dy: -pad).intersection(clip).integral
        guard !box.isNull, box.width >= 1, box.height >= 1 else { return nil }
        let w = Int(box.width), h = Int(box.height)
        let made: CGContext? = gray
            ? CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
            : CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        guard let made else { return nil }
        made.setFillColor(gray: 0, alpha: 1)
        made.fill(CGRect(x: 0, y: 0, width: w, height: h))
        made.translateBy(x: -box.minX, y: -box.minY)
        made.setLineCap(.round)
        made.setShouldAntialias(true)
        ctx = made
        origin = box.origin
        size = box.size
    }

    func line(_ a: CGPoint, _ b: CGPoint, width: Double) {
        ctx.setLineWidth(width)
        ctx.beginPath()
        ctx.move(to: a)
        ctx.addLine(to: b)
        ctx.strokePath()
    }

    /// The drawing, placed where it was drawn, values as they are.
    func image() -> CIImage {
        guard let cg = ctx.makeImage() else { return CIImage.empty() }
        return CIImage(cgImage: cg, options: [.colorSpace: NSNull()])
            .transformed(by: CGAffineTransform(translationX: origin.x, y: origin.y))
    }
}

/// Repeatable randomness per puff (the prototype seeds one generator per
/// puff too), so the contrail doesn't shimmer from frame to frame.
struct SeededRandom {
    private var state: UInt64

    init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }

    /// SplitMix64 → [0, 1).
    mutating func next() -> Double {
        state = state &+ 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        z ^= z >> 31
        return Double(z >> 11) / Double(1 << 53)
    }

    /// Standard normal (Box–Muller).
    mutating func normal() -> Double {
        let u1 = max(next(), 1e-12), u2 = next()
        return (-2 * log(u1)).squareRoot() * cos(2 * .pi * u2)
    }
}
