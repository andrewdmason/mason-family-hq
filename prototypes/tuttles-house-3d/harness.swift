// Render harness for the Tuttles house prototype: one L-shaped kitchen-diner,
// furnished three ways, drawn off screen by SceneKit (the engine the app uses).
//
//   harness <scratchpad> sizes <pack>           print model sizes at the pack's scale
//   harness <scratchpad> render <A|B|C> <out>   A Quaternius, B Tiny Treats, C Kenney (today's kit)

import AppKit
import Metal
import SceneKit
import simd

let args = CommandLine.arguments
let root = args[1]
let mode = args[2]

// MARK: Colour and textures

func srgb(_ r: Float, _ g: Float, _ b: Float, _ a: Float = 1) -> NSColor {
    NSColor(srgbRed: CGFloat(r), green: CGFloat(g), blue: CGFloat(b), alpha: CGFloat(a))
}
func hex(_ h: String) -> NSColor {
    let v = UInt32(h, radix: 16)!
    return srgb(Float((v >> 16) & 255) / 255, Float((v >> 8) & 255) / 255, Float(v & 255) / 255)
}
func fromLinear(_ c: SIMD3<Float>) -> NSColor {
    func f(_ x: Float) -> Float { x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1 / 2.4) - 0.055 }
    return srgb(f(c.x), f(c.y), f(c.z))
}

var images: [String: NSImage] = [:]
func image(_ path: String) -> NSImage {
    if let hit = images[path] { return hit }
    guard let made = NSImage(contentsOfFile: path) else { fatalError("no image at \(path)") }
    images[path] = made
    return made
}
func tex(_ name: String) -> NSImage { image("\(root)/textures/\(name).jpg") }

func tiled(_ p: SCNMaterialProperty, _ contents: Any, _ tile: Float) {
    p.contents = contents
    p.wrapS = .repeat; p.wrapT = .repeat
    p.mipFilter = .linear
    p.maxAnisotropy = 8
    p.contentsTransform = SCNMatrix4MakeScale(CGFloat(1 / tile), CGFloat(1 / tile), 1)
}

/// A photographed surface: colour, bumps and shine from one Poly Haven set, a tile this many metres across.
func surface(_ set: String, tile: Float, tint: NSColor? = nil) -> SCNMaterial {
    let m = SCNMaterial()
    m.lightingModel = .physicallyBased
    tiled(m.diffuse, tex("\(set)_diff"), tile)
    tiled(m.normal, tex("\(set)_nor"), tile)
    tiled(m.roughness, tex("\(set)_rough"), tile)
    m.metalness.contents = NSNumber(value: 0)
    if let tint { m.multiply.contents = tint }
    return m
}

/// A plain colour with a finish.
func plain(_ color: NSColor, rough: Float = 0.6, metal: Float = 0) -> SCNMaterial {
    let m = SCNMaterial()
    m.lightingModel = .physicallyBased
    m.diffuse.contents = color
    m.roughness.contents = NSNumber(value: rough)
    m.metalness.contents = NSNumber(value: metal)
    return m
}

/// Cloth: any colour, with a weave you can see up close.
func cloth(_ color: NSColor) -> SCNMaterial {
    let m = plain(color, rough: 0.95)
    tiled(m.normal, tex("fabric_pattern_07_nor"), 0.35)
    m.normal.intensity = 0.8
    return m
}

func glass() -> SCNMaterial {
    let m = plain(srgb(0.75, 0.88, 0.95), rough: 0.05)
    m.transparency = 0.28
    m.isDoubleSided = true
    m.writesToDepthBuffer = false
    return m
}

func glowing(_ color: NSColor) -> SCNMaterial {
    let m = plain(color, rough: 0.5)
    m.emission.contents = color
    m.emission.intensity = 1.6
    return m
}

// MARK: Meshes

final class Mesh {
    var pos: [Float] = [], nor: [Float] = [], uv: [Float] = []
    var count: Int { pos.count / 3 }

    func add(_ p: SIMD3<Float>, _ n: SIMD3<Float>, _ t: SIMD2<Float>) {
        pos += [p.x, p.y, p.z]; nor += [n.x, n.y, n.z]; uv += [t.x, t.y]
    }

    /// A flat four-cornered face, its texture laid out in metres.
    func quad(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, _ d: SIMD3<Float>) {
        let n = simd_normalize(simd_cross(b - a, c - a))
        for p in [a, b, c, a, c, d] { add(p, n, boxUV(p, n)) }
    }

