/**
 * The Markdown the tutor writes (see VISUALS in ./prompt.ts), parsed into a
 * small tree the website renders. Not a full CommonMark: the subset a chat
 * model actually produces — headings, paragraphs, bullet and numbered lists
 * (nested by indentation), tables, block quotes, rules, fenced code, ```visual
 * blocks — plus LaTeX math as $…$, $$…$$, \(…\) and \[…\].
 *
 * The house journal parser (src/lib/journal/markdown-blocks.ts) is shared with
 * the journal's editor, so it stays as small as the editor needs; tables, code
 * and math live here instead.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "del"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "math"; tex: string; display: boolean }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { t: "heading"; level: number; c: Inline[] }
  | { t: "paragraph"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "quote"; c: Block[] }
  | { t: "code"; lang: string; v: string }
  | { t: "visual"; source: string }
  | { t: "math"; tex: string }
  | { t: "hr" };

// --- Blocks --------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)([-*+•])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const EMPTY_ITEM = /^(\s*)([-*+•]|\d{1,9}[.)])\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const DISPLAY_OPEN = /^\s*(\$\$|\\\[)/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => line.trim() === "";

function listMarker(line: string): { indent: number; ordered: boolean; start: number; text: string; width: number } | null {
  const o = ORDERED.exec(line);
  if (o) return { indent: o[1].length, ordered: true, start: Number(o[2]), text: o[3], width: o[1].length + o[2].length + 2 };
  const b = BULLET.exec(line);
  // "**bold** at the start of a line" isn't a bullet: a bullet needs a space after it.
  if (b) return { indent: b[1].length, ordered: false, start: 1, text: b[3], width: b[1].length + 2 };
  const e = EMPTY_ITEM.exec(line);
  if (e) {
    const ordered = /\d/.test(e[2]);
    return { indent: e[1].length, ordered, start: ordered ? parseInt(e[2], 10) : 1, text: "", width: e[1].length + e[2].length + 1 };
  }
  return null;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  // Split on pipes that aren't escaped or inside inline math/code.
  const cells: string[] = [];
  let cur = "";
  let inMath = false;
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cur += c;
    } else if (c === "$" && !inCode) {
      inMath = !inMath;
      cur += c;
    } else if (c === "|" && !inMath && !inCode) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    DISPLAY_OPEN.test(line) ||
    listMarker(line) != null ||
    (line.includes("|") && next != null && TABLE_SEP.test(next) && next.includes("-"))
  );
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }

    // Fenced code; ```visual becomes a drawing.
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2].toLowerCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++]);
      const closed = i < lines.length;
      i++; // closing fence (or end of message)
      const v = body.join("\n");
      // An unclosed ```visual (a reply cut off mid-drawing) shows nothing, the
      // same as the iPhone app; an unclosed code block still shows its code.
      if (lang === "visual") {
        if (closed) blocks.push({ t: "visual", source: v });
      } else {
        blocks.push({ t: "code", lang, v });
      }
      continue;
    }

    // Display math on its own lines: $$…$$ or \[…\], one line or many.
    const display = DISPLAY_OPEN.exec(line);
    if (display) {
      const close = display[1] === "$$" ? "$$" : "\\]";
      const rest = line.trim().slice(display[1].length);
      const endHere = rest.indexOf(close);
      if (endHere >= 0) {
        const after = rest.slice(endHere + close.length).trim();
        // "$$x$$ and some prose" is inline-ish; let the paragraph handle it.
        if (after === "" || /^[.,;:!?]$/.test(after)) {
          blocks.push({ t: "math", tex: rest.slice(0, endHere).trim() + (after ? `\\text{${after}}` : "") });
          i++;
          continue;
        }
      } else {
        const body = [rest];
        let j = i + 1;
        let closed = false;
        while (j < lines.length) {
          const at = lines[j].indexOf(close);
          if (at >= 0) {
            body.push(lines[j].slice(0, at));
            closed = true;
            break;
          }
          body.push(lines[j]);
          j++;
        }
        if (closed) {
          blocks.push({ t: "math", tex: body.join("\n").trim() });
          i = j + 1;
          continue;
        }
      }
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: "heading", level: heading[1].length, c: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    // Tables: a header row, then a |---|:---:| separator.
    const next = lines[i + 1];
    if (line.includes("|") && next != null && TABLE_SEP.test(next) && next.includes("-")) {
      const head = splitRow(line);
      const align: Align[] = splitRow(next).map((c) => {
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : null;
      });
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? "")));
        i++;
      }
      blocks.push({ t: "table", align: head.map((_, k) => align[k] ?? null), head: head.map((h) => parseInline(h)), rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i])) {
        const q = QUOTE.exec(lines[i]);
        body.push(q ? q[1] : lines[i]);
        i++;
      }
      blocks.push({ t: "quote", c: parseBlocks(body.join("\n")) });
      continue;
    }

    // Lists. An item owns the lines indented past its marker (nested lists,
    // continuation paragraphs); a blank line between items doesn't end it.
    const first = listMarker(line);
    if (first) {
      const items: Block[][] = [];
      const base = first.indent;
      while (i < lines.length) {
        const m = listMarker(lines[i]);
        if (!m || m.indent !== base || m.ordered !== first.ordered) break;
        const body = [m.text];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (blank(l)) {
            // Keep going only if the list continues after the gap.
            const after = lines.slice(i + 1).find((x) => !blank(x));
            const am = after != null ? listMarker(after) : null;
            if (after != null && (indentOf(after) > base || (am && am.indent === base && am.ordered === first.ordered))) {
              if (indentOf(after) > base) body.push("");
              i++;
              continue;
            }
            break;
          }
          const lm = listMarker(l);
          if (indentOf(l) > base) {
            // Strip up to the item's content indent so nested blocks parse.
            body.push(l.slice(Math.min(indentOf(l), Math.max(m.width, base + 2))));
            i++;
          } else if (!lm && !startsBlock(l, lines[i + 1])) {
            body.push(l.trim()); // lazy continuation of the item's text
            i++;
          } else {
            break;
          }
        }
        items.push(parseBlocks(body.join("\n")));
        // A blank line before the next sibling item.
        while (i < lines.length && blank(lines[i])) {
          const after = lines.slice(i).find((x) => !blank(x));
          const am = after != null ? listMarker(after) : null;
          if (am && am.indent === base && am.ordered === first.ordered) i++;
          else break;
        }
      }
      blocks.push({ t: "list", ordered: first.ordered, start: first.start, items });
      continue;
    }

    // Paragraph: until a blank line or another block starts.
    const para: string[] = [line];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++]);
    blocks.push({ t: "paragraph", c: parseInline(para.map((l, k) => (k === 0 ? l.trimStart() : l)).join("\n")) });
  }

  return blocks;
}

// --- Inline --------------------------------------------------------------------

// Atoms pulled out before emphasis is parsed, so a "*" or "_" inside math or
// code can't be mistaken for emphasis. They sit in the text as n.
type Atom = Extract<Inline, { t: "code" } | { t: "math" } | { t: "text" }>;
const PH = (n: number) => `${n}`;
const PH_RE = /(\d+)/g;

function extractAtoms(src: string): { text: string; atoms: Atom[] } {
  const atoms: Atom[] = [];
  let out = "";
  let i = 0;
  const push = (a: Atom) => {
    atoms.push(a);
    out += PH(atoms.length - 1);
  };

  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);

    // \( … \) and \[ … \]
    if (rest.startsWith("\\(") || rest.startsWith("\\[")) {
      const close = rest[1] === "(" ? "\\)" : "\\]";
      const end = src.indexOf(close, i + 2);
      if (end > i + 2) {
        push({ t: "math", tex: src.slice(i + 2, end).trim(), display: close === "\\]" });
        i = end + 2;
        continue;
      }
    }

    // Backslash escapes: \$ \* \_ and friends are literal.
    if (c === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|~$<>]/.test(src[i + 1])) {
      push({ t: "text", v: src[i + 1] });
      i += 2;
      continue;
    }

    if (c === "`") {
      const run = /^`+/.exec(rest)![0];
      const end = src.indexOf(run, i + run.length);
      if (end > 0) {
        push({ t: "code", v: src.slice(i + run.length, end).trim() || src.slice(i + run.length, end) });
        i = end + run.length;
        continue;
      }
      out += run;
      i += run.length;
      continue;
    }

    if (rest.startsWith("$$")) {
      const end = src.indexOf("$$", i + 2);
      if (end > i + 2) {
        push({ t: "math", tex: src.slice(i + 2, end).trim(), display: true });
        i = end + 2;
        continue;
      }
    }

    // $…$: the opening $ isn't followed by a space and the closing one isn't
    // preceded by one or followed by a digit, so "$5 and $10" stays prose.
    if (c === "$" && src[i + 1] && !/\s|\$/.test(src[i + 1])) {
      let j = i + 1;
      let found = -1;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "$" && !/\s/.test(src[j - 1]) && !/\d/.test(src[j + 1] ?? "")) {
          found = j;
          break;
        }
        j++;
      }
      if (found > 0) {
        push({ t: "math", tex: src.slice(i + 1, found), display: false });
        i = found + 1;
        continue;
      }
    }

    out += c;
    i++;
  }
  return { text: out, atoms };
}

// Emphasis, links and hard breaks, over text whose atoms are placeholders.
// Group order: strong**, strong__, del, em*, em_, link, hard break.
const RICH =
  /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|(?<![\w])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w])|~~(?=\S)([\s\S]+?)(?<=\S)~~|(?<![*\w])\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*(?!\*)|(?<![\w])_(?=\S)([^_]+?)(?<=\S)_(?![\w])|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|( {2,}|\\)\n/g;

function parseRich(text: string, atoms: Atom[]): Inline[] {
  const out: Inline[] = [];
  const re = new RegExp(RICH.source, "g");
  let cursor = 0;
  let m: RegExpExecArray | null;

  const pushText = (s: string) => {
    if (!s) return;
    let last = 0;
    for (const p of s.matchAll(PH_RE)) {
      if (p.index! > last) out.push({ t: "text", v: s.slice(last, p.index) });
      out.push(atoms[Number(p[1])]);
      last = p.index! + p[0].length;
    }
    if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  };

  while ((m = re.exec(text)) !== null) {
    pushText(text.slice(cursor, m.index));
    const [, strong1, strong2, del, em1, em2, linkText, href, br] = m;
    if (strong1 != null || strong2 != null) out.push({ t: "strong", c: parseRich(strong1 ?? strong2, atoms) });
    else if (del != null) out.push({ t: "del", c: parseRich(del, atoms) });
    else if (em1 != null || em2 != null) out.push({ t: "em", c: parseRich(em1 ?? em2, atoms) });
    else if (href != null) out.push({ t: "link", href, c: parseRich(linkText, atoms) });
    else if (br != null) out.push({ t: "br" });
    cursor = m.index + m[0].length;
  }
  pushText(text.slice(cursor));
  return out;
}

export function parseInline(src: string): Inline[] {
  const { text, atoms } = extractAtoms(src);
  return parseRich(text, atoms);
}
