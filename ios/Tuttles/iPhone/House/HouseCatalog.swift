import Foundation

// The house: what its rooms are, where things go in them, and what can go
// there. A room is a square of floor with two walls behind it. In it are
// spots, each a fixed place (the bed's, the rug's, the left wall's picture),
// and each spot has its own things to choose between. A thing bought is
// theirs for good, and changing what's in a spot costs nothing.
//
// Prices are against what a day pays (Shared/HousePay.swift): about 300
// coins for both games' goals done well. An ordinary thing is a few dozen to
// a couple of hundred, so there's something to buy every day; a room is a few
// days to a week, each dearer than the last; and the best things in a room
// are a couple of days on their own. A few things, the pets and two of the
// rooms, are gems only.
//
// The house is a nice place first. What's odd about it is at the edges: the
// things that cost gems, and what's said about the rest.
//
// Two of a room's spots aren't places in it: its wood and its cloth, which
// are the colour of every wooden and every upholstered thing in the room. And
// the house has spots of its own, outside (`outside`): the roof and its
// shape, the walls, the front door, something on the roof and something on
// the lawn. They're kept like a room's ("outside.roof"), and are what the
// street sees.

struct HouseItem: Identifiable, Hashable {
    enum Look: Hashable {
        /// A model from the furniture kit, as it comes or tinted.
        case kit(String, tint: String? = nil)
        /// One kit model standing on another: a television on its cabinet.
        case stack(String, String)
        /// Something from Math's cafeteria, on a table.
        case food(String)
        case tree(String)
        case pet(String)
        /// A rug drawn in code: its pattern and two colours.
        case rug(String, String, String)
        /// A picture for the wall, drawn in code: what of, and two colours.
        case art(String, String, String)
        case window(String)
        /// The walls' colour, and the skirting's.
        case paint(String, String)
        /// Wallpaper: its pattern, the paper's colour and the print's, and the skirting's.
        case paper(String, String, String, String)
        /// The floor: its pattern and two colours.
        case flooring(String, String, String)
        /// Something built in code (HouseProps.swift, HouseYardProps.swift, HouseFunProps.swift).
        case made(String)
        /// A model from another pack, by its folder and name, grown by that much.
        case model(String, String, Float)
        /// The wood of everything in the room: its colour, and its darker parts'. `glow`, it shines a little.
        case wood(String, String, glow: Double = 0)
        /// The cloth of everything in the room.
        case fabric(String, glow: Double = 0)
        /// The roof's colour.
        case roof(String, glow: Double = 0)
        /// The roof's shape: "gable", "steep", "pyramid" or "flat".
        case roofShape(String)
        /// What the walls are clad in outside: a pattern and two colours. "rooms": each room its own colour.
        case cladding(String, String, String)
        /// The front door's colour; `round`, a round one.
        case door(String, round: Bool = false)
        /// The fence round the land: how it's made ("picket", "rail", "hedge", "stone", "none") and its colour.
        case fence(String, String)
        /// A way something about the house is made: its inside doors (a model's name), its windows ("plain", "grid", "shutters", "boxes").
        case style(String)
    }

    let id: String
    let name: String
    let blurb: String
    let coins: Int
    let gems: Int
    let look: Look

    var free: Bool { coins == 0 && gems == 0 }
}

struct HouseSpot: Identifiable, Hashable {
    enum Place: Hashable {
        /// On the floor at (x, z), turned `ry` quarter-turns.
        case floor(Float, Float, Int)
        /// On the floor against the left wall (x = 0) or the right (z = 0), this far along it, facing into the room.
        case against(left: Bool, Float)
        /// On top of whatever's in another spot of the room (on the floor there, if nothing is).
        case on(String)
        /// Flat on the floor.
        case rug(Float, Float)
        /// On the left wall (x = 0) or the right (z = 0): how far along, and how high its middle is.
        case wall(left: Bool, Float, Float)
        case ceiling(Float, Float)
        case walls
        case flooring
        case pet(Float, Float)
        /// Not a place: the wood, or the cloth, of everything in the room.
        case wood
        case fabric
        /// Outside the house (HouseScene.swift knows where, by the spot).
        case outside
    }

    let id: String
    let title: String
    let place: Place
    let items: [HouseItem]

    /// What's there before anything's chosen: the free one, if the spot has one.
    var starter: HouseItem? { items.first(where: \.free) }
}

struct HouseRoom: Identifiable, Hashable {
    let id: String
    let name: String
    let blurb: String
    /// Where it goes if they've not said (a house from before they could): across, floor, back. See HouseLayout.swift.
    let cell: [Int]
    /// Gems to unlock; 0 for a room bought with coins.
    let gems: Int
    /// Where whoever lives there stands: a bit of floor nothing is put on.
    let stand: [Float]
    let spots: [HouseSpot]
    /// Its own price in coins: a thing for the yard. 0 for a room, which costs what the next room costs.
    var coins = 0

    func spot(_ id: String) -> HouseSpot? { spots.first { $0.id == id } }
}

enum HouseCatalog {
    /// A side of a room's floor, and how high its walls are.
    static let side: Float = 4
    static let height: Float = 3.2

    /// The room everyone starts with.
    static let first = "bedroom"

    /// What the next room bought with coins costs, by how many they have: the
    /// first five rooms are what the weeks to the test are for, and the dream
    /// rooms after them go on getting dearer, to as much as the pool.
    static func roomPrice(owned: Int) -> Int {
        let prices = [0, 800, 1200, 1600, 2000, 2500, 3000, 3500, 4000]
        return prices[min(max(owned, 0), prices.count - 1)]
    }

    static func room(_ id: String) -> HouseRoom? { byID[id] }

    private static let byID: [String: HouseRoom] = Dictionary(uniqueKeysWithValues: everything.map { ($0.id, $0) })

    static func item(_ id: String) -> HouseItem? { items[id] }

    private static let items: [String: HouseItem] = {
        var all: [String: HouseItem] = [:]
        for room in everything + [outside] { for spot in room.spots { for item in spot.items { all[item.id] = item } } }
        return all
    }()

    /// The key a placed thing is kept under: "bedroom.bed".
    static func key(_ room: String, _ spot: String) -> String { "\(room).\(spot)" }

    // MARK: Making them

    static func spot(_ room: String, _ id: String, _ title: String, _ place: HouseSpot.Place,
                             _ items: [(String, String, String, Int, Int, HouseItem.Look)]) -> HouseSpot {
        HouseSpot(id: id, title: title, place: place, items: items.map {
            HouseItem(id: "\(room).\(id).\($0.0)", name: $0.1, blurb: $0.2, coins: $0.3, gems: $0.4, look: $0.5)
        })
    }

    static func walls(_ room: String, _ first: (String, String, String), _ more: [(String, String, String, String, Int)]) -> HouseSpot {
        spot(room, "walls", "Walls", .walls,
             [("plain", first.0, "How it came.", 0, 0, .paint(first.1, first.2))] + more.map { ($0.0.lowercased().replacingOccurrences(of: " ", with: "-"), $0.0, $0.1, $0.4, 0, .paint($0.2, $0.3)) }
             + (HouseLayout.shape(room).outdoor ? [] : papers))
    }

