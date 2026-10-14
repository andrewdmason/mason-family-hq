import AVKit
import PhotosUI
import SwiftUI

/// Home: held upright. A tab per kid with their at-bats from Clips as a
/// two-wide card grid per game, newest game first; anything still building or
/// uploading on this phone joins its game. Film opens from the last card of
/// the most recent game. Not signed in (a coach), it's watch-only: play and
/// share, nothing else.
struct HomeView: View {
    @State private var model = RecordModel()
    @State private var update = AppUpdate()
    @State private var kidID: UUID?
    @State private var history: [UUID: [HistoryGame]] = [:]
    @State private var posters: [String: URL] = [:]
    @State private var loadError: String?
    @State private var cameraOpen = false
    @State private var showingSettings = false
    @State private var showingSignIn = false
    @State private var playing: PlayItem?
    /// A pitch reel open in the live player.
    @State private var reelPlaying: ReelItem?
    /// Share was tapped on a reel: the options sheet is open.
    @State private var shareChoice: ReelShareTarget?
    /// Chosen there; made once the sheet has closed.
    @State private var pendingShare: (id: UUID, options: ShareOptions, framing: Framing)?
    /// The at-bat whose video is being fetched for the share sheet.
    @State private var sharing: UUID?
    @State private var shareError: String?
    @State private var deleteError: String?
    /// Swiped to delete; waiting on the confirmation.
    @State private var deleting: (atBat: HistoryAtBat, game: GameSection, number: Int)?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    /// Fixing an at-bat's pitch labels (the sheet is open).
    @State private var editing: PitchEditTarget?
    @State private var editError: String?

    /// Starting a new game for this kid (the sheet is open).
    @State private var newGameFor: Kid?

    /// A GameChanger clip being trimmed and placed (the screen is open).
    @State private var importing: FieldViewRequest?
    /// One that arrived while the camera or a video was open.
    @State private var pendingImport: FieldViewRequest?
    @State private var choosingVideo = false
    @State private var pickedVideo: PhotosPickerItem?
    /// The at-bat a video from Photos is for, when picked from its menu.
    @State private var pickingFor: FieldViewTarget?
    /// The at-bat whose GameChanger clip is being fetched to re-trim.
    @State private var fetchingFieldView: UUID?
    @State private var removingFieldView: FieldViewTarget?
    @State private var importError: String?

    private var store: AtBatStore { model.store }
    /// Watch-only: nobody's signed in on this phone.
    private var watching: Bool { model.clips.isWatching }
    private var currentKid: Kid? { kids.first { $0.id == kidID } }
    private var kids: [Kid] { model.settings.cachedKids }
    private var unfiled: [AtBatJob] { store.jobs.filter { $0.game == nil } }
    /// The "Unfiled" tab: at-bats recorded before uploads existed.
    private static let unfiledTab = UUID(uuidString: "00000000-0000-0000-0000-000000000000")!

    var body: some View {
        fieldViewFlow(home)
    }

