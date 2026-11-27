import SceneKit
import UIKit

// What stands in the yard of a dream home: the pool and what floats in it,
// the deck, the tree house, the trampoline, the playground, the ball field,
// the basketball court and the vegetable patch. All of it is built here in
// code from boxes, tubes and balls, in the same chunky way as the arcade
// cabinet and the snowman.
//
// Everything is in metres, stands on y = 0 with its middle over the origin,
// and faces +z. The big things (the pool, the deck, the tree house, the
// trampoline, the diamond, the court, the vegetable patch) fill a footprint
// of their own and draw only what's theirs: the grass under them is the
// game's. Nothing here is a light; what's lit glows.

enum HouseYardProps {
    /// Every key `made` knows, for a gallery to show them all.
    static let keys: [String] = [
        "pool", "pool-lagoon", "pool-hot",
        "float-ring", "float-duck", "float-flamingo", "pool-slide", "diving-board", "lounger", "parasol",
        "deck", "bbq", "firepit", "hot-tub",
        "treehouse", "treehouse-pirate", "treehouse-rocket",
        "trampoline", "trampoline-net",
        "swings", "slide", "sandbox", "seesaw", "climber", "merry-go-round",
        "diamond", "bleachers", "scoreboard", "dugout", "pitching-machine",
        "court", "ball-rack",
        "vegpatch", "vegpatch-pumpkins", "vegpatch-flowers",
    ]

