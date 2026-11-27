import Foundation

// The rest of the catalogue: the rooms of a dream home (a game room, a
// cinema, a music room, a library, a workshop, a loft and a room nobody's
// meant to find), and the yard: the things that go out on the grass, each
// with a price of its own, and the back field to put them in.
//
// Prices are on the same scale as the first rooms' (HouseCatalog.swift:
// about 300 coins for a good day). The rooms here are bought like any other,
// each dearer than the last. In the yard the small things are a few days and
// the big ones (the pool, the ball field, the field itself) are a couple of
// weeks each: something to keep earning towards.
//
// A yard thing's spots are written in metres from its north-west corner. Its
// first spot is the thing itself (the pool, the deck), which comes with it.

extension HouseCatalog {
    /// What the back field costs: ten metres more land behind the lot.
    static let fieldPrice = 3000

    /// Every room and yard thing there is to buy, and the hall and landing.
    static let everything: [HouseRoom] = rooms + yard + fixtures

    // MARK: The rooms of a dream home

    static let more: [HouseRoom] = [gameroom, cinema, music, library, workshop, loft, secret]

    private static let gameroom = HouseRoom(
        id: "gameroom", name: "Game Room", blurb: "Machines along one wall, a table in the middle, and no clock.", cell: [0, 0, 0], gems: 0, stand: [2.9, 3.4],
        spots: [
            walls("gameroom", ("Midnight", "23284a", "151832"), [
                ("Arcade Purple", "The colour behind your eyelids after a long game.", "5b3f8f", "3b2866", 90),
                ("Neon Pink", "Can be heard from the hall.", "e2459a", "a82c70", 120),
                ("Slate", "So the machines do the talking.", "6b7280", "4b5563", 60),
            ]),
            floors("gameroom", ("Dark Carpet", "carpet", "2f3140", "292b38"), [
                ("Arcade Carpet", "Shapes from another decade, having a party.", "arcade", "1b1b3a", "ff3fa4", 220),
                ("Checkers", "The finish line, everywhere.", "checker", "f1ede2", "20242c", 110),
                ("Dark Boards", "Every dropped coin rolls to the same corner.", "boards", "5a4032", "45301f", 80),
                ("Lava", "The floor is. Mind the furniture.", "lava", "2a1410", "ff6a1f", 260),
            ]),
            wood("gameroom"),
            fabric("gameroom"),
            spot("gameroom", "machine1", "First machine", .against(left: false, 0.67), [
                ("cabinet", "Arcade Cabinet", "One game. The high score is three letters you didn't choose.", 400, 0, .model("arcade", "arcade-machine", 2.2)),
                ("vending", "Vending Machine", "Gives you the one next to the one you pressed.", 300, 0, .model("arcade", "vending-machine", 2.2)),
                ("tickets", "Ticket Machine", "Pays out in tickets. The tickets buy more tickets.", 250, 0, .model("arcade", "ticket-machine", 2.0)),
            ]),
            spot("gameroom", "machine2", "Second machine", .against(left: false, 1.6), [
                ("stereo", "Stereo", "Tuned to a station that only plays the one song.", 150, 0, .stack("cabinetTelevision", "radio")),
                ("pinball", "Pinball", "The ball knows where the gap is.", 700, 0, .model("arcade", "pinball", 2.2)),
                ("claw", "Claw Machine", "It has let go of every prize but one. It's saving that.", 800, 0, .model("arcade", "claw-machine", 2.1)),
            ]),
            spot("gameroom", "machine3", "Third machine", .against(left: false, 2.53), [
                ("speaker", "Tall Speaker", "You feel it in your teeth.", 130, 0, .kit("speaker")),
                ("hoops", "Hoop Shoot", "Counts down from sixty. Sometimes from sixty-one.", 650, 0, .model("arcade", "basketball-game", 2.1)),
                ("dance", "Dance Machine", "The arrows have never asked for anything reasonable.", 750, 0, .model("arcade", "dance-machine", 2.0)),
                ("skeeball", "Skee-Ball", "Nine balls. You'll count eight.", 600, 0, .made("skeeball")),
            ]),
            spot("gameroom", "machine4", "Fourth machine", .against(left: false, 3.47), [
                ("jukebox", "Jukebox", "Plays what you were about to pick.", 600, 0, .made("jukebox")),
                ("wheel", "Prize Wheel", "Lands on the same wedge. The wedge is blank.", 500, 0, .model("arcade", "prize-wheel", 2.2)),
                ("prizes", "Prize Shelf", "Everything costs one more ticket than you have.", 300, 0, .model("arcade", "prizes", 2.0)),
            ]),
            spot("gameroom", "table", "Big table", .floor(2.13, 2.32, 0), [
                ("cards", "Card Table", "Somebody's dealt. You're in.", 80, 0, .kit("tableRound")),
                ("pool", "Pool Table", "The eight ball is warm.", 900, 0, .made("pool-table")),
                ("hockey", "Air Hockey", "The puck hovers when it's switched off, too.", 700, 0, .model("arcade", "air-hockey", 2.2)),
                ("pingpong", "Ping-Pong", "Somebody returns the serve. You're the only one here.", 600, 0, .made("ping-pong")),
            ]),
            spot("gameroom", "play", "By the door", .floor(3.47, 3.44, 0), [
                ("beanbag", "Bean Bag", "For whoever's waiting for a turn.", 120, 0, .made("bean-bag")),
                ("foosball", "Foosball", "Eleven a side. One of yours is facing the wrong way on purpose.", 450, 0, .made("foosball")),
                ("vr", "VR Pod", "Put the headset on and you're in a room exactly like this one.", 800, 0, .made("vr-pod")),
            ]),
            spot("gameroom", "rig", "Racing rig", .against(left: true, 3.2), [
                ("chair", "Gaming Chair", "Leans back further than is wise.", 80, 0, .kit("chairDesk")),
                ("rig", "Racing Rig", "The road on the screen goes somewhere you've been.", 900, 0, .made("racing-rig")),
            ]),
            spot("gameroom", "seat", "Seat", .against(left: true, 1.6), [
                ("beanbag", "Bean Bag", "Holds the shape of whoever sat in it last.", 120, 0, .made("bean-bag")),
                ("giant", "Giant Bean Bag", "You don't sit in it. You're admitted.", 260, 0, .made("bean-bag-giant")),
                ("sofa", "Sofa and Footstool", "For whoever's got next.", 200, 0, .kit("loungeSofaOttoman")),
            ]),
            spot("gameroom", "left", "Left wall", .wall(left: true, 1.6, 2.1), [
                ("neon", "GAME ON Sign", "Hums one note. You'll find yourself humming it.", 220, 0, .made("neon-game")),
                ("star", "Neon Star", "Brighter when somebody's winning.", 180, 0, .made("neon-star")),
                ("darts", "Dartboard", "Three darts in it. Nobody's ever thrown them.", 90, 0, .made("dartboard")),
            ]),
            spot("gameroom", "light", "Ceiling", .ceiling(2.13, 2.32), [
                ("disco", "Disco Ball", "Turns slowly, like it's looking for someone.", 300, 0, .made("disco-ball")),
            ]),
        ])

