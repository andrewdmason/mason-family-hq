"""
ByteDance piano-transcription spike: transcribe each real practice recording to
MIDI and render that MIDI back to audio so we can HEAR how well it captured the
playing — especially the hard cases (hands-separate, looping, slow).

Run: ./.venv/bin/python transcribe.py
Outputs out/<name>.mid (the transcription) and out/<name>_heard.wav (a sine
rendering of it, for listening). Prints per-recording stats.
"""
import os
import sys
import numpy as np
import soundfile as sf
import librosa
from piano_transcription_inference import PianoTranscription, sample_rate

REC = "../practice-alignment/recordings"
RECORDINGS = ["chopin_normal", "hands-separate", "loop", "bach", "scale"]
SR = 22050


def render(notes, path):
    if not notes:
        sf.write(path, np.zeros(SR, dtype=np.float32), SR)
        return
    dur = max(n["offset_time"] for n in notes) + 0.5
    audio = np.zeros(int(dur * SR) + SR, dtype=np.float32)
    for n in notes:
        i0, i1 = int(n["onset_time"] * SR), int(n["offset_time"] * SR)
        if i1 <= i0:
            continue
        t = np.arange(i1 - i0) / SR
        freq = 440.0 * 2 ** ((n["midi_note"] - 69) / 12)
        env = np.minimum(1.0, np.exp(-3 * t))
        audio[i0:i1] += 0.12 * np.sin(2 * np.pi * freq * t) * env
    peak = np.max(np.abs(audio)) or 1.0
    sf.write(path, audio / peak * 0.9, SR)


def main():
    transcriptor = PianoTranscription(device="cpu")
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    for rec in RECORDINGS:
        src = f"{REC}/{rec}.m4a"
        if not os.path.exists(src):
            print(f"{rec}: MISSING {src}")
            continue
        audio, _ = librosa.load(src, sr=sample_rate, mono=True)
        out_mid = f"out/{rec}.mid"
        result = transcriptor.transcribe(audio, out_mid)
        notes = result["est_note_events"]
        render(notes, f"out/{rec}_heard.wav")

        if notes:
            pitches = [n["midi_note"] for n in notes]
            prof = [0] * 12
            for p in pitches:
                prof[p % 12] += 1
            top = sorted(range(12), key=lambda i: -prof[i])[:5]
            span = max(n["offset_time"] for n in notes)
            print(f"\n{rec}: {len(notes)} notes | pitch {min(pitches)}-{max(pitches)} | "
                  f"{span:.0f}s | density {len(notes)/max(span,1):.1f} notes/s")
            print("  top pitch classes: " + ", ".join(f"{names[i]}" for i in top))
        else:
            print(f"\n{rec}: NO notes detected")
    print("\ndone -> out/*.mid (transcriptions), out/*_heard.wav (listen to these)")


if __name__ == "__main__":
    main()
