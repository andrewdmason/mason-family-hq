import SwiftUI

// Each stage's boss is somebody: whoever lives at that place on the mountain
// and doesn't want them getting past. They have a face (an emoji, drawn
// large), a name, and a way of talking that's theirs alone: all of them a
// little wrong, in the way of a dream or an office with no door out. They
// have something to say before every ordinary session in their stage
// (VocabHeckleView), in order, so who they are builds toward their round;
// something for when the stage is cleared and they're waiting; what they say
// as the round opens (VocabBossIntro), and what they say when they've lost it.
//
// The mountain has one story running up it: everyone on it answers to the
// Summit, where the Examiner keeps a file on the climber. The raccoon starts
// the file, the eagle and the squid add to it, the scorpion rides along in a
// shoe, and each boss knows a little more of it than the one below.

struct VocabBossCharacter: Hashable {
    /// What they're called for short: "Rocky".
    let name: String
    /// What goes after it: "the Trash Bandit".
    let title: String
    let face: String
    /// What they say as their round opens.
    let taunt: String
    /// What they say when they've lost it.
    let sore: String
    /// Their colour: the glow behind them.
    let glow: Color
    /// What they say before the ordinary sessions of their stage, first to last.
    let heckles: [String]
    /// What they say before a session while their round is waiting to be played.
    let waiting: [String]

    var fullName: String { "\(name) \(title)" }

    /// What they say before a session of their stage. `n` is how many times
    /// they've spoken before one: the first line is their hello, and the ones
    /// between it and the last come in order after that, and round again. The
    /// last is kept for `parting`, when the stage is nearly cleared and their
    /// round is close.
    func heckle(_ n: Int, waiting: Bool, parting: Bool = false) -> String {
        let lines = waiting ? self.waiting : heckles
        guard !lines.isEmpty else { return taunt }
        if waiting || lines.count < 3 { return lines[max(0, n) % lines.count] }
        if parting { return lines[lines.count - 1] }
        if n <= 0 { return lines[0] }
        return lines[1 + (n - 1) % (lines.count - 2)]
    }

    private static func make(_ name: String, _ title: String, _ face: String, _ glow: Color, taunt: String, sore: String,
                             heckles: [String] = [], waiting: [String] = []) -> Self {
        .init(name: name, title: title, face: face, taunt: taunt, sore: sore, glow: glow, heckles: heckles, waiting: waiting)
    }

    private static let purple = Color(red: 0.47, green: 0.31, blue: 0.86)
    private static let forest = Color(red: 0.16, green: 0.55, blue: 0.33)
    private static let ember = Color(red: 0.93, green: 0.36, blue: 0.14)
    private static let ice = Color(red: 0.25, green: 0.62, blue: 0.93)
    private static let gold = Color(red: 0.92, green: 0.66, blue: 0.10)

