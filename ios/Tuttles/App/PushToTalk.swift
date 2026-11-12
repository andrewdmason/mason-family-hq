import AVFoundation
import SwiftUI

/// Talking instead of typing, the way ChatGPT does it. The microphone in the
/// message box either:
/// - is tapped: recording starts and stays on. ✕ throws it away, ■ writes it
///   out into the box to edit, ↑ writes it out and sends it.
/// - is held: the same recording, but letting go sends it.
/// What was said is written out on the website (/tuttles/api/transcribe).
@MainActor
@Observable
final class TalkRecorder {
    enum Mode {
        case idle
        /// The finger is still on the button; letting go sends.
        case holding
        /// It was a tap; recording carries on until ✕, ■ or ↑.
        case locked
    }

    private(set) var mode: Mode = .idle
    var isActive: Bool { mode != .idle }
    /// Recent loudness, 0…1, oldest first, for the waveform.
    private(set) var levels = TalkRecorder.silence
    private(set) var started = Date()

    private static let silence = [Float](repeating: 0, count: 90)
    /// A press shorter than this is a tap, which locks recording on.
    private static let tapLength: TimeInterval = 0.35
    private var recorder: AVAudioRecorder?
    private var meter: Timer?
    private var starting: Task<Bool, Never>?
    private var pressedAt = Date()
    private let file = URL.temporaryDirectory.appending(path: "tuttles-talk.m4a")

    /// The finger came down on the microphone.
    func press() {
        guard mode == .idle else { return }
        pressedAt = .now
        levels = Self.silence
        mode = .holding
        starting = Task { await startRecording() }
    }

    /// The finger came up off the microphone (or the send arrow it turned
    /// into). The recording, if that means it should be sent now.
    func release() async -> Data? {
        switch mode {
        case .idle:
            return nil
        case .holding where Date().timeIntervalSince(pressedAt) < Self.tapLength:
            mode = .locked
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return nil
        case .holding, .locked:
            return await finish()
        }
    }

    /// Stop recording. The recording, or nil if it was too short to be anything.
    func finish() async -> Data? {
        guard mode != .idle else { return nil }
        mode = .idle
        guard await starting?.value == true else { return nil }
        let duration = Date().timeIntervalSince(started)
        stopRecording()
        guard duration > 0.4 else { return nil }
        return try? Data(contentsOf: file)
    }

    func cancel() async {
        guard mode != .idle else { return }
        mode = .idle
        _ = await starting?.value
        stopRecording()
    }

    private func startRecording() async -> Bool {
        guard await AVAudioApplication.requestRecordPermission() else {
            mode = .idle
            return false
        }
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
            guard r.record() else {
                mode = .idle
                return false
            }
            recorder = r
            started = .now
            meter = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let r = self.recorder else { return }
                    r.updateMeters()
                    let level = max(0, min(1, (r.averagePower(forChannel: 0) + 50) / 50))
                    self.levels.removeFirst()
                    self.levels.append(level)
                }
            }
            return true
        } catch {
            mode = .idle
            return false
        }
    }

    private func stopRecording() {
        meter?.invalidate()
        meter = nil
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// The microphone that stands in for the send arrow while the box is empty,
/// and becomes the send arrow while recording. It's one view the whole time so
/// a held finger isn't lost when it changes.
struct TalkButton: View {
    let recorder: TalkRecorder
    let onRecorded: (Data) -> Void

    @State private var pressing = false

    var body: some View {
        Image(systemName: recorder.isActive ? "arrow.up" : "mic.fill")
            .font(.body.weight(recorder.isActive ? .bold : .semibold))
            .contentTransition(.symbolEffect(.replace))
            .foregroundStyle(.white)
            .frame(width: 34, height: 34)
            .background(TuttlesLook.accent, in: .circle)
            .scaleEffect(pressing ? 1.15 : 1)
            .animation(.snappy, value: pressing)
            .padding(4)
            .contentShape(.circle)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !pressing else { return }
                        pressing = true
                        if recorder.mode == .idle {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            recorder.press()
                        }
                    }
                    .onEnded { _ in
                        pressing = false
                        Task {
                            if let audio = await recorder.release() { onRecorded(audio) }
                        }
                    }
            )
            .accessibilityLabel(recorder.isActive ? "Send" : "Talk")
            .accessibilityHint(recorder.isActive ? "" : "Tap to talk, or hold and let go to send")
    }
}

/// What the message box shows while recording: ✕, the waveform, and (after a
/// tap, not a hold) ■ to write it out without sending.
struct RecordingStrip: View {
    let recorder: TalkRecorder
    let onCancel: () -> Void
    let onStop: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel("Cancel")

            Waveform(levels: recorder.levels)
                .frame(maxWidth: .infinity)
                .frame(height: 30)
                .accessibilityHidden(true)

            if recorder.mode == .locked {
                Button(action: onStop) {
                    Image(systemName: "stop.fill")
                        .font(.footnote)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .transition(.scale.combined(with: .opacity))
                .accessibilityLabel("Stop and edit")
            }
        }
        .padding(.vertical, 4)
        .padding(.leading, 4)
        .animation(.snappy, value: recorder.mode)
    }
}

/// Loudness bars scrolling in from the right; silence is a row of dots.
private struct Waveform: View {
    let levels: [Float]

    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 5
            let width: CGFloat = 3
            let recent = levels.suffix(Int(size.width / step))
            for (i, level) in recent.enumerated() {
                let x = size.width - CGFloat(recent.count - i) * step
                let height = max(width, CGFloat(level * level) * size.height)
                let bar = CGRect(x: x, y: (size.height - height) / 2, width: width, height: height)
                context.fill(Path(roundedRect: bar, cornerRadius: width / 2), with: .color(.secondary))
            }
        }
    }
}
