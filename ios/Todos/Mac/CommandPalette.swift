import AppKit

// ⌘K: everything you can do, for what's selected. Actions on the selection come
// first in a fixed order, so your fingers learn it; Go To and New follow. Move and
// Snooze open a second list with Tab or Return. Esc steps back, then closes.

final class CommandPalettePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

struct PaletteRow {
    enum Effect {
        /// `keepsCard`: an open to-do stays open afterward, if it's still in the list.
        case run(keepsCard: Bool, () -> Void)
        case open(CommandPalette.Step)
    }

    let title: String
    let symbol: String
    var tint: NSColor = .secondaryLabelColor
    /// The quiet text at the end of the row: a shortcut, or a date.
    var hint: String?
    let effect: Effect
}

@MainActor
final class CommandPalette: NSObject, NSTextFieldDelegate, NSWindowDelegate, NSTableViewDataSource, NSTableViewDelegate {
    enum Step { case root, move, snooze }

    private static let width: CGFloat = 600
    private static let rowHeight: CGFloat = 36
    private static let visibleRows = 8

    private let store: TodoStore
    /// The app's window, and how to put the cursor back in an open to-do.
    weak var mainWindow: NSWindow?
    var refocusCard: (_ inNotes: Bool, _ range: NSRange?) -> Void = { _, _ in }

    private lazy var panel = makePanel()
    private let context = NSTextField(labelWithString: "")
    private let field = NSTextField()
    private let table = NSTableView()
    private let scroll = NSScrollView()
    private let noMatches = NSTextField(labelWithString: "No matches")
    private var step = Step.root
    private var rows: [PaletteRow] = []

    init(store: TodoStore) {
        self.store = store
        super.init()
    }

    var window: NSWindow { panel }
    var isShown: Bool { panel.isVisible }
    var rowTitles: [String] { rows.map(\.title) }
    var selectedTitle: String? { table.selectedRow >= 0 ? rows[table.selectedRow].title : nil }
    var contextText: String { context.stringValue }

    // MARK: Showing

    func toggle() {
        if NSApp.keyWindow is QuickAddPanel { return }
        panel.isVisible ? close() : show()
    }

