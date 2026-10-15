import Foundation
import Testing
@testable import MasonOS

// The website's checks for the same rules (scripts/verify-practice-quick-log.mts
// and verify-practice-maintenance.mts), case for case, so the phone and the
// website agree on what a tap does.

private func id(_ name: String) -> UUID {
    // Stable ids from names, so failures read clearly.
    let hex = name.utf8.reduce(into: UInt64(1469598103934665603)) { $0 = ($0 ^ UInt64($1)) &* 1099511628211 }
    return UUID(uuidString: String(format: "00000000-0000-0000-%04X-%012llX", UInt16(truncatingIfNeeded: hex >> 48), hex & 0xFFFF_FFFF_FFFF))!
}

private func piece(_ key: String, _ name: String, work: String? = nil, kind: String = "piece", maintenance: Bool = false) -> Piece {
    Piece(id: id(key), workID: work.map(id), name: name, composer: nil, kind: kind, maintenance: maintenance)
}

private let iso = ISO8601DateFormatter()

private func task(_ key: String, completed: Bool, started: String? = nil, ended: String? = nil, created: String = "2026-10-09T08:00:00Z") -> PracticeTask {
    PracticeTask(
        id: id(key), pieceID: nil, timerSeconds: 0, timerRemainingSeconds: 0, completed: completed,
        startedAt: started.flatMap(iso.date(from:)), endedAt: ended.flatMap(iso.date(from:)),
        createdAt: iso.date(from: created)!, sessionNumber: 1
    )
}

@Suite struct Cards {
    let pieces = [
        piece("allegro", "I. Allegro", work: "trio"),
        piece("andante", "III. Andantino grazioso", work: "trio"),
        piece("ballade", "Ballade 4", maintenance: true),
        piece("rev", "Revolutionary Etude"),
        piece("sight", "Sight Reading", kind: "sight_reading"),
        piece("tech", "Technique", kind: "technique"),
        piece("lonely", "Lonely movement", work: "solo-work"),
        piece("scherzo", "Scherzo No. 1", maintenance: true),
    ]
    var cards: (current: [QuickCard], maintenance: [QuickCard]) {
        QuickLog.cards(activePieces: pieces, worksByID: [id("trio"): "Clarinet Trio", id("solo-work"): "Some Sonata"])
    }

    @Test func techniqueAndSightReadingLeadThenPiecesByName() {
        #expect(cards.current.map(\.title) == ["Technique", "Sight Reading", "Clarinet Trio", "Lonely movement", "Revolutionary Etude"])
    }

    @Test func aWorkWithSeveralActivePiecesIsOneSegmentedCard() {
        let trio = cards.current.first { $0.title == "Clarinet Trio" }
        #expect(trio?.pieces.map(\.id) == [id("allegro"), id("andante")])
    }

    @Test func aWorkWithOneActivePieceIsAPlainCard() {
        #expect(cards.current.contains { $0.title == "Lonely movement" && $0.pieces.count == 1 })
    }

    @Test func maintenancePiecesGetTheirOwnGroup() {
        #expect(cards.maintenance.map(\.title) == ["Ballade 4", "Scherzo No. 1"])
    }

    @Test func namesSortNumerically() {
        let (current, _) = QuickLog.cards(activePieces: [piece("b", "Etude No. 10"), piece("a", "Etude No. 2")], worksByID: [:])
        #expect(current.map(\.title) == ["Etude No. 2", "Etude No. 10"])
    }
}

@Suite struct WhichTaskATapTimes {
    @Test func nothingTodayMeansCreateOne() {
        #expect(QuickLog.taskToTime([]) == nil)
    }

    @Test func theFirstOpenTaskWins() {
        #expect(QuickLog.taskToTime([task("a", completed: true), task("b", completed: false), task("c", completed: false)])?.id == id("b"))
    }

    @Test func allFinishedMeansTheMostRecentlyWorkedOn() {
        let picked = QuickLog.taskToTime([
            task("a", completed: true, ended: "2026-10-09T18:00:00Z"),
            task("b", completed: true, ended: "2026-10-09T09:00:00Z"),
        ])
        #expect(picked?.id == id("a"))
    }