    private static let cinema = HouseRoom(
        id: "cinema", name: "Home Cinema", blurb: "A screen the size of the wall. The film's already started.", cell: [0, 0, 0], gems: 0, stand: [3.4, 3.0],
        spots: [
            walls("cinema", ("Charcoal", "3a3d46", "25272e"), [
                ("Curtain Red", "Velvet, all the way round. It moves when the film gets tense.", "8f1a22", "5a0f14", 150),
                ("Midnight", "So dark the screen looks further away than the wall.", "171a2e", "0d0f1c", 100),
            ]),
            floors("cinema", ("Dark Carpet", "carpet", "2b2d36", "25272f"), [
                ("Red Carpet", "You've arrived.", "carpet", "b5332e", "a22a26", 90),
                ("Night Sky", "Little lights in the floor, to find your seat by.", "stars", "0d1230", "ffe9a3", 250),
            ]),
            wood("cinema"),
            fabric("cinema"),
            spot("cinema", "screen", "Screen", .wall(left: false, 2.0, 1.55), [
                ("screen", "The Big Screen", "How it came. It's always the good bit.", 0, 0, .made("big-screen")),
            ]),
            spot("cinema", "seats", "Front row", .floor(2.0, 2.4, 2), [
                ("seats", "Cinema Seats", "Three. The middle one's always warm.", 500, 0, .made("cinema-seats")),
                ("gold", "Gold Recliners", "Tip back until you're watching the ceiling. It has a film on too.", 0, 6, .made("cinema-seats-gold")),
                ("sofa", "Long Sofa", "Room for everyone, and whoever that is at the end.", 250, 0, .kit("loungeSofaLong")),
            ]),
            spot("cinema", "back", "Back row", .floor(2.0, 3.5, 2), [
                ("seats", "Cinema Seats", "For those who like to see who's in front.", 500, 0, .made("cinema-seats")),
                ("beanbags", "Giant Bean Bag", "The best seat. Getting out of it is the sequel.", 260, 0, .made("bean-bag-giant")),
            ]),
            spot("cinema", "snacks", "Snacks", .against(left: true, 3.3), [
                ("popcorn", "Popcorn Machine", "Never empty. Never seen being filled.", 350, 0, .made("popcorn")),
                ("candy", "Sweet Stand", "One jar is full of a colour that isn't a flavour.", 300, 0, .made("candy-stand")),
            ]),
            spot("cinema", "left", "Left wall", .wall(left: true, 1.5, 1.9), [
                ("monster", "Monster Poster", "COMING SOON, it says. It's said that for years.", 80, 0, .made("movie-poster")),
                ("space", "Space Poster", "The tagline is in a language from the film.", 80, 0, .made("movie-poster-space")),
            ]),
            spot("cinema", "projector", "Ceiling", .ceiling(2.0, 3.0), [
                ("projector", "Projector", "Dust turns in its light, in order.", 300, 0, .made("projector")),
            ]),
            spot("cinema", "corner", "Corner", .floor(0.4, 0.45, 0), [
                ("speaker", "Tall Speaker", "You hear the film in your knees.", 130, 0, .kit("speaker")),
                ("plant", "Cinema Plant", "Has seen every film. Prefers the old ones.", 30, 0, .kit("pottedPlant")),
            ]),
        ])

    private static let music = HouseRoom(
        id: "music", name: "Music Room", blurb: "Loud on purpose. The walls have agreed to it.", cell: [0, 0, 0], gems: 0, stand: [3.3, 3.3],
        spots: [
            walls("music", ("Studio Grey", "c9ccd2", "9a9ea6"), [
                ("Stage Black", "So all you see is the band.", "25262b", "15161a", 90),
                ("Sunburst", "The colour of the last chord.", "f0a23a", "c97d1f", 80),
                ("Record Blue", "Side two, track one.", "2f5f9a", "214670", 80),
            ]),
            floors("music", ("Boards", "boards", "b98455", "9a6a3f"), [
                ("Stage", "Black, scuffed where the singer stands.", "boards", "2c2a2a", "1c1a1a", 90),
                ("Checkers", "Ska, as a floor.", "checker", "f1ede2", "20242c", 110),
                ("Red Carpet", "For walking on to applause.", "carpet", "b5332e", "a22a26", 90),
            ]),
            wood("music"),
            fabric("music"),
            spot("music", "piano", "Keys", .against(left: false, 1.3), [
                ("keyboard", "Keyboard", "Has a button marked DEMO. Don't.", 250, 0, .made("keyboard")),
                ("piano", "Upright Piano", "One key plays a note from a different song.", 600, 0, .made("piano")),
                ("grand", "Grand Piano", "Lid up. Something inside is listening.", 0, 8, .made("grand-piano")),
            ]),
            spot("music", "drums", "Drums", .floor(3.0, 1.4, 2), [
                ("drums", "Drum Kit", "Keeps time by itself for a bar after you stop.", 700, 0, .made("drums")),
                ("amps", "Amp Stack", "Goes to eleven. Eleven's taped over.", 300, 0, .made("amp-stack")),
            ]),
            spot("music", "guitar", "Guitar", .against(left: true, 1.2), [
                ("acoustic", "Guitar", "In tune, always. Nobody tunes it.", 180, 0, .made("guitar")),
                ("electric", "Electric Guitar", "Red. Plugged in. Humming to itself.", 350, 0, .made("electric-guitar")),
            ]),
            spot("music", "mic", "Middle", .floor(2.1, 2.8, 0), [
                ("mic", "Microphone", "On. It's always on.", 120, 0, .made("mic")),
            ]),
            spot("music", "player", "Records", .against(left: true, 2.9), [
                ("records", "Record Player", "The record's by a band you're going to like.", 220, 0, .made("record-player")),
                ("speaker", "Tall Speaker", "Faces the neighbours.", 130, 0, .kit("speaker")),
            ]),
            spot("music", "right", "Right wall", .wall(left: false, 3.2, 2.0), [
                ("gold", "Gold Record", "For a million copies of a song you haven't written yet.", 0, 4, .made("gold-record")),
                ("pennants", "Tour Pennants", "Every city. Some of them twice.", 40, 0, .art("pennants", "d6263a", "f5c542")),
            ]),
            spot("music", "rug", "Rug", .rug(2.2, 2.7), [
                ("round", "Round Rug", "Where the drummer's foot goes.", 45, 0, .rug("round", "7a4a8f", "e9d7b0")),
                ("zigzag", "Zigzag Rug", "A soundwave somebody walked on.", 90, 0, .rug("zigzag", "20242c", "f3ead2")),
            ]),
        ])

