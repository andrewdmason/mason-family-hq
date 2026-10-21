import AVFoundation
import MediaPlayer
import Observation

/// The count-in's arithmetic, kept apart from the audio so it can be tested.
struct CountIn: Equatable {
    /// Where the recording starts (seconds in), and how long to wait first
    /// when the pre-roll would reach back before the start of the recording.
    let startAt: Double
    let silentLead: Double
    /// One beat of wall-clock time at the current speed.
    let beatSeconds: Double
    let beats: Int

    /// `beats` beats of the recording before `target`, at the song's tempo
    /// and the current speed. Pre-roll that would start before 0 is silence.
    init(target: Double, beats: Int, tempo: Double, speed: Double) {
        let beatInRecording = 60 / tempo
        let start = target - Double(beats) * beatInRecording
        startAt = max(0, start)
        silentLead = max(0, -start) / speed
        beatSeconds = beatInRecording / speed
        self.beats = beats
    }

    /// The big number on screen `elapsed` seconds into the count-in: beats,
    /// beats−1… 1, then nil when the target arrives.
    func number(at elapsed: Double) -> Int? {
        let n = beats - Int((elapsed / beatSeconds).rounded(.down))
        return n >= 1 ? n : nil
    }
}

/// Plays a song's tracks together, sample-locked: one player per track into
/// a submix (where each track's volume and pan apply), then a time-pitch unit
/// (speed without changing pitch), a peak limiter, then the main mixer
/// (overall volume).
///
/// Separately recorded parts are each mastered near full scale, so together
/// they add up to well over it (the Brahms Allegro's three parts peak at
/// nearly 2×) and clip. The submix gives back headroom for the number of
/// tracks, and the limiter catches what still pokes over.
@MainActor
@Observable
final class Player {
    static let shared = Player()

    private(set) var songID: UUID?
    private(set) var duration: Double = 0
    private(set) var isPlaying = false
    /// Seconds into the recording, updated while playing.
    private(set) var position: Double = 0
    /// The count-in's big number, while one is running.
    private(set) var countdown: Int?
    /// Tracks whose audio isn't on the phone yet.
    private(set) var missing: Set<UUID> = []

    private var engine = AVAudioEngine()
    private var submix = AVAudioMixerNode()
    private var timePitch = AVAudioUnitTimePitch()
    private var limiter = Player.makeLimiter()
    /// What's loaded, to rebuild from.
    private var loaded: (song: Song, library: Library)?
    private var players: [UUID: (node: AVAudioPlayerNode, file: AVAudioFile)] = [:]
    /// Where the current run started in the recording; the players' clocks
    /// count from there.
    private var segmentStart: Double = 0
    private var countIn: (plan: CountIn, began: Date)?
    private var ticker: Timer?
    /// Shuts the engine down after a while paused (see pause()).
    private var idleTimer: Timer?
    /// When the playhead last moved (or is due to start moving), to catch an
    /// engine that says it's playing but makes no sound.
    private var lastAdvance = Date.distantFuture
    private var lastTickPosition: Double = -1
    private var stallRetried = false
    private var title = ""
    private var artist: String?

