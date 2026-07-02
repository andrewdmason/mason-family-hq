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
# A window's best-guess piece is accepted when it's the top guess for a sustained
# RUN of windows at decent confidence — not per-window margin. With many
# chroma-similar reference pieces the runner-up is always close (margins compress),
# so a stable run of the same correct guess is the reliable signal, while scales/
# noodling jump between pieces and stay low-confidence.
CONF_FLOOR = 0.66              # median confidence (1 - cost) a run needs to count
MIN_RUN = 2                    # a piece must be the top guess for >= this many windows
MIN_SEGMENT_SEC = 8.0          # ignore segments shorter than this
# Segment mode (plan U2/KTD4): consecutive accepted windows coalesce into one span
# when their reference measure ranges overlap or sit within this many measures of
# each other. A jump back (looping a passage) breaks the chain and starts a new
# span — repetition shows as repeated spans, the signal the follow-up wants.
SEGMENT_MEASURE_GAP = 2


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
    # Empty / undecodable / too-short recordings (e.g. an instant start-stop)
    # degrade to "nothing recognized" rather than crashing the worker.
    try:
        audio_c, duration = audio_chroma(audio_path)
    except Exception:
        return {"segments": [], "confidence": 0.0, "windows": []}
    if duration < 2.5 or audio_c.shape[1] < 8:
        return {"segments": [], "confidence": 0.0, "windows": []}
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
        windows.append({
            "start_sec": start * FRAME_SEC,
            "end_sec": min((start + win) * FRAME_SEC, duration),
            "best_piece": best[1]["pieceId"],
            "variant": best[2],
            "tpl": best[1]["tpl"],
            "ref_center": (best[3] + best[4]) / 2,
            "n": best[1]["tpl"]["n"],
            "cost": best[0],
            "conf": 1 - best[0],
            "margin": margin,
        })

    _smooth_guesses(windows)
    segments = segment_runs(windows)
    segments = [s for s in segments if s["endSec"] - s["startSec"] >= MIN_SEGMENT_SEC]
    overall = float(np.mean([w["conf"] for w in windows])) if windows else 0.0
    # Per-window debug trace — the moment-by-moment reasoning behind the segments.
    windows_out = [{
        "startSec": round(w["start_sec"], 1),
        "endSec": round(w["end_sec"], 1),
        "guess": w["best_piece"],
        "matched": w.get("accepted", False),
        "confidence": round(w["conf"], 3),
        "margin": round(w["margin"], 3),
        "refFrac": round(w["ref_center"] / w["n"], 3) if w.get("n") else None,
        "variant": w["variant"],
    } for w in windows]
    return {"segments": segments, "confidence": round(overall, 3), "windows": windows_out}


def _sec_to_measure(sec, measure_starts):
    """1-based measure number containing the given reference-time second."""
    lo, hi = 0, len(measure_starts)
    while lo < hi:                       # bisect_right
        mid = (lo + hi) // 2
        if measure_starts[mid] <= sec:
            lo = mid + 1
        else:
            hi = mid
    return max(1, min(lo, len(measure_starts)))


def _coalesce_windows(accepted):
    """Merge time-contiguous accepted windows whose measure ranges continue from
    the previous window's into spans; a measure jump (loop-back / skip) starts a
    new span. Returns the AlignmentSpan contract (src/lib/types.ts)."""
    spans, prev = [], None
    for w in accepted:
        contiguous = (
            prev is not None
            and w["start_sec"] <= prev["end_sec"] + 1e-6
            and w["m_lo"] <= prev["m_hi"] + SEGMENT_MEASURE_GAP
            and w["m_hi"] >= prev["m_lo"] - SEGMENT_MEASURE_GAP
        )
        if contiguous:
            cur = spans[-1]
            cur["endSec"] = w["end_sec"]
            cur["measureStart"] = min(cur["measureStart"], w["m_lo"])
            cur["measureEnd"] = max(cur["measureEnd"], w["m_hi"])
            cur["_confs"].append(w["conf"])
        else:
            spans.append({
                "startSec": w["start_sec"], "endSec": w["end_sec"],
                "measureStart": w["m_lo"], "measureEnd": w["m_hi"],
                "_confs": [w["conf"]],
            })
        prev = w
    return [{
        "startSec": round(s["startSec"], 1),
        "endSec": round(s["endSec"], 1),
        "measureStart": s["measureStart"],
        "measureEnd": s["measureEnd"],
        "confidence": round(float(np.mean(s["_confs"])), 3),
    } for s in spans]


