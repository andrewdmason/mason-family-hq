import SceneKit
import UIKit

// A house's own piece of ground: its lot, and behind it the back field once
// that's theirs (HouseLayout.swift), with a fence along the back and down
// one side, and a few trees there. Where the lots are, and the streets and
// everything else round them, is the town (HouseTown.swift).

enum HouseLand {
    /// How far across a house's land is, and how far back with the field.
    static var lotSize: Float { Float(HouseLayout.width) }
    static var lotDepth: Float { Float(HouseLayout.depth) }
    /// The ground's top, a hair under the rooms' floors.
    static let groundY: Float = -0.04

    /// The fence along the back of their land (`north` metres down it: the
    /// field's back, or the lot's) and down its left side from there.
    /// `style`: "picket", "rail", "hedge", "stone" or "none"; `hex` its colour.
    static func fence(north: Float, style: String = "picket", hex: String = "f6f1e4") -> SCNNode {
        let holder = SCNNode()
        guard style != "none" else { return holder }
        let paint = MathMat.color(hex)
        let a: Float = -0.5, top = north - 0.5
        // Along the back from the corner east, and down the side from the corner south.
        let runs: [(left: Bool, len: Float)] = [(true, lotDepth - 1.2 - top), (false, lotSize - 1.2 - a)]
        for (left, len) in runs {
            func put(_ node: SCNNode, _ along: Float, _ y: Float) { holder.add(node, left ? a : a + along, y, left ? top + along : top) }
            switch style {
            case "hedge":
                put(MathShape.box(left ? 0.7 : len, 1.15, left ? len : 0.7, paint, round: 0.2), len / 2, 0.57)
            case "stone":
                put(MathShape.box(left ? 0.4 : len, 0.8, left ? len : 0.4, paint), len / 2, 0.4)
                put(MathShape.box(left ? 0.5 : len + 0.1, 0.1, left ? len + 0.1 : 0.5, MathMat.color("d9d2c0")), len / 2, 0.85)
            case "rail":
                for y: Float in [0.45, 0.85] { put(MathShape.box(left ? 0.08 : len, 0.12, left ? len : 0.08, paint), len / 2, y) }
                var t: Float = 0
                while t <= len { put(MathShape.box(0.16, 1.05, 0.16, paint), t, 0.52); t += 2.4 }
            default:
                for y: Float in [0.35, 0.7] { put(MathShape.box(left ? 0.1 : len, 0.12, left ? len : 0.1, paint), len / 2, y) }
                var t: Float = 0
                while t <= len { put(MathShape.box(0.16, 0.95, 0.16, paint), t, 0.475); t += 0.6 }
            }
        }
        let flat = holder.flattenedClone()
        flat.castsShadow = true
        return flat
    }

    /// A few trees along the back of a lot and down its left side, wherever
    /// `clear` says there's no house: so none is in front of a room, from
    /// where the street's first seen.
    static func garden(north: Float, clear: (Float, Float) -> Bool, seed kid: String) -> SCNNode {
        let holder = SCNNode()
        var seed = UInt64(truncatingIfNeeded: kid.utf8.reduce(5381) { ($0 &* 33) &+ Int($1) }) | 1
        func next() -> Float { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Float(seed >> 40) / Float(1 << 24) }
        var spots: [(Float, Float)] = []
        for i in 0..<5 { spots.append((2 + Float(i) * 4, north + 1.5)); spots.append((1.5, north + 5 + Float(i) * 3.4)) }
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
