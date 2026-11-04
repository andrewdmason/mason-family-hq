import XCTest

final class TodoMergeTests: XCTestCase {
    private func todo(_ id: String, _ title: String = "Title", notes: String? = nil, bucket: Bucket = .today) -> Todo {
        Todo(
            id: id, title: title, notes: notes, bucket: bucket, assigneeEmail: "a@mason.io", creatorEmail: "a@mason.io",
            projectId: nil, sectionId: nil, snoozedUntil: nil, completedAt: nil, sortOrder: 1,
            createdAt: "2026-11-01T00:00:00Z")
    }

    // MARK: What to send

    func testSendsOnlyTheFieldsChangedHere() {
        let changes = TodoMerge.changes(local: [todo("a", "New")], base: [todo("a", "Old")]) { _ in true }
        XCTAssertEqual(changes.updates["a"], ["title": .text("New")])
        XCTAssertTrue(changes.inserts.isEmpty)
        XCTAssertTrue(changes.deletes.isEmpty)
    }

    func testNewAndRemovedRecords() {
        let changes = TodoMerge.changes(local: [todo("new")], base: [todo("gone")]) { _ in true }
        XCTAssertNotNil(changes.inserts["new"])
        XCTAssertEqual(changes.deletes, ["gone"])
    }

    func testHoldsBackWhatsStillBeingTyped() {
        let changes = TodoMerge.changes(local: [todo("draft", "")], base: []) { !$0.title.isEmpty }
        XCTAssertTrue(changes.isEmpty)
    }

    func testNothingToSendWhenInStep() {
        XCTAssertTrue(TodoMerge.changes(local: [todo("a")], base: [todo("a")]) { _ in true }.isEmpty)
    }

    // MARK: What to take

    func testTakesAChangeMadeElsewhere() {
        let result = TodoMerge.merge(local: [todo("a", "Old")], base: [todo("a", "Old")], server: [todo("a", "Elsewhere")])
        XCTAssertEqual(result.local[0].title, "Elsewhere")
        XCTAssertTrue(result.changed)
    }

    func testAChangeHereWinsOnTheSameField() {
        let result = TodoMerge.merge(local: [todo("a", "Here")], base: [todo("a", "Old")], server: [todo("a", "Elsewhere")])
        XCTAssertEqual(result.local[0].title, "Here")
        XCTAssertEqual(result.base[0].title, "Elsewhere")
    }

    func testDifferentFieldsBothSurvive() {
        let result = TodoMerge.merge(
            local: [todo("a", "Here")], base: [todo("a", "Old")], server: [todo("a", "Old", bucket: .someday)])
        XCTAssertEqual(result.local[0].title, "Here")
        XCTAssertEqual(result.local[0].bucket, .someday)
    }

    func testAddedElsewhereArrives() {
        let result = TodoMerge.merge(local: [Todo](), base: [], server: [todo("a")])
        XCTAssertEqual(result.local.map(\.id), ["a"])
        XCTAssertTrue(result.changed)
    }

    func testDeletedElsewhereGoes() {
        let result = TodoMerge.merge(local: [todo("a")], base: [todo("a")], server: [])
        XCTAssertTrue(result.local.isEmpty)
        XCTAssertTrue(result.base.isEmpty)
    }

    func testDeletedHereDoesntComeBack() {
        let result = TodoMerge.merge(local: [Todo](), base: [todo("a")], server: [todo("a")])
        XCTAssertTrue(result.local.isEmpty)
        XCTAssertEqual(TodoMerge.changes(local: result.local, base: result.base) { _ in true }.deletes, ["a"])
    }

    func testNewHereStaysUntilSent() {
        let result = TodoMerge.merge(local: [todo("new")], base: [], server: [])
        XCTAssertEqual(result.local.map(\.id), ["new"])
        XCTAssertFalse(result.changed)
    }

    func testAlreadyInStepChangesNothing() {
        XCTAssertFalse(TodoMerge.merge(local: [todo("a")], base: [todo("a")], server: [todo("a")]).changed)
    }

    func testSendingThenReadingBackIsQuiet() {
        var base = [todo("a", "Old")]
        let local = [todo("a", "New")]
        let changes = TodoMerge.changes(local: local, base: base) { _ in true }
        TodoMerge.markSent("a", fields: changes.updates["a"]!, local: local, base: &base)
        XCTAssertTrue(TodoMerge.changes(local: local, base: base) { _ in true }.isEmpty)
        XCTAssertFalse(TodoMerge.merge(local: local, base: base, server: local).changed)
    }

    func testDeviceOnlyFieldsSurvive() {
        var area = TodoArea(id: "a", name: "Old", sortOrder: 1)
        area.isCollapsed = true
        let remote = TodoArea(id: "a", name: "New", sortOrder: 1)
        let result = TodoMerge.merge(local: [area], base: [TodoArea(id: "a", name: "Old", sortOrder: 1)], server: [remote])
        XCTAssertEqual(result.local[0].name, "New")
        XCTAssertEqual(result.local[0].isCollapsed, true)
    }

    // MARK: The first sync

