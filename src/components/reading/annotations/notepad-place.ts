import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** The slice of tiptap-markdown's serializer state a leaf node needs. */
type MarkdownSerializerState = { write: (text: string) => void };
import { parsePlaceHref, placeHref, placeMarkdown, type NotePlace } from "@/lib/reading/notes";

/**
 * A place in the book, as a pill in the notepad's text.
 *
 * An inline atom: one character wide as far as the cursor is concerned, so it
 * moves, cuts and pastes like a word and never gets edited from the inside. The
 * label is an attribute rather than content for the same reason — a pill that
 * said "p. 4" after a stray backspace would point at one place and name another.
 *
 * Stored as a markdown link ([label](place:CHAR)) — see notes.ts for why. The
 * parse side rides on markdown-it, which already turns that into an anchor;
 * the hook below just swaps every place-scheme anchor for the span this node
 * reads, before Tiptap ever sees the HTML.
 */
export const PLACE_NODE = "place";

/** What the DOM pill is called, for the click handler and the stylesheet. */
export const PLACE_ATTR = "data-place";

export const NotepadPlace = Node.create({
  name: PLACE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      char: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute(PLACE_ATTR) ?? 0),
        renderHTML: (attrs) => ({ [PLACE_ATTR]: String(attrs.char) }),
      },
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
      mark: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-mark"),
        renderHTML: (attrs) => (attrs.mark ? { "data-mark": attrs.mark } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${PLACE_ATTR}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "notepad-place",
        role: "link",
        title: "Go to this place in the book",
      }),
      node.attrs.label as string,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.write(placeMarkdown(node.attrs as NotePlace));
        },
        parse: {
          /**
           * Runs on the DOM markdown-it produced, before Tiptap parses it.
           * Every anchor with the place scheme becomes the span above.
           */
          updateDOM(element: HTMLElement) {
            for (const a of Array.from(element.querySelectorAll("a"))) {
              const place = parsePlaceHref(a.getAttribute("href"));
              if (!place) continue;
              const span = element.ownerDocument.createElement("span");
              span.setAttribute(PLACE_ATTR, String(place.char));
              span.setAttribute("data-label", a.textContent ?? "");
              if (place.mark) span.setAttribute("data-mark", place.mark);
              span.textContent = a.textContent;
              a.replaceWith(span);
            }
          },
        },
      },
    };
  },
});

/** The node's JSON, for insertContent. */
export function placeNodeJSON(place: NotePlace) {
  return {
    type: PLACE_NODE,
    attrs: { char: place.char, label: place.label, mark: place.mark },
  };
}

/** For anything that needs the href a pill would have serialized to. */
export { placeHref };
