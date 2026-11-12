import AppKit

// Focus mode: one Today to-do at a time on an empty field, as on the website
// (src/components/todos/focus-mode.tsx). Today's list is where the day is
// planned; this is where it's worked. Finish it, sharpen its name or notes, or
// admit it isn't happening today. There's no skip: every way forward takes the
// to-do out of Today. The rules live in TodoStore's Focus section and the keys
// in KeyRouter; this is only the screen.

@MainActor
final class FocusView: NSView, NSTextFieldDelegate {
    private enum Metrics {
        static let column: CGFloat = 620
        static let circle: CGFloat = 28
        static let textX: CGFloat = 44
        static let titleHeight: CGFloat = 34
        static let gap: CGFloat = 14
        static let noteStyle = NoteStyle(size: 15, accent: TodosLook.accent, indent: 22)
    }

    private let store: TodoStore
    private let scroll = NSScrollView()
    private let column = FlippedView()
    private let doneLabel = NSTextField(labelWithString: "")
    private let project = NSTextField(labelWithString: "")
    private let circle = TickView()
    private let title = FocusTitleField()
    private let snooze = NSButton()
    private let notes = DetailNotesView.make(style: Metrics.noteStyle)
    private let placeholder = NSTextField(labelWithString: "Notes")
    private let strip = AttachmentStripView()
    private let clear = NSTextField(labelWithString: "Today's clear")
    private let clearDetail = NSTextField(labelWithString: "")
    private let toast = FocusToast()

    private var shown: Todo?
    private var notesHTML = ""
    private var items: [AttachmentItem] = []
    private var toastTimer: Timer?
    /// The name's row, where the moon shows while the pointer's over it.
    private var titleHover: NSTrackingArea?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(store: TodoStore) {
        self.store = store
        super.init(frame: .zero)

        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.automaticallyAdjustsContentInsets = false
        scroll.documentView = column
        addSubview(scroll)

        doneLabel.font = .systemFont(ofSize: 12, weight: .medium)
        doneLabel.textColor = .secondaryLabelColor
        doneLabel.alignment = .center
        addSubview(doneLabel)

        project.font = .systemFont(ofSize: 13)
        project.textColor = .secondaryLabelColor
        project.lineBreakMode = .byTruncatingTail
        column.addSubview(project)

        circle.symbolConfiguration = .init(pointSize: 22, weight: .light)
        circle.contentTintColor = .tertiaryLabelColor
        circle.toolTip = "Complete (E)"
        circle.onClick = { [weak self] in self?.tick() }
        column.addSubview(circle)

        title.font = .systemFont(ofSize: 24, weight: .semibold)
        title.isBezeled = false
        title.drawsBackground = false
        title.focusRingType = .none
        title.isEditable = true
        title.lineBreakMode = .byTruncatingTail
        title.cell?.isScrollable = true
        title.delegate = self
        column.addSubview(title)

        snooze.image = NSImage(systemSymbolName: "moon", accessibilityDescription: "Not today")
        snooze.symbolConfiguration = .init(pointSize: 15, weight: .regular)
        snooze.isBordered = false
        snooze.contentTintColor = .secondaryLabelColor
        snooze.toolTip = "Not today: snooze or move (S snoozes until tomorrow)"
        snooze.target = self
        snooze.action = #selector(showWhenMenu)
        snooze.alphaValue = 0
        column.addSubview(snooze)

        notes.onChange = { [weak self] html in self?.notesChanged(html) }
        notes.onTabOut = { [weak self] in self?.focusTitle() }
        column.addSubview(notes)
        placeholder.font = .systemFont(ofSize: 15)
        placeholder.textColor = .tertiaryLabelColor
        column.addSubview(placeholder)
        column.addSubview(strip)

        clear.font = .systemFont(ofSize: 24, weight: .semibold)
        clear.textColor = .secondaryLabelColor
        clear.alignment = .center
        column.addSubview(clear)
        clearDetail.font = .systemFont(ofSize: 13)
        clearDetail.textColor = .tertiaryLabelColor
        clearDetail.alignment = .center
        column.addSubview(clearDetail)

        toast.isHidden = true
        toast.onUndo = { [weak self] in
            self?.hideToast()
            self?.store.focusUndo()
        }
        addSubview(toast)

        follow()
    }

