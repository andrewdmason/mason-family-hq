import Charts
import SwiftUI

// The Parent Dashboard's own page: for each kid, the words worth going over
// with them at home today, and how their Vocab and Math have gone over the
// last four weeks (/tuttles/api/parent/dashboard, src/lib/tuttles/dashboard.ts).
// It's the first thing a parent sees in the Parent Dashboard; This week, Vocab,
// Math and the houses sit beside it in the menu.

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
    struct Kid: Decodable, Hashable, Identifiable {
        let id: String
        let name: String
        let level: String
        let totalWords: Int
        let mastered: Int
        let days: [Day]
        let weeks: [Week]
        let practice: [Word]
    }
    let today: String
    let kids: [Kid]
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
                DashboardPractice(kid: kid)
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
        } header: {
            Text("Practice with \(kid.name) today")
        } footer: {
            Text("The words \(kid.name) keeps missing come first, then ones up for review that aren't sure yet. Try a couple at dinner or in the car: say the word, ask what it means, then use it in a sentence together. The list changes as they practice.")
        }
    }
}

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
            return .init(id: id, name: name, level: level, totalWords: 600, mastered: days.last!.mastered, days: days, weeks: weeks, practice: words)
        }
        return .init(today: format.string(from: .now), kids: [kid("oscar", "Oscar", level: "lower", seed: 1), kid("sebastian", "Sebastian", level: "middle", seed: 3)])
    }
}
