import MasonKit
import SwiftUI

/// Today as a wall of cards, one per active piece: tap to start its timer, tap
/// again to stop. The phone version of the website's quick log.
struct QuickLogView: View {
    @State private var store = PracticeStore()
    /// The piece whose long-press settings are open.
    @State private var editing: Piece?
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
        .sensoryFeedback(.impact(weight: .medium), trigger: editing) { _, new in new != nil }
        .sheet(item: $editing) { piece in
            PieceSettingsView(piece: piece, store: store)
        }
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
                        CardView(card: card, size: .large, store: store, now: now, dueID: nil) { editing = $0 }
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
                                CardView(card: card, size: .small, store: store, now: now, dueID: due) { editing = $0 }
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
    let onSettings: (Piece) -> Void

    var body: some View {
        if card.pieces.count == 1, let piece = card.pieces.first {
            PieceButton(label: card.title, piece: piece, size: size, store: store, now: now, due: dueID == piece.id, onSettings: onSettings)
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
                        PieceButton(label: QuickLog.movementLabel(piece.name, index: i), piece: piece, size: size, store: store, now: now, due: dueID == piece.id, onSettings: onSettings)
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

/// Tap to time it, long-press for its settings. Shows the name, what today's
/// entry for it says, and the live clock while it runs.
private struct PieceButton: View {
    let label: String
    let piece: Piece
    let size: CardSize
    let store: PracticeStore
    let now: Date
    let due: Bool
    let onSettings: (Piece) -> Void

    @State private var pressed = false

    var body: some View {
        let state = store.state(for: piece, at: now)
        let progress = state.goalSeconds > 0 ? min(1, Double(state.elapsedSeconds) / Double(state.goalSeconds)) : 0
        let goalReached = state.goalSeconds > 0 && state.elapsedSeconds >= state.goalSeconds
        let note = store.firstTask(for: piece)?.text ?? ""

        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(size == .large ? .body.weight(.medium) : .subheadline.weight(.medium))
                    .lineLimit(1)
                    .foregroundStyle(.primary)
                Spacer(minLength: 4)
                // One or the other: time in today, or how long since.
                Text(state.running
                     ? QuickLog.clock(state.elapsedSeconds)
                     : state.playedToday
                        ? QuickLog.total(state.elapsedSeconds)
                        : QuickLog.sinceShort(state.lastPracticed, today: store.today))
                    .font((size == .large ? Font.subheadline : .caption).monospacedDigit())
                    .fontWeight(state.running || state.playedToday ? .medium : .regular)
                    .foregroundStyle(state.running ? Color.red : state.playedToday ? Color.primary.opacity(0.8) : Color.secondary)
                    .fixedSize()
            }
            if !note.isEmpty {
                Text(note)
                    .font(size == .large ? .subheadline : .caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, size == .large ? 16 : 12)
        .padding(.vertical, size == .large ? 14 : 10)
        .frame(maxWidth: .infinity, minHeight: size == .large ? 96 : 64, alignment: .topLeading)
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
        .scaleEffect(pressed ? 0.985 : 1)
        .animation(.easeOut(duration: 0.1), value: pressed)
        .onTapGesture { store.tap(piece) }
        .onLongPressGesture(minimumDuration: 0.45) {
            onSettings(piece)
        } onPressingChanged: { pressed = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(state.running ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { store.tap(piece) }
        .accessibilityAction(named: "Settings") { onSettings(piece) }
    }

    private func background(_ state: PieceState) -> Color {
        if state.running { return .red.opacity(0.1) }
        if due { return .orange.opacity(0.1) }
        return Color(.secondarySystemGroupedBackground)
    }
}

/// The long-press sheet: move the piece between active, the maintenance
/// rotation, and the archive, and set what today's entry for it says and how
/// long it's for.
private struct PieceSettingsView: View {
    let piece: Piece
    let store: PracticeStore

    @Environment(\.dismiss) private var dismiss
    @State private var listing: PieceListing
    @State private var trackByMovement: Bool
    @State private var text: String
    @State private var minutes: Int
    /// The duration as it was, kept exact when the picker isn't touched.
    private let originalSeconds: Int
    @State private var saving = false
    @State private var error: String?

    private static let durations = [5, 10, 15, 20, 25, 30, 45, 60, 90]

    init(piece: Piece, store: PracticeStore) {
        self.piece = piece
        self.store = store
        let task = store.firstTask(for: piece)
        _listing = State(initialValue: PieceListing(piece))
        _trackByMovement = State(initialValue: !piece.wholeWork)
        _text = State(initialValue: task?.text ?? "")
        originalSeconds = task?.timerSeconds ?? 0
        _minutes = State(initialValue: originalSeconds / 60)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Status") {
                    Picker("Status", selection: $listing) {
                        ForEach(PieceListing.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                if store.hasMovements(piece) {
                    Section {
                        Toggle("Track by movement", isOn: $trackByMovement)
                    } footer: {
                        Text(switching
                             ? (trackByMovement
                                ? "Each movement gets its own card again, with its items as you left them."
                                : "The movements fold into one card for the whole piece. Their items are kept for when you switch back.")
                             : "")
                    }
                }
                if !switching {
                Section("Today") {
                    TextField("What to work on", text: $text, axis: .vertical)
                        .lineLimit(3...8)
                    Picker("Duration", selection: $minutes) {
                        Text("None").tag(0)
                        // An odd length set on the website stays selectable.
                        ForEach((Self.durations + [minutes]).filter { $0 > 0 }.uniqued().sorted(), id: \.self) {
                            Text("\($0) min").tag($0)
                        }
                    }
                }
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .navigationTitle(piece.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                    }
                }
            }
            .interactiveDismissDisabled(saving)
        }
        .presentationDetents([.medium, .large])
    }

    /// The switch is being flipped: today's item belongs to a card that's
    /// about to go, so it's set on the new card afterwards.
    private var switching: Bool { trackByMovement == piece.wholeWork }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if switching {
                let task = store.firstTask(for: piece)
                try await store.save(piece, status: listing, text: task?.text ?? "", seconds: task?.timerSeconds ?? 0)
                try await store.setTrackByMovement(piece, trackByMovement)
                dismiss()
                return
            }
            try await store.save(piece, status: listing, text: text, seconds: minutes == originalSeconds / 60 ? originalSeconds : minutes * 60)
            dismiss()
        } catch {
            self.error = "Couldn't save. Check your connection and try again."
        }
    }
}

private extension Array where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
