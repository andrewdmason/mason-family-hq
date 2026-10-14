import SwiftUI

/// The player's ball-trail panel: the trail on or off and its look, picked
/// live while the hit loops behind. The choice is remembered on this phone
/// (and is the look shares are made with).
struct TrailPanel: View {
    let info: BallTrailInfo
    let canTrace: Bool
    /// Trace a field view that never was.
    let onAddTrail: () -> Void

    @Bindable private var settings = AppSettings.shared

    static let height: CGFloat = 250

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Toggle(isOn: $settings.trailOn) {
                Text("Ball trail").font(.headline)
            }
            HStack(spacing: 10) {
                ForEach(TrailStyle.allCases) { style in
                    StyleChip(style: style, selected: settings.trailStyle == style) {
                        settings.trailStyle = style
                        settings.trailOn = true
                    }
                }
            }
            .opacity(settings.trailOn ? 1 : 0.5)
            status
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 22)
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private var status: some View {
        switch info.status {
        case .ready?:
            EmptyView()
        case .pending?:
            HStack(spacing: 8) {
                ProgressView()
                Text("Finding the ball…").foregroundStyle(.secondary)
            }
            .font(.subheadline)
        case .needsTap?, .failed?:
            Text(info.ready == nil ? "Couldn't follow the ball on its own." : "Couldn't redo the trail — this is the earlier one.")
                .font(.subheadline).foregroundStyle(.secondary)
        case nil:
            if canTrace {
                Button("Add a trail", systemImage: "sparkles", action: onAddTrail)
                    .font(.subheadline.weight(.semibold))
            } else {
                Text("No trail for this hit yet.").font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

/// A look to pick: a little drawing of it and its name.
private struct StyleChip: View {
    let style: TrailStyle
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                swatch
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(Color(white: 0.2), in: RoundedRectangle(cornerRadius: 10))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(selected ? Color.orange : Color.white.opacity(0.15), lineWidth: selected ? 2.5 : 1)
                    }
                Text(style.label)
                    .font(.footnote.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? .primary : .secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(style.label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// An arc from the bottom left, the ball at its top right.
    private var swatch: some View {
        Canvas { ctx, size in
            let start = CGPoint(x: size.width * 0.15, y: size.height * 0.8)
            let ball = CGPoint(x: size.width * 0.78, y: size.height * 0.3)
            var path = Path()
            path.move(to: start)
            path.addQuadCurve(to: ball, control: CGPoint(x: size.width * 0.4, y: size.height * 0.15))
            switch style {
            case .neon:
                var glow = ctx
                glow.addFilter(.blur(radius: 4))
                glow.stroke(path, with: .color(Color(red: 40 / 255, green: 200 / 255, blue: 1)), lineWidth: 6)
                ctx.stroke(path, with: .color(Color(red: 40 / 255, green: 200 / 255, blue: 1)), lineWidth: 4)
                ctx.stroke(path.trimmedPath(from: 0.5, to: 1), with: .color(.white), lineWidth: 1.5)
            case .vapor:
                var soft = ctx
                soft.addFilter(.blur(radius: 2))
                soft.stroke(path, with: .color(.white.opacity(0.75)), style: StrokeStyle(lineWidth: 6, lineCap: .round))
            case .broadcast:
                ctx.stroke(path, with: .color(Color(red: 225 / 255, green: 40 / 255, blue: 40 / 255)), style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                ctx.stroke(path, with: .color(.white.opacity(0.9)), lineWidth: 1)
                ctx.stroke(Path(ellipseIn: CGRect(x: ball.x - 6, y: ball.y - 6, width: 12, height: 12)), with: .color(.white), lineWidth: 1.5)
            }
        }
    }
}
