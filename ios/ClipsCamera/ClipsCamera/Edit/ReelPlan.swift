import Foundation

// The pitch reel: what Clips keeps of a filmed at-bat. Just the real-speed
// window around each pitch (the quick version's cuts, back to back), with no
// slow motion, captions or title card baked in — the player adds those live,
// and a shared video is rendered from the reel when it's asked for.
//
// Swings (and pitches never labeled) keep every 240fps frame so slow motion
// stays smooth; takes keep 60fps, which is all real speed needs.

/// One pitch window in the reel.
struct ReelSegment: Codable, Equatable {
    /// Where it sits in the reel, in seconds.
    var start: Double
    var end: Double
    /// 240 for a swing or an unlabeled pitch, 60 for a take.
    var fps: Int
    /// The pitch it was cut for, as an index into the pitches sorted by time.
    var pitch: Int

    var length: Double { end - start }
}

/// A reel segment and the stretch of the raw recording it comes from.
struct ReelCut: Equatable {
    var sourceStart: Double
    var sourceEnd: Double
    var segment: ReelSegment
}

enum ReelPlan {
    static let fullRate = 240
    static let takeRate = 60

    /// Keeps every frame: something to watch in slow motion.
    static func keepsFullRate(_ p: Pitch) -> Bool {
        p.outcome == nil || (p.outcome?.isSwing ?? false)
    }

    /// The reel's cuts from the raw recording: the quick version's real-speed
    /// windows, laid end to end. A window that also shows a later pitch (two
    /// pitches close together) keeps full rate if either needs it.
    static func cuts(pitches: [Pitch], duration: Double, timings: EditTimings = .standard) -> [ReelCut] {
        let sorted = pitches.sorted { $0.t < $1.t }
        let windows = QuickPlan.build(pitches: sorted, duration: duration, result: nil, timings: timings).filter { !$0.replay }
        var cursor = 0.0
        return windows.map { w in
            let shown = sorted.enumerated().filter { $0.offset == w.pitchIndex || ($0.element.t >= w.start && $0.element.t <= w.end) }
            let fps = shown.contains { keepsFullRate($0.element) } ? fullRate : takeRate
            let length = w.end - w.start
            defer { cursor += length }
            return ReelCut(sourceStart: w.start, sourceEnd: w.end,
                           segment: ReelSegment(start: cursor, end: cursor + length, fps: fps, pitch: w.pitchIndex))
        }
    }

    /// Where each pitch (sorted by time) lands in the reel.
    static func pitchTimes(pitches: [Pitch], cuts: [ReelCut]) -> [Double] {
        let sorted = pitches.sorted { $0.t < $1.t }
        return sorted.enumerated().map { i, p in
            if let c = cuts.first(where: { p.t >= $0.sourceStart && p.t <= $0.sourceEnd }) {
                return c.segment.start + p.t - c.sourceStart
            }
            // Window clipped away entirely: the start of the next pitch's footage.
            return cuts.first(where: { $0.segment.pitch > i })?.segment.start ?? cuts.last?.segment.end ?? 0
        }
    }

    /// New labels change the reel itself — a window's length (contact keeps
    /// longer after the pitch) or its frame rate — so it has to be rebuilt.
    static func needsRebuild(old: [Pitch], new: [Pitch], duration: Double, timings: EditTimings = .standard) -> Bool {
        cuts(pitches: old, duration: duration, timings: timings) != cuts(pitches: new, duration: duration, timings: timings)
    }

    // MARK: Playing a reel

    /// The pitch on screen at reel time `t`: the latest one whose moment has
    /// come inside the window showing, else the window's own.
    static func pitchShowing(at t: Double, segments: [ReelSegment], pitchTimes: [Double]) -> Int? {
        guard let seg = segment(at: t, in: segments) else { return nil }
        let inWindow = pitchTimes.indices.filter { pitchTimes[$0] >= seg.start && pitchTimes[$0] <= seg.end }
        return inWindow.last { pitchTimes[$0] <= t } ?? seg.pitch
    }