    func geometry(_ material: SCNMaterial) -> SCNGeometry {
        func source(_ a: [Float], _ s: SCNGeometrySource.Semantic, _ k: Int) -> SCNGeometrySource {
            SCNGeometrySource(data: a.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: s, vectorCount: a.count / k,
                              usesFloatComponents: true, componentsPerVector: k, bytesPerComponent: 4, dataOffset: 0, dataStride: 4 * k)
        }
        let indices = (0..<UInt32(count)).map { $0 }
        let element = SCNGeometryElement(indices: indices, primitiveType: .triangles)
        let g = SCNGeometry(sources: [source(pos, .vertex, 3), source(nor, .normal, 3), source(uv, .texcoord, 2)], elements: [element])
        g.materials = [material]
        return g
    }
}

/// Where a point's texture falls when it's laid on flat from whichever side the face looks to.
func boxUV(_ p: SIMD3<Float>, _ n: SIMD3<Float>) -> SIMD2<Float> {
    let a = simd_abs(n)
    if a.y >= a.x && a.y >= a.z { return SIMD2(p.x, p.z) }
    if a.x >= a.z { return SIMD2(p.z, -p.y) }
    return SIMD2(p.x, -p.y)
}

/// A box between two corners.
func box(_ lo: SIMD3<Float>, _ hi: SIMD3<Float>, _ m: SCNMaterial, shadow: Bool = true) -> SCNNode {
    let mesh = Mesh()
    let (x0, y0, z0, x1, y1, z1) = (lo.x, lo.y, lo.z, hi.x, hi.y, hi.z)
    mesh.quad(SIMD3(x0, y1, z0), SIMD3(x0, y1, z1), SIMD3(x1, y1, z1), SIMD3(x1, y1, z0))   // top
    mesh.quad(SIMD3(x0, y0, z0), SIMD3(x1, y0, z0), SIMD3(x1, y0, z1), SIMD3(x0, y0, z1))   // bottom
    mesh.quad(SIMD3(x0, y0, z1), SIMD3(x1, y0, z1), SIMD3(x1, y1, z1), SIMD3(x0, y1, z1))   // +z
    mesh.quad(SIMD3(x1, y0, z0), SIMD3(x0, y0, z0), SIMD3(x0, y1, z0), SIMD3(x1, y1, z0))   // -z
    mesh.quad(SIMD3(x1, y0, z1), SIMD3(x1, y0, z0), SIMD3(x1, y1, z0), SIMD3(x1, y1, z1))   // +x
    mesh.quad(SIMD3(x0, y0, z0), SIMD3(x0, y0, z1), SIMD3(x0, y1, z1), SIMD3(x0, y1, z0))   // -x
    let node = SCNNode(geometry: mesh.geometry(m))
    node.castsShadow = shadow
    return node
}

// MARK: Models (.obj)

struct Part {
    var name: String
    var kd = SIMD3<Float>(0.8, 0.8, 0.8)
    var map: String?
    var tris: [(SIMD3<Float>, SIMD3<Float>, SIMD2<Float>?)] = []
}

struct Model {
    var parts: [Part]
    var lo: SIMD3<Float>, hi: SIMD3<Float>
}

var models: [String: Model] = [:]