    /// Wallpaper, the same in every room with walls: (id, name, blurb, coins, gems, look).
    private static let papers: [(String, String, String, Int, Int, HouseItem.Look)] = [
        ("paper-pinstripe", "Pinstripe Paper", "Makes the room stand up straight.", 90, 0, .paper("stripes", "f3ead2", "b9cbe0", "c9b78f")),
        ("paper-candy", "Candy Stripe Paper", "Do not lick the walls either.", 110, 0, .paper("stripes", "f6f1e4", "ef8fa6", "d9c9b0")),
        ("paper-dots", "Polka Dot Paper", "Count them. There's one more each time.", 110, 0, .paper("dots", "f6efd9", "5b86c4", "c9b78f")),
        ("paper-diamonds", "Diamond Paper", "Like a jumper, for a room.", 130, 0, .paper("diamonds", "e9e2d0", "b5483b", "8a6a4a")),
        ("paper-clouds", "Cloud Paper", "They drift a little, on windy days.", 140, 0, .paper("clouds", "a9d4ee", "ffffff", "7fa9c4")),
        ("paper-stars", "Star Paper", "One of them isn't printed on.", 150, 0, .paper("stars", "1b2148", "ffe9a3", "0f1330")),
        ("paper-jungle", "Jungle Paper", "Something moves behind the leaves when the light's off.", 160, 0, .paper("leaves", "dfe9cf", "4f8a4a", "8fa77a")),
        ("paper-panels", "Wood Panelling", "A cabin, as far as the room knows.", 150, 0, .paper("panels", "a8733f", "7c5233", "5a3a22")),
        ("paper-brick", "Bare Brick", "What's under the plaster, or a very good drawing of it.", 150, 0, .paper("bricks", "b5654a", "dccbb6", "6b4a3a")),
        ("paper-rockets", "Rocket Paper", "The rockets are a little further along each morning.", 0, 3, .paper("rockets", "151a3a", "ff7a3c", "0d1026")),
    ]

    /// Floors, the same in every room indoors.
    private static let tiles: [(String, String, String, Int, Int, HouseItem.Look)] = [
        ("wide-planks", "Wide Planks", "From a ship, they say. Which ship, they don't.", 100, 0, .flooring("planks", "8a5a3c", "6b432b")),
        ("hexagons", "Hexagon Tiles", "Bees would approve.", 120, 0, .flooring("hex", "e9e4d8", "9aa0a8")),
        ("harlequin", "Harlequin", "A floor in fancy dress.", 130, 0, .flooring("harlequin", "f1ede2", "b5483b")),
        ("terrazzo", "Terrazzo", "A hundred little stones. One's a tooth.", 140, 0, .flooring("terrazzo", "ece6da", "d98e6b")),
        ("marble", "Marble", "Cold, and proud of it.", 180, 0, .flooring("marble", "f2f0ec", "c9c5bd")),
    ]

    static func floors(_ room: String, _ first: (String, String, String, String), _ more: [(String, String, String, String, String, Int)]) -> HouseSpot {
        spot(room, "floor", "Floor", .flooring,
             [("plain", first.0, "How it came.", 0, 0, .flooring(first.1, first.2, first.3))] + more.map { ($0.0.lowercased().replacingOccurrences(of: " ", with: "-"), $0.0, $0.1, $0.5, 0, .flooring($0.2, $0.3, $0.4)) }
             + (HouseLayout.shape(room).outdoor ? [] : tiles))
    }

    /// The wood of a room's things: as the kit makes it, or one of these. The same in every room that has it.
    static func wood(_ room: String) -> HouseSpot {
        spot(room, "wood", "Wood", .wood, [
            ("plain", "Pine", "How it came.", 0, 0, .wood("e69963", "ad754c")),
            ("birch", "Birch", "Pale. Shows where the mugs have been.", 50, 0, .wood("ecd3a4", "cfb07c")),
            ("walnut", "Walnut", "Darker. Looks as if it knows things.", 60, 0, .wood("8a5a3c", "6b432b")),
            ("white", "Painted White", "Two coats. You can still see what it was.", 70, 0, .wood("f4efe4", "d6cfbf")),
            ("blue", "Painted Blue", "Somebody had half a tin left over.", 80, 0, .wood("5f92bf", "47749c")),
            ("green", "Painted Green", "The colour of a shed that's seen things.", 80, 0, .wood("6fa37a", "55865f")),
            ("red", "Painted Red", "Fast, for furniture.", 90, 0, .wood("c9503f", "a23c2e")),
            ("black", "Ebony", "Every piece looks like a piano.", 120, 0, .wood("3a3839", "262425")),
            ("cherry", "Cherry", "Redder every year, like someone embarrassed slowly.", 90, 0, .wood("a8553a", "7f3c28")),
            ("drift", "Driftwood", "Washed up. Doing fine.", 80, 0, .wood("b9b2a2", "948d7d")),
            ("mint", "Painted Mint", "Tastes of nothing. Checked.", 80, 0, .wood("a9dcc4", "83bda3")),
            ("yellow", "Painted Yellow", "The room wakes up before you do.", 80, 0, .wood("f2cf4a", "d0ab2a")),
            ("pink", "Painted Pink", "Somebody decided, and it stayed decided.", 80, 0, .wood("f2a3bd", "d47f9c")),
            ("gold", "Gold", "Solid. The floor is doing its best.", 0, 4, .wood("f5c542", "d9a62a", glow: 0.25)),
        ])
    }

    /// The cloth of a room's things: sofas, cushions, covers.
    static func fabric(_ room: String) -> HouseSpot {
        spot(room, "fabric", "Fabric", .fabric, [
            ("plain", "Red", "How it came.", 0, 0, .fabric("ef5e57")),
            ("cream", "Cream", "Stays clean exactly as long as you watch it.", 50, 0, .fabric("eadfc6")),
            ("mustard", "Mustard", "Nobody's favourite. Everybody sits on it.", 50, 0, .fabric("e0a82e")),
            ("green", "Forest", "Things lost down the side stay lost.", 60, 0, .fabric("3f7a55")),
            ("navy", "Navy", "Hides everything. Don't ask what.", 60, 0, .fabric("2f4f8f")),
            ("pink", "Pink", "Soft on purpose.", 70, 0, .fabric("f08ab0")),
            ("plum", "Plum", "For sitting and having opinions.", 80, 0, .fabric("7a4a8f")),
            ("charcoal", "Charcoal", "Serious cushions.", 90, 0, .fabric("4a4d55")),
            ("teal", "Teal", "The colour of a pool with the lights on.", 70, 0, .fabric("2f9a94")),
            ("orange", "Orange", "Can be seen from the stairs.", 70, 0, .fabric("f08a3c")),
            ("lilac", "Lilac", "Smells of it, a bit. Or you think it does.", 70, 0, .fabric("b79be0")),
            ("denim", "Denim", "Goes with everything you own.", 80, 0, .fabric("5d7fb5")),
            ("white", "White", "Brave.", 90, 0, .fabric("f4f1ea")),
            ("lime", "Lime", "Sharp.", 80, 0, .fabric("a8d94a")),
            ("glow", "Glow in the Dark", "Green, after dark. You'll find the sofa. It'll find you.", 0, 3, .fabric("b9f5a8", glow: 0.55)),
        ])
    }

    // MARK: The rooms

    static let rooms: [HouseRoom] = [bedroom, living, kitchen, bathroom, den, garden, basement, observatory] + more

