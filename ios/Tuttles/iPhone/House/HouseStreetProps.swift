import SceneKit
import UIKit

// What stands outside a dream home and along its street: the porch at the
// front door, the flower beds under the windows, the lamps, the bench and
// the bikes by the road, the things that come out for Halloween and for
// Christmas, and the family's two pets. All of it is built here in code from
// boxes, tubes and balls, in the same chunky way as the things in the yard.
//
// Everything is in metres, stands on y = 0 with its middle over the origin,
// and faces +z, except where it says otherwise: a porch is built out from a
// door in the wall at z = 0, a flower bed lies along a wall behind it, and
// the lights and the wreath hang from where they're put. Nothing here is a
// light; what's lit glows.
//
// The pets are made standing still. Whoever puts them in the street moves
// them, by the names of their parts: "body", and inside it "head", "tail"
// and the four legs, each hung from its own shoulder or hip.

enum HouseStreetProps {
    /// Every key `made` knows, for a gallery to show them all.
    static let keys: [String] = [
        "porch", "porch-awning", "porch-columns", "porch-pergola",
        "bed-tulips", "bed-roses", "bed-hedge", "bed-veg",
        "street-lamp", "street-lamp-modern", "bench-park", "bikes", "hydrant", "bird-bath", "fountain",
        "basketball-hoop", "wheelbarrow", "lemonade-stand", "sprinkler",
        "pumpkins", "eave-lights", "door-wreath", "snow-drift", "gift-pile",
    ]

    /// Something for outside the house, built in code, by its key. Nil for a key it doesn't know.
    static func made(_ key: String) -> SCNNode? {
        switch key {
        case "porch": return porch()
        case "porch-awning": return porchAwning()
        case "porch-columns": return porchColumns()
        case "porch-pergola": return porchPergola()
        case "bed-tulips": return bedTulips()
        case "bed-roses": return bedRoses()
        case "bed-hedge": return bedHedge()
        case "bed-veg": return bedVeg()
        case "street-lamp": return streetLamp()
        case "street-lamp-modern": return streetLampModern()
        case "bench-park": return benchPark()
        case "bikes": return bikes()
        case "hydrant": return hydrant()
        case "bird-bath": return birdBath()
        case "fountain": return fountain()
        case "basketball-hoop": return basketballHoop()
        case "wheelbarrow": return wheelbarrow()
        case "lemonade-stand": return lemonadeStand()
        case "sprinkler": return sprinkler()
        case "pumpkins": return pumpkins()
        case "eave-lights": return eaveLights()
        case "door-wreath": return doorWreath()
        case "snow-drift": return snowDrift()
        case "gift-pile": return giftPile()
        default: return nil
        }
    }

    // MARK: Short ways of saying things

    private typealias V = SIMD3<Float>

    private static func c(_ hex: String, glow: CGFloat = 0, alpha: CGFloat = 1) -> SCNMaterial { MathMat.color(hex, glow: glow, alpha: alpha) }
    private static func ui(_ hex: String) -> UIColor { MathLookKit.color(hex) }

    /// Turn a node that was made lying along `axis` to lie along `direction`.
    private static func aim(_ node: SCNNode, _ axis: V, along direction: V) {
        let length = simd_length(direction)
        guard length > 0.0001 else { return }
        let u = direction / length
        let d = simd_dot(axis, u)
        if d > 0.9999 { return }
        if d < -0.9999 {
            // Straight back the other way: half a turn about anything square to it.
            let other: V = abs(axis.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0)
            node.simdOrientation = simd_quatf(angle: .pi, axis: simd_normalize(simd_cross(axis, other)))
            return
        }
        node.simdOrientation = simd_quatf(from: axis, to: u)
    }

    /// A round bar from one point to another.
    @discardableResult
    private static func bar(_ n: SCNNode, _ a: V, _ b: V, _ r: Float, _ m: SCNMaterial, segments: Int = 6) -> SCNNode {
        let rod = MathShape.cylinder(r, simd_length(b - a), m, segments: segments)
        rod.simdPosition = (a + b) / 2
        aim(rod, V(0, 1, 0), along: b - a)
        n.addChildNode(rod)
        return rod
    }

    /// A bent bar: one bar after another through the points.
    private static func pipe(_ n: SCNNode, _ points: [V], _ r: Float, _ m: SCNMaterial, segments: Int = 6) {
        guard points.count > 1 else { return }
        for i in 1..<points.count { bar(n, points[i - 1], points[i], r, m, segments: segments) }
    }

    /// A bar that gets thinner: `r0` thick at the first point, `r1` at the second.
    @discardableResult
    private static func taper(_ n: SCNNode, _ a: V, _ b: V, _ r0: Float, _ r1: Float, _ m: SCNMaterial, segments: Int = 8) -> SCNNode {
        let rod = MathShape.cone(r0, r1, simd_length(b - a), m, segments: segments)
        rod.simdPosition = (a + b) / 2
        aim(rod, V(0, 1, 0), along: b - a)
        n.addChildNode(rod)
        return rod
    }

    /// A ring lying flat: `ring` out to the middle of the tube, `tube` thick.
    private static func torus(_ ring: Float, _ tube: Float, _ m: SCNMaterial, segments: Int = 20) -> SCNNode {
        let g = SCNTorus(ringRadius: CGFloat(ring), pipeRadius: CGFloat(tube))
        g.ringSegmentCount = segments
        g.pipeSegmentCount = 8
        g.materials = [m]
        return SCNNode(geometry: g)
    }

    /// A sausage shape, standing up.
    private static func capsule(_ r: Float, _ h: Float, _ m: SCNMaterial) -> SCNNode {
        let g = SCNCapsule(capRadius: CGFloat(r), height: CGFloat(h))
        g.radialSegmentCount = 8
        g.capSegmentCount = 4
        g.materials = [m]
        return SCNNode(geometry: g)
    }

    /// A roof-shaped block: a triangle `halfWidth` each side and `height` up, `depth` front to back.
    private static func prism(_ halfWidth: Float, _ height: Float, _ depth: Float, _ m: SCNMaterial) -> SCNNode {
        let path = UIBezierPath()
        path.move(to: CGPoint(x: CGFloat(-halfWidth), y: 0))
        path.addLine(to: CGPoint(x: CGFloat(halfWidth), y: 0))
        path.addLine(to: CGPoint(x: 0, y: CGFloat(height)))
        path.close()
        let g = SCNShape(path: path, extrusionDepth: CGFloat(depth))
        g.materials = [m]
        return SCNNode(geometry: g)
    }

    /// A four-sided point, standing on y = 0.
    private static func pyramid(_ w: Float, _ h: Float, _ l: Float, _ m: SCNMaterial) -> SCNNode {
        let g = SCNPyramid(width: CGFloat(w), height: CGFloat(h), length: CGFloat(l))
        g.materials = [m]
        return SCNNode(geometry: g)
    }

    // MARK: Drawn surfaces

    /// Boards side by side, running across the picture.
    private static func planks(_ hex: String, _ gap: String, boards: Int = 8) -> SCNMaterial {
        MathMat.drawn("street-planks-\(hex)-\(gap)-\(boards)", 256, 256) { g, size in
            g.fill(hex, CGRect(origin: .zero, size: size))
            let h = size.height / CGFloat(boards)
            for i in 0..<boards {
                if i % 2 == 1 {
                    g.setFillColor(UIColor.black.withAlphaComponent(0.07).cgColor)
                    g.fill(CGRect(x: 0, y: CGFloat(i) * h, width: size.width, height: h))
                }
                g.fill(gap, CGRect(x: 0, y: CGFloat(i) * h, width: size.width, height: 3))
            }
        }
    }

    /// Stripes of `b` on `a`, `bands` of them across; `thin` is how much of each band is `b`.
    private static func stripes(_ a: String, _ b: String, _ bands: Int, thin: CGFloat = 0.5) -> SCNMaterial {
        MathMat.drawn("street-stripes-\(a)-\(b)-\(bands)-\(thin)", 256, 16) { g, size in
            g.fill(a, CGRect(origin: .zero, size: size))
            let w = size.width / CGFloat(bands)
            for i in 0..<bands { g.fill(b, CGRect(x: CGFloat(i) * w, y: 0, width: w * thin, height: size.height)) }
        }
    }

    /// A net, seen through: crossed strings on a faint haze, repeated `u` by `v` times.
    private static func mesh(_ hex: String, u: Float, v: Float, haze: CGFloat = 0.14) -> SCNMaterial {
        MathMat.drawn("street-mesh-\(hex)-\(haze)", 64, 64, u: u, v: v, doubleSided: true, clear: true) { g, size in
            g.clear(CGRect(origin: .zero, size: size))
            g.setFillColor(ui(hex).withAlphaComponent(haze).cgColor)
            g.fill(CGRect(origin: .zero, size: size))
            g.setStrokeColor(ui(hex).withAlphaComponent(0.8).cgColor)
            g.setLineWidth(5)
            g.move(to: .zero)
            g.addLine(to: CGPoint(x: size.width, y: size.height))
            g.move(to: CGPoint(x: size.width, y: 0))
            g.addLine(to: CGPoint(x: 0, y: size.height))
            g.strokePath()
        }
    }

