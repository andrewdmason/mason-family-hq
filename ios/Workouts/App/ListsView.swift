import SwiftUI

/// What's coming: how often you've trained lately, then the workouts on the
/// calendar and the ones opened but not finished, soonest first.
struct UpcomingView: View {
    let store: WorkoutStore
    @State private var path: [SessionRoute] = []

    var body: some View {
        let rows = store.todo
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let error = store.loadError {
                        LoadErrorBanner(message: error)
                    }
                    TrendCard(trend: store.trend, trained: Set(store.sessions.map(\.date)), today: store.today)

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "To do")
                        if rows.isEmpty {
                            EmptyCard(
                                symbol: "calendar.badge.clock", title: "Nothing queued",
                                message: "Workouts on your calendar show up here to open and log."
                            )
                        } else {
                            GlassEffectContainer(spacing: 10) {
                                VStack(spacing: 10) {
                                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                                        UpcomingRow(store: store, row: row) { path.append(SessionRoute(id: $0)) }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, WorkoutStyle.scrollEnd)
            }
            .scrollIndicators(.hidden)
            .background { WorkoutBackground() }
            .navigationTitle("Upcoming")
            .toolbarTitleDisplayMode(.inlineLarge)
            .scrollEdgeEffectStyle(.soft, for: .top)
            .refreshable { await store.load() }
            .navigationDestination(for: SessionRoute.self) { SessionScreen(store: store, id: $0.id) }
        }
    }
}

/// Workouts in the last 7 and 30 days against the window before, over a
/// strip of the last four weeks with a mark for each day trained.
private struct TrendCard: View {
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
                    HStack(spacing: 6) {
                        Text(WorkoutDay.label(row.date, today: store.today))
                            .font(.caption)
                            .foregroundStyle(row.date < store.today ? AnyShapeStyle(WorkoutStyle.goldText) : AnyShapeStyle(.secondary))
                        switch row {
                        case .event: Chip(text: "Calendar", symbol: "calendar", color: .secondary)
                        case .session: Chip(text: "Logging", symbol: "pencil.line")
                        }
                    }
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
            .contentShape(shape)
            .glassEffect(.regular.interactive(), in: shape)
        }
        .buttonStyle(.plain)
        .disabled(opening)
        .accessibilityHint(opening ? "Opening" : "")
    }
}

/// What's done, most recent first, a card per month.
struct HistoryView: View {
    let store: WorkoutStore
    @State private var path: [SessionRoute] = []

    var body: some View {
        let months = Self.months(store.done)
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    if months.isEmpty {
                        if store.loaded {
                            EmptyCard(
                                symbol: "checkmark.circle", title: "Nothing yet",
                                message: "Workouts you mark done collect here."
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
            Image(systemName: "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(WorkoutStyle.done)
                .frame(width: 32)
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
            Text("\(row.blockCount) \(row.blockCount == 1 ? "block" : "blocks")")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.bold))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
    }
}