    private static let bedroom = HouseRoom(
        id: "bedroom", name: "Bedroom", blurb: "Where it starts. A bed, and room for more.", cell: [0, 0, 0], gems: 0, stand: [2.0, 1.6],
        spots: [
            walls("bedroom", ("Cream", "f3ead2", "c9b78f"), [
                ("Sky", "Blue, like the bit of sky over the school.", "bfe0f2", "8fb9d3", 40),
                ("Sage", "The green of a calm you've read about.", "c9dcc0", "94b08a", 40),
                ("Peach", "Warm at any hour.", "f7d2bd", "d9a184", 50),
                ("Dusk", "It's always just after dinner in here.", "5d5f8f", "3e3f66", 90),
                ("Night", "Darker than the hall, on purpose.", "232a4a", "151a30", 140),
            ]),
            floors("bedroom", ("Boards", "boards", "c98f55", "a8733f"), [
                ("Honey Oak", "Boards, but they've been somewhere nice.", "boards", "e2b574", "c4944f", 50),
                ("Blue Carpet", "Soft. Keeps a footprint for a while.", "carpet", "5b86c4", "4b74b0", 70),
                ("Checkers", "Nobody's won on it yet.", "checker", "f1ede2", "2f3b55", 110),
            ]),
            wood("bedroom"),
            fabric("bedroom"),
            spot("bedroom", "bed", "Bed", .against(left: false, 3.0), [
                ("single", "Single Bed", "Yours. It was here when you arrived.", 0, 0, .kit("bedSingle")),
                ("double", "Big Bed", "Twice the bed. Same amount of you.", 220, 0, .kit("bedDouble")),
                ("bunk", "Bunk Bed", "Nobody is in the other one. Probably.", 340, 0, .kit("bedBunk")),
            ]),
            spot("bedroom", "bedside", "Bedside", .against(left: false, 1.35), [
                ("table", "Side Table", "For a glass of water you won't drink.", 30, 0, .kit("sideTable")),
                ("drawers", "Drawers", "Three drawers. Two open.", 60, 0, .kit("sideTableDrawers")),
                ("lamp", "Table and Lamp", "On at night whether you turn it on or not.", 95, 0, .stack("sideTable", "lampRoundTable")),
            ]),
            spot("bedroom", "rug", "Rug", .rug(2.4, 3.0), [
                ("stripe", "Striped Rug", "Goes with most things.", 35, 0, .rug("stripes", "d6263a", "f3ead2")),
                ("round", "Round Rug", "A soft place to drop things.", 45, 0, .rug("round", "3f8f5a", "cfe6c2")),
                ("check", "Picnic Rug", "Pink and green. No ants so far.", 70, 0, .rug("check", "f4a6c0", "b7dd7a")),
                ("space", "Solar System Rug", "Not to scale. The middle one is warm.", 180, 0, .rug("space", "1c3f7a", "ffcf33")),
            ]),
            spot("bedroom", "desk", "Desk", .against(left: true, 2.75), [
                ("desk", "Desk", "Homework has been done at desks like this.", 90, 0, .kit("desk")),
                ("screen", "Desk and Computer", "It's already on.", 240, 0, .stack("desk", "computerScreen")),
                ("laptop", "Desk and Laptop", "Closes itself when you look away.", 200, 0, .stack("desk", "laptop")),
            ]),
            spot("bedroom", "chair", "Chair", .floor(1.25, 2.75, 3), [
                ("chair", "Chair", "Four legs. Counted.", 25, 0, .kit("chair")),
                ("cushion", "Cushioned Chair", "Someone was just sitting in it.", 45, 0, .kit("chairCushion")),
                ("swivel", "Desk Chair", "Turns to face the door by itself. Wheels.", 80, 0, .kit("chairDesk")),
            ]),
            spot("bedroom", "shelf", "Shelf", .against(left: true, 0.95), [
                ("low", "Low Shelf", "For the things you've stopped looking for.", 50, 0, .kit("bookcaseOpenLow")),
                ("open", "Bookcase", "The books rearrange themselves by mood.", 100, 0, .kit("bookcaseOpen")),
                ("wide", "Cupboard", "Holds more than fits in it.", 150, 0, .kit("bookcaseClosedWide")),
            ]),
            spot("bedroom", "plant", "Corner", .floor(3.6, 3.0, 0), [
                ("plant", "Potted Plant", "Leans toward you, not the window.", 30, 0, .kit("pottedPlant")),
                ("bear", "Bear", "He's seen everything. He's fine.", 50, 0, .kit("bear")),
                ("box", "Cardboard Box", "Was a spaceship. Could be again.", 15, 0, .kit("cardboardBoxOpen")),
                ("lamp", "Floor Lamp", "A tall, patient light.", 60, 0, .kit("lampRoundFloor")),
            ]),
            spot("bedroom", "left", "Left wall", .wall(left: true, 2.75, 2.25), [
                ("board", "Pinboard", "Notes from you, to you.", 30, 0, .art("pinboard", "b7c98a", "f6f1e2")),
                ("shark", "Shark Poster", "It's smiling. That's just its face.", 45, 0, .art("shark", "2d6f9c", "f3ead2")),
                ("rocket", "Rocket Poster", "Three, two, one, and so on.", 45, 0, .art("rocket", "1b2550", "ff7a3c")),
                ("eyes", "The Portrait", "Nobody you know. Its eyes follow whoever's in the room.", 0, 3, .art("eyes", "5a3b2a", "e9d7b0")),
            ]),
            spot("bedroom", "right", "Right wall", .wall(left: false, 1.35, 2.05), [
                ("window", "Window", "A view of outside, where the weather is.", 60, 0, .window("day")),
                ("round", "Round Window", "Like a ship's, if the house were going anywhere.", 100, 0, .window("round")),
                ("stars", "Night Window", "It's night out of this one whatever the time.", 0, 4, .window("night")),
            ]),
            // (Not bought: what's on it is won. HouseEarned.swift.)
            spot("bedroom", "earned", "Your shelf", .wall(left: false, 3.0, 2.3), [
                ("shelf", "Your Shelf", "Fills up as you practise: a book for every 15 words you know by heart, a cup for every 5 days you reach your goal in Math.", 0, 0, .made("earned-shelf")),
            ]),
            spot("bedroom", "pet", "Pet", .pet(2.9, 3.4), [
                ("cat", "Cat", "Sits where you were about to.", 0, 5, .pet("animal-cat")),
                ("dog", "Dog", "Pleased to see you. Every time. Even this time.", 0, 5, .pet("animal-dog")),
                ("bunny", "Bunny", "Thinking about something. Don't ask.", 0, 4, .pet("animal-bunny")),
            ]),
        ])

