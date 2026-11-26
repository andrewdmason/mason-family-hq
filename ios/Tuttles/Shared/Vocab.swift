import Foundation
import MasonKit
import Observation
import SwiftUI

// Vocab: the website's ISEE Verbal Reasoning practice (src/lib/words, /words),
// played natively. A day is ten minutes of answering, over as many sessions
// as that takes: 25 questions each, reviews and new words mixed, against a
// ten-minute clock they finish far inside.
//
// A session is played on the phone, with or without a connection: the words,
// the schedule's numbers and the kid's progress are kept here
// (VocabOffline.swift), the questions are chosen here by the website's rules
// (VocabEngine.swift), and the answers go up to the website when it can be
// reached, where they're gone through again and what it makes of them is
// what counts.
//
// Before the phone has ever reached the website for someone (and in the demo,
// and against a website from before this), a session is the website's instead,
// a question at a time through /tuttles/api/vocab: each question comes with
// its key, so the phone grades it itself and sends the answer along behind,
// and the website says ahead of time what follows a right answer.
//
// It follows the account picker like everything else: a kid (or the phone
// used as one) gets their own level and session, and the parents' view shows
// both kids side by side.

// MARK: - What the website sends

enum VocabLevel: String, Codable, Hashable {
    case lower, middle

    var name: String { self == .lower ? "Lower Level" : "Middle Level" }
}

/// Where someone is with a word (statusOf in src/lib/words/types.ts).
enum VocabStatus: String, Codable, Hashable, CaseIterable {
    case new, learning, almost, mastered, removed

    var label: String {
        switch self {
        case .new: "New"
        case .learning: "Learning"
        case .almost: "Almost"
        case .mastered: "Mastered"
        case .removed: "Skipped"
        }
    }

    var tint: Color {
        switch self {
        case .mastered: VocabLook.right
        case .almost: Color(red: 0.25, green: 0.62, blue: 0.93)
        case .learning: Color(red: 0.96, green: 0.68, blue: 0.16)
        case .new, .removed: Color.primary.opacity(0.14)
        }
    }
}

/// The website's Overview (loadOverview in src/lib/words/session.ts).
struct VocabOverview: Decodable, Hashable {
    struct Done: Decodable, Hashable {
        let elapsedMs: Int
        let limitMs: Int
        let correct: Int
        let total: Int
    }
    struct InProgress: Decodable, Hashable {
        let answered: Int
        let total: Int
    }
    struct Day: Decodable, Hashable {
        let day: String
        let done: Bool
    }
    struct Parts: Decodable, Hashable {
        let met: Int
        let mastered: Int
        let total: Int
    }
    struct Trouble: Decodable, Hashable, Identifiable {
        let id: String
        let title: String
        let meaning: String
        let misses: Int
    }

    let level: VocabLevel
    let questions: Int
    let today: String
    let doneToday: Done?
    var inProgress: InProgress?
    let sessionsToday: Int
    /// Every session finished today, first to last. Nil from an older website.
    var sessionsDone: [Done]? = nil
    let streak: Int
    let recentDays: [Day]
    let counts: [String: Int]
    let totalWords: Int
    let parts: Parts
    let trouble: [Trouble]
    let accuracy: Double?
    /// Sorting out the words known already: whether they've been through it,
    /// and how many words are left to look at. Nil from an older website.
    struct Sort: Decodable, Hashable {
        let done: Bool
        let left: Int
    }
    var sort: Sort? = nil
    /// Today against the ten minutes: time spent answering over every session,
    /// and whether that's the day done. Nil from an older website.
    struct Goal: Decodable, Hashable {
        let ms: Int
        let goalMs: Int
        let done: Bool

        var fraction: Double { min(1, Double(ms) / Double(max(1, goalMs))) }
        var leftMs: Int { max(0, goalMs - ms) }
    }
    var day: Goal? = nil
    /// Coins won today and waiting for the ten minutes to be done (HousePay.swift).
    /// Only worked out on the phone.
    var waitingCoins: Int? = nil

    /// Today's practice is done. For an older website, that's a session finished.
    var isDoneToday: Bool { day?.done ?? (doneToday != nil) }

    func count(_ status: VocabStatus) -> Int { counts[status.rawValue] ?? 0 }

