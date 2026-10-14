import PhotosUI
import SwiftUI

/// Settings › Title cards: a row per kid, opening their look.
struct TitleCardSettingsSection: View {
    let kids: [Kid]
    let store = CardStyleStore.shared

    var body: some View {
        Section {
            ForEach(kids) { kid in
                NavigationLink {
                    KidCardStyleView(kid: kid)
                } label: {
                    HStack {
                        Text(kid.displayName)
                        Spacer()
                        Text(CardTheme.named(store.saved(kid.id).theme).name).foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("Title cards")
        } footer: {
            Text("Each kid's theme and headshot are saved to Clips, so every phone makes the same card.")
        }
    }
}

/// One kid's card: a preview, their theme, their headshot.
struct KidCardStyleView: View {
    let kid: Kid
    let store = CardStyleStore.shared

    @State private var preview: UIImage?
    @State private var tallPreview: UIImage?
    @State private var photoItem: PhotosPickerItem?
    @State private var takingPhoto = false
    @State private var working: String?
    @State private var error: String?

    private var saved: KidCardStyle { store.saved(kid.id) }

    var body: some View {
        Form {
            Section {
                HStack(alignment: .top, spacing: 10) {
                    previewImage(preview, aspect: 16 / 9)
                    previewImage(tallPreview, aspect: 9 / 16).frame(width: 74)
                }
                .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
            }

            Section("Theme") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                    ForEach(CardTheme.all) { theme in
                        Button { choose(theme) } label: { swatch(theme) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }

            Section {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label(saved.headshot == nil ? "Choose a photo" : "Choose a different photo", systemImage: "photo")
                }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { takingPhoto = true } label: { Label("Take a photo", systemImage: "camera") }
                }
                if saved.headshot != nil {
                    Button("Remove headshot", role: .destructive) { removeHeadshot() }
                }
                if let working {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text(working).foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Headshot")
            } footer: {
                Text("Head and shoulders, against anything — the background is cut away on this phone.")
            }
        }
        .navigationTitle(kid.firstName)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(saved.theme)|\(saved.headshot ?? "")") { await render() }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                defer { photoItem = nil }
                guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                    error = "Couldn't open that photo."
                    return
                }
                await useHeadshot(image)
            }
        }
        .fullScreenCover(isPresented: $takingPhoto) {
            CameraPhotoPicker { image in
                takingPhoto = false
                if let image { Task { await useHeadshot(image) } }
            }
            .ignoresSafeArea()
        }
        .alert("Title card", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }

    private func previewImage(_ image: UIImage?, aspect: CGFloat) -> some View {
        Color.black
            .aspectRatio(aspect, contentMode: .fit)
            .overlay { if let image { Image(uiImage: image).resizable().scaledToFit() } else { ProgressView() } }
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func swatch(_ theme: CardTheme) -> some View {
        let selected = saved.theme == theme.id
        return HStack(spacing: 10) {
            ZStack {
                Circle().fill(Color(theme.ink))
                Circle().trim(from: 0, to: 0.5).fill(Color(theme.accent ?? theme.pop)).rotationEffect(.degrees(-45))
                Text("Aa").font(.custom(theme.font, size: 13)).foregroundStyle(Color(theme.pop))
            }
            .frame(width: 34, height: 34)
            .overlay(Circle().stroke(.white.opacity(0.2)))
            Text(theme.name).font(.subheadline.weight(selected ? .semibold : .regular))
            Spacer(minLength: 0)
            if selected { Image(systemName: "checkmark").foregroundStyle(.tint) }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10).fill(selected ? Color.accentColor.opacity(0.15) : Color(.tertiarySystemFill)))
        .contentShape(Rectangle())
    }

    private func choose(_ theme: CardTheme) {
        guard saved.theme != theme.id else { return }
        Task {
            do { try await store.setTheme(theme.id, for: kid.id) } catch { self.error = error.localizedDescription }
        }
    }

    private func useHeadshot(_ photo: UIImage) async {
        working = "Cutting out…"
        defer { working = nil }
        do {
            let cut = try await Headshot.cutout(photo)
            working = "Saving to Clips…"
            try await store.setHeadshot(cut, for: kid.id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func removeHeadshot() {
        Task {
            do { try await store.removeHeadshot(for: kid.id) } catch { self.error = error.localizedDescription }
        }
    }

    /// The card as it'll look (settled), on the graphic background, using
    /// this kid's current game when there is one.
    private func render() async {
        let game = AppSettings.shared.currentGame(for: kid.id)
        var card = TitleCard.make(kid: kid.displayName, result: .double, game: game?.name ?? "Mustangs",
                                  playedOn: game?.playedOn ?? GameChoice.day(Date()), style: store.style(for: kid.id))
        card.swing = nil
        let images = await Task.detached(priority: .userInitiated) {
            let wide = CardAnimator(card: card, size: VideoShape.landscape.size, length: 2).still()
            let tall = CardAnimator(card: card, size: VideoShape.vertical.size, length: 2).still()
            return (wide, tall)
        }.value
        preview = images.0
        tallPreview = images.1
    }
}

/// The camera, for taking a headshot.
struct CameraPhotoPicker: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            done(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { done(nil) }
    }
}
