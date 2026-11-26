import Foundation
import Observation
import Supabase

// What Math keeps on the phone for one kid: their stars, what they've bought
// and are wearing, what they've done with each question, today's count, and
// whatever the website hasn't been told yet. The game never waits on the
// network. When there is one, the runs and answers waiting go up
// (/tuttles/api/math/sync, src/lib/tuttles/math.ts) and the brothers' board
// comes back; the stars and purchases go up too, so a new phone gets them.

/// A run, as the website keeps it.
struct MathRun: Codable, Hashable {
    let id: UUID
    let startedAt: Date
    var endedAt: Date
    var score: Int
    var distance: Int
    var waves: Int
    var depth: Int
    var stars: Int
    var answered: Int
    var correct: Int
    var bestStreak: Int
}

struct MathAnswer: Codable, Hashable {
    let id: UUID
    let run: UUID
    let question: String
    let topic: String
    let section: String
    let difficulty: Int
    /// nil: the clock ran out.
    let chosen: Int?
    let correct: Bool
    let ms: Int
    let at: Date
}

/// One brother's line on the board.
struct MathBoardRow: Codable, Hashable, Identifiable {
    let kid: String
    let name: String
    let me: Bool
    let bestScore: Int
    let bestWaves: Int
    let bestDepth: Int
    let bestStreak: Int
    let answeredToday: Int
    let answeredTotal: Int
    let correctTotal: Int
    var id: String { kid }
}

@MainActor
@Observable
final class MathStore {
    static let shared = MathStore()
    static let dayGoal = 20

    /// What goes to the website so it survives a new phone.
    struct Wallet: Codable, Equatable {
        var stars = 0
        var earned = 0
        var owned: [String] = []
        /// What's on, by slot: "outfit", "finish", "board", "trail", "teacher".
        var wearing: [String: String] = [:]
        var look: MathLook?
        var bestScore = 0
        var bestWaves = 0
        var bestStreak = 0
        /// The days the goal was reached ("2026-11-25"), newest last.
        var goalDays: [String] = []
    }

    private struct Saved: Codable {
        var rev = 0
        var wallet = Wallet()
        var level: VocabLevel?
        var name: String?
        var seen: [String: MathBank.Seen] = [:]
        var comeback: [String] = []
        /// Answers given, by day.
        var days: [String: Int] = [:]
        var runs: [MathRun] = []
        var answers: [MathAnswer] = []
        var board: [MathBoardRow] = []
        var musicOn = true
        var effectsOn = true
        var runsPlayed = 0
    }

    private var saved = Saved()
    private(set) var owner: UUID?
    @ObservationIgnored private var syncing = false

    // MARK: Whose

    /// Open the store for whoever the phone is being used as.
    func open(for owner: UUID, name: String?, level: VocabLevel?) {
        if self.owner != owner {
            self.owner = owner
            saved = (try? Data(contentsOf: file(owner))).flatMap { try? Self.decoder.decode(Saved.self, from: $0) } ?? Saved()
        }
        if let level, saved.level == nil { saved.level = level }
        if let name, !name.isEmpty { saved.name = name }
        if saved.wallet.look == nil {
            let first = (saved.name ?? "").lowercased()
            saved.wallet.look = first.contains("oscar") ? .oscar : first.contains("sebastian") ? .sebastian : .plain
        }
        MathAudio.shared.musicOn = saved.musicOn
        MathAudio.shared.effectsOn = saved.effectsOn
    }

