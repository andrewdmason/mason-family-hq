import UniformTypeIdentifiers
import XCTest
@testable import Tuttles

final class AttachmentTests: XCTestCase {
    /// What's picked, dropped or pasted (the Mac's ways in, and the phone's
    /// Files picker) stops at four files and says why.
    func testAddingStopsAtFourFiles() {
        var photos: [ChatPhoto] = []
        var files: [ChatFile] = []
        let picks: [() throws -> PickedFile] = (0..<5).map { n in
            { .file(ChatFile(path: "folder/\(n).pdf", name: "\(n).pdf", pages: 1)) }
        }
        let (added, problem) = PickedFile.add(picks, photos: &photos, files: &files)
        XCTAssertTrue(added)
        XCTAssertEqual(files.count, ChatFile.maxAtOnce)
        XCTAssertEqual(problem, .tooMany)
        XCTAssertTrue(photos.isEmpty)
    }

    func testAnUnreadableFileIsReportedAndTheRestGoIn() {
        var photos: [ChatPhoto] = []
        var files: [ChatFile] = []
        let picks: [() throws -> PickedFile] = [
            { try PickedFile(name: "notes.txt", type: .plainText, data: Data("hello".utf8)) },
            { .file(ChatFile(path: "folder/a.pdf", name: "a.pdf", pages: 2)) },
        ]
        let (added, problem) = PickedFile.add(picks, photos: &photos, files: &files)
        XCTAssertTrue(added)
        XCTAssertEqual(files.map(\.name), ["a.pdf"])
        XCTAssertEqual(problem, .unreadable)
    }
}

final class MessageBlocksTests: XCTestCase {
    func testVisualListAndMath() {
        let text = """
        A **mapping diagram** shows inputs.

        - Put the $x$-values left.
        - Put the $y$-values right.

        ```visual
        {"type":"mapping","inputs":[1],"outputs":[3],"arrows":[[1,3]]}
        ```

        $$\\{(-2,-4),(0,0)\\},$$
        """
        let blocks = MessageBlocks.parse(text)
        XCTAssertEqual(blocks.count, 4)
        XCTAssertEqual(blocks[0], .paragraph("A **mapping diagram** shows inputs."))
        guard case .bullets(let items) = blocks[1] else { return XCTFail("\(blocks[1])") }
        XCTAssertEqual(items.map(\.text), ["Put the $x$-values left.", "Put the $y$-values right."])
        guard case .visual = blocks[2] else { return XCTFail("\(blocks[2])") }
        XCTAssertEqual(blocks[3], .math("\\{(-2,-4),(0,0)\\},"))
    }

    func testQuizQuestionAndStudySetBlocks() {
        let text = """
        Warm-up:

        ```question
        {"id":"q1","number":1,"of":10,"topic":"Cells","kind":"choice","prompt":"Which makes proteins?","choices":["Mitochondria","Ribosome"]}
        ```

        ```studyset
        {"id":"s1","title":"Science quiz"}
        ```
        """
        let blocks = MessageBlocks.parse(text)
        XCTAssertEqual(blocks.count, 3)
        guard case .question(let json) = blocks[1] else { return XCTFail("\(blocks[1])") }
        let q = QuizQuestion(block: json)
        XCTAssertEqual(q?.number, 1)
        XCTAssertEqual(q?.choices?.count, 2)
        XCTAssertEqual(q?.isChoice, true)
        XCTAssertNil(q?.answerIndex, "a saved question carries no answer")
        guard case .studySet = blocks[2] else { return XCTFail("\(blocks[2])") }
    }

    @MainActor func testOpenQuestionIsTheUnansweredLast() {
        let state = DemoChats.quizState(QuizStart(setID: "demo-cells", setTitle: "Cells"))
        XCTAssertEqual(state.open?.id, "q2")
        XCTAssertEqual(state.answeredCount, 1)
        let context = QuizContext()
        context.state = state
        XCTAssertTrue(context.canAnswer(state.questions[1]))
        XCTAssertFalse(context.canAnswer(state.questions[0]), "an answered question takes no more taps")
    }

    func testUnclosedVisualWaitsWhileStreaming() {
        let blocks = MessageBlocks.parse("Here:\n\n```visual\n{\"type\":\"mapping\"")
        XCTAssertEqual(blocks, [.paragraph("Here:")])
    }

