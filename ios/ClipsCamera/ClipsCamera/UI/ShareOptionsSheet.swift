import SwiftUI

/// Share was tapped on a pitch reel (or on several, for a highlight reel):
/// what goes in the video, and its shape. Opens on the last share's choices
/// (fitted to these at-bats), and Share remembers them. A vertical video is
/// framed per camera — one framing for all of them — remembered for each
/// at-bat and as the starting point for its game.
struct ShareOptionsSheet: View {
    let items: [ShareItem]
    /// The footage to frame from — the first at-bat's (fetched when the sheet opens).
    let sources: () async -> FramingSources?
    let onShare: (ShareOptions, Framing) -> Void

    private let availability: ShareAvailability

    @Environment(\.dismiss) private var dismiss
    @State private var options: ShareOptions
    @State private var framing: Framing
    @State private var footage: FramingSources?
    /// A content choice was tapped here. If not, the remembered one is kept
    /// even when this at-bat couldn't offer it.
    @State private var pickedContent = false

    init(items: [ShareItem], sources: @escaping () async -> FramingSources?, onShare: @escaping (ShareOptions, Framing) -> Void) {
        self.items = items
        self.sources = sources
        self.onShare = onShare
        let availability = ShareAvailability(items: items)
        self.availability = availability
        _options = State(initialValue: AppSettings.shared.shareOptions.fitted(to: availability))
        let first = items.first
        _framing = State(initialValue: first.map { AppSettings.shared.framing(atBat: $0.id, game: $0.gameID) } ?? Framing())
    }

    private var defaults: ShareOptions { ShareOptions.standard.fitted(to: availability) }
    private var included: [ShareItem] { items.filter { $0.isIncluded(options) } }

    /// "About 1:40": the at-bats and the card (each dissolve plays over the
    /// start of what follows it, adding nothing).
    private var lengthText: String {
        let timings = AppSettings.shared.timings
        let total = included.map { $0.length(options, timings: timings) }.reduce(0, +)
            + (options.titleCard ? timings.titleCard : 0)
        let seconds = Int(total.rounded())
        return "About \(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }

    /// "4 of 6 at-bats have a ball in play", when some are left out.
    private var leftOutText: String? {
        guard items.count > 1, included.count < items.count else { return nil }
        let what = options.content == .hit ? "a ball in play" : "a GameChanger clip"
        return "\(included.count) of \(items.count) at-bats \(included.count == 1 ? "has" : "have") \(what)"
    }
    private var framesFieldView: Bool { options.showsFieldView && availability.hasFieldView }
    /// The Ball trail switch: when the video has a GameChanger part with a
    /// trail to draw — for several at-bats, any of those included.
    private var offersTrail: Bool {
        options.showsFieldView && included.contains { $0.hasFieldView && $0.hasTrail }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(availability.choices) { choice in
                        contentRow(choice)
                    }
                } footer: {
                    Text([leftOutText, lengthText].compactMap { $0 }.joined(separator: " · "))
                }
                Section {
                    Picker("Shape", selection: $options.vertical) {
                        Text("Landscape").tag(false)
                        Text("Vertical").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .listRowSeparator(.hidden)
                    if options.vertical {
                        if options.showsCloseup {
                            framingRow("Close-up framing", loop: footage?.closeup, center: center(\.closeup))
                        }
                        if framesFieldView {
                            Picker("GameChanger", selection: $options.cropFieldView) {
                                Text("Whole field").tag(false)
                                Text("Crop").tag(true)
                            }
                            if options.cropFieldView {
                                framingRow("GameChanger framing", loop: footage?.fieldView, center: center(\.fieldView))
                            }
                        }
                    }
                } footer: {
                    if options.vertical { Text("For Instagram Reels and Stories.") }
                }
                Section {
                    Toggle("Slow-mo swings", isOn: $options.slowMo)
                        .disabled(options.content == .fieldView)
                    Toggle("Captions", isOn: $options.captions)
                        .disabled(options.content == .fieldView)
                    Toggle("Title card", isOn: $options.titleCard)
                    if offersTrail {
                        Toggle("Ball trail", isOn: $options.ballTrail)
                    }
                }
                if options != defaults {
                    Section {
                        Button("Reset") {
                            options = defaults
                            pickedContent = true
                        }
                    }
                }
            }
            .navigationTitle(items.count == 1 ? "Share this at-bat" : "Share \(items.count) at-bats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Share") { share() }.fontWeight(.semibold).disabled(included.isEmpty)
                }
            }
            .task { footage = await sources() }
        }
    }

    private func share() {
        var remembered = options
        if !pickedContent { remembered.content = AppSettings.shared.shareOptions.content }
        AppSettings.shared.shareOptions = remembered
        if options.vertical {
            // Only the cameras this video frames.
            let used = Framing(closeup: options.showsCloseup ? framing.closeup : nil,
                               fieldView: framesFieldView && options.cropFieldView ? framing.fieldView : nil)
            for item in included { AppSettings.shared.saveFraming(used, atBat: item.id, game: item.gameID) }
        }
        onShare(options, framing)
        dismiss()
    }

    private func center(_ camera: WritableKeyPath<Framing, Double?>) -> Binding<Double> {
        Binding(get: { framing[keyPath: camera] ?? 0.5 }, set: { framing[keyPath: camera] = $0 })
    }

    @ViewBuilder
    private func framingRow(_ title: String, loop: FramingLoop?, center: Binding<Double>) -> some View {
        if let loop {
            NavigationLink {
                FramingScreen(title: title, loop: loop, center: center)
            } label: {
                HStack(spacing: 12) {
                    FramingThumbnail(loop: loop, center: center.wrappedValue)
                    Text(title)
                }
            }
        } else {
            HStack(spacing: 12) {
                FramingThumbnail(loop: nil, center: center.wrappedValue)
                Text(title).foregroundStyle(.secondary)
                Spacer()
                ProgressView()
            }
        }
    }

    private func contentRow(_ choice: ShareContent) -> some View {
        Button {
            options.content = choice
            pickedContent = true
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(choice.label).foregroundStyle(.primary)
                    Text(detail(choice)).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                if options.content == choice {
                    Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(.tint)
                }
            }
            .contentShape(Rectangle())
            .opacity(availability.offers(choice) ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!availability.offers(choice))
    }

    private func detail(_ choice: ShareContent) -> String {
        let gc = availability.hasFieldView
        switch choice {
        case .whole: return gc ? "Every pitch, then GameChanger" : "Every pitch"
        case .hit:
            guard availability.hasHit else { return "No ball in play" }
            return gc ? "The swing that made contact, then GameChanger" : "The swing that made contact"
        case .pitches: return "The close-up, no GameChanger"
        case .fieldView: return "Just the GameChanger clip"
        }
    }
}
