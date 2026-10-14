# Render one ball-trail style along a fitted path.
# usage: styles.py video det.json track.json style out.mp4 clip_start clip_end "LABEL"
import cv2, sys, json, subprocess, numpy as np
from scipy.interpolate import UnivariateSpline
from PIL import Image, ImageDraw, ImageFont

v, detp, trkp, style, out = sys.argv[1:6]
cs, ce = int(sys.argv[6]), int(sys.argv[7]); label = sys.argv[8] if len(sys.argv) > 8 else ''
FADEOUT = float(sys.argv[9]) if len(sys.argv) > 9 else 0  # >0: trail fades out in flight instead of landing
d = json.load(open(detp)); homs = {int(k): np.array(m) for k, m in d['homs'].items()}
t = np.array(json.load(open(trkp)), float); f0, f1 = t[0, 0], t[-1, 0]
sx = UnivariateSpline(t[:, 0], t[:, 1], k=3, s=len(t) * 2.0)
sy = UnivariateSpline(t[:, 0], t[:, 2], k=3, s=len(t) * 2.0)

def ref2frame(f, pts):
    H = np.linalg.inv(homs[int(np.clip(round(f), min(homs), max(homs)))])
    p = np.hstack([pts, np.ones((len(pts), 1))]) @ H.T
    return p[:, :2] / p[:, 2:]

cap = cv2.VideoCapture(v); fps = cap.get(cv2.CAP_PROP_FPS)
W, Hh = int(cap.get(3)), int(cap.get(4)); sc = W / 1280.0
[cap.grab() for _ in range(cs)]

# per-style trail length: screen distance (px @1280) and a cap in frames
TAIL = dict(smoke=(1e9, 32), shockwave2=(1e9, 10), glitch=(200, 10), ribbon=(320, 18), ice=(200, 16), confetti=(1e9, 28), speedlines=(1e9, 6), fire=(1e9, 22), sparkler=(1e9, 12), pixel=(1e9, 14), shockwave=(1e9, 12), brush=(260, 18), neon=(150, 15), strobe=(1e9, 12), lightning=(170, 15), contrail=(1e9, 26), broadcast=(220, 16))[style]

def label_overlay():
    if not label: return None
    img = Image.new('RGBA', (W, Hh), (0, 0, 0, 0)); dr = ImageDraw.Draw(img)
    font = ImageFont.truetype('/System/Library/Fonts/Avenir Next.ttc', int(30 * sc), index=1)
    x, y = int(24 * sc), int(22 * sc)
    bb = dr.textbbox((x, y), label, font=font); pad = int(12 * sc)
    dr.rounded_rectangle((bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad), radius=int(10 * sc), fill=(0, 0, 0, 150))
    dr.text((x, y), label, font=font, fill=(255, 255, 255, 255))
    a = np.asarray(img).astype(np.float32) / 255.0
    return a[..., [2, 1, 0]], a[..., 3:4]
LBL = label_overlay()

def additive(frame, layer, blur=(4, 12), gain=(1.4, 0.9)):
    glow = cv2.GaussianBlur(layer, (0, 0), blur[0] * sc) * gain[0] + cv2.GaussianBlur(layer, (0, 0), blur[1] * sc) * gain[1]
    return frame + layer * 0.9 + glow

def over(frame, color, alpha):  # alpha-composite color (BGR float) with alpha (HxW float 0..1)
    a = alpha[..., None]; return frame * (1 - a) + color * a

def draw_neon(frame, pts, u, ts, fade, on, rng):
    layer = np.zeros_like(frame)
    for i in range(len(pts) - 1):
        w = sc * (1.0 + 4.0 * (1 - u[i]) ** 1.3)
        col = np.array([255, 200, 40]) * (1 - 0.75 * u[i]) * fade
        cv2.line(layer, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), col.tolist(), max(1, int(w * 2)), cv2.LINE_AA)
    for i in range(len(pts) - 1):  # hot white core near the ball
        if u[i] > 0.45: continue
        cv2.line(layer, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), (255 * fade,) * 3, max(1, int(sc * 1.6 * (1 - u[i]))), cv2.LINE_AA)
    return additive(frame, layer, (4, 14), (1.6, 1.1))

