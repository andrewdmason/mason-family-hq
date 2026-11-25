import SwiftUI

// The country the path climbs through, drawn behind the map (VocabPath.swift):
// a band of ground for each stage, in the colours and with the scenery its
// name promises (pines in Pine Woods, a creek to cross at Creek Crossing, a
// storm in Thunder Notch), running into the next one, with the mountain the
// test is at the top. It moves a little: trees lean, water runs, snow falls.
// Stages not yet reached are under a haze. All of it is drawn in code, none of
// it says anything the map doesn't say in words, and it's still for Reduce
// Motion.

// MARK: - Where things are

/// The map's measurements, which the path and the country behind it share.
enum VocabLay {
    static let row: CGFloat = 136
    static let node: CGFloat = 78
    /// The mountain above the last stage.
    static let peak: CGFloat = 330
    /// Ground below the first.
    static let foot: CGFloat = 40
    /// How wide a stage's name gets.
    static let label: CGFloat = 132

    /// How far left or right of the middle a stage sits: the path winds. Past
    /// the last stage it's the mountain, in the middle.
    static func sway(_ number: Int, of count: Int) -> CGFloat {
        number > count ? 0 : CGFloat(sin(Double(number) * 1.05)) * 84
    }

    /// The trail from one stage's middle down to the middle of the one below.
    static func trail(from start: CGPoint, toX: CGFloat) -> Path {
        var path = Path()
        let end = CGPoint(x: toX, y: start.y + row)
        path.move(to: start)
        path.addCurve(to: end, control1: CGPoint(x: start.x, y: start.y + row * 0.55),
                      control2: CGPoint(x: end.x, y: start.y + row * 0.45))
        return path
    }

    /// About where that trail is, a part of the way down it.
    static func trailX(from: CGFloat, to: CGFloat, part: CGFloat) -> CGFloat {
        let t = min(1, max(0, part))
        let u = 1 - t
        return from * (u * u * u + 3 * u * u * t) + to * (3 * u * t * t + t * t * t)
    }
}

/// A colour that can be mixed with another.
struct VocabTone: Hashable {
    var r: Double
    var g: Double
    var b: Double

    init(_ r: Double, _ g: Double, _ b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    static let white = VocabTone(1, 1, 1)
    static let black = VocabTone(0, 0, 0)
    /// What everything is multiplied by in the dark: night.
    static let night = VocabTone(0.34, 0.40, 0.66)
    static let sky = VocabTone(0.36, 0.62, 0.92)
    static let skyAtNight = VocabTone(0.02, 0.03, 0.10)

    var color: Color { Color(red: r, green: g, blue: b) }

    func mix(_ other: VocabTone, _ t: Double) -> VocabTone {
        VocabTone(r + (other.r - r) * t, g + (other.g - g) * t, b + (other.b - b) * t)
    }

    /// Lighter above nought, darker below.
    func lit(_ by: Double) -> VocabTone { by >= 0 ? mix(.white, by) : mix(.black, -by) }

    func times(_ other: VocabTone) -> VocabTone { VocabTone(r * other.r, g * other.g, b * other.b) }

    /// The ground at each stage, from the grass at the trailhead up through
    /// rock and snow to a night at Star Camp and the dawn at the summit.
    private static let grounds: [VocabTone] = [
        VocabTone(0.62, 0.80, 0.47), VocabTone(0.37, 0.63, 0.41), VocabTone(0.53, 0.77, 0.50), VocabTone(0.33, 0.60, 0.40),
        VocabTone(0.66, 0.71, 0.58), VocabTone(0.87, 0.64, 0.44), VocabTone(0.78, 0.69, 0.54), VocabTone(0.66, 0.84, 0.50),
        VocabTone(0.48, 0.72, 0.66), VocabTone(0.71, 0.72, 0.75), VocabTone(0.74, 0.80, 0.80), VocabTone(0.80, 0.87, 0.94),
        VocabTone(0.76, 0.89, 0.97), VocabTone(0.90, 0.93, 0.98), VocabTone(0.47, 0.49, 0.60), VocabTone(0.82, 0.92, 0.96),
        VocabTone(0.22, 0.25, 0.45), VocabTone(0.52, 0.44, 0.63), VocabTone(0.94, 0.76, 0.73), VocabTone(0.99, 0.91, 0.76),
    ]

    static func ground(_ number: Int) -> VocabTone { grounds[min(max(number, 1), grounds.count) - 1] }

    /// The haze over what's still ahead.
    static func haze(night: Bool) -> (tone: VocabTone, strength: Double) {
        night ? (VocabTone(0.07, 0.08, 0.15), 0.46) : (.white, 0.38)
    }
}

// MARK: - Drawing

/// The same "random" number every time for a thing and what it's for.
private func chance(_ thing: Int, _ salt: Int) -> Double {
    let x = sin(Double(thing) * 127.1 + Double(salt) * 311.7) * 43_758.5453
    return x - x.rounded(.down)
}

/// The part of a second count that's past the last whole one.
private func part(_ x: Double) -> Double { x - x.rounded(.down) }

private func pt(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x, y: y) }

private func oval(_ x: Double, _ y: Double, _ rx: Double, _ ry: Double) -> Path {
    Path(ellipseIn: CGRect(x: x - rx, y: y - ry, width: rx * 2, height: ry * 2))
}

private func shape(_ points: [CGPoint]) -> Path {
    var path = Path()
    path.addLines(points)
    path.closeSubpath()
    return path
}

private func segment(_ from: CGPoint, _ to: CGPoint) -> Path {
    var path = Path()
    path.move(to: from)
    path.addLine(to: to)
    return path
}

private func star(_ at: CGPoint, _ radius: Double) -> Path {
    var points: [CGPoint] = []
    for corner in 0..<8 {
        let angle = Double(corner) * Double.pi / 4
        let r = corner % 2 == 0 ? radius : radius * 0.32
        points.append(pt(at.x + cos(angle) * r, at.y + sin(angle) * r))
    }
    return shape(points)
}

private extension GraphicsContext {
    func paint(_ path: Path, _ tone: VocabTone, _ opacity: Double = 1) {
        fill(path, with: .color(tone.color.opacity(opacity)))
    }

    func line(_ path: Path, _ tone: VocabTone, _ width: Double, _ opacity: Double = 1, dash: [CGFloat] = [], phase: Double = 0) {
        stroke(path, with: .color(tone.color.opacity(opacity)),
               style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round, dash: dash, dashPhase: phase))
    }

    /// A soft round light.
    func glow(_ at: CGPoint, _ radius: Double, _ tone: VocabTone, _ opacity: Double) {
        fill(oval(at.x, at.y, radius, radius),
             with: .radialGradient(Gradient(colors: [tone.color.opacity(opacity), tone.color.opacity(0)]), center: at, startRadius: 0, endRadius: radius))
    }

    /// Night, over everything drawn so far.
    func nightfall(_ size: CGSize) {
        var dark = self
        dark.blendMode = .multiply
        dark.fill(Path(CGRect(origin: .zero, size: size)), with: .color(VocabTone.night.color))
    }

    /// The trail: a worn track once it's been walked, stepping stones before.
    func road(_ path: Path, walked: Bool) {
        let sand = VocabTone(0.95, 0.86, 0.68)
        let edge = VocabTone(0.42, 0.30, 0.18)
        if walked {
            line(path, edge, 17, 0.50)
            line(path, sand, 12)
            line(path, sand.lit(0.5), 2.5, 0.8, dash: [1, 11])
        } else {
            line(path, edge, 10, 0.28, dash: [1, 15])
            line(path, sand.lit(0.25), 7, 0.95, dash: [1, 15])
        }
    }
}

/// The things that stand on the ground. Each is drawn up from the point it stands on.
private enum Scenery {
    static let trunk = VocabTone(0.45, 0.31, 0.20)

    static func shadow(_ c: GraphicsContext, _ p: CGPoint, _ width: Double) {
        c.paint(oval(p.x + width * 0.15, p.y, width, width * 0.30), .black, 0.13)
    }

