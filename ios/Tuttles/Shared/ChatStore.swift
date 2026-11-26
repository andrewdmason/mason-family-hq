import Foundation
import MasonKit
import Observation
import Supabase
import SwiftUI

/// A chat in the list.
struct TutorThread: Identifiable, Codable, Equatable {
    let id: UUID
    var title: String?
    var updatedAt: Date
    /// When it was started. Nil for one this phone saved before it kept this.
    var createdAt: Date?
    var archivedAt: Date?
    /// The class it's about (a Canvas course id), or nil.
    var courseId: Int?
    /// "briefing" for a parent's chat about one of the kid's topics, "quiz" for a quiz.
    var kind: String?
    /// The study set it's about: a quiz's, or the one set up in it.
    var studySetId: String?

    var isQuiz: Bool { kind == "quiz" }

    enum CodingKeys: String, CodingKey {
        case id, title, kind
        case updatedAt = "updated_at"
        case createdAt = "created_at"
        case archivedAt = "archived_at"
        case courseId = "course_id"
        case studySetId = "study_set_id"
    }
}

/// A photo taken for the next message, before and after it's sent.
struct ChatPhoto: Identifiable, Equatable {
    let id: UUID
    /// What goes to the tutor: the long side at most 2048 points, as JPEG.
    let jpeg: Data
    let image: PlatformImage