    /// In the order of the stages (VocabStage's places).
    static let cast: [VocabBossCharacter] = [
        // Has been through their bins, and knows them by what they threw away. Starts the file.
        make("Rocky", "the Trash Bandit", "🦝", purple,
             taunt: "Nobody passes the trailhead until I've gone through them. Hold still. Define yourself.",
             sore: "Fine. Go up. I'll keep going through your things. Somebody has to.",
             heckles: [
                 "Oh. It's you. I know you from your trash. You're shorter than your trash.",
                 "I washed my hands forty times today. They are still my hands.",
                 "I found a drawing in your bin. You were right to throw it out. I've framed it.",
                 "Someone up top sends me a list of who's coming. Your name was on it before you were born.",
                 "I'm only the first one in your way. The next one is asleep. Do not ask me what the last one is.",
                 "Almost done here. I've left something in your shoe. Don't check now.",
             ],
             waiting: [
                 "I'm by the bins. I've set out two chairs. One is for you. The other one is also for you.",
                 "Take your time. I have your trash to keep me company.",
             ]),
        // Asleep. They're something he's dreaming, and he'd rather not wake up.
        make("Mossback", "the Grumpy Bear", "🐻", forest,
             taunt: "You woke me. Or I dreamed that you did. Either way, one of us has to stop. Words. Now.",
             sore: "Oh. I'm awake. It's so much smaller out here. Go on up. Don't tell me how it ends.",
             heckles: [
                 "I'm asleep. You are a thing I'm dreaming. Please be a quieter thing.",
                 "In the dream there's a child answering questions. It's very boring. I can't wake up.",
                 "Every pine in these woods is the same pine. I've checked. Don't check.",
                 "I ate a hiker once. In the dream. He's still talking. He says hi.",
                 "The raccoon sent your file ahead. It smells like a bin. I slept on it.",
                 "If you get all of these right, I think I wake up. I don't know what happens to you then.",
             ],
             waiting: [
                 "I'm in the cave, asleep, with my eyes open. Come in. Mind the other you.",
                 "Still dreaming you. You're doing something different in the dream. It's worse.",
             ]),
        // Collects a toll in things nobody should be able to pay with. Doesn't know who for.
        make("Snapjaw", "the Creek Lurker", "🐊", forest,
             taunt: "The toll is every word, or one leg. I don't make the rules. I have never met who does. Pay.",
             sore: "Paid in full. Here's your receipt. It's wet. It's blank. Keep it your whole life.",
             heckles: [
                 "Toll for the creek today: one word, and the name of your second-best friend. I'll write a receipt.",
                 "Yesterday someone paid with a tooth. It wasn't theirs. I gave change.",
                 "I don't keep the tolls. They go upstream. I've never asked what upstream does with teeth.",
                 "Today's toll is a Tuesday. Any Tuesday. You won't miss it. You won't remember having had it.",
                 "The water here only moves when someone's looking. Go on. Look away. See?",
                 "Your account is nearly settled. One item outstanding. It says here: \"a leg, or equivalent.\"",
             ],
             waiting: [
                 "I'm in the creek. Just the eyes. The rest of me is filling in forms.",
                 "The toll went up while you were gone. It always goes up. Nobody decides it.",
             ]),
        // A hostess whose dinner is always about to begin. The other guests are her old skins.
        make("Lady Hiss", "Queen of the Ferns", "🐍", forest,
             taunt: "At last. We can begin. The first course is words. The second course, darling, depends on the first.",
             sore: "Leaving? Before the soup? Take a skin for the road, darling. It gets cold up there.",
             heckles: [
                 "You're early, darling. Dinner hasn't started. Dinner has never started. Do sit.",
                 "Those are my other guests. Don't mind them. They're only my old skins, and they are shy.",
                 "I set your place years ago. Same fork. I polish it. I say your name to it.",
                 "I swallowed the last visitor whole. We still talk. He says the ferns look lovely from in here.",
                 "A letter came down from the Summit. It asks what you're like. I wrote: \"warm.\"",
                 "Almost time, darling. The soup is cold. The soup was always cold. That's how you know it's mine.",
             ],
             waiting: [
                 "The table's laid. Everyone is seated. Nobody is breathing. We're only waiting on you.",
                 "Do come. One of my skins has saved you a seat. It's the one that looks a little like you.",
             ]),
        // Counts the rocks. One is missing, and he keeps looking at them.
        make("Rumble", "the Rock Troll", "🧌", ember,
             taunt: "Words are small rocks. Rumble count yours. If one missing, Rumble keep you here and paint number on you.",
             sore: "All there. Every one. Rumble turn you over anyway. No number. Rumble not understand you. Go.",
             heckles: [
                 "Rumble count rocks. Four thousand and eleven. Yesterday, four thousand and twelve. Rumble look at you.",
                 "Every rock have number. Rumble paint it on the bottom. Nobody ever turn rock over. Only Rumble know.",
                 "One rock is not rock. It is warm. Rumble not say which.",
                 "Rumble count you too. You are one. Rumble check again. Still one. Good.",
                 "Man from top come once with clipboard. Count Rumble. Write down \"one.\" Rumble not sleep since.",
                 "Rumble find missing rock. It was in Rumble's mouth whole time. Rumble sorry for looking at you.",
             ],
             waiting: [
                 "Rumble sit on rock four hundred. Rumble wait. Rumble very good at wait. Rumble was rock once.",
                 "You come back. Rumble count the days you gone. It was all of them.",
             ]),
        // In his canyon the echo comes first. He's already heard how this goes.
        make("Echo", "the Copycat Bat", "🦇", purple,
             taunt: "I repeat every word you miss. I've started already. Listen. That's you. That's in a minute.",
             sore: "\"You win.\" I said that before you got here. I've been sad about it since. Go on. You already have.",
             heckles: [
                 "\"Hello?\" That's what you're about to say. Don't. It's been said. By you. Later.",
                 "In this canyon the echo comes first. Then the sound. Then, a long time after, the mouth.",
                 "I hang upside down so the words fall out of people. I keep the ones that land.",
                 "Yesterday I heard you get a question wrong. It hasn't happened yet. It's this one. No. The next.",
                 "The eagle up the ridge writes down what you do. I only repeat it. Before.",
                 "You're going to beat me. I heard it this morning. I'm still going to try. I heard that too.",
             ],
             waiting: [
                 "I'm in the canyon. Shout something. No, I'll shout it. You just open your mouth.",
                 "\"I'm ready.\" There. I said it for you. Now you have to be.",
             ]),
        // Watches, and writes it all down, and sends it up in a tube.
        make("Talon", "the Sky Bully", "🦅", gold,
             taunt: "I've seen every answer you ever gave, from above. From up here they all look like the tops of heads. Begin.",
             sore: "Final report: subject passed. Observer was looked at. Is that what it's like? Go. Don't look back. I'll know.",
             heckles: [
                 "At 7:42 you scratched your left ear. I wrote it down. I write everything down. Nobody reads it.",
                 "I can see your house from here. The light's on in a room you don't have.",
                 "Report nine thousand and six: subject is looking at a screen. Subject is reading this. Subject has stopped smiling.",
                 "I don't blink. I did once. When I opened my eyes there was one more of you.",
                 "The reports go up to the Summit in a tube. Once, one came back. It just said: \"Closer.\"",
                 "I've watched you the whole way up. I'd know you anywhere. I'm not sure it's you who started out.",
             ],
             waiting: [
                 "I'm on the ridge, facing away. I can still see you. That's not how eyes work. And yet.",
                 "You were gone a while. I filed the gap under \"Unobserved.\" I hate that drawer.",
             ]),
        // Ten thousand bees in a coat, holding the shape of a baron. Votes on everything.
        make("Baron Buzz", "Lord of the Meadow", "🐝", gold,
             taunt: "The motion before the hive: that you do not pass. All in favor? The ayes have it. The ayes always have it.",
             sore: "The Baron concedes. The Baron is coming apart a little. Don't watch. Go. We'll vote on what happened.",
             heckles: [
                 "We are Baron Buzz. We are ten thousand bees in a coat. Do not look at the hands.",
                 "We voted on whether to speak to you. It was close. Several of us are still against.",
                 "One of us left the Baron today. We don't say her name. The left knee has not been the same.",
                 "This meadow is ours. The flowers are ours. The humming you hear at night, at home: also ours.",
                 "The Summit asked for our opinion of you. We sent a jar. They'll know what it means.",
                 "We have voted again. We have decided to be afraid of you. It was unanimous, and then one of us died.",
             ],
             waiting: [
                 "We are in the meadow, holding the shape. It's tiring, being a Baron. Come before we're a cloud.",
                 "We remember you. Not all of us. The ones who did have been replaced. We were told.",
             ]),
        // A ghost who thinks they're the one doing the haunting.
        make("Drizzle", "the Soggy Ghost", "👻", ice,
             taunt: "Boo. Was that all right? I have to stop you. It's on the form. I don't know who filled in the form. It's my handwriting.",
             sore: "You went right through me. It tickled. I think that's the last thing I get to feel. Go on up. Wave if you can.",
             heckles: [
                 "Oh! Sorry. Are you the ghost? Someone keeps answering questions in my house and it isn't me.",
                 "I've been damp for forty years. Nobody will tell me why. Do you know why? Don't tell me.",
                 "There's a towel here with my name on it. It's dry. It's always dry. I can't pick it up.",
                 "I keep trying to scare you and you keep being there. That's my job. Being there. You're better at it.",
                 "A man from the Summit came to check my papers. He walked straight through me and said \"Hm.\"",
                 "If you see my mom, tell her I'm at the falls. She'll say she hasn't got a son. Tell her anyway.",
             ],
             waiting: [
                 "I'm behind the waterfall, practicing \"boo.\" It keeps coming out as \"please.\"",
                 "You came back! Nobody comes back. Well. I did. That's sort of the problem.",
             ]),
        // A knight under an oath he can't remember taking, on stairs that have one step too many.
        make("Sir Headbutt", "the Mountain Goat", "🐐", ember,
             taunt: "Halt. By my oath, none shall climb these... are there more steps than there were? Never mind. Have at thee. Words.",
             sore: "I yield. The oath is broken. It made a small sound. There's one step fewer now. I think it was me.",
             heckles: [
                 "There are nine hundred steps. I counted them this morning. There were nine hundred and one.",
                 "I swore an oath to guard these stairs. I don't remember to whom. He had a hat. It may have been my hat.",
                 "My eyes go sideways. I can see both ends of you at once. One end is lying.",
                 "Every climber I've rammed off is still falling. Put your ear to the step and you can hear them. Don't.",
                 "The stairs go up to the Summit. I've never been. I climbed for a year once and arrived here.",
                 "You're on the last step. So am I. It's the same step as the first one. I checked the number underneath.",
             ],
             waiting: [
                 "I'm on the steps, standing very still, on a ledge the width of a thought. Come up. Mind the extra one.",
                 "The oath says I must wait for you. The oath has your name in it. I didn't put it there.",
             ]),
        // Carries what people said. Can't stop talking: if he stops, he's only weather.
        make("Gusty", "the Windbag", "🌪️", ice,
             taunt: "I'll blow every word out of your head and carry them off and say them to strangers in your voice. Ready? No. Go.",
             sore: "I've stopped. Oh. It's quiet. So I'm still here when it's quiet. Nobody told me. Go on. Shh.",
             heckles: [
                 "Can't stop, can't stop talking, if I stop I'm not here, I'm just weather, hello, hello, hello...",
                 "I carry things people said. Got one of yours. \"I'll do it later.\" You said it in a kitchen. It's heavy.",
                 "Somebody two valleys over is talking about you right now. I'd tell you what they said, but I've got it inside out.",
                 "I blew through your room last night. Turned one page of one book. You'll never know which. It matters.",
                 "The Summit doesn't have wind. I went up once and I just wasn't. For a week. Nobody noticed.",
                 "Nearly through the pass and I'm out of things to say, so I'll say one of yours: \"I'm not scared.\" Ha. Good one.",
             ],
             waiting: [
                 "I'm in the pass, going round and round. It's not a tantrum. It's a filing system.",
                 "You're back, you're back, I kept a seat for you, it blew away, it had your shape.",
             ]),
        // Frozen in a queue of one, waiting for an appointment nobody is coming to keep.
        make("Chillbert", "the Frozen Grump", "🥶", ice,
             taunt: "You can't go up b-before me. I've waited ten winters. Take a number. There aren't any numbers. That's the test.",
             sore: "G-go on, then. I'll wait. I think the waiting was the appointment. I think I've b-been in it this whole time.",
             heckles: [
                 "I've b-been waiting for my appointment since the snow started. I'm number four. They're on number three.",
                 "Number three went in years ago. Sometimes the d-door opens and it's just his coat.",
                 "I froze in the middle of a sentence once. I've been f-finishing it ever since. The word is \"help.\" No. \"Hello.\"",
                 "They gave me a form to f-fill in while I wait. Every question is \"Are you still waiting?\" I've ticked yes.",
                 "You haven't g-got a number. You don't need one. The Summit said to send you straight up. Who ARE you?",
                 "The screen just changed. It says \"Now s-serving: you.\" It's never said that. Not for anyone.",
             ],
             waiting: [
                 "I'm at the snow line, in the queue. I am the queue. It's j-just me. Please don't push in.",
                 "You l-left and came back and I'm still number four. I'm not angry. I'm f-frozen. It looks the same.",
             ]),
        // Extinct, and appealing against it. Remembers things that haven't happened yet.
        make("Tusk", "the Woolly Wall", "🦣", ice,
             taunt: "Nobody crosses. Not because I say so. Because I remember that nobody did. Prove my memory wrong, little warm thing.",
             sore: "So that's how it goes. I'd remembered it differently. Cross. Step where the ice is dark. That's the other me, holding it up.",
             heckles: [
                 "I'm extinct. They sent a letter. I've appealed. Until I hear back, I am standing on this bridge.",
                 "I remember you. Old, grey, in a chair, telling someone about a mammoth. You haven't done it yet.",
                 "Ten thousand years is not long. It's one afternoon that nobody came to collect me from.",
                 "There's another me in the ice under the bridge. He's looking up. We've agreed not to discuss it.",
                 "My appeal came back, stamped by the Examiner. It says \"Noted.\" Under that, in pencil: \"The child is next.\"",
                 "I won't forget you when you cross. I'll remember you so hard you'll feel it, years from now, in an elevator.",
             ],
             waiting: [
                 "I'm on the bridge. I take up all of it. That's not stubbornness. That's just where the rest of me ended up.",
                 "You came back. I remembered you would. I remembered it wrong. You were taller.",
             ]),
        // A cloud that's a dragon only while someone's looking, and isn't sure of its edges.
        make("Nimbus", "the Cloud Dragon", "🐉", purple,
             taunt: "I eat vocabulary lists. I eat climbers. I eat... hold on, am I still a dragon? Tell me after. Words first.",
             sore: "You looked right at me and didn't blink. Now I'm stuck like this. A dragon. For good. Thank you. Go through me. It's damp.",
             heckles: [
                 "Am I a dragon? Look carefully. Take your time. Too late. I was a rabbit for a second. Did you see?",
                 "I'm only a dragon while somebody's looking. When you close this I'm weather with opinions.",
                 "I rained on your town once. One drop went in your mouth. That was me. We've met.",
                 "Sometimes I'm the shape of a face. People wave. It's never the face they think. Once it was yours.",
                 "The Summit is just above me. I've never seen it. I'm in the way. I think I'm what it uses for a door.",
                 "You've nearly decided what I am. I can feel my edges going hard. It hurts. Keep going.",
             ],
             waiting: [
                 "I'm on the shelf, being a dragon as hard as I can. If I look like a duck when you arrive, say nothing.",
                 "You came back and I'm a different shape. Don't apologize. So are you.",
             ]),
        // Only has the one voice. Uses it for the smallest, gentlest things.
        make("Boomer", "the Thunder Ogre", "👹", ember,
             taunt: "DEFINE \"INTIMIDATE.\" NO. DEFINE \"GENTLE.\" I NEED TO KNOW. NOBODY WILL TELL ME. I KEEP BREAKING THEM.",
             sore: "you won. oh. so that's what quiet sounds like. it was in there the whole time. go on up. softly. he likes it soft.",
             heckles: [
                 "THIS IS MY INSIDE VOICE. I DON'T HAVE ANOTHER ONE. I HAVE TRIED. SIT CLOSER.",
                 "I KNOW A SECRET ABOUT YOU. I AM GOING TO WHISPER IT. EVERYONE ON THE MOUNTAIN WILL HEAR. SORRY.",
                 "WHEN IT IS QUIET I CAN HEAR SOMEONE BREATHING. IT IS ME. I DO NOT LIKE HOW HE BREATHES.",
                 "I SANG A LULLABY TO A BIRD ONCE. THE BIRD IS FINE. THE BIRD IS A DIFFERENT SHAPE NOW.",
                 "THE EXAMINER NEVER RAISES HIS VOICE. HE CAME DOWN ONCE AND SAID MY NAME QUIETLY. I HAVE BEEN SHOUTING EVER SINCE.",
                 "YOU ARE ALMOST PAST ME. I WANT TO SAY SOMETHING KIND. IT WILL KNOCK YOU OVER. BRACE.",
             ],
             waiting: [
                 "I AM IN THE NOTCH. I AM HUMMING. THE ROCKS HAVE ASKED ME TO STOP. THE ROCKS CAN TALK NOW. THAT IS NEW.",
                 "YOU CAME BACK. I MISSED YOU. I SAID SO AT THE TIME. YOU MAY HAVE HEARD. IT WAS THE THUNDER.",
             ]),
        // Writes their file, a different book with every arm, in a lake that's all ink.
        make("Inky", "the Lake Squid", "🦑", purple,
             taunt: "Ten arms, one of you. Nine are for holding. The tenth has a pen. However this goes, it goes in the book.",
             sore: "Arm seven had it right. Arm seven always does. I'm going down where it's dark to read what it wrote next. Go.",
             heckles: [
                 "Each of my arms is writing a different book about you. Arm three's is the kindest. Arm three is not well.",
                 "The lake is ink. All of it. I've been writing since before there was a lake. Do you see?",
                 "I have three hearts. One for the lake. One for the writing. The third I'm keeping for someone. Is it you?",
                 "Arm seven is writing what you do next. I'm not allowed to read arm seven. It's smiling. Arms can't smile.",
                 "Your file goes up to the Summit tonight. Two thousand pages. One page just says \"laughs at the wrong moment.\"",
                 "I've reached the last page. It's blank, except the bottom corner. In your handwriting: \"Turn over.\"",
             ],
             waiting: [
                 "I'm under the lake, at my desk. The desk is also me. Come down. Bring nothing that can be read.",
                 "You were away. I wrote it down as \"The Gap.\" It's my favorite chapter. Nothing happens. I cried.",
             ]),
        // Not lost: put here, a very long time ago. Wears being a person slightly wrong.
        make("Blip", "the Lost Alien", "👽", forest,
             taunt: "On my planet we know every word. We have to. The ones who don't are made into the next words. Show me yours.",
             sore: "You know them. Then you are safe. I will tell the ship. The ship is not coming. I will tell it anyway. Goodbye, friend. Was that right?",
             heckles: [
                 "Greetings. I am doing a smile. I was told four seconds. It has been nine minutes. Is it finished?",
                 "I am not lost. I was put here. The ship said \"wait by the tent.\" That was before tents.",
                 "I have studied your \"home.\" A box you go back to. I do not have the organ for going back.",
                 "I learned all your words in one night. They are still in my mouth. Several are moving.",
                 "My planet also has an Examiner. Same one. Same robe. I asked him how. He said \"Don't.\"",
                 "I have decided to be your friend. I do not know the procedure. I have swallowed a photograph of you. Is that it?",
             ],
             waiting: [
                 "I am at the camp, wearing a hat, as humans do. It is a tent. I am told there is a difference.",
                 "You returned. On my world that means something terrible. Here I think it is nice? I am doing the smile.",
             ]),
        // Has been in their shoe since the trailhead, sent along to watch for a wobble.
        make("Pinch", "the Cliff Scorpion", "🦂", ember,
             taunt: "This is the narrow part. One foot wide. I'm standing on it. I'm very small and I'm not moving. Words, please. Carefully.",
             sore: "You didn't wobble. I'll tell him. Can I... no. No, you go on. Check your shoe sometimes. Even when I'm not in it.",
             heckles: [
                 "Hello. Down here. In your shoe. I've been in your shoe since the trailhead. You walk very carefully. Thank you.",
                 "I know the inside of your shoe better than you know your room. There's a part you've never touched. I live there.",
                 "I never sting. I just rest the point against things. Very lightly. For years. Can you feel it? No. Good.",
                 "Under purple light I glow. Nobody knows why. I do. I'm not saying. It's the only thing I have.",
                 "The raccoon put me here. He said, \"Tell the Examiner if this one wobbles.\" You haven't. I've nothing to tell. It's lonely.",
                 "We're nearly at the top. I'll have to get out. I've never been outside you. Will you walk slowly, the last bit?",
             ],
             waiting: [
                 "I'm out of the shoe. I'm on the ridge. It's so wide out here. I don't like it. Come and stand near me.",
                 "You took your shoes off last night. I waited in the left one. It was dark and it smelled of you. It was fine.",
             ]),
        // Their own voice, the part that says that's enough for today. Only wants them comfortable.
        make("Captain Quit", "the Voice of Doubt", "😈", purple,
             taunt: "Last one before the top. Just me. No claws, no teeth. I'm only going to ask, nicely, in your own voice: aren't you tired?",
             sore: "Oh. You're not, are you. Then I'm not you. Then who have I been all this time? Go on. Take the blanket. No. Leave it.",
             heckles: [
                 "Hi. It's me. I'm you. The part that says \"that's enough for today.\" I got here first. I always get here first.",
                 "There's a couch up here. It's the couch from your house. Still warm. I don't know how they got it up the mountain.",
                 "I'm not against you. I'm the only one on this mountain who wants you to be comfortable. Think about that.",
                 "They moved the Summit last night. Further. They do it every night. I'm only telling you because nobody else will.",
                 "I've read your file. All two thousand pages. Want to know how it ends? It doesn't say. It just stops. Around here.",
                 "You're still going. I keep saying stop, in your own voice, and you keep going. Whose voice are you listening to, then?",
             ],
             waiting: [
                 "I'm on the couch. There's room. There's a blanket. There's a show on. It's about you. It's almost over.",
                 "You came back. Of course you did. I told you not to and I knew you would. I'm you. It's exhausting.",
             ]),
        // Has the file, and has been expecting them since before the mountain. Never in a hurry.
        make("The Examiner", "Keeper of the Summit", "🧙", gold,
             taunt: "So. No raccoon, no bear, no bees. Just a desk, and me, and every word you met on the way up. Shall we close the file?",
             sore: "Correct. All of it. The file is closed. I'm keeping the drawing from your bin. Go on. The door's open. You're ready.",
             heckles: [
                 "Come in. Sit. I've been expecting you since the trailhead. Before the trailhead. Before the mountain.",
                 "This is your file. The raccoon began it. The squid wrote it. The eagle checked it. I've only added commas.",
                 "You think the exam is at the end. Everyone does. It began with the first word. This is only the room where we tell you.",
                 "They were all me, you know. Or I was all of them. The paperwork is unclear. I filled it in myself.",
                 "There's a door behind me. It was made for you alone. Nobody else could ever have gone through it. A few more words, and we'll see about the door.",
                 "One last page. I've left it empty. The squid was right about that. Turn over.",
             ],
             waiting: [
                 "I'm at the desk. The chair opposite is your size. It has always been your size. We adjusted it as you grew.",
                 "Take your time. I have never once been in a hurry. The mountain is how long I'm willing to wait.",
             ]),
    ]

