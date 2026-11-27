import Foundation
import Observation
import MasonKit
import Supabase

// The purse and the house, for one kid, kept on the phone. Coins and gems are
// won in Vocab and Math (Shared/HousePay.swift) and spent here on rooms and
// what goes in them (HouseCatalog.swift). None of it waits on the network.
// When there is one, the whole of it goes up (/tuttles/api/house/sync,
// src/lib/tuttles/house.ts), so a new phone gets it back and so the other
// house on the street can be seen; the brothers' houses come back, and are
// kept, so the street is there with no connection too.

/// A house and its purse: what goes to the website.
struct HouseState: Codable, Equatable {
    /// Something paid in, for the parents to see where it came from.
    struct Paid: Codable, Equatable {
        let day: String
        /// "vocab", "math" or "start".
        let from: String
        var coins: Int
        var gems: Int
    }

    var coins = 0
    var gems = 0
    /// Everything ever paid in.
    var earned = 0
    var gemsEarned = 0
    /// The rooms that are theirs, in the order they got them.
    var rooms: [String] = [HouseCatalog.first]
    /// Everything bought.
    var owned: [String] = []
    /// What's in each spot ("bedroom.bed"), by the thing's id.
    var placed: [String: String] = [:]
    /// What's been paid for already ("chest:…", "boss:3", "mathgem:2026-11-26"), newest last.
    var paid: [String] = []
    /// What each day brought from each game, newest last.
    var days: [Paid] = []
    /// Which way of paying it was kept under. 1 was the first (big numbers,
    /// back pay); a house from before `HouseState.economy` starts again.
    var economy = HouseState.economy
    /// Where each of their rooms stands (HouseLayout.swift): [across, floor, back].
    var cells: [String: [Int]] = [HouseCatalog.first: [0, 0, 0]]

    /// The economy of 2026-11-26: coins about a tenth of what they were, no back pay.
    static let economy = 2

    init() {}

