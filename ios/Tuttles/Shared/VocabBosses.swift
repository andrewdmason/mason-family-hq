import SwiftUI

// Each stage's boss is somebody: whoever lives at that place on the mountain
// and doesn't want them getting past. They have a face (an emoji, drawn
// large), a name, something to say before the round and something sore to
// say after losing it. A boss round opens on their entrance (VocabBossIntro).

struct VocabBossCharacter: Hashable {
    /// What they're called for short: "Rocky".
    let name: String
    /// What goes after it: "the Trash Bandit".
    let title: String
    let face: String
    /// What they say before the round.
    let taunt: String
    /// What they say when they've lost it.
    let sore: String
    /// Their colour: the glow behind them.
    let glow: Color

    var fullName: String { "\(name) \(title)" }

    private static func make(_ name: String, _ title: String, _ face: String, _ glow: Color, _ taunt: String, _ sore: String) -> Self {
        .init(name: name, title: title, face: face, taunt: taunt, sore: sore, glow: glow)
    }

    private static let purple = Color(red: 0.47, green: 0.31, blue: 0.86)
    private static let forest = Color(red: 0.16, green: 0.55, blue: 0.33)
    private static let ember = Color(red: 0.93, green: 0.36, blue: 0.14)
    private static let ice = Color(red: 0.25, green: 0.62, blue: 0.93)
    private static let gold = Color(red: 0.92, green: 0.66, blue: 0.10)

    /// In the order of the stages (VocabStage's places).
    private static let cast: [VocabBossCharacter] = [
        make("Rocky", "the Trash Bandit", "🦝", purple,
             "Nobody gets past my trailhead. Especially not somebody who can't define \"nocturnal\".",
             "Fine. Take the trail. I'm keeping the snacks."),
        make("Mossback", "the Grumpy Bear", "🐻", forest,
             "You woke me up for THIS? Make it quick. I have hibernating to do.",
             "Wake me when you're less annoying."),
        make("Snapjaw", "the Creek Lurker", "🐊", forest,
             "The toll for my creek is every word right. Or one leg. Your pick.",
             "Keep the leg. This time."),
        make("Lady Hiss", "Queen of the Ferns", "🐍", forest,
             "Ssso many wordsss. Ssso little time.",
             "Thisss isn't over."),
        make("Rumble", "the Rock Troll", "🧌", ember,
             "Me smash words. Then me smash you.",
             "Rumble impressed. Rumble hate that."),
        make("Echo", "the Copycat Bat", "🦇", purple,
             "I repeat every word you miss. Miss. Miss. Miss.",
             "You win. Win. Win. Ugh."),
        make("Talon", "the Sky Bully", "🦅", gold,
             "I can spot a wrong answer from a mile up.",
             "Lucky. I had the sun in my eyes."),
        make("Baron Buzz", "Lord of the Meadow", "🐝", gold,
             "This is MY meadow. Buzz off, or prove you belong here.",
             "Stung by a kid. How embarrassing."),
        make("Drizzle", "the Soggy Ghost", "👻", ice,
             "Booooo. Was that scary? I'm new at this.",
             "I'm telling the other ghosts you cheated."),
        make("Sir Headbutt", "the Mountain Goat", "🐐", ember,
             "Every one of these steps is mine. Climb them and I ram you off.",
             "My horns hurt. So does my pride."),
        make("Gusty", "the Windbag", "🌪️", ice,
             "I'll blow those words right out of your head!",
             "I've run out of puff."),
        make("Chillbert", "the Frozen Grump", "🥶", ice,
             "It's c-c-cold up here. Your brain will freeze before mine does.",
             "I'm m-m-melting with shame."),
        make("Tusk", "the Woolly Wall", "🦣", ice,
             "Nobody crosses my bridge. I'm ten thousand years old and very stubborn.",
             "Extinct AND beaten. What a day."),
        make("Nimbus", "the Cloud Dragon", "🐉", purple,
             "Tiny climber. I eat vocabulary lists for breakfast.",
             "I wasn't even hungry."),
        make("Boomer", "the Thunder Ogre", "👹", ember,
             "WHEN I SHOUT, MOUNTAINS FLINCH. DEFINE \"INTIMIDATE\".",
             "I'M NOT CRYING. IT'S RAIN."),
        make("Inky", "the Lake Squid", "🦑", purple,
             "Ten arms. One of you. I like my odds.",
             "I'm going back down where it's quiet."),
        make("Blip", "the Lost Alien", "👽", forest,
             "Greetings. On my planet we know ALL the words. Show me yours.",
             "Your language is ridiculous anyway."),
        make("Pinch", "the Cliff Scorpion", "🦂", ember,
             "One slip up here and it's a long way down.",
             "Ow. My stinger. My ego."),
        make("Captain Quit", "the Voice of Doubt", "😈", purple,
             "You're tired. It's far. Wouldn't it be easier to give up?",
             "Fine. You're tougher than you look."),
        make("The Examiner", "Keeper of the Summit", "🧙", gold,
             "So. You made it to the top. Let us see if you truly know your words.",
             "Go on, then. You're ready."),
    ]