    static func pine(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, lean: Double, tone: VocabTone, snow: Bool = false) {
        shadow(c, p, 11 * s)
        c.paint(Path(CGRect(x: p.x - 1.6 * s, y: p.y - 7 * s, width: 3.2 * s, height: 7 * s)), trunk)
        for tier in 0..<3 {
            let t = Double(tier)
            let base = p.y - 5 * s - t * 8.5 * s
            let half = (12 - t * 2.8) * s
            let x = p.x + lean * t * 0.6
            let tip = pt(p.x + lean * (t + 1), base - 14 * s)
            c.paint(shape([pt(x - half, base), tip, pt(x + half, base)]), tone.lit(t * 0.07))
            c.paint(shape([pt(x, base), tip, pt(x + half, base)]), tone.lit(t * 0.07 - 0.15))
            if snow {
                let mid = pt((x + tip.x) / 2, base - 7 * s)
                c.paint(shape([pt(mid.x - half * 0.5, mid.y), tip, pt(mid.x + half * 0.5, mid.y)]), .white, 0.95)
            }
        }
    }

    static func tree(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, lean: Double, tone: VocabTone) {
        shadow(c, p, 12 * s)
        c.paint(Path(CGRect(x: p.x - 1.8 * s, y: p.y - 12 * s, width: 3.6 * s, height: 12 * s)), trunk)
        c.paint(oval(p.x - 6 * s + lean * 0.5, p.y - 16 * s, 8 * s, 8 * s), tone.lit(-0.10))
        c.paint(oval(p.x + 6 * s + lean * 0.5, p.y - 17 * s, 8 * s, 8 * s), tone.lit(-0.04))
        c.paint(oval(p.x + lean, p.y - 23 * s, 10 * s, 10 * s), tone)
        c.paint(oval(p.x - 3 * s + lean, p.y - 26 * s, 5 * s, 4.5 * s), tone.lit(0.16))
    }

    static func fern(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, lean: Double, tone: VocabTone) {
        for frond in 0..<5 {
            let angle = (Double(frond) * 30 - 60 + lean * 5) * Double.pi / 180
            let tip = pt(p.x + sin(angle) * 16 * s, p.y - cos(angle) * 13 * s)
            var path = Path()
            path.move(to: p)
            path.addQuadCurve(to: tip, control: pt(p.x + sin(angle) * 4 * s, p.y - 12 * s))
            c.line(path, tone.lit(frond % 2 == 0 ? 0.14 : -0.06), 2.6 * s)
        }
    }

    static func tuft(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, lean: Double, tone: VocabTone) {
        for blade in 0..<3 {
            let x = Double(blade - 1) * 3.2 * s
            c.line(segment(pt(p.x + x * 0.4, p.y), pt(p.x + x + lean, p.y - (6 + Double(blade % 2) * 3) * s)), tone, 1.8 * s)
        }
    }

    static func flower(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, lean: Double, petal: VocabTone) {
        let top = pt(p.x + lean, p.y - 11 * s)
        c.line(segment(p, top), VocabTone(0.30, 0.58, 0.28), 1.6 * s)
        for leaf in 0..<5 {
            let angle = Double(leaf) * 2 * Double.pi / 5
            c.paint(oval(top.x + cos(angle) * 3.2 * s, top.y + sin(angle) * 3.2 * s, 2.6 * s, 2.6 * s), petal)
        }
        c.paint(oval(top.x, top.y, 2 * s, 2 * s), VocabTone(1.0, 0.85, 0.25))
    }

    static func boulder(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, seed: Int, tone: VocabTone) {
        shadow(c, p, 14 * s)
        var outer: [CGPoint] = []
        var inner: [CGPoint] = []
        for corner in 0..<7 {
            let angle = Double(corner) * 2 * Double.pi / 7
            let r = (8 + 5 * chance(seed, corner)) * s
            outer.append(pt(p.x + cos(angle) * r * 1.25, p.y - 7 * s + sin(angle) * r * 0.8))
            inner.append(pt(p.x - 2.5 * s + cos(angle) * r * 0.75, p.y - 9.5 * s + sin(angle) * r * 0.46))
        }
        c.paint(shape(outer), tone.lit(-0.12))
        c.paint(shape(inner), tone.lit(0.16))
    }

    /// A flat-topped tower of banded rock.
    static func mesa(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, seed: Int, tone: VocabTone) {
        let w = (11 + 7 * chance(seed, 1)) * s
        let h = (22 + 14 * chance(seed, 2)) * s
        shadow(c, p, w * 1.2)
        c.paint(shape([pt(p.x - w, p.y), pt(p.x - w * 0.72, p.y - h), pt(p.x + w * 0.72, p.y - h), pt(p.x + w, p.y)]), tone)
        c.paint(shape([pt(p.x + w * 0.2, p.y), pt(p.x + w * 0.12, p.y - h), pt(p.x + w * 0.72, p.y - h), pt(p.x + w, p.y)]), tone.lit(-0.18))
        for band in 1...3 {
            let y = p.y - h * Double(band) / 4
            let half = w * (1 - 0.28 * Double(band) / 4)
            c.line(segment(pt(p.x - half, y), pt(p.x + half, y)), tone.lit(-0.34), 1.2, 0.55)
        }
        c.paint(shape([pt(p.x - w * 0.72, p.y - h), pt(p.x - w * 0.70, p.y - h + 3 * s), pt(p.x + w * 0.70, p.y - h + 3 * s), pt(p.x + w * 0.72, p.y - h)]),
                tone.lit(0.22))
    }

    /// A small peak. Thin makes it a needle.
    static func crag(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, seed: Int, tone: VocabTone, snow: Bool = false, thin: Bool = false) {
        let w = (thin ? 6.5 : 15) * s
        let h = ((thin ? 30 : 20) + 10 * chance(seed, 3)) * s
        let tip = pt(p.x + (chance(seed, 4) - 0.5) * w * 0.6, p.y - h)
        shadow(c, p, w)
        c.paint(shape([pt(p.x - w, p.y), tip, pt(p.x + w * 0.15, p.y)]), tone.lit(0.10))
        c.paint(shape([pt(p.x + w * 0.15, p.y), tip, pt(p.x + w, p.y)]), tone.lit(-0.16))
        if snow {
            let left = pt(tip.x + (p.x - w - tip.x) * 0.36, tip.y + h * 0.36)
            let right = pt(tip.x + (p.x + w - tip.x) * 0.36, tip.y + h * 0.36)
            let dip = pt(tip.x + w * 0.1, tip.y + h * 0.26)
            c.paint(shape([left, tip, right, dip]), .white, 0.96)
        }
    }

    static func steps(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, tone: VocabTone) {
        shadow(c, pt(p.x + 4 * s, p.y), 20 * s)
        for step in 0..<4 {
            let x = p.x - 18 * s + Double(step) * 6 * s
            let y = p.y - 7 * s - Double(step) * 6 * s
            c.paint(Path(roundedRect: CGRect(x: x, y: y, width: 24 * s, height: 7 * s), cornerRadius: 1.5), tone.lit(-0.16))
            c.paint(Path(roundedRect: CGRect(x: x, y: y, width: 24 * s, height: 3.2 * s), cornerRadius: 1.5), tone.lit(0.20))
        }
    }

    /// A cloud, around its middle.
    static func cloud(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, tone: VocabTone, _ opacity: Double = 0.95) {
        var soft = c
        soft.opacity = opacity
        soft.paint(Path(roundedRect: CGRect(x: p.x - 22 * s, y: p.y + 1 * s, width: 46 * s, height: 10 * s), cornerRadius: 5 * s), tone)
        soft.paint(oval(p.x - 13 * s, p.y + 1 * s, 9 * s, 8 * s), tone)
        soft.paint(oval(p.x - 2 * s, p.y - 4 * s, 12 * s, 11 * s), tone)
        soft.paint(oval(p.x + 11 * s, p.y - 1 * s, 10 * s, 9 * s), tone)
    }

