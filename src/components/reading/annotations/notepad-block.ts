import { mergeAttributes, Node } from "@tiptap/core";
import { DOMParser as PMDOMParser, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type Command } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { newId, NOTE_BLOCK, NOTEPAD_INSERT_META } from "@/lib/reading/note-tree";
import {
  blockAt,
  headEnd,
  indentBlock,
  isBlock,
  joinBlockBackward,
  joinBlockForward,
  liftHiddenSelection,
  moveBlockDown,
  moveBlockUp,
  outdentBlock,
  setCollapsed,
  splitBlock,
  toggleCollapsedAt,
} from "./notepad-block-commands";

/**
 * A line of the notepad, and the lines under it.
 *
 * The notepad is an outline: every line is one of these, holding a head (a
 * paragraph, a heading, or a quote that landed from a highlight) and then any
 * blocks nested beneath it. A block can be folded, hiding its children; that
 * is an attribute, so it's saved with the note and the same on every device.
 *
 * Drawn quietly. A top-level line looks like a paragraph — no bullet. A
 * nested line gets a faint dot, with a thin guide line running down from its
 * parent, and a folded line a filled ring whatever its level. On a desktop
 * the gutter shows a drag handle when the pointer is over the line; on a
 * phone the dots are always there to tap.
 *
 * Folding hides children with CSS — they stay in the document, which is what
 * lets them save, copy, and come back — and a plugin here keeps the caret out
 * of anything hidden. Dragging is ProseMirror's own node drag, started from
 * the handle, with the drop worked out here: above the top half of a line
 * puts you before it, below the bottom half after it (or under it, when it
 * has children showing, or when the pointer is pushed to the right).
 *
 * The keys — Tab, Shift-Tab, ⌥↑↓, ⌘↑↓, Enter, Backspace, Delete — are in
 * notepad-block-commands.ts, where they can be run without a browser.
 *
 * Anything arriving as HTML — a note from before the outline, coming through
 * the markdown parser; a paste — is lifted into blocks first (liftIntoBlocks
 * below), one per top-level element, list items nested as they were. Left to
 * ProseMirror's own wrapping, a run of paragraphs would nest each under the
 * one before: the wrapper it opens for the first stays open, and the only
 * place a second paragraph fits inside it is as a child. Several lines pasted
 * then go in whole, one after another after the line the caret is on (or in
 * place of it, when it's empty); a single line pasted joins the sentence.
 */
export const NotepadDoc = Node.create({
  name: "doc",
  topNode: true,
  content: `${NOTE_BLOCK}+`,
});

/** How far a child sits in from its parent — the gutter's width. Mirrored in globals.css. */
const GUTTER_PX = 22;

