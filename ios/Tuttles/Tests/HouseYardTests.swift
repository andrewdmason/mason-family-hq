import SceneKit
import XCTest
@testable import Tuttles

/// The dream home (Tuttles/iPhone/House): the back field and the yard, the
/// newer rooms and everything in them, what the season puts out, the shelf
/// that's won and not bought, and the family who are about in the open house.
@MainActor
final class HouseYardTests: XCTestCase {
    // MARK: Land and the yard

    func testTheBackFieldIsBoughtOnceAndIsWhereYardThingsCanGo() throws {
        var state = HouseState()
        XCTAssertFalse(state.field)
        // Not enough for it; then enough, and it's paid for once.
        state.coins = HouseCatalog.fieldPrice - 1
        XCTAssertFalse(state.buyField())
        state.coins = HouseCatalog.fieldPrice + 500
        XCTAssertTrue(state.buyField())
        XCTAssertTrue(state.field)
        XCTAssertEqual(state.coins, 500)
        XCTAssertTrue(state.buyField())
        XCTAssertEqual(state.coins, 500)
        // It survives being saved and read back, with the house where it was.
        let back = try JSONDecoder().decode(HouseState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(back, state)
        XCTAssertTrue(back.field)
    }

    func testYardThingsStandOnTheGrassWithNoDoor() throws {
        var state = HouseState()
        state.coins = 20_000
        let pool = try XCTUnwrap(HouseCatalog.room("pool"))
        XCTAssertTrue(HouseLayout.yard("pool"))
        XCTAssertFalse(HouseLayout.yard("bedroom"))
        // In the field before it's theirs: off their land. On the lot, away from the house: fine, though no room could go there.
        let behind = HousePlot(2, 2)
        XCTAssertEqual(state.problem(putting: "pool", at: behind), .offTheLot("pool"))
        let onTheLot = HousePlot(0, 11)
        XCTAssertNil(state.problem(putting: "pool", at: onTheLot))
        XCTAssertEqual(state.problem(putting: "living", at: HousePlot(0, 11)), .noWayIn("living"))
        // Never upstairs, and never on top of the house.
        XCTAssertEqual(state.problem(putting: "pool", at: HousePlot(0, 11, floor: 1)), .wrongFloor("pool"))
        XCTAssertNotNil(state.problem(putting: "pool", at: state.plot(of: "bedroom")!))
        // It has its own price, which doesn't make the next room dearer.
        XCTAssertEqual(state.price(of: pool).coins, 4000)
        let roomsBefore = state.coinRooms
        XCTAssertTrue(state.unlock(pool, at: onTheLot))
        XCTAssertEqual(state.coins, 16_000)
        XCTAssertEqual(state.coinRooms, roomsBefore)
        XCTAssertEqual(state.price(of: try XCTUnwrap(HouseCatalog.room("living"))).coins, 800)
        XCTAssertNil(HouseLayout.problem(state.layout, field: state.field))
        // With the field, it can go back there; and a room can't stand on it.
        XCTAssertTrue(state.buyField())
        XCTAssertTrue(state.move("pool", to: behind))
        XCTAssertEqual(state.plot(of: "pool"), behind)
        // It's not on the plan (no walls), but it's found under a tap.
        let plan = HouseLayout.plan(state.layout) { HousePlan.Room(id: $0) }
        XCTAssertNil(plan.floor(0)?.room(3, 3))
        XCTAssertEqual(HouseLayout.room(at: HouseCell(x: 3, z: 3), floor: 0, in: state.layout), "pool")
        // Every yard thing can be put somewhere on a new house's land once the field's theirs.
        var roomy = HouseState()
        roomy.land = 1
        for thing in HouseCatalog.yard { XCTAssertNotNil(roomy.place(for: thing.id), thing.id) }
    }

    func testFindingSomewhereForAThingIsQuickEvenInAFullHouse() {
        // Mom & Dad's, which has most things: asking where each thing they haven't got could go (as Build's
        // list does for every row, every time it's drawn) takes no time worth noticing, fit or no fit.
        let state = HouseTown.parents.state
        let missing = (HouseCatalog.rooms + HouseCatalog.yard).filter { !state.has(room: $0.id) }
        XCTAssertGreaterThan(missing.count, 5)
        let start = Date()
        var found = 0
        for thing in missing where state.place(for: thing.id) != nil { found += 1 }
        XCTAssertLessThan(Date().timeIntervalSince(start), 1.5, "\(missing.count) things, \(found) with somewhere to go")
        // What it finds really is somewhere the thing can go.
        for thing in missing { if let p = state.place(for: thing.id) { XCTAssertNil(state.problem(putting: thing.id, at: p), thing.id) } }
    }

    func testAHouseFromBeforeTheFieldIsMovedSouthAsItIsRead() throws {
        // As houses were kept before: measured from the lot's own corner, with no `grid`.
        let old = #"{"rooms":["bedroom","living"],"economy":2,"plots":{"hall":[9,10,0,0],"bedroom":[4,10,0,0],"living":[6,4,0,0]}}"#
        let state = try JSONDecoder().decode(HouseState.self, from: Data(old.utf8))
        XCTAssertEqual(state.plot(of: "hall"), HousePlot(9, 20))
        XCTAssertEqual(state.plot(of: "bedroom"), HousePlot(4, 20))
        XCTAssertEqual(state.plot(of: "living"), HousePlot(6, 14))
        XCTAssertEqual(state.grid, HouseState.grid)
        XCTAssertNil(HouseLayout.problem(state.layout, field: false))
        // Read again once it's been kept the new way, nothing moves.
        let again = try JSONDecoder().decode(HouseState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(again.plots, state.plots)
    }

    // MARK: The catalogue

    func testEverythingInTheCatalogueCanBeMade() {
        let sky = HouseSky.noon
        var ids = Set<String>()
        for room in HouseCatalog.everything + [HouseCatalog.outside] {
            XCTAssertNotNil(HouseLayout.shapes[room.id] ?? (room.id == "outside" ? HouseLayout.shape("hall") : nil), "no shape for \(room.id)")
            for spot in room.spots {
                XCTAssertFalse(spot.items.isEmpty, "\(room.id).\(spot.id) has nothing to choose")
                XCTAssertLessThanOrEqual(spot.items.filter(\.free).count, 1, "\(room.id).\(spot.id) has two free things")
                for item in spot.items {
                    XCTAssertTrue(ids.insert(item.id).inserted, "two things called \(item.id)")
                    XCTAssertFalse(item.name.isEmpty || item.blurb.isEmpty, item.id)
                    switch item.look {
                    case .made(let key) where !key.hasPrefix("slab:") && key != "earned-shelf":
                        let known = HouseYardProps.keys.contains(key) || HouseFunProps.keys.contains(key) || HouseStreetProps.keys.contains(key)
                        // (The first ones, in HouseProps, have no list: they were there before.)
                        if !known { XCTAssertTrue(Self.first.contains(key), "nothing builds \(key) (\(item.id))") }
                    case .model(let folder, let name, let scale):
                        XCTAssertNotNil(MathModels.file("\(folder)/\(name)")?.json["meshes"], "no model \(folder)/\(name) (\(item.id))")
                        XCTAssertGreaterThan(scale, 0)
                    case .kit(let name, _):
                        let size = HouseKit.size(name)
                        XCTAssertFalse(size == SIMD3<Float>(0.8, 0.8, 0.8), "no kit piece \(name) (\(item.id))")
                    case .stack(let a, let b):
                        for name in [a, b] { XCTAssertFalse(HouseKit.size(name) == SIMD3<Float>(0.8, 0.8, 0.8), "no kit piece \(name) (\(item.id))") }
                    default: break
                    }
                    // Whatever it is, making it doesn't fall over; and a thing is something to see.
                    if let thing = HouseThings.make(item, HouseFinish(), sky: sky) {
                        XCTAssertNotNil(HouseProps.extent(of: thing), "\(item.id) is made of nothing")
                    }
                }
            }
        }
        // A yard thing comes with itself: its first spot is it, with something free in it.
        for thing in HouseCatalog.yard {
            XCTAssertNotNil(thing.spots.first?.starter, thing.id)
            XCTAssertGreaterThan(thing.coins, 0)
        }
        // The big things are a couple of weeks at 300 coins a good day, not a couple of days.
        for id in ["pool", "diamond"] { XCTAssertGreaterThanOrEqual(HouseCatalog.room(id)?.coins ?? 0, 3000) }
        XCTAssertGreaterThanOrEqual(HouseCatalog.fieldPrice, 3000)
    }

    /// What HouseProps.made builds, from before the yard.
    private static let first: Set<String> = ["mirror", "mirror-late", "duck", "arcade", "trophies", "globe", "flowers", "pond", "campfire", "gnome", "door",
                                             "boxes", "bulb", "telescope", "telescope-big", "flag", "vane", "chimney", "dish", "beacon",
                                             "mailbox", "snowman", "flamingos", "saucer"]

    func testWallpaperAndTheNewFloorsAreDrawn() {
        for pattern in ["stripes", "dots", "stars", "clouds", "leaves", "diamonds", "panels", "bricks", "rockets"] {
            XCTAssertNotNil(HouseLook.paper(pattern, "f3ead2", "5b86c4").diffuse.contents, pattern)
        }
        for pattern in HousePatterns.floors.sorted() + ["marble"] {
            XCTAssertNotNil(HouseLook.floor(pattern, "e9e4d8", "9aa0a8").diffuse.contents, pattern)
        }
        // Every room indoors has paper to choose; the garden, which has a fence, hasn't.
        let papered = { (id: String) in HouseCatalog.room(id)?.spot("walls")?.items.contains { if case .paper = $0.look { return true }; return false } ?? false }
        XCTAssertTrue(papered("bedroom"))
        XCTAssertTrue(papered("gameroom"))
        XCTAssertFalse(papered("garden"))
    }

    func testRoomsHaveWindowsBehindThemWhereNothingStands() throws {
        // The bedroom's north wall has the bed, the bedside and the shelf along it: no window fits. Its west wall has room for none either.
        for room in HouseCatalog.rooms where !HouseLayout.shape(room.id).outdoor {
            let shape = HouseLayout.shape(room.id)
            for wall in HouseLayout.windows(behind: room.id) {
                XCTAssertTrue(wall.side == .north || wall.side == .west)
                // Never the last metre, which is kept for a door; and never where something's against the wall.
                XCTAssertLessThan(wall.at, (wall.side == .north ? shape.width : shape.depth) - 1)
                for spot in room.spots {
                    var hit: (left: Bool, along: Float)?
                    if case .against(let left, let along) = spot.place { hit = (left, along) }
                    if case .wall(let left, let along, _) = spot.place { hit = (left, along) }
                    guard let hit, hit.left == (wall.side == .west) else { continue }
                    XCTAssertNotEqual(Int(hit.along * (hit.left ? shape.stretch.z : shape.stretch.x)), wall.at, "\(room.id).\(spot.id) is in front of a window")
                }
            }
        }
    }

    // MARK: The time of year, and the shelf

    func testTheSeasonGoesByTheDate() {
        XCTAssertEqual(HouseSeason.on(month: 12, day: 1), .winter)
        XCTAssertEqual(HouseSeason.on(month: 1, day: 6), .winter)
        XCTAssertEqual(HouseSeason.on(month: 1, day: 7), .plain)
        XCTAssertEqual(HouseSeason.on(month: 10, day: 14), .plain)
        XCTAssertEqual(HouseSeason.on(month: 10, day: 31), .halloween)
        XCTAssertEqual(HouseSeason.on(month: 11, day: 26), .plain)
    }

    func testTheShelfFillsWithWhatsBeenDone() throws {
        XCTAssertEqual(HouseEarned.books(words: 0), 0)
        XCTAssertEqual(HouseEarned.books(words: 14), 0)
        XCTAssertEqual(HouseEarned.books(words: 15), 1)
        XCTAssertEqual(HouseEarned.books(words: 10_000), HouseEarned.mostBooks)
        XCTAssertEqual(HouseEarned.cups(days: 4), 0)
        XCTAssertEqual(HouseEarned.cups(days: 11), 2)
        XCTAssertEqual(HouseEarned.cups(days: 500), HouseEarned.mostCups)
        // More on it, more of it.
        func parts(_ feats: [String: Int]) -> Int {
            var n = 0
            HouseEarned.shelf(feats).enumerateHierarchy { node, _ in if node.geometry != nil { n += 1 } }
            return n
        }
        XCTAssertGreaterThan(parts(["words": 150, "mathDays": 20, "streak": 9]), parts([:]))
        // It's in the bedroom from the start, costs nothing, and what's on it is kept with the house.
        let spot = try XCTUnwrap(HouseCatalog.room("bedroom")?.spot("earned"))
        XCTAssertNotNil(spot.starter)
        var state = HouseState()
        state.feats = ["words": 45, "mathDays": 10, "streak": 3]
        state.names = ["bedroom.pet": "Biscuit"]
        let back = try JSONDecoder().decode(HouseState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(back.feats, state.feats)
        XCTAssertEqual(back.names["bedroom.pet"], "Biscuit")
    }

    func testWallsThatComeDownStayInTheHouse() {
        // Dragging about swaps which walls stand, over and over. The ones not standing are hidden and
        // kept, so nothing is ever taken out of the scene by a fade that's still running.
        let built = HouseBuilt(HouseTown.parents, on: HouseTown.parentsLot, sky: .noon)
        let views = [HouseVantage(x: 1, z: 1), HouseVantage(x: -1, z: 1), .flat, HouseVantage(x: 1, z: -1), HouseVantage(x: 1, z: 1)]
        for (i, view) in (views + views + views).enumerated() {
            built.present(floor: 0, view: view, focus: i % 3 == 0 ? "living" : i % 3 == 1 ? "pool" : nil, animated: true)
            let walls = built.wallNodes(floor: 0)
            XCTAssertNotNil(walls.standing)
            XCTAssertEqual(walls.standing?.isHidden, false)
            for node in walls.all { XCTAssertTrue(node.parent === built.node, "a wall was taken out of the house") }
        }
        XCTAssertGreaterThan(built.wallNodes(floor: 0).all.count, 2)
        // Shut again, with no fade: only the shut walls show.
        built.present(floor: nil, view: .shut, focus: nil, animated: false)
        let shut = built.wallNodes(floor: 0)
        XCTAssertEqual(shut.all.filter { !$0.isHidden }.count, 1)
        XCTAssertEqual(shut.standing?.isHidden, false)
    }

    // MARK: Opening the street

    func testOnlyAHouseThatsChangedIsBuiltAgainAndTheirOwnComesFirst() {
        var mine = HouseState()
        mine.rooms = ["bedroom", "living"]
        mine.settle()
        let brother = HouseShown(kid: "b", name: "Oscar", mine: false, state: HouseState(), look: .oscar)
        func houses(_ state: HouseState) -> [HouseShown] { [HouseShown(kid: "me", name: "Sebastian", mine: true, state: state, look: .sebastian), brother] }
        let stage = HouseStage()
        func node(_ kid: String) -> SCNNode? { stage.scene.rootNode.childNode(withName: "house:\(kid)", recursively: false) }
        // Nothing's built until there's a street to show.
        XCTAssertNil(node(HouseTown.parentsID))
        stage.show(houses(mine))
        let first = (node("me"), node("b"), node(HouseTown.parentsID))
        XCTAssertNotNil(first.0); XCTAssertNotNil(first.1); XCTAssertNotNil(first.2)
        // Shown again as they were: the same houses, not new ones.
        stage.show(houses(mine))
        XCTAssertTrue(node("me") === first.0 && node("b") === first.1 && node(HouseTown.parentsID) === first.2)
        // One of them changed: that one's built again, and only that one.
        var more = mine
        more.rooms.append("kitchen")
        more.settle()
        stage.show(houses(more))
        XCTAssertFalse(node("me") === first.0)
        XCTAssertTrue(node("b") === first.1 && node(HouseTown.parentsID) === first.2)
        XCTAssertEqual(stage.state(of: "me")?.rooms, more.rooms)

        // As the screen asks for it: their own house at once, the others over the next moments.
        let staged = HouseStage()
        func later(_ kid: String) -> SCNNode? { staged.scene.rootNode.childNode(withName: "house:\(kid)", recursively: false) }
        staged.show(houses(mine), staged: true)
        XCTAssertNotNil(later("me"))
        XCTAssertNil(later("b"))
        XCTAssertNil(later(HouseTown.parentsID))
        // Their own is there to open straight away, with the family not far behind.
        staged.fly(to: .house("me"), animated: false)
        XCTAssertEqual(staged.focus, .house("me"))
        // A house that hasn't arrived is built there and then if it's flown to.
        staged.fly(to: .house("b"), animated: false)
        XCTAssertNotNil(later("b"))
        // And the rest arrive on their own.
        let arrived = expectation(description: "every house has arrived")
        func check(_ tries: Int) {
            if later(HouseTown.parentsID) != nil && !staged.life.whereabouts.isEmpty { arrived.fulfill() }
            else if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { check(tries - 1) } }
        }
        check(100)
        wait(for: [arrived], timeout: 10)
        XCTAssertEqual(staged.life.whereabouts.map(\.name), ["Sebastian", "Oscar", "Dad", "Mom", "Charlie", "Pippy"])
    }

    // MARK: The family

    func testTheFamilyGetAboutMomAndDads() throws {
        let sky = HouseSky.noon
        let built = HouseBuilt(HouseTown.parents, on: HouseTown.parentsLot, sky: sky)
        built.present(floor: 0, view: HouseVantage(x: 1, z: 1), focus: nil, animated: false)
        let life = HouseLife()
        life.gather([.person(.sebastian, name: "Sebastian", height: 1.25), .person(.oscar, name: "Oscar", height: 1.25),
                     .person(HouseTown.parents.look, name: "Dad", height: 1.5), .dog(name: "Charlie"), .cat(name: "Pippy")])
        life.move(into: built)
        XCTAssertEqual(life.whereabouts.map(\.name), ["Sebastian", "Oscar", "Dad", "Charlie", "Pippy"])
        // A few minutes of their day, a tenth of a second at a time.
        var places = Set<String>(), perched = Set<String>()
        for _ in 0..<4000 {
            life.step(0.1, showing: 0, facing: 0.7)
            for who in life.whereabouts {
                places.insert(who.place)
                if let on = who.perch, !who.moving { perched.insert(on) }
            }
        }
        // They've been to several rooms and out into the yard, and sat on or used several things.
        XCTAssertGreaterThanOrEqual(places.count, 6, "\(places)")
        XCTAssertFalse(places.intersection(HouseCatalog.yard.map(\.id)).isEmpty, "nobody went out into the yard: \(places)")
        XCTAssertGreaterThanOrEqual(perched.count, 5, "\(perched)")
        // Nobody's ended up nowhere, or off the land.
        built.node.enumerateChildNodes { node, _ in
            guard node.name?.hasPrefix("who:") == true else { return }
            let p = node.simdPosition
            XCTAssertFalse(p.x.isNaN || p.y.isNaN || p.z.isNaN)
            XCTAssertTrue((-3...23).contains(p.x) && (-3...34).contains(p.z), "\(node.name ?? "") is at \(p)")
        }
        // Tapping the sofa brings somebody to it.
        life.call(to: "living", spot: "sofa")
        XCTAssertTrue(life.whereabouts.contains { $0.perch == "living.sofa" } || built.things.first { $0.room == "living" && $0.spot == "sofa" } == nil)
        // Shut, nobody's about.
        life.move(into: nil)
        var left = 0
        built.node.enumerateChildNodes { node, _ in if node.name?.hasPrefix("who:") == true { left += 1 } }
        XCTAssertEqual(left, 0)
    }

    func testAStageOpensAHouseWithTheFamilyInItAndThingsCanBeTapped() {
        let stage = HouseStage()
        stage.setAspect(0.46)
        stage.setDecorating(true)
        var state = HouseState()
        state.rooms = ["bedroom", "living"]
        state.settle()
        stage.show([HouseShown(kid: "me", name: "Sebastian", mine: true, state: state, look: .sebastian)])
        XCTAssertTrue(stage.life.whereabouts.isEmpty || stage.life.whereabouts.allSatisfy { $0.place.isEmpty })
        stage.fly(to: .room("me", "bedroom"), animated: false)
        // Sebastian, Dad, Mom, Charlie and Pippy.
        XCTAssertEqual(stage.life.whereabouts.map(\.name), ["Sebastian", "Dad", "Mom", "Charlie", "Pippy"])
        XCTAssertTrue(stage.life.whereabouts.allSatisfy { !$0.place.isEmpty })
        // And they can be seen: each is under the house's node, not hidden, once a moment's passed.
        stage.life.step(0.1, showing: 0, facing: 0.7)
        var seen: [String] = []
        stage.scene.rootNode.enumerateHierarchy { node, _ in
            guard node.name?.hasPrefix("who:") == true else { return }
            var hidden = false, up: SCNNode? = node
            while let n = up { hidden = hidden || n.isHidden; up = n.parent }
            print("WHO", node.name ?? "", node.simdWorldPosition, hidden, node.parent?.name ?? "-")
            if !hidden { seen.append(node.name ?? "") }
        }
        XCTAssertEqual(seen.count, 5, "\(seen)")
        // Poking a thing doesn't change the house.
        stage.poke("me", "bedroom", "bed")
        XCTAssertEqual(stage.state(of: "me"), state)
    }
}
