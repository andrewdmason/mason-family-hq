import Foundation
import MasonKit
import Observation
import Supabase
import UIKit

/// A chat in the list.
struct TutorThread: Identifiable, Codable, Equatable {
    let id: UUID
    var title: String?
    var updatedAt: Date
    var archivedAt: Date?
    /// The class it's about (a Canvas course id), or nil.
    var courseId: Int?

    enum CodingKeys: String, CodingKey {
        case id, title
        case updatedAt = "updated_at"
        case archivedAt = "archived_at"
        case courseId = "course_id"
    }
}

/// A photo taken for the next message, before and after it's sent.
struct ChatPhoto: Identifiable, Equatable {
    let id: UUID
    /// What goes to the tutor: the long side at most 2048 points, as JPEG.
    let jpeg: Data
    let image: UIImage

    init?(_ image: UIImage) {
        let scaled = image.scaledDown(toFit: 2048)
        guard let jpeg = scaled.jpegData(compressionQuality: 0.8) else { return nil }
        id = UUID()
        self.jpeg = jpeg
        self.image = scaled
    }
}

struct ChatMessage: Identifiable, Equatable {
    enum Role: String, Decodable { case student, tutor }

    let id: UUID
    let role: Role
    var content: String
    /// Paths in the tuttles bucket, for a message loaded from the server.
    var imagePaths: [String] = []
    /// Photos still on the phone, for a message sent from it.
    var photos: [ChatPhoto] = []
    /// The reply is still arriving.
    var streaming = false
}

/// Everything the app reads and writes: the student's threads, read straight
/// from Supabase, and chat turns, sent through the website's chat route
/// (src/app/(tuttles)/tuttles/api/chat/route.ts), which streams the tutor's
/// reply back as plain text and saves the turn once it's finished.
@MainActor
@Observable
final class ChatStore {
    var threads: [TutorThread] = []
    var listError: String?
    /// The student's classes, from Canvas; nil until loaded or when there's no Canvas.
    var classes: ClassesPayload?

    func classInfo(_ courseID: Int?) -> ClassInfo? {
        guard let courseID else { return nil }
        return classes?.classes.first { $0.id == courseID }
    }

    /// Canned chats, with no sign-in or network: `--demo`, for the simulator.
    let isDemo = CommandLine.arguments.contains("--demo")

    private var client: SupabaseClient { Session.shared.client }

    /// False until the list has something to show: what this phone saved last
    /// time, or the first answer from the server. Until then it shows placeholders.
    private(set) var threadsLoaded = false
    private(set) var classesLoaded = false

    /// Shows what this phone saw last time straight away, so the list doesn't
    /// wait on the network to open; the refreshes replace it.
    func loadSaved() {
        guard !isDemo, let userID = Session.shared.userID else { return }
        if threads.isEmpty, let data = try? Data(contentsOf: Self.savedFile("threads", userID)),
           let saved = try? Self.decoder.decode([TutorThread].self, from: data) {
            threads = saved
            threadsLoaded = true
        }
        if classes == nil, let data = try? Data(contentsOf: Self.savedFile("classes", userID)),
           let saved = try? Self.decoder.decode(ClassesPayload.self, from: data) {
            classes = saved
            classesLoaded = true
        }
    }

    private static func savedFile(_ name: String, _ userID: UUID) -> URL {
        URL.cachesDirectory.appending(path: "tuttles-\(name)-\(userID.uuidString.lowercased()).json")
    }

    private func save(_ data: Data, as name: String) {
        guard let userID = Session.shared.userID else { return }
        try? data.write(to: Self.savedFile(name, userID), options: .atomic)
    }

    func refreshThreads() async {
        defer { threadsLoaded = true }
        if isDemo {
            // `--slow`: a first load that takes a while, to see the placeholders.
            if CommandLine.arguments.contains("--slow") { try? await Task.sleep(for: .seconds(4)) }
            threads = DemoChats.threads
            return
        }
        do {
            let fresh: [TutorThread] = try await client.from("tutor_threads")
                .select("id, title, updated_at, archived_at, course_id")
                .eq("student_id", value: Session.shared.userID?.uuidString.lowercased() ?? "")
                .is("archived_at", value: nil)
                .order("updated_at", ascending: false)
                .limit(200)
                .execute()
                .value
            if fresh != threads { threads = fresh }
            if let data = try? Self.encoder.encode(fresh) { save(data, as: "threads") }
            listError = nil
        } catch {
            listError = "Couldn't load your chats."
        }
    }