    static func shard(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, tone: VocabTone) {
        shadow(c, p, 8 * s)
        c.paint(shape([pt(p.x, p.y - 26 * s), pt(p.x + 6 * s, p.y - 8 * s), pt(p.x + 3 * s, p.y), pt(p.x - 4 * s, p.y), pt(p.x - 6 * s, p.y - 10 * s)]), tone)
        c.paint(shape([pt(p.x, p.y - 26 * s), pt(p.x + 6 * s, p.y - 8 * s), pt(p.x + 3 * s, p.y), pt(p.x, p.y - 6 * s)]), .white, 0.65)
    }

    static func drift(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, shade: VocabTone) {
        c.paint(oval(p.x + 2 * s, p.y - 2 * s, 17 * s, 6 * s), shade, 0.45)
        c.paint(oval(p.x, p.y - 4 * s, 16 * s, 5.5 * s), .white, 0.95)
    }

    static func cairn(_ c: GraphicsContext, _ p: CGPoint, _ s: Double) {
        shadow(c, p, 10 * s)
        let stone = VocabTone(0.62, 0.60, 0.62)
        c.paint(oval(p.x, p.y - 4 * s, 9 * s, 4.5 * s), stone.lit(-0.12))
        c.paint(oval(p.x + 1 * s, p.y - 10.5 * s, 6.5 * s, 3.6 * s), stone)
        c.paint(oval(p.x - 0.5 * s, p.y - 16 * s, 4.5 * s, 2.8 * s), stone.lit(0.14))
        c.paint(oval(p.x, p.y - 20 * s, 2.6 * s, 2 * s), stone.lit(0.26))
    }

    static func tent(_ c: GraphicsContext, _ p: CGPoint, _ s: Double) {
        let cloth = VocabTone(0.96, 0.52, 0.22)
        shadow(c, p, 18 * s)
        c.paint(shape([pt(p.x - 17 * s, p.y), pt(p.x, p.y - 23 * s), pt(p.x + 17 * s, p.y)]), cloth)
        c.paint(shape([pt(p.x + 3 * s, p.y), pt(p.x, p.y - 23 * s), pt(p.x + 17 * s, p.y)]), cloth.lit(-0.22))
        c.paint(shape([pt(p.x - 5 * s, p.y), pt(p.x - 1 * s, p.y - 13 * s), pt(p.x + 3 * s, p.y)]), VocabTone(0.30, 0.16, 0.10))
    }

    static func signpost(_ c: GraphicsContext, _ p: CGPoint, _ s: Double) {
        let wood = VocabTone(0.66, 0.48, 0.30)
        shadow(c, p, 8 * s)
        c.paint(Path(CGRect(x: p.x - 1.6 * s, y: p.y - 28 * s, width: 3.2 * s, height: 28 * s)), wood.lit(-0.25))
        c.paint(shape([pt(p.x - 13 * s, p.y - 27 * s), pt(p.x + 8 * s, p.y - 27 * s), pt(p.x + 14 * s, p.y - 22 * s),
                       pt(p.x + 8 * s, p.y - 17 * s), pt(p.x - 13 * s, p.y - 17 * s)]), wood.lit(0.18))
        c.line(segment(pt(p.x - 8 * s, p.y - 22 * s), pt(p.x + 6 * s, p.y - 22 * s)), wood.lit(-0.3), 1.4, 0.7)
    }

    /// A bird from above. `flap` runs from -1 to 1.
    static func bird(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, flap: Double, tone: VocabTone) {
        let reach = 13 * s
        let lift = 7 * s * flap
        c.paint(shape([pt(p.x - 2 * s, p.y), pt(p.x - reach, p.y - lift), pt(p.x - reach * 0.5, p.y + 3 * s - lift * 0.4)]), tone)
        c.paint(shape([pt(p.x + 2 * s, p.y), pt(p.x + reach, p.y - lift), pt(p.x + reach * 0.5, p.y + 3 * s - lift * 0.4)]), tone)
        c.paint(oval(p.x, p.y + 0.5 * s, 3 * s, 4.5 * s), tone.lit(-0.2))
        c.paint(oval(p.x, p.y - 3.5 * s, 1.8 * s, 1.8 * s), .white)
    }

    static func butterfly(_ c: GraphicsContext, _ p: CGPoint, _ s: Double, flap: Double, tone: VocabTone) {
        let w = max(0.6, 3.6 * abs(flap)) * s
        c.paint(oval(p.x - w, p.y, w, 3.4 * s), tone)
        c.paint(oval(p.x + w, p.y, w, 3.4 * s), tone)
        c.paint(oval(p.x, p.y, 0.7 * s, 2.6 * s), VocabTone(0.2, 0.15, 0.1))
    }
}

// MARK: - A stage's stretch of country

/// What's needed to draw one stage's ground, at one moment.
private struct StageScene {
    let number: Int
    let count: Int
    let size: CGSize
    let time: Double
    let night: Bool
    /// The trail down from here, and the one coming down into here, have been walked.
    let walkedDown: Bool
    let walkedUp: Bool
    /// 0 reached, 0.5 the next one on (the haze starts here), 1 under it.
    let haze: Double

    var w: Double { size.width }
    var h: Double { size.height }
    /// Which of the twenty kinds of country.
    var kind: Int { min(number, 20) }
    var nodeX: Double { w / 2 + VocabLay.sway(number, of: count) }
    var aboveX: Double { w / 2 + VocabLay.sway(number + 1, of: count) }
    var belowX: Double? { number > 1 ? w / 2 + VocabLay.sway(number - 1, of: count) : nil }
    /// The stage's name is on the right of its marker.
    var labelRight: Bool { VocabLay.sway(number, of: count) < 0 }
    /// The open side, away from the name: its middle and how wide it is.
    var far: (x: Double, width: Double) {
        let edge = VocabLay.node / 2
        return labelRight ? ((nodeX - edge) / 2, nodeX - edge) : ((nodeX + edge + w) / 2, w - nodeX - edge)
    }

    /// Where the trail down from here is at a height in this row (below the marker).
    func trailDown(at y: Double) -> Double? {
        belowX.map { VocabLay.trailX(from: nodeX, to: $0, part: (y - h / 2) / h) }
    }

    /// Ground kept clear for something big (the waterfall, the lake, the camp).
    var reserved: CGRect? {
        let far = far
        switch kind {
        case 3, 13: return CGRect(x: 0, y: h * 0.80 - 22, width: w, height: h)
        case 9: return CGRect(x: far.x - 36, y: 0, width: 72, height: h * 0.86)
        case 16: return labelRight ? CGRect(x: 0, y: h * 0.2, width: far.width, height: h * 0.72)
            : CGRect(x: w - far.width, y: h * 0.2, width: far.width, height: h * 0.72)
        case 17: return CGRect(x: far.x - 36, y: h * 0.30, width: 76, height: h * 0.66)
        case 1: return CGRect(x: far.x - 16, y: h * 0.4, width: 32, height: h * 0.34)
        default: return nil
        }
    }

    /// Nothing's in the way of something standing at a point: not the marker, the name, the trail.
    func free(_ p: CGPoint) -> Bool {
        if hypot(p.x - nodeX, p.y - h / 2) < 56 { return false }
        let side = labelRight ? p.x - nodeX : nodeX - p.x
        if side > 30, side < 210, p.y > h / 2 - 30, p.y < h / 2 + 62 { return false }
        if p.y >= h / 2, let x = trailDown(at: p.y), abs(p.x - x) < 24 { return false }
        if p.y < h / 2, abs(p.x - VocabLay.trailX(from: aboveX, to: nodeX, part: (p.y + h / 2) / h)) < 24 { return false }
        if let reserved, reserved.contains(p) { return false }
        return true
    }

    /// Places to stand things, the same every time, nearest the top first so
    /// what's in front is drawn last. More of them on a wider map.
    func spots(_ wanted: Int, _ salt: Int) -> [CGPoint] {
        let most = Int((Double(wanted) * max(1, w / 400)).rounded())
        var found: [CGPoint] = []
        for attempt in 0..<(most * 8) where found.count < most {
            let p = pt(8 + chance(attempt, number * 37 + salt) * (w - 16), 48 + chance(attempt, number * 53 + salt + 1) * (h - 52))
            if free(p), !found.contains(where: { hypot($0.x - p.x, $0.y - p.y) < 15 }) { found.append(p) }
        }
        return found.sorted { $0.y < $1.y }
    }

