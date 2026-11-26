import XCTest
@testable import Tuttles

/// Math, the ISEE runner (Tuttles/iPhone/Math): the parts that can be checked
/// without playing it.
@MainActor
final class MathTests: XCTestCase {
    func testBothBanksLoadWithAskableQuestions() {
        for level in [VocabLevel.lower, .middle] {
            let questions = MathBank.questions(level)
            XCTAssertGreaterThanOrEqual(questions.count, 40, "\(level)")
            XCTAssertEqual(Set(questions.map(\.id)).count, questions.count, "ids repeat in \(level)")
            for q in questions {
                XCTAssertEqual(q.choices.count, 4, q.id)
                XCTAssertTrue((0..<4).contains(q.answer), q.id)
                XCTAssertTrue(["qr", "ma"].contains(q.section), q.id)
                XCTAssertTrue((1...3).contains(q.difficulty), q.id)
                // Every dollar sign is math's or escaped, so the typesetter is never handed half a formula.
                for text in [q.prompt, q.explanation] + q.choices + [q.columnA ?? "", q.columnB ?? ""] {
                    let math = MathText.split(text).filter { if case .math = $0 { return true } else { return false } }
                    let unescaped = text.replacingOccurrences(of: "\\$", with: "").filter { $0 == "$" }.count
                    XCTAssertEqual(unescaped % 2, 0, "\(q.id): \(text)")
                    XCTAssertEqual(math.count, unescaped / 2, "\(q.id): \(text)")
                }
            }
        }
        // Comparisons are a Middle Level thing.
        XCTAssertFalse(MathBank.questions(.lower).contains { $0.type == "comparison" })
    }

    func testTextSplitsIntoWordsAndMath() {
        XCTAssertEqual(MathText.split("What is $\\frac{3}{4}$ of 20?"), [.words("What is "), .math("\\frac{3}{4}"), .words(" of 20?")])
        XCTAssertEqual(MathText.split("It costs \\$5.50 and \\$2."), [.words("It costs $5.50 and $2.")])
        XCTAssertEqual(MathText.split("$x^2$"), [.math("x^2")])
        XCTAssertEqual(MathText.split(""), [])
    }

    func testAMissedQuestionComesBackFirst() {
        let all = MathBank.questions(.middle)
        guard all.count > 5 else { return XCTFail("no bank") }
        let missed = all[3].id
        var rng = SystemRandomNumberGenerator()
        var came = 0
        for _ in 0..<60 {
            if MathBank.next(level: .middle, runLevel: 0, seen: [:], comeback: [missed], asked: [], using: &rng)?.id == missed { came += 1 }
        }
        XCTAssertGreaterThan(came, 25)
        // But never twice in one run.
        for _ in 0..<20 {
            XCTAssertNotEqual(MathBank.next(level: .middle, runLevel: 0, seen: [:], comeback: [missed], asked: [missed], using: &rng)?.id, missed)
        }
    }

    func testQuestionsGetHarderFurtherIntoARun() {
        var rng = SystemRandomNumberGenerator()
        func average(_ runLevel: Int) -> Double {
            let picks = (0..<80).compactMap { _ in MathBank.next(level: .middle, runLevel: runLevel, seen: [:], comeback: [], asked: [], using: &rng)?.difficulty }
            return Double(picks.reduce(0, +)) / Double(max(1, picks.count))
        }
        XCTAssertLessThan(average(0), average(6))
    }

    func testARightAnswerPaysMoreForHardFastAndInARow() {
        XCTAssertGreaterThan(MathStore.payout(difficulty: 3, fraction: 0.5, streak: 1), MathStore.payout(difficulty: 1, fraction: 0.5, streak: 1))
        XCTAssertGreaterThan(MathStore.payout(difficulty: 2, fraction: 0.9, streak: 1), MathStore.payout(difficulty: 2, fraction: 0.1, streak: 1))
        XCTAssertGreaterThan(MathStore.payout(difficulty: 2, fraction: 0.5, streak: 4), MathStore.payout(difficulty: 2, fraction: 0.5, streak: 1))
        // The run of right answers stops counting at three times.
        XCTAssertEqual(MathStore.payout(difficulty: 2, fraction: 0.5, streak: 40), MathStore.payout(difficulty: 2, fraction: 0.5, streak: 9))
    }

