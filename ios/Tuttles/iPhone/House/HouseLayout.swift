import Foundation

// Where the rooms of a house stand, which is up to whoever lives there. Each
// kind of room is its own size, a rectangle of square metres, and goes
// anywhere on the lot, turned any of four ways, upstairs or down, so long as
// the house holds together (`problem`):
//
// - nothing off the lot, and no two rooms in one place;
// - upstairs, a room under every square of it (and not the garden or the
//   observatory, which have no roof to stand on);
// - the basement under the hall, where the stairs go down to it;
// - the front door opening outdoors;
// - and a door into every room: one's made wherever two rooms share a metre
//   of wall that both keep clear, so a room has to meet another along such a
//   stretch.
//
// Every house has a hall. The front door's in it and so are the stairs, and
// once there's a room upstairs there's a landing over it. Neither is bought.
//
// A room's furniture is against its north and west walls as it's drawn (the
// catalogue's "right" and "left"), which leaves the east and south sides
// open: a door can go anywhere along those, and in the last metre of the
// other two.

enum HouseSide: Int, CaseIterable {
    case north, east, south, west

    /// Where this side is once its room's turned that many quarters clockwise.
    func turned(_ quarters: Int) -> HouseSide { HouseSide(rawValue: (rawValue + quarters) & 3)! }
}

/// A metre of one of a room's walls, counted from the wall's west or north end, with the room as it's drawn.
struct HouseWall: Hashable {
    let side: HouseSide
    let at: Int

    static func run(_ side: HouseSide, _ range: Range<Int>) -> [HouseWall] { range.map { HouseWall(side: side, at: $0) } }
}

struct HouseCell: Hashable {
    let x: Int
    let z: Int
}

/// Where a room stands: its north-west corner on the lot once turned, its floor (0 the ground, -1 the basement's), and its quarter turns clockwise.
struct HousePlot: Hashable {
    var x: Int
    var z: Int
    var floor = 0
    var turn = 0

    init(_ x: Int, _ z: Int, floor: Int = 0, turn: Int = 0) {
        self.x = x; self.z = z; self.floor = floor; self.turn = turn & 3
    }

    /// As it's kept: [x, z, floor, turn].
    init?(_ kept: [Int]) {
        guard kept.count == 4 else { return nil }
        self.init(kept[0], kept[1], floor: kept[2], turn: kept[3])
    }

    var kept: [Int] { [x, z, floor, turn] }
}

struct HouseShape {
    /// What it is on the plan's map.
    let letter: Character
    /// Across (west to east) and back (north to south) as it's drawn, in metres.
    let width: Int
    let depth: Int
    /// The metres of wall kept clear, where a door can go.
    var doors: [HouseWall]
    /// Where it has a window, if that wall's an outside one.
    var windows: [HouseWall]
    /// The hall's: where the front door is.
    var frontDoor: HouseWall?
    /// Open to the rooms it joins: between two such there's an arch, not a door.
    var open = false
    /// Nothing can be built on it.
    var roofless = false
    /// Out of doors: fenced, not walled.
    var outdoor = false
    /// The squares the stairs take: under them in the hall, and where they come up through the landing.
    var stairs: [HouseCell] = []
    /// How far its spots, written for a room four metres square, are spread to fill it.
    var stretch: (x: Float, z: Float)

    /// An ordinary room: things against its north and west walls, the rest clear.
    static func room(_ letter: Character, _ width: Int, _ depth: Int, open: Bool = false, roofless: Bool = false, outdoor: Bool = false) -> HouseShape {
        let doors = [HouseWall(side: .north, at: width - 1), HouseWall(side: .west, at: depth - 1)]
            + HouseWall.run(.south, 0..<width) + HouseWall.run(.east, 0..<depth)
        let windows = outdoor ? [] : [HouseWall(side: .south, at: 1), HouseWall(side: .south, at: width - 2),
                                      HouseWall(side: .east, at: 1), HouseWall(side: .east, at: depth - 2)]
        return HouseShape(letter: letter, width: width, depth: depth, doors: doors, windows: windows, open: open, roofless: roofless,
                          outdoor: outdoor, stretch: (Float(width - 1) / 4, Float(depth - 1) / 4))
    }
}

