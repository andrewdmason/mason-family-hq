import MasonKit
import SwiftUI

@main
struct WorkoutsApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(WorkoutStyle.accent)
        }
    }
}

struct RootView: View {
    @State private var session = Session.shared
    @State private var store = WorkoutStore.isDemoLaunch
        ? WorkoutStore(demo: DemoWorkouts.make(todayDone: CommandLine.arguments.contains("--demo-done")))
        : WorkoutStore()

    var body: some View {
        Group {
            if store.isDemo {
                WorkoutTabs(store: store, email: "demo@mason.io")
            } else if !session.checked {
                ProgressView()
            } else if !session.isSignedIn {
                SignInView(appName: "Workouts", symbol: "dumbbell.fill")
                    .tint(WorkoutStyle.clay)
                    .background { WorkoutBackground() }
            } else if session.role != nil {
                // Open to everyone in the family, as on the website; each
                // member sees their own workouts.
                WorkoutTabs(store: store, email: session.email)
            } else {
                ContentUnavailableView {
                    Label("Not available", systemImage: "dumbbell.fill")
                } description: {
                    Text("Workouts is for the family's accounts. You're signed in as \(session.email ?? "someone else").")
                } actions: {
                    Button("Sign out") { Task { await session.signOut() } }
                }
            }
        }
        .animation(.default, value: session.isSignedIn)
        .onChange(of: session.userID) { old, new in
            // Another member signing in starts from nothing of the last one's.
            if old != nil, old != new { store.forget() }
        }
    }
}

/// A session opened from a list.
struct SessionRoute: Hashable {
    let id: UUID
}

enum AppTab: String, Hashable {
    case upcoming, prs, history

    /// `--tab <name>` opens on a tab, for the simulator.
    static var launch: AppTab {
        let args = CommandLine.arguments
        guard let at = args.firstIndex(of: "--tab"), args.count > at + 1 else { return .upcoming }
        return AppTab(rawValue: args[at + 1]) ?? .upcoming
    }
}

/// The app's three screens: today's workout and what's coming, personal
/// records, and what's behind.
struct WorkoutTabs: View {
    let store: WorkoutStore
    let email: String?
    @State private var tab = AppTab.launch
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $tab) {
            Tab("Upcoming", systemImage: "calendar", value: AppTab.upcoming) {
                UpcomingView(store: store, email: email)
            }
            Tab("PRs", systemImage: "trophy.fill", value: AppTab.prs) {
                RecordsView(store: store)
            }
            Tab("History", systemImage: "clock.arrow.circlepath", value: AppTab.history) {
                HistoryView(store: store)
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .task { await store.load() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await WorkoutWrites.shared.flush()
                await store.load()
            }
        }
        .sensoryFeedback(.selection, trigger: tab)
    }
}

/// Who's signed in, and the way out.
struct AccountMenu: View {
    let email: String?
    let store: WorkoutStore

    var body: some View {
        Menu {
            Section(email ?? "Signed in") {
                Link(destination: WorkoutStore.websiteURL.appending(path: "workouts")) {
                    Label("Workouts on the web", systemImage: "safari")
                }
                if !store.isDemo {
                    Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                        Task {
                            await Session.shared.signOut()
                            store.forget()
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "person.crop.circle")
        }
        .accessibilityLabel("Account")
    }
}

/// A session on its own screen, pushed from Upcoming or History.
struct SessionScreen: View {
    let store: WorkoutStore
    let id: UUID
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            SessionContent(store: store, sessionID: id) { dismiss() }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, WorkoutStyle.scrollEnd)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background { WorkoutBackground(mood: store.details[id]?.completed == true ? .done : .work) }
        .navigationBarTitleDisplayMode(.inline)
        .scrollEdgeEffectStyle(.soft, for: .top)
        .task { await store.loadSession(id) }
        .refreshable { await store.loadSession(id) }
    }
}

/// A banner for a load that didn't go through.
struct LoadErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "wifi.exclamationmark")
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .glassEffect(.regular.tint(.red.opacity(0.18)), in: .capsule)
    }
}
