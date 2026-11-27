import SceneKit
import UIKit

// The neighbourhood (HouseTown.swift), in 3D, seen from one fixed corner like a doll's house. A room
// is a square of floor with two walls behind it, and each house's rooms stand
// where its owner put them (HouseLayout.swift). Where a room has another
// behind it, the wall between comes down to the knee with a gap in it, so
// you can see in; it's only all the way up when you're in that room, and
// then there's a doorway where the gap was. Each floor over the ground has
// a flight of stairs up to it, outside (HouseLayout.stairs). On the
// street a house is shut, with a roof. Inside, a floor picked is the one
// you're on: those over it go, those under it fade. Rooms that would hide
// others can be put away a floor at a time, and whatever's in front of the
// room you're in, or over it, is only a ghost of itself.
//
// The camera never turns, and it's never locked: the town can be dragged
// about and pinched closer or further from anywhere. How close it is says
// what's shown. From far off the houses are shut; close to one, it opens;
// closer still, the room in the middle of the screen is the one you're in,
// with a marker on each of its spots. A tap on a house or a room only flies
// there. Only a card over the bottom of the screen, or a room being put
// somewhere, holds what's in focus while the town's moved.

/// One house to show: whose, and how it stands.
struct HouseShown: Equatable {
    let kid: String
    let name: String
    let mine: Bool
    var state: HouseState
    var look: MathLook
    /// Someone else who lives there too (Mom & Dad's has two).
    var partner: MathLook? = nil
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
    /// The town they stand in (HouseTown.swift): its streets, the neighbours, the trees.
    private let land = HouseTown.land()
    /// Everyone's houses, and Mom & Dad's (HouseTown.parents), which is always there.
    private var houses: [HouseShown] = []
    /// The lot each stands on.
    private var lots: [String: HouseTown.Lot] = [:]
    private var nodes: [String: SCNNode] = [:]
    private var characters: [String: MathCharacter] = [:]
    /// The characters are moved on SceneKit's own thread.
    private let lock = NSLock()
    /// A card's up over the bottom of the screen, for a spot of the room in focus.
    private(set) var lifted = false
    /// What the camera's on: nothing in particular, a house (open), or a room of one.
    private(set) var focus = Focus.street
    /// Told when what's in focus changes, or the town's moved from how it's first shown.
    var changed: (() -> Void)?
    /// Waiting for a tap on the room to move: the house stays as it is meanwhile.
    var picking = false
    /// Markers on the spots of the room in focus.
    private(set) var decorating = false
    /// The spot the card's for ("den.desk"): its marker stands out.
    private(set) var chosen: String?
    /// Where the camera was before the card came up, and where the card put it.
    private var beforeLift: (was: Roam, put: Roam)?
    /// The highest floor shown in a house (nil: all of it).
    private(set) var floor: Int?
    /// A room being put somewhere, and where it could go.
    private(set) var placing: (room: String, cells: [[Int]])?
    private var aspect: Float = 0.46
    private var last: TimeInterval = 0
    /// Where the camera looks, and how much it takes in: half the height of the view, in the world.
    typealias Eye = (middle: SIMD3<Float>, scale: Float)
    /// How the family's end of the street is framed, before anyone moves it.
    private var framed: Eye = (.zero, 12)
    /// Pulled right back, to the whole neighbourhood.
    private(set) var wide = false
    /// Where the camera is from there, dragged, pinched or flown: across the
    /// screen and away up it, along the ground, and how many times closer.
    private(set) var roam = Roam()

    struct Roam: Equatable {
        var across: Float = 0
        var away: Float = 0
        var zoom: Float = 1

        /// As far as the town can be pinched out and in: in, at least this
        /// many times, and as much further as gets a room filling the screen.
        static let zooms: ClosedRange<Float> = 0.3...3
        /// The least of the world the view takes in, half its height: a bit of a room.
        static let closest: Float = 4.5
        /// As far as it can be dragged either way. (The town's edges stop it sooner: HouseStage.hold.)
        static let reach: Float = 200
        /// A point up the screen is further than that along the ground, by this.
        static let tilt = HouseStage.back.y

        /// How much of the world a point of the screen covers, when the
        /// street is framed at `scale` in a view `height` points high.
        func perPoint(scale: Float, height: CGFloat) -> Float {
            2 * scale / zoom / Float(max(1, height))
        }

        /// Dragged by `by` points: the town goes with the finger.
        mutating func drag(by: CGPoint, scale: Float, height: CGFloat) {
            let k = perPoint(scale: scale, height: height)
            across -= Float(by.x) * k
            away += Float(by.y) * k / Self.tilt
            settle()
        }

