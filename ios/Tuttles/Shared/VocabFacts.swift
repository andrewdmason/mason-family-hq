import SwiftUI

// The prize for an ordinary session: a chest on its end screen, and in it a
// fact that's gross or shocking and true (their dad asked for them at full
// strength, whatever their age). The chest is wood, silver or gold by how
// the session went, and the better chests hold the stronger facts. Which fact
// is luck: it's drawn from the ones they haven't had, so no two sessions (and
// no two brothers) get the same run of them. What they've found is kept on
// the phone (VocabOffline.swift) and shown on the Progress screen.
//
// The facts live here so the list is easy to change. Add to the END of a
// tier's list only: a fact is kept by its place in it, so cutting or
// reordering would change which ones a kid has found. To drop one, blank it
// ("") and it's never drawn or shown.

/// What a session's chest is made of.
enum VocabChest: String, Codable, CaseIterable, Comparable {
    case wood, silver, gold

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

struct VocabFact: Hashable, Identifiable {
    let id: Int
    let tier: VocabChest
    let text: String
}

/// A chest won: which session, what it was made of and what was in it.
struct VocabPrize: Codable, Hashable {
    let session: String
    let fact: Int
    let chest: VocabChest
    let day: String
    /// They've opened it. Until then what's in it isn't theirs: it waits,
    /// shut, with the facts they've found.
    var opened: Bool? = nil

    var isOpen: Bool { opened ?? true }
}

enum VocabFacts {
    /// A session cut short (nothing left to review with a boss in the way)
    /// has to have got this far to earn a chest.
    static let fewest = 10