export const NoteBlock = Node.create({
  name: NOTE_BLOCK,
  content: `(paragraph | heading | blockquote) ${NOTE_BLOCK}*`,
  defining: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-id") || newId(),
        renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
      },
      collapsed: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-collapsed") === "true",
        renderHTML: (attrs) => ({ "data-collapsed": attrs.collapsed ? "true" : "false" }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "div[data-note-block]", contentElement: ".nb-body" },
      // An old note's markdown list: each item becomes a block, nested as it
      // was. The <ul> around them has no rule and is looked through.
      { tag: "li" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-note-block": "" }),
      ["div", { class: "nb-body" }, 0],
    ];
  },

  addStorage() {
    return {
      markdown: {
        // Old markdown on its way in, after markdown-it and before ProseMirror.
        parse: {
          updateDOM(element: HTMLElement) {
            liftIntoBlocks(element);
          },
        },
        // Only for copy-as-markdown, which the notepad doesn't turn on; the
        // stored markdown is treeToMarkdown's. Head, then children, flat.
        serialize(state: MarkdownState, node: PMNode) {
          state.renderContent(node);
          state.closeBlock(node);
        },
      },
    };
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      const dom = document.createElement("div");
      dom.setAttribute("data-note-block", "");

      const gutter = document.createElement("div");
      gutter.className = "nb-gutter";
      gutter.contentEditable = "false";

      const handle = document.createElement("span");
      handle.className = "nb-handle";
      handle.setAttribute("data-drag-handle", "");
      handle.setAttribute("role", "button");
      handle.setAttribute("aria-label", "Drag to move this line");
      handle.title = "Drag to move";
      handle.innerHTML = GRIP_SVG;

      const toggle = document.createElement("span");
      toggle.className = "nb-toggle";
      toggle.setAttribute("role", "button");

      gutter.append(handle, toggle);

      const body = document.createElement("div");
      body.className = "nb-body";
      dom.append(gutter, body);

      const apply = (n: PMNode) => {
        const collapsed = n.attrs.collapsed === true;
        const children = n.childCount > 1;
        dom.setAttribute("data-collapsed", collapsed ? "true" : "false");
        dom.setAttribute("data-children", children ? "true" : "false");
        if (n.attrs.id) dom.setAttribute("data-id", n.attrs.id as string);
        toggle.setAttribute("aria-label", collapsed ? "Show what's under this line" : "Hide what's under this line");
        toggle.title = children ? (collapsed ? "Expand" : "Collapse") : "";
      };
      apply(node);

      toggle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = getPos();
        if (pos == null) return;
        toggleFoldInPlace(editor.view, pos);
      });

      return {
        dom,
        contentDOM: body,
        update(n) {
          if (n.type !== node.type) return false;
          node = n;
          apply(n);
          return true;
        },
        // What the gutter does to itself is none of ProseMirror's business.
        ignoreMutation(m) {
          if (m.type === "selection") return false;
          if (m.target === body && m.type === "attributes") return true;
          return !body.contains(m.target);
        },
        // The toggle handles its own press; the handle must stay visible to
        // ProseMirror, whose mousedown is what starts the drag.
        stopEvent(e) {
          return toggle.contains(e.target as globalThis.Node);
        },
      };
    };
  },

  // HTML from elsewhere: lifted, so its paragraphs are lines. An extension
  // field rather than a plugin prop — Tiptap composes this one itself, and
  // its version shadows a plugin's.
  transformPastedHTML(html: string) {
    const root = document.createElement("div");
    root.innerHTML = html;
    if (!hasBlockChildren(root)) return html;
    liftIntoBlocks(root);
    return root.innerHTML;
  },

  addKeyboardShortcuts() {
    const run = (cmd: Command) => () => cmd(this.editor.state, this.editor.view.dispatch);
    return {
      // Tab is taken even when there's nothing to do — it must never walk
      // focus out of the notes.
      Tab: () => {
        indentBlock(this.editor.state, this.editor.view.dispatch);
        return true;
      },
      "Shift-Tab": () => {
        outdentBlock(this.editor.state, this.editor.view.dispatch);
        return true;
      },
      "Alt-ArrowUp": run(moveBlockUp),
      "Alt-ArrowDown": run(moveBlockDown),
      "Mod-ArrowUp": run(setCollapsed(true)),
      "Mod-ArrowDown": run(setCollapsed(false)),
      Enter: run(splitBlock),
      Backspace: run(joinBlockBackward),
      Delete: run(joinBlockForward),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("notepad-block-ids"),
        // Every block gets an id, and a copy gets a new one: a split, a paste
        // and an ⌥-drag all duplicate attrs. Part of the same history step as
        // whatever made the block.
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          let tr: ReturnType<typeof state.tr.setNodeMarkup> | null = null;
          state.doc.descendants((n, pos) => {
            if (!isBlock(n)) return true;
            const id = n.attrs.id as string | null;
            if (id && !seen.has(id)) {
              seen.add(id);
              return true;
            }
            const fresh = newId();
            seen.add(fresh);
            tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, { ...n.attrs, id: fresh });
            return true;
          });
          return tr;
        },
      }),
      new Plugin({
        key: new PluginKey("notepad-block-visible"),
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged || tr.selectionSet)) return null;
          return liftHiddenSelection(state);
        },
      }),
      new Plugin({
        key: new PluginKey("notepad-block-paste"),
        props: {
          // Plain text (⇧⌘V, or text the markdown parser passed on): a line
          // per paragraph, lifted, so lines never nest under each other.
          clipboardTextParser(text, $context, _plain, view) {
            const root = document.createElement("div");
            for (const line of text.split(/(?:\r\n?|\n)+/)) {
              const p = document.createElement("p");
              if (line) p.textContent = line;
              root.appendChild(p);
            }
            liftIntoBlocks(root);
            return PMDOMParser.fromSchema(view.state.schema).parseSlice(root, {
              preserveWhitespace: true,
              context: $context,
            });
          },
          // Several whole lines: close the slice so they go in whole. One
          // line stays open so a word pasted mid-sentence joins the sentence.
          transformPasted(slice) {
            return wholeBlocks(slice) ? new Slice(slice.content, 0, 0) : slice;
          },
          // …and put them after the line the caret is on, at its level — or
          // in its place when it's empty — rather than wherever they'd fit.
          handlePaste(view, _event, slice) {
            if (!wholeBlocks(slice) || slice.openStart !== 0) return false;
            const { state } = view;
            const tr = state.tr;
            if (!state.selection.empty) tr.deleteSelection();
            const b = blockAt(tr.selection.$from);
            if (!b) return false;
            const head = b.node.firstChild!;
            const blank = head.type.name === "paragraph" && head.content.size === 0 && b.node.childCount === 1;
            const at = blank ? b.pos : b.end;
            if (blank) tr.replaceWith(b.pos, b.end, slice.content);
            else tr.insert(at, slice.content);
            const last = slice.content.lastChild!;
            tr.setSelection(headEnd(tr.doc, last, at + slice.content.size - last.nodeSize));
            tr.setMeta(NOTEPAD_INSERT_META, true).setMeta("uiEvent", "paste").setMeta("paste", true);
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
      new Plugin({
        key: new PluginKey("notepad-block-drop"),
        props: {
          handleDOMEvents: {
            dragover(view, event) {
              if (!(view.dragging as DraggingBlock | null)?.node) return false;
              const plan = planDrop(view, event);
              if (plan) showDropLine(plan);
              else hideDropLine();
              return false;
            },
            dragleave(view, event) {
              const to = event.relatedTarget as globalThis.Node | null;
              if (!to || !view.dom.contains(to)) hideDropLine();
              return false;
            },
            dragend() {
              hideDropLine();
              return false;
            },
            drop(view, event) {
              hideDropLine();
              return dropBlock(view, event);
            },
          },
        },
      }),
    ];
  },
});