    static func of(stage: Int) -> VocabBossCharacter {
        cast.indices.contains(stage - 1) ? cast[stage - 1]
            : make("The Guardian", "of Stage \(stage)", "👾", purple, taunt: "None shall pass without their words.", sore: "Pass, then.",
                   heckles: ["I wasn't on the list. Neither were you. And yet here we both are."])
    }
}

/// What a stage's boss has to say before an ordinary session.
struct VocabHeckle: Codable, Hashable {
    let stage: Int
    let line: String

    var character: VocabBossCharacter { .of(stage: stage) }
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

/// Before the first question of an ordinary session: the boss of the stage
/// they're on, in the dark, closer than they'd like, with one thing to say.
/// It comes out a letter at a time, stopping at the full stops, and then
/// there's the way in. Nothing like their round's entrance: no drop, no rays,
/// just them, under a light that isn't working properly. The session's clock
/// doesn't start until they're let past. A tap anywhere finishes the line.
/// With Reduce Motion it's all just there.
struct VocabHeckleView: View {
    let heckle: VocabHeckle
    /// Lets the session begin.
    let begin: () -> Void
    let close: () -> Void

    /// How much of the line has been said.
    @State private var said = 0
    @State private var here = false
    @State private var started = Date()
    @Environment(\.accessibilityReduceMotion) private var still