    /// Words in the middle of a rectangle of a picture being drawn.
    private static func write(_ s: String, _ hex: String, _ size: CGFloat, in rect: CGRect, font: String = "AvenirNext-Heavy") {
        let text = NSAttributedString(string: s, attributes: [
            .font: UIFont(name: font, size: size) ?? UIFont.systemFont(ofSize: size, weight: .heavy),
            .foregroundColor: ui(hex),
        ])
        let b = text.size()
        text.draw(at: CGPoint(x: rect.midX - b.width / 2, y: rect.midY - b.height / 2))
    }

    // MARK: Porches

    /// The porch: a wooden floor out from the door, two white posts, rails down the sides, a pitched roof and a step.
    private static func porch() -> SCNNode {
        let n = SCNNode()
        let side = c("9a6a3f"), white = c("f6f1e4"), tile = c("c0463a")
        n.add(MathShape.faced(2.4, 0.12, 1.5, [side, side, side, side, planks("c99a5f", "8a5a3a", boards: 8), side]), 0, 0.06, 0.75)
        n.add(MathShape.box(1.3, 0.06, 0.32, c("b98452")), 0, 0.03, 1.66)
        for x: Float in [-1.1, 1.1] {
            n.add(MathShape.box(0.12, 2.28, 0.12, white), x, 1.26, 1.4)
            n.add(MathShape.box(0.18, 0.1, 0.18, white), x, 0.17, 1.4)
            n.add(MathShape.box(0.18, 0.08, 0.18, white), x, 2.36, 1.4)
            // The beam from the wall to the post, and the rail under it.
            n.add(MathShape.box(0.1, 0.12, 1.4, white), x, 2.34, 0.7)
            n.add(MathShape.box(0.05, 0.05, 1.3, white), x, 0.92, 0.7)
            for i in 0..<4 { n.add(MathShape.box(0.04, 0.78, 0.04, white), x, 0.51, 0.2 + Float(i) * 0.3) }
        }
        n.add(MathShape.box(2.32, 0.12, 0.1, white), 0, 2.34, 1.4)
        // The roof, its ridge running out from the wall: a white gable with a tiled slope down each side.
        let rise: Float = 0.6, half: Float = 1.4
        let slope = (half * half + rise * rise).squareRoot(), tilt = atan2(rise, half)
        n.add(prism(1.33, 0.57, 1.5, white), 0, 2.4, 0.76)
        for s: Float in [-1, 1] {
            let panel = MathShape.box(slope, 0.07, 1.66, tile)
            panel.eulerAngles.z = -s * tilt
            n.add(panel, s * half / 2, 2.4 + rise / 2 + 0.03, 0.84)
        }
        n.add(MathShape.box(0.12, 0.08, 1.68, c("9a352c")), 0, 3.04, 0.85)
        return n
    }

    /// A red and white awning over the door, held out on two thin arms, and a doormat.
    private static func porchAwning() -> SCNNode {
        let n = SCNNode()
        let red = c("d6263a"), iron = c("3a3d44")
        let cloth = stripes("d6263a", "ffffff", 8)
        // Down from 2.5 at the wall to 2.1, a little over a metre out.
        let run: Float = 1.1, drop: Float = 0.4
        let length = (run * run + drop * drop).squareRoot()
        let sheet = MathShape.faced(2.0, 0.04, length, [red, red, red, red, cloth, cloth])
        sheet.eulerAngles.x = atan2(drop, run)
        n.add(sheet, 0, 2.5 - drop / 2, run / 2 + 0.02)
        n.add(MathShape.box(2.0, 0.16, 0.03, cloth), 0, 2.03, run + 0.03)
        bar(n, V(-1.0, 2.09, run + 0.01), V(1.0, 2.09, run + 0.01), 0.018, iron)
        bar(n, V(-1.0, 2.5, 0.03), V(1.0, 2.5, 0.03), 0.02, iron)
        for x: Float in [-0.96, 0.96] {
            bar(n, V(x, 1.7, 0.03), V(x, 2.08, run - 0.04), 0.018, iron)
            n.add(MathShape.box(0.06, 0.14, 0.04, iron), x, 1.7, 0.02)
        }
        // The mat.
        let mat = MathMat.drawn("street-doormat", 256, 150) { g, size in
            let all = CGRect(origin: .zero, size: size)
            g.fill("c99a5f", all)
            g.setStrokeColor(ui("8a5a3a").cgColor)
            g.setLineWidth(10)
            g.stroke(all.insetBy(dx: 10, dy: 10))
            write("WELCOME", "6b4a2a", 40, in: all)
        }
        n.add(MathShape.box(0.9, 0.03, 0.55, c("8a5a3a"), round: 0.01), 0, 0.015, 0.42)
        n.add(MathShape.floor(0.84, 0.49, mat), 0, 0.032, 0.42)
        return n
    }

    /// A grand way in: two fat white columns on stone steps, holding up a stone top with a pediment.
    private static func porchColumns() -> SCNNode {
        let n = SCNNode()
        let stone = c("e4dccb"), pale = c("f6f1e4"), shade = c("cfc6b2")
        // Two wide steps, the top one the floor in front of the door.
        n.add(MathShape.box(3.0, 0.06, 1.8, shade), 0, 0.03, 0.9)
        n.add(MathShape.box(2.8, 0.06, 1.45, stone), 0, 0.09, 0.725)
        let flutes = stripes("f6f1e4", "e0d9c8", 14, thin: 0.3)
        for x: Float in [-1.1, 1.1] {
            n.add(MathShape.box(0.52, 0.1, 0.52, pale), x, 0.17, 1.1)
            n.add(MathShape.cylinder(0.22, 0.06, pale, segments: 16), x, 0.25, 1.1)
            n.add(MathShape.cone(0.2, 0.17, 2.1, flutes, segments: 16), x, 1.33, 1.1)
            n.add(MathShape.cylinder(0.21, 0.06, pale, segments: 16), x, 2.41, 1.1)
            n.add(MathShape.box(0.5, 0.08, 0.5, pale), x, 2.48, 1.1)
            // A flat one against the wall behind it.
            n.add(MathShape.box(0.3, 2.4, 0.08, pale), x, 1.32, 0.04)
        }
        n.add(MathShape.box(2.8, 0.3, 1.4, stone), 0, 2.67, 0.7)
        n.add(MathShape.box(2.92, 0.07, 1.44, pale), 0, 2.855, 0.72)
        n.add(prism(1.3, 0.48, 1.4, stone), 0, 2.89, 0.7)
        let disc = MathShape.cylinder(0.13, 0.04, c("f5c542", glow: 0.25), segments: 14)
        disc.eulerAngles.x = .pi / 2
        n.add(disc, 0, 3.06, 1.4)
        return n
    }

    /// An open timber pergola over the door, with slats across the top and a vine in flower growing over it.
    private static func porchPergola() -> SCNNode {
        let n = SCNNode()
        let wood = c("b98452"), dark = c("8a5a3a")
        let leaf = [c("4f9a45"), c("3f8f4a"), c("5fae52")], pink = c("ff8fc0", glow: 0.2)
        for x: Float in [-1.22, 1.22] {
            for z: Float in [0.08, 1.72] { n.add(MathShape.box(0.14, 2.4, 0.14, wood), x, 1.2, z) }
            n.add(MathShape.box(0.1, 0.16, 1.8, dark), x, 2.48, 0.9)
        }
        for i in 0..<7 { n.add(MathShape.box(2.6, 0.12, 0.07, wood), 0, 2.62, 0.14 + Float(i) * 0.254) }

        // The vine, lying over the slats in clumps, each with a flower.
        var rng = MathRNG(seed: 41)
        for i in 0..<7 {
            let x = rng.range(-1.0, 1.0), z = rng.range(0.4, 1.6), r = rng.range(0.16, 0.24)
            n.add(MathShape.sphere(r, leaf[i % 3], segments: 7), x, 2.72, z).scale = SCNVector3(1.3, 0.5, 1.1)
            n.add(MathShape.sphere(0.05, pink, segments: 6), x + rng.range(-0.12, 0.12), 2.72 + r * 0.5, z + rng.range(-0.1, 0.1))
        }
        // Hanging down off the front of it.
        for (i, x) in [Float(-0.95), 0.7, 1.05].enumerated() {
            let drop: Float = 0.3 + Float(i) * 0.12
            bar(n, V(x, 2.58, 1.74), V(x + 0.03, 2.58 - drop, 1.76), 0.012, leaf[1])
            n.add(MathShape.sphere(0.06, leaf[i % 3], segments: 6), x + 0.015, 2.58 - drop * 0.5, 1.77)
            n.add(MathShape.sphere(0.05, pink, segments: 6), x + 0.03, 2.58 - drop, 1.77)
        }
        // And up the front left post, where it's rooted.
        let climb: [V] = [V(-1.16, 0, 1.81), V(-1.29, 0.5, 1.81), V(-1.15, 1.0, 1.81), V(-1.29, 1.5, 1.81), V(-1.15, 2.0, 1.81), V(-1.22, 2.5, 1.8)]
        pipe(n, climb, 0.014, leaf[1])
        for (i, p) in climb.enumerated() where i > 0 && i < 5 {
            n.add(MathShape.sphere(0.07, leaf[i % 3], segments: 6), p.x, p.y, p.z + 0.03).scale = SCNVector3(1.2, 0.7, 0.6)
            if i % 2 == 0 { n.add(MathShape.sphere(0.045, pink, segments: 6), p.x + 0.04, p.y + 0.06, p.z + 0.05) }
        }
        return n
    }

