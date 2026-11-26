import Foundation

// The shop. Everything in it is for show: nothing bought makes a question
// easier or a run longer, so the only way to get on is the math. Prices run
// from one good run to a couple of weeks of them. A right answer pays about
// 100 stars and a wave's worth of track about 60, so 20 questions a day is
// something like 3,000.

struct MathItem: Identifiable, Hashable {
    enum What: Hashable {
        /// A body and its colours: top, bottoms, shoes.
        case outfit(body: String, top: String, bottom: String, shoes: String)
        case finish(MathLook.Finish)
        /// Deck and wheels.
        case board(String, String)
        /// What's left in the air behind them; nil for nothing.
        case trail(String?)
        case teacher(MathLook, height: Float)
    }

    let id: String
    let name: String
    let blurb: String
    let price: Int
    let what: What
    var isDefault = false

    var slot: String {
        switch what {
        case .outfit: "outfit"
        case .finish: "finish"
        case .board: "board"
        case .trail: "trail"
        case .teacher: "teacher"
        }
    }
}

enum MathCatalog {
    static let slots: [(id: String, title: String)] = [
        ("outfit", "Clothes"), ("finish", "Skins"), ("board", "Boards"), ("trail", "Trails"), ("teacher", "Teachers"),
    ]

    static func item(_ id: String?) -> MathItem? {
        guard let id else { return nil }
        return items.first { $0.id == id }
    }

    static func items(in slot: String) -> [MathItem] { items.filter { $0.slot == slot } }

    private static func outfit(_ id: String, _ name: String, _ blurb: String, _ price: Int, body: String = "male-a",
                               _ top: String, _ bottom: String, _ shoes: String) -> MathItem {
        MathItem(id: "outfit-\(id)", name: name, blurb: blurb, price: price, what: .outfit(body: body, top: top, bottom: bottom, shoes: shoes))
    }

    private static func teacher(_ id: String, _ name: String, _ blurb: String, _ price: Int, head: String, body: String, hair: String,
                                skin: String = "f0c8a8", top: String, bottom: String, shoes: String = "1a1a1a", height: Float = 1.95,
                                finish: MathLook.Finish = .normal, isDefault: Bool = false) -> MathItem {
        var look = MathLook(head: head, body: body, hair: hair, skin: skin, top: top, bottom: bottom, shoes: shoes)
        look.finish = finish
        return MathItem(id: "teacher-\(id)", name: name, blurb: blurb, price: price, what: .teacher(look, height: height), isDefault: isDefault)
    }