    private var line: [Character] { Array(heckle.line) }
    private var done: Bool { said >= line.count }

    var body: some View {
        let who = heckle.character
        ZStack {
            backdrop(who)

            VStack(spacing: 0) {
                Spacer(minLength: 12)

                face(who)

                VStack(spacing: 3) {
                    Text(who.fullName.uppercased())
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .kerning(3)
                        .foregroundStyle(who.glow.mix(with: .white, by: 0.6))
                        .multilineTextAlignment(.center)
                    Text(VocabStage.name(heckle.stage))
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white.opacity(0.5))
                }
                .padding(.top, 18)
                .opacity(here ? 1 : 0)

                // All of it is laid out from the start, so nothing moves as it's said.
                Text("\(Text(String(line.prefix(said))))\(Text(String(line.dropFirst(said))).foregroundStyle(.clear))")
                    .font(.system(.title2, design: .serif).weight(.medium))
                    .lineSpacing(5)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.7)
                    .padding(.horizontal, 30)
                    .padding(.top, 24)
                    .accessibilityLabel(heckle.line)

                Spacer(minLength: 12)

                Button(action: begin) {
                    Text("Start").font(.title3.weight(.bold)).frame(maxWidth: .infinity).frame(height: 46)
                }
                .buttonStyle(.glassProminent)
                .tint(who.glow)
                .keyboardShortcut(.defaultAction)
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
                .opacity(done ? 1 : 0)
                .offset(y: done ? 0 : 24)
                .allowsHitTesting(done)
            }
            .vocabColumn()
        }
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
        // In a hurry: the rest of it at once.
        .onTapGesture { if !done { withAnimation(.snappy) { said = line.count } } }
        .animation(.spring(duration: 0.45, bounce: 0.3), value: done)
        .sensoryFeedback(.impact(weight: .light), trigger: done) { _, now in now }
        .task { await say() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(who.fullName) says")
    }

