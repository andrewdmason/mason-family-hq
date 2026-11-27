import SceneKit
import UIKit

// Who's at home. Whichever house is open has the family in it: the kids,
// Mom and Dad, Charlie the greyhound and Pippy the cat. They walk from room
// to room through the doors, up and down the stairs, out of the front door
// and round the house to whatever's in the yard; they sit on what can be sat
// on and stand at what can be used; and the pets go where they like, which is
// mostly where somebody is. Nobody needs anything and nothing's kept: it's
// only there to be watched. A tap on someone gets a wave, and a tap on a
// thing sends whoever's nearest over to it.
//
// Where they can go is worked out from the house as it stands
// (HouseLayout.doorways, the hall's stairs, the front door, and the open
// grass between the things in the yard). Everything's in the lot's own
// space, as the house is built (HouseBuilt.swift), and their figures hang
// from the house's node.

final class HouseLife {
    /// One of the family: someone, or one of the pets.
    enum Who {
        case person(MathLook, name: String, height: Float)
        case dog(name: String)
        case cat(name: String)
    }

    enum Doing: Equatable {
        case stand
        /// Sitting, this far off the floor.
        case sit(Float)
        case use
        case jump
        case swim
        case wave
    }

    /// Somewhere to be: on a sofa, at a machine, in the pool.
    struct Perch {
        let place: String
        /// What it's at ("den.sofa"), so two aren't on one.
        let key: String
        let at: SIMD3<Float>
        /// Which way they face there (0: south).
        let yaw: Float
        let doing: Doing
    }

    private final class Actor {
        let who: Who
        let node = SCNNode()
        var person: MathCharacter?
        var pet: SCNNode?
        var place = ""
        var path: [SIMD3<Float>] = []
        var perch: Perch?
        var settled = false
        var wait: Float = 0
        var clock: Float = 0
        var speed: Float = 1.3
        var name: String {
            switch who {
            case .person(_, let name, _), .dog(let name), .cat(let name): name
            }
        }
        var isPet: Bool { person == nil }

        init(_ who: Who) {
            self.who = who
            switch who {
            case .person(let look, _, let height):
                let made = MathCharacter(look: look, height: height)
                made.play("idle")
                HouseLook.physical(made.node)
                // (A figure faces away as it's made: turned, so that turning its holder to 0 faces it south, as a thing's front does.)
                made.node.simdEulerAngles.y = .pi
                node.addChildNode(made.node)
                person = made
                speed = height < 1.4 ? 1.55 : 1.25
            case .dog:
                let made = HouseStreetProps.greyhound()
                HouseLook.physical(made)
                node.addChildNode(made)
                pet = made
                speed = 1.9
            case .cat:
                let made = HouseStreetProps.cat()
                HouseLook.physical(made)
                node.addChildNode(made)
                pet = made
                speed = 1.1
            }
            node.name = "who:\(name)"
        }
    }

    private let lock = NSLock()
    private var actors: [Actor] = []
    private var cast: [String] = []
    /// The house they're in, and what's known of it.
    private weak var house: HouseBuilt?
    private var kid: String?
    private var hubs: [String: SIMD3<Float>] = [:]
    private var links: [String: [(to: String, via: [SIMD3<Float>])]] = [:]
    private var perches: [String: [Perch]] = [:]
    private var outdoors: Set<String> = []
    private var rng = MathRNG(seed: UInt64(Date().timeIntervalSince1970))
    private static let outside = "outside"

    /// Who the family is. The same people come back as the same figures.
    func gather(_ family: [Who]) {
        let names = family.map { who -> String in
            switch who {
            case .person(let look, let name, _): "\(name)|\(look.head)|\(look.body)|\(look.hair)|\(look.top)"
            case .dog(let name), .cat(let name): name
            }
        }
        lock.lock()
        defer { lock.unlock() }
        guard names != cast else { return }
        for a in actors { a.node.removeFromParentNode() }
        cast = names
        actors = family.map(Actor.init)
        house = nil
        kid = nil
    }

    // MARK: The house they're in