type MarkdownState = { renderContent: (node: PMNode) => void; closeBlock: (node: PMNode) => void };

/* ------------------------------------------------------------------ */
/* HTML on its way in                                                  */
/* ------------------------------------------------------------------ */

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "LI", "PRE", "DIV", "HR", "TABLE", "SECTION", "ARTICLE",
]);

/** Two or more blocks and nothing else at the top of a slice: lines, pasted. */
function wholeBlocks(slice: Slice): boolean {
  const n = slice.content.childCount;
  if (n < 2) return false;
  for (let i = 0; i < n; i++) if (!isBlock(slice.content.child(i))) return false;
  return true;
}

function hasBlockChildren(root: Element): boolean {
  return Array.from(root.children).some((el) => BLOCK_TAGS.has(el.tagName));
}

function isBlockEl(el: Element): boolean {
  return el.hasAttribute("data-note-block");
}

/**
 * Every top-level element becomes a block, in place; a list becomes blocks
 * nested as its items were; anything that is already a block is left as it
 * is. Inline odds and ends at the top level are gathered into a paragraph.
 */
/**
 * Fold or unfold the block at `pos` without moving it on screen.
 *
 * Folding takes height out of the pad. Mid-document the lines below simply
 * close up. At the end, with nothing below to close up, the browser clamps
 * the scroll instead and the whole column slides down — the ring you just
 * pressed along with it, out from under the pointer. So: note where the
 * block sits, fold, then scroll by however far it moved. The pad keeps room
 * below its last line for exactly this (see the scroll box in notepad.tsx).
 */
export function toggleFoldInPlace(view: EditorView, pos: number): boolean {
  const scroller = view.dom.closest<HTMLElement>("[data-notepad-scroll]");
  const dom = view.nodeDOM(pos) as HTMLElement | null;
  const before = dom?.getBoundingClientRect().top;
  const done = toggleCollapsedAt(pos)(view.state, view.dispatch);
  if (!done || !scroller || !dom || before == null) return done;
  const after = dom.getBoundingClientRect().top;
  if (after !== before) scroller.scrollTop += after - before;
  return done;
}