    private var home: some View {
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
                    if watching {
                        Button("Sign in") { showingSignIn = true }
                    } else {
                        Button { showingSettings = true } label: { Image(systemName: "gearshape") }
                    }
                }
                if !watching {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button { newGameFor = currentKid } label: { Label("New game", systemImage: "baseball.diamond.bases") }
                            Button { pickingFor = nil; choosingVideo = true } label: {
                                Label("Add GameChanger video", systemImage: "film.stack")
                            }
                        } label: { Image(systemName: "plus") }
                            .disabled(currentKid == nil)
                            .accessibilityLabel("Add")
                    }
                }
            }
            .refreshable { await load() }
            .overlay {
                if kids.isEmpty && model.clips.canWatch && loadError == nil {
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
            if phase == .active { store.resume(); takeShared(); Task { await load(); await update.check() } }
            if phase == .background && cameraOpen { model.wentToBackground() }
        }
        // A finished upload shows up in the kid's history.
        .onChange(of: store.jobs.filter { $0.upload == .uploaded }.count) { Task { await load() } }
        .onChange(of: model.clips.isSignedIn) { _, signedIn in
            // (A demo run keeps its made-up kids even if the simulator is signed in.)
            guard !Self.demo else { return }
            if signedIn { store.resume() }
            // Signing in or out switches between the family's Clips and watch-only.
            Task { await loadKids() }
        }
        // The stored sign-in has been checked: now it's known whose Clips to show.
        .onChange(of: model.clips.checkedSession) { Task { await loadKids() } }
        .fullScreenCover(isPresented: $cameraOpen, onDismiss: {
            model.cameraClosed()
            Orientation.lock(.portrait)
            if let kid = model.settings.game?.kid.id, kid != kidID { kidID = kid }
            showPendingImport()
        }) {
            CameraView(model: model) { cameraOpen = false }
        }
        .sheet(item: $newGameFor) { kid in
            NewGameSheet(kid: kid) { game in model.settings.setCurrentGame(game) }
        }
        // Home is upright-only; videos can turn sideways.
        .fullScreenCover(item: $playing, onDismiss: { Orientation.lock(.portrait); showPendingImport() }) { item in
            PlayerScreen(url: item.url).onAppear {
                Orientation.lock(.allButUpsideDown)
                TrimView.playWithSound()
            }
        }
        .fullScreenCover(item: $reelPlaying, onDismiss: { Orientation.lock(.portrait); showPendingImport() }) { item in
            ReelPlayerScreen(
                item: item,
                gameID: gameID(of: item.id),
                onRelabel: watching ? nil : { pitches in applyLabels(item.id, pitches) },
                onShare: { options, framing, pitches in
                    await shareReel(item.id, options: options, framing: framing, pitches: pitches)
                }
            )
            .onAppear {
                Orientation.lock(.allButUpsideDown)
                TrimView.playWithSound()
            }
        }
        .sheet(item: $shareChoice, onDismiss: {
            if let p = pendingShare { Task { await shareReel(p.id, options: p.options, framing: p.framing, pitches: nil) } }
            pendingShare = nil
        }) { target in
            ShareOptionsSheet(availability: shareAvailability(target.id), atBatID: target.id, gameID: gameID(of: target.id),
                              sources: { await framingSources(target.id) }) { pendingShare = (target.id, $0, $1) }
        }
        .alert("Can't share", isPresented: .constant(shareError != nil), presenting: shareError) { _ in
            Button("OK") { shareError = nil }
        } message: { Text($0) }
        .alert("Can't delete", isPresented: .constant(deleteError != nil), presenting: deleteError) { _ in
            Button("OK") { deleteError = nil }
        } message: { Text($0) }
        .alert("Can't save the changes", isPresented: .constant(editError != nil), presenting: editError) { _ in
            Button("OK") { editError = nil }
        } message: { Text($0) }
        .sheet(item: $editing) { target in
            PitchEditor(target: target) { pitches in save(target, pitches: pitches) }
        }
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
        // Builds without watch-only (development) need a sign-in to show anything.
        .fullScreenCover(isPresented: .constant(model.clips.checkedSession && !model.clips.canWatch && !Self.demo)) {
            SignInView(clips: model.clips)
        }
        .sheet(isPresented: Binding(get: { showingSignIn && !model.clips.isSignedIn }, set: { showingSignIn = $0 })) {
            SignInView(clips: model.clips)
        }
    }

    /// Bringing in GameChanger clips: from the share sheet or Photos, or an
    /// at-bat's own being re-trimmed.
    private func fieldViewFlow(_ content: some View) -> some View {
        content
            .onOpenURL { url in
                guard url.host() == "import" else { return }
                takeShared()
            }
            .photosPicker(isPresented: $choosingVideo, selection: $pickedVideo, matching: .videos, preferredItemEncoding: .current)
            .onChange(of: pickedVideo) { _, item in
                guard let item else { return }
                pickedVideo = nil
                loadPicked(item)
            }
            .fullScreenCover(item: $importing, onDismiss: { Orientation.lock(.portrait) }) { request in
                FieldViewImportView(
                    request: request, clipURL: store.url(request.file), kids: kids, kidID: $kidID,
                    sections: sections, posters: posters,
                    onDone: { start, end, decision in
                        importing = nil
                        place(request, start: start, end: end, decision)
                    },
                    onCancel: {
                        importing = nil
                        store.discardClip(request.file)
                    }
                )
            }
            .alert("Can't add the video", isPresented: .constant(importError != nil), presenting: importError) { _ in
                Button("OK") { importError = nil }
            } message: { Text($0) }
            .confirmationDialog(
                "Remove the field view?",
                isPresented: Binding(get: { removingFieldView != nil }, set: { if !$0 { removingFieldView = nil } }),
                titleVisibility: .visible,
                presenting: removingFieldView
            ) { target in
                Button("Remove field view", role: .destructive) { removeFieldView(target) }
            } message: { _ in
                Text("The at-bat goes back to just your video, and the GameChanger clip is deleted from Clips.")
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
        // Watching, there's no filming.
        let current = watching ? nil : currentGame
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
                            let target = FieldViewTarget(atBat: ab, game: section, number: number)
                            let canChange = ab.isCamera && !isRebuilding(ab.id) && store.canChangeFieldView(ab.id)
                            HistoryCard(atBat: ab, poster: ab.posterPath.flatMap { posters[$0] },
                                        sharing: sharing == ab.id || fetchingFieldView == ab.id,
                                        rebuilding: isRebuilding(ab.id),
                                        updateFailed: updateFailure(ab.id) != nil,
                                        onRetry: { store.retry(ab.id) },
                                        onOpen: { open(ab) },
                                        onShare: { share(ab, game: section, number: number) },
                                        onEdit: !watching && ab.isCamera && !ab.isFieldOnly && !isRebuilding(ab.id) ? { edit(ab, title: "AB \(number) · \(section.name)") } : nil,
                                        onAddFieldView: !watching && canChange && !ab.hasFieldView ? { pickingFor = target; choosingVideo = true } : nil,
                                        onTrimFieldView: !watching && canChange && ab.hasFieldView ? { retrim(target) } : nil,
                                        onRemoveFieldView: !watching && canChange && ab.hasFieldView && !ab.isFieldOnly ? { removingFieldView = target } : nil,
                                        onDelete: watching ? nil : { deleting = (ab, section, number) })
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
            Text(loadError ?? (kidID == nil ? "Loading…" : watching ? "No at-bats yet." : "No games yet — tap + to start one."))
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
                .overlay(alignment: .topTrailing) { if job.fieldView != nil { FieldViewBadge() } }
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
            if job.isReel, let item = localReelItem(job, labels: nil) {
                reelPlaying = item
            } else if let file = job.editFile {
                playing = PlayItem(url: store.url(file))
            }
        }
        .contextMenu {
            if job.editFile != nil {
                Button { shareLocal(job) } label: { Label("Share", systemImage: "square.and.arrow.up") }
            }
            if job.isFilmed && job.state != .building && job.upload != .uploading && job.upload != .finishing {
                Button { editLocal(job) } label: { Label("Edit pitches", systemImage: "pencil") }
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
          {"id":"\(UUID())","source":"camera","status":"ready","result":"KL","recorded_at":"2026-10-11T16:40:00Z","created_at":"2026-10-11T16:40:00Z","clip_pitches":[{"outcome":"called_strike"},{"outcome":"swinging_strike"},{"outcome":"ball"},{"outcome":"called_strike"}]},
          {"id":"\(UUID())","source":"camera","status":"ready","result":"2B","recorded_at":"2026-10-11T17:20:00Z","created_at":"2026-10-11T17:20:00Z","field_view_path":"g/a/gamechanger-1.mp4","closeup_path":"g/a/closeup.mp4","clip_pitches":[{"outcome":"foul"},{"outcome":"in_play"}]},
          {"id":"\(UUID())","source":"camera","status":"ready","result":"GO","recorded_at":"2026-10-11T17:50:00Z","created_at":"2026-10-11T17:50:00Z","field_view_path":"g/b/gamechanger-2.mp4","clip_pitches":[]}]},
         {"id":"\(UUID())","name":"Merchants Scrimmage","played_on":"2026-09-26","clip_at_bats":[
          {"id":"\(UUID())","source":"upload","status":"ready","result":"FO","recorded_at":"2026-09-26T17:00:00Z","created_at":"2026-09-26T17:00:00Z","clip_pitches":[{"outcome":"ball"},{"outcome":"in_play"}]}]}]
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        history[sebastian.id] = (try? decoder.decode([HistoryGame].self, from: Data(json.utf8))) ?? []
        if let g = history[sebastian.id]?.first {
            model.settings.setCurrentGame(GameChoice(id: g.id, kid: sebastian, name: g.name, playedOn: GameChoice.day(Date()), priorAtBats: 2))
        }
        // `-demoHome -demo`: straight into the camera, mid-at-bat.
        if ProcessInfo.processInfo.arguments.contains("-demo") { cameraOpen = true }
        let args = ProcessInfo.processInfo.arguments
        // `-demoHome -demoReel /path/reel.mp4`: the live player on that video,
        // cut into made-up pitch windows (3s each; a ball, a foul, in play).
        if let i = args.firstIndex(of: "-demoReel"), i + 1 < args.count {
            let segments = (0..<3).map { ReelSegment(start: Double($0) * 3, end: Double($0 + 1) * 3, fps: $0 == 0 ? 60 : 240, pitch: $0) }
            let pitches = [Pitch(t: 2, outcome: .ball), Pitch(t: 5, outcome: .foul),
                           Pitch(t: 8, outcome: .inPlay, battedBall: .lineDrive, playResult: .double)]
            let item = ReelItem(id: UUID(), title: "AB 2 · vs Kabuki", reel: URL(fileURLWithPath: args[i + 1]), segments: segments,
                                pitches: pitches, result: .double,
                                fieldView: FieldViewPlayback(url: URL(fileURLWithPath: args[i + 1]), start: 1, end: 4))
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1))
                reelPlaying = item
                // `-demoLandscape`: turned sideways, as it's usually watched.
                if args.contains("-demoLandscape") {
                    try? await Task.sleep(for: .seconds(1))
                    Orientation.lock(.landscapeRight)
                }
            }
        }
        // `-demoHome -demoImport /path/clip.mp4` (add `-demoPick` for the
        // at-bat picker): the GameChanger trimmer with that clip.
        if let i = args.firstIndex(of: "-demoImport"), i + 1 < args.count,
           let file = try? store.importClip(from: URL(fileURLWithPath: args[i + 1])) {
            // After the home screen is up, as when a clip comes in for real.
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1))
                importing = FieldViewRequest(file: file)
            }
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
        let mine = Set(store.jobs.filter { $0.kind != .attach }.map(\.id))
        return GameChoice(id: newest.id, kid: kid, name: newest.name, playedOn: newest.playedOn,
                          priorAtBats: newest.atBats.filter { !mine.contains($0.id) }.count)
    }

    /// Phone at-bats play here (from this phone if the file's still on it);
    /// videos uploaded on the website open there, where their markers live.
    private func open(_ ab: HistoryAtBat) {
        if ab.isReel {
            openReel(ab)
            return
        }
        guard ab.isCamera, let path = ab.playbackPath else {
            // The website needs a sign-in, so watching there's nowhere to go.
            if !watching { openURL(ab.webURL) }
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
        if ab.isReel {
            shareChoice = ReelShareTarget(id: ab.id)
            return
        }
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
                if !watching { openURL(ab.webURL) } // no export yet — make one in Clips
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

    /// A phone at-bat being rebuilt after its labels changed, until the new
    /// video is in Clips.
    private func isRebuilding(_ id: UUID) -> Bool {
        guard let job = store.jobs.first(where: { $0.id == id }), job.revision != nil else { return false }
        return updateFailure(id) == nil && (job.state == .building || (job.upload != nil && job.upload != .uploaded))
    }

    /// Why a changed video didn't make it into Clips (it's waiting on Retry).
    private func updateFailure(_ id: UUID) -> String? {
        guard let job = store.jobs.first(where: { $0.id == id }), job.revision != nil else { return nil }
        if case .failed(let why) = job.state { return why }
        if case .failed(let why)? = job.upload { return why }
        return nil
    }

    /// Edit an at-bat in Clips: from this phone's copy when the full
    /// recording's still here (so the video can be rebuilt), else the labels
    /// as Clips has them.
    private func edit(_ ab: HistoryAtBat, title: String) {
        if store.canRebuild(ab.id), let job = store.jobs.first(where: { $0.id == ab.id }) {
            editing = PitchEditTarget(id: ab.id, title: title, pitches: job.pitches, rebuild: true, liveCaptions: ab.isReel)
            return
        }
        editing = PitchEditTarget(id: ab.id, title: title, pitches: nil, rebuild: false, liveCaptions: ab.isReel)
        Task {
            do {
                let pitches = try await model.clips.pitches(atBatID: ab.id, result: ab.result)
                if editing?.id == ab.id { editing?.pitches = pitches }
            } catch {
                if editing?.id == ab.id { editing?.loadError = "Check your signal and try again." }
            }
        }
    }

    /// Edit an at-bat that's only on this phone so far.
    private func editLocal(_ job: AtBatJob) {
        let title = "AB \(store.number(of: job) ?? 1)" + (job.game.map { " · \($0.name)" } ?? "")
        editing = PitchEditTarget(id: job.id, title: title, pitches: job.pitches, rebuild: store.canRebuild(job.id), liveCaptions: job.isReel)
    }

    private func save(_ target: PitchEditTarget, pitches: [Pitch]) {
        applyLabels(target.id, pitches)
    }

    /// New labels for an at-bat, matched to its pitches by id. A finished
    /// edit is rebuilt when its recording's still here (its captions are
    /// burned in). A reel's captions are live, so it's only rebuilt when the
    /// labels change its cuts — a take became a swing (it needs every frame)
    /// or contact (a longer window) — and the recording's still here.
    private func applyLabels(_ id: UUID, _ labeled: [Pitch]) {
        let inClips = history.values.joined().flatMap(\.atBats).contains { $0.id == id }
        if let job = store.jobs.first(where: { $0.id == id }), store.canRebuild(id) {
            let merged = job.pitches.map { p in
                guard let l = labeled.first(where: { $0.id == p.id }) else { return p }
                var q = p
                q.outcome = l.outcome
                q.battedBall = l.battedBall
                q.playResult = l.playResult
                return q
            }
            if !job.isReel || ReelPlan.needsRebuild(old: job.pitches, new: merged, duration: job.rawDuration, timings: AppSettings.shared.timings) {
                store.rebuild(id, pitches: merged)
                if job.isReel && inClips { Task { try? await model.clips.relabel(atBatID: id, pitches: merged) } }
                return
            }
        }
        guard inClips else {
            store.setLabels(id, pitches: labeled)
            return
        }
        Task {
            do {
                try await model.clips.relabel(atBatID: id, pitches: labeled)
                store.setLabels(id, pitches: labeled)
                await load()
            } catch {
                editError = "Couldn't reach Clips — check your signal and try again."
            }
        }
    }

    // MARK: Reels

    /// Play a reel: from this phone when it's still here, else from Clips.
    private func openReel(_ ab: HistoryAtBat) {
        Task {
            do {
                if let item = try await reelItem(ab) { reelPlaying = item }
            } catch {
                shareError = "Couldn't load the video — check your signal."
            }
        }
    }

    /// A Clips at-bat's reel, from this phone when it's still here.
    private func reelItem(_ ab: HistoryAtBat) async throws -> ReelItem? {
        let title = atBatTitle(ab.id)
        if let job = store.jobs.first(where: { $0.id == ab.id }), job.isFilmed,
           var item = localReelItem(job, labels: ab.pitchList) {
            item.title = title
            item.fieldView = await fieldViewPlayback(ab)
            return item
        }
        guard let path = ab.playbackPath, let segments = ab.reel else { return nil }
        let url = try await model.clips.videoURL(path)
        return ReelItem(id: ab.id, title: title, reel: url, segments: segments, pitches: ab.pitchList,
                        result: ab.result, fieldView: await fieldViewPlayback(ab))
    }

    /// A reel built on this phone, at its reel times; labels from Clips when
    /// given (they may have been changed elsewhere).
    private func localReelItem(_ job: AtBatJob, labels: [Pitch]?) -> ReelItem? {
        guard let file = job.editFile, FileManager.default.fileExists(atPath: store.url(file).path),
              let segments = job.reelSegments else { return nil }
        let request = store.shareRequest(job.id, options: .standard)
        var pitches = request.pitches
        if let labels {
            for i in pitches.indices {
                guard let l = labels.first(where: { $0.id == pitches[i].id }) else { continue }
                pitches[i].outcome = l.outcome
                pitches[i].battedBall = l.battedBall
                pitches[i].playResult = l.playResult
            }
        }
        let fv = request.fieldView.map { FieldViewPlayback(url: $0.url, start: $0.start, end: $0.end) }
        return ReelItem(id: job.id, title: atBatTitle(job.id), reel: store.url(file), segments: segments,
                        pitches: pitches, result: Scorebook.outcome(pitches)?.result ?? job.result, fieldView: fv)
    }

    /// The field view to run on into: this phone's copy, else Clips'.
    private func fieldViewPlayback(_ ab: HistoryAtBat) async -> FieldViewPlayback? {
        guard let path = ab.fieldViewPath, let start = ab.fieldViewStart, let end = ab.fieldViewEnd else { return nil }
        if let local = store.fieldViewFile(ab.id) { return FieldViewPlayback(url: local, start: start, end: end) }
        guard let url = try? await model.clips.videoURL(path) else { return nil }
        return FieldViewPlayback(url: url, start: start, end: end)
    }

    /// "AB 2 · vs Kabuki"
    private func atBatTitle(_ id: UUID) -> String {
        if let (_, game, number) = findAtBat(id) {
            return "AB \(number) · \(game.name)"
        }
        if let job = store.jobs.first(where: { $0.id == id }) {
            return "AB \(store.number(of: job) ?? 1)" + (job.game.map { " · \($0.name)" } ?? "")
        }
        return "At-bat"
    }

    private func findAtBat(_ id: UUID) -> (HistoryAtBat, GameSection, Int)? {
        for section in sections {
            for card in section.cards {
                if case .atBat(let ab, let number) = card, ab.id == id { return (ab, section, number) }
            }
        }
        return nil
    }

    /// What a reel has to share: a field view, a ball in play.
    private func shareAvailability(_ id: UUID) -> ShareAvailability {
        let job = store.jobs.first { $0.id == id }
        if let (ab, _, _) = findAtBat(id) {
            let pitches = ab.pitchList.isEmpty ? (job?.pitches ?? []) : ab.pitchList
            return ShareAvailability(pitches: pitches, hasFieldView: ab.fieldViewPath != nil && ab.fieldViewStart != nil && ab.fieldViewEnd != nil)
        }
        guard let job else { return ShareAvailability(hasFieldView: false, hasHit: false) }
        return ShareAvailability(pitches: job.pitches, hasFieldView: job.fieldView?.file != nil)
    }

    /// The game an at-bat is filed under.
    private func gameID(of id: UUID) -> UUID? {
        findAtBat(id)?.1.id ?? store.jobs.first { $0.id == id }?.game?.id
    }

    /// The footage a vertical share is framed from: the reel as the player
    /// would play it.
    private func framingSources(_ id: UUID) async -> FramingSources? {
        let item: ReelItem?
        if let (ab, _, _) = findAtBat(id) {
            item = try? await reelItem(ab)
        } else if let job = store.jobs.first(where: { $0.id == id }) {
            item = localReelItem(job, labels: nil)
        } else {
            item = nil
        }
        return item.map { FramingSources(reel: $0.reel, segments: $0.segments, pitches: $0.pitches, fieldView: $0.fieldView) }
    }

    /// Render a reel for sharing with the chosen options and open the share
    /// sheet. `pitches` are the player's labels, if it's open.
    private func shareReel(_ id: UUID, options: ShareOptions, framing: Framing, pitches: [Pitch]?) async {
        sharing = id
        defer { sharing = nil }
        do {
            var request: ShareRequest
            var name: String
            if let (ab, game, number) = findAtBat(id), let segments = ab.reel {
                let job = store.jobs.first { $0.id == id }
                if let job, job.isFilmed, let file = job.editFile, FileManager.default.fileExists(atPath: store.url(file).path),
                   job.reelSegments != nil {
                    request = store.shareRequest(id, options: options)
                } else {
                    guard let path = ab.playbackPath else { return }
                    request = ShareRequest(atBatID: id, reel: try await cachedDownload(path), segments: segments,
                                           pitches: ab.pitchList, result: ab.result,
                                           card: TitleCard(title: "", subtitle: ""), options: options, reelKey: path)
                }
                let labels = pitches ?? (ab.pitchList.isEmpty ? request.pitches : ab.pitchList)
                for i in request.pitches.indices {
                    guard let l = labels.first(where: { $0.id == request.pitches[i].id }) else { continue }
                    request.pitches[i].outcome = l.outcome
                    request.pitches[i].battedBall = l.battedBall
                    request.pitches[i].playResult = l.playResult
                }
                request.result = Scorebook.outcome(request.pitches)?.result ?? ab.result
                request.card = TitleCard.make(number: number, result: request.result, game: game.name, playedOn: game.playedOn)
                if let fvPath = ab.fieldViewPath, let start = ab.fieldViewStart, let end = ab.fieldViewEnd {
                    var clip = store.fieldViewFile(id)
                    if clip == nil { clip = try await cachedDownload(fvPath) }
                    request.fieldView = (clip!, start, end, fvPath)
                }
                let kid = kids.first { $0.id == kidID }?.firstName
                name = Self.fileName(kid: kid, game: game.name, number: number, result: request.result, day: game.playedOn)
            } else if let job = store.jobs.first(where: { $0.id == id }) {
                request = store.shareRequest(id, options: options)
                if let pitches {
                    for i in request.pitches.indices {
                        guard let l = pitches.first(where: { $0.id == request.pitches[i].id }) else { continue }
                        request.pitches[i].outcome = l.outcome
                        request.pitches[i].battedBall = l.battedBall
                        request.pitches[i].playResult = l.playResult
                    }
                    request.result = Scorebook.outcome(request.pitches)?.result ?? job.result
                }
                name = Self.fileName(kid: job.game?.kid.firstName, game: job.game?.name, number: store.number(of: job) ?? 1,
                                     result: request.result, day: job.game?.playedOn)
            } else {
                return
            }
            request.framing = framing
            let file = try await ShareRenderer.render(request)
            presentShare(copying: file, as: name)
        } catch {
            shareError = "Couldn't make the video: \(error.localizedDescription)"
        }
    }

    /// A file from Clips, kept in the caches folder for next time.
    private func cachedDownload(_ path: String) async throws -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(path.replacingOccurrences(of: "/", with: "_"))
        if FileManager.default.fileExists(atPath: file.path) { return file }
        try await model.clips.download(path, to: file)
        return file
    }

    private func shareLocal(_ job: AtBatJob) {
        if job.isReel {
            shareChoice = ReelShareTarget(id: job.id)
            return
        }
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

    // MARK: Field views

    /// Put a clip up for trimming now, or once the camera or a video closes.
    private func present(_ request: FieldViewRequest) {
        if cameraOpen || playing != nil || importing != nil {
            if let old = pendingImport { store.discardClip(old.file) }
            pendingImport = request
        } else {
            importing = request
        }
    }

    private func showPendingImport() {
        guard let request = pendingImport else { return }
        pendingImport = nil
        // Let the closing screen finish going away first.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            present(request)
        }
    }

    /// Clips the share sheet dropped off: the newest is opened, any older
    /// ones were abandoned and are cleared out.
    private func takeShared() {
        let waiting = SharedInbox.waiting()
        guard let newest = waiting.last else { return }
        // Watching can't add videos to Clips.
        guard !watching else {
            for file in waiting { try? FileManager.default.removeItem(at: file) }
            return
        }
        defer { for file in waiting { try? FileManager.default.removeItem(at: file) } }
        do {
            present(FieldViewRequest(file: try store.importClip(from: newest)))
        } catch {
            importError = "Couldn't open the shared video: \(error.localizedDescription)"
        }
    }

    private func loadPicked(_ item: PhotosPickerItem) {
        let target = pickingFor
        pickingFor = nil
        Task {
            do {
                guard let movie = try await item.loadTransferable(type: PickedMovie.self) else { return }
                defer { try? FileManager.default.removeItem(at: movie.url) }
                let file = try store.importClip(from: movie.url)
                // Let the Photos picker finish closing before the trimmer opens.
                try? await Task.sleep(for: .milliseconds(500))
                present(FieldViewRequest(file: file, target: target))
            } catch {
                importError = "Couldn't load that video from Photos."
            }
        }
    }

    /// Re-trim an at-bat's field view, fetching the GameChanger clip from
    /// Clips when it isn't on this phone.
    private func retrim(_ target: FieldViewTarget) {
        let ab = target.atBat
        guard let path = ab.fieldViewPath else { return }
        if let local = store.fieldViewFile(ab.id) {
            present(FieldViewRequest(file: local.lastPathComponent, existingPath: path, target: target,
                                     start: ab.fieldViewStart, end: ab.fieldViewEnd))
            return
        }
        fetchingFieldView = ab.id
        Task {
            defer { fetchingFieldView = nil }
            let name = "gc-\(UUID().uuidString).\((path as NSString).pathExtension)"
            do {
                try await model.clips.download(path, to: store.url(name))
                present(FieldViewRequest(file: name, existingPath: path, target: target,
                                         start: ab.fieldViewStart, end: ab.fieldViewEnd))
            } catch {
                importError = "Couldn't download the GameChanger video — check your signal."
            }
        }
    }

    /// Hand the trimmed clip to the store: onto an at-bat, or as a new one.
    private func place(_ request: FieldViewRequest, start: Double, end: Double, _ decision: FieldViewDecision) {
        let clip: FieldViewClip = request.existingPath.map { .existing(path: $0, file: request.file) } ?? .imported(file: request.file)
        switch decision {
        case .attach(let target):
            guard let kid = kids.first(where: { $0.id == kidID }) else { return }
            guard store.canChangeFieldView(target.atBat.id) else {
                importError = "That at-bat's video is still being updated — try again when it's done."
                store.discardClip(request.file)
                return
            }
            let game = GameChoice(id: target.game.id, kid: kid, name: target.game.name, playedOn: target.game.playedOn)
            store.addFieldView(to: target.atBat, game: game, number: target.number, clip: clip, start: start, end: end)
        case .new(let game, let result, let number, let recordedAt):
            store.addFieldOnly(game: game, number: number, result: result, recordedAt: recordedAt, clip: clip, start: start, end: end)
            if kidID != game.kid.id { kidID = game.kid.id }
        }
    }

    private func removeFieldView(_ target: FieldViewTarget) {
        Task {
            do {
                try await model.clips.removeFieldView(target.atBat)
                store.fieldViewRemoved(target.atBat.id)
                await load()
            } catch {
                importError = "Couldn't remove it — check your signal and try again."
            }
        }
    }

    private func loadKids() async {
        guard !Self.demo, model.clips.checkedSession, model.clips.canWatch else { return }
        if let kids = try? await model.clips.kids(), !kids.isEmpty {
            model.settings.cachedKids = kids
        }
        // (Also when the tab's kid isn't in the list: signing out leaves only
        // the kids with at-bats.)
        if kidID != Self.unfiledTab, kidID == nil || !kids.contains(where: { $0.id == kidID }) {
            kidID = model.settings.game?.kid.id ?? kids.first?.id
        }
        await load()
    }

    private func load() async {
        guard !Self.demo, model.clips.canWatch, let kidID, let kid = kids.first(where: { $0.id == kidID }) else { return }
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
struct CardGrid<Content: View>: View {
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
    let rebuilding: Bool
    /// The changed video didn't make it into Clips; this phone still has it.
    let updateFailed: Bool
    let onRetry: () -> Void
    let onOpen: () -> Void
    let onShare: () -> Void
    let onEdit: (() -> Void)?
    let onAddFieldView: (() -> Void)?
    let onTrimFieldView: (() -> Void)?
    let onRemoveFieldView: (() -> Void)?
    let onDelete: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Thumbnail(url: poster)
                .overlay(alignment: .topLeading) { if let r = atBat.result { ResultBadge(result: r) } }
                .overlay(alignment: .topTrailing) { if atBat.hasFieldView { FieldViewBadge() } }
                // Fetching the video for Share (or a field view to re-trim).
                .overlay(alignment: .bottomTrailing) {
                    if sharing { ProgressView().tint(.white).padding(10) }
                }
                .overlay {
                    if rebuilding {
                        VStack(spacing: 6) {
                            ProgressView().tint(.white)
                            Text("Updating video…").font(.caption2.weight(.semibold)).foregroundStyle(.white)
                        }
                        .padding(10)
                        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                    } else if updateFailed {
                        Button(action: onRetry) {
                            VStack(spacing: 4) {
                                Label("Not in Clips yet", systemImage: "exclamationmark.triangle.fill")
                                    .font(.caption2.weight(.semibold))
                                Text("Tap to retry").font(.caption2)
                            }
                            .foregroundStyle(.white)
                            .padding(10)
                            .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }
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
            if let onEdit {
                Button(action: onEdit) { Label("Edit pitches", systemImage: "pencil") }
            }
            if let onAddFieldView {
                Button(action: onAddFieldView) { Label("Add GameChanger video", systemImage: "film.stack") }
            }
            if let onTrimFieldView {
                Button(action: onTrimFieldView) { Label("Trim field view", systemImage: "timeline.selection") }
            }
            if let onRemoveFieldView {
                Button(role: .destructive, action: onRemoveFieldView) { Label("Remove field view", systemImage: "rectangle.badge.minus") }
            }
            if let onDelete {
                Button(role: .destructive, action: onDelete) { Label("Delete from Clips", systemImage: "trash") }
            }
        }
    }

    private var detail: String {
        guard atBat.pitches > 0 else { return atBat.hasFieldView ? "Field view" : "Not marked yet" }
        var parts = ["\(atBat.pitches) pitch\(atBat.pitches == 1 ? "" : "es")"]
        if atBat.swings > 0 { parts.append("\(atBat.swings) swing\(atBat.swings == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }
}

/// The result in the thumbnail's corner, as on the website ("1B", "BB", "ꓘ").
struct ResultBadge: View {
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

/// Top-right on a card whose video ends with a GameChanger field view —
/// "GC", styled like the result badge opposite.
private struct FieldViewBadge: View {
    var body: some View {
        Text("GC")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 5))
            .padding(6)
            .accessibilityLabel("Has GameChanger field view")
    }
}

struct Thumbnail: View {
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

/// A reel whose Share was tapped, waiting on the share options.
struct ReelShareTarget: Identifiable {
    let id: UUID
}

struct PlayItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// Plays an at-bat starting just after its title card (the card is for shared
/// copies), and goes back there when it ends so Play replays from the top.
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
        .task {
            let asset = AVURLAsset(url: url)
            // Files from before the mark all have the standard card.
            let intro = await EditRenderer.IntroMark.seconds(in: asset) ?? EditTimings.standard.titleCard
            let start = CMTime(seconds: intro, preferredTimescale: 600)
            let item = AVPlayerItem(asset: asset)
            let p = AVPlayer(playerItem: item)
            if intro > 0 { await p.seek(to: start, toleranceBefore: .zero, toleranceAfter: .zero) }
            player = p
            p.play()
            for await _ in NotificationCenter.default.notifications(named: AVPlayerItem.didPlayToEndTimeNotification, object: item) {
                await p.seek(to: start, toleranceBefore: .zero, toleranceAfter: .zero)
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
