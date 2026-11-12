import AppKit

// The list. It's an AppKit table rather than a SwiftUI list: that won the feel
// test (a SwiftUI list clipped rows and left a new to-do's text selected, so the
// next key replaced it). Keys come from KeyRouter. Rows are content, so nothing
// here is glass; the sidebar and toolbar float above them.

/// Everything the table draws from, read together so one change redraws once.
struct TodoListState {
    let rows: [TodoListRow]
    let destination: Destination
    let selectedID: String?
    let selectedIDs: Set<String>
    let renamingProjectID: String?
    /// The cursor belongs in the header, not the sidebar's row.
    let renamingInHeader: Bool
    let namingSectionID: String?
    let openID: String?
    let attachments: [String: [AttachmentItem]]
}

/// Lets a click go straight into the project name, which a table otherwise holds
/// back from text fields in rows that aren't selected.
final class TodoTableView: NSTableView {
    /// Edit > Paste, for when it's chosen from the menu rather than typed.
    var onPaste: (String) -> Void = { _ in }

    @objc func paste(_ sender: Any?) {
        if let text = NSPasteboard.general.string(forType: .string) { onPaste(text) }
    }

    override func validateProposedFirstResponder(_ responder: NSResponder, for event: NSEvent?) -> Bool {
        responder is ProjectNameField || responder is DetailTitleField || responder is DetailNotesView || responder is TickView
            || (responder as? SectionNameField)?.isEditable == true
            || super.validateProposedFirstResponder(responder, for: event)
    }
}

@MainActor
final class TodoListController: NSViewController {
    private let store: TodoStore
    private let coordinator: TodoTableCoordinator
    private var shownDestination: Destination?
    private var clickMonitor: Any?
    private let focusView: FocusView
    private var listParts: [NSView] = []
    private var showingFocus = false

    init(store: TodoStore) {
        self.store = store
        coordinator = TodoTableCoordinator(store: store)
        focusView = FocusView(store: store)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        let table = TodoTableView()
        table.addTableColumn(NSTableColumn(identifier: .init("todo")))
        table.headerView = nil
        table.style = .plain
        table.backgroundColor = .clear
        table.intercellSpacing = .zero
        table.selectionHighlightStyle = .regular
        table.allowsMultipleSelection = true
        table.allowsEmptySelection = true
        table.dataSource = coordinator
        table.delegate = coordinator
        table.target = coordinator
        table.doubleAction = #selector(TodoTableCoordinator.doubleClicked)
        table.setDraggingSourceOperationMask(.move, forLocal: true)
        table.setDraggingSourceOperationMask([], forLocal: false)
        table.draggingDestinationFeedbackStyle = .regular
        table.registerForDraggedTypes([.todoID, .sectionID, .fileURL])
        let menu = NSMenu()
        menu.delegate = coordinator
        table.menu = menu
        coordinator.table = table
        table.onPaste = { [store] text in store.pasteTodos(text) }

        // The list runs the full height of the window, under the toolbar.
        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = table
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.backgroundColor = TodosLook.paper
        scroll.automaticallyAdjustsContentInsets = true

        let fade = TopFadeView()
        fade.translatesAutoresizingMaskIntoConstraints = false
        let container = NSView()
        container.addSubview(scroll)
        container.addSubview(fade)
        // Focus mode takes the list's place, under the same toolbar.
        focusView.translatesAutoresizingMaskIntoConstraints = false
        focusView.isHidden = true
        container.addSubview(focusView)
        listParts = [scroll, fade]
        NSLayoutConstraint.activate([
            focusView.topAnchor.constraint(equalTo: container.topAnchor),
            focusView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            focusView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            focusView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: container.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            fade.topAnchor.constraint(equalTo: container.topAnchor),
            fade.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            fade.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            fade.heightAnchor.constraint(equalToConstant: 58),
        ])
        view = container
        follow()
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        focus()
        guard clickMonitor == nil else { return }
        clickMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            self?.collapseCardIfClickedOutside(event)
            return event
        }
    }

    /// A click anywhere in the list but the card, a to-do row or a control puts the
    /// open to-do away. Other to-do rows do that themselves by taking the selection.
    private func collapseCardIfClickedOutside(_ event: NSEvent) {
        guard store.openID != nil, let window = view.window, event.windowNumber == window.windowNumber else { return }
        let point = view.convert(event.locationInWindow, from: nil)
        guard view.bounds.contains(point), !coordinator.keepsCardOpen(atWindowPoint: event.locationInWindow) else { return }
        var hit = window.contentView?.superview?.hitTest(event.locationInWindow)
        while let current = hit {
            if current is NSButton || current is NSScroller { return }
            hit = current.superview
        }
        store.closeOpen()
    }

    func focus() {
        if store.focusing {
            focusView.takeKeys()
        } else {
            view.window?.makeFirstResponder(coordinator.table)
        }
    }

    /// Back in an open to-do, with the cursor where it was.
    func focusCard(inNotes: Bool, range: NSRange?) {
        coordinator.focusCard(inNotes: inNotes, range: range)
    }

    /// Redraw whenever anything the list reads changes.
    private func follow() {
        let (state, focusing) = withObservationTracking {
            (TodoListState(
                rows: store.listRows, destination: store.destination, selectedID: store.selectedID,
                selectedIDs: store.selectedIDs, renamingProjectID: store.renamingProjectID,
                renamingInHeader: store.renamingProjectID != nil && !store.isRenamingInSidebar,
                namingSectionID: store.namingSectionID, openID: store.openID,
                attachments: store.attachments.byTask), store.focusing)
        } onChange: { [weak self] in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.follow() } }
        }
        coordinator.apply(state)
        // Focus mode takes the list's place, and the keys with it.
        if focusing != showingFocus {
            showingFocus = focusing
            focusView.isHidden = !focusing
            for part in listParts { part.isHidden = focusing }
            focus()
        }
        // Keys and focus belong to the list, even just after a click in the sidebar.
        if shownDestination != state.destination {
            // Not while a new to-do's field has just taken the cursor.
            if shownDestination != nil, state.renamingProjectID == nil, state.namingSectionID == nil, state.openID == nil { focus() }
            shownDestination = state.destination
        }
    }
}

