# Show camera-compensated 3-frame difference (amplified) as a contact sheet; the ball pops as a bright dot.
import cv2, sys, numpy as np
v, s, e, cols, w, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
x0, y0, x1, y1 = map(int, sys.argv[7:11])
cap = cv2.VideoCapture(v); [cap.grab() for _ in range(s - 1)]
fr = [cap.read()[1] for _ in range(s - 1, e + 2)]
orb = cv2.ORB_create(4000); bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
def H(a, b):
    ka, da = orb.detectAndCompute(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), None)
    kb, db = orb.detectAndCompute(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), None)
    m = bf.match(da, db)
    return cv2.findHomography(np.float32([ka[x.queryIdx].pt for x in m]), np.float32([kb[x.trainIdx].pt for x in m]), cv2.RANSAC, 2.0)[0]
tiles = []
for k in range(1, len(fr) - 1):
    p, c, n = fr[k-1], fr[k], fr[k+1]; h, wd = c.shape[:2]
    pw = cv2.warpPerspective(p, H(p, c), (wd, h)); nw = cv2.warpPerspective(n, H(n, c), (wd, h))
    d = np.minimum(np.abs(c.astype(int) - pw).max(2), np.abs(c.astype(int) - nw).max(2))
    d = np.clip(d * 4, 0, 255).astype(np.uint8)[y0:y1, x0:x1]
    img = c[y0:y1, x0:x1] // 2; img[..., 2] = np.maximum(img[..., 2], d); img[..., 1] = np.maximum(img[..., 1], d)
    hh = int(img.shape[0] * w / img.shape[1]); img = cv2.resize(img, (w, hh), interpolation=cv2.INTER_NEAREST)
    cv2.putText(img, str(s + k - 1), (5, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2); tiles.append(img)
while len(tiles) % cols: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(out, np.vstack([np.hstack(tiles[r:r+cols]) for r in range(0, len(tiles), cols)]))