func loadOBJ(_ path: String) -> Model {
    if let hit = models[path] { return hit }
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { fatalError("no model at \(path)") }
    let folder = (path as NSString).deletingLastPathComponent
    var kds: [String: SIMD3<Float>] = [:], maps: [String: String] = [:]
    var v: [SIMD3<Float>] = [], vn: [SIMD3<Float>] = [], vt: [SIMD2<Float>] = []
    var parts: [Part] = [], current = -1
    func floats(_ f: [Substring]) -> [Float] { f.dropFirst().compactMap { Float($0) } }
    for line in text.split(whereSeparator: \.isNewline) {
        let f = line.split(separator: " ", omittingEmptySubsequences: true)
        guard let head = f.first else { continue }
        switch head {
        case "mtllib":
            let file = line.dropFirst(7).trimmingCharacters(in: .whitespaces)
            var name = ""
            for l in ((try? String(contentsOfFile: "\(folder)/\(file)", encoding: .utf8)) ?? "").split(whereSeparator: \.isNewline) {
                let g = l.split(separator: " ", omittingEmptySubsequences: true)
                guard let h = g.first else { continue }
                if h == "newmtl" { name = l.dropFirst(7).trimmingCharacters(in: .whitespaces) }
                if h == "Kd" { let c = floats(g); kds[name] = SIMD3(c[0], c[1], c[2]) }
                if h == "map_Kd" { maps[name] = "\(folder)/" + l.dropFirst(7).trimmingCharacters(in: .whitespaces) }
            }
        case "v": let c = floats(f); v.append(SIMD3(c[0], c[1], c[2]))
        case "vn": let c = floats(f); vn.append(SIMD3(c[0], c[1], c[2]))
        case "vt": let c = floats(f); vt.append(SIMD2(c[0], 1 - c[1]))
        case "usemtl":
            let name = line.dropFirst(7).trimmingCharacters(in: .whitespaces)
            if let at = parts.firstIndex(where: { $0.name == name }) { current = at } else {
                parts.append(Part(name: name, kd: kds[name] ?? SIMD3(0.8, 0.8, 0.8), map: maps[name]))
                current = parts.count - 1
            }
        case "f":
            if current < 0 { parts.append(Part(name: "none")); current = 0 }
            var corners: [(SIMD3<Float>, SIMD3<Float>?, SIMD2<Float>?)] = []
            for c in f.dropFirst() {
                let ix = c.split(separator: "/", omittingEmptySubsequences: false).map { Int($0) }
                func at<T>(_ list: [T], _ i: Int??) -> T? {
                    guard let i = i ?? nil else { return nil }
                    let k = i > 0 ? i - 1 : list.count + i
                    return list.indices.contains(k) ? list[k] : nil
                }
                guard let p = at(v, ix[0]) else { continue }
                corners.append((p, ix.count > 2 ? at(vn, ix[2]) : nil, ix.count > 1 ? at(vt, ix[1]) : nil))
            }
            guard corners.count >= 3 else { continue }
            let flat = simd_normalize(simd_cross(corners[1].0 - corners[0].0, corners[2].0 - corners[0].0))
            for i in 1..<corners.count - 1 {
                for c in [corners[0], corners[i], corners[i + 1]] { parts[current].tris.append((c.0, c.1 ?? flat, c.2)) }
            }
        default: break
        }
    }
    var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = -lo
    for p in parts { for t in p.tris { lo = simd_min(lo, t.0); hi = simd_max(hi, t.0) } }
    let made = Model(parts: parts, lo: lo, hi: hi)
    models[path] = made
    return made
}

// MARK: The three kits

struct Kit {
    let folder: String
    let scale: Float
    /// Quarter-turns to bring a model's front round to face +z.
    let front: Float
    let material: (Part) -> SCNMaterial
}

var woodTone: NSColor? = nil
/// Cloth colours for the piece being made, by part name.
var recolour: [String: NSColor] = [:]
let oak = { surface("oak_veneer_01", tile: 0.9, tint: woodTone) }
let walnut = { surface("walnut_veneer_02", tile: 0.9) }
let steel = { plain(srgb(0.78, 0.79, 0.8), rough: 0.32, metal: 1) }

let quaternius = Kit(folder: "\(root)/quaternius/Ultimate House Interior Pack - June 2020/OBJ", scale: 0.485, front: 0) { part in
    let n = part.name
    switch n {
    case "Wood", "Wood_Light", "Brown": return oak()
    case "Wood_Dark": return walnut()
    case "White", "White.001", "White.002": return plain(srgb(0.94, 0.94, 0.92), rough: 0.4)
    case "Black": return plain(srgb(0.04, 0.04, 0.045), rough: 0.18)
    case "Metal", "Metal.001", "LightMetal": return steel()
    case "DarkMetal": return plain(srgb(0.25, 0.25, 0.26), rough: 0.35, metal: 1)
    case "Gold": return plain(srgb(0.85, 0.65, 0.3), rough: 0.3, metal: 1)
    case "Glass": return glass()
    case "Mirror": return plain(srgb(0.92, 0.94, 0.95), rough: 0.03, metal: 1)
    case "Marble": return surface("marble_01", tile: 1.2)
    case "KitchenTop": return plain(hex("ece7dc"), rough: 0.25)
    case "Kitchen": return plain(hex("5d7a6c"), rough: 0.38)
    case "Light": return glowing(srgb(1, 0.93, 0.78))
    case "Plant_Green", "DarkGreen" where part.kd.y > part.kd.x * 1.5: return plain(fromLinear(part.kd), rough: 0.7)
    case "Grey": return plain(fromLinear(part.kd), rough: 0.6)
    default: return cloth(recolour[n] ?? fromLinear(part.kd))
    }
}

