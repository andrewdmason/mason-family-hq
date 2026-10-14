# Link per-frame candidates into ball tracks. Auto mode: try every seed pair, keep best. Seed mode: start at a tap.
import json, sys, numpy as np
from collections import defaultdict
def load(p):
    d = json.load(open(p)); by = defaultdict(list)
    for c in d['cands']: by[c['f']].append(c)
    return d, by
def extend(by, track, fmax, maxgap=10, gate0=10):
    # track: list of (f, x, y) in reference coords; extend forward with constant-accel prediction
    used = set(); gap = 0
    f = track[-1][0]
    while f < fmax and gap <= maxgap:
        f += 1
        pts = np.array(track[-8:], float)
        if len(pts) >= 3:
            A = np.vstack([np.ones(len(pts)), pts[:, 0] - pts[-1, 0], (pts[:, 0] - pts[-1, 0]) ** 2]).T
            cx = np.linalg.lstsq(A, pts[:, 1], rcond=None)[0]; cy = np.linalg.lstsq(A, pts[:, 2], rcond=None)[0]
            dt = f - pts[-1, 0]; px, py = cx @ [1, dt, dt*dt], cy @ [1, dt, dt*dt]
        else:
            dt = f - pts[-1, 0]; v = (pts[-1, 1:] - pts[-2, 1:]) / (pts[-1, 0] - pts[-2, 0])
            px, py = pts[-1, 1:] + v * dt
        step = np.hypot(*(pts[-1, 1:] - pts[-2, 1:])) / max(1, pts[-1, 0] - pts[-2, 0])
        gate = gate0 + 0.3 * step + 4 * gap
        best = None
        for c in by.get(f, []):
            dd = np.hypot(c['rx'] - px, c['ry'] - py)
            if dd < gate and (best is None or dd < best[0]): best = (dd, c)
        if best: track.append((f, best[1]['rx'], best[1]['ry'])); gap = 0
        else: gap += 1
    return track
def auto(by, s, e, seed_window=20, vmin=2.5, vmax=60, peak_min=40):
    best = None
    for f in range(s, min(e, s + seed_window)):
        for a in by.get(f, []):
            if a['a'] > 90 or a['peak'] < peak_min: continue
            for g in (1, 2):
                for b in by.get(f + g, []):
                    dv = np.hypot(b['rx'] - a['rx'], b['ry'] - a['ry']) / g
                    if not (vmin <= dv <= vmax): continue
                    t = extend(by, [(f, a['rx'], a['ry']), (f + g, b['rx'], b['ry'])], e)
                    if len(t) < 6: continue
                    arr = np.array(t); disp = np.hypot(*(arr[-1, 1:] - arr[0, 1:]))
                    span = arr[-1, 0] - arr[0, 0]
                    # smoothness: residual of a cubic fit over time; real flights are near-perfect curves
                    res = max(np.std(arr[:, k] - np.polyval(np.polyfit(arr[:, 0], arr[:, k], min(3, len(t) - 1)), arr[:, 0])) for k in (1, 2))
                    fill = len(t) / (span + 1)
                    # ball prior: real vertical travel, and gravity bends the path downward on screen
                    if np.ptp(arr[:, 2]) < 60 or np.polyfit(arr[:, 0], arr[:, 2], 2)[0] <= 0: continue
                    score = len(t) * fill / (1 + res / 6)
                    if disp > 40 and (best is None or score > best[0]): best = (score, t)
    return best[1] if best else None
if __name__ == '__main__':
    p, s, e, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    d, by = load(p)
    if len(sys.argv) > 5:  # tap: f,x,y (reference coords). Seed = candidate under the tap; try every plausible next step.
        f0, x0, y0 = map(float, sys.argv[5].split(',')); f0 = int(f0)
        a = min(by[f0], key=lambda c: np.hypot(c['rx'] - x0, c['ry'] - y0))
        best = None
        for g in (1, 2):
            for b in by.get(f0 + g, []):
                if not (3 <= np.hypot(b['rx'] - a['rx'], b['ry'] - a['ry']) <= 80 * g): continue
                tr = extend(by, [(f0, a['rx'], a['ry']), (f0 + g, b['rx'], b['ry'])], e)
                pk = np.mean([c['peak'] for f, x, y in tr for c in by[f] if c['rx'] == x and c['ry'] == y])
                score = (len(tr), pk)
                if best is None or score > best[0]: best = (score, tr)
        t = best[1]
    else:
        t = auto(by, s, e, vmin=12 * d["w"] / 1280, vmax=80 * d["w"] / 1280, peak_min=60)
    json.dump(t, open(out, 'w')); print(len(t), 'points', t[0][0] if t else None, '->', t[-1][0] if t else None)
