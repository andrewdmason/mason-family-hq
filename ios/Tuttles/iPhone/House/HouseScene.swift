import SceneKit
import UIKit

// The neighbourhood (HouseTown.swift), in 3D, seen in perspective from a
// camera that goes round it. Each house is built from where its owner has
// put its rooms (HouseLayout.swift, HouseBuilt.swift).
//
// The camera's never locked: the town can be dragged about, pinched closer
// or further and turned from anywhere, and how close it is says what's
// shown. From far off the houses are shut, with their roofs on. Close to
// one, it opens on a floor: whichever walls would be in the way come down to
// a stub (the outside ones on the camera's side, and those between rooms),
// with the doors left standing. Closer still, the room in the middle of the
// screen is the one you're in, and it keeps the walls at its back. A floor
// picked is the one shown; those under it are shut with a lid on, and those
// over it are gone. A tap on a house or a room only flies there.
//
// A room's spots have markers only while the card for changing them is up,
// and then the camera's round where its furniture faces. A room being put
// somewhere is held: it shows where it would stand, green where it can and
// red where it can't, and goes with a finger. Only a card over the bottom of
// the screen, or a room in hand, holds what's in focus while the town's
// moved.
//
// A house's outside is its own to choose (HouseCatalog.outside), and the
// town keeps the time of day (HouseSky.swift): at night the lamps in the
// open house are on, and the windows of a shut one are lit.

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
        case spot(String, String, String)
        /// A thing in the room that's in focus: whose house, the room and the spot.
        case thing(String, String, String)
        /// One of the family, by name.
        case person(String)
    }

    /// A room in hand, being put somewhere: where it would stand, and why it can't, if it can't.
    struct Held: Equatable {
        var room: String
        var plot: HousePlot
        /// One being bought, not one of theirs being moved.
        var new: Bool
        var trouble: String?
    }

    let scene = SCNScene()
    let cameraNode = SCNNode()
    /// The town they stand in (HouseTown.swift): its streets, the neighbours, the trees.
    private let land = HouseTown.land()
    /// Everyone's houses, and Mom & Dad's (HouseTown.parents), which is always there.
    private var houses: [HouseShown] = []
    private var lots: [String: HouseTown.Lot] = [:]
    private var built: [String: HouseBuilt] = [:]
    /// Whoever's at home in each, for the renderer's thread to keep moving.
    private var actors: [MathCharacter] = []
    private let lock = NSLock()
    /// The family, who are about in whichever house is open (HouseLife.swift).
    let life = HouseLife()
    /// The floor of the open house that's shown, for the renderer's thread.
    private var lifeFloor: Int?

    /// A card's up over the bottom of the screen, for a spot of the room in focus (or the outside of a house).
    private(set) var lifted = false
    /// What the camera's on: nothing in particular, a house (open), or a room of one.
    private(set) var focus = Focus.street
    /// Told when what's in focus changes, or the floor, or whether the whole town's in view.
    var changed: (() -> Void)?
    /// Waiting for a tap on the room to move: the house stays as it is meanwhile.
    var picking = false
    /// Their own house can be changed (it can't when it's the parents looking).
    private(set) var decorating = false
    /// The spot the card's for ("den.desk"): its marker stands out.
    private(set) var chosen: String?
    /// The house whose outside the card's up for: it stays shut, though the camera's on it.
    private(set) var shut: String?
    /// The time of day over the town.
    private(set) var sky = HouseSky.noon
    /// The floor picked in the open house (nil: the ground floor).
    private(set) var floor: Int?
    /// Pulled right back, to the whole neighbourhood.
    private(set) var wide = false
    private(set) var held: Held?
    private let ghost = SCNNode()
    /// The house and room with markers on its spots.
    private var marked: (kid: String, room: String)?

    /// Where the camera looks, from which way round (0 from the south, a quarter turn from the east) and how far off.
    struct Eye: Equatable {
        var target: SIMD3<Float>
        var yaw: Float
        var distance: Float
    }

    private var eye = Eye(target: .zero, yaw: HouseStage.corner, distance: 200)
    private var goal = Eye(target: .zero, yaw: HouseStage.corner, distance: 200)
    /// How the family's end of the street is framed, before anyone moves it.
    private var home = Eye(target: .zero, yaw: HouseStage.corner, distance: 200)
    /// The camera's been moved from how the street's first shown: dragged, pinched, turned or flown.
    private(set) var moved = false
    /// Where the camera was before the card came up.
    private var beforeLift: Eye?
    private var vantage = HouseVantage(x: 1, z: 1)
    private var aspect: Float = 0.46
    private var last: TimeInterval = 0
    private let sun = SCNNode()
    /// What things were last worked out for on the renderer's thread, so it's only done again when they change.
    private var sent: HouseVantage?

    /// The corner the town's first seen from: the south-east, a little round to the south.
    static let corner: Float = 0.68
    /// How far up the camera looks down from.
    private let elevation: Float = 0.66
    /// How much the camera takes in across the screen, in degrees.
    private let fov: Float = 24
    /// A house opens when the camera's this close and on it, and shuts when it's this far.
    private let opens: Float = 64, closes: Float = 74
    /// The room in the middle of the screen is the one you're in when the camera's this close, until it's this far.
    private let near: Float = 26, far: Float = 31
    static let closest: Float = 9

    override init() {
        super.init()
        land.name = "land"
        HouseLook.physical(land)
        // The town's colours were chosen for a flatter light than this: under it they're taken down a little.
        var seen: Set<ObjectIdentifier> = []
        land.enumerateHierarchy { n, _ in
            for m in n.geometry?.materials ?? [] where seen.insert(ObjectIdentifier(m)).inserted { m.multiply.contents = UIColor(white: 0.78, alpha: 1) }
        }
        scene.rootNode.addChildNode(land)
        scene.rootNode.addChildNode(ghost)
        let c = SCNCamera()
        c.projectionDirection = .horizontal
        c.fieldOfView = CGFloat(fov)
        c.zNear = 1; c.zFar = 1800
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
        cameraNode.camera = c
        scene.rootNode.addChildNode(cameraNode)
        light()
        // (Nothing's built until there's a street to show: `show`.)
        frame()
    }

    // MARK: Light

    private func light() {
        if sun.light == nil {
            // The sky, to be lit by and to shine in things.
            let size = CGSize(width: 256, height: 128)
            let above = UIGraphicsImageRenderer(size: size).image { ctx in
                let stops: [(String, CGFloat)] = [("6fa3e6", 0), ("a9c9f0", 0.25), ("e8eef5", 0.48), ("8f9a86", 0.55), ("5f6b52", 1)]
                let colors = stops.map { HouseLook.color($0.0).cgColor } as CFArray
                let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: stops.map(\.1))!
                ctx.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            }
            scene.lightingEnvironment.contents = above
            let l = SCNLight()
            l.type = .directional
            l.castsShadow = true
            l.shadowMode = .forward
            l.shadowMapSize = CGSize(width: 2048, height: 2048)
            l.shadowSampleCount = 16
            l.shadowRadius = 3
            l.automaticallyAdjustsShadowProjection = true
            l.shadowCascadeCount = 4
            l.shadowCascadeSplittingFactor = 0.5
            l.shadowBias = 1
            sun.light = l
            scene.rootNode.addChildNode(sun)
        }
        // Bright in the day; at night a little moonlight, and the sky hardly lighting anything.
        let day = CGFloat(sky.day)
        sun.light?.color = sky.sun.color
        sun.light?.intensity = 520 + 2080 * day
        sun.light?.shadowColor = UIColor(white: 0, alpha: 0.5 + 0.25 * day)
        // (Never so dark a room can't be seen.)
        scene.lightingEnvironment.intensity = 0.36 + 0.39 * day
        tidy()
    }

    func setSky(_ sky: HouseSky) {
        guard sky != self.sky else { return }
        let was = self.sky
        self.sky = sky
        light()
        // The lamps go on and off, and what's through a window changes.
        if was.lit != sky.lit || was.outlook != sky.outlook { rebuild() }
    }

    /// What's behind everything: the sky, or earth when it's a basement that's open.
    private func tidy() {
        let under = opened.flatMap { built[$0]?.showing }.map { $0 < 0 } ?? false
        land.isHidden = under
        // (Nothing else is down there: no street, and nobody else's house.)
        for (kid, b) in built { b.node.isHidden = under && kid != opened }
        scene.background.contents = under ? HouseLook.color("3b2f26") : sky.picture
    }

    // MARK: The houses

    /// The way of showing the street that's under way: a later one stops an earlier one's houses from arriving.
    private var showing = 0

    /// Everyone's houses, as they stand now. Mom & Dad's is added to them.
    /// Only what's changed since they were last shown is built again. `staged`
    /// (as the screen asks for; not the tests), their own house is built at
    /// once and the others one at a time over the next moments, so the street's
    /// there without waiting for all of it.
    func show(_ houses: [HouseShown], staged: Bool = false) {
        let next = houses.filter { $0.kid != HouseTown.parentsID } + [HouseTown.parents]
        let nextLots = HouseTown.lots(for: next.map { ($0.kid, $0.name) })
        let was = Dictionary(uniqueKeysWithValues: self.houses.map { ($0.kid, $0) })
        // Whoever's gone, or is on another lot now, comes down.
        for kid in Array(built.keys) where !next.contains(where: { $0.kid == kid }) || nextLots[kid] != lots[kid] {
            built[kid]?.node.removeFromParentNode()
            built[kid] = nil
        }
        // Their own first, Mom & Dad's (the biggest) last.
        let changed = next.filter { built[$0.kid] == nil || was[$0.kid] != $0 }
            .sorted { ($0.mine ? 0 : $0.kid == HouseTown.parentsID ? 2 : 1) < ($1.mine ? 0 : $1.kid == HouseTown.parentsID ? 2 : 1) }
        self.houses = next
        lots = nextLots
        showing += 1
        let run = showing
        // The family: each kid, Mom and Dad, and the pets.
        var family: [HouseLife.Who] = []
        for house in next where house.kid != HouseTown.parentsID {
            family.append(.person(house.look, name: house.name.split(separator: " ").first.map(String.init) ?? house.name, height: 1.25))
        }
        family.append(.person(HouseTown.parents.look, name: "Dad", height: 1.5))
        if let mom = HouseTown.parents.partner { family.append(.person(mom, name: "Mom", height: 1.45)) }
        family += [.dog(name: "Charlie"), .cat(name: "Pippy")]
        frame()
        guard staged else {
            life.gather(family)
            for house in changed { rebuild(house.kid) }
            present(animated: false)
            return
        }
        var later: [() -> Void] = [{ [weak self] in self?.life.gather(family) }]
        for (n, house) in changed.enumerated() {
            if n == 0, house.mine { rebuild(house.kid) } else { later.append { [weak self] in self?.rebuild(house.kid) } }
        }
        present(animated: false)
        func step() {
            guard run == showing, !later.isEmpty else { return }
            later.removeFirst()()
            present(animated: false)
            DispatchQueue.main.async(execute: step)
        }
        DispatchQueue.main.async(execute: step)
    }

    /// The family's end of the street: every house that's somebody's, all in
    /// view. Worked out from where their rooms are, not from the houses as
    /// built, so it's the same before they've all arrived.
    private func frame() {
        var lo = SIMD2<Float>(repeating: .greatestFiniteMagnitude), hi = -lo
        for house in houses {
            guard let lot = lots[house.kid] else { continue }
            let reach = HouseBuilt.reach(of: house.state.layout)
            let middle = SIMD2(lot.x, lot.z) + (reach.lo + reach.hi) / 2, radius = simd_length(reach.hi - reach.lo) / 2
            lo = simd_min(lo, middle - SIMD2(repeating: radius))
            hi = simd_max(hi, middle + SIMD2(repeating: radius))
        }
        guard lo.x <= hi.x else { return }
        home = Eye(target: SIMD3((lo.x + hi.x) / 2, 0.8, (lo.y + hi.y) / 2), yaw: Self.corner, distance: fit(simd_length(hi - lo) / 2))
        // Until somebody's moved it, that's what's looked at.
        if !moved {
            lock.lock(); eye = home; goal = home; lock.unlock()
        }
    }

    /// How far off the camera has to be to take in this much, either way from what it looks at.
    /// (With some to spare: what's nearer the camera takes up more of the screen.)
    private func fit(_ radius: Float) -> Float { radius / tan(fov * .pi / 360) * 1.22 }

    /// Build every house again, as they now stand.
    private func rebuild() {
        for b in built.values { b.node.removeFromParentNode() }
        built = [:]
        for house in houses { rebuild(house.kid) }
    }

    private func rebuild(_ kid: String) {
        guard let house = houses.first(where: { $0.kid == kid }), let lot = lots[kid] else { return }
        built[kid]?.node.removeFromParentNode()
        var marks: HouseBuilt.Marked?
        if let marked, marked.kid == kid, house.mine, decorating, lifted { marks = HouseBuilt.Marked(room: marked.room, chosen: chosen) }
        let made = HouseBuilt(house, on: lot, sky: sky, marked: marks)
        built[kid] = made
        scene.rootNode.addChildNode(made.node)
        lock.lock(); actors = built.values.flatMap(\.people); lock.unlock()
    }

    func state(of kid: String) -> HouseState? { houses.first { $0.kid == kid }?.state }

    /// The lot a house is on.
    func lot(of kid: String) -> HouseTown.Lot? { lots[kid] }

    /// One house has changed (something tried in a spot, or bought): build
    /// it again. `popping` is the spot whose thing has just arrived.
    func update(_ house: HouseShown, popping: String? = nil, fading: Bool = true) {
        guard let at = houses.firstIndex(where: { $0.kid == house.kid }) else { return }
        houses[at] = house
        rebuild(house.kid)
        present(animated: false)
        if let popping, let thing = built[house.kid]?.node.childNode(withName: "thing:\(popping)", recursively: true) {
            let was = thing.simdScale
            thing.simdScale = was * 0.82
            let grow = SCNAction.customAction(duration: 0.26) { node, t in
                let k = Float(t / 0.26)
                node.simdScale = was * (0.82 + 0.18 * (1 - pow(1 - k, 3)) + 0.08 * sin(k * .pi))
            }
            thing.runAction(.sequence([grow, .run { $0.simdScale = was }]))
        }
    }

    func setDecorating(_ on: Bool) { decorating = on }

    func setAspect(_ aspect: Float) { self.aspect = max(0.2, aspect) }

    // MARK: What's shown

    /// The house that's open, if one is.
    private var opened: String? {
        switch focus {
        case .street: return nil
        case .house(let kid), .room(let kid, _): return kid == shut ? nil : kid
        }
    }

    /// The floor in view in a house that's open: the one picked, or the ground; or a held room's, wherever that is.
    private func level(_ b: HouseBuilt) -> Int {
        if let held, b.shown.mine { return held.plot.floor }
        let want = floor ?? 0
        return b.floors.contains(want) ? want : 0
    }

    /// Show every house as it should be for what's in focus and where it's seen from.
    private func present(animated: Bool) {
        let open = opened
        for (kid, b) in built {
            var room: String?
            // (Nothing's looked into while a room's in hand: every room shows the same.)
            if case .room(let k, let id) = focus, k == kid, held == nil { room = id }
            b.present(floor: kid == open ? level(b) : nil, view: vantage, focus: room, animated: animated)
        }
        let home = open.flatMap { built[$0] }
        life.move(into: home)
        lock.lock(); lifeFloor = home?.showing; lock.unlock()
        tidy()
    }

    /// Work out what's in focus from where the camera's going: the house
    /// it's on and close to, and the room in the middle of the screen. Not
    /// while a card or a room in hand holds things as they are.
    private func settle() {
        lock.lock(); let e = goal; lock.unlock()
        let was = focus
        if !lifted && held == nil && !picking {
            let at = SIMD2(e.target.x, e.target.z)
            let current = opened
            var best: (kid: String, gap: Float)?
            for (kid, b) in built {
                let gap = simd_length(at - SIMD2(b.middle.x, b.middle.z)) - b.radius
                let mine = kid == current
                guard e.distance <= (mine ? closes : opens), gap <= (mine ? 9 : 4) else { continue }
                if best == nil || gap < best!.gap { best = (kid, gap) }
            }
            if let best, let b = built[best.kid] {
                var inRoom = false
                if case .room(best.kid, _) = was { inRoom = true }
                if best.kid != current { floor = nil }
                // (A big thing is still what's looked at from further off: the ball field doesn't fit on the screen from as near as a bathroom does.)
                if let room = b.room(under: at, floor: level(b)), let p = b.all[room],
                   e.distance <= max(inRoom ? far : near, Float(max(HouseLayout.size(room, p).width, HouseLayout.size(room, p).depth)) * 3.3 + (inRoom ? 5 : 1)) {
                    focus = .room(best.kid, room)
                } else { focus = .house(best.kid) }
            } else {
                focus = .street
                floor = nil
            }
        }
        present(animated: true)
        sun.light?.maximumShadowDistance = CGFloat(e.distance) * 1.5 + 50
        if focus != was { changed?() }
    }

    // MARK: The camera

    private func place(_ e: Eye) {
        let back = SIMD3(sin(e.yaw) * cos(elevation), sin(elevation), cos(e.yaw) * cos(elevation))
        cameraNode.simdPosition = e.target + back * e.distance
        // Up is always the world's up. (Left to itself `simdLook(at:)` takes the camera's own up
        // from the frame before, and a fast turn then rolls it over a little more every frame.)
        let level = SIMD3<Float>(0, 1, 0), ahead = SIMD3<Float>(0, 0, -1)
        cameraNode.simdLook(at: e.target, up: level, localFront: ahead)
        // The sun goes round with the camera, a little to its right, so the walls at the back are always the lit ones.
        let from = e.yaw + 0.45, high: Float = 0.73 - 0.3 * sky.low
        sun.simdPosition = e.target + SIMD3(sin(from) * cos(high), sin(high), cos(from) * cos(high)) * 40
        sun.simdLook(at: e.target, up: level, localFront: ahead)
    }

    /// The camera's somewhere new of its own accord: wherever it had been flown doesn't hold any more.
    private func roamed() {
        beforeLift = nil
        moved = true
        let whole = wide
        wide = false
        settle()
        if whole { changed?() }
    }

    /// A finger's dragged this far across the view, which is this high: the town goes with it.
    func drag(by d: CGPoint, height: CGFloat) {
        lock.lock()
        let width = Float(max(height, 1)) * aspect
        let perPoint = 2 * goal.distance * tan(fov * .pi / 360) / width
        let right = SIMD3(cos(goal.yaw), 0, -sin(goal.yaw)), away = SIMD3(-sin(goal.yaw), 0, -cos(goal.yaw))
        goal.target -= right * Float(d.x) * perPoint
        goal.target += away * Float(d.y) * perPoint / sin(elevation)
        goal.target = HouseTown.kept(goal.target)
        lock.unlock()
        roamed()
    }

    func pinch(by scale: CGFloat, about: CGPoint = .zero, height: CGFloat = 1) {
        lock.lock()
        goal.distance = min(max(goal.distance / Float(scale), Self.closest), fit(HouseTown.reach) * 1.15)
        lock.unlock()
        roamed()
    }

    /// Two fingers turned this far (radians, clockwise positive): the town turns with them.
    func twist(by radians: CGFloat) {
        lock.lock(); goal.yaw += Float(radians); lock.unlock()
        roamed()
    }

    /// Round a quarter at a time (1: to the right), to the next corner that way.
    func turn(_ quarters: Int) {
        lock.lock()
        let step = Float.pi / 2
        let at = (goal.yaw - Self.corner) / step
        goal.yaw = Self.corner + (quarters > 0 ? (at + 1.001).rounded(.down) : (at - 1.001).rounded(.up)) * step
        lock.unlock()
        moved = true
    }

    /// For the simulator: look from this far off, this many quarter turns round from the first corner, at a point this far east and south of where it's looking.
    func peer(distance: Float?, quarters: Float?, east: Float = 0, south: Float = 0) {
        lock.lock()
        if let distance { goal.distance = distance }
        if let quarters { goal.yaw = Self.corner + quarters * .pi / 2 }
        goal.target += SIMD3(east, 0, south)
        eye = goal
        lock.unlock()
        moved = true
        settle()
        changed?()
    }

    /// For the simulator (`--house-gallery 0`): everything in the catalogue that's built in code or comes from
    /// one of the newer packs, set out in rows on bare ground away from the town, twenty to a page, each with
    /// its name, and the camera on them. The pets are on the last page.
    func gallery(page: Int) {
        var seen: Set<HouseItem.Look> = [], items: [HouseItem] = []
        for room in HouseCatalog.everything + [HouseCatalog.outside] { for spot in room.spots { for item in spot.items {
            switch item.look {
            case .made, .model: if seen.insert(item.look).inserted { items.append(item) }
            case .kit(let name, _) where name.first?.isUppercase == true: if seen.insert(item.look).inserted { items.append(item) }
            default: break
            }
        } } }
        let per = 18, columns = 3, gap: Float = 4.4
        // (Up in the air, clear of the hills.)
        let origin = SIMD3<Float>(400, 90, 0)
        let holder = SCNNode()
        holder.name = "gallery"
        let ground = SCNNode(geometry: SCNPlane(width: 60, height: 60))
        ground.geometry?.materials = [HouseLook.plain(HouseLook.color("cfd6c4"), rough: 0.95)]
        ground.simdEulerAngles.x = -.pi / 2
        ground.simdPosition = origin + SIMD3(gap, -0.01, gap * 2.5)
        holder.addChildNode(ground)
        var shown: [(String, SCNNode)] = []
        let slice = items.dropFirst(page * per).prefix(per)
        for item in slice { if let thing = HouseThings.make(item, HouseFinish(), sky: sky) { shown.append((item.id.split(separator: ".").suffix(2).joined(separator: "."), thing)) } }
        if slice.isEmpty {
            let dog = HouseStreetProps.greyhound(), cat = HouseStreetProps.cat()
            for (name, pet) in [("Charlie", dog), ("Pippy", cat)] { HouseLook.physical(pet); shown.append((name, pet)) }
        }
        for (i, entry) in shown.enumerated() {
            let at = origin + SIMD3(Float(i % columns) * gap, 0, Float(i / columns) * gap)
            entry.1.simdPosition = at
            holder.addChildNode(entry.1)
            let label = HouseProps.sign([entry.0])
            HouseLook.physical(label)
            label.simdScale = SIMD3(repeating: 0.55)
            label.simdPosition = at + SIMD3(0, 0.02, 1.9)
            label.simdEulerAngles.x = -.pi / 2
            label.castsShadow = false
            holder.addChildNode(label)
        }
        scene.rootNode.childNode(withName: "gallery", recursively: false)?.removeFromParentNode()
        scene.rootNode.addChildNode(holder)
        print("GALLERY page \(page) of \((items.count + per - 1) / per): \(shown.map(\.0).joined(separator: ", "))")
        lock.lock()
        goal = Eye(target: origin + SIMD3(gap, 0.6, gap * 2.6), yaw: 0.35, distance: 37)
        eye = goal
        lock.unlock()
        moved = true
    }

    /// Where the camera's going.
    var looking: Eye { lock.lock(); defer { lock.unlock() }; return goal }

    /// Fly to the street, a house or a room. From wherever it lands, it can be dragged and pinched away.
    func fly(to: Focus, animated: Bool = true) {
        lock.lock()
        switch to {
        case .street:
            // As it's first shown, from the corner it's first seen from.
            goal = Eye(target: home.target, yaw: nearest(Self.corner, to: goal.yaw), distance: home.distance)
        case .house(let kid):
            // (A house that hasn't arrived yet is built now, to fly to.)
            if built[kid] == nil { lock.unlock(); rebuild(kid); lock.lock() }
            guard let b = built[kid] else { lock.unlock(); return }
            goal.target = b.middle + SIMD3(0, 0.8, 0)
            goal.distance = min(max(b.radius * 3.4, 38), opens - 6)
        case .room(let kid, let room):
            if built[kid] == nil { lock.unlock(); rebuild(kid); lock.lock() }
            guard let b = built[kid], let at = b.middle(of: room), let p = b.all[room] else { lock.unlock(); return }
            floor = p.floor
            goal.target = at + SIMD3(0, 0.8, 0)
            // (Far enough off to take in a big one: the pool, the ball field.)
            let (w, d) = HouseLayout.size(room, p)
            goal.distance = max(18, Float(max(w, d)) * 3.3)
        }
        if !animated { eye = goal }
        lock.unlock()
        beforeLift = nil
        moved = to != .street
        focus = to
        if to == .street { floor = nil }
        wide = false
        present(animated: animated)
        changed?()
    }

    /// Pull right back, to the whole neighbourhood.
    func flyToTown(animated: Bool = true) {
        lock.lock()
        let m = HouseTown.middle
        goal = Eye(target: SIMD3(m.x, 0.8, m.z), yaw: goal.yaw, distance: fit(HouseTown.reach))
        if !animated { eye = goal }
        lock.unlock()
        moved = true
        focus = .street
        floor = nil
        wide = true
        present(animated: animated)
        changed?()
    }

    /// The turn nearest to where the camera is that's the same way round as `yaw`.
    private func nearest(_ yaw: Float, to now: Float) -> Float {
        yaw + ((now - yaw) / (2 * .pi)).rounded() * 2 * .pi
    }

    /// A card's come up over the bottom of the screen for a spot of a room
    /// (or the outside of the house): the room goes up the screen out of its
    /// way, seen from where its things face, with a marker on every spot.
    func lift(_ kid: String, _ room: String, spot: String) {
        guard let b = built[kid] else { return }
        lock.lock()
        if beforeLift == nil { beforeLift = goal }
        var to = goal
        // How much ground the top half of the screen takes in: what's looked at goes to the middle of that.
        func raised(_ at: SIMD3<Float>, _ e: Eye) -> SIMD3<Float> {
            let deep = 2 * e.distance * tan(fov * .pi / 360) / aspect / sin(elevation)
            return at + SIMD3(sin(e.yaw), 0, cos(e.yaw)) * deep * 0.2
        }
        if room == HouseCatalog.outside.id {
            to.yaw = nearest(Self.corner, to: goal.yaw)
            to.distance = min(max(b.radius * 4.6, 46), opens + 20)
            to.target = raised(b.middle + SIMD3(0, 2, 0), to)
        } else if let at = b.middle(of: room), let p = b.all[room] {
            // Its things are against its north and west walls as it's drawn: seen from its south-east, they face the camera.
            // (A yard thing has no walls: it's left as it's being looked at.)
            if !HouseLayout.yard(room) { to.yaw = nearest(Self.corner - Float(p.turn) * .pi / 2, to: goal.yaw) }
            let (w, d) = HouseLayout.size(room, p)
            to.distance = 12 + Float(max(w, d)) * 1.1
            to.target = raised(at + SIMD3(0, 0.8, 0), to)
        }
        goal = to
        lock.unlock()
        lifted = true
        if room == HouseCatalog.outside.id {
            shut = kid
            chosen = nil
            marked = nil
            focus = .house(kid)
        } else {
            shut = nil
            chosen = HouseCatalog.key(room, spot)
            marked = (kid, room)
            focus = .room(kid, room)
            floor = b.all[room]?.floor
        }
        rebuild(kid)
        present(animated: true)
        changed?()
    }

    /// The card's gone: the camera goes back to where it was.
    func drop() {
        guard lifted else { return }
        lifted = false
        chosen = nil
        shut = nil
        let kid = marked?.kid
        marked = nil
        lock.lock()
        if let was = beforeLift { goal = was }
        lock.unlock()
        beforeLift = nil
        if let kid { rebuild(kid) }
        settle()
        changed?()
    }

    /// Show a floor of the open house; a room in hand goes to it.
    func setFloor(_ floor: Int?) {
        self.floor = floor
        if var h = held, let floor, floor != h.plot.floor {
            // It goes to the nearest place on that floor it can stand, if there is one: upstairs, by the landing.
            var to = h.plot
            to.floor = floor
            h.plot = mine?.state.place(for: h.room, on: floor, near: to) ?? to
            held = h
            weigh()
        }
        if let kid = opened, let b = built[kid] {
            lock.lock(); goal.target.y = 0.8 + Float(level(b)) * HousePlan.storey; lock.unlock()
        }
        present(animated: true)
        changed?()
    }

    func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        let dt = Float(min(max(time - last, 0), 0.1))
        last = time
        lock.lock()
        let ease = 1 - exp(-dt * 8)
        eye.target += (goal.target - eye.target) * ease
        eye.yaw += (goal.yaw - eye.yaw) * ease
        eye.distance += (goal.distance - eye.distance) * ease
        let e = eye
        let people = actors
        let shown = lifeFloor
        lock.unlock()
        place(e)
        life.step(dt, showing: shown, facing: e.yaw)
        for who in people {
            who.update(dt)
            who.node.simdEulerAngles.y = .pi + e.yaw
        }
        // Which walls are in the way goes by where the camera's got to.
        let now = HouseVantage.from(yaw: e.yaw, was: sent)
        if now != sent {
            sent = now
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.vantage = now
                self.present(animated: true)
            }
        }
    }

    // MARK: A room in hand

    private var mine: HouseShown? { houses.first(where: \.mine) }

    /// Pick a room up to put it somewhere: one of theirs, or one to buy,
    /// starting where it is or at the nearest place it could go.
    func hold(_ room: String) {
        guard let mine, let b = built[mine.kid] else { return }
        let owned = mine.state.plot(of: room) != nil
        guard let p = mine.state.place(for: room) else { return }
        held = Held(room: room, plot: p, new: !owned, trouble: nil)
        picking = false
        floor = p.floor
        weigh()
        lock.lock()
        goal.target = b.middle + SIMD3(0, 0.8 + Float(p.floor) * HousePlan.storey, 0)
        goal.distance = min(max(goal.distance, 40), opens - 6)
        lock.unlock()
        focus = .house(mine.kid)
        present(animated: true)
        changed?()
    }

    /// Carry the room in hand to under a finger: its middle follows it, a square metre at a time.
    func carry(to point: CGPoint, in view: SCNView) {
        guard var h = held, let mine, let lot = lots[mine.kid],
              let g = ground(point, in: view, y: Float(h.plot.floor) * HousePlan.storey) else { return }
        let (w, d) = HouseLayout.size(h.room, h.plot)
        let x = Int((g.x - lot.x - Float(w) / 2).rounded()), z = Int((g.y - lot.z - Float(d) / 2).rounded())
        guard x != h.plot.x || z != h.plot.z else { return }
        h.plot.x = x; h.plot.z = z
        held = h
        weigh()
        changed?()
    }

    /// Turn the room in hand a quarter, about its middle.
    func turnHeld() {
        guard var h = held else { return }
        let (w, d) = HouseLayout.size(h.room, h.plot)
        // Its footprint swaps across for back: keep its middle where it was.
        h.plot = HousePlot(h.plot.x + (w - d) / 2, h.plot.z + (d - w) / 2, floor: h.plot.floor, turn: h.plot.turn + 1)
        held = h
        weigh()
        changed?()
    }

    /// Put the room in hand down: nothing's changed by it here (the house is built again when it's theirs).
    func letGo() {
        guard held != nil else { return }
        held = nil
        for child in ghost.childNodes { child.removeFromParentNode() }
        settle()
        changed?()
    }

    /// Whether the room in hand can stand where it's held, and show it there: green if it can, red if not.
    private func weigh() {
        for child in ghost.childNodes { child.removeFromParentNode() }
        guard var h = held, let mine, let lot = lots[mine.kid] else { return }
        h.trouble = mine.state.problem(putting: h.room, at: h.plot)?.message(moving: h.room)
        held = h
        let shape = HouseLayout.shape(h.room)
        let (w, d) = HouseLayout.size(h.room, h.plot)
        let m = SCNMaterial()
        m.lightingModel = .constant
        m.diffuse.contents = HouseLook.color(h.trouble == nil ? (shape.yard ? "fff06a" : "3fae5a") : "d64534")
        m.transparency = shape.yard ? 0.6 : 0.45
        m.writesToDepthBuffer = false
        // Its floor, and the two walls its things are against, so it's plain which way it faces.
        let batch = HouseBatch()
        let (W, D) = (Float(shape.width), Float(shape.depth))
        batch.box(SIMD3(0.05, 0, 0.05), SIMD3(W - 0.05, 0.25, D - 0.05), m)
        if shape.yard {
            // A kerb all round it, so it shows on the grass.
            for (lo, hi) in [(SIMD3<Float>(0.05, 0.25, 0.05), SIMD3<Float>(W - 0.05, 0.9, 0.2)), (SIMD3(0.05, 0.25, D - 0.2), SIMD3(W - 0.05, 0.9, D - 0.05)),
                             (SIMD3(0.05, 0.25, 0.2), SIMD3(0.2, 0.9, D - 0.2)), (SIMD3(W - 0.2, 0.25, 0.2), SIMD3(W - 0.05, 0.9, D - 0.2))] {
                batch.box(lo, hi, m)
            }
        } else {
            batch.box(SIMD3(0.05, 0.25, 0.05), SIMD3(W - 0.05, 2.2, 0.25), m)
            batch.box(SIMD3(0.05, 0.25, 0.25), SIMD3(0.25, 2.2, D - 0.05), m)
        }
        // Upstairs with nothing up there yet: where the stairs come up is shown, over the hall, since that's
        // what the first room up there has to touch.
        if h.plot.floor == 1, mine.state.plot(of: HouseLayout.landing) == nil, let entry = mine.state.plot(of: HouseLayout.hall) {
            let (lw, ld) = HouseLayout.size(HouseLayout.hall, entry)
            let pale = SCNMaterial()
            pale.lightingModel = .constant
            pale.diffuse.contents = HouseLook.color("ffffff")
            pale.transparency = 0.7
            pale.writesToDepthBuffer = false
            let mark = HouseBatch()
            mark.box(SIMD3(0.1, 0, 0.1), SIMD3(Float(lw) - 0.1, 0.3, Float(ld) - 0.1), pale)
            let landing = mark.node(shadows: false)
            landing.simdPosition = SIMD3(lot.x + Float(entry.x), HousePlan.storey + 0.03, lot.z + Float(entry.z))
            ghost.addChildNode(landing)
            let sign = HouseProps.sign(["Stairs"])
            sign.enumerateHierarchy { node, _ in node.geometry?.materials.forEach { $0.lightingModel = .constant } }
            sign.simdScale = SIMD3(repeating: 0.9)
            sign.simdPosition = SIMD3(lot.x + Float(entry.x) + Float(lw) / 2, HousePlan.storey + 1.6, lot.z + Float(entry.z) + Float(ld) / 2)
            sign.constraints = [SCNBillboardConstraint()]
            sign.castsShadow = false
            sign.renderingOrder = 95
            ghost.addChildNode(sign)
        }
        let body = batch.node(shadows: false)
        body.simdPosition = SIMD3(-W / 2, 0, -D / 2)
        let turned = SCNNode()
        turned.simdPosition = SIMD3(lot.x + Float(h.plot.x) + Float(w) / 2, Float(h.plot.floor) * HousePlan.storey + 0.03, lot.z + Float(h.plot.z) + Float(d) / 2)
        turned.simdEulerAngles.y = -Float(h.plot.turn) * .pi / 2
        turned.addChildNode(body)
        ghost.addChildNode(turned)
    }

    // MARK: Taps

    /// A thing's been tapped: it jumps, and whoever's nearest comes over to it. A pet says its name.
    func poke(_ kid: String, _ room: String, _ spot: String) {
        let key = HouseCatalog.key(room, spot)
        guard let b = built[kid], let thing = b.node.childNode(withName: "thing:\(key)", recursively: true), thing.action(forKey: "poke") == nil else { return }
        let hop = SCNAction.sequence([.moveBy(x: 0, y: 0.18, z: 0, duration: 0.12), .moveBy(x: 0, y: -0.18, z: 0, duration: 0.14)])
        hop.timingMode = .easeOut
        let wiggle = SCNAction.sequence([.rotateBy(x: 0, y: 0.18, z: 0, duration: 0.08), .rotateBy(x: 0, y: -0.36, z: 0, duration: 0.12), .rotateBy(x: 0, y: 0.18, z: 0, duration: 0.08)])
        thing.runAction(.group([hop, wiggle]), forKey: "poke")
        if let found = HouseCatalog.room(room), let at = found.spot(spot), let item = b.shown.state.item(in: at, of: room), case .pet = item.look {
            life.tag(b.shown.state.names[key] ?? item.name, over: thing, high: 1.1)
        } else {
            life.call(to: room, spot: spot)
        }
    }

    /// Where on a level of the town a point of the screen is.
    private func ground(_ point: CGPoint, in view: SCNView, y: Float) -> SIMD2<Float>? {
        let a = SIMD3<Float>(view.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 0)))
        let b = SIMD3<Float>(view.unprojectPoint(SCNVector3(Float(point.x), Float(point.y), 1)))
        guard abs(b.y - a.y) > 1e-5 else { return nil }
        let t = (y - a.y) / (b.y - a.y)
        guard t > 0 else { return nil }
        let p = a + (b - a) * t
        return SIMD2(p.x, p.z)
    }

    /// What a tap is on: a spot's marker (with the card up); a thing in the
    /// room they're in, which is a tap on its spot; a room of the open
    /// house; or a house.
    func hit(_ point: CGPoint, in view: SCNView) -> Hit? {
        if lifted, let marked, let b = built[marked.kid] {
            var best: (name: String, gap: CGFloat)?
            b.node.enumerateHierarchy { node, _ in
                guard let name = node.name, name.hasPrefix("spot:") else { return }
                let at = view.projectPoint(node.worldPosition)
                let gap = hypot(CGFloat(at.x) - point.x, CGFloat(at.y) - point.y)
                if gap < 36, best == nil || gap < best!.gap { best = (name, gap) }
            }
            if let best {
                let parts = best.name.split(separator: ":").map(String.init)
                if parts.count == 4 { return .spot(parts[1], parts[2], parts[3]) }
            }
        }
        if !lifted, held == nil, !picking, opened != nil {
            // One of the family, anywhere in the open house; or a thing in the room that's in focus.
            if let found = view.hitTest(point, options: [.searchMode: SCNHitTestSearchMode.closest.rawValue]).first {
                if let name = life.who(found.node) { return .person(name) }
                if case .room(let kid, let room) = focus {
                    var node: SCNNode? = found.node
                    while let n = node {
                        if let name = n.name, name.hasPrefix("thing:") {
                            let key = name.dropFirst(6).split(separator: ".").map(String.init)
                            if key.count == 2, key[0] == room { return .thing(kid, room, key[1]) }
                        }
                        node = n.parent
                    }
                }
            }
        }
        if let kid = opened, let b = built[kid], let showing = b.showing,
           let g = ground(point, in: view, y: Float(showing) * HousePlan.storey), let room = b.room(under: g, floor: showing) {
            return .room(kid, room)
        }
        if let g = ground(point, in: view, y: 0) {
            var best: (kid: String, gap: Float)?
            for (kid, b) in built {
                let gap = simd_length(g - SIMD2(b.middle.x, b.middle.z)) - b.radius
                if gap < 1.5, best == nil || gap < best!.gap { best = (kid, gap) }
            }
            if let best { return .house(best.kid) }
        }
        return nil
    }
}
