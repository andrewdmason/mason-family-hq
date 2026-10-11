import SwiftUI

/// The camera: full-width picture held sideways, status down the left edge,
/// controls down the right. Opened from the home screen, which it returns to.
struct CameraView: View {
    let model: RecordModel
    let onClose: () -> Void
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            CameraPreview(capture: model.capture) { model.tap(hostTime: $0) }
                .aspectRatio(16 / 9, contentMode: .fit)
                .ignoresSafeArea()
                .overlay(alignment: .top) { recordingBadge }

            HStack(spacing: 0) {
                StatusBar(model: model)
                Spacer(minLength: 0)
                ControlBar(model: model, onClose: onClose)
            }

            if model.labelStep != nil {
                LabelPanel(model: model)
            }

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

            if let error = model.capture.setupError {
                MessageBanner(text: error, onDismiss: nil)
            }
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .onAppear { Orientation.lock(.landscape) }
        .task { await model.cameraOpened() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.wentToBackground() }
            if phase == .active { Task { await model.cameraOpened() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            model.capture.updatePreviewRotation()
        }
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

// MARK: - Left edge: count, pitches, phone health

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

// MARK: - Right edge: record, undo, zoom, menus

private struct ControlBar: View {
    let model: RecordModel
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.headline)
                    .frame(width: 40, height: 40)
                    .background(.white.opacity(0.18), in: Circle())
            }
            .accessibilityLabel("Close camera")
            .foregroundStyle(.white)
            .disabled(model.phase != .ready)
            .opacity(model.phase == .ready ? 1 : 0.3)

            Spacer(minLength: 0)

            RecordButton(phase: model.phase) {
                model.phase == .recording ? model.stop() : model.record()
            }

            Button { model.undoLastPitch() } label: {
                VStack(spacing: 2) {
                    Image(systemName: "arrow.uturn.backward")
                    Text("Undo").font(.caption2.weight(.semibold))
                }
                .frame(width: 64, height: 50)
                .background(.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
            }
            .foregroundStyle(.white)
            .disabled(model.pitches.isEmpty)
            .opacity(model.pitches.isEmpty ? 0.3 : 1)

            Spacer(minLength: 0)

            ZoomPicker(capture: model.capture)
        }
        .frame(width: 84)
        .padding(.vertical, 10)
    }
}

private struct RecordButton: View {
    let phase: RecordModel.Phase
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().stroke(.white, lineWidth: 4).frame(width: 70, height: 70)
                if phase == .recording {
                    RoundedRectangle(cornerRadius: 6).fill(.red).frame(width: 28, height: 28)
                } else if phase == .stopping {
                    ProgressView().tint(.white)
                } else {
                    Circle().fill(.red).frame(width: 56, height: 56)
                }
            }
        }
        .disabled(phase == .stopping)
        .accessibilityLabel(phase == .recording ? "Stop" : "Record")
    }
}

private struct ZoomPicker: View {
    let capture: CaptureController

    var body: some View {
        VStack(spacing: 6) {
            ForEach(capture.zoomStops) { stop in
                Button { capture.setZoom(stop) } label: {
                    Text(stop.label)
                        .font(.caption.weight(.bold))
                        .frame(width: 44, height: 30)
                        .foregroundStyle(capture.zoom == stop ? .yellow : .white)
                        .background(.black.opacity(0.55), in: Capsule())
                }
            }
        }
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
