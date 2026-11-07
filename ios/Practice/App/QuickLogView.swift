import MasonKit
import SwiftUI

/// Today as a wall of glass tiles, one per active piece: tap to start its
/// timer, tap again to stop, long-press for its settings. What's running
/// floats at the bottom with a Stop button.
struct QuickLogView: View {
    let store: PracticeStore
    /// The piece whose long-press settings are open.
    @State private var editing: Piece?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            content(now: context.date)
                .onChange(of: context.date) { _, _ in store.timer.enforceCutoff() }
        }
        .background { PracticeBackground(running: store.timer.running != nil) }
        .navigationTitle("Practice")
        .navigationSubtitle(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
        .toolbarTitleDisplayMode(.inlineLarge)
        .scrollEdgeEffectStyle(.soft, for: .top)
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
            VStack(alignment: .leading, spacing: 28) {
                TodayHeader(store: store, now: now)

                if let error = store.loadError {
                    Label(error, systemImage: "wifi.exclamationmark")
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .glassEffect(.regular.tint(.red.opacity(0.18)), in: .capsule)
                }

                if store.loaded && current.isEmpty && maintenance.isEmpty && store.loadError == nil {
                    ContentUnavailableView(
                        "Nothing on the stand",
                        systemImage: "music.note.list",
                        description: Text("Mark pieces active in the repertoire on the web to log them here.")
                    )
                    .padding(.vertical, 24)
                }

                if !current.isEmpty {
                    VStack(spacing: 12) {
                        ForEach(current) { card in
                            CardView(card: card, size: .large, store: store, now: now, dueID: nil) { editing = $0 }
                        }
                    }
                }

                if !maintenance.isEmpty {
                    let due = store.dueMaintenanceID
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(
                            title: "Maintenance",
                            detail: due.flatMap { id in store.pieces.first { $0.id == id }?.name }.map { "Next up: \($0)" }
                        )
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                            ForEach(maintenance) { card in
                                CardView(card: card, size: .small, store: store, now: now, dueID: due) { editing = $0 }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 24)
            .animation(.smooth, value: store.timer.running?.taskID)
        }
        .scrollIndicators(.hidden)
        .overlay {
            if !store.loaded { ProgressView().controlSize(.large) }
        }
        .safeAreaInset(edge: .bottom) {
            if let run = store.timer.running, run.date == store.today {
                NowPlayingBar(
                    name: run.pieceName,
                    seconds: store.runningPiece.map { store.state(for: $0, at: now).elapsedSeconds } ?? run.taskElapsed(at: now),
                    todaySeconds: store.todayTotal(at: now)
                ) { store.stopRunning() }
                .padding(.horizontal, 16)
                .padding(.bottom, 4)
                .transition(.move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.9)))
            }
        }
        .animation(.spring(duration: 0.45, bounce: 0.25), value: store.timer.running?.taskID)
    }
}

// MARK: - Today

/// The day's total, big, against what's planned for it.
private struct TodayHeader: View {
    let store: PracticeStore
    let now: Date

