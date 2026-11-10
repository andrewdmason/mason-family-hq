import XCTest
import AppKit
import ImageIO

@MainActor
final class TodoAttachmentTests: XCTestCase {
    private func store() -> AttachmentStore { AttachmentStore(folder: nil) }

    private func tempFile(_ name: String, bytes: Int) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: name)
        try Data(count: bytes).write(to: file)
        return file
    }

    func testWaitsForItsToDoToReachTheDatabase() {
        let store = store()
        store.add(data: Data([1]), fileName: "a.png", mimeType: "image/png", to: "t")
        XCTAssertTrue(store.uploadable(sentTaskIDs: []).isEmpty)
        XCTAssertEqual(store.uploadable(sentTaskIDs: ["t"]).count, 1)
        XCTAssertTrue(store.items(for: "t")[0].isUploading)
    }

    func testPathsMatchTheWebsite() {
        let item = PendingAttachment(id: "i", taskId: "t", fileName: "My File.PDF", mimeType: nil, isImage: false)
        XCTAssertEqual(AttachmentRules.originalPath(item), "t/i-original.pdf")
        XCTAssertEqual(AttachmentRules.displayPath(item), "t/i-display.jpg")
        XCTAssertEqual(AttachmentRules.fileExtension("noext"), "bin")
        XCTAssertTrue(AttachmentRules.isImage(name: "x.HEIC", mimeType: nil))
        XCTAssertFalse(AttachmentRules.isImage(name: "x.pdf", mimeType: "application/pdf"))
    }

    func testTooBigIsRefusedVisibly() throws {
        let store = store()
        let file = try tempFile("big.mov", bytes: AttachmentRules.maxBytes + 1)
        store.add(files: [file], to: "t")
        let item = store.items(for: "t")[0]
        XCTAssertEqual(item.failure, "Over the 50 MB limit")
        XCTAssertFalse(item.canRetry)
        XCTAssertTrue(store.uploadable(sentTaskIDs: ["t"]).isEmpty)
    }

    func testFailuresStopThenRetry() {
        let store = store()
        store.add(data: Data([1]), fileName: "a.txt", mimeType: nil, to: "t")
        let waiting = store.pending[0]
        for _ in 1..<AttachmentRules.maxAttempts { store.uploadFailed(waiting, permanent: false, reason: "no") }
        XCTAssertNil(store.pending[0].failure)
        store.uploadFailed(waiting, permanent: false, reason: "no")
        XCTAssertEqual(store.pending[0].failure, "no")
        XCTAssertTrue(store.uploadable(sentTaskIDs: ["t"]).isEmpty)
        store.retry(store.items(for: "t")[0])
        XCTAssertEqual(store.uploadable(sentTaskIDs: ["t"]).count, 1)
    }

    func testPermanentFailureStopsAtOnce() {
        let store = store()
        store.add(data: Data([1]), fileName: "a.txt", mimeType: nil, to: "t")
        store.uploadFailed(store.pending[0], permanent: true, reason: "refused")
        XCTAssertEqual(store.items(for: "t")[0].failure, "refused")
    }

    func testRemovedStaysHiddenWhileTheServerStillSaysSo() {
        let store = store()
        let row = TodoAttachment(id: "a", taskId: "t", originalPath: "t/a-original.png", displayPath: "t/a-display.jpg", kind: "image", fileName: "a.png", mimeType: nil)
        store.applyServer([row])
        store.remove(store.items(for: "t")[0])
        XCTAssertEqual(store.removals, [AttachmentRemoval(id: "a", paths: ["t/a-original.png", "t/a-display.jpg"])])
        store.applyServer([row])
        XCTAssertTrue(store.items(for: "t").isEmpty)
        store.removalSent("a")
        XCTAssertTrue(store.removals.isEmpty)
    }

    func testRemovingOneStillWaitingNeverGoesUp() {
        let store = store()
        store.add(data: Data([1]), fileName: "a.txt", mimeType: nil, to: "t")
        store.remove(store.items(for: "t")[0])
        XCTAssertTrue(store.pending.isEmpty)
        XCTAssertTrue(store.removals.isEmpty)
    }

    func testOrphansAreDropped() {
        let store = store()
        store.add(data: Data([1]), fileName: "a.txt", mimeType: nil, to: "gone")
        store.add(data: Data([1]), fileName: "b.txt", mimeType: nil, to: "here")
        store.dropOrphans(alive: ["here"])
        XCTAssertEqual(store.pending.map(\.taskId), ["here"])
    }

    func testUploadedBecomesARemoteRow() {
        let store = store()
        store.add(data: Data([1]), fileName: "a.png", mimeType: "image/png", to: "t")
        store.uploaded(store.pending[0], displayData: Data([2]))
        XCTAssertTrue(store.pending.isEmpty)
        XCTAssertEqual(store.remote[0].kind, "image")
        XCTAssertFalse(store.items(for: "t")[0].isUploading)
    }

    func testDisplayCopyIsAJPEGAtMost2000() throws {
        let image = NSImage(size: NSSize(width: 100, height: 100))
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 4000, pixelsHigh: 1000, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        image.addRepresentation(rep)
        let png = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
        let copy = AttachmentImaging.displayCopy(of: png)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(copy as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, "public.jpeg")
        let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        XCTAssertEqual(properties[kCGImagePropertyPixelWidth] as? Int, 2000)
    }

    func testUnreadableImageFallsBackToItsBytes() {
        let bytes = Data("not an image".utf8)
        XCTAssertEqual(AttachmentImaging.displayCopy(of: bytes), bytes)
    }
}
