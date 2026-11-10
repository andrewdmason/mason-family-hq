import XCTest


final class NoteEditingTests: XCTestCase {
    private let style = NoteStyle(size: 14, accent: .systemBlue, indent: 22)

    private func storage(_ html: String) -> NSMutableAttributedString {
        NoteEditing.attributed(NotesHTML.parse(html)!, style: style)
    }

    private func html(_ text: NSAttributedString) -> String {
        NotesHTML.serialize(NoteEditing.document(from: text))
    }

    /// Types one character at a time, as a text view would.
    private func type(_ characters: String, into text: NSMutableAttributedString, at start: Int? = nil) -> Int {
        var caret = start ?? text.length
        var plainNext = false
        for character in characters {
            let piece = String(character)
            if let edit = NoteEditing.typing(piece, at: NSRange(location: caret, length: 0), in: text, style: style) {
                NoteEditing.apply(edit, to: text, style: style)
                caret = edit.selection.location
                plainNext = edit.clearsTypingMarks
            } else {
                var attributes = NoteEditing.typingAttributes(in: text, at: caret, style: style)
                if plainNext { attributes = style.attributes(NoteEditing.paragraph(at: caret, in: text).kind) }
                plainNext = false
                text.replaceCharacters(in: NSRange(location: caret, length: 0), with: NSAttributedString(string: piece, attributes: attributes))
                caret += 1
                NoteEditing.normalize(text, around: NSRange(location: caret - 1, length: 1), caret: caret, style: style)
            }
        }
        return caret
    }

    // MARK: The website's HTML survives, byte for byte

    func testRoundTrips() {
        let notes = [
            "<p>One &amp; two</p><p></p><p>Three</p>",
            "<p>Line<br>break</p>",
            "<h1>A</h1><h2>B</h2><h3>C</h3>",
            "<p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p>",
            "<p><strong><em>both</em></strong></p>",
            #"<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://a.com/x?y=1&amp;z=2">the doc</a></p>"#,
            "<ul><li><p>a</p></li><li><p>b</p><ul><li><p>c</p></li></ul></li></ul>",
            "<ol><li><p>one</p></li><li><p>two</p><ul><li><p>under</p></li></ul></li></ol>",
            #"<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>todo</p></div></li><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p><ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>nested</p></div></li></ul></div></li></ul>"#,
            "<blockquote><p>quoted</p><p>more</p></blockquote>",
            "<pre><code>let a = 1 &lt; 2\n\nnext</code></pre>",
            "<p>before</p><hr><p>after</p>",
        ]
        for note in notes {
            XCTAssertEqual(html(storage(note)), note)
        }
    }

