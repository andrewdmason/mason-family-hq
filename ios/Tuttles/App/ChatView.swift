import SwiftUI

/// One chat: the conversation, and the message being written with the camera
/// beside it.
struct ChatView: View {
    let threadID: UUID
    let isNew: Bool
    let title: String?
    /// For a new chat: the class page it was started from, to file it under.
    var courseID: Int?
    /// For a new parent's chat: the kid's topic it briefs them on.
    var briefing: BriefingTopic?
    /// For a new quiz: the set and how it's run (Study.swift).
    var quizStart: QuizStart?

    /// For a new chat: the assignment it's about. Set by tapping one, here or
    /// on the list or a class page; the first message carries it.
    @State var start: ChatStart?

    @Environment(ChatStore.self) private var store
    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var photos: [ChatPhoto] = []
    @State private var sending = false
    @State private var loadError: String?
    @State private var sendError: String?
    @State private var showingCamera = false
    @State private var viewing: PhotoRef?
    /// Which costume Tuttles greets a new chat in (Tuttles1…Tuttles10).
    @State private var pose = Int.random(in: 1...10)
    @FocusState private var typing: Bool
    @State private var talk = TalkRecorder()
    @State private var transcribing = false
    /// In a call: the chat blurs back, the call's colors come up over it,
    /// and the message box turns into the talk bar (the camera rides along).
    @State private var showingVoice = false
    /// Dark status bar and all, once the call's colors have covered the chat.
    @State private var callIsDark = false
    @Namespace private var callSpace
    @State private var call: VoiceCall?
    @State private var showingCallCamera = false
    /// A quiz chat's questions and how they went, for its cards.
    @State private var quiz = QuizContext()
    /// When a test run began here, for its clock.
    @State private var testStartedAt: Date?
    @State private var quizAgain: StudySet?
    @State private var startError: String?
    @Environment(\.navigate) private var navigate