    private func show() {
        // A new to-do with nothing typed goes; a half-typed name is kept.
        if store.editingID != nil {
            if store.editingText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                store.cancelEdit()
            } else {
                store.commitEdit()
            }
        }
        store.finishNamingArea()
        store.finishNamingSection()
        store.finishRenamingProject()
        if mainWindow?.isVisible == false { mainWindow?.makeKeyAndOrderFront(nil) }
        step = .root
        field.stringValue = ""
        refresh()
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(field)
        if let editor = field.currentEditor() as? NSTextView {
            editor.drawsBackground = false
            editor.insertionPointColor = TodosLook.accent
        }
    }

    private func close() {
        panel.orderOut(nil)
        mainWindow?.makeKey()
    }

    private var contextLine: String {
        let count = store.selectedIDs.count
        if count > 1 { return "\(count) to-dos" }
        guard count == 1, let id = store.selectedIDs.first else { return "" }
        if id == store.openID { return store.openTitle }
        return store.todos.first { $0.id == id }?.title ?? ""
    }

    // MARK: What's listed

    private func matches(_ text: String, _ query: String) -> Bool {
        let haystack = text.lowercased()
        return query.lowercased().split(separator: " ").allSatisfy { haystack.contains($0) }
    }

    private func refresh() {
        let query = field.stringValue.trimmingCharacters(in: .whitespaces)
        switch step {
        case .root:
            rows = rootRows(query)
            field.placeholderString = "Type a command"
        case .move:
            rows = moveTargets().filter { query.isEmpty || matches($0.name, query) }.map { target in
                moveRow(title: target.name, target: target)
            }
            field.placeholderString = "Move to…"
        case .snooze:
            rows = snoozeRows(query)
            field.placeholderString = "Snooze until… try “tomorrow 3pm” or “dec 12”"
        }
        table.reloadData()
        if !rows.isEmpty {
            table.selectRowIndexes([0], byExtendingSelection: false)
            table.scrollRowToVisible(0)
        }
        noMatches.isHidden = !rows.isEmpty
        context.stringValue = contextLine
        context.isHidden = context.stringValue.isEmpty
        resize()
    }

    private func rootRows(_ query: String) -> [PaletteRow] {
        var actions: [PaletteRow] = []
        let ids = store.selectedIDs
        let selected = store.todos.filter { ids.contains($0.id) }
        if !ids.isEmpty {
            let store = store
            let done = selected.allSatisfy { $0.completedAt != nil }
            actions.append(PaletteRow(
                title: done ? "Bring Back" : "Complete", symbol: "checkmark.circle", hint: "E",
                effect: .run(keepsCard: true) { store.completeSelected() }))
            actions.append(PaletteRow(title: "Move to…", symbol: "tray.and.arrow.down", effect: .open(.move)))
            actions.append(PaletteRow(title: "Snooze…", symbol: "moon", hint: "S for tomorrow", effect: .open(.snooze)))
            if selected.contains(where: { $0.snoozedUntil != nil }) {
                actions.append(PaletteRow(
                    title: "Wake Now", symbol: "sun.max", hint: "",
                    effect: .run(keepsCard: true) { store.wakeSelected() }))
            }
            if store.destination != .view(.anytime) {
                actions.append(PaletteRow(
                    title: "Move to Anytime", symbol: "square.stack.3d.up", hint: "⌘R",
                    effect: .run(keepsCard: true) { store.moveSelected(to: .anytime) }))
            }
            if ids.count == 1, store.openID == nil {
                actions.append(PaletteRow(
                    title: "Open", symbol: "doc.text", hint: "Return",
                    effect: .run(keepsCard: false) { store.openSelected() }))
            }
            actions.append(PaletteRow(
                title: "Delete", symbol: "trash", hint: "⌫",
                effect: .run(keepsCard: false) { store.deleteSelected() }))
        }

        let store = store
        var others: [PaletteRow] = []
        for view in TodoView.allCases where store.destination != .view(view) {
            others.append(PaletteRow(
                title: "Go to \(view.label)", symbol: view.symbol, tint: TodosLook.color(view),
                effect: .run(keepsCard: false) { store.go(.view(view)) }))
        }
        for project in store.orderedProjects where store.destination != .project(project.id) {
            others.append(PaletteRow(
                title: "Go to \(project.name)", symbol: "folder", tint: TodosLook.accent,
                effect: .run(keepsCard: false) { store.go(.project(project.id)) }))
        }
        others.append(PaletteRow(
            title: "New To-Do", symbol: "plus", hint: "⌘N", effect: .run(keepsCard: false) { store.startNew() }))
        others.append(PaletteRow(
            title: "New Project", symbol: "folder.badge.plus", hint: "⇧⌘N",
            effect: .run(keepsCard: false) { store.startNewProject() }))
        others.append(PaletteRow(
            title: "New Project Group", symbol: "shippingbox",
            effect: .run(keepsCard: false) { store.startNewArea() }))
        if case .project = store.destination {
            others.append(PaletteRow(
                title: "New Section", symbol: "text.append", hint: "⌥⌘N",
                effect: .run(keepsCard: false) { store.startNewSection() }))
        }

        guard !query.isEmpty else { return actions + others }
        return actions.filter { matches($0.title, query) } + others.filter { matches($0.title, query) }
    }

    private struct MoveTarget {
        let name: String
        let destination: Destination
        let symbol: String
        let tint: NSColor
    }

    /// Everywhere to-dos can go but where they are. Delegated needs a person, and
    /// assigning stays on the website for now.
    private func moveTargets() -> [MoveTarget] {
        let lists: [TodoView] = [.inbox, .today, .week, .anytime, .someday]
        let places = lists.map {
            MoveTarget(name: $0.label, destination: .view($0), symbol: $0.symbol, tint: TodosLook.color($0))
        }
        let projects = store.orderedProjects.map {
            MoveTarget(name: $0.name, destination: .project($0.id), symbol: "folder", tint: TodosLook.accent)
        }
        return (places + projects).filter { $0.destination != store.destination }
    }

    private func moveRow(title: String, target: MoveTarget) -> PaletteRow {
        let store = store
        let ids = store.selectedIDs
        return PaletteRow(
            title: title, symbol: target.symbol, tint: target.tint,
            effect: .run(keepsCard: true) { store.file(ids, to: target.destination) })
    }

    private func snoozeRows(_ query: String) -> [PaletteRow] {
        let store = store
        func row(_ title: String, hint: String, when: Date) -> PaletteRow {
            PaletteRow(
                title: title, symbol: "moon", hint: hint,
                effect: .run(keepsCard: true) { store.snoozeSelected(until: when) })
        }
        guard query.isEmpty else {
            return SnoozeSuggest.suggestions(for: query).map { row($0.label, hint: $0.hint, when: $0.when) }
        }
        let now = Date()
        var presets: [PaletteRow] = []
        let calendar = Calendar.current
        if let evening = calendar.date(bySettingHour: 17, minute: 0, second: 0, of: now), evening > now {
            presets.append(row("This Evening", hint: evening.formatted(date: .omitted, time: .shortened), when: evening))
        }
        func day(_ date: Date) -> String { date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
        let tomorrow = TodoStore.tomorrow(from: now)
        let weekend = TodoStore.thisWeekend(from: now)
        let nextWeek = TodoStore.startOfNextWeek(from: now)
        presets.append(row("Tomorrow", hint: day(tomorrow), when: tomorrow))
        presets.append(row("This Weekend", hint: day(weekend), when: weekend))
        presets.append(row("Next Week", hint: day(nextWeek), when: nextWeek))
        return presets
    }

    // MARK: Acting

    private func perform(_ index: Int) {
        guard rows.indices.contains(index) else { return }
        switch rows[index].effect {
        case .open(let next):
            enter(next)
        case .run(let keepsCard, let action):
            let responder = mainWindow?.firstResponder
            let inNotes = responder is DetailNotesView
            let range = (responder as? NSTextView)?.selectedRange()
            let card = store.openID
            close()
            action()
            // The card closes to save. Bring it back if the to-do is still here.
            if keepsCard, let card, store.openID == nil, store.visible.contains(where: { $0.id == card }) {
                store.selectedID = card
                store.openSelected()
                let refocus = refocusCard
                DispatchQueue.main.async { DispatchQueue.main.async { refocus(inNotes, range) } }
            }
        }
    }

    private func enter(_ next: Step) {
        step = next
        field.stringValue = ""
        refresh()
    }

    private func moveRowSelection(by delta: Int) {
        guard !rows.isEmpty else { return }
        let next = min(max(table.selectedRow + delta, 0), rows.count - 1)
        table.selectRowIndexes([next], byExtendingSelection: false)
        table.scrollRowToVisible(next)
    }

    func controlTextDidChange(_ notification: Notification) {
        refresh()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.moveDown(_:)): moveRowSelection(by: 1)
        case #selector(NSResponder.moveUp(_:)): moveRowSelection(by: -1)
        case #selector(NSResponder.insertNewline(_:)): perform(table.selectedRow)
        case #selector(NSResponder.insertTab(_:)):
            // Tab only opens a second list; it never runs a command by accident.
            if rows.indices.contains(table.selectedRow), case .open(let next) = rows[table.selectedRow].effect {
                enter(next)
            }
        case #selector(NSResponder.cancelOperation(_:)):
            if step == .root { close() } else { enter(.root) }
        case #selector(NSResponder.deleteBackward(_:)):
            guard field.stringValue.isEmpty, step != .root else { return false }
            enter(.root)
        default:
            return false
        }
        return true
    }

    /// Clicking elsewhere puts it away.
    func windowDidResignKey(_ notification: Notification) {
        if panel.isVisible { panel.orderOut(nil) }
    }

    // MARK: Table

    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        PaletteRowView()
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cell =
            tableView.makeView(withIdentifier: .init("palette"), owner: nil) as? PaletteCell ?? {
                let made = PaletteCell()
                made.identifier = .init("palette")
                return made
            }()
        cell.show(rows[row])
        return cell
    }

    @objc private func clicked() {
        perform(table.clickedRow)
    }

    // MARK: Layout

    private func resize() {
        let topInset: CGFloat = context.isHidden ? 10 : 34
        let listed = min(max(rows.count, 1), Self.visibleRows)
        let height = topInset + 40 + CGFloat(listed) * Self.rowHeight + 12
        var frame = panel.frame
        frame.size = NSSize(width: Self.width, height: height)
        // Below the toolbar, staying put at the top as the list grows and shrinks.
        if let main = mainWindow {
            frame.origin.x = main.frame.midX - Self.width / 2
            frame.origin.y = main.frame.maxY - 76 - height
        }
        panel.setFrame(frame, display: true)
        let width = Self.width
        context.frame = NSRect(x: 24, y: 12, width: width - 48, height: 18)
        field.frame = NSRect(x: 22, y: topInset, width: width - 44, height: 34)
        let listTop = topInset + 40
        scroll.frame = NSRect(x: 0, y: listTop, width: width, height: height - listTop - 12)
        noMatches.frame = NSRect(x: 24, y: listTop + 8, width: width - 48, height: 20)
    }

    private func makePanel() -> CommandPalettePanel {
        let panel = CommandPalettePanel(
            contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 300),
            styleMask: [.borderless], backing: .buffered, defer: true)
        panel.level = .floating
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.delegate = self

        context.font = .systemFont(ofSize: 12)
        context.textColor = .secondaryLabelColor
        context.lineBreakMode = .byTruncatingTail

        field.font = .systemFont(ofSize: 20)
        field.isBezeled = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.lineBreakMode = .byTruncatingTail
        field.cell?.isScrollable = true
        field.delegate = self

        table.addTableColumn(NSTableColumn(identifier: .init("row")))
        table.headerView = nil
        table.style = .plain
        table.backgroundColor = .clear
        table.intercellSpacing = .zero
        table.rowHeight = Self.rowHeight
        table.refusesFirstResponder = true
        table.dataSource = self
        table.delegate = self
        table.target = self
        table.action = #selector(clicked)

        scroll.documentView = table
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.automaticallyAdjustsContentInsets = false

        noMatches.font = .systemFont(ofSize: 14)
        noMatches.textColor = .tertiaryLabelColor
        noMatches.isHidden = true

        let content = PaletteContentView()
        for view in [context, field, scroll, noMatches] as [NSView] { content.addSubview(view) }

        let glass = NSGlassEffectView()
        glass.cornerRadius = 24
        glass.contentView = content
        panel.contentView = glass
        return panel
    }
}

