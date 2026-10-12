import AVFoundation
import SwiftUI

// The at-bat player for pitch reels. Nothing is baked into the reel, so speed
// and captions happen here: Play runs at real speed, Slow at ¼ (smooth on
// swings, which keep every 240fps frame), and Replay re-runs the pitch on
// screen in slow motion. The GameChanger field view, a file of its own, is the
// last stretch of the same timeline. Controls stay on screen.

/// An at-bat to play: its reel and pitches (at their reel times), and the
/// field view if it has one.
struct ReelItem: Identifiable {
    let id: UUID
    var title: String
    var reel: URL
    var segments: [ReelSegment]
    var pitches: [Pitch]
    var result: AtBatResult?
    var fieldView: FieldViewPlayback?
}

struct FieldViewPlayback {
    var url: URL
    var start: Double
    var end: Double
}

@MainActor
@Observable
final class ReelPlayerModel {
    static let slow: Float = 0.25

    let reelPlayer = AVPlayer()
    let fieldPlayer: AVPlayer?
    let segments: [ReelSegment]
    private let fieldView: FieldViewPlayback?

    private(set) var pitches: [Pitch]
    private(set) var result: AtBatResult?
    /// Position on the whole timeline: the reel, then the field view.
    private(set) var time: Double = 0
    private(set) var reelLength: Double
    var fieldLength: Double { fieldView.map { max(0, $0.end - $0.start) } ?? 0 }
    var total: Double { reelLength + fieldLength }
    private(set) var onField = false
    /// 0 when paused.
    private(set) var rate: Float = 0
    private(set) var replaying = false

    private var replayEnd: Double?
    private var resumeRate: Float = 0
    private var seekTarget: Double?
    private var seeking = false
    private var tokens: [(AVPlayer, Any)] = []
    private var notes: [NSObjectProtocol] = []

