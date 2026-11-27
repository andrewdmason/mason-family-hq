import SceneKit
import UIKit

// One house, built on its lot from its plan (HouseLayout.swift, HousePlan.swift):
// a floor at a time, each with what's underfoot, its doors, and its rooms
// with what's in their spots; the walls, which stand differently depending
// on where they're seen from; and, for when it's shut, its roof and what's
// on it. Everything's in the lot's own space: metres east and south of its
// north-west corner.

/// What a house shows the street: its roof and the shape of it, what its walls
/// are clad in, its front door, and what's on the roof and the lawn.
struct HouseOutside {
    var roof = "c0574a"
    var roofGlow = 0.0
    var shape = "gable"
    /// What the walls are clad in; nil, each room its own colour.
    var cladding: (pattern: String, a: String, b: String)?
    var door = (color: "b5483b", round: false)
    /// The fence round the land: its style and colour.
    var fence = (style: "picket", color: "f6f1e4")
    /// What's on the roof and on the lawn (a thing built in code), if anything.
    var top: String?
    var lawn: String?
    /// A porch at the front door, what's planted under the front windows, what's by the road and in the front garden.
    var porch: String?
    var beds: String?
    var kerb: String?
    var garden: String?
    /// How the windows are made ("plain", "grid", "shutters", "boxes"), and which door the rooms indoors have.
    var windows = "plain"
    var doors = "Door_1"

    init(_ state: HouseState) {
        let outside = HouseCatalog.outside
        for spot in outside.spots {
            guard let item = state.item(in: spot, of: outside.id) else { continue }
            switch item.look {
            case .roof(let hex, let glow): (roof, roofGlow) = (hex, glow)
            case .roofShape(let name): shape = name
            case .cladding(let pattern, let a, let b): cladding = pattern == "rooms" ? nil : (pattern, a, b)
            case .door(let hex, let round): door = (hex, round)
            case .made(let key):
                switch spot.id {
                case "top": top = key
                case "porch": porch = key
                case "beds": beds = key
                case "kerb": kerb = key
                case "garden": garden = key
                default: lawn = key
                }
            case .fence(let style, let hex): fence = (style, hex)
            case .style(let name): if spot.id == "doors" { doors = name } else { windows = name }
            default: break
            }
        }
    }
}

final class HouseBuilt {
    /// How a floor's walls stand: seen from where, and looking into which room.
    struct Standing: Hashable {
        var view: HouseVantage
        var focus: Character?
    }

    let shown: HouseShown
    let lot: HouseTown.Lot
    /// Everything standing in it and where, and the plan that makes.
    let all: [String: HousePlot]
    let plan: HousePlan
    let outside: HouseOutside
    let node = SCNNode()
    private let sky: HouseSky
    /// A floor's own things, which don't change with where it's seen from: what's underfoot and its doors; and, apart, what's in its rooms.
    private var storeys: [Int: SCNNode] = [:]
    private var insides: [Int: SCNNode] = [:]
    /// A floor's walls every way they've stood so far, and how they stand now.
    private var walls: [Int: [Standing: SCNNode]] = [:]
    private var standing: [Int: Standing] = [:]
    /// The lid over whatever of a floor has nothing built on it, for when the floor above is the one shown.
    private var lids: [Int: SCNNode] = [:]
    /// The roof and what's on it, and the name over it: for when it's shut.
    private let top = SCNNode()
    private let yard = SCNNode()
    /// What hangs on a wall: gone when its wall's down, or has a door in it.
    private var hung: [(node: SCNNode, floor: Int, edge: HousePlan.Edge)] = []
    /// Whoever lives there.
    private(set) var people: [MathCharacter] = []
    /// Something standing in a room or out in the yard: which spot's, what, where on the lot (its floor's height
    /// included) and which way its front faces (0: south).
    struct Thing {
        let room: String
        let spot: String
        let item: HouseItem
        let at: SIMD3<Float>
        let facing: Float
    }
    private(set) var things: [Thing] = []
    /// The floor in view when it's open; nil when it's shut.
    private(set) var showing: Int?

    /// The room whose spots have markers on them, and the spot the card's for.
    struct Marked: Equatable {
        var room: String
        var chosen: String?
    }

    init(_ shown: HouseShown, on lot: HouseTown.Lot, sky: HouseSky, marked: Marked? = nil) {
        self.shown = shown
        self.lot = lot
        self.sky = sky
        let state = shown.state, standing = state.layout
        all = standing
        outside = HouseOutside(state)
        plan = HouseLayout.plan(standing) { room in
            var look = HousePlan.Room(id: room)
            guard let found = HouseCatalog.room(room) else { return look }
            for spot in found.spots {
                switch state.item(in: spot, of: room)?.look {
                case .paint(let a, let b): (look.paint, look.skirting) = (a, b)
                case .paper(let pattern, let a, let b, let skirting): (look.paint, look.skirting, look.paper) = (a, skirting, [pattern, a, b])
                case .flooring(let pattern, let a, let b): look.flooring = [pattern, a, b]
                default: break
                }
            }
            return look
        }
        node.name = "house:\(shown.kid)"
        node.simdPosition = SIMD3(lot.x, 0, lot.z)
        for f in plan.numbers {
            guard let floor = plan.floor(f) else { continue }
            let (storey, inside) = build(floor, at: f, marked: marked)
            for part in [storey, inside] {
                part.simdPosition.y = Float(f) * HousePlan.storey
                node.addChildNode(part)
            }
            storeys[f] = storey
            insides[f] = inside
            let lid = lid(over: f)
            lid.simdPosition.y = Float(f) * HousePlan.storey
            lid.isHidden = true
            node.addChildNode(lid)
            lids[f] = lid
        }
        roof()
        node.addChildNode(top)
        grounds()
        for (room, p) in all where HouseLayout.yard(room) { yard.addChildNode(self.room(room, p, marked: marked?.room == room ? marked : nil)) }
        node.addChildNode(yard)
        for look in [shown.look] + (shown.partner.map { [$0] } ?? []) {
            let who = MathCharacter(look: look, height: 1.45)
            who.play("idle")
            HouseLook.physical(who.node)
            node.addChildNode(who.node)
            people.append(who)
        }
    }

    // MARK: Where things are

    /// The middle of the house on the ground, and how far it reaches from there, in the town.
    var middle: SIMD3<Float> {
        let (lo, hi) = reach
        return SIMD3(lot.x + (lo.x + hi.x) / 2, 0, lot.z + (lo.y + hi.y) / 2)
    }

    var radius: Float { simd_length(reach.hi - reach.lo) / 2 }

    private var reach: (lo: SIMD2<Float>, hi: SIMD2<Float>) {
        var lo = SIMD2<Float>(repeating: .greatestFiniteMagnitude), hi = -lo
        for (room, p) in all where p.floor >= 0 {
            let (w, d) = HouseLayout.size(room, p)
            lo = simd_min(lo, SIMD2(Float(p.x), Float(p.z)))
            hi = simd_max(hi, SIMD2(Float(p.x + w), Float(p.z + d)))
        }
        return (lo, hi)
    }

