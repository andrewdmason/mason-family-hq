import sanitizeHtml from "sanitize-html";

/**
 * The tutor's ```visual blocks (the format is defined for the model in
 * VISUALS, ./prompt.ts), parsed and checked before anything is drawn. The model
 * writes these, so every field is validated: a visual that fails here renders
 * as a quiet "couldn't draw this" note instead of breaking the page.
 */

type Value = number | string;

export type MappingVisual = {
  type: "mapping";
  title?: string;
  inputLabel: string;
  outputLabel: string;
  inputs: Value[];
  outputs: Value[];
  arrows: [Value, Value][];
};

export type GraphVisual = {
  type: "graph";
  title?: string;
  xRange: [number, number];
  yRange: [number, number];
  xLabel: string;
  yLabel: string;
  points: { x: number; y: number; label?: string }[];
  segments: { from: [number, number]; to: [number, number] }[];
  functions: { expr: string; label?: string }[];
  curves: { points: [number, number][]; label?: string }[];
  hideNumbers: boolean;
};

export type NumberLineVisual = {
  type: "numberline";
  title?: string;
  min: number;
  max: number;
  points: { value: number; open: boolean; label?: string }[];
  intervals: { from: number; to: number }[];
};

export type SvgVisual = { type: "svg"; title?: string; svg: string };

/** An equation written out, shown by the voice tutor while it talks. */
export type MathVisual = { type: "math"; title?: string; latex: string };