let kenney = Kit(folder: "\(root)/kenney", scale: 2.0, front: 0) { part in
    let c = srgb(part.kd.x, part.kd.y, part.kd.z)
    switch part.name {
    case "wood": return oak()
    case "woodDark": return walnut()
    case "metal", "metalLight": return part.name == "metal" ? steel() : plain(srgb(0.94, 0.95, 0.94), rough: 0.4)
    case "metalDark", "metalMedium": return plain(c, rough: 0.35, metal: 1)
    case "glass": return glass()
    case "lamp": return glowing(srgb(1, 0.93, 0.78))
    case "plant": return plain(hex("4f8a3c"), rough: 0.7)
    case "carpet", "carpetBlue", "carpetWhite", "fur": return cloth(recolour[part.name] ?? c)
    default: return plain(c, rough: 0.5)
    }
}

let tinyTreats = Kit(folder: "\(root)/tt", scale: 0.7, front: 0) { part in
    if part.name.hasSuffix("GLASS") { return glass() }
    let m = plain(.white, rough: 0.62)
    if let map = part.map {
        m.diffuse.contents = image(map)
        m.diffuse.mipFilter = .none
        m.diffuse.magnificationFilter = .linear
        m.diffuse.wrapS = .clamp; m.diffuse.wrapT = .clamp
    }
    return m
}

var materials: [String: SCNMaterial] = [:]

/// A model standing on the floor with its middle over the origin, at its kit's scale; and how big it is.
func piece(_ kit: Kit, _ name: String, by mult: Float = 1) -> (node: SCNNode, size: SIMD3<Float>) {
    let model = loadOBJ("\(kit.folder)/\(name).obj")
    let s = kit.scale * mult
    let middle = SIMD3((model.lo.x + model.hi.x) / 2, model.lo.y, (model.lo.z + model.hi.z) / 2)
    let inner = SCNNode()
    for part in model.parts where !part.tris.isEmpty {
        let mesh = Mesh()
        for (p, n, t) in part.tris {
            let q = (p - middle) * s
            mesh.add(q, n, t ?? boxUV(q, n))
        }
        let key = "\(kit.folder)|\(part.name)|\(part.kd)|\(woodTone?.description ?? "")|\(recolour[part.name]?.description ?? "")"
        let material = materials[key] ?? kit.material(part)
        materials[key] = material
        inner.addChildNode(SCNNode(geometry: mesh.geometry(material)))
    }
    inner.simdEulerAngles.y = kit.front * .pi / 2
    let holder = SCNNode()
    holder.addChildNode(inner)
    var size = (model.hi - model.lo) * s
    if Int(kit.front) % 2 != 0 { size = SIMD3(size.z, size.y, size.x) }
    return (holder, size)
}

// MARK: The room

let scene = SCNScene()
let house = SCNNode()
scene.rootNode.addChildNode(house)

let wallHeight: Float = 2.7, thick: Float = 0.14, stub: Float = 0.2

struct Look {
    var floor = surface("laminate_floor_02", tile: 2.4)
    var paint = hex("f1eadc")
}

