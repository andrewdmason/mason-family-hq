/**
 * The shape of a Math bank file (ios/Tuttles/iPhone/Math/MathAssets/bank/
 * math-{lower,middle}.json) and the rules every question in one has to meet.
 * check.mts prints what validateBank finds; import.mts uses the same rules to
 * hold back any question that would break them, so a bank it writes always
 * passes the checker.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Level = "lower" | "middle";
export type Section = "qr" | "ma";
export type QuestionType = "word" | "computation" | "comparison";
/** "real" is copied from a published source; "written" was written for this bank in the test's style. */
export type Source = "placeholder" | "real" | "written" | "variant";

export const LEVELS: Level[] = ["lower", "middle"];
export const SECTIONS: Section[] = ["qr", "ma"];
export const TYPES: QuestionType[] = ["word", "computation", "comparison"];
export const SOURCES: Source[] = ["placeholder", "real", "written", "variant"];
export const TOPICS = [
  "whole numbers",
  "fractions",
  "decimals",
  "percent",
  "ratios",
  "algebra",
  "geometry",
  "measurement",
  "data",
  "probability",
  "patterns",
  "estimation",
  "number sense",
] as const;
export type Topic = (typeof TOPICS)[number];

export const COMPARISON_CHOICES = [
  "The quantity in Column A is greater.",
  "The quantity in Column B is greater.",
  "The two quantities are equal.",
  "The relationship cannot be determined from the information given.",
];

/** The only LaTeX commands the app's renderer knows. */
export const LATEX_COMMANDS = ["frac", "times", "div", "sqrt", "leq", "geq", "neq", "pi", "cdot", "angle", "triangle", "circ"];

export type DiagramItem = { t: string } & Record<string, unknown>;
export type Diagram = { w: number; h: number; items: DiagramItem[] };

export type Question = {
  id: string;
  section: Section;
  topic: Topic;
  /** The finer-grained topic name the question came with, when it had one. The app ignores it. */
  subtopic?: string;
  type: QuestionType;
  prompt: string;
  columnA: string | null;
  columnB: string | null;
  choices: string[];
  answer: number;
  explanation: string;
  difficulty: 1 | 2 | 3;
  diagram: Diagram | null;
  source: Source;
  of: string | null;
  ref: string | null;
};

export type Bank = { version: string; level: Level; questions: Question[] };

/** A problem is an error (the app can't use the question) or a warning (it can, but someone should look). */
export type Problem = { id: string | null; level: "error" | "warning"; message: string };

export const here = path.dirname(fileURLToPath(import.meta.url));
export const BANK_DIR = path.join(here, "../../ios/Tuttles/iPhone/Math/MathAssets/bank");
export const bankFile = (dir: string, level: Level) => path.join(dir, `math-${level}.json`);
export const idPrefix = (level: Level) => (level === "lower" ? "L" : "M");

/** "L-0001", "M-3fa92c1d" and, for a variant, "M-3fa92c1d-v2". */
export const isQuestionId = (s: string) => ID.test(s);
const ID = /^([LM])-[0-9a-z]{4,}(-v[1-9][0-9]*)?$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNumber(v[0]) && isNumber(v[1]);

/**
 * What is wrong with a piece of question text, or nothing. Maths sits between
 * single unescaped dollar signs; a money dollar is written "\$".
 */
export function textProblems(s: string): string[] {
  const found: string[] = [];
  let math: string | null = null; // the maths span being read, or null outside one
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "$") {
      if (math !== null) found.push(`an escaped dollar sign inside maths ("${math}")`);
      i++;
      continue;
    }
    if (c === "$") {
      if (math === null) math = "";
      else {
        found.push(...mathProblems(math));
        math = null;
      }
      continue;
    }
    if (math !== null) math += c;
    else if (c === "\\") found.push(`a backslash outside maths near "${s.slice(Math.max(0, i - 8), i + 8)}"`);
  }
  if (math !== null) found.push("dollar signs don't pair up (write a money dollar as \\$)");
  return found;
}

