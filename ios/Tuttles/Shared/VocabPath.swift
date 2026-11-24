import SwiftUI

// Vocab as a climb. The words, in the order they're met, are cut into stages
// of 25, each a place on the way up a mountain whose summit is the test. A
// stage is cleared once every word in it has been found, turns gold once
// they're all mastered, and ends in a boss round (VocabEngine.swift has the
// rules). It's all worked out on the phone from what it keeps, so it's there
// with no connection.

// MARK: - What the path is made of

/// One stretch of the path: 25 words, and how they stand.
struct VocabStage: Codable, Hashable, Identifiable {
    enum Boss: String, Codable {
        /// The stage has no words that took learning: nothing to fight over.
        case none
        /// Not every word found yet.
        case locked
        /// Waiting to be beaten, and a gate until it is: no new words meanwhile.
        case ready
        /// It got away three times: they've gone on without the crown, which is still there to win.
        case skipped
        case beaten
    }

    struct Word: Codable, Hashable, Identifiable {
        let id: String
        let title: String
        let status: VocabStatus
    }

    /// 1 for the first.
    let number: Int
    let words: [Word]
    let boss: Boss
    /// Times its boss has got away.
    let bossFails: Int
    /// Every word mastered, now or at some time before: gold is kept once earned.
    let gold: Bool

    var id: Int { number }
    var total: Int { words.count }
    /// Words found: asked at least once, or skipped as known already.
    var met: Int { words.filter { $0.status != .new }.count }
    var mastered: Int { words.filter { $0.status == .mastered || $0.status == .removed }.count }
    var cleared: Bool { met >= total }

    private static let places: [(String, String)] = [
        ("Trailhead", "signpost.right.fill"), ("Pine Woods", "tree.fill"), ("Creek Crossing", "water.waves"),
        ("Fern Gully", "leaf.fill"), ("Boulder Field", "circle.hexagongrid.fill"), ("Echo Canyon", "mountain.2.fill"),
        ("Eagle Ridge", "bird.fill"), ("High Meadow", "camera.macro"), ("Misty Falls", "drop.fill"),
        ("Granite Steps", "stairs"), ("Windy Pass", "wind"), ("Snow Line", "snowflake"),
        ("Ice Bridge", "thermometer.snowflake"), ("Cloud Shelf", "cloud.fill"), ("Thunder Notch", "cloud.bolt.fill"),
        ("Glacier Lake", "fish.fill"), ("Star Camp", "tent.fill"), ("Knife Edge", "triangle.fill"),
        ("Last Push", "figure.hiking"), ("Summit", "flag.fill"),
    ]

    static func name(_ number: Int) -> String {
        places.indices.contains(number - 1) ? places[number - 1].0 : "Stage \(number)"
    }

    var name: String { Self.name(number) }
    var symbol: String { Self.places.indices.contains(number - 1) ? Self.places[number - 1].1 : "mappin" }
}

struct VocabPath: Codable, Hashable {
    let stages: [VocabStage]

    /// The stage they're on: the first with words still to find. Nil once every word's been found.
    var current: VocabStage? { stages.first { !$0.cleared } }
    /// The boss in the way, if there is one: no new words until it's beaten (or skipped).
    var bossReady: VocabStage? { stages.first { $0.boss == .ready } }
}

/// How far a session took them: the stage it started in, as it now stands.
struct VocabClimb: Codable, Hashable {
    let stage: VocabStage
    /// Words of it found before the session.
    let metBefore: Int

    var found: Int { max(0, stage.met - metBefore) }
    var justCleared: Bool { stage.cleared && metBefore < stage.total }
}

/// A boss round, and how it stands.
struct VocabBoss: Codable, Hashable {
    let stage: Int
    let total: Int
    /// Right answers that beat it.
    let needed: Int
    let correct: Int
    let answered: Int
    let over: Bool
    /// Times this stage's boss has got away, this round included once it's lost.
    var fails = 0

    var name: String { VocabStage.name(stage) }
    var hitsLeft: Int { max(0, needed - correct) }
    /// Misses the round allows in all, and how many are left.
    var spare: Int { total - needed }
    var sparesLeft: Int { max(0, spare - (answered - correct)) }
    /// It's got away often enough that they can go on without beating it.
    var canSkip: Bool { !beaten && fails >= VocabEngine.bossTries }
    var beaten: Bool { over && answered >= total && correct >= needed }
}

// MARK: - A stage, as a place on the path

/// A stage as a round marker: locked, the one they're on (with a ring of how
/// much of it is found), cleared, or gold; and a badge for its boss.
struct VocabStageNode: View {
    let stage: VocabStage
    /// The stage they're on.
    var current = false
    var size: CGFloat = 78
    @Environment(\.accessibilityReduceMotion) private var still

