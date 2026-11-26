import SceneKit
import UIKit

// The street, in 3D, seen from one fixed corner like a doll's house. Each
// house is its rooms stacked as steps: a room is a square of floor with two
// walls behind it, and the next room up sits one up and one back, so from
// where the camera is no room hides any of another. The camera never turns:
// it only moves and zooms, between the whole street, one house and one room.

/// One house to show: whose, and how it stands.
struct HouseShown: Equatable {
    let kid: String
    let name: String
    let mine: Bool
    var state: HouseState
    var look: MathLook
}

final class HouseStage: NSObject, SCNSceneRendererDelegate {
    enum Focus: Equatable {
        case street
        case house(String)
        case room(String, String)
    }

    enum Hit: Equatable {
        case house(String)
        case room(String, String)
        /// A room that isn't theirs yet.
        case locked(String, String)
        case spot(String, String, String)
    }

    let scene = SCNScene()
    let cameraNode = SCNNode()
    private var houses: [HouseShown] = []
    private var nodes: [String: SCNNode] = [:]
    private var characters: [String: MathCharacter] = [:]
    /// The characters are moved on SceneKit's own thread.
    private let lock = NSLock()
    /// The room is to sit in the top of the screen, over a sheet.
    private(set) var lifted = false
    private(set) var focus = Focus.street
    /// Bubbles on the spots of the room in focus, and the rooms still to buy shown as ghosts.
    private(set) var decorating = false
    private var aspect: Float = 0.46
    private var last: TimeInterval = 0

    /// Towards the camera, from anything it looks at.
    private static let back = simd_normalize(SIMD3<Float>(1, 0.86, 1))
    private static let right = simd_normalize(SIMD3<Float>(1, 0, -1))

    override init() {
        super.init()
        let camera = SCNCamera()
        camera.usesOrthographicProjection = true
        camera.orthographicScale = 12
        camera.zNear = 1
        camera.zFar = 400
        cameraNode.camera = camera
        scene.rootNode.addChildNode(cameraNode)
        cameraNode.simdPosition = Self.back * 120
        cameraNode.look(at: SCNVector3(0, 0, 0))

        let sun = SCNNode()
        sun.light = SCNLight()
        sun.light?.type = .directional
        sun.light?.intensity = 780
        sun.light?.color = UIColor(red: 1, green: 0.97, blue: 0.9, alpha: 1)
        sun.light?.castsShadow = true
        sun.light?.shadowMode = .deferred
        sun.light?.shadowColor = UIColor(white: 0, alpha: 0.22)
        sun.light?.shadowRadius = 6
        sun.light?.shadowSampleCount = 8
        sun.light?.shadowMapSize = CGSize(width: 2048, height: 2048)
        sun.light?.orthographicScale = 40
        sun.light?.zFar = 300
        sun.simdPosition = SIMD3(40, 90, 70)
        sun.look(at: SCNVector3(0, 4, -4))
        scene.rootNode.addChildNode(sun)
        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.intensity = 620
        ambient.light?.color = UIColor(red: 0.95, green: 0.97, blue: 1, alpha: 1)
        scene.rootNode.addChildNode(ambient)
        scene.background.contents = Self.sky
    }

    /// Pale blue, with a few clouds low down.
    private static let sky: UIImage = MathMat.image("house-sky", 256, 512) { c, size in
        let colors = [UIColor(red: 0.74, green: 0.93, blue: 0.97, alpha: 1).cgColor, UIColor(red: 0.86, green: 0.96, blue: 0.98, alpha: 1).cgColor] as CFArray
        if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
            c.drawLinearGradient(g, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
        }
        c.setFillColor(UIColor.white.withAlphaComponent(0.9).cgColor)
        for (x, y, r) in [(40.0, 440.0, 60.0), (110, 470, 80), (200, 450, 70), (230, 90, 34), (190, 100, 26), (20, 150, 30)] {
            c.fillEllipse(in: CGRect(x: x - r, y: y - r * 0.6, width: r * 2, height: r * 1.2))
        }
    }

    // MARK: What's shown

    /// Put these houses on the street, the first nearest. Any already there is rebuilt.
    func show(_ houses: [HouseShown]) {
        self.houses = houses
        for node in nodes.values { node.removeFromParentNode() }
        nodes = [:]
        lock.lock(); characters = [:]; lock.unlock()
        // One above the other up the screen, a little to the side: a phone is
        // tall. Seen from one fixed corner with no perspective, two things
        // only hide each other where they overlap on screen, and these don't.
        let right = Self.right, up = simd_normalize(simd_cross(Self.back, right))
        var top: Float = 0
        for (i, house) in houses.enumerated() {
            let node = build(house)
            let box = Self.box(house.state, right: right, up: up)
            if i > 0 { node.simdPosition = up * (top - box.u0 + 2.6) + right * (i % 2 == 1 ? 3.2 : -3.2) }
            top = simd_dot(node.simdPosition, up) + box.u1
            scene.rootNode.addChildNode(node)
            nodes[house.kid] = node
        }
        frame(animated: false)
    }

