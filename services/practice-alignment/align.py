"""
Windowed chroma + subsequence-DTW alignment (plan U6).

Graduates the U1 whole-file spike into a windowed segmenter: the recording is
cut into overlapping windows, each window is matched against every reference
(both-hands + per-hand templates), and consecutive same-piece windows are
stitched into segments. Windowing is what (a) lets one session contain several
pieces, (b) turns heavy repetition into a signal instead of a smear, and
(c) detects hands-separate practice (a window matching the LH/RH template best).

Output is the segments contract consumed by the app (see PracticeSegment in
src/lib/types.ts). Location is region-level, never bar numbers (per the spike).
"""
import numpy as np
import librosa

from midi import parse_smf, Reference

FRAME_SEC = 0.10
SR = 22050
HOP = int(SR * FRAME_SEC)
WINDOW_SEC = 12.0
WINDOW_STEP_SEC = 6.0           # 50% overlap
HAND_SPLIT = 60                 # C4
COST_MATCH = 0.36               # two-factor gate (tuned in the spike)
MARGIN_MATCH = 0.10
MIN_SEGMENT_SEC = 8.0           # ignore blips shorter than this


def _l2(m):
    norm = np.linalg.norm(m, axis=0, keepdims=True)
    norm[norm == 0] = 1
    return m / norm


def build_templates(ref: Reference):
    total_sec = ref.total_sec()
    n = max(int(total_sec / FRAME_SEC) + 1, 1)
    both = np.zeros((12, n)); lh = np.zeros((12, n)); rh = np.zeros((12, n))
    for s, e, pitch in ref.notes:
        f0 = int(ref.tick_to_sec(s) / FRAME_SEC)
        f1 = min(int(ref.tick_to_sec(e) / FRAME_SEC), n - 1)
        pc = pitch % 12
        both[pc, f0:f1 + 1] += 1
        (lh if pitch < HAND_SPLIT else rh)[pc, f0:f1 + 1] += 1
    return {
        "both": _l2(both), "lh": _l2(lh), "rh": _l2(rh),
        "total_sec": total_sec, "total_measures": ref.total_measures(), "n": n,
    }


def audio_chroma(path):
    y, _ = librosa.load(path, sr=SR, mono=True)
    return _l2(librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP)), len(y) / SR


def _subseq(window_c, ref_c):
    cost = 1.0 - (window_c.T @ ref_c)          # (window, ref)
    D, wp = librosa.sequence.dtw(C=cost, subseq=True, backtrack=True)
    end = int(np.argmin(D[-1]))
    norm_cost = D[-1, end] / window_c.shape[1]
    ref_frames = [c for _, c in wp]
    return norm_cost, min(ref_frames), max(ref_frames)


def _region(frac_lo, frac_hi):
    mid = (frac_lo + frac_hi) / 2
    if mid < 0.15: return "the opening"
    if mid < 0.40: return "an early section"
    if mid < 0.65: return "the middle section"
    if mid < 0.85: return "a later section"
    return "the coda"


