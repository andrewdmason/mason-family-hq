/**
 * Draws the middle-level figures that questions.csv only describes in words,
 * and writes them to diagrams-middle.json beside this file.
 *
 *   node_modules/.bin/tsx --tsconfig scripts/tsconfig.json scripts/math/source/draw-middle.mts [preview.svg]
 *
 * Every coordinate is computed here, so lengths and angles are to scale. The
 * bank's own diagramProblems() checks each figure; with a path argument an SVG
 * contact sheet (a rough copy of MathDiagramView) is written there to look at.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diagramProblems, type Diagram, type DiagramItem } from "../bank.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
type P = [number, number];
const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (x: number, y: number): P => [r2(x), r2(y)];
const rad = (deg: number) => (deg * Math.PI) / 180;

const line = (a: P, b: P, dash = false, arrow: "none" | "end" | "both" = "none"): DiagramItem => ({ t: "line", a: pt(...a), b: pt(...b), dash, arrow });
const text = (at: P, s: string, size: "s" | "m" | "l" = "m", anchor: "c" | "l" | "r" = "c"): DiagramItem => ({ t: "text", at: pt(...at), s, size, anchor });
const poly = (pts: P[], closed = true, fill: "none" | "light" | "accent" = "none"): DiagramItem => ({ t: "poly", pts: pts.map((p) => pt(...p)), closed, fill });
const dot = (at: P): DiagramItem => ({ t: "dot", at: pt(...at) });
const fig = (h: number, items: DiagramItem[]): Diagram => ({ w: 100, h: Math.ceil(h), items });

/** A circle inscribed in a square, the four corners between them shaded. */
function inscribed(side: string): Diagram {
  const c: P = [50, 34];
  const r = 26;
  const items: DiagramItem[] = [];
  for (const a of [45, 135, 225, 315]) {
    const corner: P = [c[0] + r * Math.SQRT2 * Math.cos(rad(a)), c[1] - r * Math.SQRT2 * Math.sin(rad(a))];
    const arc: P[] = [];
    for (let d = a - 45; d <= a + 45.001; d += 7.5) arc.push([c[0] + r * Math.cos(rad(d)), c[1] - r * Math.sin(rad(d))]);
    items.push(poly([corner, ...arc], true, "accent"));
  }
  items.push(text([50, 65.5], side));
  return fig(72, items);
}

function stemLeaf(rows: [string, string][]): Diagram {
  const y = 8;
  const bottom = y + 7.5 * (rows.length + 1);
  return fig(bottom + 13, [
    { t: "table", x: 28, y, w: 44, cols: ["Stem", "Leaf"], rows },
    text([50, bottom + 6], "Key: 2 | 3 = 23", "s"),
  ]);
}

function freqTable(counts: number[]): Diagram {
  return fig(62, [{ t: "table", x: 6, y: 8, w: 88, cols: ["Number of Pets", "Number of Students"], rows: counts.map((n, i) => [String(i + 1), String(n)]) }]);
}

/** A right circular cylinder, radius and height to the same scale. */
function cylinder(r: number, h: number): Diagram {
  const u = Math.min(22 / r, 46 / h);
  const rx = r * u;
  const ry = rx * 0.35;
  const H = h * u;
  const cx = 46;
  const top = 8 + ry;
  const bot = top + H;
  const ell = (cy: number, from: number, to: number, n: number): P[] => Array.from({ length: n + 1 }, (_, i) => {
    const a = rad(from + ((to - from) * i) / n);
    return [cx + rx * Math.cos(a), cy - ry * Math.sin(a)] as P;
  });
  const items: DiagramItem[] = [poly(ell(top, 0, 360, 32).slice(0, 32), true, "light"), line([cx - rx, top], [cx - rx, bot]), line([cx + rx, top], [cx + rx, bot]), poly(ell(bot, 180, 360, 16), false)];
  const back = ell(bot, 0, 180, 8);
  for (let i = 0; i < 8; i++) items.push(line(back[i], back[i + 1], true));
  items.push(dot([cx, top]), line([cx, top], [cx + rx, top]));
  items.push(text([cx + rx * 0.5, top - (ry >= 6.5 ? 3 : 2.6)], String(r), ry >= 6.5 ? "m" : "s"));
  items.push(text([cx + rx + 4, (top + bot) / 2], String(h), "m", "l"));
  return fig(bot + ry + 8, items);
}

