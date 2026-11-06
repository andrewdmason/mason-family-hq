import AVFoundation
import PhotosUI
import SwiftUI

/// The homework camera. It stays open for as many pictures as it takes (pages
/// of a worksheet, a textbook spread), shows each one as it's taken, and closes
/// only on Done. What it took goes to the message being written.
struct CameraView: View {
    let onDone: ([ChatPhoto]) -> Void
    /// Called with each photo as it's taken (voice mode sends them one by one).
    var onShot: ((ChatPhoto) -> Void)? = nil

    @State private var camera = Camera()
    @State private var taken: [ChatPhoto] = []
    @State private var flash = false
    @State private var libraryPicks: [PhotosPickerItem] = []
    @State private var pinchStart: CGFloat?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if camera.available {
                CameraPreview(session: camera.session)
                    .ignoresSafeArea()
                    .gesture(MagnifyGesture()
                        .onChanged { pinch in
                            let start = pinchStart ?? camera.zoom
                            pinchStart = start
                            camera.setZoom(start * pinch.magnification)
                        }
                        .onEnded { _ in pinchStart = nil })
            } else {
                ContentUnavailableView(
                    camera.denied ? "Camera access is off" : "No camera here",
                    systemImage: "camera",
                    description: Text(camera.denied
                        ? "Turn on the camera for Tuttles in Settings, or pick photos you've already taken."
                        : "Pick photos you've already taken instead."))
                    .foregroundStyle(.white)
            }
            Color.white.opacity(flash ? 0.7 : 0).ignoresSafeArea().allowsHitTesting(false)

