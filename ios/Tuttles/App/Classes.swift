import SwiftUI

// The student's classes, from Canvas through the website
// (/tuttles/api/classes, src/lib/tuttles/classes.ts): the "Due soon" strip,
// a page per class, and the labels on chats. The website works it all out;
// this draws it.

struct ClassesPayload: Decodable {
    struct Student: Decodable { let name: String; let preview: Bool }
    let student: Student
    let dueSoon: [ClassAssignment]
    let classes: [ClassInfo]
}

struct ClassInfo: Decodable, Identifiable, Hashable {
    struct Unit: Decodable, Hashable {
        let name: String
        let overviewTitle: String?
        let overview: String?
    }
    let id: Int
    let name: String
    let shortName: String
    let color: String
    let unit: Unit?
    let due: [ClassAssignment]
    let missing: [ClassAssignment]
    let feedback: [ClassAssignment]

    var tint: Color { Color(hex: color) }
}

struct ClassAssignment: Decodable, Identifiable, Hashable {
    enum Status: String, Decodable { case todo, missing, submitted, graded, excused }
    struct Comment: Decodable, Hashable { let author: String?; let comment: String }
    let id: Int
    let courseId: Int
    let name: String
    let dueAt: Date?
    let status: Status
    let score: Double?
    let pointsPossible: Double?
    let isQuiz: Bool
    let comments: [Comment]
    let isNew: Bool
    let url: String?

    func seen() -> ClassAssignment {
        ClassAssignment(id: id, courseId: courseId, name: name, dueAt: dueAt, status: status, score: score,
                        pointsPossible: pointsPossible, isQuiz: isQuiz, comments: comments, isNew: false, url: url)
    }

    /// "8/10", or nil when ungraded.
    var scoreText: String? {
        guard let score else { return nil }
        let s = score.formatted(.number.precision(.fractionLength(0...1)))
        guard let pointsPossible else { return s }
        return "\(s)/\(pointsPossible.formatted(.number.precision(.fractionLength(0...1))))"
    }

    /// "tonight", "tomorrow 8:30 AM", "Fri", "Oct 30".
    var dueText: String {
        guard let dueAt else { return "no due date" }
        let cal = Calendar.current
        let time = dueAt.formatted(date: .omitted, time: .shortened)
        if cal.isDateInToday(dueAt) { return cal.component(.hour, from: dueAt) >= 17 ? "tonight" : "today \(time)" }
        if cal.isDateInTomorrow(dueAt) { return "tomorrow" }
        if dueAt < .now { return dueAt.formatted(.dateTime.month(.abbreviated).day()) }
        if dueAt < .now.addingTimeInterval(6 * 86400) { return dueAt.formatted(.dateTime.weekday(.wide)) }
        return dueAt.formatted(.dateTime.month(.abbreviated).day())
    }
}

/// A chat opened from an assignment: it files under that class, the tutor
/// keeps the assignment in view, and "Go over this" sends its opening message.
struct ChatStart: Hashable {
    let assignment: ClassAssignment
    var autoSend: String?
}

extension Color {
    init(hex: String) {
        let v = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x888888
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

// MARK: - Pieces

/// The class a chat or assignment belongs to, as a small colored label.
struct ClassLabel: View {
    let info: ClassInfo
    var body: some View {
        Text(info.shortName)
            .font(.caption.weight(.semibold))
            .foregroundStyle(info.tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(info.tint.opacity(0.12), in: .capsule)
    }
}

/// One assignment card in the "Due soon" strip.
struct DueCard: View {
    let assignment: ClassAssignment
    let info: ClassInfo?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if let info { ClassLabel(info: info) }
                Spacer(minLength: 0)
                if assignment.status == .missing {
                    Text("Missing").font(.caption2.weight(.bold)).foregroundStyle(.red)
                }
            }
            Text(assignment.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2, reservesSpace: true)
                .multilineTextAlignment(.leading)
            Text(assignment.status == .missing ? "was due \(assignment.dueText)" : "due \(assignment.dueText)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .foregroundStyle(.primary)
        .padding(12)
        .frame(width: 168, alignment: .leading)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 18))
    }
}

