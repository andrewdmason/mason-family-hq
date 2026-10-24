import AVFoundation
import os

/// A song's tracks played through Signalsmith Stretch instead of Apple's
/// time-pitch unit. A background thread reads the parts, mixes them (volume,
/// pan, headroom), stretches the mix and keeps a short buffer full; the audio
/// thread only copies out of that buffer, so it never waits on the disk or the
/// stretcher.
///
/// Changes (mute, volume, speed) reach the ears after the buffer and the
/// stretcher's latency, about a fifth of a second.
final class StretchSource: @unchecked Sendable {
    struct Part {
        let file: URL
        var gain: Float
        var pan: Float
    }

    let node: AVAudioSourceNode
    let sampleRate: Double
    /// Frames in the longest part.
    let length: Int64

    private static let block = 512
    fileprivate static let capacity = 1 << 14 // ~0.37 s at 44.1 kHz
    /// Kept this full; the rest is room for one more block.
    private static let target = 1 << 13

    private struct Shared {
        // The buffer: frames ever written and read (it wraps at capacity).
        var written = 0
        var read = 0
        /// Off while paused or restarting: the audio thread plays silence and
        /// takes nothing.
        var active = false
        /// Where the recording is (in frames) at the write end of the buffer,
        /// once the stretcher's latency is taken off.
        var sourceAtWrite: Double = 0
        /// Where the current run starts; the playhead never shows earlier.
        var startFrame: Double = 0
        var speed: Double = 1
        var parts: [Part]
        var headroom: Float
        var pendingStart: (frame: Int64, leadFrames: Int)?
        var quit = false
    }

    /// The buffer's memory, owned with the audio node's render block so it
    /// lives as long as anything can still read it.
    private final class Ring {
        let left = UnsafeMutablePointer<Float>.allocate(capacity: StretchSource.capacity)
        let right = UnsafeMutablePointer<Float>.allocate(capacity: StretchSource.capacity)
        init() {
            left.initialize(repeating: 0, count: StretchSource.capacity)
            right.initialize(repeating: 0, count: StretchSource.capacity)
        }
        deinit {
            left.deallocate()
            right.deallocate()
        }
    }

    private let shared: OSAllocatedUnfairLock<Shared>
    private let ring = Ring()
    private let inputLatency: Int
    /// The stretcher's own delay on the way out, in output frames.
    let outputLatency: Int

    init?(parts: [Part]) {
        let files = parts.compactMap { try? AVAudioFile(forReading: $0.file) }
        guard let first = files.first, files.count == parts.count else { return nil }
        sampleRate = first.processingFormat.sampleRate
        length = files.map(\.length).max() ?? 0
        guard let probe = ss_stretch_create(2, Float(first.processingFormat.sampleRate)) else { return nil }
        inputLatency = Int(ss_stretch_input_latency(probe))
        outputLatency = Int(ss_stretch_output_latency(probe))
        ss_stretch_destroy(probe)
        let ring = self.ring
        let lock = OSAllocatedUnfairLock(initialState: Shared(
            parts: parts, headroom: Float(1 / Double(parts.count).squareRoot())
        ))
        shared = lock
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
        let capacity = Self.capacity
        node = AVAudioSourceNode(format: format) { isSilence, _, frameCount, audioBufferList in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            guard buffers.count >= 2,
                  let outL = buffers[0].mData?.assumingMemoryBound(to: Float.self),
                  let outR = buffers[1].mData?.assumingMemoryBound(to: Float.self)
            else { return noErr }
            let frames = Int(frameCount)
            // Never wait on the audio thread: if the lock is busy, play silence.
            let copied = lock.withLockIfAvailable { s -> Int in
                guard s.active else { return 0 }
                let n = min(frames, s.written - s.read)
                for i in 0..<n {
                    let at = (s.read + i) & (capacity - 1)
                    outL[i] = ring.left[at]
                    outR[i] = ring.right[at]
                }
                s.read += n
                return n
            } ?? 0
            for i in copied..<frames {
                outL[i] = 0
                outR[i] = 0
            }
            if copied == 0 { isSilence.pointee = true }
            return noErr
        }
        let worker = Thread { [weak self] in self?.produce() }
        worker.qualityOfService = .userInteractive
        worker.name = "Music Minus One stretch"
        worker.start()
    }

