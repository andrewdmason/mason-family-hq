import SwiftUI

// Sorting out the words known already: a page of words on glass to tap the
// unsure ones on, a quick real question or two on the rest (a miss keeps that
// word in; two keep the page in), and on to the next page. Like a session it takes over the screen; closing it keeps every
// page finished so far.

struct VocabSortView: View {
    let sort: VocabSort
    @Environment(\.dismiss) private var dismiss

    private var mood: VocabMood {
        switch sort.phase {
        case .finished: .done
        case .missed: .miss
        case .checking: sort.feedback?.isCorrect == true ? .right : .calm
        default: .calm
        }
    }

    var body: some View {
        ZStack {
            VocabBackdrop(mood: mood)
            switch sort.phase {
            case .loading:
                ProgressView()
            case .failed:
                VStack(spacing: 14) {
                    Text("Tuttles couldn't be reached.").foregroundStyle(.secondary)
                    Button("Try again") { Task { sort.page == nil ? await sort.start() : await sort.keepGoing() } }
                        .buttonStyle(.glass)
                    Button("Close") { dismiss() }.buttonStyle(.plain).foregroundStyle(.secondary)
                }
            case .sorting:
                if let page = sort.page { grid(page).id(page.through).transition(.opacity) }
            case .checking, .missed:
                if let check = sort.check { VocabSortCheck(sort: sort, word: check).id(check.id).transition(.opacity) }
            case .finished:
                finished.transition(.opacity)
            }
        }
        .animation(.default, value: sort.phase)
        .animation(.default, value: sort.page?.through)
        .animation(.snappy, value: sort.check?.id)
        .sensoryFeedback(trigger: sort.feedback) { _, new in
            guard let new else { return nil }
            return new.isCorrect ? .success : .error
        }
        .task { await sort.start() }
        #if os(macOS)
        .frame(minWidth: 560, idealWidth: 640, minHeight: 620, idealHeight: 720)
        #endif
    }

    // MARK: A page of words

