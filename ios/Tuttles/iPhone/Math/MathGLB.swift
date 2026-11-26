import Foundation
import SceneKit
import UIKit
import simd

// The game's 3D art is public-domain kits (Kenney's, see MathAssets/models/
// CREDITS.txt) in .glb, which SceneKit doesn't read. This reads as much of the
// format as those kits use: meshes with positions, normals and one set of
// texture coordinates, a colour or a texture per material, a node tree, and,
// for the characters, which bone each vertex belongs to and the bones' key
// frames (MathCharacter.swift plays those itself).

final class GLB {
    let json: [String: Any]
    private let bin: Data
    private let folder: URL

    let nodes: [[String: Any]]
    private let accessors: [[String: Any]]
    private let views: [[String: Any]]
    private let meshes: [[String: Any]]
    private let materials: [[String: Any]]

    init?(url: URL) {
        guard let data = try? Data(contentsOf: url), data.count > 20,
              data.u32(0) == 0x4654_6C67 else { return nil }
        let jsonLength = Int(data.u32(12))
        guard data.count >= 20 + jsonLength,
              let parsed = try? JSONSerialization.jsonObject(with: data.subdata(in: 20..<20 + jsonLength)) as? [String: Any]
        else { return nil }
        json = parsed
        let binStart = 20 + jsonLength
        if data.count >= binStart + 8 {
            let binLength = Int(data.u32(binStart))
            bin = data.subdata(in: binStart + 8..<min(data.count, binStart + 8 + binLength))
        } else {
            bin = Data()
        }
        folder = url.deletingLastPathComponent()
        nodes = parsed["nodes"] as? [[String: Any]] ?? []
        accessors = parsed["accessors"] as? [[String: Any]] ?? []
        views = parsed["bufferViews"] as? [[String: Any]] ?? []
        meshes = parsed["meshes"] as? [[String: Any]] ?? []
        materials = parsed["materials"] as? [[String: Any]] ?? []
    }

    // MARK: Numbers