enum HouseLayout {
    /// The lot, in metres.
    static let width = 20
    static let depth = 20
    static let floors = -1...1

    static let hall = "hall"
    static let landing = "landing"
    static let basement = "basement"
    /// Always there, never bought.
    static func fixture(_ room: String) -> Bool { room == hall || room == landing }

    /// The stairs, in the hall as it's drawn: along its west wall, climbing north.
    private static let flight = [HouseCell(x: 0, z: 1), HouseCell(x: 0, z: 2), HouseCell(x: 0, z: 3)]
    /// (Not the last metre of its east wall or its south one: something stands in that corner.)
    private static let passage = HouseWall.run(.north, 0..<3) + HouseWall.run(.east, 0..<4) + [HouseWall(side: .west, at: 0)]

    static let shapes: [String: HouseShape] = [
        hall: HouseShape(letter: "H", width: 3, depth: 5, doors: passage,
                         windows: [], frontDoor: HouseWall(side: .south, at: 1), open: true, stairs: flight, stretch: (1, 1)),
        landing: HouseShape(letter: "N", width: 3, depth: 5, doors: passage,
                            windows: [HouseWall(side: .south, at: 1)], open: true, stairs: flight, stretch: (1, 1)),
        "bedroom": .room("S", 5, 5),
        "living": .room("L", 6, 6, open: true),
        "kitchen": .room("K", 5, 5, open: true),
        "bathroom": .room("B", 4, 4),
        "den": .room("D", 6, 5),
        "garden": .room("G", 6, 6, roofless: true, outdoor: true),
        basement: .room("C", 6, 5),
        "observatory": .room("O", 5, 5, roofless: true),
    ]

    static func shape(_ room: String) -> HouseShape { shapes[room] ?? .room("X", 5, 5) }

    /// The house as it comes: where every room stands until someone moves it, and all of Mom & Dad's.
    static let home: [String: HousePlot] = [
        hall: HousePlot(9, 10),
        "bedroom": HousePlot(4, 10),
        "living": HousePlot(6, 4),
        "kitchen": HousePlot(12, 9),
        "bathroom": HousePlot(12, 5),
        "garden": HousePlot(0, 4),
        "den": HousePlot(6, 5, floor: 1),
        "observatory": HousePlot(4, 10, floor: 1),
        basement: HousePlot(7, 10, floor: -1),
    ]

    static func name(_ room: String) -> String { HouseCatalog.room(room)?.name ?? room.capitalized }

    static func name(of floor: Int) -> String { floor < 0 ? "Basement" : floor == 0 ? "Downstairs" : "Upstairs" }

    // MARK: Where a room is

    /// How far across and back a room goes once it's turned.
    static func size(_ room: String, _ p: HousePlot) -> (width: Int, depth: Int) {
        let s = shape(room)
        return p.turn & 1 == 0 ? (s.width, s.depth) : (s.depth, s.width)
    }

    /// A square of a room as it's drawn, to where that is on the lot.
    static func cell(_ room: String, _ p: HousePlot, _ local: HouseCell) -> HouseCell {
        var (x, z, d) = (local.x, local.z, shape(room).depth)
        var w = shape(room).width
        for _ in 0..<(p.turn & 3) {
            // A quarter turn clockwise: its north wall becomes its east one.
            (x, z) = (d - 1 - z, x)
            (w, d) = (d, w)
        }
        return HouseCell(x: p.x + x, z: p.z + z)
    }

    static func cells(_ room: String, _ p: HousePlot) -> [HouseCell] {
        let (w, d) = size(room, p)
        return (0..<d).flatMap { z in (0..<w).map { x in HouseCell(x: p.x + x, z: p.z + z) } }
    }

