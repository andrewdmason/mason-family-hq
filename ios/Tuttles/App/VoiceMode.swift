import AVFoundation
import SwiftUI

// Voice mode: a spoken conversation with the tutor inside a chat
// (src/lib/tuttles/voice.ts), walkie-talkie style. The website hands out a
// short-lived key already set up with the tutor's instructions; while the big
// button is held the phone streams the microphone to OpenAI's realtime model
// over a WebSocket, and letting go ends the turn and asks for the reply. Only
// what's said with the button down is heard, so a busy room doesn't count.
// Pressing the button while the tutor talks cuts it off. The tutor
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
    /// The talk button is held down.
    private(set) var talking = false
    /// Let go, and the tutor hasn't started answering yet.
    private(set) var waiting = false
    /// A nudge shown where the student's words go (e.g. after a quick tap).
    private(set) var hint: String?
    /// 0…1, for the background. The microphone only counts while talking.
    private(set) var inputLevel: Float = 0
    private(set) var outputLevel: Float = 0
    /// The microphone is going to the tutor: while the button is held, and a
    /// beat after so the last word isn't clipped.
    private var listening = false
    private var pressedAt = Date()
    /// A reply is being made (between response.created and response.done).
    private var responding = false
    /// The assistant message whose voice is playing, to cut off.
    private var playingItem: String?

    private(set) var turns: [Turn] = []
    let threadID: UUID
    let assignmentID: Int?
    private let store: ChatStore

    private var socket: URLSessionWebSocketTask?
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    /// The walkie-talkie chirps.
    private let beeper = AVAudioPlayerNode()
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
            // The key comes from the website: ask for it straight away.
            let keyRequest = Task { try await store.voiceKey(threadID: threadID, assignmentID: assignmentID) }
            // Starting the audio (echo cancelling especially) holds up the
            // main thread for a moment, which would stutter the call opening;
            // it waits until that's done. Then the talk button works (and
            // chirps) even before the line is open: anything said waits in
            // the outbox.
            try? await Task.sleep(for: .milliseconds(520))
            try startAudio()
            let key = try await keyRequest.value
            var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/realtime?model=\(key.model)")!)
            request.setValue("Bearer \(key.key)", forHTTPHeaderField: "Authorization")
            let socket = URLSession.shared.webSocketTask(with: request)
            self.socket = socket
            socket.resume()
            Task { await receive() }
            // Push to talk: no voice detection; each turn is committed by hand.
            send(["type": "session.update", "session": [
                "type": "realtime",
                "audio": ["input": ["turn_detection": NSNull()]],
            ]])
            let queued = outbox
            outbox = []
            queued.forEach { socket.send(.string($0)) { _ in } }
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

    // MARK: Push to talk

    /// The talk button went down: cut the tutor off and start listening.
    func press() {
        guard state == .live || state == .connecting, !talking else { return }
        talking = true
        // What they said last time goes; the new words show once written out.
        studentCaption = ""
        hint = nil
        waiting = false
        pressedAt = .now
        beep(pressChirp)
        pressHaptic.impactOccurred()
        pressHaptic.prepare()
        interruptTutor()
        send(["type": "input_audio_buffer.clear"])
        listening = true
    }

    /// The talk button came up: end the turn and ask for the reply.
    func release() {
        guard talking else { return }
        talking = false
        releaseHaptic.impactOccurred()
        releaseHaptic.prepare()
        let held = Date().timeIntervalSince(pressedAt)
        Task {
            // The microphone's last chunk is still on its way in.
            try? await Task.sleep(for: .milliseconds(200))
            guard !talking else { return }
            listening = false
            inputLevel = 0
            if held < 0.35 {
                send(["type": "input_audio_buffer.clear"])
                hint = "Hold the button down while you talk"
                return
            }
            beep(releaseChirp)
            send(["type": "input_audio_buffer.commit"])
            send(["type": "response.create"])
            waiting = true
        }
    }

    /// Stop the tutor mid-sentence, and tell the model where it was cut off.
    private func interruptTutor() {
        // Marked quiet: if they arrive too late to matter, the error isn't shown.
        if responding { send(["type": "response.cancel", "event_id": "quiet-cancel-\(UUID().uuidString)"]) }
        if pendingPlayback > 0, let item = playingItem {
            send(["type": "conversation.item.truncate", "event_id": "quiet-truncate-\(UUID().uuidString)",
                  "item_id": item, "content_index": 0,
                  "audio_end_ms": playedSamples * 1000 / 24000])
        }
        if engine.isRunning {
            player.stop()
            player.play()
        }
        // Cut off: the caption stops where the voice did.
        receivedSamples = playedSamples
        captionID += 1
    }

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
        case "response.created":
            responding = true
        case "response.done":
            responding = false
            waiting = false
        case "response.output_audio.delta":
            // A reply cancelled by pressing the button can still trickle in.
            guard !talking, let b64 = e["delta"] as? String, let pcm = Data(base64Encoded: b64) else { return }
            if let id = e["item_id"] as? String { playingItem = id }
            waiting = false
            play(pcm)
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
            let error = e["error"] as? [String: Any]
            let message = error?["message"] as? String ?? "Something went wrong."
            VoiceLog.say("error: \(message)")
            // Cancelling a reply that just finished, or a turn with no audio,
            // isn't worth showing.
            let code = error?["code"] as? String ?? ""
            let quiet = (error?["event_id"] as? String)?.hasPrefix("quiet-") == true
            guard !quiet, !["response_cancel_not_active", "input_audio_buffer_commit_empty"].contains(code) else { return }
            waiting = false
            tutorCaption = message
        default:
            break
        }
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
        guard let data = try? JSONSerialization.data(withJSONObject: event),
              let text = String(data: data, encoding: .utf8) else { return }
        if let socket {
            socket.send(.string(text)) { _ in }
        } else if state == .connecting {
            outbox.append(text)
        }
    }

    /// Events from before the line opened (talking while it connects).
    private var outbox: [String] = []

    // MARK: Audio

    private func startAudio() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        // Short audio buffers: the chirp and the level meter respond at once.
        try? session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)
        pressHaptic.prepare()
        releaseHaptic.prepare()
        pressChirp = Self.render(Self.pressSound, format: playFormat)
        releaseChirp = Self.render(Self.releaseSound, format: playFormat)
        // Echo cancellation, so the tutor doesn't hear itself. Must come before
        // anything else touches the engine's nodes.
        try engine.inputNode.setVoiceProcessingEnabled(true)

        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: playFormat)
        engine.attach(beeper)
        engine.connect(beeper, to: engine.mainMixerNode, format: playFormat)

        // With echo cancellation on, the microphone can arrive as several
        // channels; the first one is the voice. It's taken alone and then
        // converted to what the realtime model wants (24 kHz, 16-bit, mono).
        let inFormat = engine.inputNode.outputFormat(forBus: 0)
        guard let mono = AVAudioFormat(standardFormatWithSampleRate: inFormat.sampleRate, channels: 1),
              let converter = AVAudioConverter(from: mono, to: sendFormat) else { throw VoiceError.audio }
        VoiceLog.say("mic format \(inFormat)")
        let sendFormat = self.sendFormat
        engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { [weak self] buffer, _ in
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
                guard let self, self.listening, self.state == .live || self.state == .connecting else { return }
                // Rises fairly quickly with a voice, settles slowly after it.
                let rate: Float = level > self.inputLevel ? 0.25 : 0.06
                self.inputLevel += (level - self.inputLevel) * rate
                self.sentChunks += 1
                if self.sentChunks == 1 || self.sentChunks % 50 == 0 { VoiceLog.say("mic chunks sent: \(self.sentChunks)") }
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
        beeper.play()
        VoiceLog.say("audio started; route \(session.currentRoute.outputs.map(\.portType.rawValue)); echo cancelling: \(engine.inputNode.isVoiceProcessingEnabled)")
    }

    /// The tutor's voice still queued to play, in buffers.
    private var pendingPlayback = 0

    private var sentChunks = 0
    private var playedChunks = 0
    private var configObserver: NSObjectProtocol?

    private func restartAudio() {
        guard state == .live || state == .connecting else { return }
        VoiceLog.say("audio configuration changed; running: \(engine.isRunning); echo cancelling: \(engine.inputNode.isVoiceProcessingEnabled)")
        if !engine.isRunning {
            engine.connect(player, to: engine.mainMixerNode, format: playFormat)
            engine.connect(beeper, to: engine.mainMixerNode, format: playFormat)
            try? engine.start()
        }
        player.play()
        beeper.play()
    }

    private func stopAudio() {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
        configObserver = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.mainMixerNode.removeTap(onBus: 0)
        player.stop()
        beeper.stop()
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

    // MARK: Beeps

    /// Rendered once, when the call's audio starts.
    @ObservationIgnored private var pressChirp: AVAudioPCMBuffer?
    @ObservationIgnored private var releaseChirp: AVAudioPCMBuffer?
    private let pressHaptic = UIImpactFeedbackGenerator(style: .heavy)
    private let releaseHaptic = UIImpactFeedbackGenerator(style: .light)

    private func beep(_ buffer: AVAudioPCMBuffer?) {
        guard let buffer, engine.isRunning else { return }
        beeper.scheduleBuffer(buffer, at: nil, options: .interrupts)
        if !beeper.isPlaying { beeper.play() }
    }

    enum Chirp {
        case tone(hz: Double, seconds: Double)
        case hiss(seconds: Double)
    }

    /// Up, like keying a walkie-talkie.
    static let pressSound: [Chirp] = [.tone(hz: 1250, seconds: 0.045), .tone(hz: 1870, seconds: 0.065)]
    /// Down, then a little burst of static: "over."
    static let releaseSound: [Chirp] = [.tone(hz: 1870, seconds: 0.045), .tone(hz: 1250, seconds: 0.06), .hiss(seconds: 0.09)]

    nonisolated static func render(_ chirp: [Chirp], format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let rate = format.sampleRate
        let counts = chirp.map { part -> Int in
            switch part {
            case .tone(_, let seconds), .hiss(let seconds): Int(seconds * rate)
            }
        }
        let total = counts.reduce(0, +)
        guard total > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(total)) else { return nil }
        buffer.frameLength = AVAudioFrameCount(total)
        let out = buffer.floatChannelData![0]
        let ramp = 0.004 * rate
        var at = 0
        var phase = 0.0
        for (part, count) in zip(chirp, counts) {
            for k in 0..<count {
                let fade = min(1, Double(k) / ramp, Double(count - k) / ramp)
                switch part {
                case .tone(let hz, _):
                    phase += 2 * .pi * hz / rate
                    out[at] = Float(sin(phase) * fade * 0.1)
                case .hiss:
                    out[at] = Float(Double.random(in: -1...1) * 0.03 * (1 - Double(k) / Double(count)))
                }
                at += 1
            }
        }
        return buffer
    }

    enum VoiceError: LocalizedError {
        case audio
        var errorDescription: String? { "The microphone couldn't start." }
    }
}

