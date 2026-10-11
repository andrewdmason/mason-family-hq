import AVKit
import SwiftUI

/// Home: held upright. A tab per kid with their at-bats from Clips as a
/// two-wide card grid per game, newest game first; anything still building or
/// uploading on this phone joins its game. Film opens from the last card of
/// the most recent game.
struct HomeView: View {
    @State private var model = RecordModel()
    @State private var update = AppUpdate()
    @State private var kidID: UUID?
    @State private var history: [UUID: [HistoryGame]] = [:]
    @State private var posters: [String: URL] = [:]
    @State private var loadError: String?
    @State private var cameraOpen = false
    @State private var showingSettings = false
    @State private var playing: PlayItem?
    /// The at-bat whose video is being fetched for the share sheet.
    @State private var sharing: UUID?
    @State private var shareError: String?
    @State private var deleteError: String?
    /// Swiped to delete; waiting on the confirmation.
    @State private var deleting: (atBat: HistoryAtBat, game: GameSection, number: Int)?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    /// Starting a new game for this kid (the sheet is open).
    @State private var newGameFor: Kid?

    private var store: AtBatStore { model.store }
    private var currentKid: Kid? { kids.first { $0.id == kidID } }
    private var kids: [Kid] { model.settings.cachedKids }
    private var unfiled: [AtBatJob] { store.jobs.filter { $0.game == nil } }
    /// The "Unfiled" tab: at-bats recorded before uploads existed.
    private static let unfiledTab = UUID(uuidString: "00000000-0000-0000-0000-000000000000")!

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    kidTabs
                    if let link = update.available {
                        VStack(alignment: .leading, spacing: 6) {
                            Button { openURL(link) } label: {
                                Label("A new version is ready — tap to update", systemImage: "arrow.down.circle.fill")
                                    .font(.subheadline.weight(.semibold))
                            }
                            Text("Your at-bats and settings stay.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if kidID == Self.unfiledTab {
                        VStack(alignment: .leading, spacing: 10) {
                            CardGrid { ForEach(unfiled) { job in localCard(job) } }
                            Text("Filmed before uploading was added — these stay on this phone. Press and hold to delete.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } else {
                        kidSections
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .navigationTitle("Baseball Clips")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showingSettings = true } label: { Image(systemName: "gearshape") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { newGameFor = currentKid } label: { Image(systemName: "plus") }
                        .disabled(currentKid == nil)
                        .accessibilityLabel("New game")
                }
            }
            .refreshable { await load() }
            .overlay {
                if kids.isEmpty && model.clips.isSignedIn && loadError == nil {
                    ProgressView()
                }
            }
        }
        .onAppear { Orientation.lock(.portrait) }
        .task {
            #if DEBUG
            if loadDemo() { return }
            #endif
            store.resume()
            await update.check()
            await loadKids()
        }
        .onChange(of: kidID) { Task { await load() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.resume(); Task { await load(); await update.check() } }
            if phase == .background && cameraOpen { model.wentToBackground() }
        }
        // A finished upload shows up in the kid's history.
        .onChange(of: store.jobs.filter { $0.upload == .uploaded }.count) { Task { await load() } }
        .onChange(of: model.clips.isSignedIn) { _, signedIn in
            if signedIn { store.resume(); Task { await loadKids() } }
        }
        .fullScreenCover(isPresented: $cameraOpen, onDismiss: {
            model.cameraClosed()
            Orientation.lock(.portrait)
            if let kid = model.settings.game?.kid.id, kid != kidID { kidID = kid }
        }) {
            CameraView(model: model) { cameraOpen = false }
        }
        .sheet(item: $newGameFor) { kid in
            NewGameSheet(kid: kid) { game in model.settings.setCurrentGame(game) }
        }
        // Home is upright-only; videos can turn sideways.
        .fullScreenCover(item: $playing, onDismiss: { Orientation.lock(.portrait) }) { item in
            PlayerScreen(url: item.url).onAppear { Orientation.lock(.allButUpsideDown) }
        }
        .alert("Can't share", isPresented: .constant(shareError != nil), presenting: shareError) { _ in
            Button("OK") { shareError = nil }
        } message: { Text($0) }
        .alert("Can't delete", isPresented: .constant(deleteError != nil), presenting: deleteError) { _ in
            Button("OK") { deleteError = nil }
        } message: { Text($0) }
        .confirmationDialog(
            deleting.map { "Delete AB \($0.number) from \($0.game.name)?" } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { item in
            Button("Delete from Clips", role: .destructive) { delete(item.atBat, game: item.game) }
        } message: { _ in
            Text("The video is removed from Clips for everyone. This can't be undone.")
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView(settings: model.settings, clips: model.clips, formatDescription: model.capture.formatDescription)
        }
        .fullScreenCover(isPresented: .constant(model.clips.checkedSession && !model.clips.isSignedIn && !Self.demo)) {
            SignInView(clips: model.clips)
        }
    }

    // MARK: Tabs

    private var kidTabs: some View {
        Picker("Kid", selection: $kidID) {
            ForEach(kids) { k in Text(k.firstName).tag(Optional(k.id)) }
            if !unfiled.isEmpty { Text("Unfiled").tag(Optional(Self.unfiledTab)) }
        }
        .pickerStyle(.segmented)
    }

    // MARK: A kid's at-bats

    /// A kid's games, newest first: what's in Clips plus anything only on
    /// this phone so far (a just-started game, at-bats still uploading). The
    /// most recent game ends with its Film row — the only place to film.
    private var sections: [GameSection] {
        guard let kid = currentKid else { return [] }
        let current = currentGame
        let fromClips = history[kid.id] ?? []
        let inClips = Set(fromClips.flatMap(\.atBats).map(\.id))
        let local = store.jobs.filter { $0.game?.kid.id == kid.id && !inClips.contains($0.id) }
        var out = fromClips.map { g in
            GameSection(id: g.id, name: g.name, playedOn: g.playedOn, atBats: g.atBats,
                        local: local.filter { $0.game?.id == g.id }.reversed())
        }
        var known = Set(out.map(\.id))
        // Games that exist only on this phone so far.
        for job in local.reversed() {
            guard let game = job.game, !known.contains(game.id) else { continue }
            known.insert(game.id)
            out.append(GameSection(id: game.id, name: game.name, playedOn: game.playedOn, atBats: [],
                                   local: local.filter { $0.game?.id == game.id }.reversed()))
        }
        if let current, !known.contains(current.id) {
            out.append(GameSection(id: current.id, name: current.name, playedOn: current.playedOn, atBats: [], local: []))
        }
        out.sort { a, b in
            a.playedOn != b.playedOn ? a.playedOn > b.playedOn : (a.id == current?.id) && (b.id != current?.id)
        }
        if let i = out.firstIndex(where: { $0.id == current?.id }) {
            out[i].current = current
        }
        return out
    }

    @ViewBuilder private var kidSections: some View {
        let sections = sections
        ForEach(sections) { section in
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(section.name).font(.title3).fontDesign(.serif).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(formatDay(section.playedOn)).font(.footnote).foregroundStyle(.secondary)
                }
                CardGrid {
                    ForEach(section.cards) { card in
                        switch card {
                        case .atBat(let ab, let number):
                            HistoryCard(atBat: ab, poster: ab.posterPath.flatMap { posters[$0] },
                                        sharing: sharing == ab.id,
                                        onOpen: { open(ab) },
                                        onShare: { share(ab, game: section, number: number) },
                                        onDelete: { deleting = (ab, section, number) })
                        case .local(let job):
                            localCard(job)
                        case .film(let game):
                            FilmCard { film(game) }
                        }
                    }
                }
                if section.current != nil && section.playedOn != GameChoice.day(Date()) {
                    Text("New game today? Tap + first.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        if sections.isEmpty {
            Text(loadError ?? (kidID == nil ? "Loading…" : "No games yet — tap + to start one."))
                .foregroundStyle(.secondary)
        }
    }

    /// An at-bat still on this phone: building, uploading, or filmed before uploads.
    @ViewBuilder private func localCard(_ job: AtBatJob) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Thumbnail(url: nil)
                .overlay(alignment: .topLeading) { if let r = job.result { ResultBadge(result: r) } }
                .overlay {
                    if job.state == .building { ProgressView().tint(.white) }
                }
                .overlay(alignment: .bottom) {
                    if job.upload == .uploading {
                        ProgressView(value: store.progress[job.id] ?? 0).padding(8)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if job.editFile != nil, job.upload != .uploading {
                        ShareButton(busy: false) { shareLocal(job) }
                    }
                }
            Text(job.result?.name ?? "No result").font(.subheadline.weight(.semibold)).lineLimit(1)
            if case .failed(let why) = job.state {
                Text(why).font(.caption).foregroundStyle(.red).lineLimit(2)
            } else {
                UploadStatus(job: job, progress: store.progress[job.id], online: store.online)
            }
            if case .failed = job.state {
                retryButton(job)
            } else if case .failed = job.upload, job.state == .done {
                retryButton(job)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let file = job.editFile { playing = PlayItem(url: store.url(file)) }
        }
        .contextMenu {
            if job.editFile != nil {
                Button { shareLocal(job) } label: { Label("Share", systemImage: "square.and.arrow.up") }
            }
            Button(role: .destructive) { store.delete(job.id) } label: { Label("Delete", systemImage: "trash") }
        }
    }

    private func retryButton(_ job: AtBatJob) -> some View {
        Button("Retry") { store.retry(job.id) }.buttonStyle(.bordered).controlSize(.small)
    }

    #if DEBUG
    static let demo = ProcessInfo.processInfo.arguments.contains("-demoHome")

    /// Simulator layout check (no sign-in there): `-demoHome` shows made-up history.
    private func loadDemo() -> Bool {
        guard Self.demo else { return false }
        let sebastian = Kid(id: UUID(), displayName: "Sebastian Mason")
        model.settings.cachedKids = [sebastian, Kid(id: UUID(), displayName: "Theo Mason")]
        kidID = sebastian.id
        let json = """
        [{"id":"\(UUID())","name":"vs Kabuki","played_on":"2026-10-11","clip_at_bats":[
          {"id":"\(UUID())","source":"camera","status":"ready","result":"1B","recorded_at":"2026-10-11T16:02:00Z","created_at":"2026-10-11T16:02:00Z","clip_pitches":[{"outcome":"ball"},{"outcome":"foul"},{"outcome":"in_play"}]},
          {"id":"\(UUID())","source":"camera","status":"ready","result":"KL","recorded_at":"2026-10-11T16:40:00Z","created_at":"2026-10-11T16:40:00Z","clip_pitches":[{"outcome":"called_strike"},{"outcome":"swinging_strike"},{"outcome":"ball"},{"outcome":"called_strike"}]}]},
         {"id":"\(UUID())","name":"Merchants Scrimmage","played_on":"2026-09-26","clip_at_bats":[
          {"id":"\(UUID())","source":"upload","status":"ready","result":"FO","recorded_at":"2026-09-26T17:00:00Z","created_at":"2026-09-26T17:00:00Z","clip_pitches":[{"outcome":"ball"},{"outcome":"in_play"}]}]}]
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        history[sebastian.id] = (try? decoder.decode([HistoryGame].self, from: Data(json.utf8))) ?? []
        if let g = history[sebastian.id]?.first {
            model.settings.setCurrentGame(GameChoice(id: g.id, kid: sebastian, name: g.name, playedOn: GameChoice.day(Date()), priorAtBats: 2))
        }
        return true
    }
    #else
    static let demo = false
    #endif

    // MARK: Actions

    /// Open the camera filing at-bats under this game, which becomes the
    /// kid's current game.
    private func film(_ game: GameChoice) {
        model.settings.setCurrentGame(game)
        model.settings.game = game
        cameraOpen = true
    }

    /// The game at-bats are filmed into: the one most recently started on
    /// this phone, or else the kid's newest game in Clips. Its at-bats already
    /// in Clips (other than this phone's own, counted separately) set where
    /// the numbering picks up.
    private var currentGame: GameChoice? {
        guard let kid = currentKid else { return nil }
        let started = model.settings.currentGame(for: kid.id)
        guard let newest = history[kid.id]?.first, newest.playedOn > (started?.playedOn ?? "") else { return started }
        let mine = Set(store.jobs.map(\.id))
        return GameChoice(id: newest.id, kid: kid, name: newest.name, playedOn: newest.playedOn,
                          priorAtBats: newest.atBats.filter { !mine.contains($0.id) }.count)
    }

    /// Phone at-bats play here (from this phone if the file's still on it);
    /// videos uploaded on the website open there, where their markers live.
    private func open(_ ab: HistoryAtBat) {
        guard ab.isCamera, let path = ab.playbackPath else {
            openURL(ab.webURL)
            return
        }
        if let file = store.jobs.first(where: { $0.id == ab.id })?.editFile,
           FileManager.default.fileExists(atPath: store.url(file).path) {
            playing = PlayItem(url: store.url(file))
            return
        }
        Task {
            if let url = try? await model.clips.videoURL(path) { playing = PlayItem(url: url) }
        }
    }

    /// Hand the finished video to the share sheet, named the way the website
    /// names exports. Phone at-bats share their own file (from this phone when
    /// it's still here); website at-bats share their latest export, or open in
    /// Clips to make one.
    private func share(_ ab: HistoryAtBat, game: GameSection, number: Int) {
        let kid = kids.first { $0.id == kidID }?.firstName
        let name = Self.fileName(kid: kid, game: game.name, number: number, result: ab.result, day: game.playedOn)
        if let file = store.jobs.first(where: { $0.id == ab.id })?.editFile,
           FileManager.default.fileExists(atPath: store.url(file).path) {
            presentShare(copying: store.url(file), as: name)
            return
        }
        sharing = ab.id
        Task {
            defer { sharing = nil }
            let path = ab.isCamera ? ab.playbackPath : await model.clips.latestExportPath(atBatID: ab.id)
            guard let path else {
                openURL(ab.webURL) // no export yet — make one in Clips
                return
            }
            do {
                let remote = try await model.clips.videoURL(path)
                let (download, _) = try await URLSession.shared.download(from: remote)
                presentShare(copying: download, as: name)
            } catch {
                shareError = "Couldn't download the video — check your signal."
            }
        }
    }

    private func delete(_ ab: HistoryAtBat, game: GameSection) {
        guard let kidID else { return }
        // Off the list at once; put back if Clips refuses.
        let before = history[kidID]
        history[kidID] = before?.compactMap { g in
            g.id != game.id ? g : g.removing(ab.id)
        }
        Task {
            do {
                try await model.clips.deleteAtBat(ab.id, gameID: game.id)
                if store.jobs.contains(where: { $0.id == ab.id }) { store.delete(ab.id) }
            } catch {
                history[kidID] = before
                deleteError = "Couldn't delete it — check your signal and try again."
            }
        }
    }

    private func shareLocal(_ job: AtBatJob) {
        guard let file = job.editFile else { return }
        let name = Self.fileName(kid: job.game?.kid.firstName, game: job.game?.name, number: store.number(of: job) ?? 1,
                                 result: job.result, day: job.game?.playedOn)
        presentShare(copying: store.url(file), as: name)
    }

    /// "Sebastian - vs Kabuki - AB 2 (Single) - 2026-10-11.mp4"
    static func fileName(kid: String?, game: String?, number: Int, result: AtBatResult?, day: String?) -> String {
        let ab = "AB \(number)" + (result.map { " (\($0.name))" } ?? "")
        let parts = [kid, game, ab, day].compactMap { $0 }.filter { !$0.isEmpty }
        let name = parts.joined(separator: " - ").components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|")).joined()
        return name + ".mp4"
    }

    private func presentShare(copying file: URL, as name: String) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let named = dir.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: named)
        do {
            try FileManager.default.copyItem(at: file, to: named)
        } catch {
            shareError = error.localizedDescription
            return
        }
        let sheet = UIActivityViewController(activityItems: [named], applicationActivities: nil)
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              var top = scene.keyWindow?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        sheet.popoverPresentationController?.sourceView = top.view
        top.present(sheet, animated: true)
    }

    private func loadKids() async {
        guard model.clips.isSignedIn else { return }
        if let kids = try? await model.clips.kids(), !kids.isEmpty {
            model.settings.cachedKids = kids
        }
        if kidID == nil { kidID = model.settings.game?.kid.id ?? kids.first?.id }
        await load()
    }

    private func load() async {
        guard model.clips.isSignedIn, let kidID, let kid = kids.first(where: { $0.id == kidID }) else { return }
        do {
            let games = try await model.clips.history(for: kid)
            history[kidID] = games
            loadError = nil
            let needed = games.flatMap(\.atBats).compactMap(\.posterPath).filter { posters[$0] == nil }
            let urls = await model.clips.posterURLs(needed)
            posters.merge(urls) { a, _ in a }
        } catch {
            loadError = history[kidID] == nil ? "Couldn't load from Clips — pull down to try again." : nil
        }
    }

    private func formatDay(_ ymd: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ymd) else { return ymd }
        return d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }
}

// MARK: - Cards

/// Two cards across, like the website's game rows.
private struct CardGrid<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .top),
                            GridItem(.flexible(), spacing: 12, alignment: .top)],
                  alignment: .leading, spacing: 16) {
            content
        }
    }
}

private struct HistoryCard: View {
    let atBat: HistoryAtBat
    let poster: URL?
    let sharing: Bool
    let onOpen: () -> Void
    let onShare: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Thumbnail(url: poster)
                .overlay(alignment: .topLeading) { if let r = atBat.result { ResultBadge(result: r) } }
                .overlay(alignment: .bottomTrailing) { ShareButton(busy: sharing, action: onShare) }
            HStack(spacing: 4) {
                Text(atBat.result?.name ?? "No result").font(.subheadline.weight(.semibold)).lineLimit(1)
                if !atBat.isCamera {
                    Image(systemName: "arrow.up.right").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        .accessibilityLabel("Opens in Clips")
                }
            }
            Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .contextMenu {
            Button(action: onShare) { Label("Share", systemImage: "square.and.arrow.up") }
            Button(role: .destructive, action: onDelete) { Label("Delete from Clips", systemImage: "trash") }
        }
    }

    private var detail: String {
        guard atBat.pitches > 0 else { return "Not marked yet" }
        var parts = ["\(atBat.pitches) pitch\(atBat.pitches == 1 ? "" : "es")"]
        if atBat.swings > 0 { parts.append("\(atBat.swings) swing\(atBat.swings == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }
}

/// The result in the thumbnail's corner, as on the website ("1B", "BB", "ꓘ").
private struct ResultBadge: View {
    let result: AtBatResult

    var body: some View {
        Text(result.label)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 5))
            .padding(6)
    }
}

/// Sits on the thumbnail's bottom-right corner.
private struct ShareButton: View {
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if busy { ProgressView().tint(.white) } else { Image(systemName: "square.and.arrow.up").font(.footnote.weight(.semibold)) }
            }
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(.black.opacity(0.45), in: Circle())
            .padding(6)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel("Share video")
    }
}

private struct Thumbnail: View {
    let url: URL?

    var body: some View {
        Color.secondary.opacity(0.2)
            .aspectRatio(16 / 9, contentMode: .fit)
            .overlay {
                if let url {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.clear
                    }
                } else {
                    Image(systemName: "film").font(.title3).foregroundStyle(.secondary)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

/// One line under a card: where the upload stands.
struct UploadStatus: View {
    let job: AtBatJob
    let progress: Double?
    let online: Bool

    var body: some View {
        switch job.upload {
        case nil:
            Text("Only on this phone").font(.caption).foregroundStyle(.secondary)
        case .waiting?:
            Label(job.state == .building ? "Building the video…" : online ? "Waiting to upload" : "Waiting for signal",
                  systemImage: online ? "clock" : "antenna.radiowaves.left.and.right.slash")
                .font(.caption).foregroundStyle(.orange)
        case .uploading?:
            // The bar itself runs along the bottom of the card's thumbnail.
            Text("Uploading \(Int((progress ?? 0) * 100))%").font(.caption).foregroundStyle(.blue)
        case .finishing?:
            Label("Adding to Clips…", systemImage: "arrow.up.circle").font(.caption).foregroundStyle(.blue)
        case .uploaded?:
            Label("In Clips", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(.green)
        case .failed(let why)?:
            Label("Upload failed: \(why)", systemImage: "exclamationmark.triangle.fill")
                .font(.caption).foregroundStyle(.red).lineLimit(2)
        }
    }
}

// MARK: - Player

struct PlayItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private struct PlayerScreen: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let player {
                VideoPlayer(player: player)
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.largeTitle).foregroundStyle(.white.opacity(0.85))
            }
            .padding()
        }
        .onAppear {
            let p = AVPlayer(url: url)
            player = p
            p.play()
        }
        .onDisappear { player?.pause() }
    }
}

// MARK: - Current game

/// One game in a kid's list.
struct GameSection: Identifiable {
    let id: UUID
    let name: String
    let playedOn: String
    /// In Clips, in order.
    let atBats: [HistoryAtBat]
    /// On this phone only so far (building or uploading), oldest first.
    let local: [AtBatJob]
    /// Set on the most recent game: the one Film files into.
    var current: GameChoice?

    /// In grid order. An at-bat that just finished uploading turns from a
    /// phone card into a Clips card under a different id, so the grid draws
    /// it fresh (with its thumbnail) rather than keeping the phone card.
    var cards: [Card] {
        atBats.enumerated().map { .atBat($1, number: $0 + 1) }
            + local.map { .local($0) }
            + (current.map { [.film($0)] } ?? [])
    }

    enum Card: Identifiable {
        case atBat(HistoryAtBat, number: Int)
        case local(AtBatJob)
        case film(GameChoice)

        var id: String {
            switch self {
            case .atBat(let ab, _): "clips-\(ab.id)"
            case .local(let job): "phone-\(job.id)"
            case .film: "film"
            }
        }
    }
}

/// The last card of the most recent game.
private struct FilmCard: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Color.red.opacity(0.12)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay { Image(systemName: "video.fill").font(.title2) }
                    .overlay {
                        RoundedRectangle(cornerRadius: 8).strokeBorder(Color.red.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Text("Film next at-bat").font(.subheadline.weight(.semibold))
            }
            .foregroundStyle(.red)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Name a new game (the date defaults to today); it becomes the kid's current game.
private struct NewGameSheet: View {
    let kid: Kid
    let onStart: (GameChoice) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var date = Date()
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField("Opponent or event (e.g. vs Kabuki)", text: $name)
                    .textInputAutocapitalization(.words)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(start)
                DatePicker("Date", selection: $date, displayedComponents: .date)
            }
            .navigationTitle("New game for \(kid.firstName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start", action: start).disabled(trimmed.isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespaces) }

    private func start() {
        guard !trimmed.isEmpty else { return }
        onStart(GameChoice(id: UUID(), kid: kid, name: trimmed, playedOn: GameChoice.day(date)))
        dismiss()
    }
}