    func testNumberedListSpansBlankLinesAndNestedBullets() {
        let blocks = MessageBlocks.parse("1. One\n\n2. Two\n   - detail\n3. Three\n\nAfter.")
        guard case .numbered(let items) = blocks[0] else { return XCTFail("\(blocks)") }
        XCTAssertEqual(items.map(\.text), ["One", "Two", "detail", "Three"])
        XCTAssertEqual(items.map(\.depth), [0, 0, 1, 0])
        XCTAssertEqual(blocks[1], .paragraph("After."))
    }

    func testTable() {
        let blocks = MessageBlocks.parse("| x | y |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |")
        XCTAssertEqual(blocks, [.table(header: ["x", "y"], rows: [["1", "2"], ["3", "4"]])])
    }

    func testInlineMathAndDollars() {
        XCTAssertEqual(InlineRun.split("a $x$ b \\(y\\)"), [.text("a "), .math("x"), .text(" b "), .math("y")])
        XCTAssertEqual(InlineRun.split("costs $5 or $ 6"), [.text("costs $5 or $ 6")])
    }
}

final class ExpressionTests: XCTestCase {
    func testGrammar() {
        XCTAssertEqual(Expression.parse("2*x+1")?.value(at: 3), 7)
        XCTAssertEqual(Expression.parse("2x^2 - 3")?.value(at: 2), 5)
        XCTAssertEqual(Expression.parse("-x^2")?.value(at: 3), -9)
        XCTAssertEqual(Expression.parse("Math.sqrt(x)")?.value(at: 9), 3)
        XCTAssertEqual(Expression.parse("x**3")?.value(at: 2), 8)
        XCTAssertEqual(Expression.parse("3(x+1)")?.value(at: 1), 6)
        XCTAssertNil(Expression.parse("alert(1)"))
        XCTAssertNil(Expression.parse("x +"))
    }
}

final class ReplyDecoderTests: XCTestCase {
    func testSplitCharacterAndErrorTail() {
        var d = ReplyDecoder()
        let bytes = Array("Où — fine\n\n[error: The tutor stopped]".utf8)
        for b in bytes { _ = d.append(b) }
        XCTAssertEqual(d.reply, "Où — fine")
        XCTAssertEqual(d.error, "The tutor stopped")
    }

    func testCleanReply() {
        var d = ReplyDecoder()
        d.append(Data("Not quite. $x$".utf8))
        XCTAssertEqual(d.reply, "Not quite. $x$")
        XCTAssertNil(d.error)
    }
}

final class SpokenCaptionTests: XCTestCase {
    func testPagesBreakAtSentencesAndNeverSplitWords() {
        let text = "Not quite. The domain should include every x value used on the graph. "
            + "So that's the x values from the segment. What do you get when you list them?"
        let words = SpokenCaption.words(text)
        let pages = SpokenCaption.pages(words)
        XCTAssertEqual(pages.first?.lowerBound, 0)
        XCTAssertEqual(pages.last?.upperBound, words.count)
        for (a, b) in zip(pages, pages.dropFirst()) { XCTAssertEqual(a.upperBound, b.lowerBound) }
        for page in pages.dropLast() {
            XCTAssertTrue(words[page.upperBound - 1].hasSuffix(".") || words[page].joined(separator: " ").count > 100)
        }
    }

    @MainActor func testCaptionFromTheChatsLastReply() {
        let reply = "**Nice!** So $x = \\frac{3}{4}$ works.\n\n```visual\n{\"type\":\"math\",\"latex\":\"x\"}\n```\n\n- Check it by plugging back in."
        XCTAssertEqual(VoiceCall.plain(MessageBlocks.parse(reply)), "Nice! So x = 3/4 works. Check it by plugging back in.")
    }