    private var reached: Bool { current || stage.cleared }

    var body: some View {
        ZStack {
            // The halo that says "you are here".
            // (Drawn from the clock, not animated from a change of state: a
            // repeating animation started as the view appears takes whatever
            // else is settling into place on screen along with it, for ever.)
            if current, !still {
                TimelineView(.animation) { timeline in
                    let part = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                    let out = 1 - (1 - part) * (1 - part)
                    Circle()
                        .stroke(TuttlesLook.accent.opacity(0.5), lineWidth: 3)
                        .scaleEffect(1.02 + 0.40 * out)
                        .opacity(0.9 * (1 - out))
                }
            }
            // A marker with some depth to it: a darker one just below.
            Circle().fill(edge).offset(y: size * 0.07)
            Circle().fill(face)
                .overlay {
                    if stage.gold, !still {
                        // A band of light going across, now and then.
                        TimelineView(.animation) { timeline in
                            let part = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3.2) / 3.2
                            LinearGradient(colors: [.clear, .white.opacity(0.7), .clear], startPoint: .leading, endPoint: .trailing)
                                .frame(width: size * 0.5)
                                .rotationEffect(.degrees(20))
                                .offset(x: -size + 2 * size * min(1, part / 0.35))
                                .blendMode(.plusLighter)
                        }
                    }
                }
                .clipShape(.circle)
            if current {
                Circle().stroke(Color.primary.opacity(0.10), lineWidth: size * 0.085).padding(size * 0.1)
                Circle()
                    .trim(from: 0, to: Double(stage.met) / Double(max(1, stage.total)))
                    .stroke(TuttlesLook.accent, style: StrokeStyle(lineWidth: size * 0.085, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .padding(size * 0.1)
                    .animation(.smooth(duration: 0.8), value: stage.met)
            }
            Image(systemName: icon)
                .font(.system(size: size * (current ? 0.30 : 0.36), weight: .bold))
                .foregroundStyle(reached && !current ? Color.white : current ? TuttlesLook.accent : Color.secondary.opacity(0.6))
                .symbolEffect(.bounce, value: stage.cleared)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .topTrailing) { badge }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(stage.name), \(stage.met) of \(stage.total) words found")
    }

    private var icon: String {
        if stage.gold { return "star.fill" }
        if stage.cleared { return "checkmark" }
        return current ? stage.symbol : "lock.fill"
    }

    private var face: AnyShapeStyle {
        if stage.gold { return AnyShapeStyle(LinearGradient(colors: [VocabLook.gold, VocabLook.amber], startPoint: .top, endPoint: .bottom)) }
        if stage.cleared { return AnyShapeStyle(LinearGradient(colors: [VocabLook.right.opacity(0.85), VocabLook.right], startPoint: .top, endPoint: .bottom)) }
        if current { return AnyShapeStyle(Color(light: .white, dark: Color(white: 0.16))) }
        return AnyShapeStyle(Color(light: Color(white: 0.90), dark: Color(white: 0.20)))
    }

    private var edge: Color {
        if stage.gold { return Color(red: 0.72, green: 0.46, blue: 0.04) }
        if stage.cleared { return Color(red: 0.10, green: 0.46, blue: 0.28) }
        if current { return TuttlesLook.accent.opacity(0.55) }
        return Color(light: Color(white: 0.78), dark: Color(white: 0.12))
    }

    @ViewBuilder private var badge: some View {
        switch stage.boss {
        case .beaten:
            Image(systemName: "crown.fill")
                .font(.system(size: size * 0.20, weight: .bold))
                .foregroundStyle(VocabLook.gold)
                .frame(width: size * 0.38, height: size * 0.38)
                .background(Color(light: .white, dark: Color(white: 0.14)), in: .circle)
                .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
                .offset(x: size * 0.08, y: -size * 0.08)
        case .ready:
            Image(systemName: "bolt.fill")
                .font(.system(size: size * 0.20, weight: .bold))
                .foregroundStyle(.white)
                .symbolEffect(.pulse, options: .repeat(.continuous))
                .frame(width: size * 0.38, height: size * 0.38)
                .background(VocabLook.boss, in: .circle)
                .shadow(color: VocabLook.boss.opacity(0.5), radius: 4)
                .offset(x: size * 0.08, y: -size * 0.08)
        case .skipped:
            // Passed by, with the crown still to win.
            Image(systemName: "bolt.fill")
                .font(.system(size: size * 0.20, weight: .bold))
                .foregroundStyle(VocabLook.boss)
                .frame(width: size * 0.38, height: size * 0.38)
                .background(Color(light: .white, dark: Color(white: 0.14)), in: .circle)
                .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
                .offset(x: size * 0.08, y: -size * 0.08)
        case .none, .locked:
            EmptyView()
        }
    }
}

// MARK: - On Vocab's first screen

extension VocabPath {
    /// What the way into a session is called: it's the next stretch of the climb.
    func startTitle(inProgress: Bool) -> String {
        guard let stage = current else { return inProgress ? "Keep going" : "Practice" }
        return inProgress ? "Keep climbing \(stage.name)" : "Climb \(stage.name)"
    }
}

/// The way on from the path, one button: a session, or, when a boss is in
/// the way, its round.
struct VocabStartButtons: View {
    let path: VocabPath
    let inProgress: Bool
    /// Today's ten minutes are done: another session is extra.
    var done = false
    let starting: Bool
    let start: () -> Void
    let fight: (VocabStage) -> Void