    /// How far something leans in the breeze.
    func lean(_ thing: Int, _ strength: Double = 1.2) -> Double { sin(time * 1.3 + Double(thing) * 1.7) * strength }

    func scale(_ thing: Int, _ from: Double = 0.8, _ to: Double = 1.15) -> Double { from + chance(thing, number + 7) * (to - from) }

    // MARK: The ground

    func draw(_ c: GraphicsContext) {
        let tone = VocabTone.ground(number)
        let above = number >= count ? tone : tone.mix(.ground(number + 1), 0.5)
        let below = number <= 1 ? tone : tone.mix(.ground(number - 1), 0.5)
        c.fill(Path(CGRect(origin: .zero, size: size)),
               with: .linearGradient(Gradient(colors: [above.color, tone.color, below.color]), startPoint: .zero, endPoint: pt(0, h)))
        // The lie of the land: a couple of ribbons, lighter and darker.
        for ribbon in 0..<2 {
            var top: [CGPoint] = []
            var bottom: [CGPoint] = []
            let across = 150 + chance(number, ribbon) * 90
            let start = chance(number, ribbon + 4) * 6
            var x = -20.0
            while x <= w + 20 {
                let y = h * (0.30 + 0.38 * Double(ribbon)) + sin(x / across + start) * 12
                let thick = 13 + sin(x / (across * 0.6) + start * 2) * 8
                top.append(pt(x, y))
                bottom.append(pt(x, y + thick))
                x += 20
            }
            c.paint(shape(top + bottom.reversed()), tone.lit(ribbon == 0 ? 0.10 : -0.07), 0.55)
        }
        under(c)
        if let belowX { c.road(VocabLay.trail(from: pt(nodeX, h / 2), toX: belowX), walked: walkedDown) }
        c.road(VocabLay.trail(from: pt(aboveX, -h / 2), toX: nodeX), walked: walkedUp)
        // Where the marker stands.
        c.paint(oval(nodeX, h / 2 + VocabLay.node * 0.46, VocabLay.node * 0.56, VocabLay.node * 0.17), .black, 0.16)
        scenery(c)
        if night { c.nightfall(size) }
        lights(c)
        fog(c)
    }

    /// The haze over a stage not yet reached, thinning out toward the one they're on.
    private func fog(_ c: GraphicsContext) {
        guard haze > 0 else { return }
        let (tone, strength) = VocabTone.haze(night: night)
        let full = tone.color.opacity(strength)
        let rect = Path(CGRect(origin: .zero, size: size))
        guard haze < 1 else { return c.fill(rect, with: .color(full)) }
        c.fill(rect, with: .linearGradient(Gradient(stops: [.init(color: full, location: 0), .init(color: full, location: 0.3),
                                                           .init(color: tone.color.opacity(0), location: 1)]),
                                           startPoint: .zero, endPoint: pt(0, h)))
        // Its edge, drifting.
        for puff in 0..<5 {
            let x = part(chance(puff, 61) + time * 0.008 * (1 + Double(puff) * 0.4)) * (w + 160) - 80
            c.glow(pt(x, h * (0.36 + chance(puff, 62) * 0.28)), 46, tone, strength * 1.1)
        }
    }

    // MARK: Under the trail

    /// What the trail goes over: water, a crack in the ice.
    private func under(_ c: GraphicsContext) {
        let far = far
        switch kind {
        case 3:
            // The creek, across the way down, with a footbridge.
            let line = h * 0.80
            var creek = Path()
            var x = -20.0
            creek.move(to: pt(x, line + sin(x / 55 + 1) * 9))
            while x <= w + 20 {
                x += 16
                creek.addLine(to: pt(x, line + sin(x / 55 + 1) * 9))
            }
            c.line(creek, VocabTone(0.36, 0.56, 0.36), 25)
            c.line(creek, VocabTone(0.36, 0.67, 0.90), 18)
            c.line(creek, VocabTone(0.52, 0.80, 0.96), 9, 0.7)
            c.line(creek, .white, 2.2, 0.75, dash: [9, 30], phase: -time * 34)
            c.line(creek.offsetBy(dx: 0, dy: 5), .white, 1.6, 0.5, dash: [6, 38], phase: -time * 26 + 17)
            if let at = trailDown(at: line) {
                let wood = VocabTone(0.70, 0.52, 0.32)
                let deck = CGRect(x: at - 15, y: line + sin(at / 55 + 1) * 9 - 17, width: 30, height: 34)
                c.paint(Path(roundedRect: deck, cornerRadius: 3), wood.lit(-0.3))
                c.paint(Path(roundedRect: deck.insetBy(dx: 2, dy: 0), cornerRadius: 2), wood)
            }
        case 9:
            // The falls, down a rock face into a pool.
            let top = 16.0
            let foot = h * 0.62
            let rock = VocabTone(0.33, 0.44, 0.46)
            c.paint(Path(roundedRect: CGRect(x: far.x - 30, y: top, width: 60, height: foot - top + 4), cornerRadius: 9), rock)
            c.paint(Path(roundedRect: CGRect(x: far.x + 8, y: top, width: 22, height: foot - top + 4), cornerRadius: 9), rock.lit(-0.2))
            c.paint(oval(far.x, foot + 8, 34, 13), VocabTone(0.30, 0.60, 0.80))
            c.paint(Path(CGRect(x: far.x - 10, y: top + 3, width: 20, height: foot - top)), VocabTone(0.78, 0.92, 0.98))
            for streak in 0..<3 {
                let x = far.x - 6 + Double(streak) * 6
                c.line(segment(pt(x, top + 5), pt(x, foot)), .white, 2, 0.9, dash: [7, 11], phase: -time * 70 - Double(streak) * 6)
            }
            for ring in 0..<2 {
                let out = part(time * 0.5 + Double(ring) * 0.5)
                c.stroke(oval(far.x, foot + 8, 8 + out * 24, 3 + out * 9), with: .color(.white.opacity((1 - out) * 0.7)), lineWidth: 1.5)
            }
        case 13:
            // The crevasse, and the bridge of ice over it.
            let line = h * 0.80
            var top: [CGPoint] = []
            var bottom: [CGPoint] = []
            var step = 0
            var x = -10.0
            while x <= w + 20 {
                top.append(pt(x, line - 9 + chance(step, 131) * 7))
                bottom.append(pt(x + 7, line + 9 - chance(step, 132) * 7))
                x += 17
                step += 1
            }
            c.paint(shape(top + bottom.reversed()), VocabTone(0.08, 0.22, 0.42))
            var lip = Path()
            lip.addLines(top)
            c.line(lip, .white, 2, 0.9)
            var depth = Path()
            depth.addLines(bottom.map { pt($0.x, $0.y - 5) })
            c.line(depth, VocabTone(0.30, 0.56, 0.82), 3, 0.7)
            if let at = trailDown(at: line) {
                c.paint(Path(roundedRect: CGRect(x: at - 15, y: line - 17, width: 30, height: 34), cornerRadius: 6), VocabTone(0.60, 0.80, 0.95))
                c.paint(Path(roundedRect: CGRect(x: at - 12, y: line - 17, width: 24, height: 34), cornerRadius: 5), VocabTone(0.90, 0.97, 1.0))
            }
        case 16:
            // The lake, running off the edge of the map.
            let x = labelRight ? 0.0 : w
            let y = h * 0.56
            let rx = min(far.width * 0.86, 170)
            c.paint(oval(x, y, rx + 5, 43), .white, 0.9)
            c.fill(oval(x, y, rx, 38), with: .linearGradient(Gradient(colors: [VocabTone(0.16, 0.46, 0.72).color, VocabTone(0.34, 0.70, 0.86).color]),
                                                            startPoint: pt(0, y - 38), endPoint: pt(0, y + 38)))
            let inX = labelRight ? rx * 0.45 : w - rx * 0.45
            for glint in 0..<4 {
                let gx = inX + (chance(glint, 161) - 0.5) * rx * 0.7
                let gy = y + (chance(glint, 162) - 0.5) * 44
                let shine = max(0, sin(time * 1.4 + Double(glint) * 1.9))
                c.line(segment(pt(gx - 6, gy), pt(gx + 6, gy)), .white, 1.6, shine * 0.8)
            }
            // A floe, and now and then a fish.
            let floe = pt(inX + sin(time * 0.2) * 10 - rx * 0.2, y + 16)
            c.paint(shape([pt(floe.x - 8, floe.y), pt(floe.x - 2, floe.y - 5), pt(floe.x + 9, floe.y - 2), pt(floe.x + 5, floe.y + 4)]), .white, 0.95)
            let leap = part(time / 4.5) / 0.22
            if leap < 1 {
                let fish = pt(inX - 11 + leap * 22, y - 4 - sin(leap * Double.pi) * 20)
                var turned = c
                turned.translateBy(x: fish.x, y: fish.y)
                turned.rotate(by: .radians(-cos(leap * Double.pi) * 1.1))
                turned.paint(oval(0, 0, 5.5, 2.4), VocabTone(0.98, 0.62, 0.30))
                turned.paint(shape([pt(-5, 0), pt(-9, -3), pt(-9, 3)]), VocabTone(0.98, 0.62, 0.30))
            }
            // Where it left the water, and where it went back in.
            if leap < 0.3 { c.stroke(oval(inX - 11, y - 3, 6, 2.2), with: .color(.white.opacity(0.8)), lineWidth: 1.3) }
            if leap > 0.85, leap < 1.5 { c.stroke(oval(inX + 11, y - 3, 4 + leap * 3, 2.4), with: .color(.white.opacity(0.8)), lineWidth: 1.3) }
        default:
            break
        }
    }

