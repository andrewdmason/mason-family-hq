import SceneKit
import SwiftUI

// Their own look: a turntable, and the hair, skin and clothes to change. It's
// free, so the kid on screen is theirs from the start. (What the game pays is
// spent on the house: iPhone/House.)

struct MathLookView: View {
    @Environment(\.dismiss) private var dismiss
    private let math = MathStore.shared

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                MathPreview(look: math.look)
                    .frame(height: 250)
                    .background(LinearGradient(colors: [Color(red: 0.55, green: 0.8, blue: 0.95), Color(red: 0.93, green: 0.9, blue: 0.8)], startPoint: .top, endPoint: .bottom))
                HStack {
                    Button("Done") { dismiss() }
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        .padding(.horizontal, 16).padding(.vertical, 9)
                        .glassEffect(.regular.interactive(), in: .capsule)
                    Spacer()
                }
                .padding(14)
            }
            ScrollView {
                MathLookEditor()
                    .padding(.horizontal, 14)
                    .padding(.top, 14)
                Color.clear.frame(height: 40)
            }
        }
        .background(Color.tuttlesPage)
        .presentationDragIndicator(.visible)
    }
}

/// Their own look: which head, and the colours of hair, skin and their own clothes.
struct MathLookEditor: View {
    @State private var look = MathStore.shared.look
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
                colors(MathCast.hairs, selected: look.hair) { c in change { $0.hair = c } }
            }
            section("Skin") { colors(MathCast.skins, selected: look.skin) { c in change { $0.skin = c } } }
            section("Top") { colors(MathCast.clothes, selected: look.top) { c in change { $0.top = c } } }
            section("Bottoms") { colors(MathCast.clothes, selected: look.bottom) { c in change { $0.bottom = c } } }
            section("Shoes") { colors(MathCast.clothes, selected: look.shoes) { c in change { $0.shoes = c } } }
            Text("This is you, in Math and in your house.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func change(_ edit: (inout MathLook) -> Void) {
        edit(&look)
        look.finish = .normal
        math.setLook(look)
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