    /// Move in to the house that's open (nil: nobody's anywhere). The same
    /// house built again (something's been changed in it) leaves everyone
    /// where they were, if that's still somewhere.
    func move(into built: HouseBuilt?) {
        lock.lock()
        defer { lock.unlock() }
        guard built !== house else { return }
        guard let built else {
            for a in actors { a.node.removeFromParentNode() }
            house = nil
            kid = nil
            return
        }
        let same = kid == built.shown.kid
        house = built
        kid = built.shown.kid
        survey(built)
        for a in actors {
            a.node.removeFromParentNode()
            built.node.addChildNode(a.node)
            if same, hubs[a.place] != nil {
                // Where they were: but whatever they were on may have gone.
                a.path = []
                a.perch = nil
                a.settled = false
                a.wait = 0.2 + Float(rng.unit()) * 1.5
                if let p = a.person { p.play("idle") }
                continue
            }
            // Scattered about the ground floor and the yard, each somewhere of their own.
            let places = hubs.keys.filter { $0 != Self.outside && (outdoors.contains($0) || level(of: $0) == 0) }.sorted()
            a.place = places.isEmpty ? Self.outside : places[rng.int(places.count)]
            a.node.simdPosition = (hubs[a.place] ?? .zero) + SIMD3(Float(rng.unit()) - 0.5, 0, Float(rng.unit()) - 0.5) * 0.8
            a.path = []
            a.perch = nil
            a.settled = false
            a.wait = Float(rng.unit()) * 2.5
            if let p = a.person { p.play("idle") }
        }
    }

    private func level(of place: String) -> Int { Int(((hubs[place]?.y ?? 0) / HousePlan.storey).rounded()) }

    /// Work out where there is to go in a house, how to get from each place to the next, and what there is to do.
    private func survey(_ b: HouseBuilt) {
        hubs = [:]; links = [:]; perches = [:]; outdoors = []
        let all = b.all
        for (room, _) in all {
            hubs[room] = b.stand(in: room)
            if HouseLayout.yard(room) { outdoors.insert(room) }
        }
        func link(_ a: String, _ c: String, _ via: [SIMD3<Float>]) {
            links[a, default: []].append((c, via))
            links[c, default: []].append((a, via.reversed()))
        }
        // Through each door, a step either side of it so nobody cuts the corner of a wall.
        for f in Set(all.values.map(\.floor)) {
            let y = Float(f) * HousePlan.storey
            for way in HouseLayout.doorways(all, floor: f) {
                let e = way.edge
                let mid = SIMD3(Float(e.x) + (e.across ? 0.5 : 0), y, Float(e.z) + (e.across ? 0 : 0.5))
                let n: SIMD3<Float> = e.across ? SIMD3(0, 0, 0.55) : SIMD3(0.55, 0, 0)
                // Which of the two is north (or west) of the door.
                let first = HouseCell(x: e.across ? e.x : e.x - 1, z: e.across ? e.z - 1 : e.z)
                let aFirst = HouseLayout.cells(way.a, all[way.a]!).contains(first)
                link(aFirst ? way.a : way.b, aFirst ? way.b : way.a, [mid - n, mid + n])
            }
        }
        // Up the stairs, from the hall to the landing.
        if let stairs = b.flightPath, all[HouseLayout.landing] != nil { link(HouseLayout.hall, HouseLayout.landing, [stairs.foot, stairs.head]) }
        // Out of the front door, and from the step round to each thing in the yard.
        if let step = b.step {
            hubs[Self.outside] = step.outside
            outdoors.insert(Self.outside)
            link(HouseLayout.hall, Self.outside, [step.inside])
            let taken = Set(all.filter { $0.value.floor == 0 }.flatMap { HouseLayout.cells($0.key, $0.value) })
            for (room, p) in all where HouseLayout.yard(room) {
                let own = Set(HouseLayout.cells(room, p))
                if let way = walk(from: step.outside, to: hubs[room]!, blocked: taken.subtracting(own), field: b.shown.state.field) { link(Self.outside, room, way) }
            }
        }
        // What there is to do: a perch for everything that can be sat on or used.
        for thing in b.things {
            guard let doing = Self.doing(thing.item), hubs[thing.room] != nil else { continue }
            let front = SIMD3(sin(thing.facing), 0, cos(thing.facing))
            let key = HouseCatalog.key(thing.room, thing.spot)
            switch doing {
            case .sit(let high):
                perches[thing.room, default: []].append(Perch(place: thing.room, key: key, at: thing.at + SIMD3(0, high, 0) + front * 0.1, yaw: thing.facing, doing: doing))
            default:
                let off = HouseThings.depth(thing.item) / 2 + 0.45
                perches[thing.room, default: []].append(Perch(place: thing.room, key: key, at: thing.at + front * off, yaw: thing.facing + .pi, doing: doing))
            }
        }
        // And what the yard's big things are for.
        for (room, p) in all where HouseLayout.yard(room) {
            let y: Float = 0
            func at(_ x: Float, _ z: Float, _ up: Float = 0) -> SIMD3<Float> { let q = b.point(room, x, z); return SIMD3(q.x, y + up, q.y) }
            let turn = -Float(p.turn) * .pi / 2
            switch room {
            case "trampoline": perches[room, default: []].append(Perch(place: room, key: room, at: at(1.5, 1.5, 0.72), yaw: turn, doing: .jump))
            case "pool":
                perches[room, default: []].append(Perch(place: room, key: "pool.a", at: at(3.6, 2.6, -0.62), yaw: turn + 0.6, doing: .swim))
                perches[room, default: []].append(Perch(place: room, key: "pool.b", at: at(6.6, 3.7, -0.62), yaw: turn - 2.2, doing: .swim))
            case "diamond": perches[room, default: []].append(Perch(place: room, key: "diamond.plate", at: at(4.6, 9.1), yaw: turn + .pi / 2, doing: .use))
            case "court": perches[room, default: []].append(Perch(place: room, key: "court.shot", at: at(2.5, 3.4), yaw: turn + .pi, doing: .jump))
            case "treehouse": perches[room, default: []].append(Perch(place: room, key: "treehouse.up", at: at(2.0, 2.5, 2.52), yaw: turn, doing: .wave))
            default: break
            }
        }
    }

