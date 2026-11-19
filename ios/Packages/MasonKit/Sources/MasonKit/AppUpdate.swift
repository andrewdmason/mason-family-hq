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

    /// Where an update has got to, as far as the app can tell. iOS installs
    /// in the background and tells the app nothing: the only progress is on
    /// the app's icon on the Home Screen, and the app is closed when the new
    /// build goes in. So the app says what it knows, and what to do.
    public enum Stage: Sendable {
        /// A newer build is there to be had.
        case offered
        /// The install was handed to iOS. Still this build, for now.
        case started
        /// They left for the Home Screen and came back to this same build:
        /// the install didn't happen (or was turned down).
        case stalled
    }

    public private(set) var stage = Stage.offered
    /// The app has been to the background since the install was started.
    private var leftSinceStarting = false

    /// The install link was just opened.
    public func started() {
        stage = .started
        leftSinceStarting = false
    }

    public func wentToBackground() {
        if stage == .started { leftSinceStarting = true }
    }

    /// Back at the front. (The install question iOS asks only makes the app
    /// inactive, which isn't leaving it.)
    public func cameToFront() {
        if stage == .started, leftSinceStarting { stage = .stalled }
    }

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
        #if DEBUG
        // `--update-banner` shows the banner in the simulator, where there's
        // never an update: tapping it goes through the stages, installing nothing.
        if CommandLine.arguments.contains("--update-banner") {
            available = URL(string: "itms-services://?action=download-manifest&url=demo")
            return
        }
        #endif
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
/// installs the update in place (everything on the phone stays). Once tapped
/// it says the update is under way and where to look, since iOS shows nothing
/// in the app; if they come back and it's still this build, it offers again.
/// Checks on launch and whenever the app comes back to the front.
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
                    Button {
                        openURL(link)
                        update.started()
                    } label: {
                        HStack(spacing: 10) {
                            if update.stage == .started {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: update.stage == .stalled ? "exclamationmark.circle.fill" : "arrow.down.circle.fill")
                            }
                            Text(message)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
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
            .animation(.default, value: update.stage)
            .task { await update.check() }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .background: update.wentToBackground()
                case .active:
                    update.cameToFront()
                    Task { await update.check() }
                default: break
                }
            }
    }

    private var message: String {
        switch update.stage {
        case .offered: "A new version of \(appName) is ready. Tap to update."
        case .started: "Updating. Go to the Home Screen to watch it install, then open \(appName) again."
        case .stalled: "\(appName) didn't update. Tap to try again."
        }
    }
}

extension View {
    /// Shows `AppUpdateBanner` for copies installed from the app's install link.
    public func appUpdateBanner(slug: String, appName: String, tint: Color) -> some View {
        modifier(AppUpdateBanner(slug: slug, appName: appName, tint: tint))
    }
}
