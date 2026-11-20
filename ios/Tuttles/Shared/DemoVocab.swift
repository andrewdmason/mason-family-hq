import Foundation

/// Vocab on made-up progress, with no sign-in or network: `--demo`, for the
/// simulator. `--vocab` opens on it, `--vocab-late` starts the session two
/// questions from its end, to get to the last screen, and `--vocab-slow` makes
/// every answer take two seconds to save, as on a bad connection.
@MainActor
enum DemoVocab {
    private struct Card {
        let kind: VocabQuestion.Kind
        let stem: String
        let choices: [String]
        let correct: Int
        let isNew: Bool
        let feedback: (Int?) -> VocabFeedback
    }

    private static func word(_ title: String, _ pos: String, _ meaning: String, _ example: String, _ hook: String,
                             tip: String, parts: [VocabFeedback.Part] = [], correct: Int, why: [Int: String]) -> (Int?) -> VocabFeedback {
        { choice in
            VocabFeedback(result: choice == nil ? "dontknow" : choice == correct ? "correct" : "wrong",
                          correctIndex: correct, chosenWhy: choice.flatMap { why[$0] }, tip: tip, title: title, pos: pos,
                          meaning: meaning, example: example, hook: hook, parts: parts, mastered: title == "abundant" && choice == correct)
        }
    }

    private static let cards: [Card] = [
        Card(kind: .syn, stem: "BENEVOLENT", choices: ["generous", "hostile", "beneficial", "violent"], correct: 0, isNew: true,
             feedback: word("benevolent", "adjective", "kind and wanting to help others",
                            "A benevolent neighbor shoveled every driveway on the street.",
                            "Bene means good, as in benefit: a benevolent person wishes you good.",
                            tip: "Start from the word part. Bene- is good, so look for the kindest choice.",
                            parts: [.init(part: "bene-", meaning: "good, well"), .init(part: "vol", meaning: "to wish")],
                            correct: 0, why: [1: "Hostile is the opposite: unfriendly.", 2: "It looks alike, but beneficial describes a thing that helps, not a kind person.", 3: "It only sounds a little alike."])),
        Card(kind: .sc, stem: "After a week of rain the garden was ______, with tomatoes on every vine.",
             choices: ["barren", "abundant", "abrupt", "adequate"], correct: 1, isNew: false,
             feedback: word("abundant", "adjective", "more than enough; plentiful",
                            "Wildflowers were abundant after the wet spring.",
                            "Think of a bun dance: so many buns they're dancing off the table.",
                            tip: "The clue is \"on every vine\": you need a word for plenty.",
                            correct: 1, why: [0: "Barren is the opposite: nothing grows.", 2: "It looks alike, but abrupt means sudden.", 3: "Adequate is just enough, which is too weak for every vine."])),
        Card(kind: .part, stem: "The word part \"-less\" means…", choices: ["full of", "again", "without", "before"], correct: 2, isNew: false,
             feedback: { choice in
                 VocabFeedback(result: choice == nil ? "dontknow" : choice == 2 ? "correct" : "wrong", correctIndex: 2,
                               chosenWhy: choice == 0 ? "That's -ful, its opposite." : nil,
                               tip: "Try it on a word you know: fearless is without fear.", title: "-less", pos: "suffix",
                               meaning: "without", example: "As in fearless and careless.", hook: "Less of something, all the way down to none.",
                               parts: [], mastered: false)
             }),
        Card(kind: .syn, stem: "RELUCTANT", choices: ["eager", "unwilling", "relaxed", "reliable"], correct: 1, isNew: true,
             feedback: word("reluctant", "adjective", "not wanting to do something",
                            "He was reluctant to jump into the cold lake.",
                            "Picture dragging your feet to the edge of the diving board.",
                            tip: "Reluctant is a holding-back word, so it leans negative. Rule out the cheerful choices first.",
                            correct: 1, why: [0: "Eager is the opposite.", 2: "It starts the same, but relaxed means calm.", 3: "A look-alike: reliable means you can count on it."])),
    ]

