import Charts
import SwiftUI

// The Parent Dashboard: the parents' one look at how the kids are doing
// (/tuttles/api/parent/dashboard, src/lib/tuttles/dashboard.ts). For each kid:
// where today stands, the words worth going over with them at home, where
// Math is going wrong, their house and purse, and the last four weeks of
// Vocab and Math. Vocab and Math have no pages of their own for the parents:
// what those showed is here. Only This week sits beside it in the menu.

struct DashboardPayload: Decodable {
    struct Day: Decodable, Hashable, Identifiable {
        let day: String
        let vocabMs: Int
        let vocabAnswered: Int
        let vocabCorrect: Int
        let vocabDone: Bool
        let mathAnswered: Int
        let mathCorrect: Int
        let mastered: Int
        var id: String { day }
        var date: Date { DashboardDates.date(day) }
        var vocabMinutes: Double { Double(vocabMs) / 60_000 }
    }
    struct Week: Decodable, Hashable, Identifiable {
        let start: String
        let vocabMs: Int
        let vocabAnswered: Int
        let vocabCorrect: Int
        let vocabDaysDone: Int
        let mathAnswered: Int
        let mathCorrect: Int
        let masteredGained: Int
        var id: String { start }
    }
    struct Word: Decodable, Hashable, Identifiable {
        let id: String
        let title: String
        let kind: String
        let pos: String
        let meaning: String
        let example: String
        let hook: String
        let misses: Int
        /// "trouble" (missed again and again) or "due" (up for review now, not yet sure).
        let reason: String
    }
    /// Math, past the day-by-day: what's going wrong, and their bests.
    struct Math: Decodable, Hashable {
        struct Topic: Decodable, Hashable {
            /// "qr" (Quantitative Reasoning) or "ma" (Mathematics Achievement).
            let section: String
            let topic: String
            let answered: Int
            let correct: Int
            let avgMs: Int
        }
        struct Miss: Decodable, Hashable {
            /// The question's id in the bank (iPhone/Math/MathBank.swift).
            let question: String
            let topic: String
            let section: String
            let at: String
            let timedOut: Bool
        }
        struct Best: Decodable, Hashable {
            let score: Int
            let waves: Int
            let depth: Int
            let streak: Int
        }
        /// Days in a row with the day's twenty answered.
        let streak: Int
        /// The few topics they get wrong most, the worst first.
        let topics: [Topic]
        /// The questions missed lately, the newest first.
        let misses: [Miss]
        let best: Best
        let runs: Int
        let answeredTotal: Int
        let correctTotal: Int
    }
    /// What's in their purse, and how big the house has got.
    struct House: Decodable, Hashable {
        let coins: Int
        let gems: Int
        let rooms: Int
    }
    struct Kid: Decodable, Hashable, Identifiable {
        let id: String
        let name: String
        let level: String
        let totalWords: Int
        let mastered: Int
        let days: [Day]
        let weeks: [Week]
        let practice: [Word]
        /// Days in a row with Vocab's ten minutes done. These three are nil from an older website.
        var vocabStreak: Int? = nil
        var math: Math? = nil
        /// Nil too when they've never opened the house.
        var house: House? = nil
    }
    let today: String
    let kids: [Kid]
    /// Days until the ISEE. Nil from an older website.
    var daysLeft: Int? = nil
}

enum DashboardDates {
    private static let parser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// A tick a week along the bottom of a chart, with its date.
    static var weekAxis: some AxisContent {
        AxisMarks(values: .stride(by: .day, count: 7)) { _ in
            AxisGridLine()
            AxisValueLabel(format: .dateTime.month(.abbreviated).day())
        }
    }

    /// A day as the website writes it ("2026-11-26"), as noon that day here.
    static func date(_ day: String) -> Date {
        (parser.date(from: day) ?? .now).addingTimeInterval(12 * 3600)
    }
}

extension ChatStore {
    /// The Parent Dashboard's numbers. Nil with no connection, or for anyone but a parent.
    func loadDashboard() async -> DashboardPayload? {
        if isDemo { return DemoDashboard.payload }
        guard let token = try? await client.auth.session.accessToken else { return nil }
        var request = URLRequest(url: Self.websiteURL.appending(path: "tuttles/api/parent/dashboard"))
        request.timeoutInterval = 60
        // No kid named: this is the parents' own look at both kids.
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(DashboardPayload.self, from: data)
    }
}