    private static let componentSize = [5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4]
    private static let typeCount = ["SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16]

    /// An accessor's numbers as floats, and how many there are to an element.
    func floats(_ index: Int) -> (values: [Float], per: Int) {
        guard accessors.indices.contains(index) else { return ([], 1) }
        let a = accessors[index]
        let per = Self.typeCount[a["type"] as? String ?? "SCALAR"] ?? 1
        let count = a["count"] as? Int ?? 0
        let component = a["componentType"] as? Int ?? 5126
        let size = Self.componentSize[component] ?? 4
        guard let viewIndex = a["bufferView"] as? Int, views.indices.contains(viewIndex) else {
            return ([Float](repeating: 0, count: count * per), per)
        }
        let view = views[viewIndex]
        let start = (view["byteOffset"] as? Int ?? 0) + (a["byteOffset"] as? Int ?? 0)
        let stride = view["byteStride"] as? Int ?? size * per
        let normalized = a["normalized"] as? Bool ?? false
        var out = [Float](repeating: 0, count: count * per)
        guard start + (count - 1) * stride + size * per <= bin.count, count > 0 else { return (out, per) }
        bin.withUnsafeBytes { raw in
            for i in 0..<count {
                for c in 0..<per {
                    let at = start + i * stride + c * size
                    let v: Float
                    switch component {
                    case 5126: v = raw.loadUnaligned(fromByteOffset: at, as: Float.self)
                    case 5125: v = Float(raw.loadUnaligned(fromByteOffset: at, as: UInt32.self))
                    case 5123:
                        let n = raw.loadUnaligned(fromByteOffset: at, as: UInt16.self)
                        v = normalized ? Float(n) / 65535 : Float(n)
                    case 5122:
                        let n = raw.loadUnaligned(fromByteOffset: at, as: Int16.self)
                        v = normalized ? max(Float(n) / 32767, -1) : Float(n)
                    case 5121:
                        let n = raw.loadUnaligned(fromByteOffset: at, as: UInt8.self)
                        v = normalized ? Float(n) / 255 : Float(n)
                    default:
                        let n = raw.loadUnaligned(fromByteOffset: at, as: Int8.self)
                        v = normalized ? max(Float(n) / 127, -1) : Float(n)
                    }
                    out[i * per + c] = v
                }
            }
        }
        return (out, per)
    }

    func vec3s(_ index: Int) -> [SIMD3<Float>] {
        let (v, per) = floats(index)
        guard per >= 3 else { return [] }
        return stride(from: 0, to: v.count, by: per).map { SIMD3(v[$0], v[$0 + 1], v[$0 + 2]) }
    }

    func vec2s(_ index: Int) -> [SIMD2<Float>] {
        let (v, per) = floats(index)
        guard per >= 2 else { return [] }
        return stride(from: 0, to: v.count, by: per).map { SIMD2(v[$0], v[$0 + 1]) }
    }

    func ints(_ index: Int) -> [Int32] { floats(index).values.map { Int32($0) } }

    // MARK: Meshes

    /// One drawable piece of a mesh, as plain arrays.
    struct Piece {
        var positions: [SIMD3<Float>]
        var normals: [SIMD3<Float>]
        var uvs: [SIMD2<Float>]
        var indices: [Int32]
        /// For a character: the bone each vertex is fixed to.
        var joints: [Int]
        let material: Int?
    }

    func pieces(ofMesh index: Int) -> [Piece] {
        guard meshes.indices.contains(index), let prims = meshes[index]["primitives"] as? [[String: Any]] else { return [] }
        return prims.compactMap { prim in
            guard let attrs = prim["attributes"] as? [String: Int], let p = attrs["POSITION"] else { return nil }
            if let mode = prim["mode"] as? Int, mode != 4 { return nil }
            let positions = vec3s(p)
            let normals = attrs["NORMAL"].map(vec3s) ?? []
            let uvs = attrs["TEXCOORD_0"].map(vec2s) ?? []
            let indices = (prim["indices"] as? Int).map(ints) ?? (0..<Int32(positions.count)).map { $0 }
            var joints: [Int] = []
            if let j = attrs["JOINTS_0"], let w = attrs["WEIGHTS_0"] {
                let (jv, _) = floats(j)
                let (wv, _) = floats(w)
                joints = (0..<positions.count).map { i in
                    var best = 0
                    for c in 1..<4 where wv[i * 4 + c] > wv[i * 4 + best] { best = c }
                    return Int(jv[i * 4 + best])
                }
            }
            return Piece(positions: positions, normals: normals, uvs: uvs, indices: indices, joints: joints,
                         material: prim["material"] as? Int)
        }
    }

    static func geometry(_ piece: Piece) -> SCNGeometry {
        var sources = [SCNGeometrySource(vertices: piece.positions.map { SCNVector3($0) })]
        if piece.normals.count == piece.positions.count {
            sources.append(SCNGeometrySource(normals: piece.normals.map { SCNVector3($0) }))
        }
        if piece.uvs.count == piece.positions.count {
            sources.append(SCNGeometrySource(textureCoordinates: piece.uvs.map { CGPoint(x: CGFloat($0.x), y: CGFloat($0.y)) }))
        }
        let element = SCNGeometryElement(indices: piece.indices, primitiveType: .triangles)
        return SCNGeometry(sources: sources, elements: [element])
    }

    // MARK: Materials

    private var materialCache: [Int: SCNMaterial] = [:]
    private static var imageCache: [URL: UIImage] = [:]

    func material(_ index: Int?) -> SCNMaterial {
        guard let index, materials.indices.contains(index) else { return MathLookKit.matte(.lightGray) }
        if let hit = materialCache[index] { return hit }
        let m = materials[index]
        let pbr = m["pbrMetallicRoughness"] as? [String: Any] ?? [:]
        let made = SCNMaterial()
        made.lightingModel = .lambert
        made.isDoubleSided = m["doubleSided"] as? Bool ?? false
        if let tex = pbr["baseColorTexture"] as? [String: Any], let ti = tex["index"] as? Int, let image = image(texture: ti) {
            made.diffuse.contents = image
            // The kits colour by swatches on a small sheet: no blurring between them.
            made.diffuse.magnificationFilter = .nearest
            made.diffuse.minificationFilter = .nearest
            made.diffuse.mipFilter = .none
            made.diffuse.wrapS = .repeat
            made.diffuse.wrapT = .repeat
        } else if let f = pbr["baseColorFactor"] as? [Double], f.count >= 3 {
            // By the book these are linear light, but the kits' exporter wrote
            // the screen colours straight in: used as they are, they match
            // the kits' own pictures.
            func srgb(_ x: Double) -> CGFloat { CGFloat(x) }
            let alpha = f.count > 3 ? CGFloat(f[3]) : 1
            made.diffuse.contents = UIColor(red: srgb(f[0]), green: srgb(f[1]), blue: srgb(f[2]), alpha: alpha)
            if alpha < 0.99 { made.transparency = alpha; made.blendMode = .alpha }
        } else {
            made.diffuse.contents = UIColor.lightGray
        }
        made.name = m["name"] as? String
        materialCache[index] = made
        return made
    }

    private func image(texture index: Int) -> UIImage? {
        guard let textures = json["textures"] as? [[String: Any]], textures.indices.contains(index),
              let source = textures[index]["source"] as? Int,
              let images = json["images"] as? [[String: Any]], images.indices.contains(source) else { return nil }
        let entry = images[source]
        if let uri = entry["uri"] as? String, !uri.hasPrefix("data:") {
            let url = folder.appending(path: uri.removingPercentEncoding ?? uri)
            if let hit = Self.imageCache[url] { return hit }
            let image = UIImage(contentsOfFile: url.path)
            Self.imageCache[url] = image
            return image
        }
        if let viewIndex = entry["bufferView"] as? Int, views.indices.contains(viewIndex) {
            let view = views[viewIndex]
            let start = view["byteOffset"] as? Int ?? 0
            let length = view["byteLength"] as? Int ?? 0
            guard start + length <= bin.count else { return nil }
            return UIImage(data: bin.subdata(in: start..<start + length))
        }
        return nil
    }

    // MARK: A whole model, as nodes

    /// The file's scene as a node tree, for a prop that doesn't move by bones.
    func sceneNode() -> SCNNode {
        let root = SCNNode()
        let scenes = json["scenes"] as? [[String: Any]] ?? []
        let which = json["scene"] as? Int ?? 0
        let tops = (scenes.indices.contains(which) ? scenes[which]["nodes"] as? [Int] : nil) ?? Array(nodes.indices.prefix(1))
        for i in tops { root.addChildNode(build(node: i)) }
        return root
    }

    private func build(node index: Int) -> SCNNode {
        let made = SCNNode()
        guard nodes.indices.contains(index) else { return made }
        let n = nodes[index]
        made.name = n["name"] as? String
        Self.place(made, from: n)
        if let mesh = n["mesh"] as? Int {
            for piece in pieces(ofMesh: mesh) {
                let geometry = Self.geometry(piece)
                geometry.materials = [material(piece.material)]
                let child = SCNNode(geometry: geometry)
                made.addChildNode(child)
            }
        }
        for child in n["children"] as? [Int] ?? [] { made.addChildNode(build(node: child)) }
        return made
    }

    static func place(_ node: SCNNode, from n: [String: Any]) {
        if let m = n["matrix"] as? [Double], m.count == 16 {
            let f = m.map { Float($0) }
            node.simdTransform = simd_float4x4(columns: (SIMD4(f[0], f[1], f[2], f[3]), SIMD4(f[4], f[5], f[6], f[7]),
                                                         SIMD4(f[8], f[9], f[10], f[11]), SIMD4(f[12], f[13], f[14], f[15])))
            return
        }
        if let t = n["translation"] as? [Double], t.count == 3 { node.simdPosition = SIMD3(Float(t[0]), Float(t[1]), Float(t[2])) }
        if let r = n["rotation"] as? [Double], r.count == 4 {
            node.simdOrientation = simd_quatf(ix: Float(r[0]), iy: Float(r[1]), iz: Float(r[2]), r: Float(r[3]))
        }
        if let s = n["scale"] as? [Double], s.count == 3 { node.simdScale = SIMD3(Float(s[0]), Float(s[1]), Float(s[2])) }
    }

    // MARK: Key frames

    /// One bone's movement in a clip.
    struct Track {
        var moveTimes: [Float] = []
        var moves: [SIMD3<Float>] = []
        var turnTimes: [Float] = []
        var turns: [simd_quatf] = []
    }

    struct Clip {
        var duration: Float = 0
        /// By node index.
        var tracks: [Int: Track] = [:]
    }

    func clips() -> [String: Clip] {
        var out: [String: Clip] = [:]
        for anim in json["animations"] as? [[String: Any]] ?? [] {
            guard let name = anim["name"] as? String,
                  let channels = anim["channels"] as? [[String: Any]],
                  let samplers = anim["samplers"] as? [[String: Any]] else { continue }
            var clip = Clip()
            for channel in channels {
                guard let target = channel["target"] as? [String: Any], let node = target["node"] as? Int,
                      let path = target["path"] as? String, let si = channel["sampler"] as? Int, samplers.indices.contains(si),
                      let input = samplers[si]["input"] as? Int, let output = samplers[si]["output"] as? Int else { continue }
                let times = floats(input).values
                clip.duration = max(clip.duration, times.last ?? 0)
                var track = clip.tracks[node] ?? Track()
                if path == "translation" {
                    track.moveTimes = times
                    track.moves = vec3s(output)
                } else if path == "rotation" {
                    let (v, _) = floats(output)
                    track.turnTimes = times
                    track.turns = stride(from: 0, to: v.count - 3, by: 4).map { simd_quatf(ix: v[$0], iy: v[$0 + 1], iz: v[$0 + 2], r: v[$0 + 3]) }
                }
                clip.tracks[node] = track
            }
            out[name] = clip
        }
        return out
    }
}

extension GLB.Track {
    private static func bracket(_ times: [Float], _ t: Float) -> (Int, Int, Float) {
        guard times.count > 1 else { return (0, 0, 0) }
        if t <= times[0] { return (0, 0, 0) }
        if t >= times[times.count - 1] { return (times.count - 1, times.count - 1, 0) }
        var lo = 0, hi = times.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if times[mid] <= t { lo = mid } else { hi = mid }
        }
        let span = times[hi] - times[lo]
        return (lo, hi, span > 0 ? (t - times[lo]) / span : 0)
    }