    var body: some View {
        VStack(spacing: 10) {
            if let boss = path.bossReady {
                Button { fight(boss) } label: {
                    // Whoever's in the way, by name.
                    Text("\(boss.character.face)  Take on \(boss.character.name)")
                        .font(.headline)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                }
                .buttonStyle(.glassProminent)
                .tint(VocabLook.boss)
            } else if done, !inProgress {
                Button(action: start) { label("Do another", tint: nil) }
                    .buttonStyle(.glass)
                    .disabled(starting)
            } else {
                Button(action: start) { label(path.startTitle(inProgress: inProgress), tint: .white) }
                    .buttonStyle(.glassProminent)
                    .tint(TuttlesLook.accent)
                    .disabled(starting)
            }
        }
    }

    private func label(_ title: String, tint: Color?) -> some View {
        HStack(spacing: 8) {
            if starting { ProgressView().tint(tint) }
            Text(title).font(.headline)
        }
        .frame(maxWidth: .infinity)
        .frame(height: tint == nil ? 34 : 40)
    }
}

// MARK: - The whole path

/// The map: every stage from the trailhead at the bottom to the summit, which
/// is the test. It's Vocab's first screen for a kid (VocabViews.swift), opened
/// on the stage they're on. Tapping a stage opens it.
struct VocabMap: View {
    let path: VocabPath
    /// Days until the ISEE.
    let daysLeft: Int
    let open: (VocabStage) -> Void

    private static let rowHeight: CGFloat = 118
    private static let node: CGFloat = 78

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    summit(daysLeft)
                    ForEach(path.stages.reversed()) { stage in
                        row(stage, path).id(stage.number)
                    }
                }
                .padding(.vertical, 24)
                .vocabColumn()
            }
            .defaultScrollAnchor(.bottom)
            .onAppear {
                if let number = path.current?.number { proxy.scrollTo(number, anchor: .center) }
            }
            // On to a new stage: follow them up.
            .onChange(of: path.current?.number) { _, number in
                if let number { withAnimation(.smooth) { proxy.scrollTo(number, anchor: .center) } }
            }
        }
        .animation(.default, value: path)
    }

    /// How far left or right of the middle a stage sits: the path winds.
    private func sway(_ number: Int) -> CGFloat { CGFloat(sin(Double(number) * 1.05)) * 84 }

    private func row(_ stage: VocabStage, _ path: VocabPath) -> some View {
        let isCurrent = path.current?.number == stage.number
        let x = sway(stage.number)
        // The words go on the roomier side.
        let right = x < 0
        let width: CGFloat = 132
        return ZStack {
            Button { open(stage) } label: {
                VocabStageNode(stage: stage, current: isCurrent, size: Self.node)
            }
            .buttonStyle(.plain)
            .offset(x: x)

            VStack(alignment: right ? .leading : .trailing, spacing: 2) {
                Text(stage.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(isCurrent || stage.cleared ? .primary : .secondary)
                Text(caption(stage, current: isCurrent))
                    .font(.caption)
                    .foregroundStyle(stage.boss == .ready ? AnyShapeStyle(VocabLook.boss) : AnyShapeStyle(.secondary))
            }
            .multilineTextAlignment(right ? .leading : .trailing)
            .frame(width: width, alignment: right ? .leading : .trailing)
            .offset(x: x + (right ? 1 : -1) * (Self.node / 2 + 12 + width / 2))
            .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity)
        .frame(height: Self.rowHeight)
        .background {
            // The trail down to the stage before, walked once that one's cleared.
            if stage.number > 1 {
                let walked = path.stages[stage.number - 2].cleared
                VocabTrail(from: x, to: sway(stage.number - 1))
                    .stroke(walked ? VocabLook.right.opacity(0.75) : Color.primary.opacity(0.14),
                            style: StrokeStyle(lineWidth: walked ? 9 : 7, lineCap: .round, dash: walked ? [] : [2, 14]))
            }
        }
    }

    private func caption(_ stage: VocabStage, current: Bool) -> String {
        if stage.boss == .ready { return "Beat \(stage.character.name) to go on" }
        if stage.gold {
            let slipped = stage.total - stage.mastered
            return slipped == 0 ? "All \(stage.total) mastered" : "Gold · \(slipped) back in practice"
        }
        if stage.cleared { return "\(stage.mastered) of \(stage.total) mastered" }
        if current || stage.met > 0 { return "\(stage.met) of \(stage.total) found" }
        return "\(stage.total) words"
    }

    private func summit(_ daysLeft: Int) -> some View {
        VStack(spacing: 6) {
            Image(systemName: "mountain.2.fill")
                .font(.system(size: 44))
                .foregroundStyle(TuttlesLook.accent.gradient)
            Text("The ISEE").font(.system(.title2, design: .serif).weight(.semibold))
            Text(VocabRules.countdown(daysLeft: daysLeft)).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, 18)
    }
}

