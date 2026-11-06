import SwiftUI
import WebKit

/// A picture the tutor asked for, as a ```visual block of JSON (the types in
/// src/lib/tuttles/prompt.ts). Drawn natively, in the look the website's
/// parent view uses: inputs in blue, outputs in green, arrows orange, lines and
/// points red.
struct VisualView: View {
    let json: String

    var body: some View {
        Group {
            switch Visual(json: json) {
            case .mapping(let m)?: MappingDiagram(m)
            case .graph(let g)?: GraphView(g)
            case .numberLine(let n)?: NumberLineView(n)
            case .svg(let svg)?: SVGView(svg: svg)
            case nil:
                Label("Couldn't draw this picture.", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(14)
        .background(.background, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(.quaternary))
    }
}

enum VisualColor {
    static let input = Color(red: 0.36, green: 0.50, blue: 0.78)
    static let output = Color(red: 0.31, green: 0.60, blue: 0.49)
    static let arrow = Color(red: 0.81, green: 0.44, blue: 0.18)
    static let line = Color(red: 0.84, green: 0.15, blue: 0.12)
}

// MARK: - The JSON

enum Visual {
    struct Mapping {
        var inputLabel: String, outputLabel: String
        var inputs: [String], outputs: [String]
        var arrows: [(String, String)]
    }
    struct Graph {
        var title: String?
        var xRange: ClosedRange<Double>, yRange: ClosedRange<Double>
        var xLabel: String, yLabel: String
        var points: [(x: Double, y: Double, label: String?)]
        var segments: [((Double, Double), (Double, Double))]
        var functions: [Expression]
        var curves: [[(Double, Double)]]
        var hideNumbers: Bool
    }
    struct NumberLine {
        var min: Double, max: Double
        var points: [(value: Double, open: Bool, label: String?)]
        var intervals: [(Double, Double)]
    }
    struct SVG { var title: String?; var markup: String }

    case mapping(Mapping)
    case graph(Graph)
    case numberLine(NumberLine)
    case svg(SVG)

    init?(json: String) {
        guard let data = json.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        switch o["type"] as? String {
        case "mapping":
            guard let inputs = (o["inputs"] as? [Any])?.map(Self.label),
                  let outputs = (o["outputs"] as? [Any])?.map(Self.label) else { return nil }
            let arrows = (o["arrows"] as? [[Any]] ?? []).compactMap { pair in
                pair.count == 2 ? (Self.label(pair[0]), Self.label(pair[1])) : nil
            }
            self = .mapping(.init(
                inputLabel: o["inputLabel"] as? String ?? "Input", outputLabel: o["outputLabel"] as? String ?? "Output",
                inputs: inputs, outputs: outputs, arrows: arrows))
        case "graph":
            guard let x = Self.range(o["xRange"]), let y = Self.range(o["yRange"]) else { return nil }
            self = .graph(.init(
                title: o["title"] as? String,
                xRange: x, yRange: y,
                xLabel: o["xLabel"] as? String ?? "x", yLabel: o["yLabel"] as? String ?? "y",
                points: (o["points"] as? [[String: Any]] ?? []).compactMap { p in
                    guard let px = Self.number(p["x"]), let py = Self.number(p["y"]) else { return nil }
                    return (px, py, p["label"] as? String)
                },
                segments: (o["segments"] as? [[String: Any]] ?? []).compactMap { s in
                    guard let a = Self.pair(s["from"]), let b = Self.pair(s["to"]) else { return nil }
                    return (a, b)
                },
                functions: (o["functions"] as? [[String: Any]] ?? []).compactMap { ($0["expr"] as? String).flatMap(Expression.parse) },
                curves: (o["curves"] as? [[String: Any]] ?? []).map { c in (c["points"] as? [Any] ?? []).compactMap(Self.pair) },
                hideNumbers: o["hideNumbers"] as? Bool ?? false))
        case "numberline":
            guard let lo = Self.number(o["min"]), let hi = Self.number(o["max"]), hi > lo else { return nil }
            self = .numberLine(.init(
                min: lo, max: hi,
                points: (o["points"] as? [[String: Any]] ?? []).compactMap { p in
                    Self.number(p["value"]).map { ($0, p["open"] as? Bool ?? false, p["label"] as? String) }
                },
                intervals: (o["intervals"] as? [[String: Any]] ?? []).compactMap { iv in
                    guard let a = Self.number(iv["from"]), let b = Self.number(iv["to"]) else { return nil }
                    return (a, b)
                }))
        case "svg":
            guard let markup = o["svg"] as? String, markup.contains("<svg") else { return nil }
            self = .svg(.init(title: o["title"] as? String, markup: markup))
        default:
            return nil
        }
    }

    private static func label(_ v: Any) -> String {
        if let n = v as? NSNumber { return n.doubleValue == n.doubleValue.rounded() ? String(Int(n.doubleValue)) : n.stringValue }
        return "\(v)"
    }
    private static func number(_ v: Any?) -> Double? {
        (v as? NSNumber)?.doubleValue ?? (v as? String).flatMap(Double.init)
    }
    private static func pair(_ v: Any?) -> (Double, Double)? {
        guard let a = v as? [Any], a.count == 2, let x = number(a[0]), let y = number(a[1]) else { return nil }
        return (x, y)
    }
    private static func range(_ v: Any?) -> ClosedRange<Double>? {
        guard let (a, b) = pair(v), b > a else { return nil }
        return a...b
    }
}

// MARK: - Drawings

private struct MappingDiagram: View {
    let m: Visual.Mapping
    init(_ m: Visual.Mapping) { self.m = m }

    var body: some View {
        let rows = max(m.inputs.count, m.outputs.count, 1)
        let height = CGFloat(rows) * 46 + 24
        VStack(spacing: 8) {
            HStack {
                Text(m.inputLabel).frame(maxWidth: .infinity)
                Text(m.outputLabel).frame(maxWidth: .infinity)
            }
            .font(.headline)
            Canvas { context, size in
                let boxWidth = min(110, size.width * 0.3)
                let left = CGRect(x: size.width * 0.25 - boxWidth / 2, y: 0, width: boxWidth, height: size.height)
                let right = CGRect(x: size.width * 0.75 - boxWidth / 2, y: 0, width: boxWidth, height: size.height)
                for (box, color) in [(left, VisualColor.input), (right, VisualColor.output)] {
                    let shape = Path(roundedRect: box, cornerRadius: 22)
                    context.fill(shape, with: .color(color.opacity(0.08)))
                    context.stroke(shape, with: .color(color), lineWidth: 2.5)
                }
                func y(_ i: Int, of n: Int) -> CGFloat { 12 + (size.height - 24) * (CGFloat(i) + 0.5) / CGFloat(n) }
                for (i, value) in m.inputs.enumerated() {
                    context.draw(Text(value).font(.title3), at: CGPoint(x: left.midX - 10, y: y(i, of: m.inputs.count)))
                }
                for (i, value) in m.outputs.enumerated() {
                    context.draw(Text(value).font(.title3), at: CGPoint(x: right.midX + 10, y: y(i, of: m.outputs.count)))
                }
                for (a, b) in m.arrows {
                    guard let i = m.inputs.firstIndex(of: a), let j = m.outputs.firstIndex(of: b) else { continue }
                    let start = CGPoint(x: left.midX + 14, y: y(i, of: m.inputs.count))
                    let end = CGPoint(x: right.midX - 14, y: y(j, of: m.outputs.count))
                    arrow(context, from: start, to: end)
                }
            }
            .frame(height: height)
        }
    }

    private func arrow(_ context: GraphicsContext, from start: CGPoint, to end: CGPoint) {
        var line = Path()
        line.move(to: start)
        line.addLine(to: end)
        context.stroke(line, with: .color(VisualColor.arrow), style: .init(lineWidth: 2.2, lineCap: .round))
        let angle = atan2(end.y - start.y, end.x - start.x)
        var head = Path()
        head.move(to: end)
        head.addLine(to: CGPoint(x: end.x - 12 * cos(angle - 0.4), y: end.y - 12 * sin(angle - 0.4)))
        head.addLine(to: CGPoint(x: end.x - 12 * cos(angle + 0.4), y: end.y - 12 * sin(angle + 0.4)))
        head.closeSubpath()
        context.fill(head, with: .color(VisualColor.arrow))
    }
}

private struct GraphView: View {
    let g: Visual.Graph
    init(_ g: Visual.Graph) { self.g = g }

    var body: some View {
        VStack(spacing: 6) {
            if let title = g.title { Text(title).font(.subheadline.weight(.semibold)) }
            HStack(spacing: 4) {
                Text(g.yLabel)
                    .font(.footnote.weight(.semibold))
                    .fixedSize()
                    .rotationEffect(.degrees(-90))
                    .frame(width: 18)
                Canvas { context, size in draw(context, size) }
                    .aspectRatio(1.15, contentMode: .fit)
            }
            Text(g.xLabel).font(.footnote.weight(.semibold))
        }
    }

    private func draw(_ context: GraphicsContext, _ size: CGSize) {
        let inset: CGFloat = g.hideNumbers ? 6 : 20
        let plot = CGRect(x: inset, y: 6, width: size.width - inset - 6, height: size.height - inset - 6)
        let (x0, x1, y0, y1) = (g.xRange.lowerBound, g.xRange.upperBound, g.yRange.lowerBound, g.yRange.upperBound)
        func X(_ x: Double) -> CGFloat { plot.minX + CGFloat((x - x0) / (x1 - x0)) * plot.width }
        func Y(_ y: Double) -> CGFloat { plot.maxY - CGFloat((y - y0) / (y1 - y0)) * plot.height }
        let step = max(1, ((x1 - x0) / 10).rounded())

        if !g.hideNumbers {
            var grid = Path()
            for x in stride(from: x0.rounded(.up), through: x1, by: 1) {
                grid.move(to: CGPoint(x: X(x), y: plot.minY)); grid.addLine(to: CGPoint(x: X(x), y: plot.maxY))
            }
            for y in stride(from: y0.rounded(.up), through: y1, by: 1) {
                grid.move(to: CGPoint(x: plot.minX, y: Y(y))); grid.addLine(to: CGPoint(x: plot.maxX, y: Y(y)))
            }
            context.stroke(grid, with: .color(.secondary.opacity(0.18)), lineWidth: 1)
        }
        let axisX = (x0...x1).contains(0) ? X(0) : plot.minX
        let axisY = (y0...y1).contains(0) ? Y(0) : plot.maxY
        var axes = Path()
        axes.move(to: CGPoint(x: plot.minX, y: axisY)); axes.addLine(to: CGPoint(x: plot.maxX, y: axisY))
        axes.move(to: CGPoint(x: axisX, y: plot.minY)); axes.addLine(to: CGPoint(x: axisX, y: plot.maxY))
        context.stroke(axes, with: .color(.primary.opacity(0.7)), lineWidth: 1.6)

        if !g.hideNumbers {
            for x in stride(from: x0.rounded(.up), through: x1, by: step) where x != 0 {
                context.draw(Text(Self.tick(x)).font(.caption2).foregroundStyle(.secondary), at: CGPoint(x: X(x), y: axisY + 10))
            }
            for y in stride(from: y0.rounded(.up), through: y1, by: step) where y != 0 {
                context.draw(Text(Self.tick(y)).font(.caption2).foregroundStyle(.secondary), at: CGPoint(x: axisX - 4, y: Y(y)), anchor: .trailing)
            }
        }

        let ink = GraphicsContext.Shading.color(VisualColor.line)
        let stroke = StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round)
        var clipped = context
        clipped.clip(to: Path(plot.insetBy(dx: -2, dy: -2)))
        for f in g.functions {
            var path = Path()
            var drawing = false
            for i in 0...240 {
                let x = x0 + (x1 - x0) * Double(i) / 240
                let y = f.value(at: x)
                guard y.isFinite, y > y0 - (y1 - y0), y < y1 + (y1 - y0) else { drawing = false; continue }
                let p = CGPoint(x: X(x), y: Y(y))
                if drawing { path.addLine(to: p) } else { path.move(to: p) }
                drawing = true
            }
            clipped.stroke(path, with: ink, style: stroke)
        }
        for curve in g.curves where curve.count > 1 {
            var path = Path()
            path.addLines(curve.map { CGPoint(x: X($0.0), y: Y($0.1)) })
            clipped.stroke(path, with: ink, style: stroke)
        }
        for (a, b) in g.segments {
            var path = Path()
            path.move(to: CGPoint(x: X(a.0), y: Y(a.1)))
            path.addLine(to: CGPoint(x: X(b.0), y: Y(b.1)))
            clipped.stroke(path, with: ink, style: stroke)
        }
        for p in g.points {
            let c = CGPoint(x: X(p.x), y: Y(p.y))
            context.fill(Path(ellipseIn: CGRect(x: c.x - 5, y: c.y - 5, width: 10, height: 10)), with: ink)
            if let label = p.label {
                context.draw(Text(label).font(.caption), at: CGPoint(x: c.x + 7, y: c.y - 7), anchor: .bottomLeading)
            }
        }
    }

    static func tick(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }
}

private struct NumberLineView: View {
    let n: Visual.NumberLine
    init(_ n: Visual.NumberLine) { self.n = n }

    var body: some View {
        Canvas { context, size in
            func X(_ v: Double) -> CGFloat { 16 + CGFloat((v - n.min) / (n.max - n.min)) * (size.width - 32) }
            let mid: CGFloat = 26
            var line = Path()
            line.move(to: CGPoint(x: 4, y: mid)); line.addLine(to: CGPoint(x: size.width - 4, y: mid))
            context.stroke(line, with: .color(.primary.opacity(0.7)), lineWidth: 1.6)
            let step = max(1, ((n.max - n.min) / 12).rounded())
            for v in stride(from: n.min.rounded(.up), through: n.max, by: step) {
                var tick = Path()
                tick.move(to: CGPoint(x: X(v), y: mid - 6)); tick.addLine(to: CGPoint(x: X(v), y: mid + 6))
                context.stroke(tick, with: .color(.primary.opacity(0.7)), lineWidth: 1)
                context.draw(Text(GraphView.tick(v)).font(.caption), at: CGPoint(x: X(v), y: mid + 18))
            }
            for (a, b) in n.intervals {
                var band = Path()
                band.move(to: CGPoint(x: X(a), y: mid)); band.addLine(to: CGPoint(x: X(b), y: mid))
                context.stroke(band, with: .color(VisualColor.line), lineWidth: 5)
            }
            for p in n.points {
                let dot = Path(ellipseIn: CGRect(x: X(p.value) - 6, y: mid - 6, width: 12, height: 12))
                context.fill(dot, with: .color(p.open ? Color(uiColor: .systemBackground) : VisualColor.line))
                context.stroke(dot, with: .color(VisualColor.line), lineWidth: 2.5)
            }
        }
        .frame(height: 56)
    }
}

/// Anything the native drawings don't cover, as the SVG the tutor wrote. Shown
/// in a web view that runs no scripts and loads nothing.
private struct SVGView: UIViewRepresentable {
    let svg: Visual.SVG

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let title = svg.title.map { "<div class=t>\($0.replacingOccurrences(of: "<", with: "&lt;"))</div>" } ?? ""
        let csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
        view.loadHTMLString("""
            <meta http-equiv="Content-Security-Policy" content="\(csp)">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{margin:0;font:15px -apple-system;color:#222}@media(prefers-color-scheme:dark){body{color:#eee}}
            .t{font-weight:600;text-align:center;margin-bottom:6px}svg{width:100%;height:auto;max-height:300px}</style>
            \(title)\(svg.markup)
            """, baseURL: nil)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: WKWebView, context: Context) -> CGSize? {
        let width = proposal.width ?? 320
        return CGSize(width: width, height: min(300, width * 0.75) + (svg.title == nil ? 0 : 26))
    }
}
