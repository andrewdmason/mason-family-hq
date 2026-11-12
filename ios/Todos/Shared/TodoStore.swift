import Foundation
import Observation

// The to-do list held on the device. Every read and write here is local, so
// nothing on screen ever waits on the network. The rules mirror the website's
// (src/lib/todos/derive.ts and the todos actions); keep them in step.

enum Bucket: String, Codable { case inbox, today, week, anytime, someday }

enum TodoView: String, CaseIterable, Identifiable {
    case inbox, today, week, snoozed, anytime, someday, delegated, logbook
    var id: String { rawValue }
    var label: String { self == .week ? "This Week" : rawValue.capitalized }
    var symbol: String {
        switch self {
        case .inbox: "tray.fill"
        case .today: "star.fill"
        case .week: "calendar"
        case .snoozed: "moon.fill"
        case .anytime: "square.stack.3d.up.fill"
        case .someday: "archivebox.fill"
        case .delegated: "paperplane.fill"
        case .logbook: "checkmark.seal.fill"
        }
    }
}

enum Destination: Hashable {
    case view(TodoView)
    case project(String)
}

struct Todo: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    /// HTML, as the website stores it.
    var notes: String?
    var bucket: Bucket
    var assigneeEmail: String
    var creatorEmail: String
    var projectId: String?
    var sectionId: String?
    var snoozedUntil: String?
    var completedAt: String?
    var sortOrder: Double
    var createdAt: String
}

struct TodoProject: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var sortOrder: Double
    var areaId: String? = nil
}

/// A group of projects in the sidebar: the website's "areas". Whether it's
/// collapsed belongs to this device.
struct TodoArea: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var sortOrder: Double
    var isCollapsed: Bool? = nil
}

struct TodoSection: Codable, Identifiable, Equatable {
    var id: String
    var projectId: String
    var name: String
    var sortOrder: Double
}

/// A run of to-dos under an optional heading: a project's sections, or the
/// projects within This Week, Anytime and Someday. Loose to-dos come first.
struct TodoGroup: Identifiable, Equatable {
    var id: String
    var name: String?
    var todos: [Todo]
}

/// One line of the list on screen.
enum TodoListRow: Identifiable, Equatable {
    case heading(title: String, count: Int)
    case group(id: String, name: String)
    case empty
    case todo(Todo, detail: String?)

    var id: String {
        switch self {
        case .heading: "heading"
        case .group(let id, _): "group-" + id
        case .empty: "empty"
        case .todo(let todo, _): todo.id
        }
    }
}

struct TodoLibrary: Codable {
    var tasks: [Todo]
    var projects: [TodoProject]
    var sections: [TodoSection]
    var areas: [TodoArea]? = nil
    /// On the base: this device has had its first sync.
    var firstSyncDone: Bool? = nil
    /// Absent from files saved before notes were HTML, which is how they're spotted.
    var notesAreHtml: Bool? = true
}

@MainActor
@Observable
final class TodoStore {
    var todos: [Todo]
    var projects: [TodoProject]
    var sections: [TodoSection]
    var areas: [TodoArea]
    var destination: Destination = .view(.today)
    @ObservationIgnored private var backHistory: [Destination] = []
    @ObservationIgnored private var forwardHistory: [Destination] = []
    var selectedID: String? {
        didSet {
            let only: Set<String> = selectedID.map { [$0] } ?? []
            if selectedIDs != only { selectedIDs = only }
            // Selecting anything else puts the open to-do away.
            if let openID, selectedID != openID { closeOpen() }
        }
    }
    /// Every selected row. Usually just the current one; more after ⌘A or ⌘-clicks.
    /// Setting `selectedID` narrows it back down to that one row.
    private(set) var selectedIDs: Set<String> = []
    /// A project group whose name is being typed in the sidebar.
    private(set) var namingAreaID: String?
    @ObservationIgnored var areaDraft = ""
    private var isNewArea = false
    /// The to-do open as a card, showing its name and notes. What's typed is kept
    /// aside and saved when it closes, as one change for ⌘Z.
    private(set) var openID: String?
    @ObservationIgnored var openTitle = ""
    @ObservationIgnored var openNotes = ""
    /// Whether the open to-do was only just added.
    @ObservationIgnored private(set) var openIsNew = false
    /// The project whose name is being typed.
    private(set) var renamingProjectID: String?
    /// Whether that typing is in the sidebar's row rather than the header.
    private(set) var isRenamingInSidebar = false
    private var nameBeforeRenaming = ""
    /// A section being named in the list, new or existing, and what's been typed.
    private(set) var namingSectionID: String?
    var sectionDraft = ""
    /// With nothing selected, new to-dos join the section just made.
    private var newestSectionID: String?
    /// Where to-dos taken into a new section came from, in case it's cancelled.
    private var sectionBeforeSplit: [String: String?] = [:]
    private var isNewSection = false
    /// Where to return if a brand-new project never gets a name.
    private var returnFromNewProject: Destination?

    /// Who's signed in, once sync says so.
    var me = "andrew@mason.io"
    /// A change was made here, for sync to send.
    @ObservationIgnored var onLocalChange: (() -> Void)?
    /// What to go back to: the list, and which rows were selected in it.
    private typealias Snapshot = (todos: [Todo], sections: [TodoSection], selection: Set<String>)
    private var undoStack: [Snapshot] = []
    private var redoStack: [Snapshot] = []
    @ObservationIgnored let attachments: AttachmentStore
    private var saveFile: URL?
    private var saveTask: Task<Void, Never>?

    init(library: TodoLibrary, saveFile: URL?) {
        attachments = AttachmentStore(folder: saveFile?.deletingLastPathComponent())
        todos = library.tasks
        projects = library.projects
        areas = library.areas ?? []
        sections = library.sections
        self.saveFile = saveFile
        // A to-do in a project doesn't belong in the Inbox. Earlier versions of
        // this app filed new project to-dos there; put those right.
        var corrected = false
        for index in todos.indices where todos[index].bucket == .inbox && todos[index].projectId != nil {
            todos[index].bucket = .anytime
            corrected = true
        }
        if ensureProjectsHaveGroups() { corrected = true }
        if normalizeIDs() { corrected = true }
        if corrected { scheduleSave() }
    }

