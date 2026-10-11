import SwiftUI

/// The camera, held sideways: a rail with everything you touch while filming
/// on one side (the left unless swapped), and the picture on the other with
/// the status over its outer edge.
/// Touching the picture does nothing during an at-bat — pitches are logged only
/// with the rail's Pitch button. Opened from the home screen, which it returns to.
struct CameraView: View {
    let model: RecordModel
    let onClose: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    /// Which side the Dynamic Island is on; the rail keeps clear of it.
    @State private var islandOnRight = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            HStack(spacing: 0) {
                if !railOnRight { rail }
                ZStack {
                    CameraPreview(capture: model.capture) { model.touched() }
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .overlay(alignment: .top) { recordingBadge }

                    if let left = model.countdown {
                        CountdownBanner(seconds: left, result: model.outcome?.result) { model.keepRecording() }
                            .frame(maxHeight: .infinity, alignment: .top)
                            .padding(.top, 48)
                    }

                    if let message = model.message {
                        MessageBanner(text: message) { model.message = nil }
                            .frame(maxHeight: .infinity, alignment: .bottom)
                            .padding(.bottom, 16)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                if railOnRight { rail }
            }
            .ignoresSafeArea()

            HStack {
                if railOnRight { StatusBar(model: model) }
                Spacer(minLength: 0)
                if !railOnRight { StatusBar(model: model) }
            }

            if let error = model.capture.setupError {
                MessageBanner(text: error, onDismiss: nil)
            }
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .defersSystemGestures(on: .all)
        .onAppear {
            Orientation.lock(.landscape)
            // Interface "landscape left" has the top of the phone on the right.
            let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
            islandOnRight = scene?.effectiveGeometry.interfaceOrientation == .landscapeLeft
        }
        .task { await model.cameraOpened() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.wentToBackground() }
            if phase == .active { Task { await model.cameraOpened() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            model.capture.updatePreviewRotation()
            // Device "landscape right" is turned clockwise: the top is on the right.
            switch UIDevice.current.orientation {
            case .landscapeRight: islandOnRight = true
            case .landscapeLeft: islandOnRight = false
            default: break
            }
        }
    }

    private var railOnRight: Bool { model.settings.railOnRight }

    /// Clear of the Dynamic Island on the screen edge, 10pt from the picture.
    private var rail: some View {
        let islandSide = railOnRight == islandOnRight
        return Rail(model: model, onClose: onClose)
            .padding(railOnRight ? .leading : .trailing, 10)
            .padding(railOnRight ? .trailing : .leading, islandSide ? 52 : 20)
            .padding(.top, 14)
            .padding(.bottom, 24)
    }

    @ViewBuilder private var recordingBadge: some View {
        if model.phase == .recording {
            HStack(spacing: 6) {
                Circle().fill(.red).frame(width: 10, height: 10)
                Text(clock(model.elapsed)).monospacedDigit()
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(.black.opacity(0.5), in: Capsule())
            .padding(.top, 8)
            .allowsHitTesting(false)
        } else if !model.capture.isRunning && model.capture.setupError == nil {
            Text("Camera asleep — tap to wake")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(.black.opacity(0.6), in: Capsule())
                .padding(.top, 8)
                .allowsHitTesting(false)
        }
    }
}

func clock(_ seconds: Double) -> String {
    let s = Int(seconds)
    return String(format: "%d:%02d", s / 60, s % 60)
}

// MARK: - Status column: count, pitches, phone health

private struct StatusBar: View {
    let model: RecordModel
    @State private var thermal = ProcessInfo.processInfo.thermalState
    @State private var battery: Float = UIDevice.current.batteryLevel

    var body: some View {
        VStack(spacing: 10) {
            GameLabel(game: model.settings.game, number: model.settings.game.map { model.store.nextNumber(for: $0) })
            CountView(count: model.count, result: model.outcome?.result)
            PitchStrip(model: model)
            Spacer(minLength: 0)
            HealthView(thermal: thermal, battery: battery)
        }
        .frame(width: 84)
        .padding(.vertical, 10)
        .onAppear { UIDevice.current.isBatteryMonitoringEnabled = true; battery = UIDevice.current.batteryLevel }
        .onReceive(NotificationCenter.default.publisher(for: ProcessInfo.thermalStateDidChangeNotification)) { _ in
            thermal = ProcessInfo.processInfo.thermalState
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryLevelDidChangeNotification)) { _ in
            battery = UIDevice.current.batteryLevel
        }
    }
}

/// Where this at-bat is filed — chosen on the home screen before filming.
private struct GameLabel: View {
    let game: GameChoice?
    let number: Int?

    var body: some View {
        VStack(spacing: 1) {
            Text(game?.kid.firstName ?? "No game").font(.caption.weight(.bold))
            if let game {
                Text(game.name).font(.caption2).lineLimit(2).multilineTextAlignment(.center).opacity(0.75)
            }
            if let number { Text("AB \(number)").font(.caption2.weight(.semibold)).opacity(0.75) }
        }
        .foregroundStyle(game == nil ? .yellow : .white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct CountView: View {
    let count: Count
    let result: AtBatResult?

    var body: some View {
        VStack(spacing: 2) {
            if let result {
                Text(result.label).font(.title2.weight(.heavy))
            } else {
                Text(count.description).font(.title2.weight(.heavy)).monospacedDigit()
            }
            Text(result == nil ? "count" : "result").font(.caption2).opacity(0.7)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
    }
}

/// Every pitch so far; tap one to (re)label it. Unlabeled ones are hollow.
private struct PitchStrip: View {
    let model: RecordModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 6) {
                    ForEach(Array(model.pitches.enumerated()), id: \.element.id) { i, p in
                        Button { model.openLabels(p.id) } label: {
                            HStack(spacing: 4) {
                                Text("\(i + 1)").font(.caption2).opacity(0.6)
                                Text(p.outcome?.short ?? "?").font(.subheadline.weight(.bold))
                            }
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .foregroundStyle(p.outcome == nil ? .yellow : .white)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(p.outcome == nil ? Color.clear : Color.white.opacity(0.18))
                                    .stroke(p.outcome == nil ? Color.yellow : (model.labeling == p.id ? Color.white : Color.clear), lineWidth: 1.5)
                            )
                        }
                        .id(p.id)
                    }
                }
            }
            .onChange(of: model.pitches.count) {
                if let last = model.pitches.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
    }
}

private struct HealthView: View {
    let thermal: ProcessInfo.ThermalState
    let battery: Float

    var body: some View {
        VStack(spacing: 4) {
            Label(thermalText, systemImage: "thermometer.medium")
                .foregroundStyle(thermalColor)
            if battery >= 0 {
                Label("\(Int(battery * 100))%", systemImage: "battery.75percent")
                    .foregroundStyle(battery < 0.2 ? .red : .white)
            }
        }
        .labelStyle(.titleAndIcon)
        .font(.caption2.weight(.semibold))
        .padding(6)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
    }

    private var thermalText: String {
        switch thermal {
        case .nominal: "Cool"
        case .fair: "Warm"
        case .serious: "Hot"
        case .critical: "Too hot"
        @unknown default: "?"
        }
    }

    private var thermalColor: Color {
        switch thermal {
        case .serious: .orange
        case .critical: .red
        default: .white
        }
    }
}

// MARK: - Rail: the controls, the labels, and the big button

/// Close and zoom (or Stop and Undo while filming) along the top; the big
/// button at the bottom, under the thumb — Record, then Pitch once filming;
/// in between, the side-swap button before an at-bat and a pitch's labels
/// during one, just above the big button.
private struct Rail: View {
    let model: RecordModel
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                if model.phase == .ready {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .frame(width: 44, height: 44)
                            .background(.white.opacity(0.18), in: Circle())
                    }
                    .accessibilityLabel("Close camera")
                    .foregroundStyle(.white)
                    Spacer(minLength: 0)
                    LensPicker(capture: model.capture, enabled: true)
                } else {
                    StopButton(stopping: model.phase == .stopping) { model.stop() }
                    Spacer(minLength: 0)
                    Button { model.undoLastPitch() } label: {
                        Label("Undo", systemImage: "arrow.uturn.backward")
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 12)
                            .frame(height: 44)
                            .background(.white.opacity(0.18), in: Capsule())
                    }
                    .foregroundStyle(.white)
                    .disabled(model.pitches.isEmpty)
                    .opacity(model.pitches.isEmpty ? 0.3 : 1)
                }
            }

