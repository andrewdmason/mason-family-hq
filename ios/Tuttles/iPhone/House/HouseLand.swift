import SceneKit
import UIKit

// A house's own piece of ground: its lot, with a fence along the back and
// down one side, and a few trees there. Where the lots are, and the streets
// and everything else round them, is the town (HouseTown.swift).

enum HouseLand {
    /// A lot is twenty metres square (HouseLayout.width), measured from its north-west corner.
    static let lotStart: Float = 0
    static var lotSize: Float { Float(HouseLayout.width) }
    /// The ground's top, a hair under the rooms' floors.
    static let groundY: Float = -0.04

    /// The fence along the back of a lot and down its left side.
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

    /// A few trees along the back of a lot and down its left side, wherever
    /// `clear` says there's no house: so none is in front of a room, from
    /// where the street's first seen.
    static func garden(clear: (Float, Float) -> Bool, seed kid: String) -> SCNNode {
        let holder = SCNNode()
        var seed = UInt64(truncatingIfNeeded: kid.utf8.reduce(5381) { ($0 &* 33) &+ Int($1) }) | 1
        func next() -> Float { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Float(seed >> 40) / Float(1 << 24) }
        var spots: [(Float, Float)] = []
        for i in 0..<5 { spots.append((2 + Float(i) * 4, 1.5)); spots.append((1.5, 5 + Float(i) * 3.4)) }
        for (x, z) in spots {
            let roll = next(), dx = next(), dz = next(), size = next()
            let at = (x + dx * 2 - 1, z + dz * 2 - 1)
            guard roll < 0.55, clear(at.0, at.1) else { continue }
            let large = size > 0.55
            let name = large ? "tree-large" : "tree-small"
            let tree = HouseProps.kit(name, folder: "city", scale: 1)
            let s = (large ? 3.6 : 2.4) / max(0.01, HouseProps.size(name, folder: "city", scale: 1).y)
            tree.scale = SCNVector3(s, s, s)
            tree.position = SCNVector3(at.0, 0, at.1)
            holder.addChildNode(tree)
        }
        return holder
    }
}
