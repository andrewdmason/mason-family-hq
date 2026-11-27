import CoreImage
import SceneKit
import UIKit

// What the house is made of. Surfaces are photographed ones (Poly Haven's,
// public domain: MathAssets/house3d), lit the physical way. The furniture is
// Kenney's Furniture Kit, with Quaternius's Ultimate House Interior Pack
// (public domain: MathAssets/models/house3d) standing in for the pieces it
// has a better one of. Neither kit's models say where a texture goes on
// them, so it's laid on from whichever side each face looks to, at its real
// size. What's drawn in code (rugs, pictures, the odd floors: HouseProps.swift)
// is kept as it was and lit the same way as the rest (`physical`).

enum HouseLook {
    private static let folder = Bundle.main.bundleURL.appending(path: "MathAssets/house3d")
    private static var images: [String: UIImage] = [:]
    private static var made: [String: SCNMaterial] = [:]

    static func color(_ hex: String) -> UIColor { MathLookKit.color(hex) }

    /// A colour as the kits' files have it (linear light), for the screen.
    static func fromLinear(_ c: SIMD3<Float>) -> UIColor {
        func f(_ x: Float) -> CGFloat { CGFloat(x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1 / 2.4) - 0.055) }
        return UIColor(red: f(c.x), green: f(c.y), blue: f(c.z), alpha: 1)
    }

    private static func image(_ name: String) -> UIImage? {
        if let hit = images[name] { return hit }
        let image = UIImage(contentsOfFile: folder.appending(path: name + ".jpg").path)
        images[name] = image
        return image
    }

    /// A picture repeated across a surface, each copy `tile` metres across.
    private static func tiled(_ p: SCNMaterialProperty, _ name: String, _ tile: Float) {
        guard let image = image(name) else { return }
        p.contents = image
        p.wrapS = .repeat; p.wrapT = .repeat
        p.mipFilter = .linear
        p.maxAnisotropy = 8
        p.contentsTransform = SCNMatrix4MakeScale(1 / tile, 1 / tile, 1)
    }

    private static func cached(_ key: String, _ make: () -> SCNMaterial) -> SCNMaterial {
        if let hit = made[key] { return hit }
        let m = make()
        made[key] = m
        return m
    }

    /// A photographed surface: its colour, its bumps and (where the set has it) how shiny each bit is.
    static func surface(_ set: String, tile: Float, rough: Float? = nil, tint: UIColor? = nil) -> SCNMaterial {
        cached("surface|\(set)|\(tile)|\(tint?.description ?? "")") {
            let m = SCNMaterial()
            m.lightingModel = .physicallyBased
            tiled(m.diffuse, "\(set)_diff", tile)
            tiled(m.normal, "\(set)_nor", tile)
            if let rough { m.roughness.contents = NSNumber(value: rough) } else { tiled(m.roughness, "\(set)_rough", tile) }
            m.metalness.contents = NSNumber(value: 0)
            if let tint { m.multiply.contents = tint }
            return m
        }
    }

    static func plain(_ color: UIColor, rough: Float = 0.6, metal: Float = 0) -> SCNMaterial {
        cached("plain|\(color)|\(rough)|\(metal)") {
            let m = SCNMaterial()
            m.lightingModel = .physicallyBased
            m.diffuse.contents = color
            m.roughness.contents = NSNumber(value: rough)
            m.metalness.contents = NSNumber(value: metal)
            return m
        }
    }

    /// Cloth of any colour, with a weave to it up close.
    static func cloth(_ color: UIColor) -> SCNMaterial {
        cached("cloth|\(color)") {
            let m = SCNMaterial()
            m.lightingModel = .physicallyBased
            m.diffuse.contents = color
            m.roughness.contents = NSNumber(value: 0.95)
            m.metalness.contents = NSNumber(value: 0)
            tiled(m.normal, "fabric_pattern_07_nor", 0.35)
            m.normal.intensity = 0.8
            return m
        }
    }

    /// A wall's paint: a colour over plaster.
    static func paint(_ hex: String) -> SCNMaterial {
        cached("paint|\(hex)") {
            let m = SCNMaterial()
            m.lightingModel = .physicallyBased
            m.diffuse.contents = color(hex)
            m.roughness.contents = NSNumber(value: 0.85)
            m.metalness.contents = NSNumber(value: 0)
            tiled(m.normal, "painted_plaster_wall_nor", 2.5)
            m.normal.intensity = 0.6
            return m
        }
    }

    static let glass: SCNMaterial = {
        let m = SCNMaterial()
        m.lightingModel = .physicallyBased
        m.diffuse.contents = UIColor(red: 0.75, green: 0.88, blue: 0.95, alpha: 1)
        m.roughness.contents = NSNumber(value: 0.05)
        m.metalness.contents = NSNumber(value: 0)
        m.transparency = 0.3
        m.isDoubleSided = true
        m.writesToDepthBuffer = false
        return m
    }()

    static func glowing(_ color: UIColor) -> SCNMaterial {
        cached("glow|\(color)") {
            let m = SCNMaterial()
            m.lightingModel = .physicallyBased
            m.diffuse.contents = color
            m.emission.contents = color
            m.emission.intensity = 1.6
            m.roughness.contents = NSNumber(value: 0.5)
            m.metalness.contents = NSNumber(value: 0)
            return m
        }
    }

    static var trim: SCNMaterial { plain(color("f4f1ea"), rough: 0.45) }
    /// The dark line along the top of a wall.
    static var cap: SCNMaterial { plain(color("3a3530"), rough: 0.8) }
    static var concrete: SCNMaterial { plain(color("b9b2a6"), rough: 0.9) }
    static var ceiling: SCNMaterial { plain(color("efece6"), rough: 0.9) }
    static var steel: SCNMaterial { plain(UIColor(red: 0.78, green: 0.79, blue: 0.8, alpha: 1), rough: 0.32, metal: 1) }
    static var oak: SCNMaterial { surface("oak_veneer_01", tile: 0.9) }
    static var walnut: SCNMaterial { surface("walnut_veneer_02", tile: 0.9) }
    static var grass: SCNMaterial { surface("leafy_grass", tile: 5, rough: 0.95, tint: color("c9e0b0")) }

    // MARK: The catalogue's colours

    private static var grains: [String: UIImage] = [:]

    /// A photographed surface with its own colour taken out and lightened, so it can be any colour and keep its grain.
    private static func grain(_ name: String) -> UIImage? {
        if let hit = grains[name] { return hit }
        guard let image = image(name), let cg = image.cgImage else { return nil }
        let mono = CIImage(cgImage: cg).applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0, kCIInputContrastKey: 0.8])
        // Lift it so its middle is nearly white: the colour laid over it then comes out as chosen.
        let lifted = mono.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: 1.1])
        guard let out = CIContext().createCGImage(lifted, from: lifted.extent) else { return nil }
        let made = UIImage(cgImage: out)
        grains[name] = made
        return made
    }

    /// A photographed surface in a chosen colour. `glow`: it shines a little.
    static func tinted(_ set: String, _ hex: String, tile: Float, rough: Float? = nil, glow: Double = 0) -> SCNMaterial {
        cached("tinted|\(set)|\(hex)|\(tile)|\(glow)") {
            let m = SCNMaterial()
            m.lightingModel = .physicallyBased
            if let grain = grain("\(set)_diff") {
                m.diffuse.contents = grain
                m.diffuse.wrapS = .repeat; m.diffuse.wrapT = .repeat
                m.diffuse.mipFilter = .linear
                m.diffuse.maxAnisotropy = 8
                m.diffuse.contentsTransform = SCNMatrix4MakeScale(1 / tile, 1 / tile, 1)
            }
            m.multiply.contents = color(hex)
            tiled(m.normal, "\(set)_nor", tile)
            if let rough { m.roughness.contents = NSNumber(value: rough) } else { tiled(m.roughness, "\(set)_rough", tile) }
            m.metalness.contents = NSNumber(value: 0)
            if glow > 0 {
                m.emission.contents = color(hex)
                m.emission.intensity = CGFloat(glow) * 2
            }
            return m
        }
    }

    /// The wood of a room's furniture, in the colour chosen for it.
    static func wood(_ hex: String, glow: Double = 0) -> SCNMaterial { tinted("oak_veneer_01", hex, tile: 0.9, glow: glow) }

    /// Cloth in a chosen colour that may shine a little.
    static func cloth(_ hex: String, glow: Double) -> SCNMaterial {
        guard glow > 0 else { return cloth(color(hex)) }
        return cached("clothglow|\(hex)|\(glow)") {
            let m = cloth(color(hex)).copy() as! SCNMaterial
            m.emission.contents = color(hex)
            m.emission.intensity = CGFloat(glow) * 2
            return m
        }
    }

    /// A room's floor: boards, parquet and tiles are photographed ones in
    /// the colour chosen; carpet is cloth; the rest (checkers, zigzags,
    /// stars, grass) are drawn, as they always were.
    static func floor(_ pattern: String, _ a: String, _ b: String) -> SCNMaterial {
        switch pattern {
        case "boards": return tinted("laminate_floor_02", a, tile: 2.4)
        case "parquet": return tinted("herringbone_parquet", a, tile: 1.6)
        case "tiles": return tinted("interior_tiles", a, tile: 1.5)
        case "carpet": return cloth(color(a))
        default:
            return cached("drawn|\(pattern)|\(a)|\(b)") {
                // Drawn to cover four metres; these floors are measured in metres.
                let m = physical(HouseProps.floorMaterial(pattern, a, b), fresh: true)
                m.diffuse.wrapS = .repeat; m.diffuse.wrapT = .repeat
                m.diffuse.contentsTransform = SCNMatrix4MakeScale(0.25, 0.25, 1)
                return m
            }
        }
    }

    /// What the house is clad in outside: drawn for one whole face of an old wall (four metres by a little over three), laid here by the metre.
    static func clad(_ pattern: String, _ a: String, _ b: String) -> SCNMaterial {
        cached("clad|\(pattern)|\(a)|\(b)") {
            let m = physical(HouseProps.cladding(pattern, a, b), fresh: true)
            m.diffuse.wrapS = .repeat; m.diffuse.wrapT = .repeat
            m.diffuse.contentsTransform = SCNMatrix4MakeScale(0.25, 1 / 3.2, 1)
            return m
        }
    }

    /// Window glass with a light on behind it.
    static let litGlass: SCNMaterial = {
        let m = SCNMaterial()
        m.lightingModel = .physicallyBased
        m.diffuse.contents = color("ffd98a")
        m.emission.contents = color("ffd98a")
        m.emission.intensity = 1.2
        m.roughness.contents = NSNumber(value: 0.3)
        m.metalness.contents = NSNumber(value: 0)
        return m
    }()

    // MARK: What was made for flat light

    private static var twins: [ObjectIdentifier: SCNMaterial] = [:]

    /// A material made for the old flat light, as one lit the way the house now is: the same colour or picture, matt.
    static func physical(_ m: SCNMaterial, fresh: Bool = false) -> SCNMaterial {
        if m.lightingModel == .physicallyBased && !fresh { return m }
        if !fresh, let hit = twins[ObjectIdentifier(m)] { return hit }
        let made = m.copy() as! SCNMaterial
        made.lightingModel = .physicallyBased
        made.roughness.contents = NSNumber(value: 0.85)
        made.metalness.contents = NSNumber(value: 0)
        if !fresh { twins[ObjectIdentifier(m)] = made }
        return made
    }

    /// Everything under a node lit the way the house is. (Geometry is shared between copies of a model, so this is done once for each.)
    static func physical(_ node: SCNNode) {
        node.enumerateHierarchy { n, _ in
            guard let g = n.geometry, g.materials.contains(where: { $0.lightingModel != .physicallyBased }) else { return }
            g.materials = g.materials.map { physical($0) }
        }
    }
}

