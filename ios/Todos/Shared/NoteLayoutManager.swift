import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Draws what sits beside a note's text: bullets, numbers, checkboxes, quote bars,
/// code backgrounds and dividers.
final class NoteLayoutManager: NSLayoutManager {
    var style: NoteStyle

    init(style: NoteStyle) {
        self.style = style
        super.init()
    }

    required init?(coder: NSCoder) { fatalError() }

    /// A text view's worth of machinery, for a view or for measuring.
    static func makeStack(style: NoteStyle) -> (NSTextStorage, NoteLayoutManager, NSTextContainer) {
        let storage = NSTextStorage()
        let manager = NoteLayoutManager(style: style)
        let container = NSTextContainer(size: CGSize(width: 100, height: CGFloat.greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        storage.addLayoutManager(manager)
        manager.addTextContainer(container)
        return (storage, manager, container)
    }

    /// The height this text will take at this width.
    static func height(of text: NSAttributedString, width: CGFloat, style: NoteStyle) -> CGFloat {
        let (storage, manager, container) = makeStack(style: style)
        container.size = CGSize(width: width, height: .greatestFiniteMagnitude)
        storage.setAttributedString(text)
        manager.ensureLayout(for: container)
        return ceil(manager.usedRect(for: container).height)
    }

    private var gutter: CGFloat { style.indent }

    /// The task line whose checkbox is at this point, in text container coordinates.
    func checkboxLine(at point: CGPoint) -> Int? {
        guard let marker = markerLine(at: point), marker.isTask else { return nil }
        return marker.location
    }

    /// The list item whose bullet, number or checkbox is at this point.
    func markerLine(at point: CGPoint) -> (location: Int, isTask: Bool)? {
        guard let storage = textStorage, storage.length > 0, let container = textContainers.first else { return nil }
        ensureLayout(for: container)
        let glyph = glyphIndex(for: point, in: container)
        let fragment = lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        guard fragment.contains(CGPoint(x: fragment.midX, y: point.y)) else { return nil }
        let character = characterIndexForGlyph(at: glyph)
        let paragraph = NoteEditing.paragraph(at: character, in: storage)
        guard case .list(let path, _) = paragraph.kind else { return nil }
        let right = CGFloat(path.count) * gutter
        guard point.x >= right - gutter, point.x < right else { return nil }
        return (paragraph.range.location, path.last == .task)
    }

    /// The top and bottom of a line's text, every wrapped row of it.
    func verticalSpan(of range: NSRange) -> ClosedRange<CGFloat>? {
        guard let storage = textStorage, range.location < storage.length else { return nil }
        let first = glyphIndexForCharacter(at: range.location)
        let last = glyphIndexForCharacter(at: max(NSMaxRange(range) - 1, range.location))
        let top = lineFragmentRect(forGlyphAt: first, effectiveRange: nil).minY
        let bottom = lineFragmentRect(forGlyphAt: last, effectiveRange: nil).maxY
        return top...max(top, bottom)
    }

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage, storage.length > 0, let container = textContainers.first else { return }
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        let string = storage.string as NSString
        var location = string.paragraphRange(for: NSRange(location: characters.location, length: 0)).location
        let end = NSMaxRange(characters)

        while location < string.length, location <= end {
            let paragraph = NoteEditing.paragraph(at: location, in: storage)
            defer { location = max(NSMaxRange(paragraph.range), location + 1) }
            guard paragraph.kind != .paragraph, paragraph.range.length > 0 else { continue }
            let firstGlyph = glyphIndexForCharacter(at: paragraph.range.location)
            var fragment = lineFragmentRect(forGlyphAt: firstGlyph, effectiveRange: nil)
            let used = lineFragmentUsedRect(forGlyphAt: firstGlyph, effectiveRange: nil)
            fragment.origin.x += origin.x
            fragment.origin.y += origin.y
            let usedRect = used.offsetBy(dx: origin.x, dy: origin.y)
            // Middle of the capitals on the first line, whatever spacing is around it.
            let font = storage.attribute(.font, at: paragraph.range.location, effectiveRange: nil) as? NoteFont
            let middle = fragment.minY + self.location(forGlyphAt: firstGlyph).y - (font?.capHeight ?? style.size * 0.7) / 2
            let previous = paragraph.range.location > 0 ? NoteEditing.paragraph(at: paragraph.range.location - 1, in: storage).kind : nil
            let following = NSMaxRange(paragraph.range) < storage.length ? NoteEditing.paragraph(at: NSMaxRange(paragraph.range), in: storage).kind : nil
            let lastGlyph = glyphIndexForCharacter(at: max(paragraph.contentEnd - 1, paragraph.range.location))
            let lastFragmentBottom = lineFragmentRect(forGlyphAt: lastGlyph, effectiveRange: nil).maxY + origin.y
            let lastTextBottom = lineFragmentUsedRect(forGlyphAt: lastGlyph, effectiveRange: nil).maxY + origin.y

            switch paragraph.kind {
            case .divider:
                let line = CGRect(x: fragment.minX, y: middle - 0.5, width: container.size.width, height: 1)
                NoteLayoutManager.fill(line, color: NoteStyle.muted.withAlphaComponent(0.35))
            case .quote:
                let top = previous == .quote ? fragment.minY : usedRect.minY
                let bottom = following == .quote ? lastFragmentBottom : lastTextBottom
                NoteLayoutManager.fill(CGRect(x: fragment.minX, y: top, width: 3, height: bottom - top), color: NoteStyle.muted.withAlphaComponent(0.35))
            case .code:
                let top = previous == .code ? fragment.minY : usedRect.minY - style.codePadding
                let bottom = following == .code ? lastFragmentBottom : lastTextBottom + style.codePadding
                NoteLayoutManager.fill(CGRect(x: fragment.minX, y: top, width: container.size.width, height: bottom - top), color: NoteStyle.muted.withAlphaComponent(0.12))
            case .list(let path, let checked):
                drawMarker(path: path, checked: checked, paragraph: paragraph, left: usedRect.minX, middle: middle, in: storage)
            default: break
            }
        }
    }

    private func drawMarker(path: [NoteListKind], checked: Bool, paragraph: NoteParagraph, left right: CGFloat, middle: CGFloat, in storage: NSTextStorage) {
        let base = style.size
        let color = NoteStyle.muted
        // `right` is the indent, so markers sit just left of the text.
        switch path[path.count - 1] {
        case .task:
            let side = round(base * 1.0)
            let box = CGRect(x: right - gutter + (gutter - side) / 2 - 1, y: middle - side / 2, width: side, height: side)
            NoteLayoutManager.drawCheckbox(box, checked: checked, accent: style.accent, border: color)
        case .bullet:
            let filled = (path.count - 1) % 2 == 0
            let side = round(base * 0.36)
            let dot = CGRect(x: right - gutter * 0.6 - side / 2, y: middle - side / 2, width: side, height: side)
            NoteLayoutManager.drawDot(dot, filled: filled, color: color)
        case .ordered:
            let number = NSAttributedString(
                string: "\(ordinal(of: paragraph, path: path, in: storage)).",
                attributes: [.font: NoteFont.monospacedDigitSystemFont(ofSize: base, weight: .regular), .foregroundColor: color])
            let size = number.size()
            number.draw(at: CGPoint(x: right - size.width - 5, y: middle - size.height / 2))
        }
    }

    /// Where this item falls among its siblings.
    private func ordinal(of paragraph: NoteParagraph, path: [NoteListKind], in storage: NSTextStorage) -> Int {
        var count = 1
        var location = paragraph.range.location
        while location > 0 {
            let previous = NoteEditing.paragraph(at: location - 1, in: storage)
            guard case .list(let other, _) = previous.kind, other.count >= path.count else { break }
            if other.count == path.count {
                guard other == path else { break }
                count += 1
            }
            location = previous.range.location
        }
        return count
    }

    // MARK: Drawing

    private static var context: CGContext? {
        #if os(macOS)
        NSGraphicsContext.current?.cgContext
        #else
        UIGraphicsGetCurrentContext()
        #endif
    }

    private static func fill(_ rect: CGRect, color: NoteColor) {
        guard let context else { return }
        context.setFillColor(color.cgColor)
        context.fill(rect)
    }

    private static func drawDot(_ rect: CGRect, filled: Bool, color: NoteColor) {
        guard let context else { return }
        if filled {
            context.setFillColor(color.cgColor)
            context.fillEllipse(in: rect)
        } else {
            context.setStrokeColor(color.cgColor)
            context.setLineWidth(1)
            context.strokeEllipse(in: rect.insetBy(dx: 0.5, dy: 0.5))
        }
    }

    private static func drawCheckbox(_ rect: CGRect, checked: Bool, accent: NoteColor, border: NoteColor) {
        guard let context else { return }
        let shape = CGPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), cornerWidth: 3, cornerHeight: 3, transform: nil)
        context.addPath(shape)
        if checked {
            context.setFillColor(accent.cgColor)
            context.fillPath()
            context.setStrokeColor(CGColor(gray: 1, alpha: 1))
            context.setLineWidth(1.6)
            context.setLineCap(.round)
            context.setLineJoin(.round)
            context.move(to: CGPoint(x: rect.minX + rect.width * 0.25, y: rect.midY))
            context.addLine(to: CGPoint(x: rect.minX + rect.width * 0.43, y: rect.minY + rect.height * 0.7))
            context.addLine(to: CGPoint(x: rect.minX + rect.width * 0.77, y: rect.minY + rect.height * 0.3))
            context.strokePath()
        } else {
            context.setStrokeColor(border.cgColor)
            context.setLineWidth(1)
            context.strokePath()
        }
    }
}

/// Looks up what a pasted web address is called, as the website does when a link is
/// pasted. Any failure just leaves the address showing.
enum LinkTitle {
    static func fetch(_ address: String) async -> String? {
        guard let url = URL(string: address), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 6)
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
            http.value(forHTTPHeaderField: "Content-Type")?.lowercased().contains("html") != false
        else { return nil }
        let page = String(decoding: data.prefix(256 * 1024), as: UTF8.self)
        return title(inHTML: page)
    }

    static func title(inHTML page: String) -> String? {
        guard let open = page.range(of: "<title", options: .caseInsensitive),
            let start = page[open.upperBound...].firstIndex(of: ">"),
            let close = page[start...].range(of: "</title>", options: .caseInsensitive)
        else { return nil }
        let raw = String(page[page.index(after: start)..<close.lowerBound])
        let decoded = NotesHTML.parse("<p>" + raw.replacingOccurrences(of: "<", with: "&lt;") + "</p>")?.lines.first?.text ?? raw
        let title = decoded.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        return title.isEmpty ? nil : title
    }
}
