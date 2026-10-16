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

/// The current app full screen, with the app list in a sidebar underneath it,
/// like the ChatGPT and Claude apps: swipe right anywhere to slide the app
/// aside and show the list, swipe left or tap the app to put it back. The menu
/// button opens it too.
struct ShellView: View {
    @State private var session = Session.shared
    @AppStorage("shell.currentApp") private var currentRaw = FamilyApp.home.rawValue
    @State private var sidebarOpen = false
    @State private var drag: CGFloat = 0

    private var apps: [FamilyApp] { FamilyApp.allCases.filter { $0.isOpen(to: session.role) } }

    private var current: FamilyApp {
        let app = FamilyApp(rawValue: currentRaw) ?? .home
        return app.isOpen(to: session.role) ? app : .home
    }

    var body: some View {
        GeometryReader { geo in
            // The app stays in view as a strip on the right while the list is open.
            let width = max(geo.size.width - 72, 240)
            let openness = min(max(((sidebarOpen ? width : 0) + drag) / width, 0), 1)

            ZStack(alignment: .leading) {
                SidebarView(apps: apps, current: current, email: session.email) { app in
                    currentRaw = app.rawValue
                    withAnimation(.snappy) { sidebarOpen = false }
                }
                .frame(width: width)
                .offset(x: (openness - 1) * 60)
                .opacity(0.4 + 0.6 * openness)

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
                // Full height, under the status bar and home indicator, so the
                // whole screen slides over rather than a floating card.
                .background(Color(.systemBackground).ignoresSafeArea())
                .overlay {
                    Color.black.opacity(0.2 * openness)
                        .ignoresSafeArea()
                        .allowsHitTesting(sidebarOpen)
                        .onTapGesture { withAnimation(.snappy) { sidebarOpen = false } }
                }
                .shadow(color: .black.opacity(0.12 * openness), radius: 8)
                .offset(x: openness * width)
            }
            .gesture(
                SidebarPan(isOpen: sidebarOpen) { dx in
                    drag = dx
                } ended: { dx, velocity in
                    let projected = (sidebarOpen ? width : 0) + dx + velocity * 0.15
                    withAnimation(.snappy) {
                        sidebarOpen = projected > width / 2
                        drag = 0
                    }
                }
            )
            .sensoryFeedback(.impact(weight: .light), trigger: sidebarOpen)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch current {
        case .home: HomeView()
        case .practice: QuickLogView()
        }
    }
}

/// A horizontal pan anywhere on screen that moves the sidebar. It only starts
/// on a sideways swipe (rightward when closed), so up-and-down scrolling and
/// taps go through to the app as usual.
struct SidebarPan: UIGestureRecognizerRepresentable {
    let isOpen: Bool
    let changed: (CGFloat) -> Void
    let ended: (_ dx: CGFloat, _ velocity: CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        return pan
    }

    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        context.coordinator.isOpen = isOpen
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let dx = recognizer.translation(in: recognizer.view).x
        switch recognizer.state {
        case .began, .changed: changed(dx)
        case .ended: ended(dx, recognizer.velocity(in: recognizer.view).x)
        case .cancelled, .failed: ended(0, 0)
        default: break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var isOpen = false

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            let v = pan.velocity(in: pan.view)
            guard abs(v.x) > abs(v.y) * 1.2 else { return false }
            return isOpen ? true : v.x > 0
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
