import SwiftUI

/// The apps in MasonOS, in sidebar order. Each says who can open it.
enum FamilyApp: String, CaseIterable, Identifiable {
    case home
    case practice

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "Home"
        case .practice: "Practice Log"
        }
    }

    var symbol: String {
        switch self {
        case .home: "house"
        case .practice: "music.note"
        }
    }

    /// Practice is the owner's alone, as on the website (src/lib/supabase/middleware.ts).
    func isOpen(to role: String?) -> Bool {
        switch self {
        case .home: true
        case .practice: role == "owner"
        }
    }
}

struct RootView: View {
    @State private var session = Session.shared

    var body: some View {
        Group {
            if !session.checked {
                ProgressView()
            } else if session.isSignedIn {
                ShellView()
            } else {
                SignInView()
            }
        }
        .animation(.default, value: session.isSignedIn)
    }
}

/// The current app full screen, with the app list in a sidebar that slides in
/// from the left: the menu button, or a swipe from the left edge.
struct ShellView: View {
    @State private var session = Session.shared
    @AppStorage("shell.currentApp") private var currentRaw = FamilyApp.home.rawValue
    @State private var sidebarOpen = false
    @State private var drag: CGFloat = 0

    private let sidebarWidth: CGFloat = 300

    private var apps: [FamilyApp] { FamilyApp.allCases.filter { $0.isOpen(to: session.role) } }

    private var current: FamilyApp {
        let app = FamilyApp(rawValue: currentRaw) ?? .home
        return app.isOpen(to: session.role) ? app : .home
    }

    /// How far open the sidebar is, 0…1, following a finger mid-drag.
    private var openness: CGFloat {
        let base: CGFloat = sidebarOpen ? sidebarWidth : 0
        return min(max((base + drag) / sidebarWidth, 0), 1)
    }

    var body: some View {
        ZStack(alignment: .leading) {
            NavigationStack {
                content
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button {
                                withAnimation(.snappy) { sidebarOpen = true }
                            } label: {
                                Image(systemName: "line.3.horizontal")
                            }
                            .accessibilityLabel("Apps")
                        }
                    }
            }
            .offset(x: openness * sidebarWidth)
            .overlay {
                Color.black.opacity(0.25 * openness)
                    .ignoresSafeArea()
                    .allowsHitTesting(openness > 0)
                    .onTapGesture { withAnimation(.snappy) { sidebarOpen = false } }
                    .offset(x: openness * sidebarWidth)
            }

            SidebarView(apps: apps, current: current, email: session.email) { app in
                currentRaw = app.rawValue
                withAnimation(.snappy) { sidebarOpen = false }
            }
            .frame(width: sidebarWidth)
            .offset(x: (openness - 1) * sidebarWidth)

            // A strip along the left edge to swipe the sidebar open from.
            if !sidebarOpen {
                Color.clear
                    .frame(width: 20)
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .gesture(dragGesture)
            }
        }
        .gesture(dragGesture, isEnabled: sidebarOpen)
    }

    @ViewBuilder
    private var content: some View {
        switch current {
        case .home: HomeView()
        case .practice: QuickLogView()
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { drag = $0.translation.width }
            .onEnded { value in
                let projected = (sidebarOpen ? sidebarWidth : 0) + value.predictedEndTranslation.width
                withAnimation(.snappy) {
                    sidebarOpen = projected > sidebarWidth / 2
                    drag = 0
                }
            }
    }
}

struct SidebarView: View {
    let apps: [FamilyApp]
    let current: FamilyApp
    let email: String?
    let pick: (FamilyApp) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("MasonOS")
                .font(.title2.bold())
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 16)

            ForEach(apps) { app in
                Button { pick(app) } label: {
                    Label(app.title, systemImage: app.symbol)
                        .font(.body.weight(app == current ? .semibold : .regular))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(app == current ? Theme.accent.opacity(0.12) : .clear, in: .rect(cornerRadius: 10))
                }
                .foregroundStyle(app == current ? Theme.accent : .primary)
                .padding(.horizontal, 8)
            }

            Spacer()

            Menu {
                Button("Sign out", role: .destructive) { Task { await Session.shared.signOut() } }
            } label: {
                Label(email ?? "Signed in", systemImage: "person.crop.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(20)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color(.secondarySystemBackground))
    }
}

struct SignInView: View {
    @State private var error: String?
    @State private var working = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "house.fill")
                .font(.system(size: 56))
                .foregroundStyle(Theme.accent)
            Text("MasonOS")
                .font(.largeTitle.bold())
            Text("Sign in with the Google account you use for family.mason.io.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                working = true
                Task {
                    do { try await Session.shared.signIn() } catch { self.error = "Sign-in didn't finish. Try again." }
                    working = false
                }
            } label: {
                Text(working ? "Signing in…" : "Sign in with Google")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(working)
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .padding(32)
    }
}