    func move(at t: Float) -> SIMD3<Float>? {
        guard !moves.isEmpty else { return nil }
        let (a, b, f) = Self.bracket(moveTimes, t)
        guard a < moves.count, b < moves.count else { return moves.last }
        return simd_mix(moves[a], moves[b], SIMD3(repeating: f))
    }

    func turn(at t: Float) -> simd_quatf? {
        guard !turns.isEmpty else { return nil }
        let (a, b, f) = Self.bracket(turnTimes, t)
        guard a < turns.count, b < turns.count else { return turns.last }
        return simd_slerp(turns[a], turns[b], f)
    }
}

private extension Data {
    func u32(_ at: Int) -> UInt32 {
        withUnsafeBytes { $0.loadUnaligned(fromByteOffset: at, as: UInt32.self) }
    }
}

/// Every model the game uses, read once.
enum MathModels {
    /// The name on a sized kit model (`fitted`), which mustn't be flattened.
    static let kitName = "kit"
    private static var files: [String: GLB] = [:]
    private static var props: [String: SCNNode] = [:]

    static var folder: URL {
        Bundle.main.bundleURL.appending(path: "MathAssets/models")
    }

    /// `name` is the path under MathAssets/models without ".glb" ("characters/character-male-a").
    static func file(_ name: String) -> GLB? {
        if let hit = files[name] { return hit }
        let glb = GLB(url: folder.appending(path: name + ".glb"))
        files[name] = glb
        return glb
    }

    /// A copy of a prop, sharing the original's geometry. Flattened to one
    /// node so a hallway of them costs little to draw.
    static func prop(_ name: String) -> SCNNode? {
        if let hit = props[name] { return hit.clone() }
        guard let glb = file(name) else { return nil }
        let node = glb.sceneNode().flattenedClone()
        props[name] = node
        return node.clone()
    }
}
