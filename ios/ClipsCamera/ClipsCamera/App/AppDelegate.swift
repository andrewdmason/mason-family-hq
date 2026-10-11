import UIKit

/// Only here for background uploads: iOS wakes the app when they finish while
/// it's suspended, and the upload session must hand iOS back its completion.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == Config.uploadSessionID else { return completionHandler() }
        UploadSession.shared.backgroundCompletion = completionHandler
    }
}
