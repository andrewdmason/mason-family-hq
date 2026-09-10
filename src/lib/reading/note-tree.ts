import type { JSONContent } from "@tiptap/core";
import { pillMarkdown, placeMarkdown, shouldStamp, type NotePill, type NotePlace } from "./notes";

/**
 * The notepad as a tree.
 *
 * Every line of the notepad is a BLOCK: a head (a paragraph, a heading, a
 * quote that landed from a highlight, or a conversation that branched off)
 * followed by any blocks nested under it.
 * A block can be collapsed, hiding what's under it; that is part of the note,
 * saved with it, and the same on every device — the Workflowy and Roam rule,
 * not the Obsidian one.
 *
 *   doc        := noteBlock+
 *   noteBlock  := (paragraph | heading | blockquote | threadBlock) noteBlock*
 *                 attrs { id, collapsed, place, at }
 *
 * A THREAD BLOCK is a line that became a conversation — the reader ended it
 * with /ask, or sent it to somebody with @ — and now stands for that
 * conversation in the outline, wearing its name. Its text is not editable;
 * the words that started it are the thread's first message. See
 * notepad-thread-block.ts for how it is drawn and thread-title.ts for how it
 * gets its name.
 *
 * `place` and `at` are the line's PROVENANCE: where the reader was in the
 * book when the line was written, and when. Recorded silently as each line
 * gets its first words, kept out of the text entirely, and shown only when
 * the reader asks for it by pressing the line's handle. Null on both counts
 * for the lines of a note written before any of this existed.
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
export const THREAD_BLOCK = "threadBlock";

/**
 * Set on transactions the notepad makes itself — a clip landing, a pill from
 * the header, a line moved or folded — so they don't read as the reader
 * moving the caret.
 */
export const NOTEPAD_INSERT_META = "notepad-insert";

/**
 * Set on transactions that make a line out of words that already existed —
 * splitting a line in two, unwrapping a quote, lifting an old note into the
 * outline. The provenance stamp leaves these alone: the words are old words,
 * and saying they were written now would be a lie.
 */
export const NOTEPAD_NO_STAMP_META = "notepad-no-stamp";

export type NoteBlockAttrs = {
  /** Stable across edits; what a drop, a thread or a property will point at. */
  id: string;
  collapsed: boolean;
  /** Where the reader was when this line got its first words. Null if unknown. */
  place: NotePlace | null;
  /** When it got them, as an ISO instant. Null if unknown. */
  at: string | null;
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

/**
 * What a thread block knows. `thread` is the annotation the conversation is
 * reached through — the same id the old thread pill carried. `title` is a
 * COPY of the conversation's name as last seen, so the block reads right the
 * instant the note opens, before the list of marks has loaded; the live name
 * is drawn over it (notepad.tsx) and written back here when it changes.
 * `question` is the line's own words at the moment it was sent: what the
 * block says until a name exists, and what the markdown says of it then.
 */
export type ThreadBlockAttrs = {
  thread: string;
  title: string | null;
  /** Who the line went to: the AI, or a person. */
  kind: "ask" | "member";
  question: string;
};

const HEAD_TYPES = new Set(["paragraph", "heading", "blockquote", THREAD_BLOCK]);

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
    attrs: {
      id: attrs.id ?? newId(),
      collapsed: attrs.collapsed ?? false,
      place: attrs.place ?? null,
      at: attrs.at ?? null,
    },
    content: [head, ...children],
  };
}

export function emptyParagraph(): JSONContent {
  return { type: "paragraph" };
}

/** A conversation's head, for the line that became one. */
export function threadHead(attrs: {
  thread: string;
  kind: ThreadBlockAttrs["kind"];
  question: string;
  title?: string | null;
}): JSONContent {
  return {
    type: THREAD_BLOCK,
    attrs: { thread: attrs.thread, title: attrs.title ?? null, kind: attrs.kind, question: attrs.question },
  };
}

/** What a thread block shows: its name, or the words that started it. */
export function threadLabel(attrs: Record<string, unknown> | undefined): string {
  const title = typeof attrs?.title === "string" ? attrs.title.trim() : "";
  if (title) return title;
  const question = typeof attrs?.question === "string" ? attrs.question.trim() : "";
  return question || "A conversation";
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
  const isHead = !!(first && first.type && HEAD_TYPES.has(first.type));
  const cleaned = isHead ? cleanHead(first) : { head: emptyParagraph(), place: null };
  const rest = isHead ? content.slice(1) : content;

  const children: NoteBlockJSON[] = [];
  for (const child of rest) {
    const b = normalizeNode(child, seen);
    if (b) children.push(b);
  }
  return {
    type: NOTE_BLOCK,
    attrs: {
      id,
      collapsed: attrs.collapsed === true,
      place: cleanPlace(attrs.place) ?? cleaned.place,
      at: cleanAt(attrs.at),
    },
    content: [cleaned.head, ...children],
  };
}

