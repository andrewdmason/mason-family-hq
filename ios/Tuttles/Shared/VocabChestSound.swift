import AVFoundation
import Foundation

// The sound of a chest being opened (VocabChest.swift): the thud as it lands,
// its rattle while it waits, the wind-up, the burst, a ding for every coin
// counted (climbing as the count does) and a flourish at the end. All of it
// is made here, in numbers, so there are no files to ship or to credit and the
// Mac has it too. Like Math's sound it's ambient: it plays over whatever else
// is playing and keeps quiet when the phone's switch is on silent.

final class VocabChestSound: @unchecked Sendable {
    static let shared = VocabChestSound()

    enum Sound: Hashable, CaseIterable {
        case land, rattle, wind, burst, counted
        /// A coin counted: one of `coinSteps` pitches, low to high.
        case coin(Int)

        static let coinSteps = 6
        static var allCases: [Sound] { [.land, .rattle, .wind, .burst, .counted] + (0..<coinSteps).map(Sound.coin) }
    }

    static let rate = 44_100.0
    private static let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!

    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "vocab.chest.sound")
    private var buffers: [Sound: AVAudioPCMBuffer] = [:]
    private var voices: [AVAudioPlayerNode] = []
    private var nextVoice = 0
    private var ready = false
    /// Goes up with every `prepare`, so a `rest` from before it does nothing.
    private var uses = 0

    private init() {}

    /// Builds the engine and makes the sounds. Safe to call again.
    func prepare() {
        queue.async { [self] in
            uses += 1
            if !ready {
                #if os(iOS)
                try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
                try? AVAudioSession.sharedInstance().setActive(true)
                #endif
                for _ in 0..<12 {
                    let voice = AVAudioPlayerNode()
                    engine.attach(voice)
                    engine.connect(voice, to: engine.mainMixerNode, format: Self.format)
                    voices.append(voice)
                }
                // Room for the burst, the coins and the flourish on top of each other.
                engine.mainMixerNode.outputVolume = 0.7
                for sound in Sound.allCases { buffers[sound] = Self.buffer(Self.samples(sound)) }
                ready = true
            }
            if !engine.isRunning { try? engine.start() }
        }
    }

    func play(_ sound: Sound, volume: Float = 1) {
        queue.async { [self] in
            guard ready, engine.isRunning, let buffer = buffers[sound], !voices.isEmpty else { return }
            let voice = voices[nextVoice]
            nextVoice = (nextVoice + 1) % voices.count
            voice.stop()
            voice.volume = volume
            voice.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
            voice.play()
        }
    }

    /// The ding for coin `coin` of `all`: higher as the count goes up.
    func coin(_ coin: Int, of all: Int) {
        play(.coin(min(Sound.coinSteps - 1, coin * Sound.coinSteps / max(1, all))), volume: 0.5)
    }

    /// The chest's gone: once what's playing has rung out, the engine stops.
    func rest() {
        queue.async { [self] in
            let was = uses
            queue.asyncAfter(deadline: .now() + 2.5) { [self] in
                guard was == uses, ready else { return }
                for voice in voices { voice.stop() }
                engine.pause()
            }
        }
    }

    private static func buffer(_ samples: [Float]) -> AVAudioPCMBuffer? {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        for (index, sample) in samples.enumerated() { channel[index] = sample }
        return buffer
    }

    // MARK: - The sounds, made

    /// A sound as samples, -1 to 1, at `rate`.
    static func samples(_ sound: Sound) -> [Float] {
        switch sound {
        case .land: land()
        case .rattle: rattle()
        case .wind: wind()
        case .burst: burst()
        case .counted: counted()
        case .coin(let step): coin(step: step)
        }
    }

    /// Noise that's the same every time.
    private struct Noise {
        var state: UInt32 = 0x9E37_79B9
        mutating func next() -> Double {
            state = state &* 1_664_525 &+ 1_013_904_223
            return Double(state >> 8) / Double(1 << 23) - 1
        }
    }

    private static func make(_ seconds: Double, _ fill: (inout [Double]) -> Void, peak: Double = 0.9) -> [Float] {
        var out = [Double](repeating: 0, count: Int(seconds * rate))
        fill(&out)
        // A few milliseconds in and out, so nothing clicks; then as loud as it's meant to be.
        let edge = min(out.count / 2, Int(0.004 * rate))
        for i in 0..<edge {
            let k = Double(i) / Double(edge)
            out[i] *= k
            out[out.count - 1 - i] *= k
        }
        let top = out.reduce(0) { max($0, abs($1)) }
        let gain = top > 0 ? peak / top : 0
        return out.map { Float($0 * gain) }
    }

    /// Adds a struck, ringing note: a sine with a little of its overtones, dying away.
    private static func ring(_ out: inout [Double], at start: Double, hz: Double, decay: Double, gain: Double = 1) {
        let from = Int(start * rate)
        guard from < out.count else { return }
        for i in from..<out.count {
            let t = Double(i - from) / rate
            let fade = exp(-t / decay) * min(1, t / 0.003)
            let tone = sin(2 * .pi * hz * t) + 0.35 * sin(2 * .pi * hz * 2 * t) + 0.12 * sin(2 * .pi * hz * 3.01 * t)
            out[i] += gain * fade * tone
        }
    }

    /// Adds a knock: a burst of muffled noise over a low thump.
    private static func knock(_ out: inout [Double], at start: Double, hz: Double, length: Double, gain: Double, noise: inout Noise) {
        let from = Int(start * rate)
        var low = 0.0
        for i in from..<min(out.count, from + Int(length * 6 * rate)) {
            let t = Double(i - from) / rate
            low += 0.18 * (noise.next() - low)
            out[i] += gain * exp(-t / length) * (low * 2.2 + 0.8 * sin(2 * .pi * hz * t))
        }
    }

    /// The chest landing: a soft, low thud.
    private static func land() -> [Float] {
        make(0.4, { out in
            var noise = Noise()
            var phase = 0.0, low = 0.0
            for i in out.indices {
                let t = Double(i) / rate
                // (Low, but not so low a phone can't make it.)
                phase += 2 * .pi * (95 + 170 * exp(-t / 0.05)) / rate
                low += 0.08 * (noise.next() - low)
                out[i] = sin(phase) * exp(-t / 0.11) + low * 1.5 * exp(-t / 0.03)
            }
        }, peak: 0.8)
    }

    /// Something inside, knocking to get out.
    private static func rattle() -> [Float] {
        make(0.42, { out in
            var noise = Noise()
            knock(&out, at: 0, hz: 310, length: 0.02, gain: 1, noise: &noise)
            knock(&out, at: 0.085, hz: 270, length: 0.018, gain: 0.8, noise: &noise)
            knock(&out, at: 0.19, hz: 330, length: 0.022, gain: 0.95, noise: &noise)
            knock(&out, at: 0.27, hz: 290, length: 0.016, gain: 0.6, noise: &noise)
        }, peak: 0.6)
    }

    /// The wind-up: a tone climbing two octaves, trembling faster and louder, with a rush of air behind it.
    private static func wind() -> [Float] {
        let length = 1.12
        return make(length, { out in
            var noise = Noise()
            var phase = 0.0, tremble = 0.0, low = 0.0
            for i in out.indices {
                let t = Double(i) / rate, k = t / length
                let hz = 196 * pow(2, 2.1 * k * k)
                phase += 2 * .pi * hz / rate
                tremble += 2 * .pi * (9 + 22 * k) / rate
                let white = noise.next()
                low += 0.25 * (white - low)
                let tone = sin(phase) + 0.5 * sin(phase * 1.5) + 0.3 * sin(phase * 2)
                let shake = 0.6 + 0.4 * sin(tremble)
                out[i] = (0.15 + 0.85 * k * k) * (tone * shake * 0.6 + (white - low) * 0.5 * k)
            }
        }, peak: 0.75)
    }

    /// It bursts: a boom underneath, a crash of noise, and bells scattering upward out of it.
    private static func burst() -> [Float] {
        make(2.0, { out in
            var noise = Noise()
            var phase = 0.0, low = 0.0
            for i in out.indices {
                let t = Double(i) / rate
                phase += 2 * .pi * (70 + 240 * exp(-t / 0.07)) / rate
                // The crash starts bright and dulls as it dies.
                low += (0.06 + 0.7 * exp(-t / 0.12)) * (noise.next() - low)
                out[i] = 1.3 * sin(phase) * exp(-t / 0.32) + 0.9 * low * exp(-t / 0.22)
            }
            // C major, up two octaves and a bit.
            let bells: [Double] = [1046.5, 1318.5, 1568, 2093, 2637, 3136, 4186]
            for (index, hz) in bells.enumerated() {
                ring(&out, at: 0.02 + 0.045 * Double(index), hz: hz, decay: 0.55, gain: 0.34 - 0.03 * Double(index))
            }
        })
    }

    /// A coin: two quick notes, a fourth apart, the second left to ring. Each step is a note higher up the scale.
    private static func coin(step: Int) -> [Float] {
        let scale: [Double] = [0, 2, 4, 7, 9, 12]
        let hz = 987.77 * pow(2, scale[max(0, min(scale.count - 1, step))] / 12)
        return make(0.34, { out in
            ring(&out, at: 0, hz: hz, decay: 0.03, gain: 0.8)
            ring(&out, at: 0.045, hz: hz * 4 / 3, decay: 0.09)
        }, peak: 0.7)
    }

    /// All counted: a rising arpeggio that lands on a held chord.
    private static func counted() -> [Float] {
        make(1.7, { out in
            let run: [Double] = [523.25, 659.25, 783.99, 1046.5]
            for (index, hz) in run.enumerated() { ring(&out, at: 0.075 * Double(index), hz: hz, decay: 0.22, gain: 0.7) }
            for hz in [523.25, 783.99, 1046.5, 1318.5, 1568] { ring(&out, at: 0.32, hz: hz, decay: 0.5, gain: 0.5) }
        }, peak: 0.8)
    }
}