    init(_ item: ReelItem) {
        segments = item.segments
        pitches = item.pitches.sorted { $0.t < $1.t }
        result = item.result
        fieldView = item.fieldView
        reelLength = item.segments.last?.end ?? 0
        let reelItem = AVPlayerItem(url: item.reel)
        reelPlayer.replaceCurrentItem(with: reelItem)
        if let fv = item.fieldView {
            let fieldItem = AVPlayerItem(url: fv.url)
            fieldItem.forwardPlaybackEndTime = CMTime(seconds: fv.end, preferredTimescale: 600)
            let p = AVPlayer(playerItem: fieldItem)
            p.seek(to: CMTime(seconds: fv.start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            fieldPlayer = p
        } else {
            fieldPlayer = nil
        }
        watch()
        Task { [weak self] in
            if let d = try? await reelItem.asset.load(.duration).seconds, d > 0 { self?.reelLength = d }
        }
    }

    func stop() {
        reelPlayer.pause()
        fieldPlayer?.pause()
        for (player, token) in tokens { player.removeTimeObserver(token) }
        tokens = []
        for n in notes { NotificationCenter.default.removeObserver(n) }
        notes = []
    }

    private var active: AVPlayer { onField ? (fieldPlayer ?? reelPlayer) : reelPlayer }

    private func watch() {
        let tick = CMTime(value: 1, timescale: 60)
        let reelToken = reelPlayer.addPeriodicTimeObserver(forInterval: tick, queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.ticked(t.seconds, field: false) }
        }
        tokens.append((reelPlayer, reelToken))
        if let fieldPlayer {
            let fieldToken = fieldPlayer.addPeriodicTimeObserver(forInterval: tick, queue: .main) { [weak self] t in
                MainActor.assumeIsolated { self?.ticked(t.seconds, field: true) }
            }
            tokens.append((fieldPlayer, fieldToken))
        }
        notes.append(NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                            object: reelPlayer.currentItem, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.reelEnded() }
        })
        if let item = fieldPlayer?.currentItem {
            notes.append(NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                                object: item, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.finished() }
            })
        }
    }

    private func ticked(_ local: Double, field: Bool) {
        guard field == onField, !seeking, seekTarget == nil else { return }
        time = field ? reelLength + local - (fieldView?.start ?? 0) : local
        if replaying, let end = replayEnd, time >= end { endReplay() }
    }

    /// The reel ran out: on into the field view while playing, else stop there.
    private func reelEnded() {
        guard !onField else { return }
        if rate > 0, let fieldPlayer, let fv = fieldView {
            onField = true
            time = reelLength
            fieldPlayer.seek(to: CMTime(seconds: fv.start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            fieldPlayer.isMuted = rate != 1
            fieldPlayer.rate = rate
        } else {
            finished()
        }
    }

    private func finished() {
        replaying = false
        replayEnd = nil
        rate = 0
        active.pause()
    }

    // MARK: Transport

    func togglePlay() { rate == 1 && !replaying ? pause() : play(1) }
    func toggleSlow() { rate == Self.slow && !replaying ? pause() : play(Self.slow) }

    func play(_ r: Float) {
        replaying = false
        replayEnd = nil
        if time >= total - 0.05 { seek(to: 0) }
        rate = r
        active.isMuted = r != 1
        active.rate = r
    }

    func pause() {
        replaying = false
        replayEnd = nil
        rate = 0
        reelPlayer.pause()
        fieldPlayer?.pause()
    }

    /// Re-run the pitch on screen at ¼ speed, then carry on as before.
    func replay() {
        guard let i = currentPitch,
              let w = ReelPlan.replayWindow(pitch: i, segments: segments, pitchTimes: pitches.map(\.t)) else { return }
        resumeRate = replaying ? resumeRate : rate
        seek(to: w.lowerBound)
        replaying = true
        replayEnd = w.upperBound
        rate = Self.slow
        reelPlayer.isMuted = true
        reelPlayer.rate = Self.slow
    }

    private func endReplay() {
        replaying = false
        replayEnd = nil
        if resumeRate > 0 {
            rate = resumeRate
            active.isMuted = resumeRate != 1
            active.rate = resumeRate
        } else {
            pause()
        }
    }

    func step(_ frames: Int) {
        if rate != 0 { pause() }
        active.currentItem?.step(byCount: frames)
    }

    /// Previous/Next stops: each pitch's mark, and the field view's start.
    private var marks: [Double] {
        var out = pitches.map(\.t)
        if fieldView != nil { out.append(reelLength) }
        return out
    }

    /// Onto the next mark, or back to the last one behind — the one before
    /// that if you're still right on it (half a second, or just landed).
    func jump(_ dir: Int) {
        let t = time
        if dir > 0 {
            if let mark = marks.first(where: { $0 > t + 0.01 }) { jumpTo(mark) }
            return
        }
        let behind = marks.filter { $0 <= t + 0.01 }
        guard let last = behind.last else { return jumpTo(0) }
        let justLanded = lastJump.map { abs($0 - last) < 0.01 && Date().timeIntervalSince(lastJumpAt) < 1.5 } ?? false
        if t - last > 0.5 && !justLanded {
            jumpTo(last)
        } else {
            jumpTo(behind.dropLast().last ?? 0)
        }
    }

    func jumpTo(pitch i: Int) {
        jumpTo(pitches[i].t)
    }

    private var lastJump: Double?
    private var lastJumpAt = Date.distantPast

    private func jumpTo(_ t: Double) {
        replaying = false
        replayEnd = nil
        lastJump = t
        lastJumpAt = Date()
        seek(to: t)
    }

    /// Seeks land exactly; a new one waits for the one in flight, so dragging
    /// shows the latest spot rather than queuing up every stop on the way.
    func seek(to t: Double) {
        let t = min(max(0, t), max(0, total - 0.01))
        time = t
        seekTarget = t
        if !seeking { nextSeek() }
    }

    private func nextSeek() {
        guard let t = seekTarget else { return }
        seekTarget = nil
        seeking = true
        let field = fieldView != nil && t >= reelLength
        if field != onField {
            active.pause()
            onField = field
            if rate > 0 {
                active.isMuted = rate != 1
                active.rate = rate
            }
        }
        let local = field ? (fieldView?.start ?? 0) + t - reelLength : t
        active.seek(to: CMTime(seconds: local, preferredTimescale: 24_000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor in
                self?.seeking = false
                self?.nextSeek()
            }
        }
    }

    // MARK: What's on screen

    /// The pitch on screen (nil during the field view).
    var currentPitch: Int? {
        guard !onField, !pitches.isEmpty else { return nil }
        return ReelPlan.pitchShowing(at: time, segments: segments, pitchTimes: pitches.map(\.t))
    }

    /// "Pitch 4 · 1-2 · Foul", the result on the last.
    func caption(_ i: Int) -> String {
        let counts = Scorebook.countsBefore(pitches)
        return QuickPlan.caption(pitches[i], n: i + 1, count: counts[i], isLast: i == pitches.count - 1, result: result)
    }

    func relabel(_ i: Int, outcome: PitchOutcome, battedBall: BattedBall?, playResult: PlayResult?) {
        pitches[i].outcome = outcome
        pitches[i].battedBall = outcome == .inPlay ? battedBall : nil
        pitches[i].playResult = outcome == .inPlay ? playResult : nil
        result = Scorebook.outcome(pitches)?.result
    }
}

// MARK: - Screen

struct ReelPlayerScreen: View {
    let item: ReelItem
    /// New labels, all pitches at their reel times.
    let onRelabel: ([Pitch]) -> Void
    /// Render and hand to the share sheet (with replays or not).
    let onShare: (_ replays: Bool, _ pitches: [Pitch]) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var model: ReelPlayerModel
    @State private var relabeling: Int?
    @State private var choosingShare = false
    @State private var sharing = false
    @State private var jogFrom: Double?
    @State private var controlsShown = true

    init(item: ReelItem, onRelabel: @escaping ([Pitch]) -> Void, onShare: @escaping (Bool, [Pitch]) async -> Void) {
        self.item = item
        self.onRelabel = onRelabel
        self.onShare = onShare
        _model = State(initialValue: ReelPlayerModel(item))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            picture.ignoresSafeArea()
            // The caption stays up; the controls come and go with a tap.
            VStack(spacing: 0) {
                if controlsShown { topBar.transition(.opacity) }
                Spacer(minLength: 0)
                captionPill
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.bottom, controlsShown ? 4 : 12)
                if controlsShown {
                    ReelControls(model: model)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 4)
                        .transition(.opacity)
                }
            }
            .background(alignment: .bottom) {
                if controlsShown {
                    LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                        .frame(height: 170)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear { model.play(1) }
        .onDisappear { model.stop() }
        .sheet(item: Binding(get: { relabeling.map(PitchRef.init) }, set: { relabeling = $0?.index })) { ref in
            RelabelSheet(title: "Pitch \(ref.index + 1)", pitch: model.pitches[ref.index]) { outcome, battedBall, playResult in
                model.relabel(ref.index, outcome: outcome, battedBall: battedBall, playResult: playResult)
                onRelabel(model.pitches)
            }
            .presentationDetents([.medium, .large])
        }
        .confirmationDialog("Share this at-bat", isPresented: $choosingShare, titleVisibility: .visible) {
            Button("With slow-mo replays") { share(replays: true) }
            Button("Real speed only") { share(replays: false) }
        }
    }

    private func share(replays: Bool) {
        model.pause()
        sharing = true
        Task {
            await onShare(replays, model.pitches)
            sharing = false
        }
    }

    /// The video as big as the screen allows. Tap it to show or hide the
    /// controls; drag sideways to jog (the full width is two seconds).
    private var picture: some View {
        ZStack {
            PlayerLayerView(player: model.reelPlayer).opacity(model.onField ? 0 : 1)
            if let field = model.fieldPlayer {
                PlayerLayerView(player: field).opacity(model.onField ? 1 : 0)
            }
            GeometryReader { geo in
                Color.clear.contentShape(Rectangle())
                    .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { controlsShown.toggle() } }
                    .gesture(DragGesture(minimumDistance: 8).onChanged { g in
                        if jogFrom == nil {
                            model.pause()
                            jogFrom = model.time
                        }
                        model.seek(to: (jogFrom ?? 0) + g.translation.width / max(1, geo.size.width) * 2)
                    }.onEnded { _ in jogFrom = nil })
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private var captionPill: some View {
        if let i = model.currentPitch {
            Button { model.pause(); relabeling = i } label: {
                HStack(spacing: 6) {
                    Text(model.caption(i) + (model.replaying ? " · Replay" : ""))
                    Image(systemName: "pencil").font(.caption2.weight(.bold)).opacity(0.7)
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(model.replaying ? Color.orange.opacity(0.85) : Color.black.opacity(0.6), in: Capsule())
            }
            .accessibilityLabel("Relabel pitch \(i + 1)")
        }
    }

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.title).foregroundStyle(.white.opacity(0.85))
            }
            .accessibilityLabel("Close")
            Spacer()
            Text(item.title).font(.footnote.weight(.semibold)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
            Spacer()
            if sharing {
                ProgressView().tint(.white).frame(width: 32)
            } else {
                Button { choosingShare = true } label: {
                    Image(systemName: "square.and.arrow.up.circle.fill").font(.title).foregroundStyle(.white.opacity(0.85))
                }
                .accessibilityLabel("Share")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}

private struct PitchRef: Identifiable {
    let index: Int
    var id: Int { index }
}

// MARK: - Controls

/// The scrubber with its pitch markers, then ⏮ ◀︎ Play Slow ↺ ▶︎ ⏭.
struct ReelControls: View {
    let model: ReelPlayerModel

    var body: some View {
        VStack(spacing: 6) {
            ReelScrubber(model: model)
                .frame(height: 30)
            HStack(spacing: 0) {
                button("backward.end.fill", "Previous pitch") { model.jump(-1) }
                HoldButton(systemImage: "backward.frame.fill", label: "Back one frame") { model.step(-1) }
                button(model.rate == 1 && !model.replaying ? "pause.fill" : "play.fill", "Play", big: true) { model.togglePlay() }
                slowButton
                button("gobackward", "Replay in slow motion") { model.replay() }
                    .disabled(model.currentPitch == nil)
                HoldButton(systemImage: "forward.frame.fill", label: "Forward one frame") { model.step(1) }
                button("forward.end.fill", "Next pitch") { model.jump(1) }
            }
            .foregroundStyle(.white)
        }
    }

    private var slowButton: some View {
        let on = model.rate == ReelPlayerModel.slow && !model.replaying
        return Button { model.toggleSlow() } label: {
            HStack(spacing: 3) {
                Image(systemName: on ? "pause.fill" : "tortoise.fill")
                Text("¼×").font(.footnote.weight(.bold)).fixedSize()
            }
            .lineLimit(1)
            .font(.title3)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(on ? "Pause slow motion" : "Play in slow motion")
    }

    private func button(_ symbol: String, _ label: String, big: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(big ? .title : .title3)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }
}

/// One frame on a tap; held, it keeps stepping about twelve frames a second.
struct HoldButton: View {
    let systemImage: String
    let label: String
    let action: () -> Void
    @State private var timer: Timer?
    @State private var pressed = false

    var body: some View {
        Image(systemName: systemImage)
            .font(.title3)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
            .opacity(pressed ? 0.5 : 1)
            .gesture(DragGesture(minimumDistance: 0).onChanged { _ in
                guard !pressed else { return }
                pressed = true
                action()
                timer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: false) { _ in
                    MainActor.assumeIsolated {
                        guard pressed else { return }
                        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 12, repeats: true) { _ in
                            MainActor.assumeIsolated { action() }
                        }
                    }
                }
            }.onEnded { _ in
                pressed = false
                timer?.invalidate()
                timer = nil
            })
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { action() }
    }
}

/// The timeline: a marker per pitch (swings orange, takes white, unlabeled
/// hollow; a ring on the last), the field view's stretch in blue. Tap a
/// marker to go to that pitch, or drag to scrub.
struct ReelScrubber: View {
    let model: ReelPlayerModel
    @State private var scrubbing = false
    @State private var resumeRate: Float = 0

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let total = max(model.total, 0.01)
            let x = { (t: Double) in CGFloat(t / total) * w }
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.25)).frame(height: 4)
                if model.fieldLength > 0 {
                    Capsule().fill(Color.blue.opacity(0.55))
                        .frame(width: max(0, w - x(model.reelLength)), height: 4)
                        .offset(x: x(model.reelLength))
                }
                Capsule().fill(.white.opacity(0.85)).frame(width: max(0, x(model.time)), height: 4)
                ForEach(Array(model.pitches.enumerated()), id: \.element.id) { i, p in
                    marker(p, last: i == model.pitches.count - 1)
                        .position(x: x(p.t), y: geo.size.height / 2)
                }
                Circle().fill(.white).frame(width: 14, height: 14)
                    .shadow(radius: 2)
                    .position(x: x(model.time), y: geo.size.height / 2)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                if !scrubbing && abs(g.translation.width) > 4 {
                    scrubbing = true
                    resumeRate = model.rate
                    model.pause()
                }
                if scrubbing { model.seek(to: Double(g.location.x / w) * total) }
            }.onEnded { g in
                if scrubbing {
                    scrubbing = false
                    if resumeRate > 0 { model.play(resumeRate) }
                    return
                }
                // A tap: the nearest marker if it's close, else that spot.
                let nearest = model.pitches.indices.min { abs(x(model.pitches[$0].t) - g.location.x) < abs(x(model.pitches[$1].t) - g.location.x) }
                if let i = nearest, abs(x(model.pitches[i].t) - g.location.x) < 18 {
                    model.jumpTo(pitch: i)
                } else {
                    model.seek(to: Double(g.location.x / w) * total)
                }
            })
        }
        .accessibilityElement()
        .accessibilityLabel("Timeline")
        .accessibilityValue(String(format: "%.1f of %.1f seconds", model.time, model.total))
    }

    @ViewBuilder private func marker(_ p: Pitch, last: Bool) -> some View {
        let swing = p.outcome?.isSwing ?? false
        ZStack {
            if p.outcome == nil {
                Circle().strokeBorder(.white.opacity(0.8), lineWidth: 2).frame(width: 10, height: 10)
            } else {
                Circle().fill(swing ? Color.orange : Color.white).frame(width: 10, height: 10)
            }
            if last {
                Circle().strokeBorder(swing ? Color.orange : Color.white, lineWidth: 1.5).frame(width: 18, height: 18)
            }
        }
    }
}