    static let items: [MathItem] = [
        // Clothes. The first is whatever they chose for themselves.
        MathItem(id: "outfit-own", name: "My Own Clothes", blurb: "What you came in.", price: 0, what: .outfit(body: "male-a", top: "", bottom: "", shoes: ""), isDefault: true),
        outfit("away", "Away Kit", "White with a blue trim. Shows the grass stains.", 300, "f4f6f7", "1f3a6b", "1f3a6b"),
        outfit("keeper", "Goalkeeper", "Nobody else is allowed to wear this colour.", 450, "b6f000", "20242c", "ff5a36"),
        outfit("pe", "PE Kit", "It has been in the bag since September.", 250, "bdc3c7", "c0392b", "f2f2f2"),
        outfit("pyjamas", "Pyjamas", "For the dream where you're at school in them.", 600, body: "female-b", "8ecae6", "8ecae6", "ffb703"),
        outfit("ref", "Referee", "You are not in charge here either.", 500, "111111", "111111", "f2f2f2"),
        outfit("hivis", "Hi-Vis", "So the teacher can see you better.", 400, body: "male-e", "f7e11a", "ff7a1a", "20242c"),
        outfit("tux", "Tuxedo", "Overdressed for third period.", 1500, body: "male-d", "111111", "111111", "111111"),
        outfit("labcoat", "Lab Coat", "The experiment is whether you can get away.", 1200, body: "male-e", "ffffff", "34495e", "20242c"),
        outfit("banana", "Banana", "Entirely yellow. No further questions.", 900, "ffe135", "ffe135", "6b4f1d"),
        outfit("lava", "Lava", "The floor is you.", 1100, "ff4d00", "7a1500", "ffd000"),
        outfit("ice", "Ice", "Cool, and aware of it.", 1100, "bdf2ff", "5cc8e8", "ffffff"),
        outfit("midnight", "Midnight", "Hard to see in the cafeteria, after.", 1400, "0b1026", "0b1026", "3d5afe"),
        outfit("otter", "Otters Mascot", "Go Otters. Whatever an otter does.", 2000, body: "male-b", "8a5a2b", "8a5a2b", "f5c542"),

        // Skins: the whole of them, changed.
        MathItem(id: "finish-none", name: "As You Are", blurb: "Just you.", price: 0, what: .finish(.normal), isDefault: true),
        MathItem(id: "finish-neon", name: "Neon", blurb: "You glow. It isn't explained.", price: 2000, what: .finish(.neon)),
        MathItem(id: "finish-negative", name: "Photo Negative", blurb: "Every colour of you, the wrong way round.", price: 2500, what: .finish(.negative)),
        MathItem(id: "finish-ghost", name: "Ghost", blurb: "You can see the lockers through yourself.", price: 4000, what: .finish(.ghost)),
        MathItem(id: "finish-shadow", name: "Shadow", blurb: "Only the eyes are left.", price: 6000, what: .finish(.shadow)),
        MathItem(id: "finish-chrome", name: "Chrome", blurb: "Polished daily by someone you never see.", price: 9000, what: .finish(.chrome)),
        MathItem(id: "finish-gold", name: "Solid Gold", blurb: "A statue of you that runs.", price: 15000, what: .finish(.gold)),

        // Boards: what you ride when you pick one up.
        MathItem(id: "board-classic", name: "Classic", blurb: "Orange. It works.", price: 0, what: .board("f39c12", "20242c"), isDefault: true),
        MathItem(id: "board-ocean", name: "Ocean", blurb: "Smells faintly of the pool.", price: 350, what: .board("1e90ff", "ffffff")),
        MathItem(id: "board-bubblegum", name: "Bubblegum", blurb: "Found under a desk.", price: 350, what: .board("ff6fb5", "7afcff")),
        MathItem(id: "board-flame", name: "Flame", blurb: "Go-faster red. It goes the same.", price: 700, what: .board("e02b20", "ffd000")),
        MathItem(id: "board-ruler", name: "The Ruler", blurb: "Thirty centimetres of it, at least.", price: 900, what: .board("ffd21f", "111111")),
        MathItem(id: "board-midnight", name: "Midnight", blurb: "You can hear it but not see it.", price: 1200, what: .board("0b1026", "3d5afe")),
        MathItem(id: "board-gold", name: "Gold Deck", blurb: "Heavier than it looks.", price: 5000, what: .board("f5c542", "fff3b0")),

        // Trails.
        MathItem(id: "trail-none", name: "Nothing", blurb: "You leave no trace.", price: 0, what: .trail(nil), isDefault: true),
        MathItem(id: "trail-chalk", name: "Chalk Dust", blurb: "Somebody clapped the erasers.", price: 400, what: .trail("ffffff")),
        MathItem(id: "trail-sparks", name: "Sparks", blurb: "Gold, like the stars you take.", price: 800, what: .trail("ffcf33")),
        MathItem(id: "trail-bubbles", name: "Pool Water", blurb: "From the pool. Which is empty.", price: 800, what: .trail("4fd6ff")),
        MathItem(id: "trail-slime", name: "Slime", blurb: "The cafeteria would like it back.", price: 1000, what: .trail("7dff3a")),
        MathItem(id: "trail-hot", name: "Hot Pink", blurb: "Visible from the office.", price: 1000, what: .trail("ff2d95")),
        MathItem(id: "trail-red", name: "Red Curtain", blurb: "It follows you out of the gym.", price: 2500, what: .trail("c1121f")),

        // Teachers: who's behind you.
        teacher("grey", "Ms. Grey", "She has always been your teacher. Check the photographs.", 0, head: "female-d", body: "female-d",
                hair: "6d6d6d", top: "6b6f76", bottom: "3a3c40", isDefault: true),
        teacher("sub", "The Substitute", "Nobody sent him. He knows your name.", 1500, head: "male-e", body: "male-e",
                hair: "5a3a22", top: "ffffff", bottom: "34495e"),
        teacher("coach", "Coach", "He can do this all day. He has been.", 2000, head: "male-b", body: "male-b",
                hair: "b5651d", skin: "f2b48c", top: "e74c3c", bottom: "20242c", shoes: "f2f2f2", height: 2.1),
        teacher("lunch", "The Lunch Lady", "There is more. There is always more.", 2500, head: "female-c", body: "female-c",
                hair: "9a9aa0", top: "f7f1dc", bottom: "8ecae6", height: 1.8),
        teacher("monitor", "The Hall Monitor", "One year older than you. Decades of authority.", 3000, head: "male-c", body: "male-c",
                hair: "c0531f", top: "2e86c1", bottom: "20242c", height: 1.6),
        teacher("principal", "The Principal", "His door is every door in the office.", 5000, head: "male-d", body: "male-d",
                hair: "d8d8d8", skin: "e9c3a6", top: "111111", bottom: "111111", height: 2.25),
        teacher("you", "The Other You", "Taller. It hands back your own work, marked.", 12000, head: "male-d", body: "male-a",
                hair: "111111", top: "111111", bottom: "111111", height: 2.0, finish: .shadow),
    ]

    /// Colours offered in the look editor.
    static let hairs = ["c0531f", "e07a3a", "8a5a34", "5a3a22", "2b1d14", "101010", "d9b25f", "f1e0a0", "9a9aa0", "2e86c1", "8e44ad", "2ecc71", "ff2d95"]
    static let skins = ["fbe0cc", "f6c9a8", "f3c6a2", "e8b48c", "c98a5e", "a56a43", "8d5a3a", "6b4226", "4a2e1c"]
    static let clothes = ["1f3a6b", "d6263a", "f4f6f7", "20242c", "2e86c1", "27ae60", "f1c40f", "e67e22", "8e44ad", "ff6fb5", "16a085", "c9b48a", "7f8c8d", "6b4f1d"]
}