    /// The middle of a room, in the town.
    func middle(of room: String) -> SIMD3<Float>? {
        guard let p = all[room] else { return nil }
        let (w, d) = HouseLayout.size(room, p)
        return SIMD3(lot.x + Float(p.x) + Float(w) / 2, Float(p.floor) * HousePlan.storey, lot.z + Float(p.z) + Float(d) / 2)
    }

    /// Which room is under a point of the town, on a floor.
    func room(under point: SIMD2<Float>, floor: Int) -> String? {
        let cell = HouseCell(x: Int((point.x - lot.x).rounded(.down)), z: Int((point.y - lot.z).rounded(.down)))
        return HouseLayout.room(at: cell, floor: floor, in: all)
    }

    /// The floors it has, lowest first.
    var floors: [Int] { plan.numbers }

    /// A point of a room as it's drawn (metres from its north-west corner), on the lot.
    func point(_ room: String, _ x: Float, _ z: Float) -> SIMD2<Float> {
        guard let p = all[room] else { return .zero }
        let s = HouseLayout.shape(room)
        var (px, pz, d) = (x, z, Float(s.depth))
        var w = Float(s.width)
        for _ in 0..<(p.turn & 3) {
            (px, pz) = (d - pz, px)
            (w, d) = (d, w)
        }
        return SIMD2(Float(p.x) + px, Float(p.z) + pz)
    }

    /// The front door's metre of wall, the middle of it on the lot, and which way is out.
    private var frontDoor: (edge: HousePlan.Edge, at: SIMD2<Float>, out: SIMD2<Float>)? {
        guard let p = all[HouseLayout.hall], let front = HouseLayout.shape(HouseLayout.hall).frontDoor else { return nil }
        let e = HouseLayout.edge(HouseLayout.hall, p, front)
        let ways: [HouseSide: SIMD2<Float>] = [.north: SIMD2(0, -1), .east: SIMD2(1, 0), .south: SIMD2(0, 1), .west: SIMD2(-1, 0)]
        return (e, SIMD2(Float(e.x) + (e.across ? 0.5 : 0), Float(e.z) + (e.across ? 0 : 0.5)), ways[front.side.turned(p.turn)]!)
    }

    // MARK: A floor

    private func paint(_ room: Character?, outdoors: Bool = false) -> SCNMaterial {
        // (Paper's for indoors: outside, a papered room shows the paper's own colour.)
        if !outdoors, let p = room.flatMap({ plan.rooms[$0]?.paper }), p.count == 3 { return HouseLook.paper(p[0], p[1], p[2]) }
        return HouseLook.paint(room.flatMap { plan.rooms[$0]?.paint } ?? "e7e3d8")
    }

    /// What the house is clad in outside, on a wall of this room: the cladding chosen, or the room's own colour.
    private func cladding(of room: Character?) -> SCNMaterial {
        guard let c = outside.cladding else { return paint(room, outdoors: true) }
        return HouseLook.clad(c.pattern, c.a, c.b)
    }

    /// What of a floor is always there (what's underfoot, the doors), and what's in its rooms.
    private func build(_ floor: HousePlan.Floor, at f: Int, marked: Marked?) -> (SCNNode, SCNNode) {
        let storey = SCNNode(), inside = SCNNode()
        let batch = HouseBatch()
        let half = HousePlan.thickness / 2
        for z in 0..<floor.depth {
            for x in 0..<floor.width {
                guard let room = floor.room(x, z) else { continue }
                let (x0, z0, x1, z1) = (Float(x), Float(z), Float(x + 1), Float(z + 1))
                guard floor.floored(x, z) else {
                    // Where the stairs go down through the hall: dark, not the lawn.
                    if f == 0 { batch.box(SIMD3(x0, -0.3, z0), SIMD3(x1, -0.012, z1), HouseLook.plain(HouseLook.color("2a2622"), rough: 0.9)) }
                    continue
                }
                let look = plan.rooms[room]?.flooring ?? ["boards", "c98f55", "a8733f"]
                batch.mesh(HouseLook.floor(look[0], look[1], look[2])).quad(SIMD3(x0, 0, z0), SIMD3(x0, 0, z1), SIMD3(x1, 0, z1), SIMD3(x1, 0, z0))
                // What it lies on: the ground's footing, or the ceiling of the floor below.
                let under = f <= 0 ? HouseLook.concrete : HouseLook.ceiling
                batch.box(SIMD3(x0 - half, f <= 0 ? -0.25 : -HousePlan.slab, z0 - half), SIMD3(x1 + half, -0.004, z1 + half), under)
            }
        }
        storey.addChildNode(batch.node())

        // Doors, each in its frame, whether the wall round it is up or down.
        let frame = HouseBatch()
        let trim = HouseLook.trim
        for (edge, opening) in floor.openings {
            guard case .door(let front) = opening else { continue }
            let (x, z) = (Float(edge.x), Float(edge.z))
            let jamb: Float = 0.08, out = half + 0.012, head = HousePlan.head
            let leaf: SCNNode
            if front {
                // The front door's theirs to choose, and faces out.
                leaf = HouseProps.door(outside.door.color, round: outside.door.round)
                HouseLook.physical(leaf)
                leaf.simdScale = SIMD3(repeating: 0.9)
                let way = frontDoor?.out ?? SIMD2(0, 1)
                leaf.simdEulerAngles.y = atan2(way.x, way.y)
                leaf.simdPosition = SIMD3(x + (edge.across ? 0.5 : 0) + way.x * half, 0, z + (edge.across ? 0 : 0.5) + way.y * half)
            } else {
                leaf = HouseKit.fitting(outside.doors)
                leaf.simdPosition = edge.across ? SIMD3(x + 0.5, 0, z) : SIMD3(x, 0, z + 0.5)
                if !edge.across { leaf.simdEulerAngles.y = .pi / 2 }
                if edge.across {
                    frame.box(SIMD3(x, 0, z - out), SIMD3(x + jamb, head, z + out), trim)
                    frame.box(SIMD3(x + 1 - jamb, 0, z - out), SIMD3(x + 1, head, z + out), trim)
                    frame.box(SIMD3(x, head - 0.07, z - out), SIMD3(x + 1, head, z + out), trim)
                } else {
                    frame.box(SIMD3(x - out, 0, z), SIMD3(x + out, head, z + jamb), trim)
                    frame.box(SIMD3(x - out, 0, z + 1 - jamb), SIMD3(x + out, head, z + 1), trim)
                    frame.box(SIMD3(x - out, head - 0.07, z), SIMD3(x + out, head, z + 1), trim)
                }
            }
            storey.addChildNode(leaf)
        }
        storey.addChildNode(frame.node())

        // (What's out in the yard is the yard's: it's there whether the house is open or shut.)
        for (room, p) in all where p.floor == f && !HouseLayout.yard(room) { inside.addChildNode(self.room(room, p, marked: marked?.room == room ? marked : nil)) }

        // The stairs: up from the hall once there's a landing, and down under them to a basement.
        if let hall = all[HouseLayout.hall] {
            let below = all[HouseLayout.basement] != nil
            if f == 0, all[HouseLayout.landing] != nil { storey.addChildNode(turned(HouseLayout.hall, hall, holding: flight(solid: !below))) }
            if f == 1 { storey.addChildNode(turned(HouseLayout.hall, hall, holding: rail())) }
            if f == -1 {
                let down = turned(HouseLayout.hall, hall, holding: flightDown())
                down.simdPosition.y = HousePlan.storey
                storey.addChildNode(down)
            }
        }
        return (storey, inside)
    }

