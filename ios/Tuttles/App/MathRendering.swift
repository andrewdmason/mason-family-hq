import SwiftMath
import SwiftUI
import UIKit

/// The tutor's LaTeX, typeset by SwiftMath into an image. Inline math sits in a
/// line of text as an image, dropped by its descent so it shares the text's
/// baseline; display math is a centered block of its own.
@MainActor
enum MathRendering {
    struct Rendered {
        let image: UIImage
        /// How far the math reaches below its baseline, in points.
        let descent: CGFloat
    }

    private static var cache: [String: Rendered] = [:]

    static func render(_ latex: String, fontSize: CGFloat, color: UIColor, display: Bool) -> Rendered? {
        let source = cleaned(latex)
        let key = "\(display)|\(fontSize)|\(color.hexKey)|\(source)"
        if let hit = cache[key] { return hit }

        let label = MTMathUILabel()
        label.latex = source
        label.fontSize = fontSize
        label.textColor = color
        label.labelMode = display ? .display : .text
        label.textAlignment = .left
        label.frame = CGRect(origin: .zero, size: label.intrinsicContentSize)
        label.layoutIfNeeded()
        guard label.error == nil, let list = label.displayList, label.intrinsicContentSize.width > 0 else { return nil }

        let image = MTMathImage(latex: source, fontSize: fontSize, textColor: color, labelMode: display ? .display : .text, textAlignment: .left)
        guard case (nil, let rendered?) = image.asImage() else { return nil }
        let result = Rendered(image: rendered, descent: list.descent)
        cache[key] = result
        return result
    }

    /// What SwiftMath doesn't read, rewritten to what it does.
    private static func cleaned(_ latex: String) -> String {
        latex
            .replacingOccurrences(of: "\\dfrac", with: "\\frac")
            .replacingOccurrences(of: "\\tfrac", with: "\\frac")
            .replacingOccurrences(of: "\\le ", with: "\\leq ")
            .replacingOccurrences(of: "\\ge ", with: "\\geq ")
            .replacingOccurrences(of: "\\;", with: "\\ ")
            .replacingOccurrences(of: "\\!", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// A display equation, scrolling sideways if it's wider than the screen.
struct DisplayMath: View {
    let latex: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if let math = MathRendering.render(latex, fontSize: 20, color: .label.resolved(scheme), display: true) {
            ScrollView(.horizontal, showsIndicators: false) {
                Image(uiImage: math.image)
                    .frame(minWidth: 0)
            }
            .frame(maxWidth: .infinity)
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .padding(.vertical, 4)
        } else {
            Text(latex).font(.body.monospaced()).foregroundStyle(.secondary)
        }
    }
}

extension UIColor {
    func resolved(_ scheme: ColorScheme) -> UIColor {
        resolvedColor(with: UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light))
    }

    var hexKey: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "%02x%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255), Int(a * 255))
    }
}
