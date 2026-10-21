import SwiftUI

/// An open song, laid out like Anytune's marker view: the markers, then the
/// button bar, the tempo and volume bar, the mini waveform and the transport.
struct SongView: View {
    @State private var currentID: UUID
    @State private var library = Library.shared
    @State private var player = Player.shared
    @AppStorage("autoPlay") private var autoPlay = true
    @AppStorage("countIn") private var countInOn = false
    @AppStorage("countInBeats") private var countInBeats = 4
    @Environment(\.dismiss) private var dismiss

    @State private var editMode = EditMode.inactive
    @State private var showMixer = false
    @State private var showDetails = false
    @State private var adding: PendingMarker?
    @State private var editing: Marker?

    init(songID: UUID) {
        _currentID = State(initialValue: songID)
    }

    private var song: Song? { library.song(currentID) }

    var body: some View {
        VStack(spacing: 0) {
            if let song {
                header(song)
                if !player.missing.isEmpty { downloadingNote }
                markerList(song)
                buttonBar
                speedAndVolume(song)
                timeRow
                MiniWaveform(
                    peaks: Waveforms.shared.combined(song, library: library),
                    markers: song.markers, duration: player.duration, position: player.position,
                    onSeek: { player.seek(to: $0) }
                )
                .frame(height: 76)
                transport(song)
            } else {
                ContentUnavailableView("Song not found", systemImage: "music.note")
                Button("Close") { dismiss() }
            }
        }
        .background(Color(white: 0.09))
        .overlay { countdownOverlay }
        .onAppear { if let song { player.load(song, library: library) } }
        .onChange(of: currentID) { _, _ in if let song { player.load(song, library: library) } }
        .onChange(of: song) { old, new in
            guard let new else { return }
            if old?.tracks.map(\.file) != new.tracks.map(\.file) || !player.missing.isEmpty {
                player.load(new, library: library)
            } else {
                player.apply(new)
            }
        }
        .onChange(of: library.downloading) { _, _ in
            if !player.missing.isEmpty, let song { player.load(song, library: library) }
        }
        .sheet(isPresented: $showMixer) { MixerView(songID: currentID) }
        .sheet(isPresented: $showDetails) { SongDetailsView(song: song) }
        .sheet(item: $adding) { pending in
            AddMarkerSheet(time: pending.time) { measure in
                if let measure {
                    library.update(currentID) { $0.markers.append(Marker(time: pending.time, measure: measure)) }
                }
                if pending.resume { player.play(from: pending.time) }
            }
            .presentationDetents([.height(300)])
        }
        .sheet(item: $editing) { marker in
            MarkerEditor(songID: currentID, marker: marker, playhead: player.position)
                .presentationDetents([.medium])
        }
    }

    // MARK: Header