    /// Today's finished sessions with which each was: the first, the second…
    /// An older website tells only the latest, which is then all there is to show.
    var finishedToday: [(number: Int, done: Done)] {
        let all = sessionsDone ?? doneToday.map { [$0] } ?? []
        let first = max(sessionsToday, all.count) - all.count + 1
        return all.enumerated().map { (first + $0.offset, $0.element) }
    }

    /// Which of today's sessions the next Start or Keep going is.
    var nextSession: Int { max(sessionsToday, sessionsDone?.count ?? 0) + 1 }
}

/// Vocab's first screen: a kid's own page, or both kids for a parent.
struct VocabHome: Decodable {
    struct Kid: Decodable, Identifiable, Hashable {
        let id: UUID
        let name: String
        let overview: VocabOverview
    }

    /// "kid" or "parent".
    let view: String
    let name: String?
    /// Days until the ISEE.
    let daysLeft: Int
    /// A kid's own; nil when Vocab isn't set up for them.
    var overview: VocabOverview?
    let kids: [Kid]?
    /// The words as a path of stages (VocabPath.swift). Worked out on the
    /// phone from what it keeps: nil until it has the words, and for a parent.
    var path: VocabPath? = nil
}

/// The question on screen.
struct VocabQuestion: Decodable, Hashable {
    /// Its answer (QuestionKey in src/lib/words/types.ts), for grading it here
    /// without waiting on the network.
    struct Key: Decodable, Hashable {
        let correctIndex: Int
        /// For each choice, why it's wrong; nil for the right one.
        let whys: [String?]
        /// A right answer would make it mastered.
        let masteredIfRight: Bool
        let tip: String
        let title: String
        let pos: String?
        let meaning: String
        let example: String?
        let hook: String
        let parts: [VocabFeedback.Part]

        /// What the website will say to this answer (`choice` nil: "Don't know").
        func feedback(for choice: Int?) -> VocabFeedback {
            let right = choice == correctIndex
            let why = choice.flatMap { !right && whys.indices.contains($0) ? whys[$0] : nil }
            return VocabFeedback(result: choice == nil ? "dontknow" : right ? "correct" : "wrong", correctIndex: correctIndex,
                                 chosenWhy: why, tip: tip, title: title, pos: pos, meaning: meaning, example: example,
                                 hook: hook, parts: parts, mastered: right && masteredIfRight)
        }
    }

    enum Kind: String, Decodable {
        case syn, sc, part

        var ask: String {
            switch self {
            case .syn: "Which word means nearly the same?"
            case .sc: "Which word best completes the sentence?"
            case .part: "Word part"
            }
        }
    }

    let position: Int
    let total: Int
    let kind: Kind
    let stem: String
    let choices: [String]
    /// A word or part they've never been asked before.
    let isNew: Bool
    let allowDontKnow: Bool
    /// Nil from a website that doesn't send it yet: then the answer waits for the website's word.
    var key: Key? = nil
    /// The stage a review word comes from, when it isn't the one they're on. Only for a session played on the phone.
    var from: String? = nil
}

/// What comes back after an answer: how it went, and the word laid out for learning.
struct VocabFeedback: Decodable, Hashable {
    struct Part: Decodable, Hashable {
        let part: String
        let meaning: String
    }

    /// "correct", "wrong" or "dontknow".
    let result: String
    let correctIndex: Int
    /// Why the choice they picked is wrong, when it was.
    let chosenWhy: String?
    let tip: String
    let title: String
    let pos: String?
    let meaning: String
    let example: String?
    let hook: String
    let parts: [Part]
    /// It just became mastered.
    let mastered: Bool

    var isCorrect: Bool { result == "correct" }
    /// A word part isn't something to say out loud.
    var isWord: Bool { !["prefix", "root", "suffix"].contains(pos ?? "") }
}

struct VocabSummary: Decodable, Hashable {
    struct Missed: Decodable, Hashable {
        let title: String
        let meaning: String
    }

    let total: Int
    let correct: Int
    let wrong: Int
    let dontknow: Int
    let elapsedMs: Int
    let limitMs: Int
    let newItems: Int
    let masteredGained: Int
    /// What was missed, to look over at the end.
    let missed: [Missed]
    /// Time spent answering today, this session included, and the day's ten
    /// minutes. Nil from an older website.
    var dayMs: Int? = nil
    var goalMs: Int? = nil
    /// How far the session took them along the path. Only for one played on the phone.
    var climb: VocabClimb? = nil
    /// How a boss round came out; nil for an ordinary session.
    var boss: VocabBoss? = nil
    /// The stage whose boss is in the way now an ordinary session is over.
    var bossWaiting: Int? = nil
    /// The chest an ordinary session earned (VocabChest.swift). Only for a session played on the phone.
    var prize: VocabPrize? = nil
    /// The coins and gems the session paid into the house's purse. Only for one played on the phone.
    var pay: VocabEarning? = nil