    /// Stops the worker; the source is done after this.
    func shutDown() {
        shared.withLock {
            $0.quit = true
            $0.active = false
        }
    }

    // MARK: Control (main thread)

    /// Plays from `frame` after `leadFrames` of silence.
    func start(at frame: Int64, leadFrames: Int) {
        shared.withLock {
            $0.active = false
            $0.pendingStart = (max(0, min(frame, length)), leadFrames)
            $0.startFrame = Double(frame)
        }
    }

    func pause() {
        shared.withLock {
            $0.active = false
            $0.pendingStart = nil
        }
    }

    func set(speed: Double) {
        shared.withLock { $0.speed = speed }
    }

    func set(parts: [(gain: Float, pan: Float)]) {
        shared.withLock { s in
            for (i, p) in parts.enumerated() where s.parts.indices.contains(i) {
                s.parts[i].gain = p.gain
                s.parts[i].pan = p.pan
            }
        }
    }

    /// Seconds into the recording of what's coming out of the speaker now.
    func position() -> Double {
        shared.withLock { s in
            let buffered = Double(s.written - s.read)
            let frame = s.sourceAtWrite - (buffered + Double(outputLatency)) * s.speed
            return max(s.startFrame, frame) / sampleRate
        }
    }

    /// How long after start() the first sound arrives: the stretcher's delay.
    var startDelay: Double { Double(outputLatency) / sampleRate }

    // MARK: The worker

