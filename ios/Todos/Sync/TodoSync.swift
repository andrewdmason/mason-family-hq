import Foundation
import MasonKit
import Observation
import Supabase
#if os(macOS)
import AppKit
import AuthenticationServices
#else
import UIKit
#endif

// Keeps the list in step with the family database, in the background. The list on
// screen never waits for this: changes are sent a moment after they're made, and
// what's changed elsewhere is read when the app comes forward and once a minute
// (every five when it's in the background). TodoMerge decides what goes where.

@MainActor
@Observable
final class TodoSync {
    enum Status: Equatable {
        case signedOut
        case working
        case failing(String)
    }

    private(set) var status = Status.working

    @ObservationIgnored private let store: TodoStore
    @ObservationIgnored private let baseFile: URL
    @ObservationIgnored private var base: TodoLibrary
    @ObservationIgnored private var running = false
    @ObservationIgnored private var runAgain = false
    @ObservationIgnored private var pendingKick: Task<Void, Never>?
    @ObservationIgnored private var ticks = 0
    @ObservationIgnored private var timer: Timer?
    #if os(macOS)
    @ObservationIgnored private var webSignIn: WebSignIn?
    #endif
    /// Why the last sign-in sheet closed, for the feel test.
    @ObservationIgnored private(set) var signInEnded: String?

    private var session: MasonKit.Session { MasonKit.Session.shared }
    private var client: SupabaseClient { session.client }

    init(store: TodoStore, baseFile: URL) {
        self.store = store
        self.baseFile = baseFile
        let data = (try? Data(contentsOf: baseFile)) ?? Data()
        base = (try? TodoStore.decode(data)) ?? TodoLibrary(tasks: [], projects: [], sections: [])
    }

