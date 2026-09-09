import { Fragment, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import {
  NodeSelection,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { newId, NOTE_BLOCK, NOTEPAD_INSERT_META, NOTEPAD_NO_STAMP_META } from "@/lib/reading/note-tree";

/**
 * What the keys do to the outline.
 *
 * Plain ProseMirror commands — (state, dispatch) => boolean — with no DOM and
 * no editor in them, so the verify script can run every one of them against
 * the schema in node. The block extension (notepad-block.ts) binds them.
 *
 * The shape they all work on, from note-tree.ts:
 *
 *   doc        := noteBlock+
 *   noteBlock  := head noteBlock*        head = paragraph | heading | blockquote
 *
 * A block's children come straight after its head, no list wrapper between.
 * Every structural move is one delete and one insert of a whole subtree,
 * which is what keeps undo to one step per key.
 *
 * "Visible" below means not hidden under a collapsed ancestor. The caret only
 * ever sits in a visible head (notepad-block.ts keeps it out of hidden ones),
 * so a key that moves to the previous or next line has to skip what's folded
 * away — Backspace at the start of a line joins it to the line the reader can
 * SEE above it, not to the last grandchild of a collapsed neighbour.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-reader-notes.mts
 */

export type BlockInfo = {
  node: PMNode;
  /** Before the block's opening token. */
  pos: number;
  /** After its closing token. */
  end: number;
  /** The block's depth in the resolved position it came from. */
  depth: number;
  parent: PMNode;
  /** Index among the parent's children (the parent's head is child 0). */
  index: number;
};

export function isBlock(node: PMNode | null | undefined): boolean {
  return node?.type.name === NOTE_BLOCK;
}

/** The depth of the innermost block around a position, or 0 if none. */
export function blockDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d >= 1; d--) {
    if ($pos.node(d).type.name === NOTE_BLOCK) return d;
  }
  return 0;
}

/** The innermost block around a position. */
export function blockAt($pos: ResolvedPos): BlockInfo | null {
  const d = blockDepth($pos);
  if (d === 0) return null;
  return {
    node: $pos.node(d),
    pos: $pos.before(d),
    end: $pos.after(d),
    depth: d,
    parent: $pos.node(d - 1),
    index: $pos.index(d - 1),
  };
}

/** Whether a position inside a block is in its head rather than a child. */
export function inHead($pos: ResolvedPos): boolean {
  const d = blockDepth($pos);
  return d > 0 && $pos.index(d) === 0;
}

/** The index of a parent's first block child: past the head, if it has one. */
function firstChildIndex(parent: PMNode): number {
  return isBlock(parent) ? 1 : 0;
}

function hasChildren(node: PMNode): boolean {
  return node.childCount > 1;
}

/** A block's children, as a fragment (empty when it has none). */
function childrenFragment(node: PMNode): Fragment {
  return node.content.cut(node.firstChild!.nodeSize);
}

/** The position at the end of a block's head text. */
export function headEnd(doc: PMNode, node: PMNode, pos: number): Selection {
  return Selection.near(doc.resolve(pos + node.firstChild!.nodeSize), -1);
}

/** The position at the start of a block's head text. */
function headStart(doc: PMNode, pos: number): Selection {
  return Selection.near(doc.resolve(pos + 2), 1);
}

type Located = { node: PMNode; pos: number };

/** The last block the reader can see inside a subtree — the block itself when folded or childless. */
function deepestVisibleLast(node: PMNode, pos: number): Located {
  while (hasChildren(node) && !node.attrs.collapsed) {
    const last = node.lastChild!;
    pos = pos + node.nodeSize - 1 - last.nodeSize;
    node = last;
  }
  return { node, pos };
}

/** The visible block just above this one, or null at the top of the note. */
export function prevVisible($pos: ResolvedPos, b: BlockInfo): Located | null {
  if (b.index > firstChildIndex(b.parent)) {
    const sib = b.parent.child(b.index - 1);
    return deepestVisibleLast(sib, b.pos - sib.nodeSize);
  }
  if (isBlock(b.parent)) return { node: b.parent, pos: $pos.before(b.depth - 1) };
  return null;
}

/** The visible block just below this one, or null at the bottom of the note. */
export function nextVisible($pos: ResolvedPos, b: BlockInfo): Located | null {
  if (hasChildren(b.node) && !b.node.attrs.collapsed) {
    return { node: b.node.child(1), pos: b.pos + 1 + b.node.firstChild!.nodeSize };
  }
  for (let d = b.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (!isBlock(node)) continue;
    const parent = $pos.node(d - 1);
    const index = $pos.index(d - 1);
    if (index < parent.childCount - 1) {
      return { node: parent.child(index + 1), pos: $pos.after(d) };
    }
  }
  return null;
}

