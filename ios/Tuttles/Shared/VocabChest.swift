import SwiftUI

// The prize for an ordinary session: a chest, wood, silver or gold by how the
// session went, with coins in it for the house (HousePay.swift). The end of a
// session opens on it, full screen (VocabChestOpening): they tap it, it
// bursts, and the coins pour out and are counted, with sound to match
// (VocabChestSound.swift). Which chests were won, and
// whether they've been opened, is kept on the phone (VocabOffline.swift).
//
// (Chests used to hold a gross fact each. Andrew, 2026-11-26: just the coins.)

/// What a session's chest is made of.
enum VocabChest: String, Codable, CaseIterable, Comparable {
    case wood, silver, gold

    /// A session cut short (nothing left to review with a boss in the way)
    /// has to have got this far to earn a chest.
    static let fewest = 10

    private var rank: Int { Self.allCases.firstIndex(of: self) ?? 0 }
    static func < (a: Self, b: Self) -> Bool { a.rank < b.rank }

    var name: String {
        switch self {
        case .wood: "Wooden chest"
        case .silver: "Silver chest"
        case .gold: "Gold chest"
        }
    }

    /// One word for it: "Gold".
    var short: String {
        switch self {
        case .wood: "Wood"
        case .silver: "Silver"
        case .gold: "Gold"
        }
    }

    var tint: Color {
        switch self {
        case .wood: Color(red: 0.62, green: 0.40, blue: 0.22)
        case .silver: Color(red: 0.62, green: 0.67, blue: 0.74)
        case .gold: VocabLook.gold
        }
    }

    /// Readable on the page in the light and the dark.
    var text: Color {
        switch self {
        case .wood: Color(light: Color(red: 0.48, green: 0.29, blue: 0.13), dark: Color(red: 0.86, green: 0.66, blue: 0.46))
        case .silver: Color(light: Color(red: 0.33, green: 0.38, blue: 0.45), dark: Color(red: 0.80, green: 0.84, blue: 0.90))
        case .gold: Color(light: Color(red: 0.60, green: 0.42, blue: 0.02), dark: VocabLook.gold)
        }
    }

    /// Right answers in every twenty that count, to earn it.
    private var bar: Int {
        switch self {
        case .wood: 0
        case .silver: 15
        case .gold: 18
        }
    }

    /// The chest a session earns: gold for nine in ten right, silver for
    /// three in four. `counted` leaves out the brand-new words they didn't
    /// know, which can't be held against them; a new word they did know is
    /// one more right.
    static func earned(right: Int, counted: Int) -> VocabChest {
        guard counted > 0 else { return .wood }
        return allCases.last { right * 20 >= $0.bar * counted } ?? .wood
    }
}

/// A chest won: which session, and what it was made of.
struct VocabPrize: Codable, Hashable {
    let session: String
    let chest: VocabChest
    let day: String
    /// They've opened it. Until then the end of its session opens on it, shut.
    var opened: Bool? = nil
    /// Every answer right, so it held more than gold (VocabPay.coins). Nil from before there were perfect chests.
    var perfect: Bool? = nil

    var isOpen: Bool { opened ?? true }
}

// MARK: - The chest, drawn

/// A chest in its tier's colour, shut or thrown open.
struct VocabChestIcon: View {
    let chest: VocabChest
    var open = false
    var size: CGFloat = 84