            Group {
                if model.phase == .ready {
                    Button {
                        withAnimation(.easeInOut(duration: 0.25)) { model.settings.railOnRight.toggle() }
                    } label: {
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.headline)
                            .frame(width: 44, height: 44)
                            .background(.white.opacity(0.18), in: Circle())
                    }
                    .foregroundStyle(.white)
                    .accessibilityLabel("Move controls to the other side")
                    .frame(maxHeight: .infinity, alignment: .bottom)
                } else if model.labelStep != nil {
                    LabelPanel(model: model)
                } else if model.phase == .recording && model.pitches.isEmpty {
                    Text("Tap Pitch as the ball reaches the plate")
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.6))
                        .frame(maxHeight: .infinity, alignment: .bottom)
                } else {
                    Color.clear
                }
            }
            .frame(maxHeight: .infinity)

            BigButton(model: model)
        }
        .frame(width: 144)
    }
}

private struct StopButton: View {
    let stopping: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().stroke(.white, lineWidth: 3).frame(width: 44, height: 44)
                if stopping {
                    ProgressView().tint(.white)
                } else {
                    RoundedRectangle(cornerRadius: 4).fill(.red).frame(width: 18, height: 18)
                }
            }
        }
        .disabled(stopping)
        .accessibilityLabel("Stop")
    }
}