    /// A metre of a room's wall, to the edge of the plan it's on.
    static func edge(_ room: String, _ p: HousePlot, _ wall: HouseWall) -> HousePlan.Edge {
        let s = shape(room)
        let local: HouseCell
        switch wall.side {
        case .north: local = HouseCell(x: wall.at, z: 0)
        case .south: local = HouseCell(x: wall.at, z: s.depth - 1)
        case .west: local = HouseCell(x: 0, z: wall.at)
        case .east: local = HouseCell(x: s.width - 1, z: wall.at)
        }
        let c = cell(room, p, local)
        switch wall.side.turned(p.turn) {
        case .north: return HousePlan.Edge(x: c.x, z: c.z, across: true)
        case .south: return HousePlan.Edge(x: c.x, z: c.z + 1, across: true)
        case .west: return HousePlan.Edge(x: c.x, z: c.z, across: false)
        case .east: return HousePlan.Edge(x: c.x + 1, z: c.z, across: false)
        }
    }

    /// Everything standing in a house: its rooms where they've been put, the
    /// hall, and the landing over the hall once anything's upstairs.
    static func standing(_ rooms: [String], _ plots: [String: HousePlot]) -> [String: HousePlot] {
        var out: [String: HousePlot] = [:]
        for room in rooms where !fixture(room) { out[room] = plots[room] ?? home[room] ?? HousePlot(0, 0) }
        var entry = plots[hall] ?? home[hall]!
        entry.floor = 0
        out[hall] = entry
        if out.values.contains(where: { $0.floor > 0 }) {
            entry.floor = 1
            out[landing] = entry
        }
        return out
    }

    /// Which room is on a square of a floor.
    static func room(at cell: HouseCell, floor: Int, in all: [String: HousePlot]) -> String? {
        all.first { $0.value.floor == floor && cells($0.key, $0.value).contains(cell) }?.key
    }

    // MARK: The doors between rooms

    /// Every pair of rooms on a floor with a way between them, and the metre
    /// of wall the door's in: the middle one of those both keep clear.
    static func doorways(_ all: [String: HousePlot], floor: Int) -> [(a: String, b: String, edge: HousePlan.Edge)] {
        let here = all.keys.filter { all[$0]!.floor == floor }.sorted()
        var clear: [String: Set<HousePlan.Edge>] = [:]
        for room in here { clear[room] = Set(shape(room).doors.map { edge(room, all[room]!, $0) }) }
        var out: [(String, String, HousePlan.Edge)] = []
        for (n, a) in here.enumerated() {
            for b in here.dropFirst(n + 1) {
                let both = clear[a]!.intersection(clear[b]!).sorted { ($0.x, $0.z) < ($1.x, $1.z) }
                if !both.isEmpty { out.append((a, b, both[both.count / 2])) }
            }
        }
        return out
    }

    // MARK: Whether it holds together

    enum Problem: Equatable {
        case offTheLot(String)
        case overlap(String, String)
        case wrongFloor(String)
        case nothingUnder(String)
        case underStairs
        case frontDoor
        case noWayIn(String)

        /// Said to whoever's moving `moving`.
        func message(moving: String? = nil) -> String {
            switch self {
            case .offTheLot(let room): return "The \(HouseLayout.name(room).lowercased()) would be off the lot."
            case .overlap(let a, let b):
                let other = a == moving ? b : a
                return "The \(HouseLayout.name(other).lowercased()) is there."
            case .wrongFloor(let room):
                return room == HouseLayout.basement ? "The basement goes under the house." : "The \(HouseLayout.name(room).lowercased()) can't go on that floor."
            case .nothingUnder(let room):
                if let moving, moving != room { return "The \(HouseLayout.name(room).lowercased()) is on top of it. Move that first." }
                return "The \(HouseLayout.name(room).lowercased()) needs a room under all of it."
            case .underStairs: return "The basement goes under the stairs in the hall."
            case .frontDoor: return "The front door has to open outdoors."
            case .noWayIn(let room): return "There'd be no door into the \(HouseLayout.name(room).lowercased())."
            }
        }
    }

