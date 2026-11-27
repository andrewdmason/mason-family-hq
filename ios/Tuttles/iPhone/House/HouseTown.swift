import SceneKit
import UIKit

// The neighbourhood the houses stand in, after the family's own street in
// Berkeley: Avalon Ave winding from the turning circle at its west end out to
// Oak Knoll, inside four straight streets (Kelsey, Garber, Oak Knoll,
// Russell). Mom & Dad's house is up a drive at the top of the turning circle,
// ready-made, the biggest on the street, and anyone can look round it. Oscar's
// lot is on the west of the circle and Sebastian's two doors east of Mom &
// Dad's. The rest are neighbours' houses (shut, nobody's to open), the big
// place with the pool behind, Monkey Island Park in the corner, and three
// lots with nothing on them yet, for buying later. Past the four streets
// it's trees and hills.
//
// x is east and z is south, from the middle of the turning circle. The
// camera looks from the south-east and never turns, so a house's front door
// (HouseStage.frontDoor: on the side nearest whoever's looking) is on its
// south side: the houses north of Avalon open onto it, and those south of it
// open onto Russell.

enum HouseTown {
    // MARK: The plan

    static let roadWidth: Float = 5
    /// The pavement along each side of a road.
    static let walk: Float = 0.9
    /// The turning circle at the west end of Avalon.
    static let bulb: Float = 8
    /// The middles of the four streets round the outside.
    static let west: Float = -42, east: Float = 104, north: Float = -68, south: Float = 36
    /// The footpath from the turning circle out to Kelsey, as Palm Ct's is.
    static let palm: Float = 5

    /// How far south Avalon's middle is, this far east of the turning circle.
    static func avalon(_ x: Float) -> Float { 5 * sin(2 * .pi * x / east) }

    static let middle = SIMD3<Float>((west + east) / 2, 0, (north + south) / 2)

    /// The corners of all of it, to frame it by.
    static var corners: [SIMD3<Float>] {
        let pad: Float = 7
        return [SIMD3(west - pad, 0, north - pad), SIMD3(east + pad, 0, north - pad), SIMD3(west - pad, 0, south + pad), SIMD3(east + pad, 6, south + pad)]
    }

    /// A point of the ground, brought back to the town if it's off the edge of it.
    static func kept(_ p: SIMD3<Float>) -> SIMD3<Float> {
        let pad: Float = 12
        return SIMD3(min(max(p.x, west - pad), east + pad), p.y, min(max(p.z, north - pad), south + pad))
    }

    /// What a lot's front door opens towards.
    enum Front: Equatable { case avalon, bulb, palm, russell }

    /// A piece of ground a house stands on: its north-west corner, and how big it is.
    struct Lot: Equatable {
        let x: Float, z: Float
        var wide: Float = HouseLand.lotSize, deep: Float = HouseLand.lotSize
        let front: Front

        /// Where a house on it stands: its first room's corner, the lot going HouseLayout.lot either way from there.
        var origin: SIMD3<Float> { SIMD3(x - HouseLand.lotStart, 0, z - HouseLand.lotStart) }

        /// How far south a path from a door at `x` runs before it meets what the lot fronts.
        func frontZ(at x: Float) -> Float {
            switch front {
            case .avalon: HouseTown.avalon(x) - HouseTown.roadWidth / 2
            case .bulb: -HouseTown.bulb + 2
            case .palm: HouseTown.palm - 0.5
            case .russell: HouseTown.south - HouseTown.roadWidth / 2
            }
        }
    }

    static let parentsLot = Lot(x: -10, z: -36, front: .bulb)
    static let sebastian = Lot(x: 32, z: -24, front: .avalon)
    static let oscar = Lot(x: -32, z: -18, front: .palm)
    /// Nothing on them yet: the one north of Avalon first.
    static let spare = [Lot(x: 74, z: -32, front: .avalon), Lot(x: 31, z: 10.5, front: .russell), Lot(x: 73, z: 8, front: .russell)]