    private static let living = HouseRoom(
        id: "living", name: "Living Room", blurb: "Somewhere to sit and be found.", cell: [0, 0, -1], gems: 0, stand: [3.3, 3.1],
        spots: [
            walls("living", ("Linen", "efe6d6", "c2b08f"), [
                ("Butter", "Sunday morning, as a colour.", "f6e3a1", "d3b862", 50),
                ("Terracotta", "Baked. Still slightly warm.", "d98e6b", "a9623f", 70),
                ("Forest", "Quiet, the way trees are.", "3f6b55", "2a4a3a", 90),
                ("Plum", "For a room with opinions.", "6d3f66", "4a2845", 120),
            ]),
            floors("living", ("Walnut", "boards", "9a6a45", "7c5233"), [
                ("Pale Ash", "Shows every crumb, proudly.", "boards", "e7d3b0", "cdb388", 60),
                ("Green Carpet", "Like a lawn that never needs you.", "carpet", "5e9a6a", "4f8a5b", 80),
                ("Parquet", "Laid by someone who liked puzzles.", "parquet", "c98f55", "9a6a3a", 150),
            ]),
            wood("living"),
            fabric("living"),
            spot("living", "sofa", "Sofa", .against(left: false, 2.3), [
                ("sofa", "Sofa", "Two of you fit. Three if you like each other.", 150, 0, .kit("loungeSofa")),
                ("long", "Long Sofa", "You can lie down flat and still have sofa left.", 240, 0, .kit("loungeSofaLong")),
                ("design", "Designer Sofa", "Nicer than it is comfortable.", 320, 0, .kit("loungeDesignSofa")),
            ]),
            spot("living", "armchair", "Armchair", .floor(3.45, 1.8, 3), [
                ("chair", "Armchair", "The good seat. There's only one.", 90, 0, .kit("loungeChair")),
                ("relax", "Recliner", "Goes back further than you'd think is safe.", 140, 0, .kit("loungeChairRelax")),
                ("design", "Egg Chair", "From the future, as imagined long ago.", 190, 0, .kit("loungeDesignChair")),
            ]),
            spot("living", "table", "Coffee table", .floor(1.9, 2.3, 0), [
                ("wood", "Coffee Table", "For feet, when nobody's looking.", 50, 0, .kit("tableCoffee")),
                ("square", "Square Table", "The same on every side. Fair.", 60, 0, .kit("tableCoffeeSquare")),
                ("glass", "Glass Table", "You'll walk into it once.", 100, 0, .kit("tableCoffeeGlass")),
            ]),
            spot("living", "rug", "Rug", .rug(2.0, 2.2), [
                ("round", "Round Rug", "Ties the room together, apparently.", 50, 0, .rug("round", "c1502e", "f1d6a8")),
                ("stripe", "Runner", "Blue and cream, end to end.", 50, 0, .rug("stripes", "2f5f9a", "efe6d6")),
                ("zigzag", "Zigzag Rug", "Don't follow it with your eyes for long.", 120, 0, .rug("zigzag", "20242c", "f3ead2")),
            ]),
            spot("living", "tv", "Television", .against(left: true, 2.0), [
                ("old", "Old Television", "Gets one channel. It's the hallway.", 90, 0, .stack("cabinetTelevision", "televisionVintage")),
                ("antenna", "Portable Set", "The aerial points at whoever's talking.", 130, 0, .stack("cabinetTelevisionDoors", "televisionAntenna")),
                ("modern", "Big Flat One", "So thin it isn't there from the side.", 380, 0, .stack("cabinetTelevision", "televisionModern")),
            ]),
            spot("living", "lamp", "Lamp", .floor(3.65, 0.4, 0), [
                ("round", "Floor Lamp", "A pool of light and somewhere to stand in it.", 50, 0, .kit("lampRoundFloor")),
                ("square", "Square Lamp", "Modern. It says so.", 60, 0, .kit("lampSquareFloor")),
            ]),
            spot("living", "sound", "Corner", .floor(0.5, 0.45, 0), [
                ("plant", "Big Plant", "Grows when the room is empty.", 40, 0, .kit("pottedPlant")),
                ("radio", "Radio", "Plays a song you nearly know.", 70, 0, .stack("sideTable", "radio")),
                ("speaker", "Speaker", "Loud enough for next door, whoever that is.", 130, 0, .kit("speaker")),
            ]),
            spot("living", "shelf", "Shelf", .against(left: true, 3.45), [
                ("books", "Bookcase", "Every book in it ends the same way.", 100, 0, .kit("bookcaseOpen")),
                ("doors", "Cabinet", "The doors are for what's inside, not for you.", 140, 0, .kit("bookcaseClosedDoors")),
            ]),
            spot("living", "left", "Left wall", .wall(left: true, 2.0, 2.4), [
                ("hills", "Painting of Hills", "Hills. Somebody's been over them.", 50, 0, .art("hills", "8fc1d9", "6fa35a")),
                ("sun", "Painting of a Sun", "Rising or setting. It won't say.", 60, 0, .art("sun", "f7c35f", "d6502e")),
                ("family", "Family Photo", "Everyone's in it. One more than you remember.", 0, 3, .art("family", "d9c7a3", "5a4635")),
            ]),
            spot("living", "right", "Right wall", .wall(left: false, 2.3, 2.15), [
                ("window", "Wide Window", "The street, and the other house.", 80, 0, .window("wide")),
                ("clock", "Wall Clock", "Right twice a day. It runs backwards.", 0, 2, .art("clock", "f3ead2", "20242c")),
            ]),
            spot("living", "ceiling", "Ceiling", .ceiling(2.0, 2.0), [
                ("lamp", "Ceiling Light", "On.", 40, 0, .kit("lampSquareCeiling")),
                ("fan", "Ceiling Fan", "Turns slowly, the same way as your thoughts.", 110, 0, .kit("ceilingFan")),
            ]),
            spot("living", "pet", "Pet", .pet(2.7, 3.5), [
                ("fox", "Fox", "Let itself in. Has a key now.", 0, 6, .pet("animal-fox")),
                ("parrot", "Parrot", "Repeats things nobody has said yet.", 0, 6, .pet("animal-parrot")),
                ("monkey", "Monkey", "Knows where the remote is. Won't tell.", 0, 7, .pet("animal-monkey")),
            ]),
        ])

    private static let kitchen = HouseRoom(
        id: "kitchen", name: "Kitchen", blurb: "Something is always nearly ready.", cell: [-1, 0, 0], gems: 0, stand: [1.3, 1.6],
        spots: [
            walls("kitchen", ("White Tile", "f4f4ee", "b9c4c4"), [
                ("Mint", "Clean in a way you can taste.", "c8ecd9", "8fc4aa", 50),
                ("Lemon", "Bright. Slightly sour.", "f9ee9a", "d6c75a", 50),
                ("Diner Red", "Orders up.", "d6463a", "8f2a22", 100),
            ]),
            floors("kitchen", ("Tiles", "tiles", "e9e4d8", "c9c2b2"), [
                ("Diner Checks", "Black, white, black, white, and so on to the door.", "checker", "f4f4ee", "20242c", 90),
                ("Blue Tiles", "Cool underfoot at midnight.", "tiles", "9fc7e0", "7aa9c7", 70),
                ("Boards", "A kitchen that thinks it's a cabin.", "boards", "c98f55", "a8733f", 60),
            ]),
            wood("kitchen"),
            fabric("kitchen"),
            spot("kitchen", "fridge", "Fridge", .against(left: false, 0.6), [
                ("small", "Small Fridge", "Holds one of everything.", 70, 0, .kit("kitchenFridgeSmall")),
                ("fridge", "Fridge", "The light stays on when it's shut. You've checked.", 150, 0, .kit("kitchenFridge")),
                ("large", "Double Fridge", "One side is food. Don't open the other.", 280, 0, .kit("kitchenFridgeLarge")),
            ]),
            spot("kitchen", "stove", "Stove", .against(left: false, 1.5), [
                ("gas", "Stove", "Four rings. One is always warm.", 100, 0, .kit("kitchenStove")),
                ("electric", "Electric Stove", "Glows without being asked.", 150, 0, .kit("kitchenStoveElectric")),
            ]),
            spot("kitchen", "sink", "Sink", .against(left: false, 2.38), [
                ("sink", "Sink", "Drips in threes.", 80, 0, .kit("kitchenSink")),
            ]),
            spot("kitchen", "counter", "Counter", .against(left: false, 3.26), [
                ("counter", "Counter", "A place to put things down and forget them.", 50, 0, .kit("kitchenCabinet")),
                ("toaster", "Counter and Toaster", "The toast comes up with a face on it, sometimes.", 90, 0, .stack("kitchenCabinet", "toaster")),
                ("coffee", "Counter and Coffee Machine", "For the grown-ups, who aren't here.", 120, 0, .stack("kitchenCabinetDrawer", "kitchenCoffeeMachine")),
                ("microwave", "Counter and Microwave", "Counts down to something.", 140, 0, .stack("kitchenCabinetDrawer", "kitchenMicrowave")),
            ]),
            spot("kitchen", "table", "Table", .floor(2.3, 2.6, 0), [
                ("table", "Kitchen Table", "Scratched by generations of homework.", 70, 0, .kit("table")),
                ("cloth", "Table with a Cloth", "The cloth hides what's under the table.", 100, 0, .kit("tableCloth")),
                ("round", "Round Table", "No head of it. No arguments.", 130, 0, .kit("tableRound")),
            ]),
            spot("kitchen", "food", "On the table", .on("table"), [
                ("pizza", "Pizza", "Still hot. Has been for days.", 30, 0, .food("pizza")),
                ("cake", "Cake", "Nobody's birthday. Somebody's cake.", 50, 0, .food("cake")),
                ("turkey", "Roast Turkey", "A whole one. It's a lot.", 90, 0, .food("turkey")),
            ]),
            spot("kitchen", "chair1", "Chair", .floor(1.15, 2.6, 1), [
                ("chair", "Chair", "Wobbles on purpose.", 25, 0, .kit("chair")),
                ("cushion", "Cushioned Chair", "Kinder.", 45, 0, .kit("chairCushion")),
                ("round", "Round Chair", "Hugs back, slightly.", 65, 0, .kit("chairRounded")),
            ]),
            spot("kitchen", "chair2", "Other chair", .floor(3.45, 2.6, 3), [
                ("chair", "Chair", "Matches. Or will.", 25, 0, .kit("chair")),
                ("cushion", "Cushioned Chair", "For a guest.", 45, 0, .kit("chairCushion")),
                ("stool", "Bar Stool", "Too tall. That's the point.", 55, 0, .kit("stoolBar")),
            ]),
            spot("kitchen", "bin", "Corner", .floor(0.45, 3.5, 0), [
                ("bin", "Bin", "Empties itself. Don't ask where.", 25, 0, .kit("trashcan")),
                ("plant", "Herbs", "Basil, probably.", 35, 0, .kit("plantSmall1")),
                ("washer", "Washing Machine", "Watching it is free.", 160, 0, .kit("washer")),
            ]),
            spot("kitchen", "right", "Right wall", .wall(left: false, 1.95, 2.3), [
                ("window", "Window", "Over the sink, for staring out of.", 60, 0, .window("day")),
                ("menu", "Menu Board", "Today's special is the same as yesterday's.", 50, 0, .art("menu", "20242c", "f3ead2")),
            ]),
            spot("kitchen", "left", "Left wall", .wall(left: true, 2.0, 2.1), [
                ("fruit", "Painting of Fruit", "A pear, two apples, and a lemon that wasn't invited.", 45, 0, .art("fruit", "f1e3c2", "d6463a")),
                ("fish", "Painting of a Fish", "Caught by nobody in this house.", 55, 0, .art("fish", "bfe0f2", "e07a3c")),
                ("hum", "Framed Humming", "A picture of the noise the fridge makes.", 0, 2, .art("hum", "101320", "7dff3a")),
            ]),
            spot("kitchen", "pet", "Pet", .pet(2.3, 3.65), [
                ("chick", "Chick", "Follows the nearest ankle.", 0, 4, .pet("animal-chick")),
                ("pig", "Pig", "Clean. Tidy, even. Judges the kitchen.", 0, 6, .pet("animal-pig")),
                ("cow", "Small Cow", "Indoors, and happier for it.", 0, 8, .pet("animal-cow")),
            ]),
        ])

