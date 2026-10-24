import MasonKit
import SwiftUI

struct RootView: View {
    @State private var session = Session.shared

    var body: some View {
        Group {
            if !session.checked {
                ProgressView()
            } else if !session.isSignedIn {
                SignInView(appName: "Practice", symbol: "music.note")
            } else if session.role == "owner" {
                NavigationStack {
                    QuickLogView()
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) { AccountMenu(email: session.email) }
                        }
                }
            } else {
                // Practice is the owner's alone, as on the website
                // (src/lib/supabase/middleware.ts).
                ContentUnavailableView {
                    Label("Not available", systemImage: "music.note")
                } description: {
                    Text("Practice is only open to the family owner's account. You're signed in as \(session.email ?? "someone else").")
                } actions: {
                    Button("Sign out") { Task { await session.signOut() } }
                }
            }
        }
        .animation(.default, value: session.isSignedIn)
    }
}

/// Who's signed in, and the way out.
struct AccountMenu: View {
    let email: String?

    var body: some View {
        Menu {
            Section(email ?? "Signed in") {
                Button("Sign out", role: .destructive) { Task { await Session.shared.signOut() } }
            }
        } label: {
            Image(systemName: "person.crop.circle")
        }
        .accessibilityLabel("Account")
    }
}
