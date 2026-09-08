import type { JSONContent } from "@tiptap/core";
import { pillMarkdown, type NotePill, type NotePlace } from "./notes";

/**
 * The notepad as a tree.
 *
 * Every line of the notepad is a BLOCK: a head (a paragraph, a heading, or a
 * quote that landed from a highlight) followed by any blocks nested under it.
 * A block can be collapsed, hiding what's under it; that is part of the note,
 * saved with it, and the same on every device — the Workflowy and Roam rule,
 * not the Obsidian one.
 *
 *   doc        := noteBlock+
 *   noteBlock  := (paragraph | heading | blockquote) noteBlock*
 *                 attrs { id, collapsed }
 *
 * This is the ProseMirror JSON the editor holds, kept as-is in the `doc`
 * column of reading_notes. Pure and client-safe: the editor, the server
 * actions and the verify script all share it, and nothing here needs a DOM.
 *
 * The markdown in `content` is DERIVED from the tree on every save
 * (treeToMarkdown) and never parsed back once a row has a tree — it exists so
 * everything that reads the note as text (the assistant's background, the
 * Contents blurb, the word count, placesIn) keeps working unchanged. Rows
 * written before the tree existed have `doc` null, and for those the markdown
 * is still the truth until the notepad is next opened, which parses it and
 * saves both.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-reader-notes.mts
 */

export const NOTE_BLOCK = "noteBlock";
export const PILL_NODE = "pill";
export const COMPOSE_NODE = "compose";

/**
 * Set on transactions the notepad makes itself — a clip landing, a pill from
 * the header, a line moved or folded — so the auto-stamp stays out of them.
 */
export const NOTEPAD_INSERT_META = "notepad-insert";

export type NoteBlockAttrs = {
  /** Stable across edits; what a drop, a thread or a property will point at. */
  id: string;
  collapsed: boolean;
};

export type NoteBlockJSON = {
  type: typeof NOTE_BLOCK;
  attrs: NoteBlockAttrs;
  /** The head first, then the children. */
  content: JSONContent[];
};

export type NoteDoc = {
  type: "doc";
  content: NoteBlockJSON[];
};

const HEAD_TYPES = new Set(["paragraph", "heading", "blockquote"]);

/** Short, random, and unique enough for the lines of one notepad. */
export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(8);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

export function newBlock(
  head: JSONContent,
  children: NoteBlockJSON[] = [],
  attrs: Partial<NoteBlockAttrs> = {}
): NoteBlockJSON {
  return {
    type: NOTE_BLOCK,
    attrs: { id: attrs.id ?? newId(), collapsed: attrs.collapsed ?? false },
    content: [head, ...children],
  };
}

export function emptyParagraph(): JSONContent {
  return { type: "paragraph" };
}

/** A note with nothing in it: one block, one empty line. */
export function emptyDoc(): NoteDoc {
  return { type: "doc", content: [newBlock(emptyParagraph())] };
}

export function headOf(block: NoteBlockJSON): JSONContent {
  return block.content[0];
}

export function childrenOf(block: NoteBlockJSON): NoteBlockJSON[] {
  return block.content.slice(1) as NoteBlockJSON[];
}

/**
 * Whatever came out of the column or the editor, as a well-formed tree.
 *
 * Fills in missing attrs, gives every block an id (and a fresh one to any
 * duplicate — a split or a paste copies attrs), lifts a bare paragraph at
 * the top level into a block of its own, and drops anything that fits
 * nowhere. Never returns an empty document: a note with no blocks is a note
 * with one empty block.
 */
export function normalizeDoc(json: unknown): NoteDoc {
  const seen = new Set<string>();
  const input = (json ?? {}) as JSONContent;
  const blocks: NoteBlockJSON[] = [];
  for (const node of input.content ?? []) {
    const block = normalizeNode(node, seen);
    if (block) blocks.push(block);
  }
  if (blocks.length === 0) blocks.push(newBlock(emptyParagraph()));
  return { type: "doc", content: blocks };
}

