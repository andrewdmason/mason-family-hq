import SwiftUI

/// Anytune's blue note-flag icon, with the measure number on it (up to three
/// digits).
struct MeasureBadge: View {
    let measure: Int

    var body: some View {
        Text("\(measure)")
            .font(.system(size: 22, weight: .bold).monospacedDigit())
            .minimumScaleFactor(0.6)
            .lineLimit(1)
            .foregroundStyle(.white)
            .padding(.horizontal, 3)
            .padding(.bottom, 8)
            .frame(width: 54, height: 56)
            .background(FlagShape().fill(Color.badgeBlue))
    }
}

/// A rectangle with a notch cut up into its bottom edge, like a bookmark.
private struct FlagShape: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.midX, y: r.maxY - 10))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}

struct MarkerRow: View {
    let marker: Marker
    let current: Bool
    let onInfo: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            MeasureBadge(measure: marker.measure)
            VStack(alignment: .leading, spacing: 2) {
                Text("Measure \(marker.measure)")
                    .font(.title3.weight(current ? .bold : .regular))
                Text(formatTime(marker.time))
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(action: onInfo) {
                Image(systemName: "info.circle").font(.title2)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Edit marker")
        }
    }
}

/// The measure number for a marker just dropped. Cancel drops nothing.
struct AddMarkerSheet: View {
    let time: Double
    /// The measure, or nil if cancelled.
    let onDone: (Int?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Marker at \(formatTime(time))").foregroundStyle(.secondary)
                TextField("Measure", text: $text)
                    .keyboardType(.numberPad)
                    .font(.system(size: 44, weight: .bold).monospacedDigit())
                    .multilineTextAlignment(.center)
                    .focused($focused)
                    .onSubmit(save)
                Spacer()
            }
            .padding()
            .navigationTitle("Measure")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { finish(nil) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: save).disabled(measure == nil)
                }
            }
            .onAppear { focused = true }
        }
        .interactiveDismissDisabled()
    }

    private var measure: Int? { Int(text).flatMap { $0 >= 0 && $0 < 10_000 ? $0 : nil } }

    private func save() {
        guard let measure else { return }
        finish(measure)
    }

    private func finish(_ measure: Int?) {
        dismiss()
        onDone(measure)
    }
}

/// A marker's measure number and exact spot.
struct MarkerEditor: View {
    let songID: UUID
    let marker: Marker
    let playhead: Double

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var time: Double = 0

    var body: some View {
        NavigationStack {
            Form {
                Section("Measure") {
                    TextField("Measure", text: $text)
                        .keyboardType(.numberPad)
                        .font(.title2.bold().monospacedDigit())
                }
                Section {
                    HStack {
                        Button { time = max(0, time - 0.1) } label: { Image(systemName: "minus") }
                            .buttonStyle(.bordered)
                        Spacer()
                        Text(formatTime(time)).font(.title3.monospacedDigit())
                        Spacer()
                        Button { time += 0.1 } label: { Image(systemName: "plus") }
                            .buttonStyle(.bordered)
                    }
                    Button("Move to Playhead (\(formatTime(playhead)))") { time = playhead }
                } header: {
                    Text("Position")
                } footer: {
                    Text("− and + nudge it a tenth of a second.")
                }
                Section {
                    Button("Delete Marker", role: .destructive) {
                        Library.shared.update(songID) { $0.markers.removeAll { $0.id == marker.id } }
                        dismiss()
                    }
                }
            }
            .navigationTitle("Marker")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let measure = Int(text) else { return }
                        Library.shared.update(songID) { song in
                            guard let i = song.markers.firstIndex(where: { $0.id == marker.id }) else { return }
                            song.markers[i].measure = measure
                            song.markers[i].time = time
                        }
                        dismiss()
                    }
                    .disabled(Int(text) == nil)
                }
            }
            .onAppear {
                text = "\(marker.measure)"
                time = marker.time
            }
        }
    }
}
