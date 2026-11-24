import SwiftUI

// The prize for beating a boss: a joke nobody at school would tell them.
// Dark, gross and sweary on purpose (their dad asked for R-rated); nothing
// sexual, and nothing at the expense of what someone is. They live here so the list is easy to change: add, cut or swap
// lines and each stage's boss picks up whatever's in its place.

struct VocabJoke: Hashable {
    let setup: String
    let punchline: String
}

enum VocabJokes {
    static let all: [VocabJoke] = [
        .init(setup: "I want to die peacefully in my sleep, like my grandpa.", punchline: "Not screaming, like the passengers in his car."),
        .init(setup: "What did one butt cheek say to the other?", punchline: "Together, we can stop this shit."),
        .init(setup: "What's the last thing to go through a bug's mind when it hits the windshield?", punchline: "Its ass."),
        .init(setup: "Why don't cannibals eat clowns?", punchline: "They taste funny."),
        .init(setup: "What's the difference between a fart and a shart?", punchline: "About three seconds of pure terror."),
        .init(setup: "My grandma said I'd get her recliner over her dead body.", punchline: "Great chair."),
        .init(setup: "What's the difference between a broke banker and a pigeon?", punchline: "The pigeon can still make a deposit on a Mercedes."),
        .init(setup: "Where did Sally go when the fireworks factory blew up?", punchline: "Everywhere."),
        .init(setup: "I started crying while Dad was cutting onions.", punchline: "Onions was such a good dog."),
        .init(setup: "What's the difference between boogers and broccoli?", punchline: "Kids will actually eat boogers."),
        .init(setup: "Give a man a match and he's warm for a night.", punchline: "Set him on fire and he's warm for the rest of his life."),
        .init(setup: "Why did the trust-fund kid cross the road?", punchline: "His dad owns both sides."),
        .init(setup: "My uncle's last words?", punchline: "\"Hold my drink and watch this.\""),
        .init(setup: "What's the definition of bravery?", punchline: "Someone with diarrhea chancing a fart."),
        .init(setup: "My dad died because we couldn't remember his blood type.", punchline: "His last words were \"Be positive.\" It's hard without him."),
        .init(setup: "\"I work with animals,\" the guy said. \"Aww, what do you do?\"", punchline: "\"I'm a butcher.\""),
        .init(setup: "Rich people have collections. Poor people have a hoarding problem.", punchline: "Same crap, bigger house."),
        .init(setup: "What did the cannibal get for showing up late to dinner?", punchline: "The cold shoulder."),
        .init(setup: "Why did the chicken cross the road?", punchline: "To show the possum it could be done."),
        .init(setup: "What's red and bad for your teeth?", punchline: "A brick."),
        .init(setup: "What were my grandfather's last words before he kicked the bucket?", punchline: "\"How far do you think I can kick this bucket?\""),
        .init(setup: "What's the first rule of taco night?", punchline: "Never trust a fart."),
        .init(setup: "Money can't buy happiness.", punchline: "But it's a hell of a lot nicer to cry in a Ferrari."),
        .init(setup: "Even useless people can put a smile on your face.", punchline: "Like when you push them down the stairs."),
        .init(setup: "How many rich kids does it take to change a light bulb?", punchline: "None. \"We have a guy for that.\""),
        .init(setup: "What has two butts and kills people?", punchline: "An assassin."),
        .init(setup: "What's green, fuzzy, and would kill you if it fell out of a tree?", punchline: "A pool table."),
        .init(setup: "We were so poor growing up that burglars broke in.", punchline: "They left us twenty bucks and a note that said \"Damn.\""),
        .init(setup: "What's grosser than finding a worm in your apple?", punchline: "Finding half a worm. Grosser than that? Finding it later."),
        .init(setup: "When I die, I want my last words to be:", punchline: "\"I buried a million dollars under the...\""),
        .init(setup: "Mom says \"shit\" isn't a vocabulary word.", punchline: "Dad says, \"The hell it isn't.\""),
    ]

    /// A stage's joke: the same one every time for that boss. `shift` moves
    /// one kid's along from the other's, so brothers can't spoil each other's.
    static func joke(stage: Int, shift: Int = 0) -> VocabJoke? {
        guard !all.isEmpty else { return nil }
        return all[(max(1, stage) - 1 + shift) % all.count]
    }
}

/// The prize on the end screen of a boss round won: the joke's first half,
/// and its second half when they tap for it.
struct VocabJokeCard: View {
    let joke: VocabJoke
    @State private var told = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Your prize: a joke you can't tell at school", systemImage: "face.smiling.inverse")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VocabLook.bossText)
            Text(joke.setup).font(.title3.weight(.medium))
            if told {
                Text(joke.punchline)
                    .font(.title3.weight(.bold))
                    .transition(.scale(scale: 0.6, anchor: .leading).combined(with: .opacity))
            } else {
                Button { withAnimation(.spring(duration: 0.4, bounce: 0.45)) { told = true } } label: {
                    Text("Go on…").font(.headline).frame(maxWidth: .infinity).frame(height: 34)
                }
                .buttonStyle(.glass)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vocabGlass(tint: VocabLook.boss.opacity(0.12))
        .sensoryFeedback(.impact(weight: .medium), trigger: told)
    }
}