    /// Which lot each house stands on: Mom & Dad's, Sebastian's and Oscar's
    /// on their own, and anyone else (the demo, a parent playing as
    /// themselves) on the first that's free.
    static func lots(for houses: [(kid: String, name: String)]) -> [String: Lot] {
        var out: [String: Lot] = [:], free = [sebastian, oscar] + spare
        for house in houses {
            let name = house.name.lowercased()
            var lot: Lot?
            if house.kid == parentsID { lot = parentsLot }
            else if name.hasPrefix("sebastian"), free.contains(sebastian) { lot = sebastian }
            else if name.hasPrefix("oscar"), free.contains(oscar) { lot = oscar }
            guard let lot else { continue }
            out[house.kid] = lot
            free.removeAll { $0 == lot }
        }
        for house in houses where out[house.kid] == nil {
            let lot = free.first ?? spare[spare.count - 1]
            out[house.kid] = lot
            free.removeAll { $0 == lot }
        }
        return out
    }

    // MARK: Mom & Dad's

    static let parentsID = "parents"

    /// Mom & Dad's house: every room there is, each with something in every
    /// spot. Nobody builds it; it's there to look round.
    static let parents: HouseShown = {
        var state = HouseState()
        state.cells = ["living": [1, 0, 0], "kitchen": [0, 0, 0], "garden": [-1, 0, 0], "den": [1, 0, -1], "bathroom": [0, 0, -1],
                       "bedroom": [1, 1, -1], "observatory": [0, 1, -1], "basement": [1, -1, 0]]
        state.rooms = ["living", "kitchen", "garden", "den", "bathroom", "bedroom", "observatory", "basement"]
        for (r, room) in HouseCatalog.rooms.enumerated() {
            for (s, spot) in room.spots.enumerated() where !spot.items.isEmpty {
                // Not the first thing in every spot, nor the dearest: a mix.
                var item = spot.items[(r + s) % min(spot.items.count, 3)]
                // (And a big bed, not bunks.)
                if room.id == "bedroom", spot.id == "bed", let double = spot.items.first(where: { $0.id == "bedroom.bed.double" }) { item = double }
                state.owned.append(item.id)
                state.placed[HouseCatalog.key(room.id, spot.id)] = item.id
            }
        }
        let dad = MathLook(head: "male-e", body: "male-a", hair: "5a3b22", skin: "f1c6a0", top: "3b5b7a", bottom: "3a3f4a", shoes: "f2f2f2")
        let mom = MathLook(head: "female-b", body: "female-a", hair: "8a5a34", skin: "f3c9a8", top: "c9566b", bottom: "2f3b55", shoes: "f2f2f2")
        return HouseShown(kid: parentsID, name: "Mom & Dad", mine: false, state: state, look: dad, partner: mom)
    }()

    /// The way from a house's front door down to the street, in the house's
    /// own space: a path, or for Mom & Dad's a drive up from the turning circle.
    static func path(from door: [Int], on lot: Lot) -> SCNNode {
        let S = HouseCatalog.side
        let wide: Float = lot.front == .bulb ? 3 : 1.4
        let x = Float(door[0]) * S + S * 0.3, z0 = Float(door[2]) * S + S + 0.3
        let z1 = lot.frontZ(at: lot.origin.x + x) - lot.origin.z
        let node = SCNNode()
        guard z1 > z0 else { return node }
        let slab = MathShape.floor(wide, z1 - z0, flat("e4ddcb"))
        slab.castsShadow = false
        node.add(slab, x, walkY, (z0 + z1) / 2)
        return node
    }

    // MARK: The land

    /// How high each layer of the ground lies, so none flickers with another.
    private static let lawnY: Float = -0.037, walkY: Float = -0.033, kerbY: Float = -0.029, roadY: Float = -0.025, paintY: Float = -0.021

    /// Everything that's always there: the grass, the roads, the neighbours, the trees and the hills.
    static func land() -> SCNNode {
        let land = SCNNode()
        land.name = "land"
        for part in [grass(), roads(), lawns(), neighbours(), estate(), park(), hills(), trees()] { land.addChildNode(part) }
        return land
    }

    private static var flats: [String: SCNMaterial] = [:]

    /// A flat colour seen from either side, for what lies on the ground.
    private static func flat(_ hex: String) -> SCNMaterial {
        if let hit = flats[hex] { return hit }
        let m = SCNMaterial()
        m.lightingModel = .lambert
        m.diffuse.contents = MathLookKit.color(hex)
        m.isDoubleSided = true
        flats[hex] = m
        return m
    }