function circleRadius(label: string, centre: string | null): Diagram {
  const items: DiagramItem[] = [{ t: "circle", c: [50, 32], r: 24, fill: "light" }, dot([50, 32]), line([50, 32], [74, 32]), text([62, 28], label)];
  if (centre) items.push(text([46.5, 35.5], centre));
  return fig(64, items);
}

/** Two lines crossing at `deg` degrees; that angle is labelled, the one next to it is x. */
function crossing(deg: number): Diagram {
  const c: P = [50, 30];
  const at = (a: number, r: number): P => [c[0] + r * Math.cos(rad(a)), c[1] - r * Math.sin(rad(a))];
  return fig(60, [
    line(at(180, 38), at(0, 38), false, "both"),
    line(at(deg + 180, 28), at(deg, 28), false, "both"),
    { t: "arc", c, r: 10, from: 0, to: deg },
    { t: "arc", c, r: 6, from: deg, to: 180 },
    text(at(deg / 2, 16.5), `${deg}°`),
    text(at((deg + 180) / 2, 10.5), "x"),
  ]);
}

/** A right triangle with the right angle bottom-left: `v` up, `h` across. */
function rightTriangle(v: number, h: number, labels: { v: string; h: string; hyp: string }): Diagram {
  const u = Math.min(72 / h, 44 / v);
  const V = v * u;
  const Hz = h * u;
  const x0 = (100 - Hz) / 2 + 2;
  const y0 = 8;
  const A: P = [x0, y0];
  const B: P = [x0, y0 + V];
  const C: P = [x0 + Hz, y0 + V];
  const len = Math.hypot(Hz, V);
  return fig(y0 + V + 12, [
    poly([A, B, C], true, "light"),
    { t: "rightAngle", at: pt(...B), a: pt(...A), b: pt(...C) },
    text([x0 - 3, y0 + V / 2], labels.v, "m", "r"),
    text([x0 + Hz / 2, y0 + V + 5.5], labels.h),
    text([x0 + Hz / 2 + (V / len) * 5, y0 + V / 2 - (Hz / len) * 5], labels.hyp),
  ]);
}

/** Similar triangles ABC and DEF, drawn to the true ratio, the angle at B (and E) 75°. */
function similar(ab: number, bc: number, de: number, deLabel: string): Diagram {
  const k = de / ab;
  const ang = rad(75);
  const wS = Math.max(bc, ab * Math.cos(ang));
  const hS = ab * Math.sin(ang);
  const gap = 14;
  const u = Math.min((80 - gap) / ((1 + k) * wS), 56 / (k * hS));
  const total = (1 + k) * wS * u + gap;
  const base = 10 + k * hS * u;
  const items: DiagramItem[] = [];
  const tri = (x: number, s: number, names: [string, string, string], side1: string, side2: string) => {
    const B: P = [x, base];
    const C: P = [x + bc * s, base];
    const A: P = [x + ab * s * Math.cos(ang), base - ab * s * Math.sin(ang)];
    const g: P = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
    const out = (p: P, d: number): P => {
      const l = Math.hypot(p[0] - g[0], p[1] - g[1]);
      return [p[0] + ((p[0] - g[0]) / l) * d, p[1] + ((p[1] - g[1]) / l) * d];
    };
    items.push(poly([A, B, C], true, "light"));
    items.push(text(out(A, 4), names[0]), text(out(B, 4.2), names[1]), text(out(C, 4.2), names[2]));
    // AB's label sits to the left of its midpoint, BC's below its midpoint.
    items.push(text([(A[0] + B[0]) / 2 - 2.5, (A[1] + B[1]) / 2 - 0.5], side1, "m", "r"));
    items.push(text([(B[0] + C[0]) / 2, base + 5], side2));
  };
  const left = (100 - total) / 2 + 2;
  tri(left, u, ["A", "B", "C"], String(ab), String(bc));
  tri(left + wS * u + gap, u * k, ["D", "E", "F"], deLabel, "?");
  return fig(base + 12, items);
}

/** Three corners of a rectangle on a square grid just big enough to hold all four. */
function gridPoints(points: P[]): Diagram {
  const reach = Math.max(5, ...points.flat().map((v) => Math.abs(v) + 1));
  return fig(80, [{ t: "grid", x: 16, y: 6, w: 68, h: 68, xmin: -reach, xmax: reach, ymin: -reach, ymax: reach, points: points.map((p) => ({ p })), segments: [] }]);
}

