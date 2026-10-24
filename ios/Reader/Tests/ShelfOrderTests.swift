import Foundation
import Testing
@testable import Reader

@MainActor
struct ShelfOrderTests {
    private func book(
        _ title: String, status: String = "in_progress", order: Double? = nil, content: String? = "ready",
        readAgo: TimeInterval? = nil, type: String? = nil
    ) -> ShelfBook {
        var book = ShelfBook(
            id: UUID(), type: type, title: title, author: nil, site_name: nil, excerpt: nil, word_count: nil,
            status: status, cover_image_url: nil, sort_order: order, created_at: Date(timeIntervalSince1970: 0)
        )
        book.content = content
        book.lastReadAt = readAgo.map { Date.now.addingTimeInterval(-$0) }
        return book
    }

    @Test func tabsFollowTheWebsitesOrderWithPausedUnderReading() {
        let books = [
            book("B", order: 2), book("A", order: 1), book("Q", status: "queued"),
            book("P", status: "paused"), book("Z", status: "archive"),
        ]
        let reading = ShelfOrder.books(books, in: .reading)
        #expect(reading.main.map(\.title) == ["A", "B"])
        #expect(reading.paused.map(\.title) == ["P"])
        #expect(ShelfOrder.books(books, in: .queue).paused.isEmpty)
    }

    @Test func opensOnQueueWhenNothingIsBeingRead() {
        #expect(ShelfOrder.firstTab([book("Q", status: "queued")]) == .queue)
        #expect(ShelfOrder.firstTab([book("R")]) == .reading)
    }

    @Test func keepsReadingBooksPlusTheMostRecent() {
        let reading = book("Reading", readAgo: 500)
        let recent = (0..<7).map { book("Q\($0)", status: "queued", readAgo: Double($0) * 10) }
        let unready = book("No file", content: nil)
        let archived = book("Old", status: "archive", readAgo: 1)
        let kept = ShelfOrder.keepOffline([reading, unready, archived] + recent, limit: 5)
        #expect(kept.map(\.title) == ["Reading", "Q0", "Q1", "Q2", "Q3", "Q4"])
    }

    @Test func resumesTheLastBookUnlessYouWentBackToTheShelf() {
        let older = book("Older", readAgo: 3600)
        let newer = book("Newer", readAgo: 60)
        #expect(ShelfOrder.resume(place: nil, books: [older, newer])?.title == "Newer")
        // Back on the shelf after the last read: stay on the shelf.
        #expect(ShelfOrder.resume(place: .shelf(at: .now), books: [older, newer]) == nil)
        // On the shelf, but a book has been read since (another device).
        #expect(ShelfOrder.resume(place: .shelf(at: .now.addingTimeInterval(-600)), books: [older, newer])?.title == "Newer")
        // In a book, and nothing newer: that book.
        #expect(ShelfOrder.resume(place: .book(newer.id, at: .now), books: [older, newer])?.title == "Newer")
        // In a book, but another was read since: the newer one.
        #expect(ShelfOrder.resume(place: .book(older.id, at: .now), books: [older, newer])?.title == "Newer")
    }
}
