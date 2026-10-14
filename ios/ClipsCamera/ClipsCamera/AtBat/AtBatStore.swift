import AVFoundation
import Foundation
import Network
import Observation
import Photos
import UIKit

// Every at-bat from the moment recording stops until it's in Clips. Each is
// saved to disk first, so a crash or a killed app never loses one; anything
// unfinished picks up again on the next launch.
//
//   recording → building the edit → uploading the video → filing it in Clips
//
// What's built is the pitch reel (see ReelPlan): just the pitch windows, swings
// at full frame rate, played live with slow motion and captions in the app.
// At-bats filmed before the reel existed were built as a finished edit, and
// keep that through rebuilds.
//
// The raw recording stays on the phone for three days, so a mislabeled pitch
// can be fixed and the video rebuilt; after that only the labels can change.
// It's never cleaned up before its reel is safely in Clips, though — and an
// at-bat filmed before the reel existed keeps its recording until it has been
// rebuilt as one (see convertToReels). The reel stays for a week after it's
// uploaded.
//
// A GameChanger clip (the "field view") goes through the same queue. On a reel
// it's kept as its own file that the player runs on into; on an older edit
// it's stitched onto the end of the close-up; or it's an at-bat on its own.
// The clip itself is uploaded too, so it can be re-trimmed any time.

/// A GameChanger clip of the whole play, played after the close-up.
struct FieldView: Codable, Equatable {
    /// The clip as shared, untrimmed: its file in the store's folder, while
    /// it's on this phone.
    var file: String?
    /// Where it's kept in Clips.
    var path: String
    var uploaded: Bool
    /// The kept stretch, in seconds into the clip.
    var start: Double
    var end: Double
}

/// Where a field view's clip comes from: just shared or picked, or the one
/// an at-bat already has (being re-trimmed).
enum FieldViewClip {
    case imported(file: String)
    case existing(path: String, file: String?)
}

struct AtBatJob: Codable, Identifiable, Equatable {
    enum State: Codable, Equatable {
        case building
        case done
        case failed(String)
    }

    enum Kind: String, Codable {
        /// Filmed with this phone's camera.
        case filmed
        /// A field view added to an at-bat that's in Clips but wasn't filmed
        /// here (or whose files are gone): only its video changes.
        case attach
        /// Made from a GameChanger clip alone: the title card and the field view.
        case fieldOnly
    }

    enum Upload: Codable, Equatable {
        case waiting        // queued; starts when there's signal and a sign-in
        case uploading
        case finishing      // video is up; writing the at-bat into Clips
        case uploaded
        case failed(String)
    }

    var id = UUID()
    var recordedAt: Date
    /// File names inside the store's folder (absolute paths change between installs).
    var rawFile: String?
    var rotation: Int
    var rawDuration: Double
    var pitches: [Pitch]
    var result: AtBatResult?
    var state: State = .building
    /// Nil for at-bats recorded before uploading existed.
    var game: GameChoice?
    var upload: Upload?
    var uploadedAt: Date?

    var editFile: String?
    var editDuration: Double?
    var editBytes: Int64?
    var renderSeconds: Double?
    var pitchTimes: [Double]?
    /// Times the video was rebuilt after relabeling. Each rebuild uploads to a
    /// new file name, so nothing serves a cached copy of the old video.
    var revision: Int?

    /// Nil for filmed (at-bats from before there were other kinds).
    var kind: Kind?
    var fieldView: FieldView?
    /// The at-bat without its field view — what the field view is added onto
    /// — on this phone and in Clips (nil until it's there).
    var closeupFile: String?
    var closeupPath: String?
    /// Where the field view starts in the finished video.
    var fieldViewAt: Double?
    /// This round's files already in storage, by path.
    var uploadedPaths: [String]?
    /// Its place in the game, for an at-bat made from a field view alone.
    var atBatNumber: Int?

    /// The video in Clips is a pitch reel (filmed at-bats from this version
    /// on, and field views added to one): the field view stays a separate file.
    var reel: Bool?
    /// The reel's pitch windows, once it's built.
    var reelSegments: [ReelSegment]?
    /// Only the field view changed on a reel already in Clips: filing it
    /// touches just those columns, not labels changed elsewhere.
    var fieldViewOnly: Bool?

