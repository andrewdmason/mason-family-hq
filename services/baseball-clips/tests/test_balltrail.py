"""
Fast checks of the ball-trail geometry on synthetic data (no video needed).

  ./.venv/bin/python -m unittest tests/test_balltrail.py
"""
import os
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from balltrail import ball, camera, field, flight  # noqa: E402

W, H = 1280, 720


def look_at(C, target, f):
    """A level camera at C looking at target (world z up)."""
    fwd = np.asarray(target, float) - C
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 0, 1.0])
    right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    R = np.array([right, down, fwd])  # rows: camera axes in world coords => world -> camera
    return camera.Camera(f, R, np.asarray(C, float), W, H)


class CameraFromFoulLines(unittest.TestCase):
    def test_recovers_a_behind_home_camera(self):
        true = look_at([-7.0, -5.5, 2.5], [18, 18, 0], 915.0)
        home = true.project(np.zeros((1, 3)))[0]
        p1 = true.project(np.array([[20.0, 0, 0]]))[0]
        p3 = true.project(np.array([[0, 20.0, 0]]))[0]
        d1 = (p1 - home) / np.linalg.norm(p1 - home)
        d3 = (p3 - home) / np.linalg.norm(p3 - home)
        cam = camera.from_foul_lines(home, d3, d1, 915.0, W, H, cam_height=2.5)
        self.assertIsNotNone(cam)
        np.testing.assert_allclose(cam.C, true.C, atol=0.05)
        pts = np.array([[21.3, 0, 0], [0, 21.3, 0], [15, 15, 0], [40, 60, 10]])
        np.testing.assert_allclose(cam.project(pts), true.project(pts), atol=0.5)


class FlightFit(unittest.TestCase):
    def test_fits_and_lands_a_synthetic_fly_ball(self):
        true = look_at([-7.0, -5.5, 2.5], [18, 18, 0], 915.0)
        v = 30.0 * np.array([np.cos(np.radians(18)) * np.cos(np.radians(50)),
                             np.cos(np.radians(18)) * np.sin(np.radians(50)), np.sin(np.radians(18))])
        p0 = flight.CONTACT
        tc = 5.0
        t = tc + np.arange(4, 16) / 30.0
        px = true.project(flight.positions(p0, v, t - tc)) + np.random.default_rng(1).normal(0, 0.7, (len(t), 2))
        unit = true.scaled(1 / true.C[2])
        r = flight.fit(unit, t, px, tc + 0.03, 0.15)
        self.assertIsNotNone(r)
        self.assertLess(r.rms, 1.5)
        t_land, _ = r.land()
        t_true, _ = flight.landing(p0, v)
        self.assertLess(abs(t_land - (tc + t_true)), 0.25)
        self.assertLess(abs(r.exit_mph - np.linalg.norm(v) * 2.237), 12)


class ArcModel(unittest.TestCase):
    def test_projective_arc_is_exact_for_a_projected_parabola(self):
        cam = look_at([-7.0, -5.5, 2.5], [18, 18, 0], 915.0)
        t = np.arange(12) / 30.0
        P = np.c_[0.3 + 15 * t, 0.3 + 17 * t, 1 + 8 * t - 4.9 * t * t]
        px = cam.project(P)
        _, fn, rms = ball.fit_arc(t, px[:, 0], px[:, 1])
        self.assertLess(rms, 0.05)


class FoulLinesOnASyntheticField(unittest.TestCase):
    def test_finds_home_where_painted_lines_meet(self):
        img = np.full((H, W, 3), (70, 110, 170), np.uint8)  # dirt
        img[:300] = (60, 150, 60)                            # grass beyond
        rng = np.random.default_rng(0)
        img = np.clip(img.astype(int) + rng.normal(0, 6, img.shape), 0, 255).astype(np.uint8)
        home = np.array([700.0, 560.0])
        for d in (np.array([-0.97, -0.24]), np.array([0.94, -0.34])):
            q = home + d * 2000
            cv2.line(img, tuple(np.int32(home)), tuple(np.int32(q)), (235, 235, 235), 4, cv2.LINE_AA)
        # the catcher and umpire hide home plate
        cv2.rectangle(img, (650, 470), (800, 720), (40, 40, 40), -1)
        fl = field.find_foul_lines(img)
        self.assertIsNotNone(fl)
        self.assertLess(np.hypot(*(fl.home - home)), 6)


if __name__ == "__main__":
    unittest.main()
