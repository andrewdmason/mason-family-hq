import MasonKit
import SwiftUI
import UIKit

/// The app's look: a quiet, flat content layer (warm paper, softened member
/// colours) with Liquid Glass kept for what floats over it: the top bar, the
/// bottom bar, the peek card and sheets.
enum CalendarStyle {
    /// The page: the family site's paper, a deep warm grey in the dark.
    static let ground = Color(light: Theme.paper, dark: Color(red: 0.106, green: 0.098, blue: 0.086))
    /// A card lifted off the page.
    static let card = Color(light: .white, dark: Color(red: 0.155, green: 0.145, blue: 0.13))
    static let line = Color.primary.opacity(0.09)
    static let faintLine = Color.primary.opacity(0.05)
    /// The calendar icon's olive, lifted in the dark so it still reads.
    static let accent = Color(light: Color(red: 0.36, green: 0.42, blue: 0.22), dark: Color(red: 0.69, green: 0.76, blue: 0.50))
    /// The icon's olive itself, under white text in either mode.
    static let olive = Color(red: 0x6A / 255, green: 0x78 / 255, blue: 0x45 / 255)
    /// The now line.
    static let now = Color(red: 0.84, green: 0.33, blue: 0.24)
    /// Conflicts, and drives nobody has yet.
    static let amber = Color(red: 0.85, green: 0.55, blue: 0.10)

    // The Day grid.
    static let hourHeight: CGFloat = 56
    static let gutter: CGFloat = 46
    static let pinColumn: CGFloat = 34
    static let minBlock: CGFloat = 24

    private static let groundLight = RGB(hex: "#faf7f0")
    private static let groundDark = RGB(r: 0.106, g: 0.098, b: 0.086)

    /// A member colour as the calendar draws it: softened toward warm grey.
    static func muted(_ hex: String) -> Color { Color(RGB(hex: hex).muted) }

    /// A light, opaque wash of a member colour: the fill of a card, and other
    /// people's time shown as context. Mixed with the page, not see-through,
    /// so grid lines don't show through it.
    static func wash(_ hex: String, _ share: Double = 0.22) -> Color {
        let muted = RGB(hex: hex).muted
        return Color(light: Color(muted.mixed(share, with: groundLight)), dark: Color(muted.mixed(share + 0.08, with: groundDark)))
    }

    /// Text in a member's colour that still reads on the page.
    static func ink(_ hex: String) -> Color {
        let muted = RGB(hex: hex).muted
        return Color(light: Color(muted.mixed(0.72, with: RGB(r: 0, g: 0, b: 0))), dark: Color(muted.mixed(0.55, with: RGB(r: 1, g: 1, b: 1))))
    }
}

extension Color {
    init(_ rgb: RGB) {
        self.init(red: rgb.r, green: rgb.g, blue: rgb.b)
    }

    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }
}

/// A family member's face: their photo, else their initial on their colour.
struct Avatar: View {
    let member: Member?
    var size: CGFloat = 24
    @Environment(CalendarStore.self) private var store

    var body: some View {
        Group {
            if let member, let data = store.photos[member.email], let image = PhotoCache.image(member.email, data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    CalendarStyle.muted(member?.color ?? CalendarRules.familyColor)
                    Text(member?.initial ?? "?")
                        .font(.system(size: size * 0.46, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .accessibilityLabel(member?.firstName ?? "Someone")
    }
}

/// Decoded photos, so scrolling doesn't decode them again.
enum PhotoCache {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(_ email: String, _ data: Data) -> UIImage? {
        let key = "\(email):\(data.count)" as NSString
        if let hit = cache.object(forKey: key) { return hit }
        guard let image = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 160, height: 160)) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }
}

/// Drop-off and pick-up at a glance: an arrow each, then who (their initial
/// on their colour), a hollow amber ring when nobody has it yet, or nothing
/// when no drive is needed.
struct DutyGlyphs: View {
    let item: EventItem
    var onlyUnset = false

    var body: some View {
        if let duties = item.duties, !onlyUnset || item.needsDriver {
            HStack(spacing: 5) {
                glyph("arrow.right", duties[.dropoff] ?? .unset, "Drop-off")
                glyph("arrow.left", duties[.pickup] ?? .unset, "Pick-up")
            }
        }
    }

    @ViewBuilder
    private func glyph(_ arrow: String, _ chip: DutyChip, _ name: String) -> some View {
        switch chip {
        case .notNeeded:
            EmptyView()
        case .unset:
            if item.event.location != nil {
                HStack(spacing: 2) {
                    Image(systemName: arrow).font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary)
                    Circle().strokeBorder(CalendarStyle.amber, lineWidth: 1.5).frame(width: 9, height: 9)
                }
                .accessibilityLabel("\(name) needs someone")
            }
        case .person(let initial, let color):
            HStack(spacing: 2) {
                Image(systemName: arrow).font(.system(size: 8, weight: .bold)).foregroundStyle(.secondary)
                Text(initial)
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: 14, height: 14)
                    .background(CalendarStyle.muted(color), in: .circle)
            }
            .accessibilityLabel("\(name): \(initial)")
        }
    }
}

/// The amber triangle on an event that overlaps another of the same person's.
struct ConflictMark: View {
    var body: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .font(.system(size: 9))
            .foregroundStyle(CalendarStyle.amber)
            .accessibilityLabel("Overlaps another event")
    }
}

/// A drive block: an arrow pointing the way of travel, out for a drop-off and
/// back for a pick-up.
struct DriveArrow: Shape {
    var duty: DutyKind
    var depth: CGFloat = 9

    func path(in rect: CGRect) -> Path {
        let p = min(depth, rect.width / 3)
        var path = Path()
        if duty == .pickup {
            path.addLines([
                CGPoint(x: rect.minX + p, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
                CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.minX + p, y: rect.maxY),
                CGPoint(x: rect.minX, y: rect.midY),
            ])
        } else {
            path.addLines([
                CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX - p, y: rect.minY),
                CGPoint(x: rect.maxX, y: rect.midY), CGPoint(x: rect.maxX - p, y: rect.maxY),
                CGPoint(x: rect.minX, y: rect.maxY),
            ])
        }
        path.closeSubpath()
        return path
    }
}
