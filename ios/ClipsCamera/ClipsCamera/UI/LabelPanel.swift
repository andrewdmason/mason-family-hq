import SwiftUI

/// The label popover that opens on each pitch: outcome, then for a ball in play
/// the kind of hit and the result. Recording carries on underneath, and a tap
/// on the picture outside it logs the next pitch.
struct LabelPanel: View {
    let model: RecordModel

    var body: some View {
        if let step = model.labelStep, let pitch = model.labelingPitch {
            VStack(spacing: 10) {
                HStack {
                    Text(title(step, pitch: pitch))
                        .font(.headline)
                        .foregroundStyle(.white)
                    Spacer()
                    Button { model.closeLabels() } label: {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .frame(width: 36, height: 36)
                            .foregroundStyle(.white)
                            .background(.white.opacity(0.15), in: Circle())
                    }
                    .accessibilityLabel("Label later")
                }
                switch step {
                case .outcome:
                    grid(PitchOutcome.allCases, label: \.label) { model.choose($0) }
                case .battedBall:
                    grid(BattedBall.allCases, label: \.label) { model.choose($0) }
                case .playResult:
                    grid(PlayResult.allCases, label: \.label) { model.choose($0) }
                }
            }
            .padding(14)
            .frame(width: 470)
            .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 18))
            .transition(.opacity)
        }
    }

    private func title(_ step: LabelStep, pitch: Pitch) -> String {
        let n = (model.pitches.firstIndex(of: pitch) ?? 0) + 1
        switch step {
        case .outcome: return "Pitch \(n)"
        case .battedBall: return "Pitch \(n) · in play — what kind?"
        case .playResult: return "Pitch \(n) · \(pitch.battedBall?.label ?? "in play") — result?"
        }
    }

    private func grid<T: Identifiable>(_ items: [T], label: KeyPath<T, String>, choose: @escaping (T) -> Void) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(items) { item in
                Button { choose(item) } label: {
                    Text(item[keyPath: label])
                        .font(.headline)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 60)
                        .foregroundStyle(.white)
                        .background(.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }
}
