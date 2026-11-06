import type { ReactNode } from "react";
import katex from "katex";
import { compileExpression } from "@/lib/tuttles/expr";
import {
  parseVisual,
  type GraphVisual,
  type MappingVisual,
  type NumberLineVisual,
  type Visual,
} from "@/lib/tuttles/visuals";

/**
 * A tutor's ```visual block, drawn as SVG. Ported from the bake-off prototype
 * the family liked (.context/bakeoff/report.html), keeping its look: blue input
 * box, green output box, orange arrows, red lines and points on a light grid.
 *
 * The model writes the JSON, so anything that fails to parse or draw shows a
 * small muted note rather than taking the message down with it.
 */

const C = {
  blue: "#5b7fc7",
  blueFill: "#f1f4fb",
  green: "#4f9a7c",
  greenFill: "#eff6f2",
  arrow: "#cf6f2e",
  ink: "#222",
  grid: "#e3e3e8",
  axis: "#555",
  muted: "#666",
  line: "#d7261e",
};

/** A white outline behind labels so they stay readable where they cross a line. */
const HALO = { stroke: "#fff", strokeWidth: 3, strokeLinejoin: "round", paintOrder: "stroke" } as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif";

/** A round step near span/target: 1, 2, 5 × 10^k. */
function niceStep(span: number, target: number): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

/** Tick values from lo to hi on a step, without float drift ("0.30000000004"). */
function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9 && out.length < 200; k++) {
    out.push(Number((k * step).toFixed(decimals)));
  }
  return out;
}

function Mapping({ v, uid }: { v: MappingVisual; uid: string }) {
  const W = 360;
  const rowsIn = v.inputs.length;
  const rowsOut = v.outputs.length;
  const rows = Math.max(rowsIn, rowsOut);
  const H = 70 + rows * 44 + 20;
  const bx = [40, 220];
  const bw = 100;
  const top = 48;
  const bh = rows * 44 + 20;
  const yAt = (i: number, n: number) => top + 10 + (bh - 20) * ((i + 0.5) / n);
  const marker = `${uid}-ah`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mapping diagram: ${v.inputLabel} to ${v.outputLabel}`}>
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill={C.arrow} />
        </marker>
      </defs>
      <text x={bx[0] + bw / 2} y={30} textAnchor="middle" fontSize={17} fontWeight={600} fill={C.ink}>
        {v.inputLabel}
      </text>
      <text x={bx[1] + bw / 2} y={30} textAnchor="middle" fontSize={17} fontWeight={600} fill={C.ink}>
        {v.outputLabel}
      </text>
      <rect x={bx[0]} y={top} width={bw} height={bh} rx={18} fill={C.blueFill} stroke={C.blue} strokeWidth={2.5} />
      <rect x={bx[1]} y={top} width={bw} height={bh} rx={18} fill={C.greenFill} stroke={C.green} strokeWidth={2.5} />
      {v.inputs.map((x, i) => (
        <text key={`i${i}`} x={bx[0] + bw / 2 - 8} y={yAt(i, rowsIn) + 6} textAnchor="middle" fontSize={18} fill={C.ink}>
          {String(x)}
        </text>
      ))}
      {v.outputs.map((y, i) => (
        <text key={`o${i}`} x={bx[1] + bw / 2 + 8} y={yAt(i, rowsOut) + 6} textAnchor="middle" fontSize={18} fill={C.ink}>
          {String(y)}
        </text>
      ))}
      {v.arrows.map(([a, b], k) => {
        const i = v.inputs.findIndex((x) => String(x) === String(a));
        const j = v.outputs.findIndex((y) => String(y) === String(b));
        if (i < 0 || j < 0) return null;
        return (
          <line
            key={`a${k}`}
            x1={bx[0] + bw / 2 + 14}
            y1={yAt(i, rowsIn)}
            x2={bx[1] + bw / 2 - 12}
            y2={yAt(j, rowsOut)}
            stroke={C.arrow}
            strokeWidth={2.2}
            markerEnd={`url(#${marker})`}
          />
        );
      })}
    </svg>
  );
}

