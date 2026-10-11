import Foundation

/// Uploads the finished videos with a background URLSession, so they keep
/// going with the app closed and wait out dead spots at the field. One task per
/// at-bat, tagged with its id; the session outlives app launches, so on relaunch
/// it reconnects to whatever was still in flight.
final class UploadSession: NSObject, URLSessionTaskDelegate, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = UploadSession()

    /// Main-thread callbacks.
    var onProgress: ((UUID, Double) -> Void)?
    var onFinish: ((UUID, Result<Void, Error>) -> Void)?
    /// Handed over by the app delegate when iOS wakes us for finished uploads.
    var backgroundCompletion: (() -> Void)?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Config.uploadSessionID)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var bodies: [Int: Data] = [:]
    private let lock = NSLock()

    /// Wake the session (reconnects to uploads from an earlier launch).
    func activate() { _ = session }

    /// At-bat ids with an upload still in flight.
    func activeUploads() async -> Set<UUID> {
        let tasks = await session.allTasks
        return Set(tasks.filter { $0.state == .running || $0.state == .suspended }.compactMap { $0.taskDescription.flatMap(UUID.init) })
    }

    func upload(_ file: URL, to url: URL, contentType: String, id: UUID) {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("true", forHTTPHeaderField: "x-upsert")
        let task = session.uploadTask(with: request, fromFile: file)
        task.taskDescription = id.uuidString
        task.resume()
    }

    // MARK: Delegate

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let id = task.taskDescription.flatMap(UUID.init), totalBytesExpectedToSend > 0 else { return }
        let fraction = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
        DispatchQueue.main.async { self.onProgress?(id, fraction) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); bodies[dataTask.taskIdentifier, default: Data()].append(data); lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription.flatMap(UUID.init) else { return }
        lock.lock(); let body = bodies.removeValue(forKey: task.taskIdentifier); lock.unlock()
        let result: Result<Void, Error>
        if let error {
            result = .failure(error)
        } else if let http = task.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let detail = body.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            result = .failure(NSError(domain: "Upload", code: http.statusCode, userInfo: [
                NSLocalizedDescriptionKey: "Upload rejected (\(http.statusCode)) \(detail.prefix(200))",
            ]))
        } else {
            result = .success(())
        }
        DispatchQueue.main.async { self.onFinish?(id, result) }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletion?()
            self.backgroundCompletion = nil
        }
    }
}
