import AVFoundation
import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers

// Bringing in a GameChanger clip — the wide field camera's look at the whole
// play. Trim it first (watching it is how you recognize the at-bat), then pick
// the at-bat it goes on the end of, or make a new at-bat of it alone.

/// A clip waiting to be trimmed and placed.
struct FieldViewRequest: Identifiable {
    let id = UUID()
    /// The clip, in the at-bat store's folder.
    let file: String
    /// Where the clip already is in Clips, when an at-bat's field view is
    /// being re-trimmed.
    var existingPath: String?
    /// Goes straight onto this at-bat (from its menu), skipping the picker.
    var target: FieldViewTarget?
    var start: Double?
    var end: Double?
}

struct FieldViewTarget {
    let atBat: HistoryAtBat
    let game: GameSection
    let number: Int
}

/// What was decided, for the home screen to hand to the store.
enum FieldViewDecision {
    case attach(FieldViewTarget)
    case new(game: GameChoice, result: AtBatResult, number: Int, recordedAt: Date)
}

struct FieldViewImportView: View {
    let request: FieldViewRequest
    let clipURL: URL
    let kids: [Kid]
    @Binding var kidID: UUID?
    /// The current kid's games, newest first.
    let sections: [GameSection]
    let posters: [String: URL]
    let onDone: (_ start: Double, _ end: Double, FieldViewDecision) -> Void
    let onCancel: () -> Void

    @State private var start = 0.0
    @State private var end = 0.0
    @State private var picking = false
    @State private var clipDate: Date?

    var body: some View {
        NavigationStack {
            TrimView(url: clipURL, start: $start, end: $end, initial: (request.start, request.end))
                .navigationTitle(request.target.map { "AB \($0.number) · field view" } ?? "Trim field view")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                    ToolbarItem(placement: .confirmationAction) {
                        if let target = request.target {
                            Button("Save") { onDone(start, end, .attach(target)) }.disabled(end - start < 1)
                        } else {
                            Button("Next") { picking = true }.disabled(end - start < 1)
                        }
                    }
                }
                .navigationDestination(isPresented: $picking) {
                    AtBatPicker(kids: kids, kidID: $kidID, sections: sections, posters: posters, clipDate: clipDate) { decision in
                        onDone(start, end, decision)
                    }
                }
        }
        // Solid, not see-through: the home screen mustn't show behind it.
        .presentationBackground(Color(.systemBackground))
        // Turns sideways for a bigger look at the play (home stays upright).
        .onAppear { Orientation.lock(.allButUpsideDown) }
        .task {
            clipDate = await Self.recordedDate(clipURL)
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-demoPick") { picking = true }
            #endif
        }
    }

    /// When GameChanger's clip was recorded, if the file says.
    static func recordedDate(_ url: URL) async -> Date? {
        guard let item = try? await AVURLAsset(url: url).load(.creationDate) else { return nil }
        return try? await item.load(.dateValue)
    }
}

// MARK: - Trimming

/// Photos-style trimming: the clip plays on a loop between two handles on a
/// filmstrip. Opens with the whole clip selected.
struct TrimView: View {
    let url: URL
    @Binding var start: Double
    @Binding var end: Double
    /// A previous trim to start from.
    let initial: (start: Double?, end: Double?)

    @State private var player = AVPlayer()
    @State private var duration = 0.0
    @State private var frames: [CGImage] = []
    @State private var playhead = 0.0
    /// Starts paused on the first frame; tap the picture (or play) to watch.
    @State private var playing = false
    @State private var observer: Any?
    @State private var loadError: String?
    /// Which handle is being dragged.
    @State private var dragging: Handle?

    private enum Handle { case start, end }
    private static let minLength = 1.0
    private static let handleWidth: CGFloat = 18

