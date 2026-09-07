import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NotePlace } from "@/lib/reading/notes";
import { PILL_NODE, pillOf } from "./notepad-pill";

/** The slice of tiptap-markdown's serializer state a leaf node needs. */
type MarkdownSerializerState = { write: (text: string) => void };

/**
 * The chip that turns a paragraph of notes into a conversation.
 *
 * Typing @ and picking "Ask" or a person drops one of these where the @ was.
 * It is a promise about the paragraph it sits in: Enter sends that paragraph —
 * and any written directly above it, back to the nearest quote — off as the
 * first message of a thread, and the chip becomes a pill that opens the
 * thread. Until Enter it is inert; delete it and nothing was promised.
 *
 * Not a pill. A pill stands for something that exists — a place, a day, a
 * thread — and this stands for something about to. It is serialized as the
 * plain "@ask" or "@jenny" you typed, so a note saved mid-composition keeps
 * the words and loses only the chip, which is the right way round.
 */
export const COMPOSE_NODE = "compose";

export type ComposeKind = "ask" | "member";

export const NotepadCompose = Node.create({
  name: COMPOSE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: { default: "ask" },
      /** "ask", or the person's handle. */
      handle: { default: "ask" },
      /** What the chip shows: "Ask", or the person's first name. */
      name: { default: "Ask" },
      /** "idle" until Enter; "sending" while the thread is being made. */
      state: { default: "idle" },
      /** Whether a quote sits above the paragraph — decides the chip's wording. */
      quoted: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-compose]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = node.attrs.kind as ComposeKind;
    const label =
      kind === "ask"
        ? node.attrs.quoted
          ? "Ask about the passage above"
          : "Ask"
        : `@${node.attrs.name as string}`;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-compose": kind,
        "data-state": node.attrs.state as string,
        class: "notepad-compose",
        title: "Enter sends this paragraph",
      }),
      node.attrs.state === "sending" ? `${label}…` : `${label} ⏎`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.write(`@${node.attrs.handle as string}`);
        },
        parse: {},
      },
    };
  },
});

/**
 * What Enter on a chip sends.
 *
 * The paragraph the chip is in, plus every paragraph directly above it with
 * words in it, back until something that isn't one: a quote, a heading, a
 * blank line, the top of the note. If what stopped the walk was a quote, that
 * quote is attached — the passage this thought is about. If it was anything
 * else, the thought stands on its own and the conversation is anchored to
 * wherever the reader is.
 *
 * A blank line is the reader's way of saying "not about that". It is a real
 * node here (an empty paragraph), which is what makes it a boundary the walk
 * can see.
 */
export type ComposeScope = {
  text: string;
  quote: { text: string; place: NotePlace } | null;
  /** Document position of the chip node. */
  chipPos: number;
  kind: ComposeKind;
  handle: string;
  name: string;
};

export function composeScope(doc: PMNode, chipPos: number): ComposeScope | null {
  const chip = doc.nodeAt(chipPos);
  if (!chip || chip.type.name !== COMPOSE_NODE) return null;
  const $chip = doc.resolve(chipPos);
  if ($chip.depth < 1) return null;
  // The top-level block the chip is in, whatever it's nested inside.
  const i = $chip.index(0);
  const block = doc.child(i);
  if (block.type.name !== "paragraph") return null;

  let j = i;
  while (j > 0) {
    const prev = doc.child(j - 1);
    if (prev.type.name === "paragraph" && hasWords(prev)) j -= 1;
    else break;
  }
  const above = j > 0 ? doc.child(j - 1) : null;

  const parts: string[] = [];
  for (let k = j; k <= i; k++) parts.push(doc.child(k).textContent.trim());
  const text = parts.filter(Boolean).join("\n\n");

  let quote: ComposeScope["quote"] = null;
  if (above && above.type.name === "blockquote") {
    let place: NotePlace | null = null;
    above.descendants((n) => {
      if (n.type.name === PILL_NODE) {
        const p = pillOf(n);
        if (p.kind === "place") place = { char: p.char, label: p.label, mark: p.mark };
      }
    });
    const quoteText = quoteTextOf(above);
    if (place && quoteText) quote = { text: quoteText, place };
  }

  return {
    text,
    quote,
    chipPos,
    kind: chip.attrs.kind as ComposeKind,
    handle: chip.attrs.handle as string,
    name: chip.attrs.name as string,
  };
}

/** Whether a quote sits directly above the block at `pos` — for the chip's wording. */
export function quoteAbove(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  if ($pos.depth < 1) return false;
  let j = $pos.index(0);
  while (j > 0) {
    const prev = doc.child(j - 1);
    if (prev.type.name === "paragraph" && hasWords(prev)) j -= 1;
    else break;
  }
  return j > 0 && doc.child(j - 1).type.name === "blockquote";
}

/** Words, as opposed to a bare stamp or nothing at all. */
function hasWords(para: PMNode): boolean {
  return para.textContent.trim().length > 0;
}

function quoteTextOf(quote: PMNode): string {
  const paragraphs: string[] = [];
  quote.forEach((child) => {
    const t = child.textContent.trim();
    if (t) paragraphs.push(t);
  });
  return paragraphs.join("\n");
}