// MARK: Shapes

/// Triangles for one material, added to a face at a time.
final class HouseMesh {
    private var pos: [Float] = [], nor: [Float] = [], uv: [Float] = []
    var isEmpty: Bool { pos.isEmpty }

    func add(_ p: SIMD3<Float>, _ n: SIMD3<Float>, _ t: SIMD2<Float>) {
        pos += [p.x, p.y, p.z]; nor += [n.x, n.y, n.z]; uv += [t.x, t.y]
    }

    /// Where a point's texture falls when it's laid on flat from whichever side its face looks to, in metres.
    static func boxUV(_ p: SIMD3<Float>, _ n: SIMD3<Float>) -> SIMD2<Float> {
        let a = simd_abs(n)
        if a.y >= a.x && a.y >= a.z { return SIMD2(p.x, p.z) }
        if a.x >= a.z { return SIMD2(p.z, -p.y) }
        return SIMD2(p.x, -p.y)
    }

    /// A flat four-cornered face, anticlockwise from outside.
    func quad(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, _ d: SIMD3<Float>) {
        let n = simd_normalize(simd_cross(b - a, c - a))
        for p in [a, b, c, a, c, d] { add(p, n, Self.boxUV(p, n)) }
    }

    /// A flat three-cornered face, anticlockwise from outside.
    func tri(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>) {
        let cross = simd_cross(b - a, c - a)
        guard simd_length(cross) > 1e-6 else { return }
        let n = simd_normalize(cross)
        for p in [a, b, c] { add(p, n, Self.boxUV(p, n)) }
    }

