import SwiftUI

/// Where the app opens: today's workout and what's coming, soonest first,
/// each a tap from logging and a swipe from gone. Nothing from before today
/// is here; that's History.
struct UpcomingView: View {
    let store: WorkoutStore
    let email: String?
    @State private var path: [SessionRoute] = []
    @State private var deleting: FocusItem?

    var body: some View {
        let focus = store.focus
        let rows = store.todo
        NavigationStack(path: $path) {
            List {
                Group {
                    if let error = store.loadError {
                        LoadErrorBanner(message: error)
                    }
                    if rows.isEmpty {
                        EmptyCard(
                            symbol: "calendar.badge.clock", title: "Nothing queued",
                            message: "Workouts on your calendar show up here to open and log."
                        )
                    }
                    ForEach(rows, id: \.id) { row in
                        UpcomingRow(store: store, row: row) { path.append(SessionRoute(id: $0)) }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button("Delete", systemImage: "trash") { deleting = row }
                                    .tint(.red)
                            }
                    }
                }
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .contentMargins(.bottom, WorkoutStyle.scrollEnd, for: .scrollContent)
            .animation(.default, value: rows.map(\.id))
            .scrollIndicators(.hidden)
            .background { WorkoutBackground(mood: mood(focus)) }
            .navigationTitle("Upcoming")
            .toolbarTitleDisplayMode(.inlineLarge)
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { AccountMenu(email: email, store: store) }
            }
            .refreshable { await store.load() }
            .navigationDestination(for: SessionRoute.self) { SessionScreen(store: store, id: $0.id) }
            .confirmationDialog(
                "Delete \(deleting?.title ?? "this workout")?",
                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                titleVisibility: .visible, presenting: deleting
            ) { row in
                Button("Delete workout", role: .destructive) {
                    Task { await store.dismiss(row) }
                }
            } message: { _ in
                Text("This deletes it from your calendar too, with anything logged for it. It can't be undone.")
            }
        }
    }
}

extension UpcomingView {
    fileprivate func mood(_ focus: TodayWorkout) -> WorkoutMood {
        guard focus.today != nil else { return .rest }
        return focus.todayCompleted ? .done : .work
    }
}

/// Workouts in the last 7 and 30 days against the window before, over a
/// strip of the last four weeks with a mark for each day trained.
struct TrendCard: View {
    let trend: WorkoutTrend
    let trained: Set<String>
    let today: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 0) {
                period("Last 7 days", current: trend.last7, previous: trend.prev7)
                period("Last 30 days", current: trend.last30, previous: trend.prev30)
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 3) {
                    ForEach((0..<28).reversed(), id: \.self) { ago in
                        let day = WorkoutDay.daysAgo(today, ago)
                        let on = trained.contains(day)
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(on ? AnyShapeStyle(WorkoutStyle.clay.gradient) : AnyShapeStyle(Color.primary.opacity(0.08)))
                            .frame(height: on ? 26 : 12)
                            .frame(maxWidth: .infinity)
                            .overlay(alignment: .bottom) {
                                if ago == 0 {
                                    Circle().fill(WorkoutStyle.accent).frame(width: 4, height: 4).offset(y: 8)
                                }
                            }
                    }
                }
                .frame(height: 26, alignment: .bottom)
                .padding(.bottom, 6)
                Eyebrow("Last four weeks")
            }
            .accessibilityHidden(true)
        }
        .padding(18)
        .glassCard()
    }

    private func period(_ label: String, current: Int, previous: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Eyebrow(label)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text("\(current)")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(current)))
                Text(current == 1 ? "workout" : "workouts")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            delta(current: current, previous: previous)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func delta(current: Int, previous: Int) -> some View {
        let diff = current - previous
        if current == 0 && previous == 0 {
            Text("no data").font(.caption).foregroundStyle(.tertiary)
        } else if diff == 0 {
            Label("same as prior", systemImage: "minus").font(.caption).foregroundStyle(.secondary)
        } else {
            Label("\(diff > 0 ? "+" : "−")\(abs(diff)) vs prior", systemImage: diff > 0 ? "arrow.up.right" : "arrow.down.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(diff > 0 ? AnyShapeStyle(WorkoutStyle.ember) : AnyShapeStyle(.secondary))
        }
    }
}