    func refreshClasses() async {
        defer { classesLoaded = true }
        if isDemo {
            // `--slow`: a first load that takes a while, to see the placeholders.
            if CommandLine.arguments.contains("--slow") { try? await Task.sleep(for: .seconds(4)) }
            classes = DemoChats.classes
            return
        }
        guard let token = try? await client.auth.session.accessToken else { return }
        var request = URLRequest(url: Self.websiteURL.appending(path: "tuttles/api/classes"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try? Self.decoder.decode(ClassesPayload.self, from: data) else { return }
        classes = payload
        save(data, as: "classes")
    }

    /// Files a chat under another class (nil: none).
    func setCourse(_ thread: TutorThread, to courseID: Int?) async {
        if let at = threads.firstIndex(where: { $0.id == thread.id }) { threads[at].courseId = courseID }
        guard !isDemo else { return }
        struct Change: Encodable { let course_id: Int? }
        _ = try? await client.from("tutor_threads")
            .update(Change(course_id: courseID))
            .eq("id", value: thread.id.uuidString.lowercased())
            .execute()
    }

    /// Feedback opened in the app stops being marked new: on the page now
    /// (`markSeen`), or the next time the page loads (`markSeenLater`).
    func markSeen(_ assignment: ClassAssignment) {
        markSeenLater(assignment)
        guard let payload = classes else { return }
        func clear(_ list: [ClassAssignment]) -> [ClassAssignment] {
            list.map { $0.id == assignment.id ? $0.seen() : $0 }
        }
        classes = ClassesPayload(
            student: payload.student,
            dueSoon: payload.dueSoon,
            classes: payload.classes.map { c in
                ClassInfo(id: c.id, name: c.name, shortName: c.shortName, color: c.color, unit: c.unit,
                          due: c.due, missing: c.missing, feedback: clear(c.feedback))
            })
    }

    func markSeenLater(_ assignment: ClassAssignment) {
        guard !isDemo, let userID = Session.shared.userID else { return }
        struct Seen: Encodable { let user_id: String; let assignment_id: Int }
        Task {
            _ = try? await client.from("tutor_feedback_seen")
                .upsert(Seen(user_id: userID.uuidString.lowercased(), assignment_id: assignment.id))
                .execute()
        }
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    /// ISO dates from the website, with or without fractions of a second.
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            for options in [ISO8601DateFormatter.Options.withInternetDateTime, [.withInternetDateTime, .withFractionalSeconds]] {
                let f = ISO8601DateFormatter()
                f.formatOptions = options
                if let date = f.date(from: text) { return date }
            }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(text)"))
        }
        return d
    }()

    /// Tidies a thread out of the list. Parents still see it.
    func archive(_ thread: TutorThread) async {
        threads.removeAll { $0.id == thread.id }
        guard !isDemo else { return }
        _ = try? await client.from("tutor_threads")
            .update(["archived_at": Date().ISO8601Format()])
            .eq("id", value: thread.id.uuidString.lowercased())
            .execute()
    }

    func messages(in threadID: UUID) async throws -> [ChatMessage] {
        if isDemo { return DemoChats.messages[threadID] ?? [] }
        struct Row: Decodable {
            let id: UUID
            let role: ChatMessage.Role
            let content: String
            let images: [String]
        }
        let rows: [Row] = try await client.from("tutor_messages")
            .select("id, role, content, images")
            .eq("thread_id", value: threadID.uuidString.lowercased())
            .order("created_at", ascending: true)
            .execute()
            .value
        return rows.map { ChatMessage(id: $0.id, role: $0.role, content: $0.content, imagePaths: $0.images) }
    }

    // MARK: - Photos

    private var photoCache: [String: UIImage] = [:]

    func photo(at path: String) async -> UIImage? {
        if let cached = photoCache[path] { return cached }
        guard !isDemo, let data = try? await client.storage.from("tuttles").download(path: path),
              let image = UIImage(data: data) else { return nil }
        photoCache[path] = image
        return image
    }

    // MARK: - Sending

    enum SendError: LocalizedError {
        case notSignedIn, server(String)
        var errorDescription: String? {
            switch self {
            case .notSignedIn: "You're not signed in."
            case .server(let message): message
            }
        }
    }

    /// Uploads the photos, sends the turn, and calls `onText` with the reply so
    /// far as it streams in (at most every few frames). Throws if the turn
    /// failed; nothing is saved then, so it can be sent again.
    func send(
        threadID: UUID, text: String, photos: [ChatPhoto], assignmentID: Int? = nil,
        onText: @escaping @MainActor (String) -> Void
    ) async throws {
        if isDemo {
            try await DemoChats.reply(onText: onText)
            return
        }
        guard let userID = Session.shared.userID else { throw SendError.notSignedIn }
        let folder = "\(userID.uuidString.lowercased())/\(threadID.uuidString.lowercased())"
        var paths: [String] = []
        for photo in photos {
            let path = "\(folder)/\(photo.id.uuidString.lowercased()).jpg"
            // A retry re-uploads what already went; that's fine.
            _ = try? await client.storage.from("tuttles")
                .upload(path, data: photo.jpeg, options: FileOptions(contentType: "image/jpeg", upsert: true))
            photoCache[path] = photo.image
            paths.append(path)
        }

        let token = try await client.auth.session.accessToken
        var request = URLRequest(url: Self.chatURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["threadId": threadID.uuidString.lowercased(), "text": text, "images": paths]
        if let assignmentID { body["assignmentId"] = assignmentID }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            var body = Data()
            for try await byte in bytes { body.append(byte) }
            let message = (try? JSONSerialization.jsonObject(with: body) as? [String: Any])?["error"] as? String
            throw SendError.server(message ?? "The tutor couldn't be reached.")
        }

        var decoder = ReplyDecoder()
        var lastShown = Date.distantPast
        for try await byte in bytes {
            guard decoder.append(byte) else { continue }
            if Date().timeIntervalSince(lastShown) > 0.05 {
                onText(decoder.reply)
                lastShown = Date()
            }
        }
        if let error = decoder.error { throw SendError.server(error) }
        onText(decoder.reply)
    }

    /// The website's chat route.
    static var chatURL: URL { websiteURL.appending(path: "tuttles/api/chat") }

    /// The website. `--website <url>` points a simulator at a local server.
    static var websiteURL: URL {
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--website"), args.count > at + 1, let url = URL(string: args[at + 1]) {
            return url
        }
        return Config.website
    }
}

