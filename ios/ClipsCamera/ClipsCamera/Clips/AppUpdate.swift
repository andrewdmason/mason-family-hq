import Foundation
import Observation

/// For copies installed from the install link (ad hoc builds, which iOS never
/// updates on its own): notices when a newer build has been published and
/// offers it. TestFlight copies update themselves, so they skip the check.
@MainActor
@Observable
final class AppUpdate {
    /// The install link for a newer build, when there is one.
    private(set) var available: URL?

    private static let latest = URL(string: "\(Config.supabaseURL.absoluteString)/storage/v1/object/public/app-builds/clips-camera/latest.json")!

    /// Ad hoc and development builds carry a provisioning profile; App Store
    /// and TestFlight builds don't.
    private static var installedFromLink: Bool {
        #if DEBUG
        return false
        #else
        return Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") != nil
        #endif
    }

    func check() async {
        guard Self.installedFromLink,
              let mine = (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String).flatMap(Int.init)
        else { return }
        struct Latest: Decodable { let build: String; let manifest: String }
        var request = URLRequest(url: Self.latest)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let latest = try? JSONDecoder().decode(Latest.self, from: data),
              let theirs = Int(latest.build), theirs > mine,
              let manifest = latest.manifest.addingPercentEncoding(withAllowedCharacters: .alphanumerics)
        else { return }
        available = URL(string: "itms-services://?action=download-manifest&url=\(manifest)")
    }
}
