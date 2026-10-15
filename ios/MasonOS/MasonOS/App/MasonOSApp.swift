import SwiftUI

@main
struct MasonOSApp: App {
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

enum Theme {
    /// The family site's brown (its theme color, #7f4327).
    static let accent = Color(red: 0x7F / 255, green: 0x43 / 255, blue: 0x27 / 255)
    /// Its paper background, #faf7f0.
    static let paper = Color(red: 0xFA / 255, green: 0xF7 / 255, blue: 0xF0 / 255)
}
