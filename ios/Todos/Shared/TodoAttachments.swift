import Foundation
import ImageIO
import Observation
import UniformTypeIdentifiers

// Files on a to-do. They live with the website's: the todo_task_attachments table
// and the todo-images bucket. Adding one is instant, like everything else in these
// apps: the file is copied in, shows on the to-do, and goes up in the background
// once the to-do itself has reached the database.

struct TodoAttachment: Codable, Identifiable, Equatable {
    let id: String
    let taskId: String
    let originalPath: String
    let displayPath: String?
    let kind: String
    let fileName: String?
    let mimeType: String?

    var isImage: Bool { kind == "image" }
}

struct PendingAttachment: Codable, Identifiable, Equatable {
    let id: String
    let taskId: String
    let fileName: String
    let mimeType: String?
    let isImage: Bool
    var attempts = 0
    /// Why it stopped trying. Nil while it's still on its way.
    var failure: String?
    /// False when there's nothing to send, as with a file over the limit.
    var canRetry = true
}

struct AttachmentRemoval: Codable, Equatable {
    let id: String
    let paths: [String]
}

/// One thing in a to-do's strip, whether it's up yet or not.
struct AttachmentItem: Identifiable, Equatable {
    enum Source: Equatable {
        case remote(TodoAttachment)
        case pending(PendingAttachment)
    }

    let source: Source

    var id: String {
        switch source {
        case .remote(let attachment): attachment.id
        case .pending(let pending): pending.id
        }
    }

    var name: String {
        switch source {
        case .remote(let attachment): attachment.fileName ?? "Attachment"
        case .pending(let pending): pending.fileName
        }
    }

    var isImage: Bool {
        switch source {
        case .remote(let attachment): attachment.isImage
        case .pending(let pending): pending.isImage
        }
    }

    var failure: String? {
        if case .pending(let pending) = source { pending.failure } else { nil }
    }

    var isUploading: Bool {
        if case .pending(let pending) = source { pending.failure == nil } else { false }
    }

    var canRetry: Bool {
        if case .pending(let pending) = source { pending.failure != nil && pending.canRetry } else { false }
    }
}

enum AttachmentRules {
    static let bucket = "todo-images"
    /// The bucket's own limit.
    static let maxBytes = 50 * 1024 * 1024
    static let maxDisplayEdge = 2000
    static let maxAttempts = 5
    private static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]

    static func fileExtension(_ name: String) -> String {
        guard name.contains(".") else { return "bin" }
        let cleaned = name.split(separator: ".").last.map { $0.lowercased().filter { $0.isLetter || $0.isNumber } } ?? ""
        return cleaned.isEmpty ? "bin" : String(cleaned)
    }

    static func isImage(name: String, mimeType: String?) -> Bool {
        if mimeType?.hasPrefix("image/") == true { return true }
        return imageExtensions.contains(fileExtension(name))
    }

    static func mimeType(forName name: String) -> String? {
        UTType(filenameExtension: fileExtension(name))?.preferredMIMEType
    }

    static func originalPath(_ pending: PendingAttachment) -> String {
        "\(pending.taskId)/\(pending.id)-original.\(fileExtension(pending.fileName))"
    }

    static func displayPath(_ pending: PendingAttachment) -> String {
        "\(pending.taskId)/\(pending.id)-display.jpg"
    }
}

enum AttachmentImaging {
    /// A smaller copy, the right way up. Nil when the format can't be read.
    static func downscaled(_ source: CGImageSource, maxEdge: Int) -> CGImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxEdge,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    static func thumbnail(of file: URL, maxEdge: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil) else { return nil }
        return downscaled(source, maxEdge: maxEdge)
    }

    /// The display copy the website makes too: at most 2000 points, as a JPEG. Falls
    /// back to the original bytes when the image can't be decoded, as it does there.
    static func displayCopy(of data: Data) -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int,
            let image = downscaled(source, maxEdge: min(max(width, height), AttachmentRules.maxDisplayEdge))
        else { return data }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return data }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? output as Data : data
    }
}

@MainActor
protocol AttachmentLoading: AnyObject {
    func downloadAttachment(path: String) async throws -> Data
}

private struct AttachmentFile: Codable {
    var attachments: [TodoAttachment] = []
    var pending: [PendingAttachment] = []
    var removals: [AttachmentRemoval] = []
}

