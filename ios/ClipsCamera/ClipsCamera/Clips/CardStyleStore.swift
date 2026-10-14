import Foundation
import Observation
import Supabase
import UIKit

// Each kid's title-card look — their theme and their cut-out headshot — kept
// with the kid in Clips, so every family phone makes the same card. Stored in
// the clips bucket beside the at-bats: kids/{kid id}/card.json says which
// theme and which headshot file; the headshot is a PNG next to it with a new
// name each time it's replaced. This phone keeps a copy of both, so shares
// work offline and watch-only (signed out) phones fall back to the default.

/// What's saved for a kid.
struct KidCardStyle: Codable, Equatable {
    var theme: String = CardTheme.standard.id
    /// The headshot's storage path; nil for none.
    var headshot: String?
}

@MainActor
@Observable
final class CardStyleStore {
    static let shared = CardStyleStore()

    /// By kid id.
    private(set) var styles: [String: KidCardStyle] {
        didSet { if let data = try? JSONEncoder().encode(styles) { UserDefaults.standard.set(data, forKey: "cardStyles") } }
    }

    private let clips = ClipsService.shared
    private var bucket: StorageFileApi { clips.client.storage.from(Config.bucket) }

    private static let folder: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Headshots", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private init() {
        styles = UserDefaults.standard.data(forKey: "cardStyles")
            .flatMap { try? JSONDecoder().decode([String: KidCardStyle].self, from: $0) } ?? [:]
    }

    /// A kid's look for a card: their theme, and their headshot when this
    /// phone has it.
    func style(for kid: UUID?) -> CardStyle {
        guard let kid, let saved = styles[kid.uuidString] else { return CardStyle() }
        return CardStyle(theme: saved.theme, headshot: saved.headshot.map(Self.localFile).flatMap {
            FileManager.default.fileExists(atPath: $0.path) ? $0 : nil
        })
    }

    func saved(_ kid: UUID) -> KidCardStyle { styles[kid.uuidString] ?? KidCardStyle() }

    /// Bring this phone's copies up to date with Clips.
    func refresh(_ kids: [Kid]) async {
        guard clips.isSignedIn else { return }
        for kid in kids {
            guard let data = try? await bucket.download(path: Self.stylePath(kid.id), cacheNonce: UUID().uuidString),
                  let style = try? JSONDecoder().decode(KidCardStyle.self, from: data) else { continue }
            if let path = style.headshot { await fetchHeadshot(path) }
            styles[kid.id.uuidString] = style
        }
    }

    func setTheme(_ theme: String, for kid: UUID) async throws {
        var style = saved(kid)
        style.theme = theme
        try await save(style, for: kid)
    }

    /// A new headshot (already cut out): up to Clips, then this kid's card
    /// points at it and the old one goes.
    func setHeadshot(_ image: UIImage, for kid: UUID) async throws {
        guard let png = image.pngData() else { throw StoreError("Couldn't save the headshot.") }
        let path = "kids/\(kid.uuidString.lowercased())/headshot-\(UUID().uuidString.prefix(8).lowercased()).png"
        try await bucket.upload(path, data: png, options: FileOptions(contentType: "image/png", upsert: true))
        try png.write(to: Self.localFile(path))
        var style = saved(kid)
        let old = style.headshot
        style.headshot = path
        try await save(style, for: kid)
        if let old { await forget(old) }
    }

    func removeHeadshot(for kid: UUID) async throws {
        var style = saved(kid)
        guard let old = style.headshot else { return }
        style.headshot = nil
        try await save(style, for: kid)
        await forget(old)
    }

    private func save(_ style: KidCardStyle, for kid: UUID) async throws {
        guard clips.isSignedIn else { throw StoreError("Sign in to change the title card.") }
        let data = try JSONEncoder().encode(style)
        try await bucket.upload(Self.stylePath(kid), data: data, options: FileOptions(cacheControl: "0", contentType: "application/json", upsert: true))
        styles[kid.uuidString] = style
    }

    private func fetchHeadshot(_ path: String) async {
        let file = Self.localFile(path)
        guard !FileManager.default.fileExists(atPath: file.path),
              let data = try? await bucket.download(path: path) else { return }
        try? data.write(to: file)
    }

    private func forget(_ path: String) async {
        _ = try? await bucket.remove(paths: [path])
        try? FileManager.default.removeItem(at: Self.localFile(path))
    }

    private static func stylePath(_ kid: UUID) -> String { "kids/\(kid.uuidString.lowercased())/card.json" }

    private static func localFile(_ path: String) -> URL {
        folder.appendingPathComponent(path.replacingOccurrences(of: "/", with: "_"))
    }
}