    static func segment(at t: Double, in segments: [ReelSegment]) -> ReelSegment? {
        if let s = segments.first(where: { t >= $0.start && t < $0.end }) { return s }
        if let last = segments.last, t >= last.end - 0.001, t <= last.end + 0.05 { return last }
        return nil
    }

    /// Where Previous/Next lands for pitch `i`: its lead-in, inside its window.
    static func jumpTarget(pitch i: Int, segments: [ReelSegment], pitchTimes: [Double], timings: EditTimings = .standard) -> Double {
        let t = pitchTimes[i]
        let window = segments.first { t >= $0.start && t <= $0.end } ?? segments.first { $0.pitch == i }
        return max(window?.start ?? 0, t - timings.lead)
    }

    /// The slow-motion replay of pitch `i`: the swing replay's window, kept
    /// inside the footage the reel has.
    static func replayWindow(pitch i: Int, segments: [ReelSegment], pitchTimes: [Double], timings: EditTimings = .standard) -> ClosedRange<Double>? {
        let t = pitchTimes[i]
        guard let window = segments.first(where: { t >= $0.start && t <= $0.end }) else { return nil }
        let lo = max(window.start, t - timings.replayBefore)
        let hi = min(window.end, t + timings.replayAfter)
        return hi - lo > 0.05 ? lo ... hi : nil
    }

    // MARK: Sharing a reel

    /// The shared video's plan, in reel time: every window at real speed with
    /// its caption, each swing followed by its ¼-speed replay when asked for.
    /// With `only`, just the window showing that pitch, and only its replay
    /// ("Just the hit"). `pitches` are at their reel times.
    static func sharePlan(segments: [ReelSegment], pitches: [Pitch], result: AtBatResult?, replays: Bool,
                          only: Int? = nil, timings: EditTimings = .standard) -> [PlanSegment] {
        let sorted = pitches.sorted { $0.t < $1.t }
        let counts = Scorebook.countsBefore(sorted)
        let times = sorted.map(\.t)
        func caption(_ i: Int) -> String {
            QuickPlan.caption(sorted[i], n: i + 1, count: counts[i], isLast: i == sorted.count - 1, result: result)
        }
        func shows(_ i: Int, _ seg: ReelSegment) -> Bool { times[i] >= seg.start && times[i] <= seg.end }
        var plan: [PlanSegment] = []
        for seg in segments where seg.pitch < sorted.count {
            if let only, only < sorted.count {
                guard shows(only, seg) else { continue }
                plan.append(PlanSegment(start: seg.start, end: seg.end, rate: 1, muted: false, caption: caption(only), pitchIndex: only, replay: false))
                if replays, sorted[only].outcome?.isSwing ?? false,
                   let w = replayWindow(pitch: only, segments: [seg], pitchTimes: times, timings: timings) {
                    plan.append(PlanSegment(start: w.lowerBound, end: w.upperBound, rate: timings.replayRate, muted: true,
                                            caption: "\(caption(only)) · Replay", pitchIndex: only, replay: true))
                }
                break
            }
            plan.append(PlanSegment(start: seg.start, end: seg.end, rate: 1, muted: false, caption: caption(seg.pitch), pitchIndex: seg.pitch, replay: false))
            guard replays else { continue }
            for i in sorted.indices where (sorted[i].outcome?.isSwing ?? false) && shows(i, seg) {
                guard let w = replayWindow(pitch: i, segments: [seg], pitchTimes: times, timings: timings) else { continue }
                plan.append(PlanSegment(start: w.lowerBound, end: w.upperBound, rate: timings.replayRate, muted: true,
                                        caption: "\(caption(i)) · Replay", pitchIndex: i, replay: true))
            }
        }
        return plan
    }

    /// The ball in play "Just the hit" shows: the last one, as an index into
    /// the pitches sorted by time.
    static func hitPitch(_ pitches: [Pitch]) -> Int? {
        pitches.sorted { $0.t < $1.t }.lastIndex { $0.outcome == .inPlay }
    }
}