    // MARK: On the ground

    /// What stands on the ground and moves over it.
    private func scenery(_ c: GraphicsContext) {
        let far = far
        let tone = VocabTone.ground(number)
        switch kind {
        case 1:
            Scenery.signpost(c, pt(far.x, h * 0.70), 1.1)
            for (i, p) in spots(9, 1).enumerated() {
                switch i % 3 {
                case 0: Scenery.tree(c, p, scale(i), lean: lean(i), tone: VocabTone(0.36, 0.66, 0.34))
                case 1: Scenery.tuft(c, p, scale(i, 1, 1.4), lean: lean(i, 2), tone: tone.lit(-0.28))
                default: Scenery.flower(c, p, scale(i), lean: lean(i, 1.6), petal: VocabTone(1.0, 0.98, 0.92))
                }
            }
            flutter(c, 2, [VocabTone(0.98, 0.72, 0.20), .white])
        case 2:
            for (i, p) in spots(13, 1).enumerated() {
                Scenery.pine(c, p, scale(i, 0.85, 1.25), lean: lean(i, 0.9), tone: VocabTone(0.16, 0.44, 0.30).lit(chance(i, 21) * 0.12))
            }
        case 3:
            for (i, p) in spots(8, 1).enumerated() {
                if i % 2 == 0 { Scenery.tree(c, p, scale(i), lean: lean(i), tone: VocabTone(0.30, 0.62, 0.36)) }
                else { Scenery.tuft(c, p, scale(i, 1, 1.4), lean: lean(i, 2), tone: tone.lit(-0.30)) }
            }
            // Reeds along the bank.
            var reed = 0
            var x = 18.0
            while x < w {
                let y = h * 0.80 + sin(x / 55 + 1) * 9 - 12
                if trailDown(at: h * 0.8).map({ abs($0 - x) > 26 }) ?? true {
                    Scenery.tuft(c, pt(x, y), 1.3, lean: lean(reed, 2.4), tone: VocabTone(0.26, 0.50, 0.26))
                }
                x += 34 + chance(reed, 31) * 30
                reed += 1
            }
        case 4:
            for (i, p) in spots(15, 1).enumerated() {
                if i % 5 == 0 { Scenery.pine(c, p, scale(i, 0.9, 1.2), lean: lean(i, 0.9), tone: VocabTone(0.14, 0.40, 0.28)) }
                else { Scenery.fern(c, p, scale(i, 0.85, 1.3), lean: lean(i, 1.5), tone: VocabTone(0.42, 0.74, 0.36)) }
            }
        case 5:
            for (i, p) in spots(12, 1).enumerated() {
                if i % 4 == 3 { Scenery.tuft(c, p, 1.2, lean: lean(i, 2), tone: VocabTone(0.42, 0.56, 0.32)) }
                else { Scenery.boulder(c, p, scale(i, 0.8, 1.5), seed: number * 100 + i, tone: VocabTone(0.60, 0.60, 0.60).lit(chance(i, 51) * 0.14)) }
            }
        case 6:
            for (i, p) in spots(8, 1).enumerated() {
                Scenery.mesa(c, p, scale(i, 0.8, 1.15), seed: number * 100 + i, tone: VocabTone(0.83, 0.46, 0.30).lit(chance(i, 61) * 0.12))
            }
            // A shout, coming back.
            let from = pt(far.x, h * 0.34)
            for ring in 0..<3 {
                let out = part(time / 3.2 + Double(ring) / 3)
                let r = 6 + out * min(far.width * 0.5, 46)
                c.stroke(oval(from.x, from.y, r, r * 0.6), with: .color(.white.opacity((1 - out) * 0.6)), lineWidth: 2)
            }
        case 7:
            for (i, p) in spots(8, 1).enumerated() {
                Scenery.crag(c, p, scale(i, 0.8, 1.2), seed: number * 100 + i, tone: VocabTone(0.62, 0.52, 0.40).lit(chance(i, 71) * 0.12))
            }
            // The eagle, turning over the open side, and its shadow on the ground.
            let turn = time * 0.55
            let reach = min(far.width * 0.36, 70)
            let at = pt(far.x + cos(turn) * reach, h * 0.36 + sin(turn) * 15)
            c.paint(oval(at.x + 7, at.y + 30, 9, 3), .black, 0.14)
            Scenery.bird(c, at, 1.15, flap: 0.35 + sin(time * 2.4) * 0.45, tone: VocabTone(0.34, 0.22, 0.14))
        case 8:
            let petals = [VocabTone(1.0, 0.45, 0.55), VocabTone(1.0, 0.98, 0.92), VocabTone(0.62, 0.48, 0.95), VocabTone(1.0, 0.72, 0.20)]
            for (i, p) in spots(22, 1).enumerated() {
                if i % 4 == 0 { Scenery.tuft(c, p, 1.3, lean: lean(i, 2), tone: tone.lit(-0.30)) }
                else { Scenery.flower(c, p, scale(i, 0.9, 1.4), lean: lean(i, 1.8), petal: petals[i % petals.count]) }
            }
            flutter(c, 3, [VocabTone(0.35, 0.60, 0.98), VocabTone(1.0, 0.60, 0.20), .white])
        case 9:
            for (i, p) in spots(7, 1).enumerated() {
                if i % 2 == 0 { Scenery.pine(c, p, scale(i, 0.85, 1.15), lean: lean(i, 0.9), tone: VocabTone(0.14, 0.42, 0.36)) }
                else { Scenery.fern(c, p, scale(i), lean: lean(i, 1.5), tone: VocabTone(0.30, 0.66, 0.44)) }
            }
            // Mist off the foot of the falls.
            for puff in 0..<6 {
                let up = part(time * 0.32 + Double(puff) / 6)
                let at = pt(far.x + (chance(puff, 91) - 0.5) * 44, h * 0.66 - up * 26)
                c.glow(at, 9 + up * 10, .white, (1 - up) * 0.75)
            }
        case 10:
            for (i, p) in spots(8, 1).enumerated() {
                if i % 3 == 2 { Scenery.boulder(c, p, scale(i), seed: number * 100 + i, tone: VocabTone(0.62, 0.62, 0.66)) }
                else { Scenery.steps(c, p, scale(i, 0.75, 1.05), tone: VocabTone(0.68, 0.68, 0.72)) }
            }
        case 11:
            for (i, p) in spots(9, 1).enumerated() {
                if i % 3 == 0 { Scenery.boulder(c, p, scale(i), seed: number * 100 + i, tone: VocabTone(0.60, 0.63, 0.66)) }
                else { Scenery.tuft(c, p, scale(i, 1.2, 1.6), lean: 4.5 + lean(i, 2.2), tone: VocabTone(0.48, 0.60, 0.44)) }
            }
            // The wind, and what it carries.
            for gust in 0..<5 {
                let along = part(chance(gust, 111) + time * (0.15 + 0.04 * Double(gust)))
                let x = along * (w + 140) - 70
                let y = 22 + chance(gust, 112) * (h - 44)
                var curl = Path()
                curl.move(to: pt(x - 52, y))
                curl.addQuadCurve(to: pt(x, y), control: pt(x - 26, y + 5))
                curl.addArc(center: pt(x, y - 6), radius: 6, startAngle: .degrees(90), endAngle: .degrees(-150), clockwise: true)
                c.line(curl, .white, 2.2, sin(along * Double.pi) * 0.75)
            }
            for leaf in 0..<5 {
                let along = part(chance(leaf, 113) + time * (0.22 + 0.05 * Double(leaf)))
                let at = pt(along * (w + 40) - 20, 20 + chance(leaf, 114) * (h - 40) + sin(time * 3 + Double(leaf)) * 7)
                var turned = c
                turned.translateBy(x: at.x, y: at.y)
                turned.rotate(by: .radians(time * 4 + Double(leaf)))
                turned.paint(oval(0, 0, 3.4, 1.6), leaf % 2 == 0 ? VocabTone(0.80, 0.52, 0.20) : VocabTone(0.52, 0.64, 0.30))
            }
        case 12:
            for (i, p) in spots(10, 1).enumerated() {
                if i % 3 == 1 { Scenery.drift(c, p, scale(i, 0.9, 1.4), shade: VocabTone(0.52, 0.66, 0.86)) }
                else { Scenery.pine(c, p, scale(i, 0.85, 1.2), lean: lean(i, 0.7), tone: VocabTone(0.20, 0.42, 0.38), snow: true) }
            }
            snowfall(c, 36)
        case 13:
            for (i, p) in spots(9, 1).enumerated() {
                if i % 3 == 2 { Scenery.drift(c, p, scale(i), shade: VocabTone(0.48, 0.66, 0.90)) }
                else { Scenery.shard(c, p, scale(i, 0.8, 1.35), tone: VocabTone(0.56, 0.80, 0.96)) }
            }
            sparkle(c, 9)
        case 14:
            for (i, p) in spots(7, 1).enumerated() {
                if i % 2 == 0 { Scenery.crag(c, p, scale(i, 0.8, 1.1), seed: number * 100 + i, tone: VocabTone(0.62, 0.66, 0.76), snow: true) }
                else { Scenery.drift(c, p, scale(i, 0.9, 1.4), shade: VocabTone(0.58, 0.68, 0.88)) }
            }
            // Cloud, over all of it, and its shade.
            for cloud in 0..<4 {
                let x = part(chance(cloud, 141) + time * 0.011 * (1 + Double(cloud) * 0.35)) * (w + 150) - 75
                let y = 30 + Double(cloud) * 26
                let s = 1.0 + chance(cloud, 142) * 0.5
                c.paint(oval(x + 6, y + 22, 26 * s, 6 * s), VocabTone(0.30, 0.36, 0.56), 0.13)
                Scenery.cloud(c, pt(x, y), s, tone: .white)
            }
        case 15:
            for (i, p) in spots(7, 1).enumerated() {
                Scenery.crag(c, p, scale(i, 0.85, 1.25), seed: number * 100 + i, tone: VocabTone(0.34, 0.35, 0.46))
            }
            for drop in 0..<30 {
                let x = chance(drop, 151) * (w + 20)
                let y = part(chance(drop, 152) + time * (1.3 + chance(drop, 153) * 0.7)) * h
                c.line(segment(pt(x, y), pt(x - 3.5, y + 10)), VocabTone(0.84, 0.90, 1.0), 1.3, sin(y / h * Double.pi) * 0.6)
            }
            for (cloud, at) in storm.enumerated() {
                Scenery.cloud(c, at, 1.25 + chance(cloud, 155) * 0.4, tone: VocabTone(0.27, 0.28, 0.37), 0.96)
            }
        case 16:
            for (i, p) in spots(8, 1).enumerated() {
                if i % 2 == 0 { Scenery.shard(c, p, scale(i, 0.8, 1.2), tone: VocabTone(0.58, 0.82, 0.96)) }
                else { Scenery.drift(c, p, scale(i, 0.9, 1.4), shade: VocabTone(0.48, 0.68, 0.88)) }
            }
        case 17:
            for (i, p) in spots(6, 1).enumerated() {
                Scenery.pine(c, p, scale(i, 0.85, 1.2), lean: lean(i, 0.6), tone: VocabTone(0.12, 0.26, 0.34), snow: true)
            }
            Scenery.tent(c, pt(far.x - 10, h * 0.62), 1.05)
            let fire = pt(far.x + 20, h * 0.68)
            c.line(segment(pt(fire.x - 6, fire.y + 1), pt(fire.x + 6, fire.y - 1)), VocabTone(0.36, 0.22, 0.14), 3)
            c.line(segment(pt(fire.x - 6, fire.y - 1), pt(fire.x + 6, fire.y + 1)), VocabTone(0.30, 0.18, 0.12), 3)
        case 18:
            for (i, p) in spots(13, 1).enumerated() {
                Scenery.crag(c, p, scale(i, 0.85, 1.25), seed: number * 100 + i, tone: VocabTone(0.40, 0.31, 0.52).lit(chance(i, 181) * 0.14), thin: true)
            }
            for wisp in 0..<4 {
                let x = part(chance(wisp, 182) + time * 0.045 * (1 + Double(wisp) * 0.5)) * (w + 220) - 110
                c.paint(oval(x, 30 + chance(wisp, 183) * (h - 60), 54, 5), .white, 0.30)
            }
        case 19:
            for (i, p) in spots(9, 1).enumerated() {
                if i % 3 == 0 { Scenery.crag(c, p, scale(i, 0.8, 1.1), seed: number * 100 + i, tone: VocabTone(0.62, 0.52, 0.62), snow: true) }
                else { Scenery.drift(c, p, scale(i, 0.9, 1.5), shade: VocabTone(0.80, 0.56, 0.66)) }
            }
            flags(c)
            // Snow, blown off the ground.
            for grain in 0..<22 {
                let x = part(chance(grain, 191) + time * (0.22 + chance(grain, 192) * 0.2)) * (w + 20) - 10
                let y = 10 + chance(grain, 193) * (h - 20) + sin(time * 2 + Double(grain)) * 3
                c.paint(oval(x, y, 3, 1), .white, 0.85)
            }
        default:
            for (i, p) in spots(8, 1).enumerated() {
                if i % 4 == 0 { Scenery.cairn(c, p, scale(i, 0.9, 1.2)) }
                else { Scenery.drift(c, p, scale(i, 0.9, 1.5), shade: VocabTone(0.92, 0.70, 0.52)) }
            }
            sparkle(c, 12)
        }
    }