    /// What's wrong with a house as it stands, if anything. (`all` is everything standing: `standing`.)
    static func problem(_ all: [String: HousePlot]) -> Problem? {
        let rooms = all.keys.sorted()
        var squares: [String: Set<HouseCell>] = [:]
        for room in rooms {
            let p = all[room]!
            let (w, d) = size(room, p)
            if p.x < 0 || p.z < 0 || p.x + w > width || p.z + d > depth { return .offTheLot(room) }
            let allowed: ClosedRange<Int> = room == basement ? -1...(-1) : room == hall ? 0...0 : room == landing ? 1...1 : 0...1
            if !allowed.contains(p.floor) { return .wrongFloor(room) }
            squares[room] = Set(cells(room, p))
        }
        for (n, a) in rooms.enumerated() {
            for b in rooms.dropFirst(n + 1) where all[a]!.floor == all[b]!.floor {
                if !squares[a]!.isDisjoint(with: squares[b]!) { return .overlap(a, b) }
            }
        }
        // Upstairs, every square of a room has a roofed room under it.
        var ground: Set<HouseCell> = []
        for room in rooms where all[room]!.floor == 0 && !shape(room).roofless { ground.formUnion(squares[room]!) }
        for room in rooms where all[room]!.floor == 1 && !squares[room]!.isSubset(of: ground) { return .nothingUnder(room) }
        if let entry = all[hall] {
            // The basement's under the stairs that go down to it.
            if let below = squares[basement], !Set(shape(hall).stairs.map { cell(hall, entry, $0) }).isSubset(of: below) { return .underStairs }
            // The front door opens onto the open.
            if let front = shape(hall).frontDoor {
                let e = edge(hall, entry, front)
                let beyond = [HouseCell(x: e.x, z: e.z), e.across ? HouseCell(x: e.x, z: e.z - 1) : HouseCell(x: e.x - 1, z: e.z)]
                let taken = rooms.filter { all[$0]!.floor == 0 }.reduce(into: Set<HouseCell>()) { $0.formUnion(squares[$1]!) }
                if beyond.allSatisfy(taken.contains) { return .frontDoor }
            }
        }
        // Every room can be walked to from the stairs: the hall downstairs, the landing above.
        for (floor, start) in [(0, hall), (1, landing)] {
            let here = rooms.filter { all[$0]!.floor == floor }
            guard here.contains(start) else {
                if let lost = here.first { return .noWayIn(lost) }
                continue
            }
            let ways = doorways(all, floor: floor)
            var seen: Set<String> = [start], todo = [start]
            while let at = todo.popLast() {
                for way in ways where way.a == at || way.b == at {
                    let next = way.a == at ? way.b : way.a
                    if seen.insert(next).inserted { todo.append(next) }
                }
            }
            if let lost = here.first(where: { !seen.contains($0) }) { return .noWayIn(lost) }
        }
        return nil
    }

    // MARK: Putting a house together

    private static func fits(_ room: String, _ p: HousePlot, in placed: [String: HousePlot]) -> Bool {
        var trial = placed
        trial[room] = p
        return problem(standing(Array(trial.keys), trial)) == nil
    }

    /// The nearest place to where a room would be in the house as it comes
    /// that it can go, with the rest where they are. Nil if there's nowhere.
    static func place(for room: String, in placed: [String: HousePlot]) -> HousePlot? {
        let wish = home[room] ?? HousePlot(8, 8)
        let levels = room == basement ? [-1] : wish.floor == 1 ? [1, 0] : [0, 1]
        let (w, d) = (shape(room).width, shape(room).depth)
        var tries: [(Int, HousePlot)] = []
        for (rank, floor) in levels.enumerated() {
            for turn in 0..<4 {
                let (across, back) = turn & 1 == 0 ? (w, d) : (d, w)
                for z in 0...(depth - back) {
                    for x in 0...(width - across) {
                        let far = (x - wish.x) * (x - wish.x) + (z - wish.z) * (z - wish.z)
                        tries.append((far + turn * 3 + rank * 400, HousePlot(x, z, floor: floor, turn: turn)))
                    }
                }
            }
        }
        for (_, p) in tries.sorted(by: { $0.0 < $1.0 }) where fits(room, p, in: placed) { return p }
        return nil
    }

