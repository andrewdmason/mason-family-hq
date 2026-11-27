import SceneKit
import UIKit

// What the house's things look like. The furniture is Kenney's Furniture Kit
// and the pets his Cube Pets (public domain: see MathAssets/models/CREDITS.txt),
// loaded the way Math loads its models. Everything flat (rugs, floors,
// pictures, windows) is drawn here in code, and so are the few things no kit
// has: the arcade cabinet, the telescope, the door in the basement. So is the
// outside of the house: its roof, what its walls are clad in, its front door,
// and what's on the roof and the lawn.
//
// A kit model's parts are named for what they're made of ("wood", "carpet",
// "lamp"), which is how a room's wood and cloth can be any colour, and how a
// lamp can be on (`finish`).

enum HouseProps {
    /// The furniture kit is made small: this is what it's grown by to suit a room four metres across.
    static let kitScale: Float = 2.0

    private static func ui(_ hex: String) -> UIColor { MathLookKit.color(hex) }

    // MARK: Models

    private static var extents: [String: (SIMD3<Float>, SIMD3<Float>)] = [:]

    /// The corners of everything under a node, in its parent's space, worked
    /// out from the vertices themselves. (SceneKit's own bounding box is
    /// empty for a model until it's first been drawn.)
    static func extent(of node: SCNNode, in space: simd_float4x4 = matrix_identity_float4x4) -> (lo: SIMD3<Float>, hi: SIMD3<Float>)? {
        let here = space * node.simdTransform
        var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = -lo, any = false
        for source in node.geometry?.sources(for: .vertex) ?? [] where source.usesFloatComponents && source.componentsPerVector >= 3 && source.bytesPerComponent == 4 {
            source.data.withUnsafeBytes { raw in
                for i in 0..<source.vectorCount {
                    let at = source.dataOffset + i * source.dataStride
                    guard at + 12 <= raw.count else { break }
                    let v = SIMD3(raw.loadUnaligned(fromByteOffset: at, as: Float.self), raw.loadUnaligned(fromByteOffset: at + 4, as: Float.self),
                                  raw.loadUnaligned(fromByteOffset: at + 8, as: Float.self))
                    let p = here * SIMD4(v, 1)
                    lo = simd_min(lo, SIMD3(p.x, p.y, p.z)); hi = simd_max(hi, SIMD3(p.x, p.y, p.z))
                    any = true
                }
            }
        }
        for child in node.childNodes {
            if let (l, h) = extent(of: child, in: here) { lo = simd_min(lo, l); hi = simd_max(hi, h); any = true }
        }
        return any ? (lo, hi) : nil
    }

    private static var templates: [String: SCNNode] = [:]

    /// A copy of a model with its parts as the file has them, sharing their
    /// geometry. Not Math's one-mesh copy (MathModels.prop): flattening
    /// loses the size of a scaled part, and a bed's cover is one.
    private static func model(_ path: String) -> SCNNode? {
        if let hit = templates[path] { return hit.clone() }
        guard let glb = MathModels.file(path) else { return nil }
        let node = glb.sceneNode()
        templates[path] = node
        return node.clone()
    }

    /// A model's corners as it's made, before any scaling.
    private static func measure(_ path: String) -> (SIMD3<Float>, SIMD3<Float>)? {
        if let hit = extents[path] { return hit }
        guard let node = model(path), let found = extent(of: node) else { return nil }
        extents[path] = found
        return found
    }

    /// How wide, tall and deep a kit model is, scaled.
    static func size(_ name: String, folder: String = "furniture", scale: Float = kitScale) -> SIMD3<Float> {
        guard let (lo, hi) = measure("\(folder)/\(name)") else { return SIMD3(0.8, 0.8, 0.8) }
        return (hi - lo) * scale
    }

    /// A kit model at the house's scale, standing on the floor with its middle over the origin.
    static func kit(_ name: String, folder: String = "furniture", scale: Float = kitScale) -> SCNNode {
        let holder = SCNNode()
        let path = "\(folder)/\(name)"
        guard let (lo, hi) = measure(path), let model = model(path) else {
            // A model that isn't in this build: a plain block where it would stand.
            holder.add(MathShape.box(0.8, 0.8, 0.8, MathMat.color("c9c2b2"), round: 0.06), 0, 0.4, 0)
            return holder
        }
        model.scale = SCNVector3(scale, scale, scale)
        model.position = SCNVector3(-(lo.x + hi.x) / 2 * scale, -lo.y * scale, -(lo.z + hi.z) / 2 * scale)
        holder.addChildNode(model)
        return holder
    }

    /// One kit model standing on another.
    static func stack(_ base: String, _ on: String) -> SCNNode {
        let holder = kit(base)
        let upper = kit(on)
        holder.add(upper, 0, size(base).y, 0)
        return holder
    }

    static func pet(_ name: String) -> SCNNode {
        let holder = kit(name, folder: "pets", scale: 1)
        // Whatever size the pack makes them, a pet comes up to about the knee.
        let height = max(0.01, size(name, folder: "pets", scale: 1).y)
        let s = 0.62 / height
        holder.scale = SCNVector3(s, s, s)
        let wrap = SCNNode()
        wrap.addChildNode(holder)
        // It breathes, and now and then hops.
        let bob = SCNAction.sequence([.scale(to: 1.04, duration: 0.9), .scale(to: 1, duration: 0.9)])
        bob.timingMode = .easeInEaseOut
        wrap.runAction(.repeatForever(bob))
        let hop = SCNAction.sequence([.wait(duration: 4, withRange: 5), .moveBy(x: 0, y: 0.22, z: 0, duration: 0.16), .moveBy(x: 0, y: -0.22, z: 0, duration: 0.18),
                                      .rotateBy(x: 0, y: .pi / 2, z: 0, duration: 0.3)])
        holder.runAction(.repeatForever(hop))
        return wrap
    }

    // MARK: Wood, cloth and lamps

    private static var refinished: [String: SCNGeometry] = [:]

    /// A part's shape in another material. (A model's copies share their shapes, so the part gets one of its own.)
    private static func part(_ geometry: SCNGeometry, in material: SCNMaterial) -> SCNGeometry {
        let key = "\(ObjectIdentifier(geometry).hashValue)|\(ObjectIdentifier(material).hashValue)"
        if let hit = refinished[key] { return hit }
        guard let made = geometry.copy() as? SCNGeometry else { return geometry }
        made.materials = [material]
        refinished[key] = made
        return made
    }

    /// The shade of a lamp that's on.
    private static let shade = MathMat.color("ffe9a0", glow: 1)

