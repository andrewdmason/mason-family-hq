"""
3D flight of the batted ball: gravity + quadratic air drag, launched from the
hitting zone over home plate, fitted to the ball's image positions through a
calibrated camera, then flown on to the ground.

The camera's angles come from the field; its distance (the scale of the
world) is fitted here along with the flight, because a ball falls at 9.8 m/s²
whatever the camera — so how fast its image path bends tells how far away it
is. A loose prior on camera height (backstop/fence cameras sit 2–5 m up)
keeps short tracks from wandering.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

from .camera import FT, Camera

G = 9.81
# quadratic drag, per metre: 0.5 * rho * Cd * A / m for a baseball
KD = 0.5 * 1.2 * 0.35 * 0.0042 / 0.145
DT = 1 / 240.0
CONTACT = np.array([0.35, 0.35, 0.85])   # typical hitting point: just in front of the plate, belt high
EXIT_MU, EXIT_SIG = 28.0, 0.25           # exit speed prior: ~63 mph (log-normal), 12–14U hit balls
CAM_H = 2.7                             # prior camera height, m (log-normal): backstop mounts ~9 ft


def positions(p0, v0, t: np.ndarray) -> np.ndarray:
    """Ball positions at times t (s since contact, t >= 0), continuing below ground if asked."""
    t = np.asarray(t, float)
    tmax = max(float(np.max(t)), DT) + 2 * DT
    n = int(tmax / DT) + 2
    out = [None] * n
    x, y, z = (float(c) for c in p0)
    vx, vy, vz = (float(c) for c in v0)
    out[0] = (x, y, z)
    h = DT / 2
    for i in range(1, n):  # midpoint (RK2) steps, plain floats: this runs inside the optimiser
        s = KD * (vx * vx + vy * vy + vz * vz) ** 0.5
        mx, my, mz = vx - s * vx * h, vy - s * vy * h, vz - (G + s * vz) * h
        s = KD * (mx * mx + my * my + mz * mz) ** 0.5
        x, y, z = x + mx * DT, y + my * DT, z + mz * DT
        vx, vy, vz = vx - s * mx * DT, vy - s * my * DT, vz - (G + s * mz) * DT
        out[i] = (x, y, z)
    P = np.array(out)
    idx = np.clip(t, 0, None) / DT
    i0 = np.clip(np.floor(idx).astype(int), 0, n - 2)
    w = (idx - i0)[:, None]
    return P[i0] * (1 - w) + P[i0 + 1] * w


def landing(p0, v0, t_max: float = 8.0) -> tuple[float, np.ndarray]:
    """(seconds after contact, world point) where the ball reaches the ground."""
    t = np.arange(0, t_max, DT)
    P = positions(p0, v0, t)
    below = np.where((P[:, 2] <= 0) & (t > 0.05))[0]
    if len(below) == 0:
        return t_max, P[-1]
    i = below[0]
    z0, z1 = P[i - 1, 2], P[i, 2]
    f = z0 / (z0 - z1) if z0 != z1 else 0.0
    return float(t[i - 1] + f * DT), P[i - 1] + (P[i] - P[i - 1]) * f


@dataclass
class FlightFit:
    cam: Camera          # scaled to metres
    p0: np.ndarray       # contact point, world m
    v0: np.ndarray       # launch velocity, m/s
    tc: float            # contact time, clip seconds
    rms: float           # image residual, px
    resid: np.ndarray    # per point, px
    cost: float

    @property
    def exit_mph(self) -> float:
        return float(np.linalg.norm(self.v0) * 2.23694)

    @property
    def launch_deg(self) -> float:
        return float(np.degrees(np.arcsin(self.v0[2] / np.linalg.norm(self.v0))))

    def land(self) -> tuple[float, np.ndarray]:
        dt, P = landing(self.p0, self.v0)
        return self.tc + dt, P

    @property
    def carry_ft(self) -> float:
        _, P = self.land()
        return float(np.hypot(P[0], P[1]) / FT)

    def image(self, t: np.ndarray) -> np.ndarray:
        """Ball pixels (reference frame) at clip times t."""
        return self.cam.project(positions(self.p0, self.v0, np.asarray(t, float) - self.tc))


def fit(cam_unit: Camera, t: np.ndarray, px: np.ndarray, tc0: float, tc_slack: float,
        w: np.ndarray | None = None, cam_h_prior: tuple[float, float] = (CAM_H, 0.3),
        sigma_px: float = 2.0) -> FlightFit | None:
    """Fit launch velocity, contact time/point and the world scale to ball pixels px at clip times t.

    cam_unit: the camera at height 1 m (angles right, scale free)."""
    t = np.asarray(t, float)
    px = np.asarray(px, float)
    w = np.ones(len(t)) if w is None else np.asarray(w, float)
    h_mu, h_sig = cam_h_prior

    def unpack(q):
        vx, vy, vz, dtc, lh, cx, cy, cz = q
        return np.array([vx, vy, vz]), tc0 + dtc, np.exp(lh), np.array([cx, cy, cz])

    def make_resid(sel):
        ts, ps, ws = t[sel], px[sel], w[sel]

        def resid(q):
            v, tc, h, c = unpack(q)
            cam = cam_unit.scaled(h)
            P = positions(c, v, ts - tc)
            r = (cam.project(P) - ps) * ws[:, None] / sigma_px
            r = np.nan_to_num(r, nan=100.0)
            prior = [
                (np.log(h) - np.log(h_mu)) / h_sig,
                (c[0] - CONTACT[0]) / 0.35, (c[1] - CONTACT[1]) / 0.35, (c[2] - CONTACT[2]) / 0.25,
                # youth exit speeds: a short, far-away track can't tell 50 from 90 mph on
                # its own (that's mostly speed straight away from the camera)
                np.log(max(np.linalg.norm(v), 1.0) / EXIT_MU) / EXIT_SIG,
            ]
            return np.r_[r.ravel(), prior]
        return resid

    lo_tc = -tc_slack
    hi_tc = min(tc_slack, float(t.min() - tc0) - 0.005)
    if hi_tc <= lo_tc:
        hi_tc = lo_tc + 0.01
    bounds = ([-15, -15, -20, lo_tc, np.log(0.8), -1.5, -1.5, 0.1], [70, 70, 60, hi_tc, np.log(25), 2.0, 2.0, 2.0])
    # many starts on the first stretch of flight (cheap), then the best one on everything
    first = np.argsort(t)[:14]
    r0 = make_resid(first)
    best = None
    for az in np.radians([15, 40, 65]):          # spray direction between the foul lines
        for el in np.radians([10, 32]):
            for sp in (26.0, 36.0):
                v = sp * np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)])
                q0 = np.r_[v, np.clip(0.0, lo_tc + 1e-3, hi_tc - 1e-3), np.log(h_mu), CONTACT]
                try:
                    r = least_squares(r0, q0, method="trf", max_nfev=60, loss="soft_l1", bounds=bounds)
                except ValueError:
                    continue
                if best is None or r.cost < best.cost:
                    best = r
    if best is None:
        return None
    if len(t) > len(first):
        best = least_squares(make_resid(np.arange(len(t))), best.x, method="trf", max_nfev=150,
                             loss="soft_l1", bounds=bounds)
    v, tc, h, c = unpack(best.x)
    cam = cam_unit.scaled(h)
    P = positions(c, v, t - tc)
    e = np.hypot(*(cam.project(P) - px).T)
    e = np.nan_to_num(e, nan=999.0)
    return FlightFit(cam, c, v, tc, float(np.sqrt(np.mean(e ** 2))), e, float(best.cost))