/// The strip across the top of the chat list.
struct DueSoonStrip: View {
    let items: [ClassAssignment]
    let classes: [ClassInfo]
    let open: (ClassAssignment) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(items) { a in
                    Button { open(a) } label: { DueCard(assignment: a, info: classes.first { $0.id == a.courseId }) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 4)
        }
        .scrollClipDisabled()
    }
}

// MARK: - A class's page

struct ClassPageView: View {
    let courseID: Int
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store
    @State private var showingOverview = false

    private var info: ClassInfo? { store.classes?.classes.first { $0.id == courseID } }

    var body: some View {
        List {
            if let info {
                if let unit = info.unit {
                    Section("Current unit") {
                        Button {
                            showingOverview = true
                        } label: {
                            HStack {
                                Text(unit.name).foregroundStyle(.primary)
                                Spacer()
                                if unit.overview != nil {
                                    Text("Overview").font(.subheadline).foregroundStyle(.secondary)
                                    Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
                                }
                            }
                        }
                        .tint(.primary)
                        .disabled(unit.overview == nil)
                    }
                }
                if !info.missing.isEmpty {
                    Section("Missing") {
                        ForEach(info.missing) { a in assignmentRow(a) }
                    }
                }
                Section("Due soon") {
                    if info.due.isEmpty {
                        Text("Nothing due this week.").foregroundStyle(.secondary)
                    }
                    ForEach(info.due) { a in assignmentRow(a) }
                }
                if !info.feedback.isEmpty {
                    Section("Feedback") {
                        ForEach(info.feedback) { a in FeedbackRow(assignment: a, path: $path) }
                    }
                }
                let chats = store.threads.filter { $0.courseId == courseID }
                if !chats.isEmpty {
                    Section("Chats") {
                        ForEach(chats) { thread in
                            NavigationLink(value: Route.chat(thread.id, isNew: false)) {
                                ThreadRow(thread: thread, info: nil)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(info?.name ?? "Class")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New chat", systemImage: "square.and.pencil") {
                    path.append(.chat(UUID(), isNew: true, courseID: courseID))
                }
            }
        }
        .sheet(isPresented: $showingOverview) {
            if let unit = info?.unit {
                NavigationStack {
                    ScrollView {
                        Text(unit.overview ?? "")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                            .textSelection(.enabled)
                    }
                    .navigationTitle(unit.overviewTitle ?? unit.name)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { showingOverview = false } }
                }
            }
        }
        .refreshable { await store.refreshClasses() }
    }

    private func assignmentRow(_ a: ClassAssignment) -> some View {
        Button {
            path.append(.chat(UUID(), isNew: true, start: ChatStart(assignment: a)))
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(a.name).foregroundStyle(.primary)
                    Text(a.status == .missing ? "was due \(a.dueText)" : "due \(a.dueText)")
                        .font(.footnote)
                        .foregroundStyle(a.status == .missing ? .red : .secondary)
                }
                Spacer()
                Image(systemName: "bubble.left.and.text.bubble.right")
                    .foregroundStyle(TuttlesLook.accent)
                    .accessibilityLabel("Get help")
            }
        }
    }
}

private struct FeedbackRow: View {
    let assignment: ClassAssignment
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                if assignment.isNew {
                    Circle().fill(TuttlesLook.accent).frame(width: 8, height: 8).accessibilityLabel("New")
                }
                Text(assignment.name).font(.body.weight(.medium))
                Spacer()
                if let score = assignment.scoreText {
                    Text(score).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            ForEach(assignment.comments, id: \.self) { c in
                Text("“\(c.comment)”\(c.author.map { " — \($0)" } ?? "")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Button("Go over this") {
                store.markSeen(assignment)
                path.append(.chat(UUID(), isNew: true, start: ChatStart(
                    assignment: assignment,
                    autoSend: "Can we go over my feedback on \(assignment.name)?")))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .padding(.top, 2)
        }
        .padding(.vertical, 4)
        .onAppear { if assignment.isNew { store.markSeenLater(assignment) } }
    }
}

/// A chat in a list: its title, its class, and when it was last active.
struct ThreadRow: View {
    let thread: TutorThread
    let info: ClassInfo?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(thread.title ?? "New chat")
                .font(.body.weight(.medium))
                .lineLimit(1)
            HStack(spacing: 6) {
                if let info { ClassLabel(info: info) }
                Text(thread.updatedAt, format: .relative(presentation: .named))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