    /// Gross.
    private static let wood: [String] = [
        "Honey is nectar that bees have swallowed, carried home in a second stomach and thrown back up, over and over, until it's thick.",
        "Jell-O and gummy bears get their wobble from gelatin, which is made by boiling the skin, bones and tendons of pigs and cows.",
        "The shiny coating on a lot of candy is shellac: a goo that oozes out of the lac bug.",
        "The red in plenty of candy, yogurt and lipstick is carmine. That's female cochineal bugs, dried and crushed.",
        "Under U.S. food rules, a jar of peanut butter can hold over a hundred bits of insect and a few rodent hairs and still be sold.",
        "U.S. rules allow chocolate up to 60 insect fragments per 100 grams. That's about 25 in a regular bar.",
        "Wombats poop cubes. About a hundred a night, stacked up to mark their territory.",
        "A lot of the white sand on tropical beaches is parrotfish poop. They chew up coral and it comes out the other end as sand.",
        "Herring talk to each other by farting. Scientists named the sound a Fast Repetitive Tick. FRT for short.",
        "Manatees move up and down in the water by holding in their farts or letting them go.",
        "Some turtles spend the whole winter underwater, breathing through their butts.",
        "Lobsters pee out of their faces, from openings under their eyes, and squirt it at each other to say who's boss.",
        "Capuchin monkeys pee on their hands and rub it into their fur and feet.",
        "A hippo marks its territory by spinning its tail like a propeller while it poops, flinging it in every direction.",
        "A penguin can fire its poop more than four feet from the nest without standing up.",
        "When a camel spits at you, it isn't spit. It's what was in its stomach.",
        "Turkey vultures cool off by pooping on their own legs. If you bother one, it throws up on you.",
        "Rabbits eat their own poop, fresh, straight from the source, to digest their food a second time.",
        "A baby koala's first solid food is a special runny poop called pap, eaten straight from its mother.",
        "A housefly can't chew. It throws up on your food to melt it, then sucks it back up. It also tastes with its feet.",
        "Butterflies drink mud, pee, tears and the juice of rotting animals. Some drink blood.",
        "A cockroach can live for about a week with its head cut off. In the end it dies of thirst.",
        "You shed tens of thousands of skin cells every minute. Some of the dust in your room is you.",
        "You make about a quart of spit a day and swallow nearly all of it.",
        "Your nose makes about a quart of snot every day. You swallow most of it without noticing.",
        "Poop is brown because of dead red blood cells. Your body breaks down the old ones and that's the color that comes out.",
        "Farts burn. The hydrogen and methane in them are flammable.",
        "Less than one percent of a fart is the part that stinks.",
        "Sweat has no smell. The stink is bacteria on your skin eating it.",
        "The bacteria that make feet stink are close cousins of the ones used to ripen Limburger cheese. Mosquitoes love both.",
        "Ambergris is a waxy lump that forms in a sperm whale's gut and comes out one end or the other. It's been used in expensive perfume for centuries.",
        "A chemical that gives poop much of its smell is also in jasmine flowers. Perfume makers add it on purpose.",
        "One of the world's most expensive coffees is made from beans that a civet, a cat-like animal, has eaten and pooped out.",
        "Bird's nest soup is made from real nests, and the nests are made of hardened bird spit.",
        "Flushing with the lid up throws a mist of tiny droplets several feet into the air. Think about where your toothbrush lives.",
        "Tests keep finding that the average phone carries about ten times more bacteria than a toilet seat.",
        "A used kitchen sponge can hold tens of billions of bacteria in a space the size of a sugar cube. That's about as crowded as poop.",
        "The \"chlorine smell\" at a pool, and the red eyes, aren't from chlorine. They're from chlorine reacting with pee and sweat.",
        "Eating a polar bear's liver can kill you. It holds so much vitamin A that explorers who tried it had their skin peel off.",
        "A sloth poops about once a week, and can lose up to a third of its body weight doing it. Moths live in its fur.",
        "An eight-inch Viking poop, about 1,200 years old, is on display in a museum in York, England. It's been valued at $39,000.",
        "Astronauts left 96 bags of poop, pee and vomit on the Moon. They're still there.",
        "On the Space Station, yesterday's pee is cleaned up and becomes tomorrow's drinking water.",
        "A Frenchman named Michel Lotito ate an entire small airplane. It took him two years, a few bites a day.",
        "English kings had a servant called the Groom of the Stool, whose job was to help the king poop. It was one of the most powerful jobs at court.",
        "Romans washed their clothes in old pee, and some used it to whiten their teeth. There was so much money in pee that the emperor taxed it.",
        "Romans sweetened their wine with a syrup boiled down in lead pots. It tasted great. It was poison.",
        "Phosphorus was discovered in 1669 by a man boiling down about 1,500 gallons of pee, hoping to find gold in it.",
        "For centuries doctors tested for diabetes by tasting the patient's pee. Sweet meant yes.",
        "Pus is mostly dead white blood cells: the bodies of the soldiers that died fighting your infection.",
        "Many baby birds poop in a neat little bag. The parents carry it away, or eat it.",
        "The bombardier beetle sprays boiling-hot chemicals out of its rear end, with a pop you can hear.",
        "Some ants in Borneo defend the nest by blowing themselves up, bursting to cover the enemy in sticky yellow poison.",
        "Horned lizards can shoot blood out of their eyes, up to five feet.",
        "A hagfish can turn a bucket of water into thick slime in under a second. Sharks that bite one choke on it.",
        "A frightened sea cucumber shoots its own guts out of its butt. Then it grows new ones.",
        "A starfish eats by pushing its stomach out through its mouth, digesting its meal outside its body, and pulling the stomach back in.",
        "Frogs swallow with their eyeballs. They pull their eyes down into their heads to push the food down their throats.",
        "In 1919 a tank burst in Boston and a 25-foot wave of molasses went through the streets at 35 miles an hour. It killed 21 people.",
        "In 1814 a brewery vat burst in London. A wave of beer knocked down houses and killed eight people.",
        "The astronomer Tycho Brahe lost his nose in a sword fight over math, and wore a metal one for the rest of his life.",
        "Your mattress is home to somewhere between thousands and millions of dust mites, living on the skin you shed.",
        "Under the streets of Paris there are tunnels stacked to the ceiling with the bones of about six million people.",
        "Your stomach acid is strong enough to eat into a steel razor blade. Your stomach survives by growing a new lining every few days.",
    ]

