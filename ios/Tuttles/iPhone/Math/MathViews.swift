import MasonKit
import SceneKit
import SwiftUI

// Math's screens. One 3D view sits under all of them: on the home screen the
// kid stands in the hallway with the teacher waiting behind; "Run" sets them
// going in the same scene, the way Subway Surfers starts.

struct MathHomeView: View {
    @Environment(ChatStore.self) private var store

    var body: some View {
        if store.showingParentView {
            MathParentView()
        } else {
            MathPlayView()
        }
    }
}

/// A run in progress, and what's around it: which question is up, what's been
/// answered, what the teacher last said.
@MainActor
@Observable
final class MathSession {
    enum Stage: Equatable { case home, running, question, over }

    struct Ending {
        let run: MathRun
        let missed: MathQuestion?
        let chosen: Int?
        let line: String
        let goalBonus: Int
        let newBest: Bool
    }

    var stage = Stage.home
    var hud = MathGame.HUD()
    var game: MathGame
    var paused = false
    var bubble: String?
    var banner: String?
    var question: MathQuestion?
    var line = ""
    var deadline = Date()
    var total: TimeInterval = 60
    /// Set once the question's answered: the choice, or nil inside for the clock.
    var chosen: Int??
    var paid = 0
    var ending: Ending?
    var goalJustReached = false

    @ObservationIgnored private var run: MathRun?
    @ObservationIgnored private var asked: Set<String> = []
    @ObservationIgnored private var streak = 0
    @ObservationIgnored private var bubbleID = 0
    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored private var goalBonus = 0
    /// Stars from answers, shown in the run's count but already in the purse.
    @ObservationIgnored private var granted = 0
    private let store = MathStore.shared
    private let audio = MathAudio.shared

    init() {
        game = Self.makeGame()
        wire()
    }

    private static func makeGame() -> MathGame {
        let store = MathStore.shared
        var setup = MathGame.Setup(look: store.look, teacher: MathCatalog.items.first { $0.id == "teacher-grey" }.flatMap {
            if case .teacher(let look, _) = $0.what { return look }
            return nil
        } ?? .plain)
        if let teacher = store.worn("teacher"), case .teacher(var look, let height) = teacher.what {
            // The Other You wears what you're wearing.
            if teacher.id == "teacher-you" {
                let mine = store.look
                look.head = mine.head
                look.body = mine.body
            }
            setup.teacher = look
            setup.teacherHeight = height
        }
        if let board = store.worn("board"), case .board(let deck, let wheels) = board.what { setup.board = (deck, wheels) }
        if let trail = store.worn("trail"), case .trail(let color) = trail.what { setup.trail = color }
        MathZone.you = setup.look
        return MathGame(setup: setup, audio: MathAudio.shared)
    }

    private func wire() {
        game.onHUD = { [weak self] hud in self?.hud = hud }
        game.onCaught = { [weak self] in self?.caught() }
        game.onZone = { [weak self] zone in self?.show(banner: zone.name) }
        game.onMoment = { [weak self] moment in
            guard let self else { return }
            let teacher = MathStore.shared.worn("teacher")?.id
            switch moment {
            case .start: self.say(MathTeacherLines.line(.start, teacher: teacher))
            case .close: self.say(MathTeacherLines.line(.close, teacher: teacher))
            case .zone(let index): if let door = MathTeacherLines.door(MathZone.all[index].key) { self.say(door) }
            case .freed: break
            }
        }
    }

    /// A fresh scene on the home screen, wearing whatever's now on.
    func reset() {
        timer?.cancel()
        game = Self.makeGame()
        wire()
        hud = MathGame.HUD()
        stage = .home
        question = nil
        chosen = nil
        ending = nil
        paused = false
        bubble = nil
        banner = nil
        audio.setMusic("music-menu")
        audio.setZone(sound: "amb-hall", mood: 0)
    }

    func start() {
        guard stage == .home else { return }
        run = MathRun(id: UUID(), startedAt: Date(), endedAt: Date(), score: 0, distance: 0, waves: 0, depth: 0, stars: 0, answered: 0, correct: 0, bestStreak: 0)
        asked = []
        streak = 0
        goalBonus = 0
        granted = 0
        stage = .running
        audio.setMusic("music-run")
        game.start()
    }

    func pause(_ on: Bool) {
        guard stage == .running else { return }
        paused = on
        game.hold(on)
    }

