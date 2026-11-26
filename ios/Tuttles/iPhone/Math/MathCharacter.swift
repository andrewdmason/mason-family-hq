import Foundation
import SceneKit
import UIKit
import simd

// The runner, the teacher and the people in the halls are Kenney's "Mini
// Characters": twelve little people on one skeleton of seven bones, each
// vertex fixed to one bone, coloured from a sheet of swatches. That makes
// them easy to take apart: any head goes on any body, and hair, skin, top,
// bottoms and shoes are recoloured by pointing those vertices at swatches of
// our own. The key frames are played here rather than by SceneKit, so a run
// can be sped up with the game and blended into a jump.

/// What a character looks like. Saved with a kid's things (MathStore.swift).
struct MathLook: Codable, Hashable {
    enum Finish: String, Codable, CaseIterable {
        case normal, gold, ghost, shadow, neon, chrome, negative
    }

    /// Which of the twelve heads and bodies ("male-d").
    var head: String
    var body: String
    /// Colours as "rrggbb".
    var hair: String
    var skin: String
    var top: String
    var bottom: String
    var shoes: String
    var finish: Finish = .normal

    static let heads = ["male-d", "male-f", "male-a", "male-e", "male-b", "male-c",
                        "female-a", "female-b", "female-c", "female-d", "female-e", "female-f"]
    static let bodies = heads

    /// Sebastian: copper-red hair, navy polo.
    static let sebastian = MathLook(head: "male-d", body: "male-a", hair: "c0531f", skin: "f6c9a8",
                                    top: "1f3a6b", bottom: "c9b48a", shoes: "f2f2f2")
    /// Oscar: light brown hair, red football shirt.
    static let oscar = MathLook(head: "female-e", body: "male-a", hair: "8a5a34", skin: "f3c6a2",
                                top: "d6263a", bottom: "20242c", shoes: "f5c542")
    static let plain = MathLook(head: "male-a", body: "male-a", hair: "3a2a22", skin: "e8b48c",
                                top: "3f8f5a", bottom: "3b4a6b", shoes: "f2f2f2")
}

enum MathLookKit {
    static func color(_ hex: String) -> UIColor {
        var n: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&n)
        return UIColor(red: CGFloat((n >> 16) & 0xff) / 255, green: CGFloat((n >> 8) & 0xff) / 255,
                       blue: CGFloat(n & 0xff) / 255, alpha: 1)
    }

    static func matte(_ color: UIColor) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .lambert
        m.diffuse.contents = color
        return m
    }
}

extension UIColor {
    /// The colour made darker (below 1) or lighter (above 1).
    func shaded(_ by: CGFloat) -> UIColor {
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard getHue(&h, saturation: &s, brightness: &b, alpha: &a) else { return self }
        return UIColor(hue: h, saturation: min(1, s * (by < 1 ? 1.08 : 0.9)), brightness: min(1, b * by), alpha: a)
    }
}

/// One of the twelve character files, taken apart by bone.
final class MiniRigData {
    enum Role: Int { case hair = 0, skin, top, bottom, shoes }

    static let jointNames = ["root", "leg-left", "leg-right", "torso", "arm-left", "arm-right", "head"]
    /// Each joint's parent, by index into `jointNames`.
    static let parents = [-1, 0, 0, 0, 3, 3, 3]

    /// A bone's piece of the body, in the bone's own space.
    let parts: [(joint: Int, geometry: SCNGeometry)]
    let rest: [SIMD3<Float>]
    /// Clips by name, tracks by joint index.
    let clips: [String: [Int: GLB.Track]]
    let durations: [String: Float]

    private static var cache: [String: MiniRigData] = [:]

    static func load(_ name: String) -> MiniRigData? {
        if let hit = cache[name] { return hit }
        guard let glb = MathModels.file("characters/character-\(name)"), let made = MiniRigData(glb) else { return nil }
        cache[name] = made
        return made
    }

