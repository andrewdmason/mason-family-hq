import Foundation
import Testing
@testable import MusicMinusOne

@Suite struct SpeedTests {
    @Test func stepsInFivePercent() {
        #expect(Speed.stepped(1, by: -1) == 0.95)
        #expect(Speed.stepped(0.95, by: 1) == 1)
        #expect(Speed.stepped(1, by: 2) == 1.1)
    }

    @Test func staysInRange() {
        #expect(Speed.stepped(0.5, by: -1) == 0.5)
        #expect(Speed.stepped(1.5, by: 1) == 1.5)
    }

    @Test func showsTheTempoAtSpeed() {
        let song = Song(name: "Brahms", tempo: 119, speed: 0.95)
        #expect(song.currentBPM == 113)
    }

    @Test func volumeStepsInTens() {
        #expect(Volume.stepped(1, by: -1) == 0.9)
        #expect(Volume.stepped(0, by: -1) == 0)
        #expect(Volume.stepped(1, by: 1) == 1)
    }
}

@Suite struct CountInTests {
    @Test func preRollsTheBeatsBeforeTheMarker() {
        // 120 BPM: a beat is half a second of recording.
        let plan = CountIn(target: 10, beats: 4, tempo: 120, speed: 1)
        #expect(plan.startAt == 8)
        #expect(plan.silentLead == 0)
        #expect(plan.beatSeconds == 0.5)
    }

    @Test func slowerSpeedStretchesTheBeats() {
        let plan = CountIn(target: 10, beats: 4, tempo: 120, speed: 0.5)
        #expect(plan.startAt == 8)
        #expect(plan.beatSeconds == 1)
    }

    @Test func padsWithSilenceNearTheStart() {
        // Only 1 second of recording before the marker; the other second is quiet.
        let plan = CountIn(target: 1, beats: 4, tempo: 120, speed: 1)
        #expect(plan.startAt == 0)
        #expect(plan.silentLead == 1)
    }

    @Test func countsDownThenClears() {
        let plan = CountIn(target: 10, beats: 4, tempo: 120, speed: 1)
        #expect(plan.number(at: 0) == 4)
        #expect(plan.number(at: 0.6) == 3)
        #expect(plan.number(at: 1.99) == 1)
        #expect(plan.number(at: 2) == nil)
    }
}

@Suite struct SyncMergeTests {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func song(_ name: String, at date: Date, dirty: Bool = false, deleted: Bool = false, id: UUID = UUID()) -> Song {
        Song(id: id, name: name, tempo: 100, createdAt: t0, updatedAt: date, dirty: dirty, deleted: deleted)
    }

    @Test func newerRemoteWins() {
        let id = UUID()
        let mine = song("old", at: t0, id: id)
        let theirs = SongRow(song("new", at: t0.addingTimeInterval(5), id: id))
        #expect(SyncMerge.merge(local: [mine], remote: [theirs]).map(\.name) == ["new"])
    }

    @Test func unsentLocalChangeWins() {
        let id = UUID()
        let mine = song("mine", at: t0, dirty: true, id: id)
        let theirs = SongRow(song("theirs", at: t0.addingTimeInterval(5), id: id))
        #expect(SyncMerge.merge(local: [mine], remote: [theirs]).map(\.name) == ["mine"])
    }

    @Test func remoteSongsArrive() {
        let merged = SyncMerge.merge(local: [], remote: [SongRow(song("new", at: t0))])
        #expect(merged.map(\.name) == ["new"])
        #expect(merged.first?.dirty == false)
    }

    @Test func deletionsLeave() {
        let id = UUID()
        let mine = song("gone", at: t0, id: id)
        let theirs = SongRow(song("gone", at: t0.addingTimeInterval(5), deleted: true, id: id))
        #expect(SyncMerge.merge(local: [mine], remote: [theirs]).isEmpty)
        // Deleted here and already sent: gone too.
        #expect(SyncMerge.merge(local: [song("x", at: t0, deleted: true)], remote: []).isEmpty)
    }

    @Test func unsentDeletionStaysUntilSent() {
        let merged = SyncMerge.merge(local: [song("x", at: t0, dirty: true, deleted: true)], remote: [])
        #expect(merged.count == 1)
    }
}

@Suite @MainActor struct ShelfTests {
    @Test func albumsListTogetherInMovementOrderThenLooseSongs() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let library = Library(folder: folder)
        library.all = [
            Song(name: "Solo", tempo: 90),
            Song(name: "IV. Allegro", album: "Brahms Trio", albumNumber: 4, tempo: 120),
            Song(name: "I. Allegro", album: "Brahms Trio", albumNumber: 1, tempo: 120),
            Song(name: "Mozart I", album: "Mozart Quintet", tempo: 100),
        ]
        #expect(library.shelf.map(\.album) == ["Brahms Trio", "Mozart Quintet", nil])
        #expect(library.songs.map(\.name) == ["I. Allegro", "IV. Allegro", "Mozart I", "Solo"])
        let first = try #require(library.songs.first)
        #expect(library.siblings(of: first).map(\.name) == ["I. Allegro", "IV. Allegro"])
    }
}