    // Anything missing is as it would be in a new house, so an older phone's copy still reads.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        coins = (try? c.decode(Int.self, forKey: .coins)) ?? 0
        gems = (try? c.decode(Int.self, forKey: .gems)) ?? 0
        earned = (try? c.decode(Int.self, forKey: .earned)) ?? 0
        gemsEarned = (try? c.decode(Int.self, forKey: .gemsEarned)) ?? 0
        rooms = (try? c.decode([String].self, forKey: .rooms)) ?? [HouseCatalog.first]
        owned = (try? c.decode([String].self, forKey: .owned)) ?? []
        placed = (try? c.decode([String: String].self, forKey: .placed)) ?? [:]
        paid = (try? c.decode([String].self, forKey: .paid)) ?? []
        days = (try? c.decode([Paid].self, forKey: .days)) ?? []
        economy = (try? c.decode(Int.self, forKey: .economy)) ?? 1
        // A house from before they chose where rooms go gets them put somewhere that holds together.
        cells = HouseLayout.settle(rooms, from: (try? c.decode([String: [Int]].self, forKey: .cells)) ?? [:])
    }

    // MARK: Reading it

    func has(room: String) -> Bool { rooms.contains(room) }

    /// Where a room of theirs stands.
    func cell(of room: String) -> [Int] { cells[room] ?? HouseCatalog.room(room)?.cell ?? [0, 0, 0] }

    /// Which of their rooms is in a cell.
    func room(at cell: [Int]) -> String? { rooms.first { self.cell(of: $0) == cell } }

    /// The floors their house has, lowest first.
    var floors: [Int] { Set(rooms.map { cell(of: $0)[1] }).sorted() }

    /// Where a room could go: one to buy, or one of theirs to move.
    func places(for room: String) -> [[Int]] { HouseLayout.places(for: room, in: cells) }

    func owns(_ item: HouseItem) -> Bool { item.free || owned.contains(item.id) }

    /// What's in a spot: what they put there, or what it came with.
    func item(in spot: HouseSpot, of room: String) -> HouseItem? {
        if let id = placed[HouseCatalog.key(room, spot.id)] {
            // "" is a spot they've emptied.
            return id.isEmpty ? nil : spot.items.first { $0.id == id } ?? spot.starter
        }
        return spot.starter
    }

    /// The spots of a room that can be chosen for now: not one for what stands on something, with nothing there to stand on.
    func spots(of room: HouseRoom) -> [HouseSpot] {
        room.spots.filter { spot in
            guard case .on(let base) = spot.place else { return true }
            return room.spot(base).map { item(in: $0, of: room.id) != nil } ?? false
        }
    }

    /// Whether a spot's as it came: nothing in it, or only what it started with.
    func untouched(_ spot: HouseSpot, of room: String) -> Bool {
        guard let item = item(in: spot, of: room) else { return true }
        return item == spot.starter
    }

    /// Spots with something in them, over all the spots of the rooms they have: how furnished it is.
    var filled: (Int, Int) {
        var have = 0, of = 0
        for room in HouseCatalog.rooms where has(room: room.id) {
            for spot in room.spots where spot.starter == nil {
                of += 1
                if item(in: spot, of: room.id) != nil { have += 1 }
            }
        }
        return (have, of)
    }

    /// Rooms bought with coins, the first included.
    var coinRooms: Int { rooms.filter { HouseCatalog.room($0)?.gems == 0 }.count }

    func price(of room: HouseRoom) -> (coins: Int, gems: Int) {
        room.gems > 0 ? (0, room.gems) : (HouseCatalog.roomPrice(owned: coinRooms), 0)
    }

    func canAfford(coins: Int, gems: Int) -> Bool { self.coins >= coins && self.gems >= gems }

    // MARK: Changing it

    /// Pay something in, once for each key. False if that key's been paid.
    @discardableResult
    mutating func pay(key: String, coins: Int, gems: Int, from: String, day: String) -> Bool {
        guard !paid.contains(key) else { return false }
        paid.append(key)
        if paid.count > 600 { paid.removeFirst(paid.count - 600) }
        add(coins: coins, gems: gems, from: from, day: day)
        return true
    }

    /// Pay something in that has no key: Math's answers and stars, as they're won.
    mutating func add(coins: Int, gems: Int, from: String, day: String) {
        guard coins > 0 || gems > 0 else { return }
        self.coins += coins
        self.gems += gems
        earned += coins
        gemsEarned += gems
        if let at = days.lastIndex(where: { $0.day == day && $0.from == from }) {
            days[at].coins += coins
            days[at].gems += gems
        } else {
            days.append(Paid(day: day, from: from, coins: coins, gems: gems))
            if days.count > 90 { days.removeFirst(days.count - 90) }
        }
    }

    /// Buy a room, if it's one to buy and there's enough, and put it here (or
    /// wherever it fits, with no cell). True if it's theirs now.
    @discardableResult
    mutating func unlock(_ room: HouseRoom, at cell: [Int]? = nil) -> Bool {
        if has(room: room.id) { return true }
        if let cell, !places(for: room.id).contains(cell) { return false }
        let price = price(of: room)
        guard canAfford(coins: price.coins, gems: price.gems) else { return false }
        coins -= price.coins
        gems -= price.gems
        rooms.append(room.id)
        if let cell { cells[room.id] = cell }
        settle()
        return true
    }

    /// Move a room of theirs to another cell, if the house still holds together. Free.
    @discardableResult
    mutating func move(_ room: String, to cell: [Int]) -> Bool {
        guard has(room: room), places(for: room).contains(cell) else { return false }
        cells[room] = cell
        return true
    }

    /// Every room somewhere, and the house in one piece.
    mutating func settle() { cells = HouseLayout.settle(rooms, from: cells) }

    /// Put a thing in its spot, buying it first if it isn't theirs. True if it's there now.
    /// (The outside of the house is always theirs to change.)
    @discardableResult
    mutating func place(_ item: HouseItem, in spot: HouseSpot, of room: String) -> Bool {
        guard has(room: room) || room == HouseCatalog.outside.id, spot.items.contains(item) else { return false }
        if !owns(item) {
            guard canAfford(coins: item.coins, gems: item.gems) else { return false }
            coins -= item.coins
            gems -= item.gems
            owned.append(item.id)
        }
        placed[HouseCatalog.key(room, spot.id)] = item.id
        return true
    }

    /// Take what's in a spot out. It's still theirs. (A spot's own free thing can't be: walls need a colour.)
    mutating func clear(_ spot: HouseSpot, of room: String) {
        guard spot.starter == nil else {
            placed[HouseCatalog.key(room, spot.id)] = nil
            return
        }
        placed[HouseCatalog.key(room, spot.id)] = ""
    }
}

