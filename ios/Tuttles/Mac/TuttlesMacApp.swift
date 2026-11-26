import MasonKit
import SwiftUI

// Tuttles on the Mac: the kids' homework tutor at a desk. The same chats,
// study sets and classes as the iPhone (Shared/), in one window: a sidebar
// where the phone has its slide-out menu, and the chat beside it. There's no
// camera or voice here; homework is dragged, pasted or picked in.

@main
struct TuttlesMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        Window("Tuttles", id: "main") {
            MacRoot()
                .tint(TuttlesLook.accent)
                .frame(minWidth: 760, minHeight: 520)
        }
        .defaultSize(width: 1120, height: 780)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Chat") { NotificationCenter.default.post(name: .newChat, object: nil) }
                    .keyboardShortcut("n")
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// One window: closing it is leaving.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillFinishLaunching(_ notification: Notification) {
        #if DEBUG
        DebugSnapshot.start()
        #endif
    }
}

/// What the app was launched with, for trying it out: `--demo` (canned chats,
/// no sign-in), `--open=<n>` (the nth canned chat), `--class=<id>`, `--study`,
/// `--classes`. Values ride on the flag with an `=`: the Mac takes a bare
/// word after a flag for a file to open, and opens no window.
enum Launch {
    static func value(_ name: String) -> String? {
        let flag = "--\(name)="
        return CommandLine.arguments.first { $0.hasPrefix(flag) }.map { String($0.dropFirst(flag.count)) }
    }
}

extension Notification.Name {
    static let newChat = Notification.Name("tuttles.newChat")
}

struct MacRoot: View {
    @State private var session = Session.shared
    @State private var store = ChatStore()

    var body: some View {
        Group {
            if store.isDemo || (session.checked && session.isSignedIn) {
                MacShell()
                    .environment(store)
            } else if !session.checked {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background { TuttlesBackdrop() }
            } else {
                SignInView(appName: "Tuttles", symbol: "pencil.and.scribble")
                    .frame(maxWidth: 420)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background { TuttlesBackdrop() }
            }
        }
        .animation(.default, value: session.isSignedIn)
        .task(id: session.userID) {
            guard store.isDemo || session.userID != nil else { return }
            store.loadSaved()
            await store.refreshAll()
        }
    }
}

extension ChatStore {
    /// The chats, classes and study sets, all asked for at once.
    func refreshAll() async {
        async let threads: Void = refreshThreads()
        async let classes: Void = refreshClasses()
        async let study: Void = refreshStudy()
        _ = await (threads, classes, study)
    }
}

/// The window: the sidebar, and one thing open beside it (a chat, usually).
/// Picking in the sidebar swaps what's open; anything opened from there (a
/// class's assignment, a set's quiz) goes on top, with a back button.
struct MacShell: View {
    @Environment(ChatStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var root: Route = MacShell.launch.root
    @State private var path: [Route] = MacShell.launch.path
    @State private var showingMemory = false

    /// A new chat, or with `--demo --open=<n>`, the nth canned one.
    private static var launch: (root: Route, path: [Route]) {
        if let n = Launch.value("open").flatMap(Int.init), DemoChats.threads.indices.contains(n) {
            return (.chat(DemoChats.threads[n].id, isNew: false), [])
        }
        if let id = Launch.value("class").flatMap(Int.init) { return (.classes, [.classPage(id)]) }
        if CommandLine.arguments.contains("--study") { return (.study, []) }
        if CommandLine.arguments.contains("--classes") { return (.classes, []) }
        if CommandLine.arguments.contains("--vocab") { return (.vocab, []) }
        return (.chat(UUID(), isNew: true), [])
    }

    var body: some View {
        NavigationSplitView {
            MacSidebar(current: root, showingMemory: $showingMemory) { open($0) }
                .navigationSplitViewColumnWidth(min: 220, ideal: 264, max: 360)
        } detail: {
            NavigationStack(path: $path) {
                screen(root)
                    .id(root)
                    .navigationDestination(for: Route.self) { screen($0) }
            }
            .environment(\.navigate, TuttlesNavigate { path.append($0) })
        }
        .sheet(isPresented: $showingMemory) {
            MemorySheet(memory: store.classes?.memory, name: store.classes?.student.name ?? "")
                .frame(minWidth: 460, minHeight: 420)
        }
        .onChange(of: store.viewer) {
            // A view starts at its home: the parent's This week, or a new chat for the kid's.
            open(store.showingParentView ? .dashboard : .chat(UUID(), isNew: true))
        }
        .onAppear { if store.showingParentView, ![Route.dashboard, .week, .vocab].contains(root) { root = .dashboard; path = [] } }
        .onReceive(NotificationCenter.default.publisher(for: .newChat)) { _ in
            // A parent's own chats are briefings, started from This week.
            if !store.showingParentView { open(.chat(UUID(), isNew: true)) }
        }
        // Back at the Mac after a while: catch up on what the phone did meanwhile.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.refreshAll() } }
        }
    }

    @ViewBuilder private func screen(_ route: Route) -> some View {
        switch route {
        case .chat(let id, let isNew, let start, let courseID, let briefing, let quiz):
            MacChatView(store: store, threadID: id, isNew: isNew,
                        title: briefing?.title ?? quiz.map { "Quiz: \($0.setTitle)" } ?? store.threads.first { $0.id == id }?.title,
                        courseID: courseID, briefing: briefing, quizStart: quiz, start: start)
        case .studySet(let id):
            StudySetView(setID: id, path: $path).macPage()
        case .topic(let topic, let week):
            TopicView(topic: topic, week: week, path: $path).macPage()
        case .classPage(let id):
            ClassPageView(courseID: id, path: $path).macPage()
        case .classes:
            ClassesListView(path: $path).macPage()
        case .study:
            StudyListView(path: $path).macPage()
        case .week:
            ParentHomeView(path: $path).macPage()
        case .vocab:
            VocabHomeView(path: $path)
        case .vocabList(let kid, let name):
            VocabListView(kid: kid, name: name)
        case .vocabProgress:
            VocabProgressView()
        case .math:
            // The game is the iPhone's.
            ContentUnavailableView("Math is on the iPhone", systemImage: "figure.run")
        case .house:
            ContentUnavailableView("The house is on the iPhone", systemImage: "house")
        case .dashboard:
            ParentDashboardView().macPage()
        }
    }

    /// Swap what's open for something picked in the sidebar.
    private func open(_ route: Route) {
        guard route != root || !path.isEmpty else { return }
        root = route
        path = []
    }
}