/// Rows dissolve into the paper as they scroll up to the toolbar, so text never
/// runs sharp behind the buttons. Clicks pass straight through.
final class TopFadeView: NSView {
    private let gradient = CAGradientLayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.addSublayer(gradient)
        gradient.locations = [0, 0.62, 1]
    }

    required init?(coder: NSCoder) { fatalError() }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.frame = bounds
        CATransaction.commit()
    }

    override func updateLayer() {
        var solid: CGColor = NSColor.clear.cgColor
        effectiveAppearance.performAsCurrentDrawingAppearance { solid = TodosLook.paper.cgColor }
        gradient.colors = [solid, solid, solid.copy(alpha: 0) ?? solid]
    }

    override var wantsUpdateLayer: Bool { true }
}

@MainActor
final class TodoTableCoordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate, NSMenuDelegate {
    let store: TodoStore
    weak var table: NSTableView?
    private var rows: [TodoListRow] = []
    private var destination: Destination?
    private var renamingProjectID: String?
    private var namingSectionID: String?
    private var openRowID: String?
    private var closingRowID: String?
    private var applying = false
    private var attachments: [String: [AttachmentItem]] = [:]

    init(store: TodoStore) {
        self.store = store
    }

    func apply(_ list: TodoListState) {
        guard let table else { return }
        applying = true
        defer { applying = false }

        let old = rows
        let new = list.rows
        rows = new
        closingRowID = openRowID == list.openID ? nil : openRowID
        let opening = openRowID == list.openID ? nil : list.openID
        openRowID = list.openID
        if destination != list.destination {
            // Another list altogether: draw it, don't animate one into the other.
            destination = list.destination
            table.reloadData()
            table.scrollToBeginningOfDocument(nil)
        } else {
            update(table, from: old, to: new, in: list)
        }

        var selected = IndexSet()
        for (index, row) in new.enumerated() where list.selectedIDs.contains(row.id) {
            selected.insert(index)
        }
        if table.selectedRowIndexes != selected {
            table.selectRowIndexes(selected, byExtendingSelection: false)
            // Follow the cursor down the list, but stay put for ⌘A.
            if selected.count == 1, let row = selected.first { table.scrollRowToVisible(row) }
        }

        syncRenaming(list, in: table)
        syncNamingSection(list, in: table)
        syncOpen(opening: opening, closing: closingRowID, in: table)
        closingRowID = nil
        syncAttachments(list.attachments, in: table)
    }

