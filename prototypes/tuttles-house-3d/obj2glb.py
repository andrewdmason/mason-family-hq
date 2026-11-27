# Quaternius .obj/.mtl -> .glb the app's loader (MathGLB.swift) reads: one mesh,
# a primitive per material (named as the pack names them: Wood, Metal, Glass...),
# positions and normals. The pack has no texture coordinates; the app lays its
# own textures on by box projection.
#
#   python3 obj2glb.py <folder of .obj> <folder for .glb>
import sys, os, json, struct, glob
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
n_out = 0
for p in sorted(glob.glob(os.path.join(src, "*.obj"))):
    name = os.path.splitext(os.path.basename(p))[0]
    kd = {}
    cur = None
    mtl = os.path.join(src, name + ".mtl")
    if os.path.exists(mtl):
        for line in open(mtl, errors="replace"):
            f = line.split()
            if not f: continue
            if f[0] == "newmtl": cur = line.split(None, 1)[1].strip()
            elif f[0] == "Kd" and cur: kd[cur] = [float(x) for x in f[1:4]]
    V = []; N = []; groups = {}; order = []; cur = "none"
    for line in open(p, errors="replace"):
        f = line.split()
        if not f: continue
        if f[0] == "v": V.append(tuple(float(x) for x in f[1:4]))
        elif f[0] == "vn": N.append(tuple(float(x) for x in f[1:4]))
        elif f[0] == "usemtl":
            cur = line.split(None, 1)[1].strip()
        elif f[0] == "f":
            cs = []
            for c in f[1:]:
                ix = c.split("/")
                vi = int(ix[0]); vi = vi - 1 if vi > 0 else len(V) + vi
                ni = None
                if len(ix) > 2 and ix[2]:
                    ni = int(ix[2]); ni = ni - 1 if ni > 0 else len(N) + ni
                cs.append((vi, ni))
            if len(cs) < 3: continue
            a, b, c = V[cs[0][0]], V[cs[1][0]], V[cs[2][0]]
            u = [b[i] - a[i] for i in range(3)]; w = [c[i] - a[i] for i in range(3)]
            fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
            l = (fn[0] ** 2 + fn[1] ** 2 + fn[2] ** 2) ** 0.5 or 1
            fn = tuple(x / l for x in fn)
            if cur not in groups: groups[cur] = ([], []); order.append(cur)
            P, Q = groups[cur]
            for i in range(1, len(cs) - 1):
                for vi, ni in (cs[0], cs[i], cs[i + 1]):
                    P.append(V[vi]); Q.append(N[ni] if ni is not None else fn)
    bin_ = bytearray(); views = []; accessors = []; prims = []; materials = []
    for m in order:
        P, Q = groups[m]
        for data, is_pos in ((P, True), (Q, False)):
            off = len(bin_)
            for v in data: bin_ += struct.pack("<3f", *v)
            views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data) * 12, "target": 34962})
            a = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(data), "type": "VEC3"}
            if is_pos:
                a["min"] = [min(v[i] for v in data) for i in range(3)]; a["max"] = [max(v[i] for v in data) for i in range(3)]
            accessors.append(a)
        c = kd.get(m, [0.8, 0.8, 0.8])
        materials.append({"name": m, "pbrMetallicRoughness": {"baseColorFactor": c + [1.0], "metallicFactor": 0, "roughnessFactor": 1}})
        prims.append({"attributes": {"POSITION": len(accessors) - 2, "NORMAL": len(accessors) - 1}, "material": len(materials) - 1, "mode": 4})
    g = {"asset": {"version": "2.0", "generator": "obj2glb.py"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"name": name, "mesh": 0}],
         "meshes": [{"name": name, "primitives": prims}], "materials": materials, "accessors": accessors, "bufferViews": views,
         "buffers": [{"byteLength": len(bin_)}]}
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4); bin_ += b"\0" * (-len(bin_) % 4)
    with open(os.path.join(out, name + ".glb"), "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bin_)
    n_out += 1
print("wrote", n_out, "models to", out)
