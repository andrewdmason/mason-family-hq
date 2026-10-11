import AVFoundation
import Observation
import UIKit

// The camera: back camera at 1920×1080, 240fps, with sound, written straight to
// a raw HEVC file. We write frames ourselves (AVAssetWriter) rather than using a
// movie-file output so a tap maps exactly onto the video's clock: every frame's
// timestamp and every tap are measured on the capture session's clock, and a
// pitch's time is just tap − first frame.

/// One zoom button. At 240fps the phone can't hop between lenses on its own
/// (the multi-lens camera doesn't offer 1080p240), so each button is a whole
/// lens at its native size — no blurry digital zoom. The one exception is 2×:
/// the main lens can crop its full-resolution sensor cleanly, but only at
/// 120fps, so that button trades smoother slow-mo for reach.
struct Lens: Identifiable, Equatable {
    /// What the button says ("0.5×", "1×", "2×", "4×").
    var label: String
    var fps: Int32
    var id: String { label }
}

/// How to set the camera up for a lens (session queue).
private struct LensSetup {
    var lens: Lens
    var device: AVCaptureDevice
    var format: AVCaptureDevice.Format
    var zoom: CGFloat
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
    private(set) var lenses: [Lens] = []
    private(set) var lens: Lens?

    let session = AVCaptureSession()

    // MARK: Capture internals (sessionQueue / dataQueue)
    private let sessionQueue = DispatchQueue(label: "capture.session")
    private let dataQueue = DispatchQueue(label: "capture.data", qos: .userInitiated)
    private var device: AVCaptureDevice?
    private var deviceInput: AVCaptureDeviceInput?
    private var lensSetups: [String: LensSetup] = [:]
    private let videoOutput = AVCaptureVideoDataOutput()
    private let audioOutput = AVCaptureAudioDataOutput()
    private var configured = false
    // Main thread.
    private var rotationCoordinator: AVCaptureDevice.RotationCoordinator?
    private weak var previewLayer: AVCaptureVideoPreviewLayer?
    private var configuredDevice: AVCaptureDevice?
    @ObservationIgnored private var previewAngleObservation: NSKeyValueObservation?

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

    /// The zoom buttons, widest first: every back lens with a 1920×1080 format
    /// reaching 240fps, labelled the way the Camera app names them, plus a
    /// sensor-crop 2× on the main lens at 120fps.
    private static func findLenses() -> [LensSetup] {
        let types: [AVCaptureDevice.DeviceType] = [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera]
        let devices = types.compactMap { AVCaptureDevice.default($0, for: .video, position: .back) }
        let wide = devices.first { $0.deviceType == .builtInWideAngleCamera }
        let wideFov = wide.flatMap { bestFormat($0, fps: 240) }?.videoFieldOfView
        var setups: [LensSetup] = []
        for d in devices {
            guard let f = bestFormat(d, fps: 240) else { continue }
            let label: String
            switch d.deviceType {
            case .builtInUltraWideCamera: label = "0.5×"
            case .builtInTelephotoCamera:
                // 4× on a 17 Pro; older phones have 2×, 3× or 5×.
                func halfWidth(_ fov: Float) -> Double { tan(Double(fov) * .pi / 360) }
                let ratio: Double = wideFov.map { halfWidth($0) / halfWidth(f.videoFieldOfView) } ?? 3
                label = "\(Int(ratio.rounded()))×"
            default: label = "1×"
            }
            setups.append(LensSetup(lens: Lens(label: label, fps: 240), device: d, format: f, zoom: 1))
        }
        // 2× straight after the main lens (unless a telephoto already is 2×),
        // from a 120fps format that reads at least twice the video's
        // resolution, so the crop isn't upscaled.
        if let wide, !setups.contains(where: { $0.lens.label == "2×" }),
           let crop = bestFormat(wide, fps: 120), crop.videoZoomFactorUpscaleThreshold >= 2,
           let i = setups.firstIndex(where: { $0.device == wide }) {
            setups.insert(LensSetup(lens: Lens(label: "2×", fps: 120), device: wide, format: crop, zoom: 2), at: i + 1)
        }
        return setups
    }