    func testPlainWebsiteLinksAreUnderstood() {
        XCTAssertNotNil(NotesHTML.parse(#"<p>see <a href="https://a.com/x">https://a.com/x</a></p>"#))
    }

    func testEmptyIsEmpty() {
        XCTAssertEqual(NotesHTML.serialize(NoteDocument()), "")
        XCTAssertEqual(html(storage("<p></p>")), "")
        XCTAssertEqual(NotesHTML.parse(nil), NoteDocument())
    }

    func testWhatIsNotUnderstoodIsNotEditable() {
        XCTAssertNil(NotesHTML.parse("<table><tr><td>x</td></tr></table>"))
        XCTAssertNil(NotesHTML.parse("<ul><li><p>a</p><p>b</p></li></ul>"))
        XCTAssertNil(NotesHTML.parse("<p>unclosed"))
        XCTAssertFalse(NoteEditing.display("<table></table>", style: style).editable)
    }

    func testOnlySafeLinksAreWritten() {
        let document = NoteDocument(lines: [NoteLine(runs: [NoteRun(text: "x", link: "javascript:alert(1)")])])
        XCTAssertEqual(NotesHTML.serialize(document), "<p>x</p>")
    }

    func testOldPlainFilesBecomeHTMLOnce() throws {
        let old = #"{"tasks":[{"id":"a","title":"T","notes":"one <b>\ntwo","bucket":"today","assignee_email":"a","creator_email":"a","sort_order":1,"created_at":"x"}],"projects":[],"sections":[]}"#
        let library = try TodoStore.decode(Data(old.utf8))
        XCTAssertEqual(library.tasks[0].notes, "<p>one &lt;b&gt;</p><p>two</p>")
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        XCTAssertEqual(try TodoStore.decode(encoder.encode(library)).tasks[0].notes, library.tasks[0].notes)
    }

    // MARK: Typing

    func testBlockShortcuts() {
        let cases: [(String, String)] = [
            ("# Hi", "<h1>Hi</h1>"), ("## Hi", "<h2>Hi</h2>"), ("### Hi", "<h3>Hi</h3>"),
            ("- a", "<ul><li><p>a</p></li></ul>"), ("* a", "<ul><li><p>a</p></li></ul>"),
            ("1. a", "<ol><li><p>a</p></li></ol>"), ("> a", "<blockquote><p>a</p></blockquote>"),
            ("``` a", "<pre><code>a</code></pre>"),
        ]
        for (typed, expected) in cases {
            let text = NSMutableAttributedString()
            _ = type(typed, into: text)
            XCTAssertEqual(html(text), expected, typed)
        }
        let task = NSMutableAttributedString()
        _ = type("[] a", into: task)
        XCTAssertTrue(html(task).contains(#"data-checked="false""#))
        XCTAssertTrue(html(task).contains("<p>a</p>"))
    }

    func testInlineShortcuts() {
        let cases: [(String, String)] = [
            ("x **b** y", "<p>x <strong>b</strong> y</p>"), ("x *i* y", "<p>x <em>i</em> y</p>"),
            ("x _i_ y", "<p>x <em>i</em> y</p>"), ("x ~~s~~ y", "<p>x <s>s</s> y</p>"),
            ("x `c` y", "<p>x <code>c</code> y</p>"), ("2 * 3 * 4", "<p>2 * 3 * 4</p>"), ("snake_case_name", "<p>snake_case_name</p>"),
        ]
        for (typed, expected) in cases {
            let text = NSMutableAttributedString()
            _ = type(typed, into: text)
            XCTAssertEqual(html(text), expected, typed)
        }
    }

    func testEnterContinuesAndEndsLists() {
        let text = NSMutableAttributedString()
        _ = type("- a\nb\n\nc", into: text)
        XCTAssertEqual(html(text), "<ul><li><p>a</p></li><li><p>b</p></li></ul><p>c</p>")
    }

    func testEmptyBulletAtTheVeryEndStaysABullet() {
        let text = NSMutableAttributedString()
        _ = type("- a\n", into: text)
        let last = NoteEditing.paragraph(at: text.length, in: text)
        XCTAssertEqual(last.kind, .list(path: [.bullet], checked: false))
        XCTAssertTrue(last.isEmpty)
    }

    func testCheckedItemsStartUnchecked() {
        let text = NSMutableAttributedString()
        _ = type("[x] a\nb", into: text)
        XCTAssertTrue(html(text).contains(#"data-checked="true""#))
        XCTAssertTrue(html(text).contains(#"data-checked="false""#))
    }

    func testBackspaceAtTheStartOfALine() {
        let text = storage("<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>")
        let line = NoteEditing.paragraph(at: text.length, in: text)
        let out = NoteEditing.typing("", at: NSRange(location: line.range.location, length: 1), in: text, style: style)!
        NoteEditing.apply(out, to: text, style: style)
        XCTAssertEqual(html(text), "<ul><li><p>a</p></li><li><p>b</p></li></ul>")
        let top = NoteEditing.paragraph(at: text.length, in: text)
        let lifted = NoteEditing.typing("", at: NSRange(location: top.range.location, length: 1), in: text, style: style)!
        NoteEditing.apply(lifted, to: text, style: style)
        XCTAssertEqual(html(text), "<ul><li><p>a</p></li></ul><p>b</p>")
    }

    func testDivider() {
        let text = NSMutableAttributedString()
        _ = type("---", into: text)
        XCTAssertEqual(html(text), "<hr>")
        XCTAssertTrue(text.string.hasSuffix("\n"))
        _ = type("after", into: text)
        XCTAssertEqual(html(text), "<hr><p>after</p>")
    }

    func testAddressesLinkOnceFinished() {
        let text = NSMutableAttributedString()
        _ = type("see https://a.com/x. ok", into: text)
        XCTAssertTrue(html(text).contains(#"href="https://a.com/x""#))
        XCTAssertTrue(html(text).contains(">https://a.com/x</a>. ok"))
    }

    func testCodeLinesKeepMarkdownLiteral() {
        let text = NSMutableAttributedString()
        _ = type("``` **a**\n- b", into: text)
        XCTAssertEqual(html(text), "<pre><code>**a**\n- b</code></pre>")
    }

    // MARK: Commands

    func testIndentNeedsAnItemAbove() {
        let text = storage("<ul><li><p>a</p></li><li><p>b</p></li></ul>")
        let first = NSRange(location: 1, length: 0)
        XCTAssertNil(NoteEditing.indent(first, in: text, style: style))
        let second = NSRange(location: text.length, length: 0)
        NoteEditing.apply(NoteEditing.indent(second, in: text, style: style)!, to: text, style: style)
        XCTAssertEqual(html(text), "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>")
        NoteEditing.apply(NoteEditing.outdent(NSRange(location: text.length, length: 0), in: text, style: style)!, to: text, style: style)
        XCTAssertEqual(html(text), "<ul><li><p>a</p></li><li><p>b</p></li></ul>")
    }

    func testToggleBold() {
        let text = storage("<p>word</p>")
        let all = NSRange(location: 0, length: 4)
        NoteEditing.apply(NoteEditing.toggle(.bold, selection: all, in: text, style: style)!, to: text, style: style)
        XCTAssertEqual(html(text), "<p><strong>word</strong></p>")
        NoteEditing.apply(NoteEditing.toggle(.bold, selection: all, in: text, style: style)!, to: text, style: style)
        XCTAssertEqual(html(text), "<p>word</p>")
    }

    func testSetBlockTogglesOff() {
        let text = storage("<p>a</p>")
        NoteEditing.apply(NoteEditing.setBlock(.heading(2), selection: NSRange(location: 1, length: 0), in: text, style: style), to: text, style: style)
        XCTAssertEqual(html(text), "<h2>a</h2>")
        NoteEditing.apply(NoteEditing.setBlock(.heading(2), selection: NSRange(location: 2, length: 0), in: text, style: style), to: text, style: style)
        XCTAssertEqual(html(text), "<p>a</p>")
    }

    func testTickingACheckbox() {
        let text = storage(#"<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>a</p></div></li></ul>"#)
        NoteEditing.apply(NoteEditing.toggleChecked(at: 0, selection: NSRange(location: 2, length: 0), in: text, style: style)!, to: text, style: style)
        XCTAssertTrue(html(text).contains(#"data-checked="true""#))
    }

    func testCursorStepsOverAnchors() {
        let text = storage("<p>a</p><ul><li><p>b</p></li></ul>")
        // "a\n" then the anchor at 2. Going left from after it lands on the line above.
        XCTAssertEqual(NoteEditing.adjustedSelection(old: NSRange(location: 3, length: 0), proposed: NSRange(location: 2, length: 0), in: text).location, 1)
        XCTAssertEqual(NoteEditing.adjustedSelection(old: NSRange(location: 1, length: 0), proposed: NSRange(location: 2, length: 0), in: text).location, 3)
    }

    // MARK: Pasting

    func testPastedMarkdown() {
        let text = NSMutableAttributedString()
        let pasted = "# Title\n\n- one\n  - two\n1. **three**\n\n[a](https://a.com) and text"
        NoteEditing.apply(NoteEditing.paste(pasted, selection: NSRange(location: 0, length: 0), in: text, style: style), to: text, style: style)
        let result = html(text)
        XCTAssertTrue(result.hasPrefix("<h1>Title</h1><ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul><ol><li><p><strong>three</strong></p></li></ol>"), result)
        XCTAssertTrue(result.contains(">a</a> and text</p>"), result)
    }

    func testPastedAddressLinksTheSelection() {
        let text = storage("<p>the doc</p>")
        let edit = NoteEditing.paste("https://a.com", selection: NSRange(location: 4, length: 3), in: text, style: style)
        NoteEditing.apply(edit, to: text, style: style)
        XCTAssertTrue(html(text).contains(#"href="https://a.com">doc</a>"#), html(text))
    }

    func testPastedAddressGetsItsTitleWhenStillThere() {
        let text = NSMutableAttributedString()
        NoteEditing.apply(NoteEditing.paste("https://a.com", selection: NSRange(location: 0, length: 0), in: text, style: style), to: text, style: style)
        let edit = NoteEditing.titleSwap(address: "https://a.com", title: "A Site", in: text, selection: NSRange(location: text.length, length: 0), style: style)!
        NoteEditing.apply(edit, to: text, style: style)
        XCTAssertTrue(html(text).contains(#"href="https://a.com/">A Site</a>"#) || html(text).contains(#"href="https://a.com">A Site</a>"#), html(text))
        XCTAssertNil(NoteEditing.titleSwap(address: "https://a.com", title: "x", in: storage("<p>gone</p>"), selection: NSRange(location: 0, length: 0), style: style))
    }

    func testPageTitles() {
        XCTAssertEqual(LinkTitle.title(inHTML: "<html><title lang=en>\n A &amp; B\n</title></html>"), "A & B")
        XCTAssertNil(LinkTitle.title(inHTML: "<html></html>"))
    }
}
