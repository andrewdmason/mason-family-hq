import Foundation
import SceneKit
import UIKit

// The places the run goes through. The track is cut into tiles 24 m long; a
// zone says what a tile of it looks like (the part that stands still, made a
// few ways and then copied, and the part that moves, made fresh), how it's
// lit, and what stands in the way there. The first five are a school on a
// good day. After that it's the same school, wrong: Andrew asked for the
// further you run the stranger it gets, in the way the Vocab bosses are.

/// A tile of track in the scene.
final class MathTile {
    let node = SCNNode()
    let index: Int
    let zone: Int
    /// Which of the zone's few layouts this one is.
    let variant: Int
    /// The people standing about in it, who need moving each frame.
    var people: [MathCharacter] = []

    init(index: Int, zone: Int, variant: Int) {
        self.index = index
        self.zone = zone
        self.variant = variant
    }

    @discardableResult
    func person(_ look: MathLook, x: Float, z: Float, facing: Float, clip: String = "idle", height: Float = 1.25, y: Float = 0, speed: Float = 1) -> MathCharacter {
        let c = MathCharacter(look: look, height: height)
        c.node.position = SCNVector3(x, y, z)
        c.node.eulerAngles.y = facing
        c.play(clip, loop: true, speed: speed)
        c.update(Float.random(in: 0...1))
        node.addChildNode(c.node)
        people.append(c)
        return c
    }
}

struct MathZone {
    typealias Build = (inout MathRNG) -> SCNNode

    let key: String
    let name: String
    /// How wrong it is, 0 to 1: slows and lowers the music, among other things.
    let mood: Float
    let sky: String
    let fog: String
    let fogNear: CGFloat
    let fogFar: CGFloat
    let ambient: (String, CGFloat)
    let sun: (String, CGFloat)
    /// The bed of sound under it (MathAssets/audio/amb-….m4a).
    let sound: String
    /// The part of a tile that stands still: z from 0 down to -24.
    let fixed: (Int, inout MathRNG) -> SCNNode
    /// What moves in it.
    let live: (MathTile, inout MathRNG) -> Void
    let low: [Build]
    let high: [Build]
    let full: [Build]
    /// A bus to run along the roof of.
    var buses = false

    /// The runner's own look, for the place that's full of them.
    nonisolated(unsafe) static var you = MathLook.plain

    static let tileLength: Float = 24
    static let halfWidth: Float = 4.2
    static let variants = 3

    /// The zone for how many questions have been answered this run: the five
    /// ordinary ones in order, then round and round the wrong ones.
    static func index(forLevel level: Int) -> Int {
        level < all.count ? level : 5 + (level - 5) % (all.count - 5)
    }

    static let all: [MathZone] = [hallway, courtyard, cafeteria, gym, library, hallwayAgain, nightCafeteria, redGym, pool, office, detention]
}

// MARK: Shared pieces

private enum Z {
    static let L = MathZone.tileLength
    static let W = MathZone.halfWidth

    static func ground(_ m: SCNMaterial, width: Float = W * 2, y: Float = 0) -> SCNNode {
        let n = MathShape.floor(width, L, m)
        n.position = SCNVector3(0, y, -L / 2)
        return n
    }

    /// A wall down one side: `side` is -1 (left) or 1.
    static func wall(_ m: SCNMaterial, side: Float, height: Float = 5, y: Float = 0, inset: Float = 0, length: Float = L, z: Float = -L / 2) -> SCNNode {
        let n = MathShape.card(length, height, m)
        n.eulerAngles.y = -side * .pi / 2
        n.position = SCNVector3(side * (W - inset), y + height / 2, z)
        return n
    }

    static func people(_ rng: inout MathRNG) -> MathLook {
        let hairs = ["2b1d14", "5a3a22", "8a5a34", "d9b25f", "c0531f", "101010", "7a4a2a"]
        let skins = ["f6c9a8", "e8b48c", "c98a5e", "8d5a3a", "f3d2b8", "6b4226"]
        let tops = ["e74c3c", "3498db", "2ecc71", "f1c40f", "9b59b6", "e67e22", "1abc9c", "ecf0f1", "34495e"]
        let bottoms = ["2c3e50", "34495e", "7f8c8d", "8e6e53", "1f3a6b", "5d4037"]
        return MathLook(head: rng.pick(MathLook.heads), body: rng.pick(["male-a", "male-b", "female-b", "female-f", "female-a"]),
                        hair: rng.pick(hairs), skin: rng.pick(skins), top: rng.pick(tops), bottom: rng.pick(bottoms),
                        shoes: rng.pick(["f2f2f2", "20242c", "e74c3c", "f5c542"]))
    }

    /// A roof over an indoor place, high enough to fly under.
    static func ceiling(_ color: String, y: Float = 5.7, width: Float = W * 2) -> SCNNode {
        let n = MathShape.floor(width, L, MathMat.color(color, glow: 0.75))
        n.eulerAngles.x = .pi / 2
        n.position = SCNVector3(0, y, -L / 2)
        n.castsShadow = false
        return n
    }

    /// The grey teacher, for the places that are full of them.
    static let grey = MathLook(head: "female-d", body: "female-d", hair: "6d6d6d", skin: "d8d2c8", top: "55585c", bottom: "3a3c40", shoes: "1a1a1a")

    static func lamps(_ node: SCNNode, color: String = "fff6d5", y: Float = 4.7, every: Float = 6, flicker: Bool = false) {
        var z: Float = -3
        while z > -L {
            for x: Float in [-2.2, 2.2] { node.add(MathProps.lamp(color, flicker: flicker), x, y + 0.9, z) }
            z -= every
        }
    }
}

// MARK: 1. The hallway

extension MathZone {
    static let hallway = MathZone(
        key: "hallway", name: "Main Hallway", mood: 0,
        sky: "cfe3ee", fog: "e9f2f5", fogNear: 60, fogFar: 125,
        ambient: ("ffffff", 620), sun: ("fff4dc", 700), sound: "amb-hall",
        fixed: { variant, rng in hallwayFixed(variant, &rng, wrong: false) },
        live: { tile, rng in
            hallwayLive(tile, wrong: false)
            for side: Float in [-1, 1] where rng.chance(0.55) {
                let clip = rng.pick(["idle", "idle", "emote-yes", "interact-right", "pick-up"])
                tile.person(Z.people(&rng), x: side * 3.45, z: -rng.range(3, 21), facing: side > 0 ? -.pi / 2 - 0.4 : .pi / 2 + 0.4, clip: clip)
            }
            if rng.chance(0.35) {
                // A paper aeroplane, crossing.
                let plane = MathShape.cone(0.16, 0, 0.5, MathMat.color("ffffff"), segments: 3)
                plane.eulerAngles = SCNVector3(0, 0, -Float.pi / 2)
                let z = -rng.range(4, 20)
                tile.node.add(plane, -3.6, 3.2, z)
                plane.runAction(.repeatForever(.sequence([
                    .move(to: SCNVector3(3.6, 2.6, z - 3), duration: 3.2), .fadeOut(duration: 0.1),
                    .move(to: SCNVector3(-3.6, 3.2, z), duration: 0), .wait(duration: Double(rng.range(1, 5))), .fadeIn(duration: 0.1),
                ])))
            }
        },
        low: [{ _ in MathProps.wetFloor() }, { MathProps.backpacks(&$0) }, { _ in MathProps.bench() }, { MathProps.bookStack(&$0, books: 5, wide: 1.2) }],
        high: [{ _ in MathProps.strung("PEP RALLY\nFRIDAY", paper: "f1c40f", ink: "20242c") }, { _ in MathProps.strung("BOOK FAIR") },
               { _ in MathProps.strung("NO RUNNING", paper: "ffffff", ink: "d6263a") }],
        full: [{ _ in MathProps.janitorCart() }, { _ in MathProps.lockerBlock("2e86c1") }, { _ in MathProps.teacherDesk() }]
    )