    private func header(_ song: Song) -> some View {
        let list = library.songs
        let index = list.firstIndex { $0.id == song.id }
        return HStack(spacing: 12) {
            Button { player.pause(); dismiss() } label: {
                Image(systemName: "chevron.down").font(.title2.weight(.semibold))
            }
            .accessibilityLabel("Close")
            Button { step(list, index, by: -1) } label: { Image(systemName: "backward.fill") }
                .disabled((index ?? 0) == 0)
                .accessibilityLabel("Previous song")
            VStack(spacing: 2) {
                Text(song.name).font(.headline).lineLimit(1)
                Text([song.artist, "\(Int(song.tempo.rounded())) BPM", "\((index ?? 0) + 1) of \(list.count)"]
                    .compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            Button { step(list, index, by: 1) } label: { Image(systemName: "forward.fill") }
                .disabled((index ?? list.count) >= list.count - 1)
                .accessibilityLabel("Next song")
            Button { showDetails = true } label: {
                Image(systemName: "ellipsis.circle").font(.title2)
            }
            .accessibilityLabel("Song details")
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private func step(_ list: [Song], _ index: Int?, by delta: Int) {
        guard let index, list.indices.contains(index + delta) else { return }
        player.pause()
        currentID = list[index + delta].id
    }

    private var downloadingNote: some View {
        Label(
            library.downloading.isEmpty ? "Some tracks aren't on this phone yet." : "Downloading tracks…",
            systemImage: "icloud.and.arrow.down"
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.bottom, 6)
    }

    // MARK: Markers

    private func markerList(_ song: Song) -> some View {
        let current = song.markers.lastIndex { $0.time <= player.position + 0.01 }
        return List {
            ForEach(Array(song.markers.enumerated()), id: \.element.id) { i, marker in
                MarkerRow(marker: marker, current: i == current) {
                    editing = marker
                }
                .contentShape(Rectangle())
                .onTapGesture { go(to: marker, in: song) }
                .listRowBackground(i == current ? Color.white.opacity(0.08) : Color.clear)
                .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            }
            .onDelete { offsets in
                let ids = offsets.map { song.markers[$0].id }
                library.update(currentID) { $0.markers.removeAll { ids.contains($0.id) } }
            }
        }
        .listStyle(.plain)
        .environment(\.editMode, $editMode)
        .overlay {
            if song.markers.isEmpty {
                ContentUnavailableView {
                    Label("No markers", systemImage: "bookmark")
                } description: {
                    Text(song.tracks.isEmpty
                        ? "Add tracks in the mixer to start."
                        : "Play, then tap the marker button to drop one at that spot with its measure number.")
                }
            }
        }
    }

    /// A marker tapped (or reached with previous/next): jump there, and with
    /// auto-play on, play, after the count-in if that's on.
    private func go(to marker: Marker, in song: Song) {
        guard autoPlay else {
            player.seek(to: marker.time)
            return
        }
        if countInOn {
            player.countIn(to: marker.time, beats: countInBeats, tempo: song.tempo, speed: song.speed)
        } else {
            player.play(from: marker.time)
        }
    }

    // MARK: Button bar

    private var buttonBar: some View {
        HStack(spacing: 14) {
            RoundButton(systemImage: "slider.vertical.3", label: "Mixer") { showMixer = true }
            RoundButton(systemImage: "play.circle", label: "Auto-play", on: autoPlay) { autoPlay.toggle() }
            Menu {
                Picker("Count-in", selection: $countInBeats) {
                    ForEach(1...8, id: \.self) { n in Text(n == 1 ? "1 beat" : "\(n) beats").tag(n) }
                }
            } label: {
                RoundButtonFace(systemImage: "metronome", on: countInOn, badge: "\(countInBeats)")
            } primaryAction: {
                countInOn.toggle()
            }
            .accessibilityLabel("Count-in, \(countInBeats) beats")
            RoundButton(text: editMode.isEditing ? "Done" : "Edit", label: "Edit markers") {
                withAnimation { editMode = editMode.isEditing ? .inactive : .active }
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(Color(white: 0.06))
    }

    // MARK: Tempo and volume

    private func speedAndVolume(_ song: Song) -> some View {
        HStack(spacing: 8) {
            StepperPill(
                minus: { library.update(currentID) { $0.speed = Speed.stepped($0.speed, by: -1) } },
                plus: { library.update(currentID) { $0.speed = Speed.stepped($0.speed, by: 1) } },
                reset: { library.update(currentID) { $0.speed = 1 } }
            ) {
                HStack(spacing: 6) {
                    Text(String(format: "%.2fx", song.speed)).foregroundStyle(Color.anytuneOrange)
                    Text("\(song.currentBPM) BPM").font(.caption.bold()).foregroundStyle(Color.anytuneOrange)
                }
            }
            StepperPill(
                minus: { library.update(currentID) { $0.volume = Volume.stepped($0.volume, by: -1) } },
                plus: { library.update(currentID) { $0.volume = Volume.stepped($0.volume, by: 1) } },
                reset: { library.update(currentID) { $0.volume = 1 } }
            ) {
                HStack(spacing: 4) {
                    Image(systemName: "speaker.wave.2.fill").font(.caption)
                    Text("\(Int((song.volume * 100).rounded()))%")
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }

    private var timeRow: some View {
        HStack {
            Text(formatTime(player.position))
            Spacer()
            Text("-" + formatTime(player.duration - player.position))
        }
        .font(.callout.monospacedDigit())
        .padding(.horizontal, 10)
        .padding(.bottom, 4)
    }

    // MARK: Transport

    private func transport(_ song: Song) -> some View {
        HStack(spacing: 8) {
            TransportButton(systemImage: "bookmark.fill", label: "Add marker") { addMarker() }
                .disabled(player.duration == 0)
            TransportButton(systemImage: "backward.end.fill", label: "Previous marker") {
                let back = player.isPlaying ? 1.0 : 0.05
                if let m = song.markers.last(where: { $0.time < player.position - back }) { go(to: m, in: song) }
                else { player.seek(to: 0) }
            }
            TransportButton(systemImage: "gobackward.5", label: "Back 5 seconds") { player.seek(to: player.position - 5) }
            Button { togglePlay(song) } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .foregroundStyle(Color.anytuneOrange)
                    .background(RoundedRectangle(cornerRadius: 12).stroke(Color.anytuneOrange, lineWidth: 2))
            }
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            .disabled(player.duration == 0)
            TransportButton(systemImage: "goforward.5", label: "Forward 5 seconds") { player.seek(to: player.position + 5) }
            TransportButton(systemImage: "forward.end.fill", label: "Next marker") {
                if let m = song.markers.first(where: { $0.time > player.position + 0.05 }) { go(to: m, in: song) }
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    private func togglePlay(_ song: Song) {
        if player.isPlaying {
            player.pause()
            return
        }
        let from = player.position >= player.duration - 0.05 ? 0 : player.position
        if countInOn {
            player.countIn(to: from, beats: countInBeats, tempo: song.tempo, speed: song.speed)
        } else {
            player.play(from: from)
        }
    }

    /// Stops where you are and asks for the measure number.
    private func addMarker() {
        let resume = player.isPlaying
        player.pause()
        adding = PendingMarker(time: player.position, resume: resume)
    }

    // MARK: Count-in

    @ViewBuilder private var countdownOverlay: some View {
        if let n = player.countdown {
            Text("\(n)")
                .font(.system(size: 220, weight: .heavy).monospacedDigit())
                .foregroundStyle(Color.anytuneOrange)
                .shadow(color: .black, radius: 12)
                .contentTransition(.numericText(countsDown: true))
                .animation(.snappy(duration: 0.12), value: n)
                .allowsHitTesting(false)
        }
    }
}

private struct PendingMarker: Identifiable {
    let id = UUID()
    let time: Double
    let resume: Bool
}

// MARK: Controls

/// A round dark button from the bar under the markers, orange when on.
private struct RoundButtonFace: View {
    var systemImage: String?
    var text: String?
    var on = false
    var badge: String?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let systemImage { Image(systemName: systemImage).font(.title2) }
                if let text { Text(text).font(.headline) }
            }
            .foregroundStyle(on ? Color.anytuneOrange : Color.white)
            .frame(width: text == nil ? 56 : 72, height: 56)
            .background(Capsule().fill(Color(white: 0.2)))
            if let badge {
                Text(badge)
                    .font(.caption2.bold())
                    .foregroundStyle(.black)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(on ? Color.anytuneOrange : Color(white: 0.7)))
                    .offset(x: 2, y: -2)
            }
        }
    }
}

private struct RoundButton: View {
    var systemImage: String?
    var text: String?
    let label: String
    var on = false
    let action: () -> Void

    var body: some View {
        Button(action: action) { RoundButtonFace(systemImage: systemImage, text: text, on: on) }
            .accessibilityLabel(label)
            .accessibilityValue(on ? "On" : "")
    }
}

/// − value + in a dark capsule, as Anytune's speed bar. Tapping the value
/// resets it.
private struct StepperPill<Label: View>: View {
    let minus: () -> Void
    let plus: () -> Void
    let reset: () -> Void
    @ViewBuilder let label: Label

    var body: some View {
        HStack(spacing: 0) {
            Button(action: minus) { Image(systemName: "minus").font(.title3.bold()).frame(width: 40, height: 40) }
            Button(action: reset) {
                label.font(.title3.monospacedDigit().bold()).lineLimit(1).minimumScaleFactor(0.7).frame(maxWidth: .infinity)
            }
                .tint(.white)
            Button(action: plus) { Image(systemName: "plus").font(.title3.bold()).frame(width: 40, height: 40) }
        }
        .foregroundStyle(.white)
        .background(Capsule().fill(Color(white: 0.2)))
    }
}

private struct TransportButton: View {
    let systemImage: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.title3)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color(white: 0.2)))
        }
        .tint(.white)
        .accessibilityLabel(label)
    }
}
