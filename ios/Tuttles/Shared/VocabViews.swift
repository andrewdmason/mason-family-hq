import MasonKit
import SwiftUI

// Vocab's screens outside a session: its first screen (a kid's path, or both
// kids for a parent), how a kid is doing (today, how far through the words
// they are, the ones giving trouble), and the full list of words and word parts.

// MARK: - The look

enum VocabLook {
    static let right = Color(red: 0.20, green: 0.66, blue: 0.42)
    static let rightText = Color(light: Color(red: 0.10, green: 0.44, blue: 0.26), dark: Color(red: 0.55, green: 0.88, blue: 0.66))
    static let wrong = Color(red: 0.87, green: 0.24, blue: 0.20)
    static let amber = Color(red: 0.96, green: 0.62, blue: 0.10)
    static let amberText = Color(light: Color(red: 0.62, green: 0.36, blue: 0.02), dark: Color(red: 0.99, green: 0.76, blue: 0.36))
    static let flame = Color(red: 0.98, green: 0.50, blue: 0.12)
    static let cardRadius: CGFloat = 28
    /// How wide a column of cards gets on a Mac or an iPad-sized window.
    static let column: CGFloat = 620
}

extension Color {
    /// One colour in the light and another in the dark.
    init(light: Color, dark: Color) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
        #else
        self.init(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(dark) : NSColor(light) })
        #endif
    }
}

/// How the session is going, which the backdrop takes its colour from.
enum VocabMood {
    /// Nothing answered: the icon's red on warm paper.
    case calm
    case right
    case miss
    /// A session finished.
    case done
    /// A boss round, waiting for an answer.
    case boss
}

/// What the glass sits on: a still mesh of paper, blush and the icon's red,
/// turning green for a moment on a right answer and amber while a miss is read.
struct VocabBackdrop: View {
    var mood: VocabMood = .calm
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [0.58, 0.44], [1, 0.5],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: colors
        )
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.6), value: mood)
    }

    private var colors: [Color] {
        if scheme == .dark {
            let base = Color(red: 0.07, green: 0.06, blue: 0.065)
            let umber = Color(red: 0.16, green: 0.085, blue: 0.08)
            let glow: Color = switch mood {
            case .calm: Color(red: 0.34, green: 0.09, blue: 0.08)
            case .right, .done: Color(red: 0.07, green: 0.27, blue: 0.17)
            case .miss: Color(red: 0.33, green: 0.20, blue: 0.05)
            case .boss: Color(red: 0.20, green: 0.11, blue: 0.40)
            }
            return [
                glow, umber, base,
                umber, base, base,
                base, umber, glow,
            ]
        }
        let paper = Theme.paper
        let cream = Color(red: 0.99, green: 0.95, blue: 0.89)
        let (soft, glow): (Color, Color) = switch mood {
        case .calm: (Color(red: 0.98, green: 0.86, blue: 0.81), Color(red: 0.97, green: 0.75, blue: 0.70))
        case .right, .done: (Color(red: 0.86, green: 0.94, blue: 0.85), Color(red: 0.71, green: 0.90, blue: 0.76))
        case .miss: (Color(red: 0.99, green: 0.91, blue: 0.76), Color(red: 0.99, green: 0.82, blue: 0.58))
        case .boss: (Color(red: 0.90, green: 0.86, blue: 0.98), Color(red: 0.78, green: 0.70, blue: 0.97))
        }
        return [
            glow, soft, cream,
            soft, paper, paper,
            cream, soft, glow,
        ]
    }
}

extension View {
    /// A card of Liquid Glass, optionally tinted.
    func vocabGlass(tint: Color? = nil, radius: CGFloat = VocabLook.cardRadius) -> some View {
        glassEffect(tint.map { .regular.tint($0) } ?? .regular, in: .rect(cornerRadius: radius, style: .continuous))
    }

    /// A column of cards on the backdrop, no wider than reads well.
    func vocabColumn() -> some View {
        frame(maxWidth: VocabLook.column).frame(maxWidth: .infinity)
    }
}

// MARK: - Pieces both pages share

