import Foundation

// What the teacher says: as a run starts, as they close in, when they've got
// hold of you, when you get away, when you don't, and at the door of each
// place. Andrew asked for the Vocab bosses' register here too: deadpan,
// slightly wrong, never cute. Each teacher in the shop has a few lines of
// their own; the rest are anyone's.

enum MathTeacherLines {
    enum Moment { case start, close, caught, right, wrong, timeout }

    private static let anyone: [Moment: [String]] = [
        .start: [
            "No running in the halls. I will be running.",
            "You have left your seat. Your seat is upset.",
            "I have been grading since before the building.",
            "Class is not dismissed. Class is never dismissed.",
            "I only want to show you your work.",
            "You forgot something. I am bringing it to you.",
            "The bell has not rung. I would know. I am the bell.",
            "Walk. Walk. I am asking nicely. Walk.",
        ],
        .close: [
            "I can see the back of your head. I have a drawing of it.",
            "You are slowing down. Everyone does.",
            "Your shoelace. No. The other one.",
            "I am not out of breath. I do not use it.",
            "Nearly. I have said nearly before.",
            "There you are. There you have always been.",
        ],
        .caught: [
            "Hold still. This one is yours.",
            "Sit. There is no chair. Sit anyway.",
            "I wrote this for you before you were enrolled.",
            "Show your work. I will know if you don't.",
            "One question. There is always one question.",
            "You dropped this. It is a problem.",
            "Take your time. I have taken it already.",
        ],
        .right: [
            "Correct. I will need to make them heavier.",
            "Yes. Go on, then. I will catch up. I do.",
            "That was the answer. I am not pleased. I am never pleased.",
            "Correct. Do not tell the others.",
            "You may go. For now you may go.",
            "Right. I had the wrong mark ready.",
        ],
        .wrong: [
            "No. Come back to class. It is the same class.",
            "Incorrect. Your seat has been kept warm.",
            "That was not it. Look. This is how it goes.",
            "Wrong. We will go over it. We will go over it.",
            "No. I will walk you back. It is not far. It is never far.",
        ],
        .timeout: [
            "Time. The clock was mine all along.",
            "Pencils down. Yours is already down.",
            "You ran out. Of time. Not of here.",
        ],
    ]

    private static let own: [String: [Moment: [String]]] = [
        "teacher-sub": [
            .start: ["Your teacher is out. Your teacher was never in.", "I'm only here for today. I said that yesterday."],
            .caught: ["I found this in her desk. It has your name on it."],
            .wrong: ["I'll leave a note for your teacher. I am the note."],
        ],
        "teacher-coach": [
            .start: ["Laps. All of them.", "Hustle. I'm right behind you. I'm always right behind you."],
            .close: ["I can do this all day. I have done this all day."],
            .right: ["Good. Again. Faster. Forever."],
        ],
        "teacher-lunch": [
            .start: ["You didn't finish. Nobody leaves until it's finished.", "There's seconds. There's always seconds."],
            .caught: ["Open up. It's only numbers."],
            .wrong: ["Back in line, love. It's a long line."],
        ],
        "teacher-monitor": [
            .start: ["Hall pass. Show me your hall pass. That's not a hall pass.", "I'm writing you up. I've already written you up."],
            .close: ["I've got a whistle. I won't need it."],
        ],
        "teacher-principal": [
            .start: ["My door is always open. It is the only door.", "We'll discuss this in my office. We are in my office."],
            .caught: ["This will go on your record. This is your record."],
            .wrong: ["I've telephoned your parents. They said to keep you."],
        ],
        "teacher-you": [
            .start: ["Give it back.", "You go first. I'll go where you go."],
            .caught: ["You know this one. I know you know."],
            .right: ["I'd have got that too."],
            .wrong: ["I'd have got that."],
        ],
    ]

    /// At the door of each place, by the zone's key.
    static let doors: [String: [String]] = [
        "courtyard": ["Outside. It is still school outside.", "Fresh air. I had it brought in."],
        "cafeteria": ["Lunch is whatever is left.", "Do not eat the meat. Do not ask the meat."],
        "gym": ["Shoes squeak when they are afraid.", "The scoreboard has been watching you."],
        "library": ["Quiet. The books are listening.", "Every one of these is overdue. So are you."],
        "hallway-again": ["You have been here. It remembers.", "Same hallway. I told them not to change it."],
        "cafeteria-night": ["They are still eating. Do not turn them around.", "Lunch ended years ago. Sit down."],
        "gym-red": ["There were doors. I had them taken out.", "They came to watch you. They do not clap."],
        "pool": ["Mind the water. It is up there now.", "No running by the pool. No pool by the running."],
        "office": ["Take a number. It will not be called.", "The form you need is behind the other form."],
        "detention": ["Every seat is yours. Pick one.", "Look. You saved yourself a place."],
    ]

    static func line(_ moment: Moment, teacher id: String?) -> String {
        if let id, let mine = own[id]?[moment], Bool.random() || moment == .start && Int.random(in: 0..<3) == 0 {
            return mine.randomElement() ?? ""
        }
        return anyone[moment]?.randomElement() ?? ""
    }

    static func door(_ zone: String) -> String? { doors[zone]?.randomElement() }
}
