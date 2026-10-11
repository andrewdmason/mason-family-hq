import SwiftUI

/// What the edit sheet is fixing: an at-bat's pitches, and whether its video
/// can be rebuilt to match (the full recording is still on this phone).
struct PitchEditTarget: Identifiable {
    let id: UUID
    let title: String
    /// Nil while they load from Clips.
    var pitches: [Pitch]?
    let rebuild: Bool
    var loadError: String?
}

/// Fix any pitch's label after the fact — outcome, and for a ball in play its
/// kind and result — with the at-bat's result worked out as you go.
struct PitchEditor: View {
    let target: PitchEditTarget
    let onSave: ([Pitch]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pitches: [Pitch] = []
    @State private var loaded = false

    private var sorted: [Pitch] { pitches.sorted { $0.t < $1.t } }
    private var original: [Pitch] { (target.pitches ?? []).sorted { $0.t < $1.t } }

    var body: some View {
        NavigationStack {
            Group {
                if let error = target.loadError {
                    ContentUnavailableView("Couldn't load the pitches", systemImage: "wifi.exclamationmark", description: Text(error))
                } else if target.pitches == nil {
                    ProgressView()
                } else {
                    form
                }
            }
            .navigationTitle(target.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(target.rebuild ? "Save & rebuild" : "Save") {
                        onSave(sorted)
                        dismiss()
                    }
                    .disabled(!loaded || sorted == original)
                }
            }
        }
        .onChange(of: target.pitches, initial: true) { _, new in
            guard !loaded, let new else { return }
            pitches = new
            loaded = true
        }
    }

    private var form: some View {
        let counts = Scorebook.countsBefore(sorted)
        let outcome = Scorebook.outcome(sorted)
        return Form {
            Section {
                LabeledContent("Result", value: outcome?.result.name ?? "Not decided")
            } footer: {
                Text(target.rebuild
                     ? "The video is rebuilt with the new labels — captions, replays and title card — and replaces the one in Clips."
                     : "The full recording is gone (it's kept for three days), so only the labels change. The video keeps its old captions.")
            }
            ForEach(Array(sorted.enumerated()), id: \.element.id) { i, p in
                Section("Pitch \(i + 1) · \(counts[i].description)") {
                    Picker("Pitch", selection: binding(p.id, \.outcome)) {
                        Text("Unlabeled").tag(PitchOutcome?.none)
                        ForEach(PitchOutcome.allCases) { Text($0.label).tag(Optional($0)) }
                    }
                    if p.outcome == .inPlay {
                        Picker("Kind", selection: binding(p.id, \.battedBall)) {
                            Text("—").tag(BattedBall?.none)
                            ForEach(BattedBall.allCases) { Text($0.label).tag(Optional($0)) }
                        }
                        Picker("Result", selection: binding(p.id, \.playResult)) {
                            Text("—").tag(PlayResult?.none)
                            ForEach(PlayResult.allCases) { Text($0.label).tag(Optional($0)) }
                        }
                    }
                }
            }
        }
    }

    /// One label of one pitch. Changing away from in play clears its kind and result.
    private func binding<T>(_ id: UUID, _ key: WritableKeyPath<Pitch, T>) -> Binding<T> {
        Binding(
            get: { pitches.first { $0.id == id }![keyPath: key] },
            set: { value in
                guard let i = pitches.firstIndex(where: { $0.id == id }) else { return }
                pitches[i][keyPath: key] = value
                if pitches[i].outcome != .inPlay {
                    pitches[i].battedBall = nil
                    pitches[i].playResult = nil
                }
            }
        )
    }
}