/** The block at the end of the note that the reader can see. */
export function lastVisible(doc: PMNode): Located {
  const last = doc.lastChild!;
  return deepestVisibleLast(last, doc.content.size - last.nodeSize);
}

/**
 * A new line. `from` is the line its words came from, when they came from
 * one: its record of where and when travels with them, because the words are
 * the same words (see notepad-provenance.ts).
 */
function newBlockNode(state: EditorState, head?: PMNode, from?: PMNode): PMNode {
  const schema = state.schema;
  const type = schema.nodes[NOTE_BLOCK];
  return type.create(
    {
      id: newId(),
      collapsed: false,
      place: from?.attrs.place ?? null,
      at: from?.attrs.at ?? null,
    },
    head ?? schema.nodes.paragraph.create()
  );
}

/** Words that already existed becoming a line of their own: never stamped as new. */
function inherited(tr: Transaction): Transaction {
  return tr.setMeta(NOTEPAD_NO_STAMP_META, true);
}

/** Whether a selection is a whole node (a block picked up by its handle). Duck-typed: see liftHiddenSelection. */
function isNodeSelection(sel: Selection): boolean {
  return "node" in sel && (sel as { node?: unknown }).node != null;
}

/** Put the caret back where it was, relative to a block that has moved. */
function keepCaret(tr: Transaction, state: EditorState, oldPos: number, newPos: number) {
  const sel = state.selection;
  if (isNodeSelection(sel) && sel.from === oldPos) {
    tr.setSelection(NodeSelection.create(tr.doc, newPos));
    return;
  }
  const shift = newPos - oldPos;
  tr.setSelection(TextSelection.create(tr.doc, sel.from + shift, sel.to + shift));
}

/** The block the selection is in, when the selection stays inside one block. */
function selectedBlock(state: EditorState): BlockInfo | null {
  const { $from, to } = state.selection;
  const b = blockAt($from);
  if (!b || to > b.end) return null;
  return b;
}

function structural(tr: Transaction): Transaction {
  return tr.setMeta(NOTEPAD_INSERT_META, true);
}

/* ------------------------------------------------------------------ */
/* Tab / Shift-Tab                                                     */
/* ------------------------------------------------------------------ */

/**
 * Tab: the block becomes the last child of the line above it. Nothing above
 * to go under — first in its group — and nothing happens, but the key is
 * still taken: Tab must never walk focus out of the notes.
 */