// MARK: - The screen

/// The call, laid over the chat. Its camera and hang-up live in the chat's
/// top bar (where the call button was), so they don't move in and out.
struct VoiceView: View {
    let call: VoiceCall?
    /// Shared with the chat, so its message box can become the talk bar.
    let space: Namespace.ID

    var body: some View {
        ZStack {
            VoiceBackground(input: call?.inputLevel ?? 0, output: call?.outputLevel ?? 0, listening: call?.talking == true)
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
        .environment(\.colorScheme, .dark)
        // The talk button sits near the bottom edge, where iOS otherwise holds
        // touches back while it checks for the home swipe.
        .defersSystemGestures(on: .bottom)
        .task { await call?.start() }
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

    /// The top of the screen is the student's: what they last said, written
    /// out (the button itself shows them being heard).
    private var studentArea: some View {
        ZStack {
            if call?.talking == true {
                EmptyView()
            } else if let hint = call?.hint {
                Label(hint, systemImage: "hand.point.down.fill")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.white.opacity(0.85))
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
        .animation(.easeOut(duration: 0.2), value: call?.talking)
        .animation(.easeOut(duration: 0.2), value: call?.hint)
        .animation(.easeOut(duration: 0.2), value: call?.studentCaption)
    }

    private var captions: some View {
        VStack(spacing: 8) {
            switch call?.state ?? .connecting {
            case .failed(let message):
                Text(message).foregroundStyle(.white).multilineTextAlignment(.center)
            case .ending:
                Text("Saving…").foregroundStyle(.white.opacity(0.7))
            case .live, .connecting:
                // Connecting needs no caption: anything said while it connects
                // is held and sent when the line opens.
                if call?.waiting == true {
                    CallThinkingDots().transition(.opacity)
                } else if call?.tutorCaption.isEmpty == true, call?.talking == false {
                    Text("Ready when you are! Hold the button and talk.")
                        .font(.title3.weight(.medium))
                        .foregroundStyle(.white.opacity(0.7))
                        .transition(.opacity)
                } else {
                    SpokenCaption(text: call?.tutorCaption ?? "", spokenShare: call?.spokenShare ?? 0, replyID: call?.captionID ?? 0)
                }
            }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 28)
        .frame(minHeight: 110, alignment: .bottom)
        .animation(.easeOut(duration: 0.2), value: call?.waiting)
    }

    /// The big talk button, the whole width.
    private var controls: some View {
        HStack {
            TalkBarButton(
                enabled: call?.state == .live || call?.state == .connecting,
                talking: call?.talking == true,
                level: call?.inputLevel ?? 0,
                onPress: { call?.press() },
                onRelease: { call?.release() }
            )
            .matchedGeometryEffect(id: "talkBar", in: space)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
    }
}

/// The walkie-talkie button: hold it down and talk, let go when done.
struct TalkBarButton: View {
    let enabled: Bool
    let talking: Bool
    let level: Float
    let onPress: () -> Void
    let onRelease: () -> Void

    @State private var down = false

    var body: some View {
        ZStack {
            if talking {
                ListeningWave(level: level)
                    .scaleEffect(0.8)
                    .transition(.opacity)
            } else {
                Label("Hold to talk", systemImage: "mic.fill")
                    .font(.title3.weight(.bold))
                    .transition(.opacity)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .frame(height: 84)
        .glassEffect(.regular.tint(talking ? TuttlesLook.accent : TuttlesLook.accent.opacity(0.35)), in: .capsule)
        .shadow(color: TuttlesLook.accent.opacity(talking ? 0.7 : 0), radius: 22)
        .scaleEffect(down ? 0.95 : 1)
        .opacity(enabled ? 1 : 0.45)
        .animation(.snappy(duration: 0.18), value: down)
        .animation(.easeOut(duration: 0.15), value: talking)
        .overlay {
            // UIKit touches, not a SwiftUI gesture: it fires on touch-down
            // with nothing in between.
            TouchDownArea(
                onDown: {
                    guard enabled, !down else { return }
                    down = true
                    onPress()
                },
                onUp: {
                    guard down else { return }
                    down = false
                    onRelease()
                }
            )
            .clipShape(.capsule)
        }
        .accessibilityElement()
        .accessibilityLabel(talking ? "Listening" : "Hold to talk")
        .accessibilityAddTraits(.isButton)
    }
}

/// A plain view that reports a finger landing and lifting, straight from
/// UIKit's touch callbacks.
private struct TouchDownArea: UIViewRepresentable {
    let onDown: () -> Void
    let onUp: () -> Void

    func makeUIView(context: Context) -> TouchView { TouchView() }

    func updateUIView(_ view: TouchView, context: Context) {
        view.onDown = onDown
        view.onUp = onUp
    }

    final class TouchView: UIView {
        var onDown: () -> Void = {}
        var onUp: () -> Void = {}

        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .clear
            isMultipleTouchEnabled = false
        }

        required init?(coder: NSCoder) { fatalError() }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) { onDown() }
        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { onUp() }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { onUp() }
    }
}

/// Three dots that pulse while the tutor works out what to say.
struct CallThinkingDots: View {
    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(.white)
                        .frame(width: 10, height: 10)
                        .opacity(0.35 + 0.65 * (sin(t * 5 - Double(i) * 0.8) + 1) / 2)
                }
            }
        }
        .accessibilityLabel("Thinking")
    }
}