func buildShell(_ look: Look) {
    let paint = plain(look.paint, rough: 0.85)
    tiled(paint.normal, tex("painted_plaster_wall_nor"), 2.5)
    paint.normal.intensity = 0.6
    let cap = plain(hex("3a3530"), rough: 0.8)
    let trim = plain(hex("f4f1ea"), rough: 0.45)
    let slab = plain(hex("b9b2a6"), rough: 0.9)

    // The floor, L-shaped: the kitchen-diner along the back, and a leg down the left.
    house.addChildNode(box(SIMD3(-thick, -0.25, -thick), SIMD3(7 + thick, -0.004, 3.2 + thick), slab))
    house.addChildNode(box(SIMD3(-thick, -0.25, 3.2), SIMD3(4.2 + thick, -0.004, 5.6 + thick), slab))
    for (lo, hi) in [(SIMD2<Float>(0, 0), SIMD2<Float>(7, 3.2)), (SIMD2(0, 3.2), SIMD2(4.2, 5.6))] {
        let mesh = Mesh()
        mesh.quad(SIMD3(lo.x, 0, lo.y), SIMD3(lo.x, 0, hi.y), SIMD3(hi.x, 0, hi.y), SIMD3(hi.x, 0, lo.y))
        house.addChildNode(SCNNode(geometry: mesh.geometry(look.floor)))
    }

    /// A wall along x (at z) or along z (at x), with holes: (from, to, sill, top).
    func wall(alongX: Bool, at: Float, from: Float, to: Float, height: Float, inward: Float, holes: [(Float, Float, Float, Float)] = []) {
        let (a, b) = (min(at, at + inward * -thick), max(at, at + inward * -thick))
        func run(_ u0: Float, _ u1: Float, _ y0: Float, _ y1: Float, _ m: SCNMaterial) {
            guard u1 > u0, y1 > y0 else { return }
            let lo = alongX ? SIMD3(u0, y0, a) : SIMD3(a, y0, u0), hi = alongX ? SIMD3(u1, y1, b) : SIMD3(b, y1, u1)
            house.addChildNode(box(lo, hi, m))
        }
        var u = from
        for (h0, h1, sill, top) in holes.sorted(by: { $0.0 < $1.0 }) {
            run(u, h0, 0, height, paint)
            run(h0, h1, 0, min(sill, height), paint)
            run(h0, h1, top, height, paint)
            u = h1
        }
        run(u, to, 0, height, paint)
        // The dark line along the top of a wall, as a cut-away house has.
        var v = from
        for (h0, h1, sill, top) in holes.sorted(by: { $0.0 < $1.0 }) where top >= height {
            run(v, h0, height, height + 0.015, cap)
            if sill > 0 { run(h0, h1, sill, sill + 0.015, cap) }
            v = h1
        }
        run(v, to, height, height + 0.015, cap)
    }

    // The two walls behind stand whole; the four in front are cut down to see over.
    wall(alongX: true, at: 0, from: -thick, to: 7 + thick, height: wallHeight, inward: 1, holes: [(2.25, 3.85, 1.08, 2.2)])
    wall(alongX: false, at: 0, from: 0, to: 5.6 + thick, height: wallHeight, inward: 1, holes: [(3.55, 5.05, 0.75, 2.2)])
    wall(alongX: false, at: 7, from: 0, to: 3.2 + thick, height: stub, inward: -1)
    wall(alongX: true, at: 3.2, from: 4.2 + thick, to: 7, height: stub, inward: -1, holes: [(5.15, 6.05, 0, stub)])
    wall(alongX: false, at: 4.2, from: 3.2, to: 5.6 + thick, height: stub, inward: -1)
    wall(alongX: true, at: 5.6, from: -thick, to: 4.2, height: stub, inward: -1)

    // Skirting along the whole walls.
    house.addChildNode(box(SIMD3(0, 0, 0), SIMD3(7, 0.09, 0.016), trim, shadow: false))
    house.addChildNode(box(SIMD3(0, 0, 0), SIMD3(0.016, 0.09, 5.6), trim, shadow: false))

    /// A window in a hole: its frame, a cross of glazing bars, and the glass.
    func window(alongX: Bool, at: Float, from: Float, to: Float, sill: Float, top: Float) {
        let f: Float = 0.05, depth: Float = 0.1
        func bit(_ u0: Float, _ u1: Float, _ y0: Float, _ y1: Float, _ d0: Float, _ d1: Float, _ m: SCNMaterial) {
            let lo = alongX ? SIMD3(u0, y0, at + d0) : SIMD3(at + d0, y0, u0), hi = alongX ? SIMD3(u1, y1, at + d1) : SIMD3(at + d1, y1, u1)
            house.addChildNode(box(lo, hi, m, shadow: m !== pane))
        }
        let back = -thick + 0.02
        bit(from, to, sill, sill + f, back, back + depth, trim); bit(from, to, top - f, top, back, back + depth, trim)
        bit(from, from + f, sill, top, back, back + depth, trim); bit(to - f, to, sill, top, back, back + depth, trim)
        let mid = (from + to) / 2, half = (sill + top) / 2
        bit(mid - 0.02, mid + 0.02, sill, top, back + 0.03, back + 0.07, trim)
        bit(from, to, half - 0.02, half + 0.02, back + 0.03, back + 0.07, trim)
        bit(from + f, to - f, sill + f, top - f, back + 0.045, back + 0.055, pane)
        // The sill, standing out into the room a little.
        bit(from - 0.04, to + 0.04, sill - 0.03, sill, -thick, 0.06, trim)
    }
    window(alongX: true, at: 0, from: 2.25, to: 3.85, sill: 1.08, top: 2.2)
    window(alongX: false, at: 0, from: 3.55, to: 5.05, sill: 0.75, top: 2.2)

    // A door standing in the cut-down wall, in its frame.
    let door = piece(quaternius, "Door_1")
    door.node.simdPosition = SIMD3(5.6, 0, 3.2 + thick / 2)
    house.addChildNode(door.node)
    house.addChildNode(box(SIMD3(5.13, 0, 3.2 - 0.01), SIMD3(5.18, 2.1, 3.2 + thick + 0.01), trim))
    house.addChildNode(box(SIMD3(6.02, 0, 3.2 - 0.01), SIMD3(6.07, 2.1, 3.2 + thick + 0.01), trim))
    house.addChildNode(box(SIMD3(5.13, 2.05, 3.2 - 0.01), SIMD3(6.07, 2.1, 3.2 + thick + 0.01), trim))
}
let pane = glass()

