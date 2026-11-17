import MasonKit
import SwiftUI

/// The app's look: the Workouts icon's terracotta on warm paper, with Liquid
/// Glass on top. The glass needs something under it to bend, so every screen
/// sits on a soft mesh of clay and sand that turns to sage once the day's
/// workout is done.
enum WorkoutStyle {
    /// The icon's clay (#b85c40), lifted in the dark so it still reads.
    static let accent = Color(light: Color(red: 0.66, green: 0.29, blue: 0.18), dark: Color(red: 0.96, green: 0.62, blue: 0.46))
    /// The icon's clay itself, for filled buttons under white text in either mode.
    static let clay = Color(red: 0xB8 / 255, green: 0x5C / 255, blue: 0x40 / 255)
    /// Estimated 1RMs and anything trending up.
    static let ember = Color(red: 0.90, green: 0.36, blue: 0.20)
    /// Benchmarks and bests.
    static let gold = Color(red: 0.93, green: 0.63, blue: 0.18)
    static let goldText = Color(light: Color(red: 0.62, green: 0.38, blue: 0.03), dark: Color(red: 0.98, green: 0.74, blue: 0.32))
    /// A workout done.
    static let done = Color(red: 0.33, green: 0.64, blue: 0.43)
    static let doneText = Color(light: Color(red: 0.15, green: 0.43, blue: 0.26), dark: Color(red: 0.56, green: 0.86, blue: 0.64))

    static let cardRadius: CGFloat = 28
    static let insetRadius: CGFloat = 16
    /// Room at the end of a scroll, so the last button clears the tab bar's
    /// button when the bar has minimized.
    static let scrollEnd: CGFloat = 60

    /// What a block is, at a glance.
    static func symbol(for type: BlockType) -> String {
        switch type {
        case .warmup: "thermometer.sun.fill"
        case .strength: "dumbbell.fill"
        case .metcon: "flame.fill"
        case .accessory: "figure.strengthtraining.functional"
        case .cooldown: "wind"
        case .skill: "figure.gymnastics"
        }
    }
}

enum WorkoutMood {
    /// Nothing on, or just browsing.
    case rest
    /// A workout open to log.
    case work
    /// Today's done.
    case done
}

/// The backdrop: a still mesh of paper, peach and clay (embers and umber in
/// the dark), warmer with a workout open and sage once it's done.
struct WorkoutBackground: View {
    var mood: WorkoutMood = .rest
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [0.6, 0.42], [1, 0.5],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: colors
        )
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.9), value: mood)
    }

    private var colors: [Color] {
        if scheme == .dark {
            let base = Color(red: 0.08, green: 0.055, blue: 0.05)
            let umber = Color(red: 0.21, green: 0.11, blue: 0.075)
            let wine = Color(red: 0.23, green: 0.085, blue: 0.08)
            let glow: Color = switch mood {
            case .rest: Color(red: 0.24, green: 0.13, blue: 0.08)
            case .work: Color(red: 0.46, green: 0.16, blue: 0.08)
            case .done: Color(red: 0.10, green: 0.26, blue: 0.16)
            }
            let corner: Color = mood == .done ? Color(red: 0.09, green: 0.17, blue: 0.12) : umber
            return [
                umber, base, wine,
                base, umber, base,
                wine, glow, corner,
            ]
        }
        let paper = Theme.paper
        let peach = Color(red: 0.98, green: 0.85, blue: 0.74)
        let rose = Color(red: 0.96, green: 0.80, blue: 0.74)
        let sand = Color(red: 0.97, green: 0.91, blue: 0.79)
        let glow: Color = switch mood {
        case .rest: peach
        case .work: Color(red: 0.99, green: 0.70, blue: 0.55)
        case .done: Color(red: 0.76, green: 0.89, blue: 0.76)
        }
        let corner: Color = mood == .done ? Color(red: 0.88, green: 0.94, blue: 0.84) : sand
        return [
            peach, paper, rose,
            paper, sand, paper,
            rose, glow, corner,
        ]
    }
}

extension View {
    /// A card of Liquid Glass, optionally tinted.
    func glassCard(tint: Color? = nil, radius: CGFloat = WorkoutStyle.cardRadius) -> some View {
        glassEffect(
            tint.map { .regular.tint($0) } ?? .regular,
            in: RoundedRectangle(cornerRadius: radius, style: .continuous)
        )
    }

    /// A quieter panel set into a glass card: history, a benchmark, a score.
    func inset(tint: Color = .primary, strength: Double = 0.06) -> some View {
        background(
            tint.opacity(strength),
            in: RoundedRectangle(cornerRadius: WorkoutStyle.insetRadius, style: .continuous)
        )
    }
}

/// A small capitalized label above a section or a number.
struct Eyebrow: View {
    let text: String
    var color: Color = .secondary

    init(_ text: String, color: Color = .secondary) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(color)
    }
}

/// A heading between groups of cards.
struct SectionHeader: View {
    let title: String
    var symbol: String?

    var body: some View {
        HStack(spacing: 6) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(WorkoutStyle.accent)
            }
            Text(title)
                .font(.system(.title3, design: .serif, weight: .semibold))
        }
        .padding(.horizontal, 6)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A pill of text on a faint tint: an estimated 1RM, a chip on a row.
struct Chip: View {
    let text: String
    var symbol: String?
    var color: Color = WorkoutStyle.accent

    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).imageScale(.small) }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(color)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(color.opacity(0.13), in: .capsule)
    }
}

/// A day as a badge: the weekday over the date.
struct DateBadge: View {
    let day: String
    var tint: Color = WorkoutStyle.accent
    var filled = false

    var body: some View {
        let parts = WorkoutDay.badge(day)
        VStack(spacing: 0) {
            Text(parts.weekday)
                .font(.caption2.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(filled ? Color.white.opacity(0.85) : tint)
            Text(parts.day)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(filled ? Color.white : Color.primary)
        }
        .frame(width: 48, height: 48)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(filled ? AnyShapeStyle(tint.gradient) : AnyShapeStyle(tint.opacity(0.12)))
        }
        .accessibilityHidden(true)
    }
}

/// The empty states: a symbol, a line, and what to do about it.
struct EmptyCard: View {
    let symbol: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(WorkoutStyle.accent)
            Text(title)
                .font(.system(.title2, design: .serif, weight: .semibold))
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .padding(.horizontal, 24)
        .glassCard()
    }
}

extension Color {
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }
}
