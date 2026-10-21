import SwiftUI

/// The first screen of every family app until someone signs in.
public struct SignInView: View {
    let appName: String
    let symbol: String
    @State private var error: String?
    @State private var working = false

    public init(appName: String, symbol: String) {
        self.appName = appName
        self.symbol = symbol
    }

    public var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: symbol)
                .font(.system(size: 56))
                .foregroundStyle(Theme.accent)
            Text(appName)
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
