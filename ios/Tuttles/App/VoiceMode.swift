import AVFoundation
import SwiftUI

// Voice mode: a live spoken conversation with the tutor inside a chat
// (src/lib/tuttles/voice.ts). The website hands out a short-lived key already
// set up with the tutor's instructions; the phone streams the microphone to
// OpenAI's realtime model over a WebSocket and plays its voice back. The tutor
// can put a picture on the screen (show_visual), and photos taken during the
// call go to it as they're taken, with an exact write-up from the stronger
// model. Hanging up saves the call into the chat.

// MARK: - The call

@MainActor
@Observable
final class VoiceCall {
    enum State: Equatable { case connecting, live, ending, failed(String) }
    enum Stage: Equatable { case none, visual(String), photo(UIImage), reading }

    struct Turn {
        let id: String
        let role: String
        var text = ""
        var images: [String] = []
        var visuals: [String] = []
    }

    private(set) var state: State = .connecting
    private(set) var stage: Stage = .none
    /// Pictures and photos from this call, newest last, to tap back to.
    private(set) var shown: [Stage] = []
    /// What the tutor is saying now, and what the student last said.
    private(set) var tutorCaption = ""
    private(set) var studentCaption = ""
    /// 0…1, for the background.
    private(set) var inputLevel: Float = 0
    private(set) var outputLevel: Float = 0
    var muted = false

    private(set) var turns: [Turn] = []
    let threadID: UUID
    let assignmentID: Int?
    private let store: ChatStore

    private var socket: URLSessionWebSocketTask?
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let playFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
    private let sendFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!

    init(store: ChatStore, threadID: UUID, assignmentID: Int?) {
        self.store = store
        self.threadID = threadID
        self.assignmentID = assignmentID
    }

    func start() async {
        do {
            guard await AVAudioApplication.requestRecordPermission() else {
                state = .failed("Tuttles needs the microphone. Turn it on in Settings.")
                return
            }
            let key = try await store.voiceKey(threadID: threadID, assignmentID: assignmentID)
            try startAudio()
            var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/realtime?model=\(key.model)")!)
            request.setValue("Bearer \(key.key)", forHTTPHeaderField: "Authorization")
            let socket = URLSession.shared.webSocketTask(with: request)
            self.socket = socket
            socket.resume()
            Task { await receive() }
            // The tutor opens with a short hello.
            send(["type": "response.create"])
            state = .live
        } catch {
            state = .failed(error.localizedDescription)
            stopAudio()
        }
    }