export type Visual = MappingVisual | GraphVisual | NumberLineVisual | SvgVisual | MathVisual;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isValue = (v: unknown): v is Value => isNum(v) || (typeof v === "string" && v.length <= 40);
const str = (v: unknown, max = 120): string | undefined =>
  typeof v === "string" && v.trim() ? v.slice(0, max) : undefined;
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
// Numbers that may arrive as strings ("3") from a looser model.
const num = (v: unknown): number | undefined =>
  isNum(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;

/** Parse one visual block's JSON. Throws with a short reason when it can't be drawn. */
export function parseVisual(source: string): Visual {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new Error("not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
  const v = raw as Record<string, unknown>;
  const title = str(v.title);

  switch (v.type) {
    case "mapping": {
      const inputs = arr(v.inputs).filter(isValue);
      const outputs = arr(v.outputs).filter(isValue);
      if (inputs.length === 0 || outputs.length === 0) throw new Error("mapping needs inputs and outputs");
      if (inputs.length > 30 || outputs.length > 30) throw new Error("mapping too large");
      const arrows = arr(v.arrows).filter(
        (a): a is [Value, Value] => Array.isArray(a) && a.length === 2 && isValue(a[0]) && isValue(a[1])
      );
      return {
        type: "mapping",
        title,
        inputLabel: str(v.inputLabel, 40) ?? "Input",
        outputLabel: str(v.outputLabel, 40) ?? "Output",
        inputs,
        outputs,
        arrows: arrows.slice(0, 200),
      };
    }
    case "graph": {
      if (!pair(v.xRange) || !pair(v.yRange)) throw new Error("graph needs xRange and yRange");
      const [x0, x1] = v.xRange;
      const [y0, y1] = v.yRange;
      if (!(x1 > x0) || !(y1 > y0)) throw new Error("graph ranges are empty");
      if (x1 - x0 > 1e6 || y1 - y0 > 1e6) throw new Error("graph ranges too large");
      return {
        type: "graph",
        title,
        xRange: [x0, x1],
        yRange: [y0, y1],
        xLabel: str(v.xLabel, 60) ?? "x",
        yLabel: str(v.yLabel, 60) ?? "y",
        points: arr(v.points)
          .flatMap((p) => {
            const o = (p ?? {}) as Record<string, unknown>;
            const x = num(o.x);
            const y = num(o.y);
            return x != null && y != null ? [{ x, y, label: str(o.label, 40) }] : [];
          })
          .slice(0, 100),
        segments: arr(v.segments)
          .flatMap((s) => {
            const o = (s ?? {}) as Record<string, unknown>;
            return pair(o.from) && pair(o.to) ? [{ from: o.from, to: o.to }] : [];
          })
          .slice(0, 100),
        functions: arr(v.functions)
          .flatMap((f) => {
            const o = (f ?? {}) as Record<string, unknown>;
            return typeof o.expr === "string" ? [{ expr: o.expr, label: str(o.label, 60) }] : [];
          })
          .slice(0, 8),
        curves: arr(v.curves)
          .flatMap((c) => {
            const o = (c ?? {}) as Record<string, unknown>;
            const points = arr(o.points).filter(pair).slice(0, 2000);
            return points.length >= 2 ? [{ points, label: str(o.label, 60) }] : [];
          })
          .slice(0, 8),
        hideNumbers: v.hideNumbers === true,
      };
    }
    case "numberline": {
      const min = num(v.min);
      const max = num(v.max);
      if (min == null || max == null || !(max > min)) throw new Error("number line needs min < max");
      if (max - min > 1e6) throw new Error("number line too long");
      return {
        type: "numberline",
        title,
        min,
        max,
        points: arr(v.points)
          .flatMap((p) => {
            const o = (p ?? {}) as Record<string, unknown>;
            const value = num(o.value);
            return value != null ? [{ value, open: o.open === true, label: str(o.label, 40) }] : [];
          })
          .slice(0, 50),
        intervals: arr(v.intervals)
          .flatMap((iv) => {
            const o = (iv ?? {}) as Record<string, unknown>;
            const from = num(o.from);
            const to = num(o.to);
            return from != null && to != null ? [{ from, to }] : [];
          })
          .slice(0, 20),
      };
    }
    case "svg": {
      if (typeof v.svg !== "string" || !v.svg.includes("<svg")) throw new Error("svg visual has no <svg>");
      if (v.svg.length > 100_000) throw new Error("svg too large");
      const svg = sanitizeSvg(v.svg);
      if (!/<svg[\s>]/.test(svg)) throw new Error("svg empty after cleaning");
      return { type: "svg", title, svg };
    }
    case "math": {
      if (typeof v.latex !== "string" || !v.latex.trim()) throw new Error("math visual has no latex");
      return { type: "math", title, latex: v.latex.slice(0, 2000) };
    }
    default:
      throw new Error(`unknown visual type ${JSON.stringify(v.type)}`);
  }
}

// --- SVG sanitizing ------------------------------------------------------------
// Drawing elements only. No script, style, foreignObject, image, use, animate,
// or a/link elements; no event handlers; no hrefs except in-document "#id"
// references (gradients, markers, textPath).

const SVG_TAGS = [
  "svg", "g", "defs", "title", "desc", "symbol",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath",
  "marker", "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask",
];

const PRESENTATION = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity",
  "transform", "clip-path", "clip-rule", "mask", "marker-start", "marker-mid", "marker-end",
  "font-size", "font-family", "font-weight", "font-style", "text-anchor", "dominant-baseline",
  "alignment-baseline", "baseline-shift", "letter-spacing", "word-spacing", "text-decoration",
  "stop-color", "stop-opacity", "color", "visibility", "display", "vector-effect", "paint-order",
  "id", "class",
];

const GEOMETRY = [
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "width", "height",
  "d", "points", "dx", "dy", "rotate", "textLength", "lengthAdjust", "startOffset", "pathLength",
  "viewBox", "preserveAspectRatio", "xmlns", "version",
  "refX", "refY", "markerWidth", "markerHeight", "markerUnits", "orient",
  "gradientUnits", "gradientTransform", "spreadMethod", "offset",
  "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits",
  "href", "xlink:href",
];

const ATTRS = [...PRESENTATION, ...GEOMETRY];

/** Any url(...) in an attribute must point inside the document. */
const EXTERNAL_URL = /url\(\s*['"]?\s*(?!#)/i;

export function sanitizeSvg(svg: string): string {
  return sanitizeHtml(svg, {
    allowedTags: SVG_TAGS,
    allowedAttributes: Object.fromEntries(SVG_TAGS.map((t) => [t, ATTRS])),
    // Hrefs are vetted in the transform below; nothing gets a scheme.
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false, xmlMode: true },
    // Contents of dropped elements (a <script>'s source) go, not just the tags.
    nonTextTags: ["script", "style", "foreignObject", "textarea", "noscript", "iframe"],
    disallowedTagsMode: "discard",
    transformTags: {
      "*": (tagName, attribs) => {
        const clean: Record<string, string> = {};
        for (const [name, value] of Object.entries(attribs)) {
          if (/^on/i.test(name)) continue;
          if ((name === "href" || name === "xlink:href") && !/^#[\w-]+$/.test(value.trim())) continue;
          if (EXTERNAL_URL.test(value) || /javascript:|expression\(/i.test(value)) continue;
          clean[name] = value;
        }
        return { tagName, attribs: clean };
      },
    },
  });
}
