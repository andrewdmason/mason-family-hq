import Foundation

// Vocab's rules, on the phone: what to ask next, what an answer does to a
// word, and where that leaves the day. This is the website's schedule
// (src/lib/words/schedule.ts, with the session-keeping of session.ts and the
// overview of overview.ts) written again in Swift, so a session can be played
// with no connection. The website has the last word: the answers are sent up
// when there's a connection and gone through again there
// (src/lib/words/offline.ts), and what it makes of them replaces what's here.
//
// The two have to agree. ios/Tuttles/Tests/vocab-parity.json is a few weeks of
// sessions played by the website's code; VocabParityTests plays them again
// through this and has to choose the same questions and end in the same place.
// The schedule's numbers aren't here at all: they come down with the words.

// MARK: - Days

/// Calendar days as the website writes them, "2026-11-23", and the sums on them.
enum VocabDay {
    /// Days since 1970-01-01.
    static func number(_ day: String) -> Int {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return 0 }
        let y = p[1] <= 2 ? p[0] - 1 : p[0]
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (p[1] + (p[1] > 2 ? -3 : 9)) + 2) / 5 + p[2] - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    static func string(_ number: Int) -> String {
        let z = number + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        let y = yoe + era * 400 + (m <= 2 ? 1 : 0)
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    static func add(_ day: String, _ n: Int) -> String { string(number(day) + n) }
    static func between(_ from: String, _ to: String) -> Int { number(to) - number(from) }

    /// The family's day at a moment: a session belongs to the day it's started
    /// on at home, wherever the phone is (wordsToday in src/lib/words/day.ts).
    static func of(_ date: Date, zone: String) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? .current
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// A moment as the website writes one, "2026-11-23T20:15:01.123Z": they sort as text.
    static func stamp(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }
}

// MARK: - What comes down with the words

/// The schedule's numbers (RULES in src/lib/words/schedule.ts).
struct VocabRuleSet: Codable, Hashable {
    let testDate: String
    let newWordsStopDays: Int
    let sessionNewUnknown: Int
    let dailyNewParts: Int
    let partEvery: Int
    let requeueGap: Int
    let gapByStage: [Int]
    let masteredGapMax: Int
    let retiredGap: Int
    let dayGoalMs: Int
    let questionMaxMs: Int
    let dayGoalFrom: String
}

/// A word or word part with everything a question and its lesson need
/// (PackItem in src/lib/words/pack.ts).
struct VocabItem: Codable, Hashable, Identifiable {
    struct Trap: Codable, Hashable {
        let text: String
        let why: String?
    }

    /// Another vocab word as a wrong answer to a sentence completion (Decoy in src/lib/words/types.ts).
    struct Decoy: Codable, Hashable {
        let text: String
        let why: String?
        /// The word's id, to tell whether they've met it.
        let item: String
    }

    /// One way of asking.
    struct Form: Codable, Hashable {
        let key: String
        /// "syn", "sc" or "part".
        let kind: String
        let stem: String
        let answer: String
        let traps: [Trap]
        /// Sentence completions only: vocab words to ask it with in place of the traps (VocabEngine.pickWrong).
        var decoys: [Decoy]? = nil
        let tip: String
    }

    /// "w:abundant" or "p:bene".
    let id: String
    let title: String
    let pos: String
    let meaning: String
    let example: String?
    let hook: String
    /// Ids of the word parts it's built from.
    let parts: [String]
    let rank: Int
    /// In the order they're asked in.
    let forms: [Form]

    var isWord: Bool { id.hasPrefix("w:") }
}

/// A level's words and the word parts.
struct VocabContent: Codable {
    let version: String
    let level: VocabLevel
    /// Each in the order they're met.
    let words: [VocabItem]
    let parts: [VocabItem]

    func item(_ id: String) -> VocabItem? { index[id] }

    private let index: [String: VocabItem]

    init(version: String, level: VocabLevel, words: [VocabItem], parts: [VocabItem]) {
        self.version = version
        self.level = level
        self.words = words.sorted { $0.rank < $1.rank }
        self.parts = parts.sorted { $0.rank < $1.rank }
        index = Dictionary((words + parts).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private enum CodingKeys: String, CodingKey { case version, level, words, parts }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(version: c.decode(String.self, forKey: .version), level: c.decode(VocabLevel.self, forKey: .level),
                      words: c.decode([VocabItem].self, forKey: .words), parts: c.decode([VocabItem].self, forKey: .parts))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version)
        try c.encode(level, forKey: .level)
        try c.encode(words, forKey: .words)
        try c.encode(parts, forKey: .parts)
    }
}

