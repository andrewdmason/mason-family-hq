import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { NotePlace } from "@/lib/reading/notes";
import { composeText, type NoteBlockJSON } from "@/lib/reading/note-tree";
import { blockAt, inHead, isBlock, type BlockInfo } from "./notepad-block-commands";
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
 * The line the chip is on, with where it sits in the outline in front of it
 * — the heads of the lines it's nested under, as a breadcrumb — and whatever
 * is nested under it after. Not the lines beside it: the whole note rides
 * along as background anyway, and this is the part being asked about.
 *
 * If a quote sits just above — the nearest line up with words in it that is
 * a quote, or the line this one is nested under — that quote is attached:
 * the passage this thought is about. Otherwise the thought stands on its own
 * and the conversation is anchored to wherever the reader is.
 *
 * A blank line is the reader's way of saying "not about that". It is a real
 * block here (an empty head), which is what makes it a boundary the walk
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
  const b = blockAt($chip);
  if (!b || !inHead($chip)) return null;

  const ancestors: NoteBlockJSON[] = [];
  for (let d = 1; d < b.depth; d++) {
    const n = $chip.node(d);
    if (isBlock(n)) ancestors.push(n.toJSON() as NoteBlockJSON);
  }
  const text = composeText(ancestors, b.node.toJSON() as NoteBlockJSON);

  let quote: ComposeScope["quote"] = null;
  const above = quoteNear($chip, b);
  if (above) {
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

/** Whether a quote sits just above the block at `pos` — for the chip's wording. */
export function quoteAbove(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  const b = blockAt($pos);
  return b != null && quoteNear($pos, b) != null;
}

/**
 * The quote a block is about, if one sits just above it: back over the
 * lines beside it that have words, to the first that is a quote; or, at the
 * top of its group, the line it's nested under when that is a quote.
 */
function quoteNear($pos: ResolvedPos, b: BlockInfo): PMNode | null {
  const first = isBlock(b.parent) ? 1 : 0;
  let i = b.index;
  while (i - 1 >= first) {
    const prev = b.parent.child(i - 1);
    const head = prev.firstChild;
    if (!head) return null;
    if (head.type.name === "blockquote") return head;
    if (head.type.name === "paragraph" && hasWords(head)) {
      i -= 1;
      continue;
    }
    return null;
  }
  if (isBlock(b.parent)) {
    const head = b.parent.firstChild;
    if (head?.type.name === "blockquote") return head;
  }
  return null;
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
