import Foundation
import SceneKit
import UIKit

// The furniture of the school: surfaces drawn in code (floors, lockers, book
// spines), the things that stand in the way, and what the teacher throws.
// Everything in the way is built around the middle of a lane, standing on the
// floor: something to jump is under 0.95 m, something to slide under leaves
// 1.1 m clear, and anything else fills the lane.

enum MathProps {
    static let laneWidth: Float = 1.7

    // MARK: Surfaces

    static func checker(_ a: String, _ b: String, u: Float, v: Float, name: String = "checker") -> SCNMaterial {
        MathMat.drawn("\(name)|\(a)|\(b)", 128, 128, u: u, v: v) { cg, s in
            cg.fill(a, CGRect(origin: .zero, size: s))
            cg.fill(b, CGRect(x: 0, y: 0, width: s.width / 2, height: s.height / 2))
            cg.fill(b, CGRect(x: s.width / 2, y: s.height / 2, width: s.width / 2, height: s.height / 2))
        }
    }

    static func planks(_ base: String, _ line: String, u: Float, v: Float) -> SCNMaterial {
        MathMat.drawn("planks|\(base)|\(line)", 256, 256, u: u, v: v) { cg, s in
            cg.fill(base, CGRect(origin: .zero, size: s))
            var rng = MathRNG(seed: 7)
            for i in 0..<8 {
                let x = CGFloat(i) * s.width / 8
                MathLookKit.color(base).shaded(CGFloat(rng.range(0.9, 1.06))).setFill()
                cg.fill(CGRect(x: x, y: 0, width: s.width / 8, height: s.height))
                cg.fill(line, CGRect(x: x, y: 0, width: 1.5, height: s.height))
                cg.fill(line, CGRect(x: x, y: CGFloat(rng.range(0, 1)) * s.height, width: s.width / 8, height: 1.5))
            }
        }
    }

    static func tiles(_ base: String, _ grout: String, u: Float, v: Float, accent: String? = nil) -> SCNMaterial {
        MathMat.drawn("tiles|\(base)|\(grout)|\(accent ?? "")", 128, 128, u: u, v: v) { cg, s in
            cg.fill(grout, CGRect(origin: .zero, size: s))
            let n = 4
            let w = s.width / CGFloat(n)
            var rng = MathRNG(seed: 3)
            for x in 0..<n {
                for y in 0..<n {
                    let color = accent != nil && rng.chance(0.12) ? accent! : base
                    MathLookKit.color(color).shaded(CGFloat(rng.range(0.96, 1.03))).setFill()
                    cg.fill(CGRect(x: CGFloat(x) * w + 1.5, y: CGFloat(y) * w + 1.5, width: w - 3, height: w - 3))
                }
            }
        }
    }

    static func brick(_ base: String, _ mortar: String, u: Float, v: Float) -> SCNMaterial {
        MathMat.drawn("brick|\(base)|\(mortar)", 128, 128, u: u, v: v) { cg, s in
            cg.fill(mortar, CGRect(origin: .zero, size: s))
            var rng = MathRNG(seed: 5)
            let rows = 8, cols = 4
            let h = s.height / CGFloat(rows), w = s.width / CGFloat(cols)
            for r in 0..<rows {
                for c in -1..<cols {
                    MathLookKit.color(base).shaded(CGFloat(rng.range(0.88, 1.08))).setFill()
                    cg.fill(CGRect(x: CGFloat(c) * w + (r % 2 == 0 ? 0 : w / 2) + 1, y: CGFloat(r) * h + 1, width: w - 2, height: h - 2))
                }
            }
        }
    }

    static func grass(u: Float, v: Float, _ base: String = "6cc24a") -> SCNMaterial {
        MathMat.drawn("grass|\(base)", 128, 128, u: u, v: v) { cg, s in
            cg.fill(base, CGRect(origin: .zero, size: s))
            var rng = MathRNG(seed: 11)
            for _ in 0..<260 {
                MathLookKit.color(base).shaded(CGFloat(rng.range(0.85, 1.12))).setFill()
                cg.fill(CGRect(x: CGFloat(rng.unit()) * s.width, y: CGFloat(rng.unit()) * s.height, width: 3, height: 6))
            }
        }
    }

