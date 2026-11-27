import SwiftUI

// Math for the parents: the parts of the Parent Dashboard's Math section
// (Shared/ParentDashboard.swift) that need the question bank and the zones,
// which only the iPhone has. The numbers themselves come with the dashboard
// (/tuttles/api/parent/dashboard).

/// A question they got wrong lately: as it was asked, and its answer.
struct MathMissRow: View {
    let miss: DashboardPayload.Math.Miss

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let q = MathBank.question(miss.question) {
                MathText(q.prompt.isEmpty ? "\(q.columnA ?? "")  vs  \(q.columnB ?? "")" : q.prompt, size: 15)
                MathText("Answer: " + q.choices[q.answer], size: 14, weight: .semibold, color: .secondary)
            } else {
                Text(miss.topic.capitalized).font(.subheadline)
            }
            if miss.timedOut { Text("Ran out of time").font(.caption).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 2)
    }
}

extension DashboardPayload.Math.Best {
    /// The furthest zone they've run to, by name.
    var furthest: String { MathZone.all[MathZone.index(forLevel: depth)].name }
}
