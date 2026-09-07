import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { datePill, shouldStamp, type NotePlace } from "@/lib/reading/notes";
import { NOTEPAD_INSERT_META } from "./notepad-mentions";
import { PILL_NODE, pillJSON } from "./notepad-pill";

/**
 * Stamp a new paragraph with where — and when — the reader is.
 *
 * The log behaviour, on top of a document. Every time a fresh top-level
 * paragraph is started — Enter at the end of a line, or the first keystroke in
 * an empty note — two things are checked. If the reader has moved in the book
 * since the last place stamp, a pill for where they are goes in. If the day
 * has changed since the last date pill, a pill for today goes in ahead of it.
 * Delete either and it's gone; nothing here puts it back. That is the whole
 * contract, and it is why this is an appendTransaction rather than an Enter
 * override: it never changes what a key does, it only adds to what just
 * happened.
 *
 * Top-level paragraphs only. Enter inside a list makes a new item, and inside a
 * blockquote continues the quote; neither is a new thought. Splitting a
 * paragraph in the middle leaves the new one non-empty, so that gets nothing
 * either — editing an old thought is not the moment to say where you are now.
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
  /** Today, YYYY-MM-DD. */
  today: () => string;
  /** The most recent date pill in the note, or null before any. */
  lastDate: () => string | null;
  /** A place stamp went in. */
  onStamp: (place: NotePlace) => void;
  /** A date stamp went in. */
  onDateStamp: (iso: string) => void;
};

export const NotepadAutostamp = Extension.create<AutostampOptions>({
  name: "notepadAutostamp",

  addOptions() {
    return {
      spot: () => null,
      lastStamp: () => null,
      today: () => "",
      lastDate: () => null,
      onStamp: () => {},
      onDateStamp: () => {},
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
          if ($from.depth !== 1) return null;
          const para = $from.parent;
          if (para.type.name !== "paragraph") return null;

          const oldSel = oldState.selection;
          const $old = oldSel.$from;
          const oldPara = $old.depth >= 1 ? $old.parent : null;

          let insertAt: number | null = null;

          if (para.content.size === 0) {
            // A split: Enter at the end of something with words in it.
            if (
              !oldPara ||
              $old.depth !== 1 ||
              oldPara.content.size === 0 ||
              $old.parentOffset !== oldPara.content.size ||
              onlyPills(oldPara)
            ) {
              return null;
            }
            insertAt = $from.pos;
          } else if (
            oldState.doc.childCount === 1 &&
            oldState.doc.firstChild?.content.size === 0 &&
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

          const nodes: PMNode[] = [];
          const today = opts.today();
          const dateDue = today !== "" && opts.lastDate() !== today;
          if (dateDue) {
            nodes.push(type.create(pillJSON(datePill(today)).attrs), newState.schema.text(" "));
          }
          const spot = opts.spot();
          const placeDue = spot != null && shouldStamp(opts.lastStamp(), spot.char);
          if (placeDue && spot) {
            nodes.push(
              type.create({ kind: "place", char: spot.char, label: spot.label, mark: null }),
              newState.schema.text(" ")
            );
          }
          if (nodes.length === 0) return null;

          const tr: Transaction = newState.tr;
          tr.insert(insertAt, nodes);
          // The cursor lands after the pills and their spaces, where the words
          // go. For an empty paragraph that is also where it was, mapped forward.
          const after =
            para.content.size === 0 ? insertAt + nodes.length : tr.mapping.map(sel.from);
          tr.setSelection(TextSelection.create(tr.doc, after));
          tr.setMeta(AUTOSTAMP_META, true);
          if (dateDue) opts.onDateStamp(today);
          if (placeDue && spot) opts.onStamp(spot);
          return tr;
        },
      }),
    ];
  },
});

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