    /// Ends the call and saves it into the chat.
    func hangUp() async {
        guard state != .ending else { return }
        state = .ending
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        stopAudio()
        let toSave = turns
            .filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty || !$0.images.isEmpty || !$0.visuals.isEmpty }
            .map { ChatStore.VoiceTurn(role: $0.role == "user" ? "student" : "tutor", text: $0.text, images: $0.images, visuals: $0.visuals) }
        if !toSave.isEmpty {
            try? await store.saveVoice(threadID: threadID, assignmentID: assignmentID, turns: toSave)
        }
    }

    func show(_ item: Stage) { stage = item }

    /// A photo taken during the call: shown, uploaded, read, then given to the tutor.
    func send(photo: ChatPhoto) {
        stage = .photo(photo.image)
        shown.append(.photo(photo.image))
        let id = "photo-\(photo.id.uuidString)"
        turns.append(Turn(id: id, role: "user"))
        Task {
            stage = .reading
            var reading: String?
            if let path = try? await store.upload(photo, threadID: threadID) {
                if let at = turns.firstIndex(where: { $0.id == id }) { turns[at].images.append(path) }
                reading = try? await store.readPhoto(at: path)
            }
            stage = .photo(photo.image)
            let small = photo.image.scaledDown(toFit: 1280).jpegData(compressionQuality: 0.7) ?? photo.jpeg
            var content: [[String: Any]] = [
                ["type": "input_image", "image_url": "data:image/jpeg;base64,\(small.base64EncodedString())"],
            ]
            if let reading {
                content.append(["type": "input_text", "text": "(What the photo shows, read carefully: \(reading))"])
            }
            send(["type": "conversation.item.create", "item": ["type": "message", "role": "user", "content": content]])
            send(["type": "response.create"])
        }
    }

    // MARK: Events

    private func receive() async {
        while let socket {
            guard let message = try? await socket.receive() else {
                if state == .live { state = .failed("The call dropped.") }
                return
            }
            let data: Data? = switch message {
            case .string(let s): s.data(using: .utf8)
            case .data(let d): d
            @unknown default: nil
            }
            guard let data, let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            handle(event)
        }
    }

    private func handle(_ e: [String: Any]) {
        switch e["type"] as? String {
        case "response.output_audio.delta":
            if let b64 = e["delta"] as? String, let pcm = Data(base64Encoded: b64) { play(pcm) }
        case "response.output_item.added":
            if let item = e["item"] as? [String: Any], item["type"] as? String == "message", let id = item["id"] as? String {
                turns.append(Turn(id: id, role: "assistant"))
                tutorCaption = ""
            }
        case "response.output_audio_transcript.delta":
            if let id = e["item_id"] as? String, let delta = e["delta"] as? String,
               let at = turns.firstIndex(where: { $0.id == id }) {
                turns[at].text += delta
                tutorCaption = turns[at].text
            }
        case "input_audio_buffer.speech_started":
            // They started talking: stop the tutor mid-sentence (the server
            // cancels the rest of its reply).
            player.stop()
            player.play()
            studentCaption = "…"
        case "input_audio_buffer.committed":
            if let id = e["item_id"] as? String {
                let after = (e["previous_item_id"] as? String).flatMap { p in turns.firstIndex { $0.id == p } }
                let turn = Turn(id: id, role: "user")
                if let after { turns.insert(turn, at: after + 1) } else { turns.append(turn) }
            }
        case "conversation.item.input_audio_transcription.completed":
            if let id = e["item_id"] as? String, let text = e["transcript"] as? String {
                if let at = turns.firstIndex(where: { $0.id == id }) { turns[at].text = text }
                studentCaption = text.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        case "response.function_call_arguments.done":
            guard let callID = e["call_id"] as? String else { return }
            if let visual = Self.visual(from: e["arguments"] as? String) {
                stage = .visual(visual)
                shown.append(.visual(visual))
                if let at = turns.lastIndex(where: { $0.role == "assistant" }) {
                    turns[at].visuals.append(visual)
                } else {
                    turns.append(Turn(id: callID, role: "assistant", visuals: [visual]))
                }
            }
            send(["type": "conversation.item.create",
                  "item": ["type": "function_call_output", "call_id": callID, "output": "Shown on their screen."]])
            send(["type": "response.create"])
        case "error":
            let message = (e["error"] as? [String: Any])?["message"] as? String ?? "Something went wrong."
            tutorCaption = message
        default:
            break
        }
    }

    /// show_visual's argument: the visual's JSON, as a string or an object.
    static func visual(from arguments: String?) -> String? {
        guard let data = arguments?.data(using: .utf8),
              let args = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let s = args["visual"] as? String { return s }
        if let o = args["visual"], let d = try? JSONSerialization.data(withJSONObject: o) { return String(data: d, encoding: .utf8) }
        return nil
    }

    private func send(_ event: [String: Any]) {
        guard let socket, let data = try? JSONSerialization.data(withJSONObject: event),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }

    // MARK: Audio

    private func startAudio() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
        // Echo cancellation, so the tutor doesn't hear itself.
        try engine.inputNode.setVoiceProcessingEnabled(true)

        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: playFormat)

        let inFormat = engine.inputNode.outputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: inFormat, to: sendFormat) else { throw VoiceError.audio }
        let sendFormat = self.sendFormat
        engine.inputNode.installTap(onBus: 0, bufferSize: 2400, format: inFormat) { [weak self] buffer, _ in
            let level = Self.rms(buffer)
            let frames = AVAudioFrameCount(Double(buffer.frameLength) * 24000 / inFormat.sampleRate) + 1
            guard let out = AVAudioPCMBuffer(pcmFormat: sendFormat, frameCapacity: frames) else { return }
            var fed = false
            converter.convert(to: out, error: nil) { _, status in
                if fed { status.pointee = .noDataNow; return nil }
                fed = true
                status.pointee = .haveData
                return buffer
            }
            guard let samples = out.int16ChannelData else { return }
            let bytes = Data(bytes: samples[0], count: Int(out.frameLength) * 2)
            Task { @MainActor in
                guard let self else { return }
                self.inputLevel = self.inputLevel * 0.6 + level * 0.4
                guard !self.muted, self.state == .live else { return }
                self.send(["type": "input_audio_buffer.append", "audio": bytes.base64EncodedString()])
            }
        }
        // What's actually coming out of the speaker, for the background.
        engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buffer, _ in
            let level = Self.rms(buffer)
            Task { @MainActor in
                guard let self else { return }
                self.outputLevel = self.outputLevel * 0.6 + level * 0.4
            }
        }
        engine.prepare()
        try engine.start()
        player.play()
    }

    private func stopAudio() {
        engine.inputNode.removeTap(onBus: 0)
        engine.mainMixerNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func play(_ pcm: Data) {
        let count = pcm.count / 2
        guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(count)) else { return }
        buffer.frameLength = AVAudioFrameCount(count)
        pcm.withUnsafeBytes { raw in
            let src = raw.bindMemory(to: Int16.self)
            let dst = buffer.floatChannelData![0]
            for i in 0..<count { dst[i] = Float(Int16(littleEndian: src[i])) / 32768 }
        }
        player.scheduleBuffer(buffer)
    }

    nonisolated private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += data[i] * data[i] }
        return min(1, sqrt(sum / Float(buffer.frameLength)) * 6)
    }

    enum VoiceError: LocalizedError {
        case audio
        var errorDescription: String? { "The microphone couldn't start." }
    }
}