    /// Only the rows whose files changed, and the open card in place, cursor and all.
    private func syncAttachments(_ new: [String: [AttachmentItem]], in table: NSTableView) {
        let previous = attachments
        attachments = new
        guard previous != new else { return }
        for id in Set(previous.keys).union(new.keys) where previous[id] != new[id] {
            guard let row = rows.firstIndex(where: { $0.id == id }) else { continue }
            if id == openRowID {
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = 0
                    table.noteHeightOfRows(withIndexesChanged: [row])
                }
                (table.view(atColumn: 0, row: row, makeIfNecessary: false) as? TodoDetailCell)?.showAttachments(new[id] ?? [], store: store.attachments)
            } else {
                table.reloadData(forRowIndexes: [row], columnIndexes: [0])
            }
        }
    }

    /// Inside the open card, or on a to-do row, which has its own click behavior.
    func keepsCardOpen(atWindowPoint windowPoint: NSPoint) -> Bool {
        guard let table else { return false }
        let point = table.convert(windowPoint, from: nil)
        let row = table.row(at: point)
        guard row >= 0, row < rows.count, case .todo(let todo, _) = rows[row] else { return false }
        guard todo.id == openRowID else { return true }
        return TodoDetailCell.cardRect(in: table.rect(ofRow: row)).contains(point)
    }

    func focusCard(inNotes: Bool, range: NSRange?) {
        guard let table, let row = rows.firstIndex(where: { $0.id == openRowID }),
            let cell = table.view(atColumn: 0, row: row, makeIfNecessary: true) as? TodoDetailCell
        else { return }
        cell.restoreCursor(inNotes: inNotes, range: range)
    }

    /// Swap the row for its card, or back, and put the cursor where it belongs.
    private func syncOpen(opening: String?, closing: String?, in table: NSTableView) {
        guard opening != nil || closing != nil else { return }
        if closing != nil { TodoDetailCell.forgetMeasurement() }
        var changed = IndexSet()
        for id in [opening, closing].compactMap({ $0 }) {
            if let row = rows.firstIndex(where: { $0.id == id }) { changed.insert(row) }
        }
        if closing != nil, opening == nil, table.window?.firstResponder is NSText {
            table.window?.makeFirstResponder(table)
        }
        if !changed.isEmpty {
            table.noteHeightOfRows(withIndexesChanged: changed)
            table.reloadData(forRowIndexes: changed, columnIndexes: [0])
            for row in changed {
                (table.rowView(atRow: row, makeIfNecessary: false) as? TodoRowView)?.isCard = rows[row].id == opening
            }
        }
        if let opening, let row = rows.firstIndex(where: { $0.id == opening }) {
            table.scrollRowToVisible(row)
            (table.view(atColumn: 0, row: row, makeIfNecessary: true) as? TodoDetailCell)?.focusTitle()
        }
    }

    /// The cursor in a new section's name, and back to the list when it's done.
    private func syncNamingSection(_ list: TodoListState, in table: NSTableView) {
        let previous = namingSectionID
        namingSectionID = list.namingSectionID
        if let previous, previous != list.namingSectionID {
            table.window?.makeFirstResponder(table)
            // Back to plain text, even if the name didn't change.
            if let row = rows.firstIndex(where: { $0.id == "group-" + previous }) {
                table.reloadData(forRowIndexes: [row], columnIndexes: [0])
            }
        }
        if let id = list.namingSectionID, let row = rows.firstIndex(where: { $0.id == "group-" + id }) {
            table.scrollRowToVisible(row)
            let cell = table.view(atColumn: 0, row: row, makeIfNecessary: true) as? GroupCell
            cell?.focusName(delegate: self)
        }
    }

    /// Put the cursor in the header when a new project asks for a name, and take
    /// it back to the list when naming ends.
    private func syncRenaming(_ list: TodoListState, in table: NSTableView) {
        let wasRenaming = renamingProjectID != nil
        renamingProjectID = list.renamingProjectID
        if list.renamingInHeader {
            let cell = table.view(atColumn: 0, row: 0, makeIfNecessary: true) as? HeadingCell
            cell?.focusName()
        } else if wasRenaming, list.renamingProjectID == nil {
            table.window?.makeFirstResponder(table)
        }
    }

    private func update(_ table: NSTableView, from old: [TodoListRow], to new: [TodoListRow], in list: TodoListState) {
        let oldIDs = old.map(\.id)
        let newIDs = new.map(\.id)
        if oldIDs != newIDs {
            var removals = IndexSet()
            var insertions = IndexSet()
            for change in newIDs.difference(from: oldIDs) {
                switch change {
                case .remove(let offset, _, _): removals.insert(offset)
                case .insert(let offset, _, _): insertions.insert(offset)
                }
            }
            table.beginUpdates()
            table.removeRows(at: removals, withAnimation: [.effectFade, .slideUp])
            table.insertRows(at: insertions, withAnimation: [.effectFade])
            table.endUpdates()
        }
        // Redraw only rows whose content changed, and never the one being
        // typed in: a background change can't disturb the cursor.
        let before = Dictionary(old.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var changed = IndexSet()
        for (index, row) in new.enumerated()
        where row.id != openRowID && row.id != closingRowID
            && !(row.id == "heading" && list.renamingInHeader)
            && (before[row.id].map { $0 != row } ?? false) {
            changed.insert(index)
        }
        if !changed.isEmpty {
            table.reloadData(forRowIndexes: changed, columnIndexes: [0])
        }
    }

    // MARK: Table

    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
        switch rows[row] {
        case .heading: 76
        case .group: 38
        case .empty: 36
        case .todo(let todo, _):
            todo.id == openRowID
                ? TodoDetailCell.height(notes: store.openNotes, attachments: store.attachments.items(for: todo.id), width: tableView.bounds.width) : 36
        }
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        let view = TodoRowView()
        view.isCard = rows[row].id == openRowID
        return view
    }

    func tableViewColumnDidResize(_ notification: Notification) {
        if let table, let row = rows.firstIndex(where: { $0.id == openRowID }) {
            table.noteHeightOfRows(withIndexesChanged: [row])
        }
    }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
        if case .todo = rows[row] { true } else { false }
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        switch rows[row] {
        case .heading(let title, let count):
            let cell = reuse(tableView, "heading") { HeadingCell() }
            cell.configure(title: title, count: count, destination: destination, delegate: self)
            return cell
        case .group(_, let name):
            let cell = reuse(tableView, "group") { GroupCell() }
            cell.configure(name)
            return cell
        case .empty:
            let cell = reuse(tableView, "empty") { GroupCell() }
            cell.configure("Nothing here", quiet: true)
            return cell
        case .todo(let todo, let detail):
            if todo.id == openRowID {
                let cell = reuse(tableView, "detail") { TodoDetailCell() }
                let store = store
                cell.configure(todo, title: store.openTitle, notes: store.openNotes, attachments: store.attachments, delegate: self) { [weak self, weak tableView] notes in
                    store.openNotes = notes
                    if let tableView, let row = self?.rows.firstIndex(where: { $0.id == todo.id }) {
                        NSAnimationContext.runAnimationGroup { context in
                            context.duration = 0
                            tableView.noteHeightOfRows(withIndexesChanged: [row])
                        }
                    }
                } onTick: {
                    store.toggleComplete(todo.id)
                }
                return cell
            }
            let cell = reuse(tableView, "todo") { TodoCell() }
            cell.configure(todo, detail: detail, marker: store.marker(for: todo), attachments: store.attachments.items(for: todo.id).count) { [weak self] in
                self?.store.toggleComplete(todo.id)
            }
            return cell
        }
    }

    private func reuse<Cell: NSView>(_ table: NSTableView, _ name: String, make: () -> Cell) -> Cell {
        let identifier = NSUserInterfaceItemIdentifier(name)
        if let cell = table.makeView(withIdentifier: identifier, owner: nil) as? Cell { return cell }
        let cell = make()
        cell.identifier = identifier
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard !applying, let table else { return }
        let ids = table.selectedRowIndexes.filter { $0 < rows.count }.map { rows[$0].id }
        if ids.count > 1 {
            store.select(Set(ids))
        } else {
            store.selectedID = ids.first
        }
    }

    // MARK: Dragging

    func tableView(_ tableView: NSTableView, pasteboardWriterForRow row: Int) -> NSPasteboardWriting? {
        if let section = sectionID(at: row) {
            guard section != namingSectionID else { return nil }
            let item = NSPasteboardItem()
            item.setString(section, forType: .sectionID)
            return item
        }
        guard case .todo(let todo, _) = rows[row], todo.completedAt == nil, todo.id != openRowID
        else { return nil }
        let item = NSPasteboardItem()
        item.setString(todo.id, forType: .todoID)
        return item
    }

    /// The whole selection rides along when the row is in it; an unselected row
    /// is selected and goes alone.
    func tableView(
        _ tableView: NSTableView, draggingSession session: NSDraggingSession,
        willBeginAt screenPoint: NSPoint, forRowIndexes rowIndexes: IndexSet
    ) {
        // A section's heading carries its to-dos without selecting them.
        let ids = rowIndexes.filter { if case .todo = rows[$0] { true } else { false } }.map { rows[$0].id }
        if !ids.isEmpty { store.select(Set(ids)) }
    }

    // MARK: Dropping in the list

    private func sectionID(at row: Int) -> String? {
        guard case .project = destination, row >= 0, row < rows.count, case .group(let id, _) = rows[row] else { return nil }
        return id
    }

    /// The group a gap between rows falls in: the nearest group above it.
    private func group(atGap gap: Int) -> String {
        for row in stride(from: gap - 1, through: 0, by: -1) {
            switch rows[row] {
            case .group(let id, _): return id
            case .todo(let todo, _):
                switch destination {
                case .project: return todo.sectionId ?? "loose"
                case .view(.week), .view(.anytime), .view(.someday): return todo.projectId ?? "loose"
                default: return "all"
                }
            default: break
            }
        }
        if case .view(.today) = destination { return "all" }
        if case .view(.inbox) = destination { return "all" }
        return "loose"
    }

    private func draggedIDs(_ info: NSDraggingInfo) -> Set<String> {
        Set(info.draggingPasteboard.pasteboardItems?.compactMap { $0.string(forType: .todoID) } ?? [])
    }

    /// A section's heading takes the drop whole; anywhere else, the nearest gap.
    func tableView(
        _ tableView: NSTableView, validateDrop info: NSDraggingInfo, proposedRow row: Int,
        proposedDropOperation dropOperation: NSTableView.DropOperation
    ) -> NSDragOperation {
        let point = tableView.convert(info.draggingLocation, from: nil)
        if isFileDrag(info) {
            let hovered = tableView.row(at: point)
            guard hovered >= 0, case .todo = rows[hovered] else { return [] }
            tableView.setDropRow(hovered, dropOperation: .on)
            return .copy
        }
        if info.draggingPasteboard.types?.contains(.sectionID) == true {
            // Sections land only between sections, never in among a section's to-dos.
            let tops = rows.indices.filter { sectionID(at: $0) != nil } + [rows.count]
            let y: (Int) -> CGFloat = { row in
                row < self.rows.count ? tableView.rect(ofRow: row).minY : tableView.rect(ofRow: row - 1).maxY
            }
            guard let nearest = tops.min(by: { abs(y($0) - point.y) < abs(y($1) - point.y) }) else { return [] }
            tableView.setDropRow(nearest, dropOperation: .above)
            return .move
        }
        let hovered = tableView.row(at: point)
        if sectionID(at: hovered) != nil {
            tableView.setDropRow(hovered, dropOperation: .on)
            return .move
        }
        var gap = rows.count
        if hovered >= 0 {
            gap = point.y < tableView.rect(ofRow: hovered).midY ? hovered : hovered + 1
        }
        // Never above the list's big title.
        gap = max(gap, 1)
        guard store.canMove(draggedIDs(info), toGroup: group(atGap: gap)) else { return [] }
        tableView.setDropRow(gap, dropOperation: .above)
        return .move
    }

    func tableView(
        _ tableView: NSTableView, acceptDrop info: NSDraggingInfo, row: Int,
        dropOperation: NSTableView.DropOperation
    ) -> Bool {
        if isFileDrag(info) {
            guard case .todo(let todo, _) = rows[row] else { return false }
            store.attachments.add(files: AttachmentPasteboard.fileURLs(on: info.draggingPasteboard), to: todo.id)
            return true
        }
        if let section = info.draggingPasteboard.string(forType: .sectionID) {
            store.moveSection(section, before: sectionID(at: row))
            return true
        }
        let ids = draggedIDs(info)
        guard !ids.isEmpty else { return false }
        if dropOperation == .on {
            guard let section = sectionID(at: row) else { return false }
            store.file(ids, toSection: section)
            return true
        }
        var before: String?
        if row < rows.count, case .todo(let todo, _) = rows[row] { before = todo.id }
        store.move(ids, toGroup: group(atGap: row), before: before)
        return true
    }

    private func isFileDrag(_ info: NSDraggingInfo) -> Bool {
        let types = info.draggingPasteboard.types ?? []
        return types.contains(.fileURL) && !types.contains(.todoID) && !types.contains(.sectionID)
    }

    @objc func doubleClicked() {
        guard let table, table.clickedRow >= 0 else { return }
        if let section = sectionID(at: table.clickedRow) {
            store.startRenamingSection(section)
            return
        }
        guard case .todo = rows[table.clickedRow] else { return }
        store.openSelected()
    }

    // MARK: Right-click

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        if let table, let section = sectionID(at: table.clickedRow) {
            let store = store
            menu.addItem(ClosureMenuItem(title: "Rename") { store.startRenamingSection(section) })
            menu.addItem(ClosureMenuItem(title: "Delete Section") { store.deleteSection(section) })
            return
        }
        guard let table, table.clickedRow >= 0, case .todo(let todo, _) = rows[table.clickedRow] else { return }
        if !store.selectedIDs.contains(todo.id) { store.selectedID = todo.id }
        let add: (NSMenu, String, @escaping @MainActor () -> Void) -> Void = { menu, title, action in
            menu.addItem(ClosureMenuItem(title: title, action: action))
        }
        add(menu, todo.completedAt == nil ? "Complete" : "Bring Back") { [store] in store.completeSelected() }
        add(menu, "Open") { [store] in store.openSelected() }
        menu.addItem(.separator())
        add(menu, "Today") { [store] in store.moveSelected(to: .today) }
        add(menu, "This Week") { [store] in store.moveSelected(to: .week) }
        add(menu, "Anytime") { [store] in store.moveSelected(to: .anytime) }
        add(menu, "Someday") { [store] in store.moveSelected(to: .someday) }
        let snooze = NSMenu(title: "Snooze")
        add(snooze, "Tomorrow") { [store] in store.snoozeSelected(until: TodoStore.tomorrow()) }
        add(snooze, "This Weekend") { [store] in store.snoozeSelected(until: TodoStore.thisWeekend()) }
        add(snooze, "Next Week") { [store] in store.snoozeSelected(until: TodoStore.startOfNextWeek()) }
        let snoozeItem = menu.addItem(withTitle: "Snooze", action: nil, keyEquivalent: "")
        snoozeItem.submenu = snooze
        menu.addItem(.separator())
        add(menu, "Delete") { [store] in store.deleteSelected() }
    }

    // MARK: Typing

    func controlTextDidBeginEditing(_ notification: Notification) {
        if notification.object is ProjectNameField { store.startRenamingProject() }
    }

    func controlTextDidChange(_ notification: Notification) {
        guard let field = notification.object as? NSTextField else { return }
        if let name = field as? ProjectNameField {
            name.invalidateIntrinsicContentSize()
            store.updateProjectName(name.stringValue)
        } else if field is SectionNameField {
            store.sectionDraft = field.stringValue
        } else if field is DetailTitleField {
            store.openTitle = field.stringValue
        }
    }

    func controlTextDidEndEditing(_ notification: Notification) {
        // The open to-do saves when it closes, not when the cursor moves to its notes.
        if notification.object is DetailTitleField { return }
        // Clicking away keeps what was typed, as Return does.
        if notification.object is ProjectNameField {
            if !applying { store.finishRenamingProject() }
        } else if notification.object is SectionNameField {
            if !applying { store.finishNamingSection() }
        }
    }

    /// Return and Esc in the project name. To-do rows get theirs from KeyRouter.
    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if control is DetailTitleField {
            let isTab = selector == #selector(NSResponder.insertTab(_:)) || selector == #selector(NSResponder.insertBacktab(_:))
            let isDown = selector == #selector(NSResponder.moveDown(_:))
            guard isTab || isDown else { return false }
            var view = control.superview
            while let current = view, !(current is TodoDetailCell) { view = current.superview }
            (view as? TodoDetailCell)?.focusNotes(atStart: isDown)
            return true
        }
        if control is SectionNameField {
            switch selector {
            case #selector(NSResponder.insertNewline(_:)): store.finishNamingSection()
            case #selector(NSResponder.cancelOperation(_:)): store.cancelNamingSection()
            default: return false
            }
            return true
        }
        guard control is ProjectNameField else { return false }
        switch selector {
        case #selector(NSResponder.insertNewline(_:)): store.finishRenamingProject()
        case #selector(NSResponder.cancelOperation(_:)): store.cancelRenamingProject()
        default: return false
        }
        // Also covers a click into the name with nothing typed yet.
        table?.window?.makeFirstResponder(table)
        return true
    }
}

