import SwiftUI

// A question on screen: its words with the math typeset, its figure drawn
// from the bank's little drawing language, and the card it's asked on when
// the teacher has hold of you.

/// A line of a question: plain words, with `$…$` typeset and `\$` a dollar sign.
struct MathText: View {
    let text: String
    var size: CGFloat = 19
    var weight: Font.Weight = .regular
    var color: Color = .primary
    @Environment(\.colorScheme) private var scheme

    init(_ text: String, size: CGFloat = 19, weight: Font.Weight = .regular, color: Color = .primary) {
        self.text = text
        self.size = size
        self.weight = weight
        self.color = color
    }

    enum Run: Equatable {
        case words(String)
        case math(String)
    }

    /// Unlike the tutor's prose, every unescaped dollar here opens or closes math.
    static func split(_ text: String) -> [Run] {
        var runs: [Run] = []
        var current = ""
        var inMath = false
        var escaped = false
        for ch in text {
            if escaped {
                current.append(ch == "$" ? "$" : "\\\(ch)")
                escaped = false
            } else if ch == "\\" {
                escaped = true
            } else if ch == "$" {
                if !current.isEmpty { runs.append(inMath ? .math(current) : .words(current)) }
                current = ""
                inMath.toggle()
            } else {
                current.append(ch)
            }
        }
        if escaped { current.append("\\") }
        if !current.isEmpty { runs.append(inMath ? .math(current) : .words(current)) }
        return runs
    }