    private func grid(_ page: VocabSortPage) -> some View {
        let known = sort.known.count
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Tap any word you're not sure of")
                        .font(.system(.title2, design: .serif).weight(.semibold))
                    Text("The rest won't come up in your sessions. There's a quick check first.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 2)

                // Twenty words have to fit a phone without scrolling.
                GlassEffectContainer(spacing: 6) {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 6) {
                        ForEach(page.words) { word in
                            chip(word)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
            .vocabColumn()
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .top, spacing: 0) { bar(page) }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Button { Task { await sort.confirm() } } label: {
                Text(known == page.words.count ? "I know all \(known)"
                     : known == 0 ? "I don't know any of these"
                     : "I know the other \(known)")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
            }
            .buttonStyle(.glassProminent)
            .tint(TuttlesLook.accent)
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
            .vocabColumn()
        }
    }

    private func chip(_ word: VocabSortPage.Word) -> some View {
        let unsure = sort.unsure.contains(word.id)
        return Button { sort.toggle(word) } label: {
            HStack(spacing: 8) {
                Text(word.title)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 0)
                Image(systemName: unsure ? "questionmark.circle.fill" : "circle")
                    .foregroundStyle(unsure ? VocabLook.amberText : Color.primary.opacity(0.18))
            }
            .padding(.horizontal, 14)
            .frame(height: 42)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .glassEffect(unsure ? .regular.tint(VocabLook.amber.opacity(0.40)).interactive() : .regular.interactive(),
                     in: .rect(cornerRadius: 16, style: .continuous))
        .animation(.snappy, value: unsure)
        .accessibilityLabel(word.title)
        .accessibilityValue(unsure ? "Not sure" : "Know it")
    }

    /// Close, and where things stand.
    private func bar(_ page: VocabSortPage) -> some View {
        HStack(spacing: 12) {
            closeButton
            VStack(alignment: .leading, spacing: 2) {
                Text("\(page.left) \(page.left == 1 ? "word" : "words") left to look at")
                    .font(.caption.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                if let last = sort.lastSkipped {
                    Text(sort.skipped > 0 ? "\(sort.skipped) skipped so far" : "Nothing skipped yet")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(last > 0 ? VocabLook.rightText : VocabLook.amberText)
                        .accessibilityHint(last > 0 ? "" : "The last page's words stayed in")
                }
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .vocabColumn()
    }

    private var closeButton: some View {
        Button { dismiss() } label: {
            Image(systemName: "xmark").font(.subheadline.weight(.semibold)).frame(width: 40, height: 40)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel("Close")
    }

    // MARK: The end

    private var finished: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(VocabLook.right)
                    .padding(.bottom, 4)
                Text("Sorted").font(.system(.largeTitle, design: .serif).weight(.semibold))
                Text(sort.skipped > 0
                     ? "\(sort.skipped) \(sort.skipped == 1 ? "word" : "words") skipped. \(sort.skipped == 1 ? "It" : "They") won't come up in your sessions."
                     : "Nothing skipped: every word comes up in your sessions.")
                    .font(.title3)
                    .foregroundStyle(VocabLook.rightText)
                Text(sort.reachedEnd
                     ? "That's every word looked at."
                     : "From here on it's mostly words you don't know yet, which is what the sessions are for.")
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
                if sort.saveFailed {
                    Button { Task { await sort.retrySave() } } label: {
                        Text("Some of that didn't save. Try again").font(.subheadline.weight(.medium)).foregroundStyle(VocabLook.wrong)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                }
            }
            .padding(.top, 60)
            Spacer()
            VStack(spacing: 10) {
                Button { dismiss() } label: {
                    Text("Done").font(.headline).frame(maxWidth: .infinity).frame(height: 40)
                }
                .buttonStyle(.glassProminent)
                .tint(TuttlesLook.accent)
                .disabled(sort.saving)
                if !sort.reachedEnd {
                    Button { Task { await sort.keepGoing() } } label: {
                        Text("Keep sorting").font(.headline).frame(maxWidth: .infinity).frame(height: 34)
                    }
                    .buttonStyle(.glass)
                }
            }
            .padding(.bottom, 8)
        }
        .padding(.horizontal, 20)
        .vocabColumn()
    }
}

// MARK: - A spot check

/// One real question on a word they said they know.
private struct VocabSortCheck: View {
    let sort: VocabSort
    let word: VocabSortPage.Word
    @Environment(\.dismiss) private var dismiss

    private static let letters = ["A", "B", "C", "D", "E"]
    private var question: VocabQuestion { word.question }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(question.kind.ask).font(.subheadline).foregroundStyle(.secondary)
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

                GlassEffectContainer(spacing: 10) {
                    VStack(spacing: 10) {
                        ForEach(Array(question.choices.enumerated()), id: \.offset) { index, text in
                            choice(index, text)
                        }
                    }
                }
                .padding(.top, 22)

                if let feedback = sort.feedback, !feedback.isCorrect {
                    missed(feedback)
                } else if sort.feedback == nil {
                    Button { Task { await sort.answer(.dontKnow) } } label: {
                        Text("Don't know")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .overlay {
                                RoundedRectangle(cornerRadius: VocabLook.cardRadius, style: .continuous)
                                    .strokeBorder(Color.primary.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                            }
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 12)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
            .vocabColumn()
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 12) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.subheadline.weight(.semibold)).frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Close")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Quick check").font(.caption.weight(.semibold)).foregroundStyle(TuttlesLook.accent)
                    Text("\(sort.checkIndex + 1) of \(sort.checks.count), on words you said you know")
                        .font(.caption.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
            .vocabColumn()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if sort.phase == .missed {
                Button { Task { await sort.carryOn() } } label: {
                    Text("Carry on").font(.headline).frame(maxWidth: .infinity).frame(height: 40)
                }
                .buttonStyle(.glassProminent)
                .tint(TuttlesLook.accent)
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
                .vocabColumn()
            }
        }
    }

    private func choice(_ index: Int, _ text: String) -> some View {
        let feedback = sort.feedback
        let tint: Color? = feedback?.correctIndex == index ? VocabLook.right.opacity(0.45)
            : feedback != nil && sort.picked == .choice(index) ? VocabLook.wrong.opacity(0.40) : nil
        return Button { Task { await sort.answer(.choice(index)) } } label: {
            HStack(spacing: 14) {
                Text(Self.letters[min(index, Self.letters.count - 1)])
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .background(Color.primary.opacity(0.07), in: .circle)
                Text(text).font(.title3).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(sort.picked != nil)
        .glassEffect(tint.map { .regular.tint($0) } ?? .regular.interactive(),
                     in: .rect(cornerRadius: VocabLook.cardRadius, style: .continuous))
    }

    /// The word laid out, and what the miss means: that word stays in, or after two the whole page.
    private func missed(_ feedback: VocabFeedback) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(Text(feedback.title).fontWeight(.semibold))\(Text(": \(feedback.meaning)").foregroundStyle(.secondary))")
                .font(.title3)
            if let why = feedback.chosenWhy, case .choice(let index) = sort.picked, question.choices.indices.contains(index) {
                Text("\(Text("Why not \(question.choices[index])? ").fontWeight(.semibold))\(why)").font(.subheadline)
            }
            Divider()
            Text(sort.keepsPage
                 ? "That's two missed, so this page's words all stay in. They'll come up in your sessions, and the ones you know will be gone after one right answer."
                 : "So \(feedback.title) stays in your sessions. One more quick check on this page.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vocabGlass(tint: VocabLook.amber.opacity(0.18))
        .padding(.top, 16)
    }
}
