import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { parsePillHref, pillMarkdown, type NotePill, type NotePlace } from "@/lib/reading/notes";

/** The slice of tiptap-markdown's serializer state a leaf node needs. */
type MarkdownSerializerState = { write: (text: string) => void };

/**
 * A pill in the notepad's text: a place in the book, a day, or a conversation.
 *
 * An inline atom: one character wide as far as the cursor is concerned, so it
 * moves, cuts and pastes like a word and never gets edited from the inside. The
 * label is an attribute rather than content for the same reason — a pill that
 * said "p. 4" after a stray backspace would point at one place and name another.
 *
 * Stored as a markdown link — see notes.ts for the three forms and why. The
 * parse side rides on markdown-it, which already turns a link into an anchor;
 * the hook below just swaps every pill-scheme anchor for the span this node
 * reads, before Tiptap ever sees the HTML.
 */
export const PILL_NODE = "pill";

/** What the DOM pill is called, for the click handler and the stylesheet. */
export const PILL_ATTR = "data-pill";

export const NotepadPill = Node.create({
  name: PILL_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: {
        default: "place",
        parseHTML: (el) => el.getAttribute(PILL_ATTR) ?? "place",
        renderHTML: (attrs) => ({ [PILL_ATTR]: attrs.kind }),
      },
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
      char: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-char");
          return v == null ? null : Number(v);
        },
        renderHTML: (attrs) => (attrs.char == null ? {} : { "data-char": String(attrs.char) }),
      },
      mark: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-mark"),
        renderHTML: (attrs) => (attrs.mark ? { "data-mark": attrs.mark } : {}),
      },
      date: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-date"),
        renderHTML: (attrs) => (attrs.date ? { "data-date": attrs.date } : {}),
      },
      thread: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-thread"),
        renderHTML: (attrs) => (attrs.thread ? { "data-thread": attrs.thread } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${PILL_ATTR}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = node.attrs.kind as NotePill["kind"];
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: `notepad-pill notepad-pill-${kind}`,
        role: kind === "date" ? undefined : "link",
        title:
          kind === "place"
            ? "Go to this place in the book"
            : kind === "thread"
              ? "Open this conversation"
              : undefined,
      }),
      node.attrs.label as string,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.write(pillMarkdown(pillOf(node)));
        },
        parse: {
          /**
           * Runs on the DOM markdown-it produced, before Tiptap parses it.
           * Every anchor with a pill scheme becomes the span above.
           */
          updateDOM(element: HTMLElement) {
            for (const a of Array.from(element.querySelectorAll("a"))) {
              const pill = parsePillHref(a.getAttribute("href"));
              if (!pill) continue;
              const span = element.ownerDocument.createElement("span");
              span.setAttribute(PILL_ATTR, pill.kind);
              span.setAttribute("data-label", a.textContent ?? "");
              if (pill.kind === "place") {
                span.setAttribute("data-char", String(pill.char));
                if (pill.mark) span.setAttribute("data-mark", pill.mark);
              } else if (pill.kind === "date") {
                span.setAttribute("data-date", pill.date);
              } else {
                span.setAttribute("data-thread", pill.thread);
              }
              span.textContent = a.textContent;
              a.replaceWith(span);
            }
          },
        },
      },
    };
  },
});

/** The pill a node stands for. */
export function pillOf(node: PMNode): NotePill {
  const a = node.attrs;
  const label = (a.label as string) ?? "";
  if (a.kind === "date") return { kind: "date", date: (a.date as string) ?? "", label };
  if (a.kind === "thread") return { kind: "thread", thread: (a.thread as string) ?? "", label };
  return { kind: "place", char: (a.char as number) ?? 0, mark: (a.mark as string | null) ?? null, label };
}

/** The node's JSON, for insertContent. */
export function pillJSON(pill: NotePill) {
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

export function placeNodeJSON(place: NotePlace) {
  return pillJSON({ kind: "place", ...place });
}