    // MARK: Flower beds

    /// The strip every bed is, 3 long and 0.6 deep, for along the foot of a wall behind it:
    /// the soil, and a board along the front and round the ends if there's one.
    private static func strip(_ n: SCNNode, edge: SCNMaterial?) {
        n.add(MathShape.box(2.9, 0.08, 0.52, c("5a3d28")), 0, 0.04, -0.03)
        guard let edge else { return }
        n.add(MathShape.box(3.0, 0.11, 0.06, edge), 0, 0.055, 0.27)
        for x: Float in [-1.47, 1.47] { n.add(MathShape.box(0.06, 0.11, 0.54, edge), x, 0.055, -0.03) }
    }

    /// Two rows of tulips in all their colours, behind an edge of stones.
    private static func bedTulips() -> SCNNode {
        let n = SCNNode()
        strip(n, edge: nil)
        let stones = [c("b3aa9c"), c("9a9288"), c("c4bcae")]
        for i in 0..<10 { n.add(MathShape.box(0.29, 0.13, 0.1, stones[i % 3], round: 0.03), -1.35 + Float(i) * 0.3, 0.065, 0.25) }
        for x: Float in [-1.45, 1.45] {
            for (j, z) in [Float(-0.17), 0.05].enumerated() { n.add(MathShape.box(0.1, 0.13, 0.21, stones[(j + 1) % 3], round: 0.03), x, 0.065, z) }
        }
        let stem = c("3f8f4a")
        let heads = [c("e0362f"), c("ff7fb0"), c("ffd23a"), c("b05fd0"), c("ffffff"), c("ff9a2f")]
        for (r, z) in [Float(-0.15), 0.05].enumerated() {
            for i in 0..<8 {
                let x: Float = -1.24 + Float(i) * 0.33 + Float(r) * 0.165
                let tall: Float = 0.3 + Float((i + r) % 3) * 0.04
                n.add(MathShape.cylinder(0.014, tall, stem, segments: 5), x, 0.08 + tall / 2, z)
                n.add(MathShape.sphere(0.06, heads[(i * 2 + r * 3) % heads.count], segments: 8), x, 0.08 + tall + 0.04, z).scale = SCNVector3(1, 1.35, 1)
            }
        }
        return n
    }

    /// Three round rose bushes, in bloom in red and pink.
    private static func bedRoses() -> SCNNode {
        let n = SCNNode()
        strip(n, edge: c("b98452"))
        let green = [c("3f8f4a"), c("357f40")]
        let blooms = [c("e0362f", glow: 0.15), c("ff7fb0", glow: 0.15)]
        // Where the roses are on a bush: how far round from the front, and how far up.
        let spots: [(Float, Float)] = [(-1.1, 0.25), (-0.5, 0.7), (-0.25, 0.2), (0.35, 0.5), (0.8, 0.15), (1.2, 0.6), (0.0, 1.2)]
        for (b, x) in [Float(-1.0), 0, 1.0].enumerated() {
            let r: Float = b == 1 ? 0.3 : 0.27
            let y: Float = 0.08 + r * 0.85, z: Float = -0.03
            n.add(MathShape.sphere(r, green[b % 2], segments: 10), x, y, z).scale = SCNVector3(1.25, 1, 0.85)
            n.add(MathShape.sphere(r * 0.55, green[(b + 1) % 2], segments: 8), x + 0.14, y + r * 0.55, z)
            for (i, spot) in spots.enumerated() {
                let (a, e) = spot
                n.add(MathShape.sphere(0.065, blooms[(i + b) % 2], segments: 7),
                      x + sin(a) * cos(e) * r * 1.25, y + sin(e) * r, z + cos(a) * cos(e) * r * 0.85)
            }
        }
        return n
    }

    /// A clipped box hedge, with a ball of topiary on a stem at each end.
    private static func bedHedge() -> SCNNode {
        let n = SCNNode()
        strip(n, edge: c("b3aa9c"))
        let leaf = c("3f8f4a"), light = c("4f9a45")
        n.add(MathShape.box(2.1, 0.5, 0.42, leaf, round: 0.06), 0, 0.33, -0.04)
        n.add(MathShape.box(2.0, 0.06, 0.34, light, round: 0.03), 0, 0.58, -0.04)
        for x: Float in [-1.26, 1.26] {
            n.add(MathShape.cylinder(0.03, 0.7, c("7a5234"), segments: 6), x, 0.43, -0.04)
            n.add(MathShape.sphere(0.21, leaf, segments: 10), x, 0.55, -0.04)
            n.add(MathShape.sphere(0.13, light, segments: 8), x, 0.86, -0.04)
        }
        return n
    }

    /// A row of cabbages in front and a row of tomatoes on their canes behind.
    private static func bedVeg() -> SCNNode {
        let n = SCNNode()
        strip(n, edge: c("b98452"))
        let outer = c("5fae52"), heart = c("a8dc7a"), cane = c("c9a36b"), plant = c("3f8f4a"), tomato = c("e0362f", glow: 0.15)
        for i in 0..<6 {
            let x: Float = -1.2 + Float(i) * 0.48
            n.add(MathShape.sphere(0.16, outer, segments: 8), x, 0.11, 0.07).scale = SCNVector3(1, 0.4, 1)
            n.add(MathShape.sphere(0.1, heart, segments: 8), x, 0.16, 0.07).scale = SCNVector3(1, 0.85, 1)
        }
        for i in 0..<5 {
            let x: Float = -1.1 + Float(i) * 0.55, z: Float = -0.17
            n.add(MathShape.cylinder(0.014, 0.85, cane, segments: 5), x, 0.505, z)
            n.add(capsule(0.09, 0.6, plant), x, 0.4, z).scale = SCNVector3(1, 1, 0.8)
            n.add(MathShape.sphere(0.045, tomato, segments: 7), x - 0.07, 0.5, z + 0.07)
            n.add(MathShape.sphere(0.045, tomato, segments: 7), x + 0.06, 0.34, z + 0.08)
            n.add(MathShape.sphere(0.04, tomato, segments: 7), x + 0.02, 0.63, z + 0.065)
        }
        return n
    }

    // MARK: By the road

    /// A black cast-iron lamp post, 3.4 m to the top of its lantern, the panes lit warm.
    private static func streetLamp() -> SCNNode {
        let n = SCNNode()
        let iron = c("23262b"), glass = c("ffe2a0", glow: 1)
        n.add(MathShape.cylinder(0.2, 0.08, iron, segments: 12), 0, 0.04, 0)
        n.add(MathShape.cylinder(0.14, 0.4, iron, segments: 10), 0, 0.28, 0)
        n.add(MathShape.cone(0.14, 0.06, 0.25, iron, segments: 10), 0, 0.605, 0)
        n.add(MathShape.cylinder(0.055, 2.15, iron, segments: 8), 0, 1.775, 0)
        for y: Float in [0.95, 2.4] { n.add(MathShape.cylinder(0.08, 0.06, iron, segments: 10), 0, y, 0) }
        // The bar a lamplighter's ladder leant on.
        bar(n, V(-0.28, 2.4, 0), V(0.28, 2.4, 0), 0.022, iron)
        for x: Float in [-0.28, 0.28] { n.add(MathShape.sphere(0.035, iron, segments: 8), x, 2.4, 0) }
        // The lantern.
        n.add(MathShape.cone(0.06, 0.17, 0.12, iron, segments: 10), 0, 2.89, 0)
        n.add(MathShape.box(0.36, 0.03, 0.36, iron), 0, 2.95, 0)
        n.add(MathShape.box(0.26, 0.26, 0.26, glass), 0, 3.095, 0)
        for x: Float in [-0.13, 0.13] { for z: Float in [-0.13, 0.13] { n.add(MathShape.box(0.03, 0.27, 0.03, iron), x, 3.095, z) } }
        n.add(MathShape.box(0.38, 0.03, 0.38, iron), 0, 3.235, 0)
        n.add(pyramid(0.36, 0.12, 0.36, iron), 0, 3.25, 0)
        n.add(MathShape.sphere(0.03, iron, segments: 8), 0, 3.385, 0)
        return n
    }

    /// A slim grey pole that curves over the road to a glowing disc.
    private static func streetLampModern() -> SCNNode {
        let n = SCNNode()
        let steel = c("8d949b"), dark = c("5b6470")
        n.add(MathShape.cylinder(0.16, 0.05, dark, segments: 12), 0, 0.025, 0)
        n.add(MathShape.cylinder(0.075, 0.5, dark, segments: 10), 0, 0.3, 0)
        n.add(MathShape.cylinder(0.05, 2.5, steel, segments: 8), 0, 1.8, 0)
        let arc: [V] = [V(0, 3.05, 0), V(0, 3.3, 0.06), V(0, 3.48, 0.22), V(0, 3.56, 0.45), V(0, 3.56, 0.72), V(0, 3.5, 0.95)]
        pipe(n, arc, 0.045, steel, segments: 8)
        for p in arc.dropLast() { n.add(MathShape.sphere(0.045, steel, segments: 8), p.x, p.y, p.z) }
        n.add(MathShape.cylinder(0.26, 0.05, dark, segments: 16), 0, 3.47, 1.05)
        n.add(MathShape.cylinder(0.21, 0.02, c("fff2c4", glow: 1), segments: 16), 0, 3.44, 1.05)
        return n
    }

