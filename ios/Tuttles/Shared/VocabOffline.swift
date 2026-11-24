import Foundation

// Vocab with no connection. The phone keeps the words, the schedule's numbers
// and what the kid has done, and plays sessions by itself (VocabEngine.swift).
// Every answer is written down here the moment it's given. When the website
// can be reached, the answers it hasn't had are sent up and it sends back
// where everything stands (/tuttles/api/vocab/sync, src/lib/words/offline.ts),
// which replaces what's here; anything answered meanwhile is put back on top.
//
// So the phone is never waiting on the network to ask a question, and nothing
// answered is lost to a bad connection: it stays in the outbox until the
// website says it arrived.

/// What the website sends back from a sync (Pack in src/lib/words/offline.ts).
struct VocabPack: Decodable {
    struct Sort: Codable, Hashable {
        let done: Bool
        let through: Int
    }

    /// Only when the phone's words aren't the website's.
    let content: VocabContent?
    let contentVersion: String
    let rules: VocabRuleSet
    /// The time zone a day is reckoned in.
    let tz: String
    let name: String
    let level: VocabLevel
    let questions: Int
    let limitMs: Int
    let progress: [VocabProgress]
    /// The newest first.
    let sessions: [VocabLocalSession]
    let sort: Sort
}

/// One kid's Vocab, kept on this phone.
@MainActor
final class VocabLocal {
    /// Where the website stood the last time it was heard from.
    struct Base: Codable {
        var rules: VocabRuleSet
        var tz: String
        var name: String
        var level: VocabLevel
        var questions: Int
        var limitMs: Int
        var progress: [VocabProgress]
        var sessions: [VocabLocalSession]
        var sort: VocabPack.Sort

        init(_ pack: VocabPack) {
            rules = pack.rules
            tz = pack.tz
            name = pack.name
            level = pack.level
            questions = pack.questions
            limitMs = pack.limitMs
            progress = pack.progress
            sessions = pack.sessions
            sort = pack.sort
        }
    }

    /// What's been done here that the website may not have yet.
    struct Mine: Codable {
        /// Answers the website hasn't said it has, oldest first.
        var outbox: [VocabEngine.Answered] = []
        /// Sessions played here, as they stand here, until the website's copy has caught up.
        var sessions: [VocabLocalSession] = []
        /// The stages that have been gold. Kept only here: gold is theirs
        /// once earned, even after a word of the stage is missed again.
        var gold: [Int]?
    }

    /// What goes up in one sync, and what it'll settle if it gets there.
    struct Sending {
        let content: String
        let sessions: [VocabLocalSession]
        let answers: [VocabEngine.Answered]
    }

    private let folder: URL
    private(set) var content: VocabContent
    private(set) var base: Base
    private(set) var mine: Mine
    /// Their progress as it stands here: the website's, with the outbox on top.
    private(set) var progress: VocabEngine.Progress = [:]
    /// The session on screen. It's this phone's until it's closed: nothing
    /// from the website changes it under them.
    var playing: String?
    /// Words to a stage of the path. (The demo's are fewer, to have a path to show.)
    var stageSize = VocabEngine.stageSize
    /// The stage each session played here started in, and how many of its
    /// words had been met, for the end screen to show how far it got them.
    private var startedFrom: [String: (stage: Int, met: Int)] = [:]

    var rules: VocabRuleSet { base.rules }
    /// Answers waiting to go up.
    var waiting: Int { mine.outbox.count }

    private init(folder: URL, content: VocabContent, base: Base, mine: Mine) {
        self.folder = folder
        self.content = content
        self.base = base
        self.mine = mine
        rebuild()
        // A boss round under way when the app was last closed: it's over.
        endBosses()
    }

    // MARK: On disk

    /// Not the caches folder, which the phone may empty when it's short of
    /// room: the outbox is the only copy of what's in it.
    static func folder(for owner: UUID) -> URL {
        let root = URL.applicationSupportDirectory.appending(path: Bundle.main.bundleIdentifier ?? "io.mason.tuttles")
        return root.appending(path: "vocab").appending(path: owner.uuidString.lowercased())
    }

    /// What this phone has kept for someone; nil before it's ever reached the website for them.
    static func load(from folder: URL) -> VocabLocal? {
        let decoder = JSONDecoder()
        func read<T: Decodable>(_ name: String) -> T? {
            (try? Data(contentsOf: folder.appending(path: name))).flatMap { try? decoder.decode(T.self, from: $0) }
        }
        guard let content: VocabContent = read("content.json"), let base: Base = read("base.json") else { return nil }
        return VocabLocal(folder: folder, content: content, base: base, mine: read("mine.json") ?? Mine())
    }

