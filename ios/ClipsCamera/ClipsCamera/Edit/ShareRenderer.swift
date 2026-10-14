import AVFoundation
import CryptoKit
import Foundation

// A shared at-bat is rendered from its reel when it's asked for, the way the
// share options say: the title card, each pitch at real speed with its caption,
// a ¼-speed replay after each swing, then the GameChanger field view — or just
// the ball in play, just the close-up, or just the field view, with the slow-mo,
// card and captions each switchable, landscape or vertical (each camera's
// picture cropped where it was framed). Finished copies are kept in the caches
// folder, so sharing the same version again is instant.

/// What goes in the shared video.
enum ShareContent: String, Codable, CaseIterable, Identifiable {
    /// Every pitch, then the field view.
    case whole
    /// The ball in play (and its replay), then the field view.
    case hit
    /// Every pitch, no field view.
    case pitches
    /// The field view alone.
    case fieldView

    var id: String { rawValue }

    var label: String {
        switch self {
        case .whole: "Whole at-bat"
        case .hit: "Just the hit"
        case .pitches: "Pitches only"
        case .fieldView: "GameChanger only"
        }
    }
}

/// The share sheet's choices, remembered between shares.
struct ShareOptions: Codable, Equatable {
    var content: ShareContent = .whole
    /// A ¼-speed replay after each swing.
    var slowMo = true
    var titleCard = true
    var captions = true
    /// 9:16 for Reels and Stories, rather than landscape.
    var vertical = false
    /// In a vertical video, crop the GameChanger clip rather than showing the
    /// whole field over a blurred fill.
    var cropFieldView = false

    static let standard = ShareOptions()

    init(content: ShareContent = .whole, slowMo: Bool = true, titleCard: Bool = true, captions: Bool = true,
         vertical: Bool = false, cropFieldView: Bool = false) {
        self.content = content
        self.slowMo = slowMo
        self.titleCard = titleCard
        self.captions = captions
        self.vertical = vertical
        self.cropFieldView = cropFieldView
    }

    // Options saved before a choice existed take its default.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = ShareOptions()
        content = try c.decodeIfPresent(ShareContent.self, forKey: .content) ?? d.content
        slowMo = try c.decodeIfPresent(Bool.self, forKey: .slowMo) ?? d.slowMo
        titleCard = try c.decodeIfPresent(Bool.self, forKey: .titleCard) ?? d.titleCard
        captions = try c.decodeIfPresent(Bool.self, forKey: .captions) ?? d.captions
        vertical = try c.decodeIfPresent(Bool.self, forKey: .vertical) ?? d.vertical
        cropFieldView = try c.decodeIfPresent(Bool.self, forKey: .cropFieldView) ?? d.cropFieldView
    }

    var showsCloseup: Bool { content != .fieldView }
    var showsFieldView: Bool { content != .pitches }

    /// These options for an at-bat, with a content choice it can't make
    /// (no field view, no ball in play) back to the whole at-bat.
    func fitted(to at: ShareAvailability) -> ShareOptions {
        var o = self
        if !at.offers(content) { o.content = .whole }
        return o
    }
}

/// What an at-bat has to share.
struct ShareAvailability: Equatable {
    var hasFieldView: Bool
    var hasHit: Bool

    init(hasFieldView: Bool, hasHit: Bool) {
        self.hasFieldView = hasFieldView
        self.hasHit = hasHit
    }

    init(pitches: [Pitch], hasFieldView: Bool) {
        self.init(hasFieldView: hasFieldView, hasHit: ReelPlan.hitPitch(pitches) != nil)
    }

    /// The choices shown: without a field view, "Pitches only" would be the
    /// whole at-bat again and "GameChanger only" nothing.
    var choices: [ShareContent] {
        hasFieldView ? ShareContent.allCases : [.whole, .hit]
    }

    func offers(_ c: ShareContent) -> Bool {
        choices.contains(c) && (c != .hit || hasHit)
    }
}

/// Where each camera's picture sits in a vertical crop: the middle of the
/// kept strip, as a fraction of the picture's width. Unset is the middle.
struct Framing: Codable, Equatable {
    var closeup: Double?
    var fieldView: Double?
}

