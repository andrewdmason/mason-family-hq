import AppKit
import ServiceManagement

// The to-do list on the Mac, reading from a file on disk. Nothing here talks to
// the family database yet.

enum AppStart {
    /// Seconds since the process began, from the kernel's own record.
    static func secondsSinceProcessStart() -> Double {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        sysctl(&mib, 4, &info, &size, nil, 0)
        let start = info.kp_proc.p_un.__p_starttime
        let started = Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
        return Date().timeIntervalSince1970 - started
    }

    static var libraryFile: URL {
        let folder = URL.applicationSupportDirectory.appending(path: "io.mason.todos")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appending(path: "todos.json")
    }

    /// What the family database last said (see TodoMerge).
    static var baseFile: URL {
        libraryFile.deletingLastPathComponent().appending(path: "synced.json")
    }
}

@main
enum TodosMacApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

/// The window is built directly on AppKit's split view and toolbar: launch is one
/// straight line from process start to a window with the list in it, and the
/// system's glass comes with those pieces untouched.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var toolbar: TodoToolbarController?
    /// Held for the life of the app: the keyboard handling lives inside it.
    private var model: AppModel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let model = AppModel()
        self.model = model
        NSApp.mainMenu = Self.menu(model: model)
        let split = NSSplitViewController()
        let sidebarController = TodoSidebarController(store: model.store)
        let sidebarItem = NSSplitViewItem(sidebarWithViewController: sidebarController)
        sidebarItem.minimumThickness = 200
        sidebarItem.maximumThickness = 320
        split.addSplitViewItem(sidebarItem)
        let syncStatus = SyncStatusController()
        sidebarItem.addBottomAlignedAccessoryViewController(syncStatus)
        let listController = TodoListController(store: model.store)
        sidebarController.focusList = { [weak listController] in listController?.focus() }
        let listItem = NSSplitViewItem(viewController: listController)
        split.addSplitViewItem(listItem)
        // No band or line across the top: the bar stays the same paper as the list.
        listItem.titlebarSeparatorStyle = .none

        let window = NSWindow(contentViewController: split)
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        window.setContentSize(NSSize(width: 980, height: 640))
        window.contentMinSize = NSSize(width: 720, height: 440)
        window.setFrameAutosaveName("Todos")
        window.backgroundColor = TodosLook.paper
        // The list's big title is its first row, so the bar carries none of its own.
        window.titleVisibility = .hidden
        window.titlebarSeparatorStyle = .none
        window.titlebarAppearsTransparent = true
        let toolbar = TodoToolbarController(store: model.store, window: window)
        window.toolbar = toolbar.toolbar
        window.toolbarStyle = .unified
        self.toolbar = toolbar
        window.isReleasedWhenClosed = false
        self.window = window
        model.palette.mainWindow = window
        model.palette.refocusCard = { [weak listController] inNotes, range in
            listController?.focusCard(inNotes: inNotes, range: range)
        }
        // Started at login, it waits in the background instead of opening a window.
        let event = NSAppleEventManager.shared().currentAppleEvent
        let atLogin = event?.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue == OSType(keyAELaunchedAsLogInItem)
        if !atLogin {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
        }
        if model.test == nil {
            let status = model.quickAdd.registerHotKey()
            if status != noErr {
                // Otherwise it just silently wouldn't work.
                let alert = NSAlert()
                alert.messageText = "The ⇧⌘Space quick add shortcut isn't available"
                alert.informativeText = "macOS refused it (error \(status)). Another app may be using it."
                alert.runModal()
            }
            do {
                try SMAppService.mainApp.register()
            } catch {
                fputs("todos: open at login failed: \(error)\n", stderr)
            }
        }
        // After the first frame: opening never waits on sign-in or the network.
        let checkingStatus = model.test != nil && CommandLine.arguments.contains("syncstatus")
        if model.test == nil || checkingStatus {
            DispatchQueue.main.async {
                let base = checkingStatus ? URL.temporaryDirectory.appending(path: "todos-base.json") : AppStart.baseFile
                let sync = TodoSync(store: model.store, baseFile: base)
                model.sync = sync
                sync.start()
                syncStatus.attach(sync)
                if model.test == nil {
                    let reminders = RemindersImport(store: model.store)
                    model.reminders = reminders
                    reminders.start()
                }
            }
        }

        model.keys.install()
        // Two hops: the first frame's layout and drawing have happened.
        DispatchQueue.main.async {
            DispatchQueue.main.async {
                if let test = model.test {
                    let launch = AppStart.secondsSinceProcessStart() * 1000
                    Task { await test.run(model: model, launchMilliseconds: launch) }
                }
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        model?.store.saveNow()
    }

    /// Closing the window leaves quick add running; the Dock icon brings it back.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { window?.makeKeyAndOrderFront(nil) }
        return true
    }

    /// The standard Mac menus. A text field needs the Edit commands for copy and paste.
    private static func menu(model: AppModel) -> NSMenu {
        let store = model.store
        let menu = NSMenu()
        let appItem = menu.addItem(withTitle: "Todos", action: nil, keyEquivalent: "")
        let app = NSMenu(title: "Todos")
        app.addItem(withTitle: "Hide Todos", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(.separator())
        // ⌘Q only puts the app away: quitting would also switch off quick add. The
        // Dock's Quit, logging out and restarting all still quit for real.
        let close = ClosureMenuItem(title: "Close Todos") {
            store.saveNow()
            NSApp.hide(nil)
        }
        close.keyEquivalent = "q"
        app.addItem(close)
        let quit = app.addItem(
            withTitle: "Quit Completely", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.keyEquivalentModifierMask = [.command, .option]
        appItem.submenu = app
        let fileItem = menu.addItem(withTitle: "File", action: nil, keyEquivalent: "")
        let file = NSMenu(title: "File")
        let newToDo = ClosureMenuItem(title: "New To-Do") { store.startNew() }
        newToDo.keyEquivalent = "n"
        file.addItem(newToDo)
        let newProject = ClosureMenuItem(title: "New Project") { store.startNewProject() }
        newProject.keyEquivalent = "n"
        newProject.keyEquivalentModifierMask = [.command, .shift]
        file.addItem(newProject)
        let newSection = ClosureMenuItem(title: "New Section") {
            if !store.startNewSection() { NSSound.beep() }
        }
        newSection.keyEquivalent = "n"
        newSection.keyEquivalentModifierMask = [.command, .option]
        file.addItem(newSection)
        file.addItem(ClosureMenuItem(title: "New Project Group") { store.startNewArea() })
        let quick = ClosureMenuItem(title: "Quick Add to Inbox") { model.quickAdd.toggle() }
        quick.keyEquivalent = " "
        quick.keyEquivalentModifierMask = [.command, .shift]
        file.addItem(quick)
        file.addItem(.separator())
        file.addItem(ClosureMenuItem(title: "Sync Now") { model.sync?.kick() })
        file.addItem(ClosureMenuItem(title: "Sign In to Sync") { model.sync?.signIn() })
        file.addItem(ClosureMenuItem(title: "Sign Out") { model.sync?.signOut() })
        file.addItem(.separator())
        let commands = ClosureMenuItem(title: "Commands…") { model.palette.toggle() }
        commands.keyEquivalent = "k"
        file.addItem(commands)
        let anytime = ClosureMenuItem(title: "Move to Anytime") { store.moveSelected(to: .anytime) }
        anytime.keyEquivalent = "r"
        file.addItem(anytime)
        fileItem.submenu = file
        let editItem = menu.addItem(withTitle: "Edit", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let windowItem = menu.addItem(withTitle: "Window", action: nil, keyEquivalent: "")
        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = window
        NSApp.windowsMenu = window
        return menu
    }
}

/// The app's look. Glass comes from the system's own sidebar and toolbar; these
/// are the only colors the app adds, underneath and in the list.
enum TodosLook {
    /// The website's Todos green, lifted for dark mode.
    static let accent = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.33, green: 0.6, blue: 0.52, alpha: 1)
            : NSColor(srgbRed: 0.23, green: 0.39, blue: 0.34, alpha: 1)
    }
    /// The family site's warm paper in light mode, a warm near-black in dark.
    static let paper = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.11, green: 0.105, blue: 0.095, alpha: 1)
            : NSColor(srgbRed: 0.98, green: 0.97, blue: 0.94, alpha: 1)
    }

    /// Each view's color, as on the website.
    static func color(_ view: TodoView) -> NSColor {
        switch view {
        case .inbox: .systemBlue
        case .today: .systemYellow
        case .week: .systemOrange
        case .snoozed: .systemIndigo
        case .anytime: .systemTeal
        case .someday: .systemBrown
        case .delegated: .systemPink
        case .logbook: .systemGreen
        }
    }
}

