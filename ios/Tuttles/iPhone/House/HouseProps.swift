import SceneKit
import UIKit

// What the house's things look like. The furniture is Kenney's Furniture Kit
// and the pets his Cube Pets (public domain: see MathAssets/models/CREDITS.txt),
// loaded the way Math loads its models. Everything flat (rugs, floors,
// pictures, windows) is drawn here in code, and so are the few things no kit
// has: the arcade cabinet, the telescope, the door in the basement.

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

    /// A window, facing +z: a frame, and whatever's through it.
    static func window(_ kind: String) -> SCNNode {
        let round = kind == "round" || kind == "sea"
        let w: Float = kind == "wide" ? 2.3 : round ? 1.1 : 1.3, h: Float = round ? 1.1 : 1.35
        let material = MathMat.drawn("house-window-\(kind)", 256, 256, glow: kind == "night" ? 0.5 : 0.35, clear: round) { c, size in
            let W = size.width, H = size.height
            if round { c.addEllipse(in: CGRect(origin: .zero, size: size)); c.clip() }
            switch kind {
            case "night":
                c.fill("0d1230", CGRect(origin: .zero, size: size))
                for p in scatter(50, seed: 13) { disc(c, "fff3b0", p.0 * W, p.1 * H, 1 + p.2 * 3) }
                disc(c, "fff7d6", W * 0.72, H * 0.26, 26); disc(c, "0d1230", W * 0.66, H * 0.22, 22)
            case "frosted":
                c.fill("dfeef2", CGRect(origin: .zero, size: size))
                disc(c, "b9cfd6", W * 0.4, H * 0.7, 60); disc(c, "c9dde3", W * 0.66, H * 0.5, 40)
            case "sea":
                c.fill("1f6f9c", CGRect(origin: .zero, size: size))
                c.fill("12506f", CGRect(x: 0, y: H * 0.55, width: W, height: H * 0.45))
                for p in scatter(12, seed: 17) { disc(c, "9fe0ff", p.0 * W, p.1 * H, 4 + p.2 * 6) }
                c.addEllipse(in: CGRect(x: W * 0.3, y: H * 0.5, width: W * 0.36, height: H * 0.16)); c.setFillColor(ui("0a2f44").cgColor); c.fillPath()
            default:
                c.fill("9fd6f2", CGRect(origin: .zero, size: size))
                disc(c, "ffffff", W * 0.3, H * 0.3, 28); disc(c, "ffffff", W * 0.42, H * 0.34, 22); disc(c, "ffffff", W * 0.75, H * 0.2, 18)
                c.fill("7cbf5a", CGRect(x: 0, y: H * 0.72, width: W, height: H * 0.28))
                if kind == "wide" {
                    // The other house, over there.
                    c.fill("f3ead2", CGRect(x: W * 0.6, y: H * 0.5, width: W * 0.2, height: H * 0.24)); poly(c, "c1502e", [(W * 0.57, H * 0.5), (W * 0.7, H * 0.38), (W * 0.83, H * 0.5)])
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

    // MARK: Signs

    /// A bubble that always faces the camera: a "+" for an empty spot, a dot for one with something in it.
    static func bubble(empty: Bool) -> SCNNode {
        let material = MathMat.drawn("house-bubble-\(empty)", 128, 128, glow: 0.6, clear: true) { c, size in
            let w = size.width
            disc(c, "5a3b2a", w / 2, w / 2, w * 0.48)
            disc(c, empty ? "c9dd6a" : "fff7e6", w / 2, w / 2, w * 0.4)
            stroke(c, empty ? "ffffff" : "5a3b2a", empty ? 16 : 10)
            if empty { line(c, [(w * 0.3, w / 2), (w * 0.7, w / 2)]); line(c, [(w / 2, w * 0.3), (w / 2, w * 0.7)]) }
            else { line(c, [(w * 0.34, w * 0.62), (w * 0.6, w * 0.36)]); line(c, [(w * 0.34, w * 0.62), (w * 0.33, w * 0.67)]) }
        }
        material.readsFromDepthBuffer = false
        material.writesToDepthBuffer = false
        let node = MathShape.card(0.52, 0.52, material)
        node.constraints = [SCNBillboardConstraint()]
        node.renderingOrder = 100
        let pulse = SCNAction.sequence([.scale(to: 1.1, duration: 0.7), .scale(to: 1, duration: 0.7)])
        pulse.timingMode = .easeInEaseOut
        if empty { node.runAction(.repeatForever(pulse)) }
        return node
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
