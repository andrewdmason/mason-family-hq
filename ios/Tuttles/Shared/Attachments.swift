import PDFKit
#if os(iOS)
import PhotosUI
#endif
import QuickLook
import Supabase
import SwiftUI
import UniformTypeIdentifiers

/// A PDF for the next message or a study set (a handout, a study guide),
/// before and after it's sent. The tutor gets the PDF itself
/// (src/lib/tuttles/files.ts on the website).
struct ChatFile: Identifiable, Equatable {
    let id: UUID
    let name: String
    let pages: Int?
    /// The PDF, for one picked on this phone.
    var data: Data?
    /// Where it is in the tuttles bucket, for one loaded from the server.
    var path: String?

    /// Every file in a chat goes to the tutor with every turn, so a long one
    /// is turned away rather than read in part.
    static let maxPages = 30
    static let maxBytes = 20 * 1024 * 1024
    /// How many a message or a set's material takes at once.
    static let maxAtOnce = 4

    enum Problem: LocalizedError, Equatable {
        case tooLong, locked, unreadable, tooMany
        var errorDescription: String? {
            switch self {
            case .tooLong: "That one's too long for me. Send just the pages you need."
            case .locked: "That PDF is locked with a password, so I can't read it."
            case .unreadable: "I can't read that kind of file. Try a PDF or a picture."
            case .tooMany: "Four files at a time is the most I can take."
            }
        }
    }

    /// A PDF picked on the phone, if the tutor can take it.
    init(name: String, pdf data: Data) throws {
        guard let document = PDFDocument(data: data) else { throw Problem.unreadable }
        if document.isLocked { throw Problem.locked }
        guard document.pageCount > 0 else { throw Problem.unreadable }
        guard document.pageCount <= Self.maxPages, data.count <= Self.maxBytes else { throw Problem.tooLong }
        id = UUID()
        self.name = name.lowercased().hasSuffix(".pdf") ? name : "\(name).pdf"
        pages = document.pageCount
        self.data = data
    }

    /// One sent earlier, as the server has it.
    init(path: String, name: String, pages: Int?) {
        id = UUID()
        self.name = name
        self.pages = pages
        self.path = path
    }

    /// "PDF · 3 pages"
    var detail: String {
        guard let pages else { return "PDF" }
        return "PDF · \(pages) page\(pages == 1 ? "" : "s")"
    }
}

/// Something picked in Files: a picture becomes a photo like any other, a PDF a file.
enum PickedFile {
    case photo(ChatPhoto)
    case file(ChatFile)

    init(name: String, type: UTType?, data: Data) throws {
        if type?.conforms(to: .pdf) == true || (type == nil && data.starts(with: Data("%PDF".utf8))) {
            self = .file(try ChatFile(name: name, pdf: data))
        } else if let image = PlatformImage(data: data), let photo = ChatPhoto(image) {
            self = .photo(photo)
        } else {
            throw ChatFile.Problem.unreadable
        }
    }

    /// Reads a file the Files picker handed over.
    init(contentsOf url: URL) throws {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { throw ChatFile.Problem.unreadable }
        try self.init(name: url.lastPathComponent, type: UTType(filenameExtension: url.pathExtension), data: data)
    }
}

/// The + beside a message or on a form: take pictures, pick ones already
/// taken, or attach a file. What's chosen lands in `photos` and `files`.
struct AttachMenu<Label: View>: View {
    @Binding var photos: [ChatPhoto]
    @Binding var files: [ChatFile]
    /// Before a picker opens (the keyboard steps aside).
    var onOpen: () -> Void = {}
    /// After something was added.
    var onAdded: () -> Void = {}
    /// A file that couldn't be taken, in words for the kid; nil clears it.
    var onProblem: (String?) -> Void = { _ in }
    @ViewBuilder var label: () -> Label

    @State private var showingFiles = false
    #if os(iOS)
    @State private var showingCamera = false
    @State private var showingLibrary = false
    @State private var libraryPicks: [PhotosPickerItem] = []

