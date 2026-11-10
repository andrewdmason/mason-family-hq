import Foundation

// Notes as the website stores them: the small set of HTML its editor (Tiptap)
// writes and its server allows. Here that HTML becomes a flat list of lines, which
// is what a native text view can hold, and goes back again in the website's own
// shape. Anything outside that set makes `parse` return nil, and the note is shown
// but not editable, so a device can never rewrite what it didn't understand.

struct NoteMarks: OptionSet, Hashable {
    let rawValue: Int
    static let bold = NoteMarks(rawValue: 1)
    static let italic = NoteMarks(rawValue: 2)
    static let underline = NoteMarks(rawValue: 4)
    static let strike = NoteMarks(rawValue: 8)
    static let code = NoteMarks(rawValue: 16)
}

struct NoteRun: Equatable {
    var text: String
    var marks: NoteMarks = []
    var link: String? = nil
}

enum NoteListKind: Character, Equatable {
    case bullet = "b"
    case ordered = "o"
    case task = "t"
}

enum NoteLineKind: Equatable {
    case paragraph
    case heading(Int)
    case quote
    case code
    case divider
    /// `path` runs from the outermost list to this item's own.
    case list(path: [NoteListKind], checked: Bool)

    var depth: Int {
        if case .list(let path, _) = self { path.count } else { 0 }
    }

    /// How it travels on the text view's characters.
    var encoded: String {
        switch self {
        case .paragraph: "p"
        case .heading(let level): "h\(level)"
        case .quote: "q"
        case .code: "c"
        case .divider: "r"
        case .list(let path, let checked): "l" + String(path.map(\.rawValue)) + (checked ? "x" : "")
        }
    }

    init?(encoded: String) {
        guard let first = encoded.first else { return nil }
        switch first {
        case "p": self = .paragraph
        case "h":
            guard let level = Int(encoded.dropFirst()) else { return nil }
            self = .heading(level)
        case "q": self = .quote
        case "c": self = .code
        case "r": self = .divider
        case "l":
            var body = encoded.dropFirst()
            let checked = body.last == "x"
            if checked { body = body.dropLast() }
            let path = body.compactMap(NoteListKind.init(rawValue:))
            guard !path.isEmpty, path.count == body.count else { return nil }
            self = .list(path: path, checked: checked)
        default: return nil
        }
    }
}

struct NoteLine: Equatable {
    var kind: NoteLineKind = .paragraph
    var runs: [NoteRun] = []

    var text: String { runs.map(\.text).joined() }
}

struct NoteDocument: Equatable {
    var lines: [NoteLine] = []

