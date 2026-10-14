import AVFoundation
import CoreImage
import CoreText
import UIKit

// The card a shared video opens on, YouTube-thumbnail style: the kid's full
// name big in their theme's colors and type, what happened beneath it (the
// result, or a badge per at-bat for a highlight reel), the opponent and date,
// and their headshot cut out with a white outline. Behind it all, the swing
// itself plays in slow motion through contact, washed in the theme's two
// colors (no swing — a walk, a field-view-only share — gets a graphic instead).
// Everything comes in over the first ~0.6s (a push-in, the color panel sliding
// across, the headshot sliding in, the name slamming down, the badges popping
// in one after another), holds, then flashes into the first pitch.

/// What the card says and how it looks.
struct TitleCard: Equatable {
    /// "Sebastian Mason" — always the headline.
    var name: String
    /// "Double", beneath the name on a single at-bat's card.
    var result: String?
    /// A tag above the name ("Highlights" on a reel).
    var chip: String?
    /// "vs DEC Elite 13u · Sun, Oct 11, 2026".
    var meta: String
    /// A reel's at-bats, in order.
    var badges: [CardBadge] = []
    /// A long reel's summary instead of badges.
    var tally: String?
    var style = CardStyle()
    /// The slow-motion swing behind the card; nil for the graphic.
    var swing: CardSwing?

    /// A single at-bat's card.
    static func make(kid: String?, result: AtBatResult?, game: String?, playedOn: String?,
                     style: CardStyle = CardStyle()) -> TitleCard {
        TitleCard(name: displayName(kid), result: result?.name, meta: meta(game: game, playedOn: playedOn), style: style)
    }

    /// The full name, or a stand-in when the kid isn't known.
    static func displayName(_ kid: String?) -> String {
        kid.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? "Highlights"
    }

    /// "vs Kabuki · Sat, Oct 11, 2026". A game named for the opponent alone
    /// gets "vs"; one that already says who's playing whom is left as is.
    static func meta(game: String?, playedOn: String?) -> String {
        var parts: [String] = []
        if let game = game?.trimmingCharacters(in: .whitespaces), !game.isEmpty {
            let lower = game.lowercased()
            let named = lower.hasPrefix("vs") || lower.hasPrefix("@") || lower.contains(" vs") || lower.contains(" @ ")
            parts.append(named ? game : "vs \(game)")
        }
        if let playedOn, !playedOn.isEmpty { parts.append(formatGameDate(playedOn)) }
        return parts.joined(separator: " · ")
    }

    /// "2026-10-11" → "Sat, Oct 11, 2026", the website's long game date.
    static func formatGameDate(_ ymd: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ymd) else { return ymd }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US")
        out.dateFormat = "EEE, MMM d, yyyy"
        return out.string(from: d)
    }
}

/// One at-bat on a reel's card: its scorebook result, filled in for a hit.
struct CardBadge: Equatable {
    var text: String
    var hit: Bool
    /// A backwards K (strikeout looking).
    var mirrored = false

    init(text: String, hit: Bool, mirrored: Bool = false) {
        self.text = text
        self.hit = hit
        self.mirrored = mirrored
    }

    init(_ result: AtBatResult?) {
        guard let result else { self.init(text: "–", hit: false); return }
        let hit: Set<AtBatResult> = [.single, .double, .triple, .homeRun]
        self.init(text: result == .strikeoutLooking ? "K" : result.rawValue, hit: hit.contains(result),
                  mirrored: result == .strikeoutLooking)
    }