    private var isQuiz: Bool { quizStart != nil || store.threads.first { $0.id == threadID }?.isQuiz == true }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    ForEach(messages) { message in
                        switch message.role {
                        case .student: StudentMessage(message: message, viewing: $viewing)
                        case .tutor: TutorMessage(message: message)
                        }
                    }
                    if let state = quiz.state, state.finished, let recap = state.recap, !sending {
                        RecapCard(
                            state: state, recap: recap,
                            onAgain: store.studySet(state.setId).map { set in { quizAgain = set } },
                            onOpenSet: { navigate.go(.studySet(state.setId)) })
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.last?.content) {
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: messages.count) {
                withAnimation { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: quiz.state?.finished) {
                withAnimation { proxy.scrollTo("end", anchor: .bottom) }
            }
        }
        .environment(quiz)
        .sheet(item: $quizAgain) { QuizStartSheet(set: $0) }
        .overlay { if messages.isEmpty { emptyState } }
        .blur(radius: showingVoice ? 24 : 0)
        .safeAreaInset(edge: .bottom) { composer }
        .overlay {
            if showingVoice {
                VoiceView(call: call, space: callSpace)
                    .transition(.opacity)
            }
        }
        .navigationTitle(showingVoice ? "" : (title ?? ""))
        .kidUsing(store.actingKid)
        .toolbar {
            // In a call the bar stays put: the call button becomes hang-up, and
            // the camera takes the back button's place.
            if showingVoice {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Camera", systemImage: "camera.fill") { showingCallCamera = true }
                        .disabled(call?.state != .live)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Hang up", systemImage: "phone.down.fill") { endCall() }
                        .buttonStyle(.glassProminent)
                        .tint(.red)
                        .disabled(call?.state == .ending)
                }
            } else {
                if let state = quiz.state {
                    ToolbarItem(placement: .principal) { QuizProgress(state: state, startedAt: testStartedAt) }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Call Tuttles", systemImage: "phone.fill") { startCall() }
                        .disabled(sending || (isQuiz && quiz.state == nil))
                }
                if let state = quiz.state, !state.finished {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("End quiz", systemImage: "flag.checkered") { endQuiz() }
                        } label: { Image(systemName: "ellipsis") }
                    }
                }
            }
        }
        .toolbarColorScheme(showingVoice ? .dark : nil, for: .navigationBar)
        .navigationBarBackButtonHidden(showingVoice)
        .fullScreenCover(isPresented: $showingCallCamera) {
            CameraView(onDone: { _ in }, onShot: { photo in call?.send(photo: photo) })
        }
        .preferredColorScheme(callIsDark ? .dark : nil)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            quiz.choose = { q, i in choose(q, i) }
            // A quiz starts itself: the plan is made, then the first question asked.
            if let quizStart, isNew, messages.isEmpty, quiz.state == nil {
                do {
                    quiz.state = try await store.startQuiz(threadID: threadID, quizStart)
                    if quizStart.mode == "test" { testStartedAt = .now }
                    draft = "Let's go! (\(quizStart.mode == "test" ? "Test run" : "Practice"), \(quizStart.count) questions)"
                    send()
                    await store.refreshThreads()
                } catch {
                    startError = "Couldn't start the quiz: \(error.localizedDescription)"
                }
                return
            }
            // A briefing starts itself: the parent tapped "Brief me".
            if let briefing, isNew, messages.isEmpty, !sending {
                draft = "Brief me on \(briefing.title)."
                send()
                return
            }
            if let text = start?.autoSend, messages.isEmpty {
                start?.autoSend = nil
                draft = text
                send()
                return
            }
            guard !isNew, messages.isEmpty else { return }
            do { messages = try await store.messages(in: threadID) } catch { loadError = "Couldn't load this chat." }
        }
        .task(id: isQuiz) {
            // Known to be a quiz once the chat list has it (it may load after this opens).
            if isQuiz, !isNew, quiz.state == nil { await refreshQuiz() }
        }
        .task(id: testStartedAt) {
            // A test run's time is up: Tuttles goes over it.
            guard let started = testStartedAt, let state = quiz.state else { return }
            try? await Task.sleep(for: .seconds(max(0, QuizProgress.limit(state) - Date().timeIntervalSince(started))))
            guard !Task.isCancelled, quiz.state?.finished == false else { return }
            while sending { try? await Task.sleep(for: .milliseconds(300)) }
            quiz.state = try? await store.finishQuiz(threadID: threadID)
            draft = "Time's up!"
            send()
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraView { taken in
                photos.append(contentsOf: taken)
                if !taken.isEmpty { typing = true }
            }
        }
        .fullScreenCover(item: $viewing) { PhotoViewer(ref: $0) }
    }

    static let callMorph = Animation.smooth(duration: 0.5)

    private func startCall() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        typing = false
        call = VoiceCall(store: store, threadID: threadID, assignmentID: messages.isEmpty ? start?.assignment.id : nil,
                         quiz: isQuiz ? quiz : nil)
        withAnimation(Self.callMorph) { showingVoice = true }
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            if showingVoice { callIsDark = true }
        }
    }

    private func endCall() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task {
            await call?.hangUp()
            // Saved: bring the call into the chat before it shows again.
            if let saved = try? await store.messages(in: threadID) { messages = saved }
            if isQuiz { await refreshQuiz() }
            callIsDark = false
            withAnimation(Self.callMorph) { showingVoice = false }
            await store.refreshThreads()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image("Tuttles\(pose)")
                .resizable()
                .scaledToFit()
                .frame(height: start == nil ? 200 : 140)
            if let quizStart {
                Text(quizStart.setTitle).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
                if let startError {
                    Text(startError).foregroundStyle(.red).multilineTextAlignment(.center)
                } else {
                    Label("Getting your quiz ready…", systemImage: "checklist").foregroundStyle(.secondary)
                }
            } else if let start {
                AssignmentBanner(assignment: start.assignment, info: store.classInfo(start.assignment.courseId))
                Text("Snap the page, or say where you're stuck.")
                    .foregroundStyle(.secondary)
            } else {
                Text(loadError ?? "What are you working on?")
                    .font(.title3.weight(.semibold))
                if loadError == nil {
                    Text("Snap your homework or ask a question.")
                        .foregroundStyle(.secondary)
                }
                // The most pressing study set, a tap from a quiz.
                if isNew, let set = store.study?.sets.first(where: { $0.isSoon && !$0.topics.isEmpty }) {
                    StudyNudge(set: set)
                        .padding(.top, 10)
                        .padding(.horizontal, 24)
                }
                if isNew, let soon = store.classes?.dueSoon.prefix(3), !soon.isEmpty {
                    VStack(spacing: 8) {
                        ForEach(Array(soon)) { a in
                            Button {
                                withAnimation(.snappy) { start = ChatStart(assignment: a) }
                            } label: {
                                SuggestionRow(assignment: a, info: store.classInfo(a.courseId))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 10)
                    .padding(.horizontal, 24)
                }
            }
        }
        .padding(.bottom, 40)
    }

    // MARK: - Writing

    private var canSend: Bool {
        !sending && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !photos.isEmpty)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let sendError {
                Label(sendError, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 6)
            }
            if talk.mode == .holding {
                Text("Release to send")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .transition(.opacity)
            }
            if !photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(photos) { photo in
                            Image(uiImage: photo.image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 60, height: 78)
                                .clipShape(.rect(cornerRadius: 12))
                                .overlay(alignment: .topTrailing) {
                                    Button {
                                        withAnimation { photos.removeAll { $0.id == photo.id } }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, .black.opacity(0.55))
                                    }
                                    .offset(x: 5, y: -5)
                                    .accessibilityLabel("Remove photo")
                                }
                        }
                    }
                    .padding(.top, 6)
                    .padding(.horizontal, 6)
                }
            }
            if showingVoice {
                // Holds the box's place so the chat doesn't shift behind the call.
                Color.clear.frame(height: 48)
            } else {
            HStack(alignment: .bottom, spacing: 10) {
                Button {
                    typing = false
                    showingCamera = true
                } label: {
                    Image(systemName: "camera.fill")
                        .font(.title3)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Camera")

                HStack(alignment: .bottom, spacing: 6) {
                    if talk.isActive {
                        RecordingStrip(recorder: talk) {
                            Task { await talk.cancel() }
                        } onStop: {
                            Task {
                                if let audio = await talk.finish() { transcribe(audio, send: false) }
                            }
                        }
                    } else if transcribing {
                        Label("Writing it out…", systemImage: "waveform")
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 10)
                            .padding(.leading, 16)
                        Spacer()
                    } else {
                        TextField("Ask Tuttles", text: $draft, axis: .vertical)
                            .lineLimit(1...6)
                            .focused($typing)
                            .padding(.vertical, 10)
                            .padding(.leading, 16)
                    }
                    // Nothing typed: talk instead (tap, or hold and let go to send).
                    if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !sending, !transcribing {
                        TalkButton(recorder: talk) { audio in transcribe(audio, send: true) }
                    } else {
                        Button(action: send) {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                                .frame(width: 22, height: 22)
                        }
                        .buttonStyle(.glassProminent)
                        .buttonBorderShape(.circle)
                        .disabled(!canSend)
                        .padding(4)
                        .accessibilityLabel("Send")
                    }
                }
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
                .matchedGeometryEffect(id: "talkBar", in: callSpace)
            }
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 6)
        .animation(.snappy, value: talk.mode)
    }

    /// Write out what was said, then either send it (with any photos queued)
    /// or leave it in the box to edit.
    private func transcribe(_ audio: Data, send shouldSend: Bool) {
        transcribing = true
        sendError = nil
        Task {
            do {
                let text = try await store.transcribe(audio)
                transcribing = false
                guard !text.isEmpty else { return }
                draft = text
                if shouldSend { send() } else { typing = true }
            } catch {
                transcribing = false
                sendError = "Didn't catch that: \(error.localizedDescription)"
            }
        }
    }

    private func send() {
        guard canSend else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sent = photos
        let student = ChatMessage(id: UUID(), role: .student, content: text, photos: sent)
        let reply = ChatMessage(id: UUID(), role: .tutor, content: "", streaming: true)
        withAnimation(.snappy) {
            messages.append(student)
            messages.append(reply)
        }
        draft = ""
        photos = []
        sending = true
        sendError = nil

        Task {
            do {
                let isFirst = messages.count <= 2
                try await store.send(
                    threadID: threadID, text: text, photos: sent,
                    assignmentID: isFirst ? start?.assignment.id : nil,
                    briefing: isFirst ? briefing : nil
                ) { soFar in
                    if let at = messages.firstIndex(where: { $0.id == reply.id }) { messages[at].content = soFar }
                }
                if let at = messages.firstIndex(where: { $0.id == reply.id }) { messages[at].streaming = false }
                if isQuiz { await refreshQuiz() }
                // A set made or changed in the chat: its card needs it.
                if text.isEmpty == false, messages.last?.content.contains("```studyset") == true { await store.refreshStudy() }
                // Started from a class page: file it there.
                if isFirst, start == nil, let courseID {
                    await store.setCourse(TutorThread(id: threadID, updatedAt: .now), to: courseID)
                }
            } catch {
                // Nothing was saved, so the turn comes back to the box to send again.
                withAnimation {
                    messages.removeAll { $0.id == reply.id || $0.id == student.id }
                }
                if draft.isEmpty { draft = text }
                photos = sent + photos
                sendError = "Didn't send: \(error.localizedDescription)"
            }
            sending = false
        }
    }
}

