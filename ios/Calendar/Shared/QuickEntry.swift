import Foundation

/// A new event as a typed line says it: "Dinner with Jenny at Zuni tomorrow
/// 7-9pm", "Dentist for Oscar tue 3:30pm", "Piano every tuesday 4pm until
/// dec 15". Read on the device as each letter is typed, so the event can
/// take shape under the line; whatever it doesn't understand stays in the
/// title, and the card is there to put right.
///
/// What it reads:
/// - a day: today, tonight, tomorrow, a weekday ("fri", "next friday"), a
///   date ("dec 3", "3 dec", "12/3", "the 5th"), "in 3 days", "next week";
/// - a time or a span: "3pm", "3:30", "at 3", "noon", "3-4pm", "9am to 12",
///   and how long ("for 90 min", "for 2 hours"). With no time it's all day,
///   unless it's a meal, which has its usual hour;
/// - a place: what follows "at" or "@";
/// - the family: a first name is someone going, "for Oscar" puts it on
///   Oscar's calendar;
/// - repeating: "every day", "every weekday", "every week", "every tuesday",
///   "every other week", "every month", "every year", and "until dec 15".
struct QuickEntry: Equatable, Sendable {
    var title = ""
    var start: Date
    var end: Date
    var allDay = false
    var location = ""
    /// Family members named in the line, by email, in the order given.
    var going: [String] = []
    /// Whose calendar it goes on, when the line says ("for Oscar").
    var holder: String?
    var repeats: Repeat?

    /// What the line is read against.
    struct Context: Sendable {
        var now = Date()
        var calendar = Calendar.current
        /// The day an event with no day in it lands on.
        var day: Day
        /// The family, by first name.
        var people: [Person] = []
        /// The one typing: their own name in the line adds nobody.
        var me: String?

        struct Person: Sendable {
            var name: String
            var email: String
        }
    }

    /// The line as the event card's draft, on `me`'s calendar unless it says
    /// whose.
    func draft(me: String) -> CardDraft {
        let holder = holder ?? me
        var draft = CardDraft(
            event: EventDraft(title: title, memberEmail: holder, start: start, end: end, allDay: allDay, location: location)
        )
        draft.repeats = repeats
        draft.going = going.filter { $0 != holder }
        return draft
    }

