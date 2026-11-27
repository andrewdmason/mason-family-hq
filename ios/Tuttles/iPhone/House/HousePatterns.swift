import SceneKit
import UIKit

// Patterns for walls and floors, drawn in code: wallpapers (stripes, dots,
// stars, clouds, leaves, diamonds, panelling, brick, rockets) and the newer
// floors (hexagons, harlequin, terrazzo, wide planks, hazard stripes, lava).
// Each is drawn once to a square that repeats, in two colours: the ground
// and what's on it. A wallpaper's square is two metres of wall; a floor's is
// four metres, as the first floors' are (HouseProps.floorMaterial).

enum HousePatterns {
    /// The floors drawn here, by name.
    static let floors: Set<String> = ["hex", "harlequin", "terrazzo", "planks", "hazard", "lava"]

    private static func ui(_ hex: String) -> UIColor { MathLookKit.color(hex) }

    private static func disc(_ c: CGContext, _ color: UIColor, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) {
        c.setFillColor(color.cgColor)
        c.fillEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
    }

    private static func poly(_ c: CGContext, _ color: UIColor, _ points: [CGPoint]) {
        guard let first = points.first else { return }
        c.setFillColor(color.cgColor)
        c.move(to: first)
        for p in points.dropFirst() { c.addLine(to: p) }
        c.closePath()
        c.fillPath()
    }

    private static func scatter(_ n: Int, seed: UInt64) -> [(CGFloat, CGFloat, CGFloat)] {
        var rng = MathRNG(seed: seed)
        return (0..<n).map { _ in (CGFloat(rng.unit()), CGFloat(rng.unit()), CGFloat(rng.unit())) }
    }

    /// Something drawn at a point and again wherever it would run off an edge, so the square repeats without a seam.
    private static func wrapped(_ w: CGFloat, _ x: CGFloat, _ y: CGFloat, _ reach: CGFloat, _ draw: (CGFloat, CGFloat) -> Void) {
        for dx in [-w, 0, w] where x + dx > -reach && x + dx < w + reach {
            for dy in [-w, 0, w] where y + dy > -reach && y + dy < w + reach { draw(x + dx, y + dy) }
        }
    }

    // MARK: Wallpaper

