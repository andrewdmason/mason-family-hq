import AVKit
import SwiftUI

/// Recent at-bats: building, saved, or failed — with the numbers that matter
/// for the phase 1 test (how long the edit took to build, how big it is).
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
                }
            }
            Spacer()
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
        let when = job.recordedAt.formatted(date: .abbreviated, time: .shortened)
        return "\(job.result?.name ?? "Unfinished") · \(when)"
    }

    private func detail(_ job: AtBatJob) -> String {
        var parts = ["\(job.pitches.count) pitches", "\(clock(job.rawDuration)) recorded"]
        if let d = job.editDuration { parts.append("edit \(clock(d))") }
        if let b = job.editBytes { parts.append(ByteCountFormatter.string(fromByteCount: b, countStyle: .file)) }
        if let r = job.renderSeconds { parts.append(String(format: "built in %.0fs", r)) }
        return parts.joined(separator: " · ")
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