private struct UpcomingRow: View {
    let store: WorkoutStore
    let row: FocusItem
    let show: (UUID) -> Void

    var body: some View {
        let opening: Bool = if case .event(let event) = row { store.opening.contains(event.id) } else { false }
        let isToday = row.date == store.today
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        Button {
            switch row {
            case .session(let session): show(session.id)
            case .event(let event): Task { if let id = await store.open(event) { show(id) } }
            }
        } label: {
            HStack(spacing: 14) {
                DateBadge(day: row.date, filled: isToday)
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Text(WorkoutDay.label(row.date, today: store.today))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if opening { ProgressView() }
            }
            .padding(14)
            .contentShape(shape)
            .glassEffect(.regular.interactive(), in: shape)
        }
        .buttonStyle(.plain)
        .disabled(opening)
        .accessibilityHint(opening ? "Opening" : "")
    }
}

/// What's behind, most recent first, a card per month: workouts done, and
/// ones opened before today and never marked done, still there to log.
struct HistoryView: View {
    let store: WorkoutStore
    @State private var path: [SessionRoute] = []

    var body: some View {
        let months = Self.months(store.history)
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    if months.isEmpty {
                        if store.loaded {
                            EmptyCard(
                                symbol: "checkmark.circle", title: "Nothing yet",
                                message: "Workouts from before today collect here."
                            )
                        } else {
                            ProgressView().controlSize(.large).frame(maxWidth: .infinity).padding(.vertical, 120)
                        }
                    }
                    ForEach(months, id: \.name) { month in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .firstTextBaseline) {
                                SectionHeader(title: month.name)
                                Spacer()
                                Text("\(month.rows.count) \(month.rows.count == 1 ? "workout" : "workouts")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .padding(.trailing, 6)
                            }
                            VStack(spacing: 0) {
                                ForEach(Array(month.rows.enumerated()), id: \.element.id) { index, row in
                                    if index > 0 { Divider().padding(.leading, 56) }
                                    NavigationLink(value: SessionRoute(id: row.id)) {
                                        HistoryRow(row: row, today: store.today)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.vertical, 4)
                            .glassCard(radius: 24)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, WorkoutStyle.scrollEnd)
            }
            .scrollIndicators(.hidden)
            .background { WorkoutBackground() }
            .navigationTitle("History")
            .toolbarTitleDisplayMode(.inlineLarge)
            .scrollEdgeEffectStyle(.soft, for: .top)
            .refreshable { await store.load() }
            .navigationDestination(for: SessionRoute.self) { SessionScreen(store: store, id: $0.id) }
        }
    }

    private static func months(_ rows: [SessionSummary]) -> [(name: String, rows: [SessionSummary])] {
        var months: [(name: String, rows: [SessionSummary])] = []
        for row in rows {
            let name = WorkoutDay.month(row.date)
            if months.last?.name == name {
                months[months.count - 1].rows.append(row)
            } else {
                months.append((name, [row]))
            }
        }
        return months
    }
}

private struct HistoryRow: View {
    let row: SessionSummary
    let today: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: row.completed ? "checkmark.circle.fill" : "circle.dashed")
                .font(.title2)
                .foregroundStyle(row.completed ? AnyShapeStyle(WorkoutStyle.done) : AnyShapeStyle(WorkoutStyle.goldText))
                .frame(width: 32)
                .accessibilityLabel(row.completed ? "Done" : "Unfinished")
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                Text("\(WorkoutDay.short(row.date)) · \(WorkoutDay.relative(row.date, today: today))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if row.completed {
                Text("\(row.blockCount) \(row.blockCount == 1 ? "block" : "blocks")")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            } else {
                Chip(text: "Unfinished", color: WorkoutStyle.goldText)
            }
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.bold))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
    }
}