// MARK: - The screen

struct VoiceView: View {
    let threadID: UUID
    let assignmentID: Int?
    /// After the call is saved, so the chat can show it.
    let onEnd: () -> Void

    @Environment(ChatStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var call: VoiceCall?
    @State private var showingCamera = false

    var body: some View {
        ZStack {
            VoiceBackground(input: call?.inputLevel ?? 0, output: call?.outputLevel ?? 0)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                stage
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                if let call, call.shown.count > 1 { recent(call) }
                captions
                controls
            }
            .padding(.bottom, 12)
        }
        .preferredColorScheme(.dark)
        .task {
            let c = VoiceCall(store: store, threadID: threadID, assignmentID: assignmentID)
            call = c
            await c.start()
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraView(onDone: { _ in }, onShot: { photo in call?.send(photo: photo) })
        }
    }

    @ViewBuilder private var stage: some View {
        switch call?.stage ?? .none {
        case .visual(let json):
            VisualView(json: json)
                .environment(\.colorScheme, .light)
                .transition(.scale(scale: 0.92).combined(with: .opacity))
        case .photo(let image):
            Image(uiImage: image).resizable().scaledToFit().clipShape(.rect(cornerRadius: 18))
                .transition(.opacity)
        case .reading:
            VStack(spacing: 10) {
                ProgressView().tint(.white)
                Text("Looking at your photo…").foregroundStyle(.white.opacity(0.8))
            }
        case .none:
            Color.clear
        }
    }