    /// Make a thing its room's own: its wood and its cloth the colours
    /// chosen (nil: as the kit has them), and, `lit`, its lamp on. Whatever
    /// light it gives falls only on what's in `category`, the room it's in,
    /// so a house full of lamps is no more for any one thing to be lit by.
    static func finish(_ thing: SCNNode, wood: (main: SCNMaterial, dark: SCNMaterial)?, fabric: SCNMaterial?, lit: Bool, category: Int) {
        var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = -lo, lamp = false
        func walk(_ node: SCNNode, _ space: simd_float4x4) {
            if let geometry = node.geometry, let name = geometry.firstMaterial?.name {
                switch name {
                case "wood": if let wood { node.geometry = part(geometry, in: wood.main) }
                case "woodDark": if let wood { node.geometry = part(geometry, in: wood.dark) }
                case "carpet", "carpetBlue": if let fabric { node.geometry = part(geometry, in: fabric) }
                case "lamp":
                    guard lit else { break }
                    if let (l, h) = extent(of: node, in: space) { lo = simd_min(lo, l); hi = simd_max(hi, h); lamp = true }
                    node.geometry = part(geometry, in: shade)
                default: break
                }
            }
            let here = space * node.simdTransform
            for child in node.childNodes { walk(child, here) }
        }
        for child in thing.childNodes { walk(child, matrix_identity_float4x4) }
        if lamp {
            let light = SCNNode()
            light.light = SCNLight()
            light.light?.type = .omni
            light.light?.color = UIColor(red: 1, green: 0.8, blue: 0.52, alpha: 1)
            light.light?.intensity = 950
            light.light?.attenuationStartDistance = 0.8
            light.light?.attenuationEndDistance = 6
            light.simdPosition = (lo + hi) / 2
            thing.addChildNode(light)
        }
        // And what light it had already: a campfire's, a bare bulb's.
        thing.enumerateHierarchy { node, _ in node.light?.categoryBitMask = category }
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

    private static func poly(_ c: CGContext, _ hex: String, _ points: [(CGFloat, CGFloat)]) {
        guard let first = points.first else { return }
        c.setFillColor(ui(hex).cgColor)
        c.move(to: CGPoint(x: first.0, y: first.1))
        for p in points.dropFirst() { c.addLine(to: CGPoint(x: p.0, y: p.1)) }
        c.closePath()
        c.fillPath()
    }

    private static func line(_ c: CGContext, _ points: [(CGFloat, CGFloat)]) {
        guard let first = points.first else { return }
        c.move(to: CGPoint(x: first.0, y: first.1))
        for p in points.dropFirst() { c.addLine(to: CGPoint(x: p.0, y: p.1)) }
        c.strokePath()
    }

    private static func text(_ s: String, _ hex: String, _ size: CGFloat, in rect: CGRect) {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size, weight: .black), .foregroundColor: ui(hex), .paragraphStyle: style]
        let height = (s as NSString).boundingRect(with: rect.size, options: .usesLineFragmentOrigin, attributes: attrs, context: nil).height
        (s as NSString).draw(in: CGRect(x: rect.minX, y: rect.midY - height / 2, width: rect.width, height: height), withAttributes: attrs)
    }

    /// The same scatter every time, for stars and flowers.
    private static func scatter(_ n: Int, seed: UInt64) -> [(CGFloat, CGFloat, CGFloat)] {
        var rng = MathRNG(seed: seed)
        return (0..<n).map { _ in (CGFloat(rng.unit()), CGFloat(rng.unit()), CGFloat(rng.unit())) }
    }

    // MARK: Floors and walls

    static func floorMaterial(_ pattern: String, _ a: String, _ b: String) -> SCNMaterial {
        MathMat.drawn("house-floor-\(pattern)-\(a)-\(b)", 512, 512) { c, size in
            let w = size.width
            c.fill(a, CGRect(origin: .zero, size: size))
            switch pattern {
            case "boards":
                stroke(c, b, 5)
                for i in 0...8 {
                    let y = CGFloat(i) * w / 8
                    line(c, [(0, y), (w, y)])
                    // Board ends, staggered row by row.
                    for j in 0..<3 { let x = (CGFloat(j) + (i % 2 == 0 ? 0.3 : 0.75)) * w / 3; line(c, [(x, y), (x, y + w / 8)]) }
                }
            case "parquet":
                stroke(c, b, 4)
                let s = w / 8
                for i in 0..<8 { for j in 0..<8 {
                    let x = CGFloat(i) * s, y = CGFloat(j) * s
                    if (i + j) % 2 == 0 { for k in 1..<3 { line(c, [(x, y + CGFloat(k) * s / 3), (x + s, y + CGFloat(k) * s / 3)]) } }
                    else { for k in 1..<3 { line(c, [(x + CGFloat(k) * s / 3, y), (x + CGFloat(k) * s / 3, y + s)]) } }
                    c.stroke(CGRect(x: x, y: y, width: s, height: s))
                } }
            case "checker":
                let s = w / 8
                for i in 0..<8 { for j in 0..<8 where (i + j) % 2 == 1 { c.fill(b, CGRect(x: CGFloat(i) * s, y: CGFloat(j) * s, width: s, height: s)) } }
            case "tiles":
                stroke(c, b, 6)
                for i in 0...6 { let p = CGFloat(i) * w / 6; line(c, [(p, 0), (p, w)]); line(c, [(0, p), (w, p)]) }
            case "zigzag":
                let rows = 10, s = w / CGFloat(rows)
                for r in 0..<rows where r % 2 == 0 {
                    var points: [(CGFloat, CGFloat)] = []
                    for i in 0...16 { points.append((CGFloat(i) * w / 16, CGFloat(r) * s + (i % 2 == 0 ? 0 : s))) }
                    for i in (0...16).reversed() { points.append((CGFloat(i) * w / 16, CGFloat(r + 1) * s + (i % 2 == 0 ? 0 : s))) }
                    poly(c, b, points)
                }
            case "arcade":
                for (i, p) in scatter(46, seed: 7).enumerated() {
                    let hues = ["ff3fa4", "3fe0ff", "ffe14a", "7dff3a"]
                    let hue = hues[i % 4], x: CGFloat = p.0 * w, y: CGFloat = p.1 * w, r: CGFloat = 10 + p.2 * 16
                    switch i % 3 {
                    case 0: disc(c, hue, x, y, r * 0.6)
                    case 1: poly(c, hue, [(x, y - r), (x + r, y + r), (x - r, y + r)])
                    default: stroke(c, hue, 6); line(c, [(x - r, y), (x - r / 3, y - r / 2), (x + r / 3, y + r / 2), (x + r, y)])
                    }
                }
            case "stars":
                for p in scatter(120, seed: 11) { disc(c, b, p.0 * w, p.1 * w, 1 + p.2 * 3.5) }
            case "grass", "meadow":
                for p in scatter(260, seed: 3) { disc(c, b, p.0 * w, p.1 * w, 5 + p.2 * 9) }
                if pattern == "meadow" {
                    for (i, p) in scatter(60, seed: 5).enumerated() {
                        disc(c, ["ffffff", "f4d04a", "f08ab0"][i % 3], p.0 * w, p.1 * w, 5)
                        disc(c, "f4d04a", p.0 * w, p.1 * w, 2)
                    }
                }
            default: // carpet: a soft speckle
                for p in scatter(500, seed: 9) { disc(c, b, p.0 * w, p.1 * w, 2 + p.2 * 2) }
            }
        }
    }

    /// A wall's inside face: its colour, with a skirting board along the bottom.
    static func wallMaterial(_ a: String, _ b: String) -> SCNMaterial {
        MathMat.drawn("house-wall-\(a)-\(b)", 256, 256) { c, size in
            c.fill(a, CGRect(origin: .zero, size: size))
            // The star chart's walls have stars; nothing else's second colour is that light.
            if a == "101638" { for p in scatter(70, seed: 21) { disc(c, b, p.0 * size.width, p.1 * size.height * 0.9, 1 + p.2 * 2.5) } }
            else { c.fill(b, CGRect(x: 0, y: size.height * 0.92, width: size.width, height: size.height * 0.08)) }
        }
    }

    // MARK: Rugs

    static func rug(_ pattern: String, _ a: String, _ b: String) -> SCNNode {
        let round = ["round", "space", "target"].contains(pattern)
        let width: Float = pattern == "stripes" ? 2.3 : pattern == "hatch" ? 1.1 : 1.9, length: Float = pattern == "stripes" ? 1.3 : pattern == "pitch" ? 1.3 : pattern == "hatch" ? 1.1 : 1.9
        let material = MathMat.drawn("house-rug-\(pattern)-\(a)-\(b)", 256, 256, clear: true) { c, size in
            let w = size.width
            if round { c.addEllipse(in: CGRect(origin: .zero, size: size)) } else { c.addPath(UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 14).cgPath) }
            c.clip()
            c.fill(a, CGRect(origin: .zero, size: size))
            switch pattern {
            case "stripes":
                for i in 0..<8 where i % 2 == 1 { c.fill(b, CGRect(x: CGFloat(i) * w / 8, y: 0, width: w / 8, height: w)) }
            case "check":
                let s = w / 6
                for i in 0..<6 { for j in 0..<6 where (i + j) % 2 == 1 { c.fill(b, CGRect(x: CGFloat(i) * s, y: CGFloat(j) * s, width: s, height: s)) } }
            case "zigzag":
                stroke(c, b, 14)
                for r in 0..<7 {
                    var zig: [(CGFloat, CGFloat)] = []
                    for i in 0...8 { zig.append((CGFloat(i) * w / 8, CGFloat(r) * w / 6 + (i % 2 == 0 ? 0 : w / 9))) }
                    line(c, zig)
                }
            case "target":
                disc(c, b, w / 2, w / 2, w * 0.36); disc(c, a, w / 2, w / 2, w * 0.24); disc(c, b, w / 2, w / 2, w * 0.11)
            case "space":
                stroke(c, "ffffff", 2)
                for r in [0.2, 0.3, 0.4, 0.47] { c.strokeEllipse(in: CGRect(x: w / 2 - w * r, y: w / 2 - w * r, width: w * r * 2, height: w * r * 2)) }
                disc(c, b, w / 2, w / 2, w * 0.1)
                let planets: [(Double, Double, String)] = [(0.2, 0.3, "e07a3c"), (0.3, 2.1, "7ac0e0"), (0.4, 4.0, "c98ae0"), (0.47, 5.3, "8fe07a")]
                for (i, p) in planets.enumerated() {
                    let px: CGFloat = w / 2 + CGFloat(cos(p.1) * p.0) * w, py: CGFloat = w / 2 + CGFloat(sin(p.1) * p.0) * w
                    disc(c, p.2, px, py, CGFloat(6 + i * 2))
                }
            case "pitch":
                stroke(c, b, 5)
                c.stroke(CGRect(x: 12, y: 12, width: w - 24, height: w - 24))
                line(c, [(w / 2, 12), (w / 2, w - 12)])
                c.strokeEllipse(in: CGRect(x: w / 2 - 34, y: w / 2 - 34, width: 68, height: 68))
                c.stroke(CGRect(x: 12, y: w / 2 - 50, width: 34, height: 100)); c.stroke(CGRect(x: w - 46, y: w / 2 - 50, width: 34, height: 100))
            case "hatch":
                c.fill(b, CGRect(x: 0, y: 0, width: w, height: w))
                c.fill(a, CGRect(x: 16, y: 16, width: w - 32, height: w - 32))
                stroke(c, b, 8); line(c, [(16, w / 2), (w - 16, w / 2)])
                disc(c, "c9a36b", w * 0.78, w * 0.3, 14); disc(c, a, w * 0.78, w * 0.3, 7)
            default: // round: a border and a middle
                disc(c, b, w / 2, w / 2, w * 0.38); disc(c, a, w / 2, w / 2, w * 0.3)
            }
        }
        let node = MathShape.floor(width, length, material)
        node.position.y = 0.012
        let holder = SCNNode()
        holder.addChildNode(node)
        return holder
    }

    // MARK: Pictures and windows

    /// A framed picture, facing +z, its middle at the origin.
    static func art(_ key: String, _ a: String, _ b: String) -> SCNNode {
        let wide = ["pinboard", "hills", "pennants", "lights", "pipes", "menu", "neon", "family"].contains(key)
        let w: Float = key == "lights" ? 3.2 : wide ? 1.7 : 1.0, h: Float = key == "lights" ? 0.7 : wide ? 1.0 : key == "clock" ? 1.0 : 1.3
        let bare = ["lights", "pennants", "pipes", "clock", "neon"].contains(key)
        let material = MathMat.drawn("house-art-\(key)-\(a)-\(b)", wide ? 384 : 256, key == "lights" ? 96 : 256, glow: ["neon", "lights", "hum"].contains(key) ? 0.9 : 0, clear: bare) { c, size in
            let W = size.width, H = size.height
            if !bare { c.fill(a, CGRect(origin: .zero, size: size)) }
            switch key {
            case "pinboard":
                let notes: [(CGFloat, CGFloat, String)] = [(0.1, 0.15, "f6f1e2"), (0.42, 0.1, "f7d76a"), (0.7, 0.2, "f6f1e2"), (0.2, 0.55, "f4a6c0"), (0.55, 0.5, "f6f1e2"), (0.8, 0.6, "9fd3f0")]
                for (i, p) in notes.enumerated() {
                    c.fill(p.2, CGRect(x: W * p.0, y: H * p.1, width: W * 0.17, height: H * 0.28))
                    disc(c, i % 2 == 0 ? "d6263a" : "2e86c1", W * p.0 + W * 0.085, H * p.1 + 8, 6)
                }
            case "shark":
                c.fill("1f4f73", CGRect(x: 0, y: H * 0.62, width: W, height: H * 0.38))
                poly(c, "5d6b78", [(W * 0.5, H * 0.18), (W * 0.72, H * 0.64), (W * 0.3, H * 0.64)])
                stroke(c, b, 5); line(c, [(W * 0.1, H * 0.7), (W * 0.3, H * 0.66), (W * 0.5, H * 0.7), (W * 0.7, H * 0.66), (W * 0.9, H * 0.7)])
                text("JAWZ", b, 34, in: CGRect(x: 0, y: H * 0.76, width: W, height: H * 0.2))
            case "rocket":
                for p in scatter(30, seed: 4) { disc(c, "ffffff", p.0 * W, p.1 * H, 1 + p.2 * 2) }
                poly(c, "f3ead2", [(W * 0.5, H * 0.12), (W * 0.62, H * 0.4), (W * 0.62, H * 0.7), (W * 0.38, H * 0.7), (W * 0.38, H * 0.4)])
                poly(c, b, [(W * 0.38, H * 0.55), (W * 0.24, H * 0.76), (W * 0.38, H * 0.7)]); poly(c, b, [(W * 0.62, H * 0.55), (W * 0.76, H * 0.76), (W * 0.62, H * 0.7)])
                disc(c, "7ac0e0", W * 0.5, H * 0.42, W * 0.06)
                poly(c, "ffcf33", [(W * 0.42, H * 0.7), (W * 0.58, H * 0.7), (W * 0.5, H * 0.94)])
            case "eyes":
                // A face with nothing in it but the eyes. The pupils are separate, and move (HouseScene).
                c.addEllipse(in: CGRect(x: W * 0.22, y: H * 0.14, width: W * 0.56, height: H * 0.6)); c.setFillColor(ui(b).cgColor); c.fillPath()
                poly(c, "3a2a22", [(W * 0.12, H), (W * 0.3, H * 0.72), (W * 0.7, H * 0.72), (W * 0.88, H)])
                c.setFillColor(UIColor.white.cgColor)
                c.fillEllipse(in: CGRect(x: W * 0.3, y: H * 0.34, width: W * 0.16, height: H * 0.09)); c.fillEllipse(in: CGRect(x: W * 0.54, y: H * 0.34, width: W * 0.16, height: H * 0.09))
            case "hills":
                poly(c, b, [(0, H), (0, H * 0.6), (W * 0.25, H * 0.42), (W * 0.5, H * 0.62), (W * 0.75, H * 0.38), (W, H * 0.58), (W, H)])
                poly(c, "4f8a45", [(0, H), (0, H * 0.8), (W * 0.4, H * 0.62), (W, H * 0.82), (W, H)])
                disc(c, "fff3b0", W * 0.82, H * 0.2, 22)
            case "sun":
                disc(c, b, W / 2, H * 0.62, W * 0.3)
                c.fill("7a3a2a", CGRect(x: 0, y: H * 0.62, width: W, height: H * 0.38))
                stroke(c, a, 6); for i in 0..<4 { line(c, [(W * 0.2, H * (0.7 + 0.07 * CGFloat(i))), (W * 0.8, H * (0.7 + 0.07 * CGFloat(i)))]) }
            case "family":
                let across: [CGFloat] = [0.14, 0.3, 0.46, 0.62, 0.78], heights: [CGFloat] = [0.5, 0.42, 0.56, 0.6, 0.36]
                for (i, x) in across.enumerated() {
                    let tall = heights[i]
                    // The last one has no face.
                    c.fill(i == 4 ? "20242c" : ["2e5f8f", "8f3a3a", "3f6b45", "6b4f8f", ""][i], CGRect(x: W * (x - 0.06), y: H * (1 - tall), width: W * 0.12, height: H * tall))
                    disc(c, i == 4 ? "20242c" : "f0c8a8", W * x, H * (1 - tall) - 16, 18)
                }
            case "clock":
                disc(c, b, W / 2, H / 2, W * 0.46); disc(c, a, W / 2, H / 2, W * 0.4)
                for i in 0..<12 { let t = CGFloat(i) * .pi / 6; disc(c, b, W / 2 + cos(t) * W * 0.33, H / 2 + sin(t) * W * 0.33, i % 3 == 0 ? 7 : 4) }
            case "menu":
                stroke(c, b, 5)
                text("TODAY", b, 40, in: CGRect(x: 0, y: H * 0.05, width: W, height: H * 0.25))
                for i in 0..<4 { line(c, [(W * 0.14, H * (0.4 + 0.13 * CGFloat(i))), (W * (i == 3 ? 0.5 : 0.86), H * (0.4 + 0.13 * CGFloat(i)))]) }
            case "fruit":
                c.fill("b98a5a", CGRect(x: 0, y: H * 0.68, width: W, height: H * 0.32))
                disc(c, "c9d65a", W * 0.3, H * 0.56, 34); disc(c, b, W * 0.52, H * 0.6, 30); disc(c, b, W * 0.7, H * 0.58, 30); disc(c, "f4d04a", W * 0.86, H * 0.64, 20)
            case "fish":
                c.addEllipse(in: CGRect(x: W * 0.2, y: H * 0.36, width: W * 0.5, height: H * 0.28)); c.setFillColor(ui(b).cgColor); c.fillPath()
                poly(c, b, [(W * 0.66, H * 0.5), (W * 0.88, H * 0.34), (W * 0.88, H * 0.66)])
                disc(c, "ffffff", W * 0.32, H * 0.46, 9); disc(c, "101010", W * 0.31, H * 0.46, 4)
            case "hum":
                stroke(c, b, 5)
                for r in 0..<5 {
                    let base: CGFloat = H * (0.2 + 0.15 * CGFloat(r))
                    var wave: [(CGFloat, CGFloat)] = []
                    for i in 0...24 { wave.append((W * CGFloat(i) / 24, base + CGFloat(sin(Double(i) * 1.3 + Double(r))) * 12)) }
                    line(c, wave)
                }
            case "football":
                stroke(c, b, 5); line(c, [(0, H * 0.7), (W, H * 0.7)])
                c.stroke(CGRect(x: W * 0.2, y: H * 0.25, width: W * 0.6, height: H * 0.45))
                disc(c, "ffffff", W * 0.62, H * 0.42, 22); disc(c, "20242c", W * 0.62, H * 0.42, 8)
            case "ufo":
                for p in scatter(26, seed: 8) { disc(c, "ffffff", p.0 * W, p.1 * H * 0.6, 1 + p.2 * 2) }
                c.setAlpha(0.3); poly(c, "7dff3a", [(W * 0.4, H * 0.42), (W * 0.6, H * 0.42), (W * 0.82, H), (W * 0.18, H)]); c.setAlpha(1)
                c.addEllipse(in: CGRect(x: W * 0.2, y: H * 0.3, width: W * 0.6, height: H * 0.14)); c.setFillColor(ui("b9c2cc").cgColor); c.fillPath()
                disc(c, b, W * 0.5, H * 0.3, W * 0.14)
            case "void":
                c.fill("000000", CGRect(origin: .zero, size: size))
            case "pennants":
                stroke(c, "6b4f1d", 4); line(c, [(0, 20), (W, 44)])
                for i in 0..<5 {
                    let x: CGFloat = W * (0.06 + 0.19 * CGFloat(i)), y: CGFloat = 22 + CGFloat(i) * 5
                    let tip: (CGFloat, CGFloat) = (x + W * 0.075, y + H * 0.55), far: (CGFloat, CGFloat) = (x + W * 0.15, y + 4)
                    poly(c, i % 2 == 0 ? a : b, [(x, y), far, tip])
                }
            case "neon":
                stroke(c, b, 12); c.stroke(CGRect(x: 18, y: H * 0.22, width: W - 36, height: H * 0.56))
                text("OPEN", b, 92, in: CGRect(x: 0, y: H * 0.2, width: W, height: H * 0.6))
            case "lights":
                stroke(c, "3a3a3a", 3)
                var wire: [(CGFloat, CGFloat)] = []
                for i in 0...12 { wire.append((W * CGFloat(i) / 12, i % 2 == 0 ? 12 : 34)) }
                line(c, wire)
                let bulbs = [b, "ff9a7a", "9fe0ff"]
                for i in 0...12 { disc(c, bulbs[i % 3], W * CGFloat(i) / 12, i % 2 == 0 ? 26 : 48, 11) }
            case "flag":
                c.fill(b, CGRect(x: 0, y: H * 0.36, width: W, height: H * 0.28))
                disc(c, "20242c", W * 0.5, H * 0.5, 30); disc(c, b, W * 0.5, H * 0.5, 12)
            case "pipes":
                stroke(c, a, 26); line(c, [(0, H * 0.2), (W * 0.6, H * 0.2), (W * 0.6, H * 0.8), (W, H * 0.8)])
                stroke(c, b, 18); line(c, [(0, H * 0.55), (W * 0.3, H * 0.55), (W * 0.3, H), ])
                disc(c, "d6263a", W * 0.6, H * 0.5, 22)
            default: break
            }
        }
        let holder = SCNNode()
        if !bare { holder.add(MathShape.box(w + 0.14, h + 0.14, 0.06, MathMat.color(key == "eyes" || key == "family" ? "8a6a2f" : "3a2f2a")), 0, 0, 0.03) }
        holder.add(MathShape.card(w, h, material), 0, 0, 0.065)
        if key == "eyes" {
            // The pupils: a node of their own, so they can follow whoever's in the room.
            let pupils = SCNNode()
            pupils.name = "pupils"
            for x: Float in [-0.12, 0.12] { pupils.add(MathShape.cylinder(0.03, 0.01, MathMat.color("101010"), segments: 10), x, 0, 0).eulerAngles.x = .pi / 2 }
            holder.add(pupils, 0, 0.135, 0.075)
            pupils.runAction(.repeatForever(.sequence([.moveBy(x: 0.035, y: 0, z: 0, duration: 2.5), .wait(duration: 1.5), .moveBy(x: -0.07, y: 0, z: 0, duration: 3), .wait(duration: 2), .moveBy(x: 0.035, y: 0, z: 0, duration: 2)])))
        }
        if key == "clock" {
            let hand = SCNNode()
            hand.add(MathShape.box(0.035, 0.34, 0.01, MathMat.color(b)), 0, 0.15, 0)
            holder.add(hand, 0, 0, 0.08)
            // Backwards.
            hand.runAction(.repeatForever(.rotateBy(x: 0, y: 0, z: .pi * 2, duration: 12)))
        }
        return holder
    }

    /// A window, facing +z: a frame, and whatever's through it, which for
    /// most is the weather and the time of day outside.
    static func window(_ kind: String, _ outlook: HouseSky.Outlook = .day) -> SCNNode {
        let round = kind == "round" || kind == "sea"
        let w: Float = kind == "wide" ? 2.3 : round ? 1.1 : 1.3, h: Float = round ? 1.1 : 1.35
        // (The night window and the porthole show what they show whatever the hour.)
        let time = kind == "night" || kind == "sea" ? HouseSky.Outlook.day : outlook
        let material = MathMat.drawn("house-window-\(kind)-\(time.rawValue)", 256, 256, glow: kind == "night" ? 0.5 : 0.35, clear: round) { c, size in
            let W = size.width, H = size.height
            if round { c.addEllipse(in: CGRect(origin: .zero, size: size)); c.clip() }
            switch kind {
            case "night":
                c.fill("0d1230", CGRect(origin: .zero, size: size))
                for p in scatter(50, seed: 13) { disc(c, "fff3b0", p.0 * W, p.1 * H, 1 + p.2 * 3) }
                disc(c, "fff7d6", W * 0.72, H * 0.26, 26); disc(c, "0d1230", W * 0.66, H * 0.22, 22)
            case "frosted":
                c.fill(time == .day ? "dfeef2" : time == .dusk ? "e9c3a6" : "3d4a66", CGRect(origin: .zero, size: size))
                disc(c, time == .day ? "b9cfd6" : time == .dusk ? "c99a84" : "2c3750", W * 0.4, H * 0.7, 60)
                disc(c, time == .day ? "c9dde3" : time == .dusk ? "d9ad94" : "34405a", W * 0.66, H * 0.5, 40)
            case "sea":
                c.fill("1f6f9c", CGRect(origin: .zero, size: size))
                c.fill("12506f", CGRect(x: 0, y: H * 0.55, width: W, height: H * 0.45))
                for p in scatter(12, seed: 17) { disc(c, "9fe0ff", p.0 * W, p.1 * H, 4 + p.2 * 6) }
                c.addEllipse(in: CGRect(x: W * 0.3, y: H * 0.5, width: W * 0.36, height: H * 0.16)); c.setFillColor(ui("0a2f44").cgColor); c.fillPath()
            default:
                // The sky, what's in it, and the grass, for the time of day.
                let night = time == .night
                c.fill(time == .day ? "9fd6f2" : night ? "0d1230" : "f2a56c", CGRect(origin: .zero, size: size))
                if time == .dusk { c.fill("8f6fa8", CGRect(x: 0, y: 0, width: W, height: H * 0.22)); c.fill("c98a9a", CGRect(x: 0, y: H * 0.22, width: W, height: H * 0.14)) }
                if night {
                    for p in scatter(40, seed: 19) { disc(c, "fff3b0", p.0 * W, p.1 * H * 0.7, 1 + p.2 * 2.5) }
                    disc(c, "fff7d6", W * 0.26, H * 0.24, 22); disc(c, "0d1230", W * 0.21, H * 0.2, 19)
                } else {
                    let cloud = time == .day ? "ffffff" : "ffd9c2"
                    disc(c, cloud, W * 0.3, H * 0.3, 28); disc(c, cloud, W * 0.42, H * 0.34, 22); disc(c, cloud, W * 0.75, H * 0.2, 18)
                }
                c.fill(time == .day ? "7cbf5a" : night ? "24482f" : "6a9a4a", CGRect(x: 0, y: H * 0.72, width: W, height: H * 0.28))
                if kind == "wide" {
                    // The other house, over there; at night, with a light on.
                    c.fill(night ? "4a4f66" : "f3ead2", CGRect(x: W * 0.6, y: H * 0.5, width: W * 0.2, height: H * 0.24))
                    poly(c, night ? "5a2f2a" : "c1502e", [(W * 0.57, H * 0.5), (W * 0.7, H * 0.38), (W * 0.83, H * 0.5)])
                    if night { c.fill("ffd27a", CGRect(x: W * 0.66, y: H * 0.56, width: W * 0.07, height: H * 0.08)) }
                }
            }
        }
        let holder = SCNNode()
        let frame = MathMat.color("f6f1e2")
        if round {
            let ring = SCNNode(geometry: SCNTube(innerRadius: CGFloat(w / 2 - 0.02), outerRadius: CGFloat(w / 2 + 0.09), height: 0.08))
            ring.geometry?.materials = [kind == "sea" ? MathMat.color("b5733f") : frame]
            ring.eulerAngles.x = .pi / 2
            holder.add(ring, 0, 0, 0.04)
        } else {
            holder.add(MathShape.box(w + 0.18, h + 0.18, 0.07, frame), 0, 0, 0.035)
        }
        holder.add(MathShape.card(w, h, material), 0, 0, 0.075)
        if !round {
            holder.add(MathShape.box(0.05, h, 0.03, frame), 0, 0, 0.085)
            holder.add(MathShape.box(w, 0.05, 0.03, frame), 0, 0, 0.085)
            holder.add(MathShape.box(w + 0.3, 0.06, 0.16, frame), 0, -h / 2 - 0.09, 0.08)
        }
        return holder
    }

    // MARK: Things made here

    static func made(_ key: String) -> SCNNode {
        let n = SCNNode()
        switch key {
        case "mirror", "mirror-late":
            n.add(MathShape.box(0.95, 1.25, 0.06, MathMat.color(key == "mirror" ? "f6f1e2" : "5a4a3a")), 0, 0, 0.03)
            let glass = MathMat.drawn("house-mirror-\(key)", 128, 128, glow: 0.25) { c, size in
                c.fill(key == "mirror" ? "cfe6ee" : "9fb3c2", CGRect(origin: .zero, size: size))
                c.setAlpha(0.5); poly(c, "ffffff", [(size.width * 0.1, size.height * 0.6), (size.width * 0.5, 0), (size.width * 0.7, 0), (size.width * 0.1, size.height * 0.95)]); c.setAlpha(1)
                if key == "mirror-late" { disc(c, "5a6b78", size.width * 0.6, size.height * 0.5, 22); poly(c, "5a6b78", [(size.width * 0.38, size.height), (size.width * 0.6, size.height * 0.62), (size.width * 0.82, size.height)]) }
            }
            n.add(MathShape.card(0.8, 1.1, glass), 0, 0, 0.065)
        case "duck":
            let yellow = MathMat.color("ffd21f")
            n.add(MathShape.sphere(0.3, yellow, segments: 16), 0, 0.28, 0).scale = SCNVector3(1.15, 0.85, 1)
            n.add(MathShape.sphere(0.2, yellow, segments: 16), 0, 0.62, 0.14)
            n.add(MathShape.cone(0.07, 0.03, 0.14, MathMat.color("f08a3c")), 0, 0.6, 0.36).eulerAngles.x = .pi / 2
            for x: Float in [-0.08, 0.08] { n.add(MathShape.sphere(0.03, MathMat.color("101010"), segments: 8), x, 0.68, 0.3) }
        case "arcade":
            let body = MathMat.color("2a1f55"), trim = MathMat.color("ff3fa4")
            n.add(MathShape.box(0.9, 1.9, 0.8, body, round: 0.04), 0, 0.95, 0)
            n.add(MathShape.box(0.94, 0.3, 0.84, trim, round: 0.04), 0, 1.95, 0)
            let screen = MathMat.drawn("house-arcade-screen", 128, 128, glow: 0.9) { c, size in
                c.fill("0a0a1e", CGRect(origin: .zero, size: size))
                for (i, p) in scatter(14, seed: 2).enumerated() { c.fill(["7dff3a", "3fe0ff", "ffe14a"][i % 3], CGRect(x: p.0 * 110, y: p.1 * 70, width: 10, height: 8)) }
                c.fill("ffffff", CGRect(x: 56, y: 104, width: 18, height: 10))
            }
            n.add(MathShape.card(0.7, 0.6, screen), 0, 1.4, 0.405).eulerAngles.x = -0.2
            n.add(MathShape.box(0.9, 0.12, 0.35, MathMat.color("3fe0ff")), 0, 0.98, 0.5)
            n.add(MathShape.cylinder(0.025, 0.16, MathMat.color("101010")), -0.2, 1.1, 0.5)
            n.add(MathShape.sphere(0.05, MathMat.color("d6263a"), segments: 10), -0.2, 1.2, 0.5)
            for x: Float in [0.1, 0.25] { n.add(MathShape.cylinder(0.04, 0.03, MathMat.color("ffe14a")), x, 1.05, 0.5) }
        case "trophies":
            n.addChildNode(kit("bookcaseOpen"))
            let gold = MathMat.color("f5c542", glow: 0.25)
            for (i, y) in [Float(0.75), 1.4, 2.05].enumerated() {
                for x: Float in [-0.25, 0.25] where !(i == 2 && x > 0) {
                    n.add(MathShape.cone(0.06, 0.11, 0.2, gold), x, y + 0.16, 0)
                    n.add(MathShape.box(0.14, 0.06, 0.14, MathMat.color("3a2f2a")), x, y + 0.03, 0)
                }
            }
        case "globe":
            n.add(MathShape.cylinder(0.22, 0.05, MathMat.color("5a4032")), 0, 0.03, 0)
            n.add(MathShape.cylinder(0.03, 0.5, MathMat.color("b5733f")), 0, 0.3, 0)
            let land = MathMat.drawn("house-globe", 256, 128) { c, size in
                c.fill("2f7fb5", CGRect(origin: .zero, size: size))
                for p in scatter(9, seed: 31) { c.addEllipse(in: CGRect(x: p.0 * size.width, y: p.1 * size.height * 0.8, width: 30 + p.2 * 50, height: 18 + p.2 * 26)); c.setFillColor(ui("6fb05a").cgColor); c.fillPath() }
                disc(c, "d6263a", size.width * 0.62, size.height * 0.56, 9)
            }
            let ball = MathShape.sphere(0.34, land, segments: 20)
            ball.eulerAngles.z = 0.4
            n.add(ball, 0, 0.85, 0)
            ball.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 16)))
        case "flowers":
            n.add(MathShape.box(1.7, 0.16, 1.1, MathMat.color("7c5233"), round: 0.04), 0, 0.08, 0)
            n.add(MathShape.box(1.55, 0.05, 0.95, MathMat.color("4a3320")), 0, 0.17, 0)
            for (i, p) in scatter(14, seed: 41).enumerated() {
                let x = Float(p.0) * 1.3 - 0.65, z = Float(p.1) * 0.7 - 0.35
                n.add(MathShape.cylinder(0.015, 0.3, MathMat.color("3f8f4a"), segments: 6), x, 0.33, z)
                n.add(MathShape.sphere(0.08, MathMat.color(["d6263a", "f4d04a", "f08ab0", "ffffff"][i % 4]), segments: 8), x, 0.5, z)
            }
        case "pond":
            n.add(MathShape.cylinder(0.95, 0.1, MathMat.color("9a9c9f"), segments: 24), 0, 0.05, 0)
            n.add(MathShape.cylinder(0.82, 0.02, MathMat.color("3f9fd6", glow: 0.15), segments: 24), 0, 0.105, 0)
            n.add(MathShape.cylinder(0.14, 0.01, MathMat.color("4f9a45"), segments: 10), 0.3, 0.12, 0.2)
            // Whatever lives in it, going round.
            let swimmer = SCNNode()
            swimmer.add(MathShape.sphere(0.09, MathMat.color("f08a3c"), segments: 10), 0.5, 0.1, 0).scale = SCNVector3(1.6, 0.5, 0.8)
            n.addChildNode(swimmer)
            swimmer.runAction(.repeatForever(.rotateBy(x: 0, y: -.pi * 2, z: 0, duration: 9)))
        case "campfire":
            for i in 0..<8 { let t = Float(i) * .pi / 4; n.add(MathShape.sphere(0.13, MathMat.color("8a8c8f"), segments: 8), cos(t) * 0.5, 0.08, sin(t) * 0.5) }
            for t: Float in [0.3, 1.9] { let log = MathShape.cylinder(0.07, 0.7, MathMat.color("5a4032"), segments: 8); log.eulerAngles = SCNVector3(Float.pi / 2, t, 0); n.add(log, 0, 0.1, 0) }
            let flame = MathShape.cone(0.22, 0, 0.6, MathMat.color("ff9a2f", glow: 1), segments: 8)
            n.add(flame, 0, 0.42, 0)
            n.add(MathShape.cone(0.12, 0, 0.36, MathMat.color("ffe14a", glow: 1), segments: 8), 0, 0.34, 0)
            flame.runAction(.repeatForever(.sequence([.scale(to: 1.12, duration: 0.25), .scale(to: 0.92, duration: 0.2), .scale(to: 1.05, duration: 0.3)])))
            let light = SCNNode()
            light.light = SCNLight()
            light.light?.type = .omni
            light.light?.color = UIColor(red: 1, green: 0.6, blue: 0.25, alpha: 1)
            light.light?.intensity = 260
            light.light?.attenuationEndDistance = 4
            n.add(light, 0, 0.7, 0)
        case "gnome":
            n.add(MathShape.cone(0.2, 0.14, 0.4, MathMat.color("2e6fb5")), 0, 0.2, 0)
            n.add(MathShape.sphere(0.15, MathMat.color("f0c8a8"), segments: 12), 0, 0.5, 0)
            n.add(MathShape.cone(0.16, 0, 0.42, MathMat.color("d6263a")), 0, 0.8, 0)
            n.add(MathShape.sphere(0.13, MathMat.color("f4f4f4"), segments: 10), 0, 0.42, 0.08).scale = SCNVector3(1, 1.2, 0.7)
            // It turns to face somewhere else, a little, when nobody would notice.
            n.runAction(.repeatForever(.sequence([.wait(duration: 20, withRange: 20), .rotateBy(x: 0, y: 0.5, z: 0, duration: 0.01)])))
        case "door":
            n.add(MathShape.box(1.2, 2.3, 0.1, MathMat.color("3a2f2a")), 0, 0, 0.05)
            n.add(MathShape.box(1.0, 2.15, 0.06, MathMat.color("7a1f1f")), 0, -0.02, 0.1)
            n.add(MathShape.sphere(0.06, MathMat.color("f5c542", glow: 0.3), segments: 10), 0.36, -0.1, 0.16)
            // The light under it.
            let glow = MathShape.box(1.0, 0.05, 0.3, MathMat.color("ffd27a", glow: 1, alpha: 0.85))
            n.add(glow, 0, -1.12, 0.2)
            glow.runAction(.repeatForever(.sequence([.fadeOpacity(to: 0.35, duration: 2.2), .fadeOpacity(to: 1, duration: 1.6), .wait(duration: 3, withRange: 4)])))
        case "boxes":
            n.add(kit("cardboardBoxClosed"), 0, 0, 0)
            n.add(kit("cardboardBoxClosed"), 0.75, 0, 0.15, ry: 0.4)
            let upper = kit("cardboardBoxOpen")
            n.add(upper, 0.1, size("cardboardBoxClosed").y, 0.05, ry: -0.3)
        case "bulb":
            let swing = SCNNode()
            swing.add(MathShape.cylinder(0.012, 0.9, MathMat.color("20242c"), segments: 6), 0, -0.45, 0)
            swing.add(MathShape.sphere(0.11, MathMat.color("fff3b0", glow: 1), segments: 12), 0, -0.98, 0)
            let light = SCNNode()
            light.light = SCNLight()
            light.light?.type = .omni
            light.light?.color = UIColor(red: 1, green: 0.9, blue: 0.65, alpha: 1)
            light.light?.intensity = 300
            light.light?.attenuationEndDistance = 5
            swing.add(light, 0, -1.0, 0)
            n.addChildNode(swing)
            swing.eulerAngles.z = -0.12
            let sway = SCNAction.sequence([.rotateTo(x: 0, y: 0, z: 0.12, duration: 1.8), .rotateTo(x: 0, y: 0, z: -0.12, duration: 1.8)])
            sway.timingMode = .easeInEaseOut
            swing.runAction(.repeatForever(sway))
        case "telescope", "telescope-big":
            let big = key == "telescope-big", s: Float = big ? 1.5 : 1
            let brass = MathMat.color(big ? "f5c542" : "b5733f"), dark = MathMat.color("20242c")
            for i in 0..<3 {
                let t = Float(i) * .pi * 2 / 3
                let leg = MathShape.cylinder(0.03 * s, 1.2 * s, dark, segments: 6)
                leg.eulerAngles = SCNVector3(0.35 * cos(t), 0, 0.35 * sin(t))
                n.add(leg, sin(t) * 0.2 * s, 0.55 * s, -cos(t) * 0.2 * s)
            }
            let tube = SCNNode()
            tube.add(MathShape.cylinder(0.12 * s, 1.3 * s, brass, segments: 14), 0, 0, 0)
            tube.add(MathShape.cylinder(0.15 * s, 0.2 * s, dark, segments: 14), 0, 0.65 * s, 0)
            tube.add(MathShape.cylinder(0.06 * s, 0.25 * s, dark, segments: 10), 0, -0.75 * s, 0)
            tube.eulerAngles = SCNVector3(0, 0, -0.85)
            let head = SCNNode()
            head.addChildNode(tube)
            head.eulerAngles.y = 0.7
            n.add(head, 0, 1.2 * s, 0)
        default:
            n.add(MathShape.box(0.6, 0.6, 0.6, MathMat.color("c9c2b2"), round: 0.05), 0, 0.3, 0)
        }
        return n
    }

    // MARK: Outside the house

    /// What the walls are clad in outside, drawn for one whole face of a wall.
    static func cladding(_ pattern: String, _ a: String, _ b: String) -> SCNMaterial {
        MathMat.drawn("house-clad-\(pattern)-\(a)-\(b)", 512, 356) { c, size in
            let W = size.width, H = size.height
            c.fill(a, CGRect(origin: .zero, size: size))
            switch pattern {
            case "brick":
                c.fill(b, CGRect(origin: .zero, size: size))
                let rows = 12, across = 7
                let h = H / CGFloat(rows), w = W / CGFloat(across)
                for r in 0..<rows { for i in -1..<across {
                    let x = (CGFloat(i) + (r % 2 == 0 ? 0 : 0.5)) * w
                    c.fill(a, CGRect(x: x + 2, y: CGFloat(r) * h + 2, width: w - 4, height: h - 4))
                    // Not all quite the same.
                    if (r * 3 + i * 5) % 4 == 0 { c.setFillColor(UIColor.black.withAlphaComponent(0.1).cgColor); c.fill(CGRect(x: x + 2, y: CGFloat(r) * h + 2, width: w - 4, height: h - 4)) }
                } }
            case "stone":
                c.fill(b, CGRect(origin: .zero, size: size))
                let rows = 6, h = H / CGFloat(rows)
                var rng = MathRNG(seed: 37)
                for r in 0..<rows {
                    var x: CGFloat = r % 2 == 0 ? 0 : -40
                    while x < W {
                        let w = 60 + CGFloat(rng.unit()) * 70
                        c.addPath(UIBezierPath(roundedRect: CGRect(x: x + 3, y: CGFloat(r) * h + 3, width: w - 6, height: h - 6), cornerRadius: 12).cgPath)
                        c.setFillColor(ui(a).cgColor); c.fillPath()
                        if rng.chance(0.35) {
                            c.addPath(UIBezierPath(roundedRect: CGRect(x: x + 3, y: CGFloat(r) * h + 3, width: w - 6, height: h - 6), cornerRadius: 12).cgPath)
                            c.setFillColor(UIColor.white.withAlphaComponent(0.12).cgColor); c.fillPath()
                        }
                        x += w
                    }
                }
            case "stripes":
                let n = 10
                for i in 0..<n where i % 2 == 1 { c.fill(b, CGRect(x: CGFloat(i) * W / CGFloat(n), y: 0, width: W / CGFloat(n), height: H)) }
            default: // boards, one over another
                stroke(c, b, 5)
                for i in 1..<9 { let y = CGFloat(i) * H / 9; line(c, [(0, y), (W, y)]) }
            }
        }
    }

    /// How high a roof of this shape is at its top.
    private static func peak(_ shape: String) -> Float {
        switch shape {
        case "steep": 3.0
        case "pyramid": 2.2
        case "flat": 0.3
        default: 1.7
        }
    }

    /// A roof for one room, standing on its lid with its middle over the
    /// origin: two slopes and a ridge running front to back, a pyramid, or a
    /// flat slab.
    static func roof(_ shape: String, _ material: SCNMaterial) -> SCNNode {
        let S = HouseCatalog.side, high = peak(shape)
        switch shape {
        case "pyramid":
            let g = SCNPyramid(width: CGFloat(S + 0.7), height: CGFloat(high), length: CGFloat(S + 0.7))
            g.materials = [material]
            return SCNNode(geometry: g)
        case "flat":
            let holder = SCNNode()
            holder.add(MathShape.box(S + 0.8, high, S + 0.8, material), 0, high / 2, 0)
            return holder
        default:
            let path = UIBezierPath()
            let half = CGFloat(S / 2 + 0.35)
            path.move(to: CGPoint(x: -half, y: 0))
            path.addLine(to: CGPoint(x: half, y: 0))
            path.addLine(to: CGPoint(x: 0, y: CGFloat(high)))
            path.close()
            let g = SCNShape(path: path, extrusionDepth: CGFloat(S + 0.6))
            g.materials = [material]
            return SCNNode(geometry: g)
        }
    }

    /// How far up a roof's top is, this far across and back from its middle.
    static func rise(_ shape: String, _ dx: Float, _ dz: Float) -> Float {
        let half = HouseCatalog.side / 2 + 0.35, high = peak(shape)
        switch shape {
        case "flat": return high
        case "pyramid": return max(0, high * (1 - max(abs(dx), abs(dz)) / half))
        default: return max(0, high * (1 - abs(dx) / half))
        }
    }

    /// The front door, facing +z, standing on the origin: its frame, the door, and a knob. Or a round one.
    static func door(_ hex: String, round: Bool = false) -> SCNNode {
        let n = SCNNode()
        let frame = MathMat.color("f6f1e4"), knob = MathMat.color("f5c542", glow: 0.3)
        if round {
            let ring = MathShape.cylinder(1.12, 0.1, frame, segments: 28)
            ring.eulerAngles.x = .pi / 2
            n.add(ring, 0, 1.12, 0)
            let leaf = MathShape.cylinder(0.98, 0.1, MathMat.color(hex), segments: 28)
            leaf.eulerAngles.x = .pi / 2
            n.add(leaf, 0, 1.12, 0.03)
            // The knob's in the middle, as it should be.
            n.add(MathShape.sphere(0.09, knob, segments: 10), 0, 1.12, 0.1)
        } else {
            n.add(MathShape.box(1.3, 2.3, 0.1, frame), 0, 1.15, 0)
            n.add(MathShape.box(1.1, 2.15, 0.1, MathMat.color(hex)), 0, 1.08, 0.03)
            n.add(MathShape.sphere(0.06, knob, segments: 10), 0.38, 1.05, 0.1)
        }
        return n
    }

    /// A lantern by the front door, on at night, facing +z.
    static func porchLight() -> SCNNode {
        let n = SCNNode()
        n.add(MathShape.box(0.2, 0.06, 0.2, MathMat.color("20242c")), 0, 0.17, 0.1)
        n.add(MathShape.box(0.16, 0.26, 0.16, MathMat.color("ffe9a0", glow: 1)), 0, 0, 0.1)
        let light = SCNNode()
        light.light = SCNLight()
        light.light?.type = .omni
        light.light?.color = UIColor(red: 1, green: 0.8, blue: 0.52, alpha: 1)
        light.light?.intensity = 380
        light.light?.attenuationStartDistance = 0.6
        light.light?.attenuationEndDistance = 6
        n.add(light, 0, -0.2, 1.1)
        return n
    }

    /// Something on the roof, standing on the roof's lid at the origin.
    /// `rise` is how far up the roof's own top is there: a chimney comes up
    /// through it, and anything on a pole stands on it.
    static func rooftop(_ key: String, rise: Float) -> SCNNode {
        let n = SCNNode()
        let white = MathMat.color("f6f1e4"), dark = MathMat.color("20242c")
        switch key {
        case "chimney":
            let tall = rise + 0.9
            n.add(MathShape.box(0.7, tall, 0.7, MathMat.color("a8553f")), 0, tall / 2, 0)
            n.add(MathShape.box(0.86, 0.14, 0.86, MathMat.color("6b4a3a")), 0, tall + 0.07, 0)
            // Smoke: three puffs, one after another, going up and thinning out.
            for i in 0..<3 {
                let puff = MathShape.sphere(0.2, MathMat.color("e9e6e0", alpha: 0.8), segments: 10)
                puff.castsShadow = false
                puff.opacity = 0
                n.add(puff, 0, tall + 0.2, 0)
                let up = SCNAction.group([.moveBy(x: 0.5, y: 1.9, z: -0.2, duration: 3.6), .scale(to: 2.2, duration: 3.6),
                                          .sequence([.fadeOpacity(to: 0.8, duration: 0.5), .fadeOpacity(to: 0, duration: 3.1)])])
                let back = SCNAction.group([.move(to: SCNVector3(0, tall + 0.2, 0), duration: 0), .scale(to: 1, duration: 0)])
                puff.runAction(.sequence([.wait(duration: Double(i) * 1.2), .repeatForever(.sequence([up, back]))]))
            }
        case "flag":
            n.add(MathShape.cylinder(0.04, 2.3, white, segments: 8), 0, rise + 1.05, 0)
            n.add(MathShape.sphere(0.08, MathMat.color("f5c542", glow: 0.3), segments: 8), 0, rise + 2.22, 0)
            let cloth = SCNNode()
            cloth.add(MathShape.box(0.95, 0.6, 0.03, MathMat.color("d6263a")), 0.5, 0, 0)
            cloth.add(MathShape.box(0.3, 0.6, 0.04, MathMat.color("f5c542")), 0.19, 0, 0)
            n.add(cloth, 0, rise + 1.82, 0)
            // In a little wind.
            cloth.eulerAngles.y = 0.5
            let wave = SCNAction.sequence([.rotateTo(x: 0, y: 0.75, z: 0, duration: 1.4), .rotateTo(x: 0, y: 0.4, z: 0, duration: 1.7)])
            wave.timingMode = .easeInEaseOut
            cloth.runAction(.repeatForever(wave))
        case "vane":
            n.add(MathShape.cylinder(0.035, 1.3, dark, segments: 8), 0, rise + 0.6, 0)
            for (i, turn) in [Float(0), .pi / 2].enumerated() {
                let arm = MathShape.box(0.9, 0.035, 0.035, dark)
                arm.eulerAngles.y = turn
                n.add(arm, 0, rise + 0.85, 0)
                for end: Float in [-0.45, 0.45] { n.add(MathShape.sphere(0.055, dark, segments: 8), i == 0 ? end : 0, rise + 0.85, i == 0 ? 0 : end) }
            }
            let arrow = SCNNode()
            let gold = MathMat.color("f5c542", glow: 0.25)
            arrow.add(MathShape.box(1.0, 0.05, 0.04, gold), 0, 0, 0)
            let tip = MathShape.cone(0.12, 0, 0.26, gold, segments: 8)
            tip.eulerAngles.z = -.pi / 2
            arrow.add(tip, 0.6, 0, 0)
            arrow.add(MathShape.box(0.26, 0.26, 0.03, gold), -0.48, 0, 0)
            n.add(arrow, 0, rise + 1.25, 0)
            // It swings to somewhere new now and then, and settles.
            var rng = MathRNG(seed: 91)
            var turns: [SCNAction] = []
            for _ in 0..<6 {
                let to = CGFloat(rng.range(-.pi, .pi))
                let swing = SCNAction.rotateTo(x: 0, y: to, z: 0, duration: 1.6, usesShortestUnitArc: true)
                swing.timingMode = .easeInEaseOut
                turns += [swing, .wait(duration: Double(rng.range(3, 8)))]
            }
            arrow.runAction(.repeatForever(.sequence(turns)))
        case "dish":
            n.add(MathShape.cylinder(0.045, rise + 0.7, dark, segments: 8), 0, (rise + 0.7) / 2, 0)
            let dish = SCNNode()
            dish.add(MathShape.cone(0.06, 0.55, 0.22, MathMat.color("dfe6ee"), segments: 20), 0, 0, 0)
            dish.add(MathShape.cylinder(0.02, 0.45, dark, segments: 6), 0, 0.3, 0)
            dish.add(MathShape.sphere(0.06, MathMat.color("d6263a"), segments: 8), 0, 0.52, 0)
            // Tipped up at the sky, towards the other house.
            dish.eulerAngles = SCNVector3(0.9, 0, -0.5)
            n.add(dish, 0, rise + 0.85, 0)
        case "beacon":
            n.add(MathShape.cylinder(0.3, 0.6, white, segments: 16), 0, rise + 0.3, 0)
            n.add(MathShape.cylinder(0.31, 0.16, MathMat.color("d6263a"), segments: 16), 0, rise + 0.3, 0)
            n.add(MathShape.cylinder(0.24, 0.42, MathMat.color("ffe9a0", glow: 1), segments: 16), 0, rise + 0.81, 0)
            n.add(MathShape.cone(0.34, 0, 0.3, MathMat.color("d6263a"), segments: 16), 0, rise + 1.17, 0)
            // The light going round: a beam out each side.
            let beams = SCNNode()
            for side: Float in [-1, 1] {
                let beam = MathShape.cone(0.06, 0.5, 3.2, MathMat.color("ffe9a0", glow: 1, alpha: 0.32), segments: 12)
                beam.castsShadow = false
                beam.eulerAngles.z = side * .pi / 2
                beams.add(beam, side * -1.8, 0, 0)
            }
            n.add(beams, 0, rise + 0.81, 0)
            beams.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 7)))
        default: break
        }
        return n
    }

    /// Something on the front lawn, standing on the origin and facing +z.
    static func lawn(_ key: String) -> SCNNode {
        let n = SCNNode()
        switch key {
        case "mailbox":
            n.add(MathShape.box(0.1, 1.0, 0.1, MathMat.color("8a5a3a")), 0, 0.5, 0)
            n.add(MathShape.box(0.3, 0.28, 0.58, MathMat.color("2f5f9a"), round: 0.08), 0, 1.1, 0.04)
            n.add(MathShape.box(0.03, 0.2, 0.1, MathMat.color("d6263a")), 0.17, 1.22, 0.1)
            n.add(MathShape.box(0.24, 0.2, 0.02, MathMat.color("1f4470")), 0, 1.1, 0.335)
        case "snowman":
            let snow = MathMat.color("f8fbff"), coal = MathMat.color("20242c"), twig = MathMat.color("6b4a2f")
            n.add(MathShape.sphere(0.44, snow, segments: 16), 0, 0.4, 0)
            n.add(MathShape.sphere(0.32, snow, segments: 16), 0, 1.0, 0)
            n.add(MathShape.sphere(0.22, snow, segments: 14), 0, 1.45, 0)
            n.add(MathShape.cylinder(0.26, 0.09, MathMat.color("d6263a"), segments: 14), 0, 1.26, 0)
            for x: Float in [-0.08, 0.08] { n.add(MathShape.sphere(0.03, coal, segments: 8), x, 1.5, 0.19) }
            let nose = MathShape.cone(0.045, 0, 0.24, MathMat.color("f08a3c"), segments: 8)
            nose.eulerAngles.x = .pi / 2
            n.add(nose, 0, 1.44, 0.3)
            for y: Float in [0.88, 1.02] { n.add(MathShape.sphere(0.035, coal, segments: 8), 0, y, 0.31) }
            n.add(MathShape.cylinder(0.27, 0.03, coal, segments: 14), 0, 1.64, 0)
            n.add(MathShape.cylinder(0.17, 0.26, coal, segments: 14), 0, 1.78, 0)
            for side: Float in [-1, 1] {
                let arm = MathShape.cylinder(0.02, 0.6, twig, segments: 6)
                arm.eulerAngles.z = side * 1.0
                n.add(arm, side * 0.5, 1.15, 0)
            }
        case "flamingos":
            func flamingo() -> SCNNode {
                let bird = SCNNode()
                let pink = MathMat.color("f47aa8")
                bird.add(MathShape.cylinder(0.018, 0.75, MathMat.color("e0608f"), segments: 6), 0, 0.375, 0)
                bird.add(MathShape.sphere(0.2, pink, segments: 12), 0, 0.85, 0).scale = SCNVector3(0.8, 0.7, 1.25)
                let neck = MathShape.cylinder(0.04, 0.5, pink, segments: 8)
                neck.eulerAngles.x = 0.35
                bird.add(neck, 0, 1.12, 0.26)
                bird.add(MathShape.sphere(0.075, pink, segments: 10), 0, 1.36, 0.36)
                let beak = MathShape.cone(0.04, 0.01, 0.16, MathMat.color("20242c"), segments: 8)
                beak.eulerAngles.x = 2.0
                bird.add(beak, 0, 1.31, 0.46)
                return bird
            }
            n.add(flamingo(), -0.35, 0, 0, ry: 0.5)
            n.add(flamingo().scaled(0.85), 0.4, 0, 0.25, ry: -0.6)
        case "saucer":
            let hull = MathMat.color("b9c2cc")
            for i in 0..<3 {
                let t = Float(i) * .pi * 2 / 3
                let leg = MathShape.cylinder(0.035, 0.75, MathMat.color("6b7078"), segments: 6)
                leg.eulerAngles = SCNVector3(0.4 * cos(t), 0, -0.4 * sin(t))
                n.add(leg, sin(t) * 0.55, 0.33, cos(t) * 0.55)
            }
            let craft = SCNNode()
            craft.add(MathShape.sphere(1.0, hull, segments: 24), 0, 0, 0).scale = SCNVector3(1, 0.2, 1)
            craft.add(MathShape.sphere(0.42, MathMat.color("9fe8ff", glow: 0.35, alpha: 0.75), segments: 16), 0, 0.14, 0)
            for i in 0..<8 {
                let t = Float(i) * .pi / 4
                craft.add(MathShape.sphere(0.07, MathMat.color(i % 2 == 0 ? "7dff3a" : "ffe14a", glow: 1), segments: 8), cos(t) * 0.82, 0.05, sin(t) * 0.82)
            }
            n.add(craft, 0, 0.78, 0)
            // Parked, but not switched off.
            craft.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 14)))
            let hum = MathShape.cylinder(0.55, 0.02, MathMat.color("7dff3a", glow: 1, alpha: 0.3), segments: 20)
            hum.castsShadow = false
            n.add(hum, 0, 0.03, 0)
            hum.runAction(.repeatForever(.sequence([.fadeOpacity(to: 0.25, duration: 1.6), .fadeOpacity(to: 1, duration: 1.6)])))
        default: break
        }
        return n
    }

    // MARK: Signs

    // MARK: Stairs

    /// A flight of stairs up the outside of a room, from its floor to the
    /// one above (HouseLayout.Stairs): treads on two stringers, a landing at
    /// the top beside the room above, a rail down the outer side, and posts
    /// to the ground, which is `floor` storeys down. Placed where the room
    /// under the top one stands. `right`, it's along that room's right side;
    /// else along its front. Either way it climbs from the front of the lot
    /// to the back, so the high end hides least.
    static func stairs(right: Bool, floor: Int) -> SCNNode {
        let S = HouseCatalog.side, H = HouseCatalog.height
        let node = SCNNode()
        node.name = "stairs"
        let wood = MathMat.color("b98452"), dark = MathMat.color("8a5a3a"), rail = MathMat.color("f6f1e4")
        // `a` along the side from the back of the room, `o` out from its edge.
        func put(_ box: SCNNode, _ a: Float, _ y: Float, _ o: Float) {
            node.add(box, right ? S + o : a, y, right ? a : S + o)
        }
        // A box `along` the flight, `out` across it.
        func box(_ along: Float, _ h: Float, _ out: Float, _ m: SCNMaterial) -> SCNNode {
            right ? MathShape.box(out, h, along, m) : MathShape.box(along, h, out, m)
        }
        // Tipped up the flight: the back end high.
        func tipped(_ box: SCNNode, by angle: Float) -> SCNNode {
            if right { box.eulerAngles.x = angle } else { box.eulerAngles.z = -angle }
            return box
        }
        let inner: Float = 0.35, outer: Float = 1.35, steps = 10
        let landing: Float = 1.2, bottom = S - 0.1
        let rise = H / Float(steps), run = (bottom - landing) / Float(steps)
        // The landing, in to the room's own edge.
        put(box(landing, 0.14, outer, wood), landing / 2, H - 0.07, outer / 2)
        for i in 0..<(steps - 1) {
            put(box(run + 0.04, 0.1, outer - inner, wood), bottom - (Float(i) + 0.5) * run, Float(i + 1) * rise - 0.05, (inner + outer) / 2)
        }
        let length = hypot(bottom - landing, H), angle = atan2(H, bottom - landing)
        let mid = (bottom + landing) / 2
        for o in [inner + 0.06, outer - 0.06] {
            put(tipped(box(length, 0.26, 0.1, dark), by: angle), mid, H / 2 - 0.2, o)
        }
        // A rail down the outer side and round the landing, on posts.
        let high: Float = 0.95
        put(tipped(box(length, 0.08, 0.08, rail), by: angle), mid, H / 2 + high, outer - 0.06)
        put(box(landing, 0.08, 0.08, rail), landing / 2, H + high, outer - 0.06)
        put(box(0.08, 0.08, outer, rail), 0.04, H + high, outer / 2)
        for (a, y) in [(bottom, Float(0)), (mid, H / 2), (landing, H), (0.04, H)] {
            put(box(0.08, high, 0.08, rail), a, y + high / 2, outer - 0.06)
        }
        put(box(0.08, high, 0.08, rail), 0.04, H + high / 2, 0.04)
        // Legs under the landing's outer corners, down to the ground; and, started from an upper floor, under its foot.
        let down = Float(floor) * H
        for a in [0.1, landing - 0.1] {
            put(box(0.12, H + down - 0.14, 0.12, dark), a, (H - 0.14 - down) / 2, outer - 0.1)
        }
        if floor > 0 {
            for o in [inner + 0.06, outer - 0.06] { put(box(0.12, down, 0.12, dark), bottom - 0.1, -down / 2, o) }
        }
        return node
    }

    /// How a spot's marker looks: nothing chosen for it yet, something in it, or the one the card's up for.
    enum Marker: String {
        case empty, filled, chosen
    }

    /// A marker on a spot, always facing the camera. An empty spot's is a
    /// white tag with a picture of what goes there and a "+"; one with
    /// something in it is a small white dot, since the thing itself is there
    /// to see; the one the card's up for is the tag in red. All the same
    /// size to tap, whatever's drawn.
    static func marker(_ symbol: String, _ state: Marker) -> SCNNode {
        let material = MathMat.drawn("house-marker-\(symbol)-\(state.rawValue)", 192, 192, glow: 0.55, clear: true) { c, size in
            let w = size.width, mid = w / 2
            let ink = "5a3b2a", red = "d6261f"
            switch state {
            case .filled:
                c.setFillColor(UIColor.white.withAlphaComponent(0.45).cgColor)
                c.fillEllipse(in: CGRect(x: mid - 40, y: mid - 40, width: 80, height: 80))
                c.setFillColor(ui(ink).withAlphaComponent(0.35).cgColor)
                c.fillEllipse(in: CGRect(x: mid - 25, y: mid - 23, width: 50, height: 50))
                disc(c, "ffffff", mid, mid, 22)
            case .empty, .chosen:
                let on = state == .chosen, r: CGFloat = 66
                // A soft shadow under it, so it lifts off whatever's behind.
                c.setFillColor(ui(ink).withAlphaComponent(0.28).cgColor)
                c.fillEllipse(in: CGRect(x: mid - r - 3, y: mid - r + 2, width: r * 2 + 6, height: r * 2 + 6))
                disc(c, on ? red : "ffffff", mid, mid, r)
                if on {
                    c.setStrokeColor(UIColor.white.cgColor)
                    c.setLineWidth(7)
                    c.strokeEllipse(in: CGRect(x: mid - r + 3.5, y: mid - r + 3.5, width: r * 2 - 7, height: r * 2 - 7))
                }
                glyph(symbol, on ? "ffffff" : ink, in: CGRect(x: mid - 38, y: mid - 38, width: 76, height: 76))
                guard !on, symbol != "plus" else { return }
                // A "+" at its corner: something to add.
                let bx = mid + 50, by = mid - 50
                disc(c, "ffffff", bx, by, 27)
                disc(c, red, bx, by, 22)
                stroke(c, "ffffff", 7)
                line(c, [(bx - 11, by), (bx + 11, by)])
                line(c, [(bx, by - 11), (bx, by + 11)])
            }
        }
        material.readsFromDepthBuffer = false
        material.writesToDepthBuffer = false
        let node = MathShape.card(0.78, 0.78, material)
        node.constraints = [SCNBillboardConstraint()]
        node.renderingOrder = state == .chosen ? 101 : 100
        node.castsShadow = false
        if state == .chosen { node.scale = SCNVector3(1.2, 1.2, 1.2) }
        return node
    }

    /// A system symbol, as big as fits in `rect`. A plus if there's no such symbol.
    private static func glyph(_ name: String, _ hex: String, in rect: CGRect) {
        let config = UIImage.SymbolConfiguration(pointSize: rect.height, weight: .bold)
        guard let image = (UIImage(systemName: name, withConfiguration: config) ?? UIImage(systemName: "plus", withConfiguration: config))?
            .withTintColor(ui(hex), renderingMode: .alwaysOriginal) else { return }
        let k = min(rect.width / image.size.width, rect.height / image.size.height)
        let size = CGSize(width: image.size.width * k, height: image.size.height * k)
        image.draw(in: CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height))
    }

    /// A sign that faces the camera: a house's name, a locked room's price.
    static func sign(_ lines: [String], ink: String = "5a3b2a", paper: String = "fff7e6", width: Float = 2.6) -> SCNNode {
        let rows = CGFloat(lines.count)
        let material = MathMat.drawn("house-sign-\(lines.joined(separator: "|"))-\(paper)", 512, Int(110 * rows) + 36, clear: true) { c, size in
            let rect = CGRect(origin: .zero, size: size).insetBy(dx: 6, dy: 6)
            c.addPath(UIBezierPath(roundedRect: rect, cornerRadius: 34).cgPath); c.setFillColor(ui(ink).cgColor); c.fillPath()
            c.addPath(UIBezierPath(roundedRect: rect.insetBy(dx: 10, dy: 10), cornerRadius: 26).cgPath); c.setFillColor(ui(paper).cgColor); c.fillPath()
            for (i, s) in lines.enumerated() {
                // As big as fits on one line.
                var points: CGFloat = i == 0 ? 64 : 54
                while points > 24, (s as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: points, weight: .black)]).width > size.width - 56 { points -= 4 }
                text(s, ink, points, in: CGRect(x: 20, y: 18 + CGFloat(i) * 110, width: size.width - 40, height: 110))
            }
        }
        material.readsFromDepthBuffer = false
        material.writesToDepthBuffer = false
        let node = MathShape.card(width, width * Float(110 * rows + 36) / 512, material)
        node.constraints = [SCNBillboardConstraint()]
        node.renderingOrder = 90
        return node
    }
}

