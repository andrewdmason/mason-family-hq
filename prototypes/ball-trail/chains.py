# Find short, smooth, fast chains of small bright movers (ball candidates). Prints the best few.
import json, sys, numpy as np
from collections import defaultdict
d = json.load(open(sys.argv[1])); by = defaultdict(list)
for c in d['cands']:
    if c['a'] <= 40 and c['peak'] >= 25: by[c['f']].append(c)
fs = sorted(by); out = []
for f in fs:
    for a in by[f]:
        for b in by.get(f + 1, []):
            v = np.array([b['rx'] - a['rx'], b['ry'] - a['ry']]); sp = np.hypot(*v)
            if not (4 <= sp <= 40): continue
            chain = [a, b]; g = f + 1
            while True:
                p = np.array([chain[-1]['rx'], chain[-1]['ry']]) + v
                nxt = [c for c in by.get(g + 1, []) if np.hypot(c['rx'] - p[0], c['ry'] - p[1]) < 6 + 0.25 * sp]
                if not nxt: break
                c = min(nxt, key=lambda c: np.hypot(c['rx'] - p[0], c['ry'] - p[1]))
                v = np.array([c['rx'] - chain[-1]['rx'], c['ry'] - chain[-1]['ry']]); chain.append(c); g += 1
            if len(chain) >= 5:
                pk = np.mean([c['peak'] for c in chain])
                out.append((len(chain), pk, [(c['f'], round(c['rx']), round(c['ry'])) for c in chain]))
out.sort(key=lambda o: -(o[0] * o[1])); seen = set()
for o in out:
    k = o[2][0]
    if any(k[0] == s[0] and abs(k[1] - s[1]) < 10 for s in seen): continue
    seen.update(o[2]); print(o[0], round(o[1]), o[2][:12])
    if len(seen) > 60: break
