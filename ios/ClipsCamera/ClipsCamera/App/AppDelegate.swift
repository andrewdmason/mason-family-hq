import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// The home screen is upright; the camera is sideways. Each screen sets
    /// this through `Orientation.lock` when it appears.
    static var orientations: UIInterfaceOrientationMask = .portrait

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // The title cards' typefaces, for the settings screen's swatches too.
        CardFonts.register()
        return true
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        Self.orientations
    }

    /// Background uploads: iOS wakes the app when they finish while it's
    /// suspended, and the upload session must hand iOS back its completion.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == Config.uploadSessionID else { return completionHandler() }
        UploadSession.shared.backgroundCompletion = completionHandler
    }
}

enum Orientation {
    /// Allow only these orientations and turn the screen to match now.
    @MainActor
    static func lock(_ mask: UIInterfaceOrientationMask) {
        AppDelegate.orientations = mask
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
        // Every screen up the stack, not just the bottom one: a screen
        // presented over home keeps home's rule until it's told.
        for window in scene.windows {
            var vc = window.rootViewController
            while let current = vc {
                current.setNeedsUpdateOfSupportedInterfaceOrientations()
                vc = current.presentedViewController
            }
        }
    }
}