    func testVisualArgumentAsStringOrObject() {
        XCTAssertEqual(VoiceCall.visual(from: #"{"visual":"{\"type\":\"math\",\"latex\":\"x\"}"}"#), #"{"type":"math","latex":"x"}"#)
        XCTAssertNotNil(VoiceCall.visual(from: #"{"visual":{"type":"math","latex":"x"}}"#))
        XCTAssertNil(VoiceCall.visual(from: "nonsense"))
    }

    func testReconnectRecap() {
        let turns = [
            VoiceCall.Turn(id: "u1", role: "user", text: "What's 3 times 4?"),
            VoiceCall.Turn(id: "a1", role: "assistant", text: "Let's count it out.", visuals: ["{}"]),
            VoiceCall.Turn(id: "p1", role: "user", images: ["x/y.jpg"]),
            VoiceCall.Turn(id: "e1", role: "assistant"),
        ]
        let recap = VoiceCall.recap(turns, readings: ["p1": "Problem 2: 5 x 6"], midTurn: false)
        XCTAssertTrue(recap.contains("Student: What's 3 times 4?"))
        XCTAssertTrue(recap.contains("You: Let's count it out. (put a picture on their screen)"))
        XCTAssertTrue(recap.contains("Student: (sent a photo, which shows: Problem 2: 5 x 6)"))
        XCTAssertFalse(recap.contains("You: \n"))
        XCTAssertTrue(recap.contains("Don't start talking"))
        XCTAssertTrue(VoiceCall.recap([], readings: [:], midTurn: true).contains("Nothing had been said yet"))
    }
}

final class FamilyKidTests: XCTestCase {
    private func kids(_ json: String) throws -> [FamilyKid] {
        try JSONDecoder().decode([FamilyKid].self, from: Data(json.utf8))
    }

    func testOwnPhoneFromTheWebsite() throws {
        let list = try kids("""
        [{"id":"00000000-0000-0000-0000-00000000000a","name":"Oscar","mode":"own","ownPhone":false},
         {"id":"00000000-0000-0000-0000-00000000000b","name":"Sebastian","mode":"own","ownPhone":true}]
        """)
        XCTAssertEqual(list.map(\.ownPhone), [false, true])
    }

    /// A kid list saved by a build that previewed the kid with a phone.
    func testOwnPhoneFromASavedPreview() throws {
        let list = try kids("""
        [{"id":"00000000-0000-0000-0000-00000000000a","name":"Oscar","mode":"own"},
         {"id":"00000000-0000-0000-0000-00000000000b","name":"Sebastian","mode":"preview"}]
        """)
        XCTAssertEqual(list.map(\.ownPhone), [false, true])
    }
}

final class ChatFileTests: XCTestCase {
    private func pdf(pages: Int) -> Data {
        UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 200, height: 200)).pdfData { context in
            for page in 0..<pages {
                context.beginPage()
                ("Page \(page + 1)" as NSString).draw(at: CGPoint(x: 20, y: 20), withAttributes: nil)
            }
        }
    }

    func testAPDFBecomesAFileWithItsPageCount() throws {
        let file = try ChatFile(name: "Study guide.pdf", pdf: pdf(pages: 3))
        XCTAssertEqual(file.name, "Study guide.pdf")
        XCTAssertEqual(file.pages, 3)
        XCTAssertEqual(file.detail, "PDF · 3 pages")
        XCTAssertEqual(try ChatFile(name: "Handout", pdf: pdf(pages: 1)).name, "Handout.pdf")
        XCTAssertEqual(try ChatFile(name: "Handout", pdf: pdf(pages: 1)).detail, "PDF · 1 page")
    }

    func testALongPDFIsTurnedAway() {
        XCTAssertNoThrow(try ChatFile(name: "a.pdf", pdf: pdf(pages: ChatFile.maxPages)))
        XCTAssertThrowsError(try ChatFile(name: "a.pdf", pdf: pdf(pages: ChatFile.maxPages + 1))) {
            XCTAssertEqual($0 as? ChatFile.Problem, .tooLong)
        }
    }

    func testWhatIsntAPDFOrPictureIsTurnedAway() {
        XCTAssertThrowsError(try ChatFile(name: "a.pdf", pdf: Data("hello".utf8))) {
            XCTAssertEqual($0 as? ChatFile.Problem, .unreadable)
        }
        XCTAssertThrowsError(try PickedFile(name: "essay.docx", type: UTType(filenameExtension: "docx"), data: Data("PK".utf8))) {
            XCTAssertEqual($0 as? ChatFile.Problem, .unreadable)
        }
    }

    func testAPictureFromFilesIsAPhoto() throws {
        let png = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).pngData { $0.fill(CGRect(x: 0, y: 0, width: 40, height: 40)) }
        guard case .photo = try PickedFile(name: "shot.png", type: .png, data: png) else { return XCTFail("not a photo") }
        guard case .file(let file) = try PickedFile(name: "guide.pdf", type: .pdf, data: pdf(pages: 2)) else { return XCTFail("not a file") }
        XCTAssertEqual(file.pages, 2)
    }
}

final class VocabRulesTests: XCTestCase {
    private func row(_ title: String, _ status: VocabStatus, misses: Int = 0, trouble: Bool = false, rank: Int) -> VocabRow {
        VocabRow(id: "w:\(title)", title: title, pos: "adjective", meaning: "meaning of \(title)", example: nil, hook: "",
                 parts: [], status: status, dueOn: nil, seen: 0, right: 0, misses: misses, trouble: trouble, rank: rank)
    }

