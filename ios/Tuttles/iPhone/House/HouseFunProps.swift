import SceneKit
import UIKit

// The fun things of a dream home, for indoors: what goes in a game room, a
// home cinema, a music room, a library, a workshop and a secret room. No kit
// has these, so every one is built here in code from boxes, cylinders and
// balls, the way HouseProps builds its arcade cabinet and its telescope, and
// anything flat (a screen, a poster, a map) is drawn.
//
// Sizes are metres. A thing for the floor stands on y = 0 around the origin
// and is used from +z. A thing for a wall is flat against z = 0, sticking out
// toward +z, its middle at the origin. A thing for the ceiling hangs down
// from y = 0. Nothing here is a light: what's lit glows.

enum HouseFunProps {
    /// Every key `made` knows, for a gallery to show them all.
    static let keys: [String] = [
        // Game room
        "pool-table", "foosball", "ping-pong", "bean-bag", "bean-bag-giant", "racing-rig", "jukebox",
        "neon-game", "neon-star", "dartboard", "disco-ball", "skeeball", "vr-pod",
        // Home cinema
        "big-screen", "projector", "popcorn", "cinema-seats", "cinema-seats-gold", "movie-poster", "movie-poster-space", "candy-stand",
        // Music room
        "piano", "grand-piano", "drums", "guitar", "electric-guitar", "keyboard", "amp-stack", "mic", "record-player", "gold-record",
        // Library
        "ladder-shelves", "book-stack", "grandfather-clock", "reading-nook",
        // Workshop
        "pegboard", "robot", "printer3d", "rocket-model", "tool-chest", "go-kart-frame",
        // Secret room
        "crystal-ball", "treasure", "map-table", "armor", "portal", "secret-bookcase",
    ]

    /// Something for indoors, built in code, by its key. Nil for a key it doesn't know.
    static func made(_ key: String) -> SCNNode? {
        switch key {
        case "pool-table": return poolTable()
        case "foosball": return foosball()
        case "ping-pong": return pingPong()
        case "bean-bag": return beanBag(giant: false)
        case "bean-bag-giant": return beanBag(giant: true)
        case "racing-rig": return racingRig()
        case "jukebox": return jukebox()
        case "neon-game": return neonGame()
        case "neon-star": return neonStar()
        case "dartboard": return dartboard()
        case "disco-ball": return discoBall()
        case "skeeball": return skeeball()
        case "vr-pod": return vrPod()
        case "big-screen": return bigScreen()
        case "projector": return projector()
        case "popcorn": return popcorn()
        case "cinema-seats": return cinemaSeats(gold: false)
        case "cinema-seats-gold": return cinemaSeats(gold: true)
        case "movie-poster": return moviePoster(space: false)
        case "movie-poster-space": return moviePoster(space: true)
        case "candy-stand": return candyStand()
        case "piano": return piano()
        case "grand-piano": return grandPiano()
        case "drums": return drums()
        case "guitar": return guitarOnStand()
        case "electric-guitar": return electricGuitar()
        case "keyboard": return keyboard()
        case "amp-stack": return ampStack()
        case "mic": return mic()
        case "record-player": return recordPlayer()
        case "gold-record": return goldRecord()
        case "ladder-shelves": return ladderShelves()
        case "book-stack": return bookStack()
        case "grandfather-clock": return grandfatherClock()
        case "reading-nook": return readingNook()
        case "pegboard": return pegboard()
        case "robot": return robot()
        case "printer3d": return printer3d()
        case "rocket-model": return rocketModel()
        case "tool-chest": return toolChest()
        case "go-kart-frame": return goKartFrame()
        case "crystal-ball": return crystalBall()
        case "treasure": return treasure()
        case "map-table": return mapTable()
        case "armor": return armor()
        case "portal": return portal()
        case "secret-bookcase": return secretBookcase()
        default: return nil
        }
    }

    // MARK: Short ways of saying things

    private typealias V = SIMD3<Float>

    private static func ui(_ hex: String) -> UIColor { MathLookKit.color(hex) }

    private static func m(_ hex: String, glow: CGFloat = 0, alpha: CGFloat = 1) -> SCNMaterial { MathMat.color(hex, glow: glow, alpha: alpha) }

    private static func box(_ w: Float, _ h: Float, _ l: Float, _ hex: String, round: Float = 0) -> SCNNode {
        MathShape.box(w, h, l, m(hex), round: round)
    }

    private static func cyl(_ r: Float, _ h: Float, _ hex: String, segments: Int = 12) -> SCNNode {
        MathShape.cylinder(r, h, m(hex), segments: segments)
    }

    private static func ball(_ r: Float, _ hex: String, segments: Int = 12) -> SCNNode {
        MathShape.sphere(r, m(hex), segments: segments)
    }

    /// Something made standing up (a cylinder, a cone), laid down along z: its top toward +z.
    private static func alongZ(_ node: SCNNode) -> SCNNode {
        node.eulerAngles.x = .pi / 2
        return node
    }

    /// The same, laid along x: its top toward -x.
    private static func alongX(_ node: SCNNode) -> SCNNode {
        node.eulerAngles.z = .pi / 2
        return node
    }

    private static func squashed(_ node: SCNNode, _ x: Float, _ y: Float, _ z: Float) -> SCNNode {
        node.scale = SCNVector3(x, y, z)
        return node
    }

    /// Turn something made standing up so its top points along `direction`.
    private static func aimed(_ node: SCNNode, along direction: V) -> SCNNode {
        let length = simd_length(direction)
        guard length > 0.0001 else { return node }
        let d = direction / length
        node.simdOrientation = d.y < -0.9999 ? simd_quatf(angle: .pi, axis: V(1, 0, 0)) : simd_quatf(from: V(0, 1, 0), to: d)
        return node
    }

    /// A round bar from one place to another. (Already placed: put it in with `addChildNode`.)
    private static func rod(_ a: V, _ b: V, _ r: Float, _ material: SCNMaterial, segments: Int = 8) -> SCNNode {
        let node = aimed(MathShape.cylinder(r, simd_length(b - a), material, segments: segments), along: b - a)
        node.simdPosition = (a + b) / 2
        return node
    }

    /// A square bar from one place to another. (Already placed.)
    private static func beam(_ a: V, _ b: V, _ w: Float, _ d: Float, _ material: SCNMaterial) -> SCNNode {
        let node = aimed(MathShape.box(w, simd_length(b - a), d, material), along: b - a)
        node.simdPosition = (a + b) / 2
        return node
    }

    /// A ring lying flat, like a hoop on the floor.
    private static func ring(_ radius: Float, _ pipe: Float, _ material: SCNMaterial, segments: Int = 20) -> SCNNode {
        let g = SCNTorus(ringRadius: CGFloat(radius), pipeRadius: CGFloat(pipe))
        g.ringSegmentCount = segments
        g.pipeSegmentCount = 8
        g.materials = [material]
        return SCNNode(geometry: g)
    }

    /// A thick flat ring with a hole through it, lying flat.
    private static func tube(_ inner: Float, _ outer: Float, _ h: Float, _ material: SCNMaterial, segments: Int = 20) -> SCNNode {
        let g = SCNTube(innerRadius: CGFloat(inner), outerRadius: CGFloat(outer), height: CGFloat(h))
        g.radialSegmentCount = segments
        g.materials = [material]
        return SCNNode(geometry: g)
    }

    /// A cylinder with a picture on its top and bottom.
    private static func capped(_ r: Float, _ h: Float, side: SCNMaterial, top: SCNMaterial, segments: Int = 24) -> SCNNode {
        let g = SCNCylinder(radius: CGFloat(r), height: CGFloat(h))
        g.radialSegmentCount = segments
        g.materials = [side, top, top]
        return SCNNode(geometry: g)
    }

    /// A flat shape cut out of a sheet: its outline in x and y, as thick as `depth` in z.
    private static func plate(_ points: [(Float, Float)], _ depth: Float, _ material: SCNMaterial) -> SCNNode {
        let path = UIBezierPath()
        for (i, p) in points.enumerated() {
            let at = CGPoint(x: CGFloat(p.0), y: CGFloat(p.1))
            if i == 0 { path.move(to: at) } else { path.addLine(to: at) }
        }
        path.close()
        let g = SCNShape(path: path, extrusionDepth: CGFloat(depth))
        g.materials = [material]
        return SCNNode(geometry: g)
    }

    // MARK: Drawing

    private static func stroke(_ c: CGContext, _ hex: String, _ width: CGFloat) {
        c.setStrokeColor(ui(hex).cgColor)
        c.setLineWidth(width)
        c.setLineCap(.round)
        c.setLineJoin(.round)
    }

    private static func disc(_ c: CGContext, _ hex: String, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) {
        c.setFillColor(ui(hex).cgColor)
        c.fillEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
    }

    private static func circle(_ c: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) {
        c.strokeEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
    }

    private static func poly(_ c: CGContext, _ hex: String, _ points: [(CGFloat, CGFloat)]) {
        guard let first = points.first else { return }
        c.setFillColor(ui(hex).cgColor)
        c.beginPath()
        c.move(to: CGPoint(x: first.0, y: first.1))
        for p in points.dropFirst() { c.addLine(to: CGPoint(x: p.0, y: p.1)) }
        c.closePath()
        c.fillPath()
    }

    private static func line(_ c: CGContext, _ points: [(CGFloat, CGFloat)]) {
        guard let first = points.first else { return }
        c.beginPath()
        c.move(to: CGPoint(x: first.0, y: first.1))
        for p in points.dropFirst() { c.addLine(to: CGPoint(x: p.0, y: p.1)) }
        c.strokePath()
    }

    /// A slice of a ring, between two radii and two angles.
    private static func wedge(_ c: CGContext, _ hex: String, _ x: CGFloat, _ y: CGFloat, _ r0: CGFloat, _ r1: CGFloat, _ a0: CGFloat, _ a1: CGFloat) {
        c.setFillColor(ui(hex).cgColor)
        c.beginPath()
        c.addArc(center: CGPoint(x: x, y: y), radius: r1, startAngle: a0, endAngle: a1, clockwise: false)
        c.addArc(center: CGPoint(x: x, y: y), radius: r0, startAngle: a1, endAngle: a0, clockwise: true)
        c.closePath()
        c.fillPath()
    }