    /// Every project sits in a group. Lists saved before groups existed start with
    /// one, called Projects, which can be renamed.
    private func ensureProjectsHaveGroups() -> Bool {
        var corrected = false
        if areas.isEmpty {
            areas = [TodoArea(id: UUID().uuidString.lowercased(), name: "Projects", sortOrder: 1)]
            corrected = true
        }
        let known = Set(areas.map(\.id))
        let home = areas.sorted { $0.sortOrder < $1.sortOrder }[0].id
        for index in projects.indices where projects[index].areaId.map({ !known.contains($0) }) ?? true {
            projects[index].areaId = home
            corrected = true
        }
        return corrected
    }

    /// The database hands back ids in lowercase; earlier versions of this app made
    /// them in capitals, and the two wouldn't match.
    private func normalizeIDs() -> Bool {
        let lower: (String) -> String = { $0.lowercased() }
        let isLower = { (id: String) in id == id.lowercased() }
        guard !(todos.allSatisfy { isLower($0.id) && isLower($0.projectId ?? "") && isLower($0.sectionId ?? "") }
            && projects.allSatisfy { isLower($0.id) && isLower($0.areaId ?? "") }
            && sections.allSatisfy { isLower($0.id) && isLower($0.projectId) }
            && areas.allSatisfy { isLower($0.id) })
        else { return false }
        for index in todos.indices {
            todos[index].id = lower(todos[index].id)
            todos[index].projectId = todos[index].projectId.map(lower)
            todos[index].sectionId = todos[index].sectionId.map(lower)
        }
        for index in projects.indices {
            projects[index].id = lower(projects[index].id)
            projects[index].areaId = projects[index].areaId.map(lower)
        }
        for index in sections.indices {
            sections[index].id = lower(sections[index].id)
            sections[index].projectId = lower(sections[index].projectId)
        }
        for index in areas.indices { areas[index].id = lower(areas[index].id) }
        return true
    }

    // MARK: Sync

    struct PendingChanges {
        let tasks: SyncChanges
        let projects: SyncChanges
        let sections: SyncChanges
        let areas: SyncChanges
    }

    func pendingChanges(against base: TodoLibrary) -> PendingChanges {
        PendingChanges(
            tasks: TodoMerge.changes(local: todos, base: base.tasks) { !$0.title.isEmpty },
            projects: TodoMerge.changes(local: projects, base: base.projects) {
                !$0.name.isEmpty && $0.id != self.renamingProjectID
            },
            sections: TodoMerge.changes(local: sections, base: base.sections) {
                !$0.name.isEmpty && $0.id != self.namingSectionID
            },
            areas: TodoMerge.changes(local: areas, base: base.areas ?? []) {
                !$0.name.isEmpty && $0.id != self.namingAreaID
            })
    }

    /// The first sync: this list is the one that's right, so anything different on
    /// the database gets overwritten, and to-dos removed here get removed there. Two
    /// things aren't this list's to decide. Notes never came down in the first copy,
    /// so a to-do with none here keeps what the website has. And to-dos it has never
    /// seen (other people's, older history) still arrive. A new device, with no list
    /// of its own, just reads.
    func prepareFirstSync(server: TodoLibrary, base: inout TodoLibrary) {
        defer { base.firstSyncDone = true }
        guard !todos.isEmpty, !base.tasks.isEmpty else { return }
        let serverNotes = Dictionary(server.tasks.map { ($0.id, $0.notes) }, uniquingKeysWith: { a, _ in a })
        for index in todos.indices {
            todos[index].snoozedUntil = todos[index].snoozedUntil.map(TodoMerge.canonicalStamp)
            todos[index].completedAt = todos[index].completedAt.map(TodoMerge.canonicalStamp)
            todos[index].createdAt = TodoMerge.canonicalStamp(todos[index].createdAt)
            if todos[index].notes == nil, let notes = serverNotes[todos[index].id] { todos[index].notes = notes }
        }
        undoStack.removeAll()
        redoStack.removeAll()
        base = TodoLibrary(
            tasks: TodoMerge.adoptLocal(local: todos, base: base.tasks, server: server.tasks),
            projects: TodoMerge.adoptLocal(local: projects, base: base.projects, server: server.projects),
            sections: TodoMerge.adoptLocal(local: sections, base: base.sections, server: server.sections),
            areas: TodoMerge.adoptLocal(local: areas, base: base.areas ?? [], server: server.areas ?? [], claimAll: true),
            firstSyncDone: true)
        writeToDisk()
    }

    /// Takes in what the database says, and moves the base along to match.
    func applyServer(_ server: TodoLibrary, base: inout TodoLibrary) {
        let mergedTasks = TodoMerge.merge(local: todos, base: base.tasks, server: server.tasks)
        let mergedProjects = TodoMerge.merge(local: projects, base: base.projects, server: server.projects)
        let mergedSections = TodoMerge.merge(local: sections, base: base.sections, server: server.sections)
        let mergedAreas = TodoMerge.merge(local: areas, base: base.areas ?? [], server: server.areas ?? [])
        base = TodoLibrary(
            tasks: mergedTasks.base, projects: mergedProjects.base, sections: mergedSections.base, areas: mergedAreas.base,
            firstSyncDone: base.firstSyncDone)
        guard mergedTasks.changed || mergedProjects.changed || mergedSections.changed || mergedAreas.changed else { return }

        todos = mergedTasks.local
        projects = mergedProjects.local
        sections = mergedSections.local
        areas = mergedAreas.local
        // Undo steps were saved before this arrived, and would take it back out.
        undoStack.removeAll()
        redoStack.removeAll()
        if ensureProjectsHaveGroups() { onLocalChange?() }

        if case .project(let id) = destination, !projects.contains(where: { $0.id == id }) {
            destination = .view(.today)
        }
        if let id = newestSectionID, !sections.contains(where: { $0.id == id }) { newestSectionID = nil }
        if let id = openID, !todos.contains(where: { $0.id == id }) { openID = nil }
        let onScreen = Set(visible.map(\.id))
        let remaining = selectedIDs.intersection(onScreen)
        if remaining != selectedIDs {
            if remaining.isEmpty {
                selectedID = visible.first?.id
            } else {
                select(remaining)
            }
        }
        writeToDisk()
    }

    nonisolated static func decode(_ data: Data) throws -> TodoLibrary {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        var library = try decoder.decode(TodoLibrary.self, from: data)
        // The list and the base convert alike, so nothing reads as an edit here,
        // and the first sync brings each note's real formatting back down.
        if library.notesAreHtml != true {
            for index in library.tasks.indices {
                library.tasks[index].notes = TodoMerge.notesHTML(fromPlain: library.tasks[index].notes)
            }
            library.notesAreHtml = true
        }
        return library
    }