    var body: some View {
        Menu {
            Button("Camera", systemImage: "camera") { open { showingCamera = true } }
            Button("Photos", systemImage: "photo.on.rectangle") { open { showingLibrary = true } }
            Button("Files", systemImage: "folder") { open { showingFiles = true } }
        } label: {
            label()
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraView { taken in
                photos.append(contentsOf: taken)
                if !taken.isEmpty { onAdded() }
            }
        }
        .photosPicker(isPresented: $showingLibrary, selection: $libraryPicks, maxSelectionCount: 12, matching: .images)
        .onChange(of: libraryPicks) { _, picks in
            guard !picks.isEmpty else { return }
            libraryPicks = []
            Task {
                for pick in picks {
                    if let data = try? await pick.loadTransferable(type: Data.self),
                       let image = PlatformImage(data: data), let photo = ChatPhoto(image) {
                        photos.append(photo)
                    }
                }
                onAdded()
            }
        }
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            add(urls)
        }
    }
    #else
    // The Mac has no camera to hold up to the page: the + picks files, and
    // anything can be dragged or pasted in as well (Mac/MacChatView.swift).
    var body: some View {
        Button { open { showingFiles = true } } label: { label() }
            .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { result in
                guard case .success(let urls) = result else { return }
                add(urls)
            }
    }
    #endif

    private func open(_ show: () -> Void) {
        onProblem(nil)
        onOpen()
        show()
    }

    private func add(_ urls: [URL]) {
        let (added, problem) = PickedFile.add(urls.map { url in { try PickedFile(contentsOf: url) } }, photos: &photos, files: &files)
        if let problem { onProblem(problem.localizedDescription) }
        if added { onAdded() }
    }
}

extension PickedFile {
    /// Reads each thing picked, dropped or pasted into the photos and files
    /// waiting to be sent. Says whether anything went in, and the first thing
    /// wrong with what didn't.
    static func add(
        _ picks: [() throws -> PickedFile], photos: inout [ChatPhoto], files: inout [ChatFile]
    ) -> (added: Bool, problem: ChatFile.Problem?) {
        var problem: ChatFile.Problem?
        var added = false
        for pick in picks {
            do {
                switch try pick() {
                case .photo(let photo):
                    photos.append(photo)
                    added = true
                case .file(let file):
                    guard files.count < ChatFile.maxAtOnce else { throw ChatFile.Problem.tooMany }
                    files.append(file)
                    added = true
                }
            } catch {
                problem = problem ?? (error as? ChatFile.Problem) ?? .unreadable
            }
        }
        return (added, problem)
    }
}

/// A file as it shows in the message box, a bubble or a form: its name and
/// how long it is, with an × where it can still be taken off.
struct FileChip: View {
    let file: ChatFile
    var onRemove: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.text.fill")
                .font(.title2)
                .foregroundStyle(TuttlesLook.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(file.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: 220, alignment: .leading)
        .background(Color.tuttlesFill, in: .rect(cornerRadius: 14))
        .overlay(alignment: .topTrailing) {
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.55))
                }
                .offset(x: 5, y: -5)
                .accessibilityLabel("Remove \(file.name)")
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A sent file: tap to open it.
struct FileButton: View {
    let file: ChatFile
    @Environment(ChatStore.self) private var store
    @State private var opening = false
    @State private var preview: URL?

    var body: some View {
        Button {
            guard !opening else { return }
            opening = true
            Task {
                preview = await store.localURL(for: file)
                opening = false
            }
        } label: {
            FileChip(file: file).opacity(opening ? 0.5 : 1)
        }
        .buttonStyle(.plain)
        .quickLookPreview($preview)
        .accessibilityHint("Opens the file")
    }
}

extension ChatStore {
    /// Uploads files into `folder` of the tuttles bucket, returning what the
    /// website is told about each. A failed upload isn't the last word (a
    /// retry re-uploads what already went): the website says what's missing.
    func upload(_ files: [ChatFile], to folder: String) async -> (sent: [[String: Any]], failed: Bool) {
        var sent: [[String: Any]] = []
        var failed = false
        for file in files {
            let path = file.path ?? "\(folder)/\(file.id.uuidString.lowercased()).pdf"
            if let data = file.data {
                do {
                    _ = try await client.storage.from("tuttles")
                        .upload(path, data: data, options: FileOptions(contentType: "application/pdf", upsert: true))
                } catch {
                    failed = true
                }
            }
            var entry: [String: Any] = ["path": path, "name": file.name]
            if let pages = file.pages { entry["pages"] = pages }
            sent.append(entry)
        }
        return (sent, failed)
    }

    /// The file on this phone, to open: written out from what was picked, or
    /// fetched from the bucket. Nil if it can't be had.
    func localURL(for file: ChatFile) async -> URL? {
        let folder = URL.temporaryDirectory.appending(path: "tuttles-files/\(file.id.uuidString.lowercased())")
        let url = folder.appending(path: file.name.replacingOccurrences(of: "/", with: "-"))
        if FileManager.default.fileExists(atPath: url.path) { return url }
        var data = file.data
        if data == nil, !isDemo, let path = file.path {
            data = try? await client.storage.from("tuttles").download(path: path)
        }
        guard let data else { return nil }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return (try? data.write(to: url, options: .atomic)) != nil ? url : nil
    }
}
