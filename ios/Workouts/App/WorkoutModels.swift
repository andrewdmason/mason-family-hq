import Foundation

// A workout as the website stores it (supabase/migrations/00119_workouts_core.sql):
// a session of blocks, each block's movements, each movement's sets. The names
// follow src/lib/workouts/queries.ts.

/// A database enum that may grow on the website before the app is rebuilt: a
/// value this build doesn't know reads as `fallback` rather than failing the
/// whole load.
protocol LenientEnum: RawRepresentable, Codable, Sendable where RawValue == String {
    static var fallback: Self { get }
}

extension LenientEnum {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.fallback
    }
}

enum BlockType: String, LenientEnum {
    case warmup, strength, metcon, accessory, cooldown, skill
    static let fallback = BlockType.metcon
}

enum MetricType: String, LenientEnum {
    case loadReps = "load_reps", distance, duration, calories, reps
    static let fallback = MetricType.reps
}

enum SetContext: String, LenientEnum {
    case strength, metcon, warmup, accessory
    static let fallback = SetContext.strength
}

enum RxLevel: String, LenientEnum {
    case scaled, rx, rxPlus = "rx_plus"
    static let fallback = RxLevel.rx

    var label: String {
        switch self {
        case .scaled: "Scaled"
        case .rx: "Rx"
        case .rxPlus: "Rx+"
        }
    }
}

enum ScoreType: String, LenientEnum {
    case time, roundsReps = "rounds_reps", reps, load, distance, calories, none
    static let fallback = ScoreType.none
}

/// One side of a set: what was written, or what was done.
struct SetMetrics: Codable, Equatable {
    var reps: Int?
    var load: Double?
    var unit: String?
    /// Meters.
    var distance: Double?
    /// Seconds.
    var duration: Int?
    var calories: Int?
}

struct WorkoutSet: Identifiable, Codable, Equatable {
    let id: UUID
    var position: Int
    var metricType: MetricType
    var context: SetContext
    var rxLevel: RxLevel?
    var prescribed: SetMetrics
    /// Seeded equal to `prescribed` when the workout is structured, so doing
    /// what was written needs no edits.
    var actual: SetMetrics
    var e1rm: Double?
    var e1rmIsLoose: Bool
}

struct Entry: Identifiable, Codable, Equatable {
    let id: UUID
    var position: Int
    var rawName: String
    var movementID: UUID?
    var canonicalName: String?
    var family: String?
    /// Whether its sets feed estimated 1RMs.
    var isLoaded: Bool
    var sets: [WorkoutSet]

    var name: String { canonicalName ?? rawName }
    /// A movement inside a conditioning piece: its result is the block's score,
    /// so its sets read as a line of the recipe rather than fields.
    var isMetcon: Bool { (sets.first?.context ?? .strength) == .metcon }
}

struct Score: Codable, Equatable {
    var seconds: Int?
    var rounds: Int?
    var reps: Int?
    var load: Double?
    var distance: Double?
    var calories: Int?
}

struct Block: Identifiable, Codable, Equatable {
    let id: UUID
    var position: Int
    var blockType: BlockType
    var title: String?
    /// The shared name when this block is one part of a multi-part workout.
    var groupLabel: String?
    var scoreType: ScoreType
    var score: Score
    var rxLevel: RxLevel?
    var benchmarkID: UUID?
    var benchmarkName: String?
    var entries: [Entry]
}

struct SessionDetail: Identifiable, Codable, Equatable {
    let id: UUID
    /// YYYY-MM-DD.
    var sessionDate: String
    var title: String?
    /// "calendar" or "manual".
    var source: String
    var calendarEventID: UUID?
    var rawDescription: String?
    var notes: String?
    /// "easier" or "harder"; nil is a normal day.
    var effort: String?
    /// "low" or "high"; nil is a normal day.
    var energy: String?
    var parsed: Bool
    var completed: Bool
    /// "synced", "dirty", "failed" or "syncing", once it has been sent to WHOOP.
    var whoopSyncStatus: String?
    var blocks: [Block]