/** Two points and the line through them, on a grid with square cells. */
function gridLine(a: P, b: P): Diagram {
  const xmin = Math.min(0, a[0], b[0]) - 1;
  const xmax = Math.max(0, a[0], b[0]) + 1;
  const ymin = Math.min(0, a[1], b[1]) - 1;
  const ymax = Math.max(0, a[1], b[1]) + 1;
  const cell = Math.min(68 / (ymax - ymin), 84 / (xmax - xmin));
  const w = r2(cell * (xmax - xmin));
  const h = r2(cell * (ymax - ymin));
  const m = (b[1] - a[1]) / (b[0] - a[0]);
  const yAt = (x: number) => a[1] + m * (x - a[0]);
  const xAt = (y: number) => a[0] + (y - a[1]) / m;
  // The line, cut off where it leaves the grid.
  const ends: P[] = [];
  for (const x of [xmin, xmax]) if (yAt(x) >= ymin && yAt(x) <= ymax) ends.push([x, yAt(x)]);
  for (const y of [ymin, ymax]) if (xAt(y) > xmin && xAt(y) < xmax) ends.push([xAt(y), y]);
  ends.sort((p, q) => p[0] - q[0]);
  return fig(h + 12, [{ t: "grid", x: r2((100 - w) / 2), y: 6, w, h, xmin, xmax, ymin, ymax, points: [{ p: a }, { p: b }], segments: [[pt(...ends[0]), pt(...ends[ends.length - 1])]] }]);
}

/** A box-and-whisker plot over a number line ticked at every whole number. `hide` leaves one value unlabelled. */
function boxPlot(five: [number, number, number, number, number], lo: number, hi: number, hide: number | null): Diagram {
  const x0 = 9;
  const x1 = 91;
  const x = (v: number) => x0 + ((x1 - x0) * (v - lo)) / (hi - lo);
  const [mn, q1, med, q3, mx] = five;
  const top = 15;
  const bot = 27;
  const mid = (top + bot) / 2;
  const labels: number[] = [];
  for (let v = Math.ceil(lo / 5) * 5; v <= hi; v += 5) labels.push(v);
  const items: DiagramItem[] = [
    poly([[x(q1), top], [x(q3), top], [x(q3), bot], [x(q1), bot]], true, "light"),
    line([x(med), top], [x(med), bot]),
    line([x(mn), mid], [x(q1), mid]),
    line([x(q3), mid], [x(mx), mid]),
    line([x(mn), mid - 3], [x(mn), mid + 3]),
    line([x(mx), mid - 3], [x(mx), mid + 3]),
  ];
  for (const v of five) if (v !== hide) items.push(text([x(v), 10.5], String(v), "s"));
  items.push({ t: "numberLine", y: 34, x0, x1, min: lo, max: hi, step: 1, labels, points: [] });
  return fig(46, items);
}

function venn(total: number, both: number, neither: number): Diagram {
  return fig(66, [
    text([50, 8], `${total} students`),
    poly([[10, 14], [90, 14], [90, 60], [10, 60]], true, "none"),
    { t: "circle", c: [40, 38], r: 17, fill: "light" },
    { t: "circle", c: [60, 38], r: 17, fill: "light" },
    text([27, 19], "Spanish"),
    text([73, 19], "French"),
    text([31, 38], "?"),
    text([50, 38], String(both)),
    text([84, 54], String(neither)),
  ]);
}

function segment(length: number): Diagram {
  const y = 30;
  const xs: [string, number][] = [["A", 12], ["N", 31], ["M", 50], ["B", 88]];
  return fig(46, [
    line([12, y], [88, y]),
    ...xs.map(([, x]) => dot([x, y])),
    ...xs.map(([name, x]) => text([x, y + 7], name)),
    line([12, 14], [12, 22]),
    line([88, 14], [88, 22]),
    line([44, 18], [12.6, 18], false, "end"),
    line([56, 18], [87.4, 18], false, "end"),
    text([50, 18], String(length)),
  ]);
}

