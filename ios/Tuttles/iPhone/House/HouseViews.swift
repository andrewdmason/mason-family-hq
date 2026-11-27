import SceneKit
import SwiftUI

// The house's screens. One scene (HouseScene.swift) under everything: the
// neighbourhood (HouseTown.swift) with the houses in it, dragged about and
// pinched closer from anywhere. It opens on the family's end of the street.
// Close to a house it opens, and closer still the room in the middle is the
// one they're in; a tap on a house or a room flies there, and the map button
// pulls back to the whole neighbourhood, and from there goes back to the
// family's end. Their own house can be
// changed, from two buttons that keep their corners at the bottom of the
// screen. On the right, while a room of theirs is in focus, "Decorate
// kitchen": the one red thing there is. It brings up a card with a tab for
// each of the room's spots and, under them, what can go in the one picked,
// tried in the room before it's paid for. While the card's up each spot has
// a marker in the room, and a marker or a tab changes what the card's for;
// a tap anywhere else puts it away. A tap on a thing in the room brings the
// card up on its spot. On the left, always, Rooms: a card to move a room
// from, or add one, putting it where they like (HouseLayout.swift). A house
// of more than one floor can be looked at a floor at a time, from a picker
// up the right edge. The other house, and Mom & Dad's, can be looked round and not touched:
// in a room of it, whose room it is is said at the top. The parents see the
// street the same way, and what each purse has had paid in. With their house
// in view and no room in focus, the red button is "Decorate outside": the
// roof, the walls, the door, what's on the roof and the lawn, with the house
// shut while the card's up. And the street keeps the time of day
// (HouseSky.swift), looked at again every minute.

/// Coins and gems, wherever they're shown: a pill each, or, in a bar, the
/// two together with the bar's own glass round them.
struct HousePurse: View {
    var inBar = false
    private let house = HouseStore.shared

    var body: some View {
        if inBar {
            HStack(spacing: 9) {
                count("circle.fill", .yellow, house.coins)
                count("diamond.fill", .cyan, house.gems)
            }
            .font(.system(.subheadline, design: .rounded).weight(.bold).monospacedDigit())
            .foregroundStyle(Color(.label))
            .padding(.horizontal, 3)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(house.coins) coins, \(house.gems) gems")
        } else {
            HStack(spacing: 8) {
                pill("circle.fill", .yellow, house.coins)
                pill("diamond.fill", .cyan, house.gems)
            }
        }
    }

    private func count(_ symbol: String, _ color: Color, _ n: Int) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).font(.caption).foregroundStyle(color)
            Text(n.formatted()).contentTransition(.numericText())
        }
    }

    private func pill(_ symbol: String, _ color: Color, _ n: Int) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).foregroundStyle(color)
            Text(n.formatted()).font(.system(.headline, design: .rounded).weight(.heavy).monospacedDigit())
                .contentTransition(.numericText())
                // A big purse stays on one line.
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 9)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(n) \(symbol == "circle.fill" ? "coins" : "gems")")
    }
}

/// Today's ten minutes of Vocab and the purse, in one button at the top of
/// Vocab and of Math: the same three things on both, since Vocab's coins wait
/// for the ten minutes. Tapping it slides the house up over what's there,
/// with an X to come back.
struct HouseStatusButton: View {
    /// Today against Vocab's ten minutes. Nil for whoever isn't set up for Vocab: the purse alone.
    let day: VocabOverview.Goal?
    @State private var showingHouse = false
    private let house = HouseStore.shared

    var body: some View {
        Button { showingHouse = true } label: {
            HStack(spacing: 9) {
                if let day { time(day) }
                count("circle.fill", .yellow, house.coins)
                count("diamond.fill", .cyan, house.gems)
            }
            .font(.system(.subheadline, design: .rounded).weight(.bold).monospacedDigit())
            // (Not .primary: in a bar's button that's the app's red.)
            .foregroundStyle(Color(.label))
            .padding(.horizontal, 3)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spoken(day: day, coins: house.coins, gems: house.gems))
        .accessibilityHint("Opens the house")
        .fullScreenCover(isPresented: $showingHouse) {
            HouseHomeView(close: { showingHouse = false })
        }
    }

    /// The time answered today: a ring filling up, then a tick once the ten minutes are done.
    private func time(_ day: VocabOverview.Goal) -> some View {
        HStack(spacing: 4) {
            if day.done {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(VocabLook.right)
            } else {
                ZStack {
                    Circle().stroke(Color(.label).opacity(0.15), lineWidth: 2.5)
                    Circle().trim(from: 0, to: day.fraction)
                        .stroke(TuttlesLook.accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                .frame(width: 14, height: 14)
            }
            Text(VocabRules.clock(day.ms))
                .foregroundStyle(day.done ? VocabLook.rightText : Color(.label))
                .contentTransition(.numericText())
        }
    }

    private func count(_ symbol: String, _ color: Color, _ n: Int) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).font(.caption).foregroundStyle(color)
            Text(n.formatted()).contentTransition(.numericText())
        }
    }

    /// "4:12 of 10 minutes of Vocab today. 120 coins, 3 gems."
    static func spoken(day: VocabOverview.Goal?, coins: Int, gems: Int) -> String {
        let purse = "\(coins) \(coins == 1 ? "coin" : "coins"), \(gems) \(gems == 1 ? "gem" : "gems")"
        guard let day else { return purse }
        let minutes = day.goalMs / 60_000
        let time = day.done ? "Today's \(minutes) minutes of Vocab done, \(VocabRules.clock(day.ms))"
            : "\(VocabRules.clock(day.ms)) of \(minutes) minutes of Vocab today"
        return "\(time). \(purse)"
    }
}