    var isUnparsed: Bool { !parsed && blocks.isEmpty }
    var entries: [Entry] { blocks.flatMap(\.entries) }
}

/// A session as a row in a list.
struct SessionSummary: Identifiable, Codable, Equatable, Hashable {
    let id: UUID
    var date: String
    var title: String
    var blockCount: Int
    var completed: Bool
    var calendarEventID: UUID?
    var createdAt: String
}

/// A workout on the calendar (a "CFO: …" event), by the day it falls on here.
struct WorkoutEvent: Identifiable, Codable, Equatable, Hashable {
    let id: UUID
    /// The title with its "CFO:" prefix gone.
    var title: String
    var date: String
}

// MARK: - What the gym view leans on

struct HistorySet: Codable, Equatable, Hashable {
    var date: String
    var load: Double?
    var reps: Int?
    var unit: String?
    var e1rm: Double?
    var e1rmIsLoose: Bool
}

/// How a loaded movement has gone before.
struct MovementHistory: Codable, Equatable {
    var bestE1rmStrict: Double?
    /// Most recent first.
    var recent: [HistorySet]

    func suggestedLoad(reps: Int) -> Double? {
        bestE1rmStrict.map { WorkoutRules.suggestedLoad(bestE1rm: $0, reps: reps) }
    }

    func percent(ofLoad load: Double) -> Int? {
        bestE1rmStrict.flatMap { WorkoutRules.percentOfE1rm(load: load, bestE1rm: $0) }
    }
}

/// An estimate for a lift with no history, from a family-mate that has some.
struct SiblingHint: Codable, Equatable {
    var fromName: String
    var low: Double
    var high: Double
}

struct BenchmarkAttempt: Codable, Equatable {
    var date: String
    var scoreType: ScoreType
    var score: Score
    var rxLevel: RxLevel?
}

struct Substitute: Codable, Equatable {
    var id: UUID
    var name: String
}

/// The comparisons shown beside a session's movements, keyed by entry (or
/// block, for benchmark attempts).
struct SessionInsights: Codable, Equatable {
    var history: [UUID: MovementHistory] = [:]
    var hints: [UUID: SiblingHint] = [:]
    var attempts: [UUID: [BenchmarkAttempt]] = [:]
    var substitutes: [UUID: Substitute] = [:]
}

// MARK: - Progress

struct LiftStat: Identifiable, Codable, Equatable {
    var id: UUID
    var name: String
    var bestE1rm: Double
    /// The best from more than 90 days ago, for the trend.
    var priorE1rm: Double?
    var lastDate: String
}

struct FamilyProgress: Identifiable, Codable, Equatable {
    var family: String
    var label: String
    /// Strongest first.
    var lifts: [LiftStat]
    var totalReps: Int
    var totalVolumeLoad: Int
    var lastDate: String?

    var id: String { family }
}

struct BenchmarkPR: Identifiable, Codable, Equatable {
    var id: UUID
    var name: String
    var scoreType: ScoreType
    var attempts: Int
    var best: Score
    var bestRxLevel: RxLevel?
    var lastDate: String
}

struct WorkoutTrend: Equatable {
    var last7 = 0
    var prev7 = 0
    var last30 = 0
    var prev30 = 0
}

/// One set as the progress roll-up reads it.
struct ProgressSet: Equatable {
    var movementID: UUID
    var name: String
    var family: String
    var isLoaded: Bool
    var date: String
    var load: Double?
    var reps: Int?
    var e1rm: Double?
    var e1rmIsLoose: Bool
    var context: SetContext
}

/// One scored benchmark block.
struct BenchmarkRow: Equatable {
    var benchmarkID: UUID
    var name: String
    var date: String
    var scoreType: ScoreType
    var score: Score
    var rxLevel: RxLevel?
}
