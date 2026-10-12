import UIKit
import UniformTypeIdentifiers

/// "Baseball Clips" in the share sheet: takes a video shared from GameChanger
/// (or Photos), drops it in the app group's Inbox, and opens Clips Camera,
/// which picks it up and opens the trimmer. If the app can't be opened from
/// here, it's waiting there the next time Clips Camera opens.
final class ShareViewController: UIViewController {
    private static let group = "group.io.mason.clipscamera"
    private static let openURL = URL(string: "io.mason.clipscamera://import")!

    private let label = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        label.text = "Opening in Baseball Clips…"
        label.font = .preferredFont(forTextStyle: .headline)
        label.textAlignment = .center
        label.numberOfLines = 0
        spinner.startAnimating()
        let stack = UIStackView(arrangedSubviews: [spinner, label])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        Task { await receive() }
    }

    private func receive() async {
        do {
            try await copySharedVideo()
            if open(Self.openURL) {
                extensionContext?.completeRequest(returningItems: nil)
            } else {
                finish("Saved. Open Clips Camera to trim it.")
            }
        } catch {
            finish(error.localizedDescription)
        }
    }

    /// The first video attachment, copied into the Inbox. Takes a video
    /// shared as a video, as a file, or as a link straight to a video file.
    @discardableResult
    private func copySharedVideo() async throws -> URL {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        guard let inbox = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.group)?
            .appendingPathComponent("Inbox", isDirectory: true) else {
            throw ShareError("Clips Camera's shared folder isn't available.")
        }
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)

        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }) {
            return try await copyMovie(provider, into: inbox)
        }
        // A file or a link: fine if it's a video file.
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            guard let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
                  Self.isVideo(url) else { continue }
            let dest = inbox.appendingPathComponent("\(UUID().uuidString).\(url.pathExtension.lowercased())")
            if url.isFileURL {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                try FileManager.default.copyItem(at: url, to: dest)
            } else {
                label.text = "Downloading the video…"
                let (file, _) = try await URLSession.shared.download(from: url)
                try FileManager.default.moveItem(at: file, to: dest)
            }
            return dest
        }
        throw ShareError("That isn't a video Clips Camera can open.")
    }

    private func copyMovie(_ provider: NSItemProvider, into inbox: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { done in
            _ = provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { file, error in
                // The file is only there until this returns, so copy it now.
                guard let file else {
                    done.resume(throwing: error ?? ShareError("Couldn't read the video."))
                    return
                }
                let ext = file.pathExtension.isEmpty ? "mp4" : file.pathExtension
                let dest = inbox.appendingPathComponent("\(UUID().uuidString).\(ext)")
                do {
                    try FileManager.default.copyItem(at: file, to: dest)
                    done.resume(returning: dest)
                } catch {
                    done.resume(throwing: error)
                }
            }
        }
    }

    private static func isVideo(_ url: URL) -> Bool {
        UTType(filenameExtension: url.pathExtension)?.conforms(to: .movie) ?? false
    }

    /// Share extensions aren't given a way to open their app; the app object
    /// is up the responder chain, and asking it works.
    private func open(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                return true
            }
            responder = r.next
        }
        return false
    }

    private func finish(_ message: String) {
        spinner.stopAnimating()
        label.text = message
        Task {
            try? await Task.sleep(for: .seconds(2))
            extensionContext?.completeRequest(returningItems: nil)
        }
    }
}

private struct ShareError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