final class ClosureMenuItem: NSMenuItem {
    private let run: @MainActor () -> Void

    init(title: String, action run: @escaping @MainActor () -> Void) {
        self.run = run
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }

    required init(coder: NSCoder) { fatalError() }

    @objc private func fire() { MainActor.assumeIsolated { run() } }
}

/// A quiet tint behind the selected row, rounded to sit inside the list's margins,
/// with the text staying its normal color. A list you walk with the keyboard
/// shouldn't flash a saturated bar at every step.
final class TodoRowView: NSTableRowView {
    /// An open to-do's card draws itself instead.
    var isCard = false {
        didSet { needsDisplay = true }
    }

    override var interiorBackgroundStyle: NSView.BackgroundStyle { .normal }

    /// A row's contents always fill it exactly. Left alone, when a row opens or
    /// closes the table adds the change on top of a cell already at its new size,
    /// so a card overflowed its row and a closed row's contents shrank to nothing.
    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        fitCells()
    }

    override func layout() {
        super.layout()
        fitCells()
    }

    private func fitCells() {
        for case let cell as NSTableCellView in subviews where cell.frame != bounds {
            cell.frame = bounds
        }
    }

    /// Neighboring selected rows join into one shape.
    override func drawSelection(in dirtyRect: NSRect) {
        guard !isCard else { return }
        var box = bounds.insetBy(dx: 12, dy: 0)
        let top: CGFloat = isPreviousRowSelected ? 0 : 10
        let bottom: CGFloat = isNextRowSelected ? 0 : 10
        if !isPreviousRowSelected { box.origin.y += 1; box.size.height -= 1 }
        if !isNextRowSelected { box.size.height -= 1 }
        let shape = NSBezierPath()
        shape.move(to: NSPoint(x: box.minX + top, y: box.minY))
        shape.appendArc(from: NSPoint(x: box.maxX, y: box.minY), to: NSPoint(x: box.maxX, y: box.maxY), radius: top)
        shape.appendArc(from: NSPoint(x: box.maxX, y: box.maxY), to: NSPoint(x: box.minX, y: box.maxY), radius: bottom)
        shape.appendArc(from: NSPoint(x: box.minX, y: box.maxY), to: NSPoint(x: box.minX, y: box.minY), radius: bottom)
        shape.appendArc(from: NSPoint(x: box.minX, y: box.minY), to: NSPoint(x: box.maxX, y: box.minY), radius: top)
        shape.close()
        TodosLook.accent.withAlphaComponent(isEmphasized ? 0.16 : 0.08).setFill()
        shape.fill()
    }
}