    /// A wallpaper: its pattern, the colour of the paper and of what's printed on it.
    static func paper(_ pattern: String, _ a: String, _ b: String) -> SCNMaterial {
        MathMat.drawn("house-paper-\(pattern)-\(a)-\(b)", 512, 512) { c, size in
            let w = size.width
            let ground = ui(a), ink = ui(b)
            c.setFillColor(ground.cgColor)
            c.fill(CGRect(origin: .zero, size: size))
            switch pattern {
            case "stripes":
                // Eight to the square: stripes a hand wide, up and down.
                c.setFillColor(ink.cgColor)
                for i in 0..<8 { c.fill(CGRect(x: (CGFloat(i) + 0.25) * w / 8, y: 0, width: w / 16, height: w)) }
            case "dots":
                for i in 0..<6 { for j in 0..<6 {
                    let x = (CGFloat(i) + (j % 2 == 0 ? 0.25 : 0.75)) * w / 6, y = (CGFloat(j) + 0.5) * w / 6
                    disc(c, ink, x, y, w / 46)
                } }
            case "stars":
                for p in scatter(26, seed: 41) {
                    wrapped(w, p.0 * w, p.1 * w, 30) { x, y in star(c, ink, x, y, 7 + p.2 * 13) }
                }
                for p in scatter(60, seed: 43) { disc(c, ink.withAlphaComponent(0.7), p.0 * w, p.1 * w, 1.5 + p.2 * 1.5) }
            case "clouds":
                for p in scatter(7, seed: 47) {
                    let r = 26 + p.2 * 16
                    wrapped(w, p.0 * w, p.1 * w, r * 3) { x, y in
                        for (dx, dy, k) in [(-1.0, 0.15, 0.75), (0.0, -0.2, 1.0), (1.0, 0.1, 0.8), (0.3, 0.3, 0.7), (-0.4, 0.35, 0.6)] as [(CGFloat, CGFloat, CGFloat)] {
                            disc(c, ink, x + dx * r, y + dy * r, r * k)
                        }
                    }
                }
            case "leaves":
                for (i, p) in scatter(34, seed: 53).enumerated() {
                    let long = 30 + p.2 * 26, turn = CGFloat(i) * 2.4
                    wrapped(w, p.0 * w, p.1 * w, long) { x, y in
                        c.saveGState()
                        c.translateBy(x: x, y: y)
                        c.rotate(by: turn)
                        c.setFillColor((i % 3 == 0 ? ink.shaded(0.8) : ink).cgColor)
                        c.addPath(UIBezierPath(ovalIn: CGRect(x: -long / 2, y: -long / 5, width: long, height: long / 2.5)).cgPath)
                        c.fillPath()
                        c.setStrokeColor(ground.withAlphaComponent(0.6).cgColor)
                        c.setLineWidth(2)
                        c.move(to: CGPoint(x: -long / 2, y: 0)); c.addLine(to: CGPoint(x: long / 2, y: 0)); c.strokePath()
                        c.restoreGState()
                    }
                }
            case "diamonds":
                let n = 4, s = w / CGFloat(n)
                for i in 0..<n { for j in 0..<n where (i + j) % 2 == 0 {
                    let x = (CGFloat(i) + 0.5) * s, y = (CGFloat(j) + 0.5) * s
                    poly(c, ink, [CGPoint(x: x, y: y - s), CGPoint(x: x + s / 2, y: y), CGPoint(x: x, y: y + s), CGPoint(x: x - s / 2, y: y)])
                } }
                // A thin line crossing through them, as on a jumper.
                c.setStrokeColor(ground.shaded(0.75).cgColor)
                c.setLineWidth(2)
                for i in -n...(n * 2) {
                    c.move(to: CGPoint(x: CGFloat(i) * s, y: 0)); c.addLine(to: CGPoint(x: CGFloat(i) * s + w / 2, y: w)); c.strokePath()
                    c.move(to: CGPoint(x: CGFloat(i) * s, y: 0)); c.addLine(to: CGPoint(x: CGFloat(i) * s - w / 2, y: w)); c.strokePath()
                }
            case "panels":
                // Boards up and down, with a rail across.
                c.setStrokeColor(ink.cgColor)
                c.setLineWidth(5)
                for i in 0...8 { let x = CGFloat(i) * w / 8; c.move(to: CGPoint(x: x, y: 0)); c.addLine(to: CGPoint(x: x, y: w)); c.strokePath() }
                c.setFillColor(ink.cgColor)
                c.fill(CGRect(x: 0, y: w * 0.47, width: w, height: w * 0.045))
            case "bricks":
                c.setFillColor(ink.cgColor)
                c.fill(CGRect(origin: .zero, size: size))
                let rows = 16, across = 5
                let h = w / CGFloat(rows), bw = w / CGFloat(across)
                for r in 0..<rows { for i in -1..<across {
                    let x = (CGFloat(i) + (r % 2 == 0 ? 0 : 0.5)) * bw
                    let rect = CGRect(x: x + 2, y: CGFloat(r) * h + 2, width: bw - 4, height: h - 4)
                    c.setFillColor(((r * 3 + i * 5) % 4 == 0 ? ground.shaded(0.88) : ground).cgColor)
                    c.fill(rect)
                } }
            case "rockets":
                for p in scatter(80, seed: 61) { disc(c, UIColor.white.withAlphaComponent(0.8), p.0 * w, p.1 * w, 1 + p.2 * 2) }
                for (i, p) in scatter(9, seed: 67).enumerated() {
                    wrapped(w, p.0 * w, p.1 * w, 50) { x, y in
                        if i % 3 == 0 {
                            // A planet with a ring.
                            disc(c, ui(["f2c230", "5fb0e8", "ef8fb5"][i % 3 == 0 ? (i / 3) % 3 : 0]), x, y, 20)
                            c.setStrokeColor(UIColor.white.withAlphaComponent(0.85).cgColor)
                            c.setLineWidth(4)
                            c.strokeEllipse(in: CGRect(x: x - 32, y: y - 8, width: 64, height: 16))
                        } else {
                            rocket(c, ink, x, y, turn: CGFloat(i) * 0.9)
                        }
                    }
                }
            default:
                break
            }
        }
    }