def draw_strobe(frame, pts, u, ts, fade, on, rng):
    col = np.zeros_like(frame); a = np.zeros(frame.shape[:2], np.float32)
    ks = ts[-1] - np.arange(0, ts[-1] - ts[0] + 0.01, 2.0)[::-1]
    if len(ks) == 0: return frame
    P = ref2frame(CUR[0], np.stack([sx(ks), sy(ks)], 1)); r = max(4, int(sc * 5.5))
    for j, (k, p) in enumerate(zip(ks, P)):
        age = (ts[-1] - k); al = 0.95 * (1 - age / 13.0) * fade
        if al <= 0: continue
        m = np.zeros_like(a); cv2.circle(m, tuple(np.int32(p)), r + 1, 1.0, -1, cv2.LINE_AA)
        m = cv2.GaussianBlur(m, (0, 0), 0.8) * al
        ring = np.zeros_like(a); cv2.circle(ring, tuple(np.int32(p)), r + 2, 1.0, max(1, int(sc)), cv2.LINE_AA)
        frame = over(frame, np.full_like(frame, 30), ring * al * 0.5)       # thin dark edge so ghosts read on sky
        frame = over(frame, np.full_like(frame, [225, 245, 255]), m)       # off-white ball
    return frame

def draw_lightning(frame, pts, u, ts, fade, on, rng):
    layer = np.zeros_like(frame)
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    if seg[-1] < 4: return frame
    n = max(3, int(seg[-1] / (11 * sc)))
    s = np.linspace(0, seg[-1], n); P = np.stack([np.interp(s, seg, pts[:, 0]), np.interp(s, seg, pts[:, 1])], 1)
    tang = np.gradient(P, axis=0); nrm = np.stack([-tang[:, 1], tang[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-6
    U = np.interp(s, seg, u)
    J = P + nrm * rng.normal(0, 4.5 * sc, (n, 1)) * (0.3 + U[:, None]); J[-1] = P[-1]
    def bolt(Q, w, c):
        for i in range(len(Q) - 1):
            cv2.line(layer, tuple(np.int32(Q[i])), tuple(np.int32(Q[i + 1])), c, max(1, int(w)), cv2.LINE_AA)
    bolt(J, 2.2 * sc, (255 * fade, 200 * fade, 170 * fade))
    bolt(J, 1.0 * sc, (255 * fade,) * 3)
    for _ in range(2):  # forks
        i = rng.integers(0, max(1, n - 2)); q = [J[i]]
        dirv = (J[min(i + 1, n - 1)] - J[i]); dirv = -dirv / (np.linalg.norm(dirv) + 1e-6)
        for _ in range(3): q.append(q[-1] + (dirv + rng.normal(0, 0.8, 2)) * 7 * sc)
        bolt(np.array(q), 1.0 * sc, (255 * fade * 0.8, 170 * fade * 0.8, 150 * fade * 0.8))
    return additive(frame, layer, (3, 12), (1.4, 1.3))

def draw_contrail(frame, pts, u, ts, fade, on, rng):
    a = np.zeros(frame.shape[:2], np.float32)
    ks = np.arange(np.ceil(ts[0] * 3) / 3, ts[-1] + 0.01, 1 / 3)  # three puffs per frame for a continuous trail
    if len(ks) == 0: return frame
    P = ref2frame(CUR[0], np.stack([sx(ks), sy(ks)], 1))
    for k, p in zip(ks, P):
        age = ts[-1] - k; g = np.random.default_rng(int(k * 3))     # stable per-puff jitter
        rad = sc * (2.5 + age * 0.75) * (0.8 + 0.4 * g.random())
        op = 0.6 * max(0, 1 - age / 24) ** 1.4 * fade
        c = p + g.normal(0, 0.5 + age * 0.25, 2) * sc + [0, -age * 0.35 * sc]
        cv2.circle(a, tuple(np.int32(c)), max(1, int(rad)), op, -1, cv2.LINE_AA)
    a = np.clip(cv2.GaussianBlur(a, (0, 0), 2.5 * sc), 0, 0.85)
    return over(frame, np.full_like(frame, 248), a)

def draw_broadcast(frame, pts, u, ts, fade, on, rng):
    col = np.zeros(frame.shape, np.uint8); m = np.zeros(frame.shape[:2], np.uint8)
    for i in range(len(pts) - 1):
        al = int(255 * (1 - u[i]) ** 0.7 * fade)
        cv2.line(col, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), (40, 40, 225), max(1, int(4.5 * sc)), cv2.LINE_AA)
        cv2.line(m, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), al, max(1, int(4.5 * sc)), cv2.LINE_AA)
    frame = over(frame, col.astype(np.float32), m.astype(np.float32) / 255)
    core = np.zeros_like(m)
    for i in range(len(pts) - 1):
        cv2.line(core, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), int(230 * (1 - u[i]) * fade), max(1, int(1.4 * sc)), cv2.LINE_AA)
    frame = over(frame, np.full_like(frame, 255), core.astype(np.float32) / 255)
    if on:
        ring = np.zeros_like(m); cv2.circle(ring, tuple(np.int32(pts[-1])), int(8 * sc), 255, max(1, int(1.6 * sc)), cv2.LINE_AA)
        frame = over(frame, np.full_like(frame, 255), ring.astype(np.float32) / 255 * 0.9 * fade)
    return frame