    required init?(coder: NSCoder) { fatalError() }

    // Keys reach KeyRouter first; anything it lets through stops here, quietly.
    override func keyDown(with event: NSEvent) {}

    override func mouseDown(with event: NSEvent) {
        // A click on the empty field leaves the name or notes, keeping what was typed.
        window?.makeFirstResponder(self)
        store.commitFocusEdit()
    }

    func takeKeys() {
        window?.makeFirstResponder(self)
    }

    func focusTitle() {
        window?.makeFirstResponder(title)
        guard let editor = title.currentEditor() as? NSTextView else { return }
        editor.selectedRange = NSRange(location: (title.stringValue as NSString).length, length: 0)
        editor.drawsBackground = false
        editor.insertionPointColor = TodosLook.accent
    }

    // MARK: Following the store

    private func follow() {
        let (task, done, attachments, focusing) = withObservationTracking {
            let task = store.focusTask
            return (task, store.focusDone, task.map { store.attachments.items(for: $0.id) } ?? [], store.focusing)
        } onChange: { [weak self] in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.follow() } }
        }
        guard focusing else {
            // Ready for next time: the first card shows fresh.
            shown = nil
            hideToast()
            return
        }
        // Progress counts up rather than down, and hides at zero, as on the website.
        doneLabel.stringValue = done > 0 ? "\(done) done" : ""
        if task?.id != shown?.id {
            if let left = shown { announce(leaving: left) }
            show(task, done: done)
        } else if let task {
            refresh(task)
        } else {
            clearDetail.stringValue = done > 0 ? "\(done) done. Nice work." : "Nothing left in Today."
        }
        if attachments != items {
            items = attachments
            strip.show(attachments, store: store.attachments)
            needsLayout = true
        }
    }

    private func show(_ task: Todo?, done: Int) {
        let hadOne = shown != nil
        shown = task
        let showing = task != nil
        for view: NSView in [project, circle, title, snooze, notes, placeholder, strip] { view.isHidden = !showing }
        clear.isHidden = showing
        clearDetail.isHidden = showing
        // Leaving a field that's about to show another to-do.
        if window?.firstResponder is NSText { window?.makeFirstResponder(self) }
        if let task {
            project.stringValue = task.projectId.flatMap { id in store.projects.first { $0.id == id }?.name } ?? ""
            title.stringValue = task.title
            notesHTML = task.notes ?? ""
            notes.show(html: notesHTML)
            placeholder.isHidden = !notes.string.isEmpty
            items = store.attachments.items(for: task.id)
            strip.show(items, store: store.attachments)
            let id = task.id
            let attachments = store.attachments
            notes.onPasteFiles = { board in AttachmentPasteboard.attach(from: board, to: id, in: attachments) }
            circle.image = NSImage(systemSymbolName: "circle", accessibilityDescription: "Not done")
            circle.contentTintColor = .tertiaryLabelColor
        } else {
            clearDetail.stringValue = done > 0 ? "\(done) done. Nice work." : "Nothing left in Today."
        }
        needsLayout = true
        layoutSubtreeIfNeeded()
        if hadOne { fadeIn() }
    }

    /// The same to-do, changed: by sync, or by its own edit being saved. What's
    /// being typed stays as it is.
    private func refresh(_ task: Todo) {
        shown = task
        let editingTitle = title.currentEditor() != nil
        let editingNotes = window?.firstResponder === notes
        if !editingTitle, store.focusDraft == nil, title.stringValue != task.title { title.stringValue = task.title }
        if !editingNotes, store.focusDraft == nil, notesHTML != (task.notes ?? "") {
            notesHTML = task.notes ?? ""
            notes.show(html: notesHTML)
            placeholder.isHidden = !notes.string.isEmpty
            needsLayout = true
        }
        project.stringValue = task.projectId.flatMap { id in store.projects.first { $0.id == id }?.name } ?? ""
    }

    private func fadeIn() {
        column.alphaValue = 0
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            column.animator().alphaValue = 1
        }
    }

    // MARK: Editing

    func controlTextDidChange(_ notification: Notification) {
        saveDraft()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            // Return finishes the name; the next key is a shortcut again.
            window?.makeFirstResponder(self)
            store.commitFocusEdit()
            return true
        case #selector(NSResponder.insertTab(_:)), #selector(NSResponder.moveDown(_:)):
            window?.makeFirstResponder(notes)
            if selector == #selector(NSResponder.moveDown(_:)) { notes.moveCaretToStart() }
            return true
        default:
            return false
        }
    }

    private func notesChanged(_ html: String) {
        notesHTML = html
        placeholder.isHidden = !notes.string.isEmpty
        saveDraft()
        needsLayout = true
    }

    private func saveDraft() {
        guard let shown else { return }
        store.focusDraft = (shown.id, title.stringValue, notesHTML)
    }

    private func tick() {
        circle.setSymbolImage(
            NSImage(systemSymbolName: "checkmark.circle.fill", accessibilityDescription: "Done") ?? NSImage(),
            contentTransition: .replace)
        circle.contentTintColor = TodosLook.accent
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) { [weak self] in
            self?.store.focusComplete()
        }
    }

    // MARK: Not today

    @objc private func showWhenMenu() {
        let menu = NSMenu()
        let store = store
        let add = { (title: String, action: @escaping @MainActor () -> Void) in
            menu.addItem(ClosureMenuItem(title: title, action: action))
        }
        menu.addItem(.sectionHeader(title: "Snooze Until"))
        add("Tomorrow") { store.focusSnooze(until: TodoStore.tomorrow()) }
        add("This Weekend") { store.focusSnooze(until: TodoStore.thisWeekend()) }
        add("Next Week") { store.focusSnooze(until: TodoStore.startOfNextWeek()) }
        menu.addItem(.sectionHeader(title: "Move To"))
        for (title, key, bucket) in [("This Week", "e", Bucket.week), ("Anytime", "r", .anytime), ("Someday", "o", .someday)] {
            let item = ClosureMenuItem(title: title) { store.focusMove(to: bucket) }
            item.keyEquivalent = key
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: snooze.bounds.maxY + 4), in: snooze)
    }

    // MARK: Undo toast

    /// Says what just happened to the to-do that left the card, with an Undo.
    private func announce(leaving old: Todo) {
        guard let now = store.todos.first(where: { $0.id == old.id }) else { return }
        let name = "“\(now.title)”"
        let message: String
        if now.completedAt != nil {
            message = "Completed \(name)"
        } else if now.snoozedUntil != nil {
            message = "Snoozed \(name)"
        } else if now.bucket != .today {
            message = "Moved \(name) to \(TodoView(rawValue: now.bucket.rawValue)?.label ?? now.bucket.rawValue.capitalized)"
        } else {
            return  // Left some other way (reassigned, say): nothing of ours to undo.
        }
        toast.show(message)
        toast.isHidden = false
        needsLayout = true
        toastTimer?.invalidate()
        toastTimer = Timer.scheduledTimer(withTimeInterval: 6, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.hideToast() }
        }
    }

    private func hideToast() {
        toastTimer?.invalidate()
        toastTimer = nil
        toast.isHidden = true
    }

    // MARK: Hover

    private func trackTitleRow(_ row: NSRect) {
        if let titleHover {
            guard titleHover.rect != row else { return }
            column.removeTrackingArea(titleHover)
        }
        let area = NSTrackingArea(rect: row, options: [.mouseEnteredAndExited, .activeInKeyWindow], owner: self)
        column.addTrackingArea(area)
        titleHover = area
        if let window {
            let pointer = column.convert(window.mouseLocationOutsideOfEventStream, from: nil)
            showSnooze(row.contains(pointer))
        }
    }

    override func mouseEntered(with event: NSEvent) {
        if event.trackingArea === titleHover { showSnooze(true) }
    }

    override func mouseExited(with event: NSEvent) {
        if event.trackingArea === titleHover { showSnooze(false) }
    }

    private func showSnooze(_ visible: Bool) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            snooze.animator().alphaValue = visible ? 1 : 0
        }
    }

    // MARK: Layout

    override func layout() {
        super.layout()
        scroll.frame = bounds
        let top = safeAreaInsets.top
        doneLabel.frame = NSRect(x: 0, y: top + 8, width: bounds.width, height: 16)

        let width = min(Metrics.column, bounds.width - 96)
        let x = (bounds.width - width) / 2
        let textWidth = width - Metrics.textX - 36
        notes.frame.size.width = textWidth
        let notesHeight = max(notes.usedTextHeight, 20)
        let stripHeight = items.isEmpty ? 0 : AttachmentStripView.arrange(items, width: textWidth).height
        let projectHeight: CGFloat = project.stringValue.isEmpty ? 0 : 18 + 8
        let content = shown == nil
            ? 64
            : projectHeight + Metrics.titleHeight + Metrics.gap + notesHeight + (stripHeight > 0 ? Metrics.gap + stripHeight : 0)
        let visible = bounds.height
        // A little above the middle, where the eye lands; long notes scroll.
        let y0 = max(top + 48, (visible - content) / 2 - 24)
        column.frame = NSRect(x: 0, y: 0, width: bounds.width, height: max(visible, y0 + content + 80))

        var y = y0
        if shown == nil {
            clear.frame = NSRect(x: x, y: y, width: width, height: 32)
            clearDetail.frame = NSRect(x: x, y: y + 38, width: width, height: 18)
        } else {
            if projectHeight > 0 {
                project.frame = NSRect(x: x + Metrics.textX, y: y, width: textWidth, height: 18)
                y += projectHeight
            }
            circle.frame = NSRect(x: x, y: y + 2, width: Metrics.circle + 4, height: Metrics.circle + 4)
            title.frame = NSRect(x: x + Metrics.textX - 2, y: y, width: textWidth + 2, height: Metrics.titleHeight)
            snooze.frame = NSRect(x: x + width - 28, y: y + 4, width: 28, height: 26)
            trackTitleRow(NSRect(x: x, y: y, width: width, height: Metrics.titleHeight))
            y += Metrics.titleHeight + Metrics.gap
            notes.frame = NSRect(x: x + Metrics.textX, y: y, width: textWidth, height: notesHeight)
            placeholder.frame = NSRect(x: x + Metrics.textX, y: y, width: textWidth, height: 20)
            y += notesHeight
            if stripHeight > 0 {
                y += Metrics.gap
                strip.frame = NSRect(x: x + Metrics.textX, y: y, width: textWidth, height: stripHeight)
            }
        }

        let toastSize = toast.fittingSize
        toast.frame = NSRect(
            x: (bounds.width - toastSize.width) / 2, y: bounds.height - toastSize.height - 24,
            width: toastSize.width, height: toastSize.height)
    }
}

