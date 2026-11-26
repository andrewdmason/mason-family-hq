/**
 * Turns the CSV of real ISEE math questions into the two bank files the
 * Tuttles Math game reads (math-lower.json, math-middle.json).
 *
 *   tsx scripts/math/import.mts questions.csv            report only, writes nothing
 *   tsx scripts/math/import.mts questions.csv --write    write the app's bank files and scripts/math/todo.json
 *   tsx scripts/math/import.mts questions.csv --out DIR  write the bank files and todo.json into DIR instead
 *
 *   --keep-placeholders   keep the placeholder questions beside the real ones
 *                         (by default a level drops them once it has real ones)
 *   --include-undrawn     also write questions whose CSV row describes a diagram
 *                         nobody has drawn yet (by default they wait in todo.json)
 *   --sidecars DIR        where to look for the sidecar files (default: this folder)
 *   --version NAME        the bank's "version" (default: "real-" + a hash of its questions)
 *
 * CSV columns (header row, any order, any case, spaces or underscores; other
 * columns are ignored): level, section, topic, type, question, choice_a to
 * choice_d, answer (A-D or the answer's text), explanation, difficulty,
 * diagram (a description in words), source (book and page), column_a,
 * column_b.
 *
 * A question's id comes from its level and a hash of its text, so importing
 * again keeps every id. What a spreadsheet can't hold is read from sidecar
 * files keyed by that id, when they exist:
 *   diagrams.json      { id: Diagram }
 *   explanations.json  { id: "line one\nline two\nThe answer is 5." }
 *   difficulty.json    { id: 1 | 2 | 3 }
 *   variants.json      { id: [ question without id/source/of, ... ] }
 * A value in the CSV wins over the sidecar. todo.json lists the ids still
 * missing a drawing, an explanation or a difficulty, and every row held back.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BANK_DIR,
  bankFile,
  COMPARISON_CHOICES,
  here,
  idPrefix,
  LEVELS,
  questionProblems,
  TOPICS,
  validateBank,
  type Bank,
  type Diagram,
  type Level,
  type Question,
  type QuestionType,
  type Section,
  type Topic,
} from "./bank.mts";

// ---------------------------------------------------------------- CSV

/** Rows of a CSV, with quoted fields that may hold commas, quotes ("") and line breaks. Each row knows the line it began on. */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  const s = text.replace(/^\uFEFF/, "");
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\n") line++;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else if (c !== "\r") cell += c;
    } else if (c === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else if (c === "\n") {
      endRow();
      rowLine = line;
    } else if (c !== "\r") cell += c;
  }
  if (cell !== "" || cells.length) endRow();
  return rows;
}

const FIELDS: Record<string, string[]> = {
  level: ["level"],
  section: ["section"],
  topic: ["topic"],
  type: ["type", "questiontype"],
  question: ["question", "prompt", "questiontext"],
  choiceA: ["choicea", "a", "optiona"],
  choiceB: ["choiceb", "b", "optionb"],
  choiceC: ["choicec", "c", "optionc"],
  choiceD: ["choiced", "d", "optiond"],
  answer: ["answer", "correctanswer", "correct"],
  explanation: ["explanation", "solution"],
  difficulty: ["difficulty"],
  diagram: ["diagram", "diagramdescription", "figure"],
  source: ["source", "ref", "reference", "bookandpage"],
  columnA: ["columna", "cola"],
  columnB: ["columnb", "colb"],
};

// ---------------------------------------------------------------- reading a row

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => squash(s).toLowerCase();

function readLevel(s: string): Level | null {
  const k = key(s).replace(/ level$/, "");
  return k === "lower" || k === "l" ? "lower" : k === "middle" || k === "m" ? "middle" : null;
}

function readSection(s: string): Section | null {
  const k = key(s);
  if (k === "qr" || k.startsWith("quantitative")) return "qr";
  if (k === "ma" || k.startsWith("math")) return "ma";
  return null;
}