    /// Words, in the middle of a rectangle. `outline`: only their edges, like a tube of neon.
    private static func text(_ s: String, _ hex: String, _ size: CGFloat, in rect: CGRect, outline: CGFloat = 0) {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        var attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size, weight: .black), .foregroundColor: ui(hex), .paragraphStyle: style]
        if outline > 0 {
            attrs[.strokeColor] = ui(hex)
            attrs[.strokeWidth] = outline
        }
        let height = (s as NSString).boundingRect(with: rect.size, options: .usesLineFragmentOrigin, attributes: attrs, context: nil).height
        (s as NSString).draw(in: CGRect(x: rect.minX, y: rect.midY - height / 2, width: rect.width, height: height), withAttributes: attrs)
    }

    /// The same scatter every time, for stars and windows.
    private static func scatter(_ n: Int, seed: UInt64) -> [(CGFloat, CGFloat, CGFloat)] {
        var rng = MathRNG(seed: seed)
        return (0..<n).map { _ in (CGFloat(rng.unit()), CGFloat(rng.unit()), CGFloat(rng.unit())) }
    }

    // MARK: Things drawn that more than one thing uses

    /// A record seen from above: grooves, a label, and a shine across it so its turning shows.
    private static func record(_ name: String, vinyl: String, groove: String, label: String, glow: CGFloat = 0) -> SCNMaterial {
        MathMat.drawn("house-fun-record-\(name)", 128, 128, glow: glow) { c, size in
            let W = size.width, mid = W / 2
            c.fill(vinyl, CGRect(origin: .zero, size: size))
            stroke(c, groove, 2)
            let rings: [CGFloat] = [0.46, 0.4, 0.34, 0.28]
            for r in rings { circle(c, mid, mid, W * r) }
            c.setAlpha(0.22)
            wedge(c, "ffffff", mid, mid, W * 0.2, W * 0.5, 0.3, 0.75)
            wedge(c, "ffffff", mid, mid, W * 0.2, W * 0.5, 0.3 + .pi, 0.75 + .pi)
            c.setAlpha(1)
            disc(c, label, mid, mid, W * 0.17)
            c.fill("ffffff", CGRect(x: mid - W * 0.13, y: mid - 3, width: W * 0.09, height: 6))
            disc(c, "101010", mid, mid, W * 0.025)
        }
    }

    /// Stripes, up and down.
    private static func stripes(_ a: String, _ b: String) -> SCNMaterial {
        MathMat.drawn("house-fun-stripes-\(a)-\(b)", 128, 32) { c, size in
            c.fill(a, CGRect(origin: .zero, size: size))
            for i in 0..<4 { c.fill(b, CGRect(x: CGFloat(i) * 32, y: 0, width: 16, height: size.height)) }
        }
    }

    /// A piano's keys seen from above, the black ones at the back.
    private static func keyboardTop(octaves: Int) -> SCNMaterial {
        MathMat.drawn("house-fun-keys-\(octaves)", 512, 64) { c, size in
            let W = size.width, H = size.height
            c.fill("f8f4ea", CGRect(origin: .zero, size: size))
            let whites = octaves * 7
            let w = W / CGFloat(whites)
            for i in 1..<whites { c.fill("9a958a", CGRect(x: CGFloat(i) * w - 1, y: 0, width: 2, height: H)) }
            for i in 0..<(whites - 1) where [0, 1, 3, 4, 5].contains(i % 7) {
                c.fill("16161c", CGRect(x: (CGFloat(i) + 1) * w - w * 0.3, y: 0, width: w * 0.6, height: H * 0.62))
            }
        }
    }

    /// The spines of a row of books, of all heights and colours.
    private static func spines(_ seed: Int, u: Float) -> SCNMaterial {
        MathMat.drawn("house-fun-spines-\(seed)", 256, 64, u: u) { c, size in
            var rng = MathRNG(seed: UInt64(100 + seed))
            let palette = ["c0392b", "2e6fb5", "3f8f4a", "e0a030", "6a4fc9", "e2583e", "1f8a8a", "8a2f3a", "f08ab0", "3a4a6b", "d9b04a", "5fa8a0"]
            c.fill("2a1a12", CGRect(origin: .zero, size: size))
            var x: CGFloat = 0
            while x < size.width {
                let w = CGFloat(rng.range(12, 26)), top = CGFloat(rng.range(0, 14))
                c.fill(rng.pick(palette), CGRect(x: x, y: top, width: w - 1.5, height: size.height - top))
                c.fill(rng.chance(0.5) ? "f5d76a" : "f6f1e2", CGRect(x: x + 2, y: top + 8, width: w - 5.5, height: 4))
                x += w
            }
        }
    }

    /// A shelf's worth of books in `n`: from x0 to x1, standing on y, their spines at z.
    private static func books(in n: SCNNode, from x0: Float, to x1: Float, y: Float, z: Float, deep: Float, tall: Float, rng: inout MathRNG) {
        let cover = m("6b3a2a"), pages = m("f3ead2")
        let widths: [Float] = [0.25, 0.375, 0.5]
        var x = x0
        while x1 - x > 0.2 {
            // A gap, now and then.
            if rng.chance(0.16) { x += 0.09; continue }
            let w = min(widths[rng.int(3)], Float(Int((x1 - x) / 0.125)) * 0.125)
            let h = tall * rng.range(0.72, 1)
            let front = spines(rng.int(3), u: w / 0.5)
            n.add(MathShape.faced(w, h, deep, [front, cover, cover, cover, pages, cover]), x + w / 2, y + h / 2, z - deep / 2)
            x += w + 0.004
        }
    }

    // MARK: Game room

    private static func poolTable() -> SCNNode {
        let n = SCNNode()
        for x: Float in [-1.0, 1.0] { for z: Float in [-0.47, 0.47] { n.add(box(0.16, 0.62, 0.16, "4a2c1a"), x, 0.31, z) } }
        n.add(box(2.3, 0.2, 1.2, "6b4226", round: 0.02), 0, 0.66, 0)
        n.add(box(2.18, 0.04, 1.08, "1f8a4c"), 0, 0.76, 0)
        for z: Float in [-0.59, 0.59] { n.add(box(2.4, 0.09, 0.12, "7a4a28", round: 0.02), 0, 0.775, z) }
        for x: Float in [-1.14, 1.14] { n.add(box(0.12, 0.09, 1.3, "7a4a28", round: 0.02), x, 0.775, 0) }
        // Six pockets.
        for x: Float in [-1.03, 0, 1.03] { for z: Float in [-0.49, 0.49] { n.add(cyl(0.07, 0.05, "0c0c10", segments: 10), x, 0.762, z) } }
        // The balls racked, the white one down the other end, and a cue left lying.
        let colours = ["f5c542", "2e6fb5", "d6263a", "6a4fc9", "f08a3c", "3f8f4a", "8a2f3a", "101010", "f5c542", "d6263a"]
        var i = 0
        for row in 0..<4 {
            for k in 0...row {
                n.add(ball(0.03, colours[i], segments: 10), 0.45 + Float(row) * 0.053, 0.81, (Float(k) - Float(row) / 2) * 0.062)
                i += 1
            }
        }
        n.add(ball(0.03, "fbfbf6", segments: 10), -0.62, 0.81, 0.05)
        n.addChildNode(rod(V(-1.0, 0.8, 0.3), V(0.25, 0.8, 0.4), 0.012, m("e0c080")))
        n.addChildNode(rod(V(-1.0, 0.8, 0.3), V(-0.7, 0.8, 0.324), 0.016, m("3a2418")))
        return n
    }

    private static func foosball() -> SCNNode {
        let n = SCNNode()
        for x: Float in [-0.58, 0.58] { for z: Float in [-0.28, 0.28] { n.add(box(0.09, 0.6, 0.09, "2a2a30"), x, 0.3, z) } }
        n.add(box(1.4, 0.2, 0.75, "8a4b2a", round: 0.02), 0, 0.66, 0)
        n.add(box(1.3, 0.02, 0.65, "2f9a55"), 0, 0.765, 0)
        for z: Float in [-0.35, 0.35] { n.add(box(1.4, 0.15, 0.05, "8a4b2a"), 0, 0.825, z) }
        for x: Float in [-0.675, 0.675] { n.add(box(0.05, 0.15, 0.65, "8a4b2a"), x, 0.825, 0) }
        // Six rods through the sides, three a team, each with its handle on its own team's side.
        let teams = [0, 0, 1, 0, 1, 1], players = [1, 2, 3, 3, 2, 1]
        let steel = m("c9ced6")
        for r in 0..<6 {
            let x = -0.5 + Float(r) * 0.2, red = teams[r] == 0
            n.add(alongZ(MathShape.cylinder(0.012, 1.02, steel, segments: 6)), x, 0.85, 0)
            n.add(alongZ(cyl(0.028, 0.13, "20242c", segments: 8)), x, 0.85, red ? 0.56 : -0.56)
            for p in 0..<players[r] {
                let z = (Float(p) - Float(players[r] - 1) / 2) * 0.19
                n.add(box(0.045, 0.13, 0.05, red ? "e23a3a" : "2f6fd6", round: 0.01), x, 0.83, z)
            }
        }
        n.add(ball(0.018, "fbfbf6", segments: 8), 0.06, 0.793, 0.08)
        return n
    }

    private static func pingPong() -> SCNNode {
        let n = SCNNode()
        let white = "f6f6f0", frame = "2a2a30"
        n.add(box(2.74, 0.04, 1.52, "1f5fae"), 0, 0.74, 0)
        for z: Float in [-0.745, 0.745] { n.add(box(2.74, 0.004, 0.03, white), 0, 0.762, z) }
        for x: Float in [-1.355, 1.355] { n.add(box(0.03, 0.004, 1.52, white), x, 0.762, 0) }
        n.add(box(2.74, 0.004, 0.012, white), 0, 0.762, 0)
        // The net across the middle.
        n.add(MathShape.box(0.012, 0.15, 1.6, m("ffffff", alpha: 0.6)), 0, 0.835, 0)
        n.add(box(0.016, 0.02, 1.62, white), 0, 0.915, 0)
        for z: Float in [-0.81, 0.81] { n.add(cyl(0.014, 0.19, frame, segments: 6), 0, 0.83, z) }
        for x: Float in [-1.0, 1.0] {
            for z: Float in [-0.55, 0.55] { n.add(box(0.05, 0.72, 0.05, frame), x, 0.36, z) }
            n.add(box(0.04, 0.04, 1.1, frame), x, 0.25, 0)
        }
        // Two bats and a ball.
        for (x, z, turn, hex) in [(Float(-0.85), Float(0.3), Float(0.5), "d6263a"), (0.9, -0.28, -2.4, "20242c")] {
            let bat = SCNNode()
            bat.add(cyl(0.085, 0.014, hex, segments: 14), 0, 0, 0)
            bat.add(box(0.032, 0.016, 0.12, "c89a5a"), 0, 0, 0.13)
            n.add(bat, x, 0.769, z, ry: turn)
        }
        n.add(ball(0.02, "ff9a2f", segments: 8), -0.6, 0.782, 0.42)
        return n
    }

    private static func beanBag(giant: Bool) -> SCNNode {
        let n = SCNNode()
        let cloth = m(giant ? "6a4fc9" : "e2583e")
        let bag = SCNNode()
        bag.add(squashed(MathShape.sphere(0.47, cloth, segments: 16), 1, 0.5, 1), 0, 0.23, 0)
        bag.add(squashed(MathShape.sphere(0.36, cloth, segments: 16), 1.05, 0.8, 0.75), 0, 0.31, -0.14)
        bag.add(squashed(MathShape.sphere(0.3, cloth, segments: 14), 1.15, 0.5, 0.9), 0, 0.2, 0.2)
        // Where the cloth is gathered at the top.
        bag.add(ball(0.035, giant ? "4a3596" : "b8402c", segments: 8), 0, 0.6, -0.14)
        let s: Float = giant ? 1.5 / 0.95 : 1
        bag.scale = SCNVector3(s, s, s)
        n.addChildNode(bag)
        return n
    }

    private static func racingRig() -> SCNNode {
        let n = SCNNode()
        let dark = "20242c", red = "d6263a"
        n.add(box(0.6, 0.06, 1.66, dark, round: 0.02), 0, 0.03, 0)
        // The seat, its back to +z: whoever's driving faces the screen.
        n.add(box(0.4, 0.2, 0.4, dark), 0, 0.15, 0.45)
        n.add(box(0.46, 0.12, 0.5, red, round: 0.04), 0, 0.3, 0.45)
        for x: Float in [-0.26, 0.26] { n.add(box(0.07, 0.2, 0.46, dark, round: 0.02), x, 0.36, 0.45) }
        let back = SCNNode()
        back.add(box(0.5, 0.74, 0.12, red, round: 0.05), 0, 0.37, 0)
        back.add(box(0.3, 0.18, 0.13, dark, round: 0.04), 0, 0.8, 0)
        for x: Float in [-0.25, 0.25] { back.add(box(0.07, 0.5, 0.2, dark, round: 0.02), x, 0.3, -0.06) }
        back.eulerAngles.x = 0.2
        n.add(back, 0, 0.32, 0.68)
        // The wheel on its stand, and the pedals.
        n.addChildNode(rod(V(0, 0.06, -0.2), V(0, 0.74, -0.1), 0.04, m(dark)))
        n.add(box(0.4, 0.07, 0.22, dark, round: 0.02), 0, 0.76, -0.1)
        let wheel = SCNNode()
        wheel.add(ring(0.16, 0.022, m("3a3f4a")), 0, 0, 0)
        wheel.add(cyl(0.045, 0.04, red, segments: 10), 0, 0, 0)
        wheel.add(box(0.3, 0.02, 0.03, "c9ced6"), 0, 0, 0)
        wheel.add(box(0.03, 0.02, 0.15, "c9ced6"), 0, 0, 0.075)
        wheel.eulerAngles.x = 1.2
        n.add(wheel, 0, 0.88, 0.05)
        for x: Float in [-0.09, 0.09] {
            let pedal = box(0.08, 0.15, 0.025, "c9ced6")
            pedal.eulerAngles.x = 0.6
            n.add(pedal, x, 0.14, -0.45)
        }
        // The screen, wrapped round in three panels: the road ahead, and what's going by.
        n.add(box(0.08, 0.9, 0.08, dark), 0, 0.5, -0.8)
        let road = MathMat.drawn("house-fun-rig-road", 192, 128, glow: 0.9) { c, size in
            let W = size.width, H = size.height
            c.fill("6ec6f2", CGRect(origin: .zero, size: size))
            disc(c, "fff3b0", W * 0.78, H * 0.18, 12)
            poly(c, "7a8fb5", [(0, H * 0.5), (W * 0.2, H * 0.3), (W * 0.42, H * 0.5)])
            poly(c, "8f9fc2", [(W * 0.55, H * 0.5), (W * 0.8, H * 0.26), (W, H * 0.5)])
            c.fill("5fb04a", CGRect(x: 0, y: H * 0.5, width: W, height: H * 0.5))
            poly(c, "4a4f5a", [(W * 0.46, H * 0.5), (W * 0.54, H * 0.5), (W * 0.95, H), (W * 0.05, H)])
            poly(c, "ffffff", [(W * 0.495, H * 0.56), (W * 0.505, H * 0.56), (W * 0.52, H * 0.7), (W * 0.48, H * 0.7)])
            poly(c, "ffffff", [(W * 0.475, H * 0.78), (W * 0.525, H * 0.78), (W * 0.55, H), (W * 0.45, H)])
            c.fill("d6263a", CGRect(x: W * 0.56, y: H * 0.52, width: W * 0.1, height: H * 0.07))
        }
        let side = MathMat.drawn("house-fun-rig-side", 96, 128, glow: 0.9) { c, size in
            let W = size.width, H = size.height
            c.fill("6ec6f2", CGRect(origin: .zero, size: size))
            disc(c, "ffffff", W * 0.4, H * 0.22, 12); disc(c, "ffffff", W * 0.6, H * 0.26, 9)
            poly(c, "7a8fb5", [(0, H * 0.5), (W * 0.5, H * 0.32), (W, H * 0.5)])
            c.fill("5fb04a", CGRect(x: 0, y: H * 0.5, width: W, height: H * 0.5))
            c.fill("7a5233", CGRect(x: W * 0.44, y: H * 0.5, width: W * 0.1, height: H * 0.22))
            disc(c, "3f8f4a", W * 0.49, H * 0.44, 18)
        }
        func panel(_ w: Float, _ picture: SCNMaterial) -> SCNNode {
            let p = SCNNode()
            p.add(box(w + 0.03, 0.43, 0.025, "101014"), 0, 0, 0)
            p.add(MathShape.card(w, 0.4, picture), 0, 0, 0.014)
            return p
        }
        n.add(panel(0.44, road), 0, 1.08, -0.78)
        n.add(panel(0.24, side), -0.325, 1.08, -0.715, ry: 0.55)
        n.add(panel(0.24, side), 0.325, 1.08, -0.715, ry: -0.55)
        return n
    }

    private static func jukebox() -> SCNNode {
        let n = SCNNode()
        let wood = "7a2e1e"
        n.add(box(0.94, 0.08, 0.64, "2a1410"), 0, 0.04, 0)
        n.add(box(0.9, 0.98, 0.6, wood, round: 0.03), 0, 0.56, 0)
        n.add(alongZ(cyl(0.45, 0.6, wood, segments: 24)), 0, 1.05, 0)
        // Tubes of colour up the sides and over the top, one inside another.
        n.add(alongZ(tube(0.33, 0.4, 0.04, m("ff4fa0", glow: 1), segments: 24)), 0, 1.05, 0.3)
        n.add(alongZ(tube(0.26, 0.31, 0.05, m("ffe14a", glow: 1), segments: 24)), 0, 1.05, 0.3)
        for x: Float in [-0.365, 0.365] { n.add(MathShape.box(0.07, 0.72, 0.04, m("3fe0ff", glow: 1)), x, 0.66, 0.3) }
        // The record in its window, going round.
        n.add(alongZ(cyl(0.26, 0.03, "1a1420", segments: 24)), 0, 1.05, 0.3)
        let turning = SCNNode()
        turning.addChildNode(alongZ(capped(0.2, 0.012, side: m("101010"), top: record("black", vinyl: "16161c", groove: "3a3a44", label: "ffcf33"))))
        n.add(turning, 0, 1.05, 0.318)
        turning.runAction(.repeatForever(.rotateBy(x: 0, y: 0, z: -.pi * 2, duration: 3)))
        // What to play, and where it comes out.
        n.add(MathShape.box(0.62, 0.09, 0.03, m("fff3b0", glow: 0.7)), 0, 0.56, 0.3)
        for i in 0..<5 { n.add(box(0.07, 0.05, 0.02, ["d6263a", "2e6fb5", "3f8f4a", "f08a3c", "6a4fc9"][i]), -0.24 + Float(i) * 0.12, 0.56, 0.315) }
        n.add(box(0.6, 0.36, 0.02, "e0b84a"), 0, 0.29, 0.3)
        for i in 0..<5 { n.add(box(0.04, 0.32, 0.02, "5a2418"), -0.24 + Float(i) * 0.12, 0.29, 0.31) }
        return n
    }

    private static func neonGame() -> SCNNode {
        let n = SCNNode()
        n.add(box(1.7, 0.6, 0.03, "15131f", round: 0.01), 0, 0, 0.015)
        let words = MathMat.drawn("house-fun-neon-game", 512, 180, glow: 1) { c, size in
            let W = size.width, H = size.height
            c.fill("15131f", CGRect(origin: .zero, size: size))
            // Each tube twice: once wide and soft for its glow, once thin and hot.
            c.setShadow(offset: .zero, blur: 16, color: ui("3fe0ff").cgColor)
            stroke(c, "3fe0ff", 6)
            c.addPath(UIBezierPath(roundedRect: CGRect(x: 14, y: 14, width: W - 28, height: H - 28), cornerRadius: 26).cgPath)
            c.strokePath()
            c.setShadow(offset: .zero, blur: 18, color: ui("ff3fa4").cgColor)
            text("GAME", "ff3fa4", 96, in: CGRect(x: 24, y: 0, width: W * 0.58, height: H), outline: 6)
            c.setShadow(offset: .zero, blur: 18, color: ui("3fe0ff").cgColor)
            text("ON", "3fe0ff", 96, in: CGRect(x: W * 0.6, y: 0, width: W * 0.36, height: H), outline: 6)
            c.setShadow(offset: .zero, blur: 0, color: nil)
            text("GAME", "ffd9ec", 96, in: CGRect(x: 24, y: 0, width: W * 0.58, height: H), outline: 1.5)
            text("ON", "dffaff", 96, in: CGRect(x: W * 0.6, y: 0, width: W * 0.36, height: H), outline: 1.5)
        }
        n.add(MathShape.card(1.66, 0.56, words), 0, 0, 0.032)
        return n
    }

    private static func neonStar() -> SCNNode {
        let n = SCNNode()
        n.add(alongZ(cyl(0.45, 0.02, "17152a", segments: 24)), 0, 0, 0.01)
        // The star: ten tubes, tip to notch to tip.
        let yellow = m("ffe14a", glow: 1), cyan = m("3fe0ff", glow: 1)
        var points: [V] = []
        for i in 0..<10 {
            let r: Float = i % 2 == 0 ? 0.43 : 0.19, a = Float.pi / 2 + Float(i) * .pi / 5
            points.append(V(cos(a) * r, sin(a) * r, 0.05))
        }
        for i in 0..<10 {
            n.addChildNode(rod(points[i], points[(i + 1) % 10], 0.018, yellow, segments: 6))
            n.add(MathShape.sphere(0.018, yellow, segments: 6), points[i].x, points[i].y, points[i].z)
        }
        // And the lightning through the middle of it.
        let bolt = [V(0.06, 0.17, 0.06), V(-0.07, -0.02, 0.06), V(0.06, 0.02, 0.06), V(-0.05, -0.17, 0.06)]
        for i in 0..<3 { n.addChildNode(rod(bolt[i], bolt[i + 1], 0.02, cyan, segments: 6)) }
        for p in bolt { n.add(MathShape.sphere(0.02, cyan, segments: 6), p.x, p.y, p.z) }
        return n
    }

    private static func dartboard() -> SCNNode {
        let n = SCNNode()
        n.add(box(0.7, 0.7, 0.06, "6b4226", round: 0.01), 0, 0, 0.03)
        n.add(box(0.62, 0.62, 0.02, "1f3d2e"), 0, 0, 0.065)
        let face = MathMat.drawn("house-fun-dartboard", 256, 256) { c, size in
            let mid = size.width / 2, R = size.width / 2
            c.fill("15151a", CGRect(origin: .zero, size: size))
            for i in 0..<20 {
                let a0 = -CGFloat.pi / 2 - .pi / 20 + CGFloat(i) * .pi / 10, a1 = a0 + .pi / 10
                let even = i % 2 == 0
                wedge(c, even ? "15151a" : "f1e6c8", mid, mid, 0, R * 0.8, a0, a1)
                wedge(c, even ? "d6263a" : "2f9a55", mid, mid, R * 0.74, R * 0.8, a0, a1)
                wedge(c, even ? "d6263a" : "2f9a55", mid, mid, R * 0.44, R * 0.5, a0, a1)
            }
            disc(c, "2f9a55", mid, mid, R * 0.1)
            disc(c, "d6263a", mid, mid, R * 0.05)
        }
        n.add(alongZ(capped(0.25, 0.03, side: m("15151a"), top: face)), 0, 0, 0.09)
        // Three darts, one of them close.
        for (x, y, lean, hex) in [(Float(0.03), Float(0.02), Float(0.02), "d6263a"), (-0.09, 0.11, -0.03, "f5c542"), (0.12, -0.08, 0.04, "2e6fb5")] {
            let tip = V(x, y, 0.105), tail = V(x + lean, y + 0.03, 0.25)
            n.addChildNode(rod(tip, tail, 0.006, m("c9ced6"), segments: 6))
            let flight = aimed(MathShape.cone(0.028, 0.004, 0.06, m(hex), segments: 4), along: tip - tail)
            flight.simdPosition = tail
            n.addChildNode(flight)
        }
        return n
    }

    private static func discoBall() -> SCNNode {
        let n = SCNNode()
        n.add(cyl(0.06, 0.02, "20242c"), 0, -0.01, 0)
        n.add(cyl(0.008, 0.3, "20242c", segments: 6), 0, -0.15, 0)
        n.add(cyl(0.05, 0.04, "8a94a6"), 0, -0.3, 0)
        // Little mirrors, each catching the room differently.
        let mirrors = MathMat.drawn("house-fun-disco", 256, 128, glow: 0.35) { c, size in
            c.fill("4a5468", CGRect(origin: .zero, size: size))
            let shades = ["ffffff", "dfe9f5", "b9c7d9", "8fa0b8", "eef3ff", "c9d6ea", "a9b8cf", "ffffff", "ffd9f0", "d0f6ff", "fff3b0"]
            var rng = MathRNG(seed: 77)
            for row in 0..<16 { for col in 0..<32 { c.fill(rng.pick(shades), CGRect(x: col * 8, y: row * 8, width: 7, height: 7)) } }
        }
        let ball = MathShape.sphere(0.225, mirrors, segments: 10)
        n.add(ball, 0, -0.535, 0)
        ball.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 10)))
        return n
    }

    private static func skeeball() -> SCNNode {
        let n = SCNNode()
        let blue = "2f4fa8", red = "d6263a", wood = "d9a55a"
        // The lane, from where you stand at +z up to the jump.
        n.add(box(0.8, 0.5, 1.5, blue), 0, 0.25, 0.45)
        n.add(box(0.62, 0.03, 1.5, wood), 0, 0.515, 0.45)
        for x: Float in [-0.355, 0.355] { n.add(box(0.09, 0.12, 1.5, "f2c14e", round: 0.02), x, 0.56, 0.45) }
        let jump = box(0.62, 0.03, 0.26, wood)
        jump.eulerAngles.x = 0.4
        n.add(jump, 0, 0.57, -0.2)
        n.add(box(0.3, 0.2, 0.02, "f2c14e"), 0, 0.28, 1.205)
        // The board of rings, tipped up, under its hood.
        n.add(box(0.8, 0.6, 0.9, blue), 0, 0.3, -0.75)
        let board = box(0.68, 0.03, 0.98, "22306a")
        let white = m("f6f1e2"), hole = m("0c0c14")
        for (r, x, z, open) in [(Float(0.2), Float(0), Float(0.22), false), (0.13, 0, 0, false), (0.075, 0, 0, true), (0.07, 0, -0.27, true), (0.05, -0.25, -0.4, true), (0.05, 0.25, -0.4, true)] {
            board.add(ring(r, 0.014, white, segments: 16), x, 0.02, z)
            if open { board.add(MathShape.cylinder(r - 0.01, 0.006, hole), x, 0.017, z) }
        }
        board.eulerAngles.x = 0.8
        n.add(board, 0, 0.95, -0.74)
        for x: Float in [-0.375, 0.375] { n.add(box(0.05, 0.85, 0.9, red), x, 1.0, -0.75) }
        n.add(box(0.8, 0.05, 0.9, red), 0, 1.4, -0.75)
        n.add(box(0.8, 0.85, 0.04, red), 0, 1.0, -1.18)
        n.add(box(0.8, 0.16, 0.04, "ffe14a"), 0, 1.33, -0.3)
        n.add(MathShape.card(0.76, 0.14, MathMat.sign("HIGH SCORE", ink: red, paper: "ffe14a", width: 256, height: 48, glow: 0.8)), 0, 1.33, -0.279)
        // A few balls waiting.
        for (x, z) in [(Float(-0.1), Float(0.95)), (0.06, 1.05), (0.18, 0.6)] { n.add(ball(0.045, "b5733f", segments: 10), x, 0.575, z) }
        return n
    }

    private static func vrPod() -> SCNNode {
        let n = SCNNode()
        let white = "f4f4f4", dark = "20242c"
        n.add(cyl(0.7, 0.02, dark, segments: 28), 0, 0.01, 0)
        // Where to stand: a ring lit in the floor, breathing.
        let lit = ring(0.6, 0.02, m("3fe0ff", glow: 1), segments: 32)
        n.add(lit, 0, 0.03, 0)
        lit.runAction(.repeatForever(.sequence([.fadeOpacity(to: 0.45, duration: 1.4), .fadeOpacity(to: 1, duration: 1.4)])))
        n.add(ring(0.3, 0.01, m("ff3fa4", glow: 1), segments: 24), 0, 0.025, 0)
        // The stand at the back, with the headset on top and a controller hung either side.
        n.add(cyl(0.16, 0.03, "3a3f4a", segments: 16), 0, 0.035, -0.42)
        n.add(cyl(0.03, 1.08, "3a3f4a", segments: 8), 0, 0.57, -0.42)
        n.add(box(0.56, 0.04, 0.06, "3a3f4a", round: 0.01), 0, 1.1, -0.42)
        n.add(box(0.26, 0.14, 0.15, white, round: 0.04), 0, 1.2, -0.38)
        n.add(box(0.21, 0.09, 0.02, "101018", round: 0.01), 0, 1.2, -0.3)
        n.add(MathShape.box(0.05, 0.012, 0.022, m("3fe0ff", glow: 1)), 0, 1.165, -0.298)
        n.add(ring(0.1, 0.014, m(dark), segments: 14), 0, 1.2, -0.47)
        for x: Float in [-0.25, 0.25] {
            n.add(cyl(0.022, 0.13, white, segments: 8), x, 0.99, -0.42)
            n.add(ring(0.05, 0.01, m(white), segments: 12), x, 1.05, -0.42)
            n.add(MathShape.sphere(0.012, m("3fe0ff", glow: 1), segments: 6), x, 1.0, -0.396)
        }
        return n
    }

    // MARK: Home cinema

    /// A rocket pointing up the picture, its middle at the origin: turn and move the page first.
    private static func drawRocket(_ c: CGContext, fin: String) {
        poly(c, "ffcf33", [(-11, 30), (11, 30), (0, 70)])
        poly(c, "ff7a2f", [(-6, 30), (6, 30), (0, 52)])
        poly(c, fin, [(-16, 8), (-36, 42), (-16, 30)])
        poly(c, fin, [(16, 8), (36, 42), (16, 30)])
        poly(c, "f6f1e2", [(0, -52), (16, -18), (16, 30), (-16, 30), (-16, -18)])
        poly(c, fin, [(0, -52), (10, -30), (-10, -30)])
        disc(c, "20242c", 0, -6, 10)
        disc(c, "7ad6f2", 0, -6, 7)
    }

    private static func bigScreen() -> SCNNode {
        let n = SCNNode()
        n.add(box(3.2, 1.8, 0.05, "101014", round: 0.01), 0, 0, 0.025)
        let film = MathMat.drawn("house-fun-big-screen", 512, 288, glow: 0.9) { c, size in
            let W = size.width, H = size.height
            c.fill("0b1030", CGRect(origin: .zero, size: size))
            c.fill("131a48", CGRect(x: 0, y: H * 0.45, width: W, height: H * 0.55))
            for p in scatter(70, seed: 5) { disc(c, "ffffff", p.0 * W, p.1 * H, 0.8 + p.2 * 2) }
            // A planet coming up from below, a moon, and a rocket crossing between them.
            disc(c, "f08a3c", W * 0.28, H * 1.3, H * 0.78)
            stroke(c, "d9662a", 9)
            line(c, [(W * 0.02, H * 0.86), (W * 0.2, H * 0.74), (W * 0.42, H * 0.76)])
            line(c, [(W * 0.08, H * 0.98), (W * 0.3, H * 0.9), (W * 0.52, H * 0.96)])
            disc(c, "cfd6e6", W * 0.84, H * 0.26, 24); disc(c, "aab4c8", W * 0.82, H * 0.23, 6); disc(c, "aab4c8", W * 0.86, H * 0.3, 4)
            for i in 0..<5 { disc(c, "ffe9a0", W * (0.4 + 0.035 * CGFloat(i)), H * (0.68 - 0.045 * CGFloat(i)), 3 + CGFloat(i)) }
            c.saveGState()
            c.translateBy(x: W * 0.64, y: H * 0.4)
            c.rotate(by: 0.9)
            c.scaleBy(x: 1.25, y: 1.25)
            drawRocket(c, fin: "d6263a")
            c.restoreGState()
            c.fill("000000", CGRect(x: 0, y: 0, width: W, height: 12)); c.fill("000000", CGRect(x: 0, y: H - 12, width: W, height: 12))
        }
        n.add(MathShape.card(3.1, 1.7, film), 0, 0, 0.052)
        return n
    }

    private static func projector() -> SCNNode {
        let n = SCNNode()
        let dark = "20242c"
        n.add(cyl(0.08, 0.02, dark), 0, -0.01, 0)
        n.add(cyl(0.02, 0.2, dark, segments: 8), 0, -0.1, 0)
        n.add(box(0.4, 0.15, 0.3, "e9e9ee", round: 0.03), 0, -0.275, 0)
        n.add(box(0.3, 0.02, 0.2, "c9ced6"), 0, -0.2, 0)
        // The lens, lit, looking at the screen.
        n.add(alongZ(cyl(0.065, 0.07, dark, segments: 14)), 0.08, -0.275, 0.17)
        n.add(alongZ(MathShape.cylinder(0.048, 0.012, m("cfeeff", glow: 1), segments: 14)), 0.08, -0.275, 0.205)
        n.add(MathShape.sphere(0.012, m("7dff3a", glow: 1), segments: 6), -0.14, -0.3, 0.15)
        for i in 0..<3 { n.add(box(0.006, 0.02, 0.2, "9aa0aa"), -0.201, -0.24 - Float(i) * 0.035, 0) }
        return n
    }

    private static func popcorn() -> SCNNode {
        let n = SCNNode()
        let red = "d6263a", gold = "f2c14e"
        // The cart: two big wheels at the back, two legs at the front, a handle to push it by.
        for x: Float in [-0.33, 0.33] {
            n.add(alongX(cyl(0.18, 0.04, gold, segments: 14)), x, 0.18, -0.12)
            n.add(alongX(cyl(0.05, 0.05, red, segments: 8)), x, 0.18, -0.12)
            n.add(box(0.04, 0.3, 0.04, "20242c"), x * 0.76, 0.15, 0.25)
            n.addChildNode(rod(V(x * 0.76, 0.7, -0.3), V(x * 0.76, 0.76, -0.4), 0.014, m(gold), segments: 6))
        }
        n.addChildNode(rod(V(-0.27, 0.76, -0.4), V(0.27, 0.76, -0.4), 0.016, m(gold), segments: 6))
        n.add(box(0.6, 0.5, 0.6, red, round: 0.02), 0, 0.55, 0)
        n.add(MathShape.card(0.5, 0.19, MathMat.sign("POPCORN", ink: "ffe14a", paper: red, width: 256, height: 96, border: "ffe14a")), 0, 0.57, 0.302)
        // The glass box, warm inside, and the popcorn heaped in it under the kettle.
        let corn = m("fff3c4", glow: 0.5)
        n.add(squashed(MathShape.sphere(0.25, corn, segments: 14), 1, 0.55, 1), 0, 0.84, 0)
        for p in scatter(8, seed: 23) {
            let x = Float(p.0) * 0.36 - 0.18, z = Float(p.1) * 0.36 - 0.18
            n.add(MathShape.sphere(0.045, m("ffe9a0", glow: 0.5), segments: 6), x, 0.95 - (x * x + z * z) * 1.6, z)
        }
        n.add(cyl(0.08, 0.1, "c9ced6"), 0, 1.2, 0)
        n.add(cyl(0.01, 0.12, "c9ced6", segments: 6), 0, 1.3, 0)
        for x: Float in [-0.28, 0.28] { for z: Float in [-0.28, 0.28] { n.add(box(0.035, 0.55, 0.035, red), x, 1.075, z) } }
        n.add(MathShape.box(0.56, 0.55, 0.56, m("fff0c0", glow: 0.5, alpha: 0.35)), 0, 1.075, 0)
        // The canopy.
        n.add(box(0.68, 0.05, 0.68, red), 0, 1.375, 0)
        n.add(MathShape.box(0.66, 0.16, 0.66, stripes(red, "f6f1e2")), 0, 1.48, 0)
        n.add(box(0.5, 0.06, 0.5, red, round: 0.02), 0, 1.59, 0)
        return n
    }

    private static func cinemaSeats(gold: Bool) -> SCNNode {
        let n = SCNNode()
        let velvet = gold ? "c9a227" : "b3202a", soft = gold ? "e0bc4a" : "c8323c", arm = gold ? "4a3610" : "3a1216"
        for x: Float in [-0.7, 0, 0.7] {
            n.add(box(0.6, 0.3, 0.7, arm), x, 0.17, -0.02)
            n.add(box(0.58, 0.14, 0.62, soft, round: 0.05), x, 0.39, 0.08)
            let back = SCNNode()
            back.add(box(0.58, 0.72, 0.16, velvet, round: 0.06), 0, 0.36, 0)
            back.add(box(0.4, 0.17, 0.1, soft, round: 0.04), 0, 0.6, 0.07)
            // Reclined further in the gold ones, with the footrest up.
            back.eulerAngles.x = gold ? -0.3 : -0.12
            n.add(back, x, 0.3, -0.3)
            if gold {
                let rest = box(0.54, 0.08, 0.36, soft, round: 0.03)
                rest.eulerAngles.x = 0.12
                n.add(rest, x, 0.36, 0.58)
                n.add(box(0.4, 0.05, 0.3, arm), x, 0.28, 0.5)
            }
        }
        for x: Float in [-1.05, -0.35, 0.35, 1.05] {
            n.add(box(0.1, 0.56, 0.82, arm, round: 0.02), x, 0.28, -0.02)
            n.add(box(0.1, 0.04, 0.5, velvet, round: 0.015), x, 0.575, -0.12)
            // A cup holder at the front of each arm.
            n.add(cyl(0.042, 0.03, "0c0c10", segments: 10), x, 0.565, 0.3)
            n.add(ring(0.042, 0.008, m("c9ced6"), segments: 10), x, 0.58, 0.3)
        }
        return n
    }

    private static func moviePoster(space: Bool) -> SCNNode {
        let n = SCNNode()
        n.add(box(0.78, 1.08, 0.04, space ? "c9ced6" : "20242c", round: 0.01), 0, 0, 0.02)
        let picture = MathMat.drawn("house-fun-poster-\(space ? "space" : "monster")", 256, 366, glow: 0.3) { c, size in
            let W = size.width, H = size.height
            if space {
                c.fill("0d1238", CGRect(origin: .zero, size: size))
                for p in scatter(60, seed: 9) { disc(c, "ffffff", p.0 * W, p.1 * H * 0.85, 0.8 + p.2 * 2) }
                // A ringed planet, the moon underfoot, and the rocket leaving it.
                disc(c, "f08a3c", W * 0.68, H * 0.36, 42)
                c.saveGState()
                c.translateBy(x: W * 0.68, y: H * 0.36)
                c.rotate(by: -0.35)
                stroke(c, "ffe14a", 6)
                c.strokeEllipse(in: CGRect(x: -72, y: -14, width: 144, height: 28))
                c.restoreGState()
                disc(c, "f08a3c", W * 0.68, H * 0.33, 30)
                disc(c, "8a94a6", W * 0.5, H * 1.32, W * 0.95)
                disc(c, "6b7488", W * 0.25, H * 0.9, 14); disc(c, "6b7488", W * 0.7, H * 0.95, 20); disc(c, "6b7488", W * 0.5, H * 0.84, 7)
                for i in 0..<4 { disc(c, "ffe9a0", W * (0.2 + 0.03 * CGFloat(i)), H * (0.76 - 0.03 * CGFloat(i)), 3 + CGFloat(i)) }
                c.saveGState()
                c.translateBy(x: W * 0.38, y: H * 0.56)
                c.rotate(by: 0.6)
                drawRocket(c, fin: "3fe0ff")
                c.restoreGState()
                text("COSMO KIDS", "3fe0ff", 36, in: CGRect(x: 0, y: 6, width: W, height: 60))
                text("TO THE STARS AND BACK BY BEDTIME", "ffffff", 10, in: CGRect(x: 0, y: H - 26, width: W, height: 20))
            } else {
                c.fill("f28a3a", CGRect(origin: .zero, size: size))
                c.fill("e2583e", CGRect(x: 0, y: 0, width: W, height: H * 0.22))
                disc(c, "ffd27a", W * 0.5, H * 0.44, 86)
                // The monster, up to its middle in the city.
                let green = "3f8f4a", deep = "2f6f3a"
                for i in 0..<5 { poly(c, deep, [(W * (0.34 + 0.08 * CGFloat(i)), H * 0.3), (W * (0.38 + 0.08 * CGFloat(i)), H * 0.2), (W * (0.42 + 0.08 * CGFloat(i)), H * 0.3)]) }
                c.setFillColor(ui(green).cgColor)
                c.fillEllipse(in: CGRect(x: W * 0.22, y: H * 0.42, width: W * 0.56, height: H * 0.6))
                c.fillEllipse(in: CGRect(x: W * 0.28, y: H * 0.25, width: W * 0.44, height: H * 0.3))
                poly(c, green, [(W * 0.26, H * 0.56), (W * 0.06, H * 0.38), (W * 0.14, H * 0.36), (W * 0.36, H * 0.5)])
                poly(c, green, [(W * 0.74, H * 0.56), (W * 0.94, H * 0.38), (W * 0.86, H * 0.36), (W * 0.64, H * 0.5)])
                for x: CGFloat in [0.04, 0.09, 0.14, 0.86, 0.91, 0.96] { poly(c, "f6f1e2", [(W * (x - 0.02), H * 0.38), (W * x, H * 0.32), (W * (x + 0.02), H * 0.38)]) }
                disc(c, "ffffff", W * 0.41, H * 0.36, 13); disc(c, "ffffff", W * 0.59, H * 0.36, 13)
                disc(c, "101010", W * 0.42, H * 0.37, 6); disc(c, "101010", W * 0.58, H * 0.37, 6)
                c.fill("20242c", CGRect(x: W * 0.36, y: H * 0.44, width: W * 0.28, height: H * 0.06))
                for i in 0..<5 { poly(c, "ffffff", [(W * (0.37 + 0.054 * CGFloat(i)), H * 0.44), (W * (0.424 + 0.054 * CGFloat(i)), H * 0.44), (W * (0.397 + 0.054 * CGFloat(i)), H * 0.475)]) }
                disc(c, deep, W * 0.42, H * 0.66, 12); disc(c, deep, W * 0.56, H * 0.72, 9); disc(c, deep, W * 0.5, H * 0.6, 7)
                // The skyline, with its lights on.
                let tops: [CGFloat] = [0.8, 0.7, 0.84, 0.74, 0.66, 0.82, 0.72, 0.86]
                for (i, top) in tops.enumerated() {
                    let x = W * CGFloat(i) / 8
                    c.fill("2a2440", CGRect(x: x, y: H * top, width: W / 8 - 2, height: H * (1 - top)))
                    for (k, p) in scatter(5, seed: UInt64(40 + i)).enumerated() where p.2 > 0.25 {
                        c.fill("ffe14a", CGRect(x: x + 5 + CGFloat(k % 2) * 13, y: H * top + 8 + CGFloat(k) * 12, width: 7, height: 6))
                    }
                }
                text("GRONK!", "ffe14a", 54, in: CGRect(x: 0, y: 4, width: W, height: 70))
                text("HE ONLY WANTED A SNACK", "ffffff", 12, in: CGRect(x: 0, y: H - 24, width: W, height: 20))
            }
        }
        n.add(MathShape.card(0.7, 1.0, picture), 0, 0, 0.042)
        return n
    }

    private static func candyStand() -> SCNNode {
        let n = SCNNode()
        let pink = "ff8fb8", cream = "f6f1e2"
        n.add(MathShape.faced(0.9, 0.5, 0.5, [stripes(pink, cream), m(cream), m(cream), m(cream), m(cream), m(cream)]), 0, 0.25, 0)
        n.add(box(0.96, 0.05, 0.56, pink, round: 0.02), 0, 0.525, 0)
        // Four jars, each full of something different.
        let sweets = ["d6263a", "f5c542", "3fbf6a", "8a5fd6"]
        for i in 0..<4 {
            let x = -0.3 + Float(i) * 0.2
            n.add(cyl(0.062, 0.12, sweets[i], segments: 10), x, 0.615, 0.02)
            n.add(MathShape.cylinder(0.08, 0.17, m("dff6ff", alpha: 0.4), segments: 12), x, 0.635, 0.02)
            n.add(cyl(0.084, 0.025, "d6263a", segments: 12), x, 0.732, 0.02)
            n.add(ball(0.02, "d6263a", segments: 6), x, 0.755, 0.02)
        }
        // Two lollipops in a pot at the end.
        for (x, hex) in [(Float(-0.42), "ff5fa0"), (0.42, "3fe0c0")] {
            n.add(cyl(0.008, 0.2, cream, segments: 6), x, 0.65, 0.2)
            n.add(alongZ(cyl(0.05, 0.02, hex, segments: 12)), x, 0.77, 0.2)
        }
        // The awning, on two posts at the back.
        for x: Float in [-0.43, 0.43] { n.add(cyl(0.015, 0.5, cream, segments: 6), x, 0.8, -0.22) }
        let awning = MathShape.box(0.96, 0.03, 0.58, stripes("d6263a", cream))
        awning.eulerAngles.x = 0.2
        n.add(awning, 0, 1.03, 0)
        n.add(MathShape.box(0.96, 0.08, 0.02, stripes("d6263a", cream)), 0, 0.94, 0.285)
        return n
    }

    // MARK: Music room

    private static func pianoStool() -> SCNNode {
        let s = SCNNode()
        s.add(box(0.55, 0.09, 0.32, "8a2f3a", round: 0.03), 0, 0.47, 0)
        s.add(box(0.5, 0.05, 0.28, "2a160e"), 0, 0.41, 0)
        for x: Float in [-0.22, 0.22] { for z: Float in [-0.11, 0.11] { s.add(box(0.045, 0.4, 0.045, "2a160e"), x, 0.2, z) } }
        return s
    }

    private static func piano() -> SCNNode {
        let n = SCNNode()
        let wood = "3a2218", dark = "2a160e"
        n.add(box(1.5, 1.2, 0.35, wood, round: 0.02), 0, 0.6, -0.125)
        n.add(box(1.54, 0.05, 0.4, dark, round: 0.015), 0, 1.225, -0.115)
        // The keys, on their shelf, between two cheeks.
        n.add(box(1.46, 0.1, 0.27, wood), 0, 0.68, 0.165)
        n.add(box(1.36, 0.03, 0.17, "f8f4ea"), 0, 0.74, 0.205)
        n.add(MathShape.floor(1.36, 0.17, keyboardTop(octaves: 5)), 0, 0.7565, 0.205)
        for x: Float in [-0.705, 0.705] {
            n.add(box(0.05, 0.15, 0.27, dark), x, 0.725, 0.165)
            n.add(box(0.07, 0.63, 0.07, wood), x * 0.98, 0.315, 0.26)
        }
        // Something to play, on the desk.
        for (w, h, d, hex, z) in [(Float(0.7), Float(0.24), Float(0.02), dark, Float(0.075)), (0.34, 0.2, 0.01, "fffaf0", 0.09)] {
            let sheet = box(w, h, d, hex)
            sheet.eulerAngles.x = -0.25
            n.add(sheet, 0, 0.95, z)
        }
        for x: Float in [-0.07, 0, 0.07] { n.add(box(0.035, 0.02, 0.1, "e0b84a"), x, 0.04, 0.09) }
        n.add(pianoStool(), 0, 0, 0.64)
        return n
    }

    private static func grandPiano() -> SCNNode {
        let n = SCNNode()
        let black = m("16161c")
        // The shape of a grand from above: straight down the bass side, round the tail, and in at the waist.
        func wing(_ thick: Float, _ material: SCNMaterial) -> SCNNode {
            let path = UIBezierPath()
            path.move(to: CGPoint(x: -0.75, y: 0))
            path.addLine(to: CGPoint(x: -0.75, y: 1.3))
            path.addCurve(to: CGPoint(x: -0.2, y: 1.6), controlPoint1: CGPoint(x: -0.75, y: 1.52), controlPoint2: CGPoint(x: -0.5, y: 1.62))
            path.addCurve(to: CGPoint(x: 0.75, y: 0.55), controlPoint1: CGPoint(x: 0.3, y: 1.56), controlPoint2: CGPoint(x: 0.2, y: 0.7))
            path.addLine(to: CGPoint(x: 0.75, y: 0))
            path.close()
            path.flatness = 0.01
            let g = SCNShape(path: path, extrusionDepth: CGFloat(thick))
            g.materials = [material]
            let node = SCNNode(geometry: g)
            // Laid flat: the keyboard end at the node's own z, the tail away toward -z.
            node.eulerAngles.x = -.pi / 2
            return node
        }
        n.add(wing(0.28, black), 0, 0.72, 0.4)
        let frame = wing(0.01, m("c9a24a"))
        frame.scale = SCNVector3(0.93, 0.93, 1)
        n.add(frame, 0, 0.862, 0.36)
        for i in 0..<5 { n.add(box(0.012, 0.006, 0.9 - Float(i) * 0.12, "3a2f1a"), -0.45 + Float(i) * 0.2, 0.868, -0.2 + Float(i) * 0.05) }
        // The lid, propped open on its stick.
        let hinge = SCNNode()
        hinge.add(wing(0.03, black), 0.75, 0, 0)
        hinge.eulerAngles.z = 0.5
        n.add(hinge, -0.75, 0.878, 0.4)
        n.addChildNode(rod(V(0.5, 0.86, -0.25), V(0.34, 1.46, -0.25), 0.012, black, segments: 6))
        // The keys, the desk, the pedals, three legs.
        n.add(MathShape.box(1.5, 0.14, 0.26, black), 0, 0.67, 0.53)
        n.add(box(1.36, 0.02, 0.17, "f8f4ea"), 0, 0.75, 0.565)
        n.add(MathShape.floor(1.36, 0.17, keyboardTop(octaves: 5)), 0, 0.7615, 0.565)
        for x: Float in [-0.715, 0.715] { n.add(MathShape.box(0.07, 0.1, 0.26, black), x, 0.79, 0.53) }
        for (w, h, d, hex, z) in [(Float(0.7), Float(0.22), Float(0.02), "16161c", Float(0.3)), (0.34, 0.18, 0.01, "fffaf0", 0.315)] {
            let sheet = box(w, h, d, hex)
            sheet.eulerAngles.x = -0.25
            n.add(sheet, 0, 0.99, z)
        }
        for (x, z) in [(Float(-0.62), Float(0.25)), (0.62, 0.25), (-0.3, -0.95)] { n.add(MathShape.cone(0.035, 0.06, 0.58, black, segments: 10), x, 0.29, z) }
        n.add(MathShape.box(0.16, 0.42, 0.04, black), 0, 0.37, 0.3)
        for x: Float in [-0.05, 0, 0.05] { n.add(box(0.03, 0.02, 0.1, "e0b84a"), x, 0.05, 0.36) }
        n.add(pianoStool(), 0, 0, 0.98)
        return n
    }

    /// A drum standing on its end, its middle at the origin: a shell, two skins, two hoops.
    private static func drum(_ r: Float, _ h: Float, _ shell: String) -> SCNNode {
        let d = SCNNode()
        d.add(cyl(r, h, shell, segments: 16), 0, 0, 0)
        d.add(cyl(r - 0.012, h + 0.012, "f4f1ea", segments: 16), 0, 0, 0)
        for y: Float in [-1, 1] { d.add(cyl(r + 0.008, 0.02, "c9ced6", segments: 16), 0, y * (h / 2 - 0.01), 0) }
        return d
    }

    /// A stand's pole from the floor up to `top`, on three feet.
    private static func stand(in n: SCNNode, _ x: Float, _ z: Float, top: Float) {
        let steel = m("c9ced6")
        n.addChildNode(rod(V(x, 0.2, z), V(x, top, z), 0.014, steel, segments: 6))
        for i in 0..<3 {
            let t = Float(i) * .pi * 2 / 3 + 0.5
            n.addChildNode(rod(V(x, 0.26, z), V(x + cos(t) * 0.2, 0.01, z + sin(t) * 0.2), 0.01, steel, segments: 6))
        }
    }

    private static func drums() -> SCNNode {
        let n = SCNNode()
        let shell = "c0392b", brass = m("e0b84a")
        // Whoever's playing sits at +z, behind the bass drum.
        n.add(alongZ(drum(0.28, 0.4, shell)), 0, 0.3, -0.25)
        n.add(box(0.1, 0.03, 0.26, "c9ced6"), 0, 0.02, 0.1)
        n.add(cyl(0.016, 0.22, "c9ced6", segments: 6), 0, 0.68, -0.2)
        for x: Float in [-0.17, 0.17] {
            let tom = drum(0.13, 0.16, shell)
            tom.eulerAngles.x = 0.35
            n.add(tom, x, 0.8, -0.14)
        }
        stand(in: n, -0.42, 0.22, top: 0.54)
        n.add(drum(0.17, 0.12, shell), -0.42, 0.6, 0.22)
        n.addChildNode(rod(V(-0.52, 0.675, 0.3), V(-0.3, 0.675, 0.16), 0.008, m("e0c080"), segments: 6))
        n.addChildNode(rod(V(-0.5, 0.69, 0.14), V(-0.32, 0.69, 0.32), 0.008, m("e0c080"), segments: 6))
        n.add(drum(0.2, 0.36, shell), 0.52, 0.42, 0.28)
        for i in 0..<3 {
            let t = Float(i) * .pi * 2 / 3
            n.addChildNode(rod(V(0.52 + cos(t) * 0.21, 0.45, 0.28 + sin(t) * 0.21), V(0.52 + cos(t) * 0.25, 0, 0.28 + sin(t) * 0.25), 0.01, m("c9ced6"), segments: 6))
        }
        // The hi-hat on the left, a crash cymbal up on the right.
        stand(in: n, -0.66, -0.05, top: 0.92)
        n.add(MathShape.cone(0.17, 0.03, 0.025, brass, segments: 16), -0.66, 0.865, -0.05)
        n.add(MathShape.cone(0.03, 0.17, 0.025, brass, segments: 16), -0.66, 0.838, -0.05)
        stand(in: n, 0.6, -0.45, top: 1.2)
        let crash = MathShape.cone(0.23, 0.03, 0.035, brass, segments: 16)
        crash.eulerAngles = SCNVector3(0.2, 0, 0.15)
        n.add(crash, 0.6, 1.2, -0.45)
        // And the stool.
        stand(in: n, 0, 0.64, top: 0.46)
        n.add(cyl(0.17, 0.08, "20242c", segments: 16), 0, 0.5, 0.64)
        return n
    }

    /// A guitar standing on the bottom of its body, its strings toward +z.
    private static func guitar(electric: Bool) -> SCNNode {
        let g = SCNNode()
        if electric {
            let red = "d6263a"
            g.add(alongZ(cyl(0.165, 0.05, red, segments: 18)), 0, 0.17, 0)
            g.add(box(0.24, 0.2, 0.05, red, round: 0.02), 0, 0.3, 0)
            g.add(alongZ(cyl(0.07, 0.05, red, segments: 12)), -0.095, 0.42, 0)
            g.add(alongZ(cyl(0.07, 0.05, red, segments: 12)), 0.105, 0.39, 0)
            g.add(alongZ(cyl(0.09, 0.01, "f6f1e2", segments: 12)), 0.04, 0.2, 0.026)
            for y: Float in [0.2, 0.3] { g.add(box(0.09, 0.03, 0.012, "20242c"), 0, y, 0.032) }
            for y: Float in [0.08, 0.13] { g.add(alongZ(cyl(0.012, 0.02, "c9ced6", segments: 8)), 0.09, y, 0.03) }
            g.add(box(0.045, 0.5, 0.028, "e0c080"), 0, 0.7, 0.02)
            g.add(box(0.07, 0.14, 0.028, "e0c080"), 0.008, 1.01, 0.02)
            g.add(box(0.025, 0.86, 0.004, "e8e8e8"), 0, 0.58, 0.037)
        } else {
            let top = "e0a050"
            g.add(alongZ(cyl(0.19, 0.1, top, segments: 18)), 0, 0.19, 0)
            g.add(alongZ(cyl(0.145, 0.1, top, segments: 18)), 0, 0.43, 0)
            g.add(box(0.2, 0.2, 0.1, top), 0, 0.33, 0)
            g.add(alongZ(cyl(0.055, 0.01, "2a160e", segments: 12)), 0, 0.36, 0.047)
            g.add(box(0.11, 0.025, 0.012, "3a2218"), 0, 0.16, 0.055)
            g.add(box(0.05, 0.46, 0.03, "5a3422"), 0, 0.78, 0.035)
            g.add(box(0.075, 0.13, 0.03, "3a2218"), 0, 1.07, 0.035)
            for y: Float in [1.04, 1.1] { g.add(box(0.11, 0.02, 0.012, "e0b84a"), 0, y, 0.035) }
            g.add(box(0.03, 0.9, 0.004, "e8e8e8"), 0, 0.6, 0.056)
        }
        return g
    }

    /// A guitar on its stand, leaning back into it.
    private static func guitarOnStand(electric: Bool = false) -> SCNNode {
        let n = SCNNode()
        let dark = m("20242c")
        let top = V(0, 0.42, -0.04)
        for foot in [V(-0.2, 0, 0.14), V(0.2, 0, 0.14), V(0, 0, -0.2), V(0, 0.9, -0.1)] { n.addChildNode(rod(foot, top, 0.014, dark, segments: 6)) }
        for x: Float in [-0.1, 0.1] { n.addChildNode(rod(V(x, 0.13, 0), V(x, 0.1, 0.13), 0.014, dark, segments: 6)) }
        n.addChildNode(rod(V(-0.1, 0.13, 0), V(0.1, 0.13, 0), 0.014, dark, segments: 6))
        n.add(MathShape.box(0.11, 0.03, 0.06, dark), 0, 0.9, -0.08)
        let g = guitar(electric: electric).scaled(0.9)
        g.eulerAngles.x = -0.12
        n.add(g, 0, 0.12, 0.05)
        return n
    }

    private static func electricGuitar() -> SCNNode {
        let n = SCNNode()
        n.add(guitarOnStand(electric: true), -0.24, 0, 0)
        // Its little amp beside it, switched on.
        let x: Float = 0.22
        n.add(box(0.42, 0.42, 0.24, "20242c", round: 0.02), x, 0.21, 0)
        n.add(box(0.36, 0.27, 0.012, "b89a6a"), x, 0.17, 0.121)
        n.add(alongZ(cyl(0.1, 0.014, "8a7248", segments: 14)), x, 0.17, 0.122)
        n.add(box(0.36, 0.05, 0.012, "c9ced6"), x, 0.355, 0.121)
        for i in 0..<4 { n.add(alongZ(cyl(0.012, 0.02, "20242c", segments: 8)), x - 0.13 + Float(i) * 0.065, 0.355, 0.13) }
        n.add(MathShape.sphere(0.012, m("ff4a3a", glow: 1), segments: 6), x + 0.14, 0.355, 0.13)
        n.add(box(0.16, 0.02, 0.04, "3a3f4a"), x, 0.43, 0)
        return n
    }

    private static func keyboard() -> SCNNode {
        let n = SCNNode()
        let dark = m("20242c")
        // The stand: an X, with a foot and an arm at each end of each bar.
        n.addChildNode(beam(V(-0.42, 0.02, -0.02), V(0.42, 0.8, -0.02), 0.04, 0.03, dark))
        n.addChildNode(beam(V(0.42, 0.02, 0.02), V(-0.42, 0.8, 0.02), 0.04, 0.03, dark))
        for x: Float in [-0.42, 0.42] {
            n.add(MathShape.box(0.05, 0.04, 0.4, dark), x, 0.02, 0)
            n.add(MathShape.box(0.05, 0.04, 0.34, dark), x, 0.8, 0)
        }
        n.add(box(1.2, 0.09, 0.36, "2a2a34", round: 0.02), 0, 0.865, 0)
        n.add(box(1.1, 0.02, 0.16, "f8f4ea"), 0, 0.905, 0.08)
        n.add(MathShape.floor(1.1, 0.16, keyboardTop(octaves: 4)), 0, 0.9165, 0.08)
        // What it's set to, and the knobs that set it.
        n.add(MathShape.box(0.2, 0.012, 0.07, m("3fe0ff", glow: 1)), -0.32, 0.912, -0.1)
        for i in 0..<6 { n.add(cyl(0.016, 0.03, ["ff3fa4", "ffe14a", "7dff3a"][i % 3], segments: 8), -0.1 + Float(i) * 0.09, 0.92, -0.1) }
        n.add(alongX(cyl(0.025, 0.02, "6b7078", segments: 10)), -0.54, 0.915, 0.08)
        return n
    }

    private static func ampStack() -> SCNNode {
        let n = SCNNode()
        let grille = MathMat.drawn("house-fun-amp-grille", 128, 128) { c, size in
            c.fill("2e2e38", CGRect(origin: .zero, size: size))
            for i in 0..<16 { c.fill("282830", CGRect(x: 0, y: i * 8, width: 128, height: 3)) }
            stroke(c, "5a5a70", 4)
            for x: CGFloat in [33, 95] { for y: CGFloat in [33, 95] { circle(c, x, y, 25); disc(c, "1a1a20", x, y, 10) } }
        }
        // Two cabinets, one on the other, and the head on top with its light on.
        for y: Float in [0, 0.65] {
            n.add(box(0.75, 0.65, 0.4, "1c1c22", round: 0.02), 0, y + 0.325, 0)
            n.add(MathShape.card(0.66, 0.56, grille), 0, y + 0.325, 0.202)
            n.add(box(0.12, 0.03, 0.01, "f6f1e2"), 0.22, y + 0.08, 0.204)
        }
        n.add(box(0.7, 0.26, 0.36, "1c1c22", round: 0.02), 0, 1.44, 0)
        n.add(box(0.62, 0.1, 0.012, "2e2e38"), 0, 1.495, 0.181)
        n.add(box(0.62, 0.08, 0.012, "e0b84a"), 0, 1.39, 0.181)
        for i in 0..<6 { n.add(alongZ(cyl(0.016, 0.03, "16161c", segments: 8)), -0.24 + Float(i) * 0.075, 1.39, 0.19) }
        n.add(MathShape.sphere(0.014, m("ff4a3a", glow: 1), segments: 6), 0.27, 1.39, 0.19)
        n.add(box(0.2, 0.02, 0.05, "3a3f4a"), 0, 1.58, 0)
        return n
    }

    private static func mic() -> SCNNode {
        let n = SCNNode()
        n.add(cyl(0.16, 0.03, "20242c", segments: 16), 0, 0.015, 0)
        n.add(cyl(0.012, 1.36, "c9ced6", segments: 8), 0, 0.71, 0)
        n.add(cyl(0.022, 0.07, "20242c", segments: 8), 0, 0.85, 0)
        // The microphone in its clip, tipped toward whoever's singing.
        let low = V(0, 1.37, -0.035), high = V(0, 1.455, 0.07)
        n.addChildNode(rod(low, high, 0.022, m("20242c")))
        n.addChildNode(rod(high - (high - low) * 0.12, high, 0.03, m("e0b84a")))
        n.add(ball(0.05, "c9ced6", segments: 10), 0, 1.485, 0.105)
        n.add(ring(0.09, 0.008, m("20242c"), segments: 12), 0.06, 0.038, 0.02)
        return n
    }

    private static func recordPlayer() -> SCNNode {
        let n = SCNNode()
        for x: Float in [-0.29, 0.29] { for z: Float in [-0.17, 0.17] { n.add(MathShape.cone(0.012, 0.022, 0.1, m("5a3422"), segments: 8), x, 0.05, z) } }
        n.add(box(0.7, 0.48, 0.45, "a8683a", round: 0.02), 0, 0.34, 0)
        // The records it's played, in their sleeves.
        n.add(box(0.6, 0.34, 0.012, "3a2418"), 0, 0.33, 0.224)
        let sleeves = ["d6263a", "f5c542", "2e6fb5", "f6f1e2", "3f8f4a", "f08a3c", "6a4fc9", "20242c", "ff8fb8", "1f8a8a", "e0b84a", "c0392b"]
        for (i, hex) in sleeves.enumerated() { n.add(box(0.035, i % 3 == 0 ? 0.27 : 0.3, 0.012, hex), -0.26 + Float(i) * 0.047, i % 3 == 0 ? 0.305 : 0.32, 0.232) }
        // The turntable, and the one it's playing now.
        n.add(box(0.52, 0.06, 0.38, "2a2a30", round: 0.01), 0, 0.61, 0)
        n.add(cyl(0.165, 0.02, "c9ced6", segments: 20), -0.06, 0.65, 0)
        let playing = capped(0.15, 0.008, side: m("101010"), top: record("black", vinyl: "16161c", groove: "3a3a44", label: "ffcf33"))
        n.add(playing, -0.06, 0.664, 0)
        playing.runAction(.repeatForever(.rotateBy(x: 0, y: -.pi * 2, z: 0, duration: 1.8)))
        n.add(cyl(0.022, 0.05, "c9ced6", segments: 8), 0.2, 0.665, -0.13)
        n.addChildNode(rod(V(0.2, 0.69, -0.13), V(0.06, 0.68, 0.09), 0.008, m("c9ced6"), segments: 6))
        n.add(box(0.03, 0.015, 0.04, "20242c"), 0.06, 0.675, 0.09)
        n.add(cyl(0.02, 0.02, "e0b84a", segments: 8), 0.2, 0.65, 0.13)
        return n
    }

    private static func goldRecord() -> SCNNode {
        let n = SCNNode()
        n.add(box(0.5, 0.6, 0.03, "20242c", round: 0.01), 0, 0, 0.015)
        n.add(box(0.43, 0.53, 0.01, "1f2a44"), 0, 0, 0.033)
        let gold = record("gold", vinyl: "f5c542", groove: "c9951a", label: "20242c", glow: 0.35)
        n.add(alongZ(capped(0.17, 0.012, side: m("d9a520"), top: gold)), 0, 0.06, 0.044)
        // The plaque saying what it was for.
        n.add(MathShape.box(0.22, 0.07, 0.01, m("f5c542", glow: 0.3)), 0, -0.2, 0.04)
        for y: Float in [-0.19, -0.21] { n.add(box(0.16, 0.008, 0.012, "20242c"), 0, y, 0.041) }
        return n
    }

    // MARK: Library

    private static func ladderShelves() -> SCNNode {
        let n = SCNNode()
        let wood = "5a3422", brass = m("e0b84a")
        n.add(box(2.4, 2.5, 0.04, "3a2218"), 0, 1.25, -0.18)
        for x: Float in [-1.17, 1.17] { n.add(box(0.06, 2.5, 0.4, wood), x, 1.25, 0) }
        n.add(box(2.4, 0.06, 0.4, wood), 0, 2.47, 0)
        n.add(box(2.4, 0.12, 0.4, wood), 0, 0.06, 0)
        // Five shelves, packed.
        var rng = MathRNG(seed: 12)
        for i in 0..<5 {
            let y = 0.12 + Float(i) * 0.47
            if i > 0 { n.add(box(2.28, 0.04, 0.36, wood), 0, y - 0.02, 0) }
            books(in: n, from: -1.12, to: 1.12, y: y, z: 0.14, deep: 0.26, tall: 0.38, rng: &rng)
        }
        // The rail along the top, and the ladder that rolls on it.
        n.add(alongX(MathShape.cylinder(0.015, 2.4, brass, segments: 8)), 0, 2.08, 0.26)
        for x: Float in [-1.1, 0, 1.1] { n.add(MathShape.box(0.03, 0.03, 0.08, brass), x, 2.08, 0.22) }
        let stile = m("c98a4a")
        let at: Float = 0.5, foot: Float = 0.75, head: Float = 0.27
        for side: Float in [-0.2, 0.2] {
            n.addChildNode(beam(V(at + side, 0.05, foot), V(at + side, 2.14, head), 0.05, 0.03, stile))
            n.add(alongX(cyl(0.045, 0.03, "20242c", segments: 10)), at + side, 0.045, foot + 0.02)
            n.add(MathShape.box(0.06, 0.05, 0.06, brass), at + side, 2.1, 0.26)
        }
        for i in 1...7 {
            let t = Float(i) / 8
            let y = 0.05 + t * 2.09, z = foot + (head - foot) * t
            n.addChildNode(rod(V(at - 0.2, y, z), V(at + 0.2, y, z), 0.016, stile, segments: 6))
        }
        return n
    }

    private static func bookStack() -> SCNNode {
        let n = SCNNode()
        let covers = ["c0392b", "2e6fb5", "e0a030", "3f8f4a", "6a4fc9", "1f8a8a", "e2583e", "3a4a6b", "f08ab0", "8a2f3a"]
        var rng = MathRNG(seed: 5)
        var y: Float = 0
        // Ten big books, none of them square on the one below.
        for (i, hex) in covers.enumerated() {
            let w = rng.range(0.3, 0.38), h = rng.range(0.05, 0.072), d = rng.range(0.23, 0.29)
            let book = SCNNode()
            book.add(box(w - 0.014, h - 0.008, d - 0.014, "f3ead2"), 0.004, -0.004, 0)
            book.add(box(w, 0.008, d, hex), 0, h / 2 - 0.004, 0)
            book.add(box(0.012, h, d, hex), -w / 2 + 0.006, 0, 0)
            let x = rng.range(-0.03, 0.03), z = rng.range(-0.03, 0.03), turn = rng.range(-0.4, 0.4) + (i % 2 == 0 ? 0.01 : Float.pi)
            n.add(book, x, y + h / 2, z, ry: turn)
            y += h
        }
        // And somebody's mug on top.
        n.add(cyl(0.045, 0.09, "3fa7d6"), 0.02, y + 0.045, 0)
        n.add(cyl(0.038, 0.004, "3a2418"), 0.02, y + 0.091, 0)
        n.add(alongZ(ring(0.025, 0.008, m("3fa7d6"), segments: 10)), 0.07, y + 0.045, 0)
        return n
    }

    private static func grandfatherClock() -> SCNNode {
        let n = SCNNode()
        let wood = "5a3422", dark = "3a2218", brass = m("e0b84a", glow: 0.25)
        n.add(box(0.5, 0.4, 0.3, wood, round: 0.01), 0, 0.2, 0)
        n.add(box(0.36, 1.0, 0.24, wood), 0, 0.92, 0)
        n.add(box(0.5, 0.48, 0.3, wood, round: 0.01), 0, 1.66, 0)
        for y: Float in [0.42, 1.43, 1.91] { n.add(box(0.54, 0.04, 0.32, dark), 0, y, 0) }
        n.add(alongZ(cyl(0.11, 0.3, wood, segments: 16)), 0, 1.9, 0)
        for x: Float in [-0.21, 0.21] { n.add(MathShape.sphere(0.03, brass, segments: 8), x, 1.96, 0) }
        // The face.
        let face = MathMat.drawn("house-fun-clock-face", 128, 128) { c, size in
            let W = size.width, mid = W / 2
            c.fill("e0b84a", CGRect(origin: .zero, size: size))
            disc(c, "f6efd8", mid, mid, W * 0.47)
            stroke(c, "3a2218", 3)
            circle(c, mid, mid, W * 0.45)
            for i in 0..<12 {
                let t = CGFloat(i) * .pi / 6
                disc(c, "3a2218", mid + cos(t) * W * 0.36, mid + sin(t) * W * 0.36, i % 3 == 0 ? 5 : 2.5)
            }
            // Ten past ten.
            stroke(c, "20242c", 5); line(c, [(mid, mid), (mid - W * 0.19, mid - W * 0.12)])
            stroke(c, "20242c", 3.5); line(c, [(mid, mid), (mid + W * 0.27, mid - W * 0.17)])
            disc(c, "e0b84a", mid, mid, 5)
        }
        n.add(MathShape.card(0.36, 0.36, face), 0, 1.67, 0.152)
        // The pendulum, behind its dark glass, going to and fro.
        n.add(box(0.24, 0.82, 0.01, "1a120c"), 0, 0.92, 0.121)
        let swing = SCNNode()
        swing.add(MathShape.box(0.012, 0.66, 0.006, brass), 0, -0.33, 0)
        swing.add(alongZ(MathShape.cylinder(0.06, 0.012, brass, segments: 14)), 0, -0.68, 0)
        swing.eulerAngles.z = -0.09
        n.add(swing, 0, 1.3, 0.134)
        let to = SCNAction.rotateTo(x: 0, y: 0, z: 0.09, duration: 1), fro = SCNAction.rotateTo(x: 0, y: 0, z: -0.09, duration: 1)
        to.timingMode = .easeInEaseOut
        fro.timingMode = .easeInEaseOut
        swing.runAction(.repeatForever(.sequence([to, fro])))
        return n
    }

    private static func readingNook() -> SCNNode {
        let n = SCNNode()
        n.add(box(1.6, 0.4, 0.7, "f6f1e2", round: 0.01), 0, 0.2, 0)
        for x: Float in [-0.52, 0, 0.52] { n.add(box(0.44, 0.26, 0.01, "e3dcc8"), x, 0.2, 0.352) }
        n.add(box(1.54, 0.1, 0.64, "5fa8a0", round: 0.04), 0, 0.45, 0)
        // Cushions piled up at one end to lean on.
        let big = box(0.42, 0.42, 0.14, "f2c14e", round: 0.06)
        big.eulerAngles = SCNVector3(-0.25, 0.9, 0)
        n.add(big, -0.6, 0.7, -0.05)
        let small = box(0.34, 0.34, 0.13, "e2583e", round: 0.06)
        small.eulerAngles = SCNVector3(-0.35, 0.3, 0)
        n.add(small, -0.3, 0.66, -0.17)
        n.add(alongX(cyl(0.1, 0.5, "f4a6c0", segments: 12)), 0.45, 0.6, -0.2)
        // The books being read, and the one that's open.
        for (i, hex) in ["2e6fb5", "c0392b", "e0a030"].enumerated() {
            n.add(box(0.26 - Float(i) * 0.02, 0.04, 0.19, hex), 0.42, 0.52 + Float(i) * 0.04, 0.12, ry: 0.2 - Float(i) * 0.3)
        }
        for side: Float in [-1, 1] {
            let page = box(0.14, 0.012, 0.2, "fffaf0")
            page.eulerAngles.z = side * 0.18
            n.add(page, side * 0.068, 0.518, 0.14)
        }
        return n
    }

    // MARK: Workshop

    private static func pegboard() -> SCNNode {
        let n = SCNNode()
        let steel = m("c9ced6"), edge = m("b8946a"), handle = "c98a4a"
        let holes = MathMat.drawn("house-fun-pegboard", 256, 160) { c, size in
            c.fill("d9b98a", CGRect(origin: .zero, size: size))
            for row in 0..<10 { for col in 0..<16 { disc(c, "a07c50", 8 + CGFloat(col) * 16, 8 + CGFloat(row) * 16, 2.5) } }
        }
        n.add(MathShape.faced(1.6, 1.0, 0.03, [holes, edge, edge, edge, edge, edge]), 0, 0, 0.015)
        for y: Float in [-0.5, 0.5] { n.add(box(1.64, 0.04, 0.05, "8a5a3a"), 0, y, 0.025) }
        for x: Float in [-0.8, 0.8] { n.add(box(0.04, 1.0, 0.05, "8a5a3a"), x, 0, 0.025) }
        // A hammer, a saw, a wrench.
        n.add(box(0.04, 0.4, 0.03, handle), -0.62, -0.02, 0.05)
        n.add(box(0.17, 0.07, 0.05, "6b7078"), -0.62, 0.2, 0.055)
        let saw = SCNNode()
        saw.add(plate([(-0.26, -0.01), (0.2, -0.07), (0.2, 0.07), (-0.26, 0.03)], 0.008, steel), 0, 0, 0)
        saw.add(box(0.13, 0.18, 0.03, handle, round: 0.02), 0.26, 0, 0)
        saw.eulerAngles.z = 0.25
        n.add(saw, -0.2, 0.2, 0.05)
        let wrench = SCNNode()
        wrench.add(MathShape.box(0.035, 0.34, 0.012, steel), 0, 0, 0)
        wrench.add(alongZ(tube(0.022, 0.05, 0.012, steel, segments: 10)), 0, 0.2, 0)
        wrench.add(alongZ(tube(0.015, 0.035, 0.012, steel, segments: 10)), 0, -0.19, 0)
        wrench.eulerAngles.z = -0.3
        n.add(wrench, 0.28, 0.14, 0.05)
        // Three screwdrivers in a row, a level, a tape measure, and a shelf of jars of bits.
        for (i, hex) in ["d6263a", "f5c542", "2e6fb5"].enumerated() {
            let x = 0.5 + Float(i) * 0.1, long = 0.2 - Float(i) * 0.04
            n.add(cyl(0.024, 0.13, hex, segments: 8), x, 0.3, 0.055)
            n.add(MathShape.cylinder(0.007, long, steel, segments: 6), x, 0.235 - long / 2, 0.055)
        }
        n.add(box(0.5, 0.07, 0.03, "f2c14e"), -0.4, -0.32, 0.045)
        n.add(MathShape.box(0.08, 0.03, 0.032, m("9dff6a", glow: 0.6)), -0.4, -0.32, 0.046)
        n.add(alongZ(cyl(0.065, 0.04, "f08a3c", segments: 12)), 0.05, -0.3, 0.05)
        n.add(alongZ(cyl(0.03, 0.042, "20242c", segments: 10)), 0.05, -0.3, 0.05)
        n.add(box(0.42, 0.03, 0.1, "8a5a3a"), 0.5, -0.38, 0.08)
        for (i, hex) in ["d6263a", "c9ced6", "e0b84a"].enumerated() {
            let x = 0.38 + Float(i) * 0.12
            n.add(cyl(0.03, 0.05, hex, segments: 8), x, -0.34, 0.08)
            n.add(MathShape.cylinder(0.04, 0.09, m("dff6ff", alpha: 0.4), segments: 10), x, -0.32, 0.08)
        }
        return n
    }

    private static func robot() -> SCNNode {
        let n = SCNNode()
        let body = "3fa7d6", steel = "c9ced6", dark = "3a3f4a"
        for x: Float in [-0.14, 0.14] {
            n.add(box(0.2, 0.12, 0.34, dark, round: 0.03), x, 0.06, 0.02)
            n.add(cyl(0.05, 0.22, steel, segments: 8), x, 0.22, 0)
        }
        n.add(box(0.5, 0.42, 0.34, body, round: 0.05), 0, 0.53, 0)
        n.add(box(0.28, 0.2, 0.012, "f6f1e2"), 0, 0.55, 0.171)
        for (i, hex) in ["ff4f6a", "ffe14a", "7dff3a"].enumerated() { n.add(MathShape.sphere(0.022, m(hex, glow: 0.9), segments: 8), -0.08 + Float(i) * 0.08, 0.6, 0.178) }
        n.add(box(0.2, 0.03, 0.014, dark), 0, 0.5, 0.172)
        n.add(cyl(0.05, 0.07, steel, segments: 8), 0, 0.77, 0)
        // Its head: eyes lit, and looking about, a little.
        let head = SCNNode()
        head.add(box(0.4, 0.3, 0.3, "dfe6ee", round: 0.06), 0, 0.15, 0)
        for x: Float in [-0.09, 0.09] {
            head.add(alongZ(MathShape.cylinder(0.055, 0.02, m("ffe14a", glow: 1), segments: 14)), x, 0.17, 0.15)
            head.add(alongZ(cyl(0.022, 0.024, "20242c", segments: 8)), x, 0.17, 0.15)
            head.add(alongX(cyl(0.045, 0.04, dark, segments: 10)), x * 2.4, 0.15, 0)
        }
        head.add(box(0.16, 0.025, 0.012, "20242c"), 0, 0.06, 0.151)
        head.add(cyl(0.01, 0.12, steel, segments: 6), 0, 0.36, 0)
        head.add(MathShape.sphere(0.03, m("ff4f6a", glow: 1), segments: 8), 0, 0.43, 0)
        n.add(head, 0, 0.8, 0)
        let one = SCNAction.rotateTo(x: 0, y: 0.25, z: 0.06, duration: 2.4), other = SCNAction.rotateTo(x: 0, y: -0.25, z: -0.06, duration: 2.4)
        one.timingMode = .easeInEaseOut
        other.timingMode = .easeInEaseOut
        head.runAction(.repeatForever(.sequence([one, .wait(duration: 1.5), other, .wait(duration: 1)])))
        // One arm on.
        n.add(ball(0.065, steel, segments: 10), 0.3, 0.66, 0)
        n.add(cyl(0.04, 0.3, body, segments: 8), 0.32, 0.48, 0)
        n.add(box(0.09, 0.07, 0.07, dark, round: 0.015), 0.32, 0.3, 0)
        // The other still to do: its wires hanging out of the shoulder, and the arm on the floor with the spanner.
        n.add(alongX(cyl(0.06, 0.03, dark, segments: 10)), -0.26, 0.66, 0)
        n.addChildNode(rod(V(-0.27, 0.66, 0), V(-0.36, 0.6, 0.03), 0.008, m("d6263a"), segments: 6))
        n.addChildNode(rod(V(-0.27, 0.67, 0), V(-0.35, 0.72, -0.02), 0.008, m("f5c542"), segments: 6))
        let arm = SCNNode()
        arm.add(alongZ(cyl(0.04, 0.3, body, segments: 8)), 0, 0, 0)
        arm.add(ball(0.06, steel, segments: 10), 0, 0, -0.17)
        arm.add(box(0.09, 0.07, 0.07, dark, round: 0.015), 0, 0, 0.18)
        n.add(arm, -0.47, 0.06, 0.2, ry: 0.5)
        n.add(box(0.03, 0.01, 0.2, steel), 0.44, 0.005, 0.28, ry: -0.6)
        return n
    }

    private static func printer3d() -> SCNNode {
        let n = SCNNode()
        let frame = "20242c", accent = "ff7a2f", plastic = "3fe07a"
        n.add(box(0.5, 0.06, 0.5, frame, round: 0.01), 0, 0.03, 0)
        for x: Float in [-0.235, 0.235] {
            for z: Float in [-0.235, 0.235] { n.add(box(0.03, 0.44, 0.03, frame), x, 0.28, z) }
            n.add(box(0.03, 0.03, 0.44, accent), x, 0.485, 0)
            n.add(box(0.5, 0.03, 0.03, accent), 0, 0.485, x)
        }
        // The bed, and on it a little rocket, as far as its middle.
        n.add(box(0.34, 0.015, 0.34, "c9ced6"), 0, 0.1, 0)
        n.add(cyl(0.05, 0.1, plastic), 0, 0.158, 0)
        n.add(cyl(0.05, 0.006, "b8ffd0"), 0, 0.211, 0)
        for i in 0..<3 {
            let t = Float(i) * .pi * 2 / 3
            n.add(box(0.05, 0.06, 0.012, plastic), cos(t) * 0.065, 0.138, -sin(t) * 0.065, ry: t + 0.001)
        }
        // The head on its rails, the nozzle just above where it's got to, and the reel it's printing from.
        for z: Float in [-0.02, 0.02] { n.add(alongX(MathShape.cylinder(0.008, 0.44, m("c9ced6"), segments: 6)), 0, 0.34, z) }
        n.add(box(0.09, 0.09, 0.09, accent, round: 0.015), 0.03, 0.33, 0)
        n.add(MathShape.cone(0.004, 0.02, 0.06, m("c9ced6"), segments: 8), 0.03, 0.255, 0)
        n.add(alongX(cyl(0.09, 0.05, plastic, segments: 14)), 0.285, 0.4, -0.1)
        n.add(alongX(cyl(0.03, 0.06, frame, segments: 8)), 0.285, 0.4, -0.1)
        n.add(MathShape.box(0.12, 0.035, 0.01, m("3fe0ff", glow: 1)), -0.12, 0.03, 0.251)
        n.add(alongZ(cyl(0.015, 0.02, "c9ced6", segments: 8)), 0.04, 0.03, 0.255)
        return n
    }

    private static func rocketModel() -> SCNNode {
        let n = SCNNode()
        let white = "f6f1e2", red = "d6263a"
        // The pad, and the rail it'll go up.
        n.add(cyl(0.28, 0.04, "6b7078", segments: 16), 0, 0.02, 0)
        n.add(cyl(0.012, 1.3, "c9ced6", segments: 6), 0.17, 0.67, 0)
        n.add(cyl(0.05, 0.08, "3a3f4a", segments: 8), 0, 0.08, 0)
        n.add(MathShape.cone(0.065, 0.035, 0.08, m("3a3f4a"), segments: 12), 0, 0.16, 0)
        n.add(cyl(0.09, 0.8, white, segments: 14), 0, 0.6, 0)
        n.add(cyl(0.092, 0.07, red, segments: 14), 0, 0.84, 0)
        n.add(cyl(0.092, 0.05, "20242c", segments: 14), 0, 0.4, 0)
        n.add(MathShape.cone(0.09, 0, 0.36, m(red), segments: 14), 0, 1.18, 0)
        n.add(ball(0.04, "20242c", segments: 10), 0, 0.72, 0.065)
        n.add(MathShape.sphere(0.03, m("7ad6f2", glow: 0.3), segments: 10), 0, 0.72, 0.08)
        for i in 0..<4 {
            let t = Float.pi / 4 + Float(i) * .pi / 2
            n.add(plate([(0, 0.28), (0, 0), (0.15, -0.1), (0.15, 0.02)], 0.016, m(red)), cos(t) * 0.085, 0.22, -sin(t) * 0.085, ry: t)
        }
        return n
    }

    private static func toolChest() -> SCNNode {
        let n = SCNNode()
        let red = "d6263a", deep = "b81e2e", steel = "c9ced6"
        for x: Float in [-0.28, 0.28] { for z: Float in [-0.16, 0.16] { n.add(alongX(cyl(0.04, 0.03, "20242c", segments: 10)), x, 0.04, z) } }
        n.add(box(0.7, 0.5, 0.45, red, round: 0.015), 0, 0.33, 0)
        n.add(box(0.66, 0.28, 0.4, red, round: 0.015), 0, 0.73, 0)
        n.add(box(0.68, 0.03, 0.42, deep), 0, 0.885, 0)
        // Three deep drawers below, three shallow ones above.
        for i in 0..<3 {
            let low = 0.17 + Float(i) * 0.155, high = 0.655 + Float(i) * 0.08
            n.add(box(0.62, 0.13, 0.012, deep), 0, low, 0.226)
            n.add(box(0.5, 0.02, 0.02, steel), 0, low + 0.035, 0.24)
            n.add(box(0.58, 0.062, 0.012, deep), 0, high, 0.201)
            n.add(box(0.4, 0.014, 0.018, steel), 0, high + 0.012, 0.214)
        }
        // The handle to pull it about by.
        for z: Float in [-0.12, 0.12] { n.add(box(0.06, 0.02, 0.02, steel), 0.37, 0.5, z) }
        n.add(alongZ(cyl(0.012, 0.28, steel, segments: 6)), 0.4, 0.5, 0)
        return n
    }

    private static func goKartFrame() -> SCNNode {
        let n = SCNNode()
        let pipe = m("2e6fb5"), steel = m("c9ced6"), dark = "20242c"
        // Four wheels on two axles: the kart points at +z.
        for (z, r, w, out) in [(Float(0.58), Float(0.14), Float(0.12), Float(0.44)), (-0.55, 0.16, 0.16, 0.41)] {
            for side: Float in [-1, 1] {
                n.add(alongX(cyl(r, w, dark, segments: 14)), side * out, r, z)
                n.add(alongX(cyl(r * 0.45, w + 0.01, "f5c542", segments: 10)), side * out, r, z)
            }
            n.addChildNode(rod(V(-out, r, z), V(out, r, z), 0.018, steel, segments: 6))
        }
        // The frame, bare: two rails, the bars across, a bumper.
        for x: Float in [-0.22, 0.22] {
            n.addChildNode(rod(V(x, 0.15, -0.6), V(x, 0.15, 0.66), 0.022, pipe))
            n.addChildNode(rod(V(x, 0.15, 0.66), V(x * 1.3, 0.15, 0.78), 0.022, pipe))
        }
        for z: Float in [-0.6, -0.3, 0.2, 0.66] { n.addChildNode(rod(V(-0.22, 0.15, z), V(0.22, 0.15, z), 0.022, pipe)) }
        n.addChildNode(rod(V(-0.3, 0.15, 0.78), V(0.3, 0.15, 0.78), 0.022, pipe))
        n.add(box(0.44, 0.01, 0.46, "6b7078"), 0, 0.172, 0.43)
        // A seat, a wheel to steer by, two pedals.
        n.add(box(0.36, 0.06, 0.34, dark, round: 0.02), 0, 0.21, -0.1)
        let back = box(0.36, 0.42, 0.06, dark, round: 0.03)
        back.eulerAngles.x = -0.2
        n.add(back, 0, 0.42, -0.3)
        for x: Float in [-0.19, 0.19] { n.add(box(0.03, 0.14, 0.3, "d6263a", round: 0.01), x, 0.27, -0.1) }
        let foot = V(0, 0.17, 0.5), hand = V(0, 0.5, 0.14)
        n.addChildNode(rod(foot, hand, 0.014, steel, segments: 6))
        let wheel = aimed(ring(0.12, 0.018, m(dark), segments: 14), along: hand - foot)
        wheel.simdPosition = hand
        n.addChildNode(wheel)
        let hub = aimed(cyl(0.03, 0.03, "d6263a", segments: 8), along: hand - foot)
        hub.simdPosition = hand
        n.addChildNode(hub)
        for x: Float in [-0.08, 0.08] {
            let pedal = box(0.06, 0.1, 0.015, "c9ced6")
            pedal.eulerAngles.x = -0.5
            n.add(pedal, x, 0.22, 0.6)
        }
        // And the engine, behind the seat.
        n.add(box(0.3, 0.2, 0.22, "6b7078", round: 0.02), 0, 0.28, -0.52)
        n.add(cyl(0.06, 0.1, "3a3f4a", segments: 10), -0.06, 0.42, -0.52)
        n.add(alongX(cyl(0.055, 0.14, "d6263a", segments: 10)), 0.07, 0.42, -0.5)
        n.addChildNode(rod(V(-0.15, 0.3, -0.56), V(-0.2, 0.36, -0.76), 0.02, steel, segments: 6))
        return n
    }

    // MARK: Secret room

    private static func crystalBall() -> SCNNode {
        let n = SCNNode()
        // A little round table under a cloth of stars.
        let cloth = MathMat.drawn("house-fun-starcloth", 256, 128) { c, size in
            let W = size.width, H = size.height
            c.fill("4a2a7a", CGRect(origin: .zero, size: size))
            for p in scatter(30, seed: 61) { disc(c, p.2 > 0.5 ? "ffe14a" : "f3d9ff", p.0 * W, p.1 * H * 0.85, 1.5 + p.2 * 3) }
            c.fill("e0b84a", CGRect(x: 0, y: H - 12, width: W, height: 7))
        }
        n.add(MathShape.cone(0.33, 0.28, 0.62, cloth, segments: 16), 0, 0.31, 0)
        n.add(cyl(0.3, 0.03, "5a3590", segments: 16), 0, 0.635, 0)
        n.add(MathShape.cone(0.1, 0.06, 0.06, m("e0b84a"), segments: 12), 0, 0.68, 0)
        // The ball: something bright in the middle of it, and two sparks going round that.
        let core = MathShape.sphere(0.07, m("f3d9ff", glow: 1), segments: 10)
        n.add(core, 0, 0.84, 0)
        core.runAction(.repeatForever(.sequence([.scale(to: 1.25, duration: 1.6), .scale(to: 0.75, duration: 1.6)])))
        let sparks = SCNNode()
        for x: Float in [-0.09, 0.09] { sparks.add(MathShape.sphere(0.014, m("ffffff", glow: 1), segments: 6), x, x * 0.4, 0) }
        n.add(sparks, 0, 0.84, 0)
        sparks.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 5)))
        let glass = MathShape.sphere(0.14, m("b06aff", glow: 0.8, alpha: 0.7), segments: 16)
        glass.castsShadow = false
        n.add(glass, 0, 0.84, 0)
        // Two cards turned over, and a candle.
        n.add(box(0.07, 0.004, 0.11, "f6efd8"), 0.17, 0.653, 0.12, ry: 0.4)
        n.add(box(0.07, 0.004, 0.11, "f6efd8"), -0.15, 0.653, 0.15, ry: -0.3)
        n.add(cyl(0.02, 0.09, "f6f1e2", segments: 8), -0.17, 0.695, -0.12)
        n.add(MathShape.cone(0.012, 0, 0.04, m("ffb347", glow: 1), segments: 6), -0.17, 0.76, -0.12)
        return n
    }

    private static func treasure() -> SCNNode {
        let n = SCNNode()
        let wood = "7a4a28", band = "c9a227"
        let gold = m("f5c542", glow: 0.6)
        n.add(box(0.9, 0.34, 0.6, wood, round: 0.015), 0, 0.17, 0)
        for x: Float in [-0.33, 0.33] { n.add(box(0.07, 0.35, 0.61, band), x, 0.17, 0) }
        n.add(box(0.12, 0.12, 0.02, band), 0, 0.25, 0.305)
        n.add(box(0.025, 0.05, 0.022, "20242c"), 0, 0.24, 0.306)
        // The lid: half a barrel, thrown back on its hinge, lined in red.
        var arch: [(Float, Float)] = [], wide: [(Float, Float)] = []
        for i in 0...10 {
            let a = Float(i) * .pi / 10
            arch.append((cos(a) * 0.3, sin(a) * 0.3))
            wide.append((cos(a) * 0.306, sin(a) * 0.306))
        }
        let hinge = SCNNode()
        hinge.add(plate(arch, 0.9, m(wood)), 0, 0, 0.3, ry: .pi / 2)
        for x: Float in [-0.33, 0.33] { hinge.add(plate(wide, 0.07, m(band)), x, 0, 0.3, ry: .pi / 2) }
        hinge.add(box(0.8, 0.012, 0.5, "8a1f2a"), 0, -0.006, 0.3)
        hinge.eulerAngles.x = -1.9
        n.add(hinge, 0, 0.34, -0.3)
        // Gold, heaped over the brim, with coins lying every way on it and a few fallen out.
        n.add(squashed(MathShape.sphere(0.36, gold, segments: 14), 1.1, 0.4, 0.7), 0, 0.3, 0)
        for p in scatter(12, seed: 71) {
            let x = (Float(p.0) - 0.5) * 0.6, z = (Float(p.1) - 0.5) * 0.36
            let up = max(0, 1 - (x / 0.396) * (x / 0.396) - (z / 0.252) * (z / 0.252)).squareRoot()
            let coin = MathShape.cylinder(0.035, 0.008, gold, segments: 10)
            coin.eulerAngles = SCNVector3(Float(p.2) - 0.5, 0, Float(p.0) - 0.5)
            n.add(coin, x, 0.305 + 0.144 * up, z)
        }
        for (x, z) in [(Float(-0.22), Float(0.42)), (0.08, 0.5), (0.3, 0.4)] { n.add(MathShape.cylinder(0.035, 0.008, gold, segments: 10), x, 0.004, z) }
        for (x, y, z, hex) in [(Float(-0.2), Float(0.42), Float(0.1), "ff3a5a"), (0.26, 0.4, -0.04, "3fe07a"), (0.04, 0.45, 0.16, "3f9fff")] {
            n.add(MathShape.sphere(0.035, m(hex, glow: 0.6), segments: 6), x, y, z)
        }
        // And a crown on the top of it all.
        let crown = SCNNode()
        crown.add(tube(0.075, 0.087, 0.06, gold, segments: 12), 0, 0, 0)
        for i in 0..<5 {
            let t = Float(i) * .pi * 2 / 5 + .pi / 2
            crown.add(MathShape.cone(0.018, 0, 0.05, gold, segments: 6), cos(t) * 0.081, 0.055, sin(t) * 0.081)
        }
        crown.add(MathShape.sphere(0.016, m("ff3a5a", glow: 0.6), segments: 6), 0, 0, 0.088)
        crown.eulerAngles.z = 0.2
        n.add(crown, 0.08, 0.475, -0.03)
        return n
    }

    private static func mapTable() -> SCNNode {
        let n = SCNNode()
        let wood = "7a4a28", dark = "5a3422", brass = m("e0b84a")
        n.add(MathShape.cone(0.36, 0.12, 0.1, m(dark), segments: 16), 0, 0.05, 0)
        n.add(cyl(0.1, 0.6, dark), 0, 0.4, 0)
        n.add(cyl(0.65, 0.06, wood, segments: 24), 0, 0.72, 0)
        // The map: an island, the way across it, and where to dig.
        let chart = MathMat.drawn("house-fun-treasure-map", 256, 188) { c, size in
            let W = size.width, H = size.height
            c.fill("ead9a8", CGRect(origin: .zero, size: size))
            stroke(c, "c9a86a", 10)
            c.stroke(CGRect(origin: .zero, size: size))
            stroke(c, "9ab8c2", 2)
            for p in scatter(14, seed: 81) {
                let x = p.0 * W, y = p.1 * H
                line(c, [(x, y), (x + 6, y - 3), (x + 12, y), (x + 18, y - 3)])
            }
            poly(c, "c9b878", [(W * 0.2, H * 0.5), (W * 0.3, H * 0.22), (W * 0.52, H * 0.16), (W * 0.76, H * 0.24), (W * 0.84, H * 0.5), (W * 0.7, H * 0.76), (W * 0.44, H * 0.84), (W * 0.26, H * 0.72)])
            poly(c, "8fae6a", [(W * 0.3, H * 0.5), (W * 0.38, H * 0.32), (W * 0.54, H * 0.28), (W * 0.62, H * 0.44), (W * 0.5, H * 0.6), (W * 0.36, H * 0.62)])
            for x: CGFloat in [0.4, 0.47, 0.54] { poly(c, "8a6a48", [(W * (x - 0.05), H * 0.5), (W * x, H * 0.34), (W * (x + 0.05), H * 0.5)]) }
            stroke(c, "c0392b", 3)
            c.setLineDash(phase: 0, lengths: [7, 6])
            line(c, [(W * 0.28, H * 0.7), (W * 0.4, H * 0.72), (W * 0.52, H * 0.66), (W * 0.6, H * 0.56), (W * 0.7, H * 0.44)])
            c.setLineDash(phase: 0, lengths: [])
            stroke(c, "c0392b", 5)
            line(c, [(W * 0.67, H * 0.36), (W * 0.75, H * 0.48)]); line(c, [(W * 0.75, H * 0.36), (W * 0.67, H * 0.48)])
            // North.
            let x = W * 0.12, y = H * 0.2
            poly(c, "5a3422", [(x, y - 20), (x + 5, y), (x, y + 20), (x - 5, y)])
            poly(c, "5a3422", [(x - 16, y), (x, y - 4), (x + 16, y), (x, y + 4)])
            text("N", "5a3422", 13, in: CGRect(x: x - 12, y: y - 38, width: 24, height: 16))
        }
        let laid = SCNNode()
        laid.addChildNode(MathShape.floor(0.9, 0.66, chart))
        n.add(laid, 0.02, 0.752, 0.04, ry: 0.12)
        // A lantern to read it by.
        n.add(cyl(0.06, 0.02, "3a3f4a"), -0.4, 0.76, -0.2)
        n.add(MathShape.cylinder(0.045, 0.11, m("ffd27a", glow: 1), segments: 10), -0.4, 0.825, -0.2)
        n.add(MathShape.cone(0.065, 0.02, 0.05, m("3a3f4a"), segments: 10), -0.4, 0.905, -0.2)
        n.add(alongZ(ring(0.035, 0.006, m("3a3f4a"), segments: 10)), -0.4, 0.955, -0.2)
        // A compass that can't quite make its mind up, a spyglass, and a coin or two.
        n.add(MathShape.cylinder(0.065, 0.025, brass), 0.38, 0.7625, 0.24)
        n.add(cyl(0.052, 0.027, "f6f1e2"), 0.38, 0.7625, 0.24)
        let needle = box(0.085, 0.004, 0.014, "d6263a")
        n.add(needle, 0.38, 0.779, 0.24, ry: 0.4)
        let east = SCNAction.rotateTo(x: 0, y: -0.3, z: 0, duration: 1.3), west = SCNAction.rotateTo(x: 0, y: 0.4, z: 0, duration: 1.7)
        east.timingMode = .easeInEaseOut
        west.timingMode = .easeInEaseOut
        needle.runAction(.repeatForever(.sequence([east, west])))
        n.addChildNode(rod(V(0.08, 0.775, -0.42), V(0.3, 0.775, -0.34), 0.024, brass))
        n.addChildNode(rod(V(0.3, 0.775, -0.34), V(0.44, 0.775, -0.29), 0.017, brass))
        for (x, z) in [(Float(-0.12), Float(0.44)), (-0.2, 0.4)] { n.add(MathShape.cylinder(0.03, 0.008, m("f5c542", glow: 0.4), segments: 10), x, 0.754, z) }
        return n
    }

    private static func armor() -> SCNNode {
        let n = SCNNode()
        let steel = m("aab4c0"), deep = m("6b7480"), gold = m("e0b84a")
        n.add(box(0.56, 0.06, 0.4, "3a2218"), 0, 0.03, 0)
        for x: Float in [-0.11, 0.11] {
            n.add(MathShape.box(0.12, 0.08, 0.24, deep), x, 0.1, 0.03)
            n.add(MathShape.cylinder(0.065, 0.7, steel, segments: 10), x, 0.49, 0)
            n.add(MathShape.sphere(0.078, deep, segments: 10), x, 0.5, 0.01)
        }
        // The skirt, the breastplate, the shoulders.
        n.add(MathShape.cone(0.25, 0.18, 0.2, deep, segments: 12), 0, 0.9, 0)
        n.add(MathShape.cylinder(0.19, 0.04, gold), 0, 1.0, 0)
        n.add(MathShape.cone(0.17, 0.25, 0.42, steel, segments: 12), 0, 1.2, 0)
        n.add(squashed(MathShape.sphere(0.2, steel), 1.05, 0.9, 0.75), 0, 1.24, 0.06)
        n.add(alongZ(MathShape.cylinder(0.04, 0.02, gold, segments: 10)), 0, 1.26, 0.205)
        for x: Float in [-0.29, 0.29] { n.add(squashed(MathShape.sphere(0.11, deep, segments: 10), 1, 0.8, 1), x, 1.4, 0) }
        // One arm at its side.
        n.add(MathShape.cylinder(0.05, 0.5, steel, segments: 8), -0.31, 1.13, 0)
        n.add(MathShape.sphere(0.065, deep, segments: 8), -0.31, 0.86, 0)
        // The other crooked round a halberd, taller than it is.
        let elbow = V(0.34, 1.12, 0.04), fist = V(0.36, 1.18, 0.25)
        n.addChildNode(rod(V(0.3, 1.38, 0), elbow, 0.05, steel))
        n.addChildNode(rod(elbow, fist, 0.05, steel))
        n.add(MathShape.sphere(0.06, deep, segments: 8), elbow.x, elbow.y, elbow.z)
        n.add(MathShape.sphere(0.07, deep, segments: 8), fist.x, fist.y, fist.z)
        n.add(cyl(0.018, 1.66, "7a4a28", segments: 6), 0.36, 0.89, 0.25)
        n.add(MathShape.cone(0.03, 0, 0.2, steel, segments: 8), 0.36, 1.8, 0.25)
        n.add(plate([(0, 0.07), (0.15, 0.16), (0.18, 0), (0.15, -0.16), (0, -0.07)], 0.012, steel), 0.37, 1.58, 0.25)
        n.add(plate([(0, 0.04), (-0.1, 0), (0, -0.04)], 0.012, steel), 0.35, 1.58, 0.25)
        // The helmet: a slit to see out of, something looking out of it, and a plume.
        n.add(MathShape.cylinder(0.06, 0.06, deep, segments: 8), 0, 1.44, 0)
        n.add(squashed(MathShape.sphere(0.14, steel), 1, 1.12, 1.05), 0, 1.59, 0)
        n.add(box(0.2, 0.03, 0.03, "101014"), 0, 1.6, 0.135)
        n.add(MathShape.box(0.025, 0.15, 0.03, deep), 0, 1.54, 0.14)
        for x: Float in [-0.05, 0.05] { n.add(MathShape.sphere(0.012, m("ff6a3a", glow: 1), segments: 6), x, 1.6, 0.147) }
        n.add(squashed(ball(0.07, "d6263a", segments: 10), 0.5, 1.5, 1.6), 0, 1.78, -0.04)
        return n
    }

    private static func portal() -> SCNNode {
        let n = SCNNode()
        // A ring of stones, every other one carved with something that glows.
        n.add(alongZ(tube(0.58, 0.8, 0.12, m("7d8590"), segments: 14)), 0, 0, 0.06)
        for i in 0..<10 {
            let t = Float(i) * .pi / 5
            let block = box(0.26, 0.2, 0.16, i % 2 == 0 ? "8d95a0" : "6b7380", round: 0.03)
            block.eulerAngles.z = t + .pi / 2
            n.add(block, cos(t) * 0.69, sin(t) * 0.69, 0.08)
            if i % 2 == 0 {
                let rune = MathShape.box(0.09, 0.05, 0.012, m("7df0ff", glow: 1))
                rune.eulerAngles.z = t + .pi / 2
                n.add(rune, cos(t) * 0.69, sin(t) * 0.69, 0.162)
            }
        }
        // What's through it, going round.
        let swirl = MathMat.drawn("house-fun-portal", 256, 256, glow: 1) { c, size in
            let W = size.width, mid = W / 2
            c.fill("1a0f3a", CGRect(origin: .zero, size: size))
            for (hex, r) in [("2a1a6a", CGFloat(0.5)), ("4a2aa0", 0.38), ("7a4ae0", 0.26), ("b08aff", 0.14)] { disc(c, hex, mid, mid, W * r) }
            for arm in 0..<6 {
                var curl: [(CGFloat, CGFloat)] = []
                for k in 0...40 {
                    let along = CGFloat(k) / 40
                    let a = CGFloat(arm) * .pi / 3 + along * 4.5
                    curl.append((mid + cos(a) * W * 0.5 * along, mid + sin(a) * W * 0.5 * along))
                }
                stroke(c, arm % 2 == 0 ? "7df0ff" : "ff7af0", arm % 2 == 0 ? 7 : 4)
                line(c, curl)
            }
            for p in scatter(30, seed: 91) { disc(c, "ffffff", p.0 * W, p.1 * W, 1 + p.2 * 2) }
            disc(c, "f3e6ff", mid, mid, W * 0.07)
        }
        let turning = SCNNode()
        turning.addChildNode(alongZ(capped(0.6, 0.02, side: m("1a0f3a"), top: swirl, segments: 28)))
        n.add(turning, 0, 0, 0.03)
        turning.runAction(.repeatForever(.rotateBy(x: 0, y: 0, z: .pi * 2, duration: 12)))
        let heart = SCNNode()
        heart.addChildNode(squashed(MathShape.sphere(0.11, m("f3e6ff", glow: 1), segments: 12), 1, 1, 0.15))
        n.add(heart, 0, 0, 0.05)
        heart.runAction(.repeatForever(.sequence([.scale(to: 1.4, duration: 1.8), .scale(to: 0.8, duration: 1.8)])))
        return n
    }

    private static func secretBookcase() -> SCNNode {
        let n = SCNNode()
        let wood = "5a3422", dark = "3a2218"
        // The way through, behind: dark, a stair going down, a light from somewhere below, and somebody looking back.
        let gap = MathMat.drawn("house-fun-secret-gap", 128, 224, glow: 0.8) { c, size in
            let W = size.width, H = size.height
            c.fill("07060e", CGRect(origin: .zero, size: size))
            c.setAlpha(0.5); disc(c, "1f8a6a", W * 0.5, H * 0.95, W * 0.7); c.setAlpha(1)
            disc(c, "3fe0a0", W * 0.5, H * 1.02, W * 0.4)
            for i in 0..<5 {
                let y = H * (0.62 + 0.07 * CGFloat(i)), inset = W * (0.3 - 0.05 * CGFloat(i))
                c.fill(i % 2 == 0 ? "1a1730" : "24203f", CGRect(x: inset, y: y, width: W - inset * 2, height: H * 0.07))
            }
            disc(c, "ffe14a", W * 0.6, H * 0.34, 3.5); disc(c, "ffe14a", W * 0.72, H * 0.34, 3.5)
        }
        n.add(MathShape.card(1.2, 2.02, gap), 0, 1.01, -0.19)
        for x: Float in [-0.64, 0.64] { n.add(box(0.08, 2.1, 0.1, dark), x, 1.05, -0.15) }
        n.add(box(1.2, 0.08, 0.1, dark), 0, 2.06, -0.15)
        let spill = MathShape.box(0.5, 0.004, 0.5, m("7dffb0", glow: 1, alpha: 0.3))
        spill.castsShadow = false
        n.add(spill, 0.32, 0.003, 0.12)
        spill.runAction(.repeatForever(.sequence([.fadeOpacity(to: 0.4, duration: 2), .fadeOpacity(to: 1, duration: 2)])))
        // The bookcase itself, swung out on its hinge at the left.
        let door = SCNNode()
        door.add(box(1.2, 2.06, 0.03, dark), 0.6, 1.03, 0.015)
        for x: Float in [0.03, 1.17] { door.add(box(0.06, 2.06, 0.3, wood), x, 1.03, 0.15) }
        door.add(box(1.2, 0.06, 0.3, wood), 0.6, 2.03, 0.15)
        door.add(box(1.2, 0.1, 0.3, wood), 0.6, 0.05, 0.15)
        var rng = MathRNG(seed: 33)
        for i in 0..<5 {
            let y = 0.1 + Float(i) * 0.38
            if i > 0 { door.add(box(1.08, 0.03, 0.27, wood), 0.6, y - 0.015, 0.15) }
            books(in: door, from: 0.07, to: 1.13, y: y, z: 0.27, deep: 0.2, tall: 0.31, rng: &rng)
        }
        // The one book that isn't a book: pull it, and this is what happens.
        let lever = MathShape.box(0.05, 0.26, 0.18, m("d6263a", glow: 0.4))
        lever.eulerAngles.x = 0.5
        door.add(lever, 0.95, 1.4, 0.3)
        n.add(door, -0.6, 0, -0.15, ry: -0.5)
        return n
    }
}
