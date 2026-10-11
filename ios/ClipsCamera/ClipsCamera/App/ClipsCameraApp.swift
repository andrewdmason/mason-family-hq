import SwiftUI

@main
struct ClipsCameraApp: App {
    var body: some Scene {
        WindowGroup {
            RecordView()
                .preferredColorScheme(.dark)
        }
    }
}