// MARK: - Relabeling

/// A pitch's labels: outcome, then for a ball in play its kind and result.
struct RelabelSheet: View {
    let title: String
    let pitch: Pitch
    let onDone: (PitchOutcome, BattedBall?, PlayResult?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var outcome: PitchOutcome?
    @State private var battedBall: BattedBall?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if outcome != .inPlay {
                        grid(PitchOutcome.allCases, label: \.label, selected: pitch.outcome) { o in
                            if o == .inPlay {
                                outcome = o
                            } else {
                                onDone(o, nil, nil)
                                dismiss()
                            }
                        }
                    } else if battedBall == nil {
                        Text("What kind?").font(.headline)
                        grid(BattedBall.allCases, label: \.label, selected: pitch.battedBall) { battedBall = $0 }
                    } else {
                        Text("\(battedBall?.label ?? "In play") · result?").font(.headline)
                        grid(PlayResult.allCases, label: \.label, selected: pitch.playResult) { r in
                            onDone(.inPlay, battedBall, r)
                            dismiss()
                        }
                    }
                }
                .padding()
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if outcome == .inPlay {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Back") { if battedBall != nil { battedBall = nil } else { outcome = nil } }
                    }
                }
            }
        }
    }

    private func grid<T: Identifiable & Equatable>(_ items: [T], label: KeyPath<T, String>, selected: T?, choose: @escaping (T) -> Void) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(items) { item in
                Button { choose(item) } label: {
                    Text(item[keyPath: label])
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .foregroundStyle(.white)
                        .background(item == selected ? Color.orange.opacity(0.6) : Color.white.opacity(0.15),
                                    in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }
}
