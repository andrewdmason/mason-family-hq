import SwiftUI

/// Shown until you've signed in once; after that the app stays signed in.
struct SignInView: View {
    let clips: ClipsService
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 18) {
                Image(systemName: "baseball.fill").font(.system(size: 44)).foregroundStyle(.white)
                Text("Clips Camera").font(.largeTitle.weight(.bold)).foregroundStyle(.white)
                Text("Sign in with the Google account you use for Family HQ.\nAt-bats you film upload to Baseball Clips.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.7))
                Button {
                    busy = true
                    error = nil
                    Task {
                        do { try await clips.signIn() } catch { self.error = error.localizedDescription }
                        busy = false
                    }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(.black) }
                        Text("Sign in with Google").font(.headline)
                    }
                    .frame(width: 280, height: 50)
                }
                .buttonStyle(.borderedProminent)
                .tint(.white)
                .foregroundStyle(.black)
                .disabled(busy)
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center).frame(maxWidth: 500)
                }
            }
            .padding()
        }
    }
}