func buildOutside() {
    let grass = surface("leafy_grass", tile: 3.0, tint: hex("c9e0b0"))
    let mesh = Mesh()
    let far: Float = 60
    mesh.quad(SIMD3(-far, -0.25, -far), SIMD3(-far, -0.25, far), SIMD3(far, -0.25, far), SIMD3(far, -0.25, -far))
    let lawn = SCNNode(geometry: mesh.geometry(grass))
    lawn.castsShadow = false
    scene.rootNode.addChildNode(lawn)
    // A path from the door.
    let stone = plain(hex("cfc8ba"), rough: 0.9)
    house.addChildNode(box(SIMD3(5.15, -0.25, 3.2 + thick), SIMD3(6.05, -0.2, 9), stone))
}

// MARK: Putting things in it

var kit = quaternius

@discardableResult
func put(_ name: String, x: Float, z: Float, turn: Float = 0, y: Float = 0, by mult: Float = 1, from other: Kit? = nil) -> SIMD3<Float> {
    let made = piece(other ?? kit, name, by: mult)
    made.node.simdPosition = SIMD3(x, y, z)
    made.node.simdEulerAngles.y = turn * .pi / 2
    house.addChildNode(made.node)
    return made.size
}

/// Against the back wall, its left edge at x; returns where its right edge is.
@discardableResult
func north(_ name: String, x: Float, y: Float = 0, by mult: Float = 1, gap: Float = 0.03) -> Float {
    let made = piece(kit, name, by: mult)
    made.node.simdPosition = SIMD3(x + made.size.x / 2, y, made.size.z / 2 + gap)
    house.addChildNode(made.node)
    return x + made.size.x
}

/// Against the left wall, facing into the room, its near edge at z; returns where its far edge is.
@discardableResult
func west(_ name: String, z: Float, y: Float = 0, by mult: Float = 1, gap: Float = 0.03) -> Float {
    let made = piece(kit, name, by: mult)
    made.node.simdEulerAngles.y = .pi / 2
    made.node.simdPosition = SIMD3(made.size.z / 2 + gap, y, z + made.size.x / 2)
    house.addChildNode(made.node)
    return z + made.size.x
}

func lamp(x: Float, y: Float, z: Float, _ lumens: CGFloat = 7) {
    let n = SCNNode()
    n.light = SCNLight()
    n.light!.type = .omni
    n.light!.color = hex("ffd9a0")
    n.light!.intensity = lumens
    n.light!.attenuationStartDistance = 0.3
    n.light!.attenuationEndDistance = 3.0
    n.simdPosition = SIMD3(x, y, z)
    house.addChildNode(n)
}

