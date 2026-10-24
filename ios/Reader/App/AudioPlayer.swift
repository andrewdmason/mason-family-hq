import AVFoundation
import MediaPlayer
import Observation
import UIKit
import WebKit

/// The read-aloud's player. The website's audiobook player stays in charge of
/// what to play (which chapter, from which sentence, preparing the next one);
/// inside the app it hands the actual playing to this
/// (src/components/audiobook/native-audio.ts, over AudioBridge), which keeps
/// going with the phone locked or in another app, answers the Lock Screen,
/// Control Center and AirPods, and keeps every chapter it plays on the device
/// for listening offline.
///
/// While the app is in the background the website can't run, so at the end
/// of a chapter this moves on to the next one by itself, and tells the website
/// where it got to when the app comes back.
@MainActor
@Observable
final class AudioPlayer {
    static let shared = AudioPlayer()

    struct NowPlaying: Equatable {
        let bookID: UUID
        var bookTitle: String
        var author: String?
        var chapterTitle: String?
        var index: Int
    }

    private(set) var nowPlaying: NowPlaying?
    private(set) var isPlaying = false

    /// Called with each report for the website (AudioBridge).
    @ObservationIgnored var report: (_ event: String, _ state: [String: Any]) -> Void = { _, _ in }

    @ObservationIgnored private let player = AVPlayer()
    @ObservationIgnored private var currentURL: URL?
    @ObservationIgnored private var rate: Float = 1
    @ObservationIgnored private var pendingSeek: Double?
    @ObservationIgnored private var wantsToPlay = false
    /// Moved to the next chapter by itself while in the background; the
    /// website hasn't heard yet.
    @ObservationIgnored private var advancedAlone = false
    @ObservationIgnored private var ignoreNextSeek = false
    @ObservationIgnored private var statusObservation: NSKeyValueObservation?
    @ObservationIgnored private var chapters: [Int: String] = [:]
    @ObservationIgnored private var artwork: MPMediaItemArtwork?

