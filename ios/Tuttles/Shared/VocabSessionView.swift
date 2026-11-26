import AVFoundation
import SwiftUI

// A Vocab session on screen: the clock and how far along at the top, one
// question on glass, and after a miss the word laid out to learn from, over
// the top of it, with a few seconds before there's a way on. It
// takes over the screen, so there's nothing to wander off to; closing it
// keeps the session, which picks up where it was.

struct VocabSessionView: View {
    let run: VocabRun
    @Environment(\.dismiss) private var dismiss
    /// The session whose boss has had their say: a boss round's entrance, or
    /// the heckle before an ordinary one (VocabBosses.swift).
    @State private var introduced: String?

    private var mood: VocabMood {
        if run.summary != nil { return .done }
        guard let feedback = run.feedback else { return run.boss == nil ? .calm : .boss }
        return feedback.isCorrect ? .right : .miss
    }

    var body: some View {
        ZStack {
            VocabBackdrop(mood: mood)
            if let summary = run.summary {
                VocabSummaryView(summary: summary, number: run.number, busy: run.busy, done: { dismiss() },
                                 again: { Task { await run.again() } }, retry: { run.retryBoss() }, fight: { run.fightBoss($0) })
                    .transition(.opacity)
                    // Each finish is its own, so a second go at a boss celebrates (or not) afresh.
                    .id(run.shown)
            } else if let boss = run.boss, let question = run.question, question.position == 1, run.picked == nil,
                      introduced != run.state.sessionId {
                // A boss round opens on its boss. The clock waits for them.
                VocabBossIntro(boss: boss, begin: {
                    run.startClock()
                    withAnimation(.snappy) { introduced = run.state.sessionId }
                }, close: { dismiss() })
                    .transition(.opacity)
                    .id(run.state.sessionId)
            } else if run.boss == nil, let heckle = run.state.heckle, let question = run.question, question.position == 1, run.picked == nil,
                      introduced != run.state.sessionId {
                // An ordinary session opens on the stage's boss, with something to say. The clock waits here too.
                VocabHeckleView(heckle: heckle, begin: {
                    run.startClock()
                    withAnimation(.snappy) { introduced = run.state.sessionId }
                }, close: { dismiss() })
                    .transition(.opacity)
                    .id(run.state.sessionId)
            } else if let question = run.question {
                VocabQuestionView(run: run, question: question, close: { dismiss() })
                    .transition(.opacity)
            }
        }
        .animation(.default, value: run.summary != nil)
        .sensoryFeedback(trigger: run.feedback) { _, new in
            guard let new else { return nil }
            return new.isCorrect ? .success : .error
        }
        // Five in a row, ten in a row: a thump.
        .sensoryFeedback(trigger: run.combo) { _, combo in
            combo > 0 && combo % 5 == 0 ? .impact(weight: .heavy) : nil
        }
        #if os(macOS)
        .frame(minWidth: 560, idealWidth: 640, minHeight: 620, idealHeight: 720)
        #endif
    }
}

// MARK: - A question

private struct VocabQuestionView: View {
    let run: VocabRun
    let question: VocabQuestion
    let close: () -> Void

    private static let letters = ["A", "B", "C", "D", "E"]
    private var missed: VocabFeedback? { run.feedback.flatMap { $0.isCorrect ? nil : $0 } }
    /// The session ends with this question.
    private var last: Bool { run.pending.map { $0.summary != nil } ?? (question.position >= question.total) }