    private func say(_ text: String) {
        guard !text.isEmpty else { return }
        bubble = text
        bubbleID += 1
        let id = bubbleID
        audio.play("voice-\(Int.random(in: 1...5))", volume: 0.6)
        Task {
            try? await Task.sleep(for: .seconds(3.4))
            if bubbleID == id { bubble = nil }
        }
    }

    private func show(banner text: String) {
        banner = text
        Task {
            try? await Task.sleep(for: .seconds(2.6))
            if banner == text { banner = nil }
        }
    }

    // MARK: The question

    private func caught() {
        guard stage == .running else { return }
        guard let q = store.nextQuestion(runLevel: hud.level, asked: asked) else {
            // No questions at all: nothing to hold them with.
            game.answer(correct: true)
            return
        }
        asked.insert(q.id)
        question = q
        chosen = nil
        paid = 0
        line = MathTeacherLines.line(.caught, teacher: store.worn("teacher")?.id)
        total = TimeInterval(q.seconds)
        deadline = Date().addingTimeInterval(total)
        stage = .question
        bubble = nil
        audio.play("voice-\(Int.random(in: 1...5))", volume: 0.7)
        timer?.cancel()
        timer = Task { [weak self] in
            // The last ten seconds tick; then time's up.
            while !Task.isCancelled {
                guard let self, self.stage == .question, self.chosen == nil else { return }
                let left = self.deadline.timeIntervalSinceNow
                if left <= 0 {
                    self.answer(nil)
                    return
                }
                if left <= 10 { self.audio.play("tick-urgent", volume: 0.6) } else if Int(left) % 5 == 0 { self.audio.play("tick", volume: 0.3) }
                try? await Task.sleep(for: .seconds(min(1, max(0.05, left.truncatingRemainder(dividingBy: 1) + 0.02))))
            }
        }
    }

    func answer(_ choice: Int?) {
        guard stage == .question, chosen == nil, let q = question, var run else { return }
        timer?.cancel()
        let left = max(0, deadline.timeIntervalSinceNow)
        let correct = choice == q.answer
        chosen = .some(choice)
        streak = correct ? streak + 1 : 0
        let record = MathAnswer(id: UUID(), run: run.id, question: q.id, topic: q.topic, section: q.section, difficulty: q.difficulty,
                                chosen: choice, correct: correct, ms: Int((total - left) * 1000), at: Date())
        let before = store.goalReachedToday
        let result = store.record(record, question: q, left: left / max(1, total), streak: streak)
        paid = result.stars
        goalBonus += result.goalBonus
        if !before, store.goalReachedToday {
            goalJustReached = true
            audio.play("goal", volume: 0.8, delay: 0.5)
        }
        run.answered += 1
        if correct { run.correct += 1 }
        run.bestStreak = max(run.bestStreak, streak)
        self.run = run
        audio.play(correct ? "correct" : "wrong")
        let teacher = store.worn("teacher")?.id
        Task {
            try? await Task.sleep(for: .seconds(correct ? 1.1 : 1.5))
            if correct {
                self.game.grant(stars: self.paid)
                self.granted += self.paid
                self.game.answer(correct: true)
                self.stage = .running
                self.question = nil
                self.say(MathTeacherLines.line(.right, teacher: teacher))
            } else {
                self.game.answer(correct: false)
                self.finish(missed: q, chosen: choice, line: MathTeacherLines.line(choice == nil ? .timeout : .wrong, teacher: teacher))
            }
        }
    }

    /// The run's over: by a wrong answer, or by giving up from the pause screen.
    func finish(missed: MathQuestion? = nil, chosen: Int? = nil, line: String = "") {
        guard var run else { return }
        timer?.cancel()
        run.endedAt = Date()
        run.score = hud.score
        run.distance = hud.distance
        run.waves = hud.level
        run.depth = hud.depth
        run.stars = hud.stars
        let best = run.score > store.wallet.bestScore && store.wallet.bestScore > 0
        store.finish(run, pickedUp: max(0, hud.stars - granted))
        ending = Ending(run: run, missed: missed, chosen: chosen, line: line, goalBonus: goalBonus, newBest: best)
        self.run = nil
        paused = false
        game.hold(false)
        stage = .over
        audio.setMusic("music-menu")
    }

    /// Leaving the screen mid-run: keep what was earned.
    func leave() {
        if stage == .running || stage == .question { finish() }
        timer?.cancel()
        audio.rest()
    }
}

