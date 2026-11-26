import SceneKit
import UIKit

// The street, in 3D, seen from one fixed corner like a doll's house. A room
// is a square of floor with two walls behind it, and each house's rooms stand
// where its owner put them (HouseLayout.swift). Where a room has another
// behind it, the wall between comes down to the knee with a gap in it, so
// you can see in; it's only all the way up when you're in that room. Rooms
// that would hide others can be put away a floor at a time, and in a room
// whatever's in front of it or over it isn't shown. The camera never turns:
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
        /// Somewhere the room being placed could go.
        case cell(String, [Int])
        case spot(String, String, String)
    }

    let scene = SCNScene()
    let cameraNode = SCNNode()
    /// The town they stand in (HouseLand.swift), and its trees.
    private let ground = HouseLand.ground()
    private var trees: SCNNode?
    private var houses: [HouseShown] = []
    private var nodes: [String: SCNNode] = [:]
    private var characters: [String: MathCharacter] = [:]
    /// The characters are moved on SceneKit's own thread.
    private let lock = NSLock()
    /// The room is to sit in the top of the screen, over a sheet.
    private(set) var lifted = false
    private(set) var focus = Focus.street
    /// Bubbles on the spots of the room in focus.
    private(set) var decorating = false
    /// The highest floor shown in a house (nil: all of it).
    private(set) var floor: Int?
    /// A room being put somewhere, and where it could go.
    private(set) var placing: (room: String, cells: [[Int]])?
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
        scene.rootNode.addChildNode(ground)
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
        // Each on a block of the town, one behind the other up the screen (a
        // phone is tall), as many blocks back as it takes for the one in front
        // not to hide any of it. Seen from one fixed corner with no
        // perspective, two things only hide each other where they overlap on
        // screen.
        let up = simd_normalize(simd_cross(Self.back, Self.right))
        let step = SIMD3<Float>(-HouseLand.block, 0, -HouseLand.block)
        var top: Float = 0, at = SIMD3<Float>(0, 0, 0), blocks: [SIMD2<Int>] = []
        for (i, house) in houses.enumerated() {
            let node = build(house)
            let box = Self.box(house.state, right: Self.right, up: up)
            if i > 0 {
                at += step
                while simd_dot(at, up) + box.u0 < top + 2.6 { at += step }
            }
            node.simdPosition = at
            blocks.append(SIMD2(Int((at.x / HouseLand.block).rounded()), Int((at.z / HouseLand.block).rounded())))
            top = simd_dot(at, up) + box.u1
            scene.rootNode.addChildNode(node)
            nodes[house.kid] = node
        }
        trees?.removeFromParentNode()
        let trees = HouseLand.trees(around: blocks.isEmpty ? [SIMD2(0, 0)] : blocks)
        scene.rootNode.addChildNode(trees)
        self.trees = trees
        frame(animated: false)
    }

    /// How far a house's rooms reach across and up the screen, from where it stands.
    private static func box(_ state: HouseState, right: SIMD3<Float>, up: SIMD3<Float>) -> (r0: Float, r1: Float, u0: Float, u1: Float) {
        let S = HouseCatalog.side, H = HouseCatalog.height
        var r0 = Float.greatestFiniteMagnitude, r1 = -r0, u0 = r0, u1 = -r0
        for room in state.rooms {
            let c = state.cell(of: room)
            let o = SIMD3(Float(c[0]) * S, Float(c[1]) * H, Float(c[2]) * S)
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

    func setFloor(_ floor: Int?) {
        guard floor != self.floor else { return }
        self.floor = floor
        for house in houses { update(house) }
        frame(animated: true)
    }

    func setPlacing(_ placing: (room: String, cells: [[Int]])?) {
        self.placing = placing
        for house in houses where house.mine { update(house) }
        frame(animated: true)
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
        let state = house.state
        for id in state.rooms {
            guard let room = HouseCatalog.room(id), shows(state.cell(of: id), of: house) else { continue }
            let node = self.room(room, of: house)
            node.simdPosition = Self.at(state.cell(of: id))
            root.addChildNode(node)
        }
        // Where the room being placed could go.
        if house.mine, let placing, focus == .house(house.kid) {
            for cell in placing.cells where shows(cell, of: house) && state.room(at: cell) == nil {
                let tile = self.tile(placing.room, at: cell, of: house)
                tile.simdPosition = Self.at(cell)
                root.addChildNode(tile)
            }
        }
        let yard = SCNNode()
        yard.name = "yard"
        yard.addChildNode(HouseLand.fence())
        // Trees at the back of the lot; not while choosing where a room goes, so they're not in the way.
        if !(house.mine && placing != nil) { yard.addChildNode(HouseLand.garden(state, seed: house.kid)) }
        root.addChildNode(yard)
        // Whose it is, over the top of it.
        let top = state.rooms.map { state.cell(of: $0) }.max { $0[1] < $1[1] } ?? [0, 0, 0]
        let sign = HouseProps.sign([house.mine ? "My house" : "\(house.name)'s house"], width: 5.2)
        sign.name = "label"
        root.add(sign, Float(top[0]) * S + 0.4, Float(top[1] + 1) * H + 1.3, Float(top[2]) * S + 0.4)

        // They live in it: in the room in focus, or else the first.
        let character = MathCharacter(look: house.look, height: 1.5)
        character.play("idle")
        lock.lock(); characters[house.kid] = character; lock.unlock()
        var home = HouseCatalog.rooms[0]
        if case .room(let kid, let id) = focus, kid == house.kid, state.has(room: id), let r = HouseCatalog.room(id) { home = r }
        character.node.simdPosition = Self.at(state.cell(of: home.id)) + SIMD3(home.stand[0], 0, home.stand[1])
        character.node.isHidden = !shows(state.cell(of: home.id), of: house)
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
        // A wall with a room behind it is down to the knee, with a gap to walk
        // through, unless this is the room you're in.
        let cell = house.state.cell(of: room.id)
        let inHere = focus == .room(house.kid, room.id)
        let lowLeft = !inHere && house.state.room(at: [cell[0] - 1, cell[1], cell[2]]) != nil
        let lowRight = !inHere && house.state.room(at: [cell[0], cell[1], cell[2] - 1]) != nil
        top.castsShadow = false
        if lowLeft {
            for (a, b) in Self.knee {
                let piece = MathShape.box(0.3, 0.45, b - a, MathMat.color(paint.0))
                piece.castsShadow = false
                node.add(piece, -0.15, 0.225, (a + b) / 2)
            }
        } else {
            let left = MathShape.faced(0.3, wallH, S + 0.3, [outside, inside, outside, outside, outside, outside])
            left.castsShadow = false
            node.add(left, -0.15, wallH / 2, S / 2 - 0.15)
        }
        if lowRight {
            for (a, b) in Self.knee {
                let piece = MathShape.box(b - a, 0.45, 0.3, MathMat.color(paint.0))
                piece.castsShadow = false
                node.add(piece, (a + b) / 2, 0.225, -0.15)
            }
        } else {
            let rightWall = MathShape.faced(S, wallH, 0.3, [inside, outside, outside, outside, outside, outside])
            rightWall.castsShadow = false
            node.add(rightWall, S / 2, wallH / 2, -0.15)
        }

        var standing: [String: (at: SCNVector3, top: Float)] = [:]
        for spot in room.spots {
            // What hangs on a wall that's down isn't shown, and can only be chosen for from inside.
            if case .wall(let onLeft, _, _) = spot.place, onLeft ? lowLeft : lowRight { continue }
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

    /// A wall that's down: two bits either side of the gap, along it.
    private static let knee: [(Float, Float)] = [(-0.3, 1.4), (2.6, HouseCatalog.side)]

    /// Where a cell is in a house.
    private static func at(_ cell: [Int]) -> SIMD3<Float> {
        SIMD3(Float(cell[0]) * HouseCatalog.side, Float(cell[1]) * HouseCatalog.height, Float(cell[2]) * HouseCatalog.side)
    }

    /// Whether a room in this cell is shown, for the floor picked and the room in focus.
    private func shows(_ cell: [Int], of house: HouseShown) -> Bool {
        switch focus {
        case .street:
            return true
        case .house(let kid):
            guard kid == house.kid, let floor else { return true }
            return cell[1] <= floor
        case .room(let kid, let id):
            guard kid == house.kid, house.state.has(room: id) else { return true }
            // Nothing over it, or in front of it on its floor.
            let a = house.state.cell(of: id)
            if cell == a { return true }
            return cell[1] < a[1] || (cell[1] == a[1] && (cell[0] - a[0]) + (cell[2] - a[2]) <= 0)
        }
    }

    /// Somewhere the room being placed could go: its outline, and a bubble to tap.
    private func tile(_ room: String, at cell: [Int], of house: HouseShown) -> SCNNode {
        let S = HouseCatalog.side, H = HouseCatalog.height
        let node = SCNNode()
        node.name = "cell:\(house.kid):\(cell.map(String.init).joined(separator: ":"))"
        let glass = MathMat.color((HouseCatalog.room(room)?.gems ?? 0) > 0 ? "b9a3f0" : "ffffff", alpha: 0.38)
        // Flat, so it doesn't hide the rooms round it: a pane of glass where the floor would be.
        node.add(MathShape.box(S - 0.3, 0.16, S - 0.3, glass), S / 2, 0.08, S / 2)
        let bubble = HouseProps.bubble(empty: true)
        bubble.position = SCNVector3(S / 2, min(H * 0.3, 1.0), S / 2)
        node.addChildNode(bubble)
        node.enumerateHierarchy { n, _ in n.castsShadow = false }
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
        func box(_ house: HouseShown, _ cell: [Int], pad: Float) -> [SIMD3<Float>] {
            guard let origin = nodes[house.kid]?.simdPosition else { return [] }
            let o = origin + Self.at(cell)
            var out: [SIMD3<Float>] = []
            for x in [-pad, S + pad] { for y in [-pad, H + pad] { for z in [-pad, S + pad] { out.append(o + SIMD3(x, y, z)) } } }
            return out
        }
        func whole(_ house: HouseShown) -> [SIMD3<Float>] {
            var cells = house.state.rooms.map { house.state.cell(of: $0) }
            if house.mine, let placing, focus == .house(house.kid) { cells += placing.cells }
            cells = cells.filter { shows($0, of: house) }
            var out = cells.flatMap { box(house, $0, pad: 0.2) }
            if focus == .street, let origin = nodes[house.kid]?.simdPosition {
                // The sign over it.
                let top = house.state.rooms.map { house.state.cell(of: $0)[1] }.max() ?? 0
                out.append(origin + SIMD3(0, Float(top + 1) * H + 2.2, 0))
            }
            return out
        }
        switch focus {
        case .street: return houses.flatMap(whole)
        case .house(let kid): return houses.filter { $0.kid == kid }.flatMap(whole)
        case .room(let kid, let id):
            guard let house = houses.first(where: { $0.kid == kid }), house.state.has(room: id) else { return houses.flatMap(whole) }
            return box(house, house.state.cell(of: id), pad: 0.35)
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
    /// Looking at the basement, the ground is taken away and it stands in earth.
    private func tidy() {
        var under = placing?.room == "basement"
        switch focus {
        case .street: break
        case .house: under = under || floor == -1
        case .room(let kid, let id): under = houses.first { $0.kid == kid }?.state.cell(of: id)[1] == -1
        }
        // Underground: no grass or trees, just earth round the basement.
        ground.isHidden = under
        trees?.isHidden = under
        scene.background.contents = under ? UIColor(red: 0.45, green: 0.33, blue: 0.24, alpha: 1) : Self.sky
        for (kid, node) in nodes {
            node.childNode(withName: "label", recursively: false)?.isHidden = focus != .street
            node.childNode(withName: "yard", recursively: false)?.isHidden = under
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
                    if parts.first == "cell", parts.count == 5 { found.append(.cell(parts[1], parts[2...].compactMap { Int($0) })) }
                    if parts.first == "house", parts.count == 2 { found.append(.house(parts[1])) }
                }
                node = n.parent
            }
        }
        if let cell = found.first(where: { if case .cell = $0 { return true }; return false }) { return cell }
        if let spot = found.first(where: { if case .spot = $0 { return true }; return false }) { return spot }
        switch focus {
        case .street: return found.first { if case .house = $0 { return true }; return false }
        case .house, .room:
            return found.first { if case .room = $0 { return true }; return false }
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