    private init?(_ glb: GLB) {
        // The bones, in the order the skin names them.
        guard let skins = glb.json["skins"] as? [[String: Any]], let joints = skins.first?["joints"] as? [Int],
              joints.count == Self.jointNames.count else { return nil }
        var world = [SIMD3<Float>](repeating: .zero, count: joints.count)
        var local = [SIMD3<Float>](repeating: .zero, count: joints.count)
        for (i, nodeIndex) in joints.enumerated() {
            let t = glb.nodes[nodeIndex]["translation"] as? [Double] ?? [0, 0, 0]
            local[i] = SIMD3(Float(t[0]), Float(t[1]), Float(t[2]))
            let parent = Self.parents[i]
            world[i] = local[i] + (parent >= 0 ? world[parent] : .zero)
        }
        rest = local

        // The meshes: the body's and the head's.
        var pieces: [GLB.Piece] = []
        for node in glb.nodes {
            if let mesh = node["mesh"] as? Int { pieces += glb.pieces(ofMesh: mesh) }
        }
        // Whose skin this is: the swatch the face is made of (every head is
        // the same 220-vertex block under its hair).
        var headCounts: [Int: Int] = [:]
        for piece in pieces {
            for (i, j) in piece.joints.enumerated() where j == 6 && i < piece.uvs.count {
                headCounts[Self.swatch(piece.uvs[i]), default: 0] += 1
            }
        }
        let skinSwatch = headCounts.first { $0.value == 220 }?.key
            ?? headCounts.filter { [29, 30, 31].contains($0.key) }.max { $0.value < $1.value }?.key ?? 31

        var built: [(Int, SCNGeometry)] = []
        for piece in pieces where piece.uvs.count == piece.positions.count && piece.joints.count == piece.positions.count {
            let roles = Self.roles(piece, skin: skinSwatch)
            for joint in 0..<joints.count {
                // This bone's triangles, with their vertices renumbered.
                var remap: [Int32: Int32] = [:]
                var sub = GLB.Piece(positions: [], normals: [], uvs: [], indices: [], joints: [], material: nil)
                for t in stride(from: 0, to: piece.indices.count - 2, by: 3) {
                    let tri = [piece.indices[t], piece.indices[t + 1], piece.indices[t + 2]]
                    guard piece.joints[Int(tri[0])] == joint else { continue }
                    for v in tri {
                        if let at = remap[v] {
                            sub.indices.append(at)
                        } else {
                            let i = Int(v)
                            let at = Int32(sub.positions.count)
                            remap[v] = at
                            sub.positions.append(piece.positions[i] - world[joint])
                            if piece.normals.count == piece.positions.count { sub.normals.append(piece.normals[i]) }
                            var uv = piece.uvs[i]
                            if let role = roles[i] {
                                // Our own swatches are along the sheet's empty top row.
                                uv = SIMD2((Float(role.rawValue) + 0.75) / 8, uv.y - floor(uv.y * 4) * 0.25)
                            }
                            sub.uvs.append(uv)
                            sub.indices.append(at)
                        }
                    }
                }
                if !sub.indices.isEmpty { built.append((joint, GLB.geometry(sub))) }
            }
        }
        parts = built.map { (joint: $0.0, geometry: $0.1) }

        let nodeToJoint = Dictionary(uniqueKeysWithValues: joints.enumerated().map { ($1, $0) })
        var named: [String: [Int: GLB.Track]] = [:]
        var lengths: [String: Float] = [:]
        for (name, clip) in glb.clips() {
            var tracks: [Int: GLB.Track] = [:]
            for (node, track) in clip.tracks { if let j = nodeToJoint[node] { tracks[j] = track } }
            named[name] = tracks
            lengths[name] = clip.duration
        }
        clips = named
        durations = lengths
    }

    /// Which swatch of the sheet (eight across, four down) a vertex is coloured from.
    private static func swatch(_ uv: SIMD2<Float>) -> Int {
        min(3, max(0, Int(uv.y * 4))) * 8 + min(7, max(0, Int(uv.x * 8)))
    }

    /// What each vertex is: hair, skin, top, bottoms or shoes; nil for the
    /// rest (eyes, glasses, a badge), which keep the file's colour.
    private static func roles(_ piece: GLB.Piece, skin: Int) -> [Role?] {
        let count = piece.positions.count
        let swatches = piece.uvs.map(swatch)
        var roles = [Role?](repeating: nil, count: count)
        let dark = 24

        func isEye(_ i: Int) -> Bool {
            let p = piece.positions[i]
            return swatches[i] == dark && p.z > 0.155 && p.z < 0.172 && p.y > 0.395 && p.y < 0.516 && abs(p.x) < 0.125
        }
        func biggest(_ joints: Set<Int>, not excluded: Set<Int>, where keep: (Int) -> Bool = { _ in true }) -> Int? {
            var tally: [Int: Int] = [:]
            for i in 0..<count where joints.contains(piece.joints[i]) && !excluded.contains(swatches[i]) && keep(i) {
                tally[swatches[i], default: 0] += 1
            }
            return tally.max { $0.value < $1.value }?.key
        }

        let hair = biggest([6], not: [skin]) { !isEye($0) }
        let sleeve = biggest([4, 5], not: [skin])
        // The torso's lowest band is the top of the trousers; the shirt is what's above it.
        let waist: Float = 0.215
        let shirt = biggest([3], not: [skin]) { piece.positions[$0].y > waist }
        let shoe = biggest([1, 2], not: [skin]) { piece.positions[$0].y < 0.05 && piece.positions[$0].y > 0.021 }
            ?? biggest([1, 2], not: [skin]) { piece.positions[$0].y < 0.05 }
        let trousers = biggest([1, 2], not: [skin]) { piece.positions[$0].y > 0.1 }
        let band = biggest([3], not: [skin]) { piece.positions[$0].y <= waist }

        for i in 0..<count {
            let s = swatches[i]
            let y = piece.positions[i].y
            if s == skin { roles[i] = .skin; continue }
            switch piece.joints[i] {
            case 6: if s == hair, !isEye(i) { roles[i] = .hair }
            case 4, 5: if s == sleeve || s == shirt { roles[i] = .top }
            case 3:
                if s == shirt || s == sleeve { roles[i] = .top } else if s == band, y <= waist + 0.01 { roles[i] = .bottom }
            case 1, 2:
                if s == shoe, y < 0.1 { roles[i] = .shoes } else if s == trousers || s == band { roles[i] = .bottom }
            default: break
            }
        }
        return roles
    }
}