    /// The line, a letter at a time, with a breath after each sentence.
    private func say() async {
        guard !still else {
            here = true
            said = line.count
            return
        }
        withAnimation(.easeIn(duration: 1.1)) { here = true }
        try? await Task.sleep(for: .seconds(0.9))
        while said < line.count, !Task.isCancelled {
            let last = line[said]
            said += 1
            let stop = ".?!".contains(last) && said < line.count && line[said] == " "
            try? await Task.sleep(for: .seconds(stop ? 0.42 : last == "," ? 0.16 : 0.024))
        }
    }

    /// Them, coming up out of the dark and slowly closer; the light on them drops out now and then.
    private func face(_ who: VocabBossCharacter) -> some View {
        TimelineView(.animation(paused: still)) { timeline in
            let t = timeline.date.timeIntervalSince(started)
            // A tube on its way out: steady, then two or three quick dips.
            let dip = sin(t * 0.9) > 0.86 && sin(t * 41) > 0.2
            Text(who.face)
                .font(.system(size: 132))
                .shadow(color: who.glow.opacity(0.7), radius: 26)
                .scaleEffect(still ? 1 : 1 + min(0.16, t * 0.012) + 0.012 * sin(t * 0.8))
                .rotationEffect(.degrees(still ? 0 : 1.6 * sin(t * 0.5)))
                .opacity(still || !dip ? 1 : 0.35)
        }
        .frame(height: 170)
        .opacity(here ? 1 : 0)
        .accessibilityHidden(true)
    }

    /// Nearly black, with their colour low behind them and the edges closing in.
    private func backdrop(_ who: VocabBossCharacter) -> some View {
        ZStack {
            Color(red: 0.04, green: 0.03, blue: 0.06)
            RadialGradient(colors: [who.glow.opacity(here ? 0.34 : 0), .clear], center: UnitPoint(x: 0.5, y: 0.36),
                           startRadius: 10, endRadius: 360)
            RadialGradient(colors: [.clear, .black.opacity(0.75)], center: .center, startRadius: 180, endRadius: 560)
        }
        .ignoresSafeArea()
    }
}