    private init() {
        player.automaticallyWaitsToMinimizeStalling = true
        player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        let center = NotificationCenter.default
        center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            let item = note.object as? AVPlayerItem
            MainActor.assumeIsolated {
                guard let self, item === self.player.currentItem else { return }
                self.chapterEnded()
            }
        }
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            MainActor.assumeIsolated { if began { self?.pause() } }
        }
        center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.caughtUp() }
        }
        setUpRemoteCommands()
    }

    // MARK: Commands from the website

    func setSource(_ url: URL?) {
        guard let url else { return stop() }
        // The website catching up with a chapter this already moved on to:
        // keep playing where it is.
        if url == currentURL, advancedAlone || ignoreNextSeek {
            advancedAlone = false
            ignoreNextSeek = true
            return
        }
        load(url, playing: false)
    }

    func seek(to seconds: Double) {
        if ignoreNextSeek {
            ignoreNextSeek = false
            return
        }
        guard let item = player.currentItem, item.status == .readyToPlay else {
            pendingSeek = seconds
            return
        }
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            MainActor.assumeIsolated { self?.send("timeupdate") }
        }
    }

    func setRate(_ rate: Double) {
        self.rate = Float(rate)
        player.defaultRate = self.rate
        if player.rate > 0 { player.rate = self.rate }
        updateNowPlaying()
    }

    func play() {
        ignoreNextSeek = false
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        wantsToPlay = true
        player.defaultRate = rate
        player.play()
        isPlaying = true
        send("play")
        updateNowPlaying()
    }

    func pause() {
        wantsToPlay = false
        player.pause()
        isPlaying = false
        send("pause")
        updateNowPlaying()
    }

    func toggle() { isPlaying ? pause() : play() }

    func skip(by seconds: Double) {
        let now = player.currentTime().seconds
        guard now.isFinite else { return }
        ignoreNextSeek = false
        seek(to: max(0, now + seconds))
    }

    func stop() {
        wantsToPlay = false
        player.pause()
        player.replaceCurrentItem(with: nil)
        currentURL = nil
        nowPlaying = nil
        isPlaying = false
        advancedAlone = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: Loading

    private func load(_ url: URL, playing: Bool) {
        currentURL = url
        pendingSeek = nil
        player.replaceCurrentItem(with: nil)
        let chapter = AudioChapterURL(url)
        if let chapter { describe(chapter) }
        if playing { play() }
        Task {
            let item: AVPlayerItem
            if let chapter, let file = AudioStore.file(for: chapter) {
                item = AVPlayerItem(url: file)
            } else {
                await AudioStore.refreshCookies()
                item = AVPlayerItem(asset: AVURLAsset(url: url, options: ["AVURLAssetHTTPCookiesKey": AudioStore.cookies]))
                if let chapter { Task { await AudioStore.download(chapter) } }
            }
            // Superseded while the cookies were read.
            guard currentURL == url else { return }
            statusObservation = item.observe(\.status) { [weak self] item, _ in
                Task { @MainActor in self?.itemStatusChanged(item) }
            }
            player.replaceCurrentItem(with: item)
        }
    }

    private func itemStatusChanged(_ item: AVPlayerItem) {
        guard item === player.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            if let pendingSeek {
                self.pendingSeek = nil
                seek(to: pendingSeek)
            }
            send("durationchange")
            if wantsToPlay { player.play() }
            updateNowPlaying()
        case .failed:
            send("error")
        default:
            break
        }
    }

    private func chapterEnded() {
        isPlaying = false
        guard UIApplication.shared.applicationState != .active,
              let current = currentURL.flatMap(AudioChapterURL.init) else {
            send("ended")
            updateNowPlaying()
            return
        }
        // In the background: on to the next chapter if it's been voiced (the
        // website prepares it while this one plays).
        Task {
            let next = AudioChapterURL(bookID: current.bookID, index: current.index + 1)
            guard await AudioStore.isReady(next) else {
                advancedAlone = false
                send("ended")
                return
            }
            advancedAlone = true
            load(next.url, playing: true)
        }
    }

    /// Back in the foreground after moving on alone: tell the website the old
    /// chapter ended and where this is now, so it follows.
    private func caughtUp() {
        guard advancedAlone else { return }
        send("ended")
    }

    // MARK: Reports and Now Playing

    private func tick() {
        guard player.currentItem != nil else { return }
        if player.timeControlStatus == .playing { send("timeupdate") }
        // Keep the Lock Screen's clock honest across rate changes and stalls.
        MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyElapsedPlaybackTime] = player.currentTime().seconds
    }

    private func send(_ event: String) {
        let item = player.currentItem
        let duration = item?.duration.seconds ?? .nan
        let buffered = item?.loadedTimeRanges.last.map { CMTimeRangeGetEnd($0.timeRangeValue).seconds } ?? 0
        report(event, [
            "event": event,
            "currentTime": player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0,
            "duration": duration.isFinite ? duration : 0,
            "paused": !wantsToPlay || event == "ended",
            "bufferedEnd": buffered.isFinite ? buffered : 0,
            "url": currentURL?.absoluteString ?? NSNull(),
        ])
    }

    /// Book, chapter and cover for the Lock Screen.
    private func describe(_ chapter: AudioChapterURL) {
        let book = ShelfStore.shared.book(chapter.bookID)
        if nowPlaying?.bookID != chapter.bookID {
            chapters = [:]
            artwork = nil
            Task {
                chapters = await AudioStore.chapterTitles(chapter.bookID)
                nowPlaying?.chapterTitle = chapters[chapter.index]
                if let image = await CoverCache.image(for: book?.cover_image_url) {
                    artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                }
                updateNowPlaying()
            }
        }
        nowPlaying = NowPlaying(
            bookID: chapter.bookID,
            bookTitle: book?.title ?? "Reader",
            author: book?.author,
            chapterTitle: chapters[chapter.index],
            index: chapter.index
        )
        updateNowPlaying()
    }

    private func updateNowPlaying() {
        guard let nowPlaying else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlaying.chapterTitle ?? "Chapter \(nowPlaying.index + 1)",
            MPMediaItemPropertyAlbumTitle: nowPlaying.bookTitle,
            MPMediaItemPropertyArtist: nowPlaying.author ?? nowPlaying.bookTitle,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: player.currentTime().seconds,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(rate) : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: Double(rate),
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if let duration = player.currentItem?.duration.seconds, duration.isFinite {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func setUpRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.play() }
            return .success
        }
        commands.pauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.pause() }
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.toggle() }
            return .success
        }
        commands.skipBackwardCommand.preferredIntervals = [15]
        commands.skipBackwardCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.skip(by: -15) }
            return .success
        }
        commands.skipForwardCommand.preferredIntervals = [30]
        commands.skipForwardCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { self?.skip(by: 30) }
            return .success
        }
        commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            MainActor.assumeIsolated { self?.seek(to: event.positionTime) }
            return .success
        }
    }
}