/// Slow, drifting color that swells with the voices. The tutor talking is
/// the warm hydrant reds. Holding the talk button turns it to cool, lit-up
/// aqua and violet — the room going quiet to listen — which breathes gently
/// while waiting and blooms brighter and wider with the student's voice.
struct VoiceBackground: View {
    let input: Float
    let output: Float
    let listening: Bool

    /// The blend toward the listening colors, 0…1, eased over `fade`.
    @State private var from: Double = 0
    @State private var to: Double = 0
    @State private var changedAt = Date.distantPast
    private static let fade: TimeInterval = 0.35

    var body: some View {
        TimelineView(.animation) { context in
            let now = context.date
            let t = now.timeIntervalSinceReferenceDate
            let l = blend(at: now)
            let tutor = Double(min(1, output * 1.6))
            // Below the floor is the room, not the student: it doesn't count.
            let floor = 0.18
            let you = min(1, max(0, Double(input) - floor) / (1 - floor) * 1.4) * l
            // A slow in-and-out breath while it waits for words.
            let breath = (sin(t * 1.6) + 1) / 2 * l * (1 - you)
            let drift = { (speed: Double, phase: Double, amount: Double) -> Float in Float(sin(t * speed + phase) * amount) }
            // The middle reaches out toward the edges as they talk.
            let reach = Float(you * 0.08)
            MeshGradient(
                width: 3, height: 3,
                points: [
                    [0, 0], [0.5 + drift(0.3, 0, 0.1), 0], [1, 0],
                    [0, 0.5 + drift(0.25, 1, 0.1 + Double(reach))],
                    // The voice changes how far it drifts, never how fast:
                    // changing the speed jumps the phase.
                    [0.5 + drift(0.4, 2, 0.12 + tutor * 0.1 + you * 0.06),
                     0.5 + drift(0.35, 3, 0.12 + you * 0.06)],
                    [1, 0.5 + drift(0.2, 4, 0.1 + Double(reach))],
                    [0, 1], [0.5 + drift(0.33, 5, 0.1), 1], [1, 1],
                ],
                colors: zip(Self.speaking(tutor: tutor), Self.listening(you: you, breath: breath))
                    .map { Self.mix($0, $1, l) }
            )
        }
        .onChange(of: listening) { _, isListening in
            // Start from wherever the fade is now (it may be mid-way), headed
            // the new way.
            let now = Date()
            from = blend(at: now)
            to = isListening ? 1 : 0
            changedAt = now
        }
    }

