import Foundation

// What the games pay. Coins and gems are spent on the house (iPhone/House):
// one purse for Vocab and Math. Coins are for things done well, never for time
// spent, and the numbers are small (Andrew, 2026-11-26: "divide everything by
// 10"). A good day of both games is about 300 coins: Vocab's ten minutes are
// about four chests, 120 or so; Math's day of runs about 1,700 stars, 170 coins.
//
// Vocab pays only by the chest at the end of a session, and what it wins
// waits until the day's ten minutes are done (HouseStore.collect). A chest
// still waiting at midnight is lost; a boss (once ever) waits for the next
// day the ten minutes are done.
//
// Math pays by the stars of a run: the run's only score. 10 stars are a coin.
//
// A gem is for something hard: a boss beaten in Vocab, a strong day in Math
// (the day's 20 with at least 15 right, once a day).
//
// The best of it pays the most (Andrew, 2026-11-27: "exceptional performance
// should come with exceptional rewards"). Doing well is about 300 a day;
// doing everything right is more like twice that, and a second gem:
// - Vocab: a session with every answer right is a perfect chest, 60 not 40.
//   The day's ten minutes done with every chest gold (at least three) is a
//   golden day: a gem and 100 coins.
// - Math: right answers in a row multiply up to ×3 (the ninth in a row), not
//   ×2. The day's first 20 all right is a perfect day: a gem more than the
//   strong day's, and 100 coins. A run with more stars than ever before pays
//   its coins twice (up to 300 more), once a day.

/// Coins and gems won in Vocab, waiting for the purse to take them. The key
/// is what it was for, so nothing is paid twice.
struct VocabEarning: Codable, Hashable {
    let key: String
    let coins: Int
    let gems: Int
    /// The day it was won. Nil: from before the coins waited, so it's dropped.
    var day: String? = nil

    /// A boss's, which waits for any day the ten minutes are done.
    var isBoss: Bool { key.hasPrefix("boss:") }
}

enum VocabPay {
    static let bossCoins = 50
    /// A gold chest with every answer right.
    static let perfectCoins = 60
    /// A golden day: the ten minutes done with at least this many chests, all of them gold.
    static let goldenChests = 3
    static let goldenCoins = 100

    static func bonus(_ chest: VocabChest) -> Int {
        switch chest {
        case .wood: 10
        case .silver: 25
        case .gold: 40
        }
    }

    /// What a chest holds: a perfect one more than gold.
    static func coins(_ chest: VocabChest, perfect: Bool) -> Int {
        chest == .gold && perfect ? perfectCoins : bonus(chest)
    }

    static func chestKey(_ session: String) -> String { "chest:\(session)" }
    static func bossKey(_ stage: Int) -> String { "boss:\(stage)" }

    static func goldenKey(_ day: String) -> String { "vocabgold:\(day)" }

    static func chest(_ chest: VocabChest, perfect: Bool = false, session: String, day: String) -> VocabEarning {
        VocabEarning(key: chestKey(session), coins: coins(chest, perfect: perfect), gems: 0, day: day)
    }

    /// Whether a day's chests make it a golden day: enough of them, and every one gold.
    static func golden(_ chests: [VocabChest]) -> Bool {
        chests.count >= goldenChests && chests.allSatisfy { $0 == .gold }
    }

    static func boss(stage: Int, day: String) -> VocabEarning {
        VocabEarning(key: bossKey(stage), coins: bossCoins, gems: 1, day: day)
    }

    /// Whether something won is still to be paid on `today`: a chest only on
    /// the day it was won, a boss whenever.
    static func stillGood(_ earning: VocabEarning, today: String) -> Bool {
        guard let day = earning.day else { return false }
        return earning.isBoss || day == today
    }
}

enum MathPay {
    /// Right answers, of the day's 20, that make it a strong day.
    static let strongDay = 15
    static func gemKey(_ day: String) -> String { "mathgem:\(day)" }
    /// The day's first 20 all right: a second gem, and these coins.
    static func perfectKey(_ day: String) -> String { "mathperfect:\(day)" }
    static let perfectCoins = 100
    /// A run with the most stars yet pays its coins again, up to this many, once a day.
    static func bestKey(_ day: String) -> String { "mathbest:\(day)" }
    static let bestMost = 300
    static func bestBonus(coins: Int) -> Int { min(max(0, coins), bestMost) }

    /// Stars to a coin.
    static let starsPerCoin = 10
    /// The most a run of right answers multiplies an answer's stars by: the ninth in a row.
    static let streakCap = 3.0

    /// A star picked up on the track: 2 with Double on.
    static func pickup(double: Bool) -> Int { double ? 2 : 1 }

    /// What a right answer pays in stars: 25 to 70 by how hard and how quick
    /// (`left`, the share of its time still to go), times how many in a row
    /// (×1 for the first, a quarter more for each after, up to ×3).
    static func answer(difficulty: Int, left: Double, streak: Int) -> Int {
        let base = 15 + 10 * Double(min(3, max(1, difficulty))) + 25 * max(0, min(1, left))
        let times = min(streakCap, 1 + 0.25 * Double(max(0, streak - 1)))
        return Int((base * times).rounded())
    }

    /// The coins some stars make, and the stars left over for next time.
    static func coins(stars: Int, carried: Int) -> (coins: Int, left: Int) {
        let all = max(0, stars) + max(0, carried)
        return (all / starsPerCoin, all % starsPerCoin)
    }
}