    /// A green slatted park bench with iron ends.
    private static func benchPark() -> SCNNode {
        let n = SCNNode()
        let green = c("2f8f5a"), iron = c("23262b")
        for i in 0..<4 { n.add(MathShape.box(1.6, 0.035, 0.09, green, round: 0.01), 0, 0.45, -0.14 + Float(i) * 0.115) }
        for i in 0..<3 {
            let slat = MathShape.box(1.6, 0.1, 0.035, green, round: 0.01)
            slat.eulerAngles.x = -0.22
            n.add(slat, 0, 0.6 + Float(i) * 0.13, -0.235 - Float(i) * 0.03)
        }
        for x: Float in [-0.72, 0.72] {
            // The legs and the rail under the seat, the upright behind the back, and the arm.
            pipe(n, [V(x, 0, 0.26), V(x, 0.42, 0.2), V(x, 0.42, -0.2), V(x, 0, -0.32)], 0.025, iron)
            bar(n, V(x, 0.42, -0.2), V(x, 0.95, -0.325), 0.025, iron)
            pipe(n, [V(x, 0.42, 0.22), V(x, 0.66, 0.26), V(x, 0.68, 0), V(x, 0.66, -0.25)], 0.022, iron)
            n.add(MathShape.sphere(0.04, iron, segments: 8), x, 0.67, 0.27)
        }
        return n
    }

    /// A child's bike standing up on y = 0, its front wheel toward +z.
    private static func bike(_ hex: String, basket: Bool) -> SCNNode {
        let b = SCNNode()
        let paint = c(hex), tyre = c("2a2d33"), chrome = c("dfe7ee", glow: 0.1)
        let rear = V(0, 0.25, -0.35), front = V(0, 0.25, 0.35), crank = V(0, 0.22, -0.04), seat = V(0, 0.56, -0.17)
        let headLow = V(0, 0.5, 0.255), headTop = V(0, 0.66, 0.2)
        for hub in [rear, front] {
            let wheel = torus(0.22, 0.03, tyre, segments: 18)
            wheel.eulerAngles.z = .pi / 2
            b.add(wheel, hub.x, hub.y, hub.z)
            let cap = MathShape.cylinder(0.035, 0.07, chrome, segments: 8)
            cap.eulerAngles.z = .pi / 2
            b.add(cap, hub.x, hub.y, hub.z)
        }
        // The frame, the fork, and the posts for the saddle and the handlebars.
        bar(b, rear, crank, 0.016, paint)
        bar(b, rear, seat, 0.014, paint)
        bar(b, crank, seat, 0.02, paint)
        bar(b, crank, headLow, 0.022, paint)
        bar(b, seat, headLow, 0.02, paint)
        bar(b, front, headTop, 0.018, chrome)
        bar(b, seat, V(0, 0.68, -0.2), 0.012, chrome)
        b.add(MathShape.box(0.1, 0.04, 0.22, tyre, round: 0.015), 0, 0.7, -0.21)
        bar(b, headTop, V(0, 0.8, 0.17), 0.012, chrome)
        bar(b, V(-0.2, 0.8, 0.17), V(0.2, 0.8, 0.17), 0.013, chrome)
        for x: Float in [-0.18, 0.18] { bar(b, V(x - 0.04, 0.8, 0.17), V(x + 0.04, 0.8, 0.17), 0.02, tyre) }
        // The pedals, one up and one down.
        bar(b, V(-0.08, 0.22, -0.04), V(0.08, 0.22, -0.04), 0.012, chrome)
        b.add(MathShape.box(0.06, 0.02, 0.08, tyre), -0.1, 0.15, 0)
        b.add(MathShape.box(0.06, 0.02, 0.08, tyre), 0.1, 0.29, -0.08)
        if basket { b.add(MathShape.box(0.22, 0.13, 0.15, c("f6f1e4")), 0, 0.72, 0.3) }
        return b
    }

    /// Two kids' bikes, one red and one blue, nose in to a low stand and leaning in it.
    private static func bikes() -> SCNNode {
        let n = SCNNode()
        let steel = c("8d949b")
        // The stand: a rail on the ground behind the front wheels and one in front of them, and a hoop each side of each wheel.
        for z: Float in [-0.62, -0.12] { bar(n, V(-0.7, 0.02, z), V(0.7, 0.02, z), 0.02, steel) }
        for x: Float in [-0.35, 0.35] {
            for d: Float in [-0.07, 0.07] { pipe(n, [V(x + d, 0.02, -0.62), V(x + d, 0.45, -0.52), V(x + d, 0.02, -0.12)], 0.015, steel) }
        }
        for (x, hex, lean, basket) in [(Float(-0.35), "e0362f", Float(0.09), true), (0.35, "2f6fd0", -0.08, false)] {
            let leaning = bike(hex, basket: basket)
            leaning.eulerAngles.z = lean
            let stood = SCNNode()
            stood.addChildNode(leaning)
            n.add(stood, x, 0, 0, ry: .pi)
        }
        return n
    }

    /// A red fire hydrant, 0.7 m tall.
    private static func hydrant() -> SCNNode {
        let n = SCNNode()
        let red = c("e0362f"), deep = c("b8281f"), cap = c("d9dee4")
        n.add(MathShape.cylinder(0.17, 0.05, deep, segments: 12), 0, 0.025, 0)
        n.add(MathShape.cylinder(0.12, 0.42, red, segments: 12), 0, 0.26, 0)
        n.add(MathShape.cylinder(0.145, 0.04, deep, segments: 12), 0, 0.47, 0)
        n.add(MathShape.sphere(0.125, red, segments: 12), 0, 0.49, 0).scale = SCNVector3(1, 0.9, 1)
        n.add(MathShape.cylinder(0.045, 0.1, cap, segments: 6), 0, 0.64, 0)
        // Where the hoses go on: one each side and a bigger one in front.
        for s: Float in [-1, 1] {
            let arm = MathShape.cylinder(0.055, 0.1, red, segments: 10)
            arm.eulerAngles.z = .pi / 2
            n.add(arm, s * 0.16, 0.33, 0)
            let nut = MathShape.cylinder(0.065, 0.04, cap, segments: 6)
            nut.eulerAngles.z = .pi / 2
            n.add(nut, s * 0.225, 0.33, 0)
        }
        let mouth = MathShape.cylinder(0.07, 0.1, red, segments: 10)
        mouth.eulerAngles.x = .pi / 2
        n.add(mouth, 0, 0.28, 0.16)
        let plug = MathShape.cylinder(0.08, 0.04, cap, segments: 8)
        plug.eulerAngles.x = .pi / 2
        n.add(plug, 0, 0.28, 0.225)
        for i in 0..<6 {
            let t = Float(i) * .pi / 3
            n.add(MathShape.sphere(0.018, cap, segments: 6), sin(t) * 0.145, 0.055, cos(t) * 0.145)
        }
        return n
    }

    /// A stone bird bath on a pedestal, 0.9 m tall, with a small bird on the rim having a drink.
    private static func birdBath() -> SCNNode {
        let n = SCNNode()
        let stone = c("cfc8ba"), shade = c("b3ab9c")
        n.add(MathShape.cylinder(0.22, 0.07, shade, segments: 14), 0, 0.035, 0)
        n.add(MathShape.cone(0.16, 0.08, 0.2, stone, segments: 12), 0, 0.17, 0)
        n.add(MathShape.cylinder(0.075, 0.42, stone, segments: 10), 0, 0.46, 0)
        n.add(MathShape.cylinder(0.1, 0.04, shade, segments: 10), 0, 0.66, 0)
        n.add(MathShape.cone(0.09, 0.36, 0.17, stone, segments: 16), 0, 0.765, 0)
        n.add(torus(0.345, 0.04, stone, segments: 20), 0, 0.86, 0)
        n.add(MathShape.cylinder(0.33, 0.01, c("3f9fc0"), segments: 16), 0, 0.852, 0)
        let water = MathShape.cylinder(0.32, 0.012, c("5fc8e8", glow: 0.25, alpha: 0.85), segments: 16)
        water.castsShadow = false
        n.add(water, 0, 0.868, 0)

        // The bird: made facing +z, stood on the rim and turned to look in at the water.
        let bird = SCNNode(), perch = SCNNode()
        let blue = c("3f8fe0"), black = c("20242c")
        perch.add(MathShape.sphere(0.05, blue, segments: 8), 0, 0.05, 0).scale = SCNVector3(0.85, 0.85, 1.2)
        perch.add(MathShape.sphere(0.035, c("ffd9a0"), segments: 8), 0, 0.037, 0.022)
        perch.add(MathShape.sphere(0.034, blue, segments: 8), 0, 0.095, 0.04)
        let beak = MathShape.cone(0.012, 0, 0.035, c("f08a3c"), segments: 6)
        beak.eulerAngles.x = .pi / 2
        perch.add(beak, 0, 0.092, 0.085)
        for x: Float in [-0.02, 0.02] { perch.add(MathShape.sphere(0.007, black, segments: 6), x, 0.105, 0.064) }
        let tail = MathShape.box(0.03, 0.008, 0.07, c("2f6fc0"))
        tail.eulerAngles.x = 0.5
        perch.add(tail, 0, 0.075, -0.075)
        bird.addChildNode(perch)
        n.add(bird, 0.28, 0.9, 0.2, ry: -2.19)
        let dip = SCNAction.sequence([.wait(duration: 1.6), .rotateBy(x: 0.6, y: 0, z: 0, duration: 0.25),
                                      .wait(duration: 0.4), .rotateBy(x: -0.6, y: 0, z: 0, duration: 0.25)])
        perch.runAction(.repeatForever(dip))
        return n
    }