    private static let bathroom = HouseRoom(
        id: "bathroom", name: "Bathroom", blurb: "Echoes nicely.", cell: [-1, 1, 0], gems: 0, stand: [2.9, 2.4],
        spots: [
            walls("bathroom", ("Pale Blue", "d6ecf4", "9fc4d3"), [
                ("Seafoam", "The colour of a wave thinking it over.", "bfe8dc", "86c2b2", 50),
                ("Pink", "Bubblegum, before chewing.", "f7c6d6", "d996ad", 60),
                ("Deep Sea", "Further down than the light goes.", "1f4f6b", "123346", 110),
            ]),
            floors("bathroom", ("White Tiles", "tiles", "f1f4f4", "c9d3d6"), [
                ("Aqua Tiles", "Pool-coloured.", "tiles", "8fd3d9", "6ab9c0", 70),
                ("Black and White", "Cold on the feet, smart on the eye.", "checker", "f1f4f4", "20242c", 90),
            ]),
            spot("bathroom", "bath", "Bath", .against(left: false, 2.6), [
                ("shower", "Shower", "Hot, then cold, then hot.", 130, 0, .kit("shower")),
                ("bath", "Bathtub", "Deep enough to think in.", 190, 0, .kit("bathtub")),
                ("round", "Round Shower", "Like standing in a glass.", 240, 0, .kit("showerRound")),
            ]),
            spot("bathroom", "toilet", "Toilet", .against(left: true, 0.75), [
                ("toilet", "Toilet", "Does what it's for.", 60, 0, .kit("toilet")),
                ("square", "Square Toilet", "The modern shape of an old idea.", 90, 0, .kit("toiletSquare")),
            ]),
            spot("bathroom", "sink", "Sink", .against(left: true, 2.05), [
                ("sink", "Sink", "Hot is cold and cold is hot. You'll learn.", 60, 0, .kit("bathroomSink")),
                ("square", "Square Sink", "For serious hand washing.", 90, 0, .kit("bathroomSinkSquare")),
                ("cabinet", "Sink Cabinet", "A drawer of things nobody put there.", 130, 0, .kit("bathroomCabinetDrawer")),
            ]),
            spot("bathroom", "mirror", "Mirror", .wall(left: true, 2.05, 2.2), [
                ("mirror", "Mirror", "You, the wrong way round.", 50, 0, .made("mirror")),
                ("late", "The Late Mirror", "Shows you a moment after you've moved.", 0, 4, .made("mirror-late")),
            ]),
            spot("bathroom", "rug", "Mat", .rug(2.4, 2.3), [
                ("mat", "Bath Mat", "Always a bit damp.", 30, 0, .rug("round", "f1f4f4", "8fd3d9")),
                ("stripe", "Striped Mat", "Seaside.", 40, 0, .rug("stripes", "2f6f9c", "f1f4f4")),
            ]),
            spot("bathroom", "washer", "Laundry", .against(left: true, 3.4), [
                ("washer", "Washing Machine", "One sock in, none out.", 100, 0, .kit("washer")),
                ("dryer", "Dryer", "Warm. The cat's idea of heaven.", 100, 0, .kit("dryer")),
                ("stack", "Washer and Dryer", "A tower of clean.", 200, 0, .kit("washerDryerStacked")),
            ]),
            spot("bathroom", "corner", "Corner", .floor(3.55, 3.5, 0), [
                ("plant", "Fern", "Likes the steam.", 30, 0, .kit("plantSmall2")),
                ("duck", "Rubber Duck", "Big, for a duck. It faces you.", 40, 0, .made("duck")),
                ("coat", "Towel Stand", "The towels are warm. Nobody warmed them.", 60, 0, .kit("coatRackStanding")),
            ]),
            spot("bathroom", "right", "Right wall", .wall(left: false, 0.7, 2.2), [
                ("window", "Frosted Window", "Shapes go past it.", 50, 0, .window("frosted")),
                ("port", "Porthole", "The sea is right there. It shouldn't be.", 0, 4, .window("sea")),
            ]),
            spot("bathroom", "pet", "Pet", .pet(1.9, 3.4), [
                ("penguin", "Penguin", "Lives in the bath. Pays no rent.", 0, 6, .pet("animal-penguin")),
                ("crab", "Crab", "Sideways everywhere. Never late.", 0, 5, .pet("animal-crab")),
                ("beaver", "Beaver", "Has plans for the plumbing.", 0, 6, .pet("animal-beaver")),
            ]),
        ])

