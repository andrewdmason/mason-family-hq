import MasonKit
import SceneKit
import SwiftUI

// Math's screens. One 3D view sits under all of them: on the home screen the
// kid stands in the hallway with the teacher waiting behind; "Run" sets them
// going in the same scene, the way Subway Surfers starts.

struct MathHomeView: View {
    var body: some View {
        if let at = CommandLine.arguments.firstIndex(of: "--math-figures"), CommandLine.arguments.count > at + 2 {
            MathFigureGallery(level: CommandLine.arguments[at + 1] == "lower" ? .lower : .middle, from: Int(CommandLine.arguments[at + 2]) ?? 0)
        } else {
            MathPlayView()
        }
    }
}

/// For the simulator (`--math-figures middle 12`): the questions that have a
/// figure, six to a screen from the given one, to check how they draw.
private struct MathFigureGallery: View {
    let level: VocabLevel
    let from: Int

    var body: some View {
        let questions = Array(MathBank.questions(level).filter { $0.diagram != nil }.dropFirst(from).prefix(6))
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
            ForEach(questions) { q in
                VStack(alignment: .leading, spacing: 3) {
                    Text(q.id).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                    MathText(q.prompt, size: 10)
                    if let d = q.diagram { MathDiagramView(diagram: d) }
                }
                .padding(6)
                .background(Color.tuttlesCard, in: .rect(cornerRadius: 10))
            }
        }
        .padding(6)
        .frame(maxHeight: .infinity, alignment: .top)
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
        /// The coins its stars made (MathPay.coins).
        let coins: Int
        var gem = false
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
    /// The run made the day a strong one: a gem.
    @ObservationIgnored private var gem = false
    private let store = MathStore.shared
    private let audio = MathAudio.shared

    init() {
        game = Self.makeGame()
        wire()
    }

    private static func makeGame() -> MathGame {
        let store = MathStore.shared
        var setup = MathGame.Setup(look: store.look, teacher: MathCast.teacher)
        setup.teacherHeight = MathCast.teacherHeight
        MathZone.you = setup.look
        return MathGame(setup: setup, audio: MathAudio.shared)
    }