    /// A round stone fountain, 1.8 m across: a wide basin, a bowl above it running over, and the light on the water.
    private static func fountain() -> SCNNode {
        let n = SCNNode()
        let stone = c("d6cfc0"), shade = c("b8b0a0"), bed = c("2f8fc0")
        let blue = c("4fb8e8", glow: 0.2, alpha: 0.85), falling = c("bfefff", glow: 0.5, alpha: 0.8), foam = c("ffffff", glow: 0.5)
        n.add(MathShape.cylinder(0.92, 0.06, shade, segments: 24), 0, 0.03, 0)
        n.add(MathShape.cylinder(0.9, 0.3, stone, segments: 24), 0, 0.15, 0)
        n.add(torus(0.83, 0.07, stone, segments: 28), 0, 0.3, 0)
        n.add(MathShape.cylinder(0.77, 0.02, bed, segments: 24), 0, 0.305, 0)
        let pond = MathShape.cylinder(0.765, 0.012, blue, segments: 24)
        pond.castsShadow = false
        n.add(pond, 0, 0.33, 0)
        // The stem, and the bowl on top of it.
        n.add(MathShape.cone(0.2, 0.11, 0.5, stone, segments: 12), 0, 0.55, 0)
        n.add(MathShape.cone(0.1, 0.45, 0.16, stone, segments: 20), 0, 0.87, 0)
        n.add(torus(0.43, 0.035, stone, segments: 24), 0, 0.95, 0)
        n.add(MathShape.cylinder(0.41, 0.012, bed, segments: 20), 0, 0.94, 0)
        let pool = MathShape.cylinder(0.405, 0.012, blue, segments: 20)
        pool.castsShadow = false
        n.add(pool, 0, 0.957, 0)
        n.add(MathShape.cylinder(0.05, 0.22, stone, segments: 8), 0, 1.05, 0)
        n.add(MathShape.sphere(0.075, shade, segments: 10), 0, 1.2, 0)
        // Water welling up at the top.
        let spring = MathShape.sphere(0.06, falling, segments: 8)
        spring.castsShadow = false
        n.add(spring, 0, 1.29, 0)
        spring.runAction(.repeatForever(.sequence([.scale(to: 1.25, duration: 0.5), .scale(to: 0.8, duration: 0.45)])))
        // Running over the edge of the bowl, and splashing where it lands.
        for i in 0..<6 {
            let t = Float(i) * .pi / 3 + 0.3
            let stream = bar(n, V(cos(t) * 0.46, 0.94, sin(t) * 0.46), V(cos(t) * 0.56, 0.34, sin(t) * 0.56), 0.018, falling, segments: 5)
            stream.castsShadow = false
            let splash = MathShape.sphere(0.05, foam, segments: 6)
            n.add(splash, cos(t) * 0.56, 0.345, sin(t) * 0.56)
            splash.runAction(.repeatForever(.sequence([.scale(to: 0.5, duration: 0.3 + Double(i % 3) * 0.1), .scale(to: 1.1, duration: 0.35)])))
        }
        // The light on the water, coming and going.
        let glint = c("ffffff", glow: 0.6, alpha: 0.6)
        for (i, p) in [(Float(-0.5), Float(0.42)), (0.55, 0.35), (0.12, 0.68), (-0.62, -0.25)].enumerated() {
            let shine = MathShape.floor(0.28, 0.04, glint)
            shine.castsShadow = false
            shine.renderingOrder = 1
            n.add(shine, p.0, 0.34, p.1)
            shine.runAction(.sequence([.wait(duration: Double(i) * 0.7),
                                       .repeatForever(.sequence([.fadeOpacity(to: 0.1, duration: 1.4), .fadeOpacity(to: 1, duration: 1.4)]))]))
        }
        return n
    }

    /// A driveway basketball hoop that wheels about: a weighted base, a leaning pole, the backboard, the rim at 2.6 m and the net.
    private static func basketballHoop() -> SCNNode {
        let n = SCNNode()
        let dark = c("23262b"), steel = c("3a4a5a"), blue = c("2f5fc0"), orange = c("ff7a1f", glow: 0.2)
        n.add(MathShape.box(0.85, 0.2, 0.95, dark, round: 0.05), 0, 0.1, -0.3)
        n.add(MathShape.box(0.6, 0.03, 0.6, blue), 0, 0.21, -0.35)
        for x: Float in [-0.44, 0.44] {
            let wheel = MathShape.cylinder(0.07, 0.06, steel, segments: 10)
            wheel.eulerAngles.z = .pi / 2
            n.add(wheel, x, 0.07, 0.08)
        }
        // The pole, its padding, and the two struts that brace it.
        bar(n, V(0, 0.2, -0.55), V(0, 2.9, -0.22), 0.055, steel, segments: 8)
        let pad = MathShape.box(0.2, 0.9, 0.18, blue, round: 0.05)
        pad.eulerAngles.x = 0.122
        n.add(pad, 0, 0.95, -0.458)
        for x: Float in [-0.3, 0.3] { bar(n, V(x, 0.2, 0.05), V(0, 1.25, -0.42), 0.025, steel) }
        bar(n, V(0, 2.9, -0.22), V(0, 2.95, 0.1), 0.045, steel)
        bar(n, V(0, 2.5, -0.27), V(0, 2.75, 0.1), 0.03, steel)
        // The backboard, with its square painted on.
        n.add(MathShape.box(1.1, 0.75, 0.04, c("f8f8f4")), 0, 2.95, 0.12)
        let target = MathMat.drawn("street-backboard", 176, 120) { g, size in
            g.fill("f8f8f4", CGRect(origin: .zero, size: size))
            g.setStrokeColor(ui("e0483a").cgColor)
            g.setLineWidth(8)
            g.stroke(CGRect(origin: .zero, size: size).insetBy(dx: 6, dy: 6))
            g.stroke(CGRect(x: 58, y: 62, width: 60, height: 46))
        }
        n.add(MathShape.card(1.1, 0.75, target), 0, 2.95, 0.142)
        n.add(MathShape.box(0.12, 0.03, 0.1, orange), 0, 2.6, 0.19)
        n.add(torus(0.23, 0.022, orange, segments: 20), 0, 2.6, 0.45)
        let net = MathShape.cone(0.13, 0.225, 0.36, mesh("ffffff", u: 8, v: 2, haze: 0.45), segments: 12)
        net.castsShadow = false
        n.add(net, 0, 2.42, 0.45)
        return n
    }

    /// A green wheelbarrow full of soil, with a trowel stuck in it. Its wheel is toward +z.
    private static func wheelbarrow() -> SCNNode {
        let n = SCNNode(), w = SCNNode()
        let green = c("3f9f5a"), deep = c("2f7f47"), steel = c("5b6470"), tyre = c("2a2d33")
        w.add(MathShape.box(0.46, 0.12, 0.62, deep, round: 0.03), 0, 0.36, 0)
        w.add(MathShape.box(0.6, 0.14, 0.8, green, round: 0.04), 0, 0.47, 0)
        w.add(MathShape.sphere(0.3, c("5a3d28"), segments: 10), 0, 0.52, 0).scale = SCNVector3(0.85, 0.4, 1.15)
        w.add(MathShape.sphere(0.14, c("6b4a30"), segments: 8), 0.08, 0.6, -0.12).scale = SCNVector3(1, 0.6, 1)
        // The wheel, and the fork that holds it.
        let wheel = torus(0.14, 0.04, tyre, segments: 16)
        wheel.eulerAngles.z = .pi / 2
        w.add(wheel, 0, 0.18, 0.56)
        let hub = MathShape.cylinder(0.06, 0.08, c("ffd23a"), segments: 10)
        hub.eulerAngles.z = .pi / 2
        w.add(hub, 0, 0.18, 0.56)
        for x: Float in [-0.07, 0.07] { bar(w, V(x, 0.18, 0.56), V(x * 3, 0.33, 0.25), 0.015, steel) }
        // The handles, with their grips, and the two legs it rests on.
        for s: Float in [-1, 1] {
            let a = V(s * 0.27, 0.34, 0.1), b = V(s * 0.3, 0.55, -0.95)
            bar(w, a, b, 0.018, steel)
            bar(w, a + (b - a) * 0.82, b, 0.026, tyre)
            bar(w, V(s * 0.24, 0.34, -0.2), V(s * 0.24, 0, -0.32), 0.016, steel)
        }
        // The trowel.
        bar(w, V(-0.1, 0.62, 0.12), V(-0.16, 0.82, 0.16), 0.018, c("e0483a"))
        let blade = MathShape.box(0.07, 0.16, 0.012, c("c9d0d6"))
        blade.eulerAngles.z = -0.3
        w.add(blade, -0.085, 0.58, 0.11)
        n.add(w, 0, 0, 0.1)
        return n
    }