    private static let den = HouseRoom(
        id: "den", name: "Den", blurb: "For games, and for hiding from the rest of the house.", cell: [0, 1, -1], gems: 0, stand: [3.2, 2.5],
        spots: [
            walls("den", ("Grey", "d9dce0", "a3a9b0"), [
                ("Arcade Purple", "The colour behind your eyelids after a long game.", "5b3f8f", "3b2866", 90),
                ("Racing Green", "Fast, standing still.", "2f6b4a", "1f4a33", 80),
                ("Orange", "Loud.", "f08a3c", "c46222", 70),
            ]),
            floors("den", ("Grey Carpet", "carpet", "8a8f99", "7b808a"), [
                ("Red Carpet", "You've arrived.", "carpet", "b5332e", "a22a26", 90),
                ("Dark Boards", "Creak in a pattern.", "boards", "5a4032", "45301f", 80),
                ("Arcade Carpet", "Shapes from another decade, having a party.", "arcade", "1b1b3a", "ff3fa4", 220),
            ]),
            wood("den"),
            fabric("den"),
            spot("den", "desk", "Desk", .against(left: false, 2.45), [
                ("desk", "Long Desk", "Room for two to disagree.", 110, 0, .kit("desk")),
                ("corner", "Corner Desk", "Takes the corner and keeps it.", 170, 0, .kit("deskCorner")),
                ("setup", "The Setup", "Screen, keys, the lot. It hums.", 420, 0, .stack("desk", "computerScreen")),
            ]),
            spot("den", "chair", "Chair", .floor(2.45, 1.4, 2), [
                ("desk", "Desk Chair", "Spins. You'll check how many times.", 80, 0, .kit("chairDesk")),
                ("modern", "Modern Chair", "Looks uncomfortable. Is fine.", 110, 0, .kit("chairModernCushion")),
            ]),
            spot("den", "arcade", "Machine", .against(left: false, 0.65), [
                ("speaker", "Tall Speaker", "You feel it in your teeth.", 130, 0, .kit("speaker")),
                ("arcade", "Arcade Cabinet", "One game. The high score is yours, from a day you don't remember.", 650, 0, .made("arcade")),
            ]),
            spot("den", "sofa", "Seat", .against(left: true, 2.6), [
                ("bench", "Bench", "Hard, honest seating.", 60, 0, .kit("benchCushion")),
                ("ottoman", "Sofa and Footstool", "For the second player.", 200, 0, .kit("loungeSofaOttoman")),
                ("corner", "Corner Sofa", "Seats everyone you know.", 360, 0, .kit("loungeSofaCorner")),
            ]),
            spot("den", "rug", "Rug", .rug(2.6, 2.7), [
                ("square", "Square Rug", "A square. Dependable.", 45, 0, .rug("check", "3b4a6b", "8a8f99")),
                ("target", "Target Rug", "Stand in the middle.", 90, 0, .rug("target", "d6263a", "f3ead2")),
                ("pitch", "Football Pitch Rug", "Small-sided.", 150, 0, .rug("pitch", "3f8f5a", "f3ead2")),
            ]),
            spot("den", "shelf", "Shelf", .against(left: false, 3.6), [
                ("books", "Game Shelf", "All the boxes, most of the pieces.", 100, 0, .kit("bookcaseOpen")),
                ("trophy", "Trophy Case", "Trophies for things you haven't done yet.", 260, 0, .made("trophies")),
            ]),
            spot("den", "corner", "Corner", .floor(3.6, 3.55, 0), [
                ("plant", "Plant", "Plastic. Thriving.", 30, 0, .kit("plantSmall3")),
                ("lamp", "Lamp", "Sets the mood, whatever the mood is.", 60, 0, .kit("lampSquareFloor")),
                ("globe", "Globe", "One of the countries isn't on other globes.", 0, 3, .made("globe")),
            ]),
            spot("den", "left", "Left wall", .wall(left: true, 2.6, 2.25), [
                ("football", "Football Poster", "The moment before the goal, for ever.", 45, 0, .art("football", "3f8f5a", "f3ead2")),
                ("ufo", "UFO Poster", "It wants to believe in you.", 55, 0, .art("ufo", "1b2550", "7dff3a")),
                ("void", "Black Square", "It was like that when it arrived. Don't lean on it.", 0, 3, .art("void", "000000", "111111")),
            ]),
            spot("den", "right", "Right wall", .wall(left: false, 2.45, 2.35), [
                ("pennant", "Pennants", "For a team that plays at night.", 40, 0, .art("pennants", "d6263a", "f5c542")),
                ("neon", "Neon Sign", "It says OPEN. It's never said anything else.", 180, 0, .art("neon", "101320", "ff3fa4")),
            ]),
            spot("den", "pet", "Pet", .pet(2.6, 3.65), [
                ("koala", "Koala", "Asleep. Beat that.", 0, 7, .pet("animal-koala")),
                ("panda", "Panda", "Came for the snacks, stayed for the snacks.", 0, 8, .pet("animal-panda")),
                ("tiger", "Tiger", "A small one. He knows.", 0, 10, .pet("animal-tiger")),
            ]),
        ])

    private static let garden = HouseRoom(
        id: "garden", name: "Garden", blurb: "Outside, but yours.", cell: [0, 1, 0], gems: 0, stand: [3.3, 3.4],
        spots: [
            walls("garden", ("Fence", "c9a36b", "8a6a3f"), [
                ("White Fence", "Painted on a Saturday.", "f4f1e6", "c9c2ad", 50),
                ("Hedge", "Trimmed by someone who comes at night.", "4f8a4a", "356b35", 90),
                ("Old Brick", "Warm from a sun that went down hours ago.", "b5654a", "8a4530", 120),
            ]),
            floors("garden", ("Grass", "grass", "7cbf5a", "68ab4a"), [
                ("Meadow", "Let go a bit. Flowers moved in.", "meadow", "86c462", "f4d04a", 90),
                ("Paving", "Neat stones, neatly.", "tiles", "d3cdbf", "b5ae9e", 70),
                ("Sand", "A beach, minus the sea.", "carpet", "edd9a3", "e2cb8f", 80),
            ]),
            wood("garden"),
            fabric("garden"),
            spot("garden", "tree", "Tree", .floor(0.9, 0.9, 0), [
                ("small", "Young Tree", "Planning to be a big one.", 80, 0, .tree("tree-small")),
                ("large", "Big Tree", "Older than the house. The house knows.", 180, 0, .tree("tree-large")),
            ]),
            spot("garden", "bench", "Seat", .against(left: false, 2.7), [
                ("bench", "Garden Bench", "For sitting and watching the other house.", 60, 0, .kit("bench")),
                ("cushion", "Cushioned Bench", "Rain doesn't land on it. Unclear why.", 100, 0, .kit("benchCushion")),
                ("lounger", "Lounger", "For doing nothing, thoroughly.", 180, 0, .kit("loungeChairRelax")),
            ]),
            spot("garden", "table", "Table", .floor(2.6, 2.5, 0), [
                ("round", "Garden Table", "Lemonade goes here.", 80, 0, .kit("tableRound")),
                ("cross", "Picnic Table", "Splinters included.", 70, 0, .kit("tableCross")),
            ]),
            spot("garden", "food", "On the table", .on("table"), [
                ("soda", "Lemonade", "Cold. The ice never melts.", 25, 0, .food("soda")),
                ("burger", "Burger", "Somebody's been barbecuing. You can't see who.", 35, 0, .food("burger")),
                ("donut", "Doughnut", "With sprinkles. One is missing.", 30, 0, .food("donut-sprinkles")),
            ]),
            spot("garden", "pond", "Middle", .rug(1.1, 2.9), [
                ("flowers", "Flower Bed", "Tulips, in rows, at attention.", 60, 0, .made("flowers")),
                ("pond", "Pond", "Something lives in it. Round, patient.", 160, 0, .made("pond")),
                ("fire", "Campfire", "Lit. It was lit when you got here.", 240, 0, .made("campfire")),
            ]),
            spot("garden", "plant", "Corner", .floor(3.65, 0.45, 0), [
                ("pot", "Big Pot", "A plant with ambitions.", 30, 0, .kit("pottedPlant")),
                ("lamp", "Garden Lamp", "Moths have a standing arrangement.", 60, 0, .kit("lampRoundFloor")),
                ("gnome", "Gnome", "Moves when you're in the other rooms. Only a little.", 0, 3, .made("gnome")),
            ]),
            spot("garden", "left", "Left side", .wall(left: true, 2.2, 0.85), [
                ("lights", "String Lights", "Evening, on a wire.", 70, 0, .art("lights", "000000", "ffd27a")),
                ("bunting", "Bunting", "For a party that's about to happen.", 50, 0, .art("pennants", "d6263a", "f5c542")),
            ]),
            spot("garden", "pet", "Pet", .pet(1.9, 1.7), [
                ("deer", "Deer", "Comes when it's quiet. Stays when it's not.", 0, 8, .pet("animal-deer")),
                ("bee", "Large Bee", "Very large. Friendly. Busy.", 0, 4, .pet("animal-bee")),
                ("hog", "Hedgehog", "Sharp on one side only.", 0, 5, .pet("animal-hog")),
            ]),
        ])

