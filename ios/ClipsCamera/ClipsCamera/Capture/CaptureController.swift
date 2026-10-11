import AVFoundation
import Observation
import UIKit

// The camera: back camera at 1920×1080, 240fps, with sound, written straight to
// a raw HEVC file. We write frames ourselves (AVAssetWriter) rather than using a
// movie-file output so a tap maps exactly onto the video's clock: every frame's
// timestamp and every tap are measured on the capture session's clock, and a
// pitch's time is just tap − first frame.

struct ZoomStop: Identifiable, Equatable {
    /// What the button says ("1×").
    var label: String
    /// The device's zoom factor for it.
    var factor: CGFloat
    var id: String { label }
}

enum CaptureError: LocalizedError {
    case noCamera, no240fps, notAuthorized, writer(String)
    var errorDescription: String? {
        switch self {
        case .noCamera: "No back camera found."
        case .no240fps: "This camera can't record 1080p at 240fps."
        case .notAuthorized: "Camera or microphone access is off — turn it on in Settings › Clips Camera."
        case .writer(let m): "Recording failed: \(m)"
        }
    }
}

struct FinishedRecording {
    var url: URL
    var duration: Double
    /// Rotation (degrees) the raw file needs to be upright: 0 or 180.
    var rotation: Int
}

@Observable
final class CaptureController: NSObject, @unchecked Sendable {
    // MARK: UI state (main thread)
    private(set) var isRunning = false
    private(set) var isRecording = false
    private(set) var setupError: String?
    private(set) var formatDescription = ""
    private(set) var zoomStops: [ZoomStop] = []
    private(set) var zoom: ZoomStop?

    let session = AVCaptureSession()

    // MARK: Capture internals (sessionQueue / dataQueue)
    private let sessionQueue = DispatchQueue(label: "capture.session")
    private let dataQueue = DispatchQueue(label: "capture.data", qos: .userInitiated)
    private var device: AVCaptureDevice?
    private let videoOutput = AVCaptureVideoDataOutput()
    private let audioOutput = AVCaptureAudioDataOutput()
    private var configured = false
    // Main thread.
    private var rotationCoordinator: AVCaptureDevice.RotationCoordinator?
    private weak var previewLayer: AVCaptureVideoPreviewLayer?
    private var configuredDevice: AVCaptureDevice?

    // Touched only on dataQueue while recording.
    private var writer: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var wantsRecording = false
    private var firstFrameTime: CMTime?
    private var lastFrameTime: CMTime?
    private var recordingRotation = 0
    private var writerError: String?

    // MARK: Lifecycle

