import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Decoration } from "@tiptap/pm/view";
import { pillMarkdown } from "@/lib/reading/notes";
import { THREAD_BLOCK, threadLabel, type ThreadBlockAttrs } from "@/lib/reading/note-tree";

export { THREAD_BLOCK } from "@/lib/reading/note-tree";

/** The slice of tiptap-markdown's serializer state a leaf node needs. */
type MarkdownSerializerState = { write: (text: string) => void; closeBlock: (node: PMNode) => void };

/**
 * What the notepad knows about a conversation right now, drawn over the block
 * as a decoration rather than stored in it — the same rule the reply count on
 * a pill followed: a fact about the thread, not about the note, and it changes
 * while the note stands still.
 */
export type ThreadFacts = {
  title: string | null;
  replies: number;
  unread: number;
  /** The AI is in it. */
  ai: boolean;
  /** Everyone in it, the reader included. */
  participants: { userId: string; name: string }[];
  createdAt: string;
};

/** The key the facts travel under in a node decoration's spec. */
export const THREAD_FACTS_SPEC = "threadFacts";

/**
 * How long a nameless block is drawn as "still being named" after the thread
 * started. A name takes a second or two; a block still nameless after this
 * was never going to get one from this visit, and a glyph that pulses for
 * ever is a broken thing pretending to work.
 */
const SETTLING_MS = 2 * 60 * 1000;

export type ThreadBlockOptions = {
  /**
   * People the reader can name — everyone but themselves. What tells a face
   * on the block from the reader's own, since the block doesn't know who is
   * looking at it.
   */
  others: () => { userId: string | null }[];
};

/**
 * A line that became a conversation.
 *
 * Ending a line with /ask, or sending it to somebody with @, turns the line
 * into one of these: a single locked line in the outline that stands for the
 * conversation and wears its name — "Why the maestro is late" — with who is
 * in it at the front and how much has been said at the end. Press it, or
 * press Enter on it, and the conversation opens. The words the line had are
 * not lost; they are the conversation's first message, and the block shows
 * them until a name arrives.
 *
 * An atom, and not selectable: there is no caret position inside it, so the
 * arrow keys step over it to the lines beside it and nothing in it can be
 * edited from the notepad. To rename it, rename the conversation. Lines still
 * nest under it — an ask can be the heading the notes on its answer sit
 * beneath — because the nesting belongs to the block around it, not to this.
 *
 * Deleting it (Backspace on the line, twice — the first press picks it up)
 * takes the line out of the note and nothing else: the conversation is still
 * in the list of marks, exactly as deleting a pill worked before.
 *
 * The block is drawn from two things: its own attrs — a copy of the name as
 * last seen, and the question — and the live facts about the thread that the
 * panel hands the notepad, which win when present (update below). An
 * attribute changed on the DOM never reaches ProseMirror, so this view is
 * free to redraw itself as often as the facts change.
 */
