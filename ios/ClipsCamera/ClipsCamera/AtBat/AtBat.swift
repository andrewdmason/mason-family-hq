import Foundation

// The at-bat as the phone logs it: one pitch per tap, labeled the way Scorelord
// (and GameChanger) score a pitch. Raw values match Baseball Clips' database so
// the upload in phase 2 is a straight copy.

enum PitchOutcome: String, Codable, CaseIterable, Identifiable {
    case ball
    case calledStrike = "called_strike"
    case swingingStrike = "swinging_strike"
    case foul
    case inPlay = "in_play"
    case hitByPitch = "hit_by_pitch"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .ball: "Ball"
        case .calledStrike: "Called strike"
        case .swingingStrike: "Swinging strike"
        case .foul: "Foul"
        case .inPlay: "Ball in play"
        case .hitByPitch: "Hit by pitch"
        }
    }

    /// Short form for the pitch strip.
    var short: String {
        switch self {
        case .ball: "B"
        case .calledStrike: "S"
        case .swingingStrike: "SW"
        case .foul: "F"
        case .inPlay: "IP"
        case .hitByPitch: "HBP"
        }
    }

    var isSwing: Bool { self == .swingingStrike || self == .foul || self == .inPlay }
    var isContact: Bool { self == .foul || self == .inPlay }
}

enum BattedBall: String, Codable, CaseIterable, Identifiable {
    case groundBall = "ground_ball"
    case lineDrive = "line_drive"
    case flyBall = "fly_ball"
    case popFly = "pop_fly"
    case bunt

    var id: String { rawValue }

    var label: String {
        switch self {
        case .groundBall: "Grounder"
        case .lineDrive: "Line drive"
        case .flyBall: "Fly ball"
        case .popFly: "Pop-up"
        case .bunt: "Bunt"
        }
    }
}

/// What happened on a ball in play.
enum PlayResult: String, Codable, CaseIterable, Identifiable {
    case single, double, triple, homeRun, out, error, fieldersChoice

    var id: String { rawValue }

    var label: String {
        switch self {
        case .single: "Single"
        case .double: "Double"
        case .triple: "Triple"
        case .homeRun: "Home run"
        case .out: "Out"
        case .error: "Error"
        case .fieldersChoice: "Fielder's choice"
        }
    }
}

/// The at-bat's result, in Baseball Clips' scorebook codes.
enum AtBatResult: String, Codable {
    case strikeoutSwinging = "K"
    case strikeoutLooking = "KL"
    case walk = "BB"
    case hitByPitch = "HBP"
    case single = "1B"
    case double = "2B"
    case triple = "3B"
    case homeRun = "HR"
    case groundout = "GO"
    case flyout = "FO"
    case lineout = "LO"
    case popout = "PO"
    case reachedOnError = "ROE"
    case fieldersChoice = "FC"

    /// Badge text, as the web app shows it (a backwards K for looking).
    var label: String { self == .strikeoutLooking ? "ꓘ" : rawValue }

    var name: String {
        switch self {
        case .strikeoutSwinging: "Strikeout swinging"
        case .strikeoutLooking: "Strikeout looking"
        case .walk: "Walk"
        case .hitByPitch: "Hit by pitch"
        case .single: "Single"
        case .double: "Double"
        case .triple: "Triple"
        case .homeRun: "Home run"
        case .groundout: "Groundout"
        case .flyout: "Flyout"
        case .lineout: "Lineout"
        case .popout: "Popout"
        case .reachedOnError: "Reached on error"
        case .fieldersChoice: "Fielder's choice"
        }
    }

    /// What the deciding ball in play did, for an at-bat that ended in play.
    var playResult: PlayResult? {
        switch self {
        case .single: .single
        case .double: .double
        case .triple: .triple
        case .homeRun: .homeRun
        case .groundout, .flyout, .lineout, .popout: .out
        case .reachedOnError: .error
        case .fieldersChoice: .fieldersChoice
        case .strikeoutSwinging, .strikeoutLooking, .walk, .hitByPitch: nil
        }
    }

    static func inPlay(_ result: PlayResult, battedBall: BattedBall?) -> AtBatResult {
        switch result {
        case .single: .single
        case .double: .double
        case .triple: .triple
        case .homeRun: .homeRun
        case .error: .reachedOnError
        case .fieldersChoice: .fieldersChoice
        case .out:
            switch battedBall {
            case .flyBall: .flyout
            case .lineDrive: .lineout
            case .popFly: .popout
            case .groundBall, .bunt, nil: .groundout
            }
        }
    }
}

struct Pitch: Identifiable, Codable, Equatable {
    var id = UUID()
    /// Seconds into the raw recording: the moment of the tap.
    var t: Double
    var outcome: PitchOutcome?
    var battedBall: BattedBall?
    var playResult: PlayResult?

    /// Fully labeled: an outcome, and for a ball in play its type and result.
    var isComplete: Bool {
        guard let outcome else { return false }
        return outcome != .inPlay || (battedBall != nil && playResult != nil)
    }
}

struct Count: Equatable, CustomStringConvertible {
    var balls = 0
    var strikes = 0
    var description: String { "\(min(balls, 3))-\(min(strikes, 2))" }
}

/// Scorebook arithmetic over a pitch list. Unlabeled pitches don't move the
/// count; the at-bat ends at the first pitch that decides it.
enum Scorebook {
    /// The count before each pitch.
    static func countsBefore(_ pitches: [Pitch]) -> [Count] {
        var c = Count()
        return pitches.map { p in
            let before = c
            apply(p.outcome, to: &c)
            return before
        }
    }

    /// The count after every labeled pitch so far.
    static func count(_ pitches: [Pitch]) -> Count {
        var c = Count()
        for p in pitches { apply(p.outcome, to: &c) }
        return c
    }

    /// The pitch that ended the at-bat and its result, or nil while it's still going.
    static func outcome(_ pitches: [Pitch]) -> (index: Int, result: AtBatResult)? {
        var c = Count()
        for (i, p) in pitches.enumerated() {
            guard let o = p.outcome else { continue }
            switch o {
            case .hitByPitch:
                return (i, .hitByPitch)
            case .inPlay:
                // Over once the result is in; until then it's still being labeled.
                guard let r = p.playResult else { return nil }
                return (i, .inPlay(r, battedBall: p.battedBall))
            default:
                apply(o, to: &c)
                if c.balls >= 4 { return (i, .walk) }
                if c.strikes >= 3 { return (i, o == .calledStrike ? .strikeoutLooking : .strikeoutSwinging) }
            }
        }
        return nil
    }

    private static func apply(_ o: PitchOutcome?, to c: inout Count) {
        switch o {
        case .ball: c.balls += 1
        case .calledStrike, .swingingStrike: c.strikes += 1
        case .foul where c.strikes < 2: c.strikes += 1
        default: break
        }
    }
}