    private static let library = HouseRoom(
        id: "library", name: "Library", blurb: "More books than the house has days. Quiet, mostly.", cell: [0, 0, 0], gems: 0, stand: [3.3, 3.3],
        spots: [
            walls("library", ("Old Green", "3f6b57", "2a4a3c"), [
                ("Leather Red", "The colour of a book nobody's allowed to borrow.", "7a2f2a", "55201c", 90),
                ("Parchment", "Looks written on, from across the room.", "ead9b0", "c4ae7c", 60),
                ("Ink", "Dark enough to lose your place.", "1f2a44", "141b2e", 100),
            ]),
            floors("library", ("Dark Boards", "boards", "6b4a32", "523623"), [
                ("Herringbone", "Laid by someone who never once lost count.", "parquet", "b98455", "8f6238", 140),
                ("Green Carpet", "Swallows footsteps whole.", "carpet", "2f5d4a", "285241", 80),
            ]),
            wood("library"),
            fabric("library"),
            spot("library", "shelves", "Back wall", .against(left: false, 1.5), [
                ("case", "Bookcase", "The books rearrange themselves by mood.", 100, 0, .kit("bookcaseOpen")),
                ("ladder", "Ladder Shelves", "The ladder's never where you left it.", 500, 0, .made("ladder-shelves")),
                ("secret", "A Bookcase, Ajar", "Pull the right book. It's the green one. They're all green.", 0, 5, .made("secret-bookcase")),
            ]),
            spot("library", "fire", "Fireplace", .against(left: false, 3.3), [
                ("plant", "Tall Plant", "Has read everything on the bottom shelf.", 60, 0, .kit("Houseplant_3")),
                ("fire", "Fireplace", "Lit. It reads over your shoulder.", 450, 0, .kit("Fireplace")),
                ("clock", "Grandfather Clock", "Right twice a day. Wrong in an interesting way the rest.", 400, 0, .made("grandfather-clock")),
            ]),
            spot("library", "nook", "Nook", .against(left: true, 1.4), [
                ("nook", "Reading Nook", "Sit down for a page. Get up at dusk.", 250, 0, .made("reading-nook")),
                ("chair", "Armchair", "Shaped like someone who reads.", 150, 0, .kit("loungeChair")),
                ("beanbag", "Bean Bag", "For books with pictures.", 120, 0, .made("bean-bag")),
            ]),
            spot("library", "shelves2", "Left wall", .against(left: true, 3.0), [
                ("cupboard", "Glass Cupboard", "For the books that bite.", 140, 0, .kit("bookcaseClosedDoors")),
                ("low", "Low Shelf", "The ones you can reach.", 50, 0, .kit("bookcaseOpenLow")),
            ]),
            spot("library", "desk", "Middle", .floor(2.3, 2.6, 0), [
                ("desk", "Reading Desk", "Someone's left a bookmark in the desk.", 90, 0, .kit("desk")),
                ("table", "Round Table", "For spreading a map out and pointing.", 80, 0, .kit("tableRound")),
            ]),
            spot("library", "stack", "Corner", .floor(3.6, 0.45, 0), [
                ("stack", "Stack of Books", "The one at the bottom is the one you want.", 60, 0, .made("book-stack")),
                ("lamp", "Reading Lamp", "Leans in.", 60, 0, .kit("lampRoundFloor")),
                ("globe", "Globe", "One of the countries isn't on other globes.", 0, 3, .made("globe")),
            ]),
            spot("library", "rug", "Rug", .rug(2.3, 2.7), [
                ("round", "Round Rug", "Worn where the pacing happens.", 45, 0, .rug("round", "6b2a2a", "c9a36b")),
                ("check", "Tartan Rug", "From a library further north.", 70, 0, .rug("check", "2f5d4a", "c9a36b")),
            ]),
        ])

