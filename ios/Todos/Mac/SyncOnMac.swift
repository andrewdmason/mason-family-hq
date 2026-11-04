import AppKit
import AuthenticationServices

/// The Google sign-in sheet. Not the sign-in library's own: its callback assumes the
/// main thread, but on the Mac it can arrive on another one, which crashes the app.
/// Nothing in here is tied to the main thread for that reason.
final class WebSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let window: NSWindow?
    private var session: ASWebAuthenticationSession?

    init(window: NSWindow?) {
        self.window = window
    }

    func start(url: URL, scheme: String, done: @escaping @Sendable (Result<URL, Error>) -> Void) {
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
            if let callback {
                done(.success(callback))
            } else {
                done(.failure(error ?? URLError(.unknown)))
            }
        }
        session.presentationContextProvider = self
        self.session = session
        session.start()
    }

    func cancel() {
        session?.cancel()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        window ?? ASPresentationAnchor()
    }
}

/// A quiet line at the foot of the sidebar, only when there's something to do about
/// syncing. All's well shows nothing at all.
@MainActor
final class SyncStatusController: NSSplitViewItemAccessoryViewController {
    private let button = NSButton(title: "", target: nil, action: nil)
    private var sync: TodoSync?

    override func loadView() {
        button.isBordered = false
        button.font = .systemFont(ofSize: 12)
        button.contentTintColor = .secondaryLabelColor
        button.target = self
        button.action = #selector(clicked)
        button.frame = NSRect(x: 0, y: 0, width: 200, height: 36)
        view = button
        isHidden = true
    }

    func attach(_ sync: TodoSync) {
        self.sync = sync
        follow()
    }

    private func follow() {
        guard let sync else { return }
        let status = withObservationTracking {
            sync.status
        } onChange: { [weak self] in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.follow() } }
        }
        switch status {
        case .working:
            isHidden = true
        case .signedOut:
            button.title = "Sign in to sync"
            button.toolTip = nil
            isHidden = false
        case .failing(let reason):
            button.title = "Can't sync right now"
            button.toolTip = reason
            isHidden = false
        }
    }

    @objc private func clicked() {
        guard let sync else { return }
        if sync.status == .signedOut { sync.signIn() } else { sync.kick() }
    }
}