    var isEmpty: Bool {
        !lines.contains { $0.kind == .divider || !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
}

enum NotesHTML {
    /// A hard line break inside a line: `<br>` in the HTML.
    static let lineBreak = "\u{2028}"

    // MARK: Reading

    /// Nil when the note holds something these apps can't represent.
    static func parse(_ html: String?) -> NoteDocument? {
        guard let html, !html.isEmpty else { return NoteDocument() }
        guard let nodes = parseNodes(html) else { return nil }
        var document = NoteDocument()
        return appendBlocks(nodes, to: &document) ? document : nil
    }

    private indirect enum Node {
        case text(String)
        case element(String, [String: String], [Node])

        var isBlank: Bool {
            if case .text(let text) = self { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } else { false }
        }
    }

    private static let voidTags: Set<String> = ["br", "hr", "input"]
    private static let inlineTags: Set<String> = ["strong", "b", "em", "i", "u", "s", "code", "a", "span", "br"]

    private static func parseNodes(_ html: String) -> [Node]? {
        var stack: [(name: String, attributes: [String: String], children: [Node])] = [("", [:], [])]
        var rest = Substring(html)
        func add(_ node: Node) { stack[stack.count - 1].children.append(node) }

        while !rest.isEmpty {
            guard let open = rest.firstIndex(of: "<") else {
                add(.text(decodeEntities(String(rest))))
                break
            }
            if open > rest.startIndex { add(.text(decodeEntities(String(rest[..<open])))) }
            guard let close = endOfTag(in: rest[open...]) else { return nil }
            let tag = rest[rest.index(after: open)..<close]
            rest = rest[rest.index(after: close)...]

            if tag.hasPrefix("/") {
                let name = tag.dropFirst().trimmingCharacters(in: .whitespaces).lowercased()
                guard stack.count > 1, stack[stack.count - 1].name == name else { return nil }
                let finished = stack.removeLast()
                add(.element(finished.name, finished.attributes, finished.children))
                continue
            }
            guard let (name, attributes, selfClosed) = parseTag(tag) else { return nil }
            if selfClosed || voidTags.contains(name) {
                add(.element(name, attributes, []))
            } else {
                stack.append((name, attributes, []))
            }
        }
        return stack.count == 1 ? stack[0].children : nil
    }

    /// The `>` ending a tag, stepping over quoted attribute values.
    private static func endOfTag(in text: Substring) -> Substring.Index? {
        var quote: Character?
        for index in text.indices {
            let character = text[index]
            if let open = quote {
                if character == open { quote = nil }
            } else if character == "\"" || character == "'" {
                quote = character
            } else if character == ">" {
                return index
            }
        }
        return nil
    }

    private static func parseTag(_ tag: Substring) -> (String, [String: String], Bool)? {
        var body = tag
        let selfClosed = body.hasSuffix("/")
        if selfClosed { body = body.dropLast() }
        let nameEnd = body.firstIndex(where: \.isWhitespace) ?? body.endIndex
        let name = body[..<nameEnd].lowercased()
        guard !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber }) else { return nil }

        var attributes: [String: String] = [:]
        var rest = body[nameEnd...].drop(while: \.isWhitespace)
        while !rest.isEmpty {
            let keyEnd = rest.firstIndex { $0 == "=" || $0.isWhitespace } ?? rest.endIndex
            let key = rest[..<keyEnd].lowercased()
            rest = rest[keyEnd...].drop(while: \.isWhitespace)
            guard rest.first == "=" else {
                attributes[key] = ""
                continue
            }
            rest = rest.dropFirst().drop(while: \.isWhitespace)
            if let quote = rest.first, quote == "\"" || quote == "'" {
                rest = rest.dropFirst()
                guard let end = rest.firstIndex(of: quote) else { return nil }
                attributes[key] = decodeEntities(String(rest[..<end]))
                rest = rest[rest.index(after: end)...]
            } else {
                let end = rest.firstIndex(where: \.isWhitespace) ?? rest.endIndex
                attributes[key] = decodeEntities(String(rest[..<end]))
                rest = rest[end...]
            }
            rest = rest.drop(while: \.isWhitespace)
        }
        return (name, attributes, selfClosed)
    }

