import AVFoundation
import Foundation

// Math's sound: effects, the running music, and a bed of sound for wherever
// the run is (MathAssets/audio, all public domain or made for this; see
// CREDITS.txt there). The music goes through a speed-and-pitch unit and a
// reverb, so that as the school goes wrong the same tune slows, sinks and
// echoes instead of a different one starting.

final class MathAudio {
    static let shared = MathAudio()

    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "math.audio")
    private var buffers: [String: AVAudioPCMBuffer] = [:]
    private var voices: [AVAudioPlayerNode] = []
    private var nextVoice = 0
    private let effects = AVAudioMixerNode()

    private let music = AVAudioPlayerNode()
    private let warp = AVAudioUnitTimePitch()
    private let echo = AVAudioUnitReverb()
    private let bed = AVAudioPlayerNode()
    private var musicName: String?
    private var bedName: String?
    private var ready = false

    var musicOn = true { didSet { queue.async { self.music.volume = self.musicOn ? 0.55 : 0 } } }
    var effectsOn = true { didSet { queue.async { self.effects.outputVolume = self.effectsOn ? 1 : 0; self.bed.volume = self.effectsOn ? 0.5 : 0 } } }

    private static let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!

    private init() {}

    /// Build the engine and read the effects in. Safe to call again.
    func prepare() {
        queue.async { [self] in
            guard !ready else {
                if !engine.isRunning { try? engine.start() }
                return
            }
            try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            try? AVAudioSession.sharedInstance().setActive(true)
            engine.attach(effects)
            engine.connect(effects, to: engine.mainMixerNode, format: Self.format)
            for _ in 0..<10 {
                let v = AVAudioPlayerNode()
                engine.attach(v)
                engine.connect(v, to: effects, format: Self.format)
                voices.append(v)
            }
            for node in [music, bed] { engine.attach(node) }
            engine.attach(warp)
            engine.attach(echo)
            echo.loadFactoryPreset(.cathedral)
            echo.wetDryMix = 0
            engine.connect(music, to: warp, format: Self.format)
            engine.connect(warp, to: echo, format: Self.format)
            engine.connect(echo, to: engine.mainMixerNode, format: Self.format)
            engine.connect(bed, to: engine.mainMixerNode, format: Self.format)
            music.volume = musicOn ? 0.55 : 0
            bed.volume = effectsOn ? 0.5 : 0
            effects.outputVolume = effectsOn ? 1 : 0

            let folder = Bundle.main.bundleURL.appending(path: "MathAssets/audio")
            let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
            for url in files where ["wav", "m4a"].contains(url.pathExtension) {
                if let buffer = Self.read(url) { buffers[url.deletingPathExtension().lastPathComponent] = buffer }
            }
            try? engine.start()
            ready = true
        }
    }

    private static func read(_ url: URL) -> AVAudioPCMBuffer? {
        guard let file = try? AVAudioFile(forReading: url),
              let raw = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
              (try? file.read(into: raw)) != nil else { return nil }
        if file.processingFormat == format { return raw }
        guard let converter = AVAudioConverter(from: file.processingFormat, to: format) else { return nil }
        let ratio = format.sampleRate / file.processingFormat.sampleRate
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(Double(raw.frameLength) * ratio) + 64) else { return nil }
        var fed = false
        var failure: NSError?
        converter.convert(to: out, error: &failure) { _, status in
            if fed {
                status.pointee = .endOfStream
                return nil
            }
            fed = true
            status.pointee = .haveData
            return raw
        }
        return failure == nil ? out : nil
    }

    func play(_ name: String, volume: Float = 1, delay: TimeInterval = 0) {
        queue.asyncAfter(deadline: .now() + delay) { [self] in
            guard ready, effectsOn, engine.isRunning, let buffer = buffers[name], !voices.isEmpty else { return }
            let voice = voices[nextVoice]
            nextVoice = (nextVoice + 1) % voices.count
            voice.stop()
            voice.volume = volume
            voice.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
            voice.play()
        }
    }

    /// The loop under everything: "music-run" in a run, "music-menu" otherwise.
    func setMusic(_ name: String?) {
        queue.async { [self] in
            guard ready, name != musicName else { return }
            musicName = name
            music.stop()
            guard let name, let buffer = buffers[name], engine.isRunning else { return }
            music.scheduleBuffer(buffer, at: nil, options: [.loops], completionHandler: nil)
            music.play()
        }
    }

    /// Where the run is now: its bed of sound, and how wrong it is (0 to 1).
    func setZone(sound: String?, mood: Float) {
        queue.async { [self] in
            guard ready else { return }
            warp.rate = 1 - 0.28 * mood
            warp.pitch = -420 * mood
            echo.wetDryMix = 55 * mood
            guard sound != bedName else { return }
            bedName = sound
            bed.stop()
            guard let sound, let buffer = buffers[sound], engine.isRunning else { return }
            bed.scheduleBuffer(buffer, at: nil, options: [.loops], completionHandler: nil)
            bed.play()
        }
    }

    /// Quiet, for when the game isn't on screen.
    func rest() {
        queue.async { [self] in
            guard ready else { return }
            music.stop()
            bed.stop()
            musicName = nil
            bedName = nil
            voices.forEach { $0.stop() }
            engine.pause()
        }
    }
}
