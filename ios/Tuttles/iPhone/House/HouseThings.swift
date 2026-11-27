import SceneKit
import UIKit

// The things in a house's rooms, as models. A kit piece is Kenney's, or
// Quaternius's where that pack has a better one of the same thing
// (`HouseKit.better`); either way its wood and its cloth are the room's own
// colours, and its lamp is on after dark. Everything else (rugs, pictures,
// pets, what's built in code) is HouseProps's, lit the way the house is.

/// A room's own colours for what's in it, and whether its lamps are on.
struct HouseFinish: Equatable {
    var wood = "e69963"
    var woodDark = "ad754c"
    var woodGlow = 0.0
    var fabric = "ef5e57"
    var fabricGlow = 0.0
    var lit = false
}

enum HouseKit {
    private struct Part {
        let name: String
        let color: SIMD3<Float>
        var tris: [(SIMD3<Float>, SIMD3<Float>)] = []
    }

    private struct Model {
        var parts: [Part]
        var lo: SIMD3<Float>, hi: SIMD3<Float>
    }

    /// The kit's pieces that the other pack has a better one of: its name there, and what it's grown by (its pieces aren't all to one scale).
    static let better: [String: (String, Float)] = [
        "bedSingle": ("Bed_Single", 1.05), "bedDouble": ("Bed_King", 1.1), "bedBunk": ("Bed_Bunk", 1.05),
        "loungeSofa": ("Couch_Medium2", 0.9), "loungeSofaLong": ("Couch_Large1", 0.9), "loungeChair": ("Couch_Small1", 0.8),
        "toilet": ("Bathroom_Toilet", 1), "bathroomSink": ("Bathroom_Sink", 1), "washer": ("Bathroom_WashingMachine", 1.2),
        "pottedPlant": ("Houseplant_1", 2.3), "bookcaseOpen": ("Bookshelf", 0.8),
        "chair": ("Chair_1", 1.05), "tableRound": ("Table_RoundSmall", 1.32), "trashcan": ("Trashcan_Cylindric", 1),
    ]

    private static var models: [String: Model] = [:]

    /// Where a piece's model is, what it's grown by to be the size of the real thing, and which pack it's from.
    private static func source(_ name: String) -> (path: String, scale: Float, quaternius: Bool) {
        if let (other, by) = better[name] { return ("house3d/\(other)", 0.485 * by, true) }
        return ("furniture/\(name)", HouseProps.kitScale, false)
    }

    /// A model's triangles by material, with every part where the file puts it.
    private static func load(_ path: String) -> Model? {
        if let hit = models[path] { return hit }
        guard let glb = MathModels.file(path) else { return nil }
        let materials = glb.json["materials"] as? [[String: Any]] ?? []
        var parts: [Part] = []
        var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = -lo

        func walk(_ index: Int, _ parent: simd_float4x4) {
            guard glb.nodes.indices.contains(index) else { return }
            let n = glb.nodes[index]
            let placed = SCNNode()
            GLB.place(placed, from: n)
            let here = parent * placed.simdTransform
            if let mesh = n["mesh"] as? Int {
                for piece in glb.pieces(ofMesh: mesh) {
                    let m = piece.material.flatMap { materials.indices.contains($0) ? materials[$0] : nil }
                    let name = m?["name"] as? String ?? "none"
                    let f = (m?["pbrMetallicRoughness"] as? [String: Any])?["baseColorFactor"] as? [Double] ?? [0.8, 0.8, 0.8]
                    var at = parts.firstIndex { $0.name == name }
                    if at == nil { parts.append(Part(name: name, color: SIMD3(Float(f[0]), Float(f[1]), Float(f[2])))); at = parts.count - 1 }
                    let smooth = piece.normals.count == piece.positions.count
                    var i = 0
                    while i + 2 < piece.indices.count {
                        let ix = [Int(piece.indices[i]), Int(piece.indices[i + 1]), Int(piece.indices[i + 2])]
                        i += 3
                        guard ix.allSatisfy({ piece.positions.indices.contains($0) }) else { continue }
                        let p = ix.map { v -> SIMD3<Float> in let w = here * SIMD4(piece.positions[v], 1); return SIMD3(w.x, w.y, w.z) }
                        let flat = simd_normalize(simd_cross(p[1] - p[0], p[2] - p[0]))
                        for k in 0..<3 {
                            var normal = flat
                            if smooth {
                                let w = here * SIMD4(piece.normals[ix[k]], 0)
                                let l = simd_length(SIMD3(w.x, w.y, w.z))
                                if l > 0 { normal = SIMD3(w.x, w.y, w.z) / l }
                            }
                            parts[at!].tris.append((p[k], normal))
                            lo = simd_min(lo, p[k]); hi = simd_max(hi, p[k])
                        }
                    }
                }
            }
            for child in n["children"] as? [Int] ?? [] { walk(child, here) }
        }
        let scenes = glb.json["scenes"] as? [[String: Any]] ?? []
        let which = glb.json["scene"] as? Int ?? 0
        let tops = (scenes.indices.contains(which) ? scenes[which]["nodes"] as? [Int] : nil) ?? [0]
        for top in tops { walk(top, matrix_identity_float4x4) }
        guard !parts.isEmpty else { return nil }
        let model = Model(parts: parts, lo: lo, hi: hi)
        models[path] = model
        return model
    }