    /// How far a house's rooms reach across and up the screen, from where it stands.
    private static func box(_ state: HouseState, right: SIMD3<Float>, up: SIMD3<Float>) -> (r0: Float, r1: Float, u0: Float, u1: Float) {
        let S = HouseCatalog.side, H = HouseCatalog.height
        var r0 = Float.greatestFiniteMagnitude, r1 = -r0, u0 = r0, u1 = -r0
        for room in HouseCatalog.rooms where state.has(room: room.id) {
            let o = SIMD3(Float(room.cell[0]) * S, Float(room.cell[1]) * H, Float(room.cell[2]) * S)
            for x in [Float(0), S] { for y in [Float(-0.3), H] { for z in [Float(0), S] {
                let p = o + SIMD3(x, y, z), r = simd_dot(p, right), u = simd_dot(p, up)
                r0 = min(r0, r); r1 = max(r1, r); u0 = min(u0, u); u1 = max(u1, u)
            } } }
        }
        return (r0, r1, u0, u1)
    }

    /// A house has changed: build it again where it stands.
    func update(_ house: HouseShown, popping spot: String? = nil) {
        guard let at = houses.firstIndex(where: { $0.kid == house.kid }), let old = nodes[house.kid] else { return }
        houses[at] = house
        let node = build(house)
        node.simdPosition = old.simdPosition
        old.removeFromParentNode()
        scene.rootNode.addChildNode(node)
        nodes[house.kid] = node
        tidy()
        if let spot, let thing = node.childNode(withName: "thing:\(spot)", recursively: true) {
            let to = thing.scale
            thing.scale = SCNVector3(to.x * 0.2, to.y * 0.2, to.z * 0.2)
            let pop = SCNAction.sequence([.scale(to: CGFloat(to.x) * 1.15, duration: 0.18), .scale(to: CGFloat(to.x), duration: 0.12)])
            thing.runAction(pop)
            lock.lock()
            if let character = characters[house.kid], character.has("emote-yes") { character.play("emote-yes", loop: false, restart: true) }
            lock.unlock()
        }
    }

    func setDecorating(_ on: Bool) {
        guard on != decorating else { return }
        decorating = on
        for house in houses where house.mine { update(house) }
        frame(animated: true)
    }

    // MARK: Building

    private func build(_ house: HouseShown) -> SCNNode {
        let root = SCNNode()
        root.name = "house:\(house.kid)"
        let S = HouseCatalog.side, H = HouseCatalog.height
        for room in HouseCatalog.rooms {
            let owned = house.state.has(room: room.id)
            // The rooms still to buy show only to their owner, while decorating.
            guard owned || (house.mine && decorating && focus == .house(house.kid)) else { continue }
            let node = owned ? self.room(room, of: house) : ghost(room, of: house)
            node.position = SCNVector3(Float(room.cell[0]) * S, Float(room.cell[1]) * H, Float(room.cell[2]) * S)
            root.addChildNode(node)
        }
        // Whose it is, over the top of it.
        let top = HouseCatalog.rooms.filter { house.state.has(room: $0.id) }.max { $0.cell[1] < $1.cell[1] } ?? HouseCatalog.rooms[0]
        let sign = HouseProps.sign([house.mine ? "My house" : "\(house.name)'s house"], width: 5.2)
        sign.name = "label"
        root.add(sign, Float(top.cell[0]) * S + 0.4, Float(top.cell[1] + 1) * H + 1.3, Float(top.cell[2]) * S + 0.4)

        // They live in it: in the room in focus, or else the first.
        let character = MathCharacter(look: house.look, height: 1.5)
        character.play("idle")
        lock.lock(); characters[house.kid] = character; lock.unlock()
        var home = HouseCatalog.rooms[0]
        if case .room(let kid, let id) = focus, kid == house.kid, house.state.has(room: id), let r = HouseCatalog.room(id) { home = r }
        character.node.position = SCNVector3(Float(home.cell[0]) * S + home.stand[0], Float(home.cell[1]) * H, Float(home.cell[2]) * S + home.stand[1])
        // Facing out, towards whoever's looking.
        character.node.eulerAngles.y = .pi * 1.25
        root.addChildNode(character.node)
        return root
    }

