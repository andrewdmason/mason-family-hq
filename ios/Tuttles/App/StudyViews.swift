import SwiftUI

// Study sets on screen: the Study section of the chat list, the nudge on a new
// chat, the card a set becomes in a chat, its page, and starting a quiz.

// MARK: - Levels

/// A level as a small colored capsule.
struct LevelBadge: View {
    let level: StudyLevel
    var body: some View {
        Label(level.label, systemImage: level.symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(level == .shaky ? Color(red: 0.62, green: 0.48, blue: 0) : level.tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(level.tint.opacity(0.15), in: .capsule)
            .labelStyle(.titleAndIcon)
            .fixedSize()
    }
}

/// The ladder, filled up to a level: New ▸ Learning ▸ Shaky ▸ Solid ▸ Mastered.
struct LevelMeter: View {
    let level: StudyLevel
    var body: some View {
        HStack(spacing: 4) {
            ForEach(StudyLevel.allCases.dropFirst(), id: \.self) { step in
                Capsule()
                    .fill(step.step <= level.step ? level.tint : Color.secondary.opacity(0.2))
                    .frame(height: 6)
            }
        }
        .accessibilityLabel("Level: \(level.label)")
    }
}

// MARK: - Rows and cards

/// A set in a list: what it is, when, and how ready.
struct StudySetRow: View {
    let set: StudySet
    @Environment(ChatStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(set.title).font(.body.weight(.medium)).lineLimit(1)
                Spacer(minLength: 4)
                LevelBadge(level: set.overall.level)
            }
            HStack(spacing: 6) {
                if let info = store.classInfo(set.courseId) { ClassLabel(info: info) }
                if let when = set.whenText {
                    Text(when).font(.footnote.weight(set.isSoon ? .semibold : .regular))
                        .foregroundStyle(set.isSoon ? TuttlesLook.accent : .secondary)
                }
                Text("·").foregroundStyle(.tertiary)
                Text(set.readyText).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            if let note = set.overall.note {
                Label(note, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 2)
    }
}

/// A set as it shows in a chat, where it was made: tap to open it, or start a quiz.
struct StudySetBlockView: View {
    let json: String
    @Environment(ChatStore.self) private var store
    @Environment(\.navigate) private var navigate
    @State private var quizzing: StudySet?

    private var ref: (id: String, title: String)? {
        guard let data = json.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = o["id"] as? String else { return nil }
        return (id, o["title"] as? String ?? "Study set")
    }

    var body: some View {
        if let ref {
            let set = store.studySet(ref.id)
            VStack(alignment: .leading, spacing: 10) {
                Button { navigate.go(.studySet(ref.id)) } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "books.vertical.fill")
                            .font(.title2)
                            .foregroundStyle(TuttlesLook.accent)
                            .frame(width: 32)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(set?.title ?? ref.title).font(.headline)
                            if let set {
                                Text([set.whenText.map { "Test \($0)" }, "\(set.topics.count) topics", "material \(set.coverage)"]
                                    .compactMap { $0 }.joined(separator: " · "))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("Study set").font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)
                if let set, !set.topics.isEmpty {
                    Button { quizzing = set } label: {
                        Label("Quiz me", systemImage: "checklist")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.glassProminent)
                }
            }
            .padding(14)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 18))
            .task(id: ref.id) { if set == nil { await store.refreshStudy() } }
            .sheet(item: $quizzing) { QuizStartSheet(set: $0) }
        }
    }
}

/// On a new chat: the most pressing set, with a way straight into a quiz.
struct StudyNudge: View {
    let set: StudySet
    @Environment(\.navigate) private var navigate
    @State private var quizzing = false