    /// Where the storm's clouds are.
    private var storm: [CGPoint] {
        (0..<3).map { cloud in
            pt(part(chance(cloud, 154) + time * 0.009 * (1 + Double(cloud) * 0.5)) * (w + 160) - 80, 30 + Double(cloud) * 24)
        }
    }

    private func flutter(_ c: GraphicsContext, _ count: Int, _ tones: [VocabTone]) {
        let far = far
        for one in 0..<count {
            let k = Double(one)
            let at = pt(far.x + sin(time * 0.6 + k * 2.2) * far.width * 0.32, h * 0.42 + cos(time * 0.8 + k * 1.4) * 18 + k * 12)
            Scenery.butterfly(c, at, 1, flap: sin(time * 9 + k * 2), tone: tones[one % tones.count])
        }
    }

    private func snowfall(_ c: GraphicsContext, _ flakes: Int) {
        for flake in 0..<flakes {
            let down = part(chance(flake, 121) + time * (0.09 + chance(flake, 122) * 0.08))
            let x = chance(flake, 123) * w + sin(time * 0.8 + Double(flake)) * 8
            let r = 1.3 + chance(flake, 124) * 1.4
            c.paint(oval(x, down * h, r, r), .white, sin(down * Double.pi) * 0.95)
        }
    }

