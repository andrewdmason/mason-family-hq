import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { MentionTarget } from "@/lib/reading/mentions";
import { COMPOSE_NODE, quoteAbove } from "./notepad-compose";

import { NOTEPAD_INSERT_META } from "@/lib/reading/note-tree";

export { clipContent, NOTEPAD_INSERT_META } from "@/lib/reading/note-tree";

/**
 * The @ menu: who a paragraph is for.
 *
 * People, and only people. A person's name sends the line to them. The AI
 * used to be a row here too, and isn't: `@` names somebody, `/` gives a
 * command, and asking the AI is a command — see notepad-slash.ts. (There
 * was also briefly a row per mark in the book, to pull its quote in, and it
 * was the wrong tool: a highlight lands in the notes by itself.)
 */
export type MentionItem = { kind: "member"; target: MentionTarget };

/**
 * What the React side needs to draw a menu. Handed over through callbacks
 * rather than rendered by the plugin, so the menu is an ordinary component
 * inside the panel — see MentionTypeahead for why that matters: the panel
 * closes on any pointerdown outside itself, so a portalled menu would be the
 * one thing in it that shut it. Shared by the @ menu and the / menu, which
 * differ only in what their rows are.
 */
export type MenuState<I> = {
  items: I[];
  activeIndex: number;
  /** Where the caret is, in viewport coordinates. */
  rect: DOMRect | null;
  command: (item: I) => void;
};

export type SuggestionController<I> = {
  onChange: (state: MenuState<I> | null) => void;
  /** The current active row, so the plugin's key handling and the menu agree. */
  activeIndex: () => number;
  setActiveIndex: (i: number) => void;
};

export type MentionMenuState = MenuState<MentionItem>;
export type MentionController = SuggestionController<MentionItem>;

export const NOTEPAD_MENTION_KEY = new PluginKey("notepad-mention");

/** Everyone, narrowed by what's typed. */
export function matchItems(members: MentionTarget[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase();
  const items: MentionItem[] = [];
  for (const t of members) {
    if (t.kind !== "member") continue;
    if (!q || t.handle.startsWith(q) || t.name.toLowerCase().startsWith(q)) {
      items.push({ kind: "member", target: t });
    }
  }
  return items;
}

export const NotepadMentions = Extension.create<{
  members: () => MentionTarget[];
  controller: MentionController;
}>({
  name: "notepadMentions",

  addOptions() {
    return {
      members: () => [],
      controller: { onChange: () => {}, activeIndex: () => 0, setActiveIndex: () => {} },
    };
  },

  addProseMirrorPlugins() {
    const { controller } = this.options;
    const members = this.options.members;

    const publish = (props: SuggestionProps<MentionItem, MentionItem>) => {
      controller.onChange({
        items: props.items,
        activeIndex: controller.activeIndex(),
        rect: props.clientRect?.() ?? null,
        command: props.command,
      });
    };

    return [
      Suggestion<MentionItem, MentionItem>({
        pluginKey: NOTEPAD_MENTION_KEY,
        editor: this.editor,
        char: "@",
        items: ({ query }) => matchItems(members(), query),
        command: ({ editor, range, props }) => {
          insertChip(editor, range, props);
        },
        render: () => {
          let current: SuggestionProps<MentionItem, MentionItem> | null = null;
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

/**
 * The chip goes where the @ was. One per paragraph: picking again with a chip
 * already there replaces it rather than stacking two promises on one line.
 */
function insertChip(editor: Editor, range: Range, item: MentionItem) {
  const attrs = { kind: "member", handle: item.target.handle, name: item.target.name.split(/\s+/)[0] };

  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setMeta(NOTEPAD_INSERT_META, true);
      return true;
    })
    .command(({ tr, state }) => {
      // Any chip already in this paragraph goes first.
      const $from = state.doc.resolve(range.from);
      const para = $from.parent;
      const start = $from.start();
      let existing: number | null = null;
      para.forEach((child, offset) => {
        if (child.type.name === COMPOSE_NODE) existing = start + offset;
      });
      if (existing != null) tr.delete(existing, existing + 1);
      return true;
    })
    .deleteRange(range)
    .command(({ tr, state }) => {
      const quoted = quoteAbove(state.doc, tr.mapping.map(range.from));
      const type = state.schema.nodes[COMPOSE_NODE];
      const at = tr.mapping.map(range.from);
      tr.insert(at, [type.create({ ...attrs, state: "idle", quoted }), state.schema.text(" ")]);
      return true;
    })
    .run();
}
