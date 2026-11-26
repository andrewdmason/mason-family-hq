import SceneKit
import SwiftUI

// The shop: what stars are for. A turntable at the top shows what's picked
// before it's paid for. The first tab is free: their own hair, skin and
// clothes, so the kid on screen is theirs before they've earned anything.

struct MathShopView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var tab = "you"
    @State private var picked: MathItem?
    @State private var refused = false
    private let math = MathStore.shared

    private var tabs: [(id: String, title: String)] { [("you", "You")] + MathCatalog.slots }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                MathPreview(look: previewLook, height: previewHeight, board: previewBoard, trail: previewTrail)
                    .frame(height: 250)
                    .background(LinearGradient(colors: [Color(red: 0.55, green: 0.8, blue: 0.95), Color(red: 0.93, green: 0.9, blue: 0.8)], startPoint: .top, endPoint: .bottom))
                HStack {
                    Button("Done") { dismiss() }
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        .padding(.horizontal, 16).padding(.vertical, 9)
                        .glassEffect(.regular.interactive(), in: .capsule)
                    Spacer()
                    MathStarsPill(stars: math.stars)
                }
                .padding(14)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tabs, id: \.id) { t in
                        Button {
                            tab = t.id
                            picked = nil
                            MathAudio.shared.play("tap", volume: 0.5)
                        } label: {
                            Text(t.title)
                                .font(.system(.subheadline, design: .rounded).weight(.heavy))
                                .foregroundStyle(tab == t.id ? .white : .primary)
                                .padding(.horizontal, 16).padding(.vertical, 9)
                                .background(tab == t.id ? TuttlesLook.accent : Color.primary.opacity(0.08), in: .capsule)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
            }
            ScrollView {
                if tab == "you" {
                    MathLookEditor()
                        .padding(.horizontal, 14)
                } else {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        ForEach(MathCatalog.items(in: tab)) { item in
                            Button {
                                picked = item
                                MathAudio.shared.play("tap", volume: 0.5)
                            } label: { card(item) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 14)
                }
                Color.clear.frame(height: 96)
            }
        }
        .overlay(alignment: .bottom) {
            if let item = picked, tab != "you" { action(item) }
        }
        .background(Color.tuttlesPage)
        .presentationDragIndicator(.visible)
    }

    // MARK: What the turntable shows

    private var previewItem: MathItem? { picked ?? (tab == "you" ? nil : math.worn(tab)) }

    private var previewLook: MathLook {
        var look = math.look
        guard let item = previewItem else { return tab == "you" ? withOwnClothes(math.ownLook) : look }
        switch item.what {
        case .outfit(let body, let top, let bottom, let shoes):
            if top.isEmpty { look = withOwnClothes(math.ownLook); look.finish = math.look.finish } else {
                look.body = body; look.top = top; look.bottom = bottom; look.shoes = shoes
            }
        case .finish(let finish): look.finish = finish
        case .teacher(var teacher, _):
            if item.id == "teacher-you" { teacher.head = look.head; teacher.body = look.body }
            look = teacher
        case .board, .trail: break
        }
        return look
    }

    private func withOwnClothes(_ look: MathLook) -> MathLook { look }

    private var previewHeight: Float {
        if let item = previewItem, case .teacher(_, let height) = item.what { return height }
        return 1.25
    }

    private var previewBoard: [String]? {
        guard tab == "board", let item = previewItem, case .board(let deck, let wheels) = item.what else { return nil }
        return [deck, wheels]
    }

    private var previewTrail: String? {
        guard tab == "trail", let item = previewItem, case .trail(let color) = item.what else { return nil }
        return color
    }

    // MARK: Cards

    private func swatches(_ item: MathItem) -> [Color] {
        switch item.what {
        case .outfit(_, let top, let bottom, let shoes):
            let own = math.ownLook
            return [top.isEmpty ? own.top : top, bottom.isEmpty ? own.bottom : bottom, shoes.isEmpty ? own.shoes : shoes].map { Color(MathLookKit.color($0)) }
        case .finish(let f):
            switch f {
            case .normal: return [Color(MathLookKit.color(math.ownLook.skin))]
            case .gold: return [.yellow, .orange]
            case .chrome: return [.white, .gray]
            case .ghost: return [Color(red: 0.86, green: 0.93, blue: 1).opacity(0.6)]
            case .shadow: return [.black, .white]
            case .neon: return [.green, .pink, .cyan]
            case .negative: return [.cyan, .black, .white]
            }
        case .board(let deck, let wheels): return [Color(MathLookKit.color(deck)), Color(MathLookKit.color(wheels))]
        case .trail(let color): return color.map { [Color(MathLookKit.color($0))] } ?? [Color.primary.opacity(0.1)]
        case .teacher(let look, _): return [look.hair, look.top, look.bottom].map { Color(MathLookKit.color($0)) }
        }
    }

    private func card(_ item: MathItem) -> some View {
        let owned = math.owns(item), on = math.wearing(item)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 0) {
                ForEach(Array(swatches(item).enumerated()), id: \.offset) { _, color in color }
            }
            .frame(height: 44)
            .clipShape(.rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.12)))
            Text(item.name).font(.system(.subheadline, design: .rounded).weight(.heavy)).lineLimit(1).minimumScaleFactor(0.75)
            HStack(spacing: 4) {
                if on {
                    Label("On", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                } else if owned {
                    Text("Yours").foregroundStyle(.secondary)
                } else {
                    Image(systemName: "star.fill").foregroundStyle(.yellow)
                    Text(item.price.formatted()).foregroundStyle(math.stars >= item.price ? Color.primary : Color.secondary)
                }
            }
            .font(.system(.footnote, design: .rounded).weight(.bold))
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.tuttlesCard, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(picked == item ? TuttlesLook.accent : .clear, lineWidth: 3))
    }

    private func action(_ item: MathItem) -> some View {
        let owned = math.owns(item), on = math.wearing(item)
        return VStack(spacing: 8) {
            Text(item.blurb)
                .font(.system(.subheadline, design: .serif).italic())
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button {
                if on { return }
                if owned {
                    math.wear(item)
                    MathAudio.shared.play("equip")
                } else if math.buy(item) {
                    MathAudio.shared.play("buy")
                } else {
                    MathAudio.shared.play("deny")
                    refused.toggle()
                }
            } label: {
                Group {
                    if on {
                        Label("Wearing it", systemImage: "checkmark")
                    } else if owned {
                        Text(item.slot == "teacher" ? "Be chased by them" : "Put it on")
                    } else if math.stars >= item.price {
                        Label("Buy for \(item.price.formatted())", systemImage: "star.fill")
                    } else {
                        Label("\((item.price - math.stars).formatted()) more stars", systemImage: "lock.fill")
                    }
                }
                .font(.system(.headline, design: .rounded).weight(.heavy))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 54)
            }
            .glassEffect(.regular.tint(on ? .green : owned || math.stars >= item.price ? TuttlesLook.accent : .gray).interactive(), in: .capsule)
            .modifier(MathShake(trigger: refused))
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(.regularMaterial)
    }
}

