import MasonKit
import SwiftUI
import UIKit

// The to-do list on the iPhone: the same list and sync as the Mac, built for one
// hand. It opens straight into Today from a file on the phone, so nothing waits on
// the network.

enum PhoneLook {
    /// The website's Todos green, lifted for dark mode.
    static let accent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.45, green: 0.74, blue: 0.64, alpha: 1)
            : UIColor(red: 0.23, green: 0.39, blue: 0.34, alpha: 1)
    })
    /// The family site's warm paper in light mode, a warm near-black in dark.
    static let paper = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.11, green: 0.105, blue: 0.095, alpha: 1)
            : UIColor(red: 0.98, green: 0.97, blue: 0.94, alpha: 1)
    })

    /// Each list's color, as on the Mac and the website.
    static func color(_ view: TodoView) -> Color {
        switch view {
        case .inbox: .blue
        case .today: .yellow
        case .week: .orange
        case .snoozed: .indigo
        case .anytime: .teal
        case .someday: .brown
        case .delegated: .pink
        case .logbook: .green
        }
    }
}

@MainActor
@Observable
final class PhoneModel {
    let store: TodoStore
    var sync: TodoSync?
    private var reminders: RemindersImport?
    var path: [Destination]

    /// Runs on saved data only, sending nothing. For the simulator.
    private let isLocalOnly = CommandLine.arguments.contains("--local")

    init() {
        let folder = URL.applicationSupportDirectory.appending(path: "io.mason.todos")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: "todos.json")
        let data = (try? Data(contentsOf: file)) ?? Data()
        let library = (try? TodoStore.decode(data)) ?? TodoLibrary(tasks: [], projects: [], sections: [])
        store = TodoStore(library: library, saveFile: isLocalOnly ? nil : file)
        path = [.view(.today)]
        store.selectedID = nil

        if let at = CommandLine.arguments.firstIndex(of: "--open"), CommandLine.arguments.count > at + 1 {
            let name = CommandLine.arguments[at + 1]
            if name == "home" {
                path = []
            } else if let project = store.projects.first(where: { $0.name == name }) {
                open(.project(project.id))
            } else if let view = TodoView(rawValue: name) {
                open(.view(view))
            }
        }
    }

    func startSync() {
        guard !isLocalOnly, sync == nil else { return }
        let base = URL.applicationSupportDirectory.appending(path: "io.mason.todos").appending(path: "synced.json")
        let sync = TodoSync(store: store, baseFile: base)
        self.sync = sync
        sync.start()
        let reminders = RemindersImport(store: store)
        self.reminders = reminders
        reminders.start()
    }

    func sweepReminders() {
        reminders?.sweep()
    }

    func open(_ destination: Destination) {
        store.go(destination)
        store.selectedID = nil
        path = [destination]
    }
}

@main
struct TodosPhoneApp: App {
    @State private var model = PhoneModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var backgroundTask = UIBackgroundTaskIdentifier.invalid