// MARK: - Quizzes

extension ChatView {
    private func refreshQuiz() async {
        if let state = try? await store.quizState(threadID: threadID) {
            withAnimation(.snappy) { quiz.state = state }
            if state.finished { await store.refreshStudy() }
        }
    }

    /// A tap on a multiple choice option: graded on the website, then said in the chat.
    private func choose(_ q: QuizQuestion, _ index: Int) {
        guard !sending, quiz.pending == nil, let choices = q.choices, choices.indices.contains(index) else { return }
        quiz.pending = .init(id: q.id, index: index)
        Task {
            do {
                let reply = try await store.answerQuiz(threadID: threadID, questionID: q.id, choice: index)
                withAnimation(.snappy) { quiz.state = reply.state }
                quiz.pending = nil
                draft = "\(String(UnicodeScalar(65 + index)!)). \(choices[index])"
                send()
            } catch {
                quiz.pending = nil
                sendError = "Didn't send: \(error.localizedDescription)"
            }
        }
    }

    private func endQuiz() {
        Task {
            guard let state = try? await store.finishQuiz(threadID: threadID) else { return }
            withAnimation(.snappy) { quiz.state = state }
            // Tuttles wraps up what was done.
            if !sending, !messages.isEmpty {
                draft = "Let's stop here."
                send()
            }
            await store.refreshStudy()
        }
    }
}