/// Where someone is with one word or part (a words_progress row). None means it's still new.
struct VocabProgress: Codable, Hashable {
    var item: String
    /// 0 learning, 1 and 2 almost, 3 mastered.
    var stage: Int
    var dueOn: String
    var fast: Bool
    var firstSeenOn: String
    var lastSeenOn: String
    var lastCorrectOn: String?
    var correctDays: Int
    var formsRight: [String]
    var lastForm: String?
    var seen: Int
    var rightCount: Int
    var wrongCount: Int
    var dontknowCount: Int
    var masteredAt: String?
    /// Taken out by the person: never asked unless they bring it back.
    var removedAt: String?

    private enum CodingKeys: String, CodingKey {
        case item, stage, fast, seen
        case dueOn = "due_on", firstSeenOn = "first_seen_on", lastSeenOn = "last_seen_on", lastCorrectOn = "last_correct_on"
        case correctDays = "correct_days", formsRight = "forms_right", lastForm = "last_form"
        case rightCount = "right_count", wrongCount = "wrong_count", dontknowCount = "dontknow_count"
        case masteredAt = "mastered_at", removedAt = "removed_at"
    }

    var status: VocabStatus {
        if removedAt != nil { return .removed }
        if stage >= 3 { return .mastered }
        return stage == 0 ? .learning : .almost
    }

    /// Words to worry about: missed at least twice and not yet mastered (troubleScore).
    var trouble: Int {
        let misses = wrongCount + dontknowCount
        return removedAt == nil && stage < 3 && misses >= 2 ? misses : 0
    }
}

/// A session, as the website keeps one and as it's played here (PackSession
/// in src/lib/words/offline.ts).
struct VocabLocalSession: Codable, Hashable, Identifiable {
    struct Requeue: Codable, Hashable {
        let item: String
        /// The question it was missed at.
        let at: Int
    }

    struct Choice: Codable, Hashable {
        let text: String
        let why: String?
        let right: Bool
    }

    /// The question on screen, with its answer.
    struct Current: Codable, Hashable {
        let item: String
        let form: String
        let choices: [Choice]
        let correct: Int
        let isNew: Bool
        let requeued: Bool
        /// A right answer would make it mastered.
        let masteredIfRight: Bool
    }

    var id: String
    /// The day it was started, at home.
    var day: String
    var total: Int
    var answered = 0
    var correct = 0
    var wrong = 0
    var dontknow = 0
    var elapsedMs = 0
    var limitMs: Int
    var noDontKnow: Bool
    var newItems = 0
    var masteredGained = 0
    var startedAt: String
    var finishedAt: String?
    /// Missed this session and waiting to come round again.
    var requeue: [Requeue] = []
    /// The items asked so far, in order.
    var asked: [String] = []
    /// The ones missed, for the end screen.
    var missed: [String] = []
    /// Only on the phone it's being played on.
    var current: Current?
    /// The stage whose boss round this is; nil for an ordinary session.
    var boss: Int?
    /// A boss round's words, in the order they're asked. Only on the phone it's being played on.
    var lineup: [String]?

    var isFinished: Bool { finishedAt != nil }
}

// MARK: - The rules

enum VocabEngine {
    typealias Progress = [String: VocabProgress]

    // MARK: The schedule (src/lib/words/schedule.ts)

    /// New words are held back in the last week before the test (and not after it's passed).
    static func newWordsAllowed(_ today: String, _ rules: VocabRuleSet) -> Bool {
        let left = VocabDay.between(today, rules.testDate)
        return left < 0 || left > rules.newWordsStopDays
    }

    /// A test-day session has no "Don't know": every other day in the last
    /// three weeks, and every day in the last five.
    static func isTestDaySession(_ today: String, _ rules: VocabRuleSet) -> Bool {
        let left = VocabDay.between(today, rules.testDate)
        if left < 0 || left > 21 { return false }
        return left <= 5 || left % 2 == 0
    }

