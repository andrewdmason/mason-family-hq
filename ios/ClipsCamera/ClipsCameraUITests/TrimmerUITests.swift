import XCTest

/// The GameChanger trimmer, driven by touch: dragging each handle changes the
/// kept stretch. Needs a clip at /tmp/gc-demo.mp4 (any video; skipped without).
final class TrimmerUITests: XCTestCase {
    func testDraggingTheHandlesTrims() throws {
        let clip = "/tmp/gc-demo.mp4"
        guard FileManager.default.fileExists(atPath: clip) else { throw XCTSkip("No clip at \(clip)") }
        let app = XCUIApplication()
        app.launchArguments = ["-demoHome", "-demoImport", clip]
        app.launch()

        let range = app.staticTexts["trim-range"]
        XCTAssertTrue(range.waitForExistence(timeout: 15))
        let before = range.label
        let end = app.descendants(matching: .any)["End"]
        XCTAssertTrue(end.waitForExistence(timeout: 5))

        // Pull the end handle a third of the way in, then the start handle in.
        end.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: end.coordinate(withNormalizedOffset: CGVector(dx: -6, dy: 0.5)))
        let afterEnd = range.label
        XCTAssertNotEqual(afterEnd, before, "dragging the end handle should change the range")

        let startHandle = app.descendants(matching: .any)["Start"]
        startHandle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: startHandle.coordinate(withNormalizedOffset: CGVector(dx: 5, dy: 0.5)))
        XCTAssertNotEqual(range.label, afterEnd, "dragging the start handle should change the range")
        XCTAssertTrue(range.label.hasPrefix("0:0") || range.label.hasPrefix("0:1"), range.label)
        print("TRIM \(before) → \(afterEnd) → \(range.label)")

        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.lifetime = .keepAlways
        add(shot)
        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/trim-after-drag.png"))

        // Sideways: the trimmer turns with the phone, handles still in reach.
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(2)
        XCTAssertTrue(end.isHittable && startHandle.isHittable)
        // Laid out sideways: the strip runs along the bottom of the wide window.
        XCTAssertGreaterThan(range.frame.minY, app.windows.firstMatch.frame.height * 0.7)
        XCTAssertGreaterThan(app.windows.firstMatch.frame.width, app.windows.firstMatch.frame.height)
        XCUIDevice.shared.orientation = .portrait
    }
}