private struct MathShake: ViewModifier {
    let trigger: Bool
    @State private var offset: CGFloat = 0

    func body(content: Content) -> some View {
        content.offset(x: offset).onChange(of: trigger) {
            withAnimation(.linear(duration: 0.06).repeatCount(5, autoreverses: true)) { offset = 8 }
            Task {
                try? await Task.sleep(for: .seconds(0.32))
                withAnimation(.linear(duration: 0.05)) { offset = 0 }
            }
        }
    }
}

/// Their own look: which head, and the colours of hair, skin and their own clothes.
struct MathLookEditor: View {
    @State private var look = MathStore.shared.ownLook
    private let math = MathStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            section("Hair") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(MathLook.heads.enumerated()), id: \.offset) { i, head in
                            Button { change { $0.head = head } } label: {
                                Text("\(i + 1)")
                                    .font(.system(.headline, design: .rounded).weight(.heavy))
                                    .frame(width: 46, height: 46)
                                    .foregroundStyle(look.head == head ? .white : .primary)
                                    .background(look.head == head ? TuttlesLook.accent : Color.primary.opacity(0.08), in: .circle)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Hair style \(i + 1)")
                        }
                    }
                }
                colors(MathCatalog.hairs, selected: look.hair) { c in change { $0.hair = c } }
            }
            section("Skin") { colors(MathCatalog.skins, selected: look.skin) { c in change { $0.skin = c } } }
            section("Top") { colors(MathCatalog.clothes, selected: look.top) { c in change { $0.top = c } } }
            section("Bottoms") { colors(MathCatalog.clothes, selected: look.bottom) { c in change { $0.bottom = c } } }
            section("Shoes") { colors(MathCatalog.clothes, selected: look.shoes) { c in change { $0.shoes = c } } }
            Text("Free. This is you under whatever you buy.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func change(_ edit: (inout MathLook) -> Void) {
        edit(&look)
        look.finish = .normal
        math.setOwnLook(look)
        MathAudio.shared.play("equip", volume: 0.5)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(.caption, design: .rounded).weight(.heavy)).textCase(.uppercase).foregroundStyle(.secondary)
            content()
        }
    }

    private func colors(_ list: [String], selected: String, pick: @escaping (String) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(list, id: \.self) { hex in
                    Button { pick(hex) } label: {
                        Circle().fill(Color(MathLookKit.color(hex)))
                            .frame(width: 40, height: 40)
                            .overlay(Circle().strokeBorder(Color.primary.opacity(0.15)))
                            .overlay(Circle().strokeBorder(TuttlesLook.accent, lineWidth: selected == hex ? 4 : 0).padding(-4))
                            .padding(4)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// A character on a turntable.
struct MathPreview: UIViewRepresentable {
    let look: MathLook
    var height: Float = 1.25
    var board: [String]?
    var trail: String?

    final class Coordinator: NSObject, SCNSceneRendererDelegate {
        var character: MathCharacter?
        var height: Float = 0
        var extras = SCNNode()
        var key = ""
        var last: TimeInterval = 0
        let turntable = SCNNode()

        func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
            let dt = last == 0 ? 0 : Float(time - last)
            last = time
            character?.update(min(dt, 0.05))
            turntable.eulerAngles.y += dt * 0.7
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        let scene = SCNScene()
        view.backgroundColor = .clear
        scene.rootNode.addChildNode(context.coordinator.turntable)
        let disc = MathShape.cylinder(1.1, 0.08, MathMat.color("ffffff", alpha: 0.5), segments: 28)
        disc.position.y = -0.04
        scene.rootNode.addChildNode(disc)
        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 38
        camera.position = SCNVector3(0, 1.25, 4.4)
        camera.look(at: SCNVector3(0, 0.85, 0))
        scene.rootNode.addChildNode(camera)
        let sun = SCNNode()
        sun.light = SCNLight()
        sun.light?.type = .directional
        sun.light?.intensity = 850
        sun.light?.castsShadow = true
        sun.light?.shadowColor = UIColor(white: 0, alpha: 0.25)
        sun.eulerAngles = SCNVector3(-0.9, 0.6, 0)
        scene.rootNode.addChildNode(sun)
        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.intensity = 560
        scene.rootNode.addChildNode(ambient)
        view.scene = scene
        view.delegate = context.coordinator
        view.isPlaying = true
        view.rendersContinuously = true
        view.antialiasingMode = .multisampling2X
        context.coordinator.turntable.addChildNode(context.coordinator.extras)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        let c = context.coordinator
        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0
        if c.character == nil || c.height != height {
            c.character?.node.removeFromParentNode()
            let made = MathCharacter(look: look, height: height)
            made.node.eulerAngles.y = .pi
            made.play("idle")
            c.turntable.addChildNode(made.node)
            c.character = made
            c.height = height
        } else {
            c.character?.setLook(look)
        }
        let key = "\(board ?? [])|\(trail ?? "")"
        if key != c.key {
            c.key = key
            c.extras.childNodes.forEach { $0.removeFromParentNode() }
            c.character?.node.position.y = 0
            c.character?.play(trail != nil ? "sprint" : "idle")
            if let board, board.count == 2 {
                c.extras.add(MathShape.box(0.42, 0.06, 1.15, MathMat.color(board[0]), round: 0.03), 0, 0.12, 0)
                for z: Float in [-0.38, 0.38] {
                    for x: Float in [-0.16, 0.16] {
                        let wheel = MathShape.cylinder(0.07, 0.06, MathMat.color(board[1]), segments: 8)
                        wheel.eulerAngles.z = .pi / 2
                        c.extras.add(wheel, x, 0.05, z)
                    }
                }
                c.character?.node.position.y = 0.16
            }
            if let trail {
                let t = SCNParticleSystem()
                t.soft()
                t.birthRate = 70
                t.particleLifeSpan = 0.7
                t.particleSize = 0.14
                t.particleColor = MathLookKit.color(trail)
                t.particleVelocity = 1.6
                t.emittingDirection = SCNVector3(0, 0.2, -1)
                t.spreadingAngle = 25
                t.blendMode = .additive
                let source = SCNNode()
                source.addParticleSystem(t)
                c.extras.add(source, 0, 0.6, -0.3)
            }
        }
        SCNTransaction.commit()
    }
}