    var body: some View {
        composed
            .font(.system(size: size, weight: weight, design: .rounded))
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var composed: Text {
        var result = Text(verbatim: "")
        let ink = PlatformColor(color == .primary ? Color(PlatformColor.ink(scheme)) : color)
        for run in Self.split(text) {
            switch run {
            case .words(let words):
                result = Text("\(result)\(Text(verbatim: words))")
            case .math(let latex):
                if let math = MathRendering.render(latex, fontSize: size * 1.08, color: ink, display: false) {
                    result = Text("\(result)\(Text(Image(platformImage: math.image)).baselineOffset(-math.descent))")
                } else {
                    result = Text("\(result)\(Text(verbatim: latex))")
                }
            }
        }
        return result
    }
}

/// A question's figure.
struct MathDiagramView: View {
    let diagram: MathDiagram
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Canvas { context, size in
            let k = size.width / diagram.w
            let ink = Color.primary
            let light = TuttlesLook.accent.opacity(0.16)
            let accent = TuttlesLook.accent.opacity(0.55)
            func pt(_ p: [Double]?) -> CGPoint { CGPoint(x: (p?.first ?? 0) * k, y: (p?.last ?? 0) * k) }
            func shade(_ name: String?) -> Color? { name == "light" ? light : name == "accent" ? accent : nil }
            func label(_ s: String, at p: CGPoint, size: String? = "m", anchor: UnitPoint = .center, bold: Bool = false) {
                let points: CGFloat = (size == "s" ? 3.6 : size == "l" ? 5.4 : 4.4) * k
                context.draw(Text(s).font(.system(size: max(9, points), weight: bold ? .bold : .medium, design: .rounded)).foregroundStyle(ink), at: p, anchor: anchor)
            }
            let stroke = StrokeStyle(lineWidth: max(1.2, 0.55 * k), lineCap: .round, lineJoin: .round)

            for item in diagram.items {
                switch item.t {
                case "line":
                    var path = Path()
                    let a = pt(item.a), b = pt(item.b)
                    path.move(to: a)
                    path.addLine(to: b)
                    var style = stroke
                    if item.dash == true { style.dash = [1.6 * k, 1.4 * k] }
                    context.stroke(path, with: .color(ink), style: style)
                    func head(at tip: CGPoint, from tail: CGPoint) {
                        let angle = atan2(tip.y - tail.y, tip.x - tail.x)
                        var h = Path()
                        let len = 2.4 * k
                        h.move(to: tip)
                        h.addLine(to: CGPoint(x: tip.x - len * cos(angle - 0.45), y: tip.y - len * sin(angle - 0.45)))
                        h.addLine(to: CGPoint(x: tip.x - len * cos(angle + 0.45), y: tip.y - len * sin(angle + 0.45)))
                        h.closeSubpath()
                        context.fill(h, with: .color(ink))
                    }
                    if item.arrow == "end" || item.arrow == "both" { head(at: b, from: a) }
                    if item.arrow == "both" { head(at: a, from: b) }
                case "poly":
                    guard let pts = item.pts, pts.count > 1 else { continue }
                    var path = Path()
                    path.move(to: pt(pts[0]))
                    for p in pts.dropFirst() { path.addLine(to: pt(p)) }
                    if item.closed != false { path.closeSubpath() }
                    if let fill = shade(item.fill) { context.fill(path, with: .color(fill)) }
                    context.stroke(path, with: .color(ink), style: stroke)
                case "circle":
                    let c = pt(item.c), r = (item.r ?? 0) * k
                    let path = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
                    if let fill = shade(item.fill) { context.fill(path, with: .color(fill)) }
                    context.stroke(path, with: .color(ink), style: stroke)
                case "arc":
                    let c = pt(item.c), r = (item.r ?? 0) * k
                    var path = Path()
                    // Angles are measured the way maths does, and the screen's y runs down.
                    path.addArc(center: c, radius: r, startAngle: .degrees(-(item.from ?? 0)), endAngle: .degrees(-(item.to ?? 0)), clockwise: true)
                    context.stroke(path, with: .color(ink), style: stroke)
                case "rightAngle":
                    let at = pt(item.at), a = pt(item.a), b = pt(item.b)
                    func unit(_ p: CGPoint) -> CGPoint {
                        let dx = p.x - at.x, dy = p.y - at.y
                        let l = max(0.001, sqrt(dx * dx + dy * dy))
                        return CGPoint(x: dx / l, y: dy / l)
                    }
                    let u = unit(a), v = unit(b), s = 3.2 * k
                    var path = Path()
                    path.move(to: CGPoint(x: at.x + u.x * s, y: at.y + u.y * s))
                    path.addLine(to: CGPoint(x: at.x + (u.x + v.x) * s, y: at.y + (u.y + v.y) * s))
                    path.addLine(to: CGPoint(x: at.x + v.x * s, y: at.y + v.y * s))
                    context.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: max(1, 0.4 * k)))
                case "tick":
                    let a = pt(item.a), b = pt(item.b)
                    let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
                    let dx = b.x - a.x, dy = b.y - a.y
                    let l = max(0.001, sqrt(dx * dx + dy * dy))
                    let along = CGPoint(x: dx / l, y: dy / l), across = CGPoint(x: -dy / l, y: dx / l)
                    let n = max(1, item.n ?? 1)
                    for i in 0..<n {
                        let off = (CGFloat(i) - CGFloat(n - 1) / 2) * 1.2 * k
                        var path = Path()
                        path.move(to: CGPoint(x: mid.x + along.x * off - across.x * 1.6 * k, y: mid.y + along.y * off - across.y * 1.6 * k))
                        path.addLine(to: CGPoint(x: mid.x + along.x * off + across.x * 1.6 * k, y: mid.y + along.y * off + across.y * 1.6 * k))
                        context.stroke(path, with: .color(ink), style: stroke)
                    }
                case "dot":
                    let c = pt(item.at), r = 1.0 * k
                    context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(ink))
                case "text":
                    let anchor: UnitPoint = item.anchor == "l" ? .leading : item.anchor == "r" ? .trailing : .center
                    label(item.s ?? "", at: pt(item.at), size: item.size, anchor: anchor)
                case "numberLine":
                    let y = (item.y ?? 30) * k, x0 = (item.x0 ?? 10) * k, x1 = (item.x1 ?? 90) * k
                    let lo = item.min ?? 0, hi = item.max ?? 10, step = max(0.0001, item.step ?? 1)
                    func x(_ v: Double) -> CGFloat { x0 + (x1 - x0) * (v - lo) / max(0.0001, hi - lo) }
                    var path = Path()
                    path.move(to: CGPoint(x: x0 - 3 * k, y: y))
                    path.addLine(to: CGPoint(x: x1 + 3 * k, y: y))
                    context.stroke(path, with: .color(ink), style: stroke)
                    let count = Int(((hi - lo) / step).rounded())
                    for i in 0...max(0, min(count, 60)) {
                        let v = lo + Double(i) * step
                        var tick = Path()
                        tick.move(to: CGPoint(x: x(v), y: y - 1.8 * k))
                        tick.addLine(to: CGPoint(x: x(v), y: y + 1.8 * k))
                        context.stroke(tick, with: .color(ink), style: stroke)
                        let show: Bool
                        switch item.labels {
                        case .word(let w): show = w == "all" || (w == "ends" && (i == 0 || i == count))
                        case .numbers(let ns): show = ns.contains { abs($0 - v) < step / 100 }
                        default: show = true
                        }
                        if show { label(Self.number(v), at: CGPoint(x: x(v), y: y + 6 * k), size: "s") }
                    }
                    for p in item.points ?? [] {
                        guard let v = p.v else { continue }
                        let r = 1.3 * k
                        context.fill(Path(ellipseIn: CGRect(x: x(v) - r, y: y - r, width: r * 2, height: r * 2)), with: .color(TuttlesLook.accent))
                        if let name = p.label { label(name, at: CGPoint(x: x(v), y: y - 6 * k), size: "m", bold: true) }
                    }
                case "bars":
                    let ox = (item.x ?? 10) * k, oy = (item.y ?? 5) * k, w = (item.w ?? 80) * k, h = (item.h ?? 50) * k
                    let values = item.values ?? []
                    let top = max(0.0001, item.max ?? (values.max() ?? 1)), step = max(0.0001, item.step ?? top / 5)
                    var names: [String] = []
                    if case .names(let n) = item.labels { names = n }
                    if let title = item.title { label(title, at: CGPoint(x: ox + w / 2, y: oy - 3.2 * k), size: "s", bold: true) }
                    var lines = Path()
                    var v = 0.0
                    while v <= top + step / 100 {
                        let y = oy + h - h * v / top
                        lines.move(to: CGPoint(x: ox, y: y))
                        lines.addLine(to: CGPoint(x: ox + w, y: y))
                        label(Self.number(v), at: CGPoint(x: ox - 1.5 * k, y: y), size: "s", anchor: .trailing)
                        v += step
                    }
                    context.stroke(lines, with: .color(ink.opacity(0.22)), lineWidth: 1)
                    let slot = w / CGFloat(max(1, values.count))
                    for (i, value) in values.enumerated() {
                        let bh = h * value / top
                        let rect = CGRect(x: ox + slot * CGFloat(i) + slot * 0.2, y: oy + h - bh, width: slot * 0.6, height: bh)
                        context.fill(Path(rect), with: .color(TuttlesLook.accent.opacity(0.75)))
                        context.stroke(Path(rect), with: .color(ink), lineWidth: 1)
                        if i < names.count { label(names[i], at: CGPoint(x: rect.midX, y: oy + h + 3.4 * k), size: "s") }
                    }
                    var axes = Path()
                    axes.move(to: CGPoint(x: ox, y: oy))
                    axes.addLine(to: CGPoint(x: ox, y: oy + h))
                    axes.addLine(to: CGPoint(x: ox + w, y: oy + h))
                    context.stroke(axes, with: .color(ink), style: stroke)
                case "table":
                    let ox = (item.x ?? 10) * k, oy = (item.y ?? 5) * k, w = (item.w ?? 80) * k
                    let cols = item.cols ?? [], rows = item.rows ?? []
                    let rowH = 7.5 * k, colW = w / CGFloat(max(1, cols.count))
                    context.fill(Path(CGRect(x: ox, y: oy, width: w, height: rowH)), with: .color(light))
                    for (c, name) in cols.enumerated() { label(name, at: CGPoint(x: ox + colW * (CGFloat(c) + 0.5), y: oy + rowH / 2), size: "s", bold: true) }
                    for (r, row) in rows.enumerated() {
                        for (c, cell) in row.enumerated() where c < cols.count {
                            label(cell, at: CGPoint(x: ox + colW * (CGFloat(c) + 0.5), y: oy + rowH * (CGFloat(r) + 1.5)), size: "s")
                        }
                    }
                    var grid = Path()
                    for r in 0...(rows.count + 1) {
                        grid.move(to: CGPoint(x: ox, y: oy + rowH * CGFloat(r)))
                        grid.addLine(to: CGPoint(x: ox + w, y: oy + rowH * CGFloat(r)))
                    }
                    for c in 0...cols.count {
                        grid.move(to: CGPoint(x: ox + colW * CGFloat(c), y: oy))
                        grid.addLine(to: CGPoint(x: ox + colW * CGFloat(c), y: oy + rowH * CGFloat(rows.count + 1)))
                    }
                    context.stroke(grid, with: .color(ink), lineWidth: 1)
                case "grid":
                    let ox = (item.x ?? 10) * k, oy = (item.y ?? 5) * k, w = (item.w ?? 60) * k, h = (item.h ?? 50) * k
                    let x0 = item.xmin ?? 0, x1 = item.xmax ?? 10, y0 = item.ymin ?? 0, y1 = item.ymax ?? 10
                    func gx(_ v: Double) -> CGFloat { ox + w * (v - x0) / max(0.0001, x1 - x0) }
                    func gy(_ v: Double) -> CGFloat { oy + h - h * (v - y0) / max(0.0001, y1 - y0) }
                    var lines = Path()
                    for v in stride(from: x0.rounded(.up), through: x1, by: 1) {
                        lines.move(to: CGPoint(x: gx(v), y: oy)); lines.addLine(to: CGPoint(x: gx(v), y: oy + h))
                        if v != 0 || x0 == 0 { label(Self.number(v), at: CGPoint(x: gx(v), y: gy(max(y0, min(y1, 0))) + 3 * k), size: "s") }
                    }
                    for v in stride(from: y0.rounded(.up), through: y1, by: 1) {
                        lines.move(to: CGPoint(x: ox, y: gy(v))); lines.addLine(to: CGPoint(x: ox + w, y: gy(v)))
                        if v != 0 { label(Self.number(v), at: CGPoint(x: gx(max(x0, min(x1, 0))) - 2.6 * k, y: gy(v)), size: "s") }
                    }
                    context.stroke(lines, with: .color(ink.opacity(0.2)), lineWidth: 1)
                    var axes = Path()
                    let ax = gx(max(x0, min(x1, 0))), ay = gy(max(y0, min(y1, 0)))
                    axes.move(to: CGPoint(x: ox, y: ay)); axes.addLine(to: CGPoint(x: ox + w, y: ay))
                    axes.move(to: CGPoint(x: ax, y: oy)); axes.addLine(to: CGPoint(x: ax, y: oy + h))
                    context.stroke(axes, with: .color(ink), style: stroke)
                    for seg in item.segments ?? [] where seg.count == 2 {
                        var path = Path()
                        path.move(to: CGPoint(x: gx(seg[0].first ?? 0), y: gy(seg[0].last ?? 0)))
                        path.addLine(to: CGPoint(x: gx(seg[1].first ?? 0), y: gy(seg[1].last ?? 0)))
                        context.stroke(path, with: .color(TuttlesLook.accent), style: stroke)
                    }
                    for p in item.points ?? [] {
                        guard let at = p.p, at.count == 2 else { continue }
                        let c = CGPoint(x: gx(at[0]), y: gy(at[1])), r = 1.3 * k
                        context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(TuttlesLook.accent))
                        if let name = p.label { label(name, at: CGPoint(x: c.x + 2.6 * k, y: c.y - 3 * k), size: "m", bold: true) }
                    }
                case "pie":
                    let c = pt(item.c), r = (item.r ?? 20) * k
                    let slices = item.slices ?? []
                    let total = max(0.0001, slices.reduce(0) { $0 + $1.v })
                    var start = -90.0
                    for slice in slices {
                        let sweep = 360 * slice.v / total
                        var path = Path()
                        path.move(to: c)
                        path.addArc(center: c, radius: r, startAngle: .degrees(start), endAngle: .degrees(start + sweep), clockwise: false)
                        path.closeSubpath()
                        let tone = [0.1, 0.32, 0.55, 0.8][min(3, max(0, slice.shade ?? 0))]
                        context.fill(path, with: .color(TuttlesLook.accent.opacity(tone)))
                        context.stroke(path, with: .color(ink), lineWidth: 1)
                        if let name = slice.label {
                            let mid = (start + sweep / 2) * .pi / 180
                            label(name, at: CGPoint(x: c.x + cos(mid) * r * 1.28, y: c.y + sin(mid) * r * 1.28), size: "s")
                        }
                        start += sweep
                    }
                default:
                    break
                }
            }
        }
        .aspectRatio(diagram.w / max(1, diagram.h), contentMode: .fit)
        .accessibilityLabel("Figure")
    }

    private static func number(_ v: Double) -> String {
        abs(v - v.rounded()) < 0.0001 ? String(Int(v.rounded())) : String(format: "%g", (v * 100).rounded() / 100)
    }
}