    var body: some View {
        let total = store.todayTotal(at: now)
        let goal = store.todayGoal
        let running = store.timer.running != nil
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Today")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(QuickLog.total(total))
                    .font(.system(size: 54, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(running ? PracticeStyle.ember : .primary)
                    .contentTransition(.numericText(value: Double(total / 60)))
                    .animation(.snappy, value: total / 60)
                Text(subtitle(total: total, goal: goal))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if goal > 0 {
                GoalRing(progress: Double(total) / Double(goal), running: running)
                    .frame(width: 76, height: 76)
                    .padding(14)
                    .glassEffect(.regular, in: .circle)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func subtitle(total: Int, goal: Int) -> String {
        guard goal > 0 else { return total > 0 ? "Practiced so far" : "Tap a piece to start" }
        let left = goal - total
        return left > 0 ? "\(QuickLog.total(left)) to go of \(QuickLog.total(goal))" : "All \(QuickLog.total(goal)) planned done"
    }
}

private struct SectionHeader: View {
    let title: String
    let detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.title3.bold())
            Spacer()
            if let detail {
                Text(detail)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PracticeStyle.dueText)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - Cards

private enum CardSize { case large, small }

/// One card: a piece as a glass tile, or a work as its title over a row of
/// movement tiles.
private struct CardView: View {
    let card: QuickCard
    let size: CardSize
    let store: PracticeStore
    let now: Date
    let dueID: UUID?
    let onSettings: (Piece) -> Void

    var body: some View {
        if card.pieces.count == 1, let piece = card.pieces.first {
            PieceTile(piece: piece, label: card.title, size: size, store: store, now: now, due: dueID == piece.id, onSettings: onSettings)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(card.title)
                        .font(size == .large ? .headline : .subheadline.weight(.semibold))
                        .lineLimit(1)
                    if let composer = card.pieces.first?.composer, size == .large {
                        Text(composer)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 6)
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(Array(card.pieces.enumerated()), id: \.element.id) { i, piece in
                            MovementTile(
                                label: QuickLog.movementLabel(piece.name, index: i), piece: piece, size: size,
                                store: store, now: now, due: dueID == piece.id, onSettings: onSettings
                            )
                        }
                    }
                }
            }
            .padding(.top, size == .large ? 4 : 0)
        }
    }
}

/// What a tile says about today's time on a piece: the live clock while it
/// runs, today's total once it's been played, else how long since.
private struct TimeReadout: View {
    let state: PieceState
    let today: String
    let size: CardSize

