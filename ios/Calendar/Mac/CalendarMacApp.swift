import AppKit
import Carbon.HIToolbox
import MasonKit
import ServiceManagement
import SwiftUI

// The family calendar on the Mac: a window (Week and Day) and a menubar
// applet (⌃⌥Space), one app. Quitting takes the window and the Dock icon away
// and leaves the menubar item; "Quit Completely" stops both. It starts at
// login as the menubar item alone.
//
// Launch arguments, for trying it without the family's calendar:
//   --demo            a made-up family week, no sign-in
//   --me <first name> whose Mac it is in the demo
//   --view <week|day> the view the window opens on
//   --applet          open the applet at launch
//   --no-window       start as the menubar item alone
//   --type <words>    with --applet: the line already typed
//   --open <title>    open the card of the first event with this title
//   --new             open a new event's card in the window
//   --month           with --applet: the month dropped open
//   --settings        open Settings
//   --trip <name>     open the trip whose name starts with this, at its week
//   --trips           drop the Trips list open
//   --dark            in the dark appearance

@main
enum CalendarMacApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let model = AppModel()
    private var applet: AppletController?
    private var window: NSWindow?
    private var settings: NSWindow?
    private var hotkey: Hotkey?
    private var keys: Any?
    /// "Quit Completely", or the Mac shutting down: really go.
    private var leaving = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        let atLogin = Self.launchedAtLogin
        #if DEBUG
        // A picture of the applet's list and nothing else: no window, no
        // menubar item, no shortcut, so it's safe with someone at the Mac.
        if let at = args.firstIndex(of: "--render-list"), args.count > at + 1 {
            Snapshot.renderList(model: model, to: URL(fileURLWithPath: args[at + 1]))
            exit(0)
        }
        if let at = args.firstIndex(of: "--render-trip"), args.count > at + 2 {
            Snapshot.renderTrip(model: model, name: args[at + 1], to: URL(fileURLWithPath: args[at + 2]))
            exit(0)
        }
        #endif
        NSApp.mainMenu = makeMenu()

        model.showWindow = { [weak self] in self?.showWindow() }
        model.showSettings = { [weak self] in self?.showSettings() }
        model.quitCompletely = { [weak self] in self?.quitCompletely() }
        let applet = AppletController(model: model)
        model.hideApplet = { [weak applet] in applet?.hide() }
        model.dismissApplet = { [weak applet] in applet?.dismiss() }
        self.applet = applet

        hotkey = Hotkey(keyCode: kVK_Space, modifiers: controlKey | optionKey) { [weak applet] in applet?.toggle() }
        model.shortcutTaken = hotkey == nil
        LoginItem.turnOnOnce()
        model.start()

        if !atLogin, !args.contains("--no-window") { showWindow() }
        #if DEBUG
        Snapshot.arm()
        #endif
        if args.contains("--applet") {
            if let at = args.firstIndex(of: "--type"), args.count > at + 1 { model.applet.line = args[at + 1] }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { applet.show() }
        }
        if args.contains("--month") { model.applet.monthOpen = true }
        if args.contains("--settings") { showSettings() }
        if args.contains("--dark") { NSApp.appearance = NSAppearance(named: .darkAqua) }
        if args.contains("--new") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.newEvent() }
        }
        // A trip's panel open (`--trip Costa`), or the Trips list (`--trips`).
        if let at = args.firstIndex(of: "--trip"), args.count > at + 1 {
            let name = args[at + 1].lowercased()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [model] in
                guard let view = model.store.board.trips.first(where: { $0.trip.name.lowercased().hasPrefix(name) }) else { return }
                model.window.day = view.trip.start
                model.window.trip = view.id
            }
        }
        if args.contains("--trips") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [model] in model.window.tripsOpen = true }
        }
        if let at = args.firstIndex(of: "--open"), args.count > at + 1 {
            let title = args[at + 1]
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [model] in
                let week = model.window.day.weekStart()
                guard let item = model.store.board.items.first(where: {
                    $0.event.title == title && $0.day >= week && !$0.event.isDrive
                }) else { return }
                if args.contains("--applet") {
                    model.applet.card = CardRequest(itemID: item.id, draft: model.store.cardDraft(for: item))
                } else {
                    model.window.open(item, anchor: GridAnchor.card(item.day, item.id), in: model.store)
                }
            }
        }
    }

    /// Started by the login item, not by someone opening it.
    private static var launchedAtLogin: Bool {
        guard let event = NSAppleEventManager.shared().currentAppleEvent, event.eventID == kAEOpenApplication else { return false }
        return event.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
    }

    // MARK: The window

    /// Opening the app again (the Dock, Spotlight, the applet) brings the window back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        showWindow()
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    private func showWindow() {
        applet?.hide()
        NSApp.setActivationPolicy(.regular)
        if window == nil { window = makeWindow() }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate()
        // An app that has just grown a Dock icon doesn't always get its menu
        // bar on the first ask: ask again once the change has taken.
        DispatchQueue.main.async { [weak self] in
            NSApp.activate()
            self?.window?.makeKeyAndOrderFront(nil)
        }
        Task { await model.sync() }
    }

    private func makeWindow() -> NSWindow {
        let host = NSHostingController(rootView: WindowRoot().environment(model))
        // The view's own toolbar is the window's.
        host.sceneBridgingOptions = [.toolbars]
        let window = NSWindow(contentViewController: host)
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        window.title = "Calendar"
        window.titleVisibility = .hidden
        window.toolbarStyle = .unified
        window.setContentSize(NSSize(width: 1180, height: 760))
        window.contentMinSize = NSSize(width: 820, height: 520)
        window.setFrameAutosaveName("Calendar")
        window.isReleasedWhenClosed = false
        window.delegate = self
        if !window.setFrameUsingName("Calendar") { window.center() }
        // T, W, D and the arrows, when nothing's being typed.
        keys = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.key(event) == true ? nil : event
        }
        return window
    }

    func windowDidBecomeKey(_ notification: Notification) {
        guard notification.object as? NSWindow === window else { return }
        Task { await model.sync() }
    }

    /// The window's own keys. True when the key was one of them.
    private func key(_ event: NSEvent) -> Bool {
        guard let window, event.window === window, window.attachedSheet == nil, model.window.card == nil,
              event.modifierFlags.intersection([.command, .control, .option]).isEmpty,
              !(window.firstResponder is NSText) else { return false }
        switch event.keyCode {
        case UInt16(kVK_LeftArrow): step(-1)
        case UInt16(kVK_RightArrow): step(1)
        default:
            switch event.charactersIgnoringModifiers?.lowercased() {
            case "t": goToToday()
            case "w": model.prefs.view = .week
            case "d": model.prefs.view = .day
            default: return false
            }
        }
        return true
    }

    private func step(_ direction: Int) {
        let days = model.prefs.view == .week ? 7 : 1
        withAnimation(.snappy) { model.window.day = model.window.day.adding(days: direction * days) }
    }

    @objc private func goToToday() {
        withAnimation(.snappy) { model.window.day = .today() }
    }

    @objc private func previous() { step(-1) }
    @objc private func next() { step(1) }
    @objc private func weekView() { model.prefs.view = .week }
    @objc private func dayView() { model.prefs.view = .day }

    @objc private func refresh() {
        Task { await model.sync(force: true) }
    }

    @objc private func newEvent() {
        guard model.ready, let me = model.me else { return }
        showWindow()
        // On the day in view when it's Day, or today's own week; else the
        // week's first day.
        var day = model.window.day
        if model.prefs.view == .week {
            let today = Day.today()
            day = today.weekStart() == day.weekStart() ? today : day.weekStart()
        }
        let times = CalendarRules.newEventTimes(on: day, now: Clock.now())
        let start = CalendarRules.minutes(times.start)
        model.window.compose(for: me, on: day, from: start, to: min(start + 60, 24 * 60), reveal: true, in: model.store)
    }

    @objc private func newTrip() {
        guard model.ready else { return }
        showWindow()
        let today = Day.today()
        model.window.newTrip = Trip(name: "", start: today, end: today.adding(days: 2), travelers: model.me.map { [$0] } ?? [])
    }

    @objc private func showTrips() {
        guard model.ready else { return }
        showWindow()
        model.window.tripsOpen = true
    }

    @objc private func showSettings() {
        applet?.hide()
        NSApp.setActivationPolicy(.regular)
        if settings == nil {
            let host = NSHostingController(rootView: SettingsView().environment(model))
            let window = NSWindow(contentViewController: host)
            window.styleMask = [.titled, .closable]
            window.title = "Calendar Settings"
            window.isReleasedWhenClosed = false
            window.center()
            settings = window
        }
        settings?.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    // MARK: Quitting

    /// ⌘Q, or Quit from the Dock: the window and the Dock icon go, the
    /// menubar item stays. The Mac logging out or shutting down really quits.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let reason = NSAppleEventManager.shared().currentAppleEvent?.attributeDescriptor(forKeyword: kAEQuitReason)
        if leaving || reason != nil { return .terminateNow }
        window?.orderOut(nil)
        settings?.orderOut(nil)
        NSApp.setActivationPolicy(.accessory)
        return .terminateCancel
    }

    @objc private func quitCompletely() {
        leaving = true
        NSApp.terminate(nil)
    }

    // MARK: The menu

    private func makeMenu() -> NSMenu {
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ flags: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = flags
            item.target = target
            return item
        }
        func menu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
            let top = NSMenuItem()
            let menu = NSMenu(title: title)
            menu.items = items
            top.submenu = menu
            return top
        }
        let name = "Family Calendar"
        let main = NSMenu()
        main.items = [
            menu(name, [
                item("About \(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
                .separator(),
                item("Settings…", #selector(showSettings), ",", target: self),
                .separator(),
                item("Hide \(name)", #selector(NSApplication.hide(_:)), "h"),
                item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
                item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
                .separator(),
                // Leaves the menubar item running.
                item("Quit \(name)", #selector(NSApplication.terminate(_:)), "q"),
                item("Quit Completely", #selector(quitCompletely), "q", [.command, .option], target: self),
            ]),
            menu("File", [
                item("New Event", #selector(newEvent), "n", target: self),
                item("New Trip…", #selector(newTrip), "n", [.command, .shift], target: self),
                .separator(),
                item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
            ]),
            menu("Edit", [
                item("Undo", Selector(("undo:")), "z"),
                item("Redo", Selector(("redo:")), "z", [.command, .shift]),
                .separator(),
                item("Cut", #selector(NSText.cut(_:)), "x"),
                item("Copy", #selector(NSText.copy(_:)), "c"),
                item("Paste", #selector(NSText.paste(_:)), "v"),
                item("Select All", #selector(NSText.selectAll(_:)), "a"),
            ]),
            menu("View", [
                item("Week", #selector(weekView), "1", target: self),
                item("Day", #selector(dayView), "2", target: self),
                .separator(),
                item("Trips", #selector(showTrips), "t", [.command, .shift], target: self),
                .separator(),
                item("Today", #selector(goToToday), "t", target: self),
                item("Previous", #selector(previous), "[", target: self),
                item("Next", #selector(next), "]", target: self),
                .separator(),
                item("Refresh", #selector(refresh), "r", target: self),
            ]),
            menu("Window", [
                item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
                item("Zoom", #selector(NSWindow.performZoom(_:))),
            ]),
        ]
        return main
    }
}

/// Starting at login, as the menubar item alone. On by default the first
/// time the app runs from Applications; a copy run from a build folder never
/// registers itself.
enum LoginItem {
    static var isInstalled: Bool {
        let path = Bundle.main.bundlePath
        return path.hasPrefix("/Applications/") || path.hasPrefix(NSHomeDirectory() + "/Applications/")
    }

    static var isOn: Bool { SMAppService.mainApp.status == .enabled }

    static func set(_ on: Bool) {
        if on { try? SMAppService.mainApp.register() } else { try? SMAppService.mainApp.unregister() }
    }

    static func turnOnOnce() {
        let key = "calendar.loginItemOffered"
        guard isInstalled, !CommandLine.arguments.contains("--demo"), !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        set(true)
    }
}

/// A key that works from any app: ⌃⌥Space for the applet. Nil when another
/// app already has it.
final class Hotkey {
    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let action: @MainActor () -> Void

    init?(keyCode: Int, modifiers: Int, action: @escaping @MainActor () -> Void) {
        self.action = action
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let me = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, _, user in
            guard let user else { return noErr }
            let hotkey = Unmanaged<Hotkey>.fromOpaque(user).takeUnretainedValue()
            // Carbon delivers these on the main thread.
            MainActor.assumeIsolated { hotkey.action() }
            return noErr
        }, 1, &spec, me, &handler)
        let id = EventHotKeyID(signature: OSType(0x4D43_414C), id: 1)
        let status = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), id, GetApplicationEventTarget(), 0, &ref)
        if status != noErr {
            if let handler { RemoveEventHandler(handler) }
            return nil
        }
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        if let handler { RemoveEventHandler(handler) }
    }
}