    /// Something for the yard, built in code, by its key. Nil for a key it doesn't know.
    static func made(_ key: String) -> SCNNode? {
        switch key {
        case "pool": return pool()
        case "pool-lagoon": return poolLagoon()
        case "pool-hot": return poolHot()
        case "float-ring": return floatRing()
        case "float-duck": return floatDuck()
        case "float-flamingo": return floatFlamingo()
        case "pool-slide": return poolSlide()
        case "diving-board": return divingBoard()
        case "lounger": return lounger()
        case "parasol": return parasol()
        case "deck": return deck()
        case "bbq": return bbq()
        case "firepit": return firepit()
        case "hot-tub": return hotTub()
        case "treehouse": return treehouse()
        case "treehouse-pirate": return treehousePirate()
        case "treehouse-rocket": return treehouseRocket()
        case "trampoline": return trampoline(net: false)
        case "trampoline-net": return trampoline(net: true)
        case "swings": return swings()
        case "slide": return slide()
        case "sandbox": return sandbox()
        case "seesaw": return seesaw()
        case "climber": return climber()
        case "merry-go-round": return merryGoRound()
        case "diamond": return diamond()
        case "bleachers": return bleachers()
        case "scoreboard": return scoreboard()
        case "dugout": return dugout()
        case "pitching-machine": return pitchingMachine()
        case "court": return court()
        case "ball-rack": return ballRack()
        case "vegpatch": return vegpatch()
        case "vegpatch-pumpkins": return vegpatchPumpkins()
        case "vegpatch-flowers": return vegpatchFlowers()
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

    /// A flat board from one point to another, `w` across and `h` thick.
    @discardableResult
    private static func slab(_ n: SCNNode, _ a: V, _ b: V, _ w: Float, _ h: Float, _ m: SCNMaterial) -> SCNNode {
        let board = MathShape.box(w, h, simd_length(b - a), m)
        board.simdPosition = (a + b) / 2
        aim(board, V(0, 0, 1), along: b - a)
        n.addChildNode(board)
        return board
    }

    /// A length of slide from one point to another: a bed with a wall down each side, and water down it if there's any.
    private static func trough(_ n: SCNNode, _ a: V, _ b: V, width: Float, bed: SCNMaterial, wall: SCNMaterial, stream: SCNMaterial? = nil) {
        let length = simd_length(b - a) + 0.05
        let part = SCNNode()
        part.add(MathShape.box(width, 0.05, length, bed), 0, 0, 0)
        for side: Float in [-1, 1] { part.add(MathShape.box(0.06, 0.2, length, wall, round: 0.02), side * (width / 2 + 0.03), 0.075, 0) }
        if let stream { part.add(MathShape.box(width * 0.6, 0.012, length, stream), 0, 0.032, 0) }
        part.simdPosition = (a + b) / 2
        aim(part, V(0, 0, 1), along: b - a)
        n.addChildNode(part)
    }

    /// A ladder from the middle of its foot to the middle of its top, its rungs running across x.
    private static func ladder(_ n: SCNNode, _ a: V, _ b: V, width: Float, _ rail: SCNMaterial, _ rung: SCNMaterial, steps: Int, r: Float = 0.035) {
        let half = V(width / 2, 0, 0)
        bar(n, a - half, b - half, r, rail)
        bar(n, a + half, b + half, r, rail)
        for i in 1...max(steps, 1) {
            let p = a + (b - a) * (Float(i) / Float(steps + 1))
            bar(n, p - half, p + half, r * 0.85, rung)
        }
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

    /// A rocket's fin, standing on y = 0 and reaching out along x.
    private static func fin(_ w: Float, _ h: Float, _ m: SCNMaterial) -> SCNNode {
        let path = UIBezierPath()
        path.move(to: .zero)
        path.addLine(to: CGPoint(x: CGFloat(w), y: 0))
        path.addLine(to: CGPoint(x: CGFloat(w), y: CGFloat(h) * 0.3))
        path.addLine(to: CGPoint(x: 0, y: CGFloat(h)))
        path.close()
        let g = SCNShape(path: path, extrusionDepth: 0.07)
        g.materials = [m]
        return SCNNode(geometry: g)
    }

    /// Up and down a little, and tipping, the way a thing floats.
    private static func bob(_ node: SCNNode, by: CGFloat = 0.035, every: Double = 1.7, tip: CGFloat = 0.05) {
        let up = SCNAction.group([.moveBy(x: 0, y: by, z: 0, duration: every), .rotateTo(x: tip, y: 0, z: -tip, duration: every)])
        let down = SCNAction.group([.moveBy(x: 0, y: -by, z: 0, duration: every), .rotateTo(x: -tip, y: 0, z: tip, duration: every)])
        up.timingMode = .easeInEaseOut
        down.timingMode = .easeInEaseOut
        node.runAction(.repeatForever(.sequence([up, down])))
    }

    /// Puffs of steam going up from around a point, one after another.
    private static func steam(_ n: SCNNode, at p: V, spread: Float, count: Int = 3, seed: UInt64 = 7) {
        var rng = MathRNG(seed: seed)
        for i in 0..<count {
            let puff = MathShape.sphere(0.16, c("ffffff", alpha: 0.7), segments: 8)
            puff.castsShadow = false
            puff.opacity = 0
            let x = p.x + rng.range(-spread, spread), z = p.z + rng.range(-spread, spread)
            n.add(puff, x, p.y, z)
            let up = SCNAction.group([.moveBy(x: 0.15, y: 1.1, z: 0, duration: 3.4), .scale(to: 1.9, duration: 3.4),
                                      .sequence([.fadeOpacity(to: 0.55, duration: 0.6), .fadeOpacity(to: 0, duration: 2.8)])])
            let back = SCNAction.group([.move(to: SCNVector3(x, p.y, z), duration: 0), .scale(to: 1, duration: 0)])
            puff.runAction(.sequence([.wait(duration: Double(i) * 1.1), .repeatForever(.sequence([up, back]))]))
        }
    }

    /// Bubbles on water, each growing and popping in its own time.
    private static func bubbles(_ n: SCNNode, y: Float, within r: Float, count: Int, seed: UInt64) {
        var rng = MathRNG(seed: seed)
        let foam = c("ffffff", glow: 0.4)
        for i in 0..<count {
            let t = rng.range(0, .pi * 2), d = r * rng.range(0.05, 0.85).squareRoot()
            let bubble = MathShape.sphere(rng.range(0.045, 0.09), foam, segments: 8)
            n.add(bubble, cos(t) * d, y, sin(t) * d)
            let pop = SCNAction.sequence([.scale(to: 0.3, duration: 0.5 + Double(i % 3) * 0.2), .scale(to: 1, duration: 0.6 + Double(i % 4) * 0.15)])
            bubble.runAction(.repeatForever(pop))
        }
    }

    /// A flame and the brighter one inside it, flickering.
    private static func flame(_ n: SCNNode, _ x: Float, _ y: Float, _ z: Float, _ s: Float) {
        let outer = MathShape.cone(0.2 * s, 0, 0.55 * s, c("ff9a2f", glow: 1), segments: 8)
        n.add(outer, x, y + 0.275 * s, z)
        n.add(MathShape.cone(0.11 * s, 0, 0.32 * s, c("ffe14a", glow: 1), segments: 8), x, y + 0.18 * s, z)
        outer.runAction(.repeatForever(.sequence([.scale(to: 1.12, duration: 0.25), .scale(to: 0.92, duration: 0.2), .scale(to: 1.05, duration: 0.3)])))
    }

    // MARK: Drawn surfaces

    /// Boards side by side, running across the picture.
    private static func planks(_ hex: String, _ gap: String, boards: Int = 8) -> SCNMaterial {
        MathMat.drawn("yard-planks-\(hex)-\(gap)-\(boards)", 256, 256) { g, size in
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

    /// Boards standing up, for a wall or the side of a barrel.
    private static func staves(_ hex: String, _ gap: String, _ count: Int) -> SCNMaterial {
        MathMat.drawn("yard-staves-\(hex)-\(gap)-\(count)", 256, 64) { g, size in
            g.fill(hex, CGRect(origin: .zero, size: size))
            let w = size.width / CGFloat(count)
            for i in 0..<count {
                if i % 2 == 1 {
                    g.setFillColor(UIColor.black.withAlphaComponent(0.07).cgColor)
                    g.fill(CGRect(x: CGFloat(i) * w, y: 0, width: w, height: size.height))
                }
                g.fill(gap, CGRect(x: CGFloat(i) * w, y: 0, width: 3, height: size.height))
            }
        }
    }

    /// Stripes of `b` on `a`, `bands` of them across; `thin` is how much of each band is `b`.
    private static func stripes(_ a: String, _ b: String, _ bands: Int, thin: CGFloat = 0.5, doubleSided: Bool = false) -> SCNMaterial {
        MathMat.drawn("yard-stripes-\(a)-\(b)-\(bands)-\(thin)-\(doubleSided)", 256, 16, doubleSided: doubleSided) { g, size in
            g.fill(a, CGRect(origin: .zero, size: size))
            let w = size.width / CGFloat(bands)
            for i in 0..<bands { g.fill(b, CGRect(x: CGFloat(i) * w, y: 0, width: w * thin, height: size.height)) }
        }
    }

    /// A net or chain-link, seen through: crossed wires on a faint haze, repeated `u` by `v` times.
    private static func mesh(_ hex: String, u: Float, v: Float, haze: CGFloat = 0.14) -> SCNMaterial {
        MathMat.drawn("yard-mesh-\(hex)-\(haze)", 64, 64, u: u, v: v, doubleSided: true, clear: true) { g, size in
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
    private static func write(_ s: String, _ hex: String, _ size: CGFloat, in rect: CGRect) {
        let text = NSAttributedString(string: s, attributes: [
            .font: UIFont(name: "AvenirNext-Heavy", size: size) ?? UIFont.systemFont(ofSize: size, weight: .heavy),
            .foregroundColor: ui(hex),
        ])
        let b = text.size()
        text.draw(at: CGPoint(x: rect.midX - b.width / 2, y: rect.midY - b.height / 2))
    }

    // MARK: Pools

    /// The swimming pool, 7 by 4: a stone edge, tiles and lane lines under the water, a ladder at the right-hand end.
    private static func pool() -> SCNNode {
        let n = SCNNode()
        let W: Float = 7, D: Float = 4, rim: Float = 0.4
        let stone = c("e9dfc8")
        for side: Float in [-1, 1] {
            n.add(MathShape.box(W, 0.12, rim, stone, round: 0.03), 0, 0.06, side * (D - rim) / 2)
            n.add(MathShape.box(rim, 0.12, D - rim * 2, stone, round: 0.03), side * (W - rim) / 2, 0.06, 0)
        }
        let tiles = MathMat.drawn("yard-pool-tiles", 512, 256) { g, size in
            g.fill("8fdde0", CGRect(origin: .zero, size: size))
            g.setFillColor(UIColor.white.withAlphaComponent(0.35).cgColor)
            var x: CGFloat = 0
            while x < size.width { g.fill(CGRect(x: x, y: 0, width: 2, height: size.height)); x += 32 }
            var y: CGFloat = 0
            while y < size.height { g.fill(CGRect(x: 0, y: y, width: size.width, height: 2)); y += 32 }
            // The lane lines along the bottom, each with a T at its ends.
            for lane: CGFloat in [0.33, 0.67] {
                let at = size.height * lane
                g.fill("1f5fa8", CGRect(x: 40, y: at - 6, width: size.width - 80, height: 12))
                for end: CGFloat in [40, size.width - 52] { g.fill("1f5fa8", CGRect(x: end, y: at - 22, width: 12, height: 44)) }
            }
        }
        let inW = W - rim * 2, inD = D - rim * 2
        n.add(MathShape.floor(inW, inD, tiles), 0, 0.015, 0)
        // Thinner than most water here, so the tiles and the lanes show through it.
        let water = MathShape.floor(inW, inD, c("4fb8e8", glow: 0.15, alpha: 0.72))
        water.castsShadow = false
        n.add(water, 0, 0.04, 0)
        // The light on it, coming and going.
        let glint = c("ffffff", glow: 0.6, alpha: 0.6)
        for (i, p) in [(Float(-1.9), Float(-0.7)), (0.4, 0.9), (1.7, -0.4), (-0.6, 0.3)].enumerated() {
            let shine = MathShape.floor(0.55, 0.05, glint)
            shine.castsShadow = false
            shine.renderingOrder = 1
            n.add(shine, p.0, 0.05, p.1)
            shine.runAction(.sequence([.wait(duration: Double(i) * 0.7),
                                       .repeatForever(.sequence([.fadeOpacity(to: 0.1, duration: 1.4), .fadeOpacity(to: 1, duration: 1.4)]))]))
        }
        // The ladder: two rails up off the edge, over, and down into the water, with steps between.
        let chrome = c("dfe7ee", glow: 0.1)
        let ex = W / 2
        for z: Float in [-0.25, 0.25] {
            pipe(n, [V(ex - 0.14, 0.1, z), V(ex - 0.14, 0.72, z), V(ex - 0.2, 0.84, z), V(ex - 0.32, 0.9, z),
                     V(ex - 0.44, 0.84, z), V(ex - 0.5, 0.72, z), V(ex - 0.5, 0.03, z)], 0.03, chrome)
        }
        for y: Float in [0.22, 0.45] { bar(n, V(ex - 0.5, y, -0.25), V(ex - 0.5, y, 0.25), 0.025, chrome) }
        return n
    }

    /// The lagoon, 7 by 4: boulders round green-blue water, a waterfall in the back-left corner, lily pads and reeds.
    private static func poolLagoon() -> SCNNode {
        let n = SCNNode()
        let bed = MathShape.cylinder(1.52, 0.02, c("2f8f86"), segments: 28)
        bed.scale = SCNVector3(1.95, 1, 1)
        n.add(bed, 0, 0.012, 0)
        let water = MathShape.cylinder(1.5, 0.01, c("3fc4b0", glow: 0.15, alpha: 0.85), segments: 28)
        water.scale = SCNVector3(1.95, 1, 1)
        water.castsShadow = false
        n.add(water, 0, 0.045, 0)

        var rng = MathRNG(seed: 23)
        let rocks = [c("5f6468"), c("767b7e"), c("6b665e"), c("8a8478")]
        let count = 30
        for i in 0..<count {
            let t = Float(i) / Float(count) * .pi * 2 + rng.range(-0.04, 0.04)
            let r = rng.range(0.3, 0.42)
            let rock = MathShape.sphere(r, rocks[i % rocks.count], segments: 7)
            rock.scale = SCNVector3(rng.range(0.9, 1.15), rng.range(0.55, 0.8), rng.range(0.9, 1.15))
            rock.eulerAngles.y = rng.range(0, 3)
            n.add(rock, cos(t) * 3.02, r * 0.3, sin(t) * 1.55)
        }

        // The waterfall: a heap of rock with water coming down the front of it. Made facing +z, then turned to face the middle.
        let fall = SCNNode()
        fall.add(MathShape.sphere(0.55, rocks[0], segments: 8), 0, 0.36, 0).scale = SCNVector3(1.2, 0.9, 1)
        fall.add(MathShape.sphere(0.42, rocks[1], segments: 8), -0.12, 0.9, -0.1)
        fall.add(MathShape.sphere(0.36, rocks[2], segments: 8), 0.38, 0.7, -0.05)
        fall.add(MathShape.sphere(0.3, rocks[3], segments: 8), -0.5, 0.28, 0.15)
        fall.add(MathShape.sphere(0.34, rocks[0], segments: 8), 0.05, 1.2, -0.05).scale = SCNVector3(1.3, 0.45, 1.1)
        let sheet = slab(fall, V(0.02, 1.32, 0.22), V(0.02, 0.06, 0.74), 0.42, 0.04, c("bfefff", glow: 0.5, alpha: 0.85))
        sheet.castsShadow = false
        let foam = c("ffffff", glow: 0.5)
        for (i, x) in [Float(-0.16), 0.04, 0.2].enumerated() {
            let puff = MathShape.sphere(0.11, foam, segments: 8)
            fall.add(puff, x, 0.08, 0.8)
            puff.runAction(.repeatForever(.sequence([.scale(to: 0.6, duration: 0.35 + Double(i) * 0.1), .scale(to: 1.1, duration: 0.4)])))
        }
        n.add(fall, -2.6, 0, -1.2, ry: 1.12)

        // Lily pads, one in flower.
        let pad = c("4f9a45")
        for p in [(Float(1.2), Float(0.5)), (1.55, 0.15), (0.5, -0.7)] { n.add(MathShape.cylinder(0.17, 0.012, pad, segments: 10), p.0, 0.06, p.1) }
        n.add(MathShape.sphere(0.06, c("ff8fc0", glow: 0.2), segments: 8), 1.2, 0.1, 0.5)
        // Reeds at the front.
        for (i, p) in [(Float(2.1), Float(0.95)), (2.25, 0.85), (2.0, 1.05), (2.3, 1.0)].enumerated() {
            let tall: Float = 0.7 + Float(i % 3) * 0.15
            bar(n, V(p.0, 0, p.1), V(p.0 + 0.04, tall, p.1), 0.018, c("5fae52"))
            n.add(capsule(0.035, 0.18, c("6b4a2a")), p.0 + 0.04, tall, p.1)
        }
        return n
    }

    /// The hot spring, 4 by 4: a stone-rimmed round tub in a wooden surround, steaming.
    private static func poolHot() -> SCNNode {
        let n = SCNNode()
        let side = c("9a6a3f")
        n.add(MathShape.faced(4, 0.14, 4, [side, side, side, side, planks("c08a56", "8a5a3a", boards: 12), side]), 0, 0.07, 0)
        n.add(MathShape.cylinder(1.3, 0.34, c("8d949b"), segments: 28), 0, 0.31, 0)
        let stones = [c("a39b90"), c("7f858a"), c("b8b0a2")]
        for i in 0..<14 {
            let t = Float(i) * .pi * 2 / 14
            n.add(MathShape.sphere(0.17, stones[i % 3], segments: 7), sin(t) * 1.2, 0.47, cos(t) * 1.2).scale = SCNVector3(1.2, 0.6, 1)
        }
        n.add(MathShape.cylinder(1.08, 0.02, c("2aa6b8"), segments: 28), 0, 0.49, 0)
        let water = MathShape.cylinder(1.06, 0.01, c("5fe0e8", glow: 0.35, alpha: 0.85), segments: 28)
        water.castsShadow = false
        n.add(water, 0, 0.525, 0)
        bubbles(n, y: 0.53, within: 0.95, count: 9, seed: 3)
        steam(n, at: V(0, 0.6, 0), spread: 0.6, count: 4, seed: 11)
        // A lantern at each back corner.
        for x: Float in [-1.75, 1.75] {
            n.add(MathShape.box(0.1, 0.7, 0.1, c("5a4032")), x, 0.49, -1.75)
            n.add(MathShape.box(0.2, 0.22, 0.2, c("ffe9a0", glow: 1)), x, 0.95, -1.75)
            n.add(MathShape.box(0.26, 0.05, 0.26, c("5a4032")), x, 1.08, -1.75)
        }
        return n
    }

    // MARK: Round the pool

    /// A pink ring to float in, about a metre across.
    private static func floatRing() -> SCNNode {
        let n = SCNNode(), f = SCNNode()
        f.add(torus(0.36, 0.14, stripes("ff6fae", "ffffff", 8, thin: 0.3), segments: 24), 0, 0.12, 0)
        n.addChildNode(f)
        bob(f)
        return n
    }

    /// A giant yellow duck to float in.
    private static func floatDuck() -> SCNNode {
        let n = SCNNode(), f = SCNNode()
        let yellow = c("ffd21f"), orange = c("f08a3c"), black = c("101010")
        f.add(torus(0.4, 0.2, yellow, segments: 24), 0, 0.18, 0)
        f.add(MathShape.cylinder(0.3, 0.05, c("ffe169"), segments: 16), 0, 0.1, 0)
        f.add(MathShape.sphere(0.24, yellow, segments: 12), 0, 0.42, 0.42).scale = SCNVector3(0.9, 1.3, 0.9)
        f.add(MathShape.sphere(0.25, yellow, segments: 14), 0, 0.84, 0.5)
        let beak = MathShape.cone(0.1, 0.04, 0.2, orange, segments: 10)
        beak.eulerAngles.x = .pi / 2
        beak.scale = SCNVector3(1.3, 1, 0.6)
        f.add(beak, 0, 0.8, 0.78)
        for x: Float in [-0.11, 0.11] { f.add(MathShape.sphere(0.04, black, segments: 8), x, 0.92, 0.7) }
        let tail = MathShape.cone(0.14, 0.02, 0.28, yellow, segments: 8)
        tail.eulerAngles.x = -0.9
        f.add(tail, 0, 0.38, -0.56)
        for x: Float in [-0.52, 0.52] { f.add(MathShape.sphere(0.17, yellow, segments: 10), x, 0.36, -0.02).scale = SCNVector3(0.45, 0.75, 1.3) }
        n.addChildNode(f)
        bob(f, every: 1.9)
        return n
    }

    /// A pink flamingo to float in.
    private static func floatFlamingo() -> SCNNode {
        let n = SCNNode(), f = SCNNode()
        let pink = c("ff7fb0"), deep = c("f0609a")
        f.add(torus(0.43, 0.2, pink, segments: 24), 0, 0.18, 0)
        f.add(MathShape.cylinder(0.33, 0.05, c("ffa8c8"), segments: 16), 0, 0.1, 0)
        // The neck: up, back a little, and forward again to the head.
        let neck: [V] = [V(0, 0.2, 0.45), V(0, 0.55, 0.56), V(0, 0.88, 0.48), V(0, 1.06, 0.56)]
        pipe(n: f, neck, pink)
        f.add(MathShape.sphere(0.12, pink, segments: 10), 0, 1.1, 0.62)
        let beak = MathShape.cone(0.06, 0.035, 0.14, c("ffffff"), segments: 8)
        beak.eulerAngles.x = 2.0
        f.add(beak, 0, 1.06, 0.74)
        let tip = MathShape.cone(0.035, 0.005, 0.1, c("20242c"), segments: 8)
        tip.eulerAngles.x = 2.0
        f.add(tip, 0, 1.01, 0.85)
        for x: Float in [-0.07, 0.07] { f.add(MathShape.sphere(0.022, c("20242c"), segments: 6), x, 1.15, 0.7) }
        for x: Float in [-0.56, 0.56] { f.add(MathShape.sphere(0.2, deep, segments: 10), x, 0.36, -0.05).scale = SCNVector3(0.4, 0.8, 1.4) }
        let tail = MathShape.cone(0.15, 0.02, 0.3, deep, segments: 8)
        tail.eulerAngles.x = -0.9
        f.add(tail, 0, 0.38, -0.6)
        n.addChildNode(f)
        bob(f, every: 2.1)
        return n
    }

    /// A thick bent neck: bars through the points, with a ball at each bend so it's smooth.
    private static func pipe(n: SCNNode, _ points: [V], _ m: SCNMaterial) {
        pipe(n, points, 0.075, m, segments: 8)
        for p in points { n.add(MathShape.sphere(0.075, m, segments: 8), p.x, p.y, p.z) }
    }

    /// A curvy water slide: a ladder at the back, a platform, and the chute winding down toward +z.
    private static func poolSlide() -> SCNNode {
        let n = SCNNode()
        let white = c("f6f1e4"), blue = c("2f9fe8"), wall = c("1f6fc0"), stream = c("c9f1ff", glow: 0.4)
        let top: Float = 1.55
        n.add(MathShape.box(0.8, 0.06, 0.62, white), 0, top - 0.03, -0.95)
        ladder(n, V(0, 0, -1.3), V(0, top, -1.25), width: 0.6, white, white, steps: 5, r: 0.04)
        for x: Float in [-0.36, 0.36] {
            bar(n, V(x, 0, -0.68), V(x, top - 0.06, -0.68), 0.04, white)
            pipe(n, [V(x, top, -1.25), V(x, 1.9, -1.2), V(x, 2.0, -1.0), V(x, 1.9, -0.78), V(x, top + 0.16, -0.62)], 0.03, white)
        }
        // The chute: steep at the top, levelling out, and swinging one way and then the other.
        var points: [V] = []
        let steps = 8
        for i in 0...steps {
            let t = Float(i) / Float(steps)
            points.append(V(0.22 * sin(t * .pi * 2), 0.22 + (top - 0.22) * pow(1 - t, 1.7), -0.65 + 1.95 * t))
        }
        for i in 0..<steps { trough(n, points[i], points[i + 1], width: 0.56, bed: blue, wall: wall, stream: stream) }
        for i in [3, 6] { bar(n, V(points[i].x, 0, points[i].z), V(points[i].x, points[i].y - 0.02, points[i].z), 0.04, white) }
        return n
    }

    /// A diving board: a block to stand it on, and two metres of springy board out toward +z.
    private static func divingBoard() -> SCNNode {
        let n = SCNNode()
        let chrome = c("dfe7ee", glow: 0.1)
        n.add(MathShape.box(0.62, 0.42, 0.7, c("e9eef2"), round: 0.04), 0, 0.21, -0.65)
        n.add(MathShape.box(0.64, 0.1, 0.72, c("2f9fe8")), 0, 0.26, -0.65)
        n.add(MathShape.box(0.5, 0.06, 0.3, c("8d949b")), 0, 0.445, -0.85)
        n.add(MathShape.box(0.5, 0.36, 0.12, c("8d949b")), 0, 0.18, -0.15)
        let roller = MathShape.cylinder(0.06, 0.56, c("5b6470"), segments: 10)
        roller.eulerAngles.z = .pi / 2
        n.add(roller, 0, 0.415, -0.15)
        let board = SCNNode()
        board.add(MathShape.box(0.46, 0.05, 2.0, c("f6f1e4"), round: 0.02), 0, 0, 1.0)
        board.add(MathShape.box(0.4, 0.02, 1.1, c("57c8e8")), 0, 0.035, 1.4)
        n.add(board, 0, 0.5, -1.0)
        // Still springing from whoever went last.
        let up = SCNAction.rotateTo(x: -0.035, y: 0, z: 0, duration: 0.9), down = SCNAction.rotateTo(x: 0.012, y: 0, z: 0, duration: 0.9)
        up.timingMode = .easeInEaseOut
        down.timingMode = .easeInEaseOut
        board.runAction(.repeatForever(.sequence([up, down])))
        for x: Float in [-0.36, 0.36] {
            pipe(n, [V(x, 0.3, -0.97), V(x, 1.0, -0.97), V(x, 1.08, -0.8), V(x, 1.0, -0.5), V(x, 0.3, -0.36)], 0.03, chrome)
        }
        return n
    }

    /// A sun lounger with a striped cushion, its head end (the back, -z) raised.
    private static func lounger() -> SCNNode {
        let n = SCNNode()
        let teak = c("b98452"), cloth = stripes("ffffff", "57c8e8", 5)
        n.add(MathShape.box(0.7, 0.07, 1.25, teak, round: 0.02), 0, 0.3, 0.325)
        n.add(MathShape.box(0.62, 0.08, 1.2, cloth, round: 0.03), 0, 0.375, 0.33)
        for x: Float in [-0.3, 0.3] { for z: Float in [-0.22, 0.85] { n.add(MathShape.box(0.06, 0.27, 0.06, teak), x, 0.135, z) } }
        let back = SCNNode()
        back.add(MathShape.box(0.7, 0.07, 0.72, teak, round: 0.02), 0, 0, -0.36)
        back.add(MathShape.box(0.62, 0.08, 0.68, cloth, round: 0.03), 0, 0.075, -0.36)
        back.add(MathShape.box(0.44, 0.1, 0.22, c("ffd23a"), round: 0.04), 0, 0.15, -0.54)
        back.eulerAngles.x = 0.6
        n.add(back, 0, 0.3, -0.3)
        for x: Float in [-0.3, 0.3] { bar(n, V(x, 0, -0.72), V(x, 0.5, -0.62), 0.025, teak) }
        return n
    }

    /// A parasol: a pole on a foot, and a canopy in wedges of red and white.
    private static func parasol() -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.cylinder(0.3, 0.08, c("e9eef2"), segments: 16), 0, 0.04, 0)
        n.add(MathShape.cylinder(0.035, 2.3, c("f6f1e4"), segments: 8), 0, 1.15, 0)
        // Six stripes of each colour round twelve sides: every side of the canopy is one wedge.
        let cloth = stripes("ff5a5f", "ffffff", 6, doubleSided: true)
        n.add(MathShape.cone(1.1, 0.04, 0.5, cloth, segments: 12), 0, 2.02, 0)
        n.add(MathShape.cylinder(1.1, 0.1, cloth, segments: 12), 0, 1.72, 0)
        n.add(MathShape.sphere(0.07, c("f5c542", glow: 0.2), segments: 8), 0, 2.33, 0)
        return n
    }

    // MARK: The deck

    /// The deck, 4 by 3: a low platform of planks with a rail along the back.
    private static func deck() -> SCNNode {
        let n = SCNNode()
        let side = c("9a6a3f"), post = c("f6f1e4")
        n.add(MathShape.faced(4, 0.14, 3, [side, side, side, side, planks("c08a56", "8a5a3a", boards: 10), side]), 0, 0.07, 0)
        for i in 0..<5 { n.add(MathShape.box(0.1, 0.7, 0.1, post), -1.9 + Float(i) * 0.95, 0.49, -1.42) }
        n.add(MathShape.box(4, 0.07, 0.14, post), 0, 0.86, -1.42)
        n.add(MathShape.box(3.8, 0.05, 0.05, post), 0, 0.5, -1.42)
        return n
    }

    /// A kettle barbecue on three legs with its lid up, sausages on, and the sauces on a shelf.
    private static func bbq() -> SCNNode {
        let n = SCNNode()
        let red = c("d6263a"), dark = c("2a2d33"), wood = c("b98452")
        for i in 0..<3 {
            let t = Float(i) * .pi * 2 / 3
            bar(n, V(sin(t) * 0.3, 0, cos(t) * 0.3), V(sin(t) * 0.13, 0.56, cos(t) * 0.13), 0.022, dark)
        }
        n.add(MathShape.sphere(0.17, red, segments: 12), 0, 0.57, 0).scale = SCNVector3(1, 0.6, 1)
        n.add(MathShape.cone(0.16, 0.33, 0.26, red, segments: 16), 0, 0.68, 0)
        n.add(MathShape.cylinder(0.335, 0.03, dark, segments: 16), 0, 0.82, 0)
        n.add(MathShape.cylinder(0.29, 0.02, c("ff7a2f", glow: 0.8), segments: 16), 0, 0.845, 0)
        for i in 0..<5 {
            let z: Float = -0.2 + Float(i) * 0.1
            let length: Float = 2 * (0.29 * 0.29 - z * z).squareRoot()
            n.add(MathShape.box(length, 0.012, 0.014, dark), 0, 0.866, z)
        }
        for (i, x) in [Float(-0.12), 0, 0.12].enumerated() {
            let sausage = capsule(0.03, 0.22, c("b5532f"))
            sausage.eulerAngles.x = .pi / 2
            n.add(sausage, x, 0.9, Float(i % 2) * 0.04 - 0.02)
        }
        // The lid, tipped up behind.
        let lid = MathShape.sphere(0.33, red, segments: 14)
        lid.scale = SCNVector3(1, 0.45, 1)
        lid.eulerAngles.x = -1.1
        n.add(lid, 0, 1.0, -0.38)
        n.add(MathShape.sphere(0.045, dark, segments: 8), 0, 1.07, -0.52)
        // The shelf.
        n.add(MathShape.box(0.24, 0.03, 0.34, wood), 0.45, 0.79, 0)
        bar(n, V(0.3, 0.6, 0), V(0.52, 0.78, 0), 0.015, dark)
        n.add(MathShape.cylinder(0.035, 0.14, c("e0362f"), segments: 8), 0.42, 0.875, 0.08)
        n.add(MathShape.cylinder(0.035, 0.14, c("ffd23a"), segments: 8), 0.49, 0.875, -0.06)
        return n
    }

    /// A fire pit: a ring of stones, embers, logs leaning together, and the fire.
    private static func firepit() -> SCNNode {
        let n = SCNNode()
        let stones = [c("9a9288"), c("b3aa9c"), c("857d74")]
        for i in 0..<10 {
            let t = Float(i) * .pi / 5
            n.add(MathShape.box(0.3, 0.22, 0.2, stones[i % 3], round: 0.05), sin(t) * 0.45, 0.11, cos(t) * 0.45, ry: t)
        }
        n.add(MathShape.cylinder(0.37, 0.05, c("3a2f2a"), segments: 14), 0, 0.025, 0)
        n.add(MathShape.cylinder(0.3, 0.02, c("ff6a1f", glow: 0.9), segments: 12), 0, 0.06, 0)
        for i in 0..<3 {
            let t = Float(i) * .pi * 2 / 3 + 0.4
            bar(n, V(sin(t) * 0.3, 0.08, cos(t) * 0.3), V(-sin(t) * 0.06, 0.44, -cos(t) * 0.06), 0.05, c("5a4032"), segments: 7)
        }
        flame(n, 0, 0.12, 0, 1)
        flame(n, 0.12, 0.08, 0.08, 0.6)
        return n
    }

    /// A round wooden hot tub with steps up to it.
    private static func hotTub() -> SCNNode {
        let n = SCNNode()
        let step = c("c08a56")
        n.add(MathShape.cylinder(0.93, 0.74, staves("b5733f", "7c4a28", 28), segments: 24), 0, 0.37, 0)
        for y: Float in [0.18, 0.58] { n.add(MathShape.cylinder(0.945, 0.05, c("4a4f57"), segments: 24), 0, y, 0) }
        n.add(MathShape.cylinder(0.95, 0.06, c("d9a56b"), segments: 24), 0, 0.77, 0)
        n.add(MathShape.cylinder(0.84, 0.02, c("2aa6b8"), segments: 24), 0, 0.81, 0)
        let water = MathShape.cylinder(0.83, 0.01, c("5fd0e8", glow: 0.3, alpha: 0.85), segments: 24)
        water.castsShadow = false
        n.add(water, 0, 0.845, 0)
        bubbles(n, y: 0.85, within: 0.72, count: 9, seed: 5)
        steam(n, at: V(0, 0.9, 0), spread: 0.4, count: 3, seed: 13)
        n.add(MathShape.box(0.7, 0.4, 0.3, step, round: 0.02), 0, 0.2, 1.08)
        n.add(MathShape.box(0.7, 0.2, 0.3, step, round: 0.02), 0, 0.1, 1.38)
        return n
    }

    // MARK: Tree houses

    /// How far along x the tree house's ladder comes up, and the door it comes up to.
    private static let treeGap: Float = -0.4

    /// What every tree house has, on a footprint 4 by 4: the tree at the back, a platform 3 by 3 with rails
    /// at 2.4 m, the ladder up the front, and a tyre on a rope. Hands back how high the platform's top is.
    /// The platform's middle is at z = 0.2 and the trunk comes up through the back of it.
    private static func treehouseBase(_ n: SCNNode) -> Float {
        let bark = c("7a5234"), leaf = [c("4f9a45"), c("3f8f4a"), c("5fae52")]
        let wood = c("b98452"), dark = c("8a5a3a"), rail = c("d9a56b")
        let tz: Float = -1.15, pz: Float = 0.2, top: Float = 2.46, gap = treeGap

        n.add(MathShape.cone(0.5, 0.36, 5.5, bark, segments: 10), 0, 2.75, tz)
        for i in 0..<4 {
            let t = Float(i) * .pi / 2 + 0.5
            bar(n, V(sin(t) * 0.8, 0, tz + cos(t) * 0.8), V(sin(t) * 0.3, 0.75, tz + cos(t) * 0.3), 0.13, bark)
        }
        n.add(MathShape.sphere(1.4, leaf[0], segments: 10), 0, 6.5, -0.6)
        n.add(MathShape.sphere(1.0, leaf[1], segments: 10), -0.95, 5.9, -0.5)
        n.add(MathShape.sphere(1.0, leaf[2], segments: 10), 0.95, 5.9, -0.5)
        n.add(MathShape.sphere(0.95, leaf[2], segments: 10), 0, 6.3, 0.5)
        n.add(MathShape.sphere(0.75, leaf[1], segments: 10), 0, 5.7, -1.25)

        // The platform, held up by the tree at the back and two stilts at the front.
        n.add(MathShape.faced(3, 0.12, 3, [dark, dark, dark, dark, planks("c99a5f", "8a5a3a", boards: 10), dark]), 0, top - 0.06, pz)
        for x: Float in [-1.38, 1.38] {
            bar(n, V(x, 0, pz + 1.38), V(x, top - 0.12, pz + 1.38), 0.07, dark, segments: 8)
            bar(n, V(x * 0.25, 1.4, tz), V(x, top - 0.12, tz + 0.1), 0.07, dark, segments: 8)
        }

        // Rails all round, with a way through at the top of the ladder.
        let lo = pz - 1.45, hi = pz + 1.45
        let posts: [(Float, Float)] = [(-1.45, lo), (1.45, lo), (-1.45, pz), (1.45, pz), (-1.45, hi), (1.45, hi), (gap - 0.4, hi), (gap + 0.4, hi)]
        for (x, z) in posts { n.add(MathShape.box(0.08, 0.7, 0.08, rail), x, top + 0.35, z) }
        let left = (gap - 0.4) + 1.45, right = 1.45 - (gap + 0.4)
        for y: Float in [top + 0.36, top + 0.7] {
            for x: Float in [-1.45, 1.45] { n.add(MathShape.box(0.07, 0.07, 2.9, rail), x, y, pz) }
            n.add(MathShape.box(2.9, 0.07, 0.07, rail), 0, y, lo)
            n.add(MathShape.box(left, 0.07, 0.07, rail), -1.45 + left / 2, y, hi)
            n.add(MathShape.box(right, 0.07, 0.07, rail), 1.45 - right / 2, y, hi)
        }
        ladder(n, V(gap, 0, 2.0), V(gap, top, hi + 0.04), width: 0.6, dark, wood, steps: 7, r: 0.045)

        // A branch out to the right, and from it a tyre on a long rope, swinging a little.
        bar(n, V(0.2, 4.95, tz), V(1.95, 5.35, -0.5), 0.12, bark, segments: 8)
        let swing = SCNNode()
        let drop: Float = 4.1
        swing.add(MathShape.cylinder(0.025, drop, c("d9c08a"), segments: 5), 0, -drop / 2, 0)
        let tyre = torus(0.27, 0.1, c("2a2d33"), segments: 16)
        tyre.eulerAngles.x = .pi / 2
        swing.add(tyre, 0, -drop - 0.33, 0)
        n.add(swing, 1.8, 5.3, -0.55)
        swing.eulerAngles.x = 0.06
        let to = SCNAction.rotateTo(x: -0.06, y: 0, z: 0, duration: 2.2), fro = SCNAction.rotateTo(x: 0.06, y: 0, z: 0, duration: 2.2)
        to.timingMode = .easeInEaseOut
        fro.timingMode = .easeInEaseOut
        swing.runAction(.repeatForever(.sequence([to, fro])))
        return top
    }

    /// The tree house: a wooden cabin with a pitched roof, a door, and a window with the light on.
    private static func treehouse() -> SCNNode {
        let n = SCNNode()
        let top = treehouseBase(n)
        let hut = SCNNode()
        let trim = c("f6f1e4"), inside = c("3a2a1f"), lit = c("ffe9a0", glow: 0.7)
        hut.add(MathShape.box(2, 1.5, 2, staves("c99a5f", "8a5a3a", 10)), 0, 0.75, 0)
        hut.add(prism(1.25, 0.9, 2.3, c("c0463a")), 0, 1.5, 0)
        // The way in, at the top of the ladder.
        hut.add(MathShape.box(0.72, 1.2, 0.03, trim), treeGap, 0.6, 1.0)
        hut.add(MathShape.box(0.6, 1.12, 0.04, inside), treeGap, 0.56, 1.02)
        // The window beside it, and one in the right-hand wall.
        hut.add(MathShape.box(0.64, 0.64, 0.03, trim), 0.5, 0.9, 1.0)
        hut.add(MathShape.box(0.5, 0.5, 0.04, lit), 0.5, 0.9, 1.02)
        hut.add(MathShape.box(0.04, 0.5, 0.05, trim), 0.5, 0.9, 1.035)
        hut.add(MathShape.box(0.5, 0.04, 0.05, trim), 0.5, 0.9, 1.035)
        hut.add(MathShape.box(0.03, 0.64, 0.64, trim), 1.0, 0.9, 0)
        hut.add(MathShape.box(0.04, 0.5, 0.5, lit), 1.02, 0.9, 0)
        // A round one up in the gable.
        let round = MathShape.cylinder(0.17, 0.06, lit, segments: 12)
        round.eulerAngles.x = .pi / 2
        hut.add(round, 0, 1.85, 1.13)
        n.add(hut, 0, top, 0.25)
        return n
    }

    /// The pirate lookout: a crow's nest up the trunk, a mast with a striped sail and the black flag,
    /// a ship's wheel on the front rail, a plank off the side, and the treasure.
    private static func treehousePirate() -> SCNNode {
        let n = SCNNode()
        let top = treehouseBase(n)
        let dark = c("6b4a2f"), wood = c("b98452"), iron = c("3a3d44"), gold = c("f5c542", glow: 0.3)

        // The crow's nest: a barrel round the trunk.
        n.add(MathShape.cone(0.6, 0.78, 0.7, staves("a8743f", "5a3a22", 16), segments: 14), 0, 4.4, -1.15)
        n.add(MathShape.cylinder(0.645, 0.06, iron, segments: 14), 0, 4.15, -1.15)
        n.add(MathShape.cylinder(0.775, 0.06, iron, segments: 14), 0, 4.66, -1.15)

        // The mast, its yard, and the sail hanging from it.
        let mz: Float = 0.35
        n.add(MathShape.cylinder(0.06, 2.7, dark, segments: 8), 0, top + 1.35, mz)
        n.add(MathShape.box(2.1, 0.08, 0.08, dark), 0, top + 2.05, mz + 0.07)
        n.add(MathShape.box(1.9, 1.4, 0.03, stripes("f6eeda", "d6263a", 5)), 0, top + 1.31, mz + 0.1)

        // The flag, in a little wind.
        let jolly = MathMat.drawn("yard-jolly", 128, 80) { g, size in
            g.fill("17181c", CGRect(origin: .zero, size: size))
            g.setStrokeColor(UIColor.white.cgColor)
            g.setLineWidth(7)
            g.setLineCap(.round)
            g.move(to: CGPoint(x: 34, y: 18)); g.addLine(to: CGPoint(x: 94, y: 66))
            g.move(to: CGPoint(x: 94, y: 18)); g.addLine(to: CGPoint(x: 34, y: 66))
            g.strokePath()
            g.setFillColor(UIColor.white.cgColor)
            g.fillEllipse(in: CGRect(x: 44, y: 12, width: 40, height: 36))
            g.fill(CGRect(x: 54, y: 40, width: 20, height: 14))
            g.fill("17181c", CGRect(x: 52, y: 24, width: 9, height: 10))
            g.fill("17181c", CGRect(x: 67, y: 24, width: 9, height: 10))
        }
        let cloth = SCNNode()
        cloth.add(MathShape.box(0.8, 0.5, 0.02, jolly), 0.42, 0, 0)
        n.add(cloth, 0, top + 2.42, mz)
        cloth.eulerAngles.y = 0.25
        let wave = SCNAction.sequence([.rotateTo(x: 0, y: 0.45, z: 0, duration: 1.4), .rotateTo(x: 0, y: 0.1, z: 0, duration: 1.7)])
        wave.timingMode = .easeInEaseOut
        cloth.runAction(.repeatForever(wave))

        // The wheel, on the front rail, turning a little one way and the other.
        let wheel = SCNNode()
        let rim = torus(0.26, 0.035, c("a8743f"), segments: 16)
        rim.eulerAngles.x = .pi / 2
        wheel.addChildNode(rim)
        for i in 0..<4 {
            let t = Float(i) * .pi / 4
            bar(wheel, V(-cos(t) * 0.38, -sin(t) * 0.38, 0), V(cos(t) * 0.38, sin(t) * 0.38, 0), 0.022, c("a8743f"))
        }
        let hub = MathShape.cylinder(0.07, 0.08, gold, segments: 10)
        hub.eulerAngles.x = .pi / 2
        wheel.addChildNode(hub)
        n.add(wheel, 0.8, top + 0.78, 1.75)
        wheel.runAction(.repeatForever(.sequence([.rotateBy(x: 0, y: 0, z: 0.9, duration: 2.6), .wait(duration: 0.8),
                                                  .rotateBy(x: 0, y: 0, z: -0.9, duration: 2.6), .wait(duration: 0.8)])))

        // The plank, out over the edge on the left.
        n.add(MathShape.box(1.0, 0.05, 0.45, wood), -1.65, top + 0.03, 0.7)

        // The treasure, with the lid up.
        n.add(MathShape.box(0.52, 0.3, 0.36, c("7a4a2a")), 0.9, top + 0.15, -0.45)
        n.add(MathShape.box(0.46, 0.05, 0.3, gold), 0.9, top + 0.31, -0.45)
        let lid = MathShape.box(0.52, 0.06, 0.36, c("5a3a22"))
        lid.eulerAngles.x = -1.1
        n.add(lid, 0.9, top + 0.44, -0.66)
        return n
    }

    /// The rocket: red and white, with fins and portholes, standing on the platform ready to go.
    private static func treehouseRocket() -> SCNNode {
        let n = SCNNode()
        let top = treehouseBase(n)
        let white = c("f6f1e4"), red = c("e0362f"), glass = c("9fe8ff", glow: 0.5), gold = c("f5c542", glow: 0.2)
        let r = SCNNode()
        r.add(MathShape.cylinder(0.8, 1.7, white, segments: 18), 0, 0.85, 0)
        r.add(MathShape.cylinder(0.815, 0.22, red, segments: 18), 0, 0.2, 0)
        r.add(MathShape.cylinder(0.815, 0.16, red, segments: 18), 0, 1.58, 0)
        r.add(MathShape.cone(0.8, 0.02, 1.1, red, segments: 18), 0, 2.25, 0)
        r.add(MathShape.sphere(0.07, gold, segments: 8), 0, 2.84, 0)
        for i in 0..<4 {
            let t = Float(i) * .pi / 2 + .pi / 4
            r.add(fin(0.55, 0.95, red), cos(t) * 0.76, 0, -sin(t) * 0.76, ry: t)
        }
        // A porthole at the front, and one to the right.
        for (i, turn) in [Float(0), .pi / 2].enumerated() {
            let port = SCNNode()
            let ring = MathShape.cylinder(0.36, 0.08, gold, segments: 16)
            ring.eulerAngles.x = .pi / 2
            port.add(ring, 0, 0, 0.78)
            let pane = MathShape.cylinder(0.28, 0.1, glass, segments: 16)
            pane.eulerAngles.x = .pi / 2
            port.add(pane, 0, 0, 0.79)
            r.add(port, 0, i == 0 ? 1.05 : 0.95, 0, ry: turn)
        }
        // The hatch, round toward the ladder.
        r.add(MathShape.box(0.5, 0.85, 0.1, red, round: 0.04), sin(-0.75) * 0.77, 0.47, cos(-0.75) * 0.77, ry: -0.75)
        n.add(r, 0, top, 0.35)
        return n
    }

    // MARK: The trampoline

    /// The trampoline, 3 by 3: a round frame on legs, a dark mat, a blue pad round it. With a net, eight posts and the net between them.
    private static func trampoline(net: Bool) -> SCNNode {
        let n = SCNNode()
        let steel = c("8d949b"), blue = c("2f7fe0")
        let R: Float = 1.36
        n.add(torus(R, 0.045, steel, segments: 28), 0, 0.68, 0)
        n.add(MathShape.cylinder(1.38, 0.05, blue, segments: 28), 0, 0.705, 0)
        n.add(MathShape.cylinder(1.08, 0.03, c("23262c"), segments: 28), 0, 0.735, 0)
        n.add(MathShape.cylinder(0.14, 0.02, c("ffd23a"), segments: 12), 0, 0.76, 0)
        for i in 0..<6 {
            let t = Float(i) * .pi / 3 + .pi / 6
            let a = V(sin(t - 0.22) * R, 0, cos(t - 0.22) * R), b = V(sin(t + 0.22) * R, 0, cos(t + 0.22) * R)
            let up = V(0, 0.68, 0), foot = V(0, 0.035, 0)
            bar(n, a + up, a + foot, 0.035, steel)
            bar(n, b + up, b + foot, 0.035, steel)
            bar(n, a + foot, b + foot, 0.035, steel)
        }
        guard net else { return n }
        let P: Float = 1.38
        let panelWide: Float = 2 * P * sin(.pi / 8), panelOut: Float = P * cos(.pi / 8)
        let netting = mesh("ffffff", u: 5, v: 8)
        for i in 0..<8 {
            let t = Float(i) * .pi / 4
            bar(n, V(sin(t) * P, 0.3, cos(t) * P), V(sin(t) * P, 2.4, cos(t) * P), 0.04, c("58c46a"))
            let m = t + .pi / 8
            let panel = MathShape.card(panelWide, 1.66, netting)
            panel.castsShadow = false
            n.add(panel, sin(m) * panelOut, 0.75 + 0.83, cos(m) * panelOut, ry: m)
        }
        n.add(torus(P, 0.03, c("58c46a"), segments: 28), 0, 2.4, 0)
        return n
    }

    // MARK: The playground

    /// A swing set: an A-frame with two seats on chains, both going.
    private static func swings() -> SCNNode {
        let n = SCNNode()
        let frame = c("e0483a"), chain = c("8d949b"), seats = [c("2f7fe0"), c("ffc93a")]
        let top: Float = 2.25
        bar(n, V(-1.45, top, 0), V(1.45, top, 0), 0.06, frame, segments: 8)
        for x: Float in [-1.45, 1.45] {
            for z: Float in [-0.8, 0.8] { bar(n, V(x, top, 0), V(x, 0, z), 0.055, frame, segments: 8) }
            bar(n, V(x, 0.9, -0.48), V(x, 0.9, 0.48), 0.04, frame)
        }
        for (i, x) in [Float(-0.6), 0.6].enumerated() {
            let swing = SCNNode()
            for dx: Float in [-0.22, 0.22] { swing.add(MathShape.cylinder(0.02, 1.65, chain, segments: 5), dx, -0.825, 0) }
            swing.add(MathShape.box(0.52, 0.05, 0.22, seats[i], round: 0.02), 0, -1.67, 0)
            n.add(swing, x, top - 0.05, 0)
            let far: CGFloat = i == 0 ? 0.3 : -0.22
            swing.eulerAngles.x = Float(far)
            let time = 1.5 + Double(i) * 0.2
            let to = SCNAction.rotateTo(x: -far, y: 0, z: 0, duration: time), fro = SCNAction.rotateTo(x: far, y: 0, z: 0, duration: time)
            to.timingMode = .easeInEaseOut
            fro.timingMode = .easeInEaseOut
            swing.runAction(.repeatForever(.sequence([to, fro])))
        }
        return n
    }

    /// A playground slide: a ladder at the back, a platform with hoops to hold, and the chute down toward +z.
    private static func slide() -> SCNNode {
        let n = SCNNode()
        let blue = c("2f7fe0"), yellow = c("ffc93a"), red = c("e0483a")
        let top: Float = 1.3
        n.add(MathShape.box(0.7, 0.06, 0.5, red), 0, top - 0.03, -0.85)
        ladder(n, V(0, 0, -1.5), V(0, top, -1.1), width: 0.56, blue, blue, steps: 4, r: 0.04)
        for x: Float in [-0.32, 0.32] {
            bar(n, V(x, 0, -0.62), V(x, top - 0.06, -0.62), 0.04, blue)
            pipe(n, [V(x, top, -1.1), V(x, 1.72, -1.05), V(x, 1.8, -0.85), V(x, 1.72, -0.65), V(x, top + 0.18, -0.55)], 0.03, blue)
        }
        trough(n, V(0, top, -0.6), V(0, 0.3, 1.2), width: 0.5, bed: yellow, wall: red)
        trough(n, V(0, 0.3, 1.2), V(0, 0.24, 1.48), width: 0.5, bed: yellow, wall: red)
        bar(n, V(0, 0, 0.3), V(0, 0.77, 0.3), 0.04, blue)
        for x: Float in [-0.2, 0.2] { bar(n, V(x, 0, 1.3), V(x, 0.26, 1.3), 0.035, blue) }
        return n
    }

    /// A sandbox: a wooden frame full of sand, with a castle, a red bucket and a spade.
    private static func sandbox() -> SCNNode {
        let n = SCNNode()
        let wood = c("c08a56"), sand = c("f1d9a0"), damp = c("e3c888")
        for side: Float in [-1, 1] {
            n.add(MathShape.box(2, 0.26, 0.14, wood, round: 0.02), 0, 0.13, side * 0.93)
            n.add(MathShape.box(0.14, 0.26, 1.72, wood, round: 0.02), side * 0.93, 0.13, 0)
            for z: Float in [-1, 1] { n.add(MathShape.box(0.32, 0.04, 0.32, c("e9b06b")), side * 0.84, 0.28, z * 0.84) }
        }
        n.add(MathShape.box(1.74, 0.16, 1.74, sand), 0, 0.08, 0)
        n.add(MathShape.sphere(0.36, sand, segments: 10), -0.35, 0.15, -0.3).scale = SCNVector3(1, 0.4, 1)
        // The castle.
        n.add(MathShape.cylinder(0.15, 0.2, damp, segments: 10), -0.35, 0.36, -0.3)
        n.add(MathShape.cone(0.12, 0.02, 0.16, damp, segments: 10), -0.35, 0.54, -0.3)
        n.add(MathShape.cylinder(0.008, 0.2, c("f6f1e4"), segments: 5), -0.35, 0.7, -0.3)
        n.add(MathShape.box(0.12, 0.08, 0.01, c("e0362f")), -0.29, 0.76, -0.3)
        // The bucket, and its handle.
        n.add(MathShape.cone(0.1, 0.14, 0.24, c("e0362f"), segments: 12), 0.4, 0.28, 0.3)
        let handle = torus(0.13, 0.012, c("f6f1e4"), segments: 14)
        handle.eulerAngles.x = 1.1
        n.add(handle, 0.4, 0.4, 0.3)
        // The spade, stuck in.
        bar(n, V(-0.1, 0.18, 0.45), V(0.02, 0.62, 0.55), 0.02, c("ffc93a"))
        bar(n, V(-0.05, 0.62, 0.55), V(0.09, 0.62, 0.55), 0.02, c("ffc93a"))
        slab(n, V(-0.14, 0.04, 0.42), V(-0.09, 0.22, 0.46), 0.14, 0.02, c("2f7fe0"))
        return n
    }

    /// A seesaw, 2.8 long across x, rocking.
    private static func seesaw() -> SCNNode {
        let n = SCNNode()
        let steel = c("8d949b")
        for z: Float in [-0.2, 0.2] {
            bar(n, V(-0.3, 0, z), V(0, 0.5, z), 0.045, steel)
            bar(n, V(0.3, 0, z), V(0, 0.5, z), 0.045, steel)
        }
        bar(n, V(0, 0.5, -0.26), V(0, 0.5, 0.26), 0.05, steel, segments: 8)
        let beam = SCNNode()
        beam.add(MathShape.box(2.8, 0.07, 0.24, c("3fae6a"), round: 0.02), 0, 0.07, 0)
        for (i, side) in [Float(-1), 1].enumerated() {
            beam.add(MathShape.box(0.36, 0.05, 0.3, c(i == 0 ? "e0483a" : "2f7fe0"), round: 0.02), side * 1.18, 0.13, 0)
            bar(beam, V(side * 0.85, 0.1, 0), V(side * 0.85, 0.4, 0), 0.02, steel)
            bar(beam, V(side * 0.85, 0.4, -0.15), V(side * 0.85, 0.4, 0.15), 0.02, steel)
        }
        n.add(beam, 0, 0.5, 0)
        beam.eulerAngles.z = 0.2
        let down = SCNAction.rotateTo(x: 0, y: 0, z: -0.2, duration: 1.4), up = SCNAction.rotateTo(x: 0, y: 0, z: 0.2, duration: 1.4)
        down.timingMode = .easeInEaseOut
        up.timingMode = .easeInEaseOut
        beam.runAction(.repeatForever(.sequence([.wait(duration: 0.7), down, .wait(duration: 0.7), up])))
        return n
    }

    /// A climbing dome two metres across, made of bars in four colours.
    private static func climber() -> SCNNode {
        let n = SCNNode()
        let colors = [c("e0483a"), c("ffc93a"), c("2f7fe0"), c("3fae6a")], ring = c("f6f1e4")
        let R: Float = 1.0
        // A point on the dome: `i` eighths of the way round, `high` up it (in radians).
        func at(_ i: Int, _ high: Float) -> V {
            let t = Float(i) * .pi / 4
            return V(sin(t) * cos(high) * R, sin(high) * R, cos(t) * cos(high) * R)
        }
        let apex = V(0, R, 0)
        for i in 0..<8 {
            let m = colors[i % 4]
            bar(n, at(i, 0), at(i, 0.6), 0.04, m)
            bar(n, at(i, 0.6), at(i, 1.1), 0.04, m)
            bar(n, at(i, 1.1), apex, 0.04, m)
            bar(n, at(i, 0.6), at(i + 1, 0.6), 0.035, ring)
            bar(n, at(i, 1.1), at(i + 1, 1.1), 0.035, ring)
        }
        n.add(MathShape.sphere(0.09, c("ffc93a"), segments: 8), 0, R, 0)
        return n
    }

    /// A merry-go-round: a painted disc two metres across with bars to hold, going slowly round.
    private static func merryGoRound() -> SCNNode {
        let n = SCNNode()
        let steel = c("8d949b"), yellow = c("ffc93a")
        n.add(MathShape.cylinder(0.3, 0.22, c("4a4f57"), segments: 12), 0, 0.11, 0)
        let painted = MathMat.drawn("yard-roundabout", 256, 256) { g, size in
            let centre = CGPoint(x: size.width / 2, y: size.height / 2)
            let hexes = ["e0483a", "ffc93a", "2f7fe0", "3fae6a"]
            for i in 0..<8 {
                g.move(to: centre)
                g.addArc(center: centre, radius: size.width, startAngle: CGFloat(i) * .pi / 4, endAngle: CGFloat(i + 1) * .pi / 4, clockwise: false)
                g.closePath()
                g.setFillColor(ui(hexes[i % 4]).cgColor)
                g.fillPath()
            }
        }
        let spin = SCNNode()
        spin.add(MathShape.cylinder(1.0, 0.08, painted, segments: 24), 0, 0.26, 0)
        spin.add(MathShape.cylinder(1.01, 0.06, c("e0483a"), segments: 24), 0, 0.255, 0)
        spin.add(MathShape.cylinder(0.05, 0.75, steel, segments: 8), 0, 0.675, 0)
        for i in 0..<4 {
            let t = Float(i) * .pi / 2 + .pi / 4
            let x = sin(t) * 0.88, z = cos(t) * 0.88
            pipe(spin, [V(x, 0.3, z), V(x, 1.0, z), V(0, 1.0, 0)], 0.03, yellow)
        }
        n.addChildNode(spin)
        spin.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 14)))
        return n
    }

    // MARK: The ball field

    /// The diamond, 10 by 10, home plate at the front: dirt base paths round the game's own grass, three
    /// bases, the mound, chalk foul lines out through first and third, batter's boxes, and a backstop.
    private static func diamond() -> SCNNode {
        let n = SCNNode()
        let dirt = c("c98a55"), chalk = c("ffffff", glow: 0.2), white = c("f8f8f4")
        // Home to the middle, and the middle to each base: the bases are 5.8 apart.
        let h: Float = 4.1, mid: Float = 0.1
        let home = V(0, 0, mid + h), first = V(h, 0, mid), second = V(0, 0, mid - h), third = V(-h, 0, mid)
        let side = h * Float(2).squareRoot()

        // The base paths.
        for (a, b) in [(home, first), (first, second), (second, third), (third, home)] {
            let m = (a + b) / 2, d = b - a
            let strip = SCNNode()
            strip.addChildNode(MathShape.floor(1.1, side, dirt))
            n.add(strip, m.x, 0.012, m.z, ry: atan2(d.x, d.z))
        }
        // The dirt round home and round each base.
        let plateDirt = MathShape.cylinder(1.0, 0.01, dirt, segments: 20)
        plateDirt.scale = SCNVector3(1.15, 1, 0.78)
        n.add(plateDirt, 0, 0.016, home.z)
        for b in [first, second, third] {
            n.add(MathShape.cylinder(0.85, 0.01, dirt, segments: 16), b.x, 0.016, b.z)
            n.add(MathShape.box(0.42, 0.07, 0.42, white, round: 0.02), b.x, 0.05, b.z, ry: .pi / 4)
        }
        // The mound and its rubber.
        let mound = MathShape.sphere(0.95, dirt, segments: 14)
        mound.scale = SCNVector3(1, 0.13, 1)
        n.add(mound, 0, 0, mid + 0.3)
        n.add(MathShape.box(0.55, 0.04, 0.14, white), 0, 0.125, mid + 0.3)

        // The foul lines, from home out through first and third to the edge of the field.
        for across: Float in [-1, 1] {
            let end = V(across * 5, 0, home.z - 5)
            let start = home + simd_normalize(end - home) * 1.0
            let m = (start + end) / 2, d = end - start
            let line = SCNNode()
            line.addChildNode(MathShape.floor(0.09, simd_length(d), chalk))
            n.add(line, m.x, 0.04, m.z, ry: atan2(d.x, d.z))
        }
        // Home plate, pointing at the catcher, with a batter's box each side.
        let boxes = MathMat.drawn("yard-diamond-home", 256, 128, glow: 0.2, clear: true) { g, size in
            g.clear(CGRect(origin: .zero, size: size))
            g.setStrokeColor(UIColor.white.cgColor)
            g.setLineWidth(6)
            g.stroke(CGRect(x: 22, y: 14, width: 62, height: 100))
            g.stroke(CGRect(x: 172, y: 14, width: 62, height: 100))
            g.move(to: CGPoint(x: 108, y: 44))
            g.addLine(to: CGPoint(x: 148, y: 44))
            g.addLine(to: CGPoint(x: 148, y: 64))
            g.addLine(to: CGPoint(x: 128, y: 84))
            g.addLine(to: CGPoint(x: 108, y: 64))
            g.closePath()
            g.setFillColor(UIColor.white.cgColor)
            g.fillPath()
        }
        n.add(MathShape.floor(2.0, 1.0, boxes), 0, 0.045, home.z)

        // The backstop: chain-link on posts behind home, with a wing each side.
        let post = c("2f6b4a")
        let bz: Float = 4.82
        for x: Float in [-1.5, 0, 1.5] { n.add(MathShape.cylinder(0.05, 2.6, post, segments: 8), x, 1.3, bz) }
        bar(n, V(-1.5, 2.6, bz), V(1.5, 2.6, bz), 0.045, post)
        let back = MathShape.card(3, 2.6, mesh("dfe7ee", u: 10, v: 9))
        back.castsShadow = false
        n.add(back, 0, 1.3, bz)
        for across: Float in [-1, 1] {
            let a = V(across * 1.5, 0, bz), b = V(across * 2.2, 0, bz - 0.8)
            let up = V(0, 2.6, 0)
            bar(n, b, b + up, 0.05, post, segments: 8)
            bar(n, a + up, b + up, 0.045, post)
            let d = b - a, m = (a + b) / 2
            let wing = MathShape.card(simd_length(d), 2.6, mesh("dfe7ee", u: 3.5, v: 9))
            wing.castsShadow = false
            n.add(wing, m.x, 1.3, m.z, ry: atan2(-d.z, d.x))
        }
        return n
    }

    /// Bleachers: three rows of benches, each higher than the one in front.
    private static func bleachers() -> SCNNode {
        let n = SCNNode()
        let frame = c("2f6b4a"), seat = c("f6f1e4"), foot = c("d9cfb8")
        let rows: [(y: Float, z: Float)] = [(0.45, 0.55), (0.85, 0), (1.25, -0.55)]
        for (i, row) in rows.enumerated() {
            n.add(MathShape.box(3, 0.06, 0.32, seat, round: 0.02), 0, row.y, row.z)
            if i > 0 { n.add(MathShape.box(3, 0.04, 0.24, foot), 0, row.y - 0.42, row.z + 0.3) }
        }
        for x: Float in [-1.4, 0, 1.4] {
            bar(n, V(x, 0, 0.75), V(x, 1.22, -0.7), 0.035, frame)
            bar(n, V(x, 0, -0.7), V(x, 1.22, -0.7), 0.035, frame)
            bar(n, V(x, 0.035, 0.75), V(x, 0.035, -0.7), 0.035, frame)
            for row in rows { bar(n, V(x, 0, row.z), V(x, row.y - 0.03, row.z), 0.03, frame) }
        }
        return n
    }

    /// The scoreboard, on two posts: HOME 7, GUEST 3, lit.
    private static func scoreboard() -> SCNNode {
        let n = SCNNode()
        let post = c("3a4a5a")
        for x: Float in [-0.9, 0.9] { n.add(MathShape.box(0.14, 2.8, 0.14, post), x, 1.4, -0.03) }
        n.add(MathShape.box(2.4, 1.2, 0.16, c("1f5a3a"), round: 0.03), 0, 2.2, 0.06)
        let face = MathMat.drawn("yard-scoreboard", 512, 256, glow: 0.7) { g, size in
            g.fill("17472e", CGRect(origin: .zero, size: size))
            g.setStrokeColor(ui("f6f1e4").cgColor)
            g.setLineWidth(6)
            g.stroke(CGRect(origin: .zero, size: size).insetBy(dx: 8, dy: 8))
            write("HOME", "f6f1e4", 46, in: CGRect(x: 20, y: 22, width: 236, height: 60))
            write("GUEST", "f6f1e4", 46, in: CGRect(x: 256, y: 22, width: 236, height: 60))
            for (i, digit) in ["7", "3"].enumerated() {
                let window = CGRect(x: 78 + CGFloat(i) * 236, y: 92, width: 120, height: 136)
                g.fill("0d1f16", window)
                write(digit, "ffd23a", 116, in: window)
            }
        }
        n.add(MathShape.card(2.3, 1.1, face), 0, 2.2, 0.16)
        // A lamp on each top corner.
        for x: Float in [-1.05, 1.05] { n.add(MathShape.sphere(0.08, c("ffe9a0", glow: 1), segments: 8), x, 2.86, 0.06) }
        return n
    }

    /// The dugout: a bench under a sloping roof, open at the front, with helmets and a bat left on it.
    private static func dugout() -> SCNNode {
        let n = SCNNode()
        let wall = staves("3f8f66", "2a6b4a", 14), green = c("3f8f66"), wood = c("c08a56"), post = c("f6f1e4")
        n.add(MathShape.box(3.3, 1.8, 0.1, wall), 0, 0.9, -0.65)
        for x: Float in [-1.6, 1.6] {
            n.add(MathShape.box(0.1, 1.8, 1.2, green), x, 0.9, -0.1)
            n.add(MathShape.box(0.1, 2.05, 0.1, post), x, 1.025, 0.55)
        }
        let roof = MathShape.box(3.6, 0.08, 1.7, c("c0463a"))
        roof.eulerAngles.x = -0.14
        n.add(roof, 0, 1.98, -0.05)
        n.add(MathShape.box(3, 0.06, 0.38, wood, round: 0.02), 0, 0.45, -0.3)
        n.add(MathShape.box(3, 0.28, 0.05, wood), 0, 0.85, -0.57)
        for x: Float in [-1.3, 0, 1.3] { n.add(MathShape.box(0.08, 0.42, 0.3, c("8a5a3a")), x, 0.21, -0.3) }
        n.add(MathShape.sphere(0.13, c("2f5fc0"), segments: 10), -0.85, 0.6, -0.3)
        n.add(MathShape.sphere(0.13, c("e0362f"), segments: 10), -0.5, 0.6, -0.3)
        bar(n, V(0.9, 0, 0.05), V(1.0, 0.85, -0.5), 0.035, c("e0b070"))
        return n
    }

    /// A pitching machine: a spinning wheel on a tripod, and a bucket of balls beside it.
    private static func pitchingMachine() -> SCNNode {
        let n = SCNNode()
        let dark = c("2a2d33"), blue = c("2f5fc0"), yellow = c("ffd23a")
        for i in 0..<3 {
            let t = Float(i) * .pi * 2 / 3 + .pi
            bar(n, V(sin(t) * 0.45, 0, cos(t) * 0.45), V(sin(t) * 0.06, 0.82, cos(t) * 0.06), 0.03, dark)
        }
        n.add(MathShape.cylinder(0.08, 0.12, dark, segments: 8), 0, 0.84, 0)
        let head = SCNNode()
        head.add(MathShape.box(0.26, 0.32, 0.4, blue, round: 0.04), 0, 0, 0)
        // The wheel, on the side of it, going round.
        let spin = SCNNode()
        let tyre = MathShape.cylinder(0.26, 0.1, dark, segments: 16)
        tyre.eulerAngles.z = .pi / 2
        spin.addChildNode(tyre)
        let cap = MathShape.cylinder(0.1, 0.12, yellow, segments: 10)
        cap.eulerAngles.z = .pi / 2
        spin.addChildNode(cap)
        spin.add(MathShape.box(0.11, 0.06, 0.08, yellow), 0, 0.2, 0)
        head.add(spin, 0.19, 0.1, 0.03)
        spin.runAction(.repeatForever(.rotateBy(x: .pi * 2, y: 0, z: 0, duration: 1.2)))
        // Where the ball comes out, and where it goes in.
        let mouth = MathShape.cylinder(0.065, 0.3, dark, segments: 10)
        mouth.eulerAngles.x = .pi / 2
        head.add(mouth, -0.02, 0.02, 0.3)
        bar(head, V(-0.02, 0.1, -0.15), V(-0.02, 0.42, -0.32), 0.05, yellow, segments: 8)
        head.eulerAngles.x = -0.12
        n.add(head, 0, 1.02, 0)
        // The bucket.
        n.add(MathShape.cone(0.15, 0.2, 0.32, c("f08a3c"), segments: 12), 0.62, 0.16, 0.1)
        let ball = c("f8f8f0", glow: 0.15)
        for (i, p) in [(Float(0), Float(0)), (0.1, 0.03), (-0.09, 0.05), (0.02, -0.1), (-0.03, 0.11)].enumerated() {
            n.add(MathShape.sphere(0.065, ball, segments: 8), 0.62 + p.0, i == 0 ? 0.38 : 0.33, 0.1 + p.1)
        }
        return n
    }

    // MARK: Basketball

    /// The half court, 5 by 6: painted lines on a blue court with an orange key, and the hoop at the back.
    private static func court() -> SCNNode {
        let n = SCNNode()
        // A hundred dots to the metre. The top of the picture is the back of the court, under the hoop.
        let paint = MathMat.drawn("yard-court", 500, 600) { g, size in
            let W = size.width, H = size.height
            g.fill("2c5fa8", CGRect(origin: .zero, size: size))
            let inner = CGRect(x: 15, y: 15, width: W - 30, height: H - 30)
            g.fill("3d7fd0", inner)
            let hoop = CGPoint(x: W / 2, y: 75)
            let key = CGRect(x: W / 2 - 70, y: 15, width: 140, height: 175)
            g.fill("f08a3c", key)
            g.setStrokeColor(UIColor.white.cgColor)
            g.setLineWidth(7)
            g.stroke(inner)
            g.stroke(key)
            // The circle at the free-throw line.
            g.strokeEllipse(in: CGRect(x: W / 2 - 70, y: key.maxY - 70, width: 140, height: 140))
            // The three-point line: straight in from the back, then round.
            g.move(to: CGPoint(x: hoop.x + 220, y: 15))
            g.addLine(to: CGPoint(x: hoop.x + 220, y: hoop.y))
            g.addArc(center: hoop, radius: 220, startAngle: 0, endAngle: .pi, clockwise: false)
            g.addLine(to: CGPoint(x: hoop.x - 220, y: 15))
            g.strokePath()
            // Half of the centre circle, at the front edge.
            g.addArc(center: CGPoint(x: W / 2, y: H - 15), radius: 60, startAngle: .pi, endAngle: .pi * 2, clockwise: false)
            g.strokePath()
        }
        n.add(MathShape.floor(5, 6, paint), 0, 0.02, 0)

        // The hoop: a padded post, an arm, the backboard, the rim at 2.6 m and the net.
        let steel = c("3a4a5a"), orange = c("ff7a1f", glow: 0.2)
        n.add(MathShape.cylinder(0.07, 2.9, steel, segments: 10), 0, 1.45, -2.88)
        n.add(MathShape.box(0.26, 1.0, 0.22, c("2f5fc0"), round: 0.05), 0, 0.5, -2.88)
        bar(n, V(0, 2.85, -2.88), V(0, 2.95, -2.56), 0.05, steel)
        n.add(MathShape.box(1.2, 0.8, 0.05, c("f8f8f4")), 0, 2.95, -2.53)
        let target = MathMat.drawn("yard-backboard", 192, 128) { g, size in
            g.fill("f8f8f4", CGRect(origin: .zero, size: size))
            g.setStrokeColor(ui("e0483a").cgColor)
            g.setLineWidth(8)
            g.stroke(CGRect(origin: .zero, size: size).insetBy(dx: 6, dy: 6))
            g.stroke(CGRect(x: 66, y: 68, width: 60, height: 46))
        }
        n.add(MathShape.card(1.2, 0.8, target), 0, 2.95, -2.485)
        n.add(MathShape.box(0.12, 0.03, 0.08, orange), 0, 2.6, -2.47)
        n.add(torus(0.23, 0.022, orange, segments: 20), 0, 2.6, -2.25)
        let net = MathShape.cone(0.13, 0.225, 0.36, mesh("ffffff", u: 8, v: 2, haze: 0.45), segments: 12)
        net.castsShadow = false
        n.add(net, 0, 2.42, -2.25)
        return n
    }

    /// A small rack with three basketballs on it.
    private static func ballRack() -> SCNNode {
        let n = SCNNode()
        let steel = c("3a4a5a")
        let ball = MathMat.drawn("yard-basketball", 128, 64) { g, size in
            g.fill("f08a3c", CGRect(origin: .zero, size: size))
            g.setStrokeColor(ui("3a2a1f").cgColor)
            g.setLineWidth(3)
            g.move(to: CGPoint(x: 0, y: size.height / 2))
            g.addLine(to: CGPoint(x: size.width, y: size.height / 2))
            for i in 0...4 {
                let x = CGFloat(i) * size.width / 4
                g.move(to: CGPoint(x: x, y: 0))
                g.addLine(to: CGPoint(x: x, y: size.height))
            }
            g.strokePath()
        }
        for x: Float in [-0.5, 0.5] {
            for z: Float in [-0.15, 0.15] { bar(n, V(x, 0, z), V(x, 0.52, z), 0.022, steel) }
            bar(n, V(x, 0.022, -0.15), V(x, 0.022, 0.15), 0.022, steel)
            bar(n, V(x, 0.52, -0.15), V(x, 0.52, 0.15), 0.022, steel)
        }
        for z: Float in [-0.11, 0.11] { bar(n, V(-0.5, 0.32, z), V(0.5, 0.32, z), 0.022, steel) }
        for i in 0..<3 { n.add(MathShape.sphere(0.15, ball, segments: 14), -0.31 + Float(i) * 0.31, 0.445, 0, ry: Float(i) * 1.3) }
        return n
    }

    // MARK: The vegetable patch

    /// How high the soil in a raised bed is.
    private static let soilTop: Float = 0.33
    /// Where the middle of each raised bed is, across x.
    private static let bedAt: Float = 0.85

    /// Two raised beds side by side on a footprint 3 by 3, each 1.2 across and 2.7 front to back, with a path between.
    private static func beds(_ n: SCNNode) {
        let wood = c("b98452"), soil = c("5a3d28"), cap = c("d9a56b")
        for side: Float in [-1, 1] {
            let x = side * bedAt
            n.add(MathShape.box(1.2, 0.3, 2.7, wood, round: 0.02), x, 0.15, 0)
            n.add(MathShape.box(1.04, 0.06, 2.54, soil), x, 0.3, 0)
            for z: Float in [-1.33, 1.33] { n.add(MathShape.box(1.24, 0.05, 0.1, cap), x, 0.31, z) }
        }
    }

    /// A watering can, its spout along +x.
    private static func wateringCan() -> SCNNode {
        let can = SCNNode(), teal = c("2fb0a0")
        can.add(MathShape.cylinder(0.13, 0.26, teal, segments: 12), 0, 0.13, 0)
        bar(can, V(0.1, 0.1, 0), V(0.36, 0.3, 0), 0.025, teal)
        can.add(MathShape.sphere(0.05, c("ffd23a"), segments: 8), 0.37, 0.31, 0)
        let handle = torus(0.09, 0.016, teal, segments: 12)
        handle.eulerAngles.x = .pi / 2
        can.add(handle, -0.14, 0.17, 0)
        return can
    }

    /// Carrots in one bed, lettuces in the other, and the watering can on the path.
    private static func vegpatch() -> SCNNode {
        let n = SCNNode()
        beds(n)
        let top = c("4fae4a"), orange = c("f08a3c"), lettuce = c("8fd45a"), heart = c("c4ec7a")
        for row: Float in [-0.28, 0.28] {
            for i in 0..<5 {
                let z: Float = -1.0 + Float(i) * 0.5
                n.add(MathShape.cylinder(0.05, 0.06, orange, segments: 8), -bedAt + row, soilTop + 0.02, z)
                n.add(MathShape.cone(0.03, 0.12, 0.26, top, segments: 6), -bedAt + row, soilTop + 0.17, z)
            }
            for i in 0..<4 {
                let z: Float = -0.95 + Float(i) * 0.63
                n.add(MathShape.sphere(0.17, lettuce, segments: 8), bedAt + row, soilTop + 0.07, z).scale = SCNVector3(1, 0.7, 1)
                n.add(MathShape.sphere(0.09, heart, segments: 8), bedAt + row, soilTop + 0.15, z)
            }
        }
        n.add(wateringCan().scaled(1.4), 0, 0, 0.95, ry: -0.5)
        return n
    }

    /// Pumpkins of all sizes in both beds, with their vines and leaves.
    private static func vegpatchPumpkins() -> SCNNode {
        let n = SCNNode()
        beds(n)
        let skin = stripes("f08a2c", "d96a1c", 8, thin: 0.25), stem = c("5f7a2f"), vine = c("3f8f4a"), leaf = c("4fae4a")
        let spots: [(Float, Float, Float)] = [(-1.0, -0.95, 0.22), (-0.75, -0.05, 0.34), (-0.95, 0.85, 0.2),
                                              (0.75, -0.75, 0.28), (1.0, 0.2, 0.2), (0.75, 0.9, 0.25)]
        for (x, z, r) in spots {
            n.add(MathShape.sphere(r, skin, segments: 12), x, soilTop + r * 0.72, z).scale = SCNVector3(1, 0.78, 1)
            n.add(MathShape.cylinder(r * 0.12, r * 0.4, stem, segments: 6), x, soilTop + r * 1.6, z)
        }
        let y = soilTop + 0.03
        for side: Float in [-1, 1] {
            let x = side * bedAt
            let run: [V] = [V(x + 0.3, y, -1.15), V(x - 0.25, y, -0.5), V(x + 0.3, y, 0.35), V(x - 0.2, y, 1.15)]
            pipe(n, run, 0.025, vine)
            for (i, p) in run.enumerated() {
                let a = MathShape.cylinder(0.14, 0.015, leaf, segments: 7)
                a.eulerAngles = SCNVector3(0.3, Float(i), 0.2)
                n.add(a, p.x + 0.08, y + 0.07, p.z + 0.1)
                if i < run.count - 1 {
                    let q = (p + run[i + 1]) / 2
                    let b = MathShape.cylinder(0.11, 0.015, leaf, segments: 7)
                    b.eulerAngles = SCNVector3(-0.25, Float(i) * 2, 0.3)
                    n.add(b, q.x - 0.06, y + 0.06, q.z)
                }
            }
        }
        return n
    }

    /// Sunflowers down the outside of each bed and tulips in rows inside them.
    private static func vegpatchFlowers() -> SCNNode {
        let n = SCNNode()
        beds(n)
        let stem = c("3f8f4a"), petal = c("ffd21f"), seed = c("6b4a2a"), leaf = c("4fae4a")
        let tulips = [c("e0362f"), c("ff7fb0"), c("b05fd0"), c("ffffff"), c("ff9a2f")]
        for (b, side) in [Float(-1), 1].enumerated() {
            for i in 0..<3 {
                let x = side * (bedAt + 0.32), z: Float = -0.9 + Float(i) * 0.9
                let tall: Float = 1.15 + Float((i + b) % 2) * 0.25
                n.add(MathShape.cylinder(0.025, tall, stem, segments: 6), x, soilTop + tall / 2, z)
                n.add(MathShape.sphere(0.11, leaf, segments: 6), x - side * 0.1, soilTop + tall * 0.45, z).scale = SCNVector3(1.4, 0.2, 0.7)
                // The head, tipped up to the sun.
                let head = SCNNode()
                let petals = MathShape.cylinder(0.2, 0.03, petal, segments: 10)
                petals.eulerAngles.x = .pi / 2
                head.addChildNode(petals)
                let face = MathShape.cylinder(0.1, 0.05, seed, segments: 10)
                face.eulerAngles.x = .pi / 2
                head.add(face, 0, 0, 0.01)
                head.eulerAngles.x = -0.25
                n.add(head, x, soilTop + tall, z + 0.03)
            }
            for (r, row) in [Float(-0.1), 0.22].enumerated() {
                for i in 0..<4 {
                    let x = side * (bedAt - row), z: Float = -1.0 + Float(i) * 0.62 + Float(r) * 0.2
                    n.add(MathShape.cylinder(0.018, 0.4, stem, segments: 5), x, soilTop + 0.2, z)
                    n.add(MathShape.sphere(0.08, tulips[(i + r * 2 + b) % tulips.count], segments: 8), x, soilTop + 0.45, z).scale = SCNVector3(1, 1.35, 1)
                }
            }
        }
        return n
    }
}
