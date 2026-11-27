import Foundation
import Observation
import Supabase

// What Math keeps on the phone for one kid: how they look, what they've done
// with each question, today's count, and whatever the website hasn't been
// told yet. The game never waits on the network. When there is one, the runs
// and answers waiting go up (/tuttles/api/math/sync, src/lib/tuttles/math.ts)
// and the brothers' board comes back; how they look goes up too, so a new
// phone gets it.
//
// What the game pays goes into the house's purse (iPhone/House/HouseStore.swift),
// as coins: the same purse Vocab pays into. A run counts stars, its only
// score, and they're made into coins when it's over: 10 to a coin
// (Shared/HousePay.swift).

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
    /// The economy it was played under (HouseState.economy): from 2, `stars`
    /// is the score. Nil from before.
    var economy: Int? = nil
}

/// A run on the stars top 10.
struct MathTopRun: Codable, Hashable, Identifiable {
    let id: UUID
    let name: String
    let me: Bool
    let stars: Int
    let at: Date
}

/// The stars top 10s: today's and of all time.
struct MathTop: Codable, Hashable {
    var today: [MathTopRun] = []
    var all: [MathTopRun] = []
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
        /// From when Math had a purse and a shop of its own. The stars were
        /// taken across to the house as coins (HouseStore.take); the rest is
        /// kept only so an older copy still reads.
        var stars = 0
        var earned = 0
        var owned: [String] = []
        var wearing: [String: String] = [:]
        var look: MathLook?
        /// The best score from before stars were the score: kept so an older copy still reads.
        var bestScore = 0
        /// The most stars in a run.
        var bestStars: Int?
        /// Stars short of a coin, from runs before: they count towards the next.
        var starCarry: Int?
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
        var top: MathTop?
        var musicOn = true
        var effectsOn = true
        var runsPlayed = 0
        /// Answers got right, by day: what a strong day is counted from.
        var right: [String: Int]?
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
    /// What's in the purse: the house's.
    var stars: Int { HouseStore.shared.coins }
    var wallet: Wallet { saved.wallet }
    var board: [MathBoardRow] { saved.board }

    /// The stars top 10s, as the website last told them, with this phone's
    /// runs it hasn't heard of yet put in.
    var top: MathTop {
        let kept = saved.top ?? MathTop()
        let today = Self.day()
        let mine = saved.runs.filter { ($0.economy ?? 0) >= HouseState.economy }.map {
            MathTopRun(id: $0.id, name: name, me: true, stars: $0.stars, at: $0.endedAt)
        }
        func merged(_ list: [MathTopRun], _ more: [MathTopRun]) -> [MathTopRun] {
            let have = Set(list.map(\.id))
            return Array((list + more.filter { !have.contains($0.id) }).sorted { $0.stars != $1.stars ? $0.stars > $1.stars : $0.at < $1.at }.prefix(10))
        }
        return MathTop(today: merged(kept.today.filter { Self.day($0.at) == today }, mine.filter { Self.day($0.at) == today }),
                       all: merged(kept.all, mine))
    }
    var runsPlayed: Int { saved.runsPlayed }
    var waiting: Int { saved.answers.count }

    func setLevel(_ level: VocabLevel) {
        saved.level = level
        save()
    }

    /// Their own face, hair, skin and clothes.
    var look: MathLook { saved.wallet.look ?? .plain }

    func setLook(_ look: MathLook) {
        saved.wallet.look = look
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
    /// How many days the goal's been reached, ever.
    var goalDays: Int { saved.wallet.goalDays.count }

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

    /// An answer's been given. Returns the stars it won the run
    /// (MathPay.answer), and whether it made the day a strong one, which pays a gem.
    func record(_ answer: MathAnswer, question: MathQuestion, left: Double, streak: Int) -> (stars: Int, gem: Bool) {
        var seen = saved.seen[question.id] ?? MathBank.Seen()
        seen.times += 1
        seen.last = answer.at
        var paid = 0
        if answer.correct {
            seen.right += 1
            saved.comeback.removeAll { $0 == question.id }
            paid = MathPay.answer(difficulty: question.difficulty, left: left, streak: streak)
        } else if !saved.comeback.contains(question.id) {
            saved.comeback.append(question.id)
            if saved.comeback.count > 12 { saved.comeback.removeFirst() }
        }
        saved.seen[question.id] = seen
        saved.answers.append(answer)
        let today = Self.day()
        saved.days[today, default: 0] += 1
        if answer.correct { saved.right = (saved.right ?? [:]).merging([today: 1], uniquingKeysWith: +) }
        if (saved.days[today] ?? 0) >= Self.dayGoal, saved.wallet.goalDays.last != today {
            saved.wallet.goalDays.append(today)
            if saved.wallet.goalDays.count > 400 { saved.wallet.goalDays.removeFirst() }
        }
        // The day's 20 done with enough of them right: a gem, the once.
        var gem = false
        if (saved.days[today] ?? 0) >= Self.dayGoal, (saved.right?[today] ?? 0) >= MathPay.strongDay,
           !HouseStore.shared.state.paid.contains(MathPay.gemKey(today)) {
            HouseStore.shared.pay(key: MathPay.gemKey(today), coins: 0, gems: 1, from: "math")
            gem = true
        }
        // Old days aren't needed here: the website has them.
        if saved.days.count > 40 { for key in saved.days.keys.sorted().dropLast(40) { saved.days[key] = nil } }
        if let right = saved.right, right.count > 40 { for key in right.keys.sorted().dropLast(40) { saved.right?[key] = nil } }
        save(wallet: true)
        return (paid, gem)
    }

    /// A run's over (or the app's closing on one): make its stars coins and
    /// note it for the website. Returns the coins.
    @discardableResult
    func finish(_ run: MathRun) -> Int {
        var run = run
        run.economy = HouseState.economy
        run.score = run.stars
        saved.runs.removeAll { $0.id == run.id }
        saved.runs.append(run)
        let pay = MathPay.coins(stars: run.stars, carried: saved.wallet.starCarry ?? 0)
        saved.wallet.starCarry = pay.left
        HouseStore.shared.add(coins: pay.coins)
        saved.wallet.bestStars = max(saved.wallet.bestStars ?? 0, run.stars)
        saved.wallet.bestWaves = max(saved.wallet.bestWaves, run.waves)
        saved.wallet.bestStreak = max(saved.wallet.bestStreak, run.bestStreak)
        saved.runsPlayed += 1
        save(wallet: true)
        return pay.coins
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
        let top: MathTop?

        enum Keys: String, CodingKey { case name, level, state, board, top }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            name = try c.decode(String.self, forKey: .name)
            level = try c.decode(VocabLevel.self, forKey: .level)
            // A state this build can't read is left where it is.
            state = try? c.decode(State.self, forKey: .state)
            board = (try? c.decode([MathBoardRow].self, forKey: .board)) ?? []
            top = try? c.decode(MathTop.self, forKey: .top)
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
        store.authorize(&request, token: token, mine: store.playingAsSelf)
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
        if let top = pack.top { saved.top = top }
        if let theirs = pack.state, theirs.rev > saved.rev {
            // Another phone, or this one before it was wiped, got further.
            saved.wallet = theirs.json
            saved.rev = theirs.rev
        }
        save()
    }

    // MARK: For the simulator

    /// Right answers today, of the day's count.
    var rightToday: Int { saved.right?[Self.day()] ?? 0 }
}
