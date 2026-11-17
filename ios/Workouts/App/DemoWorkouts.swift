import Foundation

/// A made-up training block for `--demo` (the simulator, with no sign-in): a
/// strength piece and a benchmark to log today, a few workouts still on the
/// calendar, a couple of months of history and the bests that go with it.
enum DemoWorkouts {
    struct World {
        var today: String
        var sessions: [SessionSummary]
        var events: [WorkoutEvent]
        var details: [UUID: SessionDetail]
        var insights: [UUID: SessionInsights]
        var families: [FamilyProgress]
        var benchmarks: [BenchmarkPR]
        /// What each calendar workout becomes when it's opened.
        var unopened: [UUID: SessionDetail]
    }

    // MARK: Building blocks

    private static func loaded(_ count: Int, load: Double, reps: Int, context: SetContext = .strength, estimate: Bool = true) -> [WorkoutSet] {
        (0..<count).map { position in
            let metrics = SetMetrics(reps: reps, load: load, unit: "lb")
            let e1rm = estimate && context != .metcon ? WorkoutRules.setE1rm(load: load, reps: reps, unit: "lb", isLoadedMovement: true) : nil
            return WorkoutSet(
                id: UUID(), position: position, metricType: .loadReps, context: context, rxLevel: nil,
                prescribed: metrics, actual: metrics, e1rm: e1rm?.e1rm, e1rmIsLoose: e1rm?.isLoose ?? false
            )
        }
    }

    private static func plain(_ type: MetricType, _ metrics: [SetMetrics], context: SetContext) -> [WorkoutSet] {
        metrics.enumerated().map { position, metrics in
            WorkoutSet(
                id: UUID(), position: position, metricType: type, context: context, rxLevel: nil,
                prescribed: metrics, actual: metrics, e1rm: nil, e1rmIsLoose: false
            )
        }
    }

    private static func reps(_ counts: [Int], context: SetContext) -> [WorkoutSet] {
        plain(.reps, counts.map { SetMetrics(reps: $0) }, context: context)
    }

    private static func entry(_ name: String, family: String, loaded: Bool = false, _ sets: [WorkoutSet]) -> Entry {
        Entry(id: UUID(), position: 0, rawName: name, movementID: UUID(), canonicalName: name, family: family, isLoaded: loaded, sets: sets)
    }

    private static func block(
        _ type: BlockType, _ title: String?, group: String? = nil, scored: ScoreType = .none, score: Score = Score(),
        benchmark: String? = nil, _ entries: [Entry]
    ) -> Block {
        Block(
            id: UUID(), position: 0, blockType: type, title: title, groupLabel: group, scoreType: scored, score: score,
            rxLevel: benchmark == nil ? nil : .rx, benchmarkID: benchmark.map { _ in UUID() }, benchmarkName: benchmark,
            entries: entries.enumerated().map { position, entry in
                var entry = entry
                entry.position = position
                return entry
            }
        )
    }

    private static func session(
        _ title: String, date: String, source: String = "calendar", event: UUID? = nil, completed: Bool = false,
        raw: String? = nil, notes: String? = nil, effort: String? = nil, energy: String? = nil, _ blocks: [Block]
    ) -> SessionDetail {
        SessionDetail(
            id: UUID(), sessionDate: date, title: title, source: source, calendarEventID: event, rawDescription: raw,
            notes: notes, effort: effort, energy: energy, parsed: true, completed: completed, whoopSyncStatus: nil,
            blocks: blocks.enumerated().map { position, block in
                var block = block
                block.position = position
                return block
            }
        )
    }

    private static func summary(_ detail: SessionDetail, createdAt: String = "2026-01-01T12:00:00Z") -> SessionSummary {
        SessionSummary(
            id: detail.id, date: detail.sessionDate, title: detail.title ?? "Workout", blockCount: detail.blocks.count,
            completed: detail.completed, calendarEventID: detail.calendarEventID, createdAt: createdAt
        )
    }

    // MARK: The block

