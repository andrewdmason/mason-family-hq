import Foundation

// The questions. They ship inside the app (MathAssets/bank, built by
// scripts/math/import.mts from Andrew's spreadsheet of real ISEE questions),
// one file per level, so a run never needs a connection. Each says where it
// came from: "real", a "variant" of a real one with the numbers changed, or a
// "placeholder" written before the real ones arrived.

struct MathQuestion: Codable, Identifiable, Hashable {
    let id: String
    /// "qr" (Quantitative Reasoning) or "ma" (Mathematics Achievement).
    let section: String
    let topic: String
    /// "word", "computation" or "comparison".
    let type: String
    let prompt: String
    let columnA: String?
    let columnB: String?
    let choices: [String]
    let answer: Int
    let explanation: String
    let difficulty: Int
    let diagram: MathDiagram?
    let source: String
    let of: String?
    let ref: String?

    /// Seconds allowed: about the real test's pace, with more for the hard ones.
    var seconds: Int {
        let base = [1: 55, 2: 65, 3: 85][difficulty] ?? 65
        return base + (diagram != nil ? 5 : 0) + (prompt.count > 220 ? 10 : 0)
    }
}

/// A figure, in the small drawing language the importer writes (scripts/math/bank.mts).
struct MathDiagram: Codable, Hashable {
    let w: Double
    let h: Double
    let items: [Item]

    struct Point: Codable, Hashable {
        let v: Double?
        let p: [Double]?
        let label: String?
    }

    struct Slice: Codable, Hashable {
        let v: Double
        let label: String?
        let shade: Int?
    }

    /// A number line's labels are a word or a list of numbers; a bar chart's are names.
    enum Labels: Codable, Hashable {
        case word(String)
        case numbers([Double])
        case names([String])

        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) { self = .word(s) } else if let n = try? c.decode([Double].self) { self = .numbers(n) } else {
                self = .names((try? c.decode([String].self)) ?? [])
            }
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case .word(let s): try c.encode(s)
            case .numbers(let n): try c.encode(n)
            case .names(let n): try c.encode(n)
            }
        }
    }

    struct Item: Codable, Hashable {
        let t: String
        var a: [Double]?
        var b: [Double]?
        var dash: Bool?
        var arrow: String?
        var pts: [[Double]]?
        var closed: Bool?
        var fill: String?
        var c: [Double]?
        var r: Double?
        var from: Double?
        var to: Double?
        var at: [Double]?
        var s: String?
        var size: String?
        var anchor: String?
        var n: Int?
        var x: Double?
        var y: Double?
        var w: Double?
        var h: Double?
        var x0: Double?
        var x1: Double?
        var min: Double?
        var max: Double?
        var step: Double?
        var labels: Labels?
        var points: [Point]?
        var values: [Double]?
        var title: String?
        var ylabel: String?
        var cols: [String]?
        var rows: [[String]]?
        var xmin: Double?
        var xmax: Double?
        var ymin: Double?
        var ymax: Double?
        var segments: [[[Double]]]?
        var slices: [Slice]?
    }
}

enum MathBank {
    private struct File: Decodable {
        let version: String
        let questions: [MathQuestion]
    }

    private static var loaded: [VocabLevel: (version: String, questions: [MathQuestion])] = [:]

    static func questions(_ level: VocabLevel) -> [MathQuestion] { load(level).questions }
    static func version(_ level: VocabLevel) -> String { load(level).version }

    private static func load(_ level: VocabLevel) -> (version: String, questions: [MathQuestion]) {
        if let hit = loaded[level] { return hit }
        let url = Bundle.main.bundleURL.appending(path: "MathAssets/bank/math-\(level.rawValue).json")
        var out: (version: String, questions: [MathQuestion]) = ("none", [])
        if let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(File.self, from: data) {
            // Nothing that can't be asked: four choices and an answer among them.
            out = (file.version, file.questions.filter { $0.choices.count == 4 && (0..<4).contains($0.answer) })
        }
        loaded[level] = out
        return out
    }

    static func question(_ id: String) -> MathQuestion? {
        for level in [VocabLevel.lower, .middle] {
            if let q = questions(level).first(where: { $0.id == id }) { return q }
        }
        return nil
    }

    /// What a kid has done with one question.
    struct Seen: Codable, Hashable {
        var times = 0
        var right = 0
        var last: Date?
    }

    /// The next question for a run. One missed lately comes back first
    /// (Andrew: "within the next run or two"). Otherwise it's one they
    /// haven't had, as hard as this far into a run should be, real ones
    /// before variants before placeholders.
    static func next(level: VocabLevel, runLevel: Int, seen: [String: Seen], comeback: [String], asked: Set<String>,
                     using rng: inout SystemRandomNumberGenerator) -> MathQuestion? {
        let all = questions(level).filter { !asked.contains($0.id) }
        guard !all.isEmpty else { return questions(level).randomElement(using: &rng) }
        if let due = comeback.first(where: { id in all.contains { $0.id == id } }), Double.random(in: 0...1, using: &rng) < 0.7 {
            return all.first { $0.id == due }
        }
        let wanted = runLevel < 2 ? 1 : (runLevel < 5 ? 2 : 3)
        func rank(_ q: MathQuestion) -> Double {
            let s = seen[q.id]
            var score = 0.0
            // Not had yet beats had; got wrong beats got right.
            if s == nil { score += 40 } else if (s?.right ?? 0) == 0 { score += 25 } else { score -= Double(s?.right ?? 0) * 6 }
            if let last = s?.last { score += min(20, Date().timeIntervalSince(last) / 86400 * 3) }
            score -= Double(abs(q.difficulty - wanted)) * 14
            score += ["real": 12.0, "variant": 6.0][q.source] ?? 0
            return score + Double.random(in: 0..<10, using: &rng)
        }
        return all.max { rank($0) < rank($1) }
    }
}