/// What something costs, as it's written on a button.
struct HousePrice: View {
    let coins: Int
    let gems: Int

    var body: some View {
        HStack(spacing: 4) {
            if gems > 0 {
                Image(systemName: "diamond.fill").foregroundStyle(.cyan)
                Text("\(gems)")
            } else if coins > 0 {
                Image(systemName: "circle.fill").foregroundStyle(.yellow)
                Text(coins.formatted())
            } else {
                Text("Free")
            }
        }
        .font(.system(.subheadline, design: .rounded).weight(.heavy).monospacedDigit())
    }
}

struct HouseSceneView: UIViewRepresentable {
    let stage: HouseStage
    let tapped: (HouseStage.Hit?) -> Void

    /// A finger drags the town about and two pinch it closer, wherever it's looked at from.
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: HouseSceneView
        /// Where the two fingers were, between them, the last time they moved.
        private var between: CGPoint?
        init(_ parent: HouseSceneView) { self.parent = parent }

        @objc func tap(_ g: UITapGestureRecognizer) {
            guard let view = g.view as? SCNView else { return }
            parent.tapped(parent.stage.hit(g.location(in: view), in: view))
        }

        @objc func dragged(_ g: UIPanGestureRecognizer) {
            guard let view = g.view as? SCNView else { return }
            if parent.stage.held != nil {
                // A room in hand goes where the finger is.
                if g.state == .began || g.state == .changed { parent.stage.carry(to: g.location(in: view), in: view) }
                return
            }
            guard g.state == .changed else { return }
            parent.stage.drag(by: g.translation(in: view), height: view.bounds.height)
            g.setTranslation(.zero, in: view)
        }

        @objc func twisted(_ g: UIRotationGestureRecognizer) {
            guard g.state == .changed else { return }
            parent.stage.twist(by: g.rotation)
            g.rotation = 0
        }

        /// Two fingers pinch and turn at once.
        func gestureRecognizer(_ a: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith b: UIGestureRecognizer) -> Bool {
            (a is UIPinchGestureRecognizer || a is UIRotationGestureRecognizer) && (b is UIPinchGestureRecognizer || b is UIRotationGestureRecognizer)
        }

        @objc func pinched(_ g: UIPinchGestureRecognizer) {
            // With a finger lifted the middle jumps to the one left: wait for two again.
            guard let view = g.view, g.state == .changed, g.numberOfTouches == 2 else {
                between = nil
                return
            }
            let at = g.location(in: view)
            // Two fingers going the same way carry the town along as one does.
            if let between { parent.stage.drag(by: CGPoint(x: at.x - between.x, y: at.y - between.y), height: view.bounds.height) }
            between = at
            parent.stage.pinch(by: g.scale, about: CGPoint(x: at.x - view.bounds.midX, y: at.y - view.bounds.midY), height: view.bounds.height)
            g.scale = 1
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.antialiasingMode = .multisampling4X
        view.preferredFramesPerSecond = 60
        view.rendersContinuously = true
        view.scene = stage.scene
        view.pointOfView = stage.cameraNode
        view.delegate = stage
        view.isPlaying = true
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap(_:))))
        let drag = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.dragged(_:)))
        drag.maximumNumberOfTouches = 1
        let pinch = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pinched(_:)))
        let twist = UIRotationGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.twisted(_:)))
        for g in [drag, pinch, twist] as [UIGestureRecognizer] {
            g.delegate = context.coordinator
            view.addGestureRecognizer(g)
        }
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        context.coordinator.parent = self
        if view.bounds.height > 0 { stage.setAspect(Float(view.bounds.width / view.bounds.height)) }
    }
}

struct HouseHomeView: View {
    /// Slid up over Vocab or Math (HouseStatusButton): how to put it away, for the X at the top.
    private let close: (() -> Void)?
    @Environment(ChatStore.self) private var store
    @State private var stage = HouseStage()
    /// What the camera's on, as the stage has it: it changes as the town's moved.
    @State private var focus = HouseStage.Focus.street
    /// Pulled right back to the whole neighbourhood: the map button goes home from there.
    @State private var wide = false
    @State private var ready = false
    /// The spot being chosen for, and the room to buy.
    @State private var choosing: Choosing?
    /// The spot the card last showed, so it's still on the card as it slides away.
    @State private var carded: Choosing?
    @State private var adding = false
    /// A room being put somewhere: one to buy, or one of theirs to move.
    @State private var placing: Placing?
    /// Waiting for them to tap the room they want to move.
    @State private var moving = false
    /// The highest floor shown (nil: all of it).
    @State private var floor: Int?
    /// The room in hand while one's being put somewhere, and why it can't go where it is.
    @State private var held: HouseStage.Held?
    @State private var showingPurses = false
    @Environment(SideMenuState.self) private var menu: SideMenuState?
    private let house = HouseStore.shared

