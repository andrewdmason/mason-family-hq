import Foundation
import MasonKit
import Observation
import Supabase

/// The member's workouts: what's on the calendar, what's been opened and
/// logged, and the comparisons the gym view leans on. Reads come straight from
/// Supabase under the member's sign-in (the website's queries in
/// src/lib/workouts/queries.ts); edits go through `WorkoutWrites`. Only opening
/// a calendar workout needs the website, which holds the model key that
/// structures it — so the workouts coming up are sent ahead to be structured
/// in the background, and the tap that opens one has little left to wait for.
@MainActor
@Observable
final class WorkoutStore {
    /// Every session, opened or done.
    private(set) var sessions: [SessionSummary] = []
    /// Workouts on the calendar from 12 hours back to 60 days out.
    private(set) var events: [WorkoutEvent] = []
    private(set) var details: [UUID: SessionDetail] = [:]
    private(set) var insights: [UUID: SessionInsights] = [:]
    private(set) var families: [FamilyProgress]?
    private(set) var benchmarks: [BenchmarkPR]?
    private(set) var today = WorkoutDay.today()
    private(set) var loaded = false
    private(set) var loadError: String?
    /// Calendar workouts being opened (and structured) right now.
    private(set) var opening: Set<UUID> = []
    /// Calendar workouts that wouldn't open when tapped.
    private(set) var failedOpens: Set<UUID> = []
    /// Sessions that turned out not to exist any more.
    private(set) var missing: Set<UUID> = []
    /// Canned workouts with no sign-in or network: `--demo`, for the simulator.
    let isDemo: Bool

    private let writes: WorkoutWrites
    private let defaults: UserDefaults
    private var memberEmail: String?
    /// Calendar workouts sent ahead to be structured this run, and the ones
    /// on their way there now.
    private var prepared: Set<UUID> = []
    private var preparing: [UUID: Task<Void, Never>] = [:]
    private var preparation: Task<Void, Never>?
    /// In the demo, what each calendar workout becomes when it's opened.
    private var demoUnopened: [UUID: SessionDetail] = [:]
    private var db: SupabaseClient { Session.shared.client }

    static var isDemoLaunch: Bool { CommandLine.arguments.contains("--demo") }

    init(writes: WorkoutWrites? = nil, defaults: UserDefaults = .standard) {
        self.writes = writes ?? .shared
        self.defaults = defaults
        isDemo = false
        restore()
    }

    /// `--demo`: a made-up training block. `--demo-done` starts with today's
    /// workout already marked done.
    init(demo: DemoWorkouts.World) {
        writes = WorkoutWrites(defaults: UserDefaults(suiteName: "workouts.demo") ?? .standard)
        defaults = .standard
        isDemo = true
        sessions = demo.sessions
        events = demo.events
        details = demo.details
        insights = demo.insights
        families = demo.families
        benchmarks = demo.benchmarks
        today = demo.today
        demoUnopened = demo.unopened
        loaded = true
    }

    // MARK: What's on

    var focus: TodayWorkout { WorkoutRules.focus(sessions: sessions, events: events, today: today) }

    /// Upcoming shows three weeks of the calendar, as the website does.
    var todo: [FocusItem] {
        let horizon = WorkoutDay.daysAgo(today, -21)
        return WorkoutRules.todo(sessions: sessions, events: events.filter { $0.date <= horizon }, today: today)
    }

    var history: [SessionSummary] { WorkoutRules.history(sessions: sessions, today: today) }

    var trend: WorkoutTrend { WorkoutRules.trend(dates: sessions.map(\.date), today: today) }

    // MARK: Loading

    func load() async {
        today = WorkoutDay.today()
        guard !isDemo else { return }
        await writes.flush()
        do {
            async let sessionsQuery = fetchSessions()
            async let eventsQuery = fetchEvents()
            var (fetched, calendar) = try await (sessionsQuery, eventsQuery)
            writes.apply(to: &fetched)
            sessions = fetched
            events = calendar
            loadError = nil
            save()
        } catch {
            loadError = "Couldn't load your workouts. Pull to try again."
        }
        loaded = true
        await prepareToday()
        prepareUpcoming()
    }

    /// Today's workout, a tap from logging: one already opened is loaded.
    /// One still only on the calendar is not opened until it's tapped (a
    /// day skipped then leaves no session behind); it's first in line to be
    /// structured ahead, below.
    private func prepareToday() async {
        if case .session(let session) = focus.today { await loadSession(session.id) }
    }

