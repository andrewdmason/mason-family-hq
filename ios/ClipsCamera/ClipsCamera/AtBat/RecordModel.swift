import Foundation
import Observation
import UIKit

// One at-bat at a time: Record, tap per pitch, label it, and the at-bat stops
// itself a few seconds after it's decided (walk, strikeout, HBP, or a ball in
// play once its result is in).

enum LabelStep: Equatable {
    case outcome, battedBall, playResult
}

@MainActor
@Observable
final class RecordModel {
    let capture = CaptureController()
    let store = AtBatStore()
    let settings = AppSettings.shared
    let clips = ClipsService.shared

    enum Phase: Equatable { case ready, recording, stopping }

    private(set) var phase: Phase = .ready
    private(set) var pitches: [Pitch] = []
    /// The pitch the label popover is open for.
    private(set) var labeling: UUID?
    /// Re-opened from the strip: start at the outcome even if it's labeled.
    private var relabeling = false
    /// Seconds left before an auto-stop, while the countdown shows.
    private(set) var countdown: Int?
    /// "Keep recording" was tapped for this result (e.g. a dropped third strike).
    private var autoStopDeclined = false
    private(set) var elapsed: Double = 0
    var message: String?

    private var countdownTimer: Timer?
    private var clockTimer: Timer?
    private var idleTimer: Timer?
    private let haptic = UIImpactFeedbackGenerator(style: .heavy)

    var count: Count { Scorebook.count(pitches) }
    var outcome: (index: Int, result: AtBatResult)? { Scorebook.outcome(pitches) }

    var labelingPitch: Pitch? { pitches.first { $0.id == labeling } }

    var labelStep: LabelStep? {
        guard let p = labelingPitch else { return nil }
        if relabeling || p.outcome == nil { return .outcome }
        if p.outcome == .inPlay && p.battedBall == nil { return .battedBall }
        if p.outcome == .inPlay && p.playResult == nil { return .playResult }
        return nil
    }

    // MARK: Camera power

    /// The camera screen opened (or the app came back to it).
    func cameraOpened() async {
        UIApplication.shared.isIdleTimerDisabled = true
        await capture.start()
        #if DEBUG
        loadDemoIfAsked()
        #endif
        armIdle()
    }

    /// Back to the home screen: the camera powers down.
    func cameraClosed() {
        guard phase == .ready else { return }
        UIApplication.shared.isIdleTimerDisabled = false
        idleTimer?.invalidate()
        closeLabels()
        capture.stop()
    }

    func wentToBackground() {
        if phase == .recording { stop() } else { capture.stop() }
    }

    /// Any touch while ready: wake the camera if it dozed off, and restart the idle clock.
    func touched() {
        if phase == .ready && !capture.isRunning { Task { await capture.start() } }
        armIdle()
    }

    /// The camera powers down after a minute idle between at-bats (heat and battery).
    private func armIdle() {
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.phase == .ready else { return }
                self.capture.stop()
            }
        }
    }

    // MARK: Recording

    func record() {
        guard phase == .ready else { return }
        guard settings.game != nil else { message = "No game picked — close the camera and start one."; return }
        // Camera dozed off between at-bats: wake it and go straight to recording.
        guard capture.isRunning else {
            Task {
                await capture.start()
                if capture.isRunning { record() }
            }
            return
        }
        do {
            try capture.startRecording()
        } catch {
            message = error.localizedDescription
            return
        }
        idleTimer?.invalidate()
        pitches = []
        labeling = nil
        relabeling = false
        countdown = nil
        autoStopDeclined = false
        elapsed = 0
        phase = .recording
        haptic.prepare()
        clockTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.elapsed = self.capture.recordedSeconds()
            }
        }
    }

    func stop() {
        guard phase == .recording else { return }
        phase = .stopping
        cancelCountdown()
        clockTimer?.invalidate()
        let pitches = pitches
        let result = outcome?.result
        let game = settings.game
        Task {
            do {
                let recording = try await capture.stopRecording()
                store.add(recording, pitches: pitches, result: result, game: game)
            } catch {
                message = error.localizedDescription
            }
            self.pitches = []
            labeling = nil
            phase = .ready
            armIdle()
        }
    }

    // MARK: Pitches

    /// A finger came down on the picture: that instant is the pitch.
    func tap(hostTime: TimeInterval) {
        guard phase == .recording else { touched(); return }
        guard let t = capture.recordingTime(hostTime: hostTime) else { return }
        haptic.impactOccurred()
        let pitch = Pitch(t: t)
        pitches.append(pitch)
        // Opening the new pitch's labels closes any earlier one, still unlabeled.
        labeling = pitch.id
        relabeling = false
        evaluate()
    }

    func undoLastPitch() {
        guard let last = pitches.popLast() else { return }
        if labeling == last.id { labeling = nil }
        evaluate()
    }

    func openLabels(_ id: UUID) {
        labeling = id
        relabeling = true
    }

    func closeLabels() {
        labeling = nil
        relabeling = false
    }

    func choose(_ o: PitchOutcome) {
        edit { p in
            p.outcome = o
            if o != .inPlay {
                p.battedBall = nil
                p.playResult = nil
            }
        }
        relabeling = false
        if o != .inPlay { labeling = nil }
    }

    func choose(_ b: BattedBall) {
        edit { $0.battedBall = b }
    }

    func choose(_ r: PlayResult) {
        edit { $0.playResult = r }
        labeling = nil
    }

    private func edit(_ change: (inout Pitch) -> Void) {
        guard let i = pitches.firstIndex(where: { $0.id == labeling }) else { return }
        change(&pitches[i])
        evaluate()
    }

    #if DEBUG
    /// Simulator layout check (no camera there): `-demo` fakes a recording
    /// mid-at-bat with the label panel open.
    func loadDemoIfAsked() {
        guard ProcessInfo.processInfo.arguments.contains("-demo") else { return }
        phase = .recording
        elapsed = 83
        pitches = [
            Pitch(t: 10, outcome: .ball),
            Pitch(t: 30, outcome: .calledStrike),
            Pitch(t: 50, outcome: .foul),
            Pitch(t: 70),
            Pitch(t: 82, outcome: .inPlay),
        ]
        labeling = pitches.last?.id
        if ProcessInfo.processInfo.arguments.contains("-demoCountdown") {
            pitches[4].battedBall = .lineDrive
            pitches[4].playResult = .single
            labeling = nil
            countdown = 2
        }
    }
    #endif

    // MARK: Auto-stop

    /// Start or cancel the stop countdown as the at-bat becomes decided or not.
    private func evaluate() {
        guard phase == .recording else { return }
        if outcome == nil {
            cancelCountdown()
            autoStopDeclined = false
        } else if countdown == nil && !autoStopDeclined {
            startCountdown()
        }
    }

    private func startCountdown() {
        countdown = settings.autoStopSeconds
        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let left = self.countdown else { return }
                if left <= 1 { self.stop() } else { self.countdown = left - 1 }
            }
        }
    }

    func keepRecording() {
        autoStopDeclined = true
        cancelCountdown()
    }

    private func cancelCountdown() {
        countdownTimer?.invalidate()
        countdownTimer = nil
        countdown = nil
    }
}