    /// Where the day stands now this session is over.
    var day: VocabOverview.Goal? {
        guard let dayMs, let goalMs else { return nil }
        return .init(ms: dayMs, goalMs: goalMs, done: dayMs >= goalMs)
    }
}

struct VocabState: Decodable, Hashable {
    let sessionId: String
    /// Time spent answering so far (not reading a tip after a miss).
    let elapsedMs: Int
    let limitMs: Int
    let noDontKnow: Bool
    let question: VocabQuestion?
    let summary: VocabSummary?
    /// The question that follows a right answer to this one, so moving on doesn't wait for the website.
    var nextIfRight: VocabQuestion? = nil
    /// A boss round, and how it stands; nil for an ordinary session.
    var boss: VocabBoss? = nil
    /// The stage of the path they're on, as it stands. Only for a session played on the phone.
    var stage: VocabStage? = nil
    /// What the stage's boss has to say before the first question of an
    /// ordinary session (VocabBosses.swift). Only for a session played on the phone.
    var heckle: VocabHeckle? = nil
}

struct VocabAnswer: Decodable {
    let feedback: VocabFeedback
    let state: VocabState
}

/// A word or word part in the list (ListRow in src/lib/words/session.ts).
struct VocabRow: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let pos: String
    let meaning: String
    let example: String?
    let hook: String
    let parts: [VocabFeedback.Part]
    var status: VocabStatus
    let dueOn: String?
    let seen: Int
    let right: Int
    let misses: Int
    let trouble: Bool
    let rank: Int

    var isWord: Bool { id.hasPrefix("w:") }
}

struct VocabList: Decodable {
    var words: [VocabRow]
    var parts: [VocabRow]
    let canEdit: Bool
}

// MARK: - The rules that are the website's

enum VocabRules {
    /// "9:41", from milliseconds either side of zero (clock in progress-bits.tsx).
    static func clock(_ ms: Int) -> String {
        let s = abs(ms) / 1000
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    /// "2:10 to spare" or "0:45 over" (paceLine).
    static func pace(elapsedMs: Int, limitMs: Int) -> String {
        let spare = limitMs - elapsedMs
        return spare >= 0 ? "\(clock(spare)) to spare" : "\(clock(spare)) over"
    }

    /// The line under the title (countdown in words/page.tsx).
    static func countdown(daysLeft: Int) -> String {
        if daysLeft > 1 { return "\(daysLeft) days until the ISEE" }
        if daysLeft == 1 { return "The ISEE is tomorrow" }
        if daysLeft == 0 { return "The ISEE is today" }
        return "ISEE vocabulary practice"
    }

    enum Filter: Hashable, CaseIterable {
        case all, trouble, learning, almost, mastered, new, removed

        var label: String {
            switch self {
            case .all: "All"
            case .trouble: "Trouble"
            case .learning: "Learning"
            case .almost: "Almost"
            case .mastered: "Mastered"
            case .new: "New"
            case .removed: "Skipped"
            }
        }

        var status: VocabStatus? {
            switch self {
            case .all, .trouble: nil
            case .learning: .learning
            case .almost: .almost
            case .mastered: .mastered
            case .new: .new
            case .removed: .removed
            }
        }

        func holds(_ row: VocabRow) -> Bool {
            switch self {
            case .all: row.status != .removed
            case .trouble: row.trouble
            default: row.status == status
            }
        }
    }

    /// The list as the website orders it (word-list.tsx): trouble first when
    /// looking at everything, the most missed on top; then the order words are met in.
    static func rows(_ rows: [VocabRow], filter: Filter, query: String) -> [VocabRow] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let list = rows.filter { row in
            filter.holds(row) && (q.isEmpty || row.title.lowercased().contains(q) || row.meaning.lowercased().contains(q))
        }
        guard filter == .all || filter == .trouble else { return list.sorted { $0.rank < $1.rank } }
        return list.sorted { a, b in
            if a.trouble != b.trouble { return a.trouble }
            if a.trouble, a.misses != b.misses { return a.misses > b.misses }
            return a.rank < b.rank
        }
    }
}

