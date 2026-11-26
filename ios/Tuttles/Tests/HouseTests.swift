import XCTest
@testable import Tuttles

/// The house (Tuttles/iPhone/House): the catalogue, the purse and what things
/// cost, which can all be checked without looking at it.
@MainActor
final class HouseTests: XCTestCase {
    func testTheCatalogueHangsTogether() {
        let rooms = HouseCatalog.rooms
        XCTAssertEqual(Set(rooms.map(\.id)).count, rooms.count)
        XCTAssertEqual(Set(rooms.map(\.cell)).count, rooms.count, "two rooms in one place")
        XCTAssertEqual(rooms.first?.id, HouseCatalog.first)
        XCTAssertEqual(rooms.first?.cell, [0, 0, 0])
        var ids = Set<String>()
        for room in rooms {
            // Up one is back one, so no room stands in front of another.
            XCTAssertEqual(room.cell[0] + room.cell[2], -room.cell[1], room.id)
            XCTAssertTrue(room.cell[0] <= 0 && room.cell[2] <= 0, room.id)
            XCTAssertEqual(Set(room.spots.map(\.id)).count, room.spots.count, room.id)
            XCTAssertGreaterThanOrEqual(room.spots.count, 9, room.id)
            // Walls and a floor always have something on them.
            XCTAssertNotNil(room.spot("walls")?.starter, room.id)
            XCTAssertNotNil(room.spot("floor")?.starter, room.id)
            for spot in room.spots {
                XCTAssertFalse(spot.items.isEmpty, "\(room.id).\(spot.id)")
                for item in spot.items {
                    XCTAssertTrue(ids.insert(item.id).inserted, item.id)
                    XCTAssertFalse(item.name.isEmpty || item.blurb.isEmpty, item.id)
                    // Coins or gems, never both.
                    XCTAssertFalse(item.coins > 0 && item.gems > 0, item.id)
                    XCTAssertEqual(HouseCatalog.item(item.id), item)
                    if case .pet = item.look { XCTAssertGreaterThan(item.gems, 0, "pets are for gems: \(item.id)") }
                }
            }
        }
        // The room they start in has a bed in it.
        XCTAssertNotNil(HouseCatalog.room(HouseCatalog.first)?.spot("bed")?.starter)
        XCTAssertEqual(rooms.filter { $0.gems > 0 }.map(\.id), ["basement", "observatory"])
    }

    func testEveryModelTheCatalogueAsksForIsThere() {
        var wanted = Set<String>()
        for room in HouseCatalog.rooms { for spot in room.spots { for item in spot.items {
            switch item.look {
            case .kit(let name, _): wanted.insert("furniture/\(name)")
            case .stack(let a, let b): wanted.formUnion(["furniture/\(a)", "furniture/\(b)"])
            case .food(let name): wanted.insert("food/\(name)")
            case .tree(let name): wanted.insert("city/\(name)")
            case .pet(let name): wanted.insert("pets/\(name)")
            default: break
            }
        } } }
        wanted.formUnion(["furniture/bookcaseOpen", "furniture/cardboardBoxClosed", "furniture/cardboardBoxOpen"])
        let missing = wanted.filter { !FileManager.default.fileExists(atPath: MathModels.folder.appending(path: $0 + ".glb").path) }
        XCTAssertEqual(missing.sorted(), [])
    }

    func testPayingInIsOncePerKey() {
        var state = HouseState()
        XCTAssertTrue(state.pay(key: "chest:a", coins: 220, gems: 0, from: "vocab", day: "2026-11-26"))
        XCTAssertFalse(state.pay(key: "chest:a", coins: 220, gems: 0, from: "vocab", day: "2026-11-26"))
        XCTAssertTrue(state.pay(key: "boss:1", coins: 400, gems: 1, from: "vocab", day: "2026-11-26"))
        state.add(coins: 95, gems: 0, from: "math", day: "2026-11-26")
        state.add(coins: 105, gems: 0, from: "math", day: "2026-11-27")
        XCTAssertEqual(state.coins, 820)
        XCTAssertEqual(state.gems, 1)
        XCTAssertEqual(state.earned, 820)
        // A line a day for each game, for the parents.
        XCTAssertEqual(state.days.map { "\($0.day) \($0.from) \($0.coins) \($0.gems)" },
                       ["2026-11-26 vocab 620 1", "2026-11-26 math 95 0", "2026-11-27 math 105 0"])
        XCTAssertEqual(HousePursesView.lately(state).map(\.text), ["Math 105", "Vocab 620 · Math 95 · 1 gem"])
    }