    func box(_ lo: SIMD3<Float>, _ hi: SIMD3<Float>) {
        guard hi.x > lo.x, hi.y > lo.y, hi.z > lo.z else { return }
        let (x0, y0, z0, x1, y1, z1) = (lo.x, lo.y, lo.z, hi.x, hi.y, hi.z)
        quad(SIMD3(x0, y1, z0), SIMD3(x0, y1, z1), SIMD3(x1, y1, z1), SIMD3(x1, y1, z0))
        quad(SIMD3(x0, y0, z0), SIMD3(x1, y0, z0), SIMD3(x1, y0, z1), SIMD3(x0, y0, z1))
        quad(SIMD3(x0, y0, z1), SIMD3(x1, y0, z1), SIMD3(x1, y1, z1), SIMD3(x0, y1, z1))
        quad(SIMD3(x1, y0, z0), SIMD3(x0, y0, z0), SIMD3(x0, y1, z0), SIMD3(x1, y1, z0))
        quad(SIMD3(x1, y0, z1), SIMD3(x1, y0, z0), SIMD3(x1, y1, z0), SIMD3(x1, y1, z1))
        quad(SIMD3(x0, y0, z0), SIMD3(x0, y0, z1), SIMD3(x0, y1, z1), SIMD3(x0, y1, z0))
    }