    static func of(stage: Int) -> VocabBossCharacter {
        cast.indices.contains(stage - 1) ? cast[stage - 1]
            : make("The Guardian", "of Stage \(stage)", "👾", purple, "None shall pass without their words.", "Pass, then.")
    }
}

extension VocabBoss {
    var character: VocabBossCharacter { .of(stage: stage) }
}

extension VocabStage {
    /// Whoever's boss of this stage.
    var character: VocabBossCharacter { .of(stage: number) }
}

/// The same "random" number every time for a piece and what it's for.
private func scatter(_ piece: Int, _ salt: Int) -> Double {
    let x = sin(Double(piece) * 91.7 + Double(salt) * 271.3) * 43_758.5453
    return x - x.rounded(.down)
}

/// A boss's entrance, before the first question of their round: the words
/// BOSS ROUND slam in, they drop out of the sky and the screen shakes, rays
/// turn behind them and sparks rise, then their name, what they have to say,
/// and the way in. The round's clock doesn't start until they're let in. A
/// tap anywhere skips to the end of it. With Reduce Motion it's all just there.
struct VocabBossIntro: View {
    let boss: VocabBoss
    /// Lets the round begin.
    let begin: () -> Void
    let close: () -> Void

    /// How far the entrance has got: 0 nothing, 1 the title, 2 they've landed, 3 their name, 4 their taunt, 5 the button.
    @State private var step = 0
    @State private var landed = 0
    @State private var flash = 0.0
    @State private var started = Date()
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let who = boss.character
        ZStack {
            backdrop(who)

            VStack(spacing: 0) {
                Text("BOSS ROUND")
                    .font(.system(size: 20, weight: .black, design: .rounded))
                    .kerning(6)
                    .foregroundStyle(.white.opacity(0.85))
                    .scaleEffect(step >= 1 ? 1 : 3.2)
                    .opacity(step >= 1 ? 1 : 0)
                    .padding(.top, 64)

                Spacer(minLength: 12)

                face(who)

                VStack(spacing: 4) {
                    Text(who.name)
                        .font(.system(size: 44, weight: .heavy, design: .serif))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .offset(x: step >= 3 ? 0 : -420)
                    Text(who.title)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(who.glow.mix(with: .white, by: 0.6))
                        .offset(x: step >= 3 ? 0 : 420)
                    Text("Boss of \(boss.name)")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white.opacity(0.6))
                        .opacity(step >= 3 ? 1 : 0)
                        .padding(.top, 2)
                }
                .padding(.top, 10)

                Text("“\(who.taunt)”")
                    .font(.title3.weight(.medium))
                    .italic()
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 30)
                    .padding(.top, 22)
                    .opacity(step >= 4 ? 1 : 0)
                    .scaleEffect(step >= 4 ? 1 : 0.85)

                Spacer(minLength: 12)

