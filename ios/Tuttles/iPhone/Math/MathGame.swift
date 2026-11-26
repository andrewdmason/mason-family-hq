import Foundation
import SceneKit
import UIKit
import simd

// The run itself. A kid runs down three lanes of school with a teacher
// behind, throwing math problems into the way. Anything hit means caught, and
// a question (MathQuestionCard.swift): right and they break free, wrong and
// the run is over.
//
// The shape of it is Andrew's: dodging gets harder over twenty or thirty
// seconds "like Tetris levels", so that only someone very good lasts past
// thirty and nobody much past forty-five, without ever being literally
// impossible. So each wave has a clock. As it runs, the rows of things in the
// way come closer together, more of each row is blocked, more of them are
// thrown late rather than standing there from a distance, and everything
// speeds up. A right answer resets the clock; the pace it resets to, and how
// hard the questions are, step up each time.
//
// Everything here happens on SceneKit's own thread, in `renderer(_:updateAtTime:)`.
// The screen talks to it through `swipe`, `answer` and friends, which only
// leave a note for the next frame, and hears back on the main thread.

final class MathGame: NSObject, SCNSceneRendererDelegate {
    enum Phase { case idle, running, caught, question, over }
    enum Swipe { case left, right, up, down }

    struct PowerLeft: Equatable {
        let kind: MathProps.Power
        /// 0 to 1.
        let left: Float
    }

    /// What the screen shows over the run.
    struct HUD: Equatable {
        /// The run's score: stars picked up and won by answers.
        var stars = 0
        /// How close the teacher is, 0 to 1: the wave's clock.
        var danger: Float = 0
        var powers: [PowerLeft] = []
        /// Questions answered right this run.
        var level = 0
        var zone = ""
        /// The furthest zone reached, counted from 0.
        var depth = 0
        var distance = 0
    }

    struct Setup {
        var look: MathLook
        var teacher: MathLook
        var teacherHeight: Float = 1.95
        /// The board's colours, deck then wheels.
        var board: (String, String) = ("f39c12", "20242c")
        /// The colour of what's left behind them, if anything.
        var trail: String?
        var seed: UInt64 = UInt64.random(in: 0...UInt64.max)
        /// For looking at the game in the simulator: `--math-auto` plays by
        /// itself, `--math-god` can't be caught, `--math-level 6` starts deep.
        var auto = CommandLine.arguments.contains("--math-auto")
        var god = CommandLine.arguments.contains("--math-god")
        var startLevel: Int = {
            let args = CommandLine.arguments
            guard let at = args.firstIndex(of: "--math-level"), args.count > at + 1 else { return 0 }
            return Int(args[at + 1]) ?? 0
        }()
    }

    let scene = SCNScene()
    let cameraNode = SCNNode()
    private let setup: Setup
    private let audio: MathAudio

    // Heard on the main thread.
    var onHUD: ((HUD) -> Void)?
    /// Caught: ask a question.
    var onCaught: (() -> Void)?
    var onZone: ((MathZone) -> Void)?
    /// The teacher has something to say: `.start`, `.throwing`, `.close`.
    var onMoment: ((Moment) -> Void)?

    enum Moment { case start, close, zone(Int), freed }

    // MARK: Notes from the screen

    private let lock = NSLock()
    private var swipes: [Swipe] = []
    private var answered: Bool?
    private var wantsStart = false
    private var granted = 0
    private var held = false

    func swipe(_ s: Swipe) { lock.lock(); swipes.append(s); lock.unlock() }
    func start() { lock.lock(); wantsStart = true; lock.unlock() }
    /// The question's been answered.
    func answer(correct: Bool) { lock.lock(); answered = correct; lock.unlock() }
    /// Stars won by an answer, to show with the ones picked up.
    func grant(stars: Int) { lock.lock(); granted += stars; lock.unlock() }
    /// Stop the clock (the app's gone to the background, or a sheet is up).
    func hold(_ on: Bool) { lock.lock(); held = on; lock.unlock() }

    // MARK: The world

    private static let lanes: [Float] = [-MathProps.laneWidth, 0, MathProps.laneWidth]
    private static let gravity: Float = 34
    private static let ahead: Float = 132
    private static let behind: Float = 30

    private final class Thing {
        enum Kind { case low, high, full }
        let node: SCNNode
        let lane: Int
        let d: Float
        let half: Float
        let kind: Kind
        var live = true
        init(node: SCNNode, lane: Int, d: Float, half: Float, kind: Kind) {
            self.node = node; self.lane = lane; self.d = d; self.half = half; self.kind = kind
        }
    }

    /// A bus: a roof to run along, reached by a plank.
    private struct Platform {
        let lane: Int
        let start: Float
        let end: Float
        let ramp: Float
        let top: Float
        let nodes: [SCNNode]
    }

    private struct Pickup {
        let node: SCNNode
        var d: Float
        var x: Float
        var y: Float
        let power: MathProps.Power?
        var pulled = false
    }

    private struct Throw {
        let lane: Int
        let d: Float
        let kind: Thing.Kind
        let lead: Float
        var target: SCNNode?
        var missile: SCNNode?
        var thrownAt: Float = -1
        var flight: Float = 0.5
        var from = SCNVector3Zero
    }

    private var rng: MathRNG
    private var phase = Phase.idle
    private var last: TimeInterval = 0
    private var clock: Float = 0

