import AVFoundation
import SwiftUI

/// Push to talk: hold the microphone in the message box and talk; let go and
/// what was said is written out (on the website, /tuttles/api/transcribe) and
/// sent as the message. Sliding off to the left cancels.
@MainActor
@Observable
final class TalkRecorder {
    private(set) var isRecording = false
    /// 0…1, for the little level meter.
    private(set) var level: Float = 0
    private(set) var started = Date()
    private var recorder: AVAudioRecorder?
    private var meter: Timer?
    private let file = URL.temporaryDirectory.appending(path: "tuttles-talk.m4a")

    func start() async -> Bool {
        guard await AVAudioApplication.requestRecordPermission() else { return false }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let r = try AVAudioRecorder(url: file, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 24000,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ])
            r.isMeteringEnabled = true
            guard r.record() else { return false }
            recorder = r
            isRecording = true
            started = .now
            meter = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let r = self.recorder else { return }
                    r.updateMeters()
                    self.level = max(0, min(1, (r.averagePower(forChannel: 0) + 50) / 50))
                }
            }
            return true
        } catch {
            return false
        }
    }

    /// The recording, or nil if it was too short to be anything.
    func finish() -> Data? {
        let duration = Date().timeIntervalSince(started)
        stopRecording()
        guard duration > 0.4 else { return nil }
        return try? Data(contentsOf: file)
    }

    func cancel() { stopRecording() }

    private func stopRecording() {
        meter?.invalidate()
        meter = nil
        recorder?.stop()
        recorder = nil
        isRecording = false
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// The microphone that stands in for the send arrow while the box is empty.
struct TalkButton: View {
    let recorder: TalkRecorder
    /// Dragged far enough left that letting go cancels.
    @Binding var cancelArmed: Bool
    let onRecorded: (Data) -> Void

    @State private var pressing = false

    var body: some View {
        Image(systemName: "mic.fill")
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: 34, height: 34)
            .background(recorder.isRecording ? Color.red : TuttlesLook.accent, in: .circle)
            .scaleEffect(recorder.isRecording ? 1.25 + CGFloat(recorder.level) * 0.25 : 1)
            .animation(.easeOut(duration: 0.1), value: recorder.level)
            .animation(.snappy, value: recorder.isRecording)
            .padding(4)
            .contentShape(.circle)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if !pressing {
                            pressing = true
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            Task { _ = await recorder.start() }
                        }
                        cancelArmed = value.translation.width < -80
                    }
                    .onEnded { _ in
                        pressing = false
                        if cancelArmed {
                            recorder.cancel()
                        } else if let audio = recorder.finish() {
                            onRecorded(audio)
                        }
                        cancelArmed = false
                    }
            )
            .accessibilityLabel("Hold to talk")
    }
}

/// What the message box shows while the microphone is held.
struct RecordingStrip: View {
    let recorder: TalkRecorder
    let cancelArmed: Bool

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(.red).frame(width: 9, height: 9)
                .opacity(recorder.isRecording ? 1 : 0.3)
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                Text(Duration.seconds(Date().timeIntervalSince(recorder.started)), format: .time(pattern: .minuteSecond))
                    .monospacedDigit()
            }
            Spacer()
            Label(cancelArmed ? "Let go to cancel" : "Slide left to cancel", systemImage: "chevron.left")
                .font(.subheadline)
                .foregroundStyle(cancelArmed ? .red : .secondary)
        }
        .padding(.vertical, 10)
        .padding(.leading, 16)
    }
}