/// Laid out from the top, so the list hangs below the field.
final class PaletteContentView: NSView {
    override var isFlipped: Bool { true }
}

final class PaletteRowView: NSTableRowView {
    override var interiorBackgroundStyle: NSView.BackgroundStyle { .normal }

    override func drawSelection(in dirtyRect: NSRect) {
        TodosLook.accent.withAlphaComponent(0.18).setFill()
        NSBezierPath(roundedRect: bounds.insetBy(dx: 10, dy: 1), xRadius: 10, yRadius: 10).fill()
    }
}

final class PaletteCell: NSTableCellView {
    private let icon = NSImageView()
    private let title = NSTextField(labelWithString: "")
    private let hint = NSTextField(labelWithString: "")

    init() {
        super.init(frame: .zero)
        icon.symbolConfiguration = .init(pointSize: 14, weight: .regular)
        title.font = .systemFont(ofSize: 14)
        title.lineBreakMode = .byTruncatingTail
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = .secondaryLabelColor
        hint.setContentHuggingPriority(.required, for: .horizontal)
        hint.setContentCompressionResistancePriority(.required, for: .horizontal)
        for view in [icon, title, hint] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 22),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 22),
            title.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            title.centerYAnchor.constraint(equalTo: centerYAnchor),
            hint.leadingAnchor.constraint(greaterThanOrEqualTo: title.trailingAnchor, constant: 12),
            hint.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -22),
            hint.firstBaselineAnchor.constraint(equalTo: title.firstBaselineAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ row: PaletteRow) {
        icon.image = NSImage(systemSymbolName: row.symbol, accessibilityDescription: nil)
        icon.contentTintColor = row.tint
        title.stringValue = row.title
        hint.stringValue = row.hint ?? ""
    }
}
