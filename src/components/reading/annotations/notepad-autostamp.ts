import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { shouldStamp, type NotePlace } from "@/lib/reading/notes";
import { NOTE_BLOCK, NOTEPAD_INSERT_META } from "@/lib/reading/note-tree";
import { PILL_NODE } from "./notepad-pill";

/**
 * Stamp a new paragraph with where the reader is.
 *
 * The log behaviour, on top of a document. Every time a fresh top-level
 * paragraph is started — Enter at the end of a line, or the first keystroke in
 * an empty note — and the reader has moved in the book since the last stamp, a
 * pill for where they are goes in at the front of it. Delete it and it's gone;
 * nothing here puts it back. That is the whole contract, and it is why this is
 * an appendTransaction rather than an Enter override: it never changes what a
 * key does, it only adds to what just happened.
 *
 * Places only. Dates were stamped here too for a day, on the first thing
 * written each day, and Andrew didn't want them: a date is something you put
 * in on purpose (⌥D, or the calendar button), not something the note does to
 * itself.
 *
 * The head of a block only, at any depth — a new line of the outline, nested
 * or not, is a new thought. Enter inside a quote continues the quote and is
 * not one. Splitting a line in the middle leaves the new one non-empty, so
 * that gets nothing either — editing an old thought is not the moment to say
 * where you are now. Moving, nesting and folding lines are tagged by the
 * block commands so they never stamp.
 *
 * Everything is read through the options fresh on every stamp, because the
 * reader's position changes every page and a plugin rebuilt per change would
 * lose the editor's history.
 */
export const AUTOSTAMP_META = "notepad-autostamp";

const key = new PluginKey("notepad-autostamp");

export type AutostampOptions = {
  /** Where the reader is now, or null when there's nowhere to stamp. */
  spot: () => NotePlace | null;
  /** The char of the most recent place stamp, or null before any. */
  lastStamp: () => number | null;
  /** A stamp went in. */
  onStamp: (place: NotePlace) => void;
};

export const NotepadAutostamp = Extension.create<AutostampOptions>({
  name: "notepadAutostamp",

  addOptions() {
    return {
      spot: () => null,
      lastStamp: () => null,
      onStamp: () => {},
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        key,
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          // Not on our own stamp, not on undo/redo, not on paste, not on the
          // programmatic inserts the notepad makes (clips, the "here" button).
          for (const tr of transactions) {
            if (tr.getMeta(AUTOSTAMP_META)) return null;
            if (tr.getMeta("paste")) return null;
            if (tr.getMeta("uiEvent") === "paste") return null;
            if (tr.getMeta("addToHistory") === false) return null;
            if (tr.getMeta(NOTEPAD_INSERT_META)) return null;
          }

          const sel = newState.selection;
          if (!sel.empty) return null;
          const $from = sel.$from;
          const para = $from.parent;
          if (para.type.name !== "paragraph" || !isHead($from)) return null;

          const oldSel = oldState.selection;
          const $old = oldSel.$from;
          const oldPara = $old.depth >= 1 && isHead($old) ? $old.parent : null;

          let insertAt: number | null = null;

          if (para.content.size === 0) {
            // A split: Enter at the end of something with words in it.
            if (
              !oldPara ||
              oldPara.content.size === 0 ||
              $old.parentOffset !== oldPara.content.size ||
              onlyPills(oldPara)
            ) {
              return null;
            }
            insertAt = $from.pos;
          } else if (
            oldState.doc.childCount === 1 &&
            oldState.doc.firstChild?.childCount === 1 &&
            oldState.doc.firstChild.firstChild?.content.size === 0 &&
            newState.doc.childCount === 1 &&
            !startsWithPill(para)
          ) {
            // The first keystroke into an empty note.
            insertAt = $from.start();
          } else {
            return null;
          }

          const type = newState.schema.nodes[PILL_NODE];
          if (!type) return null;

          const spot = opts.spot();
          if (!spot || !shouldStamp(opts.lastStamp(), spot.char)) return null;

          const tr: Transaction = newState.tr;
          tr.insert(insertAt, [
            type.create({ kind: "place", char: spot.char, label: spot.label, mark: null }),
            newState.schema.text(" "),
          ]);
          // The cursor lands after the pill and its space, where the words go.
          // For an empty paragraph that is also where it was, mapped forward.
          const after =
            para.content.size === 0 ? insertAt + 2 : tr.mapping.map(sel.from);
          tr.setSelection(TextSelection.create(tr.doc, after));
          tr.setMeta(AUTOSTAMP_META, true);
          opts.onStamp(spot);
          return tr;
        },
      }),
    ];
  },
});

/** Whether the textblock around a position is the head of a block (not a paragraph inside a quote). */
function isHead($pos: ResolvedPos): boolean {
  const d = $pos.depth;
  return d >= 1 && $pos.node(d - 1).type.name === NOTE_BLOCK && $pos.index(d - 1) === 0;
}

/** A paragraph that is nothing but pills and whitespace: a stamp nobody wrote after. */
function onlyPills(para: PMNode): boolean {
  let pills = 0;
  let words = false;
  para.forEach((child) => {
    if (child.type.name === PILL_NODE) pills += 1;
    else if (child.isText && child.text?.trim()) words = true;
    else if (!child.isText) words = true;
  });
  return pills > 0 && !words;
}

function startsWithPill(para: PMNode): boolean {
  return para.firstChild?.type.name === PILL_NODE;
}