    /// What moves in either hallway: the clocks over the doors, and in the wrong one the lights.
    fileprivate static func hallwayLive(_ tile: MathTile, wrong: Bool) {
        for side: Float in [-1, 1] {
            let clock = MathProps.clock(backwards: wrong)
            clock.eulerAngles.y = -side * .pi / 2
            tile.node.add(clock, side * (Z.W - 0.08), 3.2, -5 - Float(tile.variant) * 4)
        }
        if wrong { Z.lamps(tile.node, color: "c8ffb8", flicker: true) }
    }

    fileprivate static func hallwayFixed(_ variant: Int, _ rng: inout MathRNG, wrong: Bool) -> SCNNode {
        let n = SCNNode()
        let floor = wrong ? MathProps.checker("111111", "e8e8e8", u: 4.2, v: 12, name: "hallwrong") : MathProps.checker("f4ecd8", "8ecdc8", u: 4.2, v: 12)
        n.addChildNode(Z.ground(floor))
        let lockerColors = wrong ? ["5a0f14", "5a0f14", "5a0f14"] : ["2e86c1", "e74c3c", "f1c40f"]
        let upper = MathMat.color(wrong ? "8f9a84" : "fbf3df")
        for side: Float in [-1, 1] {
            n.addChildNode(Z.wall(MathProps.lockers(lockerColors[(variant + (side > 0 ? 1 : 0)) % 3], ajar: wrong, u: 12), side: side, height: 2.1))
            n.addChildNode(Z.wall(upper, side: side, height: 3.2, y: 2.1))
            n.add(MathShape.box(0.12, 0.14, Z.L, MathMat.color(wrong ? "2a2a2a" : "d9c9a3")), side * (Z.W - 0.06), 2.1, -Z.L / 2)
            // A classroom door, a clock over it, and notices.
            let doorZ: Float = -5 - Float(variant) * 4
            let number = wrong ? "101" : "\(100 + variant * 7 + (side > 0 ? 2 : 1))"
            let door = MathShape.card(1.3, 2.5, MathProps.door(number, color: wrong ? "3a2a22" : "8a5a2b", lit: !wrong))
            door.eulerAngles.y = -side * .pi / 2
            n.add(door, side * (Z.W - 0.05), 1.25, doorZ)
            let notices: [(String, String, String)] = wrong
                ? [("YOU ARE\nLATE", "e8e2d0", "111111"), ("YOU ARE\nLATE", "e8e2d0", "111111"), ("YOU ARE\nLATE", "e8e2d0", "111111")]
                : [("MATH\nCLUB\nTHURS", "9b59b6", "ffffff"), ("GO\nOTTERS!", "f39c12", "ffffff"), ("BE\nKIND", "1abc9c", "ffffff"),
                   ("SCIENCE\nFAIR", "2ecc71", "ffffff"), ("LOST:\nONE\nSHOE", "ecf0f1", "c0392b"), ("PICTURE\nDAY", "e84393", "ffffff")]
            for i in 0..<3 {
                let (text, paper, ink) = notices[(i + variant * 2 + (side > 0 ? 3 : 0)) % notices.count]
                let p = MathProps.poster(text, paper: paper, ink: ink)
                p.eulerAngles.y = -side * .pi / 2
                p.eulerAngles.z = wrong ? 0 : rng.range(-0.06, 0.06)
                n.add(p, side * (Z.W - 0.07), 3.25, -11 - Float(i) * 4.2)
            }
        }
        n.addChildNode(Z.ceiling(wrong ? "3a4236" : "f1ead8"))
        for side: Float in [-1, 1] { n.addChildNode(Z.wall(upper, side: side, height: 0.6, y: 5.2)) }
        if !wrong { Z.lamps(n, color: "fff6d5") }
        // Along the foot of the lockers.
        let extras: [(Float, Float)] = [(-1, -9), (1, -15), (-1, -20), (1, -3)]
        for (i, (side, z)) in extras.enumerated() {
            switch (i + variant) % 4 {
            case 0:
                if let bin = MathProps.kit("furniture/trashcan", height: 0.9) { n.add(bin, side * 3.6, 0, z) }
            case 1:
                if let plant = MathProps.kit("furniture/pottedPlant", height: wrong ? 0.5 : 1.3) { n.add(plant, side * 3.55, 0, z) }
            case 2:
                // A drinking fountain.
                n.add(MathShape.box(0.5, 0.3, 0.4, MathMat.color("bdc3c7"), round: 0.05), side * 3.9, 1.0, z)
            default:
                // A trophy case.
                n.add(MathShape.box(0.3, 1.6, 2.2, MathMat.color("7a5230")), side * 4.0, 1.2, z)
                for t in 0..<3 {
                    n.add(MathShape.cone(0.05, 0.14, 0.34, MathMat.color("f5c542", glow: 0.3), segments: 8), side * 3.82, 1.35, z - 0.7 + Float(t) * 0.7)
                }
            }
        }
        // A banner across the hall, high up.
        let banner = MathShape.card(4.4, 0.7, MathMat.sign(wrong ? "WELCOME BACK" : ["WELCOME BACK OTTERS", "SPIRIT WEEK", "HOME OF THE OTTERS"][variant], ink: "ffffff", paper: wrong ? "3b0b0f" : "2e86c1", width: 512, height: 96))
        n.add(banner, 0, 4.75, -18)
        return n
    }

    // MARK: 6. The hallway again

    static let hallwayAgain = MathZone(
        key: "hallway-again", name: "The Hallway Again", mood: 0.45,
        sky: "1d241c", fog: "2b3327", fogNear: 28, fogFar: 85,
        ambient: ("c8ffc0", 330), sun: ("d8ffd0", 280), sound: "amb-strange",
        fixed: { variant, rng in hallwayFixed(variant, &rng, wrong: true) },
        live: { tile, rng in
            hallwayLive(tile, wrong: true)
            // Everyone has their face to the lockers.
            for i in 0..<5 {
                let side: Float = i % 2 == 0 ? -1 : 1
                tile.person(Z.people(&rng), x: side * 3.6, z: -2.5 - Float(i) * 4.6, facing: side > 0 ? .pi / 2 : -.pi / 2, clip: "static")
            }
            // Except one, who is watching you go by.
            if rng.chance(0.5) {
                let watcher = tile.person(Z.grey, x: rng.pick([-3.3, 3.3]), z: -rng.range(6, 20), facing: 0, clip: "static", height: 1.9)
                watcher.node.eulerAngles.y = .pi
            }
        },
        low: [{ _ in MathProps.wetFloor() }, { _ in MathProps.deskRow() }, { MathProps.backpacks(&$0) }],
        high: [{ _ in MathProps.strung("YOU ARE LATE", paper: "e8e2d0", ink: "111111") }, { _ in MathProps.strung("AGAIN", paper: "111111", ink: "e8e2d0") }],
        full: [{ _ in MathProps.lockerBlock("5a0f14") }, { _ in MathProps.janitorCart() }, { _ in MathProps.teacherDesk() }]
    )
}

// MARK: 2. The courtyard