/// A project's name, in place as the list's big title. It's as wide as its text,
/// so the count stays right beside it.
final class ProjectNameField: NSTextField {
    override var intrinsicContentSize: NSSize {
        let attributes: [NSAttributedString.Key: Any] = [.font: font ?? .systemFont(ofSize: 26)]
        let text = currentEditor()?.string ?? stringValue
        let shown = text.isEmpty ? (placeholderString ?? "") : text
        var size = super.intrinsicContentSize
        size.width = ceil((shown as NSString).size(withAttributes: attributes).width) + 8
        return size
    }
}

final class HeadingCell: NSTableCellView {
    private let icon = NSImageView()
    private let title = ProjectNameField()
    private let count = NSTextField(labelWithString: "")

    init() {
        super.init(frame: .zero)
        icon.symbolConfiguration = .init(pointSize: 22, weight: .semibold)
        title.font = .systemFont(ofSize: 26, weight: .bold)
        title.isBezeled = false
        title.drawsBackground = false
        title.focusRingType = .none
        title.isEditable = false
        title.isSelectable = false
        title.placeholderString = "New Project"
        title.lineBreakMode = .byTruncatingTail
        title.cell?.isScrollable = true
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        count.font = .systemFont(ofSize: 15, weight: .regular)
        count.textColor = .tertiaryLabelColor
        let stack = NSStackView(views: [icon, title, count])
        stack.spacing = 10
        stack.alignment = .firstBaseline
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 26),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -26),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -16),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(title text: String, count number: Int, destination: Destination?, delegate: NSTextFieldDelegate) {
        title.delegate = delegate
        title.stringValue = text
        title.invalidateIntrinsicContentSize()
        count.stringValue = number > 0 ? "\(number)" : ""
        if case .view(let view) = destination {
            icon.image = NSImage(systemSymbolName: view.symbol, accessibilityDescription: nil)
            icon.contentTintColor = TodosLook.color(view)
            title.isEditable = false
            title.isSelectable = false
        } else {
            icon.image = NSImage(systemSymbolName: "folder.fill", accessibilityDescription: nil)
            icon.contentTintColor = TodosLook.accent
            title.isEditable = true
            title.isSelectable = true
        }
    }

    func focusName() {
        guard title.currentEditor() == nil else { return }
        window?.makeFirstResponder(title)
        guard let editor = title.currentEditor() as? NSTextView else { return }
        editor.selectedRange = NSRange(location: (title.stringValue as NSString).length, length: 0)
        editor.drawsBackground = false
        editor.insertionPointColor = TodosLook.accent
    }
}