    static func parse(_ line: String, _ context: Context) -> QuickEntry {
        var scan = Scan(line)
        let calendar = context.calendar
        let today = Day(context.now, in: calendar)

        // How it repeats, and until when.
        var repeats: Repeat?
        var weekdayOfRule: Int?
        let until = scan.date(after: #"\b(?:until|till|thru|through)\s+"#, today: today, calendar: calendar)
        if scan.take(#"\bevery\s+other\s+week\b|\bbi-?weekly\b|\bevery\s+(?:2|two)\s+weeks\b"#) != nil {
            repeats = Repeat(every: .twoWeeks)
        } else if scan.take(#"\bevery\s+weekday\b|\bweekdays\b"#) != nil {
            repeats = Repeat(every: .weekday)
        } else if scan.take(#"\bevery\s+day\b|\bdaily\b"#) != nil {
            repeats = Repeat(every: .day)
        } else if scan.take(#"\bevery\s+week\b|\bweekly\b"#) != nil {
            repeats = Repeat(every: .week)
        } else if scan.take(#"\bevery\s+month\b|\bmonthly\b"#) != nil {
            repeats = Repeat(every: .month)
        } else if scan.take(#"\bevery\s+year\b|\byearly\b|\bannually\b"#) != nil {
            repeats = Repeat(every: .year)
        } else if let found = scan.take(#"\bevery\s+("# + Words.weekdays + #")\b"#), let name = found[1] {
            repeats = Repeat(every: .week)
            weekdayOfRule = Words.weekday(name)
        }
        if repeats != nil { repeats?.until = until }

        // Whose calendar: "for Oscar".
        var holder: String?
        let others = context.people.filter { $0.email != context.me }
        if !others.isEmpty {
            let names = others.map { NSRegularExpression.escapedPattern(for: $0.name) }.joined(separator: "|")
            if let found = scan.take(#"\bfor\s+("# + names + #")\b(?!['’])"#), let name = found[1] {
                holder = others.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.email
            }
        }

        // How long.
        var length: TimeInterval?
        if let found = scan.take(#"\bfor\s+(an?|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b"#), let amount = found[1], let unit = found[2] {
            let n = Double(amount) ?? 1
            length = n * (unit.lowercased().hasPrefix("h") ? 3600 : 60)
        }

        // The day.
        var day = scan.date(after: "", today: today, calendar: calendar)
        var tonight = false
        if day == nil, scan.take(#"\btonight\b"#) != nil {
            day = today
            tonight = true
        }
        var weekdayToday = false
        if day == nil, let weekday = weekdayOfRule {
            let ahead = (weekday - today.weekdayIndex(in: calendar) + 7) % 7
            day = today.adding(days: ahead, in: calendar)
            weekdayToday = ahead == 0
        } else if let found = scan.weekdayToday {
            weekdayToday = found
        }

        // The time, or the span.
        var startMinutes: Int?
        var endMinutes: Int?
        if let span = scan.span() {
            (startMinutes, endMinutes) = (span.start, span.end)
        } else if let time = scan.time() {
            startMinutes = time
        }

        // Where: what follows "at", as far as the next thing that was read.
        var location = ""
        if let found = scan.take(#"(?:^|(?<=\s))(?:at|@)\s+([^\x{1}]+?)(?=\s+with\b|\s+w/|\s*\x{1}|\s*$)"#, marked: true), let place = found[1] {
            location = Words.capitalised(place.trimmingCharacters(in: .whitespaces))
        }

        // Who: any other family member named in what's left.
        var going: [String] = []
        let left = scan.remaining
        for person in others where person.email != holder {
            let name = NSRegularExpression.escapedPattern(for: person.name)
            if left.range(of: #"\b"# + name + #"(?:['’]s)?\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
                going.append(person.email)
            }
        }

        let title = scan.title

        // A meal with no time has its usual hour.
        if startMinutes == nil {
            let meals: [(String, Int, TimeInterval)] = [
                ("breakfast", 8 * 60, 3600), ("brunch", 11 * 60, 5400), ("lunch", 12 * 60, 3600), ("dinner", 19 * 60, 5400),
            ]
            for (word, at, takes) in meals where title.range(of: #"\b"# + word + #"\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
                startMinutes = at
                if length == nil { length = takes }
                break
            }
        }
        if startMinutes == nil, tonight { startMinutes = 19 * 60 }

        var on = day ?? context.day
        var entry: QuickEntry
        if let startMinutes {
            // "Friday 3pm" said on a Friday after 3 is next Friday's.
            if weekdayToday, on == today, on.at(minutes: startMinutes, in: calendar) < context.now {
                on = on.adding(days: 7, in: calendar)
            }
            let start = on.at(minutes: startMinutes, in: calendar)
            var end = start.addingTimeInterval(length ?? 3600)
            if let endMinutes {
                end = on.at(minutes: endMinutes, in: calendar)
                // "10pm-1am" ends the next day.
                if end <= start { end = on.adding(days: 1, in: calendar).at(minutes: endMinutes, in: calendar) }
            }
            entry = QuickEntry(start: start, end: end)
        } else if let length {
            // Long, with no time: from the next round hour.
            let start = CalendarRules.newEventTimes(on: on, now: context.now, in: calendar).start
            entry = QuickEntry(start: start, end: start.addingTimeInterval(length))
        } else {
            // All day; the times are the card's stand-ins for one.
            entry = QuickEntry(start: on.at(minutes: 9 * 60, in: calendar), end: on.at(minutes: 10 * 60, in: calendar), allDay: true)
        }
        entry.title = title
        entry.location = location
        entry.going = going
        entry.holder = holder
        entry.repeats = repeats
        return entry
    }
}

/// The words the line is read by.
private enum Words {
    static let weekdays = "monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun"
    static let months = "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec"

    /// 0 for Monday … 6 for Sunday, as `Day.weekdayIndex`.
    static func weekday(_ word: String) -> Int? {
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].firstIndex(of: String(word.lowercased().prefix(3)))
    }

    static func month(_ word: String) -> Int? {
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
            .firstIndex(of: String(word.lowercased().prefix(3))).map { $0 + 1 }
    }

    static func capitalised(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }
}

/// The line, with what's been read so far marked off so nothing is read twice.
private struct Scan {
    private let text: NSString
    private var used: [Bool]
    /// Whether a bare weekday that was read is today's.
    private(set) var weekdayToday: Bool?

    init(_ line: String) {
        text = line as NSString
        used = Array(repeating: false, count: text.length)
    }