extension MathZone {
    static let courtyard = MathZone(
        key: "courtyard", name: "The Courtyard", mood: 0,
        sky: "7ec8f2", fog: "bfe6fb", fogNear: 70, fogFar: 135,
        ambient: ("ffffff", 560), sun: ("fff1c9", 1000), sound: "amb-outside",
        fixed: { variant, rng in
            let n = SCNNode()
            n.addChildNode(Z.ground(MathProps.grass(u: 10, v: 12), width: 40, y: -0.02))
            // The path, with its lanes painted on.
            let path = MathMat.drawn("asphalt", 256, 256, u: 1, v: 6) { cg, s in
                cg.fill("596673", CGRect(origin: .zero, size: s))
                var r = MathRNG(seed: 2)
                for _ in 0..<300 {
                    MathLookKit.color("596673").shaded(CGFloat(r.range(0.85, 1.15))).setFill()
                    cg.fill(CGRect(x: CGFloat(r.unit()) * s.width, y: CGFloat(r.unit()) * s.height, width: 3, height: 3))
                }
                cg.fill("f7f1dc", CGRect(x: s.width / 3 - 3, y: 20, width: 6, height: 150))
                cg.fill("f7f1dc", CGRect(x: s.width * 2 / 3 - 3, y: 20, width: 6, height: 150))
                cg.fill("f5c542", CGRect(x: 4, y: 0, width: 6, height: s.height))
                cg.fill("f5c542", CGRect(x: s.width - 10, y: 0, width: 6, height: s.height))
            }
            n.addChildNode(Z.ground(path, width: 6))
            // The school down one side, a fence and trees down the other.
            let school = MathShape.box(6, 9, Z.L, MathProps.brick("c0553a", "e7d6c4", u: 12, v: 5))
            n.add(school, -11, 4.5, -Z.L / 2)
            let glass = MathShape.card(Z.L, 2.4, MathProps.windowed("c0553a", "9fd3f0", u: 8, v: 1))
            glass.eulerAngles.y = .pi / 2
            n.add(glass, -7.98, 3.4, -Z.L / 2)
            let glass2 = MathShape.card(Z.L, 2.4, MathProps.windowed("c0553a", "9fd3f0", u: 8, v: 1))
            glass2.eulerAngles.y = .pi / 2
            n.add(glass2, -7.98, 6.6, -Z.L / 2)
            for i in 0..<6 {
                let z = -2 - Float(i) * 4
                n.add(MathShape.box(0.08, 1.4, 0.08, MathMat.color("95a5a6")), 6.5, 0.7, z)
            }
            n.add(MathShape.box(0.04, 0.9, Z.L, MathMat.color("95a5a6", alpha: 0.5)), 6.5, 0.85, -Z.L / 2)
            for i in 0..<4 {
                let z = -3 - Float(i) * 6 - Float(variant)
                let x: Float = i % 2 == 0 ? 8.5 : 10.5
                if let tree = MathProps.kit(i % 2 == 0 ? "city/tree-large" : "city/tree-small", height: i % 2 == 0 ? 6 : 3.6) {
                    n.add(tree, x, 0, z)
                } else {
                    n.add(MathShape.cylinder(0.3, 2.4, MathMat.color("8a5a2b"), segments: 8), x, 1.2, z)
                    n.add(MathShape.sphere(2, MathMat.color("3fa34d"), segments: 10), x, 3.6, z)
                }
            }
            // Things beside the path. A parked bus is kept out of the tile's
            // one flattened mesh, which was putting it in the middle of the
            // road, where it looked like a bus to run up and wasn't one.
            func parked() -> SCNNode {
                let bus = MathProps.bus()
                bus.name = MathModels.kitName
                return bus
            }
            switch variant {
            case 0:
                n.add(MathProps.bench(), 4.2, 0, -6, ry: .pi / 2)
                n.add(MathProps.bench(), 4.2, 0, -14, ry: .pi / 2)
                n.add(MathShape.cylinder(0.06, 7, MathMat.color("ecf0f1"), segments: 8), -5, 3.5, -12)
            case 1:
                // A hoop.
                n.add(MathShape.cylinder(0.09, 3.4, MathMat.color("7f8c8d"), segments: 8), 4.6, 1.7, -10)
                n.add(MathShape.box(1.5, 1.0, 0.08, MathMat.sign("", paper: "ffffff", border: "e74c3c")), 4.6, 3.6, -10, ry: -.pi / 2)
                n.add(MathShape.cylinder(0.3, 0.04, MathMat.color("e67e22"), segments: 12), 4.2, 3.2, -10)
                n.add(parked(), -5.4, 0, -14)
            default:
                n.add(parked(), -5.4, 0, -8)
                for i in 0..<5 { n.add(MathShape.box(0.06, 0.9, 1.2, MathMat.color("7f8c8d")), 4 + Float(i) * 0.35, 0.45, -18) }
            }
            // Hopscotch.
            let hop = MathShape.floor(1.2, 3, MathMat.sign("1\n2\n3\n4", ink: "ffffff", paper: "596673", width: 64, height: 192, border: "ffffff"))
            n.add(hop, 3.9, 0.01, -20)
            return n
        },
        live: { tile, rng in
            // Clouds, a bird or two, somebody watching.
            for _ in 0..<2 {
                let cloud = SCNNode()
                for i in 0..<3 { cloud.add(MathShape.sphere(rng.range(1.2, 2.2), MathMat.color("ffffff"), segments: 8), Float(i) * 1.8 - 1.8, rng.range(-0.3, 0.3), 0) }
                cloud.castsShadow = false
                tile.node.add(cloud, rng.range(-18, 18), rng.range(13, 19), -rng.range(0, 24))
                cloud.runAction(.repeatForever(.sequence([.moveBy(x: 3, y: 0, z: 0, duration: 9), .moveBy(x: -3, y: 0, z: 0, duration: 9)])))
            }
            if rng.chance(0.6) {
                let bird = SCNNode()
                for s: Float in [-1, 1] {
                    let wing = MathShape.box(0.5, 0.03, 0.22, MathMat.color("34495e"))
                    wing.pivot = SCNMatrix4MakeTranslation(-s * 0.25, 0, 0)
                    bird.addChildNode(wing)
                    wing.runAction(.repeatForever(.sequence([.rotateTo(x: 0, y: 0, z: CGFloat(s * 0.7), duration: 0.18), .rotateTo(x: 0, y: 0, z: CGFloat(-s * 0.5), duration: 0.18)])))
                }
                let z = -rng.range(2, 22)
                tile.node.add(bird, -9, rng.range(5, 8), z)
                bird.runAction(.repeatForever(.sequence([.moveBy(x: 18, y: 1, z: -4, duration: 5), .moveBy(x: -18, y: -1, z: 4, duration: 0)])))
            }
            if rng.chance(0.6) {
                tile.person(Z.people(&rng), x: 4.2, z: -rng.range(4, 20), facing: -.pi / 2, clip: rng.pick(["idle", "emote-yes", "sit"]))
            }
        },
        low: [{ _ in MathProps.hurdle() }, { _ in MathProps.cones() }, { _ in MathProps.bench() }, { MathProps.backpacks(&$0) }],
        high: [{ _ in MathProps.net() }, { _ in MathProps.strung("FIELD DAY", paper: "2ecc71", ink: "ffffff") }, { _ in MathProps.strung("BIKE RACK →", paper: "ffffff", ink: "2e86c1") }],
        full: [{ _ in
            let n = SCNNode()
            n.add(MathShape.box(1.5, 0.7, 1.5, MathProps.brick("b0553a", "e7d6c4", u: 2, v: 1)), 0, 0.35, 0)
            if let tree = MathProps.kit("city/tree-small", height: 3) { n.add(tree, 0, 0.7, 0) } else {
                n.add(MathShape.sphere(1, MathMat.color("3fa34d"), segments: 10), 0, 1.9, 0)
            }
            return n
        }, { _ in MathProps.janitorCart() }, { _ in MathProps.vending("SODA", color: "2e86c1") }],
        buses: true
    )
}

// MARK: 3. The cafeteria, and 7. the cafeteria at night

