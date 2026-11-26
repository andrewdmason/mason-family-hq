import Foundation
import SceneKit
import UIKit

// The small things the school is built from: a random number generator that
// can be seeded, flat-coloured and drawn-on materials (made once and shared,
// which is what lets a long hallway be drawn cheaply), and short ways of
// saying "a box this big, there".

struct MathRNG: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E37_79B9_7F4A_7C15 }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// 0 up to 1.
    mutating func unit() -> Float { Float(next() >> 40) / Float(1 << 24) }
    mutating func range(_ a: Float, _ b: Float) -> Float { a + (b - a) * unit() }
    mutating func int(_ n: Int) -> Int { n <= 1 ? 0 : Int(next() % UInt64(n)) }
    mutating func chance(_ p: Float) -> Bool { unit() < p }
    mutating func pick<T>(_ items: [T]) -> T { items[int(items.count)] }
}

enum MathMat {
    private static var colors: [String: SCNMaterial] = [:]
    private static var textured: [String: SCNMaterial] = [:]
    private static var images: [String: UIImage] = [:]

    /// A flat colour. `glow` lights itself (a lamp, a sign).
    static func color(_ hex: String, glow: CGFloat = 0, alpha: CGFloat = 1) -> SCNMaterial {
        let key = "\(hex)|\(glow)|\(alpha)"
        if let hit = colors[key] { return hit }
        let c = MathLookKit.color(hex)
        let m = SCNMaterial()
        m.lightingModel = .lambert
        m.diffuse.contents = c
        if glow > 0 { m.emission.contents = c.withAlphaComponent(1).shaded(glow) ; m.emission.intensity = glow }
        if alpha < 1 {
            m.transparency = alpha
            m.blendMode = .alpha
            m.writesToDepthBuffer = false
            m.isDoubleSided = true
        }
        colors[key] = m
        return m
    }

    /// A picture drawn once in code, by name.
    static func image(_ key: String, _ width: Int, _ height: Int, draw: (CGContext, CGSize) -> Void) -> UIImage {
        if let hit = images[key] { return hit }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let size = CGSize(width: width, height: height)
        let made = UIGraphicsImageRenderer(size: size, format: format).image { draw($0.cgContext, size) }
        images[key] = made
        return made
    }

    /// A material showing a drawn picture, repeated `u` by `v` times.
    static func drawn(_ key: String, _ width: Int = 256, _ height: Int = 256, u: Float = 1, v: Float = 1,
                      glow: CGFloat = 0, doubleSided: Bool = false, clear: Bool = false,
                      draw: (CGContext, CGSize) -> Void) -> SCNMaterial {
        let full = "\(key)|\(u)|\(v)|\(glow)|\(clear)"
        if let hit = textured[full] { return hit }
        let picture = image(key, width, height, draw: draw)
        let m = SCNMaterial()
        m.lightingModel = .lambert
        m.diffuse.contents = picture
        m.diffuse.wrapS = .repeat
        m.diffuse.wrapT = .repeat
        m.diffuse.contentsTransform = SCNMatrix4MakeScale(u, v, 1)
        m.diffuse.mipFilter = .linear
        m.isDoubleSided = doubleSided
        if glow > 0 {
            m.emission.contents = picture
            m.emission.wrapS = .repeat
            m.emission.wrapT = .repeat
            m.emission.contentsTransform = SCNMatrix4MakeScale(u, v, 1)
            m.emission.intensity = glow
        }
        if clear {
            m.blendMode = .alpha
            m.writesToDepthBuffer = false
            m.isDoubleSided = true
        }
        textured[full] = m
        return m
    }

    /// Words on a coloured card: a poster, a sign, a face of a thrown problem.
    static func sign(_ text: String, ink: String = "ffffff", paper: String = "d6263a", size: CGFloat = 0, width: Int = 256, height: Int = 256,
                     border: String? = nil, glow: CGFloat = 0, font: String = "AvenirNext-Heavy") -> SCNMaterial {
        drawn("sign|\(text)|\(ink)|\(paper)|\(size)|\(width)x\(height)|\(border ?? "")|\(font)", width, height, glow: glow) { cg, s in
            MathLookKit.color(paper).setFill()
            cg.fill(CGRect(origin: .zero, size: s))
            if let border {
                MathLookKit.color(border).setStroke()
                cg.setLineWidth(s.width * 0.06)
                cg.stroke(CGRect(origin: .zero, size: s).insetBy(dx: s.width * 0.04, dy: s.width * 0.04))
            }
            let lines = text.components(separatedBy: "\n")
            let longest = lines.map(\.count).max() ?? 1
            let point = size > 0 ? size : min(s.height * 0.78 / CGFloat(lines.count), s.width * 1.5 / CGFloat(max(longest, 1)))
            let style = NSMutableParagraphStyle()
            style.alignment = .center
            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont(name: font, size: point) ?? .systemFont(ofSize: point, weight: .heavy),
                .foregroundColor: MathLookKit.color(ink), .paragraphStyle: style,
            ]
            let block = NSAttributedString(string: text, attributes: attrs)
            let bounds = block.boundingRect(with: CGSize(width: s.width * 0.92, height: s.height), options: [.usesLineFragmentOrigin], context: nil)
            block.draw(with: CGRect(x: s.width * 0.04, y: (s.height - bounds.height) / 2, width: s.width * 0.92, height: bounds.height),
                       options: [.usesLineFragmentOrigin], context: nil)
        }
    }
}

// MARK: Shapes

enum MathShape {
    private static var boxes: [String: SCNGeometry] = [:]