    /// Something set out in a room as it's drawn, put where the room is and turned the way it's turned.
    private func turned(_ room: String, _ p: HousePlot, holding child: SCNNode) -> SCNNode {
        let s = HouseLayout.shape(room)
        let (w, d) = HouseLayout.size(room, p)
        let turned = SCNNode()
        turned.simdPosition = SIMD3(Float(p.x) + Float(w) / 2, 0, Float(p.z) + Float(d) / 2)
        turned.simdEulerAngles.y = -Float(p.turn) * .pi / 2
        child.simdPosition += SIMD3(-Float(s.width) / 2, 0, -Float(s.depth) / 2)
        turned.addChildNode(child)
        return turned
    }

    /// A room's colours for what's in it: its wood and its cloth, and whether the lamps are on.
    private func finish(_ room: HouseRoom) -> HouseFinish {
        var finish = HouseFinish(lit: sky.lit, feats: shown.state.feats)
        for spot in room.spots {
            switch shown.state.item(in: spot, of: room.id)?.look {
            case .wood(let main, let dark, let glow): (finish.wood, finish.woodDark, finish.woodGlow) = (main, dark, glow)
            case .fabric(let hex, let glow): (finish.fabric, finish.fabricGlow) = (hex, glow)
            default: break
            }
        }
        return finish
    }

    /// What's in a room's spots, put where the room is.
    private func room(_ id: String, _ p: HousePlot, marked: Marked?) -> SCNNode {
        let holder = SCNNode()
        holder.name = "room:\(shown.kid):\(id)"
        guard let room = HouseCatalog.room(id) else { return turned(id, p, holding: holder) }
        let shape = HouseLayout.shape(id)
        let (sx, sz) = shape.stretch
        let H = shape.outdoor ? HousePlan.fence : HousePlan.height
        // Clear of the wall's own thickness.
        let wall = HousePlan.thickness / 2 + 0.012
        let finish = finish(room)
        var stood: [String: (at: SIMD3<Float>, top: Float)] = [:]
        for spot in room.spots {
            // The room's wood and its cloth aren't anywhere in it: they're on everything.
            if spot.place == .wood || spot.place == .fabric { continue }
            let item = shown.state.item(in: spot, of: id)
            // (On a deck, everything but the deck stands on its boards.)
            let lift = spot.id == id ? 0 : shape.lift
            var at = SIMD3<Float>(0, 0, 0), ry: Float = 0, bubble = SIMD3<Float>(0, 0.75, 0)
            var onWall: HouseWall?
            switch spot.place {
            case .floor(let x, let z, let turns): (at, ry, bubble) = (SIMD3(x * sx, lift, z * sz), Float(turns) * .pi / 2, SIMD3(x * sx, 1.5, z * sz))
            case .rug(let x, let z): (at, bubble) = (SIMD3(x * sx, 0.004, z * sz), SIMD3(x * sx + 0.7, 0.35, z * sz + 0.7))
            case .wall(let left, let along, let y):
                let h = min(y, H - 0.5)
                if left {
                    (at, ry, bubble) = (SIMD3(wall, h, along * sz), .pi / 2, SIMD3(0.35, h, along * sz))
                    onWall = HouseWall(side: .west, at: min(shape.depth - 1, Int(along * sz)))
                } else {
                    (at, bubble) = (SIMD3(along * sx, h, wall), SIMD3(along * sx, h, 0.35))
                    onWall = HouseWall(side: .north, at: min(shape.width - 1, Int(along * sx)))
                }
            case .ceiling(let x, let z): (at, bubble) = (SIMD3(x * sx, H - 0.02, z * sz), SIMD3(x * sx, H - 0.9, z * sz))
            case .pet(let x, let z): (at, ry, bubble) = (SIMD3(x * sx, 0, z * sz), .pi / 4, SIMD3(x * sx, 0.9, z * sz))
            case .against(let left, let along):
                // Its back to the wall, however deep it is.
                let out = (item.map(HouseThings.depth) ?? 0.6) / 2 + 0.04 + wall
                if left { (at, ry, bubble) = (SIMD3(out, 0, along * sz), .pi / 2, SIMD3(out, 1.5, along * sz)) }
                else { (at, bubble) = (SIMD3(along * sx, 0, out), SIMD3(along * sx, 1.5, out)) }
            case .on(let base):
                // Nothing there to stand on: it isn't shown, and can't be chosen for until there is.
                guard let under = stood[base] else { continue }
                (at, bubble) = (SIMD3(under.at.x, under.top, under.at.z), SIMD3(under.at.x, under.top + 0.75, under.at.z))
            case .walls: bubble = SIMD3(0.35, H - 0.45, Float(shape.depth) - 1.5)
            case .flooring: bubble = SIMD3(0.9, 0.3, Float(shape.depth) - 0.7)
            case .wood, .fabric, .outside: break
            }
            if let item, let thing = HouseThings.make(item, finish, sky: sky) {
                stood[spot.id] = (at, HouseThings.height(item))
                thing.name = "thing:\(HouseCatalog.key(id, spot.id))"
                thing.simdPosition = at
                thing.simdEulerAngles.y = ry
                holder.addChildNode(thing)
                switch spot.place {
                case .floor, .against:
                    let on = point(id, at.x, at.z)
                    things.append(Thing(room: id, spot: spot.id, item: item, at: SIMD3(on.x, Float(p.floor) * HousePlan.storey + at.y, on.y), facing: ry - Float(p.turn) * .pi / 2))
                default: break
                }
                if let onWall, !shape.outdoor { hung.append((thing, p.floor, HouseLayout.edge(id, p, onWall))) }
                if case .ceiling = spot.place, !shape.outdoor {
                    // A round of the ceiling it hangs from, so it isn't hanging from nothing.
                    let rose = SCNNode(geometry: SCNCylinder(radius: 0.5, height: 0.03))
                    rose.geometry?.materials = [HouseLook.ceiling]
                    rose.simdPosition = at + SIMD3(0, 0.035, 0)
                    rose.castsShadow = false
                    holder.addChildNode(rose)
                }
            }
            // A marker on each spot, while the card for changing them is up.
            if let marked {
                let key = HouseCatalog.key(id, spot.id)
                let state: HouseProps.Marker = key == marked.chosen ? .chosen : shown.state.untouched(spot, of: id) ? .empty : .filled
                let mark = HouseProps.marker(spot.symbol, state)
                mark.name = "spot:\(shown.kid):\(id):\(spot.id)"
                mark.simdPosition = bubble
                mark.constraints = [SCNBillboardConstraint()]
                mark.renderingOrder = 100
                holder.addChildNode(mark)
            }
        }
        return turned(id, p, holding: holder)
    }

