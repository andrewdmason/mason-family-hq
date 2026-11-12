import SwiftUI
import UIKit

/// A tutor reply, drawn: Markdown blocks down the screen, math typeset, and
/// visuals drawn natively.
struct MessageContent: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(MessageBlocks.parse(text).enumerated()), id: \.offset) { _, block in
                BlockView(block: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BlockView: View {
    let block: MessageBlock

    var body: some View {
        switch block {
        case .paragraph(let text):
            InlineText(text)
        case .heading(let level, let text):
            InlineText(text, style: level <= 2 ? .title3 : .headline)
                .fontWeight(.semibold)
                .padding(.top, 4)
        case .bullets(let items):
            ListView(items: items, numbered: false)
        case .numbered(let items):
            ListView(items: items, numbered: true)
        case .table(let header, let rows):
            TableView(header: header, rows: rows)
        case .math(let latex):
            DisplayMath(latex: latex)
        case .visual(let json):
            VisualView(json: json)
        case .question(let json):
            QuestionBlockView(json: json)
        case .studySet(let json):
            StudySetBlockView(json: json)
        case .code(let code):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code).font(.callout.monospaced()).padding(12)
            }
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))
        case .rule:
            Divider()
        }
    }
}

private struct ListView: View {
    let items: [MessageBlock.ListItem]
    let numbered: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(marker(item, index))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .frame(minWidth: numbered && item.depth == 0 ? 20 : 12, alignment: .trailing)
                    InlineText(item.text)
                }
                .padding(.leading, CGFloat(item.depth) * 20)
            }
        }
    }

    private func marker(_ item: MessageBlock.ListItem, _ index: Int) -> String {
        if numbered, item.depth == 0 { return "\(item.number ?? index + 1)." }
        return item.depth == 0 ? "•" : "◦"
    }
}

private struct TableView: View {
    let header: [String]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                        InlineText(cell).fontWeight(.semibold).padding(.horizontal, 12).padding(.vertical, 8)
                    }
                }
                .background(.quaternary.opacity(0.6))
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Divider()
                    GridRow {
                        ForEach(0..<header.count, id: \.self) { column in
                            InlineText(column < row.count ? row[column] : "")
                                .padding(.horizontal, 12).padding(.vertical, 8)
                        }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.quaternary))
            .clipShape(.rect(cornerRadius: 12))
        }
    }
}

/// A line of prose with Markdown emphasis and $math$ in it.
struct InlineText: View {
    let text: String
    var style: UIFont.TextStyle = .body
    @Environment(\.colorScheme) private var scheme

    init(_ text: String, style: UIFont.TextStyle = .body) {
        self.text = text
        self.style = style
    }

    var body: some View {
        composed.font(Font(UIFont.preferredFont(forTextStyle: style)))
    }

    private var composed: Text {
        let size = UIFont.preferredFont(forTextStyle: style).pointSize
        var result = Text(verbatim: "")
        for run in InlineRun.split(text) {
            switch run {
            case .text(let prose):
                result = Text("\(result)\(Text(Self.markdown(prose)))")
            case .math(let latex):
                if let math = MathRendering.render(latex, fontSize: size * 1.05, color: .label.resolved(scheme), display: false) {
                    result = Text("\(result)\(Text(Image(uiImage: math.image)).baselineOffset(-math.descent))")
                } else {
                    result = Text("\(result)\(Text(verbatim: latex).font(.body.monospaced()))")
                }
            }
        }
        return result
    }

    static func markdown(_ prose: String) -> AttributedString {
        (try? AttributedString(
            markdown: prose,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
        )) ?? AttributedString(prose)
    }
}
