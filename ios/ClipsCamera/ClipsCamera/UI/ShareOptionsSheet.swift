import SwiftUI

/// Share was tapped on a pitch reel: what goes in the video. Opens on the last
/// share's choices (fitted to this at-bat), and Share remembers them.
struct ShareOptionsSheet: View {
    let availability: ShareAvailability
    let onShare: (ShareOptions) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var options: ShareOptions
    /// A content choice was tapped here. If not, the remembered one is kept
    /// even when this at-bat couldn't offer it.
    @State private var pickedContent = false

    init(availability: ShareAvailability, onShare: @escaping (ShareOptions) -> Void) {
        self.availability = availability
        self.onShare = onShare
        _options = State(initialValue: AppSettings.shared.shareOptions.fitted(to: availability))
    }

    private var defaults: ShareOptions { ShareOptions.standard.fitted(to: availability) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(availability.choices) { choice in
                        contentRow(choice)
                    }
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
                    Button("Share") {
                        var remembered = options
                        if !pickedContent { remembered.content = AppSettings.shared.shareOptions.content }
                        AppSettings.shared.shareOptions = remembered
                        onShare(options)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
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
