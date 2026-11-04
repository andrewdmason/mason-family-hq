import AppKit

// The sidebar: the lists and projects, each a place to drop to-dos on. It never
// takes keyboard focus, so a click can't flash the accent color; keys and focus
// stay with the list.

/// What a to-do carries while it's being dragged.
extension NSPasteboard.PasteboardType {
    static let todoID = NSPasteboard.PasteboardType("io.mason.todos.todo-id")
    static let projectID = NSPasteboard.PasteboardType("io.mason.todos.project-id")
    static let sectionID = NSPasteboard.PasteboardType("io.mason.todos.section-id")
}

private enum SidebarRow: Equatable {
    case view(TodoView, count: Int)
    case area(TodoArea, count: Int)
    case project(TodoProject)
    /// Air between clusters. The rows inside a cluster sit tight, so what's close
    /// reads as belonging together: a group's projects are clearly its own.
    case spacer(CGFloat)

    var destination: Destination? {
        switch self {
        case .view(let view, _): .view(view)
        case .area, .spacer: nil
        case .project(let project): .project(project.id)
        }
    }
}

@MainActor
final class TodoSidebarController: NSViewController, NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate, NSMenuDelegate {
    /// Hands the cursor back to the list after naming something here.
    var focusList: () -> Void = {}
    private let store: TodoStore
    private let table = NSTableView()
    private var rows: [SidebarRow] = []
    private var selected: Destination?
    private var applying = false
    /// The row being typed in, by `key(of:)`.
    private var editingKey: String?
    private static let rowHeight: CGFloat = 26
    private static let listGap: CGFloat = 12
    private static let groupGap: CGFloat = 22

    init(store: TodoStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        table.addTableColumn(NSTableColumn(identifier: .init("item")))
        table.headerView = nil
        table.style = .sourceList
        table.backgroundColor = .clear
        table.refusesFirstResponder = true
        table.allowsEmptySelection = true
        table.intercellSpacing = .zero
        table.dataSource = self
        table.delegate = self
        table.registerForDraggedTypes([.todoID, .projectID])
        table.draggingDestinationFeedbackStyle = .sourceList
        table.setDraggingSourceOperationMask(.move, forLocal: true)
        table.setDraggingSourceOperationMask([], forLocal: false)
        table.target = self
        table.action = #selector(clicked)
        table.doubleAction = #selector(doubleClicked)
        let menu = NSMenu()
        menu.delegate = self
        table.menu = menu

        let scroll = NSScrollView()
        scroll.documentView = table
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.automaticallyAdjustsContentInsets = true
        view = scroll
        follow()
    }

