import MasonKit
import SwiftUI

/// The Mac's look: Liquid Glass over a soft mesh of the icon's colours, warm
/// paper with hydrant red at the edges. The glass needs something under it to
/// bend, so the whole window sits on this; reading stays on the calm middle.
struct TuttlesBackdrop: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [0.55, 0.45], [1, 0.5],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: colors
        )
        .ignoresSafeArea()
    }

    private var colors: [Color] {
        if scheme == .dark {
            let base = Color(red: 0.075, green: 0.06, blue: 0.06)
            let umber = Color(red: 0.17, green: 0.085, blue: 0.075)
            let ember = Color(red: 0.33, green: 0.09, blue: 0.075)
            return [
                ember, umber, base,
                umber, base, base,
                base, umber, ember,
            ]
        }
        let paper = Theme.paper
        let cream = Color(red: 0.99, green: 0.95, blue: 0.89)
        let blush = Color(red: 0.98, green: 0.84, blue: 0.79)
        let rose = Color(red: 0.97, green: 0.74, blue: 0.69)
        return [
            rose, blush, cream,
            blush, paper, paper,
            cream, blush, rose,
        ]
    }
}

enum MacLook {
    /// How wide a line of reading gets, however wide the window.
    static let column: CGFloat = 740
}

extension View {
    /// A screen of the phone's (a list of classes, a study set) on the Mac: a
    /// column down the middle of the backdrop rather than edge to edge.
    func macPage() -> some View {
        scrollContentBackground(.hidden)
            .frame(maxWidth: MacLook.column + 80)
            .frame(maxWidth: .infinity)
            .macBackdrop()
    }

    /// The backdrop behind a screen. Each screen carries its own: one pushed
    /// on top of another would otherwise cover it with a plain window.
    func macBackdrop() -> some View {
        background { TuttlesBackdrop() }
            // No band across the top: the backdrop runs to the window's edge,
            // and what scrolls up under the title melts away rather than
            // running into it.
            .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .mask(LinearGradient(stops: [.init(color: .black, location: 0.55), .init(color: .clear, location: 1)],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(height: 84)
                    .ignoresSafeArea(edges: .top)
                    .allowsHitTesting(false)
            }
    }
}