extension MathZone {
    fileprivate static func cafeteriaFixed(_ variant: Int, _ rng: inout MathRNG, night: Bool) -> SCNNode {
        let n = SCNNode()
        n.addChildNode(Z.ground(night ? MathProps.checker("1b2233", "2a3550", u: 4.2, v: 12, name: "nightcafe") : MathProps.checker("ffffff", "e74c3c", u: 4.2, v: 12, name: "cafe")))
        let wallM = night ? MathProps.tiles("26304a", "151b2b", u: 12, v: 2.5) : MathProps.tiles("fdf6e3", "e2d6b8", u: 12, v: 2.5, accent: "f39c12")
        for side: Float in [-1, 1] { n.addChildNode(Z.wall(wallM, side: side)) }
        // Tables down the sides, with stools and lunch.
        for i in 0..<3 {
            let z = -4 - Float(i) * 8
            for side: Float in [-1, 1] {
                n.add(MathShape.box(1.3, 0.08, 3.6, MathMat.color(night ? "3a4560" : "e9d8a6"), round: 0.02), side * 3.3, 0.8, z)
                n.add(MathShape.box(0.1, 0.78, 3.0, MathMat.color("5d6d7e")), side * 3.3, 0.4, z)
                for s in 0..<4 {
                    let sz = z - 1.35 + Float(s) * 0.9
                    if night {
                        // The chairs are up for the night.
                        let stool = MathShape.cylinder(0.2, 0.06, MathMat.color("56658a"), segments: 10)
                        n.add(stool, side * 3.3, 1.35, sz)
                        n.add(MathShape.cylinder(0.03, 0.5, MathMat.color("56658a"), segments: 6), side * 3.3, 1.1, sz)
                    } else {
                        n.add(MathShape.cylinder(0.2, 0.06, MathMat.color(["e74c3c", "3498db", "f1c40f", "2ecc71"][s]), segments: 10), side * 2.45, 0.5, sz)
                        n.add(MathShape.cylinder(0.03, 0.5, MathMat.color("7f8c8d"), segments: 6), side * 2.45, 0.25, sz)
                        if let food = MathProps.kit(rng.pick(["food/burger", "food/pizza", "food/apple", "food/fries", "food/soda", "food/sandwich", "food/donut-sprinkles", "food/banana"]), height: 0.22) {
                            n.add(MathShape.box(0.5, 0.03, 0.36, MathMat.color("d35400")), side * 3.2, 0.86, sz)
                            n.add(food, side * 3.2, 0.88, sz)
                        }
                    }
                }
            }
        }
        // The menu, and the machines.
        let menu = MathShape.card(2.6, 1.6, MathMat.sign(night ? "TODAY\n\n\n" : ["TODAY\nMEAT?", "TODAY\nBEIGE", "TODAY\nSOUP\n(HOT)"][variant], ink: "ffffff", paper: night ? "0e1320" : "20513a", width: 256, height: 160, border: night ? "26304a" : "b98a52", font: "ChalkboardSE-Bold"))
        menu.eulerAngles.y = .pi / 2
        n.add(menu, -Z.W + 0.06, 3.3, -12)
        let machine = MathProps.vending(night ? "MILK" : "SNAX", color: night ? "1c2a4a" : "c0392b", glow: night ? 1 : 0.5)
        n.add(machine, Z.W - 0.6, 0, -21, ry: -.pi / 2)
        n.addChildNode(Z.ceiling(night ? "0c1120" : "fbf4e4"))
        for side: Float in [-1, 1] { n.addChildNode(Z.wall(wallM, side: side, height: 1, y: 5)) }
        // Lamps on long cords.
        var z: Float = -3
        while z > -Z.L {
            for x: Float in [-2.4, 2.4] {
                n.add(MathShape.cone(0.45, 0.1, 0.36, MathMat.color(night ? "1c2a4a" : "e74c3c"), segments: 12), x, 4.9, z)
                n.add(MathShape.sphere(0.15, MathMat.color(night ? "9fb4ff" : "fff6d5", glow: 1), segments: 8), x, 4.76, z)
                n.add(MathShape.box(0.03, 0.7, 0.03, MathMat.color("20242c")), x, 5.4, z)
            }
            z -= 6
        }
        return n
    }

    static let cafeteria = MathZone(
        key: "cafeteria", name: "The Cafeteria", mood: 0.05,
        sky: "f3e7cf", fog: "fbf4e4", fogNear: 60, fogFar: 125,
        ambient: ("fff8ee", 640), sun: ("ffe9c2", 640), sound: "amb-cafeteria",
        fixed: { variant, rng in cafeteriaFixed(variant, &rng, night: false) },
        live: { tile, rng in
            for i in 0..<3 where rng.chance(0.7) {
                let side: Float = rng.pick([-1, 1])
                tile.person(Z.people(&rng), x: side * 2.45, z: -4 - Float(i) * 8 + rng.range(-1, 1), facing: side > 0 ? .pi / 2 : -.pi / 2, clip: "sit", y: 0.12)
            }
            // Steam off the counter.
            let steam = SCNParticleSystem()
            steam.soft()
            steam.birthRate = 6
            steam.particleLifeSpan = 3
            steam.particleSize = 0.5
            steam.particleColor = UIColor(white: 1, alpha: 0.25)
            steam.particleVelocity = 0.5
            steam.emittingDirection = SCNVector3(0, 1, 0)
            steam.spreadingAngle = 20
            steam.blendMode = .alpha
            let source = SCNNode()
            source.addParticleSystem(steam)
            tile.node.add(source, rng.pick([-3.3, 3.3]), 1, -rng.range(3, 20))
        },
        low: [{ _ in MathProps.bench("e9d8a6") }, { r in
            let n = SCNNode()
            for i in 0..<3 { n.add(MathShape.box(0.48, 0.42, 0.48, MathMat.sign("MILK", ink: "ffffff", paper: ["3498db", "e74c3c", "2ecc71"][i], width: 64, height: 64)), Float(i) * 0.5 - 0.5, 0.21, r.range(-0.05, 0.05)) }
            for i in 0..<2 { n.add(MathShape.box(0.48, 0.42, 0.48, MathMat.sign("MILK", ink: "ffffff", paper: "3498db", width: 64, height: 64)), Float(i) * 0.5 - 0.25, 0.63, 0) }
            return n
        }, { _ in MathProps.wetFloor() }],
        high: [{ _ in MathProps.strung("LUNCH LINE\nFORMS HERE", paper: "ffffff", ink: "d35400") }, { _ in MathProps.strung("TRAYS ↓", paper: "d35400", ink: "ffffff") }],
        full: [{ MathProps.lunchTable(&$0) }, { _ in MathProps.vending("SNAX") }, { _ in
            let n = SCNNode()
            if let fridge = MathProps.kit("furniture/kitchenFridgeLarge", height: 2.3) { n.add(fridge, 0, 0, 0) } else { n.add(MathShape.box(1.3, 2.3, 0.8, MathMat.color("ecf0f1")), 0, 1.15, 0) }
            return n
        }]
    )

    static let nightCafeteria = MathZone(
        key: "cafeteria-night", name: "The Cafeteria, After", mood: 0.6,
        sky: "070a14", fog: "0b1020", fogNear: 22, fogFar: 78,
        ambient: ("8fa4ff", 250), sun: ("b8c6ff", 330), sound: "amb-strange",
        fixed: { variant, rng in cafeteriaFixed(variant, &rng, night: true) },
        live: { tile, rng in
            // Someone at every table, facing away.
            for i in 0..<3 {
                for side: Float in [-1, 1] {
                    tile.person(Z.grey, x: side * 2.45, z: -4 - Float(i) * 8, facing: side > 0 ? -.pi / 2 : .pi / 2, clip: "sit", height: 1.5, y: 0.12)
                }
            }
            // Trays, adrift.
            for _ in 0..<5 {
                let tray = MathShape.box(0.6, 0.04, 0.42, MathMat.color("d35400", glow: 0.25))
                tile.node.add(tray, rng.range(-3.6, 3.6), rng.range(2.6, 4.4), -rng.range(1, 23))
                tray.runAction(.repeatForever(.group([
                    .rotateBy(x: 1, y: 3, z: 0.6, duration: 9),
                    .sequence([.moveBy(x: 0, y: 0.5, z: 0, duration: 4), .moveBy(x: 0, y: -0.5, z: 0, duration: 4)]),
                ])))
            }
        },
        low: [{ _ in MathProps.bench("3a4560") }, { _ in MathProps.deskRow() }],
        high: [{ _ in MathProps.strung("SECONDS", paper: "0e1320", ink: "9fb4ff") }, { _ in MathProps.strung("EAT", paper: "0e1320", ink: "9fb4ff") }],
        full: [{ _ in MathProps.vending("MILK", color: "1c2a4a", glow: 1) }, { MathProps.lunchTable(&$0) }]
    )
}