struct ParentDashboardView: View {
    @Environment(ChatStore.self) private var store
    @State private var payload: DashboardPayload?
    @State private var loaded = false
    @State private var kidID: String?

    private var kid: DashboardPayload.Kid? {
        payload?.kids.first { $0.id == kidID } ?? payload?.kids.first
    }

    var body: some View {
        PageList {
            if let payload, let kid {
                if payload.kids.count > 1 {
                    Section {
                        Picker("Kid", selection: Binding(get: { kid.id }, set: { kidID = $0 })) {
                            ForEach(payload.kids) { Text($0.name).tag($0.id) }
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                }
                DashboardToday(kid: kid, today: payload.today, daysLeft: payload.daysLeft)
                DashboardPractice(kid: kid)
                if let math = kid.math { DashboardMath(kid: kid, math: math) }
                #if os(iOS)
                DashboardHouse(kid: kid)
                #endif
                DashboardTrends(kid: kid)
                DashboardWeeks(kid: kid)
            } else if loaded {
                ContentUnavailableView("Couldn't load the dashboard", systemImage: "wifi.slash",
                                       description: Text("Pull down to try again."))
            } else {
                Section { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40) }
            }
        }
        .navigationTitle("Parent Dashboard")
        .task { if payload == nil { await load() } }
        .refreshable { await load() }
    }

    private func load() async {
        if let fresh = await store.loadDashboard() { payload = fresh }
        loaded = true
    }
}

/// Where today stands: Vocab's ten minutes and Math's twenty questions, and the days in a row of each.
private struct DashboardToday: View {
    let kid: DashboardPayload.Kid
    let today: String
    let daysLeft: Int?

    /// Math's questions a day (MathStore.dayGoal, which only the iPhone has).
    static let mathGoal = 20

    var body: some View {
        let day = kid.days.last.flatMap { $0.day == today ? $0 : nil }
        let minutes = Int((day?.vocabMinutes ?? 0).rounded(.down))
        let answered = day?.mathAnswered ?? 0
        let right = day?.mathCorrect ?? 0
        // How Vocab's answers have gone today, once there are some.
        let words = (day?.vocabAnswered ?? 0) > 0 ? ", \(day?.vocabCorrect ?? 0) of \(day?.vocabAnswered ?? 0) right" : ""
        Section {
            row("Vocab", done: day?.vocabDone == true, started: (day?.vocabMs ?? 0) > 0, streak: kid.vocabStreak,
                detail: day?.vocabDone == true ? "Done · \(minutes) min\(words)" : (day?.vocabMs ?? 0) > 0 ? "\(minutes) of 10 min\(words)" : "Not yet")
            row("Math", done: answered >= Self.mathGoal, started: answered > 0, streak: kid.math?.streak,
                detail: answered >= Self.mathGoal ? "Done · \(answered) questions, \(right) right"
                    : answered > 0 ? "\(answered) of \(Self.mathGoal) questions, \(right) right" : "Not yet")
        } header: {
            Text("Today")
        } footer: {
            if let daysLeft, daysLeft >= 0 { Text(VocabRules.countdown(daysLeft: daysLeft)) }
        }
    }

    private func row(_ title: String, done: Bool, started: Bool, streak: Int?, detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: done ? "checkmark.circle.fill" : started ? "circle.bottomhalf.filled" : "circle")
                .font(.title2)
                .foregroundStyle(done ? Color.green : started ? Color.orange : Color.secondary.opacity(0.5))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold))
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            if let streak { VocabStreak(days: streak) }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// The words to go over with them today.
private struct DashboardPractice: View {
    let kid: DashboardPayload.Kid