    /// The way up the stairs: the foot of the flight in the hall and the head of it on the landing, on the lot.
    var flightPath: (foot: SIMD3<Float>, head: SIMD3<Float>)? {
        guard all[HouseLayout.hall] != nil else { return nil }
        let middle = (stairs.west + stairs.east) / 2
        let foot = point(HouseLayout.hall, middle, stairs.foot + 0.3), head = point(HouseLayout.hall, middle, stairs.head - 0.2)
        return (SIMD3(foot.x, 0, foot.y), SIMD3(head.x, HousePlan.storey, head.y))
    }

    /// Just inside the front door and just outside it, on the lot.
    var step: (inside: SIMD3<Float>, outside: SIMD3<Float>)? {
        guard let door = frontDoor else { return nil }
        let a = door.at - door.out * 0.6, b = door.at + door.out * 1.3
        return (SIMD3(a.x, 0, a.y), SIMD3(b.x, 0, b.y))
    }

    /// Where whoever lives there stands in a room, on the lot; or, with no room, on the front step.
    func stand(in room: String?) -> SIMD3<Float> {
        if let room, let found = HouseCatalog.room(room), let p = all[room], found.stand.count == 2 {
            let (sx, sz) = HouseLayout.shape(room).stretch
            let at = point(room, found.stand[0] * sx, found.stand[1] * sz)
            return SIMD3(at.x, Float(p.floor) * HousePlan.storey, at.y)
        }
        guard let door = frontDoor else { return .zero }
        let at = door.at + door.out * 1.1
        return SIMD3(at.x, -0.1, at.y)
    }

    // MARK: Stairs

    /// The flight in the hall as it's drawn: along its west wall, from a metre short of the front up to a metre short of the back.
    private let stairs = (west: Float(0.08), east: Float(1), foot: Float(4), head: Float(1), steps: 14)

    /// The flight up: a wooden tread on every step and a rail on its open side; solid under, unless more stairs go down beneath it.
    private func flight(solid: Bool) -> SCNNode {
        let s = stairs
        let batch = HouseBatch()
        let rise = HousePlan.storey / Float(s.steps), going = (s.foot - s.head) / Float(s.steps)
        let white = HouseLook.plain(HouseLook.color("f0f0eb"), rough: 0.5)
        for i in 0..<s.steps {
            let z1 = s.foot - Float(i) * going, z0 = z1 - going, top = Float(i + 1) * rise
            batch.box(SIMD3(s.west, solid ? 0 : top - 0.2, z0), SIMD3(s.east, top - 0.03, z1), white)
            batch.box(SIMD3(s.west, top - 0.03, z0), SIMD3(s.east + 0.02, top, z1 + 0.02), HouseLook.oak)
            if i % 2 == 0 {
                batch.box(SIMD3(s.east - 0.05, top, z0 + going / 2 - 0.02), SIMD3(s.east - 0.01, top + 0.9, z0 + going / 2 + 0.02), white)
            }
        }
        let node = batch.node()
        // The handrail, up the slope.
        let length = sqrt(pow(s.foot - s.head, 2) + pow(HousePlan.storey, 2))
        let rail = SCNNode(geometry: SCNBox(width: 0.06, height: 0.05, length: CGFloat(length), chamferRadius: 0.01))
        rail.geometry?.materials = [HouseLook.oak]
        rail.simdPosition = SIMD3(s.east - 0.03, HousePlan.storey / 2 + 0.95, (s.foot + s.head) / 2)
        rail.simdEulerAngles.x = atan2(HousePlan.storey, s.foot - s.head)
        node.addChildNode(rail)
        return node
    }

    /// The flight down to the basement, under the one up: from the back of the hall down to under its front.
    private func flightDown() -> SCNNode {
        let s = stairs
        let batch = HouseBatch()
        let rise = HousePlan.storey / Float(s.steps), going = (s.foot - s.head) / Float(s.steps)
        for i in 0..<s.steps {
            let z0 = s.head + Float(i) * going, top = -Float(i + 1) * rise
            batch.box(SIMD3(s.west, top - 0.05, z0), SIMD3(s.east, top, z0 + going + 0.02), HouseLook.walnut)
        }
        batch.box(SIMD3(s.east - 0.04, -HousePlan.storey, s.head), SIMD3(s.east, -HousePlan.storey + 0.06, s.foot), HouseLook.walnut)
        return batch.node()
    }

    /// The rail round where the flight comes up through the floor, on the landing.
    private func rail() -> SCNNode {
        let s = stairs
        let batch = HouseBatch()
        let white = HouseLook.plain(HouseLook.color("f0f0eb"), rough: 0.5)
        var z = s.head
        while z < s.foot - 0.1 {
            batch.box(SIMD3(s.east + 0.02, 0, z), SIMD3(s.east + 0.06, 0.92, z + 0.04), white)
            z += 0.25
        }
        batch.box(SIMD3(s.east + 0.01, 0.92, s.head), SIMD3(s.east + 0.07, 0.97, s.foot), HouseLook.oak)
        // And across its foot end, so nobody walks off the landing onto the bottom of the stairs.
        var x = s.west
        while x < s.east {
            batch.box(SIMD3(x, 0, s.foot - 0.02), SIMD3(x + 0.04, 0.92, s.foot + 0.02), white)
            x += 0.25
        }
        batch.box(SIMD3(s.west, 0.92, s.foot - 0.03), SIMD3(s.east + 0.07, 0.97, s.foot + 0.03), HouseLook.oak)
        return batch.node()
    }

    // MARK: Walls