    /// What an answer does to an item. `progress` is nil the first time it's ever asked.
    static func applyAnswer(_ progress: VocabProgress?, item: String, form: String, result: String,
                            today: String, now: String, rules: VocabRuleSet) -> VocabProgress {
        let base = progress ?? VocabProgress(item: item, stage: 0, dueOn: today, fast: false, firstSeenOn: today, lastSeenOn: today,
                                             lastCorrectOn: nil, correctDays: 0, formsRight: [], lastForm: nil, seen: 0,
                                             rightCount: 0, wrongCount: 0, dontknowCount: 0, masteredAt: nil, removedAt: nil)
        var next = base
        next.seen += 1
        next.lastSeenOn = today
        next.lastForm = form

        guard result == "correct" else {
            if result == "wrong" { next.wrongCount += 1 } else { next.dontknowCount += 1 }
            next.stage = 0
            next.fast = false
            next.correctDays = 0
            next.formsRight = []
            next.lastCorrectOn = nil
            next.masteredAt = nil
            next.dueOn = VocabDay.add(today, 1)
            return next
        }

        next.rightCount += 1
        if !next.formsRight.contains(form) { next.formsRight.append(form) }

        // Right the first time it's ever asked: they knew it already, so it's
        // done with and never asked again.
        guard progress != nil else {
            next.fast = true
            next.stage = 3
            next.correctDays = 1
            next.lastCorrectOn = today
            next.masteredAt = now
            next.dueOn = VocabDay.add(today, rules.retiredGap)
            return next
        }

        // A second right answer on the same day (the catch-up after a miss, or
        // an early look) is practice: it doesn't move the word on.
        if base.lastCorrectOn == today || base.lastSeenOn == today {
            if base.lastCorrectOn != today, base.stage == 0 { next.dueOn = VocabDay.add(today, 1) }
            return next
        }

        next.correctDays = base.correctDays + 1
        next.lastCorrectOn = today
        let gaps = rules.gapByStage
        if base.stage >= 3 {
            let lastGap = max(gaps[min(3, gaps.count - 1)], VocabDay.between(base.lastCorrectOn ?? base.lastSeenOn, today))
            let grown = Int((Double(lastGap) * 1.5).rounded(.toNearestOrAwayFromZero))
            next.dueOn = VocabDay.add(today, min(rules.masteredGapMax, grown))
            return next
        }
        next.stage = base.stage + 1
        next.dueOn = VocabDay.add(today, gaps[min(next.stage, gaps.count - 1)])
        if next.stage >= 3 { next.masteredAt = now }
        return next
    }

    /// Which way to ask: never the way it was asked last, and ways not yet answered right come first.
    static func pickForm(_ item: VocabItem, _ progress: VocabProgress?) -> String {
        let forms = item.forms.map(\.key)
        guard let progress, !forms.isEmpty else { return forms.first ?? "" }
        let start = progress.lastForm.map { (forms.firstIndex(of: $0) ?? -1) + 1 } ?? 0
        let rotated = forms.indices.map { forms[(start + $0) % forms.count] }
        let others = rotated.filter { $0 != progress.lastForm }
        let pool = others.isEmpty ? rotated : others
        return pool.first { !progress.formsRight.contains($0) } ?? pool[0]
    }

    struct Pick: Equatable {
        let item: String
        /// "requeue", "due", "new", "early" or "extra".
        let why: String
    }

