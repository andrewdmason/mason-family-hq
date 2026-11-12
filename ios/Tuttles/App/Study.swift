import Foundation
import MasonKit
import Supabase
import SwiftUI

// Study sets and quizzes (src/lib/tuttles/study.ts): something coming up,
// split into topics, with how well each is known worked out on the website
// from every quiz answer. The phone only draws it and relays answers; it never
// sees a question's answer before it's been answered.

// MARK: - What the website sends

enum StudyLevel: String, Codable, CaseIterable, Hashable {
    case new, learning, shaky, solid, mastered

    var label: String {
        switch self {
        case .new: "New"
        case .learning: "Learning"
        case .shaky: "Shaky"
        case .solid: "Solid"
        case .mastered: "Mastered"
        }
    }

    var step: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    var tint: Color {
        switch self {
        case .new: .gray
        case .learning: .orange
        case .shaky: .yellow
        case .solid: .green
        case .mastered: .blue
        }
    }

    var symbol: String {
        switch self {
        case .new: "circle.dashed"
        case .learning: "circle.bottomhalf.filled"
        case .shaky: "circle.lefthalf.filled"
        case .solid: "checkmark.circle.fill"
        case .mastered: "star.circle.fill"
        }
    }
}

struct StudySet: Decodable, Identifiable, Hashable {
    struct Overall: Decodable, Hashable {
        let level: StudyLevel
        let ready: Int
        let total: Int
        let note: String?
    }
    struct Topic: Decodable, Hashable, Identifiable {
        let id: String
        let name: String
        let weight: Int
        let level: StudyLevel
        let asked: Int
        let right: Int
        let lastSeen: Date?
    }
    let id: String
    let title: String
    let courseId: Int?
    let testDate: String?
    let daysLeft: Int?
    let coverage: String
    let coverageNote: String?
    let createdByParent: Bool
    let overall: Overall
    let topics: [Topic]
    let quizzes: Int
    let lastQuizAt: Date?