/// /reader/api/audio/{book}/{index}: one chapter's audio.
struct AudioChapterURL: Hashable {
    let bookID: UUID
    let index: Int

    init(bookID: UUID, index: Int) {
        self.bookID = bookID
        self.index = index
    }

    init?(_ url: URL) {
        let parts = url.pathComponents
        guard parts.count == 6, parts[1] == "reader", parts[2] == "api", parts[3] == "audio",
              let book = UUID(uuidString: parts[4]), let index = Int(parts[5]) else { return nil }
        bookID = book
        self.index = index
    }

    var url: URL {
        WebSignIn.website.appending(path: "reader/api/audio/\(bookID.uuidString.lowercased())/\(index)")
    }
}

/// Chapters on the device, and the website's audio endpoints, with the web
/// views' sign-in.
@MainActor
enum AudioStore {
    private static let folder = URL.applicationSupportDirectory.appending(path: "audio")
    /// The web views' cookies, refreshed before each request that needs them.
    static var cookies: [HTTPCookie] = []

    static func file(for chapter: AudioChapterURL) -> URL? {
        let file = folder.appending(path: "\(chapter.bookID.uuidString.lowercased())/\(chapter.index).mp3")
        return FileManager.default.fileExists(atPath: file.path()) ? file : nil
    }

    private static var downloading: Set<AudioChapterURL> = []

    static func download(_ chapter: AudioChapterURL) async {
        guard file(for: chapter) == nil, downloading.insert(chapter).inserted else { return }
        defer { downloading.remove(chapter) }
        guard let (temp, response) = try? await URLSession.shared.download(for: await request(chapter.url)),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return }
        let destination = folder.appending(path: "\(chapter.bookID.uuidString.lowercased())/\(chapter.index).mp3")
        try? FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.moveItem(at: temp, to: destination)
    }

    private struct Plan: Decodable {
        struct Chapter: Decodable { let index: Int; let title: String?; let status: String }
        let chapters: [Chapter]
    }

    private static func plan(_ bookID: UUID) async -> Plan? {
        let url = WebSignIn.website.appending(path: "reader/api/audio/\(bookID.uuidString.lowercased())")
        guard let (data, response) = try? await URLSession.shared.data(for: await request(url)),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(Plan.self, from: data)
    }

    static func chapterTitles(_ bookID: UUID) async -> [Int: String] {
        let chapters = await plan(bookID)?.chapters ?? []
        return Dictionary(chapters.compactMap { c in c.title.map { (c.index, $0) } }, uniquingKeysWith: { a, _ in a })
    }

    /// The chapter can play: on the device, or voiced on the website.
    static func isReady(_ chapter: AudioChapterURL) async -> Bool {
        if file(for: chapter) != nil { return true }
        return await plan(chapter.bookID)?.chapters.first { $0.index == chapter.index }?.status == "ready"
    }

    static func refreshCookies() async {
        cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
    }

    private static func request(_ url: URL) async -> URLRequest {
        await refreshCookies()
        var request = URLRequest(url: url)
        HTTPCookie.requestHeaderFields(with: cookies.filter { WebSignIn.website.host()?.hasSuffix($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) == true })
            .forEach { request.setValue($1, forHTTPHeaderField: $0) }
        return request
    }
}
