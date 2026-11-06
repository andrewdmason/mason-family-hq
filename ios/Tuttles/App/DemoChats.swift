import Foundation
import UIKit

/// Canned chats for `--demo` (the simulator, with no sign-in): real tutor
/// replies from the bake-off the tutor's rules were tested in, so the drawing of math and
/// visuals can be checked against what the tutor actually writes.
enum DemoChats {
    static let threads: [TutorThread] = [
        TutorThread(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, title: "Mapping diagrams", updatedAt: Date().addingTimeInterval(0), archivedAt: nil, courseId: 10),
        TutorThread(id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, title: "Puppy weight graph", updatedAt: Date().addingTimeInterval(-5400), archivedAt: nil, courseId: 10),
        TutorThread(id: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!, title: "Domain and range of 2a", updatedAt: Date().addingTimeInterval(-10800), archivedAt: nil, courseId: 10),
        TutorThread(id: UUID(uuidString: "00000000-0000-0000-0000-000000000004")!, title: "Vasco da Gama’s voyage", updatedAt: Date().addingTimeInterval(-16200), archivedAt: nil, courseId: 12),
    ]

    static let messages: [UUID: [ChatMessage]] = [
        UUID(uuidString: "00000000-0000-0000-0000-000000000001")!: [
            ChatMessage(id: UUID(), role: .student, content: #"""
            whats a mapping diagram
            """#),
            ChatMessage(id: UUID(), role: .tutor, content: #"""
            A **mapping diagram** shows how each **input** ($x$) connects to an **output** ($y$).
            
            - Put the $x$-values in the left box.
            - Put the $y$-values in the right box.
            - Draw an arrow for each ordered pair $(x,y)$.
            
            Here’s a separate example using $(1,3),(2,5),(4,3)$:
            
            ```visual
            {"type":"mapping","inputLabel":"Input (x)","outputLabel":"Output (y)","inputs":[1,2,4],"outputs":[3,5],"arrows":[[1,3],[2,5],[4,3]]}
            ```
            
            Notice that repeated values are written only **once**, but they can have multiple arrows pointing to them.
            """#),
        ],
        UUID(uuidString: "00000000-0000-0000-0000-000000000002")!: [
            ChatMessage(id: UUID(), role: .student, content: #"""
            how do i do number 2
            """#),
            ChatMessage(id: UUID(), role: .tutor, content: #"""
            Start by labeling the axes:
            
            - Which variable should go on the **horizontal axis**: time or weight?
            - Which variable should go on the **vertical axis**?
            
            Tell me what you think, and then we’ll decide what shape to draw.
            """#),
            ChatMessage(id: UUID(), role: .student, content: #"""
            idk
            """#),
            ChatMessage(id: UUID(), role: .tutor, content: #"""
            Time usually goes on the **horizontal ($x$) axis**, so label it **Time (months)**.
            
            Now, what should the vertical ($y$) axis show? Think: what is changing as time passes?
            """#),
            ChatMessage(id: UUID(), role: .student, content: #"""
            i still dont get it can you just show me
            """#),
            ChatMessage(id: UUID(), role: .tutor, content: #"""
            Here’s a similar example: **A plant grows at a steady rate for four weeks.**
            
            - Horizontal axis: **Time (weeks)**
            - Vertical axis: **Plant height**
            - “Steady rate” means draw a **straight line rising**
            - Connect the line because height changes at every moment, so it’s **continuous**
            
            ```visual
            {"type":"graph","xRange":[0,5],"yRange":[0,5],"xLabel":"Time (weeks)","yLabel":"Plant height","title":"Plant growing at a steady rate","segments":[{"from":[0,1],"to":[4,4]}],"hideNumbers":true}
            ```
            
            Now copy that idea for the puppy, replacing **plant height** with what the puppy is gaining.
            """#),
        ],
        UUID(uuidString: "00000000-0000-0000-0000-000000000003")!: [
            ChatMessage(id: UUID(), role: .student, content: #"""
            is this right
            """#),
            ChatMessage(id: UUID(), role: .tutor, content: #"""
            Almost!
            
            - **Domain:** Not quite—don’t repeat the same value. There is only one $x$-value.
            - **Range:** Not just $1$ and $5$; the line includes **every** $y$-value between them.
            - **Not a function:** **Correct**, because the same input has many outputs (it fails the vertical line test).
            """#),
        ],
        UUID(uuidString: "00000000-0000-0000-0000-000000000004")!: [
            ChatMessage(id: UUID(), role: .student, content: #"""
            can you help me with number 3, i picked vasco da gama
            """#),
            ChatMessage(id: UUID(), role: .tutor, content: #"""
            You chose **Vasco da Gama**, and your current answer mentions spices and silk. But the question asks for the **significance of his voyage**—why it mattered.
            
            Look in the reading for:
            
            - Where did he sail **from and to**?
            - What new **sea route** did he establish?
            - How did that route affect European **trade with Asia**?
            
            What does your reading say about his route to India?
            """#),
        ],
    ]

    /// A short reply, streamed in a few words at a time.
    static func reply(onText: @MainActor (String) -> Void) async throws {
        let text = #"""
        Not quite. It’s okay for each $x$ and $y$ to be the same number.
        
        A relation is a function if **every $x$-value has exactly one $y$-value**. Look at the $x$ column: does any $x$ appear more than once with different $y$-values?
        """#
        var shown = ""
        for word in text.split(separator: " ", omittingEmptySubsequences: false) {
            shown += (shown.isEmpty ? "" : " ") + word
            await onText(shown)
            try await Task.sleep(for: .milliseconds(40))
        }
    }
}

extension DemoChats {
    /// Canned classes for `--demo`: a week of a 7th grader's coursework.
    static let classes: ClassesPayload = {
        let day: TimeInterval = 86400
        func a(_ id: Int, _ course: Int, _ name: String, due: TimeInterval, _ status: ClassAssignment.Status,
               score: Double? = nil, of points: Double? = nil, comment: String? = nil, new: Bool = false) -> ClassAssignment {
            ClassAssignment(id: id, courseId: course, name: name, dueAt: Date().addingTimeInterval(due), status: status,
                            score: score, pointsPossible: points, isQuiz: false,
                            comments: comment.map { [.init(author: "Mr. Beaudin", comment: $0)] } ?? [],
                            isNew: new, url: nil)
        }
        let math = [a(1, 10, "2-13 HW", due: 0.4 * day, .todo), a(2, 10, "2-14 HW", due: 1.4 * day, .todo)]
        let mathMissing = [a(3, 10, "2-11 HW", due: -2 * day, .missing)]
        let english = [a(4, 11, "Verbs Quiz", due: 0.5 * day, .todo)]
        let science = [a(5, 13, "Unit 1 Come See Me", due: 7 * day, .todo)]
        let historyFeedback = [a(6, 12, "3.8 Homework: Europeans Explore the East", due: -7 * day, .graded, score: 6, of: 8,
                                 comment: "Missing important parts of the final question.", new: true)]
        return ClassesPayload(
            student: .init(name: "Sebastian", preview: false),
            memory: .init(
                learning: ["Gets it faster from a worked example before trying one himself"],
                classes: [
                    .init(courseId: 12, name: "History 7", strong: ["Understanding Reformation content"],
                          workingOn: ["Explaining why an event mattered, not just what happened"]),
                    .init(courseId: 10, name: "Mathematics 7 (H)", strong: [],
                          workingOn: ["Finding the range of a relation from a graph"]),
                ]),
            dueSoon: mathMissing + [math[0], english[0], math[1], science[0]],
            classes: [
                ClassInfo(id: 11, name: "English 7", shortName: "English", color: "#8a4fd6",
                          unit: .init(name: "Lord of the Flies", overviewTitle: nil, overview: nil),
                          due: english, missing: [], feedback: []),
                ClassInfo(id: 12, name: "History 7", shortName: "History", color: "#c46b1d",
                          unit: .init(name: "Reformation & Exploration", overviewTitle: "Unit 3 Overview",
                                      overview: "How did the printing press change Europe? This unit follows the Reformation and the voyages it helped launch."),
                          due: [], missing: [], feedback: historyFeedback),
                ClassInfo(id: 10, name: "Mathematics 7 (H)", shortName: "Math", color: "#2f6fdb",
                          unit: .init(name: "Relations and Functions", overviewTitle: nil, overview: nil),
                          due: math, missing: mathMissing, feedback: []),
                ClassInfo(id: 13, name: "Science 7", shortName: "Science", color: "#2e9d5b",
                          unit: .init(name: "Unit 2: Cells", overviewTitle: "Unit 2 Vocabulary List", overview: "Cell, Cell Theory, Prokaryote, Eukaryote, Organelle, Nucleus…"),
                          due: science, missing: [], feedback: []),
            ])
    }()
}

extension DemoChats {
    /// A canned "This week" for `--demo` with the parent view on.
    static let week: WeekPayload = {
        let json = #"""
        {"kid":{"id":"demo","name":"Sebastian"},"brief":{"comingUp":[
          {"id":4,"courseId":11,"name":"Verbs Quiz","dueAt":"2026-11-07T07:59:00Z","points":10}],
         "classes":[
          {"courseId":10,"name":"Mathematics 7 (H)","shortName":"Math","color":"#2f6fdb","unit":"Relations and Functions","topics":[
            {"id":"10-domain","title":"Domain and range of a relation","summary":"Finding every input (domain) and output (range) a relation uses, from lists, tables, mapping diagrams and graphs.","doing":"Quiz 2-3 was 3/6; still getting the hang of ranges on solid segments.","talk":["When you look at a graph, how do you tell the domain from the range?","What does a solid line tell you that dots don't?","Which kind of problem feels easiest right now: tables, diagrams or graphs?"],"assignmentIds":[1,2]}]},
          {"courseId":12,"name":"History 7","shortName":"History","color":"#c46b1d","unit":"Reformation & Exploration","topics":[
            {"id":"12-explore","title":"Why Europeans explored toward the East","summary":"God, glory and gold: the motives, the technology, and voyages like Vasco da Gama's.","doing":"6/8 on the homework; explaining why an event mattered is the growth area.","talk":["What were explorers really after: spices, fame or something else?","Which invention mattered most for those voyages, do you think?","Whose point of view is missing from how the explorers told it?"],"assignmentIds":[]}]},
          {"courseId":11,"name":"English 7","shortName":"English","color":"#8a4fd6","unit":"Lord of the Flies","topics":[
            {"id":"11-symbols","title":"Symbolism in Lord of the Flies","summary":"How the conch, the fire and the beast stand for bigger ideas, argued with evidence in a PCEAT paragraph.","doing":null,"talk":["What does the conch stand for by this point in the book?","Is the beast real, in a way?","Who do you trust most on the island right now?"],"assignmentIds":[]}]}]}}
        """#
        return try! ChatStore.decoder.decode(WeekPayload.self, from: Data(json.utf8))
    }()
}
