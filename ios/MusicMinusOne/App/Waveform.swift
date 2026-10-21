import AVFoundation
import Observation
import SwiftUI

/// Each track's loudness outline (peaks in 1,000 slices), worked out once from
/// the audio and kept beside it.
@MainActor
@Observable
final class Waveforms {
    static let shared = Waveforms()
    static let slices = 1000

    private(set) var peaks: [String: [Float]] = [:]
    @ObservationIgnored private var working: Set<String> = []

    func forget(_ file: String) { peaks[file] = nil }

    /// The song's tracks drawn as one outline: the loudest track at each slice.
    func combined(_ song: Song, library: Library) -> [Float]? {
        var out = [Float](repeating: 0, count: Self.slices)
        var any = false
        for track in song.tracks {
            guard let p = peaks(for: track, library: library) else { continue }
            any = true
            for i in 0..<min(p.count, out.count) { out[i] = max(out[i], p[i]) }
        }
        guard any, let top = out.max(), top > 0 else { return nil }
        return out.map { $0 / top }
    }

    private func peaks(for track: Track, library: Library) -> [Float]? {
        if let p = peaks[track.file] { return p }
        // Read or worked out off the main thread; drawn when it arrives.
        let audio = library.audioURL(track)
        let cache = audio.appendingPathExtension("peaks")
        guard library.hasAudio(track), !working.contains(track.file) else { return nil }
        working.insert(track.file)
        let file = track.file
        Task.detached(priority: .utility) {
            var p = (try? Data(contentsOf: cache)).map { data in
                data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
            }
            if p == nil {
                p = Self.measure(audio)
                if let p { try? p.withUnsafeBytes { Data($0) }.write(to: cache) }
            }
            await MainActor.run {
                self.working.remove(file)
                if let p { self.peaks[file] = p }
            }
        }
        return nil
    }

    nonisolated static func measure(_ url: URL) -> [Float]? {
        guard let file = try? AVAudioFile(forReading: url), file.length > 0 else { return nil }
        let perSlice = max(1, Int(file.length) / slices)
        let chunk = AVAudioFrameCount(perSlice)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk) else { return nil }
        var out = [Float]()
        out.reserveCapacity(slices)
        while out.count < slices {
            do { try file.read(into: buffer, frameCount: chunk) } catch { break }
            guard buffer.frameLength > 0, let channels = buffer.floatChannelData else { break }
            var peak: Float = 0
            for c in 0..<Int(buffer.format.channelCount) {
                let samples = channels[c]
                for i in 0..<Int(buffer.frameLength) { peak = max(peak, abs(samples[i])) }
            }
            out.append(peak)
        }
        while out.count < slices { out.append(0) }
        return out
    }
}

/// The mini waveform: the song's outline, its measure flags, the playhead.
/// Tap or drag to move the playhead.
struct MiniWaveform: View {
    let peaks: [Float]?
    let markers: [Marker]
    let duration: Double
    let position: Double
    let onSeek: (Double) -> Void

    @State private var dragging: Double?

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let x = { (t: Double) in duration > 0 ? CGFloat(t / duration) * w : 0 }
            ZStack(alignment: .topLeading) {
                Canvas { ctx, size in
                    guard let peaks else { return }
                    let mid = size.height * 0.6
                    let amp = size.height * 0.38
                    var path = Path()
                    let n = peaks.count
                    for px in stride(from: 0, to: Int(size.width), by: 2) {
                        let i = min(n - 1, Int(Double(px) / Double(size.width) * Double(n)))
                        let a = CGFloat(peaks[i]) * amp
                        path.addRect(CGRect(x: CGFloat(px), y: mid - a, width: 1.5, height: max(1, a * 2)))
                    }
                    ctx.fill(path, with: .color(Color(white: 0.82)))
                }
                ForEach(markers) { m in
                    MarkerFlag(measure: m.measure)
                        .frame(height: h)
                        .position(x: x(m.time), y: h / 2)
                }
                Rectangle()
                    .fill(Color.red)
                    .frame(width: 2, height: h)
                    .position(x: x(dragging ?? position), y: h / 2)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in dragging = max(0, min(duration, Double(g.location.x / w) * duration)) }
                    .onEnded { _ in
                        if let t = dragging { onSeek(t) }
                        dragging = nil
                    }
            )
        }
        .background(Color.black)
    }
}

/// A thin blue line with a flag on top carrying the measure number, its
/// digits stacked, as Anytune draws them.
private struct MarkerFlag: View {
    let measure: Int

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: -2) {
                ForEach(Array(String(measure).enumerated()), id: \.offset) { _, digit in
                    Text(String(digit))
                }
            }
            .font(.system(size: 9, weight: .bold).monospacedDigit())
            .foregroundStyle(.black)
            .padding(.vertical, 2)
            .frame(width: 11)
            .background(Color.markerBlue)
            Rectangle().fill(Color.markerBlue).frame(width: 1)
        }
    }
}