    private static let workshop = HouseRoom(
        id: "workshop", name: "Workshop", blurb: "For making things, and for finding out what they are afterwards.", cell: [0, 0, 0], gems: 0, stand: [3.3, 3.4],
        spots: [
            walls("workshop", ("Workshop Grey", "b9bcc0", "8a8e93"), [
                ("Safety Yellow", "So you can find the walls in a hurry.", "f2c230", "c99b1a", 70),
                ("Brick", "Has seen sparks.", "b5654a", "8a4530", 120),
                ("Blueprint", "Covered in plans, if you look closely. Don't look closely.", "2a5a9a", "1c4070", 110),
            ]),
            floors("workshop", ("Concrete", "carpet", "8d9095", "84878c"), [
                ("Checker Plate", "Rings when you drop things. You'll drop things.", "tiles", "9aa0a8", "7c828a", 90),
                ("Hazard Stripes", "Stand behind the line. All of it is the line.", "hazard", "f2c230", "20242c", 160),
            ]),
            wood("workshop"),
            spot("workshop", "bench", "Bench", .against(left: false, 1.4), [
                ("bench", "Workbench", "Scarred by projects that worked.", 200, 0, .model("camp", "workbench", 4.4)),
                ("desk", "Drawing Desk", "For the part where it's still a good idea.", 90, 0, .kit("desk")),
            ]),
            spot("workshop", "right", "Over the bench", .wall(left: false, 1.4, 2.0), [
                ("pegboard", "Pegboard", "An outline for every tool. One outline is for something else.", 120, 0, .made("pegboard")),
                ("pipes", "Pipes", "They knock back if you knock.", 80, 0, .art("pipes", "6b6d70", "b5654a")),
            ]),
            spot("workshop", "project", "Project", .floor(2.3, 2.7, 0), [
                ("box", "Box of Parts", "Some of them are from the kitchen.", 40, 0, .kit("cardboardBoxOpen")),
                ("robot", "Robot, Nearly", "One arm to go. It's holding the screwdriver for you.", 700, 0, .made("robot")),
                ("kart", "Go-Kart Frame", "No engine yet. It's moved twice.", 800, 0, .made("go-kart-frame")),
                ("rocket", "Model Rocket", "Model. That's what it says on the side.", 600, 0, .made("rocket-model")),
            ]),
            spot("workshop", "printer", "Printer", .against(left: true, 1.3), [
                ("shelf", "Parts Shelf", "Sorted by a system. Not yours.", 100, 0, .kit("bookcaseOpen")),
                ("printer", "3D Printer", "Halfway through printing something you didn't send it.", 500, 0, .made("printer3d")),
            ]),
            spot("workshop", "chest", "Tools", .against(left: true, 2.9), [
                ("chest", "Tool Chest", "The bottom drawer's locked from the inside.", 250, 0, .made("tool-chest")),
                ("barrel", "Barrel of Bits", "Every screw that was ever left over.", 50, 0, .model("camp", "barrel", 3.0)),
            ]),
            spot("workshop", "corner", "Corner", .floor(3.6, 0.5, 0), [
                ("cone", "Traffic Cone", "Borrowed.", 20, 0, .model("cars", "cone", 1.2)),
                ("bucket", "Bucket", "Catches the drip. There's no drip.", 25, 0, .model("camp", "bucket", 3.0)),
                ("lamp", "Work Lamp", "Shows you exactly what you did.", 60, 0, .kit("lampSquareFloor")),
            ]),
        ])

    private static let loft = HouseRoom(
        id: "loft", name: "Loft", blurb: "A room with no job. The best one in the house.", cell: [0, 0, 0], gems: 0, stand: [3.3, 3.2],
        spots: [
            walls("loft", ("White", "f1efe8", "cfcabb"), [
                ("Brick", "The house's own, left showing.", "b5654a", "8a4530", 120),
                ("Sky", "As near as indoors gets.", "bfe0f2", "8fb9d3", 40),
                ("Sunset", "It's always just after seven up here.", "f0986b", "c56d45", 80),
            ]),
            floors("loft", ("Pale Boards", "boards", "e2c896", "c9ab74"), [
                ("Herringbone", "Zigs. Then, reliably, zags.", "parquet", "c98f55", "9a6a3a", 140),
                ("Cream Carpet", "Shoes off. It knows.", "carpet", "ece3cf", "e2d8c2", 80),
            ]),
            wood("loft"),
            fabric("loft"),
            spot("loft", "sofa", "Sofa", .against(left: true, 2.0), [
                ("sofa", "Long Sofa", "You sit down at one end and wake up at the other.", 250, 0, .kit("loungeSofaLong")),
                ("corner", "Corner Sofa", "Has a corner for everyone and one spare.", 400, 0, .kit("loungeDesignSofaCorner")),
                ("beanbag", "Giant Bean Bag", "A sofa that's given up, happily.", 260, 0, .made("bean-bag-giant")),
            ]),
            spot("loft", "table", "Coffee table", .floor(1.6, 2.0, 1), [
                ("glass", "Glass Table", "Things put on it look as if they're floating. One is.", 120, 0, .kit("tableCoffeeGlassSquare")),
                ("wood", "Coffee Table", "Rings on it from cups nobody remembers.", 80, 0, .kit("tableCoffee")),
            ]),
            spot("loft", "tv", "Back wall", .against(left: false, 1.6), [
                ("tv", "Television", "Turns itself to the channel with the weather for somewhere else.", 300, 0, .stack("cabinetTelevision", "televisionModern")),
                ("bar", "Juice Bar", "Somebody's already poured you one.", 350, 0, .kit("kitchenBar")),
                ("fire", "Fireplace", "The chimney goes up further than the roof does.", 450, 0, .kit("Fireplace")),
            ]),
            spot("loft", "game", "Open floor", .floor(3.0, 2.8, 0), [
                ("beanbag", "Bean Bag", "Moves nearer the window on its own, over a week.", 120, 0, .made("bean-bag")),
                ("pingpong", "Ping-Pong", "The net's a little higher on your side.", 600, 0, .made("ping-pong")),
                ("foosball", "Foosball", "The goalkeeper's been practising.", 450, 0, .made("foosball")),
                ("telescope", "Telescope", "Points at the other house. Force of habit.", 350, 0, .made("telescope")),
            ]),
            spot("loft", "plant", "Corner", .floor(3.6, 0.5, 0), [
                ("palm", "Tall Plant", "Grown since you came in.", 60, 0, .kit("Houseplant_3")),
                ("fern", "Fern", "Unfurls when it thinks you're not looking.", 40, 0, .kit("Houseplant_5")),
                ("lamp", "Floor Lamp", "For the last chapter.", 60, 0, .kit("lampRoundFloor")),
            ]),
            spot("loft", "light", "Ceiling", .ceiling(2.0, 2.3), [
                ("chandelier", "Chandelier", "Tinkles when nobody's walking about upstairs. There's no upstairs.", 280, 0, .kit("Light_Chandelier")),
                ("disco", "Disco Ball", "For when the loft finds its job.", 300, 0, .made("disco-ball")),
            ]),
            spot("loft", "rug", "Rug", .rug(1.7, 2.1), [
                ("stripe", "Striped Rug", "Points at the sofa.", 35, 0, .rug("stripes", "2f5f9a", "efe6d6")),
                ("round", "Round Rug", "The middle of nothing in particular.", 45, 0, .rug("round", "e0a82e", "f6f1e2")),
            ]),
            spot("loft", "left", "Left wall", .wall(left: true, 3.4, 2.1), [
                ("star", "Neon Star", "On all night. The moths have it on a rota.", 180, 0, .made("neon-star")),
                ("ufo", "UFO Poster", "It wants to believe in you.", 55, 0, .art("ufo", "1b2550", "7dff3a")),
            ]),
        ])