    /// A lemonade stand: a wooden counter under a striped canopy, with the sign the kids painted, a jug, cups and lemons.
    private static func lemonadeStand() -> SCNNode {
        let n = SCNNode()
        let wood = c("d9a56b"), dark = c("9a6a3f"), post = c("f6f1e4"), yellow = c("ffd23a")
        n.add(MathShape.faced(1.4, 0.8, 0.5, [planks("c99a5f", "8a5a3a", boards: 6), dark, dark, dark, dark, dark]), 0, 0.4, 0)
        n.add(MathShape.box(1.5, 0.05, 0.6, wood, round: 0.01), 0, 0.825, 0)
        // The canopy, lower at the front, on a post at each corner.
        let tall: [(Float, Float)] = [(-0.22, 2.0), (0.22, 1.89)]
        for x: Float in [-0.66, 0.66] { for (z, top) in tall { n.add(MathShape.box(0.06, top, 0.06, post), x, top / 2, z) } }
        let cloth = stripes("ffd23a", "ffffff", 8)
        let canopy = MathShape.faced(1.6, 0.04, 0.95, [yellow, yellow, yellow, yellow, cloth, cloth])
        canopy.eulerAngles.x = 0.24
        n.add(canopy, 0, 1.97, 0.02)
        n.add(MathShape.box(1.6, 0.14, 0.03, cloth), 0, 1.79, 0.485)

        // The sign, every letter its own colour and none of them quite straight.
        let sign = MathMat.drawn("street-lemonade-sign", 512, 184) { g, size in
            let all = CGRect(origin: .zero, size: size)
            g.fill("fff6c8", all)
            g.setStrokeColor(ui("f08a3c").cgColor)
            g.setLineWidth(8)
            g.stroke(all.insetBy(dx: 8, dy: 8))
            let inks = ["e0362f", "2f6fd0", "3fa85a", "f08a3c"]
            let letters = Array("LEMONADE")
            let step = (size.width - 56) / CGFloat(letters.count)
            for (i, letter) in letters.enumerated() {
                g.saveGState()
                g.translateBy(x: 28 + step * (CGFloat(i) + 0.5), y: size.height / 2 + (i % 2 == 0 ? -7 : 8))
                g.rotate(by: i % 2 == 0 ? -0.1 : 0.09)
                write(String(letter), inks[i % inks.count], 96, in: .zero, font: "MarkerFelt-Wide")
                g.restoreGState()
            }
        }
        n.add(MathShape.box(1.14, 0.44, 0.03, post), 0, 0.42, 0.262)
        n.add(MathShape.card(1.08, 0.39, sign), 0, 0.42, 0.279)

        // On the counter: the jug, three cups and the lemons.
        let top: Float = 0.85
        n.add(MathShape.cylinder(0.075, 0.16, c("ffe14a", glow: 0.2), segments: 12), -0.38, top + 0.08, 0.04)
        let rim = MathShape.cylinder(0.08, 0.06, c("ffffff", alpha: 0.45), segments: 12)
        rim.castsShadow = false
        n.add(rim, -0.38, top + 0.19, 0.04)
        let handle = torus(0.05, 0.012, c("e8f4fa"), segments: 12)
        handle.eulerAngles.x = .pi / 2
        n.add(handle, -0.47, top + 0.11, 0.04)
        for (i, hex) in ["e0362f", "2f6fd0", "3fa85a"].enumerated() {
            let x: Float = -0.08 + Float(i) * 0.14, z: Float = 0.14 - Float(i % 2) * 0.09
            n.add(MathShape.cone(0.03, 0.042, 0.09, c(hex), segments: 8), x, top + 0.045, z)
            n.add(MathShape.cylinder(0.038, 0.005, c("ffe14a", glow: 0.2), segments: 8), x, top + 0.092, z)
        }
        for p in [(Float(0.44), Float(-0.04)), (0.53, 0.04), (0.48, -0.01)] {
            let high = p.0 == 0.48
            n.add(MathShape.sphere(0.045, yellow, segments: 8), p.0, top + (high ? 0.11 : 0.042), p.1).scale = SCNVector3(1.25, 1, 1)
        }
        return n
    }

    /// A lawn sprinkler, its fan of water swaying slowly forward and back.
    private static func sprinkler() -> SCNNode {
        let n = SCNNode()
        let yellow = c("ffd23a"), steel = c("8d949b"), hose = c("3f9f5a")
        for x: Float in [-0.2, 0.2] {
            bar(n, V(x, 0.025, -0.14), V(x, 0.025, 0.14), 0.025, yellow)
            n.add(MathShape.box(0.05, 0.1, 0.05, yellow), x, 0.07, 0)
        }
        bar(n, V(-0.2, 0.1, 0), V(0.2, 0.1, 0), 0.022, steel)
        pipe(n, [V(0.2, 0.1, 0), V(0.3, 0.03, -0.03), V(0.45, 0.025, -0.2), V(0.55, 0.025, -0.5)], 0.02, hose)
        // The water: seven jets fanned out along the bar, each a string of drops getting smaller as they go.
        let fan = SCNNode()
        let drop = c("8fd8ff", glow: 0.35, alpha: 0.75)
        for i in 0..<7 {
            let a = (Float(i) - 3) * 0.2
            for j in 1...4 {
                let d = Float(j) * 0.28, droop = Float(j * j) * 0.012
                let bead = MathShape.sphere(0.034 - Float(j) * 0.004, drop, segments: 6)
                bead.castsShadow = false
                fan.add(bead, sin(a) * d, cos(a) * d - droop, 0)
            }
        }
        n.add(fan, 0, 0.1, 0)
        fan.eulerAngles.x = -0.55
        let over = SCNAction.rotateTo(x: 0.55, y: 0, z: 0, duration: 2.6), back = SCNAction.rotateTo(x: -0.55, y: 0, z: 0, duration: 2.6)
        over.timingMode = .easeInEaseOut
        back.timingMode = .easeInEaseOut
        fan.runAction(.repeatForever(.sequence([over, back])))
        return n
    }

    // MARK: Seasonal

    /// A jack-o'-lantern `r` in radius, standing on y = 0 and looking toward +z, its cut-out face lit from inside.
    /// `eyes` picks the face: 0 triangles, 1 round, 2 slanted.
    private static func jack(_ r: Float, eyes: Int, after: Double) -> SCNNode {
        let p = SCNNode()
        let y0 = r * 0.78
        p.add(MathShape.sphere(r, stripes("f08a2c", "d96a1c", 10, thin: 0.25), segments: 14), 0, y0, 0).scale = SCNVector3(1, 0.8, 1)
        p.add(MathShape.cone(r * 0.12, r * 0.08, r * 0.3, c("5f7a2f"), segments: 6), 0, y0 + r * 0.9, 0)
        // How far forward the skin is at a place on the front of it, measured in radii from the middle.
        func skin(_ x: Float, _ y: Float) -> Float { r * max(0.05, 1 - x * x - (y / 0.8) * (y / 0.8)).squareRoot() - r * 0.02 }
        let lit = c("ffd23a", glow: 1)
        let face = SCNNode()
        let deep = r * 0.1
        for s: Float in [-1, 1] {
            let z = skin(0.33, 0.2)
            switch eyes {
            case 0:
                face.add(prism(r * 0.13, r * 0.2, deep, lit), s * r * 0.33, y0 + r * 0.11, z, ry: s * 0.33)
            case 1:
                face.add(MathShape.sphere(r * 0.11, lit, segments: 8), s * r * 0.33, y0 + r * 0.2, z, ry: s * 0.33).scale = SCNVector3(1, 1, 0.5)
            default:
                let eye = MathShape.box(r * 0.24, r * 0.1, deep, lit)
                eye.eulerAngles = SCNVector3(0, s * 0.33, -s * 0.4)
                face.add(eye, s * r * 0.33, y0 + r * 0.2, z)
            }
            // The corners of the grin.
            let corner = MathShape.box(r * 0.24, r * 0.09, deep, lit)
            corner.eulerAngles = SCNVector3(0, s * 0.28, s * 0.45)
            face.add(corner, s * r * 0.25, y0 - r * 0.27, skin(0.25, -0.27))
        }
        face.add(prism(r * 0.06, r * 0.1, deep, lit), 0, y0 - r * 0.08, skin(0, -0.03))
        face.add(MathShape.box(r * 0.3, r * 0.09, deep, lit), 0, y0 - r * 0.33, skin(0, -0.33))
        p.addChildNode(face)
        // The candle inside, guttering.
        let flicker = SCNAction.sequence([.fadeOpacity(to: 0.65, duration: 0.5), .fadeOpacity(to: 1, duration: 0.4), .wait(duration: 0.3)])
        face.runAction(.sequence([.wait(duration: after), .repeatForever(flicker)]))
        return p
    }

    /// Three jack-o'-lanterns, a big one, a middling one and a little one in front.
    private static func pumpkins() -> SCNNode {
        let n = SCNNode()
        n.add(jack(0.24, eyes: 0, after: 0), -0.24, 0, -0.06, ry: 0.15)
        n.add(jack(0.17, eyes: 1, after: 0.4), 0.27, 0, -0.02, ry: -0.25)
        n.add(jack(0.12, eyes: 2, after: 0.8), 0.04, 0, 0.17, ry: 0.1)
        return n
    }

