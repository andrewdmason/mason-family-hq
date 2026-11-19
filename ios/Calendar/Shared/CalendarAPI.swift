import Foundation
import MasonKit

/// A change that didn't happen, in words fit to show.
enum CalendarProblem: LocalizedError, Equatable {
    /// The website couldn't be reached.
    case offline
    /// The website said no, and why.
    case refused(String)
    /// Google made the event itself (from an email) and won't have it
    /// changed. It can be swapped for an ordinary copy.
    case googleMade

    var errorDescription: String? {
        switch self {
        case .offline: "You're offline. Changes need a connection."
        case .refused(let why): why
        case .googleMade: "Google made this event from an email and won't let it be changed."
        }
    }
}

/// A place the location field suggests.
struct PlaceSuggestion: Identifiable, Hashable, Decodable, Sendable {
    var placeId: String
    var label: String
    var secondary: String?
    var location: String

    var id: String { placeId }
}

/// The website's side of the calendar: every change the app makes goes through
/// src/app/(calendar)/calendar/api/[action]/route.ts, which runs the same
/// mutations the website does (writing back to Google, drive blocks, TeamSnap)
/// with the keys the phone doesn't hold.
enum CalendarAPI {
    struct Reply: Decodable {
        var ok: Bool?
        var id: UUID?
        var warning: String?
        var error: String?
        var suggestions: [PlaceSuggestion]?
        /// Google made the event itself and refused the change.
        var convertible: Bool?
    }

    /// `--website <url>` points the app at another server, for the simulator.
    static var website: URL {
        let args = CommandLine.arguments
        if let at = args.firstIndex(of: "--website"), args.count > at + 1, let url = URL(string: args[at + 1]) {
            return url
        }
        return Config.website
    }

    @MainActor
    static func post(_ action: String, _ body: [String: Any] = [:], timeout: TimeInterval = 60) async throws -> Reply {
        let token: String
        do {
            token = try await Session.shared.client.auth.session.accessToken
        } catch {
            throw CalendarProblem.offline
        }
        var request = URLRequest(url: website.appending(path: "calendar/api/\(action)"))
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw CalendarProblem.offline
        }
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 500
        if reply?.error != nil, reply?.convertible == true { throw CalendarProblem.googleMade }
        guard (200..<300).contains(status), let reply, reply.error == nil else {
            throw CalendarProblem.refused(reply?.error ?? "That didn't go through. Try again.")
        }
        return reply
    }

    /// An event as the website's ManualEventInput. An all-day event is sent
    /// as midnight UTC of its date, with no end.
    static func body(_ draft: EventDraft, sourceID: UUID?, in calendar: Calendar = .current) -> [String: Any] {
        let start = draft.allDay ? CalendarRules.allDayInstant(Day(draft.start, in: calendar)) : draft.start
        func text(_ value: String) -> Any {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? NSNull() : trimmed
        }
        return [
            "calendarSourceId": sourceID.map { $0.uuidString.lowercased() as Any } ?? NSNull(),
            "memberEmail": draft.memberEmail,
            "title": draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            "location": text(draft.location),
            "description": text(draft.notes),
            "startTime": Instant.string(start),
            "endTime": draft.allDay ? NSNull() : Instant.string(draft.end) as Any,
            "allDay": draft.allDay,
        ]
    }

    static func body(_ state: DutyState?) -> Any {
        guard let state else { return NSNull() }
        return [
            "assignee": state.assignee as Any? ?? NSNull(),
            "isNa": state.isNa,
            "caregiver": state.caregiver as Any? ?? NSNull(),
        ] as [String: Any]
    }
}