    private static let secret = HouseRoom(
        id: "secret", name: "The Secret Room", blurb: "It isn't on the plans. It was here before the house.", cell: [0, 0, 0], gems: 15, stand: [3.2, 3.3],
        spots: [
            walls("secret", ("Old Stone", "6f7175", "4b4d50"), [
                ("Candlelit", "Warm, and it flickers, and there are no candles.", "8a5a2f", "5e3b1c", 150),
                ("Deep Purple", "The colour things are just before you see them.", "3b2866", "241640", 150),
            ]),
            floors("secret", ("Flagstones", "tiles", "7c7e82", "5f6165"), [
                ("Zigzag", "Black and white, and not quite still.", "zigzag", "f3ead2", "20242c", 250),
                ("Night Sky", "You're standing on it. Try not to think about that.", "stars", "0d1230", "ffe9a3", 250),
            ]),
            spot("secret", "portal", "Far wall", .wall(left: false, 2.0, 1.35), [
                ("portal", "The Portal", "Goes somewhere. It's polite enough not to say where.", 0, 6, .made("portal")),
            ]),
            spot("secret", "treasure", "Treasure", .floor(3.3, 0.9, 0), [
                ("chest", "Treasure Chest", "Open. Full. Count it twice and it's more.", 500, 0, .made("treasure")),
            ]),
            spot("secret", "table", "Middle", .floor(2.0, 2.4, 0), [
                ("map", "Map Table", "The X is in this room. It's moved since yesterday.", 300, 0, .made("map-table")),
                ("ball", "Crystal Ball", "Shows you this room, a minute from now.", 250, 0, .made("crystal-ball")),
            ]),
            spot("secret", "armor", "Guard", .against(left: true, 1.2), [
                ("armor", "Suit of Armour", "Empty. It salutes anyway.", 400, 0, .made("armor")),
            ]),
            spot("secret", "case", "Bookcase", .against(left: true, 3.0), [
                ("case", "A Bookcase, Ajar", "This is the other side of it.", 350, 0, .made("secret-bookcase")),
            ]),
            spot("secret", "light", "Ceiling", .ceiling(2.0, 2.2), [
                ("bulb", "Bare Bulb", "Swings a little. Nothing's touching it.", 30, 0, .made("bulb")),
                ("chandelier", "Chandelier", "Every candle lit. Nobody has matches.", 280, 0, .kit("Light_Chandelier")),
            ]),
            spot("secret", "pet", "Pet", .pet(1.0, 3.4), [
                ("parrot", "Parrot", "Knows one word. It's your name.", 0, 6, .pet("animal-parrot")),
                ("fox", "Fox", "Let itself in.", 0, 6, .pet("animal-fox")),
                ("monkey", "Monkey", "Has the key. Won't say to what.", 0, 8, .pet("animal-monkey")),
            ]),
        ])

    // MARK: More of the outside

    /// The rest of what the street sees (after the roof, the walls and the front door, HouseCatalog.outside):
    /// the fence, a porch, what's planted under the windows, what stands by the road and in the front
    /// garden, and how the windows and the doors indoors are made.
    static let outsideMore: [HouseSpot] = [
        spot("outside", "porch", "Porch", .outside, [
            ("awning", "Awning", "Striped. Keeps the rain off whoever's finding their keys.", 200, 0, .made("porch-awning")),
            ("porch", "Porch", "Somewhere to stand and be nearly home.", 300, 0, .made("porch")),
            ("pergola", "Pergola", "The vines got here first.", 400, 0, .made("porch-pergola")),
            ("columns", "Columns", "The house thinks it's a bank.", 500, 0, .made("porch-columns")),
        ]),
        spot("outside", "windows", "Windows", .outside, [
            ("plain", "Plain Windows", "How they came.", 0, 0, .style("plain")),
            ("grid", "Cottage Panes", "Six small views of the same thing.", 80, 0, .style("grid")),
            ("shutters", "Shutters", "Never shut. It's the thought.", 120, 0, .style("shutters")),
            ("boxes", "Window Boxes", "Geraniums. They lean out to watch the road.", 140, 0, .style("boxes")),
        ]),
        spot("outside", "beds", "Under the windows", .outside, [
            ("veg", "Cabbages and Canes", "Dinner, eventually.", 100, 0, .made("bed-veg")),
            ("tulips", "Tulips", "In rows, at attention.", 120, 0, .made("bed-tulips")),
            ("hedge", "Clipped Hedge", "Two perfect balls. Somebody comes at night with shears.", 140, 0, .made("bed-hedge")),
            ("roses", "Roses", "Thorns on the inside too.", 160, 0, .made("bed-roses")),
        ]),
        spot("outside", "fence", "Fence", .outside, [
            ("picket", "White Picket", "How it came.", 0, 0, .fence("picket", "f6f1e4")),
            ("none", "No Fence", "The lawn just stops, on trust.", 30, 0, .fence("none", "")),
            ("rail", "Ranch Rail", "Keeps horses in. You have no horses. It's working.", 60, 0, .fence("rail", "8a5a3a")),
            ("blue", "Blue Picket", "Painted to match a sky from another day.", 60, 0, .fence("picket", "7aa7c9")),
            ("hedge", "Hedge", "Taller than last week.", 120, 0, .fence("hedge", "4f8a4a")),
            ("stone", "Stone Wall", "Each one carried here. Nobody says by whom.", 150, 0, .fence("stone", "9a9c9f")),
        ]),
        spot("outside", "kerb", "By the road", .outside, [
            ("hydrant", "Fire Hydrant", "Dogs come from other streets.", 60, 0, .made("hydrant")),
            ("bench", "Park Bench", "For watching the street go by. It does, slowly.", 100, 0, .made("bench-park")),
            ("lamp", "Street Lamp", "Comes on a minute before it's dark, to be sure.", 150, 0, .made("street-lamp")),
            ("modern", "Modern Lamp", "Leans over to see what you're doing.", 150, 0, .made("street-lamp-modern")),
            ("bikes", "Bikes", "Two. Left exactly where they were dropped.", 250, 0, .made("bikes")),
            ("lemonade", "Lemonade Stand", "Open. Nobody's serving. The jug's full.", 300, 0, .made("lemonade-stand")),
            ("hoop", "Driveway Hoop", "The net's still swinging.", 350, 0, .made("basketball-hoop")),
        ]),
        spot("outside", "garden", "Front garden", .outside, [
            ("barrow", "Wheelbarrow", "Halfway through a job since spring.", 80, 0, .made("wheelbarrow")),
            ("sprinkler", "Sprinkler", "Gets you on the way past. Every time.", 90, 0, .made("sprinkler")),
            ("bath", "Bird Bath", "One bird. Regular.", 120, 0, .made("bird-bath")),
            ("fountain", "Fountain", "Throw a coin in. Not one of yours.", 600, 0, .made("fountain")),
        ]),
        spot("outside", "doors", "Doors indoors", .outside, [
            ("plain", "Plain Doors", "How they came.", 0, 0, .style("Door_1")),
            ("two", "Second Sort of Door", "Like the first, but it's had a think.", 70, 0, .style("Door_2")),
            ("four", "Fourth Sort of Door", "Shuts with a sound like a full stop.", 80, 0, .style("Door_4")),
            ("six", "Sixth Sort of Door", "Opens the other way when you're carrying something.", 90, 0, .style("Door_6")),
            ("eight", "Eighth Sort of Door", "For rooms with something to say.", 110, 0, .style("Door_8")),
        ]),
    ]