    /// A floor's walls as they stand seen from there: whole, or cut to a stub where a room's behind them.
    private func wallsNode(_ f: Int, _ how: Standing) -> SCNNode {
        guard let floor = plan.floor(f) else { return SCNNode() }
        let batch = HouseBatch()
        let (t, H, stub, head) = (HousePlan.thickness, HousePlan.height, HousePlan.stub, HousePlan.head)
        let half = t / 2
        let glass = sky.lit && how.view == .shut ? HouseLook.litGlass : HouseLook.glass
        let earth = HouseLook.plain(HouseLook.color("5b4a3a"), rough: 0.95)
        /// What a side of a wall is finished in: a room's paint indoors; outdoors the house's cladding (earth, underground); a fence, the garden's own colour.
        func finish(_ side: Character?, across other: Character?, fence: Bool) -> SCNMaterial {
            if fence { return HouseLook.plain(HouseLook.color(plan.rooms[side ?? other ?? "G"]?.paint ?? "c9a36b"), rough: 0.8) }
            if floor.indoor(side) { return paint(side) }
            return f < 0 ? earth : cladding(of: other)
        }
        /// What stands at each corner of the map: how high, and whether from the ground.
        var posts: [SIMD2<Int32>: (height: Float, grounded: Bool)] = [:]

        for e in floor.walls {
            let (a, b) = floor.sides(e)
            let fence = floor.fence(e)
            let low = floor.lowered(e, from: how.view, focus: how.focus)
            let h = fence ? HousePlan.fence : low ? stub : H
            let opening = fence ? nil : floor.openings[e]
            let spans: [(Float, Float)]
            switch opening {
            case nil: spans = [(0, h)]
            case .door, .arch:
                if low { spans = [] } else { spans = [(head, h)] }
            case .window(let sill, let top):
                if low { spans = [(0, stub)] } else { spans = [(0, sill), (top, h)] }
            }
            let (x, z) = (Float(e.x), Float(e.z))
            /// A piece of this wall between two heights and two distances from its line (negative: north or west of it).
            func slab(_ y0: Float, _ y1: Float, _ d0: Float, _ d1: Float, _ m: SCNMaterial, along: (Float, Float) = (0, 1)) {
                if e.across { batch.box(SIMD3(x + along.0, y0, z + d0), SIMD3(x + along.1, y1, z + d1), m) }
                else { batch.box(SIMD3(x + d0, y0, z + along.0), SIMD3(x + d1, y1, z + along.1), m) }
            }
            for (y0, y1) in spans {
                slab(y0, y1, -half, 0, finish(a, across: b, fence: fence))
                slab(y0, y1, 0, half, finish(b, across: a, fence: fence))
            }
            if let top = spans.last?.1, !fence { slab(top, top + 0.015, -half, half, HouseLook.cap) }
            if case .window(let sill, _) = opening, !low {
                slab(sill - 0.03, sill, -half - 0.04, half + 0.04, HouseLook.trim)
            }
            // Skirting, indoors, wherever there's wall down to the floor: each room's own.
            if spans.first?.0 == 0, !fence {
                if floor.indoor(a), let c = a.flatMap({ plan.rooms[$0]?.skirting }) { slab(0, 0.09, -half - 0.012, -half, HouseLook.plain(HouseLook.color(c), rough: 0.5)) }
                if floor.indoor(b), let c = b.flatMap({ plan.rooms[$0]?.skirting }) { slab(0, 0.09, half, half + 0.012, HouseLook.plain(HouseLook.color(c), rough: 0.5)) }
            }
            if case .window(let sill, let top) = opening, !low {
                let w: Float = 0.05
                slab(sill, sill + w, -0.05, 0.05, HouseLook.trim)
                slab(top - w, top, -0.05, 0.05, HouseLook.trim)
                slab(sill, top, -0.05, 0.05, HouseLook.trim, along: (0, w))
                slab(sill, top, -0.05, 0.05, HouseLook.trim, along: (1 - w, 1))
                let mid = (sill + top) / 2
                slab(mid - 0.015, mid + 0.015, -0.02, 0.02, HouseLook.trim, along: (w, 1 - w))
                slab(sill + w, top - w, -0.005, 0.005, glass, along: (w, 1 - w))
                // How they've chosen to have their windows. (Outdoors is whichever side of the wall has no room on it.)
                let out: Float = floor.indoor(a) ? 1 : -1
                func outdoors(_ y0: Float, _ y1: Float, _ from: Float, _ to: Float, _ m: SCNMaterial, along: (Float, Float)) {
                    slab(y0, y1, min(out * from, out * to), max(out * from, out * to), m, along: along)
                }
                switch outside.windows {
                case "grid":
                    let thirds: [Float] = [1.0 / 3, 2.0 / 3]
                    for k in thirds {
                        slab(sill + w, top - w, -0.02, 0.02, HouseLook.trim, along: (k - 0.012, k + 0.012))
                        let y = sill + (top - sill) * k
                        if abs(y - mid) > 0.05 { slab(y - 0.012, y + 0.012, -0.02, 0.02, HouseLook.trim, along: (w, 1 - w)) }
                    }
                case "shutters":
                    let paint = HouseLook.plain(HouseLook.color(outside.door.color), rough: 0.6)
                    outdoors(sill - 0.02, top + 0.02, half, half + 0.04, paint, along: (-0.3, -0.02))
                    outdoors(sill - 0.02, top + 0.02, half, half + 0.04, paint, along: (1.02, 1.3))
                case "boxes":
                    outdoors(sill - 0.24, sill - 0.04, half, half + 0.22, HouseLook.plain(HouseLook.color("b5654a"), rough: 0.8), along: (0.04, 0.96))
                    outdoors(sill - 0.06, sill + 0.03, half + 0.02, half + 0.2, HouseLook.plain(HouseLook.color("4f8a3c"), rough: 0.8), along: (0.07, 0.93))
                    for (i, hex) in ["e8413c", "f7d04a", "f08ab0", "e8413c", "ffffff"].enumerated() {
                        let k = 0.14 + Float(i) * 0.18
                        outdoors(sill + 0.02, sill + 0.11, half + 0.06, half + 0.16, HouseLook.plain(HouseLook.color(hex), rough: 0.7), along: (k - 0.05, k + 0.05))
                    }
                default: break
                }
            }
            // Both ends of it are corners.
            let grounded: Bool = { if case .door = opening { return false }; if case .arch = opening { return false }; return true }()
            let ends: [SIMD2<Int32>] = [SIMD2<Int32>(Int32(e.x), Int32(e.z)), SIMD2<Int32>(Int32(e.x + (e.across ? 1 : 0)), Int32(e.z + (e.across ? 0 : 1)))]
            for end in ends {
                let was = posts[end] ?? (0, false)
                // An opening's own corner posts only start above its head, and not at all when its wall's down.
                let reach = grounded ? h : (low ? 0 : h)
                posts[end] = (max(was.height, reach), was.grounded || grounded)
            }
        }

        // A post at every corner, each quarter of it finished as the room it's in.
        for (at, post) in posts where post.height > 0 {
            let y0: Float = post.grounded ? 0 : head
            guard y0 < post.height else { continue }
            let (x, z) = (Float(at.x), Float(at.y))
            var indoors: Character?
            for dx in [-1, 0] { for dz in [-1, 0] { if let r = floor.room(Int(at.x) + dx, Int(at.y) + dz), floor.indoor(r) { indoors = r } } }
            for dx in [-1, 0] {
                for dz in [-1, 0] {
                    let room = floor.room(Int(at.x) + dx, Int(at.y) + dz)
                    // (A fence post: only where no wall of the house comes to this corner.)
                    let m = finish(room, across: indoors, fence: indoors == nil)
                    batch.box(SIMD3(x + (dx < 0 ? -half : 0), y0, z + (dz < 0 ? -half : 0)),
                              SIMD3(x + (dx < 0 ? 0 : half), post.height, z + (dz < 0 ? 0 : half)), m)
                }
            }
            if indoors != nil { batch.box(SIMD3(x - half, post.height, z - half), SIMD3(x + half, post.height + 0.015, z + half), HouseLook.cap) }
        }
        return batch.node()
    }