    private func room(_ room: HouseRoom, of house: HouseShown) -> SCNNode {
        let S = HouseCatalog.side, H = HouseCatalog.height
        let node = SCNNode()
        node.name = "room:\(house.kid):\(room.id)"
        var paint = ("f3ead2", "c9b78f"), flooring = ("boards", "c98f55", "a8733f")
        for spot in room.spots {
            guard let item = house.state.item(in: spot, of: room.id) else { continue }
            if case .paint(let a, let b) = item.look { paint = (a, b) }
            if case .flooring(let p, let a, let b) = item.look { flooring = (p, a, b) }
        }
        let outside = MathMat.color(paint.1), edge = MathMat.color("3f6f9f")
        // The floor: a slab, with the pattern on top.
        node.add(MathShape.box(S + 0.3, 0.3, S + 0.3, edge), S / 2 - 0.15, -0.15, S / 2 - 0.15)
        let top = MathShape.floor(S, S, HouseProps.floorMaterial(flooring.0, flooring.1, flooring.2))
        node.add(top, S / 2, 0.004, S / 2)
        // The two walls behind: the left one along z, the right one along x.
        let inside = HouseProps.wallMaterial(paint.0, paint.1)
        let garden = room.id == "garden"
        let wallH = garden ? H * 0.42 : H
        let left = MathShape.faced(0.3, wallH, S + 0.3, [outside, inside, outside, outside, outside, outside])
        node.add(left, -0.15, wallH / 2, S / 2 - 0.15)
        let rightWall = MathShape.faced(S, wallH, 0.3, [inside, outside, outside, outside, outside, outside])
        node.add(rightWall, S / 2, wallH / 2, -0.15)
        for wall in [left, rightWall, top] { wall.castsShadow = false }

        var standing: [String: (at: SCNVector3, top: Float)] = [:]
        for spot in room.spots {
            let key = HouseCatalog.key(room.id, spot.id)
            let item = house.state.item(in: spot, of: room.id)
            var anchor = Self.anchor(spot.place, wallHeight: wallH)
            if case .against(let onLeft, let along) = spot.place {
                // Its back to the wall, however deep it is.
                let half = (item.map(Self.depth) ?? 0.6) / 2 + 0.04
                anchor = onLeft ? (SCNVector3(half, 0, along), .pi / 2, SIMD3(half, 1.5, along)) : (SCNVector3(along, 0, half), 0, SIMD3(along, 1.5, half))
            }
            if case .on(let base) = spot.place {
                // Nothing there to stand on: it isn't shown, and can't be chosen for until there is.
                guard let under = standing[base] else { continue }
                // On top of what's in that spot, however tall it is.
                anchor = (SCNVector3(under.at.x, under.top, under.at.z), 0, SIMD3(under.at.x, under.top + 0.75, under.at.z))
            }
            if let item, let thing = Self.thing(item) {
                standing[spot.id] = (anchor.at, Self.height(item))
                thing.name = "thing:\(key)"
                thing.position = anchor.at
                thing.eulerAngles.y = anchor.ry
                node.addChildNode(thing)
            }
            if house.mine, decorating, case .room(_, let id) = focus, id == room.id {
                let bubble = HouseProps.bubble(empty: item == nil || (spot.starter != nil && item == spot.starter))
                bubble.name = "spot:\(house.kid):\(room.id):\(spot.id)"
                bubble.position = SCNVector3(anchor.bubble.x, anchor.bubble.y, anchor.bubble.z)
                node.addChildNode(bubble)
            }
        }
        return node
    }

    /// A room not yet theirs: its outline, and what it costs.
    private func ghost(_ room: HouseRoom, of house: HouseShown) -> SCNNode {
        let S = HouseCatalog.side, H = HouseCatalog.height
        let node = SCNNode()
        node.name = "locked:\(house.kid):\(room.id)"
        let glass = MathMat.color(room.gems > 0 ? "b9a3f0" : "ffffff", alpha: 0.38)
        node.add(MathShape.box(S, 0.2, S, glass), S / 2, -0.1, S / 2)
        node.add(MathShape.box(0.12, H, S, glass), -0.06, H / 2, S / 2)
        node.add(MathShape.box(S, H, 0.12, glass), S / 2, H / 2, -0.06)
        let price = house.state.price(of: room)
        let sign = HouseProps.sign([room.name, price.gems > 0 ? "\(price.gems) gems" : "\(price.coins.formatted()) coins"],
                                   paper: house.state.canAfford(coins: price.coins, gems: price.gems) ? "e3f0a8" : "fff7e6", width: 2.7)
        node.add(sign, S / 2, H * 0.5, S / 2)
        node.childNodes.forEach { $0.castsShadow = false }
        return node
    }