    private func recent(_ call: VoiceCall) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(call.shown.enumerated()), id: \.offset) { _, item in
                    Button { withAnimation(.snappy) { call.show(item) } } label: {
                        Group {
                            switch item {
                            case .photo(let image): Image(uiImage: image).resizable().scaledToFill()
                            case .visual: Image(systemName: "chart.xyaxis.line").font(.title3).foregroundStyle(.white)
                            default: Color.clear
                            }
                        }
                        .frame(width: 48, height: 48)
                        .background(.white.opacity(0.12))
                        .clipShape(.rect(cornerRadius: 10))
                    }
                }
            }
            .padding(.horizontal, 20)
        }
        .frame(height: 50)
    }

    private var captions: some View {
        VStack(spacing: 8) {
            switch call?.state ?? .connecting {
            case .connecting:
                Text("Connecting…").foregroundStyle(.white.opacity(0.7))
            case .failed(let message):
                Text(message).foregroundStyle(.white).multilineTextAlignment(.center)
            case .ending:
                Text("Saving…").foregroundStyle(.white.opacity(0.7))
            case .live:
                if let student = call?.studentCaption, !student.isEmpty {
                    Text(student)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.55))
                        .lineLimit(2)
                }
                Text(tail(call?.tutorCaption ?? ""))
                    .font(.title3.weight(.medium))
                    .foregroundStyle(.white)
                    .lineLimit(3)
                    .contentTransition(.opacity)
            }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 28)
        .frame(minHeight: 110, alignment: .bottom)
        .animation(.easeOut(duration: 0.2), value: call?.tutorCaption)
    }

    /// The last couple of sentences, so the caption keeps up with the voice.
    private func tail(_ text: String) -> String {
        guard text.count > 160 else { return text }
        let cut = text.index(text.endIndex, offsetBy: -160)
        let rest = text[cut...]
        if let space = rest.firstIndex(of: " ") { return "…" + rest[rest.index(after: space)...] }
        return "…" + rest
    }

    private var controls: some View {
        HStack(spacing: 28) {
            Button {
                call?.muted.toggle()
            } label: {
                Image(systemName: call?.muted == true ? "mic.slash.fill" : "mic.fill")
                    .font(.title2)
                    .frame(width: 64, height: 64)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel(call?.muted == true ? "Unmute" : "Mute")

            Button { showingCamera = true } label: {
                Image(systemName: "camera.fill").font(.title2).frame(width: 64, height: 64)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .disabled(call?.state != .live)
            .accessibilityLabel("Camera")

            Button {
                Task {
                    await call?.hangUp()
                    onEnd()
                    dismiss()
                }
            } label: {
                Image(systemName: "xmark").font(.title2.weight(.semibold)).frame(width: 64, height: 64)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .tint(.red)
            .accessibilityLabel("End")
        }
        .foregroundStyle(.white)
    }
}

/// Slow, drifting color that swells with the voices: the student's in cool
/// tones, the tutor's in the warm hydrant reds.
struct VoiceBackground: View {
    let input: Float
    let output: Float

    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let you = Double(min(1, input * 1.6))
            let tutor = Double(min(1, output * 1.6))
            let drift = { (speed: Double, phase: Double, amount: Double) -> Float in Float(sin(t * speed + phase) * amount) }
            MeshGradient(
                width: 3, height: 3,
                points: [
                    [0, 0], [0.5 + drift(0.3, 0, 0.1), 0], [1, 0],
                    [0, 0.5 + drift(0.25, 1, 0.1)],
                    [0.5 + drift(0.4, 2, 0.12 + tutor * 0.1), 0.5 + drift(0.35, 3, 0.12 + you * 0.1)],
                    [1, 0.5 + drift(0.2, 4, 0.1)],
                    [0, 1], [0.5 + drift(0.33, 5, 0.1), 1], [1, 1],
                ],
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.10),
                    Color(red: 0.10 + 0.25 * tutor, green: 0.05, blue: 0.12),
                    Color(red: 0.05, green: 0.07, blue: 0.16 + 0.2 * you),
                    Color(red: 0.08, green: 0.10, blue: 0.22 + 0.35 * you),
                    Color(red: 0.45 + 0.4 * tutor, green: 0.10 + 0.1 * tutor, blue: 0.12),
                    Color(red: 0.30 + 0.3 * tutor, green: 0.08, blue: 0.20),
                    Color(red: 0.04, green: 0.05, blue: 0.10),
                    Color(red: 0.12, green: 0.08, blue: 0.18 + 0.25 * you),
                    Color(red: 0.06, green: 0.05, blue: 0.12),
                ]
            )
            .animation(.easeOut(duration: 0.25), value: tutor)
        }
    }
}
