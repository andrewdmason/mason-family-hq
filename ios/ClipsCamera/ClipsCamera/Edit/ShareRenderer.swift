import AVFoundation
import CryptoKit
import Foundation

// A shared at-bat is rendered from its reel when it's asked for: the title
// card, each pitch at real speed with its caption, a ¼-speed replay after each
// swing (unless real speed only was picked), then the GameChanger field view.
// Finished copies are kept in the caches folder, so sharing the same version
// again is instant.

/// Everything that decides how a shared at-bat looks.
struct ShareRequest {
    var atBatID: UUID
    var reel: URL
    var segments: [ReelSegment]
    /// At their reel times.
    var pitches: [Pitch]
    var result: AtBatResult?
    var card: TitleCard
    var replays: Bool
    /// The GameChanger clip; `key` names it (its storage path).
    var fieldView: (url: URL, start: Double, end: Double, key: String)?
    /// What identifies the reel's contents (its storage path, or file name).
    var reelKey: String
    var timings: EditTimings = AppSettings.shared.timings
}

enum ShareRenderer {
    private static let folder: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Shares", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    /// The finished video, from the cache when this exact version was made before.
    static func render(_ r: ShareRequest) async throws -> URL {
        let out = folder.appendingPathComponent("\(r.atBatID.uuidString)-\(key(r)).mp4")
        if FileManager.default.fileExists(atPath: out.path) { return out }
        // Drop older versions of this at-bat.
        if let old = try? FileManager.default.contentsOfDirectory(atPath: folder.path) {
            for name in old where name.hasPrefix(r.atBatID.uuidString) {
                try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
            }
        }
        let plan = ReelPlan.sharePlan(segments: r.segments, pitches: r.pitches, result: r.result, replays: r.replays, timings: r.timings)
        let partial = folder.appendingPathComponent("partial-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: partial) }
        if let fv = r.fieldView {
            let closeup = folder.appendingPathComponent("closeup-\(UUID().uuidString).mp4")
            defer { try? FileManager.default.removeItem(at: closeup) }
            _ = try await EditRenderer.render(source: r.reel, rotation: 0, plan: plan, card: r.card, timings: r.timings, to: closeup)
            _ = try await FieldViewRenderer.append(closeup: closeup, fieldView: fv.url, start: fv.start, end: fv.end, to: partial)
        } else {
            _ = try await EditRenderer.render(source: r.reel, rotation: 0, plan: plan, card: r.card, timings: r.timings, to: partial)
        }
        try FileManager.default.moveItem(at: partial, to: out)
        return out
    }

    private static func key(_ r: ShareRequest) -> String {
        var parts = [r.reelKey, r.replays ? "replays" : "realspeed", r.card.title, r.card.subtitle, r.result?.rawValue ?? "-"]
        parts += r.pitches.sorted { $0.t < $1.t }.map { "\($0.outcome?.rawValue ?? "-")/\($0.battedBall?.rawValue ?? "-")" }
        if let fv = r.fieldView { parts.append("\(fv.key)@\(fv.start)-\(fv.end)") }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        if let t = try? encoder.encode(r.timings) { parts.append(t.base64EncodedString()) }
        let digest = SHA256.hash(data: Data(parts.joined(separator: "|").utf8))
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }
}