/// A new section's name while it's being typed.
final class SectionNameField: NSTextField {}

final class GroupCell: NSTableCellView {
    private let name = SectionNameField()

    init() {
        super.init(frame: .zero)
        name.font = .systemFont(ofSize: 13, weight: .semibold)
        name.textColor = .secondaryLabelColor
        name.isBezeled = false
        name.drawsBackground = false
        name.focusRingType = .none
        name.isEditable = false
        name.isSelectable = false
        name.placeholderString = "New Section"
        name.cell?.isScrollable = true
        name.translatesAutoresizingMaskIntoConstraints = false
        addSubview(name)
        NSLayoutConstraint.activate([
            name.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 26),
            name.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -26),
            name.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(_ text: String, quiet: Bool = false) {
        name.isEditable = false
        name.isSelectable = false
        name.delegate = nil
        name.stringValue = text
        name.font = quiet ? .systemFont(ofSize: 14) : .systemFont(ofSize: 13, weight: .semibold)
        name.textColor = quiet ? .tertiaryLabelColor : .secondaryLabelColor
    }

    func focusName(delegate: NSTextFieldDelegate) {
        guard name.currentEditor() == nil else { return }
        name.isEditable = true
        name.isSelectable = true
        name.delegate = delegate
        window?.makeFirstResponder(name)
        guard let editor = name.currentEditor() as? NSTextView else { return }
        // A name already there is selected, ready to type over.
        editor.selectAll(nil)
        editor.drawsBackground = false
        editor.insertionPointColor = TodosLook.accent
    }
}

/// A to-do's circle. It takes the click itself, with the table's say-so (see
/// TodoTableView): the table would otherwise read the press as the start of a drag
/// or a selection, and the click would never arrive.
final class TickView: NSImageView {
    var onClick: () -> Void = {}

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {}

    override func mouseUp(with event: NSEvent) {
        if bounds.contains(convert(event.locationInWindow, from: nil)) { onClick() }
    }
}

final class DetailTitleField: NSTextField {}
/// The raised card. Drawn rather than a layer, so it follows light and dark mode.
final class DetailCardBackground: NSView {
    var inset = NSSize.zero {
        didSet { needsDisplay = true }
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        let shape = NSBezierPath(
            roundedRect: bounds.insetBy(dx: inset.width, dy: inset.height), xRadius: 14, yRadius: 14)
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.16)
        shadow.shadowBlurRadius = 6
        shadow.shadowOffset = NSSize(width: 0, height: -1)
        NSGraphicsContext.saveGraphicsState()
        shadow.set()
        NSColor.controlBackgroundColor.setFill()
        shape.fill()
        NSGraphicsContext.restoreGraphicsState()
    }
}

/// An open to-do: its name and notes on a raised card, and nothing else. Actions
/// stay out of the way, on the keyboard.
final class TodoDetailCell: NSTableCellView {
    private enum Metrics {
        static let cardX: CGFloat = 12
        static let cardY: CGFloat = 6
        static let textX: CGFloat = 56
        static let textRight: CGFloat = 40
        static let top: CGFloat = 19
        static let titleHeight: CGFloat = 22
        static let gap: CGFloat = 10
        static let bottom: CGFloat = 20
        static let font = NSFont.systemFont(ofSize: 14)
        static let noteStyle = NoteStyle(size: 14, accent: TodosLook.accent, indent: 22)
    }

    private let card = DetailCardBackground()
    private let circle = TickView()
    private let title = DetailTitleField()
    private let notes = DetailNotesView.make(style: Metrics.noteStyle)
    private let placeholder = NSTextField(labelWithString: "Notes")
    private let strip = AttachmentStripView()
    private var todoID: String?
    private var attachmentStore: AttachmentStore?
    private var onNotes: (String) -> Void = { _ in }
    private var onTick: () -> Void = {}

    override var isFlipped: Bool { true }

