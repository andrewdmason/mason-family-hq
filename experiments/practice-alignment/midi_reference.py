"""
Reference-side of the practice-alignment spike (U1).

Loads a reference MIDI and produces the two things alignment depends on:
  1. a time-gridded chroma template (12 pitch-class energies over time), and
  2. total measures / key profile derived from the MIDI tempo + time-sig.

Uses a lenient hand-rolled SMF parser (the seed Bach file is rejected by strict
parsers like `mido` — old-sequencer quirk). No external deps.

Run:  ./.venv/bin/python midi_reference.py references/*.mid
"""
import sys
import struct

FRAME_SEC = 0.10  # seconds per chroma frame; matches the librosa hop in align.py


def _read_varlen(buf, p):
    val = 0
    while True:
        b = buf[p]; p += 1
        val = (val << 7) | (b & 0x7F)
        if not (b & 0x80):
            return val, p


def parse_smf(path):
    """Lenient Standard MIDI File parse -> (ppq, notes, tempo_map, timesig_map)."""
    buf = open(path, "rb").read()
    assert buf[:4] == b"MThd", "not a MIDI file"
    _, fmt, ntracks, division = struct.unpack(">IHHH", buf[4:14])
    ppq = division if not (division & 0x8000) else 480
    p = 14

    notes, tempo_map, timesig_map = [], [], []
    for _ in range(ntracks):
        if buf[p:p+4] != b"MTrk":
            break
        length = struct.unpack(">I", buf[p+4:p+8])[0]
        p += 8
        end = p + length
        tick, running, pending = 0, 0, {}
        while p < end:
            dt, p = _read_varlen(buf, p)
            tick += dt
            status = buf[p]
            if status & 0x80:
                p += 1; running = status
            else:
                status = running
            hi = status & 0xF0
            if status == 0xFF:                       # meta
                mtype = buf[p]; p += 1
                mlen, p = _read_varlen(buf, p)
                data = buf[p:p+mlen]; p += mlen
                if mtype == 0x51 and mlen == 3:
                    tempo_map.append((tick, (data[0] << 16) | (data[1] << 8) | data[2]))
                elif mtype == 0x58 and mlen >= 2:
                    timesig_map.append((tick, data[0], 1 << data[1]))
            elif status in (0xF0, 0xF7):             # sysex
                slen, p = _read_varlen(buf, p); p += slen
            elif hi == 0x90:                         # note on
                pitch, vel = buf[p], buf[p+1]; p += 2
                if vel > 0:
                    pending.setdefault(pitch, []).append(tick)
                elif pending.get(pitch):
                    notes.append((pending[pitch].pop(0), tick, pitch))
            elif hi == 0x80:                         # note off
                pitch = buf[p]; p += 2
                if pending.get(pitch):
                    notes.append((pending[pitch].pop(0), tick, pitch))
            elif hi in (0xA0, 0xB0, 0xE0):
                p += 2
            elif hi in (0xC0, 0xD0):
                p += 1
            else:
                p += 1
        p = end
    if not tempo_map:
        tempo_map = [(0, 500000)]
    if not timesig_map:
        timesig_map = [(0, 4, 4)]
    tempo_map.sort(); timesig_map.sort()
    return ppq, notes, tempo_map, timesig_map


def load_reference(path):
    ppq, notes, tempo_map, timesig_map = parse_smf(path)
    max_tick = max((e for _, e, _ in notes), default=0)

    def tick_to_sec(tick):
        sec, last_tick, cur = 0.0, 0, tempo_map[0][1]
        for ev_tick, us in tempo_map[1:] + [(max_tick + 1, tempo_map[-1][1])]:
            seg_end = min(tick, ev_tick)
            if seg_end > last_tick:
                sec += (seg_end - last_tick) / ppq * (cur / 1_000_000)
            if ev_tick >= tick:
                break
            last_tick, cur = ev_tick, us
        return sec

    def tick_to_measure(tick):
        measures, last_tick = 0.0, 0
        num, den = timesig_map[0][1], timesig_map[0][2]
        for ev_tick, n, d in timesig_map[1:] + [(max_tick + 1, num, den)]:
            seg_end = min(tick, ev_tick)
            if seg_end > last_tick:
                measures += (seg_end - last_tick) / (ppq * 4 * num / den)
            if ev_tick >= tick:
                break
            last_tick, num, den = ev_tick, n, d
        return measures

    total_sec = tick_to_sec(max_tick)
    n_frames = int(total_sec / FRAME_SEC) + 1

    chroma = [[0.0] * 12 for _ in range(n_frames)]
    for s, e, pitch in notes:
        f0 = int(tick_to_sec(s) / FRAME_SEC)
        f1 = min(int(tick_to_sec(e) / FRAME_SEC), n_frames - 1)
        pc = pitch % 12
        for f in range(f0, f1 + 1):
            chroma[f][pc] += 1.0

    return {
        "path": path, "ppq": ppq, "n_notes": len(notes),
        "pitch_min": min((p for _, _, p in notes), default=None),
        "pitch_max": max((p for _, _, p in notes), default=None),
        "total_sec": total_sec, "total_measures": tick_to_measure(max_tick),
        "n_tempo": len(tempo_map), "timesigs": timesig_map,
        "chroma": chroma, "n_frames": n_frames,
    }


def split_hands(path, split_pitch=60):
    _, notes, _, _ = parse_smf(path)
    lo = sum(1 for _, _, p in notes if p < split_pitch)
    hi = len(notes) - lo
    return lo, hi


def summarize(ref):
    profile = [0.0] * 12
    for frame in ref["chroma"]:
        for i, v in enumerate(frame):
            profile[i] += v
    total = sum(profile) or 1
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    top = sorted(range(12), key=lambda i: -profile[i])[:5]
    print(f"\n=== {ref['path'].split('/')[-1]} ===")
    print(f"ppq={ref['ppq']}  notes={ref['n_notes']}  pitch={ref['pitch_min']}-{ref['pitch_max']}")
    print(f"duration={ref['total_sec']:.0f}s  measures≈{ref['total_measures']:.0f}  tempo_events={ref['n_tempo']}")
    print(f"time-sigs={[(t, f'{n}/{d}') for t, n, d in ref['timesigs']]}")
    print(f"chroma frames={ref['n_frames']} (at {FRAME_SEC*1000:.0f}ms)")
    print("top pitch classes: " + ", ".join(f"{names[i]} {profile[i]/total*100:.0f}%" for i in top))


if __name__ == "__main__":
    for path in sys.argv[1:]:
        ref = load_reference(path)
        summarize(ref)
        lo, hi = split_hands(path)
        print(f"hand split @C4: {lo} low / {hi} high "
              f"({lo/(lo+hi)*100:.0f}% / {hi/(lo+hi)*100:.0f}%)")
