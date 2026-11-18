import MasonKit
import SwiftUI

/// A number in a session that can be typed into: a set's actuals, a block's
/// result. The keyboard's − and + act on whichever one has focus.
enum LogField: Hashable {
    case load(UUID), reps(UUID), distance(UUID), duration(UUID), calories(UUID)
    case minutes(UUID), seconds(UUID), rounds(UUID), extraReps(UUID), scoreReps(UUID), scoreDistance(UUID), scoreCalories(UUID)
    case notes

    /// How far one press of − or + moves it; plates and seconds go by fives.
    var step: Double? {
        switch self {
        case .load, .duration: 5
        case .notes: nil
        default: 1
        }
    }
}

/// What the rows of a session need to read and change its numbers.
struct LogContext {
    let focus: FocusState<LogField?>.Binding
    let value: (LogField) -> Double?
    let assign: (LogField, Double?) -> Void
}

/// One workout, to log or to look back on: its blocks as glass cards with a
/// field for every set, the comparisons beside each lift, how the day felt,
/// and Mark done. Once done it folds into a recap; Edit opens the fields again
/// without reopening the workout. Sits inside the scroll view of a session pushed
/// from a list, and puts its date and actions in that screen's bar.
struct SessionContent: View {
    let store: WorkoutStore
    let sessionID: UUID
    var onDeleted: () -> Void = {}

    @State private var editing = false
    @State private var showingSource = false
    @State private var confirmingDelete = false
    @State private var swapping: UUID?
    @FocusState private var focus: LogField?

