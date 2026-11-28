#if DEBUG
import AppKit
import SwiftUI

/// A picture of the app's own windows, for looking at a build without the
/// screen (debug builds only): `--snapshot <file.png>` writes one a few
/// seconds after launch and quits; `--backdrop` puts a busy picture behind
/// them first, so glass has something to bend. It opens over whatever's on
/// screen and takes the keyboard: not for when someone's using the Mac.
@MainActor
enum Snapshot {
    private static var backdrop: NSWindow?

    static func arm() {
        let args = CommandLine.arguments
        guard let at = args.firstIndex(of: "--snapshot"), args.count > at + 1 else { return }
        let file = URL(fileURLWithPath: args[at + 1])
        if args.contains("--backdrop") { showBackdrop() }
        var wait = 3.0
        if let at = args.firstIndex(of: "--wait"), args.count > at + 1, let asked = Double(args[at + 1]) { wait = asked }
        var script: [String] = []
        if let at = args.firstIndex(of: "--events"), args.count > at + 1 {
            script = args[at + 1].split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + (script.isEmpty ? wait : 1.5)) {
            Task {
                for step in script { await play(step) }
                if !script.isEmpty { try? await Task.sleep(for: .seconds(wait)) }
                take(to: file)
                exit(0)
            }
        }
    }

    // MARK: Events

    /// The window the script plays to: the calendar's, else the applet's panel.
    private static var target: NSWindow? {
        let windows = NSApp.windows.filter { $0.isVisible && $0 !== backdrop && $0.frame.width > 40 }
        return windows.first { $0.styleMask.contains(.titled) } ?? windows.first { $0 is NSPanel } ?? windows.first
    }

    /// One step of `--events`, a list separated by semicolons. Points are in
    /// the window, from its top left:
    ///   click x,y · double x,y · drag x1,y1 x2,y2 · type words · key return|escape|tab|left|right|cmd+[|cmd+]|cmd+t · wait seconds · quit · reopen · status
    private static func play(_ step: String) async {
        let parts = step.split(separator: " ", maxSplits: 1).map(String.init)
        guard let verb = parts.first else { return }
        let rest = parts.count > 1 ? parts[1] : ""
        // What needs no window.
        switch verb {
        case "wait":
            try? await Task.sleep(for: .seconds(Double(rest) ?? 1))
            return
        case "quit":
            // As ⌘Q does: the app decides whether that's really leaving.
            NSApp.terminate(nil)
            try? await Task.sleep(for: .milliseconds(600))
            return
        case "reopen":
            // As clicking the app in the Dock or Spotlight does.
            _ = NSApp.delegate?.applicationShouldHandleReopen?(NSApp, hasVisibleWindows: false)
            try? await Task.sleep(for: .milliseconds(600))
            return
        case "status":
            let visible = NSApp.windows.filter { $0.isVisible && $0.frame.width > 40 }.map { $0.title.isEmpty ? "(untitled)" : $0.title }
            print("STATUS policy=\(NSApp.activationPolicy() == .regular ? "regular" : "accessory") windows=\(visible)")
            return
        default:
            break
        }
        guard let window = target else { return }
        func point(_ text: Substring) -> NSPoint? {
            let xy = text.split(separator: ",").compactMap { Double($0) }
            return xy.count == 2 ? NSPoint(x: xy[0], y: window.frame.height - xy[1]) : nil
        }
        func mouse(_ type: NSEvent.EventType, _ at: NSPoint, clicks: Int = 1) async {
            if let event = NSEvent.mouseEvent(
                with: type, location: at, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: clicks, pressure: type == .leftMouseUp ? 0 : 1
            ) {
                NSApp.postEvent(event, atStart: false)
            }
            try? await Task.sleep(for: .milliseconds(40))
        }
        func key(_ characters: String, code: UInt16, flags: NSEvent.ModifierFlags = []) async {
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                if let event = NSEvent.keyEvent(
                    with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                    windowNumber: window.windowNumber, context: nil, characters: characters,
                    charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code
                ) {
                    NSApp.postEvent(event, atStart: false)
                }
            }
            try? await Task.sleep(for: .milliseconds(25))
        }
        let points = rest.split(separator: " ").compactMap(point)
        switch verb {
        case "click", "double":
            guard let at = points.first else { return }
            for n in 1...(verb == "double" ? 2 : 1) {
                await mouse(.leftMouseDown, at, clicks: n)
                await mouse(.leftMouseUp, at, clicks: n)
            }
            try? await Task.sleep(for: .milliseconds(400))
        case "drag":
            guard points.count == 2 else { return }
            let (from, to) = (points[0], points[1])
            await mouse(.leftMouseDown, from)
            for n in 1...12 {
                let t = Double(n) / 12
                await mouse(.leftMouseDragged, NSPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
            }
            await mouse(.leftMouseUp, to)
            try? await Task.sleep(for: .milliseconds(400))
        case "type":
            for character in rest { await key(String(character), code: character == " " ? 49 : 0) }
            try? await Task.sleep(for: .milliseconds(300))
        case "key":
            switch rest {
            case "return": await key("\r", code: 36)
            case "escape": await key("\u{1B}", code: 53)
            case "tab": await key("\t", code: 48)
            case "left": await key("\u{F702}", code: 123)
            case "right": await key("\u{F703}", code: 124)
            case "cmd+[": await key("[", code: 33, flags: .command)
            case "cmd+]": await key("]", code: 30, flags: .command)
            case "cmd+t": await key("t", code: 17, flags: .command)
            default: break
            }
            try? await Task.sleep(for: .milliseconds(400))
        default:
            break
        }
    }