/// One house on the street: whose, and how it stands.
struct HouseNeighbour: Codable, Equatable, Identifiable {
    let kid: String
    let name: String
    let me: Bool
    var state: HouseState?
    /// How they look, from Math (MathLook).
    var look: MathLook?
    var id: String { kid }
}

@MainActor
@Observable
final class HouseStore {
    static let shared = HouseStore()

    private struct Saved: Codable {
        var rev = 0
        var state = HouseState()
        var name: String?
        var street: [HouseNeighbour] = []
    }

    private var saved = Saved()
    private(set) var owner: UUID?
    @ObservationIgnored private var syncing = false
    /// The last thing paid in, for whatever's on screen to make something of.
    private(set) var lastPaid: (coins: Int, gems: Int, at: Date)?

    // MARK: Whose

    func open(for owner: UUID, name: String?) {
        if self.owner != owner {
            self.owner = owner
            saved = (try? Data(contentsOf: file(owner))).flatMap { try? JSONDecoder().decode(Saved.self, from: $0) } ?? Saved()
            lastPaid = nil
            startAgainIfOld()
        }
        if let name, !name.isEmpty { saved.name = name }
    }

    private func file(_ owner: UUID) -> URL {
        let root = URL.applicationSupportDirectory.appending(path: Bundle.main.bundleIdentifier ?? "io.mason.tuttles")
        return root.appending(path: "house").appending(path: owner.uuidString.lowercased() + ".json")
    }

    private func save(changed: Bool = true) {
        if changed { saved.rev += 1 }
        guard let owner, let data = try? JSONEncoder().encode(saved) else { return }
        let url = file(owner)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    // MARK: Read

    var state: HouseState { saved.state }
    var coins: Int { saved.state.coins }
    var gems: Int { saved.state.gems }
    var name: String { saved.name ?? "You" }
    /// The other houses on the street, as last heard.
    var others: [HouseNeighbour] { saved.street.filter { !$0.me } }
    /// Everyone's, theirs first, for the parents.
    var street: [HouseNeighbour] { saved.street }

    // MARK: Paying in

    /// Something with a key: paid once however often it's sent.
    func pay(key: String, coins: Int, gems: Int, from: String) {
        guard owner != nil, saved.state.pay(key: key, coins: coins, gems: gems, from: from, day: MathStore.day()) else { return }
        lastPaid = (coins, gems, Date())
        save()
    }

    /// Math's coins as they're won.
    func add(coins: Int, from: String = "math") {
        guard owner != nil, coins > 0 else { return }
        saved.state.add(coins: coins, gems: 0, from: from, day: MathStore.day())
        save()
    }

    /// A house kept under the first economy starts again, empty, under this
    /// one (Andrew, 2026-11-26: no back pay; the houses were a day old). The
    /// rev goes on up, so the website takes this over the old one.
    private func startAgainIfOld() {
        guard owner != nil, saved.state.economy < HouseState.economy else { return }
        saved.state = HouseState()
        save()
    }

    /// Take what Vocab has won, once today's ten minutes are done. Until then
    /// it waits in Vocab. A chest from a day that ended without them is lost;
    /// a boss waits for whichever day they're done next.
    func collect(from vocab: VocabLocal?) {
        guard owner != nil, let vocab else { return }
        let earnings = vocab.earnings
        guard !earnings.isEmpty else { return }
        let overview = vocab.home().overview
        let today = overview?.today ?? vocab.today()
        let lost = earnings.filter { !VocabPay.stillGood($0, today: today) }
        // Whoever isn't set up for Vocab has no ten minutes to wait for.
        let done = overview.map(\.isDoneToday) ?? true
        let paying = done ? earnings.filter { VocabPay.stillGood($0, today: today) } : []
        var coins = 0, gems = 0
        for e in paying where saved.state.pay(key: e.key, coins: e.coins, gems: e.gems, from: "vocab", day: MathStore.day()) {
            coins += e.coins
            gems += e.gems
        }
        if coins > 0 || gems > 0 {
            lastPaid = (coins, gems, Date())
            save()
        }
        let settled = Set((lost + paying).map(\.key))
        if !settled.isEmpty { vocab.settle(settled) }
    }

    // MARK: Spending

    @discardableResult
    func unlock(_ room: HouseRoom, at cell: [Int]? = nil) -> Bool {
        guard saved.state.unlock(room, at: cell) else { return false }
        save()
        return true
    }

    @discardableResult
    func move(_ room: String, to cell: [Int]) -> Bool {
        guard saved.state.move(room, to: cell) else { return false }
        save()
        return true
    }

    @discardableResult
    func place(_ item: HouseItem, in spot: HouseSpot, of room: String) -> Bool {
        guard saved.state.place(item, in: spot, of: room) else { return false }
        save()
        return true
    }

    func clear(_ spot: HouseSpot, of room: String) {
        saved.state.clear(spot, of: room)
        save()
    }

    // MARK: The website

    private struct Reply: Decodable {
        struct Kept: Decodable {
            let rev: Int
            let json: HouseState
        }
        let state: Kept?
        let street: [HouseNeighbour]

        enum Keys: String, CodingKey { case state, street }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            state = try? c.decode(Kept.self, forKey: .state)
            // A house this build can't read is left out rather than losing the street.
            struct Loose: Decodable {
                let value: HouseNeighbour?
                init(from decoder: Decoder) throws { value = try? HouseNeighbour(from: decoder) }
            }
            street = ((try? c.decode([Loose].self, forKey: .street)) ?? []).compactMap(\.value)
        }
    }