    /// A run of lockers, to wrap along a wall: four doors to the picture.
    static func lockers(_ color: String, ajar: Bool = false, u: Float) -> SCNMaterial {
        MathMat.drawn("lockers|\(color)|\(ajar)", 256, 256, u: u, v: 1) { cg, s in
            let base = MathLookKit.color(color)
            base.shaded(0.7).setFill()
            cg.fill(CGRect(origin: .zero, size: s))
            let w = s.width / 4
            for i in 0..<4 {
                let door = CGRect(x: CGFloat(i) * w + 3, y: 6, width: w - 6, height: s.height - 12)
                base.setFill()
                cg.fill(door)
                base.shaded(1.15).setFill()
                cg.fill(CGRect(x: door.minX, y: door.minY, width: 3, height: door.height))
                // Vents, a handle and a number plate.
                base.shaded(0.6).setFill()
                for v in 0..<5 { cg.fill(CGRect(x: door.minX + 12, y: door.minY + 18 + CGFloat(v) * 9, width: door.width - 24, height: 4)) }
                for v in 0..<3 { cg.fill(CGRect(x: door.minX + 12, y: door.maxY - 40 + CGFloat(v) * 9, width: door.width - 24, height: 4)) }
                cg.fill("d9dde2", CGRect(x: door.maxX - 14, y: door.midY - 12, width: 6, height: 24))
                cg.fill("f1ead2", CGRect(x: door.midX - 9, y: door.minY + 70, width: 18, height: 10))
                if ajar {
                    cg.fill("050505", CGRect(x: door.maxX - 5, y: door.minY, width: 5, height: door.height))
                }
            }
        }
    }

    /// Shelves of books, to wrap along a wall.
    static func bookSpines(u: Float, v: Float, dim: Bool = false) -> SCNMaterial {
        MathMat.drawn("spines|\(dim)", 256, 256, u: u, v: v) { cg, s in
            cg.fill("5a3a22", CGRect(origin: .zero, size: s))
            var rng = MathRNG(seed: 21)
            let palette = dim ? ["3b2f2f", "2f3b3a", "38303f", "44382a", "2c2c34"]
                : ["c0392b", "2e86c1", "27ae60", "f1c40f", "8e44ad", "e67e22", "ecf0f1", "16a085", "7f8c8d"]
            let rows = 4
            let h = s.height / CGFloat(rows)
            for r in 0..<rows {
                var x: CGFloat = 4
                while x < s.width - 6 {
                    let w = CGFloat(rng.range(8, 20))
                    let tall = h * CGFloat(rng.range(0.62, 0.86))
                    MathLookKit.color(rng.pick(palette)).shaded(CGFloat(rng.range(0.85, 1.05))).setFill()
                    cg.fill(CGRect(x: x, y: CGFloat(r) * h + (h - 6 - tall), width: w - 1.5, height: tall))
                    cg.fill("f4e9c8", CGRect(x: x + 2, y: CGFloat(r) * h + (h - 6 - tall) + 6, width: w - 5.5, height: 3))
                    x += w
                }
                cg.fill("7a5230", CGRect(x: 0, y: CGFloat(r + 1) * h - 6, width: s.width, height: 6))
            }
        }
    }

