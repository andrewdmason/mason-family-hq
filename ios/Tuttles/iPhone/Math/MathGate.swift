import SwiftUI

// Math waits for Vocab: the run opens once today's ten minutes of Vocab are
// done, the same ten minutes Vocab's own day counts (time spent answering,
// over every session today, VocabOverview.Goal). It locks again the next day.
// Whoever isn't set up for Vocab isn't held back by it.

/// Whether today's Math run is open yet.
enum MathGate: Equatable {
    /// Still finding out how today's Vocab stands.
    case checking
    case open
    /// Today's Vocab isn't done: `ms` of the day's `goalMs` answered so far.
    case locked(ms: Int, goalMs: Int)

    /// Ten minutes, for a website that doesn't say.
    static let defaultGoalMs = 600_000

    /// How Math stands, from Vocab's first screen for whoever's using the app.
    /// No overview: Vocab isn't set up for them, so there's nothing to wait for.
    static func from(_ overview: VocabOverview?) -> MathGate {
        guard let overview else { return .open }
        guard let day = overview.day else {
            // An older website: a session finished is the day done.
            return overview.isDoneToday ? .open : .locked(ms: 0, goalMs: defaultGoalMs)
        }
        return day.done ? .open : .locked(ms: day.ms, goalMs: day.goalMs)
    }

    var isOpen: Bool { self == .open }
}

extension ChatStore {
    /// Today's Vocab for Math's gate: worked out on the phone from what it
    /// keeps when it can (fresh, and offline), else Vocab's first screen,
    /// fetched if it isn't in yet.
    func mathGate() async -> MathGate {
        if let local = vocabOpenLocal() { return .from(local.home().overview) }
        if vocab == nil { await refreshVocab() }
        if let local = vocabOpenLocal() { return .from(local.home().overview) }
        // Not reached and nothing kept: let them run rather than lock them out for good.
        guard let home = vocab else { return .open }
        return .from(home.overview)
    }
}

/// In place of Run while today's Vocab isn't done: how far along the ten
/// minutes are, and the way to Vocab.
struct MathLockedCard: View {
    let ms: Int
    let goalMs: Int

    private var fraction: Double { min(1, Double(ms) / Double(max(1, goalMs))) }

    /// "4 min" to go, rounded up so it never says 0 with a few seconds left.
    private var left: String {
        let minutes = Int((Double(max(0, goalMs - ms)) / 60_000).rounded(.up))
        return "\(max(1, minutes)) min"
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "lock.fill")
                    .font(.title2.weight(.black))
                    .foregroundStyle(TuttlesLook.accent)
                    .frame(width: 46, height: 46)
                    .background(Color.primary.opacity(0.08), in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Vocab first")
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                    Text("Math opens after \(goalMs / 60_000) minutes of Vocab today. \(left) to go.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            ProgressView(value: fraction)
                .tint(TuttlesLook.accent)
                .accessibilityLabel("Vocab today")
                .accessibilityValue("\(ms / 60_000) of \(goalMs / 60_000) minutes")
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}
