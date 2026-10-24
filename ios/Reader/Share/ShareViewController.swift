import MasonKit
import Supabase
import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// Reader in the Share menu. A web page is saved as an article, extracted the
/// way the Chrome extension does it (GetArticle.js, built from extension/); an
/// EPUB is added to the shelf and converted, the way adding a book's file on
/// the website does it. Says "Saved to Reader" and closes, without opening
/// the app.
final class ShareViewController: UIViewController {
    private let model = ShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareView(model: model) { [weak self] in self?.done() })
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.view.backgroundColor = .clear
        view.addSubview(host.view)
        host.didMove(toParent: self)

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        Task {
            await model.save(items.flatMap { $0.attachments ?? [] })
            try? await Task.sleep(for: .seconds(model.failed ? 2.5 : 1))
            done()
        }
    }

    private func done() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}

struct ShareView: View {
    let model: ShareModel
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            if model.working {
                ProgressView()
            } else {
                Image(systemName: model.failed ? "exclamationmark.triangle" : "checkmark.circle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(model.failed ? .orange : Theme.accent)
            }
            Text(model.message).font(.headline).multilineTextAlignment(.center)
        }
        .padding(28)
        .frame(maxWidth: 320)
        .background(.regularMaterial, in: .rect(cornerRadius: 20))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture(perform: onClose)
    }
}

@MainActor
@Observable
final class ShareModel {
    var working = true
    var failed = false
    var message = "Saving to Reader…"

    private static let epub = UTType("org.idpf.epub-container") ?? .data

    func save(_ attachments: [NSItemProvider]) async {
        do {
            guard (try? await Session.shared.client.auth.session) != nil else {
                throw ShareError("Open Reader and sign in first.")
            }
            if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(Self.epub.identifier) }) {
                message = "Adding the book…"
                try await BookUpload.add(try await Self.file(from: provider))
                finish("Added to Reader")
            } else if let article = try await Self.article(from: attachments) {
                try await ArticleSave.save(article)
                finish("Saved to Reader")
            } else {
                throw ShareError("Reader saves web pages and EPUB books.")
            }
        } catch {
            failed = true
            finish((error as? ShareError)?.message ?? "Couldn't save to Reader. Try again.")
        }
    }

    private func finish(_ text: String) {
        working = false
        message = text
    }

    /// The shared EPUB, copied somewhere it outlives the provider's callback.
    private static func file(from provider: NSItemProvider) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadFileRepresentation(for: epub, openInPlace: false) { url, _, error in
                guard let url else {
                    return continuation.resume(throwing: error ?? ShareError("Couldn't read that book."))
                }
                let copy = FileManager.default.temporaryDirectory.appending(path: url.lastPathComponent)
                try? FileManager.default.removeItem(at: copy)
                do {
                    try FileManager.default.copyItem(at: url, to: copy)
                    continuation.resume(returning: copy)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Safari hands over the page as extracted by GetArticle.js; anything else
    /// shares a link, which is loaded and extracted here.
    private static func article(from attachments: [NSItemProvider]) async throws -> [String: Any]? {
        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) }),
           let item = try? await provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier) as? [String: Any],
           let results = item[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any],
           let article = results["article"] as? [String: Any], article["content"] as? String != nil {
            return article
        }
        guard let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }),
              let url = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
              ["http", "https"].contains(url.scheme) else { return nil }
        return try await PageExtractor().extract(url)
    }
}

struct ShareError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

/// Loads a shared link in an offscreen web view and runs the extractor on it.
@MainActor
final class PageExtractor: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Error>?

    func extract(_ url: URL) async throws -> [String: Any] {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        if let path = Bundle.main.path(forResource: "GetArticle", ofType: "js"),
           let source = try? String(contentsOfFile: path, encoding: .utf8) {
            configuration.userContentController.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            )
        }
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1024, height: 1366), configuration: configuration)
        webView.navigationDelegate = self
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            webView.load(URLRequest(url: url, timeoutInterval: 20))
        }
        let result = try await webView.evaluateJavaScript("window.__masonExtract && window.__masonExtract()")
        guard let article = result as? [String: Any], article["content"] as? String != nil else {
            throw ShareError("No article found on that page.")
        }
        return article
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        continuation?.resume()
        continuation = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

/// The website's article ingest (the Chrome extension's endpoint), signed in
/// with the app's session.
@MainActor
enum ArticleSave {
    static func save(_ article: [String: Any]) async throws {
        let token = try await Session.shared.client.auth.session.accessToken
        var request = URLRequest(url: Config.website.appending(path: "api/reading/ingest"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "url": article["url"] ?? NSNull(),
            "title": article["title"] ?? NSNull(),
            "author": article["byline"] ?? NSNull(),
            "siteName": article["siteName"] ?? NSNull(),
            "excerpt": article["excerpt"] ?? NSNull(),
            "coverImageUrl": article["leadImageUrl"] ?? NSNull(),
            "html": article["content"] ?? "",
        ])
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) else {
            throw ShareError("Reader couldn't save that page.")
        }
    }
}

/// An EPUB onto the shelf: a book row (in the Queue, named after the file
/// until conversion reads the book's own title), the file in its storage
/// folder, then conversion on the website, which carries on after this closes.
@MainActor
enum BookUpload {
    static func add(_ file: URL) async throws {
        let db = Session.shared.client
        let session = try await db.auth.session
        let user = session.user.id.uuidString.lowercased()
        let bookID = UUID().uuidString.lowercased()
        let title = file.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "_", with: " ")

        struct Book: Encodable { let id, user_id, title, status: String; let current_page: Int }
        try await db.from("reading_books")
            .insert(Book(id: bookID, user_id: user, title: title, status: "queued", current_page: 0))
            .execute()

        let path = "\(user)/\(bookID)/source.epub"
        try await db.storage.from("reading-books").upload(
            path,
            data: try Data(contentsOf: file),
            options: FileOptions(contentType: "application/epub+zip", upsert: true)
        )

        struct Content: Encodable {
            let book_id, user_id, source_format, source_path, status: String
            let has_real_pages: Bool
        }
        try await db.from("reading_book_content")
            .upsert(Content(book_id: bookID, user_id: user, source_format: "epub", source_path: path,
                            status: "processing", has_real_pages: false),
                    onConflict: "book_id")
            .execute()

        // Conversion takes up to a few minutes; a background session sends it
        // even after the share sheet has closed.
        var request = URLRequest(url: Config.website.appending(path: "reader/api/convert"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        let body = FileManager.default.temporaryDirectory.appending(path: "convert-\(bookID).json")
        try JSONSerialization.data(withJSONObject: ["bookId": bookID, "titleFromFile": true]).write(to: body)
        let configuration = URLSessionConfiguration.background(withIdentifier: "io.mason.reader.share.convert.\(bookID)")
        configuration.sharedContainerIdentifier = "group.io.mason.reader"
        URLSession(configuration: configuration).uploadTask(with: request, fromFile: body).resume()
    }
}
