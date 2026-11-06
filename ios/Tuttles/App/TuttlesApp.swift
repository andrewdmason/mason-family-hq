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
    }
}

enum Route: Hashable {
    /// `isNew`: a chat with nothing in it yet, whose id is made here.
    case chat(UUID, isNew: Bool)
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
        return [.chat(UUID(), isNew: true)]
    }

    var body: some View {
        NavigationStack(path: $path) {
            ThreadListView(path: $path)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .chat(let id, let isNew):
                        ChatView(threadID: id, isNew: isNew, title: store.threads.first { $0.id == id }?.title)
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
            if let error = store.listError {
                Text(error).foregroundStyle(.secondary)
            }
            ForEach(store.threads) { thread in
                NavigationLink(value: Route.chat(thread.id, isNew: false)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(thread.title ?? "New chat")
                            .font(.body.weight(.medium))
                            .lineLimit(1)
                        Text(thread.updatedAt, format: .relative(presentation: .named))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
                .swipeActions {
                    Button("Archive", systemImage: "archivebox") {
                        Task { await store.archive(thread) }
                    }
                    .tint(.indigo)
                }
            }
        }
        .overlay {
            if store.threads.isEmpty, store.listError == nil {
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
        .refreshable { await store.refreshThreads() }
        .task(id: path.count) {
            // Back on the list: pick up the chat just had and its new title.
            if path.isEmpty { await store.refreshThreads() }
        }
        .task { await store.refreshThreads() }
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
