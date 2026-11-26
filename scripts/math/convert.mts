/**
 * Turns the raw export of the question Sheet (scripts/math/source/
 * {lower,middle}.raw.json: every cell exactly as the Sheet returned it) into
 * the CSV import.mts reads, scripts/math/source/questions.csv.
 *
 *   tsx scripts/math/convert.mts
 *
 * Two jobs:
 *
 * 1. Undo what the Sheet did to the cells. A choice typed "1/2" comes back
 *    as the date {"date":"2026-01-02"}, "3" as 3.0, "$2.00" and "50%" as
 *    {"number":…,"shown":…}, and a negative typed as text keeps the leading
 *    apostrophe ("'-67").
 * 2. Write the text the way the bank wants it: maths between dollar signs
 *    with the few LaTeX commands the app knows, money as "\$". This is done
 *    only where the text reads unmistakably as an expression; anything
 *    doubtful is left as plain text, which the app also shows correctly.
 *
 * Everything recovered or rewritten is listed in source/conversion-log.json
 * so it can be read against the raw cells.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { here, LEVELS, TOPICS, textProblems, type Level } from "./bank.mjs";

const SOURCE = path.join(here, "source");
const COLUMNS = ["id", "level", "section", "topic", "type", "question", "choice_a", "choice_b", "choice_c", "choice_d", "answer", "explanation", "difficulty", "diagram", "source"];

// ---------------------------------------------------------------- cells

export type Recovery = { kind: "date" | "apostrophe" | "other"; raw: unknown; text: string; certain: boolean; note?: string };

/** The text a cell held before the Sheet typed it, and what had to be undone to get it. */
export function cellText(cell: unknown, sheetYear = 2026): { text: string; recovery?: Recovery } {
  if (cell === null || cell === undefined) return { text: "" };
  if (typeof cell === "string") {
    // A leading apostrophe is the Sheet's "this is text" mark, left on negatives typed as text.
    if (/^'[-−+]?[\d.]/.test(cell)) return { text: cell.slice(1), recovery: { kind: "apostrophe", raw: cell, text: cell.slice(1), certain: true } };
    return { text: cell };
  }
  if (typeof cell === "number") return { text: String(cell) }; // 3.0 was parsed as 3, so this is "3"; 2.5 stays "2.5"
  if (typeof cell === "boolean") return { text: cell ? "TRUE" : "FALSE", recovery: { kind: "other", raw: cell, text: cell ? "TRUE" : "FALSE", certain: false, note: "a boolean cell" } };
  if (typeof cell === "object") {
    const o = cell as Record<string, unknown>;
    if (typeof o.date === "string") {
      const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(o.date);
      if (m) {
        const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
        // "3/4" was read as March 4 of the sheet's year. Another year means the text had a year
        // in it ("1/32" read as January 2032), which needs a person to look.
        const text = `${month}/${day}`;
        if (year === sheetYear) return { text, recovery: { kind: "date", raw: cell, text, certain: true } };
        const guess = day === 1 ? `${month}/${year % 100}` : text;
        return { text: guess, recovery: { kind: "date", raw: cell, text: guess, certain: false, note: `the year is ${year}, not ${sheetYear}` } };
      }
    }
    if (typeof o.shown === "string") return { text: o.shown };
    if (typeof o.markdown === "string") {
      const text = o.markdown.replace(/[*_`#]/g, "").trim();
      return { text, recovery: { kind: "other", raw: cell, text, certain: false, note: "markdown reduced to its words" } };
    }
    if (typeof o.time === "string" || typeof o.dateTime === "string") {
      const t = /(\d{1,2}):(\d\d)/.exec(String(o.time ?? o.dateTime));
      const text = t ? `${Number(t[1])}:${t[2]}` : JSON.stringify(cell);
      return { text, recovery: { kind: "other", raw: cell, text, certain: false, note: "a time cell, read as h:mm (perhaps a ratio)" } };
    }
  }
  const text = JSON.stringify(cell);
  return { text, recovery: { kind: "other", raw: cell, text, certain: false, note: "a cell of a kind this script does not know" } };
}

// ---------------------------------------------------------------- maths markup

type Tok = { k: "num" | "let" | "op" | "lp" | "rp" | "sup" | "sub" | "pi" | "sqrt" | "deg" | "sp" | "stop"; s: string; comma?: boolean };

const OPS: Record<string, string> = { "+": "+", "=": "=", "<": "<", ">": ">", "×": "\\times", "÷": "\\div", "·": "\\cdot", "−": "-", "-": "-", "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "/": "/", "^": "^" };
const SUP: Record<string, string> = { "²": "2", "³": "3" };
const SUB: Record<string, string> = { "₁": "1", "₂": "2" };
const TWO_LETTER_WORDS = new Set("is of to in at by an as or if it on so we he me my no up do be am pm cm ft mm km kg lb oz ml yd mi hr sq".split(" "));
const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);
    const num = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/.exec(rest) ?? /^\.\d+/.exec(rest);
    if (num && !isLetter(s[i - 1])) {
      out.push({ k: "num", s: num[0], comma: num[0].includes(",") });
      i += num[0].length;
    } else if (isLetter(c)) {
      const word = /^[A-Za-zÀ-ÖØ-öø-ÿ]+/.exec(rest)?.[0] ?? c;
      // Two letters are a product of variables (Bh, mx, lw) only right beside an operator, and never a common word or unit.
      const beside = "=+−×÷/".includes(s.slice(0, i).trimEnd().slice(-1) || " ") || "=+−×÷/^".includes(s.slice(i + word.length).trimStart()[0] ?? " ");
      const product = word.length === 2 && beside && !TWO_LETTER_WORDS.has(word.toLowerCase());
      const variable = word.length === 1 ? s[i - 1] !== "'" && s[i - 1] !== "’" : /^[xyz]{2}$/.test(word) || (/^[A-Z]{2}$/.test(word) && word !== "AM" && word !== "PM") || product;
      out.push({ k: variable ? "let" : "stop", s: word });
      i += word.length;
    } else if (c === " ") {
      out.push({ k: "sp", s: c });
      i++;
    } else if (c === "-") {
      // An ASCII hyphen is a minus only where it can't be a hyphen: "= -13", "(-5", "5 - 3". "x-axis" and "2-unit" are words.
      const before = s[i - 1];
      const after = s[i + 1];
      const startsValue = isDigit(after) || isLetter(after) || after === "(" || after === "." || after === "√";
      const unary = startsValue && (before === undefined || before === " " || before === "(" || "=+×÷−<>/^".includes(before));
      const binary = before === " " && after === " ";
      out.push({ k: unary || binary ? "op" : "stop", s: c });
      i++;
    } else if (c in OPS) {
      out.push({ k: "op", s: c });
      i++;
    } else if (c === "(") {
      out.push({ k: "lp", s: c });
      i++;
    } else if (c === ")") {
      out.push({ k: "rp", s: c });
      i++;
    } else if (c in SUP) {
      out.push({ k: "sup", s: c });
      i++;
    } else if (c in SUB) {
      out.push({ k: "sub", s: c });
      i++;
    } else if (c === "π") {
      out.push({ k: "pi", s: c });
      i++;
    } else if (c === "√") {
      out.push({ k: "sqrt", s: c });
      i++;
    } else if (c === "°") {
      out.push({ k: "deg", s: c });
      i++;
    } else {
      out.push({ k: "stop", s: c });
      i++;
    }
  }
  return out;
}

class Doubt extends Error {}

/** LaTeX for a run of tokens that has already been judged to be an expression. Throws Doubt at anything it isn't sure of. */
function latex(toks: Tok[]): string {
  let i = 0;
  // A piece of output that can be the top or bottom of a fraction.
  type Part = { s: string; value: boolean; simpleInt?: boolean; group?: string; space?: boolean };
  const seq = (untilParen: boolean): Part[] => {
    const parts: Part[] = [];
    while (i < toks.length) {
      const t = toks[i];
      if (t.k === "rp") {
        if (!untilParen) throw new Doubt("stray )");
        break;
      }
      i++;
      if (t.k === "sp") parts.push({ s: " ", value: false, space: true });
      else if (t.k === "op") parts.push({ s: t.s, value: false });
      else if (t.k === "num") parts.push({ s: t.s, value: true, simpleInt: /^\d+$/.test(t.s) });
      else if (t.k === "let") parts.push({ s: t.s, value: true });
      else if (t.k === "pi") parts.push({ s: "\\pi", value: true });
      else if (t.k === "lp") {
        const inner = join(seq(true));
        if (toks[i]?.k !== "rp") throw new Doubt("unclosed (");
        i++;
        parts.push({ s: `(${inner})`, value: true, group: inner });
      } else if (t.k === "sqrt") {
        const next = toks[i];
        if (next?.k === "lp") {
          i++;
          const inner = join(seq(true));
          if (toks[i]?.k !== "rp") throw new Doubt("unclosed √(");
          i++;
          parts.push({ s: `\\sqrt{${inner}}`, value: true });
        } else if (next?.k === "num" || next?.k === "let") {
          i++;
          parts.push({ s: `\\sqrt{${next.s}}`, value: true });
        } else throw new Doubt("√ of what");
      } else if (t.k === "sup" || t.k === "sub" || t.k === "deg") {
        const prev = parts[parts.length - 1];
        if (!prev?.value) throw new Doubt(`${t.s} after nothing`);
        prev.s += t.k === "sup" ? `^${SUP[t.s]}` : t.k === "sub" ? `_${SUB[t.s]}` : "^\\circ";
        prev.simpleInt = false;
        prev.group = undefined;
      } else throw new Doubt(`unexpected ${t.s}`);
    }
    return parts;
  };

  // Exponents written with ^, then fractions written with /, then the operators.
  const join = (parts: Part[]): string => {
    // x^10, 3^2, x^-2
    for (let j = 0; j < parts.length; j++) {
      if (parts[j].s !== "^" || parts[j].value) continue;
      const base = parts[j - 1];
      let exp = parts[j + 1];
      let take = 1;
      if (exp && !exp.value && exp.s === "-" && parts[j + 2]?.value) {
        exp = { ...parts[j + 2], s: `-${parts[j + 2].s}` };
        take = 2;
      }
      if (!base?.value || !exp?.value) throw new Doubt("^ without both sides");
      const e = exp.group ?? exp.s;
      base.s += e.length === 1 ? `^${e}` : `^{${e}}`;
      base.simpleInt = false;
      base.group = undefined;
      parts.splice(j, 1 + take);
      j--;
    }
    // Values written with nothing between them are one term: 2x, 5(x + 4), 3π.
    const terms: Part[] = [];
    for (const p of parts) {
      const prev = terms[terms.length - 1];
      if (p.value && prev?.value) terms[terms.length - 1] = { s: prev.s + (/\\[A-Za-z]+$/.test(prev.s) && /^[A-Za-z]/.test(p.s) ? " " : "") + p.s, value: true };
      else terms.push({ ...p });
    }
    // a/b
    for (let j = 0; j < terms.length; j++) {
      if (terms[j].value || terms[j].s !== "/") continue;
      const top = terms[j - 1];
      const bottom = terms[j + 1];
      if (!top?.value || !bottom?.value) throw new Doubt("/ without both sides");
      if (terms[j + 2] && !terms[j + 2].value && terms[j + 2].s === "/") throw new Doubt("a/b/c");
      const frac: Part = { s: `\\frac{${top.group ?? top.s}}{${bottom.group ?? bottom.s}}`, value: true };
      // A whole number, a space, then a fraction of whole numbers is a mixed number: 3 1/4.
      const whole = terms[j - 3];
      if (terms[j - 2]?.space && whole?.value) {
        if (!(whole.simpleInt && top.simpleInt && bottom.simpleInt)) throw new Doubt("two values side by side");
        terms.splice(j - 3, 5, { s: whole.s + frac.s, value: true });
        j -= 3;
      } else {
        terms.splice(j - 1, 3, frac);
        j -= 1;
      }
    }
    // What is left must go value, operator, value…; two values with only a space between are not an expression.
    let out = "";
    let last: Part | null = null;
    for (const [n, p] of terms.entries()) {
      if (p.space) {
        out += " ";
        continue;
      }
      // "− 21 = 107" with a gap after the sign is the tail of something, not a negative number.
      if (!p.value && !last?.value && terms[n + 1]?.space) throw new Doubt(`operator ${p.s} with nothing before it`);
      if (p.value) {
        if (last?.value) throw new Doubt("two values side by side");
        out += p.s;
      } else {
        if (p.s === "/" || p.s === "^") throw new Doubt(`left-over ${p.s}`);
        const unary = p.s === "-" || p.s === "−";
        if (!last?.value && !unary) throw new Doubt(`operator ${p.s} with nothing before it`);
        const cmd = OPS[p.s];
        out += cmd.startsWith("\\") ? `${out.endsWith(" ") || out === "" ? "" : " "}${cmd} ` : cmd;
      }
      last = p;
    }
    if (last && !last.value) throw new Doubt("ends on an operator");
    return out.replace(/ {2,}/g, " ").trim();
  };

  const result = join(seq(false));
  if (i < toks.length) throw new Doubt("stray )");
  return result;
}

const COORDS = /\(\s*[-−]?\d+(?:\.\d+)?\s*,\s*[-−]?\d+(?:\.\d+)?\s*\)/g;
const money = (s: string) => s.replace(/\$(?=[-−]?\.?\d)/g, "\\$");

/**
 * Bank markup for a piece of plain text. `doubt` is set when part of it
 * looked like maths but could not be read with certainty; the caller then
 * uses `plain` (money escaped, nothing else touched) for the whole field.
 */
export function markup(text: string): { text: string; plain: string; doubt: string | null } {
  const plain = money(text);
  if (text.includes("|")) return { text: plain, plain, doubt: null }; // stem-and-leaf rows are not expressions
  let doubt: string | null = null;
  const pieces: string[] = [];
  let at = 0;
  const prose = (s: string) => {
    const toks = tokenize(s);
    let j = 0;
    while (j < toks.length) {
      if (toks[j].k === "stop" || toks[j].k === "sp") {
        pieces.push(toks[j].s);
        j++;
        continue;
      }
      let end = j;
      while (end < toks.length && toks[end].k !== "stop") end++;
      const run = toks.slice(j, end);
      j = end;
      let before = "";
      let after = "";
      // Trim spaces, brackets that belong to the sentence, and single letters that are words or units beside a number.
      for (let changed = true; changed; ) {
        changed = false;
        while (run.length && run[0].k === "sp") before += run.shift()?.s;
        while (run.length && run[run.length - 1].k === "sp") after = run.pop()?.s + after;
        const depth = run.reduce((d, t) => d + (t.k === "lp" ? 1 : t.k === "rp" ? -1 : 0), 0);
        if (depth > 0 && run[0]?.k === "lp") {
          before += run.shift()?.s;
          changed = true;
        } else if (depth < 0 && run[run.length - 1]?.k === "rp") {
          after = run.pop()?.s + after;
          changed = true;
        } else if (run[0]?.k === "let" && run[1]?.k === "sp" && ["num", "let", "sqrt", "lp", "pi"].includes(run[2]?.k)) {
          before += run.shift()?.s;
          changed = true;
        } else if (run.length > 2 && run[run.length - 1].k === "let" && run[run.length - 2].k === "sp" && ["num", "let", "rp", "sup", "pi", "deg"].includes(run[run.length - 3].k)) {
          after = run.pop()?.s + after;
          changed = true;
        }
      }
      const source = run.map((t) => t.s).join("");
      const mathy = run.some((t) => ["op", "sup", "sub", "sqrt", "pi"].includes(t.k));
      const loneVariable = run.length === 1 && run[0].k === "let" && /^[xyzn]$/.test(run[0].s);
      if (!run.length || (!mathy && !loneVariable) || run.some((t) => t.comma)) {
        // Words, plain numbers, and sums of numbers with thousands commas (which maths mode would space oddly) stay as they are.
        pieces.push(before + source + after);
        continue;
      }
      try {
        const tex = latex(run);
        pieces.push(`${before}$${tex}$${after}`);
      } catch (e) {
        if (!(e instanceof Doubt)) throw e;
        doubt ??= `"${source}": ${e.message}`;
        pieces.push(before + source + after);
      }
    }
  };
  for (const m of text.matchAll(COORDS)) {
    prose(money(text.slice(at, m.index)));
    pieces.push(`$${m[0].replace(/−/g, "-")}$`);
    at = m.index + m[0].length;
  }
  prose(money(text.slice(at)));
  return { text: pieces.join(""), plain, doubt };
}

// ---------------------------------------------------------------- the conversion

type RawRow = { row: number; cells: unknown[] };
type Change = { id: string; field: string; raw: string; text: string };

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;
const bankId = (id: string) => id.replace(/^([LM])(\d+)$/, (_, p: string, n: string) => `${p}-${n.padStart(4, "0")}`);

function main() {
  const topics = JSON.parse(readFileSync(path.join(here, "topics.json"), "utf8")) as Record<string, string>;
  const header = [...COLUMNS, "column_a", "column_b", "origin", "markup"];
  const lines = [header.join(",")];
  const log = {
    recovered: [] as { id: string; field: string; kind: string; raw: unknown; text: string; certain: boolean; note?: string }[],
    doubts: [] as { id: string; field: string; raw: string; why: string }[],
    comparisons: [] as { id: string; prompt: string; columnA: string; columnB: string }[],
    lowerComparisons: [] as string[],
    stillInvalid: [] as { id: string; field: string; text: string; problems: string[] }[],
    changed: [] as Change[],
  };
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const level of LEVELS as Level[]) {
    const rows = JSON.parse(readFileSync(path.join(SOURCE, `${level}.raw.json`), "utf8")) as RawRow[];
    if (rows.length !== 300) problems.push(`${level}: ${rows.length} rows, expected 300`);
    for (const { row, cells } of rows) {
      if (cells.length !== COLUMNS.length) {
        problems.push(`${level} row ${row}: ${cells.length} cells, expected ${COLUMNS.length}`);
        continue;
      }
      const sheetId = String(cells[0]);
      const id = bankId(sheetId);
      if (ids.has(id)) problems.push(`${level} row ${row}: id ${sheetId} is used twice`);
      ids.add(id);

      const plainCells: Record<string, string> = {};
      COLUMNS.forEach((name, i) => {
        const { text, recovery } = cellText(cells[i]);
        plainCells[name] = text;
        if (recovery) log.recovered.push({ id, field: name, ...recovery });
      });
      if (!(plainCells.topic in topics) || !TOPICS.includes(topics[plainCells.topic] as never)) problems.push(`${id}: topic "${plainCells.topic}" is not mapped in topics.json`);

      // A comparison keeps its two columns inside the question: "shared facts. Column A: …   Column B: …".
      let columnA = "";
      let columnB = "";
      const comparison = /comparison/i.test(plainCells.type);
      if (comparison) {
        const m = /^(.*?)\s*Column A:\s*(.*?)\s+Column B:\s*(.*)$/.exec(plainCells.question);
        if (!m) problems.push(`${id}: a comparison whose question has no "Column A: … Column B: …"`);
        else {
          [plainCells.question, columnA, columnB] = [m[1].trim(), m[2].trim(), m[3].trim()];
          log.comparisons.push({ id, prompt: plainCells.question, columnA, columnB });
        }
        if (level === "lower") log.lowerComparisons.push(id);
      }

      // Markup, a field at a time; the four choices are kept alike (all marked up or all plain).
      const fields: Record<string, string> = { question: plainCells.question, explanation: plainCells.explanation, column_a: columnA, column_b: columnB };
      const out: Record<string, string> = {};
      for (const [name, text] of Object.entries(fields)) {
        const m = markup(text);
        if (m.doubt) log.doubts.push({ id, field: name, raw: text, why: m.doubt });
        out[name] = m.doubt ? m.plain : m.text;
      }
      const choiceNames = ["choice_a", "choice_b", "choice_c", "choice_d"];
      const choices = choiceNames.map((name) => markup(plainCells[name]));
      const anyDoubt = choices.some((c) => c.doubt);
      choices.forEach((c, i) => {
        if (c.doubt) log.doubts.push({ id, field: choiceNames[i], raw: plainCells[choiceNames[i]], why: c.doubt });
        out[choiceNames[i]] = anyDoubt ? c.plain : c.text;
      });
      for (const [name, text] of Object.entries(out)) {
        const before = name === "column_a" ? columnA : name === "column_b" ? columnB : plainCells[name];
        if (text !== before) log.changed.push({ id, field: name, raw: before, text });
        const bad = textProblems(text);
        if (bad.length) log.stillInvalid.push({ id, field: name, text, problems: bad });
      }

      const record: Record<string, string> = {
        ...plainCells,
        ...out,
        id,
        origin: "written",
        markup: "bank",
      };
      lines.push(header.map((h) => csvCell(record[h] ?? "")).join(","));
    }
  }

  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  writeFileSync(path.join(SOURCE, "questions.csv"), lines.join("\n") + "\n");
  writeFileSync(path.join(SOURCE, "conversion-log.json"), JSON.stringify(log, null, 1) + "\n");

  const by = (kind: string) => log.recovered.filter((r) => r.kind === kind);
  console.log(`${lines.length - 1} questions written to ${path.relative(process.cwd(), path.join(SOURCE, "questions.csv"))}`);
  console.log(`cells recovered: ${by("date").length} dates read back as fractions, ${by("apostrophe").length} leading apostrophes removed, ${by("other").length} of other kinds`);
  const unsure = log.recovered.filter((r) => !r.certain);
  console.log(`  not certain: ${unsure.length}${unsure.length ? ` (${unsure.map((r) => `${r.id} ${r.field}`).join(", ")})` : ""}`);
  console.log(`fields rewritten with maths or money markup: ${log.changed.length}`);
  console.log(`fields left plain because part of them was doubtful: ${log.doubts.length}`);
  console.log(`comparisons split into prompt and two columns: ${log.comparisons.length}`);
  console.log(`comparison questions at Lower Level: ${log.lowerComparisons.length}${log.lowerComparisons.length ? ` (${log.lowerComparisons.join(", ")})` : ""}`);
  console.log(`fields the checker would still refuse: ${log.stillInvalid.length}${log.stillInvalid.length ? ` (${log.stillInvalid.map((r) => `${r.id} ${r.field}`).join(", ")})` : ""}`);
  console.log("details: scripts/math/source/conversion-log.json");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