// MARK: 4. The gym, and 8. the gym with no doors

extension MathZone {
    static let gym = MathZone(
        key: "gym", name: "The Gym", mood: 0.05,
        sky: "e9dcc4", fog: "f4ead6", fogNear: 60, fogFar: 125,
        ambient: ("fff6e6", 620), sun: ("fff0d0", 720), sound: "amb-gym",
        fixed: { variant, rng in
            let n = SCNNode()
            let court = MathMat.drawn("court", 256, 512, u: 1, v: 2) { cg, s in
                var r = MathRNG(seed: 8)
                for i in 0..<10 {
                    MathLookKit.color("e0a45c").shaded(CGFloat(r.range(0.93, 1.05))).setFill()
                    cg.fill(CGRect(x: CGFloat(i) * s.width / 10, y: 0, width: s.width / 10, height: s.height))
                }
                UIColor.white.setStroke()
                cg.setLineWidth(5)
                cg.stroke(CGRect(x: 14, y: 6, width: s.width - 28, height: s.height - 12))
                cg.strokeEllipse(in: CGRect(x: s.width / 2 - 50, y: s.height / 2 - 50, width: 100, height: 100))
                cg.setStrokeColor(MathLookKit.color("c0392b").cgColor)
                cg.move(to: CGPoint(x: 14, y: s.height / 2)); cg.addLine(to: CGPoint(x: s.width - 14, y: s.height / 2)); cg.strokePath()
            }
            n.addChildNode(Z.ground(court, width: 12))
            for side: Float in [-1, 1] {
                // Bleachers.
                for step in 0..<5 {
                    n.add(MathShape.box(0.8, 0.45, Z.L, MathMat.color(step % 2 == 0 ? "2e86c1" : "2874a6")), side * (4.3 + Float(step) * 0.8), 0.22 + Float(step) * 0.45, -Z.L / 2)
                }
                n.add(MathShape.box(0.3, 9, Z.L, MathProps.brick("d9c7a8", "bfae8f", u: 12, v: 5)), side * 8.6, 4.5, -Z.L / 2)
                let pennants = ["CHAMPIONS\n1987", "REGIONAL\nFINALISTS", "MOST\nIMPROVED", "OTTERS"]
                for i in 0..<2 {
                    let flag = MathProps.poster(pennants[(i + variant + (side > 0 ? 2 : 0)) % 4], paper: ["c0392b", "2e86c1", "f39c12"][(i + variant) % 3], w: 1.8, h: 2.2)
                    flag.eulerAngles.y = -side * .pi / 2
                    n.add(flag, side * 8.4, 6, -6 - Float(i) * 12)
                }
            }
            // A hoop on each side, and the scoreboard.
            for side: Float in [-1, 1] {
                let z: Float = -12 + Float(variant) * 3 * side
                n.add(MathShape.box(0.1, 1.2, 1.8, MathMat.sign("", paper: "ffffff", border: "e74c3c")), side * 4.05, 3.7, z)
                let rim = MathShape.cylinder(0.34, 0.05, MathMat.color("e67e22"), segments: 12)
                n.add(rim, side * 3.6, 3.25, z)
            }
            let score = MathShape.card(3.4, 1.4, MathMat.sign(["HOME 12  GUEST 9", "HOME 41  GUEST 40", "HOME 7  GUEST 7"][variant], ink: "ff5a36", paper: "10161d", width: 512, height: 192, border: "34495e", glow: 0.9))
            n.add(score, 0, 6.2, -20)
            n.addChildNode(Z.ceiling("cdbf9f", y: 9, width: 18))
            Z.lamps(n, y: 7.9, every: 8)
            return n
        },
        live: { tile, rng in
            for _ in 0..<2 where rng.chance(0.7) {
                let side: Float = rng.pick([-1, 1])
                let step = rng.int(4)
                tile.person(Z.people(&rng), x: side * (4.3 + Float(step) * 0.8), z: -rng.range(2, 22), facing: side > 0 ? -.pi / 2 : .pi / 2, clip: rng.pick(["sit", "emote-yes"]), y: 0.45 + Float(step) * 0.45)
            }
            // Ropes from the roof, swaying.
            for side: Float in [-1, 1] where rng.chance(0.6) {
                let rope = SCNNode()
                rope.add(MathShape.cylinder(0.05, 6, MathMat.color("d9b382"), segments: 6), 0, -3, 0)
                tile.node.add(rope, side * 3.4, 8, -rng.range(4, 20))
                rope.runAction(.repeatForever(.sequence([.rotateTo(x: 0.08, y: 0, z: 0.1, duration: 1.8), .rotateTo(x: -0.08, y: 0, z: -0.1, duration: 1.8)])))
            }
        },
        low: [{ _ in MathProps.hurdle("2e86c1") }, { MathProps.ballRack(&$0) }, { _ in MathProps.cones() }, { _ in
            MathShape.box(1.5, 0.45, 1.2, MathMat.color("2e86c1"), round: 0.06).lifted(0.225)
        }],
        high: [{ _ in MathProps.net() }, { _ in MathProps.strung("LIMBO", paper: "f39c12", ink: "ffffff") }],
        full: [{ _ in MathProps.matPile() }, { _ in
            // A vaulting horse on a springboard, with a rope ladder up it.
            let n = SCNNode()
            n.add(MathShape.box(1.4, 0.5, 0.7, MathMat.color("8a5a2b"), round: 0.15), 0, 2.0, 0)
            for x: Float in [-0.5, 0.5] { n.add(MathShape.box(0.14, 1.8, 0.5, MathMat.color("b98a52")), x, 0.9, 0) }
            n.add(MathShape.box(1.4, 1.2, 0.08, MathMat.color("d9b382")), 0, 0.9, 0)
            return n
        }, { _ in MathProps.lockerBlock("f39c12") }]
    )

    static let redGym = MathZone(
        key: "gym-red", name: "The Gym With No Doors", mood: 0.75,
        sky: "140305", fog: "2a070b", fogNear: 20, fogFar: 72,
        ambient: ("ff9a8a", 300), sun: ("ffc8b8", 360), sound: "amb-strange",
        fixed: { variant, rng in
            let n = SCNNode()
            let chevron = MathMat.drawn("chevron", 128, 128, u: 4, v: 12) { cg, s in
                cg.fill("f3ecd9", CGRect(origin: .zero, size: s))
                cg.setFillColor(MathLookKit.color("141010").cgColor)
                let h = s.height / 4
                for row in 0..<5 {
                    let y = CGFloat(row) * h * 2 - h
                    cg.move(to: CGPoint(x: 0, y: y))
                    cg.addLine(to: CGPoint(x: s.width / 2, y: y + h))
                    cg.addLine(to: CGPoint(x: s.width, y: y))
                    cg.addLine(to: CGPoint(x: s.width, y: y + h))
                    cg.addLine(to: CGPoint(x: s.width / 2, y: y + 2 * h))
                    cg.addLine(to: CGPoint(x: 0, y: y + h))
                    cg.closePath()
                    cg.fillPath()
                }
            }
            n.addChildNode(Z.ground(chevron))
            let curtain = MathMat.drawn("curtain", 128, 32, u: 10, v: 1) { cg, s in
                for i in 0..<16 {
                    let t = CGFloat(i % 4) / 3
                    MathLookKit.color("a3121c").shaded(0.55 + 0.5 * t).setFill()
                    cg.fill(CGRect(x: CGFloat(i) * s.width / 16, y: 0, width: s.width / 16, height: s.height))
                }
            }
            for side: Float in [-1, 1] { n.addChildNode(Z.wall(curtain, side: side, height: 9)) }
            // One lamp, a chair under it, and a ball that isn't coming down.
            n.add(MathShape.cone(1.1, 0.1, 4.6, MathMat.color("fff0c8", glow: 1, alpha: 0.1), segments: 14), [-3.4, 3.4, -3.4][variant], 2.3, -12)
            if let chair = MathProps.kit("furniture/loungeChair", height: 1.1) { n.add(chair, [-3.4, 3.4, -3.4][variant], 0, -12, ry: .pi / 2) }
            n.add(MathShape.sphere(0.24, MathMat.color("e67e22"), segments: 12), [2.5, -2.5, 3][variant], 3.4, -7)
            let score = MathShape.card(3.4, 1.4, MathMat.sign("HOME 0   YOU ∞", ink: "ff3b30", paper: "0a0303", width: 512, height: 192, glow: 1))
            n.add(score, 0, 6.2, -20)
            return n
        },
        live: { tile, rng in
            // The bleachers are gone. The crowd stayed.
            for i in 0..<7 {
                for side: Float in [-1, 1] {
                    tile.person(Z.grey, x: side * 3.7, z: -1.5 - Float(i) * 3.3, facing: side > 0 ? -.pi / 2 : .pi / 2, clip: "static", height: 1.9)
                }
            }
        },
        low: [{ _ in MathProps.hurdle("111111") }, { _ in MathShape.box(1.5, 0.45, 1.2, MathMat.color("a3121c"), round: 0.06).lifted(0.225) }],
        high: [{ _ in MathProps.strung("LET'S ROCK", paper: "0a0303", ink: "ff3b30") }, { _ in MathProps.net() }],
        full: [{ _ in MathProps.matPile() }, { _ in
            let n = SCNNode()
            n.add(MathShape.box(1.5, 2.6, 0.3, MathMat.drawn("curtainblock", 64, 32) { cg, s in
                for i in 0..<8 {
                    MathLookKit.color("a3121c").shaded(i % 2 == 0 ? 0.7 : 1.05).setFill()
                    cg.fill(CGRect(x: CGFloat(i) * s.width / 8, y: 0, width: s.width / 8, height: s.height))
                }
            }), 0, 1.3, 0)
            return n
        }]
    )
}