    /// Send the house up and take the street back. Quietly does nothing with
    /// no connection. In the parents' view nothing is sent: it's only looked at.
    func sync(with store: ChatStore) async {
        guard !store.isDemo, !syncing else { return }
        let parents = store.showingParentView
        guard parents || (owner != nil && owner == store.ownerID) else { return }
        syncing = true
        defer { syncing = false }
        struct Body: Encodable {
            struct Kept: Encodable {
                let rev: Int
                let json: HouseState
            }
            let state: Kept?
        }
        let owner = owner
        // A phone that's never had anything sends no house, so a reinstall takes the website's.
        let body = Body(state: parents || saved.rev == 0 ? nil : .init(rev: saved.rev, json: saved.state))
        guard let data = try? JSONEncoder().encode(body), let token = try? await store.client.auth.session.accessToken else { return }
        var request = URLRequest(url: ChatStore.websiteURL.appending(path: "tuttles/api/house/sync"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        store.authorize(&request, token: token, mine: store.playingAsSelf)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        guard let (reply, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let pack = try? JSONDecoder().decode(Reply.self, from: reply),
              self.owner == owner else { return }
        saved.street = pack.street
        if !parents, let theirs = pack.state, theirs.rev > saved.rev {
            // Another phone, or this one before it was wiped, got further.
            saved.state = theirs.json
            saved.rev = theirs.rev
        }
        save(changed: false)
        startAgainIfOld()
    }

    // MARK: For the simulator

    /// `--house-coins 50000 --house-gems 40`: a full purse, to try the shop.
    /// `--house-fill 0`: every room, with each spot's first thing in it (1: its second, and so on).
    func demo(coins: Int?, gems: Int?, fill: Int? = nil, street: [HouseNeighbour]) {
        if let coins { saved.state.coins = coins }
        if let gems { saved.state.gems = gems }
        if let fill {
            saved.state.rooms = HouseCatalog.rooms.map(\.id)
            for room in HouseCatalog.rooms + [HouseCatalog.outside] { for spot in room.spots {
                let item = spot.items[min(fill, spot.items.count - 1)]
                saved.state.owned.append(item.id)
                saved.state.placed[HouseCatalog.key(room.id, spot.id)] = item.id
            } }
            saved.state.settle()
        }
        saved.street = street
    }
}

extension ChatStore {
    /// Opens Math's things and the purse for whoever the phone is being used
    /// as, and puts in the purse whatever's been won since it last looked.
    /// Cheap to call often: it's how Vocab's coins get there.
    func openHouse() {
        guard !showingParentView else { return }
        let owner = ownerID ?? UUID(uuidString: "00000000-0000-0000-0000-00000000d0e0")!
        let demoName = CommandLine.arguments.contains("--math-oscar") ? "Oscar" : "Sebastian"
        let name = isDemo ? demoName : actingKid?.name ?? Session.shared.name?.split(separator: " ").first.map(String.init)
        let math = MathStore.shared, house = HouseStore.shared
        let local = vocabOpenLocal()
        math.open(for: owner, name: name, level: local?.base.level)
        house.open(for: owner, name: name)
        house.collect(from: local)
    }
}
