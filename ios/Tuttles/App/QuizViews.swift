import SwiftUI

// A quiz chat on screen: each question as a card (multiple choice tappable),
// the recap when it's over, and its progress in the top bar.

/// The quiz a chat is, handed to its message cards: how each question went,
/// and what a tap on a choice does.
@MainActor
@Observable
final class QuizContext {
    var state: QuizState?
    /// A choice tapped and on its way to be graded. It shows as picked at once.
    struct Pick: Equatable { let id: String; let index: Int }
    var pending: Pick?

    /// The option picked on this question while it's being graded.
    func pendingIndex(_ q: QuizQuestion) -> Int? { pending?.id == q.id ? pending?.index : nil }
    var choose: (QuizQuestion, Int) -> Void = { _, _ in }

    /// A question from a saved message, with how it went filled in.
    func live(_ q: QuizQuestion) -> QuizQuestion {
        state?.questions.first { $0.id == q.id } ?? q
    }

    /// Only the open question takes taps, and only while the quiz runs.
    func canAnswer(_ q: QuizQuestion) -> Bool {
        guard let state, !state.finished, pending == nil else { return false }
        return state.open?.id == q.id
    }
}

/// A ```question block in a tutor message.
struct QuestionBlockView: View {
    let json: String
    @Environment(QuizContext.self) private var quiz: QuizContext?

    var body: some View {
        if let parsed = QuizQuestion(block: json) {
            let q = quiz?.live(parsed) ?? parsed
            QuestionCard(
                question: q,
                testRun: quiz?.state?.isTestRun == true,
                pendingIndex: quiz?.pendingIndex(q),
                onChoose: quiz?.canAnswer(q) == true ? { i in quiz?.choose(q, i) } : nil)
        }
    }
}

