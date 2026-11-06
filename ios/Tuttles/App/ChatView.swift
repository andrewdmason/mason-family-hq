import SwiftUI

/// One chat: the conversation, and the message being written with the camera
/// beside it.
struct ChatView: View {
    let threadID: UUID
    let isNew: Bool
    let title: String?

    @Environment(ChatStore.self) private var store
    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var photos: [ChatPhoto] = []
    @State private var sending = false
    @State private var loadError: String?
    @State private var sendError: String?
    @State private var showingCamera = false
    @State private var viewing: PhotoRef?
    /// Which costume Tuttles greets a new chat in (Tuttles1…Tuttles10).
    @State private var pose = Int.random(in: 1...10)
    @FocusState private var typing: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    ForEach(messages) { message in
                        switch message.role {
                        case .student: StudentMessage(message: message, viewing: $viewing)
                        case .tutor: TutorMessage(message: message)
                        }
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.last?.content) {
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onChange(of: messages.count) {
                withAnimation { proxy.scrollTo("end", anchor: .bottom) }
            }
        }
        .overlay { if messages.isEmpty { emptyState } }
        .safeAreaInset(edge: .bottom) { composer }
        .navigationTitle(title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard !isNew, messages.isEmpty else { return }
            do { messages = try await store.messages(in: threadID) } catch { loadError = "Couldn't load this chat." }
        }
        .fullScreenCover(isPresented: $showingCamera) {
            CameraView { taken in
                photos.append(contentsOf: taken)
                if !taken.isEmpty { typing = true }
            }
        }
        .fullScreenCover(item: $viewing) { PhotoViewer(ref: $0) }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image("Tuttles\(pose)")
                .resizable()
                .scaledToFit()
                .frame(height: 200)
            Text(loadError ?? "What are you working on?")
                .font(.title3.weight(.semibold))
            if loadError == nil {
                Text("Snap your homework or ask a question.")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.bottom, 40)
        .allowsHitTesting(false)
    }

    // MARK: - Writing

    private var canSend: Bool {
        !sending && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !photos.isEmpty)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let sendError {
                Label(sendError, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 6)
            }
            if !photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(photos) { photo in
                            Image(uiImage: photo.image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 60, height: 78)
                                .clipShape(.rect(cornerRadius: 12))
                                .overlay(alignment: .topTrailing) {
                                    Button {
                                        withAnimation { photos.removeAll { $0.id == photo.id } }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, .black.opacity(0.55))
                                    }
                                    .offset(x: 5, y: -5)
                                    .accessibilityLabel("Remove photo")
                                }
                        }
                    }
                    .padding(.top, 6)
                    .padding(.horizontal, 6)
                }
            }
            HStack(alignment: .bottom, spacing: 10) {
                Button {
                    typing = false
                    showingCamera = true
                } label: {
                    Image(systemName: "camera.fill")
                        .font(.title3)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Camera")

                HStack(alignment: .bottom, spacing: 6) {
                    TextField("Ask Tuttles", text: $draft, axis: .vertical)
                        .lineLimit(1...6)
                        .focused($typing)
                        .padding(.vertical, 10)
                        .padding(.leading, 16)
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.bold))
                            .frame(width: 22, height: 22)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .disabled(!canSend)
                    .padding(4)
                    .accessibilityLabel("Send")
                }
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 6)
    }

    private func send() {
        guard canSend else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sent = photos
        let student = ChatMessage(id: UUID(), role: .student, content: text, photos: sent)
        let reply = ChatMessage(id: UUID(), role: .tutor, content: "", streaming: true)
        withAnimation(.snappy) {
            messages.append(student)
            messages.append(reply)
        }
        draft = ""
        photos = []
        sending = true
        sendError = nil

        Task {
            do {
                try await store.send(threadID: threadID, text: text, photos: sent) { soFar in
                    if let at = messages.firstIndex(where: { $0.id == reply.id }) { messages[at].content = soFar }
                }
                if let at = messages.firstIndex(where: { $0.id == reply.id }) { messages[at].streaming = false }
            } catch {
                // Nothing was saved, so the turn comes back to the box to send again.
                withAnimation {
                    messages.removeAll { $0.id == reply.id || $0.id == student.id }
                }
                if draft.isEmpty { draft = text }
                photos = sent + photos
                sendError = "Didn't send: \(error.localizedDescription)"
            }
            sending = false
        }
    }
}

// MARK: - Messages

private struct StudentMessage: View {
    let message: ChatMessage
    @Binding var viewing: PhotoRef?

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if !message.photos.isEmpty || !message.imagePaths.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(message.photos) { photo in
                            Button { viewing = .local(photo.image) } label: { Thumb(image: photo.image) }
                        }
                        ForEach(message.imagePaths, id: \.self) { path in
                            RemoteThumb(path: path, viewing: $viewing)
                        }
                    }
                }
                .defaultScrollAnchor(.trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            if !message.content.isEmpty {
                Text(message.content)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemFill), in: .rect(cornerRadius: 20))
                    .frame(maxWidth: 300, alignment: .trailing)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

private struct TutorMessage: View {
    let message: ChatMessage

    var body: some View {
        if message.streaming && message.content.isEmpty {
            ThinkingDots()
        } else {
            MessageContent(text: message.content)
                .textSelection(.enabled)
        }
    }
}

private struct ThinkingDots: View {
    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 5) {
                ForEach(0..<3) { i in
                    Circle()
                        .frame(width: 8, height: 8)
                        .opacity(0.3 + 0.7 * max(0, sin(t * 5 - Double(i) * 0.7)))
                }
            }
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        .accessibilityLabel("Tuttles is thinking")
    }
}

private struct Thumb: View {
    let image: UIImage?
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Rectangle().fill(.quaternary)
            }
        }
        .frame(width: 96, height: 128)
        .clipShape(.rect(cornerRadius: 14))
    }
}

private struct RemoteThumb: View {
    let path: String
    @Binding var viewing: PhotoRef?
    @Environment(ChatStore.self) private var store
    @State private var image: UIImage?

    var body: some View {
        Button { if let image { viewing = .local(image) } } label: { Thumb(image: image) }
            .task { image = await store.photo(at: path) }
    }
}

enum PhotoRef: Identifiable {
    case local(UIImage)
    var id: ObjectIdentifier {
        switch self { case .local(let image): ObjectIdentifier(image) }
    }
}

private struct PhotoViewer: View {
    let ref: PhotoRef
    @Environment(\.dismiss) private var dismiss
    @State private var zoom: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if case .local(let image) = ref {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(zoom)
                    .gesture(MagnifyGesture().onChanged { zoom = max(1, $0.magnification) }.onEnded { _ in
                        withAnimation { zoom = 1 }
                    })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button("Done") { dismiss() }
                .buttonStyle(.glass)
                .padding()
        }
    }
}
