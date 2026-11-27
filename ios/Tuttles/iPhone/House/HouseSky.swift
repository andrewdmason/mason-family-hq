import SceneKit
import UIKit

// What time it is over the street. The town keeps the phone's own clock: the
// sun's up in the day, low and orange about sunrise and sunset, and gone at
// night, when the lamps in the house come on, its windows are lit from the
// street, and what's through a window is the night. It's never so dark that
// a room can't be seen and changed.
//
// When the sun rises and sets is worked out roughly from the day of the
// year (earlier evenings in winter), not from where the phone is: near
// enough that it's dark in the house about when it's dark outside it.

/// The time of year, for what the street puts out: lights and a dusting of
/// snow through December and the first days of January, pumpkins on the
/// step for the second half of October.
enum HouseSeason: Equatable {
    case plain, winter, halloween

    static func on(month: Int, day: Int) -> HouseSeason {
        if month == 12 || (month == 1 && day <= 6) { return .winter }
        if month == 10 && day >= 15 { return .halloween }
        return .plain
    }

    /// Now, by the phone's date; or, in the simulator, `--house-date 12-20`.
    static var now: HouseSeason {
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--house-date"), args.count > at + 1 {
            let parts = args[at + 1].split(separator: "-").compactMap { Int($0) }
            if parts.count == 2 { return on(month: parts[0], day: parts[1]) }
        }
        let parts = Calendar.current.dateComponents([.month, .day], from: Date())
        return on(month: parts.month ?? 6, day: parts.day ?? 1)
    }
}

struct HouseSky: Equatable {
    /// How much daylight there is: 1 in the day, 0 at night.
    let day: Float
    /// How low and orange the sun is: 1 at sunrise and at sunset, 0 well away from them.
    let low: Float

    static let noon = HouseSky(day: 1, low: 0)

    /// What's through a window, and the sky behind the town.
    enum Outlook: String {
        case day, dusk, night
    }

    /// The lamps are on.
    var lit: Bool { day < 0.6 }

    var outlook: Outlook { day > 0.7 ? .day : day > 0.25 ? .dusk : .night }

    // MARK: When

    /// The hour the sun comes up and the hour it goes down, on this day of the year (1 to 366), by the clock.
    static func sun(dayOfYear: Int) -> (rise: Double, set: Double) {
        // Longest about the 172nd day; an hour or so either way of 6:25 and two of 6:20 in the evening.
        let season = cos(2 * Double.pi * Double(dayOfYear - 172) / 365)
        return (6.4 - 0.6 * season, 18.3 + 1.9 * season)
    }

    /// The sky at an hour of the day (0 up to 24, 13.5 being half past one).
    static func at(hour: Double, dayOfYear: Int) -> HouseSky {
        let sun = sun(dayOfYear: dayOfYear)
        // Light comes over three quarters of an hour either side of sunrise, and goes from an hour before sunset.
        func ramp(_ x: Double, _ from: Double, _ to: Double) -> Double { min(1, max(0, (x - from) / (to - from))) }
        let up = ramp(hour, sun.rise - 0.5, sun.rise + 0.75), down = 1 - ramp(hour, sun.set - 1, sun.set + 0.75)
        let day = min(up, down)
        // Lowest, and most orange, at the moment itself.
        let low = max(0, 1 - min(abs(hour - sun.rise), abs(hour - sun.set)) / 1.25)
        return HouseSky(day: Float(smooth(day)), low: Float(low))
    }

    static func at(_ date: Date, calendar: Calendar = .current) -> HouseSky {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        let hour = Double(parts.hour ?? 12) + Double(parts.minute ?? 0) / 60
        return at(hour: hour, dayOfYear: calendar.ordinality(of: .day, in: .year, for: date) ?? 172)
    }

    private static func smooth(_ x: Double) -> Double { x * x * (3 - 2 * x) }

    // MARK: Light

    private static func mix(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ t: Float) -> SIMD3<Float> { a + (b - a) * t }
    private static func color(_ v: SIMD3<Float>) -> UIColor { UIColor(red: CGFloat(v.x), green: CGFloat(v.y), blue: CGFloat(v.z), alpha: 1) }

    /// The sun's light, or at night the moon's: how strong, what colour, and where it comes from.
    var sun: (intensity: CGFloat, color: UIColor, from: SIMD3<Float>) {
        let moon = SIMD3<Float>(0.62, 0.72, 1), noon = SIMD3<Float>(1, 0.97, 0.9), orange = SIMD3<Float>(1, 0.7, 0.42)
        // Orange only while there's some sun to be orange.
        let warm = low * min(1, day * 2.5)
        let tint = Self.mix(Self.mix(moon, noon, day), orange, warm * 0.75)
        // Low in the sky about sunrise and sunset, so the shadows are long.
        let height = 90 - 52 * low
        return (CGFloat(300 + 480 * day), Self.color(tint), SIMD3(40 + 26 * low, height, 70))
    }

    /// The light that's everywhere: at night bluer, and less of it.
    var ambient: (intensity: CGFloat, color: UIColor) {
        let night = SIMD3<Float>(0.5, 0.6, 0.92), noon = SIMD3<Float>(0.95, 0.97, 1), orange = SIMD3<Float>(1, 0.84, 0.72)
        let warm = low * min(1, day * 2.5)
        return (CGFloat(450 + 170 * day), Self.color(Self.mix(Self.mix(night, noon, day), orange, warm * 0.5)))
    }

    /// How dark shadows are: a little more at night, when there's less light to fill them.
    var shadow: CGFloat { CGFloat(0.3 - 0.08 * day) }

    /// The sky behind the town: pale blue with clouds, orange going to violet, or dark with stars.
    var picture: UIImage {
        let outlook = outlook
        return MathMat.image("house-sky-\(outlook.rawValue)", 256, 512) { c, size in
            let top: UIColor, bottom: UIColor
            switch outlook {
            case .day: (top, bottom) = (UIColor(red: 0.74, green: 0.93, blue: 0.97, alpha: 1), UIColor(red: 0.86, green: 0.96, blue: 0.98, alpha: 1))
            case .dusk: (top, bottom) = (UIColor(red: 0.42, green: 0.36, blue: 0.62, alpha: 1), UIColor(red: 0.98, green: 0.68, blue: 0.45, alpha: 1))
            case .night: (top, bottom) = (UIColor(red: 0.05, green: 0.07, blue: 0.19, alpha: 1), UIColor(red: 0.12, green: 0.16, blue: 0.34, alpha: 1))
            }
            if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [top.cgColor, bottom.cgColor] as CFArray, locations: [0, 1]) {
                c.drawLinearGradient(g, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            }
            if outlook == .night {
                var rng = MathRNG(seed: 23)
                c.setFillColor(UIColor(red: 1, green: 0.96, blue: 0.8, alpha: 0.9).cgColor)
                for _ in 0..<90 {
                    let x = CGFloat(rng.unit()) * size.width, y = CGFloat(rng.unit()) * size.height, r = 0.6 + CGFloat(rng.unit()) * 1.4
                    c.fillEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
                }
            } else {
                c.setFillColor(UIColor.white.withAlphaComponent(outlook == .day ? 0.9 : 0.35).cgColor)
                for (x, y, r) in [(40.0, 440.0, 60.0), (110, 470, 80), (200, 450, 70), (230, 90, 34), (190, 100, 26), (20, 150, 30)] {
                    c.fillEllipse(in: CGRect(x: x - r, y: y - r * 0.6, width: r * 2, height: r * 1.2))
                }
            }
        }
    }
}
