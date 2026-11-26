// Draws the lower-level figures that todo.json describes in prose, and writes diagrams-lower.json.
// Run: node_modules/.bin/tsx --tsconfig scripts/tsconfig.json scripts/math/source/draw-lower.mts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diagramProblems, type Diagram, type DiagramItem } from "../bank.mts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const todo = JSON.parse(fs.readFileSync(path.join(dir, "out/todo.json"), "utf8")) as {
  diagram: { id: string; level: string; description: string }[];
};
const bank = JSON.parse(fs.readFileSync(path.join(dir, "out/math-lower.json"), "utf8")) as {
  questions: { id: string; prompt: string }[];
};
const prompts = new Map(bank.questions.map((q) => [q.id, q.prompt]));

const r1 = (v: number) => Math.round(v * 10) / 10;
const P = (x: number, y: number): [number, number] => [r1(x), r1(y)];
const text = (s: string, x: number, y: number, anchor: "c" | "l" | "r" = "c", size: "s" | "m" | "l" = "m"): DiagramItem => ({ t: "text", at: P(x, y), s, size, anchor });
const poly = (pts: [number, number][], fill: "none" | "light" | "accent" = "none"): DiagramItem => ({ t: "poly", pts, closed: true, fill });
const line = (a: [number, number], b: [number, number], arrow: "none" | "end" = "none"): DiagramItem => ({ t: "line", a, b, dash: false, arrow });
const fig = (h: number, items: DiagramItem[]): Diagram => ({ w: 100, h: Math.max(40, Math.ceil(h)), items });

/** A flat rectangle, "length" across and "width" up, to scale. */
function rectangle(long: number, wide: number): Diagram {
  const s = Math.min(66 / long, 48 / wide);
  const w = long * s;
  const hh = wide * s;
  const h = Math.max(40, Math.ceil(hh + 20));
  const x0 = 54 - w / 2;
  const y0 = (h - 4) / 2 - hh / 2;
  return fig(h, [
    poly([P(x0, y0), P(x0 + w, y0), P(x0 + w, y0 + hh), P(x0, y0 + hh)], "light"),
    text(`${long} cm`, x0 + w / 2, y0 + hh + 4.5),
    text(`${wide} cm`, x0 - 2.5, y0 + hh / 2, "r"),
  ]);
}

/** A rectangle W by H with an nw by nh rectangle cut from its top-right corner. */
function lShape(W: number, H: number, nw: number, nh: number): Diagram {
  const s = Math.min(60 / W, 52 / H);
  const x0 = 53 - (W * s) / 2;
  const top = 8;
  const xn = x0 + (W - nw) * s;
  const yn = top + nh * s;
  const right = x0 + W * s;
  const bottom = top + H * s;
  return fig(bottom + 10, [
    poly([P(x0, top), P(xn, top), P(xn, yn), P(right, yn), P(right, bottom), P(x0, bottom)], "light"),
    text(String(W), x0 + (W * s) / 2, bottom + 4.5),
    text(String(H), x0 - 2.5, top + (H * s) / 2, "r"),
    // The cut's width sits above its flat edge (in the gap); its height sits beside its upright edge (in the shape).
    text(String(nw), xn + (nw * s) / 2, yn - 3.5),
    text(String(nh), xn - 2.5, top + (nh * s) / 2, "r"),
  ]);
}

/** A box seen from the front and a little above: length across, height up, width going back at 45° (drawn half length). */
function box(L: number, Wd: number, T: number): Diagram {
  const k = 0.5 * Math.SQRT1_2;
  const s = Math.min(56 / (L + k * Wd), 44 / (T + k * Wd), 9);
  const d = k * Wd * s;
  const fw = L * s;
  const fh = T * s;
  const x0 = 50 - (fw + d) / 2 + 3;
  const ft = 8 + d;
  const yb = ft + fh;
  return fig(yb + 10, [
    poly([P(x0, ft), P(x0 + fw, ft), P(x0 + fw, yb), P(x0, yb)], "light"),
    poly([P(x0, ft), P(x0 + d, ft - d), P(x0 + fw + d, ft - d), P(x0 + fw, ft)]),
    poly([P(x0 + fw, ft), P(x0 + fw + d, ft - d), P(x0 + fw + d, yb - d), P(x0 + fw, yb)]),
    text(`${L} cm`, x0 + fw / 2, yb + 4.5),
    text(`${T} cm`, x0 - 2.5, ft + fh / 2, "r"),
    text(`${Wd} cm`, x0 + fw + d / 2 + 2.5, yb - d / 2 + 2.5, "l"),
  ]);
}