    /// What a part of a model is made of, by what its pack calls it, in the room's colours.
    private static func material(_ quaternius: Bool, _ part: Part, _ finish: HouseFinish) -> SCNMaterial {
        let L = HouseLook.self
        let wood = L.wood(finish.wood, glow: finish.woodGlow), dark = L.wood(finish.woodDark, glow: finish.woodGlow)
        let cloth = L.cloth(finish.fabric, glow: finish.fabricGlow)
        let shade = finish.lit ? L.glowing(L.color("ffedc7")) : L.plain(L.color("f4ecd8"), rough: 0.6)
        if quaternius {
            switch part.name {
            case "Wood", "Wood_Light", "Brown": return wood
            case "Wood_Dark": return dark
            case "White", "White.001", "White.002": return L.plain(L.color("f0f0eb"), rough: 0.4)
            case "Black": return L.plain(L.color("0b0b0c"), rough: 0.18)
            case "Metal", "Metal.001", "LightMetal": return L.steel
            case "DarkMetal": return L.plain(L.color("404042"), rough: 0.35, metal: 1)
            case "Gold": return L.plain(L.color("d9a64d"), rough: 0.3, metal: 1)
            case "Glass": return L.glass
            case "Mirror": return L.plain(L.color("ebf0f2"), rough: 0.03, metal: 1)
            case "Marble": return L.surface("marble_01", tile: 1.2, rough: 0.25)
            case "KitchenTop": return L.plain(L.color("ece7dc"), rough: 0.25)
            case "Kitchen": return L.plain(L.color("5d7a6c"), rough: 0.38)
            case "Light": return shade
            case "Plant_Green": return L.plain(L.fromLinear(part.color), rough: 0.7)
            case "DarkGreen" where part.color.y > part.color.x * 1.5: return L.plain(L.fromLinear(part.color), rough: 0.7)
            case "Grey": return L.plain(L.fromLinear(part.color), rough: 0.6)
            case "Red", "Couch_Blue", "Couch_Beige", "Couch_Green", "Couch_Mustard", "Cushin", "LightOrange": return cloth
            // The darker of a piece's two cloths: the same colour, deeper.
            case "DarkRed", "Couch_BeigeDark": return L.cloth(L.color(finish.fabric).shaded(0.78))
            default: return L.cloth(L.fromLinear(part.color))
            }
        }
        // The kit's exporter wrote screen colours straight in (see MathGLB.swift).
        let c = UIColor(red: CGFloat(part.color.x), green: CGFloat(part.color.y), blue: CGFloat(part.color.z), alpha: 1)
        switch part.name {
        case "wood": return wood
        case "woodDark": return dark
        case "carpet", "carpetBlue": return cloth
        case "carpetWhite", "fur": return L.cloth(c)
        case "metal": return L.steel
        case "metalLight": return L.plain(L.color("f0f2f0"), rough: 0.4)
        case "metalDark", "metalMedium": return L.plain(c, rough: 0.35, metal: 1)
        case "glass": return L.glass
        case "lamp": return shade
        case "plant": return L.plain(L.color("4f8a3c"), rough: 0.7)
        default: return L.plain(c, rough: 0.5)
        }
    }

    /// How wide, tall and deep a piece is.
    static func size(_ name: String) -> SIMD3<Float> {
        let from = source(name)
        guard let model = load(from.path) else { return SIMD3(0.8, 0.8, 0.8) }
        return (model.hi - model.lo) * from.scale
    }

    /// A fitting of the house itself from the other pack, by its name there: an inside door.
    static func fitting(_ file: String) -> SCNNode {
        make(("house3d/\(file)", 0.485, true), HouseFinish()).node
    }

    /// A piece of furniture standing on the floor with its middle over the
    /// origin, its front to +z, in the room's colours. With its lamp on,
    /// `glow` is where the light comes from.
    static func piece(_ name: String, _ finish: HouseFinish) -> (node: SCNNode, glow: SIMD3<Float>?) {
        make(source(name), finish)
    }

