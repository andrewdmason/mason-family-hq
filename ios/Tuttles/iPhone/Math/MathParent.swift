import SwiftUI

// Math for the parents: how each kid is doing, from what their phones have
// sent up (/tuttles/api/math/summary). Today against the twenty, the last two
// weeks, the topics they miss most, and the questions they got wrong lately.

struct MathSummary: Decodable {
    struct Day: Decodable, Hashable {
        let day: String
        let answered: Int
        let correct: Int
    }

    struct Topic: Decodable, Hashable {
        let section: String
        let topic: String
        let answered: Int
        let correct: Int
        let avgMs: Int
    }

    struct Miss: Decodable, Hashable {
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

    struct Kid: Decodable, Identifiable {
        let kid: String
        let name: String
        let level: VocabLevel
        let today: Day
        let days: [Day]
        let streak: Int
        let topics: [Topic]
        let misses: [Miss]
        let best: Best
        let runs: Int
        let answeredTotal: Int
        let correctTotal: Int
        var id: String { kid }
    }

    let kids: [Kid]
}

struct MathParentView: View {
    @Environment(ChatStore.self) private var store
    @State private var summary: MathSummary?
    @State private var problem: String?

    var body: some View {
        PageList {
            if let summary {
                ForEach(summary.kids) { kid in
                    Section {
                        today(kid)
                        strip(kid)
                        if kid.topics.isEmpty {
                            Text("Nothing answered yet.").foregroundStyle(.secondary)
                        } else {
                            ForEach(Array(kid.topics.filter { $0.answered >= 3 }.prefix(5)), id: \.self) { topic in topicRow(topic) }
                        }
                        if !kid.misses.isEmpty {
                            DisclosureGroup("Missed lately (\(kid.misses.count))") {
                                ForEach(Array(kid.misses.prefix(12).enumerated()), id: \.offset) { _, miss in missRow(miss) }
                            }
                        }
                    } header: {
                        Text("\(kid.name) · \(kid.level.name)")
                    } footer: {
                        Text("\(kid.runs) runs · most stars \(kid.best.score.formatted()) · furthest: \(MathZone.all[MathZone.index(forLevel: kid.best.depth)].name) · \(kid.best.streak) right in a row")
                    }
                }
            } else if let problem {
                ContentUnavailableView("Can't load Math", systemImage: "wifi.slash", description: Text(problem))
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Math")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        if store.isDemo {
            summary = Self.demo
            return
        }
        guard let token = try? await store.client.auth.session.accessToken else { return }
        var request = URLRequest(url: ChatStore.websiteURL.appending(path: "tuttles/api/math/summary"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request) else {
            if summary == nil { problem = "No connection." }
            return
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200, let decoded = try? JSONDecoder().decode(MathSummary.self, from: data) else {
            if summary == nil { problem = "The website didn't answer." }
            return
        }
        summary = decoded
        problem = nil
    }

    private func today(_ kid: MathSummary.Kid) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().stroke(Color.primary.opacity(0.1), lineWidth: 7)
                Circle().trim(from: 0, to: min(1, CGFloat(kid.today.answered) / CGFloat(MathStore.dayGoal)))
                    .stroke(kid.today.answered >= MathStore.dayGoal ? Color.green : TuttlesLook.accent, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("\(kid.today.answered)").font(.system(.headline, design: .rounded).weight(.heavy))
            }
            .frame(width: 50, height: 50)
            VStack(alignment: .leading, spacing: 2) {
                Text(kid.today.answered >= MathStore.dayGoal ? "Done for today" : "\(kid.today.answered) of \(MathStore.dayGoal) today")
                    .font(.body.weight(.semibold))
                Text("\(kid.today.correct) right today · \(kid.streak) day\(kid.streak == 1 ? "" : "s") in a row · \(percent(kid.correctTotal, kid.answeredTotal)) right overall")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    /// The last fourteen days: a bar a day, full at the goal, green when it was met.
    private func strip(_ kid: MathSummary.Kid) -> some View {
        HStack(alignment: .bottom, spacing: 4) {
            ForEach(kid.days, id: \.self) { day in
                let share = min(1, CGFloat(day.answered) / CGFloat(MathStore.dayGoal))
                RoundedRectangle(cornerRadius: 3)
                    .fill(day.answered >= MathStore.dayGoal ? Color.green : day.answered > 0 ? TuttlesLook.accent.opacity(0.7) : Color.primary.opacity(0.1))
                    .frame(height: max(4, 34 * share))
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("\(day.day): \(day.answered) answered")
            }
        }
        .frame(height: 36, alignment: .bottom)
    }

    private func topicRow(_ topic: MathSummary.Topic) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text(topic.topic.capitalized).font(.body)
                Text("\(topic.section == "qr" ? "Quantitative Reasoning" : "Mathematics Achievement") · \(topic.avgMs / 1000)s each")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(topic.correct)/\(topic.answered)")
                .font(.system(.body, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(Double(topic.correct) / Double(max(1, topic.answered)) < 0.6 ? .red : .primary)
        }
    }

    private func missRow(_ miss: MathSummary.Miss) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let q = MathBank.question(miss.question) {
                MathText(q.prompt.isEmpty ? "\(q.columnA ?? "")  vs  \(q.columnB ?? "")" : q.prompt, size: 15)
                MathText("Answer: " + q.choices[q.answer], size: 14, weight: .semibold, color: .secondary)
            } else {
                Text(miss.topic.capitalized).font(.subheadline)
            }
            if miss.timedOut { Text("Ran out of time").font(.caption).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 2)
    }

    private func percent(_ a: Int, _ b: Int) -> String { b == 0 ? "0%" : "\(Int((Double(a) / Double(b) * 100).rounded()))%" }

    private static let demo: MathSummary = {
        func days(_ counts: [Int]) -> [MathSummary.Day] {
            counts.enumerated().map { MathSummary.Day(day: "2026-11-\(12 + $0)", answered: $1, correct: Int(Double($1) * 0.7)) }
        }
        return MathSummary(kids: [
            .init(kid: "s", name: "Sebastian", level: .middle, today: .init(day: "2026-11-25", answered: 14, correct: 10),
                  days: days([0, 8, 22, 20, 0, 25, 31, 20, 12, 20, 24, 0, 21, 14]), streak: 1,
                  topics: [.init(section: "qr", topic: "ratios", answered: 12, correct: 5, avgMs: 48000), .init(section: "ma", topic: "geometry", answered: 18, correct: 10, avgMs: 52000),
                           .init(section: "ma", topic: "fractions", answered: 20, correct: 15, avgMs: 31000)],
                  misses: [.init(question: "M-0013", topic: "fractions", section: "qr", at: "2026-11-25T18:00:00Z", timedOut: false)],
                  best: .init(score: 18420, waves: 7, depth: 7, streak: 6), runs: 41, answeredTotal: 237, correctTotal: 166),
            .init(kid: "o", name: "Oscar", level: .lower, today: .init(day: "2026-11-25", answered: 20, correct: 16),
                  days: days([20, 20, 5, 20, 21, 0, 20, 26, 20, 20, 9, 20, 20, 20]), streak: 3,
                  topics: [.init(section: "ma", topic: "measurement", answered: 9, correct: 4, avgMs: 55000), .init(section: "qr", topic: "patterns", answered: 11, correct: 8, avgMs: 40000)],
                  misses: [.init(question: "L-0007", topic: "geometry", section: "ma", at: "2026-11-25T18:00:00Z", timedOut: true)],
                  best: .init(score: 12050, waves: 5, depth: 5, streak: 5), runs: 36, answeredTotal: 241, correctTotal: 181),
        ])
    }()
}
