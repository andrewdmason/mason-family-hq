import Foundation

// The house as a floor plan. Each floor is a map, a letter a square metre and
// a letter a room, so a room is whatever shape its letters make. Walls aren't
// drawn on it: there's one wherever two different rooms meet, or a room meets
// the outdoors ("."). A lower-case letter is a part of its room with no floor
// in it, where the stairs come through.
//
// The walls stand on the lines of the map. An edge is a metre of one: across
// (from (x, z) east, with the square north of it and the square south), or
// down (from (x, z) south, with the square west of it and the one east).
// Doors, arches and windows are edges that have something in them.
//
// Where the rooms are is up to whoever lives there (HouseLayout.swift), and
// the plan is worked out from that.

struct HousePlan {
    struct Room: Equatable {
        let id: String
        /// The colour of its walls and of their skirting, and what's on the floor: a pattern and two colours.
        var paint = "f3ead2"
        var skirting = "c9b78f"
        /// Wallpaper, if it has any: a pattern and its two colours (the first is `paint`, which is what shows outdoors).
        var paper: [String]?
        var flooring = ["boards", "c98f55", "a8733f"]
        /// Out of doors, though it's a room: the garden. It has a fence, not walls, and the house's walls stand between it and the rooms.
        var outdoor = false
    }

    struct Edge: Hashable {
        let x: Int
        let z: Int
        /// Running east from (x, z); otherwise south from it.
        let across: Bool
    }

    enum Opening: Equatable {
        /// A door in its frame. `front`: the front door.
        case door(front: Bool)
        /// A gap up to the head of a door, with no door in it.
        case arch
        /// Glass from the sill up to the top, in metres.
        case window(Float, Float)
    }

    struct Floor {
        let rows: [String]
        var openings: [Edge: Opening] = [:]
        /// The letters of rooms that are out of doors.
        var outdoor: Set<Character> = []

        var width: Int { rows.map(\.count).max() ?? 0 }
        var depth: Int { rows.count }

        /// The letter at a square as written; "." for anywhere off the map.
        func letter(_ x: Int, _ z: Int) -> Character {
            guard rows.indices.contains(z), x >= 0 else { return "." }
            let row = Array(rows[z])
            return row.indices.contains(x) ? row[x] : "."
        }

        /// The room a square is part of; nil where there's none.
        func room(_ x: Int, _ z: Int) -> Character? {
            let c = letter(x, z)
            return c == "." ? nil : Character(c.uppercased())
        }

        /// Whether there's floor to stand on there (a room, and not where stairs come through).
        func floored(_ x: Int, _ z: Int) -> Bool {
            let c = letter(x, z)
            return c != "." && c.isUppercase
        }

        /// Whether a room's one with walls and a roof: not the garden, and not nothing.
        func indoor(_ room: Character?) -> Bool { room.map { !outdoor.contains($0) } ?? false }

        /// The rooms either side of an edge: north and south of one running across, west and east of one running down.
        func sides(_ e: Edge) -> (Character?, Character?) {
            e.across ? (room(e.x, e.z - 1), room(e.x, e.z)) : (room(e.x - 1, e.z), room(e.x, e.z))
        }

        /// Every metre of wall (or fence) on this floor.
        var walls: [Edge] {
            var out: [Edge] = []
            for z in 0...depth {
                for x in 0...width {
                    for across in [true, false] {
                        let e = Edge(x: x, z: z, across: across)
                        let (a, b) = sides(e)
                        if a != b { out.append(e) }
                    }
                }
            }
            return out
        }

        /// A metre of fence, not wall: between the garden and the open.
        func fence(_ e: Edge) -> Bool {
            let (a, b) = sides(e)
            return a != b && !indoor(a) && !indoor(b)
        }
    }

    var rooms: [Character: Room] = [:]
    var floors: [Floor] = []
    /// The number of the lowest floor in `floors`: 0, or -1 with a basement.
    var lowest = 0

    func floor(_ number: Int) -> Floor? {
        let i = number - lowest
        return floors.indices.contains(i) ? floors[i] : nil
    }

    /// The floors there are, lowest first.
    var numbers: [Int] { floors.indices.map { $0 + lowest } }

    /// From floor to ceiling, and the thickness of the floor above.
    static let height: Float = 2.7
    static let slab: Float = 0.2
    /// From one floor up to the next.
    static var storey: Float { height + slab }
    static let thickness: Float = 0.14
    /// How much of a wall is left when it's cut down to see over, and how high a garden's fence is.
    static let stub: Float = 0.2
    static let fence: Float = 1.0
    /// The head of a door or an arch.
    static let head: Float = 2.1
}

/// Where a house is being looked at from, as far as its walls care: east or
/// west of it (1, -1) or neither, and south or north of it.
struct HouseVantage: Hashable {
    var x: Int
    var z: Int

    /// Nothing cut down: a house that's shut, or a floor with another shown on top of it.
    static let shut = HouseVantage(x: 0, z: 0)
    /// Everything cut down, whichever side it's seen from: for looking over the house at what's in the yard.
    static let flat = HouseVantage(x: 9, z: 9)

    /// Looking from `yaw` (0 from the south, a quarter turn from the east),
    /// given what it was: a side comes down a little after the camera's
    /// round it and goes back up a little after it's left, so it doesn't
    /// flicker at the turn.
    static func from(yaw: Float, was: HouseVantage?) -> HouseVantage {
        func side(_ c: Float, _ was: Int?) -> Int {
            let (on, off): (Float, Float) = (0.38, 0.22)
            if let was, was != 0, c * Float(was) > off { return was }
            return c > on ? 1 : c < -on ? -1 : 0
        }
        return HouseVantage(x: side(sin(yaw), was?.x), z: side(cos(yaw), was?.z))
    }
}

extension HousePlan.Floor {
    /// Whether a wall is cut down, seen from there. A wall comes down when
    /// there's a room behind it: an outside wall when the camera's on its
    /// outdoor side, and any wall between two rooms. But the room being
    /// looked into (`focus`) keeps the walls at its back, whatever's behind
    /// them, so there's somewhere for its pictures to hang. A fence is
    /// always as it is.
    func lowered(_ e: HousePlan.Edge, from view: HouseVantage, focus: Character? = nil) -> Bool {
        if view == .shut || fence(e) { return false }
        if view == .flat { return true }
        let (a, b) = sides(e)
        // Which side of this wall the camera's on: 1 south or east of it, -1 north or west.
        let camera = e.across ? view.z : view.x
        if indoor(a) && indoor(b) {
            // `a` is north or west of the wall, `b` south or east: the wall's at the back of whichever the camera's beyond.
            if let focus, (b == focus && camera == 1) || (a == focus && camera == -1) { return false }
            return true
        }
        // Outdoors (or the garden) is north or west of it, or south or east.
        let outward = indoor(a) ? 1 : -1
        return camera == outward
    }
}
