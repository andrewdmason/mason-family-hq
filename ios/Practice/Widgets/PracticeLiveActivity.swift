import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct PracticeWidgets: WidgetBundle {
    var body: some Widget {
        PracticeLiveActivity()
    }
}

/// The running practice timer on the Lock Screen and in the Dynamic Island.
/// The clocks count on their own from the start time and stop at the
/// auto-end, so nothing has to update them while the phone is locked.
struct PracticeLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PracticeActivityAttributes.self) { context in
            LockScreenView(state: context.state, isStale: context.isStale)
                .activityBackgroundTint(nil)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.state.pieceName, systemImage: "music.note")
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RunClock(state: context.state)
                        .font(.title2.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.red)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        TodayClock(state: context.state)
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Spacer()
                        StopButton()
                    }
                }
            } compactLeading: {
                Image(systemName: "music.note").foregroundStyle(.red)
            } compactTrailing: {
                RunClock(state: context.state)
                    .monospacedDigit()
                    .frame(maxWidth: 52)
                    .foregroundStyle(.red)
            } minimal: {
                Image(systemName: "music.note").foregroundStyle(.red)
            }
        }
    }
}

private struct LockScreenView: View {
    let state: PracticeActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(state.pieceName)
                    .font(.headline)
                    .lineLimit(1)
                if isStale {
                    Text("Stopped after an hour untouched")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    TodayClock(state: state)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            RunClock(state: state)
                .font(.system(size: 34, weight: .semibold).monospacedDigit())
                .foregroundStyle(isStale ? Color.secondary : Color.red)
                .multilineTextAlignment(.trailing)
            if !isStale { StopButton() }
        }
        .padding(16)
    }
}

/// This run, counting up from its start and stopping at the auto-end.
private struct RunClock: View {
    let state: PracticeActivityAttributes.ContentState

    var body: some View {
        Text(timerInterval: state.startedAt...max(state.startedAt, state.endsBy), countsDown: false)
    }
}

/// Today's total: the same clock, started earlier by what's already logged.
private struct TodayClock: View {
    let state: PracticeActivityAttributes.ContentState

    var body: some View {
        let from = state.startedAt.addingTimeInterval(-Double(state.todayBeforeSeconds))
        HStack(spacing: 4) {
            Text("Today")
            Text(timerInterval: from...max(from, state.endsBy), countsDown: false)
        }
    }
}

private struct StopButton: View {
    var body: some View {
        Button(intent: StopPracticeIntent()) {
            Image(systemName: "stop.fill")
                .font(.title3)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.circle)
        .tint(.red)
        .accessibilityLabel("Stop")
    }
}