    var body: some View {
        if let session = store.details[sessionID] {
            VStack(alignment: .leading, spacing: 18) {
                SessionHeader(session: session)

                if session.isUnparsed {
                    UnparsedCard(session: session, working: session.calendarEventID.map(store.opening.contains) ?? false) {
                        Task { await store.restructure(session) }
                    }
                }

                if session.completed && !editing {
                    SummaryCard(session: session)
                        .transition(.scale(scale: 0.96).combined(with: .opacity))
                } else {
                    form(session)
                        .transition(.opacity)
                }
            }
            .animation(.smooth(duration: 0.45), value: session.completed)
            .animation(.smooth(duration: 0.35), value: editing)
            .sensoryFeedback(.success, trigger: session.completed) { _, done in done }
            .onChange(of: session.completed) { _, _ in
                editing = false
                focus = nil
            }
            .toolbar { keyboardBar(session) }
            .navigationTitle(WorkoutDay.short(session.sessionDate))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { menu(session) }
            }
            .sheet(isPresented: $showingSource) { SourceSheet(session: session) }
            .confirmationDialog("Delete this workout?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete workout", role: .destructive) {
                    Task { if await store.dismiss(session: sessionID) { onDeleted() } }
                }
            } message: {
                Text(session.source == "calendar"
                    ? "This removes the workout and everything logged for it, and deletes it from your calendar. It can't be undone."
                    : "This removes the workout and everything logged for it. It can't be undone.")
            }
        } else if store.missing.contains(sessionID) {
            EmptyCard(symbol: "questionmark.circle", title: "Not found", message: "This workout isn't in your log any more.")
        } else {
            ProgressView()
                .controlSize(.large)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 80)
        }
    }

    // MARK: The form

    @ViewBuilder
    private func form(_ session: SessionDetail) -> some View {
        let context = LogContext(
            focus: $focus,
            value: { value($0, in: session) },
            assign: { assign($0, $1) }
        )
        let insights = store.insights[sessionID] ?? SessionInsights()

        ForEach(WorkoutRules.groups(session.blocks)) { group in
            BlockCard(group: group, insights: insights, today: store.today, context: context, swapping: swapping) { entry, substitute in
                swapping = entry
                Task {
                    await store.swap(entry: entry, in: sessionID, to: substitute)
                    swapping = nil
                }
            }
        }

        if !session.isUnparsed {
            VStack(alignment: .leading, spacing: 16) {
                FlagRow(title: "Effort", options: [("easier", "😌", "Easier than normal"), ("harder", "🥵", "Harder than normal")], value: session.effort) {
                    store.toggleEffort($0, in: sessionID)
                }
                FlagRow(title: "Energy", options: [("low", "🪫", "Low energy"), ("high", "⚡️", "High energy")], value: session.energy) {
                    store.toggleEnergy($0, in: sessionID)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Notes").padding(.leading, 6)
                    TextField("How did it go?", text: Binding(
                        get: { store.details[sessionID]?.notes ?? "" },
                        set: { store.setNotes($0, in: sessionID) }
                    ), axis: .vertical)
                    .lineLimit(3...10)
                    .focused($focus, equals: .notes)
                    .padding(16)
                    .glassCard(radius: 22)
                }
            }
            .padding(.top, 4)

            Button {
                focus = nil
                if session.completed { editing = false } else { store.setCompleted(true, in: sessionID) }
            } label: {
                Label(session.completed ? "Done editing" : "Mark done", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .tint(session.completed ? WorkoutStyle.done : WorkoutStyle.clay)
            .padding(.top, 6)
        }
    }

    // MARK: The ⋯ menu

    private func menu(_ session: SessionDetail) -> some View {
        Menu {
            if session.completed {
                Button(editing ? "Done editing" : "Edit workout", systemImage: editing ? "checkmark" : "pencil") {
                    editing.toggle()
                }
                Button("Reopen workout", systemImage: "arrow.uturn.backward") {
                    store.setCompleted(false, in: sessionID)
                }
            }
            if session.rawDescription?.isEmpty == false {
                Button("As it was written", systemImage: "text.alignleft") { showingSource = true }
            }
            Link(destination: WorkoutStore.websiteURL.appending(path: "workouts/\(sessionID.uuidString.lowercased())")) {
                Label("Open on the web", systemImage: "safari")
            }
            Divider()
            Button("Delete workout", systemImage: "trash", role: .destructive) { confirmingDelete = true }
        } label: {
            Image(systemName: "ellipsis")
        }
        .accessibilityLabel("Workout actions")
    }

    // MARK: Numbers

    @ToolbarContentBuilder
    private func keyboardBar(_ session: SessionDetail) -> some ToolbarContent {
        ToolbarItemGroup(placement: .keyboard) {
            // Only the session with the keyboard up puts anything on it.
            if let field = focus {
                if let step = field.step {
                    Button {
                        assign(field, max(0, (value(field, in: session) ?? 0) - step))
                    } label: {
                        Label("\(WorkoutRules.trim(step)) less", systemImage: "minus")
                    }
                    Button {
                        assign(field, (value(field, in: session) ?? 0) + step)
                    } label: {
                        Label("\(WorkoutRules.trim(step)) more", systemImage: "plus")
                    }
                }
                Spacer()
                Button("Done") { focus = nil }
                    .fontWeight(.semibold)
            }
        }
    }

    private func value(_ field: LogField, in session: SessionDetail) -> Double? {
        func set(_ id: UUID) -> WorkoutSet? {
            for block in session.blocks {
                for entry in block.entries {
                    if let set = entry.sets.first(where: { $0.id == id }) { return set }
                }
            }
            return nil
        }
        func score(_ id: UUID) -> Score? { session.blocks.first { $0.id == id }?.score }
        return switch field {
        case .load(let id): set(id)?.actual.load
        case .reps(let id): set(id)?.actual.reps.map(Double.init)
        case .distance(let id): set(id)?.actual.distance
        case .duration(let id): set(id)?.actual.duration.map(Double.init)
        case .calories(let id): set(id)?.actual.calories.map(Double.init)
        case .minutes(let id): score(id)?.seconds.map { Double($0 / 60) }
        case .seconds(let id): score(id)?.seconds.map { Double($0 % 60) }
        case .rounds(let id): score(id)?.rounds.map(Double.init)
        case .extraReps(let id), .scoreReps(let id): score(id)?.reps.map(Double.init)
        case .scoreDistance(let id): score(id)?.distance
        case .scoreCalories(let id): score(id)?.calories.map(Double.init)
        case .notes: nil
        }
    }

    private func assign(_ field: LogField, _ value: Double?) {
        let whole = value.map { Int($0.rounded()) }
        switch field {
        case .load(let id): store.update(set: id, in: sessionID) { $0.load = value }
        case .reps(let id): store.update(set: id, in: sessionID) { $0.reps = whole }
        case .distance(let id): store.update(set: id, in: sessionID) { $0.distance = value }
        case .duration(let id): store.update(set: id, in: sessionID) { $0.duration = whole }
        case .calories(let id): store.update(set: id, in: sessionID) { $0.calories = whole }
        case .minutes(let id):
            // A finish time is one number of seconds, typed as two.
            store.update(score: id, in: sessionID) { score in
                let rest = (score.seconds ?? 0) % 60
                score.seconds = whole == nil && rest == 0 ? nil : (whole ?? 0) * 60 + rest
            }
        case .seconds(let id):
            store.update(score: id, in: sessionID) { score in
                let minutes = (score.seconds ?? 0) / 60
                score.seconds = whole == nil && minutes == 0 ? nil : minutes * 60 + min(whole ?? 0, 59)
            }
        case .rounds(let id): store.update(score: id, in: sessionID) { $0.rounds = whole }
        case .extraReps(let id), .scoreReps(let id): store.update(score: id, in: sessionID) { $0.reps = whole }
        case .scoreDistance(let id): store.update(score: id, in: sessionID) { $0.distance = value }
        case .scoreCalories(let id): store.update(score: id, in: sessionID) { $0.calories = whole }
        case .notes: break
        }
    }
}

// MARK: - Header

private struct SessionHeader: View {
    let session: SessionDetail

    var body: some View {
        Text(session.title ?? "Workout")
            .font(.system(.largeTitle, design: .serif, weight: .bold))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, 4)
    }
}

