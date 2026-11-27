import SceneKit
import XCTest
@testable import Tuttles

/// The house (Tuttles/iPhone/House): the catalogue, the purse and what things
/// cost, which can all be checked without looking at it.
@MainActor
final class HouseTests: XCTestCase {
    func testTheCatalogueHangsTogether() {
        let rooms = HouseCatalog.rooms
        XCTAssertEqual(Set(rooms.map(\.id)).count, rooms.count)
        XCTAssertEqual(rooms.first?.id, HouseCatalog.first)
        var ids = Set<String>()
        for room in rooms {
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
        XCTAssertEqual(rooms.filter { $0.gems > 0 }.map(\.id), ["basement", "observatory", "secret"])
        // Where the catalogue puts them, all together, is a house that holds together.
        // Every room has a shape of its own, and with every room where it comes the house holds together.
        for room in rooms + HouseCatalog.fixtures { XCTAssertNotNil(HouseLayout.shapes[room.id], room.id) }
        for room in HouseCatalog.yard { XCTAssertEqual(HouseLayout.shapes[room.id]?.yard, true, room.id) }
        XCTAssertNil(HouseLayout.problem(HouseLayout.standing(Array(HouseLayout.home.keys), HouseLayout.home), field: false))
    }

    func testEveryModelTheCatalogueAsksForIsThere() {
        var wanted = Set<String>()
        for room in HouseCatalog.everything + [HouseCatalog.outside] { for spot in room.spots { for item in spot.items {
            switch item.look {
            // (A piece named as the other pack names it, with a capital, is that pack's own.)
            case .kit(let name, _): wanted.insert("\(name.first?.isUppercase == true ? "house3d" : "furniture")/\(name)")
            case .stack(let a, let b): wanted.formUnion(["furniture/\(a)", "furniture/\(b)"])
            case .model(let folder, let name, _): wanted.insert("\(folder)/\(name)")
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
        // Something to buy every day, in every room. (The days are counted over the first six rooms, which
        // are what the weeks to the test are for; the rooms after them and the yard are for after it.)
        var cheapest = 0, best = 0
        for (n, room) in coinRooms.enumerated() {
            for spot in room.spots {
                let coins = spot.items.filter { $0.coins > 0 }.map(\.coins)
                guard let low = coins.min(), let high = coins.max() else { continue }
                XCTAssertLessThanOrEqual(low, day, "\(room.id).\(spot.id)")
                if n < 6 { cheapest += low; best += high }
            }
        }
        // Six rooms with something in every spot is most of the days to the
        // test, for a kid who never misses one; the best of everything is
        // more than there are, so there's always something out of reach.
        let rooms = prices.prefix(5).reduce(0, +)
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

    // MARK: Where rooms go

    func testWhatHoldsTogether() {
        func problem(_ rooms: [String: HousePlot]) -> HouseLayout.Problem? { HouseLayout.problem(HouseLayout.standing(Array(rooms.keys), rooms), field: false) }
        let hall = HouseLayout.home[HouseLayout.hall]!, bedroom = HouseLayout.home["bedroom"]!
        // A hall and a bedroom off it: where every house starts.
        XCTAssertNil(problem(["bedroom": bedroom]))
        XCTAssertEqual(hall, HousePlot(9, 20))
        // Onto the hall; off the lot; away from everything, with no door into it.
        XCTAssertEqual(problem(["bedroom": HousePlot(8, 20)]), .overlap("bedroom", "hall"))
        XCTAssertEqual(problem(["bedroom": HousePlot(-1, 20)]), .offTheLot("bedroom"))
        XCTAssertEqual(problem(["bedroom": HousePlot(0, 10)]), .noWayIn("bedroom"))
        // The field behind isn't theirs yet.
        XCTAssertEqual(problem(["bedroom": HousePlot(0, 9)]), .offTheLot("bedroom"))
        // Touching the hall, but along a wall of the hall's with the stairs against it: still no door.
        XCTAssertEqual(problem(["bedroom": HousePlot(4, 21)]), .noDoor("bedroom"))
        // Upstairs with nothing under it; over a room, and joined to the landing.
        XCTAssertEqual(problem(["bedroom": bedroom, "den": HousePlot(12, 20, floor: 1)]), .nothingUnder("den"))
        XCTAssertNil(problem(["bedroom": bedroom, "living": HouseLayout.home["living"]!, "den": HouseLayout.home["den"]!]))
        // Nothing stands on the garden, which has no roof.
        XCTAssertEqual(problem(["bedroom": bedroom, "garden": HousePlot(12, 19), "den": HousePlot(12, 20, floor: 1)]), .nothingUnder("den"))
        // The basement's under the stairs, and nothing else goes down there.
        XCTAssertNil(problem(["bedroom": bedroom, "basement": HouseLayout.home["basement"]!]))
        XCTAssertEqual(problem(["bedroom": bedroom, "basement": HousePlot(0, 10, floor: -1)]), .underStairs)
        XCTAssertEqual(problem(["bedroom": bedroom, "basement": HousePlot(7, 20)]), .wrongFloor("basement"))
        XCTAssertEqual(problem(["bedroom": HousePlot(4, 20, floor: -1)]), .wrongFloor("bedroom"))
        // Something built in front of the front door.
        XCTAssertEqual(problem(["bedroom": HousePlot(8, 25, turn: 2)]), .frontDoor)
    }

    func testPuttingRoomsWhereTheyLike() throws {
        var state = HouseState()
        state.coins = 5_000
        // A new house: the hall, and the bedroom off it. The hall's theirs without being one of their rooms.
        XCTAssertEqual(state.rooms, ["bedroom"])
        XCTAssertEqual(Set(state.layout.keys), ["hall", "bedroom"])
        XCTAssertTrue(state.has(room: "hall"))
        XCTAssertFalse(state.has(room: "landing"))
        XCTAssertEqual(state.floors, [0])
        // Somewhere the living room could go to start with; and it can't go on the bedroom.
        let living = try XCTUnwrap(HouseCatalog.room("living"))
        let first = try XCTUnwrap(state.place(for: "living"))
        XCTAssertNil(state.problem(putting: "living", at: first))
        XCTAssertNotNil(state.problem(putting: "living", at: state.plot(of: "bedroom")!))
        XCTAssertFalse(state.unlock(living, at: state.plot(of: "bedroom")!))
        XCTAssertEqual(state.coins, 5_000, "nothing's paid for a room that couldn't go there")
        XCTAssertTrue(state.unlock(living, at: first))
        XCTAssertEqual(state.plot(of: "living"), first)
        XCTAssertEqual(state.coins, 5_000 - 800)
        // Moved, free, to where it still has a door; not to where it wouldn't.
        XCTAssertFalse(state.move("living", to: HousePlot(0, 10)))
        XCTAssertEqual(state.plot(of: "living"), first)
        let turned = HousePlot(12, 19, turn: 1)
        if state.problem(putting: "living", at: turned) == nil {
            XCTAssertTrue(state.move("living", to: turned))
            XCTAssertEqual(state.plot(of: "living"), turned)
        }
        XCTAssertEqual(state.coins, 5_000 - 800)
        // A room upstairs brings the landing with it, over the hall.
        let den = try XCTUnwrap(HouseCatalog.room("den"))
        XCTAssertTrue(state.move("living", to: HouseLayout.home["living"]!))
        XCTAssertTrue(state.unlock(den, at: HouseLayout.home["den"]!))
        XCTAssertTrue(state.has(room: "landing"))
        XCTAssertEqual(state.floors, [0, 1])
        var over = state.plot(of: "hall")!
        over.floor = 1
        XCTAssertEqual(state.plot(of: "landing"), over)
        // The living room can't go while the den's on top of it; and they're told which.
        let away = HousePlot(12, 19, turn: 1)
        XCTAssertEqual(state.problem(putting: "living", at: away)?.message(moving: "living"), "The den is upstairs, on top of it. Move that one first.")
        // Where they are survives being saved and read back.
        let back = try JSONDecoder().decode(HouseState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(back.plots, state.plots)
        XCTAssertEqual(back, state)
    }

    func testAHouseFromBeforeRoomsHadSizesComesOutSound() throws {
        // As the first houses were kept: rooms, and a cell each on the old grid.
        let old = #"{"rooms":["bedroom","living","kitchen","den","basement"],"economy":2,"cells":{"bedroom":[0,0,0],"living":[1,0,0],"kitchen":[0,0,1],"den":[0,1,0],"basement":[0,-1,0]}}"#
        let state = try JSONDecoder().decode(HouseState.self, from: Data(old.utf8))
        XCTAssertEqual(Set(state.layout.keys), ["hall", "landing", "bedroom", "living", "kitchen", "den", "basement"])
        XCTAssertNil(HouseLayout.problem(state.layout, field: state.field))
        XCTAssertEqual(state.plot(of: "basement")?.floor, -1)
        // The old cells are still there, for a phone that hasn't been updated.
        XCTAssertEqual(state.cells["living"], [1, 0, 0])
        // Rooms where they come, when that works: the bedroom off the hall.
        XCTAssertEqual(state.plot(of: "bedroom"), HouseLayout.home["bedroom"])
        // One that's been muddled (two rooms in one place) is put right, keeping what it can.
        let muddle = #"{"rooms":["bedroom","living"],"plots":{"hall":[9,10,0,0],"bedroom":[4,10,0,0],"living":[4,10,0,0]}}"#
        let fixed = try JSONDecoder().decode(HouseState.self, from: Data(muddle.utf8))
        XCTAssertNil(HouseLayout.problem(fixed.layout, field: false))
        XCTAssertEqual(fixed.plot(of: "bedroom"), HousePlot(4, 20))
        // Every room there is, with none of them placed: they all find somewhere.
        var full = HouseState()
        full.rooms = HouseCatalog.rooms.map(\.id)
        full.plots = [:]
        full.settle()
        XCTAssertNil(HouseLayout.problem(full.layout, field: full.field))
        XCTAssertEqual(full.layout.count, HouseCatalog.rooms.count + 2)
    }

    func testTheDoorsAndWindowsAreWorkedOutFromWhereTheRoomsAre() throws {
        var state = HouseState()
        state.rooms = ["bedroom", "living", "bathroom", "garden", "den"]
        state.plots = [:]
        state.settle()
        let all = state.layout
        let plan = HouseLayout.plan(all) { HousePlan.Room(id: $0) }
        XCTAssertEqual(plan.numbers, [0, 1])
        let ground = try XCTUnwrap(plan.floor(0))
        // A way from the hall to the bedroom and the living room; from the living room to the bathroom and the garden.
        func joined(_ a: String, _ b: String, _ floor: Int) -> Bool {
            HouseLayout.doorways(all, floor: floor).contains { Set([$0.a, $0.b]) == [a, b] }
        }
        XCTAssertTrue(joined("hall", "bedroom", 0))
        XCTAssertTrue(joined("hall", "living", 0))
        XCTAssertTrue(joined("living", "bathroom", 0))
        XCTAssertTrue(joined("garden", "living", 0))
        XCTAssertTrue(joined("den", "landing", 1))
        // One front door; an arch between the hall and the living room, which are both open; doors elsewhere.
        XCTAssertEqual(ground.openings.values.filter { $0 == .door(front: true) }.count, 1)
        XCTAssertTrue(ground.openings.values.contains(.arch))
        XCTAssertTrue(ground.openings.values.contains(.door(front: false)))
        // Every opening's in a wall, and windows only in walls between indoors and out.
        for floor in plan.floors {
            let walls = Set(floor.walls)
            for (edge, opening) in floor.openings {
                XCTAssertTrue(walls.contains(edge), "an opening in no wall: \(edge)")
                guard case .window = opening else { continue }
                let (a, b) = floor.sides(edge)
                XCTAssertNotEqual(floor.indoor(a), floor.indoor(b), "a window between two rooms: \(edge)")
            }
        }
        // The garden's fenced where it meets the open, and walled where it meets the house.
        let garden = HouseLayout.shape("garden").letter, living = HouseLayout.shape("living").letter
        XCTAssertTrue(ground.outdoor.contains(garden))
        XCTAssertTrue(ground.walls.contains { ground.fence($0) })
        XCTAssertTrue(ground.walls.contains { edge in
            let (a, b) = ground.sides(edge)
            return Set([a, b]) == [garden, living] && !ground.fence(edge)
        })
        // The stairs come up through the landing; with no basement, the hall's floor is whole.
        let upstairs = try XCTUnwrap(plan.floor(1))
        let landing = try XCTUnwrap(all["landing"])
        for step in HouseLayout.shape("landing").stairs {
            let at = HouseLayout.cell("landing", landing, step)
            XCTAssertFalse(upstairs.floored(at.x, at.z))
            XCTAssertEqual(upstairs.room(at.x, at.z), HouseLayout.shape("landing").letter)
            XCTAssertTrue(ground.floored(at.x, at.z))
        }
    }

    func testARoomTurnedKeepsItsWallsStraight() {
        // A 4 by 4 bathroom wouldn't show it: the den's 6 across and 5 back.
        var den = HousePlot(4, 5)
        let wall = HouseWall(side: .north, at: 0)
        XCTAssertEqual(HouseLayout.edge("den", den, wall), HousePlan.Edge(x: 4, z: 5, across: true))
        // A quarter turn clockwise: 5 across and 6 back, and that metre is the top of its east wall.
        den.turn = 1
        XCTAssertEqual(HouseLayout.size("den", den).width, 5)
        XCTAssertEqual(HouseLayout.size("den", den).depth, 6)
        XCTAssertEqual(HouseLayout.edge("den", den, wall), HousePlan.Edge(x: 9, z: 5, across: false))
        // Half a turn: the far end of its south wall. Three quarters: the bottom of its west wall.
        den.turn = 2
        XCTAssertEqual(HouseLayout.edge("den", den, wall), HousePlan.Edge(x: 9, z: 10, across: true))
        den.turn = 3
        XCTAssertEqual(HouseLayout.edge("den", den, wall), HousePlan.Edge(x: 4, z: 10, across: false))
        XCTAssertEqual(HousePlot(4, 5, turn: 4), HousePlot(4, 5))
        XCTAssertEqual(HouseLayout.cells("den", den).count, 30)
        XCTAssertEqual(HousePlot([4, 5, 1, 3])?.kept, [4, 5, 1, 3])
        XCTAssertNil(HousePlot([4, 5]))
    }

    func testWallsWithARoomBehindThemComeDown() {
        // Two rooms side by side, the left one two squares deep.
        let floor = HousePlan.Floor(rows: ["AB", "A."])
        typealias Edge = HousePlan.Edge
        let walls = Set(floor.walls)
        XCTAssertEqual(walls.count, 9)
        XCTAssertFalse(walls.contains(Edge(x: 0, z: 1, across: true)), "a wall inside a room")
        let between = Edge(x: 1, z: 0, across: false)
        XCTAssertTrue(walls.contains(between))
        let fromSouthEast = HouseVantage(x: 1, z: 1), fromNorthWest = HouseVantage(x: -1, z: -1)
        // Between two rooms: down. The south and east walls are between the camera and the rooms; the north and west ones are behind them.
        XCTAssertTrue(floor.lowered(between, from: fromSouthEast))
        XCTAssertTrue(floor.lowered(Edge(x: 0, z: 2, across: true), from: fromSouthEast))
        XCTAssertTrue(floor.lowered(Edge(x: 2, z: 0, across: false), from: fromSouthEast))
        XCTAssertFalse(floor.lowered(Edge(x: 0, z: 0, across: true), from: fromSouthEast))
        XCTAssertFalse(floor.lowered(Edge(x: 0, z: 0, across: false), from: fromSouthEast))
        XCTAssertFalse(floor.lowered(Edge(x: 0, z: 2, across: true), from: fromNorthWest))
        XCTAssertTrue(floor.lowered(Edge(x: 0, z: 0, across: true), from: fromNorthWest))
        // The room being looked into keeps the walls at its back, whatever's behind them.
        XCTAssertFalse(floor.lowered(between, from: fromSouthEast, focus: "B"))
        XCTAssertTrue(floor.lowered(between, from: fromSouthEast, focus: "A"))
        XCTAssertFalse(floor.lowered(between, from: fromNorthWest, focus: "A"))
        // A house that's shut keeps every wall.
        for wall in walls { XCTAssertFalse(floor.lowered(wall, from: .shut)) }
        // A wall doesn't flicker as the camera passes its corner: it comes down a little after, and goes up a little after.
        XCTAssertEqual(HouseVantage.from(yaw: 0, was: nil), HouseVantage(x: 0, z: 1))
        let corner = HouseVantage.from(yaw: .pi / 4, was: nil)
        XCTAssertEqual(corner, fromSouthEast)
        XCTAssertEqual(HouseVantage.from(yaw: 0.3, was: corner).x, 1)
        XCTAssertEqual(HouseVantage.from(yaw: 0.3, was: nil).x, 0)
        XCTAssertEqual(HouseVantage.from(yaw: 0.1, was: corner).x, 0)
        // A lower-case square is its room with no floor.
        let landing = HousePlan.Floor(rows: ["Nn"])
        XCTAssertEqual(landing.room(1, 0), "N")
        XCTAssertFalse(landing.floored(1, 0))
        XCTAssertFalse(landing.walls.contains(Edge(x: 1, z: 0, across: false)))
    }

    // MARK: The button at the top of Vocab and Math

    func testTheButtonSaysTheTimeAndThePurse() {
        let part = VocabOverview.Goal(ms: 252_000, goalMs: 600_000, done: false)
        XCTAssertEqual(HouseStatusButton.spoken(day: part, coins: 120, gems: 1), "4:12 of 10 minutes of Vocab today. 120 coins, 1 gem")
        let done = VocabOverview.Goal(ms: 620_000, goalMs: 600_000, done: true)
        XCTAssertEqual(HouseStatusButton.spoken(day: done, coins: 1, gems: 0), "Today's 10 minutes of Vocab done, 10:20. 1 coin, 0 gems")
        // Not set up for Vocab: the purse alone.
        XCTAssertEqual(HouseStatusButton.spoken(day: nil, coins: 0, gems: 3), "0 coins, 3 gems")
    }

    // MARK: Moving about the town

    func testTheTownGoesWithTheFingersAndStopsAtItsEdge() {
        let stage = HouseStage()
        stage.setAspect(0.46)
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: HouseState(), look: .plain)])
        let first = stage.looking
        XCTAssertFalse(stage.moved)
        // A finger to the right carries the town right: the camera looks further left.
        stage.drag(by: CGPoint(x: 40, y: 0), height: 800)
        XCTAssertTrue(stage.moved)
        let after = stage.looking
        let right = SIMD3(cos(first.yaw), 0, -sin(first.yaw))
        XCTAssertLessThan(simd_dot(after.target - first.target, right), 0)
        XCTAssertEqual(after.distance, first.distance)
        // Pinched closer and further: never closer than a room, nor further than the whole town.
        stage.pinch(by: 1_000)
        XCTAssertEqual(stage.looking.distance, HouseStage.closest)
        stage.pinch(by: 0.000_1)
        XCTAssertGreaterThan(stage.looking.distance, first.distance)
        XCTAssertLessThan(stage.looking.distance, 1_200)
        // Dragged as far as it goes, it stops at the edge of the town.
        stage.drag(by: CGPoint(x: -1_000_000, y: 1_000_000), height: 800)
        XCTAssertEqual(HouseTown.kept(stage.looking.target), stage.looking.target)
        // Two fingers turn it, and the button goes round to the next corner.
        stage.fly(to: .street, animated: false)
        stage.twist(by: 0.3)
        XCTAssertEqual(stage.looking.yaw, HouseStage.corner + 0.3, accuracy: 0.001)
        stage.turn(1)
        XCTAssertEqual(stage.looking.yaw, HouseStage.corner + .pi / 2, accuracy: 0.001)
        stage.turn(-1)
        XCTAssertEqual(stage.looking.yaw, HouseStage.corner, accuracy: 0.001)
        // And home is how it was first shown.
        stage.fly(to: .street, animated: false)
        XCTAssertFalse(stage.moved)
        XCTAssertEqual(stage.looking.target, first.target)
    }

    func testHowCloseTheCameraIsSaysWhatsOpen() {
        var theirs = HouseState()
        theirs.rooms = ["bedroom", "living", "kitchen"]
        theirs.settle()
        let stage = HouseStage()
        stage.setAspect(0.46)
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: HouseState(), look: .plain),
                    HouseShown(kid: "them", name: "Them", mine: false, state: theirs, look: .plain)])
        // The whole street: both shut.
        XCTAssertEqual(stage.focus, .street)
        XCTAssertFalse(stage.moved)
        // Flown to a house, it's open, and stays open while it's nudged about.
        stage.fly(to: .house("them"), animated: false)
        stage.drag(by: CGPoint(x: 6, y: -4), height: 800)
        XCTAssertEqual(stage.focus, .house("them"))
        XCTAssertTrue(stage.moved)
        // Pinched in on it, the room in the middle is the one they're in; out again, the house; further, the street.
        stage.pinch(by: 2.6)
        guard case .room("them", _) = stage.focus else { return XCTFail("pinched in, no room's in focus: \(stage.focus)") }
        stage.pinch(by: 1 / 2.6)
        XCTAssertEqual(stage.focus, .house("them"))
        stage.pinch(by: 0.4)
        XCTAssertEqual(stage.focus, .street)
        // Dragged right off a house it was in a room of, that house shuts.
        stage.fly(to: .room("me", "bedroom"), animated: false)
        stage.drag(by: CGPoint(x: 3, y: 0), height: 800)
        XCTAssertEqual(stage.focus, .room("me", "bedroom"))
        stage.drag(by: CGPoint(x: 1_400, y: 0), height: 800)
        XCTAssertEqual(stage.focus, .street)
        // The hall's a room like any other to be in.
        stage.fly(to: .room("me", "hall"), animated: false)
        XCTAssertEqual(stage.focus, .room("me", "hall"))
        // A card up holds its room in focus, however the town's moved, until it's gone.
        stage.fly(to: .room("me", "bedroom"), animated: false)
        stage.lift("me", "bedroom", spot: "bed")
        stage.pinch(by: 0.2)
        XCTAssertEqual(stage.focus, .room("me", "bedroom"))
        stage.drop()
        XCTAssertEqual(stage.focus, .street)
        // Left alone, the card going puts the camera back where it was.
        stage.fly(to: .room("me", "bedroom"), animated: false)
        let before = stage.looking
        stage.lift("me", "bedroom", spot: "bed")
        XCTAssertNotEqual(stage.looking, before)
        stage.drop()
        XCTAssertEqual(stage.looking, before)
        XCTAssertEqual(stage.focus, .room("me", "bedroom"))
    }

    func testARoomInHandGoesWhereItCanAndSaysWhyItCant() throws {
        var state = HouseState()
        state.coins = 5_000
        let stage = HouseStage()
        stage.setAspect(0.46)
        stage.setDecorating(true)
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: state, look: .plain)])
        XCTAssertNil(stage.held)
        // A room to buy starts somewhere it can go.
        stage.hold("living")
        var held = try XCTUnwrap(stage.held)
        XCTAssertTrue(held.new)
        XCTAssertNil(held.trouble)
        XCTAssertEqual(stage.focus, .house("me"))
        // Held, nothing's worked out from where the camera is.
        stage.pinch(by: 0.1)
        XCTAssertEqual(stage.focus, .house("me"))
        // Turned a quarter about its middle, it's as wide as it was deep. (The living room's square: use the den.)
        stage.letGo()
        stage.hold("den")
        held = try XCTUnwrap(stage.held)
        let was = HouseLayout.size("den", held.plot)
        stage.turnHeld()
        held = try XCTUnwrap(stage.held)
        XCTAssertEqual(HouseLayout.size("den", held.plot).width, was.depth)
        // Upstairs with nothing under it, it can't go, and says so.
        stage.setFloor(1)
        held = try XCTUnwrap(stage.held)
        XCTAssertEqual(held.plot.floor, 1)
        XCTAssertNotNil(held.trouble)
        // One of theirs is picked up from where it is.
        stage.letGo()
        XCTAssertNil(stage.held)
        stage.hold("bedroom")
        held = try XCTUnwrap(stage.held)
        XCTAssertFalse(held.new)
        XCTAssertEqual(held.plot, state.plot(of: "bedroom"))
        XCTAssertNil(held.trouble)
        // Put down, what's in focus goes by where the camera is again: on their house, where picking it up took it.
        stage.letGo()
        XCTAssertEqual(stage.focus, .house("me"))
    }

    // MARK: The neighbourhood

    func testEachHouseHasItsOwnLot() {
        // Mom & Dad's, Sebastian's and Oscar's are where they are, whoever's phone it is.
        let family = HouseTown.lots(for: [("a", "Oscar"), ("b", "Sebastian"), (HouseTown.parentsID, "Mom & Dad")])
        XCTAssertEqual(family["a"], HouseTown.oscar)
        XCTAssertEqual(family["b"], HouseTown.sebastian)
        XCTAssertEqual(family[HouseTown.parentsID], HouseTown.parentsLot)
        // Anyone else gets the first that's free: the other kid's in the demo, an empty one beside both kids.
        let demo = HouseTown.lots(for: [("me", "You"), ("brother", "Oscar")])
        XCTAssertEqual(demo["me"], HouseTown.sebastian)
        XCTAssertEqual(demo["brother"], HouseTown.oscar)
        let parent = HouseTown.lots(for: [("dad", "Andrew"), ("a", "Oscar"), ("b", "Sebastian")])
        XCTAssertEqual(parent["dad"], HouseTown.spare[0])
        // No two on one lot, however many there are.
        let crowd = HouseTown.lots(for: (0..<5).map { ("k\($0)", "Kid \($0)") })
        XCTAssertEqual(Set(crowd.values.map { [$0.x, $0.z] }).count, 5)
    }

    func testNoLotIsOnAStreetOrAnother() {
        let lots = [HouseTown.parentsLot, HouseTown.sebastian, HouseTown.oscar] + HouseTown.spare
        let verge = HouseTown.roadWidth / 2 + HouseTown.walk
        /// How far north a lot's land goes: to the back of its field, where there's room for one.
        func top(_ lot: HouseTown.Lot) -> Float { lot.z + (lot.room ? 0 : lot.back) }
        for (i, lot) in lots.enumerated() {
            for other in lots[(i + 1)...] {
                let apart = lot.x + lot.wide <= other.x || other.x + other.wide <= lot.x || lot.z + lot.deep <= top(other) || other.z + other.deep <= top(lot)
                XCTAssertTrue(apart, "\(lot) is on \(other)")
            }
            // Inside the four streets, and off Avalon and its turning circle all the way along.
            XCTAssertGreaterThan(lot.x, HouseTown.west + verge)
            XCTAssertLessThan(lot.x + lot.wide, HouseTown.east - verge)
            XCTAssertGreaterThan(top(lot), HouseTown.north + verge)
            XCTAssertLessThan(lot.z + lot.deep, HouseTown.south - verge)
            var x = lot.x
            while x <= lot.x + lot.wide {
                if x >= 0 {
                    let road = HouseTown.avalon(x)
                    XCTAssertTrue(lot.z + lot.deep <= road - verge || top(lot) >= road + verge, "\(lot) is on Avalon at \(x)")
                }
                for z in [top(lot), lot.z + lot.deep] { XCTAssertGreaterThan(hypot(x, z), HouseTown.bulb + HouseTown.walk) }
                x += 1
            }
            // No tree is let onto it, nor in front of it.
            XCTAssertFalse(HouseTown.clear(lot.x + lot.wide / 2, lot.z + lot.deep / 2))
            XCTAssertFalse(HouseTown.clear(lot.x + lot.wide / 2, lot.z + lot.deep + 3))
        }
        // Nor onto a road.
        XCTAssertFalse(HouseTown.clear(40, HouseTown.avalon(40)))
        XCTAssertFalse(HouseTown.clear(HouseTown.west, 0))
        XCTAssertFalse(HouseTown.clear(0, 0))
        XCTAssertTrue(HouseTown.clear(HouseTown.west - 15, HouseTown.north - 15))
    }

    func testMomAndDadsHouseIsNiceAndModest() {
        let state = HouseTown.parents.state
        // Four rooms on one floor, where they come; no field, nothing in the yard, none of the rooms that come later.
        XCTAssertEqual(Set(state.rooms), ["bedroom", "living", "kitchen", "bathroom"])
        XCTAssertFalse(state.field)
        XCTAssertEqual(state.floors, [0])
        XCTAssertTrue(state.rooms.allSatisfy { !HouseLayout.yard($0) && HouseCatalog.room($0)?.gems == 0 })
        XCTAssertNil(HouseLayout.problem(state.layout, field: state.field))
        for room in state.rooms { XCTAssertEqual(state.plot(of: room), HouseLayout.home[room], room) }
        // Furnished: something in every spot but the pet's. And plainly: the cheapest there is for each,
        // nothing for gems, nothing built in code to be shown off, but for the big bed.
        for id in state.rooms { for spot in HouseCatalog.room(id)?.spots ?? [] {
            if case .pet = spot.place { XCTAssertNil(state.item(in: spot, of: id), "\(id) has a pet"); continue }
            let item = state.item(in: spot, of: id)
            XCTAssertNotNil(item, "nothing in \(id).\(spot.id)")
            guard let item, !item.free, item.id != "bedroom.bed.double" else { continue }
            XCTAssertEqual(item.gems, 0, item.id)
            XCTAssertEqual(item.coins, spot.items.filter { $0.gems == 0 && $0.coins > 0 }.map(\.coins).min(), item.id)
        } }
        // Outside, what it came with, and three cheap things.
        let bought = state.owned.filter { $0.hasPrefix("outside.") }.compactMap { HouseCatalog.item($0) }
        XCTAssertEqual(bought.count, 3)
        XCTAssertTrue(bought.allSatisfy { $0.gems == 0 && $0.coins <= 120 })
    }

    func testMomAndDadsIsAlwaysThereAndTheMapButtonShowsEverything() {
        let stage = HouseStage()
        stage.setAspect(0.46)
        // (Their own has a basement; Mom & Dad's hasn't.)
        var mine = HouseState()
        mine.rooms = ["bedroom", "basement"]
        mine.settle()
        stage.show([HouseShown(kid: "me", name: "Sebastian", mine: true, state: mine, look: .plain)])
        XCTAssertNotNil(stage.state(of: HouseTown.parentsID))
        XCTAssertFalse(stage.wide)
        // Flown to, it opens like any other.
        stage.fly(to: .house(HouseTown.parentsID), animated: false)
        XCTAssertEqual(stage.focus, .house(HouseTown.parentsID))
        // A floor picked with the whole house in view leaves it open, on that floor.
        stage.setFloor(-1)
        XCTAssertEqual(stage.focus, .house(HouseTown.parentsID))
        XCTAssertEqual(stage.floor, -1)
        stage.setFloor(nil)
        XCTAssertNil(stage.floor)
        // In its basement the town's put away, and it's back out on the street.
        let land = stage.scene.rootNode.childNode(withName: "land", recursively: false)
        XCTAssertEqual(land?.isHidden, false)
        stage.fly(to: .room("me", "basement"), animated: false)
        XCTAssertEqual(land?.isHidden, true)
        // Pulled back to the whole neighbourhood: everything shut, until it's moved.
        stage.flyToTown(animated: false)
        XCTAssertTrue(stage.wide)
        XCTAssertEqual(stage.focus, .street)
        XCTAssertEqual(land?.isHidden, false)
        stage.drag(by: CGPoint(x: 20, y: 0), height: 800)
        XCTAssertFalse(stage.wide)
        // And home is how it was first shown.
        stage.fly(to: .street, animated: false)
        XCTAssertFalse(stage.moved)
        XCTAssertFalse(stage.wide)
    }

    // MARK: Stairs

    func testTheStairsAreInTheHall() throws {
        let stage = HouseStage()
        stage.setAspect(0.46)
        var state = HouseState()
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: state, look: .plain)])
        func has(_ name: String) -> Bool { stage.scene.rootNode.childNode(withName: name, recursively: true) != nil }
        // One floor: a hall, and no landing.
        XCTAssertTrue(has("room:me:hall"))
        XCTAssertFalse(has("room:me:landing"))
        // A room upstairs: the landing's over the hall, wherever the hall's put.
        state.rooms = ["bedroom", "living", "den"]
        state.settle()
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: state, look: .plain)])
        XCTAssertTrue(has("room:me:landing"))
        var moved = state
        let hall = try XCTUnwrap(state.plot(of: "hall"))
        // (The hall can only go where everything still has a door: if a metre south works, the landing goes too.)
        let south = HousePlot(hall.x, hall.z + 1)
        if moved.move("hall", to: south) {
            XCTAssertEqual(moved.plot(of: "landing"), HousePlot(south.x, south.z, floor: 1))
        }
        // The landing isn't theirs to move on its own.
        XCTAssertFalse(state.move("landing", to: HousePlot(0, 0, floor: 1)))
    }

    // MARK: Wood and cloth

    func testARoomsWoodAndClothAreChoicesOfItsOwn() throws {
        let bedroom = try XCTUnwrap(HouseCatalog.room("bedroom"))
        let wood = try XCTUnwrap(bedroom.spot("wood")), fabric = try XCTUnwrap(bedroom.spot("fabric"))
        // As the kit makes them until something else is chosen, and free to go back to.
        XCTAssertNotNil(wood.starter)
        XCTAssertNotNil(fabric.starter)
        var state = HouseState()
        XCTAssertTrue(state.untouched(wood, of: "bedroom"))
        let furnished = state.filled
        state.coins = 100
        let walnut = try XCTUnwrap(wood.items.first { $0.id == "bedroom.wood.walnut" })
        XCTAssertTrue(state.place(walnut, in: wood, of: "bedroom"))
        XCTAssertEqual(state.coins, 100 - walnut.coins)
        XCTAssertEqual(state.item(in: wood, of: "bedroom"), walnut)
        XCTAssertFalse(state.untouched(wood, of: "bedroom"))
        // They're not places in the room: the house is no more furnished for them.
        XCTAssertEqual(state.filled.1, furnished.1)
        // The same choices in every room that has them, each room's its own to buy.
        let living = try XCTUnwrap(HouseCatalog.room("living")?.spot("wood"))
        XCTAssertEqual(living.items.map(\.name), wood.items.map(\.name))
        XCTAssertFalse(state.owns(try XCTUnwrap(living.items.first { $0.id == "living.wood.walnut" })))
    }

    func testChosenWoodIsOnEveryWoodenPartAndNoOtherCopy() {
        func made(_ node: SCNNode) -> Set<String> {
            var out = Set<String>()
            node.enumerateHierarchy { n, _ in if let name = n.geometry?.firstMaterial?.name { out.insert(name) } }
            return out
        }
        let bed = HouseProps.kit("bedSingle")
        XCTAssertTrue(made(bed).isSuperset(of: ["wood", "carpet"]))
        HouseProps.finish(bed, wood: (MathMat.color("8a5a3c"), MathMat.color("6b432b")), fabric: MathMat.color("2f4f8f"), lit: false, category: 2)
        XCTAssertTrue(made(bed).isDisjoint(with: ["wood", "woodDark", "carpet"]))
        // The sheets are still sheets, and the next bed made is as the kit has it.
        XCTAssertTrue(made(bed).contains("carpetWhite"))
        XCTAssertTrue(made(HouseProps.kit("bedSingle")).isSuperset(of: ["wood", "carpet"]))
    }

    // MARK: Outside

    func testTheOutsideOfTheHouseIsTheirsToChoose() throws {
        let outside = HouseCatalog.outside
        // Not a room: nothing to buy, nowhere to put it.
        XCTAssertNil(HouseCatalog.room(outside.id))
        XCTAssertFalse(HouseCatalog.rooms.contains(outside))
        XCTAssertEqual(Set(outside.spots.map(\.id)).count, outside.spots.count)
        for spot in outside.spots {
            XCTAssertNotNil(UIImage(systemName: spot.symbol), "outside.\(spot.id): no symbol called \(spot.symbol)")
            // The roof, its shape, the walls and the door are always something; the roof and the lawn start bare.
            XCTAssertEqual(spot.starter != nil, ["roof", "shape", "walls", "door", "fence", "windows", "doors"].contains(spot.id), spot.id)
            let coins = spot.items.filter { $0.coins > 0 }.map(\.coins)
            XCTAssertLessThanOrEqual(try XCTUnwrap(coins.min()), 300, spot.id)
            for item in spot.items {
                XCTAssertFalse(item.name.isEmpty || item.blurb.isEmpty, item.id)
                XCTAssertFalse(item.coins > 0 && item.gems > 0, item.id)
                XCTAssertEqual(HouseCatalog.item(item.id), item)
            }
        }
        // Theirs from the start, with no room to own first; bought once, and kept when the house is.
        var state = HouseState()
        state.coins = 200
        let roof = try XCTUnwrap(outside.spot("roof")), slate = try XCTUnwrap(roof.items.first { $0.id == "outside.roof.slate" })
        XCTAssertTrue(state.place(slate, in: roof, of: outside.id))
        XCTAssertEqual(state.coins, 200 - slate.coins)
        let back = try JSONDecoder().decode(HouseState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(back.item(in: roof, of: outside.id), slate)
        XCTAssertEqual(back.coins, state.coins)
    }

    func testDecoratingTheOutsideShutsTheHouse() {
        let stage = HouseStage()
        stage.setAspect(0.46)
        stage.setDecorating(true)
        var state = HouseState()
        state.rooms = ["bedroom", "living"]
        state.settle()
        state.placed["outside.top"] = "outside.top.chimney"
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: state, look: .plain)])
        stage.fly(to: .house("me"), animated: false)
        /// There to be seen: in their house (Mom & Dad's has a bed too), with nothing over it hidden.
        func has(_ name: String) -> Bool {
            var node = stage.scene.rootNode.childNode(withName: "house:me", recursively: false)?.childNode(withName: name, recursively: true)
            guard node != nil else { return false }
            while let n = node {
                if n.isHidden { return false }
                node = n.parent
            }
            return true
        }
        // Open: the bed's there to see, and what's on the roof has gone with the roof.
        XCTAssertTrue(has("thing:bedroom.bed"))
        XCTAssertFalse(has("thing:outside.top"))
        // The card up for the outside: shut, close as the camera is, and held there.
        stage.lift("me", HouseCatalog.outside.id, spot: "roof")
        XCTAssertEqual(stage.shut, "me")
        XCTAssertEqual(stage.focus, .house("me"))
        XCTAssertFalse(has("thing:bedroom.bed"))
        XCTAssertTrue(has("thing:outside.top"))
        stage.drop()
        XCTAssertNil(stage.shut)
        XCTAssertTrue(has("thing:bedroom.bed"))
    }

    func testAShutHouseHasItsRoofOnAndItsNameOverIt() {
        let stage = HouseStage()
        stage.setAspect(0.46)
        var state = HouseState()
        state.rooms = ["bedroom", "living", "den"]
        state.settle()
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: state, look: .plain)])
        let house = stage.scene.rootNode.childNode(withName: "house:me", recursively: false)
        let label = house?.childNode(withName: "label", recursively: true)
        XCTAssertNotNil(label)
        // On the street it's shut: the name's showing. Flown to, it opens, and the roof and the name go.
        XCTAssertEqual(label?.parent?.isHidden, false)
        stage.fly(to: .house("me"), animated: false)
        XCTAssertEqual(label?.parent?.isHidden, true)
        stage.fly(to: .street, animated: false)
        XCTAssertEqual(stage.scene.rootNode.childNode(withName: "house:me", recursively: false)?.childNode(withName: "label", recursively: true)?.parent?.isHidden, false)
    }

    // MARK: The time of day

    func testTheStreetKeepsTheTimeOfDay() {
        let winter = 330, summer = 172
        // Dark earlier in winter.
        XCTAssertLessThan(HouseSky.sun(dayOfYear: winter).set, HouseSky.sun(dayOfYear: summer).set)
        XCTAssertGreaterThan(HouseSky.sun(dayOfYear: winter).rise, HouseSky.sun(dayOfYear: summer).rise)
        let noon = HouseSky.at(hour: 12, dayOfYear: winter)
        XCTAssertEqual(noon, .noon)
        XCTAssertFalse(noon.lit)
        XCTAssertEqual(noon.outlook, .day)
        for hour in [22.0, 3.0] {
            let night = HouseSky.at(hour: hour, dayOfYear: winter)
            XCTAssertEqual(night.day, 0)
            XCTAssertTrue(night.lit)
            XCTAssertEqual(night.outlook, .night)
        }
        // Half past five: lamps on in November, broad daylight in June.
        XCTAssertTrue(HouseSky.at(hour: 17.5, dayOfYear: winter).lit)
        XCTAssertFalse(HouseSky.at(hour: 17.5, dayOfYear: summer).lit)
        // The sun's lowest, and the light most orange, as it sets.
        let set = HouseSky.sun(dayOfYear: winter).set
        XCTAssertEqual(HouseSky.at(hour: set, dayOfYear: winter).low, 1, accuracy: 0.01)
        XCTAssertEqual(HouseSky.at(hour: set, dayOfYear: winter).outlook, .dusk)
    }

    func testAtNightTheLampsOfTheOpenHouseAreOn() {
        let stage = HouseStage()
        stage.setAspect(0.46)
        var state = HouseState()
        state.placed["bedroom.bedside"] = "bedroom.bedside.lamp"
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: state, look: .plain)])
        stage.fly(to: .room("me", "bedroom"), animated: false)
        func lamps() -> [SCNLight] {
            var out: [SCNLight] = []
            stage.scene.rootNode.childNode(withName: "room:me:bedroom", recursively: true)?.enumerateHierarchy { n, _ in if let light = n.light { out.append(light) } }
            return out
        }
        XCTAssertTrue(lamps().isEmpty)
        stage.setSky(.at(hour: 22, dayOfYear: 330))
        XCTAssertEqual(lamps().count, 1)
        stage.setSky(.noon)
        XCTAssertTrue(lamps().isEmpty)
    }

    // MARK: The markers on spots

    func testASpotsMarkerIsOnlyThereWithTheCardUp() {
        let stage = HouseStage()
        stage.setAspect(0.46)
        stage.setDecorating(true)
        stage.show([HouseShown(kid: "me", name: "Me", mine: true, state: HouseState(), look: .plain)])
        stage.fly(to: .room("me", "bedroom"), animated: false)
        func marker(_ spot: String) -> Bool { stage.scene.rootNode.childNode(withName: "spot:me:bedroom:\(spot)", recursively: true) != nil }
        // In the room, it's just the room.
        XCTAssertFalse(marker("bed"))
        // The card up for one spot: every spot of the room has its marker.
        stage.lift("me", "bedroom", spot: "bed")
        XCTAssertTrue(marker("bed"))
        XCTAssertTrue(marker("rug"))
        stage.drop()
        XCTAssertFalse(marker("bed"))
    }

    func testTheSpotsTheCardHasTabsFor() {
        guard let kitchen = HouseCatalog.room("kitchen"), let table = kitchen.spot("table"), let food = kitchen.spot("food"),
              let rug = HouseCatalog.room("bedroom")?.spot("rug"), let bed = HouseCatalog.room("bedroom")?.spot("bed") else { return XCTFail("no such spots") }
        var state = HouseState()
        // What goes on the table can't be chosen until there's a table.
        state.placed["kitchen.table"] = ""
        XCTAssertFalse(state.spots(of: kitchen).contains(food))
        state.placed["kitchen.table"] = table.items[0].id
        XCTAssertTrue(state.spots(of: kitchen).contains(food))
        // A spot's untouched with nothing in it, or only what it came with.
        XCTAssertTrue(state.untouched(rug, of: "bedroom"))
        XCTAssertEqual(state.untouched(bed, of: "bedroom"), bed.starter != nil)
        state.placed["bedroom.rug"] = rug.items.first { !$0.free }?.id
        XCTAssertFalse(state.untouched(rug, of: "bedroom"))
    }

    func testEverySpotsMarkerHasAPicture() {
        for room in HouseCatalog.rooms {
            for spot in room.spots {
                XCTAssertNotNil(UIImage(systemName: spot.symbol), "\(room.id).\(spot.id): no symbol called \(spot.symbol)")
            }
        }
        // What goes there, where it's one sort of thing; a plus for a corner that takes all sorts.
        XCTAssertEqual(HouseCatalog.room("bedroom")?.spot("bed")?.symbol, "bed.double.fill")
        XCTAssertEqual(HouseCatalog.room("den")?.spot("corner")?.symbol, "plus")
        XCTAssertEqual(HouseCatalog.room("den")?.spot("walls")?.symbol, "paintbrush.fill")
    }
}