export function liftIntoBlocks(root: Element) {
  const doc = root.ownerDocument;
  const blocks: Element[] = [];
  let loose: globalThis.Node[] = [];
  const flushLoose = () => {
    if (loose.some((n) => n.textContent?.trim())) {
      const p = doc.createElement("p");
      p.append(...loose);
      blocks.push(wrapBlock(doc, p));
    } else {
      loose.forEach((n) => n.parentNode?.removeChild(n));
    }
    loose = [];
  };
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== 1) {
      loose.push(child);
      continue;
    }
    const el = child as Element;
    if (!BLOCK_TAGS.has(el.tagName) && !isBlockEl(el)) {
      loose.push(el);
      continue;
    }
    flushLoose();
    if (isBlockEl(el)) blocks.push(el);
    else if (el.tagName === "UL" || el.tagName === "OL") blocks.push(...listToBlocks(doc, el));
    else blocks.push(wrapBlock(doc, el));
  }
  flushLoose();
  root.replaceChildren(...blocks);
}

function wrapBlock(doc: Document, head: Element, children: Element[] = []): Element {
  const block = doc.createElement("div");
  block.setAttribute("data-note-block", "");
  const body = doc.createElement("div");
  body.className = "nb-body";
  body.append(head, ...children);
  block.append(body);
  return block;
}