/// The streamed reply, decoded as bytes arrive. A character can be split
/// across chunks, so bytes wait until they make whole UTF-8. A turn that dies
/// partway ends with "\n\n[error: …]" (the route's convention), which is lifted
/// out rather than shown as something the tutor said.
struct ReplyDecoder {
    private var pending = Data()
    private var text = ""

    /// True when the text grew.
    mutating func append(_ byte: UInt8) -> Bool {
        pending.append(byte)
        guard let s = String(data: pending, encoding: .utf8) else {
            // Four bytes is the longest character; anything longer is broken.
            if pending.count >= 4 { pending.removeAll() }
            return false
        }
        text += s
        pending.removeAll()
        return true
    }

    mutating func append(_ data: Data) {
        for byte in data { _ = append(byte) }
    }

    private static let errorTail = /\n\n\[error: ([\s\S]*)\]$/

    var error: String? { text.firstMatch(of: Self.errorTail).map { String($0.1) } }

    /// The reply without an error tail, or a half-arrived one.
    var reply: String {
        if let m = text.firstMatch(of: Self.errorTail) { return String(text[..<m.range.lowerBound]) }
        if let start = text.range(of: "\n\n[error: ", options: .backwards) { return String(text[..<start.lowerBound]) }
        return text
    }
}

extension UIImage {
    func scaledDown(toFit longest: CGFloat) -> UIImage {
        let scale = min(1, longest / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}
