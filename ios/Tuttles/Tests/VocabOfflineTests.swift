import XCTest
@testable import Tuttles

// Vocab played on the phone. The rules here are the website's written again
// in Swift (VocabEngine.swift), so the first thing to hold them to is the
// website: vocab-parity.json is a few weeks of sessions played by its code
// (scripts/words/parity.mts), and the same sessions played here have to ask
// the same questions and end in the same place.

private struct Parity: Decodable {
    struct Step: Decodable {
        let item: String
        let form: String
        let isNew: Bool
        let requeued: Bool
        let result: String
        let ms: Int
    }

    struct Session: Decodable {
        let day: String
        let total: Int
        let noDontKnow: Bool
        let finished: Bool
        let steps: [Step]
        let correct: Int
        let wrong: Int
        let dontknow: Int
        let newItems: Int
        let masteredGained: Int
        let elapsedMs: Int
        let requeue: [VocabLocalSession.Requeue]
    }

    struct Run: Decodable {
        let name: String
        let today: String
        let sort: VocabPack.Sort
        let sessions: [Session]
        let progress: [VocabProgress]
        let overview: VocabOverview
    }

    let rules: VocabRuleSet
    let words: [VocabItem]
    let parts: [VocabItem]
    let runs: [Run]

    static let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appending(path: "vocab-parity.json")

    static func load() throws -> Parity {
        // Beside this file on the Mac that built it, or in the test bundle.
        let url = FileManager.default.fileExists(atPath: file.path) ? file
            : try XCTUnwrap(Bundle(for: VocabParityTests.self).url(forResource: "vocab-parity", withExtension: "json"))
        return try JSONDecoder().decode(Parity.self, from: Data(contentsOf: url))
    }

    var content: VocabContent { VocabContent(version: "test", level: .lower, words: words, parts: parts) }
}

private func moment(_ day: String) -> Date {
    ISO8601DateFormatter().date(from: "\(day)T20:00:00Z")!
}

final class VocabParityTests: XCTestCase {
    /// Every question the website chose, chosen here; every answer leaving the
    /// word, the session and the first screen where the website left them.
    func testPlaysTheWebsitesSessions() throws {
        let parity = try Parity.load()
        let content = parity.content
        let rules = parity.rules
        XCTAssertFalse(parity.runs.isEmpty)

        for run in parity.runs {
            var progress: VocabEngine.Progress = [:]
            var played: [VocabLocalSession] = []
            for (number, theirs) in run.sessions.enumerated() {
                let at = moment(theirs.day)
                var session = VocabLocalSession(id: "s\(number)", day: theirs.day, total: theirs.total, limitMs: 600_000,
                                                noDontKnow: VocabEngine.isTestDaySession(theirs.day, rules), startedAt: VocabDay.stamp(at))
                XCTAssertEqual(session.noDontKnow, theirs.noDontKnow, "\(run.name) \(theirs.day): test-day session")
                for (index, step) in theirs.steps.enumerated() {
                    let place = "\(run.name) \(theirs.day) session \(number) q\(index + 1)"
                    let current = try XCTUnwrap(VocabEngine.choose(session, content: content, progress: progress, rules: rules, shuffle: false), place)
                    XCTAssertEqual(current.item, step.item, place)
                    XCTAssertEqual(current.form, step.form, place)
                    XCTAssertEqual(current.isNew, step.isNew, place)
                    XCTAssertEqual(current.requeued, step.requeued, place)
                    // Stop at the first question that differs: everything after it would too.
                    guard current.item == step.item, current.form == step.form else { return }
                    session.current = current
                    let choice: Int? = step.result == "dontknow" ? nil : step.result == "correct" ? current.correct : (current.correct + 1) % current.choices.count
                    let answered = try XCTUnwrap(VocabEngine.record(&session, progress: &progress, choice: choice, ms: step.ms, now: at, rules: rules))
                    XCTAssertEqual(answered.result, step.result, place)
                }
                if theirs.finished { session.finishedAt = VocabDay.stamp(at) }
                let place = "\(run.name) \(theirs.day) session \(number)"
                XCTAssertEqual(session.correct, theirs.correct, place)
                XCTAssertEqual(session.wrong, theirs.wrong, place)
                XCTAssertEqual(session.dontknow, theirs.dontknow, place)
                XCTAssertEqual(session.newItems, theirs.newItems, place)
                XCTAssertEqual(session.masteredGained, theirs.masteredGained, place)
                XCTAssertEqual(session.elapsedMs, theirs.elapsedMs, place)
                XCTAssertEqual(session.requeue, theirs.requeue, place)
                played.append(session)
            }

            let mine = progress.values.sorted { $0.item < $1.item }
            XCTAssertEqual(mine.count, run.progress.count, run.name)
            for (a, b) in zip(mine, run.progress) { XCTAssertEqual(a, b, "\(run.name) \(b.item)") }

            let overview = VocabEngine.overview(level: .lower, questions: run.sessions[0].total, today: run.today, content: content,
                                                progress: progress, sessions: played.reversed(), sortedThrough: run.sort.through,
                                                sortDone: run.sort.done, rules: rules)
            XCTAssertEqual(overview, run.overview, run.name)
        }
    }