    /// The first sync for someone: there has to be the words in it.
    static func start(in folder: URL, with pack: VocabPack) -> VocabLocal? {
        guard let content = pack.content else { return nil }
        // Anything left behind there (an outbox with no words to go with it) still goes up.
        let left = (try? Data(contentsOf: folder.appending(path: "mine.json"))).flatMap { try? JSONDecoder().decode(Mine.self, from: $0) }
        let local = VocabLocal(folder: folder, content: content, base: Base(pack), mine: left ?? Mine())
        local.write(content, to: "content.json")
        local.write(local.base, to: "base.json")
        return local
    }

    private func write<T: Encodable>(_ value: T, to name: String) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: folder.appending(path: name), options: .atomic)
    }

    private func saveMine() { write(mine, to: "mine.json") }

    // MARK: Putting the two together

    private func rebuild() {
        var all = Dictionary(base.progress.map { ($0.item, $0) }, uniquingKeysWith: { a, _ in a })
        for a in mine.outbox {
            all[a.item] = VocabEngine.applyAnswer(all[a.item], item: a.item, form: a.form, result: a.result, today: a.day, now: a.at, rules: rules)
        }
        progress = all
    }

    /// Every session, the newest first: the website's, with this phone's own copy of the ones played here.
    var sessions: [VocabLocalSession] {
        let here = Set(mine.sessions.map(\.id))
        return (mine.sessions + base.sessions.filter { !here.contains($0.id) }).sorted { $0.startedAt > $1.startedAt }
    }

    private func keep(_ session: VocabLocalSession) {
        if let at = mine.sessions.firstIndex(where: { $0.id == session.id }) {
            mine.sessions[at] = session
        } else {
            mine.sessions.append(session)
        }
    }

    func today(_ now: Date = Date()) -> String { VocabDay.of(now, zone: base.tz) }

    // MARK: Playing

    /// Today's session: the one under way, or a new one.
    func begin(now: Date = Date()) -> VocabState {
        let day = today(now)
        endBosses(now: now)
        var session = sessions.first { $0.day == day && !$0.isFinished && $0.boss == nil }
            ?? VocabEngine.newSession(day: day, total: base.questions, limitMs: base.limitMs, now: now, rules: rules)
        // (A question on words that have since been replaced can't be shown: choose again.)
        if session.current == nil || VocabEngine.question(session, content: content) == nil { serve(&session, now: now) }
        keep(session)
        playing = session.id
        if startedFrom[session.id] == nil, let stage = path().current { startedFrom[session.id] = (stage.number, stage.met) }
        saveMine()
        return state(session)
    }

    /// A stage's boss round, from its first question. Nil when the stage has no words for one.
    func beginBoss(stage: Int, now: Date = Date()) -> VocabState? {
        endBosses(now: now)
        let lineup = VocabEngine.bossLineup(stage: stage, content: content, progress: progress, size: stageSize)
        guard !lineup.isEmpty else { return nil }
        var session = VocabEngine.newSession(day: today(now), total: lineup.count,
                                             limitMs: lineup.count * VocabEngine.bossMsPerQuestion, now: now, rules: rules)
        session.noDontKnow = true
        session.boss = stage
        session.lineup = lineup
        serve(&session, now: now)
        keep(session)
        playing = session.id
        saveMine()
        return state(session)
    }

    /// A boss round is one go: left part-way, it's over, and one never
    /// answered at all was never played.
    func endBosses(now: Date = Date()) {
        guard mine.sessions.contains(where: { $0.boss != nil && !$0.isFinished }) else { return }
        for at in mine.sessions.indices where mine.sessions[at].boss != nil && !mine.sessions[at].isFinished {
            mine.sessions[at].finishedAt = VocabDay.stamp(now)
            mine.sessions[at].current = nil
        }
        mine.sessions.removeAll { $0.boss != nil && $0.answered == 0 }
        saveMine()
    }

    /// The words as a path of stages, as they stand here.
    func path() -> VocabPath {
        let kept = Set(mine.gold ?? [])
        let path = VocabEngine.path(content: content, progress: progress, sessions: sessions, size: stageSize, gold: kept)
        let gold = Set(path.stages.filter(\.gold).map(\.number))
        if gold != kept {
            mine.gold = gold.sorted()
            saveMine()
        }
        return path
    }

    /// The stage a word belongs to, 1 for the first; nil for a word part.
    private func stage(of item: String) -> Int? {
        content.words.firstIndex { $0.id == item }.map { $0 / max(1, stageSize) + 1 }
    }

    /// Answers the question on screen (`choice` nil: "Don't know") and says
    /// what's next. Nil when that isn't the question this phone is on: begin again.
    func answer(session id: String, position: Int, choice: Int?, ms: Int, now: Date = Date()) -> VocabState? {
        guard var session = mine.sessions.first(where: { $0.id == id }), position == session.answered + 1,
              let answered = VocabEngine.record(&session, progress: &progress, choice: choice, ms: ms, now: now, rules: rules) else { return nil }
        mine.outbox.append(answered)
        // A boss round that can't be won any more ends there.
        if session.answered >= session.total || VocabEngine.bossLost(session) {
            session.current = nil
            session.finishedAt = VocabDay.stamp(now)
        } else {
            serve(&session, now: now)
        }
        keep(session)
        saveMine()
        return state(session)
    }

    /// Puts the next question on the session, or ends it when there's nothing left to ask.
    private func serve(_ session: inout VocabLocalSession, now: Date) {
        // A boss in the way holds the new words back: reviews only until it's beaten.
        session.current = session.boss == nil
            ? VocabEngine.choose(session, content: content, progress: progress, rules: rules, holdNew: path().bossReady != nil)
            : VocabEngine.chooseBoss(session, content: content, progress: progress, rules: rules)
        if session.current == nil { session.finishedAt = VocabDay.stamp(now) }
    }

    private func state(_ session: VocabLocalSession) -> VocabState {
        let boss = session.boss.map { stage in
            VocabBoss(stage: stage, total: session.total, needed: VocabEngine.bossNeeded(session.total),
                      correct: session.correct, answered: session.answered, over: session.isFinished,
                      fails: VocabEngine.bossFails(stage: stage, sessions: sessions))
        }
        var summary: VocabSummary?
        if session.isFinished {
            summary = VocabEngine.summary(session, content: content,
                                          dayMs: sessions.filter { $0.day == session.day }.reduce(0) { $0 + $1.elapsedMs }, rules: rules)
            summary?.boss = boss
            if boss == nil, let from = startedFrom[session.id], let stage = path().stages.first(where: { $0.number == from.stage }) {
                summary?.climb = VocabClimb(stage: stage, metBefore: min(from.met, stage.met))
            }
        }
        // An ordinary session is a stretch of the climb: it carries the stage they're on.
        let path = boss == nil ? path() : nil
        // (With a boss in the way, that's its stage: the session is practice for it.)
        let stage = path.flatMap { $0.bossReady ?? $0.current ?? $0.stages.last }
        if boss == nil { summary?.bossWaiting = path?.bossReady?.number }
        var question = summary == nil ? VocabEngine.question(session, content: content) : nil
        // A word from further back down is ground they're holding, and says where it's from.
        if let stage, let current = session.current, !current.isNew, let from = self.stage(of: current.item), from != stage.number {
            question?.from = VocabStage.name(from)
        }
        var state = VocabState(sessionId: session.id, elapsedMs: session.elapsedMs, limitMs: session.limitMs, noDontKnow: session.noDontKnow,
                               question: question, summary: summary)
        state.boss = boss
        state.stage = stage
        return state
    }

    /// Vocab's first screen, from what's here.
    func home(now: Date = Date()) -> VocabHome {
        let day = today(now)
        let overview = VocabEngine.overview(level: base.level, questions: base.questions, today: day, content: content, progress: progress,
                                            sessions: sessions, sortedThrough: base.sort.through, sortDone: base.sort.done, rules: rules)
        return VocabHome(view: "kid", name: base.name, daysLeft: VocabDay.between(day, rules.testDate), overview: overview, kids: nil,
                         path: path())
    }

    // MARK: Syncing

    /// What to send now: every answer the website hasn't confirmed, and the sessions they belong to.
    /// A boss round goes up once it's over, not before: the website would
    /// take one left open for today's session and carry on with it.
    func sending() -> Sending {
        let held = Set(mine.sessions.filter { $0.boss != nil && !$0.isFinished }.map(\.id))
        return Sending(content: content.version, sessions: mine.sessions.filter { $0.answered > 0 && !held.contains($0.id) },
                       answers: mine.outbox.filter { !held.contains($0.session) })
    }

    /// The website has what was sent, and this is where it now stands.
    func took(_ sent: Sending, reply pack: VocabPack, now: Date = Date()) {
        if let fresh = pack.content {
            content = fresh
            write(fresh, to: "content.json")
        }
        base = Base(pack)
        write(base, to: "base.json")

        let arrived = Set(sent.answers)
        mine.outbox.removeAll { arrived.contains($0) }
        let asSent = Dictionary(sent.sessions.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let day = today(now)
        mine.sessions.removeAll { session in
            // The one on screen stays this phone's while it's being played.
            if session.id == playing, !session.isFinished { return false }
            // Started and left untouched on a day that's gone.
            if session.answered == 0 { return session.day != day }
            // The website has it just as it is here, so its copy will do from now on.
            guard let was = asSent[session.id] else { return false }
            return was.answered == session.answered && was.finishedAt == session.finishedAt
        }
        saveMine()
        rebuild()
    }
}

