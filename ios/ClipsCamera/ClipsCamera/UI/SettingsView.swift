import SwiftUI

/// Edit timings (applied to at-bats built from now on) and test aids.
struct SettingsView: View {
    @Bindable var settings: AppSettings
    let formatDescription: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    stepper("Before each pitch", value: $settings.timings.lead, range: 0.5...5)
                    stepper("After a take or miss", value: $settings.timings.tail, range: 0.5...5)
                    stepper("After contact", value: $settings.timings.contactTail, range: 1...8)
                    stepper("Replay starts before the pitch", value: $settings.timings.replayBefore, range: 0.2...2, step: 0.1)
                    stepper("Replay runs after the pitch", value: $settings.timings.replayAfter, range: 0.2...2, step: 0.1)
                    Picker("Replay speed", selection: $settings.timings.replayRate) {
                        Text("¼ speed").tag(0.25)
                        Text("⅛ speed").tag(0.125)
                    }
                    stepper("Result card", value: $settings.timings.endCard, range: 0...5)
                    Button("Reset to defaults") { settings.timings = .standard }
                } header: {
                    Text("The finished video")
                } footer: {
                    Text("Changes apply to at-bats built from now on.")
                }

                Section {
                    Stepper("Stop \(settings.autoStopSeconds)s after the at-bat ends", value: $settings.autoStopSeconds, in: 1...10)
                }

                Section {
                    Toggle("Also save full recordings to Photos", isOn: $settings.saveRawToPhotos)
                } header: {
                    Text("Testing")
                } footer: {
                    Text("For checking tap timing against the whole at-bat. Full 240fps recordings are large — about half a gigabyte a minute.")
                }

                Section {
                    LabeledContent("Camera", value: formatDescription.isEmpty ? "—" : formatDescription)
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func stepper(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double = 0.5) -> some View {
        Stepper(value: value, in: range, step: step) {
            HStack {
                Text(title)
                Spacer()
                Text(String(format: "%.1fs", value.wrappedValue)).monospacedDigit().foregroundStyle(.secondary)
            }
        }
    }
}