func furnishQuaternius() {
    kit = quaternius
    let k: Float = 1.14   // kitchen units: 0.9 m worktops, 0.56 m wide
    var x = north("Kitchen_Fridge", x: 0.12, by: 1.15)
    x = north("Kitchen_3Drawers", x: x + 0.02, by: k)
    x = north("Kitchen_Cabinet1", x: x, by: k)
    x = north("Kitchen_2Drawers", x: x, by: k)
    x = north("Kitchen_Sink", x: x, by: k)
    x = north("Kitchen_1Drawers", x: x, by: k)
    x = north("Kitchen_Oven", x: x, by: k)
    // The sitting end, to the right.
    recolour = ["DarkRed": hex("d8ccb6"), "LightOrange": hex("7f9480")]
    put("Carpet_2", x: 5.75, z: 1.95, y: 0.004, by: 1.45)
    recolour = [:]
    north("Couch_Medium1", x: 4.78, by: 0.95)
    put("Table_RoundSmall2", x: 5.75, z: 2.05, by: 0.8)
    put("Light_Floor1", x: 6.78, z: 2.6, by: 2.0)
    lamp(x: 6.6, y: 1.5, z: 2.5)
    put("Houseplant_3", x: 4.5, z: 0.25, by: 2.3)
    // The dining end, down the left.
    west("Shelf_Large", z: 1.0, by: 0.9)
    put("Houseplant_1", x: 0.45, z: 5.1, by: 2.4)
    recolour = ["DarkRed": hex("c26b47"), "LightOrange": hex("ead9bd")]
    put("Carpet_Round", x: 2.2, z: 4.3, y: 0.004, by: 2.0)
    recolour = [:]
    let top = put("Table_RoundSmall", x: 2.2, z: 4.3, by: 1.32).y
    for (dx, dz, t) in [(Float(0), Float(-0.84), Float(0)), (0.84, 0, 3), (0, 0.84, 2), (-0.84, 0, 1)] {
        put("Chair_1", x: 2.2 + dx, z: 4.3 + dz, turn: t, by: 1.05)
        put("Plate_1", x: 2.2 + dx * 0.5, z: 4.3 + dz * 0.5, y: top, by: 1.3)
    }
}

func furnishKenney() {
    kit = kenney
    var x = north("kitchenFridgeLarge", x: 0.12, by: 0.85)
    x = north("kitchenCabinetDrawer", x: x + 0.02, by: 0.72)
    x = north("kitchenCabinet", x: x, by: 0.72)
    x = north("kitchenSink", x: x, by: 0.72)
    x = north("kitchenCabinetDrawer", x: x, by: 0.72)
    x = north("kitchenStove", x: x, by: 0.72)
    house.addChildNode(box(SIMD3(4.65, 0.002, 0.85), SIMD3(6.85, 0.014, 3.05), cloth(hex("d8ccb6")), shadow: false))
    recolour = ["carpet": hex("31475a")]
    north("loungeSofa", x: 4.78, by: 1.1)
    recolour = [:]
    put("tableCoffee", x: 5.75, z: 2.05, by: 0.75)
    put("lampRoundFloor", x: 6.78, z: 2.6)
    lamp(x: 6.6, y: 1.5, z: 2.5)
    put("pottedPlant", x: 4.45, z: 0.3, by: 0.8)
    west("bookcaseOpen", z: 1.0, by: 1.1)
    west("bookcaseOpen", z: 1.9, by: 1.1)
    put("pottedPlant", x: 0.45, z: 5.1)
    let disc = SCNNode(geometry: SCNCylinder(radius: 1.2, height: 0.012))
    disc.geometry!.materials = [cloth(hex("c26b47"))]
    disc.simdPosition = SIMD3(2.2, 0.008, 4.3)
    disc.castsShadow = false
    house.addChildNode(disc)
    put("tableRound", x: 2.2, z: 4.3, by: 0.8)
    for (dx, dz, t) in [(Float(0), Float(-0.84), Float(0)), (0.84, 0, 3), (0, 0.84, 2), (-0.84, 0, 1)] {
        put("chair", x: 2.2 + dx, z: 4.3 + dz, turn: t)
    }
}

func furnishTinyTreats() {
    kit = tinyTreats
    let k: Float = 1.1
    var x = north("fridge", x: 0.12, by: k)
    let sink = x + 0.02
    x = north("countertop_sink", x: sink, by: k)
    let stove = x
    x = north("stove", x: x, by: k)
    let last = x
    x = north("countertop_straight_B", x: x, by: k)
    let top: Float = 0.7 * k
    put("extractor_hood", x: stove + 0.77, z: 0.62, y: 1.75, by: k)
    put("wall_cabinet_straight", x: last + 0.77, z: 0.4, y: 1.75, by: k)
    put("kettle", x: last + 0.45, z: 0.55, y: top, by: k)
    put("toaster", x: last + 1.15, z: 0.5, y: top, by: k)
    put("pot", x: stove + 0.5, z: 0.6, y: 0.91 * k, by: k)
    put("utensils_cup", x: sink + 0.25, z: 0.3, y: top, by: k)
    put("mug_blue", x: sink + 0.3, z: 0.8, y: top, by: k)
    put("container_kitchen_A_blue", x: last + 0.3, z: 0.3, y: top, by: k)
}