/// The source text a workout was structured from.
private struct SourceSheet: View {
    let session: SessionDetail
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(session.rawDescription ?? "")
                    .font(.body)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
            }
            .navigationTitle(session.title ?? "Workout")
            .navigationSubtitle(WorkoutDay.short(session.sessionDate))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct UnparsedCard: View {
    let session: SessionDetail
    let working: Bool
    let structure: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("This workout hasn't been structured yet.", systemImage: "wand.and.sparkles")
                .font(.subheadline.weight(.semibold))
            if let raw = session.rawDescription, !raw.isEmpty {
                Text(raw)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if session.calendarEventID != nil {
                Button(action: structure) {
                    HStack(spacing: 8) {
                        if working { ProgressView() }
                        Text(working ? "Structuring…" : "Structure this workout")
                    }
                    .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.glassProminent)
                .tint(WorkoutStyle.clay)
                .disabled(working)
            } else {
                Link("Structure it on the web", destination: WorkoutStore.websiteURL.appending(path: "workouts/\(session.id.uuidString.lowercased())"))
                    .font(.subheadline.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .glassCard(tint: WorkoutStyle.gold.opacity(0.18))
    }
}

// MARK: - Blocks

/// One block as a glass card, or the parts of a multi-part workout together
/// in one.
private struct BlockCard: View {
    let group: WodGroup
    let insights: SessionInsights
    let today: String
    let context: LogContext
    let swapping: UUID?
    let swap: (UUID, Substitute) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if group.blocks.count > 1 {
                Text(group.label ?? "Workout")
                    .font(.system(.title2, design: .serif, weight: .semibold))
                ForEach(Array(group.blocks.enumerated()), id: \.element.id) { index, block in
                    if index > 0 { Divider() }
                    VStack(alignment: .leading, spacing: 14) {
                        heading(WorkoutRules.partLabel(block), type: block.blockType, small: true, named: true)
                        body(of: block)
                    }
                }
            } else if let block = group.blocks.first {
                heading(block.title ?? WorkoutRules.label(block.blockType), type: block.blockType, small: false, named: block.title != nil)
                body(of: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .glassCard()
    }

    private func heading(_ title: String, type: BlockType, small: Bool, named: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(small ? .headline : .system(.title2, design: .serif, weight: .semibold))
            Spacer(minLength: 8)
            // A block with no title of its own is already named for its type.
            if named {
                Label(WorkoutRules.label(type), systemImage: WorkoutStyle.symbol(for: type))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(WorkoutStyle.accent)
            } else {
                Image(systemName: WorkoutStyle.symbol(for: type))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(WorkoutStyle.accent)
                    .accessibilityHidden(true)
            }
        }
    }

    @ViewBuilder
    private func body(of block: Block) -> some View {
        if let name = block.benchmarkName {
            BenchmarkPanel(name: name, attempts: insights.attempts[block.id] ?? [], today: today)
        }
        ForEach(Array(block.entries.enumerated()), id: \.element.id) { index, entry in
            if index > 0 { Divider().opacity(0.6) }
            EntryView(
                entry: entry, history: insights.history[entry.id], hint: insights.hints[entry.id],
                substitute: insights.substitutes[entry.id], today: today, context: context,
                swapping: swapping == entry.id, swap: swap
            )
        }
        // 'load' is logged on the lift's own sets, and 'none' has no result.
        if block.scoreType != .none && block.scoreType != .load {
            ScorePanel(block: block, context: context)
        }
    }
}

private struct EntryView: View {
    let entry: Entry
    let history: MovementHistory?
    let hint: SiblingHint?
    let substitute: Substitute?
    let today: String
    let context: LogContext
    let swapping: Bool
    let swap: (UUID, Substitute) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.name).font(.headline)
                Spacer(minLength: 8)
                if !entry.isMetcon, let best = bestEstimate {
                    Chip(text: "e1RM \(WorkoutRules.trim(best.value))\(best.loose ? "≈" : "")", color: best.loose ? .secondary : WorkoutStyle.ember)
                        .contentTransition(.numericText(value: best.value))
                        .animation(.snappy, value: best.value)
                        .accessibilityLabel("Estimated one rep max \(WorkoutRules.trim(best.value)) pounds")
                }
            }

            if let substitute {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .foregroundStyle(.secondary)
                    Text("You sub this with \(Text(substitute.name).fontWeight(.semibold).foregroundStyle(.primary))")
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 4)
                    Button(swapping ? "Swapping…" : "Swap in") { swap(entry.id, substitute) }
                        .buttonStyle(.glass)
                        .controlSize(.small)
                        .disabled(swapping)
                }
                .font(.footnote)
            }

            if let history, entry.isLoaded {
                HistoryPanel(name: entry.name, history: history, hint: hint, reference: reference, today: today)
            }

            if entry.isMetcon, !logsLoad {
                let line = WorkoutRules.metconLine(entry)
                if !line.isEmpty {
                    Text(line)
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(spacing: 8) {
                    ForEach(Array(entry.sets.enumerated()), id: \.element.id) { index, set in
                        SetRow(set: set, index: index, context: context)
                    }
                }
            }
        }
    }

    /// In a WOD a movement is one line of what was written, unless it has a
    /// load: the weight on the bar is often scaled, so those keep their fields.
    private var logsLoad: Bool {
        entry.sets.contains { $0.metricType == .loadReps }
    }

    /// The prescription the suggested load is worked out for.
    private var reference: WorkoutSet? {
        entry.sets.first { $0.prescribed.reps != nil } ?? entry.sets.first
    }

    /// The entry's best estimate today: strict if there is one, else loose.
    private var bestEstimate: (value: Double, loose: Bool)? {
        if let strict = entry.sets.filter({ !$0.e1rmIsLoose }).compactMap(\.e1rm).max() { return (strict, false) }
        return entry.sets.compactMap(\.e1rm).max().map { ($0, true) }
    }
}

