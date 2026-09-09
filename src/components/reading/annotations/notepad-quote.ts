import Blockquote from "@tiptap/extension-blockquote";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Lines of a quote shown before it folds under a fade. Mirrored in globals.css. */
export const QUOTE_CLAMP_LINES = 3;

/**
 * A quote in the notepad: the book's words, folded short by default.
 *
 * A clipped passage can run to a dozen lines, and set at full length it pushes
 * a screen of the reader's own thinking out of view. So a quote longer than a
 * few lines shows its first few and fades. Three things open it:
 *
 *   - the caret being inside it, because nobody should type behind a fade;
 *   - a press on the fade, or anywhere on the scrap's paper outside the words
 *     themselves, which sticks until that paper is pressed again — no control
 *     of its own, so a folded quote costs not one line more than its text;
 *   - being short enough to fit, in which case nothing is drawn at all.
 *
 * "Shown" is a fact about this visit, not the note: it lives on the node view
 * and is gone on reload. The quote's text is never touched — folding is a
 * matter of how much of it is on screen.
 *
 * Distinct from the outline's fold on purpose. A folded LINE hides what is
 * nested under it and is marked by a ring in the gutter; a folded QUOTE hides
 * the rest of itself and is marked by a fade. A line folded in the outline
 * never shows a fade, because the quote under it isn't drawn at all.
 */
export const NotepadQuote = Blockquote.extend({
  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      const dom = document.createElement("blockquote");
      dom.className = "nq";

      const body = document.createElement("div");
      body.className = "nq-body";

      // The fade over the last visible lines; the other thing to press.
      const fade = document.createElement("span");
      fade.className = "nq-fade";
      fade.contentEditable = "false";
      fade.setAttribute("aria-hidden", "true");

      dom.append(body, fade);

      /** Pressed open, for this visit. */
      let shown = false;
      /** The caret is in it. */
      let inside = false;
      /** Overflows the clamp — the only case in which any of this is drawn. */
      let long = false;

      const apply = () => {
        dom.setAttribute("data-long", long ? "true" : "false");
        dom.setAttribute("data-open", shown || inside ? "true" : "false");
        dom.title = !long ? "" : shown ? "Fold the quote" : "Show the whole quote";
        fade.title = long && !shown && !inside ? "Show the whole quote" : "";
      };

      // The clamp is N line-heights; the body's scroll height is the whole
      // text regardless of any max-height on it. Read line-height resolved,
      // so the number is in pixels whatever the stylesheet said.
      const measure = () => {
        const lh = parseFloat(getComputedStyle(body).lineHeight);
        if (!Number.isFinite(lh) || lh <= 0) return;
        const next = body.scrollHeight > QUOTE_CLAMP_LINES * lh + 2;
        if (next !== long) {
          long = next;
          apply();
        }
      };

      const checkCaret = () => {
        const pos = getPos();
        if (pos == null) return;
        const { from, to } = editor.state.selection;
        const next = from >= pos && to <= pos + node.nodeSize;
        if (next !== inside) {
          inside = next;
          apply();
        }
      };

      // Not places for the caret to land.
      const swallow = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };
      /** The scrap's paper: inside it, but not on the words. */
      const onPaper = (t: EventTarget | null) =>
        t instanceof globalThis.Node && dom.contains(t) && !body.contains(t) && !fade.contains(t);

      dom.addEventListener("mousedown", (e) => {
        if (!long || !onPaper(e.target)) return;
        swallow(e);
      });
      dom.addEventListener("click", (e) => {
        if (!long || !onPaper(e.target)) return;
        swallow(e);
        shown = !shown;
        apply();
      });
      fade.addEventListener("mousedown", swallow);
      fade.addEventListener("click", (e) => {
        swallow(e);
        shown = true;
        apply();
      });

      editor.on("selectionUpdate", checkCaret);
      // Width changes re-wrap the text, so what was long may no longer be.
      const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
      ro?.observe(dom);

      apply();
      // Not in the document yet at construction; measure once it is.
      requestAnimationFrame(() => {
        measure();
        checkCaret();
      });

      return {
        dom,
        contentDOM: body,
        update(n: PMNode) {
          if (n.type !== node.type) return false;
          node = n;
          // The text changed under it; the DOM has too, by the time this runs.
          requestAnimationFrame(measure);
          return true;
        },
        // The fade and the attributes are the view's own business.
        ignoreMutation(m) {
          if (m.type === "selection") return false;
          if (m.target === dom && m.type === "attributes") return true;
          return !body.contains(m.target);
        },
        stopEvent(e) {
          const t = e.target as globalThis.Node;
          // A quote short enough to fit has no fold, so its margins are just
          // margins and a press in them should place the caret as usual.
          return fade.contains(t) || (long && onPaper(t));
        },
        destroy() {
          editor.off("selectionUpdate", checkCaret);
          ro?.disconnect();
        },
      };
    };
  },
});
