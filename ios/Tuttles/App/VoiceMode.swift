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
    /// How much of the current reply's voice has played, as a share of what's
    /// arrived so far. Captions reveal words in step with it.
    private(set) var spokenShare: Double = 0
    /// A new reply started (captions start a fresh page).
    private(set) var captionID = 0
    private var receivedSamples = 0
    private var playedSamples = 0
    private(set) var studentCaption = ""
    /// The student is talking right now (from the server's voice detection).
    private(set) var studentSpeaking = false
    /// The student finished and the tutor hasn't started answering yet.
    private(set) var thinking = false
    private var stoppedAt: Date?
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
            // The tutor picks up like a friend answering the phone: a word or
            // two, then it waits.
            send(["type": "response.create", "response": [
                "instructions": "Say exactly \"\(Self.greeting(name: store.classes?.student.name))\" and nothing else.",
            ]])
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
        if let type = e["type"] as? String, !type.hasSuffix(".delta") { VoiceLog.say("event \(type)") }
        switch e["type"] as? String {
        case "response.output_audio.delta":
            if thinking {
                thinking = false
                if let stoppedAt { VoiceLog.say("reply started \(Int(Date().timeIntervalSince(stoppedAt) * 1000))ms after the student stopped") }
                stoppedAt = nil
            }
            if let b64 = e["delta"] as? String, let pcm = Data(base64Encoded: b64) { play(pcm) }
        case "response.output_item.added":
            if let item = e["item"] as? [String: Any], item["type"] as? String == "message", let id = item["id"] as? String {
                turns.append(Turn(id: id, role: "assistant"))
                tutorCaption = ""
                receivedSamples = 0
                playedSamples = 0
                spokenShare = 0
                captionID += 1
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
            studentSpeaking = true
            thinking = false
            // Cut off: the caption stops where the voice did.
            receivedSamples = playedSamples
        case "input_audio_buffer.speech_stopped":
            studentSpeaking = false
            thinking = true
            stoppedAt = Date()
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
            thinking = false
        default:
            break
        }
    }

    static func greeting(name: String?) -> String {
        var options = ["Hey!", "Hey, what's up?", "Hi!", "What's up?", "Hey there!"]
        if let name, !name.isEmpty { options += ["Hey \(name)!", "Hi \(name)!"] }
        return options.randomElement()!
    }

    /// show_visual's argument: the visual's JSON, as a string or an object.
    nonisolated static func visual(from arguments: String?) -> String? {
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
        // Echo cancellation, so the tutor doesn't hear itself. Must come before
        // anything else touches the engine's nodes.
        try engine.inputNode.setVoiceProcessingEnabled(true)

        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: playFormat)

        // With echo cancellation on, the microphone can arrive as several
        // channels; the first one is the voice. It's taken alone and then
        // converted to what the realtime model wants (24 kHz, 16-bit, mono).
        let inFormat = engine.inputNode.outputFormat(forBus: 0)
        guard let mono = AVAudioFormat(standardFormatWithSampleRate: inFormat.sampleRate, channels: 1),
              let converter = AVAudioConverter(from: mono, to: sendFormat) else { throw VoiceError.audio }
        VoiceLog.say("mic format \(inFormat)")
        let sendFormat = self.sendFormat
        engine.inputNode.installTap(onBus: 0, bufferSize: 4800, format: inFormat) { [weak self] buffer, _ in
            guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0,
                  let single = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: buffer.frameLength) else { return }
            single.frameLength = buffer.frameLength
            single.floatChannelData![0].update(from: channel, count: Int(buffer.frameLength))
            let level = Self.rms(single)

            let frames = AVAudioFrameCount(Double(single.frameLength) * 24000 / mono.sampleRate) + 16
            guard let out = AVAudioPCMBuffer(pcmFormat: sendFormat, frameCapacity: frames) else { return }
            var fed = false
            var error: NSError?
            let status = converter.convert(to: out, error: &error) { _, inputStatus in
                if fed { inputStatus.pointee = .noDataNow; return nil }
                fed = true
                inputStatus.pointee = .haveData
                return single
            }
            if status == .error || out.frameLength == 0 {
                VoiceLog.once("convert", "mic convert failed: \(status.rawValue) \(error?.localizedDescription ?? "")")
                return
            }
            let bytes = Data(bytes: out.int16ChannelData![0], count: Int(out.frameLength) * 2)
            Task { @MainActor in
                guard let self else { return }
                self.inputLevel = self.inputLevel * 0.6 + level * 0.4
                guard !self.muted, self.state == .live else { return }
                self.sentChunks += 1
                if self.sentChunks == 1 || self.sentChunks % 50 == 0 { VoiceLog.say("mic chunks sent: \(self.sentChunks)") }
                let heard = self.passesEchoGate(level)
                // Silence in place of the echo, so the server's sense of time holds.
                let audio = heard ? bytes : Data(count: bytes.count)
                self.send(["type": "input_audio_buffer.append", "audio": audio.base64EncodedString()])
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
        // The system can stop the engine when the audio route changes (and
        // turning echo cancellation on can be one of those); start it again.
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.restartAudio() }
        }
        engine.prepare()
        try engine.start()
        player.play()
        VoiceLog.say("audio started; route \(session.currentRoute.outputs.map(\.portType.rawValue)); echo cancelling: \(engine.inputNode.isVoiceProcessingEnabled)")
    }

    /// The tutor's voice still queued to play, in buffers.
    private var pendingPlayback = 0
    private var lastPlayback = Date.distantPast
    private var loudRun = 0
    private var echoPeak: Float = 0

    /// Echo guard. The phone's echo cancelling lets some of the tutor's own
    /// voice back into the microphone, which the server then takes for the
    /// student and interrupts itself. While the tutor is talking (and a beat
    /// after), the microphone only counts when it's clearly louder than that
    /// echo for a few chunks running: the student talking over it.
    private func passesEchoGate(_ level: Float) -> Bool {
        let tutorTalking = pendingPlayback > 0 || Date().timeIntervalSince(lastPlayback) < 0.4
        guard tutorTalking else {
            loudRun = 0
            if echoPeak > 0 { VoiceLog.say("echo peak while tutor talked: \(echoPeak)"); echoPeak = 0 }
            return true
        }
        echoPeak = max(echoPeak, level)
        loudRun = level > Self.bargeIn ? loudRun + 1 : 0
        if loudRun >= 3 { VoiceLog.say("barge-in at level \(level)") }
        return loudRun >= 3
    }

    /// Microphone level (0…1, as `rms` scales it) that counts as talking over the tutor.
    static let bargeIn: Float = 0.45

    private var sentChunks = 0
    private var playedChunks = 0
    private var configObserver: NSObjectProtocol?

    private func restartAudio() {
        guard state == .live || state == .connecting else { return }
        VoiceLog.say("audio configuration changed; running: \(engine.isRunning); echo cancelling: \(engine.inputNode.isVoiceProcessingEnabled)")
        if !engine.isRunning {
            engine.connect(player, to: engine.mainMixerNode, format: playFormat)
            try? engine.start()
        }
        player.play()
    }

    private func stopAudio() {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
        configObserver = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.mainMixerNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func play(_ pcm: Data) {
        let count = pcm.count / 2
        receivedSamples += count
        let reply = captionID
        guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(count)) else { return }
        buffer.frameLength = AVAudioFrameCount(count)
        pcm.withUnsafeBytes { raw in
            let src = raw.bindMemory(to: Int16.self)
            let dst = buffer.floatChannelData![0]
            for i in 0..<count { dst[i] = Float(Int16(littleEndian: src[i])) / 32768 }
        }
        pendingPlayback += 1
        player.scheduleBuffer(buffer) { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.pendingPlayback = max(0, self.pendingPlayback - 1)
                self.lastPlayback = Date()
                guard reply == self.captionID else { return }
                self.playedSamples = min(self.receivedSamples, self.playedSamples + count)
                self.spokenShare = self.receivedSamples > 0 ? Double(self.playedSamples) / Double(self.receivedSamples) : 0
            }
        }
        playedChunks += 1
        if playedChunks == 1 || playedChunks % 50 == 0 {
            VoiceLog.say("voice chunks played: \(playedChunks), engine running: \(engine.isRunning), player playing: \(player.isPlaying)")
        }
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
                studentArea
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

    /// The top of the screen is the student's: a live waveform while they talk,
    /// then what they said, written out.
    private var studentArea: some View {
        ZStack {
            if call?.studentSpeaking == true {
                ListeningWave(level: call?.inputLevel ?? 0)
                    .transition(.opacity)
            } else if let said = call?.studentCaption, !said.isEmpty {
                Text(said)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.75))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 76)
        .padding(.horizontal, 28)
        .padding(.top, 8)
        .animation(.easeOut(duration: 0.2), value: call?.studentSpeaking)
        .animation(.easeOut(duration: 0.2), value: call?.studentCaption)
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
                if call?.thinking == true {
                    VoiceThinkingDots()
                        .transition(.opacity)
                } else {
                    SpokenCaption(text: call?.tutorCaption ?? "", spokenShare: call?.spokenShare ?? 0, replyID: call?.captionID ?? 0)
                }
            }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 28)
        .frame(minHeight: 110, alignment: .bottom)
        .animation(.easeOut(duration: 0.2), value: call?.thinking)
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
                Image(systemName: "phone.down.fill").font(.title2).frame(width: 64, height: 64)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .tint(.red)
            .accessibilityLabel("Hang up")
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

