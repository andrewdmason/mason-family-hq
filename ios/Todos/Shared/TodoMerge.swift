import Foundation

// How the list on this device and the family database stay in step, with no
// network code here so it can be tested. Alongside the list, the device keeps a
// copy of what the database last said (the base). Comparing the three settles
// everything, field by field:
//
// - Local differs from base: that's a change made here, still to be sent.
// - Server differs from base: that's a change made elsewhere, to be taken, unless
//   the same field was also changed here, which wins until it's sent.
//
// Nothing needs logging as it happens, so undo, a crash or a day offline all come
// out right: whatever differs when there's next a connection is what gets sent.

enum SyncValue: Equatable {
    case text(String)
    case number(Double)
    case null

    init(_ text: String?) {
        self = text.map { .text($0) } ?? .null
    }

    var string: String? {
        if case .text(let text) = self { text } else { nil }
    }

    var double: Double? {
        if case .number(let number) = self { number } else { nil }
    }
}

/// A record as columns of its table. What belongs to this device only, like whether
/// a project group is collapsed, is left out.
protocol SyncRecord: Identifiable where ID == String {
    var syncFields: [String: SyncValue] { get }
    mutating func setSyncField(_ name: String, to value: SyncValue)
}

extension Todo: SyncRecord {
    var syncFields: [String: SyncValue] {
        [
            "title": .text(title), "notes": SyncValue(notes), "bucket": .text(bucket.rawValue),
            "assignee_email": .text(assigneeEmail), "creator_email": .text(creatorEmail),
            "project_id": SyncValue(projectId), "section_id": SyncValue(sectionId),
            "snoozed_until": SyncValue(snoozedUntil), "completed_at": SyncValue(completedAt),
            "sort_order": .number(sortOrder), "created_at": .text(createdAt),
        ]
    }

    mutating func setSyncField(_ name: String, to value: SyncValue) {
        switch name {
        case "title": title = value.string ?? title
        case "notes": notes = value.string
        case "bucket": bucket = value.string.flatMap(Bucket.init(rawValue:)) ?? bucket
        case "assignee_email": assigneeEmail = value.string ?? assigneeEmail
        case "creator_email": creatorEmail = value.string ?? creatorEmail
        case "project_id": projectId = value.string
        case "section_id": sectionId = value.string
        case "snoozed_until": snoozedUntil = value.string
        case "completed_at": completedAt = value.string
        case "sort_order": sortOrder = value.double ?? sortOrder
        case "created_at": createdAt = value.string ?? createdAt
        default: break
        }
    }
}

extension TodoProject: SyncRecord {
    var syncFields: [String: SyncValue] {
        ["name": .text(name), "sort_order": .number(sortOrder), "area_id": SyncValue(areaId)]
    }

    mutating func setSyncField(_ name: String, to value: SyncValue) {
        switch name {
        case "name": self.name = value.string ?? self.name
        case "sort_order": sortOrder = value.double ?? sortOrder
        case "area_id": areaId = value.string
        default: break
        }
    }
}

extension TodoSection: SyncRecord {
    var syncFields: [String: SyncValue] {
        ["project_id": .text(projectId), "name": .text(name), "sort_order": .number(sortOrder)]
    }

    mutating func setSyncField(_ name: String, to value: SyncValue) {
        switch name {
        case "project_id": projectId = value.string ?? projectId
        case "name": self.name = value.string ?? self.name
        case "sort_order": sortOrder = value.double ?? sortOrder
        default: break
        }
    }
}

extension TodoArea: SyncRecord {
    var syncFields: [String: SyncValue] {
        ["name": .text(name), "sort_order": .number(sortOrder)]
    }

    mutating func setSyncField(_ name: String, to value: SyncValue) {
        switch name {
        case "name": self.name = value.string ?? self.name
        case "sort_order": sortOrder = value.double ?? sortOrder
        default: break
        }
    }
}

/// What this device has to send for one table.
struct SyncChanges: Equatable {
    var inserts: [String: [String: SyncValue]] = [:]
    var updates: [String: [String: SyncValue]] = [:]
    var deletes: [String] = []

    var isEmpty: Bool { inserts.isEmpty && updates.isEmpty && deletes.isEmpty }
}

