import PhotosUI
import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// A to-do's attachments on the phone: thumbnails and named chips, side by side.
/// Tap opens, or tries again after a failure; press and hold for the rest.
struct AttachmentStrip: View {
    let store: AttachmentStore
    let todoID: String
    @State private var previewing: URL?

    var body: some View {
        let items = store.items(for: todoID)
        if !items.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items) { item in
                        Button { tap(item) } label: { tile(item) }
                            .buttonStyle(.plain)
                            .contextMenu {
                                if item.canRetry {
                                    Button("Try Again", systemImage: "arrow.clockwise") { store.retry(item) }
                                }
                                Button("Open", systemImage: "eye") { open(item) }
                                Button("Remove", systemImage: "trash", role: .destructive) { store.remove(item) }
                            }
                    }
                }
                .padding(.vertical, 2)
            }
            .quickLookPreview($previewing)
        }
    }

    @ViewBuilder
    private func tile(_ item: AttachmentItem) -> some View {
        if item.isImage {
            AttachmentThumbnail(store: store, item: item)
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay {
                    if item.isUploading {
                        ProgressView()
                    } else if item.failure != nil {
                        Image(systemName: "exclamationmark.circle.fill").font(.title2).foregroundStyle(.white, .red)
                    }
                }
                .accessibilityLabel(item.failure.map { "\(item.name): \($0)" } ?? item.name)
        } else {
            HStack(spacing: 6) {
                if item.isUploading {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: item.failure == nil ? "doc.text" : "exclamationmark.circle")
                        .foregroundStyle(item.failure == nil ? Color.secondary : Color.red)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(item.name).font(.footnote).lineLimit(1).truncationMode(.middle)
                    if let failure = item.failure {
                        Text(failure).font(.caption2).foregroundStyle(.red)
                    }
                }
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: 220, minHeight: 36)
            .background(Color(uiColor: .secondarySystemBackground), in: Capsule())
        }
    }

    private func tap(_ item: AttachmentItem) {
        if item.canRetry { store.retry(item) } else { open(item) }
    }

    private func open(_ item: AttachmentItem) {
        Task { previewing = await store.originalFile(item) }
    }
}

private struct AttachmentThumbnail: View {
    let store: AttachmentStore
    let item: AttachmentItem
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Color(uiColor: .tertiarySystemFill)
            if let image {
                Image(uiImage: image).resizable().scaledToFill().opacity(item.isUploading ? 0.5 : 1)
            }
        }
        .task(id: item.id) {
            guard let file = await store.previewFile(item), let thumbnail = AttachmentImaging.thumbnail(of: file, maxEdge: 216) else { return }
            image = UIImage(cgImage: thumbnail)
        }
    }
}

/// The camera, which SwiftUI has no view of its own for.
struct CameraPicker: UIViewControllerRepresentable {
    let onPhoto: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPhoto(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

/// Photos, Camera or Files, offered from the attach button.
struct AttachmentPicking: ViewModifier {
    let store: AttachmentStore
    let todoID: String
    @Binding var isChoosing: Bool

    @State private var showingPhotos = false
    @State private var showingCamera = false
    @State private var showingFiles = false
    @State private var photos: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        content
            .confirmationDialog("Attach", isPresented: $isChoosing) {
                Button("Photos") { showingPhotos = true }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Camera") { showingCamera = true }
                }
                Button("Files") { showingFiles = true }
            }
            .photosPicker(isPresented: $showingPhotos, selection: $photos, maxSelectionCount: 10, matching: .images)
            .fullScreenCover(isPresented: $showingCamera) {
                CameraPicker { addPhoto($0) }.ignoresSafeArea()
            }
            .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let files) = result { store.add(files: files, to: todoID) }
            }
            .onChange(of: photos) { _, picked in
                guard !picked.isEmpty else { return }
                photos = []
                for item in picked { add(item) }
            }
    }

    private func addPhoto(_ image: UIImage) {
        guard let data = image.jpegData(compressionQuality: 0.9) else { return }
        store.add(data: data, fileName: "Photo.jpg", mimeType: "image/jpeg", to: todoID)
    }

    private func add(_ item: PhotosPickerItem) {
        Task {
            guard let data = try? await item.loadTransferable(type: Data.self) else { return }
            let type = item.supportedContentTypes.first
            let ext = type?.preferredFilenameExtension ?? "jpg"
            store.add(data: data, fileName: "Photo.\(ext)", mimeType: type?.preferredMIMEType, to: todoID)
        }
    }
}