/** A seeded generator, so the scatter plots come out the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const correlation = (ps: P[]) => {
  const n = ps.length;
  const mx = ps.reduce((t, p) => t + p[0], 0) / n;
  const my = ps.reduce((t, p) => t + p[1], 0) / n;
  const sxy = ps.reduce((t, p) => t + (p[0] - mx) * (p[1] - my), 0);
  const sxx = ps.reduce((t, p) => t + (p[0] - mx) ** 2, 0);
  const syy = ps.reduce((t, p) => t + (p[1] - my) ** 2, 0);
  return sxy / Math.sqrt(sxx * syy);
};
export const scatterR: Record<string, number> = {};

/** Fifteen points on bare axes. trend: -1 falls, 1 rises, 0 has no pattern. */
function scatter(xTitle: string, yTitle: string, trend: -1 | 0 | 1): Diagram {
  // Plot area, in graph terms: 0 to 1 each way.
  let pts: P[] = [];
  if (trend === 0) {
    for (let seed = 1; seed < 500; seed++) {
      const rand = rng(seed);
      pts = [];
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) pts.push([(i + 0.15 + 0.7 * rand()) / 5, (j + 0.15 + 0.7 * rand()) / 3]);
      if (Math.abs(correlation(pts)) < 0.03) break;
    }
  } else {
    const rand = rng(trend === 1 ? 7 : 11);
    for (let i = 0; i < 15; i++) {
      const gx = (i + 0.2 + 0.6 * rand()) / 15;
      const along = 0.12 + 0.76 * gx + (rand() - 0.5) * 0.22;
      pts.push([gx, trend === 1 ? along : 1 - along]);
    }
  }
  scatterR[xTitle] = r2(correlation(pts));
  const ox = 16;
  const oy = 56;
  return fig(70, [
    line([ox, oy], [92, oy], false, "end"),
    line([ox, oy], [ox, 11], false, "end"),
    ...pts.map((p) => dot([ox + 5 + p[0] * 64, oy - 4 - p[1] * 36])),
    text([54, 62.5], xTitle),
    text([8, 6], yTitle, "m", "l"),
  ]);
}

const diagrams: Record<string, Diagram> = {
  "M-0005": inscribed("12"),
  "M-0046": inscribed("6"),
  "M-0208": inscribed("10"),

  "M-0014": stemLeaf([["2", "4"], ["3", "6 9"], ["4", "3 6"], ["5", "5 6"], ["6", "2 9"]]),
  "M-0061": stemLeaf([["2", "5"], ["3", "4 9"], ["4", "0 9"], ["5", "2 7"], ["6", "3 6"]]),
  "M-0070": stemLeaf([["2", "8"], ["4", "2 5"], ["5", "1 6"], ["6", "1 5 7 9"]]),
  "M-0148": stemLeaf([["2", "4 6 7"], ["3", "1 3"], ["4", "7"], ["5", "0 5"], ["6", "3"]]),

  "M-0017": cylinder(5, 5),
  "M-0079": cylinder(5, 6),
  "M-0181": cylinder(6, 10),
  "M-0270": cylinder(3, 9),

  "M-0018": circleRadius("6", null),
  "M-0060": circleRadius("3 cm", "O"),
  "M-0150": circleRadius("10 cm", "O"),

  "M-0019": crossing(46),

  "M-0023": rightTriangle(3, 4, { v: "3", h: "?", hyp: "5" }),
  "M-0300": rightTriangle(12, 16, { v: "12", h: "?", hyp: "20" }),
  "M-0130": rightTriangle(5, 12, { v: "5", h: "12", hyp: "?" }),
  "M-0152": rightTriangle(9, 12, { v: "9", h: "12", hyp: "?" }),

  "M-0027": similar(5, 10, 15, "15"),
  "M-0029": similar(7, 4, 21, "21"),
  "M-0268": similar(6, 5, 18, "18"),
  "M-0283": similar(7, 8, 10.5, "10½"),

  "M-0034": freqTable([1, 1, 3, 5, 6]),
  "M-0172": freqTable([6, 5, 2, 5, 5]),
  "M-0175": freqTable([6, 5, 4, 2, 1]),

  "M-0054": gridPoints([[-5, -3], [0, -3], [0, 0]]),
  "M-0062": gridPoints([[-2, 0], [0, 0], [0, 5]]),
  "M-0089": gridPoints([[0, -3], [6, -3], [6, 2]]),
  "M-0106": gridPoints([[-2, -3], [1, -3], [1, 3]]),
  "M-0262": gridPoints([[-3, -3], [1, -3], [1, -1]]),

  "M-0066": gridLine([1, 5], [2, 7]),
  "M-0110": gridLine([-2, 4], [-1, -2]),
  "M-0241": gridLine([-2, -2], [1, -6]),
  "M-0275": gridLine([-4, -1], [-2, -7]),

  "M-0069": boxPlot([10, 15, 19, 25, 32], 5, 37, null),
  "M-0073": boxPlot([16, 21, 28, 32, 47], 12, 51, 28),
  "M-0171": boxPlot([12, 20, 25, 35, 47], 10, 50, null),
  "M-0222": boxPlot([20, 31, 40, 44, 54], 17, 57, null),
  "M-0234": boxPlot([15, 22, 29, 35, 40], 10, 45, null),

  "M-0083": venn(25, 4, 5),
  "M-0127": venn(23, 7, 6),
  "M-0256": venn(34, 6, 4),
  "M-0286": venn(40, 4, 6),

  "M-0135": segment(64),
  "M-0236": segment(48),
  "M-0277": segment(32),

  "M-0123": scatter("outside temperature", "hot chocolate sales", -1),
  "M-0193": scatter("shoe size", "favorite number", 0),
  "M-0297": scatter("hours studied", "test score", 1),
};
const problems: Record<string, string> = {};