    init?(_ image: PlatformImage) {
        let scaled = image.scaledDown(toFit: 2048)
        guard let jpeg = scaled.jpeg(quality: 0.8) else { return nil }
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
    /// PDFs sent with it (Attachments.swift).
    var files: [ChatFile] = []
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
    /// Their study sets (Study.swift); nil until loaded.
    var study: StudyPayload?
    /// Vocab's first screen (Vocab.swift); nil until loaded.
    var vocab: VocabHome?
    /// Why Vocab has nothing to show: no connection, the first time on this phone.
    var vocabProblem: String?
    /// Answers given on this phone that the website hasn't had yet.
    var vocabWaiting = false
    /// Vocab as it's kept on this phone, to be played with no connection
    /// (VocabOffline.swift), and whose it is.
    @ObservationIgnored var vocabLocal: VocabLocal?
    @ObservationIgnored var vocabLocalOwner: UUID?
    @ObservationIgnored var vocabSyncing: Task<VocabSyncOutcome, Never>?

    /// The kid's chats, and a parent's own briefings.
    var kidThreads: [TutorThread] { threads.filter { $0.kind != "briefing" } }
    var briefings: [TutorThread] { threads.filter { $0.kind == "briefing" } }

    /// Briefings begun here that the list hasn't caught up with yet.
    @ObservationIgnored private var startedBriefings: Set<UUID> = []

    /// A parent's chat about one of a kid's topics. Their other chats are
    /// their own: the tutor is talking to them, not to the kid.
    func isBriefing(_ threadID: UUID) -> Bool {
        startedBriefings.contains(threadID) || threads.contains { $0.id == threadID && $0.kind == "briefing" }
    }

    /// A parent's history: their briefings and the chats they've started.
    var parentChats: [TutorThread] { isDemo ? threads : Self.parentChats(in: threads) }

    /// The plain chats saved under a parent before `since` were made for the
    /// kids, on this phone before it had the kids' views. They're still on
    /// the website, and stay out of the parent's own history.
    nonisolated static func parentChats(in threads: [TutorThread], since: Date = parentChatsSince) -> [TutorThread] {
        threads.filter { $0.kind == "briefing" || ($0.createdAt ?? .distantPast) >= since }
    }

    /// 26 November 2026, 22:00 UTC: when parents got a view of their own.
    nonisolated static let parentChatsSince = Date(timeIntervalSince1970: 1_795_730_400)

    /// The signed-in member is a parent (or it's the demo).
    var isParent: Bool { isDemo || ["owner", "parent"].contains(Session.shared.role ?? "") }

    /// Who a parent's phone is being used as. It stays chosen, across launches,
    /// until a parent picks another.
    enum Viewer: Hashable {
        /// The parent as themselves ("Andrew"): the Parent Dashboard, This
        /// week and how each kid is doing, and beside them the parent's own
        /// Vocab, Math and house (`playingAsSelf`).
        case parent
        /// The phone used as a kid, in the kid's own chats: by a kid without a
        /// phone, or by a parent looking in on one who has their own.
        case kid(UUID)
        /// Nothing chosen yet, or a choice saved when a parent only previewed
        /// the kid with a phone. It becomes that kid once the kid list is in.
        case unchosen
    }

    var viewer: Viewer = ChatStore.savedViewer {
        didSet {
            guard viewer != oldValue else { return }
            switch viewer {
            case .parent: UserDefaults.standard.set("parent", forKey: Self.viewerKey)
            case .kid(let id): UserDefaults.standard.set(id.uuidString.lowercased(), forKey: Self.viewerKey)
            case .unchosen: break
            }
            // Whoever it is now starts at their home, not a parent's own place.
            onMine = false
            switchedViewer()
        }
    }

    /// Where the choice is kept. The demo keeps its own: its made-up kids
    /// aren't in the family, and a real launch that found one chosen would be
    /// refused its classes, and with them the list of kids to choose from.
    private static let viewerKey = demo ? "tuttles.viewer.demo" : "tuttles.viewer"

    private static var savedViewer: Viewer {
        let defaults = UserDefaults.standard
        // Before there was a kid choice: a yes/no for the parent view.
        return viewer(saved: defaults.string(forKey: viewerKey), parentView: defaults.bool(forKey: "tuttles.parentView"))
    }

    /// The choice as it was saved. "me" is from when a parent's own practice
    /// was a choice apart from the Parent Dashboard: they're one now.
    static func viewer(saved: String?, parentView: Bool = false) -> Viewer {
        switch saved {
        case "parent", "me": .parent
        case let saved?: UUID(uuidString: saved).map(Viewer.kid) ?? .unchosen
        case nil: parentView ? .parent : .unchosen
        }
    }

    /// With the kid list in (saved or just loaded), a parent who hasn't chosen
    /// is using the app as the kid with a phone of their own, the one they
    /// used to preview.
    private func settleViewer() {
        guard isParent, viewer == .unchosen, let kid = kids.first(where: \.ownPhone) ?? kids.first else { return }
        viewer = .kid(kid.id)
    }

    /// A parent using the app as themselves: the menu is the parents', and
    /// the chats are their own (`parentChats`).
    var asParent: Bool { isParent && viewer == .parent }

    /// The parent is on one of their own places (the menu's "Yours": Vocab,
    /// Math, House) rather than the kids'. The app's shell says so as it opens each place
    /// (`play(own:)`); `--mine` starts the simulator there.
    private(set) var onMine = CommandLine.arguments.contains("--mine")

    /// The parents' view of the kids: This week, and how they're doing at
    /// Vocab, Math and their houses. Nothing of the parent's own.
    var showingParentView: Bool { asParent && !onMine }

    /// A parent at their own Vocab, Math or house: kept apart from the kids'
    /// (at Sebastian's level), so trying things out never touches the kids'
    /// progress.
    var playingAsSelf: Bool { asParent && onMine }

    /// The place being opened is one of the parent's own, or isn't. Vocab's
    /// page is held once for whoever it's about, so it starts over.
    func play(own: Bool) {
        guard own != onMine else { return }
        let was = using
        onMine = own
        guard using != was else { return }
        vocab = nil
        vocabProblem = nil
        vocabWaiting = false
        vocabLocal?.playing = nil
    }

    /// Whose things are on screen: who the phone is being used as, and for a
    /// parent, the kids' or their own. A reply that comes back after this has
    /// changed was for someone else's page.
    struct Using: Hashable {
        let viewer: Viewer
        let own: Bool
    }

    var using: Using { Using(viewer: viewer, own: playingAsSelf) }

    /// The parent's first name, for the account picker ("Andrew").
    var myName: String {
        Session.shared.name?.split(separator: " ").first.map(String.init) ?? "Me"
    }

    /// The kid this parent's phone is being used as, if it is.
    var actingKid: FamilyKid? {
        guard isParent, case .kid(let id) = viewer else { return nil }
        return classes?.kids?.first { $0.id == id } ?? FamilyKid(id: id, name: classes?.student.name ?? "Kid", ownPhone: false)
    }

    /// A parent looking in on a kid who has their own phone: what's new for
    /// the kid stays new until the kid opens it.
    private var lookingIn: Bool { actingKid?.ownPhone == true }

    /// Whose chats the app shows and saves: the signed-in member's, or the
    /// kid's using their phone.
    var ownerID: UUID? { actingKid?.id ?? Session.shared.userID }

    /// The kids a parent can switch to, youngest first, from the last classes load.
    var kids: [FamilyKid] { isParent ? classes?.kids ?? [] : [] }

    /// A request to the website, signed as the member, naming the kid the
    /// phone is being used as if it is (src/lib/tuttles/tutoring-as.ts).
    /// `mine`: for a parent as themselves, it's about the parent (their own
    /// Vocab, Math or house, or a chat of theirs) rather than the kids, which
    /// the rest of a parent's view is (This week, the kids' pages, briefings).
    func authorize(_ request: inout URLRequest, token: String, mine: Bool = false) {
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let kid = actingKid {
            request.setValue(kid.id.uuidString.lowercased(), forHTTPHeaderField: "X-Tuttles-Kid")
        } else if mine, asParent, let me = Session.shared.userID {
            // Naming themselves: the website keeps this parent's practice as
            // their own, apart from the kids' (src/lib/tuttles/tutoring-as.ts).
            request.setValue(me.uuidString.lowercased(), forHTTPHeaderField: "X-Tuttles-Kid")
        }
    }

    /// Someone else is using the app now: their chats and classes, not the last person's.
    private func switchedViewer() {
        threads = []
        threadsLoaded = false
        // Keep the kid list (it's the same for every view) until the new load replaces it.
        if let payload = classes { classes = payload.forSwitching() }
        classesLoaded = false
        study = nil
        vocab = nil
        vocabProblem = nil
        vocabWaiting = false
        vocabLocal?.playing = nil
        loadSaved()
        Task {
            async let threads: Void = refreshThreads()
            async let classes: Void = refreshClasses()
            async let study: Void = refreshStudy()
            _ = await (threads, classes, study)
        }
    }

    /// The parents' "This week" (ParentView.swift).
    var week: WeekPayload?
    private(set) var weekLoaded = false

    func refreshWeek() async {
        defer { weekLoaded = true }
        if isDemo {
            week = DemoChats.week
            return
        }
        guard let token = try? await client.auth.session.accessToken else { return }
        var request = URLRequest(url: Self.websiteURL.appending(path: "tuttles/api/parent/week"))
        request.timeoutInterval = 120
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try? Self.decoder.decode(WeekPayload.self, from: data) else { return }
        week = payload
        save(data, as: "week")
    }

    func classInfo(_ courseID: Int?) -> ClassInfo? {
        guard let courseID else { return nil }
        return classes?.classes.first { $0.id == courseID }
    }

    /// Canned chats, with no sign-in or network: `--demo`. The simulator is
    /// the demo without being asked, so tapping its icon there opens straight
    /// in; `--live` (or `--website <url>`) is the real thing, sign-in and all.
    let isDemo = ChatStore.demo
    private static let demo = demo(launchedWith: CommandLine.arguments, onSimulator: onSimulator)

    static func demo(launchedWith args: [String], onSimulator: Bool) -> Bool {
        if args.contains("--demo") { return true }
        return onSimulator && !args.contains("--live") && !args.contains("--website")
    }

    #if targetEnvironment(simulator)
    private static let onSimulator = true
    #else
    private static let onSimulator = false
    #endif

    var client: SupabaseClient { Session.shared.client }

    /// False until the list has something to show: what this phone saved last
    /// time, or the first answer from the server. Until then it shows placeholders.
    private(set) var threadsLoaded = false
    private(set) var classesLoaded = false

    /// Shows what this phone saw last time straight away, so the list doesn't
    /// wait on the network to open; the refreshes replace it.
    func loadSaved() {
        guard !isDemo, let userID = ownerID else { return }
        if threads.isEmpty, let data = try? Data(contentsOf: Self.savedFile("threads", userID)),
           let saved = try? Self.decoder.decode([TutorThread].self, from: data) {
            threads = saved
            threadsLoaded = true
        }
        if week == nil, let data = try? Data(contentsOf: Self.savedFile("week", userID)),
           let saved = try? Self.decoder.decode(WeekPayload.self, from: data) {
            week = saved
            weekLoaded = true
        }
        if classes == nil, let data = try? Data(contentsOf: Self.savedFile("classes", userID)),
           let saved = try? Self.decoder.decode(ClassesPayload.self, from: data) {
            classes = saved
            classesLoaded = true
        }
        settleViewer()
    }

    private static func savedFile(_ name: String, _ userID: UUID) -> URL {
        #if os(macOS)
        // A Mac's caches folder is everyone's: Tuttles keeps to a folder of its own.
        let folder = URL.cachesDirectory.appending(path: Bundle.main.bundleIdentifier ?? "io.mason.tuttles")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        #else
        let folder = URL.cachesDirectory
        #endif
        return folder.appending(path: "tuttles-\(name)-\(userID.uuidString.lowercased()).json")
    }

    private func save(_ data: Data, as name: String) {
        guard let userID = ownerID else { return }
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
                .select("id, title, updated_at, created_at, archived_at, course_id, kind, study_set_id")
                .eq("student_id", value: ownerID?.uuidString.lowercased() ?? "")
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
        // Unless the view changed meanwhile: then these aren't its classes.
        let asked = viewer
        defer { if viewer == asked { classesLoaded = true } }
        if isDemo {
            // `--slow`: a first load that takes a while, to see the placeholders.
            if CommandLine.arguments.contains("--slow") { try? await Task.sleep(for: .seconds(4)) }
            classes = DemoChats.classes
            settleViewer()
            return
        }
        guard let token = try? await client.auth.session.accessToken else { return }
        var request = URLRequest(url: Self.websiteURL.appending(path: "tuttles/api/classes"))
        authorize(&request, token: token)
        guard let (data, response) = try? await URLSession.shared.data(for: request) else { return }
        let status = (response as? HTTPURLResponse)?.statusCode
        // The kid this was being used as isn't one the website will tutor
        // (no longer in the family, say): forget the choice and start over, or
        // there'd be no classes and no list of kids to pick another from.
        if status == 403, case .kid = viewer, viewer == asked {
            UserDefaults.standard.removeObject(forKey: Self.viewerKey)
            viewer = .unchosen
            return
        }
        guard status == 200, let payload = try? Self.decoder.decode(ClassesPayload.self, from: data) else { return }
        classes = payload
        save(data, as: "classes")
        settleViewer()
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
    /// (`markSeen`), or the next time the page loads (`markSeenLater`). Not
    /// while a parent is looking in on a kid with their own phone.
    func markSeen(_ assignment: ClassAssignment) {
        markSeenLater(assignment)
        guard !lookingIn, let payload = classes else { return }
        func clear(_ list: [ClassAssignment]) -> [ClassAssignment] {
            list.map { $0.id == assignment.id ? $0.seen() : $0 }
        }
        classes = ClassesPayload(
            student: payload.student,
            kids: payload.kids,
            memory: payload.memory,
            dueSoon: payload.dueSoon,
            classes: payload.classes.map { c in
                ClassInfo(id: c.id, name: c.name, shortName: c.shortName, color: c.color, unit: c.unit,
                          due: c.due, missing: c.missing, feedback: clear(c.feedback))
            })
    }

    func markSeenLater(_ assignment: ClassAssignment) {
        guard !isDemo, !lookingIn, let userID = ownerID else { return }
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
        if isDemo { return threadID == DemoChats.quizThreadID ? DemoChats.quizMessages : DemoChats.messages[threadID] ?? [] }
        struct Row: Decodable {
            let id: UUID
            let role: ChatMessage.Role
            let content: String
            let images: [String]
            let files: [File]?
            struct File: Decodable {
                let path: String
                let name: String
                let pages: Int?
            }
        }
        let rows: [Row] = try await client.from("tutor_messages")
            .select("id, role, content, images, files")
            .eq("thread_id", value: threadID.uuidString.lowercased())
            .order("created_at", ascending: true)
            .execute()
            .value
        return rows.map { row in
            ChatMessage(id: row.id, role: row.role, content: row.content, imagePaths: row.images,
                        files: (row.files ?? []).map { ChatFile(path: $0.path, name: $0.name, pages: $0.pages) })
        }
    }

    // MARK: - Photos

    private var photoCache: [String: PlatformImage] = [:]

    func rememberPhoto(_ image: PlatformImage, at path: String) { photoCache[path] = image }

    func photo(at path: String) async -> PlatformImage? {
        if let cached = photoCache[path] { return cached }
        guard !isDemo, let data = try? await client.storage.from("tuttles").download(path: path),
              let image = PlatformImage(data: data) else { return nil }
        photoCache[path] = image
        return image
    }

    // MARK: - Sending

    enum SendError: LocalizedError {
        case notSignedIn, photoNotUploaded, fileNotUploaded, server(String)
        var errorDescription: String? {
            switch self {
            case .notSignedIn: "You're not signed in."
            case .photoNotUploaded: "A photo couldn't be uploaded. Try sending again."
            case .fileNotUploaded: "A file couldn't be uploaded. Try sending again."
            case .server(let message): message
            }
        }
    }

    /// Uploads the photos and files, sends the turn, and calls `onText` with the reply so
    /// far as it streams in (at most every few frames). Throws if the turn
    /// failed; nothing is saved then, so it can be sent again.
    func send(
        threadID: UUID, text: String, photos: [ChatPhoto], files: [ChatFile] = [],
        assignmentID: Int? = nil, briefing: BriefingTopic? = nil,
        onText: @escaping @MainActor (String) -> Void
    ) async throws {
        if isDemo {
            try await DemoChats.reply(onText: onText)
            return
        }
        guard let userID = ownerID else { throw SendError.notSignedIn }
        let folder = "\(userID.uuidString.lowercased())/\(threadID.uuidString.lowercased())"
        var paths: [String] = []
        var uploadFailed = false
        for photo in photos {
            let path = "\(folder)/\(photo.id.uuidString.lowercased()).jpg"
            // A retry re-uploads what already went, and storage may refuse to
            // replace it; that's fine, the photo is there. So a failure here isn't
            // the last word: the website says whether a photo is really missing.
            do {
                _ = try await client.storage.from("tuttles")
                    .upload(path, data: photo.jpeg, options: FileOptions(contentType: "image/jpeg", upsert: true))
            } catch {
                uploadFailed = true
            }
            photoCache[path] = photo.image
            paths.append(path)
        }
        let (sentFiles, fileFailed) = await upload(files, to: folder)

        let token = try await client.auth.session.accessToken
        var request = URLRequest(url: Self.chatURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        if briefing != nil { startedBriefings.insert(threadID) }
        authorize(&request, token: token, mine: !isBriefing(threadID))
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["threadId": threadID.uuidString.lowercased(), "text": text, "images": paths]
        if !sentFiles.isEmpty { body["files"] = sentFiles }
        if let assignmentID { body["assignmentId"] = assignmentID }
        if let briefing {
            body["briefing"] = [
                "courseId": briefing.courseId, "title": briefing.title,
                "summary": briefing.summary, "assignmentIds": briefing.assignmentIds,
            ]
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            var body = Data()
            for try await byte in bytes { body.append(byte) }
            let message = (try? JSONSerialization.jsonObject(with: body) as? [String: Any])?["error"] as? String
            if uploadFailed, message?.hasPrefix("photo not uploaded") == true { throw SendError.photoNotUploaded }
            if fileFailed, message?.hasPrefix("file not uploaded") == true { throw SendError.fileNotUploaded }
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
