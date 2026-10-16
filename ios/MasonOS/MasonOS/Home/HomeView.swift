import SwiftUI

/// A placeholder until there's a family dashboard to put here.
struct HomeView: View {
    var body: some View {
        ContentUnavailableView(
            "Home",
            systemImage: "house",
            description: Text("The family's home base is coming. Swipe right for your apps.")
        )
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.inline)
    }
}
