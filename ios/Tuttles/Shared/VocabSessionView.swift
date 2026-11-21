import AVFoundation
import SwiftUI

// A Vocab session on screen: the clock and how far along at the top, one
// question on glass, and after a miss the word laid out to learn from. It
// takes over the screen, so there's nothing to wander off to; closing it
// keeps the session, which picks up where it was.

struct VocabSessionView: View {
    let run: VocabRun
    @Environment(\.dismiss) private var dismiss

    private var mood: VocabMood {
        if run.summary != nil { return .done }
        guard let feedback = run.feedback else { return .calm }
        return feedback.isCorrect ? .right : .miss
    }

    var body: some View {
        ZStack {
            VocabBackdrop(mood: mood)
            if let summary = run.summary {
                VocabSummaryView(summary: summary, number: run.number, busy: run.busy, done: { dismiss() }, again: { Task { await run.again() } })
                    .transition(.opacity)
            } else if let question = run.question {
                VocabQuestionView(run: run, question: question, close: { dismiss() })
            }
        }
        .animation(.default, value: run.summary != nil)
        .sensoryFeedback(trigger: run.feedback) { _, new in
            guard let new else { return nil }
            return new.isCorrect ? .success : .error
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
        ScrollViewReader { proxy in
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
                    if let missed {
                        lesson(missed)
                            .padding(.top, 18)
                            .padding(.bottom, 14)
                            .id("lesson")
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
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
                } else {
                    // Once the card is laid out, bring it up from under the Next button.
                    Task {
                        try? await Task.sleep(for: .seconds(0.25))
                        withAnimation(.smooth) { proxy.scrollTo("lesson", anchor: .bottom) }
                    }
                }
            }
        }
        // A bar, so what scrolls up under it blurs away rather than running into the clock.
        .safeAreaBar(edge: .top, spacing: 0) { bar }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if missed != nil {
                Button {
                    withAnimation(.snappy) { run.advance() }
                } label: {
                    Group {
                        // The next question is nearly always here already; on a slow line it's a moment behind.
                        if run.wantsNext, !run.failed {
                            ProgressView()
                        } else {
                            Text(run.failed ? "Try again" : last ? "Finish" : "Next").font(.headline)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                }
                .disabled(run.wantsNext && !run.failed)
                .buttonStyle(.glassProminent)
                .tint(TuttlesLook.accent)
                .keyboardShortcut(.defaultAction)
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
                .vocabColumn()
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
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

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    if run.number > 1 {
                        Text("Session \(run.number)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(TuttlesLook.accent)
                    }
                    Text("\(question.position) of \(question.total)").font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(.secondary)
                }
                ProgressView(value: run.progress)
                    .tint(TuttlesLook.accent)
                    .animation(.snappy, value: run.progress)
            }

            TimelineView(.periodic(from: .now, by: 0.25)) { timeline in
                let left = run.leftMs(at: timeline.date)
                Text(left < 0 ? "+\(VocabRules.clock(left))" : VocabRules.clock(left))
                    .font(.headline)
                    .monospacedDigit()
                    .foregroundStyle(left < 0 ? VocabLook.wrong : left < 60_000 ? VocabLook.amberText : Color.primary)
                    .frame(minWidth: 52)
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .glassEffect(left < 0 ? .regular.tint(VocabLook.wrong.opacity(0.18))
                                 : left < 60_000 ? .regular.tint(VocabLook.amber.opacity(0.22)) : .regular, in: .capsule)
                    .accessibilityLabel(left < 0 ? "\(VocabRules.clock(left)) over time" : "\(VocabRules.clock(left)) left")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .vocabColumn()
    }

    private var stem: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(question.kind.ask).font(.subheadline).foregroundStyle(.secondary)
                if question.isNew {
                    Text("New")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(TuttlesLook.accent, in: .capsule)
                }
            }
            if question.kind == .syn {
                Text(question.stem)
                    .font(.system(size: 40, weight: .semibold, design: .serif))
                    .kerning(1.5)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
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
                            .font(.headline)
                            .foregroundStyle(VocabLook.rightText)
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
                    Text("Test-day practice: rule out what you can, then take your best guess.")
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

    /// After a miss: the word, why their pick was wrong, and what to try next time.
    private func lesson(_ feedback: VocabFeedback) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VocabWordCard(title: feedback.title, pos: feedback.pos, meaning: feedback.meaning, example: feedback.example,
                          hook: feedback.hook, parts: feedback.parts, speak: feedback.isWord)
            if let why = feedback.chosenWhy, case .choice(let index) = run.picked, question.choices.indices.contains(index) {
                Divider()
                Text("\(Text("Why not \(question.choices[index])? ").fontWeight(.semibold))\(why)").font(.subheadline)
            }
            Divider()
            Text("\(Text("Next time: ").fontWeight(.semibold))\(feedback.tip)").font(.subheadline)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vocabGlass()
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

    var body: some View {
        let spare = summary.limitMs - summary.elapsedMs
        let goal = summary.day
        // The day's ten minutes aren't up yet: the next session is the way on.
        let more = goal.map { !$0.done } ?? false
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    if let goal {
                        VocabDayRing(goal: goal, size: 104).padding(.bottom, 8)
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

                GlassEffectContainer(spacing: 10) {
                    HStack(spacing: 10) {
                        stat("\(summary.correct) of \(summary.total)", "Right")
                        stat("\(summary.newItems)", "New")
                        stat("\(summary.masteredGained)", "Mastered")
                    }
                }

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
                if more {
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
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 3) {
            Text(value).font(.title2.weight(.bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
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