    func testDays() {
        XCTAssertEqual(VocabDay.add("2026-12-31", 1), "2027-01-01")
        XCTAssertEqual(VocabDay.add("2028-02-28", 1), "2028-02-29")
        XCTAssertEqual(VocabDay.add("2027-03-01", -1), "2027-02-28")
        XCTAssertEqual(VocabDay.add("2026-11-23", 365), "2027-11-23")
        XCTAssertEqual(VocabDay.between("2026-11-23", "2027-01-11"), 49)
        XCTAssertEqual(VocabDay.between("2027-01-11", "2026-11-23"), -49)
        XCTAssertEqual(VocabDay.string(VocabDay.number("1999-12-31")), "1999-12-31")
        // Late in the evening in Costa Rica is still the same day at home; early morning UTC is yesterday there.
        let late = ISO8601DateFormatter().date(from: "2026-11-24T05:30:00Z")!
        XCTAssertEqual(VocabDay.of(late, zone: "America/Los_Angeles"), "2026-11-23")
        XCTAssertEqual(VocabDay.of(late, zone: "UTC"), "2026-11-24")
        XCTAssertEqual(VocabDay.stamp(late), "2026-11-24T05:30:00.000Z")
    }
}

/// The phone's own keeping of it: sessions played with nothing to reach,
/// written down, and squared with the website when it answers.
@MainActor
final class VocabLocalTests: XCTestCase {
    private var folder: URL!