    /// The next thing to ask (pickNext). `position` is the question being chosen: 1 for the first.
    static func pickNext(words: [VocabItem], parts: [VocabItem], progress: Progress, today: String, position: Int, total: Int,
                         asked askedList: [String], requeue: [VocabLocalSession.Requeue], rules: VocabRuleSet) -> Pick? {
        let asked = Set(askedList)
        let remaining = total - position + 1
        let fresh = { (it: VocabItem) in !asked.contains(it.id) }

        // 1. A miss from earlier in this session, once a few other questions
        //    have gone by (or sooner if the session is about to run out).
        let waiting = ordered(requeue) { $0.at < $1.at }
        if let ripe = waiting.first(where: { position - $0.at > rules.requeueGap }) { return Pick(item: ripe.item, why: "requeue") }
        if !waiting.isEmpty, waiting.count >= remaining { return Pick(item: waiting[0].item, why: "requeue") }

        let isDue = { (it: VocabItem) in progress[it.id].map { $0.dueOn <= today } ?? false }
        // Both are under way when this is asked. The least settled first, then the longest due.
        let byUrgency = { (a: VocabItem, b: VocabItem) -> Bool in
            guard let pa = progress[a.id], let pb = progress[b.id] else { return false }
            if pa.stage != pb.stage { return pa.stage < pb.stage }
            if pa.dueOn != pb.dueOn { return pa.dueOn < pb.dueOn }
            return a.rank < b.rank
        }
        // Known at first sight and never missed: out of every pile, however short the session runs.
        let retired = { (it: VocabItem) in progress[it.id].map { $0.fast && $0.stage >= 3 } ?? false }
        let dueWords = ordered(words.filter { fresh($0) && isDue($0) }, by: byUrgency)
        let dueParts = ordered(parts.filter { fresh($0) && isDue($0) }, by: byUrgency)
        let due = ordered(dueWords + dueParts, by: byUrgency)

        let newPartsToday = parts.filter { progress[$0.id]?.firstSeenOn == today }.count
        let nextNewPart = newPartsToday < rules.dailyNewParts ? parts.first { progress[$0.id] == nil } : nil

        // Met for the first time in this session, and not known.
        let newUnknownHere = words.filter { it in
            guard asked.contains(it.id), let p = progress[it.id] else { return false }
            return p.firstSeenOn == today && !p.fast
        }.count
        let nextNewWord = newWordsAllowed(today, rules) ? words.first { progress[$0.id] == nil } : nil
        let withinBudget = newUnknownHere < rules.sessionNewUnknown

        // 2. Every few questions, a word part: one that's due, or a new one.
        if position % rules.partEvery == 2 {
            if let part = dueParts.first { return Pick(item: part.id, why: "due") }
            if let part = nextNewPart { return Pick(item: part.id, why: "new") }
        }

        // 3. Reviews and new words, turn about, unless what's due would fill
        //    the rest of the session: then reviews only.
        let newTurn = position % 2 == 1
        if let first = due.first, due.count >= remaining || !newTurn || nextNewWord == nil || !withinBudget {
            return Pick(item: first.id, why: "due")
        }
        if let word = nextNewWord, withinBudget { return Pick(item: word.id, why: "new") }
        if let first = due.first { return Pick(item: first.id, why: "due") }

        // 4. Nothing due and this session's new words are used up: look ahead
        //    at what's due soonest, the least settled first.
        let all = words + parts
        let early = ordered(all.filter { fresh($0) && progress[$0.id] != nil && !retired($0) && progress[$0.id]?.lastSeenOn != today }) { a, b in
            guard let pa = progress[a.id], let pb = progress[b.id] else { return false }
            if pa.dueOn != pb.dueOn { return pa.dueOn < pb.dueOn }
            if pa.stage != pb.stage { return pa.stage < pb.stage }
            return a.rank < b.rank
        }
        if let first = early.first { return Pick(item: first.id, why: "early") }

        // 5. Still nothing (the first days, before there's anything to
        //    review): more new words, then anything not yet asked this session.
        if let word = nextNewWord { return Pick(item: word.id, why: "new") }
        if let part = nextNewPart { return Pick(item: part.id, why: "new") }
        if let first = waiting.first { return Pick(item: first.item, why: "requeue") }
        let anything = ordered(all.filter { fresh($0) && progress[$0.id] != nil && !retired($0) }, by: byUrgency)
        if let first = anything.first { return Pick(item: first.id, why: "extra") }
        let again = all.first { progress[$0.id] != nil && !retired($0) } ?? all.first { progress[$0.id] != nil }
        return again.map { Pick(item: $0.id, why: "extra") }
    }