    private static func make(_ from: (path: String, scale: Float, quaternius: Bool), _ finish: HouseFinish) -> (node: SCNNode, glow: SIMD3<Float>?) {
        guard let model = load(from.path) else {
            // A model that isn't in this build: a plain block where it would stand.
            let batch = HouseBatch()
            batch.box(SIMD3(-0.4, 0, -0.4), SIMD3(0.4, 0.8, 0.4), HouseLook.plain(HouseLook.color("c9c2b2")))
            return (batch.node(), nil)
        }
        let s = from.scale
        let middle = SIMD3((model.lo.x + model.hi.x) / 2, model.lo.y, (model.lo.z + model.hi.z) / 2)
        let node = SCNNode()
        var glow: SIMD3<Float>?
        for part in model.parts where !part.tris.isEmpty {
            let mesh = HouseMesh()
            var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = -lo
            for (p, n) in part.tris {
                let q = (p - middle) * s
                mesh.add(q, n, HouseMesh.boxUV(q, n))
                lo = simd_min(lo, q); hi = simd_max(hi, q)
            }
            if part.name == "lamp" || part.name == "Light" { glow = (lo + hi) / 2 }
            let made = material(from.quaternius, part, finish)
            let child = SCNNode(geometry: mesh.geometry(made))
            child.castsShadow = made !== HouseLook.glass
            node.addChildNode(child)
        }
        return (node, finish.lit ? glow : nil)
    }
}

enum HouseThings {
    /// What hangs from the ceiling, by its top.
    private static let hung: Set<String> = ["ceilingFan", "lampSquareCeiling"]

    /// How far a thing comes out from the wall it's against.
    static func depth(_ item: HouseItem) -> Float {
        switch item.look {
        case .kit(let name, _): HouseKit.size(name).z
        case .stack(let base, _): HouseKit.size(base).z
        case .made("arcade"): 0.8
        case .made("trophies"): HouseKit.size("bookcaseOpen").z
        default: 0.6
        }
    }

    /// How tall a thing stands, for what's put on top of it.
    static func height(_ item: HouseItem) -> Float {
        switch item.look {
        case .kit(let name, _): HouseKit.size(name).y
        case .stack(let base, let on): HouseKit.size(base).y + HouseKit.size(on).y
        default: 0
        }
    }

    /// A lamp's light: warm, and not reaching far.
    private static func light(at p: SIMD3<Float>) -> SCNNode {
        let n = SCNNode()
        n.light = SCNLight()
        n.light?.type = .omni
        n.light?.color = HouseLook.color("ffd29a")
        n.light?.intensity = 16
        n.light?.attenuationStartDistance = 0.4
        n.light?.attenuationEndDistance = 4.5
        n.simdPosition = p
        return n
    }

    /// The thing itself, standing at the origin. Nil for what isn't a thing: paint, a floor, a colour of wood.
    static func make(_ item: HouseItem, _ finish: HouseFinish, sky: HouseSky) -> SCNNode? {
        let node: SCNNode
        switch item.look {
        case .kit(let name, _):
            let made = HouseKit.piece(name, finish)
            node = SCNNode()
            node.addChildNode(made.node)
            if hung.contains(name) { made.node.simdPosition.y = -HouseKit.size(name).y }
            if let glow = made.glow { node.addChildNode(light(at: glow + made.node.simdPosition)) }
        case .stack(let base, let on):
            node = SCNNode()
            let under = HouseKit.piece(base, finish), over = HouseKit.piece(on, finish)
            over.node.simdPosition.y = HouseKit.size(base).y
            node.addChildNode(under.node)
            node.addChildNode(over.node)
            if let glow = over.glow { node.addChildNode(light(at: glow + over.node.simdPosition)) }
        case .food(let name): node = HouseProps.kit(name, folder: "food", scale: 1.6)
        case .tree(let name):
            node = HouseProps.kit(name, folder: "city", scale: 1)
            let s = (name == "tree-large" ? 3.2 : 2.2) / max(0.01, HouseProps.size(name, folder: "city", scale: 1).y)
            node.scale = SCNVector3(s, s, s)
        case .pet(let name): node = HouseProps.pet(name)
        case .rug(let p, let a, let b): node = HouseProps.rug(p, a, b)
        case .art(let key, let a, let b): node = HouseProps.art(key, a, b)
        case .window(let kind): node = HouseProps.window(kind, sky.outlook)
        case .made(let key): node = HouseProps.made(key)
        case .paint, .flooring, .wood, .fabric, .roof, .roofShape, .cladding, .door: return nil
        }
        HouseLook.physical(node)
        // Lights made for the old flat light (a campfire's, a bare bulb's) are far too bright for this one.
        node.enumerateHierarchy { n, _ in
            if let l = n.light, l.intensity > 100 { l.intensity = 9; l.attenuationEndDistance = min(l.attenuationEndDistance, 4.5) }
        }
        return node
    }
}
