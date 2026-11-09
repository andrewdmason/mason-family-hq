import AppKit
import Carbon.HIToolbox
import Foundation

// A scripted run through the things the website gets wrong: type the moment the
// app opens, keep typing while the list changes underneath, then move around
// quickly. Real key events go through the same path as your fingers. Launch with
// `--feel-test <rows> <results file> [dark]`; it never touches the saved list.

@MainActor
struct FeelTest {
    let rows: Int
    let results: URL

    static func fromArguments() -> FeelTest? {
        let arguments = CommandLine.arguments
        guard let at = arguments.firstIndex(of: "--feel-test"), arguments.count > at + 2,
            let rows = Int(arguments[at + 1])
        else { return nil }
        return FeelTest(rows: rows, results: URL(filePath: arguments[at + 2]))
    }

    /// Fills Anytime out to the size under test with made-up rows.
    func padded(_ library: TodoLibrary) -> TodoLibrary {
        var library = library
        let open = library.tasks.filter { $0.completedAt == nil }.count
        for index in 0..<max(0, rows - open) {
            library.tasks.append(Todo(
                id: "padding-\(index)", title: "Made-up to-do number \(index)", notes: nil, bucket: .anytime,
                assigneeEmail: "andrew@mason.io", creatorEmail: "andrew@mason.io", projectId: nil,
                sectionId: nil, snoozedUntil: nil, completedAt: nil, sortOrder: Double(10_000 + index),
                createdAt: "2026-01-01T00:00:00Z"))
        }
        return library
    }

