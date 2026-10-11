import SwiftUI
import UIKit

/// Reports the instant a finger lands (not when it lifts), timed with the
/// touch's own clock. Laid over the Pitch button: that instant is the pitch.
struct TouchDownArea: UIViewRepresentable {
    let accessibilityLabel: String
    let onTouchDown: (TimeInterval) -> Void

    func makeUIView(context: Context) -> AreaView {
        let view = AreaView()
        view.accessibilityLabel = accessibilityLabel
        view.onTouchDown = onTouchDown
        return view
    }

    func updateUIView(_ view: AreaView, context: Context) {
        view.onTouchDown = onTouchDown
    }

    final class AreaView: UIView {
        var onTouchDown: ((TimeInterval) -> Void)?

        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .clear
            isMultipleTouchEnabled = false
            isAccessibilityElement = true
            accessibilityTraits = .button
        }

        required init?(coder: NSCoder) { fatalError() }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            if let touch = touches.first { onTouchDown?(touch.timestamp) }
        }

        override func accessibilityActivate() -> Bool {
            onTouchDown?(ProcessInfo.processInfo.systemUptime)
            return true
        }
    }
}