    enum Placing: Equatable {
        case new(HouseRoom)
        case move(String)

        var room: String {
            switch self {
            case .new(let room): room.id
            case .move(let id): id
            }
        }
    }

    struct Choosing: Identifiable, Equatable {
        let room: HouseRoom
        let spot: HouseSpot
        var id: String { HouseCatalog.key(room.id, spot.id) }
    }

    init(close: (() -> Void)? = nil) { self.close = close }

    private var parents: Bool { store.showingParentView }
    private var me: String { house.owner?.uuidString.lowercased() ?? "me" }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                HouseSceneView(stage: stage) { tapped($0) }
                    .ignoresSafeArea()
                    .onChange(of: geo.size, initial: true) { _, size in
                        if size.height > 0 { stage.setAspect(Float(size.width / (size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom))) }
                    }
                overlay
            }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationTitle("")
        // In the app's own bar, on the ☰'s line: the way out to the street, and the purse. (Slid up over a
        // game there's no bar, and they're in a row of their own with the X: `overlay`.)
        .toolbar {
            if close == nil {
                ToolbarSpacer(.fixed, placement: .topBarLeading)
                ToolbarItem(placement: .topBarLeading) { mapButton }
                ToolbarItem(placement: .topBarLeading) { turnButton }
                if parents {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Purses", systemImage: "circle.fill") { showingPurses = true }
                    }
                } else if choosing == nil {
                    // (With a card up the purse is on the card.)
                    ToolbarItem(placement: .topBarTrailing) { HousePurse(inBar: true) }
                }
            }
        }
        .task {
            guard !ready else { return }
            stage.changed = {
                focus = stage.focus
                wide = stage.wide
                floor = stage.floor
                held = stage.held
            }
            store.openHouse()
            demo()
            show()
            ready = true
            let args = CommandLine.arguments
            if args.contains("--house-sizes") {
                // How big each kit model is at the house's scale: width, height, depth.
                let folder = MathModels.folder.appending(path: "furniture")
                for file in ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).sorted() where file.hasSuffix(".glb") {
                    let name = String(file.dropLast(4))
                    let size = HouseProps.size(name)
                    print(String(format: "SIZE %@ %.2f %.2f %.2f", name, size.x, size.y, size.z))
                }
            }
            if let at = args.firstIndex(of: "--house-floor"), args.count > at + 1, let n = Int(args[at + 1]) {
                go(.house(me), animated: false)
                setFloor(n)
            }
            if let at = args.firstIndex(of: "--house-add"), args.count > at + 1, let room = HouseCatalog.room(args[at + 1]), !house.state.has(room: room.id) {
                go(.house(me), animated: false)
                place(.new(room))
            }
            if let at = args.firstIndex(of: "--house-room") {
                let id = args.count > at + 1 && HouseCatalog.room(args[at + 1]) != nil ? args[at + 1] : HouseCatalog.first
                if house.state.has(room: id) { go(.room(me, id), animated: false) }
                if args.contains("--house-decorate") { decorate() }
            }
            if args.contains("--house-outside") {
                go(.house(me), animated: false)
                decorate()
            }
            await house.sync(with: store)
            show()
        }
        // The time of day, as the phone's clock has it, looked at again each minute.
        .task {
            while !Task.isCancelled {
                stage.setSky(Self.sky())
                try? await Task.sleep(for: .seconds(60))
            }
        }
        // A drag moves the town, so it doesn't also slide the menu out (the ☰ still opens it).
        .onAppear { menu?.locked = true }
        .onDisappear {
            menu?.locked = false
            Task { await house.sync(with: store) }
        }
        // The card's going: the room comes back down as it does, and what was only being tried goes back.
        .onChange(of: choosing == nil) {
            guard choosing == nil else { return }
            stage.drop()
            refresh()
        }
        // One card for the room's spots: a tab or a marker changes which it's for, without it going away.
        .sheet(isPresented: Binding(get: { choosing != nil }, set: { if !$0 { choosing = nil } }),
               onDismiss: { Task { await house.sync(with: store) } }) {
            Group {
                if let choice = choosing ?? carded {
                    HouseDecorSheet(room: choice.room, spot: choice.spot, pick: { choose(me, choice.room, $0) }) { preview in
                        refresh(trying: preview.map { (choice, $0) }, popping: choice.id)
                    }
                    .id(choice.room.id)
                }
            }
            .presentationDetents([.fraction(0.46)])
            .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.46)))
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $adding) {
            HouseRoomSheet(move: {
                adding = false
                move()
            }) { room in
                adding = false
                place(.new(room))
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showingPurses) {
            HousePursesView(street: house.street).presentationDetents([.medium, .large])
        }
    }

    // MARK: What's on the street

    private func shown(trying: (Choosing, HouseItem?)? = nil) -> [HouseShown] {
        var out: [HouseShown] = []
        if !parents {
            var state = house.state
            if let trying {
                // Something being tried in its spot before it's paid for.
                state.placed[trying.0.id] = trying.1?.id ?? ""
                if let item = trying.1, !state.owns(item) { state.owned.append(item.id) }
            }
            out.append(HouseShown(kid: me, name: house.name, mine: true, state: state, look: MathStore.shared.look))
        }
        for other in parents ? house.street : house.others {
            guard let state = other.state else { continue }
            out.append(HouseShown(kid: other.kid, name: other.name, mine: false, state: state, look: other.look ?? .plain))
        }
        return out
    }

    private func show() {
        stage.setDecorating(!parents)
        stage.show(shown())
    }

    private func refresh(trying: (Choosing, HouseItem?)? = nil, popping: String? = nil) {
        guard let mine = shown(trying: trying).first(where: \.mine) else { return }
        stage.update(mine, popping: popping)
    }

    private func mine(_ focus: HouseStage.Focus) -> Bool {
        switch focus {
        case .street: false
        case .house(let kid), .room(let kid, _): kid == me && !parents
        }
    }

    /// Fly to the street, a house or a room. They can drag and pinch away from wherever it lands.
    private func go(_ to: HouseStage.Focus, animated: Bool = true) {
        if placing != nil || moving { stopPlacing() }
        stage.fly(to: to, animated: animated)
        MathAudio.shared.play("tap", volume: 0.4)
    }

    private func tapped(_ hit: HouseStage.Hit?) {
        if choosing != nil {
            // With a card up, a tap on another marker changes which spot it's for; one anywhere else puts it away.
            guard case .spot = hit else {
                choosing = nil
                return
            }
        }
        switch hit {
        case .spot(let kid, let roomID, let spotID):
            // A marker, with the card up; without it, a thing in the room.
            guard let room = HouseCatalog.room(roomID), let spot = room.spot(spotID) else { return }
            choose(kid, room, spot)
        case .room(let kid, let roomID):
            if moving, kid == me {
                // (The landing isn't picked up: it goes where the hall goes.)
                guard roomID != HouseLayout.landing else { return }
                stage.picking = false
                moving = false
                place(.move(roomID))
            } else if placing == nil, focus != .room(kid, roomID) {
                go(.room(kid, roomID))
            }
        case .house(let kid):
            guard placing == nil, !moving, !opened(kid) else { return }
            // A house of one room: straight into it.
            let rooms = state(of: kid)?.rooms ?? []
            go(rooms.count == 1 ? .room(kid, rooms[0]) : .house(kid))
        case nil:
            break
        }
    }

    /// Bring the card up for a spot of a room of theirs, or change which spot it's for.
    private func choose(_ kid: String, _ room: HouseRoom, _ spot: HouseSpot) {
        let choice = Choosing(room: room, spot: spot)
        guard choice != choosing else { return }
        // Whatever was being tried in the last spot and not bought goes back.
        if choosing != nil { refresh() }
        choosing = choice
        carded = choice
        stage.lift(kid, room.id, spot: spot.id)
        MathAudio.shared.play("tap", volume: 0.4)
    }

    /// Decorate: the card, for the room they're in, on the first spot that's still as it came. With their
    /// house in view and no room in focus, it's for the outside of it.
    private func decorate() {
        guard mine(focus) else { return }
        let kid: String, room: HouseRoom
        switch focus {
        case .street: return
        case .house(let k): (kid, room) = (k, HouseCatalog.outside)
        case .room(let k, let id):
            guard let found = HouseCatalog.room(id) else { return }
            (kid, room) = (k, found)
        }
        let id = room.id
        let spots = house.state.spots(of: room)
        guard let spot = spots.first(where: { house.state.untouched($0, of: id) }) ?? spots.first else { return }
        choose(kid, room, spot)
    }

    /// Whether this is the house that's open.
    private func opened(_ kid: String) -> Bool {
        switch focus {
        case .street: false
        case .house(let k), .room(let k, _): k == kid
        }
    }

    // MARK: Where rooms go

    /// Pick a room up, for them to drag to where it goes.
    private func place(_ what: Placing) {
        placing = what
        moving = false
        stage.hold(what.room)
        MathAudio.shared.play("tap", volume: 0.4)
    }

    private func stopPlacing() {
        placing = nil
        moving = false
        stage.picking = false
        stage.letGo()
    }

    /// Wait for a tap on the room to move, with the whole house to pick from.
    private func move() {
        moving = true
        stage.picking = true
        stage.fly(to: .house(me))
        MathAudio.shared.play("tap", volume: 0.4)
    }

    /// Put the room in hand down where it's held, if it can go there.
    private func put() {
        guard let placing, let at = stage.held, at.trouble == nil else { MathAudio.shared.play("deny", volume: 0.6); return }
        switch placing {
        case .new(let room):
            guard house.unlock(room, at: at.plot) else { MathAudio.shared.play("deny", volume: 0.6); return }
            MathAudio.shared.play("goal", volume: 0.7)
            stopPlacing()
            show()
            go(.room(me, room.id))
        case .move(let id):
            guard house.move(id, to: at.plot) else { MathAudio.shared.play("deny", volume: 0.6); return }
            MathAudio.shared.play("equip", volume: 0.6)
            stopPlacing()
            show()
        }
        Task { await house.sync(with: store) }
    }

    private func setFloor(_ floor: Int?) {
        self.floor = floor
        stage.setFloor(floor)
    }

    /// The house that's open, if one is.
    private var openHouse: String? {
        switch focus {
        case .street: nil
        case .house(let kid), .room(let kid, _): kid
        }
    }

    /// The floors of the open house, lowest first, and those a room being placed could go on.
    private var floors: [Int] {
        guard let kid = openHouse else { return [] }
        var out = Set(state(of: kid)?.floors ?? [])
        // A room in hand can go upstairs before there is an upstairs; the basement only goes down.
        if let placing, kid == me { out.formUnion(placing.room == HouseLayout.basement ? [-1] : [0, 1]) }
        return out.sorted()
    }

    /// How a house stands: their own as the phone has it, anyone else's (Mom & Dad's too) as it's shown.
    private func state(of kid: String) -> HouseState? {
        kid == me && !parents ? house.state : stage.state(of: kid)
    }

    /// The map button: out to the whole neighbourhood; from there, back to the family's end of the street, as it's first shown.
    private func map() {
        if placing != nil || moving { stopPlacing() }
        if wide {
            go(.street)
        } else {
            stage.flyToTown()
            MathAudio.shared.play("tap", volume: 0.4)
        }
    }

    private var mapButton: some View {
        Button(action: map) { Image(systemName: wide ? "house.fill" : "map.fill") }
            .accessibilityLabel(wide ? "Our end of the street" : "The whole neighbourhood")
    }

    /// Round to the next corner. (Two fingers turn it any amount.)
    private var turnButton: some View {
        Button { stage.turn(1); MathAudio.shared.play("tap", volume: 0.4) } label: { Image(systemName: "rotate.right") }
            .accessibilityLabel("Turn the view")
            .accessibilityIdentifier("house.turn")
    }

    // MARK: Over the scene

    /// Said over the top of the scene: what to do next while a room's being put somewhere, when a tap means
    /// something else; or whose room they're looking round.
    private var prompt: String? {
        if let placing {
            // Why it can't go where it's held; or what to do with it.
            if let trouble = held?.trouble { return trouble }
            let room = HouseCatalog.room(placing.room)?.name ?? "room"
            return "Drag the \(room.lowercased()) to where it goes"
        }
        if moving { return "Tap the room to move" }
        // Whose room this is, in a house that isn't theirs to change. (Their own is named on the button for changing it.)
        if case .room(let kid, let id) = focus, !mine(focus), let room = HouseCatalog.room(id) {
            let whose = kid == HouseTown.parentsID ? HouseTown.parents.name : house.street.first { $0.kid == kid }?.name
            // ("The Basement" is "Mom & Dad's basement".)
            let name = room.name.lowercased(), plain = name.hasPrefix("the ") ? String(name.dropFirst(4)) : name
            return whose.map { "\($0)'s \(plain)" } ?? room.name
        }
        return nil
    }

    private var overlay: some View {
        VStack(spacing: 10) {
            if let close {
                HStack(alignment: .top) {
                    Button(action: close) {
                        Image(systemName: "xmark")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .frame(width: 42, height: 42)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Close")
                    // Nothing to go back from: the map button, out to the whole neighbourhood and home again.
                    Button(action: map) {
                        Image(systemName: wide ? "house.fill" : "map.fill")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .frame(width: 42, height: 42)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel(wide ? "Our end of the street" : "The whole neighbourhood")
                    Spacer()
                    HousePurse().opacity(choosing == nil ? 1 : 0)
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
            }
            if let prompt {
                Text(prompt)
                    .font(.system(.subheadline, design: .rounded).weight(.heavy))
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(.white.opacity(0.7), in: .capsule)
                    .foregroundStyle(Self.ink)
            }
            Spacer()
            // (Not under a card: it's glass, and they'd show through it.)
            if !parents { building.opacity(covered ? 0 : 1) }
        }
        .padding(.bottom, 12)
        // (All the way across, whatever's in it, so the floors are at the edge.)
        .frame(maxWidth: .infinity)
        // Which floor, up the right edge over the buttons: under where a room in focus sits, so not on top of it.
        .overlay(alignment: .bottomTrailing) {
            if floors.count > 1 { floorPicker.padding(.trailing, 16).padding(.bottom, 70).opacity(covered ? 0 : 1) }
        }
        .animation(.default, value: focus)
        .allowsHitTesting(true)
    }

    private static let ink = Color(red: 0.35, green: 0.23, blue: 0.16)

    /// A card's up over the bottom of the screen.
    private var covered: Bool { choosing != nil || adding }

    /// A floor at a time, or all of it: one short column, the top floor at the top.
    private var floorPicker: some View {
        VStack(spacing: 2) {
            ForEach(floors.reversed(), id: \.self) { (f: Int) in
                let on = (floor ?? 0) == f
                Button { setFloor(f); MathAudio.shared.play("tap", volume: 0.4) } label: {
                    // "2", "G", "B": said in full to VoiceOver.
                    Text(f < 0 ? "B" : f == 0 ? "G" : "\(f + 1)")
                        .font(.system(.footnote, design: .rounded).weight(.heavy))
                        .frame(width: 38, height: 36)
                        .foregroundStyle(on ? .white : Self.ink)
                        .background(on ? Self.ink : .clear, in: .rect(cornerRadius: 12))
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(HouseLayout.name(of: f))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .glassEffect(.regular.tint(.white.opacity(0.6)), in: .rect(cornerRadius: 16))
    }

    /// Two buttons that keep their corners, so nothing moves under a thumb as the town's dragged. On the
    /// left, Rooms, always. On the right, the one thing in red: decorating the room they're in, which comes
    /// and goes with the room. While a room's being put somewhere, only the way to stop.
    private var building: some View {
        HStack(spacing: 10) {
            if placing != nil || moving {
                Button { stopPlacing() } label: {
                    Label("Cancel", systemImage: "xmark")
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        .padding(.horizontal, 16).padding(.vertical, 11)
                        .foregroundStyle(Self.ink)
                }
                .glassEffect(.regular.tint(.white.opacity(0.6)).interactive(), in: .capsule)
                .accessibilityIdentifier("house.place.cancel")
                if placing != nil {
                    // Turn the room in hand a quarter; and the one thing in red, putting it down.
                    Button { stage.turnHeld(); MathAudio.shared.play("tap", volume: 0.4) } label: {
                        Image(systemName: "arrow.trianglehead.clockwise")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .frame(width: 44, height: 44)
                            .foregroundStyle(Self.ink)
                    }
                    .glassEffect(.regular.tint(.white.opacity(0.6)).interactive(), in: .circle)
                    .accessibilityLabel("Turn it")
                    .accessibilityIdentifier("house.place.turn")
                    Spacer(minLength: 8)
                    Button { put() } label: {
                        Label("Put it here", systemImage: "checkmark")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .lineLimit(1)
                            .padding(.horizontal, 16).padding(.vertical, 11)
                            .foregroundStyle(.white)
                    }
                    .glassEffect(.regular.tint(held?.trouble == nil ? TuttlesLook.accent : .gray.opacity(0.5)).interactive(), in: .capsule)
                    .accessibilityIdentifier("house.place.put")
                }
            } else {
                Button { adding = true; MathAudio.shared.play("tap", volume: 0.4) } label: {
                    Label("Rooms", systemImage: "house.fill")
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        .padding(.horizontal, 16).padding(.vertical, 11)
                        .foregroundStyle(Self.ink)
                }
                .glassEffect(.regular.tint(.white.opacity(0.6)).interactive(), in: .capsule)
                Spacer(minLength: 8)
                if let what = decorating {
                    Button { decorate() } label: {
                        Label("Decorate \(what)", systemImage: "paintbrush.fill")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .padding(.horizontal, 16).padding(.vertical, 11)
                            .foregroundStyle(.white)
                    }
                    .glassEffect(.regular.tint(TuttlesLook.accent).interactive(), in: .capsule)
                    .transition(.opacity)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    /// What the red button would decorate: the room of theirs in focus, or, with their house in view and
    /// no room in focus, the outside of it. Nil when it's neither (the button isn't there).
    private var decorating: String? {
        guard mine(focus) else { return nil }
        switch focus {
        case .street: return nil
        case .house: return "outside"
        case .room(_, let id): return HouseCatalog.room(id)?.name.lowercased()
        }
    }

    // MARK: For the simulator

    /// The time of day over the street: the phone's clock, or with `--house-hour 21.5` half past nine at night.
    private static func sky() -> HouseSky {
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--house-hour"), args.count > at + 1, let hour = Double(args[at + 1]) {
            return .at(hour: hour, dayOfYear: Calendar.current.ordinality(of: .day, in: .year, for: Date()) ?? 172)
        }
        return .at(Date())
    }

    /// `--house-coins 50000 --house-gems 40`, and in the demo a brother's house to look at.
    private func demo() {
        let args = CommandLine.arguments
        func number(_ flag: String) -> Int? { args.firstIndex(of: flag).flatMap { args.count > $0 + 1 ? Int(args[$0 + 1]) : nil } }
        guard store.isDemo || number("--house-coins") != nil else { return }
        var theirs = HouseState()
        theirs.rooms = ["bedroom", "living", "kitchen"]
        theirs.settle()
        for id in ["bedroom.bed.bunk", "bedroom.rug.space", "bedroom.desk.screen", "bedroom.left.shark", "bedroom.pet.dog", "bedroom.walls.sky",
                   "living.sofa.long", "living.tv.modern", "living.rug.zigzag", "living.armchair.relax", "kitchen.fridge.large", "kitchen.table.round",
                   "kitchen.food.cake", "kitchen.floor.diner-checks", "bedroom.wood.walnut", "bedroom.fabric.navy", "living.wood.white",
                   "living.fabric.mustard", "outside.roof.slate", "outside.walls.brick", "outside.door.yellow", "outside.top.chimney",
                   "outside.lawn.flamingos"] {
            let parts = id.split(separator: ".").map(String.init)
            theirs.owned.append(id)
            theirs.placed["\(parts[0]).\(parts[1])"] = id
        }
        let brother = HouseNeighbour(kid: "brother", name: args.contains("--math-oscar") ? "Sebastian" : "Oscar", me: false, state: theirs,
                                     look: args.contains("--math-oscar") ? .sebastian : .oscar)
        house.demo(coins: number("--house-coins"), gems: number("--house-gems"), fill: number("--house-fill"), street: store.isDemo ? [brother] : house.street)
    }
}

// MARK: - Choosing for a room's spots

/// The card Decorate brings up: a tab for each spot of the room, and under
/// them what can go in the one picked.
struct HouseDecorSheet: View {
    let room: HouseRoom
    /// The spot it's for now.
    let spot: HouseSpot
    /// Another's been picked.
    let pick: (HouseSpot) -> Void
    /// Something's being tried in the spot (nil: it's as it really is).
    let trying: (HouseItem?) -> Void
    private let house = HouseStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(room.name).font(.system(.title3, design: .rounded).weight(.heavy))
                Spacer()
                HousePurse()
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 10)
            ScrollViewReader { reader in
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(house.state.spots(of: room)) { tab($0).id($0.id) }
                    }
                    .padding(.horizontal, 14)
                }
                .scrollIndicators(.hidden)
                // The one it's for is in view, however it was picked: its tab, its marker, the thing itself.
                .onChange(of: spot.id, initial: true) { withAnimation { reader.scrollTo(spot.id, anchor: .center) } }
            }
            .padding(.bottom, 10)
            HouseSpotChoices(room: room, spot: spot, trying: trying).id(spot.id)
        }
    }

    /// A spot: the picture its marker has, what it's called, and a plus while it's still as it came.
    private func tab(_ s: HouseSpot) -> some View {
        let on = s.id == spot.id, untouched = house.state.untouched(s, of: room.id)
        return Button { pick(s) } label: {
            HStack(spacing: 5) {
                if s.symbol != "plus" { Image(systemName: s.symbol).font(.footnote) }
                Text(s.title)
                if untouched { Image(systemName: "plus").font(.caption.weight(.black)).foregroundStyle(on ? .white : TuttlesLook.accent) }
            }
            .font(.system(.subheadline, design: .rounded).weight(.heavy))
            .padding(.horizontal, 12).padding(.vertical, 8)
            .foregroundStyle(on ? .white : .primary)
            .background(on ? TuttlesLook.accent : Color.primary.opacity(0.07), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(untouched ? "\(s.title), nothing chosen" : s.title)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// What can go in one spot, tried in the room before it's paid for.
struct HouseSpotChoices: View {
    let room: HouseRoom
    let spot: HouseSpot
    /// Something's being tried in the spot (nil: it's as it really is).
    let trying: (HouseItem?) -> Void
    @State private var picked: HouseItem?
    @State private var refused = 0
    private let house = HouseStore.shared

    private var placed: HouseItem? { house.state.item(in: spot, of: room.id) }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ForEach(spot.items) { item in row(item) }
                if spot.starter == nil, placed != nil {
                    Button("Take it out") {
                        house.clear(spot, of: room.id)
                        picked = nil
                        trying(nil)
                        MathAudio.shared.play("tap", volume: 0.5)
                    }
                    .font(.system(.subheadline, design: .rounded).weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 24)
        }
        .onAppear { picked = placed }
    }

    private func row(_ item: HouseItem) -> some View {
        let owned = house.state.owns(item), here = placed == item, on = picked == item
        let afford = house.state.canAfford(coins: item.coins, gems: item.gems)
        return Button {
            picked = item
            // Seen in the room first, whether or not it's theirs.
            trying(item)
            if owned, !here {
                house.place(item, in: spot, of: room.id)
                MathAudio.shared.play("equip", volume: 0.6)
            } else {
                MathAudio.shared.play("tap", volume: 0.4)
            }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).font(.system(.headline, design: .rounded).weight(.heavy))
                    Text(item.blurb).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 6)
                if here {
                    Label("Here", systemImage: "checkmark").font(.system(.subheadline, design: .rounded).weight(.heavy)).foregroundStyle(.green)
                } else if owned {
                    Text("Yours").font(.system(.subheadline, design: .rounded).weight(.heavy)).foregroundStyle(.secondary)
                } else if on {
                    Button {
                        if house.place(item, in: spot, of: room.id) {
                            MathAudio.shared.play("buy", volume: 0.7)
                            trying(item)
                        } else {
                            refused += 1
                            MathAudio.shared.play("deny", volume: 0.6)
                        }
                    } label: {
                        VStack(spacing: 1) {
                            Text(afford ? "Buy" : "Not yet").font(.system(.caption, design: .rounded).weight(.heavy))
                            HousePrice(coins: item.coins, gems: item.gems)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .foregroundStyle(afford ? .white : .primary)
                    }
                    .glassEffect(.regular.tint(afford ? TuttlesLook.accent : .gray.opacity(0.4)).interactive(), in: .capsule)
                    .sensoryFeedback(.error, trigger: refused)
                } else {
                    HousePrice(coins: item.coins, gems: item.gems).opacity(afford ? 1 : 0.5)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? TuttlesLook.accent.opacity(0.14) : Color.primary.opacity(0.05), in: .rect(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(TuttlesLook.accent, lineWidth: on ? 2 : 0))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Buying a room

/// Rooms: the way to move one they have, then the rooms still to have and what each costs. Picking one
/// goes on to where it goes.
struct HouseRoomSheet: View {
    /// They want to move a room: on to picking which.
    let move: () -> Void
    let picked: (HouseRoom) -> Void
    @State private var refused = 0
    private let house = HouseStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Rooms").font(.system(.title3, design: .rounded).weight(.heavy))
                Spacer()
                HousePurse()
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    // (One room has nowhere else to go.)
                    if house.state.rooms.count > 1 {
                        Button(action: move) {
                            HStack(spacing: 12) {
                                Image(systemName: "arrow.up.and.down.and.arrow.left.and.right")
                                    .font(.title3.weight(.bold))
                                    .foregroundStyle(TuttlesLook.accent)
                                    .frame(width: 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Move a room").font(.system(.headline, design: .rounded).weight(.heavy))
                                    Text("Pick one up and put it somewhere else. Free.").font(.footnote).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 6)
                                Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(.tertiary)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 18))
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                    let left = HouseCatalog.rooms.filter { !house.state.has(room: $0.id) }
                    Text(left.isEmpty ? "You have every room there is." : "Add a room")
                        .font(.system(.footnote, design: .rounded).weight(.heavy))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.top, 8)
                    ForEach(left) { room in row(room) }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 24)
            }
        }
        .sensoryFeedback(.error, trigger: refused)
    }

    private func row(_ room: HouseRoom) -> some View {
        let price = house.state.price(of: room)
        let afford = house.state.canAfford(coins: price.coins, gems: price.gems)
        let fits = house.state.place(for: room.id) != nil
        return Button {
            guard afford, fits else { refused += 1; MathAudio.shared.play("deny", volume: 0.6); return }
            picked(room)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: room.gems > 0 ? "diamond.fill" : "house.fill")
                    .font(.title2)
                    .foregroundStyle(room.gems > 0 ? Color.cyan : TuttlesLook.accent)
                    .frame(width: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(room.name).font(.system(.headline, design: .rounded).weight(.heavy))
                    Text(room.blurb).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                    if !fits {
                        Text("Nowhere it fits yet.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 2) {
                    HousePrice(coins: price.coins, gems: price.gems)
                    if !afford {
                        Text(price.gems > 0 ? "\(price.gems - house.gems) more" : "\((price.coins - house.coins).formatted()) more")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .opacity(afford ? 1 : 0.55)
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 18))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - For the parents

/// What each kid's purse holds and what's been paid into it lately.
struct HousePursesView: View {
    let street: [HouseNeighbour]

    var body: some View {
        NavigationStack {
            List {
                if street.isEmpty {
                    Text("Nothing yet: the houses appear once the kids have opened theirs.").foregroundStyle(.secondary)
                }
                ForEach(street) { kid in
                    Section(kid.name) {
                        if let state = kid.state {
                            let filled = state.filled
                            LabeledContent("Coins", value: "\(state.coins.formatted()) (of \(state.earned.formatted()) earned)")
                            LabeledContent("Gems", value: "\(state.gems) (of \(state.gemsEarned) earned)")
                            LabeledContent("House", value: "\(state.rooms.count) rooms, \(filled.0) of \(filled.1) spots filled")
                            ForEach(Self.lately(state), id: \.day) { day in
                                LabeledContent(day.day, value: day.text)
                            }
                        } else {
                            Text("Hasn't opened the house yet.").foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Purses")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    /// The last week's days, newest first: "Vocab 1,240 · Math 2,900 · 1 gem".
    static func lately(_ state: HouseState) -> [(day: String, text: String)] {
        let days = Array(Set(state.days.map(\.day))).sorted().suffix(7).reversed()
        return days.map { day in
            let paid = state.days.filter { $0.day == day }
            var parts = paid.filter { $0.coins > 0 }.map { "\($0.from == "start" ? "To start" : $0.from.capitalized) \($0.coins.formatted())" }
            let gems = paid.reduce(0) { $0 + $1.gems }
            if gems > 0 { parts.append("\(gems) gem\(gems == 1 ? "" : "s")") }
            return (day, parts.joined(separator: " · "))
        }
    }
}