    /// Sorted, with what ties left in the order it came in. (The website's
    /// sort keeps that order; Swift's own doesn't promise to.)
    private static func ordered<T>(_ list: [T], by before: (T, T) -> Bool) -> [T] {
        list.enumerated().sorted { a, b in
            if before(a.element, b.element) { return true }
            if before(b.element, a.element) { return false }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// Whether a day's practice was done: `ms` answering in all, `finished` sessions seen to the end.
    static func dayDone(_ day: String, ms: Int, finished: Int, rules: VocabRuleSet) -> Bool {
        day < rules.dayGoalFrom ? finished > 0 : ms >= rules.dayGoalMs
    }

    /// Days done in a row, counting back from today (or from yesterday if today's isn't done yet).
    static func streak(_ done: Set<String>, today: String) -> Int {
        var cursor = done.contains(today) ? today : VocabDay.add(today, -1)
        var n = 0
        while done.contains(cursor) {
            n += 1
            cursor = VocabDay.add(cursor, -1)
        }
        return n
    }

    // MARK: A session (src/lib/words/session.ts)

    /// A session about to be started on `day`.
    static func newSession(day: String, total: Int, limitMs: Int, now: Date, rules: VocabRuleSet) -> VocabLocalSession {
        VocabLocalSession(id: UUID().uuidString.lowercased(), day: day, total: total, limitMs: limitMs,
                          noDontKnow: isTestDaySession(day, rules), startedAt: VocabDay.stamp(now))
    }

    /// The question for the session's next place (choose). Nil when there's nothing left to ask.
    /// `holdNew` keeps back the words not yet met (a boss is waiting,
    /// VocabPath.swift): the session is reviews only, and ends when there's
    /// nothing left to review but what it's already asked.
    static func choose(_ session: VocabLocalSession, content: VocabContent, progress: Progress, rules: VocabRuleSet,
                       shuffle: Bool = true, holdNew: Bool = false) -> VocabLocalSession.Current? {
        // Anything they've removed is out of the running altogether.
        let kept = { (list: [VocabItem]) in list.filter { progress[$0.id]?.removedAt == nil } }
        let words = holdNew ? kept(content.words).filter { progress[$0.id] != nil } : kept(content.words)
        guard let pick = pickNext(words: words, parts: kept(content.parts), progress: progress, today: session.day,
                                  position: session.answered + 1, total: session.total, asked: session.asked,
                                  requeue: session.requeue, rules: rules),
              let item = content.item(pick.item) else { return nil }
        if holdNew, pick.why == "extra", session.asked.contains(pick.item) { return nil }
        return ask(item, requeued: pick.why == "requeue", day: session.day, progress: progress, rules: rules, shuffle: shuffle)
    }

    /// A question on an item, asked the way it's due to be asked next.
    private static func ask(_ item: VocabItem, requeued: Bool, day: String, progress: Progress, rules: VocabRuleSet,
                            shuffle: Bool) -> VocabLocalSession.Current? {
        let before = progress[item.id]
        let key = pickForm(item, before)
        guard let form = item.forms.first(where: { $0.key == key }) else { return nil }
        var choices = [VocabLocalSession.Choice(text: form.answer, why: nil, right: true)]
            + pickWrong(form, progress: progress, shuffle: shuffle)
        if shuffle { choices.shuffle() }
        let ifRight = applyAnswer(before, item: item.id, form: key, result: "correct", today: day, now: "", rules: rules)
        return VocabLocalSession.Current(item: item.id, form: key, choices: choices, correct: choices.firstIndex(where: \.right) ?? 0,
                                         isNew: before == nil, requeued: requeued,
                                         masteredIfRight: nowMastered(before, ifRight))
    }

    /// A question has this many wrong answers.
    static let wrongChoices = 3

    /// The wrong answers to ask a question with (pickWrong in src/lib/words/schedule.ts): a
    /// sentence completion's decoys, the ones they've met first so every choice is a word
    /// they know and only the sentence tells them apart, then the ones not yet met, then
    /// its traps to make up three. Without `shuffle` they're taken in order.
    static func pickWrong(_ form: VocabItem.Form, progress: Progress, shuffle: Bool) -> [VocabLocalSession.Choice] {
        let decoys = form.decoys ?? []
        var met = decoys.filter { progress[$0.item] != nil }
        var rest = decoys.filter { progress[$0.item] == nil }
        if shuffle {
            met.shuffle()
            rest.shuffle()
        }
        var picked = (met + rest).prefix(wrongChoices).map { VocabLocalSession.Choice(text: $0.text, why: $0.why, right: false) }
        for trap in form.traps where picked.count < wrongChoices {
            if !picked.contains(where: { $0.text.lowercased() == trap.text.lowercased() }) {
                picked.append(VocabLocalSession.Choice(text: trap.text, why: trap.why, right: false))
            }
        }
        return picked
    }

    /// The answer takes the item to mastered. A word known at first sight is
    /// done with, but it wasn't learned here: nothing to cheer.
    private static func nowMastered(_ before: VocabProgress?, _ after: VocabProgress) -> Bool {
        guard let before else { return false }
        return after.stage >= 3 && before.stage < 3
    }

    /// The session's question as the screen takes it, with its answer for grading on the spot.
    static func question(_ session: VocabLocalSession, content: VocabContent) -> VocabQuestion? {
        guard let current = session.current, let item = content.item(current.item),
              let form = item.forms.first(where: { $0.key == current.form }) else { return nil }
        let parts = item.parts.compactMap { content.item($0) }.filter { !$0.isWord }
            .map { VocabFeedback.Part(part: $0.title, meaning: $0.meaning) }
        let key = VocabQuestion.Key(correctIndex: current.correct, whys: current.choices.map { $0.right ? nil : $0.why },
                                    masteredIfRight: current.masteredIfRight, tip: form.tip, title: item.title, pos: item.pos,
                                    meaning: item.meaning, example: item.example, hook: item.hook, parts: parts)
        return VocabQuestion(position: session.answered + 1, total: session.total, kind: VocabQuestion.Kind(rawValue: form.kind) ?? .syn,
                             stem: form.stem, choices: current.choices.map(\.text), isNew: current.isNew,
                             allowDontKnow: !session.noDontKnow, key: key)
    }

    /// An answer, as it's kept until the website has it.
    struct Answered: Codable, Hashable {
        let session: String
        /// The session's day, which is the day the answer counts on.
        let day: String
        let position: Int
        let item: String
        let form: String
        /// What they picked, in words; nil for "Don't know".
        let chosen: String?
        /// "correct", "wrong" or "dontknow".
        let result: String
        let ms: Int
        let at: String
    }

    /// Takes the answer to the question on the session (`choice` nil: "Don't
    /// know"): their progress and the session's score move on, and the
    /// question is cleared for the next to be chosen. Nil when there's no
    /// question to answer. (answerQuestion.)
    static func record(_ session: inout VocabLocalSession, progress: inout Progress, choice: Int?, ms: Int, now: Date,
                       rules: VocabRuleSet) -> Answered? {
        guard !session.isFinished, let current = session.current else { return nil }
        if let choice, !current.choices.indices.contains(choice) { return nil }
        let result = choice == nil ? "dontknow" : choice == current.correct ? "correct" : "wrong"
        let spent = max(0, min(ms, rules.questionMaxMs))
        let at = VocabDay.stamp(now)
        let before = progress[current.item]
        let after = applyAnswer(before, item: current.item, form: current.form, result: result, today: session.day, now: at, rules: rules)
        progress[current.item] = after

        let position = session.answered + 1
        // A miss comes round once more this session; a miss on that second go waits for tomorrow.
        session.requeue.removeAll { $0.item == current.item }
        if result != "correct" {
            // (Not in a boss round, which asks each word once.)
            if !current.requeued, session.boss == nil { session.requeue.append(.init(item: current.item, at: position)) }
            if !session.missed.contains(current.item) { session.missed.append(current.item) }
        }
        session.answered = position
        session.correct += result == "correct" ? 1 : 0
        session.wrong += result == "wrong" ? 1 : 0
        session.dontknow += result == "dontknow" ? 1 : 0
        session.elapsedMs += spent
        session.newItems += before == nil ? 1 : 0
        session.masteredGained += nowMastered(before, after) ? 1 : 0
        session.asked.append(current.item)
        session.current = nil
        return Answered(session: session.id, day: session.day, position: position, item: current.item, form: current.form,
                        chosen: choice.map { current.choices[$0].text }, result: result, ms: spent, at: at)
    }

    /// The end screen. `dayMs` is the time spent answering on the session's day, this session included.
    static func summary(_ session: VocabLocalSession, content: VocabContent, dayMs: Int, rules: VocabRuleSet) -> VocabSummary {
        VocabSummary(total: session.total, correct: session.correct, wrong: session.wrong, dontknow: session.dontknow,
                     elapsedMs: session.elapsedMs, limitMs: session.limitMs, newItems: session.newItems,
                     masteredGained: session.masteredGained,
                     missed: session.missed.compactMap { content.item($0) }.map { .init(title: $0.title, meaning: $0.meaning) },
                     dayMs: dayMs, goalMs: rules.dayGoalMs)
    }

    // MARK: Where they stand (src/lib/words/overview.ts)

    /// The first screen's numbers. `sessions` are the newest first.
    static func overview(level: VocabLevel, questions: Int, today: String, content: VocabContent, progress: Progress,
                         sessions: [VocabLocalSession], sortedThrough: Int, sortDone: Bool, rules: VocabRuleSet) -> VocabOverview {
        typealias Done = VocabOverview.Done
        let finished = sessions.filter(\.isFinished)
        // Each day's answering time and finished sessions, which is what makes it done.
        var byDay: [String: (ms: Int, finished: Int)] = [:]
        for s in sessions {
            var d = byDay[s.day] ?? (0, 0)
            d.ms += s.elapsedMs
            d.finished += s.isFinished ? 1 : 0
            byDay[s.day] = d
        }
        let doneDays = Set(byDay.filter { dayDone($0.key, ms: $0.value.ms, finished: $0.value.finished, rules: rules) }.keys)
        let done = { (s: VocabLocalSession) in Done(elapsedMs: s.elapsedMs, limitMs: s.limitMs, correct: s.correct, total: s.total) }
        // Newest first as given: turned round, the day in the order it went.
        let doneToday = finished.filter { $0.day == today }.reversed().map(done)
        let open = sessions.first { $0.day == today && !$0.isFinished && $0.boss == nil }

        var counts: [String: Int] = Dictionary(uniqueKeysWithValues: VocabStatus.allCases.map { ($0.rawValue, 0) })
        for w in content.words { counts[(progress[w.id]?.status ?? .new).rawValue, default: 0] += 1 }
        let scored = (content.words + content.parts).compactMap { it -> VocabOverview.Trouble? in
            guard let score = progress[it.id]?.trouble, score > 0 else { return nil }
            return .init(id: it.id, title: it.title, meaning: it.meaning, misses: score)
        }
        let trouble = Array(ordered(scored) { $0.misses > $1.misses }.prefix(12))

        let recentDays = (0..<14).map { i -> VocabOverview.Day in
            let day = VocabDay.add(today, i - 13)
            return .init(day: day, done: doneDays.contains(day))
        }
        let week = sessions.filter { $0.day >= recentDays[7].day }
        let answered = week.reduce(0) { $0 + $1.answered }
        let removed = counts[VocabStatus.removed.rawValue] ?? 0

        return VocabOverview(
            level: level, questions: questions, today: today,
            doneToday: finished.first { $0.day == today }.map(done),
            inProgress: open.flatMap { $0.answered > 0 ? .init(answered: $0.answered, total: $0.total) : nil },
            sessionsToday: doneToday.count, sessionsDone: doneToday,
            streak: streak(doneDays, today: today), recentDays: recentDays, counts: counts,
            // What they're working through: the words they've removed don't count against them.
            totalWords: content.words.count - removed,
            parts: .init(met: content.parts.filter { progress[$0.id].map { $0.removedAt == nil } ?? false }.count,
                         mastered: content.parts.filter { progress[$0.id]?.status == .mastered }.count,
                         total: content.parts.count),
            trouble: trouble,
            accuracy: answered > 0 ? Double(week.reduce(0) { $0 + $1.correct }) / Double(answered) : nil,
            // Done once they've sat down to it at all, however far they got.
            sort: .init(done: sortDone || sortedThrough > 0,
                        left: content.words.filter { $0.rank > sortedThrough && progress[$0.id] == nil }.count),
            day: .init(ms: byDay[today]?.ms ?? 0, goalMs: rules.dayGoalMs, done: doneDays.contains(today)))
    }
}

// MARK: - The path (only here: the website doesn't lay the words out this way)

/// The words in the order they're met, cut into stages of 25. A stage is
/// cleared once every word in it has been met (or skipped as known), and gold
/// once they're all mastered, which it then stays. A cleared stage has a boss round: a short timed
/// session on the words of it that took some learning, with no "Don't know".
/// One miss is allowed in a round of five or more; one too many ends it.
/// A boss waiting to be beaten is a gate: no new words until it's beaten, or
/// has got away three times, after which they can go on without the crown.
extension VocabEngine {
    static let stageSize = 25
    /// The most questions in a boss round, and how few it's topped up to from earlier stages.
    static let bossMost = 10
    static let bossFewest = 10
    /// A boss round's clock: quicker than a session's, which is the point of it.
    static let bossMsPerQuestion = 15_000

    /// Right answers that beat a boss round of `total` questions: all but
    /// one, or all of them when there are fewer than five.
    static func bossNeeded(_ total: Int) -> Int { total >= 5 ? total - 1 : total }
    /// Lost this many times, a boss stops being a gate.
    static let bossTries = 3

    /// A boss round that can't be won any more: a miss more than it allows.
    static func bossLost(_ session: VocabLocalSession) -> Bool {
        session.boss != nil && session.answered - session.correct > session.total - bossNeeded(session.total)
    }

    /// Times a stage's boss has got away: rounds played and not won.
    static func bossFails(stage: Int, sessions: [VocabLocalSession]) -> Int {
        sessions.filter { $0.boss == stage && $0.isFinished && $0.answered > 0 && !bossBeaten($0) }.count
    }

    /// A boss round seen to the end with enough of it right.
    static func bossBeaten(_ session: VocabLocalSession) -> Bool {
        session.boss != nil && session.isFinished && session.answered >= session.total
            && session.correct >= bossNeeded(session.total)
    }

    /// Met, kept, and not known at first sight: a word they've had to learn here.
    /// (One known at first sight is never asked again, boss round or no.)
    private static func learned(_ progress: VocabProgress?) -> Bool {
        guard let progress else { return false }
        return progress.removedAt == nil && !(progress.fast && progress.stage >= 3)
    }

    private static func stages(_ words: [VocabItem], size: Int) -> [[VocabItem]] {
        let size = max(1, size)
        return stride(from: 0, to: words.count, by: size).map { Array(words[$0..<min($0 + size, words.count)]) }
    }

    /// The words a stage's boss round asks, the least settled first: the
    /// stage's own, and when those are few, some from the stages before it.
    /// Empty when the stage has no words that took learning: then it has no boss.
    static func bossLineup(stage number: Int, content: VocabContent, progress: Progress, size: Int = stageSize) -> [String] {
        let all = stages(content.words, size: size)
        guard all.indices.contains(number - 1) else { return [] }
        let leastSettled = { (a: VocabItem, b: VocabItem) -> Bool in
            let (sa, sb) = (progress[a.id]?.stage ?? 0, progress[b.id]?.stage ?? 0)
            return sa != sb ? sa < sb : a.rank < b.rank
        }
        let own = ordered(all[number - 1].filter { learned(progress[$0.id]) }, by: leastSettled)
        guard !own.isEmpty else { return [] }
        var lineup = Array(own.prefix(bossMost))
        if lineup.count < bossFewest {
            let earlier = ordered(all[..<(number - 1)].joined().filter { learned(progress[$0.id]) }, by: leastSettled)
            lineup += earlier.prefix(bossFewest - lineup.count)
        }
        return lineup.map(\.id)
    }

    /// The next question of a boss round: its words in order, each asked once.
    static func chooseBoss(_ session: VocabLocalSession, content: VocabContent, progress: Progress, rules: VocabRuleSet,
                           shuffle: Bool = true) -> VocabLocalSession.Current? {
        let asked = Set(session.asked)
        guard let id = session.lineup?.first(where: { !asked.contains($0) }), let item = content.item(id) else { return nil }
        return ask(item, requeued: false, day: session.day, progress: progress, rules: rules, shuffle: shuffle)
    }

    /// Where they are on the way through the words.
    /// `gold` are the stages that have been gold before: once earned it's
    /// kept, whatever a later miss does to one of the words.
    static func path(content: VocabContent, progress: Progress, sessions: [VocabLocalSession], size: Int = stageSize,
                     gold: Set<Int> = []) -> VocabPath {
        let beaten = Set(sessions.filter(bossBeaten).compactMap(\.boss))
        return VocabPath(stages: stages(content.words, size: size).enumerated().map { index, words in
            let statuses = words.map { progress[$0.id]?.status ?? .new }
            let cleared = !statuses.contains(.new)
            let fails = bossFails(stage: index + 1, sessions: sessions)
            let boss: VocabStage.Boss = beaten.contains(index + 1) ? .beaten
                : !cleared ? .locked
                : !words.contains { learned(progress[$0.id]) } ? .none
                : fails >= bossTries ? .skipped : .ready
            return VocabStage(number: index + 1,
                              words: zip(words, statuses).map { .init(id: $0.id, title: $0.title, status: $1) },
                              boss: boss,
                              bossFails: fails,
                              gold: gold.contains(index + 1) || statuses.allSatisfy { $0 == .mastered || $0 == .removed })
        })
    }
}
