import ActivityKit
import AppIntents
import Foundation

/// The practice timer on the Lock Screen and in the Dynamic Island. Compiled
/// into both the app and the widget extension.
struct PracticeActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var pieceName: String
        /// When this run started.
        var startedAt: Date
        /// When the timer stops on its own (an hour after the last
        /// interaction). The clocks stop counting here.
        var endsBy: Date
        /// Practice already in today's log before this run, in seconds.
        var todayBeforeSeconds: Int
    }

    var taskID: UUID
}

/// The Live Activity's Stop button. iOS runs a LiveActivityIntent in the app's
/// own process (launching it in the background if needed), so the stop is
/// written to the log the same way a tap in the app writes it.
struct StopPracticeIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop practice timer"
    static let isDiscoverable = false

    init() {}

    func perform() async throws -> some IntentResult {
        #if !WIDGET_EXTENSION
        await PracticeTimer.shared.stop(reason: .liveActivity)
        #endif
        return .result()
    }
}