struct MathPlayView: View {
    @Environment(ChatStore.self) private var store
    @Environment(SideMenuState.self) private var menu: SideMenuState?
    @Environment(\.scenePhase) private var scenePhase
    @State private var session: MathSession?
    @State private var showingShop = false
    @State private var fired = false
    private let math = MathStore.shared

    var body: some View {
        ZStack {
            if let session {
                MathSceneView(game: session.game)
                    .ignoresSafeArea()
                    .gesture(swipes(session))
                overlay(session)
            } else {
                Color.black.ignoresSafeArea()
                ProgressView().tint(.white)
            }
        }
        .toolbar(session?.stage == .home || session == nil ? .visible : .hidden, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationTitle("")
        .statusBarHidden(session?.stage == .running)
        .task {
            guard session == nil else { return }
            let owner = store.ownerID ?? UUID(uuidString: "00000000-0000-0000-0000-00000000d0e0")!
            let demoName = CommandLine.arguments.contains("--math-oscar") ? "Oscar" : "Sebastian"
            math.open(for: owner, name: store.isDemo ? demoName : store.actingKid?.name ?? Session.shared.name?.split(separator: " ").first.map(String.init),
                      level: store.vocabLocal?.base.level)
            if let at = CommandLine.arguments.firstIndex(of: "--math-stars"), CommandLine.arguments.count > at + 1, let n = Int(CommandLine.arguments[at + 1]) {
                math.demo(stars: n)
            }
            if store.isDemo, math.level == nil { math.setLevel(CommandLine.arguments.contains("--math-lower") ? .lower : .middle) }
            MathAudio.shared.prepare()
            let made = MathSession()
            session = made
            MathAudio.shared.setMusic("music-menu")
            MathAudio.shared.setZone(sound: "amb-hall", mood: 0)
            await math.sync(with: store)
            if CommandLine.arguments.contains("--math-run") { made.start() }
            if CommandLine.arguments.contains("--math-shop") { showingShop = true }
        }
        .onChange(of: session?.stage) { _, stage in
            menu?.locked = stage != nil && stage != .home
            if stage == .over || stage == .home { Task { await math.sync(with: store) } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { session?.pause(true) } else { MathAudio.shared.prepare() }
        }
        .onDisappear {
            session?.leave()
            menu?.locked = false
        }
        .sheet(isPresented: $showingShop, onDismiss: { session?.reset() }) {
            MathShopView()
        }
    }

    private func swipes(_ session: MathSession) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                guard session.stage == .running, !session.paused, !fired else { return }
                let t = value.translation
                guard max(abs(t.width), abs(t.height)) > 22 else { return }
                fired = true
                if abs(t.width) > abs(t.height) {
                    session.game.swipe(t.width > 0 ? .right : .left)
                } else {
                    session.game.swipe(t.height > 0 ? .down : .up)
                }
            }
            .onEnded { _ in fired = false }
    }