    var body: some View {
        ScrollViewReader { _ in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    stem
                    GlassEffectContainer(spacing: 10) {
                        VStack(spacing: 10) {
                            ForEach(Array(question.choices.enumerated()), id: \.offset) { index, text in
                                choice(index, text)
                            }
                        }
                    }
                    .padding(.top, 24)
                    below
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 24)
                .vocabColumn()
                // Each question's views are its own, so nothing animates from the last one's answer.
                .id(run.shown)
                .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
            }
            .scrollBounceBehavior(.basedOnSize)
            .onChange(of: run.feedback) { _, feedback in
                guard let feedback else { return }
                if feedback.isCorrect {
                    // A right answer moves on by itself; a miss waits for them to read it.
                    let shown = run.shown
                    Task {
                        try? await Task.sleep(for: .seconds(feedback.mastered ? 1.0 : 0.45))
                        if run.shown == shown { withAnimation(.snappy) { run.advance() } }
                    }
                }
            }
        }
        // A bar, so what scrolls up under it blurs away rather than running into the clock.
        .safeAreaBar(edge: .top, spacing: 0) { bar }
        // A miss: the word comes up over the question, to be read before going on.
        .overlay {
            if let missed {
                VocabMissModal(waiting: run.wantsNext && !run.failed,
                               // (The miss that ends a boss round: on to how it came out.)
                               title: run.failed ? "Try again" : !last ? "Next" : run.boss != nil ? "See how it went" : "Finish",
                               next: { withAnimation(.snappy) { run.advance() } }) {
                    lesson(missed)
                }
                // Each miss has its own, with its own five seconds.
                .id(run.shown)
                .transition(.opacity)
            }
        }
        // (A moment after the answer, so they see which choice was right first.)
        .animation(.easeOut(duration: 0.25).delay(run.feedback == nil ? 0 : 0.7), value: missed != nil)
        .animation(.snappy, value: run.feedback)
        .animation(.snappy, value: run.crossed)
    }

    /// Close, how far along, and the clock.
    private var bar: some View {
        HStack(spacing: 12) {
            Button(action: close) {
                Image(systemName: "xmark").font(.subheadline.weight(.semibold)).frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Close")

            if let boss = run.boss {
                VocabBossBar(boss: boss)
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        if let stage = run.stage {
                            // The stretch of the climb this is, and how much of it is found.
                            HStack(spacing: 4) {
                                Image(systemName: stage.symbol).symbolEffect(.bounce, value: stage.met)
                                Text(stage.name).lineLimit(1)
                                Text("\(stage.met)/\(stage.total)")
                                    .monospacedDigit()
                                    .contentTransition(.numericText(value: Double(stage.met)))
                            }
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(TuttlesLook.accent)
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(stage.name), \(stage.met) of \(stage.total) words found")
                        } else if run.number > 1 {
                            Text("Session \(run.number)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(TuttlesLook.accent)
                        }
                        if run.stage == nil {
                            Text("\(question.position) of \(question.total)").font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 4)
                        // Right answers in a row, once there are a few.
                        if run.combo >= 3 {
                            HStack(spacing: 3) {
                                Image(systemName: "flame.fill").symbolEffect(.bounce, value: run.combo)
                                Text(run.stage == nil ? "\(run.combo) in a row" : "\(run.combo)")
                                    .contentTransition(.numericText(value: Double(run.combo)))
                            }
                            .font(.caption.weight(.bold))
                            .monospacedDigit()
                            .foregroundStyle(VocabLook.flame)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(run.combo) right in a row")
                        }
                        if run.stage != nil {
                            Text("\(question.position) of \(question.total)").font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(.secondary)
                        }
                    }
                    .animation(.snappy, value: run.stage?.met)
                    ProgressView(value: run.progress)
                        .tint(TuttlesLook.accent)
                        .animation(.snappy, value: run.progress)
                }
                .animation(.spring(duration: 0.35, bounce: 0.45), value: run.combo)
            }

            TimelineView(.periodic(from: .now, by: 0.25)) { timeline in
                let left = run.leftMs(at: timeline.date)
                // A boss round's clock is short from the start: it warns only at the very end.
                let low = run.boss == nil ? 60_000 : 10_000
                Text(left < 0 ? "+\(VocabRules.clock(left))" : VocabRules.clock(left))
                    .font(.headline)
                    .monospacedDigit()
                    .foregroundStyle(left < 0 ? VocabLook.wrong : left < low ? VocabLook.amberText : Color.primary)
                    .frame(minWidth: 52)
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .glassEffect(left < 0 ? .regular.tint(VocabLook.wrong.opacity(0.18))
                                 : left < low ? .regular.tint(VocabLook.amber.opacity(0.22)) : .regular, in: .capsule)
                    .accessibilityLabel(left < 0 ? "\(VocabRules.clock(left)) over time" : "\(VocabRules.clock(left)) left")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .vocabColumn()
    }

    private var stem: some View {
        VStack(alignment: .leading, spacing: 12) {
            // The chips drop to a line of their own when the question's line is full.
            VocabFlow(spacing: 8) {
                Text(question.kind.ask).font(.subheadline).foregroundStyle(.secondary)
                if question.isNew {
                    Text("New")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(TuttlesLook.accent, in: .capsule)
                }
                // A review from a stage already behind them.
                if let from = question.from {
                    Label(from, systemImage: "shield.lefthalf.filled")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(VocabLook.rightText)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(VocabLook.right.opacity(0.16), in: .capsule)
                        .accessibilityLabel("A word from \(from)")
                }
            }
            if question.kind == .syn {
                HStack(spacing: 12) {
                    Text(question.stem)
                        .font(.system(size: 40, weight: .semibold, design: .serif))
                        .kerning(1.5)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    // Hearing it is half of knowing it. (Only here, where the word is the question: in a
                    // sentence to complete, the word is the answer.)
                    VocabSpeakButton(word: question.key?.title ?? question.stem.lowercased())
                }
            } else {
                Text(question.stem).font(.title3.weight(.medium)).lineSpacing(5)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 12)
    }

    private func choice(_ index: Int, _ text: String) -> some View {
        let feedback = run.feedback
        let isCorrect = feedback?.correctIndex == index
        let isPicked = run.picked == .choice(index)
        let isCrossed = feedback == nil && run.crossed.contains(index)
        let tint: Color? = feedback != nil && isCorrect ? VocabLook.right.opacity(0.45)
            : feedback != nil && isPicked ? VocabLook.wrong.opacity(0.40)
            : isPicked ? Color.primary.opacity(0.12) : nil

        return HStack(spacing: 0) {
            Button { run.tap(index) } label: {
                HStack(spacing: 14) {
                    Text(Self.letters[min(index, Self.letters.count - 1)])
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                        .background(Color.primary.opacity(0.07), in: .circle)
                    Text(text)
                        .font(.title3)
                        .strikethrough(isCrossed)
                        .foregroundStyle(isCrossed ? .secondary : .primary)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .padding(.leading, 16)
                .padding(.vertical, 16)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(run.picked != nil)
            #if os(macOS)
            .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: [])
            #endif

            Group {
                if feedback != nil, isCorrect {
                    Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(VocabLook.rightText)
                } else if feedback != nil, isPicked {
                    Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(VocabLook.wrong)
                } else if run.picked == nil {
                    // Ruling a choice out, the way they would with a pencil on the real test.
                    Button { run.toggleCross(index) } label: {
                        Image(systemName: isCrossed ? "arrow.uturn.backward" : "xmark")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                            .frame(width: 48, height: 48)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isCrossed ? "Bring back \(text)" : "Cross off \(text)")
                }
            }
            .frame(width: 52)
        }
        .glassEffect(glass(tint, interactive: run.picked == nil && !isCrossed), in: .rect(cornerRadius: 22, style: .continuous))
        .opacity(isCrossed ? 0.55 : feedback != nil && !isCorrect && !isPicked ? 0.5 : 1)
        // Got it: the right answer swells a little and throws off sparks.
        .scaleEffect(feedback?.isCorrect == true && isCorrect ? 1.03 : 1)
        .overlay {
            if let feedback, feedback.isCorrect, isCorrect { VocabBurst(big: feedback.mastered) }
        }
        .zIndex(feedback?.isCorrect == true && isCorrect ? 1 : 0)
        .animation(.spring(duration: 0.35, bounce: 0.5), value: feedback)
    }

    private func glass(_ tint: Color?, interactive: Bool) -> Glass {
        let glass = tint.map { Glass.regular.tint($0) } ?? .regular
        return interactive ? glass.interactive() : glass
    }

    /// Under the choices: the ways out before an answer, and a line after a right one.
    @ViewBuilder private var below: some View {
        if let feedback = run.feedback {
            if feedback.isCorrect {
                Group {
                    if feedback.mastered {
                        Label("Mastered: \(feedback.title)", systemImage: "star.circle.fill")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(VocabLook.rightText)
                            .symbolEffect(.bounce, options: .nonRepeating)
                            .transition(.scale(scale: 0.5).combined(with: .opacity))
                    } else {
                        Text("\(Text(feedback.title).fontWeight(.semibold))\(Text(": \(feedback.meaning)").foregroundStyle(.secondary))")
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 22)
                // A right answer moves on by itself, so a save that failed needs its own way forward.
                if run.failed {
                    Button { withAnimation(.snappy) { run.advance() } } label: {
                        Text("That didn't save. Try again").font(.subheadline.weight(.medium)).foregroundStyle(VocabLook.wrong)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            } else if run.failed {
                Text("That didn't save.").font(.subheadline).foregroundStyle(VocabLook.wrong)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)
            }
        } else {
            VStack(spacing: 6) {
                if question.allowDontKnow {
                    Button { Task { await run.answer(.dontKnow) } } label: {
                        Text("Don't know")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .overlay {
                                RoundedRectangle(cornerRadius: 22, style: .continuous)
                                    .strokeBorder(Color.primary.opacity(0.22), style: StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
                            }
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(run.picked != nil)
                } else {
                    Text(run.boss != nil ? "Boss round: no \"Don't know\". Rule out what you can, then take your best guess."
                         : "Test-day practice: rule out what you can, then take your best guess.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                if run.failed {
                    Text("That didn't go through. Try again.").font(.subheadline).foregroundStyle(VocabLook.wrong)
                }
            }
            .padding(.top, 10)
        }
    }

    /// After a miss: that it was one, then the word and what it means above
    /// everything else, their pick and why it was wrong in a line, and one
    /// thing to hold on to for next time.
    private func lesson(_ feedback: VocabFeedback) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(run.picked == .dontKnow ? "You didn't know this one" : "Missed", systemImage: "xmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VocabLook.amberText)

            // The thing to remember: the word, and what it means.
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(feedback.title)
                        .font(.system(.largeTitle, design: .serif).weight(.semibold))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if let pos = feedback.pos { Text(pos).font(.footnote).italic().foregroundStyle(.secondary) }
                    Spacer(minLength: 0)
                    if feedback.isWord { VocabSpeakButton(word: feedback.title) }
                }
                Text(feedback.meaning)
                    .font(.title2.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                if let example = feedback.example {
                    Text(example)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                }
            }

            if !feedback.parts.isEmpty {
                VocabFlow(spacing: 6) {
                    ForEach(feedback.parts, id: \.part) { part in
                        Text("\(Text(part.part).fontWeight(.semibold)) means \(part.meaning)")
                            .font(.footnote)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 6)
                            .background(Color.primary.opacity(0.07), in: .capsule)
                    }
                }
            }

            // What they picked, and why it wasn't it: once, together.
            if case .choice(let index) = run.picked, question.choices.indices.contains(index) {
                Text("\(Text("You picked \(question.choices[index]). ").fontWeight(.semibold))\(feedback.chosenWhy ?? "")")
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // One thing to hold on to.
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "lightbulb.fill").foregroundStyle(VocabLook.amber)
                VStack(alignment: .leading, spacing: 4) {
                    if !feedback.hook.isEmpty { Text(feedback.hook) }
                    Text(feedback.tip).foregroundStyle(feedback.hook.isEmpty ? .primary : .secondary)
                }
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .font(.subheadline)
            .padding(14)
            .background(VocabLook.amber.opacity(0.13), in: .rect(cornerRadius: 16, style: .continuous))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Says a word out loud.
struct VocabSpeakButton: View {
    let word: String

    var body: some View {
        Button { VocabVoice.say(word) } label: {
            Image(systemName: "speaker.wave.2.fill").frame(width: 40, height: 40)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel("Hear \(word)")
    }
}

// MARK: - After a miss

/// The missed word, over the question: what it means, why their pick was
/// wrong and what to try next time. The way on isn't there for the first five
/// seconds, so it gets read rather than tapped past.
private struct VocabMissModal<Lesson: View>: View {
    /// They've asked for the next question and it isn't here yet.
    let waiting: Bool
    let title: String
    let next: () -> Void
    @ViewBuilder let lesson: Lesson
    @State private var opened = Date()

    private static var readFor: Double { 5 }

    var body: some View {
        ZStack {
            Color.black.opacity(0.5).ignoresSafeArea()
            VStack(spacing: 18) {
                // As tall as it needs to be; scrolling only when that's more than the screen.
                ViewThatFits(in: .vertical) {
                    lesson
                    ScrollView { lesson }
                }
                TimelineView(.periodic(from: opened, by: 0.05)) { timeline in
                    let left = Self.readFor - timeline.date.timeIntervalSince(opened)
                    Button(action: next) {
                        HStack(spacing: 10) {
                            if waiting {
                                ProgressView()
                            } else {
                                // The five seconds, as a ring going round with what's left inside it.
                                if left > 0 {
                                    ZStack {
                                        Circle().stroke(Color.primary.opacity(0.18), lineWidth: 3)
                                        Circle()
                                            .trim(from: 0, to: min(1, max(0, 1 - left / Self.readFor)))
                                            .stroke(Color.primary.opacity(0.6), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                                            .rotationEffect(.degrees(-90))
                                        Text("\(Int(left.rounded(.up)))")
                                            .font(.system(size: 13, weight: .bold, design: .rounded))
                                            .monospacedDigit()
                                    }
                                    .frame(width: 26, height: 26)
                                    .accessibilityLabel("\(Int(left.rounded(.up))) seconds")
                                }
                                Text(title).font(.headline)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                    }
                    .disabled(left > 0 || waiting)
                    .buttonStyle(.glassProminent)
                    .tint(TuttlesLook.accent)
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(22)
            // Solid, so the question behind doesn't show through what they're reading.
            .background(Color(light: Color(red: 0.995, green: 0.985, blue: 0.97), dark: Color(white: 0.15)),
                        in: .rect(cornerRadius: VocabLook.cardRadius, style: .continuous))
            .shadow(color: .black.opacity(0.25), radius: 30, y: 12)
            .padding(.horizontal, 18)
            .padding(.vertical, 40)
            .frame(maxWidth: 560)
        }
        .accessibilityAddTraits(.isModal)
    }
}

// MARK: - The end

private struct VocabSummaryView: View {
    let summary: VocabSummary
    /// Which of today's sessions just ended.
    let number: Int
    let busy: Bool
    let done: () -> Void
    let again: () -> Void
    /// Another go at the boss round.
    let retry: () -> Void
    /// Straight on into a stage's boss round.
    let fight: (Int) -> Void
    @Environment(ChatStore.self) private var store
    /// The ring and the stage's bar start where they were before the session, then move.
    @State private var moved = false
    /// The session's chest has been opened here (VocabChest.swift).
    @State private var opened = false

    /// The chest an ordinary session earned, still shut: the end opens on
    /// it, full screen, and the numbers wait behind until it's been opened.
    private var chest: VocabPrize? {
        guard summary.boss == nil, !opened, let prize = summary.prize, !prize.isOpen else { return nil }
        return prize
    }

    /// Something to throw confetti for: a boss beaten, a stage cleared, or
    /// this session being the one that finished the day's ten minutes.
    private var celebrating: Bool {
        if let boss = summary.boss { return boss.beaten }
        if summary.climb?.justCleared == true { return true }
        guard let goal = summary.day else { return false }
        return goal.done && goal.ms - summary.elapsedMs < goal.goalMs
    }

    var body: some View {
        let spare = summary.limitMs - summary.elapsedMs
        let goal = summary.day
        // The day's ten minutes aren't up yet: the next session is the way on.
        let more = goal.map { !$0.done } ?? false
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let boss = summary.boss {
                    bossHeader(boss, goal)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        if let goal {
                            // From where the day stood before this session to where it stands now.
                            VocabDayRing(goal: moved ? goal : .init(ms: max(0, goal.ms - summary.elapsedMs), goalMs: goal.goalMs, done: false),
                                         size: 104)
                                .padding(.bottom, 8)
                        } else {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 44))
                                .foregroundStyle(VocabLook.right)
                                .symbolEffect(.bounce, value: summary)
                                .padding(.bottom, 4)
                        }
                        Text(goal.map { $0.done ? "Done for today" : "Session \(number) done" } ?? (number > 1 ? "Session \(number) done" : "Done for today"))
                            .font(.system(.largeTitle, design: .serif).weight(.semibold))
                        if let goal {
                            Text(goal.done ? "\(VocabRules.clock(goal.ms)) of practice today."
                                 : "\(VocabRules.clock(goal.leftMs)) to go of today's ten minutes.")
                                .font(.title3)
                                .foregroundStyle(goal.done ? VocabLook.rightText : VocabLook.amberText)
                        } else {
                            Text(spare >= 0 ? "Finished with \(VocabRules.clock(spare)) to spare."
                                 : "Finished \(VocabRules.clock(spare)) over the ten minutes.")
                                .font(.title3)
                                .foregroundStyle(spare >= 0 ? VocabLook.rightText : VocabLook.amberText)
                        }
                    }
                    .padding(.top, 36)
                }

                GlassEffectContainer(spacing: 10) {
                    HStack(spacing: 10) {
                        stat(summary.correct, of: summary.total, "Right")
                        stat(summary.newItems, "New")
                        stat(summary.masteredGained, "Mastered")
                    }
                }

                // What it paid into the house's purse (HousePay.swift). Until
                // the day's ten minutes are done, it waits.
                if let pay = summary.pay {
                    let waiting = goal.map { !$0.done } ?? false
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 14) {
                            Label("+\(pay.coins.formatted()) coins\(waiting ? " waiting" : "")", systemImage: "circle.fill").foregroundStyle(VocabLook.amberText)
                            if pay.gems > 0 { Label("+\(pay.gems) gem", systemImage: "diamond.fill").foregroundStyle(.cyan) }
                        }
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        if waiting {
                            Text("Your coins go in when today's ten minutes are done.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .vocabGlass(tint: VocabLook.gold.opacity(0.14))
                    .accessibilityElement(children: .combine)
                }

                // The prize for a boss beaten (VocabJokes.swift). Each kid's are a few along from the other's.
                if let boss = summary.boss, boss.beaten,
                   let joke = VocabJokes.joke(stage: boss.stage, shift: store.vocab?.overview?.level == .middle ? 13 : 0) {
                    VocabJokeCard(joke: joke)
                }

                if let climb = summary.climb { climbCard(climb) }

                if !summary.missed.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("To look over").font(.subheadline.weight(.semibold)).padding(.bottom, 8)
                        ForEach(Array(summary.missed.enumerated()), id: \.offset) { index, word in
                            if index > 0 { Divider() }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(word.title).fontWeight(.semibold)
                                Text(word.meaning).font(.subheadline).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 9)
                        }
                        Text("These come back tomorrow.").font(.footnote).foregroundStyle(.secondary).padding(.top, 8)
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .vocabGlass()
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
            .vocabColumn()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 10) {
                if let boss = summary.boss, !boss.beaten {
                    Button(action: retry) {
                        Text("Try again").font(.headline).frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(VocabLook.boss)
                    Button(action: done) {
                        Text(boss.canSkip ? "Skip the boss" : "Not now").font(.headline).frame(maxWidth: .infinity).frame(height: 34)
                    }
                    .buttonStyle(.glass)
                } else if summary.boss != nil {
                    Button(action: done) {
                        Text("Done").font(.headline).frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(TuttlesLook.accent)
                } else if let stage = summary.bossWaiting {
                    // A boss is in the way: it's the way on.
                    Button { fight(stage) } label: {
                        Label("Take on \(VocabBossCharacter.of(stage: stage).name)", systemImage: "bolt.fill").font(.headline).frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(VocabLook.boss)
                    Button(action: more ? again : done) {
                        Text(more ? "Next session" : "Done").font(.headline).frame(maxWidth: .infinity).frame(height: 34)
                    }
                    .buttonStyle(.glass)
                    .disabled(more && busy)
                } else if more {
                    Button(action: again) {
                        Text("Next session").font(.headline).frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(TuttlesLook.accent)
                    .disabled(busy)
                    Button(action: done) {
                        Text("Stop for now").font(.headline).frame(maxWidth: .infinity).frame(height: 34)
                    }
                    .buttonStyle(.glass)
                } else {
                    Button(action: done) {
                        Text("Done").font(.headline).frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(TuttlesLook.accent)
                    Button(action: again) {
                        Text("Do another").font(.headline).frame(maxWidth: .infinity).frame(height: 34)
                    }
                    .buttonStyle(.glass)
                    .disabled(busy)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
            .vocabColumn()
        }
        .overlay { if celebrating, chest == nil { VocabConfetti() } }
        .sensoryFeedback(.success, trigger: moved) { _, now in now && celebrating }
        .overlay {
            if let chest {
                VocabChestOpening(chest: chest.chest, coins: summary.pay?.coins ?? VocabPay.bonus(chest.chest), waiting: more,
                                  opening: { store.vocabLocal?.open(chest) },
                                  done: { withAnimation(.smooth(duration: 0.45)) { opened = true } })
                    .transition(.opacity)
            }
        }
        // The day's ring moves once the numbers are what's on screen.
        .task(id: chest == nil) {
            guard chest == nil else { return }
            withAnimation(.smooth(duration: 1.0).delay(0.3)) { moved = true }
        }
    }

    /// How a boss round came out: the crown, or how close it was.
    private func bossHeader(_ boss: VocabBoss, _ goal: VocabOverview.Goal?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            // Them: knocked flat with the crown on your side of it, or looking pleased with themselves.
            HStack(alignment: .bottom, spacing: 10) {
                Text(boss.character.face)
                    .font(.system(size: 64))
                    .rotationEffect(.degrees(boss.beaten && moved ? 180 : 0))
                    .opacity(boss.beaten ? 0.85 : 1)
                    .scaleEffect(moved ? 1 : 0.4)
                if boss.beaten {
                    Image(systemName: "crown.fill")
                        .font(.system(size: 46))
                        .foregroundStyle(VocabLook.gold.gradient)
                        .symbolEffect(.bounce, value: moved)
                        .scaleEffect(moved ? 1 : 0.4)
                }
            }
            .padding(.bottom, 6)
            .accessibilityHidden(true)
            Text(boss.beaten ? "\(boss.character.name) is beaten!" : "\(boss.character.name) got away")
                .font(.system(.largeTitle, design: .serif).weight(.semibold))
                .minimumScaleFactor(0.7)
                .lineLimit(2)
            // What they have to say about it.
            if boss.beaten {
                Text("“\(boss.character.sore)”").font(.title3).italic().foregroundStyle(.secondary)
            }
            Text(boss.beaten ? "\(boss.name) is yours: \(boss.correct) of \(boss.total) right."
                 : boss.correct < boss.answered ? "\(boss.spare > 0 ? "Two misses" : "A miss") and it's gone. It takes \(boss.needed) of \(boss.total) right to win \(boss.name)."
                 : "You left before the end. It takes \(boss.needed) of \(boss.total) right to win \(boss.name).")
                .font(.title3)
                .foregroundStyle(boss.beaten ? VocabLook.rightText : VocabLook.bossText)
 if !boss.beaten {
                let left = VocabEngine.bossTries - boss.fails
                Text(boss.canSkip ? "That's \(boss.fails) tries. You can go on to the next stage now, and come back for the crown."
                     : "\(left) more \(left == 1 ? "try" : "tries") and you can skip it.")
                    .font(.subheadline.weight(.medium))
            }
            if let goal {
                Text(goal.done ? "Today's ten minutes are done." : "That counts: \(VocabRules.clock(goal.leftMs)) to go of today's ten minutes.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 36)
    }

    /// The stage the session started in, and how much further along it is now.
    private func climbCard(_ climb: VocabClimb) -> some View {
        let stage = climb.stage
        let shown = moved ? stage.met : climb.metBefore
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                VocabStageNode(stage: stage, current: !stage.cleared, size: 56)
                VStack(alignment: .leading, spacing: 2) {
                    Text(climb.justCleared ? "Stage cleared!" : "Stage \(stage.number)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(climb.justCleared ? AnyShapeStyle(VocabLook.rightText) : AnyShapeStyle(.secondary))
                    Text(stage.name).font(.title3.weight(.bold))
                    Text(climb.found > 0 ? "\(climb.found) new \(climb.found == 1 ? "word" : "words") found: \(stage.met) of \(stage.total)."
                         : "\(stage.met) of \(stage.total) words found.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.10))
                    Capsule()
                        .fill(stage.cleared && moved ? VocabLook.right : TuttlesLook.accent)
                        .frame(width: geo.size.width * Double(shown) / Double(max(1, stage.total)))
                }
            }
            .frame(height: 10)
            if climb.justCleared, stage.boss == .ready {
                Label("Beat its boss to open the next stage.", systemImage: "bolt.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(VocabLook.bossText)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vocabGlass(tint: climb.justCleared ? VocabLook.right.opacity(0.14) : nil)
    }

    private func stat(_ value: Int, of total: Int? = nil, _ label: String) -> some View {
        VStack(spacing: 3) {
            HStack(spacing: 4) {
                VocabCountUp(value: value)
                if let total { Text("of \(total)") }
            }
            .font(.title2.weight(.bold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .vocabGlass(radius: 22)
    }
}

// MARK: - Saying a word

@MainActor
enum VocabVoice {
    private static let voice = AVSpeechSynthesizer()

    static func say(_ word: String) {
        voice.stopSpeaking(at: .immediate)
        let say = AVSpeechUtterance(string: word)
        say.voice = AVSpeechSynthesisVoice(language: "en-US")
        say.rate = AVSpeechUtteranceDefaultSpeechRate * 0.9
        voice.speak(say)
    }
}