    var body: some View {
        Section {
            if kid.practice.isEmpty {
                Text("Nothing \(kid.name) is stuck on right now.").foregroundStyle(.secondary)
            }
            ForEach(kid.practice) { word in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(word.title).font(.system(.title3, design: .serif).weight(.semibold))
                        Text(word.pos).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text(word.reason == "trouble" ? "Missed \(word.misses)×" : "Due for review")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(word.reason == "trouble" ? Color.orange : Color.blue)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background((word.reason == "trouble" ? Color.orange : Color.blue).opacity(0.12), in: .capsule)
                    }
                    Text(word.meaning)
                    if !word.example.isEmpty {
                        Text(word.example).font(.subheadline).italic().foregroundStyle(.secondary)
                    }
                    if !word.hook.isEmpty {
                        Label(word.hook, systemImage: "lightbulb").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                .textSelection(.enabled)
            }
            // Every word and where it stands (VocabListView), the way in that Vocab's own page for the parents was.
            if let id = UUID(uuidString: kid.id) {
                NavigationLink(value: Route.vocabList(kid: id, name: kid.name)) {
                    Label("All of \(kid.name)'s words", systemImage: "list.bullet")
                }
            }
        } header: {
            Text("Practice with \(kid.name) today")
        } footer: {
            Text("The words \(kid.name) keeps missing come first, then ones up for review that aren't sure yet. Try a couple at dinner or in the car: say the word, ask what it means, then use it in a sentence together. The list changes as they practice.")
        }
    }
}

/// Where Math is going wrong: the topics they miss most, and the questions they got wrong lately.
private struct DashboardMath: View {
    let kid: DashboardPayload.Kid
    let math: DashboardPayload.Math

    var body: some View {
        Section {
            if math.topics.isEmpty, math.misses.isEmpty {
                Text(math.answeredTotal == 0 ? "\(kid.name) hasn't answered any Math yet." : "Nothing \(kid.name) keeps missing so far.")
                    .foregroundStyle(.secondary)
            }
            ForEach(math.topics, id: \.self) { topic in
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(topic.topic.capitalized)
                        Text("\(topic.section == "qr" ? "Quantitative Reasoning" : "Mathematics Achievement") · \(topic.avgMs / 1000)s each")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(topic.correct)/\(topic.answered)")
                        .font(.system(.body, design: .rounded).weight(.bold).monospacedDigit())
                        .foregroundStyle(Double(topic.correct) / Double(max(1, topic.answered)) < 0.6 ? Color.red : Color.primary)
                        .accessibilityLabel("\(topic.correct) of \(topic.answered) right")
                }
            }
            if !math.misses.isEmpty {
                DisclosureGroup("Missed lately (\(math.misses.count))") {
                    ForEach(Array(math.misses.enumerated()), id: \.offset) { _, miss in
                        #if os(iOS)
                        // The question as it was asked, from the bank (iPhone/Math/MathParent.swift).
                        MathMissRow(miss: miss)
                        #else
                        // The bank is the iPhone's: here, what it was about.
                        Text(miss.timedOut ? "\(miss.topic.capitalized) (ran out of time)" : miss.topic.capitalized)
                        #endif
                    }
                }
            }
        } header: {
            Text("Math to work on")
        } footer: {
            if math.answeredTotal > 0 { Text(totals) }
        }
    }

    /// "41 runs · most stars 18,420 · furthest: Gym · 6 right in a row · 70% right overall"
    private var totals: String {
        var parts = ["\(math.runs) \(math.runs == 1 ? "run" : "runs")", "most stars \(math.best.score.formatted())"]
        #if os(iOS)
        parts.append("furthest: \(math.best.furthest)")
        #endif
        parts.append("\(math.best.streak) right in a row")
        parts.append("\(Int((Double(math.correctTotal) / Double(math.answeredTotal) * 100).rounded()))% right overall")
        return parts.joined(separator: " · ")
    }
}

#if os(iOS)
/// Their house and what's in the purse; it opens the street, where the parents can walk into either house (HouseViews.swift).
private struct DashboardHouse: View {
    let kid: DashboardPayload.Kid