    /// Grosser, and the start of shocking.
    private static let silver: [String] = [
        "Tiny eight-legged mites live in the pores of your face. At night they crawl out onto your skin to mate.",
        "Scientists swabbed 60 belly buttons and found 2,368 kinds of bacteria. About 1,500 of them may be new to science.",
        "A big part of your poop was never food. Take out the water and up to half of it is bacteria, dead and alive.",
        "If you hold in a fart, some of the gas soaks into your blood and comes out later in your breath.",
        "Tonsil stones are lumps of old food, dead cells and bacteria that harden in the back of your throat. They smell like something died.",
        "Pinworms are the most common worm infection in American kids. At night the females crawl out of your butt to lay eggs. That's the itch.",
        "A tapeworm can grow to more than 30 feet long inside a person's gut and live there for years.",
        "Hundreds of millions of people have foot-long roundworms living in their intestines. Now and then one crawls out of a nose.",
        "In parts of Africa there's a worm called the eye worm. You can watch it crawl across the white of your own eye.",
        "A human botfly's maggot grows under your skin for weeks, breathing through a little hole. You can feel it move.",
        "A fungus takes over an ant's body, walks it up a plant, makes it bite down, and then grows a stalk out of the ant's head.",
        "There's a parasite that eats a fish's tongue, then clamps on and lives in the fish's mouth as its new tongue.",
        "A barnacle called Sacculina grows roots through a crab's whole body and takes over its behavior. The crab spends the rest of its life raising the barnacle's babies.",
        "The emerald jewel wasp stings a cockroach in the brain, leads it away by its antenna like a dog on a leash, and lays an egg on it. The baby eats it alive.",
        "Horsehair worms grow inside crickets, then make the cricket jump into water and drown so the worm can wriggle out.",
        "A parasite climbs into a snail's eye stalks and pulses so they look like fat caterpillars. A bird eats them. That's the plan.",
        "A parasite in cat poop makes rats lose their fear of cats. As many as a third of all people are carrying it.",
        "The Surinam toad's eggs sink into the skin of her back. Weeks later the babies punch their way out through the holes.",
        "Babies of one worm-like amphibian have special teeth for peeling off their mother's skin and eating it. She grows more.",
        "Sand tiger sharks start eating before they're born. The biggest baby eats its brothers and sisters in the womb.",
        "When it's threatened, the hairy frog breaks its own toe bones and pushes them out through its skin as claws.",
        "A frog that eats something bad can throw up its entire stomach, let it hang out of its mouth, and wipe it clean with its hand.",
        "A vampire bat that finds no blood will beg, and a friend will vomit some into its mouth.",
        "Shrikes are small songbirds that stick mice and lizards on thorns and barbed wire to save for later.",
        "Vulture bees don't visit flowers. They eat rotting meat, and they make a kind of honey out of it.",
        "Casu marzu is a Sardinian cheese served full of live maggots. They can jump six inches, so people shield their eyes.",
        "A goo from sacs beside a beaver's butt smells so much like vanilla that it's been used to flavor food and perfume.",
        "Many kinds of fig are pollinated by a wasp that crawls inside and dies there. The fig digests her.",
        "An ingredient used to soften factory bread dough has been made from duck feathers, and from human hair.",
        "Doctors still put live maggots on wounds on purpose. They eat only the dead flesh and leave the wound clean.",
        "A real medical treatment is the poop transplant: a healthy person's poop is put into a sick person's gut. It also comes in capsules.",
        "For hundreds of years Europeans ground up Egyptian mummies and ate the powder as medicine.",
        "Until the 1900s, artists could buy a paint called Mummy Brown. It was made of ground-up mummies.",
        "False teeth used to be real teeth, pulled from dead soldiers on battlefields. After one battle they were sold as \"Waterloo teeth.\"",
        "George Washington's false teeth weren't wood. They were hippo ivory, lead, and other people's teeth.",
        "Romans with epilepsy were told to drink the warm blood of a gladiator who had just been killed.",
        "To make a mummy, Egyptian embalmers pushed a hook up the nose, stirred the brain to mush, and drained it out through the nostrils.",
        "In the 1700s, rescuers tried to revive drowned people by blowing tobacco smoke up their butts. Kits for it hung along the river in London.",
        "In 1898 the company that makes Bayer aspirin started selling heroin as a cough medicine for children.",
        "In the 1920s people drank radioactive water as a health tonic. One rich fan drank about 1,400 bottles. His jaw came apart.",
        "Factory girls who painted glow-in-the-dark watch dials were told to point the brush with their lips. The paint was radium. Their jaws rotted.",
        "Shoe stores used to have X-ray machines so kids could look at the bones of their own feet, for fun, as often as they liked.",
        "Victorians loved a bright green wallpaper that was colored with arsenic. In damp rooms it gave off poison gas.",
        "In the summer of 1858 the river in London was so full of sewage that the smell nearly shut down Parliament.",
        "In Victorian London you could make a living collecting dog poop off the street and selling it to leather makers.",
        "Sailors with scurvy watched old scars open back up into wounds, and bones that had healed years before come apart again.",
        "The Black Death killed between a third and a half of the people in Europe in about five years. Egg-sized lumps swelled in the armpits and burst.",
        "The first vaccine: in 1796 a doctor scraped pus from a milkmaid's cowpox sore into a cut on an eight-year-old boy, then tried to give him smallpox.",
        "Once the symptoms of rabies begin it's almost always fatal. Near the end, even the sight of a glass of water sends the throat into spasms.",
        "The bite of one American tick can make you allergic to red meat. One burger and you break out in hives.",
        "Tasmanian devils are being wiped out by a cancer that's contagious. They catch it by biting each other's faces.",
        "A snake's cut-off head can still bite, and still inject venom, for an hour or more.",
        "In 1970 officials in Oregon blew up a dead whale with half a ton of dynamite. Chunks of rotten blubber rained down on the crowd, and one crushed a car.",
        "There are \"body farms\" where donated human bodies are left outside to rot, so scientists can study exactly how it goes.",
        "A dead body can still groan. When it's moved, leftover air gets pushed past the vocal cords.",
        "There are more than 200 dead bodies on Mount Everest. It's too dangerous to bring them down, so climbers use some as landmarks.",
        "People who chew their hair can grow a hairball in the stomach. Surgeons have pulled out ones weighing several pounds, with a tail running down into the gut.",
        "There's a rare brain condition, Cotard's syndrome, where people are sure they're dead, or that their insides have rotted away.",
        "In auto-brewery syndrome, yeast in a person's gut turns bread and pasta into alcohol. They get drunk without drinking.",
        "A chicken named Mike lived for 18 months after his head was cut off. His owner fed him with an eyedropper, down the hole.",
        "In 1848 an iron rod more than three feet long shot through Phineas Gage's skull and out the top. He stayed awake, talked, and lived twelve more years.",
        "A scientist proved that bacteria cause stomach ulcers by drinking a beaker of them. He was sick within days. Later he got a Nobel Prize.",
        "In medieval Europe animals were put on trial. In 1386 a pig in France was dressed in human clothes and hanged for murder.",
        "Tsar Peter the Great liked pulling teeth, and practiced on the people of his own court. His collection is still in a museum.",
        "The philosopher Jeremy Bentham had himself stuffed. He's still sitting in a glass case at a London university. The head is wax: the real one went wrong.",
        "When Einstein died, the doctor doing the autopsy stole his brain and kept it in jars for forty years.",
        "Galileo's middle finger is on display in a museum in Florence, pointing up.",
        "A chapel in the Czech Republic is decorated with the bones of some 40,000 people, including a chandelier that uses every bone in the body.",
        "The oldest known surgery is cutting a hole in a living person's skull. Stone Age patients often survived: the bone shows healing.",
        "Medical schools used to buy dead bodies, no questions asked. In Edinburgh two men, Burke and Hare, skipped the digging and murdered sixteen people to sell.",
        "Some old books are bound in human skin. In 2014 Harvard confirmed that its library owned one.",
        "Under the right conditions a buried body's fat turns into a waxy soap. A museum in Philadelphia has a whole woman like this.",
        "A French delicacy: a tiny songbird, drowned in brandy, roasted, and eaten whole, bones and all, with a napkin over your head.",
        "In 1518, in the city of Strasbourg, hundreds of people began dancing in the street and couldn't stop. It went on for weeks.",
        "After some brain injuries a person's hand starts acting on its own: unbuttoning shirts, grabbing things, sometimes fighting the other hand.",
        "Cockroaches crawl into sleeping people's ears often enough that emergency rooms have a routine for getting them out.",
        "Victorians posed for family photos with relatives who had just died, dressed and propped up as if alive. Often it was the only photo of them the family had.",
    ]