// MARK: 5. The library

extension MathZone {
    static let library = MathZone(
        key: "library", name: "The Library", mood: 0.12,
        sky: "3a2a1e", fog: "6b5340", fogNear: 45, fogFar: 110,
        ambient: ("ffe9c8", 520), sun: ("ffd9a0", 620), sound: "amb-hall",
        fixed: { variant, rng in
            let n = SCNNode()
            let carpet = MathMat.drawn("carpet", 128, 128, u: 4.2, v: 12) { cg, s in
                cg.fill("7b1e2b", CGRect(origin: .zero, size: s))
                cg.setStrokeColor(MathLookKit.color("b8860b").cgColor)
                cg.setLineWidth(4)
                cg.move(to: CGPoint(x: s.width / 2, y: 6)); cg.addLine(to: CGPoint(x: s.width - 6, y: s.height / 2))
                cg.addLine(to: CGPoint(x: s.width / 2, y: s.height - 6)); cg.addLine(to: CGPoint(x: 6, y: s.height / 2)); cg.closePath()
                cg.strokePath()
            }
            n.addChildNode(Z.ground(carpet))
            for side: Float in [-1, 1] {
                n.addChildNode(Z.wall(MathProps.bookSpines(u: 8, v: 1.6), side: side, height: 4.6))
                n.addChildNode(Z.wall(MathMat.color("4a3426"), side: side, height: 3, y: 4.6))
                // A ladder against the shelves.
                let lz: Float = -6 - Float(variant) * 5 - (side > 0 ? 3 : 0)
                let ladder = SCNNode()
                for x: Float in [-0.3, 0.3] { ladder.add(MathShape.box(0.06, 4.4, 0.06, MathMat.color("b98a52")), x, 2.2, 0) }
                for r in 0..<9 { ladder.add(MathShape.box(0.6, 0.05, 0.05, MathMat.color("b98a52")), 0, 0.4 + Float(r) * 0.45, 0) }
                ladder.eulerAngles = SCNVector3(0, -side * Float.pi / 2, 0)
                ladder.eulerAngles.z = side * 0.14
                n.add(ladder, side * 3.7, 0, lz)
            }
            // Reading tables with green lamps.
            for i in 0..<2 {
                let side: Float = (i + variant) % 2 == 0 ? -1 : 1
                let z = -7 - Float(i) * 10
                if let table = MathProps.kit("furniture/table", width: 1.3) { n.add(table, side * 3.2, 0, z) } else {
                    n.add(MathShape.box(1.3, 0.08, 1.3, MathMat.color("7a5230")), side * 3.2, 0.8, z)
                }
                n.add(MathShape.cylinder(0.03, 0.36, MathMat.color("b7950b"), segments: 6), side * 3.2, 1.05, z)
                n.add(MathShape.box(0.44, 0.14, 0.2, MathMat.color("1e8449", glow: 0.9), round: 0.06), side * 3.2, 1.26, z)
                n.add(MathProps.bookStack(&rng, books: 4, wide: 0.4), side * 2.95, 0.86, z + 0.35)
            }
            let quiet = MathProps.poster(["QUIET", "SHHH", "QUIET\nPLEASE"][variant], paper: "f7f1dc", ink: "7b1e2b", w: 1.2, h: 0.8)
            n.add(quiet, 0, 4.1, -22)
            n.addChildNode(Z.ceiling("3a281c", y: 7.6))
            Z.lamps(n, color: "ffe2a8", y: 6.6, every: 8)
            return n
        },
        live: { tile, rng in
            let dust = SCNParticleSystem()
            dust.soft()
            dust.birthRate = 14
            dust.particleLifeSpan = 8
            dust.particleSize = 0.035
            dust.particleColor = UIColor(red: 1, green: 0.93, blue: 0.75, alpha: 0.75)
            dust.particleVelocity = 0.12
            dust.spreadingAngle = 180
            dust.emitterShape = SCNBox(width: 8, height: 4, length: 24, chamferRadius: 0)
            dust.blendMode = .additive
            let source = SCNNode()
            source.addParticleSystem(dust)
            tile.node.add(source, 0, 2.4, -12)
            if rng.chance(0.5) {
                // The librarian, not pleased.
                let look = MathLook(head: "female-c", body: "female-d", hair: "8d8d93", skin: "f3d2b8", top: "6c3483", bottom: "2c3e50", shoes: "20242c")
                tile.person(look, x: rng.pick([-3.2, 3.2]), z: -rng.range(4, 20), facing: .pi, clip: "emote-no", height: 1.8)
            }
        },
        low: [{ MathProps.bookStack(&$0, books: 6, wide: 1.3) }, { _ in MathProps.bench("7a5230") }, { r in
            let n = SCNNode()
            for i in 0..<3 { n.add(MathProps.bookStack(&r, books: 4, wide: 0.45), Float(i) * 0.5 - 0.5, 0, 0) }
            return n
        }],
        high: [{ _ in MathProps.strung("RETURNS", paper: "f7f1dc", ink: "7b1e2b", posts: "b98a52") }, { _ in MathProps.strung("OVERDUE", paper: "7b1e2b", ink: "f7f1dc", posts: "b98a52") }],
        full: [{ _ in MathProps.bookcase() }, { _ in MathProps.globe() }, { _ in MathProps.bookcase() }]
    )
}

// MARK: 9. The pool