    @MainActor
    func testFirstSyncThisDevicesListWins() {
        let older = todo("edited", "Old")
        var local = todo("edited", "Mine")
        local.bucket = .someday
        let store = TodoStore(
            library: TodoLibrary(
                tasks: [local, todo("noted"), todo("new here")], projects: [], sections: [],
                areas: [TodoArea(id: "mine", name: "Mine", sortOrder: 1)]),
            saveFile: nil)
        var base = TodoLibrary(tasks: [older, todo("noted"), todo("removed here")], projects: [], sections: [])
        var changedThere = todo("edited", "Changed on the website")
        changedThere.bucket = .today
        let server = TodoLibrary(
            tasks: [
                changedThere, todo("noted", notes: "From the website"), todo("removed here"), todo("never seen"),
            ],
            projects: [], sections: [], areas: [TodoArea(id: "theirs", name: "Theirs", sortOrder: 1)])

        store.prepareFirstSync(server: server, base: &base)
        let pending = store.pendingChanges(against: base)
        XCTAssertEqual(base.firstSyncDone, true)
        XCTAssertEqual(pending.tasks.updates["edited"]?["title"], .text("Mine"))
        XCTAssertEqual(pending.tasks.updates["edited"]?["bucket"], .text("someday"))
        XCTAssertNotNil(pending.tasks.inserts["new here"])
        XCTAssertEqual(pending.tasks.deletes, ["removed here"])
        XCTAssertEqual(pending.areas.deletes, ["theirs"])
        XCTAssertNotNil(pending.areas.inserts["mine"])
        XCTAssertNil(pending.tasks.updates["noted"], "a note on the website survives")
        XCTAssertEqual(store.todos.first { $0.id == "noted" }?.notes, "From the website")

        // Once sent, reading back changes nothing of what was sent, and what this
        // device had never seen arrives.
        store.applyServer(server, base: &base)
        XCTAssertEqual(store.todos.first { $0.id == "edited" }?.title, "Mine")
        XCTAssertNotNil(store.todos.first { $0.id == "never seen" })
        XCTAssertNil(store.todos.first { $0.id == "removed here" })
    }

    @MainActor
    func testANewDeviceJustReads() {
        let store = TodoStore(library: TodoLibrary(tasks: [], projects: [], sections: []), saveFile: nil)
        var base = TodoLibrary(tasks: [], projects: [], sections: [])
        let server = TodoLibrary(tasks: [todo("a")], projects: [], sections: [], areas: [TodoArea(id: "x", name: "X", sortOrder: 1)])
        store.prepareFirstSync(server: server, base: &base)
        XCTAssertEqual(base.firstSyncDone, true)
        XCTAssertTrue(store.pendingChanges(against: base).tasks.isEmpty)
        store.applyServer(server, base: &base)
        XCTAssertEqual(store.todos.map(\.id), ["a"])
        XCTAssertTrue(store.pendingChanges(against: base).areas.deletes.isEmpty)
    }

    func testTimestampsInOneFormDontReadAsAChange() {
        XCTAssertEqual(
            TodoMerge.canonicalStamp("2026-10-02T15:01:33.67+00:00"), TodoMerge.canonicalStamp("2026-10-02T15:01:33Z"))
    }

    // MARK: Safety

    func testASuddenLossOfMostOfAListStops() {
        XCTAssertFalse(TodoMerge.looksSafe(before: 200, after: 0))
        XCTAssertFalse(TodoMerge.looksSafe(before: 200, after: 99))
        XCTAssertTrue(TodoMerge.looksSafe(before: 200, after: 100))
        XCTAssertTrue(TodoMerge.looksSafe(before: 5, after: 0))
    }

    // MARK: Timestamps and notes

    func testTimestampsSettleOnOneForm() {
        XCTAssertEqual(TodoMerge.canonicalStamp("2026-09-28T13:23:25.928864+00:00"), "2026-09-28T13:23:25Z")
        XCTAssertEqual(TodoMerge.canonicalStamp("2026-09-28T13:23:25+00:00"), "2026-09-28T13:23:25Z")
        XCTAssertEqual(TodoMerge.canonicalStamp("2026-09-28T13:23:25Z"), "2026-09-28T13:23:25Z")
    }

    func testNotesFromTheWebsite() {
        XCTAssertNil(TodoMerge.plainNotes(fromHTML: nil))
        XCTAssertNil(TodoMerge.plainNotes(fromHTML: "<p></p>"))
        XCTAssertEqual(TodoMerge.plainNotes(fromHTML: "<p>One &amp; two</p><p>Three</p>"), "One & two\nThree")
        XCTAssertEqual(
            TodoMerge.plainNotes(fromHTML: #"<p><a target="_blank" href="https://a.com/x">https://a.com/x</a></p>"#),
            "https://a.com/x")
        XCTAssertEqual(
            TodoMerge.plainNotes(fromHTML: #"<p><a href="https://a.com">the doc</a></p>"#), "the doc (https://a.com)")
    }

    func testNotesToTheWebsite() {
        XCTAssertNil(TodoMerge.notesHTML(fromPlain: nil))
        XCTAssertNil(TodoMerge.notesHTML(fromPlain: "  \n "))
        XCTAssertEqual(TodoMerge.notesHTML(fromPlain: "One\n\nTwo"), "<p>One</p><p>Two</p>")
        XCTAssertEqual(TodoMerge.notesHTML(fromPlain: "<b>&"), "<p>&lt;b&gt;&amp;</p>")
        XCTAssertEqual(
            TodoMerge.notesHTML(fromPlain: "see https://a.com/x"),
            "<p>see <a href=\"https://a.com/x\">https://a.com/x</a></p>")
    }

    func testNotesSurviveARoundTrip() {
        let plain = "First line\nhttps://a.com/x?y=1&z=2"
        XCTAssertEqual(TodoMerge.plainNotes(fromHTML: TodoMerge.notesHTML(fromPlain: plain)), plain)
    }
}