    /// "today", "tomorrow", "Fri", "Nov 30", or nil without a date.
    var whenText: String? {
        guard let testDate, let date = Self.day.date(from: testDate) else { return nil }
        guard let days = daysLeft else { return date.formatted(.dateTime.month(.abbreviated).day()) }
        if days < 0 { return "was \(date.formatted(.dateTime.month(.abbreviated).day()))" }
        if days == 0 { return "today" }
        if days == 1 { return "tomorrow" }
        if days < 7 { return date.formatted(.dateTime.weekday(.wide)) }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    var date: Date? { testDate.flatMap { Self.day.date(from: $0) } }

    /// The test is within a week (or today).
    var isSoon: Bool { (daysLeft ?? 99) >= 0 && (daysLeft ?? 99) <= 7 }

    /// "Ready for 5 of 7 topics", or what to do first.
    var readyText: String {
        if overall.total == 0 { return "No topics yet" }
        if overall.level == .new { return "\(overall.total) topics · not quizzed yet" }
        return "Ready for \(overall.ready) of \(overall.total) topics"
    }

    var needsMaterial: Bool { coverage != "good" }

    static let day: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

/// An upcoming Canvas quiz or test without a set yet.
struct StudySuggestion: Decodable, Identifiable, Hashable {
    let assignmentId: Int
    let courseId: Int
    let name: String
    let dueAt: Date?
    var id: Int { assignmentId }
}

struct StudyPayload: Decodable {
    let studentId: String?
    let sets: [StudySet]
    let suggestions: [StudySuggestion]?
}

struct StudySetDetail: Decodable {
    struct Source: Decodable, Identifiable, Hashable {
        let id: String
        let kind: String
        let body: String
        let imagePath: String?
        let createdAt: Date
    }
    struct QuizSummary: Decodable, Identifiable, Hashable {
        let threadId: UUID
        let createdAt: Date
        let mode: String
        let count: Int
        let finished: Bool
        let right: Int
        let answered: Int
        let byParent: Bool
        var id: UUID { threadId }
    }
    let set: StudySet?
    let format: String?
    let sources: [Source]
    let quizzes: [QuizSummary]
}

/// A quiz question as the phone may see it: the answer only once it's earned.
struct QuizQuestion: Decodable, Hashable, Identifiable {
    let id: String
    let number: Int
    let of: Int?
    let topic: String?
    let kind: String
    let prompt: String
    let choices: [String]?
    var answered: Bool = false
    var chosenIndex: Int?
    var result: String?
    var answerIndex: Int?
    var answer: String?

    var isChoice: Bool { (choices?.count ?? 0) >= 2 }

    /// From a ```question block in a saved chat (no answer in it).
    init?(block json: String) {
        guard let data = json.data(using: .utf8),
              let q = try? JSONDecoder().decode(QuizQuestion.self, from: data) else { return nil }
        self = q
    }

    enum CodingKeys: String, CodingKey {
        case id, number, of, topic, kind, prompt, choices, answered, chosenIndex, result, answerIndex, answer
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        number = try c.decodeIfPresent(Int.self, forKey: .number) ?? 0
        of = try c.decodeIfPresent(Int.self, forKey: .of)
        topic = try c.decodeIfPresent(String.self, forKey: .topic)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "short"
        prompt = try c.decodeIfPresent(String.self, forKey: .prompt) ?? ""
        choices = try c.decodeIfPresent([String].self, forKey: .choices)
        answered = try c.decodeIfPresent(Bool.self, forKey: .answered) ?? false
        chosenIndex = try c.decodeIfPresent(Int.self, forKey: .chosenIndex)
        result = try c.decodeIfPresent(String.self, forKey: .result)
        answerIndex = try c.decodeIfPresent(Int.self, forKey: .answerIndex)
        answer = try c.decodeIfPresent(String.self, forKey: .answer)
    }
}

struct QuizState: Decodable, Equatable {
    struct Recap: Decodable, Equatable {
        struct TopicMove: Decodable, Equatable, Identifiable {
            let name: String
            let before: StudyLevel
            let after: StudyLevel
            let right: Int
            let asked: Int
            var id: String { name }
        }
        let right: Int
        let answered: Int
        let topics: [TopicMove]
        let overall: StudySet.Overall
    }
    let setId: String
    let setTitle: String
    let mode: String
    let count: Int
    let finished: Bool
    let questions: [QuizQuestion]
    let recap: Recap?

    var isTestRun: Bool { mode == "test" }
    var answeredCount: Int { questions.filter(\.answered).count }
    /// The newest question still waiting for an answer.
    var open: QuizQuestion? { questions.last.flatMap { $0.answered ? nil : $0 } }
}

/// How a quiz is started from a set.
struct QuizStart: Hashable {
    let setID: String
    let setTitle: String
    var mode: String = "practice"
    var count: Int = 10
}

// MARK: - Getting it

extension ChatStore {
    func refreshStudy() async {
        if isDemo {
            study = DemoChats.study
            return
        }
        guard let data = try? await get("tuttles/api/study"),
              let payload = try? Self.decoder.decode(StudyPayload.self, from: data) else { return }
        study = payload
    }

    func studySet(_ id: String) -> StudySet? { study?.sets.first { $0.id == id } }

    func studyDetail(_ id: String) async throws -> StudySetDetail {
        if isDemo { return DemoChats.studyDetail(id) }
        return try Self.decoder.decode(StudySetDetail.self, from: try await get("tuttles/api/study/\(id)"))
    }

    /// Changes a set (rename, date, take a topic off, put away) and returns it as it is now.
    @discardableResult
    func updateStudySet(_ id: String, _ change: [String: Any]) async throws -> StudySet? {
        if isDemo { return studySet(id) }
        struct Reply: Decodable { let set: StudySet? }
        let data = try await send("PATCH", "tuttles/api/study/\(id)", json: change)
        let set = try Self.decoder.decode(Reply.self, from: data).set
        await refreshStudy()
        return set
    }

    /// Uploads photos for a set into the kid's folder, returning their paths.
    func uploadStudyPhotos(_ photos: [ChatPhoto]) async throws -> [String] {
        if isDemo { return [] }
        if study?.studentId == nil { await refreshStudy() }
        guard let kid = study?.studentId else { throw SendError.notSignedIn }
        var paths: [String] = []
        for photo in photos {
            let path = "\(kid)/study/\(photo.id.uuidString.lowercased()).jpg"
            _ = try await client.storage.from("tuttles")
                .upload(path, data: photo.jpeg, options: FileOptions(contentType: "image/jpeg", upsert: true))
            rememberPhoto(photo.image, at: path)
            paths.append(path)
        }
        return paths
    }

    /// More material for a set: Tuttles reads it into the set before this returns.
    func addMaterial(to id: String, note: String, photos: [ChatPhoto]) async throws {
        if isDemo { try await Task.sleep(for: .seconds(1)); return }
        let paths = try await uploadStudyPhotos(photos)
        _ = try await post("tuttles/api/study/\(id)/sources", json: ["note": note, "images": paths])
        await refreshStudy()
    }

    /// A new set from the form (a parent's, or the kid's outside a chat).
    func createStudySet(title: String, courseID: Int?, testDate: Date?, note: String, photos: [ChatPhoto],
                        template: String?) async throws -> StudySet? {
        if isDemo { try await Task.sleep(for: .seconds(1)); return DemoChats.study.sets.first }
        let paths = try await uploadStudyPhotos(photos)
        var body: [String: Any] = ["title": title, "note": note, "images": paths]
        if let courseID { body["courseId"] = courseID }
        if let testDate { body["testDate"] = StudySet.day.string(from: testDate) }
        if let template { body["template"] = template }
        struct Reply: Decodable { let set: StudySet? }
        let set = try Self.decoder.decode(Reply.self, from: try await post("tuttles/api/study", json: body)).set
        await refreshStudy()
        return set
    }

    // MARK: Quizzes

    func startQuiz(threadID: UUID, _ start: QuizStart) async throws -> QuizState {
        if isDemo { return DemoChats.quizState(start) }
        let data = try await post("tuttles/api/quiz/start", json: [
            "threadId": threadID.uuidString.lowercased(), "setId": start.setID, "mode": start.mode, "count": start.count,
        ])
        return try Self.decoder.decode(QuizState.self, from: data)
    }

    func quizState(threadID: UUID) async throws -> QuizState {
        if isDemo { return DemoChats.quizState(QuizStart(setID: "demo-cells", setTitle: "Science quiz: cells")) }
        return try Self.decoder.decode(QuizState.self, from: try await get("tuttles/api/quiz/\(threadID.uuidString.lowercased())"))
    }

    func finishQuiz(threadID: UUID) async throws -> QuizState {
        if isDemo { return DemoChats.quizState(QuizStart(setID: "demo-cells", setTitle: "Science quiz: cells"), finished: true) }
        return try Self.decoder.decode(QuizState.self, from: try await post("tuttles/api/quiz/\(threadID.uuidString.lowercased())", json: ["finish": true]))
    }

    struct QuizAnswerReply: Decodable { let state: QuizState; let note: String }

    /// An answer to a quiz question: a tapped choice, or what the voice tutor recorded.
    func answerQuiz(threadID: UUID, questionID: String?, choice: Any? = nil, result: String? = nil,
                    response: String? = nil) async throws -> QuizAnswerReply {
        var body: [String: Any] = ["threadId": threadID.uuidString.lowercased()]
        if let questionID { body["questionId"] = questionID }
        if let choice { body["choice"] = choice }
        if let result { body["result"] = result }
        if let response { body["response"] = response }
        if isDemo { return DemoChats.answer(body) }
        return try Self.decoder.decode(QuizAnswerReply.self, from: try await post("tuttles/api/quiz/answer", json: body))
    }

    struct VoiceQuestionReply: Decodable { let question: QuizQuestion; let block: String; let state: QuizState }

    /// A question the voice tutor asked, saved and handed back without its answer.
    func voiceQuestion(threadID: UUID, arguments: [String: Any]) async throws -> VoiceQuestionReply {
        try Self.decoder.decode(VoiceQuestionReply.self, from: try await post("tuttles/api/quiz/question", json: [
            "threadId": threadID.uuidString.lowercased(), "question": arguments,
        ]))
    }

    struct VoiceSetReply: Decodable { let set: StudySet?; let block: String; let note: String }

    /// A study set the voice tutor saved.
    func voiceStudySet(threadID: UUID, set: String, assignmentID: Int?, images: [String]) async throws -> VoiceSetReply {
        var body: [String: Any] = ["threadId": threadID.uuidString.lowercased(), "set": set, "images": images]
        if let assignmentID { body["assignmentId"] = assignmentID }
        let reply = try Self.decoder.decode(VoiceSetReply.self, from: try await post("tuttles/api/study/save", json: body))
        await refreshStudy()
        return reply
    }

    // MARK: Requests

    func get(_ route: String) async throws -> Data {
        let token = try await client.auth.session.accessToken
        var request = URLRequest(url: Self.websiteURL.appending(path: route))
        request.timeoutInterval = 60
        authorize(&request, token: token)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw SendError.server(message ?? "Tuttles couldn't be reached.")
        }
        return data
    }

    private func send(_ method: String, _ route: String, json: [String: Any]) async throws -> Data {
        let token = try await client.auth.session.accessToken
        var request = URLRequest(url: Self.websiteURL.appending(path: route))
        request.httpMethod = method
        request.timeoutInterval = 60
        authorize(&request, token: token)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: json)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw SendError.server(message ?? "Tuttles couldn't be reached.")
        }
        return data
    }
}

/// Going somewhere in the app from deep inside a view (a card in a message):
/// the chats' navigation stack, handed down.
struct TuttlesNavigate {
    var go: (Route) -> Void = { _ in }
}

extension EnvironmentValues {
    @Entry var navigate = TuttlesNavigate()
}