    /// The ones they'll repeat at dinner.
    private static let gold: [String] = [
        "There are tumors that grow teeth, hair, and sometimes bits of brain or a whole eye.",
        "Very rarely, a person is born with their own twin inside them, and carries it for years before anyone finds out.",
        "In one rare disease, muscles slowly turn to bone until the person is locked inside a second skeleton.",
        "A rare skin condition makes warts grow into thick gray horns, until the hands and feet look like bark and branches.",
        "There's an inherited disease where, one day in middle age, you lose the ability to sleep. For good. It kills within a year or two.",
        "A people in Papua New Guinea honored their dead by eating them, and caught a brain disease from it. Victims shook, and burst out laughing, and died.",
        "If the intestines get completely blocked, everything backs up. People can vomit their own poop.",
        "An amoeba that lives in warm lakes can go up your nose and eat your brain. Almost nobody survives it.",
        "A guinea worm grows up to three feet long inside your leg, then comes out through a burning blister. It has to be wound out on a stick, a little each day, for weeks.",
        "Screwworm flies lay their eggs in open cuts. Unlike other maggots, theirs eat living flesh, twisting deeper in.",
        "If you die alone at home, your pets will eat you. Dogs usually start with the face. It can take less than a day.",
        "France last used the guillotine in 1977. Star Wars had already come out.",
        "In 1905 a doctor called a guillotined man's name seconds after the blade fell. He reported that the eyes opened and looked straight at him. Twice.",
        "In 897 a pope had the rotting body of an earlier pope dug up, dressed in robes, propped on a throne and put on trial. The corpse lost.",
        "King Charles II of England took a medicine made of powdered human skull dissolved in alcohol. He paid a fortune for the recipe.",
        "Executioners in Europe used to sell the fat of the people they'd executed. Pharmacies stocked it as a rub for aches.",
        "When the whaleship Essex sank in 1820, the starving survivors in the lifeboats drew lots to decide who would be shot and eaten. The captain's cousin lost.",
        "In 1972 a plane crashed high in the Andes. The survivors lasted 72 days by eating the bodies of their dead friends.",
        "Tarrare, a French soldier in the 1790s, could not stop being hungry. His doctors recorded him swallowing live cats, snakes and an eel, whole.",
        "To prove yellow fever wasn't catching, a student named Stubbins Ffirth drank fresh black vomit from dying patients. He never got it. Nobody knew yet that mosquitoes spread it.",
        "In 1961 the only doctor at a Soviet base in Antarctica got appendicitis. He cut himself open and took out his own appendix, using a mirror.",
        "In 1929 a young doctor pushed a tube into a vein in his own arm, fed it two feet in until it reached his heart, then walked downstairs to X-ray it.",
        "In the 1940s and 50s a doctor drove around America treating mental illness by hammering an ice pick through the eye socket into the brain. The inventor of the operation won a Nobel Prize.",
        "Victorian parents quieted teething babies with \"soothing syrup.\" The secret ingredient was morphine. Some babies didn't wake up.",
        "Before vaccines, Chinese doctors protected children from smallpox by grinding up a patient's scabs and blowing the powder up the child's nose.",
        "When Mount Vesuvius erupted, the heat was so fierce that one victim's brain turned to black glass.",
        "Under Chernobyl there's a lump of melted reactor called the Elephant's Foot. When it formed, five minutes beside it was a death sentence.",
        "A male deep-sea anglerfish bites onto a female and never lets go. His body melts into hers until all that's left of him is a lump on her side.",
        "Some wasps lay their eggs inside a living caterpillar. The grubs eat it from the inside, saving the vital organs for last so it stays fresh.",
        "The pearlfish lives inside a sea cucumber's butt. It swims in tail-first when the sea cucumber breathes. Some kinds eat its organs while they're in there.",
        "The surgeon Robert Liston could cut off a leg in under three minutes. The story goes that he once went so fast he took off his assistant's fingers too, and that the patient, the assistant and a man watching all died.",
        "In 2013 scientists made cheese using bacteria swabbed from people's armpits, toes and belly buttons. Each one smelled like its donor.",
        "A few minutes after you die, your own gut bacteria start eating you from the inside. The gas they make can swell a body to twice its size.",
        "A body sealed in an airtight casket can build up so much gas that the casket bursts. Cemetery workers call it exploding casket syndrome.",
        "If you swallow the eggs of a pork tapeworm, the young worms can settle in your brain. It's one of the world's leading causes of seizures.",
        "In 1976 a TV crew moved a dummy in a California funhouse and its arm broke off. There was bone inside. It was a real outlaw, dead since 1911.",
        "In 1954 a Soviet scientist sewed the head and front legs of a puppy onto a grown dog. Both heads drank.",
        "Surgeons can give some blind people their sight back by pulling one of their teeth, fitting a lens into it, and sewing the tooth into the eye.",
        "After some brain operations, the piece of skull that was cut out is stored inside the patient's own belly, to keep it alive until it can go back.",
        "Surgeons once saved a man's severed hand by sewing it to his ankle for a month, until his arm was ready to have it back.",
    ]

