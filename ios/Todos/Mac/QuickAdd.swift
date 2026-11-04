import AppKit
import Carbon.HIToolbox

// Quick add: ⇧⌘Space from any app floats a small glass field over whatever you're
// doing. Return files what you typed in the Inbox and hands you straight back,
// without bringing the app forward.

final class QuickAddPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// The app isn't frontmost here, so Edit's shortcuts are passed along by hand.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
            let key = event.charactersIgnoringModifiers?.lowercased()
        else { return super.performKeyEquivalent(with: event) }
        let actions: [String: Selector] = [
            "x": #selector(NSText.cut(_:)), "c": #selector(NSText.copy(_:)),
            "v": #selector(NSText.paste(_:)), "a": #selector(NSText.selectAll(_:)),
        ]
        guard let action = actions[key] else { return super.performKeyEquivalent(with: event) }
        return NSApp.sendAction(action, to: nil, from: self)
    }
}

@MainActor
final class QuickAddController: NSObject, NSTextFieldDelegate, NSWindowDelegate {
    private static weak var shared: QuickAddController?
    private let store: TodoStore
    private lazy var panel = makePanel()
    private let field = NSTextField()
    private var hotKey: EventHotKeyRef?

    init(store: TodoStore) {
        self.store = store
        super.init()
        Self.shared = self
    }

    /// Registers ⇧⌘Space system-wide. This kind of shortcut needs no permission.
    @discardableResult
    func registerHotKey() -> OSStatus {
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetEventDispatcherTarget(), { _, _, _ in
            DispatchQueue.main.async { MainActor.assumeIsolated { QuickAddController.shared?.toggle() } }
            return noErr
        }, 1, &type, nil, nil)
        let id = EventHotKeyID(signature: OSType(0x544F_444F), id: 1)  // "TODO"
        return RegisterEventHotKey(
            UInt32(kVK_Space), UInt32(cmdKey | shiftKey), id, GetEventDispatcherTarget(), 0, &hotKey)
    }

    func toggle() {
        panel.isVisible ? close(clearing: false) : show()
    }

    var window: NSWindow { panel }

    private func show() {
        // On whichever screen you're working, a little above the middle.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        if let area = screen?.visibleFrame {
            panel.setFrameOrigin(
                NSPoint(x: area.midX - panel.frame.width / 2, y: area.minY + area.height * 0.68))
        }
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(field)
        if let editor = field.currentEditor() as? NSTextView {
            editor.selectedRange = NSRange(location: field.stringValue.utf16.count, length: 0)
            editor.drawsBackground = false
            editor.insertionPointColor = TodosLook.accent
        }
    }

    private func close(clearing: Bool) {
        if clearing { field.stringValue = "" }
        panel.orderOut(nil)
    }

    private func submit() {
        store.addToInbox(field.stringValue)
        close(clearing: true)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.insertNewline(_:)): submit()
        case #selector(NSResponder.cancelOperation(_:)): close(clearing: true)
        default: return false
        }
        return true
    }

    /// Clicking elsewhere puts it away, keeping the text for next time.
    func windowDidResignKey(_ notification: Notification) {
        if panel.isVisible { close(clearing: false) }
    }

    private func makePanel() -> QuickAddPanel {
        let panel = QuickAddPanel(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 68),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isFloatingPanel = true
        panel.level = .modalPanel
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.delegate = self

        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: TodoView.inbox.symbol, accessibilityDescription: "Inbox")
        icon.symbolConfiguration = .init(pointSize: 22, weight: .regular)
        icon.contentTintColor = TodosLook.color(.inbox)
        icon.setContentHuggingPriority(.required, for: .horizontal)

        field.placeholderString = "Add to Inbox"
        field.font = .systemFont(ofSize: 24)
        field.isBezeled = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.lineBreakMode = .byTruncatingTail
        field.cell?.isScrollable = true
        field.delegate = self

        let row = NSStackView(views: [icon, field])
        row.spacing = 14
        row.alignment = .centerY
        row.edgeInsets = NSEdgeInsets(top: 0, left: 22, bottom: 0, right: 22)

        let glass = NSGlassEffectView()
        glass.cornerRadius = 34
        glass.contentView = row
        panel.contentView = glass
        return panel
    }
}