    // MARK: What's on screen

    var visible: [Todo] { groups.flatMap(\.todos) }

    var title: String {
        switch destination {
        case .view(let view): view.label
        case .project(let id): projects.first { $0.id == id }?.name ?? "Project"
        }
    }

    var orderedAreas: [TodoArea] { areas.sorted { $0.sortOrder < $1.sortOrder } }

    func projects(in area: String) -> [TodoProject] {
        projects.filter { $0.areaId == area }.sorted { $0.sortOrder < $1.sortOrder }
    }

    /// Projects as the sidebar lists them, group by group.
    var orderedProjects: [TodoProject] { orderedAreas.flatMap { projects(in: $0.id) } }

    var groups: [TodoGroup] {
        let todos = tasks(for: destination)
        switch destination {
        case .project(let id):
            // Every section shows, even an empty one, so it can be filled.
            let own = sections.filter { $0.projectId == id }.sorted { $0.sortOrder < $1.sortOrder }
            let headings = own.map { (id: $0.id, name: $0.name) }
            let filled = grouped(todos, by: \.sectionId, headings: headings)
            let loose = filled.first { $0.id == "loose" }.map { [$0] } ?? []
            return loose + own.map { section in
                filled.first { $0.id == section.id } ?? TodoGroup(id: section.id, name: section.name, todos: [])
            }
        case .view(.week), .view(.anytime), .view(.someday):
            return grouped(todos, by: \.projectId, headings: orderedProjects.map { ($0.id, $0.name) })
        case .view:
            return todos.isEmpty ? [] : [TodoGroup(id: "all", name: nil, todos: todos)]
        }
    }

    /// Loose to-dos first, then each heading in its order. A heading whose
    /// section or project isn't known (finished, say) falls in with the loose ones.
    private func grouped(
        _ todos: [Todo], by key: (Todo) -> String?, headings: [(id: String, name: String)]
    ) -> [TodoGroup] {
        let known = Set(headings.map(\.id))
        let byHeading = Dictionary(grouping: todos) { todo -> String in
            key(todo).flatMap { known.contains($0) ? $0 : nil } ?? ""
        }
        var groups: [TodoGroup] = []
        if let loose = byHeading[""] { groups.append(TodoGroup(id: "loose", name: nil, todos: loose)) }
        for heading in headings {
            if let todos = byHeading[heading.id] {
                groups.append(TodoGroup(id: heading.id, name: heading.name, todos: todos))
            }
        }
        return groups
    }

    var listRows: [TodoListRow] {
        let groups = groups
        var rows: [TodoListRow] = [.heading(title: title, count: groups.reduce(0) { $0 + $1.todos.count })]
        for group in groups {
            if let name = group.name { rows.append(.group(id: group.id, name: name)) }
            rows += group.todos.map { .todo($0, detail: detail(for: $0)) }
        }
        if groups.isEmpty { rows.append(.empty) }
        return rows
    }

    /// The quiet text at the end of a row.
    func detail(for todo: Todo) -> String? {
        switch destination {
        case .project, .view(.week), .view(.anytime), .view(.someday):
            return todo.snoozedUntil.flatMap(Self.shortDate)
        case .view(.snoozed):
            return todo.snoozedUntil.flatMap(Self.shortDate)
        case .view(.logbook):
            return todo.completedAt.flatMap(Self.shortDate)
        case .view(.delegated):
            return todo.assigneeEmail.split(separator: "@").first.map { $0.capitalized }
        case .view:
            return todo.projectId.flatMap { id in projects.first { $0.id == id }?.name }
        }
    }

    private static var shortDates: [String: String] = [:]

    /// "Today", "Tomorrow" or "Oct 2", from the timestamps the database and this app write.
    private static func shortDate(_ stamp: String) -> String? {
        if let known = shortDates[stamp] { return known }
        // The database writes fractions of a second of varying length; drop them.
        var plain = stamp
        if let dot = stamp.firstIndex(of: "."),
            let end = stamp[dot...].firstIndex(where: { $0 == "+" || $0 == "-" || $0 == "Z" }) {
            plain.removeSubrange(dot..<end)
        }
        guard let date = try? Date(plain, strategy: .iso8601) else { return nil }
        let calendar = Calendar.current
        let text =
            calendar.isDateInToday(date) ? "Today"
            : calendar.isDateInTomorrow(date) ? "Tomorrow"
            : date.formatted(.dateTime.month(.abbreviated).day())
        shortDates[stamp] = text
        return text
    }

    func tasks(for destination: Destination) -> [Todo] {
        let now = Self.stamp(Date())
        let active = todos.filter { $0.completedAt == nil }.map { todo -> Todo in
            // A snooze whose moment has passed shows in Today.
            guard let until = todo.snoozedUntil, until <= now else { return todo }
            var woken = todo
            woken.bucket = .today
            woken.snoozedUntil = nil
            return woken
        }
        let manual: (Todo, Todo) -> Bool = {
            ($0.sortOrder, $0.createdAt) < ($1.sortOrder, $1.createdAt)
        }
        switch destination {
        case .project(let id):
            let order = Dictionary(uniqueKeysWithValues: sections.map { ($0.id, $0.sortOrder) })
            return active.filter { $0.projectId == id }.sorted {
                let (a, b) = ($0.sectionId.flatMap { order[$0] } ?? -1, $1.sectionId.flatMap { order[$0] } ?? -1)
                return a != b ? a < b : manual($0, $1)
            }
        case .view(.week):
            // Filed here, or snoozed to wake before Monday, wherever it's filed.
            let weekEnd = Self.stamp(Self.startOfNextWeek())
            return active.filter { todo in
                guard todo.assigneeEmail == me else { return false }
                if let until = todo.snoozedUntil { return until < weekEnd }
                return todo.bucket == .week
            }
            .sorted(by: manual)
        case .view(.snoozed):
            return active.filter { $0.assigneeEmail == me && $0.snoozedUntil != nil }
                .sorted { ($0.snoozedUntil ?? "") < ($1.snoozedUntil ?? "") }
        case .view(.delegated):
            return active.filter { $0.creatorEmail == me && $0.assigneeEmail != me }
                .sorted { ($0.assigneeEmail, $0.sortOrder) < ($1.assigneeEmail, $1.sortOrder) }
        case .view(.logbook):
            return todos.filter { $0.completedAt != nil && $0.assigneeEmail == me }
                .sorted { ($0.completedAt ?? "") > ($1.completedAt ?? "") }
        case .view(let view):
            let bucket = Bucket(rawValue: view.rawValue)
            return active.filter { $0.assigneeEmail == me && $0.bucket == bucket && $0.snoozedUntil == nil }
                .sorted(by: manual)
        }
    }