def path_px(ks):  # ball positions at times ks, in the current frame's pixels
    return ref2frame(CUR[0], np.stack([sx(ks), sy(ks)], 1))

def emit_times(life, per_frame):
    fi = CUR[0]; lo = max(f0, fi - life); hi = min(fi, f1)
    if hi < lo: return np.array([])
    return np.arange(np.ceil(lo * per_frame) / per_frame, hi + 1e-6, 1 / per_frame)

def draw_fire(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]
    ks = emit_times(22, 4)
    if len(ks) == 0: return frame
    P = path_px(ks)
    smoke = np.zeros(frame.shape[:2], np.float32); flame = np.zeros_like(frame)
    for k, p in zip(ks, P):
        a = fi - k; g = np.random.default_rng(int(k * 4) + 11)
        for j in range(3):
            d = g.normal(0, 1, 2); jit = g.random()
            # smoke: grows, rises, thins out
            if 3 < a < 22:
                c = p + d * (1.5 + a * 0.55) * sc + [0, -a * 0.9 * sc]
                cv2.circle(smoke, tuple(np.int32(c)), max(1, int(sc * (2.5 + a * 0.55) * (0.7 + 0.6 * jit))), 0.33 * (1 - (a - 3) / 19), -1, cv2.LINE_AA)
            # flame tongues: short-lived, flicker every frame, rise a little
            if a < 10:
                fl = np.random.default_rng(int(k * 4) * 31 + j + fi * 7)
                c = p + (d * 0.9 + fl.normal(0, 0.7, 2)) * a * 0.9 * sc + [0, -a * 0.9 * sc]
                r = sc * (4.5 * (1 - a / 10) ** 0.7 + 1.0) * (0.6 + 0.8 * fl.random())
                v = a / 10
                col = (np.array([90, 210, 255]) * (1 - v / 0.4) + np.array([20, 110, 255]) * (v / 0.4)) if v < 0.4 else np.array([20, 110, 255]) * (1 - v) / 0.6 + np.array([10, 30, 160]) * (v - 0.4) / 0.6
                cv2.circle(flame, tuple(np.int32(c)), max(1, int(r)), (col * (1 - 0.5 * v)).tolist(), -1, cv2.LINE_AA)
    smoke = np.clip(cv2.GaussianBlur(smoke, (0, 0), 2.5 * sc), 0, 0.6)
    frame = over(frame, np.full_like(frame, 125), smoke)
    flame = cv2.GaussianBlur(flame, (0, 0), 1.2 * sc)
    if on: cv2.circle(flame, tuple(np.int32(pts[-1])), max(2, int(2.5 * sc)), (150, 235, 255), -1, cv2.LINE_AA)
    return additive(frame, flame * 0.85, (3, 9), (0.9, 0.6))

