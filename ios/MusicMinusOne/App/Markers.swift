import SwiftUI

/// Anytune's blue note-flag icon, with the measure number (up to three
/// digits) or letter on it; a dash until it has one.
struct MeasureBadge: View {
    let label: String

    var body: some View {
        Text(label.isEmpty ? "–" : label)
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

    var body: some View {
        HStack(spacing: 14) {
            MeasureBadge(label: marker.label)
            VStack(alignment: .leading, spacing: 2) {
                Text(marker.title)
                    .font(.title3.weight(current ? .bold : .regular))
                    .foregroundStyle(marker.label.isEmpty ? .secondary : .primary)
                Text(String(format: "%d:%02d", Int(marker.time) / 60, Int(marker.time) % 60))
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

/// A marker's label field: the number pad, with a switch to letters for
/// rehearsal marks.
struct LabelField: View {
    @Binding var text: String
    var big = false
    @State private var letters = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack {
            TextField(letters ? "Letter" : "Measure", text: $text)
                .keyboardType(letters ? .asciiCapable : .numberPad)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(big ? .system(size: 44, weight: .bold).monospacedDigit() : .title2.bold().monospacedDigit())
                .multilineTextAlignment(big ? .center : .leading)
                .focused($focused)
                .onChange(of: text) { _, new in
                    let cleaned = String(new.trimmingCharacters(in: .whitespaces).prefix(6))
                    if cleaned != new { text = cleaned }
                }
            Button(letters ? "123" : "ABC") {
                letters.toggle()
                // The keyboard only changes when the field is focused afresh.
                focused = false
                DispatchQueue.main.async { focused = true }
            }
            .buttonStyle(.bordered)
            .accessibilityLabel(letters ? "Numbers" : "Letters")
        }
        .onAppear {
            letters = !text.isEmpty && !text.allSatisfy(\.isNumber)
            focused = big
        }
    }
}

/// The label for a marker just dropped. Cancel drops nothing.
struct AddMarkerSheet: View {
    let time: Double
    /// The label, or nil if cancelled.
    let onDone: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Marker at \(formatTime(time))").foregroundStyle(.secondary)
                LabelField(text: $text, big: true)
                Spacer()
            }
            .padding()
            .navigationTitle("Marker")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { finish(nil) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { finish(text) }.disabled(text.isEmpty)
                }
            }
        }
        .interactiveDismissDisabled()
    }

    private func finish(_ label: String?) {
        dismiss()
        onDone(label)
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
                Section("Measure or letter") {
                    LabelField(text: $text)
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
                        Library.shared.update(songID) { song in
                            guard let i = song.markers.firstIndex(where: { $0.id == marker.id }) else { return }
                            song.markers[i].label = text
                            song.markers[i].time = time
                        }
                        dismiss()
                    }
                }
            }
            .onAppear {
                text = marker.label
                time = marker.time
            }
        }
    }
}