function Graph({ v, uid }: { v: GraphVisual; uid: string }) {
  const W = 360;
  const H = 300;
  const m = { l: 44, r: 16, t: 14, b: 40 };
  const [x0, x1] = v.xRange;
  const [y0, y1] = v.yRange;
  const X = (x: number) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (y: number) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const xStep = niceStep(x1 - x0, 10);
  const yStep = niceStep(y1 - y0, 10);
  const xTicks = ticks(x0, x1, xStep);
  const yTicks = ticks(y0, y1, yStep);
  const ax = x0 <= 0 && x1 >= 0 ? X(0) : X(x0);
  const ay = y0 <= 0 && y1 >= 0 ? Y(0) : Y(y0);
  const clip = `${uid}-plot`;
  const fmt = (n: number) => String(n).replace("-", "−");

  // Sample each function across the range, breaking the line wherever it
  // leaves the plot or isn't defined (1/x at 0, sqrt of a negative).
  const fnPaths = v.functions.map((f) => {
    const fn = compileExpression(f.expr);
    if (!fn) throw new Error(`can't read ${f.expr}`);
    const N = 400;
    const ySpan = y1 - y0;
    let d = "";
    let pen = false;
    let last: [number, number] | null = null;
    for (let i = 0; i <= N; i++) {
      const x = x0 + ((x1 - x0) * i) / N;
      const y = fn(x);
      if (!Number.isFinite(y) || y < y0 - ySpan || y > y1 + ySpan) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${X(x).toFixed(2)},${Y(y).toFixed(2)}`;
      pen = true;
      if (y >= y0 && y <= y1) last = [x, y];
    }
    return { d, label: f.label, last };
  });

  const labelAt = (pt: [number, number] | null, label: string | undefined, key: string): ReactNode =>
    label && pt ? (
      <text key={key} x={Math.min(X(pt[0]), W - m.r) - 4} y={Math.max(Y(pt[1]) - 8, m.t + 10)} textAnchor="end" fontSize={12} fontWeight={600} fill={C.line} {...HALO}>
        {label}
      </text>
    ) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={v.title ?? `Graph of ${v.yLabel} against ${v.xLabel}`}>
      <defs>
        <clipPath id={clip}>
          <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} />
        </clipPath>
      </defs>
      {!v.hideNumbers && (
        <g stroke={C.grid}>
          {xTicks.map((x) => (
            <line key={`gx${x}`} x1={X(x)} y1={Y(y0)} x2={X(x)} y2={Y(y1)} />
          ))}
          {yTicks.map((y) => (
            <line key={`gy${y}`} x1={X(x0)} y1={Y(y)} x2={X(x1)} y2={Y(y)} />
          ))}
        </g>
      )}
      <line x1={X(x0)} y1={ay} x2={X(x1)} y2={ay} stroke={C.axis} strokeWidth={1.6} />
      <line x1={ax} y1={Y(y0)} x2={ax} y2={Y(y1)} stroke={C.axis} strokeWidth={1.6} />
      {!v.hideNumbers && (
        <g fontSize={11} fill={C.muted}>
          {xTicks.map((x) =>
            x === 0 && ax !== X(x0) ? null : (
              <text key={`tx${x}`} x={X(x)} y={ay + 15} textAnchor="middle">
                {fmt(x)}
              </text>
            )
          )}
          {yTicks.map((y) =>
            y === 0 && ay !== Y(y0) ? null : (
              <text key={`ty${y}`} x={ax - 6} y={Y(y) + 4} textAnchor="end">
                {fmt(y)}
              </text>
            )
          )}
        </g>
      )}
      <text x={(m.l + W - m.r) / 2} y={H - 8} textAnchor="middle" fontSize={13} fontWeight={600} fill={C.ink}>
        {v.xLabel}
      </text>
      <text transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={13} fontWeight={600} fill={C.ink}>
        {v.yLabel}
      </text>
      <g clipPath={`url(#${clip})`} fill="none" stroke={C.line} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        {fnPaths.map((p, i) => (
          <path key={`f${i}`} d={p.d} />
        ))}
        {v.curves.map((c, i) => (
          <polyline key={`c${i}`} points={c.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} />
        ))}
        {v.segments.map((s, i) => (
          <line key={`s${i}`} x1={X(s.from[0])} y1={Y(s.from[1])} x2={X(s.to[0])} y2={Y(s.to[1])} />
        ))}
      </g>
      {fnPaths.map((p, i) => labelAt(p.last, p.label, `fl${i}`))}
      {v.curves.map((c, i) => labelAt(c.points[c.points.length - 1], c.label, `cl${i}`))}
      {v.points.map((p, i) => (
        <g key={`p${i}`}>
          <circle cx={X(p.x)} cy={Y(p.y)} r={4.5} fill={C.line} />
          {p.label && (
            <text x={X(p.x) + 7} y={Y(p.y) - 7} fontSize={12} fill={C.ink} {...HALO}>
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function NumberLine({ v }: { v: NumberLineVisual }) {
  const W = 360;
  const hasLabels = v.points.some((p) => p.label);
  const top = hasLabels ? 18 : 0;
  const H = 80 + top;
  const cy = 40 + top;
  const X = (x: number) => 24 + ((x - v.min) / (v.max - v.min)) * (W - 48);
  // Whole-number ticks for the usual school ranges (−10…10), rounder steps beyond.
  const span = v.max - v.min;
  const step = span >= 4 && span <= 20 ? 1 : niceStep(span, 10);
  const fmt = (n: number) => String(n).replace("-", "−");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Number line">
      <line x1={12} y1={cy} x2={W - 12} y2={cy} stroke={C.axis} strokeWidth={1.6} />
      {ticks(v.min, v.max, step).map((x) => (
        <g key={`t${x}`}>
          <line x1={X(x)} y1={cy - 6} x2={X(x)} y2={cy + 6} stroke={C.axis} />
          <text x={X(x)} y={cy + 24} fontSize={12} textAnchor="middle" fill={C.ink}>
            {fmt(x)}
          </text>
        </g>
      ))}
      {v.intervals.map((iv, i) => (
        <line key={`iv${i}`} x1={X(iv.from)} y1={cy} x2={X(iv.to)} y2={cy} stroke={C.line} strokeWidth={5} />
      ))}
      {v.points.map((p, i) => (
        <g key={`p${i}`}>
          <circle cx={X(p.value)} cy={cy} r={6} fill={p.open ? "#fff" : C.line} stroke={C.line} strokeWidth={2.5} />
          {p.label && (
            <text x={X(p.value)} y={cy - 14} fontSize={12} fontWeight={600} textAnchor="middle" fill={C.line}>
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function draw(v: Visual, uid: string): ReactNode {
  switch (v.type) {
    // Called directly (not as elements) so anything that throws while drawing
    // throws here, inside VisualBlock's try, rather than later in React's
    // render of a child where it would take the page down.
    case "mapping":
      return Mapping({ v, uid });
    case "graph":
      return Graph({ v, uid });
    case "numberline":
      return NumberLine({ v });
    case "svg":
      // Sanitized in parseVisual: drawing elements only, no scripts, handlers,
      // foreignObject or external references.
      return <div dangerouslySetInnerHTML={{ __html: v.svg }} />;
    case "math":
      // KaTeX escapes what it's given; a formula it can't read shows as an error in place.
      return (
        <div
          className="overflow-x-auto py-2 text-center text-lg"
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(v.latex, { displayMode: true, throwOnError: false }),
          }}
        />
      );
  }
}

/** `uid` keeps SVG ids (arrowheads, clip paths) unique across the page. */
export function VisualBlock({ source, uid }: { source: string; uid: string }) {
  let visual: Visual;
  let body: ReactNode;
  try {
    visual = parseVisual(source);
    body = draw(visual, uid);
  } catch (e) {
    return (
      <div
        className="my-2 rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground"
        title={e instanceof Error ? e.message : undefined}
      >
        Couldn’t draw this picture.
      </div>
    );
  }
  return (
    <figure
      className="tuttles-visual my-2.5 max-w-[420px] rounded-2xl border border-[#e6e6ea] bg-white p-2.5 text-[#222]"
      style={{ fontFamily: FONT }}
    >
      {visual.title && <figcaption className="mb-1 text-center text-[13px] font-semibold">{visual.title}</figcaption>}
      {body}
    </figure>
  );
}