    /// The clock and the pace line read as the website's do (progress-bits.tsx).
    func testClockAndPace() {
        XCTAssertEqual(VocabRules.clock(600_000), "10:00")
        XCTAssertEqual(VocabRules.clock(59_999), "0:59")
        XCTAssertEqual(VocabRules.clock(-65_000), "1:05")
        XCTAssertEqual(VocabRules.pace(elapsedMs: 470_000, limitMs: 600_000), "2:10 to spare")
        XCTAssertEqual(VocabRules.pace(elapsedMs: 645_000, limitMs: 600_000), "0:45 over")
    }

    func testCountdown() {
        XCTAssertEqual(VocabRules.countdown(daysLeft: 52), "52 days until the ISEE")
        XCTAssertEqual(VocabRules.countdown(daysLeft: 1), "The ISEE is tomorrow")
        XCTAssertEqual(VocabRules.countdown(daysLeft: 0), "The ISEE is today")
        XCTAssertEqual(VocabRules.countdown(daysLeft: -3), "ISEE vocabulary practice")
    }

    /// Everything: trouble first, most missed on top, then the order words are met in; removed words left out.
    func testListOrderAndFilters() {
        let rows = [
            row("calm", .mastered, rank: 0),
            row("candid", .learning, misses: 2, trouble: true, rank: 3),
            row("idle", .removed, rank: 1),
            row("reluctant", .learning, misses: 3, trouble: true, rank: 5),
            row("abundant", .new, rank: 2),
        ]
        XCTAssertEqual(VocabRules.rows(rows, filter: .all, query: "").map(\.title), ["reluctant", "candid", "calm", "abundant"])
        XCTAssertEqual(VocabRules.rows(rows, filter: .removed, query: "").map(\.title), ["idle"])
        XCTAssertEqual(VocabRules.rows(rows, filter: .learning, query: "").map(\.title), ["candid", "reluctant"])
        XCTAssertEqual(VocabRules.rows(rows, filter: .all, query: " CAN ").map(\.title), ["candid"])
        XCTAssertEqual(VocabRules.rows(rows, filter: .all, query: "meaning of calm").map(\.title), ["calm"])
    }

