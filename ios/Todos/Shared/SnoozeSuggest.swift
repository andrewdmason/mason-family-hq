import Foundation

// Typed snooze times, by the website's rules (src/lib/todos/when-suggest.ts; keep
// them in step): "tom", "fri", "next week", "in 3 days", "jun 24", "6/24", a bare
// day of the month, each optionally with a time ("tomorrow 3pm", "fri evening").
// Day-level answers wake at midnight, like the snooze presets.

struct SnoozeSuggestion: Equatable {
    let when: Date
    let label: String
    let hint: String
}

enum SnoozeSuggest {
    private static let weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    private static let months = [
        "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
        "november", "december",
    ]
    private static let namedTimes: [(name: String, hour: Int, minute: Int, todayOnly: Bool)] = [
        ("morning", 9, 0, false), ("noon", 12, 0, false), ("midday", 12, 0, false), ("afternoon", 14, 0, false),
        ("evening", 17, 0, false), ("tonight", 17, 0, true), ("night", 20, 0, false), ("midnight", 0, 0, false),
    ]
    private static let limit = 6

    private struct TimeOfDay {
        let hour: Int
        let minute: Int
        var todayOnly = false
    }

    static func suggestions(for raw: String, now: Date = Date()) -> [SnoozeSuggestion] {
        let q = raw.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !q.isEmpty else { return [] }
        let (base, time) = splitTime(q)

        guard let time else {
            return matchDays(q, now: now, includeToday: false).prefix(limit).map {
                SnoozeSuggestion(
                    when: $0.when, label: $0.label ?? dayLabel($0.when, now: now),
                    hint: $0.when.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
            }
        }

        // A time of day means a real moment, and a bare time means its next turn.
        let days = base.isEmpty ? [(when: dayAfter(now, 0), label: String?.none)] : matchDays(base, now: now, includeToday: true)
        var seen = Set<Date>()
        var results: [SnoozeSuggestion] = []
        for day in days {
            var when = withTime(day.when, time)
            if when <= now, base.isEmpty, !time.todayOnly { when = withTime(dayAfter(now, 1), time) }
            guard when > now, seen.insert(when).inserted else { continue }
            results.append(SnoozeSuggestion(
                when: when, label: dayLabel(when, now: now),
                hint: when.formatted(date: .omitted, time: .shortened)))
        }
        return Array(results.prefix(limit))
    }

    private static var calendar: Calendar { Calendar.current }

    private static func dayAfter(_ now: Date, _ days: Int) -> Date {
        calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: now)) ?? now
    }

    private static func withTime(_ day: Date, _ time: TimeOfDay) -> Date {
        calendar.date(bySettingHour: time.hour, minute: time.minute, second: 0, of: day) ?? day
    }

    private static func dayLabel(_ when: Date, now: Date) -> String {
        let diff = calendar.dateComponents(
            [.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: when)
        ).day ?? 0
        if diff == 0 { return "Today" }
        if diff == 1 { return "Tomorrow" }
        if diff > 1, diff < 7 { return when.formatted(.dateTime.weekday(.wide)) }
        return when.formatted(.dateTime.month(.abbreviated).day())
    }

    /// The groups of a whole-string match; nil for a group that didn't take part.
    private static func match(_ pattern: String, _ text: String) -> [String?]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
            let found = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
        else { return nil }
        return (0..<found.numberOfRanges).map { index in
            Range(found.range(at: index), in: text).map { String(text[$0]) }
        }
    }

    /// Peels a trailing time off: "tomorrow 10am" is "tomorrow" at 10:00. Only a
    /// meridiem, a colon or a named time counts, so "jun 24" still reads as a date.
    private static func splitTime(_ q: String) -> (base: String, time: TimeOfDay?) {
        func rest(_ base: String) -> String {
            var text = base
            if let range = text.range(of: #"(?:^|\s)(?:@|at)$"#, options: .regularExpression) { text.removeSubrange(range) }
            if text == "this" { text = "" }
            return text.trimmingCharacters(in: .whitespaces)
        }
        if let clock = match(#"^(?:(.*?)\s+)?(?:(?:@|at)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)?$"#, q),
            clock[3] != nil || clock[4] != nil,
            var hour = clock[2].flatMap({ Int($0) }) {
            let minute = clock[3].flatMap { Int($0) } ?? 0
            let meridiem = clock[4]?.first
            let valid = minute < 60 && (meridiem != nil ? (1...12).contains(hour) : hour < 24)
            if valid {
                if meridiem == "a", hour == 12 { hour = 0 }
                if meridiem == "p", hour < 12 { hour += 12 }
                return (rest(clock[1] ?? ""), TimeOfDay(hour: hour, minute: minute))
            }
        }
        // Three letters in ("eve", "noon"): any shorter would swallow days.
        let words = q.split(separator: " ").map(String.init)
        if let last = words.last, last.count >= 3, let named = namedTimes.first(where: { $0.name.hasPrefix(last) }) {
            return (
                rest(words.dropLast().joined(separator: " ")),
                TimeOfDay(hour: named.hour, minute: named.minute, todayOnly: named.todayOnly)
            )
        }
        return (q, nil)
    }

    private static func matchDays(_ q: String, now: Date, includeToday: Bool) -> [(when: Date, label: String?)] {
        var out: [(when: Date, label: String?)] = []
        var seen = Set<Date>()
        func add(_ when: Date, _ label: String? = nil) {
            if seen.insert(when).inserted { out.append((when, label)) }
        }
        // A date spelled out is only "gone" once the day is, if a time is coming.
        let cutoff = includeToday ? dayAfter(now, 0) : now
        let today = calendar.component(.weekday, from: now) - 1

        if includeToday, "today".hasPrefix(q) { add(dayAfter(now, 0), "Today") }
        if "tomorrow".hasPrefix(q) || ["tm", "tmr", "tmrw", "tom"].contains(q) { add(dayAfter(now, 1), "Tomorrow") }

        // Two letters minimum, so a lone "s" doesn't offer every day of the week.
        let nextPrefixed = q.hasPrefix("next ")
        let weekday = nextPrefixed ? String(q.dropFirst(5)) : q
        if weekday.count >= 2 {
            for (index, name) in weekdays.enumerated() where name.hasPrefix(weekday) {
                var days = (index - today + 7) % 7
                if days == 0 { days = 7 }
                if nextPrefixed, days < 7 { days += 7 }
                add(dayAfter(now, days))
            }
        }

        if "this weekend".hasPrefix(q) || "weekend".hasPrefix(q) {
            let days = (6 - today + 7) % 7
            add(dayAfter(now, days == 0 ? 7 : days), "This weekend")
        }
        if "next week".hasPrefix(q) {
            let days = (1 - today + 7) % 7
            add(dayAfter(now, days == 0 ? 7 : days), "Next week")
        }
        if "next month".hasPrefix(q) {
            var parts = calendar.dateComponents([.year, .month], from: now)
            parts.month = (parts.month ?? 1) + 1
            parts.day = 1
            if let when = calendar.date(from: parts) { add(when, "Next month") }
        }

        if let relative = match(#"^(?:in )?(\d+) ?(d|day|days|w|wk|week|weeks|mo|month|months)( from now)?$"#, q),
            let n = relative[1].flatMap({ Int($0) }), let unit = relative[2], n > 0 {
            let name = unit.hasPrefix("d") ? "day" : unit.hasPrefix("w") ? "week" : "month"
            let when: Date
            switch name {
            case "day": when = dayAfter(now, n)
            case "week": when = dayAfter(now, n * 7)
            default: when = calendar.date(byAdding: .month, value: n, to: dayAfter(now, 0)) ?? now
            }
            add(when, "In \(n) \(name)\(n == 1 ? "" : "s")")
        }

        func date(year: Int, month: Int, day: Int) -> Date? {
            let when = calendar.date(from: DateComponents(year: year, month: month, day: day))
            // Reject rollovers, like June 31 becoming July 1.
            return when.flatMap { calendar.component(.day, from: $0) == day ? $0 : nil }
        }
        let year = calendar.component(.year, from: now)
        let month = calendar.component(.month, from: now)

        // A bare day of the month means the next one there is.
        if let bare = match(#"^(\d{1,2})$"#, q), let day = bare[1].flatMap({ Int($0) }), (1...31).contains(day) {
            for offset in 0..<3 {
                let total = month - 1 + offset
                if let when = date(year: year + total / 12, month: total % 12 + 1, day: day), when >= cutoff {
                    add(when)
                    break
                }
            }
        }

        // "jun 24", "june 24" and "6/24".
        var wanted: (month: Int, day: Int)?
        if let named = match(#"^([a-z]{3,}) (\d{1,2})$"#, q), let word = named[1], let day = named[2].flatMap({ Int($0) }),
            let index = months.firstIndex(where: { $0.hasPrefix(word) }) {
            wanted = (index + 1, day)
        } else if let numeric = match(#"^(\d{1,2})[/.](\d{1,2})$"#, q), let m = numeric[1].flatMap({ Int($0) }),
            let day = numeric[2].flatMap({ Int($0) }) {
            wanted = (m, day)
        }
        if let wanted, (1...12).contains(wanted.month), (1...31).contains(wanted.day) {
            if let this = date(year: year, month: wanted.month, day: wanted.day), this >= cutoff {
                add(this)
            } else if let next = date(year: year + 1, month: wanted.month, day: wanted.day) {
                add(next)
            }
        }
        return out
    }
}