    private func file(_ owner: UUID) -> URL {
        let root = URL.applicationSupportDirectory.appending(path: Bundle.main.bundleIdentifier ?? "io.mason.tuttles")
        return root.appending(path: "math").appending(path: owner.uuidString.lowercased() + ".json")
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private func save(wallet changed: Bool = false) {
        if changed { saved.rev += 1 }
        guard let owner, let data = try? Self.encoder.encode(saved) else { return }
        let url = file(owner)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    // MARK: Read

    var level: VocabLevel? { saved.level }
    var name: String { saved.name ?? "You" }
    var stars: Int { saved.wallet.stars }
    var wallet: Wallet { saved.wallet }
    var board: [MathBoardRow] { saved.board }
    var runsPlayed: Int { saved.runsPlayed }
    var waiting: Int { saved.answers.count }

    func setLevel(_ level: VocabLevel) {
        saved.level = level
        save()
    }

    /// Their own face, hair and skin, in whatever they've put on.
    var look: MathLook {
        var look = saved.wallet.look ?? .plain
        if let outfit = MathCatalog.item(saved.wallet.wearing["outfit"]), case .outfit(let body, let top, let bottom, let shoes) = outfit.what, !top.isEmpty {
            look.body = body
            look.top = top
            look.bottom = bottom
            look.shoes = shoes
        }
        if let finish = MathCatalog.item(saved.wallet.wearing["finish"]), case .finish(let f) = finish.what { look.finish = f }
        return look
    }

    /// The look underneath the outfit, for the editor.
    var ownLook: MathLook { saved.wallet.look ?? .plain }

    func setOwnLook(_ look: MathLook) {
        saved.wallet.look = look
        save(wallet: true)
    }

    func owns(_ item: MathItem) -> Bool { item.price == 0 || saved.wallet.owned.contains(item.id) }

    func wearing(_ item: MathItem) -> Bool {
        saved.wallet.wearing[item.slot] == item.id || (saved.wallet.wearing[item.slot] == nil && item.isDefault)
    }

    func worn(_ slot: String) -> MathItem? {
        MathCatalog.item(saved.wallet.wearing[slot]) ?? MathCatalog.items.first { $0.slot == slot && $0.isDefault }
    }

    /// Buy it if there are the stars for it. True if it's theirs now.
    @discardableResult
    func buy(_ item: MathItem) -> Bool {
        if owns(item) { return true }
        guard saved.wallet.stars >= item.price else { return false }
        saved.wallet.stars -= item.price
        saved.wallet.owned.append(item.id)
        saved.wallet.wearing[item.slot] = item.id
        save(wallet: true)
        return true
    }

    func wear(_ item: MathItem) {
        guard owns(item) else { return }
        saved.wallet.wearing[item.slot] = item.isDefault ? nil : item.id
        save(wallet: true)
    }

    var musicOn: Bool {
        get { saved.musicOn }
        set { saved.musicOn = newValue; MathAudio.shared.musicOn = newValue; save() }
    }

    var effectsOn: Bool {
        get { saved.effectsOn }
        set { saved.effectsOn = newValue; MathAudio.shared.effectsOn = newValue; save() }
    }

    // MARK: The day

    static func day(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    var answeredToday: Int { saved.days[Self.day()] ?? 0 }
    var goalReachedToday: Bool { saved.wallet.goalDays.last == Self.day() }

    /// Days in a row the goal's been reached, up to today (or yesterday, if today's still going).
    var streak: Int {
        var count = 0
        var date = Date()
        if !saved.wallet.goalDays.contains(Self.day(date)) { date = Calendar.current.date(byAdding: .day, value: -1, to: date) ?? date }
        while saved.wallet.goalDays.contains(Self.day(date)) {
            count += 1
            date = Calendar.current.date(byAdding: .day, value: -1, to: date) ?? date
        }
        return count
    }

    // MARK: Questions

    func nextQuestion(runLevel: Int, asked: Set<String>) -> MathQuestion? {
        var rng = SystemRandomNumberGenerator()
        return MathBank.next(level: saved.level ?? .middle, runLevel: runLevel, seen: saved.seen, asked: asked, using: &rng)?.shuffled(using: &rng)
    }

    /// What a right answer pays: more for a hard one, a quick one, and a run of them.
    static func payout(difficulty: Int, fraction left: Double, streak: Int) -> Int {
        let base = 50 + 20 * Double(difficulty) + 40 * max(0, min(1, left))
        return Int((base * min(3, 1 + 0.25 * Double(max(0, streak - 1)))).rounded())
    }

    /// An answer's been given. Returns the stars it paid, and the day's bonus if this was the one that reached the goal.
    func record(_ answer: MathAnswer, question: MathQuestion, left: Double, streak: Int) -> (stars: Int, goalBonus: Int) {
        var seen = saved.seen[question.id] ?? MathBank.Seen()
        seen.times += 1
        seen.last = answer.at
        var paid = 0
        if answer.correct {
            seen.right += 1
            saved.comeback.removeAll { $0 == question.id }
            paid = Self.payout(difficulty: question.difficulty, fraction: left, streak: streak)
        } else if !saved.comeback.contains(question.id) {
            saved.comeback.append(question.id)
            if saved.comeback.count > 12 { saved.comeback.removeFirst() }
        }
        saved.seen[question.id] = seen
        saved.answers.append(answer)
        let today = Self.day()
        saved.days[today, default: 0] += 1
        var bonus = 0
        if (saved.days[today] ?? 0) >= Self.dayGoal, saved.wallet.goalDays.last != today {
            saved.wallet.goalDays.append(today)
            if saved.wallet.goalDays.count > 400 { saved.wallet.goalDays.removeFirst() }
            bonus = min(300, 100 + 20 * (streak_() - 1))
        }
        saved.wallet.stars += paid + bonus
        saved.wallet.earned += paid + bonus
        // Old days aren't needed here: the website has them.
        if saved.days.count > 40 { for key in saved.days.keys.sorted().dropLast(40) { saved.days[key] = nil } }
        save(wallet: true)
        return (paid, bonus)
    }

    private func streak_() -> Int { streak }

    /// A run's over (or the app's closing on one): bank its stars and note it for the website.
    func finish(_ run: MathRun, pickedUp: Int) {
        saved.runs.removeAll { $0.id == run.id }
        saved.runs.append(run)
        saved.wallet.stars += pickedUp
        saved.wallet.earned += pickedUp
        saved.wallet.bestScore = max(saved.wallet.bestScore, run.score)
        saved.wallet.bestWaves = max(saved.wallet.bestWaves, run.waves)
        saved.wallet.bestStreak = max(saved.wallet.bestStreak, run.bestStreak)
        saved.runsPlayed += 1
        save(wallet: true)
    }

    // MARK: The website

    private struct Reply: Decodable {
        struct State: Decodable {
            let rev: Int
            let json: Wallet
        }
        let name: String
        let level: VocabLevel
        let state: State?
        let board: [MathBoardRow]

        enum Keys: String, CodingKey { case name, level, state, board }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            name = try c.decode(String.self, forKey: .name)
            level = try c.decode(VocabLevel.self, forKey: .level)
            // A state this build can't read is left where it is.
            state = try? c.decode(State.self, forKey: .state)
            board = (try? c.decode([MathBoardRow].self, forKey: .board)) ?? []
        }
    }

    /// Send what's waiting and take back the board. Quietly does nothing with no connection.
    func sync(with store: ChatStore) async {
        guard !store.isDemo, !store.showingParentView, let owner, owner == store.ownerID, !syncing else { return }
        syncing = true
        defer { syncing = false }
        let runs = Array(saved.runs.prefix(150))
        let answers = Array(saved.answers.prefix(1500))
        struct Body: Encodable {
            struct State: Encodable {
                let rev: Int
                let json: Wallet
            }
            let runs: [MathRun]
            let answers: [MathAnswer]
            let state: State?
        }
        // A phone that's never had anything sends no state, so a reinstall takes the website's.
        let fresh = saved.rev == 0
        let body = Body(runs: runs, answers: answers, state: fresh ? nil : .init(rev: saved.rev, json: saved.wallet))
        guard let data = try? Self.encoder.encode(body), let token = try? await store.client.auth.session.accessToken else { return }
        var request = URLRequest(url: ChatStore.websiteURL.appending(path: "tuttles/api/math/sync"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        store.authorize(&request, token: token)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        guard let (reply, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let pack = try? Self.decoder.decode(Reply.self, from: reply),
              self.owner == owner else { return }
        let sentRuns = Set(runs.map(\.id)), sentAnswers = Set(answers.map(\.id))
        saved.runs.removeAll { sentRuns.contains($0.id) }
        saved.answers.removeAll { sentAnswers.contains($0.id) }
        saved.level = pack.level
        saved.name = pack.name
        saved.board = pack.board
        if let theirs = pack.state, theirs.rev > saved.rev {
            // Another phone, or this one before it was wiped, got further.
            saved.wallet = theirs.json
            saved.rev = theirs.rev
        }
        save()
    }

    // MARK: For the simulator

    /// `--math-stars 5000`: a full purse, to try the shop.
    func demo(stars: Int) {
        saved.wallet.stars = stars
        save()
    }
}