    /// Where a spot's thing goes in its room, which way it faces, and where its bubble floats.
    private static func anchor(_ place: HouseSpot.Place, wallHeight: Float) -> (at: SCNVector3, ry: Float, bubble: SIMD3<Float>) {
        let H = wallHeight
        switch place {
        case .floor(let x, let z, let turns): return (SCNVector3(x, 0, z), Float(turns) * .pi / 2, SIMD3(x, 1.5, z))
        case .on, .against: return (SCNVector3(0, 0, 0), 0, SIMD3(0, 0.75, 0))
        case .rug(let x, let z): return (SCNVector3(x, 0, z), 0, SIMD3(x + 0.7, 0.35, z + 0.7))
        case .wall(let onLeft, let along, let y):
            let h = min(y, H - 0.6)
            return onLeft ? (SCNVector3(0, h, along), .pi / 2, SIMD3(0.3, h, along)) : (SCNVector3(along, h, 0), 0, SIMD3(along, h, 0.3))
        case .ceiling(let x, let z): return (SCNVector3(x, H - 0.02, z), 0, SIMD3(x, H - 0.9, z))
        case .walls: return (SCNVector3(0, 0, 0), 0, SIMD3(0.3, H - 0.45, 3.5))
        case .flooring: return (SCNVector3(0, 0, 0), 0, SIMD3(0.9, 0.3, 3.8))
        case .pet(let x, let z): return (SCNVector3(x, 0, z), .pi / 4, SIMD3(x, 0.9, z))
        }
    }

    /// How far a thing comes out from the wall it's against.
    private static func depth(_ item: HouseItem) -> Float {
        switch item.look {
        case .kit(let name, _): HouseProps.size(name).z
        case .stack(let base, _): HouseProps.size(base).z
        case .made("arcade"): 0.8
        case .made("trophies"): HouseProps.size("bookcaseOpen").z
        default: 0.6
        }
    }

    /// How tall a thing stands, for what's put on top of it.
    private static func height(_ item: HouseItem) -> Float {
        switch item.look {
        case .kit(let name, _): HouseProps.size(name).y
        case .stack(let base, let on): HouseProps.size(base).y + HouseProps.size(on).y
        default: 0
        }
    }

    private static func thing(_ item: HouseItem) -> SCNNode? {
        switch item.look {
        case .kit(let name, _):
            let node = HouseProps.kit(name)
            // What hangs from the ceiling is hung by its top.
            if name == "ceilingFan" || name == "lampSquareCeiling" { node.childNodes.first?.position.y -= HouseProps.size(name).y }
            return node
        case .stack(let base, let on): return HouseProps.stack(base, on)
        case .food(let name): return HouseProps.kit(name, folder: "food", scale: 1.6)
        case .tree(let name):
            let tree = HouseProps.kit(name, folder: "city", scale: 1)
            let s = (name == "tree-large" ? 3.2 : 2.2) / max(0.01, HouseProps.size(name, folder: "city", scale: 1).y)
            tree.scale = SCNVector3(s, s, s)
            return tree
        case .pet(let name): return HouseProps.pet(name)
        case .rug(let p, let a, let b): return HouseProps.rug(p, a, b)
        case .art(let key, let a, let b): return HouseProps.art(key, a, b)
        case .window(let kind): return HouseProps.window(kind)
        case .made(let key): return HouseProps.made(key)
        case .paint, .flooring: return nil
        }
    }

    // MARK: The camera

    func setLifted(_ on: Bool) {
        guard on != lifted else { return }
        lifted = on
        frame(animated: true)
    }

    func setAspect(_ aspect: Float) {
        guard aspect > 0, abs(aspect - self.aspect) > 0.001 else { return }
        self.aspect = aspect
        frame(animated: false)
    }

    func focus(on focus: Focus, animated: Bool = true) {
        let was = self.focus
        self.focus = focus
        // Moving between rooms moves who lives there, and the bubbles.
        if was != focus { for house in houses { update(house) } }
        frame(animated: animated)
    }