/// The question itself, laid out: words, figure, and the two columns of a comparison.
struct MathQuestionBody: View {
    let question: MathQuestion
    var size: CGFloat = 20

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !question.prompt.isEmpty { MathText(question.prompt, size: size, weight: .medium) }
            if let diagram = question.diagram {
                MathDiagramView(diagram: diagram)
                    .frame(maxWidth: .infinity)
                    .frame(maxHeight: 190)
            }
            if question.type == "comparison" {
                HStack(alignment: .top, spacing: 10) {
                    column("Column A", question.columnA ?? "")
                    column("Column B", question.columnB ?? "")
                }
            }
        }
    }

    private func column(_ title: String, _ text: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.caption.weight(.bold)).foregroundStyle(.secondary)
            MathText(text, size: size, weight: .semibold)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 14))
    }
}

/// Caught: one question, against the clock.
struct MathQuestionCard: View {
    let question: MathQuestion
    let line: String
    let deadline: Date
    let total: TimeInterval
    /// What was chosen, once it has been (nil inside is the clock running out).
    let chosen: Int??
    let paid: Int
    let choose: (Int?) -> Void
    @State private var height: CGFloat = 60

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 10) {
                    Text("“\(line)”")
                        .font(.system(.subheadline, design: .serif).italic())
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                TimelineView(.periodic(from: .now, by: 0.1)) { timeline in
                    let left = chosen == nil ? max(0, deadline.timeIntervalSince(timeline.date)) : 0
                    MathClockBar(left: left, total: total, stopped: chosen != nil)
                }
                .frame(height: 26)
                // As tall as the question, up to a point; a long one scrolls.
                ScrollView {
                    MathQuestionBody(question: question)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(height: min(max(height, 30), 340))
                VStack(spacing: 9) {
                    ForEach(0..<question.choices.count, id: \.self) { i in
                        Button { choose(i) } label: { choice(i) }
                            .buttonStyle(.plain)
                            .disabled(chosen != nil)
                    }
                }
            }
            .padding(18)
            .background(.regularMaterial, in: .rect(cornerRadius: 28))
            .overlay(alignment: .top) {
                if let chosen, chosen == question.answer, paid > 0 {
                    Text("+\(paid) ★")
                        .font(.system(size: 30, weight: .black, design: .rounded))
                        .foregroundStyle(.yellow)
                        .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                        .offset(y: -44)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 14)
        }
        .animation(.snappy(duration: 0.25), value: chosen != nil)
    }

    private func choice(_ i: Int) -> some View {
        let done = chosen != nil
        let picked = chosen.flatMap { $0 } == i
        let right = i == question.answer
        let tint: Color = !done ? Color.primary.opacity(0.07) : right ? .green.opacity(0.32) : picked ? .red.opacity(0.3) : Color.primary.opacity(0.04)
        return HStack(spacing: 12) {
            Text(["A", "B", "C", "D"][i])
                .font(.system(.subheadline, design: .rounded).weight(.heavy))
                .frame(width: 28, height: 28)
                .background(done && right ? Color.green : done && picked ? Color.red : TuttlesLook.accent, in: .circle)
                .foregroundStyle(.white)
            MathText(question.choices[i], size: question.type == "comparison" ? 15 : 18, weight: .semibold)
                .frame(maxWidth: .infinity, alignment: .leading)
            if done, right { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
            if done, picked, !right { Image(systemName: "xmark.circle.fill").foregroundStyle(.red) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, minHeight: 50)
        .background(tint, in: .rect(cornerRadius: 16))
        .contentShape(.rect)
        .opacity(done && !right && !picked ? 0.55 : 1)
    }
}

/// The clock on a question: a bar running down, red and counting for the last ten seconds.
struct MathClockBar: View {
    let left: TimeInterval
    let total: TimeInterval
    let stopped: Bool

    var body: some View {
        let urgent = left <= 10 && !stopped
        HStack(spacing: 10) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.1))
                    Capsule()
                        .fill(urgent ? Color.red : left <= 20 && !stopped ? Color.orange : Color.green)
                        .frame(width: max(8, geo.size.width * left / max(1, total)))
                }
            }
            .frame(height: 10)
            Text(stopped ? " " : "\(Int(left.rounded(.up)))")
                .font(.system(.title3, design: .rounded).weight(.heavy).monospacedDigit())
                .foregroundStyle(urgent ? .red : .primary)
                .frame(width: 40, alignment: .trailing)
                .scaleEffect(urgent ? 1.15 : 1)
                .animation(.snappy(duration: 0.15), value: Int(left))
        }
    }
}