def draw_sparkler(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]; ks = emit_times(12, 6)
    if len(ks) == 0: return frame
    P = path_px(ks); layer = np.zeros_like(frame)
    for k, p in zip(ks, P):
        a = fi - k; g = np.random.default_rng(int(k * 6) + 5)
        for j in range(2):
            life = 6 + 6 * g.random(); vel = g.normal(0, 1, 2); vel = vel / (np.linalg.norm(vel) + 1e-6) * (2.5 + 5 * g.random()) * sc
            if a > life: continue
            grav = np.array([0, 0.35 * sc])
            pos = p + vel * a + grav * a * a; prev = p + vel * max(0, a - 1) + grav * max(0, a - 1) ** 2
            v = a / life; col = np.array([170, 235, 255]) * (1 - v) + np.array([20, 120, 255]) * v
            cv2.line(layer, tuple(np.int32(prev)), tuple(np.int32(pos)), (col * (1 - v ** 2)).tolist(), max(1, int(1.3 * sc)), cv2.LINE_AA)
    if on:
        cv2.circle(layer, tuple(np.int32(pts[-1])), max(2, int(3.5 * sc)), (255, 255, 255), -1, cv2.LINE_AA)
        for _ in range(6):  # star burst at the ball
            ang = rng.random() * 6.283; L = (4 + 8 * rng.random()) * sc
            q = pts[-1] + [np.cos(ang) * L, np.sin(ang) * L]
            cv2.line(layer, tuple(np.int32(pts[-1])), tuple(np.int32(q)), (200, 245, 255), max(1, int(sc)), cv2.LINE_AA)
    return additive(frame, layer, (2, 8), (1.3, 0.9))

def draw_pixel(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]; ks = emit_times(14, 2)
    if len(ks) == 0: return frame
    P = path_px(ks); B = int(7 * sc)
    pal = [(255, 255, 255), (80, 240, 255), (40, 170, 255), (60, 80, 245), (160, 60, 200), (200, 80, 120)]
    out_f = frame.copy(); seen = set()
    for k, p in list(zip(ks, P))[::-1]:  # newest first so the head wins
        a = fi - k; gx, gy = int(p[0] // B), int(p[1] // B)
        if (gx, gy) in seen: continue
        seen.add((gx, gy))
        idx = min(len(pal) - 1, int(a / 14 * len(pal))); sz = B if a < 9 else B // 2 + 1
        x0, y0 = gx * B + (B - sz) // 2, gy * B + (B - sz) // 2
        if a > 13: continue
        cv2.rectangle(out_f, (x0 - 1, y0 - 1), (x0 + sz, y0 + sz), (20, 20, 20), -1)
        cv2.rectangle(out_f, (x0, y0), (x0 + sz - 1, y0 + sz - 1), pal[idx], -1)
    return out_f

def draw_shockwave(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]; ks = emit_times(12, 1 / 3)  # a ring every 3 frames
    layer = np.zeros(frame.shape[:2], np.float32)
    if len(ks):
        for k, p in zip(ks, path_px(ks)):
            a = fi - k; r = (3 + a * 3.2) * sc
            cv2.circle(layer, tuple(np.int32(p)), int(r), float(max(0, 1 - a / 12)) * 0.9, max(1, int(1.8 * sc)), cv2.LINE_AA)
    for i in range(len(pts) - 1):  # faint speed streak to show direction
        cv2.line(layer, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), float((1 - u[i]) * 0.5 * fade), max(1, int(2 * sc)), cv2.LINE_AA)
    glow = cv2.GaussianBlur(layer, (0, 0), 3 * sc)
    frame = over(frame, np.full_like(frame, [255, 250, 230]), np.clip(layer + glow * 0.8, 0, 1))
    if on: cv2.circle(frame, tuple(np.int32(pts[-1])), max(2, int(3 * sc)), (255, 255, 255), -1, cv2.LINE_AA)
    return frame