    private func blend(at now: Date) -> Double {
        let p = min(1, now.timeIntervalSince(changedAt) / Self.fade)
        let eased = p * p * (3 - 2 * p)
        return from + (to - from) * eased
    }

    typealias RGB = SIMD3<Double>

    /// The resting and tutor-talking colors, top-left to bottom-right.
    static func speaking(tutor: Double) -> [RGB] {
        [
            [0.05, 0.05, 0.10],
            [0.10 + 0.25 * tutor, 0.05, 0.12],
            [0.05, 0.07, 0.16],
            [0.08, 0.10, 0.22],
            [0.45 + 0.4 * tutor, 0.10 + 0.1 * tutor, 0.12],
            [0.30 + 0.3 * tutor, 0.08, 0.20],
            [0.04, 0.05, 0.10],
            [0.12, 0.08, 0.18],
            [0.06, 0.05, 0.12],
        ]
    }

    /// Listening: deep blue at the edges, violet at the sides, an aqua glow in
    /// the middle that brightens with the voice.
    static func listening(you: Double, breath: Double) -> [RGB] {
        let glow = 0.25 * breath + you
        return [
            [0.03, 0.04, 0.12],
            [0.06, 0.16 + 0.18 * glow, 0.30 + 0.15 * glow],
            [0.08, 0.05, 0.20 + 0.1 * glow],
            [0.20 + 0.15 * glow, 0.10, 0.42 + 0.2 * glow],
            [0.10 + 0.25 * glow, 0.50 + 0.38 * glow, 0.62 + 0.3 * glow],
            [0.32 + 0.2 * glow, 0.14 + 0.1 * glow, 0.55 + 0.2 * glow],
            [0.03, 0.05, 0.14],
            [0.05, 0.28 + 0.3 * glow, 0.42 + 0.25 * glow],
            [0.06, 0.04, 0.16],
        ]
    }

    static func mix(_ a: RGB, _ b: RGB, _ t: Double) -> Color {
        let c = a + (b - a) * t
        return Color(red: min(1, c.x), green: min(1, c.y), blue: min(1, c.z))
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