    private static func star(_ c: CGContext, _ color: UIColor, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) {
        var points: [CGPoint] = []
        for i in 0..<10 {
            let a = CGFloat(i) * .pi / 5 - .pi / 2, d = i % 2 == 0 ? r : r * 0.45
            points.append(CGPoint(x: x + cos(a) * d, y: y + sin(a) * d))
        }
        poly(c, color, points)
    }

    private static func rocket(_ c: CGContext, _ color: UIColor, _ x: CGFloat, _ y: CGFloat, turn: CGFloat) {
        c.saveGState()
        c.translateBy(x: x, y: y)
        c.rotate(by: turn)
        poly(c, UIColor.white, [CGPoint(x: -10, y: 22), CGPoint(x: -10, y: -8), CGPoint(x: 0, y: -30), CGPoint(x: 10, y: -8), CGPoint(x: 10, y: 22)])
        poly(c, color, [CGPoint(x: -10, y: -8), CGPoint(x: 0, y: -30), CGPoint(x: 10, y: -8)])
        poly(c, color, [CGPoint(x: -10, y: 8), CGPoint(x: -20, y: 26), CGPoint(x: -10, y: 22)])
        poly(c, color, [CGPoint(x: 10, y: 8), CGPoint(x: 20, y: 26), CGPoint(x: 10, y: 22)])
        disc(c, ui("5fb0e8"), 0, 2, 5)
        poly(c, ui("ffcf33"), [CGPoint(x: -6, y: 22), CGPoint(x: 0, y: 38), CGPoint(x: 6, y: 22)])
        c.restoreGState()
    }

    // MARK: Floors

