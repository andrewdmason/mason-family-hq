import MasonKit
import SwiftUI

@main
struct CalendarApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(CalendarStyle.accent)
        }
    }
}

struct RootView: View {
    @State private var session = Session.shared
    @State private var store = CalendarStore.isDemoLaunch ? CalendarStore(demo: DemoCalendar.make()) : CalendarStore()
    @State private var prefs = Prefs()

    var body: some View {
        Group {
            if store.isDemo {
                CalendarScreen(me: DemoCalendar.me, opensOn: prefs.opensOn)
            } else if !session.checked {
                ProgressView()
            } else if !session.isSignedIn {
                SignInView(appName: "Calendar", symbol: "calendar")
                    .tint(CalendarStyle.olive)
                    .background(CalendarStyle.ground)
            } else if session.role != nil {
                CalendarScreen(me: session.email?.lowercased(), opensOn: prefs.opensOn)
                    .appUpdateBanner(slug: "calendar", appName: "Calendar", tint: CalendarStyle.olive)
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
        .environment(store)
        .environment(prefs)
        .animation(.default, value: session.isSignedIn)
        .onChange(of: session.userID, initial: true) { old, new in
            // Another member signing in starts from nothing of the last one's.
            if old != nil, old != new { store.forget() }
            if let new { store.open(for: new) }
        }
    }
}

/// The calendar: the day or schedule filling the screen, with the top bar and
/// the bottom bar floating over it in glass.
struct CalendarScreen: View {
    let me: String?
    @State private var nav: CalendarNav
    @Environment(CalendarStore.self) private var store
    @Environment(Prefs.self) private var prefs
    @Environment(\.scenePhase) private var scenePhase

    init(me: String?, opensOn: ViewMode) {
        self.me = me
        _nav = State(initialValue: CalendarNav(view: opensOn))
    }

    var body: some View {
        @Bindable var nav = nav
        ZStack {
            CalendarStyle.ground.ignoresSafeArea()

            Group {
                switch nav.view {
                case .day: DayPager(me: me)
                case .schedule: ScheduleView(me: me)
                }
            }
            .ignoresSafeArea(edges: [.top, .bottom])

            VStack(spacing: 0) {
                TopBar()
                    .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { nav.topInset = $0 }
                Spacer(minLength: 0)
            }

            VStack(spacing: 10) {
                Spacer(minLength: 0)
                if let peek = nav.peek {
                    PeekCard(item: peek)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                if let problem = nav.problem {
                    ProblemBanner(message: problem)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                FloatingBar(me: me)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 4)
        }
        .environment(nav)
        .animation(.snappy, value: nav.peek)
        .animation(.snappy, value: nav.problem)
        .sheet(item: $nav.opened) { item in
            EventSheet(itemID: item.id, me: me)
                .environment(nav)
        }
        .sheet(item: $nav.editor) { request in
            EventEditor(request: request)
                .environment(nav)
        }
        .sheet(isPresented: $nav.showSettings) {
            SettingsView(me: me)
        }
        .task { await store.sync() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.sync() } }
        }
        .onChange(of: nav.problem) { _, problem in
            guard let problem else { return }
            Task {
                try? await Task.sleep(for: .seconds(4))
                if nav.problem == problem { nav.problem = nil }
            }
        }
        .sensoryFeedback(.selection, trigger: nav.day)
        .sensoryFeedback(.error, trigger: nav.problem) { _, new in new != nil }
    }
}

/// A change that didn't go through.
struct ProblemBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle.fill")
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .glassEffect(.regular.tint(.red.opacity(0.18)), in: .capsule)
    }
}

/// The card raised by tapping a pin: enough to know what it is, and a tap
/// away from the whole event.
struct PeekCard: View {
    let item: EventItem
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @State private var drag: CGFloat = 0

    var body: some View {
        Button {
            nav.open(item, in: store.board)
        } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(CalendarStyle.muted(item.color))
                    .frame(width: 4, height: 38)
                Avatar(member: store.board.member(store.board.opened(item).event.memberEmail), size: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(CalendarRules.timeRange(item.event))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
        .offset(y: drag)
        .gesture(
            DragGesture(minimumDistance: 8)
                .onChanged { drag = max(0, $0.translation.height) }
                .onEnded { value in
                    if value.translation.height > 44 { nav.peek = nil }
                    withAnimation(.snappy) { drag = 0 }
                }
        )
    }
}

/// The bottom bar: the views and Settings on the left, a new event on the right.
struct FloatingBar: View {
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    var body: some View {
        @Bindable var nav = nav
        GlassEffectContainer {
            HStack {
                Menu {
                    Picker("View", selection: $nav.view) {
                        ForEach(ViewMode.allCases) { view in
                            Label(view.title, systemImage: view.symbol).tag(view)
                        }
                    }
                    Divider()
                    Button("Settings", systemImage: "gearshape") { nav.showSettings = true }
                } label: {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 52, height: 52)
                        .contentShape(.circle)
                }
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Views and settings")

                Spacer()

                Button {
                    compose()
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 52, height: 52)
                        .contentShape(.circle)
                }
                .glassEffect(.regular.tint(CalendarStyle.olive.opacity(0.35)).interactive(), in: .circle)
                .accessibilityLabel("New event")
            }
            .foregroundStyle(.primary)
        }
    }

    private func compose() {
        guard let member = me ?? store.board.members.first?.email else { return }
        let times = CalendarRules.newEventTimes(on: nav.day)
        nav.peek = nil
        nav.editor = EditorRequest(event: nil, draft: EventDraft(memberEmail: member, start: times.start, end: times.end))
    }
}