    /// What the website sends decodes, with "Don't know" off on a test-day session.
    func testStateDecodes() throws {
        let json = #"""
        {"sessionId":"s1","elapsedMs":1200,"limitMs":600000,"noDontKnow":true,"summary":null,
         "question":{"position":3,"total":18,"kind":"sc","stem":"The ____ dog.","choices":["a","b","c","d"],"isNew":true,"allowDontKnow":false}}
        """#
        let state = try JSONDecoder().decode(VocabState.self, from: Data(json.utf8))
        XCTAssertEqual(state.question?.kind, .sc)
        XCTAssertEqual(state.question?.allowDontKnow, false)
        XCTAssertNil(state.summary)
        // An older website sends no key: the answer then waits for its word.
        XCTAssertNil(state.question?.key)
        XCTAssertNil(state.nextIfRight)
    }

    /// A day with more than one session: each numbered in the order it went,
    /// and from an older website, which tells only the latest, just that one.
    func testSessionsNumbered() throws {
        func overview(_ extra: String) throws -> VocabOverview {
            let json = #"""
            {"level":"lower","questions":18,"today":"2026-11-20","inProgress":{"answered":5,"total":18},"sessionsToday":2,
             "doneToday":{"elapsedMs":300000,"limitMs":600000,"correct":16,"total":18},
             "streak":1,"recentDays":[],"counts":{},"totalWords":499,"parts":{"met":4,"mastered":0,"total":54},"trouble":[],"accuracy":null
            """# + extra + "}"
            return try JSONDecoder().decode(VocabOverview.self, from: Data(json.utf8))
        }
        let now = try overview(#","sessionsDone":[{"elapsedMs":140000,"limitMs":600000,"correct":13,"total":18},{"elapsedMs":300000,"limitMs":600000,"correct":16,"total":18}]"#)
        XCTAssertEqual(now.finishedToday.map(\.number), [1, 2])
        XCTAssertEqual(now.finishedToday.map(\.done.correct), [13, 16])
        XCTAssertEqual(now.nextSession, 3)
        let older = try overview("")
        XCTAssertEqual(older.finishedToday.map(\.number), [2])
        XCTAssertEqual(older.finishedToday.first?.done.correct, 16)
        XCTAssertEqual(older.nextSession, 3)
    }

    /// The question that follows a right answer comes along with the one on screen.
    func testNextIfRightDecodes() throws {
        let json = #"""
        {"sessionId":"s1","elapsedMs":0,"limitMs":600000,"noDontKnow":false,"summary":null,
         "question":{"position":3,"total":18,"kind":"sc","stem":"The ____ dog.","choices":["a","b","c","d"],"isNew":true,"allowDontKnow":true},
         "nextIfRight":{"position":4,"total":18,"kind":"syn","stem":"CALM","choices":["e","f","g","h"],"isNew":false,"allowDontKnow":true}}
        """#
        let state = try JSONDecoder().decode(VocabState.self, from: Data(json.utf8))
        XCTAssertEqual(state.nextIfRight?.position, 4)
        XCTAssertEqual(state.nextIfRight?.stem, "CALM")
    }

    /// A question's key grades it on the phone as the website would (feedbackFor in src/lib/words/session.ts).
    func testKeyGrades() throws {
        let json = #"""
        {"position":1,"total":18,"kind":"syn","stem":"ABUNDANT","choices":["scarce","plentiful","abrupt","adequate"],
         "isNew":false,"allowDontKnow":true,
         "key":{"correctIndex":1,"whys":["The opposite.",null,"It only looks alike.",null],"masteredIfRight":true,
                "tip":"Think of plenty.","title":"abundant","pos":"adjective","meaning":"more than enough","example":null,
                "hook":"A bun dance.","parts":[{"part":"ab-","meaning":"away"}]}}
        """#
        let key = try XCTUnwrap(JSONDecoder().decode(VocabQuestion.self, from: Data(json.utf8)).key)

        let right = key.feedback(for: 1)
        XCTAssertEqual(right.result, "correct")
        XCTAssertTrue(right.mastered)
        XCTAssertNil(right.chosenWhy)
        XCTAssertEqual(right.parts.map(\.part), ["ab-"])

        let wrong = key.feedback(for: 0)
        XCTAssertEqual(wrong.result, "wrong")
        XCTAssertEqual(wrong.correctIndex, 1)
        XCTAssertEqual(wrong.chosenWhy, "The opposite.")
        XCTAssertFalse(wrong.mastered)
        // A wrong choice nobody wrote a note for.
        XCTAssertNil(key.feedback(for: 3).chosenWhy)

        let dontKnow = key.feedback(for: nil)
        XCTAssertEqual(dontKnow.result, "dontknow")
        XCTAssertNil(dontKnow.chosenWhy)
        XCTAssertFalse(dontKnow.mastered)
    }
}

final class ParentDashboardTests: XCTestCase {
    /// What /tuttles/api/parent/dashboard sends (src/lib/tuttles/dashboard.ts) reads in whole.
    func testDecodesTheWebsitesDashboard() throws {
        let json = """
        {"today":"2026-11-26","kids":[{"id":"k1","name":"Sebastian","level":"middle","totalWords":600,"mastered":42,
          "days":[{"day":"2026-11-26","vocabMs":650000,"vocabAnswered":35,"vocabCorrect":29,"vocabDone":true,"mathAnswered":2,"mathCorrect":1,"mastered":42}],
          "weeks":[{"start":"2026-11-20","vocabMs":650000,"vocabAnswered":35,"vocabCorrect":29,"vocabDaysDone":1,"mathAnswered":2,"mathCorrect":1,"masteredGained":3}],
          "practice":[{"id":"w:candid","title":"candid","kind":"word","pos":"adj","meaning":"honest","example":"A candid answer.","hook":"","status":"learning","misses":4,"reason":"trouble"}]}]}
        """
        let payload = try JSONDecoder().decode(DashboardPayload.self, from: Data(json.utf8))
        let kid = try XCTUnwrap(payload.kids.first)
        XCTAssertEqual(kid.days.first?.vocabMinutes ?? 0, 650_000 / 60_000.0, accuracy: 0.001)
        XCTAssertEqual(kid.weeks.first?.masteredGained, 3)
        XCTAssertEqual(kid.practice.map(\.title), ["candid"])
        XCTAssertEqual(Calendar.current.component(.day, from: DashboardDates.date("2026-11-26")), 26)
    }

    /// The demo's made-up four weeks hold together.
    func testDemoHasFourWeeks() {
        let payload = DemoDashboard.payload
        XCTAssertEqual(payload.kids.count, 2)
        XCTAssertTrue(payload.kids.allSatisfy { $0.days.count == 28 && $0.weeks.count == 4 })
    }

    /// The simulator opens in the demo unless it's asked for the real thing; a phone never does.
    @MainActor func testTheSimulatorOpensInTheDemo() {
        XCTAssertTrue(ChatStore.demo(launchedWith: ["Tuttles"], onSimulator: true))
        XCTAssertFalse(ChatStore.demo(launchedWith: ["Tuttles", "--live"], onSimulator: true))
        XCTAssertFalse(ChatStore.demo(launchedWith: ["Tuttles", "--website", "http://localhost:4000"], onSimulator: true))
        XCTAssertFalse(ChatStore.demo(launchedWith: ["Tuttles"], onSimulator: false))
        XCTAssertTrue(ChatStore.demo(launchedWith: ["Tuttles", "--demo"], onSimulator: false))
    }
}

final class ParentAsThemselvesTests: XCTestCase {
    /// A parent's own practice used to be a choice of its own ("me") beside
    /// the Parent Dashboard. A phone that saved either opens as the parent.
    @MainActor func testASavedMeIsTheParent() {
        XCTAssertEqual(ChatStore.viewer(saved: "me"), .parent)
        XCTAssertEqual(ChatStore.viewer(saved: "parent"), .parent)
        let kid = UUID()
        XCTAssertEqual(ChatStore.viewer(saved: kid.uuidString.lowercased()), .kid(kid))
        XCTAssertEqual(ChatStore.viewer(saved: "nobody"), .unchosen)
        XCTAssertEqual(ChatStore.viewer(saved: nil), .unchosen)
        XCTAssertEqual(ChatStore.viewer(saved: nil, parentView: true), .parent)
    }

    /// A parent's history is their briefings and the chats they've started
    /// since they had a view of their own: the plain ones from before were
    /// the kids', and one with no date (saved by an older build) waits.
    func testAParentsHistoryIsTheirBriefingsAndTheirOwnChats() {
        let since = ChatStore.parentChatsSince
        XCTAssertEqual(since.ISO8601Format(), "2026-11-26T22:00:00Z")
        func thread(_ title: String, _ created: Date?, kind: String? = nil) -> TutorThread {
            TutorThread(id: UUID(), title: title, updatedAt: .now, createdAt: created, kind: kind)
        }
        let threads = [
            thread("new chat", since.addingTimeInterval(60)),
            thread("old briefing", since.addingTimeInterval(-86_400), kind: "briefing"),
            thread("the kids', before", since.addingTimeInterval(-60)),
            thread("no date", nil),
            thread("new briefing", since.addingTimeInterval(120), kind: "briefing"),
        ]
        XCTAssertEqual(ChatStore.parentChats(in: threads).map(\.title), ["new chat", "old briefing", "new briefing"])
    }

    /// Only a parent's own places are theirs: the kids' Vocab, Math and
    /// houses, in the same menu, are not.
    func testOnlyAParentsOwnPlacesAreMine() {
        XCTAssertTrue([Route.myVocab, .myMath, .myHouse].allSatisfy(\.isMine))
        XCTAssertFalse([Route.vocab, .math, .house, .dashboard, .week, .study, .classes].contains(where: \.isMine))
    }
}
