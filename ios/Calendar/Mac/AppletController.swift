import AppKit
import SwiftUI

/// The menubar item and the applet that drops from it: a panel that takes the
/// keyboard without bringing the app (and its window) forward, so ⌃⌥Space
/// then typing works over whatever's in front.
@MainActor
final class AppletController: NSObject, NSWindowDelegate {
    /// The applet, and the event card that opens beside it.
    static let appletWidth: CGFloat = 348
    static let cardWidth: CGFloat = 372
    static let gap: CGFloat = 10
    /// Room around the glass for its shadow.
    static let margin: CGFloat = 18

    private let model: AppModel
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let panel: AppletPanel
    private var outside: Any?
    private var midnight: NSObjectProtocol?

    init(model: AppModel) {
        self.model = model
        panel = AppletPanel(
            contentRect: NSRect(x: 0, y: 0, width: 100, height: 100),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true
        )
        super.init()

        item.button?.image = Self.icon(day: Day.today().day)
        item.button?.target = self
        item.button?.action = #selector(clicked)
        item.button?.sendAction(on: [.leftMouseDown])
        item.button?.setAccessibilityLabel("Calendar")
        // macOS remembers a hidden menubar item across launches; this one is
        // the app, so it's always there.
        item.isVisible = true
        // A new date on the icon at midnight.
        midnight = NotificationCenter.default.addObserver(forName: .NSCalendarDayChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.item.button?.image = Self.icon(day: Day.today().day) }
        }

        panel.isFloatingPanel = true
        panel.level = .popUpMenu
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary, .transient]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.animationBehavior = .utilityWindow
        panel.delegate = self
        panel.onEscape = { [weak self] in self?.escape() }
        panel.onKey = { [weak self] in self?.key($0) ?? false }
        let host = NSHostingView(rootView: AppletRoot().environment(model))
        panel.contentView = host
    }

    var isOpen: Bool { panel.isVisible }

    @objc private func clicked() { toggle() }

    func toggle() {
        if isOpen { dismiss() } else { show() }
    }

    /// Put it away: the shortcut again, the menubar item, a click elsewhere.
    /// With changes in an open card, the card asks about them instead.
    func dismiss() {
        if model.applet.cardDirty {
            model.applet.leaves += 1
        } else {
            hide()
        }
    }

    func show() {
        place()
        item.button?.highlight(true)
        model.applet.opened += 1
        panel.makeKeyAndOrderFront(nil)
        // A click anywhere else puts it away.
        outside = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            MainActor.assumeIsolated { self?.dismiss() }
        }
        Task { await model.sync() }
    }

    func hide() {
        guard isOpen else { return }
        panel.orderOut(nil)
        item.button?.highlight(false)
        if let outside { NSEvent.removeMonitor(outside) }
        outside = nil
        model.applet.reset()
    }

    /// Escape closes the card first, then the applet.
    private func escape() {
        if model.applet.card != nil {
            model.applet.escapes += 1
        } else {
            hide()
        }
    }

    /// The keys that move the day, taken before the line sees them: ← and →
    /// while nothing's typed (after that they're the line's), ⌘[ and ⌘] at
    /// any time, ⌘T for today. With a card open they're all the card's.
    private func key(_ event: NSEvent) -> Bool {
        let state = model.applet
        guard model.ready, state.card == nil else { return false }
        let held = event.modifierFlags.intersection([.command, .option, .control, .shift])
        switch (event.keyCode, event.charactersIgnoringModifiers?.lowercased(), held) {
        case (123, _, []), (124, _, []):
            // Not while the line is empty only because its words are still being composed.
            if !state.line.isEmpty || (panel.firstResponder as? NSTextView)?.hasMarkedText() == true { return false }
            state.step(event.keyCode == 124 ? 1 : -1)
        case (_, "[", .command): state.step(-1)
        case (_, "]", .command): state.step(1)
        case (_, "t", .command): state.pick(.today())
        default: return false
        }
        return true
    }

    /// Under the menubar item, its right edge near the item's, as tall as the
    /// screen has room for. The panel is always wide enough for the card too;
    /// where nothing's drawn it's clear.
    private func place() {
        guard let button = item.button, let buttonWindow = button.window, let screen = buttonWindow.screen ?? NSScreen.main else { return }
        let anchor = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
        let visible = screen.visibleFrame
        let width = Self.appletWidth + Self.cardWidth + Self.gap + Self.margin * 2
        let height = min(visible.height - 4, 820)
        var right = anchor.midX + Self.appletWidth / 2 + Self.margin
        right = min(right, visible.maxX - 4 + Self.margin)
        right = max(right, visible.minX + width)
        let top = min(anchor.minY, visible.maxY) + Self.margin - 5
        panel.setFrame(NSRect(x: right - width, y: top - height, width: width, height: height), display: true)
    }

    func windowDidResignKey(_ notification: Notification) {
        // A menu or a picker of its own taking the keyboard isn't leaving.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isOpen else { return }
            let key = NSApp.keyWindow
            if key === self.panel || key?.parent === self.panel || self.panel.attachedSheet != nil { return }
            if key == nil, NSApp.isActive { return }
            self.dismiss()
        }
    }

    /// The menubar icon: a calendar leaf with today's date, drawn as a
    /// template so the menubar colours it.
    static func icon(day: Int) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            NSColor.black.set()
            let leaf = NSBezierPath(roundedRect: NSRect(x: 1.75, y: 1.25, width: 14.5, height: 14), xRadius: 3.2, yRadius: 3.2)
            leaf.lineWidth = 1.5
            leaf.stroke()
            // The binding across the top.
            NSBezierPath(rect: NSRect(x: 1.75, y: 11.6, width: 14.5, height: 1.4)).fill()
            let text = NSAttributedString(string: "\(day)", attributes: [
                .font: NSFont.systemFont(ofSize: 8.5, weight: .bold),
                .foregroundColor: NSColor.black,
            ])
            let size = text.size()
            text.draw(at: NSPoint(x: 9 - size.width / 2, y: 6.6 - size.height / 2))
            return true
        }
        image.isTemplate = true
        return image
    }
}

/// A borderless panel that can still be typed in.
final class AppletPanel: NSPanel {
    var onEscape: () -> Void = {}
    /// A key going down; true when it's been dealt with.
    var onKey: (NSEvent) -> Bool = { _ in false }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) {
        onEscape()
    }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown, onKey(event) { return }
        super.sendEvent(event)
    }
}
