import SceneKit
import UIKit

// The one thing in the house that coins don't buy: a shelf on the bedroom
// wall that fills up as they practise. A book stands on it for every fifteen
// words they know by heart in Vocab, and a cup for every five days they've
// reached their goal in Math; and once they've kept a streak going, a little
// board says how many days it is. Empty, it's a bare shelf with room on it.
//
// What's on it goes up with the rest of the house (HouseState.feats), so
// it's the same on the other phone and in the parents' view.

enum HouseEarned {
    /// How many words to a book, and Math goal days to a cup; and how many of each the shelf holds.
    static let wordsPerBook = 15, daysPerCup = 5
    static let mostBooks = 16, mostCups = 6

    static func books(words: Int) -> Int { min(mostBooks, max(0, words) / wordsPerBook) }
    static func cups(days: Int) -> Int { min(mostCups, max(0, days) / daysPerCup) }

    /// The shelf: flat against a wall at z = 0, its middle at the origin, coming out toward +z.
    static func shelf(_ feats: [String: Int]) -> SCNNode {
        let node = SCNNode()
        let wood = MathMat.color("b98455"), dark = MathMat.color("8f6238")
        // Two boards and a back.
        node.add(MathShape.box(1.56, 0.5, 0.03, MathMat.color("efe6d6")), 0, 0, 0.015)
        for y: Float in [-0.24, 0.02] { node.add(MathShape.box(1.56, 0.04, 0.2, wood), 0, y, 0.1) }
        for x: Float in [-0.77, 0.77] { node.add(MathShape.box(0.03, 0.5, 0.2, dark), x, 0, 0.1) }
        // Books along the bottom board, one for every fifteen words known.
        let spines = ["c9503f", "2f5f9a", "3f7a55", "e0a82e", "7a4a8f", "ef8fb5", "2f9a94", "f08a3c"]
        var x: Float = -0.72
        for i in 0..<books(words: feats["words"] ?? 0) {
            let thick: Float = [0.07, 0.085, 0.06, 0.09][i % 4], tall: Float = [0.19, 0.21, 0.17, 0.2, 0.18][i % 5]
            node.add(MathShape.box(thick, tall, 0.14, MathMat.color(spines[i % spines.count])), x + thick / 2, -0.22 + tall / 2, 0.1)
            x += thick + 0.006
        }
        // Cups along the top one, one for every five days of Math goals, each a little grander than the last.
        let gold = MathMat.color("f5c542", glow: 0.2)
        for i in 0..<cups(days: feats["mathDays"] ?? 0) {
            let s: Float = 0.75 + Float(i) * 0.07, cx: Float = -0.62 + Float(i) * 0.2
            let cup = SCNNode()
            cup.add(MathShape.box(0.07, 0.025, 0.07, MathMat.color("5a3b2a")), 0, 0.012, 0)
            cup.add(MathShape.cylinder(0.012, 0.05, gold), 0, 0.05, 0)
            cup.add(MathShape.cone(0.022, 0.045, 0.08, gold), 0, 0.115, 0)
            cup.simdScale = SIMD3(repeating: s)
            node.add(cup, cx, 0.04, 0.1)
        }
        // How long the streak is, once there is one.
        let streak = feats["streak"] ?? 0
        if streak >= 2 {
            let face = MathMat.sign("\(streak) days", ink: "fff7e6", paper: "c9503f", width: 256, height: 96)
            let red = MathMat.color("c9503f")
            node.add(MathShape.faced(0.3, 0.11, 0.02, [face, red, red, red, red, red]), 0.58, 0.1, 0.19)
        }
        return node
    }
}