// MARK: Light and the camera

func light() {
    // The sky, as something to be lit by and reflect.
    let size = NSSize(width: 512, height: 256)
    let sky = NSImage(size: size)
    sky.lockFocus()
    NSGradient(colorsAndLocations: (hex("5f6b52"), 0), (hex("8f9a86"), 0.45), (hex("e8eef5"), 0.52), (hex("a9c9f0"), 0.75), (hex("6fa3e6"), 1))!
        .draw(in: NSRect(origin: .zero, size: size), angle: 90)
    sky.unlockFocus()
    scene.lightingEnvironment.contents = sky
    scene.lightingEnvironment.intensity = 0.75
    scene.background.contents = hex("bcd7f2")

    let sun = SCNNode()
    sun.light = SCNLight()
    sun.light!.type = .directional
    sun.light!.color = hex("fff1dc")
    sun.light!.intensity = 2600
    sun.light!.castsShadow = true
    sun.light!.shadowMode = .forward
    sun.light!.shadowMapSize = CGSize(width: 4096, height: 4096)
    sun.light!.shadowSampleCount = 16
    sun.light!.shadowRadius = 3
    sun.light!.shadowColor = NSColor(white: 0, alpha: 0.75)
    sun.light!.automaticallyAdjustsShadowProjection = true
    sun.light!.shadowCascadeCount = 4
    sun.light!.shadowCascadeSplittingFactor = 0.5
    sun.light!.maximumShadowDistance = 45
    sun.light!.shadowBias = 1
    sun.simdPosition = SIMD3(16, 15, 11.5)
    sun.look(at: SCNVector3(3.5, 0, 2.8))
    scene.rootNode.addChildNode(sun)
}

func camera(aspect: Float) -> SCNNode {
    let node = SCNNode()
    let c = SCNCamera()
    c.fieldOfView = 27
    c.zNear = 0.5; c.zFar = 120
    c.wantsHDR = true
    c.wantsExposureAdaptation = false
    c.exposureOffset = -0.75
    c.screenSpaceAmbientOcclusionIntensity = 1.8
    c.screenSpaceAmbientOcclusionRadius = 0.45
    c.screenSpaceAmbientOcclusionBias = 0.03
    c.screenSpaceAmbientOcclusionDepthThreshold = 0.25
    c.screenSpaceAmbientOcclusionNormalThreshold = 0.3
    c.bloomIntensity = 0.25
    c.bloomThreshold = 0.95
    node.camera = c
    node.simdPosition = SIMD3(12.2, 10.6, 13.2)
    node.look(at: SCNVector3(3.6, 0.55, 2.6))
    scene.rootNode.addChildNode(node)
    return node
}

// MARK: Run

if mode == "sizes" {
    let which = ["A": quaternius, "B": tinyTreats, "C": kenney][args[3]]!
    let names = (try! FileManager.default.contentsOfDirectory(atPath: which.folder)).filter { $0.hasSuffix(".obj") }.sorted()
    for n in names {
        let m = loadOBJ("\(which.folder)/\(n)")
        let s = (m.hi - m.lo) * which.scale
        print(String(format: "%-36@ w %.2f  h %.2f  d %.2f   %@", String(n.dropLast(4)) as NSString, s.x, s.y, s.z, m.parts.map(\.name).joined(separator: ",") as NSString))
    }
    exit(0)
}

let which = args[3], out = args[4]
buildOutside()
buildShell(Look())
switch which {
case "A": furnishQuaternius()
case "B": furnishTinyTreats()
default: furnishKenney()
}
light()

let size = CGSize(width: 1800, height: 1200)
let eye = camera(aspect: Float(size.width / size.height))
let renderer = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil)
renderer.scene = scene
renderer.pointOfView = eye
let shot = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
guard let tiff = shot.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { fatalError("no picture") }
try! png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
