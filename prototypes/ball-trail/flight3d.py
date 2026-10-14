# Calibrate the camera from field landmarks, fit a 3D batted-ball flight (gravity + drag) to the
# visible image points, and integrate to the ground.  Everything in the reference frame's pixels.
# usage: flight3d.py config.json out_track.json
import json, sys, numpy as np, cv2
from scipy.optimize import least_squares

cfg = json.load(open(sys.argv[1])); out = sys.argv[2]
W, H = cfg['size']; fps = cfg['fps']; B = cfg['bases_ft']; R_ = cfg['rubber_ft']
FT = 0.3048
# world (metres): home at origin, x toward 1B, y toward 3B, z up
world = {'home': (0, 0), '1b': (B, 0), '2b': (B, B), '3b': (0, B), 'rubber': (R_ / 2 ** .5, R_ / 2 ** .5)}
names = [k for k in cfg['landmarks']]
Wp = np.array([[world[k][0] * FT, world[k][1] * FT, 0] for k in names], float)
Ip = np.array([cfg['landmarks'][k] for k in names], float)

def project(params, P3):
    f, rx, ry, rz, tx, ty, tz = params
    K = np.array([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])
    pts, _ = cv2.projectPoints(P3, np.array([rx, ry, rz]), np.array([tx, ty, tz]), K, None)
    return pts.reshape(-1, 2)

# initial pose from a homography-based solvePnP at a guessed focal length, then refine everything
best = None
for f0 in (700, 900, 1200, 1600, 2200, 3000):
    K = np.array([[f0, 0, W / 2], [0, f0, H / 2], [0, 0, 1]], float)
    ok, rv, tv = cv2.solvePnP(Wp, Ip, K, None, flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok: continue
    x0 = np.r_[f0, rv.ravel(), tv.ravel()]
    r = least_squares(lambda p: (project(p, Wp) - Ip).ravel(), x0)
    cam_z = -(cv2.Rodrigues(r.x[1:4])[0].T @ r.x[4:7])[2]
    if cam_z > 0 and (best is None or r.cost < best.cost): best = r
cam = best.x
Rm = cv2.Rodrigues(cam[1:4])[0]; C = -Rm.T @ cam[4:7]
print('focal %.0f px  camera at x=%.1f y=%.1f m, height %.1f m' % (cam[0], C[0], C[1], C[2]))
print('landmark residuals px', np.round(np.hypot(*(project(cam, Wp) - Ip).T), 1))

# batted-ball flight: start at contact (above home plate), unknown launch velocity and contact time
g = 9.81; kd = 0.5 * 1.2 * 0.35 * 0.0042 / 0.145   # quadratic drag for a baseball, per metre
def fly(v0, n_steps, dt, z0):
    p = np.array([0.3, 0.3, z0]); v = np.array(v0, float); traj = [p.copy()]
    for _ in range(n_steps):
        a = np.array([0, 0, -g]) - kd * np.linalg.norm(v) * v
        v = v + a * dt; p = p + v * dt; traj.append(p.copy())
    return np.array(traj)
obs = np.array(cfg['ball'], float)  # [frame, x, y]
SUB = 10; dt = 1 / fps / SUB
def positions(params, frames):
    vx, vy, vz, tc = params
    n = int((frames.max() - tc) * SUB) + 2
    tr = fly((vx, vy, vz), max(n, 2), dt, cfg.get('contact_height_m', 0.9))
    idx = (frames - tc) * SUB
    i0 = np.clip(np.floor(idx).astype(int), 0, len(tr) - 2); w = (idx - i0)[:, None]
    return tr[i0] * (1 - w) + tr[i0 + 1] * w
def resid(params):
    return (project(cam, positions(params, obs[:, 0])) - obs[:, 1:]).ravel()
best = None
for az in np.radians(np.arange(5, 90, 10)):          # spray direction between the foul lines
    for el in np.radians((10, 25, 40)):
        for sp in (25, 35):
            v = sp * np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)])
            r = least_squares(resid, np.r_[v, cfg['contact_frame']],
                              bounds=([-10, -10, -10, cfg['contact_frame'] - cfg.get('tc_slack', 3)], [60, 60, 50, min(obs[0, 0] - 0.2, cfg['contact_frame'] + cfg.get('tc_slack', 3))]))
            if best is None or r.cost < best.cost: best = r
vx, vy, vz, tc = best.x
print('fit residuals px', np.round(np.hypot(*resid(best.x).reshape(-1, 2).T), 1))
sp = np.linalg.norm([vx, vy, vz])
print('exit speed %.0f mph, launch angle %.0f deg, contact frame %.2f' % (sp * 2.237, np.degrees(np.arcsin(vz / sp)), tc))
# integrate to the ground
tr = fly((vx, vy, vz), int(6 * fps * SUB), dt, cfg.get('contact_height_m', 0.9))
land = np.argmax((tr[1:, 2] <= 0) & (np.arange(1, len(tr)) > SUB))
t_land = land / SUB; dist = np.hypot(*tr[land, :2]) / FT
print('hang time %.2f s, carry %.0f ft, lands at frame %.1f' % (t_land / fps, dist, tc + t_land))
frames = np.arange(np.ceil(tc), tc + t_land + 1e-6)
img = project(cam, positions(best.x, frames))
json.dump([[float(f), float(x), float(y)] for f, (x, y) in zip(frames, img)], open(out, 'w'))
print('landing pixel', np.round(img[-1]))