    /// Ten or more badges don't fit; say it in words instead: "10 at-bats · 4 hits · 2 walks".
    static func tally(_ results: [AtBatResult?]) -> String {
        let hits = results.filter { CardBadge($0).hit }.count
        let walks = results.filter { $0 == .walk || $0 == .hitByPitch }.count
        var parts = ["\(results.count) at-bats", "\(hits) hit\(hits == 1 ? "" : "s")"]
        if walks > 0 { parts.append("\(walks) walk\(walks == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }

    static let tallyFrom = 10
}

/// A kid's look: their theme, and their cut-out headshot on this phone.
struct CardStyle: Equatable {
    var theme = CardTheme.standard.id
    var headshot: URL?
}

/// The stretch of a reel the card's slow-motion background comes from.
struct CardSwing: Equatable {
    var url: URL
    /// Reel time, seconds.
    var start: Double
    var end: Double
    /// Where the batter is across the picture (the vertical framing's
    /// center); nil when it hasn't been framed.
    var focus: Double?

    /// The card plays its swing at quarter speed: half a second of real
    /// swing (the load, contact, the follow-through) over a 2-second card.
    static let slowdown = 4.0

    /// The swing to show: the ball in play, else the last foul. Its tap is
    /// close to contact, so the window starts a little before it. Nil when
    /// there's no swing, or it wasn't filmed in slow motion.
    static func make(reel: URL, segments: [ReelSegment], pitches: [Pitch], cardSeconds: Double, focus: Double?) -> CardSwing? {
        let sorted = pitches.sorted { $0.t < $1.t }
        guard cardSeconds > 0,
              let pitch = sorted.last(where: { $0.outcome == .inPlay }) ?? sorted.last(where: { $0.outcome == .foul }),
              let seg = segments.first(where: { $0.start <= pitch.t && pitch.t < $0.end })
                ?? segments.first(where: { $0.start - 0.05 <= pitch.t && pitch.t <= $0.end + 0.05 }),
              seg.fps >= 100 else { return nil }
        let length = min(cardSeconds / slowdown, seg.end - seg.start)
        let start = min(max(seg.start, pitch.t - length * 0.4), seg.end - length)
        return CardSwing(url: reel, start: start, end: start + length, focus: focus)
    }

    /// Where the batter stands across the picture: whatever moves most over
    /// the swing (the batter and the bat — the catcher and the field hardly
    /// move), from two small frames, the stance and just past contact. Nil
    /// when nothing much moves.
    static func findBatter(in url: URL, from start: Double, to end: Double) async -> Double? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 192, height: 192)
        generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 120)
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 120)
        func grey(_ t: Double) async -> (pixels: [UInt8], width: Int, height: Int)? {
            guard let (image, _) = try? await generator.image(at: CMTime(seconds: t, preferredTimescale: 600)) else { return nil }
            let w = image.width, h = image.height
            var pixels = [UInt8](repeating: 0, count: w * h)
            guard let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return (pixels, w, h)
        }
        guard let a = await grey(start), let b = await grey(start + (end - start) * 0.6),
              a.width == b.width, a.height == b.height, a.width > 16 else { return nil }
        var columns = [Double](repeating: 0, count: a.width)
        for y in 0 ..< a.height {
            for x in 0 ..< a.width {
                let d = abs(Int(a.pixels[y * a.width + x]) - Int(b.pixels[y * a.width + x]))
                if d >= 18 { columns[x] += Double(d) }
            }
        }
        guard columns.reduce(0, +) > Double(a.height) * 40 else { return nil }
        // Smoothed, so the busiest stretch wins rather than one column.
        let r = a.width / 26
        var best = (x: 0, energy: -1.0)
        for x in 0 ..< a.width {
            let energy = columns[max(0, x - r) ... min(a.width - 1, x + r)].reduce(0, +)
            if energy > best.energy { best = (x, energy) }
        }
        return (Double(best.x) + 0.5) / Double(a.width)
    }

    /// How a reel's at-bats rank for its card: the biggest hit's swing.
    static func rank(_ result: AtBatResult?) -> Int {
        switch result {
        case .homeRun: 5
        case .triple: 4
        case .double: 3
        case .single: 2
        case .some: 1
        case nil: 0
        }
    }
}

// MARK: - Themes

/// One of the looks a kid picks from: two colors and a typeface.
struct CardTheme: Identifiable, Equatable {
    let id: String
    let name: String
    /// The dark color: the panel, the shadows of the picture.
    let ink: UIColor
    /// The loud color: the name, the edge, the badges.
    let pop: UIColor
    /// The other text.
    let text: UIColor
    /// What the picture's highlights wash to.
    let highlight: UIColor
    /// A third color for the edge, tag and filled badges (white-on-blue Royal's red).
    var accent: UIColor? = nil
    /// PostScript name of the headline face.
    let font: String
    /// Lean, in degrees (negative leans right, like italics).
    var skew: CGFloat = 0
    /// The name's size, landscape and vertical, before it's fitted.
    let nameSize: (wide: CGFloat, tall: CGFloat)

    static func == (a: CardTheme, b: CardTheme) -> Bool { a.id == b.id }

    var edge: UIColor { accent ?? pop }
    /// Text on the edge color.
    var onEdge: UIColor { accent == nil ? ink : .white }