@MainActor
final class AppModel {
    let store: TodoStore
    let test = FeelTest.fromArguments()
    let keys: KeyRouter
    let quickAdd: QuickAddController
    let palette: CommandPalette
    var sync: TodoSync?
    var reminders: RemindersImport?

    init() {
        let test = FeelTest.fromArguments()
        let data = (try? Data(contentsOf: AppStart.libraryFile)) ?? Data()
        var library = (try? TodoStore.decode(data)) ?? TodoLibrary(tasks: [], projects: [], sections: [])
        if let test { library = test.padded(library) }
        // A test run never writes over the saved list.
        let store = TodoStore(library: library, saveFile: test == nil ? AppStart.libraryFile : nil)
        self.store = store
        keys = KeyRouter(store: store)
        quickAdd = QuickAddController(store: store)
        palette = CommandPalette(store: store)
        keys.togglePalette = { [palette] in palette.toggle() }
        store.selectedID = store.visible.first?.id
    }
}

/// Just the sidebar toggle and New To-Do, the one prominent action. Everything
/// else lives in ⌘K.
@MainActor
final class TodoToolbarController: NSObject, NSToolbarDelegate {
    let toolbar = NSToolbar(identifier: "todos")
    private let store: TodoStore
    private weak var window: NSWindow?