    var body: some View {
        Section("House") {
            NavigationLink(value: Route.house) {
                HStack(spacing: 12) {
                    Image(systemName: "house.fill").font(.title2).foregroundStyle(TuttlesLook.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(kid.name)'s house").font(.body.weight(.semibold))
                        Text(detail).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var detail: String {
        guard let house = kid.house else { return "Not opened yet" }
        return "\(house.rooms) \(house.rooms == 1 ? "room" : "rooms") · \(house.coins.formatted()) \(house.coins == 1 ? "coin" : "coins") · \(house.gems) \(house.gems == 1 ? "gem" : "gems")"
    }
}
#endif

/// The last four weeks, a bar a day.
private struct DashboardTrends: View {
    let kid: DashboardPayload.Kid

    var body: some View {
        Section {
            chart("Vocab minutes a day", goal: 10, goalLabel: "10 min goal") { day in
                BarMark(x: .value("Day", day.date, unit: .day), y: .value("Minutes", day.vocabMinutes))
                    .foregroundStyle(day.vocabDone ? Color.green : Color.green.opacity(0.4))
            }
            chart("Math questions a day", goal: 20, goalLabel: "20 a day") { day in
                BarMark(x: .value("Day", day.date, unit: .day), y: .value("Questions", day.mathAnswered))
                    .foregroundStyle(Color.purple.opacity(0.75))
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Words mastered").font(.subheadline.weight(.medium))
                    Spacer()
                    Text("\(kid.mastered) of \(kid.totalWords)").font(.caption).foregroundStyle(.secondary)
                }
                Chart(kid.days) { day in
                    LineMark(x: .value("Day", day.date, unit: .day), y: .value("Mastered", day.mastered))
                        .interpolationMethod(.stepEnd)
                    AreaMark(x: .value("Day", day.date, unit: .day), y: .value("Mastered", day.mastered))
                        .interpolationMethod(.stepEnd)
                        .foregroundStyle(Color.accentColor.opacity(0.12))
                }
                .chartXAxis { DashboardDates.weekAxis }
                .frame(height: 120)
            }
            .padding(.vertical, 4)
        } header: {
            Text("Last four weeks")
        }
    }

    private func chart<M: ChartContent>(_ title: String, goal: Int, goalLabel: String,
                                        @ChartContentBuilder mark: @escaping (DashboardPayload.Day) -> M) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.medium))
            Chart {
                ForEach(kid.days) { mark($0) }
                RuleMark(y: .value("Goal", goal))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .foregroundStyle(.secondary)
                    .annotation(position: .top, alignment: .leading) {
                        Text(goalLabel).font(.caption2).foregroundStyle(.secondary)
                    }
            }
            .chartXAxis { DashboardDates.weekAxis }
            .frame(height: 120)
        }
        .padding(.vertical, 4)
    }
}

/// Week by week, the newest first.
private struct DashboardWeeks: View {
    let kid: DashboardPayload.Kid