    /// Have the website structure the calendar workouts coming up, soonest
    /// first and one at a time, so each is quick to open when it's tapped.
    /// Nothing is opened: a workout prepared and then skipped never becomes a
    /// session (an opened one's prescribed loads count toward estimated maxes
    /// whether or not it was done).
    private func prepareUpcoming() {
        guard !isDemo, preparation == nil else { return }
        preparation = Task { [weak self] in
            while let self, let event = self.nextToPrepare() {
                self.prepared.insert(event.id)
                let sending = Task { await self.prepareOnWebsite(event.id) }
                self.preparing[event.id] = Task { _ = await sending.value }
                let reached = await sending.value
                self.preparing[event.id] = nil
                if !reached {
                    // No signal: leave it, and the rest, for the next load.
                    self.prepared.remove(event.id)
                    break
                }
            }
            self?.preparation = nil
        }
    }

    private func nextToPrepare() -> WorkoutEvent? {
        for case .event(let event) in todo where !prepared.contains(event.id) && !opening.contains(event.id) {
            return event
        }
        return nil
    }

    /// Open a calendar workout into a session to log. One that was prepared
    /// opens quickly; otherwise the first open structures it on the website,
    /// which can take a little while.
    @discardableResult
    func open(_ event: WorkoutEvent) async -> UUID? {
        guard !opening.contains(event.id) else { return nil }
        opening.insert(event.id)
        defer { opening.remove(event.id) }
        if isDemo {
            try? await Task.sleep(for: .milliseconds(900))
            guard let detail = demoUnopened[event.id] else { return nil }
            details[detail.id] = detail
            sessions.append(SessionSummary(
                id: detail.id, date: detail.sessionDate, title: detail.title ?? "Workout", blockCount: detail.blocks.count,
                completed: false, calendarEventID: event.id, createdAt: "2026-06-02T12:00:00Z"
            ))
            return detail.id
        }
        // Tapped while it's being prepared: that parse is nearly there, and
        // quicker to wait for than to start again.
        await preparing[event.id]?.value
        prepared.insert(event.id)
        do {
            let id = try await openOnWebsite(event.id)
            failedOpens.remove(event.id)
            if var fetched = try? await fetchSessions() {
                writes.apply(to: &fetched)
                sessions = fetched
            }
            await loadSession(id)
            return id
        } catch {
            failedOpens.insert(event.id)
            return nil
        }
    }

    /// Try structuring a workout again: one from the calendar that came back
    /// unparsed is parsed again by opening its event.
    func restructure(_ session: SessionDetail) async {
        guard let eventID = session.calendarEventID, !opening.contains(eventID) else { return }
        opening.insert(eventID)
        defer { opening.remove(eventID) }
        _ = try? await openOnWebsite(eventID)
        await loadSession(session.id)
    }

    func loadSession(_ id: UUID) async {
        guard !isDemo else { return }
        do {
            guard var detail = try await fetchDetail(id) else {
                details[id] = nil
                missing.insert(id)
                return
            }
            writes.apply(to: &detail)
            details[id] = detail
            missing.remove(id)
            insights[id] = await fetchInsights(for: detail)
            save()
        } catch {
            // No signal: what was last seen stays up.
        }
    }

    func loadProgress() async {
        guard !isDemo else { return }
        do {
            async let setsQuery = fetchProgressSets()
            async let benchmarkQuery = fetchBenchmarkRows()
            let (sets, rows) = try await (setsQuery, benchmarkQuery)
            families = WorkoutRules.familyProgress(sets, today: today)
            benchmarks = WorkoutRules.benchmarkPRs(rows)
            save()
        } catch {
            if families == nil { families = [] }
            if benchmarks == nil { benchmarks = [] }
        }
    }

    // MARK: Logging

    /// Change what was done for a set. Its estimated 1RM follows, as the
    /// website's updateSet works it out.
    func update(set setID: UUID, in sessionID: UUID, _ change: (inout SetMetrics) -> Void) {
        guard var detail = details[sessionID] else { return }
        for b in detail.blocks.indices {
            for e in detail.blocks[b].entries.indices {
                guard let s = detail.blocks[b].entries[e].sets.firstIndex(where: { $0.id == setID }) else { continue }
                var set = detail.blocks[b].entries[e].sets[s]
                let before = set.actual
                change(&set.actual)
                guard set.actual != before else { return }
                let isLoadReps = set.metricType == .loadReps
                if isLoadReps {
                    let estimate = WorkoutRules.setE1rm(
                        load: set.actual.load, reps: set.actual.reps, unit: set.actual.unit,
                        isLoadedMovement: detail.blocks[b].entries[e].isLoaded
                    )
                    set.e1rm = estimate?.e1rm
                    set.e1rmIsLoose = estimate?.isLoose ?? false
                }
                detail.blocks[b].entries[e].sets[s] = set
                details[sessionID] = detail
                send(.set(id: setID, session: sessionID, actual: set.actual, isLoadReps: isLoadReps, e1rm: set.e1rm, e1rmIsLoose: set.e1rmIsLoose))
                return
            }
        }
    }