    /// A flat lid over the rooms of a floor that have nothing on top of them, in the colour of the roof.
    private func lid(over f: Int) -> SCNNode {
        let batch = HouseBatch()
        guard f >= 0, let floor = plan.floor(f) else { return batch.node() }
        let above = plan.floor(f + 1)
        let half = HousePlan.thickness / 2
        let m = HouseLook.plain(HouseLook.color(outside.roof).shaded(0.85), rough: 0.9)
        for z in 0..<floor.depth {
            for x in 0..<floor.width where floor.indoor(floor.room(x, z)) && (above?.letter(x, z) ?? ".") == "." && !open(x, z, f) {
                batch.box(SIMD3(Float(x) - half, HousePlan.height, Float(z) - half), SIMD3(Float(x + 1) + half, HousePlan.storey, Float(z + 1) + half), m)
            }
        }
        return batch.node()
    }

    /// Whether a square of a floor is a room with no roof: the observatory's, open to the sky.
    private func open(_ x: Int, _ z: Int, _ f: Int) -> Bool {
        guard let room = HouseLayout.room(at: HouseCell(x: x, z: z), floor: f, in: all) else { return false }
        return HouseLayout.shape(room).roofless
    }

    // MARK: The roof

    /// The roof, for when the house is shut: over each part of it at the
    /// height that part stands to, in the shape and colour chosen. Each
    /// slope rises from the eaves by how far in from them it is.
    private func roof() {
        // (In December there's snow on it.)
        let snowy = HouseSeason.now == .winter
        let material = HouseLook.plain(snowy ? HouseBuilt.mix(HouseLook.color(outside.roof), .white, 0.8) : HouseLook.color(outside.roof), rough: 0.8)
        if outside.roofGlow > 0, !snowy {
            material.emission.contents = HouseLook.color(outside.roof)
            material.emission.intensity = CGFloat(outside.roofGlow) * 2
        }
        let slope: Float = outside.shape == "steep" ? 1.0 : outside.shape == "pyramid" ? 0.75 : outside.shape == "flat" ? 0 : 0.6
        var peak: (at: SIMD3<Float>, rise: Float) = (.zero, -1)
        for f in plan.numbers where f >= 0 {
            guard let floor = plan.floor(f) else { continue }
            let above = plan.floor(f + 1)
            // The squares this roof covers: rooms with a roof, and nothing built over them.
            func under(_ x: Int, _ z: Int) -> Bool {
                floor.indoor(floor.room(x, z)) && (above?.letter(x, z) ?? ".") == "." && !open(x, z, f)
            }
            let (W, D) = (floor.width, floor.depth)
            guard (0..<D).contains(where: { z in (0..<W).contains { under($0, z) } }) else { continue }
            // Which way the ridge runs, for a gable: along the longer way of what's covered.
            var lo = SIMD2<Int>(W, D), hi = SIMD2<Int>(0, 0)
            for z in 0..<D { for x in 0..<W where under(x, z) { lo = SIMD2(min(lo.x, x), min(lo.y, z)); hi = SIMD2(max(hi.x, x + 1), max(hi.y, z + 1)) } }
            let ridgeAcross = hi.x - lo.x >= hi.y - lo.y
            let gable = outside.shape == "gable"
            /// Whether a corner of the map has roof on both sides of it: all round, or for a gable just across the ridge (so its ends stand straight up).
            func inside(_ i: Int, _ j: Int) -> Bool {
                let (nw, ne, sw, se) = (under(i - 1, j - 1), under(i, j - 1), under(i - 1, j), under(i, j))
                if !gable { return nw && ne && sw && se }
                return ridgeAcross ? (nw || ne) && (sw || se) : (nw || sw) && (ne || se)
            }
            /// How far in from the eaves a corner of the map is, in squares: for a gable only the way across the ridge counts.
            func inset(_ i: Int, _ j: Int) -> Float {
                guard inside(i, j) else { return 0 }
                func run(_ di: Int, _ dj: Int) -> Int {
                    var n = 1
                    while n < 14, inside(i + di * n, j + dj * n) { n += 1 }
                    return n
                }
                let acrossWays = min(run(-1, 0), run(1, 0)), backWays = min(run(0, -1), run(0, 1))
                if gable { return Float(ridgeAcross ? backWays : acrossWays) }
                return Float(min(acrossWays, backWays))
            }
            let base = Float(f + 1) * HousePlan.storey
            let mesh = HouseMesh(), ends = HouseMesh()
            let half = HousePlan.thickness / 2
            for z in 0..<D {
                for x in 0..<W where under(x, z) {
                    let h = [inset(x, z), inset(x + 1, z), inset(x + 1, z + 1), inset(x, z + 1)].map { $0 * slope }
                    // Out over the walls at the eaves.
                    func corner(_ i: Int, _ j: Int, _ y: Float) -> SIMD3<Float> {
                        let out = y == 0 ? half + 0.18 : 0
                        let dx: Float = !under(i - 1, j - 1) && !under(i - 1, j) ? -out : !under(i, j - 1) && !under(i, j) ? out : 0
                        let dz: Float = !under(i - 1, j - 1) && !under(i, j - 1) ? -out : !under(i - 1, j) && !under(i, j) ? out : 0
                        return SIMD3(Float(i) + dx, base + y, Float(j) + dz)
                    }
                    let p = [corner(x, z, h[0]), corner(x + 1, z, h[1]), corner(x + 1, z + 1, h[2]), corner(x, z + 1, h[3])]
                    // Split along whichever way keeps the slope flat.
                    if abs(h[0] - h[2]) <= abs(h[1] - h[3]) { mesh.tri(p[0], p[3], p[2]); mesh.tri(p[0], p[2], p[1]) }
                    else { mesh.tri(p[0], p[3], p[1]); mesh.tri(p[1], p[3], p[2]) }
                    for (k, y) in h.enumerated() where y > peak.rise {
                        peak = (SIMD3(Float([x, x + 1, x + 1, x][k]), base, Float([z, z, z + 1, z + 1][k])), y)
                    }
                    // A gable's end: the wall carried up to the slope, where an edge of the roof isn't at the eaves.
                    let sides: [(Int, Int, Bool)] = [(0, 1, under(x, z - 1)), (1, 2, under(x + 1, z)), (2, 3, under(x, z + 1)), (3, 0, under(x - 1, z))]
                    for (a, b, covered) in sides where !covered && (h[a] > 0 || h[b] > 0) {
                        let (pa, pb) = (p[a], p[b])
                        let (fa, fb) = (SIMD3(pa.x, base, pa.z), SIMD3(pb.x, base, pb.z))
                        if h[a] > 0 && h[b] > 0 { ends.tri(fa, pa, pb); ends.tri(fa, pb, fb) }
                        else if h[a] > 0 { ends.tri(fa, pa, fb) } else { ends.tri(fa, pb, fb) }
                    }
                }
            }
            if !mesh.isEmpty { top.addChildNode(SCNNode(geometry: mesh.geometry(two(material)))) }
            if !ends.isEmpty { top.addChildNode(SCNNode(geometry: ends.geometry(two(cladding(of: nil))))) }
            // The lid under it, so there's no seeing in under the eaves.
            let under0 = lid(over: f)
            under0.simdPosition.y = Float(f) * HousePlan.storey
            top.addChildNode(under0)
        }
        // The observatory's dome, where it's open to the sky.
        for (room, p) in all where room == "observatory" {
            let (w, d) = HouseLayout.size(room, p)
            let dome = SCNSphere(radius: CGFloat(min(w, d)) / 2 - 0.2)
            dome.materials = [HouseLook.plain(HouseLook.color("c9ced6"), rough: 0.35, metal: 1)]
            let n = SCNNode(geometry: dome)
            n.simdPosition = SIMD3(Float(p.x) + Float(w) / 2, Float(p.floor + 1) * HousePlan.storey - HousePlan.slab, Float(p.z) + Float(d) / 2)
            top.addChildNode(n)
        }
        // What they've put on the roof, at the top of it.
        if let key = outside.top, peak.rise >= 0 {
            let thing = HouseProps.rooftop(key, rise: peak.rise)
            thing.name = "thing:outside.top"
            HouseLook.physical(thing)
            thing.simdPosition = peak.at
            top.addChildNode(thing)
        }
        // Whose it is, over the top of it.
        let sign = HouseProps.sign([shown.name])
        HouseLook.physical(sign)
        sign.name = "label"
        let (lo, hi) = reach
        sign.simdPosition = SIMD3((lo.x + hi.x) / 2, Float((plan.numbers.last ?? 0) + 1) * HousePlan.storey + max(peak.rise, 0) + 1.6, (lo.y + hi.y) / 2)
        sign.constraints = [SCNBillboardConstraint()]
        sign.castsShadow = false
        top.addChildNode(sign)
    }

