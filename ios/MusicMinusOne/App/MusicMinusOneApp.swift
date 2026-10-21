import MasonKit
import SwiftUI

@main
struct MusicMinusOneApp: App {
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(.anytuneOrange)
                .preferredColorScheme(.dark)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Player.shared.wake()
                Task { await Library.shared.syncNow() }
            }
            if phase == .background { Player.shared.sleep() }
        }
    }
}

struct RootView: View {
    @State private var session = Session.shared

    var body: some View {
        Group {
            if !session.checked {
                ProgressView()
            } else if !session.isSignedIn {
                SignInView(appName: "Music Minus One", symbol: "music.quarternote.3")
            } else {
                LibraryView()
            }
        }
        .animation(.default, value: session.isSignedIn)
        .onChange(of: session.userID) { _, id in
            if id != nil { Task { await Library.shared.syncNow() } }
        }
    }
}

extension Color {
    static let anytuneOrange = Color(red: 0.93, green: 0.36, blue: 0.13)
    static let markerBlue = Color(red: 0.33, green: 0.55, blue: 0.93)
    static let badgeBlue = Color(red: 0.16, green: 0.33, blue: 0.80)
}
