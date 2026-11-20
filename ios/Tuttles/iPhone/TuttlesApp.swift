import MasonKit
import SwiftUI

// Tuttles on the iPhone: a homework tutor for the kids. It opens on a new chat with the
// camera one tap away; classes, study and earlier chats are in the menu that
// slides in from the left (SideMenu.swift). The tutor guides rather
// than answers (src/lib/tuttles/prompt.ts), and parents read every chat on the
// website at /tuttles.

@main
struct TuttlesApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(TuttlesLook.accent)
                // Sebastian's copy comes from family.mason.io/install/tuttles
                // (he's under 13, so no TestFlight); this offers each new build.
                .appUpdateBanner(slug: "tuttles", appName: "Tuttles", tint: TuttlesLook.accent)
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
        // The app opens on a new chat, so the menu behind it loads now: it's
        // ready by the time anyone slides it open.
        .task(id: session.userID) {
            guard store.isDemo || session.userID != nil else { return }
            store.loadSaved()
            async let threads: Void = store.refreshThreads()
            async let classes: Void = store.refreshClasses()
            async let study: Void = store.refreshStudy()
            _ = await (threads, classes, study)
        }
    }
}

/// The screen underneath it all: one thing open (a chat, usually), with the
/// menu (SideMenu.swift) a swipe or a tap to the left. Picking from the menu
/// swaps what's open; anything opened from there pushes on top as before.
struct ChatsView: View {
    @Environment(ChatStore.self) private var store
    @State private var root: Route = ChatsView.launch.root
    @State private var path: [Route] = ChatsView.launch.path
    @State private var menu = SideMenuState(isOpen: ChatsView.launch.menuOpen)
    @State private var showingMemory = false
    @GestureState private var dragX: CGFloat = 0

    /// A new chat, or with `--demo --open <n>`, the nth canned one; `--list` opens the menu.
    private static var launch: (root: Route, path: [Route], menuOpen: Bool) {
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--open"), args.count > at + 1, let n = Int(args[at + 1]),
           DemoChats.threads.indices.contains(n) {
            return (.chat(DemoChats.threads[n].id, isNew: false), [], false)
        }
        if let at = args.firstIndex(of: "--class"), args.count > at + 1, let id = Int(args[at + 1]) {
            return (.classes, [.classPage(id)], false)
        }
        if args.contains("--vocab") { return (.vocab, [], false) }
        return (.chat(UUID(), isNew: true), [], args.contains("--list"))
    }

    var body: some View {
        GeometryReader { screen in
        GeometryReader { geo in
            let width = min(geo.size.width - 64, 340)
            let x = min(max((menu.isOpen ? width : 0) + dragX, 0), width)
            let progress = x / width
            ZStack(alignment: .topLeading) {
                SideMenu(current: root, showingMemory: $showingMemory) { open($0) }
                    .padding(.top, screen.safeAreaInsets.top)
                    .padding(.bottom, screen.safeAreaInsets.bottom)
                    .frame(width: width)
                    .offset(x: (x - width) / 4)
                    .accessibilityHidden(!menu.isOpen)

                stack
                    .background(Color(.systemBackground))
                    .clipShape(.rect(cornerRadius: 44 * progress))
                    .shadow(color: .black.opacity(0.14 * progress), radius: 24)
                    .overlay {
                        // While the menu's open, a tap on what's showing goes back to it.
                        if progress > 0 {
                            Color.black.opacity(0.04 * progress)
                                .clipShape(.rect(cornerRadius: 44 * progress))
                                .contentShape(.rect)
                                .onTapGesture { setMenu(false) }
                                .accessibilityLabel("Close menu")
                                .accessibilityAddTraits(.isButton)
                        }
                    }
                    .offset(x: x)
            }
            .simultaneousGesture(drag(width: width), including: canDrag ? .all : .subviews)
        }
        // The chat runs the full height of the screen, as a card when the menu's
        // out; the menu keeps clear of the status bar and home indicator.
        .ignoresSafeArea(.container)
        }
        .background(Color(.secondarySystemBackground).ignoresSafeArea())
        .environment(menu)
        .sheet(isPresented: $showingMemory) {
            MemorySheet(memory: store.classes?.memory, name: store.classes?.student.name ?? "")
        }
        .onChange(of: store.viewer) {
            // A view starts at its home: the parent's This week, or a new chat for the kid's.
            open(store.showingParentView ? .week : .chat(UUID(), isNew: true))
        }
        .onAppear { if store.showingParentView, root != .week, root != .vocab { root = .week; path = [] } }
        .onChange(of: menu.isOpen) {
            guard menu.isOpen else { return }
            // Opening the menu: put the keyboard away, and catch up on the chat
            // just had (its new title) and anything new from Canvas.
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            Task {
                async let threads: Void = store.refreshThreads()
                async let classes: Void = store.refreshClasses()
                async let study: Void = store.refreshStudy()
                _ = await (threads, classes, study)
            }
        }
    }