/// One fixed spot for the thumb: Record before the at-bat, Pitch during it.
/// The pitch is the instant the finger lands, so it's a touch-down area rather
/// than a button (buttons fire when the finger lifts).
private struct BigButton: View {
    let model: RecordModel
    @State private var flash = false

    var body: some View {
        switch model.phase {
        case .ready:
            Button { model.record() } label: {
                HStack(spacing: 8) {
                    Circle().fill(.white).frame(width: 14, height: 14)
                    Text("Record").font(.title3.weight(.heavy))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 84)
                .background(.red, in: RoundedRectangle(cornerRadius: 20))
            }
            .accessibilityLabel("Record")
        case .recording:
            Text("PITCH")
                .font(.title2.weight(.heavy))
                .tracking(2)
                .foregroundStyle(flash ? .black : .white)
                .frame(maxWidth: .infinity)
                .frame(height: 84)
                .background(flash ? Color.yellow : Color.white.opacity(0.22), in: RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(.yellow, lineWidth: 3))
                .overlay {
                    TouchDownArea(accessibilityLabel: "Pitch") { time in
                        model.pitch(hostTime: time)
                        flash = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                            withAnimation(.easeOut(duration: 0.25)) { flash = false }
                        }
                    }
                }
        case .stopping:
            ProgressView()
                .tint(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 84)
                .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 20))
        }
    }
}

/// The current zoom; tap for the others. Only shown between at-bats: a lens
/// swap mid-recording would drop frames.
private struct LensPicker: View {
    let capture: CaptureController
    let enabled: Bool

    var body: some View {
        Menu {
            ForEach(capture.lenses) { lens in
                Button { capture.setLens(lens) } label: {
                    if capture.lens == lens {
                        Label(lens.label, systemImage: "checkmark")
                    } else {
                        Text(lens.label)
                    }
                }
            }
        } label: {
            Text(capture.lens?.label ?? "1×")
                .font(.subheadline.weight(.bold))
                .frame(width: 56, height: 44)
                .foregroundStyle(.yellow)
                .background(.white.opacity(0.18), in: Capsule())
        }
        .disabled(!enabled || capture.lenses.count < 2)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel("Zoom")
    }
}

// MARK: - Banners

private struct CountdownBanner: View {
    let seconds: Int
    let result: AtBatResult?
    let onKeep: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Text("\(result?.name ?? "At-bat over") · stopping in \(seconds)…")
                .font(.headline)
                .foregroundStyle(.white)
            Button("Keep recording", action: onKeep)
                .font(.headline)
                .buttonStyle(.borderedProminent)
                .tint(.white)
                .foregroundStyle(.black)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.black.opacity(0.75), in: Capsule())
    }
}

private struct MessageBanner: View {
    let text: String
    let onDismiss: (() -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            Text(text).font(.subheadline).foregroundStyle(.white)
            if let onDismiss {
                Button(action: onDismiss) { Image(systemName: "xmark").foregroundStyle(.white) }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.red.opacity(0.85), in: Capsule())
        .padding(.horizontal, 100)
    }
}
