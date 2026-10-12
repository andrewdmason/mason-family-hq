import XCTest
@testable import ClipsCamera

/// Which at-bat a GameChanger clip is guessed to belong to.
final class FieldViewPickerTests: XCTestCase {
    private func game(_ name: String, _ atBats: [(id: UUID, at: String, result: String?, fieldView: Bool)]) throws -> GameSection {
        let rows = atBats.map { ab in
            """
            {"id":"\(ab.id)","source":"camera","status":"ready","result":\(ab.result.map { "\"\($0)\"" } ?? "null"),
             "recorded_at":"\(ab.at)","created_at":"\(ab.at)",
             "field_view_path":\(ab.fieldView ? "\"g/a/gamechanger-1.mp4\"" : "null"),"clip_pitches":[]}
            """
        }
        let json = #"{"id":"\#(UUID())","name":"\#(name)","played_on":"2026-10-11","clip_at_bats":[\#(rows.joined(separator: ","))]}"#
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let g = try decoder.decode(HistoryGame.self, from: Data(json.utf8))
        return GameSection(id: g.id, name: g.name, playedOn: g.playedOn, atBats: g.atBats, local: [])
    }

    func testPicksTheAtBatFilmedClosestToTheClip() throws {
        let first = UUID(), second = UUID(), third = UUID()
        let games = [try game("vs Kabuki", [
            (first, "2026-10-11T16:00:00Z", "1B", false),
            (second, "2026-10-11T16:40:00Z", "K", false),
            (third, "2026-10-11T17:20:00Z", "FO", false),
        ])]
        let clip = ISO8601DateFormatter().date(from: "2026-10-11T16:44:00Z")
        XCTAssertEqual(AtBatPicker.bestGuess(games, clipDate: clip), second)
    }

    func testWithoutAUsefulTimeItPicksTheNewestBallInPlayWithoutAFieldView() throws {
        let hit = UUID(), done = UUID(), strikeout = UUID()
        let games = [try game("vs Kabuki", [
            (hit, "2026-10-11T16:00:00Z", "2B", false),
            (done, "2026-10-11T16:40:00Z", "FO", true),
            (strikeout, "2026-10-11T17:20:00Z", "K", false),
        ])]
        // GameChanger's export time, days later, says nothing about the at-bat.
        let exported = ISO8601DateFormatter().date(from: "2026-10-14T09:00:00Z")
        XCTAssertEqual(AtBatPicker.bestGuess(games, clipDate: exported), hit)
        XCTAssertEqual(AtBatPicker.bestGuess(games, clipDate: nil), hit)
    }

    func testFieldOnlyAtBatsAreRecognized() throws {
        let id = UUID()
        let g = try game("vs Kabuki", [(id, "2026-10-11T16:00:00Z", "1B", true)])
        XCTAssertTrue(g.atBats[0].hasFieldView)
        XCTAssertTrue(g.atBats[0].isFieldOnly) // a field view and no close-up
    }
}