    private var stack: some View {
        NavigationStack(path: $path) {
            screen(root, isRoot: true)
                .id(root)
                .navigationDestination(for: Route.self) { screen($0, isRoot: false) }
        }
        .environment(\.navigate, TuttlesNavigate { path.append($0) })
        // Nothing underneath is touchable while the menu's out.
        .allowsHitTesting(!menu.isOpen)
    }

    @ViewBuilder private func screen(_ route: Route, isRoot: Bool) -> some View {
        switch route {
        case .chat(let id, let isNew, let start, let courseID, let briefing, let quiz):
            ChatView(store: store, threadID: id, isNew: isNew,
                     title: briefing?.title ?? quiz.map { "Quiz: \($0.setTitle)" } ?? store.threads.first { $0.id == id }?.title,
                     courseID: courseID, briefing: briefing, quizStart: quiz, start: start, menuButton: isRoot)
        case .studySet(let id):
            StudySetView(setID: id, path: $path).menuButton(isRoot)
        case .topic(let topic, let week):
            TopicView(topic: topic, week: week, path: $path).menuButton(isRoot)
        case .classPage(let id):
            ClassPageView(courseID: id, path: $path).menuButton(isRoot)
        case .classes:
            ClassesListView(path: $path).menuButton(isRoot)
        case .study:
            StudyListView(path: $path).menuButton(isRoot)
        case .week:
            ParentHomeView(path: $path).menuButton(isRoot)
        case .vocab:
            VocabHomeView(path: $path).menuButton(isRoot)
        case .vocabList(let kid, let name):
            VocabListView(kid: kid, name: name).menuButton(isRoot)
        }
    }

    /// Swap what's open for something picked in the menu, and close it.
    private func open(_ route: Route) {
        if route != root || !path.isEmpty {
            var noAnimation = Transaction()
            noAnimation.disablesAnimations = true
            withTransaction(noAnimation) {
                root = route
                path = []
            }
        }
        setMenu(false)
    }

    private func setMenu(_ open: Bool) {
        withAnimation(.snappy(duration: 0.3)) { menu.isOpen = open }
    }

    /// The menu drags out from what's open (when nothing is pushed on top,
    /// where a swipe means back) and drags back in from anywhere.
    private var canDrag: Bool { menu.isOpen || (path.isEmpty && !menu.locked) }

    private func drag(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 16)
            .updating($dragX) { value, state, _ in
                let t = value.translation
                guard abs(t.width) > abs(t.height) * 1.5 else { return }
                state = menu.isOpen ? min(0, t.width) : max(0, t.width)
            }
            .onEnded { value in
                let t = value.translation
                guard abs(t.width) > abs(t.height) * 1.5 else { return }
                let flung = value.predictedEndTranslation.width
                if menu.isOpen {
                    if t.width < -width / 3 || flung < -width / 2 { setMenu(false) } else { setMenu(true) }
                } else {
                    if t.width > width / 3 || flung > width / 2 { setMenu(true) } else { setMenu(false) }
                }
            }
    }
}

/// Who's signed in, as their initials, and the way out.
struct AccountMenu: View {
    @Binding var showMemory: Bool
    @Environment(ChatStore.self) private var store

    var body: some View {
        @Bindable var store = store
        Menu {
            if store.isParent {
                // The phone as one of the kids, in the kid's own chats, or the
                // parents' own view.
                Picker("View", selection: $store.viewer) {
                    ForEach(store.kids) { kid in
                        Label(kid.name, systemImage: "person.fill").tag(ChatStore.Viewer.kid(kid.id))
                    }
                    Label("Parent view", systemImage: "person.2").tag(ChatStore.Viewer.parent)
                }
            }
            Button(store.showingParentView ? "What Tuttles knows about \(store.classes?.student.name ?? "them")" : "What Tuttles knows about you",
                   systemImage: "brain.head.profile") { showMemory = true }
            Section(Session.shared.email ?? "Signed in") {
                Button("Sign out", role: .destructive) { Task { await Session.shared.signOut() } }
            }
        } label: {
            Text(store.initials)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color(.label))
                .frame(width: 48, height: 48)
                .glassEffect(.regular.interactive(), in: .circle)
        }
        .accessibilityLabel("Account")
    }
}