// MARK: - The store's side of it

/// How a try at reaching the website went.
enum VocabSyncOutcome {
    case synced
    /// It couldn't be reached. What's on the phone carries on.
    case offline
    /// The website doesn't do this (an older one), or Vocab isn't set up for them.
    case unavailable
}

extension ChatStore {
    /// What this phone has kept of Vocab for whoever's using it, read once from disk.
    func vocabOpenLocal() -> VocabLocal? {
        if isDemo {
            if vocabLocal == nil {
                if CommandLine.arguments.contains("--vocab-path") {
                    vocabLocal = DemoVocab.local(path: true)
                } else if CommandLine.arguments.contains("--vocab-offline") {
                    vocabLocal = DemoVocab.local()
                }
            }
            return showingParentView ? nil : vocabLocal
        }
        guard !showingParentView, let owner = ownerID else { return nil }
        if let local = vocabLocal, vocabLocalOwner == owner { return local }
        vocabLocal = VocabLocal.load(from: VocabLocal.folder(for: owner))
        vocabLocalOwner = owner
        return vocabLocal
    }

    /// Sends up what's been answered here and takes back where things stand.
    /// One at a time: a second caller waits for the one under way, then goes itself.
    @discardableResult
    func vocabSync() async -> VocabSyncOutcome {
        while let under = vocabSyncing { _ = await under.value }
        let task = Task { await self.vocabSyncOnce() }
        vocabSyncing = task
        let outcome = await task.value
        vocabSyncing = nil
        return outcome
    }