function readType(s: string): QuestionType | null {
  const k = key(s);
  if (k === "" || k.startsWith("word")) return "word";
  if (k === "qc" || k.includes("comparison")) return "comparison";
  if (k.startsWith("comput") || k.startsWith("calc")) return "computation";
  return null;
}

/** Words a spreadsheet might use for a topic, and the known topic each belongs to. The earliest match in the text wins. */
const TOPIC_WORDS: [RegExp, Topic][] = [
  [/\bwhole numbers?|\bintegers?|\boperations?|\barithmetic|\baddition|\bsubtraction|\bmultiplication|\bdivision/, "whole numbers"],
  [/\bfractions?|\bmixed numbers?/, "fractions"],
  [/\bdecimals?/, "decimals"],
  [/\bpercent/, "percent"],
  [/\bratios?\b|\bproportions?|\brates?\b/, "ratios"],
  [/\balgebra|\bequations?|\bexpressions?|\bvariables?|\binequalit/, "algebra"],
  [/\bgeometry|\barea\b|\bperimeter|\bangles?|\bshapes?|\bcoordinates?|\bvolume|\btriangles?|\bcircles?/, "geometry"],
  [/\bmeasurement|\bunits?\b|\btime\b|\bmoney|\bconversions?/, "measurement"],
  [/\bdata\b|\bstatistics|\bgraphs?|\bmean\b|\bmedian|\bcharts?|\btables?/, "data"],
  [/\bprobability|\bchance/, "probability"],
  [/\bpatterns?|\bsequences?/, "patterns"],
  [/\bestimat|\brounding/, "estimation"],
  [/\bnumber sense|\bfactors?|\bmultiples?|\bprimes?|\bexponents?|\bplace value|\bnumber theory|\broots?\b/, "number sense"],
];

export function readTopic(s: string): { topic: Topic; exact: boolean } | null {
  const k = key(s);
  const exact = TOPICS.find((t) => t === k);
  if (exact) return { topic: exact, exact: true };
  let best: { at: number; topic: Topic } | null = null;
  for (const [words, topic] of TOPIC_WORDS) {
    const m = words.exec(k);
    if (m && (!best || m.index < best.at)) best = { at: m.index, topic };
  }
  return best ? { topic: best.topic, exact: false } : null;
}

function readDifficulty(s: string): 1 | 2 | 3 | null {
  const k = key(s);
  if (k === "1" || k === "easy") return 1;
  if (k === "2" || k === "medium") return 2;
  if (k === "3" || k === "hard") return 3;
  return null;
}

/**
 * The bank writes maths between dollar signs and money as "\$". A spreadsheet
 * will mostly just say "$5.50", so a dollar sign in front of a number is
 * taken as money unless the text's dollar signs already pair up around
 * things that read as maths ("$3x + 5 = 20$").
 */
export function fixDollars(s: string): string {
  const parts = s.split(/(\\\$)/); // keep what is already escaped apart
  const bare = parts.filter((p) => p !== "\\$").join("\uE000");
  const spans = bare.split("$");
  if (spans.length === 1) return s;
  const paired = spans.length % 2 === 1;
  const mathy = (m: string) => m !== "" && m === m.trim() && !m.includes("\uE000") && !/[A-Za-z]{2,}/.test(m.replace(/\\[A-Za-z]+/g, ""));
  if (paired && spans.every((span, i) => i % 2 === 0 || mathy(span))) return s;
  return parts.map((p) => (p === "\\$" ? p : p.replace(/\$(?=\.?\d)/g, "\\$"))).join("");
}

const clean = (s: string | undefined) => fixDollars((s ?? "").replace(/\r/g, "").trim());