    /// A box, sharing its geometry with every other box of the same size and material.
    static func box(_ w: Float, _ h: Float, _ l: Float, _ material: SCNMaterial, round: Float = 0) -> SCNNode {
        let key = "\(w)|\(h)|\(l)|\(round)|\(ObjectIdentifier(material).hashValue)"
        if let hit = boxes[key] { return SCNNode(geometry: hit) }
        let g = SCNBox(width: CGFloat(w), height: CGFloat(h), length: CGFloat(l), chamferRadius: CGFloat(round))
        if round > 0 { g.chamferSegmentCount = 2 }
        g.materials = [material]
        boxes[key] = g
        return SCNNode(geometry: g)
    }

    /// A box with a different material on its faces: front, right, back, left, top, bottom.
    static func faced(_ w: Float, _ h: Float, _ l: Float, _ faces: [SCNMaterial]) -> SCNNode {
        let g = SCNBox(width: CGFloat(w), height: CGFloat(h), length: CGFloat(l), chamferRadius: 0)
        g.materials = faces
        return SCNNode(geometry: g)
    }

    static func cylinder(_ radius: Float, _ height: Float, _ material: SCNMaterial, segments: Int = 12) -> SCNNode {
        let g = SCNCylinder(radius: CGFloat(radius), height: CGFloat(height))
        g.radialSegmentCount = segments
        g.materials = [material]
        return SCNNode(geometry: g)
    }

    static func sphere(_ radius: Float, _ material: SCNMaterial, segments: Int = 12) -> SCNNode {
        let g = SCNSphere(radius: CGFloat(radius))
        g.segmentCount = segments
        g.materials = [material]
        return SCNNode(geometry: g)
    }

    static func cone(_ bottom: Float, _ top: Float, _ height: Float, _ material: SCNMaterial, segments: Int = 12) -> SCNNode {
        let g = SCNCone(topRadius: CGFloat(top), bottomRadius: CGFloat(bottom), height: CGFloat(height))
        g.radialSegmentCount = segments
        g.materials = [material]
        return SCNNode(geometry: g)
    }

    /// A flat card standing up, facing +z.
    static func card(_ w: Float, _ h: Float, _ material: SCNMaterial) -> SCNNode {
        let g = SCNPlane(width: CGFloat(w), height: CGFloat(h))
        g.materials = [material]
        return SCNNode(geometry: g)
    }

    /// A flat card lying on the floor.
    static func floor(_ w: Float, _ l: Float, _ material: SCNMaterial) -> SCNNode {
        let n = card(w, l, material)
        n.eulerAngles.x = -.pi / 2
        return n
    }

    /// A five-pointed star, for the ones collected.
    static let star: SCNGeometry = {
        let path = UIBezierPath()
        let points = 5
        for i in 0..<(points * 2) {
            let r: CGFloat = i % 2 == 0 ? 0.36 : 0.16
            let a = CGFloat(i) * .pi / CGFloat(points) + .pi / 2
            let p = CGPoint(x: cos(a) * r, y: sin(a) * r)
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.close()
        let g = SCNShape(path: path, extrusionDepth: 0.1)
        g.chamferRadius = 0.03
        let m = SCNMaterial()
        m.lightingModel = .blinn
        m.diffuse.contents = UIColor(red: 1, green: 0.8, blue: 0.1, alpha: 1)
        m.emission.contents = UIColor(red: 0.55, green: 0.38, blue: 0, alpha: 1)
        m.specular.contents = UIColor.white
        g.materials = [m]
        return g
    }()
}

extension SCNNode {
    /// Put a child in, placed, and hand it back.
    @discardableResult
    func add(_ child: SCNNode, _ x: Float = 0, _ y: Float = 0, _ z: Float = 0, ry: Float = 0) -> SCNNode {
        child.position = SCNVector3(x, y, z)
        if ry != 0 { child.eulerAngles.y = ry }
        addChildNode(child)
        return child
    }

    func scaled(_ s: Float) -> SCNNode {
        scale = SCNVector3(s, s, s)
        return self
    }

    /// The node as wide, tall and long as asked, whatever size it was made, standing on y = 0.
    func fitted(width: Float? = nil, height: Float? = nil, length: Float? = nil) -> SCNNode {
        let (lo, hi) = boundingBox
        let size = SCNVector3(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
        var s: Float = 1
        if let height, size.y > 0 { s = height / size.y } else if let width, size.x > 0 { s = width / size.x } else if let length, size.z > 0 { s = length / size.z }
        // Sized and centred by its own scale and pivot. Named, so that a tile
        // leaves it out when it flattens its fixed part into one mesh:
        // flattening loses the size of a scaled node.
        name = MathModels.kitName
        scale = SCNVector3(s, s, s)
        pivot = SCNMatrix4MakeTranslation((lo.x + hi.x) / 2, lo.y, (lo.z + hi.z) / 2)
        return self
    }
}

extension SCNParticleSystem {
    /// A soft round dot, for dust, steam and bubbles (the default is a hard square).
    static let dot: UIImage = MathMat.image("dot", 32, 32) { cg, s in
        let colors = [UIColor.white.cgColor, UIColor(white: 1, alpha: 0).cgColor] as CFArray
        if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0.2, 1]) {
            cg.drawRadialGradient(g, startCenter: CGPoint(x: 16, y: 16), startRadius: 0, endCenter: CGPoint(x: 16, y: 16), endRadius: 16, options: [])
        }
    }

    func soft() { particleImage = Self.dot }
}

extension CGContext {
    func fill(_ hex: String, _ rect: CGRect) {
        setFillColor(MathLookKit.color(hex).cgColor)
        fill(rect)
    }
}
