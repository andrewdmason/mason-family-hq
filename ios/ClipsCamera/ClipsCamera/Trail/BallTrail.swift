import CoreGraphics
import Foundation
import simd

// The ball trail: where the batted ball went in the GameChanger field view,
// traced by the baseball-clips worker (docs/clips-ball-trail.md). The phone
// draws it live over the field view and burns it into shares; this file is the
// data and the timing, TrailRenderer the drawing.
//
// Points live in one fixed reference frame (the stream camera pans to follow
// runners); each source frame has a homography from that reference frame into
// its own picture, so the tail — where the ball *was* — stays on the field as
// the camera moves.
//
// Times are the frames' own timestamps in the untrimmed GameChanger file
// (variable frame rate), so everything here goes by time, never by frame
// number: the frame on screen at clip time t is the last `frames` entry at or
// before t (as a player or compositor shows it), and the path between points is
// interpolated by time. `clip.fps` only turns the prototype's frame-counted
// lengths (tail caps, drain, puff spacing) into durations.

/// `clip_at_bats.ball_trail_status`.
enum BallTrailStatus: String, Codable, Equatable {
    case pending
    case ready
    case needsTap = "needs_tap"
    case failed
}

/// "The ball is here": a frame of the field view (clip seconds, untrimmed) and
/// a spot on it, 0–1 of the frame's width and height from the top left.
struct TrailTap: Codable, Equatable {
    var t: Double
    var x: Double
    var y: Double
}

/// The trail columns of an at-bat, as Clips has them.
struct BallTrailInfo: Equatable {
    var trail: BallTrail?
    var status: BallTrailStatus?
    var tap: TrailTap?

    static let none = BallTrailInfo()

    /// A trail to draw: whatever trail there is — a failed re-trace keeps the
    /// last one, and a re-trace in progress shows it until the new one lands —
    /// except while tracing wants a tap (which clears it in Clips anyway).
    var ready: BallTrail? { status == .needsTap ? nil : trail }
    /// Tracing gave up or wasn't sure, and there's no trail to show: it wants
    /// a tap on the ball.
    var needsHelp: Bool { (status == .needsTap || status == .failed) && ready == nil }
}

/// Trail JSON, version 1.
struct BallTrail: Codable, Equatable {
    struct Clip: Codable, Equatable {
        var fps: Double
        var width: Double
        var height: Double
    }

    struct Stats: Codable, Equatable {
        var exitMph: Double?
        var launchDeg: Double?
        var carryFt: Double?
    }

    /// The ball at a clip time, in reference-normalized coordinates.
    struct Point: Equatable {
        var t: Double
        var x: Double
        var y: Double
    }

    /// A source frame's homography: reference-normalized → that frame's
    /// normalized coordinates, row-major.
    struct Frame: Equatable {
        var t: Double
        var h: [Double]
    }

    var version: Int
    var source: String?
    var clip: Clip
    /// Clip seconds.
    var contactS: Double
    var landS: Double
    /// False: the ball left the picture or the trail ends in the air.
    var landed: Bool
    var confidence: Double?
    var points: [Point]
    var frames: [Frame]
    var stats: Stats?

    enum CodingKeys: String, CodingKey {
        case version, source, clip, contactS, landS, landed, confidence, points, frames, stats
    }

    struct Invalid: Error, CustomStringConvertible {
        let description: String
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(Int.self, forKey: .version)
        guard version == 1 else { throw Invalid(description: "trail version \(version)") }
        source = try c.decodeIfPresent(String.self, forKey: .source)
        clip = try c.decode(Clip.self, forKey: .clip)
        contactS = try c.decode(Double.self, forKey: .contactS)
        landS = try c.decode(Double.self, forKey: .landS)
        landed = try c.decodeIfPresent(Bool.self, forKey: .landed) ?? true
        confidence = try c.decodeIfPresent(Double.self, forKey: .confidence)
        stats = try? c.decodeIfPresent(Stats.self, forKey: .stats)
        points = try c.decode([[Double]].self, forKey: .points).map { row in
            guard row.count >= 3 else { throw Invalid(description: "a point needs [t, x, y]") }
            return Point(t: row[0], x: row[1], y: row[2])
        }.sorted { $0.t < $1.t }
        frames = try c.decode([[Double]].self, forKey: .frames).map { row in
            guard row.count >= 10 else { throw Invalid(description: "a frame needs [t, h11 … h33]") }
            return Frame(t: row[0], h: Array(row[1...9]))
        }.sorted { $0.t < $1.t }
        guard !points.isEmpty, !frames.isEmpty, clip.fps > 0, clip.width > 0, clip.height > 0 else {
            throw Invalid(description: "an empty trail")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version)
        try c.encodeIfPresent(source, forKey: .source)
        try c.encode(clip, forKey: .clip)
        try c.encode(contactS, forKey: .contactS)
        try c.encode(landS, forKey: .landS)
        try c.encode(landed, forKey: .landed)
        try c.encodeIfPresent(confidence, forKey: .confidence)
        try c.encode(points.map { [$0.t, $0.x, $0.y] }, forKey: .points)
        try c.encode(frames.map { [$0.t] + $0.h }, forKey: .frames)
        try c.encodeIfPresent(stats, forKey: .stats)
    }