    @Test func allFinishedNeverTimedMeansTheNewest() {
        let picked = QuickLog.taskToTime([
            task("a", completed: true, created: "2026-10-09T07:00:00Z"),
            task("b", completed: true, created: "2026-10-09T09:00:00Z"),
        ])
        #expect(picked?.id == id("b"))
    }
}

@Suite struct StatusLine {
    @Test func reads() {
        #expect(QuickLog.daysSince(nil, today: "2026-10-09") == "Never played")
        #expect(QuickLog.daysSince("2026-10-08", today: "2026-10-09") == "Yesterday")
        #expect(QuickLog.daysSince("2026-09-27", today: "2026-10-09") == "12 days ago")
        #expect(QuickLog.total(45 * 60 + 30) == "45m")
        #expect(QuickLog.total(76 * 60) == "1h 16m")
        #expect(QuickLog.total(120 * 60) == "2h")
        #expect(QuickLog.clock(247) == "4:07")
        #expect(QuickLog.clock(4565) == "1:16:05")
    }

    @Test func daysAcrossDaylightSaving() {
        #expect(PracticeDay.daysBetween("2026-10-31", "2026-11-02") == 2)
        #expect(PracticeDay.daysBetween("2026-03-07", "2026-03-09") == 2)
    }

    @Test func todayAndTheRolloverCutoff() {
        let pacific = TimeZone(identifier: "America/Los_Angeles")!
        // 1:30am Pacific on the 10th: today is the 10th, but the 9th isn't over.
        let late = iso.date(from: "2026-10-10T08:30:00Z")!
        #expect(PracticeDay.today(late, timeZone: pacific) == "2026-10-10")
        #expect(PracticeDay.rolloverCutoff(late, timeZone: pacific) == "2026-10-09")
    }
}

@Suite struct MaintenanceRotation {
    let asOf = "2026-09-20"
    let nocturne = piece("p-nocturne", "Nocturne", maintenance: true)
    let ballade = piece("p-ballade", "Ballade", maintenance: true)
    let etude = piece("p-etude", "Etude", maintenance: true)
    let daily = piece("p-daily", "Daily piece")

    @Test func theLongestUntouchedWins() {
        let pick = QuickLog.dueMaintenance(pieces: [nocturne, ballade], lastPracticed: [nocturne.id: "2026-09-18", ballade.id: "2026-09-01"], excluded: [], asOf: asOf)
        #expect(pick?.id == ballade.id)
    }

    @Test func neverPracticedBeatsNinetyDaysOld() {
        let pick = QuickLog.dueMaintenance(pieces: [nocturne, ballade], lastPracticed: [ballade.id: "2026-06-22"], excluded: [], asOf: asOf)
        #expect(pick?.id == nocturne.id)
    }

    @Test func equalAgesBreakOnName() {
        let pick = QuickLog.dueMaintenance(pieces: [nocturne, ballade], lastPracticed: [nocturne.id: "2026-09-10", ballade.id: "2026-09-10"], excluded: [], asOf: asOf)
        #expect(pick?.id == ballade.id)
    }

    @Test func aPieceOutOfTheRotationIsNeverOffered() {
        #expect(QuickLog.dueMaintenance(pieces: [daily], lastPracticed: [:], excluded: [], asOf: asOf) == nil)
    }

    @Test func excludedPiecesArePassedOver() {
        let last = [nocturne.id: "2026-09-19", ballade.id: "2026-09-01", etude.id: "2026-09-10"]
        let all = [nocturne, ballade, etude]
        #expect(QuickLog.dueMaintenance(pieces: all, lastPracticed: last, excluded: [ballade.id], asOf: asOf)?.id == etude.id)
        #expect(QuickLog.dueMaintenance(pieces: all, lastPracticed: last, excluded: [ballade.id, etude.id], asOf: asOf)?.id == nocturne.id)
        #expect(QuickLog.dueMaintenance(pieces: all, lastPracticed: last, excluded: [], asOf: asOf)?.id == ballade.id)
        #expect(QuickLog.dueMaintenance(pieces: all, lastPracticed: last, excluded: Set(all.map(\.id)), asOf: asOf) == nil)
    }
}
