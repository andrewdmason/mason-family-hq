import SwiftUI

/// One chat: the conversation, and the message being written with the camera
/// beside it.
struct ChatView: View {
    let title: String?
    /// What's been said and what's being written (Shared/ChatSession.swift).
    @State private var chat: ChatSession

    @Environment(ChatStore.self) private var store
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
    @State private var quizAgain: StudySet?
    @Environment(\.navigate) private var navigate
    /// The chat at the bottom of the stack has the menu button where a back button would be.
    var menuButton = false
    @Environment(SideMenuState.self) private var menu: SideMenuState?

    init(store: ChatStore, threadID: UUID, isNew: Bool, title: String?, courseID: Int? = nil, briefing: BriefingTopic? = nil,
         quizStart: QuizStart? = nil, start: ChatStart? = nil, menuButton: Bool = false) {
        self.title = title
        self.menuButton = menuButton
        _chat = State(initialValue: ChatSession(store: store, threadID: threadID, isNew: isNew, courseID: courseID,
                                                briefing: briefing, quizStart: quizStart, start: start))
    }

    /// Study sets whose test hasn't happened yet and that have topics to quiz, most pressing first.
    private var activeSets: [StudySet] {
        Array((store.study?.sets ?? []).filter { ($0.daysLeft ?? 0) >= 0 && !$0.topics.isEmpty }.prefix(3))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
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
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
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
        .overlay { if chat.messages.isEmpty { emptyState } }
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
                if menuButton {
                    ToolbarItem(placement: .topBarLeading) { MenuToolbarButton() }
                }
                if let state = chat.quiz.state {
                    ToolbarItem(placement: .principal) { QuizProgress(state: state, startedAt: chat.testStartedAt) }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Call Tuttles", systemImage: "phone.fill") { startCall() }
                        .disabled(chat.sending || (chat.isQuiz && chat.quiz.state == nil))
                }
                if let state = chat.quiz.state, !state.finished {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("End quiz", systemImage: "flag.checkered") { chat.endQuiz() }
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
        // No sliding the menu open in the middle of a call.
        .onChange(of: showingVoice) { if menuButton { menu?.locked = showingVoice } }
        .navigationBarTitleDisplayMode(.inline)
        .task { await chat.open() }
        .task(id: chat.isQuiz) {
            // Known to be a quiz once the chat list has it (it may load after this opens).
            if chat.isQuiz, !chat.isNew, chat.quiz.state == nil { await chat.refreshQuiz() }
        }
        .task(id: chat.testStartedAt) { await chat.runTestClock() }
        .cover(item: $viewing) { PhotoViewer(ref: $0) }
    }

    static let callMorph = Animation.smooth(duration: 0.5)

    private func startCall() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        typing = false
        call = VoiceCall(store: store, threadID: chat.threadID, assignmentID: chat.messages.isEmpty ? chat.start?.assignment.id : nil,
                         quiz: chat.isQuiz ? chat.quiz : nil, chat: chat.messages)
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
            await chat.reload()
            callIsDark = false
            withAnimation(Self.callMorph) { showingVoice = false }
            await store.refreshThreads()
        }
    }

    /// The greeting, at the most that fits above the message box. With the
    /// keyboard up, photos waiting and a long message there's little room, and
    /// it gives way (a smaller Tuttles, then none, then just the words) rather
    /// than run under the title bar and the box.
    private var emptyState: some View {
        ViewThatFits(in: .vertical) {
            greeting(tuttles: chat.start == nil ? 200 : 140)
            greeting(tuttles: 96)
            greeting(tuttles: nil)
            greeting(tuttles: nil, nudges: false)
            Color.clear.frame(height: 0)
        }
    }

    private func greeting(tuttles: CGFloat?, nudges: Bool = true) -> some View {
        VStack(spacing: 14) {
            if let tuttles {
                Image("Tuttles\(pose)")
                    .resizable()
                    .scaledToFit()
                    .frame(height: tuttles)
            }
            if let quizStart = chat.quizStart {
                Text(quizStart.setTitle).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
                if let startError = chat.startError {
                    Text(startError).foregroundStyle(.red).multilineTextAlignment(.center)
                } else {
                    Label("Getting your quiz ready…", systemImage: "checklist").foregroundStyle(.secondary)
                }
            } else if let start = chat.start {
                AssignmentBanner(assignment: start.assignment, info: store.classInfo(start.assignment.courseId))
                Text("Snap the page, or say where you're stuck.")
                    .foregroundStyle(.secondary)
            } else {
                Text(chat.loadError ?? "What are you working on?")
                    .font(.title3.weight(.semibold))
                if chat.loadError == nil {
                    Text("Snap your homework or ask a question.")
                        .foregroundStyle(.secondary)
                }
                // The tests coming up, each a tap from a quiz.
                if nudges, chat.isNew, !activeSets.isEmpty {
                    VStack(spacing: 8) {
                        ForEach(activeSets) { StudyNudge(set: $0) }
                    }
                    .padding(.top, 10)
                    .padding(.horizontal, 24)
                }
            }
        }
        .padding(.bottom, tuttles == nil ? 12 : 40)
    }

    // MARK: - Writing

    private var composer: some View {
        @Bindable var chat = chat
        return VStack(alignment: .leading, spacing: 8) {
            if let sendError = chat.sendError {
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
            if !chat.photos.isEmpty || !chat.files.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(chat.files) { file in
                            FileChip(file: file) {
                                withAnimation { chat.files.removeAll { $0.id == file.id } }
                            }
                        }
                        ForEach(chat.photos) { photo in
                            Image(uiImage: photo.image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 60, height: 78)
                                .clipShape(.rect(cornerRadius: 12))
                                .overlay(alignment: .topTrailing) {
                                    Button {
                                        withAnimation { chat.photos.removeAll { $0.id == photo.id } }
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
                AttachMenu(photos: $chat.photos, files: $chat.files) {
                    typing = false
                } onAdded: {
                    typing = true
                } onProblem: { problem in
                    chat.sendError = problem
                } label: {
                    Image(systemName: "plus")
                        .font(.title3.weight(.medium))
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Add photos or files")

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
                        TextField("Ask Tuttles", text: $chat.draft, axis: .vertical)
                            .lineLimit(1...6)
                            .focused($typing)
                            .padding(.vertical, 10)
                            .padding(.leading, 16)
                    }
                    // Nothing typed: talk instead (tap, or hold and let go to send).
                    if chat.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !chat.sending, !transcribing {
                        TalkButton(recorder: talk) { audio in transcribe(audio, send: true) }
                    } else {
                        Button(action: chat.send) {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                                .frame(width: 22, height: 22)
                        }
                        .buttonStyle(.glassProminent)
                        .buttonBorderShape(.circle)
                        .disabled(!chat.canSend)
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
        chat.sendError = nil
        Task {
            do {
                let text = try await store.transcribe(audio)
                transcribing = false
                guard !text.isEmpty else { return }
                chat.draft = text
                if shouldSend { chat.send() } else { typing = true }
            } catch {
                transcribing = false
                chat.sendError = "Didn't catch that: \(error.localizedDescription)"
            }
        }
    }
}