    /// The first match of `pattern` in what hasn't been read, marked off; its
    /// groups, the whole match first. With `marked`, the pattern is run on
    /// the line with what's been read replaced by U+0001, so it can stop there.
    mutating func take(_ pattern: String, marked: Bool = false) -> [String?]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let subject = marked ? self.marked as NSString : text
        for match in regex.matches(in: subject as String, range: NSRange(location: 0, length: subject.length)) {
            let range = match.range
            guard range.length > 0, !(range.location..<range.location + range.length).contains(where: { used[$0] }) else { continue }
            for at in range.location..<range.location + range.length { used[at] = true }
            return (0..<match.numberOfRanges).map { n in
                let r = match.range(at: n)
                return r.location == NSNotFound ? nil : text.substring(with: r)
            }
        }
        return nil
    }

    /// The line with what's been read replaced, unit for unit, by U+0001.
    private var marked: String {
        var units = [unichar](repeating: 0, count: text.length)
        text.getCharacters(&units, range: NSRange(location: 0, length: text.length))
        for at in units.indices where used[at] { units[at] = 1 }
        return String(utf16CodeUnits: units, count: units.count)
    }

    /// What hasn't been read, with a space where something was.
    var remaining: String {
        marked.replacingOccurrences(of: "\u{1}+", with: " ", options: .regularExpression)
    }

    /// What's left as the event's title: without the little words that led
    /// up to something read ("on", "at", "from"), tidied.
    var title: String {
        var out = marked
        // "Lunch on ⌁", "Call from ⌁", "Dinner, ⌁".
        let dangling = #"(?:(?<=\s)|^)(?:on|at|from|this|starting|@)\s*(?=\x{1})|[,;\-–—]\s*(?=\x{1})|(?<=\x{1})\s*[,;\-–—]"#
        for _ in 0..<3 { out = out.replacingOccurrences(of: dangling, with: "", options: [.regularExpression, .caseInsensitive]) }
        out = out.replacingOccurrences(of: "\u{1}+", with: " ", options: .regularExpression)
        out = out.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        out = out.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",;-–—")))
        return Words.capitalised(out)
    }

    // MARK: Days

    /// A day written after `lead` ("" for anywhere), marked off.
    mutating func date(after lead: String, today: Day, calendar: Calendar) -> Day? {
        func number(_ text: String?) -> Int? { text.flatMap { Int($0) } }
        /// A month and day with no year is the next one to come.
        func coming(month: Int, day: Int, year: Int?) -> Day? {
            guard (1...12).contains(month), (1...31).contains(day) else { return nil }
            if var year {
                if year < 100 { year += 2000 }
                return Day(year: year, month: month, day: day)
            }
            let this = Day(year: today.year, month: month, day: day)
            return this < today ? Day(year: today.year + 1, month: month, day: day) : this
        }
        let on = lead.isEmpty ? #"\b(?:on\s+)?"# : lead

        if take(lead + #"\bday\s+after\s+tomorrow\b"#) != nil { return today.adding(days: 2, in: calendar) }
        if take(lead + #"\b(?:tomorrow|tmrw|tmw)\b"#) != nil { return today.adding(days: 1, in: calendar) }
        if take(lead + #"\btoday\b"#) != nil { return today }
        if let found = take(lead + #"\bin\s+(\d+|an?)\s+(days?|weeks?|months?)\b"#), let amount = found[1], let unit = found[2] {
            let n = Int(amount) ?? 1
            switch unit.lowercased().prefix(1) {
            case "d": return today.adding(days: n, in: calendar)
            case "w": return today.adding(days: 7 * n, in: calendar)
            default: return today.adding(months: n, in: calendar)
            }
        }
        if let found = take(on + "(" + Words.months + #")\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?"#),
           let month = found[1].flatMap(Words.month), let day = number(found[2]) {
            return coming(month: month, day: day, year: number(found[3]))
        }
        if let found = take(on + #"(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?("# + Words.months + #")\b\.?(?:,?\s+(\d{4})\b)?"#),
           let day = number(found[1]), let month = found[2].flatMap(Words.month) {
            return coming(month: month, day: day, year: number(found[3]))
        }
        if let found = take(on + #"(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?\b"#), let month = number(found[1]), let day = number(found[2]) {
            return coming(month: month, day: day, year: number(found[3]))
        }
        if let found = take(on + #"the\s+(\d{1,2})(?:st|nd|rd|th)\b"#), let day = number(found[1]), (1...31).contains(day) {
            let this = Day(year: today.year, month: today.month, day: day)
            return this < today ? Day(year: today.year, month: today.month, day: 1).adding(months: 1, in: calendar).adding(days: day - 1, in: calendar) : this
        }
        if let found = take(on + #"(next\s+|this\s+)?("# + Words.weekdays + #")\b"#), let weekday = found[2].flatMap(Words.weekday) {
            let ahead = (weekday - today.weekdayIndex(in: calendar) + 7) % 7
            var day = today.adding(days: ahead, in: calendar)
            // "Next friday" is the Friday of next week.
            if found[1]?.lowercased().hasPrefix("next") == true, day.weekStart(in: calendar) == today.weekStart(in: calendar) {
                day = day.adding(days: 7, in: calendar)
            }
            if lead.isEmpty { weekdayToday = ahead == 0 && found[1] == nil }
            return day
        }
        if take(lead + #"\bnext\s+week\b"#) != nil { return today.adding(days: 7, in: calendar) }
        return nil
    }

    // MARK: Times

    private static let clock = #"(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm)|(a|p))?"#
    private static let between = #"\s*(?:-|–|—|to|until|till)\s*"#

    /// Minutes after midnight, of an hour and minute said with or without
    /// its half of the day. Without, 1 to 7 are the afternoon's.
    private static func minutes(_ hour: Int, _ minute: Int, _ half: String?) -> Int? {
        guard (0...24).contains(hour), (0..<60).contains(minute) else { return nil }
        var h = hour
        if let half = half?.lowercased() {
            guard (1...12).contains(hour) else { return nil }
            h = hour % 12 + (half.hasPrefix("p") ? 12 : 0)
        } else if (1...7).contains(hour) {
            h += 12
        }
        return h % 24 * 60 + minute
    }

    /// "3-4pm", "3pm to 4:30pm", "9am-12", "from 14:00 to 15:30".
    mutating func span() -> (start: Int, end: Int)? {
        let pattern = #"\b(?:from\s+|at\s+)?"# + Self.clock + Self.between + Self.clock + #"\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        for match in regex.matches(in: text as String, range: NSRange(location: 0, length: text.length)) {
            func group(_ n: Int) -> String? {
                let r = match.range(at: n)
                return r.location == NSNotFound ? nil : text.substring(with: r)
            }
            let range = match.range
            guard !(range.location..<range.location + range.length).contains(where: { used[$0] }) else { continue }
            let (h1, m1) = (Int(group(1) ?? "") ?? -1, Int(group(2) ?? "0") ?? 0)
            let (h2, m2) = (Int(group(5) ?? "") ?? -1, Int(group(6) ?? "0") ?? 0)
            var half1 = group(3) ?? group(4)
            var half2 = group(7) ?? group(8)
            // Two bare numbers ("3-4") are a span only with a colon in one.
            if half1 == nil, half2 == nil, group(2) == nil, group(6) == nil { continue }
            // One half of the day said for both: "3-4pm", "9am-11". If that
            // would end before it starts, they're either side of noon:
            // "11-1pm", "9am-12".
            if half1 == nil, let said = half2 {
                half1 = said
                if let a = Self.minutes(h1, m1, half1), let b = Self.minutes(h2, m2, half2), a >= b {
                    half1 = said.lowercased().hasPrefix("p") ? "am" : "pm"
                }
            } else if half2 == nil, let said = half1 {
                half2 = said
                if let a = Self.minutes(h1, m1, half1), let b = Self.minutes(h2, m2, half2), b <= a {
                    half2 = said.lowercased().hasPrefix("a") ? "pm" : "am"
                }
            }
            guard let start = Self.minutes(h1, m1, half1), let end = Self.minutes(h2, m2, half2) else { continue }
            for at in range.location..<range.location + range.length { used[at] = true }
            return (start, end)
        }
        return nil
    }

    /// "3pm", "3:30", "at 3", "noon".
    mutating func time() -> Int? {
        if take(#"\b(?:at\s+)?noon\b"#) != nil { return 12 * 60 }
        if take(#"\b(?:at\s+)?midnight\b"#) != nil { return 0 }
        func number(_ text: String?) -> Int { text.flatMap { Int($0) } ?? 0 }
        if let found = take(#"(?:\bat\s+|@\s*|\b)(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm)|(a|p))\b"#),
           let minutes = Self.minutes(number(found[1]), number(found[2]), found[3] ?? found[4]) {
            return minutes
        }
        if let found = take(#"(?:\bat\s+|@\s*|\b)(\d{1,2}):(\d{2})\b"#), let minutes = Self.minutes(number(found[1]), number(found[2]), nil) {
            return minutes
        }
        if let found = take(#"\bat\s+(\d{1,2})\b(?!\s*(?:/|st\b|nd\b|rd\b|th\b|\d))"#), (1...12).contains(number(found[1])),
           let minutes = Self.minutes(number(found[1]), 0, nil) {
            return minutes
        }
        return nil
    }
}
