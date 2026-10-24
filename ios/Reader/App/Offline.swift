import Foundation
import UIKit
import WebKit

/// Keeps the books you're reading and the ones opened most recently on the
/// device, without your opening them.
///
/// The website already keeps any book you open (its text in the reader's
/// offline store, its page in the service worker's cache), so the app reuses
/// that rather than storing books its own way: an invisible web view loads the
/// website's /reader/keep-offline page with the books' ids, which downloads
/// each one and reports back ("readerApp" messages) which books are on the
/// device. Highlights, bookmarks and the notepad come with the page.
@MainActor
final class Offline: NSObject, WKScriptMessageHandler {
    static let shared = Offline()
    static let messageName = "readerApp"

    private var webView: WKWebView?
    private var lastRun: Date?
    private var lastIDs: [UUID] = []

    /// Runs at most every ten minutes, and again whenever the set of books
    /// changes.
    func keepRecentBooks() async {
        let books = ShelfOrder.keepOffline(ShelfStore.shared.books)
        let ids = books.map(\.id)
        guard !ids.isEmpty else { return }
        if ids == lastIDs, let lastRun, Date.now.timeIntervalSince(lastRun) < 600 { return }
        lastIDs = ids
        lastRun = .now

        let query = ids.map { $0.uuidString.lowercased() }.joined(separator: ",")
        let path = "/reader/keep-offline?ids=\(query)"
        let webView = self.webView ?? makeWebView()
        webView.load(await WebSignIn.request(for: path))
    }

    private func makeWebView() -> WKWebView {
        let webView = WebPool.makeWebView()
        // In the window (invisibly) so WebKit runs it as a live page.
        webView.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        webView.alpha = 0
        webView.isUserInteractionEnabled = false
        let window = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first
        window?.addSubview(webView)
        self.webView = webView
        return webView
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "offline",
              let ids = body["bookIds"] as? [String] else { return }
        let onDevice = Set(ids.compactMap(UUID.init(uuidString:)))
        MainActor.assumeIsolated {
            ShelfStore.shared.onDevice = onDevice
            // Done with the page; the next pass loads it again.
            webView?.removeFromSuperview()
            webView = nil
        }
    }
}