def draw_brush(frame, pts, u, ts, fade, on, rng):
    if len(pts) < 3: return frame
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    tang = np.gradient(pts, axis=0); nrm = np.stack([-tang[:, 1], tang[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-6
    a = np.zeros(frame.shape[:2], np.float32)
    g = np.random.default_rng(42)  # fixed bristles so the stroke doesn't shimmer
    width = sc * 10 * np.sin(np.clip(1 - u, 0, 1) * np.pi * 0.5 + 0.15) ** 0.6
    NB = 32
    for b in range(NB):
        off = (b / (NB - 1) - 0.5) * 2; dens = 0.55 + 0.45 * g.random()
        dry = 0.35 + 0.65 * g.random() * (1 - 0.6 * abs(off))   # edge bristles run out first: feathered tail
        Q = pts + nrm * (off * width)[:, None]
        thick = max(1, int(np.ceil(2.2 * width.max() / NB * 1.6)))
        for i in range(len(Q) - 1):
            if u[i] > dry: continue
            cv2.line(a, tuple(np.int32(Q[i])), tuple(np.int32(Q[i + 1])), float(dens * fade), thick, cv2.LINE_AA)
    a = np.clip(cv2.GaussianBlur(a, (0, 0), 0.5), 0, 0.95)
    return over(frame, np.full_like(frame, [45, 30, 215]), a)

def draw_smoke(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]; ks = emit_times(32, 3)
    if len(ks) == 0: return frame
    P = path_px(ks)
    A = np.zeros(frame.shape[:2], np.float32); C = np.zeros(frame.shape[:2], np.float32)  # alpha, alpha*gray
    for k, p in zip(ks, P):
        a = fi - k; g = np.random.default_rng(int(k * 3) + 101)
        for j in range(2):
            d = g.normal(0, 1, 2); jit = g.random()
            # wisps: slow curl that grows with age, rising like warm smoke
            curl = np.array([np.sin(k * 0.7 + j * 2 + a * 0.15), np.cos(k * 0.5 + j)]) * a * 0.35
            c = p + (d * (0.6 + a * 0.3) + curl) * sc + [0, -a * 0.55 * sc]
            rad = sc * (2.0 + a * 0.6) * (0.7 + 0.6 * jit)
            op = 0.42 * max(0, 1 - a / 32) ** 1.2 * (0.6 + 0.4 * jit)
            gray = 95 + 90 * min(1, a / 32)          # darker near the ball, lighter as it disperses
            m = np.zeros_like(A); cv2.circle(m, tuple(np.int32(c)), max(1, int(rad)), op, -1, cv2.LINE_AA)
            A += m; C += m * gray
    A = cv2.GaussianBlur(A, (0, 0), 2.2 * sc); C = cv2.GaussianBlur(C, (0, 0), 2.2 * sc)
    gray = C / np.maximum(A, 1e-4); A = np.clip(A, 0, 0.8)
    frame = over(frame, np.repeat(gray[..., None], 3, 2) * np.array([0.97, 1.0, 1.03]), A)
    # a little fire at the ball: ember glow + a few sparks drifting up
    layer = np.zeros_like(frame)
    if on:
        hp = pts[-1]
        for j in range(5):
            g = np.random.default_rng(fi * 13 + j); off = g.normal(0, 1.2, 2) * sc
            cv2.circle(layer, tuple(np.int32(hp + off)), max(1, int(sc * (2.6 - j * 0.3))), (40, 140 + 20 * j, 255), -1, cv2.LINE_AA)
        cv2.circle(layer, tuple(np.int32(hp)), max(1, int(1.6 * sc)), (170, 235, 255), -1, cv2.LINE_AA)
    for k, p in zip(ks[::3], P[::3]):
        a = fi - k; g = np.random.default_rng(int(k) * 7 + 3)
        if a > 9 or g.random() < 0.4: continue
        vel = (g.normal(0, 1, 2) * 1.2 + [0, -1.2]) * sc
        q = p + vel * a; q0 = p + vel * max(0, a - 1.2); v = a / 9
        cv2.line(layer, tuple(np.int32(q0)), tuple(np.int32(q)), (np.array([60, 170, 255]) * (1 - v)).tolist(), max(1, int(sc)), cv2.LINE_AA)
    return additive(frame, layer, (2, 6), (0.9, 0.5))

def draw_shockwave2(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]; ks = emit_times(10, 1 / 4)  # a ring every 4 frames
    layer = np.zeros(frame.shape[:2], np.float32)
    for k, p in zip(ks, path_px(ks)) if len(ks) else []:
        a = fi - k; r = (3 + a * 2.6) * sc
        cv2.circle(layer, tuple(np.int32(p)), int(r), float(0.75 * max(0, 1 - a / 10) ** 1.2), max(1, int(1.5 * sc)), cv2.LINE_AA)
    frame = over(frame, np.full_like(frame, 255), np.clip(cv2.GaussianBlur(layer, (0, 0), 0.6) + cv2.GaussianBlur(layer, (0, 0), 2.5 * sc) * 0.4, 0, 1))
    if on: cv2.circle(frame, tuple(np.int32(pts[-1])), max(2, int(2.2 * sc)), (255, 255, 255), -1, cv2.LINE_AA)
    return frame

def draw_glitch(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]; g = np.random.default_rng(fi // 2)   # glitch pattern changes every other frame
    out_f = frame.copy(); H_, W_ = frame.shape[:2]
    if on:  # datamosh slices: horizontal strips near the ball shoved sideways
        hp = pts[-1]
        for _ in range(3):
            h = int((3 + 8 * g.random()) * sc); w = int((40 + 90 * g.random()) * sc)
            y0 = int(np.clip(hp[1] + g.normal(0, 14) * sc, 0, H_ - h)); x0 = int(np.clip(hp[0] - w / 2 + g.normal(0, 10) * sc, 0, W_ - w))
            dx = int(g.choice([-1, 1]) * (8 + 18 * g.random()) * sc)
            src = frame[y0:y0 + h, max(0, x0 - dx):max(0, x0 - dx) + w]
            if src.shape[1] == w: out_f[y0:y0 + h, x0:x0 + w] = src * 0.85 + np.array(g.choice([[255, 60, 60], [60, 255, 255], [255, 60, 255]])) * 0.15
    layer = np.zeros_like(frame)
    for lag, col in ((1.5, (0, 0, 255)), (3.0, (255, 255, 0)), (4.5, (255, 0, 255))):  # RGB-split ghosts of the ball
        tq = ts[-1] - lag
        if tq < f0: continue
        q = path_px(np.array([tq]))[0]
        cv2.circle(layer, tuple(np.int32(q)), max(2, int(3.5 * sc)), [c * 0.8 * fade for c in col], -1, cv2.LINE_AA)
    for i in range(0, len(pts) - 1, 3):  # pixel-sort streaks along the tail
        if u[i] > 0.8 or g.random() < 0.5: continue
        L = (10 + 30 * g.random()) * sc * (1 - u[i])
        col = [(0, 0, 255), (0, 255, 0), (255, 0, 0)][int(g.integers(0, 3))]
        y = int(pts[i][1]); x = int(pts[i][0])
        cv2.line(layer, (x, y), (int(x + L * g.choice([-1, 1])), y), [c * 0.7 * fade for c in col], max(1, int(sc)), cv2.LINE_8)
    if on: cv2.circle(layer, tuple(np.int32(pts[-1])), max(2, int(2.5 * sc)), (255, 255, 255), -1, cv2.LINE_AA)
    return out_f + layer

def draw_ribbon(frame, pts, u, ts, fade, on, rng):
    if len(pts) < 3: return frame
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    tang = np.gradient(pts, axis=0); nrm = np.stack([-tang[:, 1], tang[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-6
    phase = (seg[-1] - seg) / (40 * sc) * np.pi + CUR[0] * 0.25
    w = 7 * sc * np.cos(phase) * (1 - u) ** 0.5
    L = pts + nrm * w[:, None]; R = pts - nrm * w[:, None]
    col = np.zeros_like(frame); a = np.zeros(frame.shape[:2], np.float32)
    for i in range(len(pts) - 1):
        quad = np.int32([L[i], L[i + 1], R[i + 1], R[i]])
        front = np.cos(phase[i]) > 0; shade = 0.55 + 0.45 * abs(np.cos(phase[i]))
        c = (np.array([45, 35, 215]) if front else np.array([245, 245, 245])) * shade
        cv2.fillConvexPoly(col, quad, c.tolist(), cv2.LINE_AA); cv2.fillConvexPoly(a, quad, float(0.95 * fade * (1 - u[i] ** 3)), cv2.LINE_AA)
    return over(frame, col, a)

def draw_ice(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]; haze = np.zeros(frame.shape[:2], np.float32); layer = np.zeros_like(frame)
    for i in range(len(pts) - 1):
        cv2.line(haze, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), float(0.55 * (1 - u[i]) * fade), max(1, int(6 * sc * (1 - u[i]) + 2)), cv2.LINE_AA)
        cv2.line(layer, tuple(np.int32(pts[i])), tuple(np.int32(pts[i + 1])), (np.array([255, 245, 225]) * (1 - u[i]) ** 1.5 * fade).tolist(), max(1, int(1.6 * sc)), cv2.LINE_AA)
    frame = over(frame, np.full_like(frame, [255, 235, 200]), cv2.GaussianBlur(haze, (0, 0), 3 * sc))
    ks = emit_times(16, 2)
    for k, p in zip(ks, path_px(ks)) if len(ks) else []:
        a = fi - k; g = np.random.default_rng(int(k * 2) + 77)
        c = p + g.normal(0, 4, 2) * sc + [0, a * 0.5 * sc]   # flakes drift down
        tw = 0.5 + 0.5 * np.sin(fi * 1.3 + k * 5)             # twinkle
        L = (2 + 4 * g.random()) * sc * (1 - a / 16) * tw
        col = (np.array([255, 250, 235]) * (1 - a / 16) * fade).tolist()
        for ang in (0, np.pi / 3, 2 * np.pi / 3):            # six-pointed glint
            dv = np.array([np.cos(ang), np.sin(ang)]) * L
            cv2.line(layer, tuple(np.int32(c - dv)), tuple(np.int32(c + dv)), col, 1, cv2.LINE_AA)
    if on: cv2.circle(layer, tuple(np.int32(pts[-1])), max(2, int(2.5 * sc)), (255, 255, 240), -1, cv2.LINE_AA)
    return additive(frame, layer, (2, 7), (0.8, 0.5))

def draw_confetti(frame, pts, u, ts, fade, on, rng):
    fi = CUR[0]; ks = emit_times(28, 3)
    pal = [(60, 60, 235), (40, 200, 255), (235, 160, 40), (90, 220, 90), (220, 90, 220), (255, 255, 255)]
    for k, p in zip(ks, path_px(ks)) if len(ks) else []:
        a = fi - k; g = np.random.default_rng(int(k * 3) + 9)
        vel = g.normal(0, 1, 2) * 1.6 * sc; grav = 0.07 * sc
        c = p + vel * a + [np.sin(a * 0.5 + k) * 2.5 * sc, grav * a * a]
        spin = a * (0.3 + 0.4 * g.random()) + g.random() * 6
        w, h = 4.5 * sc, 2.4 * sc * abs(np.cos(spin)) + 0.5
        R_ = np.array([[np.cos(spin * 0.7), -np.sin(spin * 0.7)], [np.sin(spin * 0.7), np.cos(spin * 0.7)]])
        quad = (np.array([[-w, -h], [w, -h], [w, h], [-w, h]]) / 2) @ R_.T + c
        al = 1.0 if a < 20 else max(0, 1 - (a - 20) / 8)
        col = np.array(pal[int(g.integers(0, len(pal)))]) * (0.75 + 0.25 * abs(np.cos(spin)))
        if al >= 1: cv2.fillConvexPoly(frame, np.int32(quad), col.tolist(), cv2.LINE_AA)
        else:
            m = np.zeros(frame.shape[:2], np.float32); cv2.fillConvexPoly(m, np.int32(quad), al, cv2.LINE_AA)
            frame = over(frame, np.full_like(frame, col), m)
    return frame

def draw_speedlines(frame, pts, u, ts, fade, on, rng):
    if len(pts) < 2 or not on: return frame
    fi = CUR[0]; g = np.random.default_rng(fi // 2)
    hp = pts[-1]; back = pts[max(0, len(pts) - 6)]
    dvec = hp - path_px(np.array([max(f0, ts[-1] - 2)]))[0]
    if np.linalg.norm(dvec) < 0.5: dvec = hp - back
    dvec = dvec / (np.linalg.norm(dvec) + 1e-6); nvec = np.array([-dvec[1], dvec[0]])
    a = np.zeros(frame.shape[:2], np.float32)
    for _ in range(9):
        off = g.normal(0, 7) * sc; start = (4 + 10 * g.random()) * sc; L = (25 + 70 * g.random()) * sc
        p0 = hp - dvec * start + nvec * off; p1 = p0 - dvec * L
        n = 8
        for i in range(n):  # taper: thick near the ball, hairline at the end
            q0 = p0 + (p1 - p0) * i / n; q1 = p0 + (p1 - p0) * (i + 1) / n
            cv2.line(a, tuple(np.int32(q0)), tuple(np.int32(q1)), float(0.9 * (1 - i / n)), max(1, int(2.2 * sc * (1 - i / n))), cv2.LINE_AA)
    frame = over(frame, np.full_like(frame, 255), a)
    cv2.circle(frame, tuple(np.int32(hp)), max(2, int(2.6 * sc)), (255, 255, 255), -1, cv2.LINE_AA)
    return frame

DRAW = dict(smoke=draw_smoke, shockwave2=draw_shockwave2, glitch=draw_glitch, ribbon=draw_ribbon, ice=draw_ice, confetti=draw_confetti, speedlines=draw_speedlines, fire=draw_fire, sparkler=draw_sparkler, pixel=draw_pixel, shockwave=draw_shockwave, brush=draw_brush, neon=draw_neon, strobe=draw_strobe, lightning=draw_lightning, contrail=draw_contrail, broadcast=draw_broadcast)[style]
ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{Hh}', '-r', str(fps), '-i', '-',
    '-ss', str(cs / fps), '-t', str((ce - cs) / fps), '-i', v, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], stdin=subprocess.PIPE)
rng = np.random.default_rng(3); CUR = [0]
tt_all = np.linspace(f0, f1, 1200); pp_all = np.stack([sx(tt_all), sy(tt_all)], 1)
arc = np.r_[0, np.cumsum(np.hypot(*np.diff(pp_all, axis=0).T))]
for fi in range(cs, ce):
    ok, frame = cap.read()
    if not ok: break
    CUR[0] = fi; out_f = frame.astype(np.float32)
    if fi >= f0:
        head = min(fi, f1)
        ah = np.interp(head, tt_all, arc)
        tail_start = max(f0, np.interp(ah - TAIL[0] * sc, arc, tt_all), head - TAIL[1])
        fade = 1.0 if not FADEOUT else float(np.clip((f1 - head) / FADEOUT, 0, 1))
        if FADEOUT and fi > f1: fade = 0
        elif fi > f1:  # ball has landed: tail drains into the landing spot, then gone
            tail_start = min(f1, tail_start + (fi - f1) * 1.2)
            fade = max(0.0, 1 - (fi - f1) / TAIL[1])
        if fade > 0 and head > tail_start:
            n = int(max(10, (head - tail_start) * 10)); ts = np.linspace(tail_start, head, n)
            pts = ref2frame(fi, np.stack([sx(ts), sy(ts)], 1)); u = (head - ts) / max(1e-6, head - tail_start)
            out_f = DRAW(out_f, pts, u, ts, fade, fi <= f1, rng)
    if LBL is not None: out_f = out_f * (1 - LBL[1]) + LBL[0] * 255 * LBL[1]
    ff.stdin.write(np.clip(out_f, 0, 255).astype(np.uint8).tobytes())
ff.stdin.close(); ff.wait(); print('wrote', out)