    func testBuyingAndSwapping() throws {
        let room = try XCTUnwrap(HouseCatalog.room("bedroom")), rug = try XCTUnwrap(room.spot("rug")), bed = try XCTUnwrap(room.spot("bed"))
        var state = HouseState()
        // The bed it comes with is there; the rug's spot is empty.
        XCTAssertEqual(state.item(in: bed, of: room.id)?.id, "bedroom.bed.single")
        XCTAssertNil(state.item(in: rug, of: room.id))
        XCTAssertEqual(state.filled.0, 0)

        let stripe = rug.items[0], space = try XCTUnwrap(rug.items.first { $0.id == "bedroom.rug.space" })
        XCTAssertFalse(state.place(stripe, in: rug, of: room.id), "nothing to pay with")
        state.add(coins: 2500, gems: 0, from: "math", day: "d")
        XCTAssertTrue(state.place(stripe, in: rug, of: room.id))
        XCTAssertEqual(state.coins, 2500 - stripe.coins)
        XCTAssertTrue(state.place(space, in: rug, of: room.id))
        let left = state.coins
        XCTAssertEqual(left, 2500 - stripe.coins - space.coins)
        // Both are theirs: going back to the first costs nothing.
        XCTAssertTrue(state.place(stripe, in: rug, of: room.id))
        XCTAssertEqual(state.coins, left)
        XCTAssertEqual(state.item(in: rug, of: room.id), stripe)
        XCTAssertEqual(state.filled.0, 1)
        // Taken out, it's still theirs.
        state.clear(rug, of: room.id)
        XCTAssertNil(state.item(in: rug, of: room.id))
        XCTAssertTrue(state.owns(stripe))
        // A thing only goes in its own spot, and only in a room they have.
        XCTAssertFalse(state.place(stripe, in: bed, of: room.id))
        let living = try XCTUnwrap(HouseCatalog.room("living"))
        XCTAssertFalse(state.place(living.spots[2].items[0], in: living.spots[2], of: living.id))

        // A gem thing takes gems, not coins.
        let pet = try XCTUnwrap(room.spot("pet")), cat = pet.items[0]
        XCTAssertFalse(state.place(cat, in: pet, of: room.id))
        state.add(coins: 0, gems: cat.gems, from: "vocab", day: "d")
        XCTAssertTrue(state.place(cat, in: pet, of: room.id))
        XCTAssertEqual(state.gems, 0)
        XCTAssertEqual(state.coins, left)

        // And it all reads back, as it would from the website or another phone.
        let copy = try JSONDecoder().decode(HouseState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(copy, state)
        // One from a phone that knew less still reads.
        let old = try JSONDecoder().decode(HouseState.self, from: Data(#"{"coins":40}"#.utf8))
        XCTAssertEqual(old.coins, 40)
        XCTAssertEqual(old.rooms, [HouseCatalog.first])
    }

    func testRoomsGetDearer() throws {
        var state = HouseState()
        let living = try XCTUnwrap(HouseCatalog.room("living")), kitchen = try XCTUnwrap(HouseCatalog.room("kitchen"))
        let basement = try XCTUnwrap(HouseCatalog.room("basement"))
        XCTAssertEqual(state.price(of: living).coins, 800)
        XCTAssertFalse(state.unlock(living))
        state.add(coins: 2000, gems: 8, from: "math", day: "d")
        XCTAssertTrue(state.unlock(living))
        XCTAssertEqual(state.coins, 1200)
        // Whichever they choose next is the second room's price.
        XCTAssertEqual(state.price(of: kitchen).coins, 1200)
        // A gem room is gems, and doesn't make the coin rooms dearer.
        XCTAssertEqual(state.price(of: basement).gems, 8)
        XCTAssertTrue(state.unlock(basement))
        XCTAssertEqual(state.gems, 0)
        XCTAssertEqual(state.price(of: kitchen).coins, 1200)
        XCTAssertTrue(state.unlock(kitchen))
        XCTAssertEqual(state.coins, 0)
        XCTAssertEqual(state.rooms, ["bedroom", "living", "basement", "kitchen"])
        XCTAssertTrue(state.unlock(kitchen), "already theirs")
        XCTAssertEqual(state.coins, 0)
    }

    /// The prices against what a day pays: about 300 coins for both games'
    /// goals done well, and the test six and a half weeks off (2026-11-26).
    func testThePricesSuitWhatADayPays() {
        let day = 300
        let coinRooms = HouseCatalog.rooms.filter { $0.gems == 0 }
        // A room is about a week, each dearer than the last.
        let prices = (1..<coinRooms.count).map { HouseCatalog.roomPrice(owned: $0) }
        XCTAssertEqual(prices, prices.sorted())
        XCTAssertTrue(prices.allSatisfy { (day * 2...day * 9).contains($0) }, "\(prices)")
        // Something to buy every day, in every room.
        var cheapest = 0, best = 0
        for room in coinRooms {
            for spot in room.spots {
                let coins = spot.items.filter { $0.coins > 0 }.map(\.coins)
                guard let low = coins.min(), let high = coins.max() else { continue }
                XCTAssertLessThanOrEqual(low, day, "\(room.id).\(spot.id)")
                cheapest += low
                best += high
            }
        }
        // Six rooms with something in every spot is most of the days to the
        // test, for a kid who never misses one; the best of everything is
        // more than there are, so there's always something out of reach.
        let rooms = prices.reduce(0, +)
        XCTAssertTrue((34...46).contains((rooms + cheapest) / day), "\((rooms + cheapest) / day) days")
        XCTAssertTrue((50...66).contains((rooms + best) / day), "\((rooms + best) / day) days")

        // Vocab's ten minutes (four chests, mostly silver and gold) against Math's day: rough parity.
        let vocab = 2 * VocabPay.bonus(.silver) + 2 * VocabPay.bonus(.gold)
        XCTAssertTrue((100...160).contains(vocab), "\(vocab)")
        // Math's: 15 right of 20 at a middling pace and run, and the track's stars, 10 to a coin.
        let answers = (1...15).map { MathPay.answer(difficulty: 2, left: 0.5, streak: ($0 - 1) % 4 + 1) }.reduce(0, +)
        let math = MathPay.coins(stars: answers + 700, carried: 0).coins
        XCTAssertTrue((140...220).contains(math), "\(math)")
    }

    /// Vocab's winnings wait for the day's ten minutes: a chest only on its own day, a boss any day.
    func testVocabWinningsWaitForTheTenMinutes() {
        let chest = VocabPay.chest(.gold, session: "s", day: "2026-11-26")
        let boss = VocabPay.boss(stage: 3, day: "2026-11-25")
        XCTAssertEqual(chest.coins, 40)
        XCTAssertEqual(boss.coins, 50)
        XCTAssertEqual(boss.gems, 1)
        XCTAssertTrue(VocabPay.stillGood(chest, today: "2026-11-26"))
        XCTAssertFalse(VocabPay.stillGood(chest, today: "2026-11-27"), "a chest is lost at midnight")
        XCTAssertTrue(VocabPay.stillGood(boss, today: "2026-11-27"), "a boss waits")
        // From before they waited: dropped.
        XCTAssertFalse(VocabPay.stillGood(VocabEarning(key: "chest:x", coins: 300, gems: 0), today: "2026-11-26"))
    }

    /// Math pays by stars, 10 to a coin, the rest carried to the next run.
    func testMathStarsMakeCoins() {
        XCTAssertEqual(MathPay.coins(stars: 137, carried: 0).coins, 13)
        XCTAssertEqual(MathPay.coins(stars: 137, carried: 0).left, 7)
        XCTAssertEqual(MathPay.coins(stars: 5, carried: 7).coins, 1)
        XCTAssertEqual(MathPay.coins(stars: 5, carried: 7).left, 2)
        XCTAssertEqual(MathPay.pickup(double: false), 1)
        XCTAssertEqual(MathPay.pickup(double: true), 2)
    }

    /// A house kept under the first economy reads as one, so the phone starts it again.
    func testAnOldHouseIsOfTheFirstEconomy() throws {
        let old = try JSONDecoder().decode(HouseState.self, from: Data(#"{"coins":12000,"backPaid":true}"#.utf8))
        XCTAssertEqual(old.economy, 1)
        XCTAssertEqual(HouseState().economy, HouseState.economy)
        let copy = try JSONDecoder().decode(HouseState.self, from: JSONEncoder().encode(HouseState()))
        XCTAssertEqual(copy.economy, HouseState.economy)
    }
}