export const indentBlock: Command = (state, dispatch) => {
  const b = selectedBlock(state);
  if (!b) return false;
  if (b.index <= firstChildIndex(b.parent)) return true;
  const prev = b.parent.child(b.index - 1);
  const prevPos = b.pos - prev.nodeSize;
  if (dispatch) {
    const tr = structural(state.tr);
    tr.delete(b.pos, b.end);
    const at = prevPos + prev.nodeSize - 1;
    tr.insert(at, b.node);
    if (prev.attrs.collapsed) tr.setNodeMarkup(prevPos, undefined, { ...prev.attrs, collapsed: false });
    keepCaret(tr, state, b.pos, at);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Shift-Tab: the block steps out to sit after its parent, and the lines that
 * followed it under that parent come along as its children — the Workflowy
 * rule, and the one that keeps outdenting the inverse of indenting.
 */
export const outdentBlock: Command = (state, dispatch) => {
  const b = selectedBlock(state);
  if (!b) return false;
  if (!isBlock(b.parent)) return true;
  if (dispatch) {
    const $from = state.selection.$from;
    const parentEnd = $from.after(b.depth - 1);
    const following: PMNode[] = [];
    for (let i = b.index + 1; i < b.parent.childCount; i++) following.push(b.parent.child(i));
    const moved = b.node.type.create(b.node.attrs, b.node.content.append(Fragment.from(following)));
    const tr = structural(state.tr);
    tr.delete(b.pos, parentEnd - 1);
    const at = b.pos + 1;
    tr.insert(at, moved);
    keepCaret(tr, state, b.pos, at);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------ */
/* ⌥↑ / ⌥↓                                                             */
/* ------------------------------------------------------------------ */

/** The block and everything under it, up past the sibling above. */
export const moveBlockUp: Command = (state, dispatch) => {
  const b = selectedBlock(state);
  if (!b) return false;
  if (b.index <= firstChildIndex(b.parent)) return true;
  const prev = b.parent.child(b.index - 1);
  const at = b.pos - prev.nodeSize;
  if (dispatch) {
    const tr = structural(state.tr);
    tr.delete(b.pos, b.end);
    tr.insert(at, b.node);
    keepCaret(tr, state, b.pos, at);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** The block and everything under it, down past the sibling below. */
export const moveBlockDown: Command = (state, dispatch) => {
  const b = selectedBlock(state);
  if (!b) return false;
  if (b.index >= b.parent.childCount - 1) return true;
  const next = b.parent.child(b.index + 1);
  if (dispatch) {
    const tr = structural(state.tr);
    tr.delete(b.pos, b.end);
    const at = b.pos + next.nodeSize;
    tr.insert(at, b.node);
    keepCaret(tr, state, b.pos, at);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------ */
/* Collapse                                                            */
/* ------------------------------------------------------------------ */

/**
 * Fold or unfold the block at a position. Not a history step: undo is for
 * what was written, and un-folding something on ⌘Z would be a surprise. If
 * the caret was under what just folded, it comes up to the end of the head.
 */
export function setCollapsedAt(pos: number, collapsed: boolean): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || !isBlock(node)) return false;
    if (!hasChildren(node)) return true;
    if (node.attrs.collapsed === collapsed) return true;
    if (dispatch) {
      const tr = structural(state.tr).setMeta("addToHistory", false);
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed });
      const sel = state.selection;
      const headSize = node.firstChild!.nodeSize;
      const inside = sel.from > pos + 1 + headSize && sel.from < pos + node.nodeSize;
      if (collapsed && inside) tr.setSelection(headEnd(tr.doc, node, pos));
      dispatch(tr);
    }
    return true;
  };
}

export function toggleCollapsedAt(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || !isBlock(node)) return false;
    return setCollapsedAt(pos, !node.attrs.collapsed)(state, dispatch);
  };
}

/** ⌘↑ / ⌘↓ on the block the caret is in. Taken even when there's nothing to fold, so the page doesn't jump. */
export function setCollapsed(collapsed: boolean): Command {
  return (state, dispatch) => {
    const b = blockAt(state.selection.$from);
    if (!b) return false;
    setCollapsedAt(b.pos, collapsed)(state, dispatch);
    return true;
  };
}

/* ------------------------------------------------------------------ */
/* Enter                                                               */
/* ------------------------------------------------------------------ */

/**
 * Enter makes a new line.
 *
 * At the end of a line: the new one goes under it when the line is open
 * and has children (you were looking at them; the next thought joins them),
 * otherwise right after it — past everything folded beneath. In the middle
 * of a line: the words after the caret become the new line, and the children
 * stay with the old one. At the very start: an empty line opens above and
 * the caret stays put.
 *
 * On a line that is BLANK and nested, Enter steps it out a level instead —
 * the outliner's way out, the same key doing the same thing Shift-Tab does,
 * because pressing Enter twice is how anyone says "I'm finished with this
 * branch". Press it again and it steps out again, until the line is at the
 * top level, where an empty line is a thing you might actually want and Enter
 * goes back to making one.
 *
 * Inside a quote, Enter is the editor's own — another paragraph of the
 * quote — until the last paragraph is empty, when Enter steps out of the
 * quote onto a new line after it.
 *
 * The line made in the middle of another is made of that line's words, so it
 * takes that line's record of where and when along with them; the empty lines
 * made at the end and at the start are new, and get stamped when they are
 * written in (notepad-provenance.ts).
 */
export const splitBlock: Command = (state, dispatch) => {
  const sel = state.selection;
  const $from = sel.$from;
  const b = blockAt($from);
  if (!b || !inHead($from)) return false;
  const head = b.node.firstChild!;

  if (head.type.name === "blockquote") {
    const para = $from.parent;
    const inLast = $from.index(b.depth + 1) === head.childCount - 1;
    if (!sel.empty || para.type.name !== "paragraph" || para.content.size > 0 || !inLast || head.childCount < 2) {
      return false;
    }
    if (dispatch) {
      const tr = state.tr;
      tr.delete($from.before(), $from.after());
      const at = tr.mapping.map(b.end);
      const fresh = newBlockNode(state);
      tr.insert(at, fresh);
      tr.setSelection(headStart(tr.doc, at));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // Blank and nested: out a level, not another blank line.
  if (sel.empty && head.content.size === 0 && isBlock(b.parent)) {
    return outdentBlock(state, dispatch);
  }

  if (dispatch) {
    const tr = state.tr;
    if (!sel.empty) tr.deleteSelection();
    const $at = tr.selection.$from;
    const bb = blockAt($at)!;
    const h = bb.node.firstChild!;
    const off = $at.parentOffset;
    const len = h.content.size;

    if (len === 0 || off === len) {
      const under = hasChildren(bb.node) && !bb.node.attrs.collapsed;
      const at = under ? bb.pos + 1 + h.nodeSize : bb.end;
      tr.insert(at, newBlockNode(state));
      tr.setSelection(headStart(tr.doc, at));
    } else if (off === 0) {
      tr.insert(bb.pos, newBlockNode(state));
      tr.setSelection(TextSelection.create(tr.doc, $at.pos + 4));
    } else {
      const tail = state.schema.nodes.paragraph.create(null, h.content.cut(off));
      tr.delete($at.pos, bb.pos + h.nodeSize);
      const at = bb.end - (len - off);
      tr.insert(at, newBlockNode(state, tail, bb.node));
      tr.setSelection(headStart(tr.doc, at));
      inherited(tr);
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------ */
/* Backspace / Delete                                                  */
/* ------------------------------------------------------------------ */

/**
 * Backspace at the start of a line.
 *
 * An empty line goes away, and the caret lands at the end of the line above
 * it — the one the reader can see. An empty line with children under it is
 * only a wrapper, so it goes away and they take its place. A line with words
 * joins the end of the line above, its children stepping into its place. At
 * the start of a quote, Backspace turns the quote back into ordinary lines.
 * The first line of the note stays where it is.
 */
export const joinBlockBackward: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!sel.empty) return false;
  const $from = sel.$from;
  const b = blockAt($from);
  if (!b || !inHead($from) || $from.parentOffset !== 0) return false;
  const head = b.node.firstChild!;

  if (head.type.name === "blockquote") {
    if ($from.index(b.depth + 1) !== 0) return false;
    if (dispatch) {
      const tr = structural(state.tr);
      const paragraphs: PMNode[] = [];
      head.forEach((p) => paragraphs.push(p));
      const [first, ...rest] = paragraphs;
      const newHead = first ?? state.schema.nodes.paragraph.create();
      tr.replaceWith(b.pos + 1, b.pos + 1 + head.nodeSize, newHead);
      if (rest.length > 0) {
        tr.insert(tr.mapping.map(b.end), rest.map((p) => newBlockNode(state, p, b.node)));
      }
      inherited(tr);
      tr.setSelection(headStart(tr.doc, b.pos));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  const above = prevVisible($from, b);

  if (head.content.size === 0) {
    if (!hasChildren(b.node)) {
      if (!above) return true;
      if (dispatch) {
        const tr = structural(state.tr);
        tr.delete(b.pos, b.end);
        tr.setSelection(headEnd(tr.doc, above.node, above.pos));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    if (dispatch) {
      const tr = structural(state.tr);
      tr.replaceWith(b.pos, b.end, childrenFragment(b.node));
      tr.setSelection(above ? headEnd(tr.doc, above.node, above.pos) : headStart(tr.doc, b.pos));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  if (!above) return true;
  if (dispatch) {
    const tr = structural(state.tr);
    const target = headEnd(state.doc, above.node, above.pos).from;
    tr.replaceWith(b.pos, b.end, childrenFragment(b.node));
    tr.insert(target, head.content);
    tr.setSelection(TextSelection.create(tr.doc, target));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Delete at the end of a line: the next visible line joins this one, and
 * whatever was under it steps into its place. A quote below is left alone.
 */
export const joinBlockForward: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!sel.empty) return false;
  const $from = sel.$from;
  const b = blockAt($from);
  if (!b || !inHead($from)) return false;
  const head = b.node.firstChild!;
  if (head.type.name === "blockquote") return false;
  if ($from.parentOffset !== head.content.size) return false;

  const below = nextVisible($from, b);
  if (!below) return true;
  const belowHead = below.node.firstChild!;
  if (belowHead.type.name === "blockquote") return true;
  if (dispatch) {
    const tr = structural(state.tr);
    tr.replaceWith(below.pos, below.pos + below.node.nodeSize, childrenFragment(below.node));
    tr.insert(sel.from, belowHead.content);
    tr.setSelection(TextSelection.create(tr.doc, sel.from));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------ */
/* Where the caret goes                                                */
/* ------------------------------------------------------------------ */

/** The caret to the end of the last line the reader can see. */
export const focusEndVisible: Command = (state, dispatch) => {
  const last = lastVisible(state.doc);
  if (dispatch) {
    dispatch(state.tr.setSelection(headEnd(state.doc, last.node, last.pos)).scrollIntoView());
  }
  return true;
};

/**
 * A caret that has ended up under a fold — an undo, a programmatic move, a
 * drop — comes up to the end of the folded line's head. Applied by the
 * block extension after every transaction; null when nothing's wrong.
 */
export function liftHiddenSelection(state: EditorState): Transaction | null {
  const sel = state.selection;
  // Not `instanceof TextSelection`: the verify script loads ProseMirror twice
  // (its ESM copy and the modules' CJS copy), and the classes differ.
  if (!sel.empty || !sel.$from.parent.isTextblock || isNodeSelection(sel)) return null;
  const $from = sel.$from;
  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d);
    if (!isBlock(node) || !node.attrs.collapsed) continue;
    if ($from.index(d) === 0) continue;
    return state.tr.setSelection(headEnd(state.doc, node, $from.before(d)));
  }
  return null;
}