    func testEveryCharacterAndPropInTheGameLoads() {
        for name in MathLook.heads {
            let rig = MiniRigData.load(name)
            XCTAssertNotNil(rig, name)
            XCTAssertEqual(Set(rig?.parts.map(\.joint) ?? []), Set(1...6), "\(name) is missing a limb")
            for clip in ["idle", "sprint", "jump", "fall", "crouch", "die", "sit", "static", "emote-yes", "emote-no", "holding-both", "attack-melee-right", "interact-right", "pick-up"] {
                XCTAssertNotNil(rig?.clips[clip], "\(name) has no \(clip)")
            }
        }
        for prop in ["furniture/trashcan", "furniture/pottedPlant", "furniture/desk", "furniture/table", "furniture/loungeChair",
                     "furniture/kitchenFridgeLarge", "furniture/computerScreen", "city/tree-large", "city/tree-small",
                     "food/burger", "food/pizza", "food/cake", "food/donut-sprinkles", "food/turkey", "food/apple", "food/fries",
                     "food/soda", "food/sandwich", "food/banana"] {
            XCTAssertNotNil(MathModels.prop(prop), prop)
        }
    }

    func testEveryZoneBuildsATileAndSomethingForEachKindOfObstacle() {
        var rng = MathRNG(seed: 1)
        for (index, zone) in MathZone.all.enumerated() {
            for variant in 0..<MathZone.variants {
                XCTAssertFalse(zone.fixed(variant, &rng).childNodes.isEmpty, zone.key)
            }
            let tile = MathTile(index: 0, zone: index, variant: 0)
            zone.live(tile, &rng)
            for builders in [zone.low, zone.high, zone.full] {
                XCTAssertFalse(builders.isEmpty, zone.key)
                for build in builders { _ = build(&rng) }
            }
            _ = zone.gate()
        }
        // The first five are the ordinary school; after that it goes round the wrong ones.
        XCTAssertEqual(MathZone.index(forLevel: 0), 0)
        XCTAssertEqual(MathZone.index(forLevel: 4), 4)
        XCTAssertEqual(MathZone.index(forLevel: MathZone.all.count), 5)
        XCTAssertTrue((0..<60).allSatisfy { MathZone.all.indices.contains(MathZone.index(forLevel: $0)) })
    }

    func testTheShopHasOneDefaultInEverySlotAndNothingRepeats() {
        XCTAssertEqual(Set(MathCatalog.items.map(\.id)).count, MathCatalog.items.count)
        for slot in MathCatalog.slots {
            let items = MathCatalog.items(in: slot.id)
            XCTAssertEqual(items.filter(\.isDefault).count, 1, slot.id)
            XCTAssertTrue(items.filter(\.isDefault).allSatisfy { $0.price == 0 }, slot.id)
            XCTAssertGreaterThanOrEqual(items.count, 6, slot.id)
        }
    }

    func testEverySoundTheGameAsksForIsThere() {
        let folder = Bundle.main.bundleURL.appending(path: "MathAssets/audio")
        let have = Set(((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).map { ($0 as NSString).deletingPathExtension })
        let wanted = ["star-1", "star-2", "star-3", "jump", "land", "slide", "lane", "step-1", "step-2", "step-3", "step-4", "throw", "thud", "warn",
                      "crash", "caught", "power", "magnet", "jetpack", "spring", "board", "shield-break", "correct", "wrong", "tick", "tick-urgent",
                      "free", "wave-up", "gameover", "door", "buy", "equip", "tap", "deny", "bell", "goal", "voice-1", "voice-2", "voice-3", "voice-4",
                      "voice-5", "music-run", "music-menu", "amb-hall", "amb-outside", "amb-cafeteria", "amb-gym", "amb-strange"]
        for name in wanted { XCTAssertTrue(have.contains(name), name) }
    }
}