// ---- Is every described figure covered? (todo.json and the CSV's own diagram column) ----
function parseCsv(s: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell !== "" || row.length) row.push(cell), rows.push(row);
  return rows;
}
const csv = parseCsv(readFileSync(path.join(dir, "questions.csv"), "utf8"));
const head = csv[0];
const col = (name: string) => head.indexOf(name);
const fromCsv = csv.slice(1).filter((r) => r[col("level")] === "middle" && (r[col("diagram")] ?? "").trim() !== "").map((r) => r[col("id")]);
const todo = JSON.parse(readFileSync(path.join(dir, "out/todo.json"), "utf8")) as { diagram: { id: string; level: string }[] };
const fromTodo = todo.diagram.filter((d) => d.level === "middle").map((d) => d.id);
const bank = JSON.parse(readFileSync(path.join(dir, "out/math-middle.json"), "utf8")) as { questions: { id: string; diagram: unknown }[] };
const inBank = new Set(bank.questions.map((q) => q.id));
const done = new Set([...Object.keys(diagrams), ...Object.keys(problems)]);
let failed = false;
const complain = (m: string) => {
  failed = true;
  console.log(m);
};
console.log(`CSV rows with a description: ${fromCsv.length}; in todo.json: ${fromTodo.length}; drawn: ${Object.keys(diagrams).length}; problems: ${Object.keys(problems).length}`);
for (const id of new Set([...fromCsv, ...fromTodo])) {
  if (!done.has(id)) complain(`NOT COVERED: ${id}`);
  if (!fromCsv.includes(id)) complain(`in todo.json but the CSV has no description: ${id}`);
  if (!fromTodo.includes(id)) console.log(`note: described in the CSV but not in todo.json: ${id}`);
}
for (const id of done) {
  if (!inBank.has(id)) complain(`not a question in math-middle.json: ${id}`);
  if (!fromCsv.includes(id) && !fromTodo.includes(id)) complain(`drawn but never described: ${id}`);
}

// ---- The bank's own check, plus a count of items ----
for (const [id, d] of Object.entries(diagrams)) {
  const { errors, warnings } = diagramProblems(d);
  for (const e of errors) complain(`${id} ERROR ${e}`);
  for (const w of warnings) complain(`${id} WARNING ${w}`);
  if (d.items.length > 60) complain(`${id} has ${d.items.length} items`);
}
console.log("scatter correlations:", JSON.stringify(scatterR));
console.log(failed ? "FAILED" : "all figures pass diagramProblems with no errors and no warnings");

writeFileSync(path.join(dir, "diagrams-middle.json"), JSON.stringify({ diagrams, problems }, null, 1) + "\n");