    static func make(today: String = WorkoutDay.today(), todayDone: Bool = false) -> World {
        func ago(_ days: Int) -> String { WorkoutDay.daysAgo(today, days) }
        func ahead(_ days: Int) -> String { WorkoutDay.daysAgo(today, -days) }

        var details: [UUID: SessionDetail] = [:]
        var insights: [UUID: SessionInsights] = [:]
        var sessions: [SessionSummary] = []

        // Today: heavy fives, then Fran.
        let squat = entry("Back Squat", family: "squat", loaded: true, loaded(5, load: 225, reps: 5))
        let thruster = entry("Thruster", family: "squat", loaded: true, [
            loaded(1, load: 95, reps: 21, context: .metcon), loaded(1, load: 95, reps: 15, context: .metcon),
            loaded(1, load: 95, reps: 9, context: .metcon),
        ].flatMap { $0 }.enumerated().map { position, set in
            var set = set
            set.position = position
            return set
        })
        let pullUp = entry("Pull-Up", family: "pull", reps([21, 15, 9], context: .metcon))
        let press = entry("Strict Press", family: "press", loaded: true, loaded(3, load: 95, reps: 8, context: .accessory))
        let toes = entry("Toes-to-Bar", family: "core", reps([12, 12, 12], context: .accessory))
        let fran = block(
            .metcon, "Fran", scored: .time, score: todayDone ? Score(seconds: 401) : Score(), benchmark: "Fran", [thruster, pullUp]
        )
        let todays = session(
            "Heavy Fives + Fran", date: today, event: UUID(), completed: todayDone,
            raw: """
                A) Back Squat 5x5 @ 225

                B) "Fran"
                21-15-9 for time:
                Thrusters (95/65)
                Pull-ups

                C) Accessory, 3 rounds, not for time:
                8 Strict Press @ 95
                12 Toes-to-Bar
                """,
            notes: todayDone ? "Squats moved well. Broke the thrusters 12-9 in the first round, then held on." : nil,
            effort: todayDone ? "harder" : nil, energy: todayDone ? "high" : nil,
            [
                block(.strength, "Back Squat 5×5", [squat]),
                fran,
                block(.accessory, nil, [press, toes]),
            ]
        )
        details[todays.id] = todays
        sessions.append(summary(todays, createdAt: "2026-06-01T12:00:00Z"))
        insights[todays.id] = SessionInsights(
            history: [
                squat.id: MovementHistory(bestE1rmStrict: 285.8, recent: [
                    HistorySet(date: ago(4), load: 235, reps: 5, unit: "lb", e1rm: 274.2, e1rmIsLoose: false),
                    HistorySet(date: ago(11), load: 245, reps: 5, unit: "lb", e1rm: 285.8, e1rmIsLoose: false),
                    HistorySet(date: ago(18), load: 225, reps: 5, unit: "lb", e1rm: 262.5, e1rmIsLoose: false),
                    HistorySet(date: ago(25), load: 255, reps: 2, unit: "lb", e1rm: 272, e1rmIsLoose: false),
                ]),
                press.id: MovementHistory(bestE1rmStrict: nil, recent: []),
            ],
            hints: [press.id: SiblingHint(fromName: "Push Press", low: 130.7, high: 149.4)],
            attempts: [fran.id: [
                BenchmarkAttempt(date: ago(118), scoreType: .time, score: Score(seconds: 418), rxLevel: .rx),
                BenchmarkAttempt(date: ago(301), scoreType: .time, score: Score(seconds: 462), rxLevel: .rx),
                BenchmarkAttempt(date: ago(520), scoreType: .time, score: Score(seconds: 555), rxLevel: .scaled),
            ]],
            substitutes: [toes.id: Substitute(id: UUID(), name: "Hanging Knee Raise")]
        )

        // Opened two days ago and never closed.
        let skills = session("Gymnastics Skill Day", date: ago(2), event: UUID(), [
            block(.skill, "Handstand Work", [
                entry("Handstand Hold", family: "gymnastics", plain(.duration, Array(repeating: SetMetrics(duration: 30), count: 3), context: .strength)),
            ]),
            block(.metcon, "Every minute for 12", scored: .reps, [
                entry("Burpee", family: "gymnastics", reps([10], context: .metcon)),
                entry("Double-Under", family: "monostructural", reps([30], context: .metcon)),
            ]),
        ])
        details[skills.id] = skills
        sessions.append(summary(skills))

        // Still on the calendar.
        var events: [WorkoutEvent] = []
        var unopened: [UUID: SessionDetail] = [:]
        func schedule(_ title: String, in days: Int, _ blocks: [Block]) {
            let event = WorkoutEvent(id: UUID(), title: title, date: ahead(days))
            events.append(event)
            unopened[event.id] = session(title, date: event.date, event: event.id, blocks)
        }
        schedule("Steak and Pudding", in: 1, [
            block(.metcon, "Part 1", group: "Steak and Pudding", scored: .calories, [
                entry("Assault Bike", family: "monostructural", plain(.duration, [SetMetrics(duration: 600)], context: .metcon)),
            ]),
            block(.metcon, "Part 2", group: "Steak and Pudding", scored: .roundsReps, [
                entry("Pull-Up", family: "pull", reps([5], context: .metcon)),
                entry("Push-Up", family: "press", reps([10], context: .metcon)),
                entry("Air Squat", family: "squat", reps([15], context: .metcon)),
            ]),
        ])
        schedule("Deadlift + Row Intervals", in: 3, [
            block(.strength, "Deadlift 5×3", [entry("Deadlift", family: "hinge", loaded: true, loaded(5, load: 315, reps: 3))]),
            block(.metcon, "4 × 500 m, rest 2:00", scored: .time, [
                entry("Row", family: "monostructural", plain(.distance, Array(repeating: SetMetrics(distance: 500), count: 4), context: .metcon)),
            ]),
        ])
        schedule("Snatch Technique", in: 4, [
            block(.skill, "Power Snatch", [entry("Power Snatch", family: "snatch", loaded: true, loaded(6, load: 115, reps: 2))]),
            block(.metcon, "Grace", scored: .time, benchmark: "Grace", [
                entry("Clean and Jerk", family: "clean", loaded: true, loaded(1, load: 135, reps: 30, context: .metcon)),
            ]),
        ])
        schedule("Partner Chipper", in: 6, [
            block(.metcon, nil, scored: .time, [
                entry("Wall Ball", family: "squat", loaded: true, loaded(1, load: 20, reps: 100, context: .metcon)),
                entry("Kettlebell Swing", family: "hinge", loaded: true, loaded(1, load: 53, reps: 80, context: .metcon)),
                entry("Box Jump", family: "gymnastics", reps([60], context: .metcon)),
                entry("Run", family: "monostructural", plain(.distance, [SetMetrics(distance: 800)], context: .metcon)),
            ]),
        ])

        // Done and closed.
        let past: [(String, Int)] = [
            ("Deadlift + Helen", 1), ("Clean Complex", 3), ("Front Squat + Sprints", 5), ("Push Press + Grace", 6),
            ("Cindy", 8), ("Long Row", 9), ("Bench + Burpees", 10), ("Snatch Technique", 12), ("Back Squat + Annie", 13),
            ("Murph Prep", 15), ("Deadlift + Row Intervals", 16), ("Partner Chipper", 17), ("Overhead Squat", 19),
            ("Clean and Jerk Ladder", 20), ("Front Squat + Karen", 22), ("Gymnastics Skill Day", 24), ("Push Press", 26),
            ("Helen", 27), ("Back Squat 3×8", 29), ("Deadlift Singles", 31), ("Open 24.1", 32), ("Bench Press", 34),
            ("Front Squat", 36), ("Jackie", 37), ("Power Clean", 39), ("Long Run", 41), ("Snatch Balance", 43),
            ("Back Squat 5×5", 44), ("Diane", 46), ("Push Jerk", 48), ("Deadlift 5×5", 50), ("Fight Gone Bad", 51),
            ("Front Squat + Row", 53), ("Strict Press", 55), ("Cindy", 57), ("Clean Pulls", 58),
        ]
        let lifts: [(String, String, Double)] = [
            ("Deadlift", "hinge", 315), ("Power Clean", "clean", 165), ("Front Squat", "squat", 195), ("Push Press", "press", 155),
        ]
        for (index, (title, days)) in past.enumerated() {
            let lift = lifts[index % lifts.count]
            let time = 420 + (index * 97) % 540
            let done = session(title, date: ago(days), event: UUID(), completed: true, energy: index % 7 == 3 ? "low" : nil, [
                block(.strength, "\(lift.0) 5×3", [
                    entry(lift.0, family: lift.1, loaded: true, loaded(5, load: lift.2 + Double(index % 3) * 10, reps: 3)),
                ]),
                block(.metcon, nil, scored: .time, score: Score(seconds: time), [
                    entry("Run", family: "monostructural", plain(.distance, [SetMetrics(distance: 400)], context: .metcon)),
                    entry("Kettlebell Swing", family: "hinge", loaded: true, loaded(1, load: 53, reps: 21, context: .metcon)),
                    entry("Pull-Up", family: "pull", reps([12], context: .metcon)),
                ]),
            ])
            details[done.id] = done
            sessions.append(summary(done))
        }

        func lift(_ name: String, _ best: Double, prior: Double?, last: Int) -> LiftStat {
            LiftStat(id: UUID(), name: name, bestE1rm: best, priorE1rm: prior, lastDate: ago(last))
        }
        let families = [
            FamilyProgress(family: "squat", label: "Squat", lifts: [
                lift("Back Squat", 285.8, prior: 275, last: 4), lift("Front Squat", 240, prior: 240, last: 5),
                lift("Overhead Squat", 185, prior: nil, last: 19),
            ], totalReps: 1_240, totalVolumeLoad: 212_400, lastDate: ago(4)),
            FamilyProgress(family: "hinge", label: "Hinge", lifts: [
                lift("Deadlift", 372.5, prior: 355, last: 1), lift("Romanian Deadlift", 265, prior: nil, last: 23),
            ], totalReps: 980, totalVolumeLoad: 241_750, lastDate: ago(1)),
            FamilyProgress(family: "press", label: "Press", lifts: [
                lift("Bench Press", 225, prior: 220, last: 10), lift("Push Press", 186.7, prior: 190, last: 6),
            ], totalReps: 1_105, totalVolumeLoad: 118_300, lastDate: ago(6)),
            FamilyProgress(family: "clean", label: "Clean", lifts: [
                lift("Squat Clean", 230, prior: 230, last: 20), lift("Power Clean", 215, prior: 205, last: 3),
            ], totalReps: 612, totalVolumeLoad: 86_900, lastDate: ago(3)),
            FamilyProgress(family: "snatch", label: "Snatch", lifts: [
                lift("Power Snatch", 150, prior: nil, last: 12),
            ], totalReps: 204, totalVolumeLoad: 22_150, lastDate: ago(12)),
        ]
        let benchmarks = [
            BenchmarkPR(id: UUID(), name: "Fran", scoreType: .time, attempts: todayDone ? 4 : 3, best: Score(seconds: todayDone ? 401 : 418), bestRxLevel: .rx, lastDate: todayDone ? today : ago(118)),
            BenchmarkPR(id: UUID(), name: "Grace", scoreType: .time, attempts: 2, best: Score(seconds: 221), bestRxLevel: .rx, lastDate: ago(6)),
            BenchmarkPR(id: UUID(), name: "Cindy", scoreType: .roundsReps, attempts: 3, best: Score(rounds: 17, reps: 8), bestRxLevel: .rx, lastDate: ago(8)),
            BenchmarkPR(id: UUID(), name: "Helen", scoreType: .time, attempts: 2, best: Score(seconds: 552), bestRxLevel: .scaled, lastDate: ago(27)),
            BenchmarkPR(id: UUID(), name: "Murph", scoreType: .time, attempts: 1, best: Score(seconds: 2850), bestRxLevel: .rx, lastDate: ago(172)),
        ]

        return World(
            today: today, sessions: sessions, events: events, details: details, insights: insights,
            families: families, benchmarks: benchmarks, unopened: unopened
        )
    }
}
