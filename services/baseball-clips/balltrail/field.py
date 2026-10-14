"""
Field geometry from one frame of a behind-home-plate GameChanger camera.

Home plate itself is almost always hidden behind the catcher and umpire, so
it is found where the two foul lines meet: long, thin, white lines running from
behind the catcher out to the left (third-base line) and right (first-base
line). Each candidate line is scored by how much of it shows white-ridge
evidence (brighter than the ground on *both* sides — an edge or a shadow
boundary doesn't count), so faint chalk on bright dirt still adds up over its
length while blotchy texture doesn't.

All image work is at 1280-wide analysis resolution.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

# Foul lines leave home between these angles above horizontal (each side).
MIN_DEG, MAX_DEG = 6.0, 58.0


@dataclass
class FoulLines:
    home: np.ndarray        # (x, y) px where the foul lines meet (the back tip of home plate)
    left_dir: np.ndarray    # unit vector from home along the third-base line (up-left)
    right_dir: np.ndarray   # unit vector from home along the first-base line (up-right)
    left_len: float         # px of the line with white-ridge support
    right_len: float
    score: float


def whiteness(img: np.ndarray) -> np.ndarray:
    """Min of B,G,R: high only for white/grey. Orange dirt and green grass are low."""
    return cv2.GaussianBlur(img.min(axis=2).astype(np.float32), (0, 0), 0.8)


def _shift(a: np.ndarray, dx: float, dy: float) -> np.ndarray:
    m = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(a, m, (a.shape[1], a.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def ridge(w: np.ndarray, u: np.ndarray, widths=(1.5, 3.0, 5.0)) -> np.ndarray:
    """Evidence of a bright line running along direction u: the pixel beats the
    ground at ±d on both sides of it (best over a few half-widths d)."""
    n = np.array([-u[1], u[0]])
    best = np.zeros_like(w)
    for d in widths:
        a = w - _shift(w, n[0] * d, n[1] * d)
        b = w - _shift(w, -n[0] * d, -n[1] * d)
        best = np.maximum(best, np.minimum(a, b))
    return best


def _ray_support(sup: np.ndarray, u: np.ndarray, pts: np.ndarray, gap: float) -> np.ndarray:
    """For each start point, how many supported pixels lie on the ray from it along u
    (skipping the first `gap` px, where the catcher and umpire stand)."""
    h, w = sup.shape
    diag = int(np.ceil(np.hypot(w, h))) + 4
    c = np.array([w / 2, h / 2])
    ang = np.degrees(np.arctan2(u[1], u[0]))
    # rotate so u points along +x, into a canvas big enough for any angle
    m = cv2.getRotationMatrix2D((float(c[0]), float(c[1])), ang, 1.0)
    m[:, 2] += [diag / 2 - c[0], diag / 2 - c[1]]
    rot = cv2.warpAffine(sup, m, (diag, diag), flags=cv2.INTER_NEAREST)
    cs = np.cumsum(rot, axis=1)
    p = (m[:, :2] @ pts.T).T + m[:, 2]
    px = np.clip(np.round(p[:, 0] + gap).astype(int), 0, diag - 1)
    py = np.clip(np.round(p[:, 1]).astype(int), 0, diag - 1)
    return cs[py, -1] - cs[py, px]


def find_foul_lines(img: np.ndarray, horizon_y: float | None = None) -> FoulLines | None:
    """Find home plate and the two foul lines, or None. Coordinates are the input's
    pixels; the search runs at 640 wide and is refined when the input is 1280 wide."""
    H, W = img.shape[:2]
    k = W / 640.0
    small = img if W == 640 else cv2.resize(img, (640, int(round(H / k))), interpolation=cv2.INTER_AREA)
    w640 = whiteness(small)
    h2, w2 = w640.shape
    sky = (horizon_y if horizon_y is not None else 0.3 * H) / k
    # coarse: quarter resolution (320 wide), 2° steps
    w320 = cv2.resize(w640, (w2 // 2, h2 // 2), interpolation=cv2.INTER_AREA)
    gx, gy = np.meshgrid(np.arange(0.2 * w2 / 2, 0.8 * w2 / 2, 2), np.arange(0.45 * h2 / 2, 1.08 * h2 / 2, 2))
    grid = np.c_[gx.ravel(), gy.ravel()]
    degs = np.arange(MIN_DEG, MAX_DEG + 0.1, 2.0)
    sl, al, sr, ar = _search(w320, grid, degs, degs, sky / 2, thr=7, widths=(0.7, 1.3, 2.0), gap=6)
    score = np.minimum(sl, sr) * 2 + (sl + sr) * 0.5
    order = np.argsort(-score)
    seeds = []
    for i in order:
        if score[i] <= 0 or len(seeds) >= 3:
            break
        if all(np.hypot(*(grid[i] - grid[j])) > 6 for j in seeds):
            seeds.append(i)
    # fine: half resolution around the best few, 0.5° steps
    best = None
    for i in seeds:
        c = grid[i] * 2
        fx, fy = np.meshgrid(np.arange(c[0] - 6, c[0] + 6.1, 1.5), np.arange(c[1] - 6, c[1] + 6.1, 1.5))
        g2 = np.c_[fx.ravel(), fy.ravel()]
        dl = np.unique(np.clip(np.arange(al[i] - 2.5, al[i] + 2.6, 0.5), MIN_DEG, MAX_DEG))
        dr = np.unique(np.clip(np.arange(ar[i] - 2.5, ar[i] + 2.6, 0.5), MIN_DEG, MAX_DEG))
        fsl, fal, fsr, far = _search(w640, g2, dl, dr, sky, thr=9, widths=(1.0, 2.0, 3.5), gap=12)
        fs = np.minimum(fsl, fsr) * 2 + (fsl + fsr) * 0.5
        j = int(np.argmax(fs))
        if best is None or fs[j] > best[0]:
            best = (fs[j], g2[j], fal[j], far[j], fsl[j], fsr[j])
    # behind home plate the two lines open up well past flat; side-on, both look nearly flat
    if best is None or min(best[4], best[5]) < 35 or best[2] + best[3] < 18:
        return None
    score_b, hb, dl_b, dr_b, lsup, rsup = best
    home = hb * k
    if W != 1280:
        a, b = np.radians(dl_b), np.radians(dr_b)
        return FoulLines(home, np.array([-np.cos(a), -np.sin(a)]), np.array([np.cos(b), -np.sin(b)]),
                         float(lsup * k), float(rsup * k), float(score_b))
    return _refine(img, home, dl_b, dr_b, float(score_b))


def _search(w, grid, degs_l, degs_r, sky, thr, widths, gap):
    """Best-supported left and right ray (angle, support) from every grid point."""
    out = []
    for side, degs in (("left", degs_l), ("right", degs_r)):
        top = np.full(len(grid), -1.0)
        arg = np.zeros(len(grid))
        for deg in degs:
            a = np.radians(deg)
            u = np.array([-np.cos(a), -np.sin(a)]) if side == "left" else np.array([np.cos(a), -np.sin(a)])
            sup = (ridge(w, u, widths=widths) > thr).astype(np.float32)
            sup[: int(sky)] = 0
            s = _ray_support(sup, u, grid, gap=gap)
            better = s > top
            top[better] = s[better]
            arg[better] = deg
        out += [top, arg]
    return out


def _refine(img: np.ndarray, home: np.ndarray, deg_l: float, deg_r: float, score: float) -> FoulLines:
    """Fit each foul line to its ridge pixels at full resolution and re-intersect."""
    w = whiteness(img)
    H, W = w.shape
    lines = []
    lens = []
    for side, deg in (("left", deg_l), ("right", deg_r)):
        a = np.radians(deg)
        u = np.array([-np.cos(a), -np.sin(a)]) if side == "left" else np.array([np.cos(a), -np.sin(a)])
        r = ridge(w, u)
        ys, xs = np.where(r > 10)
        p = np.c_[xs, ys].astype(float) - home
        along = p @ u
        across = p @ np.array([-u[1], u[0]])
        sel = (along > 30) & (np.abs(across) < 6 + along * 0.02)
        pts = np.c_[xs[sel], ys[sel]].astype(np.float32)
        if len(pts) < 20:
            lines.append((home.astype(float), u))
            lens.append(0.0)
            continue
        # robust line fit (Huber)
        vx, vy, x0, y0 = cv2.fitLine(pts, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        d = np.array([vx, vy])
        if d @ u < 0:
            d = -d
        lines.append((np.array([x0, y0], float), d))
        lens.append(float(np.ptp(pts @ d)) if len(pts) else 0.0)
    (p1, d1), (p2, d2) = lines
    # intersection p1 + s d1 = p2 + t d2
    A = np.array([d1, -d2]).T
    try:
        s, _ = np.linalg.solve(A, p2 - p1)
        h = p1 + s * d1
    except np.linalg.LinAlgError:
        h = home
    if np.hypot(*(h - home)) > 40:  # the fit wandered; keep the coarse answer
        h = home
    return FoulLines(home=h, left_dir=d1, right_dir=d2, left_len=lens[0], right_len=lens[1], score=score)


def draw(img: np.ndarray, fl: FoulLines | None) -> np.ndarray:
    vis = img.copy()
    if fl is None:
        return vis
    h = fl.home
    for d in (fl.left_dir, fl.right_dir):
        cv2.line(vis, tuple(np.int32(h)), tuple(np.int32(h + d * 1500)), (0, 0, 255), 2, cv2.LINE_AA)
    cv2.circle(vis, tuple(np.int32(h)), 8, (0, 255, 255), 2)
    return vis


def grass_top(img: np.ndarray, below: float) -> float | None:
    """Image y of the far edge of the outfield grass (the fence/tree line), searching
    upward from `below`. The horizon sits a little above it: a fence 60–110 m out,
    seen from a 2–5 m high camera, is 1–4° below eye level."""
    H, W = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    grass = ((h >= 30) & (h <= 80) & (s >= 60) & (v >= 70)).astype(np.uint8)
    grass = cv2.morphologyEx(grass, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    tops = []
    y_start = int(min(H - 1, below))
    for x in range(0, W, max(1, W // 160)):
        col = grass[: y_start + 1, x]
        ys = np.where(col > 0)[0]
        if len(ys) < 8:
            continue
        # topmost grass pixel that starts a solid run of grass below it
        run = np.convolve(col, np.ones(6, int), mode="valid")  # run[y] = grass in y..y+5
        ok = np.where(run >= 6)[0]
        if len(ok):
            tops.append(ok[0])
    if len(tops) < 30:
        return None
    return float(np.percentile(tops, 50))
