import Foundation

// The website's workout rules, ported: how results read (src/lib/workouts/format.ts),
// estimated 1RMs (e1rm.ts, normalization.ts), which workout is today's
// (src/lib/home/workouts.ts), the completed recap (workout-summary.tsx) and the
// progress roll-ups (progress.ts). Keep the two in step.

/// Days as the website writes them, YYYY-MM-DD, with no time zone to drift.
enum WorkoutDay {
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }()

    /// The day it is here.
    static func today(_ now: Date = .now, calendar: Calendar = .current) -> String {
        string(now, calendar: calendar)
    }

    /// The day an instant falls on in `calendar`'s time zone.
    static func string(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Noon UTC on that day, for arithmetic and formatting.
    static func date(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return utc.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// Whole days from `from` to `to`; negative when `to` is earlier.
    static func days(from: String, to: String) -> Int {
        guard let a = date(from), let b = date(to) else { return 0 }
        return Int((b.timeIntervalSince(a) / 86_400).rounded())
    }

    static func daysAgo(_ day: String, _ count: Int) -> String {
        guard let date = date(day), let moved = utc.date(byAdding: .day, value: -count, to: date) else { return day }
        return string(moved, calendar: utc)
    }

    private static func style() -> Date.FormatStyle {
        Date.FormatStyle(locale: Locale(identifier: "en_US"), timeZone: .gmt)
    }

    /// "Mon, Jun 1".
    static func short(_ day: String) -> String {
        date(day)?.formatted(style().weekday(.abbreviated).month(.abbreviated).day()) ?? day
    }

    /// A date at its shortest: "Jul 22" this year, "Jul 2025" before it.
    static func brief(_ day: String, today: String) -> String {
        guard let date = date(day) else { return day }
        return day.prefix(4) == today.prefix(4)
            ? date.formatted(style().month(.abbreviated).day())
            : date.formatted(style().month(.abbreviated).year())
    }

    /// "Monday".
    static func weekday(_ day: String) -> String {
        date(day)?.formatted(style().weekday(.wide)) ?? day
    }

    /// "June 2026", for grouping a history.
    static func month(_ day: String) -> String {
        date(day)?.formatted(style().month(.wide).year()) ?? day
    }

    /// The day of the month and the short weekday, for a date badge.
    static func badge(_ day: String) -> (day: String, weekday: String) {
        guard let date = date(day) else { return (day, "") }
        return (date.formatted(style().day()), date.formatted(style().weekday(.abbreviated)))
    }

    /// Looking ahead: "Today", "Tomorrow", a weekday within the week, else "Mon, Jun 9".
    static func label(_ day: String, today: String) -> String {
        let ahead = days(from: today, to: day)
        if ahead == 0 { return "Today" }
        if ahead == 1 { return "Tomorrow" }
        if ahead > 1 && ahead < 7 { return weekday(day) }
        return short(day)
    }

    /// Looking back: "today", "yesterday", "N days ago", then weeks, months, years.
    static func relative(_ day: String, today: String) -> String {
        let ago = days(from: day, to: today)
        if ago <= 0 { return "today" }
        if ago == 1 { return "yesterday" }
        if ago < 14 { return "\(ago) days ago" }
        if ago < 60 { return "\(Int((Double(ago) / 7).rounded())) weeks ago" }
        if ago < 730 { return "\(Int((Double(ago) / 30).rounded())) months ago" }
        return "\(Int((Double(ago) / 365).rounded())) years ago"
    }
}

/// Which workout a day is about: one already opened, or one still only on the
/// calendar.
enum FocusItem: Equatable {
    case session(SessionSummary)
    case event(WorkoutEvent)

    var id: UUID {
        switch self {
        case .session(let session): session.id
        case .event(let event): event.id
        }
    }

    var date: String {
        switch self {
        case .session(let session): session.date
        case .event(let event): event.date
        }
    }

    var title: String {
        switch self {
        case .session(let session): session.title
        case .event(let event): event.title
        }
    }
}

struct TodayWorkout: Equatable {
    /// Today's workout: an opened session in any state, or an unopened event.
    var today: FocusItem?
    var todayCompleted = false
    /// The soonest workout after today.
    var next: FocusItem?
}

/// A run of consecutive blocks that are parts of one named workout.
struct WodGroup: Identifiable, Equatable {
    var id: String
    var label: String?
    var blocks: [Block]
}

struct SummaryStat: Equatable {
    var value: String
    var label: String
}

struct SummaryLine: Equatable {
    var name: String
    var detail: String
    var e1rm: Double?
}

enum WorkoutRules {
    // MARK: Numbers

    /// A number as the website prints it: whole when it is, else to a tenth.
    static func trim(_ value: Double) -> String {
        let tenth = (value * 10).rounded() / 10
        return tenth == tenth.rounded() ? String(Int(tenth)) : String(tenth)
    }

    /// Seconds as m:ss, or h:mm:ss past an hour.
    static func duration(_ seconds: Int?) -> String {
        guard let seconds, seconds >= 0 else { return "—" }
        let hours = seconds / 3600, minutes = (seconds % 3600) / 60, rest = seconds % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, rest)
            : String(format: "%d:%02d", minutes, rest)
    }

    /// A set as a compact string: "55 lb × 9", "400 m", "0:30".
    static func setMetric(_ type: MetricType, _ metrics: SetMetrics) -> String {
        let load = metrics.load.flatMap { $0 != 0 ? $0 : nil }
        let reps = metrics.reps.flatMap { $0 != 0 ? $0 : nil }
        switch type {
        case .loadReps:
            if let load, let reps { return "\(trim(load)) \(metrics.unit ?? "lb") × \(reps)" }
            if let load { return "\(trim(load)) \(metrics.unit ?? "lb")" }
            if let reps { return "× \(reps)" }
            return "—"
        case .distance:
            return metrics.distance.map { "\(trim($0)) m" } ?? "—"
        case .duration:
            return duration(metrics.duration)
        case .calories:
            return metrics.calories.map { "\($0) cal" } ?? "—"
        case .reps:
            return metrics.reps.map { "× \($0)" } ?? "—"
        }
    }

    static func score(_ type: ScoreType, _ score: Score) -> String? {
        switch type {
        case .time:
            return score.seconds.map { duration($0) }
        case .roundsReps:
            if score.rounds == nil && score.reps == nil { return nil }
            let extra = (score.reps ?? 0) != 0 ? " + \(score.reps ?? 0)" : ""
            return "\(score.rounds ?? 0) rounds\(extra)"
        case .reps:
            return score.reps.map { "\($0) reps" }
        case .load:
            return score.load.map { "\(trim($0)) lb" }
        case .distance:
            return score.distance.map { "\(trim($0)) m" }
        case .calories:
            return score.calories.map { "\($0) cal" }
        case .none:
            return nil
        }
    }

    static func label(_ type: BlockType) -> String {
        switch type {
        case .warmup: "Warm-up"
        case .strength: "Strength"
        case .metcon: "WOD"
        case .accessory: "Accessory"
        case .cooldown: "Cool-down"
        case .skill: "Skill"
        }
    }

    static func label(_ type: ScoreType) -> String {
        switch type {
        case .time: "For time"
        case .roundsReps: "AMRAP"
        case .reps: "Total reps"
        case .load: "Max load"
        case .distance: "Distance"
        case .calories: "Calories"
        case .none: "Unscored"
        }
    }

    static func familyLabel(_ family: String) -> String {
        switch family {
        case "monostructural": "Cardio"
        default: family.prefix(1).uppercased() + family.dropFirst()
        }
    }

    // MARK: Estimated 1RM

    static let looseRepThreshold = 12
    private static let kgToLb = 2.2046226218

    private static func round1(_ value: Double) -> Double { (value * 10).rounded() / 10 }

    /// Epley: load × (1 + reps/30); a single is its own load.
    static func epleyE1rm(load: Double, reps: Int) -> Double {
        if load <= 0 || reps <= 0 { return 0 }
        if reps == 1 { return round1(load) }
        return round1(load * (1 + Double(reps) / 30))
    }

    /// The load that yields `e1rm` at `reps` reps.
    static func inverseEpleyLoad(e1rm: Double, reps: Int) -> Double {
        if e1rm <= 0 || reps <= 0 { return 0 }
        if reps == 1 { return round1(e1rm) }
        return round1(e1rm / (1 + Double(reps) / 30))
    }

    /// Past 12 reps the estimate is too loose to chart.
    static func isLooseReps(_ reps: Int) -> Bool { reps > looseRepThreshold }

    /// A logged set's estimated 1RM in pounds, or nil when it isn't a
    /// meaningful strength estimate.
    static func setE1rm(load: Double?, reps: Int?, unit: String?, isLoadedMovement: Bool) -> (e1rm: Double, isLoose: Bool)? {
        guard isLoadedMovement, let load, load > 0, let reps, reps > 0 else { return nil }
        let e1rm = epleyE1rm(load: unit == "kg" ? load * kgToLb : load, reps: reps)
        guard e1rm > 0 else { return nil }
        return (e1rm, isLooseReps(reps))
    }

    static func suggestedLoad(bestE1rm: Double, reps: Int) -> Double {
        guard bestE1rm > 0, reps > 0 else { return 0 }
        return inverseEpleyLoad(e1rm: bestE1rm, reps: reps)
    }

    static func percentOfE1rm(load: Double, bestE1rm: Double) -> Int? {
        guard bestE1rm > 0, load > 0 else { return nil }
        return Int((load / bestE1rm * 100).rounded())
    }

    /// A known lift's estimate carried to a family-mate by a ratio range.
    static func siblingEstimate(fromE1rm: Double, low: Double, high: Double) -> (low: Double, high: Double) {
        (round1(fromE1rm * low), round1(fromE1rm * high))
    }

    // MARK: Parts of one workout

    private static let partPattern = try! NSRegularExpression(
        pattern: #"^(.+?)\s*[–—:-]?\s*\(?\b(Part\s+[\dA-Za-z]+|[A-D])\)?\s*$"#,
        options: [.caseInsensitive]
    )

    /// "Steak and Pudding: Part 1" → ("Steak and Pudding", "Part 1"). Nil
    /// when the title isn't a "… Part N" form.
    static func wodTitle(_ title: String?) -> (base: String, part: String)? {
        guard let title, !title.isEmpty,
              let match = partPattern.firstMatch(in: title, range: NSRange(title.startIndex..., in: title)),
              let baseRange = Range(match.range(at: 1), in: title),
              let partRange = Range(match.range(at: 2), in: title)
        else { return nil }
        let base = title[baseRange].trimmingCharacters(in: .whitespaces)
        guard base.count >= 3 else { return nil }
        return (base, title[partRange].trimmingCharacters(in: .whitespaces))
    }

    /// Blocks in order, with the parts of a multi-part workout run together.
    static func groups(_ blocks: [Block]) -> [WodGroup] {
        var groups: [WodGroup] = []
        for block in blocks {
            let key = block.groupLabel.flatMap { $0.isEmpty ? nil : $0 } ?? wodTitle(block.title)?.base
            if let key, let last = groups.indices.last, groups[last].id == key {
                groups[last].blocks.append(block)
            } else {
                groups.append(WodGroup(id: key ?? "solo:\(block.id.uuidString)", label: key, blocks: [block]))
            }
        }
        return groups
    }

    /// What one part of a grouped workout is called.
    static func partLabel(_ block: Block) -> String {
        if let group = block.groupLabel, !group.isEmpty { return block.title ?? label(block.blockType) }
        return wodTitle(block.title)?.part ?? block.title ?? label(block.blockType)
    }

    /// A metcon movement's line of the recipe: what was done, with the Rx
    /// kept in view when they differ.
    static func metconLine(_ entry: Entry) -> String {
        entry.sets.map { set in
            let actual = setMetric(set.metricType, set.actual)
            let rx = setMetric(set.metricType, set.prescribed)
            if actual == "—" { return rx }
            return actual == rx ? actual : "\(actual) (written \(rx))"
        }
        .filter { $0 != "—" }
        .joined(separator: " · ")
    }

    // MARK: Which workout is today's

    /// Today's workout and the next one. An opened session wins over an
    /// unopened event on the same day; among the day's sessions, one still
    /// open, then the newest.
    static func focus(sessions: [SessionSummary], events: [WorkoutEvent], today: String) -> TodayWorkout {
        let linked = Set(sessions.compactMap(\.calendarEventID))
        let upcoming = sessions
            .filter { $0.date >= today }
            .sorted { $0.date != $1.date ? $0.date < $1.date : $0.createdAt > $1.createdAt }
        let unopened = events.filter { !linked.contains($0.id) && $0.date >= today }

        let todays = upcoming.filter { $0.date == today }
        let session = todays.first { !$0.completed } ?? todays.first
        let item = session.map(FocusItem.session) ?? unopened.first { $0.date == today }.map(FocusItem.event)

        let later = upcoming.filter { $0.date > today }.map(FocusItem.session)
            + unopened.filter { $0.date > today }.map(FocusItem.event)
        let next = later.enumerated()
            .sorted { $0.element.date != $1.element.date ? $0.element.date < $1.element.date : $0.offset < $1.offset }
            .first?.element

        return TodayWorkout(today: item, todayCompleted: session?.completed ?? false, next: next)
    }

    /// To do, from today on: workouts on the calendar not yet opened, and
    /// opened ones not yet done, soonest first. (The website keeps unfinished
    /// ones from before today here too; the app files those under history.)
    static func todo(sessions: [SessionSummary], events: [WorkoutEvent], today: String) -> [FocusItem] {
        let linked = Set(sessions.compactMap(\.calendarEventID))
        let rows = events.filter { !linked.contains($0.id) && $0.date >= today }.map(FocusItem.event)
            + sessions.filter { !$0.completed && $0.date >= today }.map(FocusItem.session)
        return rows.enumerated()
            .sorted { $0.element.date != $1.element.date ? $0.element.date < $1.element.date : $0.offset < $1.offset }
            .map(\.element)
    }

    /// What's behind: workouts done, and ones from before today that were
    /// opened and never marked done (still there to finish logging), most
    /// recent first.
    static func history(sessions: [SessionSummary], today: String) -> [SessionSummary] {
        sessions.filter { $0.completed || $0.date < today }
            .sorted { $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt }
    }

    /// Workouts in the last 7 and 30 days, each beside the window before it.
    static func trend(dates: [String], today: String) -> WorkoutTrend {
        let d7 = WorkoutDay.daysAgo(today, 7), d14 = WorkoutDay.daysAgo(today, 14)
        let d30 = WorkoutDay.daysAgo(today, 30), d60 = WorkoutDay.daysAgo(today, 60)
        var trend = WorkoutTrend()
        for date in dates where date <= today {
            if date > d7 { trend.last7 += 1 } else if date > d14 { trend.prev7 += 1 }
            if date > d30 { trend.last30 += 1 } else if date > d60 { trend.prev30 += 1 }
        }
        return trend
    }

    // MARK: The completed recap

    private static func recapLabel(_ set: WorkoutSet) -> String {
        if set.metricType == .reps { return set.actual.reps.map { "\($0) reps" } ?? "—" }
        return setMetric(set.metricType, set.actual)
    }

    /// An entry's logged sets as one line, with its best strict e1RM.
    static func summarize(_ entry: Entry) -> SummaryLine {
        let sets = entry.sets
        guard let first = sets.first else { return SummaryLine(name: entry.name, detail: "", e1rm: nil) }
        let list = sets.map(recapLabel).filter { $0 != "—" }.joined(separator: ", ")
        if entry.isMetcon { return SummaryLine(name: entry.name, detail: list, e1rm: nil) }

        let e1rm = sets.filter { !$0.e1rmIsLoose }.compactMap(\.e1rm).max()
        let uniform = sets.allSatisfy {
            $0.metricType == first.metricType && $0.actual.reps == first.actual.reps && $0.actual.load == first.actual.load
        }
        guard uniform else { return SummaryLine(name: entry.name, detail: list, e1rm: e1rm) }
        let label = recapLabel(first)
        if label == "—" { return SummaryLine(name: entry.name, detail: "", e1rm: e1rm) }
        return SummaryLine(name: entry.name, detail: sets.count > 1 ? "\(sets.count) × \(label)" : label, e1rm: e1rm)
    }

    /// The few numbers that matter for a finished session.
    static func stats(_ session: SessionDetail) -> [SummaryStat] {
        let entries = session.entries
        let setCount = entries.reduce(0) { $0 + $1.sets.count }
        var volume = 0.0
        var top: (name: String, value: Double)?
        for entry in entries {
            for set in entry.sets {
                if set.metricType == .loadReps, let load = set.actual.load, let reps = set.actual.reps {
                    volume += load * Double(reps)
                }
                if let e1rm = set.e1rm, !set.e1rmIsLoose, e1rm > (top?.value ?? -.infinity) {
                    top = (entry.name, e1rm)
                }
            }
        }
        var stats = [SummaryStat(value: "\(setCount)", label: setCount == 1 ? "set" : "sets")]
        if volume > 0 {
            stats.append(SummaryStat(value: Int(volume.rounded()).formatted(.number.locale(Locale(identifier: "en_US"))), label: "lb volume"))
        }
        if let top { stats.append(SummaryStat(value: trim(top.value), label: "\(top.name) e1RM")) }
        return stats
    }

    // MARK: Progress

    /// Strength by movement family: each lift's best estimated 1RM against its
    /// best from more than 90 days ago, with the family's reps and volume.
    static func familyProgress(_ sets: [ProgressSet], today: String) -> [FamilyProgress] {
        let cutoff = WorkoutDay.daysAgo(today, 90)
        struct Lift { var stat: LiftStat; var prior: [Double] = [] }
        struct Family { var order: Int; var reps = 0; var volume = 0.0; var lastDate: String?; var lifts: [UUID: Lift] = [:]; var liftOrder: [UUID] = [] }
        var families: [String: Family] = [:]

        for set in sets {
            var family = families[set.family] ?? Family(order: families.count)
            let reps = set.reps ?? 0
            family.reps += reps
            family.volume += (set.load ?? 0) * Double(reps)
            if family.lastDate.map({ set.date > $0 }) ?? true { family.lastDate = set.date }

            if set.isLoaded, set.context == .strength, !set.e1rmIsLoose, let e1rm = set.e1rm {
                var lift = family.lifts[set.movementID]
                    ?? Lift(stat: LiftStat(id: set.movementID, name: set.name, bestE1rm: 0, priorE1rm: nil, lastDate: set.date))
                if family.lifts[set.movementID] == nil { family.liftOrder.append(set.movementID) }
                if e1rm > lift.stat.bestE1rm {
                    lift.stat.bestE1rm = e1rm
                    lift.stat.lastDate = set.date
                } else if set.date > lift.stat.lastDate {
                    lift.stat.lastDate = set.date
                }
                if set.date < cutoff { lift.prior.append(e1rm) }
                family.lifts[set.movementID] = lift
            }
            families[set.family] = family
        }

        // Families with strength data first, then by recency.
        let ordered = families.sorted { a, b in
            if a.value.lifts.count != b.value.lifts.count { return a.value.lifts.count > b.value.lifts.count }
            let aLast = a.value.lastDate ?? "", bLast = b.value.lastDate ?? ""
            if aLast != bLast { return aLast > bLast }
            return a.value.order < b.value.order
        }
        var result: [FamilyProgress] = []
        for (name, family) in ordered {
            var lifts: [LiftStat] = []
            for id in family.liftOrder {
                guard let lift = family.lifts[id] else { continue }
                var stat = lift.stat
                stat.priorE1rm = lift.prior.max()
                lifts.append(stat)
            }
            // Strongest first; ties stay in the order they were first seen.
            let ranked = lifts.enumerated().sorted { a, b in
                a.element.bestE1rm != b.element.bestE1rm ? a.element.bestE1rm > b.element.bestE1rm : a.offset < b.offset
            }
            result.append(FamilyProgress(
                family: name, label: familyLabel(name), lifts: ranked.map(\.element),
                totalReps: family.reps, totalVolumeLoad: Int(family.volume.rounded()), lastDate: family.lastDate
            ))
        }
        return result
    }

    /// A score as one comparable number; lower is better only for time.
    private static func scoreValue(_ type: ScoreType, _ score: Score) -> Double? {
        switch type {
        case .time: score.seconds.map(Double.init)
        case .roundsReps:
            score.rounds != nil || score.reps != nil ? Double((score.rounds ?? 0) * 1000 + (score.reps ?? 0)) : nil
        case .reps: score.reps.map(Double.init)
        case .load: score.load
        case .distance: score.distance
        case .calories: score.calories.map(Double.init)
        case .none: nil
        }
    }

    /// Each benchmark's best result, most recently attempted first.
    static func benchmarkPRs(_ rows: [BenchmarkRow]) -> [BenchmarkPR] {
        struct Running {
            var pr: BenchmarkPR
            var best: Double?
            var order: Int
        }
        var byID: [UUID: Running] = [:]
        for row in rows {
            var current = byID[row.benchmarkID] ?? Running(
                pr: BenchmarkPR(
                    id: row.benchmarkID, name: row.name, scoreType: row.scoreType, attempts: 0,
                    best: Score(), bestRxLevel: nil, lastDate: row.date
                ),
                best: nil, order: byID.count
            )
            current.pr.attempts += 1
            if row.date > current.pr.lastDate { current.pr.lastDate = row.date }
            if let value = scoreValue(row.scoreType, row.score) {
                let better: Bool
                if let best = current.best {
                    better = row.scoreType == .time ? value < best : value > best
                } else {
                    better = true
                }
                if better {
                    current.best = value
                    current.pr.best = row.score
                    current.pr.bestRxLevel = row.rxLevel
                }
            }
            byID[row.benchmarkID] = current
        }
        let ordered = byID.values.sorted { a, b in
            a.pr.lastDate != b.pr.lastDate ? a.pr.lastDate > b.pr.lastDate : a.order < b.order
        }
        return ordered.map(\.pr)
    }
}