    var body: some View {
        let goalReached = state.goalSeconds > 0 && state.elapsedSeconds >= state.goalSeconds
        VStack(alignment: .trailing, spacing: 2) {
            HStack(spacing: 4) {
                if goalReached && !state.running {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(PracticeStyle.done)
                        .transition(.scale.combined(with: .opacity))
                }
                Text(text)
                    .font(font)
                    .monospacedDigit()
                    .foregroundStyle(state.running ? PracticeStyle.ember : state.playedToday ? Color.primary : Color.secondary)
                    .contentTransition(.numericText())
            }
            if state.goalSeconds > 0 && size == .large {
                Text("of \(QuickLog.total(state.goalSeconds))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .fixedSize()
    }

    private var text: String {
        if state.running { return QuickLog.clock(state.elapsedSeconds) }
        if state.playedToday { return QuickLog.total(state.elapsedSeconds) }
        return QuickLog.sinceShort(state.lastPracticed, today: today)
    }

    private var font: Font {
        switch size {
        case .large: state.running ? .title2.weight(.semibold) : state.playedToday ? .headline : .subheadline
        case .small: state.running || state.playedToday ? .subheadline.weight(.semibold) : .footnote
        }
    }
}

/// The tint a tile's glass and progress take on.
private func tileTint(_ state: PieceState, due: Bool) -> Color? {
    if state.running { return PracticeStyle.ember }
    if due { return PracticeStyle.due }
    return nil
}

private func progress(_ state: PieceState) -> Double {
    state.goalSeconds > 0 ? min(1, Double(state.elapsedSeconds) / Double(state.goalSeconds)) : 0
}

private func fillTint(_ state: PieceState) -> Color {
    if state.goalSeconds > 0 && state.elapsedSeconds >= state.goalSeconds { return PracticeStyle.done }
    return PracticeStyle.ember
}

/// Tap to time it, long-press for its settings. A glass tile that fills with
/// colour as the day's goal for it is met.
private struct PieceTile: View {
    let piece: Piece
    let label: String
    let size: CardSize
    let store: PracticeStore
    let now: Date
    let due: Bool
    let onSettings: (Piece) -> Void
    /// The time's popover, to set today's practice by hand.
    @State private var adjusting = false

    var body: some View {
        let state = store.state(for: piece, at: now)
        let note = store.firstTask(for: piece)?.text ?? ""
        let shape = RoundedRectangle(cornerRadius: size == .large ? PracticeStyle.tileRadius : 22, style: .continuous)

        Group {
            switch size {
            case .large: large(state: state, note: note)
            case .small: small(state: state)
            }
        }
        .background { ProgressFill(progress: progress(state), tint: fillTint(state)) }
        .clipShape(shape)
        .glassEffect(glass(state), in: shape)
        .contentShape(shape)
        .onTapGesture { store.tap(piece) }
        .onLongPressGesture(minimumDuration: 0.45) { onSettings(piece) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(state.running ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { store.tap(piece) }
        .accessibilityAction(named: "Settings") { onSettings(piece) }
        .accessibilityAction(named: "Change today's time") { adjusting = true }
    }

    private func glass(_ state: PieceState) -> Glass {
        if let tint = tileTint(state, due: due) {
            return .regular.tint(tint.opacity(state.running ? 0.32 : 0.2)).interactive()
        }
        return .regular.interactive()
    }

    private func large(state: PieceState, note: String) -> some View {
        let plain = (piece.composer ?? "").isEmpty && note.isEmpty
        return HStack(alignment: plain ? .center : .top, spacing: 14) {
            KindBadge(kind: piece.kind, running: state.running)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.headline)
                    .lineLimit(2)
                if let composer = piece.composer, !composer.isEmpty {
                    Text(composer)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if !note.isEmpty {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button { adjusting = true } label: {
                TimeReadout(state: state, today: store.today, size: .large)
                    .padding(8)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .padding(-8)
            .accessibilityLabel("Change today's time")
            .popover(isPresented: $adjusting) {
                TimeAdjuster(running: state.running, initial: state.elapsedSeconds) { store.setPracticed(piece, seconds: $0) }
                    .presentationCompactAdaptation(.popover)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: plain ? .leading : .topLeading)
    }

    private func small(state: PieceState) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .top) {
                KindBadge(kind: piece.kind, running: state.running, size: 30)
                Spacer()
                if due && !state.running {
                    Text("Due")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(PracticeStyle.due.gradient, in: .capsule)
                }
            }
            .padding(.bottom, 8)
            Text(label)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline) {
                Text(piece.composer ?? " ")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                TimeReadout(state: state, today: store.today, size: .small)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

/// One movement of a work tracked by movement: its number, big, and its time.
private struct MovementTile: View {
    let label: String
    let piece: Piece
    let size: CardSize
    let store: PracticeStore
    let now: Date
    let due: Bool
    let onSettings: (Piece) -> Void

    var body: some View {
        let state = store.state(for: piece, at: now)
        let shape = RoundedRectangle(cornerRadius: size == .large ? PracticeStyle.segmentRadius : 16, style: .continuous)
        let glass: Glass = tileTint(state, due: due).map { .regular.tint($0.opacity(state.running ? 0.32 : 0.2)).interactive() } ?? .regular.interactive()

        VStack(spacing: 4) {
            Text(label)
                .font(size == .large ? .system(.title2, design: .serif, weight: .semibold) : .system(.headline, design: .serif, weight: .semibold))
                .foregroundStyle(state.running ? PracticeStyle.ember : .primary)
            Text(readout(state))
                .font((size == .large ? Font.caption : .caption2).weight(state.running || state.playedToday ? .semibold : .regular))
                .monospacedDigit()
                .foregroundStyle(state.running ? PracticeStyle.ember : state.playedToday ? Color.primary : Color.secondary)
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, minHeight: size == .large ? 72 : 56)
        .background { ProgressFill(progress: progress(state), tint: fillTint(state)) }
        .clipShape(shape)
        .glassEffect(glass, in: shape)
        .contentShape(shape)
        .onTapGesture { store.tap(piece) }
        .onLongPressGesture(minimumDuration: 0.45) { onSettings(piece) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(piece.name)
        .accessibilityValue(readout(state))
        .accessibilityAddTraits(state.running ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { store.tap(piece) }
        .accessibilityAction(named: "Settings") { onSettings(piece) }
    }

    private func readout(_ state: PieceState) -> String {
        if state.running { return QuickLog.clock(state.elapsedSeconds) }
        if state.playedToday { return QuickLog.total(state.elapsedSeconds) }
        return QuickLog.sinceShort(state.lastPracticed, today: store.today)
    }
}

// MARK: - Setting the time

/// Today's practice on a piece, set by hand in five-minute steps: for the
/// session that wasn't timed, or the timer left running.
private struct TimeAdjuster: View {
    let running: Bool
    let initial: Int
    let onSave: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var seconds: Int

    init(running: Bool, initial: Int, onSave: @escaping (Int) -> Void) {
        self.running = running
        self.initial = initial
        self.onSave = onSave
        _seconds = State(initialValue: initial)
    }

    var body: some View {
        VStack(spacing: 18) {
            Text("Practiced today")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 16) {
                step(up: false)
                Text(QuickLog.total(seconds))
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(seconds)))
                    .frame(minWidth: 128)
                    .accessibilityLabel(QuickLog.total(seconds))
                step(up: true)
            }
            Button {
                onSave(seconds)
                dismiss()
            } label: {
                Text(running ? "Save and stop the timer" : "Save")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(seconds == initial)
        }
        .padding(20)
        .frame(width: 300)
        .sensoryFeedback(.selection, trigger: seconds)
    }

    private func step(up: Bool) -> some View {
        Button {
            withAnimation(.snappy) { seconds = QuickLog.stepFive(seconds, up: up) }
        } label: {
            Image(systemName: up ? "plus" : "minus")
                .font(.title2.weight(.bold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .buttonRepeatBehavior(.enabled)
        .disabled(!up && seconds == 0)
        .accessibilityLabel(up ? "Five minutes more" : "Five minutes less")
    }
}

// MARK: - Now playing

/// What's being timed, floating over the list: its live clock, today's
/// total, and Stop.
private struct NowPlayingBar: View {
    let name: String
    let seconds: Int
    let todaySeconds: Int
    let stop: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform")
                .font(.title3.weight(.semibold))
                .foregroundStyle(PracticeStyle.ember)
                .symbolEffect(.variableColor.iterative.reversing)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text("Today \(QuickLog.total(todaySeconds))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Spacer(minLength: 8)
            Text(QuickLog.clock(seconds))
                .font(.system(.title2, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.snappy, value: seconds)
            Button(action: stop) {
                Image(systemName: "stop.fill")
                    .font(.body.weight(.bold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .tint(PracticeStyle.ember)
            .accessibilityLabel("Stop timing \(name)")
        }
        .padding(.leading, 18)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .glassEffect(.regular.interactive(), in: .capsule)
    }
}

// MARK: - Settings

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
    /// Today's practice on it, set by hand in five-minute steps.
    @State private var practiced: Int
    private let originalPracticed: Int
    private let running: Bool
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
        let state = store.state(for: piece, at: .now)
        originalPracticed = state.elapsedSeconds
        _practiced = State(initialValue: state.elapsedSeconds)
        running = state.running
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        KindBadge(kind: piece.kind, running: false, size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(piece.name).font(.headline)
                            if let composer = piece.composer, !composer.isEmpty {
                                Text(composer).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 8, trailing: 4))
                }
                Section("On the stand") {
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
                    Section {
                        TextField("What to work on", text: $text, axis: .vertical)
                            .lineLimit(3...8)
                        Picker(selection: $minutes) {
                            Text("None").tag(0)
                            // An odd length set on the website stays selectable.
                            ForEach((Self.durations + [minutes]).filter { $0 > 0 }.uniqued().sorted(), id: \.self) {
                                Text("\($0) min").tag($0)
                            }
                        } label: {
                            Label("Duration", systemImage: "timer")
                        }
                        .pickerStyle(.menu)
                        Stepper {
                            HStack {
                                Label("Practiced", systemImage: "clock")
                                Spacer()
                                Text(QuickLog.total(practiced))
                                    .monospacedDigit()
                                    .foregroundStyle(practiced == originalPracticed ? .secondary : .primary)
                                    .contentTransition(.numericText(value: Double(practiced)))
                            }
                        } onIncrement: {
                            withAnimation(.snappy) { practiced = QuickLog.stepFive(practiced, up: true) }
                        } onDecrement: {
                            withAnimation(.snappy) { practiced = QuickLog.stepFive(practiced, up: false) }
                        }
                    } header: {
                        Text("Today")
                    } footer: {
                        if running && practiced != originalPracticed {
                            Text("Saving stops the timer.")
                        }
                    }
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .scrollContentBackground(.hidden)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button(role: .confirm) { Task { await save() } }
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
            if practiced != originalPracticed { store.setPracticed(piece, seconds: practiced) }
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