/// A character in the scene.
final class MathCharacter {
    /// Feet at the origin, facing down the track (-z).
    let node = SCNNode()
    private let turn = SCNNode()
    private var joints: [SCNNode] = []
    private var partNodes: [SCNNode] = []
    private var body: MiniRigData?
    private let material = SCNMaterial()
    private(set) var look: MathLook

    private var clip = "idle"
    private var time: Float = 0
    private var speed: Float = 1
    private var loops = true
    private var fade: Float = 0
    private var fadeLength: Float = 0.12
    private var from: [(SIMD3<Float>, simd_quatf)] = []
    private var pose: [(SIMD3<Float>, simd_quatf)] = []

    /// `height` is how tall they stand, in metres.
    init(look: MathLook, height: Float = 1.25) {
        self.look = look
        turn.eulerAngles.y = .pi
        let scale = height / 0.74
        turn.scale = SCNVector3(scale, scale, scale)
        node.addChildNode(turn)
        material.lightingModel = .lambert
        material.diffuse.magnificationFilter = .linear
        material.diffuse.minificationFilter = .linear
        material.diffuse.mipFilter = .none
        build()
    }

    func joint(_ name: String) -> SCNNode? {
        MiniRigData.jointNames.firstIndex(of: name).flatMap { joints.indices.contains($0) ? joints[$0] : nil }
    }

    /// The node everything hangs from, turned to face down the track.
    var figure: SCNNode { turn }

    func setLook(_ new: MathLook) {
        let rebuild = new.head != look.head || new.body != look.body
        look = new
        if rebuild { build() } else { paint() }
    }

