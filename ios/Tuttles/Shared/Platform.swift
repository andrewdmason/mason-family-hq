import SwiftUI

// What differs between the iPhone and the Mac, named once, so everything else
// in Shared/ reads the same on both.

#if canImport(UIKit)
import UIKit
typealias PlatformImage = UIImage
typealias PlatformColor = UIColor
typealias PlatformFont = UIFont
#else
import AppKit
typealias PlatformImage = NSImage
typealias PlatformColor = NSColor
typealias PlatformFont = NSFont
#endif

extension Image {
    init(platformImage: PlatformImage) {
        #if canImport(UIKit)
        self.init(uiImage: platformImage)
        #else
        self.init(nsImage: platformImage)
        #endif
    }
}

extension Color {
    #if canImport(UIKit)
    /// What a screen sits on.
    static let tuttlesPage = Color(.systemBackground)
    /// A card on the page (a quiz question, a study set).
    static let tuttlesCard = Color(.secondarySystemBackground)
    /// A chip or a choice on a card.
    static let tuttlesFill = Color(.tertiarySystemFill)
    /// The student's own message.
    static let tuttlesBubble = Color(.secondarySystemFill)
    static let tuttlesLine = Color(.separator)
    #else
    // On the Mac everything sits on the coloured backdrop (Mac/MacStyle.swift),
    // so cards and chips are sheets of light over it rather than flat greys.
    static let tuttlesPage = Color(nsColor: .textBackgroundColor)
    static let tuttlesCard = Color(nsColor: .textBackgroundColor).opacity(0.62)
    static let tuttlesFill = Color.primary.opacity(0.07)
    static let tuttlesBubble = Color.primary.opacity(0.08)
    static let tuttlesLine = Color(nsColor: .separatorColor)
    #endif
}

extension PlatformColor {
    /// The colour of body text in a light or dark window, as a fixed colour
    /// (math is drawn into an image, which can't follow the window by itself).
    static func ink(_ scheme: ColorScheme) -> PlatformColor {
        #if canImport(UIKit)
        return UIColor.label.resolvedColor(with: UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light))
        #else
        return scheme == .dark
            ? NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.85)
            : NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.85)
        #endif
    }

    var hexKey: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        #if canImport(UIKit)
        getRed(&r, green: &g, blue: &b, alpha: &a)
        #else
        (usingColorSpace(.sRGB) ?? self).getRed(&r, green: &g, blue: &b, alpha: &a)
        #endif
        return String(format: "%02x%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255), Int(a * 255))
    }
}

extension PlatformImage {
    /// The picture no longer than `longest` on its long side, in pixels.
    func scaledDown(toFit longest: CGFloat) -> PlatformImage {
        #if canImport(UIKit)
        let scale = min(1, longest / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
        #else
        // A Mac picture's size is in points; what's sent is its pixels.
        guard let source = cgImage(forProposedRect: nil, context: nil, hints: nil) else { return self }
        let scale = min(1, longest / CGFloat(max(source.width, source.height)))
        let width = Int((CGFloat(source.width) * scale).rounded()), height = Int((CGFloat(source.height) * scale).rounded())
        guard let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return self }
        // A screenshot's see-through corners go to white, not black.
        context.setFillColor(.white)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let scaled = context.makeImage() else { return self }
        return NSImage(cgImage: scaled, size: CGSize(width: width, height: height))
        #endif
    }

    func jpeg(quality: CGFloat) -> Data? {
        #if canImport(UIKit)
        return jpegData(compressionQuality: quality)
        #else
        guard let source = cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        return NSBitmapImageRep(cgImage: source).representation(using: .jpeg, properties: [.compressionFactor: quality])
        #endif
    }
}

extension ToolbarItemPlacement {
    /// The far end of the bar at the top, and where a back button would be.
    #if os(iOS)
    static let tuttlesTrailing = ToolbarItemPlacement.topBarTrailing
    static let tuttlesLeading = ToolbarItemPlacement.topBarLeading
    #else
    static let tuttlesTrailing = ToolbarItemPlacement.primaryAction
    static let tuttlesLeading = ToolbarItemPlacement.navigation
    #endif
}

extension View {
    /// A small title in the bar, on the phone; the Mac's is always that.
    func inlineTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    /// Something that takes over the screen on the phone, and is a sheet on the Mac.
    func cover<Item: Identifiable, Content: View>(
        item: Binding<Item?>, @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        #if os(iOS)
        fullScreenCover(item: item, content: content)
        #else
        sheet(item: item, content: content)
        #endif
    }
}

extension PlatformFont {
    /// The font to read a tutor's reply in: the system's own on the phone, and
    /// a size up on the Mac, whose text styles are sized for menus and lists
    /// rather than paragraphs.
    static func reading(_ style: TextStyle) -> PlatformFont {
        let font = preferredFont(forTextStyle: style)
        #if os(macOS)
        return NSFont(descriptor: font.fontDescriptor, size: (font.pointSize * 1.2).rounded()) ?? font
        #else
        return font
        #endif
    }
}

extension Font {
    /// Body text in a chat (see `PlatformFont.reading`).
    static var reading: Font { Font(PlatformFont.reading(.body) as CTFont) }
}

extension View {
    /// A card in a chat or on a page: a quiz question, a study set, a recap.
    /// A grey panel on the phone's page; Liquid Glass over the Mac's backdrop.
    /// `fill` is for the few drawn on something else (a call's dark colours).
    @ViewBuilder func tuttlesCard(radius: CGFloat, fill: Color? = nil) -> some View {
        #if os(macOS)
        if let fill {
            background(fill, in: .rect(cornerRadius: radius, style: .continuous))
        } else {
            glassEffect(.regular, in: .rect(cornerRadius: radius, style: .continuous))
        }
        #else
        background(fill ?? Color.tuttlesCard, in: .rect(cornerRadius: radius))
        #endif
    }

    /// What the student said: a grey bubble on the phone, and a wider one of
    /// glass with a little of the icon's red in it on the Mac.
    func studentBubble() -> some View {
        #if os(macOS)
        glassEffect(.regular.tint(Color(red: 0.84, green: 0.15, blue: 0.12).opacity(0.10)), in: .rect(cornerRadius: 20, style: .continuous))
            .frame(maxWidth: 480, alignment: .trailing)
        #else
        background(Color.tuttlesBubble, in: .rect(cornerRadius: 20))
            .frame(maxWidth: 300, alignment: .trailing)
        #endif
    }
}

/// A page of sections (classes, a study set): the phone's grouped list, and
/// on the Mac the rounded boxes of a grouped form, which sit on the backdrop.
struct PageList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        #if os(macOS)
        Form { content }
            .formStyle(.grouped)
            .buttonStyle(RowButtonStyle())
        #else
        List { content }
        #endif
    }
}

#if os(macOS)
/// A row that's a button, on the Mac: the whole row takes the click and dims
/// under it, rather than being drawn as a push button in a box.
private struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .opacity(configuration.isPressed ? 0.5 : 1)
    }
}
#endif

/// What a sheet holds: a navigation stack, for its title and buttons. A Mac
/// sheet is as big as what's in it, which for a form is nothing, so there it's
/// given a size.
struct SheetStack<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        #if os(macOS)
        NavigationStack { content }
            .formStyle(.grouped)
            .frame(minWidth: 460, idealWidth: 500, minHeight: 360, idealHeight: 440)
        #else
        NavigationStack { content }
        #endif
    }
}

enum Haptics {
    /// A light tap under the finger; nothing on the Mac.
    @MainActor static func tap() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }
}
