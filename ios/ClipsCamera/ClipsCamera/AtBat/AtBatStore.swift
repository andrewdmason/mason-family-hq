import Foundation
import Observation
import Photos
import UIKit

// Finished recordings waiting to become edits, and the edits themselves. Each
// at-bat is saved to disk the moment recording stops, so a crash or a killed
// app never loses one: on the next launch anything unbuilt is built.
//
// Phase 1 ends at Photos; phase 2 replaces that step with the Clips upload.

struct AtBatJob: Codable, Identifiable, Equatable {
    enum State: Codable, Equatable {
        case building
        case done
        case failed(String)
    }

    var id = UUID()
    var recordedAt: Date
    /// File names inside the store's folders (paths move between installs).
    var rawFile: String?
    var rotation: Int
    var rawDuration: Double
    var pitches: [Pitch]
    var result: AtBatResult?
    var state: State = .building

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
    private var working = false

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
    }

    func url(_ file: String) -> URL { root.appendingPathComponent(file) }

    /// Take ownership of a just-finished recording and start building it.
    func add(_ recording: FinishedRecording, pitches: [Pitch], result: AtBatResult?) {
        let id = UUID()
        let rawName = "raw-\(id.uuidString).mov"
        do {
            try FileManager.default.moveItem(at: recording.url, to: url(rawName))
        } catch {
            jobs.insert(AtBatJob(id: id, recordedAt: Date(), rotation: recording.rotation, rawDuration: recording.duration, pitches: pitches, result: result, state: .failed("Couldn't keep the recording: \(error.localizedDescription)")), at: 0)
            persist()
            return
        }
        jobs.insert(AtBatJob(id: id, recordedAt: Date(), rawFile: rawName, rotation: recording.rotation, rawDuration: recording.duration, pitches: pitches, result: result), at: 0)
        persist()
        processNext()
    }

    func retry(_ id: UUID) {
        update(id) { $0.state = .building }
        processNext()
    }

    func delete(_ id: UUID) {
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        for file in [job.rawFile, job.editFile].compactMap({ $0 }) {
            try? FileManager.default.removeItem(at: url(file))
        }
        jobs.removeAll { $0.id == id }
        persist()
    }

    /// Build whatever's waiting, one at a time (also picks up after a relaunch).
    func processNext() {
        guard !working, let job = jobs.last(where: { $0.state == .building }) else { return }
        working = true
        let background = UIApplication.shared.beginBackgroundTask(withName: "build-at-bat")
        Task {
            await build(job)
            UIApplication.shared.endBackgroundTask(background)
            working = false
            processNext()
        }
    }

    private func build(_ job: AtBatJob) async {
        let editName = "edit-\(job.id.uuidString).mp4"
        let rawURL = job.rawFile.map(url)
        do {
            // A retry after the edit was already built skips straight to saving it.
            if job.editFile == nil || !FileManager.default.fileExists(atPath: url(editName).path) {
                guard let rawURL, FileManager.default.fileExists(atPath: rawURL.path) else {
                    throw NSError(domain: "ClipsCamera", code: 2, userInfo: [NSLocalizedDescriptionKey: "The recording is missing."])
                }
                guard !job.pitches.isEmpty else {
                    throw NSError(domain: "ClipsCamera", code: 3, userInfo: [NSLocalizedDescriptionKey: "No pitches were logged, so there's nothing to cut."])
                }
                let edit = try await EditRenderer.render(
                    raw: rawURL,
                    rotation: job.rotation,
                    pitches: job.pitches,
                    result: job.result,
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
            try await Self.saveToPhotos(url(editName))
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

    private static func saveToPhotos(_ file: URL) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            throw NSError(domain: "ClipsCamera", code: 1, userInfo: [NSLocalizedDescriptionKey: "Photos access is off — turn it on in Settings › Clips Camera."])
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