def align(audio_path, references):
    """references: list of {"pieceId": str, "midi": bytes}. Returns the contract dict."""
    audio_c, duration = audio_chroma(audio_path)
    refs = []
    for r in references:
        try:
            tpl = build_templates(parse_smf(r["midi"]))
            refs.append({"pieceId": r["pieceId"], "tpl": tpl})
        except Exception:
            continue  # unreadable reference is just absent from the set

    win = int(WINDOW_SEC / FRAME_SEC)
    step = int(WINDOW_STEP_SEC / FRAME_SEC)
    windows = []
    for start in range(0, max(audio_c.shape[1] - 1, 1), step):
        wc = audio_c[:, start:start + win]
        if wc.shape[1] < win // 2:
            break
        scored = []
        for ref in refs:
            best_variant = min(
                ("both", "lh", "rh"),
                key=lambda v: _subseq(wc, ref["tpl"][v])[0],
            )
            cost, rlo, rhi = _subseq(wc, ref["tpl"][best_variant])
            scored.append((cost, ref, best_variant, rlo, rhi))
        scored.sort(key=lambda x: x[0])
        best = scored[0]
        margin = (scored[1][0] - best[0]) if len(scored) > 1 else 1.0
        matched = best[0] < COST_MATCH and margin > MARGIN_MATCH
        windows.append({
            "start_sec": start * FRAME_SEC,
            "end_sec": min((start + win) * FRAME_SEC, duration),
            "label": best[1]["pieceId"] if matched else None,
            "variant": best[2] if matched else "both",
            "tpl": best[1]["tpl"],
            "ref_center": (best[3] + best[4]) / 2,
            "cost": best[0],
        })

    _smooth_labels(windows)
    segments = _stitch(windows)
    segments = [s for s in segments if s["endSec"] - s["startSec"] >= MIN_SEGMENT_SEC]
    overall = float(np.mean([1 - w["cost"] for w in windows])) if windows else 0.0
    return {"segments": segments, "confidence": round(overall, 3)}


def _smooth_labels(windows):
    """De-noise per-window labels so a continuous passage isn't chopped into
    alternating piece/free slivers: (1) fill a lone gap flanked by the same piece,
    (2) drop a lone matched window surrounded by non-matches."""
    labels = [w["label"] for w in windows]
    n = len(labels)
    for i in range(1, n - 1):
        if labels[i] is None and labels[i - 1] is not None and labels[i - 1] == labels[i + 1]:
            windows[i]["label"] = labels[i - 1]      # fill gap
    labels = [w["label"] for w in windows]
    for i in range(n):
        prev = labels[i - 1] if i > 0 else None
        nxt = labels[i + 1] if i < n - 1 else None
        if labels[i] is not None and prev != labels[i] and nxt != labels[i]:
            windows[i]["label"] = None               # drop singleton


def _stitch(windows):
    segments, cur = [], None
    for w in windows:
        key = w["label"] if w["label"] else "__free__"
        if cur and cur["_key"] == key:
            cur["endSec"] = w["end_sec"]
            cur["_windows"].append(w)
        else:
            if cur:
                segments.append(_finalize(cur))
            cur = {"_key": key, "startSec": w["start_sec"], "endSec": w["end_sec"], "_windows": [w]}
    if cur:
        segments.append(_finalize(cur))
    return segments


def _finalize(seg):
    ws = seg["_windows"]
    base = {
        "startSec": round(seg["startSec"], 1), "endSec": round(seg["endSec"], 1),
        "confidence": round(float(np.mean([1 - w["cost"] for w in ws])), 3),
    }
    if seg["_key"] == "__free__":
        return {**base, "kind": "free", "pieceId": None, "region": None,
                "tempoBpm": None, "handsSeparate": False, "repetitionCount": None}

    tpl = ws[0]["tpl"]
    n = tpl["n"]
    # Region from the most-confident (lowest-cost) window, not the span of all
    # centers — averaging smears a localized passage toward "the middle".
    anchor = min(ws, key=lambda w: w["cost"])["ref_center"]
    hand_votes = sum(1 for w in ws if w["variant"] in ("lh", "rh"))
    # NOTE (v1): tempoBpm and repetitionCount are intentionally null. The naive
    # ref-span/audio-span ratios produced nonsense (relTempo up to 24x); a sound
    # tempo estimate (local DTW-path slope) and repetition detector (tight ref-
    # center clustering across windows) are deferred refinements. Region +
    # hands-separate are reliable today, so the narrative leans on those.
    return {
        **base, "kind": "piece", "pieceId": seg["_key"],
        "region": _region(anchor / n, anchor / n),
        "tempoBpm": None,
        "handsSeparate": hand_votes > len(ws) / 2,
        "repetitionCount": None,
    }