// ---- A contact sheet to look at (approximates MathDiagramView) ----
const out = process.argv[2];
if (out) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const k = 3.6;
  const fs = (size: unknown) => (size === "s" ? 3.6 : size === "l" ? 5.4 : 4.4);
  const INK = "#111";
  const ACC = "#e8590c";
  const label = (s: string, x: number, y: number, size: unknown = "m", anchor = "middle", bold = false) =>
    `<text x="${x}" y="${y}" font-size="${fs(size)}" font-family="Arial Rounded MT Bold, Helvetica" font-weight="${bold ? 700 : 500}" text-anchor="${anchor}" dominant-baseline="central" fill="${INK}">${esc(s)}</text>`;
  const num = (v: number) => (Math.abs(v - Math.round(v)) < 1e-4 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
  const fill = (f: unknown) => (f === "light" ? `${ACC}29` : f === "accent" ? `${ACC}8c` : "none");
  const draw = (d: Diagram) => {
    let s = "";
    const st = `stroke="${INK}" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round"`;
    // The preview draws every kind of item loosely; the bank's own check is what's strict.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of d.items as any[]) {
      if (it.t === "line") {
        s += `<line x1="${it.a[0]}" y1="${it.a[1]}" x2="${it.b[0]}" y2="${it.b[1]}" ${st} ${it.dash ? 'stroke-dasharray="1.6 1.4"' : ""}/>`;
        const headAt = (tip: P, tail: P) => {
          const a = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
          s += `<polygon fill="${INK}" points="${tip[0]},${tip[1]} ${tip[0] - 2.4 * Math.cos(a - 0.45)},${tip[1] - 2.4 * Math.sin(a - 0.45)} ${tip[0] - 2.4 * Math.cos(a + 0.45)},${tip[1] - 2.4 * Math.sin(a + 0.45)}"/>`;
        };
        if (it.arrow !== "none") headAt(it.b, it.a);
        if (it.arrow === "both") headAt(it.a, it.b);
      } else if (it.t === "poly") s += `<${it.closed ? "polygon" : "polyline"} points="${it.pts.map((p: P) => p.join(",")).join(" ")}" fill="${it.closed ? fill(it.fill) : "none"}" ${st}/>`;
      else if (it.t === "circle") s += `<circle cx="${it.c[0]}" cy="${it.c[1]}" r="${it.r}" fill="${fill(it.fill)}" ${st}/>`;
      else if (it.t === "arc") {
        const a = (deg: number): P => [it.c[0] + it.r * Math.cos(rad(deg)), it.c[1] - it.r * Math.sin(rad(deg))];
        const [p, q] = [a(it.from), a(it.to)];
        s += `<path d="M${p[0]} ${p[1]} A${it.r} ${it.r} 0 ${it.to - it.from > 180 ? 1 : 0} 0 ${q[0]} ${q[1]}" fill="none" ${st}/>`;
      } else if (it.t === "rightAngle") {
        const un = (p: P): P => {
          const l = Math.hypot(p[0] - it.at[0], p[1] - it.at[1]);
          return [(p[0] - it.at[0]) / l, (p[1] - it.at[1]) / l];
        };
        const [u, v] = [un(it.a), un(it.b)];
        s += `<polyline fill="none" stroke="${INK}" stroke-width="0.4" points="${it.at[0] + u[0] * 3.2},${it.at[1] + u[1] * 3.2} ${it.at[0] + (u[0] + v[0]) * 3.2},${it.at[1] + (u[1] + v[1]) * 3.2} ${it.at[0] + v[0] * 3.2},${it.at[1] + v[1] * 3.2}"/>`;
      } else if (it.t === "dot") s += `<circle cx="${it.at[0]}" cy="${it.at[1]}" r="1" fill="${INK}"/>`;
      else if (it.t === "text") s += label(it.s, it.at[0], it.at[1], it.size, it.anchor === "l" ? "start" : it.anchor === "r" ? "end" : "middle");
      else if (it.t === "numberLine") {
        const x = (v: number) => it.x0 + ((it.x1 - it.x0) * (v - it.min)) / (it.max - it.min);
        s += `<line x1="${it.x0 - 3}" y1="${it.y}" x2="${it.x1 + 3}" y2="${it.y}" ${st}/>`;
        const count = Math.round((it.max - it.min) / it.step);
        for (let i = 0; i <= count; i++) {
          const v = it.min + i * it.step;
          s += `<line x1="${x(v)}" y1="${it.y - 1.8}" x2="${x(v)}" y2="${it.y + 1.8}" ${st}/>`;
          const show = Array.isArray(it.labels) ? it.labels.some((n: number) => Math.abs(n - v) < it.step / 100) : it.labels === "all" || (it.labels === "ends" && (i === 0 || i === count));
          if (show) s += label(num(v), x(v), it.y + 6, "s");
        }
      } else if (it.t === "table") {
        const colW = it.w / it.cols.length;
        s += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="7.5" fill="${ACC}29"/>`;
        it.cols.forEach((c: string, i: number) => (s += label(c, it.x + colW * (i + 0.5), it.y + 3.75, "s", "middle", true)));
        it.rows.forEach((row: string[], r: number) => row.forEach((c, i) => (s += label(c, it.x + colW * (i + 0.5), it.y + 7.5 * (r + 1.5), "s"))));
        for (let r = 0; r <= it.rows.length + 1; r++) s += `<line x1="${it.x}" y1="${it.y + 7.5 * r}" x2="${it.x + it.w}" y2="${it.y + 7.5 * r}" stroke="${INK}" stroke-width="0.3"/>`;
        for (let c = 0; c <= it.cols.length; c++) s += `<line x1="${it.x + colW * c}" y1="${it.y}" x2="${it.x + colW * c}" y2="${it.y + 7.5 * (it.rows.length + 1)}" stroke="${INK}" stroke-width="0.3"/>`;
      } else if (it.t === "grid") {
        const gx = (v: number) => it.x + (it.w * (v - it.xmin)) / (it.xmax - it.xmin);
        const gy = (v: number) => it.y + it.h - (it.h * (v - it.ymin)) / (it.ymax - it.ymin);
        const clamp = (lo: number, hi: number) => Math.max(lo, Math.min(hi, 0));
        const ax = gx(clamp(it.xmin, it.xmax));
        const ay = gy(clamp(it.ymin, it.ymax));
        for (let v = Math.ceil(it.xmin); v <= it.xmax; v++) {
          s += `<line x1="${gx(v)}" y1="${it.y}" x2="${gx(v)}" y2="${it.y + it.h}" stroke="${INK}" stroke-opacity="0.2" stroke-width="0.3"/>`;
          if (v !== 0 || it.xmin === 0) s += label(num(v), gx(v), ay + 3, "s");
        }
        for (let v = Math.ceil(it.ymin); v <= it.ymax; v++) {
          s += `<line x1="${it.x}" y1="${gy(v)}" x2="${it.x + it.w}" y2="${gy(v)}" stroke="${INK}" stroke-opacity="0.2" stroke-width="0.3"/>`;
          if (v !== 0) s += label(num(v), ax - 2.6, gy(v), "s");
        }
        s += `<line x1="${it.x}" y1="${ay}" x2="${it.x + it.w}" y2="${ay}" ${st}/><line x1="${ax}" y1="${it.y}" x2="${ax}" y2="${it.y + it.h}" ${st}/>`;
        for (const seg of it.segments) s += `<line x1="${gx(seg[0][0])}" y1="${gy(seg[0][1])}" x2="${gx(seg[1][0])}" y2="${gy(seg[1][1])}" stroke="${ACC}" stroke-width="0.55"/>`;
        for (const p of it.points) {
          s += `<circle cx="${gx(p.p[0])}" cy="${gy(p.p[1])}" r="1.3" fill="${ACC}"/>`;
          if (p.label) s += label(p.label, gx(p.p[0]) + 2.6, gy(p.p[1]) - 3, "m", "middle", true);
        }
      }
    }
    return s;
  };
  const ids = Object.keys(diagrams);
  const cols = 3;
  const per = 9;
  const cw = 100 * k + 20;
  const ch = 80 * k + 40;
  const side = cols * cw;
  // Square sheets of nine, so a thumbnailer shows each one whole.
  for (let n = 0; n * per < ids.length; n++) {
    let svg = "";
    ids.slice(n * per, (n + 1) * per).forEach((id, i) => {
      const d = diagrams[id];
      const x = (i % cols) * cw + 10;
      const y = Math.floor(i / cols) * ch + 10;
      svg += `<g transform="translate(${x},${y})"><text x="0" y="12" font-size="12" font-family="Helvetica">${id}</text><g transform="translate(0,18) scale(${k})"><rect width="100" height="${d.h}" fill="#fff" stroke="#bbb" stroke-width="0.2"/><rect x="6" y="6" width="88" height="${d.h - 12}" fill="none" stroke="#9cf" stroke-width="0.15" stroke-dasharray="1 1"/>${draw(d)}</g></g>`;
    });
    writeFileSync(out.replace(/\.svg$/, `-${n + 1}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"><rect width="100%" height="100%" fill="#f4f4f4"/>${svg}</svg>`);
  }
  console.log(`preview: ${out}`);
}