    private init() {
        connectGraph()
        let center = NotificationCenter.default
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            MainActor.assumeIsolated { if began { self?.pause() } }
        }
        // Headphones or AirPods in or out, a sample-rate change, or the audio
        // system restarting: the engine stops itself and can refuse to start
        // again as it was. Start over with a fresh one and pick up where it was.
        center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self, (note.object as? AVAudioEngine) === self.engine else { return }
                self.rebuild(reason: "configuration change")
            }
        }
        center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuild(reason: "media services reset") }
        }
        setUpRemoteCommands()
    }

    private func connectGraph() {
        engine.attach(submix)
        engine.attach(timePitch)
        engine.attach(limiter)
        engine.connect(submix, to: timePitch, format: nil)
        engine.connect(timePitch, to: limiter, format: nil)
        engine.connect(limiter, to: engine.mainMixerNode, format: nil)
    }

    private static func makeLimiter() -> AVAudioUnitEffect {
        AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
            componentType: kAudioUnitType_Effect,
            componentSubType: kAudioUnitSubType_PeakLimiter,
            componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0, componentFlagsMask: 0
        ))
    }

    /// A brand-new engine with the loaded song in it, at the same spot,
    /// still playing if it was.
    private func rebuild(reason: String) {
        PlayerLog.write("rebuilding engine: \(reason)")
        let wasPlaying = isPlaying
        let at = wasPlaying ? currentPosition() : position
        ticker?.invalidate()
        stopPlayers()
        engine.stop()
        isPlaying = false
        countIn = nil
        countdown = nil
        players = [:]
        engine = AVAudioEngine()
        submix = AVAudioMixerNode()
        timePitch = AVAudioUnitTimePitch()
        limiter = Player.makeLimiter()
        connectGraph()
        if let (song, library) = loaded {
            songID = nil
            load(song, library: library)
        }
        position = min(at, duration)
        if wasPlaying { play(from: position) }
    }

    // MARK: Loading

    /// Loads a song's tracks (the ones whose audio is here) and its mix.
    /// Reloading the same song keeps the playhead.
    func load(_ song: Song, library: Library) {
        let same = song.id == songID
        let resume = same && isPlaying
        let at = same ? position : 0
        stopPlayers()
        isPlaying = false
        countIn = nil
        countdown = nil
        for (_, p) in players { engine.detach(p.node) }
        players = [:]
        missing = []
        for track in song.tracks {
            guard let file = try? AVAudioFile(forReading: library.audioURL(track)) else {
                missing.insert(track.id)
                continue
            }
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: submix, fromBus: 0, toBus: submix.nextAvailableInputBus, format: file.processingFormat)
            players[track.id] = (node, file)
        }
        // Headroom for summing full-scale parts: −4.8 dB for three tracks.
        submix.outputVolume = players.isEmpty ? 1 : Float(1 / Double(players.count).squareRoot())
        duration = players.values.map { Double($0.file.length) / $0.file.processingFormat.sampleRate }.max() ?? 0
        songID = song.id
        loaded = (song, library)
        title = song.displayName
        artist = song.artist
        position = min(at, duration)
        apply(song)
        if resume { play(from: position) }
        updateNowPlaying()
    }

    /// The mix, speed and volume, live.
    func apply(_ song: Song) {
        if song.id == loaded?.song.id { loaded?.song = song }
        for track in song.tracks {
            guard let node = players[track.id]?.node else { continue }
            node.volume = track.enabled ? Float(track.volume) : 0
            node.pan = Float(track.pan)
        }
        timePitch.rate = Float(song.speed)
        engine.mainMixerNode.outputVolume = Float(song.volume)
    }

    // MARK: Transport

    /// Starts playing at `time`, every track at the same instant, optionally
    /// after `delay` seconds of silence.
    func play(from time: Double, delay: Double = 0, retry: Bool = true) {
        guard !players.isEmpty else { return }
        idleTimer?.invalidate()
        stopPlayers()
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            if !engine.isRunning { try engine.start() }
        } catch {
            PlayerLog.write("audio start failed: \(error)")
            // An engine left stale by the audio system: once more on a new one.
            guard retry else { return }
            position = time
            rebuild(reason: "start failed")
            play(from: time, delay: delay, retry: false)
            return
        }
        let start = min(max(0, time), duration)
        segmentStart = start
        position = start
        // A shared start time a moment ahead, so the tracks start together.
        let when = AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.05 + delay))
        for (_, p) in players {
            let rate = p.file.processingFormat.sampleRate
            let first = AVAudioFramePosition(start * rate)
            guard first < p.file.length else { continue }
            p.node.scheduleSegment(p.file, startingFrame: first, frameCount: AVAudioFrameCount(p.file.length - first), at: nil)
            p.node.play(at: when)
        }
        isPlaying = true
        lastAdvance = Date.now.addingTimeInterval(0.05 + delay)
        lastTickPosition = start
        startTicker()
        updateNowPlaying()
    }

    /// Plays into `target` with `beats` beats of the recording before it,
    /// counting down on screen.
    func countIn(to target: Double, beats: Int, tempo: Double, speed: Double) {
        let plan = CountIn(target: target, beats: beats, tempo: tempo, speed: speed)
        play(from: plan.startAt, delay: plan.silentLead)
        guard isPlaying else { return }
        countIn = (plan, Date.now.addingTimeInterval(0.05))
        countdown = plan.beats
    }

    func pause() {
        guard isPlaying else { return }
        position = currentPosition()
        stallRetried = false
        stopPlayers()
        isPlaying = false
        countIn = nil
        countdown = nil
        ticker?.invalidate()
        // The engine keeps running, silent, so Play answers at once (waking
        // the audio output, Bluetooth especially, takes a second or two).
        // After a few minutes paused it shuts down to save battery.
        idleTimer?.invalidate()
        let timer = Timer(timeInterval: 300, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.sleep() }
        }
        RunLoop.main.add(timer, forMode: .common)
        idleTimer = timer
        updateNowPlaying()
    }

    /// Paused and out of sight: stop the engine so the app can sleep too.
    func sleep() {
        guard !isPlaying else { return }
        idleTimer?.invalidate()
        engine.stop()
    }

    /// Back from another app. iOS may have taken the audio away meanwhile
    /// and left the engine claiming to run without making sound, so start
    /// from a fresh one.
    func wake() {
        guard !isPlaying, loaded != nil else { return }
        rebuild(reason: "back in the foreground")
    }

    /// Moves the playhead; keeps playing if it was.
    func seek(to time: Double) {
        let t = min(max(0, time), duration)
        if isPlaying {
            countIn = nil
            countdown = nil
            play(from: t)
        } else {
            position = t
            updateNowPlaying()
        }
    }

    private func stopPlayers() {
        for (_, p) in players { p.node.stop() }
    }

    /// The recording's position by the first track's clock (the players
    /// count source samples, so speed is already accounted for).
    private func currentPosition() -> Double {
        guard isPlaying, let p = players.values.first,
              let nodeTime = p.node.lastRenderTime,
              let playerTime = p.node.playerTime(forNodeTime: nodeTime)
        else { return position }
        return segmentStart + max(0, Double(playerTime.sampleTime) / playerTime.sampleRate)
    }

    private func startTicker() {
        ticker?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func tick() {
        guard isPlaying else { return }
        position = currentPosition()
        // Playing, but the playhead hasn't moved for a second: the engine is
        // dead. Start over on a fresh one, once per press of Play.
        let now = Date.now
        if position != lastTickPosition {
            lastTickPosition = position
            lastAdvance = now
            stallRetried = false
        } else if now.timeIntervalSince(lastAdvance) > 1, !stallRetried {
            PlayerLog.write("stalled at \(position) (engine running: \(engine.isRunning)); rebuilding")
            stallRetried = true
            rebuild(reason: "stalled")
            return
        }
        if let (plan, began) = countIn {
            countdown = plan.number(at: Date.now.timeIntervalSince(began))
            if countdown == nil { countIn = nil }
        }
        if position >= duration - 0.02 {
            pause()
            position = duration
        }
    }

    // MARK: Lock screen

    private func setUpRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.play(from: self?.position ?? 0) }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.isPlaying { self.pause() } else { self.play(from: self.position) }
            }
            return .success
        }
    }

    private func updateNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = songID == nil ? nil : [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist ?? "",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(timePitch.rate) : 0,
        ]
    }
}

/// Audio errors, kept in a small file in the app's folder so they can be read
/// off the phone after the fact.
enum PlayerLog {
    static func write(_ message: String) {
        print("player: \(message)")
        let url = URL.applicationSupportDirectory.appending(path: "MusicMinusOne/player-log.txt")
        let line = "\(ISO8601DateFormatter().string(from: .now)) \(message)\n"
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: url)
        }
    }
}
