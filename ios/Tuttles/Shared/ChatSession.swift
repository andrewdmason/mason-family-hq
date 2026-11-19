import Foundation
import Observation
import SwiftUI

/// One chat while it's open: what's been said, the message being written, and
/// the rules of sending it. The iPhone's ChatView and the Mac's MacChatView
/// both draw this, so a turn goes the same way from either.
@MainActor
@Observable
final class ChatSession {
    let store: ChatStore
    let threadID: UUID
    let isNew: Bool
    /// For a new chat: the class page it was started from, to file it under.
    let courseID: Int?
    /// For a new parent's chat: the kid's topic it briefs them on.
    let briefing: BriefingTopic?
    /// For a new quiz: the set and how it's run (Study.swift).
    let quizStart: QuizStart?
    /// For a new chat: the assignment it's about. The first message carries it.
    var start: ChatStart?

    var messages: [ChatMessage] = []
    var draft = ""
    var photos: [ChatPhoto] = []
    var files: [ChatFile] = []
    var sending = false
    var loadError: String?
    var sendError: String?
    var startError: String?
    /// A quiz chat's questions and how they went, for its cards.
    let quiz = QuizContext()
    /// When a test run began here, for its clock.
    var testStartedAt: Date?

    init(store: ChatStore, threadID: UUID, isNew: Bool, courseID: Int? = nil, briefing: BriefingTopic? = nil,
         quizStart: QuizStart? = nil, start: ChatStart? = nil) {
        self.store = store
        self.threadID = threadID
        self.isNew = isNew
        self.courseID = courseID
        self.briefing = briefing
        self.quizStart = quizStart
        self.start = start
    }

    var isQuiz: Bool { quizStart != nil || store.threads.first { $0.id == threadID }?.isQuiz == true }

    var canSend: Bool {
        !sending && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !photos.isEmpty || !files.isEmpty)
    }

    /// When the chat comes on screen: a quiz, a briefing or a chat about an
    /// assignment starts itself; an earlier chat loads what was said.
    func open() async {
        quiz.choose = { [weak self] q, i in self?.choose(q, i) }
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

    /// What was saved, again: after a call, which is written into the chat.
    func reload() async {
        if let saved = try? await store.messages(in: threadID) { messages = saved }
        if isQuiz { await refreshQuiz() }
    }

    func send() {
        guard canSend else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sent = photos
        let sentFiles = files
        let student = ChatMessage(id: UUID(), role: .student, content: text, photos: sent, files: sentFiles)
        let reply = ChatMessage(id: UUID(), role: .tutor, content: "", streaming: true)
        withAnimation(.snappy) {
            messages.append(student)
            messages.append(reply)
        }
        draft = ""
        photos = []
        files = []
        sending = true
        sendError = nil

        Task {
            do {
                let isFirst = messages.count <= 2
                try await store.send(
                    threadID: threadID, text: text, photos: sent, files: sentFiles,
                    assignmentID: isFirst ? start?.assignment.id : nil,
                    briefing: isFirst ? briefing : nil
                ) { [weak self] soFar in
                    guard let self, let at = self.messages.firstIndex(where: { $0.id == reply.id }) else { return }
                    self.messages[at].content = soFar
                }
                if let at = messages.firstIndex(where: { $0.id == reply.id }) { messages[at].streaming = false }
                if isQuiz { await refreshQuiz() }
                // A set made or changed in the chat: its card needs it.
                if text.isEmpty == false, messages.last?.content.contains("```studyset") == true { await store.refreshStudy() }
                // Started from a class page: file it there.
                if isFirst, start == nil, let courseID {
                    await store.setCourse(TutorThread(id: threadID, updatedAt: .now), to: courseID)
                }
                // A new chat is in the list, with its title, once its first turn is saved.
                if isFirst { await store.refreshThreads() }
            } catch {
                // Nothing was saved, so the turn comes back to the box to send again.
                withAnimation {
                    messages.removeAll { $0.id == reply.id || $0.id == student.id }
                }
                if draft.isEmpty { draft = text }
                photos = sent + photos
                files = sentFiles + files
                sendError = "Didn't send: \(error.localizedDescription)"
            }
            sending = false
        }
    }

    // MARK: - Quizzes

    func refreshQuiz() async {
        if let state = try? await store.quizState(threadID: threadID) {
            withAnimation(.snappy) { quiz.state = state }
            if state.finished { await store.refreshStudy() }
        }
    }

    /// A multiple choice option picked: graded on the website, then said in the chat.
    func choose(_ q: QuizQuestion, _ index: Int) {
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

    func endQuiz() {
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

    /// A test run's time is up: Tuttles goes over it. Waits out the clock, so
    /// it's run as a task that's cancelled when the chat closes.
    func runTestClock() async {
        guard let started = testStartedAt, let state = quiz.state else { return }
        try? await Task.sleep(for: .seconds(max(0, QuizProgress.limit(state) - Date().timeIntervalSince(started))))
        guard !Task.isCancelled, quiz.state?.finished == false else { return }
        while sending { try? await Task.sleep(for: .milliseconds(300)) }
        quiz.state = try? await store.finishQuiz(threadID: threadID)
        draft = "Time's up!"
        send()
    }
}