// MARK: - Talking to the website

extension ChatStore {
    func refreshVocab() async {
        let asked = viewer
        if isDemo {
            if let local = vocabOpenLocal() {
                vocab = local.home()
                vocabWaiting = local.waiting > 0
            } else {
                vocab = DemoVocab.home(parent: showingParentView, kid: actingKid?.name)
            }
            return
        }
        // A kid's own page is worked out on the phone, from what it keeps.
        if !showingParentView, await refreshVocabLocal() { return }
        guard let (data, status) = try? await vocabCall("GET", "tuttles/api/vocab"), status == 200,
              let home = try? Self.decoder.decode(VocabHome.self, from: data),
              // Unless the view changed meanwhile: then this isn't its page.
              viewer == asked else { return }
        vocab = home
    }

    /// Today's session: the one under way, or a new one.
    func vocabBegin() async throws -> VocabState {
        // Played on the phone once it has the words: nothing to wait for.
        if let local = vocabOpenLocal() { return local.begin() }
        if isDemo { return DemoVocab.begin() }
        guard let state: VocabState = try await vocabPost("tuttles/api/vocab/session", [:]) else {
            throw SendError.server("Tuttles couldn't be reached.")
        }
        return state
    }

    /// A stage's boss round. Nil when there isn't one to play (nothing kept on this phone, or no words for it).
    func vocabBeginBoss(stage: Int) -> VocabState? {
        vocabOpenLocal()?.beginBoss(stage: stage)
    }

    /// Answers the question on screen (`choice` nil: "Don't know"). Nil when
    /// the session has moved on without this phone: begin again to catch up.
    func vocabAnswer(_ state: VocabState, position: Int, choice: Int?, ms: Int) async throws -> VocabAnswer? {
        if isDemo {
            try? await Task.sleep(for: DemoVocab.delay)
            return DemoVocab.answer(choice: choice, ms: ms)
        }
        return try await vocabPost("tuttles/api/vocab/answer", [
            "sessionId": state.sessionId, "position": position, "choice": choice.map { $0 as Any } ?? NSNull(), "ms": ms,
        ])
    }

    /// Answers the question of a session played on this phone, and says what's
    /// next: at once, connection or none. The answer is kept until the website has it.
    func vocabAnswerHere(_ state: VocabState, position: Int, choice: Int?, ms: Int) -> VocabState? {
        guard let local = vocabLocal else { return nil }
        // Out of step (it shouldn't be): pick the session up where the phone has it.
        let next = local.answer(session: state.sessionId, position: position, choice: choice, ms: ms) ?? local.begin()
        vocabWaiting = true
        // A session's end is a good moment to send it up, while they read how it went.
        if next.summary != nil { Task { await vocabSync() } }
        return next
    }

    /// Every word and word part: their own, or one of the kids' from the parents' view.
    func vocabList(kid: UUID?) async throws -> VocabList {
        if isDemo { return DemoVocab.list(canEdit: kid == nil) }
        let query = kid.map { [URLQueryItem(name: "kid", value: $0.uuidString.lowercased())] } ?? []
        let (data, status) = try await vocabCall("GET", "tuttles/api/vocab/list", query: query)
        guard status == 200 else { throw SendError.server(Self.vocabError(data)) }
        return try Self.decoder.decode(VocabList.self, from: data)
    }

    /// Brings back one of their own words that was removed.
    func vocabSetRemoved(_ item: String, _ removed: Bool) async throws {
        if isDemo { return }
        let (data, status) = try await vocabCall("POST", "tuttles/api/vocab/list", json: ["item": item, "removed": removed])
        guard status == 200 else { throw SendError.server(Self.vocabError(data)) }
    }

    /// A POST's reply, or nil when the website says the session has moved on (409).
    private func vocabPost<T: Decodable>(_ route: String, _ json: [String: Any]) async throws -> T? {
        let (data, status) = try await vocabCall("POST", route, json: json)
        if status == 409 { return nil }
        guard status == 200 else { throw SendError.server(Self.vocabError(data)) }
        return try Self.decoder.decode(T.self, from: data)
    }

    private static func vocabError(_ data: Data) -> String {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String ?? "Tuttles couldn't be reached."
    }