    /// A string of coloured lights, 4 m long, for under the edge of a roof: it hangs down from y = 0,
    /// sagging between its pegs, and its bulbs twinkle.
    private static func eaveLights() -> SCNNode {
        let n = SCNNode()
        let wire = c("23262b")
        let colours = ["ff4a4a", "ffd23a", "4fd06a", "4fa8ff", "ff7fd0"]
        let span: Float = 0.99, sag: Float = 0.1
        // How far down the wire is, a part of the way `t` along a span.
        func hang(_ t: Float) -> Float { -0.03 - sag * (1 - (2 * t - 1) * (2 * t - 1)) }
        var k = 0
        for s in 0..<4 {
            let x0: Float = -1.98 + Float(s) * span
            var points: [V] = []
            for i in 0...4 {
                let t = Float(i) / 4
                points.append(V(x0 + t * span, hang(t), 0))
            }
            pipe(n, points, 0.008, wire, segments: 4)
            for i in 0..<4 {
                let t = (Float(i) + 0.5) / 4
                let bulb = MathShape.sphere(0.04, c(colours[k % colours.count], glow: 1), segments: 8)
                bulb.scale = SCNVector3(1, 1.35, 1)
                bulb.castsShadow = false
                n.add(bulb, x0 + t * span, hang(t) - 0.05, 0)
                let twinkle = SCNAction.sequence([.fadeOpacity(to: 0.45, duration: 0.7), .fadeOpacity(to: 1, duration: 0.7), .wait(duration: 0.6)])
                bulb.runAction(.sequence([.wait(duration: Double(k % 5) * 0.4), .repeatForever(twinkle)]))
                k += 1
            }
        }
        for i in 0...4 { n.add(MathShape.box(0.04, 0.04, 0.04, wire), -1.98 + Float(i) * span, -0.02, 0) }
        return n
    }

    /// A green wreath with berries and a red bow, 0.55 m across, for a door: its back is flat on z = 0
    /// and its middle is the origin.
    private static func doorWreath() -> SCNNode {
        let n = SCNNode()
        let ring = torus(0.215, 0.06, c("2f7f3f"), segments: 20)
        ring.eulerAngles.x = .pi / 2
        n.add(ring, 0, 0, 0.06)
        let leaf = [c("3f9a4a"), c("2a6f38")], berry = c("e0362f", glow: 0.25), red = c("d6263a")
        for i in 0..<12 {
            let t = Float(i) * .pi / 6
            let out: Float = i % 2 == 0 ? 0.225 : 0.195
            n.add(MathShape.sphere(0.045, leaf[i % 2], segments: 6), cos(t) * out, sin(t) * out, 0.09)
        }
        for i in 0..<6 {
            let t = Float(i) * .pi / 3 + 0.4
            n.add(MathShape.sphere(0.02, berry, segments: 6), cos(t) * 0.215, sin(t) * 0.215, 0.128)
        }
        // The bow, at the top, its tails hanging down over the ring.
        for s: Float in [-1, 1] {
            let loop = MathShape.sphere(0.06, red, segments: 8)
            loop.scale = SCNVector3(1.2, 0.75, 0.5)
            loop.eulerAngles.z = s * 0.35
            n.add(loop, s * 0.07, 0.205, 0.135)
            let tail = MathShape.box(0.04, 0.14, 0.012, red)
            tail.eulerAngles.z = s * 0.3
            n.add(tail, s * 0.045, 0.125, 0.13)
        }
        n.add(MathShape.sphere(0.03, red, segments: 8), 0, 0.2, 0.145)
        return n
    }

    /// A drift of snow, about 1.6 by 1.0 and 0.3 deep, with a sparkle or two on it.
    private static func snowDrift() -> SCNNode {
        let n = SCNNode()
        let snow = c("ffffff", glow: 0.25), blue = c("e6f0fb", glow: 0.2)
        // Each lump: where it is across and front to back, how big, and how it's squashed.
        let lumps: [(Float, Float, Float, SCNVector3)] = [
            (0, 0, 0.5, SCNVector3(1.15, 0.6, 0.85)),
            (-0.48, 0.08, 0.32, SCNVector3(1, 0.55, 1)),
            (0.5, -0.05, 0.3, SCNVector3(1, 0.6, 1.1)),
            (0.15, 0.25, 0.28, SCNVector3(1.2, 0.5, 0.85)),
            (-0.2, -0.22, 0.3, SCNVector3(1.1, 0.6, 0.9)),
        ]
        for (i, lump) in lumps.enumerated() {
            let (x, z, r, squash) = lump
            n.add(MathShape.sphere(r, i % 2 == 0 ? snow : blue, segments: 12), x, 0, z).scale = squash
        }
        let spark = c("ffffff", glow: 1)
        for (i, p) in [(Float(-0.15), Float(0.29), Float(0.1)), (0.3, 0.23, 0.2), (-0.5, 0.17, 0.12)].enumerated() {
            let glint = MathShape.sphere(0.014, spark, segments: 6)
            glint.castsShadow = false
            n.add(glint, p.0, p.1, p.2)
            glint.runAction(.sequence([.wait(duration: Double(i) * 0.9),
                                       .repeatForever(.sequence([.fadeOpacity(to: 0, duration: 1.1), .fadeOpacity(to: 1, duration: 1.1)]))]))
        }
        return n
    }

    /// A wrapped present standing on y = 0: the box, a ribbon round it both ways, and a bow on top.
    private static func gift(_ w: Float, _ h: Float, _ l: Float, _ paper: SCNMaterial, _ ribbon: SCNMaterial) -> SCNNode {
        let g = SCNNode()
        g.add(MathShape.box(w, h, l, paper, round: 0.01), 0, h / 2, 0)
        let band = min(w, l) * 0.16
        g.add(MathShape.box(w + 0.012, h + 0.012, band, ribbon), 0, h / 2, 0)
        g.add(MathShape.box(band, h + 0.012, l + 0.012, ribbon), 0, h / 2, 0)
        for s: Float in [-1, 1] {
            let loop = MathShape.sphere(band * 0.85, ribbon, segments: 8)
            loop.scale = SCNVector3(1.3, 0.7, 0.7)
            loop.eulerAngles.z = s * 0.4
            g.add(loop, s * band * 0.9, h + band * 0.5, 0)
        }
        g.add(MathShape.sphere(band * 0.45, ribbon, segments: 6), 0, h + band * 0.45, 0)
        return g
    }

    /// Five presents in a pile, one of them sat on another.
    private static func giftPile() -> SCNNode {
        let n = SCNNode()
        let gold = c("ffd23a", glow: 0.15), white = c("ffffff"), red = c("e0362f")
        n.add(gift(0.5, 0.38, 0.45, red, gold), -0.22, 0, -0.12, ry: 0.15)
        n.add(gift(0.34, 0.55, 0.34, stripes("3fa85a", "ffffff", 6, thin: 0.3), red), 0.3, 0, -0.16, ry: -0.2)
        n.add(gift(0.5, 0.2, 0.36, c("2f6fd0"), white), 0.12, 0, 0.3, ry: 0.35)
        n.add(gift(0.24, 0.24, 0.24, c("ffd23a"), red), -0.36, 0, 0.3, ry: -0.3)
        n.add(gift(0.26, 0.2, 0.26, c("9a5fd0"), gold), -0.2, 0.39, -0.12, ry: 0.6)
        return n
    }

    // MARK: The pets

