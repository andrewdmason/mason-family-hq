import AVKit
import SwiftUI

/// Recent at-bats and where each one is: building, uploading (with progress),
/// in Clips, or stuck with a retry — plus how long the edit took to build.
struct LibraryView: View {
    let store: AtBatStore
    @Environment(\.dismiss) private var dismiss
    @State private var playing: URL?

    var body: some View {
        NavigationStack {
            List {
                if store.jobs.isEmpty {
                    Text("No at-bats yet.").foregroundStyle(.secondary)
                }
                ForEach(store.jobs) { job in
                    row(job)
                        .swipeActions {
                            Button("Delete", role: .destructive) { store.delete(job.id) }
                        }
                }
            }
            .navigationTitle("At-bats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .fullScreenCover(item: $playing) { url in
                PlayerScreen(url: url)
            }
        }
    }

    @ViewBuilder private func row(_ job: AtBatJob) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title(job)).font(.headline)
                Text(detail(job)).font(.caption).foregroundStyle(.secondary)
                if case .failed(let why) = job.state {
                    Text(why).font(.caption).foregroundStyle(.red)
                } else {
                    UploadStatus(job: job, progress: store.progress[job.id], online: store.online)
                }
            }
            Spacer()
            if case .failed = job.upload, job.state == .done {
                Button("Retry") { store.retry(job.id) }.buttonStyle(.bordered)
            }
            switch job.state {
            case .building:
                ProgressView()
            case .done:
                if let file = job.editFile {
                    Button { playing = store.url(file) } label: { Image(systemName: "play.circle.fill").font(.title) }
                        .buttonStyle(.borderless)
                }
            case .failed:
                Button("Retry") { store.retry(job.id) }.buttonStyle(.bordered)
            }
        }
    }

    private func title(_ job: AtBatJob) -> String {
        let when = job.recordedAt.formatted(date: .omitted, time: .shortened)
        let who = job.game.map { "\($0.kid.firstName) · \($0.name) · " } ?? ""
        return "\(job.result?.name ?? "Unfinished") · \(who)\(when)"
    }

    private func detail(_ job: AtBatJob) -> String {
        var parts = ["\(job.pitches.count) pitches", "\(clock(job.rawDuration)) recorded"]
        if let d = job.editDuration { parts.append("edit \(clock(d))") }
        if let b = job.editBytes { parts.append(ByteCountFormatter.string(fromByteCount: b, countStyle: .file)) }
        if let r = job.renderSeconds { parts.append(String(format: "built in %.0fs", r)) }
        return parts.joined(separator: " · ")
    }
}

/// One line: where the upload stands.
private struct UploadStatus: View {
    let job: AtBatJob
    let progress: Double?
    let online: Bool

    var body: some View {
        switch job.upload {
        case nil:
            Text("Not uploaded (recorded before uploads)").font(.caption).foregroundStyle(.secondary)
        case .waiting?:
            Label(job.state == .building ? "Uploads when built" : online ? "Waiting to upload" : "Waiting for signal",
                  systemImage: online ? "clock" : "antenna.radiowaves.left.and.right.slash")
                .font(.caption).foregroundStyle(.orange)
        case .uploading?:
            HStack(spacing: 6) {
                ProgressView(value: progress ?? 0).frame(width: 120)
                Text("Uploading \(Int((progress ?? 0) * 100))%").font(.caption).foregroundStyle(.blue)
            }
        case .finishing?:
            Label("Adding to Clips…", systemImage: "arrow.up.circle").font(.caption).foregroundStyle(.blue)
        case .uploaded?:
            Label("In Clips", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(.green)
        case .failed(let why)?:
            Label("Upload failed: \(why)", systemImage: "exclamationmark.triangle.fill")
                .font(.caption).foregroundStyle(.red).lineLimit(2)
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

private struct PlayerScreen: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let player {
                VideoPlayer(player: player).ignoresSafeArea()
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.largeTitle).foregroundStyle(.white)
            }
            .padding()
        }
        .onAppear {
            let p = AVPlayer(url: url)
            player = p
            p.play()
        }
        .onDisappear { player?.pause() }
    }
}