function normalizeNode(node: JSONContent, seen: Set<string>): NoteBlockJSON | null {
  if (!node || typeof node !== "object") return null;
  if (node.type !== NOTE_BLOCK) {
    // A head without a block around it — what the markdown parser gives.
    if (node.type && HEAD_TYPES.has(node.type)) return normalizeBlock(newBlock(node), seen);
    return null;
  }
  return normalizeBlock(node as NoteBlockJSON, seen);
}

function normalizeBlock(block: NoteBlockJSON, seen: Set<string>): NoteBlockJSON {
  const attrs = (block.attrs ?? {}) as Partial<NoteBlockAttrs>;
  let id = typeof attrs.id === "string" && attrs.id ? attrs.id : newId();
  if (seen.has(id)) id = newId();
  seen.add(id);

  const content = block.content ?? [];
  const first = content[0];
  const head: JSONContent =
    first && first.type && HEAD_TYPES.has(first.type) ? first : emptyParagraph();
  const rest = first && first.type && HEAD_TYPES.has(first.type) ? content.slice(1) : content;

  const children: NoteBlockJSON[] = [];
  for (const child of rest) {
    const b = normalizeNode(child, seen);
    if (b) children.push(b);
  }
  return {
    type: NOTE_BLOCK,
    attrs: { id, collapsed: attrs.collapsed === true },
    content: [head, ...children],
  };
}

/** A block added at the end of the note, at the top level. */
export function appendBlock(doc: NoteDoc, block: NoteBlockJSON): NoteDoc {
  const blocks = doc.content.slice();
  // An untouched empty note is one empty line; the first thing written
  // replaces it rather than landing under it.
  if (blocks.length === 1 && isBlankBlock(blocks[0])) blocks.length = 0;
  blocks.push(block);
  return { type: "doc", content: blocks };
}

function isBlankBlock(block: NoteBlockJSON): boolean {
  const head = headOf(block);
  return block.content.length === 1 && head.type === "paragraph" && !(head.content?.length ?? 0);
}

/* ------------------------------------------------------------------ */
/* Inline nodes: pills, and the passage a highlight lands as           */
/* ------------------------------------------------------------------ */

/** The pill node's JSON, for insertContent. */
export function pillJSON(pill: NotePill): JSONContent {
  const attrs: Record<string, unknown> = { kind: pill.kind, label: pill.label };
  if (pill.kind === "place") {
    attrs.char = pill.char;
    attrs.mark = pill.mark;
  } else if (pill.kind === "date") {
    attrs.date = pill.date;
  } else {
    attrs.thread = pill.thread;
  }
  return { type: PILL_NODE, attrs };
}

export function placeNodeJSON(place: NotePlace): JSONContent {
  return pillJSON({ kind: "place", ...place });
}

/** The pill a node's attrs stand for. */
export function pillOfAttrs(a: Record<string, unknown> | undefined): NotePill {
  const attrs = a ?? {};
  const label = (attrs.label as string) ?? "";
  if (attrs.kind === "date") return { kind: "date", date: (attrs.date as string) ?? "", label };
  if (attrs.kind === "thread") return { kind: "thread", thread: (attrs.thread as string) ?? "", label };
  return {
    kind: "place",
    char: (attrs.char as number) ?? 0,
    mark: (attrs.mark as string | null) ?? null,
    label,
  };
}

/**
 * The passage as it lands in the note: a quote, with a pill after it saying
 * where it came from. A COPY — trim it, cut it, keep the one sentence that
 * mattered. The pill stays linked to the mark and the place either way.
 */
export function clipContent(quote: string, place: NotePlace): JSONContent {
  const lines = quote
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const paragraphs = lines.length > 0 ? lines : [quote.trim()];
  return {
    type: "blockquote",
    content: paragraphs.map((text, i) => ({
      type: "paragraph",
      content:
        i === paragraphs.length - 1
          ? [{ type: "text", text }, { type: "text", text: " " }, placeNodeJSON(place)]
          : [{ type: "text", text }],
    })),
  };
}

