import SwiftUI

/// Share was tapped on a pitch reel: what goes in the video, and its shape.
/// Opens on the last share's choices (fitted to this at-bat), and Share
/// remembers them. A vertical video is framed per camera; the framing is
/// remembered for the at-bat and as the starting point for its game.
struct ShareOptionsSheet: View {
    let availability: ShareAvailability
    let atBatID: UUID
    let gameID: UUID?
    /// The footage to frame from (fetched when the sheet opens).
    let sources: () async -> FramingSources?
    let onShare: (ShareOptions, Framing) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var options: ShareOptions
    @State private var framing: Framing
    @State private var footage: FramingSources?
    /// A content choice was tapped here. If not, the remembered one is kept
    /// even when this at-bat couldn't offer it.
    @State private var pickedContent = false

    init(availability: ShareAvailability, atBatID: UUID, gameID: UUID?,
         sources: @escaping () async -> FramingSources?, onShare: @escaping (ShareOptions, Framing) -> Void) {
        self.availability = availability
        self.atBatID = atBatID
        self.gameID = gameID
        self.sources = sources
        self.onShare = onShare
        _options = State(initialValue: AppSettings.shared.shareOptions.fitted(to: availability))
        _framing = State(initialValue: AppSettings.shared.framing(atBat: atBatID, game: gameID))
    }

    private var defaults: ShareOptions { ShareOptions.standard.fitted(to: availability) }
    private var framesFieldView: Bool { options.showsFieldView && availability.hasFieldView }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(availability.choices) { choice in
                        contentRow(choice)
                    }
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
            .navigationTitle("Share this at-bat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Share") { share() }.fontWeight(.semibold)
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
            AppSettings.shared.saveFraming(used, atBat: atBatID, game: gameID)
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