    private static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var result = ""
        var rest = Substring(text)
        let named = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{00A0}"]
        while let ampersand = rest.firstIndex(of: "&") {
            result += rest[..<ampersand]
            rest = rest[ampersand...]
            guard let semicolon = rest.prefix(12).firstIndex(of: ";") else {
                result += "&"
                rest = rest.dropFirst()
                continue
            }
            let name = rest[rest.index(after: ampersand)..<semicolon]
            var decoded = named[String(name)]
            if name.hasPrefix("#") {
                let digits = name.dropFirst()
                let hex = digits.first == "x" || digits.first == "X"
                let number = hex ? UInt32(digits.dropFirst(), radix: 16) : UInt32(digits)
                decoded = number.flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            }
            if let decoded {
                result += decoded
                rest = rest[rest.index(after: semicolon)...]
            } else {
                result += "&"
                rest = rest.dropFirst()
            }
        }
        return result + rest
    }

    private static func appendBlocks(_ nodes: [Node], to document: inout NoteDocument) -> Bool {
        var loose: [Node] = []
        func flushLoose(_ document: inout NoteDocument) -> Bool {
            defer { loose = [] }
            guard loose.contains(where: { !$0.isBlank }) else { return true }
            guard let runs = inlineRuns(loose) else { return false }
            document.lines.append(NoteLine(kind: .paragraph, runs: runs))
            return true
        }

        for node in nodes {
            if case .element(let name, _, _) = node, !inlineTags.contains(name) {
                guard flushLoose(&document), appendBlock(node, to: &document) else { return false }
            } else {
                loose.append(node)
            }
        }
        return flushLoose(&document)
    }

    private static func appendBlock(_ node: Node, to document: inout NoteDocument) -> Bool {
        guard case .element(let name, _, let children) = node else { return false }
        switch name {
        case "p":
            guard let runs = inlineRuns(children) else { return false }
            document.lines.append(NoteLine(kind: .paragraph, runs: runs))
            return true
        case "h1", "h2", "h3":
            guard let runs = inlineRuns(children), let level = Int(name.dropFirst()) else { return false }
            document.lines.append(NoteLine(kind: .heading(level), runs: runs))
            return true
        case "hr":
            document.lines.append(NoteLine(kind: .divider))
            return true
        case "pre":
            return appendCode(children, to: &document)
        case "blockquote":
            for child in children where !child.isBlank {
                guard case .element("p", _, let inner) = child, let runs = inlineRuns(inner) else { return false }
                document.lines.append(NoteLine(kind: .quote, runs: runs))
            }
            return true
        case "ul", "ol":
            return appendList(node, path: [], to: &document)
        default:
            return false
        }
    }

    private static func appendCode(_ children: [Node], to document: inout NoteDocument) -> Bool {
        var body = children.filter { !$0.isBlank }
        if body.count == 1, case .element("code", _, let inner) = body[0] { body = inner }
        var text = ""
        for node in body {
            guard case .text(let piece) = node else { return false }
            text += piece
        }
        if text.hasSuffix("\n") { text.removeLast() }
        for line in text.components(separatedBy: "\n") {
            document.lines.append(NoteLine(kind: .code, runs: line.isEmpty ? [] : [NoteRun(text: line)]))
        }
        return true
    }

    private static func appendList(_ node: Node, path: [NoteListKind], to document: inout NoteDocument) -> Bool {
        guard case .element(let name, let attributes, let items) = node else { return false }
        let kind: NoteListKind = name == "ol" ? .ordered : attributes["data-type"] == "taskList" ? .task : .bullet
        let itemPath = path + [kind]

        for item in items where !item.isBlank {
            guard case .element("li", let itemAttributes, var children) = item else { return false }
            var checked = false
            if kind == .task {
                checked = itemAttributes["data-checked"] == "true"
                children = children.filter { node in
                    if case .element("label", _, _) = node { false } else { true }
                }
                if children.filter({ !$0.isBlank }).count == 1, case .element("div", _, let inner)? = children.first(where: { !$0.isBlank }) {
                    children = inner
                }
            }

            // One line of text, then any lists nested under it.
            var firstLine: [Node] = []
            var nested: [Node] = []
            var sawParagraph = false
            for child in children where !child.isBlank {
                guard case .element(let childName, _, let inner) = child else {
                    guard nested.isEmpty else { return false }
                    firstLine.append(child)
                    continue
                }
                if childName == "ul" || childName == "ol" {
                    nested.append(child)
                } else if childName == "p" {
                    guard !sawParagraph, firstLine.isEmpty, nested.isEmpty else { return false }
                    sawParagraph = true
                    firstLine = inner
                } else if inlineTags.contains(childName), !sawParagraph, nested.isEmpty {
                    firstLine.append(child)
                } else {
                    return false
                }
            }
            guard let runs = inlineRuns(firstLine) else { return false }
            document.lines.append(NoteLine(kind: .list(path: itemPath, checked: checked), runs: runs))
            for list in nested {
                guard appendList(list, path: itemPath, to: &document) else { return false }
            }
        }
        return true
    }

    private static func inlineRuns(_ nodes: [Node]) -> [NoteRun]? {
        var runs: [NoteRun] = []
        guard collect(nodes, marks: [], link: nil, into: &runs) else { return nil }
        return runs
    }

    private static func collect(_ nodes: [Node], marks: NoteMarks, link: String?, into runs: inout [NoteRun]) -> Bool {
        for node in nodes {
            switch node {
            case .text(let text):
                append(NoteRun(text: text, marks: marks, link: link), to: &runs)
            case .element(let name, let attributes, let children):
                var inner = marks
                var innerLink = link
                switch name {
                case "br":
                    append(NoteRun(text: lineBreak, marks: marks, link: link), to: &runs)
                    continue
                case "strong", "b": inner.insert(.bold)
                case "em", "i": inner.insert(.italic)
                case "u": inner.insert(.underline)
                case "s": inner.insert(.strike)
                case "code": inner.insert(.code)
                case "span": break
                case "a": innerLink = safeLink(attributes["href"])
                default: return false
                }
                guard collect(children, marks: inner, link: innerLink, into: &runs) else { return false }
            }
        }
        return true
    }

    private static func append(_ run: NoteRun, to runs: inout [NoteRun]) {
        guard !run.text.isEmpty else { return }
        if let last = runs.last, last.marks == run.marks, last.link == run.link {
            runs[runs.count - 1].text += run.text
        } else {
            runs.append(run)
        }
    }

    /// The same schemes the website's server allows.
    static func safeLink(_ href: String?) -> String? {
        guard let href, let scheme = href.split(separator: ":", maxSplits: 1).first?.lowercased(),
            ["http", "https", "mailto", "tel"].contains(scheme), href.contains(":")
        else { return nil }
        return href
    }

    // MARK: Writing

    /// In the shape the website's editor writes. An empty note is an empty string.
    static func serialize(_ document: NoteDocument) -> String {
        guard !document.isEmpty else { return "" }
        var html = ""
        var index = 0
        let lines = document.lines
        while index < lines.count {
            switch lines[index].kind {
            case .paragraph:
                html += "<p>\(inlineHTML(lines[index].runs))</p>"
                index += 1
            case .heading(let level):
                html += "<h\(level)>\(inlineHTML(lines[index].runs))</h\(level)>"
                index += 1
            case .divider:
                html += "<hr>"
                index += 1
            case .quote:
                html += "<blockquote>"
                while index < lines.count, lines[index].kind == .quote {
                    html += "<p>\(inlineHTML(lines[index].runs))</p>"
                    index += 1
                }
                html += "</blockquote>"
            case .code:
                var code: [String] = []
                while index < lines.count, lines[index].kind == .code {
                    code.append(escape(lines[index].text))
                    index += 1
                }
                html += "<pre><code>\(code.joined(separator: "\n"))</code></pre>"
            case .list:
                html += listHTML(lines, index: &index, depth: 0)
            }
        }
        return html
    }

    private static func path(of line: NoteLine) -> [NoteListKind]? {
        if case .list(let path, _) = line.kind { path } else { nil }
    }

    /// One list and everything nested in it, starting at `index`.
    private static func listHTML(_ lines: [NoteLine], index: inout Int, depth: Int) -> String {
        guard let first = path(of: lines[index]), depth < first.count else { return "" }
        let kind = first[depth]
        let prefix = Array(first[...depth])
        var html = kind == .ordered ? "<ol>" : kind == .task ? #"<ul data-type="taskList">"# : "<ul>"

        while index < lines.count, let current = path(of: lines[index]), current.count > depth,
            Array(current[...depth]) == prefix {
            let line = lines[index]
            var body = ""
            var checked = false
            if current.count == depth + 1 {
                if case .list(_, let isChecked) = line.kind { checked = isChecked }
                body = "<p>\(inlineHTML(line.runs))</p>"
                index += 1
            } else {
                // Deeper than its parent, with no item in between.
                body = "<p></p>"
            }
            while index < lines.count, let next = path(of: lines[index]), next.count > depth + 1,
                Array(next[...depth]) == prefix {
                body += listHTML(lines, index: &index, depth: depth + 1)
            }
            if kind == .task {
                let input = checked ? #"<input type="checkbox" checked="checked">"# : #"<input type="checkbox">"#
                html += #"<li data-checked="\#(checked)" data-type="taskItem"><label>\#(input)<span></span></label><div>\#(body)</div></li>"#
            } else {
                html += "<li>\(body)</li>"
            }
        }
        return html + (kind == .ordered ? "</ol>" : "</ul>")
    }

    private static func inlineHTML(_ runs: [NoteRun]) -> String {
        runs.map { run in
            var html = run.text.components(separatedBy: lineBreak).map(escape).joined(separator: "<br>")
            if run.marks.contains(.code) { html = "<code>\(html)</code>" }
            if run.marks.contains(.strike) { html = "<s>\(html)</s>" }
            if run.marks.contains(.underline) { html = "<u>\(html)</u>" }
            if run.marks.contains(.italic) { html = "<em>\(html)</em>" }
            if run.marks.contains(.bold) { html = "<strong>\(html)</strong>" }
            if let link = safeLink(run.link) {
                let href = escape(link).replacingOccurrences(of: "\"", with: "&quot;")
                html = #"<a target="_blank" rel="noopener noreferrer nofollow" href="\#(href)">\#(html)</a>"#
            }
            return html
        }.joined()
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\u{00A0}", with: "&nbsp;")
    }
}