/// What voice mode is doing, printed for the Xcode or devicectl console.
enum VoiceLog {
    nonisolated(unsafe) private static var said = Set<String>()
    static func say(_ message: String) { print("[voice] \(message)") }
    static func once(_ key: String, _ message: String) {
        guard !said.contains(key) else { return }
        said.insert(key)
        say(message)
    }
}

/// Three dots pulsing in turn while the tutor works out what to say, so a
/// pause after the student stops reads as "heard you" rather than nothing.
struct VoiceThinkingDots: View {
    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 10) {
                ForEach(0..<3) { i in
                    let phase = (sin((t * 2 * .pi / 1.2) - Double(i) * 0.9) + 1) / 2
                    Circle()
                        .fill(.white.opacity(0.35 + 0.6 * phase))
                        .frame(width: 10, height: 10)
                        .scaleEffect(0.8 + 0.35 * phase)
                }
            }
        }
        .frame(height: 30)
        .accessibilityLabel("Thinking")
    }
}

/// Bars that move with the student's voice, so they can see they're heard.
struct ListeningWave: View {
    let level: Float

    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let loud = CGFloat(min(1, level * 2.2))
            HStack(spacing: 5) {
                ForEach(0..<9, id: \.self) { i in
                    let wobble = (sin(t * 9 + Double(i) * 0.8) + 1) / 2
                    let center = 1 - abs(CGFloat(i) - 4) / 5
                    Capsule()
                        .fill(.white.opacity(0.9))
                        .frame(width: 5, height: 6 + 44 * loud * center * (0.45 + 0.55 * CGFloat(wobble)))
                }
            }
            .animation(.easeOut(duration: 0.08), value: loud)
        }
        .accessibilityLabel("Listening")
    }
}

