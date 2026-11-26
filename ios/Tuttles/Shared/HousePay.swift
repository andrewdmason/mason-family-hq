import Foundation

// What the games pay. Coins and gems are spent on the house (iPhone/House):
// one purse for Vocab and Math. Coins are for things done well, never for time
// spent. Math's payouts are where they were when its coins were stars
// (MathStore.payout: a right answer is about 100, a day's 20 questions with
// the track between them about 3,000, over twenty-odd minutes). Vocab's are
// sized against that: its ten minutes are about a hundred answers and four
// chests, which at these rates is 1,200 to 1,500, so a minute of doing well
// pays about the same in either.
//
// A gem is for something hard: a boss beaten in Vocab, a strong day in Math
// (the day's 20 with at least 15 right, once a day).

/// Coins and gems won in Vocab, waiting for the purse to take them. The key
/// is what it was for, so nothing is paid twice.
struct VocabEarning: Codable, Hashable {
    let key: String
    let coins: Int
    let gems: Int
}

enum VocabPay {
    /// Each right answer of a session, paid with its chest.
    static let perRight = 8
    static let bossCoins = 400

    static func bonus(_ chest: VocabChest) -> Int {
        switch chest {
        case .wood: 40
        case .silver: 100
        case .gold: 180
        }
    }

    static func chestKey(_ session: String) -> String { "chest:\(session)" }
    static func bossKey(_ stage: Int) -> String { "boss:\(stage)" }

    static func chest(_ chest: VocabChest, right: Int, session: String) -> VocabEarning {
        VocabEarning(key: chestKey(session), coins: perRight * max(0, right) + bonus(chest), gems: 0)
    }

    static func boss(stage: Int) -> VocabEarning {
        VocabEarning(key: bossKey(stage), coins: bossCoins, gems: 1)
    }

    /// For what was done before there was a purse: something for each stage
    /// cleared and each boss beaten, enough for a first trip to the shop.
    static func backPay(cleared: Int, beaten: Int) -> (coins: Int, gems: Int) {
        (min(6000, 150 * max(0, cleared) + 250 * max(0, beaten)), min(3, max(0, beaten)))
    }
}

enum MathPay {
    /// Right answers, of the day's 20, that make it a strong day.
    static let strongDay = 15
    static func gemKey(_ day: String) -> String { "mathgem:\(day)" }
}
