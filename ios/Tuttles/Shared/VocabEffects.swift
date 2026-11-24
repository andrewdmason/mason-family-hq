import SwiftUI

// Vocab's flourishes: the sparks off a right answer, the confetti at a
// finish, the boss's bar. None of them carries anything that isn't said in
// words as well, and they all stand down for Reduce Motion.

extension VocabLook {
    static let gold = Color(red: 0.99, green: 0.78, blue: 0.18)
    /// The boss round's own colour.
    static let boss = Color(red: 0.47, green: 0.31, blue: 0.86)
    static let bossText = Color(light: Color(red: 0.36, green: 0.22, blue: 0.72), dark: Color(red: 0.76, green: 0.67, blue: 0.99))
}

/// The same "random" number every time for a piece and what it's for, so a
/// piece keeps its path from one frame to the next.
private func scatter(_ piece: Int, _ salt: Int) -> Double {
    let x = sin(Double(piece) * 127.1 + Double(salt) * 311.7) * 43_758.5453
    return x - x.rounded(.down)
}

/// Sparks flying out from the middle of wherever it's put: a right answer.
/// Bigger, and gold with stars in it, for a word just mastered.
struct VocabBurst: View {
    var big = false
    @State private var start = Date()
    @State private var over = false
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let length = big ? 1.1 : 0.7
        Group {
            if !still, !over {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in
                        let t = min(1, timeline.date.timeIntervalSince(start) / length)
                        // Fast out, then slowing.
                        let out = 1 - pow(1 - t, 3)
                        let middle = CGPoint(x: size.width / 2, y: size.height / 2)
                        for piece in 0..<(big ? 34 : 20) {
                            let angle = scatter(piece, 1) * 2 * Double.pi
                            let reach = (50 + scatter(piece, 2) * 90) * (big ? 1.5 : 1) * out
                            // Wider than tall, like the row it comes off.
                            let at = CGPoint(x: middle.x + cos(angle) * reach * 1.5, y: middle.y + sin(angle) * reach * 0.75 + 30 * t * t)
                            let radius = (4 + scatter(piece, 3) * 5) * (big ? 1.3 : 1) * (1 - t * 0.6)
                            let colour = big ? (piece % 3 == 0 ? Color.white : VocabLook.gold)
                                : [VocabLook.right, VocabLook.gold, Color(red: 0.45, green: 0.85, blue: 0.62)][piece % 3]
                            context.opacity = 1 - t * t
                            if big, piece % 2 == 0 {
                                context.fill(Self.star(at: at, radius: radius * 2.2), with: .color(colour))
                            } else {
                                context.fill(Path(ellipseIn: CGRect(x: at.x - radius, y: at.y - radius, width: radius * 2, height: radius * 2)),
                                             with: .color(colour))
                            }
                        }
                    }
                }
            }
        }
        .frame(width: 380, height: 260)
        .allowsHitTesting(false)
        .task {
            try? await Task.sleep(for: .seconds(length))
            over = true
        }
    }

    private static func star(at centre: CGPoint, radius: CGFloat) -> Path {
        var path = Path()
        for point in 0..<8 {
            let angle = Double(point) * Double.pi / 4 - Double.pi / 2
            let r = point % 2 == 0 ? radius : radius * 0.38
            let p = CGPoint(x: centre.x + cos(angle) * r, y: centre.y + sin(angle) * r)
            if point == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }
}

/// Confetti coming down the whole screen, once: the day's ten minutes done, a
/// stage cleared, a boss beaten.
struct VocabConfetti: View {
    @State private var start = Date()
    @State private var over = false
    @Environment(\.accessibilityReduceMotion) private var still

    private static let length = 4.2
    private static let colours: [Color] = [
        TuttlesLook.accent, VocabLook.gold, VocabLook.right, VocabLook.boss,
        Color(red: 0.25, green: 0.62, blue: 0.93), Color(red: 0.98, green: 0.50, blue: 0.12),
    ]