    /// Identifies this trail's contents (for the share cache).
    var fingerprint: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let data = try? encoder.encode(self) else { return "trail" }
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in data { hash = (hash ^ UInt64(byte)) &* 0x100000001b3 }
        return String(hash, radix: 16)
    }
}

// MARK: - Styles

enum TrailStyle: String, Codable, CaseIterable, Identifiable {
    case neon
    case vapor
    case broadcast

    var id: String { rawValue }

    var label: String {
        switch self {
        case .neon: "Neon"
        case .vapor: "Vapor"
        case .broadcast: "Broadcast"
        }
    }

    /// Light added to the picture (Neon's glow) rather than paint laid over it.
    var additive: Bool { self == .neon }

    /// How far behind the ball the tail reaches: a length on screen (px on a
    /// 1280-wide picture) and a cap in source frames, whichever is shorter.
    /// After landing, the tail drains over the same number of frames.
    var tail: (pixels: Double, frames: Double) {
        switch self {
        case .neon: (150, 15)
        case .vapor: (.infinity, 26)
        case .broadcast: (220, 16)
        }
    }
}

// MARK: - Geometry and timing

/// What to draw at one moment: the displayed source frame, the head and the
/// tail's samples (in that frame's normalized coordinates), and how faded.
struct TrailMoment {
    /// The clip time of the source frame on screen.
    var frameTime: Double
    /// Which `frames` homography maps the reference frame into the picture.
    var frameIndex: Int
    /// Head and tail-start times (clip seconds).
    var head: Double
    var tailStart: Double
    /// Tail samples, oldest first, ending at the head. `u` runs 1 at the end
    /// of the tail to 0 at the head.
    var points: [SIMD2<Double>]
    var u: [Double]
    var times: [Double]
    var fade: Double
    /// The ball is still in the air (Broadcast rings it).
    var inFlight: Bool
}

/// A trail made ready to draw: the path as a smooth curve, its length along
/// the way, and the per-frame homographies. Immutable, so the share compositor
/// can use it from its own threads.
final class TrailGeometry: @unchecked Sendable {
    let trail: BallTrail
    let fps: Double
    private let pointT: [Double]
    private let pointP: [SIMD2<Double>]
    private let frameT: [Double]
    private let homs: [simd_double3x3]
    /// Arc length (px on a 1280-wide picture, in the reference frame) by time.
    private let arcT: [Double]
    private let arcS: [Double]

    /// A source frame starts showing at its time; this much slack covers
    /// rounding in the JSON and in player clocks.
    static let frameSlack = 0.002
    /// A trail that ends in the air fades over its last frames instead of draining.
    static let fadeOutFrames = 8.0

    init(_ trail: BallTrail) {
        self.trail = trail
        fps = trail.clip.fps
        pointT = trail.points.map(\.t)
        pointP = trail.points.map { SIMD2($0.x, $0.y) }
        frameT = trail.frames.map(\.t)
        homs = trail.frames.map { f in
            // simd matrices are column-major: columns are (h11, h21, h31)…
            simd_double3x3(columns: (SIMD3(f.h[0], f.h[3], f.h[6]),
                                     SIMD3(f.h[1], f.h[4], f.h[7]),
                                     SIMD3(f.h[2], f.h[5], f.h[8])))
        }
        // Arc length through the smoothed path, a few samples per frame.
        var ts: [Double] = []
        var ss: [Double] = []
        let aspect = trail.clip.height / trail.clip.width
        let first = pointT.first ?? 0
        let last = pointT.last ?? 0
        let steps = max(1, (pointT.count - 1) * 8)
        var prev: SIMD2<Double>?
        var s = 0.0
        for i in 0...steps {
            let t = first + (last - first) * Double(i) / Double(steps)
            let p = Self.catmullRom(pointT, pointP, t)
            if let prev {
                let d = (p - prev) * SIMD2(1280, 1280 * aspect)
                s += (d.x * d.x + d.y * d.y).squareRoot()
            }
            ts.append(t)
            ss.append(s)
            prev = p
        }
        arcT = ts
        arcS = ss
    }

    var contact: Double { trail.contactS }
    var land: Double { trail.landS }

    /// The ball at clip time `t`, in reference-normalized coordinates (held
    /// at the ends of the path).
    func position(_ t: Double) -> SIMD2<Double> {
        Self.catmullRom(pointT, pointP, t)
    }