    private enum ID {
        static let new = NSToolbarItem.Identifier("new")
    }

    init(store: TodoStore, window: NSWindow) {
        self.store = store
        self.window = window
        super.init()
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        follow()
    }

    /// Keep the window's name (for the Window menu) current.
    private func follow() {
        let title = withObservationTracking {
            store.title
        } onChange: { [weak self] in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.follow() } }
        }
        window?.title = title
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.toggleSidebar, .sidebarTrackingSeparator, .flexibleSpace, ID.new]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(
        _ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
        willBeInsertedIntoToolbar flag: Bool
    ) -> NSToolbarItem? {
        guard identifier == ID.new else { return NSToolbarItem(itemIdentifier: identifier) }
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = "New To-Do"
        item.image = NSImage(systemSymbolName: "plus", accessibilityDescription: "New To-Do")
        item.toolTip = "New To-Do (⌘N)"
        item.isBordered = true
        item.target = self
        item.action = #selector(newToDo)
        item.style = .prominent
        item.backgroundTintColor = TodosLook.accent
        return item
    }

    @objc private func newToDo() { store.startNew() }
}

// MARK: - Keyboard

/// One place for every key. It runs ahead of the list and the sidebar, so `j` can't land in the wrong one.
@MainActor
final class KeyRouter {
    let store: TodoStore
    /// Set by the feel test, to time how long each key takes to reach the screen.
    var measured: ((Double) -> Void)?
    /// Swapped by the feel test, so it never touches your real clipboard.
    var pasteboard = NSPasteboard.general
    var togglePalette: () -> Void = {}
    private var monitor: Any?
    private var chordUntil: TimeInterval = 0

    init(store: TodoStore) {
        self.store = store
    }