    /// One colour part of the way to another.
    static func mix(_ a: UIColor, _ b: UIColor, _ t: CGFloat) -> UIColor {
        var (r0, g0, b0, a0): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        var (r1, g1, b1, a1): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        a.getRed(&r0, green: &g0, blue: &b0, alpha: &a0)
        b.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        return UIColor(red: r0 + (r1 - r0) * t, green: g0 + (g1 - g0) * t, blue: b0 + (b1 - b0) * t, alpha: 1)
    }

    /// A material seen from both sides: a roof's slopes, from under the eaves.
    private func two(_ m: SCNMaterial) -> SCNMaterial {
        let made = m.copy() as! SCNMaterial
        made.isDoubleSided = true
        return made
    }

    // MARK: The garden round it

    private func grounds() {
        let north = Float(HouseLayout.north(field: shown.state.field))
        let fence = HouseLand.fence(north: north, style: outside.fence.style, hex: outside.fence.color)
        HouseLook.physical(fence)
        yard.addChildNode(fence)
        if shown.state.field {
            // The back field, mown now it's theirs.
            let mown = SCNNode(geometry: SCNPlane(width: CGFloat(lot.wide), height: CGFloat(lot.back)))
            mown.geometry?.materials = [HouseLook.plain(HouseLook.color("9ad374").shaded(0.78), rough: 0.95)]
            mown.simdEulerAngles.x = -.pi / 2
            mown.simdPosition = SIMD3(lot.wide / 2, HouseTown.lawnHeight, lot.back / 2)
            mown.castsShadow = false
            yard.addChildNode(mown)
        }
        let taken = Set(all.filter { $0.value.floor == 0 }.flatMap { HouseLayout.cells($0.key, $0.value) })
        let trees = HouseLand.garden(north: north, clear: { x, z in
            // Nothing within a couple of metres of the house, or of anything in the yard.
            for dx in -2...2 { for dz in -2...2 where taken.contains(HouseCell(x: Int(x) + dx, z: Int(z) + dz)) { return false } }
            return true
        }, seed: shown.kid)
        HouseLook.physical(trees)
        yard.addChildNode(trees)
        guard let door = frontDoor else { return }
        // The path from the front door: down to the street if it faces it, else just a step out.
        let batch = HouseBatch()
        let stone = HouseLook.plain(HouseLook.color("e4ddcb"), rough: 0.9)
        let wide: Float = lot.front == .bulb ? 1.5 : 0.7
        let start = door.at + door.out * 0.1
        var end = door.at + door.out * 2
        if door.out.y > 0.5 { end.y = max(end.y, lot.frontZ(at: lot.x + door.at.x) - lot.z) }
        let across = SIMD2(abs(door.out.y), abs(door.out.x)) * wide
        batch.box(SIMD3(min(start.x, end.x) - across.x, -0.2, min(start.y, end.y) - across.y), SIMD3(max(start.x, end.x) + across.x, -0.02, max(start.y, end.y) + across.y), stone)
        batch.box(SIMD3(door.at.x - 0.75 * abs(door.out.y) - 0.3 * abs(door.out.x) + min(door.out.x, 0) * 0.6, -0.2, door.at.y - 0.75 * abs(door.out.x) - 0.3 * abs(door.out.y) + min(door.out.y, 0) * 0.6),
                  SIMD3(door.at.x + 0.75 * abs(door.out.y) + 0.3 * abs(door.out.x) + max(door.out.x, 0) * 0.6, -0.1, door.at.y + 0.75 * abs(door.out.x) + 0.3 * abs(door.out.y) + max(door.out.y, 0) * 0.6), HouseLook.concrete)
        let path = batch.node()
        path.castsShadow = false
        yard.addChildNode(path)
        // What they've put on the lawn, off to one side of the door.
        let lawnAt = door.at + door.out * 2.6 + SIMD2(door.out.y, -door.out.x) * 2.6
        if let key = outside.lawn, !taken.contains(HouseCell(x: Int(lawnAt.x.rounded(.down)), z: Int(lawnAt.y.rounded(.down)))) {
            let thing = HouseProps.lawn(key)
            thing.name = "thing:outside.lawn"
            HouseLook.physical(thing)
            let side = SIMD2(door.out.y, -door.out.x)
            let at = door.at + door.out * 2.6 + side * 2.6
            thing.simdPosition = SIMD3(at.x, 0, at.y)
            thing.simdEulerAngles.y = atan2(door.out.x, door.out.y)
            yard.addChildNode(thing)
        }
        // What they've put round the front of the house: a porch at the door, beds under the windows either
        // side of it, something by the road and something in the front garden. And what the time of year puts out.
        let side = SIMD2(door.out.y, -door.out.x), facing = atan2(door.out.x, door.out.y)
        let half = HousePlan.thickness / 2
        func put(_ key: String?, _ spot: String?, _ at: SIMD2<Float>, y: Float = 0) {
            // (Not where something's since been built: a room, or a thing of the yard.)
            if y == 0, taken.contains(HouseCell(x: Int(at.x.rounded(.down)), z: Int(at.y.rounded(.down)))) { return }
            guard let key, let thing = HouseStreetProps.made(key) else { return }
            if let spot { thing.name = "thing:outside.\(spot)" }
            HouseLook.physical(thing)
            thing.simdPosition = SIMD3(at.x, y, at.y)
            thing.simdEulerAngles.y = facing
            yard.addChildNode(thing)
        }
        put(outside.porch, "porch", door.at + door.out * half)
        for s: Float in [-1, 1] {
            // Only where there's a wall of the house behind it.
            let at = door.at + side * s * 2.3 + door.out * 0.42, behind = at - door.out * 0.9
            guard let ground = plan.floor(0), ground.indoor(ground.room(Int(behind.x.rounded(.down)), Int(behind.y.rounded(.down)))) else { continue }
            put(outside.beds, "beds", at, y: -0.02)
        }
        var kerb = door.at + door.out * 4.5 - side * 2.2
        if door.out.y > 0.5 { kerb = SIMD2(door.at.x + 2.4, max(door.at.y + 2.5, lot.frontZ(at: lot.x + door.at.x) - lot.z - 1.3)) }
        put(outside.kerb, "kerb", kerb)
        put(outside.garden, "garden", door.at + door.out * 2.8 - side * 2.6)
        switch HouseSeason.now {
        case .winter:
            put("eave-lights", nil, door.at + door.out * (half + 0.06), y: 2.6)
            put("door-wreath", nil, door.at + door.out * (half + 0.1), y: 1.6)
            put("snow-drift", nil, door.at + door.out * 1.6 + side * 1.9)
            put("snow-drift", nil, door.at + door.out * 3.6 - side * 4.2)
            put("gift-pile", nil, door.at + door.out * 0.9 - side * 1.25)
            if shown.kid == HouseTown.parentsID {
                // Mom & Dad's has a tree out, and a snowman.
                let out: [(String, Float, SIMD2<Float>)] = [("tree-decorated-snow", 1.5, door.at + door.out * 6.6 - side * 3.0), ("snowman-hat", 1.2, door.at + door.out * 3.2 - side * 4.4)]
                for (name, grown, at) in out where !taken.contains(HouseCell(x: Int(at.x.rounded(.down)), z: Int(at.y.rounded(.down)))) {
                    let model = HouseProps.kit(name, folder: "holiday", scale: grown)
                    HouseLook.physical(model)
                    model.simdPosition = SIMD3(at.x, 0, at.y)
                    model.simdEulerAngles.y = facing
                    yard.addChildNode(model)
                }
            }
        case .halloween:
            put("pumpkins", nil, door.at + door.out * 0.9 - side * 1.25)
        case .plain:
            break
        }
        // A lantern by the door, after dark.
        if sky.lit {
            let lamp = HouseProps.porchLight()
            HouseLook.physical(lamp)
            lamp.enumerateHierarchy { n, _ in if let l = n.light { l.intensity = 7; l.attenuationEndDistance = 5 } }
            let at = door.at + side * 0.85 + door.out * 0.08
            lamp.simdPosition = SIMD3(at.x, 1.9, at.y)
            lamp.simdEulerAngles.y = atan2(door.out.x, door.out.y)
            yard.addChildNode(lamp)
        }
    }

