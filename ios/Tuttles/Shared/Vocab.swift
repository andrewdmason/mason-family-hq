import Foundation
import MasonKit
import Observation
import SwiftUI

// Vocab: the website's ISEE Verbal Reasoning practice (src/lib/words, /words),
// played natively. One timed session a day: 18 questions for Oscar (Lower
// Level), 22 for Sebastian (Middle), against a ten-minute clock. The words,
// the schedule and the grading are all the website's; the phone draws a
// question and relays the answer through /tuttles/api/vocab.
//
// An answer shows the moment it's tapped: each question comes with its key
// (which choice is right, and the word laid out for a miss), so the phone
// grades it itself and sends the answer along behind. The website still grades
// what arrives and keeps the score; it answers with the next question, which
// is usually in hand before they've finished looking at this one.
//
// It follows the account picker like everything else: a kid (or the phone
// used as one) gets their own level and session, and the parents' view shows
// both kids side by side.

// MARK: - What the website sends

enum VocabLevel: String, Decodable, Hashable {
    case lower, middle

    var name: String { self == .lower ? "Lower Level" : "Middle Level" }
}

/// Where someone is with a word (statusOf in src/lib/words/types.ts).
enum VocabStatus: String, Decodable, Hashable, CaseIterable {
    case new, learning, almost, mastered, removed

    var label: String {
        switch self {
        case .new: "New"
        case .learning: "Learning"
        case .almost: "Almost"
        case .mastered: "Mastered"
        case .removed: "Removed"
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
    let inProgress: InProgress?
    let sessionsToday: Int
    let streak: Int
    let recentDays: [Day]
    let counts: [String: Int]
    let totalWords: Int
    let parts: Parts
    let trouble: [Trouble]
    let accuracy: Double?

    func count(_ status: VocabStatus) -> Int { counts[status.rawValue] ?? 0 }
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
    let overview: VocabOverview?
    let kids: [Kid]?
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
}

struct VocabState: Decodable, Hashable {
    let sessionId: String
    /// Time spent answering so far (not reading a tip after a miss).
    let elapsedMs: Int
    let limitMs: Int
    let noDontKnow: Bool
    let question: VocabQuestion?
    let summary: VocabSummary?
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
            case .removed: "Removed"
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
            vocab = DemoVocab.home(parent: showingParentView, kid: actingKid?.name)
            return
        }
        guard let (data, status) = try? await vocabCall("GET", "tuttles/api/vocab"), status == 200,
              let home = try? Self.decoder.decode(VocabHome.self, from: data),
              // Unless the view changed meanwhile: then this isn't its page.
              viewer == asked else { return }
        vocab = home
    }

    /// Today's session: the one under way, or a new one.
    func vocabBegin() async throws -> VocabState {
        if isDemo { return DemoVocab.begin() }
        guard let state: VocabState = try await vocabPost("tuttles/api/vocab/session", [:]) else {
            throw SendError.server("Tuttles couldn't be reached.")
        }
        return state
    }

    /// Answers the question on screen (`choice` nil: "Don't know"). Nil when
    /// the session has moved on without this phone: begin again to catch up.
    func vocabAnswer(_ state: VocabState, position: Int, choice: Int?, ms: Int) async throws -> VocabAnswer? {
        if isDemo { return DemoVocab.answer(choice: choice, ms: ms) }
        return try await vocabPost("tuttles/api/vocab/answer", [
            "sessionId": state.sessionId, "position": position, "choice": choice.map { $0 as Any } ?? NSNull(), "ms": ms,
        ])
    }

    /// "Too easy": the word on screen is gone for good and another takes its place.
    func vocabRemove(_ state: VocabState, position: Int, ms: Int) async throws -> VocabState? {
        if isDemo { return DemoVocab.removeCurrent() }
        return try await vocabPost("tuttles/api/vocab/remove", [
            "sessionId": state.sessionId, "position": position, "ms": ms,
        ])
    }

    /// Every word and word part: their own, or one of the kids' from the parents' view.
    func vocabList(kid: UUID?) async throws -> VocabList {
        if isDemo { return DemoVocab.list(canEdit: kid == nil) }
        let query = kid.map { [URLQueryItem(name: "kid", value: $0.uuidString.lowercased())] } ?? []
        let (data, status) = try await vocabCall("GET", "tuttles/api/vocab/list", query: query)
        guard status == 200 else { throw SendError.server(Self.vocabError(data)) }
        return try Self.decoder.decode(VocabList.self, from: data)
    }

    /// Takes one of their own words out (too easy), or brings a removed one back.
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

/// One timed session: a question at a time against the ten-minute countdown
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
    private(set) var busy = false
    private(set) var failed = false
    /// The answer on screen, until the website has it.
    private var unsent: (position: Int, choice: Int?, ms: Int)?
    /// They're ready for the next question and it isn't here yet.
    private(set) var wantsNext = false
    /// When the question on screen started waiting for its answer.
    private var waitingSince = Date()
    /// The time the question took, once it's answered.
    private var tookMs: Int?
    /// Counts the questions shown, so each one's views are its own.
    private(set) var shown = 0

    init(store: ChatStore, state: VocabState) {
        self.store = store
        self.state = state
    }

    var question: VocabQuestion? { state.question }
    var summary: VocabSummary? { state.summary }
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
        // Graded here and now; the website hears about it behind what's on screen.
        feedback = question.key?.feedback(for: choice)
        unsent = (question.position, choice, ms)
        await send()
    }

    /// Hands the answer on screen to the website, which sends back what's next.
    private func send() async {
        guard let unsent, !busy else { return }
        busy = true
        failed = false
        defer { busy = false }
        // Graded here, there's nothing to take back: it keeps trying. Otherwise
        // the answer is the website's to give, and a failure hands the question back.
        let graded = feedback != nil
        for attempt in 0..<(graded ? 4 : 1) {
            if attempt > 0 { try? await Task.sleep(for: .seconds(Double(attempt))) }
            do {
                if let result = try await store.vocabAnswer(state, position: unsent.position, choice: unsent.choice, ms: unsent.ms) {
                    if feedback == nil { feedback = result.feedback }
                    pending = result.state
                } else {
                    // The session moved on without this phone (or an earlier try
                    // did get through): pick it up where it is.
                    let now = try await store.vocabBegin()
                    if graded { pending = now } else { show(now) }
                }
                self.unsent = nil
                if wantsNext { withAnimation(.snappy) { advance() } }
                return
            } catch {}
        }
        failed = true
        if !graded {
            self.unsent = nil
            picked = nil
            tookMs = nil
        }
    }

    /// "Too easy" (or just not wanted): the word is gone for good and another takes its place.
    func remove() async {
        guard let question, picked == nil, !busy else { return }
        let ms = Int(Date().timeIntervalSince(waitingSince) * 1000)
        busy = true
        failed = false
        defer { busy = false }
        do {
            if let next = try await store.vocabRemove(state, position: question.position, ms: ms) {
                show(next)
            } else {
                show(try await store.vocabBegin())
            }
        } catch {
            failed = true
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
        do { show(try await store.vocabBegin()) } catch { failed = true }
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
