import SceneKit
import UIKit

// A house's own piece of ground: its lot (HouseLayout.lot), with a fence
// along the back and a few trees there. Where the lots are, and the streets
// and everything else round them, is the town (HouseTown.swift).

enum HouseLand {
    /// Where a house's lot starts, from where its first room stands.
    static var lotStart: Float { Float(HouseLayout.lot.lowerBound) * HouseCatalog.side }
    static var lotSize: Float { Float(HouseLayout.lot.count) * HouseCatalog.side }
    /// The ground's top, a hair under the rooms' floors.
    static let groundY: Float = -0.04

    /// The fence along the back of a lot, for under a house.
    static func fence() -> SCNNode {
        let holder = SCNNode()
        let white = MathMat.color("f6f1e4")
        let a = lotStart - 0.5, b = lotStart + lotSize - 1.2, len = b - a
        for left in [true, false] {
            let rail = MathShape.box(left ? 0.1 : len, 0.12, left ? len : 0.1, white)
            for y: Float in [0.35, 0.7] {
                holder.add(rail.clone(), left ? a : a + len / 2, y, left ? a + len / 2 : a)
            }
            var t = a
            while t <= b {
                let picket = MathShape.box(0.16, 0.95, 0.16, white)
                holder.add(picket, left ? a : t, 0.475, left ? t : a)
                t += 0.6
            }
        }
        let flat = holder.flattenedClone()
        flat.castsShadow = true
        return flat
    }
}

extension HouseLand {
    /// A few trees in the back of a lot, where no room stands: the two back
    /// rows only, so none is in front of a room.
    static func garden(_ state: HouseState, seed kid: String) -> SCNNode {
        let holder = SCNNode()
        let S = HouseCatalog.side, lot = HouseLayout.lot
        var seed = UInt64(truncatingIfNeeded: kid.utf8.reduce(5381) { ($0 &* 33) &+ Int($1) }) | 1
        func next() -> Float { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Float(seed >> 40) / Float(1 << 24) }
        for x in lot { for z in lot where x == lot.lowerBound || z == lot.lowerBound {
            let roll = next(), dx = next(), dz = next(), size = next()
            guard roll < 0.5, state.room(at: [x, 0, z]) == nil else { continue }
            let large = size > 0.55
            let name = large ? "tree-large" : "tree-small"
            let tree = HouseProps.kit(name, folder: "city", scale: 1)
            let s = (large ? 3.6 : 2.4) / max(0.01, HouseProps.size(name, folder: "city", scale: 1).y)
            tree.scale = SCNVector3(s, s, s)
            tree.position = SCNVector3(Float(x) * S + 1 + dx * 2, 0, Float(z) * S + 1 + dz * 2)
            holder.addChildNode(tree)
        } }
        return holder
    }
}