    init() {
        super.init(frame: .zero)
        addSubview(card)
        circle.symbolConfiguration = .init(pointSize: 17, weight: .light)
        circle.image = NSImage(systemSymbolName: "circle", accessibilityDescription: "Not done")
        circle.contentTintColor = .tertiaryLabelColor
        circle.onClick = { [weak self] in self?.tick() }
        addSubview(circle)
        title.font = Metrics.font
        title.isBezeled = false
        title.drawsBackground = false
        title.focusRingType = .none
        title.isEditable = true
        title.lineBreakMode = .byTruncatingTail
        title.cell?.isScrollable = true
        title.placeholderString = "New To-Do"
        addSubview(title)
        notes.onChange = { [weak self] html in self?.notesChanged(html) }
        notes.onTabOut = { [weak self] in self?.focusTitle() }
        addSubview(strip)
        addSubview(notes)
        placeholder.font = Metrics.font
        placeholder.textColor = .tertiaryLabelColor
        addSubview(placeholder)
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Rows are re-measured often, and usually for the same note.
    private static var measured: (html: String, width: CGFloat, height: CGFloat)?

    /// The white card within its row: the row's margins count as outside it.
    static func cardRect(in row: NSRect) -> NSRect {
        row.insetBy(dx: Metrics.cardX, dy: Metrics.cardY)
    }

    /// A closed note goes back to being measured from what was saved.
    static func forgetMeasurement() { measured = nil }

    private static func attachmentsHeight(_ items: [AttachmentItem], width: CGFloat) -> CGFloat {
        items.isEmpty ? 0 : AttachmentStripView.arrange(items, width: width).height + Metrics.gap
    }

    static func height(notes html: String, attachments: [AttachmentItem], width: CGFloat) -> CGFloat {
        let available = max(width - Metrics.textX - Metrics.textRight, 100)
        var height: CGFloat
        if let measured, measured.html == html, measured.width == available {
            height = measured.height
        } else {
            let text = NoteEditing.display(html, style: Metrics.noteStyle).text
            if text.length == 0 || text.string.hasSuffix("\n") {
                text.append(Metrics.noteStyle.string(" ", .paragraph))
            }
            height = NoteLayoutManager.height(of: text, width: available, style: Metrics.noteStyle)
            measured = (html, available, height)
        }
        height = max(height, 18)
        return Metrics.cardY * 2 + Metrics.top + Metrics.titleHeight + Metrics.gap + height
            + attachmentsHeight(attachments, width: available) + Metrics.bottom
    }

    override func layout() {
        super.layout()
        card.frame = bounds
        card.inset = NSSize(width: Metrics.cardX, height: Metrics.cardY)
        let titleY = Metrics.cardY + Metrics.top
        circle.frame = NSRect(x: 24, y: titleY - 2, width: 24, height: 24)
        let width = bounds.width - Metrics.textX - Metrics.textRight
        // A text field's own padding is 2 points: this lines the name up with the notes.
        title.frame = NSRect(x: Metrics.textX - 2, y: titleY, width: width + 2, height: Metrics.titleHeight)
        let notesY = titleY + Metrics.titleHeight + Metrics.gap
        let items = attachmentStore.map { store in todoID.map { store.items(for: $0) } ?? [] } ?? []
        let stripHeight = AttachmentStripView.arrange(items, width: width).height
        let stripSpace = items.isEmpty ? 0 : stripHeight + Metrics.gap
        let notesHeight = bounds.height - notesY - Metrics.cardY - Metrics.bottom - stripSpace
        notes.frame = NSRect(x: Metrics.textX, y: notesY, width: width, height: notesHeight)
        strip.frame = NSRect(x: Metrics.textX, y: notesY + notesHeight + Metrics.gap, width: width, height: stripHeight)
        placeholder.frame = NSRect(x: Metrics.textX, y: notesY, width: width, height: 20)
    }

    func configure(
        _ todo: Todo, title text: String, notes body: String, attachments: AttachmentStore, delegate: NSTextFieldDelegate,
        onNotes: @escaping (String) -> Void, onTick: @escaping () -> Void
    ) {
        self.onNotes = onNotes
        self.onTick = onTick
        title.delegate = delegate
        title.stringValue = text
        notes.show(html: body)
        todoID = todo.id
        attachmentStore = attachments
        strip.show(attachments.items(for: todo.id), store: attachments)
        let id = todo.id
        notes.onPasteFiles = { board in AttachmentPasteboard.attach(from: board, to: id, in: attachments) }
        placeholder.isHidden = !notes.string.isEmpty
        needsLayout = true
    }

    func showAttachments(_ items: [AttachmentItem], store: AttachmentStore) {
        strip.show(items, store: store)
        // As when the notes grow: keep the card exactly filling its new height.
        enclosingScrollView?.documentView?.layoutSubtreeIfNeeded()
        if let row = superview { frame = row.bounds }
        needsLayout = true
    }

    func focusTitle() {
        window?.makeFirstResponder(title)
        guard let editor = title.currentEditor() as? NSTextView else { return }
        editor.selectedRange = NSRange(location: (title.stringValue as NSString).length, length: 0)
        editor.drawsBackground = false
        editor.insertionPointColor = TodosLook.accent
    }

    func focusNotes(atStart: Bool = false) {
        window?.makeFirstResponder(notes)
        if atStart { notes.moveCaretToStart() }
    }

    func restoreCursor(inNotes: Bool, range: NSRange?) {
        if inNotes {
            focusNotes()
            if let range, NSMaxRange(range) <= (notes.string as NSString).length { notes.setSelectedRange(range) }
        } else {
            focusTitle()
            if let range, let editor = title.currentEditor(), NSMaxRange(range) <= (title.stringValue as NSString).length {
                editor.selectedRange = range
            }
        }
    }

    private func notesChanged(_ html: String) {
        placeholder.isHidden = !notes.string.isEmpty
        // From the text on screen: a blank last line takes up room, but isn't saved.
        Self.measured = (html, notes.bounds.width, notes.usedTextHeight)
        onNotes(html)
        // The row may have just grown or shrunk: keep the card exactly filling it.
        enclosingScrollView?.documentView?.layoutSubtreeIfNeeded()
        if let row = superview { frame = row.bounds }
        needsLayout = true
    }

    private func tick() {
        circle.setSymbolImage(
            NSImage(systemSymbolName: "checkmark.circle.fill", accessibilityDescription: "Done") ?? NSImage(),
            contentTransition: .replace)
        circle.contentTintColor = TodosLook.accent
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) { [weak self] in
            self?.onTick()
        }
    }
}

