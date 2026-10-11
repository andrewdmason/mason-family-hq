import Foundation

// The finished at-bat: the moments around each pitch, with a slow-motion
// replay of every swing. A rule-for-rule port of the web quick version
// (src/lib/clips/plan.ts) so phone at-bats and uploaded ones look alike — keep
// the two in step. The phone adds a closing result card.

struct EditTimings: Codable, Equatable {
    /// Seconds shown before the tap — the load and stride.
    var lead = 2.0
    /// Seconds after the tap on a take or a miss.
    var tail = 1.0
    /// Seconds after contact — the follow-through and leaving the box.
    var contactTail = 3.0
    /// The swing replay window around the tap.
    var replayBefore = 0.8
    var replayAfter = 0.4
    /// Replay speed. ¼ of 240fps plays every captured frame at 60fps.
    var replayRate = 0.25
    /// The closing result card.
    var endCard = 2.0

    static let standard = EditTimings()
}

struct PlanSegment: Equatable {
    /// Source range in the raw recording, in seconds.
    var start: Double
    var end: Double
    /// 1 for real speed, the replay rate for a swing replay.
    var rate: Double
    /// Replays are muted — slowed-down crowd noise sounds awful.
    var muted: Bool
    var caption: String
    var pitchIndex: Int
    var replay: Bool

    /// Length in the finished video.
    var playLength: Double { (end - start) / rate }
}

enum QuickPlan {
    /// "Pitch 4 · 1-2 · Foul" — the count is before the pitch, like a scorebook.
    static func caption(_ p: Pitch, n: Int, count: Count, isLast: Bool, result: AtBatResult?) -> String {
        var parts = ["Pitch \(n)", count.description]
        if let o = p.outcome { parts.append(o.label) }
        if isLast, let result { parts.append(result.label) }
        return parts.joined(separator: " · ")
    }

    /// Pitch windows that would overlap are clipped so no moment plays twice at
    /// real speed; replays always follow their pitch's real-speed window.
    static func build(pitches: [Pitch], duration: Double, result: AtBatResult?, timings: EditTimings = .standard) -> [PlanSegment] {
        let sorted = pitches.sorted { $0.t < $1.t }
        let counts = Scorebook.countsBefore(sorted)
        var segments: [PlanSegment] = []
        var prevEnd = 0.0
        for (i, p) in sorted.enumerated() {
            let isLast = i == sorted.count - 1
            let caption = caption(p, n: i + 1, count: counts[i], isLast: isLast, result: result)
            let contact = p.outcome?.isContact ?? false
            let start = max(0, p.t - timings.lead, prevEnd)
            let end = min(duration, p.t + (contact ? timings.contactTail : timings.tail))
            if end - start > 0.05 {
                segments.append(PlanSegment(start: start, end: end, rate: 1, muted: false, caption: caption, pitchIndex: i, replay: false))
                prevEnd = end
            }
            if p.outcome?.isSwing ?? false {
                let rs = max(0, p.t - timings.replayBefore)
                let re = min(duration, p.t + timings.replayAfter)
                if re - rs > 0.05 {
                    segments.append(PlanSegment(start: rs, end: re, rate: timings.replayRate, muted: true, caption: "\(caption) · Replay", pitchIndex: i, replay: true))
                }
            }
        }
        return segments
    }

    static func duration(_ plan: [PlanSegment]) -> Double {
        plan.reduce(0) { $0 + $1.playLength }
    }

    /// Where each pitch lands in the finished video (the tap moment inside its
    /// real-speed window), so Clips' prev/next pitch can jump to it. Indexed
    /// like the sorted pitch list.
    static func editTimes(pitches: [Pitch], plan: [PlanSegment]) -> [Double] {
        let sorted = pitches.sorted { $0.t < $1.t }
        var offsets: [Double] = []
        var acc = 0.0
        for s in plan {
            offsets.append(acc)
            acc += s.playLength
        }
        return sorted.enumerated().map { i, p in
            // The real-speed window showing the tap — usually the pitch's own,
            // or an earlier one that swallowed it when two pitches were close.
            if let k = plan.firstIndex(where: { !$0.replay && p.t >= $0.start && p.t <= $0.end }) {
                return offsets[k] + p.t - plan[k].start
            }
            if let k = plan.firstIndex(where: { $0.pitchIndex == i }) { return offsets[k] }
            // Window clipped away entirely: the start of the next pitch's footage.
            if let k = plan.firstIndex(where: { $0.pitchIndex > i }) { return offsets[k] }
            return acc
        }
    }
}
