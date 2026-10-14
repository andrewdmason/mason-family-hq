"""
Local scorecard for the ball-trail tracer (balltrail/), run against the family's
test clips on this Mac. Nothing is uploaded anywhere.

  ./.venv/bin/python tests/trace_scorecard.py [--out DIR] [--only NAME ...] [--no-tap]

For each clip: an automatic trace, and (where we know where the ball is) a
tapped trace. Prints a scorecard against hand-checked ground truth and writes
a verification sheet per run into DIR (the trail drawn the way the phone
draws it: reference points mapped through each frame's homography).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from balltrail import trace  # noqa: E402

HOME = os.path.expanduser("~")
# Frame numbers are 0-based decode order; pixels are in that frame at its native size.
CASES = [
    dict(name="cardinals", path=f"{HOME}/Desktop/Sebastian double Cardinals Game 1.mov",
         contact=196, land=268, land_ref=(488, 242), tap=(199, 945, 441), fixture="cardinals.json"),
    dict(name="mustangs", path=f"{HOME}/Desktop/Double vs. Mustangs Navy 12U.mp4",
         contact=787, land=888, land_ref=(302, 250), tap=(789, 572, 289)),
    dict(name="falcon-double", path=f"{HOME}/Downloads/Double @ Falcon Prospects 13U.mp4",
         contact=158, land=204, land_ref=(439, 354), tap=(163, 607, 341), stats=(67, 14, 132), fixture="falcon.json"),
    dict(name="falcon-single", path=f"{HOME}/Downloads/Single @ Falcon Prospects 13U.mp4"),
    dict(name="falcon-hr", path=f"{HOME}/Downloads/Home Run @ Falcon Prospects 13U.mp4"),
    dict(name="alameda-double", path=f"{HOME}/Downloads/Double vs. Alameda Merchants 13U.mp4"),
]


def frame_times(path: str) -> np.ndarray:
    cap = cv2.VideoCapture(path)
    ts = []
    while cap.grab():
        ts.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
    return np.array(ts)


def read_frames(path: str, wanted: set[int]) -> dict[int, np.ndarray]:
    cap = cv2.VideoCapture(path)
    out, i = {}, 0
    last = max(wanted)
    while i <= last and cap.grab():
        if i in wanted:
            out[i] = cap.retrieve()[1]
        i += 1
    return out


def draw_trail(img: np.ndarray, trail: dict, t: float, color=(40, 200, 255)) -> np.ndarray:
    """Draw the trail at clip time t on frame img, as the phone would: map every
    reference point through the frame's homography into frame-normalized coords."""
    h, w = img.shape[:2]
    pts = np.array(trail["points"], float)
    if t < trail["contactS"] or len(pts) == 0:
        return img
    frs = np.array(trail["frames"], float)
    Hn = frs[np.argmin(np.abs(frs[:, 0] - t)), 1:].reshape(3, 3)
    upto = pts[pts[:, 0] <= t + 1e-6]
    if len(upto) == 0:
        return img
    p = np.c_[upto[:, 1:], np.ones(len(upto))] @ Hn.T
    p = p[:, :2] / p[:, 2:]
    q = np.int32(p * [w, h])
    sc = w / 1280
    for a, b in zip(q, q[1:]):
        cv2.line(img, tuple(a), tuple(b), color, max(1, int(3 * sc)), cv2.LINE_AA)
    if t <= trail["landS"]:
        cv2.circle(img, tuple(q[-1]), max(3, int(8 * sc)), (255, 255, 255), max(1, int(2 * sc)), cv2.LINE_AA)
    return img