/// Days in a row, as a flame and a number.
struct VocabStreak: View {
    let days: Int

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "flame.fill").foregroundStyle(days > 0 ? VocabLook.flame : Color.secondary)
                .symbolEffect(.bounce, value: days)
            Text("\(days)").monospacedDigit().fontWeight(.semibold)
        }
        .font(.subheadline)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(days) days in a row")
    }
}

/// The last two weeks, a dot a day.
struct VocabDayDots: View {
    let overview: VocabOverview

    var body: some View {
        HStack(spacing: 5) {
            ForEach(overview.recentDays, id: \.day) { day in
                Circle()
                    .fill(day.done ? VocabLook.right : Color.primary.opacity(0.10))
                    .frame(width: 10, height: 10)
                    .overlay {
                        if day.day == overview.today, !day.done {
                            Circle().strokeBorder(Color.primary.opacity(0.45), lineWidth: 1.5)
                        }
                    }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(overview.recentDays.filter(\.done).count) of the last 14 days done")
    }
}

/// Today's ten minutes as a ring that fills, with the time done in the middle.
struct VocabDayRing: View {
    let goal: VocabOverview.Goal
    var size: CGFloat = 76

    var body: some View {
        ZStack {
            Circle().stroke(Color.primary.opacity(0.10), lineWidth: size * 0.11)
            Circle()
                .trim(from: 0, to: goal.fraction)
                .stroke(goal.done ? VocabLook.right : TuttlesLook.accent, style: StrokeStyle(lineWidth: size * 0.11, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.smooth(duration: 0.8), value: goal.fraction)
            VStack(spacing: 0) {
                Text(VocabRules.clock(goal.ms)).font(.system(size: size * (size < 60 ? 0.28 : 0.25), weight: .bold, design: .rounded)).monospacedDigit()
                // (Too small to read on a small ring.)
                if size >= 60 {
                    Text("of \(goal.goalMs / 60_000) min").font(.system(size: size * 0.13)).foregroundStyle(.secondary)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(VocabRules.clock(goal.ms)) of \(goal.goalMs / 60_000) minutes done today")
    }
}

/// Mastered, almost and learning as one bar across all the words, with what each colour is.
struct VocabWordsBar: View {
    let overview: VocabOverview
    private static let order: [VocabStatus] = [.mastered, .almost, .learning]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { geo in
                HStack(spacing: 0) {
                    ForEach(Self.order, id: \.self) { status in
                        status.tint.frame(width: geo.size.width * Double(overview.count(status)) / Double(max(1, overview.totalWords)))
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(height: 12)
            .background(Color.primary.opacity(0.08))
            .clipShape(.capsule)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 14) { ForEach(Self.order + [.new], id: \.self, content: key) }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 14) { ForEach(Self.order.prefix(2), id: \.self, content: key) }
                    HStack(spacing: 14) { ForEach([Self.order[2], .new], id: \.self, content: key) }
                }
            }
            .font(.caption)
        }
    }

    private func key(_ status: VocabStatus) -> some View {
        HStack(spacing: 5) {
            Circle().fill(status.tint).frame(width: 8, height: 8)
            Text(status.label).foregroundStyle(.secondary)
            Text("\(overview.count(status))").monospacedDigit()
        }
        .lineLimit(1)
        .fixedSize()
    }
}

// MARK: - Vocab, from the menu

/// Vocab's first screen. For a kid it's their path (VocabPath.swift): the map
/// of stages, how today stands across the top (which opens the rest), and
/// one button at the bottom for the next thing to do. For a parent it's both
/// kids side by side.
struct VocabHomeView: View {
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store
    @State private var run: VocabRun?
    @State private var open: VocabStage?
    @State private var starting = false
    @State private var problem: String?

    /// A kid's own page, with their words on this phone: the path is the page.
    private var climb: (home: VocabHome, overview: VocabOverview, path: VocabPath)? {
        guard let home = store.vocab, home.kids == nil, let overview = home.overview, let path = home.path, !path.stages.isEmpty else { return nil }
        return (home, overview, path)
    }

    var body: some View {
        Group {
            if let climb {
                VocabMap(path: climb.path, daysLeft: climb.home.daysLeft) { open = $0 }
                    // Bars, so the path blurs away under them.
                    .safeAreaBar(edge: .top, spacing: 0) { status(climb.overview) }
                    .safeAreaBar(edge: .bottom, spacing: 0) {
                        VocabStartButtons(path: climb.path, inProgress: climb.overview.inProgress != nil, done: climb.overview.isDoneToday,
                                          starting: starting, start: start, fight: fight)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 8)
                            .vocabColumn()
                    }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let home = store.vocab {
                            if let kids = home.kids {
                                parents(kids, home)
                            } else if let overview = home.overview {
                                // Their words aren't on this phone (an older website): no path to show.
                                VocabProgressCards(overview: overview, home: home, start: start, starting: starting)
                            } else {
                                ContentUnavailableView("Not set up yet", systemImage: "character.book.closed",
                                                       description: Text("Vocab isn't set up for you yet. Ask a parent."))
                                    .padding(.top, 80)
                            }
                        } else if let problem = store.vocabProblem {
                            ContentUnavailableView("No connection", systemImage: "wifi.slash", description: Text(problem))
                                .padding(.top, 80)
                        } else {
                            ProgressView().frame(maxWidth: .infinity).padding(.top, 120)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 32)
                    .vocabColumn()
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background { VocabBackdrop(mood: store.vocab?.overview?.isDoneToday == true ? .done : .calm) }
        .navigationTitle("Vocab")
        .kidUsing(store.actingKid)
        .toolbar {
            if let overview = store.vocab?.overview {
                ToolbarItem(placement: .tuttlesTrailing) {
                    VocabStreak(days: overview.streak).padding(.horizontal, 6)
                }
            }
        }
        .refreshable { await store.refreshVocab() }
        .task { await store.refreshVocab() }
        .sheet(item: $open) { stage in
            VocabStageSheet(stage: stage, current: store.vocab?.path?.current?.number == stage.number) {
                open = nil
                fight(stage)
            }
        }
        .cover(item: $run) { run in
            VocabSessionView(run: run)
        }
        .onChange(of: run == nil) { _, closed in
            // Back from a session: the path and the day have moved.
            if closed {
                store.vocabStopPlaying()
                Task { await store.refreshVocab() }
            }
        }
        .alert("Couldn't start", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK") {}
        } message: {
            Text(problem ?? "")
        }
        .animation(.default, value: store.vocab?.overview)
    }

    /// Across the top of the path: today against the ten minutes and the
    /// words mastered, which opens the rest of how they're doing.
    private func status(_ overview: VocabOverview) -> some View {
        NavigationLink(value: Route.vocabProgress) {
                HStack(spacing: 12) {
                    if let goal = overview.day { VocabDayRing(goal: goal, size: 46) }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(overview.isDoneToday ? "Done today" : overview.day.map { "\(VocabRules.clock($0.leftMs)) to go today" } ?? "Today's practice")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(overview.isDoneToday ? AnyShapeStyle(VocabLook.rightText) : AnyShapeStyle(.primary))
                        Text("\(overview.count(.mastered)) of \(overview.totalWords) words mastered")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .contentShape(.rect)
                .vocabGlass(radius: 24)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows how you're doing")
            .padding(.horizontal, 20)
            .padding(.vertical, 6)
            .vocabColumn()
    }

    private func start() {
        guard !starting else { return }
        starting = true
        Task {
            defer { starting = false }
            do {
                let number = store.vocab?.overview?.nextSession ?? 1
                run = VocabRun(store: store, state: try await store.vocabBegin(), number: number)
            } catch {
                problem = error.localizedDescription
            }
        }
    }

    /// Takes on a stage's boss round.
    private func fight(_ stage: VocabStage) {
        guard !starting, let state = store.vocabBeginBoss(stage: stage.number) else { return }
        run = VocabRun(store: store, state: state, number: store.vocab?.overview?.nextSession ?? 1)
    }

    // MARK: The parents' view

    @ViewBuilder private func parents(_ kids: [VocabHome.Kid], _ home: VocabHome) -> some View {
        Text("ISEE Verbal Reasoning · \(VocabRules.countdown(daysLeft: home.daysLeft))")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
        if kids.isEmpty {
            ContentUnavailableView("No kids are set up yet", systemImage: "character.book.closed").padding(.top, 80)
        }
        ForEach(kids) { kid in
            VocabKidCard(kid: kid)
        }
    }
}

// MARK: - How they're doing

/// Off the path: today's ten minutes and its sessions, the last two weeks,
/// the words by where they stand, and the ones giving trouble.
struct VocabProgressView: View {
    @Environment(ChatStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let home = store.vocab, let overview = home.overview {
                    VocabProgressCards(overview: overview, home: home)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 120)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .vocabColumn()
        }
        .scrollContentBackground(.hidden)
        .background { VocabBackdrop(mood: store.vocab?.overview?.isDoneToday == true ? .done : .calm) }
        .navigationTitle("Progress")
        .inlineTitle()
        .kidUsing(store.actingKid)
        .task { if store.vocab == nil { await store.refreshVocab() } }
        .refreshable { await store.refreshVocab() }
    }
}

/// The cards of how a kid is doing. They're the Progress screen; and, for a
/// kid whose words aren't on this phone, Vocab's first screen, with the way
/// into a session on the first card.
struct VocabProgressCards: View {
    let overview: VocabOverview
    let home: VocabHome
    /// The way into a session, when these are the first screen.
    var start: (() -> Void)? = nil
    var starting = false
    @Environment(ChatStore.self) private var store

    var body: some View {
        Text("\(overview.level.name) · \(VocabRules.countdown(daysLeft: home.daysLeft))")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)

        today

        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(overview.count(.mastered))").font(.system(size: 40, weight: .bold, design: .rounded)).monospacedDigit()
                Text("of \(overview.totalWords) words mastered").font(.subheadline).foregroundStyle(.secondary)
            }
            VocabWordsBar(overview: overview)
            Text(partsLine).font(.footnote).foregroundStyle(.secondary)
            Divider()
            NavigationLink(value: Route.vocabList(kid: nil, name: nil)) {
                row("All words", "list.bullet")
            }
            .buttonStyle(.plain)
            // What's come out of their chests, when sessions are played on this phone.
            if !store.showingParentView, let local = store.vocabLocal {
                Divider()
                NavigationLink(value: Route.vocabFacts) {
                    row("Gross facts", "shippingbox.fill", note: "\(local.found.count) of \(VocabFacts.all.count)")
                }
                .buttonStyle(.plain)
            }
        }
        .padding(20)
        .vocabGlass()

        // The words giving trouble, with what they mean.
        VStack(alignment: .leading, spacing: 0) {
            Label("Trouble words", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(VocabLook.amberText)
                .padding(.bottom, 10)
            if overview.trouble.isEmpty {
                Text("None right now. A word shows up here once it's been missed twice.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(overview.trouble.enumerated()), id: \.element.id) { index, word in
                if index > 0 { Divider() }
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(word.title).fontWeight(.semibold)
                        Text(word.meaning).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    Text("missed \(word.misses)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                }
                .padding(.vertical, 9)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .vocabGlass()
    }

    private func row(_ title: String, _ symbol: String, note: String? = nil) -> some View {
        HStack {
            Label(title, systemImage: symbol)
            Spacer()
            if let note { Text(note).font(.subheadline).monospacedDigit().foregroundStyle(.secondary) }
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .font(.body.weight(.medium))
        .contentShape(.rect)
    }

    /// Today: the ten minutes filling up, the sessions so far, and the last two weeks.
    private var today: some View {
        let done = overview.isDoneToday
        let sessions = overview.finishedToday
        let next = overview.nextSession
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 16) {
                if let goal = overview.day { VocabDayRing(goal: goal) }
                VStack(alignment: .leading, spacing: 4) {
                    if done {
                        Label("Done today", systemImage: "checkmark.seal.fill")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(VocabLook.rightText)
                    } else {
                        Text("Today's practice").font(.title2.weight(.bold))
                    }
                    Text(todayLine(sessions: sessions.count)).foregroundStyle(.secondary)
                }
            }
            // Each session on its own line, the one under way last.
            if !sessions.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(sessions, id: \.number) { session in
                        sessionRow(session.number, "\(session.done.correct) of \(session.done.total) right", VocabRules.clock(session.done.elapsedMs))
                    }
                    if let open = overview.inProgress {
                        Divider()
                        VStack(alignment: .leading, spacing: 8) {
                            sessionRow(next, "\(open.answered) of \(open.total) answered", "under way", live: true)
                            ProgressView(value: Double(open.answered), total: Double(max(1, open.total)))
                                .tint(TuttlesLook.accent)
                        }
                    }
                }
            }
            if let start {
                let title = overview.inProgress != nil ? (next > 1 ? "Keep going with session \(next)" : "Keep going")
                    : done ? "Do another" : next > 1 ? "Start session \(next)" : "Start"
                let label = HStack(spacing: 8) {
                    if starting { ProgressView() }
                    Text(title).font(.headline)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                if done, overview.inProgress == nil {
                    Button(action: start) { label }.buttonStyle(.glass).disabled(starting)
                } else {
                    Button(action: start) { label }.buttonStyle(.glassProminent).tint(TuttlesLook.accent).disabled(starting)
                }
            }
            HStack {
                VocabDayDots(overview: overview)
                Spacer()
                Text("last 14 days").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(20)
        .vocabGlass(tint: done ? VocabLook.right.opacity(0.12) : nil)
    }

    /// Under the card's title: what's left of the ten minutes, or how the day went.
    private func todayLine(sessions: Int) -> String {
        guard let goal = overview.day else {
            // An older website: one session is the day.
            if let done = overview.doneToday { return "\(done.correct) of \(done.total) right." }
            return overview.inProgress.map { "\($0.answered) of \($0.total) answered so far." } ?? "\(overview.questions) questions in 10 minutes."
        }
        if goal.done { return "\(VocabRules.clock(goal.ms)) of practice in \(sessions) \(sessions == 1 ? "session" : "sessions")." }
        if goal.ms == 0, overview.inProgress == nil {
            return "\(overview.questions) questions a session. Keep going until the ring is full."
        }
        if sessions == 0, let open = overview.inProgress {
            return "\(open.answered) of \(open.total) answered. \(VocabRules.clock(goal.leftMs)) to go."
        }
        return "\(VocabRules.clock(goal.leftMs)) to go."
    }

    /// One of today's sessions: which it was, how it went, and its time.
    private func sessionRow(_ number: Int, _ result: String, _ note: String, live: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("Session \(number)").fontWeight(.semibold).foregroundStyle(live ? TuttlesLook.accent : .primary)
            Text(result).foregroundStyle(.secondary).monospacedDigit()
            Spacer(minLength: 4)
            Text(note).font(.caption).monospacedDigit().foregroundStyle(.secondary)
        }
        .font(.subheadline)
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }

    private var partsLine: String {
        var line = "Word parts: \(overview.parts.met) of \(overview.parts.total) met, \(overview.parts.mastered) mastered."
        let removed = overview.count(.removed)
        if removed > 0 { line += " \(removed) \(removed == 1 ? "word" : "words") skipped as known already." }
        return line
    }
}

/// One kid, for a parent: whether today's done, the last two weeks, how far
/// through the words they are, and what's giving trouble.
private struct VocabKidCard: View {
    let kid: VocabHome.Kid

    var body: some View {
        let overview = kid.overview
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(kid.name).font(.system(.title, design: .serif).weight(.semibold))
                Text(overview.level.name).font(.caption).foregroundStyle(.secondary)
                Spacer()
                VocabStreak(days: overview.streak)
            }
            status(overview)
            VocabDayDots(overview: overview)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("\(overview.count(.mastered)) of \(overview.totalWords) mastered").font(.subheadline.weight(.medium))
                    Spacer()
                    if let accuracy = overview.accuracy {
                        Text("\(Int((accuracy * 100).rounded()))% right this week").font(.caption).foregroundStyle(.secondary)
                    }
                }
                VocabWordsBar(overview: overview)
            }
            if overview.count(.removed) > 0 {
                let removed = overview.count(.removed)
                Text("\(removed) \(removed == 1 ? "word" : "words") skipped as known already.").font(.footnote).foregroundStyle(.secondary)
            }
            if !overview.trouble.isEmpty {
                Text("\(Text("Trouble words: ").fontWeight(.semibold))\(Text(overview.trouble.prefix(8).map(\.title).joined(separator: ", ")).foregroundStyle(.secondary))")
                    .font(.subheadline)
            }
            Divider()
            NavigationLink(value: Route.vocabList(kid: kid.id, name: kid.name)) {
                HStack {
                    Label("\(kid.name)'s words", systemImage: "list.bullet")
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
                .font(.body.weight(.medium))
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
        .padding(20)
        .vocabGlass(tint: overview.isDoneToday ? VocabLook.right.opacity(0.12) : nil)
    }

    @ViewBuilder private func status(_ overview: VocabOverview) -> some View {
        let sessions = overview.finishedToday
        // How the sessions went, each one's score.
        let scores = sessions.isEmpty ? "" : " \(sessions.count) \(sessions.count == 1 ? "session" : "sessions"): "
            + "\(sessions.map { "\($0.done.correct) of \($0.done.total)" }.formatted(.list(type: .and))) right."
        VStack(alignment: .leading, spacing: 4) {
            if overview.isDoneToday {
                Label("Done today\(overview.day.map { ", \(VocabRules.clock($0.ms))" } ?? "").\(scores)", systemImage: "checkmark.seal.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(VocabLook.rightText)
            } else if let goal = overview.day, goal.ms > 0 {
                Label("\(VocabRules.clock(goal.ms)) of \(goal.goalMs / 60_000) minutes so far today.\(scores)", systemImage: "hourglass")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Label("Not started yet today.", systemImage: "circle.dashed")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let open = overview.inProgress {
                Label("Session \(overview.nextSession) under way: \(open.answered) of \(open.total) answered.", systemImage: "hourglass")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - All words

/// Every word and word part with where they stand; tap one to see it laid out.
struct VocabListView: View {
    /// One of the kids, from the parents' view; nil for their own.
    let kid: UUID?
    let name: String?
    @Environment(ChatStore.self) private var store
    @State private var list: VocabList?
    @State private var problem: String?
    @State private var showingParts = false
    @State private var filter = VocabRules.Filter.all
    @State private var query = ""
    @State private var open: VocabRow?

    private var rows: [VocabRow] { (showingParts ? list?.parts : list?.words) ?? [] }

    var body: some View {
        let shown = VocabRules.rows(rows, filter: filter, query: query)
        List {
            Section {
                Picker("Show", selection: $showingParts) {
                    Text("Words (\(list?.words.count ?? 0))").tag(false)
                    Text("Word parts (\(list?.parts.count ?? 0))").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))

                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(VocabRules.Filter.allCases, id: \.self) { f in
                            let on = filter == f
                            Button { filter = f } label: {
                                HStack(spacing: 5) {
                                    Text(f.label)
                                    Text("\(rows.filter(f.holds).count)").monospacedDigit().opacity(0.7)
                                }
                                .font(.subheadline.weight(on ? .semibold : .regular))
                                .foregroundStyle(on ? Color.white : Color.primary)
                                .padding(.horizontal, 13)
                                .padding(.vertical, 7)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(on ? .regular.tint(TuttlesLook.accent).interactive() : .regular.interactive(), in: .capsule)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .scrollIndicators(.hidden)
                .scrollClipDisabled()
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            .listRowSeparator(.hidden)

            Section {
                ForEach(shown) { row in
                    Button { open = row } label: { VocabRowLabel(row: row) }
                        .buttonStyle(.plain)
                        .listRowBackground(Rectangle().fill(.regularMaterial))
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background { VocabBackdrop() }
        .overlay {
            if list == nil, problem == nil {
                ProgressView()
            } else if let problem, list == nil {
                ContentUnavailableView("Couldn't load the words", systemImage: "wifi.slash", description: Text(problem))
            } else if shown.isEmpty {
                ContentUnavailableView("Nothing here yet", systemImage: "character.book.closed").padding(.top, 140)
            }
        }
        .navigationTitle(name.map { "\($0)'s words" } ?? "All words")
        .inlineTitle()
        .searchable(text: $query, prompt: "Search")
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $open) { row in
            VocabWordSheet(row: row, canEdit: list?.canEdit ?? false) { removed in
                await setRemoved(row, removed)
            }
        }
        .animation(.default, value: filter)
        .animation(.default, value: showingParts)
    }

    private func load() async {
        do {
            list = try await store.vocabList(kid: kid)
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    private func setRemoved(_ row: VocabRow, _ removed: Bool) async {
        do {
            try await store.vocabSetRemoved(row.id, removed)
            if store.isDemo {
                // Nothing saves in the demo: show the change on the list in hand.
                let status: VocabStatus = removed ? .removed : .new
                if let at = list?.words.firstIndex(where: { $0.id == row.id }) { list?.words[at].status = status }
                if let at = list?.parts.firstIndex(where: { $0.id == row.id }) { list?.parts[at].status = status }
            } else {
                await load()
            }
        } catch {
            problem = error.localizedDescription
        }
    }
}

private struct VocabRowLabel: View {
    let row: VocabRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Circle()
                .fill(row.status == .new ? Color.clear : row.status.tint)
                .overlay { if row.status == .new { Circle().strokeBorder(Color.primary.opacity(0.3), lineWidth: 1) } }
                .frame(width: 9, height: 9)
                .accessibilityLabel(row.status.label)
            Text(row.title)
                .fontWeight(.semibold)
                .strikethrough(row.status == .removed)
                .foregroundStyle(row.status == .removed ? .secondary : .primary)
            Text(row.meaning).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 4)
            if row.trouble {
                Text("missed \(row.misses)").font(.caption).monospacedDigit().foregroundStyle(VocabLook.amberText)
            }
        }
        .contentShape(.rect)
    }
}

/// A word laid out: what it means, a sentence, the hook that makes it stick,
/// its parts, and how they've done on it.
private struct VocabWordSheet: View {
    let row: VocabRow
    let canEdit: Bool
    let setRemoved: (Bool) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VocabWordCard(title: row.title, pos: row.pos, meaning: row.meaning, example: row.example, hook: row.hook,
                              parts: row.parts, speak: row.isWord)
                Label(standing, systemImage: "chart.bar.fill")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if canEdit, row.status == .removed {
                    Button {
                        saving = true
                        Task {
                            await setRemoved(false)
                            dismiss()
                        }
                    } label: {
                        Text("Bring it back").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    .disabled(saving)
                }
            }
            .padding(24)
            .padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 340)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        #endif
    }

    private var standing: String {
        if row.seen == 0 { return row.status == .removed ? "Skipped as known already." : "Not met yet." }
        var line = "\(row.status.label). Asked \(row.seen) \(row.seen == 1 ? "time" : "times"), right \(row.right)."
        if let due = row.dueOn, let date = StudySet.day.date(from: due) {
            line += " Next up \(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))."
        }
        return line
    }
}

/// The word itself, for learning: in the list, and after a miss in a session.
struct VocabWordCard: View {
    let title: String
    let pos: String?
    let meaning: String
    let example: String?
    let hook: String
    let parts: [VocabFeedback.Part]
    let speak: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(.system(.largeTitle, design: .serif).weight(.semibold))
                if let pos { Text(pos).font(.footnote).italic().foregroundStyle(.secondary) }
                Spacer()
                if speak {
                    Button { VocabVoice.say(title) } label: {
                        Image(systemName: "speaker.wave.2.fill").frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Hear \(title)")
                }
            }
            Text(meaning).font(.title3)
            if let example { Text(example).italic().foregroundStyle(.secondary) }
            Label(hook, systemImage: "lightbulb.fill")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
            if !parts.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(parts, id: \.part) { part in
                        Text("\(Text(part.part).fontWeight(.semibold)) means \(part.meaning)")
                            .font(.footnote)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 6)
                            .background(Color.primary.opacity(0.07), in: .capsule)
                    }
                }
            }
        }
    }
}
