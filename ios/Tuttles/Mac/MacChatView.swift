import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// One chat on the Mac: the conversation down a column in the middle of the
/// window, and the message box floating under it. Homework comes in by
/// dragging it onto the chat, pasting it, or picking it with the +.
struct MacChatView: View {
    let title: String?
    /// What's been said and what's being written (Shared/ChatSession.swift).
    @State private var chat: ChatSession

    @Environment(ChatStore.self) private var store
    @Environment(\.navigate) private var navigate
    @State private var viewing: PhotoRef?
    /// Which costume Tuttles greets a new chat in (Tuttles1…Tuttles10).
    @State private var pose = Int.random(in: 1...10)
    @State private var quizAgain: StudySet?
    @State private var dropping = false
    @State private var pasteWatch: Any?
    @FocusState private var typing: Bool

    init(store: ChatStore, threadID: UUID, isNew: Bool, title: String?, courseID: Int? = nil, briefing: BriefingTopic? = nil,
         quizStart: QuizStart? = nil, start: ChatStart? = nil) {
        self.title = title
        _chat = State(initialValue: ChatSession(store: store, threadID: threadID, isNew: isNew, courseID: courseID,
                                                briefing: briefing, quizStart: quizStart, start: start))
    }

    /// Study sets whose test hasn't happened yet and that have topics to quiz, most pressing first.
    private var activeSets: [StudySet] {
        Array((store.study?.sets ?? []).filter { ($0.daysLeft ?? 0) >= 0 && !$0.topics.isEmpty }.prefix(3))
    }

    /// The multiple choice question waiting for an answer, if a number key can pick it.
    private var openChoice: QuizQuestion? {
        guard let q = chat.quiz.state?.open, q.choices?.isEmpty == false, chat.quiz.canAnswer(q), !chat.sending else { return nil }
        return q
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    ForEach(chat.messages) { message in
                        switch message.role {
                        case .student: StudentMessage(message: message, viewing: $viewing)
                        case .tutor: TutorMessage(message: message)
                        }
                    }
                    if let state = chat.quiz.state, state.finished, let recap = state.recap, !chat.sending {
                        RecapCard(
                            state: state, recap: recap,
                            onAgain: store.studySet(state.setId).map { set in { quizAgain = set } },
                            onOpenSet: { navigate.go(.studySet(state.setId)) })
                            .frame(maxWidth: 480)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .frame(maxWidth: MacLook.column, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 32)
                .padding(.top, 20)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: chat.messages.last?.content) {
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: chat.messages.count) {
                withAnimation { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: chat.quiz.state?.finished) {
                withAnimation { proxy.scrollTo("end", anchor: .bottom) }
            }
        }
        .environment(chat.quiz)
        .sheet(item: $quizAgain) { QuizStartSheet(set: $0) }
        .overlay { if chat.messages.isEmpty { greeting } }
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .overlay { if dropping { dropHint } }
        .onDrop(of: [.fileURL, .pdf, .image], isTargeted: $dropping) { providers in
            Task { await attach(providers) }
            return true
        }
        .navigationTitle(title ?? "")
        .kidUsing(store.actingKid)
        .macBackdrop()
        .toolbar {
            if let state = chat.quiz.state {
                ToolbarItem(placement: .principal) { QuizProgress(state: state, startedAt: chat.testStartedAt) }
                if !state.finished {
                    ToolbarItem(placement: .primaryAction) {
                        Button("End quiz", systemImage: "flag.checkered") { chat.endQuiz() }
                    }
                }
            }
        }
        .task { await chat.open() }
        .task(id: chat.isQuiz) {
            // Known to be a quiz once the chat list has it (it may load after this opens).
            if chat.isQuiz, !chat.isNew, chat.quiz.state == nil { await chat.refreshQuiz() }
        }
        .task(id: chat.testStartedAt) { await chat.runTestClock() }
        .sheet(item: $viewing) { PhotoViewer(ref: $0).frame(minWidth: 720, minHeight: 560) }
        .onAppear {
            typing = true
            watchPaste()
        }
        .onDisappear {
            if let pasteWatch { NSEvent.removeMonitor(pasteWatch) }
            pasteWatch = nil
        }
    }

    // MARK: - A new chat