function readAnswer(raw: string, choices: string[], comparison: boolean): number | null {
  const k = key(raw);
  const letter = /^\(?([a-d])\)?\.?$/.exec(k);
  if (letter) return "abcd".indexOf(letter[1]);
  const plain = (s: string) => key(s).replace(/\\\$/g, "$").replace(/\.$/, "");
  const hits = choices.map((c, i) => (plain(c) === plain(raw) ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 1) return hits[0];
  if (comparison) {
    if (k.includes("cannot") || k.includes("not enough")) return 3;
    if (k.includes("equal")) return 2;
    if (/column a|\ba is greater/.test(k)) return 0;
    if (/column b|\bb is greater/.test(k)) return 1;
  }
  return null;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 8);

/** What identifies a question: its level and its text (and columns), ignoring case and spacing. */
export function questionKey(level: Level, question: string, columnA = "", columnB = ""): string {
  return [level, key(question), key(columnA), key(columnB)].join("|");
}

/** The id for a question whose text no other row at its level shares. */
export function questionId(level: Level, question: string, columnA = "", columnB = ""): string {
  return `${idPrefix(level)}-${hash(questionKey(level, question, columnA, columnB))}`;
}

// ---------------------------------------------------------------- the import

export type Options = {
  csv: string;
  /** Folder to write math-*.json and todo.json into; nothing is written without it. */
  out?: string;
  /** Where todo.json goes when it should not sit in `out`. */
  todo?: string;
  sidecars?: string;
  /** Folder whose existing bank files supply the placeholder questions. */
  placeholders?: string;
  keepPlaceholders?: boolean;
  includeUndrawn?: boolean;
  version?: string;
};

type Missing = { id: string; level: Level; row: number; question: string };
type Held = { row: number | null; id: string | null; level: Level | null; question: string; reasons: string[] };

export type Result = {
  banks: Partial<Record<Level, Bank>>;
  counts: Record<Level, { real: number; variants: number; placeholders: number; section: Record<string, number>; topic: Record<string, number>; type: Record<string, number> }>;
  rows: number;
  mappedTopics: Record<string, string>;
  unknownTopics: string[];
  dollarsEscaped: number;
  todo: {
    diagram: (Missing & { description: string })[];
    explanation: Missing[];
    difficulty: Missing[];
    heldBack: Held[];
  };
  notes: string[];
  written: string[];
};

function readJson<T>(file: string, otherwise: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : otherwise;
}

export function runImport(opts: Options): Result {
  const sidecars = opts.sidecars ?? here;
  const diagrams = readJson<Record<string, Diagram>>(path.join(sidecars, "diagrams.json"), {});
  const explanations = readJson<Record<string, string>>(path.join(sidecars, "explanations.json"), {});
  const difficulties = readJson<Record<string, number>>(path.join(sidecars, "difficulty.json"), {});
  const variants = readJson<Record<string, Partial<Question>[]>>(path.join(sidecars, "variants.json"), {});

  const result: Result = {
    banks: {},
    counts: Object.fromEntries(LEVELS.map((l) => [l, { real: 0, variants: 0, placeholders: 0, section: {}, topic: {}, type: {} }])) as Result["counts"],
    rows: 0,
    mappedTopics: {},
    unknownTopics: [],
    dollarsEscaped: 0,
    todo: { diagram: [], explanation: [], difficulty: [], heldBack: [] },
    notes: [],
    written: [],
  };

  const table = parseCsv(readFileSync(opts.csv, "utf8"));
  if (table.length === 0) throw new Error(`${opts.csv} is empty`);
  const header = table[0].cells.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const column: Record<string, number> = {};
  for (const [field, names] of Object.entries(FIELDS)) column[field] = header.findIndex((h) => names.includes(h));
  const absent = ["level", "section", "topic", "question", "answer"].filter((f) => column[f] < 0);
  if (absent.length) throw new Error(`the CSV has no column for: ${absent.join(", ")} (found: ${table[0].cells.join(", ")})`);

  // First pass: read every row far enough to know its level and text, so ids can be settled.
  type Row = { line: number; get: (f: string) => string; raw: (f: string) => string; level: Level | null; idKey: string; id: string | null };
  const rows: Row[] = table.slice(1).map(({ line, cells }) => {
    const raw = (f: string) => (column[f] >= 0 ? (cells[column[f]] ?? "") : "");
    const get = (f: string) => {
      const before = raw(f).replace(/\r/g, "").trim();
      const after = clean(raw(f));
      if (after !== before) result.dollarsEscaped++;
      return after;
    };
    const level = readLevel(raw("level"));
    return { line, raw, get, level, idKey: level ? questionKey(level, raw("question"), raw("columnA"), raw("columnB")) : "", id: null };
  });
  result.rows = rows.length;

  // Rows that share a level and text (two "Which is greatest?") are told apart by their choices as well.
  const sharing = new Map<string, Row[]>();
  for (const r of rows) if (r.level) sharing.set(r.idKey, [...(sharing.get(r.idKey) ?? []), r]);
  const taken = new Map<string, Row>();
  const duplicates = new Set<Row>();
  for (const group of sharing.values()) {
    for (const r of group) {
      const level = r.level as Level;
      const full = group.length === 1 ? r.idKey : [r.idKey, ...["choiceA", "choiceB", "choiceC", "choiceD"].map((f) => key(r.raw(f)))].join("|");
      const id = `${idPrefix(level)}-${hash(full)}`;
      if (taken.has(id)) duplicates.add(r);
      else taken.set(id, r);
      r.id = id;
    }
  }

  const real: Record<Level, Question[]> = { lower: [], middle: [] };
  const hold = (r: Row, reasons: string[]) => result.todo.heldBack.push({ row: r.line, id: r.id, level: r.level, question: squash(r.raw("question")).slice(0, 80), reasons });

  for (const r of rows) {
    const reasons: string[] = [];
    if (!r.level) {
      hold(r, [`level "${r.raw("level")}" is not lower or middle`]);
      continue;
    }
    const level = r.level;
    const id = r.id as string;
    if (duplicates.has(r)) {
      hold(r, [`the same question as line ${taken.get(id)?.line}`]);
      continue;
    }
    const section = readSection(r.raw("section"));
    if (!section) reasons.push(`section "${r.raw("section")}" is not quantitative reasoning or mathematics achievement`);
    const type = readType(r.raw("type"));
    if (!type) reasons.push(`type "${r.raw("type")}" is not word problem, computation or quantitative comparison`);
    const topicText = squash(r.raw("topic"));
    const topic = readTopic(topicText);
    if (!topic) {
      reasons.push(`topic "${topicText}" is not one this bank knows`);
      if (!result.unknownTopics.includes(topicText)) result.unknownTopics.push(topicText);
    } else if (!topic.exact) result.mappedTopics[topicText] = topic.topic;

    const comparison = type === "comparison";
    const choices = comparison ? COMPARISON_CHOICES.slice() : ["choiceA", "choiceB", "choiceC", "choiceD"].map((f) => r.get(f));
    if (!comparison && choices.some((c) => c === "")) reasons.push("needs all four choices");
    const answer = readAnswer(r.raw("answer"), choices, comparison);
    if (answer === null) reasons.push(`answer "${squash(r.raw("answer"))}" is not A to D and matches no choice`);

    const who: Missing = { id, level, row: r.line, question: squash(r.raw("question")).slice(0, 80) };
    const explanation = r.get("explanation") || (explanations[id] ?? "").trim();
    if (!explanation) result.todo.explanation.push(who);
    const fromCsv = readDifficulty(r.raw("difficulty"));
    if (r.raw("difficulty").trim() && !fromCsv) reasons.push(`difficulty "${r.raw("difficulty").trim()}" is not 1, 2 or 3`);
    const difficulty = fromCsv ?? ([1, 2, 3].includes(difficulties[id]) ? (difficulties[id] as 1 | 2 | 3) : null);
    if (!difficulty) result.todo.difficulty.push(who);
    const description = squash(r.raw("diagram"));
    const diagram = diagrams[id] ?? null;
    const undrawn = description !== "" && !diagram;
    if (undrawn) result.todo.diagram.push({ ...who, description });

    if (reasons.length) {
      hold(r, reasons);
      continue;
    }
    const q: Question = {
      id,
      section: section as Section,
      topic: (topic as { topic: Topic }).topic,
      type: type as QuestionType,
      prompt: r.get("question"),
      columnA: comparison ? r.get("columnA") : null,
      columnB: comparison ? r.get("columnB") : null,
      choices,
      answer: answer as number,
      explanation,
      difficulty: difficulty ?? 2, // a guess until someone rates it; listed in todo.json
      diagram,
      source: "real",
      of: null,
      ref: squash(r.raw("source")) || null,
    };
    const found = questionProblems(q, level).errors;
    if (found.length) {
      hold(r, found);
      continue;
    }
    if (undrawn && !opts.includeUndrawn) {
      hold(r, ["waiting for its diagram to be drawn (diagrams.json)"]);
      continue;
    }
    real[level].push(q);
  }

  // Variants ride behind the real question they were made from.
  const byId = new Map(LEVELS.flatMap((l) => real[l].map((q) => [q.id, { q, level: l }] as const)));
  const variantsOf = new Map<string, Question[]>();
  for (const [parentId, list] of Object.entries(variants)) {
    const parent = byId.get(parentId);
    if (!parent) {
      result.notes.push(`variants.json: ${list.length} variant${list.length === 1 ? "" : "s"} of ${parentId} skipped, that question is not in the bank`);
      continue;
    }
    list.forEach((v, i) => {
      const type = v.type ?? parent.q.type;
      const q: Question = {
        id: `${parentId}-v${i + 1}`,
        section: v.section ?? parent.q.section,
        topic: v.topic ?? parent.q.topic,
        type,
        prompt: v.prompt ?? "",
        columnA: v.columnA ?? null,
        columnB: v.columnB ?? null,
        choices: v.choices ?? (type === "comparison" ? COMPARISON_CHOICES.slice() : []),
        answer: v.answer as number,
        explanation: v.explanation ?? "",
        difficulty: v.difficulty ?? parent.q.difficulty,
        diagram: v.diagram ?? null,
        source: "variant",
        of: parentId,
        ref: v.ref ?? parent.q.ref,
      };
      const found = questionProblems(q, parent.level).errors;
      if (found.length) result.todo.heldBack.push({ row: null, id: q.id, level: parent.level, question: squash(q.prompt).slice(0, 80), reasons: found });
      else variantsOf.set(parentId, [...(variantsOf.get(parentId) ?? []), q]);
    });
  }

  for (const level of LEVELS) {
    const existing = readJson<Bank | null>(bankFile(opts.placeholders ?? BANK_DIR, level), null);
    const placeholders = (existing?.questions ?? []).filter((q) => q.source === "placeholder");
    if (real[level].length === 0) {
      result.notes.push(`${level}: no real questions to write, so its bank file is left as it is`);
      continue;
    }
    const questions = real[level].flatMap((q) => [q, ...(variantsOf.get(q.id) ?? [])]);
    const c = result.counts[level];
    for (const q of questions) {
      if (q.source === "variant") c.variants++;
      else c.real++;
      for (const k of ["section", "topic", "type"] as const) c[k][q[k]] = (c[k][q[k]] ?? 0) + 1;
    }
    if (opts.keepPlaceholders) {
      questions.push(...placeholders);
      c.placeholders = placeholders.length;
    }
    const bank: Bank = { version: opts.version ?? `real-${hash(JSON.stringify(questions))}`, level, questions };
    const errors = validateBank(bank, level).filter((p) => p.level === "error");
    if (errors.length) throw new Error(`the ${level} bank would not pass the checker: ${errors.map((e) => `${e.id}: ${e.message}`).join("; ")}`);
    result.banks[level] = bank;
  }

  if (opts.out) {
    mkdirSync(opts.out, { recursive: true });
    for (const level of LEVELS) {
      const bank = result.banks[level];
      if (!bank) continue;
      const file = bankFile(opts.out, level);
      writeFileSync(file, JSON.stringify(bank, null, 2) + "\n");
      result.written.push(file);
    }
    const todoFile = opts.todo ?? path.join(opts.out, "todo.json");
    writeFileSync(todoFile, JSON.stringify({ csv: path.basename(opts.csv), ...result.todo }, null, 2) + "\n");
    result.written.push(todoFile);
  }
  return result;
}

// ---------------------------------------------------------------- the report

export function report(r: Result): string {
  const lines: string[] = [];
  const list = (o: Record<string, number>) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(", ") || "none";
  lines.push(`${r.rows} rows read`);
  for (const level of LEVELS) {
    const c = r.counts[level];
    lines.push(`\n${level}: ${c.real} real${c.variants ? `, ${c.variants} variants` : ""}${c.placeholders ? `, ${c.placeholders} placeholders kept` : ""}`);
    lines.push(`  by section: ${list(c.section)}`);
    lines.push(`  by topic:   ${list(c.topic)}`);
    lines.push(`  by type:    ${list(c.type)}`);
  }
  if (Object.keys(r.mappedTopics).length) {
    lines.push("\nTopics read as a known topic:");
    for (const [from, to] of Object.entries(r.mappedTopics)) lines.push(`  "${from}" -> ${to}`);
  }
  if (r.unknownTopics.length) lines.push(`\nTopics not recognised (their rows are held back): ${r.unknownTopics.map((t) => `"${t}"`).join(", ")}`);
  if (r.dollarsEscaped) lines.push(`\n${r.dollarsEscaped} field${r.dollarsEscaped === 1 ? "" : "s"} had a money dollar sign escaped (\\$)`);
  const still = (title: string, items: { id: string; row: number; question: string; description?: string }[]) => {
    lines.push(`\n${title}: ${items.length}`);
    for (const m of items.slice(0, 20)) lines.push(`  ${m.id} (line ${m.row}) ${m.description ? `[${m.description}] ` : ""}${m.question}`);
    if (items.length > 20) lines.push(`  ... and ${items.length - 20} more, all in todo.json`);
  };
  still("Still need a diagram drawn (diagrams.json)", r.todo.diagram);
  still("Still need an explanation (explanations.json)", r.todo.explanation);
  still("Still need a difficulty (difficulty.json; written as 2 until then)", r.todo.difficulty);
  lines.push(`\nHeld back, not written to the bank: ${r.todo.heldBack.length}`);
  for (const h of r.todo.heldBack.slice(0, 30)) lines.push(`  ${h.row ? `line ${h.row}` : "variant"}${h.id ? ` ${h.id}` : ""}: ${h.reasons.join("; ")}`);
  if (r.todo.heldBack.length > 30) lines.push(`  ... and ${r.todo.heldBack.length - 30} more, all in todo.json`);
  for (const n of r.notes) lines.push(`\nNote: ${n}`);
  lines.push(r.written.length ? `\nWrote:\n${r.written.map((f) => `  ${f}`).join("\n")}` : "\nNothing written (a report only). Add --write to update the app's bank, or --out DIR.");
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    args.splice(i, 2);
    return v;
  };
  const has = (flag: string) => {
    const i = args.indexOf(flag);
    if (i >= 0) args.splice(i, 1);
    return i >= 0;
  };
  try {
    const out = value("--out");
    const sidecars = value("--sidecars");
    const version = value("--version");
    const write = has("--write");
    const keepPlaceholders = has("--keep-placeholders");
    const includeUndrawn = has("--include-undrawn");
    const unknown = args.filter((a) => a.startsWith("--"));
    if (unknown.length) throw new Error(`unknown option ${unknown.join(", ")}`);
    if (args.length !== 1) throw new Error("usage: tsx scripts/math/import.mts questions.csv [--write | --out DIR] [--keep-placeholders] [--include-undrawn] [--sidecars DIR] [--version NAME]");
    if (write && out) throw new Error("use --write or --out, not both");
    const result = runImport({
      csv: args[0],
      out: write ? BANK_DIR : out,
      todo: write ? path.join(here, "todo.json") : undefined,
      sidecars,
      version,
      keepPlaceholders,
      includeUndrawn,
    });
    console.log(report(result));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
