import SwiftUI

/// Today as a wall of cards, one per active piece: tap to start its timer, tap
/// again to stop. The phone version of the website's quick log.
struct QuickLogView: View {
    @State private var store = PracticeStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            content(now: context.date)
                .onChange(of: context.date) { _, _ in store.timer.enforceCutoff() }
        }
        .navigationTitle("Practice")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Link(destination: Config.website.appending(path: "practice")) {
                    Image(systemName: "safari")
                }
                .accessibilityLabel("Open the practice log on the web")
            }
        }
        .refreshable { await store.load() }
        .task { await store.load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.load() } }
        }
        .task {
            // An open screen turns over at midnight.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.checkDayChange()
            }
        }
        .sensoryFeedback(.impact, trigger: store.timer.running?.taskID)
    }

    @ViewBuilder
    private func content(now: Date) -> some View {
        let (current, maintenance) = store.cards
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header(now: now)

                if let error = store.loadError {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }

                if store.loaded && current.isEmpty && maintenance.isEmpty && store.loadError == nil {
                    Text("No active pieces. Mark some active in the repertoire on the web to log them here.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 24)
                }

                VStack(spacing: 12) {
                    ForEach(current) { card in
                        CardView(card: card, size: .large, store: store, now: now, dueID: nil)
                    }
                }

                if !maintenance.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("MAINTENANCE")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                            let due = store.dueMaintenanceID
                            ForEach(maintenance) { card in
                                CardView(card: card, size: .small, store: store, now: now, dueID: due)
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .overlay {
            if !store.loaded { ProgressView() }
        }
    }

    private func header(now: Date) -> some View {
        HStack {
            Text("Today")
                .font(.headline)
            Spacer()
            Text(QuickLog.total(store.todayTotal(at: now)))
                .font(.headline.monospacedDigit())
                .foregroundStyle(store.timer.running == nil ? Color.secondary : Color.red)
        }
    }
}

private enum CardSize { case large, small }

/// One card: a piece, or a work split into a segment per movement.
private struct CardView: View {
    let card: QuickCard
    let size: CardSize
    let store: PracticeStore
    let now: Date
    let dueID: UUID?

    var body: some View {
        if card.pieces.count == 1, let piece = card.pieces.first {
            PieceButton(label: card.title, piece: piece, size: size, store: store, now: now, due: dueID == piece.id)
                .clipShape(.rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(borderColor(running: store.state(for: piece, at: now).running, due: dueID == piece.id)))
        } else {
            let anyRunning = card.pieces.contains { store.state(for: $0, at: now).running }
            VStack(alignment: .leading, spacing: 0) {
                Text(card.title)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 8)
                Divider()
                HStack(spacing: 0) {
                    ForEach(Array(card.pieces.enumerated()), id: \.element.id) { i, piece in
                        if i > 0 { Divider() }
                        PieceButton(label: piece.name, piece: piece, size: size, store: store, now: now, due: dueID == piece.id)
                    }
                }
            }
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(.rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(borderColor(running: anyRunning, due: false)))
        }
    }

    private func borderColor(running: Bool, due: Bool) -> Color {
        if running { return .red.opacity(0.6) }
        if due { return .orange.opacity(0.6) }
        return Color(.separator)
    }
}

private struct PieceButton: View {
    let label: String
    let piece: Piece
    let size: CardSize
    let store: PracticeStore
    let now: Date
    let due: Bool

    var body: some View {
        let state = store.state(for: piece, at: now)
        let progress = state.goalSeconds > 0 ? min(1, Double(state.elapsedSeconds) / Double(state.goalSeconds)) : 0
        let goalReached = state.goalSeconds > 0 && state.elapsedSeconds >= state.goalSeconds
        let status = state.running
            ? QuickLog.clock(state.elapsedSeconds)
            : state.playedToday
                ? "Today · \(QuickLog.total(state.elapsedSeconds))"
                : QuickLog.daysSince(state.lastPracticed, today: store.today)

        Button {
            store.tap(piece)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top) {
                    Text(label)
                        .font(size == .large ? .body.weight(.medium) : .subheadline.weight(.medium))
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                    Spacer(minLength: 4)
                    if state.running {
                        Circle().fill(.red).frame(width: 9, height: 9).padding(.top, 5)
                    }
                }
                Spacer(minLength: 0)
                Text(status)
                    .font((size == .large ? Font.subheadline : .caption).monospacedDigit())
                    .fontWeight(state.running ? .medium : .regular)
                    .foregroundStyle(state.running ? Color.red : state.playedToday ? Color.primary.opacity(0.8) : Color.secondary)
            }
            .padding(.horizontal, size == .large ? 16 : 12)
            .padding(.vertical, size == .large ? 14 : 10)
            .frame(maxWidth: .infinity, minHeight: size == .large ? 96 : 64, alignment: .leading)
            .background(background(state))
            .overlay(alignment: .bottom) {
                if state.goalSeconds > 0 {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(Color(.systemFill))
                            Rectangle()
                                .fill(goalReached ? Color.green : state.running ? Color.red.opacity(0.7) : Color.primary.opacity(0.3))
                                .frame(width: geo.size.width * progress)
                        }
                    }
                    .frame(height: 4)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .accessibilityAddTraits(state.running ? .isSelected : [])
    }

    private func background(_ state: PieceState) -> Color {
        if state.running { return .red.opacity(0.1) }
        if due { return .orange.opacity(0.1) }
        return Color(.secondarySystemGroupedBackground)
    }
}

private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}