    /// In a project, the list a to-do is also showing in, for its row's small icon.
    /// This Week follows its list's rule: filed there, or snoozed to wake before Monday.
    func marker(for todo: Todo) -> TodoView? {
        guard case .project = destination, todo.completedAt == nil else { return nil }
        if let until = todo.snoozedUntil {
            return until < Self.stamp(Self.startOfNextWeek()) ? .week : nil
        }
        switch todo.bucket {
        case .today: return .today
        case .week: return .week
        default: return nil
        }
    }

    func count(_ view: TodoView) -> Int? {
        switch view {
        case .inbox, .today, .week, .snoozed: tasks(for: .view(view)).count
        default: nil
        }
    }

    // MARK: Moving around

    func go(_ destination: Destination) {
        let from = self.destination
        show(destination)
        if self.destination != from { rememberLeaving(from) }
    }

    func goBack() {
        guard let target = popLive(&backHistory) else { return }
        forwardHistory.append(destination)
        show(target)
    }

    func goForward() {
        guard let target = popLive(&forwardHistory) else { return }
        backHistory.append(destination)
        show(target)
    }

    private func rememberLeaving(_ destination: Destination) {
        backHistory.append(destination)
        forwardHistory = []
    }

    /// The nearest place in this history that can still be shown: a project may
    /// have been deleted since, which can also leave the same list twice in a row.
    private func popLive(_ history: inout [Destination]) -> Destination? {
        while let place = history.popLast() {
            if place == destination { continue }
            if case .project(let id) = place, !projects.contains(where: { $0.id == id }) { continue }
            return place
        }
        return nil
    }

    private func show(_ destination: Destination) {
        guard destination != self.destination else { return }
        if case .project(let id) = destination { expandArea(ofProject: id) }
        finishNamingSection()
        finishRenamingProject()
        guard destination != self.destination else { return }
        commitEdit()
        // Going anywhere else (⌘[, a g chord) is leaving focus.
        if focusing {
            commitFocusEdit()
            focusing = false
        }
        newestSectionID = nil
        self.destination = destination
        selectedID = visible.first?.id
    }

    func moveSelection(by delta: Int) {
        let rows = visible
        guard !rows.isEmpty else { return }
        let current = rows.firstIndex { $0.id == selectedID }
        let next = current.map { min(max($0 + delta, 0), rows.count - 1) } ?? 0
        selectedID = rows[next].id
    }

    func selectAll() {
        let rows = visible.map(\.id)
        guard !rows.isEmpty else { return }
        select(Set(rows))
    }

    /// Several rows at once, keeping the current row if it's among them.
    func select(_ ids: Set<String>) {
        if let openID, ids != [openID] { closeOpen() }
        if let id = selectedID, ids.contains(id) {
            selectedIDs = ids
        } else {
            selectedID = visible.first { ids.contains($0.id) }?.id
            selectedIDs = ids
        }
    }

    // MARK: Changing to-dos

    private func change(_ body: () -> Void) {
        undoStack.append((todos, sections, selectedIDs))
        redoStack.removeAll()
        body()
        scheduleSave()
    }

    private func update(_ id: String, _ body: (inout Todo) -> Void) {
        guard let index = todos.firstIndex(where: { $0.id == id }) else { return }
        body(&todos[index])
    }

    /// After selected rows leave the list, select what took their place.
    private func changeSelection(_ body: (Set<String>) -> Void) {
        closeOpen()
        let ids = selectedIDs
        guard !ids.isEmpty else { return }
        let index = visible.firstIndex { ids.contains($0.id) } ?? 0
        change { body(ids) }
        let after = visible
        let remaining = ids.intersection(after.map(\.id))
        if remaining.isEmpty {
            selectedID = after.isEmpty ? nil : after[min(index, after.count - 1)].id
        } else if remaining != ids {
            select(remaining)
        }
    }

    private func changeSelected(_ body: (inout Todo) -> Void) {
        changeSelection { ids in
            for index in todos.indices where ids.contains(todos[index].id) {
                body(&todos[index])
            }
        }
    }

    func completeSelected() {
        changeSelected {
            $0.completedAt = $0.completedAt == nil ? Self.stamp(Date()) : nil
            // As on the website, finishing a to-do ends its snooze.
            if $0.completedAt != nil { $0.snoozedUntil = nil }
        }
    }

    func moveSelected(to bucket: Bucket) {
        // A new to-do with nothing typed yet has nothing to move. One with something
        // typed is saved as it closes, and moves with its name.
        if hasBlankNewOpen { return }
        changeSelected {
            $0.bucket = bucket
            $0.snoozedUntil = nil
        }
    }

    /// Dropping to-dos on a list or project, by the website's rules: the Inbox
    /// clears the project, a project pulls a to-do out of the Inbox, and the
    /// Logbook completes.
    func file(_ ids: Set<String>, to destination: Destination) {
        select(ids)
        switch destination {
        case .project(let id):
            changeSelected {
                $0.projectId = id
                $0.sectionId = nil
                if $0.bucket == .inbox { $0.bucket = .anytime }
            }
        case .view(.inbox):
            changeSelected {
                $0.bucket = .inbox
                $0.projectId = nil
                $0.sectionId = nil
                $0.snoozedUntil = nil
            }
        case .view(.logbook):
            completeSelected()
        case .view(let view):
            if let bucket = Bucket(rawValue: view.rawValue) { moveSelected(to: bucket) }
        }
    }

    func snoozeSelected(until date: Date) {
        changeSelected { $0.snoozedUntil = Self.stamp(date) }
    }

    /// A snoozed to-do, back in Today now.
    func wakeSelected() {
        changeSelected {
            guard $0.snoozedUntil != nil else { return }
            $0.snoozedUntil = nil
            $0.bucket = .today
        }
    }

    func snoozeSelectedUntilTomorrow() {
        snoozeSelected(until: Self.tomorrow())
    }

    /// Tick a to-do's circle: completes it, or from the Logbook, brings it back.
    func toggleComplete(_ id: String) {
        selectedID = id
        completeSelected()
    }

    func deleteSelected() {
        changeSelection { ids in todos.removeAll { ids.contains($0.id) } }
    }

    func undo() {
        closeOpen()
        guard let previous = undoStack.popLast() else { return }
        redoStack.append((todos, sections, selectedIDs))
        restore(previous)
    }

