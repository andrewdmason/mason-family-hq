"""
Audio-side of the practice-alignment spike (U1) — the go/no-go test.

Takes a real practice recording and aligns it against the reference MIDIs in
references/, reporting:
  - which piece it matched (lowest subsequence-DTW cost),
  - the confidence margin (best vs second-best cost),
  - the measure range the recording maps to.

Needs librosa + a recording. Install: ./.venv/bin/pip install -r requirements.txt
Run:    ./.venv/bin/python align.py path/to/recording.(m4a|wav|webm) [--hand both|left|right]

NOTE: not yet validated end-to-end — waiting on real recordings. The reference
half (midi_reference.py) is validated; this wires it to audio chroma + DTW.
"""
import sys
import glob
import numpy as np
import librosa

from midi_reference import load_reference, FRAME_SEC

HOP = int(22050 * FRAME_SEC)  # match the MIDI grid


def midi_chroma(ref):
    """Reference chroma as an (12, n_frames) L2-normalized matrix."""
    m = np.array(ref["chroma"], dtype=float).T  # -> (12, frames)
    norm = np.linalg.norm(m, axis=0, keepdims=True)
    norm[norm == 0] = 1
    return m / norm


def audio_chroma(path):
    y, sr = librosa.load(path, sr=22050, mono=True)
    c = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    norm = np.linalg.norm(c, axis=0, keepdims=True)
    norm[norm == 0] = 1
    return c / norm, len(y) / sr


def best_alignment(audio_c, ref_c):
    """Subsequence DTW: match the audio query against a subsequence of the reference.

    C must be (query, database) = (audio_frames, ref_frames) so the FULL audio aligns
    to a contiguous span of the reference. Returns (normalized cost, warping path).
    """
    # cost matrix via 1 - cosine similarity (both are L2-normalized)
    cost = 1.0 - (audio_c.T @ ref_c)          # (audio_frames, ref_frames)
    D, wp = librosa.sequence.dtw(C=cost, subseq=True, backtrack=True)
    norm_cost = D[-1].min() / audio_c.shape[1]
    return norm_cost, wp


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return
    recording = args[0]
    audio_c, dur = audio_chroma(recording)
    print(f"recording: {recording}  ({dur:.0f}s, {audio_c.shape[1]} frames)")

    results = []
    for midi_path in sorted(glob.glob("references/*.mid")):
        ref = load_reference(midi_path)
        ref_c = midi_chroma(ref)
        cost, wp = best_alignment(audio_c, ref_c)
        # measure range from the matched reference-frame span (wp = (audio_idx, ref_idx))
        ref_frames = sorted(set(int(c) for _, c in wp))
        f_lo, f_hi = ref_frames[0], ref_frames[-1]
        meas_lo = f_lo * FRAME_SEC / ref["total_sec"] * ref["total_measures"]
        meas_hi = f_hi * FRAME_SEC / ref["total_sec"] * ref["total_measures"]
        results.append((cost, midi_path, meas_lo, meas_hi))

    results.sort()
    print("\nmatches (lower cost = better):")
    for cost, path, lo, hi in results:
        print(f"  {cost:.4f}  {path.split('/')[-1]:32s}  measures≈{lo:.0f}-{hi:.0f}")
    if len(results) > 1:
        best_cost = results[0][0]
        margin = results[1][0] - results[0][0]
        # two-factor gate: a real match has both LOW absolute cost and a HEALTHY margin.
        if best_cost < 0.36 and margin > 0.10:
            verdict = "CONFIDENT MATCH"
        elif best_cost < 0.40 and margin > 0.08:
            verdict = "LIKELY (low confidence -> retain audio)"
        else:
            verdict = "NO PIECE MATCH (-> scale / free-play)"
        print(f"\nbest: {results[0][1].split('/')[-1]}  "
              f"cost={best_cost:.3f}  margin={margin:.3f} -> {verdict}")


if __name__ == "__main__":
    main()