extension HouseSpot {
    /// The picture on its marker: what sort of thing goes there.
    var symbol: String {
        switch place {
        case .walls: return "paintbrush.fill"
        case .flooring: return "square.grid.2x2.fill"
        case .pet: return "pawprint.fill"
        case .ceiling: return "lamp.ceiling.fill"
        case .rug: return id == "pond" ? "drop.fill" : "square.dashed"
        case .wall: return "photo.fill"
        case .on: return "fork.knife"
        case .wood: return "hammer.fill"
        case .fabric: return "swatchpalette.fill"
        case .outside:
            return ["roof": "house.fill", "shape": "triangle.fill", "walls": "paintbrush.fill", "door": "door.left.hand.closed",
                    "top": "flag.fill", "lawn": "leaf.fill"][id] ?? "plus"
        case .floor, .against: break
        }
        return [
            "bed": "bed.double.fill", "bedside": "lamp.table.fill", "lamp": "lamp.floor.fill",
            "desk": "table.furniture.fill", "table": "table.furniture.fill", "counter": "table.furniture.fill",
            "chair": "chair.fill", "chair1": "chair.fill", "chair2": "chair.fill", "armchair": "chair.lounge.fill",
            "seat": "chair.lounge.fill", "bench": "chair.lounge.fill", "sofa": "sofa.fill",
            "shelf": "books.vertical.fill", "tree": "tree.fill",
            "tv": "tv.fill", "arcade": "gamecontroller.fill",
            "fridge": "refrigerator.fill", "stove": "stove.fill", "sink": "sink.fill",
            "bath": "bathtub.fill", "toilet": "toilet.fill", "washer": "washer.fill",
            "boxes": "shippingbox.fill", "scope": "binoculars.fill",
        // A corner takes all sorts: just a plus.
        ][id] ?? "plus"
    }
}
