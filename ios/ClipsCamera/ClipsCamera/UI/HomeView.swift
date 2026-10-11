import AVKit
import Combine
import SwiftUI

/// Home: held upright. A tab per kid with their at-bats from Clips, newest game
/// first; anything still building or uploading on this phone sits on top. The
/// camera opens from the button at the bottom.
struct HomeView: View {
    @State private var model = RecordModel()
    @State private var kidID: UUID?
    @State private var history: [UUID: [HistoryGame]] = [:]
    @State private var posters: [String: URL] = [:]
    @State private var loadError: String?
    @State private var cameraOpen = false
    @State private var showingSettings = false
    @State private var playing: PlayItem?
    /// The at-bat whose video link is being fetched from Clips to play.
    @State private var opening: UUID?
    @State private var playError: String?
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
            List {
                Section { } header: { kidTabs }
                if kidID == Self.unfiledTab {
                    Section {
                        ForEach(unfiled) { job in localRow(job) }
                    } footer: {
                        Text("Filmed before uploading was added — these stay on this phone. Swipe to delete.")
                    }
                } else {
                    kidSections
                }
            }
            .listStyle(.insetGrouped)
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
            await loadKids()
        }
        .onChange(of: kidID) { Task { await load() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.resume(); Task { await load() } }
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
        .fullScreenCover(item: $playing) { item in PlayerScreen(url: item.url) }
        .alert("Can't play", isPresented: .constant(playError != nil), presenting: playError) { _ in
            Button("OK") { playError = nil }
        } message: { Text($0) }
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
        .textCase(nil)
        .listRowInsets(EdgeInsets())
        .padding(.bottom, 4)
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
            Section {
                ForEach(Array(section.atBats.enumerated()), id: \.element.id) { i, ab in
                    HistoryRow(atBat: ab, poster: ab.posterPath.flatMap { posters[$0] },
                               opening: opening == ab.id,
                               sharing: sharing == ab.id,
                               onOpen: { open(ab) },
                               onShare: { share(ab, game: section, number: i + 1) })
                        .swipeActions {
                            Button("Delete", role: .destructive) { deleting = (ab, section, i + 1) }
                        }
                }
                ForEach(section.local) { job in localRow(job) }
                if let game = section.current {
                    FilmRow { film(game) }
                }
            } header: {
                Text("\(section.name) · \(formatDay(section.playedOn))")
            } footer: {
                if section.current != nil && section.playedOn != GameChoice.day(Date()) {
                    Text("New game today? Tap + first.")
                }
            }
        }
        if sections.isEmpty {
            Section {
                Text(loadError ?? (kidID == nil ? "Loading…" : "No games yet — tap + to start one."))
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func localRow(_ job: AtBatJob) -> some View {
        HStack(spacing: 12) {
            Thumbnail(url: nil)
            VStack(alignment: .leading, spacing: 3) {
                Text(job.result?.name ?? "No result").font(.headline)
                Text(localDetail(job)).font(.caption).foregroundStyle(.secondary)
                if case .failed(let why) = job.state {
                    Text(why).font(.caption).foregroundStyle(.red)
                } else {
                    UploadStatus(job: job, progress: store.progress[job.id], online: store.online)
                }
            }
            Spacer(minLength: 0)
            if job.editFile != nil {
                ShareButton(busy: false) { shareLocal(job) }
            }
            if case .failed = job.state {
                Button("Retry") { store.retry(job.id) }.buttonStyle(.bordered)
            } else if case .failed = job.upload, job.state == .done {
                Button("Retry") { store.retry(job.id) }.buttonStyle(.bordered)
            } else if job.state == .building {
                ProgressView()
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let file = job.editFile { playing = PlayItem(url: store.url(file)) }
        }
        .swipeActions {
            Button("Delete", role: .destructive) { store.delete(job.id) }
        }
    }

    private func localDetail(_ job: AtBatJob) -> String {
        var parts = ["\(job.pitches.count) pitch\(job.pitches.count == 1 ? "" : "es")"]
        if let g = job.game { parts.append(g.name) }
        parts.append(job.recordedAt.formatted(date: .omitted, time: .shortened))
        if let r = job.renderSeconds { parts.append(String(format: "built in %.0fs", r)) }
        return parts.joined(separator: " · ")
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
        guard opening == nil else { return }
        opening = ab.id
        Task {
            defer { opening = nil }
            do {
                playing = PlayItem(url: try await model.clips.videoURL(path))
            } catch {
                playError = "Couldn't load the video — check your signal."
            }
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

// MARK: - Rows

private struct HistoryRow: View {
    let atBat: HistoryAtBat
    let poster: URL?
    let opening: Bool
    let sharing: Bool
    let onOpen: () -> Void
    let onShare: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Thumbnail(url: poster)
                .overlay {
                    if opening {
                        ZStack {
                            Color.black.opacity(0.45)
                            ProgressView().tint(.white)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                }
            VStack(alignment: .leading, spacing: 3) {
                Text(atBat.result?.name ?? "No result").font(.headline)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            ShareButton(busy: sharing, action: onShare)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
    }

    private var detail: String {
        var parts: [String] = []
        if atBat.pitches > 0 {
            parts.append("\(atBat.pitches) pitch\(atBat.pitches == 1 ? "" : "es")")
            if atBat.swings > 0 { parts.append("\(atBat.swings) swing\(atBat.swings == 1 ? "" : "s")") }
        } else {
            parts.append("Not marked yet")
        }
        if !atBat.isCamera { parts.append("opens in Clips") }
        return parts.joined(separator: " · ")
    }
}

private struct ShareButton: View {
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if busy { ProgressView() } else { Image(systemName: "square.and.arrow.up").font(.title3) }
            }
            .frame(width: 36, height: 36)
        }
        .buttonStyle(.borderless)
        .disabled(busy)
        .accessibilityLabel("Share video")
    }
}

private struct Thumbnail: View {
    let url: URL?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(0.2))
            if let url {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
            } else {
                Image(systemName: "film").foregroundStyle(.secondary)
            }
        }
        .frame(width: 96, height: 54)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

/// One line: where the upload stands.
struct UploadStatus: View {
    let job: AtBatJob
    let progress: Double?
    let online: Bool

    var body: some View {
        switch job.upload {
        case nil:
            Text("Not uploaded (filmed before uploads)").font(.caption).foregroundStyle(.secondary)
        case .waiting?:
            Label(job.state == .building ? "Building the video…" : online ? "Waiting to upload" : "Waiting for signal",
                  systemImage: online ? "clock" : "antenna.radiowaves.left.and.right.slash")
                .font(.caption).foregroundStyle(.orange)
        case .uploading?:
            HStack(spacing: 6) {
                ProgressView(value: progress ?? 0).frame(width: 90)
                Text("Uploading \(Int((progress ?? 0) * 100))%").font(.caption).foregroundStyle(.blue)
            }
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
    /// The stream died (signal dropped after the player opened).
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if failed {
                VStack(spacing: 14) {
                    Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                    Text("Couldn't load the video — check your signal.")
                    Button("Try again") { attempt += 1 }.buttonStyle(.borderedProminent)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let player {
                VideoPlayer(player: player)
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.largeTitle).foregroundStyle(.white.opacity(0.85))
            }
            .padding()
        }
        .task(id: attempt) {
            failed = false
            let item = AVPlayerItem(url: url)
            let p = AVPlayer(playerItem: item)
            player = p
            p.play()
            for await status in item.publisher(for: \.status).values where status == .failed {
                p.pause()
                failed = true
                break
            }
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
}

/// The last row of the most recent game.
private struct FilmRow: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "video.fill")
                    .font(.title3)
                    .frame(width: 96, height: 40)
                    .background(Color.red.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
                Text("Film next at-bat").font(.headline)
                Spacer(minLength: 0)
            }
            .foregroundStyle(.red)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
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