    func redo() {
        closeOpen()
        guard let next = redoStack.popLast() else { return }
        undoStack.append((todos, sections, selectedIDs))
        restore(next)
    }

    private func restore(_ snapshot: Snapshot) {
        todos = snapshot.todos
        sections = snapshot.sections
        if let id = newestSectionID, !sections.contains(where: { $0.id == id }) { newestSectionID = nil }
        let selection = snapshot.selection.intersection(visible.map(\.id))
        if !selection.isEmpty { select(selection) }
        scheduleSave()
    }

    // MARK: Typing

    func startNew() {
        finishNamingSection()
        finishRenamingProject()
        commitEdit()
        let (bucket, projectId) = placeForNewTodos()
        let sectionId = sectionForNewTodos()
        let first = visible.first { $0.sectionId == sectionId }?.sortOrder ?? 0
        let todo = Todo(
            id: UUID().uuidString.lowercased(), title: "", notes: nil, bucket: bucket, assigneeEmail: me, creatorEmail: me,
            projectId: projectId, sectionId: sectionId, snoozedUntil: nil, completedAt: nil,
            sortOrder: first - 1, createdAt: Self.stamp(Date()))
        change { todos.append(todo) }
        selectedID = todo.id
        openSelected()
        openIsNew = true
    }

    /// Which list new to-dos join: this one, or the Inbox from a list that can't
    /// show them.
    private func placeForNewTodos() -> (Bucket, String?) {
        switch destination {
        case .view(.snoozed), .view(.delegated), .view(.logbook): go(.view(.inbox))
        default: break
        }
        switch destination {
        case .project(let id): return (.anytime, id)
        case .view(.today): return (.today, nil)
        case .view(.week): return (.week, nil)
        case .view(.anytime): return (.anytime, nil)
        case .view(.someday): return (.someday, nil)
        case .view: return (.inbox, nil)
        }
    }

    /// In a project, new to-dos join the selected to-do's section, or the section
    /// just created.
    private func sectionForNewTodos() -> String? {
        guard case .project = destination else { return nil }
        if let id = selectedID, let todo = todos.first(where: { $0.id == id }) { return todo.sectionId }
        return newestSectionID
    }

    /// One to-do per line of pasted text, in order at the top of the list, all
    /// selected so they can be moved together. One ⌘Z takes them all back.
    @discardableResult
    func pasteTodos(_ text: String) -> Int {
        let titles = text.split(whereSeparator: \.isNewline).compactMap(Self.pastedTitle)
        guard !titles.isEmpty else { return 0 }
        finishNamingSection()
        finishRenamingProject()
        commitEdit()
        let (bucket, projectId) = placeForNewTodos()
        let sectionId = sectionForNewTodos()
        let first = visible.first { $0.sectionId == sectionId }?.sortOrder ?? 0
        let now = Self.stamp(Date())
        let pasted = titles.enumerated().map { index, title in
            Todo(
                id: UUID().uuidString.lowercased(), title: title, notes: nil, bucket: bucket, assigneeEmail: me, creatorEmail: me,
                projectId: projectId, sectionId: sectionId, snoozedUntil: nil, completedAt: nil,
                sortOrder: first - Double(titles.count - index), createdAt: now)
        }
        change { todos += pasted }
        select(Set(pasted.map(\.id)))
        return pasted.count
    }

