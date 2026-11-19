import SwiftUI

// The parts of a chat that look the same on the iPhone and the Mac: what the
// student and the tutor said, and the pictures sent along.

// MARK: - Assignments

/// What a chat opened from an assignment is about, above the first message.
struct AssignmentBanner: View {
    let assignment: ClassAssignment
    let info: ClassInfo?

    var body: some View {
        VStack(spacing: 6) {
            if let info { ClassLabel(info: info) }
            Text(assignment.name)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
            Text(assignment.status == .missing ? "was due \(assignment.dueText)" : "due \(assignment.dueText)")
                .font(.subheadline)
                .foregroundStyle(assignment.status == .missing ? .red : .secondary)
        }
        .padding(.horizontal, 24)
    }
}

// MARK: - Messages

struct StudentMessage: View {
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
            ForEach(message.files) { FileButton(file: $0) }
            if !message.content.isEmpty {
                Text(message.content)
                    .font(.reading)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 10)
                    .studentBubble()
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

struct TutorMessage: View {
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

struct ThinkingDots: View {
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

struct Thumb: View {
    let image: PlatformImage?
    var body: some View {
        Group {
            if let image {
                Image(platformImage: image).resizable().scaledToFill()
            } else {
                Rectangle().fill(.quaternary)
            }
        }
        .frame(width: 96, height: 128)
        .clipShape(.rect(cornerRadius: 14))
    }
}

struct RemoteThumb: View {
    let path: String
    @Binding var viewing: PhotoRef?
    @Environment(ChatStore.self) private var store
    @State private var image: PlatformImage?

    var body: some View {
        Button { if let image { viewing = .local(image) } } label: { Thumb(image: image) }
            .task { image = await store.photo(at: path) }
    }
}

enum PhotoRef: Identifiable {
    case local(PlatformImage)
    var id: ObjectIdentifier {
        switch self { case .local(let image): ObjectIdentifier(image) }
    }
}

struct PhotoViewer: View {
    let ref: PhotoRef
    @Environment(\.dismiss) private var dismiss
    @State private var zoom: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if case .local(let image) = ref {
                Image(platformImage: image)
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