    private static var answered = 0
    private static var correct = 0
    private static var missed: [VocabSummary.Missed] = []
    private static var elapsed = 0
    private static let total = 18
    private static let limit = 600_000

    private static var card: Card { cards[answered % cards.count] }

    /// An answer's trip to the website and back.
    static var delay: Duration { CommandLine.arguments.contains("--vocab-slow") ? .seconds(2) : .zero }

    private static func question(_ index: Int) -> VocabQuestion? {
        guard index < total else { return nil }
        let c = cards[index % cards.count]
        return VocabQuestion(position: index + 1, total: total, kind: c.kind, stem: c.stem, choices: c.choices,
                             isNew: c.isNew, allowDontKnow: true, key: key(c))
    }

    private static func state() -> VocabState {
        if answered >= total {
            return VocabState(sessionId: "demo", elapsedMs: elapsed, limitMs: limit, noDontKnow: false, question: nil,
                              summary: VocabSummary(total: total, correct: correct, wrong: total - correct, dontknow: 0, elapsedMs: elapsed,
                                                    limitMs: limit, newItems: 7, masteredGained: 2, missed: missed))
        }
        return VocabState(sessionId: "demo", elapsedMs: elapsed, limitMs: limit, noDontKnow: false,
                          question: question(answered), summary: nil, nextIfRight: question(answered + 1))
    }

    /// The card's answer, as the website sends it with the question.
    private static func key(_ c: Card) -> VocabQuestion.Key {
        let right = c.feedback(c.correct)
        return VocabQuestion.Key(correctIndex: c.correct, whys: c.choices.indices.map { c.feedback($0).chosenWhy },
                                 masteredIfRight: right.mastered, tip: right.tip, title: right.title, pos: right.pos,
                                 meaning: right.meaning, example: right.example, hook: right.hook, parts: right.parts)
    }

    static func begin() -> VocabState {
        let late = CommandLine.arguments.contains("--vocab-late")
        answered = late ? total - 2 : 0
        correct = late ? 13 : 0
        elapsed = late ? 452_000 : 0
        missed = late ? [.init(title: "reluctant", meaning: "not wanting to do something"),
                         .init(title: "candid", meaning: "honest and direct"),
                         .init(title: "-less", meaning: "without")] : []
        return state()
    }

    static func answer(choice: Int?, ms: Int) -> VocabAnswer {
        let c = card
        let feedback = c.feedback(choice)
        if feedback.isCorrect { correct += 1 } else if !missed.contains(where: { $0.title == feedback.title }) {
            missed.append(.init(title: feedback.title, meaning: feedback.meaning))
        }
        answered += 1
        elapsed += ms
        return VocabAnswer(feedback: feedback, state: state())
    }

    static func removeCurrent() -> VocabState {
        answered += 1
        return state()
    }

    private static func overview(_ level: VocabLevel, done: Bool, streak: Int, mastered: Int, almost: Int, learning: Int) -> VocabOverview {
        let days = (0..<14).map { i in
            VocabOverview.Day(day: "2026-11-\(String(format: "%02d", 7 + i))", done: i == 13 ? done : i > 13 - streak - (done ? 0 : 1) || i % 4 == 1)
        }
        return VocabOverview(
            level: level, questions: level == .lower ? 18 : 22, today: "2026-11-20",
            doneToday: done ? .init(elapsedMs: 470_000, limitMs: limit, correct: 18, total: 22) : nil,
            inProgress: nil, sessionsToday: done ? 1 : 0, streak: streak, recentDays: days,
            counts: ["mastered": mastered, "almost": almost, "learning": learning, "new": 500 - mastered - almost - learning - 3, "removed": 3],
            totalWords: 497, parts: .init(met: 14, mastered: 5, total: 50),
            trouble: [
                .init(id: "w:reluctant", title: "reluctant", meaning: "not wanting to do something", misses: 3),
                .init(id: "w:candid", title: "candid", meaning: "honest and direct", misses: 2),
                .init(id: "w:meager", title: "meager", meaning: "very small in amount", misses: 2),
                .init(id: "p:mal", title: "mal-", meaning: "bad", misses: 1),
            ],
            accuracy: level == .lower ? 0.78 : 0.84)
    }

