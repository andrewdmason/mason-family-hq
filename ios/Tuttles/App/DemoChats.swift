import Foundation
import UIKit

/// Canned chats for `--demo` (the simulator, with no sign-in): real tutor
/// replies from the bake-off the tutor's rules were tested in, so the drawing of math and
/// visuals can be checked against what the tutor actually writes.
enum DemoChats {
    static let threads: [TutorThread] = [
        TutorThread(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, title: "Mapping diagrams", updatedAt: Date().addingTimeInterval(0), archivedAt: nil),
        TutorThread(id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, title: "Puppy weight graph", updatedAt: Date().addingTimeInterval(-5400), archivedAt: nil),
        TutorThread(id: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!, title: "Domain and range of 2a", updatedAt: Date().addingTimeInterval(-10800), archivedAt: nil),
        TutorThread(id: UUID(uuidString: "00000000-0000-0000-0000-000000000004")!, title: "Vasco da Gama’s voyage", updatedAt: Date().addingTimeInterval(-16200), archivedAt: nil),
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
