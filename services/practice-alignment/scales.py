"""
Detect scale practice in the unmatched ("free") stretches of a session, using the
transcribed notes. The reliable signal is a long unbroken stepwise run in one
direction (a scale runs 10+ notes up/down by whole/half steps; real pieces top out
around 4-6). When found, the free segment is reclassified to kind="scale" with a
key guess so the app can log it as technique practice instead of generic free play.
"""
from midi import parse_smf

NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MIN_RUN = 8  # consecutive same-direction whole/half steps to call it a scale


def _cdir(a: int, b: int) -> int:
    """Signed step (±1/±2 semitones, circular) between two pitch classes, else 0."""
    for s in (1, 2, -1, -2):
        if (a + s) % 12 == b % 12:
            return s
    return 0


def _pc_line(pitches) -> list:
    """Melodic pitch-class line with octave doublings / immediate repeats removed."""
    pcs = []
    for p in pitches:
        pc = p % 12
        if not pcs or pcs[-1] != pc:
            pcs.append(pc)
    return pcs


def _longest_run(pcs) -> int:
    best = cur = 1
    last_dir = 0
    for i in range(len(pcs) - 1):
        d = _cdir(pcs[i], pcs[i + 1])
        if d != 0 and last_dir != 0 and (d > 0) == (last_dir > 0):
            cur += 1
        elif d != 0:
            cur, last_dir = 2, d
        else:
            cur, last_dir = 1, 0
        best = max(best, cur)
    return best


def _is_scale(pitches) -> bool:
    return len(pitches) >= 10 and _longest_run(_pc_line(pitches)) >= MIN_RUN


def _key(pitches):
    pcs = _pc_line(pitches)
    if len(set(pcs)) > 8:
        return None  # several keys / chromatic — don't claim a specific one
    tonic = pitches[0] % 12  # scales almost always start on the tonic
    present = set(pcs)
    major = (tonic + 4) % 12 in present
    minor = (tonic + 3) % 12 in present
    quality = " major" if (major and not minor) else (" minor" if (minor and not major) else "")
    return NAMES[tonic] + quality


def classify_scales(midi_bytes: bytes, segments: list) -> list:
    """Reclassify free segments that are scale runs -> kind='scale' with a key."""
    try:
        ref = parse_smf(midi_bytes)
    except Exception:  # noqa: BLE001
        return segments
    notes_sec = sorted((ref.tick_to_sec(s), p) for s, _, p in ref.notes)
    for seg in segments:
        if seg.get("kind") != "free":
            continue
        pitches = [p for t, p in notes_sec if seg["startSec"] <= t < seg["endSec"]]
        if _is_scale(pitches):
            seg["kind"] = "scale"
            seg["key"] = _key(pitches)
    return segments
