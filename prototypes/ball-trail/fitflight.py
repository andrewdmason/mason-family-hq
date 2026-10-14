# Fit a projected ballistic path: x=(a+bt)/(1+kt), y=(c+dt+et^2)/(1+kt)  (pinhole projection of a gravity arc).
# usage: fitflight.py det.json track.json out.json f_contact x y  f_land x y   (taps in FRAME coords of that frame)
import json, sys, numpy as np
d = json.load(open(sys.argv[1])); homs = {int(k): np.array(m) for k, m in d['homs'].items()}
tr = json.load(open(sys.argv[2])); out = sys.argv[3]
def toref(f, x, y):
    H = homs[int(np.clip(f, min(homs), max(homs)))]; p = H @ [x, y, 1]; return p[:2] / p[2]
fc, xc, yc = map(float, sys.argv[4].split(',')); fl, xl, yl = map(float, sys.argv[5].split(','))
pts = [(fc, *toref(fc, xc, yc), 20.0)] + [(f, x, y, 1.0) for f, x, y in tr] + [(fl, *toref(fl, xl, yl), 20.0)]
P = np.array(pts); t = P[:, 0] - fc; x, y, w = P[:, 1], P[:, 2], P[:, 3]
n = len(t); Z = np.zeros(n)
# unknowns: a b c d e k ;  x = a + b t - k t x ;  y = c + d t + e t^2 - k t y
A = np.vstack([np.c_[np.ones(n), t, Z, Z, Z, -t * x], np.c_[Z, Z, np.ones(n), t, t * t, -t * y]])
rhs = np.r_[x, y]; W = np.r_[w, w]
sol = np.linalg.lstsq(A * W[:, None], rhs * W, rcond=None)[0]; a, b, c, dd, e, k = sol
F = lambda tt: ((a + b * tt) / (1 + k * tt), (c + dd * tt + e * tt * tt) / (1 + k * tt))
fx, fy = F(t); print('k', k, 'resid px', np.round(np.hypot(fx - x, fy - y), 1))
ts = np.arange(fc, fl + 1); X, Y = F(ts - fc)
json.dump([[float(f), float(px), float(py)] for f, px, py in zip(ts, X, Y)], open(out, 'w'))
print('apex frame', ts[np.argmin(Y)], 'apex y', Y.min().round(1), 'end', X[-1].round(1), Y[-1].round(1))
