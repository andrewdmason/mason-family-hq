import MasonKit
import SwiftUI

/// What the window holds: the calendar once one of the family is signed in,
/// the sign-in screen until then.
struct WindowRoot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let session = model.session
        Group {
            if model.ready {
                CalendarWindow()
            } else if !session.checked {
                ProgressView()
            } else if !session.isSignedIn {
                SignInView(appName: "Calendar", symbol: "calendar")
                    .tint(CalendarStyle.olive)
                    .frame(maxWidth: 380, maxHeight: 460)
            } else {
                ContentUnavailableView {
                    Label("Not available", systemImage: "calendar")
                } description: {
                    Text("Calendar is for the family's accounts. You're signed in as \(session.email ?? "someone else").")
                } actions: {
                    Button("Sign out") { Task { await session.signOut() } }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CalendarStyle.ground)
        .environment(model.store)
        .tint(CalendarStyle.accent)
    }
}

/// The calendar in the window: Week or Day under a glass toolbar. The month's
/// name opens the month to jump by; T is today, the arrows move a week or a
/// day, W and D switch views.
struct CalendarWindow: View {
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var store

    var body: some View {
        @Bindable var prefs = model.prefs
        @Bindable var window = model.window
        let days = prefs.view == .week ? (0..<7).map { window.day.weekStart().adding(days: $0) } : [window.day]
        CalendarGrid(days: days, style: prefs.view)
            .overlay(alignment: .bottom) { banners }
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Button {
                        window.monthOpen.toggle()
                    } label: {
                        HStack(spacing: 5) {
                            // A week across two months is named for the one most of it is in.
                            Text(MacStyle.monthTitle(prefs.view == .week ? days[3] : window.day))
                                .font(.system(size: 17, weight: .semibold, design: .serif))
                            Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 4)
                    }
                    .help("Jump to a date")
                    .popover(isPresented: $window.monthOpen, arrowEdge: .bottom) {
                        MonthJump(day: window.day) { day in
                            window.day = day
                            window.monthOpen = false
                        }
                        .environment(store)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Picker("View", selection: $prefs.view) {
                        ForEach(WindowView.allCases) { view in
                            Text(view.title).tag(view)
                        }
                    }
                    .pickerStyle(.segmented)
                    .help("Week (W) or Day (D)")
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button("Today") {
                        withAnimation(.snappy) { window.day = .today() }
                    }
                    .help("Today (T)")
                    ControlGroup {
                        Button("Earlier", systemImage: "chevron.left") { step(-1) }
                        Button("Later", systemImage: "chevron.right") { step(1) }
                    }
                    Button("New Event", systemImage: "plus") { compose(days) }
                        .help("New event (⌘N)")
                }
            }
            .confirmationDialog(
                "This is a repeating event", isPresented: Binding(get: { window.pending != nil }, set: { if !$0 { window.pending = nil } }),
                titleVisibility: .visible, presenting: window.pending
            ) { pending in
                Button("This Event Only") { save(pending, series: false) }
                Button("All Events") { save(pending, series: true) }
                Button("Cancel", role: .cancel) {}
            }
    }

    private func step(_ direction: Int) {
        let days = model.prefs.view == .week ? 7 : 1
        withAnimation(.snappy) { model.window.day = model.window.day.adding(days: direction * days) }
    }

    private func compose(_ days: [Day]) {
        guard let me = model.me else { return }
        let today = Day.today()
        let day = days.contains(today) ? today : days[0]
        let start = CalendarRules.minutes(CalendarRules.newEventTimes(on: day, now: Clock.now()).start)
        model.window.compose(for: me, on: day, from: start, to: min(start + 60, 24 * 60), reveal: true, in: store)
    }

    private func save(_ pending: PendingSave, series: Bool) {
        var save = pending.save
        save.series = series
        let window = model.window
        store.save(save) { window.report($0) }
    }

    /// What needs saying, floating over the foot of the calendar.
    @ViewBuilder
    private var banners: some View {
        let window = model.window
        VStack(spacing: 8) {
            if let conversion = store.conversion, window.card == nil {
                ConvertBanner(conversion: conversion) { window.report($0) }
                    .frame(maxWidth: 420)
                    .paperGlass(16)
            }
            if let problem = window.problem {
                ProblemBanner(message: problem)
                    .frame(maxWidth: 520)
                    .paperGlass(12)
            }
            if store.offline {
                Label("Offline: showing the calendar as last read", systemImage: "wifi.slash")
                    .font(.footnote.weight(.medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .paperGlass(14)
            }
        }
        .padding(.bottom, 14)
        .animation(.snappy, value: window.problem)
    }
}

/// The month, to jump to a day in it.
private struct MonthJump: View {
    let day: Day
    let pick: (Day) -> Void
    @State private var shown: Day

    init(day: Day, pick: @escaping (Day) -> Void) {
        self.day = day
        self.pick = pick
        _shown = State(initialValue: day)
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text(MacStyle.monthTitle(shown))
                    .font(.system(size: 15, weight: .semibold, design: .serif))
                Spacer()
                Button("Earlier", systemImage: "chevron.left") { shown = shown.monthStart.adding(months: -1) }
                Button("Later", systemImage: "chevron.right") { shown = shown.monthStart.adding(months: 1) }
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            DayPicker(anchor: shown, selected: day, wholeMonth: true, pick: pick)
        }
        .padding(14)
        .frame(width: 280)
    }
}

