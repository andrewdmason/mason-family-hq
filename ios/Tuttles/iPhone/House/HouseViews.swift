import SceneKit
import SwiftUI

// The house's screens. One scene (HouseScene.swift) under everything: the
// street with both houses on it, then a house, then a room. Their own house
// can be changed: a room in focus has a bubble on each spot, and tapping one
// brings up what can go there, tried in the room before it's paid for. In the
// house they add rooms, putting each where they like, and move them about
// (HouseLayout.swift); a house of more than one floor can be looked at a
// floor at a time. The
// other house can be walked through and not touched. The parents see the
// street the same way, and what each purse has had paid in.

/// Coins and gems, wherever they're shown.
struct HousePurse: View {
    private let house = HouseStore.shared

    var body: some View {
        HStack(spacing: 8) {
            pill("circle.fill", .yellow, house.coins)
            pill("diamond.fill", .cyan, house.gems)
        }
    }

    private func pill(_ symbol: String, _ color: Color, _ n: Int) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).foregroundStyle(color)
            Text(n.formatted()).font(.system(.headline, design: .rounded).weight(.heavy).monospacedDigit())
                .contentTransition(.numericText())
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 9)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(n) \(symbol == "circle.fill" ? "coins" : "gems")")
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

    final class Coordinator: NSObject {
        var parent: HouseSceneView
        init(_ parent: HouseSceneView) { self.parent = parent }

        @objc func tap(_ g: UITapGestureRecognizer) {
            guard let view = g.view as? SCNView else { return }
            parent.tapped(parent.stage.hit(g.location(in: view), in: view))
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
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        context.coordinator.parent = self
        if view.bounds.height > 0 { stage.setAspect(Float(view.bounds.width / view.bounds.height)) }
    }
}