    private static func grass() -> SCNNode {
        let size: Float = 1800, tile: Float = 24
        let material = MathMat.drawn("house-grass", 512, 512, u: size / tile, v: size / tile) { c, s in
            c.setFillColor(MathLookKit.color("8cc867").cgColor)
            c.fill(CGRect(origin: .zero, size: s))
            var seed: UInt64 = 7
            func next() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat(seed >> 33) / CGFloat(1 << 31) }
            for _ in 0..<380 {
                c.setFillColor(MathLookKit.color(next() > 0.5 ? "7dbb5a" : "9ad374").cgColor)
                let x = next() * s.width, y = next() * s.height, r = 2 + next() * 4
                c.fillEllipse(in: CGRect(x: x, y: y, width: r * 2, height: r * 1.4))
            }
        }
        let node = MathShape.floor(size, size, material)
        node.name = "ground"
        node.position = SCNVector3(middle.x, HouseLand.groundY, middle.z)
        node.castsShadow = false
        return node
    }

    /// The four streets round the outside, as one loop with its corners rounded.
    static let loop: [SIMD2<Float>] = {
        let r: Float = 8
        var out: [SIMD2<Float>] = []
        let corners: [(SIMD2<Float>, Float)] = [(SIMD2(west + r, north + r), .pi), (SIMD2(east - r, north + r), .pi * 1.5),
                                                (SIMD2(east - r, south - r), 0), (SIMD2(west + r, south - r), .pi / 2)]
        for (middle, from) in corners {
            for i in 0...8 {
                let a = from + Float(i) / 8 * .pi / 2
                out.append(middle + SIMD2(cos(a), sin(a)) * r)
            }
        }
        return out
    }()

    /// Avalon's middle, from the turning circle out to Oak Knoll.
    static let avalonLine: [SIMD2<Float>] = stride(from: Float(0), through: east, by: 1).map { SIMD2($0, avalon($0)) }

    /// The streets' names, painted on them: where, and whether the street runs north and south.
    private static let names: [(text: String, at: SIMD2<Float>, turned: Bool)] = [
        ("AVALON AVE", SIMD2(26, avalon(26)), false), ("AVALON AVE", SIMD2(78, avalon(78)), false),
        ("GARBER ST", SIMD2(31, north), false), ("RUSSELL ST", SIMD2(31, south), false),
        ("KELSEY ST", SIMD2(west, -16), true), ("OAK KNOLL TER", SIMD2(east, -36), true),
    ]

    private static func roads() -> SCNNode {
        let holder = SCNNode()
        let pave = flat("e4ddcb"), kerb = flat("c9c2b0"), tar = flat("6d717c"), paint = flat("f6efd9")
        func lay(_ geometry: SCNGeometry, _ material: SCNMaterial, _ y: Float) {
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.position.y = y
            node.castsShadow = false
            holder.addChildNode(node)
        }
        // No line through the turning circle, where Avalon comes out, or under a name.
        func lined(_ p: SIMD2<Float>) -> Bool {
            if simd_length(p) < bulb + 2 || simd_distance(p, SIMD2(east, 0)) < 6 { return false }
            return !names.contains { abs(p.x - $0.at.x) < ($0.turned ? 2 : 8.5) && abs(p.y - $0.at.y) < ($0.turned ? 8.5 : 2) }
        }
        for (line, closed) in [(avalonLine, false), (loop, true)] {
            lay(ribbon(line, width: roadWidth + walk * 2, closed: closed), pave, walkY)
            lay(ribbon(line, width: roadWidth + 0.24, closed: closed), kerb, kerbY)
            lay(ribbon(line, width: roadWidth, closed: closed), tar, roadY)
            lay(dashes(line, closed: closed, keep: lined), paint, paintY)
        }
        for (radius, material, y) in [(bulb + walk, pave, walkY), (bulb + 0.12, kerb, kerbY), (bulb, tar, roadY)] {
            let disc = MathShape.cylinder(radius, 0.002, material, segments: 48)
            disc.castsShadow = false
            holder.add(disc, 0, y, 0)
        }
        lay(ribbon([SIMD2(-6, palm), SIMD2(west + roadWidth / 2, palm)], width: 2, closed: false), pave, walkY)
        for name in names {
            let painted = self.name(name.text)
            painted.position = SCNVector3(name.at.x, paintY + 0.002, name.at.y)
            if name.turned { painted.eulerAngles.y = .pi / 2 }
            holder.addChildNode(painted)
        }
        return holder
    }

    /// A street's name, lying flat on it, reading from the west (or the south).
    private static func name(_ text: String) -> SCNNode {
        let material = MathMat.drawn("house-street-\(text)", 1024, 128, clear: true) { _, size in
            let style = NSMutableParagraphStyle()
            style.alignment = .center
            let words = NSAttributedString(string: text, attributes: [
                .font: UIFont.systemFont(ofSize: 92, weight: .heavy), .foregroundColor: UIColor(white: 1, alpha: 0.8),
                .kern: 8, .paragraphStyle: style,
            ])
            let high = words.size().height
            words.draw(in: CGRect(x: 0, y: (size.height - high) / 2, width: size.width, height: high))
        }
        let card = MathShape.floor(16, 2, material)
        card.castsShadow = false
        let holder = SCNNode()
        holder.addChildNode(card)
        return holder
    }

    /// A strip of ground along a line, `width` across.
    private static func ribbon(_ line: [SIMD2<Float>], width: Float, closed: Bool) -> SCNGeometry {
        var vertices: [SCNVector3] = [], indices: [Int32] = []
        let n = line.count
        for i in 0..<n {
            let a = line[closed ? (i + n - 1) % n : max(i - 1, 0)], b = line[closed ? (i + 1) % n : min(i + 1, n - 1)]
            let along = simd_normalize(b - a), side = SIMD2(-along.y, along.x) * (width / 2)
            for p in [line[i] + side, line[i] - side] { vertices.append(SCNVector3(p.x, 0, p.y)) }
        }
        for i in 0..<(closed ? n : n - 1) {
            let a = Int32(i * 2), b = Int32(((i + 1) % n) * 2)
            indices += [a, b, a + 1, b, b + 1, a + 1]
        }
        return flatGeometry(vertices, indices)
    }

    /// The broken line down the middle of a street, wherever `keep` says.
    private static func dashes(_ line: [SIMD2<Float>], closed: Bool, keep: (SIMD2<Float>) -> Bool) -> SCNGeometry {
        let points = closed ? line + [line[0]] : line
        var lengths: [Float] = [0]
        for i in 1..<points.count { lengths.append(lengths[i - 1] + simd_distance(points[i], points[i - 1])) }
        func at(_ s: Float) -> (p: SIMD2<Float>, side: SIMD2<Float>) {
            var i = 1
            while i < points.count - 1, lengths[i] < s { i += 1 }
            let a = points[i - 1], b = points[i], span = max(lengths[i] - lengths[i - 1], 0.0001)
            let along = simd_normalize(b - a)
            return (a + (b - a) * ((s - lengths[i - 1]) / span), SIMD2(-along.y, along.x) * 0.08)
        }
        var vertices: [SCNVector3] = [], indices: [Int32] = []
        var s: Float = 0.6
        while s + 1.2 < lengths[lengths.count - 1] {
            let a = at(s), b = at(s + 1.2)
            if keep(at(s + 0.6).p) {
                let first = Int32(vertices.count)
                for p in [a.p + a.side, a.p - a.side, b.p + b.side, b.p - b.side] { vertices.append(SCNVector3(p.x, 0, p.y)) }
                indices += [first, first + 2, first + 1, first + 2, first + 3, first + 1]
            }
            s += 2.4
        }
        return flatGeometry(vertices, indices)
    }

    private static func flatGeometry(_ vertices: [SCNVector3], _ indices: [Int32]) -> SCNGeometry {
        SCNGeometry(sources: [SCNGeometrySource(vertices: vertices), SCNGeometrySource(normals: Array(repeating: SCNVector3(0, 1, 0), count: vertices.count))],
                    elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
    }

    // MARK: The neighbours

    /// A neighbour's house: its lot, its rooms as [across, floor, back] from
    /// the lot's corner, its colours, and which way its roofs run.
    private struct Neighbour {
        let lot: Lot
        let cells: [[Int]]
        let wall: String, roof: String, door: String
        let ridgeAcross: Bool
    }

    private static let neighbourLots: [Neighbour] = [
        Neighbour(lot: Lot(x: 13, z: -18, wide: 16, deep: 16, front: .avalon), cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
                  wall: "efe3c8", roof: "c0674a", door: "3f6f9f", ridgeAcross: true),
        Neighbour(lot: Lot(x: 55, z: -26, wide: 16, deep: 16, front: .avalon), cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
                  wall: "f0e2a8", roof: "b85c41", door: "5a3b2a", ridgeAcross: false),
        Neighbour(lot: Lot(x: 12, z: 12, wide: 16, deep: 16, front: .russell), cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]],
                  wall: "c9d6de", roof: "5d6470", door: "b5483b", ridgeAcross: true),
        Neighbour(lot: Lot(x: 54, z: 8, wide: 16, deep: 16, front: .russell), cells: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
                  wall: "f2efe6", roof: "6f7480", door: "2f7a5a", ridgeAcross: false),
        Neighbour(lot: Lot(x: -34, z: 12, wide: 16, deep: 16, front: .russell), cells: [[0, 0, 0], [0, 0, 1], [1, 0, 1]],
                  wall: "ead9b8", roof: "c2603f", door: "3f6f9f", ridgeAcross: false),
    ]

    /// Every lot there is, whoever's it is, for keeping trees off them.
    private static var everyLot: [Lot] { [parentsLot, sebastian, oscar] + spare + neighbourLots.map(\.lot) }

    /// Mown grass on every lot, so each reads as somebody's.
    private static func lawns() -> SCNNode {
        let holder = SCNNode()
        for lot in everyLot {
            let lawn = MathShape.floor(lot.wide, lot.deep, flat("9ad374"))
            lawn.castsShadow = false
            holder.add(lawn, lot.x + lot.wide / 2, lawnY, lot.z + lot.deep / 2)
        }
        return holder
    }

    private static func neighbours() -> SCNNode {
        let holder = SCNNode()
        let S = HouseCatalog.side
        for neighbour in neighbourLots {
            let lot = neighbour.lot
            let house = cottage(neighbour)
            let origin = SIMD3<Float>(lot.x + (lot.wide - 2 * S) / 2, 0, lot.z + (lot.deep - 2 * S) / 2)
            house.simdPosition = origin
            holder.addChildNode(house)
            // A path from its door to the street.
            guard let door = door(of: neighbour.cells) else { continue }
            let x = origin.x + Float(door[0]) * S + S * 0.3, z0 = origin.z + Float(door[2]) * S + S + 0.3, z1 = lot.frontZ(at: x)
            let path = MathShape.floor(1.4, z1 - z0, flat("e4ddcb"))
            path.castsShadow = false
            holder.add(path, x, walkY, (z0 + z1) / 2)
        }
        return holder
    }

    /// The room a house's front door is on: on the ground, nearest whoever's looking.
    private static func door(of cells: [[Int]]) -> [Int]? {
        cells.filter { $0[1] == 0 }.max { ($0[0] + $0[2], $0[2]) < ($1[0] + $1[2], $1[2]) }
    }

    /// A neighbour's house, shut: walls, a window in each that shows, a door, and roofs.
    private static func cottage(_ neighbour: Neighbour) -> SCNNode {
        let S = HouseCatalog.side, H = HouseCatalog.height
        let holder = SCNNode()
        let cells = Set(neighbour.cells)
        let wall = MathMat.color(neighbour.wall), roof = MathMat.color(neighbour.roof), frame = MathMat.color("f6f1e4"), glass = MathMat.color("a9d6ef")
        let front = door(of: neighbour.cells)
        for cell in neighbour.cells {
            let x = Float(cell[0]) * S, y = Float(cell[1]) * H, z = Float(cell[2]) * S
            holder.add(MathShape.box(S, H, S, wall), x + S / 2, y + H / 2, z + S / 2)
            if !cells.contains([cell[0] + 1, cell[1], cell[2]]) {
                holder.add(MathShape.box(0.1, 1.3, 1.5, frame), x + S + 0.03, y + H * 0.55, z + S / 2)
                holder.add(MathShape.box(0.1, 1.1, 1.3, glass), x + S + 0.06, y + H * 0.55, z + S / 2)
            }
            if !cells.contains([cell[0], cell[1], cell[2] + 1]) {
                if cell == front {
                    holder.add(MathShape.box(1.3, 2.3, 0.1, frame), x + S * 0.3, 1.15, z + S + 0.03)
                    holder.add(MathShape.box(1.1, 2.15, 0.1, MathMat.color(neighbour.door)), x + S * 0.3, 1.08, z + S + 0.06)
                    holder.add(MathShape.box(1.5, 0.2, 0.9, MathMat.color("d9d2c0")), x + S * 0.3, 0.1, z + S + 0.45)
                    holder.add(MathShape.box(1.3, 1.1, 0.1, frame), x + S * 0.72, H * 0.55, z + S + 0.03)
                    holder.add(MathShape.box(1.1, 0.9, 0.1, glass), x + S * 0.72, H * 0.55, z + S + 0.06)
                } else {
                    holder.add(MathShape.box(1.5, 1.3, 0.1, frame), x + S / 2, y + H * 0.55, z + S + 0.03)
                    holder.add(MathShape.box(1.3, 1.1, 0.1, glass), x + S / 2, y + H * 0.55, z + S + 0.06)
                }
            }
            guard !cells.contains([cell[0], cell[1] + 1, cell[2]]) else { continue }
            holder.add(MathShape.box(S + 0.6, 0.25, S + 0.6, MathMat.color("8a5a44")), x + S / 2, y + H + 0.12, z + S / 2)
            let path = UIBezierPath()
            let half = CGFloat(S / 2 + 0.35)
            path.move(to: CGPoint(x: -half, y: 0))
            path.addLine(to: CGPoint(x: half, y: 0))
            path.addLine(to: CGPoint(x: 0, y: 1.7))
            path.close()
            let shape = SCNShape(path: path, extrusionDepth: CGFloat(S + 0.6))
            shape.materials = [roof]
            holder.add(SCNNode(geometry: shape), x + S / 2, y + H + 0.25, z + S / 2, ry: neighbour.ridgeAcross ? .pi / 2 : 0)
        }
        let flat = holder.flattenedClone()
        flat.castsShadow = true
        return flat
    }

    // MARK: The big place and the park

    /// The big place behind the north side of Avalon: long, white, flat-roofed, with a pool.
    private static func estate() -> SCNNode {
        // What lies flat is kept apart from what stands up, which is made one thing and casts a shadow.
        let all = SCNNode(), holder = SCNNode()
        let x0: Float = 16, z0: Float = -62, wide: Float = 56, deep: Float = 28
        func lie(_ node: SCNNode, _ x: Float, _ y: Float, _ z: Float) {
            node.castsShadow = false
            all.add(node, x, y, z)
        }
        lie(MathShape.floor(wide, deep, flat("9ad374")), x0 + wide / 2, lawnY, z0 + deep / 2)
        let wall = MathMat.color("f1ede2"), lid = MathMat.color("b9b3a4"), frame = MathMat.color("f6f1e4"), glass = MathMat.color("a9d6ef")
        /// A flat-roofed block, with rows of windows on the two sides that show.
        func block(_ x: Float, _ z: Float, _ w: Float, _ d: Float, _ h: Float) {
            holder.add(MathShape.box(w, h, d, wall), x + w / 2, h / 2, z + d / 2)
            holder.add(MathShape.box(w + 0.5, 0.3, d + 0.5, lid), x + w / 2, h + 0.15, z + d / 2)
            var y: Float = 1.9
            while y + 1 < h {
                var a: Float = 1.8
                while a + 1 < w {
                    holder.add(MathShape.box(1.5, 1.3, 0.1, frame), x + a, y, z + d + 0.03)
                    holder.add(MathShape.box(1.3, 1.1, 0.1, glass), x + a, y, z + d + 0.06)
                    a += 3
                }
                a = 1.8
                while a + 1 < d {
                    holder.add(MathShape.box(0.1, 1.3, 1.5, frame), x + w + 0.03, y, z + a)
                    holder.add(MathShape.box(0.1, 1.1, 1.3, glass), x + w + 0.06, y, z + a)
                    a += 3
                }
                y += 3.1
            }
        }
        block(22, -58, 30, 9, 6.4)
        block(22, -49, 9, 9, 3.4)
        block(52, -58, 10, 7, 3.4)
        // The pool, in its terrace.
        lie(MathShape.floor(15, 9.5, flat("e4ddcb")), 43, walkY, -41.5)
        holder.add(MathShape.box(10, 0.12, 5.4, MathMat.color("d9d2c0")), 43, 0.02, -41.5)
        holder.add(MathShape.box(9.2, 0.12, 4.6, MathMat.color("49b6e6")), 43, 0.05, -41.5)
        // A drive in from Garber, to a round of gravel at the door.
        lie(MathShape.floor(3, 16, flat("d9d2c0")), 66.5, walkY, north + roadWidth / 2 + 8)
        lie(MathShape.cylinder(4, 0.002, flat("d9d2c0"), segments: 32), 66.5, walkY, -47)
        // A hedge along the front of it.
        holder.add(MathShape.box(wide - 2, 1.1, 0.9, MathMat.color("5f9e4a")), x0 + wide / 2, 0.55, z0 + deep - 0.6)
        let around: [(Double, Double, Bool)] = [(18.5, -37.5, true), (31, -38, false), (55, -38.5, true), (69, -42, false), (70, -57, true), (18.5, -59.5, true), (60, -46, false)]
        for (x, z, large) in around {
            all.addChildNode(tree(at: SIMD3(Float(x), 0, Float(z)), large: large, grown: 1, turned: Float(x)))
        }
        let built = holder.flattenedClone()
        built.castsShadow = true
        all.addChildNode(built)
        return all
    }

    /// Monkey Island Park, in the corner where Garber meets Oak Knoll.
    private static func park() -> SCNNode {
        let holder = SCNNode()
        let at = SIMD2<Float>(87, -50)
        let lawn = MathShape.cylinder(10.5, 0.002, flat("a6dc80"), segments: 40)
        lawn.castsShadow = false
        holder.add(lawn, at.x, lawnY, at.y)
        // A path across it.
        var line: [SIMD2<Float>] = []
        for i in 0...16 {
            let t = Float(i) / 16
            line.append(SIMD2(at.x - 9.5 + t * 19, at.y + 5 - t * 10 + sin(t * .pi) * 3))
        }
        let path = ribbon(line, width: 1.5, closed: false)
        path.materials = [flat("e4ddcb")]
        let pathNode = SCNNode(geometry: path)
        pathNode.position.y = walkY
        pathNode.castsShadow = false
        holder.addChildNode(pathNode)
        let around: [(Double, Double, Bool)] = [(81, -55, true), (85, -57, true), (92, -55.5, false), (94, -46, true), (81.5, -46, false), (88, -43, true)]
        for (x, z, large) in around {
            holder.addChildNode(tree(at: SIMD3(Float(x), 0, Float(z)), large: large, grown: 1.1, turned: Float(z)))
        }
        for (x, z) in [(86.0, -47.5), (90.5, -50.5)] as [(Double, Double)] {
            let bench = HouseProps.kit("bench")
            holder.add(bench, Float(x), 0, Float(z), ry: .pi / 4)
        }
        // Its name on a board, facing whoever's looking.
        let board = SCNNode()
        let green = MathMat.color("3f7a4a")
        let face = MathMat.sign("Monkey Island Park", ink: "fff7e6", paper: "3f7a4a", width: 512, height: 128)
        board.add(MathShape.faced(5.2, 1.3, 0.14, [face, green, green, green, green, green]), 0, 1.75, 0)
        for x: Float in [-2.2, 2.2] { board.add(MathShape.box(0.16, 1.2, 0.16, MathMat.color("8a5a3a")), x, 0.6, 0) }
        holder.add(board, 93.5, 0, -40.5, ry: .pi / 4)
        return holder
    }

    // MARK: Trees and hills

    /// The hills past the streets, all the way round as far as can be seen
    /// from furthest off: where, how wide and how high. None is nearer the
    /// streets than the trees go.
    private static let mounds: [(at: SIMD2<Float>, radius: Float, high: Float)] = {
        var out: [(at: SIMD2<Float>, radius: Float, high: Float)] = []
        var seed: UInt64 = 0xA7A1_0B
        func next() -> Float { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Float(seed >> 40) / Float(1 << 24) }
        for i in 0..<70 {
            let turn = Float(i) * 2.399963, far = 130 + next() * 330, radius = 26 + next() * 30, high = radius * (0.2 + next() * 0.12)
            let at = SIMD2(middle.x + cos(turn) * far, middle.z + sin(turn) * far)
            let gap = hypot(max(west - at.x, at.x - east, 0), max(north - at.y, at.y - south, 0))
            if gap > radius + 30 { out.append((at, radius, high)) }
        }
        return out
    }()

    private static func hills() -> SCNNode {
        let holder = SCNNode()
        for mound in mounds {
            let hill = MathShape.sphere(mound.radius, flat("84c261"), segments: 28)
            hill.scale = SCNVector3(1, mound.high / mound.radius, 1)
            hill.castsShadow = false
            holder.add(hill, mound.at.x, HouseLand.groundY, mound.at.y)
        }
        return holder
    }

    /// How high the ground is here: up a hill, if there's one.
    private static func height(at p: SIMD2<Float>) -> Float {
        var high: Float = 0
        for mound in mounds {
            let d = simd_distance(p, mound.at) / mound.radius
            if d < 1 { high = max(high, mound.high * (1 - d * d).squareRoot() + HouseLand.groundY - 0.2) }
        }
        return high
    }

    private static func tree(at: SIMD3<Float>, large: Bool, grown: Float, turned: Float) -> SCNNode {
        let name = large ? "tree-large" : "tree-small"
        let tree = HouseProps.kit(name, folder: "city", scale: 1)
        let s = (large ? 4.2 : 3.0) * grown / max(0.01, HouseProps.size(name, folder: "city", scale: 1).y)
        tree.scale = SCNVector3(s, s, s)
        tree.simdPosition = at
        tree.eulerAngles.y = turned
        return tree
    }

    /// Whether a tree can stand here: off the roads, the paths and the lots,
    /// and not in front of a house where it would hide it.
    static func clear(_ x: Float, _ z: Float) -> Bool {
        let verge = roadWidth / 2 + walk + 1.3
        if x > -1, x < east, abs(z - avalon(x)) < verge { return false }
        if hypot(x, z) < bulb + walk + 1.5 { return false }
        // The streets round the outside: near any side of them, or in a corner.
        let inside = min(x - west, east - x, z - north, south - z)
        let outside = hypot(max(west - x, x - east, 0), max(north - z, z - south, 0))
        if (inside >= 0 ? inside : outside) < verge { return false }
        if min(abs(x - west), abs(x - east)) < 11, min(abs(z - north), abs(z - south)) < 11 { return false }
        if x > west, x < -5, abs(z - palm) < 2.4 { return false }
        // The lots, and the ground in front of each (east and south of it).
        for lot in everyLot where x > lot.x - 1 && x < lot.x + lot.wide + 5 && z > lot.z - 1 && z < lot.z + lot.deep + 7 { return false }
        // The big place and the park have their own.
        if x > 15, x < 73, z > -63, z < -33 { return false }
        if hypot(x - 87, z + 50) < 12 { return false }
        return true
    }

    private static func trees() -> SCNNode {
        let holder = SCNNode()
        var seed: UInt64 = 0x5EED_A7A1
        func next() -> Float { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Float(seed >> 40) / Float(1 << 24) }
        let step: Float = 5.5, beyond: Float = 26
        var gx = west - beyond
        while gx < east + beyond {
            var gz = north - beyond
            while gz < south + beyond {
                let x = gx + (next() - 0.5) * step * 0.8, z = gz + (next() - 0.5) * step * 0.8
                let roll = next(), large = next() > 0.45, grown = 0.8 + next() * 0.4, turned = next() * .pi * 2
                gz += step
                let within = x > west && x < east && z > north && z < south
                // Thick past the streets and in the wood behind Mom & Dad's; a few along the verges.
                let wood = within && ((x < -12 && z < -22) || (x < 14 && z < -40))
                guard roll < (within ? (wood ? 0.75 : 0.3) : 0.62), clear(x, z) else { continue }
                holder.addChildNode(tree(at: SIMD3(x, height(at: SIMD2(x, z)), z), large: large, grown: grown, turned: turned))
            }
            gx += step
        }
        holder.name = "trees"
        return holder
    }
}