    /// Every room somewhere, and the house in one piece: each where it was
    /// if that still works, else where it'd be in the house as it comes,
    /// else the nearest place that does. (What comes back has the hall in
    /// it, and not the landing, which goes where the hall goes.)
    static func settle(_ rooms: [String], from saved: [String: HousePlot]) -> [String: HousePlot] {
        var wanted = [hall]
        for room in rooms where !fixture(room) && !wanted.contains(room) { wanted.append(room) }
        // As it was left, if that holds together.
        let kept = saved.filter { wanted.contains($0.key) }
        if kept.count == wanted.count, problem(standing(wanted, kept)) == nil { return kept }

        var out: [String: HousePlot] = [:]
        out[hall] = saved[hall].flatMap { fits(hall, $0, in: [:]) ? $0 : nil } ?? home[hall]!
        var waiting = Array(wanted.dropFirst())
        // First whatever can stay, or go where it comes: over and over, since one room's door may be into another.
        var moved = true
        while moved {
            moved = false
            for room in waiting {
                guard let p = [saved[room], home[room]].compactMap({ $0 }).first(where: { fits(room, $0, in: out) }) else { continue }
                out[room] = p
                waiting.removeAll { $0 == room }
                moved = true
            }
        }
        // Then the rest, wherever's nearest. (The basement last: it goes under what's there.)
        for room in waiting.sorted(by: { ($0 == basement ? 1 : 0) < ($1 == basement ? 1 : 0) }) {
            out[room] = place(for: room, in: out) ?? home[room] ?? HousePlot(0, 0)
        }
        return out
    }

    // MARK: The plan

    /// The house as a plan to draw: its rooms on the map, and what's in
    /// their walls. `look` is each room's paint and floor.
    static func plan(_ all: [String: HousePlot], look: (String) -> HousePlan.Room) -> HousePlan {
        var plan = HousePlan()
        let rooms = all.keys.sorted()
        let levels = rooms.map { all[$0]!.floor }
        plan.lowest = levels.min() ?? 0
        let below = all[basement] != nil
        for room in rooms {
            var made = look(room)
            made.outdoor = shape(room).outdoor
            plan.rooms[shape(room).letter] = made
        }
        for f in plan.lowest...(levels.max() ?? 0) {
            var grid = Array(repeating: Array(repeating: Character("."), count: width), count: depth)
            var outdoor: Set<Character> = []
            for room in rooms where all[room]!.floor == f {
                let s = shape(room), p = all[room]!
                if s.outdoor { outdoor.insert(s.letter) }
                // Where the stairs come up through the landing, and go down through the hall when there's a basement.
                let open = room == landing || (room == hall && below) ? Set(s.stairs.map { cell(room, p, $0) }) : []
                for c in cells(room, p) where grid.indices.contains(c.z) && grid[c.z].indices.contains(c.x) {
                    grid[c.z][c.x] = open.contains(c) ? Character(s.letter.lowercased()) : s.letter
                }
            }
            var floor = HousePlan.Floor(rows: grid.map { String($0) }, outdoor: outdoor)
            for way in doorways(all, floor: f) {
                // Out into the garden is through a door; between two open rooms there's just an arch.
                let arch = [way.a, way.b].allSatisfy { shape($0).open }
                floor.openings[way.edge] = arch ? .arch : .door(front: false)
            }
            for room in rooms where all[room]!.floor == f {
                let s = shape(room), p = all[room]!
                if f == 0, let front = s.frontDoor { floor.openings[edge(room, p, front)] = .door(front: true) }
                guard f >= 0, !s.outdoor else { continue }
                for wall in s.windows {
                    let e = edge(room, p, wall)
                    let (a, b) = floor.sides(e)
                    if floor.openings[e] == nil, floor.indoor(a) != floor.indoor(b) { floor.openings[e] = .window(0.9, 2.1) }
                }
            }
            plan.floors.append(floor)
        }
        return plan
    }
}