struct HouseHomeView: View {
    @Environment(ChatStore.self) private var store
    @State private var stage = HouseStage()
    @State private var focus = HouseStage.Focus.street
    @State private var ready = false
    /// The spot being chosen for, and the room to buy.
    @State private var choosing: Choosing?
    @State private var adding = false
    /// A room being put somewhere: one to buy, or one of theirs to move.
    @State private var placing: Placing?
    /// Waiting for them to tap the room they want to move.
    @State private var moving = false
    /// The highest floor shown (nil: all of it).
    @State private var floor: Int?
    @State private var showingPurses = false
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
        .task {
            guard !ready else { return }
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
                go(.house(me))
                setFloor(n)
            }
            if let at = args.firstIndex(of: "--house-add"), args.count > at + 1, let room = HouseCatalog.room(args[at + 1]), !house.state.has(room: room.id) {
                go(.house(me))
                place(.new(room))
            }
            if let at = args.firstIndex(of: "--house-room") {
                let id = args.count > at + 1 && HouseCatalog.room(args[at + 1]) != nil ? args[at + 1] : HouseCatalog.first
                if house.state.has(room: id) { go(.room(me, id)) }
            }
            await house.sync(with: store)
            show()
        }
        .onDisappear { Task { await house.sync(with: store) } }
        .sheet(item: $choosing, onDismiss: { stage.setLifted(false); refresh(); Task { await house.sync(with: store) } }) { choice in
            HouseSpotSheet(room: choice.room, spot: choice.spot) { preview in
                refresh(trying: preview.map { (choice, $0) }, popping: choice.id)
            }
            .presentationDetents([.fraction(0.46)])
            .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.46)))
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $adding) {
            HouseRoomSheet { room in
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
        stage.show(shown())
        stage.setDecorating(mine(focus))
        stage.focus(on: focus, animated: false)
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

    private func go(_ to: HouseStage.Focus) {
        if placing != nil || moving { stopPlacing() }
        if case .house = to {} else if floor != nil { setFloor(nil) }
        focus = to
        stage.setDecorating(mine(to))
        stage.focus(on: to)
        MathAudio.shared.play("tap", volume: 0.4)
    }

    private func tapped(_ hit: HouseStage.Hit?) {
        guard choosing == nil else { return }
        switch hit {
        case .spot(_, let roomID, let spotID):
            guard let room = HouseCatalog.room(roomID), let spot = room.spot(spotID) else { return }
            stage.setLifted(true)
            choosing = Choosing(room: room, spot: spot)
            MathAudio.shared.play("tap", volume: 0.4)
        case .cell(_, let cell):
            put(at: cell)
        case .room(let kid, let roomID):
            if moving, kid == me {
                moving = false
                place(.move(roomID))
            } else if placing == nil, focus != .room(kid, roomID) {
                go(.room(kid, roomID))
            }
        case .house(let kid):
            if case .street = focus { go(.house(kid)) }
        case nil:
            break
        }
    }

    // MARK: Where rooms go

    /// Show where a room could go, for them to tap one.
    private func place(_ what: Placing) {
        placing = what
        moving = false
        stage.setPlacing((what.room, house.state.places(for: what.room)))
        MathAudio.shared.play("tap", volume: 0.4)
    }

    private func stopPlacing() {
        placing = nil
        moving = false
        stage.setPlacing(nil)
    }

    /// They've tapped where it goes.
    private func put(at cell: [Int]) {
        guard let placing else { return }
        switch placing {
        case .new(let room):
            guard house.unlock(room, at: cell) else { MathAudio.shared.play("deny", volume: 0.6); return }
            MathAudio.shared.play("goal", volume: 0.7)
            stopPlacing()
            show()
            go(.room(me, room.id))
        case .move(let id):
            guard house.move(id, to: cell) else { MathAudio.shared.play("deny", volume: 0.6); return }
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

    /// The floors of the house in focus, lowest first, and those a room being placed could go on.
    private var floors: [Int] {
        guard case .house(let kid) = focus else { return [] }
        let state = kid == me && !parents ? house.state : house.street.first { $0.kid == kid }?.state
        var out = Set(state?.floors ?? [])
        if placing != nil, kid == me, let cells = stage.placing?.cells { out.formUnion(cells.map { $0[1] }) }
        return out.sorted()
    }

    private func back() {
        if placing != nil || moving { stopPlacing(); return }
        switch focus {
        case .street: break
        case .house: go(.street)
        case .room(let kid, let id):
            go(.house(kid))
            // Back out onto the floor that room's on, like going upstairs and looking round.
            let state = kid == me && !parents ? house.state : house.street.first { $0.kid == kid }?.state
            if let state, state.floors.count > 1, state.has(room: id) { setFloor(state.cell(of: id)[1]) }
        }
    }

    // MARK: Over the scene

    private var title: String {
        switch focus {
        case .street:
            return stage.focus == .street && house.others.isEmpty && !parents ? "Your house. Tap it to go in." : "Tap a house to go in"
        case .house(let kid):
            if let placing {
                let room = HouseCatalog.room(placing.room)?.name ?? "room"
                if case .new = placing { return "Tap where the \(room.lowercased()) goes" }
                return "Tap where to move the \(room.lowercased())"
            }
            if moving { return "Tap the room to move" }
            return mine(focus) ? "Tap a room to decorate it" : "\(name(kid))'s house"
        case .room(let kid, let id):
            let room = HouseCatalog.room(id)?.name ?? ""
            return mine(focus) ? "\(room): tap a bubble" : "\(name(kid))'s \(room.lowercased())"
        }
    }

    private func name(_ kid: String) -> String { house.street.first { $0.kid == kid }?.name ?? "Their" }

    private var overlay: some View {
        VStack(spacing: 10) {
            HStack(alignment: .top) {
                if focus != .street {
                    Button(action: back) {
                        Image(systemName: "chevron.left")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .frame(width: 42, height: 42)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Back")
                }
                Spacer()
                if parents {
                    Button { showingPurses = true } label: {
                        Label("Purses", systemImage: "circle.fill")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .padding(.horizontal, 14).padding(.vertical, 9)
                    }
                    .glassEffect(.regular.interactive(), in: .capsule)
                } else {
                    HousePurse().opacity(choosing == nil ? 1 : 0)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            Text(title)
                .opacity(choosing == nil ? 1 : 0)
                .font(.system(.subheadline, design: .rounded).weight(.heavy))
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(.white.opacity(0.7), in: .capsule)
                .foregroundStyle(Color(red: 0.35, green: 0.23, blue: 0.16))
                .animation(.default, value: focus)
            Spacer()
            if floors.count > 1 { floorPicker }
            if mine(focus), case .house = focus { building }
            if !parents, mine(focus) || focus == .street {
                let filled = house.state.filled
                Text("\(house.state.rooms.count) of \(HouseCatalog.rooms.count) rooms · \(filled.0) of \(filled.1) spots filled")
                    .font(.system(.footnote, design: .rounded).weight(.bold))
                    .foregroundStyle(Color(red: 0.35, green: 0.23, blue: 0.16).opacity(0.8))
                    .padding(.bottom, 12)
            }
        }
        .allowsHitTesting(true)
    }

    /// A floor at a time, or all of it.
    private var floorPicker: some View {
        HStack(spacing: 6) {
            ForEach([nil] + floors.reversed().map(Optional.some), id: \.self) { (f: Int?) in
                let on = floor == f
                Button { setFloor(f); MathAudio.shared.play("tap", volume: 0.4) } label: {
                    Text(f.map(HouseLayout.name(of:)) ?? "All")
                        .font(.system(.footnote, design: .rounded).weight(.heavy))
                        .padding(.horizontal, 11).padding(.vertical, 7)
                        .foregroundStyle(on ? .white : .primary)
                }
                .glassEffect(.regular.tint(on ? TuttlesLook.accent : .clear).interactive(), in: .capsule)
            }
        }
    }

    /// Add a room, or move one; or, while that's going on, stop.
    private var building: some View {
        HStack(spacing: 10) {
            if placing != nil || moving {
                Button { stopPlacing() } label: {
                    Label("Cancel", systemImage: "xmark")
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        .padding(.horizontal, 18).padding(.vertical, 11)
                }
                .glassEffect(.regular.interactive(), in: .capsule)
            } else {
                Button { adding = true } label: {
                    Label("Add a room", systemImage: "plus")
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        .padding(.horizontal, 16).padding(.vertical, 11)
                        .foregroundStyle(.white)
                }
                .glassEffect(.regular.tint(TuttlesLook.accent).interactive(), in: .capsule)
                .disabled(house.state.rooms.count == HouseCatalog.rooms.count)
                if house.state.rooms.count > 1 {
                    Button { moving = true; MathAudio.shared.play("tap", volume: 0.4) } label: {
                        Label("Move a room", systemImage: "arrow.up.and.down.and.arrow.left.and.right")
                            .font(.system(.headline, design: .rounded).weight(.heavy))
                            .padding(.horizontal, 16).padding(.vertical, 11)
                    }
                    .glassEffect(.regular.interactive(), in: .capsule)
                }
            }
        }
    }

    // MARK: For the simulator

    /// `--house-coins 50000 --house-gems 40`, and in the demo a brother's house to look at.
    private func demo() {
        let args = CommandLine.arguments
        func number(_ flag: String) -> Int? { args.firstIndex(of: flag).flatMap { args.count > $0 + 1 ? Int(args[$0 + 1]) : nil } }
        guard store.isDemo || number("--house-coins") != nil else { return }
        var theirs = HouseState()
        theirs.rooms = ["bedroom", "living", "kitchen"]
        theirs.cells = ["bedroom": [0, 0, 0], "living": [0, 0, -1], "kitchen": [-1, 1, -1]]
        theirs.settle()
        for id in ["bedroom.bed.bunk", "bedroom.rug.space", "bedroom.desk.screen", "bedroom.left.shark", "bedroom.pet.dog", "bedroom.walls.sky",
                   "living.sofa.long", "living.tv.modern", "living.rug.zigzag", "living.armchair.relax", "kitchen.fridge.large", "kitchen.table.round",
                   "kitchen.food.cake", "kitchen.floor.diner-checks"] {
            let parts = id.split(separator: ".").map(String.init)
            theirs.owned.append(id)
            theirs.placed["\(parts[0]).\(parts[1])"] = id
        }
        let brother = HouseNeighbour(kid: "brother", name: args.contains("--math-oscar") ? "Sebastian" : "Oscar", me: false, state: theirs,
                                     look: args.contains("--math-oscar") ? .sebastian : .oscar)
        house.demo(coins: number("--house-coins"), gems: number("--house-gems"), fill: number("--house-fill"), street: store.isDemo ? [brother] : house.street)
    }
}

// MARK: - Choosing for a spot

struct HouseSpotSheet: View {
    let room: HouseRoom
    let spot: HouseSpot
    /// Something's being tried in the spot (nil: it's as it really is).
    let trying: (HouseItem?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var picked: HouseItem?
    @State private var refused = 0
    private let house = HouseStore.shared

    private var placed: HouseItem? { house.state.item(in: spot, of: room.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(spot.title).font(.system(.title3, design: .rounded).weight(.heavy))
                    Text(room.name).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                HousePurse()
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 10)
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

/// The rooms still to have, and what each costs. Picking one goes on to where it goes.
struct HouseRoomSheet: View {
    let picked: (HouseRoom) -> Void
    @State private var refused = 0
    private let house = HouseStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Add a room").font(.system(.title3, design: .rounded).weight(.heavy))
                Spacer()
                HousePurse()
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 10)
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(HouseCatalog.rooms.filter { !house.state.has(room: $0.id) }) { room in row(room) }
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
        let fits = !house.state.places(for: room.id).isEmpty
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
                        Text(room.id == "basement" ? "Goes under a room on the ground." : "Nowhere it fits yet.")
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