    var body: some View {
        Button { quizzing = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "books.vertical.fill").foregroundStyle(TuttlesLook.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(set.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text([set.whenText.map { "Test \($0)" }, set.overall.note ?? set.readyText].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Text("Quiz me")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(TuttlesLook.accent, in: .capsule)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $quizzing) { QuizStartSheet(set: set) }
    }
}

/// The chat list's Study section: sets, most pressing first, and Canvas tests without one.
struct StudySection: View {
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store
    @State private var creating = false

    var body: some View {
        let sets = store.study?.sets ?? []
        let suggestions = store.study?.suggestions ?? []
        if !sets.isEmpty || !suggestions.isEmpty {
            Section {
                ForEach(sets) { set in
                    NavigationLink(value: Route.studySet(set.id)) { StudySetRow(set: set) }
                }
                ForEach(suggestions) { s in
                    Button { setUp(s) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "plus.circle.fill").foregroundStyle(TuttlesLook.accent)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Get ready for \(s.name)").font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                                if let due = s.dueAt {
                                    Text(due.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            } header: {
                HStack {
                    Text("Study")
                    Spacer()
                    Button("New", systemImage: "plus") { creating = true }
                        .font(.footnote.weight(.semibold))
                        .textCase(nil)
                }
            }
            .sheet(isPresented: $creating) { NewStudySetSheet { id in path.append(.studySet(id)) } }
        }
    }

    /// A chat about the Canvas test that sets it up.
    private func setUp(_ s: StudySuggestion) {
        let a = ClassAssignment(id: s.assignmentId, courseId: s.courseId, name: s.name, dueAt: s.dueAt, status: .todo,
                                score: nil, pointsPossible: nil, isQuiz: true, comments: [], isNew: false, url: nil)
        path.append(.chat(UUID(), isNew: true, start: ChatStart(assignment: a, autoSend: "Help me get ready for \(s.name).")))
    }
}

// MARK: - Starting a quiz

struct QuizStartSheet: View {
    let set: StudySet
    @Environment(\.dismiss) private var dismiss
    @Environment(\.navigate) private var navigate
    @State private var mode = "practice"
    @State private var count = 10

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Kind", selection: $mode) {
                        Text("Practice").tag("practice")
                        Text("Test run").tag("test")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                } footer: {
                    Text(mode == "practice"
                         ? "Tuttles tells you how you did after each question, and helps when you miss one."
                         : "Like the real thing: timed, and no feedback until the end.")
                }
                Section("How many questions") {
                    Picker("Questions", selection: $count) {
                        Text("5").tag(5)
                        Text("10").tag(10)
                        Text("20").tag(20)
                    }
                    .pickerStyle(.segmented)
                }
                if !set.topics.isEmpty {
                    Section("Focus") {
                        let weak = set.topics.filter { $0.level == .learning || $0.level == .shaky }
                        let fresh = set.topics.filter { $0.level == .new }
                        Text(weak.isEmpty
                             ? (fresh.isEmpty ? "A mix to keep everything fresh." : "Starting on what you haven't been quizzed on yet.")
                             : "Mostly \(weak.prefix(2).map(\.name).joined(separator: " and ")), with some review.")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(set.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") {
                        dismiss()
                        navigate.go(.chat(UUID(), isNew: true, quiz: QuizStart(setID: set.id, setTitle: set.title, mode: mode, count: count)))
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - A set's page

struct StudySetView: View {
    let setID: String
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store
    @State private var detail: StudySetDetail?
    @State private var error: String?
    @State private var quizzing: StudySet?
    @State private var adding = false
    @State private var editingDate = false
    @State private var renaming = false
    @State private var newTitle = ""

    private var set: StudySet? { detail?.set ?? store.studySet(setID) }

    var body: some View {
        List {
            if let set {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 6) {
                            if let info = store.classInfo(set.courseId) { ClassLabel(info: info) }
                            if set.createdByParent {
                                Text("Added by a parent").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if let when = set.whenText {
                            Label("Test \(when)\(set.daysLeft.map { $0 > 1 && $0 < 60 ? ", in \($0) days" : "" } ?? "")",
                                  systemImage: "calendar")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(set.isSoon ? TuttlesLook.accent : .secondary)
                        }
                        HStack {
                            Text("Overall").font(.headline)
                            Spacer()
                            LevelBadge(level: set.overall.level)
                        }
                        LevelMeter(level: set.overall.level)
                        Text(set.readyText).font(.subheadline).foregroundStyle(.secondary)
                        if let note = set.overall.note {
                            Label(note, systemImage: "exclamationmark.triangle.fill").font(.subheadline).foregroundStyle(.orange)
                        }
                    }
                    .padding(.vertical, 6)
                }
                Section {
                    Button { quizzing = set } label: {
                        Label("Quiz me", systemImage: "checklist")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(set.topics.isEmpty)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                Section {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: set.coverage == "good" ? "checkmark.seal.fill" : "doc.text.magnifyingglass")
                            .foregroundStyle(set.coverage == "good" ? .green : .orange)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(coverageTitle(set.coverage)).font(.subheadline.weight(.semibold))
                            if let need = set.coverageNote, !need.isEmpty, set.needsMaterial {
                                Text("What would help: \(need)").font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Button("Add material", systemImage: "camera.fill") { adding = true }
                    if let detail, !detail.sources.isEmpty {
                        let photos = detail.sources.filter { $0.kind == "photo" }.count
                        let notes = detail.sources.filter { $0.kind == "note" }.count
                        let canvas = detail.sources.filter { $0.kind == "canvas" }.count
                        Text([photos > 0 ? "\(photos) photo\(photos == 1 ? "" : "s")" : nil,
                              notes > 0 ? "\(notes) note\(notes == 1 ? "" : "s")" : nil,
                              canvas > 0 ? "Canvas" : nil].compactMap { $0 }.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Material")
                } footer: {
                    if let format = detail?.format, !format.isEmpty { Text("The test: \(format)") }
                }

                Section("Topics") {
                    ForEach(set.topics) { topic in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(topic.name).font(.body)
                                if topic.weight == 3 {
                                    Text("big").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                                        .padding(.horizontal, 5).padding(.vertical, 1)
                                        .overlay(Capsule().strokeBorder(.tertiary))
                                }
                                Spacer(minLength: 6)
                                LevelBadge(level: topic.level)
                            }
                            if topic.asked > 0 {
                                Text("\(topic.right) of \(topic.asked) right\(topic.lastSeen.map { " · last \($0.formatted(.relative(presentation: .named)))" } ?? "")")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 2)
                        .swipeActions {
                            Button("Remove", systemImage: "minus.circle", role: .destructive) {
                                Task { await removeTopic(topic) }
                            }
                        }
                    }
                }

                if let quizzes = detail?.quizzes, !quizzes.isEmpty {
                    Section("Quizzes") {
                        ForEach(quizzes) { q in
                            NavigationLink(value: Route.chat(q.threadId, isNew: false)) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(q.mode == "test" ? "Test run" : "Practice").font(.body.weight(.medium))
                                        Text(q.createdAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if q.byParent { Text("parent").font(.caption2).foregroundStyle(.secondary) }
                                    Text(q.answered > 0 ? "\(q.right)/\(q.answered)" : "not started")
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            } else if let error {
                ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(set?.title ?? "Study set")
        .navigationBarTitleDisplayMode(.inline)
        .kidUsing(store.actingKid)
        .toolbar {
            if let set {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Rename", systemImage: "pencil") { newTitle = set.title; renaming = true }
                        Button("Change test date", systemImage: "calendar") { editingDate = true }
                        Button("Put away", systemImage: "archivebox") {
                            Task {
                                try? await store.updateStudySet(setID, ["archived": true])
                                if !path.isEmpty { path.removeLast() }
                            }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $quizzing) { QuizStartSheet(set: $0) }
        .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) {
            AddMaterialSheet(setID: setID, hint: set?.coverageNote)
        }
        .sheet(isPresented: $editingDate) {
            TestDateSheet(date: set?.date) { date in
                Task {
                    try? await store.updateStudySet(setID, ["testDate": date.map { StudySet.day.string(from: $0) } ?? NSNull()])
                    await load()
                }
            }
        }
        .alert("Rename", isPresented: $renaming) {
            TextField("Name", text: $newTitle)
            Button("Save") {
                Task {
                    try? await store.updateStudySet(setID, ["title": newTitle])
                    await load()
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func coverageTitle(_ coverage: String) -> String {
        switch coverage {
        case "good": "Tuttles has what it needs"
        case "okay": "Tuttles has the topics, but could use more detail"
        default: "Tuttles is mostly guessing: add the study guide or notes"
        }
    }

    private func load() async {
        do {
            detail = try await store.studyDetail(setID)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func removeTopic(_ topic: StudySet.Topic) async {
        try? await store.updateStudySet(setID, ["removeTopicId": topic.id])
        await load()
    }
}

private struct TestDateSheet: View {
    let date: Date?
    let onSave: (Date?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var picked = Date()
    @State private var hasDate = true

    var body: some View {
        NavigationStack {
            Form {
                Toggle("There's a test date", isOn: $hasDate)
                if hasDate {
                    DatePicker("Test day", selection: $picked, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                }
            }
            .navigationTitle("Test date")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(hasDate ? picked : nil); dismiss() }
                }
            }
            .onAppear {
                hasDate = true
                if let date { picked = date }
            }
        }
    }
}

// MARK: - Material

/// Photos and a note for a set; Tuttles reads them in before the sheet closes.
struct AddMaterialSheet: View {
    let setID: String
    let hint: String?
    @Environment(ChatStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var photos: [ChatPhoto] = []
    @State private var camera = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PhotoStrip(photos: $photos) { camera = true }
                } header: {
                    Text("Photos")
                } footer: {
                    Text(hint.map { $0.isEmpty ? "Study guides, vocab lists, notes, old quizzes." : "Most helpful: \($0)." }
                         ?? "Study guides, vocab lists, notes, old quizzes.")
                }
                Section("Or type what you know") {
                    TextField("What the teacher said is on it, words to know…", text: $note, axis: .vertical)
                        .lineLimit(3...10)
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Add material")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else {
                        Button("Add") { save() }
                            .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && photos.isEmpty)
                    }
                }
            }
            .fullScreenCover(isPresented: $camera) { CameraView { photos.append(contentsOf: $0) } }
            .interactiveDismissDisabled(saving)
        }
    }

    private func save() {
        saving = true
        error = nil
        Task {
            do {
                try await store.addMaterial(to: setID, note: note, photos: photos)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}

/// Photos taken for a form, with the camera button first.
struct PhotoStrip: View {
    @Binding var photos: [ChatPhoto]
    let openCamera: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button(action: openCamera) {
                    Image(systemName: "camera.fill")
                        .font(.title2)
                        .frame(width: 64, height: 84)
                        .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Take photos")
                ForEach(photos) { photo in
                    Image(uiImage: photo.image)
                        .resizable().scaledToFill()
                        .frame(width: 64, height: 84)
                        .clipShape(.rect(cornerRadius: 12))
                        .overlay(alignment: .topTrailing) {
                            Button { photos.removeAll { $0.id == photo.id } } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .symbolRenderingMode(.palette)
                                    .foregroundStyle(.white, .black.opacity(0.55))
                            }
                            .offset(x: 4, y: -4)
                            .accessibilityLabel("Remove photo")
                        }
                }
            }
            .padding(.vertical, 4)
        }
    }
}

/// A set made from a form: a parent's (for the kid), or the kid's outside a chat.
struct NewStudySetSheet: View {
    var forName: String?
    let onMade: (String) -> Void
    @Environment(ChatStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var courseID: Int?
    @State private var hasDate = true
    @State private var date = Date().addingTimeInterval(7 * 86400)
    @State private var note = ""
    @State private var photos: [ChatPhoto] = []
    @State private var isee = false
    @State private var camera = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("ISEE prep", isOn: $isee)
                } footer: {
                    if isee { Text("Starts from the ISEE Upper Level's sections: verbal, quantitative, reading and math.") }
                }
                Section {
                    TextField(isee ? "ISEE (Upper Level)" : "Science quiz: cells", text: $title)
                    if !isee, let classes = store.classes?.classes, !classes.isEmpty {
                        Picker("Class", selection: $courseID) {
                            Text("None").tag(Int?.none)
                            ForEach(classes) { Text($0.shortName).tag(Optional($0.id)) }
                        }
                    }
                    Toggle("Test date", isOn: $hasDate)
                    if hasDate { DatePicker("Day", selection: $date, displayedComponents: .date) }
                }
                Section {
                    PhotoStrip(photos: $photos) { camera = true }
                    TextField("What's on it, what the teacher said…", text: $note, axis: .vertical)
                        .lineLimit(3...10)
                } header: {
                    Text("Material")
                } footer: {
                    Text("Tuttles reads this into topics to quiz on. A study guide or vocab list helps most.")
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(forName.map { "New study set for \($0)" } ?? "New study set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else {
                        Button("Make") { save() }
                            .disabled(!isee && title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .fullScreenCover(isPresented: $camera) { CameraView { photos.append(contentsOf: $0) } }
            .interactiveDismissDisabled(saving)
        }
    }

    private func save() {
        saving = true
        error = nil
        Task {
            do {
                let set = try await store.createStudySet(
                    title: title.trimmingCharacters(in: .whitespaces), courseID: isee ? nil : courseID,
                    testDate: hasDate ? date : nil, note: note, photos: photos, template: isee ? "isee" : nil)
                dismiss()
                if let set { onMade(set.id) }
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}