    /// `--render-list <file.png>`: the applet's list drawn straight into a
    /// picture, with no window opened. `--now 14:45` for the time of day,
    /// `--day 1` for tomorrow chosen, `--plain` for the list without the time
    /// between, `--earlier` with what's been unfolded, `--open-gaps` with the family's lines opened.
    static func renderList(model: AppModel, to file: URL) {
        let args = CommandLine.arguments
        let store = model.store
        let now = Clock.now()
        var chosen: Day?
        if let at = args.firstIndex(of: "--day"), args.count > at + 1, let by = Int(args[at + 1]) { chosen = Day(now).adding(days: by) }
        let agenda = Agenda.build(
            board: store.board, me: model.me, shown: model.prefs.shown(store.board.members),
            showHidden: false, chosen: chosen, now: now
        )
        let rundown = args.contains("--plain") ? nil : Rundown.build(agenda, board: store.board, me: model.me, now: now)
        let list = AgendaList(
            agenda: agenda, rundown: rundown, now: now, open: { _ in }, report: { _ in }, openID: nil,
            unfolded: args.contains("--earlier"), expanded: args.contains("--open-gaps")
        )
        .padding(.vertical, 8)
        .frame(width: AppletController.appletWidth)
        .background(CalendarStyle.ground)
        .environment(store)
        .environment(model)
        .tint(CalendarStyle.accent)
        let renderer = ImageRenderer(content: list)
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return }
        try? bitmap.representation(using: .png, properties: [:])?.write(to: file)
    }

    /// `--render-trip <name> <folder>`: the trip whose name starts with
    /// `name` drawn straight into pictures, with no window opened: its panel,
    /// the Trips list, its band across its first week and the applet's line
    /// on its second day.
    static func renderTrip(model: AppModel, name: String, to folder: URL) {
        let store = model.store
        guard let view = store.board.trips.first(where: { $0.trip.name.lowercased().hasPrefix(name.lowercased()) }) else { return }
        let trip = view.trip
        func write<V: View>(_ content: V, width: CGFloat, _ file: String) {
            let framed = content
                .frame(width: width)
                .background(CalendarStyle.ground)
                .environment(store)
                .environment(model)
                .tint(CalendarStyle.accent)
            let renderer = ImageRenderer(content: framed)
            renderer.scale = 2
            guard let image = renderer.nsImage, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return }
            try? bitmap.representation(using: .png, properties: [:])?.write(to: folder.appending(path: file))
        }
        write(TripPanel(id: trip.id, scrolls: false), width: 400, "trip-panel.png")
        write(TripsList(), width: 400, "trips-list.png")
        let days = (0..<7).map { trip.start.weekStart().adding(days: $0) }
        let metrics = GridMetrics(width: 1200, days: 7, others: 3, style: .week)
        let week = VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 0) {
                Color.clear.frame(width: MacStyle.gutter, height: 1)
                ForEach(days, id: \.self) { day in
                    Text(TripFormat.day(day)).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                        .padding(.leading, 8)
                        .frame(width: metrics.dayWidth, alignment: .leading)
                }
            }
            TripBands(days: days, metrics: metrics)
        }
        .padding(.vertical, 8)
        write(week, width: 1200, "trip-band.png")
        let second = trip.start.adding(days: 1).at(minutes: 14 * 60 + 10)
        write(AppletTripLine(now: second), width: AppletController.appletWidth, "applet-line.png")
    }

    private static func showBackdrop() {
        guard let screen = NSScreen.main else { return }
        let window = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.level = .normal
        window.contentView = BackdropView(frame: screen.frame)
        window.orderBack(nil)
        backdrop = window
    }

    private static func take(to file: URL) {
        let windows = NSApp.windows.filter { $0.isVisible && $0.frame.width > 40 }
        guard !windows.isEmpty else { return }
        // Back to front, so they sit as they do on screen.
        let ordered = windows.sorted { $0.orderedIndex > $1.orderedIndex }
        var ids = ordered.map { UnsafeRawPointer(bitPattern: UInt($0.windowNumber)) }
        guard let list = CFArrayCreate(nil, &ids, ids.count, nil) else { return }
        let content = windows.filter { $0 !== backdrop }
        var bounds = content.map(\.frame).reduce(content[0].frame) { $0.union($1) }.insetBy(dx: -12, dy: -12)
        // Quartz counts down from the top of the main screen.
        let height = NSScreen.screens.first?.frame.height ?? 0
        bounds.origin.y = height - bounds.maxY
        typealias Capture = @convention(c) (CGRect, CFArray, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImageFromArray") else { return }
        let capture = unsafeBitCast(symbol, to: Capture.self)
        guard let image = capture(bounds, list, 0)?.takeRetainedValue() else { return }
        let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        try? png?.write(to: file)
    }
}

/// Something busy to see through glass: bands of colour and a few words.
private final class BackdropView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        let colours: [NSColor] = [.systemTeal, .systemOrange, .systemPurple, .systemGreen, .systemPink, .systemBlue]
        let band = bounds.width / CGFloat(colours.count * 3)
        for n in 0..<(colours.count * 3) {
            colours[n % colours.count].setFill()
            NSRect(x: CGFloat(n) * band, y: 0, width: band, height: bounds.height).fill()
        }
        let words = NSAttributedString(string: String(repeating: "The quick brown fox jumps over the lazy dog. ", count: 12), attributes: [
            .font: NSFont.systemFont(ofSize: 22, weight: .bold), .foregroundColor: NSColor.white,
        ])
        for row in 0..<40 { words.draw(at: NSPoint(x: -CGFloat(row % 5) * 60, y: bounds.height - CGFloat(row) * 34 - 40)) }
    }
}
#endif