    var body: some Scene {
        WindowGroup {
            PhoneRoot(model: model)
                .tint(PhoneLook.accent)
                .task { model.startSync() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.sweepReminders() }
            guard phase == .background else { return }
            // A little time to get the last change away before the phone suspends us.
            backgroundTask = UIApplication.shared.beginBackgroundTask { endBackgroundTask() }
            model.sync?.kick()
            Task {
                try? await Task.sleep(for: .seconds(5))
                endBackgroundTask()
            }
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}

struct PhoneRoot: View {
    @Bindable var model: PhoneModel

    var body: some View {
        if model.store.todos.isEmpty, model.sync?.status == .signedOut {
            SignInView(appName: "Todos", symbol: "checkmark.circle")
        } else {
            NavigationStack(path: $model.path) {
                PhoneHome(model: model)
                    .navigationDestination(for: Destination.self) { destination in
                        TodoListScreen(store: model.store, destination: destination)
                    }
            }
        }
    }
}

// MARK: - Home

struct PhoneHome: View {
    let model: PhoneModel
    @State private var isAdding = false

    private var store: TodoStore { model.store }

    var body: some View {
        List {
            Section {
                listRow(.inbox)
            }
            Section {
                listRow(.today)
                listRow(.week)
                listRow(.snoozed)
                listRow(.anytime)
                listRow(.someday)
                listRow(.delegated)
            }
            Section {
                listRow(.logbook)
            }
            ForEach(store.orderedAreas) { area in
                Section {
                    groupRow(area)
                    if area.isCollapsed != true {
                        ForEach(store.projects(in: area.id)) { project in
                            projectRow(project)
                        }
                    }
                }
            }
            statusRow
        }
        .listSectionSpacing(14)
        .environment(\.defaultMinListRowHeight, 40)
        .scrollContentBackground(.hidden)
        .background(PhoneLook.paper)
        .navigationTitle("Todos")
        .overlay(alignment: .bottomTrailing) {
            AddButton { isAdding = true }
        }
        .sheet(isPresented: $isAdding) {
            CaptureSheet(placeholder: "Add to Inbox") { store.addToInbox($0) }
        }
    }

    private func listRow(_ view: TodoView) -> some View {
        Button {
            model.open(.view(view))
        } label: {
            HStack {
                Label {
                    Text(view.label)
                } icon: {
                    Image(systemName: view.symbol).foregroundStyle(PhoneLook.color(view))
                }
                Spacer()
                if let count = store.count(view), count > 0 {
                    Text("\(count)").foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The group's name folds it; collapsed, it says how many projects are inside.
    private func groupRow(_ area: TodoArea) -> some View {
        Button {
            withAnimation(.snappy) { store.toggleArea(area.id) }
        } label: {
            HStack {
                Label {
                    Text(area.name).fontWeight(.semibold)
                } icon: {
                    Image(systemName: "shippingbox").foregroundStyle(.secondary)
                }
                Spacer()
                if area.isCollapsed == true {
                    Text("\(store.projects(in: area.id).count)").foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func projectRow(_ project: TodoProject) -> some View {
        Button {
            model.open(.project(project.id))
        } label: {
            HStack {
                Label {
                    Text(project.name)
                } icon: {
                    Image(systemName: "folder").foregroundStyle(.tertiary)
                }
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var statusRow: some View {
        switch model.sync?.status {
        case .signedOut:
            Button("Sign in to sync") { model.sync?.signIn() }
        case .failing(let reason):
            Button {
                model.sync?.kick()
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Can't sync right now")
                    Text(reason).font(.caption).foregroundStyle(.secondary)
                }
            }
        default:
            EmptyView()
        }
    }
}

// MARK: - A list

struct TodoListScreen: View {
    @Bindable var store: TodoStore
    let destination: Destination

    @State private var isAdding = false
    @State private var opened: Todo?
    @State private var snoozing: Todo?
    @State private var ticked: Set<String> = []

    private var canAdd: Bool {
        switch destination {
        case .view(.snoozed), .view(.delegated), .view(.logbook): false
        default: true
        }
    }

    private var title: String {
        switch destination {
        case .view(let view): view.label
        case .project(let id): store.projects.first { $0.id == id }?.name ?? "Project"
        }
    }

    var body: some View {
        // Coming back from another list can draw this one a frame before it's current.
        let groups = store.destination == destination ? store.groups : []
        List {
            ForEach(groups) { group in
                Section {
                    ForEach(group.todos) { todo in
                        row(todo)
                    }
                    .onMove { offsets, target in
                        move(in: group, offsets: offsets, to: target)
                    }
                } header: {
                    if let name = group.name {
                        Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(Color.primary.opacity(0.55)).textCase(nil)
                    }
                }
            }
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 34)
        .scrollContentBackground(.hidden)
        .background(PhoneLook.paper)
        .overlay {
            if groups.isEmpty {
                ContentUnavailableView {
                    Text("Nothing here")
                }
            }
        }
        .navigationTitle(title)
        .overlay(alignment: .bottomTrailing) {
            if canAdd {
                AddButton { isAdding = true }
            }
        }
        .onAppear {
            store.go(destination)
            store.selectedID = nil
        }
        .sheet(isPresented: $isAdding) {
            CaptureSheet(placeholder: "New To-Do") { store.pasteTodos($0) }
        }
        .sheet(item: $opened) { todo in
            TodoDetailSheet(store: store, todo: todo)
        }
        .sheet(item: $snoozing) { todo in
            SnoozeSheet { date in
                store.selectedID = todo.id
                store.snoozeSelected(until: date)
                store.selectedID = nil
            }
        }
    }

    private func move(in group: TodoGroup, offsets: IndexSet, to target: Int) {
        let ids = Set(offsets.map { group.todos[$0].id })
        let before = target < group.todos.count ? group.todos[target].id : nil
        store.move(ids, toGroup: group.id, before: before)
        store.selectedID = nil
    }

    private func row(_ todo: Todo) -> some View {
        PhoneTodoRow(
            todo: todo, marker: store.marker(for: todo), detail: store.detail(for: todo),
            isTicked: ticked.contains(todo.id)
        ) {
            tick(todo)
        }
        .contentShape(Rectangle())
        .onTapGesture { opened = todo }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 20))
        .moveDisabled(!isManual)
        .swipeActions(edge: .leading) {
            Button { tick(todo) } label: {
                Label(todo.completedAt == nil ? "Complete" : "Bring Back", systemImage: "checkmark")
            }
            .tint(PhoneLook.accent)
        }
        .swipeActions(edge: .trailing) {
            Button { snoozing = todo } label: { Label("Snooze", systemImage: "moon") }
                .tint(.indigo)
            if todo.bucket != .today || todo.snoozedUntil != nil {
                Button { file(todo, to: .view(.today)) } label: { Label("Today", systemImage: "star") }
                    .tint(.yellow)
            }
        }
        .contextMenu {
            Button { opened = todo } label: { Label("Open", systemImage: "doc.text") }
            Button { tick(todo) } label: {
                Label(todo.completedAt == nil ? "Complete" : "Bring Back", systemImage: "checkmark.circle")
            }
            Menu {
                ForEach([TodoView.inbox, .today, .week, .anytime, .someday]) { view in
                    Button { file(todo, to: .view(view)) } label: { Label(view.label, systemImage: view.symbol) }
                }
                ForEach(store.orderedProjects) { project in
                    Button { file(todo, to: .project(project.id)) } label: { Label(project.name, systemImage: "folder") }
                }
            } label: {
                Label("Move to", systemImage: "tray.and.arrow.down")
            }
            Button { snoozing = todo } label: { Label("Snooze", systemImage: "moon") }
            Button(role: .destructive) {
                store.selectedID = todo.id
                store.deleteSelected()
                store.selectedID = nil
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    /// Lists with a manual order can be rearranged; a project's sections, and the
    /// projects within This Week, Anytime and Someday, each keep their own order.
    private var isManual: Bool {
        switch destination {
        case .view(.snoozed), .view(.delegated), .view(.logbook): false
        default: true
        }
    }

    private func file(_ todo: Todo, to place: Destination) {
        store.file([todo.id], to: place)
        store.selectedID = nil
    }

    /// The circle fills first, then the row leaves, so you see what you did.
    private func tick(_ todo: Todo) {
        guard !ticked.contains(todo.id) else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        ticked.insert(todo.id)
        Task {
            try? await Task.sleep(for: .milliseconds(280))
            withAnimation(.snappy) {
                store.toggleComplete(todo.id)
                store.selectedID = nil
            }
            ticked.remove(todo.id)
        }
    }
}

struct PhoneTodoRow: View {
    let todo: Todo
    let marker: TodoView?
    let detail: String?
    let isTicked: Bool
    let onTick: () -> Void

    private var looksDone: Bool { (todo.completedAt != nil) != isTicked }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Button(action: onTick) {
                Image(systemName: looksDone ? "checkmark.circle.fill" : "circle")
                    .font(.title3.weight(.light))
                    .foregroundStyle(looksDone ? PhoneLook.accent : Color.secondary)
                    .contentTransition(.symbolEffect(.replace))
                    // Big enough for a thumb, without spreading the row out.
                    .padding(.vertical, 6)
                    .padding(.trailing, 4)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let marker {
                Image(systemName: marker.symbol)
                    .font(.footnote)
                    .foregroundStyle(PhoneLook.color(marker))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(todo.title)
                    .foregroundStyle(todo.completedAt == nil ? .primary : .secondary)
                if let notes = todo.notes, let first = notes.split(whereSeparator: \.isNewline).first {
                    Text(first).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if let detail {
                Text(detail).font(.caption).foregroundStyle(.tertiary)
            }
        }
    }
}

// MARK: - Sheets and the add button

struct AddButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.title2.weight(.semibold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .accessibilityLabel("New To-Do")
        .padding(.trailing, 20)
        .padding(.bottom, 12)
    }
}

/// Type, Return, and it's in. The field stays ready for the next one.
struct CaptureSheet: View {
    let placeholder: String
    let add: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 12) {
            TextField(placeholder, text: $text)
                .font(.title3)
                .focused($focused)
                .submitLabel(.next)
                .onSubmit {
                    save()
                    focused = true
                }
            Button("Done") {
                save()
                dismiss()
            }
            .fontWeight(.semibold)
        }
        .padding(.horizontal, 24)
        .presentationDetents([.height(84)])
        .presentationDragIndicator(.hidden)
        .onAppear { focused = true }
    }

    private func save() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        add(trimmed)
        text = ""
    }
}

/// A to-do's name and notes, saved when it closes.
struct TodoDetailSheet: View {
    let store: TodoStore
    let todo: Todo

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var notes: String

    init(store: TodoStore, todo: Todo) {
        self.store = store
        self.todo = todo
        _title = State(initialValue: todo.title)
        _notes = State(initialValue: todo.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("New To-Do", text: $title, axis: .vertical)
                    .font(.title3.weight(.semibold))
                ZStack(alignment: .topLeading) {
                    if notes.isEmpty {
                        Text("Notes").foregroundStyle(.tertiary).padding(.top, 8).padding(.leading, 5)
                    }
                    TextEditor(text: $notes).scrollContentBackground(.hidden)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onDisappear { store.edit(todo.id, title: title, notes: notes) }
    }
}

/// When to wake a to-do: the usual choices, or typed, like "tomorrow 3pm".
struct SnoozeSheet: View {
    let snooze: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    private var presets: [SnoozeSuggestion] {
        let now = Date()
        func day(_ date: Date) -> String { date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
        var list: [SnoozeSuggestion] = []
        if let evening = Calendar.current.date(bySettingHour: 17, minute: 0, second: 0, of: now), evening > now {
            list.append(SnoozeSuggestion(when: evening, label: "This Evening", hint: evening.formatted(date: .omitted, time: .shortened)))
        }
        let (tomorrow, weekend, week) = (TodoStore.tomorrow(from: now), TodoStore.thisWeekend(from: now), TodoStore.startOfNextWeek(from: now))
        list.append(SnoozeSuggestion(when: tomorrow, label: "Tomorrow", hint: day(tomorrow)))
        list.append(SnoozeSuggestion(when: weekend, label: "This Weekend", hint: day(weekend)))
        list.append(SnoozeSuggestion(when: week, label: "Next Week", hint: day(week)))
        return list
    }

    var body: some View {
        let options = text.isEmpty ? presets : SnoozeSuggest.suggestions(for: text)
        List {
            Section {
                TextField("Try “tomorrow 3pm” or “dec 12”", text: $text)
                    .focused($focused)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                    .onSubmit {
                        if let first = options.first { choose(first.when) }
                    }
            }
            Section {
                ForEach(options, id: \.when) { option in
                    Button {
                        choose(option.when)
                    } label: {
                        HStack {
                            Text(option.label).foregroundStyle(.primary)
                            Spacer()
                            Text(option.hint).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func choose(_ date: Date) {
        snooze(date)
        dismiss()
    }
}