    // MARK: How it's shown

    /// Shut, as the street sees it; or open on a floor, seen from somewhere,
    /// looking into a room. The floors under the one shown are shut with a
    /// lid on; those over it are gone. Whoever lives there is in the room
    /// looked into (or the first), or on the step when it's shut.
    func present(floor: Int?, view: HouseVantage, focus: String?, animated: Bool) {
        showing = floor
        let letter = focus.map { HouseLayout.shape($0).letter }
        // Looking at something in the yard, every wall of the house is down, so it's not hidden behind one.
        let view = focus.map(HouseLayout.yard) == true && view != .shut ? HouseVantage.flat : view
        for f in plan.numbers {
            var want: Standing?
            var contents = false, lidded = false
            if let floor {
                if floor < 0 { want = f == floor ? Standing(view: view, focus: letter) : nil; contents = f == floor }
                else if f == floor { want = Standing(view: view, focus: letter); contents = true }
                else if f >= 0 && f < floor { want = Standing(view: .shut, focus: nil); lidded = true }
            } else if f >= 0 {
                want = Standing(view: .shut, focus: nil)
            }
            storeys[f]?.isHidden = want == nil
            insides[f]?.isHidden = !contents
            lids[f]?.isHidden = !lidded
            guard want != standing[f] else { continue }
            if let was = standing[f], let old = walls[f]?[was] {
                if animated { old.runAction(.sequence([.fadeOut(duration: 0.18), .removeFromParentNode()])) } else { old.removeFromParentNode() }
            }
            if let want {
                let made = walls[f]?[want] ?? wallsNode(f, want)
                walls[f, default: [:]][want] = made
                made.removeAllActions()
                made.simdPosition.y = Float(f) * HousePlan.storey
                made.opacity = animated ? 0 : 1
                if made.parent == nil { node.addChildNode(made) }
                if animated { made.runAction(.fadeIn(duration: 0.18)) }
            }
            standing[f] = want
        }
        top.isHidden = floor != nil
        yard.isHidden = (floor ?? 0) < 0
        // What's on a wall goes when the wall does.
        for thing in hung {
            guard let floor, thing.floor == floor, let on = plan.floor(floor) else { thing.node.isHidden = true; continue }
            let opened: Bool = { if case .door = on.openings[thing.edge] { return true }; if case .arch = on.openings[thing.edge] { return true }; return false }()
            thing.node.isHidden = opened || on.lowered(thing.edge, from: view, focus: letter)
        }
        // Whoever lives there.
        let rooms = shown.state.rooms
        let home = focus.flatMap { all[$0] != nil && !HouseLayout.fixture($0) ? $0 : nil } ?? rooms.first
        for (i, who) in people.enumerated() {
            var at = stand(in: floor == nil ? nil : home)
            var seen = true
            if i > 0 {
                // The other one's beside them on the step; indoors, in the kitchen.
                if floor == nil { if let door = frontDoor { at += SIMD3(door.out.y, 0, -door.out.x) * 1.2 } }
                else if all["kitchen"] != nil, home != "kitchen" { at = stand(in: "kitchen") }
                else { seen = false }
            }
            who.node.simdPosition = at
            // (With the house open, it's the family that's about in it: HouseLife.)
            who.node.isHidden = !seen || floor != nil
        }
    }

    /// Turn whoever lives there to face where they're looked at from.
    func face(yaw: Float) {
        for who in people { who.node.simdEulerAngles.y = .pi + yaw }
    }
}