    private let runner: MathCharacter
    private let teacher: MathCharacter
    private let boardNode = SCNNode()
    private let jetNode = SCNNode()
    private var trail: SCNParticleSystem?

    private var d: Float = 0
    private var lane = 1
    private var x: Float = 0
    private var y: Float = 0
    private var vy: Float = 0
    private var grounded = true
    private var roll: Float = 0
    private var speed: Float = 0
    private var level = 0
    private var wave: Float = 0
    private var safe: Float = 0
    private var stars = 0
    private var depth = 0
    private var powers: [MathProps.Power: Float] = [:]
    private var nextPower: Float = 14
    private var stepClock: Float = 0
    private var phaseClock: Float = 0
    private var teacherGap: Float = 3
    private var teacherBusy: Float = 0
    private var saidClose = false
    private var shake: Float = 0
    private var sinceStart: Float = 0
    private var hudClock: Float = 0
    private var starChain = 0
    private var starChainClock: Float = 0

    private var tiles: [Int: MathTile] = [:]
    private var protos: [String: SCNNode] = [:]
    private var things: [Thing] = []
    private var platforms: [Platform] = []
    private var pickups: [Pickup] = []
    private var throwing: [Throw] = []
    private var cursor: Float = 30
    private var safeLane = 1
    /// Where each zone starts, by distance.
    private var gates: [(d: Float, zone: Int)] = [(0, 0)]
    private var buildZone = 0
    private var zoneNow = -1

    private let sun = SCNNode()
    private let ambient = SCNNode()
    private let world = SCNNode()

    init(setup: Setup, audio: MathAudio) {
        self.setup = setup
        self.audio = audio
        rng = MathRNG(seed: setup.seed)
        runner = MathCharacter(look: setup.look, height: 1.25)
        teacher = MathCharacter(look: setup.teacher, height: setup.teacherHeight)
        super.init()
        build()
    }

    private func build() {
        scene.rootNode.addChildNode(world)
        world.addChildNode(runner.node)
        world.addChildNode(teacher.node)

        let camera = SCNCamera()
        camera.fieldOfView = 66
        camera.zNear = 0.2
        camera.zFar = 220
        cameraNode.camera = camera
        scene.rootNode.addChildNode(cameraNode)

        sun.light = SCNLight()
        sun.light?.type = .directional
        sun.light?.castsShadow = true
        sun.light?.shadowMode = .forward
        sun.light?.shadowColor = UIColor(white: 0, alpha: 0.32)
        sun.light?.shadowRadius = 3
        sun.light?.shadowMapSize = CGSize(width: 1024, height: 1024)
        sun.light?.maximumShadowDistance = 45
        sun.light?.orthographicScale = 22
        sun.eulerAngles = SCNVector3(-1.05, 0.5, 0)
        scene.rootNode.addChildNode(sun)
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        scene.rootNode.addChildNode(ambient)

        // The board they ride when they've picked one up.
        let deck = MathShape.box(0.42, 0.06, 1.15, MathMat.color(setup.board.0), round: 0.03)
        boardNode.addChildNode(deck)
        for z: Float in [-0.38, 0.38] {
            for wx: Float in [-0.16, 0.16] {
                let wheel = MathShape.cylinder(0.07, 0.06, MathMat.color(setup.board.1), segments: 8)
                wheel.eulerAngles.z = .pi / 2
                boardNode.add(wheel, wx, -0.07, z)
            }
        }
        boardNode.position = SCNVector3(0, 0.12, 0)
        boardNode.isHidden = true
        runner.node.addChildNode(boardNode)

        // And the jetpack.
        jetNode.add(MathShape.box(0.36, 0.5, 0.2, MathMat.color("3498db"), round: 0.05), 0, 0.72, 0.26)
        for jx: Float in [-0.12, 0.12] {
            jetNode.add(MathShape.cone(0.1, 0.05, 0.22, MathMat.color("7f8c8d"), segments: 8), jx, 0.4, 0.26)
            let flame = SCNParticleSystem()
        flame.soft()
            flame.soft()
            flame.birthRate = 90
            flame.particleLifeSpan = 0.35
            flame.particleSize = 0.2
            flame.particleColor = UIColor(red: 1, green: 0.65, blue: 0.1, alpha: 1)
            flame.particleColorVariation = SCNVector4(0.05, 0.2, 0, 0)
            flame.particleVelocity = 3
            flame.emittingDirection = SCNVector3(0, -1, 0.4)
            flame.spreadingAngle = 12
            flame.blendMode = .additive
            let nozzle = SCNNode()
            nozzle.addParticleSystem(flame)
            jetNode.add(nozzle, jx, 0.3, 0.26)
        }
        jetNode.isHidden = true
        runner.node.addChildNode(jetNode)

        if let color = setup.trail {
            let t = SCNParticleSystem()
            t.soft()
            t.birthRate = 0
            t.particleLifeSpan = 0.6
            t.particleSize = 0.16
            t.particleSizeVariation = 0.08
            t.particleColor = MathLookKit.color(color)
            t.particleColorVariation = SCNVector4(0.08, 0.1, 0.1, 0)
            t.particleVelocity = 0.4
            t.spreadingAngle = 60
            t.blendMode = .additive
            t.isLocal = false
            let source = SCNNode()
            source.addParticleSystem(t)
            source.position = SCNVector3(0, 0.5, 0.3)
            runner.node.addChildNode(source)
            trail = t
        }

        runner.play("idle")
        teacher.play("idle")
        teacher.node.position = SCNVector3(0.6, 0, 3)
        level = setup.startLevel
        buildZone = MathZone.index(forLevel: level)
        gates = [(0, buildZone)]
        enter(zone: buildZone, announce: false)
        tilesAround()
        placeCamera(dt: 1)
    }