    private var greeting: some View {
        VStack(spacing: 14) {
            Image("Tuttles\(pose)")
                .resizable()
                .scaledToFit()
                .frame(height: chat.start == nil ? 220 : 150)
            if let quizStart = chat.quizStart {
                Text(quizStart.setTitle).font(.title2.weight(.semibold)).multilineTextAlignment(.center)
                if let startError = chat.startError {
                    Text(startError).foregroundStyle(.red).multilineTextAlignment(.center)
                } else {
                    Label("Getting your quiz ready…", systemImage: "checklist").foregroundStyle(.secondary)
                }
            } else if let start = chat.start {
                AssignmentBanner(assignment: start.assignment, info: store.classInfo(start.assignment.courseId))
                Text("Drop the page here, or say where you're stuck.")
                    .foregroundStyle(.secondary)
            } else {
                Text(chat.loadError ?? "What are you working on?")
                    .font(.title.weight(.semibold))
                if chat.loadError == nil {
                    Text("Drop your homework here, paste a screenshot, or ask a question.")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                // The tests coming up, each a click from a quiz.
                if chat.isNew, !activeSets.isEmpty {
                    VStack(spacing: 8) {
                        ForEach(activeSets) { StudyNudge(set: $0) }
                    }
                    .frame(maxWidth: 420)
                    .padding(.top, 12)
                }
            }
        }
        .padding(.horizontal, 32)
        .padding(.bottom, 90)
    }

    private var dropHint: some View {
        RoundedRectangle(cornerRadius: 28, style: .continuous)
            .strokeBorder(TuttlesLook.accent, style: StrokeStyle(lineWidth: 3, dash: [10, 8]))
            .background(TuttlesLook.accent.opacity(0.08), in: .rect(cornerRadius: 28, style: .continuous))
            .overlay {
                Label("Drop it to show Tuttles", systemImage: "arrow.down.doc.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(TuttlesLook.accent)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                    .glassEffect(.regular, in: .capsule)
            }
            .padding(16)
            .allowsHitTesting(false)
            .transition(.opacity)
    }

    // MARK: - Writing

    private var composer: some View {
        @Bindable var chat = chat
        return VStack(alignment: .leading, spacing: 8) {
            if let sendError = chat.sendError {
                Label(sendError, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 10)
            }
            VStack(alignment: .leading, spacing: 4) {
                if !chat.photos.isEmpty || !chat.files.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(chat.files) { file in
                                FileChip(file: file) {
                                    withAnimation { chat.files.removeAll { $0.id == file.id } }
                                }
                            }
                            ForEach(chat.photos) { photo in
                                Image(platformImage: photo.image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 72, height: 72)
                                    .clipShape(.rect(cornerRadius: 12))
                                    .overlay(alignment: .topTrailing) {
                                        Button {
                                            withAnimation { chat.photos.removeAll { $0.id == photo.id } }
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .symbolRenderingMode(.palette)
                                                .foregroundStyle(.white, .black.opacity(0.55))
                                        }
                                        .buttonStyle(.plain)
                                        .offset(x: 5, y: -5)
                                        .accessibilityLabel("Remove picture")
                                    }
                            }
                        }
                        .padding(.top, 10)
                        .padding(.horizontal, 12)
                    }
                }
                HStack(alignment: .bottom, spacing: 6) {
                    AttachMenu(photos: $chat.photos, files: $chat.files) {
                    } onAdded: {
                        typing = true
                    } onProblem: { problem in
                        chat.sendError = problem
                    } label: {
                        Image(systemName: "plus")
                            .font(.title3.weight(.medium))
                            .frame(width: 30, height: 30)
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .help("Add a PDF or a picture")
                    .accessibilityLabel("Add a PDF or a picture")

                    MessageField(text: $chat.draft, placeholder: openChoice == nil ? "Ask Tuttles" : "Press 1–\(openChoice?.choices?.count ?? 4) to answer, or ask Tuttles")
                        .focused($typing)
                        .onKeyPress(.return, phases: .down) { press in
                            // Return sends; Shift-Return is a new line.
                            guard !press.modifiers.contains(.shift) else { return .ignored }
                            chat.send()
                            return .handled
                        }
                        .onKeyPress(characters: .decimalDigits, phases: .down) { press in
                            // In a quiz, with nothing typed, 1 to 4 pick an answer.
                            guard chat.draft.isEmpty, press.modifiers.isEmpty, let q = openChoice,
                                  let n = Int(press.characters), (1...(q.choices?.count ?? 0)).contains(n) else { return .ignored }
                            chat.choose(q, n - 1)
                            return .handled
                        }

                    Button(action: chat.send) {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.bold))
                            .frame(width: 20, height: 20)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .disabled(!chat.canSend)
                    .help("Send (Return)")
                    .accessibilityLabel("Send")
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
            .glassEffect(.regular, in: .rect(cornerRadius: 26, style: .continuous))
            .shadow(color: .black.opacity(0.10), radius: 18, y: 6)
        }
        .frame(maxWidth: MacLook.column + 24)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .padding(.top, 6)
    }

    // MARK: - Dragging and pasting

    /// What was dropped on the chat: files from the Finder, or a picture or a
    /// PDF dragged straight out of another app.
    private func attach(_ providers: [NSItemProvider]) async {
        var picks: [() throws -> PickedFile] = []
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
               let url = await provider.fileURL() {
                picks.append { try PickedFile(contentsOf: url) }
            } else if let (data, type) = await provider.data(of: [.pdf, .image]) {
                let name = provider.suggestedName ?? (type.conforms(to: .pdf) ? "Dropped PDF" : "Dropped picture")
                picks.append { try PickedFile(name: name, type: type, data: data) }
            } else {
                picks.append { throw ChatFile.Problem.unreadable }
            }
        }
        add(picks)
    }

