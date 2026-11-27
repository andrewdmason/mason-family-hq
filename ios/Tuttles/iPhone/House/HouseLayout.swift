import Foundation

// Where the rooms of a house stand, which is up to whoever lives there. A
// house is built on a lot of squares, each the size of a room, and up in
// floors. A room goes anywhere on the lot so long as the house holds
// together:
//
// - on the ground, or on top of another room (never in the air);
// - touching the rest of the house, side by side or one on another;
// - nothing on top of a room with no roof (the garden, the observatory);
// - the basement goes under the house: below a room on the ground, and
//   nothing else goes down there.
//
// A cell is [across, floor, back]: across and back along the lot, and the
// floor, 0 the ground and -1 the basement's.

enum HouseLayout {
    /// How far the lot goes, across and back, either way from the first room.
    static let lot = -2...2
    static let floors = -1...3

    /// Rooms nothing can be put on top of.
    static func roofless(_ room: String) -> Bool { room == "garden" || room == "observatory" }

    static func below(_ cell: [Int]) -> [Int] { [cell[0], cell[1] - 1, cell[2]] }
    static func above(_ cell: [Int]) -> [Int] { [cell[0], cell[1] + 1, cell[2]] }

    static func neighbours(_ cell: [Int]) -> [[Int]] {
        let (x, y, z) = (cell[0], cell[1], cell[2])
        return [[x - 1, y, z], [x + 1, y, z], [x, y, z - 1], [x, y, z + 1], [x, y - 1, z], [x, y + 1, z]]
    }

    /// Whether a house laid out like this holds together.
    static func sound(_ cells: [String: [Int]]) -> Bool {
        var at: [[Int]: String] = [:]
        for (room, cell) in cells {
            guard cell.count == 3, lot.contains(cell[0]), lot.contains(cell[2]), floors.contains(cell[1]),
                  at.updateValue(room, forKey: cell) == nil else { return false }
        }
        for (room, cell) in cells {
            if room == "basement" {
                guard cell[1] == -1, at[above(cell)] != nil else { return false }
            } else if cell[1] < 0 {
                return false
            } else if cell[1] > 0 {
                guard let under = at[below(cell)], !roofless(under) else { return false }
            }
        }
        // All one house: every room reached from any other through the ones it touches.
        guard let start = cells.values.first else { return true }
        var seen: Set<[Int]> = [start], todo = [start]
        while let cell = todo.popLast() {
            for next in neighbours(cell) where at[next] != nil && seen.insert(next).inserted { todo.append(next) }
        }
        return seen.count == cells.count
    }

    /// Every cell this room could go in, with the others where they are.
    /// (If it's in the house already it's lifted out first, so where it is now counts.)
    static func places(for room: String, in cells: [String: [Int]]) -> [[Int]] {
        var others = cells
        others[room] = nil
        var out: [[Int]] = []
        for y in floors { for x in lot { for z in lot {
            var tried = others
            tried[room] = [x, y, z]
            if sound(tried) { out.append([x, y, z]) }
        } } }
        return out
    }

    /// Where each of these rooms stands, in this order: where it was put if
    /// that still holds together, else where the catalogue would have it,
    /// else the first place it fits. A house from before rooms could be
    /// moved, or one that's somehow got into a muddle, comes out sound.
    static func settle(_ rooms: [String], from cells: [String: [Int]]) -> [String: [Int]] {
        var out: [String: [Int]] = [:]
        // The basement needs something on top of it, so it goes after the rest.
        let order = rooms.filter { $0 != "basement" } + rooms.filter { $0 == "basement" }
        for room in order {
            var tried = out
            for cell in [cells[room], HouseCatalog.room(room)?.cell].compactMap({ $0 }) {
                tried[room] = cell
                if sound(tried) { out[room] = cell; break }
            }
            if out[room] == nil, let first = places(for: room, in: out).sorted(by: nearest).first { out[room] = first }
        }
        return out
    }

    /// Nearer the middle of the lot, and lower, first.
    static func nearest(_ a: [Int], _ b: [Int]) -> Bool {
        let da = abs(a[1]) * 10 + abs(a[0]) + abs(a[2]), db = abs(b[1]) * 10 + abs(b[0]) + abs(b[2])
        return da != db ? da < db : a.lexicographicallyPrecedes(b)
    }

    /// A flight of stairs up the outside of the house, to a room on the floor above.
    struct Stairs: Equatable {
        /// The room at the top of them.
        let top: [Int]
        /// Which side of that room they climb: its right (the next square across), or its front (the next back).
        let right: Bool

        /// The empty square they stand in, on the floor they start from.
        var foot: [Int] { right ? [top[0] + 1, top[1] - 1, top[2]] : [top[0], top[1] - 1, top[2] + 1] }
    }

    /// The stairs a house has: one flight up to each floor over the ground,
    /// so there's a way up from the day a floor's first built on. Rooms are
    /// full of their own things, so the stairs go up the outside, beside a
    /// room of that floor where nothing's built, on the side that's open to
    /// whoever's looking: on the lot if they can be, to the right sooner
    /// than the front (where the door is), and nearest the front of the lot.
    /// A floor with no such side has none.
    static func stairs(_ cells: [String: [Int]]) -> [Stairs] {
        let taken = Set(cells.values)
        var out: [Stairs] = []
        for floor in Set(cells.values.map { $0[1] }).sorted() where floor > 0 {
            var best: (stairs: Stairs, rank: [Int])?
            for top in cells.values where top[1] == floor {
                for right in [true, false] {
                    let stairs = Stairs(top: top, right: right)
                    let foot = stairs.foot
                    // Nothing built in that square: on the ground, so on no floor of it.
                    guard !taken.contains([foot[0], 0, foot[2]]) else { continue }
                    let rank = [lot.contains(foot[0]) && lot.contains(foot[2]) ? 0 : 1, right ? 0 : 1, -(top[0] + top[2]), top[0]]
                    if best == nil || rank.lexicographicallyPrecedes(best!.rank) { best = (stairs, rank) }
                }
            }
            if let best { out.append(best.stairs) }
        }
        return out
    }

    /// What a floor's called.
    static func name(of floor: Int) -> String {
        switch floor {
        case -1: "Basement"
        case 0: "Ground"
        default: "Floor \(floor + 1)"
        }
    }
}
