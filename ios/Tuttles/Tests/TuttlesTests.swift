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