    private func wire() {
        game.onHUD = { [weak self] hud in self?.hud = hud }
        game.onCaught = { [weak self] in self?.caught() }
        game.onZone = { [weak self] zone in self?.show(banner: zone.name) }
        game.onMoment = { [weak self] moment in
            guard let self else { return }
            let teacher: String? = MathCast.teacherID
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
        gem = false
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
        line = MathTeacherLines.line(.caught, teacher: MathCast.teacherID)
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
        // The choices were shuffled for the screen; what's kept is where the
        // one tapped sits in the bank, which is what a parent's phone reads.
        let banked = choice.flatMap { i in q.choices.indices.contains(i) ? MathBank.question(q.id)?.choices.firstIndex(of: q.choices[i]) : nil } ?? choice
        let record = MathAnswer(id: UUID(), run: run.id, question: q.id, topic: q.topic, section: q.section, difficulty: q.difficulty,
                                chosen: banked, correct: correct, ms: Int((total - left) * 1000), at: Date())
        let before = store.goalReachedToday
        let result = store.record(record, question: q, left: left / max(1, total), streak: streak)
        paid = result.stars
        if result.gem { gem = true }
        if !before, store.goalReachedToday {
            goalJustReached = true
            audio.play("goal", volume: 0.8, delay: 0.5)
        }
        run.answered += 1
        if correct { run.correct += 1 }
        run.bestStreak = max(run.bestStreak, streak)
        self.run = run
        audio.play(correct ? "correct" : "wrong")
        let teacher: String? = MathCast.teacherID
        Task {
            try? await Task.sleep(for: .seconds(correct ? 1.1 : 1.5))
            if correct {
                self.game.grant(stars: self.paid)
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
        run.distance = hud.distance
        run.waves = hud.level
        run.depth = hud.depth
        run.stars = hud.stars
        run.score = hud.stars
        let before = store.wallet.bestStars ?? 0
        let best = run.stars > before && before > 0
        let coins = store.finish(run)
        ending = Ending(run: run, missed: missed, chosen: chosen, line: line, coins: coins, gem: gem, newBest: best)
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
    @State private var gate = MathGate.checking
    /// Today against Vocab's ten minutes, for the button at the top (HouseStatusButton).
    @State private var day: VocabOverview.Goal?
    @Environment(\.navigate) private var navigate
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
        .toolbar {
            // Today's ten minutes and the purse, as on Vocab; it opens the house.
            ToolbarItem(placement: .topBarTrailing) { HouseStatusButton(day: day) }
        }
        .navigationTitle("")
        .statusBarHidden(session?.stage == .running)
        .task {
            guard session == nil else { return }
            store.openHouse()
            if store.isDemo, math.level == nil { math.setLevel(CommandLine.arguments.contains("--math-lower") ? .lower : .middle) }
            MathAudio.shared.prepare()
            let made = MathSession()
            session = made
            MathAudio.shared.setMusic("music-menu")
            MathAudio.shared.setZone(sound: "amb-hall", mood: 0)
            gate = await store.mathGate()
            day = store.vocabDay
            await math.sync(with: store)
            if CommandLine.arguments.contains("--math-run"), gate.isOpen { made.start() }
            if CommandLine.arguments.contains("--math-shop") { showingShop = true }
        }
        .onChange(of: session?.stage) { _, stage in
            menu?.locked = stage != nil && stage != .home
            if stage == .over || stage == .home { Task { await math.sync(with: store) } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { session?.pause(true) } else { MathAudio.shared.prepare() }
            // Back to the app on a new day, or after Vocab elsewhere: the gate may have moved.
            if phase == .active, session?.stage == .home { Task { await checkGate() } }
        }
        // Back from Vocab, opened from here: the music again, and the gate may be open now.
        .onAppear {
            guard session != nil else { return }
            MathAudio.shared.prepare()
            MathAudio.shared.setMusic("music-menu")
            MathAudio.shared.setZone(sound: "amb-hall", mood: 0)
            Task { await checkGate() }
        }
        .onDisappear {
            session?.leave()
            menu?.locked = false
        }
        .sheet(isPresented: $showingShop, onDismiss: { session?.reset() }) {
            MathLookView()
        }
    }

    private func checkGate() async {
        let now = await store.mathGate()
        // A run under way carries on; the gate only stands in front of Run.
        if gate != now { withAnimation { gate = now } }
        day = store.vocabDay
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
            MathHomeOverlay(gate: gate, start: { if gate.isOpen { session.start() } }, shop: { showingShop = true },
                            vocab: { navigate.go(.vocab) })
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
    let gate: MathGate
    let start: () -> Void
    let shop: () -> Void
    let vocab: () -> Void
    private let math = MathStore.shared

    var body: some View {
        VStack(spacing: 0) {
            // (The purse is in the bar above, with today's Vocab: HouseStatusButton.)
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
                if case .locked(let ms, let goalMs) = gate {
                    MathLockedCard(ms: ms, goalMs: goalMs)
                }
                HStack(spacing: 12) {
                    Button(action: shop) {
                        Label("Look", systemImage: "person.fill")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .foregroundStyle(.primary)
                            .frame(width: 118, height: 58)
                    }
                    .glassEffect(.regular.interactive(), in: .capsule)
                    Group {
                        switch gate {
                        case .open:
                            Button(action: start) {
                                Label("Run", systemImage: "figure.run")
                                    .font(.system(.title2, design: .rounded).weight(.black))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity, minHeight: 58)
                            }
                        case .locked:
                            Button(action: vocab) {
                                Label("Do Vocab", systemImage: "character.book.closed")
                                    .font(.system(.title3, design: .rounded).weight(.black))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity, minHeight: 58)
                            }
                        case .checking:
                            ProgressView().tint(.white).frame(maxWidth: .infinity, minHeight: 58)
                        }
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
            let mine = math.wallet.bestStars ?? 0
            let rows = math.board.sorted { max($0.bestScore, $0.me ? mine : 0) > max($1.bestScore, $1.me ? mine : 0) }
            if rows.isEmpty {
                Text("Most stars").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                Label(mine.formatted(), systemImage: "star.fill").font(.system(.title3, design: .rounded).weight(.heavy))
            } else {
                ForEach(Array(rows.prefix(3).enumerated()), id: \.element.id) { place, row in
                    HStack(spacing: 6) {
                        Text("\(place + 1)").font(.caption.weight(.heavy)).foregroundStyle(.secondary)
                        Text(row.name).font(.system(.subheadline, design: .rounded).weight(row.me ? .heavy : .medium)).lineLimit(1)
                        Spacer(minLength: 2)
                        Text(max(row.bestScore, row.me ? mine : 0).formatted())
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

// MARK: Over the run

struct MathHUDView: View {
    let session: MathSession

    var body: some View {
        let hud = session.hud
        ZStack {
            VStack(spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        // The score: stars, the only one (Andrew, 2026-11-26).
                        HStack(spacing: 6) {
                            Image(systemName: "star.fill").foregroundStyle(.yellow)
                            Text(hud.stars.formatted()).foregroundStyle(.white).contentTransition(.numericText())
                        }
                        .font(.system(size: 34, weight: .black, design: .rounded).monospacedDigit())
                        .shadow(color: .black.opacity(0.55), radius: 0, x: 0, y: 2)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(hud.stars) stars")
                        HStack(spacing: 6) {
                            // What the next right answer's stars are multiplied by: a quarter more for each in a row.
                            let times = min(MathPay.streakCap, 1 + 0.25 * Double(hud.level))
                            Text("×\(times.formatted(.number.precision(.fractionLength(0...2))))")
                                .font(.system(.subheadline, design: .rounded).weight(.black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(times > 1 ? Color.purple : Color.black.opacity(0.35), in: .capsule)
                            Text("Wave \(hud.level + 1)")
                                .font(.system(.caption, design: .rounded).weight(.bold))
                                .foregroundStyle(.white.opacity(0.9))
                                .shadow(color: .black.opacity(0.5), radius: 1, y: 1)
                        }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 6) {
                        HStack(spacing: 8) {
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
            // The hallway is still there, but blurred and well back: the
            // run's numbers are read over it, not through it.
            Rectangle().fill(.ultraThinMaterial).environment(\.colorScheme, .dark).ignoresSafeArea()
            Color.black.opacity(0.45).ignoresSafeArea()
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
                        HStack(spacing: 8) {
                            Image(systemName: "star.fill").foregroundStyle(.yellow)
                            Text(ending.run.stars.formatted()).foregroundStyle(.white)
                        }
                        .font(.system(size: 60, weight: .black, design: .rounded).monospacedDigit())
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(ending.run.stars) stars")
                        Text(ending.newBest ? "Your most stars yet" : "Your best \((math.wallet.bestStars ?? 0).formatted()) stars")
                            .font(.system(.subheadline, design: .rounded).weight(.bold))
                            .foregroundStyle(ending.newBest ? .yellow : .white.opacity(0.7))
                    }
                    HStack(spacing: 10) {
                        stat("+\(ending.coins)", "coins", "circle.fill", .yellow)
                        stat("\(ending.run.correct)/\(ending.run.answered)", "right", "checkmark.circle.fill", .green)
                        stat("\(ending.run.distance) m", MathZone.all[MathZone.index(forLevel: ending.run.depth)].name, "figure.run", .white)
                    }
                    .padding(.horizontal, 14)
                    if ending.gem {
                        Label("A strong day: +1 gem", systemImage: "diamond.fill")
                            .font(.system(.subheadline, design: .rounded).weight(.heavy))
                            .foregroundStyle(.cyan)
                    } else if math.goalReachedToday, math.rightToday < MathPay.strongDay, !HouseStore.shared.state.paid.contains(MathPay.gemKey(MathStore.day())) {
                        Text("\(MathPay.strongDay - math.rightToday) more right today for a gem")
                            .font(.system(.subheadline, design: .rounded).weight(.semibold))
                            .foregroundStyle(.white.opacity(0.75))
                    }
                    MathTopTen(top: math.top, just: ending.run.id)
                        .padding(.horizontal, 14)
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
                .padding(.top, 36)
                .padding(.bottom, 12)
                // What scrolls under the buttons fades out behind them.
                .background {
                    LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black.opacity(0.85), location: 0.45),
                                           .init(color: .black.opacity(0.92), location: 1)], startPoint: .top, endPoint: .bottom)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                }
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

/// The ten runs with the most stars, today's and of all time (Andrew:
/// "a stars top 10 at the end of each run"). Runs, not players, so one good
/// day can fill it. The kids' runs, and a parent's own when they're the one
/// playing.
struct MathTopTen: View {
    let top: MathTop
    /// The run just over, picked out if it's there.
    let just: UUID
    @State private var allTime = false

    var body: some View {
        let rows = allTime ? top.all : top.today
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Top 10", systemImage: "star.fill")
                    .font(.system(.headline, design: .rounded).weight(.heavy))
                    .foregroundStyle(.white)
                Spacer()
                Picker("Which", selection: $allTime) {
                    Text("Today").tag(false)
                    Text("All time").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 170)
            }
            if rows.isEmpty {
                Text(allTime ? "No runs yet." : "No runs yet today.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.vertical, 6)
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { place, row in
                let mine = row.id == just
                HStack(spacing: 10) {
                    Text("\(place + 1)")
                        .font(.system(.subheadline, design: .rounded).weight(.heavy).monospacedDigit())
                        .foregroundStyle(.white.opacity(0.6))
                        .frame(width: 22, alignment: .trailing)
                    Text(row.name)
                        .font(.system(.subheadline, design: .rounded).weight(row.me ? .heavy : .medium))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    if allTime {
                        Text(row.at.formatted(.dateTime.month(.abbreviated).day()))
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                    Spacer(minLength: 4)
                    Label(row.stars.formatted(), systemImage: "star.fill")
                        .labelStyle(.titleAndIcon)
                        .font(.system(.subheadline, design: .rounded).weight(.bold).monospacedDigit())
                        .foregroundStyle(.white)
                }
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(mine ? Color.yellow.opacity(0.28) : Color.clear, in: .rect(cornerRadius: 10))
                .accessibilityElement(children: .combine)
            }
        }
        .padding(14)
        .background(.white.opacity(0.1), in: .rect(cornerRadius: 22))
    }
}
