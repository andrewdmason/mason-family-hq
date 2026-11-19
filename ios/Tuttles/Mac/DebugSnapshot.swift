#if DEBUG
import AppKit

/// For checking the look without a person at the screen: `--snapshot=<file>`
/// writes a picture of the window to a PNG a few seconds after launch,
/// without coming to the front,
/// (`--snapshot-after=<seconds>`, 3 by default) and quits. Debug builds only.
enum DebugSnapshot {
    static func start() {
        guard let path = Launch.value("snapshot") else { return }
        let delay = Launch.value("snapshot-after").flatMap(Double.init) ?? 3
        // Out of the way of whoever's at the Mac: it never comes to the front
        // or takes the keyboard, and its window sits off the screen.
        NSApp.setActivationPolicy(.accessory)
        let hide = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
            MainActor.assumeIsolated {
                for window in NSApp.windows where window.frame.origin.x > -9000 {
                    window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
                }
            }
        }
        _ = hide
        // `--keys=<text>` types into the window a second in: `\n` is Return,
        // `\N` Shift-Return, `\m` ⌘N, `\v` ⌘V with a picture on a clipboard of its own.
        if let keys = Launch.value("keys") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { type(keys) }
        }
        if CommandLine.arguments.contains("--dark") { NSApp.appearance = NSAppearance(named: .darkAqua) }
        // `--click=<x>,<y>` clicks there (points from the window's top left) two
        // seconds in, to open a sheet; the picture is then of the sheet.
        if let at = Launch.value("click")?.split(separator: ",").compactMap({ Double($0) }), at.count == 2 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { click(CGPoint(x: at[0], y: at[1])) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard let main = NSApp.windows.first(where: { $0.isVisible && $0.frame.height > 100 }),
                  let image = capture(main.attachedSheet ?? main),
                  let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
            else { exit(1) }
            try? png.write(to: URL(fileURLWithPath: path))
            exit(0)
        }
    }

    private static func click(_ point: CGPoint) {
        guard let window = NSApp.windows.first(where: { $0.isVisible && $0.frame.height > 100 }) else { return }
        let location = NSPoint(x: point.x, y: window.frame.height - point.y)
        let events = [NSEvent.EventType.leftMouseDown, .leftMouseUp].compactMap {
            NSEvent.mouseEvent(with: $0, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        }
        guard events.count == 2 else { return }
        // The release waits in line, for a control that follows the mouse itself.
        NSApp.postEvent(events[1], atStart: false)
        NSApp.sendEvent(events[0])
    }

    private static func type(_ keys: String) {
        guard let window = NSApp.windows.first(where: { $0.isVisible && $0.frame.height > 100 }) else { return }
        var at = 0.0
        var escaped = false
        for character in keys {
            if character == "\\", !escaped { escaped = true; continue }
            var text = String(character), flags: NSEvent.ModifierFlags = [], code: UInt16 = 0
            if escaped {
                escaped = false
                switch character {
                case "n": text = "\r"; code = 36
                case "N": text = "\r"; code = 36; flags = .shift
                case "m": text = "n"; code = 45; flags = .command
                case "v":
                    text = "v"; code = 9; flags = .command
                    let board = NSPasteboard(name: .init("io.mason.tuttles.debug"))
                    board.clearContents()
                    let image = NSImage(size: NSSize(width: 300, height: 200), flipped: false) { rect in
                        NSColor.systemTeal.setFill(); rect.fill(); return true
                    }
                    board.setData(image.tiffRepresentation, forType: .tiff)
                    MacChatView.clipboard = board
                default: break
                }
            }
            at += 0.08
            DispatchQueue.main.asyncAfter(deadline: .now() + at) {
                for kind in [NSEvent.EventType.keyDown, .keyUp] {
                    if let event = NSEvent.keyEvent(
                        with: kind, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                        windowNumber: window.windowNumber, context: nil, characters: text,
                        charactersIgnoringModifiers: text, isARepeat: false, keyCode: code) {
                        NSApp.sendEvent(event)
                    }
                }
            }
        }
    }

    /// The window as the screen shows it, glass and all. An app may always
    /// picture its own windows, so this needs no screen recording permission;
    /// the call is no longer in the SDK's headers, so it's looked up by name.
    private static func capture(_ window: NSWindow) -> CGImage? {
        typealias Capture = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") else { return nil }
        let capture = unsafeBitCast(symbol, to: Capture.self)
        // This window only, without its shadow, at the screen's full resolution.
        return capture(.null, 1 << 3, UInt32(window.windowNumber), 1 << 0 | 1 << 3)?.takeRetainedValue()
    }
}
#endif
