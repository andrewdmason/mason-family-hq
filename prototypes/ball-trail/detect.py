# Per-frame small-mover candidates (camera-compensated 3-frame difference), in reference-frame coords.
import cv2, sys, json, numpy as np
v, s, e, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
thr = float(sys.argv[5]) if len(sys.argv) > 5 else 20
cap = cv2.VideoCapture(v); [cap.grab() for _ in range(s - 1)]  # sequential: exact frame numbering
frames = [cap.read()[1] for _ in range(s - 1, e + 2)]
orb = cv2.ORB_create(4000); bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
def H(a, b):
    ka, da = orb.detectAndCompute(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), None)
    kb, db = orb.detectAndCompute(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), None)
    m = bf.match(da, db)
    pa = np.float32([ka[x.queryIdx].pt for x in m]); pb = np.float32([kb[x.trainIdx].pt for x in m])
    return cv2.findHomography(pa, pb, cv2.RANSAC, 2.0)[0]
h0, w0 = frames[0].shape[:2]
sc = w0 / 1280.0; sc2 = sc * sc
g = lambda x: cv2.GaussianBlur(x, (3, 3), 0).astype(np.int16)
res = []; toref = np.eye(3); homs = {}
for k in range(1, len(frames) - 1):
    p, c, n = frames[k-1], frames[k], frames[k+1]
    hp = H(p, c); hn = H(n, c)
    pw = cv2.warpPerspective(p, hp, (w0, h0)); nw = cv2.warpPerspective(n, hn, (w0, h0))
    d = np.minimum(np.abs(g(c) - g(pw)).max(2), np.abs(g(c) - g(nw)).max(2)).astype(np.uint8)
    # big movers (people): dilate large motion and exclude
    m = (d > thr).astype(np.uint8)
    nl, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
    big = np.zeros_like(m)
    for i in range(1, nl):
        if st[i, 4] > 450 * sc2: big[lab == i] = 1
    big = cv2.dilate(big, np.ones((25, 25), np.uint8))
    if k > 1: toref = toref @ np.linalg.inv(hp)
    fi = s + k - 1; homs[fi] = toref.tolist()
    for i in range(1, nl):
        a = st[i, 4]; bw, bh = st[i, 2], st[i, 3]
        if 2 <= a <= 450 * sc2 and max(bw, bh) <= 80 * sc and not big[int(cen[i][1]), int(cen[i][0])]:
            x, y = cen[i]
            r = toref @ np.array([x, y, 1.0]); r = r[:2] / r[2]
            res.append(dict(f=fi, x=float(x), y=float(y), rx=float(r[0]), ry=float(r[1]), a=int(a),
                            peak=int(d[lab == i].max())))
json.dump(dict(cands=res, homs=homs, w=w0, h=h0), open(out, "w"))
ref = frames[1] // 3
for c in res:
    col = cv2.applyColorMap(np.uint8([[int((c['f'] - s) * 255 / max(1, e - s))]]), cv2.COLORMAP_TURBO)[0, 0].tolist()
    cv2.circle(ref, (int(c['rx']), int(c['ry'])), 3, col, -1)
cv2.imwrite(out.replace('.json', '.png'), ref)
print(len(res), "candidates")
