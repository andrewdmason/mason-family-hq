"""
Pinhole camera for the field: principal point at the image centre, square
pixels, no lens distortion (GameChanger's field camera is close enough).

World frame (metres): home plate (the back tip, where the foul lines meet) at
the origin, x along the first-base line, y along the third-base line, z up.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FT = 0.3048


@dataclass
class Camera:
    f: float
    R: np.ndarray   # world -> camera rotation (camera: x right, y down, z forward)
    C: np.ndarray   # camera centre in world metres
    width: int
    height: int

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.f, 0, self.width / 2], [0, self.f, self.height / 2], [0, 0, 1.0]])

    def project(self, P: np.ndarray) -> np.ndarray:
        """World points (N,3) -> pixels (N,2). Points behind the camera come back as nan."""
        P = np.atleast_2d(np.asarray(P, float))
        pc = (P - self.C) @ self.R.T
        z = pc[:, 2:3]
        out = pc[:, :2] / np.where(z > 1e-6, z, np.nan) * self.f + [self.width / 2, self.height / 2]
        return out

    def ground_point(self, px: np.ndarray) -> np.ndarray:
        """Pixels (N,2) -> where their rays meet the ground (z=0); nan above the horizon."""
        px = np.atleast_2d(np.asarray(px, float))
        d = np.c_[(px - [self.width / 2, self.height / 2]) / self.f, np.ones(len(px))] @ self.R
        s = -self.C[2] / d[:, 2]
        s = np.where(s > 0, s, np.nan)
        return self.C + d * s[:, None]

    def horizon_y(self, x: float) -> float:
        """Image y of the horizon at column x."""
        n = self.R @ np.array([0, 0, 1.0])  # world up in camera coords
        # points p on the horizon satisfy n . K^-1 [x, y, 1] = 0
        a, b, c = n
        u = (x - self.width / 2) / self.f
        return float(-(a * u + c) / b * self.f + self.height / 2)

    def scaled(self, k: float) -> "Camera":
        """The same view of a field k times bigger (camera k times farther and higher)."""
        return Camera(self.f, self.R, self.C * k, self.width, self.height)


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def from_foul_lines(home: np.ndarray, left_dir: np.ndarray, right_dir: np.ndarray, f: float,
                    width: int, height: int, cam_height: float = 2.5) -> Camera | None:
    """The camera (for focal length f, no roll) that sees the foul lines where they are.

    The first-base line's vanishing direction must lie in the plane through the
    camera centre and its image line, likewise the third-base line, and the two
    are perpendicular on the ground; requiring a level camera (no roll) leaves
    one solution up to scale, which `cam_height` fixes.
    """
    Kinv = np.linalg.inv(np.array([[f, 0, width / 2], [0, f, height / 2], [0, 0, 1.0]]))
    h = Kinv @ np.r_[home, 1]
    nR = _unit(np.cross(h, Kinv @ np.r_[home + right_dir * 100, 1]))
    nL = _unit(np.cross(h, Kinv @ np.r_[home + left_dir * 100, 1]))
    # basis of the plane perpendicular to nR
    b1 = _unit(np.cross(nR, [0, 0, 1.0]))
    b2 = np.cross(nR, b1)

    def frame(alpha: float):
        ex = np.cos(alpha) * b1 + np.sin(alpha) * b2       # world x in camera coords
        ey = np.cross(nL, ex)
        if np.linalg.norm(ey) < 1e-9:
            return None
        ey = _unit(ey)
        ez = np.cross(ex, ey)
        return ex, ey, ez

    def roll_err(alpha: float):
        fr = frame(alpha)
        if fr is None:
            return None
        ex, ey, ez = fr
        return ez[0]  # world up has no component along camera x when there's no roll

    best = None
    alphas = np.linspace(-np.pi, np.pi, 721)
    vals = [roll_err(a) for a in alphas]
    for a0, a1, v0, v1 in zip(alphas, alphas[1:], vals, vals[1:]):
        if v0 is None or v1 is None or np.sign(v0) == np.sign(v1):
            continue
        lo, hi = a0, a1
        for _ in range(50):
            mid = (lo + hi) / 2
            vm = roll_err(mid)
            if vm is None:
                break
            if np.sign(vm) == np.sign(v0):
                lo = mid
            else:
                hi = mid
        for sx in (1, -1):
            for sy in (1, -1):
                ex, ey, ez = frame((lo + hi) / 2)
                ex, ey = ex * sx, ey * sy
                ez = np.cross(ex, ey)
                # world x and y point into the picture (forward), world up points up the image
                if ex[2] <= 0 or ey[2] <= 0 or ez[1] >= 0:
                    continue
                # the vanishing points must sit on the correct sides of home
                vx = ex[:2] / ex[2] * f + [width / 2, height / 2]
                vy = ey[:2] / ey[2] * f + [width / 2, height / 2]
                if (vx - home) @ right_dir <= 0 or (vy - home) @ left_dir <= 0:
                    continue
                R = np.array([ex, ey, ez]).T  # columns: world axes in camera coords => world->camera
                ray = R.T @ _unit(h)            # direction from camera to home, world coords
                if ray[2] >= 0:
                    continue
                s = cam_height / -ray[2]
                C = -ray * s
                cand = Camera(f, R, C, width, height)
                err = np.abs(cand.project(np.zeros((1, 3)))[0] - home).max()
                if err < 1 and (best is None or err < best[0]):
                    best = (err, cand)
    return None if best is None else best[1]