function mathProblems(m: string): string[] {
  const found: string[] = [];
  if (m.trim() === "") found.push("an empty maths span ($$)");
  if (m.includes("\n")) found.push(`a line break inside maths ("${m}")`);
  for (const cmd of m.matchAll(/\\([A-Za-z]+|.?)/g)) {
    if (!LATEX_COMMANDS.includes(cmd[1])) found.push(`unknown LaTeX "\\${cmd[1]}" in "${m}"`);
  }
  let depth = 0;
  for (const c of m) {
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) found.push(`braces don't pair up in "${m}"`);
  for (const frac of m.matchAll(/\\frac(?!\s*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}\s*\{)/g)) {
    found.push(`\\frac needs two {…} groups in "${m}" (at ${frac.index})`);
  }
  return found;
}

/** Margin the format asks drawings to leave for labels. Shapes inside it only get a warning. */
const MARGIN = 6;

/** Problems with a diagram: errors for anything malformed or outside the box, warnings for shapes in the label margin. */
export function diagramProblems(d: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(d)) return { errors: ["diagram is not an object"], warnings };
  const { w, h, items } = d;
  if (w !== 100) errors.push(`diagram w is ${String(w)}, expected 100`);
  if (!isNumber(h) || h < 40 || h > 80) errors.push(`diagram h is ${String(h)}, expected 40 to 80`);
  if (!Array.isArray(items) || items.length === 0) {
    errors.push("diagram has no items");
    return { errors, warnings };
  }
  const W = 100;
  const H = isNumber(h) ? h : 80;

  items.forEach((raw, n) => {
    const at = `item ${n + 1}`;
    if (!isObject(raw) || typeof raw.t !== "string") {
      errors.push(`${at}: not an item with a kind "t"`);
      return;
    }
    const it = raw;
    const name = `${at} (${String(it.t)})`;
    const bad = (what: string) => errors.push(`${name}: ${what}`);
    // A point that must be in the box; shapes (not labels) are also asked to keep out of the margin.
    const place = (p: unknown, field: string, shape = true): p is [number, number] => {
      if (!isPoint(p)) {
        bad(`"${field}" is not a point [x, y]`);
        return false;
      }
      if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) bad(`"${field}" [${p.join(", ")}] is outside the ${W} by ${H} box`);
      else if (shape && (p[0] < MARGIN || p[0] > W - MARGIN || p[1] < MARGIN || p[1] > H - MARGIN))
        warnings.push(`${name}: "${field}" [${p.join(", ")}] is inside the ${MARGIN}-unit label margin`);
      return true;
    };
    const num = (field: string, min?: number): number | null => {
      const v = it[field];
      if (!isNumber(v) || (min !== undefined && v < min)) {
        bad(`"${field}" is ${JSON.stringify(v)}, expected a number${min !== undefined ? ` of at least ${min}` : ""}`);
        return null;
      }
      return v;
    };
    const oneOf = (field: string, allowed: unknown[]) => {
      if (!allowed.includes(it[field])) bad(`"${field}" is ${JSON.stringify(it[field])}, expected one of ${allowed.map((a) => JSON.stringify(a)).join(", ")}`);
    };
    const label = (v: unknown, field: string, optional = false) => {
      if (optional && (v === null || v === undefined)) return;
      if (typeof v !== "string") bad(`"${field}" is not a string`);
      else if (/[$\\]/.test(v)) bad(`"${field}" ("${v}") has LaTeX in it; diagram labels are plain text`);
    };
    // A rectangle the item draws inside: x, y, w and (when it has one) h.
    const rect = (withHeight: boolean): { x: number; y: number; w: number; h: number } | null => {
      const x = num("x");
      const y = num("y");
      const rw = num("w", 1);
      const rh = withHeight ? num("h", 1) : 0;
      if (x === null || y === null || rw === null || rh === null) return null;
      if (x < 0 || y < 0 || x + rw > W || y + rh > H) bad(`its box (${x}, ${y}, ${rw} by ${rh}) runs outside the ${W} by ${H} drawing`);
      return { x, y, w: rw, h: rh };
    };
    const disc = () => {
      const r = num("r", 0.5);
      if (place(it.c, "c") && r !== null) {
        const [cx, cy] = it.c;
        if (cx - r < 0 || cx + r > W || cy - r < 0 || cy + r > H) bad(`radius ${r} around [${cx}, ${cy}] runs outside the box`);
      }
    };

    switch (it.t) {
      case "line":
        place(it.a, "a");
        place(it.b, "b");
        if (typeof it.dash !== "boolean") bad('"dash" is not true or false');
        oneOf("arrow", ["none", "end", "both"]);
        break;
      case "poly":
        if (!Array.isArray(it.pts) || it.pts.length < 2) bad('"pts" needs at least two points');
        else it.pts.forEach((p, i) => place(p, `pts[${i}]`));
        if (typeof it.closed !== "boolean") bad('"closed" is not true or false');
        oneOf("fill", ["none", "light", "accent"]);
        break;
      case "circle":
        disc();
        oneOf("fill", ["none", "light", "accent"]);
        break;
      case "arc":
        disc();
        num("from");
        num("to");
        break;
      case "rightAngle":
        place(it.at, "at");
        place(it.a, "a");
        place(it.b, "b");
        break;
      case "tick":
        place(it.a, "a");
        place(it.b, "b");
        oneOf("n", [1, 2]);
        break;
      case "dot":
        place(it.at, "at");
        break;
      case "text":
        place(it.at, "at", false);
        label(it.s, "s");
        if (it.s === "") bad('"s" is empty');
        oneOf("size", ["s", "m", "l"]);
        oneOf("anchor", ["c", "l", "r"]);
        break;
      case "numberLine": {
        const y = num("y");
        const x0 = num("x0");
        const x1 = num("x1");
        const min = num("min");
        const max = num("max");
        const step = num("step");
        if (y !== null && (y < 0 || y > H)) bad(`"y" ${y} is outside the box`);
        if (x0 !== null && x1 !== null && (x0 < 0 || x1 > W || x0 >= x1)) bad(`"x0" to "x1" (${x0} to ${x1}) must run left to right inside the box`);
        if (min !== null && max !== null && min >= max) bad(`"min" ${min} is not below "max" ${max}`);
        if (step !== null && step <= 0) bad(`"step" must be more than 0`);
        if (min !== null && max !== null && step !== null && step > 0 && (max - min) / step > 40) bad("more than 40 steps");
        const inRange = (v: unknown) => isNumber(v) && (min === null || max === null || (v >= min && v <= max));
        if (Array.isArray(it.labels)) {
          if (!it.labels.every(inRange)) bad('"labels" has a number outside min to max');
        } else oneOf("labels", ["all", "ends", "none"]);
        if (!Array.isArray(it.points)) bad('"points" is not a list');
        else
          it.points.forEach((p, i) => {
            if (!isObject(p) || !inRange(p.v)) bad(`points[${i}] needs a value "v" between min and max`);
            else label(p.label, `points[${i}].label`, true);
          });
        break;
      }
      case "bars": {
        rect(true);
        const max = num("max");
        const step = num("step");
        if (max !== null && max <= 0) bad('"max" must be more than 0');
        if (step !== null && step <= 0) bad('"step" must be more than 0');
        const labels = it.labels;
        const values = it.values;
        if (!Array.isArray(labels) || labels.length === 0) bad('"labels" is not a list of names');
        else labels.forEach((l, i) => label(l, `labels[${i}]`));
        if (!Array.isArray(values) || !values.every((v) => isNumber(v) && v >= 0 && (max === null || v <= max))) bad('"values" must be numbers from 0 to "max"');
        if (Array.isArray(labels) && Array.isArray(values) && labels.length !== values.length) bad(`${labels.length} labels but ${values.length} values`);
        label(it.title, "title", true);
        label(it.ylabel, "ylabel", true);
        break;
      }
      case "table": {
        rect(false);
        const cols = it.cols;
        if (!Array.isArray(cols) || cols.length === 0) {
          bad('"cols" is not a list of headings');
          break;
        }
        cols.forEach((c, i) => label(c, `cols[${i}]`));
        if (!Array.isArray(it.rows) || it.rows.length === 0) bad('"rows" is empty');
        else
          it.rows.forEach((row, i) => {
            if (!Array.isArray(row) || row.length !== cols.length) bad(`rows[${i}] does not have ${cols.length} cells`);
            else row.forEach((cell, j) => label(cell, `rows[${i}][${j}]`));
          });
        break;
      }
      case "grid": {
        rect(true);
        const xmin = num("xmin");
        const xmax = num("xmax");
        const ymin = num("ymin");
        const ymax = num("ymax");
        if (xmin !== null && xmax !== null && xmin >= xmax) bad('"xmin" is not below "xmax"');
        if (ymin !== null && ymax !== null && ymin >= ymax) bad('"ymin" is not below "ymax"');
        const onGraph = (p: unknown) =>
          isPoint(p) && (xmin === null || xmax === null || (p[0] >= xmin && p[0] <= xmax)) && (ymin === null || ymax === null || (p[1] >= ymin && p[1] <= ymax));
        if (!Array.isArray(it.points)) bad('"points" is not a list');
        else
          it.points.forEach((p, i) => {
            if (!isObject(p) || !onGraph(p.p)) bad(`points[${i}] needs a point "p" on the graph`);
            else label(p.label, `points[${i}].label`, true);
          });
        if (!Array.isArray(it.segments)) bad('"segments" is not a list');
        else
          it.segments.forEach((seg, i) => {
            if (!Array.isArray(seg) || seg.length !== 2 || !seg.every(onGraph)) bad(`segments[${i}] needs two points on the graph`);
          });
        break;
      }
      case "pie": {
        disc();
        if (!Array.isArray(it.slices) || it.slices.length < 2) bad('"slices" needs at least two slices');
        else
          it.slices.forEach((sl, i) => {
            if (!isObject(sl) || !isNumber(sl.v) || sl.v <= 0) bad(`slices[${i}] needs a value "v" above 0`);
            else {
              label(sl.label, `slices[${i}].label`);
              if (![0, 1, 2, 3].includes(sl.shade as number)) bad(`slices[${i}].shade is not 0 to 3`);
            }
          });
        break;
      }
      default:
        bad("unknown kind of item");
    }
  });
  return { errors, warnings };
}