    private static let basement = HouseRoom(
        id: "basement", name: "The Basement", blurb: "Under the house. Further under than it should be.", cell: [0, -1, 0], gems: 8, stand: [3.3, 3.2],
        spots: [
            walls("basement", ("Bare Concrete", "9a9c9f", "6b6d70"), [
                ("Red Curtains", "All the way round. They move with no draught.", "8f1a22", "5a0f14", 250),
                ("Wood Panels", "Somebody's idea of cosy, long ago.", "7c5233", "5a3a22", 90),
            ]),
            floors("basement", ("Concrete", "carpet", "7f8185", "76787c"), [
                ("Zigzag", "Black and white, and not quite still.", "zigzag", "f3ead2", "20242c", 250),
                ("Old Lino", "A pattern chosen by someone who has since left.", "checker", "b7a57a", "7c6a45", 70),
            ]),
            spot("basement", "door", "Far wall", .wall(left: false, 2.0, 1.25), [
                ("door", "The Door", "Doesn't open. It's warm, and there's a light under it.", 0, 5, .made("door")),
                ("pipes", "Pipes", "They knock back if you knock.", 80, 0, .art("pipes", "6b6d70", "b5654a")),
            ]),
            spot("basement", "boxes", "Boxes", .floor(0.8, 0.8, 0), [
                ("boxes", "Boxes", "Labelled in your handwriting. You didn't pack them.", 40, 0, .made("boxes")),
                ("washer", "Old Washer", "Runs a cycle at three in the morning.", 120, 0, .kit("washerDryerStacked")),
            ]),
            spot("basement", "seat", "Seat", .floor(2.6, 2.3, 2), [
                ("chair", "A Chair, Facing the Wall", "It was facing the wall when you came down.", 50, 0, .kit("chairModernFrameCushion")),
                ("sofa", "Velvet Sofa", "Red. Somebody is expected.", 300, 0, .kit("loungeDesignSofa")),
            ]),
            spot("basement", "light", "Light", .ceiling(2.0, 2.0), [
                ("bulb", "Bare Bulb", "Swings a little. Nothing's touching it.", 30, 0, .made("bulb")),
                ("lamp", "Standing Lamp", "On a timer nobody set.", 70, 0, .kit("lampSquareCeiling")),
            ]),
            spot("basement", "rug", "Floor", .rug(2.4, 2.8), [
                ("rug", "Old Rug", "Nicer than the room deserves.", 60, 0, .rug("round", "6b2a2a", "c9a36b")),
                ("hatch", "A Hatch", "There's a further down.", 0, 6, .rug("hatch", "3a3a3a", "c9a36b")),
            ]),
            spot("basement", "corner", "Corner", .floor(3.5, 0.6, 0), [
                ("tv", "Television, On", "Static, and a shape in the static.", 150, 0, .stack("cardboardBoxClosed", "televisionVintage")),
                ("radio", "Radio", "Numbers, read slowly.", 90, 0, .stack("cardboardBoxClosed", "radio")),
            ]),
            spot("basement", "pet", "Pet", .pet(1.2, 3.4), [
                ("fish", "Fish", "No water. Doesn't mind.", 0, 6, .pet("animal-fish")),
                ("caterpillar", "Caterpillar", "Has been about to change for a long time.", 0, 5, .pet("animal-caterpillar")),
            ]),
        ])

    private static let observatory = HouseRoom(
        id: "observatory", name: "The Observatory", blurb: "The top of the house. The sky is closer here than outside.", cell: [-1, 2, 0], gems: 12, stand: [3.3, 3.3],
        spots: [
            walls("observatory", ("Midnight", "1b2148", "0f1330"), [
                ("Star Chart", "Every star, and a few they haven't found.", "101638", "ffe9a3", 200),
                ("Copper", "Beaten by hand. Whose isn't recorded.", "b5733f", "7c4a25", 150),
            ]),
            floors("observatory", ("Dark Boards", "boards", "3a2f45", "2a2233"), [
                ("Moon Dust", "Grey and soft. Your footprints will last.", "carpet", "b9b9c2", "a9a9b3", 150),
                ("Night Sky", "Like the ceiling fell, gently.", "stars", "0d1230", "ffe9a3", 250),
            ]),
            wood("observatory"),
            fabric("observatory"),
            spot("observatory", "scope", "Telescope", .floor(2.2, 2.2, 0), [
                ("scope", "Telescope", "Points at the same star every night. It isn't on the chart.", 350, 0, .made("telescope")),
                ("big", "The Big One", "Through it, you can see the other house's telescope looking back.", 0, 10, .made("telescope-big")),
            ]),
            spot("observatory", "desk", "Desk", .against(left: true, 2.4), [
                ("desk", "Chart Desk", "Covered in sums. They come out the same every time.", 120, 0, .kit("desk")),
                ("laptop", "Desk and Laptop", "Tracking something. Slowly getting closer.", 260, 0, .stack("desk", "laptop")),
            ]),
            spot("observatory", "seat", "Seat", .against(left: false, 3.2), [
                ("chair", "Stargazer's Chair", "Tips you back until you're looking straight up.", 140, 0, .kit("loungeChairRelax")),
                ("bed", "Camp Bed", "For the long nights.", 200, 0, .kit("bedSingle")),
            ]),
            spot("observatory", "rug", "Rug", .rug(2.3, 2.4), [
                ("moon", "Moon Rug", "The side you don't usually see.", 120, 0, .rug("target", "b9b9c2", "8a8a99")),
                ("space", "Solar System Rug", "With one more planet than you were taught.", 220, 0, .rug("space", "0d1230", "ffcf33")),
            ]),
            spot("observatory", "right", "Right wall", .wall(left: false, 1.7, 2.0), [
                ("window", "Sky Window", "Stars, in daylight.", 0, 4, .window("night")),
                ("rocket", "Rocket Plans", "Detailed. Some parts are from the kitchen.", 80, 0, .art("rocket", "0d1230", "ffe9a3")),
            ]),
            spot("observatory", "corner", "Corner", .floor(0.5, 0.5, 0), [
                ("globe", "Globe of Somewhere Else", "Seas where they shouldn't be.", 0, 4, .made("globe")),
                ("books", "Star Atlases", "Stacked. The bottom one is warm.", 90, 0, .kit("bookcaseOpenLow")),
            ]),
            spot("observatory", "pet", "Pet", .pet(1.4, 3.5), [
                ("polar", "Polar Bear", "Likes the cold up here.", 0, 10, .pet("animal-polar")),
                ("giraffe", "Giraffe", "Nearest to the stars of anyone.", 0, 10, .pet("animal-giraffe")),
                ("lion", "Lion", "Small, for now.", 0, 12, .pet("animal-lion")),
                ("elephant", "Elephant", "Remembers what's behind the basement door.", 0, 12, .pet("animal-elephant")),
            ]),
        ])

    // MARK: Outside

    // MARK: The hall and the landing

    /// What every house has without buying it (HouseLayout.swift): the hall,
    /// with the front door and the stairs in it, and the landing over it
    /// once there's a room upstairs. Their spots are written in metres, as
    /// they are: three across and five back, the stairs down the left.
    static let fixtures: [HouseRoom] = [hall, landing]