            VStack {
                Spacer()
                if camera.available && camera.zoomStops.count > 1 { lenses }
                if !taken.isEmpty { strip }
                controls
            }
        }
        .task { await camera.start() }
        .onDisappear { camera.stop() }
        .onChange(of: libraryPicks) { _, picks in
            Task {
                for pick in picks {
                    if let data = try? await pick.loadTransferable(type: Data.self),
                       let image = UIImage(data: data), let photo = ChatPhoto(image) {
                        taken.append(photo)
                        onShot?(photo)
                    }
                }
                libraryPicks = []
            }
        }
        .statusBarHidden()
    }

    /// The Camera app's lens buttons: one per lens this phone has (.5, 1, 2,
    /// 4…). The one in use shows the exact zoom, so a pinch reads as "1.4×".
    private var lenses: some View {
        HStack(spacing: 2) {
            ForEach(camera.zoomStops, id: \.self) { stop in
                let active = stop == camera.zoomStops.last { $0 <= camera.zoom + 0.01 }
                Button {
                    withAnimation(.snappy) { camera.setZoom(stop, glide: true) }
                } label: {
                    Text(Self.zoomLabel(active ? camera.zoom : stop, active: active))
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(active ? .yellow : .white)
                        .frame(width: active ? 40 : 32, height: active ? 40 : 32)
                        .background(.black.opacity(0.4), in: .circle)
                }
            }
        }
        .padding(4)
        .background(.black.opacity(0.25), in: .capsule)
        .padding(.bottom, 6)
    }

    private static func zoomLabel(_ zoom: CGFloat, active: Bool) -> String {
        let tenths = (zoom * 10).rounded() / 10
        var text = tenths == tenths.rounded() ? String(Int(tenths)) : String(format: "%.1f", tenths)
        if text.hasPrefix("0.") { text.removeFirst() }
        return active ? text + "×" : text
    }

    private var strip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(taken) { photo in
                        Image(uiImage: photo.image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 56, height: 74)
                            .clipShape(.rect(cornerRadius: 10))
                            .overlay(alignment: .topTrailing) {
                                Button {
                                    withAnimation { taken.removeAll { $0.id == photo.id } }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .black.opacity(0.6))
                                }
                                .offset(x: 6, y: -6)
                            }
                            .id(photo.id)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)
            }
            .onChange(of: taken.count) { proxy.scrollTo(taken.last?.id) }
        }
    }

    /// Library on the left, shutter centred, Done (with the count) bottom right,
    /// under the thumb.
    private var controls: some View {
        ZStack {
            HStack {
                PhotosPicker(selection: $libraryPicks, maxSelectionCount: 10, matching: .images) {
                    Image(systemName: "photo.on.rectangle")
                        .font(.title2)
                        .frame(width: 56, height: 56)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                Spacer()
                Button(taken.isEmpty ? "Done" : "Done (\(taken.count))") { finish() }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
            }
            Button(action: shoot) {
                Circle()
                    .fill(.white)
                    .frame(width: 68, height: 68)
                    .padding(5)
                    .overlay(Circle().strokeBorder(.white, lineWidth: 3))
            }
            .disabled(!camera.available)
            .opacity(camera.available ? 1 : 0.3)
            .accessibilityLabel("Take picture")
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
    }

    private func shoot() {
        withAnimation(.easeOut(duration: 0.08)) { flash = true }
        withAnimation(.easeIn(duration: 0.25).delay(0.08)) { flash = false }
        Task {
            guard let image = await camera.capture(), let photo = ChatPhoto(image) else { return }
            withAnimation(.snappy) { taken.append(photo) }
            onShot?(photo)
        }
    }

    private func finish() {
        onDone(taken)
        dismiss()
    }
}

/// The capture session and the still-photo output. Runs off the main thread,
/// as AVFoundation wants.
@Observable
final class Camera: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "io.mason.tuttles.camera")
    @MainActor private(set) var available = false
    @MainActor private(set) var denied = false
    /// Zoom the way the Camera app counts it: 1 is the main lens, .5 the ultra
    /// wide. The device's own zoom factor starts from its widest lens instead.
    @MainActor private(set) var zoom: CGFloat = 1
    @MainActor private(set) var zoomStops: [CGFloat] = []
    @MainActor private var zoomRange: ClosedRange<CGFloat> = 1...1
    @MainActor private var device: AVCaptureDevice?
    private var pending: [Int64: CheckedContinuation<UIImage?, Never>] = [:]

    @MainActor
    func start() async {
        var status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .notDetermined {
            status = await AVCaptureDevice.requestAccess(for: .video) ? .authorized : .denied
        }
        guard status == .authorized else {
            denied = status == .denied || status == .restricted
            return
        }
        // The multi-lens camera, so zooming crosses to the ultra wide and
        // telephoto lenses the way the Camera app does.
        let kinds: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
        guard let device = kinds.lazy.compactMap({ AVCaptureDevice.default($0, for: .video, position: .back) }).first,
              let input = try? AVCaptureDeviceInput(device: device) else { return }
        let scale = device.displayVideoZoomFactorMultiplier
        let ok: Bool = await withCheckedContinuation { done in
            queue.async { [session, output] in
                session.beginConfiguration()
                session.sessionPreset = .photo
                guard session.canAddInput(input), session.canAddOutput(output) else {
                    session.commitConfiguration()
                    done.resume(returning: false)
                    return
                }
                session.addInput(input)
                session.addOutput(output)
                output.maxPhotoQualityPrioritization = .balanced
                session.commitConfiguration()
                // Open on the main lens (1×), not the ultra wide.
                if (try? device.lockForConfiguration()) != nil {
                    device.videoZoomFactor = 1 / scale
                    device.unlockForConfiguration()
                }
                session.startRunning()
                done.resume(returning: true)
            }
        }
        available = ok
        guard ok else { return }
        self.device = device
        zoomRange = device.minAvailableVideoZoomFactor * scale...min(device.maxAvailableVideoZoomFactor * scale, 10)
        let lenses = [device.minAvailableVideoZoomFactor] + device.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        zoomStops = Set(lenses.map { $0 * scale } + [1, 2]).filter(zoomRange.contains).sorted()
    }

    /// Pinches set the zoom outright; the lens buttons glide to theirs.
    @MainActor
    func setZoom(_ value: CGFloat, glide: Bool = false) {
        guard let device else { return }
        zoom = min(max(value, zoomRange.lowerBound), zoomRange.upperBound)
        let factor = zoom / device.displayVideoZoomFactorMultiplier
        queue.async {
            guard (try? device.lockForConfiguration()) != nil else { return }
            if glide { device.ramp(toVideoZoomFactor: factor, withRate: 16) } else { device.videoZoomFactor = factor }
            device.unlockForConfiguration()
        }
    }

    func stop() {
        queue.async { [session] in session.stopRunning() }
    }

    func capture() async -> UIImage? {
        await withCheckedContinuation { done in
            queue.async { [self] in
                let settings = AVCapturePhotoSettings()
                settings.photoQualityPrioritization = .balanced
                pending[settings.uniqueID] = done
                output.capturePhoto(with: settings, delegate: self)
            }
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let image = photo.fileDataRepresentation().flatMap(UIImage.init(data:))
        queue.async { [self] in
            pending.removeValue(forKey: photo.resolvedSettings.uniqueID)?.resume(returning: image)
        }
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.preview.session = session
        view.preview.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}
}