    var body: some View {
        let dark = chest.tint.mix(with: .black, by: 0.35)
        let band = chest == .gold ? Color(red: 0.72, green: 0.46, blue: 0.05) : VocabLook.gold
        ZStack(alignment: .bottom) {
            // What's inside, lighting up the lid.
            Ellipse()
                .fill(RadialGradient(colors: [.white, VocabLook.gold.opacity(0.8), .clear], center: .center, startRadius: 0, endRadius: size * 0.5))
                .frame(width: size * 0.95, height: size * 0.6)
                .offset(y: -size * 0.3)
                .opacity(open ? 1 : 0)
            // The lid, hinged at the back.
            UnevenRoundedRectangle(topLeadingRadius: size * 0.22, topTrailingRadius: size * 0.22)
                .fill(LinearGradient(colors: [chest.tint.mix(with: .white, by: 0.25), chest.tint], startPoint: .top, endPoint: .bottom))
                .frame(width: size, height: size * 0.32)
                .overlay { Rectangle().fill(band).frame(width: size * 0.13) }
                .overlay(alignment: .bottom) { Rectangle().fill(dark).frame(height: 2) }
                .rotation3DEffect(.degrees(open ? 62 : 0), axis: (x: 1, y: 0, z: 0), anchor: .top, perspective: 0.5)
                .offset(y: -size * 0.46 - (open ? size * 0.16 : 0))
            // The box.
            RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
                .fill(LinearGradient(colors: [chest.tint, dark], startPoint: .top, endPoint: .bottom))
                .frame(width: size, height: size * 0.46)
                .overlay { Rectangle().fill(band).frame(width: size * 0.13) }
            // The lock, which comes off with the lid.
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(band.mix(with: .white, by: 0.25))
                .frame(width: size * 0.2, height: size * 0.2)
                .overlay { Circle().fill(dark).frame(width: size * 0.06) }
                .offset(y: -size * 0.36)
                .opacity(open ? 0 : 1)
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(0.2), radius: 6, y: 4)
        .accessibilityHidden(true)
    }
}

// MARK: - Opening it

/// The end of an ordinary session, before its numbers: the chest it earned,
/// alone on a dark screen, rattling until it's tapped. Then it winds up,
/// bursts, and its coins fly out and up into the count, one by one. Nothing
/// rides on it being watched: the coins are theirs once the session's over
/// (VocabOffline.award), and Reduce Motion gets the chest and the number.
struct VocabChestOpening: View {
    let chest: VocabChest
    let coins: Int
    /// The day's ten minutes aren't done, so the coins wait for them.
    let waiting: Bool
    /// It's been tapped: it's opened for good.
    var opening: () -> Void = {}
    /// On to the session's numbers.
    let done: () -> Void

    private enum Stage: Int { case shut, winding, open, counted }
    @State private var stage = Stage.shut
    /// It's dropped in.
    @State private var landed = false
    @State private var rattle = 0
    /// How wound up it is, 0 to 1.
    @State private var wind = 0.0
    @State private var burst: Date?
    @State private var banked = 0
    @State private var flash = 0.0
    @State private var ring = false
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var still
    /// What it sounds like (VocabChestSound.swift).
    private var sound: VocabChestSound { .shared }

    /// A coin's flight: thrown up out of the chest, then drawn into the count.
    fileprivate static let thrown = 0.8, drawn = 0.42