    var body: some View {
        Group {
            if !still, !over {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in
                        let t = timeline.date.timeIntervalSince(start)
                        for piece in 0..<110 {
                            let life = t - scatter(piece, 1) * 1.1
                            guard life > 0 else { continue }
                            let fall = 170 + scatter(piece, 2) * 240
                            let y = -24 + life * fall + 70 * life * life
                            guard y < size.height + 24 else { continue }
                            let x = scatter(piece, 3) * size.width + sin(life * (2 + scatter(piece, 4) * 3) + scatter(piece, 5) * 6.28) * 26
                            var piece2 = context
                            piece2.translateBy(x: x, y: y)
                            piece2.rotate(by: .radians(life * (2 + scatter(piece, 6) * 5)))
                            // Turning over as it falls.
                            piece2.scaleBy(x: 1, y: cos(life * (3 + scatter(piece, 7) * 5)))
                            piece2.opacity = min(1, max(0, Self.length - t))
                            let w = 7 + scatter(piece, 8) * 5
                            piece2.fill(Path(roundedRect: CGRect(x: -w / 2, y: -w * 0.7, width: w, height: w * 1.4), cornerRadius: 2),
                                        with: .color(Self.colours[piece % Self.colours.count]))
                        }
                    }
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .task {
            try? await Task.sleep(for: .seconds(Self.length))
            over = true
        }
    }
}

/// A quick side-to-side shake each time `animatableData` goes up by one.
struct VocabShake: GeometryEffect {
    var travel: CGFloat = 7
    var animatableData: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: travel * sin(animatableData * .pi * 4), y: 0))
    }
}

/// A number that counts up to where it's going when it comes on screen.
struct VocabCountUp: View {
    let value: Int
    @State private var shown = 0

    var body: some View {
        Text("\(shown)")
            .monospacedDigit()
            .contentTransition(.numericText(value: Double(shown)))
            .onAppear { withAnimation(.snappy(duration: 0.7).delay(0.25)) { shown = value } }
            .onChange(of: value) { _, new in withAnimation(.snappy) { shown = new } }
    }
}

/// The boss's strength at the top of a boss round: every right answer takes
/// some off, and it's beaten when there's none left.
struct VocabBossBar: View {
    let boss: VocabBoss

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Image(systemName: "bolt.fill").symbolEffect(.bounce, value: boss.correct)
                Text(boss.hitsLeft == 0 ? "Boss beaten!" : "Boss · \(boss.hitsLeft) to go")
                    .contentTransition(.numericText(value: Double(boss.hitsLeft)))
                Spacer(minLength: 4)
                // The miss it allows, while it's still to spend.
                if boss.spare > 0 {
                    Image(systemName: boss.sparesLeft > 0 ? "heart.fill" : "heart.slash")
                        .foregroundStyle(boss.sparesLeft > 0 ? VocabLook.wrong : Color.secondary)
                        .contentTransition(.symbolEffect(.replace))
                        .accessibilityLabel(boss.sparesLeft > 0 ? "One miss allowed" : "No misses left")
                }
                Text("\(min(boss.answered + (boss.over ? 0 : 1), boss.total)) of \(boss.total)").foregroundStyle(.secondary)
            }
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(VocabLook.bossText)
            .lineLimit(1)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.10))
                    Capsule()
                        .fill(LinearGradient(colors: [VocabLook.boss, Color(red: 0.78, green: 0.30, blue: 0.80)], startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(0, geo.size.width * Double(boss.hitsLeft) / Double(max(1, boss.needed))))
                }
            }
            .frame(height: 9)
            .modifier(VocabShake(animatableData: CGFloat(boss.correct)))
        }
        .animation(.spring(duration: 0.45, bounce: 0.3), value: boss.correct)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Boss round, \(boss.hitsLeft) more right answers to win")
    }
}

/// Lays its views out in rows, starting a new one when the last is full.
struct VocabFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        return CGSize(width: proposal.width ?? rows.width, height: rows.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (view, at) in zip(subviews, arrange(subviews, width: bounds.width).places) {
            view.place(at: CGPoint(x: bounds.minX + at.x, y: bounds.minY + at.y), proposal: .unspecified)
        }
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> (places: [CGPoint], width: CGFloat, height: CGFloat) {
        var places: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += row + spacing
                row = 0
            }
            places.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            row = max(row, size.height)
            widest = max(widest, x - spacing)
        }
        return (places, widest, y + row)
    }
}