/// The tutor's words, shown as they're spoken. The reply is split into pages
/// of a sentence or two; a page is laid out in full with the words not yet
/// spoken invisible, so nothing shifts as each word fades in where it sits.
/// The reveal follows the voice actually playing, not the text (which arrives
/// ahead of it), and only ever shows whole words.
struct SpokenCaption: View {
    let text: String
    /// 0…1: how much of the voice received so far has played.
    let spokenShare: Double
    let replyID: Int

    /// When each word (by index) first appeared, for its fade.
    @State private var shownAt: [Int: Date] = [:]
    @State private var lastReply = -1

    private static let pageLength = 110

    var body: some View {
        let words = Self.words(text)
        // Text arrives ahead of the voice, so the share of voice played maps
        // onto the words received; the last word only counts once it's whole.
        let complete = text.last.map { $0 == " " || ".,!?;:".contains($0) } ?? false
        let usable = complete ? words.count : max(0, words.count - 1)
        let spoken = min(usable, Int((Double(usable) * spokenShare).rounded(.up)))
        let pages = Self.pages(words)
        let current = pages.lastIndex { $0.lowerBound < max(spoken, 1) } ?? 0
        let page = pages.isEmpty ? 0..<0 : pages[current]

        TimelineView(.animation) { context in
            let now = context.date
            page.reduce(Text(verbatim: "")) { line, i in
                let age = shownAt[i].map { now.timeIntervalSince($0) } ?? -1
                let opacity = i < spoken ? (age < 0 ? 0 : min(1, age / 0.35)) : 0
                return Text("\(line)\(Text(verbatim: words[i] + " ").foregroundStyle(.white.opacity(opacity)))")
            }
            .font(.title3.weight(.medium))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
        .id("\(replyID)-\(current)")
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.3), value: current)
        .onChange(of: spoken, initial: true) { _, count in
            if lastReply != replyID {
                lastReply = replyID
                shownAt = [:]
            }
            let now = Date()
            for i in 0..<count where shownAt[i] == nil { shownAt[i] = now }
        }
    }

    static func words(_ text: String) -> [String] {
        text.split(whereSeparator: \.isWhitespace).map(String.init)
    }

    /// Word ranges of about two sentences each, breaking at sentence ends.
    static func pages(_ words: [String]) -> [Range<Int>] {
        var pages: [Range<Int>] = []
        var start = 0
        var length = 0
        for (i, word) in words.enumerated() {
            length += word.count + 1
            let sentenceEnd = word.last.map { ".!?".contains($0) } ?? false
            if (sentenceEnd && length > pageLength / 2) || length > pageLength {
                pages.append(start..<(i + 1))
                start = i + 1
                length = 0
            }
        }
        if start < words.count { pages.append(start..<words.count) }
        return pages
    }
}
