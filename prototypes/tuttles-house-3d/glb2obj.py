# Kenney .glb -> .obj/.mtl with node transforms baked in and material colours kept.
import sys, os, json, struct, glob, math
src, out = sys.argv[1], sys.argv[2]
def mat_mul(a, b): return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
def node_matrix(n):
    if "matrix" in n:
        m = n["matrix"]; return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = n.get("translation", [0, 0, 0]); q = n.get("rotation", [0, 0, 0, 1]); s = n.get("scale", [1, 1, 1])
    x, y, z, w = q
    r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]
FMT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
NUM = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
for p in sorted(glob.glob(os.path.join(src, "*.glb")) + glob.glob(os.path.join(src, "*.gltf"))):
    if p.endswith(".glb"):
        d = open(p, "rb").read(); n = struct.unpack_from("<I", d, 12)[0]; g = json.loads(d[20:20 + n]); b = d[20 + n + 8:]
    else:
        g = json.load(open(p)); b = open(os.path.join(src, os.path.basename(g["buffers"][0]["uri"])), "rb").read()
    def acc(i):
        a = g["accessors"][i]; v = g["bufferViews"][a["bufferView"]]
        k = NUM[a["type"]]; f = FMT[a["componentType"]]; size = struct.calcsize(f) * k
        stride = v.get("byteStride", size); off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        return [struct.unpack_from("<" + f * k, b, off + j * stride) for j in range(a["count"])]
    name = os.path.splitext(os.path.basename(p))[0]
    V = []; N = []; T = []; faces = {}
    def walk(i, parent):
        nd = g["nodes"][i]; m = mat_mul(parent, node_matrix(nd))
        if "mesh" in nd:
            for pr in g["meshes"][nd["mesh"]]["primitives"]:
                pos = acc(pr["attributes"]["POSITION"]); nor = acc(pr["attributes"]["NORMAL"]) if "NORMAL" in pr["attributes"] else None
                idx = [x[0] for x in acc(pr["indices"])] if "indices" in pr else list(range(len(pos)))
                base = len(V)
                uv = acc(pr["attributes"]["TEXCOORD_0"]) if "TEXCOORD_0" in pr["attributes"] else [(0, 0)] * len(pos)
                T.extend((u[0], 1 - u[1]) for u in uv)
                for q in pos: V.append([m[r][0] * q[0] + m[r][1] * q[1] + m[r][2] * q[2] + m[r][3] for r in range(3)])
                for j in range(len(pos)):
                    q = nor[j] if nor else (0, 1, 0)
                    v = [m[r][0] * q[0] + m[r][1] * q[1] + m[r][2] * q[2] for r in range(3)]
                    l = math.sqrt(sum(x * x for x in v)) or 1; N.append([x / l for x in v])
                mat = g["materials"][pr["material"]]["name"] if "material" in pr else "none"
                faces.setdefault(mat, []).extend((base + idx[k], base + idx[k + 1], base + idx[k + 2]) for k in range(0, len(idx) - 2, 3))
        for c in nd.get("children", []): walk(c, m)
    I = [[1 if i == j else 0 for j in range(4)] for i in range(4)]
    for r in g["scenes"][g.get("scene", 0)]["nodes"]: walk(r, I)
    with open(os.path.join(out, name + ".mtl"), "w") as f:
        for m in g.get("materials", []):
            c = m.get("pbrMetallicRoughness", {}).get("baseColorFactor", [0.8, 0.8, 0.8, 1])
            f.write(f"newmtl {m['name']}\nKd {c[0]:.6f} {c[1]:.6f} {c[2]:.6f}\nd {c[3]:.4f}\n")
            tex = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
            if tex is not None:
                f.write("map_Kd " + os.path.basename(g["images"][g["textures"][tex["index"]]["source"]]["uri"]) + "\n")
            f.write("\n")
    with open(os.path.join(out, name + ".obj"), "w") as f:
        f.write(f"mtllib {name}.mtl\n")
        for v in V: f.write("v %.6f %.6f %.6f\n" % tuple(v))
        for v in N: f.write("vn %.5f %.5f %.5f\n" % tuple(v))
        for v in T: f.write("vt %.6f %.6f\n" % tuple(v))
        for mat, fs in faces.items():
            f.write(f"usemtl {mat}\n")
            for a, b2, c in fs: f.write(f"f {a+1}/{a+1}/{a+1} {b2+1}/{b2+1}/{b2+1} {c+1}/{c+1}/{c+1}\n")
print("converted", len(glob.glob(os.path.join(out, "*.obj"))))