extension MathZone {
    static let pool = MathZone(
        key: "pool", name: "The Pool", mood: 0.85,
        sky: "062a3a", fog: "0d4a5e", fogNear: 18, fogFar: 70,
        ambient: ("9fe8ff", 380), sun: ("c8f6ff", 420), sound: "amb-strange",
        fixed: { variant, rng in
            let n = SCNNode()
            let floor = MathMat.drawn("poolfloor", 256, 256, u: 2.1, v: 6) { cg, s in
                cg.fill("d6f3f7", CGRect(origin: .zero, size: s))
                cg.setStrokeColor(MathLookKit.color("9ad4de").cgColor)
                cg.setLineWidth(2)
                for i in 0...8 {
                    cg.move(to: CGPoint(x: CGFloat(i) * 32, y: 0)); cg.addLine(to: CGPoint(x: CGFloat(i) * 32, y: s.height))
                    cg.move(to: CGPoint(x: 0, y: CGFloat(i) * 32)); cg.addLine(to: CGPoint(x: s.width, y: CGFloat(i) * 32))
                }
                cg.strokePath()
                cg.fill("14506a", CGRect(x: s.width / 2 - 8, y: 0, width: 16, height: s.height))
            }
            n.addChildNode(Z.ground(floor))
            let side = MathProps.tiles("c8eef4", "8cc6d2", u: 12, v: 3, accent: "14506a")
            for s: Float in [-1, 1] {
                n.addChildNode(Z.wall(side, side: s, height: 6))
                // A ladder up to where the edge was.
                let z: Float = -6 - Float(variant) * 5
                for x: Float in [-0.25, 0.25] { n.add(MathShape.cylinder(0.04, 6, MathMat.color("d9dde2"), segments: 6), s * (Z.W - 0.15), 3, z + x) }
                for r in 0..<10 { n.add(MathShape.box(0.05, 0.05, 0.5, MathMat.color("d9dde2")), s * (Z.W - 0.15), 0.5 + Float(r) * 0.55, z) }
            }
            // Desks, in rows, where the water was.
            for i in 0..<3 {
                for s: Float in [-1, 1] {
                    n.add(MathProps.schoolDesk(), s * 3.3, 0, -4 - Float(i) * 8 + Float(variant), ry: s > 0 ? -.pi / 2 : .pi / 2)
                }
            }
            // And the water, overhead.
            let water = MathMat.drawn("water", 128, 128, u: 3, v: 8, glow: 0.8, clear: true) { cg, s in
                cg.setFillColor(UIColor(red: 0.2, green: 0.75, blue: 0.9, alpha: 0.55).cgColor)
                cg.fill(CGRect(origin: .zero, size: s))
                var r = MathRNG(seed: 12)
                cg.setStrokeColor(UIColor(white: 1, alpha: 0.5).cgColor)
                cg.setLineWidth(3)
                for _ in 0..<16 {
                    let x = CGFloat(r.unit()) * s.width, y = CGFloat(r.unit()) * s.height
                    cg.strokeEllipse(in: CGRect(x: x, y: y, width: CGFloat(r.range(14, 40)), height: CGFloat(r.range(8, 22))))
                }
            }
            let surface = MathShape.floor(Z.W * 2, Z.L, water)
            surface.eulerAngles.x = .pi / 2
            n.add(surface, 0, 6, -Z.L / 2)
            return n
        },
        live: { tile, rng in
            let bubbles = SCNParticleSystem()
            bubbles.soft()
            bubbles.birthRate = 10
            bubbles.particleLifeSpan = 6
            bubbles.particleSize = 0.09
            bubbles.particleSizeVariation = 0.06
            bubbles.particleColor = UIColor(white: 1, alpha: 0.55)
            bubbles.particleVelocity = 1
            bubbles.emittingDirection = SCNVector3(0, 1, 0)
            bubbles.spreadingAngle = 8
            bubbles.emitterShape = SCNBox(width: 8, height: 0.1, length: 24, chamferRadius: 0)
            bubbles.blendMode = .additive
            let source = SCNNode()
            source.addParticleSystem(bubbles)
            tile.node.add(source, 0, 0.2, -12)
            // Lane ropes, floating where the top was.
            for x: Float in [-1.7, 1.7] where rng.chance(0.7) {
                let rope = SCNNode()
                for i in 0..<12 { rope.add(MathShape.sphere(0.12, MathMat.color(i % 2 == 0 ? "e74c3c" : "ffffff"), segments: 6), 0, 0, -Float(i) * 0.5) }
                tile.node.add(rope, x, 5.2, -rng.range(2, 14))
                rope.runAction(.repeatForever(.sequence([.moveBy(x: 0, y: 0.3, z: 0, duration: 3), .moveBy(x: 0, y: -0.3, z: 0, duration: 3)])))
            }
            // A class, sitting it out.
            for i in 0..<3 where rng.chance(0.6) {
                let side: Float = rng.pick([-1, 1])
                tile.person(Z.people(&rng), x: side * 2.7, z: -4 - Float(i) * 8 + Float(tile.index % 3), facing: side > 0 ? .pi / 2 : -.pi / 2, clip: "sit", y: 0.12, speed: 0.2)
            }
        },
        low: [{ _ in MathProps.deskRow() }, { _ in
            let n = SCNNode()
            for i in 0..<10 { n.add(MathShape.sphere(0.2, MathMat.color(i % 2 == 0 ? "e74c3c" : "ffffff"), segments: 8), Float(i) * 0.17 - 0.76, 0.5, 0) }
            for x: Float in [-0.8, 0.8] { n.add(MathShape.cylinder(0.05, 0.6, MathMat.color("d9dde2"), segments: 6), x, 0.3, 0) }
            return n
        }],
        high: [{ _ in MathProps.strung("NO DIVING", paper: "ffffff", ink: "14506a", posts: "d9dde2") }, { _ in MathProps.strung("DEEP END", paper: "14506a", ink: "ffffff", posts: "d9dde2") }],
        full: [{ _ in
            // A lifeguard's chair, occupied by nobody.
            let n = SCNNode()
            for x: Float in [-0.5, 0.5] { for z: Float in [-0.4, 0.4] { n.add(MathShape.cylinder(0.05, 2.6, MathMat.color("ffffff"), segments: 6), x, 1.3, z) } }
            n.add(MathShape.box(1.3, 0.1, 1.0, MathMat.color("e74c3c")), 0, 2.2, 0)
            n.add(MathShape.box(1.3, 0.9, 0.1, MathMat.color("e74c3c")), 0, 2.7, 0.45)
            n.add(MathShape.box(1.4, 1.0, 0.08, MathMat.sign("OFF\nDUTY", ink: "e74c3c", paper: "ffffff", width: 128, height: 96)), 0, 0.9, -0.4)
            return n
        }, { _ in MathProps.lockerBlock("14506a") }]
    )
}

// MARK: 10. The office