    static let all: [CardTheme] = [
        CardTheme(id: "gold", name: "Gold Rush", ink: hex(0x0A1A33), pop: hex(0xFFC21A), text: .white, highlight: hex(0xE9EEF7),
                  font: "Anton-Regular", nameSize: (200, 170)),
        CardTheme(id: "volt", name: "Volt", ink: hex(0x07090A), pop: hex(0xC8FF1A), text: .white, highlight: hex(0xE6F5C6),
                  font: "ArchivoBlack-Regular", skew: -8, nameSize: (160, 128)),
        CardTheme(id: "heritage", name: "Heritage", ink: hex(0x3B0A10), pop: hex(0xF2E3C2), text: hex(0xF2E3C2), highlight: hex(0xF4E2CF),
                  font: "AlfaSlabOne-Regular", nameSize: (160, 124)),
        CardTheme(id: "ice", name: "Ice", ink: hex(0x04213F), pop: hex(0x79E6FF), text: .white, highlight: hex(0xD5F3FF),
                  font: "BigShouldersDisplay-Black", nameSize: (230, 190)),
        CardTheme(id: "sunset", name: "Sunset", ink: hex(0x2A0B45), pop: hex(0xFF7A1A), text: .white, highlight: hex(0xFFD9C2),
                  font: "Teko-Bold", nameSize: (240, 200)),
        CardTheme(id: "royal", name: "Royal", ink: hex(0x0B2A8C), pop: .white, text: .white, highlight: hex(0xDCE4FF), accent: hex(0xE21B3C),
                  font: "Oswald-Bold", nameSize: (180, 145)),
        CardTheme(id: "inferno", name: "Inferno", ink: hex(0x140405), pop: hex(0xFF3D1F), text: .white, highlight: hex(0xFFD4C8),
                  font: "Anton-Regular", skew: -9, nameSize: (200, 170)),
        CardTheme(id: "teal", name: "Teal Club", ink: hex(0x032B2A), pop: hex(0x2EF2C2), text: .white, highlight: hex(0xCCFBEF),
                  font: "BarlowCondensed-BlackItalic", skew: -6, nameSize: (220, 180)),
    ]

    static let standard = all[0]

    static func named(_ id: String?) -> CardTheme {
        all.first { $0.id == id } ?? standard
    }

    private static func hex(_ v: UInt32) -> UIColor {
        UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }

    /// The headline face at a size (the system's heaviest if it isn't installed).
    func headlineFont(_ size: CGFloat) -> UIFont {
        CardFonts.register()
        return UIFont(name: font, size: size) ?? .systemFont(ofSize: size, weight: .black)
    }
}