        /// Pinched by `factor` about `at`, in points from the middle of the
        /// view: what's under the fingers stays under them.
        mutating func pinch(by factor: CGFloat, about at: CGPoint, scale: Float, height: CGFloat) {
            guard factor > 0 else { return }
            let before = perPoint(scale: scale, height: height)
            zoom = min(max(zoom * Float(factor), Self.zooms.lowerBound), max(Self.zooms.upperBound, scale / Self.closest))
            let moved = before - perPoint(scale: scale, height: height)
            across += Float(at.x) * moved
            away -= Float(at.y) * moved / Self.tilt
            settle()
        }

        private mutating func settle() {
            across = min(max(across, -Self.reach), Self.reach)
            away = min(max(away, -Self.reach), Self.reach)
        }
    }

    /// Towards the camera, from anything it looks at.
    private static let back = simd_normalize(SIMD3<Float>(1, 0.86, 1))
    private static let right = simd_normalize(SIMD3<Float>(1, 0, -1))
    /// Up the screen, and the way along the ground that goes up it.
    private static let up = simd_normalize(simd_cross(back, right))
    private static let away = simd_normalize(SIMD3<Float>(-1, 0, -1))

    override init() {
        super.init()
        let camera = SCNCamera()
        camera.usesOrthographicProjection = true
        camera.orthographicScale = 12
        camera.zNear = 1
        camera.zFar = Double(Self.distance) * 2.2
        cameraNode.camera = camera
        scene.rootNode.addChildNode(cameraNode)
        cameraNode.simdPosition = Self.back * Self.distance
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
        // Over the middle of the town, and wide enough to shade all of it.
        sun.light?.shadowMapSize = CGSize(width: 4096, height: 4096)
        sun.light?.orthographicScale = 115
        sun.light?.zFar = 420
        sun.simdPosition = HouseTown.middle + SIMD3(52, 112, 96)
        sun.look(at: SCNVector3(HouseTown.middle.x, 4, HouseTown.middle.z - 4))
        scene.rootNode.addChildNode(sun)
        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.intensity = 620
        ambient.light?.color = UIColor(red: 0.95, green: 0.97, blue: 1, alpha: 1)
        scene.rootNode.addChildNode(ambient)
        scene.background.contents = Self.sky
        scene.rootNode.addChildNode(land)
    }

    /// How far off the camera is. Pulled back to the whole town, the top of
    /// the screen is a long way further than the bottom: far enough off that
    /// neither is cut short.
    private static let distance: Float = 520

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

    /// Put these houses in the town, each on its lot (HouseTown.lots), with Mom & Dad's. Any already there is rebuilt.
    func show(_ shown: [HouseShown]) {
        let houses = shown + [HouseTown.parents]
        self.houses = houses
        lots = HouseTown.lots(for: houses.map { ($0.kid, $0.name) })
        for node in nodes.values { node.removeFromParentNode() }
        nodes = [:]
        lock.lock(); characters = [:]; lock.unlock()
        for house in houses {
            let node = build(house)
            node.simdPosition = lots[house.kid]?.origin ?? .zero
            scene.rootNode.addChildNode(node)
            nodes[house.kid] = node
        }
        reframe()
        tidy()
        settle()
    }

    /// How a house that's shown stands: a kid's, or Mom & Dad's.
    func state(of kid: String) -> HouseState? { houses.first { $0.kid == kid }?.state }

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

