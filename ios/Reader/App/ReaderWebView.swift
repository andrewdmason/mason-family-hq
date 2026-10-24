import SafariServices
import SwiftUI
import WebKit

/// The website inside the app. Two kinds of web view share one configuration
/// (one cookie store, so one website sign-in) with family.mason.io as an
/// app-bound domain, which is what lets the website's service worker, and so
/// its offline copies of books, run in the app:
///
/// - the reading screen: one web view kept for the life of the app
///   (ReadingWeb), so the read-aloud carries on while you're on the shelf and
///   reopening a book is instant;
/// - the Reader pages that stay web (add a book, Discover, settings): a fresh
///   web view each time (PageWebView).
@MainActor
enum WebPool {
    static func configuration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // Required for the service worker (Info.plist WKAppBoundDomains).
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // Lets the website tell it's inside the app (src/lib/reading/reader-app.ts).
        configuration.applicationNameForUserAgent = "MasonReaderApp/1"
        let scripts = configuration.userContentController
        scripts.add(WeakHandler(AudioBridge.shared), name: AudioBridge.messageName)
        scripts.add(WeakHandler(Offline.shared), name: Offline.messageName)
        return configuration
    }

    static func makeWebView() -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: configuration())
        webView.allowsBackForwardNavigationGestures = false
        webView.isInspectable = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        return webView
    }
}

/// WKUserContentController keeps its handlers strongly; the handlers here are
/// app-long singletons anyway, but the indirection keeps that from mattering.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// What every web view does with navigation: signs in on the way to /login,
/// sends other sites to Safari, and (on the reading screen) turns the
/// website's way back to its shelf into going back to the native one.
@MainActor
class WebNavigator: NSObject, WKNavigationDelegate, WKUIDelegate {
    /// The page asked for, so a bounce to /login can sign in and land there;
    /// once per load, so a refused sign-in can't loop.
    private(set) var wanted = "/reader"
    private var handedOff = false
    var interceptsShelf = false
    var onShelf: () -> Void = {}
    var onTitle: (String) -> Void = { _ in }

    func load(_ path: String, in webView: WKWebView) {
        wanted = path
        handedOff = false
        Task {
            let request = await WebSignIn.request(for: path)
            if request.httpMethod == "POST" { handedOff = true }
            webView.load(request)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        guard url.host() == WebSignIn.website.host() else {
            if action.navigationType == .linkActivated, ["http", "https"].contains(url.scheme) {
                present(SFSafariViewController(url: url), from: webView)
                return .cancel
            }
            return .allow
        }
        let path = url.path()
        if path.hasPrefix("/login") {
            if !handedOff, let request = await WebSignIn.handoff(next: wanted) {
                handedOff = true
                webView.load(request)
                return .cancel
            }
            return .allow
        }
        if interceptsShelf, Self.isShelf(path), action.targetFrame?.isMainFrame == true, webView.url != nil {
            onShelf()
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let title = webView.title, !title.isEmpty { onTitle(title) }
    }

    /// target=_blank links.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url {
            if url.host() == WebSignIn.website.host() {
                webView.load(URLRequest(url: url))
            } else if ["http", "https"].contains(url.scheme) {
                present(SFSafariViewController(url: url), from: webView)
            }
        }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func present(_ controller: UIViewController, from view: UIView) {
        var top = view.window?.rootViewController
        while let next = top?.presentedViewController { top = next }
        top?.present(controller, animated: true)
    }

    /// The website's shelf: /reader (which redirects) and /reader/library.
    static func isShelf(_ path: String) -> Bool {
        let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
        return trimmed == "/reader" || trimmed == "/reader/library"
    }
}

/// The reading screen's one web view.
@MainActor
final class ReadingWeb {
    static let shared = ReadingWeb()

    private(set) var webView = WebPool.makeWebView()
    private let navigator = WebNavigator()

    private init() { attach() }

    private func attach() {
        navigator.interceptsShelf = true
        webView.navigationDelegate = navigator
        webView.uiDelegate = navigator
        AudioBridge.shared.attach(webView)
    }

    /// The page last asked for, so SwiftUI redrawing the screen doesn't ask
    /// again. Cleared on the way back to the shelf.
    private var requested: String?

    var onShelf: () -> Void = {} {
        didSet {
            navigator.onShelf = { [weak self] in
                self?.requested = nil
                self?.onShelf()
            }
        }
    }

    /// Shows `path`. Already there: nothing to do. Elsewhere on the website:
    /// the website's own client-side navigation, which keeps the read-aloud
    /// playing; a full load only when that isn't available.
    func open(_ path: String) {
        if path == requested { return }
        requested = path
        if webView.url?.path() == path { return }
        guard webView.url != nil else {
            navigator.load(path, in: webView)
            return
        }
        let script = "(() => { const r = window.next && window.next.router; if (!r) return false; r.push(\(Self.jsString(path))); return true; })()"
        webView.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self, (result as? Bool) != true else { return }
            navigator.load(path, in: webView)
        }
    }

    /// Signed out: a fresh web view, nothing of the last account's on screen.
    func reset() {
        requested = nil
        AudioBridge.shared.detach(webView)
        webView = WebPool.makeWebView()
        attach()
    }

    private static func jsString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        let array = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"/reader\"]"
        return String(array.dropFirst().dropLast())
    }
}

/// Puts the reading screen's web view on screen.
struct ReadingWebView: UIViewRepresentable {
    let path: String
    var onShelf: () -> Void

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        let reading = ReadingWeb.shared
        reading.onShelf = onShelf
        let webView = reading.webView
        if webView.superview !== container {
            webView.removeFromSuperview()
            webView.frame = container.bounds
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.addSubview(webView)
        }
        reading.open(path)
    }
}

/// One of the Reader's web pages, in a web view of its own.
struct PageWebView: UIViewRepresentable {
    let path: String
    var onTitle: (String) -> Void = { _ in }

    func makeCoordinator() -> WebNavigator { WebNavigator() }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WebPool.makeWebView()
        let navigator = context.coordinator
        navigator.onTitle = onTitle
        webView.navigationDelegate = navigator
        webView.uiDelegate = navigator
        navigator.load(path, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