/** A list's items as blocks: an item's own words as the head, its sub-list as children. */
function listToBlocks(doc: Document, list: Element): Element[] {
  const out: Element[] = [];
  for (const li of Array.from(list.children)) {
    if (li.tagName !== "LI") continue;
    const heads: Element[] = [];
    const children: Element[] = [];
    let inline: globalThis.Node[] = [];
    const flushInline = () => {
      if (inline.some((n) => n.textContent?.trim())) {
        const p = doc.createElement("p");
        p.append(...inline);
        heads.push(p);
      }
      inline = [];
    };
    for (const n of Array.from(li.childNodes)) {
      const el = n.nodeType === 1 ? (n as Element) : null;
      if (el && (el.tagName === "UL" || el.tagName === "OL")) {
        flushInline();
        children.push(...listToBlocks(doc, el));
      } else if (el && BLOCK_TAGS.has(el.tagName)) {
        flushInline();
        heads.push(el);
      } else {
        inline.push(n);
      }
    }
    flushInline();
    const [head = doc.createElement("p"), ...more] = heads;
    // A loose item with several paragraphs: the first is the line, the rest
    // go under it, ahead of any sub-list.
    out.push(wrapBlock(doc, head, [...more.map((m) => wrapBlock(doc, m)), ...children]));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Drag and drop                                                       */
/* ------------------------------------------------------------------ */

/** What ProseMirror keeps while a node is being dragged (the `node` is undocumented but stable). */
type DraggingBlock = { slice: Slice; move: boolean; node?: NodeSelection };

type DropPlan = {
  /** Where the dragged block goes. */
  pos: number;
  /** The block the pointer is over, before anything moves. */
  targetPos: number;
  /** Whether the drop puts the block under the target — which unfolds it. */
  under: boolean;
  /** The line to draw, in viewport coordinates. */
  line: { left: number; top: number; width: number };
};

/**
 * Where a drop would land.
 *
 * Over the top half of a line: before it. Over the bottom half: under it
 * when its children are showing (that's where the eye expects the next line),
 * or after everything beneath it — unless the pointer has been pushed a
 * gutter's width to the right, which asks for it to go under. Below the last
 * line: the end of the note.
 */
function planDrop(view: EditorView, event: DragEvent): DropPlan | null {
  const el = (event.target as Element | null)?.closest?.("[data-note-block]") as HTMLElement | null;
  const doc = view.state.doc;
  const editorRect = view.dom.getBoundingClientRect();

  if (!el || !view.dom.contains(el)) {
    if (!view.dom.contains(event.target as globalThis.Node) && event.target !== view.dom) return null;
    const last = doc.lastChild!;
    const lastEl = view.dom.lastElementChild as HTMLElement | null;
    const bottom = lastEl ? lastEl.getBoundingClientRect().bottom : editorRect.top;
    return {
      pos: doc.content.size,
      targetPos: doc.content.size - last.nodeSize,
      under: false,
      line: { left: editorRect.left + GUTTER_PX, top: bottom, width: editorRect.width - GUTTER_PX },
    };
  }

  const id = el.getAttribute("data-id");
  let found: { node: PMNode; pos: number } | null = null;
  if (id) {
    doc.descendants((n, pos) => {
      if (found) return false;
      if (isBlock(n) && n.attrs.id === id) {
        found = { node: n, pos };
        return false;
      }
      return true;
    });
  }
  if (!found) return null;
  const { node, pos } = found as { node: PMNode; pos: number };

  const body = el.querySelector(":scope > .nb-body") as HTMLElement | null;
  const headEl = (body?.firstElementChild as HTMLElement | null) ?? el;
  const headRect = headEl.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const width = elRect.right - headRect.left;

  if (event.clientY < headRect.top + headRect.height / 2) {
    return {
      pos,
      targetPos: pos,
      under: false,
      line: { left: headRect.left, top: headRect.top, width },
    };
  }

  const showing = node.childCount > 1 && !node.attrs.collapsed;
  if (showing) {
    return {
      pos: pos + 1 + node.firstChild!.nodeSize,
      targetPos: pos,
      under: true,
      line: { left: headRect.left + GUTTER_PX, top: headRect.bottom, width: width - GUTTER_PX },
    };
  }
  if (event.clientX >= headRect.left + GUTTER_PX) {
    return {
      pos: pos + node.nodeSize - 1,
      targetPos: pos,
      under: true,
      line: { left: headRect.left + GUTTER_PX, top: elRect.bottom, width: width - GUTTER_PX },
    };
  }
  return {
    pos: pos + node.nodeSize,
    targetPos: pos,
    under: false,
    line: { left: headRect.left, top: elRect.bottom, width },
  };
}

/**
 * A block dropped: one transaction — out of where it was, into where it
 * goes, and selected there — so ⌘Z is one step. Anything that isn't one of
 * our blocks being dragged (text from the page, say) is left to ProseMirror.
 */
function dropBlock(view: EditorView, event: DragEvent): boolean {
  const dragging = view.dragging as DraggingBlock | null;
  const src = dragging?.node;
  if (!dragging || !src) return false;

  const plan = planDrop(view, event);
  event.preventDefault();
  view.dragging = null;
  if (!plan) return true;
  // Onto itself, or under itself: nowhere to go.
  if (plan.pos >= src.from && plan.pos <= src.to) return true;

  const tr = view.state.tr;
  if (dragging.move) tr.delete(src.from, src.to);
  const at = tr.mapping.map(plan.pos);
  const targetPos = tr.mapping.map(plan.targetPos);
  tr.insert(at, dragging.slice.content);
  if (plan.under) {
    const target = tr.doc.nodeAt(targetPos);
    if (target && isBlock(target) && target.attrs.collapsed) {
      tr.setNodeMarkup(targetPos, undefined, { ...target.attrs, collapsed: false });
    }
  }
  tr.setSelection(NodeSelection.create(tr.doc, at));
  tr.setMeta(NOTEPAD_INSERT_META, true).setMeta("uiEvent", "drop");
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

let dropLine: HTMLDivElement | null = null;

function showDropLine(plan: DropPlan) {
  if (!dropLine) {
    dropLine = document.createElement("div");
    dropLine.className = "notepad-dropline";
    document.body.appendChild(dropLine);
  }
  dropLine.style.left = `${plan.line.left}px`;
  dropLine.style.top = `${plan.line.top - 1}px`;
  dropLine.style.width = `${Math.max(40, plan.line.width)}px`;
}

function hideDropLine() {
  dropLine?.remove();
  dropLine = null;
}

const GRIP_SVG =
  '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" fill="currentColor">' +
  '<circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/>' +
  '<circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>' +
  '<circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';