/**
 * A head as stored, made well-formed.
 *
 * A thread block that has lost the one thing it needs — the conversation it
 * points at — is no longer a conversation, and reads as a line saying what
 * the block said. And a paragraph that ENDS in a thread pill is the older
 * shape of the same thing, lifted: see liftThreadPill.
 */
function cleanHead(head: JSONContent): { head: JSONContent; place: NotePlace | null } {
  if (head.type === THREAD_BLOCK) {
    const a = (head.attrs ?? {}) as Partial<ThreadBlockAttrs>;
    const thread = typeof a.thread === "string" ? a.thread.trim() : "";
    const title = typeof a.title === "string" && a.title.trim() ? a.title.trim() : null;
    const question = typeof a.question === "string" ? a.question.trim() : "";
    if (!thread) {
      const text = title ?? question;
      return { head: text ? { type: "paragraph", content: [{ type: "text", text }] } : emptyParagraph(), place: null };
    }
    return { head: threadHead({ thread, kind: a.kind === "member" ? "member" : "ask", question, title }), place: null };
  }
  if (head.type === "paragraph") return liftThreadPill(head) ?? { head, place: null };
  return { head, place: null };
}

/**
 * The line a conversation used to leave behind, as the block it is now.
 *
 * Before thread blocks, sending a line left the line as it was with a pill
 * at its END — "Why is the maestro late? [Ask]" — or, sent from an empty
 * line, a pill on its own. Both become a thread block: the words before the
 * pill are the question it asked, the pill's label says who it went to. A
 * pill anywhere ELSE in a line was put there on purpose and stays a pill.
 *
 * Runs on every read (normalizeDoc), so a note is lifted the first time it is
 * opened after the change and saved in the new shape straight after.
 */
function liftThreadPill(head: JSONContent): { head: JSONContent; place: NotePlace | null } | null {
  const inline = (head.content ?? []).slice();
  while (inline.length > 0 && isBlankText(inline[inline.length - 1])) inline.pop();
  const last = inline[inline.length - 1];
  if (!last || last.type !== PILL_NODE) return null;
  const pill = pillOfAttrs(last.attrs);
  if (pill.kind !== "thread" || !pill.thread) return null;
  let words = inline.slice(0, -1);
  if (words.some((n) => n.type === PILL_NODE && pillOfAttrs(n.attrs).kind === "thread")) return null;
  // The auto-stamp of the day put a place at the front of the line. That is
  // the line's place, not part of its question — the same lift
  // absorbPlacePills does, done here because the paragraph is about to stop
  // being one.
  const stamped = dropLeadingPill(words);
  if (stamped) words = stamped.inline;
  const question = inlineText(words).trim();
  const label = pill.label.trim();
  return {
    head: threadHead({
      thread: pill.thread,
      kind: label === "Ask" || label === "" ? "ask" : "member",
      question: question || label,
    }),
    place: stamped?.place ?? null,
  };
}

function isBlankText(node: JSONContent | undefined): boolean {
  return !!node && node.type === "text" && !(node.text ?? "").trim();
}

/** A place out of stored JSON, or null for anything that isn't one. */
function cleanPlace(value: unknown): NotePlace | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<NotePlace>;
  if (typeof p.char !== "number" || !Number.isFinite(p.char)) return null;
  return {
    char: p.char,
    label: typeof p.label === "string" ? p.label : "",
    mark: typeof p.mark === "string" ? p.mark : null,
  };
}