    func geometry(_ material: SCNMaterial) -> SCNGeometry {
        func source(_ a: [Float], _ s: SCNGeometrySource.Semantic, _ k: Int) -> SCNGeometrySource {
            SCNGeometrySource(data: a.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: s, vectorCount: a.count / k,
                              usesFloatComponents: true, componentsPerVector: k, bytesPerComponent: 4, dataOffset: 0, dataStride: 4 * k)
        }
        let indices = (0..<UInt32(pos.count / 3)).map { $0 }
        let g = SCNGeometry(sources: [source(pos, .vertex, 3), source(nor, .normal, 3), source(uv, .texcoord, 2)],
                            elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
        g.materials = [material]
        return g
    }
}

/// Boxes and faces of many materials, drawn as one node with a mesh for each.
final class HouseBatch {
    private var meshes: [ObjectIdentifier: (SCNMaterial, HouseMesh)] = [:]

    func mesh(_ m: SCNMaterial) -> HouseMesh {
        if let hit = meshes[ObjectIdentifier(m)] { return hit.1 }
        let mesh = HouseMesh()
        meshes[ObjectIdentifier(m)] = (m, mesh)
        return mesh
    }

    func box(_ lo: SIMD3<Float>, _ hi: SIMD3<Float>, _ m: SCNMaterial) { mesh(m).box(lo, hi) }

    func node(shadows: Bool = true) -> SCNNode {
        let node = SCNNode()
        for (material, mesh) in meshes.values where !mesh.isEmpty {
            let child = SCNNode(geometry: mesh.geometry(material))
            child.castsShadow = shadows && material !== HouseLook.glass
            node.addChildNode(child)
        }
        return node
    }
}
