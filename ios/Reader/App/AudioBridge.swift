import MasonKit
import SwiftUI
import WebKit

/// Between the website's audiobook player (native-audio.ts, "readerAudio"
/// messages) and the app's AudioPlayer. Reports go back to the reading
/// screen's web view, the one whose page is in charge.
@MainActor
final class AudioBridge: NSObject, WKScriptMessageHandler {
    static let shared = AudioBridge()
    static let messageName = "readerAudio"

    private weak var webView: WKWebView?

    override private init() {
        super.init()
        AudioPlayer.shared.report = { [weak self] _, state in self?.send(state) }
    }

    func attach(_ webView: WKWebView) { self.webView = webView }

    func detach(_ webView: WKWebView) {
        if self.webView === webView { self.webView = nil }
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let command = body["cmd"] as? String else { return }
        let url = (body["url"] as? String).flatMap(URL.init(string:))
        let time = body["time"] as? Double
        let rate = body["rate"] as? Double
        MainActor.assumeIsolated {
            // Only the reading screen's page plays; never another page's.
            guard message.webView === webView else { return }
            let player = AudioPlayer.shared
            switch command {
            case "src": player.setSource(url)
            case "play": player.play()
            case "pause": player.pause()
            case "seek": if let time { player.seek(to: time) }
            case "rate": if let rate { player.setRate(rate) }
            default: break
            }
        }
    }

    private func send(_ state: [String: Any]) {
        guard let webView,
              let data = try? JSONSerialization.data(withJSONObject: state),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__readerAudio && window.__readerAudio(\(json))", completionHandler: nil)
    }
}

/// On the shelf while something's playing: what it is, play/pause, and a tap
/// back into the book.
struct NowPlayingBar: View {
    let onOpen: (UUID) -> Void
    @State private var player = AudioPlayer.shared

    var body: some View {
        if let playing = player.nowPlaying {
            HStack(spacing: 12) {
                Button { onOpen(playing.bookID) } label: {
                    HStack(spacing: 12) {
                        if let book = ShelfStore.shared.book(playing.bookID) {
                            Cover(book: book).frame(width: 34)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(playing.chapterTitle ?? "Chapter \(playing.index + 1)")
                                .font(.subheadline.weight(.medium))
                                .lineLimit(1)
                            Text(playing.bookTitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Button { player.skip(by: -15) } label: { Image(systemName: "gobackward.15") }
                    .accessibilityLabel("Back 15 seconds")
                Button { player.toggle() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.title3)
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .glassEffect(in: .rect(cornerRadius: 20))
            .padding(.horizontal)
            .tint(Theme.accent)
        }
    }
}
