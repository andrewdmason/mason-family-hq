import AVFoundation
import PhotosUI
import SwiftUI

/// The homework camera. It stays open for as many pictures as it takes (pages
/// of a worksheet, a textbook spread), shows each one as it's taken, and closes
/// only on Done. What it took goes to the message being written.
struct CameraView: View {
    let onDone: ([ChatPhoto]) -> Void

    @State private var camera = Camera()
    @State private var taken: [ChatPhoto] = []
    @State private var flash = false
    @State private var libraryPicks: [PhotosPickerItem] = []
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if camera.available {
                CameraPreview(session: camera.session)
                    .ignoresSafeArea()
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
                    }
                }
                libraryPicks = []
            }
        }
        .statusBarHidden()
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
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device) else { return }
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
                session.startRunning()
                done.resume(returning: true)
            }
        }
        available = ok
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