    // MARK: The yard

    static let yard: [HouseRoom] = [deck, vegpatch, driveway, court, campsite, trampoline, playground, skatepark, treehouse, pool, diamond]

    private static let pool = HouseRoom(
        id: "pool", name: "Swimming Pool", blurb: "Blue, and cold for exactly one second.", cell: [0, 0, 0], gems: 0, stand: [2.6, 0.5],
        spots: [
            spot("pool", "pool", "Pool", .floor(4.5, 3.0, 0), [
                ("pool", "Swimming Pool", "How it came. The deep end is deeper than the shallow end is long.", 0, 0, .made("pool")),
                ("lagoon", "Lagoon", "Rocks, a waterfall, and something that might be a fish.", 900, 0, .made("pool-lagoon")),
                ("hot", "Hot Spring", "Steams all year. Nobody's found where the heat comes from.", 0, 8, .made("pool-hot")),
            ]),
            spot("pool", "float", "In the water", .floor(5.6, 3.2, 0), [
                ("ring", "Pink Ring", "Drifts toward whoever's reading.", 60, 0, .made("float-ring")),
                ("duck", "Giant Duck", "Big enough to have opinions.", 140, 0, .made("float-duck")),
                ("flamingo", "Flamingo", "The third one. So that's where it went.", 160, 0, .made("float-flamingo")),
            ]),
            spot("pool", "slide", "Deep end", .floor(1.3, 3.0, 1), [
                ("board", "Diving Board", "Still bouncing from the last one in.", 250, 0, .made("diving-board")),
                ("slide", "Water Slide", "Faster the second time. Nobody knows why.", 450, 0, .made("pool-slide")),
            ]),
            spot("pool", "lounger", "Poolside", .floor(3.2, 0.5, 1), [
                ("lounger", "Sun Lounger", "For supervising.", 180, 0, .made("lounger")),
                ("chair", "Deck Chair", "Folds, in theory.", 150, 0, .kit("loungeChairRelax")),
            ]),
            spot("pool", "parasol", "Shade", .floor(5.6, 0.5, 0), [
                ("parasol", "Parasol", "The shade's a little cooler than shade should be.", 120, 0, .made("parasol")),
                ("plant", "Poolside Palm", "Thinks it's on holiday.", 60, 0, .kit("Houseplant_3")),
            ]),
        ], coins: 4000)

    private static let deck = HouseRoom(
        id: "deck", name: "Deck", blurb: "Boards, a rail, and the smell of someone else's barbecue.", cell: [0, 0, 0], gems: 0, stand: [2.2, 2.3],
        spots: [
            spot("deck", "deck", "Deck", .floor(2.0, 1.5, 0), [
                ("deck", "Deck", "How it came. One board creaks. It's never the same one.", 0, 0, .made("deck")),
            ]),
            spot("deck", "grill", "Cooking", .floor(0.9, 1.1, 0), [
                ("bbq", "Barbecue", "The sausages are done. They've been done for a while. They're fine.", 200, 0, .made("bbq")),
                ("firepit", "Fire Pit", "For marshmallows, and for staring.", 320, 0, .made("firepit")),
                ("tub", "Hot Tub", "Bubbles when there's nobody in it. Especially then.", 900, 0, .made("hot-tub")),
            ]),
            spot("deck", "seat", "Seat", .floor(3.1, 1.8, 3), [
                ("bench", "Garden Bench", "Faces the house, to keep an eye on it.", 60, 0, .kit("bench")),
                ("chair", "Deck Chair", "The deck's own.", 150, 0, .kit("loungeChairRelax")),
                ("lounger", "Sun Lounger", "Horizontal, on principle.", 180, 0, .made("lounger")),
            ]),
            spot("deck", "shade", "Corner", .floor(3.3, 0.6, 0), [
                ("parasol", "Parasol", "Up whatever the weather. It likes to be ready.", 120, 0, .made("parasol")),
                ("pot", "Big Pot", "Something's growing in it that nobody planted.", 30, 0, .kit("pottedPlant")),
                ("lamp", "Deck Lamp", "For the part of the evening after the midges.", 60, 0, .kit("lampRoundFloor")),
            ]),
        ], coins: 600)