    /// What someone does at a thing: sit on it, use it, or nothing (it's only to look at).
    private static func doing(_ item: HouseItem) -> Doing? {
        let dull = ["plant", "lamp", "light", "bear", "cardboard", "trashcan", "coatrack", "rug", "books", "pillow", "column", "curtain"]
        switch item.look {
        case .kit(let name, _):
            let n = name.lowercased()
            if dull.contains(where: n.contains) { return nil }
            if n.contains("bed") && !n.contains("cabinet") { return .sit(0.5) }
            if ["sofa", "couch", "chair", "bench", "stool", "lounge"].contains(where: n.contains) { return .sit(0.36) }
            return .use
        case .stack: return .use
        case .made(let key):
            switch key {
            case "bean-bag": return .sit(0.22)
            case "bean-bag-giant": return .sit(0.34)
            case "cinema-seats", "cinema-seats-gold": return .sit(0.4)
            case "reading-nook": return .sit(0.45)
            case "lounger": return .sit(0.3)
            case "bleachers", "dugout", "bench-park": return .sit(0.42)
            case "swings": return .sit(0.5)
            case "book-stack", "globe", "gnome", "boxes", "bulb", "parasol", "float-ring", "float-duck", "float-flamingo", "flowers", "pond",
                 "deck", "pool", "pool-lagoon", "pool-hot", "diamond", "court", "trampoline", "trampoline-net", "treehouse", "treehouse-pirate", "treehouse-rocket",
                 "scoreboard", "vegpatch", "vegpatch-pumpkins", "vegpatch-flowers", "mirror", "mirror-late", "duck", "door":
                return nil
            default: return key.hasPrefix("slab:") ? nil : .use
            }
        case .model(let folder, let name, _):
            if name == "tree-log" || name == "bench" { return .sit(0.3) }
            if ["cone", "bucket", "barrel", "signpost", "skateboard", "bedroll", "rail-low", "rail-high"].contains(name) { return nil }
            return folder == "skate" && name == "half-pipe" ? nil : .use
        case .tree, .food, .pet, .rug, .art, .window: return nil
        default: return nil
        }
    }