    var isFilmed: Bool { (kind ?? .filmed) == .filmed }
    var isReel: Bool { reel == true }
}

@MainActor
@Observable
final class AtBatStore {
    private(set) var jobs: [AtBatJob] = []
    /// Upload progress (0–1) for at-bats being sent, not persisted.
    private(set) var progress: [UUID: Double] = [:]
    private(set) var online = true

    private var building = false
    private var starting: Set<UUID> = []
    private let clips = ClipsService.shared
    private let uploads = UploadSession.shared
    private let monitor = NWPathMonitor()

    private let root: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AtBats", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    private var indexURL: URL { root.appendingPathComponent("jobs.json") }

    init() {
        if let data = try? Data(contentsOf: indexURL),
           let saved = try? JSONDecoder().decode([AtBatJob].self, from: data) {
            jobs = saved
        }
        uploads.onProgress = { [weak self] id, fraction in self?.progress[id] = fraction }
        uploads.onFinish = { [weak self] id, path, result in self?.fileUploaded(id, path: path, result) }
        uploads.activate()
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let cameBack = satisfied && !self.online
                self.online = satisfied
                if cameBack { self.resume() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "store.network"))
        cleanUp()
    }

    func url(_ file: String) -> URL { root.appendingPathComponent(file) }

    /// How long the full recording is kept for rebuilding after a relabel.
    static let rawKeptFor: TimeInterval = 3 * 24 * 3600

    /// The full recording is still here, and nothing is mid-build or mid-upload.
    func canRebuild(_ id: UUID) -> Bool {
        guard let job = jobs.first(where: { $0.id == id }), job.isFilmed, let raw = job.rawFile,
              FileManager.default.fileExists(atPath: url(raw).path) else { return false }
        return !isBusy(job)
    }

    /// Building, or sending to Clips.
    func isBusy(_ job: AtBatJob) -> Bool {
        job.state == .building || job.upload == .uploading || job.upload == .finishing
    }

    /// Nothing on this phone is mid-way through changing this at-bat's video.
    func canChangeFieldView(_ id: UUID) -> Bool {
        guard let job = jobs.first(where: { $0.id == id }) else { return true }
        return !isBusy(job)
    }

    /// New labels, and a new video built from the full recording, which then
    /// replaces the one in Clips.
    func rebuild(_ id: UUID, pitches: [Pitch]) {
        guard canRebuild(id), let job = jobs.first(where: { $0.id == id }) else { return }
        for file in [job.editFile, job.closeupFile].compactMap({ $0 }) {
            try? FileManager.default.removeItem(at: url(file))
        }
        update(id) {
            $0.pitches = pitches
            $0.result = Scorebook.outcome(pitches)?.result
            $0.editFile = nil
            $0.closeupFile = nil
            $0.closeupPath = nil
            $0.pitchTimes = nil
            $0.fieldViewOnly = nil
            $0.state = .building
            if $0.game != nil {
                $0.upload = .waiting
                $0.uploadedAt = nil
                $0.uploadedPaths = nil
                $0.revision = ($0.revision ?? 0) + (job.upload == nil || job.upload == .waiting ? 0 : 1)
            }
        }
        processNext()
    }

    // MARK: Field views

    /// Keep a shared or picked GameChanger clip in the store's folder while
    /// it's trimmed. Returns its file name.
    func importClip(from source: URL) throws -> String {
        let ext = source.pathExtension.isEmpty ? "mp4" : source.pathExtension.lowercased()
        let name = "gc-\(UUID().uuidString).\(ext)"
        try FileManager.default.copyItem(at: source, to: url(name))
        return name
    }

    /// A trim that was cancelled: its clip isn't needed.
    func discardClip(_ file: String) {
        guard !jobs.contains(where: { $0.fieldView?.file == file }) else { return }
        try? FileManager.default.removeItem(at: url(file))
    }

    /// The clip an at-bat's field view was made from, if it's on this phone.
    func fieldViewFile(_ id: UUID) -> URL? {
        guard let file = jobs.first(where: { $0.id == id })?.fieldView?.file,
              FileManager.default.fileExists(atPath: url(file).path) else { return nil }
        return url(file)
    }

    /// A new name for every change, so no cache serves the old video.
    private static func freshRevision(after old: Int?) -> Int {
        max((old ?? 0) + 1, Int(Date().timeIntervalSince1970))
    }

    private static func fieldView(_ clip: FieldViewClip, paths: AtBatPaths, start: Double, end: Double) -> FieldView {
        switch clip {
        case .imported(let file):
            FieldView(file: file, path: paths.fieldView(fileExtension: (file as NSString).pathExtension), uploaded: false, start: start, end: end)
        case .existing(let path, let file):
            FieldView(file: file, path: path, uploaded: true, start: start, end: end)
        }
    }

    /// Add (or re-trim, or replace) the field view on an at-bat in Clips.
    /// One filmed on this phone keeps its job, so pitch fixes still rebuild.
    func addFieldView(to ab: HistoryAtBat, game: GameChoice, number: Int, clip: FieldViewClip, start: Double, end: Double) {
        let paths = AtBatPaths(gameID: game.id, atBatID: ab.id)
        let fieldView = Self.fieldView(clip, paths: paths, start: start, end: end)
        if ab.isReel || jobs.first(where: { $0.id == ab.id })?.isReel == true {
            addFieldViewToReel(ab, game: game, fieldView: fieldView)
            return
        }
        if let job = jobs.first(where: { $0.id == ab.id }) {
            guard !isBusy(job) else { return }
            replaceFieldView(job, with: fieldView)
            update(ab.id) {
                if $0.fieldView == nil {
                    // Until now the edit was the close-up. If this phone's
                    // latest never made it to Clips, it goes up with the rest.
                    $0.closeupFile = $0.editFile
                    $0.closeupPath = $0.upload == .uploaded ? ab.closeupPath ?? ab.playbackPath : nil
                } else if let old = $0.editFile {
                    try? FileManager.default.removeItem(at: self.url(old))
                }
                if $0.kind == .fieldOnly || ab.isFieldOnly {
                    $0.kind = .fieldOnly
                    $0.atBatNumber = $0.atBatNumber ?? number
                }
                $0.fieldView = fieldView
                $0.editFile = nil
                $0.state = .building
                $0.upload = .waiting
                $0.uploadedAt = nil
                $0.uploadedPaths = nil
                $0.revision = Self.freshRevision(after: $0.revision)
            }
        } else {
            let job = AtBatJob(
                id: ab.id, recordedAt: ab.when, rotation: 0, rawDuration: 0, pitches: [], result: ab.result,
                state: .building, game: game, upload: .waiting, revision: Self.freshRevision(after: nil),
                kind: ab.isFieldOnly ? .fieldOnly : .attach, fieldView: fieldView,
                closeupPath: ab.isFieldOnly ? nil : ab.closeupPath ?? ab.playbackPath,
                atBatNumber: ab.isFieldOnly ? number : nil
            )
            jobs.insert(job, at: 0)
            persist()
        }
        processNext()
    }

    /// A reel's field view is its own file: nothing is rebuilt, the clip goes
    /// up (unless it's already there) and the at-bat is pointed at it.
    private func addFieldViewToReel(_ ab: HistoryAtBat, game: GameChoice, fieldView: FieldView) {
        if let job = jobs.first(where: { $0.id == ab.id }) {
            guard !isBusy(job) else { return }
            replaceFieldView(job, with: fieldView)
            update(ab.id) {
                if $0.upload == .uploaded { $0.fieldViewOnly = true }
                $0.fieldView = fieldView
                $0.upload = .waiting
                $0.uploadedAt = nil
            }
        } else {
            jobs.insert(AtBatJob(
                id: ab.id, recordedAt: ab.when, rotation: 0, rawDuration: 0, pitches: [], result: ab.result,
                state: .done, game: game, upload: .waiting, kind: .attach, fieldView: fieldView, reel: true
            ), at: 0)
            persist()
        }
        startUpload(ab.id)
    }

    /// A new at-bat from a GameChanger clip alone: the title card, then the field view.
    func addFieldOnly(game: GameChoice, number: Int, result: AtBatResult, recordedAt: Date, clip: FieldViewClip, start: Double, end: Double) {
        let id = UUID()
        let fieldView = Self.fieldView(clip, paths: AtBatPaths(gameID: game.id, atBatID: id), start: start, end: end)
        jobs.insert(AtBatJob(
            id: id, recordedAt: recordedAt, rotation: 0, rawDuration: 0, pitches: [], result: result,
            game: game, upload: .waiting, kind: .fieldOnly, fieldView: fieldView, atBatNumber: number
        ), at: 0)
        persist()
        processNext()
    }

    /// The field view came off in Clips; this phone's copy goes back to the close-up.
    func fieldViewRemoved(_ id: UUID) {
        guard let job = jobs.first(where: { $0.id == id }), job.fieldView != nil else { return }
        replaceFieldView(job, with: nil)
        if job.isReel {
            update(id) { $0.fieldView = nil }
            return
        }
        if let old = job.editFile { try? FileManager.default.removeItem(at: url(old)) }
        update(id) {
            $0.editFile = $0.closeupFile
            $0.closeupFile = nil
            $0.closeupPath = nil
            $0.fieldView = nil
            $0.fieldViewAt = nil
        }
    }

    /// Clear out the old clip when a different one takes its place.
    private func replaceFieldView(_ job: AtBatJob, with new: FieldView?) {
        guard let old = job.fieldView?.file, old != new?.file else { return }
        try? FileManager.default.removeItem(at: url(old))
    }

    /// New labels only (the video keeps its captions) — for an at-bat whose
    /// full recording is gone. Matches what was written to Clips.
    func setLabels(_ id: UUID, pitches: [Pitch]) {
        update(id) { job in
            for p in pitches {
                guard let i = job.pitches.firstIndex(where: { $0.id == p.id }) else { continue }
                job.pitches[i].outcome = p.outcome
                job.pitches[i].battedBall = p.battedBall
                job.pitches[i].playResult = p.playResult
            }
            job.result = Scorebook.outcome(job.pitches.sorted { $0.t < $1.t })?.result
        }
    }

    /// Take ownership of a just-finished recording and start building it.
    func add(_ recording: FinishedRecording, pitches: [Pitch], result: AtBatResult?, game: GameChoice?) {
        let id = UUID()
        let rawName = "raw-\(id.uuidString).mov"
        var job = AtBatJob(id: id, recordedAt: Date().addingTimeInterval(-recording.duration), rotation: recording.rotation,
                           rawDuration: recording.duration, pitches: pitches, result: result, game: game, upload: .waiting,
                           reel: true)
        do {
            try FileManager.default.moveItem(at: recording.url, to: url(rawName))
            job.rawFile = rawName
        } catch {
            job.state = .failed("Couldn't keep the recording: \(error.localizedDescription)")
        }
        jobs.insert(job, at: 0)
        persist()
        processNext()
    }

    func retry(_ id: UUID) {
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        if case .failed = job.state {
            update(id) { $0.state = .building }
            processNext()
        } else if case .failed = job.upload {
            update(id) { $0.upload = .waiting }
            startUpload(id)
        }
    }

    func delete(_ id: UUID) {
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        for file in [job.rawFile, job.editFile, job.closeupFile, job.fieldView?.file].compactMap({ $0 }) {
            try? FileManager.default.removeItem(at: url(file))
        }
        jobs.removeAll { $0.id == id }
        persist()
    }

    /// Pick everything back up: unbuilt edits, waiting or failed uploads, and
    /// uploads a previous launch left mid-flight. Call on launch, on coming
    /// back to the foreground, and after signing in.
    func resume() {
        convertToReels()
        processNext()
        Task {
            let inFlight = await uploads.activeUploads()
            for job in jobs where job.state == .done && job.game != nil {
                switch job.upload {
                case .waiting, .failed:
                    startUpload(job.id)
                case .uploading where !inFlight.contains(job.id):
                    startUpload(job.id) // the task was lost (app was deleted from memory mid-upload)
                case .finishing:
                    Task { await finalize(job.id) }
                default:
                    break
                }
            }
        }
    }

    // MARK: Converting

    private var converting = false

    /// At-bats filmed before the reel was built as finished edits. While the
    /// full recording is still here, each is rebuilt as a 240fps reel and
    /// replaces the edit in Clips, its labels as Clips has them now. A field
    /// view stays, as the reel's own file.
    func convertToReels() {
        guard !converting else { return }
        let waiting = jobs.filter { job in
            job.isFilmed && !job.isReel && job.game != nil && job.state == .done && job.upload == .uploaded
                && job.rawFile.map { FileManager.default.fileExists(atPath: url($0).path) } == true
        }
        guard !waiting.isEmpty, clips.isSignedIn, online else { return }
        converting = true
        Task {
            defer { converting = false }
            for job in waiting {
                // Labels changed in Clips since (on the website, say) win.
                var pitches = job.pitches
                if let remote = try? await clips.pitches(atBatID: job.id, result: job.result) {
                    for i in pitches.indices {
                        guard let r = remote.first(where: { $0.id == pitches[i].id }) else { continue }
                        pitches[i].outcome = r.outcome
                        pitches[i].battedBall = r.battedBall
                        pitches[i].playResult = r.playResult
                    }
                }
                guard let current = jobs.first(where: { $0.id == job.id }), !isBusy(current), !current.isReel else { continue }
                for file in [current.editFile, current.closeupFile].compactMap({ $0 }) {
                    try? FileManager.default.removeItem(at: url(file))
                }
                update(job.id) {
                    $0.reel = true
                    $0.pitches = pitches
                    $0.result = Scorebook.outcome(pitches.sorted { $0.t < $1.t })?.result ?? $0.result
                    $0.editFile = nil
                    $0.closeupFile = nil
                    $0.closeupPath = nil
                    $0.fieldViewAt = nil
                    $0.pitchTimes = nil
                    $0.fieldViewOnly = nil
                    $0.state = .building
                    $0.upload = .waiting
                    $0.uploadedAt = nil
                    $0.uploadedPaths = nil
                    $0.revision = Self.freshRevision(after: $0.revision)
                }
            }
            processNext()
        }
    }

    // MARK: Building

    /// Build whatever's waiting, one at a time.
    func processNext() {
        guard !building, let job = jobs.last(where: { $0.state == .building }) else { return }
        building = true
        let background = UIApplication.shared.beginBackgroundTask(withName: "build-at-bat")
        Task {
            await build(job)
            UIApplication.shared.endBackgroundTask(background)
            building = false
            startUpload(job.id)
            processNext()
        }
    }

    private func build(_ job: AtBatJob) async {
        let suffix = job.revision.map { "-r\($0)" } ?? ""
        let closeupName = "edit-\(job.id.uuidString)\(suffix).mp4"
        let rawURL = job.rawFile.map(url)
        if job.isReel {
            await buildReel(job)
            return
        }
        do {
            var job = job
            // A pitch fix on this phone keeps a field view added on another.
            if job.isFilmed, job.fieldView == nil, job.revision != nil, job.game != nil,
               let remote = try? await clips.fieldView(of: job.id) {
                update(job.id) { $0.fieldView = remote }
                job.fieldView = remote
            }
            if job.isFilmed && !hasCloseup(job) {
                guard let rawURL, FileManager.default.fileExists(atPath: rawURL.path) else {
                    throw StoreError("The recording is missing.")
                }
                guard !job.pitches.isEmpty else {
                    throw StoreError("No pitches were logged, so there's nothing to cut.")
                }
                let edit = try await EditRenderer.render(
                    raw: rawURL,
                    rotation: job.rotation,
                    pitches: job.pitches,
                    result: job.result,
                    card: TitleCard.make(number: number(of: job), result: job.result,
                                         game: job.game?.name, playedOn: job.game?.playedOn),
                    timings: AppSettings.shared.timings,
                    to: url(closeupName)
                )
                update(job.id) {
                    if $0.fieldView == nil {
                        $0.editFile = closeupName
                    } else {
                        $0.closeupFile = closeupName
                        $0.closeupPath = nil
                    }
                    $0.editDuration = edit.duration
                    $0.editBytes = edit.bytes
                    $0.renderSeconds = edit.renderSeconds
                    $0.pitchTimes = edit.pitchTimes
                }
            }
            if let current = jobs.first(where: { $0.id == job.id }), current.fieldView != nil {
                try await buildFieldView(current)
            }
            guard let editName = jobs.first(where: { $0.id == job.id })?.editFile else {
                throw StoreError("The video didn't get built.")
            }
            if AppSettings.shared.saveEditsToPhotos {
                try await Self.saveToPhotos(url(editName))
            }
            // A rebuild has saved the recording already.
            if AppSettings.shared.saveRawToPhotos, job.revision == nil, let rawURL, FileManager.default.fileExists(atPath: rawURL.path) {
                try await Self.saveToPhotos(rawURL)
            }
            update(job.id) { $0.state = .done }
        } catch {
            update(job.id) { $0.state = .failed(error.localizedDescription) }
        }
    }

    /// The pitch reel from the full recording (a field view isn't part of it).
    private func buildReel(_ job: AtBatJob) async {
        let suffix = job.revision.map { "-r\($0)" } ?? ""
        let name = "reel-\(job.id.uuidString)\(suffix).mp4"
        do {
            if job.isFilmed, job.editFile.map({ !FileManager.default.fileExists(atPath: url($0).path) }) ?? true {
                guard let raw = job.rawFile.map(url), FileManager.default.fileExists(atPath: raw.path) else {
                    throw StoreError("The recording is missing.")
                }
                guard !job.pitches.isEmpty else {
                    throw StoreError("No pitches were logged, so there's nothing to cut.")
                }
                let reel = try await ReelRenderer.render(raw: raw, rotation: job.rotation, pitches: job.pitches,
                                                         timings: AppSettings.shared.timings, to: url(name))
                update(job.id) {
                    $0.editFile = name
                    $0.editDuration = reel.duration
                    $0.editBytes = reel.bytes
                    $0.renderSeconds = reel.renderSeconds
                    $0.pitchTimes = reel.pitchTimes
                    $0.reelSegments = reel.segments
                }
                if AppSettings.shared.saveEditsToPhotos, let shared = try? await ShareRenderer.render(shareRequest(job.id, options: .standard)) {
                    try await Self.saveToPhotos(shared)
                }
                if AppSettings.shared.saveRawToPhotos, job.revision == nil {
                    try await Self.saveToPhotos(raw)
                }
            }
            update(job.id) { $0.state = .done }
        } catch {
            update(job.id) { $0.state = .failed(error.localizedDescription) }
        }
    }

    /// What sharing a reel built on this phone needs, at its reel times.
    func shareRequest(_ id: UUID, options: ShareOptions) -> ShareRequest {
        let job = jobs.first { $0.id == id }!
        let sorted = job.pitches.sorted { $0.t < $1.t }
        let times = job.pitchTimes ?? []
        let reelPitches = sorted.enumerated().map { i, p in
            var q = p
            q.t = i < times.count ? times[i] : 0
            return q
        }
        let card = TitleCard.make(number: number(of: job), result: job.result, game: job.game?.name, playedOn: job.game?.playedOn)
        let fv = job.fieldView.flatMap { fv in
            fv.file.map { (url: url($0), start: fv.start, end: fv.end, key: fv.path) }
        }
        return ShareRequest(atBatID: id, reel: url(job.editFile ?? ""), segments: job.reelSegments ?? [],
                            pitches: reelPitches, result: job.result, card: card, options: options,
                            fieldView: fv, reelKey: job.editFile ?? "")
    }

    /// The close-up a filmed at-bat's video starts from is already built: the
    /// edit itself, or (with a field view) the close-up kept beside it.
    private func hasCloseup(_ job: AtBatJob) -> Bool {
        if job.fieldView == nil {
            return job.editFile.map { FileManager.default.fileExists(atPath: url($0).path) } ?? false
        }
        if let file = job.closeupFile, FileManager.default.fileExists(atPath: url(file).path) { return true }
        return job.closeupPath != nil
    }

    /// The finished video with the field view: the close-up then the clip, or
    /// for an at-bat with no close-up, the title card then the clip. Fetches
    /// either from Clips when it isn't on this phone.
    private func buildFieldView(_ job: AtBatJob) async throws {
        guard var fieldView = job.fieldView else { return }
        if fieldView.file == nil || !FileManager.default.fileExists(atPath: url(fieldView.file!).path) {
            let name = "gc-\(UUID().uuidString).\((fieldView.path as NSString).pathExtension)"
            try await clips.download(fieldView.path, to: url(name))
            fieldView.file = name
            update(job.id) { $0.fieldView = fieldView }
        }
        let clip = url(fieldView.file!)
        let suffix = job.revision.map { "-r\($0)" } ?? ""
        let out = url("combined-\(job.id.uuidString)\(suffix).mp4")
        let rendered: RenderedFieldView
        if job.kind == .fieldOnly {
            let card = TitleCard.make(number: number(of: job), result: job.result, game: job.game?.name, playedOn: job.game?.playedOn)
            rendered = try await FieldViewRenderer.alone(card: card, cardSeconds: AppSettings.shared.timings.titleCard,
                                                         fieldView: clip, start: fieldView.start, end: fieldView.end, to: out)
        } else {
            var closeup = job.closeupFile.map(url)
            if closeup == nil || !FileManager.default.fileExists(atPath: closeup!.path) {
                guard let path = job.closeupPath else { throw StoreError("The at-bat's video is missing.") }
                let name = "closeup-\(job.id.uuidString)\(suffix).mp4"
                try await clips.download(path, to: url(name))
                update(job.id) { $0.closeupFile = name }
                closeup = url(name)
            }
            rendered = try await FieldViewRenderer.append(closeup: closeup!, fieldView: clip, start: fieldView.start, end: fieldView.end, to: out)
        }
        update(job.id) {
            $0.editFile = out.lastPathComponent
            $0.editDuration = rendered.duration
            $0.editBytes = rendered.bytes
            $0.fieldViewAt = rendered.fieldViewAt
        }
    }

    /// The number the game's next at-bat will get.
    func nextNumber(for game: GameChoice) -> Int {
        (game.priorAtBats ?? 0) + jobs.filter { $0.game?.id == game.id && $0.kind != .attach }.count + 1
    }

    /// Its place in the game ("AB 3"): the game's at-bats already in Clips
    /// when it was picked, plus this phone's at-bats for it up to this one.
    func number(of job: AtBatJob) -> Int? {
        if let fixed = job.atBatNumber { return fixed }
        guard let game = job.game else { return nil }
        // A field view added to an at-bat from elsewhere doesn't make it this phone's.
        let here = jobs.filter { $0.game?.id == game.id && $0.kind != .attach && $0.recordedAt <= job.recordedAt }.count
        return (game.priorAtBats ?? 0) + max(1, here)
    }

    // MARK: Uploading

    /// The files this round still has to send, in order: the GameChanger
    /// clip, the close-up (when a field view is added to a newly built one),
    /// then the finished video.
    private func pendingUploads(_ job: AtBatJob, game: GameChoice) -> [(file: String, path: String)] {
        let paths = AtBatPaths(gameID: game.id, atBatID: job.id, revision: job.revision)
        var out: [(String, String)] = []
        if let fv = job.fieldView, !fv.uploaded, let file = fv.file { out.append((file, fv.path)) }
        if !job.isReel, job.fieldView != nil, job.kind != .fieldOnly, job.closeupPath == nil, let file = job.closeupFile {
            out.append((file, paths.closeup))
        }
        if let file = job.editFile { out.append((file, job.isReel ? paths.reel : paths.video)) }
        let done = Set(job.uploadedPaths ?? [])
        return out.filter { !done.contains($0.1) }
    }

    /// Send the next file to storage on the background session. Waits (as
    /// `.waiting`) without signal or a sign-in; `resume()` retries later.
    func startUpload(_ id: UUID) {
        guard let job = jobs.first(where: { $0.id == id }), job.state == .done,
              let game = job.game, job.editFile != nil || job.isReel,
              !starting.contains(id) else { return }
        guard clips.isSignedIn, online else {
            update(id) { $0.upload = .waiting }
            return
        }
        guard let next = pendingUploads(job, game: game).first else {
            update(id) { $0.upload = .finishing }
            Task { await finalize(id) }
            return
        }
        starting.insert(id)
        Task {
            defer { starting.remove(id) }
            do {
                let target = try await clips.uploadURL(path: next.path)
                let type = (next.path as NSString).pathExtension.lowercased() == "mov" ? "video/quicktime" : "video/mp4"
                uploads.upload(url(next.file), to: target, contentType: type, id: id, path: next.path)
                progress[id] = progress[id] ?? 0
                update(id) { $0.upload = .uploading }
            } catch {
                // Usually no signal after all; it'll be retried.
                update(id) { $0.upload = .failed(error.localizedDescription) }
            }
        }
    }

    private func fileUploaded(_ id: UUID, path: String?, _ result: Result<Void, Error>) {
        switch result {
        case .success:
            guard let job = jobs.first(where: { $0.id == id }), let game = job.game else { return }
            let path = path ?? AtBatPaths(gameID: game.id, atBatID: id, revision: job.revision).video
            update(id) {
                $0.uploadedPaths = ($0.uploadedPaths ?? []) + [path]
                if $0.fieldView?.path == path { $0.fieldView?.uploaded = true }
                if path == AtBatPaths(gameID: game.id, atBatID: id, revision: $0.revision).closeup { $0.closeupPath = path }
            }
            if let updated = jobs.first(where: { $0.id == id }), !pendingUploads(updated, game: game).isEmpty {
                startUpload(id)
            } else {
                progress[id] = nil
                update(id) { $0.upload = .finishing }
                Task { await finalize(id) }
            }
        case .failure(let error):
            progress[id] = nil
            update(id) { $0.upload = .failed(error.localizedDescription) }
        }
    }

    private func finalize(_ id: UUID) async {
        guard let job = jobs.first(where: { $0.id == id }), let game = job.game else { return }
        let background = UIApplication.shared.beginBackgroundTask(withName: "file-at-bat")
        defer { UIApplication.shared.endBackgroundTask(background) }
        do {
            if job.kind == .attach || job.fieldViewOnly == true {
                try await clips.attachFieldView(job: job, game: game)
            } else {
                var poster: Data?
                if let file = job.editFile { poster = await Self.poster(from: url(file), job: job) }
                try await clips.finalize(job: job, game: game, poster: poster)
            }
            update(id) {
                $0.upload = .uploaded
                $0.uploadedAt = Date()
                $0.fieldViewOnly = nil
            }
        } catch {
            update(id) { $0.upload = .failed(error.localizedDescription) }
        }
    }

    /// The feed thumbnail: the frame at the last contact (else the last
    /// pitch); for a field view alone, the middle of the field view.
    private static func poster(from edit: URL, job: AtBatJob) async -> Data? {
        let sorted = job.pitches.sorted { $0.t < $1.t }
        let at: Double
        if job.kind == .fieldOnly, let start = job.fieldViewAt, let duration = job.editDuration {
            at = (start + duration) / 2
        } else {
            guard let times = job.pitchTimes, times.count == sorted.count, !times.isEmpty else { return nil }
            at = times[sorted.lastIndex { $0.outcome?.isContact ?? false } ?? sorted.count - 1]
        }
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: edit))
        gen.maximumSize = CGSize(width: 960, height: 540)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        guard let (image, _) = try? await gen.image(at: CMTime(seconds: at, preferredTimescale: 600)) else { return nil }
        return UIImage(cgImage: image).jpegData(compressionQuality: 0.8)
    }

    // MARK: Housekeeping

    /// Full recordings go three days after filming, once their reel is safely
    /// in Clips; reels and edits a week after they're there.
    private func cleanUp() {
        let rawCutoff = Date().addingTimeInterval(-Self.rawKeptFor)
        // Only once its reel is in Clips (or it was never going there).
        for job in jobs where job.recordedAt < rawCutoff && job.state == .done
            && (job.game == nil || (job.isReel && job.upload == .uploaded)) {
            guard let raw = job.rawFile else { continue }
            try? FileManager.default.removeItem(at: url(raw))
            update(job.id) { $0.rawFile = nil }
        }
        let cutoff = Date().addingTimeInterval(-7 * 24 * 3600)
        for job in jobs where job.upload == .uploaded && (job.uploadedAt ?? .distantFuture) < cutoff {
            for file in [job.editFile, job.closeupFile, job.fieldView?.file].compactMap({ $0 }) {
                try? FileManager.default.removeItem(at: url(file))
            }
            update(job.id) {
                $0.editFile = nil
                $0.closeupFile = nil
                $0.fieldView?.file = nil
            }
        }
        jobs.removeAll { $0.upload == .uploaded && $0.editFile == nil && ($0.uploadedAt ?? .distantFuture) < cutoff.addingTimeInterval(-7 * 24 * 3600) }
        persist()
    }

    private static func saveToPhotos(_ file: URL) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            throw StoreError("Photos access is off — turn it on in Settings › Clips Camera.")
        }
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .video, fileURL: file, options: nil)
        }
    }

    private func update(_ id: UUID, _ change: (inout AtBatJob) -> Void) {
        guard let i = jobs.firstIndex(where: { $0.id == id }) else { return }
        change(&jobs[i])
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(jobs) {
            try? data.write(to: indexURL, options: .atomic)
        }
    }
}

struct StoreError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