    /// Ask for camera and mic, configure once, and start the preview.
    func start() async {
        guard await Self.authorize(.video), await Self.authorize(.audio) else {
            await MainActor.run { setupError = CaptureError.notAuthorized.localizedDescription }
            return
        }
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            sessionQueue.async { [self] in
                if !configured {
                    do { try configure() } catch {
                        let message = error.localizedDescription
                        DispatchQueue.main.async { self.setupError = message }
                        done.resume()
                        return
                    }
                }
                if !session.isRunning { session.startRunning() }
                let running = session.isRunning
                DispatchQueue.main.async { self.isRunning = running }
                done.resume()
            }
        }
    }

    /// Power the camera down (between at-bats, or when the app leaves the screen).
    func stop() {
        sessionQueue.async { [self] in
            guard session.isRunning, !wantsRecording else { return }
            session.stopRunning()
            DispatchQueue.main.async { self.isRunning = false }
        }
    }

    private static func authorize(_ media: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: media) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: media)
        default: false
        }
    }

    // MARK: Configuration

    /// The first camera (multi-lens first, so zoom switches lenses) that has a
    /// 1920×1080 format reaching 240fps.
    private func pickDevice() -> (AVCaptureDevice, AVCaptureDevice.Format)? {
        let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInWideAngleCamera]
        for type in types {
            guard let d = AVCaptureDevice.default(type, for: .video, position: .back) else { continue }
            if let f = Self.bestFormat(d) { return (d, f) }
        }
        return nil
    }

    static func bestFormat(_ d: AVCaptureDevice) -> AVCaptureDevice.Format? {
        let candidates = d.formats.filter { f in
            let dims = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
            // 8-bit 4:2:0 (video or full range) keeps the encoder on its fast path.
            let eightBit = sub == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
                || sub == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
            return dims.width == 1920 && dims.height == 1080 && eightBit
                && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 240 }
        }
        // Widest field of view, so the 1× stop isn't a crop.
        return candidates.max { $0.videoFieldOfView < $1.videoFieldOfView }
    }

    private func configure() throws {
        guard let (device, format) = pickDevice() else {
            throw AVCaptureDevice.default(for: .video) == nil ? CaptureError.noCamera : CaptureError.no240fps
        }
        self.device = device
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .inputPriority
        session.automaticallyConfiguresApplicationAudioSession = true
        // iOS mutes haptics while the mic records; the pitch tap needs its buzz.
        try? AVAudioSession.sharedInstance().setAllowHapticsAndSystemSoundsDuringRecording(true)

        let videoIn = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(videoIn) else { throw CaptureError.noCamera }
        session.addInput(videoIn)
        if let mic = AVCaptureDevice.default(for: .audio), let audioIn = try? AVCaptureDeviceInput(device: mic), session.canAddInput(audioIn) {
            session.addInput(audioIn)
        }

        videoOutput.alwaysDiscardsLateVideoFrames = false
        videoOutput.setSampleBufferDelegate(self, queue: dataQueue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        audioOutput.setSampleBufferDelegate(self, queue: dataQueue)
        if session.canAddOutput(audioOutput) { session.addOutput(audioOutput) }

        try device.lockForConfiguration()
        device.activeFormat = format
        let frame = CMTime(value: 1, timescale: 240)
        device.activeVideoMinFrameDuration = frame
        device.activeVideoMaxFrameDuration = frame
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
        let stops = Self.zoomStops(for: device)
        if let one = stops.first(where: { $0.label == "1×" }) ?? stops.first {
            device.videoZoomFactor = one.factor
        }
        device.unlockForConfiguration()

        // Stabilization is on whenever the 240fps format allows it.
        var stabilized = false
        if let c = videoOutput.connection(with: .video), c.isVideoStabilizationSupported {
            c.preferredVideoStabilizationMode = .standard
            stabilized = true
        }

        let fps = format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0
        let lens = device.deviceType == .builtInWideAngleCamera ? "wide" : "multi-lens"
        configured = true
        DispatchQueue.main.async {
            self.configuredDevice = device
            self.setUpRotation()
            self.zoomStops = stops
            self.zoom = stops.first(where: { $0.label == "1×" }) ?? stops.first
            self.formatDescription = "1080p · \(Int(fps))fps · \(lens) · \(stabilized ? "stabilized" : "no stabilization")"
        }
    }

    /// Lens stops for the zoom buttons. On a multi-lens device a factor of 1 is
    /// the ultra-wide, and the switch-over factors mark the wide (our "1×") and
    /// the telephoto.
    static func zoomStops(for d: AVCaptureDevice) -> [ZoomStop] {
        let switches = d.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        let base = switches.first ?? 1
        var factors: [CGFloat] = [1]
        factors += switches
        factors.append(base * 2)
        let maxZoom = min(d.activeFormat.videoMaxZoomFactor, base * 10)
        let unique = Array(Set(factors.filter { $0 <= maxZoom })).sorted()
        return unique.map { f in
            let x = f / base
            let label = x < 1 ? String(format: "%.1g×", x) : (x == x.rounded() ? "\(Int(x))×" : String(format: "%.1f×", x))
            return ZoomStop(label: label, factor: f)
        }
    }

    @MainActor
    func setZoom(_ stop: ZoomStop) {
        zoom = stop
        sessionQueue.async { [self] in
            guard let device, (try? device.lockForConfiguration()) != nil else { return }
            device.ramp(toVideoZoomFactor: stop.factor, withRate: 8)
            device.unlockForConfiguration()
        }
    }

    /// Keeps the preview upright and remembers which way the phone is held.
    /// Main thread; works whichever of this and configuration happens first.
    @MainActor
    func attachPreview(_ layer: AVCaptureVideoPreviewLayer) {
        previewLayer = layer
        setUpRotation()
    }

    @MainActor
    private func setUpRotation() {
        guard rotationCoordinator == nil, let layer = previewLayer, let device = configuredDevice else { return }
        let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: layer)
        rotationCoordinator = coordinator
        updatePreviewRotation()
    }

    /// Call when the phone turns between the two landscape ways.
    @MainActor
    func updatePreviewRotation() {
        guard let coordinator = rotationCoordinator, let connection = previewLayer?.connection else { return }
        let angle = coordinator.videoRotationAngleForHorizonLevelPreview
        if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
    }

    // MARK: Recording

    @MainActor
    func startRecording() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("raw-\(UUID().uuidString).mov")
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)

        var videoSettings = videoOutput.recommendedVideoSettings(forVideoCodecType: .hevc, assetWriterOutputFileType: .mov) ?? [:]
        videoSettings[AVVideoCodecKey] = AVVideoCodecType.hevc
        let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        vIn.expectsMediaDataInRealTime = true
        // Sensor buffers are landscape with the volume buttons up; flip the
        // file's display transform when the phone is held the other way.
        let angle = Int((rotationCoordinator?.videoRotationAngleForHorizonLevelCapture ?? 0).rounded())
        let rotation = ((angle % 360) + 360) % 360 == 180 ? 180 : 0
        if rotation == 180 { vIn.transform = CGAffineTransform(rotationAngle: .pi) }
        guard writer.canAdd(vIn) else { throw CaptureError.writer("can't add video") }
        writer.add(vIn)

        var aIn: AVAssetWriterInput?
        if let audioSettings = audioOutput.recommendedAudioSettingsForAssetWriter(writingTo: .mov) {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
            input.expectsMediaDataInRealTime = true
            if writer.canAdd(input) { writer.add(input); aIn = input }
        }

        dataQueue.sync {
            self.writer = writer
            self.videoInput = vIn
            self.audioInput = aIn
            self.firstFrameTime = nil
            self.lastFrameTime = nil
            self.writerError = nil
            self.recordingRotation = rotation
            self.wantsRecording = true
        }
        isRecording = true
    }

    /// Seconds into the current recording for a moment on the host clock
    /// (CACurrentMediaTime / a touch's timestamp). Nil before the first frame.
    func recordingTime(hostTime: TimeInterval) -> Double? {
        let first = dataQueue.sync { firstFrameTime }
        guard let first else { return nil }
        let host = CMTime(seconds: hostTime, preferredTimescale: 1_000_000_000)
        let t = CMSyncConvertTime(host, from: CMClockGetHostTimeClock(), to: session.synchronizationClock ?? CMClockGetHostTimeClock())
        return max(0, CMTimeSubtract(t, first).seconds)
    }

    /// Seconds recorded so far.
    func recordedSeconds() -> Double {
        dataQueue.sync {
            guard let f = firstFrameTime, let l = lastFrameTime else { return 0 }
            return CMTimeSubtract(l, f).seconds
        }
    }

    @MainActor
    func stopRecording() async throws -> FinishedRecording {
        isRecording = false
        let (writer, vIn, aIn, first, last, rotation, error): (AVAssetWriter?, AVAssetWriterInput?, AVAssetWriterInput?, CMTime?, CMTime?, Int, String?) = dataQueue.sync {
            wantsRecording = false
            defer { self.writer = nil; self.videoInput = nil; self.audioInput = nil }
            return (self.writer, videoInput, audioInput, firstFrameTime, lastFrameTime, recordingRotation, writerError)
        }
        guard let writer, writer.status == .writing, let first, let last else {
            writer?.cancelWriting()
            throw CaptureError.writer(error ?? "no frames were recorded")
        }
        vIn?.markAsFinished()
        aIn?.markAsFinished()
        writer.endSession(atSourceTime: last)
        await writer.finishWriting()
        if writer.status != .completed {
            throw CaptureError.writer(writer.error?.localizedDescription ?? "couldn't finish the file")
        }
        return FinishedRecording(url: writer.outputURL, duration: CMTimeSubtract(last, first).seconds, rotation: rotation)
    }
}

extension CaptureController: AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard wantsRecording, let writer else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        if output === videoOutput {
            if firstFrameTime == nil {
                guard writer.startWriting() else {
                    writerError = writer.error?.localizedDescription ?? "couldn't start writing"
                    return
                }
                writer.startSession(atSourceTime: pts)
                firstFrameTime = pts
            }
            guard writer.status == .writing, let videoInput, videoInput.isReadyForMoreMediaData else { return }
            if videoInput.append(sampleBuffer) { lastFrameTime = pts }
        } else if output === audioOutput {
            // Sound starts with the first frame; earlier buffers are dropped.
            guard let first = firstFrameTime, pts >= first, writer.status == .writing,
                  let audioInput, audioInput.isReadyForMoreMediaData else { return }
            audioInput.append(sampleBuffer)
        }
    }
}