    static func floor(_ pattern: String, _ a: String, _ b: String) -> SCNMaterial {
        MathMat.drawn("house-floor2-\(pattern)-\(a)-\(b)", 512, 512) { c, size in
            let w = size.width
            let ground = ui(a), ink = ui(b)
            c.setFillColor(ground.cgColor)
            c.fill(CGRect(origin: .zero, size: size))
            switch pattern {
            case "hex":
                // Hexagon tiles with the grout showing: eight across the square, rows offset.
                c.setFillColor(ink.cgColor)
                c.fill(CGRect(origin: .zero, size: size))
                let across = 8, rows = 8
                let dx = w / CGFloat(across), dy = w / CGFloat(rows), r = dx / 1.78
                for j in -1...rows { for i in -1...across {
                    let x = (CGFloat(i) + (j % 2 == 0 ? 0.5 : 0)) * dx, y = (CGFloat(j) + 0.5) * dy
                    var points: [CGPoint] = []
                    for k in 0..<6 { let t = CGFloat(k) * .pi / 3 + .pi / 6; points.append(CGPoint(x: x + cos(t) * r, y: y + sin(t) * r * (dy / dx) * 1.15)) }
                    poly(c, (i + j * 2) % 5 == 0 ? ground.shaded(0.93) : ground, points)
                } }
            case "harlequin":
                let n = 8, s = w / CGFloat(n)
                for i in -1...n { for j in -1...n where (i + j) % 2 == 0 {
                    let x = (CGFloat(i) + 0.5) * s, y = (CGFloat(j) + 0.5) * s
                    poly(c, ink, [CGPoint(x: x, y: y - s), CGPoint(x: x + s, y: y), CGPoint(x: x, y: y + s), CGPoint(x: x - s, y: y)])
                } }
            case "terrazzo":
                let chips = [ink, ink.shaded(0.7), ui("6f7175"), ui("f4f1ea"), ui("e0a82e")]
                for (i, p) in scatter(230, seed: 71).enumerated() {
                    let r = 4 + p.2 * 9, turn = CGFloat(i) * 1.7
                    wrapped(w, p.0 * w, p.1 * w, 16) { x, y in
                        var points: [CGPoint] = []
                        for k in 0..<5 { let t = turn + CGFloat(k) * 1.26; points.append(CGPoint(x: x + cos(t) * r * (k % 2 == 0 ? 1 : 0.6), y: y + sin(t) * r)) }
                        poly(c, chips[i % chips.count], points)
                    }
                }
            case "planks":
                c.setStrokeColor(ink.cgColor)
                c.setLineWidth(6)
                for i in 0...5 {
                    let y = CGFloat(i) * w / 5
                    c.move(to: CGPoint(x: 0, y: y)); c.addLine(to: CGPoint(x: w, y: y)); c.strokePath()
                    let x = (i % 2 == 0 ? 0.35 : 0.8) * w
                    c.move(to: CGPoint(x: x, y: y)); c.addLine(to: CGPoint(x: x, y: y + w / 5)); c.strokePath()
                }
                // A knot or two.
                for p in scatter(7, seed: 73) {
                    c.setStrokeColor(ink.withAlphaComponent(0.6).cgColor)
                    c.setLineWidth(3)
                    c.strokeEllipse(in: CGRect(x: p.0 * w - 9, y: p.1 * w - 5, width: 18, height: 10))
                }
            case "hazard":
                // Yellow and black on the slant, wide as a boot.
                let s = w / 8
                for i in -8..<16 where i % 2 == 0 {
                    let x = CGFloat(i) * s
                    poly(c, ink, [CGPoint(x: x, y: 0), CGPoint(x: x + s, y: 0), CGPoint(x: x + s + w, y: w), CGPoint(x: x + w, y: w)])
                }
            case "lava":
                // Dark rock in slabs, with the glow showing between them.
                c.setFillColor(ink.cgColor)
                c.fill(CGRect(origin: .zero, size: size))
                var rng = MathRNG(seed: 79)
                let n = 5, s = w / CGFloat(n)
                // Corners of a grid, each pushed about a bit, the same at opposite edges so it repeats.
                var corners: [[CGPoint]] = []
                for j in 0...n {
                    var row: [CGPoint] = []
                    for i in 0...n {
                        let jitter = CGPoint(x: (CGFloat(rng.unit()) - 0.5) * s * 0.5, y: (CGFloat(rng.unit()) - 0.5) * s * 0.5)
                        row.append(CGPoint(x: CGFloat(i) * s + jitter.x, y: CGFloat(j) * s + jitter.y))
                    }
                    row[n] = CGPoint(x: row[0].x + w, y: row[0].y)
                    corners.append(row)
                }
                corners[n] = corners[0].map { CGPoint(x: $0.x, y: $0.y + w) }
                for j in 0..<n { for i in 0..<n {
                    let q = [corners[j][i], corners[j][i + 1], corners[j + 1][i + 1], corners[j + 1][i]]
                    let mid = CGPoint(x: q.map(\.x).reduce(0, +) / 4, y: q.map(\.y).reduce(0, +) / 4)
                    // Drawn in a little from its corners, so the gaps between are the lava.
                    let slab = q.map { CGPoint(x: mid.x + ($0.x - mid.x) * 0.86, y: mid.y + ($0.y - mid.y) * 0.86) }
                    for (dx, dy) in [(0, 0), (-w, 0), (w, 0), (0, -w), (0, w)] as [(CGFloat, CGFloat)] {
                        poly(c, (i + j) % 3 == 0 ? ground.shaded(1.25) : ground, slab.map { CGPoint(x: $0.x + dx, y: $0.y + dy) })
                    }
                } }
            default:
                break
            }
        }
    }
}
