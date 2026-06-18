"""
Render the harness's OWN measure span of a reference MIDI to audio, so you can
listen and confirm what "measures 72-94" etc. actually correspond to — independent
of any published-score bar numbering.

Run:
  ./.venv/bin/python inspect_measures.py references/chopin_ballade_4.mid 72 94
  ./.venv/bin/python inspect_measures.py references/chopin_ballade_4.mid 266 281

Writes a wav into clips/ and prints the time span. (Simple sine synth — buzzy but
recognizable. Handles single-time-signature files, which both seed refs are.)
"""
import sys
import os
import numpy as np
import soundfile as sf
from midi_reference import parse_smf

SR = 22050


def measure_to_tick(measure, ppq, num, den):
    return measure * (ppq * 4 * num / den)


def tick_to_sec(tick, ppq, tempo_map, max_tick):
    sec, last_tick, cur = 0.0, 0, tempo_map[0][1]
    for ev_tick, us in tempo_map[1:] + [(max_tick + 1, tempo_map[-1][1])]:
        seg_end = min(tick, ev_tick)
        if seg_end > last_tick:
            sec += (seg_end - last_tick) / ppq * (cur / 1_000_000)
        if ev_tick >= tick:
            break
        last_tick, cur = ev_tick, us
    return sec


def main():
    path, m_lo, m_hi = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    ppq, notes, tempo_map, timesig_map = parse_smf(path)
    num, den = timesig_map[0][1], timesig_map[0][2]
    max_tick = max(e for _, e, _ in notes)

    t_lo = tick_to_sec(measure_to_tick(m_lo, ppq, num, den), ppq, tempo_map, max_tick)
    t_hi = tick_to_sec(measure_to_tick(m_hi, ppq, num, den), ppq, tempo_map, max_tick)

    dur = t_hi - t_lo
    audio = np.zeros(int(dur * SR) + SR, dtype=np.float32)
    n_in = 0
    for s, e, pitch in notes:
        ss = tick_to_sec(s, ppq, tempo_map, max_tick)
        se = tick_to_sec(e, ppq, tempo_map, max_tick)
        if se < t_lo or ss > t_hi:
            continue
        n_in += 1
        ss, se = max(ss, t_lo) - t_lo, min(se, t_hi) - t_lo
        i0, i1 = int(ss * SR), int(se * SR)
        t = np.arange(i1 - i0) / SR
        freq = 440.0 * 2 ** ((pitch - 69) / 12)
        env = np.minimum(1.0, np.exp(-3 * t))  # quick decay
        audio[i0:i1] += 0.15 * np.sin(2 * np.pi * freq * t) * env

    peak = np.max(np.abs(audio)) or 1.0
    audio = audio / peak * 0.9
    os.makedirs("clips", exist_ok=True)
    name = f"clips/{os.path.basename(path).replace('.mid','')}_m{int(m_lo)}-{int(m_hi)}.wav"
    sf.write(name, audio, SR)
    print(f"measures {int(m_lo)}-{int(m_hi)}  ->  {t_lo:.1f}s-{t_hi:.1f}s "
          f"({dur:.1f}s, {n_in} notes)  ->  {name}")


if __name__ == "__main__":
    main()