    static func home(parent: Bool, kid: String?) -> VocabHome {
        let oscar = overview(.lower, done: false, streak: 4, mastered: 31, almost: 46, learning: 22)
        let sebastian = overview(.middle, done: true, streak: 6, mastered: 48, almost: 61, learning: 17)
        if parent {
            return VocabHome(view: "parent", name: nil, daysLeft: 52, overview: nil, kids: [
                .init(id: UUID(uuidString: "00000000-0000-0000-0000-00000000000a")!, name: "Oscar", overview: oscar),
                .init(id: UUID(uuidString: "00000000-0000-0000-0000-00000000000b")!, name: "Sebastian", overview: sebastian),
            ])
        }
        let name = kid ?? "Oscar"
        return VocabHome(view: "kid", name: name, daysLeft: 52, overview: name == "Sebastian" ? sebastian : oscar, kids: nil)
    }

    static func list(canEdit: Bool) -> VocabList {
        let seed: [(String, String, String, VocabStatus, Int)] = [
            ("reluctant", "adjective", "not wanting to do something", .learning, 3),
            ("candid", "adjective", "honest and direct", .learning, 2),
            ("meager", "adjective", "very small in amount", .learning, 2),
            ("abundant", "adjective", "more than enough; plentiful", .mastered, 0),
            ("benevolent", "adjective", "kind and wanting to help others", .almost, 0),
            ("coax", "verb", "to gently persuade", .almost, 0),
            ("diminish", "verb", "to make or become smaller", .mastered, 0),
            ("elated", "adjective", "extremely happy", .mastered, 0),
            ("frugal", "adjective", "careful about spending", .almost, 1),
            ("gullible", "adjective", "easily fooled", .new, 0),
            ("hasty", "adjective", "done too quickly", .new, 0),
            ("idle", "adjective", "not busy or working", .removed, 0),
            ("jovial", "adjective", "cheerful and friendly", .new, 0),
            ("keen", "adjective", "sharp, or very eager", .new, 0),
        ]
        var words: [VocabRow] = []
        for (i, w) in seed.enumerated() {
            let unmet = w.3 == .new || w.3 == .removed
            let known = w.0 == "benevolent"
            let example: String = known ? "A benevolent neighbor shoveled every driveway on the street." : "She gave a \(w.0) answer."
            let hook: String = known ? "Bene means good, as in benefit: a benevolent person wishes you good." : "Say it in a sentence about your own day."
            let pieces: [VocabFeedback.Part] = known ? [.init(part: "bene-", meaning: "good, well"), .init(part: "vol", meaning: "to wish")] : []
            words.append(VocabRow(id: "w:\(w.0)", title: w.0, pos: w.1, meaning: w.2, example: example, hook: hook, parts: pieces,
                                  status: w.3, dueOn: unmet ? nil : "2026-11-22", seen: unmet ? 0 : 4 + w.4, right: unmet ? 0 : 4,
                                  misses: w.4, trouble: w.4 >= 2, rank: i))
        }
        let partSeed: [(String, String, String, VocabStatus)] = [
            ("bene-", "prefix", "good, well", .mastered), ("mal-", "prefix", "bad", .learning),
            ("-less", "suffix", "without", .almost), ("scrib/script", "root", "to write", .new),
        ]
        var parts: [VocabRow] = []
        for (i, p) in partSeed.enumerated() {
            let met = p.3 != .new
            parts.append(VocabRow(id: "p:\(p.0)", title: p.0, pos: p.1, meaning: p.2, example: "benefit, benevolent",
                                  hook: "Spot it at the front of a word.", parts: [], status: p.3, dueOn: nil,
                                  seen: met ? 3 : 0, right: met ? 2 : 0, misses: p.3 == .learning ? 1 : 0, trouble: false, rank: i))
        }
        return VocabList(words: words, parts: parts, canEdit: canEdit)
    }
}