struct QuestionCard: View {
    let question: QuizQuestion
    var testRun = false
    /// Tapped, being graded: drawn as picked straight away.
    var pendingIndex: Int?
    /// Set while it can be answered by tapping.
    var onChoose: ((Int) -> Void)?
    /// Drawn over the voice call's dark background.
    var onDark = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(question.of.map { "Question \(question.number) of \($0)" } ?? "Question \(question.number)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(TuttlesLook.accent)
                if let topic = question.topic {
                    Text(topic).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            InlineText(question.prompt, style: .headline)
            if let choices = question.choices, question.isChoice {
                VStack(spacing: 8) {
                    ForEach(Array(choices.enumerated()), id: \.offset) { i, choice in
                        ChoiceRow(letter: String(UnicodeScalar(65 + i)!), text: choice, look: look(i))
                            .contentShape(.rect)
                            .onTapGesture {
                                guard let onChoose else { return }
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                onChoose(i)
                            }
                            .disabled(onChoose == nil)
                            .accessibilityAddTraits(onChoose == nil ? [] : .isButton)
                    }
                }
                footer
            } else {
                openAnswerFooter
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        // Over a call, the caller sets a light scheme (as for visuals) and it sits on white.
        .background(onDark ? Color.white : Color(.secondarySystemBackground), in: .rect(cornerRadius: 20))
    }

    enum Look { case plain, chosen, right, wrong, missedRight }

    private func look(_ i: Int) -> Look {
        guard question.answered else { return pendingIndex == i ? .chosen : .plain }
        let chosen = question.chosenIndex == i
        guard let answer = question.answerIndex else { return chosen ? .chosen : .plain }
        if i == answer { return chosen ? .right : .missedRight }
        return chosen ? .wrong : .plain
    }

    @ViewBuilder private var footer: some View {
        if question.answered {
            if question.answerIndex == nil {
                Label(testRun ? "Locked in. Answers at the end." : "Answered", systemImage: "lock.fill")
                    .font(.footnote).foregroundStyle(.secondary)
            } else if question.result == "correct" {
                Label("Right!", systemImage: "checkmark.circle.fill").font(.footnote.weight(.semibold)).foregroundStyle(.green)
            } else if question.result == "hinted" {
                Label("Right, with a hint", systemImage: "lightbulb.fill").font(.footnote.weight(.semibold)).foregroundStyle(.orange)
            } else if question.result == "skipped" {
                Label("Skipped", systemImage: "forward.fill").font(.footnote).foregroundStyle(.secondary)
            } else if question.result == "wrong" {
                Label("Not quite", systemImage: "xmark.circle.fill").font(.footnote.weight(.semibold)).foregroundStyle(.red)
            }
        } else if onChoose != nil {
            Text("Tap an answer, or type or say it.").font(.footnote).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var openAnswerFooter: some View {
        if let result = question.result {
            let (text, symbol, tint): (String, String, Color) = switch result {
            case "correct": ("Right!", "checkmark.circle.fill", .green)
            case "hinted": ("Right, with a hint", "lightbulb.fill", .orange)
            case "skipped": ("Skipped", "forward.fill", .secondary)
            default: ("Not quite", "xmark.circle.fill", .red)
            }
            VStack(alignment: .leading, spacing: 4) {
                Label(text, systemImage: symbol).font(.footnote.weight(.semibold)).foregroundStyle(tint)
                if result != "correct", let answer = question.answer, !answer.isEmpty {
                    InlineText("Answer: \(answer)", style: .footnote).foregroundStyle(.secondary)
                }
            }
        } else if question.answered {
            Label(testRun ? "Locked in. Answers at the end." : "Answered", systemImage: "lock.fill")
                .font(.footnote).foregroundStyle(.secondary)
        } else {
            Label("Type or say your answer.", systemImage: "keyboard")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct ChoiceRow: View {
    let letter: String
    let text: String
    let look: QuestionCard.Look

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(badgeFill)
                if look == .right || look == .missedRight {
                    Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(look == .right ? .white : .green)
                } else if look == .wrong {
                    Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(.white)
                } else {
                    Text(letter).font(.subheadline.weight(.bold)).foregroundStyle(look == .chosen ? .white : .primary)
                }
            }
            .frame(width: 30, height: 30)
            InlineText(text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(rowFill, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(stroke, lineWidth: look == .plain ? 1 : 2))
        .animation(.snappy, value: look)
    }

    private var badgeFill: Color {
        switch look {
        case .plain: Color(.tertiarySystemFill)
        case .chosen: TuttlesLook.accent
        case .right: .green
        case .wrong: .red
        case .missedRight: .green.opacity(0.15)
        }
    }

    private var rowFill: Color {
        switch look {
        case .right, .missedRight: .green.opacity(0.08)
        case .wrong: .red.opacity(0.08)
        case .chosen: TuttlesLook.accent.opacity(0.08)
        case .plain: Color(.systemBackground)
        }
    }

    private var stroke: Color {
        switch look {
        case .plain: Color(.separator)
        case .chosen: TuttlesLook.accent
        case .right, .missedRight: .green
        case .wrong: .red
        }
    }
}

/// How a finished quiz went: the score, which topics moved, and where the set stands.
struct RecapCard: View {
    let state: QuizState
    let recap: QuizState.Recap
    var onAgain: (() -> Void)?
    var onOpenSet: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(state.isTestRun ? "Test run done" : "Quiz done").font(.title3.weight(.bold))
                Spacer()
                Text("\(recap.right)/\(recap.answered)")
                    .font(.title.weight(.bold).monospacedDigit())
                    .foregroundStyle(TuttlesLook.accent)
            }
            if !recap.topics.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(recap.topics) { t in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.name).font(.subheadline.weight(.medium)).lineLimit(2)
                                Text("\(t.right) of \(t.asked) right").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 6)
                            if t.before != t.after {
                                LevelBadge(level: t.before).opacity(0.6)
                                Image(systemName: t.after.step > t.before.step ? "arrow.up.right" : "arrow.down.right")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(t.after.step > t.before.step ? .green : .orange)
                            }
                            LevelBadge(level: t.after)
                        }
                    }
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("\(state.setTitle) overall").font(.subheadline.weight(.semibold))
                    Spacer()
                    LevelBadge(level: recap.overall.level)
                }
                LevelMeter(level: recap.overall.level)
                Text("Ready for \(recap.overall.ready) of \(recap.overall.total) topics")
                    .font(.caption).foregroundStyle(.secondary)
                if let note = recap.overall.note {
                    Label(note, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange)
                }
            }
            HStack(spacing: 10) {
                if let onAgain {
                    Button(action: onAgain) {
                        Label("Quiz me again", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                }
                if let onOpenSet {
                    Button(action: onOpenSet) { Text("See the set").frame(maxWidth: .infinity) }
                        .buttonStyle(.glass)
                }
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(16)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 20))
    }
}

/// "3 of 10" (and, in a test run, the time left) in a quiz chat's top bar.
struct QuizProgress: View {
    let state: QuizState
    /// When a test run began on this phone; its clock only shows then.
    let startedAt: Date?

    var body: some View {
        HStack(spacing: 8) {
            Text(state.finished ? "Done" : "\(min(state.answeredCount + (state.open == nil ? 0 : 1), state.count)) of \(state.count)")
                .monospacedDigit()
            if state.isTestRun, !state.finished, let startedAt {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let left = max(0, Self.limit(state) - context.date.timeIntervalSince(startedAt))
                    Text(Duration.seconds(left).formatted(.time(pattern: .minuteSecond)))
                        .monospacedDigit()
                        .foregroundStyle(left < 60 ? .red : .secondary)
                }
            }
        }
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .glassEffect(.regular, in: .capsule)
    }

    /// A test run's time: about a minute a question, like the ISEE's pace.
    static func limit(_ state: QuizState) -> TimeInterval { TimeInterval(state.count) * 60 }
}