/// One set: what was written, and fields for what was done.
private struct SetRow: View {
    let set: WorkoutSet
    let index: Int
    let context: LogContext

    var body: some View {
        let rx = WorkoutRules.setMetric(set.metricType, set.prescribed)
        let changed = rx != "—" && WorkoutRules.setMetric(set.metricType, set.actual) != rx
        HStack(alignment: .bottom, spacing: 12) {
            HStack(spacing: 12) {
                Text("\(index + 1)")
                    .font(.footnote.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(WorkoutStyle.accent)
                    .frame(width: 28, height: 28)
                    .background(WorkoutStyle.accent.opacity(0.13), in: .circle)
                VStack(alignment: .leading, spacing: 1) {
                    Text(rx == "—" ? "Set \(index + 1)" : rx)
                        .font(.subheadline.weight(.medium))
                        .monospacedDigit()
                        .strikethrough(changed, color: .secondary)
                        .foregroundStyle(changed ? .secondary : .primary)
                    if changed {
                        Text("As written")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(height: NumberField.height)
            Spacer(minLength: 4)
            fields
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Set \(index + 1)")
    }

    @ViewBuilder
    private var fields: some View {
        // The units sit over the first row only, as column heads.
        let heads = index == 0
        switch set.metricType {
        case .loadReps:
            NumberField(label: set.actual.unit ?? "lb", field: .load(set.id), width: 78, showsLabel: heads, context: context)
            Text("×").font(.subheadline.weight(.semibold)).foregroundStyle(.tertiary).frame(height: NumberField.height)
            NumberField(label: "reps", field: .reps(set.id), width: 58, showsLabel: heads, context: context)
        case .reps:
            NumberField(label: "reps", field: .reps(set.id), showsLabel: heads, context: context)
        case .distance:
            NumberField(label: "meters", field: .distance(set.id), width: 84, showsLabel: heads, context: context)
        case .duration:
            NumberField(label: "seconds", field: .duration(set.id), showsLabel: heads, context: context)
        case .calories:
            NumberField(label: "cal", field: .calories(set.id), showsLabel: heads, context: context)
        }
    }
}

/// A big-tap number: tap to type over it, or nudge it with the keyboard's −
/// and +. Saves as it changes.
struct NumberField: View {
    let label: String
    let field: LogField
    var width: CGFloat = 68
    var showsLabel = true
    let context: LogContext

    static let height: CGFloat = 44

    @State private var text = ""
    @State private var selection: TextSelection?

    var body: some View {
        let value = context.value(field)
        let focused = context.focus.wrappedValue == field
        let shape = RoundedRectangle(cornerRadius: 13, style: .continuous)
        VStack(spacing: 4) {
            if showsLabel {
                Text(label)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            TextField("–", text: $text, selection: $selection)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.center)
                .font(.system(.title3, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .focused(context.focus, equals: field)
                .frame(width: width, height: Self.height)
                .background(Color.primary.opacity(focused ? 0.03 : 0.07), in: shape)
                .overlay { shape.strokeBorder(WorkoutStyle.accent.opacity(focused ? 0.9 : 0), lineWidth: 1.5) }
                .contentShape(shape)
                .accessibilityLabel(label)
        }
        .onAppear { text = Self.format(value) }
        .onChange(of: value) { _, new in
            // Typing sets the value; anything else that moves it (the −/+
            // keys, a reload) sets the text.
            guard Self.parse(text) != new else { return }
            // An emptied field mid-edit stays empty rather than snapping to 0.
            if focused, text.isEmpty, (new ?? 0) == 0 { return }
            text = Self.format(new)
        }
        .onChange(of: text) { _, new in
            let parsed = Self.parse(new)
            if parsed != value { context.assign(field, parsed) }
        }
        .onChange(of: focused) { _, now in
            if now {
                // Typing replaces what's there, as a number pad should.
                selection = TextSelection(range: text.startIndex..<text.endIndex)
            } else {
                text = Self.format(context.value(field))
            }
        }
        .animation(.snappy(duration: 0.2), value: focused)
    }

    private static func format(_ value: Double?) -> String {
        value.map(WorkoutRules.trim) ?? ""
    }

    private static func parse(_ text: String) -> Double? {
        Double(text.replacingOccurrences(of: ",", with: "."))
    }
}

// MARK: - Comparisons

/// How this lift has gone before, beside today's sets: the best estimated
/// 1RM, the load that matches today's reps, what the written load is of max,
/// and the last few times.
private struct HistoryPanel: View {
    let name: String
    let history: MovementHistory
    let hint: SiblingHint?
    let reference: WorkoutSet?
    let today: String

    var body: some View {
        if history.bestE1rmStrict == nil && history.recent.isEmpty {
            Group {
                if let hint {
                    Label {
                        let range = Text("\(WorkoutRules.trim(hint.low))–\(WorkoutRules.trim(hint.high)) lb")
                            .fontWeight(.semibold)
                            .foregroundStyle(.primary)
                        Text("No \(name) history yet. From your \(hint.fromName), an estimated 1RM of \(range) (typical ratio).")
                    } icon: {
                        Image(systemName: "arrow.left.arrow.right")
                    }
                } else {
                    Label("First time logging \(name). This becomes your baseline.", systemImage: "flag")
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .inset()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 0) {
                    if let best = history.bestE1rmStrict {
                        stat(WorkoutRules.trim(best), "est. 1RM", color: WorkoutStyle.ember)
                    }
                    if let reps = reference?.prescribed.reps, let suggested = history.suggestedLoad(reps: reps) {
                        stat("\(WorkoutRules.trim(suggested)) lb", "today's \(reps)")
                    }
                    if let load = reference?.prescribed.load, let percent = history.percent(ofLoad: load) {
                        stat("\(percent)%", "Of your max")
                    }
                }
                if !history.recent.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 6) {
                            Image(systemName: "clock.arrow.circlepath")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            ForEach(Array(history.recent.prefix(5).enumerated()), id: \.offset) { _, set in
                                Text("\(Text(recent(set)).fontWeight(.semibold))  \(Text(WorkoutDay.relative(set.date, today: today)).foregroundStyle(.secondary))")
                                    .font(.caption)
                                    .monospacedDigit()
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 5)
                                    .background(Color.primary.opacity(0.06), in: .capsule)
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
            }
            .padding(12)
            .inset()
        }
    }

    private func stat(_ value: String, _ label: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(color)
            Eyebrow(label)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func recent(_ set: HistorySet) -> String {
        let reps = set.reps.map(String.init) ?? "?"
        guard let load = set.load, load != 0 else { return "×\(reps)" }
        return "\(WorkoutRules.trim(load))×\(reps)"
    }
}

/// A named benchmark, with how it's gone before.
private struct BenchmarkPanel: View {
    let name: String
    let attempts: [BenchmarkAttempt]
    let today: String

    var body: some View {
        let scored = attempts.compactMap { attempt in
            WorkoutRules.score(attempt.scoreType, attempt.score).map { (attempt, $0) }
        }
        VStack(alignment: .leading, spacing: 8) {
            Label("Benchmark", systemImage: "trophy.fill")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(WorkoutStyle.goldText)
            if scored.isEmpty {
                Text("First recorded attempt. Set the bar.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                HStack(alignment: .top, spacing: 18) {
                    ForEach(Array(scored.prefix(3).enumerated()), id: \.offset) { index, pair in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(pair.1)
                                .font(.system(.title3, design: .rounded, weight: .bold))
                                .monospacedDigit()
                            Text([pair.0.rxLevel?.label, WorkoutDay.brief(pair.0.date, today: today)].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if index == 0 { Eyebrow("Last time", color: WorkoutStyle.goldText) }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .inset(tint: WorkoutStyle.gold, strength: 0.14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Benchmark \(name)")
    }
}

/// A block's result: a finish time, rounds and reps, calories…
private struct ScorePanel: View {
    let block: Block
    let context: LogContext

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("Your result", color: WorkoutStyle.accent)
                Text(WorkoutRules.label(block.scoreType))
                    .font(.subheadline.weight(.semibold))
            }
            .frame(minHeight: NumberField.height)
            Spacer(minLength: 4)
            switch block.scoreType {
            case .time:
                NumberField(label: "min", field: .minutes(block.id), width: 62, context: context)
                Text(":").font(.title3.weight(.bold)).foregroundStyle(.tertiary).frame(height: NumberField.height)
                NumberField(label: "sec", field: .seconds(block.id), width: 62, context: context)
            case .roundsReps:
                NumberField(label: "rounds", field: .rounds(block.id), width: 62, context: context)
                Text("+").font(.title3.weight(.bold)).foregroundStyle(.tertiary).frame(height: NumberField.height)
                NumberField(label: "reps", field: .extraReps(block.id), width: 62, context: context)
            case .reps:
                NumberField(label: "reps", field: .scoreReps(block.id), width: 84, context: context)
            case .distance:
                NumberField(label: "meters", field: .scoreDistance(block.id), width: 84, context: context)
            case .calories:
                NumberField(label: "cal", field: .scoreCalories(block.id), width: 84, context: context)
            case .load, .none:
                EmptyView()
            }
        }
        .padding(12)
        .inset(tint: WorkoutStyle.accent, strength: 0.10)
    }
}

/// "Flag the unusual": two options and normally neither. Tapping the one
/// that's set clears it.
private struct FlagRow: View {
    let title: String
    let options: [(value: String, emoji: String, label: String)]
    let value: String?
    let pick: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(title).padding(.leading, 6)
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(options, id: \.value) { option in
                        let active = value == option.value
                        Button { pick(option.value) } label: {
                            HStack(spacing: 6) {
                                Text(option.emoji)
                                Text(option.label)
                                    .font(.subheadline.weight(active ? .semibold : .regular))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                            }
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 12)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .glassEffect(
                                active ? .regular.tint(WorkoutStyle.accent.opacity(0.4)).interactive() : .regular.interactive(),
                                in: .capsule
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(active ? .isSelected : [])
                    }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: value)
    }
}

// MARK: - The recap

/// A finished session as one green card: the numbers that matter, what was
/// logged in each block, how it felt, and the notes.
private struct SummaryCard: View {
    let session: SessionDetail

    var body: some View {
        let stats = WorkoutRules.stats(session)
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(WorkoutStyle.done.gradient)
                    .symbolEffect(.bounce, value: session.completed)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Completed")
                        .font(.system(.title2, design: .serif, weight: .bold))
                    Text("Nice work.")
                        .font(.subheadline)
                        .foregroundStyle(WorkoutStyle.doneText)
                }
                Spacer()
            }

            HStack(alignment: .top, spacing: 14) {
                ForEach(Array(stats.enumerated()), id: \.offset) { _, stat in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(stat.value)
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                        Eyebrow(stat.label)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                }
            }

            if session.effort != nil || session.energy != nil {
                HStack(spacing: 8) {
                    if let effort = session.effort {
                        Chip(text: effort == "easier" ? "😌 Easier than normal" : "🥵 Harder than normal", color: WorkoutStyle.doneText)
                    }
                    if let energy = session.energy {
                        Chip(text: energy == "low" ? "🪫 Low energy" : "⚡️ High energy", color: WorkoutStyle.doneText)
                    }
                }
            }

            ForEach(session.blocks) { block in
                let score = WorkoutRules.score(block.scoreType, block.score)
                let lines = block.entries.map(WorkoutRules.summarize)
                if !lines.isEmpty || score != nil {
                    Divider()
                    VStack(alignment: .leading, spacing: 9) {
                        HStack(alignment: .firstTextBaseline) {
                            Eyebrow(block.title ?? WorkoutRules.label(block.blockType))
                            Spacer()
                            if let score {
                                Text(score)
                                    .font(.system(.headline, design: .rounded))
                                    .monospacedDigit()
                            }
                        }
                        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(line.name).font(.subheadline)
                                Spacer(minLength: 8)
                                Text(line.detail.isEmpty ? "—" : line.detail)
                                    .font(.subheadline)
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.trailing)
                                if let e1rm = line.e1rm {
                                    Chip(text: "e1RM \(WorkoutRules.trim(e1rm))", color: WorkoutStyle.ember)
                                }
                            }
                        }
                    }
                }
            }

            if let note = session.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow("Notes")
                    Text(note).font(.subheadline)
                }
            }

            if let whoop = session.whoopSyncStatus {
                Divider()
                Label(Self.whoopLine(whoop), systemImage: whoop == "synced" ? "checkmark.icloud" : "icloud.slash")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .glassCard(tint: WorkoutStyle.done.opacity(0.18))
    }

    /// Sending to WHOOP stays on the website; this says where it stands.
    private static func whoopLine(_ status: String) -> String {
        switch status {
        case "synced": "Sent to WHOOP."
        case "dirty": "Changed since it was sent to WHOOP. Send it again on the web."
        case "syncing": "Sending to WHOOP…"
        default: "Didn't reach WHOOP. Try again on the web."
        }
    }
}