    /// A way over the grass from one point to another, a square metre at a time, round whatever's standing there.
    private func walk(from: SIMD3<Float>, to: SIMD3<Float>, blocked: Set<HouseCell>, field: Bool) -> [SIMD3<Float>]? {
        let north = HouseLayout.north(field: field)
        func cell(_ p: SIMD3<Float>) -> HouseCell { HouseCell(x: Int(p.x.rounded(.down)), z: Int(p.z.rounded(.down))) }
        // (A metre off the land all round is open too: the pavement, the verge.)
        func open(_ c: HouseCell) -> Bool { c.x >= -1 && c.x <= HouseLayout.width && c.z >= north && c.z <= HouseLayout.depth + 2 && !blocked.contains(c) }
        let start = cell(from), goal = cell(to)
        guard open(start) else { return nil }
        var came: [HouseCell: HouseCell] = [start: start], queue = [start], at = 0
        while at < queue.count, came[goal] == nil {
            let c = queue[at]; at += 1
            for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let n = HouseCell(x: c.x + dx, z: c.z + dz)
                if came[n] == nil, open(n) || n == goal { came[n] = c; queue.append(n) }
            }
        }
        guard came[goal] != nil else { return nil }
        var cells: [HouseCell] = [], c = goal
        while c != start { cells.append(c); c = came[c]! }
        cells.reverse()
        // Only where it turns.
        var out: [SIMD3<Float>] = []
        for (i, c) in cells.enumerated() where i + 1 < cells.count {
            let before = i == 0 ? start : cells[i - 1], after = cells[i + 1]
            if (c.x - before.x, c.z - before.z) != (after.x - c.x, after.z - c.z) { out.append(SIMD3(Float(c.x) + 0.5, 0, Float(c.z) + 0.5)) }
        }
        return out
    }

    /// The way from one place to another: every point to pass through, ending at the other's middle.
    private func route(from: String, to: String) -> [SIMD3<Float>]? {
        if from == to { return [] }
        var came: [String: (from: String, via: [SIMD3<Float>])] = [:]
        var queue = [from], at = 0, seen: Set<String> = [from]
        while at < queue.count {
            let here = queue[at]; at += 1
            if here == to { break }
            for next in links[here] ?? [] where seen.insert(next.to).inserted {
                came[next.to] = (here, next.via)
                queue.append(next.to)
            }
        }
        guard came[to] != nil else { return nil }
        var legs: [[SIMD3<Float>]] = [], here = to
        while here != from, let step = came[here] {
            legs.append(step.via + [hubs[here] ?? .zero])
            here = step.from
        }
        return legs.reversed().flatMap { $0 }
    }

    // MARK: What they do

    private func taken(_ key: String, by: Actor) -> Bool { actors.contains { $0 !== by && $0.perch?.key == key } }

    /// Decide where to go next. Mostly somewhere that can be seen: the floor that's shown, or the yard.
    private func choose(_ a: Actor, showing: Int?) {
        let places = hubs.keys.sorted()
        guard !places.isEmpty else { a.wait = 3; return }
        var weighted: [(String, Float)] = []
        for place in places {
            let lv = level(of: place)
            // (Nobody goes down to the basement or comes up from it: there's no walking there.)
            guard place == a.place || route(from: a.place, to: place) != nil else { continue }
            var w: Float = 1.0
            if let showing, outdoors.contains(place) ? showing >= 0 : lv == showing { w = 4 }
            if place == a.place { w *= 0.8 }
            if place == Self.outside { w *= 0.3 }
            if perches[place]?.isEmpty ?? true { w *= 0.5 }
            weighted.append((place, w))
        }
        // A dog goes where somebody is, more often than not.
        if case .dog = a.who, rng.unit() < 0.6, let friend = actors.filter({ !$0.isPet }).randomElement(using: &rng), route(from: a.place, to: friend.place) != nil {
            weighted = [(friend.place, 1)]
        }
        var roll = rng.unit() * weighted.map(\.1).reduce(0, +)
        var to = weighted.first?.0 ?? a.place
        for (place, w) in weighted {
            roll -= w
            if roll <= 0 { to = place; break }
        }
        go(a, to: to, perch: nil)
    }

    /// Send someone to a place, to a perch there if one's free (the one given, or any).
    private func go(_ a: Actor, to place: String, perch wanted: Perch?) {
        guard let hub = hubs[place], let way = route(from: a.place, to: place) else { a.wait = 2; return }
        var path: [SIMD3<Float>] = []
        // Out through the middle of where they are, unless they're only crossing the room.
        if place != a.place, let own = hubs[a.place] { path.append(own) }
        path += way
        var perch = wanted
        if perch == nil, !a.isPet || rng.unit() < 0.35 {
            let free = (perches[place] ?? []).filter { !taken($0.key, by: a) && (!a.isPet || $0.doing != .swim && $0.doing != .jump && $0.doing != .wave) }
            if rng.unit() < 0.85 { perch = free.randomElement(using: &rng) }
        }
        if let perch {
            // A pet doesn't sit on the sofa or work the machine: it comes and stands by whoever might.
            path.append(a.isPet ? SIMD3(perch.at.x, hub.y, perch.at.z) + SIMD3(Float(rng.unit()) - 0.5, 0, Float(rng.unit()) - 0.5) * 0.9 : perch.at)
        } else if place == a.place || path.isEmpty {
            path.append(hub + SIMD3(Float(rng.unit()) - 0.5, 0, Float(rng.unit()) - 0.5) * 1.4)
        } else {
            path[path.count - 1] = hub + SIMD3(Float(rng.unit()) - 0.5, 0, Float(rng.unit()) - 0.5) * 1.0
        }
        a.perch = a.isPet ? nil : perch
        a.place = place
        a.path = path
        a.settled = false
        if let p = a.person { p.play(a.speed > 1.4 && rng.unit() < 0.25 ? "sprint" : "walk", speed: 1.15) }
    }

    /// They've got where they were going.
    private func arrive(_ a: Actor) {
        a.settled = true
        a.clock = 0
        guard let perch = a.perch else {
            a.wait = 2 + Float(rng.unit()) * 5
            a.person?.play(rng.unit() < 0.2 ? "emote-yes" : "idle")
            return
        }
        a.node.simdPosition = perch.at
        a.node.simdEulerAngles.y = perch.yaw
        a.wait = 6 + Float(rng.unit()) * 9
        switch perch.doing {
        case .sit: a.person?.play("sit")
        case .use: a.person?.play(["interact-right", "interact-left", "idle", "emote-yes"][rng.int(4)])
        case .jump: a.person?.play("jump", speed: 1.2)
        case .swim: a.person?.play("idle")
        case .wave: a.person?.play("emote-yes")
        case .stand: a.person?.play("idle")
        }
    }

    /// A moment of everyone's day. `showing` is the floor of the house in view; `facing`, where they're looked at from.
    func step(_ dt: Float, showing: Int?, facing: Float) {
        lock.lock()
        defer { lock.unlock() }
        guard house != nil else { return }
        for a in actors {
            a.clock += dt
            a.person?.update(dt)
            if !a.path.isEmpty {
                var left = a.speed * dt
                var at = a.node.simdPosition
                while left > 0, let next = a.path.first {
                    let gap = next - at, far = simd_length(gap)
                    if far <= left { at = next; left -= far; a.path.removeFirst() } else {
                        at += gap / far * left
                        let flat = SIMD2(gap.x, gap.z)
                        if simd_length(flat) > 0.01 { a.node.simdEulerAngles.y = turned(a.node.simdEulerAngles.y, toward: atan2(flat.x, flat.y), by: dt * 9) }
                        left = 0
                    }
                }
                a.node.simdPosition = at
                if a.path.isEmpty { arrive(a) }
            } else if a.settled {
                a.wait -= dt
                if let perch = a.perch {
                    switch perch.doing {
                    case .jump:
                        // Up and down, as high as the jump takes.
                        let t = (a.clock * 1.25).truncatingRemainder(dividingBy: 1)
                        a.node.simdPosition.y = perch.at.y + (perch.place == "trampoline" ? 1.5 : 0.5) * 4 * t * (1 - t)
                    case .swim:
                        a.node.simdPosition.y = perch.at.y + sin(a.clock * 2.2) * 0.04
                        a.node.simdEulerAngles.y = perch.yaw + sin(a.clock * 0.5) * 0.5
                    default: break
                    }
                } else if !a.isPet {
                    // Standing about: they turn to whoever's looking.
                    a.node.simdEulerAngles.y = turned(a.node.simdEulerAngles.y, toward: facing, by: dt * 3)
                }
                if a.wait <= 0 {
                    a.perch = nil
                    choose(a, showing: showing)
                }
            } else {
                a.wait -= dt
                if a.wait <= 0 { choose(a, showing: showing) }
            }
            if let pet = a.pet { animate(pet, walking: !a.path.isEmpty, clock: a.clock, cat: { if case .cat = a.who { return true }; return false }()) }
            // Seen on the floor that's shown; in the yard, whenever the house is above ground.
            let level = Int(((a.node.simdPosition.y + 0.25) / HousePlan.storey).rounded(.down))
            let out = outdoors.contains(a.place) && a.node.simdPosition.y < HousePlan.storey - 0.3 && !inside(a.node.simdPosition)
            a.node.isHidden = showing.map { out ? $0 < 0 : level != $0 } ?? true
        }
    }

    /// Whether a point of the lot is in a room of the house (not out on the grass), on the ground.
    private func inside(_ p: SIMD3<Float>) -> Bool {
        guard let house else { return false }
        let room = HouseLayout.room(at: HouseCell(x: Int(p.x.rounded(.down)), z: Int(p.z.rounded(.down))), floor: 0, in: house.all)
        return room.map { !HouseLayout.shape($0).outdoor } ?? false
    }

    private func turned(_ from: Float, toward: Float, by: Float) -> Float {
        var d = (toward - from).truncatingRemainder(dividingBy: 2 * .pi)
        if d > .pi { d -= 2 * .pi }
        if d < -.pi { d += 2 * .pi }
        return from + d * min(1, by)
    }

    /// A pet's legs, tail and head: trotting, or standing with its tail going.
    private func animate(_ pet: SCNNode, walking: Bool, clock: Float, cat: Bool) {
        let body = pet.childNode(withName: "body", recursively: true) ?? pet
        let swing = walking ? sin(clock * (cat ? 9 : 12)) * (cat ? 0.5 : 0.65) : 0
        for (name, sign) in [("leg-fl", Float(1)), ("leg-br", 1), ("leg-fr", -1), ("leg-bl", -1)] {
            body.childNode(withName: name, recursively: false)?.simdEulerAngles.x = swing * sign
        }
        if let tail = body.childNode(withName: "tail", recursively: false) {
            if cat { tail.simdEulerAngles.z = sin(clock * 1.3) * 0.25 } else { tail.simdEulerAngles.y = sin(clock * (walking ? 6 : 9)) * (walking ? 0.2 : 0.5) }
        }
        if let head = body.childNode(withName: "head", recursively: false) {
            head.simdEulerAngles.x = walking ? sin(clock * 12) * 0.05 : sin(clock * 0.8) * 0.12
            if !walking { head.simdEulerAngles.y = sin(clock * 0.45) * 0.35 }
        }
        body.simdPosition.y = walking ? abs(sin(clock * 12)) * 0.015 : 0
    }

    // MARK: Taps

    /// Who a node of the scene belongs to, if it's one of them.
    func who(_ node: SCNNode) -> String? {
        var n: SCNNode? = node
        while let at = n {
            if let name = at.name, name.hasPrefix("who:") { return String(name.dropFirst(4)) }
            n = at.parent
        }
        return nil
    }

    /// Someone's been tapped: they jump, wave, and say who they are.
    func greet(_ name: String) {
        lock.lock()
        defer { lock.unlock() }
        guard let a = actors.first(where: { $0.name == name }) else { return }
        let hop = SCNAction.sequence([.moveBy(x: 0, y: 0.35, z: 0, duration: 0.14), .moveBy(x: 0, y: -0.35, z: 0, duration: 0.16)])
        hop.timingMode = .easeOut
        (a.person?.node ?? a.pet)?.runAction(.sequence([hop, hop]))
        if a.path.isEmpty, a.perch == nil { a.person?.play("emote-yes", restart: true) }
        a.wait = max(a.wait, 2.5)
        tag(a.name, over: a.node, high: a.isPet ? 0.9 : 2.0)
    }

    /// A name on a little board over something, for a moment.
    func tag(_ text: String, over node: SCNNode, high: Float) {
        node.childNode(withName: "tag", recursively: false)?.removeFromParentNode()
        let sign = HouseProps.sign([text])
        // (Lit by nothing: it reads the same at night.)
        sign.enumerateHierarchy { node, _ in node.geometry?.materials.forEach { $0.lightingModel = .constant } }
        sign.name = "tag"
        sign.simdScale = SIMD3(repeating: 0.42)
        sign.simdPosition = SIMD3(0, high, 0)
        sign.constraints = [SCNBillboardConstraint()]
        sign.castsShadow = false
        sign.renderingOrder = 90
        node.addChildNode(sign)
        // (Hidden when it's done, not removed: nothing's taken out of the scene from the renderer's thread.)
        sign.runAction(.sequence([.wait(duration: 2.2), .fadeOut(duration: 0.4), .hide()]))
    }

    /// A thing's been tapped: whoever's nearest and not busy comes over to it, if it's something to sit on or use.
    func call(to room: String, spot: String) {
        lock.lock()
        defer { lock.unlock() }
        let key = HouseCatalog.key(room, spot)
        guard let perch = perches[room]?.first(where: { $0.key == key }), !actors.contains(where: { $0.perch?.key == key }) else { return }
        let free = actors.filter { !$0.isPet && route(from: $0.place, to: room) != nil }
        guard let nearest = free.min(by: { simd_distance($0.node.simdPosition, perch.at) < simd_distance($1.node.simdPosition, perch.at) }) else { return }
        go(nearest, to: room, perch: perch)
    }

    /// For the tests: where everyone is, and what they're on.
    var whereabouts: [(name: String, place: String, perch: String?, moving: Bool)] {
        lock.lock()
        defer { lock.unlock() }
        return actors.map { ($0.name, $0.place, $0.perch?.key, !$0.path.isEmpty) }
    }
}