/// The themes' typefaces, bundled with the app (all SIL Open Font License).
enum CardFonts {
    private static let once: Void = {
        for url in Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [] {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    static func register() { _ = once }
}

// MARK: - Drawing

/// Draws a card's frames. Built once per video (the text, panel and headshot
/// are drawn up front); each frame then just moves and fades the pieces and
/// washes the swing, so it's quick enough for the compositor.
final class CardAnimator: @unchecked Sendable {
    let card: TitleCard
    let theme: CardTheme
    let size: CGSize
    /// The card's length, seconds: the exit flash lands at the end.
    let length: Double

    private var tall: Bool { size.height > size.width }
    private let graphic: CIImage
    private let fade: CIImage
    private let slab: CIImage
    private var pieces: [Piece] = []

    /// A drawn piece, where it sits (UIKit coordinates, top-left origin), and
    /// how it comes in.
    private struct Piece {
        var image: CIImage
        var rect: CGRect
        var motion: Motion
    }

    private enum Motion {
        /// Slides in from the right as it fades in.
        case slideIn(start: Double)
        /// Drops from big to its size, about its bottom-left corner.
        case slam(start: Double)
        /// Rises a little as it fades in.
        case rise(start: Double)
        /// Grows from small, about its center.
        case pop(start: Double)
    }

    init(card: TitleCard, size: CGSize, length: Double) {
        self.card = card
        self.theme = CardTheme.named(card.style.theme)
        self.size = size
        self.length = length
        graphic = Self.graphic(theme, size)
        fade = Self.fade(theme, size)
        slab = Self.slab(theme, size)
        layOut()
    }

    // MARK: Frames

    /// The card `t` seconds in, over `swing` (a source frame of the slow-motion
    /// swing, or nil for the graphic background).
    func frame(at t: Double, swing: CIImage?) -> CIImage {
        let bounds = CGRect(origin: .zero, size: size)
        var image = swing.map { background($0, at: t) } ?? graphic
        image = fade.composited(over: image)
        // The panel slides across.
        let slide = -0.6 * size.width * (1 - Ease.outQuart(progress(t, 0, 0.32)))
        image = slab.transformed(by: CGAffineTransform(translationX: slide, y: 0)).composited(over: image)
        for piece in pieces {
            image = place(piece, at: t).composited(over: image)
        }
        // Into the first pitch: a quick flash to white and back.
        let flash = flashAlpha(t)
        if flash > 0 {
            image = CIImage(color: CIColor(red: 1, green: 1, blue: 1, alpha: flash)).cropped(to: bounds).composited(over: image)
        }
        return image.cropped(to: bounds)
    }

    /// The settled card (after its entrance, before the flash), as a picture:
    /// the settings preview.
    func still(swing: CIImage? = nil) -> UIImage? {
        let t = min(1.2, length * 0.8)
        let context = CIContext()
        guard let cg = context.createCGImage(frame(at: t, swing: swing), from: CGRect(origin: .zero, size: size)) else { return nil }
        return UIImage(cgImage: cg)
    }

    private func flashAlpha(_ t: Double) -> CGFloat {
        let peak = length - 0.07, rise = 0.07, fall = 0.07
        if t < peak - rise || t > length { return 0 }
        if t <= peak { return CGFloat(0.9 * (t - (peak - rise)) / rise) }
        return CGFloat(0.9 * max(0, 1 - (t - peak) / fall))
    }

    private func progress(_ t: Double, _ start: Double, _ duration: Double) -> Double {
        max(0, min(1, (t - start) / duration))
    }

    private func place(_ piece: Piece, at t: Double) -> CIImage {
        // CIImage's origin is bottom-left.
        let origin = CGPoint(x: piece.rect.minX, y: size.height - piece.rect.maxY)
        var transform = CGAffineTransform(translationX: origin.x, y: origin.y)
        var alpha: CGFloat = 1
        switch piece.motion {
        case .slideIn(let start):
            let p = progress(t, start, 0.5)
            transform = transform.translatedBy(x: piece.rect.width * 0.45 * CGFloat(1 - Ease.outBack(p, 1.4)), y: 0)
            alpha = CGFloat(min(1, p * 3))
        case .slam(let start):
            let p = progress(t, start, 0.38)
            let scale = 1 + 0.7 * CGFloat(1 - Ease.outBack(p, 1.6))
            transform = transform.scaledBy(x: scale, y: scale)
            alpha = CGFloat(min(1, p / 0.6))
        case .rise(let start):
            let p = progress(t, start, 0.35)
            transform = transform.translatedBy(x: 0, y: -30 * CGFloat(1 - Ease.outQuart(p)))
            alpha = CGFloat(p)
        case .pop(let start):
            let p = progress(t, start, 0.3)
            let scale = 0.3 + 0.7 * CGFloat(Ease.outBack(p, 1.8))
            let c = CGPoint(x: piece.rect.width / 2, y: piece.rect.height / 2)
            transform = transform.translatedBy(x: c.x, y: c.y).scaledBy(x: scale, y: scale).translatedBy(x: -c.x, y: -c.y)
            alpha = CGFloat(min(1, p * 2))
        }
        if alpha <= 0 { return CIImage.empty() }
        var image = piece.image.transformed(by: transform)
        if alpha < 1 { image = image.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: alpha)]) }
        return image
    }

    /// The swing, cropped in on the batter, washed in the theme's colors and
    /// slowly pushing in.
    private func background(_ source: CIImage, at t: Double) -> CIImage {
        var src = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
        let e = src.extent
        let framed = card.swing?.focus
        let focus = CGFloat(framed ?? 0.5)
        var box: CGRect
        var drop: CGFloat = 0
        if tall {
            // The batter a little left of middle (the headshot's on the
            // right), and lower, so they show below the panel.
            let strip = e.height * size.width / size.height
            box = VideoShape.fillBox(extent: e, frame: size, centerX: Double(focus + 0.12 * strip / e.width))
            drop = size.height * 0.25
        } else {
            // In on the batter (they're small in a wide shot), set right of
            // center, clear of the panel. Not knowing where they stand: less
            // far in, around where a batter usually is (left of middle).
            let w = e.width / (framed == nil ? 1.4 : 1.7), h = w * size.height / size.width
            let x = min(max(0, (framed == nil ? 0.4 * e.width : focus * e.width) - 0.6 * w), e.width - w)
            box = CGRect(x: x, y: (e.height - h) * 0.55, width: w, height: h)
        }
        box = box.intersection(e)
        let scale = size.width / box.width
        src = src.cropped(to: box)
            .transformed(by: CGAffineTransform(translationX: -box.minX, y: -box.minY - drop / scale))
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let washed = src
            .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0, kCIInputContrastKey: 1.25, kCIInputBrightnessKey: 0.03])
            .applyingFilter("CIFalseColor", parameters: ["inputColor0": CIColor(color: theme.ink), "inputColor1": CIColor(color: theme.highlight)])
        let push = 1 + 0.07 * CGFloat(Ease.outQuart(progress(t, 0, max(length, 0.1))))
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        let pushed = washed.transformed(by: CGAffineTransform(translationX: c.x, y: c.y).scaledBy(x: push, y: push).translatedBy(x: -c.x, y: -c.y))
        let ink = CIImage(color: CIColor(color: theme.ink)).cropped(to: CGRect(origin: .zero, size: size))
        return pushed.composited(over: ink)
    }

    // MARK: Layout

    private func layOut() {
        let wideMax: CGFloat = 770, tallMax: CGFloat = 900
        let maxWidth = tall ? tallMax : wideMax
        let left: CGFloat = tall ? 80 : 110
        let skew = theme.skew

        // The headshot first, behind the text.
        if let url = card.style.headshot, let head = UIImage(contentsOfFile: url.path), head.size.width > 0, head.size.height > 0 {
            let h: CGFloat = tall ? 520 : 720
            let w = h * head.size.width / head.size.height
            let pad = Self.shadowPad
            let rect = tall
                ? CGRect(x: size.width - 20 - w - pad, y: 730 - pad, width: w + pad * 2, height: h + pad * 2)
                : CGRect(x: size.width - 60 - w - pad, y: size.height - h - pad, width: w + pad * 2, height: h + pad * 2)
            if let image = Self.drawHeadshot(head, size: CGSize(width: w, height: h), tall: tall) {
                pieces.append(Piece(image: image, rect: rect, motion: .slideIn(start: 0.08)))
            }
        }

        // The text, top to bottom.
        var stack: [(image: CIImage, size: CGSize, gapBefore: CGFloat, motion: Motion)] = []
        if let chip = card.chip, let p = Self.chip(chip, theme: theme, tall: tall) {
            stack.append((p.0, p.1, 0, .rise(start: 0.1)))
        }
        let words = card.name.uppercased().split(separator: " ", maxSplits: 1).map(String.init)
        if let p = Self.headline(words, theme: theme, size: tall ? theme.nameSize.tall : theme.nameSize.wide, maxWidth: maxWidth) {
            stack.append((p.0, p.1, stack.isEmpty ? 0 : 18, .slam(start: 0.16)))
        }
        if let result = card.result, let p = Self.line(result.uppercased(), font: .systemFont(ofSize: tall ? 72 : 82, weight: .heavy),
                                                      color: theme.text, kern: 0.04, skew: skew, maxWidth: maxWidth) {
            stack.append((p.0, p.1, 14, .rise(start: 0.34)))
        }
        let metaFont = UIFont.systemFont(ofSize: tall ? 40 : 44, weight: .semibold)
        for (i, line) in Self.metaLines(card.meta, font: metaFont, maxWidth: maxWidth).enumerated() {
            if let p = Self.line(line, font: metaFont, color: theme.text.withAlphaComponent(0.8), kern: 0, skew: skew, maxWidth: maxWidth) {
                stack.append((p.0, p.1, i == 0 ? 22 : 4, .rise(start: 0.34)))
            }
        }
        if let tally = card.tally, let p = Self.line(tally.uppercased(), font: .systemFont(ofSize: tall ? 44 : 48, weight: .heavy), color: theme.pop,
                             kern: 0.03, skew: skew, maxWidth: maxWidth) {
            stack.append((p.0, p.1, 30, .rise(start: 0.46)))
        }

        // Badges, wrapped into rows.
        var badgeRows: [[(CIImage, CGSize)]] = []
        if card.tally == nil {
            var row: [(CIImage, CGSize)] = []
            var width: CGFloat = 0
            for badge in card.badges {
                guard let b = Self.badge(badge, theme: theme, tall: tall) else { continue }
                if !row.isEmpty, width + 18 + b.1.width > maxWidth {
                    badgeRows.append(row)
                    row = []
                    width = 0
                }
                width += (row.isEmpty ? 0 : 18) + b.1.width
                row.append(b)
            }
            if !row.isEmpty { badgeRows.append(row) }
        }
        let badgeHeight = badgeRows.reduce(CGFloat(0)) { $0 + ($1.first?.1.height ?? 0) } + CGFloat(max(0, badgeRows.count - 1)) * 18
        let textHeight = stack.reduce(CGFloat(0)) { $0 + $1.gapBefore + $1.size.height } + (badgeRows.isEmpty ? 0 : 34 + badgeHeight)
        var y = tall ? 210 : (size.height - textHeight) / 2
        for item in stack {
            y += item.gapBefore
            pieces.append(Piece(image: item.image, rect: CGRect(x: left, y: y, width: item.size.width, height: item.size.height), motion: item.motion))
            y += item.size.height
        }
        if !badgeRows.isEmpty {
            y += 34
            var i = 0
            for row in badgeRows {
                var x = left
                for (image, s) in row {
                    pieces.append(Piece(image: image, rect: CGRect(x: x, y: y, width: s.width, height: s.height), motion: .pop(start: 0.46 + Double(i) * 0.07)))
                    x += s.width + 18
                    i += 1
                }
                y += (row.first?.1.height ?? 0) + 18
            }
        }
    }

    // MARK: Art

    private static let shadowPad: CGFloat = 40

    private static func draw(_ size: CGSize, _ body: (CGContext) -> Void) -> CIImage? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let image = UIGraphicsImageRenderer(size: size, format: format).image { body($0.cgContext) }
        return image.cgImage.map { CIImage(cgImage: $0) }
    }

    /// A lean (shear) about the bottom of a box `height` tall, as CSS's skewX.
    private static func shear(_ degrees: CGFloat, height: CGFloat) -> CGAffineTransform {
        let k = tan(degrees * .pi / 180)
        return CGAffineTransform(a: 1, b: 0, c: k, d: 1, tx: -k * height, ty: 0)
    }

    /// The headline: the name over two lines, in the theme's face and color
    /// with a hard drop shadow, set smaller if a line is too wide.
    private static func headline(_ lines: [String], theme: CardTheme, size points: CGFloat, maxWidth: CGFloat) -> (CIImage, CGSize)? {
        guard !lines.isEmpty else { return nil }
        let lean = abs(tan(theme.skew * .pi / 180))
        var points = points
        func widest(_ p: CGFloat) -> CGFloat {
            let font = theme.headlineFont(p)
            return lines.map { ($0 as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
        }
        let blockHeight = { (p: CGFloat) in p * 0.9 * CGFloat(lines.count) }
        let w = widest(points) + lean * blockHeight(points)
        if w > maxWidth { points = (points * maxWidth / w).rounded(.down) }
        let font = theme.headlineFont(points)
        let lineHeight = points * 0.9
        let height = lineHeight * CGFloat(lines.count)
        let shadow = CGSize(width: 10, height: 10)
        let width = widest(points) + lean * height
        let canvas = CGSize(width: ceil(width + shadow.width + 8), height: ceil(height + shadow.height + points * 0.12))
        let image = draw(canvas) { ctx in
            ctx.concatenate(shear(theme.skew, height: height))
            let s = NSShadow()
            s.shadowColor = UIColor(white: 0, alpha: 0.45)
            s.shadowOffset = shadow
            s.shadowBlurRadius = 0
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: theme.pop, .shadow: s]
            for (i, line) in lines.enumerated() {
                // Cap tops at the top of each line's box.
                let baseline = CGFloat(i) * lineHeight + font.capHeight + (lineHeight - font.capHeight) / 2
                (line as NSString).draw(at: CGPoint(x: 0, y: baseline - font.ascender), withAttributes: attrs)
            }
        }
        return image.map { ($0, canvas) }
    }

    /// One line of plain text, leaning with the theme, set smaller to fit.
    private static func line(_ text: String, font: UIFont, color: UIColor, kern: CGFloat, skew: CGFloat, maxWidth: CGFloat) -> (CIImage, CGSize)? {
        guard !text.isEmpty else { return nil }
        var font = font
        let lean = abs(tan(skew * .pi / 180))
        func attrs(_ f: UIFont) -> [NSAttributedString.Key: Any] {
            [.font: f, .foregroundColor: color, .kern: kern * f.pointSize]
        }
        var size = (text as NSString).size(withAttributes: attrs(font))
        if size.width + lean * size.height > maxWidth {
            font = font.withSize((font.pointSize * maxWidth / (size.width + lean * size.height)).rounded(.down))
            size = (text as NSString).size(withAttributes: attrs(font))
        }
        let canvas = CGSize(width: ceil(size.width + lean * size.height + 4), height: ceil(size.height))
        let image = draw(canvas) { ctx in
            ctx.concatenate(shear(skew, height: size.height))
            (text as NSString).draw(at: .zero, withAttributes: attrs(font))
        }
        return image.map { ($0, canvas) }
    }

    /// The opponent and date on one line, or over two (game, then date) when
    /// that's too wide.
    private static func metaLines(_ meta: String, font: UIFont, maxWidth: CGFloat) -> [String] {
        guard !meta.isEmpty else { return [] }
        if (meta as NSString).size(withAttributes: [.font: font]).width <= maxWidth { return [meta] }
        var parts = meta.components(separatedBy: " · ")
        guard parts.count > 1 else { return [meta] }
        let date = parts.removeLast()
        return [parts.joined(separator: " · "), date]
    }

    /// The tag above the name: the edge color, the text in ink.
    private static func chip(_ text: String, theme: CardTheme, tall: Bool) -> (CIImage, CGSize)? {
        let font = UIFont.systemFont(ofSize: tall ? 40 : 44, weight: .heavy)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: theme.onEdge, .kern: 0.08 * font.pointSize]
        let t = (text.uppercased() as NSString).size(withAttributes: attrs)
        let box = CGSize(width: ceil(t.width + 44), height: ceil(t.height + 24))
        let lean = abs(tan(theme.skew * .pi / 180)) * box.height
        let canvas = CGSize(width: box.width + lean, height: box.height)
        let image = draw(canvas) { ctx in
            ctx.concatenate(shear(theme.skew, height: box.height))
            theme.edge.setFill()
            ctx.fill(CGRect(origin: .zero, size: box))
            (text.uppercased() as NSString).draw(at: CGPoint(x: 22, y: 12), withAttributes: attrs)
        }
        return image.map { ($0, canvas) }
    }

    /// A reel's at-bat: filled for a hit, outlined otherwise.
    private static func badge(_ badge: CardBadge, theme: CardTheme, tall: Bool) -> (CIImage, CGSize)? {
        let font = theme.headlineFont(tall ? 58 : 64)
        let color: UIColor = badge.hit ? theme.onEdge : theme.pop
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let t = (badge.text as NSString).size(withAttributes: attrs)
        let minWidth: CGFloat = tall ? 112 : 124
        let box = CGSize(width: max(minWidth, ceil(t.width + 40)), height: ceil(font.capHeight + 44))
        let image = draw(box) { ctx in
            let rect = CGRect(origin: .zero, size: box).insetBy(dx: 3, dy: 3)
            let path = UIBezierPath(roundedRect: rect, cornerRadius: 14)
            if badge.hit {
                theme.edge.setFill()
                path.fill()
            }
            (badge.hit ? theme.edge : theme.pop).setStroke()
            path.lineWidth = 6
            path.stroke()
            ctx.saveGState()
            let x = (box.width - t.width) / 2
            if badge.mirrored {
                ctx.translateBy(x: box.width, y: 0)
                ctx.scaleBy(x: -1, y: 1)
            }
            let baseline = (box.height + font.capHeight) / 2
            (badge.text as NSString).draw(at: CGPoint(x: x, y: baseline - font.ascender), withAttributes: attrs)
            ctx.restoreGState()
        }
        return image.map { ($0, box) }
    }

    /// The headshot at its size with a soft shadow beneath; in a vertical
    /// card it fades out at the bottom, where it sits over the picture.
    private static func drawHeadshot(_ head: UIImage, size: CGSize, tall: Bool) -> CIImage? {
        let pad = shadowPad
        let canvas = CGSize(width: size.width + pad * 2, height: size.height + pad * 2)
        let rect = CGRect(x: pad, y: pad, width: size.width, height: size.height)
        // Fade first (on its own), then shadow the faded picture.
        var faded = head
        if tall {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = false
            faded = UIGraphicsImageRenderer(size: size, format: format).image { c in
                head.draw(in: CGRect(origin: .zero, size: size))
                let colors = [UIColor(white: 0, alpha: 0).cgColor, UIColor(white: 0, alpha: 1).cgColor] as CFArray
                if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                    c.cgContext.setBlendMode(.destinationOut)
                    c.cgContext.drawLinearGradient(g, start: CGPoint(x: 0, y: size.height * 0.82), end: CGPoint(x: 0, y: size.height), options: [.drawsAfterEndLocation])
                }
            }
        }
        return draw(canvas) { ctx in
            ctx.setShadow(offset: CGSize(width: 0, height: 18), blur: 30, color: UIColor(white: 0, alpha: 0.55).cgColor)
            faded.draw(in: rect)
        }
    }

    /// The color panel the text sits on, with its bright edge: down the left
    /// of a landscape card, across the top of a vertical one.
    private static func slab(_ theme: CardTheme, _ size: CGSize) -> CIImage {
        let W = size.width, H = size.height
        let tall = H > W
        let image = draw(size) { ctx in
            func poly(_ pts: [(CGFloat, CGFloat)], _ color: UIColor) {
                ctx.beginPath()
                ctx.move(to: CGPoint(x: pts[0].0 * W, y: pts[0].1 * H))
                for p in pts.dropFirst() { ctx.addLine(to: CGPoint(x: p.0 * W, y: p.1 * H)) }
                ctx.closePath()
                ctx.setFillColor(color.cgColor)
                ctx.fillPath()
            }
            if tall {
                // Solid: the picture starts under it.
                poly([(0, 0), (1, 0), (1, 0.40), (0, 0.46)], theme.ink)
                poly([(0, 0.46), (1, 0.40), (1, 0.411), (0, 0.471)], theme.edge)
            } else {
                poly([(0, 0), (0.54, 0), (0.43, 1), (0, 1)], theme.ink.withAlphaComponent(0.94))
                poly([(0.54, 0), (0.554, 0), (0.444, 1), (0.43, 1)], theme.edge)
            }
        }
        return image ?? CIImage.empty()
    }

    /// A wash of ink toward the headshot's side (landscape) or the bottom
    /// (vertical), so the picture sits back.
    private static func fade(_ theme: CardTheme, _ size: CGSize) -> CIImage {
        let tall = size.height > size.width
        let image = draw(size) { ctx in
            let colors = [theme.ink.withAlphaComponent(0).cgColor, theme.ink.withAlphaComponent(tall ? 0.7 : 0.55).cgColor] as CFArray
            guard let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) else { return }
            let start = tall ? CGPoint(x: 0, y: size.height * 0.4) : CGPoint(x: size.width * 0.6, y: 0)
            let end = tall ? CGPoint(x: 0, y: size.height) : CGPoint(x: size.width, y: 0)
            ctx.drawLinearGradient(g, start: start, end: end, options: [])
        }
        return image ?? CIImage.empty()
    }

    /// No swing to show: the theme's ink with a glow, diagonal stripes and
    /// the rings of a big baseball off the corner.
    private static func graphic(_ theme: CardTheme, _ size: CGSize) -> CIImage {
        let W = size.width, H = size.height
        let image = draw(size) { ctx in
            theme.ink.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            // Stripes.
            ctx.saveGState()
            ctx.setStrokeColor(theme.pop.withAlphaComponent(0.1).cgColor)
            ctx.setLineWidth(26)
            let angle = 62 * CGFloat.pi / 180
            let dx = H / tan(angle)
            var x = -dx
            while x < W + dx {
                ctx.move(to: CGPoint(x: x, y: H))
                ctx.addLine(to: CGPoint(x: x + dx, y: 0))
                x += 70 / sin(angle)
            }
            ctx.strokePath()
            ctx.restoreGState()
            // Glow, top right.
            let colors = [theme.pop.withAlphaComponent(0.38).cgColor, theme.pop.withAlphaComponent(0).cgColor] as CFArray
            if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                ctx.drawRadialGradient(g, startCenter: CGPoint(x: W * 0.85, y: H * 0.2), startRadius: 0,
                                       endCenter: CGPoint(x: W * 0.85, y: H * 0.2), endRadius: max(W, H) * 0.6, options: [])
            }
            // A baseball's rings off the corner.
            let ball = CGRect(x: W - 880, y: -300, width: 1400, height: 1400)
            ctx.setStrokeColor(theme.pop.withAlphaComponent(0.3).cgColor)
            ctx.setLineWidth(6)
            ctx.strokeEllipse(in: ball)
            ctx.setStrokeColor(theme.pop.withAlphaComponent(0.22).cgColor)
            ctx.setLineWidth(16)
            ctx.setLineDash(phase: 0, lengths: [16, 16])
            ctx.strokeEllipse(in: ball.insetBy(dx: 120, dy: 120))
            ctx.setLineDash(phase: 0, lengths: [])
            ctx.setLineWidth(4)
            ctx.strokeEllipse(in: ball.insetBy(dx: 240, dy: 240))
        }
        return image ?? CIImage(color: CIColor(color: theme.ink)).cropped(to: CGRect(origin: .zero, size: size))
    }
}

/// Easing curves for the entrance.
enum Ease {
    static func outQuart(_ p: Double) -> Double { 1 - pow(1 - p, 4) }

    /// Past the end and back ("back" easing); `overshoot` sets how far.
    static func outBack(_ p: Double, _ overshoot: Double) -> Double {
        let c3 = overshoot + 1
        return 1 + c3 * pow(p - 1, 3) + overshoot * pow(p - 1, 2)
    }
}