extension MathZone {
    static let office = MathZone(
        key: "office", name: "The Office", mood: 0.9,
        sky: "2a2d2e", fog: "50575a", fogNear: 18, fogFar: 74,
        ambient: ("e8f0ee", 380), sun: ("f4fff6", 380), sound: "amb-strange",
        fixed: { variant, rng in
            let n = SCNNode()
            n.addChildNode(Z.ground(MathProps.tiles("8d9695", "6f7776", u: 4.2, v: 12)))
            let cabinets = MathMat.drawn("cabinetwall", 128, 128, u: 16, v: 3) { cg, s in
                cg.fill("7f8c8d", CGRect(origin: .zero, size: s))
                for i in 0..<4 {
                    cg.fill("95a5a6", CGRect(x: 6, y: 4 + i * 31, width: 116, height: 27))
                    cg.fill("ecf0f1", CGRect(x: 48, y: 9 + i * 31, width: 32, height: 7))
                    cg.fill("4d5656", CGRect(x: 54, y: 20 + i * 31, width: 20, height: 4))
                }
            }
            for side: Float in [-1, 1] {
                n.addChildNode(Z.wall(cabinets, side: side, height: 7))
                // Doors, all to the same room.
                for i in 0..<3 {
                    let door = MathShape.card(1.2, 2.4, MathProps.door("PRINCIPAL", color: "5d6d6e", lit: false))
                    door.eulerAngles.y = -side * .pi / 2
                    n.add(door, side * (Z.W - 0.04), 1.2, -4 - Float(i) * 8)
                }
            }
            // Desks with clerks' things, and clocks that don't agree.
            for i in 0..<3 {
                let side: Float = (i + variant) % 2 == 0 ? -1 : 1
                let z = -4 - Float(i) * 8 + 2
                if let desk = MathProps.kit("furniture/desk", width: 1.3) { n.add(desk, side * 3.3, 0, z, ry: side > 0 ? -.pi / 2 : .pi / 2) }
                if let screen = MathProps.kit("furniture/computerScreen", height: 0.5) { n.add(screen, side * 3.4, 0.72, z) }
                n.add(MathShape.box(0.5, Float(variant + i) * 0.25 + 0.2, 0.4, MathMat.color("f7f1dc")), side * 3.1, 0.72 + (Float(variant + i) * 0.25 + 0.2) / 2, z + 0.5)
            }
            n.addChildNode(Z.ceiling("5d6466"))
            let ticket = MathShape.card(2.6, 0.9, MathMat.sign(["NOW SERVING  4", "NOW SERVING  4", "NOW SERVING  3"][variant], ink: "ff5a36", paper: "10161d", width: 384, height: 128, glow: 1))
            n.add(ticket, 0, 3.9, -12)
            return n
        },
        live: { tile, rng in
            // Clocks that don't agree, and tubes that can't decide.
            for side: Float in [-1, 1] {
                for i in 0..<2 {
                    let clock = MathProps.clock(backwards: (i + tile.index) % 2 == 0)
                    clock.eulerAngles.y = -side * .pi / 2
                    tile.node.add(clock, side * (Z.W - 0.08), 3.4 + Float(i) * 0.9, -8 - Float(i) * 8)
                }
            }
            var z: Float = -2
            while z > -Z.L {
                tile.node.add(MathProps.lamp("eaffea", w: 3, l: 0.25, flicker: Int(z) % 3 == 0), 0, 5.6, z)
                z -= 4
            }
            // Paper, coming down.
            let paper = SCNParticleSystem()
            paper.birthRate = 7
            paper.particleLifeSpan = 7
            paper.particleSize = 0.11
            paper.particleColor = UIColor(white: 0.97, alpha: 1)
            paper.particleVelocity = 0.9
            paper.emittingDirection = SCNVector3(0, -1, 0)
            paper.spreadingAngle = 25
            paper.particleAngularVelocity = 90
            paper.particleAngularVelocityVariation = 120
            paper.emitterShape = SCNBox(width: 8, height: 0.1, length: 24, chamferRadius: 0)
            let source = SCNNode()
            source.addParticleSystem(paper)
            tile.node.add(source, 0, 6, -12)
            // Clerks, stamping.
            for i in 0..<3 {
                let side: Float = (i + tile.index) % 2 == 0 ? -1 : 1
                var clerk = Z.grey
                clerk.head = "male-d"
                clerk.body = "male-d"
                tile.person(clerk, x: side * 2.5, z: -4 - Float(i) * 8 + 2, facing: side > 0 ? .pi / 2 : -.pi / 2, clip: "interact-right", height: 1.7)
            }
        },
        low: [{ r in
            let n = SCNNode()
            for i in 0..<4 { n.add(MathShape.box(0.36, 0.3 + r.range(0, 0.5), 0.5, MathMat.color("f7f1dc")), Float(i) * 0.38 - 0.57, 0.2, 0) }
            return n
        }, { _ in MathProps.deskRow() }],
        high: [{ _ in MathProps.strung("TAKE A NUMBER", paper: "f7f1dc", ink: "2a2d2e") }, { _ in MathProps.strung("FORM 27B", paper: "f7f1dc", ink: "2a2d2e") },
               { _ in MathProps.strung("WINDOW CLOSED", paper: "2a2d2e", ink: "f7f1dc") }],
        full: [{ MathProps.filingCabinet(&$0) }, { _ in MathProps.teacherDesk() }, { MathProps.filingCabinet(&$0) }]
    )
}

// MARK: 11. Detention

extension MathZone {
    static let detention = MathZone(
        key: "detention", name: "Detention", mood: 1,
        sky: "000000", fog: "000000", fogNear: 14, fogFar: 62,
        ambient: ("ffffff", 240), sun: ("ffffff", 520), sound: "amb-strange",
        fixed: { variant, rng in
            let n = SCNNode()
            let board = MathMat.drawn("chalkfloor", 256, 256, u: 2.1, v: 6) { cg, s in
                cg.fill("16241d", CGRect(origin: .zero, size: s))
                let attrs: [NSAttributedString.Key: Any] = [.font: UIFont(name: "ChalkboardSE-Regular", size: 15) ?? .systemFont(ofSize: 15),
                                                            .foregroundColor: UIColor(white: 1, alpha: 0.5)]
                for i in 0..<12 { ("I will not run.  I will not run." as NSString).draw(at: CGPoint(x: 6, y: CGFloat(i) * 21 + 2), withAttributes: attrs) }
            }
            n.addChildNode(Z.ground(board, width: 30))
            // Desks either side, as far as there is.
            for row in 0..<6 {
                for col in 0..<3 {
                    for side: Float in [-1, 1] {
                        n.add(MathProps.schoolDesk(), side * (3.3 + Float(col) * 1.6), 0, -2 - Float(row) * 4, ry: side > 0 ? -.pi / 2 : .pi / 2)
                    }
                }
            }
            let far = MathShape.card(7, 2.2, MathMat.sign("I WILL NOT RUN", ink: "ffffff", paper: "16241d", width: 512, height: 160, border: "b98a52", glow: 0.5, font: "ChalkboardSE-Bold"))
            n.add(far, 0, 5.4, -23)
            return n
        },
        live: { tile, _ in
            // Every desk has you in it.
            let you = MathZone.you
            for row in 0..<6 {
                for side: Float in [-1, 1] {
                    tile.person(you, x: side * 2.7, z: -2 - Float(row) * 4, facing: side > 0 ? .pi / 2 : -.pi / 2, clip: "sit", y: 0.12, speed: 0)
                }
            }
        },
        low: [{ _ in MathProps.deskRow() }],
        high: [{ _ in MathProps.strung("STAY", paper: "000000", ink: "ffffff") }, { _ in MathProps.strung("SIT", paper: "000000", ink: "ffffff") }],
        full: [{ _ in MathProps.teacherDesk() }, { _ in
            let n = SCNNode()
            n.add(MathProps.schoolDesk(chair: false), 0, 0, 0)
            n.add(MathProps.schoolDesk(chair: false), 0, 0.78, 0, ry: 0.4)
            n.add(MathProps.schoolDesk(chair: false), 0, 1.56, 0, ry: -0.3)
            return n
        }]
    )
}

// MARK: The way through

extension MathZone {
    /// The doorway into this zone, across the track.
    func gate() -> SCNNode {
        let n = SCNNode()
        let wall = MathMat.color(mood > 0.3 ? "1a1a1a" : "d9c9a3")
        let frame = MathMat.color(mood > 0.3 ? "5a0f14" : "8a5a2b")
        let W = MathZone.halfWidth
        for side: Float in [-1, 1] {
            n.add(MathShape.box(W - 2.8 + 6, 7, 0.4, wall), side * (2.8 + (W - 2.8 + 6) / 2), 3.5, 0)
            n.add(MathShape.box(0.3, 3.6, 0.5, frame), side * 2.8, 1.8, 0)
            // The doors, pushed open.
            let door = MathShape.box(1.3, 3.4, 0.1, MathMat.color(mood > 0.3 ? "3b0b0f" : "b98a52"))
            door.pivot = SCNMatrix4MakeTranslation(-side * 0.65, 0, 0)
            door.eulerAngles.y = side * 1.3
            n.add(door, side * 2.8, 1.7, -0.2)
        }
        n.add(MathShape.box(6, 3.4, 0.4, wall), 0, 5.3, 0)
        n.add(MathShape.box(5.9, 0.3, 0.5, frame), 0, 3.6, 0)
        let sign = MathShape.card(4.6, 0.9, MathMat.sign(name.uppercased(), ink: mood > 0.3 ? "e8e2d0" : "ffffff", paper: mood > 0.3 ? "0a0a0a" : "2e86c1", width: 512, height: 96, glow: 0.4))
        n.add(sign, 0, 4.5, 0.22)
        return n
    }
}
