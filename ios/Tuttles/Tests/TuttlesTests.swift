import XCTest
@testable import Tuttles

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
