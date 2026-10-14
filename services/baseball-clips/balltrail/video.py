"""
Reading the field-view clip and following the camera.

Frames are numbered in decode order and identified by their real presentation
time (seeking by frame number is inexact on these H.264 files; seeking by time
and checking each frame's timestamp is exact). GameChanger clips are variable
frame rate, so `index / fps` drifts by a couple of frames over a few seconds,
and the phone draws against the player's real clock.

Camera motion: GameChanger's camera pans and zooms to follow the play, so
consecutive frames are related by a homography, estimated from tracked corner
features (RANSAC drops the players).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

ANALYSIS_W = 1280  # everything is analysed at this width (1080p sources are scaled down)


@dataclass
class Clip:
    path: str
    width: int          # source size
    height: int
    fps: float          # average frame rate (frames / duration)
    times: np.ndarray = field(default_factory=lambda: np.zeros(0))  # every frame's time, seconds

    @property
    def scale(self) -> float:
        """Source px -> analysis px."""
        return ANALYSIS_W / self.width

    @property
    def size(self) -> tuple[int, int]:
        """Analysis (width, height)."""
        return ANALYSIS_W, int(round(self.height * self.scale))


def open_clip(path: str) -> Clip:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError("Could not open the field view video")
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()
    return Clip(path, w, h, fps)


def frame_homography(a: np.ndarray, b: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray | None:
    """Homography mapping gray frame a's pixels onto gray frame b (same size)."""
    pts = cv2.goodFeaturesToTrack(a, maxCorners=1500, qualityLevel=0.005, minDistance=7, mask=mask, blockSize=7)
    if pts is None or len(pts) < 30:
        return None
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(a, b, pts, None, winSize=(21, 21), maxLevel=3)
    good = st.ravel() == 1
    if good.sum() < 30:
        return None
    Hm, inl = cv2.findHomography(pts[good], nxt[good], cv2.RANSAC, 1.5, maxIters=2000, confidence=0.995)
    if Hm is None or inl.sum() < 25:
        return None
    return Hm


def chain_to_reference(steps: list[np.ndarray | None], ref: int) -> list[np.ndarray]:
    """steps[k] maps frame k -> frame k+1. Returns, per frame, the map frame -> frame `ref`."""
    n = len(steps) + 1
    out = [np.eye(3) for _ in range(n)]
    for k in range(ref - 1, -1, -1):           # k -> ref = (k+1 -> ref) @ (k -> k+1)
        s = steps[k] if steps[k] is not None else np.eye(3)
        out[k] = out[k + 1] @ s
    for k in range(ref + 1, n):                # k -> ref = (k-1 -> ref) @ inv(k-1 -> k)
        s = steps[k - 1] if steps[k - 1] is not None else np.eye(3)
        out[k] = out[k - 1] @ np.linalg.inv(s)
    for k in range(n):
        out[k] = out[k] / out[k][2, 2]
    return out


def scale_h(Hm: np.ndarray, k: float) -> np.ndarray:
    """A homography estimated on images scaled by k, expressed for unscaled pixels."""
    S = np.diag([k, k, 1.0])
    return np.linalg.inv(S) @ Hm @ S
