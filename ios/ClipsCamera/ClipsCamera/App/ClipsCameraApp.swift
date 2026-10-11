import SwiftUI

@main
struct ClipsCameraApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RecordView()
                .preferredColorScheme(.dark)
        }
    }
}
