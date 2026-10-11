import XCTest
@testable import ClipsCamera

final class ScorebookTests: XCTestCase {
    private func pitches(_ outcomes: [PitchOutcome?]) -> [Pitch] {
        outcomes.enumerated().map { Pitch(t: Double($0.offset * 20 + 5), outcome: $0.element) }
    }

    func testFoulsStopAddingStrikesAtTwo() {
        let p = pitches([.foul, .foul, .foul, .foul, .ball])
        XCTAssertEqual(Scorebook.count(p), Count(balls: 1, strikes: 2))
        XCTAssertNil(Scorebook.outcome(p))
        XCTAssertEqual(Scorebook.countsBefore(p).map(\.description), ["0-0", "0-1", "0-2", "0-2", "0-2"])
    }

    func testStrikeoutLookingVsSwinging() {
        XCTAssertEqual(Scorebook.outcome(pitches([.calledStrike, .foul, .calledStrike]))?.result, .strikeoutLooking)
        XCTAssertEqual(Scorebook.outcome(pitches([.calledStrike, .foul, .swingingStrike]))?.result, .strikeoutSwinging)
    }

    func testWalkEndsOnFourthBall() {
        let o = Scorebook.outcome(pitches([.ball, .calledStrike, .ball, .ball, .ball]))
        XCTAssertEqual(o?.result, .walk)
        XCTAssertEqual(o?.index, 4)
    }

    func testUnlabeledPitchesDontCount() {
        let p = pitches([.ball, nil, .ball, .ball])
        XCTAssertEqual(Scorebook.count(p), Count(balls: 3, strikes: 0))
        XCTAssertNil(Scorebook.outcome(p))
    }

    func testHitByPitch() {
        XCTAssertEqual(Scorebook.outcome(pitches([.ball, .hitByPitch]))?.result, .hitByPitch)
    }

    func testBallInPlayWaitsForResult() {
        var p = pitches([.ball, .inPlay])
        XCTAssertNil(Scorebook.outcome(p))
        p[1].battedBall = .flyBall
        XCTAssertNil(Scorebook.outcome(p))
        p[1].playResult = .out
        XCTAssertEqual(Scorebook.outcome(p)?.result, .flyout)
        p[1].playResult = .double
        XCTAssertEqual(Scorebook.outcome(p)?.result, .double)
    }

    func testOutsMapByBattedBall() {
        XCTAssertEqual(AtBatResult.inPlay(.out, battedBall: .groundBall), .groundout)
        XCTAssertEqual(AtBatResult.inPlay(.out, battedBall: .bunt), .groundout)
        XCTAssertEqual(AtBatResult.inPlay(.out, battedBall: .lineDrive), .lineout)
        XCTAssertEqual(AtBatResult.inPlay(.out, battedBall: .popFly), .popout)
        XCTAssertEqual(AtBatResult.inPlay(.error, battedBall: .groundBall), .reachedOnError)
    }
}

final class QuickPlanTests: XCTestCase {
    func testTakeAndSwingWindows() {
        let pitches = [
            Pitch(t: 10, outcome: .ball),
            Pitch(t: 30, outcome: .foul),
        ]
        let plan = QuickPlan.build(pitches: pitches, duration: 60, result: nil)
        XCTAssertEqual(plan.count, 3)
        XCTAssertEqual(plan[0].start, 8); XCTAssertEqual(plan[0].end, 11); XCTAssertEqual(plan[0].rate, 1)
        XCTAssertEqual(plan[1].start, 28); XCTAssertEqual(plan[1].end, 33)
        XCTAssertTrue(plan[2].replay); XCTAssertTrue(plan[2].muted)
        XCTAssertEqual(plan[2].start, 29.2, accuracy: 1e-9); XCTAssertEqual(plan[2].end, 30.4, accuracy: 1e-9)
        XCTAssertEqual(plan[2].playLength, 4.8, accuracy: 1e-9)
        XCTAssertEqual(plan[0].caption, "Pitch 1 · 0-0 · Ball")
        XCTAssertEqual(plan[2].caption, "Pitch 2 · 1-0 · Foul · Replay")
    }

    func testCloseTogetherPitchesDontRepeat() {
        let pitches = [Pitch(t: 10, outcome: .foul), Pitch(t: 12, outcome: .ball)]
        let plan = QuickPlan.build(pitches: pitches, duration: 60, result: nil)
        // The foul's window runs 8→13, which already covers the ball at 12
        // (whose own window would end at 13), so it's clipped away entirely.
        let real = plan.filter { !$0.replay }
        XCTAssertEqual(real.count, 1)
        XCTAssertEqual(real[0].end, 13)
        let times = QuickPlan.editTimes(pitches: pitches, plan: plan)
        XCTAssertEqual(times[1], 4, accuracy: 1e-9) // 12 is 4s into the 8→13 window
    }

    func testClampsToRecording() {
        let plan = QuickPlan.build(pitches: [Pitch(t: 1, outcome: .inPlay, battedBall: .lineDrive, playResult: .single)], duration: 2.5, result: .single)
        XCTAssertEqual(plan[0].start, 0)
        XCTAssertEqual(plan[0].end, 2.5)
        XCTAssertEqual(plan[0].caption, "Pitch 1 · 0-0 · Ball in play · 1B")
    }

    func testEditTimesLandOnTheTap() {
        let pitches = [Pitch(t: 10, outcome: .ball), Pitch(t: 30, outcome: .swingingStrike)]
        let plan = QuickPlan.build(pitches: pitches, duration: 60, result: nil)
        let times = QuickPlan.editTimes(pitches: pitches, plan: plan)
        XCTAssertEqual(times[0], 2, accuracy: 1e-9)       // 2s lead into the first window
        XCTAssertEqual(times[1], 3 + 2, accuracy: 1e-9)   // after the 3s first window, plus the lead
    }
}
