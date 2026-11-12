import Foundation
import Observation
import SwiftUI

/// For copies installed from an install link (ad hoc builds, which iOS never
/// updates on its own, for family phones that can't use TestFlight because the
/// kid is under 13): notices when `scripts/release.sh` has published a newer
/// build and offers it. TestFlight and App Store copies update themselves, and
/// copies installed from Xcode are whatever was just built, so both skip it.
@MainActor
@Observable
public final class AppUpdate {
    /// The install link for a newer build, when there is one.
    public private(set) var available: URL?

    private let latest: URL

    /// `slug`: the app's folder in the public app-builds bucket
    /// (`app-builds/<slug>/latest.json`), the lowercased scheme name.
    public init(slug: String) {
        latest = URL(string: "\(Config.supabaseURL.absoluteString)/storage/v1/object/public/app-builds/\(slug)/latest.json")!
    }

    /// Ad hoc and development builds carry a provisioning profile; App Store
    /// and TestFlight builds don't. Debug builds are from Xcode.
    private static var installedFromLink: Bool {
        #if DEBUG
        return false
        #else
        return Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") != nil
        #endif
    }

    public func check() async {
        guard Self.installedFromLink,
              let mine = (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String).flatMap(Int.init)
        else { return }
        struct Latest: Decodable { let build: String; let manifest: String }
        var request = URLRequest(url: latest)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let latest = try? JSONDecoder().decode(Latest.self, from: data),
              let theirs = Int(latest.build), theirs > mine,
              let manifest = latest.manifest.addingPercentEncoding(withAllowedCharacters: .alphanumerics)
        else { return }
        available = URL(string: "itms-services://?action=download-manifest&url=\(manifest)")
    }
}

/// A banner across the top of the app when a newer build is ready; tapping it
/// installs the update in place (everything on the phone stays). Checks on
/// launch and whenever the app comes back to the front.
struct AppUpdateBanner: ViewModifier {
    let appName: String
    let tint: Color
    @State private var update: AppUpdate
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    init(slug: String, appName: String, tint: Color) {
        self.appName = appName
        self.tint = tint
        _update = State(initialValue: AppUpdate(slug: slug))
    }

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if let link = update.available {
                    Button { openURL(link) } label: {
                        Label("A new version of \(appName) is ready. Tap to update.", systemImage: "arrow.down.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .padding(.horizontal, 16)
                    }
                    .background(tint)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.default, value: update.available)
            .task { await update.check() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await update.check() } }
            }
    }
}

extension View {
    /// Shows `AppUpdateBanner` for copies installed from the app's install link.
    public func appUpdateBanner(slug: String, appName: String, tint: Color) -> some View {
        modifier(AppUpdateBanner(slug: slug, appName: appName, tint: tint))
    }
}
