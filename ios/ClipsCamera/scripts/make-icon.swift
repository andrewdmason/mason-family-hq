// Draws the app icon (a baseball with a red record dot) at 1024×1024.
// Usage: swift scripts/make-icon.swift <out.png>, then strip the alpha channel
// (the App Store rejects icons with one): sips -s format jpeg → png.
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments[1]
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
let cg = ctx.cgContext

// Night-game background.
let bg = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                    colors: [CGColor(red: 0.10, green: 0.16, blue: 0.24, alpha: 1), CGColor(red: 0.03, green: 0.05, blue: 0.09, alpha: 1)] as CFArray,
                    locations: [0, 1])!
cg.drawLinearGradient(bg, start: CGPoint(x: 0, y: size), end: CGPoint(x: 0, y: 0), options: [])

// The ball.
let center = CGPoint(x: size / 2, y: size / 2 - 10)
let r: CGFloat = 330
cg.setShadow(offset: CGSize(width: 0, height: -18), blur: 40, color: CGColor(gray: 0, alpha: 0.5))
cg.setFillColor(CGColor(red: 0.97, green: 0.96, blue: 0.93, alpha: 1))
cg.fillEllipse(in: CGRect(x: center.x - r, y: center.y - r, width: 2 * r, height: 2 * r))
cg.setShadow(offset: .zero, blur: 0, color: nil)

// Seams: two arcs with stitches.
let red = CGColor(red: 0.85, green: 0.12, blue: 0.14, alpha: 1)
cg.setStrokeColor(red)
cg.setLineCap(.round)
for side in [-1.0, 1.0] {
    let c = CGPoint(x: center.x + CGFloat(side) * r * 1.32, y: center.y)
    let sr = r * 0.95
    let span = 0.62
    let mid = side < 0 ? 0.0 : Double.pi
    cg.setLineWidth(14)
    cg.addArc(center: c, radius: sr, startAngle: mid - span, endAngle: mid + span, clockwise: false)
    cg.strokePath()
    cg.setLineWidth(10)
    for i in 0...10 {
        let a = mid - span + Double(i) * (2 * span / 10)
        let p = CGPoint(x: c.x + sr * cos(a), y: c.y + sr * sin(a))
        let n = CGVector(dx: cos(a), dy: sin(a))
        let t = CGVector(dx: -sin(a), dy: cos(a))
        cg.move(to: CGPoint(x: p.x - n.dx * 26 - t.dx * 12, y: p.y - n.dy * 26 - t.dy * 12))
        cg.addLine(to: CGPoint(x: p.x + n.dx * 26 + t.dx * 12, y: p.y + n.dy * 26 + t.dy * 12))
        cg.strokePath()
    }
}

// Record dot, top-right.
cg.setFillColor(CGColor(red: 1.0, green: 0.23, blue: 0.19, alpha: 1))
cg.setStrokeColor(CGColor(red: 0.03, green: 0.05, blue: 0.09, alpha: 1))
cg.setLineWidth(22)
let dot = CGRect(x: 690, y: 690, width: 190, height: 190)
cg.fillEllipse(in: dot)
cg.strokeEllipse(in: dot)

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
