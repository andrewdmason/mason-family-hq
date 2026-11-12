import Foundation
#if os(macOS)
import AppKit
typealias NoteFont = NSFont
typealias NoteColor = NSColor
#else
import UIKit
typealias NoteFont = UIFont
typealias NoteColor = UIColor
#endif

// Notes in a text view. Each line of the note is one paragraph of text, carrying
// what kind of line it is on its characters; bullets, checkboxes and the like are
// drawn beside the text (NoteLayoutManager), so they're never in the way of the
// cursor. Every line but a plain one starts with an invisible anchor character, so
// that even an empty bullet at the very end has somewhere to keep being a bullet.
//
// The rules live here, away from any view, so the Mac and iPhone editors behave
// the same and can be tested. Each returns an Edit for the view to apply.

extension NSAttributedString.Key {
    static let noteLine = NSAttributedString.Key("io.mason.todos.noteLine")
    static let noteMarks = NSAttributedString.Key("io.mason.todos.noteMarks")
}

struct NoteStyle {
    var size: CGFloat
    var accent: NoteColor
    var indent: CGFloat

    #if os(macOS)
    static let primary = NSColor.labelColor
    static let muted = NSColor.secondaryLabelColor
    #else
    static let primary = UIColor.label
    static let muted = UIColor.secondaryLabel
    #endif

    func font(_ kind: NoteLineKind, _ marks: NoteMarks) -> NoteFont {
        if kind == .code || marks.contains(.code) {
            return .monospacedSystemFont(ofSize: size * 0.92, weight: marks.contains(.bold) ? .semibold : .regular)
        }
        var pointSize = size
        var bold = marks.contains(.bold)
        if case .heading(let level) = kind {
            pointSize = size * (level == 1 ? 1.875 : level == 2 ? 1.5 : 1.25)
            bold = true
        }
        let plain = NoteFont.systemFont(ofSize: pointSize, weight: bold ? .semibold : .regular)
        guard marks.contains(.italic) || kind == .quote else { return plain }
        #if os(macOS)
        let descriptor = plain.fontDescriptor.withSymbolicTraits(.italic)
        return NSFont(descriptor: descriptor, size: pointSize) ?? plain
        #else
        guard let descriptor = plain.fontDescriptor.withSymbolicTraits(.traitItalic) else { return plain }
        return UIFont(descriptor: descriptor, size: pointSize)
        #endif
    }

    /// Padding inside a code block, above its first line and below its last.
    var codePadding: CGFloat { size * 0.7 }