@MainActor
@Observable
final class AttachmentStore {
    private(set) var remote: [TodoAttachment]
    private(set) var pending: [PendingAttachment]
    private(set) var removals: [AttachmentRemoval]

    @ObservationIgnored var onLocalChange: () -> Void = {}
    @ObservationIgnored weak var loader: AttachmentLoading?
    @ObservationIgnored private let stateFile: URL?
    @ObservationIgnored private let queueFolder: URL
    @ObservationIgnored private let cacheFolder: URL
    @ObservationIgnored private var downloads: [String: Task<URL?, Never>] = [:]

    /// With no folder, nothing outlives the app: for tests and dry runs.
    init(folder: URL?) {
        let temporary = FileManager.default.temporaryDirectory.appending(path: "todos-attachments-\(UUID().uuidString)")
        stateFile = folder?.appending(path: "attachments.json")
        queueFolder = folder?.appending(path: "attachment-queue") ?? temporary.appending(path: "queue")
        cacheFolder = folder == nil ? temporary.appending(path: "cache") : URL.cachesDirectory.appending(path: "io.mason.todos/attachments")
        var saved = AttachmentFile()
        if let stateFile, let data = try? Data(contentsOf: stateFile), let decoded = try? Self.decoder.decode(AttachmentFile.self, from: data) {
            saved = decoded
        }
        remote = saved.attachments
        pending = saved.pending
        removals = saved.removals
        for folder in [queueFolder, cacheFolder] {
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    private func save() {
        guard let stateFile else { return }
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        try? encoder.encode(AttachmentFile(attachments: remote, pending: pending, removals: removals)).write(to: stateFile, options: .atomic)
    }

    // MARK: What's on a to-do

    var byTask: [String: [AttachmentItem]] {
        let gone = Set(removals.map(\.id))
        var result: [String: [AttachmentItem]] = [:]
        for attachment in remote where !gone.contains(attachment.id) {
            result[attachment.taskId, default: []].append(AttachmentItem(source: .remote(attachment)))
        }
        for waiting in pending {
            result[waiting.taskId, default: []].append(AttachmentItem(source: .pending(waiting)))
        }
        return result
    }

    func items(for taskId: String) -> [AttachmentItem] { byTask[taskId] ?? [] }

    // MARK: Adding and removing

    func add(files: [URL], to taskId: String) {
        for file in files {
            let scoped = file.startAccessingSecurityScopedResource()
            defer { if scoped { file.stopAccessingSecurityScopedResource() } }
            let name = file.lastPathComponent
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
            guard size <= AttachmentRules.maxBytes else {
                refuse(name, to: taskId)
                continue
            }
            let item = make(name: name, mimeType: AttachmentRules.mimeType(forName: name), taskId: taskId)
            guard (try? FileManager.default.copyItem(at: file, to: queueFile(item))) != nil else { continue }
            pending.append(item)
        }
        changed()
    }

    func add(data: Data, fileName: String, mimeType: String?, to taskId: String) {
        guard data.count <= AttachmentRules.maxBytes else {
            refuse(fileName, to: taskId)
            changed()
            return
        }
        let item = make(name: fileName, mimeType: mimeType, taskId: taskId)
        guard (try? data.write(to: queueFile(item), options: .atomic)) != nil else { return }
        pending.append(item)
        changed()
    }

    private func make(name: String, mimeType: String?, taskId: String) -> PendingAttachment {
        PendingAttachment(
            id: UUID().uuidString.lowercased(), taskId: taskId, fileName: name, mimeType: mimeType,
            isImage: AttachmentRules.isImage(name: name, mimeType: mimeType))
    }

    private func refuse(_ name: String, to taskId: String) {
        var item = make(name: name, mimeType: nil, taskId: taskId)
        item.failure = "Over the 50 MB limit"
        item.canRetry = false
        pending.append(item)
    }

    private func changed() {
        save()
        onLocalChange()
    }

    private func queueFile(_ item: PendingAttachment) -> URL {
        queueFolder.appending(path: "\(item.id).\(AttachmentRules.fileExtension(item.fileName))")
    }

    func remove(_ item: AttachmentItem) {
        switch item.source {
        case .pending(let waiting):
            try? FileManager.default.removeItem(at: queueFile(waiting))
            pending.removeAll { $0.id == waiting.id }
        case .remote(let attachment):
            removals.append(AttachmentRemoval(id: attachment.id, paths: [attachment.originalPath, attachment.displayPath].compactMap { $0 }))
        }
        changed()
    }

    func retry(_ item: AttachmentItem) {
        guard item.canRetry, let index = pending.firstIndex(where: { $0.id == item.id }) else { return }
        pending[index].failure = nil
        pending[index].attempts = 0
        changed()
    }

    // MARK: For the sync

    /// Ready to go up: not failed, and its to-do is in the database.
    func uploadable(sentTaskIDs: Set<String>) -> [PendingAttachment] {
        pending.filter { $0.failure == nil && sentTaskIDs.contains($0.taskId) }
    }

    /// A to-do that's gone takes its waiting files with it.
    func dropOrphans(alive: Set<String>) {
        let orphans = pending.filter { !alive.contains($0.taskId) }
        guard !orphans.isEmpty else { return }
        for orphan in orphans { try? FileManager.default.removeItem(at: queueFile(orphan)) }
        pending.removeAll { !alive.contains($0.taskId) }
        save()
    }

    func queuedData(_ item: PendingAttachment) -> Data? {
        try? Data(contentsOf: queueFile(item))
    }

    /// It's up: keep what's here as the cached copy, so nothing downloads again.
    func uploaded(_ item: PendingAttachment, displayData: Data?) {
        let attachment = TodoAttachment(
            id: item.id, taskId: item.taskId, originalPath: AttachmentRules.originalPath(item),
            displayPath: item.isImage ? AttachmentRules.displayPath(item) : nil,
            kind: item.isImage ? "image" : "file", fileName: item.fileName, mimeType: item.mimeType)
        let manager = FileManager.default
        let original = originalCacheFile(attachment)
        try? manager.createDirectory(at: original.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? manager.removeItem(at: original)
        try? manager.moveItem(at: queueFile(item), to: original)
        if let displayData { try? displayData.write(to: displayCacheFile(attachment), options: .atomic) }
        pending.removeAll { $0.id == item.id }
        remote.append(attachment)
        save()
    }

    /// One more failed try. `permanent` is when trying again can't help.
    func uploadFailed(_ item: PendingAttachment, permanent: Bool, reason: String) {
        guard let index = pending.firstIndex(where: { $0.id == item.id }) else { return }
        pending[index].attempts += 1
        if permanent || pending[index].attempts >= AttachmentRules.maxAttempts {
            pending[index].failure = reason
            save()
        }
    }

    func removalSent(_ id: String) {
        removals.removeAll { $0.id == id }
        remote.removeAll { $0.id == id }
        save()
    }

    func applyServer(_ rows: [TodoAttachment]) {
        guard rows != remote else { return }
        remote = rows
        save()
    }

    // MARK: Files

    private func displayCacheFile(_ attachment: TodoAttachment) -> URL {
        cacheFolder.appending(path: "\(attachment.id)-display.jpg")
    }

    private func originalCacheFile(_ attachment: TodoAttachment) -> URL {
        let name = (attachment.fileName ?? "Attachment").replacingOccurrences(of: "/", with: "-")
        return cacheFolder.appending(path: attachment.id).appending(path: name)
    }

    /// For thumbnails. Nil when it can't be had right now.
    func previewFile(_ item: AttachmentItem) async -> URL? {
        switch item.source {
        case .pending(let waiting):
            return queueFile(waiting)
        case .remote(let attachment):
            let path = attachment.displayPath ?? attachment.originalPath
            return await fetch(path: path, to: attachment.displayPath == nil ? originalCacheFile(attachment) : displayCacheFile(attachment))
        }
    }

    /// The real file, for opening.
    func originalFile(_ item: AttachmentItem) async -> URL? {
        switch item.source {
        case .pending(let waiting):
            return queueFile(waiting)
        case .remote(let attachment):
            return await fetch(path: attachment.originalPath, to: originalCacheFile(attachment))
        }
    }

    private func fetch(path: String, to file: URL) async -> URL? {
        if FileManager.default.fileExists(atPath: file.path) { return file }
        if let running = downloads[path] { return await running.value }
        let task = Task<URL?, Never> { [weak self] in
            guard let data = try? await self?.loader?.downloadAttachment(path: path) else { return nil }
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            return (try? data.write(to: file, options: .atomic)) == nil ? nil : file
        }
        downloads[path] = task
        let result = await task.value
        downloads[path] = nil
        return result
    }
}