/** Squares in rows, the first n shaded, read like a page. */
function shadedGrid(rows: number, cols: number, n: number): Diagram {
  const c = Math.min(12, 80 / cols, 60 / rows);
  const h = Math.max(40, Math.ceil(rows * c + 16));
  const x0 = 50 - (cols * c) / 2;
  const y0 = h / 2 - (rows * c) / 2;
  const items: DiagramItem[] = [];
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const x = x0 + q * c;
      const y = y0 + r * c;
      items.push(poly([P(x, y), P(x + c, y), P(x + c, y + c), P(x, y + c)], r * cols + q < n ? "accent" : "none"));
    }
  return fig(h, items);
}

/** Two overlapping circles with a number in each of the three regions. */
function venn(left: number, both: number, right: number): Diagram {
  const cy = 33;
  return fig(56, [
    { t: "circle", c: P(39, cy), r: 17, fill: "light" },
    { t: "circle", c: P(61, cy), r: 17, fill: "light" },
    text("Soccer", 30, 8),
    text("Basketball", 70, 8),
    text(String(left), 31, cy),
    text(String(both), 50, cy),
    text(String(right), 69, cy),
  ]);
}

/** A clock face showing an exact hour. */
function clock(hour: number): Diagram {
  const cx = 50;
  const cy = 34;
  const R = 26;
  const at = (r: number, deg: number) => P(cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180));
  const items: DiagramItem[] = [{ t: "circle", c: P(cx, cy), r: R, fill: "none" }];
  for (let n = 1; n <= 12; n++) {
    const [x, y] = at(21, n * 30);
    items.push(text(String(n), x, y));
  }
  items.push(line(P(cx, cy), at(15.5, 0), "end")); // the minute hand, on the 12
  items.push(line(P(cx, cy), at(10.5, hour * 30), "end")); // the hour hand
  items.push({ t: "dot", at: P(cx, cy) });
  return fig(68, items);
}

function draw(desc: string): Diagram | string {
  let m: RegExpMatchArray | null;
  if ((m = desc.match(/^Rectangle labeled (\d+) cm on the long side and (\d+) cm on the short side\.$/))) return rectangle(+m[1], +m[2]);
  if ((m = desc.match(/^L-shaped polygon: a rectangle (\d+) units wide and (\d+) units tall with a (\d+)-unit-wide by (\d+)-unit-tall rectangle removed from the top-right corner\./)))
    return lShape(+m[1], +m[2], +m[3], +m[4]);
  if ((m = desc.match(/^Rectangular prism labeled length (\d+) cm, width (\d+) cm, height (\d+) cm\.$/))) return box(+m[1], +m[2], +m[3]);
  if ((m = desc.match(/^Number line from 0 to 1 with (\d+) evenly spaced interior tick marks; point P marked at tick (\d+)\.$/))) {
    const parts = +m[1] + 1;
    return fig(40, [{ t: "numberLine", y: 22, x0: 12, x1: 88, min: 0, max: 1, step: 1 / parts, labels: "ends", points: [{ v: +m[2] / parts, label: "P" }] }]);
  }
  if ((m = desc.match(/^Grid of (\d+) rows × (\d+) columns of equal squares; shade the first (\d+) squares/))) return shadedGrid(+m[1], +m[2], +m[3]);
  if ((m = desc.match(/^Two overlapping circles labeled Soccer and Basketball; overlap region labeled (\d+); Soccer-only region (\d+); Basketball-only region (\d+)\.$/)))
    return venn(+m[2], +m[1], +m[3]);
  if ((m = desc.match(/^Analog clock showing (\d+):00\.$/))) return clock(+m[1]);
  if ((m = desc.match(/^Vertical bar graph titled 'Books Read'; x-axis: ([^;]+); y-axis 0–60 in steps of 5; bar heights: (.+)\.$/))) {
    const names = m[1].split(", ");
    const pairs = m[2].split(", ").map((p) => p.split("="));
    if (pairs.length !== names.length || pairs.some((p, i) => p[0] !== names[i])) return "bar names and heights do not line up";
    return fig(76, [{ t: "bars", x: 13, y: 10, w: 80, h: 56, max: 60, step: 5, labels: names, values: pairs.map((p) => +p[1]), title: "Books Read", ylabel: null }]);
  }
  return "no rule for this description";
}

const diagrams: Record<string, Diagram> = {};
const problems: Record<string, string> = {};
let complaints = 0;
for (const entry of todo.diagram.filter((d) => d.level === "lower")) {
  const made = draw(entry.description);
  if (typeof made === "string") {
    problems[entry.id] = made;
    continue;
  }
  if (!prompts.has(entry.id)) console.log(`${entry.id}: not in math-lower.json`);
  const { errors, warnings } = diagramProblems(made);
  for (const e of [...errors, ...warnings]) {
    complaints++;
    console.log(`${entry.id}: ${e}`);
  }
  diagrams[entry.id] = made;
}
fs.writeFileSync(path.join(dir, "diagrams-lower.json"), JSON.stringify({ diagrams, problems }, null, 1) + "\n");
console.log(`${Object.keys(diagrams).length} drawn, ${Object.keys(problems).length} problems, ${complaints} validation complaints`);