    private func sparkle(_ c: GraphicsContext, _ count: Int) {
        for one in 0..<count {
            let shine = pow(max(0, sin(time * 1.8 + Double(one) * 2.1)), 3)
            let at = pt(10 + chance(one, number + 201) * (w - 20), 10 + chance(one, number + 202) * (h - 20))
            c.paint(star(at, 2 + shine * 4), .white, shine)
        }
    }

    /// A line of flags between two poles, snapping in the wind.
    private func flags(_ c: GraphicsContext) {
        let far = far
        let reach = min(far.width * 0.36, 66)
        let left = pt(far.x - reach, h * 0.44)
        let right = pt(far.x + reach, h * 0.60)
        let pole = VocabTone(0.40, 0.30, 0.26)
        c.line(segment(pt(left.x, left.y + 26), left), pole, 2)
        c.line(segment(pt(right.x, right.y + 26), right), pole, 2)
        let sag = pt((left.x + right.x) / 2, (left.y + right.y) / 2 + 12)
        var cord = Path()
        cord.move(to: left)
        cord.addQuadCurve(to: right, control: sag)
        c.line(cord, pole, 1, 0.8)
        let cloths = [VocabTone(0.20, 0.50, 0.90), .white, VocabTone(0.90, 0.24, 0.22), VocabTone(0.22, 0.66, 0.40), VocabTone(0.99, 0.80, 0.20)]
        for flag in 0..<6 {
            let t = (Double(flag) + 0.5) / 6
            let u = 1 - t
            let x = u * u * left.x + 2 * u * t * sag.x + t * t * right.x
            let y = u * u * left.y + 2 * u * t * sag.y + t * t * right.y
            let blow = 2 + sin(time * 7 + Double(flag) * 1.3) * 2.5
            c.paint(shape([pt(x - 4, y), pt(x + 4, y + 1), pt(x + 4 + blow, y + 11), pt(x - 4 + blow, y + 10)]), cloths[flag % cloths.count])
        }
    }

    // MARK: Lights

    /// What shines, and so is drawn after night has fallen on the rest.
    private func lights(_ c: GraphicsContext) {
        let far = far
        switch kind {
        case 4:
            // Fireflies.
            for fly in 0..<9 {
                let k = Double(fly)
                let at = pt(10 + chance(fly, 41) * (w - 20) + sin(time * 0.6 + k) * 7, 12 + chance(fly, 42) * (h - 24) + cos(time * 0.5 + k * 2) * 6)
                let lit = max(0, sin(time * 1.5 + k * 1.3))
                c.glow(at, 7, VocabTone(0.96, 1.0, 0.55), lit * 0.6)
                c.paint(oval(at.x, at.y, 1.5, 1.5), VocabTone(0.98, 1.0, 0.70), lit)
            }
        case 15:
            // Lightning, twice, every few seconds.
            let since = time.truncatingRemainder(dividingBy: 5.5)
            guard since < 0.10 || (since > 0.18 && since < 0.30) else { return }
            let strike = Int(time / 5.5)
            let from = storm[strike % 3]
            var bolt = Path()
            var at = pt(from.x, from.y + 8)
            bolt.move(to: at)
            for leg in 0..<5 {
                at = pt(at.x + (chance(strike, leg + 156) - 0.5) * 26, min(h - 6, at.y + 13 + chance(strike, leg + 166) * 6))
                bolt.addLine(to: at)
            }
            c.fill(Path(CGRect(origin: .zero, size: size)),
                   with: .linearGradient(Gradient(colors: [.white.opacity(0), .white.opacity(0.26), .white.opacity(0)]), startPoint: .zero, endPoint: pt(0, h)))
            c.line(bolt, .white, 7, 0.35)
            c.line(bolt, VocabTone(1.0, 0.97, 0.72), 2.4)
        case 17:
            // The fire, and the stars over the camp.
            let fire = pt(far.x + 20, h * 0.68)
            let flick = sin(time * 11) * 0.5 + sin(time * 17.3) * 0.5
            c.glow(fire, 38 + flick * 4, VocabTone(1.0, 0.62, 0.22), 0.55)
            let tall = 12 + flick * 3
            c.paint(shape([pt(fire.x - 4.5, fire.y), pt(fire.x - 2, fire.y - tall * 0.5), pt(fire.x + flick, fire.y - tall), pt(fire.x + 3, fire.y - tall * 0.45), pt(fire.x + 4.5, fire.y)]),
                    VocabTone(1.0, 0.52, 0.16))
            c.paint(shape([pt(fire.x - 2.2, fire.y), pt(fire.x, fire.y - tall * 0.55), pt(fire.x + 2.2, fire.y)]), VocabTone(1.0, 0.90, 0.45))
            for one in 0..<16 {
                let shine = 0.35 + 0.65 * max(0, sin(time * 1.2 + Double(one) * 2.4))
                let at = pt(8 + chance(one, 171) * (w - 16), 8 + chance(one, 172) * (h - 16))
                guard hypot(at.x - fire.x, at.y - fire.y) > 44 else { continue }
                c.paint(star(at, 1.6 + chance(one, 173) * 2.6), VocabTone(1.0, 0.97, 0.84), shine)
            }
            let fall = part(time / 7) / 0.09
            if fall < 1 {
                let head = pt(w * 0.15 + fall * w * 0.5, 14 + fall * 34)
                c.stroke(segment(pt(head.x - 34, head.y - 14), head),
                         with: .linearGradient(Gradient(colors: [.white.opacity(0), .white]), startPoint: pt(head.x - 34, head.y - 14), endPoint: head),
                         lineWidth: 2)
            }
        default:
            break
        }
    }
}

// MARK: - The views

/// One stage's stretch of country, behind its marker.
struct VocabTerrain: View {
    let number: Int
    let count: Int
    let walkedDown: Bool
    let walkedUp: Bool
    let haze: Double
    @State private var onScreen = false
    @Environment(\.accessibilityReduceMotion) private var still
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        // Thirty times a second is plenty for leaves and water, and not at all while it's scrolled away.
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: still || !onScreen)) { timeline in
            Canvas { context, size in
                let time = still ? 0 : timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 36_000)
                StageScene(number: number, count: count, size: size, time: time, night: scheme == .dark,
                           walkedDown: walkedDown, walkedUp: walkedUp, haze: haze).draw(context)
            }
        }
        .onScrollVisibilityChange(threshold: 0.01) { onScreen = $0 }
        .accessibilityHidden(true)
    }
}

/// The mountain above the last stage: the test, with the sun coming up behind it.
struct VocabPeak: View {
    /// The last stage, which the trail goes down to.
    let count: Int
    /// The last stage is still under the haze.
    let hazed: Bool
    @State private var onScreen = false
    @Environment(\.accessibilityReduceMotion) private var still
    @Environment(\.colorScheme) private var scheme