    var body: some View {
        GeometryReader { geo in
            // Sideways, the picture takes all the height the strip and
            // controls leave; upright it sits at the top, full width.
            let wide = geo.size.width > geo.size.height
            content(wide: wide)
                .padding(wide ? [.horizontal, .bottom] : .all)
        }
        .task { await load() }
        .onAppear { Self.playWithSound() }
        .onDisappear {
            player.pause()
            if let observer { player.removeTimeObserver(observer) }
        }
    }

    /// Sound even with the ringer switched to silent, as the Photos app plays
    /// videos. The camera sets its own audio up again when it starts.
    static func playWithSound() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    private func content(wide: Bool) -> some View {
        VStack(spacing: wide ? 10 : 20) {
            PlayerLayerView(player: player)
                .aspectRatio(16 / 9, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: wide ? .infinity : nil)
                .background(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay {
                    if let loadError {
                        Text(loadError).font(.callout).foregroundStyle(.secondary).padding()
                    } else if duration == 0 {
                        ProgressView()
                    }
                }
                .onTapGesture { togglePlay() }
            if duration > 0 {
                filmstrip.frame(height: 56)
                HStack {
                    Button { togglePlay() } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill").font(.title3)
                    }
                    Spacer()
                    Text("\(Self.clock(start)) – \(Self.clock(end))").monospacedDigit()
                        .accessibilityIdentifier("trim-range")
                    Spacer()
                    Text(String(format: "%.0fs", end - start)).monospacedDigit().foregroundStyle(.secondary)
                }
                .font(.subheadline)
                if !wide {
                    Text("Drag the yellow handles to keep just the play.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if !wide { Spacer() }
        }
    }

    private var filmstrip: some View {
        GeometryReader { geo in
            let w = geo.size.width - Self.handleWidth * 2
            let x = { (t: Double) in Self.handleWidth + CGFloat(t / duration) * w }
            ZStack(alignment: .topLeading) {
                HStack(spacing: 0) {
                    ForEach(frames.indices, id: \.self) { i in
                        Image(decorative: frames[i], scale: 1)
                            .resizable().scaledToFill()
                            .frame(width: w / CGFloat(max(frames.count, 1)), height: geo.size.height)
                            .clipped()
                    }
                }
                .frame(width: w, height: geo.size.height)
                .background(Color.secondary.opacity(0.3))
                .offset(x: Self.handleWidth)
                // Dimmed outside the kept stretch.
                Color.black.opacity(0.55).frame(width: max(0, x(start) - Self.handleWidth), height: geo.size.height)
                    .offset(x: Self.handleWidth)
                Color.black.opacity(0.55).frame(width: max(0, x(duration) - x(end)), height: geo.size.height)
                    .offset(x: x(end))
                // The kept stretch, framed in yellow with a handle each end.
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(Color.yellow, lineWidth: 3)
                    .frame(width: x(end) - x(start) + Self.handleWidth * 2, height: geo.size.height)
                    .offset(x: x(start) - Self.handleWidth)
                    .allowsHitTesting(false)
                handle(.start, chevron: "chevron.compact.left", height: geo.size.height)
                    .offset(x: x(start) - Self.handleWidth)
                    .gesture(drag(.start, width: w))
                handle(.end, chevron: "chevron.compact.right", height: geo.size.height)
                    .offset(x: x(end))
                    .gesture(drag(.end, width: w))
                // Where it's playing.
                Rectangle().fill(.white).frame(width: 2, height: geo.size.height + 8)
                    .offset(x: x(playhead) - 1, y: -4)
                    .allowsHitTesting(false)
            }
        }
    }

    private func handle(_ which: Handle, chevron: String, height: CGFloat) -> some View {
        Color.yellow
            .frame(width: Self.handleWidth, height: height)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay { Image(systemName: chevron).font(.headline.weight(.bold)).foregroundStyle(.black) }
            .contentShape(Rectangle().inset(by: -12))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(which == .start ? "Start" : "End")
            .accessibilityIdentifier(which == .start ? "Start" : "End")
    }

    /// Dragging a handle moves that end and shows its frame; letting go plays
    /// the kept stretch from the top.
    private func drag(_ which: Handle, width: CGFloat) -> some Gesture {
        // Measured on the screen: the handle moves with the finger.
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { g in
                if dragging == nil {
                    dragging = which
                    player.pause()
                }
                let dt = Double(g.translation.width / width) * duration
                let base = (which == .start ? dragBase.start : dragBase.end)
                switch which {
                case .start: start = min(max(0, base + dt), end - Self.minLength)
                case .end: end = max(min(duration, base + dt), start + Self.minLength)
                }
                let t = which == .start ? start : end
                playhead = t
                player.seek(to: CMTime(seconds: t, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            }
            .onEnded { _ in
                dragging = nil
                dragBase = (start, end)
                // Paused, it stays on the frame just trimmed to, as in Photos.
                if playing { restart() }
            }
    }

    /// Where the handles were when the drag began.
    @State private var dragBase: (start: Double, end: Double) = (0, 0)

    private func togglePlay() {
        playing.toggle()
        if playing { player.play() } else { player.pause() }
    }

    private func restart() {
        player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        if playing { player.play() }
    }

    private func load() async {
        let asset = AVURLAsset(url: url)
        guard let seconds = try? await asset.load(.duration).seconds, seconds > 0,
              (try? await asset.loadTracks(withMediaType: .video).first) != nil else {
            loadError = "This video can't be opened."
            return
        }
        duration = seconds
        start = min(max(0, initial.start ?? 0), seconds)
        end = min(seconds, max(start + Self.minLength, initial.end ?? seconds))
        dragBase = (start, end)
        player.replaceCurrentItem(with: AVPlayerItem(asset: asset))
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { time in
            MainActor.assumeIsolated {
                guard dragging == nil else { return }
                playhead = time.seconds
                if time.seconds >= end { restart() }
            }
        }
        restart()

        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 200, height: 200)
        let count = 10
        let times = (0..<count).map { CMTime(seconds: seconds * (Double($0) + 0.5) / Double(count), preferredTimescale: 600) }
        var images: [CGImage] = []
        for await result in gen.images(for: times) {
            if let image = try? result.image { images.append(image) }
        }
        frames = images
    }

    static func clock(_ s: Double) -> String {
        let total = Int(s.rounded(.down))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

/// A bare video picture (no controls) for the trimmer.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer

    final class LayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerView {
        let v = LayerView()
        v.playerLayer.player = player
        v.playerLayer.videoGravity = .resizeAspect
        return v
    }

    func updateUIView(_ uiView: LayerView, context: Context) {}
}

// MARK: - Which at-bat

/// "Add to which at-bat?" — the kid's at-bats in Clips, newest game first,
/// with a best guess picked. Or a new at-bat at the bottom.
struct AtBatPicker: View {
    let kids: [Kid]
    @Binding var kidID: UUID?
    let sections: [GameSection]
    let posters: [String: URL]
    let clipDate: Date?
    let onDone: (FieldViewDecision) -> Void

    @State private var selected: UUID?
    @State private var makingNew = false

    /// Games with at-bats in Clips (still-uploading ones can't take a field view yet).
    private var games: [GameSection] { sections.filter { !$0.atBats.isEmpty } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if kids.count > 1 {
                    Picker("Kid", selection: $kidID) {
                        ForEach(kids) { Text($0.firstName).tag(Optional($0.id)) }
                    }
                    .pickerStyle(.segmented)
                }
                ForEach(games) { game in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(game.name).font(.title3).fontDesign(.serif).lineLimit(1)
                            Spacer(minLength: 8)
                            Text(TitleCard.formatGameDate(game.playedOn)).font(.footnote).foregroundStyle(.secondary)
                        }
                        CardGrid {
                            ForEach(Array(game.atBats.enumerated()), id: \.element.id) { i, ab in
                                pickCard(ab, number: i + 1)
                            }
                        }
                    }
                }
                if games.isEmpty {
                    Text("No at-bats in Clips yet for this kid.").foregroundStyle(.secondary)
                }
                Button { makingNew = true } label: {
                    Label("New at-bat", systemImage: "plus.rectangle.on.rectangle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
            .padding()
        }
        .navigationTitle("Add to which at-bat?")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Add", action: add).disabled(selected == nil)
            }
        }
        .onChange(of: kidID, initial: true) { selected = Self.bestGuess(games, clipDate: clipDate) }
        #if DEBUG
        .onAppear { if ProcessInfo.processInfo.arguments.contains("-demoNew") { makingNew = true } }
        #endif
        .onChange(of: games.map(\.id)) { if selected == nil { selected = Self.bestGuess(games, clipDate: clipDate) } }
        .navigationDestination(isPresented: $makingNew) {
            NewAtBatForm(kid: kids.first { $0.id == kidID }, sections: sections, clipDate: clipDate, onDone: onDone)
        }
    }

    private func pickCard(_ ab: HistoryAtBat, number: Int) -> some View {
        let isSelected = selected == ab.id
        return Button { selected = ab.id } label: {
            VStack(alignment: .leading, spacing: 4) {
                Thumbnail(url: ab.posterPath.flatMap { posters[$0] })
                    .overlay(alignment: .topLeading) { if let r = ab.result { ResultBadge(result: r) } }
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(isSelected ? Color.accentColor : .clear, lineWidth: 3)
                    }
                    .overlay(alignment: .topTrailing) {
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill").font(.title3)
                                .foregroundStyle(.white, Color.accentColor).padding(6)
                        }
                    }
                Text("AB \(number)" + (ab.result.map { " · \($0.name)" } ?? ""))
                    .font(.subheadline.weight(.semibold)).lineLimit(1)
                if ab.hasFieldView {
                    Text("Has field view — replaces it").font(.caption).foregroundStyle(.orange).lineLimit(1)
                } else if !ab.isCamera {
                    Text("Website upload — can't add").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!ab.isCamera)
        .opacity(ab.isCamera ? 1 : 0.5)
    }

    private func add() {
        for game in games {
            if let i = game.atBats.firstIndex(where: { $0.id == selected }) {
                onDone(.attach(FieldViewTarget(atBat: game.atBats[i], game: game, number: i + 1)))
                return
            }
        }
    }

    /// The at-bat filmed closest to when the clip was recorded (if that's
    /// within a few hours of one), else the newest ball-in-play at-bat with no
    /// field view yet.
    static func bestGuess(_ games: [GameSection], clipDate: Date?) -> UUID? {
        let all = games.flatMap(\.atBats).filter(\.isCamera)
        if let clipDate,
           let closest = all.min(by: { abs($0.when.timeIntervalSince(clipDate)) < abs($1.when.timeIntervalSince(clipDate)) }),
           abs(closest.when.timeIntervalSince(clipDate)) < 4 * 3600 {
            return closest.id
        }
        for game in games {
            if let ab = game.atBats.last(where: { $0.isCamera && !$0.hasFieldView && $0.result?.playResult != nil }) { return ab.id }
        }
        return nil
    }
}

// MARK: - New at-bat

/// An at-bat that's only the field view: which game, and how it came out.
struct NewAtBatForm: View {
    let kid: Kid?
    let sections: [GameSection]
    let clipDate: Date?
    let onDone: (FieldViewDecision) -> Void

    @State private var gameID: UUID?
    @State private var newName = ""
    @State private var newDate = Date()
    @State private var battedBall: BattedBall?
    @State private var playResult: PlayResult?

    private static let newGame = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!

    var body: some View {
        Form {
            Section("Game") {
                Picker("Game", selection: $gameID) {
                    ForEach(sections) { g in
                        HStack {
                            Text(g.name).lineLimit(1)
                            Spacer()
                            Text(Self.shortDay(g.playedOn)).foregroundStyle(.secondary)
                        }
                        .tag(Optional(g.id))
                    }
                    Text("New game…").tag(Optional(Self.newGame))
                }
                .pickerStyle(.inline)
                .labelsHidden()
                if gameID == Self.newGame {
                    TextField("Opponent or event (e.g. vs Kabuki)", text: $newName)
                        .textInputAutocapitalization(.words)
                    DatePicker("Date", selection: $newDate, displayedComponents: .date)
                }
            }
            Section("What kind of hit?") {
                ChoiceGrid(items: BattedBall.allCases, label: \.label, selection: $battedBall)
            }
            Section("Result") {
                ChoiceGrid(items: PlayResult.allCases, label: \.label, selection: $playResult)
            }
        }
        .navigationTitle("New at-bat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Add", action: add).disabled(!ready)
            }
        }
        .onAppear {
            guard gameID == nil else { return }
            // The game played the day the clip was recorded, else the newest.
            let day = clipDate.map(GameChoice.day)
            gameID = sections.first { $0.playedOn == day }?.id ?? sections.first?.id ?? Self.newGame
            if let clipDate { newDate = clipDate }
        }
    }