    func run(model: AppModel, launchMilliseconds: Double) async {
        NSApp.activate(ignoringOtherApps: true)
        let dark = CommandLine.arguments.contains("dark")
        if dark { NSApp.appearance = NSAppearance(named: .darkAqua) }
        let store = model.store
        var found: NSWindow?
        for _ in 0..<200 where found == nil {
            found = NSApp.windows.first { $0.isVisible && $0.contentView != nil }
            try? await Task.sleep(for: .milliseconds(10))
        }
        guard let window = found else {
            fputs("feel test: no window\n", stderr)
            NSApp.terminate(nil)
            return
        }
        window.makeKeyAndOrderFront(nil)
        var times: [Double] = []
        model.keys.measured = { times.append($0) }
        var report: [String: Any] = [
            "rows": store.todos.filter { $0.completedAt == nil }.count,
            "opened_ms": launchMilliseconds,
        ]

        if CommandLine.arguments.contains("signintest") {
            // Starts the real sign-in sheet, then cancels it. Reaches no account.
            try? await Task.sleep(for: .seconds(1))
            var log = ["before \(model.sync.map { "\($0.status)" } ?? "no sync")"]
            model.sync?.signIn()
            try? await Task.sleep(for: .seconds(4))
            log.append("4s after starting \(model.sync.map { "\($0.status)" } ?? "no sync"), ended early: \(model.sync?.signInEnded ?? "no, still open")")
            model.sync?.cancelSignIn()
            try? await Task.sleep(for: .seconds(2))
            log.append("after cancelling \(model.sync.map { "\($0.status)" } ?? "no sync"), ended: \(model.sync?.signInEnded ?? "-")")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("syncstatus") {
            try? await Task.sleep(for: .seconds(2))
            capture(window, "sync-signedout")
            try? "status \(model.sync.map { "\($0.status)" } ?? "no sync")\n".write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("preview") {
            // What the first sync would do, from saved copies, sending nothing.
            let at = CommandLine.arguments.firstIndex(of: "preview")!
            func file(_ offset: Int) -> Data { (try? Data(contentsOf: URL(filePath: CommandLine.arguments[at + offset]))) ?? Data() }
            struct Server: Decodable {
                let tasks: [ServerTodo]
                let projects: [TodoProject]
                let sections: [TodoSection]
                let areas: [TodoArea]
            }
            var log: [String] = []
            do {
                let server = try TodoMerge.decoder().decode(Server.self, from: file(1))
                var base = try TodoStore.decode(file(2))
                let seed = base
                let serverLibrary = TodoLibrary(
                    tasks: server.tasks.map(\.todo), projects: server.projects, sections: server.sections, areas: server.areas)
                log.append("LOCAL \(store.todos.count) to-dos, \(store.todos.filter { $0.completedAt == nil }.count) open, \(store.projects.count) projects, \(store.sections.count) sections, \(store.areas.count) groups")
                log.append("SERVER \(server.tasks.count) to-dos, \(server.projects.count) projects, \(server.sections.count) sections, \(server.areas.count) groups")
                store.prepareFirstSync(server: serverLibrary, base: &base)
                let pending = store.pendingChanges(against: base)
                let title = { (id: String) in serverLibrary.tasks.first { $0.id == id }?.title ?? id }
                func line(_ name: String, _ c: SyncChanges) -> String {
                    "\(name): add \(c.inserts.count), update \(c.updates.count), delete \(c.deletes.count)"
                }
                log.append("SEND \(line("to-dos", pending.tasks))")
                log.append("SEND \(line("projects", pending.projects))")
                log.append("SEND \(line("sections", pending.sections))")
                log.append("SEND \(line("groups", pending.areas))")
                var fields: [String: Int] = [:]
                for (_, changed) in pending.tasks.updates { for key in changed.keys { fields[key, default: 0] += 1 } }
                log.append("UPDATED FIELDS \(fields.sorted { $0.key < $1.key })")
                log.append("REMOVED TITLES \(pending.tasks.deletes.map(title))")
                log.append("GROUPS REMOVED \(pending.areas.deletes.map { id in serverLibrary.areas?.first { $0.id == id }?.name ?? id })")
                let seen = Set(seed.tasks.map(\.id))
                let mine = Set(store.todos.map(\.id))
                let arriving = server.tasks.filter { !seen.contains($0.id) && !mine.contains($0.id) }
                let openArriving = arriving.filter { $0.completedAt == nil }
                log.append("ARRIVING \(arriving.count): completed \(arriving.count - openArriving.count), open \(openArriving.map { "\($0.assigneeEmail.prefix(6)): \($0.title)" })")
                log.append("ARRIVING BY PERSON \(Dictionary(grouping: arriving, by: \.assigneeEmail).mapValues(\.count))")
                // As if everything sent had landed, then read back.
                var sent = base
                for todo in store.todos { TodoMerge.markSent(todo.id, fields: todo.syncFields, local: store.todos, base: &sent.tasks) }
                sent.tasks.removeAll { pending.tasks.deletes.contains($0.id) }
                log.append("MAC ENDS WITH \(store.todos.count + arriving.count) to-dos, \(store.todos.filter { $0.notes != nil }.count) with notes")
            } catch {
                log.append("FAILED \(error)")
            }
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("hotkey") {
            var log = ["register status \(model.quickAdd.registerHotKey())"]
            var event: EventRef?
            CreateEvent(nil, OSType(kEventClassKeyboard), UInt32(kEventHotKeyPressed), 0, EventAttributes(kEventAttributeNone), &event)
            log.append("sent press status \(SendEventToEventTarget(event, GetEventDispatcherTarget()))")
            try? await Task.sleep(for: .milliseconds(400))
            let panel = model.quickAdd.window
            log.append("bar visible \(panel.isVisible), key \(panel.isKeyWindow), in field \(panel.firstResponder is NSText)")
            model.quickAdd.toggle()
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("quickhidden") {
            let panel = model.quickAdd.window
            NSApp.hide(nil)
            try? await Task.sleep(for: .milliseconds(400))
            var log = ["hidden: app hidden \(NSApp.isHidden), window visible \(window.isVisible)"]
            model.quickAdd.toggle()
            try? await Task.sleep(for: .milliseconds(400))
            log.append("open: app hidden \(NSApp.isHidden), window visible \(window.isVisible), bar visible \(panel.isVisible), key \(panel.isKeyWindow), in field \(panel.firstResponder is NSText)")
            model.quickAdd.toggle()
            try? await Task.sleep(for: .milliseconds(400))
            log.append("closed: app hidden \(NSApp.isHidden), window visible \(window.isVisible), bar visible \(panel.isVisible)")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("sections") {
            func press(_ text: String, _ code: UInt16, command: Bool = false) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: command ? .command : [],
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(90))
            }
            func type(_ text: String) async {
                for letter in text { await press(String(letter), 0) }
            }
            func tables(_ view: NSView?) -> [NSTableView] {
                guard let view else { return [] }
                return ((view as? NSTableView).map { [$0] } ?? []) + view.subviews.flatMap { tables($0) }
            }
            func outline() -> String {
                store.groups.map { "\($0.name ?? "loose") \($0.todos.count)" }.joined(separator: " | ")
            }
            guard let table = tables(window.contentView).first(where: { $0.dataSource is TodoTableCoordinator }),
                let project = store.projects.first(where: { p in store.todos.filter { $0.projectId == p.id && $0.completedAt == nil }.count >= 8 })
            else { return }
            var log: [String] = []
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(300))
            // Two sections to work with, each with to-dos.
            for (index, name) in ["First", "Second"].enumerated() {
                store.selectedID = store.visible[index * 3 + 1].id
                try? await Task.sleep(for: .milliseconds(150))
                store.startNewSection()
                try? await Task.sleep(for: .milliseconds(250))
                await type(name)
                await press("\r", 36)
                try? await Task.sleep(for: .milliseconds(250))
            }
            log.append("start \(outline())")
            guard let first = store.sections.first(where: { $0.name == "First" && $0.projectId == project.id }) else { return }
            if let row = store.listRows.firstIndex(where: { $0.id == "group-" + first.id }) {
                let rect = table.rect(ofRow: row)
                let point = table.convert(NSPoint(x: rect.minX + 60, y: rect.midY), to: nil)
                for count in [1, 2] {
                    for kind in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                        let click = NSEvent.mouseEvent(
                            with: kind, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                            windowNumber: window.windowNumber, context: nil, eventNumber: count, clickCount: count, pressure: 1)
                        if let click { NSApp.postEvent(click, atStart: false) }
                        try? await Task.sleep(for: .milliseconds(30))
                    }
                }
            }
            try? await Task.sleep(for: .milliseconds(400))
            log.append("double click heading -> naming \(store.namingSectionID == first.id), in field \(window.firstResponder is NSText), selected all \((window.firstResponder as? NSTextView)?.selectedRange().length ?? -1)")
            await type("Renamed")
            capture(window, "section-rename")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(250))
            log.append("return -> \(outline()), list focused \(window.firstResponder is NSTableView)")
            await press("z", 6, command: true)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("undo -> \(outline())")
            store.startRenamingSection(first.id)
            try? await Task.sleep(for: .milliseconds(250))
            await type("Oops")
            await press("\u{1B}", 53)
            try? await Task.sleep(for: .milliseconds(250))
            log.append("esc -> \(outline()), list focused \(window.firstResponder is NSTableView)")
            store.startRenamingSection(first.id)
            try? await Task.sleep(for: .milliseconds(250))
            await press("\u{7F}", 51)
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(250))
            log.append("cleared, return -> \(outline())")
            if let second = store.sections.first(where: { $0.name == "Second" && $0.projectId == project.id }) {
                store.moveSection(second.id, before: first.id)
                try? await Task.sleep(for: .milliseconds(300))
                log.append("second above first -> \(outline())")
                capture(window, "section-moved")
                store.undo()
                try? await Task.sleep(for: .milliseconds(200))
                log.append("undo -> \(outline())")
                store.moveSection(first.id, before: nil)
                log.append("first to the end -> \(outline())")
                store.undo()
                let before = store.groups.first { $0.id == first.id }?.todos.map(\.id) ?? []
                store.deleteSection(second.id)
                try? await Task.sleep(for: .milliseconds(300))
                let heir = store.groups.first { $0.id == first.id }?.todos.map(\.id) ?? []
                log.append("delete second -> \(outline()), first's to-dos kept their place \(Array(heir.prefix(before.count)) == before)")
                store.undo()
                try? await Task.sleep(for: .milliseconds(200))
                log.append("undo -> \(outline())")
                store.deleteSection(first.id)
                try? await Task.sleep(for: .milliseconds(200))
                log.append("delete first -> \(outline())")
            }
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("expand") {
            func tables(_ view: NSView?) -> [NSTableView] {
                guard let view else { return [] }
                return ((view as? NSTableView).map { [$0] } ?? []) + view.subviews.flatMap { tables($0) }
            }
            guard let table = tables(window.contentView).first(where: { $0.dataSource is TodoTableCoordinator }),
                let project = store.projects.first(where: { p in store.todos.filter { $0.projectId == p.id && $0.completedAt == nil }.count >= 5 })
            else { return }
            func click(_ point: NSPoint, count: Int = 1) async {
                for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                    let event = NSEvent.mouseEvent(
                        with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                        windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: count, pressure: 1)
                    if let event { NSApp.postEvent(event, atStart: false) }
                    try? await Task.sleep(for: .milliseconds(40))
                }
            }
            func fit(_ id: String) -> String {
                guard let row = store.listRows.firstIndex(where: { $0.id == id }),
                    let cell = table.view(atColumn: 0, row: row, makeIfNecessary: false)
                else { return "no cell" }
                return "row \(Int(table.rect(ofRow: row).height)), cell \(Int(cell.frame.height)) at y \(Int(cell.frame.minY))"
            }
            var log: [String] = []
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(400))
            let first = store.visible[0]
            let second = store.visible[1]
            let fourth = store.visible[3]
            store.selectedID = first.id
            try? await Task.sleep(for: .milliseconds(200))
            log.append("closed: \(fit(first.id))")
            store.openSelected()
            try? await Task.sleep(for: .milliseconds(800))
            log.append("open: \(fit(first.id))")
            capture(window, "expand-open")
            if let row = store.listRows.firstIndex(where: { $0.id == fourth.id }) {
                let rect = table.rect(ofRow: row)
                await click(table.convert(NSPoint(x: rect.midX, y: rect.midY), to: nil))
            }
            try? await Task.sleep(for: .milliseconds(800))
            log.append("clicked away: open \(store.openID != nil), selected fourth \(store.selectedID == fourth.id), \(fit(first.id))")
            capture(window, "expand-closed")
            store.selectedID = first.id
            try? await Task.sleep(for: .milliseconds(150))
            store.openSelected()
            try? await Task.sleep(for: .milliseconds(500))
            store.closeOpen()
            try? await Task.sleep(for: .milliseconds(500))
            log.append("open, esc: \(fit(first.id))")
            if let row = store.listRows.firstIndex(where: { $0.id == second.id }) {
                let rect = table.rect(ofRow: row)
                let point = table.convert(NSPoint(x: rect.minX + 36, y: rect.midY), to: nil)
                let root = window.contentView?.superview ?? window.contentView
                let hit = root?.hitTest(root?.superview?.convert(point, from: nil) ?? point)
                log.append("circle spot: window point \(point), table row rect \(rect), hit \(hit.map { String(describing: type(of: $0)) } ?? "nil")")
                await click(point)
            }
            try? await Task.sleep(for: .milliseconds(700))
            log.append("click a circle: done \(store.todos.first { $0.id == second.id }?.completedAt != nil)")
            store.selectedID = first.id
            try? await Task.sleep(for: .milliseconds(150))
            store.openSelected()
            try? await Task.sleep(for: .milliseconds(500))
            if let row = store.listRows.firstIndex(where: { $0.id == first.id }) {
                let rect = table.rect(ofRow: row)
                await click(table.convert(NSPoint(x: rect.minX + 36, y: rect.minY + 30), to: nil))
            }
            try? await Task.sleep(for: .milliseconds(700))
            log.append("click the card's circle: done \(store.todos.first { $0.id == first.id }?.completedAt != nil), open \(store.openID != nil)")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("areas") {
            func press(_ text: String, _ code: UInt16) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: [],
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(80))
            }
            func type(_ text: String) async {
                for letter in text { await press(String(letter), 0) }
            }
            func tables(_ view: NSView?) -> [NSTableView] {
                guard let view else { return [] }
                return ((view as? NSTableView).map { [$0] } ?? []) + view.subviews.flatMap { tables($0) }
            }
            func outline() -> String {
                store.orderedAreas.map { area in
                    "\(area.name)\(area.isCollapsed == true ? " (collapsed)" : "") [\(store.projects(in: area.id).map(\.name).joined(separator: ", "))]"
                }.joined(separator: " | ")
            }
            var log = ["start \(outline())"]
            guard let side = tables(window.contentView).first(where: { !($0.dataSource is TodoTableCoordinator) }),
                store.projects.count >= 3
            else { return }
            store.startNewArea()
            try? await Task.sleep(for: .milliseconds(300))
            log.append("new group: naming \(store.namingAreaID != nil), in field \(window.firstResponder is NSText)")
            await type("Active")
            capture(window, "areas-naming")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(300))
            log.append("return -> \(outline()), naming \(store.namingAreaID != nil), list focused \(window.firstResponder === tables(window.contentView).first { $0.dataSource is TodoTableCoordinator })")
            guard let active = store.orderedAreas.last else { return }
            for project in store.orderedProjects.prefix(2) {
                store.moveProject(project.id, toArea: active.id, index: 0)
            }
            try? await Task.sleep(for: .milliseconds(300))
            log.append("moved two -> \(outline())")
            capture(window, "areas-two")
            let row = side.numberOfRows - 3  // The new group's name, above its two projects.
            let frame = side.rect(ofRow: row)
            let point = side.convert(NSPoint(x: frame.midX, y: frame.midY), to: nil)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                let click = NSEvent.mouseEvent(
                    with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                    windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1)
                if let click { NSApp.postEvent(click, atStart: false) }
                try? await Task.sleep(for: .milliseconds(30))
            }
            try? await Task.sleep(for: .milliseconds(300))
            log.append("click its name -> \(outline()), rows \(side.numberOfRows)")
            capture(window, "areas-collapsed")
            let hidden = store.projects(in: active.id)[0]
            store.go(.project(hidden.id))
            try? await Task.sleep(for: .milliseconds(300))
            log.append("go to a project inside -> \(outline())")
            store.startRenamingArea(active.id)
            try? await Task.sleep(for: .milliseconds(300))
            await type("Nope")
            await press("\u{1B}", 53)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("rename, esc -> \(store.areas.first { $0.id == active.id }?.name ?? "-")")
            store.startRenamingArea(active.id)
            try? await Task.sleep(for: .milliseconds(300))
            await type("Current")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("rename, return -> \(store.areas.first { $0.id == active.id }?.name ?? "-")")
            store.startNewArea()
            try? await Task.sleep(for: .milliseconds(300))
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("blank new group -> groups \(store.areas.count)")
            store.deleteArea(active.id)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("delete group -> \(outline())")
            store.deleteArea(store.areas[0].id)
            log.append("delete the last one -> groups \(store.areas.count)")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("marker") {
            guard let project = store.projects.first(where: { p in store.todos.filter { $0.projectId == p.id && $0.completedAt == nil }.count >= 4 }) else { return }
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(300))
            let rows = store.visible
            store.file([rows[0].id], to: .view(.today))
            store.file([rows[1].id], to: .view(.week))
            store.select([rows[2].id])
            store.snoozeSelected(until: TodoStore.startOfNextWeek().addingTimeInterval(86_400))
            store.selectedID = rows[3].id
            try? await Task.sleep(for: .milliseconds(300))
            capture(window, "marker")
            let log = rows.prefix(4).map { todo in
                "\(store.marker(for: store.todos.first { $0.id == todo.id }!)?.rawValue ?? "none")"
            }.joined(separator: ", ")
            try? (log + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("palette") {
            let palette = model.palette
            let panel = palette.window
            func press(_ text: String, _ code: UInt16, flags: NSEvent.ModifierFlags = [], to target: NSWindow) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: flags,
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: target.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(90))
            }
            func type(_ text: String) async {
                for letter in text { await press(String(letter), 0, to: panel) }
            }
            func k() async {
                await press("k", 40, flags: [.command], to: window)
                try? await Task.sleep(for: .milliseconds(200))
            }
            var log: [String] = []
            guard let project = store.projects.first(where: { p in store.todos.filter { $0.projectId == p.id && $0.completedAt == nil }.count >= 5 }),
                let other = store.projects.first(where: { $0.id != project.id })
            else { return }
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(300))
            let target = store.visible[1]
            store.selectedID = target.id
            try? await Task.sleep(for: .milliseconds(150))
            func spot() -> String {
                let t = store.todos.first { $0.id == target.id }
                return "\(t?.bucket.rawValue ?? "-"), in \(store.projects.first { $0.id == t?.projectId }?.name ?? "no project"), snoozed \(t?.snoozedUntil != nil), done \(t?.completedAt != nil)"
            }
            await k()
            log.append("open: shown \(palette.isShown), key \(panel.isKeyWindow), context '\(palette.contextText.prefix(20))'")
            log.append("first 7: \(palette.rowTitles.prefix(7))")
            capture(panel, "palette-root")
            await press("\t", 48, to: panel)
            log.append("tab on Complete (does nothing): shown \(palette.isShown), \(spot())")
            await type("sno")
            log.append("sno -> selected \(palette.selectedTitle ?? "-")")
            await press("\t", 48, to: panel)
            log.append("tab -> snooze list \(palette.rowTitles)")
            await type("tom 3pm")
            try? await Task.sleep(for: .milliseconds(100))
            log.append("tom 3pm -> \(palette.rowTitles)")
            capture(panel, "palette-snooze")
            log.append("  before return: shown \(palette.isShown), panel key \(panel.isKeyWindow), app active \(NSApp.isActive), selected \(palette.selectedTitle ?? "-")")
            await press("\r", 36, to: panel)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("return -> shown \(palette.isShown), main key \(window.isKeyWindow), \(spot())")
            store.undo()
            try? await Task.sleep(for: .milliseconds(200))
            store.selectedID = target.id
            await k()
            await type("mo")
            await press("\r", 36, to: panel)
            log.append("mo return -> move list \(palette.rowTitles.prefix(4))")
            await type("some")
            log.append("  some: rows \(palette.rowTitles), shown \(palette.isShown), panel key \(panel.isKeyWindow), app active \(NSApp.isActive)")
            await press("\r", 36, to: panel)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("some return -> \(spot())")
            store.undo()
            try? await Task.sleep(for: .milliseconds(200))
            store.selectedID = target.id
            await k()
            await type(String(other.name.prefix(4)).lowercased())
            log.append("typed project -> \(palette.rowTitles.prefix(3))")
            capture(panel, "palette-project")
            await press("\r", 36, to: panel)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("return -> \(spot())")
            store.undo()
            try? await Task.sleep(for: .milliseconds(200))
            await k()
            await press("\t", 48, to: panel)
            await type("mo")
            await press("\t", 48, to: panel)
            log.append("in move list -> \(palette.rowTitles.first ?? "-")")
            await press("\u{1B}", 53, to: panel)
            log.append("esc -> back to root, shown \(palette.isShown), first \(palette.rowTitles.first ?? "-")")
            await press("\u{1B}", 53, to: panel)
            try? await Task.sleep(for: .milliseconds(150))
            log.append("esc again -> shown \(palette.isShown), main key \(window.isKeyWindow)")
            store.selectedID = target.id
            store.select(Set(store.visible.prefix(3).map(\.id)))
            await k()
            log.append("3 selected: context '\(palette.contextText)', Open offered \(palette.rowTitles.contains("Open"))")
            await press("\u{1B}", 53, to: panel)
            try? await Task.sleep(for: .milliseconds(150))
            store.selectedID = nil
            await k()
            log.append("none selected: first \(palette.rowTitles.prefix(2)), last \(palette.rowTitles.suffix(3))")
            await press("\u{1B}", 53, to: panel)
            try? await Task.sleep(for: .milliseconds(150))
            store.selectedID = target.id
            try? await Task.sleep(for: .milliseconds(150))
            await press("\r", 36, to: window)
            try? await Task.sleep(for: .milliseconds(300))
            await press("\t", 48, to: window)
            for letter in "hello" { await press(String(letter), 0, to: window) }
            await k()
            log.append("in card: palette shown \(palette.isShown), card open \(store.openID != nil), typed notes '\(store.openNotes)', selected \(store.selectedIDs.count), rows \(palette.rowTitles.prefix(3))")
            await type("sno")
            log.append("  sno -> \(palette.rowTitles.prefix(3)), selected row \(palette.selectedTitle ?? "-")")
            await press("\r", 36, to: panel)
            log.append("  return -> \(palette.rowTitles.prefix(3)), shown \(palette.isShown)")
            await press("\r", 36, to: panel)
            log.append("  return -> shown \(palette.isShown), \(spot())")
            try? await Task.sleep(for: .milliseconds(400))
            log.append("snoozed from card: open \(store.openID == target.id), notes saved \(store.todos.first { $0.id == target.id }?.notes ?? "-"), in notes \(window.firstResponder is DetailNotesView), \(spot())")
            await press("\u{1B}", 53, to: window)
            try? await Task.sleep(for: .milliseconds(200))
            for q in ["tom", "fri", "next week", "in 3 days", "jun 24", "6/24", "25", "tom 10am", "tonight", "3pm", "fri eve", "xyz"] {
                log.append("  '\(q)' -> \(SnoozeSuggest.suggestions(for: q).map { "\($0.label) \($0.hint)" })")
            }
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("detail") {
            func press(_ text: String, _ code: UInt16, flags: NSEvent.ModifierFlags = []) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: flags,
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(70))
            }
            func type(_ text: String) async {
                for letter in text { await press(String(letter), 0) }
            }
            var log: [String] = []
            guard let project = store.projects.first(where: { p in store.todos.filter { $0.projectId == p.id && $0.completedAt == nil }.count >= 5 }) else { return }
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(300))
            let target = store.visible[1]
            store.selectedID = target.id
            try? await Task.sleep(for: .milliseconds(150))
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(300))
            log.append("return -> open \(store.openID == target.id), in title \(!(window.firstResponder is DetailNotesView) && window.firstResponder is NSText)")
            await type(" two")
            await press("\t", 48)
            log.append("tab -> in notes \(window.firstResponder is DetailNotesView)")
            await type("first line")
            await press("\r", 36)
            log.append("return in notes -> still open \(store.openID != nil)")
            await type("https://example.com/a")
            try? await Task.sleep(for: .milliseconds(300))
            capture(window, "detail-open")
            await press("\u{1B}", 53)
            try? await Task.sleep(for: .milliseconds(300))
            let saved = store.todos.first { $0.id == target.id }
            log.append("esc -> open \(store.openID != nil), title ends two \(saved?.title.hasSuffix(" two") == true), notes lines \(saved?.notes?.split(separator: "\n").count ?? 0), list focused \(window.firstResponder is NSTableView)")
            capture(window, "detail-closed")
            await press("z", 6, flags: [.command])
            log.append("undo -> notes \(store.todos.first { $0.id == target.id }?.notes ?? "none")")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(200))
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("return, return -> open \(store.openID != nil)")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(200))
            await press("j", 38)
            log.append("before leaving -> open \(store.openID != nil)")
            await press("\u{1B}", 53)
            try? await Task.sleep(for: .milliseconds(200))
            let titles = { store.visible.prefix(5).map { String($0.title.prefix(10)) } }
            log.append("order \(titles())")
            let group = store.groups.first?.id ?? "loose"
            let ids = store.visible.prefix(5).map(\.id)
            store.move([ids[3]], toGroup: group, before: ids[1])
            log.append("4th before 2nd -> \(titles())")
            store.move([ids[0], ids[1]], toGroup: group, before: nil)
            log.append("first two to end -> head \(titles()), last two are them \(store.groups.first?.todos.suffix(2).map(\.id) == [ids[0], ids[1]])")
            store.undo()
            store.undo()
            log.append("undo both -> \(titles())")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("split") {
            func press(_ text: String, _ code: UInt16, flags: NSEvent.ModifierFlags = []) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: flags,
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(150))
            }
            var log: [String] = []
            guard let project = store.projects.first(where: { p in store.todos.filter { $0.projectId == p.id && $0.completedAt == nil }.count >= 5 }) else { return }
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(300))
            func outline() -> String {
                store.groups.map { "[\($0.name ?? "loose")] \($0.todos.count)" }.joined(separator: " ")
            }
            log.append("start \(outline())")
            let target = store.visible[2]
            store.selectedID = target.id
            await press("n", 45, flags: [.command, .option])
            for letter in "Mid" { await press(String(letter), 0) }
            capture(window, "split-typing")
            await press("\u{1B}", 53)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("esc restores \(outline())")
            store.selectedID = target.id
            await press("n", 45, flags: [.command, .option])
            for letter in "Mid" { await press(String(letter), 0) }
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(300))
            log.append("below third of its group \(outline()), selected group keeps it \(store.groups.first { $0.todos.contains { $0.id == target.id } }?.todos.last?.id == target.id)")
            capture(window, "split-done")
            store.selectedID = store.groups.last?.todos.last?.id
            await press("n", 45, flags: [.command, .option])
            for letter in "End" { await press(String(letter), 0) }
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("below the very last -> \(outline())")
            store.selectedID = nil
            await press("n", 45, flags: [.command, .option])
            for letter in "Bottom" { await press(String(letter), 0) }
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("nothing selected -> \(outline())")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("clear") {
            func press(_ text: String, _ code: UInt16, flags: NSEvent.ModifierFlags = []) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: flags,
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(300))
            }
            var log: [String] = []
            func stamp(_ title: String, _ bucket: Bucket, snoozed: String? = nil) -> Todo {
                Todo(
                    id: UUID().uuidString, title: title, notes: nil, bucket: bucket, assigneeEmail: store.me, creatorEmail: store.me,
                    projectId: nil, sectionId: nil, snoozedUntil: snoozed, completedAt: nil, sortOrder: -9999,
                    createdAt: TodoStore.stamp(Date()))
            }
            let today = stamp("from today", .today)
            let inbox = stamp("from inbox", .inbox)
            let snoozed = stamp("from snoozed", .today, snoozed: "2099-01-01T00:00:00Z")
            store.todos += [today, inbox, snoozed]
            func bucket(_ todo: Todo) -> String {
                let t = store.todos.first { $0.id == todo.id }
                return "\(t?.bucket.rawValue ?? "-"), snoozed \(t?.snoozedUntil != nil)"
            }
            store.go(.view(.today))
            try? await Task.sleep(for: .milliseconds(300))
            store.selectedID = today.id
            await press("r", 15, flags: [.command])
            log.append("today -> \(bucket(today)), next selected \(store.selectedID != nil || store.visible.isEmpty)")
            store.go(.view(.inbox))
            try? await Task.sleep(for: .milliseconds(300))
            store.selectedID = inbox.id
            await press("r", 15, flags: [.command])
            log.append("inbox -> \(bucket(inbox))")
            store.go(.view(.snoozed))
            try? await Task.sleep(for: .milliseconds(300))
            store.selectedID = snoozed.id
            await press("r", 15, flags: [.command])
            log.append("snoozed -> \(bucket(snoozed))")
            await press("z", 6, flags: [.command])
            log.append("undo -> \(bucket(snoozed))")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("newcard") {
            func press(_ text: String, _ code: UInt16, flags: NSEvent.ModifierFlags = []) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: flags,
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(120))
            }
            func type(_ text: String) async {
                for letter in text { await press(String(letter), 0) }
            }
            func new() async {
                await press("n", 45, flags: [.command])
                try? await Task.sleep(for: .milliseconds(300))
            }
            func esc() async {
                await press("\u{1B}", 53)
                try? await Task.sleep(for: .milliseconds(400))
            }
            func field() -> String {
                let responder = window.firstResponder
                if responder is DetailNotesView { return "notes" }
                if responder is NSText { return "name" }
                return responder is NSTableView ? "list" : "other"
            }
            func describe(_ id: String?) -> String {
                guard let t = store.todos.first(where: { $0.id == id }) else { return "gone" }
                return "'\(t.title)' notes '\(t.notes ?? "")', selected \(store.selectedID == id), open \(store.openID != nil), focus \(field())"
            }
            var log: [String] = []
            store.go(.view(.today))
            try? await Task.sleep(for: .milliseconds(300))
            let count = store.todos.count

            await new()
            var id = store.openID
            log.append("cmd-N -> open \(id != nil), selected \(store.selectedID == id), focus \(field())")
            capture(window, "newcard-open")
            await esc()
            log.append("esc with nothing typed -> \(describe(id)), count \(count) to \(store.todos.count), focus \(field())")

            await new()
            id = store.openID
            await type("half typed")
            await esc()
            log.append("esc partway -> \(describe(id))")
            capture(window, "newcard-closed")
            await press("z", 6, flags: [.command])
            log.append("one undo -> \(describe(id)), count \(store.todos.count)")

            await new()
            id = store.openID
            await type("with notes")
            await press("\t", 48)
            log.append("tab from name -> \(field())")
            await type("the details")
            await press("\u{19}", 48, flags: [.shift])
            log.append("shift-tab from notes -> \(field())")
            await press("\t", 48)
            log.append("tab from name -> \(field())")
            await press("\t", 48)
            log.append("tab from notes -> \(field())")
            await press("\u{19}", 48, flags: [.shift])
            log.append("shift-tab from name -> \(field())")
            await esc()
            log.append("esc from notes -> \(describe(id))")

            await new()
            id = store.openID
            await press("\t", 48)
            await type("only notes")
            await esc()
            log.append("notes with no name -> \(describe(id))")

            await new()
            id = store.openID
            await type("return closes")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(400))
            log.append("return -> \(describe(id))")

            await new()
            id = store.openID
            await type("first")
            await new()
            let second = store.openID
            log.append("cmd-N again -> first \(describe(id)); second open \(store.openID == second && second != id)")
            await esc()
            log.append("esc on second -> \(describe(second))")

            store.selectedID = id
            try? await Task.sleep(for: .milliseconds(200))
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(300))
            log.append("reopen an existing one -> open \(store.openID == id), focus \(field())")
            for _ in 0..<5 { await press("\u{7F}", 51) }
            await esc()
            log.append("clear its name then esc -> \(describe(id))")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("history") {
            func press(_ text: String, _ code: UInt16, flags: NSEvent.ModifierFlags = []) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: flags,
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(200))
            }
            func back() async { await press("[", 33, flags: [.command]) }
            func forward() async { await press("]", 30, flags: [.command]) }
            func visit(_ letter: String) async {
                await press("g", 5)
                await press(letter, 0)
            }
            func here() -> String {
                switch store.destination {
                case .view(let view): view.rawValue
                case .project: "project"
                }
            }
            var log: [String] = []
            try? await Task.sleep(for: .milliseconds(300))
            log.append("start -> \(here())")
            await back()
            log.append("back with no history (want today) -> \(here())")
            await forward()
            log.append("forward with no history (want today) -> \(here())")
            await visit("i")
            await visit("w")
            await visit("s")
            log.append("visited inbox, week, someday -> \(here())")
            await back()
            log.append("back (want week) -> \(here())")
            capture(window, "history-back")
            await back()
            log.append("back (want inbox) -> \(here())")
            await forward()
            log.append("forward (want week) -> \(here())")
            await visit("l")
            await forward()
            log.append("new place clears forward (want logbook) -> \(here())")
            await back()
            log.append("back (want week) -> \(here())")

            guard let project = store.projects.first else { return }
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(200))
            await visit("t")
            store.projects.removeAll { $0.id == project.id }
            try? await Task.sleep(for: .milliseconds(200))
            await back()
            log.append("deleted project skipped (want week) -> \(here())")

            await press("n", 45, flags: [.command])
            for letter in "typed before back" { await press(String(letter), 0) }
            let draft = store.openID
            await back()
            let saved = store.todos.first { $0.id == draft }
            log.append("back mid-typing -> \(here()), saved \"\(saved?.title ?? "-")\", still typing \(store.openID != nil)")

            let selected = store.selectedID.flatMap { id in store.visible.contains { $0.id == id } }
            log.append("row selected after back -> \(selected ?? store.visible.isEmpty)")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("when") {
            func press(_ text: String, _ code: UInt16, flags: NSEvent.ModifierFlags = []) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: flags,
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(300))
            }
            var log: [String] = []
            func stamp(_ title: String, _ bucket: Bucket, project: String? = nil, snoozed: String? = nil) -> Todo {
                Todo(
                    id: UUID().uuidString, title: title, notes: nil, bucket: bucket, assigneeEmail: store.me, creatorEmail: store.me,
                    projectId: project, sectionId: nil, snoozedUntil: snoozed, completedAt: nil, sortOrder: -9999,
                    createdAt: TodoStore.stamp(Date()))
            }
            func describe(_ id: String) -> String {
                guard let t = store.todos.first(where: { $0.id == id }) else { return "gone" }
                return "\(t.title): \(t.bucket.rawValue), snoozed \(t.snoozedUntil != nil)"
            }
            let keys: [(String, UInt16, Bucket)] = [("t", 17, .today), ("e", 14, .week), ("o", 31, .someday), ("r", 15, .anytime)]
            for (key, code, bucket) in keys {
                let todo = stamp("cmd-\(key)", .inbox, snoozed: "2099-01-01T00:00:00Z")
                store.todos.append(todo)
                store.go(.view(.snoozed))
                try? await Task.sleep(for: .milliseconds(300))
                store.selectedID = todo.id
                await press(key, code, flags: [.command])
                log.append("cmd-\(key) (want \(bucket.rawValue)) -> \(describe(todo.id))")
            }
            await press("z", 6, flags: [.command])
            log.append("undo -> \(store.todos.first { $0.title == "cmd-r" }.map(\.bucket.rawValue) ?? "-")")

            store.go(.view(.inbox))
            try? await Task.sleep(for: .milliseconds(300))
            await press("n", 45, flags: [.command])
            let draft = store.openID
            let before = store.todos.count
            await press("t", 17, flags: [.command])
            log.append("empty draft -> still typing \(store.openID == draft && draft != nil), count \(before) to \(store.todos.count)")
            for letter in "typed then moved" { await press(String(letter), 0) }
            log.append("typing -> draft text \"\(store.openTitle)\"")
            await press("e", 14, flags: [.command])
            log.append("typed draft -> \(draft.map(describe) ?? "-"), still typing \(store.openID != nil)")

            let open = stamp("open one", .inbox)
            store.todos.append(open)
            try? await Task.sleep(for: .milliseconds(300))
            store.selectedID = open.id
            store.openSelected()
            try? await Task.sleep(for: .milliseconds(300))
            log.append("open -> in field \(window.firstResponder is NSText)")
            await press("o", 31, flags: [.command])
            log.append("open then cmd-o -> \(describe(open.id)), closed \(store.openID == nil)")

            guard let project = store.projects.first else { return }
            let row = stamp("while naming", .anytime, project: project.id)
            store.todos.append(row)
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(300))
            await press("n", 45, flags: [.command, .option])
            try? await Task.sleep(for: .milliseconds(300))
            store.selectedID = row.id
            log.append("naming section -> in field \(window.firstResponder is NSText), selected \(store.selectedID == row.id)")
            await press("t", 17, flags: [.command])
            log.append("naming then cmd-t -> \(describe(row.id))")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("section") {
            func press(_ text: String, _ code: UInt16, flags: NSEvent.ModifierFlags = []) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: flags,
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(120))
            }
            func type(_ text: String) async {
                for letter in text { await press(String(letter), 0) }
            }
            var log: [String] = []
            store.go(.view(.today))
            try? await Task.sleep(for: .milliseconds(200))
            let count = store.sections.count
            await press("n", 45, flags: [.command, .option])
            log.append("outside a project -> sections \(count) to \(store.sections.count)")
            guard let project = store.projects.first else { return }
            store.go(.project(project.id))
            try? await Task.sleep(for: .milliseconds(300))
            await press("n", 45, flags: [.command, .option])
            try? await Task.sleep(for: .milliseconds(300))
            log.append("in project -> naming \(store.namingSectionID != nil), in field \(window.firstResponder is NSText)")
            await type("Next up")
            capture(window, "section-typing")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(300))
            let made = store.sections.first { $0.name == "Next up" }
            log.append("return -> section \(made != nil), naming \(store.namingSectionID != nil), list focused \(window.firstResponder is NSTableView)")
            await press("n", 45, flags: [.command])
            try? await Task.sleep(for: .milliseconds(200))
            await type("in the section")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(300))
            let inSection = store.todos.first { $0.title == "in the section" }
            log.append("new to-do -> in new section \(inSection?.sectionId == made?.id), project \(inSection?.projectId == project.id), list \(inSection?.bucket.rawValue ?? "-")")
            capture(window, "section-filled")
            await press("n", 45, flags: [.command, .option])
            try? await Task.sleep(for: .milliseconds(200))
            await type("nope")
            await press("\u{1B}", 53)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("esc -> nope kept \(store.sections.contains { $0.name == "nope" }), naming \(store.namingSectionID != nil)")
            await press("n", 45, flags: [.command, .option])
            try? await Task.sleep(for: .milliseconds(200))
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(200))
            log.append("return blank -> sections \(store.sections.count), naming \(store.namingSectionID != nil)")
            if let first = store.visible.first(where: { $0.sectionId != made?.id }), let made {
                store.file([first.id], toSection: made.id)
                log.append("drop on section -> moved \(store.todos.first { $0.id == first.id }?.sectionId == made.id)")
            }
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("rename") {
            func press(_ text: String, _ code: UInt16) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: [],
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(80))
            }
            func tables(_ view: NSView?) -> [NSTableView] {
                guard let view else { return [] }
                return ((view as? NSTableView).map { [$0] } ?? []) + view.subviews.flatMap { tables($0) }
            }
            var log: [String] = []
            guard let side = tables(window.contentView).first(where: { !($0.dataSource is TodoTableCoordinator) }),
                let project = store.projects.first
            else { return }
            let row = 9  // 8 lists, the header, then the first project.
            let frame = side.rect(ofRow: row)
            let point = side.convert(NSPoint(x: frame.midX, y: frame.midY), to: nil)
            for count in [1, 2] {
                for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                    let click = NSEvent.mouseEvent(
                        with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                        windowNumber: window.windowNumber, context: nil, eventNumber: count, clickCount: count, pressure: 1)
                    if let click { NSApp.postEvent(click, atStart: false) }
                    try? await Task.sleep(for: .milliseconds(30))
                }
            }
            try? await Task.sleep(for: .milliseconds(400))
            log.append("double click -> in \(store.title), renaming \(store.renamingProjectID != nil), in sidebar \(store.isRenamingInSidebar), in field \(window.firstResponder is NSText)")
            for letter in "Renamed" { await press(String(letter), 0) }
            try? await Task.sleep(for: .milliseconds(200))
            capture(window, "rename")
            log.append("typed -> \(store.projects.first?.name ?? "-"), still in field \(window.firstResponder is NSText)")
            await press("\r", 36)
            try? await Task.sleep(for: .milliseconds(300))
            log.append("return -> \(store.projects.first?.name ?? "-"), renaming \(store.renamingProjectID != nil), list focused \(window.firstResponder === tables(window.contentView).first { $0.dataSource is TodoTableCoordinator })")
            store.startRenamingProject(inSidebar: true)
            try? await Task.sleep(for: .milliseconds(300))
            for letter in "Oops" { await press(String(letter), 0) }
            await press("\u{1B}", 53)
            try? await Task.sleep(for: .milliseconds(300))
            log.append("esc -> \(store.projects.first?.name ?? "-")")
            let names = { store.orderedProjects.map(\.name).joined(separator: ", ") }
            log.append("order \(names())")
            store.moveProject(project.id, toArea: project.areaId ?? "", index: store.projects.count - 1)
            log.append("first to last -> \(names())")
            store.moveProject(project.id, toArea: project.areaId ?? "", index: 0)
            log.append("back to first -> \(names()), orders \(store.projects.map { Int($0.sortOrder) })")
            try? await Task.sleep(for: .milliseconds(300))
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("paste") {
            let board = NSPasteboard(name: .init("io.mason.todos.feel-test"))
            model.keys.pasteboard = board
            func put(_ text: String) {
                board.clearContents()
                board.setString(text, forType: .string)
            }
            func press(_ text: String, _ code: UInt16, command: Bool = false) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: command ? .command : [],
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(400))
            }
            var log: [String] = []
            store.go(.view(.today))
            try? await Task.sleep(for: .milliseconds(200))
            let before = store.visible.count
            put("""
                - [ ] First thing
                - [ ] https://example.com/
                - [ ] Third thing
                - [x] Fourth thing
                * Fifth thing
                1. Sixth: with a colon

                Seventh thing
                """)
            await press("v", 9, command: true)
            log.append("paste -> \(before) to \(store.visible.count), selected \(store.selectedIDs.count)")
            log.append(store.visible.prefix(7).map(\.title).joined(separator: " | "))
            capture(window, "paste")
            await press("z", 6, command: true)
            log.append("undo -> \(store.visible.count)")
            await press("c", 8)
            put("one\ntwo")
            await press("v", 9, command: true)
            log.append("two lines into empty new to-do -> \(store.visible.count), editing \(store.openID != nil)")
            await press("z", 6, command: true)
            await press("c", 8)
            put("single line")
            await press("v", 9, command: true)
            log.append("one line into new to-do -> draft '\(store.openTitle)', editing \(store.openID != nil)")
            await press("\u{1B}", 53)
            store.go(.view(.logbook))
            try? await Task.sleep(for: .milliseconds(200))
            put("from the logbook")
            await press("v", 9, command: true)
            log.append("from logbook -> in \(store.title), first \(store.visible.first?.title ?? "-")")
            board.clearContents()
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("quick") {
            func post(_ text: String, _ code: UInt16, to target: NSWindow) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: [],
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: target.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(60))
            }
            let panel = model.quickAdd.window
            var log = ["inbox \(store.tasks(for: .view(.inbox)).count)"]
            // As in real use: some other app is in front when the shortcut lands.
            NSApp.deactivate()
            try? await Task.sleep(for: .milliseconds(400))
            log.append("before: app active \(NSApp.isActive)")
            model.quickAdd.toggle()
            try? await Task.sleep(for: .milliseconds(400))
            log.append("open: app active \(NSApp.isActive), visible \(panel.isVisible), key \(panel.isKeyWindow), in field \(panel.firstResponder is NSText)")
            capture(panel, "quick-empty")
            for letter in "pick up dry cleaning" { await post(String(letter), 0, to: panel) }
            try? await Task.sleep(for: .milliseconds(200))
            log.append("typed: visible \(panel.isVisible), key \(panel.isKeyWindow), app active \(NSApp.isActive), text \((panel.firstResponder as? NSText)?.string ?? "-")")
            capture(panel, "quick-typed")
            capture(window, "quick-behind")
            await post("\r", 36, to: panel)
            try? await Task.sleep(for: .milliseconds(300))
            log.append("return: visible \(panel.isVisible), inbox \(store.tasks(for: .view(.inbox)).count), first \(store.tasks(for: .view(.inbox)).first?.title ?? "-"), selection kept \(store.selectedID != nil)")
            model.quickAdd.toggle()
            try? await Task.sleep(for: .milliseconds(300))
            await post("x", 0, to: panel)
            await post("\u{1B}", 53, to: panel)
            try? await Task.sleep(for: .milliseconds(300))
            log.append("escape: visible \(panel.isVisible), inbox \(store.tasks(for: .view(.inbox)).count)")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        if CommandLine.arguments.contains("keys") {
            func key(_ text: String, _ code: UInt16, command: Bool = false, shift: Bool = false) async {
                let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: NSEvent.ModifierFlags(command ? [.command] : []).union(shift ? [.shift] : []),
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                    context: nil, characters: text, charactersIgnoringModifiers: text, isARepeat: false,
                    keyCode: code)
                if let event { NSApp.postEvent(event, atStart: false) }
                try? await Task.sleep(for: .milliseconds(400))
            }
            var log: [String] = []
            store.go(.view(.logbook))
            try? await Task.sleep(for: .milliseconds(300))
            await key("n", 45, command: true)
            log.append("cmd-N from logbook -> editing \(store.openID != nil), in \(store.title)")
            for letter in "buy stamps" { await key(String(letter), 0) }
            capture(window, "new-todo")
            await key("\r", 36)
            log.append("typed -> \(store.todos.contains { $0.title == "buy stamps" })")
            let projectCount = store.projects.count
            await key("N", 45, command: true, shift: true)
            log.append("cmd-shift-N -> renaming \(store.renamingProjectID != nil), in \(store.title.isEmpty ? "(blank)" : store.title), in field \(window.firstResponder is NSText)")
            capture(window, "new-blank")
            for letter in "Holiday cards" { await key(String(letter), 0) }
            capture(window, "new-project")
            await key("\r", 36)
            log.append("named -> projects \(projectCount) to \(store.projects.count), now in \(store.title), renaming \(store.renamingProjectID != nil), list focused \(window.firstResponder is NSTableView)")
            await key("N", 45, command: true, shift: true)
            await key("\u{1B}", 53)
            log.append("esc new -> projects \(store.projects.count), back in \(store.title), list focused \(window.firstResponder is NSTableView)")
            await key("N", 45, command: true, shift: true)
            await key("\r", 36)
            log.append("return blank -> projects \(store.projects.count), back in \(store.title)")
            func fields(_ view: NSView?) -> [ProjectNameField] {
                guard let view else { return [] }
                return ((view as? ProjectNameField).map { [$0] } ?? []) + view.subviews.flatMap { fields($0) }
            }
            store.go(.project(store.projects.first { $0.name == "Holiday cards" }?.id ?? ""))
            try? await Task.sleep(for: .milliseconds(400))
            if let name = fields(window.contentView).first {
                let point = name.convert(NSPoint(x: name.bounds.midX, y: name.bounds.midY), to: nil)
                for (type, delay) in [(NSEvent.EventType.leftMouseDown, 0.05), (.leftMouseUp, 0.4)] {
                    let click = NSEvent.mouseEvent(
                        with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                        windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1)
                    if let click { NSApp.postEvent(click, atStart: false) }
                    try? await Task.sleep(for: .seconds(delay))
                }
                log.append("click header -> renaming \(store.renamingProjectID != nil), in field \(window.firstResponder is NSText)")
                await key(" 2027", 0)
                log.append("typed -> sidebar and title \(store.title)")
                await key("\u{1B}", 53)
                log.append("esc rename -> \(store.title)")
            }
            store.go(.project(store.projects.first?.id ?? ""))
            try? await Task.sleep(for: .milliseconds(300))
            log.append("start \(store.visible.count)")
            await key("\u{7F}", 51)
            log.append("delete -> \(store.visible.count)")
            await key("z", 6, command: true)
            log.append("undo -> \(store.visible.count)")
            await key("a", 0, command: true)
            log.append("select all -> \(store.selectedIDs.count)")
            capture(window, "select-all")
            await key("\u{7F}", 51)
            log.append("delete all -> \(store.visible.count)")
            await key("z", 6, command: true)
            log.append("undo -> \(store.visible.count)")
            await key("\u{7F}", 51, command: true)
            log.append("cmd-delete -> \(store.visible.count)")
            await key("z", 6, command: true)
            func where_(_ id: String) -> String {
                let t = store.todos.first { $0.id == id }
                return "bucket \(t?.bucket.rawValue ?? "?"), project \(t?.projectId == nil ? "none" : "set"), done \(t?.completedAt != nil)"
            }
            if let id = store.visible.first?.id, let other = store.projects.last?.id {
                for (name, target) in [
                    ("today", Destination.view(.today)), ("week", .view(.week)), ("someday", .view(.someday)),
                    ("project", .project(other)), ("inbox", .view(.inbox)), ("project from inbox", .project(other)),
                    ("logbook", .view(.logbook)),
                ] {
                    store.file([id], to: target)
                    log.append("drop \(name) -> \(where_(id))")
                }
            }
            store.go(.view(.today))
            try? await Task.sleep(for: .milliseconds(400))
            capture(window, "sidebar")
            try? (log.joined(separator: "\n") + "\n").write(to: results, atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        // Type straight away, every key at once, with the list changing underneath.
        go("g", "t", in: window)
        await settle()
        let typed = "call the orthodontist about friday"
        go("c", in: window)
        go(typed.map(String.init), in: window)
        for round in 0..<4 {
            await settle()
            backgroundChange(store, round: round)
        }
        await settle()
        report["typed_kept"] = store.openTitle == typed
        report["typed_text"] = store.openTitle
        report["still_editing"] = store.openID != nil
        report["cursor_in_field"] = window.firstResponder is NSText
        capture(window, "typing")
        report["lists_on_screen"] = tableSizes(in: window.contentView)
        go(["\r"], in: window)
        await settle()
        report["saved"] = store.todos.contains { $0.title == typed }

        // Up and down the longest list.
        go("g", "a", in: window)
        await settle()
        times = []
        for index in 0..<200 {
            go(index % 100 < 50 ? "j" : "k", in: window)
            await settle(until: { times.count > index })
        }
        report["move"] = summary(times)
        await settle()
        capture(window, "anytime")
        for _ in 0..<26 {
            go("j", in: window)
            await settle()
        }
        for _ in 0..<30 where !NSApp.isActive {
            NSApp.activate(ignoringOtherApps: true)
            try? await Task.sleep(for: .milliseconds(100))
        }
        try? await Task.sleep(for: .seconds(1))
        capture(window, "anytime-scrolled")
        report["bar_clear"] = window.titlebarAppearsTransparent
        for destination in [("l", "logbook"), ("z", "snoozed")] {
            go("g", destination.0, in: window)
            await settle()
            capture(window, destination.1)
        }
        if let project = store.projects.first(where: { project in store.todos.contains { $0.projectId == project.id && $0.completedAt == nil && $0.sectionId != nil } }) ?? store.projects.first {
            store.go(.project(project.id))
            await settle()
            capture(window, "project")
        }
        report["captured"] = true

        // Switching views.
        times = []
        for index in 0..<60 {
            go("g", in: window)
            go(index % 2 == 0 ? "t" : "a", in: window)
            await settle(until: { times.count > index * 2 + 1 })
        }
        report["switch"] = summary(stride(from: 1, to: times.count, by: 2).map { times[$0] })

        // Completing and undoing.
        go("g", "a", in: window)
        await settle()
        times = []
        for index in 0..<60 {
            go(index % 2 == 0 ? "e" : "z", in: window, command: index % 2 == 1)
            await settle(until: { times.count > index })
        }
        report["complete"] = summary(times)

        let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        var lines = (try? Data(contentsOf: results)) ?? Data()
        lines.append(data ?? Data())
        lines.append(contentsOf: [10])
        try? lines.write(to: results)
        NSApp.terminate(nil)
    }

    /// Rows and width of every list in the window, sidebar included.
    private func tableSizes(in view: NSView?) -> [String] {
        guard let view else { return [] }
        let own = (view as? NSTableView).map { ["\($0.numberOfRows) rows, \(Int($0.bounds.width)) wide, hidden \($0.isHiddenOrHasHiddenAncestor)"] } ?? []
        return own + view.subviews.flatMap { tableSizes(in: $0) }
    }

    /// The window as the window server composites it, glass included. An app may
    /// always capture its own windows; the call is gone from the headers, so look it up.
    private func capture(_ window: NSWindow, _ name: String) {
        typealias CreateImage = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") else { return }
        let create = unsafeBitCast(symbol, to: CreateImage.self)
        // A window that isn't on screen has no number to capture.
        guard window.windowNumber > 0 else { return }
        guard let image = create(.null, 8, UInt32(window.windowNumber), 1)?.takeRetainedValue() else { return }
        let scheme = CommandLine.arguments.contains("dark") ? "dark" : "light"
        let state = NSApp.isActive ? "active" : "inactive"
        let file = results.deletingLastPathComponent().appending(path: "\(scheme)-\(state)-\(name).png")
        try? NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.write(to: file)
    }

    /// Another device or Norbert changing things: a row renamed, a row added at the top.
    private func backgroundChange(_ store: TodoStore, round: Int) {
        if let index = store.todos.firstIndex(where: { $0.completedAt == nil && $0.id != store.openID }) {
            store.todos[index].title += " •"
        }
        var added = store.todos.first { $0.id != store.openID } ?? store.todos[0]
        added.id = "background-\(round)"
        added.title = "Added elsewhere \(round)"
        added.bucket = .today
        added.completedAt = nil
        added.snoozedUntil = nil
        added.assigneeEmail = store.me
        added.sortOrder = -1000 - Double(round)
        store.todos.append(added)
    }

    private func go(_ keys: String..., in window: NSWindow) {
        go(keys, in: window)
    }

    private func go(_ keys: [String], in window: NSWindow, command: Bool = false) {
        for key in keys {
            let event = NSEvent.keyEvent(
                with: .keyDown, location: .zero, modifierFlags: command ? .command : [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, characters: key, charactersIgnoringModifiers: key, isARepeat: false,
                keyCode: key == "\r" ? 36 : 0)
            if let event { NSApp.postEvent(event, atStart: false) }
        }
    }

    private func go(_ key: String, in window: NSWindow, command: Bool) {
        go([key], in: window, command: command)
    }

    private func settle(until done: (() -> Bool)? = nil) async {
        let deadline = CACurrentMediaTime() + (done == nil ? 0.15 : 2)
        while CACurrentMediaTime() < deadline {
            if let done, done() { return }
            try? await Task.sleep(for: .milliseconds(1))
        }
    }

    private func summary(_ values: [Double]) -> [String: Double] {
        let sorted = values.sorted()
        guard !sorted.isEmpty else { return [:] }
        return [
            "p50": sorted[sorted.count / 2], "p95": sorted[sorted.count * 95 / 100],
            "max": sorted[sorted.count - 1], "n": Double(sorted.count),
        ]
    }
}
