import SwiftUI

/// The one screen: full-width picture held sideways, status down the left
/// edge, controls down the right.
struct RecordView: View {
    @State private var model = RecordModel()
    @State private var showingLibrary = false
    @State private var showingSettings = false
    @State private var showingGame = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            CameraPreview(capture: model.capture) { model.tap(hostTime: $0) }
                .aspectRatio(16 / 9, contentMode: .fit)
                .ignoresSafeArea()
                .overlay(alignment: .top) { recordingBadge }

            HStack(spacing: 0) {
                StatusBar(model: model) { showingGame = true }
                Spacer(minLength: 0)
                ControlBar(model: model, showingLibrary: $showingLibrary, showingSettings: $showingSettings)
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
        .task { await model.appeared() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.wentToBackground() }
            if phase == .active { Task { await model.appeared() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            model.capture.updatePreviewRotation()
        }
        .sheet(isPresented: $showingLibrary) { LibraryView(store: model.store) }
        .sheet(isPresented: $showingSettings) {
            SettingsView(settings: model.settings, clips: model.clips, formatDescription: model.capture.formatDescription)
        }
        .sheet(isPresented: $showingGame) { GamePickerView(clips: model.clips, settings: model.settings) }
        .onChange(of: model.needsGame) { _, needs in
            if needs { showingGame = true; model.needsGame = false }
        }
        .onChange(of: model.clips.isSignedIn) { _, signedIn in
            if signedIn { model.store.resume() }
        }
        .fullScreenCover(isPresented: .constant(model.clips.checkedSession && !model.clips.isSignedIn)) {
            SignInView(clips: model.clips)
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
    let onPickGame: () -> Void
    @State private var thermal = ProcessInfo.processInfo.thermalState
    @State private var battery: Float = UIDevice.current.batteryLevel

    var body: some View {
        VStack(spacing: 10) {
            GameChip(game: model.settings.game, enabled: model.phase == .ready, action: onPickGame)
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

/// Whose game at-bats are filed under; tap to change it between at-bats.
private struct GameChip: View {
    let game: GameChoice?
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(game?.kid.firstName ?? "Pick").font(.caption.weight(.bold))
                Text(game?.name ?? "game").font(.caption2).lineLimit(2).multilineTextAlignment(.center).opacity(0.75)
            }
            .foregroundStyle(game == nil ? .yellow : .white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 5)
            .background(.white.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))
        }
        .disabled(!enabled)
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
    @Binding var showingLibrary: Bool
    @Binding var showingSettings: Bool

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 14) {
                Button { model.touched(); showingLibrary = true } label: { Image(systemName: "film.stack") }
                Button { model.touched(); showingSettings = true } label: { Image(systemName: "gearshape") }
            }
            .font(.title3)
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
