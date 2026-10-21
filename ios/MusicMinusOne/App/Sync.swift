import Foundation
import MasonKit
import Supabase

enum SyncState: Equatable {
    case idle
    case syncing
    case synced
    /// Couldn't reach the backend (no signal, or it isn't set up yet). The
    /// phone keeps working; the next sync tries again.
    case offline
}

/// A song as the backend keeps it (music_songs).
struct SongRow: Codable {
    let id: UUID
    let name: String
    let artist: String?
    let album: String?
    let album_number: Int?
    let tempo_bpm: Double
    let speed: Double
    let volume: Double
    let tracks: [Track]
    let markers: [Marker]
    let created_at: Date
    let updated_at: Date
    let deleted_at: Date?

    init(_ song: Song) {
        id = song.id
        name = song.name
        artist = song.artist
        album = song.album
        album_number = song.albumNumber
        tempo_bpm = song.tempo
        speed = song.speed
        volume = song.volume
        tracks = song.tracks
        markers = song.markers
        created_at = song.createdAt
        updated_at = song.updatedAt
        deleted_at = song.deleted ? song.updatedAt : nil
    }

    var song: Song {
        Song(
            id: id, name: name, artist: artist, album: album, albumNumber: album_number, tempo: tempo_bpm, speed: speed, volume: volume,
            tracks: tracks, markers: markers.sorted { $0.time < $1.time },
            createdAt: created_at, updatedAt: updated_at, dirty: false, deleted: deleted_at != nil
        )
    }
}

enum SyncMerge {
    /// The library after a pull. A song changed here and not yet sent wins
    /// (it goes up next); otherwise the newer side wins. Songs deleted
    /// anywhere, once the backend knows, leave the phone.
    static func merge(local: [Song], remote: [SongRow]) -> [Song] {
        var byID = Dictionary(local.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for row in remote {
            let theirs = row.song
            guard let mine = byID[row.id] else {
                if !theirs.deleted { byID[row.id] = theirs }
                continue
            }
            if mine.dirty { continue }
            if theirs.deleted {
                byID[row.id] = nil
            } else if theirs.updatedAt.timeIntervalSince(mine.updatedAt) > 0.001 {
                byID[row.id] = theirs
            }
        }
        return byID.values.filter { !($0.deleted && !$0.dirty) }.sorted { $0.createdAt < $1.createdAt }
    }
}

extension Library {
    private static let bucket = "music-minus-one"

    private func storagePath(_ owner: UUID, _ song: Song, _ track: Track) -> String {
        "\(owner.uuidString.lowercased())/\(song.id.uuidString.lowercased())/\(track.file)"
    }

    /// Sends what changed here, takes what changed elsewhere, then fetches
    /// any audio this phone doesn't have yet.
    func syncNow() async {
        guard sync != .syncing, let owner = Session.shared.userID else { return }
        sync = .syncing
        let db = Session.shared.client
        do {
            // Up: each changed song, its new audio first so the row never
            // points at a file that isn't there.
            for snapshot in all where snapshot.dirty {
                var song = snapshot
                if song.deleted {
                    let paths = song.tracks.filter(\.uploaded).map { storagePath(owner, song, $0) }
                    if !paths.isEmpty { _ = try? await db.storage.from(Self.bucket).remove(paths: paths) }
                } else {
                    for i in song.tracks.indices where !song.tracks[i].uploaded && hasAudio(song.tracks[i]) {
                        try await db.storage.from(Self.bucket).upload(
                            storagePath(owner, song, song.tracks[i]),
                            fileURL: audioURL(song.tracks[i]),
                            options: FileOptions(upsert: true)
                        )
                        song.tracks[i].uploaded = true
                    }
                }
                try await db.from("music_songs").upsert(SongRow(song), onConflict: "id").execute()
                markSent(song, uploadedFrom: snapshot)
            }

            // Down.
            let rows: [SongRow] = try await db.from("music_songs")
                .select("id, name, artist, album, album_number, tempo_bpm, speed, volume, tracks, markers, created_at, updated_at, deleted_at")
                .execute().value
            let before = Set(all.flatMap(\.tracks).map(\.file))
            replaceAll(SyncMerge.merge(local: all, remote: rows))
            let after = Set(all.flatMap(\.tracks).map(\.file))
            for gone in before.subtracting(after) {
                try? FileManager.default.removeItem(at: audioFolder.appending(path: gone))
            }
            sync = .synced
        } catch {
            print("music sync: \(error)")
            sync = .offline
            return
        }
        await downloadMissingAudio(owner: owner)
    }

    /// The song went up as `sent`. Its uploads stick even if it changed
    /// meanwhile; it's clean only if it didn't.
    private func markSent(_ sent: Song, uploadedFrom snapshot: Song) {
        guard let i = all.firstIndex(where: { $0.id == sent.id }) else { return }
        let uploaded = Set(sent.tracks.filter(\.uploaded).map(\.file))
        for t in all[i].tracks.indices where uploaded.contains(all[i].tracks[t].file) {
            all[i].tracks[t].uploaded = true
        }
        if all[i].updatedAt == snapshot.updatedAt { all[i].dirty = false }
        save()
    }

    private func downloadMissingAudio(owner: UUID) async {
        let db = Session.shared.client
        for song in songs {
            for track in song.tracks where track.uploaded && !hasAudio(track) && !downloading.contains(track.file) {
                downloading.insert(track.file)
                defer { downloading.remove(track.file) }
                do {
                    let data = try await db.storage.from(Self.bucket).download(path: storagePath(owner, song, track))
                    try data.write(to: audioURL(track), options: .atomic)
                } catch {
                    print("music download \(track.file): \(error)")
                }
            }
        }
    }
}
