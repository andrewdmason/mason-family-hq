import Foundation

/// A made-up family week with no sign-in or network: `--demo`, for the
/// simulator and screenshots. `--me <first name>` chooses whose phone it is.
enum DemoCalendar {
    static let jenny = "jenny@demo.mason.io"
    static let andrew = "andrew@demo.mason.io"
    static let sebastian = "sebastian@demo.mason.io"
    static let oscar = "oscar@demo.mason.io"

    static var me: String {
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--me"), args.count > at + 1 {
            return "\(args[at + 1].lowercased())@demo.mason.io"
        }
        return sebastian
    }

    private static func id(_ n: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!
    }

    static func make(today: Day = .today()) -> CalendarSnapshot {
        var snapshot = CalendarSnapshot()
        snapshot.members = [
            Member(email: jenny, name: "Jenny Mason", role: .parent, color: "#db2777", primaryCalendarID: "jenny"),
            Member(email: andrew, name: "Andrew Mason", role: .owner, color: "#2563eb", primaryCalendarID: "andrew"),
            Member(email: sebastian, name: "Sebastian Mason", role: .kid, color: "#16a34a", primaryCalendarID: "sebastian"),
            Member(email: oscar, name: "Oscar Mason", role: .kid, color: "#d97706", primaryCalendarID: "oscar"),
        ]
        let fsb = CalSource(id: id(901), memberEmail: sebastian, sourceType: .teamsnap, teamName: "FSB 10U", teamsnapPlayerID: 7, nickname: "FSB", isActive: true)
        let school = CalSource(id: id(902), memberEmail: oscar, sourceType: .ics, nickname: "School", isActive: true)
        var sources = [fsb, school]
        for (n, email) in [jenny, andrew, sebastian, oscar].enumerated() {
            sources.append(CalSource(id: id(910 + n), memberEmail: email, sourceType: .google, googleCalendarID: email, isActive: true))
        }
        snapshot.sources = sources
        snapshot.logistics = Logistics(homeAddress: "2909 Avalon Ave, Berkeley, CA", bufferMinutes: 5)

        var next = 1
        func add(
            _ member: String, _ title: String, day offset: Int, _ from: Int, _ to: Int?, at location: String? = nil,
            source: CalSource? = nil, allDay: Bool = false, _ more: (inout CalEvent) -> Void = { _ in }
        ) -> UUID {
            let day = today.adding(days: offset)
            var event = CalEvent(
                id: id(next), memberEmail: member, sourceID: source?.id, title: title, location: location,
                start: allDay ? CalendarRules.allDayInstant(day) : day.at(minutes: from),
                end: allDay ? nil : to.map { day.at(minutes: $0) }, allDay: allDay,
                sourceType: source?.sourceType ?? .google
            )
            more(&event)
            next += 1
            snapshot.events.append(event)
            return event.id
        }
        func h(_ hour: Int, _ minute: Int = 0) -> Int { hour * 60 + minute }

        for offset in -7...10 {
            let weekday = today.adding(days: offset).weekdayIndex()
            let school = weekday < 5
            if school {
                _ = add(andrew, "Take kids to school", day: offset, h(7, 55), h(8, 10))
                _ = add(andrew, "CrossFit", day: offset, h(9), h(10), at: "CrossFit Oakland, 2500 Embarcadero") {
                    $0.rrule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
                    $0.recurringEventID = "demo-crossfit"
                }
                _ = add(sebastian, "School", day: offset, h(8, 20), h(15), at: "Park Day School")
                _ = add(oscar, "School", day: offset, h(8, 20), h(14, 30), at: "Park Day School", source: nil)
            }
            if weekday == 1 || weekday == 3 {
                _ = add(sebastian, "Guitar practice", day: offset, h(19), h(19, 30), at: "Home") {
                    $0.rrule = "FREQ=WEEKLY;BYDAY=TU,TH"
                    $0.recurringEventID = "demo-guitar"
                }
                _ = add(jenny, "Pilates", day: offset, h(12), h(13), at: "The Pilates Room")
            }
            if weekday == 2 {
                let practice = add(sebastian, "Practice: 10U Field Practice", day: offset, h(16, 45), h(18, 15), at: "College of Alameda, 555 Ralph Appezzato Pkwy", source: fsb) {
                    $0.teamsnapArrival = today.adding(days: offset).at(minutes: h(16, 30))
                    $0.teamsnapIsGame = false
                    $0.teamsnapRsvp = .going
                    $0.driveMinutes = 18
                }
                snapshot.duties[practice] = [.dropoff: .parent(andrew), .pickup: .caregiver("Marina")]
                _ = add(andrew, "Drop off Sebastian @ 4:30pm (18 min drive)", day: offset, h(16, 7), h(16, 43)) {
                    $0.driveSourceEventID = practice
                    $0.driveDuty = .dropoff
                }
                let ballers = add(oscar, "Ballers Field Practice", day: offset, h(17), h(19), at: "Bushrod Park, 560 59th St, Oakland")
                snapshot.duties[ballers] = [.dropoff: .notNeeded]
                _ = add(jenny, "Team lunch", day: offset, h(12), h(13), at: "Sequoia Diner")
                _ = add(jenny, "Design review", day: offset, h(12, 30), h(13, 30))
                let dinner = add(jenny, "Dinner with the Lees", day: offset, h(19), h(21), at: "Pizzaiolo, 5008 Telegraph Ave")
                snapshot.going[dinner] = [andrew]
            }
            if weekday == 4 {
                _ = add(oscar, "Swim lesson", day: offset, h(15, 30), h(16, 15), at: "Temescal Pool")
                _ = add(andrew, "Tutoring consultation", day: offset, h(13), h(13, 30))
            }
            if weekday == 5 {
                let game = add(sebastian, "Game vs Piedmont", day: offset, h(10), h(12), at: "Witter Field, Piedmont", source: fsb) {
                    $0.teamsnapArrival = today.adding(days: offset).at(minutes: h(9, 15))
                    $0.teamsnapIsGame = true
                    $0.teamsnapOpponent = "Piedmont"
                    $0.teamsnapRsvp = .noReply
                }
                snapshot.going[game] = [jenny, andrew, oscar]
                _ = add(oscar, "Max's birthday party", day: offset, h(14), h(16), at: "Studio Grow, Berkeley")
            }
            if weekday == 6 {
                _ = add(jenny, "Farmers market", day: offset, h(9, 30), h(10, 30), at: "Temescal Farmers Market")
            }
        }
        _ = add(oscar, "Minimum day", day: 0, 0, nil, source: school, allDay: true)
        _ = add(jenny, "Grandma visiting", day: 2, 0, nil, allDay: true)
        _ = add(sebastian, "Science fair", day: 5, 0, nil, allDay: true)
        snapshot.fetchedAt = Date()
        return snapshot
    }
}
