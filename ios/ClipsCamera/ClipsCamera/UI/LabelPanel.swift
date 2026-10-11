import SwiftUI

/// A pitch's labels, in the rail just above the Pitch button: outcome, then for
/// a ball in play the kind of hit and the result. Recording carries on, and
/// tapping Pitch again logs the next pitch, leaving this one unlabeled. The
/// commonest choices sit on the bottom row, nearest the thumb.
struct LabelPanel: View {
    let model: RecordModel

    /// Outcomes top to bottom: Ball and Foul nearest the Pitch button.
    private static let outcomes: [PitchOutcome] = [.inPlay, .hitByPitch, .calledStrike, .swingingStrike, .ball, .foul]

    var body: some View {
        if let step = model.labelStep, let pitch = model.labelingPitch {
            VStack(spacing: 6) {
                HStack {
                    Text(title(step, pitch: pitch))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 4)
                    Button("Later") { model.closeLabels() }
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .accessibilityLabel("Label later")
                }
                switch step {
                case .outcome:
                    grid(Self.outcomes, label: \.label) { model.choose($0) }
                case .battedBall:
                    grid(BattedBall.allCases, label: \.label) { model.choose($0) }
                case .playResult:
                    grid(PlayResult.allCases, label: \.label) { model.choose($0) }
                }
            }
            .transition(.opacity)
        }
    }

    private func title(_ step: LabelStep, pitch: Pitch) -> String {
        let n = (model.pitches.firstIndex(of: pitch) ?? 0) + 1
        switch step {
        case .outcome: return "Pitch \(n)"
        case .battedBall: return "Pitch \(n) · what kind?"
        case .playResult: return "\(pitch.battedBall?.label ?? "In play") · result?"
        }
    }

    /// Two to a row, rows sharing the height; an odd last item spans the row.
    private func grid<T: Identifiable>(_ items: [T], label: KeyPath<T, String>, choose: @escaping (T) -> Void) -> some View {
        let rows = stride(from: 0, to: items.count, by: 2).map { Array(items[$0 ..< min($0 + 2, items.count)]) }
        return VStack(spacing: 6) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 6) {
                    ForEach(rows[r]) { item in
                        Button { choose(item) } label: {
                            Text(item[keyPath: label])
                                .font(.subheadline.weight(.bold))
                                .multilineTextAlignment(.center)
                                .lineLimit(2)
                                .minimumScaleFactor(0.75)
                                .padding(.horizontal, 4)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .foregroundStyle(.white)
                                .background(.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }
                .frame(maxHeight: 64)
            }
        }
        .frame(maxHeight: .infinity, alignment: .bottom)
    }
}
