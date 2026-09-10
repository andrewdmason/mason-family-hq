import { Extension, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import { NOTEPAD_INSERT_META } from "@/lib/reading/note-tree";
import { blockAt, inHead } from "./notepad-block-commands";
import type { SuggestionController } from "./notepad-mentions";

/**
 * The / menu: what a line can do.
 *
 * Three commands and no more. `ask` sends the line to the AI and turns it
 * into a conversation (see notepad-thread-block.ts); `here` puts a pill for
 * where the reader is; `date` puts today's date. The last two are what the
 * pin and the calendar in the header do, and what ⌥L and ⌥D do, offered a
 * third way for the hands that were already typing.
 *
 * Only at the END of a line — `/ask` is something you finish a question
 * with — and never inside a quote, which is the book's words and not a place
 * for commands. A slash mid-sentence ("and/or", a URL) is a slash.
 *
 * `/ask⏎` works without looking: the query narrows the rows, and Enter runs
 * the one that's left. `/⏎` runs the first row, which is Ask — the same
 * convention the @ menu keeps.
 */
export type SlashCommand = "ask" | "here" | "date";

export type SlashItem = {
  id: SlashCommand;
  label: string;
  hint: string;
  /** Offered but can't run right now — "here" with nowhere to point. */
  disabled: boolean;
};

export const NOTEPAD_SLASH_KEY = new PluginKey("notepad-slash");

const COMMANDS: { id: SlashCommand; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "send this line to the AI" },
  { id: "here", label: "Here", hint: "where you are in the book" },
  { id: "date", label: "Date", hint: "today" },
];

/** The rows for what's been typed after the slash. */
export function matchSlashItems(query: string, opts: { canStamp: boolean }): SlashItem[] {
  const q = query.trim().toLowerCase();
  return COMMANDS.filter((c) => !q || c.id.startsWith(q)).map((c) => ({
    ...c,
    disabled: c.id === "here" && !opts.canStamp,
  }));
}

/**
 * Whether a slash at `pos` is one the menu should answer: the caret is at
 * the end of a paragraph or heading that is a line's head.
 */
export function slashAllowed(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  const b = blockAt($pos);
  if (!b || !inHead($pos)) return false;
  const head = b.node.firstChild;
  if (!head || (head.type.name !== "paragraph" && head.type.name !== "heading")) return false;
  return $pos.parent === head && $pos.parentOffset === head.content.size;
}

export const NotepadSlash = Extension.create<{
  /** Whether "here" has somewhere to point. */
  canStamp: () => boolean;
  /** Run a command, with the range of the `/…` text to take out first. */
  run: (command: SlashCommand, range: Range) => void;
  controller: SuggestionController<SlashItem>;
}>({
  name: "notepadSlash",

  addOptions() {
    return {
      canStamp: () => false,
      run: () => {},
      controller: { onChange: () => {}, activeIndex: () => 0, setActiveIndex: () => {} },
    };
  },

  addProseMirrorPlugins() {
    const { controller, canStamp, run } = this.options;

    const publish = (props: SuggestionProps<SlashItem, SlashItem>) => {
      controller.onChange({
        items: props.items,
        activeIndex: controller.activeIndex(),
        rect: props.clientRect?.() ?? null,
        command: props.command,
      });
    };

    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: NOTEPAD_SLASH_KEY,
        editor: this.editor,
        char: "/",
        // Anywhere at the end of a line, not only after a space: "late?/ask"
        // is how it gets typed. `allow` is what keeps a slash mid-sentence a
        // slash.
        allowedPrefixes: null,
        allow: ({ state, range }) => slashAllowed(state, range.to),
        items: ({ query }) => matchSlashItems(query, { canStamp: canStamp() }),
        command: ({ editor, range, props }) => {
          if (props.disabled) return;
          if (props.id === "ask") {
            run("ask", range);
            return;
          }
          // The `/here` or `/date` goes, and what it asked for comes in
          // where it was.
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              tr.setMeta(NOTEPAD_INSERT_META, true);
              return true;
            })
            .deleteRange(range)
            .run();
          run(props.id, range);
        },
        render: () => {
          let current: SuggestionProps<SlashItem, SlashItem> | null = null;
          return {
            onStart: (props) => {
              current = props;
              controller.setActiveIndex(0);
              publish(props);
            },
            onUpdate: (props) => {
              current = props;
              if (controller.activeIndex() >= props.items.length) controller.setActiveIndex(0);
              publish(props);
            },
            onExit: () => {
              current = null;
              controller.onChange(null);
            },
            onKeyDown: ({ event }) => {
              if (!current || current.items.length === 0) {
                return event.key === "Escape";
              }
              const n = current.items.length;
              if (event.key === "ArrowDown") {
                controller.setActiveIndex((controller.activeIndex() + 1) % n);
                publish(current);
                return true;
              }
              if (event.key === "ArrowUp") {
                controller.setActiveIndex((controller.activeIndex() - 1 + n) % n);
                publish(current);
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const item = current.items[controller.activeIndex()];
                if (item) current.command(item);
                return true;
              }
              return event.key === "Escape";
            },
          };
        },
      }),
    ];
  },
});
