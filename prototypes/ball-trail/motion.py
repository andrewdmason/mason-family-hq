# Accumulate camera-compensated 3-frame motion over a range into one image (ball path shows as dotted streak).
import cv2, sys, numpy as np
v, s, e, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
cap = cv2.VideoCapture(v); [cap.grab() for _ in range(s - 1)]
frames = []
for i in range(s - 1, e + 2):
    ok, f = cap.read(); frames.append(f)
orb = cv2.ORB_create(3000); bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
def H(a, b):  # homography mapping a -> b
    ga, gb = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    ka, da = orb.detectAndCompute(ga, None); kb, db = orb.detectAndCompute(gb, None)
    m = bf.match(da, db)
    pa = np.float32([ka[x.queryIdx].pt for x in m]); pb = np.float32([kb[x.trainIdx].pt for x in m])
    h, _ = cv2.findHomography(pa, pb, cv2.RANSAC, 2.0); return h
ref = frames[1]; h0, w0 = ref.shape[:2]
acc = np.zeros((h0, w0), np.float32); toref = np.eye(3)
lab = np.zeros((h0, w0), np.int32)
for k in range(1, len(frames) - 1):
    p, c, n = frames[k-1], frames[k], frames[k+1]
    pw = cv2.warpPerspective(p, H(p, c), (w0, h0)); nw = cv2.warpPerspective(n, H(n, c), (w0, h0))
    g = lambda x: cv2.GaussianBlur(x, (3, 3), 0).astype(np.int16)
    d1 = np.abs(g(c) - g(pw)).max(2); d2 = np.abs(g(c) - g(nw)).max(2)
    d = np.minimum(d1, d2).astype(np.float32)
    if k > 1: toref = toref @ np.linalg.inv(H(frames[k-1], c))  # c -> ref
    dw = cv2.warpPerspective(d, toref, (w0, h0))
    upd = dw > acc; lab[upd & (dw > 25)] = s + k - 1; acc = np.maximum(acc, dw)
vis = ref.copy() // 3
m = acc > 25
col = cv2.applyColorMap(((lab - s) * 255 // max(1, e - s)).clip(0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)
vis[m] = col[m]
cv2.imwrite(out, vis)