const OPTIONAL_KEYS = ["subtopic"];
const QUESTION_KEYS = ["id", "section", "topic", "type", "prompt", "columnA", "columnB", "choices", "answer", "explanation", "difficulty", "diagram", "source", "of", "ref"];

/** Everything wrong with one question taken alone (its links to other questions are checked in validateBank). */
export function questionProblems(q: unknown, level: Level): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(q)) return { errors: ["not an object"], warnings };

  for (const key of QUESTION_KEYS) if (!(key in q)) errors.push(`"${key}" is missing`);
  for (const key of Object.keys(q)) if (!QUESTION_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key)) warnings.push(`unknown field "${key}"`);

  const id = q.id;
  if (typeof id !== "string" || !ID.test(id)) errors.push(`id ${JSON.stringify(id)} is not like "L-0001" or "M-0001"`);
  else if (id[0] !== idPrefix(level)) errors.push(`id starts with ${id[0]} in the ${level} bank`);

  if (!SECTIONS.includes(q.section as Section)) errors.push(`section ${JSON.stringify(q.section)} is not qr or ma`);
  if (!TOPICS.includes(q.topic as Topic)) errors.push(`topic ${JSON.stringify(q.topic)} is not a known topic`);
  if (!TYPES.includes(q.type as QuestionType)) errors.push(`type ${JSON.stringify(q.type)} is not word, computation or comparison`);
  if (!SOURCES.includes(q.source as Source)) errors.push(`source ${JSON.stringify(q.source)} is not placeholder, real, written or variant`);
  if ("subtopic" in q && (typeof q.subtopic !== "string" || q.subtopic.trim() === "")) errors.push("subtopic must be a non-empty string when present");
  if (![1, 2, 3].includes(q.difficulty as number)) errors.push(`difficulty ${JSON.stringify(q.difficulty)} is not 1, 2 or 3`);

  const texts: [string, unknown][] = [
    ["prompt", q.prompt],
    ["explanation", q.explanation],
  ];
  const comparison = q.type === "comparison";
  if (comparison) {
    if (level !== "middle") errors.push("a comparison question outside the Middle Level bank");
    if (q.section === "ma") warnings.push("a comparison question in Mathematics Achievement (the test only has them in Quantitative Reasoning)");
    for (const col of ["columnA", "columnB"] as const) {
      if (typeof q[col] !== "string" || q[col].trim() === "") errors.push(`a comparison needs ${col}`);
      else texts.push([col, q[col]]);
    }
    if (JSON.stringify(q.choices) !== JSON.stringify(COMPARISON_CHOICES)) errors.push("a comparison's choices must be the four standard ones, in order");
  } else {
    for (const col of ["columnA", "columnB"] as const) if (q[col] !== null) errors.push(`${col} must be null unless the type is comparison`);
    if (typeof q.prompt === "string" && q.prompt.trim() === "") errors.push("prompt is empty");
  }

  const choices = q.choices;
  if (!Array.isArray(choices) || choices.length !== 4 || !choices.every((c) => typeof c === "string" && c.trim() !== "")) {
    errors.push("choices must be four non-empty strings");
  } else {
    choices.forEach((c, i) => texts.push([`choice ${"ABCD"[i]}`, c]));
    const seen = new Set(choices.map((c: string) => c.replace(/\s+/g, " ").trim().toLowerCase()));
    if (seen.size !== 4) errors.push("two choices are the same");
  }
  if (!Number.isInteger(q.answer) || (q.answer as number) < 0 || (q.answer as number) > 3) errors.push(`answer ${JSON.stringify(q.answer)} is not 0 to 3`);

  for (const [name, value] of texts) {
    if (typeof value !== "string") errors.push(`${name} is not a string`);
    else for (const p of textProblems(value)) errors.push(`${name}: ${p}`);
  }
  if (typeof q.prompt === "string") {
    const words = q.prompt.split(/\s+/).filter(Boolean).length;
    if (words > 45) warnings.push(`prompt is ${words} words (aim under 45)`);
  }
  if (typeof q.explanation === "string") {
    if (q.explanation.trim() === "") warnings.push("no explanation yet");
    else if (q.explanation.split("\n").length > 3) errors.push("explanation is more than three lines");
  }

  if (q.diagram !== null && q.diagram !== undefined) {
    const d = diagramProblems(q.diagram);
    errors.push(...d.errors.map((e) => `diagram ${e}`));
    warnings.push(...d.warnings.map((e) => `diagram ${e}`));
  } else if (typeof q.prompt === "string" && /\bshown\b/i.test(q.prompt)) {
    warnings.push('prompt says something is "shown" but there is no diagram');
  }

  if (q.ref !== null && typeof q.ref !== "string") errors.push("ref must be a string or null");
  if ((q.source === "real" || q.source === "written") && !q.ref) warnings.push(`a ${q.source} question with no ref (where it came from)`);
  if (q.source === "variant") {
    if (typeof q.of !== "string") errors.push('a variant needs "of", the id of the real question it came from');
    else if (typeof id === "string" && !id.startsWith(`${q.of}-v`)) warnings.push(`variant id does not start with "${q.of}-v"`);
  } else if (q.of !== null) errors.push('"of" must be null unless the source is variant');

  return { errors, warnings };
}