    /// Redraw when a count, a project, a group or the current list changes.
    private func follow() {
        let (new, destination, editing) = withObservationTracking {
            var rows: [SidebarRow] = []
            for view in TodoView.allCases {
                // The Inbox and the Logbook each stand a little apart from the rest.
                if view == .today || view == .logbook { rows.append(.spacer(Self.listGap)) }
                rows.append(.view(view, count: store.count(view) ?? 0))
            }
            for area in store.orderedAreas {
                let projects = store.projects(in: area.id)
                rows.append(.spacer(Self.groupGap))
                rows.append(.area(area, count: projects.count))
                if area.isCollapsed != true { rows += projects.map { .project($0) } }
            }
            var editing = store.namingAreaID.map { "area-" + $0 }
            if store.isRenamingInSidebar, let id = store.renamingProjectID { editing = "project-" + id }
            return (rows, store.destination, editing)
        } onChange: { [weak self] in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.follow() } }
        }
        applying = true
        defer { applying = false }
        // Naming ended: put the row back to plain text.
        let finished = editingKey == editing ? nil : editingKey
        if finished != nil, view.window?.firstResponder is NSText {
            view.window?.makeFirstResponder(nil)
            focusList()
        }
        editingKey = editing

        if new.count != rows.count || destination != selected {
            rows = new
            selected = destination
            table.reloadData()
        } else {
            // Row by row, leaving alone the one being typed in.
            var changed = IndexSet()
            for index in new.indices where new[index] != rows[index] || key(of: new[index]) == finished {
                if key(of: new[index]) != editing || editing == nil { changed.insert(index) }
            }
            rows = new
            if !changed.isEmpty { table.reloadData(forRowIndexes: changed, columnIndexes: [0]) }
        }
        syncSelection()
        if let editing, let row = rows.firstIndex(where: { key(of: $0) == editing }) {
            let cell = table.view(atColumn: 0, row: row, makeIfNecessary: true) as? SidebarCell
            cell?.showEditing(delegate: self)
        }
    }

    /// The current list's row, or none if its group is collapsed.
    private func syncSelection() {
        let row = rows.firstIndex { $0.destination == store.destination }
        if let row {
            if table.selectedRow != row { table.selectRowIndexes([row], byExtendingSelection: false) }
        } else if table.selectedRow != -1 {
            table.deselectAll(nil)
        }
    }

    private func projectID(_ row: SidebarRow) -> String? {
        if case .project(let project) = row { project.id } else { nil }
    }

    private func areaID(_ row: SidebarRow) -> String? {
        if case .area(let area, _) = row { area.id } else { nil }
    }

    private func key(of row: SidebarRow) -> String? {
        if let id = projectID(row) { return "project-" + id }
        return areaID(row).map { "area-" + $0 }
    }

    // MARK: Clicking

    /// A click on a group's name folds it.
    @objc private func clicked() {
        guard rows.indices.contains(table.clickedRow), let id = areaID(rows[table.clickedRow]),
            key(of: rows[table.clickedRow]) != editingKey
        else { return }
        store.toggleArea(id)
    }

    @objc private func doubleClicked() {
        guard rows.indices.contains(table.clickedRow), let id = projectID(rows[table.clickedRow]) else { return }
        store.go(.project(id))
        store.startRenamingProject(inSidebar: true)
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let store = store
        if rows.indices.contains(table.clickedRow), let id = areaID(rows[table.clickedRow]) {
            menu.addItem(ClosureMenuItem(title: "Rename") { store.startRenamingArea(id) })
            if store.areas.count > 1 {
                menu.addItem(ClosureMenuItem(title: "Delete Group") { store.deleteArea(id) })
            }
            menu.addItem(.separator())
        }
        menu.addItem(ClosureMenuItem(title: "New Project Group") { store.startNewArea() })
    }

    // MARK: Typing a name

    func controlTextDidChange(_ notification: Notification) {
        guard let field = notification.object as? NSTextField else { return }
        if store.namingAreaID != nil {
            store.areaDraft = field.stringValue
        } else {
            store.updateProjectName(field.stringValue)
        }
    }

    func controlTextDidEndEditing(_ notification: Notification) {
        // Clicking away keeps the name, as Return does.
        if applying { return }
        store.finishNamingArea()
        store.finishRenamingProject()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            store.finishNamingArea()
            store.finishRenamingProject()
        case #selector(NSResponder.cancelOperation(_:)):
            store.cancelNamingArea()
            store.cancelRenamingProject()
        default:
            return false
        }
        return true
    }

    // MARK: Table

    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
        if case .spacer(let height) = rows[row] { height } else { Self.rowHeight }
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        SidebarRowView()
    }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
        rows[row].destination != nil
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cell =
            tableView.makeView(withIdentifier: .init("sidebar"), owner: nil) as? SidebarCell ?? {
                let made = SidebarCell()
                made.identifier = .init("sidebar")
                return made
            }()
        switch rows[row] {
        case .view(let view, let count):
            cell.show(
                view.label, symbol: view.symbol, tint: TodosLook.color(view), badge: count > 0 ? "\(count)" : "")
        case .project(let project):
            let name = project.name.isEmpty ? "New Project" : project.name
            cell.show(name, symbol: "folder", tint: .tertiaryLabelColor, badge: "", symbolSize: 13)
        case .area(let area, let count):
            // Collapsed, it says how many projects are inside.
            cell.show(
                area.name, symbol: "shippingbox", tint: .secondaryLabelColor,
                badge: area.isCollapsed == true ? "\(count)" : "", heading: true, placeholder: "New Group")
        case .spacer:
            return nil
        }
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard !applying else { return }
        guard table.selectedRow >= 0, let destination = rows[table.selectedRow].destination else {
            // A click on empty space: the current list stays highlighted.
            applying = true
            syncSelection()
            applying = false
            return
        }
        store.go(destination)
    }

    // MARK: Reordering projects

    func tableView(_ tableView: NSTableView, pasteboardWriterForRow row: Int) -> NSPasteboardWriting? {
        guard let id = projectID(rows[row]), key(of: rows[row]) != editingKey else { return nil }
        let item = NSPasteboardItem()
        item.setString(id, forType: .projectID)
        return item
    }

    private var firstAreaRow: Int? {
        rows.firstIndex { areaID($0) != nil }
    }

    /// A group's name takes the project whole; otherwise, the gap nearest the
    /// pointer, somewhere below the first group's name.
    private func validateReorder(_ info: NSDraggingInfo) -> NSDragOperation {
        guard let first = firstAreaRow else { return [] }
        let point = table.convert(info.draggingLocation, from: nil)
        let hovered = table.row(at: point)
        if rows.indices.contains(hovered), areaID(rows[hovered]) != nil {
            table.setDropRow(hovered, dropOperation: .on)
            return .move
        }
        var gap = rows.count
        if hovered >= 0 {
            gap = point.y < table.rect(ofRow: hovered).midY ? hovered : hovered + 1
        }
        table.setDropRow(max(gap, first + 1), dropOperation: .above)
        return .move
    }

    private func dropProject(_ id: String, row: Int, operation: NSTableView.DropOperation) -> Bool {
        if operation == .on {
            guard rows.indices.contains(row), let area = areaID(rows[row]) else { return false }
            store.moveProject(id, toArea: area, index: store.projects(in: area).count)
            return true
        }
        // The group is the nearest name above the gap; the place is how many of
        // its other projects come before the gap.
        var index = 0
        for above in stride(from: row - 1, through: 0, by: -1) {
            if let area = areaID(rows[above]) {
                store.moveProject(id, toArea: area, index: index)
                return true
            }
            if let other = projectID(rows[above]), other != id { index += 1 }
        }
        return false
    }

    // MARK: Dropping

    func tableView(
        _ tableView: NSTableView, validateDrop info: NSDraggingInfo, proposedRow row: Int,
        proposedDropOperation dropOperation: NSTableView.DropOperation
    ) -> NSDragOperation {
        if info.draggingPasteboard.types?.contains(.projectID) == true { return validateReorder(info) }
        // Go by the row actually under the pointer. The table's own proposal means
        // "between rows" near an edge, naming the row below, so the lower part of
        // Today would otherwise target This Week.
        let point = tableView.convert(info.draggingLocation, from: nil)
        let hovered = tableView.row(at: point)
        guard hovered >= 0, hovered < rows.count, let destination = rows[hovered].destination, accepts(destination)
        else { return [] }
        tableView.setDropRow(hovered, dropOperation: .on)
        return .move
    }

    /// Everywhere but where they already are. Delegated asks who to, and
    /// assigning stays on the website for now.
    private func accepts(_ destination: Destination) -> Bool {
        destination != store.destination && destination != .view(.delegated)
    }

    func tableView(
        _ tableView: NSTableView, acceptDrop info: NSDraggingInfo, row: Int,
        dropOperation: NSTableView.DropOperation
    ) -> Bool {
        if let id = info.draggingPasteboard.string(forType: .projectID) {
            return dropProject(id, row: row, operation: dropOperation)
        }
        guard row < rows.count, let destination = rows[row].destination else { return false }
        let ids = Set(info.draggingPasteboard.pasteboardItems?.compactMap { $0.string(forType: .todoID) } ?? [])
        guard !ids.isEmpty else { return false }
        if destination == .view(.snoozed) {
            let point = NSEvent.mouseLocation
            // After the drag has finished, or the menu closes along with it.
            DispatchQueue.main.async { [weak self] in self?.askWhenToWake(ids, at: point) }
        } else {
            store.file(ids, to: destination)
        }
        return true
    }

    private func askWhenToWake(_ ids: Set<String>, at point: NSPoint) {
        let store = store
        let snooze: (Date) -> Void = { date in
            store.select(ids)
            store.snoozeSelected(until: date)
        }
        let menu = NSMenu()
        menu.items = [
            ClosureMenuItem(title: "Tomorrow") { snooze(TodoStore.tomorrow()) },
            ClosureMenuItem(title: "This Weekend") { snooze(TodoStore.thisWeekend()) },
            ClosureMenuItem(title: "Next Week") { snooze(TodoStore.startOfNextWeek()) },
        ]
        menu.popUp(positioning: nil, at: point, in: nil)
    }
}