/// The line from one stage's marker down to the one below it.
private struct VocabTrail: Shape {
    let from: CGFloat
    let to: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let start = CGPoint(x: rect.midX + from, y: rect.midY)
        let end = CGPoint(x: rect.midX + to, y: rect.midY + rect.height)
        path.move(to: start)
        path.addCurve(to: end, control1: CGPoint(x: start.x, y: rect.midY + rect.height * 0.55),
                      control2: CGPoint(x: end.x, y: rect.midY + rect.height * 0.45))
        return path
    }
}

// MARK: - A stage's words

/// A stage opened up: the words found in it, coloured by how they stand, and its boss.
struct VocabStageSheet: View {
    let stage: VocabStage
    let current: Bool
    let fight: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 16) {
                    VocabStageNode(stage: stage, current: current, size: 68)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Stage \(stage.number)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(stage.name).font(.system(.title, design: .serif).weight(.semibold))
                        Text("\(stage.met) of \(stage.total) found · \(stage.mastered) mastered").font(.subheadline).foregroundStyle(.secondary)
                    }
                }

                boss

                if stage.met > 0 {
                    VocabFlow(spacing: 8) {
                        ForEach(stage.words) { word in
                            if word.status == .new {
                                Text("? ? ?")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.tertiary)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .overlay { Capsule().strokeBorder(Color.primary.opacity(0.18), style: StrokeStyle(lineWidth: 1, dash: [4, 3])) }
                            } else {
                                HStack(spacing: 6) {
                                    if word.status == .mastered {
                                        Image(systemName: "star.fill").font(.caption2).foregroundStyle(VocabLook.gold)
                                    }
                                    Text(word.title).font(.subheadline.weight(.medium))
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(word.status.tint.opacity(word.status == .removed ? 1 : 0.24), in: .capsule)
                            }
                        }
                    }
                    if stage.met < stage.total {
                        Text("The rest show up as you find them.").font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Label("\(stage.total) words are waiting here.", systemImage: "lock.fill")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(24)
            .padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 380)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        #endif
    }

    @ViewBuilder private var boss: some View {
        switch stage.boss {
        case .ready, .skipped:
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Text(stage.character.face).font(.system(size: 44)).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("The boss").font(.caption.weight(.semibold)).foregroundStyle(VocabLook.bossText)
                        Text(stage.character.fullName).font(.headline)
                    }
                }
                Text(stage.boss == .skipped
                     ? "You've gone on without it, but the crown is still here to win. The trickiest words from here, against the clock, with no \"Don't know\"."
                     : "Beat it to open the next stage. The trickiest words from here, against the clock, with no \"Don't know\". In a full round you can miss one.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button(action: fight) {
                    Text("Take on \(stage.character.name)").font(.headline).frame(maxWidth: .infinity).frame(height: 36)
                }
                .buttonStyle(.glassProminent)
                .tint(VocabLook.boss)
            }
            .padding(18)
            .vocabGlass(tint: VocabLook.boss.opacity(0.12), radius: 22)
        case .beaten:
            Label("\(stage.character.fullName): beaten", systemImage: "crown.fill")
                .font(.headline)
                .foregroundStyle(VocabLook.amberText)
        case .locked:
            Label("Find every word here to unlock the boss round.", systemImage: "bolt.slash.fill")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        case .none:
            Label("No boss here: you knew these already.", systemImage: "checkmark.seal.fill")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