    func update(score blockID: UUID, in sessionID: UUID, _ change: (inout Score) -> Void) {
        guard var detail = details[sessionID], let b = detail.blocks.firstIndex(where: { $0.id == blockID }) else { return }
        let before = detail.blocks[b].score
        change(&detail.blocks[b].score)
        guard detail.blocks[b].score != before else { return }
        details[sessionID] = detail
        send(.score(block: blockID, session: sessionID, score: detail.blocks[b].score))
    }

    func setNotes(_ text: String, in sessionID: UUID) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // The text as typed stays on screen; the trimmed form is what's saved.
        guard details[sessionID] != nil, details[sessionID]?.notes ?? "" != text else { return }
        details[sessionID]?.notes = text
        send(.notes(session: sessionID, text: trimmed.isEmpty ? nil : trimmed))
    }

    /// Tapping the flag that's already set clears it: a normal day has neither.
    func toggleEffort(_ value: String, in sessionID: UUID) {
        guard details[sessionID] != nil else { return }
        let next = details[sessionID]?.effort == value ? nil : value
        details[sessionID]?.effort = next
        send(.effort(session: sessionID, value: next))
    }

    func toggleEnergy(_ value: String, in sessionID: UUID) {
        guard details[sessionID] != nil else { return }
        let next = details[sessionID]?.energy == value ? nil : value
        details[sessionID]?.energy = next
        send(.energy(session: sessionID, value: next))
    }

    func setCompleted(_ completed: Bool, in sessionID: UUID) {
        details[sessionID]?.completed = completed
        if let i = sessions.firstIndex(where: { $0.id == sessionID }) { sessions[i].completed = completed }
        send(.completed(session: sessionID, at: completed ? .now : nil))
    }

    private func send(_ write: WorkoutWrite) {
        guard !isDemo else { return }
        writes.enqueue(write)
        save()
    }

    /// Remove a session and everything logged for it. A calendar workout is
    /// still scheduled, so it goes back to Upcoming, unopened.
    func delete(_ sessionID: UUID) async -> Bool {
        if !isDemo {
            do {
                try await db.from("workout_sessions").delete().eq("id", value: sessionID.uuidString.lowercased()).execute()
            } catch {
                return false
            }
        }
        sessions.removeAll { $0.id == sessionID }
        details[sessionID] = nil
        insights[sessionID] = nil
        save()
        return true
    }

    /// Swap a movement for the member's preferred substitute: repoint the
    /// entry and work its sets' estimated 1RMs out again for the new movement
    /// (the website's swapEntryMovement).
    func swap(entry entryID: UUID, in sessionID: UUID, to substitute: Substitute) async {
        if isDemo {
            guard var detail = details[sessionID] else { return }
            for b in detail.blocks.indices {
                if let e = detail.blocks[b].entries.firstIndex(where: { $0.id == entryID }) {
                    detail.blocks[b].entries[e].canonicalName = substitute.name
                    detail.blocks[b].entries[e].movementID = substitute.id
                }
            }
            details[sessionID] = detail
            insights[sessionID]?.substitutes[entryID] = nil
            return
        }
        struct Loaded: Decodable { let isLoaded: Bool }
        struct SetRow: Decodable { let id: UUID; let metricType: MetricType; let actualLoad: Double?; let actualReps: Int?; let actualUnit: String? }
        do {
            await writes.flush()
            let movement: [Loaded] = try await rows(
                db.from("movements").select("is_loaded").eq("id", value: substitute.id.uuidString.lowercased()).limit(1))
            let isLoaded = movement.first?.isLoaded ?? false
            try await db.from("workout_movement_entries")
                .update(["movement_id": substitute.id.uuidString.lowercased()])
                .eq("id", value: entryID.uuidString.lowercased())
                .execute()
            let sets: [SetRow] = try await rows(
                db.from("workout_sets")
                    .select("id, metric_type, actual_load, actual_reps, actual_unit")
                    .eq("entry_id", value: entryID.uuidString.lowercased()))
            for set in sets {
                let estimate = set.metricType == .loadReps
                    ? WorkoutRules.setE1rm(load: set.actualLoad, reps: set.actualReps, unit: set.actualUnit, isLoadedMovement: isLoaded)
                    : nil
                let row: [String: AnyJSON] = [
                    "e1rm": estimate.map { .double($0.e1rm) } ?? .null,
                    "e1rm_is_loose": .bool(estimate?.isLoose ?? false),
                ]
                try await db.from("workout_sets").update(row).eq("id", value: set.id.uuidString.lowercased()).execute()
            }
            try await db.from("workout_sessions")
                .update(["whoop_sync_status": "dirty"])
                .eq("id", value: sessionID.uuidString.lowercased())
                .eq("whoop_sync_status", value: "synced")
                .not("whoop_workout_id", operator: .is, value: "null")
                .execute()
        } catch {
            // Whatever went through shows on the reload below.
        }
        await loadSession(sessionID)
    }

    // MARK: Last seen

    /// What the screens showed last, kept on the phone so the app opens on it
    /// while the database loads behind (and in a gym with no signal).
    private struct Snapshot: Codable {
        var sessions: [SessionSummary]
        var events: [WorkoutEvent]
        var details: [UUID: SessionDetail]
        var insights: [UUID: SessionInsights]
        var families: [FamilyProgress]?
        var benchmarks: [BenchmarkPR]?
    }

    private static let snapshotKey = "workouts.lastSeen"

    private func restore() {
        guard let data = defaults.data(forKey: Self.snapshotKey),
              let saved = try? JSONDecoder().decode(Snapshot.self, from: data)
        else { return }
        sessions = saved.sessions
        events = saved.events
        details = saved.details
        for id in details.keys { writes.apply(to: &details[id]!) }
        writes.apply(to: &sessions)
        insights = saved.insights
        families = saved.families
        benchmarks = saved.benchmarks
        loaded = true
    }

    private func save() {
        guard !isDemo else { return }
        // The latest dozen sessions opened here are enough to open on.
        let kept = Set(details.values.sorted { $0.sessionDate > $1.sessionDate }.prefix(12).map(\.id))
        let snapshot = Snapshot(
            sessions: sessions, events: events,
            details: details.filter { kept.contains($0.key) },
            insights: insights.filter { kept.contains($0.key) },
            families: families, benchmarks: benchmarks
        )
        if let data = try? JSONEncoder().encode(snapshot) { defaults.set(data, forKey: Self.snapshotKey) }
    }

    /// Signing out: nothing of the last member's stays on the phone.
    func forget() {
        defaults.removeObject(forKey: Self.snapshotKey)
        sessions = []
        events = []
        details = [:]
        insights = [:]
        families = nil
        benchmarks = nil
        memberEmail = nil
        failedOpens = []
        preparation?.cancel()
        preparation = nil
        prepared = []
        loaded = false
    }

    // MARK: The website

    /// The website. `--website <url>` points a simulator at a local server.
    static var websiteURL: URL {
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--website"), args.count > at + 1, let url = URL(string: args[at + 1]) {
            return url
        }
        return Config.website
    }

    private struct OpenFailed: Error {}

    /// The website's parse-on-open (src/app/(workouts)/workouts/api/open/route.ts).
    private func openOnWebsite(_ eventID: UUID) async throws -> UUID {
        struct Reply: Decodable { let sessionId: UUID }
        let (data, response) = try await URLSession.shared.data(for: websiteRequest("open", event: eventID))
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw OpenFailed() }
        return try JSONDecoder().decode(Reply.self, from: data).sessionId
    }

    /// The website's parse ahead of an open
    /// (src/app/(workouts)/workouts/api/prepare/route.ts). False when the
    /// website couldn't be reached; a workout it reached but couldn't
    /// structure is left to its first open.
    private func prepareOnWebsite(_ eventID: UUID) async -> Bool {
        guard let request = try? await websiteRequest("prepare", event: eventID) else { return false }
        return (try? await URLSession.shared.data(for: request)) != nil
    }

    private func websiteRequest(_ route: String, event: UUID) async throws -> URLRequest {
        let token = try await db.auth.session.accessToken
        var request = URLRequest(url: Self.websiteURL.appending(path: "workouts/api/\(route)"))
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "eventId": event.uuidString.lowercased(),
            "timeZone": TimeZone.current.identifier,
        ])
        return request
    }

    // MARK: Queries

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    private func rows<T: Decodable>(_ query: PostgrestBuilder) async throws -> T {
        try Self.decoder.decode(T.self, from: try await query.execute().data)
    }

    private static let timestamps: [ISO8601DateFormatter] = {
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return [plain, fractional]
    }()

    private static func instant(_ text: String) -> Date? {
        timestamps.lazy.compactMap { $0.date(from: text) }.first
    }

    private func fetchSessions() async throws -> [SessionSummary] {
        struct Row: Decodable {
            let id: UUID
            let sessionDate: String
            let title: String?
            let completedAt: String?
            let createdAt: String
            let calendarEventId: UUID?
            let workoutBlocks: [Count]?
            struct Count: Decodable { let count: Int }
        }
        let fetched: [Row] = try await rows(
            db.from("workout_sessions")
                .select("id, session_date, title, completed_at, created_at, calendar_event_id, workout_blocks(count)")
                .order("session_date", ascending: false)
                .order("created_at", ascending: false))
        return fetched.map {
            SessionSummary(
                id: $0.id, date: $0.sessionDate, title: $0.title ?? "Workout",
                blockCount: $0.workoutBlocks?.first?.count ?? 0, completed: $0.completedAt != nil,
                calendarEventID: $0.calendarEventId, createdAt: $0.createdAt
            )
        }
    }

    /// The member's own "CFO: …" calendar events (src/lib/workouts/calendar.ts).
    private func fetchEvents() async throws -> [WorkoutEvent] {
        struct Member: Decodable { let email: String? }
        struct Row: Decodable { let id: UUID; let title: String; let startTime: String }
        if memberEmail == nil, let userID = Session.shared.userID {
            let member: [Member] = try await rows(
                db.from("family_members").select("email").eq("user_id", value: userID.uuidString.lowercased()).limit(1))
            memberEmail = member.first?.email
        }
        let iso = ISO8601DateFormatter()
        var query = db.from("calendar_events")
            .select("id, title, start_time")
            .ilike("title", pattern: "CFO:%")
            .eq("is_canceled", value: false)
            .gte("start_time", value: iso.string(from: .now.addingTimeInterval(-12 * 3600)))
            .lte("start_time", value: iso.string(from: .now.addingTimeInterval(60 * 86_400)))
        if let memberEmail { query = query.eq("member_email", value: memberEmail) }
        let fetched: [Row] = try await rows(query.order("start_time", ascending: true))
        return fetched.compactMap { row in
            guard let start = Self.instant(row.startTime) else { return nil }
            let title = row.title.replacing(#/^CFO:\s*/#.ignoresCase(), with: "").trimmingCharacters(in: .whitespaces)
            return WorkoutEvent(id: row.id, title: title, date: WorkoutDay.string(start))
        }
    }

    private func fetchDetail(_ id: UUID) async throws -> SessionDetail? {
        struct SetRow: Decodable {
            let id: UUID
            let position: Int
            let metricType: MetricType
            let context: SetContext
            let rxLevel: RxLevel?
            let prescribedReps: Int?
            let prescribedLoad: Double?
            let prescribedUnit: String?
            let prescribedDistance: Double?
            let prescribedDuration: Int?
            let prescribedCalories: Int?
            let actualReps: Int?
            let actualLoad: Double?
            let actualUnit: String?
            let actualDistance: Double?
            let actualDuration: Int?
            let actualCalories: Int?
            let e1rm: Double?
            let e1rmIsLoose: Bool
        }
        struct MovementRow: Decodable { let canonicalName: String; let family: String; let isLoaded: Bool }
        struct EntryRow: Decodable {
            let id: UUID
            let position: Int
            let rawName: String
            let movementId: UUID?
            let movements: MovementRow?
            let workoutSets: [SetRow]?
        }
        struct Named: Decodable { let name: String }
        struct BlockRow: Decodable {
            let id: UUID
            let position: Int
            let blockType: BlockType
            let title: String?
            let groupLabel: String?
            let scoreType: ScoreType
            let scoreSeconds: Int?
            let scoreRounds: Int?
            let scoreReps: Int?
            let scoreLoad: Double?
            let scoreDistance: Double?
            let scoreCalories: Int?
            let rxLevel: RxLevel?
            let benchmarkId: UUID?
            let workoutBenchmarks: Named?
            let workoutMovementEntries: [EntryRow]?
        }
        struct Row: Decodable {
            let id: UUID
            let sessionDate: String
            let title: String?
            let source: String
            let calendarEventId: UUID?
            let rawDescription: String?
            let notes: String?
            let effort: String?
            let energy: String?
            let parsedAt: String?
            let completedAt: String?
            let whoopSyncStatus: String?
            let workoutBlocks: [BlockRow]?
        }
        let select = """
            id, session_date, title, source, calendar_event_id, raw_description, notes, effort, energy,
            parsed_at, completed_at, whoop_sync_status,
            workout_blocks (
              id, position, block_type, title, group_label, score_type, score_seconds, score_rounds,
              score_reps, score_load, score_distance, score_calories, rx_level, benchmark_id,
              workout_benchmarks ( name ),
              workout_movement_entries (
                id, position, raw_name, movement_id,
                movements ( canonical_name, family, is_loaded ),
                workout_sets (
                  id, position, metric_type, context, rx_level,
                  prescribed_reps, prescribed_load, prescribed_unit, prescribed_distance,
                  prescribed_duration, prescribed_calories,
                  actual_reps, actual_load, actual_unit, actual_distance, actual_duration,
                  actual_calories, e1rm, e1rm_is_loose
                )
              )
            )
            """
        let fetched: [Row] = try await rows(
            db.from("workout_sessions").select(select).eq("id", value: id.uuidString.lowercased()).limit(1))
        guard let row = fetched.first else { return nil }
        let blocks = (row.workoutBlocks ?? []).sorted { $0.position < $1.position }.map { block in
            Block(
                id: block.id, position: block.position, blockType: block.blockType, title: block.title,
                groupLabel: block.groupLabel, scoreType: block.scoreType,
                score: Score(
                    seconds: block.scoreSeconds, rounds: block.scoreRounds, reps: block.scoreReps,
                    load: block.scoreLoad, distance: block.scoreDistance, calories: block.scoreCalories
                ),
                rxLevel: block.rxLevel, benchmarkID: block.benchmarkId, benchmarkName: block.workoutBenchmarks?.name,
                entries: (block.workoutMovementEntries ?? []).sorted { $0.position < $1.position }.map { entry in
                    Entry(
                        id: entry.id, position: entry.position, rawName: entry.rawName, movementID: entry.movementId,
                        canonicalName: entry.movements?.canonicalName, family: entry.movements?.family,
                        isLoaded: entry.movements?.isLoaded ?? false,
                        sets: (entry.workoutSets ?? []).sorted { $0.position < $1.position }.map { set in
                            WorkoutSet(
                                id: set.id, position: set.position, metricType: set.metricType, context: set.context,
                                rxLevel: set.rxLevel,
                                prescribed: SetMetrics(
                                    reps: set.prescribedReps, load: set.prescribedLoad, unit: set.prescribedUnit,
                                    distance: set.prescribedDistance, duration: set.prescribedDuration, calories: set.prescribedCalories
                                ),
                                actual: SetMetrics(
                                    reps: set.actualReps, load: set.actualLoad, unit: set.actualUnit,
                                    distance: set.actualDistance, duration: set.actualDuration, calories: set.actualCalories
                                ),
                                e1rm: set.e1rm, e1rmIsLoose: set.e1rmIsLoose
                            )
                        }
                    )
                }
            )
        }
        return SessionDetail(
            id: row.id, sessionDate: row.sessionDate, title: row.title, source: row.source,
            calendarEventID: row.calendarEventId, rawDescription: row.rawDescription, notes: row.notes,
            effort: row.effort, energy: row.energy, parsed: row.parsedAt != nil, completed: row.completedAt != nil,
            whoopSyncStatus: row.whoopSyncStatus, blocks: blocks
        )
    }

    /// The comparisons beside a session's movements. Each is its own read, and
    /// one that fails just leaves its card out.
    private func fetchInsights(for detail: SessionDetail) async -> SessionInsights {
        var result = insights[detail.id] ?? SessionInsights()
        let loaded = detail.entries.filter { $0.isLoaded && $0.movementID != nil }

        await withTaskGroup(of: (UUID, MovementHistory?).self) { group in
            for entry in loaded {
                guard let movement = entry.movementID else { continue }
                group.addTask { (entry.id, try? await self.fetchHistory(movement: movement, excluding: detail.id)) }
            }
            for await (entry, history) in group {
                if let history { result.history[entry] = history }
            }
        }

        await withTaskGroup(of: (UUID, [BenchmarkAttempt]?).self) { group in
            for block in detail.blocks {
                guard let benchmark = block.benchmarkID else { continue }
                group.addTask { (block.id, try? await self.fetchAttempts(benchmark: benchmark, excluding: detail.id)) }
            }
            for await (block, attempts) in group {
                if let attempts { result.attempts[block] = attempts }
            }
        }

        // A loaded movement with no history of its own borrows an estimate
        // from a family-mate that has some.
        let bare = loaded.filter { entry in
            result.history[entry.id].map { $0.bestE1rmStrict == nil && $0.recent.isEmpty } ?? false
        }
        if !bare.isEmpty, let hints = try? await fetchSiblingHints(for: bare.compactMap(\.movementID)) {
            result.hints = [:]
            for entry in bare {
                if let movement = entry.movementID, let hint = hints[movement] { result.hints[entry.id] = hint }
            }
        }

        if let substitutes = try? await fetchSubstitutes(for: detail.entries.compactMap(\.movementID)) {
            result.substitutes = [:]
            for entry in detail.entries {
                if let movement = entry.movementID, let substitute = substitutes[movement] {
                    result.substitutes[entry.id] = substitute
                }
            }
        }
        return result
    }

    private func fetchHistory(movement: UUID, excluding session: UUID) async throws -> MovementHistory {
        struct Best: Decodable { let bestE1rmStrict: Double? }
        struct Row: Decodable {
            let actualLoad: Double?
            let actualReps: Int?
            let actualUnit: String?
            let e1rm: Double?
            let e1rmIsLoose: Bool
            let workoutMovementEntries: EntryRef
            struct EntryRef: Decodable { let workoutBlocks: BlockRef }
            struct BlockRef: Decodable { let sessionId: UUID; let workoutSessions: SessionRef }
            struct SessionRef: Decodable { let sessionDate: String }
        }
        let id = movement.uuidString.lowercased()
        async let bestQuery: [Best] = rows(
            db.from("workout_movement_e1rm_best")
                .select("best_e1rm_strict")
                .eq("movement_id", value: id)
                .eq("context", value: "strength")
                .limit(1))
        async let setsQuery: [Row] = rows(
            db.from("workout_sets")
                .select("""
                    actual_load, actual_reps, actual_unit, e1rm, e1rm_is_loose,
                    workout_movement_entries!inner (
                      movement_id,
                      workout_blocks!inner ( session_id, workout_sessions!inner ( session_date ) )
                    )
                    """)
                .eq("workout_movement_entries.movement_id", value: id))
        let (best, sets) = try await (bestQuery, setsQuery)
        let recent = sets
            .filter { $0.workoutMovementEntries.workoutBlocks.sessionId != session }
            .map {
                HistorySet(
                    date: $0.workoutMovementEntries.workoutBlocks.workoutSessions.sessionDate,
                    load: $0.actualLoad, reps: $0.actualReps, unit: $0.actualUnit, e1rm: $0.e1rm, e1rmIsLoose: $0.e1rmIsLoose
                )
            }
            .sorted { $0.date > $1.date }
            .prefix(12)
        return MovementHistory(bestE1rmStrict: best.first?.bestE1rmStrict, recent: Array(recent))
    }

    private func fetchAttempts(benchmark: UUID, excluding session: UUID) async throws -> [BenchmarkAttempt] {
        struct Row: Decodable {
            let scoreType: ScoreType
            let scoreSeconds: Int?
            let scoreRounds: Int?
            let scoreReps: Int?
            let scoreLoad: Double?
            let scoreDistance: Double?
            let scoreCalories: Int?
            let rxLevel: RxLevel?
            let sessionId: UUID
            let workoutSessions: SessionRef
            struct SessionRef: Decodable { let sessionDate: String }
        }
        let fetched: [Row] = try await rows(
            db.from("workout_blocks")
                .select("""
                    score_type, score_seconds, score_rounds, score_reps, score_load, score_distance,
                    score_calories, rx_level, session_id, workout_sessions!inner ( session_date )
                    """)
                .eq("benchmark_id", value: benchmark.uuidString.lowercased()))
        return fetched
            .filter { $0.sessionId != session }
            .map {
                BenchmarkAttempt(
                    date: $0.workoutSessions.sessionDate, scoreType: $0.scoreType,
                    score: Score(
                        seconds: $0.scoreSeconds, rounds: $0.scoreRounds, reps: $0.scoreReps,
                        load: $0.scoreLoad, distance: $0.scoreDistance, calories: $0.scoreCalories
                    ),
                    rxLevel: $0.rxLevel
                )
            }
            .sorted { $0.date > $1.date }
    }

    /// The website's getSiblingHints (src/lib/workouts/sibling.ts): only where
    /// a family ratio connects the two lifts directly.
    private func fetchSiblingHints(for targets: [UUID]) async throws -> [UUID: SiblingHint] {
        struct Target: Decodable { let id: UUID; let family: String }
        struct Best: Decodable {
            let movementId: UUID
            let bestE1rmStrict: Double
            let movements: Movement
            struct Movement: Decodable { let family: String; let canonicalName: String }
        }
        struct Ratio: Decodable { let fromMovement: UUID; let toMovement: UUID; let ratioLow: Double; let ratioHigh: Double }
        async let targetQuery: [Target] = rows(
            db.from("movements").select("id, family").in("id", values: targets.map { $0.uuidString.lowercased() }))
        async let bestQuery: [Best] = rows(
            db.from("workout_movement_e1rm_best")
                .select("movement_id, best_e1rm_strict, movements!inner ( family, canonical_name )")
                .eq("context", value: "strength")
                .not("best_e1rm_strict", operator: .is, value: "null"))
        async let ratioQuery: [Ratio] = rows(
            db.from("movement_family_ratios").select("from_movement, to_movement, ratio_low, ratio_high"))
        let (targetRows, bests, ratios) = try await (targetQuery, bestQuery, ratioQuery)
        let trained = Set(bests.map(\.movementId))

        var hints: [UUID: SiblingHint] = [:]
        for target in targetRows where !trained.contains(target.id) {
            var chosen: (name: String, best: Double, low: Double, high: Double)?
            for sibling in bests where sibling.movements.family == target.family && sibling.movementId != target.id {
                let range: (low: Double, high: Double)
                if let direct = ratios.first(where: { $0.fromMovement == sibling.movementId && $0.toMovement == target.id }) {
                    range = (direct.ratioLow, direct.ratioHigh)
                } else if let inverse = ratios.first(where: { $0.fromMovement == target.id && $0.toMovement == sibling.movementId }),
                          inverse.ratioLow > 0, inverse.ratioHigh > 0 {
                    range = (1 / inverse.ratioHigh, 1 / inverse.ratioLow)
                } else {
                    continue
                }
                if sibling.bestE1rmStrict > (chosen?.best ?? -.infinity) {
                    chosen = (sibling.movements.canonicalName, sibling.bestE1rmStrict, range.low, range.high)
                }
            }
            if let chosen {
                let estimate = WorkoutRules.siblingEstimate(fromE1rm: chosen.best, low: chosen.low, high: chosen.high)
                hints[target.id] = SiblingHint(fromName: chosen.name, low: estimate.low, high: estimate.high)
            }
        }
        return hints
    }

    private func fetchSubstitutes(for movements: [UUID]) async throws -> [UUID: Substitute] {
        struct Row: Decodable { let movementId: UUID; let substituteMovementId: UUID }
        struct Named: Decodable { let id: UUID; let canonicalName: String }
        let ids = Array(Set(movements)).map { $0.uuidString.lowercased() }
        guard !ids.isEmpty else { return [:] }
        let subs: [Row] = try await rows(
            db.from("workout_movement_substitutions").select("movement_id, substitute_movement_id").in("movement_id", values: ids))
        guard !subs.isEmpty else { return [:] }
        let names: [Named] = try await rows(
            db.from("movements")
                .select("id, canonical_name")
                .in("id", values: Array(Set(subs.map { $0.substituteMovementId.uuidString.lowercased() }))))
        let nameByID = Dictionary(names.map { ($0.id, $0.canonicalName) }, uniquingKeysWith: { a, _ in a })
        var result: [UUID: Substitute] = [:]
        for sub in subs {
            if let name = nameByID[sub.substituteMovementId] {
                result[sub.movementId] = Substitute(id: sub.substituteMovementId, name: name)
            }
        }
        return result
    }

    private func fetchProgressSets() async throws -> [ProgressSet] {
        struct Row: Decodable {
            let actualLoad: Double?
            let actualReps: Int?
            let e1rm: Double?
            let e1rmIsLoose: Bool
            let context: SetContext
            let workoutMovementEntries: EntryRef
            struct EntryRef: Decodable { let movementId: UUID; let movements: Movement; let workoutBlocks: BlockRef }
            struct Movement: Decodable { let canonicalName: String; let family: String; let isLoaded: Bool }
            struct BlockRef: Decodable { let workoutSessions: SessionRef }
            struct SessionRef: Decodable { let sessionDate: String }
        }
        let fetched: [Row] = try await rows(
            db.from("workout_sets").select("""
                actual_load, actual_reps, e1rm, e1rm_is_loose, context,
                workout_movement_entries!inner (
                  movement_id,
                  movements!inner ( canonical_name, family, is_loaded ),
                  workout_blocks!inner ( workout_sessions!inner ( session_date ) )
                )
                """))
        return fetched.map {
            let entry = $0.workoutMovementEntries
            return ProgressSet(
                movementID: entry.movementId, name: entry.movements.canonicalName, family: entry.movements.family,
                isLoaded: entry.movements.isLoaded, date: entry.workoutBlocks.workoutSessions.sessionDate,
                load: $0.actualLoad, reps: $0.actualReps, e1rm: $0.e1rm, e1rmIsLoose: $0.e1rmIsLoose, context: $0.context
            )
        }
    }

    private func fetchBenchmarkRows() async throws -> [BenchmarkRow] {
        struct Row: Decodable {
            let benchmarkId: UUID
            let scoreType: ScoreType
            let scoreSeconds: Int?
            let scoreRounds: Int?
            let scoreReps: Int?
            let scoreLoad: Double?
            let scoreDistance: Double?
            let scoreCalories: Int?
            let rxLevel: RxLevel?
            let workoutBenchmarks: Named
            let workoutSessions: SessionRef
            struct Named: Decodable { let name: String }
            struct SessionRef: Decodable { let sessionDate: String }
        }
        let fetched: [Row] = try await rows(
            db.from("workout_blocks")
                .select("""
                    benchmark_id, score_type, score_seconds, score_rounds, score_reps, score_load,
                    score_distance, score_calories, rx_level,
                    workout_benchmarks!inner ( name ), workout_sessions!inner ( session_date )
                    """)
                .not("benchmark_id", operator: .is, value: "null"))
        return fetched.map {
            BenchmarkRow(
                benchmarkID: $0.benchmarkId, name: $0.workoutBenchmarks.name, date: $0.workoutSessions.sessionDate,
                scoreType: $0.scoreType,
                score: Score(
                    seconds: $0.scoreSeconds, rounds: $0.scoreRounds, reps: $0.scoreReps,
                    load: $0.scoreLoad, distance: $0.scoreDistance, calories: $0.scoreCalories
                ),
                rxLevel: $0.rxLevel
            )
        }
    }
}