enum TodoMerge {
    /// Local against base. `isReady` holds back what's still being typed.
    static func changes<R: SyncRecord>(local: [R], base: [R], isReady: (R) -> Bool) -> SyncChanges {
        var result = SyncChanges()
        let bases = Dictionary(base.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let localIDs = Set(local.map(\.id))
        for record in local where isReady(record) {
            guard let known = bases[record.id] else {
                result.inserts[record.id] = record.syncFields
                continue
            }
            let before = known.syncFields
            let edited = record.syncFields.filter { before[$0.key] != $0.value }
            if !edited.isEmpty { result.updates[record.id] = edited }
        }
        result.deletes = base.map(\.id).filter { !localIDs.contains($0) }
        return result
    }

    /// Takes in what the database says. Returns the new local list and base, and
    /// whether anything on screen changed.
    static func merge<R: SyncRecord>(local: [R], base: [R], server: [R]) -> (local: [R], base: [R], changed: Bool) {
        let bases = Dictionary(base.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let serverIDs = Set(server.map(\.id))
        var changed = false

        // Gone from the database: deleted elsewhere, which wins over any edit here.
        var merged = local.filter { record in
            guard bases[record.id] != nil, !serverIDs.contains(record.id) else { return true }
            changed = true
            return false
        }
        var positions = Dictionary(merged.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })

        for remote in server {
            let known = bases[remote.id]
            guard let position = positions[remote.id] else {
                // Not here. With a base, that's a delete still to be sent.
                if known == nil {
                    positions[remote.id] = merged.count
                    merged.append(remote)
                    changed = true
                }
                continue
            }
            let before = known?.syncFields
            let current = merged[position].syncFields
            for (name, value) in remote.syncFields where current[name] != value {
                if let before, before[name] != current[name] { continue }  // Changed here too.
                merged[position].setSyncField(name, to: value)
                changed = true
            }
        }
        return (merged, server, changed)
    }

    /// For a device's first sync, when its list is the one that's right: the base
    /// becomes what the database says about everything this device has or had, so
    /// every difference reads as a change made here and gets sent. Records the device
    /// has never seen are left out, so they arrive. `claimAll` includes those too,
    /// which sends their removal instead.
    static func adoptLocal<R: SyncRecord>(local: [R], base: [R], server: [R], claimAll: Bool = false) -> [R] {
        let known = Set(local.map(\.id)).union(base.map(\.id))
        return server.filter { claimAll || known.contains($0.id) }
    }

    /// The base after one record has been sent.
    static func markSent<R: SyncRecord>(_ id: String, fields: [String: SyncValue], local: [R], base: inout [R]) {
        if let index = base.firstIndex(where: { $0.id == id }) {
            for (name, value) in fields { base[index].setSyncField(name, to: value) }
        } else if let record = local.first(where: { $0.id == id }) {
            base.append(record)
        }
    }

    /// A signed-out or expired connection reads as an empty database rather than an
    /// error, and a damaged file reads as an empty list. Either would otherwise wipe
    /// out the other side, so a sudden loss of most of a list stops the sync.
    static func looksSafe(before: Int, after: Int) -> Bool {
        before < 20 || after * 2 >= before
    }

    // MARK: Timestamps

    /// The form this app writes, so the database's fractions of a second don't read
    /// as a change.
    static func canonicalStamp(_ stamp: String) -> String {
        var plain = stamp
        if let dot = stamp.firstIndex(of: "."),
            let end = stamp[dot...].firstIndex(where: { $0 == "+" || $0 == "-" || $0 == "Z" }) {
            plain.removeSubrange(dot..<end)
        }
        guard let date = ISO8601DateFormatter().date(from: plain) else { return stamp }
        return date.formatted(.iso8601)
    }

    // MARK: Notes

    /// The website stores notes as HTML; here they're plain text. Formatting only
    /// changes on the website if the note is edited here.
    static func plainNotes(fromHTML html: String?) -> String? {
        guard var text = html, !text.isEmpty else { return nil }
        // A link keeps its address, even when it shows other words.
        if let regex = try? NSRegularExpression(pattern: #"<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#, options: .dotMatchesLineSeparators) {
            let nsText = text as NSString
            var rebuilt = ""
            var cursor = 0
            for match in regex.matches(in: text, range: NSRange(location: 0, length: nsText.length)) {
                rebuilt += nsText.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
                let href = nsText.substring(with: match.range(at: 1))
                let shown = nsText.substring(with: match.range(at: 2))
                let words = shown.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
                rebuilt += words == href ? href : "\(words) (\(href))"
                cursor = match.range.location + match.range.length
            }
            text = rebuilt + nsText.substring(from: cursor)
        }
        text = text.replacingOccurrences(of: #"<br\s*/?>"#, with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: #"</(p|li|h[1-6]|blockquote)>"#, with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        for (entity, character) in [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&nbsp;", " "), ("&amp;", "&")] {
            text = text.replacingOccurrences(of: entity, with: character)
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// One paragraph per line, like the website's own plain-text notes, with web
    /// addresses as links. Everything else is escaped.
    static func notesHTML(fromPlain plain: String?) -> String? {
        guard let plain else { return nil }
        let lines = plain.components(separatedBy: .newlines).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !lines.isEmpty else { return nil }
        return lines.map { line in
            let escaped = line.replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
                .replacingOccurrences(of: "\"", with: "&quot;")
            let linked = escaped.replacingOccurrences(
                of: #"https?://[^\s]+"#, with: "<a href=\"$0\">$0</a>", options: .regularExpression)
            return "<p>\(linked)</p>"
        }.joined()
    }
}

// MARK: - The database's rows

struct ServerTodo: Decodable {
    let id: String
    let title: String
    let notesHtml: String?
    let bucket: Bucket
    let assigneeEmail: String
    let creatorEmail: String
    let projectId: String?
    let sectionId: String?
    let snoozedUntil: String?
    let completedAt: String?
    let sortOrder: Double
    let createdAt: String

    var todo: Todo {
        Todo(
            id: id, title: title, notes: TodoMerge.plainNotes(fromHTML: notesHtml), bucket: bucket,
            assigneeEmail: assigneeEmail, creatorEmail: creatorEmail, projectId: projectId, sectionId: sectionId,
            snoozedUntil: snoozedUntil.map(TodoMerge.canonicalStamp), completedAt: completedAt.map(TodoMerge.canonicalStamp),
            sortOrder: sortOrder, createdAt: TodoMerge.canonicalStamp(createdAt))
    }
}

extension TodoMerge {
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}