    @ViewBuilder private func overlay(_ session: MathSession) -> some View {
        switch session.stage {
        case .home:
            MathHomeOverlay(start: { session.start() }, shop: { showingShop = true })
                .transition(.opacity)
        case .running:
            MathHUDView(session: session)
        case .question:
            if let q = session.question {
                ZStack {
                    Color.black.opacity(0.35).ignoresSafeArea()
                    MathQuestionCard(question: q, line: session.line, deadline: session.deadline, total: session.total,
                                     chosen: session.chosen, paid: session.paid) { session.answer($0) }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        case .over:
            if let ending = session.ending {
                MathOverView(ending: ending, again: {
                    session.reset()
                    session.start()
                }, done: { session.reset() })
                    .transition(.opacity)
            }
        }
    }
}

/// The 3D view. It keeps drawing whatever `game` it's handed.
struct MathSceneView: UIViewRepresentable {
    let game: MathGame

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.antialiasingMode = .multisampling2X
        view.preferredFramesPerSecond = 60
        view.rendersContinuously = true
        view.backgroundColor = .black
        view.isJitteringEnabled = false
        attach(view)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        if view.scene !== game.scene { attach(view) }
    }

    private func attach(_ view: SCNView) {
        view.scene = game.scene
        view.pointOfView = game.cameraNode
        view.delegate = game
        view.isPlaying = true
    }
}

// MARK: Home

struct MathHomeOverlay: View {
    let start: () -> Void
    let shop: () -> Void
    private let math = MathStore.shared

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                MathStarsPill(stars: math.stars)
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            Text("MATH")
                .font(.system(size: 54, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.45), radius: 0, x: 0, y: 4)
                .padding(.top, 4)
            Text(math.level?.name ?? "ISEE")
                .font(.system(.subheadline, design: .rounded).weight(.bold))
                .foregroundStyle(.white.opacity(0.9))
                .shadow(color: .black.opacity(0.4), radius: 2, y: 1)
            Spacer()
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    goal
                    board
                }
                HStack(spacing: 12) {
                    Button(action: shop) {
                        Label("Shop", systemImage: "bag.fill")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .foregroundStyle(.primary)
                            .frame(width: 118, height: 58)
                    }
                    .glassEffect(.regular.interactive(), in: .capsule)
                    Button(action: start) {
                        Label("Run", systemImage: "figure.run")
                            .font(.system(.title2, design: .rounded).weight(.black))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 58)
                    }
                    .glassEffect(.regular.tint(TuttlesLook.accent).interactive(), in: .capsule)
                    .frame(maxWidth: .infinity)
                    .layoutPriority(1)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }

    private var goal: some View {
        let done = min(math.answeredToday, MathStore.dayGoal)
        return HStack(spacing: 12) {
            ZStack {
                Circle().stroke(Color.primary.opacity(0.12), lineWidth: 7)
                Circle().trim(from: 0, to: CGFloat(done) / CGFloat(MathStore.dayGoal))
                    .stroke(done >= MathStore.dayGoal ? Color.green : TuttlesLook.accent, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                if done >= MathStore.dayGoal {
                    Image(systemName: "checkmark").font(.headline.weight(.black)).foregroundStyle(.green)
                } else {
                    Text("\(done)").font(.system(.headline, design: .rounded).weight(.heavy))
                }
            }
            .frame(width: 46, height: 46)
            VStack(alignment: .leading, spacing: 2) {
                Text(done >= MathStore.dayGoal ? "Done for today" : "\(MathStore.dayGoal - done) to go today")
                    .font(.system(.subheadline, design: .rounded).weight(.bold))
                Text(math.streak > 0 ? "\(math.streak) day\(math.streak == 1 ? "" : "s") in a row" : "\(MathStore.dayGoal) questions a day")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }

    private var board: some View {
        VStack(alignment: .leading, spacing: 5) {
            let rows = math.board.sorted { $0.bestScore > $1.bestScore }
            if rows.isEmpty {
                Text("Best").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                Text(math.wallet.bestScore.formatted()).font(.system(.title3, design: .rounded).weight(.heavy))
            } else {
                ForEach(Array(rows.prefix(3).enumerated()), id: \.element.id) { place, row in
                    HStack(spacing: 6) {
                        Text("\(place + 1)").font(.caption.weight(.heavy)).foregroundStyle(.secondary)
                        Text(row.name).font(.system(.subheadline, design: .rounded).weight(row.me ? .heavy : .medium)).lineLimit(1)
                        Spacer(minLength: 2)
                        Text(max(row.bestScore, row.me ? math.wallet.bestScore : 0).formatted())
                            .font(.system(.subheadline, design: .rounded).weight(.bold).monospacedDigit())
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

struct MathStarsPill: View {
    let stars: Int

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "star.fill").foregroundStyle(.yellow)
            Text(stars.formatted()).font(.system(.headline, design: .rounded).weight(.heavy).monospacedDigit())
                .contentTransition(.numericText())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .glassEffect(.regular, in: .capsule)
    }
}

// MARK: Over the run

struct MathHUDView: View {
    let session: MathSession

    var body: some View {
        let hud = session.hud
        ZStack {
            VStack(spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(hud.score.formatted())
                            .font(.system(size: 34, weight: .black, design: .rounded).monospacedDigit())
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.55), radius: 0, x: 0, y: 2)
                        HStack(spacing: 6) {
                            Text("×\(hud.multiplier)")
                                .font(.system(.subheadline, design: .rounded).weight(.black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(hud.multiplier > 1 ? Color.purple : Color.black.opacity(0.35), in: .capsule)
                            Text("Wave \(hud.level + 1)")
                                .font(.system(.caption, design: .rounded).weight(.bold))
                                .foregroundStyle(.white.opacity(0.9))
                                .shadow(color: .black.opacity(0.5), radius: 1, y: 1)
                        }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 6) {
                        HStack(spacing: 8) {
                            HStack(spacing: 4) {
                                Image(systemName: "star.fill").foregroundStyle(.yellow)
                                Text("\(hud.stars)").font(.system(.headline, design: .rounded).weight(.heavy).monospacedDigit()).foregroundStyle(.white)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(.black.opacity(0.35), in: .capsule)
                            Button { session.pause(true) } label: {
                                Image(systemName: "pause.fill").font(.headline).foregroundStyle(.white)
                                    .frame(width: 40, height: 40)
                                    .background(.black.opacity(0.35), in: .circle)
                            }
                            .accessibilityLabel("Pause")
                        }
                        ForEach(hud.powers, id: \.kind) { power in
                            HStack(spacing: 6) {
                                Text(power.kind.symbol).font(.subheadline.weight(.heavy))
                                Capsule().fill(.white.opacity(0.3)).frame(width: 64, height: 7)
                                    .overlay(alignment: .leading) {
                                        Capsule().fill(Color(MathLookKit.color(power.kind.color))).frame(width: 64 * CGFloat(power.left), height: 7)
                                    }
                            }
                            .padding(.horizontal, 9).padding(.vertical, 5)
                            .background(.black.opacity(0.35), in: .capsule)
                            .foregroundStyle(.white)
                        }
                    }
                }
                danger(hud.danger)
                if let banner = session.banner {
                    Text(banner.uppercased())
                        .font(.system(.title2, design: .rounded).weight(.black))
                        .tracking(2)
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.7), radius: 4, y: 2)
                        .padding(.top, 26)
                        .transition(.scale(scale: 0.8).combined(with: .opacity))
                }
                Spacer()
                if let bubble = session.bubble {
                    HStack {
                        Text(bubble)
                            .font(.system(.subheadline, design: .serif).italic())
                            .foregroundStyle(.black)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(.white.opacity(0.94), in: .rect(cornerRadius: 16))
                            .overlay(alignment: .bottomLeading) {
                                Image(systemName: "arrowtriangle.down.fill").font(.caption).foregroundStyle(.white.opacity(0.94)).offset(x: 22, y: 9)
                            }
                            .frame(maxWidth: 270, alignment: .leading)
                        Spacer()
                    }
                    .padding(.bottom, 118)
                    .transition(.scale(scale: 0.7, anchor: .bottomLeading).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 4)
            .animation(.snappy(duration: 0.25), value: session.bubble)
            .animation(.snappy(duration: 0.3), value: session.banner)
            .allowsHitTesting(!session.paused)

            if session.paused {
                Color.black.opacity(0.55).ignoresSafeArea()
                VStack(spacing: 14) {
                    Text("Paused").font(.system(size: 40, weight: .black, design: .rounded)).foregroundStyle(.white)
                    Button { session.pause(false) } label: {
                        Label("Keep running", systemImage: "play.fill")
                            .font(.system(.title3, design: .rounded).weight(.heavy)).foregroundStyle(.white)
                            .frame(width: 240, height: 56)
                    }
                    .glassEffect(.regular.tint(TuttlesLook.accent).interactive(), in: .capsule)
                    Button { session.finish() } label: {
                        Text("Give up").font(.system(.headline, design: .rounded).weight(.bold)).foregroundStyle(.white)
                            .frame(width: 240, height: 50)
                    }
                    .glassEffect(.regular.interactive(), in: .capsule)
                    MathSoundToggles().padding(.top, 8)
                }
            }
        }
    }

    /// How close the teacher is.
    private func danger(_ value: Float) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.black.opacity(0.3))
                Capsule()
                    .fill(LinearGradient(colors: [.green, .yellow, .red], startPoint: .leading, endPoint: .trailing))
                    .mask(alignment: .leading) { Rectangle().frame(width: max(6, geo.size.width * CGFloat(value))) }
                Text("🧑‍🏫").font(.caption)
                    .offset(x: max(0, geo.size.width * CGFloat(value) - 16))
            }
        }
        .frame(height: 9)
        .padding(.top, 2)
        .accessibilityLabel("Teacher")
        .accessibilityValue("\(Int(value * 100)) percent")
    }
}

struct MathSoundToggles: View {
    private let math = MathStore.shared

    var body: some View {
        HStack(spacing: 14) {
            toggle("Music", "music.note", on: math.musicOn) { math.musicOn.toggle() }
            toggle("Sounds", "speaker.wave.2.fill", on: math.effectsOn) { math.effectsOn.toggle() }
        }
    }

    private func toggle(_ title: String, _ symbol: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: on ? symbol : "speaker.slash.fill")
                .font(.system(.subheadline, design: .rounded).weight(.bold))
                .foregroundStyle(.white.opacity(on ? 1 : 0.55))
                .padding(.horizontal, 14).padding(.vertical, 9)
        }
        .glassEffect(.regular.interactive(), in: .capsule)
    }
}

