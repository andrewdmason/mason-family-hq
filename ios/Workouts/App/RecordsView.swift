import SwiftUI

/// Progress: how often you've trained lately, then personal records — each
/// movement family's best estimated 1RMs with their
/// trend against 90 days ago, then the best result on every benchmark.
struct RecordsView: View {
    let store: WorkoutStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    TrendCard(trend: store.trend, trained: Set(store.sessions.map(\.date)), today: store.today)

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Strength by family", symbol: "dumbbell.fill")
                        if let families = store.families {
                            let strong = families.filter { !$0.lifts.isEmpty }
                            if strong.isEmpty {
                                EmptyCard(
                                    symbol: "dumbbell", title: "No lifts yet",
                                    message: "Log a few lifts with loads and your strength stats will build here."
                                )
                            } else {
                                ForEach(strong) { FamilyCard(family: $0, today: store.today) }
                            }
                        } else {
                            ProgressView().controlSize(.large).frame(maxWidth: .infinity).padding(.vertical, 60)
                        }
                    }

                    if let benchmarks = store.benchmarks, !benchmarks.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Benchmark PRs", symbol: "trophy.fill")
                            VStack(spacing: 0) {
                                ForEach(Array(benchmarks.enumerated()), id: \.element.id) { index, benchmark in
                                    if index > 0 { Divider().padding(.leading, 64) }
                                    BenchmarkRowView(benchmark: benchmark)
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
            .navigationTitle("Personal Records")
            .toolbarTitleDisplayMode(.inlineLarge)
            .scrollEdgeEffectStyle(.soft, for: .top)
            .task { await store.loadProgress() }
            .refreshable { await store.loadProgress() }
        }
    }
}

/// One family's lifts, strongest first, each with a bar against the family's
/// best so the spread reads at a glance.
private struct FamilyCard: View {
    let family: FamilyProgress
    let today: String

    var body: some View {
        let lifts = Array(family.lifts.prefix(5))
        let top = lifts.map(\.bestE1rm).max() ?? 1
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(family.label)
                    .font(.system(.title2, design: .serif, weight: .semibold))
                Spacer()
                if let last = family.lastDate {
                    Text(WorkoutDay.relative(last, today: today))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(lifts) { lift in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(lift.name).font(.subheadline.weight(.medium))
                        Spacer(minLength: 8)
                        trend(lift)
                        Text(WorkoutRules.trim(lift.bestE1rm))
                            .font(.system(.title3, design: .rounded, weight: .bold))
                            .monospacedDigit()
                        Text("lb").font(.caption).foregroundStyle(.secondary)
                    }
                    GeometryReader { geo in
                        Capsule().fill(Color.primary.opacity(0.07))
                        Capsule()
                            .fill(LinearGradient(colors: [WorkoutStyle.gold, WorkoutStyle.ember], startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(6, geo.size.width * lift.bestE1rm / top))
                    }
                    .frame(height: 6)
                }
                .accessibilityElement(children: .combine)
            }
            Text(footer)
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .glassCard()
    }

    private var footer: String {
        let number = IntegerFormatStyle<Int>.number.locale(Locale(identifier: "en_US"))
        var text = "\(family.totalReps.formatted(number)) reps"
        if family.totalVolumeLoad > 0 { text += " · \(family.totalVolumeLoad.formatted(number)) lb volume" }
        return text
    }

    /// Against the best from more than 90 days ago.
    @ViewBuilder
    private func trend(_ lift: LiftStat) -> some View {
        if let prior = lift.priorE1rm {
            let delta = ((lift.bestE1rm - prior) * 10).rounded() / 10
            if delta > 0 {
                Label(WorkoutRules.trim(delta), systemImage: "arrow.up.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(WorkoutStyle.ember)
                    .accessibilityLabel("up \(WorkoutRules.trim(delta))")
            } else if delta < 0 {
                Label(WorkoutRules.trim(abs(delta)), systemImage: "arrow.down.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("down \(WorkoutRules.trim(abs(delta)))")
            } else {
                Image(systemName: "minus")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
                    .accessibilityLabel("no change")
            }
        } else {
            Chip(text: "New", color: WorkoutStyle.goldText)
        }
    }
}

private struct BenchmarkRowView: View {
    let benchmark: BenchmarkPR

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "trophy.fill")
                .font(.body.weight(.semibold))
                .foregroundStyle(WorkoutStyle.goldText)
                .frame(width: 38, height: 38)
                .background(WorkoutStyle.gold.opacity(0.18), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(benchmark.name)
                    .font(.system(.headline, design: .serif))
                Text("\(benchmark.attempts) \(benchmark.attempts == 1 ? "attempt" : "attempts") · last \(WorkoutDay.short(benchmark.lastDate))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(WorkoutRules.score(benchmark.scoreType, benchmark.best) ?? "—")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .monospacedDigit()
                if let level = benchmark.bestRxLevel {
                    Text(level.label).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }
}