    private static func list(_ tier: VocabChest) -> [String] {
        switch tier {
        case .wood: wood
        case .silver: silver
        case .gold: gold
        }
    }

    /// A tier's facts are numbered from here.
    private static func base(_ tier: VocabChest) -> Int {
        switch tier {
        case .wood: 0
        case .silver: 1000
        case .gold: 2000
        }
    }

    static func facts(_ tier: VocabChest) -> [VocabFact] {
        list(tier).enumerated().compactMap { index, text in
            text.isEmpty ? nil : VocabFact(id: base(tier) + index, tier: tier, text: text)
        }
    }

    static let all: [VocabFact] = VocabChest.allCases.flatMap(facts)
    private static let byID = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

    static func fact(_ id: Int) -> VocabFact? { byID[id] }

    /// The facts found with these chests: out of one that's been opened, and
    /// still a fact (one dropped since isn't counted anywhere).
    static func found(in prizes: [VocabPrize]) -> Set<Int> {
        Set(prizes.filter(\.isOpen).map(\.fact).filter { byID[$0] != nil })
    }

    /// What's in a chest: a fact of its own tier that they haven't had; when
    /// that tier's run out, one from the next tier down, then from the ones
    /// above; and when they've had every fact there is, an old one of its own.
    static func draw<R: RandomNumberGenerator>(_ chest: VocabChest, have: Set<Int>, using random: inout R) -> VocabFact? {
        let below = VocabChest.allCases.filter { $0 < chest }.reversed()
        let above = VocabChest.allCases.filter { $0 > chest }
        for tier in [chest] + below + above {
            if let fact = facts(tier).filter({ !have.contains($0.id) }).randomElement(using: &random) { return fact }
        }
        return facts(chest).randomElement(using: &random) ?? all.randomElement(using: &random)
    }
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

/// The chest on the end screen of an ordinary session: shut and rattling
/// until it's tapped, then open, with the fact that was in it.
struct VocabChestCard: View {
    let prize: VocabPrize
    /// How many facts they've found, this one included.
    let found: Int
    /// It's been opened: what was in it is theirs to keep.
    var opening: () -> Void = {}
    @State private var open = false
    @State private var rattle = 0
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let chest = prize.chest
        Group {
            if open {
                opened(chest)
            } else {
                Button {
                    opening()
                    withAnimation(.spring(duration: 0.5, bounce: 0.45)) { open = true }
                } label: { shut(chest) }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens it")
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vocabGlass(tint: chest.tint.opacity(0.16))
        .overlay { if open { VocabBurst(big: chest == .gold) } }
        .sensoryFeedback(.impact(weight: .heavy), trigger: open)
        .task {
            // It won't sit still until it's opened.
            guard !still else { return }
            try? await Task.sleep(for: .seconds(0.9))
            while !open, !Task.isCancelled {
                withAnimation(.linear(duration: 0.4)) { rattle += 1 }
                try? await Task.sleep(for: .seconds(1.8))
            }
        }
    }

    private func shut(_ chest: VocabChest) -> some View {
        HStack(spacing: 18) {
            VocabChestIcon(chest: chest, size: 76)
                .modifier(VocabShake(travel: 4, animatableData: CGFloat(rattle)))
            VStack(alignment: .leading, spacing: 3) {
                Text("You earned a").font(.subheadline).foregroundStyle(.secondary)
                Text(chest.name).font(.title2.weight(.bold)).foregroundStyle(chest.text)
                Text("Tap to open").font(.subheadline.weight(.semibold))
            }
            Spacer(minLength: 0)
        }
        .contentShape(.rect)
    }

    private func opened(_ chest: VocabChest) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                VocabChestIcon(chest: chest, open: true, size: 44)
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(chest.short) chest").font(.subheadline.weight(.semibold)).foregroundStyle(chest.text)
                    Text("Gross fact \(found) of \(VocabFacts.all.count)").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let fact = VocabFacts.fact(prize.fact) {
                Text(fact.text)
                    .font(.title3.weight(.medium))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.scale(scale: 0.7, anchor: .topLeading).combined(with: .opacity))
            }
            if chest != .gold {
                Text("The worst ones are in the gold chests: 9 in 10 right. New words you don't know yet don't count against you.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - What they've found

/// Every fact they've had out of a chest, the gold ones first, and how many
/// are still shut away.
struct VocabFactsView: View {
    @Environment(ChatStore.self) private var store
    @State private var prizes: [VocabPrize] = []
    /// The chests that were still shut when the screen came up. They stay
    /// where they are once opened, with what was in them, until it's left.
    @State private var shut: [VocabPrize] = []

    var body: some View {
        let found = VocabFacts.found(in: prizes)
        // What's in a chest on this screen is on its card, not in the list as well.
        let have = found.subtracting(shut.map(\.fact))
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(found.count)")
                            .font(.system(size: 40, weight: .bold, design: .rounded))
                            .monospacedDigit()
                        Text("of \(VocabFacts.all.count) gross facts found").font(.subheadline).foregroundStyle(.secondary)
                    }
                    Text("Every session ends with a chest. 9 in 10 right is gold, 3 in 4 is silver, and new words you don't know yet don't count against you.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .vocabGlass()

                // A chest they walked away from: still theirs to open.
                ForEach(shut, id: \.session) { prize in
                    VocabChestCard(prize: prize, found: found.count) {
                        store.vocabLocal?.open(prize)
                        prizes = store.vocabLocal?.prizes ?? []
                    }
                }

                ForEach(VocabChest.allCases.reversed(), id: \.self) { tier in
                    section(tier, have)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .vocabColumn()
        }
        .scrollContentBackground(.hidden)
        .background { VocabBackdrop(mood: .calm) }
        .navigationTitle("Gross facts")
        .inlineTitle()
        .kidUsing(store.actingKid)
        .onAppear {
            prizes = store.vocabLocal?.prizes ?? []
            shut = prizes.filter { !$0.isOpen && VocabFacts.fact($0.fact) != nil }
        }
    }

    private func section(_ tier: VocabChest, _ have: Set<Int>) -> some View {
        let all = VocabFacts.facts(tier)
        // The newest first.
        let order = Dictionary(prizes.enumerated().map { ($0.element.fact, $0.offset) }, uniquingKeysWith: { _, later in later })
        let found = all.filter { have.contains($0.id) }.sorted { (order[$0.id] ?? 0) > (order[$1.id] ?? 0) }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                VocabChestIcon(chest: tier, open: !found.isEmpty, size: 30)
                Text(tier.short).font(.headline).foregroundStyle(tier.text)
                Spacer()
                Text("\(found.count) of \(all.count)").font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
            }
            .padding(.bottom, 6)
            ForEach(Array(found.enumerated()), id: \.element.id) { index, fact in
                if index > 0 { Divider() }
                Text(fact.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 10)
            }
            if found.count < all.count {
                if !found.isEmpty { Divider() }
                Label("\(all.count - found.count) still locked away", systemImage: "lock.fill")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.top, 10)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vocabGlass(tint: tier.tint.opacity(0.10))
    }
}