    /// A house has changed: build it again where it stands. `fading`, the
    /// old one goes and the new one comes over a moment: a roof lifting off.
    func update(_ house: HouseShown, popping spot: String? = nil, fading: Bool = false) {
        guard let at = houses.firstIndex(where: { $0.kid == house.kid }), let old = nodes[house.kid] else { return }
        houses[at] = house
        let node = build(house)
        node.simdPosition = old.simdPosition
        scene.rootNode.addChildNode(node)
        nodes[house.kid] = node
        if fading {
            // The old one's still there for a moment, and isn't to be tapped.
            old.enumerateHierarchy { n, _ in n.name = nil; n.castsShadow = false }
            let time = 0.22
            if open(house.kid) {
                old.runAction(.sequence([.fadeOut(duration: time), .removeFromParentNode()]))
            } else {
                // Shutting: the walls and roof come in over the rooms.
                node.opacity = 0
                node.runAction(.fadeIn(duration: time))
                old.runAction(.sequence([.wait(duration: time), .removeFromParentNode()]))
            }
        } else {
            old.removeFromParentNode()
        }
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

    /// The floor of the open house to look at (nil: all of it).
    func setFloor(_ floor: Int?) {
        guard floor != self.floor else { return }
        self.floor = floor
        for house in houses where open(house.kid) { update(house) }
        // The room they were in may not be on it.
        settle()
    }

    /// Show where a room could go in their house, all of it in view; or stop.
    func setPlacing(_ placing: (room: String, cells: [[Int]])?) {
        self.placing = placing
        guard let mine = houses.first(where: \.mine) else { return }
        if placing != nil {
            set(.house(mine.kid), rebuilding: true)
            fly(to: .house(mine.kid))
        } else {
            update(mine)
            settle()
        }
    }

    func setDecorating(_ on: Bool) {
        guard on != decorating else { return }
        decorating = on
        for house in houses where house.mine { update(house) }
    }

    // MARK: Building

    private func build(_ house: HouseShown) -> SCNNode {
        let root = SCNNode()
        root.name = "house:\(house.kid)"
        let S = HouseCatalog.side, H = HouseCatalog.height
        let state = house.state
        for id in state.rooms {
            let shown = presence(state.cell(of: id), of: house)
            guard let room = HouseCatalog.room(id), shown > 0 else { continue }
            let node = self.room(room, of: house)
            node.simdPosition = at(state.cell(of: id), of: house.kid)
            if shown < 1 {
                node.opacity = shown
                node.enumerateHierarchy { n, _ in n.castsShadow = false }
                // A hair nearer the camera, so where it shares a face with a solid room it doesn't flicker with it.
                node.simdPosition += Self.back * 0.03
            }
            root.addChildNode(node)
        }
        // A way up to each floor, outside.
        let flights = SCNNode()
        flights.name = "stairs"
        for stairs in Self.stairs(state) {
            let shown = presence(stairs.foot, of: house)
            guard shown > 0 else { continue }
            let node = HouseProps.stairs(right: stairs.right, floor: stairs.foot[1])
            node.simdPosition = at(HouseLayout.below(stairs.top), of: house.kid)
            if shown < 1 {
                node.opacity = shown
                node.enumerateHierarchy { n, _ in n.castsShadow = false }
            }
            flights.addChildNode(node)
        }
        root.addChildNode(flights)
        // Where the room being placed could go.
        if house.mine, let placing, focus == .house(house.kid) {
            for cell in placing.cells where presence(cell, of: house) > 0 && state.room(at: cell) == nil {
                let tile = self.tile(placing.room, at: cell, of: house)
                tile.simdPosition = at(cell, of: house.kid)
                root.addChildNode(tile)
            }
        }
        let yard = SCNNode()
        yard.name = "yard"
        yard.addChildNode(HouseLand.fence())
        // A path from the front door down to the street.
        if let lot = lots[house.kid], let door = Self.frontDoor(state) { yard.addChildNode(HouseTown.path(from: door, on: lot)) }
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
        character.node.simdPosition = at(state.cell(of: home.id), of: house.kid) + SIMD3(home.stand[0], 0, home.stand[1])
        let shown = presence(state.cell(of: home.id), of: house)
        character.node.isHidden = shown == 0
        if shown < 1 { character.node.opacity = shown }
        if !open(house.kid), let door = Self.frontDoor(state) {
            // Out on the front step.
            character.node.simdPosition = at(door, of: house.kid) + SIMD3(HouseCatalog.side * 0.62, 0, HouseCatalog.side + 1.2)
        }
        // Facing out, towards whoever's looking.
        character.node.eulerAngles.y = .pi * 1.25
        root.addChildNode(character.node)
        if let look = house.partner {
            // Beside them on the step; indoors, in the kitchen.
            let partner = MathCharacter(look: look, height: 1.5)
            partner.play("idle")
            lock.lock(); characters[house.kid + "+"] = partner; lock.unlock()
            partner.node.simdPosition = character.node.simdPosition + SIMD3(1.3, 0, 0.2)
            if open(house.kid) {
                let kitchen = HouseCatalog.room("kitchen").flatMap { state.has(room: $0.id) && $0.id != home.id ? $0 : nil }
                if let kitchen {
                    partner.node.simdPosition = at(state.cell(of: kitchen.id), of: house.kid) + SIMD3(kitchen.stand[0], 0, kitchen.stand[1])
                    let seen = presence(state.cell(of: kitchen.id), of: house)
                    partner.node.isHidden = seen == 0
                    if seen < 1 { partner.node.opacity = seen }
                } else {
                    partner.node.isHidden = true
                }
            }
            partner.node.eulerAngles.y = .pi * 1.25
            root.addChildNode(partner.node)
        }
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
        // From far off a house is shut: walls all round and a roof, nothing of inside.
        let closed = !open(house.kid)
        // A wall with a room behind it has a way through, always: the gap in
        // it when it's down, a doorway when it's up.
        let doorLeft = !closed && house.state.room(at: [cell[0] - 1, cell[1], cell[2]]) != nil
        let doorRight = !closed && house.state.room(at: [cell[0], cell[1], cell[2] - 1]) != nil
        let lowLeft = !inHere && doorLeft, lowRight = !inHere && doorRight
        top.castsShadow = false
        // A length of the left wall (along z) or the right (along x), from `a` to `b` and `y0` to `y1`.
        // (`plain`: no skirting on its inside. `low`: the wall's colour all over, as a wall that's down is.)
        func wall(left: Bool, _ a: Float, _ b: Float, _ y0: Float, _ y1: Float, plain: Bool = false, low: Bool = false) {
            let flat = MathMat.color(paint.0), back = low ? flat : outside
            let piece = left
                ? MathShape.faced(0.3, y1 - y0, b - a, [back, plain || low ? flat : inside, back, back, back, back])
                : MathShape.faced(b - a, y1 - y0, 0.3, [plain || low ? flat : inside, back, back, back, back, back])
            piece.castsShadow = false
            node.add(piece, left ? -0.15 : (a + b) / 2, (y0 + y1) / 2, left ? (a + b) / 2 : -0.15)
        }
        for left in [true, false] {
            // The left wall runs on past the corner, to close it.
            let from: Float = left ? -0.3 : 0
            if left ? lowLeft : lowRight {
                for (a, b) in Self.knee { wall(left: left, a, b, 0, 0.45, low: true) }
            } else if left ? doorLeft : doorRight {
                for (a, b) in Self.knee { wall(left: left, max(a, from), b, 0, wallH) }
                // Over the doorway, if the wall's that high (the garden's isn't).
                if wallH > Self.doorway + 0.2 { wall(left: left, Self.knee[0].1, Self.knee[1].0, Self.doorway, wallH, plain: true) }
            } else {
                wall(left: left, from, S, 0, wallH)
            }
        }

        if closed {
            Self.outside(of: node, room: room, cell: cell, state: house.state, wall: outside, height: wallH, solar: house.kid == HouseTown.parentsID)
            // A door out onto the top of the stairs.
            for stairs in Self.stairs(house.state) where stairs.top == cell {
                let frame = MathMat.color("f6f1e4"), door = MathMat.color("b5483b")
                if stairs.right {
                    node.add(MathShape.box(0.1, 2.3, 1.3, frame), S + 0.33, 1.15, 0.62)
                    node.add(MathShape.box(0.1, 2.15, 1.1, door), S + 0.36, 1.08, 0.62)
                } else {
                    node.add(MathShape.box(1.3, 2.3, 0.1, frame), 0.62, 1.15, S + 0.33)
                    node.add(MathShape.box(1.1, 2.15, 0.1, door), 0.62, 1.08, S + 0.36)
                }
            }
            return node
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
            if case .wall(let onLeft, _, _) = spot.place, onLeft ? doorLeft : doorRight, wallH > Self.doorway + 1 {
                // On a wall with a doorway, it hangs clear over the top of it.
                let h = wallH - 0.7
                anchor.at.y = h
                anchor.bubble.y = h
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
            if house.mine, decorating, inHere {
                let empty = item == nil || (spot.starter != nil && item == spot.starter)
                let bubble = HouseProps.marker(spot.symbol, key == chosen ? .chosen : empty ? .empty : .filled)
                bubble.name = "spot:\(house.kid):\(room.id):\(spot.id)"
                bubble.position = SCNVector3(anchor.bubble.x, anchor.bubble.y, anchor.bubble.z)
                node.addChildNode(bubble)
            }
        }
        return node
    }

    /// The front of a room seen from the street: walls where nothing's in
    /// front of it, with a window in each, and a roof if nothing's on top.
    /// The front door's on the room nearest the street, on the ground.
    private static func outside(of node: SCNNode, room: HouseRoom, cell: [Int], state: HouseState, wall: SCNMaterial, height h: Float, solar: Bool = false) {
        let S = HouseCatalog.side
        let garden = room.id == "garden"
        // A wall to the front where nothing's there, or only the garden (it has no roof to hide behind).
        func open(_ c: [Int]) -> Bool { state.room(at: c).map { $0 == "garden" } ?? true }
        let frontX = open([cell[0] + 1, cell[1], cell[2]])
        let frontZ = open([cell[0], cell[1], cell[2] + 1])
        let glass = MathMat.color("a9d6ef"), frame = MathMat.color("f6f1e4")
        let door = cell == frontDoor(state)
        if frontX {
            node.add(MathShape.box(0.3, h, S + 0.6, wall), S + 0.15, h / 2, S / 2)
            if !garden {
                node.add(MathShape.box(0.1, 1.3, 1.5, frame), S + 0.33, h * 0.55, S / 2)
                node.add(MathShape.box(0.1, 1.1, 1.3, glass), S + 0.36, h * 0.55, S / 2)
            }
        }
        if frontZ {
            node.add(MathShape.box(S + 0.6, h, 0.3, wall), S / 2, h / 2, S + 0.15)
            if door {
                node.add(MathShape.box(1.3, 2.3, 0.1, frame), S * 0.3, 1.15, S + 0.33)
                node.add(MathShape.box(1.1, 2.15, 0.1, MathMat.color("b5483b")), S * 0.3, 1.08, S + 0.36)
                node.add(MathShape.box(1.5, 0.2, 0.9, MathMat.color("d9d2c0")), S * 0.3, 0.1, S + 0.75)
                node.add(MathShape.box(1.3, 1.1, 0.1, frame), S * 0.72, h * 0.55, S + 0.33)
                node.add(MathShape.box(1.1, 0.9, 0.1, glass), S * 0.72, h * 0.55, S + 0.36)
            } else if !garden {
                node.add(MathShape.box(1.5, 1.3, 0.1, frame), S / 2, h * 0.55, S + 0.33)
                node.add(MathShape.box(1.3, 1.1, 0.1, glass), S / 2, h * 0.55, S + 0.36)
            }
        }
        guard !garden, state.room(at: HouseLayout.above(cell)) == nil else { return }
        // A lid, and a roof on it: a dome on the observatory, a gable on the rest.
        node.add(MathShape.box(S + 0.6, 0.25, S + 0.6, MathMat.color("8a5a44")), S / 2, h + 0.12, S / 2)
        if room.id == "observatory" {
            let dome = MathShape.sphere(S * 0.42, MathMat.color("dfe6ee"), segments: 20)
            node.add(dome, S / 2, h + 0.25, S / 2)
            return
        }
        let path = UIBezierPath()
        let half = CGFloat(S / 2 + 0.35)
        path.move(to: CGPoint(x: -half, y: 0))
        path.addLine(to: CGPoint(x: half, y: 0))
        path.addLine(to: CGPoint(x: 0, y: 1.7))
        path.close()
        let shape = SCNShape(path: path, extrusionDepth: CGFloat(S + 0.6))
        shape.materials = [MathMat.color("c0574a")]
        node.add(SCNNode(geometry: shape), S / 2, h + 0.25, S / 2)
        guard solar else { return }
        // Solar panels on the slope that faces whoever's looking, as Mom & Dad's has.
        let slope = atan2(Float(1.7), Float(half)), length = hypot(Float(1.7), Float(half))
        let panel = SCNNode()
        panel.addChildNode(MathShape.box(length * 0.62, 0.07, S * 0.74, MathMat.color("e8edf2")))
        panel.add(MathShape.box(length * 0.56, 0.07, S * 0.68, MathMat.color("27406b")), 0, 0.02, 0)
        panel.eulerAngles.z = -slope
        node.add(panel, S / 2 + Float(half) / 2 + sin(slope) * 0.05, h + 0.25 + 0.85 + cos(slope) * 0.05, S / 2)
    }

    /// Where the front door is: the room on the ground nearest the street.
    static func frontDoor(_ state: HouseState) -> [Int]? {
        state.rooms.map { state.cell(of: $0) }.filter { $0[1] == 0 }.max { ($0[0] + $0[2], $0[2]) < ($1[0] + $1[2], $1[2]) }
    }

    /// A wall with a way through: the two lengths either side of the gap, along it.
    private static let knee: [(Float, Float)] = [(-0.3, 1.4), (2.6, HouseCatalog.side)]
    /// How high a doorway is.
    private static let doorway: Float = 1.85

    /// Where a house's stairs go (HouseLayout.stairs).
    private static func stairs(_ state: HouseState) -> [HouseLayout.Stairs] {
        HouseLayout.stairs(Dictionary(uniqueKeysWithValues: state.rooms.map { ($0, state.cell(of: $0)) }))
    }

    /// Where a cell is in a house.
    private func at(_ cell: [Int], of kid: String) -> SIMD3<Float> {
        SIMD3(Float(cell[0]) * HouseCatalog.side, Float(cell[1]) * HouseCatalog.height, Float(cell[2]) * HouseCatalog.side)
    }

    /// Whether a house is open: the one the camera's on.
    private func open(_ kid: String) -> Bool {
        switch focus {
        case .street: false
        case .house(let k), .room(let k, _): k == kid
        }
    }

    /// How much of a room in this cell is shown: all of it (1), none of it,
    /// or a ghost of it, for the floor picked and the room in focus.
    private func presence(_ cell: [Int], of house: HouseShown) -> CGFloat {
        guard open(house.kid) else { return 1 }
        if let floor {
            if cell[1] > floor { return 0 }
            if cell[1] < floor { return 0.3 }
        }
        if case .room(_, let id) = focus, house.state.has(room: id) {
            let a = house.state.cell(of: id)
            // What's over it, or in front of it on its floor, would be in the way: a ghost, to tap to go there.
            if cell != a, cell[1] > a[1] || (cell[1] == a[1] && (cell[0] - a[0]) + (cell[2] - a[2]) > 0) { return Self.ghost }
        }
        return 1
    }

    /// How much is left of a room that's in the way of the one in focus.
    private static let ghost: CGFloat = 0.14

    /// Somewhere the room being placed could go: its outline, and a bubble to tap.
    private func tile(_ room: String, at cell: [Int], of house: HouseShown) -> SCNNode {
        let S = HouseCatalog.side, H = HouseCatalog.height
        let node = SCNNode()
        node.name = "cell:\(house.kid):\(cell.map(String.init).joined(separator: ":"))"
        let glass = MathMat.color((HouseCatalog.room(room)?.gems ?? 0) > 0 ? "b9a3f0" : "ffffff", alpha: 0.38)
        // Flat, so it doesn't hide the rooms round it: a pane of glass where the floor would be.
        node.add(MathShape.box(S - 0.3, 0.16, S - 0.3, glass), S / 2, 0.08, S / 2)
        let bubble = HouseProps.marker("plus", .empty)
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

    func setAspect(_ aspect: Float) {
        guard aspect > 0, abs(aspect - self.aspect) > 0.001 else { return }
        self.aspect = aspect
        reframe()
    }

    /// The corners of something to look at, in the world.
    private func corners(_ focus: Focus) -> [SIMD3<Float>] {
        let S = HouseCatalog.side, H = HouseCatalog.height
        func box(_ house: HouseShown, _ cell: [Int], pad: Float) -> [SIMD3<Float>] {
            guard let origin = nodes[house.kid]?.simdPosition else { return [] }
            let o = origin + at(cell, of: house.kid)
            var out: [SIMD3<Float>] = []
            for x in [-pad, S + pad] { for y in [-pad, H + pad] { for z in [-pad, S + pad] { out.append(o + SIMD3(x, y, z)) } } }
            return out
        }
        func whole(_ house: HouseShown, sign: Bool) -> [SIMD3<Float>] {
            var cells = house.state.rooms.map { house.state.cell(of: $0) }
            if house.mine, let placing, focus == .house(house.kid) { cells += placing.cells }
            if !sign { cells = cells.filter { presence($0, of: house) > 0 } }
            var out = cells.flatMap { box(house, $0, pad: 0.2) }
            // The stairs stand out from it.
            if let origin = nodes[house.kid]?.simdPosition {
                for stairs in Self.stairs(house.state) where sign || presence(stairs.foot, of: house) > 0 {
                    let o = origin + at(HouseLayout.below(stairs.top), of: house.kid)
                    out += stairs.right ? [o + SIMD3(S + 1.5, 0, S), o + SIMD3(S + 1.5, H + 1, 0)] : [o + SIMD3(S, 0, S + 1.5), o + SIMD3(0, H + 1, S + 1.5)]
                }
            }
            if sign, let origin = nodes[house.kid]?.simdPosition {
                // The sign over it.
                let top = house.state.rooms.map { house.state.cell(of: $0)[1] }.max() ?? 0
                out.append(origin + SIMD3(0, Float(top + 1) * H + 2.2, 0))
            }
            return out
        }
        switch focus {
        case .street: return houses.flatMap { whole($0, sign: true) }
        case .house(let kid): return houses.filter { $0.kid == kid }.flatMap { whole($0, sign: false) }
        case .room(let kid, let id):
            guard let house = houses.first(where: { $0.kid == kid }), house.state.has(room: id) else { return corners(.street) }
            return box(house, house.state.cell(of: id), pad: 0.35)
        }
    }

    /// How to look at all of these: lower down the screen than the middle,
    /// clear of the purse; or, `lifted`, in the top of it, over a card.
    private func framing(_ points: [SIMD3<Float>], lifted: Bool = false) -> Eye? {
        guard !points.isEmpty else { return nil }
        let right = Self.right, up = Self.up
        var r0 = Float.greatestFiniteMagnitude, r1 = -r0, u0 = r0, u1 = -r0
        for p in points {
            let r = simd_dot(p, right), u = simd_dot(p, up)
            r0 = min(r0, r); r1 = max(r1, r); u0 = min(u0, u); u1 = max(u1, u)
        }
        // Room at the top for the purse and at the bottom for the buttons.
        let tall = (u1 - u0) / 2 / (lifted ? 0.44 : 0.68), wide = (r1 - r0) / 2 / aspect / 0.94
        let scale = max(tall, wide)
        return (right * ((r0 + r1) / 2) + up * ((u0 + u1) / 2 + scale * (lifted ? Self.raised : Self.lowered)), scale)
    }

    /// How far up the screen from its middle the camera looks, of half the
    /// screen: what's framed sits a little under the middle, or well over it
    /// with a card up.
    private static let lowered: Float = 0.1, raised: Float = -0.4

    private func framing(_ focus: Focus, lifted: Bool = false) -> Eye? {
        guard var eye = framing(corners(focus), lifted: lifted) else { return nil }
        // A small house isn't looked at so closely that it's a room in focus.
        if case .house = focus { eye.scale = max(eye.scale, roomScale * 1.3) }
        return eye
    }

    /// How much the view takes in when one room fills it.
    private var roomScale: Float {
        let S = HouseCatalog.side, H = HouseCatalog.height, pad: Float = 0.35
        var points: [SIMD3<Float>] = []
        for x in [-pad, S + pad] { for y in [-pad, H + pad] { for z in [-pad, S + pad] { points.append(SIMD3(x, y, z)) } } }
        return framing(points)?.scale ?? 8
    }

    /// Where the camera looks and how much it takes in, as it's been moved.
    private var eye: Eye {
        (framed.middle + Self.right * roam.across + Self.away * roam.away, framed.scale / roam.zoom)
    }

    /// How far it's been moved from the street's framing, to look like that.
    private func roam(for eye: Eye) -> Roam {
        let d = eye.middle - framed.middle
        return Roam(across: simd_dot(d, Self.right), away: simd_dot(d, Self.up) / simd_dot(Self.away, Self.up), zoom: framed.scale / max(0.01, eye.scale))
    }

    /// The street's changed, or the screen: frame it again, and leave the camera where they have it.
    private func reframe() {
        let was = eye, moved = roam != Roam()
        if let street = framing(.street) { framed = street }
        if wide, let town = framing(HouseTown.corners) { roam = roam(for: town) } else if moved { roam = roam(for: was) }
        look(animated: false)
    }

    /// Put the camera where the framing and the moving say.
    private func look(animated: Bool) {
        let eye = self.eye
        SCNTransaction.begin()
        SCNTransaction.animationDuration = animated ? 0.55 : 0
        SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        // Along the ground, so the town stays the same distance off and nothing is cut short.
        // (It only ever looks one way: set once, in init.)
        cameraNode.simdPosition = eye.middle + Self.back * Self.distance
        cameraNode.camera?.orthographicScale = Double(eye.scale)
        SCNTransaction.commit()
    }

    // MARK: What's in focus

    /// Whether the town's been moved from how the street's first shown.
    var moved: Bool { roam != Roam() }

    /// What's in focus stays so, however the town's moved: a card's up, or a room's being put somewhere.
    private var held: Bool { lifted || placing != nil || picking }

    /// Go and look at the street, a house or a room. Nothing's locked: they can drag and pinch away from it.
    func fly(to focus: Focus, animated: Bool = true) {
        wide = false
        set(focus)
        if case .street = focus { roam = Roam() } else if let eye = framing(focus, lifted: lifted) { roam = roam(for: eye) }
        look(animated: animated)
        changed?()
    }

    /// Pull right back, to the whole neighbourhood from edge to edge.
    func flyToTown(animated: Bool = true) {
        set(.street)
        if let town = framing(HouseTown.corners) { roam = roam(for: town) }
        wide = true
        look(animated: animated)
        changed?()
    }

    /// Dragged or pinched off the edge of the town: back to where there's something to see.
    private func hold() {
        let eye = self.eye
        let ground = eye.middle - Self.back * (eye.middle.y / Self.back.y)
        let d = HouseTown.kept(ground) - ground
        guard simd_length(d) > 0.001 else { return }
        roam.across += simd_dot(d, Self.right)
        roam.away += simd_dot(d, Self.away)
    }

    private func set(_ new: Focus, rebuilding: Bool = false) {
        guard new != focus || rebuilding else { return }
        let was = focus
        func kid(_ focus: Focus) -> String? {
            switch focus {
            case .street: nil
            case .house(let kid), .room(let kid, _): kid
            }
        }
        focus = new
        // The floor picked was of the house they were in.
        if kid(was) != kid(new) { floor = nil }
        // Going between rooms moves who lives there, the walls and the markers.
        for house in houses where house.kid == kid(was) || house.kid == kid(new) { update(house, fading: was != new) }
        tidy()
        changed?()
    }

    /// The town's been moved: what the camera's on now is what's in focus.
    private func settle() {
        guard !held else { return }
        set(seen())
    }

    /// What the camera's on, by where it is and how close: from far off, the
    /// street; near a house, that house, open; nearer still, the room of it
    /// in the middle of the screen. What's in focus already is a little
    /// harder to leave than to get to, so nothing flickers at the edge.
    private func seen() -> Focus {
        let right = Self.right, up = Self.up, S = HouseCatalog.side, H = HouseCatalog.height
        let eye = self.eye
        // What's framed sits a little under the middle of the screen: that's the middle of what's seen.
        let at = eye.middle - up * eye.scale * Self.lowered
        let r = simd_dot(at, right), u = simd_dot(at, up)
        // The house nearest it.
        var best: (house: HouseShown, origin: SIMD3<Float>, gap: Float)?
        for house in houses {
            guard let origin = nodes[house.kid]?.simdPosition else { continue }
            let box = Self.box(house.state, right: right, up: up)
            let or = simd_dot(origin, right), ou = simd_dot(origin, up)
            let gap = max(box.r0 + or - r, r - box.r1 - or, box.u0 + ou - u, u - box.u1 - ou, 0)
            if best == nil || gap < best!.gap { best = (house, origin, gap) }
        }
        guard let (house, origin, gap) = best else { return .street }
        let wasOpen = open(house.kid), room = roomScale
        let fit = framing(corners(.house(house.kid)))?.scale ?? room
        guard eye.scale <= max(fit * (wasOpen ? 1.7 : 1.4), room * (wasOpen ? 2 : 1.7)), gap <= S * (wasOpen ? 2 : 1) else { return .street }
        // Close enough for a room to be most of the screen: the one in the middle of it.
        var inRoom: String?
        if case .room(house.kid, let id) = focus { inRoom = id }
        guard eye.scale <= room * (inRoom != nil ? 1.5 : 1.25) else { return .house(house.kid) }
        var nearest: (id: String, far: Float)?
        for id in house.state.rooms {
            let cell = house.state.cell(of: id)
            // On the floor picked; or, with all of it showing, not under the ground.
            guard floor.map({ cell[1] == $0 }) ?? (cell[1] >= 0) else { continue }
            let middle = origin + self.at(cell, of: house.kid) + SIMD3(S / 2, H * 0.4, S / 2)
            var far = hypot(simd_dot(middle, right) - r, simd_dot(middle, up) - u)
            if id == inRoom { far -= 1 }
            if nearest == nil || far < nearest!.far { nearest = (id, far) }
        }
        return nearest.map { .room(house.kid, $0.id) } ?? .house(house.kid)
    }

    // MARK: A card over the bottom

    /// A card's come up for a spot: its room goes up into what's left of the
    /// screen, and stays in focus whatever's done until the card's gone.
    func lift(_ kid: String, _ room: String, spot: String) {
        let key = HouseCatalog.key(room, spot)
        let rebuilding = chosen != key
        chosen = key
        wide = false
        if !lifted || focus != .room(kid, room) {
            if !lifted { beforeLift = (roam, roam) }
            lifted = true
            set(.room(kid, room), rebuilding: rebuilding)
            if let eye = framing(.room(kid, room), lifted: true) { roam = roam(for: eye) }
            beforeLift?.put = roam
            look(animated: true)
        } else if rebuilding, let house = houses.first(where: { $0.kid == kid }) {
            update(house)
        }
        changed?()
    }

    /// The card's gone: the camera's back where it was, if they've not moved
    /// it since, or as far down as the card had it up.
    func drop() {
        guard lifted else { return }
        lifted = false
        chosen = nil
        if let beforeLift, beforeLift.put == roam {
            roam = beforeLift.was
        } else {
            roam = roam(for: (eye.middle + Self.up * eye.scale * (Self.lowered - Self.raised), eye.scale))
        }
        beforeLift = nil
        look(animated: true)
        for house in houses where house.mine { update(house) }
        settle()
        changed?()
    }

    // MARK: Moving about the town

    /// Dragged by `by` points: the town goes with the finger.
    func drag(by: CGPoint, height: CGFloat) {
        roam.drag(by: by, scale: framed.scale, height: height)
        hold()
        wide = false
        look(animated: false)
        settle()
        changed?()
    }

    /// Pinched by `factor` about `at`, in points from the middle of the view.
    func pinch(by factor: CGFloat, about at: CGPoint, height: CGFloat) {
        roam.pinch(by: factor, about: at, scale: framed.scale, height: height)
        hold()
        wide = false
        look(animated: false)
        settle()
        changed?()
    }

    /// A shut house says whose it is. Looking at the basement, the ground
    /// is taken away and it stands in earth, on its own.
    private func tidy() {
        var under = placing?.room == "basement"
        switch focus {
        case .street: break
        case .house: under = under || floor == -1
        case .room(let kid, let id): under = under || floor == -1 || houses.first { $0.kid == kid }?.state.cell(of: id)[1] == -1
        }
        // Underground: no town, just earth round the basement.
        land.isHidden = under
        scene.background.contents = under ? UIColor(red: 0.45, green: 0.33, blue: 0.24, alpha: 1) : Self.sky
        for (kid, node) in nodes {
            node.childNode(withName: "label", recursively: false)?.isHidden = open(kid)
            node.childNode(withName: "yard", recursively: false)?.isHidden = under
            node.childNode(withName: "stairs", recursively: false)?.isHidden = under
            node.isHidden = under && !open(kid)
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
        // Of the markers under the finger, the one it's nearest the middle of.
        var spot: (hit: Hit, far: CGFloat)?
        for result in results {
            guard let name = result.node.name, name.hasPrefix("spot:") else { continue }
            let parts = name.split(separator: ":").map(String.init)
            guard parts.count == 4 else { continue }
            let on = view.projectPoint(result.node.worldPosition)
            let far = hypot(CGFloat(on.x) - point.x, CGFloat(on.y) - point.y)
            if spot == nil || far < spot!.far { spot = (.spot(parts[1], parts[2], parts[3]), far) }
        }
        if let spot { return spot.hit }
        // A room of the open house; of any other, the house.
        return found.first { if case .room(let kid, _) = $0 { return open(kid) }; return false }
            ?? found.first { if case .house = $0 { return true }; return false }
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
