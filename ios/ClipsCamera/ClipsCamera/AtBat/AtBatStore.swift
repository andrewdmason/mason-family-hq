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
// The raw recording is deleted as soon as the edit is built. The edit itself
// stays on the phone for a week after it's uploaded, then is cleaned up.

struct AtBatJob: Codable, Identifiable, Equatable {
    enum State: Codable, Equatable {
        case building
        case done
        case failed(String)
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
        uploads.onFinish = { [weak self] id, result in self?.videoUploaded(id, result) }
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

    /// Take ownership of a just-finished recording and start building it.
    func add(_ recording: FinishedRecording, pitches: [Pitch], result: AtBatResult?, game: GameChoice?) {
        let id = UUID()
        let rawName = "raw-\(id.uuidString).mov"
        var job = AtBatJob(id: id, recordedAt: Date().addingTimeInterval(-recording.duration), rotation: recording.rotation,
                           rawDuration: recording.duration, pitches: pitches, result: result, game: game, upload: .waiting)
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
        for file in [job.rawFile, job.editFile].compactMap({ $0 }) {
            try? FileManager.default.removeItem(at: url(file))
        }
        jobs.removeAll { $0.id == id }
        persist()
    }

    /// Pick everything back up: unbuilt edits, waiting or failed uploads, and
    /// uploads a previous launch left mid-flight. Call on launch, on coming
    /// back to the foreground, and after signing in.
    func resume() {
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
        let editName = "edit-\(job.id.uuidString).mp4"
        let rawURL = job.rawFile.map(url)
        do {
            // A retry after the edit was already built skips straight on.
            if job.editFile == nil || !FileManager.default.fileExists(atPath: url(editName).path) {
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
                    to: url(editName)
                )
                update(job.id) {
                    $0.editFile = editName
                    $0.editDuration = edit.duration
                    $0.editBytes = edit.bytes
                    $0.renderSeconds = edit.renderSeconds
                    $0.pitchTimes = edit.pitchTimes
                }
            }
            if AppSettings.shared.saveEditsToPhotos {
                try await Self.saveToPhotos(url(editName))
            }
            if AppSettings.shared.saveRawToPhotos, let rawURL, FileManager.default.fileExists(atPath: rawURL.path) {
                try await Self.saveToPhotos(rawURL)
            }
            // The edit is what we keep; the raw recording goes.
            if let rawURL { try? FileManager.default.removeItem(at: rawURL) }
            update(job.id) {
                $0.rawFile = nil
                $0.state = .done
            }
        } catch {
            update(job.id) { $0.state = .failed(error.localizedDescription) }
        }
    }

    /// The number the game's next at-bat will get.
    func nextNumber(for game: GameChoice) -> Int {
        (game.priorAtBats ?? 0) + jobs.filter { $0.game?.id == game.id }.count + 1
    }

    /// Its place in the game ("AB 3"): the game's at-bats already in Clips
    /// when it was picked, plus this phone's at-bats for it up to this one.
    func number(of job: AtBatJob) -> Int? {
        guard let game = job.game else { return nil }
        let here = jobs.filter { $0.game?.id == game.id && $0.recordedAt <= job.recordedAt }.count
        return (game.priorAtBats ?? 0) + max(1, here)
    }

    // MARK: Uploading

    /// Send the edit to storage on the background session. Waits (as
    /// `.waiting`) without signal or a sign-in; `resume()` retries later.
    func startUpload(_ id: UUID) {
        guard let job = jobs.first(where: { $0.id == id }), job.state == .done,
              let game = job.game, let editFile = job.editFile, !starting.contains(id) else { return }
        guard clips.isSignedIn, online else {
            update(id) { $0.upload = .waiting }
            return
        }
        starting.insert(id)
        Task {
            defer { starting.remove(id) }
            do {
                let target = try await clips.videoUploadURL(AtBatPaths(gameID: game.id, atBatID: id))
                uploads.upload(url(editFile), to: target, contentType: "video/mp4", id: id)
                progress[id] = 0
                update(id) { $0.upload = .uploading }
            } catch {
                // Usually no signal after all; it'll be retried.
                update(id) { $0.upload = .failed(error.localizedDescription) }
            }
        }
    }

    private func videoUploaded(_ id: UUID, _ result: Result<Void, Error>) {
        progress[id] = nil
        switch result {
        case .success:
            update(id) { $0.upload = .finishing }
            Task { await finalize(id) }
        case .failure(let error):
            update(id) { $0.upload = .failed(error.localizedDescription) }
        }
    }

    private func finalize(_ id: UUID) async {
        guard let job = jobs.first(where: { $0.id == id }), let game = job.game else { return }
        let background = UIApplication.shared.beginBackgroundTask(withName: "file-at-bat")
        defer { UIApplication.shared.endBackgroundTask(background) }
        do {
            var poster: Data?
            if let file = job.editFile { poster = await Self.poster(from: url(file), job: job) }
            try await clips.finalize(job: job, game: game, poster: poster)
            update(id) {
                $0.upload = .uploaded
                $0.uploadedAt = Date()
            }
        } catch {
            update(id) { $0.upload = .failed(error.localizedDescription) }
        }
    }

    /// The feed thumbnail: the frame at the last contact (else the last pitch).
    private static func poster(from edit: URL, job: AtBatJob) async -> Data? {
        let sorted = job.pitches.sorted { $0.t < $1.t }
        guard let times = job.pitchTimes, times.count == sorted.count, !times.isEmpty else { return nil }
        let index = sorted.lastIndex { $0.outcome?.isContact ?? false } ?? sorted.count - 1
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: edit))
        gen.maximumSize = CGSize(width: 960, height: 540)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        guard let (image, _) = try? await gen.image(at: CMTime(seconds: times[index], preferredTimescale: 600)) else { return nil }
        return UIImage(cgImage: image).jpegData(compressionQuality: 0.8)
    }

    // MARK: Housekeeping

    /// Edits are deleted from the phone a week after they're safely in Clips.
    private func cleanUp() {
        let cutoff = Date().addingTimeInterval(-7 * 24 * 3600)
        for job in jobs where job.upload == .uploaded && (job.uploadedAt ?? .distantFuture) < cutoff {
            if let file = job.editFile { try? FileManager.default.removeItem(at: url(file)) }
            update(job.id) { $0.editFile = nil }
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
