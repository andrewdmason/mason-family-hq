"""
Tracing a batted ball through a GameChanger field view (docs/clips-ball-trail.md).

  1. Skim the kept stretch at low resolution: follow the camera, find home plate
     (where the foul lines meet), and list the swings — sharp bursts of motion
     around home plate.
  2. For each swing (most convincing first), look closely at full resolution:
     ball candidates after contact, the best ball-like track, followed for as
     long as it's visible.
  3. Calibrate the camera from the foul lines and the far edge of the grass,
     fit a 3D gravity+drag flight to the ball, and fly it to the ground.
  4. Emit trail JSON v1 — or say `needs_tap` when any of that isn't convincing.
     A trail on the wrong object is worse than no trail.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field as dfield

import cv2
import numpy as np

from . import ball, camera, field, flight, video

SKIM_W = 640               # skim (and camera-motion fallback) width
SAMPLE_EVERY = 60         # frames between field (home plate) detections while skimming
BEFORE_S, AFTER_S = 0.4, 4.6   # full-resolution window around a swing
TRAIL_AFTER_LAND_S = 1.0   # homographies run on this long after the landing
MAX_SWINGS = 6


@dataclass
class Skim:
    idx: np.ndarray            # decode index of each skimmed frame
    times: np.ndarray          # seconds
    gray: list                 # 640-wide gray frames
    valid: np.ndarray          # real video (not a title card)
    steps: list                # 640px homography frame k -> k+1 (None across cuts)
    to_seg: list               # 640px homography frame k -> first frame of its segment
    seg: np.ndarray            # segment id per frame
    homes: dict = dfield(default_factory=dict)   # frame -> FoulLines (640px) where detected
    energy: np.ndarray | None = None


@dataclass
class Look:
    """The close look at one swing."""
    k_contact: int             # skim index of the reference (contact estimate) frame
    idx0: int                  # decode index of the first full-res frame
    times: np.ndarray
    frames: list
    to_ref: list               # full-res: frame -> reference frame
    ref: int                   # reference frame (local index)
    home: np.ndarray | None
    lines: field.FoulLines | None
    tracks: list
    track: list | None         # chosen ball points (Cands), followed
    score: float


def _log(dbg: dict, key: str, val) -> None:
    if dbg is not None:
        dbg[key] = val


# ------------------------------------------------------------------ skim

def skim(clip: video.Clip, t0: float, t1: float) -> Skim:
    size = (SKIM_W, int(round(clip.height * SKIM_W / clip.width)))
    cap = cv2.VideoCapture(clip.path)
    idx, times, gray, color = [], [], [], {}
    all_t = []
    i = 0
    while True:
        if not cap.grab():
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        all_t.append(t)
        if t > t1:
            break
        if t >= t0:
            ok, img = cap.retrieve()
            if not ok:
                break
            img = cv2.resize(img, size, interpolation=cv2.INTER_AREA)
            if len(gray) % SAMPLE_EVERY == SAMPLE_EVERY // 2:
                color[len(gray)] = img
            idx.append(i)
            times.append(t)
            gray.append(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        i += 1
    cap.release()
    clip.times = np.array(all_t)   # every frame's time up to the end of the stretch (fps stays the file's average)
    n = len(gray)
    # GameChanger clips open with a black title card
    valid = np.array([(g.mean() > 35 and g.std() > 25) for g in gray], bool)
    steps = []
    for k in range(n - 1):
        s = None
        if valid[k] and valid[k + 1]:
            s = video.frame_homography(gray[k], gray[k + 1])
            if s is None:
                # a cut, or a frame too blurred to match: keep going if they still line up
                d = cv2.absdiff(gray[k], gray[k + 1]).mean()
                s = np.eye(3) if d < 12 else None
        steps.append(s)
    seg = np.zeros(n, int)
    sid = 0
    for k in range(1, n):
        if steps[k - 1] is None:
            sid += 1
        seg[k] = sid
    to_seg = [np.eye(3) for _ in range(n)]
    for k in range(1, n):
        if seg[k] == seg[k - 1]:
            to_seg[k] = to_seg[k - 1] @ np.linalg.inv(steps[k - 1])
    sk = Skim(np.array(idx), np.array(times), gray, valid, steps, to_seg, seg)
    for k, img in color.items():
        if valid[k]:
            fl = field.find_foul_lines(img)
            if fl is not None:
                sk.homes[k] = fl
    return sk


def _map(Hm: np.ndarray, p: np.ndarray) -> np.ndarray:
    q = Hm @ [p[0], p[1], 1.0]
    return q[:2] / q[2]


def home_at(sk: Skim, k: int) -> np.ndarray | None:
    """Home plate (640px) in skim frame k, carried from the nearest detection in its segment."""
    same = [j for j in sk.homes if sk.seg[j] == sk.seg[k]]
    if not same:
        return None
    j = min(same, key=lambda j: abs(j - k))
    # j -> segment start -> k
    return _map(np.linalg.inv(sk.to_seg[k]) @ sk.to_seg[j], sk.homes[j].home)


def swing_energy(sk: Skim) -> tuple[np.ndarray, np.ndarray]:
    """Per frame, the share of moving pixels (camera-compensated) in the box around
    home plate where the batter swings, and everywhere else (fielders running)."""
    n = len(sk.gray)
    en, rest = np.zeros(n), np.zeros(n)
    H, W = sk.gray[0].shape
    for k in range(1, n):
        if not sk.valid[k] or sk.steps[k - 1] is None:
            continue
        h = home_at(sk, k)
        if h is None:
            continue
        prev = cv2.warpPerspective(sk.gray[k - 1], sk.steps[k - 1], (W, H), borderMode=cv2.BORDER_REPLICATE)
        moving = cv2.absdiff(cv2.GaussianBlur(sk.gray[k], (3, 3), 0), cv2.GaussianBlur(prev, (3, 3), 0)) > 25
        x0, x1 = int(max(0, h[0] - 115)), int(min(W, h[0] + 115))
        y0, y1 = int(max(0, h[1] - 150)), int(min(H, h[1] + 15))
        if x1 - x0 < 40 or y1 - y0 < 40:
            continue
        box = moving[y0:y1, x0:x1]
        en[k] = box.mean()
        rest[k] = (moving.sum() - box.sum()) / max(1, moving.size - box.size)
    return en, rest


def swings(sk: Skim, en: np.ndarray, rest: np.ndarray, fps: float) -> list[tuple[int, float]]:
    """(contact frame estimate, score) for each swing-like burst, most convincing first.

    A swing is a sharp burst of motion at the plate. A swing that put the ball in
    play is followed by the whole field moving (fielders chasing, runners going),
    so bursts are ranked by that too — which also outranks the pitcher's delivery
    and the catcher's catch."""
    s = np.convolve(en, np.ones(3) / 3, mode="same")
    r = np.convolve(rest, np.ones(5) / 5, mode="same")
    out = []
    n = len(s)
    one = max(1, int(round(fps)))
    for k in range(8, n - 4):
        if s[k] <= 0 or s[k] < s[max(0, k - 6):k + 7].max():
            continue
        lo = max(0, k - 35)
        base_win = s[lo:max(lo + 1, k - 6)]
        base_win = base_win[base_win > 0]
        if len(base_win) < 5:
            continue
        b = float(np.percentile(base_win, 30))
        if s[k] < 1.8 * b or s[k] - b < 0.01:
            continue
        # contact comes as the bat comes through: the end of the burst's peak
        c = k + 2
        while c + 1 < n and s[c + 1] > 0.75 * s[k] and c < k + 5:
            c += 1
        c = min(c, n - 1)
        before = r[max(0, c - 2 * one):max(1, c - one // 3)]
        after = r[c + one // 2:c + 3 * one]
        lift = (float(np.mean(after)) + 1e-4) / (float(np.mean(before)) + 1e-4) if len(after) and len(before) else 1.0
        out.append((c, float(min(s[k] / max(b, 1e-3), 6.0) * min(lift, 6.0))))
    out.sort(key=lambda o: -o[1])
    return out


# ------------------------------------------------------------------ close look

def read_full(clip: video.Clip, i0: int, i1: int) -> tuple[np.ndarray, list]:
    """Frames i0..i1 (decode order) at analysis size. Seeks a little before i0 and
    identifies frames by their presentation time — exact, unlike seeking by frame
    number on these files — falling back to reading from the start."""
    size = clip.size
    want = clip.times[i0:i1 + 1]
    for seek in (True, False):
        cap = cv2.VideoCapture(clip.path)
        if seek and want[0] > 2.5:
            cap.set(cv2.CAP_PROP_POS_MSEC, (want[0] - 2.0) * 1000.0)
        frames, times = [], []
        while len(frames) < len(want):
            if not cap.grab():
                break
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if t < want[0] - 5e-4:
                continue
            if abs(t - want[len(frames)]) > 5e-4:
                break  # landed past the start (or off the timeline): start over from the top
            ok, img = cap.retrieve()
            if not ok:
                break
            if (img.shape[1], img.shape[0]) != size:
                img = cv2.resize(img, size, interpolation=cv2.INTER_AREA)
            frames.append(img)
            times.append(t)
        cap.release()
        if len(frames) == len(want) or not seek:
            return np.array(times), frames
    return np.array(times), frames


def look(clip: video.Clip, sk: Skim, k_contact: int, tap_frame: int | None, tap_xy: np.ndarray | None,
         t_end: float, dbg: dict | None) -> Look:
    fps = clip.fps
    i_ref = int(sk.idx[k_contact])
    i0 = max(0, i_ref - int(round(BEFORE_S * fps)))
    i_last = int(np.searchsorted(clip.times, min(t_end, clip.times[i_ref] + AFTER_S)))
    times, frames = read_full(clip, i0, max(i_last, i_ref + 10))
    ref = i_ref - i0
    # camera motion at full resolution where the ball is searched for; the rest
    # (only needed once there's a ball to follow) at half resolution
    near = min(len(frames) - 1, ref + 50)
    steps = [_step(frames, k, full=True) for k in range(near)]
    to_ref = video.chain_to_reference(steps, ref)

    def extend() -> None:
        while len(steps) < len(frames) - 1:
            steps.append(_step(frames, len(steps), full=False))
        to_ref[:] = video.chain_to_reference(steps, ref)

    lines = field.find_foul_lines(frames[ref])
    if lines is None and ref >= 8:
        alt = field.find_foul_lines(frames[ref - 8])
        if alt is not None:
            h = _map(to_ref[ref - 8], alt.home)
            lines = field.FoulLines(h, alt.left_dir, alt.right_dir, alt.left_len, alt.right_len, alt.score)
    home = lines.home if lines is not None else None
    if home is None:
        h = home_at(sk, k_contact)
        home = None if h is None else h * (clip.size[0] / SKIM_W)

    k_hi = min(len(frames) - 2, ref + 45, near - 1)
    tracks: list[ball.Track] = []
    chosen = None
    score = 0.0
    if tap_frame is not None:
        lt = tap_frame - i0
        if 1 <= lt < near - 1:
            by = ball.candidates(frames, to_ref, range(max(1, ref - 3), min(near - 1, max(k_hi, lt + 12)) + 1))
            tap_ref = np.array(ball.to_ref(to_ref[lt], *tap_xy))
            seeded = None
            if home is not None:
                # the tracks the automatic search finds, if one goes through the tap
                for tr in ball.find_tracks(by, home, ref - 2, k_hi):
                    a = tr.arr
                    if a[0, 0] - 2 <= lt <= a[-1, 0] + 2:
                        px = np.interp(lt, a[:, 0], a[:, 1]), np.interp(lt, a[:, 0], a[:, 2])
                        if np.hypot(px[0] - tap_ref[0], px[1] - tap_ref[1]) < 25:
                            seeded = tr.pts
                            break
            if seeded is None:
                seeded = ball.seeded_track(by, lt, tap_ref, max(1, ref - 3), k_hi)
            if seeded is not None:
                extend()
                chosen = ball.follow(frames, to_ref, seeded, len(frames) - 1)
                score = float(len(seeded))
    elif home is not None:
        by = ball.candidates(frames, to_ref, range(max(1, ref - 3), k_hi + 1))
        tracks = ball.find_tracks(by, home, ref - 2, k_hi)
        if tracks:
            extend()
            chosen = ball.follow(frames, to_ref, tracks[0].pts, len(frames) - 1)
            score = tracks[0].score
    if chosen is None:
        frames = frames[: near + 1]  # nothing to draw from this look; free the rest
    return Look(k_contact, i0, times, frames, to_ref, ref, home, lines, tracks, chosen, score)


def _step(frames: list, k: int, full: bool) -> np.ndarray:
    """Camera motion frame k -> k+1 (identity if it can't be measured)."""
    if full:
        s = video.frame_homography(cv2.cvtColor(frames[k], cv2.COLOR_BGR2GRAY),
                                   cv2.cvtColor(frames[k + 1], cv2.COLOR_BGR2GRAY))
    else:
        h = int(round(frames[k].shape[0] * SKIM_W / frames[k].shape[1]))
        a = cv2.cvtColor(cv2.resize(frames[k], (SKIM_W, h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        b = cv2.cvtColor(cv2.resize(frames[k + 1], (SKIM_W, h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        s = video.frame_homography(a, b)
        s = None if s is None else video.scale_h(s, SKIM_W / frames[k].shape[1])
    return s if s is not None else np.eye(3)


# ------------------------------------------------------------------ calibration + flight

@dataclass
class Solution:
    fit: flight.FlightFit
    f: float
    grass: float | None
    horizon: float
    used: int                  # observed points used in the fit


def solve_flight(lk: Look, pts: np.ndarray, t_pts: np.ndarray, dbg: dict | None) -> Solution | None:
    """Camera (focal length scan) + flight fit to the observed ball."""
    if lk.lines is None:
        return None
    W, H = lk.frames[0].shape[1], lk.frames[0].shape[0]
    grass = field.grass_top(lk.frames[lk.ref], lk.lines.home[1] - 40)
    tc0 = float(lk.times[lk.ref])
    scan = []

    def at(f: float, tp: np.ndarray, pp: np.ndarray):
        cu = camera.from_foul_lines(lk.lines.home, lk.lines.left_dir, lk.lines.right_dir, f, W, H, 1.0)
        if cu is None:
            return None
        hy = cu.horizon_y(W / 2)
        if grass is not None and hy > grass - 4:
            return None  # the far grass would be above the horizon: impossible
        r = flight.fit(cu, tp, pp, tc0, 4.5 / 30.0)
        if r is None:
            return None
        # priors: a typical lens (~70° across), and a horizon a little above the far grass
        pr = ((np.log(f / (0.72 * W)) / 0.3) ** 2) / 2
        if grass is not None:
            pr += (((grass - hy) - 40) / 45.0) ** 2 / 2
        scan.append((round(float(f)), round(r.cost, 2), round(pr, 2), round(float(r.cam.C[2]), 2),
                     round(r.exit_mph), round(r.carry_ft)))
        return r.cost + pr, Solution(r, float(f), grass, hy, len(pp))

    def search(tp, pp):
        grid = W * np.exp(np.linspace(np.log(0.5), np.log(1.6), 7))
        res = [(f, at(f, tp, pp)) for f in grid]
        res = [(f, x) for f, x in res if x is not None]
        if not res:
            return None
        f0, b = min(res, key=lambda r: r[1][0])
        step = grid[1] / grid[0]
        for f in (f0 / step ** 0.5, f0 * step ** 0.5):
            x = at(f, tp, pp)
            if x is not None and x[0] < b[0]:
                b = x
        return b[1]

    sol = search(t_pts, pts)
    if sol is None:
        _log(dbg, "f_scan", scan)
        return None
    # a ball followed to the ground keeps being "seen" as it bounces/rolls: drop what
    # comes after the flight ends and fit again
    t_land, _ = sol.fit.land()
    keep = t_pts <= t_land + 1.5 / 30
    if keep.sum() >= 5 and keep.sum() < len(t_pts):
        again = search(t_pts[keep], pts[keep])
        if again is not None:
            sol = again
    _log(dbg, "f_scan", scan)
    return sol


# ------------------------------------------------------------------ the trail

def _norm_h(to_ref_k: np.ndarray, W: int, H: int) -> list[float]:
    """Reference-normalized -> frame-normalized homography for one frame."""
    N = np.diag([1.0 / W, 1.0 / H, 1.0])
    Hn = N @ np.linalg.inv(to_ref_k) @ np.linalg.inv(N)
    Hn = Hn / Hn[2, 2]
    return [round(float(v), 6) for v in Hn.ravel()]


def trace(path: str, trim_start: float | None = None, trim_end: float | None = None,
          tap: dict | None = None, dbg: dict | None = None) -> dict:
    """Returns {"status": "ready"|"needs_tap", "trail": {...}|None, "reason": str}."""
    t_start = time.time()
    clip = video.open_clip(path)
    t0 = max(0.0, (trim_start or 0.0) - 0.3)
    t1 = (trim_end + 0.3) if trim_end else 1e9
    if tap:
        t0 = min(t0, max(0.0, tap["t"] - 2.0))
        t1 = max(t1, tap["t"] + 1.0)
    sk = skim(clip, t0, t1)
    if dbg is not None:
        dbg["skim_s"] = round(time.time() - t_start, 2)
        dbg["frames"] = len(sk.gray)
    if len(sk.gray) < 20 or not sk.valid.any():
        return {"status": "needs_tap", "trail": None, "reason": "no usable video"}
    en, rest = swing_energy(sk)
    sw = swings(sk, en, rest, clip.fps)
    tap_frame = tap_xy = None
    if tap:
        tap_frame = int(np.argmin(np.abs(clip.times - tap["t"])))
        tap_xy = np.array([tap["x"] * clip.size[0], tap["y"] * clip.size[1]])
        # the tap is the ball shortly after contact: contact is in the second before it
        k_tap = int(np.argmin(np.abs(sk.idx - tap_frame)))
        near = [s for s in sw if k_tap - int(1.2 * clip.fps) <= s[0] <= k_tap]
        sw = sorted(near, key=lambda s: -s[0])[:1] or [(max(0, k_tap - 6), 0.0)]
    _log(dbg, "swings", [(int(sk.idx[k]), round(s, 1)) for k, s in sw[:8]])
    _log(dbg, "homes", {int(sk.idx[k]): [round(float(v), 1) for v in fl.home] for k, fl in sk.homes.items()})
    if not sw:
        return {"status": "needs_tap", "trail": None, "reason": "no swing found"}

    t_end_avail = float(clip.times[min(len(clip.times) - 1, sk.idx[-1])]) if trim_end is None else trim_end + 1.5
    best: Look | None = None
    for k, strength in sw[:MAX_SWINGS]:
        lk = look(clip, sk, k, tap_frame, tap_xy, t_end_avail, dbg)
        if dbg is not None:
            dbg.setdefault("looks", []).append({
                "contact_frame": int(sk.idx[k]), "home": None if lk.home is None else [round(float(v)) for v in lk.home],
                "tracks": [(round(t.score, 1), round(t.rms, 2), round(t.rise), len(t.pts), int(t.pts[0].k + lk.idx0)) for t in lk.tracks[:4]],
            })
        if lk.track is not None and (best is None or lk.score > best.score):
            best = lk
        if best is not None and best.score > 8:
            break
    _log(dbg, "look_s", round(time.time() - t_start, 2))
    if best is None or best.track is None:
        return {"status": "needs_tap", "trail": None, "reason": "no ball found after any swing"}
    return build(clip, sk, best, tap is not None, dbg, t_start)


def _frame_to_ref(clip: video.Clip, sk: Skim, lk: Look):
    """decode index -> homography (frame px -> reference px): the close look's own,
    carried on past its end with the skim's (half-resolution) camera motion."""
    local = {int(lk.idx0 + k): lk.to_ref[k] for k in range(len(lk.to_ref))}
    g_last = max(local)
    pos = {int(i): k for k, i in enumerate(sk.idx)}
    k_last = pos.get(g_last)
    s = clip.size[0] / SKIM_W

    def at(gi: int):
        if gi in local:
            return local[gi]
        k = pos.get(gi)
        if k is None or k_last is None or k < k_last or sk.seg[k] != sk.seg[k_last]:
            return None
        # frame gi -> segment start -> frame g_last (skim px), then on to the reference
        m = np.linalg.inv(sk.to_seg[k_last]) @ sk.to_seg[k]
        S = np.diag([s, s, 1.0])
        return local[g_last] @ (S @ m @ np.linalg.inv(S))

    return at


def build(clip: video.Clip, sk: Skim, lk: Look, tapped: bool, dbg: dict | None, t_start: float) -> dict:
    W, H = clip.size
    pts = np.array([(c.rx, c.ry) for c in lk.track], float)
    ks = np.array([c.k for c in lk.track], int)
    t_pts = lk.times[ks]
    _log(dbg, "track", [(int(k + lk.idx0), round(float(x)), round(float(y))) for k, (x, y) in zip(ks, pts)])

    # the ball-likeness of what we followed
    _, arc, arc_rms = ball.fit_arc(t_pts[:12] - t_pts[0], pts[:12, 0], pts[:12, 1])
    n_obs = len(pts)
    conf_track = min(1.0, n_obs / 10.0) * (1.0 if arc_rms < 1.5 else 0.7 if arc_rms < 3 else 0.3)
    if lk.tracks and len(lk.tracks) > 1:
        # a close runner-up on a different path is a reason for doubt
        if lk.tracks[1].score > 0.6 * lk.tracks[0].score:
            conf_track *= 0.6
    if tapped:
        conf_track = max(conf_track, 0.6)

    sol = solve_flight(lk, pts, t_pts, dbg)
    reason = ""
    stats = None
    landed = False
    conf_cal = 0.0
    if sol is not None:
        r = sol.fit
        t_land, P_land = r.land()
        e_all = np.nan_to_num(np.hypot(*(r.image(t_pts) - pts).T), nan=99.0)
        # what the camera saw past the model's landing still counts while it stays on
        # the model's path (the ball is still coming down); after that it's bouncing
        keep = (t_pts <= t_land + 1.5 / 30) | (e_all < 5)
        last = int(np.max(np.where(keep)[0])) if keep.any() else -1
        keep[: last + 1] = True
        keep[last + 1:] = False
        if keep.sum() >= 5:
            pts, t_pts, ks = pts[keep], t_pts[keep], ks[keep]
        e = np.hypot(*(r.image(t_pts) - pts).T)
        e = np.nan_to_num(e, nan=99.0)
        inl = e < 6
        in_rms = float(np.sqrt(np.mean(e[inl] ** 2))) if inl.any() else 99.0
        plausible = (keep.sum() >= 5 and 25 <= r.exit_mph <= 95 and r.carry_ft <= 320
                     and -15 <= r.launch_deg <= 75 and in_rms <= 2.5 and inl.mean() >= 0.75)
        _log(dbg, "fit", {"f": round(sol.f), "camH": round(float(r.cam.C[2]), 2), "mph": round(r.exit_mph, 1),
                          "launch": round(r.launch_deg, 1), "carry": round(r.carry_ft), "rms": round(in_rms, 2), "inliers": round(float(inl.mean()), 2),
                          "tc": round(r.tc, 3), "land_t": round(t_land, 3), "grass": sol.grass,
                          "horizon": round(sol.horizon, 1), "plausible": plausible})
        if plausible:
            conf_cal = 0.8 if sol.grass is not None else 0.5
            stats = {"exitMph": int(round(r.exit_mph)), "launchDeg": int(round(r.launch_deg)),
                     "carryFt": int(round(r.carry_ft))}
            landed = True
        else:
            reason = "flight fit implausible"
            sol = None
    else:
        reason = "no field calibration"

    times_all = clip.times
    i_ref = lk.idx0 + lk.ref
    if sol is not None:
        r = sol.fit
        tc = r.tc
        t_land, _ = r.land()
        t_last = float(t_pts[-1])
        # seen still coming down after the model has landed: the camera wins
        t_land = max(t_land, t_last)
        # frames from contact to the landing
        i_c = int(np.searchsorted(times_all, tc - 1e-6))
        i_l = int(np.searchsorted(times_all, t_land))
        i_l = max(i_l, i_c + 1)
        fr_t = times_all[i_c:min(i_l + 1, len(times_all))]
        model = r.image(fr_t)
        # pin the drawn path to what was actually seen: correction = observed - model,
        # carried to zero over 0.3 s past the last observation
        corr_obs = pts - r.image(t_pts)
        cx = np.interp(fr_t, t_pts, corr_obs[:, 0])
        cy = np.interp(fr_t, t_pts, corr_obs[:, 1])
        fade = np.clip(1 - (fr_t - t_last) / 0.3, 0, 1)
        fade[fr_t < t_pts[0]] = np.clip(1 - (t_pts[0] - fr_t[fr_t < t_pts[0]]) / 0.15, 0, 1)
        path = model + np.c_[cx * fade, cy * fade]
        contact_s = float(tc)
        land_s = float(min(t_land, fr_t[-1]))
    else:
        # no 3D: draw only what was seen, ending in the air
        i_c = int(ks[0] + lk.idx0)
        i_l = int(ks[-1] + lk.idx0)
        fr_t = times_all[i_c:i_l + 1]
        path = np.c_[np.interp(fr_t, t_pts, pts[:, 0]), np.interp(fr_t, t_pts, pts[:, 1])]
        contact_s = float(fr_t[0])
        land_s = float(fr_t[-1])

    # leave the picture: stop where the ball goes out of its own frame
    to_ref_at = _frame_to_ref(clip, sk, lk)
    keep = len(fr_t)
    for j, t in enumerate(fr_t):
        gi = int(np.searchsorted(times_all, t - 1e-6))
        Hm = to_ref_at(gi)
        if Hm is None:
            continue
        p = _map(np.linalg.inv(Hm), path[j])
        if not (-0.02 * W <= p[0] <= 1.02 * W and -0.02 * H <= p[1] <= 1.02 * H) and t > t_pts[-1]:
            keep = j
            landed = False
            break
    fr_t, path = fr_t[:max(2, keep)], path[:max(2, keep)]
    if not landed:
        land_s = float(fr_t[-1])

    conf = conf_track * (0.5 + 0.5 * conf_cal) if sol is not None else conf_track * 0.55
    _log(dbg, "confidence_parts", {"track": round(conf_track, 2), "cal": conf_cal, "arc_rms": round(arc_rms, 2)})
    status = "ready"
    if not tapped and conf < 0.5:
        status = "needs_tap"
        reason = reason or "low confidence"

    # homographies from contact to landing + 1 s
    frames_out = []
    i_a = int(np.searchsorted(times_all, contact_s - 1e-6))
    i_b = int(np.searchsorted(times_all, land_s + TRAIL_AFTER_LAND_S))
    last_h = None
    for gi in range(i_a, min(i_b + 1, len(times_all))):
        Hm = to_ref_at(gi)
        if Hm is None:
            if last_h is None:
                continue
            Hm = last_h  # past what was analysed (a cut, or the end of the kept stretch): hold the view
        last_h = Hm
        frames_out.append([round(float(times_all[gi]), 4)] + _norm_h(Hm, W, H))

    trail = {
        "version": 1,
        "source": "tap" if tapped else "auto",
        "clip": {"fps": round(float(clip.fps), 3), "width": clip.width, "height": clip.height},
        "contactS": round(contact_s, 4),
        "landS": round(float(land_s), 4),
        "landed": bool(landed),
        "confidence": round(float(conf), 2),
        "points": [[round(float(t), 4), round(float(x / W), 5), round(float(y / H), 5)] for t, (x, y) in zip(fr_t, path)],
        "frames": frames_out,
        "stats": stats,
    }
    _log(dbg, "total_s", round(time.time() - t_start, 2))
    _log(dbg, "ref_frame", int(i_ref))
    return {"status": status, "trail": trail if status == "ready" else None, "reason": reason,
            "candidate": trail}