    private static let treehouse = HouseRoom(
        id: "treehouse", name: "Tree House", blurb: "Up a tree that was waiting for one.", cell: [0, 0, 0], gems: 0, stand: [0.8, 3.5],
        spots: [
            spot("treehouse", "treehouse", "Tree house", .floor(2.0, 2.0, 0), [
                ("house", "Tree House", "How it came. Password required. The password is the password.", 0, 0, .made("treehouse")),
                ("pirate", "Pirate Lookout", "Flies a flag. Sees the whole street, and one ship.", 700, 0, .made("treehouse-pirate")),
                ("rocket", "Rocket in a Tree", "It landed there. It's happy there. Don't press anything.", 0, 8, .made("treehouse-rocket")),
            ]),
            spot("treehouse", "foot", "At the foot", .floor(3.5, 3.4, 0), [
                ("log", "Sitting Log", "For whoever's not allowed up yet.", 40, 0, .model("camp", "tree-log", 1.6)),
                ("chest", "Buried Chest, Dug Up", "Holds the club's funds: a marble and a key.", 150, 0, .model("camp", "chest", 3.0)),
                ("sign", "Keep Out Sign", "Means you. Not you. The other one.", 30, 0, .model("camp", "signpost", 3.0)),
            ]),
        ], coins: 2500)

    private static let trampoline = HouseRoom(
        id: "trampoline", name: "Trampoline", blurb: "Up is free. Down's included.", cell: [0, 0, 0], gems: 0, stand: [1.5, 1.5],
        spots: [
            spot("trampoline", "trampoline", "Trampoline", .floor(1.5, 1.5, 0), [
                ("open", "Trampoline", "How it came. Higher every time, until it isn't.", 0, 0, .made("trampoline")),
                ("net", "Trampoline with a Net", "The net's there for the trampoline's peace of mind.", 300, 0, .made("trampoline-net")),
            ]),
        ], coins: 1200)

    private static let playground = HouseRoom(
        id: "playground", name: "Playground", blurb: "Your own. No queue for the swings.", cell: [0, 0, 0], gems: 0, stand: [3.4, 3.9],
        spots: [
            spot("playground", "swings", "Big thing", .floor(1.9, 1.3, 0), [
                ("swings", "Swings", "How it came. One swing is always still moving.", 0, 0, .made("swings")),
                ("climber", "Climbing Frame", "The top's further up from the top than from the bottom.", 400, 0, .made("climber")),
            ]),
            spot("playground", "slide", "Other thing", .floor(4.7, 2.2, 0), [
                ("slide", "Slide", "Warm in the sun. Fast in the rain.", 300, 0, .made("slide")),
                ("round", "Roundabout", "Turning slowly. It hasn't been pushed today.", 450, 0, .made("merry-go-round")),
            ]),
            spot("playground", "sand", "Small thing", .floor(1.8, 3.8, 0), [
                ("sandbox", "Sandpit", "Dig far enough and there's a second bucket.", 150, 0, .made("sandbox")),
                ("seesaw", "Seesaw", "Works with one. Don't ask who's on the other end.", 220, 0, .made("seesaw")),
            ]),
        ], coins: 1500)

    private static let diamond = HouseRoom(
        id: "diamond", name: "Ball Field", blurb: "Ninety feet between bases, give or take eighty.", cell: [0, 0, 0], gems: 0, stand: [5.0, 8.7],
        spots: [
            spot("diamond", "diamond", "Field", .floor(5.0, 5.0, 0), [
                ("field", "Ball Field", "How it came. Chalked this morning, by someone.", 0, 0, .made("diamond")),
            ]),
            spot("diamond", "stands", "Third-base side", .floor(1.0, 7.9, 1), [
                ("bleachers", "Bleachers", "Seats twelve. Eleven are taken, in spirit.", 300, 0, .made("bleachers")),
            ]),
            spot("diamond", "dugout", "First-base side", .floor(9.0, 7.9, 3), [
                ("dugout", "Dugout", "Sunflower seeds on the floor already.", 350, 0, .made("dugout")),
            ]),
            spot("diamond", "board", "Outfield", .floor(8.4, 0.8, 0), [
                ("scoreboard", "Scoreboard", "Home's ahead. Home's always ahead.", 400, 0, .made("scoreboard")),
            ]),
            spot("diamond", "mound", "Mound", .floor(5.0, 5.3, 0), [
                ("machine", "Pitching Machine", "Throws strikes. Has thoughts about your stance.", 500, 0, .made("pitching-machine")),
            ]),
        ], coins: 5000)

    private static let court = HouseRoom(
        id: "court", name: "Basketball Court", blurb: "Half a court. The other half's wherever the ball goes.", cell: [0, 0, 0], gems: 0, stand: [2.5, 4.2],
        spots: [
            spot("court", "court", "Court", .floor(2.5, 3.0, 0), [
                ("court", "Half Court", "How it came. The rim's forgiving on Tuesdays.", 0, 0, .made("court")),
            ]),
            spot("court", "rack", "Courtside", .floor(4.4, 5.3, 0), [
                ("rack", "Ball Rack", "Three balls. One's flat. It rotates.", 80, 0, .made("ball-rack")),
                ("bench", "Team Bench", "For the substitutes you'll have one day.", 60, 0, .kit("bench")),
            ]),
        ], coins: 900)

    private static let vegpatch = HouseRoom(
        id: "vegpatch", name: "Vegetable Patch", blurb: "Things you planted, and things that volunteered.", cell: [0, 0, 0], gems: 0, stand: [2.6, 2.7],
        spots: [
            spot("vegpatch", "vegpatch", "Beds", .floor(1.5, 1.5, 0), [
                ("veg", "Vegetable Beds", "How it came. The carrots are further along than they should be.", 0, 0, .made("vegpatch")),
                ("pumpkins", "Pumpkin Patch", "One of them is planning to be enormous.", 150, 0, .made("vegpatch-pumpkins")),
                ("flowers", "Cutting Garden", "Sunflowers. They watch the street, not the sun.", 150, 0, .made("vegpatch-flowers")),
            ]),
        ], coins: 500)