    override func setUp() async throws {
        folder = FileManager.default.temporaryDirectory.appending(path: "vocab-tests-\(UUID().uuidString)")
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: folder)
    }

    /// What the website sends, made from the made-up words.
    private func pack(progress: [VocabProgress] = [], sessions: [VocabLocalSession] = [], questions: Int = 5, words: Bool = true) throws -> VocabPack {
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: Parity.file)) as? [String: Any])
        let encoder = JSONEncoder()
        var json: [String: Any] = [
            "contentVersion": "v1", "rules": raw["rules"]!, "tz": "America/Los_Angeles", "name": "Oscar", "level": "lower",
            "questions": questions, "limitMs": 600_000,
            "progress": try JSONSerialization.jsonObject(with: encoder.encode(progress)),
            "sessions": try JSONSerialization.jsonObject(with: encoder.encode(sessions)),
            "sort": ["done": false, "through": 0],
        ]
        if words { json["content"] = ["version": "v1", "level": "lower", "words": raw["words"]!, "parts": raw["parts"]!] }
        return try JSONDecoder().decode(VocabPack.self, from: JSONSerialization.data(withJSONObject: json))
    }

    /// The website's side of a sync, for a phone that's the only one playing:
    /// it ends up where the phone was when it sent.
    private func reply(to sent: VocabLocal.Sending, from local: VocabLocal, questions: Int = 5) throws -> VocabPack {
        var progress = Dictionary(local.base.progress.map { ($0.item, $0) }, uniquingKeysWith: { a, _ in a })
        for a in sent.answers {
            progress[a.item] = VocabEngine.applyAnswer(progress[a.item], item: a.item, form: a.form, result: a.result, today: a.day, now: a.at, rules: local.rules)
        }
        let theirs = Set(sent.sessions.map(\.id))
        let sessions = sent.sessions.map { session in
            var s = session
            s.current = nil
            return s
        } + local.base.sessions.filter { !theirs.contains($0.id) }
        return try pack(progress: Array(progress.values), sessions: sessions, questions: questions, words: false)
    }

    private let noon = ISO8601DateFormatter().date(from: "2026-11-23T20:00:00Z")!

    /// A whole session with nothing to reach: every answer kept, the day's
    /// ring moved on, and all of it still there when the app's opened again.
    func testASessionWithNoConnection() throws {
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack()))
        var state = local.begin(now: noon)
        XCTAssertEqual(state.question?.position, 1)
        XCTAssertEqual(state.question?.total, 5)
        XCTAssertNotNil(state.question?.key)

        var position = 1
        while let question = state.question {
            // The first is a miss; the rest are right.
            let choice = position == 1 ? nil : question.key?.correctIndex
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: position, choice: choice, ms: 150_000, now: noon))
            position += 1
        }
        let summary = try XCTUnwrap(state.summary)
        XCTAssertEqual(summary.total, 5)
        XCTAssertEqual(summary.correct, 4)
        XCTAssertEqual(summary.dontknow, 1)
        XCTAssertEqual(summary.missed.count, 1)
        // A question counts for a minute at most: five of them is half the day's ten.
        XCTAssertEqual(summary.dayMs, 300_000)
        XCTAssertEqual(local.waiting, 5)

        let home = try XCTUnwrap(local.home(now: noon).overview)
        XCTAssertEqual(home.sessionsToday, 1)
        XCTAssertEqual(home.day?.ms, 300_000)
        XCTAssertNil(home.inProgress)
        XCTAssertEqual(home.nextSession, 2)

        // Closed and opened again, still with no connection.
        let again = try XCTUnwrap(VocabLocal.load(from: folder))
        XCTAssertEqual(again.waiting, 5)
        XCTAssertEqual(again.progress, local.progress)
        XCTAssertEqual(again.home(now: noon).overview, home)
        // And the next session is a new one, not the one that's done.
        XCTAssertNotEqual(again.begin(now: noon).sessionId, state.sessionId)
    }

    /// The website has it: nothing's left waiting, and the phone's picture is the same as before.
    func testSyncSettlesWhatWasSent() throws {
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack()))
        var state = local.begin(now: noon)
        while let question = state.question {
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: question.position, choice: question.key?.correctIndex, ms: 4000, now: noon))
        }
        local.playing = nil
        let before = try XCTUnwrap(local.home(now: noon).overview)
        let progress = local.progress

        let sent = local.sending()
        XCTAssertEqual(sent.answers.count, 5)
        XCTAssertEqual(sent.sessions.count, 1)
        local.took(sent, reply: try reply(to: sent, from: local), now: noon)

        XCTAssertEqual(local.waiting, 0)
        XCTAssertTrue(local.mine.sessions.isEmpty)
        XCTAssertEqual(local.sessions.count, 1)
        XCTAssertEqual(local.progress, progress)
        XCTAssertEqual(local.home(now: noon).overview, before)
        XCTAssertEqual(try XCTUnwrap(VocabLocal.load(from: folder)).waiting, 0)
    }

    /// An answer given while a sync is on its way isn't lost when the reply (which hasn't got it) lands.
    func testAnswersDuringASyncStay() throws {
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(questions: 8)))
        var state = local.begin(now: noon)
        for _ in 1...2 {
            let question = try XCTUnwrap(state.question)
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: question.position, choice: question.key?.correctIndex, ms: 4000, now: noon))
        }
        let sent = local.sending()
        let reply = try reply(to: sent, from: local, questions: 8)
        // Still playing while that's in the air.
        let third = try XCTUnwrap(state.question)
        state = try XCTUnwrap(local.answer(session: state.sessionId, position: 3, choice: nil, ms: 4000, now: noon))
        local.took(sent, reply: reply, now: noon)

        XCTAssertEqual(local.waiting, 1)
        XCTAssertEqual(local.sending().answers.first?.position, 3)
        // The session on screen is as it was, question and all.
        let playing = try XCTUnwrap(local.sessions.first)
        XCTAssertEqual(playing.answered, 3)
        XCTAssertNotNil(playing.current)
        XCTAssertEqual(state.question?.position, 4)
        // The third answer was a miss, and still is.
        XCTAssertEqual(local.progress[playing.asked[2]]?.dontknowCount, 1)
        XCTAssertEqual(third.position, 3)
        XCTAssertEqual(local.home(now: noon).overview?.inProgress?.answered, 3)
    }

    /// A session left part way through on another device is picked up where it was.
    func testPicksUpTheWebsitesSession() throws {
        let open = VocabLocalSession(id: "11111111-1111-4111-8111-111111111111", day: "2026-11-23", total: 5, answered: 2, correct: 2,
                                     elapsedMs: 9000, limitMs: 600_000, noDontKnow: false, startedAt: "2026-11-23T19:00:00.000Z",
                                     asked: ["w:w001", "p:p01"])
        let known = ["w:w001", "p:p01"].map {
            VocabEngine.applyAnswer(nil, item: $0, form: "syn1", result: "correct", today: "2026-11-23", now: "", rules: try! pack().rules)
        }
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(progress: known, sessions: [open])))
        let state = local.begin(now: noon)
        XCTAssertEqual(state.sessionId, open.id)
        XCTAssertEqual(state.question?.position, 3)
        XCTAssertEqual(state.elapsedMs, 9000)
        // Nothing asked twice.
        let current = try XCTUnwrap(local.sessions.first?.current)
        XCTAssertFalse(open.asked.contains(current.item))
    }

    /// A word they've skipped as known is never asked, and a new day starts a new session.
    func testSkippedWordsAndANewDay() throws {
        var skipped = VocabEngine.applyAnswer(nil, item: "w:w001", form: "syn1", result: "correct", today: "2026-11-22", now: "", rules: try pack().rules)
        skipped.removedAt = "2026-11-22T20:00:00.000Z"
        skipped.seen = 0
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(progress: [skipped])))
        let first = local.begin(now: noon)
        XCTAssertEqual(first.question?.key?.title, "w002")
        XCTAssertEqual(local.home(now: noon).overview?.count(.removed), 1)

        local.playing = nil
        let tomorrow = local.begin(now: noon.addingTimeInterval(86_400))
        XCTAssertNotEqual(tomorrow.sessionId, first.sessionId)
        XCTAssertEqual(local.sessions.first?.day, "2026-11-24")
    }
    // MARK: The path and its boss rounds

    /// The first stage (of five words, here) found: three known at first sight, two that took learning.
    private func firstStageFound() -> [VocabProgress] {
        (1...5).map { n in
            let known = n <= 3
            return VocabProgress(item: "w:w00\(n)", stage: known ? 3 : 1, dueOn: "2026-12-30", fast: known, firstSeenOn: "2026-11-20",
                                 lastSeenOn: "2026-11-21", lastCorrectOn: "2026-11-21", correctDays: 1, formsRight: ["syn1"], lastForm: "syn1",
                                 seen: known ? 1 : 3, rightCount: 1, wrongCount: known ? 0 : 2, dontknowCount: 0,
                                 masteredAt: known ? "2026-11-20T20:00:00.000Z" : nil, removedAt: nil)
        }
    }

    /// A stage is cleared once its words are all found, and then has a boss
    /// round on the ones that took learning. Winning it is kept, and goes up.
    func testAStageAndItsBoss() throws {
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(progress: firstStageFound())))
        local.stageSize = 5
        var path = local.path()
        XCTAssertEqual(path.stages.count, 28)
        XCTAssertTrue(path.stages[0].cleared)
        XCTAssertFalse(path.stages[0].gold)
        XCTAssertEqual(path.stages[0].boss, .ready)
        XCTAssertEqual(path.stages[1].boss, .locked)
        XCTAssertEqual(path.current?.number, 2)

        // Only the two that took learning: a word known at first sight is never asked again.
        var state = try XCTUnwrap(local.beginBoss(stage: 1, now: noon))
        XCTAssertEqual(state.question?.total, 2)
        XCTAssertEqual(state.question?.allowDontKnow, false)
        XCTAssertEqual(state.boss?.hitsLeft, 2)
        state = try XCTUnwrap(local.answer(session: state.sessionId, position: 1, choice: state.question?.key?.correctIndex, ms: 4_000, now: noon))
        XCTAssertEqual(state.boss?.hitsLeft, 1)
        // Still being played: the website doesn't hear of it yet.
        XCTAssertTrue(local.sending().sessions.isEmpty)
        XCTAssertTrue(local.sending().answers.isEmpty)
        state = try XCTUnwrap(local.answer(session: state.sessionId, position: 2, choice: state.question?.key?.correctIndex, ms: 4_000, now: noon))
        XCTAssertEqual(state.summary?.boss?.beaten, true)

        path = local.path()
        XCTAssertEqual(path.stages[0].boss, .beaten)
        let sent = local.sending()
        XCTAssertEqual(sent.sessions.map(\.boss), [1])
        XCTAssertEqual(sent.answers.count, 2)
        // Its time counts toward the day like any other session's.
        XCTAssertEqual(local.home(now: noon).overview?.day?.ms, 8_000)

        // Still beaten once the website's copy of the session is all there is.
        local.took(sent, reply: try reply(to: sent, from: local))
        XCTAssertEqual(local.path().stages[0].boss, .beaten)
        XCTAssertEqual(try XCTUnwrap(VocabLocal.load(from: folder)).sessions.first?.boss, 1)
    }

    /// A boss round is one go: left part-way it's over and not won, and
    /// today's ordinary session doesn't pick it up.
    func testABossLeftPartWay() throws {
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(progress: firstStageFound())))
        local.stageSize = 5
        var state = try XCTUnwrap(local.beginBoss(stage: 1, now: noon))
        let boss = state.sessionId
        state = try XCTUnwrap(local.answer(session: boss, position: 1, choice: state.question?.key?.correctIndex, ms: 4_000, now: noon))
        XCTAssertEqual(state.question?.position, 2)

        let session = local.begin(now: noon)
        XCTAssertNotEqual(session.sessionId, boss)
        XCTAssertEqual(session.question?.total, 5)
        XCTAssertNil(session.boss)
        XCTAssertEqual(local.path().stages[0].boss, .ready)
        XCTAssertEqual(local.sending().sessions.first { $0.id == boss }?.isFinished, true)

        // It takes every one right: the first miss ends the round, lost.
        var second = try XCTUnwrap(local.beginBoss(stage: 1, now: noon))
        XCTAssertEqual(second.boss?.needed, 2)
        let wrong = (0..<4).first { $0 != second.question?.key?.correctIndex }
        second = try XCTUnwrap(local.answer(session: second.sessionId, position: 1, choice: wrong, ms: 4_000, now: noon))
        XCTAssertNil(second.question)
        XCTAssertEqual(second.summary?.boss?.beaten, false)
        XCTAssertEqual(local.path().stages[0].boss, .ready)

        // One opened and never answered was never played.
        _ = try XCTUnwrap(local.beginBoss(stage: 1, now: noon))
        local.endBosses(now: noon)
        XCTAssertEqual(local.sessions.filter { $0.boss != nil }.count, 2)
    }

    /// A stage whose words were all known at first sight has no boss, and a
    /// session's end says how far it took them along the stage it started in.
    func testTheClimb() throws {
        let known = firstStageFound().map { p -> VocabProgress in
            var p = p
            p.stage = 3
            p.fast = true
            return p
        }
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(progress: known)))
        local.stageSize = 5
        XCTAssertEqual(local.path().stages[0].boss, VocabStage.Boss.none)
        XCTAssertTrue(local.path().stages[0].gold)
        XCTAssertNil(local.beginBoss(stage: 1, now: noon))

        var state = local.begin(now: noon)
        var position = 1
        while let question = state.question {
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: position, choice: question.key?.correctIndex, ms: 5_000, now: noon))
            position += 1
        }
        let climb = try XCTUnwrap(state.summary?.climb)
        XCTAssertEqual(climb.stage.number, 2)
        XCTAssertEqual(climb.metBefore, 0)
        XCTAssertEqual(climb.found, climb.stage.met)
        XCTAssertGreaterThan(climb.found, 0)
    }
    /// Gold is kept once earned: a miss sends the word back to practice, not the stage back to green.
    /// And a session's questions carry the stage they're on, and where a review word is from.
    func testGoldIsKept() throws {
        let known = firstStageFound().map { p -> VocabProgress in
            var p = p
            p.stage = 3
            // One of them learned here and due again, so it comes up as a review.
            if p.item == "w:w004" { p.dueOn = "2026-11-23" } else { p.fast = true }
            return p
        }
        // Its boss is beaten, so nothing's in the way of the next stage.
        var won = VocabLocalSession(id: "00000000-0000-0000-0000-0000000000b1", day: "2026-11-22", total: 1, limitMs: 15_000,
                                    noDontKnow: true, startedAt: "2026-11-22T20:00:00.000Z")
        won.answered = 1
        won.correct = 1
        won.finishedAt = "2026-11-22T20:01:00.000Z"
        won.boss = 1
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(progress: known, sessions: [won])))
        local.stageSize = 5
        XCTAssertTrue(local.path().stages[0].gold)
        XCTAssertEqual(local.path().stages[0].boss, .beaten)

        var state = local.begin(now: noon)
        XCTAssertEqual(state.stage?.number, 2)
        var position = 1
        var sawReview = false
        while let question = state.question {
            let review = question.from == "Trailhead"
            sawReview = sawReview || review
            XCTAssertEqual(question.from != nil, review)
            // The review is missed; the rest are right.
            let choice = review ? nil : question.key?.correctIndex
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: position, choice: choice, ms: 5_000, now: noon))
            position += 1
        }
        XCTAssertTrue(sawReview)
        let stage = local.path().stages[0]
        XCTAssertEqual(stage.mastered, 4)
        XCTAssertTrue(stage.gold)
        // Still gold when the app's opened again.
        XCTAssertTrue(try XCTUnwrap(VocabLocal.load(from: folder)).path().stages[0].gold)
    }
    /// A boss waiting is a gate: sessions are reviews only until it's beaten.
    /// After it's got away three times they can go on without it.
    func testTheBossIsAGate() throws {
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(progress: firstStageFound())))
        local.stageSize = 5
        XCTAssertEqual(local.path().bossReady?.number, 1)

        // No new words while it's in the way (word parts still come).
        var state = local.begin(now: noon)
        XCTAssertEqual(state.stage?.number, 1)
        var position = 1
        while let question = state.question {
            if question.kind != .part { XCTAssertFalse(question.isNew) }
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: position, choice: question.key?.correctIndex, ms: 3_000, now: noon))
            position += 1
        }
        XCTAssertEqual(state.summary?.bossWaiting, 1)

        // Lost three times (two questions: no miss allowed), it stops being a gate.
        for round in 1...3 {
            var boss = try XCTUnwrap(local.beginBoss(stage: 1, now: noon))
            let wrong = (0..<4).first { $0 != boss.question?.key?.correctIndex }
            boss = try XCTUnwrap(local.answer(session: boss.sessionId, position: 1, choice: wrong, ms: 3_000, now: noon))
            XCTAssertEqual(boss.summary?.boss?.fails, round)
            XCTAssertEqual(boss.summary?.boss?.canSkip, round == 3)
        }
        XCTAssertEqual(local.path().stages[0].boss, .skipped)
        XCTAssertNil(local.path().bossReady)
        state = local.begin(now: noon)
        XCTAssertEqual(state.stage?.number, 2)
        var sawNew = false
        position = 1
        while let question = state.question {
            sawNew = sawNew || (question.isNew && question.kind != .part)
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: position, choice: question.key?.correctIndex, ms: 3_000, now: noon))
            position += 1
        }
        XCTAssertTrue(sawNew)
        // The crown's still there to win.
        XCTAssertNotNil(local.beginBoss(stage: 1, now: noon))
    }

    /// A round of five or more allows one miss; the second ends it.
    func testOneMissAllowed() throws {
        let learned = firstStageFound().map { p -> VocabProgress in
            var p = p
            p.stage = 1
            p.fast = false
            return p
        }
        let local = try XCTUnwrap(VocabLocal.start(in: folder, with: pack(progress: learned)))
        local.stageSize = 5
        var state = try XCTUnwrap(local.beginBoss(stage: 1, now: noon))
        XCTAssertEqual(state.boss?.total, 5)
        XCTAssertEqual(state.boss?.needed, 4)
        for position in 1...5 {
            let right = state.question?.key?.correctIndex
            let choice = position == 2 ? (0..<4).first { $0 != right } : right
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: position, choice: choice, ms: 3_000, now: noon))
            if position == 2 { XCTAssertEqual(state.boss?.sparesLeft, 0) }
        }
        XCTAssertEqual(state.summary?.boss?.beaten, true)

        // Two misses: over at the second.
        state = try XCTUnwrap(local.beginBoss(stage: 1, now: noon))
        for position in 1...2 {
            let wrong = (0..<4).first { $0 != state.question?.key?.correctIndex }
            state = try XCTUnwrap(local.answer(session: state.sessionId, position: position, choice: wrong, ms: 3_000, now: noon))
        }
        XCTAssertNil(state.question)
        XCTAssertEqual(state.summary?.boss?.beaten, false)
    }
}