    private func build() {
        joints.forEach { $0.removeFromParentNode() }
        joints = []
        partNodes = []
        guard let bodyRig = MiniRigData.load(look.body) ?? MiniRigData.load("male-a") else { return }
        let headRig = MiniRigData.load(look.head) ?? bodyRig
        body = bodyRig
        for (i, name) in MiniRigData.jointNames.enumerated() {
            let j = SCNNode()
            j.name = name
            j.simdPosition = bodyRig.rest[i]
            let parent = MiniRigData.parents[i]
            (parent >= 0 ? joints[parent] : turn).addChildNode(j)
            joints.append(j)
        }
        for (rig, wanted) in [(bodyRig, { (j: Int) in j != 6 }), (headRig, { (j: Int) in j == 6 })] {
            for part in rig.parts where wanted(part.joint) {
                let geometry = part.geometry.copy() as! SCNGeometry
                geometry.materials = [material]
                let n = SCNNode(geometry: geometry)
                joints[part.joint].addChildNode(n)
                partNodes.append(n)
            }
        }
        pose = bodyRig.rest.map { ($0, simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)) }
        from = pose
        paint()
        apply()
    }

    // MARK: Colour

    private static var sheets: [MathLook: UIImage] = [:]
    private static let original: UIImage? = UIImage(contentsOfFile: MathModels.folder.appending(path: "characters/Textures/colormap.png").path)

    private func paint() {
        material.diffuse.contents = Self.sheet(for: look)
        material.emission.contents = UIColor.black
        material.transparency = 1
        material.specular.contents = UIColor.black
        material.lightingModel = .lambert
        material.blendMode = .replace
        material.writesToDepthBuffer = true
        switch look.finish {
        case .ghost:
            material.transparency = 0.5
            material.blendMode = .alpha
            material.emission.contents = UIColor(white: 0.35, alpha: 1)
        case .neon:
            material.emission.contents = Self.sheet(for: look)
        case .gold, .chrome:
            material.lightingModel = .blinn
            material.specular.contents = UIColor.white
            material.shininess = 0.6
            material.emission.contents = look.finish == .gold ? UIColor(red: 0.25, green: 0.17, blue: 0, alpha: 1) : UIColor(white: 0.12, alpha: 1)
        case .shadow:
            material.emission.contents = UIColor.black
        case .normal, .negative:
            break
        }
    }

    /// The swatch sheet with this look's colours along its top row.
    static func sheet(for look: MathLook) -> UIImage {
        if let hit = sheets[look] { return hit }
        let size = CGSize(width: 256, height: 256)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            let cg = ctx.cgContext
            if let original {
                original.draw(in: CGRect(origin: .zero, size: size))
            } else {
                UIColor.gray.setFill()
                cg.fill(CGRect(origin: .zero, size: size))
            }
            let cellW = size.width / 8, cellH = size.height / 4
            func fill(_ rect: CGRect, _ color: UIColor) {
                let colors = [color.cgColor, color.shaded(0.78).cgColor] as CFArray
                guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) else { return }
                cg.saveGState()
                cg.clip(to: rect)
                cg.drawLinearGradient(gradient, start: CGPoint(x: 0, y: rect.minY), end: CGPoint(x: 0, y: rect.maxY), options: [])
                cg.restoreGState()
            }
            var roles = [look.hair, look.skin, look.top, look.bottom, look.shoes].map(MathLookKit.color)
            switch look.finish {
            case .gold:
                roles = [0.95, 1.0, 0.9, 0.82, 0.7].map { UIColor(red: 1.0 * $0, green: 0.78 * $0, blue: 0.22 * $0, alpha: 1) }
            case .chrome:
                roles = [0.75, 0.95, 0.85, 0.7, 0.55].map { UIColor(white: $0, alpha: 1) }
            case .shadow:
                roles = [0.05, 0.09, 0.07, 0.05, 0.03].map { UIColor(white: $0, alpha: 1) }
            case .ghost:
                roles = roles.map { _ in UIColor(red: 0.86, green: 0.93, blue: 1, alpha: 1) }
            case .negative:
                roles = roles.map {
                    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                    $0.getRed(&r, green: &g, blue: &b, alpha: &a)
                    return UIColor(red: 1 - r, green: 1 - g, blue: 1 - b, alpha: 1)
                }
            case .normal, .neon:
                break
            }
            for (i, color) in roles.enumerated() {
                fill(CGRect(x: CGFloat(i) * cellW, y: 0, width: cellW, height: cellH), color)
            }
            // The special finishes take the rest of the outfit with them.
            if [.gold, .chrome, .shadow, .ghost].contains(look.finish) {
                for row in 1..<4 {
                    for col in 0..<8 {
                        // The eyes (the darkest swatch) stay, or shine out of the shadow.
                        if row == 3 && col == 0 {
                            if look.finish == .shadow { fill(CGRect(x: 0, y: 3 * cellH, width: cellW, height: cellH), .white) }
                            continue
                        }
                        fill(CGRect(x: CGFloat(col) * cellW, y: CGFloat(row) * cellH, width: cellW, height: cellH), roles[2])
                    }
                }
            }
        }
        sheets[look] = image
        return image
    }

    // MARK: Movement

    func has(_ name: String) -> Bool { body?.clips[name] != nil }

    /// Start a clip. One that doesn't loop holds its last frame.
    func play(_ name: String, loop: Bool = true, speed: Float = 1, fade: Float = 0.12, restart: Bool = false) {
        self.speed = speed
        guard name != clip || restart else { return }
        from = pose
        self.fade = 0
        fadeLength = max(0.001, fade)
        clip = name
        loops = loop
        time = 0
    }

    var current: String { clip }
    var finished: Bool { !loops && time >= (body?.durations[clip] ?? 0) }

    func setSpeed(_ s: Float) { speed = s }

    func update(_ dt: Float) {
        guard let body, let tracks = body.clips[clip] else { return }
        let length = max(0.001, body.durations[clip] ?? 0.001)
        time += dt * speed
        if loops { time = time.truncatingRemainder(dividingBy: length) } else { time = min(time, length) }
        fade = min(fadeLength, fade + dt)
        let mix = fade / fadeLength
        let eased = mix * mix * (3 - 2 * mix)
        for i in 0..<joints.count {
            var position = body.rest[i]
            var rotation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
            if let track = tracks[i] {
                if let p = track.move(at: time) { position = p }
                if let r = track.turn(at: time) { rotation = r }
            }
            if eased < 1, i < from.count {
                position = simd_mix(from[i].0, position, SIMD3(repeating: eased))
                rotation = simd_slerp(from[i].1, rotation, eased)
            }
            pose[i] = (position, rotation)
        }
        apply()
    }

    private func apply() {
        for (i, j) in joints.enumerated() where i < pose.count {
            j.simdPosition = pose[i].0
            j.simdOrientation = pose[i].1
        }
    }
}
