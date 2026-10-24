import MasonKit
import SwiftUI

struct RootView: View {
    @State private var session = Session.shared
    /// The role last seen, so the shelf still opens when the app starts with
    /// no signal (the role is read from the backend).
    @AppStorage("reader.role") private var savedRole = ""

    private var role: String? { session.role ?? (savedRole.isEmpty ? nil : savedRole) }

    var body: some View {
        Group {
            if !session.checked {
                ProgressView()
            } else if !session.isSignedIn {
                SignInView(appName: "Reader", symbol: "book")
            } else if role == "owner" || role == "parent" {
                ShelfScreen()
            } else {
                // Reader is the parents' e-reader, as on the website
                // (src/lib/supabase/middleware.ts); the kids read in Bookshelf.
                ContentUnavailableView {
                    Label("Not available", systemImage: "book")
                } description: {
                    Text("Reader is for parents' accounts. You're signed in as \(session.email ?? "someone else").")
                } actions: {
                    Button("Sign out") { Task { await ReaderSignOut.run() } }
                }
            }
        }
        .animation(.default, value: session.isSignedIn)
        .onChange(of: session.role, initial: true) { _, role in
            if let role { savedRole = role }
        }
    }
}

enum ReaderSignOut {
    @MainActor
    static func run() async {
        AudioPlayer.shared.stop()
        await WebSignIn.signOut()
        ReadingWeb.shared.reset()
        await Session.shared.signOut()
    }
}

/// Who's signed in, and the way out.
struct AccountMenu: View {
    let email: String?

    var body: some View {
        Menu {
            Section(email ?? "Signed in") {
                Button("Sign out", role: .destructive) { Task { await ReaderSignOut.run() } }
            }
        } label: {
            Image(systemName: "person.crop.circle")
        }
        .accessibilityLabel("Account")
    }
}