    /// "Sat, Sep 26", as the home screen shows game days.
    private static func shortDay(_ ymd: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ymd) else { return ymd }
        return d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    private var trimmedName: String { newName.trimmingCharacters(in: .whitespaces) }

    private var ready: Bool {
        kid != nil && battedBall != nil && playResult != nil && gameID != nil && (gameID != Self.newGame || !trimmedName.isEmpty)
    }

    private func add() {
        guard let kid, let battedBall, let playResult, let gameID else { return }
        let result = AtBatResult.inPlay(playResult, battedBall: battedBall)
        if gameID == Self.newGame {
            let game = GameChoice(id: UUID(), kid: kid, name: trimmedName, playedOn: GameChoice.day(newDate))
            onDone(.new(game: game, result: result, number: 1, recordedAt: clipDate ?? newDate))
            return
        }
        guard let section = sections.first(where: { $0.id == gameID }) else { return }
        // In the game where the clip's time puts it; at the end without one.
        let others = section.atBats.map(\.when) + section.local.map(\.recordedAt)
        let recordedAt: Date
        if let clipDate, GameChoice.day(clipDate) == section.playedOn {
            recordedAt = clipDate
        } else {
            recordedAt = (others.max() ?? Date()).addingTimeInterval(60)
        }
        let number = others.filter { $0 < recordedAt }.count + 1
        let game = GameChoice(id: section.id, kid: kid, name: section.name, playedOn: section.playedOn)
        onDone(.new(game: game, result: result, number: number, recordedAt: recordedAt))
    }
}

/// Two-across buttons, one of them chosen.
private struct ChoiceGrid<T: Identifiable & Equatable>: View {
    let items: [T]
    let label: KeyPath<T, String>
    @Binding var selection: T?

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(items) { item in
                let on = selection == item
                Button { selection = item } label: {
                    Text(item[keyPath: label])
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .foregroundStyle(on ? .white : .primary)
                        .background(on ? Color.accentColor : Color.secondary.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Picking from Photos

/// A video from the Photos picker, copied out as a file.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("picked-\(UUID().uuidString).\(received.file.pathExtension)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy)
        }
    }
}

// MARK: - From the share sheet

/// The share extension's drop box: clips shared from GameChanger land in the
/// app group's Inbox, and the app picks them up.
enum SharedInbox {
    static let group = "group.io.mason.clipscamera"

    static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("Inbox", isDirectory: true)
    }

    /// Clips waiting, oldest first.
    static func waiting() -> [URL] {
        guard let folder,
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.creationDateKey]) else { return [] }
        return files
            .filter { !$0.lastPathComponent.hasPrefix(".") }
            .sorted {
                let a = (try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
                let b = (try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
                return a < b
            }
    }
}