    private static let skatepark = HouseRoom(
        id: "skatepark", name: "Skate Park", blurb: "Concrete, and a ramp that's taller from the top.", cell: [0, 0, 0], gems: 0, stand: [4.6, 3.3],
        spots: [
            spot("skatepark", "skatepark", "Ground", .floor(3.0, 2.0, 0), [
                ("grey", "Concrete", "How it came. Smooth as far as the first crack.", 0, 0, .made("slab:6:4:c2c0b8")),
                ("blue", "Painted Blue", "Like skating an empty pool. Which it's not. Probably.", 90, 0, .made("slab:6:4:7fb2d6")),
            ]),
            spot("skatepark", "ramp", "Ramp", .floor(1.6, 2.0, 0), [
                ("half", "Half-Pipe", "How it came. Drop in. The pipe insists.", 0, 0, .model("skate", "half-pipe", 3.0)),
            ]),
            spot("skatepark", "rail", "Rail", .floor(4.4, 1.1, 1), [
                ("low", "Low Rail", "Scratched by better skaters than anyone you know.", 80, 0, .model("skate", "rail-low", 2.6)),
                ("high", "High Rail", "For later.", 120, 0, .model("skate", "rail-high", 2.6)),
                ("box", "Grind Box", "Waxed by persons unknown.", 100, 0, .model("skate", "obstacle-box", 1.8)),
            ]),
            spot("skatepark", "board", "Board", .floor(3.6, 3.2, 1), [
                ("board", "Skateboard", "Rolls a little way on its own, to show you.", 60, 0, .model("skate", "skateboard", 1.4)),
                ("cone", "Cone", "To go round. Or over.", 15, 0, .model("cars", "cone", 1.2)),
            ]),
        ], coins: 2000)

    private static let driveway = HouseRoom(
        id: "driveway", name: "Driveway", blurb: "Somewhere to keep whatever you drive. You'll drive something.", cell: [0, 0, 0], gems: 0, stand: [0.4, 5.3],
        spots: [
            spot("driveway", "driveway", "Drive", .floor(1.5, 3.0, 0), [
                ("grey", "Concrete Drive", "How it came. A handprint in one corner, from when it was wet.", 0, 0, .made("slab:3:6:bdbab2")),
                ("gravel", "Gravel Drive", "Announces everyone.", 60, 0, .made("slab:3:6:e3d8c0")),
                ("tar", "Blacktop", "Soft on hot days. Keeps what's pressed into it.", 80, 0, .made("slab:3:6:44464c")),
            ]),
            spot("driveway", "car", "Parked", .floor(1.5, 2.9, 0), [
                ("kart", "Go-Kart", "Street legal on this street.", 450, 0, .model("cars", "kart-oobi", 1.2)),
                ("sedan", "Family Car", "Smells of the last holiday.", 600, 0, .model("cars", "sedan", 1.35)),
                ("van", "Van", "Room for the whole team and their bats.", 650, 0, .model("cars", "van", 1.35)),
                ("suv", "Big Car", "Has a button nobody's pressed.", 700, 0, .model("cars", "suv", 1.35)),
                ("taxi", "Taxi", "The meter's running. It's been running since it got here.", 700, 0, .model("cars", "taxi", 1.35)),
                ("truck", "Pickup", "There's something under a tarp in the back.", 750, 0, .model("cars", "truck", 1.35)),
                ("tractor", "Tractor", "Top speed: eventually.", 800, 0, .model("cars", "tractor", 1.35)),
                ("sports", "Sports Car", "Doing ninety, parked.", 900, 0, .model("cars", "sedan-sports", 1.35)),
                ("race", "Racing Car", "The tyres are still warm.", 1200, 0, .model("cars", "race", 1.4)),
                ("police", "Police Car", "On loan. The lights come on when you fib.", 0, 6, .model("cars", "police", 1.35)),
                ("fire", "Fire Engine", "Takes the whole drive. Worth it.", 0, 10, .model("cars", "firetruck", 1.3)),
                ("future", "Car From Later", "Hasn't been invented. Mind the paint.", 0, 12, .model("cars", "race-future", 1.4)),
            ]),
            spot("driveway", "cone", "By the road", .floor(0.4, 5.5, 0), [
                ("cone", "Traffic Cone", "Guards the space.", 15, 0, .model("cars", "cone", 1.2)),
            ]),
        ], coins: 800)

    private static let campsite = HouseRoom(
        id: "campsite", name: "Campsite", blurb: "A night out, twenty steps from the back door.", cell: [0, 0, 0], gems: 0, stand: [3.2, 1.8],
        spots: [
            spot("campsite", "tent", "Tent", .floor(1.5, 1.5, 0), [
                ("tent", "Tent", "How it came. Bigger inside, the way tents are.", 0, 0, .model("camp", "tent-canvas", 5.0)),
                ("frame", "Den of Sticks", "No canvas. The stars come straight in.", 60, 0, .model("camp", "tent", 5.0)),
            ]),
            spot("campsite", "fire", "Fire", .floor(3.0, 3.0, 0), [
                ("pit", "Fire Ring", "Cold. The stones remember, though.", 120, 0, .model("camp", "campfire-pit", 4.0)),
                ("fire", "Campfire", "Lit. It was lit when you got here.", 240, 0, .made("campfire")),
            ]),
            spot("campsite", "seat", "Seat", .floor(1.3, 3.4, 1), [
                ("log", "Sitting Log", "Two can share it. Three, if one's a dog.", 40, 0, .model("camp", "tree-log", 1.6)),
                ("bedroll", "Bedroll", "For lying on and naming stars wrong.", 60, 0, .model("camp", "bedroll", 3.0)),
            ]),
            spot("campsite", "chest", "Supplies", .floor(3.4, 1.0, 0), [
                ("chest", "Supply Chest", "Marshmallows, and a torch that only works when shaken.", 150, 0, .model("camp", "chest", 3.0)),
                ("barrel", "Water Barrel", "Tastes of barrel.", 50, 0, .model("camp", "barrel", 3.0)),
                ("sign", "Signpost", "Points at the house and says HOME, in case.", 30, 0, .model("camp", "signpost", 3.0)),
            ]),
        ], coins: 1000)
}