    /// A classroom door with a window and a number.
    static func door(_ number: String, color: String = "8a5a2b", lit: Bool = true) -> SCNMaterial {
        MathMat.drawn("door|\(number)|\(color)|\(lit)", 128, 256) { cg, s in
            cg.fill(color, CGRect(origin: .zero, size: s))
            MathLookKit.color(color).shaded(0.8).setStroke()
            cg.setLineWidth(6)
            cg.stroke(CGRect(origin: .zero, size: s).insetBy(dx: 3, dy: 3))
            cg.fill(lit ? "fff3b0" : "101418", CGRect(x: 34, y: 34, width: 60, height: 76))
            cg.fill("d9dde2", CGRect(x: 100, y: 140, width: 14, height: 8))
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 22, weight: .bold), .foregroundColor: UIColor.white]
            (number as NSString).draw(at: CGPoint(x: 40, y: 6), withAttributes: attrs)
        }
    }

    static func windowed(_ wall: String, _ glass: String, u: Float, v: Float) -> SCNMaterial {
        MathMat.drawn("windows|\(wall)|\(glass)", 128, 128, u: u, v: v) { cg, s in
            cg.fill(wall, CGRect(origin: .zero, size: s))
            cg.fill("ffffff", CGRect(x: 20, y: 22, width: 88, height: 76))
            cg.fill(glass, CGRect(x: 25, y: 27, width: 37, height: 66))
            cg.fill(glass, CGRect(x: 66, y: 27, width: 37, height: 66))
        }
    }

    // MARK: People and small things

    /// A poster or notice for a wall.
    static func poster(_ text: String, paper: String, ink: String = "ffffff", w: Float = 0.9, h: Float = 1.2) -> SCNNode {
        let n = MathShape.card(w, h, MathMat.sign(text, ink: ink, paper: paper, width: 192, height: 256, border: "ffffff"))
        return n
    }

    static func clock(backwards: Bool) -> SCNNode {
        let n = SCNNode()
        let face = MathShape.cylinder(0.32, 0.05, MathMat.color("fdfdfd"), segments: 20)
        face.eulerAngles.x = .pi / 2
        n.addChildNode(face)
        let rim = MathShape.cylinder(0.36, 0.04, MathMat.color("20242c"), segments: 20)
        rim.eulerAngles.x = .pi / 2
        n.add(rim, 0, 0, -0.01)
        for (length, period) in [(Float(0.26), 6.0), (Float(0.17), 60.0)] {
            let hand = SCNNode()
            hand.add(MathShape.box(0.03, length, 0.02, MathMat.color("20242c")), 0, length / 2, 0.04)
            n.addChildNode(hand)
            hand.runAction(.repeatForever(.rotateBy(x: 0, y: 0, z: backwards ? .pi * 2 : -.pi * 2, duration: backwards ? period / 5 : period)))
        }
        return n
    }

    /// A lamp in the ceiling.
    static func lamp(_ color: String = "fff6d5", w: Float = 1.4, l: Float = 0.5, flicker: Bool = false) -> SCNNode {
        let n = MathShape.box(w, 0.08, l, MathMat.color(color, glow: 1))
        if flicker {
            n.geometry = (n.geometry?.copy() as? SCNGeometry)
            let m = SCNMaterial()
            m.lightingModel = .constant
            m.diffuse.contents = MathLookKit.color(color)
            n.geometry?.materials = [m]
            var rng = MathRNG(seed: UInt64(abs(color.hashValue)) &+ UInt64.random(in: 0...999))
            var steps: [SCNAction] = []
            for _ in 0..<8 {
                steps.append(.wait(duration: Double(rng.range(0.05, 1.6))))
                steps.append(.run { $0.opacity = 0.25 })
                steps.append(.wait(duration: Double(rng.range(0.03, 0.12))))
                steps.append(.run { $0.opacity = 1 })
            }
            n.runAction(.repeatForever(.sequence(steps)))
        }
        return n
    }

    static func kit(_ name: String, height: Float? = nil, width: Float? = nil, length: Float? = nil) -> SCNNode? {
        MathModels.prop(name)?.fitted(width: width, height: height, length: length)
    }

    // MARK: In the way

    static func wetFloor() -> SCNNode {
        let n = SCNNode()
        let yellow = MathMat.color("ffd21f")
        let face = MathMat.sign("⚠\nWET", ink: "20242c", paper: "ffd21f", width: 128, height: 192)
        for side: Float in [-1, 1] {
            let panel = MathShape.faced(0.62, 0.86, 0.04, [face, yellow, face, yellow, yellow, yellow])
            panel.eulerAngles.x = side * 0.28
            n.add(panel, 0, 0.42, side * 0.13)
        }
        let bucket = MathShape.cylinder(0.22, 0.34, MathMat.color("f2b705"), segments: 12)
        n.add(bucket, 0.5, 0.17, 0.05)
        let mop = MathShape.cylinder(0.025, 0.9, MathMat.color("b98a52"), segments: 6)
        mop.eulerAngles.z = -0.35
        n.add(mop, 0.42, 0.5, 0.05)
        return n
    }

    static func hurdle(_ color: String = "e74c3c") -> SCNNode {
        let n = SCNNode()
        let post = MathMat.color("ecf0f1")
        for x: Float in [-0.7, 0.7] {
            n.add(MathShape.box(0.07, 0.8, 0.07, post), x, 0.4, 0)
            n.add(MathShape.box(0.07, 0.06, 0.6, post), x, 0.03, 0)
        }
        let bar = MathMat.drawn("hurdlebar|\(color)", 128, 32, u: 3, v: 1) { cg, s in
            cg.fill("ffffff", CGRect(origin: .zero, size: s))
            cg.fill(color, CGRect(x: 0, y: 0, width: s.width / 2, height: s.height))
        }
        n.add(MathShape.box(1.5, 0.16, 0.06, bar), 0, 0.78, 0)
        return n
    }

    static func bench(_ wood: String = "b98a52") -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.box(1.5, 0.1, 0.5, MathMat.color(wood), round: 0.02), 0, 0.5, 0)
        for x: Float in [-0.6, 0.6] { n.add(MathShape.box(0.1, 0.46, 0.44, MathMat.color("5d6d7e")), x, 0.23, 0) }
        return n
    }

    static func cones() -> SCNNode {
        let n = SCNNode()
        for x: Float in [-0.5, 0, 0.5] {
            n.add(MathShape.cone(0.2, 0.04, 0.62, MathMat.color("ff7a1a"), segments: 10), x, 0.34, 0)
            n.add(MathShape.box(0.44, 0.04, 0.44, MathMat.color("ff7a1a")), x, 0.02, 0)
            n.add(MathShape.cylinder(0.125, 0.1, MathMat.color("ffffff"), segments: 10), x, 0.4, 0)
        }
        return n
    }

    static func backpacks(_ rng: inout MathRNG) -> SCNNode {
        let n = SCNNode()
        let colors = ["e74c3c", "3498db", "2ecc71", "9b59b6", "f39c12", "1abc9c"]
        for i in 0..<4 {
            let c = rng.pick(colors)
            let bag = MathShape.box(0.46, 0.56, 0.3, MathMat.color(c), round: 0.1)
            let x = Float(i) * 0.42 - 0.63
            n.add(bag, x + rng.range(-0.05, 0.05), 0.28, rng.range(-0.15, 0.15), ry: rng.range(-0.6, 0.6))
            bag.add(MathShape.box(0.3, 0.2, 0.06, MathMat.color(c), round: 0.03), 0, -0.08, 0.17)
        }
        return n
    }

    static func bookStack(_ rng: inout MathRNG, books: Int = 5, wide: Float = 0.7) -> SCNNode {
        let n = SCNNode()
        let colors = ["c0392b", "2e86c1", "27ae60", "f1c40f", "8e44ad", "e67e22", "16a085"]
        var y: Float = 0
        for _ in 0..<books {
            let h = rng.range(0.1, 0.17)
            let cover = MathShape.box(wide * rng.range(0.85, 1), h, 0.5 * rng.range(0.85, 1), MathMat.color(rng.pick(colors)))
            n.add(cover, rng.range(-0.05, 0.05), y + h / 2, rng.range(-0.04, 0.04), ry: rng.range(-0.3, 0.3))
            cover.add(MathShape.box(wide * 0.8, h * 0.7, 0.02, MathMat.color("f7f1dc")), 0, 0, 0.245)
            y += h
        }
        return n
    }

    /// Two posts and something strung between them at head height.
    static func strung(_ text: String, paper: String = "ffffff", ink: String = "d6263a", posts: String = "8b98a8") -> SCNNode {
        let n = SCNNode()
        for x: Float in [-0.78, 0.78] {
            n.add(MathShape.cylinder(0.05, 2.1, MathMat.color(posts), segments: 8), x, 1.05, 0)
            n.add(MathShape.cylinder(0.18, 0.06, MathMat.color(posts), segments: 10), x, 0.03, 0)
        }
        let face = MathMat.sign(text, ink: ink, paper: paper, width: 256, height: 96)
        let side = MathMat.color(paper)
        n.add(MathShape.faced(1.56, 0.62, 0.05, [face, side, face, side, side, side]), 0, 1.5, 0)
        return n
    }

    static func net() -> SCNNode {
        let n = SCNNode()
        for x: Float in [-0.8, 0.8] { n.add(MathShape.cylinder(0.05, 2.2, MathMat.color("f1c40f"), segments: 8), x, 1.1, 0) }
        let mesh = MathMat.drawn("net", 128, 64, u: 2, v: 1, clear: true) { cg, s in
            cg.clear(CGRect(origin: .zero, size: s))
            UIColor.white.setStroke()
            cg.setLineWidth(2)
            for i in 0...8 {
                cg.move(to: CGPoint(x: CGFloat(i) * s.width / 8, y: 0)); cg.addLine(to: CGPoint(x: CGFloat(i) * s.width / 8, y: s.height))
            }
            for i in 0...4 {
                cg.move(to: CGPoint(x: 0, y: CGFloat(i) * s.height / 4)); cg.addLine(to: CGPoint(x: s.width, y: CGFloat(i) * s.height / 4))
            }
            cg.strokePath()
            cg.fill("ffffff", CGRect(x: 0, y: 0, width: s.width, height: 7))
        }
        n.add(MathShape.card(1.6, 0.8, mesh), 0, 1.6, 0)
        return n
    }

    static func janitorCart() -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.box(1.3, 0.9, 0.8, MathMat.color("f2b705"), round: 0.04), 0, 0.6, 0)
        n.add(MathShape.box(1.34, 0.08, 0.84, MathMat.color("5d6d7e")), 0, 0.14, 0)
        for x: Float in [-0.5, 0.5] {
            for z: Float in [-0.3, 0.3] { n.add(MathShape.sphere(0.09, MathMat.color("20242c"), segments: 8), x, 0.09, z) }
        }
        n.add(MathShape.box(0.6, 1.3, 0.7, MathMat.color("2e86c1"), round: 0.05), -0.3, 1.5, 0)
        for (i, c) in ["e74c3c", "2ecc71", "ecf0f1"].enumerated() {
            n.add(MathShape.cylinder(0.09, 0.4, MathMat.color(c), segments: 8), 0.25 + Float(i) * 0.18, 1.25, 0.2)
        }
        let broom = MathShape.cylinder(0.03, 2.0, MathMat.color("b98a52"), segments: 6)
        n.add(broom, 0.55, 1.4, -0.25)
        n.add(MathShape.box(0.36, 0.14, 0.1, MathMat.color("e67e22")), 0.55, 2.42, -0.25)
        return n
    }

    static func lockerBlock(_ color: String) -> SCNNode {
        let front = lockers(color, u: 0.5)
        let side = MathMat.color(color)
        return MathShape.faced(1.4, 2.3, 0.7, [front, side, front, side, side, side]).lifted(1.15)
    }

    static func teacherDesk() -> SCNNode {
        let n = SCNNode()
        if let desk = kit("furniture/desk", width: 1.45) { n.add(desk, 0, 0, 0) } else {
            n.add(MathShape.box(1.45, 0.8, 0.8, MathMat.color("b98a52")), 0, 0.4, 0)
        }
        n.add(MathShape.box(1.4, 1.3, 0.1, MathMat.color("2f6f4e")), 0, 1.75, -0.3)
        n.add(MathShape.card(1.3, 1.2, MathMat.sign("SEE\nME", ink: "f4f4f4", paper: "2f6f4e", width: 128, height: 128, font: "ChalkboardSE-Bold")), 0, 1.75, -0.24)
        n.add(MathShape.box(0.1, 1.2, 0.1, MathMat.color("8b98a8")), -0.6, 0.6, -0.3)
        n.add(MathShape.box(0.1, 1.2, 0.1, MathMat.color("8b98a8")), 0.6, 0.6, -0.3)
        return n
    }

    static func vending(_ label: String = "MILK", color: String = "c0392b", glow: CGFloat = 0.6) -> SCNNode {
        let front = MathMat.drawn("vend|\(label)|\(color)", 128, 256, glow: glow) { cg, s in
            cg.fill(color, CGRect(origin: .zero, size: s))
            cg.fill("10161d", CGRect(x: 10, y: 50, width: 80, height: 150))
            var rng = MathRNG(seed: 9)
            for r in 0..<5 {
                for c in 0..<4 {
                    cg.fill(rng.pick(["f1c40f", "ecf0f1", "3498db", "2ecc71", "e67e22"]), CGRect(x: 15 + c * 19, y: 58 + r * 28, width: 13, height: 20))
                }
            }
            cg.fill("20242c", CGRect(x: 98, y: 90, width: 22, height: 60))
            cg.fill("10161d", CGRect(x: 14, y: 212, width: 72, height: 30))
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 26, weight: .black), .foregroundColor: UIColor.white]
            (label as NSString).draw(at: CGPoint(x: 12, y: 10), withAttributes: attrs)
        }
        let side = MathMat.color(color)
        return MathShape.faced(1.3, 2.4, 0.8, [front, side, front, side, side, side]).lifted(1.2)
    }

    static func lunchTable(_ rng: inout MathRNG) -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.box(1.45, 0.08, 1.5, MathMat.color("e9d8a6"), round: 0.02), 0, 0.82, 0)
        n.add(MathShape.box(0.12, 0.8, 1.2, MathMat.color("5d6d7e")), 0, 0.4, 0)
        // Piled high, so nobody thinks of jumping it.
        let tray = MathMat.color("d35400")
        for i in 0..<5 { n.add(MathShape.box(0.9, 0.05, 0.6, tray), rng.range(-0.1, 0.1), 0.9 + Float(i) * 0.07, rng.range(-0.2, 0.2), ry: rng.range(-0.3, 0.3)) }
        if let food = kit(rng.pick(["food/burger", "food/pizza", "food/cake", "food/donut-sprinkles", "food/turkey"]), height: 0.5) {
            n.add(food, 0, 1.25, 0)
        }
        for i in 0..<6 { n.add(MathShape.box(0.5, 0.5, 0.5, MathMat.color(["3498db", "ecf0f1"][i % 2]), round: 0.03), rng.range(-0.3, 0.3), 1.55 + Float(i) * 0.02, rng.range(-0.4, 0.4)).opacity = i == 0 ? 1 : 0 }
        n.add(MathShape.box(0.5, 0.62, 0.5, MathMat.sign("MILK", ink: "3498db", paper: "ffffff", width: 64, height: 64)), 0.35, 1.55, -0.35, ry: 0.4)
        return n
    }

    static func matPile() -> SCNNode {
        let n = SCNNode()
        for (i, c) in ["2e86c1", "c0392b", "2e86c1", "f1c40f", "c0392b", "2e86c1", "2ecc71"].enumerated() {
            n.add(MathShape.box(1.45, 0.3, 1.3, MathMat.color(c), round: 0.05), Float(i % 2) * 0.06 - 0.03, 0.15 + Float(i) * 0.3, 0)
        }
        return n
    }

    static func ballRack(_ rng: inout MathRNG) -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.box(1.4, 0.06, 0.6, MathMat.color("5d6d7e")), 0, 0.2, 0)
        for x: Float in [-0.65, 0.65] { n.add(MathShape.box(0.06, 0.8, 0.6, MathMat.color("5d6d7e")), x, 0.4, 0) }
        for i in 0..<3 { n.add(MathShape.sphere(0.2, MathMat.color(rng.pick(["e67e22", "c0392b", "ecf0f1"])), segments: 12), Float(i) * 0.42 - 0.42, 0.45, 0) }
        return n
    }

    static func bookcase() -> SCNNode {
        let spine = bookSpines(u: 0.5, v: 1)
        let wood = MathMat.color("7a5230")
        return MathShape.faced(1.45, 2.5, 0.6, [spine, wood, spine, wood, wood, wood]).lifted(1.25)
    }

    static func globe() -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.cylinder(0.35, 0.1, MathMat.color("7a5230"), segments: 12), 0, 0.05, 0)
        n.add(MathShape.cylinder(0.05, 0.9, MathMat.color("b7950b"), segments: 8), 0, 0.5, 0)
        let world = MathMat.drawn("globe", 128, 64) { cg, s in
            cg.fill("2e86c1", CGRect(origin: .zero, size: s))
            var rng = MathRNG(seed: 4)
            for _ in 0..<14 {
                cg.setFillColor(MathLookKit.color("58d68d").cgColor)
                cg.fillEllipse(in: CGRect(x: CGFloat(rng.unit()) * s.width, y: CGFloat(rng.unit()) * s.height, width: CGFloat(rng.range(8, 30)), height: CGFloat(rng.range(6, 18))))
            }
        }
        let ball = MathShape.sphere(0.72, world, segments: 18)
        n.add(ball, 0, 1.6, 0)
        ball.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 9)))
        return n
    }

    static func filingCabinet(_ rng: inout MathRNG) -> SCNNode {
        let front = MathMat.drawn("cabinet", 64, 128) { cg, s in
            cg.fill("7f8c8d", CGRect(origin: .zero, size: s))
            for i in 0..<4 {
                cg.fill("95a5a6", CGRect(x: 4, y: 4 + i * 31, width: 56, height: 27))
                cg.fill("ecf0f1", CGRect(x: 22, y: 9 + i * 31, width: 20, height: 7))
                cg.fill("4d5656", CGRect(x: 26, y: 20 + i * 31, width: 12, height: 4))
            }
        }
        let side = MathMat.color("707b7c")
        let n = SCNNode()
        n.add(MathShape.faced(0.7, 2.3, 0.7, [front, side, front, side, side, side]), -0.36, 1.15, 0)
        n.add(MathShape.faced(0.7, 2.3, 0.7, [front, side, front, side, side, side]), 0.36, 1.15, 0)
        if rng.chance(0.5) { n.add(MathShape.box(0.5, 0.3, 0.4, MathMat.color("f7f1dc")), 0.3, 2.45, 0, ry: 0.3) }
        return n
    }

    static func schoolDesk(chair: Bool = true) -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.box(0.9, 0.06, 0.6, MathMat.color("d9b382"), round: 0.01), 0, 0.72, 0)
        for x: Float in [-0.4, 0.4] {
            for z: Float in [-0.25, 0.25] { n.add(MathShape.box(0.05, 0.7, 0.05, MathMat.color("8b98a8")), x, 0.35, z) }
        }
        if chair {
            n.add(MathShape.box(0.5, 0.05, 0.45, MathMat.color("2e86c1")), 0, 0.42, 0.6)
            n.add(MathShape.box(0.5, 0.5, 0.05, MathMat.color("2e86c1")), 0, 0.7, 0.82)
            for x: Float in [-0.2, 0.2] { n.add(MathShape.box(0.04, 0.42, 0.04, MathMat.color("8b98a8")), x, 0.21, 0.6) }
        }
        return n
    }

    /// A row of desks across a lane: something to jump.
    static func deskRow() -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.box(1.5, 0.07, 0.6, MathMat.color("d9b382"), round: 0.01), 0, 0.74, 0)
        for x: Float in [-0.68, 0, 0.68] {
            n.add(MathShape.box(0.05, 0.72, 0.5, MathMat.color("8b98a8")), x, 0.36, 0)
        }
        return n
    }

    static func bus(length: Float = 9) -> SCNNode {
        let n = SCNNode()
        let side = MathMat.drawn("busside", 512, 128) { cg, s in
            cg.fill("f7b500", CGRect(origin: .zero, size: s))
            cg.fill("20242c", CGRect(x: 0, y: 74, width: s.width, height: 6))
            cg.fill("20242c", CGRect(x: 0, y: 92, width: s.width, height: 4))
            for i in 0..<8 { cg.fill("9fd3f0", CGRect(x: 18 + i * 62, y: 16, width: 48, height: 44)) }
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 15, weight: .black), .foregroundColor: UIColor.black]
            ("SCHOOL BUS" as NSString).draw(at: CGPoint(x: 200, y: 97), withAttributes: attrs)
        }
        let back = MathMat.drawn("busback", 128, 128) { cg, s in
            cg.fill("f7b500", CGRect(origin: .zero, size: s))
            cg.fill("9fd3f0", CGRect(x: 18, y: 14, width: 92, height: 44))
            cg.fill("c0392b", CGRect(x: 10, y: 70, width: 16, height: 16))
            cg.fill("c0392b", CGRect(x: 102, y: 70, width: 16, height: 16))
            cg.fill("20242c", CGRect(x: 0, y: 100, width: s.width, height: 10))
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 13, weight: .black), .foregroundColor: UIColor.black]
            ("STOP" as NSString).draw(at: CGPoint(x: 46, y: 70), withAttributes: attrs)
        }
        let top = MathMat.color("f2a900")
        n.add(MathShape.faced(1.6, 2.1, length, [back, side, back, side, top, top]), 0, 1.45, 0)
        for z in [-length / 2 + 1.5, length / 2 - 1.5] {
            for x: Float in [-0.78, 0.78] {
                let wheel = MathShape.cylinder(0.42, 0.25, MathMat.color("20242c"), segments: 12)
                wheel.eulerAngles.z = .pi / 2
                n.add(wheel, x, 0.42, z)
            }
        }
        return n
    }

    /// A plank up to a bus roof.
    static func ramp(height: Float, length: Float) -> SCNNode {
        let n = SCNNode()
        let run = sqrt(height * height + length * length)
        let board = MathShape.box(1.5, 0.1, run, planks("c98f52", "8a5a2b", u: 1, v: 2))
        board.eulerAngles.x = atan2(height, length)
        n.add(board, 0, height / 2, 0)
        n.add(MathShape.box(1.3, height * 0.5, 0.2, MathMat.color("8a5a2b")), 0, height * 0.25, -length * 0.1)
        return n
    }

    // MARK: Thrown by the teacher

    private static let symbols = ["7", "×", "÷", "½", "π", "%", "√", "x", "=", "+", "3", "9", "<", "¾", "?"]
    private static let sums = ["3x+4=19", "½+¼", "15% of 60", "7×8", "a²+b²", "√81", "x÷4=7", "2³", "0.3×0.2", "5/8 > ?", "P=2l+2w", "n−9=14"]

    /// A numbered block, to jump.
    static func problemLow(_ rng: inout MathRNG) -> SCNNode {
        let paper = rng.pick(["d6263a", "e84a5f", "c81d4e"])
        let faces = (0..<6).map { _ in MathMat.sign(rng.pick(symbols), ink: "ffffff", paper: paper, width: 96, height: 96, border: "ffffff", glow: 0.35) }
        let cube = MathShape.faced(0.86, 0.86, 0.86, faces)
        let n = SCNNode()
        n.add(cube, 0, 0.43, 0, ry: rng.range(-0.3, 0.3))
        if rng.chance(0.5) {
            let small = MathShape.faced(0.5, 0.5, 0.5, (0..<6).map { _ in MathMat.sign(rng.pick(symbols), ink: "d6263a", paper: "ffffff", width: 96, height: 96, border: "d6263a", glow: 0.3) })
            n.add(small, rng.pick([-0.62, 0.62]), 0.25, rng.range(-0.1, 0.1), ry: rng.range(-0.6, 0.6))
        }
        return n
    }

    /// A blackboard on wheels with a sum on it: nothing for it but another lane.
    static func problemFull(_ rng: inout MathRNG) -> SCNNode {
        let n = SCNNode()
        if rng.chance(0.55) {
            let board = MathMat.sign(rng.pick(sums), ink: "ffffff", paper: "20513a", width: 256, height: 256, border: "d6263a", glow: 0.3, font: "ChalkboardSE-Bold")
            let frame = MathMat.color("d6263a", glow: 0.3)
            n.add(MathShape.faced(1.5, 1.7, 0.12, [board, frame, board, frame, frame, frame]), 0, 1.5, 0)
            for x: Float in [-0.68, 0.68] {
                n.add(MathShape.box(0.08, 0.7, 0.08, frame), x, 0.35, 0)
                n.add(MathShape.box(0.08, 0.06, 0.6, frame), x, 0.06, 0)
            }
        } else {
            var y: Float = 0
            for (i, size) in [Float(1.2), 0.95, 0.7].enumerated() {
                let paper = ["d6263a", "ffffff", "d6263a"][i]
                let ink = ["ffffff", "d6263a", "ffffff"][i]
                let faces = (0..<6).map { _ in MathMat.sign(rng.pick(symbols), ink: ink, paper: paper, width: 96, height: 96, border: ink, glow: 0.35) }
                n.add(MathShape.faced(size, size, size, faces), rng.range(-0.08, 0.08), y + size / 2, 0, ry: rng.range(-0.4, 0.4))
                y += size
            }
        }
        return n
    }

    /// A giant ruler across two piles of textbooks, to slide under.
    static func problemHigh(_ rng: inout MathRNG) -> SCNNode {
        let n = SCNNode()
        for x: Float in [-0.72, 0.72] {
            for i in 0..<8 {
                n.add(MathShape.box(0.26, 0.16, 0.5, MathMat.color(["d6263a", "ffffff"][i % 2], glow: 0.25)), x, 0.08 + Float(i) * 0.16, 0, ry: rng.range(-0.2, 0.2))
            }
        }
        let ruler = MathMat.drawn("ruler", 256, 64, glow: 0.3) { cg, s in
            cg.fill("ffd21f", CGRect(origin: .zero, size: s))
            UIColor.black.setFill()
            for i in 0...32 { cg.fill(CGRect(x: CGFloat(i) * 8, y: 0, width: 1.5, height: i % 4 == 0 ? 26 : 14)) }
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 20, weight: .black), .foregroundColor: UIColor.black]
            for i in 0..<8 { ("\(i + 1)" as NSString).draw(at: CGPoint(x: CGFloat(i) * 32 + 22, y: 32), withAttributes: attrs) }
        }
        let edge = MathMat.color("e0b400")
        n.add(MathShape.faced(1.75, 0.5, 0.08, [ruler, edge, ruler, edge, edge, edge]), 0, 1.53, 0)
        return n
    }

    /// What's in the air while it's being thrown.
    static func projectile(_ rng: inout MathRNG) -> SCNNode {
        let faces = (0..<6).map { _ in MathMat.sign(rng.pick(symbols), ink: "ffffff", paper: "d6263a", width: 96, height: 96, border: "ffffff", glow: 0.5) }
        return MathShape.faced(0.6, 0.6, 0.6, faces)
    }

    /// Where a thrown problem is about to land.
    static func target() -> SCNNode {
        let ring = MathMat.drawn("target", 128, 128, glow: 1, clear: true) { cg, s in
            cg.clear(CGRect(origin: .zero, size: s))
            cg.setStrokeColor(UIColor(red: 1, green: 0.15, blue: 0.2, alpha: 0.95).cgColor)
            cg.setLineWidth(10)
            cg.strokeEllipse(in: CGRect(origin: .zero, size: s).insetBy(dx: 10, dy: 10))
            cg.setLineWidth(5)
            cg.strokeEllipse(in: CGRect(origin: .zero, size: s).insetBy(dx: 36, dy: 36))
            cg.setFillColor(UIColor(red: 1, green: 0.15, blue: 0.2, alpha: 0.28).cgColor)
            cg.fillEllipse(in: CGRect(origin: .zero, size: s).insetBy(dx: 10, dy: 10))
        }
        let n = MathShape.floor(1.5, 1.5, ring)
        n.geometry = n.geometry?.copy() as? SCNGeometry
        n.geometry?.materials = [ring]
        n.renderingOrder = 5
        return n
    }

    // MARK: Collected

    static func star() -> SCNNode {
        let n = SCNNode(geometry: MathShape.star)
        n.castsShadow = false
        return n
    }

    enum Power: String, CaseIterable, Codable {
        case magnet, double, jetpack, springs, board

        var label: String {
            switch self {
            case .magnet: "Magnet"
            case .double: "Double"
            case .jetpack: "Jetpack"
            case .springs: "Springs"
            case .board: "Board"
            }
        }

        var symbol: String {
            switch self {
            case .magnet: "🧲"
            case .double: "2×"
            case .jetpack: "🚀"
            case .springs: "👟"
            case .board: "🛹"
            }
        }

        var seconds: Float {
            switch self {
            case .magnet: 9
            case .double: 12
            case .jetpack: 7
            case .springs: 10
            case .board: 14
            }
        }

        var color: String {
            switch self {
            case .magnet: "e74c3c"
            case .double: "9b59b6"
            case .jetpack: "3498db"
            case .springs: "2ecc71"
            case .board: "f39c12"
            }
        }
    }

    static func power(_ kind: Power) -> SCNNode {
        let n = SCNNode()
        let face = MathMat.sign(kind.symbol, ink: "ffffff", paper: kind.color, width: 96, height: 96, border: "ffffff", glow: 0.7)
        let cube = MathShape.faced(0.62, 0.62, 0.62, [face, face, face, face, face, face])
        cube.eulerAngles = SCNVector3(0.5, 0.6, 0)
        n.addChildNode(cube)
        cube.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 2.2)))
        let halo = MathShape.sphere(0.6, MathMat.color(kind.color, glow: 1, alpha: 0.22), segments: 12)
        halo.castsShadow = false
        n.addChildNode(halo)
        n.castsShadow = false
        return n
    }
}

extension SCNNode {
    /// The node raised so that something made around its middle stands on the floor.
    func lifted(_ y: Float) -> SCNNode {
        let holder = SCNNode()
        position.y = y
        holder.addChildNode(self)
        return holder
    }
}