    private func vocabSyncOnce() async -> VocabSyncOutcome {
        guard !isDemo, !showingParentView, let owner = ownerID else { return .unavailable }
        let local = vocabOpenLocal()
        let sent = local?.sending()
        let encoder = JSONEncoder()
        struct Body: Encodable {
            let content: String?
            let sessions: [VocabLocalSession]
            let answers: [VocabEngine.Answered]
        }
        // The question on a session is this phone's business: it isn't sent.
        let sessions = (sent?.sessions ?? []).map { session in
            var s = session
            s.current = nil
            return s
        }
        guard let body = try? encoder.encode(Body(content: sent?.content, sessions: sessions, answers: sent?.answers ?? [])),
              let token = try? await client.auth.session.accessToken else { return .offline }
        var request = URLRequest(url: Self.websiteURL.appending(path: "tuttles/api/vocab/sync"))
        request.httpMethod = "POST"
        // The words come down the first time: give a slow line room.
        request.timeoutInterval = local == nil ? 90 : 30
        authorize(&request, token: token)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        guard let (data, response) = try? await URLSession.shared.data(for: request) else { return .offline }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if [403, 404, 405].contains(status) { return .unavailable }
        guard status == 200, let pack = try? JSONDecoder().decode(VocabPack.self, from: data) else { return .offline }
        // Someone else is using the phone now: this was the last person's.
        guard ownerID == owner, !showingParentView else { return .offline }
        if let local, let sent {
            local.took(sent, reply: pack)
        } else if let started = VocabLocal.start(in: VocabLocal.folder(for: owner), with: pack) {
            // Anything it found waiting on disk goes up next time.
            vocabLocal = started
            vocabLocalOwner = owner
        } else {
            return .offline
        }
        vocabWaiting = (vocabLocal?.waiting ?? 0) > 0
        return .synced
    }

    /// The first screen for a kid, or a phone used as one: what's on the phone
    /// straight away, then the website's word on it if it can be reached.
    func refreshVocabLocal() async -> Bool {
        let asked = viewer
        if let local = vocabOpenLocal() {
            vocab = local.home()
            vocabWaiting = local.waiting > 0
        }
        let outcome = await vocabSync()
        guard viewer == asked else { return true }
        guard let local = vocabLocal, vocabLocalOwner == ownerID else {
            // Nothing kept here. An older website, or not set up: ask the way it was always asked.
            if outcome == .unavailable { return false }
            vocabProblem = "Vocab needs the internet once, to get your words. After that it works without."
            return true
        }
        vocabProblem = nil
        vocab = local.home()
        vocabWaiting = local.waiting > 0
        return true
    }

    /// Sends up anything answered here that's still waiting, if there is anything.
    func vocabSendWaiting() async {
        guard let local = vocabOpenLocal(), local.waiting > 0 else { return }
        vocabWaiting = true
        await vocabSync()
    }

    /// The session on screen was closed: it can be the website's again.
    func vocabStopPlaying() {
        vocabLocal?.playing = nil
        // A boss round left part-way is over, and can go up now.
        vocabLocal?.endBosses()
    }
}