function cleanAt(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;
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
 * The passage as it lands in the note: a quote and nothing else. A COPY —
 * trim it, cut it, keep the one sentence that mattered.
 *
 * Where it came from is the BLOCK's, not the text's (quoteBlock below), so a
 * clipped passage reads as the book's words alone. The place and the mark
 * behind it are still there, under the line's handle, and still write
 * themselves into the derived markdown.
 */
export function clipContent(quote: string): JSONContent {
  const lines = quote
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const paragraphs = lines.length > 0 ? lines : [quote.trim()];
  return {
    type: "blockquote",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

/** The passage as a block of its own, standing where it came from. */
export function quoteBlock(quote: string, place: NotePlace, at: string | null = null): NoteBlockJSON {
  return newBlock(clipContent(quote), [], { place, at });
}

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

/** What a block's attrs say about where and when it was written. */
export function provenanceOf(attrs: Record<string, unknown> | undefined): {
  place: NotePlace | null;
  at: string | null;
} {
  return { place: cleanPlace(attrs?.place), at: cleanAt(attrs?.at) };
}

/**
 * The place pills an older note wrote into its text, lifted onto the lines
 * that hold them. Null when there is nothing to lift.
 *
 * Two shapes, and only two, because only two things ever wrote one: the
 * auto-stamp put a pill and a space at the FRONT of a line, and a clipped
 * passage got a space and a pill at the END of its last line. A pill anywhere
 * else in a sentence was put there on purpose — by the pin, or by ⌥L — and
 * stays exactly where it is. Dates and conversations never move: a thread
 * pill is a link the reader follows, not a note about where they were.
 *
 * Runs once, the first time a note is opened after the change, and the note
 * saves in the new shape straight after. Nothing is lost — the pill's place
 * becomes the line's place — but the lines do get shorter, which is the
 * point.
 */
export function absorbPlacePills(doc: NoteDoc): NoteDoc | null {
  let changed = false;

  const walk = (block: NoteBlockJSON): NoteBlockJSON => {
    const children = childrenOf(block).map(walk);
    const lifted = block.attrs.place ? null : liftFromHead(headOf(block));
    if (!lifted && children.every((c, i) => c === childrenOf(block)[i])) return block;
    if (lifted) changed = true;
    return {
      ...block,
      attrs: lifted ? { ...block.attrs, place: lifted.place, at: null } : block.attrs,
      content: [lifted ? lifted.head : headOf(block), ...children],
    };
  };

  const next = { type: "doc" as const, content: doc.content.map(walk) };
  return changed ? next : null;
}

/** A head with its stamp taken off, and the place it was carrying. */
function liftFromHead(head: JSONContent): { head: JSONContent; place: NotePlace } | null {
  if (head.type === "blockquote") {
    const paragraphs = head.content ?? [];
    const last = paragraphs.length - 1;
    if (last < 0) return null;
    const trimmed = dropTrailingPill(paragraphs[last].content ?? []);
    if (!trimmed) return null;
    return {
      head: {
        ...head,
        content: paragraphs.map((p, i) => (i === last ? { ...p, content: trimmed.inline } : p)),
      },
      place: trimmed.place,
    };
  }
  if (head.type !== "paragraph" && head.type !== "heading") return null;
  const trimmed = dropLeadingPill(head.content ?? []);
  return trimmed ? { head: { ...head, content: trimmed.inline }, place: trimmed.place } : null;
}

function placeOfNode(node: JSONContent | undefined): NotePlace | null {
  if (!node || node.type !== PILL_NODE) return null;
  const pill = pillOfAttrs(node.attrs);
  return pill.kind === "place" ? { char: pill.char, label: pill.label, mark: pill.mark } : null;
}

/** A stamp at the front of a line, with the space the auto-stamp put after it. */
function dropLeadingPill(inline: JSONContent[]): { inline: JSONContent[]; place: NotePlace } | null {
  const place = placeOfNode(inline[0]);
  if (!place) return null;
  const rest = inline.slice(1);
  const first = rest[0];
  if (first?.type === "text" && typeof first.text === "string" && first.text.startsWith(" ")) {
    const text = first.text.slice(1);
    if (text) rest[0] = { ...first, text };
    else rest.shift();
  }
  return { inline: rest, place };
}

/** A stamp at the end of a quote, with the space before it. */
function dropTrailingPill(inline: JSONContent[]): { inline: JSONContent[]; place: NotePlace } | null {
  const place = placeOfNode(inline[inline.length - 1]);
  if (!place) return null;
  const rest = inline.slice(0, -1);
  const last = rest[rest.length - 1];
  if (last?.type === "text" && typeof last.text === "string" && last.text.endsWith(" ")) {
    const text = last.text.replace(/ $/, "");
    if (text) rest[rest.length - 1] = { ...last, text };
    else rest.pop();
  }
  return { inline: rest, place };
}

/**
 * Whatever pointed at a mark by a stand-in id, now pointed at the real one —
 * a highlight lands in the note the instant it's made, and a line becomes a
 * conversation the instant it's asked, before the row exists. Null when
 * nothing pointed at `pending`.
 */
export function resolveMarkInDoc(doc: NoteDoc, pending: string, id: string): NoteDoc | null {
  let changed = false;
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === PILL_NODE && node.attrs?.mark === pending) {
      changed = true;
      return { ...node, attrs: { ...node.attrs, mark: id } };
    }
    // A line that became a conversation before the conversation's row
    // existed points at the stand-in the same way.
    if (node.type === THREAD_BLOCK && node.attrs?.thread === pending) {
      changed = true;
      return { ...node, attrs: { ...node.attrs, thread: id } };
    }
    let next = node;
    // A clipped passage keeps its mark on the line, not in the text.
    const place = node.type === NOTE_BLOCK ? cleanPlace(node.attrs?.place) : null;
    if (place && place.mark === pending) {
      changed = true;
      next = { ...next, attrs: { ...next.attrs, place: { ...place, mark: id } } };
    }
    if (!next.content) return next;
    return { ...next, content: next.content.map(walk) };
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
 *
 * WHERE the reader was is written, though, as the same place link the notepad
 * used to keep in its text — at the front of a line, at the end of a quote.
 * The pills are gone from what the reader sees; the assistant still needs to
 * know which page a thought was had on, and everything that reads the note as
 * text goes on finding places exactly where it always found them.
 *
 * Not on every line, even though every line knows: a note where each sentence
 * opens with "(at p. 41)" is a note nobody can read. A place is written only
 * when the reader had MOVED since the last one written — the rule the stamp
 * itself used to follow (shouldStamp) — with a clipped passage always naming
 * its own, because that one is a citation and carries the mark behind it.
 *
 * WHEN is not written at all. Nothing downstream reasons about the time of
 * day a line was typed, and a timestamp on every line would be noise in every
 * prompt. It is for the reader, under the line's handle.
 */
export function treeToMarkdown(doc: NoteDoc): string {
  const out: string[] = [];
  const said: Said = { char: null };
  for (const block of doc.content) {
    const lines = topLevelLines(block, said);
    if (lines.length > 0) out.push(lines.join("\n"));
  }
  return out.length > 0 ? `${out.join("\n\n")}\n` : "";
}

/** The last place written down, so the next one is only written if it moved. */
type Said = { char: number | null };

/** The place to write on a block's head, or null to write none. */
function placeToSay(block: NoteBlockJSON, said: Said): NotePlace | null {
  const place = cleanPlace(block.attrs?.place);
  if (!place) return null;
  const always = headOf(block).type === "blockquote";
  if (!always && !shouldStamp(said.char, place.char)) return null;
  said.char = place.char;
  return place;
}

function topLevelLines(block: NoteBlockJSON, said: Said): string[] {
  const lines: string[] = [];
  const head = headLines(headOf(block), "", placeToSay(block, said));
  if (head.some((l) => l.trim() !== "")) lines.push(...head);
  for (const child of childrenOf(block)) lines.push(...nestedLines(child, 0, said));
  return lines;
}

function nestedLines(block: NoteBlockJSON, depth: number, said: Said): string[] {
  const indent = "  ".repeat(depth);
  const head = headLines(headOf(block), `${indent}  `, placeToSay(block, said));
  const first = head.length > 0 ? head[0].slice(indent.length + 2) : "";
  const lines = [`${indent}- ${first}`, ...head.slice(1)];
  for (const child of childrenOf(block)) lines.push(...nestedLines(child, depth + 1, said));
  return lines;
}

/**
 * A head as lines of markdown, every line prefixed with `indent`, with the
 * line's place set into it where the notepad used to keep the pill.
 *
 * A blank line says nothing at all, place or no place: an empty line that
 * knows where it was is still an empty line, and a document of bare place
 * links would be worse than one with none.
 */
function headLines(head: JSONContent, indent: string, place: NotePlace | null): string[] {
  const stamp = place ? placeMarkdown(place) : "";
  if (head.type === THREAD_BLOCK) {
    // The same link the thread pill wrote, so everything that read a pill
    // — pillsIn, the prompt's aside, the word count — reads a block.
    const a = head.attrs as ThreadBlockAttrs | undefined;
    const link = pillMarkdown({ kind: "thread", thread: a?.thread ?? "", label: threadLabel(a) });
    return [`${indent}${stamp ? `${stamp} ` : ""}${link}`];
  }
  if (head.type === "heading") {
    const level = Math.max(1, Math.min(6, Number(head.attrs?.level ?? 1)));
    const body = inlineLines(head.content ?? [], indent);
    if (!body.some((l) => l.trim() !== "")) return body;
    const open = `${indent}${"#".repeat(level)} ${stamp ? `${stamp} ` : ""}`;
    return body.map((l, i) => (i === 0 ? `${open}${l.slice(indent.length)}` : l));
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
    if (lines.length === 0) return [`${indent}>`];
    if (stamp) lines[lines.length - 1] += ` ${stamp}`;
    return lines;
  }
  const body = inlineLines(head.content ?? [], indent);
  if (!stamp || !body.some((l) => l.trim() !== "")) return body;
  return body.map((l, i) => (i === 0 ? `${indent}${stamp} ${l.slice(indent.length)}` : l));
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
 * a quote's paragraphs are joined by newlines, a conversation is its name.
 */
export function blockHeadText(block: NoteBlockJSON): string {
  const head = headOf(block);
  if (head.type === THREAD_BLOCK) return threadLabel(head.attrs);
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