    /// A line without its list marking: "- [ ] Pogo", "* Pogo", "• Pogo", "1. Pogo".
    private static func pastedTitle(_ line: Substring) -> String? {
        var title = line.trimmingCharacters(in: .whitespaces)
        let markers = [#"^(?:[-*+•–—]\s+|\d+[.)]\s+)"#, #"^\[[ xX]?\]\s*"#]
        for marker in markers {
            if let match = title.range(of: marker, options: .regularExpression) {
                title.removeSubrange(match)
            }
        }
        title = title.trimmingCharacters(in: .whitespaces)
        return title.isEmpty ? nil : title
    }

    // MARK: The open to-do

    func openSelected() {
        guard let id = selectedID, let todo = todos.first(where: { $0.id == id }) else { return }
        finishNamingSection()
        finishRenamingProject()
        commitEdit()
        selectedID = id
        openTitle = todo.title
        openNotes = todo.notes ?? ""
        openID = id
    }

    /// A new to-do on screen with nothing typed in it, which closing will remove.
    var hasBlankNewOpen: Bool {
        openIsNew && openTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && openNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && openID.map { attachments.items(for: $0).isEmpty } != false
    }

    /// Saves what was typed. A name left blank keeps the old one. A new to-do with
    /// nothing typed is removed.
    func closeOpen() {
        guard let id = openID else { return }
        let isBlank = hasBlankNewOpen
        let isNew = openIsNew
        openID = nil
        openIsNew = false
        guard let todo = todos.first(where: { $0.id == id }) else { return }
        let title = openTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = openNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        if isBlank {
            todos.removeAll { $0.id == id }
            if selectedID == id { selectedID = nil }
            scheduleSave()
            return
        }
        if isNew {
            // Part of adding it, so one undo takes the whole to-do away. Sync skips
            // to-dos with no name, so notes alone still need one.
            update(id) {
                $0.title = title.isEmpty ? "New To-Do" : title
                $0.notes = notes.isEmpty ? nil : notes
            }
            scheduleSave()
            return
        }
        let newTitle = title.isEmpty ? todo.title : title
        let newNotes = notes.isEmpty ? nil : notes
        guard newTitle != todo.title || newNotes != todo.notes else { return }
        change {
            update(id) {
                $0.title = newTitle
                $0.notes = newNotes
            }
        }
    }

    /// Saves a name and notes edited elsewhere than the open card. A name left blank
    /// keeps the old one.
    func edit(_ id: String, title: String, notes: String) {
        guard let todo = todos.first(where: { $0.id == id }) else { return }
        let newTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let newNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalTitle = newTitle.isEmpty ? todo.title : newTitle
        let finalNotes = newNotes.isEmpty ? nil : newNotes
        guard finalTitle != todo.title || finalNotes != todo.notes else { return }
        change {
            update(id) {
                $0.title = finalTitle
                $0.notes = finalNotes
            }
        }
    }

    // MARK: Reordering

    /// Which group of the list on screen a to-do sits in.
    private func groupID(of todo: Todo) -> String? {
        groups.first { $0.todos.contains { $0.id == todo.id } }?.id
    }

    /// Whether these to-dos can be dragged into this group. Lists sorted some other
    /// way have no order to change, and in This Week, Anytime and Someday a group
    /// is a project, so a drag there stays inside it.
    func canMove(_ ids: Set<String>, toGroup group: String) -> Bool {
        switch destination {
        case .project: return true
        case .view(.snoozed), .view(.delegated), .view(.logbook): return false
        case .view(.week), .view(.anytime), .view(.someday):
            return todos.filter { ids.contains($0.id) }.allSatisfy { groupID(of: $0) == group }
        case .view: return true
        }
    }

    /// Drag to reorder: the to-dos land together before `before` (or at the end of
    /// the group). In a project, the group is a section, so they join it.
    func move(_ ids: Set<String>, toGroup group: String, before: String?) {
        guard canMove(ids, toGroup: group) else { return }
        let moving = visible.filter { ids.contains($0.id) }
        guard !moving.isEmpty else { return }
        let rest = (groups.first { $0.id == group }?.todos ?? []).filter { !ids.contains($0.id) }
        let at = before.flatMap { id in rest.firstIndex { $0.id == id } } ?? rest.count
        let previous = at > 0 ? rest[at - 1].sortOrder : nil
        let next = at < rest.count ? rest[at].sortOrder : nil
        let count = Double(moving.count)
        var orders: [String: Double] = [:]
        if let previous, let next, previous == next {
            // Nothing between them to fit into: number the whole group afresh.
            let ordered = Array(rest[..<at]) + moving + Array(rest[at...])
            for (position, todo) in ordered.enumerated() { orders[todo.id] = Double(position + 1) }
        } else {
            for (position, todo) in moving.enumerated() {
                let step = Double(position + 1)
                switch (previous, next) {
                case (let low?, let high?): orders[todo.id] = low + (high - low) * step / (count + 1)
                case (let low?, nil): orders[todo.id] = low + step
                case (nil, let high?): orders[todo.id] = high - count - 1 + step
                case (nil, nil): orders[todo.id] = step
                }
            }
        }
        var section: String??
        if case .project = destination { section = .some(group == "loose" ? nil : group) }
        select(ids)
        change {
            for index in todos.indices {
                if let order = orders[todos[index].id] { todos[index].sortOrder = order }
                if let section, ids.contains(todos[index].id) { todos[index].sectionId = section }
            }
        }
    }

    func commitEdit() {
        finishNamingArea()
        closeOpen()
    }

    /// From quick add: goes in at the top of the Inbox without touching what's
    /// selected or being typed in the main window.
    func addToInbox(_ title: String) {
        let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let first = todos.filter { $0.bucket == .inbox }.map(\.sortOrder).min() ?? 0
        let todo = Todo(
            id: UUID().uuidString.lowercased(), title: text, notes: nil, bucket: .inbox, assigneeEmail: me, creatorEmail: me,
            projectId: nil, sectionId: nil, snoozedUntil: nil, completedAt: nil,
            sortOrder: first - 1, createdAt: Self.stamp(Date()))
        change { todos.append(todo) }
    }

    /// A new section right below the selected to-do, with the cursor in its name.
    /// The to-dos under that one now fall under the new section, as in Things.
    /// With nothing selected it goes at the bottom. Returns false outside a project.
    @discardableResult
    func startNewSection() -> Bool {
        guard case .project(let projectId) = destination else { return false }
        finishNamingSection()
        finishRenamingProject()
        commitEdit()
        var own = sections.filter { $0.projectId == projectId }.sorted { $0.sortOrder < $1.sortOrder }
        let section = TodoSection(id: UUID().uuidString.lowercased(), projectId: projectId, name: "", sortOrder: 0)
        let rows = visible
        var position = own.count
        var moving: [Todo] = []
        if let last = rows.lastIndex(where: { selectedIDs.contains($0.id) }) {
            let above = rows[last].sectionId
            position = above.flatMap { id in own.firstIndex { $0.id == id }.map { $0 + 1 } } ?? 0
            moving = rows[(last + 1)...].filter { $0.sectionId == above }
        }
        own.insert(section, at: position)
        let orders = Dictionary(uniqueKeysWithValues: own.enumerated().map { ($1.id, Double($0 + 1)) })
        sectionBeforeSplit = Dictionary(uniqueKeysWithValues: moving.map { ($0.id, $0.sectionId) })
        // One ⌘Z takes back the section and returns its to-dos.
        change {
            sections.append(section)
            for index in sections.indices {
                if let order = orders[sections[index].id] { sections[index].sortOrder = order }
            }
            for index in todos.indices where sectionBeforeSplit[todos[index].id] != nil {
                todos[index].sectionId = section.id
            }
        }
        isNewSection = true
        sectionDraft = ""
        namingSectionID = section.id
        return true
    }

    /// Double-clicking a section's heading.
    func startRenamingSection(_ id: String) {
        guard let section = sections.first(where: { $0.id == id }) else { return }
        finishNamingSection()
        finishRenamingProject()
        commitEdit()
        sectionDraft = section.name
        isNewSection = false
        namingSectionID = id
    }

    /// Keeps the name. A new section is then ready for new to-dos. With nothing
    /// typed, a new section goes away and an existing one keeps its old name.
    func finishNamingSection() {
        guard let id = namingSectionID, let index = sections.firstIndex(where: { $0.id == id }) else { return }
        let name = sectionDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            cancelNamingSection()
            return
        }
        namingSectionID = nil
        sectionDraft = ""
        guard isNewSection else {
            if name != sections[index].name { change { sections[index].name = name } }
            return
        }
        sectionBeforeSplit = [:]
        sections[index].name = name
        newestSectionID = id
        selectedID = nil
        scheduleSave()
    }

    func cancelNamingSection() {
        guard let id = namingSectionID else { return }
        namingSectionID = nil
        sectionDraft = ""
        guard isNewSection else { return }
        undoStack.removeLast()
        for index in todos.indices {
            if let before = sectionBeforeSplit[todos[index].id] { todos[index].sectionId = before }
        }
        sectionBeforeSplit = [:]
        sections.removeAll { $0.id == id }
    }