def sheet(case: dict, trail: dict, times: np.ndarray, dbg: dict, out: str, label: str) -> None:
    c, l = trail["contactS"], trail["landS"]
    ts = list(np.linspace(c, l, 7)) + [l + 0.5]
    idx = [int(np.argmin(np.abs(times - t))) for t in ts]
    ref = dbg.get("ref_frame", idx[0])
    frames = read_frames(case["path"], set(idx) | {ref})
    tiles = []
    # tile 0: the reference frame with the whole trail and the observed ball points
    img = frames[ref].copy()
    hh, ww = img.shape[:2]
    pts = np.array(trail["points"], float)
    for a, b in zip(pts, pts[1:]):
        cv2.line(img, (int(a[1] * ww), int(a[2] * hh)), (int(b[1] * ww), int(b[2] * hh)), (40, 200, 255), 2, cv2.LINE_AA)
    sc = ww / 1280
    for k, x, y in dbg.get("track", []):
        cv2.circle(img, (int(x * sc), int(y * sc)), 3, (0, 255, 0), -1)
    if case.get("land_ref"):
        x, y = case["land_ref"]
        cv2.drawMarker(img, (int(x * sc), int(y * sc)), (0, 0, 255), cv2.MARKER_TILTED_CROSS, 18, 2)
    tiles.append(("reference (whole trail; green = seen)", img))
    for t, i in zip(ts, idx):
        tiles.append((f"t={t:.2f}s f{i}", draw_trail(frames[i].copy(), trail, float(times[i]))))
    cells = []
    for title, im in tiles:
        im = cv2.resize(im, (640, 360))
        cv2.putText(im, title, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
        cv2.putText(im, title, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
        cells.append(im)
    while len(cells) % 3:
        cells.append(np.zeros_like(cells[0]))
    grid = np.vstack([np.hstack(cells[r:r + 3]) for r in range(0, len(cells), 3)])
    cv2.putText(grid, label, (8, grid.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 85])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/balltrail-scorecard")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--no-tap", action="store_true")
    ap.add_argument("--no-auto", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    rows = []
    for case in CASES:
        if args.only and case["name"] not in args.only:
            continue
        if not os.path.exists(case["path"]):
            print(f"skip {case['name']}: {case['path']} not found")
            continue
        times = frame_times(case["path"])
        cap = cv2.VideoCapture(case["path"])
        w, h = int(cap.get(3)), int(cap.get(4))
        modes = []
        if not args.no_auto:
            modes.append(("auto", None))
        if case.get("tap") and not args.no_tap:
            f, x, y = case["tap"]
            modes.append(("tap", {"t": float(times[f]), "x": x / w, "y": y / h}))
        for mode, tap in modes:
            dbg: dict = {}
            t0 = time.time()
            try:
                res = trace(case["path"], None, None, tap, dbg)
            except Exception as e:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                res = {"status": "failed", "trail": None, "reason": repr(e)}
            secs = time.time() - t0
            trail = res.get("trail") or res.get("candidate")
            row = {"clip": case["name"], "mode": mode, "status": res["status"], "reason": res.get("reason", ""),
                   "secs": round(secs, 1)}
            if trail:
                fc = int(np.argmin(np.abs(times - trail["contactS"])))
                fl = int(np.argmin(np.abs(times - trail["landS"])))
                row.update(contact=f"f{fc}" + (f" (exp {case['contact']})" if case.get("contact") else ""),
                           land=f"f{fl}" + (f" (exp {case['land']})" if case.get("land") else ""),
                           landed=trail["landed"], conf=trail["confidence"], stats=trail["stats"],
                           points=len(trail["points"]))
                lp = trail["points"][-1]
                row["land_px"] = (round(lp[1] * 1280), round(lp[2] * 720 * (1280 / 1280)))
                if case.get("land_ref"):
                    row["land_px"] = f"{row['land_px']} (exp {case['land_ref']})"
                if case.get("stats"):
                    row["stats"] = f"{trail['stats']} (exp mph/deg/ft {case['stats']})"
                label = f"{case['name']} {mode}: {res['status']} conf {trail['confidence']} {trail['stats']}"
                sheet(case, trail, times, dbg, os.path.join(args.out, f"{case['name']}-{mode}.jpg"), label)
                with open(os.path.join(args.out, f"{case['name']}-{mode}.json"), "w") as f:
                    json.dump(trail, f)
            with open(os.path.join(args.out, f"{case['name']}-{mode}-debug.json"), "w") as f:
                json.dump(dbg, f, default=str)
            rows.append(row)
            print(json.dumps(row, default=str))
            sys.stdout.flush()
    print("\nSCORECARD")
    for r in rows:
        print(" | ".join(f"{k}={v}" for k, v in r.items()))


if __name__ == "__main__":
    main()
