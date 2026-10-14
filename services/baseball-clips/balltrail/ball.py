"""
Finding and following the batted ball.

Candidates: camera-compensated three-frame differencing. Each frame is
compared with its neighbours warped onto it (so the panning camera cancels
out); a pixel counts as moving only if it differs from *both* neighbours, which
keeps the ball's dot and drops the ghosts it leaves behind. Big moving regions
(players, the swinging bat) are masked out with a margin; what's left — small
movers — are ball candidates, each placed in the reference frame's pixels.

Tracks: chains of candidates in reference pixels, grown from seeds near the
batter just after contact with a constant-acceleration prediction, then judged
against what a batted ball does on screen: it leaves the hitting zone, keeps
going away from home, follows a smooth projectile arc (the pinhole image of a
gravity parabola), and slows on screen as it recedes. The bat and players
can't pass all of those at once.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Cand:
    k: int          # frame (window index)
    x: float        # frame px
    y: float
    rx: float       # reference px
    ry: float
    area: int
    peak: int       # strongest difference in the blob
    elong: float    # length / width of the blob


def _warp(img: np.ndarray, Hm: np.ndarray) -> np.ndarray:
    return cv2.warpPerspective(img, Hm, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REPLICATE)


def to_ref(Hm: np.ndarray, x: float, y: float) -> tuple[float, float]:
    p = Hm @ [x, y, 1.0]
    return float(p[0] / p[2]), float(p[1] / p[2])


def candidates(frames: list[np.ndarray], to_reference: list[np.ndarray], ks, gap: int = 1,
               thr: int = 18, big_area: int = 450, max_area: int = 260) -> dict[int, list[Cand]]:
    """Small movers per frame k in ks, against frames k-gap and k+gap (a gap of 2
    keeps a slow ball near its apex from overlapping itself).
    to_reference[k] maps frame k's pixels to the reference frame's."""
    out: dict[int, list[Cand]] = {}
    blur = {}

    def b(k):
        if k not in blur:
            blur[k] = cv2.GaussianBlur(frames[k], (3, 3), 0)
        return blur[k]

    for k in ks:
        if k - gap < 0 or k + gap >= len(frames):
            continue
        c = b(k).astype(np.int16)
        inv = np.linalg.inv(to_reference[k])
        pw = _warp(b(k - gap), inv @ to_reference[k - gap]).astype(np.int16)
        nw = _warp(b(k + gap), inv @ to_reference[k + gap]).astype(np.int16)
        d = np.minimum(np.abs(c - pw).max(2), np.abs(c - nw).max(2)).astype(np.uint8)
        m = (d > thr).astype(np.uint8)
        # GameChanger's logo is burned in at the top centre and never moves with the camera
        m[: int(0.07 * m.shape[0]), int(0.37 * m.shape[1]): int(0.63 * m.shape[1])] = 0
        # moving pixels nearby: a ball is alone in the sky/grass, fragments of a player aren't
        dens = cv2.boxFilter(m.astype(np.float32), -1, (31, 31), normalize=False)
        n, lab, st, cen = cv2.connectedComponentsWithStats(m, connectivity=8)
        big = np.zeros_like(m)
        bigs = np.where(st[1:, 4] > big_area)[0] + 1
        if len(bigs):
            big = np.isin(lab, bigs).astype(np.uint8)
            big = cv2.dilate(big, np.ones((21, 21), np.uint8))
        cs = []
        for i in range(1, n):
            a = int(st[i, 4])
            if a < 3 or a > max_area:
                continue
            x, y = cen[i]
            if big[int(y), int(x)] or dens[int(y), int(x)] - a > max(12, 0.5 * a):
                continue
            bw, bh = st[i, 2], st[i, 3]
            elong = max(bw, bh) / max(1, min(bw, bh))
            x0, y0 = st[i, 0], st[i, 1]
            peak = int(d[y0:y0 + bh, x0:x0 + bw][lab[y0:y0 + bh, x0:x0 + bw] == i].max())
            rx, ry = to_ref(to_reference[k], x, y)
            cs.append(Cand(k, float(x), float(y), rx, ry, a, peak, float(elong)))
        out[k] = cs
    return out


# ---------------------------------------------------------------- arc model

def fit_arc(t: np.ndarray, x: np.ndarray, y: np.ndarray, w: np.ndarray | None = None):
    """Fit x=(a+bt)/(1+kt), y=(c+dt+et^2)/(1+kt): the pinhole image of a body under
    constant acceleration (gravity, no drag) — exact for short stretches of flight.
    Returns (params, fn, rms residual px)."""
    n = len(t)
    w = np.ones(n) if w is None else w
    Z = np.zeros(n)
    A = np.vstack([np.c_[np.ones(n), t, Z, Z, Z, -t * x], np.c_[Z, Z, np.ones(n), t, t * t, -t * y]])
    rhs = np.r_[x, y]
    W2 = np.r_[w, w]
    sol = np.linalg.lstsq(A * W2[:, None], rhs * W2, rcond=None)[0]
    a, b_, c, d, e, k = sol

    def fn(tt):
        tt = np.asarray(tt, float)
        den = 1 + k * tt
        return (a + b_ * tt) / den, (c + d * tt + e * tt * tt) / den

    fx, fy = fn(t)
    res = np.hypot(fx - x, fy - y)
    return sol, fn, float(np.sqrt(np.mean(res ** 2)))


# ---------------------------------------------------------------- tracking

def _extend(by: dict[int, list[Cand]], track: list[Cand], k_end: int, max_gap: int = 6) -> list[Cand]:
    """Grow a track forward: predict with a quadratic in time through its last points."""
    gap = 0
    k = track[-1].k
    while k < k_end and gap <= max_gap:
        k += 1
        pts = np.array([(c.k, c.rx, c.ry) for c in track[-7:]], float)
        dt = k - pts[-1, 0]
        if len(pts) >= 4:
            tt = pts[:, 0] - pts[-1, 0]
            cx = np.polyfit(tt, pts[:, 1], 2)
            cy = np.polyfit(tt, pts[:, 2], 2)
            px, py = np.polyval(cx, dt), np.polyval(cy, dt)
        else:
            v = (pts[-1, 1:] - pts[-2, 1:]) / (pts[-1, 0] - pts[-2, 0])
            px, py = pts[-1, 1:] + v * dt
        step = np.hypot(*(pts[-1, 1:] - pts[-2, 1:])) / max(1, pts[-1, 0] - pts[-2, 0])
        gate = 6 + 0.25 * step + 3 * gap
        best = None
        for c in by.get(k, []):
            dd = np.hypot(c.rx - px, c.ry - py)
            if dd < gate and (best is None or dd < best[0]):
                best = (dd, c)
        if best:
            track.append(best[1])
            gap = 0
        else:
            gap += 1
    return track


@dataclass
class Track:
    pts: list[Cand]
    score: float
    rms: float
    rise: float
    fn: object = None   # arc model in frames since the first point

    @property
    def arr(self) -> np.ndarray:
        return np.array([(c.k, c.rx, c.ry) for c in self.pts], float)


def judge(track: list[Cand], home: np.ndarray, k_contact: int) -> Track | None:
    """Is this chain a batted ball? None if not, else a scored Track."""
    if len(track) < 5:
        return None
    a = np.array([(c.k, c.rx, c.ry) for c in track], float)
    span = a[-1, 0] - a[0, 0]
    fill = len(a) / (span + 1)
    if fill < 0.5:
        return None
    t = a[:, 0] - a[0, 0]
    _, fn, rms = fit_arc(t, a[:, 1], a[:, 2])
    if rms > 3.0:
        return None
    dist = np.hypot(a[:, 1] - home[0], a[:, 2] - home[1])
    # leaves home: farther at the end than at the start, by a real margin
    if dist[-1] - dist[0] < 40:
        return None
    # on-screen speed (per frame) must be ball-like and must not grow (it recedes)
    v = np.hypot(np.diff(a[:, 1]), np.diff(a[:, 2])) / np.diff(a[:, 0])
    if np.median(v) < 2.0 or np.max(v) > 90:
        return None
    v0, v1 = np.median(v[: max(2, len(v) // 3)]), np.median(v[-max(2, len(v) // 3):])
    if v1 > 1.6 * v0 + 2:
        return None
    rise = float(a[0, 2] - a[:, 2].min())
    # a ball in the air climbs on screen first (grounders are left to a tap)
    if rise < 30 or a[min(3, len(a) - 1), 2] >= a[0, 2]:
        return None
    # extrapolate back to contact: the arc should come from the hitting zone
    bx, by = fn(np.array([k_contact - a[0, 0]], float))
    back = float(np.hypot(bx[0] - home[0], by[0] - home[1]))
    if not np.isfinite(back) or back > 380:
        return None
    lag = a[0, 0] - k_contact
    peak = np.mean([c.peak for c in track])
    small = np.mean([c.area for c in track])
    score = (len(a) * fill) * (1 + min(rise, 200) / 100) / (1 + rms / 1.5) / (1 + max(0, lag - 4) / 6) \
        * (1 + min(peak, 80) / 80) / (1 + max(0, small - 60) / 60)
    return Track(track, float(score), rms, rise, fn)


def find_tracks(by: dict[int, list[Cand]], home: np.ndarray, k_contact: int, k_end: int,
                seed_frames: int = 12, seed_radius: float = 330) -> list[Track]:
    """All plausible ball tracks leaving the hitting zone after contact, best first."""
    found: list[Track] = []
    seen = set()
    for k in range(k_contact, k_contact + seed_frames):
        for a in by.get(k, []):
            if np.hypot(a.rx - home[0], a.ry - home[1]) > seed_radius or a.ry > home[1] + 40:
                continue
            for g in (1, 2):
                for b in by.get(k + g, []):
                    sp = np.hypot(b.rx - a.rx, b.ry - a.ry) / g
                    if not (3 <= sp <= 80):
                        continue
                    # moving away from home
                    if np.hypot(b.rx - home[0], b.ry - home[1]) <= np.hypot(a.rx - home[0], a.ry - home[1]):
                        continue
                    tr = _extend(by, [a, b], k_end)
                    key = tuple((c.k, round(c.rx), round(c.ry)) for c in tr[:4])
                    if key in seen:
                        continue
                    seen.add(key)
                    j = judge(tr, home, k_contact)
                    if j:
                        found.append(j)
    found.sort(key=lambda t: -t.score)
    # drop near-duplicates (same points)
    out: list[Track] = []
    for t in found:
        pts = {(c.k, round(c.rx), round(c.ry)) for c in t.pts}
        if any(len(pts & {(c.k, round(c.rx), round(c.ry)) for c in o.pts}) > len(pts) // 2 for o in out):
            continue
        out.append(t)
    return out


def seeded_track(by: dict[int, list[Cand]], k_tap: int, tap_ref: np.ndarray, k_start: int, k_end: int,
                 radius: float = 30) -> list[Cand] | None:
    """A track through the tapped ball: the candidate nearest the tap, grown both ways."""
    near = [c for c in by.get(k_tap, []) if np.hypot(c.rx - tap_ref[0], c.ry - tap_ref[1]) < radius]
    best = None
    for a in sorted(near, key=lambda c: np.hypot(c.rx - tap_ref[0], c.ry - tap_ref[1]))[:3]:
        for g in (1, 2):
            for b in by.get(k_tap + g, []):
                sp = np.hypot(b.rx - a.rx, b.ry - a.ry) / g
                if not (2 <= sp <= 80):
                    continue
                fwd = _extend(by, [a, b], k_end)
                # and backwards: mirror time
                back = _extend_back(by, [b, a], k_start)
                tr = sorted({id(c): c for c in back + fwd}.values(), key=lambda c: c.k)
                t = np.array([c.k for c in tr], float)
                if len(tr) < 4:
                    continue
                _, _, rms = fit_arc(t - t[0], np.array([c.rx for c in tr]), np.array([c.ry for c in tr]))
                s = len(tr) / (1 + rms / 1.5)
                if best is None or s > best[0]:
                    best = (s, tr)
    return None if best is None else best[1]


def _extend_back(by: dict[int, list[Cand]], track: list[Cand], k_start: int, max_gap: int = 4) -> list[Cand]:
    """Grow a track backwards in time (track is in reverse time order)."""
    gap = 0
    k = track[-1].k
    while k > k_start and gap <= max_gap:
        k -= 1
        pts = np.array([(c.k, c.rx, c.ry) for c in track[-6:]], float)
        dt = k - pts[-1, 0]
        v = (pts[-1, 1:] - pts[-2, 1:]) / (pts[-1, 0] - pts[-2, 0])
        px, py = pts[-1, 1:] + v * dt
        step = np.hypot(*v)
        gate = 6 + 0.35 * step + 3 * gap
        best = None
        for c in by.get(k, []):
            dd = np.hypot(c.rx - px, c.ry - py)
            if dd < gate and (best is None or dd < best[0]):
                best = (dd, c)
        if best:
            track.append(best[1])
            gap = 0
        else:
            gap += 1
    return track


# ---------------------------------------------------------------- following a found ball

def _patch_diff(frames, to_reference, k: int, other: int, x0: int, y0: int, size: int) -> np.ndarray:
    """|frame k - frame other warped onto k| over a size×size patch at (x0, y0) of frame k."""
    T = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1.0]])
    Hm = T @ np.linalg.inv(to_reference[k]) @ to_reference[other]
    w = cv2.warpPerspective(frames[other], Hm, (size, size), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    Tc = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1.0]])
    c = cv2.warpPerspective(frames[k], Tc, (size, size), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_REPLICATE)
    return np.abs(cv2.GaussianBlur(c, (3, 3), 0).astype(np.int16) - cv2.GaussianBlur(w, (3, 3), 0).astype(np.int16)).max(2)


def follow(frames: list[np.ndarray], to_reference: list[np.ndarray], track: list[Cand], k_end: int,
           max_lost: int = 8) -> list[Cand]:
    """Keep following a found ball after the fast detector loses it — over its slow
    apex and down to the ground — by looking only near where the path says it is,
    against neighbours far enough away in time that the ball has moved off itself."""
    track = list(track)
    h, w = frames[0].shape[:2]
    size = 72
    lost = 0
    pending: list[Cand] = []
    k = track[-1].k
    k_end = min(k_end, len(frames) - 1)
    while k < k_end and lost <= max_lost:
        k += 1
        a = np.array([(c.k, c.rx, c.ry) for c in track[-20:]], float)
        pr, vel = _predict(a, k)
        if pr is None:
            break
        inv = np.linalg.inv(to_reference[k])
        p = inv @ [pr[0], pr[1], 1.0]
        fx, fy = p[0] / p[2], p[1] / p[2]
        if not (4 <= fx < w - 4 and 4 <= fy < h - 4):
            break  # left the picture
        G = int(np.clip(np.ceil(9.0 / max(vel, 0.6)), 1, 8))
        before, after = k - G, k + G
        if before < 0:
            break
        x0, y0 = int(fx) - size // 2, int(fy) - size // 2
        d1 = _patch_diff(frames, to_reference, k, before, x0, y0, size)
        if after < len(frames):
            d2 = _patch_diff(frames, to_reference, k, after, x0, y0, size)
        elif before - G >= 0:
            d2 = _patch_diff(frames, to_reference, k, before - G, x0, y0, size)
        else:
            break
        d = np.minimum(d1, d2).astype(np.uint8)
        m = (d > 14).astype(np.uint8)
        n, lab, st, cen = cv2.connectedComponentsWithStats(m, connectivity=8)
        gate = 5 + 0.4 * vel + 1.5 * min(lost, 6)
        best = None
        for i in range(1, n):
            area = st[i, 4]
            if area < 2 or area > 160:
                continue
            bx, by_ = cen[i][0] + x0, cen[i][1] + y0
            rx, ry = to_ref(to_reference[k], bx, by_)
            dd = np.hypot(rx - pr[0], ry - pr[1])
            if dd < gate and (best is None or dd < best[0]):
                pk = int(d[lab == i].max())
                best = (dd, Cand(k, float(bx), float(by_), rx, ry, int(area), pk, 1.0))
        if best and pending:
            # a re-found ball has to move like the ball, not sit still like a leaf
            step = np.hypot(best[1].rx - pending[-1].rx, best[1].ry - pending[-1].ry) / max(1, best[1].k - pending[-1].k)
            if not (0.5 * vel - 1 <= step <= 1.6 * vel + 1):
                best = None
        if best and _still_an_arc(a, best[1]):
            if lost >= 3 or pending:
                # picked up again after a gap: only believe it once it's seen
                # on three frames in a row
                pending.append(best[1])
                track.append(best[1])
                if len(pending) >= 3:
                    pending = []
            else:
                track.append(best[1])
            lost = 0
        else:
            if pending:
                del track[-len(pending):]
                pending = []
                lost = 4
            lost += 1
    if pending:
        del track[-len(pending):]
    return track


def _predict(a: np.ndarray, k: int) -> tuple[np.ndarray | None, float]:
    """Where the ball should be at frame k (reference px) and its speed (px/frame),
    from the projective arc through its recent points (quadratic when too few)."""
    t = a[:, 0] - a[-1, 0]
    dt = k - a[-1, 0]
    if len(a) >= 6:
        _, fn, _ = fit_arc(t, a[:, 1], a[:, 2])
        x, y = fn(np.array([dt, dt - 0.5, dt + 0.5]))
        if np.all(np.isfinite(x)) and np.all(np.isfinite(y)):
            return np.array([x[0], y[0]]), float(np.hypot(x[2] - x[1], y[2] - y[1]))
    deg = 2 if len(a) >= 4 else 1
    cx, cy = np.polyfit(t, a[:, 1], deg), np.polyfit(t, a[:, 2], deg)
    pr = np.array([np.polyval(cx, dt), np.polyval(cy, dt)])
    vel = np.hypot(np.polyval(np.polyder(cx), dt), np.polyval(np.polyder(cy), dt))
    return pr, float(vel)


def _still_an_arc(a: np.ndarray, c: Cand, max_rms: float = 2.2) -> bool:
    """Does the new point keep the recent path a clean projectile arc?"""
    b = np.vstack([a[-15:], [c.k, c.rx, c.ry]])
    if len(b) < 7:
        return True
    _, fn, rms = fit_arc(b[:, 0] - b[0, 0], b[:, 1], b[:, 2])
    fx, fy = fn(np.array([b[-1, 0] - b[0, 0]]))
    return rms <= max_rms and np.hypot(fx[0] - c.rx, fy[0] - c.ry) <= 2.5 * max_rms