/// Settings: who shows and in what order, hidden events, starting at login,
/// and the account. They're this Mac's own.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var startsAtLogin = LoginItem.isOn

    var body: some View {
        @Bindable var prefs = model.prefs
        let store = model.store
        let members = prefs.ordered(store.board.members)
        Form {
            Section("People") {
                ForEach(Array(members.enumerated()), id: \.element.id) { index, member in
                    HStack(spacing: 10) {
                        Avatar(member: member, size: 24)
                        Text(member.firstName)
                        if member.email == model.me { Text("you").foregroundStyle(.secondary) }
                        Spacer()
                        Button("Move up", systemImage: "chevron.up") { move(members, index, -1) }
                            .disabled(index == 0)
                        Button("Move down", systemImage: "chevron.down") { move(members, index, 1) }
                            .disabled(index == members.count - 1)
                        Toggle("Show \(member.firstName)", isOn: Binding(
                            get: { !prefs.hidden.contains(member.email) },
                            set: { shown in
                                if shown { prefs.hidden.remove(member.email) } else { prefs.hidden.insert(member.email) }
                            }
                        ))
                        .labelsHidden()
                        .disabled(member.email == model.me)
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                }
            }
            Section("Hidden events") {
                Toggle("Show hidden events", isOn: $prefs.showHidden)
                ForEach(store.hides) { hide in
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(hide.title)
                            Text(hide.scope == .series ? "Every occurrence" : hide.start.map { $0.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) } ?? "One event")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Show") { store.unhide([hide]) { model.window.report($0) } }
                    }
                }
            }
            Section("This Mac") {
                Toggle("Start at login, in the menu bar", isOn: Binding(
                    get: { startsAtLogin },
                    set: { on in
                        LoginItem.set(on)
                        startsAtLogin = LoginItem.isOn
                    }
                ))
                .disabled(!LoginItem.isInstalled)
                if !LoginItem.isInstalled {
                    Text("Move Family Calendar to Applications to have it start at login.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Menu bar shortcut") {
                    Text(model.shortcutTaken ? "⌃⌥Space is in use by another app" : "⌃⌥Space")
                        .foregroundStyle(model.shortcutTaken ? .red : .secondary)
                }
            }
            if !store.isDemo {
                Section("Account") {
                    LabeledContent("Signed in as") { Text(model.session.email ?? "nobody").foregroundStyle(.secondary) }
                    Button("Sign Out") { Task { await model.session.signOut() } }
                        .disabled(!model.session.isSignedIn)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 520)
        .tint(CalendarStyle.olive)
        .environment(store)
    }

    private func move(_ members: [Member], _ index: Int, _ by: Int) {
        var order = members.map(\.email)
        order.swapAt(index, index + by)
        model.prefs.order = order
    }
}