/// Everything that decides how a shared at-bat looks.
struct ShareRequest {
    var atBatID: UUID
    var reel: URL
    var segments: [ReelSegment]
    /// At their reel times.
    var pitches: [Pitch]
    var result: AtBatResult?
    var card: TitleCard
    var options: ShareOptions
    var framing = Framing()
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
        // Keep the newest few versions of this at-bat (one per set of options
        // tried); drop the rest.
        if let old = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey]) {
            let mine = old.filter { $0.lastPathComponent.hasPrefix(r.atBatID.uuidString) }
                .sorted { modified($0) > modified($1) }
            for url in mine.dropFirst(3) { try? FileManager.default.removeItem(at: url) }
        }
        let card = r.options.titleCard ? r.card : nil
        let fieldView = r.options.showsFieldView ? r.fieldView : nil
        let shape: VideoShape = r.options.vertical ? .vertical : .landscape
        let fieldFill: LayerFill = !r.options.vertical ? .fit
            : r.options.cropFieldView ? .crop(center: r.framing.fieldView ?? 0.5) : .fitOverBlur
        let closeupCenter = r.framing.closeup ?? 0.5
        let partial = folder.appendingPathComponent("partial-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: partial) }

        if r.options.content == .fieldView {
            guard let fv = fieldView else { throw RenderError.failed("this at-bat has no GameChanger video") }
            _ = try await FieldViewRenderer.alone(card: card, cardSeconds: r.timings.titleCard, fieldView: fv.url,
                                                  start: fv.start, end: fv.end, shape: shape, fieldFill: fieldFill, to: partial)
        } else {
            var only: Int?
            if r.options.content == .hit {
                guard let hit = ReelPlan.hitPitch(r.pitches) else { throw RenderError.failed("this at-bat has no ball in play") }
                only = hit
            }
            var plan = ReelPlan.sharePlan(segments: r.segments, pitches: r.pitches, result: r.result,
                                          replays: r.options.slowMo, only: only, timings: r.timings)
            if !r.options.captions {
                for i in plan.indices { plan[i].caption = "" }
            }
            if let fv = fieldView {
                let closeup = folder.appendingPathComponent("closeup-\(UUID().uuidString).mp4")
                defer { try? FileManager.default.removeItem(at: closeup) }
                _ = try await EditRenderer.render(source: r.reel, rotation: 0, plan: plan, card: card, timings: r.timings,
                                                  shape: shape, cropCenter: closeupCenter, to: closeup)
                _ = try await FieldViewRenderer.append(closeup: closeup, fieldView: fv.url, start: fv.start, end: fv.end,
                                                       shape: shape, fieldFill: fieldFill, to: partial)
            } else {
                _ = try await EditRenderer.render(source: r.reel, rotation: 0, plan: plan, card: card, timings: r.timings,
                                                  shape: shape, cropCenter: closeupCenter, to: partial)
            }
        }
        try FileManager.default.moveItem(at: partial, to: out)
        return out
    }

    private static func modified(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
    }

    private static func key(_ r: ShareRequest) -> String {
        let o = r.options
        var parts = [r.reelKey, o.content.rawValue, o.slowMo ? "replays" : "realspeed", o.titleCard ? "card" : "nocard",
                     o.captions ? "captions" : "nocaptions", r.card.title, r.card.subtitle, r.result?.rawValue ?? "-"]
        if o.vertical {
            let f = { (x: Double?) in String(format: "%.3f", x ?? 0.5) }
            parts += ["vertical", f(r.framing.closeup), o.cropFieldView ? "gc-crop-\(f(r.framing.fieldView))" : "gc-whole"]
        }
        parts += r.pitches.sorted { $0.t < $1.t }.map { "\($0.outcome?.rawValue ?? "-")/\($0.battedBall?.rawValue ?? "-")" }
        if let fv = r.fieldView { parts.append("\(fv.key)@\(fv.start)-\(fv.end)") }
        // The way the close-up meets the field view.
        parts.append("hold-dissolve")
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        if let t = try? encoder.encode(r.timings) { parts.append(t.base64EncodedString()) }
        let digest = SHA256.hash(data: Data(parts.joined(separator: "|").utf8))
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }
}