    /// A 1920×1080 8-bit format reaching `fps`, preferring the one that reads
    /// the most sensor (highest zoom before upscaling), then the widest view.
    static func bestFormat(_ d: AVCaptureDevice, fps: Double = 240) -> AVCaptureDevice.Format? {
        let candidates = d.formats.filter { f in
            let dims = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
            // 8-bit 4:2:0 (video or full range) keeps the encoder on its fast path.
            let eightBit = sub == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
                || sub == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
            return dims.width == 1920 && dims.height == 1080 && eightBit
                && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= fps }
        }
        return candidates.max { a, b in
            if a.videoZoomFactorUpscaleThreshold != b.videoZoomFactorUpscaleThreshold {
                return a.videoZoomFactorUpscaleThreshold < b.videoZoomFactorUpscaleThreshold
            }
            return a.videoFieldOfView < b.videoFieldOfView
        }
    }

    private func configure() throws {
        let found = Self.findLenses()
        guard let start = found.first(where: { $0.lens.label == "1×" }) ?? found.first else {
            throw AVCaptureDevice.default(for: .video) == nil ? CaptureError.noCamera : CaptureError.no240fps
        }
        lensSetups = Dictionary(uniqueKeysWithValues: found.map { ($0.lens.id, $0) })
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .inputPriority
        session.automaticallyConfiguresApplicationAudioSession = true
        // iOS mutes haptics while the mic records; the pitch tap needs its buzz.
        try? AVAudioSession.sharedInstance().setAllowHapticsAndSystemSoundsDuringRecording(true)

        if let mic = AVCaptureDevice.default(for: .audio), let audioIn = try? AVCaptureDeviceInput(device: mic), session.canAddInput(audioIn) {
            session.addInput(audioIn)
        }
        videoOutput.alwaysDiscardsLateVideoFrames = false
        videoOutput.setSampleBufferDelegate(self, queue: dataQueue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        audioOutput.setSampleBufferDelegate(self, queue: dataQueue)
        if session.canAddOutput(audioOutput) { session.addOutput(audioOutput) }

        let stabilized = try attach(start)
        configured = true
        let lenses = found.map(\.lens)
        DispatchQueue.main.async {
            self.lenses = lenses
            self.lensAttached(start.lens, device: start.device, stabilized: stabilized)
        }
    }

    /// Make the setup's lens the session's camera. Session queue, inside a
    /// configuration block. Returns whether stabilization is on.
    private func attach(_ setup: LensSetup) throws -> Bool {
        let device = setup.device
        if deviceInput?.device != device {
            let input = try AVCaptureDeviceInput(device: device)
            let old = deviceInput
            if let old { session.removeInput(old) }
            guard session.canAddInput(input) else {
                if let old { session.addInput(old) }
                throw CaptureError.noCamera
            }
            session.addInput(input)
            deviceInput = input
            self.device = device
        }

        try device.lockForConfiguration()
        device.activeFormat = setup.format
        let frame = CMTime(value: 1, timescale: setup.lens.fps)
        device.activeVideoMinFrameDuration = frame
        device.activeVideoMaxFrameDuration = frame
        device.videoZoomFactor = min(setup.zoom, setup.format.videoMaxZoomFactor)
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
        device.unlockForConfiguration()

        // Stabilization is on whenever the format allows it. The video
        // connection is new with each lens, so this is set every time.
        if let c = videoOutput.connection(with: .video), c.isVideoStabilizationSupported {
            c.preferredVideoStabilizationMode = .standard
            return true
        }
        return false
    }

    @MainActor
    private func lensAttached(_ lens: Lens, device: AVCaptureDevice, stabilized: Bool) {
        self.lens = lens
        configuredDevice = device
        // The rotation coordinator belongs to one camera; make a fresh one.
        previewAngleObservation = nil
        rotationCoordinator = nil
        setUpRotation()
        formatDescription = "1080p · \(lens.fps)fps · \(lens.label) · \(stabilized ? "stabilized" : "no stabilization")"
    }

    /// Switch lenses (between at-bats only — the picture blinks while it swaps).
    @MainActor
    func setLens(_ lens: Lens) {
        guard !isRecording, lens != self.lens else { return }
        let previous = self.lens
        self.lens = lens
        sessionQueue.async { [self] in
            guard !wantsRecording, let setup = lensSetups[lens.id] else {
                DispatchQueue.main.async { self.lens = previous }
                return
            }
            session.beginConfiguration()
            let stabilized = try? attach(setup)
            session.commitConfiguration()
            DispatchQueue.main.async {
                if let stabilized {
                    self.lensAttached(lens, device: setup.device, stabilized: stabilized)
                } else {
                    self.lens = previous
                }
            }
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
        // The angle changes only once the screen has finished turning, which is
        // after the device-orientation notification and (for a half turn) with
        // no re-layout — so follow the coordinator itself.
        previewAngleObservation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.updatePreviewRotation() }
        }
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
