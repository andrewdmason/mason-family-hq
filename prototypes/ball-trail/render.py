# Render a flame trail along a fitted ball path.
# usage: render.py video det.json track.json style(comet|tracer) out.mp4 clip_start clip_end [end_frame_override]
import cv2, sys, json, subprocess, numpy as np
from scipy.interpolate import UnivariateSpline
v, detp, trkp, style, out = sys.argv[1:6]; cs, ce = int(sys.argv[6]), int(sys.argv[7])
d = json.load(open(detp)); homs = {int(k): np.array(m) for k, m in d['homs'].items()}
t = np.array(json.load(open(trkp)), float)
f0, f1 = t[0, 0], t[-1, 0]
# smooth fit in reference coords (camera motion removed); weight equally, smoothing ~1.5px rms
sx = UnivariateSpline(t[:, 0], t[:, 1], k=3, s=len(t) * 2.0)
sy = UnivariateSpline(t[:, 0], t[:, 2], k=3, s=len(t) * 2.0)
def ref2frame(f, pts):
    fi = int(np.clip(round(f), min(homs), max(homs)))
    Hinv = np.linalg.inv(homs[fi])
    p = np.hstack([pts, np.ones((len(pts), 1))]) @ Hinv.T
    return p[:, :2] / p[:, 2:]
cap = cv2.VideoCapture(v); fps = cap.get(cv2.CAP_PROP_FPS)
W, Hh = int(cap.get(3)), int(cap.get(4)); sc = W / 1280.0
[cap.grab() for _ in range(cs)]
ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{Hh}', '-r', str(fps), '-i', '-',
    '-ss', str(cs / fps), '-t', str((ce - cs) / fps), '-i', v, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], stdin=subprocess.PIPE)
rng = np.random.default_rng(7)
TAIL = 9.0 if style == 'comet' else 1e9   # tail length in frames (retract speed)
TAILPX = 170 * (int(cv2.VideoCapture(v).get(3)) / 1280.0)  # comet tail length on screen
FADE = 12.0
def fire_color(u):  # u: 0 at head .. 1 at tail end -> BGR float
    stops = [(0.0, (255, 255, 255)), (0.12, (170, 245, 255)), (0.35, (40, 190, 255)), (0.7, (10, 90, 240)), (1.0, (20, 20, 120))]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if u <= b:
            k = (u - a) / (b - a); return np.array(ca) * (1 - k) + np.array(cb) * k
    return np.array(stops[-1][1])
for fi in range(cs, ce):
    ok, frame = cap.read()
    if not ok: break
    if fi < f0: ff.stdin.write(frame.tobytes()); continue
    head = min(fi, f1)
    if style == 'comet':
        tt = np.linspace(f0, head, 400); pp = np.stack([sx(tt), sy(tt)], 1)
        seg = np.r_[0, np.cumsum(np.hypot(*np.diff(pp, axis=0).T))]
        back = seg[-1] - seg; idx = np.searchsorted(-back, -TAILPX)  # first sample within TAILPX of the head
        tail_start = max(f0, tt[min(idx, len(tt) - 1)], head - 14)
    else: tail_start = f0
    fade = 1.0
    if fi > f1:  # ball gone: comet tail retracts into the end point; tracer fades out slowly
        if style == 'comet': tail_start = min(f1, tail_start + (fi - f1) * 1.5)
        fade = max(0.0, 1 - (fi - f1) / (FADE if style == 'comet' else 45.0))
        if style == 'comet' and tail_start >= f1: fade = 0
    if fade <= 0 or head <= tail_start: ff.stdin.write(frame.tobytes()); continue
    n = int(max(8, (head - tail_start) * 10))
    ts = np.linspace(tail_start, head, n)
    pts = ref2frame(fi, np.stack([sx(ts), sy(ts)], 1))
    layer = np.zeros((Hh, W, 3), np.float32)
    span = max(1e-6, head - tail_start)
    for i in range(n - 1):
        u = (head - ts[i]) / span if style == 'comet' else min(1.0, (head - ts[i]) / 14.0) * 0.75 + 0.25 * (head - ts[i]) / span
        flick = 0.75 + 0.5 * rng.random()
        r = sc * (4.5 * (1 - u) ** 0.8 + 1.0) * flick
        if style == 'tracer': r = sc * (1.8 + 3.5 * max(0, 1 - (head - ts[i]) / 10)) * flick
        col = fire_color(min(1, u)) * (1 - 0.6 * u) * fade
        cv2.line(layer, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), col.tolist(), max(1, int(r * 2)), cv2.LINE_AA)
    # embers drifting off the tail
    for _ in range(int(14 * fade)):
        k = rng.integers(0, n); p = pts[k] + rng.normal(0, 5 * sc, 2) + [0, -rng.random() * 8 * sc]
        cv2.circle(layer, tuple(np.int32(p)), max(1, int(sc * 1.5)), (60 * fade, 170 * fade, 255 * fade), -1, cv2.LINE_AA)
    hp = pts[-1]
    if fi <= f1: cv2.circle(layer, tuple(np.int32(hp)), max(2, int(sc * 3)), (255, 255, 255), -1, cv2.LINE_AA)
    glow = cv2.GaussianBlur(layer, (0, 0), 4 * sc) * 1.3 + cv2.GaussianBlur(layer, (0, 0), 12 * sc) * 0.8
    comp = frame.astype(np.float32) + layer * 0.9 + glow
    ff.stdin.write(np.clip(comp, 0, 255).astype(np.uint8).tobytes())
ff.stdin.close(); ff.wait(); print('wrote', out)
