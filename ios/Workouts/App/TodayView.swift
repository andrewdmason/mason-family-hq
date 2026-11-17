import MasonKit
import SwiftUI

/// Today's workout, open and ready to log. A workout still only on the
/// calendar is opened (and structured) as the screen appears; with nothing on,
/// it's a rest day and a look at what's next.
struct TodayView: View {
    let store: WorkoutStore
    let email: String?
    let showUpcoming: () -> Void
    @State private var path: [SessionRoute] = []

    var body: some View {
        let focus = store.focus
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let error = store.loadError {
                        LoadErrorBanner(message: error)
                    }

                    switch focus.today {
                    case .session(let session):
                        SessionContent(store: store, sessionID: session.id)
                        if focus.todayCompleted, let next = focus.next {
                            NextUpCard(store: store, next: next) { path.append(SessionRoute(id: $0)) }
                        }
                    case .event(let event):
                        OpeningCard(event: event, opening: store.opening.contains(event.id)) {
                            Task { await store.open(event) }
                        }
                    case nil:
                        if store.loaded {
                            RestDay(showUpcoming: showUpcoming)
                            if let next = focus.next {
                                NextUpCard(store: store, next: next) { path.append(SessionRoute(id: $0)) }
                            }
                        } else {
                            ProgressView()
                                .controlSize(.large)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 120)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, WorkoutStyle.scrollEnd)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .background { WorkoutBackground(mood: mood(focus)) }
            .navigationTitle("Today")
            .navigationSubtitle(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
            .navigationBarTitleDisplayMode(.inline)
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { AccountMenu(email: email, store: store) }
            }
            .refreshable { await store.load() }
            .navigationDestination(for: SessionRoute.self) { SessionScreen(store: store, id: $0.id) }
        }
    }

    private func mood(_ focus: TodayWorkout) -> WorkoutMood {
        guard focus.today != nil else { return .rest }
        return focus.todayCompleted ? .done : .work
    }
}

/// Today's workout while it's being opened from the calendar, or after that
/// didn't work.
private struct OpeningCard: View {
    let event: WorkoutEvent
    let opening: Bool
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("From calendar", systemImage: "calendar")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
            Text(event.title)
                .font(.system(.largeTitle, design: .serif, weight: .bold))
            if opening {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Structuring today's workout…")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Today's workout couldn't be opened.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Try again", systemImage: "arrow.clockwise", action: retry)
                    .buttonStyle(.glassProminent)
                    .tint(WorkoutStyle.clay)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .glassCard()
    }
}

private struct RestDay: View {
    let showUpcoming: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "figure.cooldown")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(WorkoutStyle.accent)
            Text("Rest day")
                .font(.system(.largeTitle, design: .serif, weight: .bold))
            Text("Nothing scheduled today. Enjoy the recovery.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(action: showUpcoming) {
                Label("See upcoming workouts", systemImage: "calendar")
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.glass)
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 44)
        .padding(.horizontal, 24)
        .glassCard()
    }
}

/// The workout after today's, a tap away.
struct NextUpCard: View {
    let store: WorkoutStore
    let next: FocusItem
    let show: (UUID) -> Void

    var body: some View {
        let opening: Bool = if case .event(let event) = next { store.opening.contains(event.id) } else { false }
        Button {
            switch next {
            case .session(let session): show(session.id)
            case .event(let event): Task { if let id = await store.open(event) { show(id) } }
            }
        } label: {
            HStack(spacing: 14) {
                DateBadge(day: next.date)
                VStack(alignment: .leading, spacing: 2) {
                    Eyebrow("Next up · \(WorkoutDay.label(next.date, today: store.today))", color: WorkoutStyle.accent)
                    Text(next.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                if opening {
                    ProgressView()
                } else {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(14)
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(opening)
    }
}
