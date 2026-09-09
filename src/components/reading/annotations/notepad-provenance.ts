import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NotePlace } from "@/lib/reading/notes";
import { NOTE_BLOCK, NOTEPAD_NO_STAMP_META } from "@/lib/reading/note-tree";

/**
 * Where the reader was, and when — recorded on the line itself.
 *
 * The log's one good property, kept without the log. A line of the notepad is
 * stamped the moment it gets its first words: the reading position at that
 * instant and the time, written onto the block rather than into the text.
 * Nothing appears. The reader asks for it by pressing the line's handle
 * (notepad-block.ts), which is the only place any of it is ever shown.
 *
 * This replaced an auto-stamp that put a visible pill at the front of a new
 * paragraph whenever the reader had moved since the last one. The pills were
 * the problem: a line of your own thinking should not open with the machine's
 * bookkeeping. The pin in the header and ⌥L still make one on purpose, which
 * is a different act and stays visible.
 *
 * FIRST WORDS, not first existence, is the moment. Enter opens an empty line
 * and nothing is recorded; the position is taken when something is typed into
 * it, which is when the thought actually happened — a line opened before
 * turning the page and written after it belongs to the page it was written
 * on. An empty line therefore never carries provenance, which is also why an
 * outline full of blank lines writes no places into the derived markdown.
 *
 * PROVENANCE TRAVELS WITH TEXT. A block that already knows is never restamped,
 * so a line dragged, indented, folded, copied or pasted somewhere else keeps
 * what it knew, and undo brings back the original along with it. Splitting a
 * line hands the tail the head's own record, because those words are old
 * words — the commands that do that tag their transaction (NOTEPAD_NO_STAMP)
 * and this plugin stays out of the way. What is left is exactly the two cases
 * that mean a new thought: an empty line being written in, and text arriving
 * from outside the notepad with no history of its own.
 *
 * The reader's position is read fresh on every stamp, through the options,
 * because it changes on every page and a plugin rebuilt per change would lose
 * the editor's undo history.
 */
const key = new PluginKey("notepad-provenance");

export type ProvenanceOptions = {
  /** Where the reader is now, or null when there's nowhere to record. */
  spot: () => NotePlace | null;
  /** The clock, injectable so the verify script can hold it still. */
  now: () => string;
};

export const NotepadProvenance = Extension.create<ProvenanceOptions>({
  name: "notepadProvenance",

  addOptions() {
    return {
      spot: () => null,
      now: () => new Date().toISOString(),
    };
  },

  addProseMirrorPlugins() {
    return [provenancePlugin(this.options)];
  },
});

/** The plugin on its own, so the verify script can run it without an editor. */
export function provenancePlugin(opts: ProvenanceOptions): Plugin {
  return new Plugin({
    key,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.some((tr) => tr.getMeta(NOTEPAD_NO_STAMP_META))) return null;

      // The lines that could want stamping: written in, and knowing nothing.
      // In a note that has been open a while there are none, and the old
      // document is never walked at all.
      const blank: { pos: number; node: PMNode }[] = [];
      newState.doc.descendants((node, pos) => {
        if (node.type.name !== NOTE_BLOCK) return true;
        if (node.attrs.place == null && node.attrs.at == null && written(node)) {
          blank.push({ pos, node });
        }
        return true;
      });
      if (blank.length === 0) return null;

      // …minus the ones that already had words a moment ago. Those are lines
      // from a note written before any of this: they know nothing and never
      // will, and today is not the answer.
      const before = new Map<string, boolean>();
      oldState.doc.descendants((node) => {
        if (node.type.name !== NOTE_BLOCK) return true;
        before.set(node.attrs.id as string, written(node));
        return true;
      });
      const fresh = blank.filter(({ node }) => !before.get(node.attrs.id as string));
      if (fresh.length === 0) return null;

      const place = opts.spot();
      const at = opts.now();
      const tr = newState.tr;
      for (const { pos, node } of fresh) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, place, at });
      }
      // Part of the same history step as whatever wrote the line, so one
      // ⌘Z takes back the words and the record of them together.
      return tr;
    },
  });
}

/** Whether a line has any words in it — its head, not what's nested under it. */
function written(block: PMNode): boolean {
  return (block.firstChild?.content.size ?? 0) > 0;
}