// MARK: - Assignments

/// What a chat opened from an assignment is about, above the first message.
private struct AssignmentBanner: View {
    let assignment: ClassAssignment
    let info: ClassInfo?

    var body: some View {
        VStack(spacing: 6) {
            if let info { ClassLabel(info: info) }
            Text(assignment.name)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
            Text(assignment.status == .missing ? "was due \(assignment.dueText)" : "due \(assignment.dueText)")
                .font(.subheadline)
                .foregroundStyle(assignment.status == .missing ? .red : .secondary)
        }
        .padding(.horizontal, 24)
    }
}

/// One of the "working on this?" suggestions on a new chat.
private struct SuggestionRow: View {
    let assignment: ClassAssignment
    let info: ClassInfo?

    var body: some View {
        HStack(spacing: 10) {
            if let info { ClassLabel(info: info) }
            Text(assignment.name)
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(assignment.dueText)
                .font(.caption)
                .foregroundStyle(assignment.status == .missing ? .red : .secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .glassEffect(.regular.interactive(), in: .capsule)
    }
}

// MARK: - Messages

private struct StudentMessage: View {
    let message: ChatMessage
    @Binding var viewing: PhotoRef?

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if !message.photos.isEmpty || !message.imagePaths.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(message.photos) { photo in
                            Button { viewing = .local(photo.image) } label: { Thumb(image: photo.image) }
                        }
                        ForEach(message.imagePaths, id: \.self) { path in
                            RemoteThumb(path: path, viewing: $viewing)
                        }
                    }
                }
                .defaultScrollAnchor(.trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            if !message.content.isEmpty {
                Text(message.content)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemFill), in: .rect(cornerRadius: 20))
                    .frame(maxWidth: 300, alignment: .trailing)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

private struct TutorMessage: View {
    let message: ChatMessage

    var body: some View {
        if message.streaming && message.content.isEmpty {
            ThinkingDots()
        } else {
            MessageContent(text: message.content)
                .textSelection(.enabled)
        }
    }
}

private struct ThinkingDots: View {
    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 5) {
                ForEach(0..<3) { i in
                    Circle()
                        .frame(width: 8, height: 8)
                        .opacity(0.3 + 0.7 * max(0, sin(t * 5 - Double(i) * 0.7)))
                }
            }
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .accessibilityLabel("Tuttles is thinking")
    }
}

private struct Thumb: View {
    let image: UIImage?
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Rectangle().fill(.quaternary)
            }
        }
        .frame(width: 96, height: 128)
        .clipShape(.rect(cornerRadius: 14))
    }
}

private struct RemoteThumb: View {
    let path: String
    @Binding var viewing: PhotoRef?
    @Environment(ChatStore.self) private var store
    @State private var image: UIImage?

    var body: some View {
        Button { if let image { viewing = .local(image) } } label: { Thumb(image: image) }
            .task { image = await store.photo(at: path) }
    }
}

enum PhotoRef: Identifiable {
    case local(UIImage)
    var id: ObjectIdentifier {
        switch self { case .local(let image): ObjectIdentifier(image) }
    }
}

private struct PhotoViewer: View {
    let ref: PhotoRef
    @Environment(\.dismiss) private var dismiss
    @State private var zoom: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if case .local(let image) = ref {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(zoom)
                    .gesture(MagnifyGesture().onChanged { zoom = max(1, $0.magnification) }.onEnded { _ in
                        withAnimation { zoom = 1 }
                    })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button("Done") { dismiss() }
                .buttonStyle(.glass)
                .padding()
        }
    }
}