    func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            return self.handle(event)
        }
    }

    private func handle(_ event: NSEvent) -> NSEvent? {
        // Quick add and the palette handle their own keys.
        if event.window is QuickAddPanel || event.window is CommandPalettePanel { return event }
        let started = CACurrentMediaTime()
        guard perform(event) else { return event }
        if measured != nil { report(since: started, in: event.window) }
        return nil
    }

    /// Time until this key's change has been laid out and drawn.
    private func report(since started: TimeInterval, in window: NSWindow?) {
        DispatchQueue.main.async { [weak self] in
            window?.contentView?.layoutSubtreeIfNeeded()
            window?.displayIfNeeded()
            CATransaction.flush()
            self?.measured?((CACurrentMediaTime() - started) * 1000)
        }
    }

    /// ⌘V as new to-dos. Text fields keep ordinary paste, except that several
    /// lines into a brand-new, empty to-do become several to-dos.
    private func pasteTasks(typing: Bool) -> Bool {
        guard let text = pasteboard.string(forType: .string) else { return false }
        if store.renamingProjectID != nil { return false }
        if store.editingID != nil {
            let lines = text.split(whereSeparator: \.isNewline)
            guard store.editingText.isEmpty, lines.count > 1 else { return false }
            store.cancelEdit()
        } else if typing {
            return false
        }
        return store.pasteTodos(text) > 0
    }

    private func perform(_ event: NSEvent) -> Bool {
        let command = event.modifierFlags.contains(.command)
        let shift = event.modifierFlags.contains(.shift)
        let characters = event.charactersIgnoringModifiers ?? ""
        let typing = event.window?.firstResponder is NSText

        if command, !shift, characters.lowercased() == "k" {
            togglePalette()
            return true
        }

        // These work from anywhere, even mid-typing, which keeps what was typed.
        if command, characters.lowercased() == "n" {
            if event.modifierFlags.contains(.option) {
                if !store.startNewSection() { NSSound.beep() }
            } else if shift {
                store.startNewProject()
            } else {
                store.startNew()
            }
            return true
        }

        if command, characters.lowercased() == "v", pasteTasks(typing: typing) { return true }

        // In the open to-do: Esc closes it, and so does Return in the name. In the
        // notes, Return is a new line and ⌘Return closes.
        if store.openID != nil {
            let inNotes = event.window?.firstResponder is DetailNotesView
            switch event.keyCode {
            case 53:
                store.closeOpen()
                return true
            case 36, 76:
                if !inNotes || command {
                    store.closeOpen()
                    return true
                }
            default: break
            }
        }

        if store.editingID != nil {
            switch event.keyCode {
            case 36, 76:  // return
                store.commitEdit()
                return true
            case 53:  // escape
                store.cancelEdit()
                return true
            default:
                // Keys that beat the cursor to the new row go into the draft,
                // not to a shortcut and not into nothing.
                if !typing, !command, let text = event.characters, !text.isEmpty,
                    text.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) {
                    store.editingText += text
                    return true
                }
                return false
            }
        }
        if typing { return false }

        if command {
            switch characters.lowercased() {
            case "z": if shift { store.redo() } else { store.undo() }
            case "a": store.selectAll()
            case "r": store.moveSelected(to: .anytime)
            default:
                guard event.keyCode == 51 else { return false }  // ⌘delete
                store.deleteSelected()
            }
            return true
        }

        if CACurrentMediaTime() < chordUntil {
            chordUntil = 0
            let targets: [String: TodoView] = [
                "i": .inbox, "t": .today, "w": .week, "a": .anytime, "s": .someday,
                "z": .snoozed, "d": .delegated, "l": .logbook,
            ]
            if let view = targets[characters.lowercased()] { store.go(.view(view)) }
            return true
        }

        switch event.keyCode {
        case 125: store.moveSelection(by: 1); return true  // down
        case 126: store.moveSelection(by: -1); return true  // up
        case 36, 76: store.openSelected(); return true  // return
        case 51, 117: store.deleteSelected(); return true  // delete
        case 53: store.selectedID = nil; return true  // escape
        default: break
        }

        switch characters {
        case "g": chordUntil = CACurrentMediaTime() + 1
        case "j": store.moveSelection(by: 1)
        case "k": store.moveSelection(by: -1)
        case "o": store.openSelected()
        case "c": store.startNew()
        case "e": store.completeSelected()
        case "s": store.snoozeSelectedUntilTomorrow()
        case "t": store.moveSelected(to: .today)
        case "W": store.moveSelected(to: .week)
        case "y": store.moveSelected(to: .anytime)
        default: return false
        }
        return true
    }
}