    /// Drag to reorder: the section lands before `before`, or last. Its to-dos come
    /// along, since they belong to it.
    func moveSection(_ id: String, before: String?) {
        guard let moving = sections.first(where: { $0.id == id }), before != id else { return }
        let current = sections.filter { $0.projectId == moving.projectId }.sorted { $0.sortOrder < $1.sortOrder }
        var own = current.filter { $0.id != id }
        own.insert(moving, at: before.flatMap { target in own.firstIndex { $0.id == target } } ?? own.count)
        guard own.map(\.id) != current.map(\.id) else { return }
        let orders = Dictionary(uniqueKeysWithValues: own.enumerated().map { ($1.id, Double($0 + 1)) })
        change {
            for index in sections.indices {
                if let order = orders[sections[index].id] { sections[index].sortOrder = order }
            }
        }
    }

    /// Removes the section, not its to-dos: they join the end of the section above,
    /// or the project's loose to-dos if it was first.
    func deleteSection(_ id: String) {
        guard let section = sections.first(where: { $0.id == id }) else { return }
        finishNamingSection()
        let own = sections.filter { $0.projectId == section.projectId }.sorted { $0.sortOrder < $1.sortOrder }
        guard let position = own.firstIndex(where: { $0.id == id }) else { return }
        let heir = position > 0 ? own[position - 1].id : nil
        let moving = groups.first { $0.id == id }?.todos ?? []
        let staying = groups.first { $0.id == (heir ?? "loose") }?.todos ?? []
        var next = (staying.map(\.sortOrder).max() ?? 0) + 1
        var orders: [String: Double] = [:]
        for todo in moving {
            orders[todo.id] = next
            next += 1
        }
        change {
            for index in todos.indices where todos[index].sectionId == id {
                todos[index].sectionId = heir
                if let order = orders[todos[index].id] { todos[index].sortOrder = order }
            }
            sections.removeAll { $0.id == id }
        }
        if newestSectionID == id { newestSectionID = nil }
    }

    /// Dropping to-dos on a section heading.
    func file(_ ids: Set<String>, toSection sectionId: String) {
        select(ids)
        changeSelected { $0.sectionId = sectionId }
    }

    /// A new project opens straight away, with the cursor in its header.
    /// A reminder collected from Apple's Reminders. Not an undo step, or ⌘Z could
    /// take it back out with the reminder already gone. Same id, nothing new.
    func addFromReminder(id: String, title: String, notes: String?, createdAt: Date) {
        guard !todos.contains(where: { $0.id == id }) else { return }
        let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let first = todos.filter { $0.bucket == .inbox }.map(\.sortOrder).min() ?? 0
        let trimmedNotes = notes?.trimmingCharacters(in: .whitespacesAndNewlines)
        todos.append(Todo(
            id: id, title: text, notes: TodoMerge.notesHTML(fromPlain: trimmedNotes), bucket: .inbox,
            assigneeEmail: me, creatorEmail: me, projectId: nil, sectionId: nil, snoozedUntil: nil, completedAt: nil,
            sortOrder: first - 1, createdAt: Self.stamp(createdAt)))
        undoStack.removeAll()
        redoStack.removeAll()
        onLocalChange?()
    }

    func startNewProject() {
        finishNamingSection()
        finishRenamingProject()
        commitEdit()
        // In the same group as the project on screen, else the first group.
        var area = orderedAreas.first?.id
        if case .project(let current) = destination, let own = projects.first(where: { $0.id == current })?.areaId {
            area = own
        }
        let last = area.map { projects(in: $0) }?.map(\.sortOrder).max() ?? 0
        let project = TodoProject(id: UUID().uuidString.lowercased(), name: "", sortOrder: last + 1, areaId: area)
        if let area, let index = areas.firstIndex(where: { $0.id == area }) { areas[index].isCollapsed = false }
        returnFromNewProject = destination
        nameBeforeRenaming = ""
        projects.append(project)
        rememberLeaving(destination)
        destination = .project(project.id)
        selectedID = nil
        renamingProjectID = project.id
    }

    /// Clicking into the header of the project on screen, or double-clicking its
    /// row in the sidebar.
    func startRenamingProject(inSidebar: Bool = false) {
        guard renamingProjectID == nil, case .project(let id) = destination,
            let project = projects.first(where: { $0.id == id })
        else { return }
        nameBeforeRenaming = project.name
        isRenamingInSidebar = inSidebar
        renamingProjectID = id
    }

    /// Drag in the sidebar: into a group, at `index` among its projects.
    func moveProject(_ id: String, toArea area: String, index: Int) {
        guard let moving = projects.first(where: { $0.id == id }) else { return }
        var own = projects(in: area).filter { $0.id != id }
        own.insert(moving, at: min(max(index, 0), own.count))
        var updated = projects
        for (position, project) in own.enumerated() {
            guard let at = updated.firstIndex(where: { $0.id == project.id }) else { continue }
            updated[at].sortOrder = Double(position + 1)
            updated[at].areaId = area
        }
        projects = updated
        scheduleSave()
    }

    // MARK: Project groups

    func startNewArea() {
        commitEdit()
        finishRenamingProject()
        let last = areas.map(\.sortOrder).max() ?? 0
        let area = TodoArea(id: UUID().uuidString.lowercased(), name: "", sortOrder: last + 1)
        areas.append(area)
        areaDraft = ""
        isNewArea = true
        namingAreaID = area.id
    }

    func startRenamingArea(_ id: String) {
        guard let area = areas.first(where: { $0.id == id }) else { return }
        commitEdit()
        finishRenamingProject()
        areaDraft = area.name
        isNewArea = false
        namingAreaID = id
    }