    /// The source frame on screen at clip time `t`: the last one that has
    /// started by then. Nil before the first.
    func frameIndex(at t: Double) -> Int? {
        guard let first = frameT.first, t + Self.frameSlack >= first else { return nil }
        var lo = 0, hi = frameT.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if frameT[mid] <= t + Self.frameSlack { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    func frameTime(_ index: Int) -> Double { frameT[index] }

    /// A reference-normalized point in source frame `index`'s picture (normalized).
    func project(_ p: SIMD2<Double>, frame index: Int) -> SIMD2<Double> {
        let q = homs[index] * SIMD3(p.x, p.y, 1)
        guard abs(q.z) > 1e-9 else { return SIMD2(q.x, q.y) }
        return SIMD2(q.x / q.z, q.y / q.z)
    }

    func arc(at t: Double) -> Double { Self.interpolate(arcT, arcS, t) }
    func time(atArc s: Double) -> Double { Self.interpolate(arcS, arcT, s) }

    /// What to draw at clip time `t` in `style`, or nil for nothing: before
    /// contact, and once the tail has drained (or faded) after the ball lands.
    ///
    /// The timing follows the prototype (prototypes/ball-trail/styles.py), in
    /// source frames: the tail is the style's length on screen or its frame
    /// cap; after landing it drains into the landing spot at 1.2× and fades
    /// over the frame cap.
    func moment(at t: Double, style: TrailStyle) -> TrailMoment? {
        guard t + Self.frameSlack >= contact, let index = frameIndex(at: t) else { return nil }
        // The frame on screen decides everything, so the trail steps with the
        // picture (one source frame held for four in slow motion stays put).
        // Past the last homography the time runs on as it is.
        let now = index == frameT.count - 1 ? max(t, frameT[index]) : frameT[index]
        let f = now * fps
        let f0 = contact * fps
        let f1 = land * fps
        let (tailPixels, tailFrames) = style.tail
        let head = min(f, f1)
        var tailStart = max(f0, head - tailFrames)
        if tailPixels.isFinite {
            tailStart = max(tailStart, time(atArc: arc(at: head / fps) - tailPixels) * fps)
        }
        var fade = 1.0
        if !trail.landed {
            if f > f1 + 1e-6 { return nil }
            fade = max(0, min(1, (f1 - head) / Self.fadeOutFrames))
        } else if f > f1 {
            tailStart = min(f1, tailStart + (f - f1) * 1.2)
            fade = max(0, 1 - (f - f1) / tailFrames)
        }
        guard fade > 0, head > tailStart + 1e-9 else { return nil }
        let n = max(10, Int((head - tailStart) * 10))
        var points: [SIMD2<Double>] = []
        var us: [Double] = []
        var times: [Double] = []
        points.reserveCapacity(n)
        for i in 0..<n {
            let tf = tailStart + (head - tailStart) * Double(i) / Double(n - 1)
            let ts = tf / fps
            times.append(ts)
            points.append(project(position(ts), frame: index))
            us.append((head - tf) / (head - tailStart))
        }
        return TrailMoment(frameTime: now, frameIndex: index, head: head / fps, tailStart: tailStart / fps,
                           points: points, u: us, times: times, fade: fade, inFlight: f <= f1 + 1e-6)
    }

    // MARK: Math

    /// Catmull-Rom through the samples, held at the ends.
    static func catmullRom(_ ts: [Double], _ ps: [SIMD2<Double>], _ t: Double) -> SIMD2<Double> {
        guard let first = ts.first, let last = ts.last, ps.count > 1 else { return ps.first ?? .zero }
        if t <= first { return ps[0] }
        if t >= last { return ps[ps.count - 1] }
        var lo = 0, hi = ts.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if ts[mid] <= t { lo = mid } else { hi = mid }
        }
        let span = ts[hi] - ts[lo]
        let u = span > 0 ? (t - ts[lo]) / span : 0
        let p0 = ps[max(0, lo - 1)], p1 = ps[lo], p2 = ps[hi], p3 = ps[min(ps.count - 1, hi + 1)]
        let u2 = u * u, u3 = u2 * u
        let a = 2 * p1
        let b = p2 - p0
        let c = 2 * p0 - 5 * p1 + 4 * p2 - p3
        let d = 3 * p1 - p0 - 3 * p2 + p3
        return 0.5 * (a + b * u + c * u2 + d * u3)
    }

    /// Piecewise-linear lookup in a rising table, held at the ends.
    static func interpolate(_ xs: [Double], _ ys: [Double], _ x: Double) -> Double {
        guard let first = xs.first, let last = xs.last else { return 0 }
        if x <= first { return ys[0] }
        if x >= last { return ys[ys.count - 1] }
        var lo = 0, hi = xs.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if xs[mid] <= x { lo = mid } else { hi = mid }
        }
        let span = xs[hi] - xs[lo]
        return span > 0 ? ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / span : ys[lo]
    }
}