                    Button(action: begin) {
                        Label("Bring it on", systemImage: "bolt.fill")
                            .font(.title3.weight(.bold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(who.glow)
                    .keyboardShortcut(.defaultAction)
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
                .opacity(step >= 5 ? 1 : 0)
                .offset(y: step >= 5 ? 0 : 40)
                .allowsHitTesting(step >= 5)
            }
            .vocabColumn()

            // The flash as they land.
            Color.white.opacity(flash).ignoresSafeArea().allowsHitTesting(false)
        }
        // The landing shakes everything.
        .modifier(VocabShake(travel: 10, animatableData: CGFloat(landed)))
        .overlay(alignment: .topLeading) {
            Button(action: close) {
                Image(systemName: "xmark").font(.subheadline.weight(.semibold)).foregroundStyle(.white).frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Close")
            .padding(.leading, 20)
            .padding(.top, 8)
        }
        .contentShape(.rect)
        // In a hurry: straight to the end of it.
        .onTapGesture { if step < 5 { withAnimation(.snappy) { step = 5 } } }
        .sensoryFeedback(.impact(weight: .heavy, intensity: 1), trigger: landed)
        .sensoryFeedback(.impact(weight: .light), trigger: step) { _, now in now == 3 || now == 5 }
        .task { await enter() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Boss round against \(who.fullName)")
    }

    /// The entrance, a beat at a time.
    private func enter() async {
        guard !still else {
            step = 5
            return
        }
        let beat = { (seconds: Double) in try? await Task.sleep(for: .seconds(seconds)) }
        await beat(0.15)
        if step < 1 { withAnimation(.spring(duration: 0.45, bounce: 0.35)) { step = 1 } }
        await beat(0.7)
        if step < 2 { withAnimation(.spring(duration: 0.5, bounce: 0.25)) { step = 2 } }
        await beat(0.32)
        // They hit the ground.
        withAnimation(.linear(duration: 0.45)) { landed += 1 }
        flash = 0.75
        withAnimation(.easeOut(duration: 0.5)) { flash = 0 }
        await beat(0.55)
        if step < 3 { withAnimation(.spring(duration: 0.5, bounce: 0.3)) { step = 3 } }
        await beat(0.6)
        if step < 4 { withAnimation(.spring(duration: 0.45, bounce: 0.3)) { step = 4 } }
        await beat(0.9)
        if step < 5 { withAnimation(.spring(duration: 0.5, bounce: 0.3)) { step = 5 } }
    }

    /// Them, dropped in from above, then never quite still.
    private func face(_ who: VocabBossCharacter) -> some View {
        TimelineView(.animation(paused: still)) { timeline in
            let t = timeline.date.timeIntervalSince(started)
            Text(who.face)
                .font(.system(size: 150))
                .shadow(color: who.glow.opacity(0.9), radius: 30)
                .shadow(color: .black.opacity(0.5), radius: 10, y: 12)
                // Breathing, and leaning from side to side.
                .scaleEffect(still ? 1 : 1 + 0.045 * sin(t * 2.6))
                .rotationEffect(.degrees(still ? 0 : 5 * sin(t * 1.7)))
                .offset(y: still ? 0 : 7 * sin(t * 2.1))
        }
        .frame(height: 190)
        .scaleEffect(step >= 2 ? 1 : 2.4)
        .offset(y: step >= 2 ? 0 : -620)
        .accessibilityHidden(true)
    }

    /// Night in their colour, rays turning behind them and sparks coming up.
    private func backdrop(_ who: VocabBossCharacter) -> some View {
        ZStack {
            Color(red: 0.06, green: 0.04, blue: 0.11)
            RadialGradient(colors: [who.glow.opacity(step >= 2 ? 0.75 : 0.25), .clear], center: UnitPoint(x: 0.5, y: 0.38),
                           startRadius: 10, endRadius: 420)
            if !still {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in
                        let t = timeline.date.timeIntervalSince(started)
                        let centre = CGPoint(x: size.width / 2, y: size.height * 0.38)
                        let reach = max(size.width, size.height)
                        // The rays, once they've landed.
                        if step >= 2 {
                            for ray in 0..<14 {
                                let angle = Double(ray) / 14 * 2 * Double.pi + t * 0.35
                                let wide = Double.pi / 14 * 0.55
                                var path = Path()
                                path.move(to: centre)
                                path.addLine(to: CGPoint(x: centre.x + cos(angle - wide) * reach, y: centre.y + sin(angle - wide) * reach))
                                path.addLine(to: CGPoint(x: centre.x + cos(angle + wide) * reach, y: centre.y + sin(angle + wide) * reach))
                                path.closeSubpath()
                                context.fill(path, with: .color(who.glow.opacity(ray % 2 == 0 ? 0.20 : 0.10)))
                            }
                        }
                        // Sparks drifting up the whole time.
                        for spark in 0..<46 {
                            let life = (t * (0.10 + scatter(spark, 1) * 0.16) + scatter(spark, 2)).truncatingRemainder(dividingBy: 1)
                            let x = scatter(spark, 3) * size.width + sin(t * (0.8 + scatter(spark, 4)) + Double(spark)) * 16
                            let y = size.height * (1.05 - life * 1.1)
                            let radius = 1.5 + scatter(spark, 5) * 3
                            context.opacity = sin(life * Double.pi) * 0.85
                            context.fill(Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)),
                                         with: .color(spark % 3 == 0 ? .white : who.glow.mix(with: .white, by: 0.45)))
                        }
                    }
                }
            }
        }
        .ignoresSafeArea()
        .animation(.easeOut(duration: 0.6), value: step)
    }
}