    private func add(_ picks: [() throws -> PickedFile]) {
        let (added, problem) = PickedFile.add(picks, photos: &chat.photos, files: &chat.files)
        chat.sendError = problem?.localizedDescription
        if added { typing = true }
    }

    /// ⌘V with a file, a PDF or a picture on the clipboard (a screenshot,
    /// usually) attaches it; text pastes into the message as ever.
    private func watchPaste() {
        guard pasteWatch == nil else { return }
        pasteWatch = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
                  event.charactersIgnoringModifiers == "v",
                  // Not while a sheet's up (a study set's form has its own fields).
                  event.window?.attachedSheet == nil, event.window?.sheetParent == nil
            else { return event }
            let picks = Self.clipboardPicks()
            guard !picks.isEmpty else { return event }
            add(picks)
            return nil
        }
    }

    /// The clipboard (a stand-in when the app is being tried out, DebugSnapshot.swift).
    static var clipboard = NSPasteboard.general

    private static func clipboardPicks() -> [() throws -> PickedFile] {
        let board = clipboard
        if let urls = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            return urls.map { url in { try PickedFile(contentsOf: url) } }
        }
        if let pdf = board.data(forType: .pdf) {
            return [{ try PickedFile(name: "Pasted PDF", type: .pdf, data: pdf) }]
        }
        for type in [NSPasteboard.PasteboardType.png, .tiff] {
            if let data = board.data(forType: type) {
                return [{ try PickedFile(name: "Pasted picture", type: .image, data: data) }]
            }
        }
        return []
    }
}

/// The message being written: a text box that grows with what's typed, up to
/// a few lines, then scrolls.
private struct MessageField: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Sets the height: the same words, laid out the same way.
            Text(text.isEmpty ? " " : text + (text.hasSuffix("\n") ? " " : ""))
                .font(.title3)
                .padding(.horizontal, 5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hidden()
            if text.isEmpty {
                Text(placeholder)
                    .font(.title3)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 5)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $text)
                .font(.title3)
                .scrollContentBackground(.hidden)
                .scrollIndicators(.never)
        }
        .frame(maxHeight: 180)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 4)
    }
}

private extension NSItemProvider {
    func fileURL() async -> URL? {
        await withCheckedContinuation { done in
            _ = loadObject(ofClass: URL.self) { url, _ in done.resume(returning: url) }
        }
    }

    /// The first of `types` this can give, as data.
    func data(of types: [UTType]) async -> (Data, UTType)? {
        for type in types where hasItemConformingToTypeIdentifier(type.identifier) {
            let data: Data? = await withCheckedContinuation { done in
                _ = loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in done.resume(returning: data) }
            }
            if let data { return (data, type) }
        }
        return nil
    }
}
