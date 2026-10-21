import MasonKit
import SwiftUI

@main
struct PracticeApp: App {
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Theme.accent)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            // Coming back counts as being there; a timer left an hour stops.
            PracticeTimer.shared.touch()
            PracticeTimer.shared.restoreLiveActivity()
            Task { await PracticeWrites.shared.flush() }
        }
    }
}