    /// Notion's rhythm, in proportion to the text size: every block the same step
    /// apart, and headings set off by more above than below. `previous` and `next`
    /// are the lines either side; nil means the start or end of the note.
    func paragraphStyle(_ kind: NoteLineKind, previous: NoteLineKind? = nil, next: NoteLineKind? = nil) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        let blockGap = size * 0.55
        var left: CGFloat = 0
        style.lineSpacing = size * 0.25
        style.paragraphSpacing = blockGap
        switch kind {
        case .list(let path, _):
            left = CGFloat(path.count) * indent
        case .quote:
            left = 14
            if next == .quote { style.paragraphSpacing = size * 0.15 }
        case .code:
            left = 10
            style.paragraphSpacing = next == .code ? 0 : codePadding + blockGap
            if previous != .code, previous != nil { style.paragraphSpacingBefore = codePadding }
        case .heading(let level):
            style.paragraphSpacing = size * 0.2
            if previous != nil { style.paragraphSpacingBefore = size * (level == 1 ? 2.0 : level == 2 ? 1.4 : 1.0) }
        case .divider:
            style.paragraphSpacingBefore = size * 0.2
        case .paragraph:
            break
        }
        style.firstLineHeadIndent = left
        style.headIndent = left
        return style
    }

    func attributes(_ kind: NoteLineKind, marks: NoteMarks = [], link: Any? = nil) -> [NSAttributedString.Key: Any] {
        var color = NoteStyle.primary
        if kind == .quote { color = NoteStyle.muted }
        var strike = marks.contains(.strike)
        if case .list(_, true) = kind {
            color = NoteStyle.muted
            strike = true
        }
        var result: [NSAttributedString.Key: Any] = [
            .noteLine: kind.encoded, .noteMarks: marks.rawValue, .font: font(kind, marks),
            .foregroundColor: color, .paragraphStyle: paragraphStyle(kind),
        ]
        if marks.contains(.underline) { result[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        if strike { result[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        if marks.contains(.code) { result[.backgroundColor] = NoteStyle.muted.withAlphaComponent(0.14) }
        if let link { result[.link] = link }
        return result
    }

    func string(_ text: String, _ kind: NoteLineKind, marks: NoteMarks = [], link: Any? = nil) -> NSAttributedString {
        NSAttributedString(string: text, attributes: attributes(kind, marks: marks, link: link))
    }
}

/// One line of a note in its text view.
struct NoteParagraph {
    /// Includes the line's newline, if it has one.
    let range: NSRange
    let contentEnd: Int
    let kind: NoteLineKind
    /// After the anchor.
    let textStart: Int

    var isEmpty: Bool { textStart >= contentEnd }
    var hasTerminator: Bool { contentEnd < NSMaxRange(range) }
}

enum NoteEditing {
    static let anchor = "\u{200B}"
    private static let anchorUnit: unichar = 0x200B
    private static let newline: unichar = 10

    struct Edit {
        var range: NSRange
        var replacement: NSAttributedString
        var selection: NSRange
        /// The next thing typed shouldn't continue the formatting just applied.
        var clearsTypingMarks = false
    }

    // MARK: Between text and document

    static func attributed(_ document: NoteDocument, style: NoteStyle) -> NSMutableAttributedString {
        let result = NSMutableAttributedString()
        for (index, line) in document.lines.enumerated() {
            if line.kind != .paragraph { result.append(style.string(anchor, line.kind)) }
            for run in line.runs {
                result.append(style.string(run.text, line.kind, marks: run.marks, link: run.link.flatMap(URL.init(string:))))
            }
            if index < document.lines.count - 1 { result.append(style.string("\n", line.kind)) }
        }
        var location = 0
        while location < result.length {
            let line = paragraph(at: location, in: result)
            applySpacing(to: line, in: result, style: style)
            location = NSMaxRange(line.range)
        }
        return result
    }

    /// A line's spacing depends on the lines beside it.
    private static func applySpacing(to line: NoteParagraph, in text: NSMutableAttributedString, style: NoteStyle) {
        let previous = line.range.location > 0 ? paragraph(at: line.range.location - 1, in: text).kind : nil
        let end = NSMaxRange(line.range)
        let next = end < text.length ? paragraph(at: end, in: text).kind : nil
        text.addAttribute(.paragraphStyle, value: style.paragraphStyle(line.kind, previous: previous, next: next), range: line.range)
    }

    static func document(from text: NSAttributedString) -> NoteDocument {
        var lines: [NoteLine] = []
        let length = text.length
        var location = 0
        while location < length {
            let paragraph = paragraph(at: location, in: text)
            var line = NoteLine(kind: paragraph.kind)
            if paragraph.textStart < paragraph.contentEnd {
                let range = NSRange(location: paragraph.textStart, length: paragraph.contentEnd - paragraph.textStart)
                text.enumerateAttributes(in: range) { attributes, runRange, _ in
                    let piece = text.attributedSubstring(from: runRange).string.replacingOccurrences(of: anchor, with: "")
                    guard !piece.isEmpty else { return }
                    let marks = NoteMarks(rawValue: attributes[.noteMarks] as? Int ?? 0)
                    let run = NoteRun(text: piece, marks: marks, link: linkString(attributes[.link]))
                    if let last = line.runs.last, last.marks == run.marks, last.link == run.link {
                        line.runs[line.runs.count - 1].text += run.text
                    } else {
                        line.runs.append(run)
                    }
                }
            }
            lines.append(line)
            location = NSMaxRange(paragraph.range)
        }
        while let last = lines.last, last.kind == .paragraph, last.text.isEmpty { lines.removeLast() }
        return NoteDocument(lines: lines)
    }

    /// What a note shows, and whether it can be edited here. A note outside what
    /// these apps understand keeps its words but can't be changed.
    static func display(_ html: String?, style: NoteStyle) -> (text: NSMutableAttributedString, editable: Bool) {
        if let document = NotesHTML.parse(html) { return (attributed(document, style: style), true) }
        let words = TodoMerge.plainNotes(fromHTML: html) ?? ""
        return (NSMutableAttributedString(attributedString: style.string(words, .paragraph)), false)
    }

    static func linkString(_ value: Any?) -> String? {
        (value as? URL)?.absoluteString ?? value as? String
    }

    static func paragraph(at location: Int, in text: NSAttributedString) -> NoteParagraph {
        let string = text.string as NSString
        let range = string.paragraphRange(for: NSRange(location: min(location, string.length), length: 0))
        var contentEnd = NSMaxRange(range)
        if contentEnd > range.location, string.character(at: contentEnd - 1) == newline { contentEnd -= 1 }
        var kind = NoteLineKind.paragraph
        var textStart = range.location
        if range.length > 0 {
            if let encoded = text.attribute(.noteLine, at: range.location, effectiveRange: nil) as? String {
                kind = NoteLineKind(encoded: encoded) ?? .paragraph
            }
            if contentEnd > range.location, string.character(at: range.location) == anchorUnit { textStart += 1 }
        }
        return NoteParagraph(range: range, contentEnd: contentEnd, kind: kind, textStart: textStart)
    }

    private static func paragraphs(in range: NSRange, text: NSAttributedString) -> [NoteParagraph] {
        var result = [paragraph(at: range.location, in: text)]
        while let last = result.last, NSMaxRange(last.range) < NSMaxRange(range) {
            result.append(paragraph(at: NSMaxRange(last.range), in: text))
        }
        return result
    }

    /// The same line, as another kind. Keeps its formatting and its newline.
    private static func relined(_ paragraph: NoteParagraph, to kind: NoteLineKind, in text: NSAttributedString, style: NoteStyle) -> NSAttributedString {
        let result = NSMutableAttributedString()
        if kind != .paragraph { result.append(style.string(anchor, kind)) }
        if !paragraph.isEmpty {
            result.append(text.attributedSubstring(
                from: NSRange(location: paragraph.textStart, length: paragraph.contentEnd - paragraph.textStart)))
        }
        if paragraph.hasTerminator { result.append(style.string("\n", kind)) }
        restyle(result, range: NSRange(location: 0, length: result.length), forcing: kind, style: style)
        return result
    }

    private static func restyle(_ text: NSMutableAttributedString, range: NSRange, forcing kind: NoteLineKind, style: NoteStyle) {
        text.enumerateAttributes(in: range) { attributes, run, _ in
            let marks = NoteMarks(rawValue: attributes[.noteMarks] as? Int ?? 0)
            text.setAttributes(style.attributes(kind, marks: marks, link: attributes[.link]), range: run)
        }
    }

    private static func convert(_ paragraph: NoteParagraph, to kind: NoteLineKind, in text: NSAttributedString, style: NoteStyle, caret: Int?) -> Edit {
        let replacement = relined(paragraph, to: kind, in: text, style: style)
        let newStart = paragraph.range.location + (kind == .paragraph ? 0 : 1)
        let column = max((caret ?? paragraph.textStart) - paragraph.textStart, 0)
        return Edit(range: paragraph.range, replacement: replacement, selection: NSRange(location: newStart + column, length: 0))
    }

    /// After any change: a line is whatever its first character says, and the look
    /// follows from that. Only touches attributes, so undo isn't disturbed.
    static func normalize(_ storage: NSMutableAttributedString, around range: NSRange, caret: Int?, style: NoteStyle) {
        guard storage.length > 0 else { return }
        let location = min(range.location, storage.length)
        let clamped = NSRange(location: location, length: min(range.length, storage.length - location))
        var union = (storage.string as NSString).paragraphRange(for: clamped)
        // The lines either side take their spacing from this one.
        if union.location > 0 {
            let before = paragraph(at: union.location - 1, in: storage).range.location
            union = NSRange(location: before, length: NSMaxRange(union) - before)
        }
        if NSMaxRange(union) < storage.length {
            union.length = NSMaxRange(paragraph(at: NSMaxRange(union), in: storage).range) - union.location
        }
        storage.beginEditing()
        var cursor = union.location
        repeat {
            let paragraph = paragraph(at: cursor, in: storage)
            if paragraph.range.length > 0 {
                restyle(storage, range: paragraph.range, forcing: paragraph.kind, style: style)
                applySpacing(to: paragraph, in: storage, style: style)
                autolink(paragraph, in: storage, caret: caret, style: style)
            }
            cursor = NSMaxRange(paragraph.range)
        } while cursor < NSMaxRange(union)
        storage.endEditing()
    }

    private static let urlPattern = try? NSRegularExpression(pattern: #"(?<![^\s])(https?://|www\.)[^\s​]+"#, options: .caseInsensitive)

    /// A web address becomes a link once it's finished: there's a space after it,
    /// or the cursor has left it.
    private static func autolink(_ paragraph: NoteParagraph, in storage: NSMutableAttributedString, caret: Int?, style: NoteStyle) {
        guard paragraph.kind != .code, !paragraph.isEmpty, let urlPattern else { return }
        let range = NSRange(location: paragraph.textStart, length: paragraph.contentEnd - paragraph.textStart)
        let string = storage.string as NSString
        guard string.range(of: "http", options: .caseInsensitive, range: range).location != NSNotFound
            || string.range(of: "www.", options: .caseInsensitive, range: range).location != NSNotFound
        else { return }
        for match in urlPattern.matches(in: storage.string, range: range) {
            // Still being typed: a dot here may be the middle of the address.
            if let caret, caret >= match.range.location, caret <= NSMaxRange(match.range) { continue }
            var found = match.range
            while found.length > 0, ".,;:!?)".contains(string.substring(with: NSRange(location: NSMaxRange(found) - 1, length: 1))) {
                found.length -= 1
            }
            guard found.length > 0 else { continue }
            let marks = NoteMarks(rawValue: storage.attribute(.noteMarks, at: found.location, effectiveRange: nil) as? Int ?? 0)
            guard !marks.contains(.code), storage.attribute(.link, at: found.location, effectiveRange: nil) == nil else { continue }
            let address = string.substring(with: found)
            guard let url = URL(string: address.lowercased().hasPrefix("www.") ? "https://" + address : address) else { continue }
            storage.addAttribute(.link, value: url, range: found)
            storage.addAttribute(.foregroundColor, value: style.accent, range: found)
        }
    }

    /// What the next typed character should look like.
    static func typingAttributes(in text: NSAttributedString, at location: Int, style: NoteStyle) -> [NSAttributedString.Key: Any] {
        let paragraph = paragraph(at: location, in: text)
        var marks: NoteMarks = []
        var link: Any?
        if location > paragraph.textStart {
            let attributes = text.attributes(at: location - 1, effectiveRange: nil)
            marks = NoteMarks(rawValue: attributes[.noteMarks] as? Int ?? 0)
            if location < paragraph.contentEnd, let previous = linkString(attributes[.link]),
                linkString(text.attribute(.link, at: location, effectiveRange: nil)) == previous {
                link = attributes[.link]
            }
        }
        return style.attributes(paragraph.kind, marks: marks, link: link)
    }

    /// Keeps the cursor off the wrong side of an anchor, in the direction it's going.
    static func adjustedSelection(old: NSRange, proposed: NSRange, in text: NSAttributedString) -> NSRange {
        guard proposed.length == 0, proposed.location < text.length,
            (text.string as NSString).character(at: proposed.location) == anchorUnit
        else { return proposed }
        if old.location > proposed.location, proposed.location > 0 {
            return NSRange(location: proposed.location - 1, length: 0)
        }
        return NSRange(location: proposed.location + 1, length: 0)
    }

    // MARK: Typing

    /// A keystroke about to happen. Nil lets it through as ordinary typing.
    static func typing(_ inserted: String, at range: NSRange, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        if inserted.isEmpty {
            return range.length == 1 ? backspace(at: range, in: text, style: style) : nil
        }
        guard range.length == 0 else { return nil }
        switch inserted {
        case "\n": return enter(at: range.location, in: text, style: style)
        case " ": return blockShortcut(at: range.location, in: text, style: style)
        case "-": return divider(at: range.location, in: text, style: style)
        case "*", "_", "~", "`": return inlineShortcut(inserted, at: range.location, in: text, style: style)
        default: return paragraph(at: range.location, in: text).kind == .divider ? ignored(range) : nil
        }
    }

    private static func ignored(_ range: NSRange) -> Edit {
        Edit(range: NSRange(location: range.location, length: 0), replacement: NSAttributedString(), selection: range)
    }

    private static func enter(at location: Int, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let line = paragraph(at: location, in: text)
        func split(_ next: NoteLineKind) -> Edit {
            let replacement = NSMutableAttributedString(attributedString: style.string("\n", line.kind))
            replacement.append(style.string(anchor, next))
            return Edit(range: NSRange(location: location, length: 0), replacement: replacement, selection: NSRange(location: location + 2, length: 0))
        }
        switch line.kind {
        case .list(let path, _):
            guard line.isEmpty else { return split(.list(path: path, checked: false)) }
            let outer: NoteLineKind = path.count > 1 ? .list(path: Array(path.dropLast()), checked: false) : .paragraph
            return convert(line, to: outer, in: text, style: style, caret: location)
        case .quote:
            return line.isEmpty ? convert(line, to: .paragraph, in: text, style: style, caret: location) : split(.quote)
        case .heading:
            guard location >= line.contentEnd else { return split(line.kind) }
            let replacement = NSMutableAttributedString(attributedString: style.string("\n", line.kind))
            if line.hasTerminator { replacement.append(style.string("\n", .paragraph)) }
            return Edit(
                range: NSRange(location: line.contentEnd, length: line.hasTerminator ? 1 : 0), replacement: replacement,
                selection: NSRange(location: line.contentEnd + 1, length: 0), clearsTypingMarks: true)
        case .code:
            // Two empty lines at the end of a code block step out of it.
            if line.isEmpty, line.range.location > 0 {
                let previous = paragraph(at: line.range.location - 1, in: text)
                if previous.kind == .code, previous.isEmpty {
                    let replacement = relined(line, to: .paragraph, in: text, style: style)
                    return Edit(
                        range: NSRange(location: previous.range.location, length: NSMaxRange(line.range) - previous.range.location),
                        replacement: replacement, selection: NSRange(location: previous.range.location, length: 0), clearsTypingMarks: true)
                }
            }
            return split(.code)
        case .divider:
            let replacement = NSMutableAttributedString(attributedString: style.string("\n", .divider))
            return Edit(range: NSRange(location: line.contentEnd, length: 0), replacement: replacement, selection: NSRange(location: line.contentEnd + 1, length: 0))
        case .paragraph:
            let content = (text.string as NSString).substring(with: NSRange(location: line.range.location, length: line.contentEnd - line.range.location))
            guard content == "```", location == line.contentEnd else { return nil }
            return blockEdit(.code, removing: 3, line: line, in: text, style: style)
        }
    }

    private static func blockEdit(_ kind: NoteLineKind, removing count: Int, line: NoteParagraph, in text: NSAttributedString, style: NoteStyle) -> Edit {
        let remaining = NSRange(location: line.range.location + count, length: line.contentEnd - line.range.location - count)
        let replacement = NSMutableAttributedString(attributedString: style.string(anchor, kind))
        replacement.append(text.attributedSubstring(from: remaining))
        if line.hasTerminator { replacement.append(style.string("\n", kind)) }
        restyle(replacement, range: NSRange(location: 0, length: replacement.length), forcing: kind, style: style)
        return Edit(range: line.range, replacement: replacement, selection: NSRange(location: line.range.location + 1, length: 0))
    }

    /// `# `, `- `, `1. `, `[] `, `> ` and code fences at the start of a plain line.
    private static func blockShortcut(at location: Int, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let line = paragraph(at: location, in: text)
        if line.kind == .divider { return ignored(NSRange(location: location, length: 0)) }
        guard line.kind == .paragraph, location > line.range.location else { return nil }
        let prefix = (text.string as NSString).substring(with: NSRange(location: line.range.location, length: location - line.range.location))
        guard let kind = blockKind(forPrefix: prefix) else { return nil }
        return blockEdit(kind, removing: location - line.range.location, line: line, in: text, style: style)
    }

    static func blockKind(forPrefix prefix: String) -> NoteLineKind? {
        switch prefix {
        case "#": .heading(1)
        case "##": .heading(2)
        case "###": .heading(3)
        case "-", "*", "+": .list(path: [.bullet], checked: false)
        case "[]", "[ ]": .list(path: [.task], checked: false)
        case "[x]", "[X]": .list(path: [.task], checked: true)
        case ">": .quote
        case "```": .code
        default:
            prefix.count > 1 && prefix.hasSuffix(".") && prefix.dropLast().allSatisfy(\.isNumber)
                ? .list(path: [.ordered], checked: false) : nil
        }
    }

    private static func divider(at location: Int, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let line = paragraph(at: location, in: text)
        let content = (text.string as NSString).substring(with: NSRange(location: line.range.location, length: line.contentEnd - line.range.location))
        guard line.kind == .paragraph, content == "--", location == line.contentEnd else {
            return line.kind == .divider ? ignored(NSRange(location: location, length: 0)) : nil
        }
        let replacement = NSMutableAttributedString(attributedString: style.string(anchor, .divider))
        replacement.append(style.string("\n", .divider))
        // A divider is never the last thing: the cursor needs a line after it.
        var after = line.range.location + 2
        if line.hasTerminator {
            let next = NSMaxRange(line.range)
            after = next < text.length ? self.paragraph(at: next, in: text).textStart + 1 : after
        }
        if !line.hasTerminator || NSMaxRange(line.range) >= text.length {
            after = line.range.location + 2
        }
        return Edit(range: line.range, replacement: replacement, selection: NSRange(location: after, length: 0), clearsTypingMarks: true)
    }

    /// `**bold**`, `*italic*`, `_italic_`, `~~strike~~` and `` `code` ``, the moment
    /// the closing mark is typed.
    private static func inlineShortcut(_ inserted: String, at location: Int, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let line = paragraph(at: location, in: text)
        if line.kind == .divider { return ignored(NSRange(location: location, length: 0)) }
        guard line.kind != .code, location > line.textStart else { return nil }
        let before = (text.string as NSString).substring(with: NSRange(location: line.textStart, length: location - line.textStart)) as NSString

        let rules: [(close: String, mark: NoteMarks)]
        switch inserted {
        case "*": rules = [("**", .bold), ("*", .italic)]
        case "_": rules = [("_", .italic)]
        case "~": rules = [("~~", .strike)]
        default: rules = [("`", .code)]
        }
        for (close, mark) in rules {
            // The closing mark's last character is the one being typed.
            let typedPart = close.count - 1
            guard before.length > typedPart else { continue }
            let suffix = before.substring(from: before.length - typedPart)
            guard suffix == String(close.dropLast()) else { continue }
            let contentEnd = before.length - typedPart
            guard contentEnd > 0 else { continue }
            let open = before.range(of: close, options: .backwards, range: NSRange(location: 0, length: contentEnd))
            guard open.location != NSNotFound else { continue }
            let contentStart = NSMaxRange(open)
            guard contentStart < contentEnd else { continue }
            let content = before.substring(with: NSRange(location: contentStart, length: contentEnd - contentStart))
            guard let first = content.first, let last = content.last, !first.isWhitespace, !last.isWhitespace else { continue }
            if close == "*" {
                // Not half of a `**`.
                if open.location > 0, before.substring(with: NSRange(location: open.location - 1, length: 1)) == "*" { continue }
                if content.hasPrefix("*") { continue }
            }
            if close == "_", open.location > 0, !before.substring(with: NSRange(location: open.location - 1, length: 1)).trimmingCharacters(in: .whitespaces).isEmpty { continue }

            let source = NSRange(location: line.textStart + contentStart, length: contentEnd - contentStart)
            let replacement = NSMutableAttributedString(attributedString: text.attributedSubstring(from: source))
            add(mark, to: replacement, style: style, kind: line.kind)
            let start = line.textStart + open.location
            return Edit(
                range: NSRange(location: start, length: location - start), replacement: replacement,
                selection: NSRange(location: start + replacement.length, length: 0), clearsTypingMarks: true)
        }
        return nil
    }

    private static func add(_ mark: NoteMarks, to text: NSMutableAttributedString, style: NoteStyle, kind: NoteLineKind) {
        let whole = NSRange(location: 0, length: text.length)
        text.enumerateAttributes(in: whole) { attributes, run, _ in
            var marks = NoteMarks(rawValue: attributes[.noteMarks] as? Int ?? 0)
            marks.insert(mark)
            text.setAttributes(style.attributes(kind, marks: marks, link: attributes[.link]), range: run)
        }
    }

    private static func backspace(at range: NSRange, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        guard range.location < text.length else { return nil }
        let unit = (text.string as NSString).character(at: range.location)
        let line = paragraph(at: range.location, in: text)

        if unit == anchorUnit, range.location == line.range.location, line.kind != .paragraph {
            switch line.kind {
            case .divider:
                return Edit(range: line.range, replacement: NSAttributedString(), selection: NSRange(location: line.range.location, length: 0))
            case .list(let path, _) where path.count > 1:
                return convert(line, to: .list(path: Array(path.dropLast()), checked: false), in: text, style: style, caret: line.textStart)
            default:
                return convert(line, to: .paragraph, in: text, style: style, caret: line.textStart)
            }
        }
        // Backspace at the start of the line after a divider takes the divider away.
        if unit == newline, line.kind == .divider {
            return Edit(range: line.range, replacement: NSAttributedString(), selection: NSRange(location: line.range.location, length: 0))
        }
        return nil
    }

    // MARK: Commands

    /// Tab: under the item above. Nil when it can't, so Tab can do its usual job.
    static func indent(_ selection: NSRange, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let lines = paragraphs(in: selection, text: text)
        var previousDepth = 0
        if lines[0].range.location > 0 {
            previousDepth = paragraph(at: lines[0].range.location - 1, in: text).kind.depth
        }
        let result = NSMutableAttributedString()
        for line in lines {
            guard case .list(let path, let checked) = line.kind, previousDepth >= path.count else { return nil }
            let deeper = path + [path[path.count - 1]]
            result.append(relined(line, to: .list(path: deeper, checked: checked), in: text, style: style))
            previousDepth = deeper.count
        }
        return Edit(range: union(lines), replacement: result, selection: selection)
    }

    static func outdent(_ selection: NSRange, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let lines = paragraphs(in: selection, text: text)
        let result = NSMutableAttributedString()
        for line in lines {
            guard case .list(let path, let checked) = line.kind, path.count > 1 else { return nil }
            result.append(relined(line, to: .list(path: Array(path.dropLast()), checked: checked), in: text, style: style))
        }
        return Edit(range: union(lines), replacement: result, selection: selection)
    }

    private static func union(_ lines: [NoteParagraph]) -> NSRange {
        NSRange(location: lines[0].range.location, length: NSMaxRange(lines[lines.count - 1].range) - lines[0].range.location)
    }

    /// Bold and friends over a selection: on, unless it's all on already.
    static func toggle(_ mark: NoteMarks, selection: NSRange, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        guard selection.length > 0 else { return nil }
        var allOn = true
        text.enumerateAttribute(.noteMarks, in: selection) { value, _, stop in
            if !NoteMarks(rawValue: value as? Int ?? 0).contains(mark) {
                allOn = false
                stop.pointee = true
            }
        }
        let replacement = NSMutableAttributedString(attributedString: text.attributedSubstring(from: selection))
        let whole = NSRange(location: 0, length: replacement.length)
        replacement.enumerateAttributes(in: whole) { attributes, run, _ in
            var marks = NoteMarks(rawValue: attributes[.noteMarks] as? Int ?? 0)
            if allOn { marks.remove(mark) } else { marks.insert(mark) }
            replacement.addAttribute(.noteMarks, value: marks.rawValue, range: run)
        }
        return Edit(range: selection, replacement: replacement, selection: selection)
    }

    /// A heading, list, quote or code block for the selected lines; again to undo it.
    static func setBlock(_ kind: NoteLineKind, selection: NSRange, in text: NSAttributedString, style: NoteStyle) -> Edit {
        let lines = paragraphs(in: selection, text: text)
        let matches: (NoteParagraph) -> Bool = { line in
            if case .list(let wanted, _) = kind, case .list(let path, _) = line.kind { return wanted.last == path.last }
            return line.kind == kind
        }
        let target = lines.allSatisfy(matches) ? NoteLineKind.paragraph : kind
        let result = NSMutableAttributedString()
        for line in lines { result.append(relined(line, to: target, in: text, style: style)) }
        if lines.count == 1 {
            let edit = convert(lines[0], to: target, in: text, style: style, caret: selection.location)
            return Edit(range: edit.range, replacement: edit.replacement, selection: NSRange(location: edit.selection.location, length: selection.length))
        }
        return Edit(range: union(lines), replacement: result, selection: NSRange(location: lines[0].range.location, length: max(result.length - 1, 0)))
    }

    static func toggleChecked(at location: Int, selection: NSRange, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let line = paragraph(at: location, in: text)
        guard case .list(let path, let checked) = line.kind, path.last == .task else { return nil }
        let replacement = relined(line, to: .list(path: path, checked: !checked), in: text, style: style)
        return Edit(range: line.range, replacement: replacement, selection: selection)
    }

    // MARK: Moving lines

    /// Each line's range, top to bottom. The empty line after a final newline isn't one.
    static func lineRanges(in text: NSAttributedString) -> [NSRange] {
        var result: [NSRange] = []
        var location = 0
        while location < text.length {
            let line = paragraph(at: location, in: text)
            result.append(line.range)
            location = NSMaxRange(line.range)
        }
        return result
    }

    static func lineIndex(at location: Int, in text: NSAttributedString) -> Int? {
        let ranges = lineRanges(in: text)
        if let index = ranges.firstIndex(where: { NSLocationInRange(location, $0) }) { return index }
        return location >= text.length && !ranges.isEmpty ? ranges.count - 1 : nil
    }

    /// The line at this index and, for a list item, the items nested under it.
    static func block(_ lines: [NoteLine], at index: Int) -> Range<Int> {
        var end = index + 1
        guard case .list = lines[index].kind else { return index..<end }
        let depth = lines[index].kind.depth
        while end < lines.count, lines[end].kind.depth > depth { end += 1 }
        return index..<end
    }

    /// Lines with a block moved to a gap (0 is above the first line). Nil when that's
    /// where it is already, or inside itself. A list item never ends up nested deeper
    /// than the line above it allows.
    static func moving(_ lines: [NoteLine], block: Range<Int>, toGap gap: Int) -> (lines: [NoteLine], start: Int)? {
        let gap = min(gap, lines.count)
        guard gap < block.lowerBound || gap > block.upperBound else { return nil }
        var rest = lines
        var moved = Array(rest[block])
        rest.removeSubrange(block)
        let start = gap > block.upperBound ? gap - block.count : gap
        let allowed = (start > 0 ? rest[start - 1].kind.depth : 0) + 1
        if case .list(let path, _) = moved[0].kind, path.count > allowed {
            let drop = path.count - allowed
            moved = moved.map { line in
                guard case .list(let path, let checked) = line.kind else { return line }
                var line = line
                line.kind = .list(path: Array(path.dropFirst(drop)), checked: checked)
                return line
            }
        }
        rest.insert(contentsOf: moved, at: start)
        return (rest, start)
    }

    /// Moves the line holding `location`, with what's nested under it, to a gap
    /// between lines. The caret lands at the end of the moved line.
    static func moveLine(at location: Int, toGap gap: Int, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let lines = document(from: text).lines
        guard let index = lineIndex(at: location, in: text), lines.indices.contains(index),
            let result = moving(lines, block: block(lines, at: index), toGap: gap)
        else { return nil }
        let replacement = attributed(NoteDocument(lines: result.lines), style: style)
        let ranges = lineRanges(in: replacement)
        let caret = ranges.indices.contains(result.start) ? paragraph(at: ranges[result.start].location, in: replacement).contentEnd : replacement.length
        return Edit(
            range: NSRange(location: 0, length: text.length), replacement: replacement,
            selection: NSRange(location: caret, length: 0))
    }

    /// ⌥⌘↑ and ⌥⌘↓: past the neighbouring item, along with what's nested under it.
    static func moveLine(at location: Int, up: Bool, in text: NSAttributedString, style: NoteStyle) -> Edit? {
        let lines = document(from: text).lines
        guard let index = lineIndex(at: location, in: text), lines.indices.contains(index)
        else { return nil }
        let own = block(lines, at: index)
        let depth = lines[index].kind.depth
        let gap: Int
        if up {
            guard let above = lines[..<index].lastIndex(where: { $0.kind.depth <= depth }) else { return nil }
            gap = above
        } else {
            guard own.upperBound < lines.count else { return nil }
            gap = block(lines, at: own.upperBound).upperBound
        }
        return moveLine(at: location, toGap: gap, in: text, style: style)
    }

    // MARK: Pasting

    private static let urlOnly = try? NSRegularExpression(pattern: #"^https?://\S+$"#, options: .caseInsensitive)

    /// A web address alone, ready for its page title to be looked up.
    static func pastedURL(_ pasted: String) -> String? {
        let trimmed = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(location: 0, length: (trimmed as NSString).length)
        return urlOnly?.firstMatch(in: trimmed, range: range) != nil ? trimmed : nil
    }

    /// As on the website: a web address links, and anything else reads as markdown.
    static func paste(_ pasted: String, selection: NSRange, in text: NSAttributedString, style: NoteStyle) -> Edit {
        let line = paragraph(at: selection.location, in: text)

        if let address = pastedURL(pasted), let url = URL(string: address), line.kind != .code {
            let insertion: NSMutableAttributedString
            if selection.length > 0 {
                insertion = NSMutableAttributedString(attributedString: text.attributedSubstring(from: selection))
                insertion.addAttribute(.link, value: url, range: NSRange(location: 0, length: insertion.length))
            } else {
                insertion = NSMutableAttributedString(attributedString: style.string(address, line.kind, link: url))
            }
            return Edit(
                range: selection, replacement: insertion, selection: NSRange(location: selection.location + insertion.length, length: 0),
                clearsTypingMarks: true)
        }

        let clean = pasted.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\u{2029}", with: "\n")
        if line.kind == .code {
            let replacement = NSMutableAttributedString()
            for (index, piece) in clean.components(separatedBy: "\n").enumerated() {
                if index > 0 {
                    replacement.append(style.string("\n", .code))
                    replacement.append(style.string(anchor, .code))
                }
                replacement.append(style.string(piece, .code))
            }
            return Edit(range: selection, replacement: replacement, selection: NSRange(location: selection.location + replacement.length, length: 0))
        }

        let document = NoteMarkdown.parse(clean)
        guard !document.lines.isEmpty else {
            return Edit(range: selection, replacement: NSAttributedString(), selection: NSRange(location: selection.location, length: 0))
        }
        var range = selection
        let replacement = NSMutableAttributedString()
        var lines = document.lines
        let first = lines[0]
        // An empty line takes on the first pasted line's kind; otherwise the pasted
        // text carries on the line it landed in.
        if first.kind != .paragraph, line.isEmpty, selection.length == 0 {
            range = NSRange(location: line.range.location, length: line.contentEnd - line.range.location)
            replacement.append(attributed(NoteDocument(lines: [first]), style: style))
        } else {
            for run in first.runs {
                replacement.append(style.string(run.text, line.kind, marks: run.marks, link: run.link.flatMap(URL.init(string:))))
            }
        }
        lines.removeFirst()
        if !lines.isEmpty {
            replacement.append(style.string("\n", line.kind))
            replacement.append(attributed(NoteDocument(lines: lines), style: style))
        }
        return Edit(range: range, replacement: replacement, selection: NSRange(location: range.location + replacement.length, length: 0))
    }

    /// Swaps a pasted address for its page's title, if the address is still there.
    static func titleSwap(address: String, title: String, in text: NSAttributedString, selection: NSRange, style: NoteStyle) -> Edit? {
        let found = (text.string as NSString).range(of: address)
        guard found.location != NSNotFound, linkString(text.attribute(.link, at: found.location, effectiveRange: nil)) != nil else { return nil }
        let attributes = text.attributes(at: found.location, effectiveRange: nil)
        let replacement = NSAttributedString(string: title, attributes: attributes)
        var caret = selection
        if caret.location >= NSMaxRange(found) { caret.location += replacement.length - found.length }
        return Edit(range: found, replacement: replacement, selection: caret)
    }

    /// For tests, and anything else without a text view.
    static func apply(_ edit: Edit, to storage: NSMutableAttributedString, style: NoteStyle) {
        storage.replaceCharacters(in: edit.range, with: edit.replacement)
        normalize(
            storage, around: NSRange(location: edit.range.location, length: edit.replacement.length),
            caret: edit.selection.location, style: style)
    }
}

/// Markdown as it arrives from the clipboard, one line of the note per line of text.
enum NoteMarkdown {
    static func parse(_ text: String) -> NoteDocument {
        var document = NoteDocument()
        var inCode = false
        for raw in text.components(separatedBy: "\n") {
            if raw.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                inCode.toggle()
                continue
            }
            if inCode {
                document.lines.append(NoteLine(kind: .code, runs: raw.isEmpty ? [] : [NoteRun(text: raw)]))
                continue
            }
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }
            if ["---", "***", "___"].contains(trimmed) {
                document.lines.append(NoteLine(kind: .divider))
                continue
            }
            var kind = NoteLineKind.paragraph
            var body = trimmed
            if let space = trimmed.firstIndex(of: " "), var found = NoteEditing.blockKind(forPrefix: String(trimmed[..<space])), found != .code {
                body = String(trimmed[trimmed.index(after: space)...]).trimmingCharacters(in: .whitespaces)
                // Two spaces of indent is one level, as far as there's a parent for it.
                if case .list(let path, let checked) = found {
                    let wanted = (raw.prefix { $0 == " " }.count + raw.prefix { $0 == "\t" }.count * 2) / 2
                    let previous = document.lines.last?.kind.depth ?? 0
                    let depth = min(wanted, previous)
                    var outer: [NoteListKind] = []
                    if depth > 0, case .list(let parent, _)? = document.lines.last?.kind {
                        outer = Array(parent.prefix(depth))
                    }
                    found = .list(path: outer + path, checked: checked)
                }
                kind = found
            }
            document.lines.append(NoteLine(kind: kind, runs: inline(body)))
        }
        return document
    }

    private static let delimiters: [(open: String, close: String, mark: NoteMarks)] = [
        ("**", "**", .bold), ("__", "__", .bold), ("~~", "~~", .strike), ("`", "`", .code), ("*", "*", .italic), ("_", "_", .italic),
    ]
    private static let markdownLink = try? NSRegularExpression(pattern: #"\[([^\]]+)\]\(([^)\s]+)\)"#)
    private static let bareURL = try? NSRegularExpression(pattern: #"(?<![^\s(])https?://[^\s<>)]+"#, options: .caseInsensitive)

    static func inline(_ text: String, marks: NoteMarks = [], link: String? = nil) -> [NoteRun] {
        var runs: [NoteRun] = []
        var rest = text
        func push(_ piece: String) {
            guard !piece.isEmpty else { return }
            runs.append(NoteRun(text: piece, marks: marks, link: link))
        }

        while !rest.isEmpty {
            let nsRest = rest as NSString
            let whole = NSRange(location: 0, length: nsRest.length)
            var best: (range: NSRange, runs: [NoteRun])?

            if link == nil, let match = markdownLink?.firstMatch(in: rest, range: whole) {
                let address = nsRest.substring(with: match.range(at: 2))
                let label = nsRest.substring(with: match.range(at: 1))
                best = (match.range, inline(label, marks: marks, link: NotesHTML.safeLink(address)))
            }
            if link == nil, !marks.contains(.code), let match = bareURL?.firstMatch(in: rest, range: whole),
                best == nil || match.range.location < best!.range.location {
                let address = nsRest.substring(with: match.range)
                best = (match.range, [NoteRun(text: address, marks: marks, link: address)])
            }
            for (open, close, mark) in delimiters where !marks.contains(.code) {
                var from = 0
                while from < nsRest.length {
                    let start = nsRest.range(of: open, range: NSRange(location: from, length: nsRest.length - from))
                    guard start.location != NSNotFound else { break }
                    from = NSMaxRange(start)
                    if let found = best, start.location >= found.range.location { break }
                    let after = NSMaxRange(start)
                    guard after < nsRest.length else { break }
                    if nsRest.substring(with: NSRange(location: after, length: 1)).trimmingCharacters(in: .whitespaces).isEmpty { continue }
                    if open == "_", start.location > 0,
                        !nsRest.substring(with: NSRange(location: start.location - 1, length: 1)).trimmingCharacters(in: .whitespaces).isEmpty { continue }
                    let end = nsRest.range(of: close, range: NSRange(location: after, length: nsRest.length - after))
                    guard end.location != NSNotFound, end.location > after else { continue }
                    let range = NSRange(location: start.location, length: NSMaxRange(end) - start.location)
                    let content = nsRest.substring(with: NSRange(location: after, length: end.location - after))
                    best = (range, inline(content, marks: marks.union(mark), link: link))
                    break
                }
            }

            guard let best else {
                push(rest)
                break
            }
            push(nsRest.substring(to: best.range.location))
            runs += best.runs
            rest = nsRest.substring(from: NSMaxRange(best.range))
        }

        var merged: [NoteRun] = []
        for run in runs {
            if let last = merged.last, last.marks == run.marks, last.link == run.link {
                merged[merged.count - 1].text += run.text
            } else {
                merged.append(run)
            }
        }
        return merged
    }
}
