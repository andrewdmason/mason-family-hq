import MasonKit
import SwiftUI

// Tuttles: a homework tutor for the kids. It opens on a new chat with the
// camera one tap away; earlier chats are a step back. The tutor guides rather
// than answers (src/lib/tuttles/prompt.ts), and parents read every chat on the
// website at /tuttles.

enum TuttlesLook {
    /// Hydrant red, from the app icon.
    static let accent = Color(red: 0.84, green: 0.15, blue: 0.12)
}

@main
struct TuttlesApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(TuttlesLook.accent)
        }
    }
}

struct RootView: View {
    @State private var session = Session.shared
    @State private var store = ChatStore()

    var body: some View {
        Group {
            if store.isDemo || (session.checked && session.isSignedIn) {
                ChatsView()
                    .environment(store)
            } else if !session.checked {
                ProgressView()
            } else {
                SignInView(appName: "Tuttles", symbol: "pencil.and.scribble")
            }
        }
        .animation(.default, value: session.isSignedIn)
        // The app opens on a new chat, so the list behind it loads now: it's
        // ready by the time anyone goes back to it.
        .task(id: session.userID) {
            guard store.isDemo || session.userID != nil else { return }
            store.loadSaved()
            async let threads: Void = store.refreshThreads()
            async let classes: Void = store.refreshClasses()
            _ = await (threads, classes)
        }
    }
}

enum Route: Hashable {
    /// `isNew`: a chat with nothing in it yet, whose id is made here. A new
    /// chat can be about an assignment (`start`) or begun from a class page.
    case chat(UUID, isNew: Bool, start: ChatStart? = nil, courseID: Int? = nil)
    case classPage(Int)
}

/// The chats, with a new one open on top.
struct ChatsView: View {
    @Environment(ChatStore.self) private var store
    @State private var path: [Route] = ChatsView.firstRoute

    /// A new chat, or with `--demo --open <n>`, the nth canned one.
    private static var firstRoute: [Route] {
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--open"), args.count > at + 1, let n = Int(args[at + 1]),
           DemoChats.threads.indices.contains(n) {
            return [.chat(DemoChats.threads[n].id, isNew: false)]
        }
        if args.contains("--list") { return [] }
        if let at = args.firstIndex(of: "--class"), args.count > at + 1, let id = Int(args[at + 1]) {
            return [.classPage(id)]
        }
        return [.chat(UUID(), isNew: true)]
    }

    var body: some View {
        NavigationStack(path: $path) {
            ThreadListView(path: $path)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .chat(let id, let isNew, let start, let courseID):
                        ChatView(threadID: id, isNew: isNew, title: store.threads.first { $0.id == id }?.title,
                                 courseID: courseID, start: start)
                    case .classPage(let id):
                        ClassPageView(courseID: id, path: $path)
                    }
                }
        }
    }
}

private struct ThreadListView: View {
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store

    var body: some View {
        List {
            if let classes = store.classes, !classes.classes.isEmpty {
                if !classes.dueSoon.isEmpty {
                    Section {
                        DueSoonStrip(items: classes.dueSoon, classes: classes.classes) { a in
                            path.append(.chat(UUID(), isNew: true, start: ChatStart(assignment: a)))
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    } header: {
                        Text("Due soon")
                    }
                }
                Section("Classes") {
                    ForEach(classes.classes) { info in
                        NavigationLink(value: Route.classPage(info.id)) {
                            HStack(spacing: 12) {
                                RoundedRectangle(cornerRadius: 3).fill(info.tint).frame(width: 6, height: 28)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(info.shortName).font(.body.weight(.medium))
                                    if let unit = info.unit {
                                        Text(unit.name).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                                Spacer()
                                let newFeedback = info.feedback.filter(\.isNew).count
                                if newFeedback > 0 {
                                    Text("\(newFeedback) new")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 7).padding(.vertical, 2)
                                        .background(TuttlesLook.accent, in: .capsule)
                                }
                            }
                        }
                    }
                }
            }
            if !store.classesLoaded {
                ClassesPlaceholder()
            }
            Section(store.classes == nil && store.classesLoaded ? "" : "Chats") {
                if !store.threadsLoaded {
                    ForEach(0..<3, id: \.self) { _ in
                        ThreadRow(thread: TutorThread(id: UUID(), title: "Loading a chat title", updatedAt: .now), info: nil)
                            .redacted(reason: .placeholder)
                    }
                }
                if let error = store.listError {
                    Text(error).foregroundStyle(.secondary)
                }
                ForEach(store.threads) { thread in
                    NavigationLink(value: Route.chat(thread.id, isNew: false)) {
                        ThreadRow(thread: thread, info: store.classInfo(thread.courseId))
                    }
                    .contextMenu {
                        if let classes = store.classes?.classes {
                            Picker("Class", selection: Binding(
                                get: { thread.courseId },
                                set: { id in Task { await store.setCourse(thread, to: id) } }
                            )) {
                                Text("No class").tag(Int?.none)
                                ForEach(classes) { Text($0.shortName).tag(Optional($0.id)) }
                            }
                        }
                        Button("Archive", systemImage: "archivebox") {
                            Task { await store.archive(thread) }
                        }
                    }
                    .swipeActions {
                        Button("Archive", systemImage: "archivebox") {
                            Task { await store.archive(thread) }
                        }
                        .tint(.indigo)
                    }
                }
            }
        }
        .overlay {
            if store.threadsLoaded, store.classesLoaded, store.threads.isEmpty, store.classes == nil, store.listError == nil {
                ContentUnavailableView("No chats yet", systemImage: "bubble.left.and.text.bubble.right",
                                       description: Text("Start one with the pencil button."))
            }
        }
        .navigationTitle("Tuttles")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { AccountMenu() }
            ToolbarItem(placement: .topBarTrailing) {
                Button("New chat", systemImage: "square.and.pencil") {
                    path.append(.chat(UUID(), isNew: true))
                }
            }
        }
        .refreshable {
            async let threads: Void = store.refreshThreads()
            async let classes: Void = store.refreshClasses()
            _ = await (threads, classes)
        }
        .task(id: path.count) {
            // Back on the list: pick up the chat just had and its new title.
            if path.isEmpty {
                await store.refreshThreads()
                await store.refreshClasses()
            }
        }
        .animation(.default, value: store.classes?.classes.count)
        .animation(.default, value: store.threads.count)
    }
}

/// Who's signed in, and the way out.
private struct AccountMenu: View {
    var body: some View {
        Menu {
            Section(Session.shared.email ?? "Signed in") {
                Button("Sign out", role: .destructive) { Task { await Session.shared.signOut() } }
            }
        } label: {
            Image(systemName: "person.crop.circle")
        }
        .accessibilityLabel("Account")
    }
}