final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// Its own class so the keys can tell the card's name from any other field.
final class FocusTitleField: NSTextField {}

/// "Completed “Call the plumber”  Undo", floating at the bottom for a few seconds.
@MainActor
final class FocusToast: NSView {
    var onUndo: () -> Void = {}
    private let label = NSTextField(labelWithString: "")
    private let undo = NSButton(title: "Undo", target: nil, action: nil)

    init() {
        super.init(frame: .zero)
        label.font = .systemFont(ofSize: 13)
        label.lineBreakMode = .byTruncatingMiddle
        label.translatesAutoresizingMaskIntoConstraints = false
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        undo.isBordered = false
        undo.font = .systemFont(ofSize: 13, weight: .semibold)
        undo.contentTintColor = TodosLook.accent
        undo.toolTip = "Undo (⌘Z)"
        undo.target = self
        undo.action = #selector(undoClicked)
        undo.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        addSubview(undo)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualToConstant: 380),
            undo.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 14),
            undo.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            undo.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightAnchor.constraint(equalToConstant: 38),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ message: String) {
        label.stringValue = message
    }

    @objc private func undoClicked() { onUndo() }

    override func draw(_ dirtyRect: NSRect) {
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 4, dy: 4), xRadius: 15, yRadius: 15)
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.18)
        shadow.shadowBlurRadius = 6
        shadow.shadowOffset = NSSize(width: 0, height: -1)
        NSGraphicsContext.saveGraphicsState()
        shadow.set()
        NSColor.controlBackgroundColor.setFill()
        shape.fill()
        NSGraphicsContext.restoreGraphicsState()
    }
}