/** The passage as a block of its own. */
export function quoteBlock(quote: string, place: NotePlace): NoteBlockJSON {
  return newBlock(clipContent(quote, place));
}

/**
 * A place pill that pointed at a mark by a stand-in id, now pointed at the
 * real one — a highlight lands in the note the instant it's made, before the
 * row that will be its mark exists. Null when nothing pointed at `pending`.
 */
export function resolveMarkInDoc(doc: NoteDoc, pending: string, id: string): NoteDoc | null {
  let changed = false;
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === PILL_NODE && node.attrs?.mark === pending) {
      changed = true;
      return { ...node, attrs: { ...node.attrs, mark: id } };
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map(walk) };
  };
  const next = walk(doc) as NoteDoc;
  return changed ? next : null;
}

/* ------------------------------------------------------------------ */
/* The derived markdown                                                */
/* ------------------------------------------------------------------ */

/**
 * The tree as markdown, for everything that reads the note as text.
 *
 * A top-level block is written bare — a paragraph, a `## heading`, a `>`
 * quote — exactly as the flat notepad wrote it, so a note nobody has nested
 * reads the same as before. Nested blocks are a tight `-` list under their
 * parent, two spaces deeper per level. Collapsed state is not written: this
 * is for reading, not for round-tripping, and nothing parses it back. For the
 * same reason there is no escaping of markdown characters in the text.
 */
export function treeToMarkdown(doc: NoteDoc): string {
  const out: string[] = [];
  for (const block of doc.content) {
    const lines = topLevelLines(block);
    if (lines.length > 0) out.push(lines.join("\n"));
  }
  return out.length > 0 ? `${out.join("\n\n")}\n` : "";
}

function topLevelLines(block: NoteBlockJSON): string[] {
  const lines: string[] = [];
  const head = headLines(headOf(block), "");
  if (head.some((l) => l.trim() !== "")) lines.push(...head);
  for (const child of childrenOf(block)) lines.push(...nestedLines(child, 0));
  return lines;
}

function nestedLines(block: NoteBlockJSON, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const head = headLines(headOf(block), `${indent}  `);
  const first = head.length > 0 ? head[0].slice(indent.length + 2) : "";
  const lines = [`${indent}- ${first}`, ...head.slice(1)];
  for (const child of childrenOf(block)) lines.push(...nestedLines(child, depth + 1));
  return lines;
}

/** A head as lines of markdown, every line prefixed with `indent`. */
function headLines(head: JSONContent, indent: string): string[] {
  if (head.type === "heading") {
    const level = Math.max(1, Math.min(6, Number(head.attrs?.level ?? 1)));
    return inlineLines(head.content ?? [], indent).map((l, i) =>
      i === 0 ? `${indent}${"#".repeat(level)} ${l.slice(indent.length)}` : l
    );
  }
  if (head.type === "blockquote") {
    const paragraphs = (head.content ?? []).map((p) =>
      inlineLines(p.content ?? [], indent).map((l) => `${indent}> ${l.slice(indent.length)}`)
    );
    const lines: string[] = [];
    paragraphs.forEach((p, i) => {
      if (i > 0) lines.push(`${indent}>`);
      lines.push(...p);
    });
    return lines.length > 0 ? lines : [`${indent}>`];
  }
  return inlineLines(head.content ?? [], indent);
}

/** Inline content as lines (a hard break splits one), each prefixed with `indent`. */
function inlineLines(inline: JSONContent[], indent: string): string[] {
  const text = inlineMarkdown(inline);
  return text.split("\n").map((l) => `${indent}${l}`);
}

type MarkSig = { key: string; open: string; close: string };

