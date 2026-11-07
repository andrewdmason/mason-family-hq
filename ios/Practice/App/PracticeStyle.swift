import MasonKit
import SwiftUI

/// The app's look: warm paper and ember, with Liquid Glass on top. The glass
/// needs something under it to bend, so the screen sits on a soft mesh of the
/// house colors that warms up while a timer runs.
enum PracticeStyle {
    /// A timer running: the live clock, the running tile's tint.
    static let ember = Color(red: 0.90, green: 0.36, blue: 0.20)
    /// The house brown, lifted to caramel in the dark so it still reads.
    static let accent = Color(light: Theme.accent, dark: Color(red: 0.93, green: 0.64, blue: 0.44))
    /// The rotation's next piece.
    static let due = Color(red: 0.93, green: 0.63, blue: 0.18)
    /// The rotation's color as text, dark enough to read on paper.
    static let dueText = Color(light: Color(red: 0.72, green: 0.42, blue: 0.04), dark: Color(red: 0.98, green: 0.72, blue: 0.30))
    /// A goal met.
    static let done = Color(red: 0.33, green: 0.64, blue: 0.43)

    static let tileRadius: CGFloat = 26
    static let segmentRadius: CGFloat = 20

    /// What a piece is, at a glance.
    static func symbol(forKind kind: String) -> String {
        switch kind {
        case "technique": "metronome.fill"
        case "sight_reading": "eye.fill"
        default: "music.note"
        }
    }
}

/// The backdrop: a still mesh of paper, peach and rose (embers and umber in
/// the dark), brighter at the bottom while a timer runs.
struct PracticeBackground: View {
    let running: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [0.55, 0.45], [1, 0.5],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: colors
        )
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.8), value: running)
    }

    private var colors: [Color] {
        if scheme == .dark {
            let base = Color(red: 0.09, green: 0.06, blue: 0.05)
            let umber = Color(red: 0.20, green: 0.11, blue: 0.07)
            let wine = Color(red: 0.22, green: 0.08, blue: 0.09)
            let glow = running ? Color(red: 0.45, green: 0.15, blue: 0.07) : Color(red: 0.24, green: 0.13, blue: 0.08)
            return [
                umber, base, wine,
                base, umber, base,
                wine, glow, umber,
            ]
        }
        let paper = Theme.paper
        let peach = Color(red: 0.98, green: 0.86, blue: 0.75)
        let rose = Color(red: 0.97, green: 0.83, blue: 0.80)
        let butter = Color(red: 0.98, green: 0.92, blue: 0.78)
        let glow = running ? Color(red: 1.0, green: 0.72, blue: 0.58) : peach
        return [
            peach, paper, rose,
            paper, butter, paper,
            rose, glow, butter,
        ]
    }
}

/// A piece's kind as a small round badge, lit up while it's timing.
struct KindBadge: View {
    let kind: String
    let running: Bool
    var size: CGFloat = 38

    var body: some View {
        Image(systemName: PracticeStyle.symbol(forKind: kind))
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(running ? Color.white : PracticeStyle.accent)
            .symbolEffect(.pulse, isActive: running)
            .frame(width: size, height: size)
            .background {
                Circle().fill(running ? AnyShapeStyle(PracticeStyle.ember.gradient) : AnyShapeStyle(PracticeStyle.accent.opacity(0.14)))
            }
    }
}

/// Today against what's planned: a ring that fills as the day does.
struct GoalRing: View {
    let progress: Double
    let running: Bool
    var lineWidth: CGFloat = 9

    var body: some View {
        ZStack {
            Circle().stroke(PracticeStyle.accent.opacity(0.14), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.001, min(1, progress)))
                .stroke(
                    progress >= 1 ? AnyShapeStyle(PracticeStyle.done.gradient) : AnyShapeStyle(
                        AngularGradient(colors: [PracticeStyle.due, PracticeStyle.ember], center: .center, startAngle: .degrees(0), endAngle: .degrees(360 * max(0.2, progress)))
                    ),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            Image(systemName: progress >= 1 ? "checkmark" : running ? "waveform" : "music.note")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(progress >= 1 ? PracticeStyle.done : running ? PracticeStyle.ember : PracticeStyle.accent)
                .symbolEffect(.variableColor.iterative.reversing, isActive: running && progress < 1)
                .contentTransition(.symbolEffect(.replace))
        }
        .animation(.smooth, value: progress)
    }
}

/// The share of a goal practiced, as a tint pouring in from the leading
/// edge of a tile. Drawn under the tile's content, over its glass.
struct ProgressFill: View {
    let progress: Double
    let tint: Color

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width * max(0, min(1, progress))
            // A soft leading edge, so it reads as filling up rather than a bar.
            let feather = width > 0 ? max(0, 1 - 36 / width) : 0
            Rectangle()
                .fill(LinearGradient(colors: [tint.opacity(0.08), tint.opacity(0.22)], startPoint: .leading, endPoint: .trailing))
                .mask {
                    LinearGradient(
                        stops: [.init(color: .black, location: 0), .init(color: .black, location: feather), .init(color: .clear, location: 1)],
                        startPoint: .leading, endPoint: .trailing
                    )
                }
                .frame(width: width)
                .animation(.smooth(duration: 0.6), value: progress)
        }
        .allowsHitTesting(false)
    }
}

extension Color {
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }
}
