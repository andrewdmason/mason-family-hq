import MasonKit
import SwiftUI

@main
struct ReaderApp: App {
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Theme.accent)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await Offline.shared.keepRecentBooks() }
        }
    }
}
