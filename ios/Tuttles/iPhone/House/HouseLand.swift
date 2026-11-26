import SceneKit
import UIKit

// The land the houses stand on: a town of square blocks with roads between
// them, going on as far as can be seen. Each house has a block of its own,
// its lot (HouseLayout.lot), with a fence along the back; the blocks between
// have trees on them. The houses go up the screen from block to block, so
// the street reads from the front of the screen to the back.
//
// The ground is one big picture, a block and its roads, repeated. A block is
// `block` across: the lot, then a road.

enum HouseLand {
    /// A block and the road along its front, across.
    static let block: Float = 24
    /// Where a house's lot starts, from where its first room stands.
    static var lotStart: Float { Float(HouseLayout.lot.lowerBound) * HouseCatalog.side }
    static var lotSize: Float { Float(HouseLayout.lot.count) * HouseCatalog.side }
    /// The ground's top, a hair under the rooms' floors.
    static let groundY: Float = -0.04

    /// The ground, everywhere, laid so a house standing at a whole number of blocks from the middle is on a lot.
    static func ground() -> SCNNode {
        let size: Float = block * 30
        let material = MathMat.drawn("house-town", 512, 512, u: size / block, v: size / block) { c, s in
            let px = s.width / CGFloat(block)
            func rect(_ x: Float, _ z: Float, _ w: Float, _ l: Float) -> CGRect {
                CGRect(x: CGFloat(x) * px, y: CGFloat(z) * px, width: CGFloat(w) * px, height: CGFloat(l) * px)
            }
            let lot = lotSize, road = block - lotSize
            // Grass, with a little in it.
            c.setFillColor(UIColor(hex: "8cc867").cgColor)
            c.fill(CGRect(origin: .zero, size: s))
            var seed: UInt64 = 7
            func next() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat(seed >> 33) / CGFloat(1 << 31) }
            for _ in 0..<260 {
                c.setFillColor(UIColor(hex: next() > 0.5 ? "7dbb5a" : "9ad374").cgColor)
                let x = next() * CGFloat(lot) * px, y = next() * CGFloat(lot) * px, r = 2 + next() * 4
                c.fillEllipse(in: CGRect(x: x, y: y, width: r * 2, height: r * 1.4))
            }
            // A pavement round the block.
            c.setFillColor(UIColor(hex: "e4ddcb").cgColor)
            let walk: Float = 0.9
            c.fill(rect(lot - walk, 0, walk, lot))
            c.fill(rect(0, lot - walk, lot, walk))
            c.fill(rect(0, 0, walk * 0.5, lot))
            c.fill(rect(0, 0, lot, walk * 0.5))
            // The roads, and a kerb.
            c.setFillColor(UIColor(hex: "6d717c").cgColor)
            c.fill(rect(lot, 0, road, block))
            c.fill(rect(0, lot, block, road))
            c.setFillColor(UIColor(hex: "c9c2b0").cgColor)
            c.fill(rect(lot, 0, 0.12, lot))
            c.fill(rect(0, lot, lot, 0.12))
            // A dashed line down the middle of each, stopping short of the crossing.
            c.setFillColor(UIColor(hex: "f6efd9").cgColor)
            let mid = lot + road / 2
            var d: Float = 0.8
            while d + 1.2 < lot - 0.4 {
                c.fill(rect(mid - 0.08, d, 0.16, 1.2))
                c.fill(rect(d, mid - 0.08, 1.2, 0.16))
                d += 2.4
            }
        }
        let node = MathShape.floor(size, size, material)
        node.name = "ground"
        // So a lot's corner, lotStart from a house, is where a block's picture starts.
        let half = size / 2
        let offset = (half + lotStart).truncatingRemainder(dividingBy: block)
        node.position = SCNVector3(offset, groundY, offset)
        node.castsShadow = false
        return node
    }

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

    /// Trees on the blocks round these ones (the houses' own are left clear).
    static func trees(around blocks: [SIMD2<Int>]) -> SCNNode {
        let holder = SCNNode()
        holder.name = "trees"
        let taken = Set(blocks.map { [$0.x, $0.y] })
        var near = Set<[Int]>()
        for b in blocks { for i in -3...3 { for j in -3...3 { near.insert([b.x + i, b.y + j]) } } }
        for cell in near.sorted(by: { $0.lexicographicallyPrecedes($1) }) where !taken.contains(cell) {
            var seed = UInt64(bitPattern: Int64(cell[0] &* 73_856_093 ^ cell[1] &* 19_349_663)) | 1
            func next() -> Float { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Float(seed >> 40) / Float(1 << 24) }
            let count = 4 + Int(next() * 5)
            for _ in 0..<count {
                let large = next() > 0.45
                let name = large ? "tree-large" : "tree-small"
                let tree = HouseProps.kit(name, folder: "city", scale: 1)
                let s = (large ? 4.2 : 3.0) * (0.8 + next() * 0.4) / max(0.01, HouseProps.size(name, folder: "city", scale: 1).y)
                tree.scale = SCNVector3(s, s, s)
                let x = lotStart + 2 + next() * (lotSize - 4), z = lotStart + 2 + next() * (lotSize - 4)
                tree.position = SCNVector3(Float(cell[0]) * block + x, 0, Float(cell[1]) * block + z)
                tree.eulerAngles.y = next() * .pi * 2
                holder.addChildNode(tree)
            }
        }
        return holder
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

private extension UIColor {
    convenience init(hex: String) {
        let v = UInt32(hex, radix: 16) ?? 0
        self.init(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}