def align_to_reference(audio_path, ref_midi_bytes):
    """Known-piece segment alignment (plan U2/KTD4): match the recording's
    windows against ONE reference and return measure-level spans.

    Returns {"spans": [AlignmentSpan...], "totalMeasures": int}. No piece
    recognition, no regions, no scale classification — the piece is known in
    advance; windows under CONF_FLOOR emit nothing (R8: low confidence degrades
    to absent section data, never a negative signal). totalMeasures is the count
    of measure starts in the reference so app-side section mapping needs no
    reference-MIDI parse."""
    try:
        ref = parse_smf(ref_midi_bytes)
        tpl = build_templates(ref)
        measure_starts = ref.measure_starts_sec()
    except Exception:
        # Unreadable reference degrades to "no section data", like session mode.
        return {"spans": [], "totalMeasures": 0}
    total_measures = len(measure_starts)
    try:
        audio_c, duration = audio_chroma(audio_path)
    except Exception:
        return {"spans": [], "totalMeasures": total_measures}
    if duration < 2.5 or audio_c.shape[1] < 8:
        return {"spans": [], "totalMeasures": total_measures}

    win = int(WINDOW_SEC / FRAME_SEC)
    step = int(WINDOW_STEP_SEC / FRAME_SEC)
    accepted = []
    for start in range(0, max(audio_c.shape[1] - 1, 1), step):
        wc = audio_c[:, start:start + win]
        if wc.shape[1] < win // 2:
            break
        cost, rlo, rhi = min(
            (_subseq(wc, tpl[v]) for v in ("both", "lh", "rh")),
            key=lambda t: t[0],
        )
        conf = 1 - cost
        if conf < CONF_FLOOR:
            continue
        accepted.append({
            "start_sec": start * FRAME_SEC,
            "end_sec": min((start + win) * FRAME_SEC, duration),
            "m_lo": _sec_to_measure(rlo * FRAME_SEC, measure_starts),
            "m_hi": _sec_to_measure(rhi * FRAME_SEC, measure_starts),
            "conf": conf,
        })
    return {"spans": _coalesce_windows(accepted), "totalMeasures": total_measures}


def _smooth_guesses(windows):
    """Absorb lone (1- or 2-window) outliers in the best-guess sequence that sit
    between identical neighbors — e.g. one stray 'Gigue' window inside a long run
    of 'Impromptu', or a 2-window blip inside a 'Ballade' run."""
    g = [w["best_piece"] for w in windows]
    n = len(g)
    for i in range(1, n - 1):
        if g[i] != g[i - 1] and g[i - 1] == g[i + 1]:
            windows[i]["best_piece"] = g[i] = g[i - 1]
    for i in range(1, n - 2):
        if g[i - 1] == g[i + 2] and g[i] != g[i - 1] and g[i + 1] != g[i - 1]:
            windows[i]["best_piece"] = windows[i + 1]["best_piece"] = g[i - 1]
            g[i] = g[i + 1] = g[i - 1]


def segment_runs(windows):
    """Group windows into runs of the same best-guess; accept a run as that piece
    when it's sustained (>= MIN_RUN windows) at decent median confidence."""
    runs, cur = [], None
    for w in windows:
        if cur and cur[-1]["best_piece"] == w["best_piece"]:
            cur.append(w)
        else:
            if cur:
                runs.append(cur)
            cur = [w]
    if cur:
        runs.append(cur)

    segments = []
    for run in runs:
        med = float(np.median([w["conf"] for w in run]))
        accepted = len(run) >= MIN_RUN and med >= CONF_FLOOR
        for w in run:
            w["accepted"] = accepted
        segments.append(_finalize_run(run, accepted))
    return _merge_free(segments)


def _finalize_run(run, accepted):
    base = {
        "startSec": round(run[0]["start_sec"], 1),
        "endSec": round(run[-1]["end_sec"], 1),
        "confidence": round(float(np.mean([w["conf"] for w in run])), 3),
    }
    if not accepted:
        return {**base, "kind": "free", "pieceId": None, "region": None,
                "tempoBpm": None, "handsSeparate": False, "repetitionCount": None}
    # Region from the most-confident window's position in the reference.
    anchor_w = min(run, key=lambda w: w["cost"])
    n = anchor_w.get("n")
    region = _region(anchor_w["ref_center"] / n, anchor_w["ref_center"] / n) if n else None
    hand_votes = sum(1 for w in run if w["variant"] in ("lh", "rh"))
    return {
        **base, "kind": "piece", "pieceId": run[0]["best_piece"],
        "region": region, "tempoBpm": None,
        "handsSeparate": hand_votes > len(run) / 2,
        "repetitionCount": None,
    }


def _merge_free(segments):
    """Coalesce consecutive free segments (rejected runs sitting next to real gaps)."""
    out = []
    for s in segments:
        if out and out[-1]["kind"] == "free" and s["kind"] == "free":
            out[-1]["endSec"] = s["endSec"]
        else:
            out.append(s)
    return out