    /// The corners of what's in focus, in the world.
    private func corners() -> [SIMD3<Float>] {
        let S = HouseCatalog.side, H = HouseCatalog.height
        func box(_ house: HouseShown, _ room: HouseRoom, pad: Float) -> [SIMD3<Float>] {
            guard let origin = nodes[house.kid]?.simdPosition else { return [] }
            let o = origin + SIMD3(Float(room.cell[0]) * S, Float(room.cell[1]) * H, Float(room.cell[2]) * S)
            var out: [SIMD3<Float>] = []
            for x in [-pad, S + pad] { for y in [-pad, H + pad] { for z in [-pad, S + pad] { out.append(o + SIMD3(x, y, z)) } } }
            return out
        }
        func whole(_ house: HouseShown) -> [SIMD3<Float>] {
            HouseCatalog.rooms.filter { house.state.has(room: $0.id) || (house.mine && decorating && focus == .house(house.kid)) }.flatMap { box(house, $0, pad: 0.2) }
                + (nodes[house.kid].map { [$0.simdPosition + SIMD3(0, Float((HouseCatalog.rooms.filter { house.state.has(room: $0.id) }.map { $0.cell[1] }.max() ?? 0) + 1) * H + 2.2, 0)] } ?? [])
        }
        switch focus {
        case .street: return houses.flatMap(whole)
        case .house(let kid): return houses.filter { $0.kid == kid }.flatMap(whole)
        case .room(let kid, let id):
            guard let house = houses.first(where: { $0.kid == kid }), let room = HouseCatalog.room(id) else { return houses.flatMap(whole) }
            return box(house, room, pad: 0.35)
        }
    }

    private func frame(animated: Bool) {
        let points = corners()
        guard !points.isEmpty else { return }
        let right = Self.right, up = simd_normalize(simd_cross(Self.back, right))
        var r0 = Float.greatestFiniteMagnitude, r1 = -r0, u0 = r0, u1 = -r0
        for p in points {
            let r = simd_dot(p, right), u = simd_dot(p, up)
            r0 = min(r0, r); r1 = max(r1, r); u0 = min(u0, u); u1 = max(u1, u)
        }
        // Room at the top for the purse and at the bottom for the buttons.
        let tall = (u1 - u0) / 2 / (lifted ? 0.44 : 0.68), wide = (r1 - r0) / 2 / aspect / 0.94
        let scale = max(tall, wide)
        // Lower down the screen than the middle, clear of the purse; or up in the top of it, over a sheet.
        let middle = right * ((r0 + r1) / 2) + up * ((u0 + u1) / 2 + scale * (lifted ? -0.4 : 0.1))
        SCNTransaction.begin()
        SCNTransaction.animationDuration = animated ? 0.55 : 0
        SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        cameraNode.simdPosition = middle + Self.back * 150
        cameraNode.camera?.orthographicScale = Double(scale)
        SCNTransaction.commit()
        // (It only ever looks one way: set once, in init.)
        tidy()
    }

    /// On the street each house says whose it is. Inside one, it's the only one there.
    private func tidy() {
        for (kid, node) in nodes {
            node.childNode(withName: "label", recursively: false)?.isHidden = focus != .street
            switch focus {
            case .street: node.isHidden = false
            case .house(let k), .room(let k, _): node.isHidden = k != kid
            }
        }
    }

    // MARK: Touch

    /// What a tap landed on, nearest first: a spot's bubble before the room behind it.
    func hit(_ point: CGPoint, in view: SCNView) -> Hit? {
        let results = view.hitTest(point, options: [.searchMode: SCNHitTestSearchMode.all.rawValue, .ignoreHiddenNodes: true])
        var found: [Hit] = []
        for result in results {
            var node: SCNNode? = result.node
            while let n = node {
                if let name = n.name {
                    let parts = name.split(separator: ":").map(String.init)
                    if parts.first == "spot", parts.count == 4 { found.append(.spot(parts[1], parts[2], parts[3])) }
                    if parts.first == "room", parts.count == 3 { found.append(.room(parts[1], parts[2])) }
                    if parts.first == "locked", parts.count == 3 { found.append(.locked(parts[1], parts[2])) }
                    if parts.first == "house", parts.count == 2 { found.append(.house(parts[1])) }
                }
                node = n.parent
            }
        }
        if let spot = found.first(where: { if case .spot = $0 { return true }; return false }) { return spot }
        switch focus {
        case .street: return found.first { if case .house = $0 { return true }; return false }
        case .house, .room:
            return found.first { if case .locked = $0 { return true }; if case .room = $0 { return true }; return false }
                ?? found.first { if case .house = $0 { return true }; return false }
        }
    }

    // MARK: Each frame

    func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        let dt = last == 0 ? 0 : Float(time - last)
        last = time
        lock.lock()
        for character in characters.values {
            if character.finished { character.play("idle") }
            character.update(min(dt, 0.05))
        }
        lock.unlock()
    }
}