    var body: some View {
        Section("Week by week") {
            ForEach(kid.weeks.reversed()) { week in
                VStack(alignment: .leading, spacing: 4) {
                    Text("Week of \(DashboardDates.date(week.start), format: .dateTime.month(.abbreviated).day())")
                        .font(.subheadline.weight(.semibold))
                    Text("Vocab: \(week.vocabDaysDone) \(week.vocabDaysDone == 1 ? "day" : "days") done, \(week.vocabMs / 60_000) min\(percent(week.vocabCorrect, of: week.vocabAnswered))")
                        .font(.subheadline)
                    Text("Math: \(week.mathAnswered) questions\(percent(week.mathCorrect, of: week.mathAnswered))")
                        .font(.subheadline)
                    if week.masteredGained > 0 {
                        Text("+\(week.masteredGained) \(week.masteredGained == 1 ? "word" : "words") mastered")
                            .font(.footnote)
                            .foregroundStyle(.green)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func percent(_ right: Int, of total: Int) -> String {
        total == 0 ? "" : ", \(Int((Double(right) / Double(total) * 100).rounded()))% right"
    }
}

/// Made-up numbers for `--demo`.
enum DemoDashboard {
    static var payload: DashboardPayload {
        let calendar = Calendar(identifier: .gregorian)
        let format = DateFormatter()
        format.dateFormat = "yyyy-MM-dd"
        format.locale = Locale(identifier: "en_US_POSIX")
        func kid(_ id: String, _ name: String, level: String, seed: Int) -> DashboardPayload.Kid {
            var mastered = 40 + seed
            let days: [DashboardPayload.Day] = (0..<28).map { i in
                let day = format.string(from: calendar.date(byAdding: .day, value: i - 27, to: .now) ?? .now)
                let played = (i + seed) % 5 != 0
                let ms = played ? (6 + (i * 7 + seed) % 8) * 60_000 : 0
                if played, i % 2 == 0 { mastered += 1 + (i + seed) % 3 }
                let math = played ? 10 + (i * 3 + seed) % 18 : 0
                return .init(day: day, vocabMs: ms, vocabAnswered: ms / 20_000, vocabCorrect: ms / 26_000, vocabDone: ms >= 600_000,
                             mathAnswered: math, mathCorrect: math * 3 / 4, mastered: mastered)
            }
            let weeks: [DashboardPayload.Week] = stride(from: 0, to: 28, by: 7).map { at in
                let slice = days[at..<at + 7]
                return .init(start: slice.first!.day, vocabMs: slice.map(\.vocabMs).reduce(0, +), vocabAnswered: slice.map(\.vocabAnswered).reduce(0, +),
                             vocabCorrect: slice.map(\.vocabCorrect).reduce(0, +), vocabDaysDone: slice.filter(\.vocabDone).count,
                             mathAnswered: slice.map(\.mathAnswered).reduce(0, +), mathCorrect: slice.map(\.mathCorrect).reduce(0, +),
                             masteredGained: slice.last!.mastered - (at == 0 ? 40 + seed : days[at - 1].mastered))
            }
            let words: [DashboardPayload.Word] = [
                .init(id: "w:benevolent", title: "benevolent", kind: "word", pos: "adj", meaning: "kind and generous",
                      example: "The benevolent neighbor shoveled everyone's walk.", hook: "bene- means good, as in benefit.", misses: 5, reason: "trouble"),
                .init(id: "w:candid", title: "candid", kind: "word", pos: "adj", meaning: "honest and direct",
                      example: "She gave a candid answer about the test.", hook: "A candid camera catches you as you really are.", misses: 3, reason: "trouble"),
                .init(id: "w:diligent", title: "diligent", kind: "word", pos: "adj", meaning: "careful and hard-working",
                      example: "A diligent student checks every answer.", hook: "", misses: 1, reason: "due"),
            ]
            // Questions out of the bank for its level, so the misses read as they were asked.
            let lower = level == "lower"
            let math = DashboardPayload.Math(
                streak: seed, topics: [
                    .init(section: "qr", topic: lower ? "patterns" : "ratios", answered: 12, correct: 5, avgMs: 48000),
                    .init(section: "ma", topic: lower ? "measurement" : "geometry", answered: 18, correct: 10, avgMs: 52000),
                    .init(section: "ma", topic: "fractions", answered: 20, correct: 15, avgMs: 31000),
                ],
                misses: [
                    .init(question: lower ? "L-0007" : "M-0013", topic: lower ? "geometry" : "fractions", section: lower ? "ma" : "qr", at: "2026-11-25T18:00:00Z", timedOut: lower),
                    .init(question: lower ? "L-0012" : "M-0021", topic: lower ? "patterns" : "ratios", section: "qr", at: "2026-11-24T18:00:00Z", timedOut: false),
                ],
                best: .init(score: 12_000 + seed * 2140, waves: 4 + seed, depth: 4 + seed, streak: 4 + seed), runs: 36 + seed, answeredTotal: 237, correctTotal: 166)
            return .init(id: id, name: name, level: level, totalWords: 600, mastered: days.last!.mastered, days: days, weeks: weeks, practice: words,
                         vocabStreak: seed + 1, math: math, house: .init(coins: 640 * seed, gems: seed, rooms: 2 + seed))
        }
        // The ids are DemoVocab's kids', so "All of …'s words" opens the demo's list.
        return .init(today: format.string(from: .now), kids: [
            kid("00000000-0000-0000-0000-00000000000a", "Oscar", level: "lower", seed: 1),
            kid("00000000-0000-0000-0000-00000000000b", "Sebastian", level: "middle", seed: 3),
        ], daysLeft: 46)
    }
}
