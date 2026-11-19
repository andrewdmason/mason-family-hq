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
            if CommandLine.arguments.contains("--widget") {
                // The widget's own view at its size, for the simulator.
                TodayWidgetView(model: TodayWidgetModel(snapshot: store.snapshot, me: DemoCalendar.me, photos: [:], now: Date()))
                    .padding(16)
                    .frame(width: 364, height: 382)
                    .background(CalendarStyle.ground, in: .rect(cornerRadius: 28, style: .continuous))
                    .compositingGroup()
                    .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(red: 0.42, green: 0.45, blue: 0.52).gradient)
            } else if store.isDemo {
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
            if let new { store.open(for: new, email: session.email) }
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
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { nav.screenHeight = $0 }
        .modifier(ConvertAlert(active: nav.card == nil && !nav.showSettings))
        .environment(nav)
        .animation(.snappy, value: nav.peek)
        .animation(.snappy, value: nav.problem)
        .sheet(item: $nav.card) { request in
            EventCard(request: request, me: me)
                .environment(nav)
        }
        .sheet(isPresented: $nav.showSettings) {
            SettingsView(me: me)
        }
        .task { await store.sync() }
        .onOpenURL { url in
            // From the widget: an event to open, or just today.
            nav.peek = nil
            if url.host() == "event", let id = UUID(uuidString: url.lastPathComponent), let item = store.board.item(id) {
                nav.day = item.day
                nav.open(item, in: store)
            } else if url.host() == "today" {
                nav.goToToday()
            }
        }
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

/// Google won't let an event it made from an email be changed. Offer to swap
/// it for a copy that can be.
struct ConvertAlert: ViewModifier {
    /// Whether this is the view to ask from just now: a sheet asks while it's
    /// up, the calendar underneath when nothing is.
    let active: Bool
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav

    func body(content: Content) -> some View {
        let offer = Binding<Conversion?>(
            get: { active ? store.conversion : nil },
            set: { if $0 == nil, active { store.conversion = nil } }
        )
        content.alert(
            "Make this an editable event?", isPresented: Binding(get: { offer.wrappedValue != nil }, set: { if !$0 { offer.wrappedValue = nil } }),
            presenting: offer.wrappedValue
        ) { conversion in
            Button("Replace") {
                let nav = nav
                store.convert(conversion) { nav.problem = $0 }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("Google created this from an email, so it can't be changed. Replace it with a copy you can edit?")
        }
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

/// The card raised by tapping a pin: enough to know what it is. A tap or a
/// swipe up opens the whole event; a swipe down puts the card away.
struct PeekCard: View {
    let item: EventItem
    @Environment(CalendarStore.self) private var store
    @Environment(CalendarNav.self) private var nav
    @State private var drag: CGFloat = 0

    var body: some View {
        Button {
            nav.open(item, in: store)
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
        // Ahead of the button's own tap, so a swipe that starts on the card
        // is a swipe: up opens the event, down puts the card away.
        .highPriorityGesture(
            DragGesture(minimumDistance: 8)
                .onChanged { value in
                    // Follows the finger down; resists a little going up.
                    let y = value.translation.height
                    drag = y > 0 ? y : y / 3
                }
                .onEnded { value in
                    let y = value.translation.height
                    let flick = value.predictedEndTranslation.height
                    if y < -24 || flick < -90 {
                        nav.open(item, in: store)
                    } else if y > 40 || flick > 120 {
                        nav.peek = nil
                    }
                    withAnimation(.snappy) { drag = 0 }
                }
        )
        .accessibilityAction(named: "Dismiss") { nav.peek = nil }
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
        nav.compose(for: member, from: times.start, to: times.end)
    }
}
