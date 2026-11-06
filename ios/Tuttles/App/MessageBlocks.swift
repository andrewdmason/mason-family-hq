import Foundation

/// A tutor reply, split into what's drawn one after another down the screen.
/// The reply is Markdown with LaTeX and ```visual blocks (the format the tutor
/// is given in src/lib/tuttles/prompt.ts); the website's parent view parses the
/// same text, so keep the two agreeing about what a block is.
///
/// Inline formatting (bold, italic, code, links, $math$) stays as text inside a
/// block and is handled where the block is drawn.
enum MessageBlock: Equatable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case bullets([ListItem])
    case numbered([ListItem])
    case table(header: [String], rows: [[String]])
    case math(String)
    case visual(String)
    case code(String)
    case rule

    struct ListItem: Equatable {
        var text: String
        /// 0 for a top-level item, 1 for one nested under it, and so on.
        var depth: Int
        /// The number the tutor wrote, for numbered lists.
        var number: Int?
    }
}

enum MessageBlocks {
    private static let bullet = /^(\s*)[-*•]\s+(.*)$/
    private static let numbered = /^(\s*)(\d+)[.)]\s+(.*)$/
    private static let heading = /^(#{1,6})\s+(.*)$/

    static func parse(_ text: String) -> [MessageBlock] {
        var blocks: [MessageBlock] = []
        var paragraph: [String] = []
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var i = 0

        func flushParagraph() {
            let joined = paragraph.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !joined.isEmpty { blocks.append(.paragraph(joined)) }
            paragraph = []
        }

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code, including the tutor's visuals. An unclosed fence (a
            // reply still arriving) runs to the end and shows once it closes.
            if trimmed.hasPrefix("```") {
                flushParagraph()
                let lang = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces).lowercased()
                var body: [String] = []
                i += 1
                var closed = false
                while i < lines.count {
                    if lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { closed = true; i += 1; break }
                    body.append(lines[i])
                    i += 1
                }
                let content = body.joined(separator: "\n")
                if lang == "visual" {
                    if closed { blocks.append(.visual(content)) }
                } else if lang == "math" || lang == "latex" {
                    blocks.append(.math(content))
                } else {
                    blocks.append(.code(content))
                }
                continue
            }

            // Display math: $$…$$ or \[…\], on one line or across several.
            if let (open, close) = [("$$", "$$"), ("\\[", "\\]")].first(where: { trimmed.hasPrefix($0.0) }) {
                flushParagraph()
                var body = String(trimmed.dropFirst(open.count))
                if let end = body.range(of: close) {
                    let rest = body[end.upperBound...].trimmingCharacters(in: .whitespaces)
                    blocks.append(.math(String(body[..<end.lowerBound])))
                    if !rest.isEmpty { paragraph.append(rest) }
                    i += 1
                    continue
                }
                i += 1
                while i < lines.count {
                    if let end = lines[i].range(of: close) {
                        body += "\n" + String(lines[i][..<end.lowerBound])
                        i += 1
                        break
                    }
                    body += "\n" + lines[i]
                    i += 1
                }
                blocks.append(.math(body.trimmingCharacters(in: .whitespacesAndNewlines)))
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                i += 1
                continue
            }

            if let m = trimmed.wholeMatch(of: heading) {
                flushParagraph()
                blocks.append(.heading(level: m.1.count, text: String(m.2)))
                i += 1
                continue
            }

            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flushParagraph()
                blocks.append(.rule)
                i += 1
                continue
            }

            // A table: a row of cells, then a |---|---| separator.
            if trimmed.hasPrefix("|"), i + 1 < lines.count, isSeparator(lines[i + 1]) {
                flushParagraph()
                let header = cells(trimmed)
                var rows: [[String]] = []
                i += 2
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    rows.append(cells(lines[i].trimmingCharacters(in: .whitespaces)))
                    i += 1
                }
                blocks.append(.table(header: header, rows: rows))
                continue
            }

            if line.wholeMatch(of: bullet) != nil || line.wholeMatch(of: numbered) != nil {
                flushParagraph()
                let isNumbered = line.wholeMatch(of: numbered) != nil
                var items: [MessageBlock.ListItem] = []
                while i < lines.count {
                    let l = lines[i]
                    if let m = l.wholeMatch(of: bullet), !isNumbered || depth(m.1) > 0 {
                        items.append(.init(text: String(m.2), depth: depth(m.1)))
                    } else if let m = l.wholeMatch(of: numbered), isNumbered || depth(m.1) > 0 {
                        items.append(.init(text: String(m.3), depth: depth(m.1), number: Int(m.2)))
                    } else if l.trimmingCharacters(in: .whitespaces).isEmpty {
                        // A blank line inside a list is spacing, unless the list ends there.
                        let next = lines[(i + 1)...].first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                        let continues = next.map {
                            isNumbered ? $0.wholeMatch(of: numbered) != nil || $0.wholeMatch(of: bullet) != nil
                                : $0.wholeMatch(of: bullet) != nil
                        } ?? false
                        guard continues else { break }
                    } else if l.hasPrefix("  "), !items.isEmpty {
                        // A wrapped continuation of the item above.
                        items[items.count - 1].text += " " + l.trimmingCharacters(in: .whitespaces)
                    } else { break }
                    i += 1
                }
                blocks.append(isNumbered ? .numbered(items) : .bullets(items))
                continue
            }

            paragraph.append(line)
            i += 1
        }
        flushParagraph()
        return blocks
    }

    private static func depth(_ indent: Substring) -> Int {
        let spaces = indent.reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }
        return min(spaces / 2, 3)
    }

    private static func isSeparator(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        return t.hasPrefix("|") && t.contains("-") && t.allSatisfy { "|-: ".contains($0) }
    }

    private static func cells(_ row: String) -> [String] {
        var t = Substring(row)
        if t.hasPrefix("|") { t = t.dropFirst() }
        if t.hasSuffix("|") { t = t.dropLast() }
        return t.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
    }
}

/// Inline text, split into prose (still Markdown) and $math$.
enum InlineRun: Equatable {
    case text(String)
    case math(String)

    /// `$…$` and `\(…\)`. A lone dollar ("costs $5") stays text: math needs a
    /// closing dollar on the same line, no space just inside either dollar, and
    /// no digit right after the closing one (Pandoc's rule).
    static func split(_ text: String) -> [InlineRun] {
        var runs: [InlineRun] = []
        var prose = ""
        var i = text.startIndex
        while i < text.endIndex {
            if text[i...].hasPrefix("\\("), let end = text[i...].range(of: "\\)") {
                if !prose.isEmpty { runs.append(.text(prose)); prose = "" }
                runs.append(.math(String(text[text.index(i, offsetBy: 2)..<end.lowerBound])))
                i = end.upperBound
                continue
            }
            if text[i] == "$" {
                let start = text.index(after: i)
                if start < text.endIndex, text[start] != " ", text[start] != "$",
                   let close = text[start...].firstIndex(where: { $0 == "$" || $0 == "\n" }), text[close] == "$",
                   text[text.index(before: close)] != " ",
                   !(text.index(after: close) < text.endIndex && text[text.index(after: close)].isNumber) {
                    if !prose.isEmpty { runs.append(.text(prose)); prose = "" }
                    runs.append(.math(String(text[start..<close])))
                    i = text.index(after: close)
                    continue
                }
            }
            prose.append(text[i])
            i = text.index(after: i)
        }
        if !prose.isEmpty { runs.append(.text(prose)) }
        return runs
    }
}