export const NotepadThreadBlock = Node.create<ThreadBlockOptions>({
  name: THREAD_BLOCK,
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  isolating: true,

  addOptions() {
    return { others: () => [] };
  },

  addAttributes() {
    return {
      thread: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-thread") ?? "",
        renderHTML: (attrs) => ({ "data-thread": attrs.thread as string }),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-title"),
        renderHTML: (attrs) => (attrs.title ? { "data-title": attrs.title as string } : {}),
      },
      kind: {
        default: "ask",
        parseHTML: (el) => (el.getAttribute("data-kind") === "member" ? "member" : "ask"),
        renderHTML: (attrs) => ({ "data-kind": attrs.kind as string }),
      },
      question: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-question") ?? "",
        renderHTML: (attrs) => ({ "data-question": attrs.question as string }),
      },
    };
  },

  parseHTML() {
    // A line copied within the notepad and pasted back is still the same
    // conversation.
    return [{ tag: "div[data-thread-block]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-thread-block": "", class: "ntb" }),
      threadLabel(node.attrs),
    ];
  },

  addStorage() {
    return {
      markdown: {
        // The same link the pill wrote — see treeToMarkdown, which is what
        // the stored markdown actually comes from.
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const a = node.attrs as ThreadBlockAttrs;
          state.write(pillMarkdown({ kind: "thread", thread: a.thread, label: threadLabel(a) }));
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },

  addNodeView() {
    const options = this.options;
    return ({ node: initial, decorations: initialDecorations }) => {
      let node = initial;
      let facts: ThreadFacts | null = null;
      let loaded = false;

      const dom = document.createElement("div");
      dom.className = "ntb";
      dom.setAttribute("data-thread-block", "");
      dom.contentEditable = "false";
      dom.setAttribute("role", "button");
      dom.tabIndex = -1;

      const glyph = document.createElement("span");
      glyph.className = "ntb-glyph";
      glyph.setAttribute("aria-hidden", "true");

      const title = document.createElement("span");
      title.className = "ntb-title";

      const count = document.createElement("span");
      count.className = "ntb-count";
      count.setAttribute("aria-hidden", "true");

      const dot = document.createElement("span");
      dot.className = "ntb-dot";
      dot.setAttribute("aria-hidden", "true");

      dom.append(glyph, title, count, dot);

      const apply = () => {
        const a = node.attrs as ThreadBlockAttrs;
        const name = facts?.title?.trim() || threadLabel(a);
        title.textContent = name;
        dom.setAttribute("data-kind", a.kind);
        dom.setAttribute("data-thread", a.thread);
        dom.title = "Open this conversation";
        dom.setAttribute("aria-label", `Open the conversation "${name}"`);

        const replies = facts?.replies ?? 0;
        if (replies > 0) count.setAttribute("data-replies", String(replies));
        else count.removeAttribute("data-replies");
        if ((facts?.unread ?? 0) > 0) dom.setAttribute("data-unread", "true");
        else dom.removeAttribute("data-unread");

        // Nameless and new: the name is on its way. Nameless and old: it isn't.
        const nameless = !(facts?.title?.trim() || a.title?.trim());
        const age = facts ? Date.now() - new Date(facts.createdAt).getTime() : 0;
        const settling = nameless && (!facts || (Number.isFinite(age) && age < SETTLING_MS));
        if (settling) dom.setAttribute("data-settling", "true");
        else dom.removeAttribute("data-settling");
        if (nameless) dom.setAttribute("data-nameless", "true");
        else dom.removeAttribute("data-nameless");

        // The list of marks has loaded and this conversation isn't in it: the
        // mark it points at is gone from this copy of the book.
        if (loaded && !facts) dom.setAttribute("data-missing", "true");
        else dom.removeAttribute("data-missing");

        drawGlyph(glyph, a, facts, options.others());
      };

      const read = (decorations: readonly Decoration[]) => {
        const deco = decorations.find((d) => d.spec && THREAD_FACTS_SPEC in d.spec);
        if (!deco) return;
        facts = (deco.spec[THREAD_FACTS_SPEC] as ThreadFacts | null) ?? null;
        loaded = deco.spec.loaded === true;
      };

      read(initialDecorations);
      apply();

      return {
        dom,
        update(n: PMNode, decorations: readonly Decoration[]) {
          if (n.type !== node.type) return false;
          node = n;
          read(decorations);
          apply();
          return true;
        },
        // Everything drawn here is the view's own; nothing is content.
        ignoreMutation: () => true,
        // Presses go through to ProseMirror, whose click handler in the
        // notepad is what opens the conversation.
        stopEvent: () => false,
      };
    };
  },
});

/**
 * Who is in it, at the front of the line.
 *
 * A sparkle for the AI; an initial for each other person; both when both are
 * in it. Before the facts arrive the block's kind is all there is to go on,
 * and it is right nearly always: an ask has the AI in it, a line sent to
 * somebody has them.
 */
function drawGlyph(
  el: HTMLElement,
  attrs: ThreadBlockAttrs,
  facts: ThreadFacts | null,
  others: { userId: string | null }[]
) {
  const otherIds = new Set(others.map((o) => o.userId).filter((id): id is string => !!id));
  const people = facts ? facts.participants.filter((p) => otherIds.has(p.userId)) : [];
  const ai = facts ? facts.ai : attrs.kind === "ask";
  const parts: string[] = [];
  if (ai) parts.push(SPARKLE_SVG);
  for (const p of people.slice(0, 2)) {
    const initial = (p.name.trim()[0] ?? "?").toUpperCase();
    parts.push(`<span class="ntb-face">${escapeHtml(initial)}</span>`);
  }
  // A line sent to somebody, before the facts say who: a face with no name yet.
  if (parts.length === 0) parts.push(`<span class="ntb-face">@</span>`);
  el.innerHTML = parts.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** lucide's sparkles, inline so the view needs no React. */
const SPARKLE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>' +
  '<path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