/// Stays the quiet gray even while a name is typed in the row, which would
/// otherwise turn it the accent color.
final class SidebarRowView: NSTableRowView {
    override var isEmphasized: Bool {
        get { false }
        set {}
    }
}

final class SidebarCell: NSTableCellView {
    private let icon = NSImageView()
    private let title = NSTextField(labelWithString: "")
    private let badge = NSTextField(labelWithString: "")

    init() {
        super.init(frame: .zero)
        icon.symbolConfiguration = .init(pointSize: 15, weight: .regular)
        icon.imageScaling = .scaleProportionallyDown
        title.lineBreakMode = .byTruncatingTail
        title.isBezeled = false
        title.drawsBackground = false
        title.focusRingType = .none
        title.cell?.isScrollable = true
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        title.setContentHuggingPriority(.defaultLow, for: .horizontal)
        badge.font = .systemFont(ofSize: 12)
        badge.textColor = .secondaryLabelColor
        badge.setContentHuggingPriority(.required, for: .horizontal)
        for view in [icon, title, badge] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 2),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 22),
            title.centerYAnchor.constraint(equalTo: centerYAnchor),
            badge.leadingAnchor.constraint(greaterThanOrEqualTo: title.trailingAnchor, constant: 6),
            badge.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            badge.firstBaselineAnchor.constraint(equalTo: title.firstBaselineAnchor),
        ])
        title.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 7).isActive = true
        // Room to type a longer name while renaming.
        let fill = title.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6)
        fill.priority = .defaultLow
        fill.isActive = true
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(
        _ text: String, symbol: String, tint: NSColor, badge count: String, heading: Bool = false,
        symbolSize: CGFloat = 15, placeholder: String? = nil
    ) {
        title.isEditable = false
        title.delegate = nil
        title.stringValue = text
        // Only a group's name is bold. The highlight alone marks what's selected.
        title.font = .systemFont(ofSize: 13.5, weight: heading ? .semibold : .regular)
        icon.symbolConfiguration = .init(pointSize: symbolSize, weight: heading ? .medium : .regular)
        title.textColor = .labelColor
        title.placeholderString = placeholder
        icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        icon.contentTintColor = tint
        badge.stringValue = count
    }

    /// The whole name selected, ready to type over, as in Finder.
    func showEditing(delegate: NSTextFieldDelegate) {
        guard title.currentEditor() == nil else { return }
        title.isEditable = true
        title.delegate = delegate
        window?.makeFirstResponder(title)
        guard let editor = title.currentEditor() as? NSTextView else { return }
        editor.selectAll(nil)
        editor.drawsBackground = false
        editor.insertionPointColor = TodosLook.accent
    }
}