    /// The top of the sky, for whatever's above the map.
    static func sky(night: Bool) -> VocabTone {
        night ? VocabTone.sky.mix(.skyAtNight, 0.7).times(.night) : .sky
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: still || !onScreen)) { timeline in
            Canvas { context, size in
                let time = still ? 0 : timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 36_000)
                draw(context, size, time)
            }
        }
        .onScrollVisibilityChange(threshold: 0.01) { onScreen = $0 }
        .accessibilityHidden(true)
    }

    private func draw(_ c: GraphicsContext, _ size: CGSize, _ time: Double) {
        let night = scheme == .dark
        let w = Double(size.width)
        let h = Double(size.height)
        let mid = w / 2
        let all = Path(CGRect(origin: .zero, size: size))
        c.fill(all, with: .linearGradient(Gradient(colors: [VocabTone.sky.color, VocabTone(0.74, 0.86, 0.97).color, VocabTone(1.0, 0.87, 0.70).color]),
                                          startPoint: .zero, endPoint: pt(0, h * 0.8)))
        if night {
            c.fill(all, with: .linearGradient(Gradient(colors: [VocabTone.skyAtNight.color.opacity(0.7), VocabTone.skyAtNight.color.opacity(0)]),
                                              startPoint: .zero, endPoint: pt(0, h * 0.75)))
        }

        // The sun, and its rays going round.
        let sun = pt(mid + min(w * 0.24, 150), h * 0.40)
        if !night {
            for ray in 0..<10 {
                let angle = time * 0.05 + Double(ray) * Double.pi / 5
                let far = 320.0
                c.paint(shape([sun, pt(sun.x + cos(angle - 0.085) * far, sun.y + sin(angle - 0.085) * far),
                               pt(sun.x + cos(angle + 0.085) * far, sun.y + sin(angle + 0.085) * far)]), VocabTone(1.0, 0.96, 0.78), 0.20)
            }
            c.glow(sun, 70, VocabTone(1.0, 0.90, 0.60), 0.8)
            c.paint(oval(sun.x, sun.y, 23, 23), VocabTone(1.0, 0.94, 0.70))
        }

        // The ranges behind.
        range(c, w, h, base: h * 0.70, rise: 54, salt: 5, tone: VocabTone(0.64, 0.74, 0.90))
        for cloud in 0..<3 {
            let x = part(chance(cloud, 301) + time * 0.006 * (1 + Double(cloud) * 0.5)) * (w + 160) - 80
            Scenery.cloud(c, pt(x, h * (0.34 + Double(cloud) * 0.10)), 1.1 + chance(cloud, 302) * 0.5, tone: .white, 0.9)
        }
        range(c, w, h, base: h * 0.80, rise: 50, salt: 9, tone: VocabTone(0.49, 0.59, 0.80))

        // The mountain.
        let top = pt(mid, h * 0.36)
        let reach = min(w * 0.47, 200)
        let left = pt(mid - reach, h)
        let right = pt(mid + reach * 1.1, h)
        let rock = VocabTone(0.47, 0.47, 0.60)
        func along(_ to: CGPoint, _ t: Double) -> CGPoint { pt(top.x + (to.x - top.x) * t, top.y + (to.y - top.y) * t) }
        c.paint(shape([left, top, right]), rock.lit(0.10))
        // The side away from the sun, down a broken ridge.
        var ridge: [CGPoint] = [top]
        for step in 1...6 {
            let t = Double(step) / 6
            ridge.append(pt(mid - 6 + (step % 2 == 0 ? -9.0 : 10.0) - t * 18, top.y + (h - top.y) * t))
        }
        c.paint(shape(ridge + [left]), rock.lit(-0.16))
        // Snow, from the top down to a ragged line.
        let line = 0.40
        var snow: [CGPoint] = [along(left, line), top, along(right, line)]
        for tooth in 1..<8 {
            let t = Double(tooth) / 8
            let edge = along(right, line)
            let other = along(left, line)
            snow.append(pt(edge.x + (other.x - edge.x) * t, edge.y + (tooth % 2 == 0 ? -11.0 : 12.0) + chance(tooth, 311) * 8))
        }
        c.paint(shape(snow), .white)
        c.paint(shape([top, ridge[1], ridge[2], pt(ridge[2].x - 30, ridge[2].y + 6), along(left, line)]), VocabTone(0.78, 0.86, 0.98))
        for patch in 0..<3 {
            let at = along(right, 0.55 + Double(patch) * 0.13)
            c.paint(shape([pt(at.x - 34, at.y + 4), pt(at.x - 6, at.y - 3), pt(at.x - 16, at.y + 12)]), .white, 0.85)
        }

        // The flag on top.
        c.line(segment(top, pt(top.x, top.y - 26)), VocabTone(0.30, 0.24, 0.24), 2)
        var cloth: [CGPoint] = []
        var under: [CGPoint] = []
        for step in 0...8 {
            let u = Double(step) / 8
            let wave = sin(time * 5 - u * 5) * 3 * u
            cloth.append(pt(top.x + u * 24, top.y - 26 + wave))
            under.append(pt(top.x + u * 24, top.y - 13 + wave * 1.2 - u * 2))
        }
        c.fill(shape(cloth + under.reversed()), with: .color(TuttlesLook.accent))

        // The last stage's ground, coming up to meet it, and the trail on.
        let ground = VocabTone.ground(count)
        var hill: [CGPoint] = []
        var x = -20.0
        while x <= w + 20 {
            hill.append(pt(x, h - 44 + sin(x / 80 + 2) * 9))
            x += 20
        }
        c.fill(shape(hill + [pt(w + 20, h), pt(-20, h)]),
               with: .linearGradient(Gradient(colors: [ground.lit(0.22).color, ground.color]), startPoint: pt(0, h - 50), endPoint: pt(0, h)))
        c.road(VocabLay.trail(from: pt(mid, h - VocabLay.row / 2), toX: mid + VocabLay.sway(count, of: count)), walked: false)

        if night {
            c.nightfall(size)
            for one in 0..<40 {
                let at = pt(chance(one, 321) * w, chance(one, 322) * h * 0.62)
                let shine = 0.3 + 0.7 * max(0, sin(time * 1.1 + Double(one) * 2.3))
                c.paint(star(at, 1.2 + chance(one, 323) * 2.2), VocabTone(1.0, 0.97, 0.86), shine)
            }
            c.glow(sun, 60, VocabTone(0.86, 0.90, 1.0), 0.45)
            c.paint(oval(sun.x, sun.y, 19, 19), VocabTone(0.96, 0.96, 0.90))
            c.paint(oval(sun.x + 6, sun.y - 5, 4, 4), VocabTone(0.84, 0.85, 0.82), 0.7)
            c.paint(oval(sun.x - 7, sun.y + 6, 3, 3), VocabTone(0.84, 0.85, 0.82), 0.7)
        }
        if hazed {
            let (tone, strength) = VocabTone.haze(night: night)
            c.fill(all, with: .linearGradient(Gradient(colors: [tone.color.opacity(0), tone.color.opacity(strength)]),
                                              startPoint: pt(0, h * 0.62), endPoint: pt(0, h)))
        }
    }

    /// A line of far mountains.
    private func range(_ c: GraphicsContext, _ w: Double, _ h: Double, base: Double, rise: Double, salt: Int, tone: VocabTone) {
        var points: [CGPoint] = [pt(-10, h)]
        var step = 0
        var x = -10.0
        while x <= w + 50 {
            points.append(pt(x, base - (step % 2 == 0 ? rise * (0.4 + chance(step, salt) * 0.6) : rise * 0.15 * chance(step, salt + 1))))
            x += 26 + chance(step, salt + 2) * 22
            step += 1
        }
        points.append(pt(w + 50, h))
        c.paint(shape(points), tone)
    }
}

/// All of it, the height of the map and laid out the way the map is: the
/// mountain, each stage's country from the last down to the first, and the
/// ground below. Beyond the top it's sky and beyond the bottom grass, for when
/// the map's pulled past its ends.
struct VocabLandscape: View {
    let path: VocabPath
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let count = path.stages.count
        let current = path.current?.number
        let night = scheme == .dark
        let grass = night ? VocabTone.ground(1).times(.night) : VocabTone.ground(1)
        VStack(spacing: 0) {
            VocabPeak(count: count, hazed: current.map { $0 < count } ?? false)
                .frame(height: VocabLay.peak)
                .background(alignment: .top) {
                    VocabPeak.sky(night: night).color.frame(height: 1200).offset(y: -1199)
                }
            ForEach(path.stages.reversed()) { stage in
                VocabTerrain(number: stage.number, count: count,
                             walkedDown: stage.number > 1 && path.stages[stage.number - 2].cleared,
                             walkedUp: stage.cleared && stage.number < count,
                             haze: current.map { stage.number > $0 + 1 ? 1 : stage.number == $0 + 1 ? 0.5 : 0 } ?? 0)
                    .frame(height: VocabLay.row)
            }
            grass.color
                .frame(height: VocabLay.foot)
                .background(alignment: .bottom) { grass.color.frame(height: 1200).offset(y: 1199) }
        }
    }
}