    func start() {
        store.onLocalChange = { [weak self] in self?.kick(after: .seconds(1)) }
        NotificationCenter.default.addObserver(
            forName: Self.becameActive, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.kick() }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.ticks += 1
                if Self.isActive || self.ticks % 5 == 0 { self.kick() }
            }
        }
        Task { await followSignIn() }
    }

    #if os(macOS)
    private static let becameActive = NSApplication.didBecomeActiveNotification
    private static var isActive: Bool { NSApp.isActive }
    #else
    private static let becameActive = UIApplication.didBecomeActiveNotification
    private static var isActive: Bool { UIApplication.shared.applicationState == .active }
    #endif

    private func followSignIn() async {
        for await (_, session) in client.auth.authStateChanges {
            if let email = session?.user.email {
                store.me = email
                kick()
            } else {
                status = .signedOut
            }
        }
    }

    #if os(macOS)
    func signIn() {
        Task {
            do {
                let redirect = Config.authRedirect
                let url = try client.auth.getOAuthSignInURL(provider: .google, redirectTo: redirect)
                let callback: URL = try await withCheckedThrowingContinuation { continuation in
                    let web = WebSignIn(window: NSApp.mainWindow ?? NSApp.windows.first { $0.isVisible })
                    webSignIn = web
                    web.start(url: url, scheme: redirect.scheme ?? "") { continuation.resume(with: $0) }
                }
                webSignIn = nil
                _ = try await client.auth.session(from: callback)
            } catch {
                webSignIn = nil
                signInEnded = "\(error)"
                let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                status = cancelled ? .signedOut : .failing("Sign-in didn't finish: \(error.localizedDescription)")
            }
        }
    }

    func cancelSignIn() {
        webSignIn?.cancel()
    }
    #else
    func signIn() {
        Task {
            do {
                try await session.signIn()
            } catch {
                status = .failing("Sign-in didn't finish: \(error.localizedDescription)")
            }
        }
    }
    #endif

    func signOut() {
        Task { await session.signOut() }
    }

    func kick(after delay: Duration = .zero) {
        pendingKick?.cancel()
        pendingKick = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            await self?.run()
        }
    }

    private func run() async {
        guard !running else {
            runAgain = true
            return
        }
        guard (try? await client.auth.session) != nil else {
            status = .signedOut
            return
        }
        running = true
        defer { running = false }
        repeat {
            runAgain = false
            do {
                if base.firstSyncDone != true {
                    let server = try await fetchServer()
                    guard TodoMerge.looksSafe(before: base.tasks.count, after: server.tasks.count) else {
                        throw SyncError.tooMuchMissing("most of this Mac's to-dos")
                    }
                    store.prepareFirstSync(server: server, base: &base)
                    saveBase()
                }
                try await send()
                try await receive()
                status = .working
            } catch {
                status = .failing(error.localizedDescription)
            }
            saveBase()
        } while runAgain
    }

    // MARK: Sending

    private enum SyncError: LocalizedError {
        case tooMuchMissing(String)
        var errorDescription: String? {
            if case .tooMuchMissing(let what) = self { return "Stopped: \(what) would disappear." }
            return nil
        }
    }

    /// Parents first, so a new to-do's project exists when it arrives. Deletes last,
    /// once nothing still points at what's going.
    private func send() async throws {
        let changes = store.pendingChanges(against: base)
        guard TodoMerge.looksSafe(before: base.tasks.count, after: base.tasks.count - changes.tasks.deletes.count) else {
            throw SyncError.tooMuchMissing("most of the database's to-dos")
        }

        for (id, fields) in changes.areas.inserts {
            try await upsert("todo_areas", id: id, row(fields))
            TodoMerge.markSent(id, fields: fields, local: store.areas, base: &areas)
        }
        try await sendUpdates(changes.areas, table: "todo_areas") { id, fields in
            TodoMerge.markSent(id, fields: fields, local: store.areas, base: &areas)
        }

        for (id, fields) in changes.projects.inserts {
            var values = row(fields)
            // Back from wherever the website left it, in case it was removed there.
            values["deleted_at"] = .null
            values["completed_at"] = .null
            values["completed_by_email"] = .null
            try await upsert("todo_projects", id: id, values)
            // As on the website: whoever makes a project starts as its member, which
            // is what puts it in their sidebar there.
            let member: [String: AnyJSON] = ["project_id": .string(id), "member_email": .string(store.me)]
            try await client.from("todo_project_members").upsert(member).execute()
            TodoMerge.markSent(id, fields: fields, local: store.projects, base: &projects)
        }
        try await sendUpdates(changes.projects, table: "todo_projects") { id, fields in
            TodoMerge.markSent(id, fields: fields, local: store.projects, base: &projects)
        }

        for (id, fields) in changes.sections.inserts {
            var values = row(fields)
            values["deleted_at"] = .null
            try await upsert("todo_sections", id: id, values)
            TodoMerge.markSent(id, fields: fields, local: store.sections, base: &sections)
        }
        try await sendUpdates(changes.sections, table: "todo_sections") { id, fields in
            TodoMerge.markSent(id, fields: fields, local: store.sections, base: &sections)
        }

        let now = AnyJSON.string(Date().formatted(.iso8601))
        for (id, fields) in changes.tasks.inserts {
            var values = taskRow(fields)
            // Your own captures never need an "unseen" state.
            values["assignee_seen_at"] = now
            values["deleted_at"] = .null
            try await upsert("todo_tasks", id: id, values)
            TodoMerge.markSent(id, fields: fields, local: store.todos, base: &tasks)
            saveBaseOccasionally()
        }
        for (id, fields) in changes.tasks.updates {
            try await client.from("todo_tasks").update(taskRow(fields)).eq("id", value: id).execute()
            TodoMerge.markSent(id, fields: fields, local: store.todos, base: &tasks)
            saveBaseOccasionally()
        }

        let deleted: [String: AnyJSON] = ["deleted_at": now]
        for id in changes.tasks.deletes {
            try await client.from("todo_tasks").update(deleted).eq("id", value: id).execute()
            tasks.removeAll { $0.id == id }
            saveBaseOccasionally()
        }
        for id in changes.sections.deletes {
            try await client.from("todo_sections").update(deleted).eq("id", value: id).execute()
            sections.removeAll { $0.id == id }
        }
        for id in changes.projects.deletes {
            try await client.from("todo_projects").update(deleted).eq("id", value: id).execute()
            projects.removeAll { $0.id == id }
        }
        for id in changes.areas.deletes {
            try await client.from("todo_areas").delete().eq("id", value: id).execute()
            areas.removeAll { $0.id == id }
        }
    }

    private func sendUpdates(
        _ changes: SyncChanges, table: String, sent: (String, [String: SyncValue]) -> Void
    ) async throws {
        for (id, fields) in changes.updates {
            try await client.from(table).update(row(fields)).eq("id", value: id).execute()
            sent(id, fields)
        }
    }

    private func upsert(_ table: String, id: String, _ values: [String: AnyJSON]) async throws {
        var values = values
        values["id"] = .string(id)
        try await client.from(table).upsert(values, onConflict: "id").execute()
    }

    private func row(_ fields: [String: SyncValue]) -> [String: AnyJSON] {
        fields.mapValues { value in
            switch value {
            case .text(let text): .string(text)
            case .number(let number): .double(number)
            case .null: .null
            }
        }
    }

    /// The same, in the to-do table's own terms.
    private func taskRow(_ fields: [String: SyncValue]) -> [String: AnyJSON] {
        var values = row(fields)
        if let notes = fields["notes"] {
            values["notes"] = nil
            values["notes_html"] = TodoMerge.notesHTML(fromPlain: notes.string).map { .string($0) } ?? .null
        }
        if let completed = fields["completed_at"] {
            values["completed_by_email"] = completed == .null ? .null : .string(store.me)
        }
        return values
    }

    // MARK: Receiving

    private func fetch<Row: Decodable>(_ query: (SupabaseClient, Int) -> PostgrestTransformBuilder) async throws -> [Row] {
        let pageSize = 1000
        var rows: [Row] = []
        while true {
            let page = try await query(client, rows.count).execute().data
            let decoded = try TodoMerge.decoder().decode([Row].self, from: page)
            rows += decoded
            if decoded.count < pageSize { return rows }
        }
    }

    private func receive() async throws {
        let server = try await fetchServer()
        guard TodoMerge.looksSafe(before: base.tasks.count, after: server.tasks.count) else {
            throw SyncError.tooMuchMissing("most of this Mac's to-dos")
        }
        store.applyServer(server, base: &base)
    }

    private func fetchServer() async throws -> TodoLibrary {
        let columns = "id, title, notes_html, bucket, assignee_email, creator_email, project_id, section_id, snoozed_until, completed_at, sort_order, created_at"
        let serverTasks: [ServerTodo] = try await fetch { client, offset in
            client.from("todo_tasks").select(columns).is("deleted_at", value: nil)
                .order("id").range(from: offset, to: offset + 999)
        }
        let serverProjects: [TodoProject] = try await fetch { client, offset in
            client.from("todo_projects").select("id, name, sort_order, area_id")
                .is("deleted_at", value: nil).is("completed_at", value: nil)
                .order("id").range(from: offset, to: offset + 999)
        }
        let serverSections: [TodoSection] = try await fetch { client, offset in
            client.from("todo_sections").select("id, project_id, name, sort_order").is("deleted_at", value: nil)
                .order("id").range(from: offset, to: offset + 999)
        }
        let serverAreas: [TodoArea] = try await fetch { client, offset in
            client.from("todo_areas").select("id, name, sort_order")
                .order("id").range(from: offset, to: offset + 999)
        }
        return TodoLibrary(
            tasks: serverTasks.map(\.todo), projects: serverProjects, sections: serverSections, areas: serverAreas)
    }

    // MARK: The base

    private var tasks: [Todo] {
        get { base.tasks }
        set { base.tasks = newValue }
    }

    private var projects: [TodoProject] {
        get { base.projects }
        set { base.projects = newValue }
    }

    private var sections: [TodoSection] {
        get { base.sections }
        set { base.sections = newValue }
    }

    private var areas: [TodoArea] {
        get { base.areas ?? [] }
        set { base.areas = newValue }
    }

    @ObservationIgnored private var unsavedCount = 0

    /// A big first sync can be interrupted without starting over.
    private func saveBaseOccasionally() {
        unsavedCount += 1
        if unsavedCount >= 25 { saveBase() }
    }

    private func saveBase() {
        unsavedCount = 0
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        try? encoder.encode(base).write(to: baseFile, options: .atomic)
    }
}