final class TodoCell: NSTableCellView {
    private let circle = TickView()
    private let marker = NSImageView()
    private let title = NSTextField(labelWithString: "")
    private let detail = NSTextField(labelWithString: "")
    private let paperclip = NSImageView()
    private let paperclipCount = NSTextField(labelWithString: "")
    private var titleLeading: NSLayoutConstraint?
    private var onTick: () -> Void = {}
    private var ticking = false

    init() {
        super.init(frame: .zero)
        circle.symbolConfiguration = .init(pointSize: 17, weight: .light)
        circle.onClick = { [weak self] in self?.tick() }
        marker.symbolConfiguration = .init(pointSize: 12, weight: .regular)
        title.font = .systemFont(ofSize: 14)
        title.lineBreakMode = .byTruncatingTail
        title.maximumNumberOfLines = 1
        title.cell?.isScrollable = true
        title.placeholderString = "New To-Do"
        title.focusRingType = .none
        title.isBezeled = false
        title.drawsBackground = false
        title.setContentHuggingPriority(.defaultLow, for: .horizontal)
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        detail.font = .systemFont(ofSize: 12)
        detail.textColor = .tertiaryLabelColor
        detail.setContentCompressionResistancePriority(.required, for: .horizontal)
        detail.setContentHuggingPriority(.required, for: .horizontal)
        paperclip.image = NSImage(systemSymbolName: "paperclip", accessibilityDescription: "Attachments")
        paperclip.symbolConfiguration = .init(pointSize: 11, weight: .regular)
        paperclip.contentTintColor = .tertiaryLabelColor
        paperclipCount.font = .systemFont(ofSize: 12)
        paperclipCount.textColor = .tertiaryLabelColor
        for view in [circle, marker, title, detail, paperclip, paperclipCount] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            circle.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            circle.centerYAnchor.constraint(equalTo: centerYAnchor),
            circle.widthAnchor.constraint(equalToConstant: 24),
            circle.heightAnchor.constraint(equalToConstant: 24),
            marker.leadingAnchor.constraint(equalTo: circle.trailingAnchor, constant: 8),
            marker.centerYAnchor.constraint(equalTo: centerYAnchor),
            marker.widthAnchor.constraint(equalToConstant: 16),
            title.centerYAnchor.constraint(equalTo: centerYAnchor),
            paperclip.leadingAnchor.constraint(greaterThanOrEqualTo: title.trailingAnchor, constant: 8),
            paperclip.centerYAnchor.constraint(equalTo: centerYAnchor),
            paperclipCount.leadingAnchor.constraint(equalTo: paperclip.trailingAnchor, constant: 2),
            paperclipCount.firstBaselineAnchor.constraint(equalTo: title.firstBaselineAnchor),
            detail.leadingAnchor.constraint(greaterThanOrEqualTo: paperclipCount.trailingAnchor, constant: 8),
            detail.firstBaselineAnchor.constraint(equalTo: title.firstBaselineAnchor),
            detail.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -28),
        ])
        titleLeading = title.leadingAnchor.constraint(equalTo: circle.trailingAnchor, constant: 8)
        titleLeading?.isActive = true
        for view in [paperclip, paperclipCount] {
            view.setContentCompressionResistancePriority(.required, for: .horizontal)
            view.setContentHuggingPriority(.required, for: .horizontal)
        }
        // The name fills the row; the row's detail stays out of its way.
        title.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -28).withPriority(.defaultLow).isActive = true
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(_ todo: Todo, detail text: String?, marker list: TodoView?, attachments: Int, onTick: @escaping () -> Void) {
        paperclip.isHidden = attachments == 0
        paperclipCount.isHidden = attachments == 0
        paperclipCount.stringValue = attachments > 0 ? "\(attachments)" : ""
        self.onTick = onTick
        marker.isHidden = list == nil
        if let list {
            marker.image = NSImage(systemSymbolName: list.symbol, accessibilityDescription: list.label)
            marker.contentTintColor = TodosLook.color(list)
        }
        titleLeading?.constant = list == nil ? 8 : 30
        ticking = false
        title.stringValue = todo.title
        title.textColor = todo.completedAt == nil ? .labelColor : .secondaryLabelColor
        showCircle(done: todo.completedAt != nil, animated: false)
        detail.stringValue = text ?? ""
        detail.isHidden = text == nil
    }

    private func showCircle(done: Bool, animated: Bool) {
        let image = NSImage(
            systemSymbolName: done ? "checkmark.circle.fill" : "circle", accessibilityDescription: done ? "Done" : "Not done")
        circle.contentTintColor = done ? TodosLook.accent : .tertiaryLabelColor
        if animated, let image {
            circle.setSymbolImage(image, contentTransition: .replace)
        } else {
            circle.image = image
        }
    }

    /// The circle fills first, then the row leaves, so you see what you did.
    private func tick() {
        guard !ticking else { return }
        ticking = true
        showCircle(done: title.textColor != .secondaryLabelColor, animated: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) { [weak self] in
            self?.onTick()
        }
    }

}

extension NSLayoutConstraint {
    fileprivate func withPriority(_ priority: NSLayoutConstraint.Priority) -> NSLayoutConstraint {
        self.priority = priority
        return self
    }
}