    private static let hall = HouseRoom(
        id: "hall", name: "Hall", blurb: "Where the front door is, and the stairs.", cell: [0, 0, 0], gems: 0, stand: [2.0, 3.2],
        spots: [
            walls("hall", ("Linen", "efe6d6", "c2b08f"), [
                ("Sage", "The first thing anyone sees. Calm.", "c9dcc0", "94b08a", 40),
                ("Sky", "As if the door were still open.", "bfe0f2", "8fb9d3", 40),
                ("Terracotta", "Warm from the moment you're in.", "d98e6b", "a9623f", 70),
            ]),
            floors("hall", ("Parquet", "parquet", "c98f55", "9a6a3a"), [
                ("Pale Ash", "Shows where everyone's been.", "boards", "e7d3b0", "cdb388", 60),
                ("Checkers", "Black, white, and the way through.", "checker", "f1ede2", "2f3b55", 110),
            ]),
            wood("hall"),
            fabric("hall"),
            spot("hall", "rug", "Rug", .rug(2.0, 2.3), [
                ("runner", "Runner", "Takes most of what's on a shoe.", 35, 0, .rug("stripes", "2f5f9a", "efe6d6")),
                ("mat", "Welcome Mat", "It means it.", 25, 0, .rug("hatch", "8a6a3f", "c9a36b")),
                ("round", "Round Rug", "For standing on while you find your keys.", 45, 0, .rug("round", "c1502e", "f1d6a8")),
            ]),
            spot("hall", "corner", "By the door", .floor(2.5, 4.45, 0), [
                ("coat", "Coat Stand", "One coat on it that's nobody's.", 50, 0, .kit("coatRackStanding")),
                ("plant", "Hall Plant", "Sees everyone in and everyone out.", 30, 0, .kit("pottedPlant")),
                ("lamp", "Hall Lamp", "Left on for whoever's last home.", 60, 0, .kit("lampRoundFloor")),
            ]),
        ])

    private static let landing = HouseRoom(
        id: "landing", name: "Landing", blurb: "The top of the stairs.", cell: [0, 1, 0], gems: 0, stand: [2.0, 2.4],
        spots: [
            walls("landing", ("Linen", "efe6d6", "c2b08f"), [
                ("Sage", "Quiet, on the way to bed.", "c9dcc0", "94b08a", 40),
                ("Dusk", "It's always nearly bedtime up here.", "5d5f8f", "3e3f66", 90),
            ]),
            floors("landing", ("Parquet", "parquet", "c98f55", "9a6a3a"), [
                ("Pale Ash", "Creaks on the third board. Always the third.", "boards", "e7d3b0", "cdb388", 60),
                ("Blue Carpet", "Quiet enough to creep along.", "carpet", "5b86c4", "4b74b0", 70),
            ]),
            wood("landing"),
            fabric("landing"),
            spot("landing", "rug", "Rug", .rug(2.0, 2.3), [
                ("runner", "Runner", "From the stairs to wherever you're going.", 35, 0, .rug("stripes", "d6263a", "f3ead2")),
                ("round", "Round Rug", "Somewhere to stand and listen downstairs.", 45, 0, .rug("round", "3f8f5a", "cfe6c2")),
            ]),
            spot("landing", "corner", "Corner", .floor(2.5, 4.45, 0), [
                ("books", "Low Shelf", "The books nobody's finished.", 50, 0, .kit("bookcaseOpenLow")),
                ("plant", "Landing Plant", "Watches the stairs.", 30, 0, .kit("pottedPlant")),
                ("bear", "Bear on the Landing", "Halfway to bed. He stopped for a rest.", 50, 0, .kit("bear")),
            ]),
        ])

    /// The outside of the house: not a room, and always theirs. What's put
    /// here is kept like a room's spots ("outside.roof").
    static let outside = HouseRoom(
        id: "outside", name: "Outside", blurb: "What the street sees.", cell: [0, 0, 0], gems: 0, stand: [0, 0],
        spots: [
            spot("outside", "roof", "Roof", .outside, [
                ("tiles", "Red Tiles", "How it came.", 0, 0, .roof("c0574a")),
                ("slate", "Slate", "Grey, and glad of the rain.", 80, 0, .roof("5d6672")),
                ("green", "Green Tiles", "Moss, but on purpose.", 80, 0, .roof("4f8a5b")),
                ("blue", "Blue Tiles", "From above, a small swimming pool.", 90, 0, .roof("3f6fa8")),
                ("pink", "Pink Tiles", "The pigeons have stopped judging.", 100, 0, .roof("e88aa8")),
                ("thatch", "Thatch", "Straw. Keep it away from the campfire.", 120, 0, .roof("d9b45a")),
                ("black", "Black Tiles", "Warm in summer. Very warm.", 120, 0, .roof("2c2c33")),
                ("gold", "Gold Roof", "Can be seen from the other house. And from space.", 0, 5, .roof("f5c542", glow: 0.25)),
            ]),
            spot("outside", "shape", "Roof shape", .outside, [
                ("gable", "Pitched", "How it came. Two slopes and a ridge.", 0, 0, .roofShape("gable")),
                ("flat", "Flat", "Somewhere to stand, if you could get up there.", 100, 0, .roofShape("flat")),
                ("pyramid", "Pointed", "Comes to a point. Birds argue over it.", 150, 0, .roofShape("pyramid")),
                ("steep", "Steep", "Twice the roof. The attic's for whoever asks first.", 180, 0, .roofShape("steep")),
            ]),
            spot("outside", "walls", "Walls", .outside, [
                ("rooms", "As the Rooms Are", "How it came. Every room shows its colour outside.", 0, 0, .cladding("rooms", "", "")),
                ("white", "White Boards", "Painted every spring, by somebody.", 90, 0, .cladding("boards", "f4f1e6", "d3ccb9")),
                ("yellow", "Yellow Boards", "Cheerful from across the road.", 100, 0, .cladding("boards", "f2d16b", "d4b148")),
                ("blue", "Blue Boards", "A house by the sea, wherever it is.", 100, 0, .cladding("boards", "7aa7c9", "5d8cb0")),
                ("black", "Black Boards", "The house the others cross the road for.", 140, 0, .cladding("boards", "33353b", "1f2126")),
                ("brick", "Red Brick", "Warm till long after dark.", 150, 0, .cladding("brick", "b5654a", "dccbb6")),
                ("stone", "Stone", "Each one carried here. Nobody says by whom.", 180, 0, .cladding("stone", "9a9c9f", "6f7175")),
                ("candy", "Candy Stripes", "Do not lick the house.", 0, 4, .cladding("stripes", "f4f1e6", "ef7fa6")),
            ]),
            spot("outside", "door", "Front door", .outside, [
                ("red", "Red Door", "How it came.", 0, 0, .door("b5483b")),
                ("blue", "Blue Door", "Knock twice. Three times means something else.", 60, 0, .door("2f5f9a")),
                ("green", "Green Door", "There's a song about it.", 60, 0, .door("3f7a4a")),
                ("yellow", "Yellow Door", "The post never goes next door by mistake.", 70, 0, .door("f2c230")),
                ("pink", "Pink Door", "Opens for nearly anyone.", 70, 0, .door("ef8fb5")),
                ("black", "Black Door", "With a knocker nobody's lifted.", 80, 0, .door("26262b")),
                ("round", "Round Door", "Perfectly round. It doesn't lead to adventures. Probably.", 0, 3, .door("3f8a4a", round: true)),
            ]),
            spot("outside", "top", "On the roof", .outside, [
                ("flag", "Flag", "For a country of one house.", 60, 0, .made("flag")),
                ("vane", "Weathervane", "Points at the weather. Sometimes at you.", 70, 0, .made("vane")),
                ("chimney", "Chimney", "Smoke goes up. Now and then, something else.", 90, 0, .made("chimney")),
                ("dish", "Satellite Dish", "Picks up the other house's television.", 110, 0, .made("dish")),
                ("beacon", "Lighthouse Lamp", "Turns all night. Ships have started to come.", 0, 5, .made("beacon")),
            ]),
            spot("outside", "lawn", "Front lawn", .outside, [
                ("mailbox", "Mailbox", "Post comes. It's always for someone called Occupant.", 50, 0, .made("mailbox")),
                ("snowman", "Snowman", "Doesn't melt. Has stopped asking why.", 70, 0, .made("snowman")),
                ("flamingos", "Flamingos", "Two. There were three.", 80, 0, .made("flamingos")),
                ("saucer", "Flying Saucer, Parked", "Somebody's visiting. They've been in there a while.", 0, 6, .made("saucer")),
            ]),
        ] + outsideMore)
}
