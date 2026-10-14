import cv2, sys, numpy as np
# usage: sheet.py video start_frame end_frame step cols width out [x0 y0 x1 y1 crop]
v, s, e, st, cols, w, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), sys.argv[7]
crop = list(map(int, sys.argv[8:12])) if len(sys.argv) > 8 else None
cap = cv2.VideoCapture(v); [cap.grab() for _ in range(s)]
tiles = []; i = s
while i <= e:
    ok, f = cap.read()
    if not ok: break
    if (i - s) % st == 0:
        if crop: f = f[crop[1]:crop[3], crop[0]:crop[2]]
        h = int(f.shape[0] * w / f.shape[1]); f = cv2.resize(f, (w, h))
        cv2.putText(f, str(i), (5, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        tiles.append(f)
    i += 1
while len(tiles) % cols: tiles.append(np.zeros_like(tiles[0]))
rows = [np.hstack(tiles[r:r+cols]) for r in range(0, len(tiles), cols)]
cv2.imwrite(out, np.vstack(rows))
print(len(tiles), cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT))