    // MARK: The frame

    func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
        let raw = last == 0 ? 0 : Float(time - last)
        last = time
        lock.lock()
        let pending = swipes
        swipes = []
        let reply = answered
        answered = nil
        let begin = wantsStart
        wantsStart = false
        let bonus = granted
        granted = 0
        let paused = held
        lock.unlock()

        guard !paused else { return }
        let dt = min(raw, 1 / 20)
        clock += dt
        stars += bonus

        if begin, phase == .idle { begin_() }
        if let reply, phase == .question { reply ? free() : end() }

        switch phase {
        case .idle:
            break
        case .running:
            for s in pending { handle(s) }
            if setup.auto { autopilot() }
            run(dt)
        case .caught:
            phaseClock += dt
            speed = max(0, speed - dt * 40)
            d += speed * dt
            if phaseClock > 0.85 {
                phase = .question
                DispatchQueue.main.async { [weak self] in self?.onCaught?() }
            }
        case .question, .over:
            break
        }

        runner.update(dt)
        teacher.update(dt)
        for tile in tiles.values { for p in tile.people { p.update(dt) } }
        place(dt)
        placeCamera(dt: dt)

        hudClock += dt
        if hudClock > 0.1 {
            hudClock = 0
            publish()
        }
    }

    private func publish() {
        var hud = HUD()
        hud.stars = stars
        hud.danger = min(1, max(0, intensity(wave)))
        hud.powers = powers.sorted { $0.key.rawValue < $1.key.rawValue }.map { PowerLeft(kind: $0.key, left: $0.value / $0.key.seconds) }
        hud.level = level
        hud.zone = MathZone.all[max(0, zoneNow)].name
        hud.depth = depth
        hud.distance = Int(d)
        DispatchQueue.main.async { [weak self] in self?.onHUD?(hud) }
    }


    // MARK: The wave's clock

    /// How hard it is `t` seconds into a wave: 0 at the start, 1 at thirty seconds, and on up.
    private func intensity(_ t: Float) -> Float { max(0, t - 2) / 28 }

    private func baseSpeed() -> Float { min(19.5, 11.5 + Float(level) * 0.65) }
    private func speed(at i: Float) -> Float { baseSpeed() * (1 + 0.32 * min(i, 1.6)) }
    /// Seconds between one row of things and the next.
    private func rowTime(_ i: Float) -> Float { i <= 1 ? 1.3 - 0.78 * i : max(0.34, 0.52 - 0.3 * (i - 1)) }
    /// Seconds of warning for something thrown.
    private func lead(_ i: Float) -> Float { i <= 1 ? 2.3 - 1.65 * i : max(0.36, 0.65 - 0.5 * (i - 1)) }

    // MARK: Starting, being caught, getting away

    private func begin_() {
        phase = .running
        speed = baseSpeed() * 0.7
        runner.play("sprint", speed: 1.4)
        teacher.play("sprint", speed: 1.3)
        teacherGap = 3.2
        wave = 0
        cursor = d + 34
        audio.play("bell", volume: 0.5)
        DispatchQueue.main.async { [weak self] in self?.onMoment?(.start) }
    }

    /// Plays the run by itself, for the simulator: looks a little way ahead and does the obvious thing.
    private func autopilot() {
        let reach = speed * 0.42
        func blocker(_ l: Int) -> Thing? {
            things.first { $0.live && $0.lane == l && $0.d > d - 0.5 && $0.d - d < reach + 2 }
        }
        func wall(_ l: Int) -> Bool {
            if let t = blocker(l), t.kind == .full { return true }
            return throwing.contains { $0.lane == l && $0.kind == .full && $0.d > d && $0.d - d < reach + 4 }
        }
        if wall(lane) || abs(x - Self.lanes[lane]) < 0.1 && blocker(lane)?.kind == .full {
            let options = [lane - 1, lane + 1].filter { (0...2).contains($0) && !wall($0) }
            if let to = options.first(where: { blocker($0) == nil }) ?? options.first { lane = to }
        }
        if let t = blocker(lane), t.d - d < reach {
            if t.kind == .low, grounded { handle(.up) }
            if t.kind == .high, roll <= 0.1 { handle(.down) }
        }
    }

    private func crash(into thing: Thing?) {
        guard phase == .running, safe <= 0, powers[.jetpack] == nil, !setup.god else { return }
        if powers[.board] != nil {
            // The board takes it.
            powers[.board] = nil
            boardNode.isHidden = true
            safe = 1.3
            shake = 0.5
            audio.play("shield-break")
            if let thing {
                thing.live = false
                thing.node.runAction(.sequence([.group([.moveBy(x: CGFloat(Float(thing.lane - 1) * 4 + 2), y: 5, z: -8, duration: 0.5),
                                                        .rotateBy(x: 4, y: 2, z: 3, duration: 0.5)]), .removeFromParentNode()]))
            }
            return
        }
        phase = .caught
        phaseClock = 0
        shake = 0.9
        roll = 0
        audio.play("crash")
        audio.play("caught", volume: 0.9, delay: 0.35)
        runner.play("die", loop: false, fade: 0.08)
        teacher.play("sprint", speed: 1.6)
        jetNode.isHidden = true
    }

    private func free() {
        phase = .running
        level += 1
        wave = 0
        safe = 2.0
        saidClose = false
        // What was coming is gone: a clear run to get going again.
        let clearTo = d + 44
        for thing in things where thing.d < clearTo && thing.d > d - 2 {
            thing.live = false
            thing.node.runAction(.sequence([.scale(to: 0.01, duration: 0.25), .removeFromParentNode()]))
        }
        for t in throwing { t.target?.removeFromParentNode(); t.missile?.removeFromParentNode() }
        throwing.removeAll()
        cursor = max(cursor, clearTo)
        if cursor > clearTo + 30 { regenerate(from: clearTo) }
        buildZone = MathZone.index(forLevel: level)
        speed = baseSpeed() * 0.8
        runner.play("sprint", speed: 1.5, restart: true)
        teacher.play("emote-no", loop: false)
        teacherBusy = 0.9
        teacherGap = 2.0
        audio.play("free")
        audio.play("wave-up", volume: 0.7, delay: 0.3)
        DispatchQueue.main.async { [weak self] in self?.onMoment?(.freed) }
    }

    /// Things were laid out for the old pace: take away what the runner hasn't reached and lay it again.
    private func regenerate(from: Float) {
        for thing in things where thing.d >= from {
            thing.live = false
            thing.node.removeFromParentNode()
        }
        for p in pickups where p.d >= from { p.node.removeFromParentNode() }
        pickups.removeAll { $0.d >= from }
        for p in platforms where p.start >= from { p.nodes.forEach { $0.removeFromParentNode() } }
        platforms.removeAll { $0.start >= from }
        cursor = from
    }

    private func end() {
        phase = .over
        teacher.play("emote-yes", loop: true)
        runner.play("sit", loop: false)
        audio.play("gameover")
    }

    // MARK: Running

    private func handle(_ s: Swipe) {
        switch s {
        case .left:
            if lane > 0 { lane -= 1; audio.play("lane", volume: 0.5) }
        case .right:
            if lane < 2 { lane += 1; audio.play("lane", volume: 0.5) }
        case .up:
            guard powers[.jetpack] == nil else { return }
            if grounded {
                let springs = powers[.springs] != nil
                vy = springs ? 15.6 : 11.4
                grounded = false
                roll = 0
                runner.play("jump", loop: false, fade: 0.06, restart: true)
                audio.play(springs ? "spring" : "jump", volume: 0.7)
            }
        case .down:
            guard powers[.jetpack] == nil else { return }
            if !grounded { vy = min(vy, -18) }
            if roll <= 0 {
                roll = 0.62
                runner.play("crouch", loop: false, fade: 0.05, restart: true)
                audio.play("slide", volume: 0.6)
            }
        }
    }

    private func run(_ dt: Float) {
        wave += dt
        safe = max(0, safe - dt)
        let i = intensity(wave)
        let want = speed(at: i)
        speed += (want - speed) * min(1, dt * 1.6)
        let step = speed * dt
        d += step

        // Sideways.
        let targetX = Self.lanes[lane]
        let dx = targetX - x
        let move = min(abs(dx), dt * 15)
        x += dx < 0 ? -move : move

        // Up and down.
        let flying = powers[.jetpack] != nil
        let ground = groundHeight(x: x, d: d)
        if flying {
            y += (3.7 - y) * min(1, dt * 4)
            vy = 0
            grounded = false
        } else {
            if ground > y + 0.55 {
                // Into the side of a bus. When nothing can catch them (just
                // freed, or the board took the hit) they go up onto the roof
                // rather than through it.
                if safe <= 0, !setup.god {
                    crash(into: nil)
                    return
                }
                y = ground
                vy = 0
                grounded = true
            }
            if !grounded {
                vy -= Self.gravity * dt
                y += vy * dt
            }
            if y <= ground {
                if !grounded {
                    grounded = true
                    if roll <= 0 { runner.play("sprint", fade: 0.08) }
                    audio.play("land", volume: 0.45)
                }
                y = ground
                vy = 0
            } else if grounded, y > ground + 0.05 {
                // Run off the end of something.
                grounded = false
                vy = 0
            }
        }
        if roll > 0 {
            roll -= dt
            if roll <= 0, grounded { runner.play("sprint", fade: 0.1) }
        }
        if grounded, roll <= 0, !flying, runner.current != "sprint", powers[.board] == nil { runner.play("sprint", fade: 0.1) }
        if !grounded, !flying, vy < -2, runner.current == "jump" { runner.play("fall", loop: false, fade: 0.15) }
        runner.setSpeed(0.9 + speed / 22)

        // Feet.
        if grounded, roll <= 0, powers[.board] == nil {
            stepClock -= dt
            if stepClock <= 0 {
                stepClock = max(0.16, 3.2 / speed)
                audio.play("step-\(1 + rng.int(4))", volume: 0.22)
            }
        }

        // Powers running down.
        for (kind, left) in powers {
            let now = left - dt
            if now <= 0 {
                powers[kind] = nil
                if kind == .board { boardNode.isHidden = true }
                if kind == .jetpack { jetNode.isHidden = true; safe = max(safe, 1.2); runner.play("fall", loop: false) }
            } else {
                powers[kind] = now
            }
        }
        trail?.birthRate = 60

        lay()
        throwThings(dt, i)
        collide()
        collect(dt)
        tilesAround()
        passGates()

        // The teacher gains as the wave wears on.
        if i > 0.72, !saidClose {
            saidClose = true
            DispatchQueue.main.async { [weak self] in self?.onMoment?(.close) }
        }
        starChainClock -= dt
        if starChainClock <= 0 { starChain = 0 }
    }

    private func groundHeight(x: Float, d: Float) -> Float {
        var h: Float = 0
        for p in platforms where abs(x - Self.lanes[p.lane]) < 0.8 {
            if d >= p.start && d <= p.end { h = max(h, p.top) } else if d >= p.start - p.ramp && d < p.start {
                h = max(h, p.top * (d - (p.start - p.ramp)) / p.ramp)
            }
        }
        return h
    }

    private func collide() {
        guard safe <= 0, powers[.jetpack] == nil else { return }
        let low = roll > 0
        for thing in things where thing.live {
            let dz = thing.d - d
            if dz > 3 { continue }
            if dz < -thing.half - 0.4 { continue }
            guard abs(dz) < thing.half + 0.38, abs(x - Self.lanes[thing.lane]) < 0.95 else { continue }
            let hit: Bool
            switch thing.kind {
            case .full: hit = y < 2.3
            case .low: hit = y < 0.72
            case .high: hit = !(low && y < 0.5)
            }
            if hit {
                crash(into: thing)
                return
            }
        }
    }

    private func collect(_ dt: Float) {
        let magnet = powers[.magnet] != nil
        var i = 0
        while i < pickups.count {
            var p = pickups[i]
            let dz = p.d - d
            if dz < -3 {
                p.node.removeFromParentNode()
                pickups.remove(at: i)
                continue
            }
            if p.power == nil, magnet, !p.pulled, dz < 9, dz > -1 { p.pulled = true }
            if p.pulled {
                let pull = min(1, dt * 12)
                p.x += (x - p.x) * pull
                p.y += (y + 0.7 - p.y) * pull
                p.d += (d - p.d) * pull
                p.node.position = SCNVector3(p.x, p.y, -p.d)
            }
            if abs(p.d - d) < 0.9, abs(p.x - x) < 0.95, abs(p.y - (y + 0.7)) < 1.25 {
                if let power = p.power {
                    take(power)
                } else {
                    stars += MathPay.pickup(double: powers[.double] != nil)
                    starChain = min(starChain + 1, 3)
                    starChainClock = 0.5
                    audio.play("star-\(starChain)", volume: 0.5)
                }
                p.node.removeFromParentNode()
                pickups.remove(at: i)
                continue
            }
            pickups[i] = p
            i += 1
        }
    }

    private func take(_ power: MathProps.Power) {
        powers[power] = power.seconds
        audio.play("power")
        switch power {
        case .board:
            boardNode.isHidden = false
            audio.play("board", volume: 0.7)
            runner.play("idle", fade: 0.15)
        case .jetpack:
            jetNode.isHidden = false
            roll = 0
            audio.play("jetpack", volume: 0.6)
            runner.play("fall", loop: false)
            // A sky full of stars to fly through.
            var lane = self.lane
            var at = d + 14
            while at < d + speed * power.seconds - 10 {
                for k in 0..<6 { addStar(lane: lane, d: at + Float(k) * 1.7, y: 4.3) }
                at += 14
                lane = min(2, max(0, lane + rng.pick([-1, 1])))
            }
        case .magnet:
            audio.play("magnet", volume: 0.6)
        case .springs, .double:
            break
        }
    }

    // MARK: Laying out what's ahead

    private func zone(at distance: Float) -> MathZone {
        var z = 0
        for g in gates where g.d <= distance { z = g.zone }
        return MathZone.all[z]
    }

    private func lay() {
        while cursor < d + 96 {
            let eta = max(0, (cursor - d) / max(speed, 8))
            let i = intensity(wave + eta)
            let i1 = min(i, 1)
            let zone = zone(at: cursor)
            let gap = speed(at: i) * rowTime(i)

            // A bus, now and then, where there are buses.
            if zone.buses, i < 0.55, rng.chance(0.14), !nearGate(cursor, within: 30) {
                bus(at: cursor + 4)
                cursor += 4 + 3.6 + 9 + 9
                continue
            }

            let previous = safeLane
            if rng.chance(0.25 + 0.6 * i1) {
                safeLane = min(2, max(0, safeLane + rng.pick([-1, 1])))
            }
            var row: [Thing.Kind?] = [nil, nil, nil]
            let block = 0.3 + 0.7 * i1
            for l in 0..<3 where l != safeLane {
                if rng.chance(block) {
                    row[l] = rng.chance(0.4 + 0.35 * i1) ? .full : (rng.chance(0.5) ? .low : .high)
                }
            }
            if rng.chance(0.12 + 0.6 * i1 + (i > 1 ? 0.15 : 0)) { row[safeLane] = rng.chance(0.5) ? .low : .high }
            // Never a clear row late in a wave, and never nothing at all early on.
            if row.allSatisfy({ $0 == nil }) { row[(safeLane + 1 + rng.int(2)) % 3] = rng.chance(0.5) ? .low : .full }

            let thrownShare = 0.25 + 0.75 * i1
            for l in 0..<3 {
                guard let kind = row[l] else { continue }
                if nearGate(cursor, within: 3) { continue }
                if rng.chance(thrownShare) {
                    throwing.append(Throw(lane: l, d: cursor, kind: kind, lead: lead(i) * rng.range(0.9, 1.15)))
                } else {
                    place(kind, lane: l, d: cursor, zone: zone)
                }
            }

            // Stars along the way through, over or under whatever's in it. Not
            // every row: they're the run's score now, and the answers should
            // be most of it (Shared/HousePay.swift), about 30 to a wave.
            if rng.chance(0.3) {
                let from = cursor - gap + 2.2
                let to = cursor + (row[safeLane] == nil ? 0 : 1.6)
                var at = max(from, cursor - 11)
                var k = 0
                while at <= to {
                    let near = abs(at - cursor)
                    var height: Float = 0.9
                    if row[safeLane] == .low, near < 3.2 { height = 0.9 + 1.5 * (1 - near / 3.2) }
                    if row[safeLane] == .high, near < 2 { height = 0.45 }
                    let from = Self.lanes[previous], toX = Self.lanes[safeLane]
                    let t = min(1, Float(k) / 3)
                    addStar(x: from + (toX - from) * t, d: at, y: height)
                    at += 1.7
                    k += 1
                }
            }

            // Something to pick up.
            nextPower -= rowTime(i)
            if nextPower <= 0 {
                nextPower = rng.range(15, 23)
                let kind = rng.pick(MathProps.Power.allCases)
                let node = MathProps.power(kind)
                let px = Self.lanes[safeLane], pd = cursor - gap * 0.5
                node.position = SCNVector3(px, 1.1, -pd)
                world.addChildNode(node)
                pickups.append(Pickup(node: node, d: pd, x: px, y: 1.1, power: kind))
            }
            cursor += max(4.6, gap)
        }
    }

    private func nearGate(_ at: Float, within: Float) -> Bool {
        gates.contains { abs($0.d - at) < within && $0.d > 0 }
    }

    private func place(_ kind: Thing.Kind, lane: Int, d at: Float, zone: MathZone) {
        let builders: [MathZone.Build]
        switch kind {
        case .low: builders = zone.low
        case .high: builders = zone.high
        case .full: builders = zone.full
        }
        let node = rng.pick(builders)(&rng)
        node.position = SCNVector3(Self.lanes[lane], 0, -at)
        world.addChildNode(node)
        things.append(Thing(node: node, lane: lane, d: at, half: kind == .high ? 0.3 : 0.6, kind: kind))
    }

    private func bus(at start: Float) {
        let lane = safeLane
        let ramp: Float = 3.6, length: Float = 9, top: Float = 2.52
        let plank = MathProps.ramp(height: top, length: ramp)
        plank.position = SCNVector3(Self.lanes[lane], 0, -(start + ramp / 2))
        plank.eulerAngles.y = .pi
        world.addChildNode(plank)
        let body = MathProps.bus(length: length)
        body.position = SCNVector3(Self.lanes[lane], 0, -(start + ramp + length / 2))
        world.addChildNode(body)
        platforms.append(Platform(lane: lane, start: start + ramp, end: start + ramp + length, ramp: ramp, top: top, nodes: [plank, body]))
        for k in 0..<6 { addStar(lane: lane, d: start + ramp + 1 + Float(k) * 1.5, y: top + 0.9) }
        // Something low in another lane, so the roof is the easy way.
        let other = (lane + 1 + rng.int(2)) % 3
        place(.low, lane: other, d: start + ramp + 4, zone: zone(at: start))
    }

    private func addStar(lane: Int, d at: Float, y: Float) { addStar(x: Self.lanes[lane], d: at, y: y) }

    private func addStar(x sx: Float, d at: Float, y: Float) {
        let node = MathProps.star()
        node.position = SCNVector3(sx, y, -at)
        node.eulerAngles.y = at * 0.4
        node.runAction(.repeatForever(.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 1.6)))
        world.addChildNode(node)
        pickups.append(Pickup(node: node, d: at, x: sx, y: y, power: nil))
    }

    // MARK: Thrown

    private func throwThings(_ dt: Float, _ i: Float) {
        teacherBusy = max(0, teacherBusy - dt)
        var k = 0
        while k < throwing.count {
            var t = throwing[k]
            let reach = (t.d - d) / max(speed, 1)
            if t.thrownAt < 0 {
                if reach <= t.lead {
                    // Out of the teacher's hand.
                    t.thrownAt = clock
                    t.flight = min(0.8, max(0.2, reach * 0.6))
                    let target = MathProps.target()
                    target.position = SCNVector3(Self.lanes[t.lane], 0.03, -t.d)
                    target.scale = SCNVector3(0.3, 0.3, 0.3)
                    target.runAction(.scale(to: 1, duration: Double(t.flight)))
                    world.addChildNode(target)
                    t.target = target
                    let missile = MathProps.projectile(&rng)
                    t.from = SCNVector3(teacher.node.position.x, 2.2, teacher.node.position.z)
                    missile.position = t.from
                    missile.runAction(.repeatForever(.rotateBy(x: 5, y: 3, z: 1, duration: 0.5)))
                    world.addChildNode(missile)
                    t.missile = missile
                    if teacherBusy <= 0 {
                        teacher.play("attack-melee-right", loop: false, speed: 1.4, fade: 0.05, restart: true)
                        teacherBusy = 0.3
                    }
                    audio.play("throw", volume: 0.55)
                    audio.play("warn", volume: 0.4)
                }
            } else {
                let p = min(1, (clock - t.thrownAt) / t.flight)
                let to = SCNVector3(Self.lanes[t.lane], 0.4, -t.d)
                let arc = 4.5 * sin(p * .pi)
                t.missile?.position = SCNVector3(t.from.x + (to.x - t.from.x) * p, t.from.y + (to.y - t.from.y) * p + arc, t.from.z + (to.z - t.from.z) * p)
                if p >= 1 {
                    t.missile?.removeFromParentNode()
                    t.target?.runAction(.sequence([.fadeOut(duration: 0.25), .removeFromParentNode()]))
                    land(t)
                    throwing.remove(at: k)
                    continue
                }
            }
            throwing[k] = t
            k += 1
        }
        if teacherBusy <= 0, teacher.current != "sprint", phase == .running { teacher.play("sprint", speed: 1.3) }
    }

    private func land(_ t: Throw) {
        let node: SCNNode
        switch t.kind {
        case .low: node = MathProps.problemLow(&rng)
        case .high: node = MathProps.problemHigh(&rng)
        case .full: node = MathProps.problemFull(&rng)
        }
        node.position = SCNVector3(Self.lanes[t.lane], 0, -t.d)
        node.scale = SCNVector3(0.4, 0.4, 0.4)
        node.runAction(.sequence([.scale(to: 1.12, duration: 0.07), .scale(to: 1, duration: 0.08)]))
        world.addChildNode(node)
        things.append(Thing(node: node, lane: t.lane, d: t.d, half: t.kind == .high ? 0.3 : 0.55, kind: t.kind))
        if t.d - d < 40 {
            audio.play("thud", volume: min(0.8, 8 / max(4, t.d - d)))
            shake = max(shake, 0.18)
        }
        // Dust where it came down.
        let dust = SCNParticleSystem()
        dust.soft()
        dust.birthRate = 160
        dust.emissionDuration = 0.08
        dust.loops = false
        dust.particleLifeSpan = 0.45
        dust.particleSize = 0.16
        dust.particleColor = UIColor(white: 1, alpha: 0.4)
        dust.particleVelocity = 2.4
        dust.spreadingAngle = 80
        dust.emittingDirection = SCNVector3(0, 1, 0)
        dust.blendMode = .alpha
        let puff = SCNNode()
        puff.position = SCNVector3(Self.lanes[t.lane], 0.1, -t.d)
        puff.addParticleSystem(dust)
        world.addChildNode(puff)
        puff.runAction(.sequence([.wait(duration: 1), .removeFromParentNode()]))
    }

    // MARK: Tiles and zones

    private func tilesAround() {
        let length = MathZone.tileLength
        let first = Int(floor((d - Self.behind) / length))
        let lastIndex = Int(floor((d + Self.ahead) / length))
        for index in max(0, first)...max(0, lastIndex) where tiles[index] == nil {
            make(tile: index)
        }
        for (index, tile) in tiles where index < first {
            tile.node.removeFromParentNode()
            tiles[index] = nil
        }
        // What's behind goes too.
        if things.count > 0, things[0].d < d - 12 {
            for thing in things where thing.d < d - 12 { thing.node.removeFromParentNode() }
            things.removeAll { $0.d < d - 12 || !$0.live && $0.d < d - 4 }
        }
        if let p = platforms.first, p.end < d - 14 {
            p.nodes.forEach { $0.removeFromParentNode() }
            platforms.removeFirst()
        }
    }

    private func make(tile index: Int) {
        let start = Float(index) * MathZone.tileLength
        var zoneIndex = gates.last?.zone ?? 0
        var gate = false
        if buildZone != zoneIndex, start > d + 20 {
            zoneIndex = buildZone
            gates.append((start, zoneIndex))
            gate = true
        }
        let zone = MathZone.all[zoneIndex]
        let variant = rng.int(MathZone.variants)
        let tile = MathTile(index: index, zone: zoneIndex, variant: variant)
        let key = "\(zone.key)-\(variant)"
        let proto: SCNNode
        if let hit = protos[key] {
            proto = hit
        } else {
            var seeded = MathRNG(seed: UInt64(variant * 31 + zoneIndex * 7 + 1))
            // One mesh for everything that stands still, bar the kit models.
            let built = zone.fixed(variant, &seeded)
            let kits = built.childNodes.filter { $0.name == MathModels.kitName }
            kits.forEach { $0.removeFromParentNode() }
            proto = SCNNode()
            proto.addChildNode(built.flattenedClone())
            kits.forEach { proto.addChildNode($0) }
            protos[key] = proto
        }
        tile.node.addChildNode(proto.clone())
        zone.live(tile, &rng)
        if gate { tile.node.addChildNode(zone.gate()) }
        tile.node.position = SCNVector3(0, 0, -start)
        world.addChildNode(tile.node)
        tiles[index] = tile
    }

    private func passGates() {
        var z = 0
        for g in gates where g.d <= d + 1 { z = g.zone }
        if z != zoneNow { enter(zone: z, announce: true) }
        // Old gates don't matter once they're well behind.
        while gates.count > 2, gates[1].d < d - 60 { gates.removeFirst() }
    }

    private func enter(zone index: Int, announce: Bool) {
        zoneNow = index
        depth = max(depth, level)
        let zone = MathZone.all[index]
        SCNTransaction.begin()
        SCNTransaction.animationDuration = announce ? 1.2 : 0
        scene.background.contents = MathLookKit.color(zone.sky)
        scene.fogColor = MathLookKit.color(zone.fog)
        scene.fogStartDistance = zone.fogNear
        scene.fogEndDistance = zone.fogFar
        sun.light?.color = MathLookKit.color(zone.sun.0)
        sun.light?.intensity = zone.sun.1
        ambient.light?.color = MathLookKit.color(zone.ambient.0)
        ambient.light?.intensity = zone.ambient.1
        SCNTransaction.commit()
        audio.setZone(sound: zone.sound, mood: zone.mood)
        if announce {
            audio.play("door", volume: 0.8)
            DispatchQueue.main.async { [weak self] in
                self?.onZone?(zone)
                self?.onMoment?(.zone(index))
            }
        }
    }

    // MARK: Where everything is

    private func place(_ dt: Float) {
        let lean = (Self.lanes[lane] - x) * 0.22
        runner.node.position = SCNVector3(x, y, -d)
        var tilt: Float = 0
        if roll > 0 {
            // A forward roll under whatever it is.
            tilt = -(1 - roll / 0.62) * 2 * .pi
        } else if powers[.jetpack] != nil {
            tilt = -0.5
        }
        runner.figure.pivot = SCNMatrix4MakeTranslation(0, roll > 0 ? 0.3 : 0, 0)
        runner.figure.position = SCNVector3(0, roll > 0 ? 0.42 : (powers[.board] != nil ? 0.18 : 0), 0)
        runner.figure.eulerAngles = SCNVector3(tilt, .pi, -lean)
        boardNode.eulerAngles.z = -lean * 0.6
        // Blinking while nothing can touch them.
        runner.node.opacity = safe > 0 && phase == .running && Int(clock * 12) % 2 == 0 ? 0.45 : 1

        // The teacher: well back at the start of a wave, at their shoulder by the end.
        let i = min(1, max(0, intensity(wave)))
        let wanted: Float
        switch phase {
        case .idle: wanted = 3
        case .running: wanted = 7.6 - 4.1 * i
        case .caught, .question: wanted = 1.25
        case .over: wanted = 1.1
        }
        teacherGap += (wanted - teacherGap) * min(1, dt * (phase == .running ? 0.9 : 5))
        // Off to whichever side has room, so the way ahead stays in view.
        let beside: Float = phase == .running ? (x > 0.3 ? -1.3 : 1.3) : 0.5
        let tx = teacher.node.position.x + (x + beside - teacher.node.position.x) * min(1, dt * 3)
        teacher.node.position = SCNVector3(tx, 0, -d + teacherGap)
        if phase == .question || phase == .over || phase == .caught {
            if teacher.current == "sprint", teacherGap < 1.6 { teacher.play("holding-both", loop: false, fade: 0.2) }
        }

        // The sun's shadow follows the run.
        sun.position = SCNVector3(x, 20, -d - 8)
    }

    private func placeCamera(dt: Float) {
        shake = max(0, shake - dt * 2.2)
        let jitter = shake > 0 ? SCNVector3(Float.random(in: -1...1) * shake * 0.25, Float.random(in: -1...1) * shake * 0.25, 0) : SCNVector3Zero
        let follow: Float = 0.78
        var eye = SCNVector3(x * follow, 3.5 + y * 0.55, -d + 5.6)
        var look = SCNVector3(x * 0.85, 1.25 + y * 0.6, -d - 7.5)
        if phase == .question || phase == .over {
            // From in front, over the card: the two of them, caught.
            // From over their shoulders, the pair of them high in the frame: the card has the rest.
            let side: Float = x > 0.5 ? -1 : 1
            eye = SCNVector3(x + side * 3.2, 4.2 + y, -d + 5.5)
            look = SCNVector3(x, -2.2 + y, -d - 1.5)
        }
        if phase == .idle {
            // On the home screen: face to face, with the teacher waiting behind.
            eye = SCNVector3(1.5, 1.35, -d - 4.6)
            look = SCNVector3(-0.25, 1.15, -d)
        }
        if phase == .running { sinceStart += dt }
        // The first second swings round from the home screen's view to behind them.
        let ease = min(1, dt * (phase == .idle ? 30 : phase == .running ? (sinceStart < 1.3 ? 3.2 : 9) : 2.5))
        let p = cameraNode.position
        cameraNode.position = SCNVector3(p.x + (eye.x - p.x) * ease + jitter.x, p.y + (eye.y - p.y) * ease + jitter.y, p.z + (eye.z - p.z) * ease)
        cameraNode.look(at: look)
        cameraNode.camera?.fieldOfView = CGFloat(62 + min(14, speed * 0.55))
    }
}