// MARK: Game over

struct MathOverView: View {
    let ending: MathSession.Ending
    let again: () -> Void
    let done: () -> Void
    private let math = MathStore.shared

    var body: some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    Text(ending.missed == nil ? "Run over" : "Caught")
                        .font(.system(size: 46, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                        .padding(.top, 24)
                    if !ending.line.isEmpty {
                        Text("“\(ending.line)”")
                            .font(.system(.body, design: .serif).italic())
                            .foregroundStyle(.white.opacity(0.85))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                    VStack(spacing: 4) {
                        Text(ending.run.score.formatted())
                            .font(.system(size: 60, weight: .black, design: .rounded).monospacedDigit())
                            .foregroundStyle(.white)
                        Text(ending.newBest ? "A new best" : "Best \(math.wallet.bestScore.formatted())")
                            .font(.system(.subheadline, design: .rounded).weight(.bold))
                            .foregroundStyle(ending.newBest ? .yellow : .white.opacity(0.7))
                    }
                    HStack(spacing: 10) {
                        stat("\(ending.run.stars)", "stars", "star.fill", .yellow)
                        stat("\(ending.run.correct)/\(ending.run.answered)", "right", "checkmark.circle.fill", .green)
                        stat("\(ending.run.distance) m", MathZone.all[MathZone.index(forLevel: ending.run.depth)].name, "figure.run", .white)
                    }
                    .padding(.horizontal, 14)
                    if ending.goalBonus > 0 {
                        Label("Today's 20 done: +\(ending.goalBonus) stars", systemImage: "checkmark.seal.fill")
                            .font(.system(.subheadline, design: .rounded).weight(.heavy))
                            .foregroundStyle(.green)
                    } else if !math.goalReachedToday {
                        Text("\(max(0, MathStore.dayGoal - math.answeredToday)) more questions for today")
                            .font(.system(.subheadline, design: .rounded).weight(.semibold))
                            .foregroundStyle(.white.opacity(0.75))
                    }
                    if let q = ending.missed { missed(q) }
                    Color.clear.frame(height: 120)
                }
            }
            VStack {
                Spacer()
                HStack(spacing: 12) {
                    Button(action: done) {
                        Text("Done").font(.system(.headline, design: .rounded).weight(.heavy)).foregroundStyle(.white)
                            .frame(width: 104, height: 58)
                    }
                    .glassEffect(.regular.interactive(), in: .capsule)
                    Button(action: again) {
                        Label("Run again", systemImage: "arrow.clockwise")
                            .font(.system(.title3, design: .rounded).weight(.black)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 58)
                    }
                    .glassEffect(.regular.tint(TuttlesLook.accent).interactive(), in: .capsule)
                    .layoutPriority(1)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
        }
    }

    private func stat(_ value: String, _ label: String, _ symbol: String, _ tint: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(value).font(.system(.title3, design: .rounded).weight(.heavy)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(.white.opacity(0.7)).lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(.white.opacity(0.1), in: .rect(cornerRadius: 18))
    }

    /// The one that ended it, with how it's done (Andrew: the miss is taught).
    private func missed(_ q: MathQuestion) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(ending.chosen == nil ? "The one you ran out of time on" : "The one that got you")
                .font(.system(.caption, design: .rounded).weight(.heavy))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            MathQuestionBody(question: q, size: 18)
            if let chosen = ending.chosen, q.choices.indices.contains(chosen) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                    MathText("You said: " + q.choices[chosen], size: 16, weight: .semibold)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                MathText("Answer: " + q.choices[q.answer], size: 16, weight: .heavy)
            }
            if !q.explanation.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(q.explanation.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                        MathText(line, size: 16)
                    }
                }
            }
            Text("It'll come round again.")
                .font(.system(.caption, design: .serif).italic())
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: .rect(cornerRadius: 24))
        .padding(.horizontal, 14)
    }
}