/** Everything wrong with a whole bank file's contents. */
export function validateBank(bank: unknown, expectLevel?: Level): Problem[] {
  const out: Problem[] = [];
  const err = (id: string | null, message: string) => out.push({ id, level: "error", message });
  if (!isObject(bank)) {
    err(null, "the file is not a JSON object");
    return out;
  }
  if (typeof bank.version !== "string" || bank.version === "") err(null, '"version" is missing');
  if (!LEVELS.includes(bank.level as Level)) {
    err(null, `"level" is ${JSON.stringify(bank.level)}, expected lower or middle`);
    return out;
  }
  const level = bank.level as Level;
  if (expectLevel && expectLevel !== level) err(null, `"level" is ${level} in a file named for ${expectLevel}`);
  if (!Array.isArray(bank.questions)) {
    err(null, '"questions" is not a list');
    return out;
  }
  if (bank.questions.length === 0) err(null, "the bank has no questions");

  const byId = new Map<string, Record<string, unknown>>();
  bank.questions.forEach((q, i) => {
    const id = isObject(q) && typeof q.id === "string" ? q.id : null;
    const name = id ?? `question ${i + 1}`;
    const found = questionProblems(q, level);
    for (const m of found.errors) err(name, m);
    for (const m of found.warnings) out.push({ id: name, level: "warning", message: m });
    if (id && isObject(q)) {
      if (byId.has(id)) err(id, "this id is used more than once");
      byId.set(id, q);
    }
  });
  for (const [id, q] of byId) {
    if (q.source !== "variant" || typeof q.of !== "string") continue;
    const parent = byId.get(q.of);
    if (!parent) err(id, `variant of "${q.of}", which is not in this bank`);
    else if (parent.source !== "real" && parent.source !== "written") err(id, `variant of "${q.of}", which is not a real or written question`);
  }
  return out;
}
