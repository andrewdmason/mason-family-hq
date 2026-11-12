import Foundation

/// Canned study sets and a quiz for `--demo`, so the cards, the set page and a
/// quiz in progress can be seen in the simulator.
extension DemoChats {
    static let quizThreadID = UUID(uuidString: "00000000-0000-0000-0000-000000000005")!

    static let study: StudyPayload = {
        let soon = StudySet.day.string(from: Date().addingTimeInterval(2 * 86400))
        let later = StudySet.day.string(from: Date().addingTimeInterval(9 * 86400))
        let isee = StudySet.day.string(from: Date().addingTimeInterval(52 * 86400))
        let json = #"""
        {"studentId":"demo","sets":[
         {"id":"demo-cells","title":"Science quiz: cells","courseId":13,"testDate":"\#(soon)","daysLeft":2,"coverage":"okay","coverageNote":"the Unit 2 vocab list","createdByParent":false,
          "overall":{"level":"shaky","ready":2,"total":5,"note":"2 big topics still shaky"},
          "topics":[
           {"id":"t1","name":"Organelles and their jobs","weight":3,"level":"shaky","asked":6,"right":3,"lastSeen":"2026-11-10T03:00:00Z"},
           {"id":"t2","name":"Plant vs animal cells","weight":2,"level":"solid","asked":4,"right":4,"lastSeen":"2026-11-10T03:00:00Z"},
           {"id":"t3","name":"Cell theory","weight":2,"level":"mastered","asked":5,"right":5,"lastSeen":"2026-11-06T03:00:00Z"},
           {"id":"t4","name":"Prokaryotes vs eukaryotes","weight":2,"level":"learning","asked":3,"right":1,"lastSeen":"2026-11-10T03:00:00Z"},
           {"id":"t5","name":"Microscope parts","weight":1,"level":"new","asked":0,"right":0,"lastSeen":null}],
          "quizzes":2,"lastQuizAt":"2026-11-10T03:00:00Z"},
         {"id":"demo-spanish","title":"Spanish vocab: la comida","courseId":null,"testDate":"\#(later)","daysLeft":9,"coverage":"good","coverageNote":null,"createdByParent":false,
          "overall":{"level":"new","ready":0,"total":4,"note":null},
          "topics":[
           {"id":"s1","name":"Fruits and vegetables","weight":2,"level":"new","asked":0,"right":0,"lastSeen":null},
           {"id":"s2","name":"Meals and dishes","weight":2,"level":"new","asked":0,"right":0,"lastSeen":null},
           {"id":"s3","name":"Ordering at a restaurant","weight":2,"level":"new","asked":0,"right":0,"lastSeen":null},
           {"id":"s4","name":"Gustar with food","weight":1,"level":"new","asked":0,"right":0,"lastSeen":null}],
          "quizzes":0,"lastQuizAt":null},
         {"id":"demo-isee","title":"ISEE (Middle Level)","courseId":null,"testDate":"\#(isee)","daysLeft":52,"coverage":"okay","coverageNote":"a practice test you've taken","createdByParent":true,
          "overall":{"level":"learning","ready":1,"total":9,"note":null},
          "topics":[
           {"id":"i1","name":"Verbal: synonyms","weight":2,"level":"shaky","asked":8,"right":5,"lastSeen":"2026-11-08T03:00:00Z"},
           {"id":"i2","name":"Verbal: sentence completion","weight":2,"level":"learning","asked":4,"right":2,"lastSeen":"2026-11-08T03:00:00Z"},
           {"id":"i3","name":"Reading comprehension","weight":3,"level":"new","asked":0,"right":0,"lastSeen":null},
           {"id":"i4","name":"Quantitative: word problems","weight":2,"level":"solid","asked":5,"right":5,"lastSeen":"2026-11-08T03:00:00Z"},
           {"id":"i5","name":"Quantitative: quantitative comparison","weight":2,"level":"new","asked":0,"right":0,"lastSeen":null},
           {"id":"i6","name":"Math: numbers and operations","weight":2,"level":"new","asked":0,"right":0,"lastSeen":null},
           {"id":"i7","name":"Math: algebra","weight":2,"level":"new","asked":0,"right":0,"lastSeen":null},
           {"id":"i8","name":"Math: geometry and measurement","weight":2,"level":"new","asked":0,"right":0,"lastSeen":null},
           {"id":"i9","name":"Math: data analysis and probability","weight":1,"level":"new","asked":0,"right":0,"lastSeen":null}],
          "quizzes":1,"lastQuizAt":"2026-11-08T03:00:00Z"}],
         "suggestions":[{"assignmentId":4,"courseId":11,"name":"Verbs Quiz","dueAt":"2026-11-14T07:59:00Z"}]}
        """#
        return try! ChatStore.decoder.decode(StudyPayload.self, from: Data(json.utf8))
    }()

    static func studyDetail(_ id: String) -> StudySetDetail {
        StudySetDetail(
            set: study.sets.first { $0.id == id },
            format: "About 15 questions: mostly multiple choice, plus a labeled diagram and two short answers.",
            sources: [
                .init(id: "src1", kind: "photo", body: "Photo from a chat", imagePath: nil, createdAt: .now.addingTimeInterval(-86400 * 3)),
                .init(id: "src2", kind: "note", body: "Ms. Ruiz said the diagram will be a plant cell.", imagePath: nil, createdAt: .now.addingTimeInterval(-86400)),
            ],
            quizzes: [
                .init(threadId: quizThreadID, createdAt: .now.addingTimeInterval(-3600 * 20), mode: "practice", count: 10,
                      finished: true, right: 7, answered: 10, byParent: false),
            ])
    }

    /// The demo's answer to question 2, once tapped, so the card keeps it.
    @MainActor static var demoChoice: Int?
    /// Ended in the demo, so the recap stays up.
    @MainActor static var demoFinished = false

    @MainActor static func quizState(_ start: QuizStart, finished: Bool = false) -> QuizState {
        if finished { demoFinished = true }
        let state = cannedQuizState(start, finished: finished || demoFinished)
        guard let choice = demoChoice else { return state }
        return QuizState(setId: state.setId, setTitle: state.setTitle, mode: state.mode, count: state.count,
                         finished: state.finished, questions: state.questions.map { answered($0, choice) }, recap: state.recap)
    }

    private static func answered(_ q: QuizQuestion, _ choice: Int) -> QuizQuestion {
        guard q.id == "q2" else { return q }
        var a = q
        a.answered = true
        a.chosenIndex = choice
        a.result = choice == 1 ? "correct" : "wrong"
        a.answerIndex = 1
        a.answer = "Ribosome"
        return a
    }

    private static func cannedQuizState(_ start: QuizStart, finished: Bool) -> QuizState {
        let json = #"""
        {"setId":"\#(start.setID)","setTitle":"\#(start.setTitle)","mode":"\#(start.mode)","count":\#(start.count),"finished":\#(finished),
         "questions":[
          {"id":"q1","number":1,"of":10,"topic":"Cell theory","kind":"choice","prompt":"Which is **not** part of cell theory?","choices":["All living things are made of cells","Cells come from other cells","All cells have a nucleus","The cell is the basic unit of life"],"answered":true,"chosenIndex":2,"result":"correct","answerIndex":2,"answer":"All cells have a nucleus"},
          {"id":"q2","number":2,"of":10,"topic":"Organelles and their jobs","kind":"choice","prompt":"Which organelle makes proteins?","choices":["Mitochondria","Ribosome","Golgi body","Vacuole"],"answered":false}],
         "recap":\#(finished ? #"{"right":7,"answered":10,"topics":[{"name":"Organelles and their jobs","before":"learning","after":"shaky","right":3,"asked":4},{"name":"Cell theory","before":"solid","after":"mastered","right":2,"asked":2},{"name":"Prokaryotes vs eukaryotes","before":"shaky","after":"learning","right":1,"asked":3}],"overall":{"level":"shaky","ready":2,"total":5,"note":"2 big topics still shaky"}}"# : "null")}
        """#
        return try! ChatStore.decoder.decode(QuizState.self, from: Data(json.utf8))
    }

    @MainActor static func answer(_ body: [String: Any]) -> ChatStore.QuizAnswerReply {
        if let choice = body["choice"] as? Int { demoChoice = choice }
        return .init(state: quizState(QuizStart(setID: "demo-cells", setTitle: "Science quiz: cells")), note: "Recorded.")
    }

    static let quizMessages: [ChatMessage] = [
        ChatMessage(id: UUID(), role: .student, content: "Let's go! (Practice, 10 questions)"),
        ChatMessage(id: UUID(), role: .tutor, content: #"""
        Let's do it! Starting with a warm-up.

        ```question
        {"id":"q1","number":1,"of":10,"topic":"Cell theory","kind":"choice","prompt":"Which is **not** part of cell theory?","choices":["All living things are made of cells","Cells come from other cells","All cells have a nucleus","The cell is the basic unit of life"]}
        ```
        """#),
        ChatMessage(id: UUID(), role: .student, content: "C. All cells have a nucleus"),
        ChatMessage(id: UUID(), role: .tutor, content: #"""
        Yes! Bacteria don't have one, so that can't be part of the theory.

        ```question
        {"id":"q2","number":2,"of":10,"topic":"Organelles and their jobs","kind":"choice","prompt":"Which organelle makes proteins?","choices":["Mitochondria","Ribosome","Golgi body","Vacuole"]}
        ```
        """#),
    ]
}
