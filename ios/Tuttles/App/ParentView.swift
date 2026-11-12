import SwiftUI

// The parents' side of Tuttles: what the kid is learning this week, per class
// (/tuttles/api/parent/week, src/lib/tuttles/week.ts), with a briefing chat
// for the parent on any topic and ways to bring it up at home. Parents switch
// between this and seeing the app as the kid from the account menu. What the
// kid is studying for (Study.swift) sits on top: how ready they are for each
// set, and a way to make one for them or add material to one.

struct WeekPayload: Decodable {
    struct Kid: Decodable { let id: String; let name: String }
    struct Topic: Decodable, Hashable, Identifiable {
        let id: String
        let title: String
        let summary: String
        let doing: String?
        let talk: [String]
        let assignmentIds: [Int]
    }
    struct ClassWeek: Decodable, Hashable, Identifiable {
        let courseId: Int
        let name: String
        let shortName: String
        let color: String
        let unit: String?
        let topics: [Topic]
        var id: Int { courseId }
        var tint: Color { Color(hex: color) }
    }
    struct ComingUp: Decodable, Hashable, Identifiable {
        let id: Int
        let courseId: Int
        let name: String
        let dueAt: Date
        let points: Double?
    }
    struct Brief: Decodable {
        let classes: [ClassWeek]
        let comingUp: [ComingUp]
    }
    let kid: Kid
    let brief: Brief?
}

/// What a parent's briefing chat is about, sent with its first message.
struct BriefingTopic: Hashable {
    let courseId: Int
    let title: String
    let summary: String
    let assignmentIds: [Int]

    init(_ topic: WeekPayload.Topic, courseId: Int) {
        self.courseId = courseId
        title = topic.title
        summary = topic.summary
        assignmentIds = topic.assignmentIds
    }
}

struct ParentHomeView: View {
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store
    @State private var showingMemory = false
    @State private var newSet = false

    private var kidName: String { store.week?.kid.name ?? store.classes?.student.name ?? "your kid" }

    var body: some View {
        List {
            Section {
                ForEach(store.study?.sets ?? []) { set in
                    NavigationLink(value: Route.studySet(set.id)) {
                        VStack(alignment: .leading, spacing: 4) {
                            StudySetRow(set: set)
                            Text(set.quizzes == 0
                                 ? "No quizzes yet"
                                 : "\(set.quizzes) quiz\(set.quizzes == 1 ? "" : "zes")\(set.lastQuizAt.map { ", last \($0.formatted(.relative(presentation: .named)))" } ?? "")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Button("New study set for \(kidName)", systemImage: "plus.circle") { newSet = true }
            } header: {
                Text("Studying")
            } footer: {
                if store.study?.sets.isEmpty ?? true {
                    Text("A quiz or test \(kidName) is getting ready for. Tuttles quizzes them on it and tracks what they know. Add a photo of the study guide and Tuttles does the rest.")
                }
            }

            if let brief = store.week?.brief {
                if !brief.comingUp.isEmpty {
                    Section("Coming up") {
                        ForEach(brief.comingUp) { item in
                            HStack(spacing: 10) {
                                if let info = brief.classes.first(where: { $0.courseId == item.courseId }) {
                                    ClassTag(name: info.shortName, tint: info.tint)
                                }
                                Text(item.name).lineLimit(1)
                                Spacer()
                                Text(item.dueAt, format: .dateTime.weekday(.abbreviated).month(.abbreviated).day())
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                ForEach(brief.classes.filter { !$0.topics.isEmpty }) { week in
                    Section {
                        ForEach(week.topics) { topic in
                            NavigationLink(value: Route.topic(topic, week)) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(topic.title).font(.body.weight(.medium))
                                    Text(topic.summary)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    } header: {
                        HStack(spacing: 8) {
                            ClassTag(name: week.shortName, tint: week.tint)
                            if let unit = week.unit { Text(unit).lineLimit(1) }
                        }
                    }
                }
            } else if store.weekLoaded {
                ContentUnavailableView(
                    "Nothing yet", systemImage: "books.vertical",
                    description: Text("Once \(kidName)'s Canvas is connected, this shows what they're learning each week."))
            } else {
                WeekPlaceholder()
            }

            let briefings = store.briefings
            if !briefings.isEmpty {
                Section("Your briefings") {
                    ForEach(briefings) { thread in
                        NavigationLink(value: Route.chat(thread.id, isNew: false)) {
                            ThreadRow(thread: thread, info: store.classInfo(thread.courseId))
                        }
                    }
                }
            }
        }
        .navigationTitle("This week")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { AccountMenu(showMemory: $showingMemory) }
        }
        .sheet(isPresented: $showingMemory) {
            MemorySheet(memory: store.classes?.memory, name: kidName)
        }
        .refreshable {
            async let week: Void = store.refreshWeek()
            async let threads: Void = store.refreshThreads()
            async let study: Void = store.refreshStudy()
            _ = await (week, threads, study)
        }
        .task {
            if store.study == nil { await store.refreshStudy() }
            if store.week == nil { await store.refreshWeek() }
        }
        .sheet(isPresented: $newSet) {
            NewStudySetSheet(forName: kidName) { id in path.append(.studySet(id)) }
        }
    }
}

/// One topic: what it is, how the kid's doing, a briefing for the parent, and
/// ways to bring it up.
struct TopicView: View {
    let topic: WeekPayload.Topic
    let week: WeekPayload.ClassWeek
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    ClassTag(name: week.shortName, tint: week.tint)
                    Text(topic.summary)
                }
                .padding(.vertical, 4)
                if let doing = topic.doing {
                    Label(doing, systemImage: "chart.line.uptrend.xyaxis")
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                Button {
                    path.append(.chat(UUID(), isNew: true, briefing: BriefingTopic(topic, courseId: week.courseId)))
                } label: {
                    Label("Brief me", systemImage: "sparkles")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.glassProminent)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
            } footer: {
                Text("A chat that teaches you this topic directly, as an adult. It's yours: it never shows up as \(store.week?.kid.name ?? "the kid")'s.")
            }
            if !topic.talk.isEmpty {
                Section("Talk about it") {
                    ForEach(topic.talk, id: \.self) { line in
                        Label(line, systemImage: "bubble.left")
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .navigationTitle(topic.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A class's short name as a small colored tag.
struct ClassTag: View {
    let name: String
    let tint: Color
    var body: some View {
        Text(name)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(tint.opacity(0.12), in: .capsule)
            .textCase(nil)
    }
}

/// Stand-ins while the first brief of the day is made (it can take a little while).
private struct WeekPlaceholder: View {
    @State private var pulse = false
    var body: some View {
        Group {
            Section {
                Text("Reading this week's classes…").foregroundStyle(.secondary)
            }
            ForEach(0..<3, id: \.self) { _ in
                Section {
                    ForEach(0..<2, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("A topic being learned")
                            Text("What it is, and what they're doing with it this week").font(.subheadline)
                        }
                        .redacted(reason: .placeholder)
                    }
                } header: {
                    Text("Class").redacted(reason: .placeholder)
                }
            }
        }
        .opacity(pulse ? 0.45 : 1)
        .animation(.easeInOut(duration: 0.9).repeatForever(), value: pulse)
        .onAppear { pulse = true }
    }
}