    private func vocabCall(_ method: String, _ route: String, query: [URLQueryItem] = [],
                           json: [String: Any]? = nil) async throws -> (Data, Int) {
        let token = try await client.auth.session.accessToken
        var url = Self.websiteURL.appending(path: route)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        authorize(&request, token: token)
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

// MARK: - A session being played

/// One timed session of the day's several: a question at a time against the ten-minute countdown
/// (the website's SessionRunner, src/components/words/session-runner.tsx).
/// The clock only runs while a question is waiting for an answer, so reading
/// the tip after a miss costs nothing. When it runs out they finish anyway,
/// and the end screen says how far over they went.
@MainActor
@Observable
final class VocabRun: Identifiable {
    enum Pick: Equatable {
        case choice(Int)
        case dontKnow
    }

    let id = UUID()
    private let store: ChatStore

    private(set) var state: VocabState
    private(set) var feedback: VocabFeedback?
    private(set) var picked: Pick?
    /// What's next, held back while the answer is looked at.
    private(set) var pending: VocabState?
    /// Choices they've ruled out on the question on screen. Theirs to keep
    /// track of: nothing is sent or saved.
    private(set) var crossed: Set<Int> = []
    /// "Too easy" or "Do another" is on its way.
    private(set) var busy = false
    private(set) var failed = false
    /// They're ready for the next question and it isn't here yet.
    private(set) var wantsNext = false

    /// An answer given here that the website hasn't had yet.
    private struct Unsent {
        let position: Int
        let choice: Int?
        let ms: Int
        /// It was graded here, so there's nothing to take back if it can't be sent.
        let graded: Bool
    }
    /// Oldest first. They can be a question ahead of the website, never more.
    private var outbox: [Unsent] = []
    private var sender: Task<Void, Never>?
    /// When the question on screen started waiting for its answer.
    private var waitingSince = Date()
    /// The time the question took, once it's answered.
    private var tookMs: Int?
    /// Counts the questions shown, so each one's views are its own.
    private(set) var shown = 0

    /// Right answers in a row, for the flame by the count.
    private(set) var combo = 0

    /// Which of today's sessions this is: 1 for the day's own, 2 for the one after…
    private(set) var number: Int
    /// Played on this phone (VocabOffline.swift): nothing waits on the website.
    private let here: Bool

    init(store: ChatStore, state: VocabState, number: Int = 1) {
        self.store = store
        self.state = state
        self.number = number
        here = store.vocabLocal?.playing == state.sessionId
    }

    var question: VocabQuestion? { state.question }
    var summary: VocabSummary? { state.summary }
    /// The boss round this is, as it stands with the answer just given.
    var boss: VocabBoss? { (pending ?? state).boss }
    /// The stage they're on, as it stands with the answer just given.
    var stage: VocabStage? { (pending ?? state).stage }
    var waiting: Bool { question != nil && picked == nil }

    /// Milliseconds left on the clock at `now`; under zero is over time.
    func leftMs(at now: Date = Date()) -> Int {
        if let pending { return state.limitMs - pending.elapsedMs }
        let running = tookMs ?? (waiting ? Int(now.timeIntervalSince(waitingSince) * 1000) : 0)
        return state.limitMs - state.elapsedMs - running
    }

    /// How far through the session, counting the question just answered.
    var progress: Double {
        guard let q = question else { return 1 }
        return Double(q.position - 1 + (feedback == nil ? 0 : 1)) / Double(max(1, q.total))
    }

    func toggleCross(_ index: Int) {
        guard waiting else { return }
        if crossed.contains(index) { crossed.remove(index) } else { crossed.insert(index) }
    }

    /// A tap on a choice. A crossed-off one comes back first; it takes a second tap to pick it.
    func tap(_ index: Int) {
        if crossed.contains(index) { toggleCross(index) } else { Task { await answer(.choice(index)) } }
    }

    func answer(_ pick: Pick) async {
        guard let question, picked == nil, !busy else { return }
        let ms = Int(Date().timeIntervalSince(waitingSince) * 1000)
        var choice: Int?
        if case .choice(let index) = pick { choice = index }
        picked = pick
        tookMs = ms
        combo = choice == question.key?.correctIndex && choice != nil ? combo + 1 : 0
        if here {
            // Graded, kept and the next question chosen, all on the phone.
            feedback = question.key?.feedback(for: choice)
            pending = store.vocabAnswerHere(state, position: question.position, choice: choice, ms: ms)
            failed = pending == nil
            return
        }
        // Graded here and now; the website hears about it behind what's on screen.
        feedback = question.key?.feedback(for: choice)
        lookAhead()
        outbox.append(Unsent(position: question.position, choice: choice, ms: ms, graded: feedback != nil))
        await send()
    }

    /// After a right answer the website has already said what's next: line it
    /// up, to be shown without waiting for its reply.
    private func lookAhead() {
        guard pending == nil, feedback?.isCorrect == true, let next = state.nextIfRight else { return }
        // The website counts at most a minute for a question.
        let spent = min(max(tookMs ?? 0, 0), 60_000)
        pending = VocabState(sessionId: state.sessionId, elapsedMs: state.elapsedMs + spent, limitMs: state.limitMs,
                             noDontKnow: state.noDontKnow, question: next, summary: nil)
    }

    /// Hands the website every answer it hasn't had, in order. One at a time:
    /// a second caller waits for the first, then sends what's left.
    private func send() async {
        while let sender { await sender.value }
        guard !outbox.isEmpty else { return }
        let task = Task {
            await self.drain()
            self.sender = nil
        }
        sender = task
        await task.value
    }

    private func drain() async {
        failed = false
        while let next = outbox.first {
            guard let now = await deliver(next) else {
                failed = true
                if !next.graded {
                    // The answer was the website's to give: hand the question back.
                    outbox.removeAll()
                    picked = nil
                    tookMs = nil
                }
                return
            }
            outbox.removeFirst()
            settle(now.state, feedback: now.feedback, after: next)
        }
    }

    /// The website's reply to an answer: where the session now stands. Nil when it couldn't be reached.
    private func deliver(_ unsent: Unsent) async -> (state: VocabState, feedback: VocabFeedback?)? {
        for attempt in 0..<(unsent.graded ? 4 : 1) {
            if attempt > 0 { try? await Task.sleep(for: .seconds(Double(attempt))) }
            do {
                if let result = try await store.vocabAnswer(state, position: unsent.position, choice: unsent.choice, ms: unsent.ms) {
                    return (result.state, result.feedback)
                }
                // The session moved on without this phone (or an earlier try
                // did get through): pick it up where it is.
                return (try await store.vocabBegin(), nil)
            } catch {}
        }
        return nil
    }

    /// Fits the website's word on what's next to what's on screen.
    private func settle(_ now: VocabState, feedback theirs: VocabFeedback?, after unsent: Unsent) {
        if question?.position == unsent.position, picked != nil {
            // Still looking at that answer: this is what comes next.
            if feedback == nil { feedback = theirs }
            guard feedback != nil else { return show(now) }
            pending = now
            if wantsNext { withAnimation(.snappy) { advance() } }
        } else if let theirs = now.question, let ours = question, theirs.position == ours.position,
                  theirs.stem == ours.stem, theirs.choices == ours.choices {
            // Already on the question it sends, shown ahead of its reply: keep
            // their place in it, and take what the website adds (what follows this one).
            state = now
            lookAhead()
            if wantsNext, pending != nil { withAnimation(.snappy) { advance() } }
        } else {
            // The website is somewhere else (another device took a turn): go with it.
            outbox.removeAll()
            show(now)
        }
    }

    /// On to the next question, or the end.
    func advance() {
        guard let pending else {
            // Not here yet: it's shown the moment it arrives. After a failure, this is the way to try again.
            guard feedback != nil else { return }
            wantsNext = true
            if failed { Task { await send() } }
            return
        }
        show(pending)
    }

    /// Another session straight after the last.
    func again() async {
        busy = true
        failed = false
        defer { busy = false }
        let finished = summary != nil
        do {
            show(try await store.vocabBegin())
            if finished { number += 1 }
        } catch { failed = true }
    }

    /// The question on screen starts waiting for its answer now: a boss
    /// round's clock holds until its boss has made their entrance.
    func startClock() {
        guard picked == nil else { return }
        waitingSince = Date()
    }

    /// Another go at the boss round that just got away.
    func retryBoss() {
        if let stage = summary?.boss?.stage { fightBoss(stage) }
    }

    /// Straight on into a stage's boss round.
    func fightBoss(_ stage: Int) {
        guard let next = store.vocabBeginBoss(stage: stage) else {
            failed = true
            return
        }
        combo = 0
        show(next)
    }

    private func show(_ next: VocabState) {
        state = next
        pending = nil
        feedback = nil
        picked = nil
        crossed = []
        wantsNext = false
        tookMs = nil
        waitingSince = Date()
        shown += 1
    }
}