    /// When each coin leaves the chest, in seconds after it bursts: a longer
    /// pour for a bigger chest.
    fileprivate static func leaves(_ coin: Int, of all: Int) -> Double {
        0.08 + (0.5 + 0.03 * Double(all)) * Double(coin) / Double(max(1, all))
    }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let box = min(200, size.width * 0.5)
            let home = CGPoint(x: size.width / 2, y: size.height * 0.60)
            let count = CGPoint(x: size.width / 2, y: size.height * 0.24)
            ZStack {
                backdrop(home, size)
                if !still {
                    VocabChestLight(tint: chest.tint, centre: home, open: stage.rawValue >= Stage.open.rawValue)
                        .opacity(stage == .shut ? 0.45 : stage == .winding ? 0.45 + 0.4 * wind : 1)
                }
                // The ring that goes out from it as it bursts.
                Circle()
                    .stroke(.white.opacity(0.9), lineWidth: ring ? 2 : 26)
                    .frame(width: box, height: box)
                    .scaleEffect(ring ? 6 : 0.4)
                    .opacity(ring ? 0 : (stage == .open ? 1 : 0))
                    .position(home)
                    .allowsHitTesting(false)

                VocabChestIcon(chest: chest, open: stage.rawValue >= Stage.open.rawValue, size: box)
                    .scaleEffect(1 + 0.16 * wind)
                    .modifier(VocabShake(travel: stage == .winding ? 5 + 9 * wind : 5, animatableData: CGFloat(rattle)))
                    .shadow(color: chest.tint.opacity(0.5 + 0.5 * wind), radius: 30 + 40 * wind)
                    .scaleEffect(landed ? 1 : 0.4)
                    .position(x: home.x, y: landed ? home.y : -box)

                if let burst, !still {
                    VocabChestCoins(coins: coins, from: CGPoint(x: home.x, y: home.y - box * 0.22), to: count, start: burst,
                                    big: chest == .gold, tint: chest.tint)
                }

                words(count, size)

                Color.white.opacity(flash).ignoresSafeArea().allowsHitTesting(false)
                if chest == .gold, stage.rawValue >= Stage.open.rawValue { VocabConfetti() }
            }
        }
        .ignoresSafeArea()
        .contentShape(.rect)
        .onTapGesture(perform: open)
        .environment(\.colorScheme, .dark)
        .sensoryFeedback(trigger: rattle) { _, _ in
            stage == .winding ? .impact(weight: .medium, intensity: 0.35 + 0.65 * wind) : nil
        }
        .sensoryFeedback(.impact(weight: .heavy), trigger: burst)
        .sensoryFeedback(.impact(flexibility: .rigid, intensity: 0.7), trigger: banked)
        .sensoryFeedback(trigger: stage) { _, now in now == .counted ? .success : nil }
        .task {
            sound.prepare()
            withAnimation(.spring(duration: 0.7, bounce: 0.45).delay(0.15)) { landed = true }
            guard !still else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            try? await Task.sleep(for: .seconds(0.42))
            sound.play(.land)
            // It won't sit still until it's opened.
            try? await Task.sleep(for: .seconds(0.9))
            while stage == .shut, !Task.isCancelled {
                withAnimation(.linear(duration: 0.4)) { rattle += 1 }
                sound.play(.rattle)
                try? await Task.sleep(for: .seconds(1.5))
            }
        }
        .onDisappear { sound.rest() }
        .accessibilityAddTraits(.isModal)
    }

    private func backdrop(_ home: CGPoint, _ size: CGSize) -> some View {
        let lit = stage.rawValue >= Stage.open.rawValue
        return ZStack {
            Color(red: 0.03, green: 0.03, blue: 0.07)
            RadialGradient(colors: [chest.tint.opacity(lit ? 0.75 : 0.32 + 0.25 * wind), chest.tint.opacity(lit ? 0.22 : 0.08), .clear],
                           center: UnitPoint(x: 0.5, y: home.y / max(1, size.height)), startRadius: 10, endRadius: size.height * (lit ? 0.75 : 0.5))
        }
        .ignoresSafeArea()
    }

    /// What's said: whose chest it is and what to do, then the count, then where the coins go.
    @ViewBuilder private func words(_ count: CGPoint, _ size: CGSize) -> some View {
        let bright = LinearGradient(colors: [.white, chest.tint.mix(with: .white, by: 0.35)], startPoint: .top, endPoint: .bottom)
        if stage.rawValue < Stage.open.rawValue {
            VStack(spacing: 4) {
                Text("You earned a").font(.title3.weight(.semibold)).foregroundStyle(.white.opacity(0.7))
                Text(chest.name)
                    .font(.system(size: 44, weight: .black, design: .rounded))
                    .foregroundStyle(bright)
                    .shadow(color: chest.tint.opacity(0.8), radius: 16)
            }
            .multilineTextAlignment(.center)
            .opacity(landed ? 1 - wind : 0)
            .position(count)
            .transition(.opacity)

            Button(action: open) {
                Text("Tap to open")
                    .font(.system(.title2, design: .rounded).weight(.heavy))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 26).padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .scaleEffect(pulse ? 1.08 : 0.96)
            .opacity(landed && stage == .shut ? 1 : 0)
            .position(x: size.width / 2, y: size.height * 0.84)
            .accessibilityLabel("Open the \(chest.name.lowercased())")
        } else {
            VStack(spacing: 0) {
                HStack(alignment: .center, spacing: 12) {
                    VocabCoin(size: 54)
                    Text("+\(banked)")
                        .font(.system(size: 88, weight: .black, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText(value: Double(banked)))
                        .foregroundStyle(LinearGradient(colors: [.white, VocabLook.gold], startPoint: .top, endPoint: .bottom))
                        .shadow(color: VocabLook.gold.opacity(0.8), radius: 18)
                }
                Text(coins == 1 ? "coin" : "coins")
                    .font(.system(.title2, design: .rounded).weight(.heavy))
                    .foregroundStyle(.white.opacity(0.8))
                    .padding(.top, -8)
            }
            .scaleEffect(stage == .counted ? 1.1 : 1)
            .position(count)
            .transition(.scale(scale: 0.5).combined(with: .opacity))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(coins) coins")

            if stage == .counted {
                VStack(spacing: 14) {
                    Text(waiting ? "They go in when today's ten minutes are done." : "They're yours to spend.")
                        .font(.headline)
                        .foregroundStyle(.white.opacity(0.85))
                    Group {
                        if chest != .gold {
                            Text("9 in 10 right is a gold chest: \(VocabPay.bonus(.gold)) coins.")
                        } else if coins >= VocabPay.perfectCoins {
                            Text("Every one right: a perfect chest. Gold all day, with the ten minutes done, is a gem.")
                        } else {
                            Text("Every one right is \(VocabPay.perfectCoins) coins. Gold all day, with the ten minutes done, is a gem.")
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.6))
                    Button(action: done) {
                        Text("Continue").font(.headline).frame(maxWidth: .infinity).frame(height: 40)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(TuttlesLook.accent)
                    .keyboardShortcut(.defaultAction)
                    .padding(.top, 6)
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
                .frame(maxWidth: 520)
                .position(x: size.width / 2, y: size.height * 0.87)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private func open() {
        guard stage == .shut, landed else { return }
        opening()
        guard !still else {
            banked = coins
            withAnimation(.smooth) { stage = .counted }
            sound.play(.counted)
            return
        }
        stage = .winding
        sound.play(.wind)
        Task {
            // Winding up: harder and faster, until it can't hold.
            let beats = 10
            for beat in 0..<beats {
                let gap = 0.15 - 0.009 * Double(beat)
                withAnimation(.linear(duration: gap)) {
                    rattle += 1
                    wind = Double(beat + 1) / Double(beats)
                }
                try? await Task.sleep(for: .seconds(gap))
            }
            let now = Date()
            sound.play(.burst)
            burst = now
            flash = 0.95
            withAnimation(.spring(duration: 0.5, bounce: 0.6)) {
                stage = .open
                wind = 0
            }
            withAnimation(.easeOut(duration: 0.7)) { flash = 0 }
            withAnimation(.easeOut(duration: 0.8)) { ring = true }
            // Each coin is counted as it gets there.
            for coin in 0..<coins {
                let due = now.addingTimeInterval(Self.leaves(coin, of: coins) + Self.thrown + Self.drawn)
                let wait = due.timeIntervalSinceNow
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                withAnimation(.snappy(duration: 0.15)) { banked = coin + 1 }
                sound.coin(coin, of: coins)
            }
            try? await Task.sleep(for: .seconds(0.4))
            withAnimation(.spring(duration: 0.5, bounce: 0.5)) { stage = .counted }
            sound.play(.counted)
        }
    }

    /// The same "random" number every time for a piece and what it's for.
    fileprivate static func scatter(_ piece: Int, _ salt: Int) -> Double {
        let x = sin(Double(piece) * 127.1 + Double(salt) * 311.7) * 43_758.5453
        return x - x.rounded(.down)
    }

    /// Where a coin is `life` seconds after it left the chest, and how far
    /// through being drawn into the count (0 until then).
    fileprivate static func flight(_ coin: Int, life: Double, from: CGPoint, to: CGPoint, in size: CGSize) -> (at: CGPoint, drawn: Double) {
        func thrownTo(_ t: Double) -> CGPoint {
            let across = (scatter(coin, 1) - 0.5) * size.width * 1.05
            let up = (0.95 + scatter(coin, 2) * 0.4) * size.height
            return CGPoint(x: from.x + across * t, y: from.y - up * t + 1.35 * size.height * t * t)
        }
        guard life > thrown else { return (thrownTo(life), 0) }
        let k = min(1, (life - thrown) / drawn)
        let start = thrownTo(thrown), pull = k * k
        return (CGPoint(x: start.x + (to.x - start.x) * pull, y: start.y + (to.y - start.y) * pull), k)
    }
}

/// A coin, face on.
struct VocabCoin: View {
    var size: CGFloat = 24

    var body: some View {
        Circle()
            .fill(LinearGradient(colors: [Color(red: 1, green: 0.90, blue: 0.45), VocabLook.gold, Color(red: 0.86, green: 0.58, blue: 0.06)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay { Circle().strokeBorder(Color(red: 0.72, green: 0.46, blue: 0.05), lineWidth: size * 0.08) }
            .overlay { Circle().strokeBorder(.white.opacity(0.5), lineWidth: size * 0.04).padding(size * 0.2) }
            .frame(width: size, height: size)
            .shadow(color: VocabLook.gold.opacity(0.7), radius: size * 0.3)
            .accessibilityHidden(true)
    }
}

/// The light behind the chest: rays turning slowly, and glints rising off it.
private struct VocabChestLight: View {
    let tint: Color
    let centre: CGPoint
    let open: Bool

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let t = timeline.date.timeIntervalSinceReferenceDate
                let reach = max(size.width, size.height)
                let colour = open ? VocabLook.gold.mix(with: .white, by: 0.3) : tint
                context.blendMode = .plusLighter
                let rays = 14
                for ray in 0..<rays {
                    let angle = t * 0.22 + Double(ray) * 2 * .pi / Double(rays)
                    let half = ray % 2 == 0 ? 0.10 : 0.055
                    var path = Path()
                    path.move(to: centre)
                    path.addLine(to: CGPoint(x: centre.x + cos(angle - half) * reach, y: centre.y + sin(angle - half) * reach))
                    path.addLine(to: CGPoint(x: centre.x + cos(angle + half) * reach, y: centre.y + sin(angle + half) * reach))
                    path.closeSubpath()
                    context.fill(path, with: .radialGradient(Gradient(colors: [colour.opacity(open ? 0.55 : 0.4), colour.opacity(0.12), .clear]),
                                                             center: centre, startRadius: 20, endRadius: reach * 0.62))
                }
                // Glints drifting up, each on its own loop.
                for glint in 0..<28 {
                    let speed = 0.16 + VocabChestOpening.scatter(glint, 11) * 0.2
                    let life = (t * speed + VocabChestOpening.scatter(glint, 12)).truncatingRemainder(dividingBy: 1)
                    let x = centre.x + (VocabChestOpening.scatter(glint, 13) - 0.5) * size.width * 0.95 + sin(t + Double(glint)) * 8
                    let y = centre.y + size.height * 0.22 - life * size.height * 0.7
                    let radius = (2 + VocabChestOpening.scatter(glint, 14) * 4) * (0.6 + 0.4 * sin(t * 3 + Double(glint)))
                    context.opacity = sin(life * .pi) * (open ? 1 : 0.6)
                    context.fill(Self.glint(at: CGPoint(x: x, y: y), radius: radius * 2), with: .color(.white))
                }
            }
        }
        .allowsHitTesting(false)
    }

    /// A four-pointed twinkle.
    static func glint(at centre: CGPoint, radius: CGFloat) -> Path {
        var path = Path()
        for point in 0..<8 {
            let angle = Double(point) * .pi / 4
            let r = point % 2 == 0 ? radius : radius * 0.28
            let p = CGPoint(x: centre.x + cos(angle) * r, y: centre.y + sin(angle) * r)
            if point == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }
}

/// What comes out of the chest when it bursts: sparks every way at once, and
/// the coins, thrown up turning over and then drawn into the count.
private struct VocabChestCoins: View {
    let coins: Int
    let from: CGPoint
    let to: CGPoint
    let start: Date
    let big: Bool
    let tint: Color

    private static let rim = Color(red: 0.72, green: 0.46, blue: 0.05)
    private static let face = Gradient(colors: [Color(red: 1, green: 0.92, blue: 0.5), VocabLook.gold, Color(red: 0.88, green: 0.6, blue: 0.08)])

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let t = timeline.date.timeIntervalSince(start)
                // Sparks, gone in a second.
                if t < 1.1 {
                    let life = t / 1.1, out = 1 - pow(1 - life, 3)
                    var sparks = context
                    sparks.blendMode = .plusLighter
                    sparks.opacity = 1 - life * life
                    for spark in 0..<(big ? 70 : 44) {
                        let angle = VocabChestOpening.scatter(spark, 21) * 2 * .pi
                        let reach = (0.18 + VocabChestOpening.scatter(spark, 22) * 0.5) * size.height * out
                        let at = CGPoint(x: from.x + cos(angle) * reach, y: from.y + sin(angle) * reach * 0.9 + 60 * life * life)
                        let radius = (5 + VocabChestOpening.scatter(spark, 23) * 9) * (1 - life * 0.5)
                        let colour = spark % 3 == 0 ? Color.white : spark % 3 == 1 ? VocabLook.gold : tint.mix(with: .white, by: 0.4)
                        sparks.fill(VocabChestLight.glint(at: at, radius: radius), with: .color(colour))
                    }
                }
                for coin in 0..<coins {
                    let life = t - VocabChestOpening.leaves(coin, of: coins)
                    guard life > 0 else { continue }
                    let flight = VocabChestOpening.flight(coin, life: life, from: from, to: to, in: size)
                    guard flight.drawn < 1 else { continue }
                    // Growing as it comes out, shrinking into the count; turning over all the way.
                    let radius = 15 * min(1, 0.4 + life * 4) * (1 - 0.45 * flight.drawn)
                    let turn = cos(life * (7 + VocabChestOpening.scatter(coin, 3) * 6) + VocabChestOpening.scatter(coin, 4) * 6.28)
                    let width = max(0.16, abs(turn)) * radius
                    var piece = context
                    piece.translateBy(x: flight.at.x, y: flight.at.y)
                    piece.rotate(by: .radians((VocabChestOpening.scatter(coin, 5) - 0.5) * 1.2))
                    let rect = CGRect(x: -width, y: -radius, width: width * 2, height: radius * 2)
                    // A trail behind it on the way in.
                    if flight.drawn > 0 {
                        var glow = piece
                        glow.blendMode = .plusLighter
                        glow.opacity = 0.5
                        glow.fill(Path(ellipseIn: rect.insetBy(dx: -6, dy: -6)), with: .color(VocabLook.gold))
                    }
                    piece.fill(Path(ellipseIn: rect), with: .linearGradient(Self.face, startPoint: CGPoint(x: -width, y: -radius), endPoint: CGPoint(x: width, y: radius)))
                    piece.stroke(Path(ellipseIn: rect.insetBy(dx: 1, dy: 1)), with: .color(Self.rim), lineWidth: 2)
                    if abs(turn) > 0.5 {
                        piece.stroke(Path(ellipseIn: rect.insetBy(dx: width * 0.45, dy: radius * 0.45)), with: .color(.white.opacity(0.55)), lineWidth: 1.5)
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }
}