function markSig(marks: JSONContent["marks"]): MarkSig {
  let open = "";
  let close = "";
  const keys: string[] = [];
  for (const m of marks ?? []) {
    switch (m.type) {
      case "bold":
        open += "**";
        close = `**${close}`;
        keys.push("bold");
        break;
      case "italic":
        open += "*";
        close = `*${close}`;
        keys.push("italic");
        break;
      case "strike":
        open += "~~";
        close = `~~${close}`;
        keys.push("strike");
        break;
      case "code":
        open += "`";
        close = `\`${close}`;
        keys.push("code");
        break;
      case "link": {
        const href = String(m.attrs?.href ?? "");
        open += "[";
        close = `](${href})${close}`;
        keys.push(`link:${href}`);
        break;
      }
      default:
        break;
    }
  }
  return { key: keys.join("|"), open, close };
}

function inlineMarkdown(inline: JSONContent[]): string {
  let out = "";
  let run = "";
  let sig: MarkSig | null = null;
  const flush = () => {
    if (sig && run) out += `${sig.open}${run}${sig.close}`;
    run = "";
    sig = null;
  };
  for (const node of inline) {
    if (node.type === "text") {
      const s = markSig(node.marks);
      if (sig && sig.key === s.key) {
        run += node.text ?? "";
      } else {
        flush();
        sig = s;
        run = node.text ?? "";
      }
      continue;
    }
    flush();
    if (node.type === "hardBreak") out += "\n";
    else if (node.type === PILL_NODE) out += pillMarkdown(pillOfAttrs(node.attrs));
    else if (node.type === COMPOSE_NODE) out += `@${String(node.attrs?.handle ?? "ask")}`;
    else if (node.text) out += node.text;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* Plain text, for a conversation's opening                            */
/* ------------------------------------------------------------------ */

/**
 * A head as plain words: pills become their labels, the chip is left out,
 * a quote's paragraphs are joined by newlines.
 */
export function blockHeadText(block: NoteBlockJSON): string {
  const head = headOf(block);
  if (head.type === "blockquote") {
    return (head.content ?? [])
      .map((p) => inlineText(p.content ?? []).trim())
      .filter(Boolean)
      .join("\n");
  }
  return inlineText(head.content ?? []).trim();
}

function inlineText(inline: JSONContent[]): string {
  let out = "";
  for (const node of inline) {
    if (node.type === "text") out += node.text ?? "";
    else if (node.type === "hardBreak") out += "\n";
    else if (node.type === PILL_NODE) out += String(node.attrs?.label ?? "");
    // The chip stands for the conversation itself; it isn't part of the words.
  }
  return out.replace(/[ \t]+/g, " ");
}

/** A block's children as `- ` lines, two spaces deeper per level. */
export function childrenLines(block: NoteBlockJSON, depth = 0): string[] {
  const lines: string[] = [];
  for (const child of childrenOf(block)) {
    const text = blockHeadText(child);
    const indent = "  ".repeat(depth);
    const [first = "", ...rest] = text.split("\n");
    lines.push(`${indent}- ${first}`);
    for (const r of rest) lines.push(`${indent}  ${r}`);
    lines.push(...childrenLines(child, depth + 1));
  }
  return lines;
}

/**
 * What Enter on a chip sends, given the block the chip is in and the blocks
 * above it: where in the outline this is, the line itself, and what's nested
 * under it. Siblings are left out — the whole note rides along as background
 * anyway, and this is the part being asked about.
 */
export function composeText(ancestors: NoteBlockJSON[], block: NoteBlockJSON): string {
  const crumbs = ancestors.map(blockHeadText).filter(Boolean);
  const self = blockHeadText(block);
  const under = childrenLines(block);
  const parts: string[] = [];
  if (crumbs.length > 0) parts.push(`Under: ${crumbs.join(" › ")}`);
  parts.push([self, ...under].filter(Boolean).join("\n"));
  return parts.join("\n\n").trim();
}