    /// Keeps the name. With nothing typed, a new group goes away and an existing
    /// one keeps its old name.
    func finishNamingArea() {
        guard let id = namingAreaID else { return }
        let name = areaDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            cancelNamingArea()
            return
        }
        namingAreaID = nil
        if let index = areas.firstIndex(where: { $0.id == id }) { areas[index].name = name }
        scheduleSave()
    }

    func cancelNamingArea() {
        guard let id = namingAreaID else { return }
        namingAreaID = nil
        if isNewArea { areas.removeAll { $0.id == id } }
    }

    func toggleArea(_ id: String) {
        guard let index = areas.firstIndex(where: { $0.id == id }) else { return }
        areas[index].isCollapsed = !(areas[index].isCollapsed ?? false)
        scheduleSave()
    }

    private func expandArea(ofProject id: String) {
        guard let area = projects.first(where: { $0.id == id })?.areaId,
            let index = areas.firstIndex(where: { $0.id == area }), areas[index].isCollapsed == true
        else { return }
        areas[index].isCollapsed = false
    }

    /// Removes the group, not its projects: they join the group above it, or the
    /// one below if it was first. The last group stays.
    func deleteArea(_ id: String) {
        let ordered = orderedAreas
        guard ordered.count > 1, let position = ordered.firstIndex(where: { $0.id == id }) else { return }
        let heir = ordered[position == 0 ? 1 : position - 1].id
        var next = (projects(in: heir).map(\.sortOrder).max() ?? 0) + 1
        var updated = projects
        for project in projects(in: id) {
            guard let at = updated.firstIndex(where: { $0.id == project.id }) else { continue }
            updated[at].areaId = heir
            updated[at].sortOrder = next
            next += 1
        }
        projects = updated
        if let index = areas.firstIndex(where: { $0.id == heir }) { areas[index].isCollapsed = false }
        areas.removeAll { $0.id == id }
        scheduleSave()
    }

    /// Follows each keystroke, so the sidebar names the project as you type.
    func updateProjectName(_ name: String) {
        guard let id = renamingProjectID, let index = projects.firstIndex(where: { $0.id == id }) else { return }
        projects[index].name = name
    }

    /// Keeps the name. With nothing typed, an existing project keeps its old
    /// name and a brand-new one goes away.
    func finishRenamingProject() {
        guard let id = renamingProjectID, let index = projects.firstIndex(where: { $0.id == id }) else { return }
        let name = projects[index].name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            cancelRenamingProject()
            return
        }
        renamingProjectID = nil
        isRenamingInSidebar = false
        returnFromNewProject = nil
        projects[index].name = name
        if selectedID == nil { selectedID = visible.first?.id }
        scheduleSave()
    }

    func cancelRenamingProject() {
        guard let id = renamingProjectID else { return }
        renamingProjectID = nil
        isRenamingInSidebar = false
        if let previous = returnFromNewProject {
            returnFromNewProject = nil
            projects.removeAll { $0.id == id }
            destination = previous
            selectedID = visible.first?.id
        } else if let index = projects.firstIndex(where: { $0.id == id }) {
            projects[index].name = nameBeforeRenaming
        }
    }

    // MARK: Focus

    // One Today to-do at a time, as on the website: Today is where the day is
    // planned, focus is where it's worked. Every way forward takes the to-do out
    // of Today (done, snoozed, moved), so there's deliberately no skip. The card
    // is whichever Today to-do is selected, so the list's own actions, undo and
    // its pick of what comes next all work here unchanged.

    private(set) var focusing = false
    /// When this focus began, for the count of what's been done in it.
    @ObservationIgnored private var focusStarted = ""
    /// The card's name and notes as typed, saved as one change when it moves on.
    @ObservationIgnored var focusDraft: (id: String, title: String, notes: String)?

    var focusQueue: [Todo] { tasks(for: .view(.today)) }

    /// The selected Today to-do, or the top of Today when that one has gone
    /// (finished on another device, say). Nil once Today is clear.
    var focusTask: Todo? {
        let queue = focusQueue
        return queue.first { $0.id == selectedID } ?? queue.first
    }

    /// Finished since focus began. Counted from the list, so ⌘Z takes one back.
    var focusDone: Int {
        guard focusing else { return 0 }
        return todos.filter { $0.assigneeEmail == me && ($0.completedAt ?? "") >= focusStarted }.count
    }

    /// Starts on the selected to-do if it's in Today, else at the top. False, and
    /// nothing changes, when Today is empty.
    @discardableResult
    func startFocus() -> Bool {
        guard !focusing else { return true }
        let queue = focusQueue
        guard !queue.isEmpty else { return false }
        let start = queue.first { $0.id == selectedID } ?? queue[0]
        commitEdit()
        go(.view(.today))
        selectedID = start.id
        focusStarted = Self.stamp(Date())
        focusing = true
        return true
    }

    /// Back to Today, with the to-do you were on selected.
    func endFocus() {
        guard focusing else { return }
        commitFocusEdit()
        focusing = false
        if let task = focusTask { selectedID = task.id }
    }

    func toggleFocus() -> Bool {
        if focusing {
            endFocus()
            return true
        }
        return startFocus()
    }

    func commitFocusEdit() {
        guard let draft = focusDraft else { return }
        focusDraft = nil
        edit(draft.id, title: draft.title, notes: draft.notes)
    }

    private func onFocusTask(_ body: () -> Void) {
        commitFocusEdit()
        guard let task = focusTask else { return }
        selectedID = task.id
        body()
    }

    func focusComplete() { onFocusTask { completeSelected() } }
    func focusSnooze(until date: Date) { onFocusTask { snoozeSelected(until: date) } }
    func focusMove(to bucket: Bucket) { onFocusTask { moveSelected(to: bucket) } }

    func focusUndo() {
        commitFocusEdit()
        undo()
    }

    func focusRedo() {
        commitFocusEdit()
        redo()
    }

    // MARK: Saving

    /// On quitting: the usual save waits a moment, and would never happen.
    func saveNow() {
        commitFocusEdit()
        closeOpen()
        finishNamingSection()
        finishRenamingProject()
        commitEdit()
        saveToDiskNow()
    }

    func saveToDiskNow() {
        guard let saveFile else { return }
        saveTask?.cancel()
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let library = TodoLibrary(tasks: todos, projects: projects, sections: sections, areas: areas)
        try? encoder.encode(library).write(to: saveFile, options: .atomic)
    }

    private func scheduleSave() {
        onLocalChange?()
        writeToDisk()
    }

    private func writeToDisk() {
        guard let saveFile else { return }
        saveTask?.cancel()
        let library = TodoLibrary(tasks: todos, projects: projects, sections: sections, areas: areas)
        saveTask = Task.detached(priority: .utility) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            try? encoder.encode(library).write(to: saveFile, options: .atomic)
        }
    }

    // MARK: Dates

    static func tomorrow(from now: Date = Date()) -> Date {
        let calendar = Calendar.current
        return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
    }

    /// The coming Monday at midnight, where this week ends.
    static func startOfNextWeek(from now: Date = Date()) -> Date {
        let calendar = Calendar.current
        let monday = DateComponents(weekday: 2)
        return calendar.nextDate(after: now, matching: monday, matchingPolicy: .nextTime) ?? now
    }

    /// The coming Saturday at midnight.
    static func thisWeekend(from now: Date = Date()) -> Date {
        let calendar = Calendar.current
        let saturday = DateComponents(weekday: 7)
        return calendar.nextDate(after: now, matching: saturday, matchingPolicy: .nextTime) ?? now
    }

    nonisolated static func stamp(_ date: Date) -> String {
        date.formatted(.iso8601)
    }
}