    /// Charlie, the family's grey Italian greyhound.
    ///
    /// He stands on y = 0 with his nose toward +z, about 0.42 m at the shoulder. He's made still, for
    /// whoever has him to move: everything is inside the node named "body", and in it "head" turns at
    /// the bottom of his neck, "tail" at its root, and "leg-fl", "leg-fr", "leg-bl" and "leg-br" (front
    /// and back, left at -x) each hang from the shoulder or hip, so turning one about x swings it.
    static func greyhound() -> SCNNode {
        let n = SCNNode(), body = SCNNode()
        body.name = "body"
        n.addChildNode(body)
        let coat = c("9a9ea6"), pale = c("c9ccd2"), shade = c("858a93"), dark = c("23262b")

        // A deep narrow chest, a waist tucked up behind it, and the rump.
        body.add(MathShape.sphere(0.1, coat, segments: 14), 0, 0.31, 0.1).scale = SCNVector3(0.62, 1.15, 1.3)
        body.add(MathShape.sphere(0.07, pale, segments: 10), 0, 0.27, 0.175).scale = SCNVector3(0.6, 1.15, 0.75)
        body.add(MathShape.sphere(0.07, coat, segments: 12), 0, 0.37, -0.05).scale = SCNVector3(0.62, 0.78, 1.7)
        body.add(MathShape.sphere(0.085, coat, segments: 12), 0, 0.345, -0.17).scale = SCNVector3(0.72, 0.95, 1.15)

        // The front legs: long, thin and straight.
        for (name, s) in [("leg-fl", Float(-1)), ("leg-fr", 1)] {
            let leg = SCNNode()
            leg.name = name
            leg.add(MathShape.sphere(0.04, coat, segments: 8), 0, 0.01, 0).scale = SCNVector3(0.5, 1.2, 0.9)
            leg.add(capsule(0.02, 0.17, coat), 0, -0.07, 0)
            leg.add(capsule(0.014, 0.16, coat), 0, -0.2, 0.004)
            leg.add(MathShape.sphere(0.02, pale, segments: 8), 0, -0.278, 0.012).scale = SCNVector3(0.95, 0.6, 1.45)
            body.add(leg, s * 0.048, 0.29, 0.14)
        }
        // The back legs: a strong thigh, forward to the knee, back to the hock and down to the paw.
        for (name, s) in [("leg-bl", Float(-1)), ("leg-br", 1)] {
            let leg = SCNNode()
            leg.name = name
            let knee = V(0, -0.115, 0.04), hock = V(0, -0.21, -0.035), foot = V(0, -0.292, -0.02)
            leg.add(MathShape.sphere(0.05, coat, segments: 10), 0, -0.03, 0.005).scale = SCNVector3(0.42, 1.25, 1)
            taper(leg, V(0, -0.01, 0), knee, 0.028, 0.018, coat)
            taper(leg, knee, hock, 0.018, 0.012, coat)
            taper(leg, hock, foot, 0.012, 0.011, coat)
            leg.add(MathShape.sphere(0.018, coat, segments: 8), knee.x, knee.y, knee.z)
            leg.add(MathShape.sphere(0.013, coat, segments: 8), hock.x, hock.y, hock.z)
            leg.add(MathShape.sphere(0.02, pale, segments: 8), 0, -0.298, -0.008).scale = SCNVector3(0.95, 0.6, 1.45)
            body.add(leg, s * 0.05, 0.31, -0.18)
        }

        // A long neck, a small skull, and a long narrow nose.
        let head = SCNNode()
        head.name = "head"
        let low = V(0, -0.02, -0.01), high = V(0, 0.17, 0.05)
        taper(head, low, high, 0.042, 0.027, coat, segments: 10)
        head.add(MathShape.sphere(0.043, coat, segments: 12), 0, 0.185, 0.068).scale = SCNVector3(0.82, 0.88, 1.15)
        taper(head, V(0, 0.183, 0.09), V(0, 0.16, 0.215), 0.027, 0.012, coat, segments: 10)
        taper(head, V(0, 0.173, 0.085), V(0, 0.154, 0.208), 0.021, 0.009, pale)
        head.add(MathShape.sphere(0.013, dark, segments: 8), 0, 0.163, 0.22)
        for s: Float in [-1, 1] {
            head.add(MathShape.sphere(0.009, dark, segments: 6), s * 0.027, 0.2, 0.09)
            // The ears, small and folded back.
            let ear = MathShape.sphere(0.026, shade, segments: 8)
            ear.scale = SCNVector3(0.3, 0.5, 1.15)
            ear.eulerAngles.x = -0.65
            head.add(ear, s * 0.031, 0.196, 0.04)
        }
        // His red collar, with its tag.
        let along = simd_normalize(high - low), at = low + (high - low) * 0.4
        let collar = torus(0.037, 0.009, c("d6263a"), segments: 14)
        collar.simdPosition = at
        aim(collar, V(0, 1, 0), along: along)
        head.addChildNode(collar)
        let front = at + V(0, -along.z, along.y) * 0.047
        head.add(MathShape.sphere(0.01, c("f5c542", glow: 0.3), segments: 6), front.x, front.y, front.z)
        body.add(head, 0, 0.385, 0.19)

        // A whip of a tail, curving down and a little forward at the tip.
        let tail = SCNNode()
        tail.name = "tail"
        let whip: [V] = [V(0, 0, 0), V(0, -0.06, -0.05), V(0, -0.15, -0.075), V(0, -0.225, -0.06), V(0, -0.27, -0.02)]
        let thick: [Float] = [0.013, 0.011, 0.009, 0.007, 0.005]
        for i in 1..<whip.count {
            taper(tail, whip[i - 1], whip[i], thick[i - 1], thick[i], coat, segments: 6)
            tail.add(MathShape.sphere(thick[i], coat, segments: 6), whip[i].x, whip[i].y, whip[i].z)
        }
        body.add(tail, 0, 0.36, -0.255)
        return n
    }

    /// Pippy, the family's grey cat.
    ///
    /// She stands on y = 0 with her nose toward +z, about 0.26 m at the shoulder, her tail up. She's
    /// made still and in the same parts as the dog: "body", and in it "head", "tail", and the legs
    /// "leg-fl", "leg-fr", "leg-bl" and "leg-br", each hanging from its shoulder or hip.
    static func cat() -> SCNNode {
        let n = SCNNode(), body = SCNNode()
        body.name = "body"
        n.addChildNode(body)
        let coat = c("8d9199"), stripe = c("767a82"), pale = c("d9dce1"), sock = c("e4e6ea")
        let pink = c("f29aa8"), green = c("7ed957", glow: 0.3), dark = c("23262b")

        // Round in front and rounder behind, with a pale bib.
        // Her stripes are drawn on: darker bands round her. A ball's picture runs from its top to its
        // bottom, so each ball is laid on its side, top to the front, for the bands to go round her.
        let tabby = MathMat.drawn("street-tabby", 32, 128) { g, size in
            g.fill("8d9199", CGRect(origin: .zero, size: size))
            for at: CGFloat in [0.3, 0.44, 0.58, 0.72] { g.fill("767a82", CGRect(x: 0, y: size.height * at, width: size.width, height: size.height * 0.055)) }
        }
        for (r, y, z, long) in [(Float(0.075), Float(0.19), Float(0.07), Float(1.2)), (0.085, 0.195, -0.07, 1.25)] {
            let ball = MathShape.sphere(r, tabby, segments: 14)
            ball.eulerAngles.x = .pi / 2
            ball.scale = SCNVector3(0.9, long, 0.95)
            body.add(ball, 0, y, z)
        }
        body.add(MathShape.sphere(0.05, pale, segments: 8), 0, 0.165, 0.125).scale = SCNVector3(0.8, 1, 0.7)

        // Short legs, in white socks.
        for (name, s) in [("leg-fl", Float(-1)), ("leg-fr", 1)] {
            let leg = SCNNode()
            leg.name = name
            leg.add(capsule(0.021, 0.15, coat), 0, -0.065, 0)
            leg.add(MathShape.sphere(0.024, sock, segments: 8), 0, -0.1356, 0.008).scale = SCNVector3(1, 0.6, 1.3)
            body.add(leg, s * 0.04, 0.15, 0.1)
        }
        for (name, s) in [("leg-bl", Float(-1)), ("leg-br", 1)] {
            let leg = SCNNode()
            leg.name = name
            leg.add(MathShape.sphere(0.042, coat, segments: 8), 0, -0.02, 0).scale = SCNVector3(0.55, 1.15, 1.05)
            leg.add(capsule(0.02, 0.13, coat), 0, -0.09, -0.005)
            leg.add(MathShape.sphere(0.024, sock, segments: 8), 0, -0.1456, 0.006).scale = SCNVector3(1, 0.6, 1.3)
            body.add(leg, s * 0.048, 0.16, -0.1)
        }

        // A round head on a short neck: pointed ears, green eyes, a pale muzzle and a pink nose.
        let head = SCNNode()
        head.name = "head"
        head.add(MathShape.sphere(0.045, coat, segments: 10), 0, 0.015, 0.02)
        head.add(MathShape.sphere(0.062, coat, segments: 14), 0, 0.065, 0.065).scale = SCNVector3(1.05, 0.93, 0.95)
        head.add(MathShape.sphere(0.027, pale, segments: 8), 0, 0.047, 0.117).scale = SCNVector3(1.25, 0.8, 0.8)
        head.add(MathShape.sphere(0.008, pink, segments: 6), 0, 0.054, 0.139)
        for s: Float in [-1, 1] {
            head.add(MathShape.sphere(0.0125, green, segments: 8), s * 0.027, 0.078, 0.113)
            head.add(MathShape.box(0.004, 0.016, 0.004, dark), s * 0.028, 0.078, 0.1245)
            let ear = pyramid(0.042, 0.05, 0.022, coat)
            ear.eulerAngles.z = -s * 0.3
            head.add(ear, s * 0.036, 0.106, 0.06)
            let inner = pyramid(0.024, 0.032, 0.01, pink)
            inner.eulerAngles.z = -s * 0.3
            head.add(inner, s * 0.037, 0.109, 0.069)
            for lift: Float in [0.012, -0.008] {
                bar(head, V(s * 0.02, 0.047, 0.135), V(s * 0.085, 0.047 + lift, 0.12), 0.0015, c("ffffff"), segments: 4)
            }
        }
        body.add(head, 0, 0.225, 0.12)

        // Her tail, held up in a curve, in four short lengths with a darker tip.
        let tail = SCNNode()
        tail.name = "tail"
        let curve: [V] = [V(0, 0, 0), V(0, 0.065, -0.045), V(0, 0.14, -0.06), V(0, 0.21, -0.045), V(0, 0.262, -0.005)]
        for i in 1..<curve.count {
            let fur = i == curve.count - 1 ? stripe : coat
            bar(tail, curve[i - 1], curve[i], 0.016, fur, segments: 8)
            tail.add(MathShape.sphere(0.016, fur, segments: 8), curve[i].x, curve[i].y, curve[i].z)
        }
        body.add(tail, 0, 0.225, -0.165)
        return n
    }
}