    private func produce() {
        let parts = shared.withLock { $0.parts }
        let files = parts.compactMap { try? AVAudioFile(forReading: $0.file) }
        guard files.count == parts.count, let stretch = ss_stretch_create(2, Float(sampleRate)) else { return }
        defer { ss_stretch_destroy(stretch) }
        let inputLatency = self.inputLatency

        let maxIn = Self.block * 2 + inputLatency * 2 + 4096
        let mixL = UnsafeMutablePointer<Float>.allocate(capacity: maxIn)
        let mixR = UnsafeMutablePointer<Float>.allocate(capacity: maxIn)
        let outL = UnsafeMutablePointer<Float>.allocate(capacity: Self.block)
        let outR = UnsafeMutablePointer<Float>.allocate(capacity: Self.block)
        defer { [mixL, mixR, outL, outR].forEach { $0.deallocate() } }
        let readBuffers = files.map { AVAudioPCMBuffer(pcmFormat: $0.processingFormat, frameCapacity: AVAudioFrameCount(maxIn))! }

        var source: Int64 = 0 // next frame of the recording to read
        var lead = 0 // silent frames still to send before the music
        var carry = 0.0 // fraction of an input frame owed to the next block
        // At each start the stretcher's warm-up comes out first, then the
        // music arrives mid-wave. Keep the warm-up quiet and fade the music in
        // over 10 ms so it doesn't click.
        let ramp = Int(sampleRate / 100)
        let fadeLength = outputLatency + ramp
        var faded = fadeLength
        var running = false

        /// Reads `count` frames from `source` on, mixed, into mixL/mixR.
        func readMix(from start: Int64, count: Int, parts: [Part], headroom: Float) {
            for i in 0..<count {
                mixL[i] = 0
                mixR[i] = 0
            }
            for (k, file) in files.enumerated() {
                guard start < file.length, k < parts.count, parts[k].gain > 0 else { continue }
                let buffer = readBuffers[k]
                file.framePosition = start
                let want = AVAudioFrameCount(min(Int64(count), file.length - start))
                do { try file.read(into: buffer, frameCount: want) } catch { continue }
                guard let data = buffer.floatChannelData else { continue }
                let n = Int(buffer.frameLength)
                let gain = parts[k].gain * headroom
                let pan = parts[k].pan
                if buffer.format.channelCount >= 2 {
                    // Stereo: pan is balance.
                    let gl = gain * (pan > 0 ? 1 - pan : 1)
                    let gr = gain * (pan < 0 ? 1 + pan : 1)
                    let l = data[0], r = data[1]
                    for i in 0..<n {
                        mixL[i] += l[i] * gl
                        mixR[i] += r[i] * gr
                    }
                } else {
                    // Mono: equal-power pan.
                    let angle = (pan + 1) * .pi / 4
                    let gl = gain * cos(angle) * Float(2).squareRoot()
                    let gr = gain * sin(angle) * Float(2).squareRoot()
                    let m = data[0]
                    for i in 0..<n {
                        mixL[i] += m[i] * gl
                        mixR[i] += m[i] * gr
                    }
                }
            }
        }

        while true {
            let (quit, start, free, speed, mix, headroom) = shared.withLock { s in
                let start = s.pendingStart
                s.pendingStart = nil
                return (s.quit, start, Self.target - (s.written - s.read), s.speed, s.parts, s.headroom)
            }
            if quit { return }

            if let start {
                // Restart: prime the stretcher with what comes just before, so
                // the music starts cleanly instead of fading in.
                ss_stretch_reset(stretch)
                let prime = min(Int(start.frame), inputLatency)
                if prime > 0 {
                    readMix(from: start.frame - Int64(prime), count: prime, parts: mix, headroom: headroom)
                    var ins: [UnsafeMutablePointer<Float>?] = [mixL, mixR]
                    ins.withUnsafeMutableBufferPointer { ss_stretch_seek(stretch, $0.baseAddress!, Int32(prime), speed) }
                }
                source = start.frame
                lead = start.leadFrames
                carry = 0
                faded = 0
                running = true
                // Everything before this point is stale.
                shared.withLock { s in
                    s.read = 0
                    s.written = 0
                    s.sourceAtWrite = Double(start.frame) - Double(inputLatency)
                    s.active = true
                }
                continue
            }

            guard running, free >= Self.block else {
                Thread.sleep(forTimeInterval: 0.003)
                continue
            }

            let block = Self.block
            if lead > 0 {
                // The count-in's silence before the recording starts.
                let n = min(lead, block)
                lead -= n
                for i in 0..<n {
                    outL[i] = 0
                    outR[i] = 0
                }
                commit(count: n, outL: outL, outR: outR, sourceAdvance: 0)
                continue
            }

            carry += Double(block) * speed
            let inFrames = Int(carry)
            carry -= Double(inFrames)
            // Input runs inputLatency ahead of what's being heard; the seek
            // above already supplied the frames just before `source`.
            readMix(from: source, count: inFrames, parts: mix, headroom: headroom)
            var ins: [UnsafeMutablePointer<Float>?] = [mixL, mixR]
            var outs: [UnsafeMutablePointer<Float>?] = [outL, outR]
            ins.withUnsafeMutableBufferPointer { i in
                outs.withUnsafeMutableBufferPointer { o in
                    ss_stretch_process(stretch, i.baseAddress!, Int32(inFrames), o.baseAddress!, Int32(block))
                }
            }
            source += Int64(inFrames)
            var i = 0
            while faded < fadeLength, i < block {
                let g = Float(max(0, faded - outputLatency)) / Float(ramp)
                outL[i] *= g
                outR[i] *= g
                faded += 1
                i += 1
            }
            commit(count: block, outL: outL, outR: outR, sourceAdvance: Double(inFrames))
        }
    }

    private func commit(count: Int, outL: UnsafeMutablePointer<Float>, outR: UnsafeMutablePointer<Float>, sourceAdvance: Double) {
        let mask = Self.capacity - 1
        shared.withLock { s in
            guard s.active else { return }
            for i in 0..<count {
                let at = (s.written + i) & mask
                ring.left[at] = outL[i]
                ring.right[at] = outR[i]
            }
            s.written += count
            s.sourceAtWrite += sourceAdvance
        }
    }
}
